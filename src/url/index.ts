/**
 * Node's url, ported from Node 22 (lib/url.js and lib/internal/url.js) on
 * ada, the WHATWG URL parser Node uses: URL, URLSearchParams, the legacy
 * parse() / format() / resolve(), fileURLToPath(), pathToFileURL(), ...
 */
import type { Buffer } from 'buffer';
import type { ParsedUrlQuery, ParsedUrlQueryInput } from '../querystring';
import * as impl from './url';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Node's URLSearchParams. */
export interface URLSearchParams extends Iterable<[string, string]> {
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  entries(): IterableIterator<[string, string]>;
  forEach<TThis = this>(fn: (this: TThis, value: string, name: string, searchParams: URLSearchParams) => void, thisArg?: TThis): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  keys(): IterableIterator<string>;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

export interface URLSearchParamsConstructor {
  new (
    init?: URLSearchParams | string | Record<string, string | readonly string[]> | Iterable<[string, string]> | ReadonlyArray<[string, string]>,
  ): URLSearchParams;
  prototype: URLSearchParams;
}

/** Node's URL: the WHATWG URL. */
export interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toString(): string;
  toJSON(): string;
}

export interface URLConstructor {
  new (input: string | { toString(): string }, base?: string | URL): URL;
  prototype: URL;
  /** Whether `input` (against `base`) is a URL, without throwing. */
  canParse(input: string, base?: string): boolean;
  /** The URL, or null where the constructor would throw. */
  parse(input: string, base?: string): URL | null;
  /** React Native's: a URL for a React Native Blob. */
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export const URL = impl.URL as unknown as URLConstructor;
export const URLSearchParams = impl.URLSearchParams as unknown as URLSearchParamsConstructor;

/** What url.format() takes, as Node's url.UrlObject. */
export interface UrlObject {
  auth?: string | null | undefined;
  hash?: string | null | undefined;
  host?: string | null | undefined;
  hostname?: string | null | undefined;
  href?: string | null | undefined;
  pathname?: string | null | undefined;
  protocol?: string | null | undefined;
  search?: string | null | undefined;
  slashes?: boolean | null | undefined;
  port?: string | number | null | undefined;
  query?: string | null | ParsedUrlQueryInput | undefined;
}

/** The legacy Url, what url.parse() returns. */
export interface Url {
  auth: string | null;
  hash: string | null;
  host: string | null;
  hostname: string | null;
  href: string;
  path: string | null;
  pathname: string | null;
  protocol: string | null;
  search: string | null;
  slashes: boolean | null;
  port: string | null;
  query: string | null | ParsedUrlQuery;
  parse(url: string, parseQueryString?: boolean, slashesDenoteHost?: boolean): this;
  format(): string;
  resolve(relative: string): string;
  resolveObject(relative: string | Url): Url;
}
export interface UrlWithParsedQuery extends Url {
  query: ParsedUrlQuery;
}
export interface UrlWithStringQuery extends Url {
  query: string | null;
}

export const Url = impl.Url as unknown as { new (): Url; prototype: Url };

/** Node's url.URLFormatOptions. */
export interface URLFormatOptions {
  auth?: boolean | undefined;
  fragment?: boolean | undefined;
  search?: boolean | undefined;
  unicode?: boolean | undefined;
}

export interface FileUrlToPathOptions {
  /** Read the URL as a Windows path. Defaults to false (as on Linux and macOS). */
  windows?: boolean | undefined;
}
export interface PathToFileUrlOptions {
  windows?: boolean | undefined;
}

/** The legacy URL parser. @deprecated Node: use the WHATWG URL. */
export const parse = impl.parse as {
  (urlString: string): UrlWithStringQuery;
  (urlString: string, parseQueryString: false | undefined, slashesDenoteHost?: boolean): UrlWithStringQuery;
  (urlString: string, parseQueryString: true, slashesDenoteHost?: boolean): UrlWithParsedQuery;
  (urlString: string, parseQueryString: boolean, slashesDenoteHost?: boolean): Url;
};

export const format = impl.format as {
  (urlObject: URL, options?: URLFormatOptions): string;
  (urlObject: UrlObject | string): string;
};

/** @deprecated Node: use the WHATWG URL. */
export const resolve = impl.resolve as (from: string, to: string) => string;
/** @deprecated Node: use the WHATWG URL. */
export const resolveObject = impl.resolveObject as (from: string | Url, to: string) => Url;
export const domainToASCII = impl.domainToASCII as (domain: string) => string;
export const domainToUnicode = impl.domainToUnicode as (domain: string) => string;
export const fileURLToPath = impl.fileURLToPath as (url: string | URL, options?: FileUrlToPathOptions) => string;
export const fileURLToPathBuffer = impl.fileURLToPathBuffer as (url: string | URL, options?: FileUrlToPathOptions) => Buffer;
export const pathToFileURL = impl.pathToFileURL as (path: string, options?: PathToFileUrlOptions) => URL;
/** The options for http.request() of a URL. */
export const urlToHttpOptions = impl.urlToHttpOptions as (url: URL) => Record<string, any>;

const url = {
  Url,
  parse,
  resolve,
  resolveObject,
  format,
  URL,
  URLSearchParams,
  domainToASCII,
  domainToUnicode,
  pathToFileURL,
  fileURLToPath,
  fileURLToPathBuffer,
  urlToHttpOptions,
};

export default url;
