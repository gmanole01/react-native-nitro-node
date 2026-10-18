import { Buffer } from 'buffer';
import { NitroFs, NitroFsConstants } from '../native';
import type { StatFs } from '../native';
import { fsError } from '../errors';
import { setImmediate } from '../timers';
import type { BufferEncoding, ErrnoException } from '../types';

export type { StatFs };

/** Node's fs.constants, with this platform's values. */
export interface Constants {
  O_RDONLY: number;
  O_WRONLY: number;
  O_RDWR: number;
  O_CREAT: number;
  O_EXCL: number;
  O_NOCTTY: number;
  O_TRUNC: number;
  O_APPEND: number;
  O_NOFOLLOW: number;
  O_SYNC: number;
  O_DSYNC: number;
  O_NONBLOCK: number;
  /** Not on Android. */
  O_SYMLINK?: number;
  /** Not on every platform. */
  O_DIRECTORY?: number;
  /** Not on iOS. */
  O_NOATIME?: number;
  /** Not on iOS. */
  O_DIRECT?: number;
  S_IRWXU: number;
  S_IRUSR: number;
  S_IWUSR: number;
  S_IXUSR: number;
  S_IRWXG: number;
  S_IRGRP: number;
  S_IWGRP: number;
  S_IXGRP: number;
  S_IRWXO: number;
  S_IROTH: number;
  S_IWOTH: number;
  S_IXOTH: number;
  F_OK: number;
  R_OK: number;
  W_OK: number;
  X_OK: number;
}

const CONSTANT_NAMES: (keyof Constants)[] = [
  'O_RDONLY',
  'O_WRONLY',
  'O_RDWR',
  'O_CREAT',
  'O_EXCL',
  'O_NOCTTY',
  'O_TRUNC',
  'O_APPEND',
  'O_NOFOLLOW',
  'O_SYNC',
  'O_DSYNC',
  'O_NONBLOCK',
  'O_SYMLINK',
  'O_DIRECTORY',
  'O_NOATIME',
  'O_DIRECT',
  'S_IRWXU',
  'S_IRUSR',
  'S_IWUSR',
  'S_IXUSR',
  'S_IRWXG',
  'S_IRGRP',
  'S_IWGRP',
  'S_IXGRP',
  'S_IRWXO',
  'S_IROTH',
  'S_IWOTH',
  'S_IXOTH',
  'F_OK',
  'R_OK',
  'W_OK',
  'X_OK',
];

function readConstants(): Constants {
  const result: Partial<Constants> = {};
  for (const name of CONSTANT_NAMES) {
    const value = NitroFsConstants[name];
    // native gives -1 for a constant this platform does not have
    if (value !== -1) {
      result[name] = value;
    }
  }
  return Object.freeze(result) as Constants;
}

export const constants: Constants = readConstants();

export const F_OK = constants.F_OK;
export const R_OK = constants.R_OK;
export const W_OK = constants.W_OK;
export const X_OK = constants.X_OK;

/** A path: a string, or a `file:` URL. */
export type PathLike = string | URL;

/** Node's open() flags: 'r', 'w+', 'ax', ..., or a number of O_* bits. */
export type OpenMode = string | number;

/** Bytes that can be written: a Buffer or any other typed array or DataView. */
export type BinaryData = ArrayBufferView;

type Callback = (err: ErrnoException | null) => void;
type ResultCallback<T> = (err: ErrnoException | null, result: T) => void;

/**
 * The path of a file: URL, as Node's fileURLToPath(). It parses the string
 * itself: React Native's URL class only parses http(s) URLs, and its
 * `pathname` is '/' for any file: URL.
 */
