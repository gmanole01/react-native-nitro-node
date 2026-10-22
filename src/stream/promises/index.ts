import { promises } from '../stream';

// As Node: require('stream/promises') is require('stream').promises
export const { pipeline, finished } = promises;
export default promises;
