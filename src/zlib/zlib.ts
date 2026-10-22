// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

/**
 * Node 22's lib/zlib.js, ported: the streams, the convenience functions and
 * constants, on the NitroNodeZlib HybridObject (see ./binding) instead of
 * Node's internal binding: zlib, Brotli and zstd.
 */
import { Buffer, kMaxLength } from 'buffer';
import { Transform, finished } from 'readable-stream';
import process from '../process';
import * as binding from './binding';
import { owner_symbol } from './binding';
import { makeConstants } from './constants';
import {
  ERR_BROTLI_INVALID_PARAM,
  ERR_BUFFER_TOO_LARGE,
  ERR_INVALID_ARG_TYPE,
  ERR_OUT_OF_RANGE,
  ERR_TRAILING_JUNK_AFTER_STREAM_END,
  ERR_ZSTD_INVALID_PARAM,
  assert,
  checkRangesOrGetDefault,
  deprecate,
  genericNodeError,
  isAnyArrayBuffer,
  isArrayBufferView,
  isUint8Array,
  validateFiniteNumber,
  validateFunction,
  validateUint32,
} from './internals';

/* eslint-disable @typescript-eslint/no-shadow, no-new-func */
type Any = any;

const kFlushFlag = Symbol('kFlushFlag');
const kError = Symbol('kError');

// Node's `new FastBuffer()`: an empty Buffer
const emptyBuffer = () => Buffer.alloc(0);

export const constants = Object.freeze(makeConstants(binding.zlibVersion()));
const {
  // Zlib flush levels
  Z_NO_FLUSH, Z_BLOCK, Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH,
  // Zlib option values
  Z_MIN_CHUNK, Z_MIN_WINDOWBITS, Z_MAX_WINDOWBITS, Z_MIN_LEVEL, Z_MAX_LEVEL,
  Z_MIN_MEMLEVEL, Z_MAX_MEMLEVEL, Z_DEFAULT_CHUNK, Z_DEFAULT_COMPRESSION,
  Z_DEFAULT_STRATEGY, Z_DEFAULT_WINDOWBITS, Z_DEFAULT_MEMLEVEL, Z_FIXED,
  // Node's compression stream modes (node_zlib_mode)
  DEFLATE, DEFLATERAW, INFLATE, INFLATERAW, GZIP, GUNZIP, UNZIP,
  BROTLI_DECODE, BROTLI_ENCODE,
  ZSTD_COMPRESS, ZSTD_DECOMPRESS,
  // Brotli operations (~flush levels)
  BROTLI_OPERATION_PROCESS, BROTLI_OPERATION_FLUSH,
  BROTLI_OPERATION_FINISH, BROTLI_OPERATION_EMIT_METADATA,
  // Zstd end directives (~flush levels)
  ZSTD_e_continue, ZSTD_e_flush, ZSTD_e_end,
} = constants;

// Translation table for return codes.
const codesTable: Record<string | number, string | number> = {
  Z_OK: constants.Z_OK,
  Z_STREAM_END: constants.Z_STREAM_END,
  Z_NEED_DICT: constants.Z_NEED_DICT,
  Z_ERRNO: constants.Z_ERRNO,
  Z_STREAM_ERROR: constants.Z_STREAM_ERROR,
  Z_DATA_ERROR: constants.Z_DATA_ERROR,
  Z_MEM_ERROR: constants.Z_MEM_ERROR,
  Z_BUF_ERROR: constants.Z_BUF_ERROR,
  Z_VERSION_ERROR: constants.Z_VERSION_ERROR,
};

for (const ckey of Object.keys(codesTable)) {
  codesTable[codesTable[ckey]!] = ckey;
}

export const codes = Object.freeze(codesTable);

