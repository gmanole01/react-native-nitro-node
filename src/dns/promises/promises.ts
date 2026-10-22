/**
 * Node's dns.promises (also node:dns/promises): lookup() and resolve*()
 * returning promises, on the same resolver as ./dns.
 */
import { isIP } from '../../ip';
import { ERR_INVALID_ARG_TYPE } from '../../node-errors';
import { validateString } from '../../node-internals';
import type { DnsException } from '../../types';
import * as dns from '../dns';
import type { LookupAddress, LookupAllOptions, LookupOneOptions, LookupOptions, ResolveOptions } from '../dns';

export {
  NODATA,
  FORMERR,
  SERVFAIL,
  NOTFOUND,
  NOTIMP,
  REFUSED,
  BADQUERY,
  BADNAME,
  BADFAMILY,
  BADRESP,
  CONNREFUSED,
  TIMEOUT,
  EOF,
  FILE,
  NOMEM,
  DESTRUCTION,
  BADSTR,
  BADFLAGS,
  NONAME,
  BADHINTS,
  NOTINITIALIZED,
  CANCELLED,
  getDefaultResultOrder,
  setDefaultResultOrder,
} from '../dns';

/** Resolves `hostname` to an address, like Node's dnsPromises.lookup(). */
export function lookup(hostname: string, family: number): Promise<LookupAddress>;
export function lookup(hostname: string, options: LookupOneOptions): Promise<LookupAddress>;
export function lookup(hostname: string, options: LookupAllOptions): Promise<LookupAddress[]>;
export function lookup(hostname: string, options?: LookupOptions): Promise<LookupAddress | LookupAddress[]>;
export function lookup(
  hostname: string,
  options?: number | LookupOptions,
): Promise<LookupAddress | LookupAddress[] | { address: null; family: number }> {
  if (hostname) {
    validateString(hostname, 'hostname');
  }
  if (options !== undefined && typeof options !== 'object' && typeof options !== 'number') {
    throw ERR_INVALID_ARG_TYPE('options', ['integer', 'object'], options);
  }
  const parsed = dns.parseLookupOptions(options);
  const { family, all } = parsed;

  return new Promise((resolve, reject) => {
    if (!hostname) {
      dns.emitInvalidHostnameWarning(hostname);
      resolve(all ? [] : { address: null, family: family === 6 ? 6 : 4 });
      return;
    }

    const matchedFamily = isIP(hostname);
    if (matchedFamily !== 0) {
      const result = { address: hostname, family: matchedFamily };
      resolve(all ? [result] : result);
      return;
    }

    dns.lookupAddresses(hostname, parsed, (err: DnsException | null, addresses: LookupAddress[]) => {
      if (err) {
        reject(err);
      } else {
        resolve(all ? addresses : addresses[0]!);
      }
    });
  });
}

function promisified(
  query: (hostname: string, options: ResolveOptions, callback: (err: DnsException | null, a: string[]) => void) => void,
) {
  return (hostname: string, options: ResolveOptions = {}): Promise<string[]> =>
    new Promise((resolve, reject) => {
      query(hostname, options, (err, addresses) => (err ? reject(err) : resolve(addresses)));
    });
}

/** The IPv4 addresses (A records) of `hostname`. */
export const resolve4 = promisified(dns.resolve4);
/** The IPv6 addresses (AAAA records) of `hostname`. */
export const resolve6 = promisified(dns.resolve6);

/** The records of `rrtype`, 'A' by default. Only 'A' and 'AAAA' are supported. */
export function resolve(hostname: string, rrtype: 'A' | 'AAAA' = 'A'): Promise<string[]> {
  if (rrtype === 'A') {
    return resolve4(hostname);
  }
  if (rrtype === 'AAAA') {
    return resolve6(hostname);
  }
  return Promise.reject(new Error('Unknown record type'));
}
