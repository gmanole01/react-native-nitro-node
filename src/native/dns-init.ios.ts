import type { NitroNodeDnsInit } from './specs/node.nitro';

function noop() {}

export const NitroDnsInit: NitroNodeDnsInit = {
  name: 'HybridObject<NitroNodeDnsInit>',
  equals(other) {
    return this === other;
  },
  dispose: noop,
  init: noop,
};
