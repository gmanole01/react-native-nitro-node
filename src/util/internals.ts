/**
 * What Node's util code (./inspect, ./comparisons) gets from V8 through
 * internalBinding('util') and internal/util/types, done in JavaScript. The
 * type checks are brand checks where JavaScript has one (a Map method that
 * throws on anything but a Map, ...), so look-alikes aren't taken for the
 * real thing. Where Hermes gives JavaScript no way in, they say so:
 *
 * - a promise's state: getPromiseDetails() returns kUnknown,
 * - a Map or Set iterator's entries, which can't be read without consuming
 *   them: previewEntries() returns undefined,
 * - a proxy's target: only known for proxies made after the polyfill set up
 *   their tracking (see ./proxies).
 */
import { Buffer } from 'buffer';
import { proxyDetails } from './proxies';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const objectToString = Object.prototype.toString;
const tagOf = (value: unknown) => objectToString.call(value);
const isObjectLike = (value: unknown): value is object =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';

/** true when `check(value)` doesn't throw: the built-in's own brand check. */
function brand(check: (value: Any) => unknown) {
  return (value: unknown): boolean => {
    if (!isObjectLike(value)) {
      return false;
    }
    try {
      check(value);
      return true;
    } catch {
      return false;
    }
  };
}

function getterOf(proto: object, key: PropertyKey): (this: unknown) => unknown {
  return Object.getOwnPropertyDescriptor(proto, key)!.get!;
}

const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayTag = getterOf(TypedArrayPrototype, Symbol.toStringTag);
const arrayBufferByteLength = getterOf(ArrayBuffer.prototype, 'byteLength');
const sharedArrayBufferByteLength =
  typeof SharedArrayBuffer !== 'undefined' ? getterOf(SharedArrayBuffer.prototype, 'byteLength') : undefined;
const dataViewByteLength = getterOf(DataView.prototype, 'byteLength');
const regExpSource = getterOf(RegExp.prototype, 'source');

// ---- internal/util/types ----

export const isMap = brand(v => Map.prototype.has.call(v, undefined));
export const isSet = brand(v => Set.prototype.has.call(v, undefined));
export const isWeakMap = brand(v => WeakMap.prototype.has.call(v, {}));
export const isWeakSet = brand(v => WeakSet.prototype.has.call(v, {}));
export const isDate = brand(v => Date.prototype.getTime.call(v));
// RegExp.prototype itself has a source ('(?:)'), but isn't a RegExp
export const isRegExp = (v: unknown) => v !== RegExp.prototype && brand(r => regExpSource.call(r))(v);
export const isArrayBuffer = brand(v => arrayBufferByteLength.call(v));
export const isSharedArrayBuffer = (v: unknown) =>
  sharedArrayBufferByteLength !== undefined && brand(b => sharedArrayBufferByteLength.call(b))(v);
export const isAnyArrayBuffer = (v: unknown) => isArrayBuffer(v) || isSharedArrayBuffer(v);
export const isDataView = brand(v => dataViewByteLength.call(v));
export const isArrayBufferView = (v: unknown) => ArrayBuffer.isView(v);
export const isTypedArray = (v: unknown) => isObjectLike(v) && typedArrayTag.call(v) !== undefined;
const isTypedArrayOf = (name: string) => (v: unknown) => isObjectLike(v) && typedArrayTag.call(v) === name;
export const isFloat16Array = isTypedArrayOf('Float16Array');
export const isFloat32Array = isTypedArrayOf('Float32Array');
export const isFloat64Array = isTypedArrayOf('Float64Array');
export const isNumberObject = (v: unknown) => typeof v === 'object' && brand(n => Number.prototype.valueOf.call(n))(v);
export const isStringObject = (v: unknown) => typeof v === 'object' && brand(s => String.prototype.valueOf.call(s))(v);
export const isBooleanObject = (v: unknown) =>
  typeof v === 'object' && brand(b => Boolean.prototype.valueOf.call(b))(v);
export const isBigIntObject = (v: unknown) =>
  typeof v === 'object' && typeof BigInt !== 'undefined' && brand(b => BigInt.prototype.valueOf.call(b))(v);
export const isSymbolObject = (v: unknown) => typeof v === 'object' && brand(s => Symbol.prototype.valueOf.call(s))(v);
export const isBoxedPrimitive = (v: unknown) =>
  isNumberObject(v) || isStringObject(v) || isBooleanObject(v) || isBigIntObject(v) || isSymbolObject(v);
