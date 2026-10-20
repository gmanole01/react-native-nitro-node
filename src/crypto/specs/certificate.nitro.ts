import type { HybridObject } from 'react-native-nitro-modules';

export interface NitroNodeCryptoCertificate
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  verifySpkac(spkac: ArrayBuffer): boolean;
  exportPublicKey(spkac: ArrayBuffer): ArrayBuffer;
  exportChallenge(spkac: ArrayBuffer): ArrayBuffer;
}
