import { NitroModules } from 'react-native-nitro-modules';
import type {
  NitroNodeDns,
  NitroNodeFs,
  NitroNodeFsConstants,
  NitroNodeNet,
  NitroNodeNetSocket,
  NitroNodeNetServer,
  NitroNodeOs,
  NitroNodeTls,
  NitroNodeTlsSocket,
  NitroNodeUv,
  SockAddr,
  StatFs,
  TlsClientOptions,
} from './specs/node.nitro';
import { NitroDnsInit } from './dns-init';

// hybrid objects
export const NitroUv =
  NitroModules.createHybridObject<NitroNodeUv>('NitroNodeUv');
export const NitroNet =
  NitroModules.createHybridObject<NitroNodeNet>('NitroNodeNet');
export const NitroTls =
  NitroModules.createHybridObject<NitroNodeTls>('NitroNodeTls');
export const NitroDns =
  NitroModules.createHybridObject<NitroNodeDns>('NitroNodeDns');
export { NitroDnsInit };
export const NitroFs =
  NitroModules.createHybridObject<NitroNodeFs>('NitroNodeFs');
export const NitroFsConstants =
  NitroModules.createHybridObject<NitroNodeFsConstants>('NitroNodeFsConstants');
export const NitroOs =
  NitroModules.createHybridObject<NitroNodeOs>('NitroNodeOs');

// types
export type {
  NitroNodeNet,
  NitroNodeNetSocket,
  NitroNodeNetServer,
  NitroNodeTlsSocket,
  SockAddr,
  StatFs,
  TlsClientOptions,
};
