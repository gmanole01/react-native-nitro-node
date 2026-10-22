/**
 * Node's zlib (see ./zlib for the port), with types: the stream classes, the
 * callback and sync convenience functions, constants and codes, for zlib,
 * Brotli and zstd.
 */
import type { Buffer } from 'buffer';
import type { Transform, TransformOptions } from 'readable-stream';
import { codes, constants, crc32, impl } from './zlib';

/** Node's zlib.ZlibOptions. */
export interface ZlibOptions extends Omit<TransformOptions, 'flush' | 'transform'> {
  /** Default: constants.Z_NO_FLUSH. */
  flush?: number;
  /** Default: constants.Z_FINISH. */
  finishFlush?: number;
  /** Default: 16 * 1024. */
  chunkSize?: number;
  windowBits?: number;
  /** Compression only. */
  level?: number;
  /** Compression only. */
  memLevel?: number;
  /** Compression only. */
  strategy?: number;
  /** Deflate/inflate only, an empty dictionary by default. */
  dictionary?: ArrayBufferView | ArrayBuffer;
  /** The convenience functions give { buffer, engine } instead of the buffer. */
  info?: boolean;
  /** The most output the convenience functions take. */
  maxOutputLength?: number;
  /** Fail on data after the end of the compressed stream. */
  rejectGarbageAfterEnd?: boolean;
}

/** Node's zlib.BrotliOptions. */
export interface BrotliOptions extends ZlibOptions {
  /** By key, constants.BROTLI_PARAM_* (or BROTLI_DECODER_PARAM_*). */
  params?: Record<number, number | boolean>;
}

/** Node's zlib.ZstdOptions. */
export interface ZstdOptions extends ZlibOptions {
  /** By key, constants.ZSTD_c_* (or ZSTD_d_*). */
  params?: Record<number, number | boolean>;
  /** The size of the whole input, when known: it goes into the frame header. */
  pledgedSrcSize?: number;
}

/** What every zlib stream has: Node's ZlibBase. */
export interface ZlibBase extends Transform {
  /** Bytes written to the engine so far. */
  bytesWritten: number;
  /** @deprecated Use bytesWritten. */
  bytesRead: number;
  /** Closes the underlying handle; `callback` once the stream is finished. */
  close(callback?: (error?: Error | null) => void): void;
  /** Flushes pending data: Z_FULL_FLUSH by default. */
  flush(kind?: number | (() => void), callback?: () => void): void;
  /** Starts over, as if newly created (deflate/inflate only). */
  reset(): void;
}

/** A deflate or inflate stream: Node's Zlib. */
export interface Zlib extends ZlibBase {
  /** Changes the compression level and strategy, after a sync flush. */
  params(level: number, strategy: number, callback: () => void): void;
}

type ZlibClass<T, O> = { new (options?: O): T; (options?: O): T; prototype: T };

export type Deflate = Zlib;
export type Inflate = Zlib;
export type Gzip = Zlib;
export type Gunzip = Zlib;
export type DeflateRaw = Zlib;
export type InflateRaw = Zlib;
export type Unzip = Zlib;
export type BrotliCompress = ZlibBase;
export type BrotliDecompress = ZlibBase;
export type ZstdCompress = ZlibBase;
export type ZstdDecompress = ZlibBase;

export const Deflate = impl.Deflate as unknown as ZlibClass<Deflate, ZlibOptions>;
export const Inflate = impl.Inflate as unknown as ZlibClass<Inflate, ZlibOptions>;
export const Gzip = impl.Gzip as unknown as ZlibClass<Gzip, ZlibOptions>;
export const Gunzip = impl.Gunzip as unknown as ZlibClass<Gunzip, ZlibOptions>;
export const DeflateRaw = impl.DeflateRaw as unknown as ZlibClass<DeflateRaw, ZlibOptions>;
export const InflateRaw = impl.InflateRaw as unknown as ZlibClass<InflateRaw, ZlibOptions>;
export const Unzip = impl.Unzip as unknown as ZlibClass<Unzip, ZlibOptions>;
export const BrotliCompress = impl.BrotliCompress as unknown as ZlibClass<BrotliCompress, BrotliOptions>;
export const BrotliDecompress = impl.BrotliDecompress as unknown as ZlibClass<BrotliDecompress, BrotliOptions>;
export const ZstdCompress = impl.ZstdCompress as unknown as ZlibClass<ZstdCompress, ZstdOptions>;
export const ZstdDecompress = impl.ZstdDecompress as unknown as ZlibClass<ZstdDecompress, ZstdOptions>;

/** What the convenience functions take. */
export type InputType = string | ArrayBuffer | ArrayBufferView;
export type CompressCallback = (error: Error | null, result: Buffer) => void;

interface AsyncConvenience<O> {
  (buffer: InputType, callback: CompressCallback): void;
  (buffer: InputType, options: O, callback: CompressCallback): void;
}
type SyncConvenience<O> = (buffer: InputType, options?: O) => Buffer;

