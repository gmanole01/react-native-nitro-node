import crypto, {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  generateKeyPairSync,
  pbkdf2,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  scryptSync,
  sign,
  subtle,
  verify,
} from 'react-native-nitro-node/crypto';
import { Buffer } from 'buffer';
import { type Step } from './testUtils';

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

// The expected values come from Node's own crypto.
export async function runCryptoTests(step: Step) {
  await step('crypto: hashes', async () => {
    expectEqual(
      'sha256',
      createHash('sha256').update('abc').digest('hex'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expectEqual(
      'sha512',
      createHash('sha512').update('abc').digest('base64'),
      '3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==',
    );
    expectEqual(
      'hmac sha256',
      createHmac('sha256', 'key')
        .update('The quick brown fox jumps over the lazy dog')
        .digest('hex'),
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  await step('crypto: random', async () => {
    const bytes = randomBytes(32);
    expectEqual('randomBytes length', bytes.length, 32);
    const uuid = randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)) {
      throw new Error(`randomUUID: ${uuid} is not a v4 UUID`);
    }
    const viaCallback = await new Promise<Buffer>((resolve, reject) =>
      randomBytes(16, (err, buf) => (err ? reject(err) : resolve(buf!))),
    );
    expectEqual('randomBytes(cb) length', viaCallback.length, 16);
  });

  await step('crypto: key derivation', async () => {
    const expected = '632c2812e46d4604102ba7618e9d6d7d2f8128f6266b4a03264d2a0460b7dcb3';
    expectEqual(
      'pbkdf2Sync',
      pbkdf2Sync('password', 'salt', 1000, 32, 'sha256').toString('hex'),
      expected,
    );
    const derived = await new Promise<Buffer>((resolve, reject) =>
      pbkdf2('password', 'salt', 1000, 32, 'sha256', (err, key) =>
        err ? reject(err) : resolve(key!),
      ),
    );
    expectEqual('pbkdf2', derived.toString('hex'), expected);
    expectEqual(
      'scryptSync',
      scryptSync('password', 'salt', 32, { N: 1024, r: 8, p: 1 }).toString('hex'),
      '16dbc8906763c7f048977a68f9d305f7710e068ca2cd95dab372125bb3f19608',
    );
  });

  await step('crypto: ciphers', async () => {
    const key = Buffer.alloc(32, 1);
    const iv = Buffer.alloc(16, 2);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([
      cipher.update('hello nitro node', 'utf8'),
      cipher.final(),
    ]);
    expectEqual(
      'aes-256-cbc',
      encrypted.toString('hex'),
      '4ebb8af25ae0750d00d8ea64ff59a0aae539dd3f9d41869929336d5302c8ec17',
    );

    const nonce = randomBytes(12);
    const gcm = createCipheriv('aes-256-gcm', key, nonce);
    const sealed = Buffer.concat([gcm.update('secret', 'utf8'), gcm.final()]);
    const tag = gcm.getAuthTag();
    const opener = createDecipheriv('aes-256-gcm', key, nonce);
    opener.setAuthTag(tag);
    const opened = Buffer.concat([opener.update(sealed), opener.final()]);
    expectEqual('aes-256-gcm round trip', opened.toString('utf8'), 'secret');
  });

  await step('crypto: sign and verify', async () => {
    const data = Buffer.from('signed by nitro node');
    const ed = generateKeyPairSync('ed25519');
    const edSignature = sign(null, data, ed.privateKey);
    expectEqual('ed25519', verify(null, data, ed.publicKey, edSignature), true);

    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const ecSignature = sign('sha256', data, ec.privateKey);
    expectEqual('P-256', verify('sha256', data, ec.publicKey, ecSignature), true);
    expectEqual(
      'P-256, other data',
      verify('sha256', Buffer.from('other'), ec.publicKey, ecSignature),
      false,
    );
  });

  await step('polyfill: global Buffer and crypto', async () => {
    // index.js imports react-native-nitro-node/polyfill first
    expectEqual('global.Buffer', (globalThis as any).Buffer, Buffer);
    expectEqual('global.crypto', (globalThis as any).crypto, crypto);
    // How a package uses them: from the global scope, without importing
    const fromGlobalScope = new Function(
      'return [Buffer.from("hi").toString("hex"), crypto.randomUUID().length, crypto.getRandomValues(new Uint8Array(8)).length]',
    )();
    expectEqual('Buffer, crypto.randomUUID, crypto.getRandomValues', fromGlobalScope.join(), '6869,36,8');
  });

  await step('crypto: subtle.digest', async () => {
    const digest = await subtle.digest('SHA-256', Buffer.from('abc'));
    expectEqual(
      'SHA-256',
      Buffer.from(digest).toString('hex'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expectEqual('default export', crypto.subtle, subtle);
  });
}
