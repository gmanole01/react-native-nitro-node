import * as https from 'react-native-nitro-node/https';
import * as net from 'react-native-nitro-node/net';
import * as tls from 'react-native-nitro-node/tls';
import { Buffer } from 'buffer';
import {
  HOST,
  type Log,
  SkipError,
  type Step,
  delay,
  expectThrow,
  waitFor,
} from './testUtils';

// The first byte of a TLS record that carries a handshake (the ClientHello).
const TLS_HANDSHAKE = 0x16;

// Network failures that mean "no internet here", not a broken TLS client.
const OFFLINE_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEOUT'];

/**
 * A plain TCP server standing in for a TLS one. Resolves `firstBytes` with
 * the first chunk an accepted socket receives; with `hangUp`, the server then
 * closes the connection.
 */
async function startProbe(log: Log, hangUp = false) {
  let onFirst: (data: Buffer) => void = () => {};
  const firstBytes = new Promise<Buffer>(resolve => (onFirst = resolve));
  const server: any = net.createServer((socket: any) => {
    socket.on('error', (err: Error) => log(`server socket: error: ${err.message}`));
    socket.once('data', (data: Buffer) => {
      onFirst(data);
      if (hangUp) {
        socket.end();
      }
    });
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

/** One attempt at a handshake with `host`, see secureConnect. */
function connectOnce(host: string, options: tls.ConnectionOptions): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, ...options });
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', (err: any) => {
      if (OFFLINE_CODES.includes(err?.code)) {
        reject(new SkipError(`no internet (${err.code})`));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Connects to a public host and waits for the handshake. Resolves with the
 * socket once secure, rejects with the error otherwise; no internet skips.
 *
 * badssl.com's server resets some connections, more so after a few refused
 * handshakes in a row, so a reset is retried: it says nothing about TLS.
 */
async function secureConnect(
  host: string,
  options: tls.ConnectionOptions = {},
  log?: Log,
): Promise<tls.TLSSocket> {
  const attempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await connectOnce(host, options);
    } catch (err: any) {
      if (err?.code !== 'ECONNRESET' || attempt === attempts) {
        throw err;
      }
      log?.(`${host}: connection reset, retrying (${attempt}/${attempts - 1})`);
      await delay(500 * attempt);
    }
  }
}

/**
 * Expects the handshake with `host` to fail on its certificate, and returns
 * why. A reset connection proves nothing, so it doesn't count as refused.
 */
async function expectRefused(host: string, log: Log, options: tls.ConnectionOptions = {}) {
  let socket: tls.TLSSocket;
  try {
    socket = await secureConnect(host, options, log);
  } catch (err: any) {
    if (err?.isSkip) {
      throw err;
    }
    if (err?.code === 'ECONNRESET') {
      throw new Error(`${host}: inconclusive, the server kept resetting the connection`);
    }
    return `${host}: ${err?.message}`;
  }
  socket.destroy();
  throw new Error(`${host}: the handshake succeeded`);
}

/** Destroys `socket` and waits for its 'close'. */
async function closeSocket(socket: net.Socket) {
  const closed = waitFor(socket, 'close');
  socket.destroy();
  await closed;
}

