import * as http from 'react-native-nitro-node/http';
import * as net from 'react-native-nitro-node/net';
import { Buffer } from 'buffer';
import {
  HOST,
  type Log,
  SkipError,
  type Step,
  collectGarbage,
  delay,
  noLog,
  connectClient,
  readBytes,
  waitFor,
} from './testUtils';

declare const WeakRef: any;

function requireGc() {
  if (typeof WeakRef !== 'function') {
    throw new SkipError('WeakRef is not available in this engine');
  }
  if (!collectGarbage()) {
    throw new SkipError('gc() is not available in this engine');
  }
}

/**
 * Passes once every reference has been collected. Collection is retried a few
 * times: objects are only released after the callbacks that last touched them
 * have run.
 */
async function expectCollected(refs: Record<string, any>, log: Log) {
  let alive: string[] = [];
  for (let attempt = 1; attempt <= 10; attempt++) {
    await delay(100);
    collectGarbage();
    await delay(50);
    alive = Object.keys(refs).filter(name => refs[name].deref() !== undefined);
    if (alive.length === 0) {
      log(`everything collected after ${attempt} attempt(s)`);
      return;
    }
  }
  throw new Error(`still alive after 10 collections: ${alive.join(', ')}`);
}

async function listen(server: any): Promise<number> {
  server.listen(0, HOST);
  await waitFor(server, 'listening');
  return server.address().port;
}

async function closeServer(server: any) {
  const closed = waitFor(server, 'close');
  server.close();
  await closed;
}

// Each helper below creates its objects in its own scope and hands back only
// weak references, so nothing in the test keeps them alive. The objects are
// never logged either: the dev tools retain anything passed to console.log.

async function closedConnection(): Promise<Record<string, any>> {
  const refs: Record<string, any> = {};

  const server: any = net.createServer((socket: any) => {
    refs['server-side socket'] = new WeakRef(socket);
    socket.on('error', () => {});
    socket.on('data', (chunk: Buffer) => socket.write(chunk));
  });
  const port = await listen(server);

  const client = await connectClient(port, 'client', noLog);
  refs['client socket'] = new WeakRef(client);

  const message = Buffer.from('collect me');
  const reading = readBytes(client, message.length);
  client.write(message);
  await reading;

  const closed = waitFor(client, 'close');
  client.end();
  await closed;

  await closeServer(server);
  refs['net.Server'] = new WeakRef(server);
  return refs;
}

async function failedConnect(): Promise<Record<string, any>> {
  const probe: any = net.createServer();
  const port = await listen(probe);
  await closeServer(probe);

  const client: any = net.connect(port, HOST);
  client.on('error', () => {});
  await new Promise<void>(resolve => client.once('close', () => resolve()));
  return { 'failed socket': new WeakRef(client) };
}

async function httpRoundTrip(): Promise<Record<string, any>> {
  const refs: Record<string, any> = {};

  const server: any = http.createServer({}, (req: any, res: any) => {
    refs['server request'] = new WeakRef(req);
    refs['server response'] = new WeakRef(res);
    refs['server-side socket'] = new WeakRef(req.socket);
    res.end('ok');
  });
  server.listen(0, HOST);
  await waitFor(server, 'listening');
  const port: number = server.address().port;

  await new Promise<void>((resolve, reject) => {
    const req: any = new http.ClientRequest(
      { host: HOST, port, path: '/' },
      (res: any) => {
        refs['client response'] = new WeakRef(res);
        res.on('data', () => {});
        res.on('error', reject);
        res.on('end', () => resolve());
      },
    );
    refs['client request'] = new WeakRef(req);
    req.on('error', reject);
    req.end();
  });

  const closed = waitFor(server, 'close');
  server.close();
  await closed;
  refs['http.Server'] = new WeakRef(server);
  return refs;
}

/**
 * Checks that closed sockets and servers can actually be garbage-collected.
 * This is what used to leak: the callbacks held by the native object kept
 * every socket, and everything attached to it, alive forever.
 */
export async function runGcTests(step: Step) {
  await step('gc: an open socket is kept alive (control)', async log => {
    requireGc();

    const server: any = net.createServer((socket: any) => {
      socket.on('error', () => {});
    });
    const port = await listen(server);

    try {
      // Connected and never closed, with no reference kept by the test.
      const ref = await (async () =>
        new WeakRef(await connectClient(port, 'client', noLog)))();

      for (let i = 0; i < 5; i++) {
        await delay(100);
        collectGarbage();
      }

      const socket = ref.deref();
      if (socket === undefined) {
        throw new Error('a connected socket was collected while still open');
      }
      log('still alive, as it should be');
      socket.destroy();
      return 'open socket survived 5 collections';
    } finally {
      await closeServer(server);
    }
  });

  await step('gc: a closed connection is collected', async log => {
    requireGc();
    const refs = await closedConnection();
    await expectCollected(refs, log);
    return Object.keys(refs).join(', ');
  });

  await step('gc: a failed connect is collected', async log => {
    requireGc();
    const refs = await failedConnect();
    await expectCollected(refs, log);
    return Object.keys(refs).join(', ');
  });

  await step('gc: an http round trip is collected', async log => {
    requireGc();
    const refs = await httpRoundTrip();
    await expectCollected(refs, log);
    return Object.keys(refs).join(', ');
  });

  await step('gc: many closed connections are collected', async log => {
    requireGc();

    const refs: Record<string, any> = {};
    await (async () => {
      const server: any = net.createServer((socket: any) => {
        socket.on('error', () => {});
        socket.on('data', (chunk: Buffer) => socket.write(chunk));
      });
      const port = await listen(server);

      for (let i = 0; i < 50; i++) {
        const client = await connectClient(port, 'client', noLog);
        refs[`socket ${i}`] = new WeakRef(client);
        const closed = waitFor(client, 'close');
        client.end();
        await closed;
      }
      await closeServer(server);
    })();

    await expectCollected(refs, log);
    return '50 sockets';
  });
}
