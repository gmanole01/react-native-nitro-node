import { NitroTimers } from '../native';

/** The longest delay Node accepts; longer ones become 1 ms, as in Node. */
const TIMEOUT_MAX = 2 ** 31 - 1;

/**
 * The armed timers, by the id of their native timer. A Timeout gets a new id
 * each time it is armed, so a firing that was already on its way when the
 * timer was cleared or refreshed finds no timer, and is dropped.
 */
const armed = new Map<number, Timeout>();
let nextNativeId = 1;

/**
 * The live timers by their number (see Timeout[Symbol.toPrimitive]), for
 * clearTimeout(number): armed timeouts, and intervals until cleared.
 */
const knownTimersById = new Map<number, Timeout>();
let nextTimerId = 1;

NitroTimers.onTimeout = (nativeId: number) => {
  const timer = armed.get(nativeId);
  if (timer === undefined) {
    return;
  }
  armed.delete(nativeId);
  timer._fire();
};

/**
 * The immediates waiting for the next batch, in the order they were set. One
 * native onImmediate runs a whole batch.
 */
let immediateQueue = new Set<Immediate>();
let immediatesScheduled = false;

function scheduleImmediates(): void {
  if (!immediatesScheduled) {
    immediatesScheduled = true;
    NitroTimers.scheduleImmediate();
  }
}

NitroTimers.onImmediate = () => {
  immediatesScheduled = false;
  // As in Node, the batch is what was set so far: immediates set while it runs
  // wait for the next one.
  const batch = immediateQueue;
  immediateQueue = new Set();
  try {
    for (const immediate of batch) {
      batch.delete(immediate);
      immediate._run();
    }
  } finally {
    // When one threw, the rest of its batch goes first next time.
    if (batch.size > 0) {
      immediateQueue = new Set([...batch, ...immediateQueue]);
    }
    if (immediateQueue.size > 0) {
      scheduleImmediates();
    }
  }
};

// Node's handling of delays: anything that isn't 1 to TIMEOUT_MAX ms is 1 ms.
function normalizeDelay(after: unknown): number {
  const ms = Number(after);
  if (ms >= 1 && ms <= TIMEOUT_MAX) {
    return ms;
  }
  if (ms > TIMEOUT_MAX) {
    console.warn(
      `TimeoutOverflowWarning: ${ms} does not fit into a 32-bit signed integer.\n` +
        'Timeout duration was set to 1.',
    );
  }
  return 1;
}

function validateCallback(callback: unknown): asserts callback is Function {
  if (typeof callback !== 'function') {
    const received = callback === null ? 'null' : typeof callback;
    const message = `The "callback" argument must be of type function. Received ${received}`;
    throw Object.assign(new TypeError(message), {
      code: 'ERR_INVALID_ARG_TYPE',
    });
  }
}

/**
 * What setTimeout() and setInterval() return, as Node's Timeout. ref() and
 * unref() are kept for compatibility only: an app has no process exit for a
 * timer to hold up.
 */
export class Timeout {
  private _callback: Function | null;
  private readonly _args: unknown[];
  private readonly _delay: number;
  private readonly _repeat: boolean;
  private _nativeId: number | null = null;
  private _refed = true;
  private readonly _timerId = nextTimerId++;

  /** @internal Use setTimeout() or setInterval(). */
  constructor(
    callback: Function,
    after: unknown,
    args: unknown[],
    repeat: boolean,
  ) {
    this._callback = callback;
    this._args = args;
    this._delay = normalizeDelay(after);
    this._repeat = repeat;
    this._arm();
  }

  /** No effect, see the class. */
  ref(): this {
    this._refed = true;
    return this;
  }

  /** No effect, see the class. */
  unref(): this {
    this._refed = false;
    return this;
  }

  hasRef(): boolean {
    return this._refed;
  }

  /**
   * Restarts the timer from now with its original delay, and runs it again
   * when it already fired. Does nothing once the timer is cleared.
   */
  refresh(): this {
    if (this._callback !== null) {
      this._disarm();
      this._arm();
    }
    return this;
  }

  /** Same as clearTimeout(timer). */
  close(): this {
    clearTimeout(this);
    return this;
  }

  /**
   * A number that clearTimeout() and clearInterval() accept in place of the
   * Timeout, as in Node.
   */
  [Symbol.toPrimitive](): number {
    return this._timerId;
  }

