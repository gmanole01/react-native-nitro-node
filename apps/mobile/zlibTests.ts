import zlib, {
  constants,
  crc32,
  createGunzip,
  createGzip,
  deflateRawSync,
  deflateSync,
  gunzip,
  gunzipSync,
  gzip,
  gzipSync,
  inflateRawSync,
  inflateSync,
  unzipSync,
} from 'react-native-nitro-node/zlib';
import { setImmediate } from 'react-native-nitro-node/timers';
import { Readable, Writable } from 'react-native-nitro-node/stream';
import streamPromises, { finished, pipeline } from 'react-native-nitro-node/stream/promises';
import { Buffer } from 'buffer';
import { type Step, expectThrow } from './testUtils';

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

const TEXT = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
const DICTIONARY = Buffer.from('quick brown fox lazy dog');

// Made by Node 22's zlib. The system zlib can compress to other bytes, so
// what this library compresses is checked by decompressing it, and what
// Node compresses with these.
const NODE = {
  gzip: 'H4sIAAAAAAAAEwvJSFUoLM1MzlZIKsovz1NIy69QyCrNLShWyC9LLVIoyUhVyEmsqlRIyU/XUwgZVTyqeFQxtRUDAOZKZrCEAwAA',
  deflate: 'eJwLyUhVKCzNTM5WSCrKL89TSMuvUMgqzS0oVsgvSy1SKMlIVchJrKpUSMlP11MIGVU8qnhUMbUVAwBHpUMc',
  deflateRaw: 'C8lIVSgszUzOVkgqyi/PU0jLr1DIKs0tKFbIL0stUijJSFXISayqVEjJT9dTCBlVPKp4VDG1FQMA',
  deflateDict: 'eLtypQkNC8lIVShEk8sqzS0oVsgvSy1SKMlIhSvVUxhVPKp4VDHVFQMAR6VDHA==',
  twoMembers: 'H4sIAAAAAAAAE0vLLCouUQAA/HrxHAYAAAAfiwgAAAAAAAATK05Nzs9LAQBpER+2BgAAAA==',
  // Brotli and zstd are the versions Node bundles: these are the exact bytes
  brotli: 'G4MDiCwOeNPQlV2XELsXK6nK0JLMjK1BXObyNsgZnp4Ke4MNOHBIIG8kvkGnFc4cHieqKTjCibhPgwE=',
  brotliQ5: 'G4MDAETbRqkuJFsyFMVTkWdy8ucoUBWYV7ayWdBs4ZWnI/KirDYmuEUfGCdidf8hMBkA',
  zstd: 'KLUv/WCEArUBANQCVGhlIHF1aWNrIGJyb3duIGZveCBqdW1wcyBvdmVyIHRoZSBsYXp5IGRvZy4gAQClCitVBg==',
  zstdLevel19Checksum: 'KLUv/WSEArUBANQCVGhlIHF1aWNrIGJyb3duIGZveCBqdW1wcyBvdmVyIHRoZSBsYXp5IGRvZy4gAQClCitVBlkT+oU=',
  zstdDict: 'KLUv/WCEAj0BAOhUaGUganVtcHMgb3ZlciB0aGUgbGF6eSBkb2cuIAIAUYWqGo/MLA==',
  // zstdCompress(): streamed, so without the content size in the header (as Node's)
  zstdAsync: 'KLUv/QBYtQEA1AJUaGUgcXVpY2sgYnJvd24gZm94IGp1bXBzIG92ZXIgdGhlIGxhenkgZG9nLiABAKUKK1UG',
};
const fromNode = (name: keyof typeof NODE) => Buffer.from(NODE[name], 'base64');

/** Runs a zlib stream over `chunks` and collects its output. */
function runStream(stream: any, chunks: Buffer[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => parts.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(parts)));
    stream.on('error', reject);
    for (const chunk of chunks) {
      stream.write(chunk);
    }
    stream.end();
  });
}

