import { NitroDns, NitroDnsInit } from '../native';
import process from '../process';
import { setTimeout, clearTimeout } from '../timers';
import type { Timeout } from '../timers';
import { isIP } from '../ip';
import { dnsError } from '../errors';
import type { DnsException } from '../types';

export type { DnsException };

const DEFAULT_RRTYPE = 'A';

// Node's error codes for DNS failures, as `err.code`.
export const NODATA = 'ENODATA';
export const FORMERR = 'EFORMERR';
export const SERVFAIL = 'ESERVFAIL';
export const NOTFOUND = 'ENOTFOUND';
export const NOTIMP = 'ENOTIMP';
export const REFUSED = 'EREFUSED';
export const BADQUERY = 'EBADQUERY';
export const BADNAME = 'EBADNAME';
export const BADFAMILY = 'EBADFAMILY';
export const BADRESP = 'EBADRESP';
export const CONNREFUSED = 'ECONNREFUSED';
export const TIMEOUT = 'ETIMEOUT';
export const EOF = 'EOF';
export const FILE = 'EFILE';
export const NOMEM = 'ENOMEM';
export const DESTRUCTION = 'EDESTRUCTION';
export const BADSTR = 'EBADSTR';
export const BADFLAGS = 'EBADFLAGS';
export const NONAME = 'ENONAME';
export const BADHINTS = 'EBADHINTS';
export const NOTINITIALIZED = 'ENOTINITIALIZED';
export const CANCELLED = 'ECANCELLED';

/** Node's dns.LookupAddress. */
export interface LookupAddress {
  address: string;
  /** 4 or 6 */
  family: number;
}

/**
 * Options of lookup(). A subset of Node's dns.LookupOptions, plus `timeout`,
 * which Node does not have.
 */
export interface LookupOptions {
  /** 0 (both, the default), 4 or 6; 'IPv4' and 'IPv6' are accepted too. */
  family?: number | 'IPv4' | 'IPv6';
  /** Answer with every address instead of the first one. */
  all?: boolean;
  /**
   * Milliseconds after which the lookup fails with ETIMEOUT. 0 disables it.
   * Defaults to the value given to setDefaultTimeout(). Not part of Node.
   */
  timeout?: number;
}

export interface LookupOneOptions extends LookupOptions {
  all?: false;
}

export interface LookupAllOptions extends LookupOptions {
  all: true;
}

/**
 * Options of resolve4() and resolve6(). Node's take `ttl` here instead, which
 * is not supported.
 */
export interface ResolveOptions {
  /**
   * Milliseconds after which the query fails with ETIMEOUT. 0 disables it.
   * Defaults to the value given to setDefaultTimeout(). Not part of Node.
   */
  timeout?: number;
}

type ResolveCallback = (err: DnsException | null, addresses: string[]) => void;

let initialized = false;

// The native resolver has to be set up once before its first query.
function ensureInit(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  NitroDnsInit.init();
}

let defaultTimeout = 0;

function validateTimeout(timeout: unknown): number {
  if (typeof timeout !== 'number' || !(timeout >= 0)) {
    throw new TypeError('timeout must be a non-negative number');
  }
  return timeout;
}

/**
 * Sets how long a query may take when it is not given a timeout of its own,
 * in milliseconds. This also bounds the lookup done by net.connect().
 *
 * 0, the default, leaves it to the native resolver, which gives up by itself
 * after retrying every DNS server a few times. Not part of Node.
 */
export function setDefaultTimeout(timeout: number): void {
  defaultTimeout = validateTimeout(timeout);
}

/** The timeout set with setDefaultTimeout(). Not part of Node. */
export function getDefaultTimeout(): number {
  return defaultTimeout;
}

/**
 * The c-ares error name (ENOTFOUND, ETIMEOUT, ...) of a rejected native query.
 * Native puts it at the start of the rejection message.
 */
function nativeErrorCode(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const match = /^(E[A-Z]+)\b/.exec(message);
  return match ? match[1]! : 'EUNKNOWN';
}

function nativeResolve(
  query: 'resolve' | 'resolve4' | 'resolve6',
  syscall: string,
  hostname: string,
  options: ResolveOptions | undefined,
  callback: ResolveCallback,
): void {
  ensureInit();

  const timeout = validateTimeout(options?.timeout ?? defaultTimeout);

  let settled = false;
  let timer: Timeout | null = null;

  function settle(err: DnsException | null, addresses: string[]) {
    if (settled) {
      // the answer arrived after the timeout, or the other way around
      return;
    }
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    callback(err, addresses);
  }

  if (timeout > 0) {
    // DELIBERATE, do not "fix": the native query is not cancelled when the
    // timeout fires. It runs to its end in the background and its late answer
    // is ignored by settle(). Cancelling it natively was decided against for
    // now.
    timer = setTimeout(() => {
      timer = null;
      settle(dnsError(TIMEOUT, syscall, hostname), []);
    }, timeout);
  }

  NitroDns[query](hostname)
    .then((addresses) => settle(null, addresses))
    .catch((reason: unknown) =>
      settle(dnsError(nativeErrorCode(reason), syscall, hostname), []),
    );
}

/** Resolves the IPv4 addresses (A records) of `hostname`. */
export function resolve4(hostname: string, callback: ResolveCallback): void;
export function resolve4(
  hostname: string,
  options: ResolveOptions,
  callback: ResolveCallback,
): void;
export function resolve4(
  hostname: string,
  optionsOrCallback: ResolveOptions | ResolveCallback,
  callback?: ResolveCallback,
): void {
  if (typeof optionsOrCallback === 'function') {
    return resolve4(hostname, {}, optionsOrCallback);
  }
  nativeResolve('resolve4', 'queryA', hostname, optionsOrCallback, callback!);
}

