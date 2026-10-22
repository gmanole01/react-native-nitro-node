import * as timers from './timers';
import promises from './promises';

export * from './timers';
// As Node: require('timers').promises is timers/promises
export { promises };
export default { ...timers, promises };
