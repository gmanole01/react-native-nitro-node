/**
 * What Node's lib/internal/url.js and lib/url.js take from Node's internals
 * (internal/util, internal/data_url, internal/process/per_thread, ...), for
 * React Native.
 */
import { Platform } from 'react-native';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** internal/util: the first named constructor up an object's prototype chain. */
export function getConstructorOf(obj: any): Function | null {
  while (obj) {
    const descriptor = Object.getOwnPropertyDescriptor(obj, 'constructor');
    if (descriptor !== undefined && typeof descriptor.value === 'function' && descriptor.value.name !== '') {
      return descriptor.value;
    }
    obj = Object.getPrototypeOf(obj);
  }
  return null;
}

export const kEnumerableProperty: PropertyDescriptor = Object.freeze(Object.assign(Object.create(null), { enumerable: true }));
export const kEmptyObject = Object.freeze(Object.create(null));
export const isWindows = false;

/** process.platform, as Node names it, for ERR_INVALID_FILE_URL_HOST. */
export const platform: string = Platform.OS;

/** internal/worker/js_transferable: no workers here. */
export function markTransferMode(_obj: unknown, _cloneable: boolean, _transferable: boolean): void {}

/** internal/options: no Node command line options. */
export function getOptionValue(_name: string): boolean {
  return false;
}

/** internal/util: removes the element at `index` (faster than splice). */
export function spliceOne(list: unknown[], index: number): void {
  for (; index + 1 < list.length; index++) list[index] = list[index + 1];
  list.pop();
}

// ---- internal/data_url ----

const isHexCharByte = (byte: number) =>
  (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x46) || (byte >= 0x61 && byte <= 0x66);

function hexByteToNumber(byte: number): number {
  return (
    // 0-9
    byte >= 0x30 && byte <= 0x39
      ? byte - 48
      : // Convert to uppercase
        // ((byte & 0xDF) - 65) + 10
        ((byte & 0xdf) - 55)
  );
}

/** https://url.spec.whatwg.org/#percent-decode */
export function percentDecode(input: Uint8Array): Uint8Array {
  const length = input.length;
  // 1. Let output be an empty byte sequence.
  const output = new Uint8Array(length);
  let j = 0;
  // 2. For each byte byte in input:
  for (let i = 0; i < length; ++i) {
    const byte = input[i]!;
    // 1. If byte is not 0x25 (%), then append byte to output.
    if (byte !== 0x25) {
      output[j++] = byte;
      // 2. Otherwise, if byte is 0x25 (%) and the next two bytes after byte in
      // input are not in the ranges 0x30 (0) to 0x39 (9), 0x41 (A) to 0x46 (F),
      // and 0x61 (a) to 0x66 (f), all inclusive, append byte to output.
    } else if (byte === 0x25 && !(isHexCharByte(input[i + 1]!) && isHexCharByte(input[i + 2]!))) {
      output[j++] = 0x25;
      // 3. Otherwise:
    } else {
      // 1. Let bytePoint be the two bytes after byte in input, decoded, and
      // then interpreted as hexadecimal number.
      // 2. Append a byte whose value is bytePoint to output.
      output[j++] = (hexByteToNumber(input[i + 1]!) << 4) | hexByteToNumber(input[i + 2]!);
      // 3. Skip the next two bytes in input.
      i += 2;
    }
  }
  // 3. Return output.
  return length === j ? output : output.subarray(0, j);
}
