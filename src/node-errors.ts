/**
 * Node errors with Node's messages, the ones that need inspect() (see
 * ./node-internals for the rest), and the validators built on them.
 */
import { inspect } from './util/inspect';
import { uvCode } from './errors';
import { uv_strerror } from './uv';
import { ERR_INVALID_ARG_TYPE, determineSpecificType } from './node-internals';

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

export { ERR_INVALID_ARG_TYPE };

/** internal/validators: `value` has to be one of `oneOf`. */
export function validateOneOf(value: unknown, name: string, oneOf: readonly unknown[]): void {
  if (!oneOf.includes(value)) {
    const allowed = oneOf.map(v => (typeof v === 'string' ? `'${v}'` : String(v))).join(', ');
    throw ERR_INVALID_ARG_VALUE(name, value, 'must be one of: ' + allowed);
  }
}

export function ERR_BUFFER_OUT_OF_BOUNDS(name?: string): RangeError {
  const msg = name ? `"${name}" is outside of buffer bounds` : 'Attempt to access memory outside buffer bounds';
  return nodeError(new RangeError(msg), 'ERR_BUFFER_OUT_OF_BOUNDS');
}

export function ERR_INVALID_FD_TYPE(type: string): TypeError {
  return nodeError(new TypeError(`Unsupported fd type: ${type}`), 'ERR_INVALID_FD_TYPE');
}

export function ERR_IP_BLOCKED(ip: string): Error {
  return nodeError(new Error(`IP(${ip}) is blocked by net.BlockList`), 'ERR_IP_BLOCKED');
}

export function ERR_SOCKET_ALREADY_BOUND(): Error {
  return nodeError(new Error('Socket is already bound'), 'ERR_SOCKET_ALREADY_BOUND');
}

export function ERR_SOCKET_BAD_BUFFER_SIZE(): TypeError {
  return nodeError(new TypeError('Buffer size must be a positive integer'), 'ERR_SOCKET_BAD_BUFFER_SIZE');
}

export function ERR_SOCKET_BAD_PORT(name: string, port: unknown, allowZero = true): RangeError {
  const operator = allowZero ? '>=' : '>';
  const msg = `${name} should be ${operator} 0 and < 65536. Received ${determineSpecificType(port)}.`;
  return nodeError(new RangeError(msg), 'ERR_SOCKET_BAD_PORT');
}

export function ERR_SOCKET_BAD_TYPE(): TypeError {
  return nodeError(
    new TypeError('Bad socket type specified. Valid types are: udp4, udp6'),
    'ERR_SOCKET_BAD_TYPE',
  );
}

export function ERR_SOCKET_DGRAM_IS_CONNECTED(): Error {
  return nodeError(new Error('Already connected'), 'ERR_SOCKET_DGRAM_IS_CONNECTED');
}

export function ERR_SOCKET_DGRAM_NOT_CONNECTED(): Error {
  return nodeError(new Error('Not connected'), 'ERR_SOCKET_DGRAM_NOT_CONNECTED');
}

export function ERR_SOCKET_DGRAM_NOT_RUNNING(): Error {
  return nodeError(new Error('Not running'), 'ERR_SOCKET_DGRAM_NOT_RUNNING');
}

/** What Node's C++ collects about a failed libuv call (CollectUVExceptionInfo). */
export interface UVExceptionInfo {
  errno: number;
  code: string;
  message: string;
  syscall: string;
}

/** Fills `ctx` as Node's CollectUVExceptionInfo does. */
export function collectUVExceptionInfo(ctx: Partial<UVExceptionInfo>, status: number, syscall: string): void {
  ctx.errno = status;
  ctx.code = uvCode(status);
  ctx.message = uv_strerror(status);
  ctx.syscall = syscall;
}

/** A SystemError, as Node's for ERR_SOCKET_BUFFER_SIZE: the libuv call's details in `info`. */
export function ERR_SOCKET_BUFFER_SIZE(ctx: UVExceptionInfo): Error {
  const msg = `Could not get or set buffer size: ${ctx.syscall} returned ${ctx.code} (${ctx.message})`;
  const error = nodeError(new Error(msg), 'ERR_SOCKET_BUFFER_SIZE', {
    info: ctx,
    errno: ctx.errno,
    syscall: ctx.syscall,
  });
  error.name = 'SystemError';
  return error;
}

/** internal/errors' ErrnoException: "syscall CODE", with errno, code and syscall. */
export function ErrnoException(err: number, syscall: string, original?: string): Error {
  const code = uvCode(err);
  const message = original ? `${syscall} ${code} ${original}` : `${syscall} ${code}`;
  return Object.assign(new Error(message), { errno: err, code, syscall });
}

/** internal/errors' ExceptionWithHostPort: "syscall CODE address:port". */
export function ExceptionWithHostPort(
  err: number,
  syscall: string,
  address: string,
  port?: number,
  additional?: string,
): Error {
  const code = uvCode(err);
  let details = '';
  if (port && port > 0) {
    details = ` ${address}:${port}`;
  } else if (address) {
    details = ` ${address}`;
  }
  if (additional) {
    details += ` - Local (${additional})`;
  }
  const error = Object.assign(new Error(`${syscall} ${code}${details}`), { errno: err, code, syscall, address });
  if (port) {
    Object.assign(error, { port });
  }
  return error;
}

/** internal/validators' isInt32. */
export function isInt32(value: unknown): value is number {
  return value === ((value as number) | 0);
}

/** internal/validators' validatePort: a port number, or a string of one. */
export function validatePort(port: unknown, name = 'Port', allowZero = true): number {
  if (
    (typeof port !== 'number' && typeof port !== 'string') ||
    (typeof port === 'string' && port.trim().length === 0) ||
    +port !== +port >>> 0 ||
    +port > 0xffff ||
    (port === 0 && !allowZero)
  ) {
    throw ERR_SOCKET_BAD_PORT(name, port, allowZero);
  }
  return (port as number) | 0;
}

/** internal/validators' validateAbortSignal. */
export function validateAbortSignal(signal: unknown, name: string): void {
  if (signal !== undefined && (signal === null || typeof signal !== 'object' || !('aborted' in signal))) {
    throw ERR_INVALID_ARG_TYPE(name, 'AbortSignal', signal);
  }
}