function zlibBuffer(engine: Any, buffer: Any, callback: Any) {
  validateFunction(callback, 'callback');
  // Streams do not support non-Uint8Array ArrayBufferViews yet. Convert it to a
  // Buffer without copying.
  if (isArrayBufferView(buffer) && !isUint8Array(buffer)) {
    buffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else if (isAnyArrayBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }
  engine.buffers = null;
  engine.nread = 0;
  engine.cb = callback;
  engine.on('data', zlibBufferOnData);
  engine.on('error', zlibBufferOnError);
  engine.on('end', zlibBufferOnEnd);
  engine.end(buffer);
}

function zlibBufferOnData(this: Any, chunk: Any) {
  if (!this.buffers) {
    this.buffers = [chunk];
  } else {
    this.buffers.push(chunk);
  }
  this.nread += chunk.length;
  if (this.nread > this._maxOutputLength) {
    this.close();
    this.removeAllListeners('end');
    this.cb(ERR_BUFFER_TOO_LARGE(this._maxOutputLength));
  }
}

function zlibBufferOnError(this: Any, err: Any) {
  this.removeAllListeners('end');
  this.cb(err);
}

function zlibBufferOnEnd(this: Any) {
  let buf;
  if (this.nread === 0) {
    buf = emptyBuffer();
  } else {
    const bufs = this.buffers;
    buf = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs, this.nread);
  }
  this.close();
  if (this._info) this.cb(null, { buffer: buf, engine: this });
  else this.cb(null, buf);
}

function zlibBufferSync(engine: Any, buffer: Any) {
  if (typeof buffer === 'string') {
    buffer = Buffer.from(buffer);
  } else if (!isArrayBufferView(buffer)) {
    if (isAnyArrayBuffer(buffer)) {
      buffer = Buffer.from(buffer);
    } else {
      throw ERR_INVALID_ARG_TYPE(
        'buffer',
        ['string', 'Buffer', 'TypedArray', 'DataView', 'ArrayBuffer'],
        buffer,
      );
    }
  }
  buffer = processChunkSync(engine, buffer, engine._finishFlushFlag);
  if (engine._info) return { buffer, engine };
  return buffer;
}

function zlibOnError(this: Any, message: string, errno: number, code: string) {
  const self = this[owner_symbol];
  // There is no way to cleanly recover.
  // Continuing only obscures problems.

  const error: Any = genericNodeError(message, { errno, code });
  error.errno = errno;
  error.code = code;
  self.destroy(error);
  self[kError] = error;
}

const FLUSH_BOUND = [
  [Z_NO_FLUSH, Z_BLOCK],
  [BROTLI_OPERATION_PROCESS, BROTLI_OPERATION_EMIT_METADATA],
  [ZSTD_e_continue, ZSTD_e_end],
];
const FLUSH_BOUND_IDX_NORMAL = 0;
const FLUSH_BOUND_IDX_BROTLI = 1;
const FLUSH_BOUND_IDX_ZSTD = 2;

// The base class for all Zlib-style streams.
function ZlibBase(this: Any, opts: Any, mode: number, handle: Any, { flush, finishFlush, fullFlush }: Any) {
  let chunkSize = Z_DEFAULT_CHUNK;
  let maxOutputLength = kMaxLength;
  // The ZlibBase class is not exported to user land, the mode should only be
  // passed in by us.
  assert(typeof mode === 'number');
  assert(mode >= DEFLATE && mode <= ZSTD_DECOMPRESS);

  let flushBoundIdx;
  if (mode === BROTLI_ENCODE || mode === BROTLI_DECODE) {
    flushBoundIdx = FLUSH_BOUND_IDX_BROTLI;
  } else if (mode === ZSTD_COMPRESS || mode === ZSTD_DECOMPRESS) {
    flushBoundIdx = FLUSH_BOUND_IDX_ZSTD;
  } else {
    flushBoundIdx = FLUSH_BOUND_IDX_NORMAL;
  }

  if (opts) {
    chunkSize = opts.chunkSize;
    if (!validateFiniteNumber(chunkSize, 'options.chunkSize')) {
      chunkSize = Z_DEFAULT_CHUNK;
    } else if (chunkSize < Z_MIN_CHUNK) {
      throw ERR_OUT_OF_RANGE('options.chunkSize', `>= ${Z_MIN_CHUNK}`, chunkSize);
    }

    flush = checkRangesOrGetDefault(
      opts.flush, 'options.flush',
      FLUSH_BOUND[flushBoundIdx]![0]!, FLUSH_BOUND[flushBoundIdx]![1]!, flush);

    finishFlush = checkRangesOrGetDefault(
      opts.finishFlush, 'options.finishFlush',
      FLUSH_BOUND[flushBoundIdx]![0]!, FLUSH_BOUND[flushBoundIdx]![1]!,
      finishFlush);

    maxOutputLength = checkRangesOrGetDefault(
      opts.maxOutputLength, 'options.maxOutputLength',
      1, kMaxLength, kMaxLength);

    if (opts.encoding || opts.objectMode || opts.writableObjectMode) {
      opts = { ...opts };
      opts.encoding = null;
      opts.objectMode = false;
      opts.writableObjectMode = false;
    }
  }

  Reflect.apply(Transform as Any, this, [{ autoDestroy: true, ...opts }]);
  this[kError] = null;
  this.bytesWritten = 0;
  this._handle = handle;
  handle[owner_symbol] = this;
  // Used by processCallback() and zlibOnError()
  handle.onerror = zlibOnError;
  this._outBuffer = Buffer.allocUnsafe(chunkSize);
  this._outOffset = 0;

  this._chunkSize = chunkSize;
  this._defaultFlushFlag = flush;
  this._finishFlushFlag = finishFlush;
  this._defaultFullFlushFlag = fullFlush;
  this._info = opts?.info;
  this._maxOutputLength = maxOutputLength;

  this._rejectGarbageAfterEnd = opts?.rejectGarbageAfterEnd === true;
}
Object.setPrototypeOf(ZlibBase.prototype, Transform.prototype);
Object.setPrototypeOf(ZlibBase, Transform);