function fileURLToPath(href: string): string {
  const match = /^file:\/\/([^/?#]*)([^?#]*)/i.exec(href);
  if (!match) {
    throw new TypeError(`The URL must be of scheme file: ${href}`);
  }
  const [, host, pathname] = match;
  if (host !== '' && host!.toLowerCase() !== 'localhost') {
    throw new TypeError(`File URL host must be "localhost" or empty: ${href}`);
  }
  if (/%2f/i.test(pathname!)) {
    throw new TypeError(`File URL path must not include encoded / characters: ${href}`);
  }
  return decodeURIComponent(pathname!);
}

function toPath(path: PathLike): string {
  if (typeof path === 'string') {
    // React Native APIs often hand out file:// strings, so they are accepted
    // too, unlike in Node
    return path.startsWith('file://') ? fileURLToPath(path) : path;
  }
  if (typeof URL !== 'undefined' && path instanceof URL) {
    return fileURLToPath(path.href);
  }
  throw new TypeError('path must be a string or a file: URL');
}

/** The O_* bits of Node's string flags, as in Node's stringToFlags(). */
function toFlags(flags: OpenMode | undefined, defaultFlags: string): number {
  if (typeof flags === 'number') {
    return flags;
  }
  const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC, O_APPEND, O_SYNC } =
    constants;
  switch (flags ?? defaultFlags) {
    case 'r':
      return O_RDONLY;
    case 'rs':
    case 'sr':
      return O_RDONLY | O_SYNC;
    case 'r+':
      return O_RDWR;
    case 'rs+':
    case 'sr+':
      return O_RDWR | O_SYNC;
    case 'w':
      return O_TRUNC | O_CREAT | O_WRONLY;
    case 'wx':
    case 'xw':
      return O_TRUNC | O_CREAT | O_WRONLY | O_EXCL;
    case 'w+':
      return O_TRUNC | O_CREAT | O_RDWR;
    case 'wx+':
    case 'xw+':
      return O_TRUNC | O_CREAT | O_RDWR | O_EXCL;
    case 'a':
      return O_APPEND | O_CREAT | O_WRONLY;
    case 'ax':
    case 'xa':
      return O_APPEND | O_CREAT | O_WRONLY | O_EXCL;
    case 'as':
    case 'sa':
      return O_APPEND | O_CREAT | O_WRONLY | O_SYNC;
    case 'a+':
      return O_APPEND | O_CREAT | O_RDWR;
    case 'ax+':
    case 'xa+':
      return O_APPEND | O_CREAT | O_RDWR | O_EXCL;
    case 'as+':
    case 'sa+':
      return O_APPEND | O_CREAT | O_RDWR | O_SYNC;
  }
  throw new TypeError(`Invalid flags: ${String(flags)}`);
}

function toMode(mode: number | string | undefined, defaultMode: number): number {
  if (mode === undefined) {
    return defaultMode;
  }
  if (typeof mode === 'string') {
    // Node accepts octal strings, e.g. '755'
    return parseInt(mode, 8);
  }
  return mode;
}

/** -1, the native code for "at the current offset", for a null position. */
function toPosition(position: number | null | undefined): number {
  return position === null || position === undefined ? -1 : position;
}

/** Throws the error of a failed numeric call, else returns its result. */
function check(status: number, syscall: string, path?: string): number {
  if (status < 0) {
    throw fsError(syscall, status, path);
  }
  return status;
}

/** The error of a native call that threw or rejected with "[errno N]". */
function toFsError(error: unknown, syscall: string, path?: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const match = /\[errno (-?\d+)\]/.exec(message);
  return match ? fsError(syscall, Number(match[1]), path) : error;
}

/** Runs a throwing native call, turning its error into an fs error. */
function call<T>(syscall: string, path: string | undefined, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw toFsError(e, syscall, path);
  }
}

function requireCallback(callback: unknown): void {
  if (typeof callback !== 'function') {
    throw new TypeError('The "callback" argument must be of type function');
  }
}

/**
 * Calls `callback` with the result of `fn` or its error, after the current
 * task: Node's fs callbacks never run synchronously.
 */
function later<T>(callback: ResultCallback<T>, fn: () => T): void {
  setImmediate(() => {
    let result: T;
    try {
      result = fn();
    } catch (e) {
      callback(e as ErrnoException, undefined as T);
      return;
    }
    callback(null, result);
  });
}

function bytesOf(data: string | BinaryData, encoding?: BufferEncoding | null): BinaryData {
  return typeof data === 'string' ? Buffer.from(data, encoding ?? 'utf8') : data;
}

function decode(buffer: Buffer, encoding: BufferEncoding | null | undefined): Buffer | string {
  return encoding ? buffer.toString(encoding) : buffer;
}

// --- open / close -----------------------------------------------------------

export function openSync(path: PathLike, flags?: OpenMode, mode?: number | string): number {
  const p = toPath(path);
  return check(NitroFs.open(p, toFlags(flags, 'r'), toMode(mode, 0o666)), 'open', p);
}

