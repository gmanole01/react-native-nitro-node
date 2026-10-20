import type { HybridObject } from 'react-native-nitro-modules';
import type { NitroNodeCryptoKeyObjectHandle } from './keyObjectHandle.nitro';

export interface NitroNodeCryptoSignHandle
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  init(algorithm: string): void;

  update(data: ArrayBuffer): void;

  sign(
    keyHandle: NitroNodeCryptoKeyObjectHandle,
    padding?: number,
    saltLength?: number,
    dsaEncoding?: number,
  ): ArrayBuffer;
}

export interface NitroNodeCryptoVerifyHandle
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  init(algorithm: string): void;

  update(data: ArrayBuffer): void;

  verify(
    keyHandle: NitroNodeCryptoKeyObjectHandle,
    signature: ArrayBuffer,
    padding?: number,
    saltLength?: number,
    dsaEncoding?: number,
  ): boolean;
}
