import { NitroDns, NitroDnsInit, NitroUv } from '../native';
import process from '../process';
import { setTimeout, clearTimeout } from '../timers';
import type { Timeout } from '../timers';
import { isIP } from '../ip';
import { dnsError } from '../errors';
import { rethrowLater } from '../utils';
import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  validateOneOf,
} from '../node-errors';
import {
  validateBoolean,
  validateFunction,
  validateNumber,
  validateString,
} from '../node-internals';
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

// getaddrinfo() flags for lookup()'s `hints`: the system's AI_* values, as Node's
/** Only the address families the device has a (non-loopback) address of. */
export const ADDRCONFIG = NitroDns.AI_ADDRCONFIG;
/** With V4MAPPED: the IPv6 addresses and the mapped IPv4 ones. */
export const ALL = NitroDns.AI_ALL;
/** family 6 without IPv6 addresses: the IPv4 ones, mapped (::ffff:1.2.3.4). */
export const V4MAPPED = NitroDns.AI_V4MAPPED;

/** The order of lookup()'s addresses, Node's dns order. */
export type ResultOrder = 'verbatim' | 'ipv4first' | 'ipv6first';

const validFamilies = [0, 4, 6];
const validDnsOrders: readonly ResultOrder[] = [
  'verbatim',
  'ipv4first',
  'ipv6first',
];

let dnsOrder: ResultOrder = 'verbatim';

/** The order lookup() gives addresses in by default: 'verbatim' unless set. */
export function getDefaultResultOrder(): ResultOrder {
  return dnsOrder;
}

/** Sets lookup()'s default order: 'verbatim' (as the resolver answers), 'ipv4first' or 'ipv6first'. */
export function setDefaultResultOrder(order: ResultOrder): void {
  validateOneOf(order, 'dnsOrder', validDnsOrders);
  dnsOrder = order;
}

/**
 * Options of lookup(), Node's dns.LookupOptions, plus `timeout`, which Node
 * does not have.
 */
export interface LookupOptions {
  /** 0 (both, the default), 4 or 6; 'IPv4' and 'IPv6' are accepted too. */
  family?: number | 'IPv4' | 'IPv6';
  /** ADDRCONFIG, V4MAPPED and ALL, or'ed together. */
  hints?: number;
  /** Answer with every address instead of the first one. */
  all?: boolean;
  /** The order of the addresses. Defaults to getDefaultResultOrder(). */
  order?: ResultOrder;
  /** true: order 'verbatim', false: 'ipv4first'. @deprecated Node: use order. */
  verbatim?: boolean;
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

