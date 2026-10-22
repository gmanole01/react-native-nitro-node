import util, {
  type InspectOptionsStylized,
  format,
  inspect,
  isDeepStrictEqual,
  promisify,
  types,
} from 'react-native-nitro-node/util';
import { Buffer } from 'buffer';
import { type Step, expectThrow } from './testUtils';

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

const circular: Record<string, unknown> = { name: 'c' };
circular.self = circular;

// What Node 22's util.inspect() and util.format() give for these
const NODE: Array<[string, () => string, string]> = [
  [
    'object',
    () => inspect({ a: 1, 'b-c': 'two', nested: { arr: [1, 2, 3], deeper: { x: { y: 1 } } } }),
    "{\n  a: 1,\n  'b-c': 'two',\n  nested: { arr: [ 1, 2, 3 ], deeper: { x: [Object] } }\n}",
  ],
  ['array', () => inspect([1, 'two', [3, [4, [5, [6]]]], null, undefined]), "[ 1, 'two', [ 3, [ 4, [Array] ] ], null, undefined ]"],
  ['map', () => inspect(new Map<string, unknown>([['k', 'v'], ['o', { a: 1 }]])), "Map(2) { 'k' => 'v', 'o' => { a: 1 } }"],
  ['set', () => inspect(new Set([1, 'a'])), "Set(2) { 1, 'a' }"],
  ['circular', () => inspect(circular), "<ref *1> { name: 'c', self: [Circular *1] }"],
  ['date', () => inspect(new Date(0)), '1970-01-01T00:00:00.000Z'],
  ['regexp', () => inspect(/ab+c/gi), '/ab+c/gi'],
  ['typed array', () => inspect(new Uint8Array([1, 2, 3])), 'Uint8Array(3) [ 1, 2, 3 ]'],
  ['Buffer', () => inspect(Buffer.from('hey')), '<Buffer 68 65 79>'],
  ['strings', () => inspect(["it's", 'a\nb', 'x'.repeat(3)]), "[ \"it's\", 'a\\nb', 'xxx' ]"],
  ['numbers', () => inspect([-0, 1.5, NaN, BigInt(10)]), '[ -0, 1.5, NaN, 10n ]'],
  ['numericSeparator', () => inspect([1234567, 1234.5678], { numericSeparator: true }), '[ 1_234_567, 1_234.567_8 ]'],
  ['depth 0', () => inspect({ a: { b: 1 } }, { depth: 0 }), '{ a: [Object] }'],
  ['compact: false', () => inspect({ a: [1, 2] }, { compact: false }), '{\n  a: [\n    1,\n    2\n  ]\n}'],
  ['breakLength', () => inspect({ alpha: 1, beta: 2, gamma: 3 }, { breakLength: 10 }), '{\n  alpha: 1,\n  beta: 2,\n  gamma: 3\n}'],
  ['sorted', () => inspect({ b: 1, a: 2, c: 3 }, { sorted: true }), '{ a: 2, b: 1, c: 3 }'],
  ['colors', () => inspect({ n: 1, s: 'x' }, { colors: true }), "{ n: \u001b[33m1\u001b[39m, s: \u001b[32m'x'\u001b[39m }"],
  ['maxArrayLength', () => inspect([1, 2, 3, 4], { maxArrayLength: 2 }), '[ 1, 2, ... 2 more items ]'],
  ['null prototype', () => inspect(Object.assign(Object.create(null), { x: 1 })), '[Object: null prototype] { x: 1 }'],
  [
    'long array',
    () => inspect(Array.from({ length: 30 }, (_, i) => i)),
    '[\n   0,  1,  2,  3,  4,  5,  6,  7,  8,\n   9, 10, 11, 12, 13, 14, 15, 16, 17,\n  18, 19, 20, 21, 22, 23, 24, 25, 26,\n  27, 28, 29\n]',
  ],
  ['format', () => format('%s=%d %j %o %%', 'n', 42, { a: 1 }, [1]), 'n=42 {"a":1} [ 1, [length]: 1 ] %'],
  ['format, extra arguments', () => format('a', 1, { x: 1 }), 'a 1 { x: 1 }'],
];

