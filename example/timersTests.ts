import * as timers from 'react-native-nitro-node/timers';
import timersDefault, {
  clearImmediate,
  clearInterval,
  clearTimeout,
  setImmediate,
  setInterval,
  setTimeout,
} from 'react-native-nitro-node/timers';
import process from 'react-native-nitro-node/process';
import * as fs from 'react-native-nitro-node/fs';
import { type Step, delay, expectThrow } from './testUtils';

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

/** Resolves once `fn` has filled `log` with `count` entries, or after `ms`. */
async function settle(log: unknown[], count: number, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (log.length < count && Date.now() < until) {
    await delay(5);
  }
  // a little longer, for anything that would wrongly come after
  await delay(30);
}

/**
 * Runs `fn` with React Native's global error handler replaced, and returns
 * the errors it got: what a callback that throws ends up as.
 */
async function catchGlobalErrors(fn: () => void, wait: number): Promise<string[]> {
  const ErrorUtils = (globalThis as any).ErrorUtils;
  if (!ErrorUtils?.setGlobalHandler) {
    throw new Error('ErrorUtils is not available');
  }
  const previous = ErrorUtils.getGlobalHandler();
  const errors: string[] = [];
  ErrorUtils.setGlobalHandler((error: Error) => errors.push(error?.message));
  try {
    fn();
    await delay(wait);
  } finally {
    ErrorUtils.setGlobalHandler(previous);
  }
  return errors;
}

