import { type HybridObject } from 'react-native-nitro-modules';

export interface NitroNodeCryptoUtils extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean;
}