export function open(path: PathLike, callback: ResultCallback<number>): void;
export function open(path: PathLike, flags: OpenMode | undefined, callback: ResultCallback<number>): void;
export function open(
  path: PathLike,
  flags: OpenMode | undefined,
  mode: number | string | undefined | null,
  callback: ResultCallback<number>,
): void;
export function open(path: PathLike, ...args: unknown[]): void {
  const callback = args.pop() as ResultCallback<number>;
  requireCallback(callback);
  const [flags, mode] = args as [OpenMode | undefined, number | string | undefined];
  later(callback, () => openSync(path, flags, mode ?? undefined));
}

export function closeSync(fd: number): void {
  check(NitroFs.close(fd), 'close');
}

export function close(fd: number, callback?: Callback): void {
  later<void>(callback ?? (() => {}), () => closeSync(fd));
}

export function ftruncateSync(fd: number, len: number = 0): void {
  check(NitroFs.ftruncate(fd, len), 'ftruncate');
}

export function ftruncate(fd: number, callback: Callback): void;
export function ftruncate(fd: number, len: number | undefined, callback: Callback): void;
export function ftruncate(fd: number, len: number | Callback | undefined, callback?: Callback): void {
  if (typeof len === 'function') {
    callback = len;
    len = 0;
  }
  requireCallback(callback);
  later<void>(callback!, () => ftruncateSync(fd, len as number | undefined));
}

// --- read / write -------------------------------------------------------------

/** The most bytes one read or write may ask for, as in Node: 2 GiB - 1. */
const MAX_IO_LENGTH = 0x7fffffff;

function validateRange(buffer: BinaryData, offset: number, length: number): void {
  if (length > MAX_IO_LENGTH) {
    throw new RangeError(`length (${length}) must be at most ${MAX_IO_LENGTH}`);
  }
  if (offset < 0 || length < 0 || offset + length > buffer.byteLength) {
    throw new RangeError(
      `offset (${offset}) and length (${length}) must be within the buffer (${buffer.byteLength} bytes)`,
    );
  }
}

/**
 * Reads up to `length` bytes into `buffer` at `offset`, from `position` or,
 * when it is null, from the current file offset. Returns the bytes read.
 */
export function readSync(
  fd: number,
  buffer: BinaryData,
  offset: number = 0,
  length: number = buffer.byteLength - offset,
  position: number | null = null,
): number {
  validateRange(buffer, offset, length);
  return check(
    NitroFs.readSync(
      fd,
      buffer.buffer as ArrayBuffer,
      buffer.byteOffset + offset,
      length,
      toPosition(position),
    ),
    'read',
  );
}

export function read<T extends BinaryData>(
  fd: number,
  buffer: T,
  offset: number,
  length: number,
  position: number | null,
  callback: (err: ErrnoException | null, bytesRead: number, buffer: T) => void,
): void {
  requireCallback(callback);
  validateRange(buffer, offset, length);
  NitroFs.read(fd, length, toPosition(position))
    .then((data) => {
      const bytes = new Uint8Array(data);
      new Uint8Array(buffer.buffer, buffer.byteOffset + offset, bytes.byteLength).set(bytes);
      callback(null, bytes.byteLength, buffer);
    })
    .catch((e: unknown) => callback(toFsError(e, 'read') as ErrnoException, 0, buffer));
}

type WriteCallback<T> = (err: ErrnoException | null, written: number, data: T) => void;

/**
 * Writes `buffer` (or `length` bytes of it from `offset`), or a string, at
 * `position` or, when it is null, at the current file offset. Returns the
 * bytes written.
 */
export function writeSync(
  fd: number,
  buffer: BinaryData,
  offset?: number | null,
  length?: number | null,
  position?: number | null,
): number;
export function writeSync(
  fd: number,
  string: string,
  position?: number | null,
  encoding?: BufferEncoding | null,
): number;
export function writeSync(
  fd: number,
  data: string | BinaryData,
  a?: number | null,
  b?: number | BufferEncoding | null,
  c?: number | null,
): number {
  let bytes: BinaryData;
  let offset: number;
  let length: number;
  let position: number | null | undefined;
  if (typeof data === 'string') {
    bytes = bytesOf(data, b as BufferEncoding | null);
    offset = 0;
    length = bytes.byteLength;
    position = a;
  } else {
    bytes = data;
    offset = a ?? 0;
    length = (b as number | null | undefined) ?? bytes.byteLength - offset;
    position = c;
  }
  validateRange(bytes, offset, length);
  return check(
    NitroFs.writeSync(
      fd,
      bytes.buffer as ArrayBuffer,
      bytes.byteOffset + offset,
      length,
      toPosition(position),
    ),
    'write',
  );
}

