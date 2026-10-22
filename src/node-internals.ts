/**
 * What the ports of Node's own JS (zlib, util) take from Node's internals
 * (internal/errors, internal/validators, internal/util), with the same
 * messages.
 */

// internal/errors: kTypes and classRegExp, for ERR_INVALID_ARG_TYPE
const kTypes = ['string', 'function', 'number', 'object', 'Function', 'Object', 'boolean', 'bigint', 'symbol'];
const classRegExp = /^[A-Z][a-zA-Z0-9]*$/;

function formatList(array: string[], type = 'and'): string {
  switch (array.length) {
    case 0:
      return '';
    case 1:
      return `${array[0]}`;
    case 2:
      return `${array[0]} ${type} ${array[1]}`;
    case 3:
      return `${array[0]}, ${array[1]}, ${type} ${array[2]}`;
    default:
      return `${array.slice(0, -1).join(', ')}, ${type} ${array[array.length - 1]}`;
  }
}

function determineSpecificType(value: any): string {
  if (value === null) {
    return 'null';
  } else if (value === undefined) {
    return 'undefined';
  }
  const type = typeof value;
  switch (type) {
    case 'bigint':
      return `type bigint (${value}n)`;
    case 'number':
      if (value === 0) {
        return 1 / value === -Infinity ? 'type number (-0)' : 'type number (0)';
      } else if (value !== value) {
        return 'type number (NaN)';
      } else if (value === Infinity) {
        return 'type number (Infinity)';
      } else if (value === -Infinity) {
        return 'type number (-Infinity)';
      }
      return `type number (${value})`;
    case 'boolean':
      return value ? 'type boolean (true)' : 'type boolean (false)';
    case 'symbol':
      return `type symbol (${String(value)})`;
    case 'function':
      return `function ${value.name}`;
    case 'object':
      if (value.constructor && 'name' in value.constructor) {
        return `an instance of ${value.constructor.name}`;
      }
      // Node prints it with util.inspect
      return '[Object: null prototype]';
    case 'string':
      value.length > 28 && (value = `${value.slice(0, 25)}...`);
      if (value.indexOf("'") === -1) {
        return `type string ('${value}')`;
      }
      return `type string (${JSON.stringify(value)})`;
    default:
      return `type ${type} (${String(value)})`;
  }
}

function addNumericalSeparator(val: string): string {
  let res = '';
  let i = val.length;
  const start = val[0] === '-' ? 1 : 0;
  for (; i >= start + 4; i -= 3) {
    res = `_${val.slice(i - 3, i)}${res}`;
  }
  return `${val.slice(0, i)}${res}`;
}

// What util.inspect shows for the values these errors get
function inspect(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

function nodeError<T extends Error>(error: T, code: string): T {
  return Object.assign(error, { code });
}

export function ERR_INVALID_ARG_TYPE(name: string, expected: string | string[], actual: unknown): TypeError {
  const list = Array.isArray(expected) ? expected : [expected];
  let msg = 'The ';
  if (name.endsWith(' argument')) {
    msg += `${name} `;
  } else {
    const type = name.includes('.') ? 'property' : 'argument';
    msg += `"${name}" ${type} `;
  }
  msg += 'must be ';

  const types: string[] = [];
  const instances: string[] = [];
  const other: string[] = [];
  for (const value of list) {
    if (kTypes.includes(value)) {
      types.push(value.toLowerCase());
    } else if (classRegExp.exec(value) !== null) {
      instances.push(value);
    } else {
      other.push(value);
    }
  }
  if (instances.length > 0) {
    const pos = types.indexOf('object');
    if (pos !== -1) {
      types.splice(pos, 1);
      instances.push('Object');
    }
  }
  if (types.length > 0) {
    msg += `${types.length > 1 ? 'one of type' : 'of type'} ${formatList(types, 'or')}`;
    if (instances.length > 0 || other.length > 0) {
      msg += ' or ';
    }
  }
  if (instances.length > 0) {
    msg += `an instance of ${formatList(instances, 'or')}`;
    if (other.length > 0) {
      msg += ' or ';
    }
  }
  if (other.length > 0) {
    if (other.length > 1) {
      msg += `one of ${formatList(other, 'or')}`;
    } else {
      if (other[0]!.toLowerCase() !== other[0]) {
        msg += 'an ';
      }
      msg += `${other[0]}`;
    }
  }
  msg += `. Received ${determineSpecificType(actual)}`;
  return nodeError(new TypeError(msg), 'ERR_INVALID_ARG_TYPE');
}

export function ERR_OUT_OF_RANGE(str: string, range: string, input: unknown): RangeError {
  let received: string;
  if (Number.isInteger(input) && Math.abs(input as number) > 2 ** 32) {
    received = addNumericalSeparator(String(input));
  } else if (typeof input === 'bigint') {
    received = String(input);
    if (input > 2n ** 32n || input < -(2n ** 32n)) {
      received = addNumericalSeparator(received);
    }
    received += 'n';
  } else {
    received = inspect(input);
  }
  const msg = `The value of "${str}" is out of range. It must be ${range}. Received ${received}`;
  return nodeError(new RangeError(msg), 'ERR_OUT_OF_RANGE');
}

export function ERR_INVALID_URI(): URIError {
  return nodeError(new URIError('URI malformed'), 'ERR_INVALID_URI');
}

export function ERR_BUFFER_TOO_LARGE(max: number): RangeError {
  return nodeError(new RangeError(`Cannot create a Buffer larger than ${max} bytes`), 'ERR_BUFFER_TOO_LARGE');
}

export function ERR_TRAILING_JUNK_AFTER_STREAM_END(): TypeError {
  return nodeError(
    new TypeError('Trailing junk found after the end of the compressed stream'),
    'ERR_TRAILING_JUNK_AFTER_STREAM_END',
  );
}

export function ERR_BROTLI_INVALID_PARAM(param: string): RangeError {
  return nodeError(new RangeError(`${param} is not a valid Brotli parameter`), 'ERR_BROTLI_INVALID_PARAM');
}

export function ERR_ZSTD_INVALID_PARAM(param: string): RangeError {
  return nodeError(new RangeError(`${param} is not a valid zstd parameter`), 'ERR_ZSTD_INVALID_PARAM');
}

export function genericNodeError(message: string, errorProperties: object): Error {
  const err = new Error(message);
  Object.assign(err, errorProperties);
  return err;
}

// internal/validators

export function validateFunction(value: unknown, name: string): asserts value is Function {
  if (typeof value !== 'function') {
    throw ERR_INVALID_ARG_TYPE(name, 'Function', value);
  }
}

export function validateNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number') {
    throw ERR_INVALID_ARG_TYPE(name, 'number', value);
  }
}

