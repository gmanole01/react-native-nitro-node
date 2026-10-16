import readableStream from 'readable-stream';
import type * as NodeStreamPromises from 'stream/promises';

export {
  Duplex,
  PassThrough,
  Readable,
  Stream,
  Transform,
  Writable,
  finished,
  pipeline,
} from 'readable-stream';
export type {
  DuplexOptions,
  ReadableOptions,
  TransformOptions,
  WritableOptions,
} from 'readable-stream';

/**
 * pipeline() and finished() returning promises, as Node's stream/promises.
 * (readable-stream inherits it rather than owning it, so it is read from the
 * module itself: a namespace import would not copy it.)
 */
export const promises = (
  readableStream as unknown as { promises: typeof NodeStreamPromises }
).promises;
