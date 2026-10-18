
import { setImmediate } from './timers';

let WRITE_ID = 0;

export function generateWriteId() {
  return ++WRITE_ID;
}

/**
 * Runs `fn`, which calls a user's callback from a promise handler. An
 * exception it throws is rethrown on its own, so it is reported like any
 * uncaught error, as in Node, instead of rejecting the promise chain (where
 * it would be lost, or passed to the callback a second time).
 */
export function rethrowLater(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    setImmediate(() => {
      throw e;
    });
  }
}