export async function runUtilTests(step: Step) {
  await step('util.inspect() and util.format(): Node\'s output', async log => {
    const failures: string[] = [];
    for (const [label, run, expected] of NODE) {
      const actual = run();
      if (actual !== expected) {
        failures.push(`${label}: ${JSON.stringify(actual)}`);
      }
    }
    if (failures.length > 0) {
      failures.forEach(f => log(f));
      throw new Error(`${failures.length} of ${NODE.length} differ: ${failures[0]}`);
    }
    return `${NODE.length} values`;
  });

  await step('util.inspect(): custom inspect, options, defaults', async () => {
    const custom = {
      [inspect.custom](depth: number, options: InspectOptionsStylized, insp: typeof inspect) {
        return `Custom<${depth}, ${typeof options.stylize}, ${insp === inspect}>`;
      },
    };
    expectEqual('inspect.custom', inspect.custom, Symbol.for('nodejs.util.inspect.custom'));
    expectEqual('custom', inspect({ a: custom }), '{ a: Custom<1, function, true> }');
    expectEqual('customInspect: false', inspect(custom, { customInspect: false }).startsWith('{'), true);
    expectEqual('legacy arguments', inspect({ a: { b: 1 } }, false, 0, false), '{ a: [Object] }');
    expectEqual('defaultOptions', inspect.defaultOptions.depth, 2);
    expectThrow('defaultOptions = 5', 'TypeError', () => {
      (inspect as any).defaultOptions = 5;
    });
    // What Hermes can't show
    expectEqual('a promise', inspect(Promise.resolve(1)), 'Promise { <unknown> }');
    expectEqual('a Map iterator', inspect(new Map([[1, 2]]).keys()), '[Map Iterator] { <items unknown> }');
    return 'custom inspect, legacy arguments, defaults';
  });

  await step('util.isDeepStrictEqual(), as Node', async () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = {};
    b.self = b;
    const cases: Array<[string, unknown, unknown, boolean]> = [
      ['objects', { a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }, true],
      ['1 and "1"', { a: 1 }, { a: '1' }, false],
      ['array order', [1, 2], [2, 1], false],
      ['Maps', new Map([[1, { x: 1 }]]), new Map([[1, { x: 1 }]]), true],
      ['Maps, other values', new Map([[1, 2]]), new Map([[1, 3]]), false],
      ['Sets of objects', new Set([{ a: 1 }]), new Set([{ a: 1 }]), true],
      ['Dates', new Date(0), new Date(0), true],
      ['other Dates', new Date(0), new Date(1), false],
      ['RegExps', /a/g, /a/i, false],
      ['NaN', NaN, NaN, true],
      ['0 and -0', 0, -0, false],
      ['Buffers', Buffer.from('ab'), Buffer.from('ab'), true],
      ['other typed arrays', new Uint8Array([1]), new Uint16Array([1]), false],
      ['prototypes', Object.create(null), {}, false],
      ['cycles', a, b, true],
      ['errors', new Error('x'), new TypeError('x'), false],
      ['holes', [1, , 3], [1, undefined, 3], false], // eslint-disable-line no-sparse-arrays
      ['boxed', new Number(1), 1, false],
      ['undefined property', { a: undefined }, {}, false],
    ];
    for (const [label, x, y, expected] of cases) {
      expectEqual(label, isDeepStrictEqual(x, y), expected);
    }
    return `${cases.length} cases`;
  });

  await step('util.promisify(), as Node', async () => {
    const double = promisify((x: number, cb: (err: Error | null, r?: number) => void) => setTimeout(() => cb(null, x * 2), 1));
    expectEqual('result', await double(21), 42);
    const failing = promisify((cb: (err: Error) => void) => cb(new Error('boom')));
    expectEqual('rejection', await failing().catch((e: Error) => e.message), 'boom');

    const withCustom = Object.assign(() => {}, { [promisify.custom]: () => 'custom' });
    expectEqual('promisify.custom', promisify(withCustom)(), 'custom');
    expectEqual('the same function twice', promisify(double as any), double);
    const err: any = (() => {
      try {
        promisify(5 as any);
      } catch (e) {
        return e;
      }
    })();
    expectEqual('not a function', [err?.code, err?.message], [
      'ERR_INVALID_ARG_TYPE',
      'The "original" argument must be of type function. Received type number (5)',
    ]);
    return 'callbacks, errors, custom';
  });

  await step('util.types.isProxy() and the npm util functions', async () => {
    // the polyfill (imported first in index.js) tracks the proxies made since
    const target = {};
    const proxy = new Proxy(target, {});
    expectEqual('a proxy', types.isProxy(proxy), true);
    expectEqual('Proxy.revocable', types.isProxy(Proxy.revocable({}, {}).proxy), true);
    expectEqual('its target', types.isProxy(target), false);
    expectEqual('Proxy itself', types.isProxy(Proxy), false);
    expectEqual('showProxy', inspect(proxy, { showProxy: true }), 'Proxy [ {}, {} ]');

    // the rest is the npm util package's
    function Parent() {}
    function Child() {}
    util.inherits(Child, Parent);
    expectEqual('inherits', Object.getPrototypeOf(Child.prototype), Parent.prototype);
    expectEqual('types.isMap', types.isMap!(new Map()), true);
    expectEqual('default export', util.inspect, inspect);
    return 'proxies tracked, npm util kept';
  });
}
