import type { HybridObject } from 'react-native-nitro-modules';

export interface NitroNodeCryptoHash extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  createHash(algorithm: string, outputLength?: number): void;
  update(data: ArrayBuffer | string): void;
  digest(encoding?: string): ArrayBuffer;
  copy(outputLength?: number): NitroNodeCryptoHash;
  getSupportedHashAlgorithms(): string[];
  getOpenSSLVersion(): string;
}
