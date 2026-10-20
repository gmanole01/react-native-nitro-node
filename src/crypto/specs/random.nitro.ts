import { type HybridObject } from 'react-native-nitro-modules';

export interface NitroNodeCryptoRandom extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  randomFill(
    buffer: ArrayBuffer,
    offset: number,
    size: number,
  ): Promise<ArrayBuffer>;
  randomFillSync(
    buffer: ArrayBuffer,
    offset: number,
    size: number,
  ): ArrayBuffer;
}
