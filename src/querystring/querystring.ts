type Primitive = string | number | boolean | bigint;

/** What stringify() accepts, as Node's querystring.ParsedUrlQueryInput. */
export interface ParsedUrlQueryInput {
  [key: string]: Primitive | ReadonlyArray<Primitive> | null | undefined;
}

/** Options of stringify(), as Node's querystring.StringifyOptions. */
export interface StringifyOptions {
  /** Percent-encodes keys and values. Defaults to querystring.escape(). */
  encodeURIComponent?: ((str: string) => string) | undefined;
}

type Encode = (str: string) => string;

const QueryString = {
  escape: qsEscape,
  stringify,
  encode: stringify,
};

// Which ASCII characters are left as they are: letters, digits and
// !'()*-._~ (Node's lib/querystring.js).
// prettier-ignore
const noEscape = new Int8Array([
/*
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, A, B, C, D, E, F
*/
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0x00 - 0x0F
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0x10 - 0x1F
  0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, // 0x20 - 0x2F
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 0x30 - 0x3F
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 0x40 - 0x4F
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, // 0x50 - 0x5F
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 0x60 - 0x6F
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, // 0x70 - 0x7F
]);

const hexTable: string[] = new Array(256);
for (let i = 0; i < 256; ++i)
  hexTable[i] =
    '%' +
    String.prototype.toUpperCase.call(
      (i < 16 ? '0' : '') + Number.prototype.toString.call(i, 16),
    );

function encodeStr(
  str: string,
  noEscapeTable: Int8Array,
  hexTable: readonly string[],
): string {
  const len = str.length;
  if (len === 0) return '';

  let out = '';
  let lastPos = 0;
  let i = 0;

  outer: for (; i < len; i++) {
    let c = String.prototype.charCodeAt.call(str, i);

    // ASCII
    while (c < 0x80) {
      if (noEscapeTable[c] !== 1) {
        if (lastPos < i) out += String.prototype.slice.call(str, lastPos, i);
        lastPos = i + 1;
        out += hexTable[c];
      }

      if (++i === len) break outer;

      c = String.prototype.charCodeAt.call(str, i);
    }

    if (lastPos < i) out += String.prototype.slice.call(str, lastPos, i);

    // Multi-byte characters ...
    if (c < 0x800) {
      lastPos = i + 1;
      out += hexTable[0xc0 | (c >> 6)] + hexTable[0x80 | (c & 0x3f)];
      continue;
    }
    if (c < 0xd800 || c >= 0xe000) {
      lastPos = i + 1;
      out +=
        hexTable[0xe0 | (c >> 12)] +
        hexTable[0x80 | ((c >> 6) & 0x3f)] +
        hexTable[0x80 | (c & 0x3f)];
      continue;
    }
    // Surrogate pair
    ++i;

    // This branch should never happen because all URLSearchParams entries
    // should already be converted to USVString. But, included for
    // completion's sake anyway.
    if (i >= len) throw invalidUriError();

    const c2 = String.prototype.charCodeAt.call(str, i) & 0x3ff;

    lastPos = i + 1;
    c = 0x10000 + (((c & 0x3ff) << 10) | c2);
    out +=
      hexTable[0xf0 | (c >> 18)] +
      hexTable[0x80 | ((c >> 12) & 0x3f)] +
      hexTable[0x80 | ((c >> 6) & 0x3f)] +
      hexTable[0x80 | (c & 0x3f)];
  }
  if (lastPos === 0) return str;
  if (lastPos < len) return out + String.prototype.slice.call(str, lastPos);
  return out;
}

/** Node's ERR_INVALID_URI: a lone surrogate can't be percent-encoded. */
function invalidUriError(): URIError & { code: string } {
  const error = new URIError('URI malformed') as URIError & { code: string };
  error.code = 'ERR_INVALID_URI';
  return error;
}

/** Percent-encodes `str` for a query string, as Node's querystring.escape(). */
function qsEscape(str: string): string {
  // Like Node, anything else is converted for callers without types.
  const value: unknown = str;
  if (typeof value !== 'string') {
    if (typeof value === 'object') str = String(value);
    else str = `${value as string}`;
  }

  return encodeStr(str, noEscape, hexTable);
}

function stringifyPrimitive(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return '' + v;
  if (typeof v === 'bigint') return '' + v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return '';
}

function encodeStringified(v: unknown, encode: Encode): string {
  if (typeof v === 'string') return v.length ? encode(v) : '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Values >= 1e21 automatically switch to scientific notation which requires
    // escaping due to the inclusion of a '+' in the output
    return Math.abs(v) < 1e21 ? '' + v : encode('' + v);
  }
  if (typeof v === 'bigint') return '' + v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return '';
}

function encodeStringifiedCustom(v: unknown, encode: Encode): string {
  return encode(stringifyPrimitive(v));
}

/**
 * Builds a query string from the keys of `obj`, as Node's
 * querystring.stringify(). An array value repeats its key.
 */
function stringify(
  obj?: ParsedUrlQueryInput | null,
  sep?: string | null,
  eq?: string | null,
  options?: StringifyOptions,
): string {
  sep ||= '&';
  eq ||= '=';

  let encode: Encode = QueryString.escape;
  if (options && typeof options.encodeURIComponent === 'function') {
    encode = options.encodeURIComponent;
  }
  const convert =
    encode === qsEscape ? encodeStringified : encodeStringifiedCustom;

  if (obj !== null && typeof obj === 'object') {
    const keys = Object.keys(obj);
    const len = keys.length;
    let fields = '';
    for (let i = 0; i < len; ++i) {
      const k = keys[i]!;
      const v = obj[k];
      let ks = convert(k, encode);
      ks += eq;

      if (Array.isArray(v)) {
        const vlen = v.length;
        if (vlen === 0) continue;
        if (fields) fields += sep;
        for (let j = 0; j < vlen; ++j) {
          if (j) fields += sep;
          fields += ks;
          fields += convert(v[j], encode);
        }
      } else {
        if (fields) fields += sep;
        fields += ks;
        fields += convert(v, encode);
      }
    }
    return fields;
  }
  return '';
}

export default QueryString;