  /** @internal Called by the native callback when the timer is due. */
  _fire(): void {
    this._nativeId = null;
    const callback = this._callback;
    if (callback === null) {
      return;
    }
    if (!this._repeat) {
      this._forget();
    }
    try {
      callback.apply(this, this._args);
    } finally {
      // As in Node, the interval goes on even when its callback threw, and is
      // timed from the end of the callback. The callback may have cleared or
      // refreshed it.
      if (this._repeat && this._callback !== null && this._nativeId === null) {
        this._arm();
      }
    }
  }

  /** @internal */
  _clear(): void {
    if (this._callback === null) {
      return;
    }
    this._callback = null;
    this._disarm();
    this._forget();
  }

  private _arm(): void {
    const id = nextNativeId++;
    this._nativeId = id;
    armed.set(id, this);
    knownTimersById.set(this._timerId, this);
    NitroTimers.start(id, this._delay);
  }

  private _disarm(): void {
    if (this._nativeId !== null) {
      armed.delete(this._nativeId);
      NitroTimers.stop(this._nativeId);
      this._nativeId = null;
    }
  }

  private _forget(): void {
    knownTimersById.delete(this._timerId);
  }
}

/**
 * What setImmediate() returns, as Node's Immediate. ref() and unref() are kept
 * for compatibility only, as for Timeout.
 */
export class Immediate {
  private _callback: Function | null;
  private readonly _args: unknown[];
  private _refed = true;

  /** @internal Use setImmediate(). */
  constructor(callback: Function, args: unknown[]) {
    this._callback = callback;
    this._args = args;
    immediateQueue.add(this);
    scheduleImmediates();
  }

  /** No effect, see the class. */
  ref(): this {
    this._refed = true;
    return this;
  }

  /** No effect, see the class. */
  unref(): this {
    this._refed = false;
    return this;
  }

  hasRef(): boolean {
    return this._refed;
  }

  /** @internal Called with its batch. */
  _run(): void {
    const callback = this._callback;
    if (callback === null) {
      return;
    }
    this._callback = null;
    callback.apply(this, this._args);
  }

  /** @internal */
  _clear(): void {
    this._callback = null;
    immediateQueue.delete(this);
  }
}

export interface Timeout {
  /**
   * Clears the timer, for `using timer = setTimeout(...)`. Only where the
   * runtime has Symbol.dispose.
   */
  [Symbol.dispose]?(): void;
}

export interface Immediate {
  /**
   * Clears the immediate, for `using immediate = setImmediate(...)`. Only
   * where the runtime has Symbol.dispose.
   */
  [Symbol.dispose]?(): void;
}

// Not class members: on a runtime without Symbol.dispose, the methods would
// be named "undefined".
if (typeof Symbol.dispose === 'symbol') {
  Timeout.prototype[Symbol.dispose] = function (this: Timeout) {
    clearTimeout(this);
  };
  Immediate.prototype[Symbol.dispose] = function (this: Immediate) {
    clearImmediate(this);
  };
}

/** Calls `callback(...args)` once, after `ms` milliseconds (default 1). */
export function setTimeout<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  ms?: number,
  ...args: TArgs
): Timeout {
  validateCallback(callback);
  return new Timeout(callback, ms, args, false);
}

/** Calls `callback(...args)` every `ms` milliseconds (default 1). */
export function setInterval<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  ms?: number,
  ...args: TArgs
): Timeout {
  validateCallback(callback);
  return new Timeout(callback, ms, args, true);
}

/**
 * Cancels a timeout or interval, given as the Timeout or as its number (see
 * Timeout[Symbol.toPrimitive]). Anything else is ignored.
 */
export function clearTimeout(
  timer: Timeout | string | number | null | undefined,
): void {
  if (timer instanceof Timeout) {
    timer._clear();
    return;
  }
  if (typeof timer === 'number' || typeof timer === 'string') {
    knownTimersById.get(Number(timer))?._clear();
  }
}

/** The same as clearTimeout(), as in Node. */
export function clearInterval(
  timer: Timeout | string | number | null | undefined,
): void {
  clearTimeout(timer);
}

/**
 * Calls `callback(...args)` after the I/O events that are already in, as
 * Node does: on the libuv loop's next check phase, not as a microtask like
 * React Native's own setImmediate. Immediates run in the order they were set.
 */
export function setImmediate<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  ...args: TArgs
): Immediate {
  validateCallback(callback);
  return new Immediate(callback, args);
}

/** Cancels an immediate. Anything else is ignored. */
export function clearImmediate(immediate: Immediate | null | undefined): void {
  if (immediate instanceof Immediate) {
    immediate._clear();
  }
}