Object.defineProperty(ZlibBase.prototype, '_closed', {
  configurable: true,
  enumerable: true,
  get() {
    return !this._handle;
  },
});

// `bytesRead` made sense as a name when looking from the zlib engine's
// perspective, but it is inconsistent with all other streams exposed by Node.js
// that have this concept, where it stands for the number of bytes read
// *from* the stream (that is, net.Socket/tls.Socket & file system streams).
Object.defineProperty(ZlibBase.prototype, 'bytesRead', {
  configurable: true,
  enumerable: true,
  get: deprecate(function (this: Any) {
    return this.bytesWritten;
  }, 'zlib.bytesRead is deprecated and will change its meaning in the ' +
     'future. Use zlib.bytesWritten instead.', 'DEP0108'),
  set: deprecate(function (this: Any, value: number) {
    this.bytesWritten = value;
  }, 'Setting zlib.bytesRead is deprecated. ' +
     'This feature will be removed in the future.', 'DEP0108'),
});

ZlibBase.prototype.reset = function (this: Any) {
  assert(this._handle, 'zlib binding closed');
  return this._handle.reset();
};

// This is the _flush function called by the transform class,
// internally, when the last chunk has been written.
ZlibBase.prototype._flush = function (this: Any, callback: Any) {
  this._transform(emptyBuffer(), '', callback);
};

// Force Transform compat behavior.
ZlibBase.prototype._final = function (callback: Any) {
  callback();
};

// If a flush is scheduled while another flush is still pending, a way to figure
// out which one is the "stronger" flush is needed.
// This is currently only used to figure out which flush flag to use for the
// last chunk.
// Roughly, the following holds:
// Z_NO_FLUSH < Z_BLOCK < Z_PARTIAL_FLUSH <
//     Z_SYNC_FLUSH < Z_FULL_FLUSH < Z_FINISH
const flushiness: number[] = [];
const kFlushFlagList = [Z_NO_FLUSH, Z_BLOCK, Z_PARTIAL_FLUSH,
                        Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH];
for (let i = 0; i < kFlushFlagList.length; i++) {
  flushiness[kFlushFlagList[i]!] = i;
}

function maxFlush(a: number, b: number) {
  return flushiness[a]! > flushiness[b]! ? a : b;
}

// Set up a list of 'special' buffers that can be written using .write()
// from the .flush() code as a way of introducing flushing operations into the
// write sequence.
const kFlushBuffers: Any[] = [];
{
  const dummyArrayBuffer = new ArrayBuffer(0);
  for (const flushFlag of kFlushFlagList) {
    kFlushBuffers[flushFlag] = Buffer.from(dummyArrayBuffer);
    kFlushBuffers[flushFlag][kFlushFlag] = flushFlag;
  }
}

