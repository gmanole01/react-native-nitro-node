import type { NitroNodeDnsInit } from './specs/node.nitro';

function noop() {}

// NitroNodeDnsInit exists on Android only (dns-init.android.ts): c-ares needs
// the DNS servers from ConnectivityManager there. iOS and macOS have nothing
// to set up, and Metro picks this file for both.
export const NitroDnsInit: NitroNodeDnsInit = {
  name: 'HybridObject<NitroNodeDnsInit>',
  equals(other) {
    return this === other;
  },
  dispose: noop,
  init: noop,
};
