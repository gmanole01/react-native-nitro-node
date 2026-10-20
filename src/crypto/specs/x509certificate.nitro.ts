import type { HybridObject } from 'react-native-nitro-modules';
import type { NitroNodeCryptoKeyObjectHandle } from './keyObjectHandle.nitro';

export interface NitroNodeCryptoX509CertificateHandle
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  init(buffer: ArrayBuffer): void;

  subject(): string;
  subjectAltName(): string;
  issuer(): string;
  infoAccess(): string;
  validFrom(): string;
  validTo(): string;
  validFromDate(): number;
  validToDate(): number;
  signatureAlgorithm(): string;
  signatureAlgorithmOid(): string;
  serialNumber(): string;

  fingerprint(): string;
  fingerprint256(): string;
  fingerprint512(): string;

  raw(): ArrayBuffer;
  pem(): string;

  publicKey(): NitroNodeCryptoKeyObjectHandle;
  keyUsage(): string[];

  ca(): boolean;
  checkIssued(other: NitroNodeCryptoX509CertificateHandle): boolean;
  checkPrivateKey(key: NitroNodeCryptoKeyObjectHandle): boolean;
  verify(key: NitroNodeCryptoKeyObjectHandle): boolean;

  checkHost(name: string, flags: number): string | undefined;
  checkEmail(email: string, flags: number): string | undefined;
  checkIP(ip: string): string | undefined;
}