ZlibBase.prototype.flush = function (this: Any, kind: Any, callback: Any) {
  if (typeof kind === 'function' || (kind === undefined && !callback)) {
    callback = kind;
    kind = this._defaultFullFlushFlag;
  }

  if (this.writableFinished) {
    if (callback) process.nextTick(callback);
  } else if (this.writableEnded) {
    if (callback) this.once('end', callback);
  } else {
    this.write(kFlushBuffers[kind], '', callback);
  }
};

ZlibBase.prototype.close = function (this: Any, callback: Any) {
  if (callback) finished(this, callback);
  this.destroy();
};

ZlibBase.prototype._destroy = function (this: Any, err: Any, callback: Any) {
  _close(this);
  callback(err);
};

ZlibBase.prototype._transform = function (this: Any, chunk: Any, _encoding: Any, cb: Any) {
  let flushFlag = this._defaultFlushFlag;
  // We use a 'fake' zero-length chunk to carry information about flushes from
  // the public API to the actual stream implementation.
  if (typeof chunk[kFlushFlag] === 'number') {
    flushFlag = chunk[kFlushFlag];
  }

  // For the last chunk, also apply `_finishFlushFlag`.
  if (this.writableEnded && this.writableLength === chunk.byteLength) {
    flushFlag = maxFlush(flushFlag, this._finishFlushFlag);
  }
  processChunk(this, chunk, flushFlag, cb);
};

ZlibBase.prototype._processChunk = function (this: Any, chunk: Any, flushFlag: Any, cb: Any) {
  // _processChunk() is left for backwards compatibility
  if (typeof cb === 'function') processChunk(this, chunk, flushFlag, cb);
  else return processChunkSync(this, chunk, flushFlag);
};

function processChunkSync(self: Any, chunk: Any, flushFlag: number) {
  let availInBefore = chunk.byteLength;
  let availOutBefore = self._chunkSize - self._outOffset;
  let inOff = 0;
  let availOutAfter;
  let availInAfter;

  const buffers: Any[] = [];
  let nread = 0;
  let inputRead = 0;
  const state = self._writeState;
  const handle = self._handle;
  let buffer = self._outBuffer;
  let offset = self._outOffset;
  const chunkSize = self._chunkSize;

  let error;
  self.on('error', function onError(er: Any) {
    error = er;
  });

  while (true) {
    handle.writeSync(flushFlag,
                     chunk, // in
                     inOff, // in_off
                     availInBefore, // in_len
                     buffer, // out
                     offset, // out_off
                     availOutBefore); // out_len
    if (error) throw error;
    else if (self[kError]) throw self[kError];

    availOutAfter = state[0];
    availInAfter = state[1];

    const inDelta = availInBefore - availInAfter;
    inputRead += inDelta;

    const have = availOutBefore - availOutAfter;
    if (have > 0) {
      const out = buffer.slice(offset, offset + have);
      offset += have;
      buffers.push(out);
      nread += out.byteLength;

      if (nread > self._maxOutputLength) {
        _close(self);
        throw ERR_BUFFER_TOO_LARGE(self._maxOutputLength);
      }

    } else {
      assert(have === 0, 'have should not go down');
    }

    // Exhausted the output buffer, or used all the input create a new one.
    if (availOutAfter === 0 || offset >= chunkSize) {
      availOutBefore = chunkSize;
      offset = 0;
      buffer = Buffer.allocUnsafe(chunkSize);
    }

    if (availOutAfter === 0) {
      // Not actually done. Need to reprocess.
      // Also, update the availInBefore to the availInAfter value,
      // so that if we have to hit it a third (fourth, etc.) time,
      // it'll have the correct byte counts.
      inOff += inDelta;
      availInBefore = availInAfter;
    } else {
      break;
    }
  }

  self.bytesWritten = inputRead;
  _close(self);

  if (nread === 0) return emptyBuffer();

  return buffers.length === 1 ? buffers[0] : Buffer.concat(buffers, nread);
}

function processChunk(self: Any, chunk: Any, flushFlag: number, cb: Any) {
  const handle = self._handle;
  if (!handle) return process.nextTick(cb);

  handle.buffer = chunk;
  handle.cb = cb;
  handle.availOutBefore = self._chunkSize - self._outOffset;
  handle.availInBefore = chunk.byteLength;
  handle.inOff = 0;
  handle.flushFlag = flushFlag;

  handle.write(flushFlag,
               chunk, // in
               0, // in_off
               handle.availInBefore, // in_len
               self._outBuffer, // out
               self._outOffset, // out_off
               handle.availOutBefore); // out_len
}