function pieces(data: Buffer, size: number): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < data.length; i += size) {
    out.push(data.subarray(i, i + size));
  }
  return out;
}

export async function runZlibTests(step: Step) {
  await step('zlib: reads what Node compressed', async () => {
    expectEqual('gunzipSync', gunzipSync(fromNode('gzip')).toString(), TEXT);
    expectEqual('inflateSync', inflateSync(fromNode('deflate')).toString(), TEXT);
    expectEqual('inflateRawSync', inflateRawSync(fromNode('deflateRaw')).toString(), TEXT);
    expectEqual('unzipSync, gzip', unzipSync(fromNode('gzip')).toString(), TEXT);
    expectEqual('unzipSync, deflate', unzipSync(fromNode('deflate')).toString(), TEXT);
    expectEqual('with a dictionary', inflateSync(fromNode('deflateDict'), { dictionary: DICTIONARY }).toString(), TEXT);
    expectEqual('two gzip members', gunzipSync(fromNode('twoMembers')).toString(), 'first second');
    return '7 Node-made inputs';
  });

  await step('zlib: compresses and decompresses (sync)', async () => {
    const input = Buffer.from(TEXT);
    const cases: Array<[string, Buffer, Buffer]> = [
      ['deflate', deflateSync(input), inflateSync(deflateSync(input))],
      ['deflate level 9', deflateSync(input, { level: 9 }), inflateSync(deflateSync(input, { level: 9 }))],
      ['deflate level 0', deflateSync(input, { level: 0 }), inflateSync(deflateSync(input, { level: 0 }))],
      ['gzip', gzipSync(input), gunzipSync(gzipSync(input))],
      ['deflateRaw', deflateRawSync(input), inflateRawSync(deflateRawSync(input))],
      ['dictionary', deflateSync(input, { dictionary: DICTIONARY }), inflateSync(deflateSync(input, { dictionary: DICTIONARY }), { dictionary: DICTIONARY })],
    ];
    for (const [label, packed, back] of cases) {
      expectEqual(`${label} round trip`, back.toString(), TEXT);
      if (label !== 'deflate level 0' && packed.length >= input.length) {
        throw new Error(`${label}: ${packed.length} bytes for ${input.length}`);
      }
    }
    expectEqual('gzip header', [...gzipSync('x').subarray(0, 2)], [0x1f, 0x8b]);
    expectEqual('empty input', gunzipSync(gzipSync(Buffer.alloc(0))).length, 0);
    return cases.map(([label, packed]) => `${label} ${packed.length}`).join(', ');
  });

  await step('zlib: async functions and streams', async log => {
    // big enough to take more than one step through the thread pool
    const big = Buffer.alloc(3 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) {
      big[i] = (i * 7 + (i >> 10)) & 0xff;
    }

    // the JS thread stays free while it compresses
    let ticks = 0;
    let ticking = true;
    const tick = () => {
      ticks++;
      if (ticking) {
        setImmediate(tick);
      }
    };
    setImmediate(tick);
    const start = Date.now();
    const packed = await new Promise<Buffer>((resolve, reject) =>
      gzip(big, (err, result) => (err ? reject(err) : resolve(result))),
    );
    ticking = false;
    const elapsed = Date.now() - start;
    log(`gzip of ${big.length} bytes: ${packed.length} bytes in ${elapsed}ms, ${ticks} immediates ran meanwhile`);

    const back = await new Promise<Buffer>((resolve, reject) =>
      gunzip(packed, (err, result) => (err ? reject(err) : resolve(result))),
    );
    expectEqual('async round trip', back.equals(big), true);

    const streamed = await runStream(createGzip(), pieces(big, 65536));
    const unstreamed = await runStream(createGunzip(), pieces(streamed, 1000));
    expectEqual('stream round trip', unstreamed.equals(big), true);

    // flush(): what came out so far decompresses on its own
    const deflate = zlib.createDeflate();
    const parts: Buffer[] = [];
    deflate.on('data', (chunk: Buffer) => parts.push(chunk));
    deflate.write('first part ');
    await new Promise<void>(resolve => deflate.flush(constants.Z_SYNC_FLUSH, () => resolve()));
    expectEqual(
      'after flush()',
      inflateSync(Buffer.concat(parts), { finishFlush: constants.Z_SYNC_FLUSH }).toString(),
      'first part ',
    );
    deflate.end('second');
    await new Promise(resolve => deflate.on('end', resolve));
    expectEqual('whole stream', inflateSync(Buffer.concat(parts)).toString(), 'first part second');
    return `${ticks} immediates during a ${elapsed}ms gzip`;
  }, 30000);

  await step('zlib: errors, as Node', async () => {
    let err: any = expectThrowAny(() => inflateSync(Buffer.from('not zlib at all')));
    expectEqual('bad header', [err.code, err.errno, err.message], ['Z_DATA_ERROR', -3, 'incorrect header check']);
    err = expectThrowAny(() => gunzipSync(fromNode('gzip').subarray(0, 20)));
    expectEqual('truncated', [err.code, err.errno, err.message], ['Z_BUF_ERROR', -5, 'unexpected end of file']);
    err = expectThrowAny(() => inflateSync(fromNode('deflateDict')));
    expectEqual('missing dictionary', [err.code, err.message], ['Z_NEED_DICT', 'Missing dictionary']);
    err = expectThrowAny(() => inflateSync(deflateSync(TEXT), { maxOutputLength: 10 }));
    expectEqual('maxOutputLength', [err.code, err.message], ['ERR_BUFFER_TOO_LARGE', 'Cannot create a Buffer larger than 10 bytes']);

    const asyncErr: any = await new Promise(resolve => zlib.inflate(Buffer.from('nope'), (e: any) => resolve(e)));
    expectEqual('async bad header', asyncErr?.code, 'Z_DATA_ERROR');

    err = expectThrowAny(() => zlib.createGzip({ level: 99 }));
    expectEqual('level 99', err.message, 'The value of "options.level" is out of range. It must be >= -1 and <= 9. Received 99');
    expectThrow('gzipSync(5)', 'TypeError', () => gzipSync(5 as any));
    return 'zlib, range and type errors with Node\'s codes and messages';
  });

  await step('zlib: Brotli, the same bytes as Node', async () => {
    const { BROTLI_PARAM_QUALITY } = constants;
    expectEqual('brotliCompressSync', zlib.brotliCompressSync(TEXT).toString('base64'), NODE.brotli);
    expectEqual(
      'quality 5',
      zlib.brotliCompressSync(TEXT, { params: { [BROTLI_PARAM_QUALITY]: 5 } }).toString('base64'),
      NODE.brotliQ5,
    );
    expectEqual('brotliDecompressSync', zlib.brotliDecompressSync(fromNode('brotli')).toString(), TEXT);

    const viaCallback = await new Promise<Buffer>((resolve, reject) =>
      zlib.brotliCompress(TEXT, (e, r) => (e ? reject(e) : resolve(r))),
    );
    expectEqual('brotliCompress', viaCallback.toString('base64'), NODE.brotli);
    const streamed = await runStream(zlib.createBrotliCompress(), pieces(Buffer.from(TEXT), 100));
    expectEqual('stream', streamed.toString('base64'), NODE.brotli);
    const back = await runStream(zlib.createBrotliDecompress(), pieces(fromNode('brotli'), 7));
    expectEqual('decompress stream', back.toString(), TEXT);

    const err: any = expectThrowAny(() => zlib.brotliDecompressSync(Buffer.from('this is definitely not compressed data')));
    expectEqual('bad data', [err.code, err.errno, err.message], ['ERR__ERROR_FORMAT_PADDING_1', -14, 'Decompression failed']);
    return `${fromNode('brotli').length} bytes for ${TEXT.length}`;
  });

  await step('zlib: zstd, the same bytes as Node', async () => {
    const { ZSTD_c_compressionLevel, ZSTD_c_checksumFlag } = constants;
    expectEqual('zstdCompressSync', zlib.zstdCompressSync(TEXT).toString('base64'), NODE.zstd);
    expectEqual(
      'level 19 with a checksum',
      zlib.zstdCompressSync(TEXT, { params: { [ZSTD_c_compressionLevel]: 19, [ZSTD_c_checksumFlag]: 1 } }).toString('base64'),
      NODE.zstdLevel19Checksum,
    );
    expectEqual(
      'with a dictionary',
      zlib.zstdCompressSync(TEXT, { dictionary: DICTIONARY }).toString('base64'),
      NODE.zstdDict,
    );
    expectEqual('zstdDecompressSync', zlib.zstdDecompressSync(fromNode('zstdLevel19Checksum')).toString(), TEXT);
    expectEqual(
      'decompress with a dictionary',
      zlib.zstdDecompressSync(fromNode('zstdDict'), { dictionary: DICTIONARY }).toString(),
      TEXT,
    );

    const viaCallback = await new Promise<Buffer>((resolve, reject) =>
      zlib.zstdCompress(TEXT, (e, r) => (e ? reject(e) : resolve(r))),
    );
    expectEqual('zstdCompress', viaCallback.toString('base64'), NODE.zstdAsync);
    const back = await runStream(zlib.createZstdDecompress(), pieces(fromNode('zstd'), 5));
    expectEqual('decompress stream', back.toString(), TEXT);

    let err: any = expectThrowAny(() => zlib.zstdDecompressSync(Buffer.from('this is definitely not compressed data')));
    expectEqual('bad data', [err.code, err.errno, err.message], ['ZSTD_error_prefix_unknown', 10, 'Unknown frame descriptor']);
    err = expectThrowAny(() => zlib.createZstdCompress({ pledgedSrcSize: -1 }));
    expectEqual('negative pledgedSrcSize', [err.code, err.message], ['ERR_INVALID_ARG_VALUE', 'pledgedSrcSize may not be negative']);
    return `${fromNode('zstd').length} bytes for ${TEXT.length}`;
  });

  await step('stream/promises: pipeline() through gzip and gunzip', async () => {
    const parts: Buffer[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void) {
        parts.push(chunk);
        callback();
      },
    });
    await pipeline(Readable.from(pieces(Buffer.from(TEXT), 50)), createGzip(), createGunzip(), sink);
    expectEqual('round trip', Buffer.concat(parts).toString(), TEXT);

    const readable = Readable.from(['x']);
    readable.resume();
    await finished(readable);
    expectEqual('finished', readable.readableEnded, true);

    // a broken stream rejects the pipeline
    const err: any = await pipeline(Readable.from([Buffer.from('not gzip at all')]), createGunzip(), new Writable({
      write(_chunk: Buffer, _encoding: string, callback: () => void) {
        callback();
      },
    })).catch(e => e);
    expectEqual('error', err?.code, 'Z_DATA_ERROR');
    if (streamPromises.pipeline !== pipeline || streamPromises.finished !== finished) {
      throw new Error('the default export is not stream/promises');
    }
    return 'pipeline, finished, errors';
  });

  await step('zlib: crc32 and constants', async () => {
    // Node's values
    expectEqual('crc32', [crc32('hello'), crc32(TEXT), crc32('world', crc32('hello '))], [907060870, 2959493862, 222957957]);
    expectEqual('constants', [constants.Z_FINISH, constants.Z_DEFAULT_CHUNK, constants.GZIP], [4, 16384, 3]);
    expectEqual('codes', [zlib.codes.Z_DATA_ERROR, zlib.codes[-3]], [-3, 'Z_DATA_ERROR']);
    if (constants.ZLIB_VERNUM < 0x1200) {
      throw new Error(`ZLIB_VERNUM ${constants.ZLIB_VERNUM.toString(16)}`);
    }
    return `zlib ${constants.ZLIB_VERNUM.toString(16)}`;
  });
}

/** The error `fn` throws. */
function expectThrowAny(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('did not throw');
}