export function write<T extends BinaryData>(fd: number, buffer: T, callback: WriteCallback<T>): void;
export function write<T extends BinaryData>(
  fd: number,
  buffer: T,
  offset: number | null | undefined,
  callback: WriteCallback<T>,
): void;
export function write<T extends BinaryData>(
  fd: number,
  buffer: T,
  offset: number | null | undefined,
  length: number | null | undefined,
  callback: WriteCallback<T>,
): void;
export function write<T extends BinaryData>(
  fd: number,
  buffer: T,
  offset: number | null | undefined,
  length: number | null | undefined,
  position: number | null | undefined,
  callback: WriteCallback<T>,
): void;
export function write(fd: number, string: string, callback: WriteCallback<string>): void;
export function write(
  fd: number,
  string: string,
  position: number | null | undefined,
  callback: WriteCallback<string>,
): void;
export function write(
  fd: number,
  string: string,
  position: number | null | undefined,
  encoding: BufferEncoding | null | undefined,
  callback: WriteCallback<string>,
): void;
export function write(fd: number, data: string | BinaryData, ...args: unknown[]): void {
  const callback = args.pop() as WriteCallback<string | BinaryData>;
  requireCallback(callback);

  let bytes: BinaryData;
  let offset: number;
  let length: number;
  let position: number | null | undefined;
  if (typeof data === 'string') {
    const [pos, encoding] = args as [number | null | undefined, BufferEncoding | null | undefined];
    bytes = bytesOf(data, encoding);
    offset = 0;
    length = bytes.byteLength;
    position = pos;
  } else {
    const [off, len, pos] = args as [number | null | undefined, number | null | undefined, number | null | undefined];
    bytes = data;
    offset = off ?? 0;
    length = len ?? bytes.byteLength - offset;
    position = pos;
  }
  validateRange(bytes, offset, length);

  NitroFs.write(fd, bytes.buffer as ArrayBuffer, bytes.byteOffset + offset, length, toPosition(position))
    .then((status) => {
      if (status < 0) {
        callback(fsError('write', status), 0, data);
      } else {
        callback(null, status, data);
      }
    })
    .catch((e: unknown) => callback(toFsError(e, 'write') as ErrnoException, 0, data));
}

/**
 * The error of a failed readFile(). A file over 2 GiB fails natively with
 * EFBIG; Node reports that as a RangeError with code ERR_FS_FILE_TOO_LARGE.
 */
function readFileError(error: unknown, path: string): unknown {
  const fsErr = toFsError(error, 'open', path) as ErrnoException;
  if (fsErr?.code !== 'EFBIG') {
    return fsErr;
  }
  const tooLarge: ErrnoException = new RangeError(
    `File size is greater than 2 GiB: '${path}'`,
  );
  tooLarge.code = 'ERR_FS_FILE_TOO_LARGE';
  tooLarge.path = path;
  return tooLarge;
}

// --- whole files --------------------------------------------------------------

export interface ReadFileOptions {
  encoding?: BufferEncoding | null;
}

export function readFileSync(path: PathLike, options?: { encoding?: null } | null): Buffer;
export function readFileSync(
  path: PathLike,
  options: BufferEncoding | { encoding: BufferEncoding },
): string;
export function readFileSync(
  path: PathLike,
  options?: BufferEncoding | ReadFileOptions | null,
): Buffer | string;
export function readFileSync(
  path: PathLike,
  options?: BufferEncoding | ReadFileOptions | null,
): Buffer | string {
  const p = toPath(path);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  let data: ArrayBuffer;
  try {
    data = NitroFs.readFileSync(p);
  } catch (e) {
    throw readFileError(e, p);
  }
  return decode(Buffer.from(data), encoding);
}

