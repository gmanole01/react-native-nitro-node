import assert from 'assert';

export * from './assert';
// Node's assert module is the assert function itself (with ok, strictEqual,
// AssertionError, ... on it), so the default export is too, and what
// packages get from require('assert') (see CALLABLE_MODULES in metro.js).
export default assert;
