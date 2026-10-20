import type { HybridObject } from 'react-native-nitro-modules';

export interface NitroNodeCryptoBlake3 extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  initHash(): void;
  initKeyed(key: ArrayBuffer): void;
  initDeriveKey(context: string): void;
  update(data: ArrayBuffer): void;
  digest(length?: number): ArrayBuffer;
  reset(): void;
  copy(): NitroNodeCryptoBlake3;
  getVersion(): string;
}
