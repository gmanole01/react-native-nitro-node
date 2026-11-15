// Our libuv timers on purpose, not queueMicrotask or React Native's timers:
// React Native pauses those while the app is in the background. setImmediate
// rather than setTimeout: it comes sooner, and before timers and the
// immediates set after it, which is closer to Node's nextTick.
import { setImmediate, clearImmediate } from '../timers';
import { NitroUv } from '../native';
import { fsError } from '../errors';
import { validateString } from '../node-internals';

let queue: Item[] = [];
let draining = false;
let currentQueue: Item[] | null = null;
let queueIndex = -1;

function cleanUpNextTick() {
  if (!draining || !currentQueue) {
    return;
  }
  draining = false;
  if (currentQueue.length) {
    queue = currentQueue.concat(queue);
  } else {
    queueIndex = -1;
  }
  if (queue.length) {
    drainQueue();
  }
}

function drainQueue() {
  if (draining) {
    return;
  }
  var immediate = setImmediate(cleanUpNextTick);
  draining = true;

  var len = queue.length;
  while (len) {
    currentQueue = queue;
    queue = [];
    while (++queueIndex < len) {
      if (currentQueue) {
        currentQueue[queueIndex].run();
      }
    }
    queueIndex = -1;
    len = queue.length;
  }
  currentQueue = null;
  draining = false;
  clearImmediate(immediate);
}

export function nextTick<TArgs extends unknown[]>(
  fun: (...args: TArgs) => void,
  ...args: TArgs
) {
  queue.push(new Item(fun, args));

  if (queue.length === 1 && !draining) {
    setImmediate(drainQueue);
  }
}

class Item {
  private fun: (...args: any[]) => void;
  private array: any[];

  constructor(fun: (...args: any[]) => void, array: any[]) {
    this.fun = fun;
    this.array = array;
  }

  public run() {
    this.fun.apply(null, this.array);
  }
}

export const title = 'browser';
export const browser = true;
export const env: Record<string, string | undefined> = {};
export const argv: string[] = [];
export const version = '';
export const versions: Record<string, string> = {};

export function on() {}
export function addListener() {}
export function once() {}
export function off() {}
export function removeListener() {}
export function removeAllListeners() {}
export function emit() {}
export function prependListener() {}
export function prependOnceListener() {}

export function listeners(name: string): Function[] {
  return [];
}

export function binding(name: string): never {
  throw new Error('process.binding is not supported');
}

/**
 * The process's current directory, as Node's. On iOS, Android and macOS it
 * starts as the app's data directory (src/native/index.ts moves there).
 */
export function cwd(): string {
  try {
    return NitroUv.uv_cwd();
  } catch (e) {
    const match = /\[errno (-?\d+)\]/.exec(e instanceof Error ? e.message : String(e));
    if (match === null) {
      throw e;
    }
    throw fsError('uv_cwd', Number(match[1]));
  }
}

/**
 * Changes the process's current directory, as Node's: for fs's relative
 * paths, path.resolve() and cwd().
 */
export function chdir(directory: string): void {
  validateString(directory, 'directory');
  const status = NitroUv.uv_chdir(directory);
  if (status < 0) {
    // As Node's: "ENOENT: no such file or directory, chdir '/cwd' -> 'dir'"
    const error = fsError('chdir', status, cwd());
    error.message += ` -> '${directory}'`;
    error.dest = directory;
    throw error;
  }
}

export function umask() {
  return 0;
}