const method = impl.createConvenienceMethod;

export const deflate = method(impl.Deflate, false) as AsyncConvenience<ZlibOptions>;
export const deflateSync = method(impl.Deflate, true) as SyncConvenience<ZlibOptions>;
export const gzip = method(impl.Gzip, false) as AsyncConvenience<ZlibOptions>;
export const gzipSync = method(impl.Gzip, true) as SyncConvenience<ZlibOptions>;
export const deflateRaw = method(impl.DeflateRaw, false) as AsyncConvenience<ZlibOptions>;
export const deflateRawSync = method(impl.DeflateRaw, true) as SyncConvenience<ZlibOptions>;
export const unzip = method(impl.Unzip, false) as AsyncConvenience<ZlibOptions>;
export const unzipSync = method(impl.Unzip, true) as SyncConvenience<ZlibOptions>;
export const inflate = method(impl.Inflate, false) as AsyncConvenience<ZlibOptions>;
export const inflateSync = method(impl.Inflate, true) as SyncConvenience<ZlibOptions>;
export const gunzip = method(impl.Gunzip, false) as AsyncConvenience<ZlibOptions>;
export const gunzipSync = method(impl.Gunzip, true) as SyncConvenience<ZlibOptions>;
export const inflateRaw = method(impl.InflateRaw, false) as AsyncConvenience<ZlibOptions>;
export const inflateRawSync = method(impl.InflateRaw, true) as SyncConvenience<ZlibOptions>;
export const brotliCompress = method(impl.BrotliCompress, false) as AsyncConvenience<BrotliOptions>;
export const brotliCompressSync = method(impl.BrotliCompress, true) as SyncConvenience<BrotliOptions>;
export const brotliDecompress = method(impl.BrotliDecompress, false) as AsyncConvenience<BrotliOptions>;
export const brotliDecompressSync = method(impl.BrotliDecompress, true) as SyncConvenience<BrotliOptions>;
export const zstdCompress = method(impl.ZstdCompress, false) as AsyncConvenience<ZstdOptions>;
export const zstdCompressSync = method(impl.ZstdCompress, true) as SyncConvenience<ZstdOptions>;
export const zstdDecompress = method(impl.ZstdDecompress, false) as AsyncConvenience<ZstdOptions>;
export const zstdDecompressSync = method(impl.ZstdDecompress, true) as SyncConvenience<ZstdOptions>;

export const createDeflate = (options?: ZlibOptions): Deflate => new Deflate(options);
export const createInflate = (options?: ZlibOptions): Inflate => new Inflate(options);
export const createDeflateRaw = (options?: ZlibOptions): DeflateRaw => new DeflateRaw(options);
export const createInflateRaw = (options?: ZlibOptions): InflateRaw => new InflateRaw(options);
export const createGzip = (options?: ZlibOptions): Gzip => new Gzip(options);
export const createGunzip = (options?: ZlibOptions): Gunzip => new Gunzip(options);
export const createUnzip = (options?: ZlibOptions): Unzip => new Unzip(options);
export const createBrotliCompress = (options?: BrotliOptions): BrotliCompress => new BrotliCompress(options);
export const createBrotliDecompress = (options?: BrotliOptions): BrotliDecompress => new BrotliDecompress(options);
export const createZstdCompress = (options?: ZstdOptions): ZstdCompress => new ZstdCompress(options);
export const createZstdDecompress = (options?: ZstdOptions): ZstdDecompress => new ZstdDecompress(options);

export { codes, constants, crc32 };

const zlib = {
  crc32,
  Deflate,
  Inflate,
  Gzip,
  Gunzip,
  DeflateRaw,
  InflateRaw,
  Unzip,
  BrotliCompress,
  BrotliDecompress,
  ZstdCompress,
  ZstdDecompress,
  deflate,
  deflateSync,
  gzip,
  gzipSync,
  deflateRaw,
  deflateRawSync,
  unzip,
  unzipSync,
  inflate,
  inflateSync,
  gunzip,
  gunzipSync,
  inflateRaw,
  inflateRawSync,
  brotliCompress,
  brotliCompressSync,
  brotliDecompress,
  brotliDecompressSync,
  zstdCompress,
  zstdCompressSync,
  zstdDecompress,
  zstdDecompressSync,
  createDeflate,
  createInflate,
  createDeflateRaw,
  createInflateRaw,
  createGzip,
  createGunzip,
  createUnzip,
  createBrotliCompress,
  createBrotliDecompress,
  createZstdCompress,
  createZstdDecompress,
  constants,
  codes,
};

// As Node: the constants also on the module, deprecated and not enumerable
for (const [key, value] of Object.entries(constants)) {
  if (key.startsWith('BROTLI')) continue;
  Object.defineProperty(zlib, key, { enumerable: false, value, writable: false });
}

export default zlib;
