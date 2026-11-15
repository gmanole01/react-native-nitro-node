import * as net from 'react-native-nitro-node/net';
import { Buffer } from 'buffer';

export const HOST = '127.0.0.1';
export const LOG_PREFIX = '[net-test]';

export type Log = (message: string) => void;

export const noLog: Log = () => {};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Calls `fn`, which has to throw an error named `name` ('TypeError', ...).
 * Returns the error's message.
 */
export function expectThrow(
  label: string,
  name: string,
  fn: () => unknown,
): string {
  try {
    fn();
  } catch (err) {
    const actual = (err as any)?.name;
    if (actual !== name) {
      throw new Error(
        `${label}: threw ${actual} (${errorMessage(err)}), expected ${name}`,
      );
    }
    return errorMessage(err);
  }
  throw new Error(`${label}: did not throw`);
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resolves with the event's first argument, or rejects if the emitter emits
 * 'error' first. Listeners are removed once it settles.
 */
export function waitFor<T = any>(emitter: any, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    function cleanup() {
      emitter.removeListener(event, onEvent);
      emitter.removeListener('error', onError);
    }
    function onEvent(arg: T) {
      cleanup();
      resolve(arg);
    }
    function onError(err: Error) {
      cleanup();
      reject(new Error(`'error' while waiting for '${event}': ${err.message}`));
    }
    emitter.once(event, onEvent);
    emitter.once('error', onError);
  });
}

/**
 * Logs every lifecycle event of a socket. The permanent 'error' listener also
 * keeps an unexpected error from being thrown as an unhandled 'error' event.
 */
export function traceSocket(socket: any, label: string, log: Log) {
  socket.on('connect', () => log(`${label}: connect`));
  socket.on('end', () => log(`${label}: end`));
  socket.on('close', () => log(`${label}: close`));
  socket.on('error', (err: Error) => log(`${label}: error: ${err.message}`));
}

/** Connects to `port` on the loopback and resolves once connected. */
export async function connectClient(port: number, label: string, log: Log) {
  const client: any = net.connect(port, HOST);
  traceSocket(client, label, log);
  await waitFor(client, 'connect');
  return client;
}

/** Resolves once `expected` bytes have arrived on the socket. */
export function readBytes(
  socket: any,
  expected: number,
): Promise<{ data: Buffer; chunks: number }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    function cleanup() {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    }
    function onData(chunk: Buffer) {
      chunks.push(chunk);
      received += chunk.length;
      if (received >= expected) {
        cleanup();
        resolve({ data: Buffer.concat(chunks), chunks: chunks.length });
      }
    }
    function onError(err: Error) {
      cleanup();
      reject(new Error(`socket error after ${received} bytes: ${err.message}`));
    }
    function onClose() {
      cleanup();
      reject(new Error(`socket closed after ${received}/${expected} bytes`));
    }

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

export function makePayload(size: number): Buffer {
  const payload = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    payload[i] = (i * 31 + 7) & 0xff;
  }
  return payload;
}

/** Expects a connection attempt to fail with an 'error' event. */
export function expectConnectError(port: number, host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client: any = net.connect(port, host);
    client.once('connect', () => {
      client.destroy();
      reject(new Error(`connected to ${host}:${port}, expected an error`));
    });
    client.once('error', (err: Error) => resolve(err.message));
  });
}

/** Collects everything a socket receives as text, for raw HTTP exchanges. */
export function collectText(socket: any) {
  let text = '';
  let closed = false;
  let waiters: Array<{
    predicate: (text: string) => boolean;
    resolve: (text: string) => void;
    reject: (err: Error) => void;
  }> = [];

  socket.on('data', (chunk: Buffer) => {
    text += chunk.toString('latin1');
    waiters = waiters.filter(waiter => {
      if (waiter.predicate(text)) {
        waiter.resolve(text);
        return false;
      }
      return true;
    });
  });
  socket.on('close', () => {
    closed = true;
    const pending = waiters;
    waiters = [];
    pending.forEach(waiter =>
      waiter.reject(
        new Error(
          `socket closed before the expected data arrived, got: ${JSON.stringify(
            text.slice(0, 200),
          )}`,
        ),
      ),
    );
  });

  return {
    get text() {
      return text;
    },
    /** Resolves with the collected text once `predicate` accepts it. */
    until(predicate: (text: string) => boolean): Promise<string> {
      return new Promise((resolve, reject) => {
        if (predicate(text)) {
          resolve(text);
        } else if (closed) {
          reject(new Error('socket is already closed'));
        } else {
          waiters.push({ predicate, resolve, reject });
        }
      });
    },
  };
}

/** Counts non-overlapping occurrences of `needle` in `text`. */
export function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Runs gc() if the engine exposes it; returns whether it did. */
export function collectGarbage(): boolean {
  const gc = (globalThis as any).gc;
  if (typeof gc !== 'function') {
    return false;
  }
  gc();
  return true;
}

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

export type Status = 'running' | 'pass' | 'fail' | 'skip';

export interface StepResult {
  name: string;
  status: Status;
  detail: string;
  ms: number;
}

/** Thrown by a step that cannot run in this environment. */
export class SkipError extends Error {
  // Checked instead of `instanceof`, which is unreliable for subclasses of
  // Error once the class has been transpiled.
  public readonly isSkip = true;
}

export type Step = (
  name: string,
  fn: (log: Log) => Promise<string | void>,
  timeoutMs?: number,
) => Promise<void>;

const DEFAULT_STEP_TIMEOUT_MS = 10000;

export function createRunner(report: (result: StepResult) => void) {
  const counts = { passed: 0, failed: 0, skipped: 0 };

  const step: Step = async (name, fn, timeoutMs = DEFAULT_STEP_TIMEOUT_MS) => {
    const start = Date.now();
    const log: Log = message =>
      console.log(`${LOG_PREFIX} [${name}] +${Date.now() - start}ms ${message}`);

    report({ name, status: 'running', detail: '', ms: 0 });
    log('started');

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    try {
      const detail = (await Promise.race([fn(log), timeout])) ?? '';
      const ms = Date.now() - start;
      counts.passed++;
      console.log(`${LOG_PREFIX} PASS ${name} (${ms}ms) ${detail}`);
      report({ name, status: 'pass', detail, ms });
    } catch (err) {
      const ms = Date.now() - start;
      const detail = errorMessage(err);
      if ((err as any)?.isSkip === true) {
        counts.skipped++;
        console.warn(`${LOG_PREFIX} SKIP ${name} ${detail}`);
        report({ name, status: 'skip', detail, ms });
      } else {
        counts.failed++;
        console.error(`${LOG_PREFIX} FAIL ${name} (${ms}ms) ${detail}`);
        report({ name, status: 'fail', detail, ms });
      }
    } finally {
      clearTimeout(timer);
    }
  };

  return { step, counts };
}
