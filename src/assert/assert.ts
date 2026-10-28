import assert from 'assert';

// The npm package is CommonJS (module.exports = assert), so its functions are
// re-exported one by one, each typed as declared: TypeScript only narrows
// with assertion functions (ok, strictEqual, ...) that have explicit types

export const AssertionError = assert.AssertionError;
export const deepEqual: typeof assert.deepEqual = assert.deepEqual;
export const deepStrictEqual: typeof assert.deepStrictEqual =
  assert.deepStrictEqual;
export const doesNotMatch: typeof assert.doesNotMatch = assert.doesNotMatch;
export const doesNotReject: typeof assert.doesNotReject = assert.doesNotReject;
export const doesNotThrow: typeof assert.doesNotThrow = assert.doesNotThrow;
export const equal: typeof assert.equal = assert.equal;
export const fail: typeof assert.fail = assert.fail;
export const ifError: typeof assert.ifError = assert.ifError;
export const match: typeof assert.match = assert.match;
export const notDeepEqual: typeof assert.notDeepEqual = assert.notDeepEqual;
export const notDeepStrictEqual: typeof assert.notDeepStrictEqual =
  assert.notDeepStrictEqual;
export const notEqual: typeof assert.notEqual = assert.notEqual;
export const notStrictEqual: typeof assert.notStrictEqual =
  assert.notStrictEqual;
export const ok: typeof assert.ok = assert.ok;
export const rejects: typeof assert.rejects = assert.rejects;
export const strict: typeof assert.strict = assert.strict;
export const strictEqual: typeof assert.strictEqual = assert.strictEqual;
export const throws: typeof assert.throws = assert.throws;