export function readFile(path: PathLike, callback: ResultCallback<Buffer>): void;
export function readFile(
  path: PathLike,
  options: { encoding?: null } | null | undefined,
  callback: ResultCallback<Buffer>,
): void;
export function readFile(
  path: PathLike,
  options: BufferEncoding | { encoding: BufferEncoding },
  callback: ResultCallback<string>,
): void;
export function readFile(path: PathLike, ...args: unknown[]): void {
  const callback = args.pop() as ResultCallback<Buffer | string>;
  requireCallback(callback);
  const options = args[0] as BufferEncoding | ReadFileOptions | null | undefined;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const p = toPath(path);

  NitroFs.readFile(p)
    .then((data) => callback(null, decode(Buffer.from(data), encoding)))
    .catch((e: unknown) => callback(readFileError(e, p) as ErrnoException, undefined as never));
}

export interface WriteFileOptions {
  encoding?: BufferEncoding | null;
  /** Defaults to 0o666. */
  mode?: number | string;
  /** Defaults to 'w'. */
  flag?: OpenMode;
}

function writeFileArgs(
  data: string | BinaryData,
  options: BufferEncoding | WriteFileOptions | null | undefined,
  defaultFlag: string,
): { bytes: BinaryData; flags: number; mode: number } {
  const opts: WriteFileOptions =
    typeof options === 'string' ? { encoding: options } : (options ?? {});
  return {
    bytes: bytesOf(data, opts.encoding),
    flags: toFlags(opts.flag, defaultFlag),
    mode: toMode(opts.mode, 0o666),
  };
}

export function writeFileSync(
  path: PathLike,
  data: string | BinaryData,
  options?: BufferEncoding | WriteFileOptions | null,
): void {
  const p = toPath(path);
  const { bytes, flags, mode } = writeFileArgs(data, options, 'w');
  check(
    NitroFs.writeFileSync(p, bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength, flags, mode),
    'open',
    p,
  );
}

export function writeFile(path: PathLike, data: string | BinaryData, callback: Callback): void;
export function writeFile(
  path: PathLike,
  data: string | BinaryData,
  options: BufferEncoding | WriteFileOptions | null | undefined,
  callback: Callback,
): void;
export function writeFile(path: PathLike, data: string | BinaryData, ...args: unknown[]): void {
  writeFileWith('w', path, data, args);
}

export function appendFileSync(
  path: PathLike,
  data: string | BinaryData,
  options?: BufferEncoding | WriteFileOptions | null,
): void {
  const opts: WriteFileOptions = typeof options === 'string' ? { encoding: options } : (options ?? {});
  writeFileSync(path, data, { ...opts, flag: opts.flag ?? 'a' });
}

export function appendFile(path: PathLike, data: string | BinaryData, callback: Callback): void;
export function appendFile(
  path: PathLike,
  data: string | BinaryData,
  options: BufferEncoding | WriteFileOptions | null | undefined,
  callback: Callback,
): void;
export function appendFile(path: PathLike, data: string | BinaryData, ...args: unknown[]): void {
  writeFileWith('a', path, data, args);
}

function writeFileWith(defaultFlag: string, path: PathLike, data: string | BinaryData, args: unknown[]): void {
  const callback = args.pop() as Callback;
  requireCallback(callback);
  const p = toPath(path);
  const { bytes, flags, mode } = writeFileArgs(
    data,
    args[0] as BufferEncoding | WriteFileOptions | null | undefined,
    defaultFlag,
  );

  NitroFs.writeFile(p, bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength, flags, mode)
    .then(() => callback(null))
    .catch((e: unknown) => callback(toFsError(e, 'open', p) as ErrnoException));
}

// --- directories and files ------------------------------------------------------

export interface MakeDirectoryOptions {
  /** Creates the parents too, and does not fail when the directory exists. */
  recursive?: boolean;
  /** Defaults to 0o777. */
  mode?: number | string;
}

export function mkdirSync(path: PathLike, options?: number | string | MakeDirectoryOptions | null): void {
  const p = toPath(path);
  const opts: MakeDirectoryOptions =
    typeof options === 'object' && options !== null ? options : { mode: options ?? undefined };
  const mode = toMode(opts.mode, 0o777);
  check(opts.recursive ? NitroFs.mkdirRecursive(p, mode) : NitroFs.mkdir(p, mode), 'mkdir', p);
}

export function mkdir(path: PathLike, callback: Callback): void;
export function mkdir(
  path: PathLike,
  options: number | string | MakeDirectoryOptions | null | undefined,
  callback: Callback,
): void;
export function mkdir(path: PathLike, ...args: unknown[]): void {
  const callback = args.pop() as Callback;
  requireCallback(callback);
  later<void>(callback, () => mkdirSync(path, args[0] as MakeDirectoryOptions | undefined));
}

