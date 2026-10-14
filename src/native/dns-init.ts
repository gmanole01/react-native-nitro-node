import { NitroModules } from 'react-native-nitro-modules';
import type { NitroNodeDnsInit } from './specs/node.nitro';

export const NitroDnsInit =
  NitroModules.createHybridObject<NitroNodeDnsInit>('NitroNodeDnsInit');