function processCallback(this: Any) {
  // This callback's context (`this`) is the `_handle` (ZCtx) object. It is
  // important to null out the values once they are no longer needed since
  // `_handle` can stay in memory long after the buffer is needed.
  const handle = this;
  const self = this[owner_symbol];
  const state = self._writeState;

  if (self.destroyed) {
    this.buffer = null;
    this.cb();
    return;
  }

  const availOutAfter = state[0];
  const availInAfter = state[1];

  const inDelta = handle.availInBefore - availInAfter;
  self.bytesWritten += inDelta;

  const have = handle.availOutBefore - availOutAfter;
  let streamBufferIsFull = false;
  if (have > 0) {
    const out = self._outBuffer.slice(self._outOffset, self._outOffset + have);
    self._outOffset += have;
    streamBufferIsFull = !self.push(out);
  } else {
    assert(have === 0, 'have should not go down');
  }

  if (self.destroyed) {
    this.cb();
    return;
  }

  // Exhausted the output buffer, or used all the input create a new one.
  if (availOutAfter === 0 || self._outOffset >= self._chunkSize) {
    handle.availOutBefore = self._chunkSize;
    self._outOffset = 0;
    self._outBuffer = Buffer.allocUnsafe(self._chunkSize);
  }

  if (availOutAfter === 0) {
    // Not actually done. Need to reprocess.
    // Also, update the availInBefore to the availInAfter value,
    // so that if we have to hit it a third (fourth, etc.) time,
    // it'll have the correct byte counts.
    handle.inOff += inDelta;
    handle.availInBefore = availInAfter;


    if (!streamBufferIsFull) {
      this.write(handle.flushFlag,
                 this.buffer, // in
                 handle.inOff, // in_off
                 handle.availInBefore, // in_len
                 self._outBuffer, // out
                 self._outOffset, // out_off
                 self._chunkSize); // out_len
    } else {
      const oldRead = self._read;
      self._read = (n: number) => {
        self._read = oldRead;
        this.write(handle.flushFlag,
                   this.buffer, // in
                   handle.inOff, // in_off
                   handle.availInBefore, // in_len
                   self._outBuffer, // out
                   self._outOffset, // out_off
                   self._chunkSize); // out_len
        self._read(n);
      };
    }
    return;
  }

  if (availInAfter > 0) {
    // If we have more input that should be written, but we also have output
    // space available, that means that the compression library was not
    // interested in receiving more data, and in particular that the input
    // stream has ended early.
    // This applies to streams where we don't check data past the end of
    // what was consumed; that is, everything except Gunzip/Unzip.

    if (self._rejectGarbageAfterEnd) {
      const err = ERR_TRAILING_JUNK_AFTER_STREAM_END();
      self.destroy(err);
      this.cb(err);
      return;
    }

    self.push(null);
  }

  // Finished with the chunk.
  this.buffer = null;
  this.cb();
}

function _close(engine: Any) {
  // Caller may invoke .close after a zlib error (which will null _handle)
  engine._handle?.close();
  engine._handle = null;
}