/** Resolves the IPv6 addresses (AAAA records) of `hostname`. */
export function resolve6(hostname: string, callback: ResolveCallback): void;
export function resolve6(
  hostname: string,
  options: ResolveOptions,
  callback: ResolveCallback,
): void;
export function resolve6(
  hostname: string,
  optionsOrCallback: ResolveOptions | ResolveCallback,
  callback?: ResolveCallback,
): void {
  if (typeof optionsOrCallback === 'function') {
    return resolve6(hostname, {}, optionsOrCallback);
  }
  nativeResolve(
    'resolve6',
    'queryAaaa',
    hostname,
    optionsOrCallback,
    callback!,
  );
}

/**
 * Resolve hostname to a list of addresses (both IPv4 and IPv6)
 */
function resolve46(
  hostname: string,
  options: ResolveOptions,
  callback: ResolveCallback,
): void {
  nativeResolve('resolve', 'getaddrinfo', hostname, options, callback);
}

/**
 * Resolves `hostname` to the records of `rrtype`, 'A' by default. Only 'A' and
 * 'AAAA' are supported.
 */
export function resolve(hostname: string, callback: ResolveCallback): void;
export function resolve(
  hostname: string,
  rrtype: 'A' | 'AAAA',
  callback: ResolveCallback,
): void;
export function resolve(
  hostname: string,
  rrtypeOrCallback: 'A' | 'AAAA' | ResolveCallback,
  callback?: ResolveCallback,
): void {
  if (typeof rrtypeOrCallback === 'function') {
    return resolve(hostname, DEFAULT_RRTYPE, rrtypeOrCallback);
  }

  if (rrtypeOrCallback === 'A') {
    return resolve4(hostname, callback!);
  }

  if (rrtypeOrCallback === 'AAAA') {
    return resolve6(hostname, callback!);
  }

  throw new Error('Unknown record type');
}

type LookupOneCallback = (
  err: DnsException | null,
  address: string,
  family: number,
) => void;
type LookupAllCallback = (
  err: DnsException | null,
  addresses: LookupAddress[],
) => void;

/**
 * Resolves `hostname` to an address, like Node's dns.lookup(). An IP address
 * is answered as is, without a query.
 */
export function lookup(
  hostname: string,
  family: number,
  callback: LookupOneCallback,
): void;
export function lookup(
  hostname: string,
  options: LookupOneOptions,
  callback: LookupOneCallback,
): void;
export function lookup(
  hostname: string,
  options: LookupAllOptions,
  callback: LookupAllCallback,
): void;
export function lookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: DnsException | null,
    address: string | LookupAddress[],
    family: number,
  ) => void,
): void;
export function lookup(hostname: string, callback: LookupOneCallback): void;
export function lookup(
  hostname: string,
  options: number | LookupOptions | LookupOneCallback,
  callback?: (err: DnsException | null, ...results: any[]) => void,
): void {
  let family = 0;
  let all = false;
  let timeout: number | undefined;

  // Parse arguments
  if (typeof options === 'function') {
    callback = options;
  } else if (typeof options === 'number') {
    // Coerce -0 to +0.
    family = options + 0;
  } else if (options !== undefined && typeof options !== 'object') {
    throw new TypeError('options must be integer or object');
  } else {
    if (options?.family != null) {
      switch (options.family) {
        case 'IPv4':
          family = 4;
          break;
        case 'IPv6':
          family = 6;
          break;
        default:
          // Coerce -0 to +0.
          family = options.family + 0;
          break;
      }
    }
    if (options?.all != null) {
      all = options.all;
    }
    if (options?.timeout != null) {
      timeout = options.timeout;
    }
  }

  if (typeof callback !== 'function') {
    throw new TypeError('callback must be a function');
  }
  if (family !== 0 && family !== 4 && family !== 6) {
    throw new TypeError('family must be 0, 4 or 6');
  }
  if (!hostname) {
    throw new TypeError('hostname must be non-empty string');
  }

  const done = callback;

  const matchedFamily = isIP(hostname);
  if (matchedFamily) {
    if (all) {
      process.nextTick(done, null, [
        { address: hostname, family: matchedFamily },
      ]);
    } else {
      process.nextTick(done, null, hostname, matchedFamily);
    }
    return;
  }

  const lookupFunction =
    family === 0 ? resolve46 : family === 4 ? resolve4 : resolve6;

  lookupFunction(hostname, { timeout }, (err, addresses) => {
    if (err) {
      // lookup() reports every failure as a getaddrinfo one, like Node
      process.nextTick(
        done,
        dnsError(err.code ?? 'EUNKNOWN', 'getaddrinfo', hostname),
      );
      return;
    }

    if (all) {
      const results: LookupAddress[] = addresses.map((item) => {
        // if "family" is 0, that means we asked for both IPv4 and IPv6
        // and we need to detect the family of this address; otherwise,
        // use the specified family, "addresses" will only
        // contain this type; this is a performance optimization,
        // because regexes are not the fastest
        const itemFamily = family === 0 ? isIP(item) : family;
        if (itemFamily === 0) {
          throw new Error('Invalid address returned');
        }
        return {
          address: item,
          family: itemFamily,
        };
      });
      process.nextTick(done, null, results);
      return;
    }

    const resAddress = addresses[0]!;
    // same as in the if(all) case
    const resFamily = family === 0 ? isIP(resAddress) : family;
    if (resFamily === 0) {
      throw new Error('Invalid address returned');
    }

    process.nextTick(done, null, resAddress, resFamily);
  });
}