export function validateBoolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw ERR_INVALID_ARG_TYPE(name, 'boolean', value);
  }
}

export function validateString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') {
    throw ERR_INVALID_ARG_TYPE(name, 'string', value);
  }
}

export const kValidateObjectNone = 0;
export const kValidateObjectAllowNullable = 1 << 0;
export const kValidateObjectAllowArray = 1 << 1;
export const kValidateObjectAllowFunction = 1 << 2;
export const kValidateObjectAllowObjects = kValidateObjectAllowArray | kValidateObjectAllowFunction;

export function validateObject(value: unknown, name: string, options = kValidateObjectNone): void {
  if (options === kValidateObjectNone) {
    if (value === null || Array.isArray(value)) {
      throw ERR_INVALID_ARG_TYPE(name, 'Object', value);
    }
    if (typeof value !== 'object') {
      throw ERR_INVALID_ARG_TYPE(name, 'Object', value);
    }
  } else {
    const nullable = (options & kValidateObjectAllowNullable) !== 0;
    if (!nullable && value === null) {
      throw ERR_INVALID_ARG_TYPE(name, 'Object', value);
    }
    if ((options & kValidateObjectAllowArray) === 0 && Array.isArray(value)) {
      throw ERR_INVALID_ARG_TYPE(name, 'Object', value);
    }
    const allowFunction = (options & kValidateObjectAllowFunction) !== 0;
    const type = typeof value;
    if (type !== 'object' && (!allowFunction || type !== 'function')) {
      throw ERR_INVALID_ARG_TYPE(name, 'Object', value);
    }
  }
}

export function validateUint32(value: unknown, name: string, positive = false): asserts value is number {
  if (typeof value !== 'number') {
    throw ERR_INVALID_ARG_TYPE(name, 'number', value);
  }
  if (!Number.isInteger(value)) {
    throw ERR_OUT_OF_RANGE(name, 'an integer', value);
  }
  const min = positive ? 1 : 0;
  const max = 4_294_967_295;
  if (value < min || value > max) {
    throw ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
  }
}

// false for undefined and NaN, true for finite numbers; throws for the rest
export function validateFiniteNumber(number: unknown, name: string): boolean {
  if (number === undefined) {
    return false;
  }
  if (Number.isFinite(number)) {
    return true;
  }
  if (Number.isNaN(number)) {
    return false;
  }
  validateNumber(number, name);
  throw ERR_OUT_OF_RANGE(name, 'a finite number', number);
}

// `def` for undefined or NaN, the number when it's in [lower, upper]
export function checkRangesOrGetDefault(
  number: unknown,
  name: string,
  lower: number,
  upper: number,
  def?: number,
): number {
  if (!validateFiniteNumber(number, name)) {
    return def as number;
  }
  if ((number as number) < lower || (number as number) > upper) {
    throw ERR_OUT_OF_RANGE(name, `>= ${lower} and <= ${upper}`, number);
  }
  return number as number;
}

// internal/util

const warned = new Set<string>();

/** Node's util.deprecate: `fn`, warning once (per code) when it's first used. */
export function deprecate<T extends (...args: any[]) => any>(fn: T, msg: string, code: string): T {
  return function (this: unknown, ...args: any[]) {
    if (!warned.has(code)) {
      warned.add(code);
      console.warn(`[${code}] DeprecationWarning: ${msg}`);
    }
    return fn.apply(this, args);
  } as T;
}

// internal/util/types

export function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

export function isAnyArrayBuffer(value: unknown): value is ArrayBuffer {
  return (
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)
  );
}

export function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

export function assert(value: unknown, message?: string): asserts value {
  if (!value) {
    throw nodeError(
      new Error(message ?? 'This is caused by either a bug in Node.js or incorrect usage of Node.js internals.'),
      'ERR_INTERNAL_ASSERTION',
    );
  }
}
