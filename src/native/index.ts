import { Platform } from 'react-native';
import { NitroModules } from 'react-native-nitro-modules';
import type {
  NitroNodeDgram,
  NitroNodeDgramSocket,
  NitroNodeDns,
  NitroNodeFs,
  NitroNodeFsConstants,
  NitroNodeNet,
  NitroNodeNetSocket,
  NitroNodeNetServer,
  NitroNodeOs,
  NitroNodeTimers,
  NitroNodeTls,
  NitroNodeTlsSocket,
  NitroNodeUrl,
  NitroNodeUv,
  NitroNodeZlib,
  SockAddr,
  FileStats,
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
export const NitroTimers =
  NitroModules.createHybridObject<NitroNodeTimers>('NitroNodeTimers');

// iOS, Android and macOS start an app in '/', where it can't write: as a Node
// process starts in a directory of its own, it moves to the app's data
// directory (os.homedir()), for process.cwd(), fs's relative paths and
// path.resolve(). Only from '/': a directory set otherwise (a macOS app run
// from a terminal, the app's own native code) is kept. Windows keeps its own.
if (Platform.OS !== 'windows') {
  try {
    if (NitroUv.uv_cwd() === '/') {
      NitroUv.uv_chdir(NitroOs.homedir());
    }
  } catch {
    // stays where it is: process.cwd() reports it
  }
}

let NitroDgram: NitroNodeDgram | null = null;
/** A new UDP socket, for dgram. */
export function createNitroDgramSocket(): NitroNodeDgramSocket {
  NitroDgram ??=
    NitroModules.createHybridObject<NitroNodeDgram>('NitroNodeDgram');
  return NitroDgram.createSocket();
}

export const NitroUrl =
  NitroModules.createHybridObject<NitroNodeUrl>('NitroNodeUrl');

/** A new zlib stream: each Gzip, Inflate, ... has its own. */
export function createNitroZlib(): NitroNodeZlib {
  return NitroModules.createHybridObject<NitroNodeZlib>('NitroNodeZlib');
}

// types
export type {
  NitroNodeDgramSocket,
  NitroNodeNet,
  NitroNodeNetSocket,
  NitroNodeNetServer,
  NitroNodeTlsSocket,
  NitroNodeZlib,
  NitroNodeUrl,
  SockAddr,
  FileStats,
  StatFs,
  TlsClientOptions,
};
