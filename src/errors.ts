import { ERRORS, uv_strerror } from './uv';
import type { DnsException, ErrnoException } from './types';

// libuv status -> error name ('ECONNREFUSED'), built on first use.
let uvCodes: Map<number, string> | null = null;

function uvCode(status: number): string | undefined {
  if (!uvCodes) {
    uvCodes = new Map();
    for (const [name, value] of Object.entries(ERRORS)) {
      // the same status can have two names (UV_EOF has no UV_E prefix)
      if (!uvCodes.has(value)) {
        uvCodes.set(value, name.replace(/^UV_/, ''));
      }
    }
  }
  return uvCodes.get(status);
}

/**
 * Builds an error from a libuv status, e.g. "connect: connection refused" with
 * `code` 'ECONNREFUSED'. `errno` is the libuv status.
 */
export function uvError(syscall: string, status: number): ErrnoException {
  let reason: string;
  try {
    reason = uv_strerror(status);
  } catch {
    // not a status libuv knows about
    reason = `error ${status}`;
  }

  const error: ErrnoException = new Error(`${syscall}: ${reason}`);
  error.errno = status;
  error.code = uvCode(status);
  error.syscall = syscall;
  return error;
}

/** An error shaped like Node's DNS errors, e.g. "queryA ENOTFOUND host". */
export function dnsError(
  code: string,
  syscall: string,
  hostname: string,
): DnsException {
  const error: DnsException = new Error(`${syscall} ${code} ${hostname}`);
  error.code = code;
  error.syscall = syscall;
  error.hostname = hostname;
  return error;
}

/**
 * An error shaped like Node's fs errors, e.g. "ENOENT: no such file or
 * directory, open '/a/b'". `status` is the libuv status (the negated errno).
 */
export function fsError(
  syscall: string,
  status: number,
  path?: string,
): ErrnoException {
  const error = uvError(syscall, status);
  const code = error.code ?? `Unknown system error ${status}`;
  const reason = error.message.slice(syscall.length + 2);
  error.message =
    path === undefined
      ? `${code}: ${reason}, ${syscall}`
      : `${code}: ${reason}, ${syscall} '${path}'`;
  if (path !== undefined) {
    error.path = path;
  }
  return error;
}
