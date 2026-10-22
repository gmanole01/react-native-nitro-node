/**
 * Node's internalBinding('zlib') for lib/zlib.js, on the NitroNodeZlib
 * HybridObject: the same handle API (init(), write(), writeSync(), params(),
 * reset(), close(), onerror), so the ported zlib.js code stays as it is.
 */
import { Buffer } from 'buffer';
import { createNitroZlib } from '../native';
import type { NitroNodeZlib } from '../native';
import { rethrowLater } from '../utils';

type ZlibError = { message: string; status: number; code: string };

export const owner_symbol = Symbol('owner_symbol');

// One for crc32() and the version, which need no stream
let shared: NitroNodeZlib | null = null;
function sharedNative(): NitroNodeZlib {
  shared ??= createNitroZlib();
  return shared;
}

/** ZLIB_VERNUM of the zlib this library is built with. */
export function zlibVersion(): number {
  return sharedNative().version;
}

export function crc32(data: string | ArrayBufferView, value: number): number {
  const view = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return sharedNative().crc32(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength, value);
}

function arrayBufferOf(view: ArrayBufferView): ArrayBuffer {
  return view.buffer as ArrayBuffer;
}

/**
 * Node's CompressionStream: the handle of one stream, whichever engine. The
 * subclasses set the engine up, with the init() of Node's binding.
 */
class CompressionHandle {
  public onerror: ((message: string, errno: number, code: string) => void) | null = null;
  [owner_symbol]: unknown;

  protected readonly _native: NitroNodeZlib = createNitroZlib();
  protected _writeState: Uint32Array | null = null;
  protected _callback: (() => void) | null = null;

  writeSync(
    flush: number,
    input: Uint8Array,
    inOff: number,
    inLen: number,
    out: Uint8Array,
    outOff: number,
    outLen: number,
  ): void {
    const result = this._native.writeSync(
      flush,
      arrayBufferOf(input),
      input.byteOffset + inOff,
      inLen,
      arrayBufferOf(out),
      out.byteOffset + outOff,
      outLen,
    );
    if (result.error) {
      this._emitError(result.error);
      return;
    }
    this._writeState![0] = result.availOut;
    this._writeState![1] = result.availIn;
  }

  // As Node's, the callback (processCallback) runs once the step is done; the
  // output arrives as a copy, and goes into `out` here
  write(
    flush: number,
    input: Uint8Array,
    inOff: number,
    inLen: number,
    out: Uint8Array,
    outOff: number,
    outLen: number,
  ): void {
    this._native.write(flush, arrayBufferOf(input), input.byteOffset + inOff, inLen, outLen).then(
      result => {
        if (result.error) {
          this._emitError(result.error);
          return;
        }
        if (result.output && result.output.byteLength > 0) {
          out.set(new Uint8Array(result.output), outOff);
        }
        this._writeState![0] = result.availOut;
        this._writeState![1] = result.availIn;
        // what the stream's listeners throw is rethrown, not lost in the promise
        rethrowLater(() => this._callback!.call(this));
      },
      (err: unknown) => {
        rethrowLater(() => {
          throw err;
        });
      },
    );
  }

  params(level: number, strategy: number): void {
    const error = this._native.params(level, strategy);
    if (error) {
      this._emitError(error);
    }
  }

  reset(): void {
    const error = this._native.reset();
    if (error) {
      this._emitError(error);
    }
  }

  close(): void {
    this._native.close();
  }

  protected _setUp(writeState: Uint32Array, processCallback: () => void): void {
    this._writeState = writeState;
    this._callback = processCallback;
  }

  private _emitError(error: ZlibError): void {
    const onerror = this.onerror;
    rethrowLater(() => onerror?.call(this, error.message, error.status, error.code));
  }
}

/** A copy of exactly a view's bytes: the view may be part of a larger buffer. */
function copyOf(view: ArrayBufferView): ArrayBuffer {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer;
}

// What Node's C++ init() throws when the engine refuses its setup
function initializationFailed(message: string): Error {
  return Object.assign(new Error(message), { code: 'ERR_ZLIB_INITIALIZATION_FAILED' });
}

/** Node's ZlibStream: a deflate or inflate stream. */
export class Zlib extends CompressionHandle {
  private readonly _mode: number;

  constructor(mode: number) {
    super();
    this._mode = mode;
  }

  init(
    windowBits: number,
    level: number,
    memLevel: number,
    strategy: number,
    writeState: Uint32Array,
    processCallback: () => void,
    dictionary?: ArrayBufferView,
  ): void {
    this._setUp(writeState, processCallback);
    const dict = dictionary ? copyOf(dictionary) : undefined;
    this._native.init(this._mode, windowBits, level, memLevel, strategy, dict);
  }
}

/** Node's BrotliCompressionStream. */
class BrotliStream extends CompressionHandle {
  private readonly _mode: number;

  constructor(mode: number) {
    super();
    this._mode = mode;
  }

  init(params: Uint32Array, writeState: Uint32Array, processCallback: () => void): void {
    this._setUp(writeState, processCallback);
    if (this._native.initBrotli(this._mode, Array.from(params))) {
      // as Node, which doesn't pass on the engine's message here
      throw initializationFailed('Initialization failed');
    }
  }
}

export class BrotliEncoder extends BrotliStream {}
export class BrotliDecoder extends BrotliStream {}

/** Node's ZstdStream. */
class ZstdStream extends CompressionHandle {
  private readonly _mode: number;

  constructor(mode: number) {
    super();
    this._mode = mode;
  }

  init(
    params: Uint32Array,
    pledgedSrcSize: unknown,
    writeState: Uint32Array,
    processCallback: () => void,
    dictionary?: ArrayBufferView,
  ): void {
    this._setUp(writeState, processCallback);
    let size: number | undefined;
    if (typeof pledgedSrcSize === 'number') {
      // as V8's IntegerValue(): NaN is 0, the rest is truncated
      size = Number.isNaN(pledgedSrcSize) ? 0 : Math.trunc(pledgedSrcSize);
      if (size < 0) {
        throw Object.assign(new TypeError('pledgedSrcSize may not be negative'), {
          code: 'ERR_INVALID_ARG_VALUE',
        });
      }
    }
    const dict = dictionary ? copyOf(dictionary) : undefined;
    const error = this._native.initZstd(this._mode, Array.from(params), size, dict);
    if (error) {
      throw initializationFailed(error.message);
    }
  }
}

// Node's modes, constants.ZSTD_COMPRESS and ZSTD_DECOMPRESS
const ZSTD_COMPRESS = 10;
const ZSTD_DECOMPRESS = 11;

export class ZstdCompress extends ZstdStream {
  constructor() {
    super(ZSTD_COMPRESS);
  }
}
export class ZstdDecompress extends ZstdStream {
  constructor() {
    super(ZSTD_DECOMPRESS);
  }
}
