import { Stream } from './stream';

export * from './stream';
// Node's stream module is the legacy Stream class, with Readable, Writable,
// pipeline, promises, ... on it: readable-stream's Stream is the same.
export default Stream as typeof Stream & typeof import('./stream');
