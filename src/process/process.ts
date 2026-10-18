// Our libuv timers on purpose, not queueMicrotask or React Native's timers:
// React Native pauses those while the app is in the background. setImmediate
// rather than setTimeout: it comes sooner, and before timers and the
// immediates set after it, which is closer to Node's nextTick.
import { setImmediate, clearImmediate } from '../timers';

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

export function cwd() {
  return '/';
}

export function chdir(dir: string): never {
  throw new Error('process.chdir is not supported');
}

export function umask() {
  return 0;
}
