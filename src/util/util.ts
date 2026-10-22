/**
 * Node's util, in part. From Node 22, ported: promisify() (with
 * promisify.custom), inspect() (with InspectOptions, inspect.custom and
 * inspect.defaultOptions), format() / formatWithOptions(), isDeepStrictEqual()
 * and types.isProxy(). The rest (inherits, deprecate, debuglog, callbackify,
 * the other types.is*() and the old is*() helpers) is the npm `util`
 * package's, which packages got for require('util') before.
 */
import npmUtil from 'util';
import { validateFunction } from '../node-internals';
import { isDeepStrictEqual as isDeepStrictEqualImpl } from './comparisons';
import {
  format as formatImpl,
  formatWithOptions as formatWithOptionsImpl,
  inspect as inspectImpl,
} from './inspect';
import { isPromise, isProxy } from './internals';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Node's util.InspectOptions. */
export interface InspectOptions {
  /** Show non-enumerable properties and symbols, and WeakMap/WeakSet entries. Default false. */
  showHidden?: boolean;
  /** How many levels deep objects are shown; null for all. Default 2. */
  depth?: number | null;
  /** Use ANSI colors. Default false. */
  colors?: boolean;
  /** Call [util.inspect.custom](depth, options, inspect) on objects that have it. Default true. */
  customInspect?: boolean;
  /** Show a Proxy's target and handler. Default false. */
  showProxy?: boolean;
  /** Most array, Set, Map, ... entries shown; null for all. Default 100. */
  maxArrayLength?: number | null;
  /** Most characters of a string shown; null for all. Default 10000. */
  maxStringLength?: number | null;
  /** Line length where entries get split onto several lines. Default 80. */
  breakLength?: number;
  /** false: every property on its own line; a number: how many inner levels fit on one line. Default 3. */
  compact?: boolean | number;
  /** Sort keys: true, or a compare function. Default false. */
  sorted?: boolean | ((a: string, b: string) => number);
  /** Show getters' values: true, 'get' (only getters) or 'set' (getters with a setter). Default false. */
  getters?: 'get' | 'set' | boolean;
  /** Underscores every three digits of numbers and bigints. Default false. */
  numericSeparator?: boolean;
}

export type InspectStyle =
  | 'special'
  | 'number'
  | 'bigint'
  | 'boolean'
  | 'undefined'
  | 'null'
  | 'string'
  | 'symbol'
  | 'date'
  | 'regexp'
  | 'module'
  | 'name';

export interface InspectStylizer {
  (value: string, style: InspectStyle): string;
}

/** The options a custom inspect function ([inspect.custom]) gets. */
export interface InspectOptionsStylized extends InspectOptions {
  stylize: InspectStylizer;
}

export interface Inspect {
  (object: any, showHidden?: boolean, depth?: number | null, color?: boolean): string;
  (object: any, options?: InspectOptions): string;
  /** The symbol of a custom inspect function: Symbol.for('nodejs.util.inspect.custom'). */
  readonly custom: unique symbol;
  /** The defaults of every inspect() call, to change in place. */
  defaultOptions: InspectOptions;
  /** ANSI codes of the colors, by name: [open, close]. */
  colors: Record<string, [number, number]>;
  /** The color of each kind of value, by style. */
  styles: Record<InspectStyle, string>;
  /** Node 22: replaces the default colors with its own scheme. Read-only here as in Node. */
  replDefaults?: InspectOptions;
}

/** Node's util.inspect(): a string representation of any value, for debugging. */
export const inspect = inspectImpl as unknown as Inspect;

/** Node's util.format(): printf-like formatting (%s, %d, %i, %f, %j, %o, %O, %c, %%). */
export const format = formatImpl as (format?: any, ...args: any[]) => string;

/** Node's util.formatWithOptions(): format() with inspect() options. */
export const formatWithOptions = formatWithOptionsImpl as (
  inspectOptions: InspectOptions,
  format?: any,
  ...args: any[]
) => string;

/** Node's util.isDeepStrictEqual(): assert.deepStrictEqual() as a boolean. */
export const isDeepStrictEqual = isDeepStrictEqualImpl as (val1: unknown, val2: unknown) => boolean;

// ---- promisify, from Node's lib/internal/util.js ----

const kCustomPromisifiedSymbol = Symbol.for('nodejs.util.promisify.custom');
const kCustomPromisifyArgsSymbol = Symbol('customPromisifyArgs');

export interface CustomPromisifySymbol<TCustom extends Function> extends Function {
  [promisify.custom]: TCustom;
}
export type CustomPromisify<TCustom extends Function> = CustomPromisifySymbol<TCustom>;