const zlibDefaultOpts = {
  flush: Z_NO_FLUSH,
  finishFlush: Z_FINISH,
  fullFlush: Z_FULL_FLUSH,
};
// Base class for all streams actually backed by zlib and using zlib-specific
// parameters.
function Zlib(this: Any, opts: Any, mode: number) {
  let windowBits = Z_DEFAULT_WINDOWBITS;
  let level = Z_DEFAULT_COMPRESSION;
  let memLevel = Z_DEFAULT_MEMLEVEL;
  let strategy = Z_DEFAULT_STRATEGY;
  let dictionary;

  if (opts) {
    // windowBits is special. On the compression side, 0 is an invalid value.
    // But on the decompression side, a value of 0 for windowBits tells zlib
    // to use the window size in the zlib header of the compressed stream.
    if ((opts.windowBits == null || opts.windowBits === 0) &&
        (mode === INFLATE ||
         mode === GUNZIP ||
         mode === UNZIP)) {
      windowBits = 0;
    } else {
      // `{ windowBits: 8 }` is valid for deflate but not gzip.
      const min = Z_MIN_WINDOWBITS + (mode === GZIP ? 1 : 0);
      windowBits = checkRangesOrGetDefault(
        opts.windowBits, 'options.windowBits',
        min, Z_MAX_WINDOWBITS, Z_DEFAULT_WINDOWBITS);
    }

    level = checkRangesOrGetDefault(
      opts.level, 'options.level',
      Z_MIN_LEVEL, Z_MAX_LEVEL, Z_DEFAULT_COMPRESSION);

    memLevel = checkRangesOrGetDefault(
      opts.memLevel, 'options.memLevel',
      Z_MIN_MEMLEVEL, Z_MAX_MEMLEVEL, Z_DEFAULT_MEMLEVEL);

    strategy = checkRangesOrGetDefault(
      opts.strategy, 'options.strategy',
      Z_DEFAULT_STRATEGY, Z_FIXED, Z_DEFAULT_STRATEGY);

    dictionary = opts.dictionary;
    if (dictionary !== undefined && !isArrayBufferView(dictionary)) {
      if (isAnyArrayBuffer(dictionary)) {
        dictionary = Buffer.from(dictionary);
      } else {
        throw ERR_INVALID_ARG_TYPE(
          'options.dictionary',
          ['Buffer', 'TypedArray', 'DataView', 'ArrayBuffer'],
          dictionary,
        );
      }
    }
  }

  const handle = new binding.Zlib(mode);
  // Ideally, we could let ZlibBase() set up _writeState. I haven't been able
  // to come up with a good solution that doesn't break our internal API,
  // and with it all supported npm versions at the time of writing.
  this._writeState = new Uint32Array(2);
  handle.init(windowBits,
              level,
              memLevel,
              strategy,
              this._writeState,
              processCallback,
              dictionary);

  Reflect.apply(ZlibBase, this, [opts, mode, handle, zlibDefaultOpts]);

  this._level = level;
  this._strategy = strategy;
  this._mode = mode;
}
Object.setPrototypeOf(Zlib.prototype, ZlibBase.prototype);
Object.setPrototypeOf(Zlib, ZlibBase);

// This callback is used by `.params()` to wait until a full flush happened
// before adjusting the parameters. In particular, the call to the native
// `params()` function should not happen while a write is currently in progress
// on the threadpool.
function paramsAfterFlushCallback(this: Any, level: number, strategy: number, callback: Any) {
  assert(this._handle, 'zlib binding closed');
  this._handle.params(level, strategy);
  if (!this.destroyed) {
    this._level = level;
    this._strategy = strategy;
    if (callback) callback();
  }
}

Zlib.prototype.params = function params(this: Any, level: number, strategy: number, callback: Any) {
  checkRangesOrGetDefault(level, 'level', Z_MIN_LEVEL, Z_MAX_LEVEL);
  checkRangesOrGetDefault(strategy, 'strategy', Z_DEFAULT_STRATEGY, Z_FIXED);

  if (this._level !== level || this._strategy !== strategy) {
    this.flush(
      Z_SYNC_FLUSH,
      paramsAfterFlushCallback.bind(this, level, strategy, callback),
    );
  } else {
    // Node's nextTick throws for a missing callback; ours would fail later
    if (callback) process.nextTick(callback);
  }
};

// generic zlib
// minimal 2-byte header
function Deflate(this: Any, opts?: Any): Any {
  if (!(this instanceof Deflate)) return new (Deflate as Any)(opts);
  Reflect.apply(Zlib, this, [opts, DEFLATE]);
}
Object.setPrototypeOf(Deflate.prototype, Zlib.prototype);
Object.setPrototypeOf(Deflate, Zlib);

function Inflate(this: Any, opts?: Any): Any {
  if (!(this instanceof Inflate)) return new (Inflate as Any)(opts);
  Reflect.apply(Zlib, this, [opts, INFLATE]);
}
Object.setPrototypeOf(Inflate.prototype, Zlib.prototype);
Object.setPrototypeOf(Inflate, Zlib);

