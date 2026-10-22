/** The Node errors of lib/internal/url.js and lib/url.js, with Node's messages. */
import { inspect } from '../util/inspect';

/* eslint-disable @typescript-eslint/no-explicit-any */

function nodeError<T extends Error>(error: T, code: string, props?: object): T {
  return Object.assign(error, { code }, props);
}

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

// `new ERR_X(...)` works on these too: a function returning an object
export function ERR_ARG_NOT_ITERABLE(name: string): TypeError {
  return nodeError(new TypeError(`${name} must be iterable`), 'ERR_ARG_NOT_ITERABLE');
}

export function ERR_INVALID_ARG_VALUE(name: string, value: unknown, reason = 'is invalid'): TypeError {
  let inspected: string = (inspect as any)(value);
  if (inspected.length > 128) {
    inspected = `${inspected.slice(0, 128)}...`;
  }
  const type = name.includes('.') ? 'property' : 'argument';
  return nodeError(new TypeError(`The ${type} '${name}' ${reason}. Received ${inspected}`), 'ERR_INVALID_ARG_VALUE');
}

export function ERR_INVALID_FILE_URL_HOST(platform: string): TypeError {
  return nodeError(
    new TypeError(`File URL host must be "localhost" or empty on ${platform}`),
    'ERR_INVALID_FILE_URL_HOST',
  );
}

export function ERR_INVALID_FILE_URL_PATH(reason: string, input?: unknown): TypeError {
  return nodeError(new TypeError(`File URL path ${reason}`), 'ERR_INVALID_FILE_URL_PATH', { input });
}

export function ERR_INVALID_THIS(type: string): TypeError {
  return nodeError(new TypeError(`Value of "this" must be of type ${type}`), 'ERR_INVALID_THIS');
}

export function ERR_INVALID_TUPLE(name: string, type: string): TypeError {
  return nodeError(new TypeError(`${name} must be an iterable ${type} tuple`), 'ERR_INVALID_TUPLE');
}

export function ERR_INVALID_URL(input: unknown, base: unknown = null): TypeError {
  // Don't include URL in message. (See https://github.com/nodejs/node/pull/38614)
  return nodeError(new TypeError('Invalid URL'), 'ERR_INVALID_URL', base != null ? { input, base } : { input });
}

export function ERR_INVALID_URL_SCHEME(expected: string | string[]): TypeError {
  const list = typeof expected === 'string' ? [expected] : expected;
  const res = list.length === 2 ? `one of scheme ${list[0]} or ${list[1]}` : `of scheme ${list[0]}`;
  return nodeError(new TypeError(`The URL must be ${res}`), 'ERR_INVALID_URL_SCHEME');
}

export function ERR_MISSING_ARGS(...args: Array<string | string[]>): TypeError {
  const wrap = (a: string) => `"${a}"`;
  const names = args.map(a => (Array.isArray(a) ? a.map(wrap).join(' or ') : wrap(a)));
  const msg = `The ${formatList(names)} argument${args.length > 1 ? 's' : ''} must be specified`;
  return nodeError(new TypeError(msg), 'ERR_MISSING_ARGS');
}

export function ERR_NO_CRYPTO(): Error {
  return nodeError(new Error('Node.js is not compiled with OpenSSL crypto support'), 'ERR_NO_CRYPTO');
}

export { ERR_INVALID_ARG_TYPE } from '../node-internals';
