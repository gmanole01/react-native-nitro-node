/**
 * Types shared by the modules, named and shaped like their Node counterparts.
 *
 * They are declared here rather than taken from @types/node so that the
 * public API does not depend on Node's global declarations.
 */

/** Node's BufferEncoding. */
export type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'utf-16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';

/** Node's NodeJS.ErrnoException: an Error from a system call. */
export interface ErrnoException extends Error {
  /** The libuv status, a negative number. */
  errno?: number;
  /** The error name, e.g. 'ECONNREFUSED' or 'ENOTFOUND'. */
  code?: string;
  path?: string;
  /** The operation that failed, e.g. 'connect' or 'getaddrinfo'. */
  syscall?: string;
}

/** An error from a DNS query. */
export interface DnsException extends ErrnoException {
  hostname?: string;
}

/** Node's net.AddressInfo. */
export interface AddressInfo {
  address: string;
  family: string;
  port: number;
}

// readable-stream 4 supports these options, but its typings
// (@types/readable-stream) do not declare them.
declare module 'readable-stream' {
  interface ReadableStateOptions {
    autoDestroy?: boolean;
    emitClose?: boolean;
  }
  interface WritableStateOptions {
    autoDestroy?: boolean;
    emitClose?: boolean;
  }
}