function Gzip(this: Any, opts?: Any): Any {
  if (!(this instanceof Gzip)) return new (Gzip as Any)(opts);
  Reflect.apply(Zlib, this, [opts, GZIP]);
}
Object.setPrototypeOf(Gzip.prototype, Zlib.prototype);
Object.setPrototypeOf(Gzip, Zlib);

function Gunzip(this: Any, opts?: Any): Any {
  if (!(this instanceof Gunzip)) return new (Gunzip as Any)(opts);
  Reflect.apply(Zlib, this, [opts, GUNZIP]);
}
Object.setPrototypeOf(Gunzip.prototype, Zlib.prototype);
Object.setPrototypeOf(Gunzip, Zlib);

function DeflateRaw(this: Any, opts?: Any): Any {
  if (opts && opts.windowBits === 8) opts.windowBits = 9;
  if (!(this instanceof DeflateRaw)) return new (DeflateRaw as Any)(opts);
  Reflect.apply(Zlib, this, [opts, DEFLATERAW]);
}
Object.setPrototypeOf(DeflateRaw.prototype, Zlib.prototype);
Object.setPrototypeOf(DeflateRaw, Zlib);

function InflateRaw(this: Any, opts?: Any): Any {
  if (!(this instanceof InflateRaw)) return new (InflateRaw as Any)(opts);
  Reflect.apply(Zlib, this, [opts, INFLATERAW]);
}
Object.setPrototypeOf(InflateRaw.prototype, Zlib.prototype);
Object.setPrototypeOf(InflateRaw, Zlib);

function Unzip(this: Any, opts?: Any): Any {
  if (!(this instanceof Unzip)) return new (Unzip as Any)(opts);
  Reflect.apply(Zlib, this, [opts, UNZIP]);
}
Object.setPrototypeOf(Unzip.prototype, Zlib.prototype);
Object.setPrototypeOf(Unzip, Zlib);

function createConvenienceMethod(ctor: Any, sync: true): (buffer: Any, opts?: Any) => Any;
function createConvenienceMethod(ctor: Any, sync: false): (buffer: Any, opts: Any, callback?: Any) => void;
function createConvenienceMethod(ctor: Any, sync: boolean) {
  if (sync) {
    return function syncBufferWrapper(buffer: Any, opts?: Any) {
      return zlibBufferSync(new ctor(opts), buffer);
    };
  }
  return function asyncBufferWrapper(buffer: Any, opts: Any, callback?: Any) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    return zlibBuffer(new ctor(opts), buffer, callback);
  };
}

const kMaxBrotliParam = Math.max(
  ...Object.entries(constants)
    .map(([key, value]) => (key.startsWith('BROTLI_PARAM_') ? value : 0)),
);
const brotliInitParamsArray = new Uint32Array(kMaxBrotliParam + 1);

const brotliDefaultOpts = {
  flush: BROTLI_OPERATION_PROCESS,
  finishFlush: BROTLI_OPERATION_FINISH,
  fullFlush: BROTLI_OPERATION_FLUSH,
};
function Brotli(this: Any, opts: Any, mode: number) {
  assert(mode === BROTLI_DECODE || mode === BROTLI_ENCODE);

  brotliInitParamsArray.fill(-1);
  if (opts?.params) {
    Object.keys(opts.params).forEach((origKey) => {
      const key = +origKey;
      if (Number.isNaN(key) || key < 0 || key > kMaxBrotliParam ||
          (brotliInitParamsArray[key]! | 0) !== -1) {
        throw ERR_BROTLI_INVALID_PARAM(origKey);
      }

      const value = opts.params[origKey];
      if (typeof value !== 'number' && typeof value !== 'boolean') {
        throw ERR_INVALID_ARG_TYPE('options.params[key]',
                                   'number', opts.params[origKey]);
      }
      brotliInitParamsArray[key] = value as number;
    });
  }

  const handle: Any = mode === BROTLI_DECODE ?
    new (binding.BrotliDecoder as Any)(mode) : new (binding.BrotliEncoder as Any)(mode);

  this._writeState = new Uint32Array(2);
  handle.init(brotliInitParamsArray, this._writeState, processCallback);

  Reflect.apply(ZlibBase, this, [opts, mode, handle, brotliDefaultOpts]);
}
Object.setPrototypeOf(Brotli.prototype, Zlib.prototype);
Object.setPrototypeOf(Brotli, Zlib);

