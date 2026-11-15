import assert, {
  AssertionError,
  deepStrictEqual,
  rejects,
  strict,
  strictEqual,
  throws,
} from 'react-native-nitro-node/assert';
import { type Step } from './testUtils';

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(
        expected,
      )}`,
    );
  }
}

/** The AssertionError `fn` throws, as [code, message]. */
function failure(label: string, fn: () => unknown): [string, string] {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof AssertionError)) {
      throw new Error(
        `${label}: threw ${String(err)}, expected an AssertionError`,
      );
    }
    return [err.code, err.message];
  }
  throw new Error(`${label}: did not throw`);
}

export async function runAssertTests(step: Step) {
  await step(
    "assert: passes, and fails with Node's AssertionError",
    async () => {
      assert(true);
      assert.ok(1);
      strictEqual(1, 1);
      deepStrictEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] });
      strict.equal('x', 'x');
      throws(() => {
        throw new TypeError('bad');
      }, TypeError);
      await rejects(Promise.reject(new Error('no')), /no/);

      expectEqual(
        'strictEqual',
        failure('strictEqual', () => strictEqual(1, 2)),
        ['ERR_ASSERTION', 'Expected values to be strictly equal:\n\n1 !== 2\n'],
      );
      expectEqual(
        'strict.equal',
        failure('strict.equal', () => strict.equal('1', 1)),
        [
          'ERR_ASSERTION',
          "Expected values to be strictly equal:\n\n'1' !== 1\n",
        ],
      );
      const [, deep] = failure('deepStrictEqual', () =>
        deepStrictEqual({ a: 1 }, { a: 2 }),
      );
      expectEqual(
        'deepStrictEqual',
        deep.split('\n')[0],
        'Expected values to be strictly deep-equal:',
      );
      expectEqual(
        'message',
        failure('ok', () => assert.ok(false, 'custom')),
        ['ERR_ASSERTION', 'custom'],
      );
      expectEqual('default export', assert.strictEqual, strictEqual);
      return 'ok, strictEqual, deepStrictEqual, throws, rejects';
    },
  );
}
