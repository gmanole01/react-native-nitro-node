import * as https from 'react-native-nitro-node/https';
import * as net from 'react-native-nitro-node/net';
import * as tls from 'react-native-nitro-node/tls';
import { Buffer } from 'buffer';
import {
  HOST,
  type Log,
  type Step,
  expectThrow,
  waitFor,
} from './testUtils';

// The first byte of a TLS record that carries a handshake (the ClientHello).
const TLS_HANDSHAKE = 0x16;

/**
 * A plain TCP server standing in for a TLS one: there is no TLS server to
 * test against, but what the client sends first shows it started a handshake.
 * Resolves `firstBytes` with the first chunk an accepted socket receives.
 */
async function startProbe(log: Log) {
  let onFirst: (data: Buffer) => void = () => {};
  const firstBytes = new Promise<Buffer>(resolve => (onFirst = resolve));
  const server: any = net.createServer((socket: any) => {
    socket.on('error', (err: Error) => log(`server socket: error: ${err.message}`));
    socket.once('data', (data: Buffer) => onFirst(data));
  });
  server.listen(0, HOST);
  await waitFor(server, 'listening');
  return { server, port: server.address().port as number, firstBytes };
}

async function stopProbe(server: any) {
  const closed = waitFor(server, 'close');
  server.close();
  await closed;
}

/** TLS has no server side and no certificate checks yet: client basics only. */
export async function runTlsTests(step: Step) {
  await step('tls/https: what is not available says so', async () => {
    const checks: Array<[string, string, () => unknown]> = [
      ['tls.connect({}) without a port', 'TypeError', () => tls.connect({})],
      ['https.request', 'Error', () => https.request(`https://${HOST}/`)],
      ['https.get', 'Error', () => https.get(`https://${HOST}/`)],
      [
        'https.ClientRequest with an http: URL',
        'TypeError',
        () => new https.ClientRequest(`http://${HOST}/`),
      ],
    ];
    for (const [label, name, fn] of checks) {
      expectThrow(label, name, fn);
    }
    if (tls.TLSSocket !== tls.TlsSocket) {
      throw new Error('tls.TLSSocket is not tls.TlsSocket');
    }
    return `${checks.length} calls refused`;
  });

  await step('tls.connect({ port }) reaches 127.0.0.1 and starts a handshake', async log => {
    const { server, port, firstBytes } = await startProbe(log);
    try {
      const client: any = tls.connect({ port });
      client.on('error', (err: Error) => log(`client: error: ${err.message}`));
      await waitFor(client, 'connect');
      const remote = client.remoteAddress;
      const first = await firstBytes;

      const closed = new Promise<void>(resolve => client.once('close', () => resolve()));
      client.destroy();
      await closed;

      log(`connected to ${remote}, first byte 0x${first[0]?.toString(16)}`);
      if (remote !== HOST) {
        throw new Error(`connected to ${remote}`);
      }
      if (first[0] !== TLS_HANDSHAKE) {
        throw new Error(`the first byte is 0x${first[0]?.toString(16)}, not a handshake`);
      }
      return `ClientHello of ${first.length} bytes sent to ${remote}`;
    } finally {
      await stopProbe(server);
    }
  });

  await step('https.ClientRequest connects over TLS', async log => {
    const { server, port, firstBytes } = await startProbe(log);
    try {
      const req: any = new https.ClientRequest({ host: HOST, port, path: '/' });
      req.on('error', (err: Error) => log(`request: error: ${err.message}`));
      req.end();
      const first = await firstBytes;
      req.destroy();

      log(`first byte 0x${first[0]?.toString(16)}`);
      if (first[0] !== TLS_HANDSHAKE) {
        // plain HTTP would start with the method
        throw new Error(`got ${JSON.stringify(first.toString('latin1').slice(0, 40))}`);
      }
      return 'the request started a TLS handshake';
    } finally {
      await stopProbe(server);
    }
  });
}