export function promisify<TCustom extends Function>(fn: CustomPromisify<TCustom>): TCustom;
export function promisify<TResult>(fn: (callback: (err: any, result: TResult) => void) => void): () => Promise<TResult>;
export function promisify(fn: (callback: (err?: any) => void) => void): () => Promise<void>;
export function promisify<T1, TResult>(
  fn: (arg1: T1, callback: (err: any, result: TResult) => void) => void,
): (arg1: T1) => Promise<TResult>;
export function promisify<T1>(fn: (arg1: T1, callback: (err?: any) => void) => void): (arg1: T1) => Promise<void>;
export function promisify<T1, T2, TResult>(
  fn: (arg1: T1, arg2: T2, callback: (err: any, result: TResult) => void) => void,
): (arg1: T1, arg2: T2) => Promise<TResult>;
export function promisify<T1, T2>(
  fn: (arg1: T1, arg2: T2, callback: (err?: any) => void) => void,
): (arg1: T1, arg2: T2) => Promise<void>;
export function promisify<T1, T2, T3, TResult>(
  fn: (arg1: T1, arg2: T2, arg3: T3, callback: (err: any, result: TResult) => void) => void,
): (arg1: T1, arg2: T2, arg3: T3) => Promise<TResult>;
export function promisify<T1, T2, T3>(
  fn: (arg1: T1, arg2: T2, arg3: T3, callback: (err?: any) => void) => void,
): (arg1: T1, arg2: T2, arg3: T3) => Promise<void>;
export function promisify(fn: Function): Function;
export function promisify(original: any): any {
  validateFunction(original, 'original');

  if (original[kCustomPromisifiedSymbol]) {
    const fn = original[kCustomPromisifiedSymbol];

    validateFunction(fn, 'util.promisify.custom');

    return Object.defineProperty(fn, kCustomPromisifiedSymbol, {
      value: fn,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }

  // Names to create an object from in case the callback receives multiple
  // arguments, e.g. ['bytesRead', 'buffer'] for fs.read.
  const argumentNames = original[kCustomPromisifyArgsSymbol];

  function fn(this: unknown, ...args: any[]) {
    return new Promise((resolve, reject) => {
      args.push((err: unknown, ...values: unknown[]) => {
        if (err) {
          return reject(err);
        }
        if (argumentNames !== undefined && values.length > 1) {
          const obj: Record<string, unknown> = {};
          for (let i = 0; i < argumentNames.length; i++) obj[argumentNames[i]] = values[i];
          resolve(obj);
        } else {
          resolve(values[0]);
        }
      });
      if (isPromise(Reflect.apply(original, this, args))) {
        // Node's process.emitWarning()
        console.warn(
          '[DEP0174] DeprecationWarning: Calling promisify on a function that returns a Promise is likely a mistake.',
        );
      }
    });
  }

  Object.setPrototypeOf(fn, Object.getPrototypeOf(original));

  Object.defineProperty(fn, kCustomPromisifiedSymbol, {
    value: fn,
    enumerable: false,
    writable: false,
    configurable: true,
  });

  const descriptors = Object.getOwnPropertyDescriptors(original);
  const propertiesValues = Object.values(descriptors);
  for (let i = 0; i < propertiesValues.length; i++) {
    // We want to use null-prototype objects to not rely on globally mutable
    // %Object.prototype%.
    Object.setPrototypeOf(propertiesValues[i], null);
  }
  return Object.defineProperties(fn, descriptors);
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace promisify {
  /** Symbol.for('nodejs.util.promisify.custom'): a function's own promise version. */
  const custom: unique symbol;
}
Object.defineProperty(promisify, 'custom', {
  value: kCustomPromisifiedSymbol,
  enumerable: false,
  writable: false,
  configurable: false,
});

// ---- types ----

type NpmTypes = Record<string, (value: unknown) => boolean>;

/**
 * Node's util.types: isProxy() is Node's, for proxies made after
 * react-native-nitro-node/polyfill ran (see ./proxies); the others are the npm
 * `util` package's.
 */
export const types: NpmTypes & { isProxy(value: unknown): boolean } = {
  ...((npmUtil as any).types as NpmTypes),
  isProxy,
};

// ---- the rest: the npm util package ----

const npm = npmUtil as any;

export const inherits: (constructor: Function, superConstructor: Function) => void = npm.inherits;
export const deprecate: <T extends Function>(fn: T, message: string, code?: string) => T = npm.deprecate;
export const debuglog: (section: string) => ((message: string, ...args: any[]) => void) & { enabled?: boolean } =
  npm.debuglog;
export const debug = debuglog;
export const callbackify: (fn: (...args: any[]) => Promise<any>) => (...args: any[]) => void = npm.callbackify;
/** @deprecated Node: use console.log with a timestamp. */
export const log: (...args: any[]) => void = npm.log;
/** @deprecated Node: use Object.assign(). */
export const _extend: (target: object, source: object) => object = npm._extend;
/** @deprecated Node: use Array.isArray(). */
export const isArray: (value: unknown) => value is unknown[] = npm.isArray;
/** @deprecated */
export const isBoolean: (value: unknown) => value is boolean = npm.isBoolean;
/** @deprecated */
export const isNull: (value: unknown) => value is null = npm.isNull;
/** @deprecated */
export const isNullOrUndefined: (value: unknown) => value is null | undefined = npm.isNullOrUndefined;
/** @deprecated */
export const isNumber: (value: unknown) => value is number = npm.isNumber;
/** @deprecated */
export const isString: (value: unknown) => value is string = npm.isString;
/** @deprecated */
export const isSymbol: (value: unknown) => value is symbol = npm.isSymbol;
/** @deprecated */
export const isUndefined: (value: unknown) => value is undefined = npm.isUndefined;
/** @deprecated */
export const isRegExp: (value: unknown) => value is RegExp = npm.isRegExp;
/** @deprecated */
export const isObject: (value: unknown) => boolean = npm.isObject;
/** @deprecated */
export const isDate: (value: unknown) => value is Date = npm.isDate;
/** @deprecated */
export const isError: (value: unknown) => value is Error = npm.isError;
/** @deprecated */
export const isFunction: (value: unknown) => boolean = npm.isFunction;
/** @deprecated */
export const isPrimitive: (value: unknown) => boolean = npm.isPrimitive;
/** @deprecated */
export const isBuffer: (value: unknown) => boolean = npm.isBuffer;