/** timers and process: the library's libuv timers, nextTick, and the Metro redirects. */
export async function runTimersTests(step: Step) {
  await step('timers: exports and argument checks', async () => {
    expectEqual('default.setTimeout', timersDefault.setTimeout, timers.setTimeout);
    expectEqual('named setImmediate', setImmediate, timers.setImmediate);
    // not React Native's globals
    if (setTimeout === (globalThis as any).setTimeout || setImmediate === (globalThis as any).setImmediate) {
      throw new Error('timers re-exports the global timers');
    }
    for (const [label, fn] of [
      ['setTimeout(5)', () => setTimeout(5 as any)],
      ['setInterval(null)', () => setInterval(null as any)],
      ['setImmediate("x")', () => setImmediate('x' as any)],
    ] as const) {
      expectThrow(label, 'TypeError', fn);
      try {
        fn();
      } catch (err: any) {
        expectEqual(`${label} code`, err.code, 'ERR_INVALID_ARG_TYPE');
      }
    }
    // clearing anything else is a no-op
    clearTimeout(undefined);
    clearTimeout(null);
    clearInterval({} as any);
    clearImmediate(undefined);
    clearImmediate(setTimeout(() => {}, 1) as any);
  });

  await step('setTimeout: arguments, this, and on time', async () => {
    const start = Date.now();
    const [args, self, elapsed] = await new Promise<[unknown[], unknown, number]>(resolve => {
      const timer: timers.Timeout = setTimeout(
        function (this: unknown, a: number, b: string) {
          resolve([[a, b], this === timer, Date.now() - start]);
        },
        50,
        1,
        'two',
      );
    });
    expectEqual('arguments', JSON.stringify(args), '[1,"two"]');
    expectEqual('this is the Timeout', self, true);
    // libuv counts whole milliseconds: allow 2 ms early, and a slow device late
    if (elapsed < 48 || elapsed > 250) {
      throw new Error(`fired after ${elapsed} ms, expected about 50`);
    }
    return `fired after ${elapsed} ms`;
  });

  await step('setTimeout: deadline order, and same deadlines in order set', async () => {
    const log: string[] = [];
    setTimeout(() => log.push('60'), 60);
    setTimeout(() => log.push('20'), 20);
    setTimeout(() => log.push('40'), 40);
    setTimeout(() => log.push('0'));
    setTimeout(() => log.push('a'), 30);
    setTimeout(() => log.push('b'), 30);
    setTimeout(() => log.push('c'), 30);
    await settle(log, 7);
    expectEqual('order', log.join(','), '0,20,a,b,c,40,60');
  });

  await step('setTimeout: odd delays fire right away, as in Node', async () => {
    const log: string[] = [];
    const start = Date.now();
    setTimeout(() => log.push('negative'), -10);
    setTimeout(() => log.push('NaN'), NaN);
    setTimeout(() => log.push('string'), '5' as any);
    await settle(log, 3);
    const elapsed = Date.now() - start;
    expectEqual('all fired', log.length, 3);
    if (elapsed > 300) {
      throw new Error(`took ${elapsed} ms`);
    }
  });

  await step('clearTimeout: by Timeout, by number, by string', async () => {
    const log: string[] = [];
    const a = setTimeout(() => log.push('a'), 20);
    const b = setTimeout(() => log.push('b'), 20);
    const c = setTimeout(() => log.push('c'), 20);
    setTimeout(() => log.push('kept'), 20);
    clearTimeout(a);
    const id = +b;
    if (typeof id !== 'number') {
      throw new Error('+timer is not a number');
    }
    clearTimeout(id);
    clearTimeout(String(+c));
    await settle(log, 1, 200);
    expectEqual('fired', log.join(','), 'kept');
  });

  await step('Timeout: refresh(), close(), hasRef()', async () => {
    let runs = 0;
    const timer = setTimeout(() => runs++, 60);
    await delay(40);
    timer.refresh(); // now due 60 ms from here
    await delay(40);
    expectEqual('not yet, after refresh()', runs, 0);
    await delay(80);
    expectEqual('fired once', runs, 1);
    timer.refresh(); // runs it again
    await delay(120);
    expectEqual('ran again after refresh()', runs, 2);
    timer.close();
    timer.refresh();
    await delay(120);
    expectEqual('nothing after close()', runs, 2);

    const id = +timer;
    const again = setTimeout(() => runs++, 30);
    const againId = +again;
    await delay(60); // fired
    again.refresh();
    clearTimeout(againId); // the number still cancels it once refreshed
    await delay(60);
    expectEqual('cleared by number after refresh()', runs, 3);
    expectEqual('ids differ', id === againId, false);

    expectEqual('hasRef()', timer.hasRef(), true);
    expectEqual('unref().hasRef()', timer.unref().hasRef(), false);
    expectEqual('ref().hasRef()', timer.ref().hasRef(), true);
  });

  await step('setInterval: ticks, and clearInterval from its callback', async () => {
    const start = Date.now();
    const ticks: number[] = [];
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        ticks.push(Date.now() - start);
        if (ticks.length === 5) {
          clearInterval(interval);
          resolve();
        }
      }, 20);
    });
    await delay(80);
    expectEqual('ticks', ticks.length, 5);
    if (ticks[4]! < 95) {
      throw new Error(`5 ticks of 20 ms after ${ticks[4]} ms`);
    }
    return `ticks at ${ticks.join(', ')} ms`;
  });

  await step('setInterval: clearInterval from outside, and by number', async () => {
    let a = 0;
    let b = 0;
    const first = setInterval(() => a++, 10);
    const second = setInterval(() => b++, 10);
    await delay(60);
    clearInterval(first);
    clearInterval(+second);
    const [stoppedA, stoppedB] = [a, b];
    await delay(60);
    if (stoppedA < 2 || stoppedB < 2) {
      throw new Error(`only ${stoppedA} and ${stoppedB} ticks in 60 ms`);
    }
    expectEqual('no ticks after clearInterval', `${a},${b}`, `${stoppedA},${stoppedB}`);
  });

  await step('setImmediate: order, arguments, this, and clearImmediate', async () => {
    const log: string[] = [];
    let self = false;
    const immediate: timers.Immediate = setImmediate(function (this: unknown, x: string) {
      self = this === immediate;
      log.push(x);
    }, 'first');
    setImmediate(() => {
      log.push('second');
      // set while the batch runs: waits for the next one
      setImmediate(() => log.push('next batch'));
      clearImmediate(later);
    });
    const later = setImmediate(() => log.push('cleared during its batch'));
    setImmediate(() => log.push('third'));
    clearImmediate(setImmediate(() => log.push('cleared before')));
    await settle(log, 4);
    expectEqual('order', log.join(','), 'first,second,third,next batch');
    expectEqual('this is the Immediate', self, true);
  });

  await step('setImmediate: comes before timers, and fast', async () => {
    const log: string[] = [];
    setTimeout(() => log.push('timeout'), 0);
    setImmediate(() => log.push('immediate'));
    await settle(log, 2);
    expectEqual('order', log.join(','), 'immediate,timeout');

    const start = Date.now();
    let n = 0;
    await new Promise<void>(resolve => {
      const next = () => (++n === 1000 ? resolve() : setImmediate(next));
      setImmediate(next);
    });
    const ms = Date.now() - start;
    if (ms > 3000) {
      throw new Error(`1000 chained immediates took ${ms} ms`);
    }
    return `1000 chained immediates in ${ms} ms`;
  }, 15000);

  await step('timers: 2000 at once all fire', async () => {
    let fired = 0;
    for (let i = 0; i < 1000; i++) {
      setTimeout(() => fired++, i % 50);
      setImmediate(() => fired++);
    }
    const cleared = setTimeout(() => (fired = -1e6), 10);
    clearTimeout(cleared);
    const until = Date.now() + 5000;
    while (fired < 2000 && Date.now() < until) {
      await delay(10);
    }
    expectEqual('fired', fired, 2000);
  });

  await step('timers: Symbol.dispose clears', async () => {
    if (typeof (Symbol as any).dispose !== 'symbol') {
      return 'no Symbol.dispose in this runtime';
    }
    const log: string[] = [];
    const timer = setTimeout(() => log.push('timeout'), 10);
    const immediate = setImmediate(() => log.push('immediate'));
    (timer as any)[(Symbol as any).dispose]();
    (immediate as any)[(Symbol as any).dispose]();
    await delay(50);
    expectEqual('nothing fired', log.length, 0);
  });

  await step('process.nextTick: order, arguments, and against timers', async () => {
    const log: string[] = [];
    process.nextTick((a: number, b: number) => log.push(`args ${a + b}`), 1, 2);
    process.nextTick(() => {
      log.push('b');
      process.nextTick(() => log.push('nested'));
    });
    log.push('sync');
    await settle(log, 4);
    expectEqual('order', log.join(','), 'sync,args 3,b,nested');

    // as in Node: before timers and before immediates set after it
    const order: string[] = [];
    setTimeout(() => order.push('timeout'), 0);
    process.nextTick(() => order.push('tick'));
    setImmediate(() => order.push('immediate'));
    await settle(order, 3);
    expectEqual('against timers', order.join(','), 'tick,immediate,timeout');
  });

  await step('process: the browser stand-in', async () => {
    if (!Array.isArray(process.argv) || typeof process.env !== 'object') {
      throw new Error('argv or env has the wrong type');
    }
    expectEqual('cwd()', process.cwd(), '/');
    expectEqual('umask()', process.umask(), 0);
    expectEqual('title', process.title, 'browser');
    expectEqual('listeners()', process.listeners('x').length, 0);
    expectThrow('chdir()', 'Error', () => process.chdir('/tmp'));
  });

  await step("Metro: the app's own imports are left alone by default", async () => {
    // without includeAppCode, the app's 'process' is the npm package
    const appProcess = require('process');
    if (typeof appProcess.nextTick !== 'function') {
      throw new Error("the app's require('process') has no nextTick");
    }
    if (appProcess.nextTick === process.nextTick) {
      throw new Error("the app's require('process') was redirected");
    }
  });

  await step('callbacks that throw reach the error handler once', async () => {
    const errors = await catchGlobalErrors(() => {
      setTimeout(() => {
        throw new Error('from setTimeout');
      }, 1);
      setImmediate(() => {
        throw new Error('from setImmediate');
      });
      process.nextTick(() => {
        throw new Error('from nextTick');
      });
      fs.stat('/', () => {
        throw new Error('from fs.stat');
      });
      fs.access('/definitely/missing', () => {
        throw new Error('from fs.access');
      });
    }, 300);
    expectEqual(
      'errors',
      errors.sort().join(', '),
      'from fs.access, from fs.stat, from nextTick, from setImmediate, from setTimeout',
    );
    // and the queues still work afterwards
    const log: string[] = [];
    setImmediate(() => log.push('immediate'));
    process.nextTick(() => log.push('tick'));
    setTimeout(() => log.push('timeout'), 1);
    await settle(log, 3);
    expectEqual('after the errors', log.sort().join(','), 'immediate,tick,timeout');
  });
}