  NitroDns[query](hostname).then(
    (addresses) => rethrowLater(() => settle(null, addresses)),
    (reason: unknown) =>
      rethrowLater(() =>
        settle(dnsError(nativeErrorCode(reason), syscall, hostname), []),
      ),
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

interface ParsedLookup {
  family: number;
  hints: number;
  all: boolean;
  order: ResultOrder;
  timeout?: number;
}

function validateHints(hints: number): void {
  if ((hints & ~(ADDRCONFIG | ALL | V4MAPPED)) !== 0) {
    throw ERR_INVALID_ARG_VALUE('hints', hints);
  }
}

/** Node's handling of lookup()'s options object (or family number). */
export function parseLookupOptions(
  options: number | LookupOptions | undefined,
): ParsedLookup {
  const parsed: ParsedLookup = {
    family: 0,
    hints: 0,
    all: false,
    order: getDefaultResultOrder(),
  };
  if (typeof options === 'number') {
    validateOneOf(options, 'family', validFamilies);
    parsed.family = options;
    return parsed;
  }
  if (options?.hints != null) {
    validateNumber(options.hints, 'options.hints');
    parsed.hints = options.hints >>> 0;
    validateHints(parsed.hints);
  }
  if (options?.family != null) {
    switch (options.family) {
      case 'IPv4':
        parsed.family = 4;
        break;
      case 'IPv6':
        parsed.family = 6;
        break;
      default:
        validateOneOf(options.family, 'options.family', validFamilies);
        parsed.family = options.family;
        break;
    }
  }
  if (options?.all != null) {
    validateBoolean(options.all, 'options.all');
    parsed.all = options.all;
  }
  if (options?.verbatim != null) {
    validateBoolean(options.verbatim, 'options.verbatim');
    parsed.order = options.verbatim ? 'verbatim' : 'ipv4first';
  }
  if (options?.order != null) {
    validateOneOf(options.order, 'options.order', validDnsOrders);
    parsed.order = options.order;
  }
  if (options?.timeout != null) {
    parsed.timeout = validateTimeout(options.timeout);
  }
  return parsed;
}

let invalidHostnameWarningEmitted = false;

export function emitInvalidHostnameWarning(hostname: unknown): void {
  if (!invalidHostnameWarningEmitted) {
    // Node's process.emitWarning()
    console.warn(
      `[DEP0118] DeprecationWarning: The provided hostname "${hostname}" is not a valid ` +
        'hostname, and is supported in the dns module solely for compatibility.',
    );
    invalidHostnameWarningEmitted = true;
  }
}

/** Which address families the device has a non-loopback address of, for ADDRCONFIG. */
function configuredFamilies(): { v4: boolean; v6: boolean } {
  let v4 = false;
  let v6 = false;
  try {
    for (const iface of NitroUv.uv_interface_addresses()) {
      if (iface.internal) continue;
      if (iface.family === 'IPv4') v4 = true;
      if (iface.family === 'IPv6') v6 = true;
    }
  } catch {
    // not known: keep everything, as getaddrinfo() does without interfaces
    return { v4: true, v6: true };
  }
  return { v4, v6 };
}

function ordered(
  addresses: LookupAddress[],
  order: ResultOrder,
): LookupAddress[] {
  if (order === 'verbatim') return addresses;
  const first = order === 'ipv4first' ? 4 : 6;
  return [
    ...addresses.filter((a) => a.family === first),
    ...addresses.filter((a) => a.family !== first),
  ];
}

function addressesOf(list: string[], family: number): LookupAddress[] {
  return list.map((address) => ({
    address,
    family: family === 0 ? isIP(address) : family,
  }));
}

const mapped = (a: LookupAddress): LookupAddress => ({
  address: `::ffff:${a.address}`,
  family: 6,
});

/**
 * The addresses of `hostname`, as getaddrinfo() with these hints would give
 * them, on the native resolver.
 */
export function lookupAddresses(
  hostname: string,
  { family, hints, order, timeout }: ParsedLookup,
  callback: (err: DnsException | null, addresses: LookupAddress[]) => void,
): void {
  const done = (err: DnsException | null, found: LookupAddress[]) => {
    if (err) {
      // lookup() reports every failure as a getaddrinfo one, like Node, which
      // also calls "no data" ENOTFOUND (its DNSException)
      const code = err.code === NODATA ? NOTFOUND : err.code ?? 'EUNKNOWN';
      callback(dnsError(code, 'getaddrinfo', hostname), []);
      return;
    }
    let addresses = found;
    if ((hints & ADDRCONFIG) !== 0) {
      const { v4, v6 } = configuredFamilies();
      addresses = addresses.filter((a) => (a.family === 4 ? v4 : v6));
    }
    if (addresses.length === 0) {
      callback(dnsError(NOTFOUND, 'getaddrinfo', hostname), []);
      return;
    }
    callback(null, ordered(addresses, order));
  };

  if (family === 4) {
    resolve4(hostname, { timeout }, (err, list) =>
      done(err, addressesOf(list, 4)),
    );
  } else if (family === 0) {
    resolve46(hostname, { timeout }, (err, list) =>
      done(err, addressesOf(list, 0)),
    );
  } else if ((hints & V4MAPPED) === 0) {
    resolve6(hostname, { timeout }, (err, list) =>
      done(err, addressesOf(list, 6)),
    );
  } else {
    // V4MAPPED: the IPv4 addresses, mapped, when there is no IPv6 one, or
    // after the IPv6 ones with ALL
    resolve6(hostname, { timeout }, (err6, list6) => {
      const v6 = err6 ? [] : addressesOf(list6, 6);
      if (v6.length > 0 && (hints & ALL) === 0) {
        done(null, v6);
        return;
      }
      resolve4(hostname, { timeout }, (err4, list4) => {
        const v4 = err4 ? [] : addressesOf(list4, 4).map(mapped);
        if (v6.length === 0 && v4.length === 0) {
          done(err4 ?? err6, []);
          return;
        }
        done(null, [...v6, ...v4]);
      });
    });
  }
}

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
  if (hostname) {
    validateString(hostname, 'hostname');
  }

  let parsed: ParsedLookup;
  if (typeof options === 'function') {
    callback = options;
    parsed = parseLookupOptions(undefined);
  } else if (
    options !== undefined &&
    typeof options !== 'object' &&
    typeof options !== 'number'
  ) {
    validateFunction(arguments.length === 2 ? options : callback, 'callback');
    throw ERR_INVALID_ARG_TYPE('options', ['integer', 'object'], options);
  } else {
    validateFunction(callback, 'callback');
    parsed = parseLookupOptions(options);
  }
  const { family, all } = parsed;
  const done = callback!;

  if (!hostname) {
    emitInvalidHostnameWarning(hostname);
    if (all) {
      process.nextTick(done, null, []);
    } else {
      process.nextTick(done, null, null, family === 6 ? 6 : 4);
    }
    return;
  }

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

  lookupAddresses(hostname, parsed, (err, addresses) => {
    if (err) {
      process.nextTick(done, err);
    } else if (all) {
      process.nextTick(done, null, addresses);
    } else {
      process.nextTick(done, null, addresses[0]!.address, addresses[0]!.family);
    }
  });
}

export * as promises from './promises/promises';
