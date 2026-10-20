import type { HybridObject } from 'react-native-nitro-modules';

export interface NitroNodeCryptoHmac extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  createHmac(algorithm: string, key: ArrayBuffer): void;
  update(data: ArrayBuffer | string): void;
  digest(): ArrayBuffer;
}