export const isNativeError = (v: unknown) => isObjectLike(v) && tagOf(v) === '[object Error]';
export const isPromise = (v: unknown) => v instanceof Promise || (isObjectLike(v) && tagOf(v) === '[object Promise]');
export const isMapIterator = (v: unknown) => isObjectLike(v) && tagOf(v) === '[object Map Iterator]';
export const isSetIterator = (v: unknown) => isObjectLike(v) && tagOf(v) === '[object Set Iterator]';
export const isArgumentsObject = (v: unknown) => isObjectLike(v) && tagOf(v) === '[object Arguments]';
// Only native ones: Babel turns async functions and generators into plain functions
export const isAsyncFunction = (v: unknown) =>
  typeof v === 'function' && ['[object AsyncFunction]', '[object AsyncGeneratorFunction]'].includes(tagOf(v));
export const isGeneratorFunction = (v: unknown) =>
  typeof v === 'function' && ['[object GeneratorFunction]', '[object AsyncGeneratorFunction]'].includes(tagOf(v));
export const isModuleNamespaceObject = (v: unknown) =>
  isObjectLike(v) && Object.getPrototypeOf(v) === null && tagOf(v) === '[object Module]';
// No native external values in JavaScript
export const isExternal = (_v: unknown) => false;
// A proxy the polyfill saw being made
export const isProxy = (v: unknown) => proxyDetails(v) !== undefined;

/** A KeyObject of this library's crypto (by its class name, to not load crypto here). */
export function isKeyObject(v: unknown): boolean {
  if (!isObjectLike(v)) {
    return false;
  }
  for (let proto = Object.getPrototypeOf(v); proto; proto = Object.getPrototypeOf(proto)) {
    if (proto.constructor?.name === 'KeyObject') {
      return true;
    }
  }
  return false;
}
// WebCrypto keys are compared by their properties
export const isCryptoKey = (_v: unknown) => false;

// ---- internalBinding('util') ----

// V8's PropertyFilter and Node's promise states
export const constants = {
  ALL_PROPERTIES: 0,
  ONLY_ENUMERABLE: 2,
  SKIP_SYMBOLS: 16,
  kPending: 0,
  kFulfilled: 1,
  kRejected: 2,
};

/** Not one of Node's states: the state can't be read on Hermes. */
export const kUnknown = -1;

const isArrayIndex = (key: string) => /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < 2 ** 32 - 1;

export function getOwnNonIndexProperties(object: object, filter: number): PropertyKey[] {
  return Reflect.ownKeys(object).filter(key => {
    if (typeof key === 'string' && isArrayIndex(key)) {
      return false;
    }
    if ((filter & constants.SKIP_SYMBOLS) !== 0 && typeof key === 'symbol') {
      return false;
    }
    if ((filter & constants.ONLY_ENUMERABLE) !== 0 && !Object.prototype.propertyIsEnumerable.call(object, key)) {
      return false;
    }
    return true;
  });
}

export function getPromiseDetails(_promise: unknown): [number, unknown?] {
  return [kUnknown];
}

export function getProxyDetails(value: unknown, full: boolean): unknown {
  const details = proxyDetails(value);
  if (details === undefined) {
    return undefined;
  }
  return full ? [details.target, details.handler] : details.target;
}

export function previewEntries(_value: unknown, _isIterator?: boolean): undefined {
  return undefined;
}

/** V8's constructor name of an object: the tag's name, as close as JavaScript gets. */
export function getConstructorName(object: object): string {
  const tag = tagOf(object).slice(8, -1);
  return tag || 'Object';
}

export function getExternalValue(_value: unknown): bigint {
  return 0n;
}

// ---- internal/util, internal/errors, internal/url ----

export const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom');

export function isError(e: unknown): boolean {
  return isNativeError(e) || e instanceof Error;
}

export function join(output: string[], separator: string): string {
  let str = '';
  if (output.length !== 0) {
    const lastIndex = output.length - 1;
    for (let i = 0; i < lastIndex; i++) {
      // It is faster not to use a template string here
      str += output[i];
      str += separator;
    }
    str += output[lastIndex];
  }
  return str;
}

const colorRegExp = /\u001b\[\d\d?m/g; // eslint-disable-line no-control-regex

export function removeColors(str: string): string {
  return str.replace(colorRegExp, '');
}

/** Node compares with an overflow it caused; Hermes' message is the same as V8's. */
export function isStackOverflowError(err: unknown): boolean {
  return err instanceof RangeError && /Maximum call stack size exceeded/.test(err.message);
}

/** No Node core modules in a React Native stack trace. */
export const BuiltinModule = { exists: (_name: string) => false };

export function isURL(value: Any): boolean {
  const URLClass = (globalThis as Any).URL;
  return typeof value?.href === 'string' && typeof URLClass === 'function' && value instanceof URLClass;
}

export function pathToFileUrlHref(filepath: string): string {
  return `file://${encodeURI(filepath)}`;
}

/** Buffer's hexSlice(): the bytes [start, end) of a Uint8Array as hex. */
export function hexSlice(bytes: Uint8Array, start: number, end: number): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex', start, end);
}

/** internalBinding('buffer').compare */
export function compare(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) {
      return a[i]! < b[i]! ? -1 : 1;
    }
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}
