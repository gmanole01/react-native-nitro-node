import type { Buffer } from 'buffer';
import QueryStringImpl from './querystring';

type Primitive = string | number | boolean | bigint;

/** What stringify() accepts, as Node's querystring.ParsedUrlQueryInput. */
export interface ParsedUrlQueryInput {
  [key: string]: Primitive | ReadonlyArray<Primitive> | null | undefined;
}

/** What parse() returns, as Node's querystring.ParsedUrlQuery. */
export interface ParsedUrlQuery {
  [key: string]: string | string[] | undefined;
}

/** Options of stringify(), as Node's querystring.StringifyOptions. */
export interface StringifyOptions {
  /** Percent-encodes keys and values. Defaults to querystring.escape(). */
  encodeURIComponent?: ((str: string) => string) | undefined;
}

/** Options of parse(), as Node's querystring.ParseOptions. */
export interface ParseOptions {
  /** The most keys parsed; 0 for no limit. Defaults to 1000. */
  maxKeys?: number | undefined;
  /** Decodes keys and values. Defaults to querystring.unescape(). */
  decodeURIComponent?: ((str: string) => string) | undefined;
}

interface QueryString {
  stringify(obj?: ParsedUrlQueryInput, sep?: string, eq?: string, options?: StringifyOptions): string;
  parse(str: string, sep?: string, eq?: string, options?: ParseOptions): ParsedUrlQuery;
  /** The same as stringify(). */
  encode(obj?: ParsedUrlQueryInput, sep?: string, eq?: string, options?: StringifyOptions): string;
  /** The same as parse(). */
  decode(str: string, sep?: string, eq?: string, options?: ParseOptions): ParsedUrlQuery;
  escape(str: string): string;
  unescape(str: string): string;
  unescapeBuffer(str: string, decodeSpaces?: boolean): Buffer;
}

/** Node's querystring (ported from lib/querystring.js). */
const querystring = QueryStringImpl as unknown as QueryString;

export const { stringify, parse, encode, decode, escape, unescape, unescapeBuffer } = querystring;
export default querystring;
