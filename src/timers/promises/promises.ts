/**
 * Node's timers/promises, on this library's timers: they run on the libuv
 * loop, so they also settle while the app is in the background. Validation,
 * errors and abort handling follow Node's lib/timers/promises.js.
 */
import {
  clearImmediate,
  clearInterval,
  clearTimeout,
  setImmediate as setImmediateCallback,
  setInterval as setIntervalCallback,
  setTimeout as setTimeoutCallback,
} from '../timers';

/** What these functions use of an AbortSignal (React Native's, or any). */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: unknown): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface TimerOptions {
  /** Accepted for compatibility: an app has no process exit to hold up. */
  ref?: boolean;
  /** Aborting it rejects the promise with an AbortError. */
  signal?: AbortSignalLike;
}

/** Node's AbortError (not exported by Node's timers/promises either). */
class AbortError extends Error {
  public readonly code = 'ABORT_ERR';

  constructor(message = 'The operation was aborted', options?: { cause?: unknown }) {
    super(message);
    this.name = 'AbortError';
    if (options && 'cause' in options) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

function abortError(signal: AbortSignalLike): AbortError {
  return new AbortError(undefined, { cause: signal.reason });
}

/** How Node's ERR_INVALID_ARG_TYPE describes the value it got. */
function received(value: unknown): string {
  if (value === null || value === undefined) {
    return `Received ${value}`;
  }
  if (typeof value === 'function') {
    return `Received function ${value.name}`;
  }
  if (typeof value === 'object') {
    const name = (value as object).constructor?.name;
    return name ? `Received an instance of ${name}` : 'Received [Object: null prototype]';
  }
  let shown =
    typeof value === 'string'
      ? `'${value}'`
      : typeof value === 'bigint'
        ? `${value}n`
        : String(value);
  if (shown.length > 28) {
    shown = `${shown.slice(0, 25)}...`;
  }
  return `Received type ${typeof value} (${shown})`;
}

function invalidArgType(what: string, value: unknown): TypeError {
  return Object.assign(new TypeError(`${what}. ${received(value)}`), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
}

function validateDelay(delay: unknown): void {
  if (delay !== undefined && typeof delay !== 'number') {
    throw invalidArgType('The "delay" argument must be of type number', delay);
  }
}

function validateOptions(options: unknown): asserts options is TimerOptions {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw invalidArgType('The "options" argument must be of type object', options);
  }
  const { signal, ref } = options as TimerOptions;
  if (
    signal !== undefined &&
    (signal === null || typeof signal !== 'object' || !('aborted' in signal))
  ) {
    throw invalidArgType(
      'The "options.signal" property must be an instance of AbortSignal',
      signal,
    );
  }
  if (ref !== undefined && typeof ref !== 'boolean') {
    throw invalidArgType('The "options.ref" property must be of type boolean', ref);
  }
}

/**
 * Settles with `value` once `start` calls back, or rejects with an AbortError
 * when `signal` aborts first. `start` returns the function that cancels it.
 */
function whenDone<T>(
  value: T,
  signal: AbortSignalLike | undefined,
  start: (done: () => void) => () => void,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(abortError(signal));
  }
  let onAbort: (() => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    const cancel = start(() => resolve(value));
    if (signal) {
      onAbort = () => {
        cancel();
        reject(abortError(signal));
      };
      signal.addEventListener('abort', onAbort);
    }
  });
  if (!signal || !onAbort) {
    return promise;
  }
  const listener = onAbort;
  return promise.finally(() => signal.removeEventListener('abort', listener));
}

/** Resolves with `value` after `delay` milliseconds (default 1). */
export function setTimeout<T = void>(
  delay?: number,
  value?: T,
  options: TimerOptions = {},
): Promise<T> {
  try {
    validateDelay(delay);
    validateOptions(options);
  } catch (err) {
    return Promise.reject(err);
  }
  return whenDone(value as T, options.signal, done => {
    const timer = setTimeoutCallback(done, delay);
    return () => clearTimeout(timer);
  });
}

/** Resolves with `value` on the loop's next check phase, as setImmediate(). */
export function setImmediate<T = void>(
  value?: T,
  options: TimerOptions = {},
): Promise<T> {
  try {
    validateOptions(options);
  } catch (err) {
    return Promise.reject(err);
  }
  return whenDone(value as T, options.signal, done => {
    const immediate = setImmediateCallback(done);
    return () => clearImmediate(immediate);
  });
}

/**
 * Yields `value` every `delay` milliseconds (default 1), for `for await`.
 * Ticks the loop body was too slow for are yielded right after it, as in
 * Node. Aborting `signal` ends the loop with an AbortError.
 */
export async function* setInterval<T = void>(
  delay?: number,
  value?: T,
  options: TimerOptions = {},
): AsyncGenerator<T, void, unknown> {
  validateDelay(delay);
  validateOptions(options);
  const { signal } = options;
  if (signal?.aborted) {
    throw abortError(signal);
  }
  let onAbort: (() => void) | undefined;
  let interval: ReturnType<typeof setIntervalCallback> | undefined;
  try {
    let notYielded = 0;
    let wake: ((aborted?: Promise<never>) => void) | undefined;
    interval = setIntervalCallback(() => {
      notYielded++;
      wake?.();
      wake = undefined;
    }, delay);
    if (signal) {
      onAbort = () => {
        clearInterval(interval);
        wake?.(Promise.reject(abortError(signal)));
        wake = undefined;
      };
      signal.addEventListener('abort', onAbort);
    }
    while (!signal?.aborted) {
      if (notYielded === 0) {
        await new Promise<void>((resolve, reject) => {
          wake = aborted => (aborted ? aborted.then(resolve, reject) : resolve());
        });
      }
      for (; notYielded > 0; notYielded--) {
        yield value as T;
      }
    }
    throw abortError(signal);
  } finally {
    clearInterval(interval);
    if (signal && onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/** Node's timers/promises scheduler: wait() and yield(). */
class Scheduler {
  /** Resolves on the loop's next check phase, as setImmediate(). */
  yield(): Promise<void> {
    return setImmediate();
  }

  /** Resolves after `delay` milliseconds, as setTimeout(delay, undefined, options). */
  wait(delay?: number, options?: TimerOptions): Promise<void> {
    return setTimeout(delay, undefined, options);
  }
}

export const scheduler = new Scheduler();
