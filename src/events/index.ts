import { EventEmitter } from './events';

export * from './events';
// Node's events module is EventEmitter itself (with EventEmitter.EventEmitter,
// once, ... on it), so the default export is too: `import EventEmitter from
// 'events'` must be constructible.
export default EventEmitter;