/** TLS client tests: local ones, then real servers (skipped when offline). */
export async function runTlsTests(step: Step) {
  await step('tls/https: API shape', async () => {
    const checks: Array<[string, string, () => unknown]> = [
      ['tls.connect({}) without a port', 'TypeError', () => tls.connect({})],
      ['TLSSocket over an existing socket', 'Error', () => new tls.TLSSocket(new net.Socket())],
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
      const client = tls.connect({ port });
      client.on('error', (err: Error) => log(`client: error: ${err.message}`));
      let secure = false;
      client.once('secureConnect', () => (secure = true));
      await waitFor(client, 'connect');
      const remote = client.remoteAddress;
      const first = await firstBytes;
      await closeSocket(client);

      log(`connected to ${remote}, first byte 0x${first[0]?.toString(16)}`);
      if (remote !== HOST) {
        throw new Error(`connected to ${remote}`);
      }
      if (first[0] !== TLS_HANDSHAKE) {
        throw new Error(`the first byte is 0x${first[0]?.toString(16)}, not a handshake`);
      }
      if (secure || client.alpnProtocol !== null) {
        throw new Error('secure without a handshake');
      }
      return `ClientHello of ${first.length} bytes sent to ${remote}`;
    } finally {
      await stopProbe(server);
    }
  });

  await step('tls: a server that hangs up mid-handshake fails with ECONNRESET', async log => {
    const { server, port } = await startProbe(log, true);
    try {
      const client = tls.connect({ port });
      const closed = new Promise<void>(resolve => client.once('close', () => resolve()));
      const err: any = await waitFor(client, 'error');
      await closed;
      log(`error: ${err?.code} ${err?.message}`);
      if (err?.code !== 'ECONNRESET') {
        throw new Error(`failed with ${err?.code}: ${err?.message}`);
      }
      return err.message;
    } finally {
      await stopProbe(server);
    }
  });

  await step('tls: a verified connection to example.com', async log => {
    const socket = await secureConnect('example.com', { ALPNProtocols: ['h2', 'http/1.1'] });
    try {
      if (!socket.authorized || socket.encrypted !== true) {
        throw new Error(`authorized ${socket.authorized}, encrypted ${socket.encrypted}`);
      }
      if (socket.servername !== 'example.com') {
        throw new Error(`servername ${socket.servername}`);
      }
      if (socket.alpnProtocol !== 'h2' && socket.alpnProtocol !== 'http/1.1') {
        throw new Error(`alpnProtocol ${socket.alpnProtocol}`);
      }
      return `secure, ALPN ${socket.alpnProtocol}, from ${socket.remoteAddress}`;
    } finally {
      await closeSocket(socket);
    }
  }, 20000);

  await step('tls: HTTP/1.1 over a raw TLS socket, then end()', async log => {
    const socket = await secureConnect('example.com');
    const chunks: Buffer[] = [];
    socket.on('data', (data: Buffer) => chunks.push(data));
    const ended = waitFor(socket, 'end');
    const closed = waitFor(socket, 'close');
    socket.write('GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
    await ended;
    await closed;
    const response = Buffer.concat(chunks).toString('latin1');
    log(response.split('\r\n')[0] ?? '');
    if (!response.startsWith('HTTP/1.1 200') || !response.includes('Example Domain')) {
      throw new Error(`unexpected response: ${JSON.stringify(response.slice(0, 80))}`);
    }
    return `${response.length} bytes, ${socket.bytesRead} read`;
  }, 20000);

  await step('https.get() fetches a page', async log => {
    const body = await new Promise<string>((resolve, reject) => {
      const req = https.get('https://example.com/', (res: any) => {
        if (res.statusCode !== 200) {
          reject(new Error(`status ${res.statusCode}`));
          return;
        }
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => resolve(text));
      });
      req.on('error', (err: any) =>
        reject(OFFLINE_CODES.includes(err?.code) ? new SkipError(`no internet (${err.code})`) : err),
      );
    });
    if (!body.includes('Example Domain')) {
      throw new Error(`unexpected body: ${JSON.stringify(body.slice(0, 80))}`);
    }
    return `${body.length} characters`;
  }, 20000);

  await step('https.Agent: keepAlive reuses a TLS connection', async log => {
    const agent: any = new https.Agent({ keepAlive: true });
    const fetchOnce = () =>
      new Promise<any>((resolve, reject) => {
        const req: any = https.get('https://example.com/', { agent }, (res: any) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode, socket: req.socket ?? res.socket }));
        });
        req.on('error', (err: any) =>
          reject(OFFLINE_CODES.includes(err?.code) ? new SkipError(`no internet (${err.code})`) : err),
        );
      });
    try {
      const first = await fetchOnce();
      // the socket goes back to the pool once the response is complete
      await delay(50);
      const pooled = Object.values(agent.freeSockets as Record<string, any[]>).flat();
      const second = await fetchOnce();
      log(`statuses ${first.status} ${second.status}, pooled ${pooled.length}`);
      if (first.status !== 200 || second.status !== 200) {
        throw new Error(`statuses ${first.status} ${second.status}`);
      }
      if (pooled.length !== 1 || !pooled[0].encrypted) {
        throw new Error(`expected 1 pooled TLS socket, got ${pooled.length}`);
      }
      if (second.socket !== pooled[0]) {
        throw new Error('the second request did not reuse the pooled socket');
      }
      return '2 requests on 1 TLS connection';
    } finally {
      agent.destroy();
    }
  }, 20000);

  await step('tls: invalid certificates are refused', async log => {
    const results = [
      await expectRefused('self-signed.badssl.com', log),
      await expectRefused('expired.badssl.com', log),
      await expectRefused('untrusted-root.badssl.com', log),
    ];
    results.forEach(result => log(result));
    return results.join('; ');
  }, 60000);

  await step('tls: a certificate for another host name is refused', async log => {
    return expectRefused('wrong.host.badssl.com', log);
  }, 20000);

  await step('tls: rejectUnauthorized: false accepts any certificate', async log => {
    const socket = await secureConnect('self-signed.badssl.com', { rejectUnauthorized: false }, log);
    try {
      if (socket.authorized) {
        throw new Error('authorized without verification');
      }
      return 'secure, not authorized';
    } finally {
      await closeSocket(socket);
    }
  }, 20000);
}