export interface ReaddirOptions {
  encoding?: BufferEncoding | null;
  /** Not supported yet: throws when true. */
  withFileTypes?: boolean;
}

/** The names in a directory, without '.' and '..'. */
export function readdirSync(path: PathLike, options?: BufferEncoding | ReaddirOptions | null): string[] {
  if (typeof options === 'object' && options?.withFileTypes) {
    throw new Error('readdir() does not support withFileTypes yet');
  }
  const p = toPath(path);
  return call('scandir', p, () => NitroFs.readdir(p));
}

export function readdir(path: PathLike, callback: ResultCallback<string[]>): void;
export function readdir(
  path: PathLike,
  options: BufferEncoding | ReaddirOptions | null | undefined,
  callback: ResultCallback<string[]>,
): void;
export function readdir(path: PathLike, ...args: unknown[]): void {
  const callback = args.pop() as ResultCallback<string[]>;
  requireCallback(callback);
  later(callback, () => readdirSync(path, args[0] as ReaddirOptions | undefined));
}

export function unlinkSync(path: PathLike): void {
  const p = toPath(path);
  check(NitroFs.unlink(p), 'unlink', p);
}

export function unlink(path: PathLike, callback: Callback): void {
  requireCallback(callback);
  later<void>(callback, () => unlinkSync(path));
}

/** Removes an empty directory. */
export function rmdirSync(path: PathLike): void {
  const p = toPath(path);
  check(NitroFs.rmdir(p), 'rmdir', p);
}

export function rmdir(path: PathLike, callback: Callback): void {
  requireCallback(callback);
  later<void>(callback, () => rmdirSync(path));
}

export interface RmOptions {
  /** Removes directories and their content. */
  recursive?: boolean;
  /** Does not fail when the path does not exist. */
  force?: boolean;
}

export function rmSync(path: PathLike, options?: RmOptions): void {
  const p = toPath(path);
  const status = options?.recursive ? NitroFs.rmRecursive(p) : NitroFs.unlink(p);
  if (status < 0 && options?.force && fsError('rm', status).code === 'ENOENT') {
    return;
  }
  check(status, 'rm', p);
}

export function rm(path: PathLike, callback: Callback): void;
export function rm(path: PathLike, options: RmOptions | undefined, callback: Callback): void;
export function rm(path: PathLike, ...args: unknown[]): void {
  const callback = args.pop() as Callback;
  requireCallback(callback);
  later<void>(callback, () => rmSync(path, args[0] as RmOptions | undefined));
}

// --- access and info --------------------------------------------------------------

/** Throws unless the file is accessible with `mode` (F_OK, the default, R_OK, ...). */
export function accessSync(path: PathLike, mode: number = constants.F_OK): void {
  const p = toPath(path);
  check(NitroFs.access(p, mode), 'access', p);
}

export function access(path: PathLike, callback: Callback): void;
export function access(path: PathLike, mode: number | undefined, callback: Callback): void;
export function access(path: PathLike, mode: number | Callback | undefined, callback?: Callback): void {
  if (typeof mode === 'function') {
    callback = mode;
    mode = undefined;
  }
  requireCallback(callback);
  later<void>(callback!, () => accessSync(path, mode as number | undefined));
}

/** Whether the path exists. Never throws. */
export function existsSync(path: PathLike): boolean {
  try {
    return NitroFs.access(toPath(path), constants.F_OK) === 0;
  } catch {
    return false;
  }
}

/** Deprecated in Node, kept for compatibility: the callback gets no error. */
export function exists(path: PathLike, callback: (exists: boolean) => void): void {
  requireCallback(callback);
  setImmediate(() => callback(existsSync(path)));
}

/** Information about the file system that holds `path`. */
export function statfsSync(path: PathLike): StatFs {
  const p = toPath(path);
  return call('statfs', p, () => NitroFs.statfs(p));
}

export function statfs(path: PathLike, callback: ResultCallback<StatFs>): void;
export function statfs(path: PathLike, options: object | undefined, callback: ResultCallback<StatFs>): void;
export function statfs(path: PathLike, ...args: unknown[]): void {
  const callback = args.pop() as ResultCallback<StatFs>;
  requireCallback(callback);
  later(callback, () => statfsSync(path));
}