function BrotliCompress(this: Any, opts?: Any): Any {
  if (!(this instanceof BrotliCompress)) return new (BrotliCompress as Any)(opts);
  Reflect.apply(Brotli, this, [opts, BROTLI_ENCODE]);
}
Object.setPrototypeOf(BrotliCompress.prototype, Brotli.prototype);
Object.setPrototypeOf(BrotliCompress, Brotli);

function BrotliDecompress(this: Any, opts?: Any): Any {
  if (!(this instanceof BrotliDecompress)) return new (BrotliDecompress as Any)(opts);
  Reflect.apply(Brotli, this, [opts, BROTLI_DECODE]);
}
Object.setPrototypeOf(BrotliDecompress.prototype, Brotli.prototype);
Object.setPrototypeOf(BrotliDecompress, Brotli);


const zstdDefaultOpts = {
  flush: ZSTD_e_continue,
  finishFlush: ZSTD_e_end,
  fullFlush: ZSTD_e_flush,
};
class Zstd extends (ZlibBase as Any) {
  constructor(opts: Any, mode: number, initParamsArray: Uint32Array, maxParam: number) {
    assert(mode === ZSTD_COMPRESS || mode === ZSTD_DECOMPRESS);

    initParamsArray.fill(-1);
    if (opts?.params) {
      Object.keys(opts.params).forEach((origKey) => {
        const key = +origKey;
        if (Number.isNaN(key) || key < 0 || key > maxParam ||
            (initParamsArray[key]! | 0) !== -1) {
          throw ERR_ZSTD_INVALID_PARAM(origKey);
        }

        const value = opts.params[origKey];
        if (typeof value !== 'number' && typeof value !== 'boolean') {
          throw ERR_INVALID_ARG_TYPE('options.params[key]',
                                     'number', opts.params[origKey]);
        }
        initParamsArray[key] = value as number;
      });
    }

    const handle: Any = mode === ZSTD_COMPRESS ?
      new (binding.ZstdCompress as Any)() : new (binding.ZstdDecompress as Any)();

    const pledgedSrcSize = opts?.pledgedSrcSize ?? undefined;

    const writeState = new Uint32Array(2);

    handle.init(
      initParamsArray,
      pledgedSrcSize,
      writeState,
      processCallback,
      opts?.dictionary && isArrayBufferView(opts.dictionary) ? opts.dictionary : undefined,
    );

    super(opts, mode, handle, zstdDefaultOpts);
    (this as Any)._writeState = writeState;
  }
}

const kMaxZstdCParam = Math.max(...Object.keys(constants).map(
  (key) => (key.startsWith('ZSTD_c_') ?
    (constants as Any)[key] :
    0),
));

const zstdInitCParamsArray = new Uint32Array(kMaxZstdCParam + 1);

class ZstdCompress extends Zstd {
  constructor(opts?: Any) {
    super(opts, ZSTD_COMPRESS, zstdInitCParamsArray, kMaxZstdCParam);
  }
}

const kMaxZstdDParam = Math.max(...Object.keys(constants).map(
  (key) => (key.startsWith('ZSTD_d_') ?
    (constants as Any)[key] :
    0),
));

const zstdInitDParamsArray = new Uint32Array(kMaxZstdDParam + 1);

class ZstdDecompress extends Zstd {
  constructor(opts?: Any) {
    super(opts, ZSTD_DECOMPRESS, zstdInitDParamsArray, kMaxZstdDParam);
  }
}

export function crc32(data: string | ArrayBufferView, value = 0): number {
  if (typeof data !== 'string' && !isArrayBufferView(data)) {
    throw ERR_INVALID_ARG_TYPE('data', ['Buffer', 'TypedArray', 'DataView', 'string'], data);
  }
  validateUint32(value, 'value');
  return binding.crc32(data, value);
}

// Legacy alias on the C++ wrapper object. This is not public API, so we may
// want to runtime-deprecate it at some point. There's no hurry, though.
Object.defineProperty(binding.Zlib.prototype, 'jsref', {
  get() { return this[owner_symbol]; },
  set(v) { this[owner_symbol] = v; },
});

// The classes and helpers, for the typed API in ./index (Node's module.exports)
export const impl = {
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
  createConvenienceMethod,
};
