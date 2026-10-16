import querystring from './querystring';

const { escape, stringify, encode } = querystring;

export default querystring;
export { escape, stringify, encode };
export type { ParsedUrlQueryInput, StringifyOptions } from './querystring';
