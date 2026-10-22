/**
 * Node's internalBinding('url') (and the toASCII/toUnicode of its encoding
 * binding) for the ported lib/internal/url.js and lib/url.js, on the
 * NitroNodeUrl HybridObject. The API is Node's, so the ported code stays as it
 * is: parse() and update() return the href and leave the parts' offsets in
 * urlComponents, as Node's binding does.
 */
import { NitroUrl as native } from '../native';
import type { UrlParsed } from '../native/specs/node.nitro';
import { ERR_INVALID_URL } from '../node-errors';

/** The parts' offsets of the last URL parse() or update() made, as Node's. */
export const urlComponents = new Uint32Array(9);

function take(result: UrlParsed): string {
  urlComponents.set(result.components);
  return result.href;
}

export function parse(input: string, base: string | undefined, raiseException?: boolean): string | undefined {
  const result = native.parse(input, typeof base === 'string' ? base : undefined);
  if (result === undefined) {
    if (raiseException) {
      throw ERR_INVALID_URL(input, typeof base === 'string' ? base : null);
    }
    return undefined;
  }
  return take(result);
}

export function canParse(input: string, base?: string): boolean {
  return native.canParse(input, typeof base === 'string' ? base : undefined);
}

/** The href with one part set; false when the setter refuses the value, as Node's. */
export function update(href: string, action: number, value: string): string | false {
  const result = native.update(href, action, value);
  return result === undefined ? false : take(result);
}

export function format(href: string, hash: boolean, unicode: boolean, search: boolean, auth: boolean): string {
  return native.format(href, hash, unicode, search, auth);
}

export function getOrigin(input: string): string {
  const origin = native.getOrigin(input);
  if (origin === undefined) {
    throw ERR_INVALID_URL(input);
  }
  return origin;
}

export function domainToASCII(input: string): string {
  return native.domainToASCII(input);
}

export function domainToUnicode(input: string): string {
  return native.domainToUnicode(input);
}

export function pathToFileURL(path: string, windows: boolean, hostname?: string): string {
  const result = native.pathToFileURL(path, windows, typeof hostname === 'string' ? hostname : undefined);
  if (result === undefined) {
    throw ERR_INVALID_URL(path);
  }
  return take(result);
}

/** The encoding binding's toASCII(), for lib/url.js. */
export function toASCII(input: string): string {
  return native.toASCII(input);
}

export function toUnicode(input: string): string {
  return native.toUnicode(input);
}
