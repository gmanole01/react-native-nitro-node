import * as dns from 'react-native-nitro-node/dns';
import dnsPromises from 'react-native-nitro-node/dns/promises';
import * as net from 'react-native-nitro-node/net';
import { Buffer } from 'buffer';
import {
  HOST,
  LOG_PREFIX,
  type Log,
  SkipError,
  type Step,
  collectGarbage,
  collectText,
  connectClient,
  delay,
  errorMessage,
  expectConnectError,
  expectThrow,
  makePayload,
  readBytes,
  traceSocket,
  waitFor,
} from './testUtils';

/** Records the order of the terminal events a socket emits. */
function recordEvents(socket: any): string[] {
  const events: string[] = [];
  socket.on('connect', () => events.push('connect'));
  socket.on('error', () => events.push('error'));
  socket.on('close', () => events.push('close'));
  return events;
}

/**
 * Resolves on 'close'. Unlike waitFor it does not reject on 'error', for
 * sockets that are expected to fail before they close.
 */
function onceClosed(socket: any): Promise<void> {
  return new Promise(resolve => socket.once('close', () => resolve()));
}

async function listen(server: any): Promise<number> {
  server.listen(0, HOST);
  await waitFor(server, 'listening');
  const port = server.address()?.port ?? 0;
  if (!port) {
    throw new Error('server.address() returned no port');
  }
  return port;
}

async function closeServer(server: any) {
  const closed = waitFor(server, 'close');
  server.close();
  await closed;
}

const LARGE_PAYLOAD_SIZE = 512 * 1024;

/** Basic lifecycle: listen, connect, echo, close, re-listen. */
export async function runNetTests(step: Step) {
  // Echo server shared by the steps below. Every accepted socket echoes what
  // it receives; steps that need the server side of a connection await
  // `nextServerSocket()` before connecting.
  let serverSocketWaiters: Array<(socket: any) => void> = [];
  function nextServerSocket(): Promise<any> {
    return new Promise(resolve => serverSocketWaiters.push(resolve));
  }

  let accepted = 0;
  const server: any = net.createServer((socket: any) => {
    const label = `server socket #${++accepted}`;
    const log: Log = message => console.log(`${LOG_PREFIX} ${message}`);
    log(`${label}: accepted from ${socket.remoteAddress}:${socket.remotePort}`);
    traceSocket(socket, label, log);
    socket.on('data', (chunk: Buffer) => socket.write(chunk));

    const waiters = serverSocketWaiters;
    serverSocketWaiters = [];
    waiters.forEach(resolve => resolve(socket));
  });
  server.on('error', (err: Error) =>
    console.error(`${LOG_PREFIX} server: error: ${err.message}`),
  );
  server.on('close', () => console.log(`${LOG_PREFIX} server: close`));

  let port = 0;

  await step('listen on an ephemeral port', async log => {
    server.listen(0, HOST);
    await waitFor(server, 'listening');
    const address = server.address();
    log(`address: ${JSON.stringify(address)}`);
    if (!address || !address.port) {
      throw new Error('server.address() returned no port');
    }
    port = address.port;
    return `${address.address}:${port}`;
  });

  if (port === 0) {
    console.error(`${LOG_PREFIX} cannot continue without a listening server`);
    return;
  }

  await step('echo a small message, client closes', async log => {
    const client = await connectClient(port, 'client', log);
    log(`local ${client.localAddress}:${client.localPort}`);

    const message = Buffer.from('hello from the client');
    const reading = readBytes(client, message.length);
    client.write(message);
    const { data } = await reading;
    if (!data.equals(message)) {
      throw new Error(`echo mismatch: got "${data.toString('utf8')}"`);
    }
    log(`echoed ${data.length} bytes`);

    const closed = waitFor(client, 'close');
    client.end();
    await closed;
    return `${data.length} bytes echoed`;
  });

  await step('echo a large payload', async log => {
    const client = await connectClient(port, 'client', log);

    const payload = makePayload(LARGE_PAYLOAD_SIZE);
    const reading = readBytes(client, payload.length);
    client.write(payload, (err?: Error | null) =>
      log(err ? `write callback error: ${err.message}` : 'write callback ok'),
    );
    const { data, chunks } = await reading;
    log(`received ${data.length} bytes in ${chunks} chunks`);

    if (data.length !== payload.length) {
      throw new Error(`length mismatch: ${data.length} != ${payload.length}`);
    }
    if (!data.equals(payload)) {
      let at = 0;
      while (at < data.length && data[at] === payload[at]) {
        at++;
      }
      throw new Error(`content mismatch at byte ${at}`);
    }

    const closed = waitFor(client, 'close');
    client.end();
    await closed;
    return `${data.length} bytes in ${chunks} chunks`;
  });

  await step('server closes the connection', async log => {
    const serverSocketPromise = nextServerSocket();
    const client = await connectClient(port, 'client', log);
    const serverSocket = await serverSocketPromise;

    // Flowing mode, so the client sees 'end' when the server shuts down.
    client.on('data', () => {});

    const clientEnded = waitFor(client, 'end');
    const clientClosed = waitFor(client, 'close');
    const serverSocketClosed = waitFor(serverSocket, 'close');

    serverSocket.end();
    await clientEnded;
    await clientClosed;
    await serverSocketClosed;
    return 'both sides closed';
  });

  await step('several clients at once', async log => {
    const count = 5;
    const results = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const client = await connectClient(port, `client ${i}`, log);
        const message = Buffer.from(`message from client ${i}`);
        const reading = readBytes(client, message.length);
        client.write(message);
        const { data } = await reading;
        const closed = waitFor(client, 'close');
        client.end();
        await closed;
        return data.equals(message);
      }),
    );
    if (results.some(ok => !ok)) {
      throw new Error(`echo mismatch: ${JSON.stringify(results)}`);
    }
    return `${count} clients echoed`;
  });

  await step('abandon open sockets without closing them', async log => {
    // Exercises native teardown of sockets that are dropped while connected.
    for (let i = 0; i < 5; i++) {
      await connectClient(port, `abandoned client ${i}`, log);
    }
    log(
      collectGarbage()
        ? 'gc() called'
        : 'gc() not available, relying on a later collection',
    );
    await delay(500);
    return 'still alive';
  });

  await step('close the server', async log => {
    const closed = waitFor(server, 'close');
    server.close(() => log('close callback'));
    await closed;
    if (server.address() !== null) {
      throw new Error('server.address() is not null after close');
    }
  });

  await step('connect to the closed port fails', async log => {
    const message = await expectConnectError(port, HOST);
    log(`got expected error: ${message}`);
    return message;
  });

  await step('connect to a closed IPv6 port fails', async log => {
    const message = await expectConnectError(port, '::1');
    log(`got expected error: ${message}`);
    return message;
  });

  await step('listen again on the same port', async log => {
    let listeningCallbacks = 0;
    server.listen(port, HOST, () => listeningCallbacks++);
    await waitFor(server, 'listening');
    log(`address: ${JSON.stringify(server.address())}`);
    if (listeningCallbacks !== 1) {
      throw new Error(`listen callback fired ${listeningCallbacks} times`);
    }

    const client = await connectClient(port, 'client', log);
    const message = Buffer.from('hello again');
    const reading = readBytes(client, message.length);
    client.write(message);
    const { data } = await reading;
    if (!data.equals(message)) {
      throw new Error('echo mismatch after re-listen');
    }
    const clientClosed = waitFor(client, 'close');
    client.end();
    await clientClosed;

    const closed = waitFor(server, 'close');
    server.close();
    await closed;
    return 'listened, echoed and closed again';
  });

  await step('dns.resolve4 (needs network)', async log => {
    const addresses = await new Promise<string[]>((resolve, reject) => {
      dns.resolve4('example.com', (err: Error | null, result: string[]) =>
        err ? reject(err) : resolve(result),
      );
    });
    log(`example.com -> ${JSON.stringify(addresses)}`);
    if (!addresses.length) {
      throw new Error('no addresses returned');
    }
    return addresses.join(', ');
  });
}

/**
 * Behaviour that used to be wrong on the JS side of `net`: teardown events,
 * backpressure, timeouts and server bookkeeping.
 */
export async function runNetBehaviourTests(step: Step) {
  await step('failed connect emits error, then close, once', async log => {
    // Find a port nothing listens on: listen, note the port, close.
    const probe: any = net.createServer();
    const port = await listen(probe);
    await closeServer(probe);

    const client: any = net.connect(port, HOST);
    const events = recordEvents(client);
    const closed = onceClosed(client);
    await closed;
    await delay(200);

    log(`events: ${JSON.stringify(events)}`);
    if (JSON.stringify(events) !== JSON.stringify(['error', 'close'])) {
      throw new Error(`expected ["error","close"], got ${JSON.stringify(events)}`);
    }
    if (!client.destroyed) {
      throw new Error('socket is not destroyed after a failed connect');
    }
    return events.join(' -> ');
  });

  // All lookups share one native resolver.
  await step('dns: 20 concurrent lookups (needs network)', async log => {
    const lookups = Array.from({ length: 20 }, (_, index) => {
      // every third one fails, so answers and errors are interleaved
      const hostname =
        index % 3 === 2 ? `missing-${index}.invalid` : 'example.com';
      return new Promise<string>(resolve => {
        dns.resolve4(hostname, (err: any, result: string[]) =>
          resolve(err ? `error:${err.code}` : `ok:${result.length > 0}`),
        );
      });
    });
    const results = await Promise.all(lookups);
    log(JSON.stringify(results));

    results.forEach((result, index) => {
      const expected = index % 3 === 2 ? 'error:ENOTFOUND' : 'ok:true';
      if (result !== expected) {
        throw new Error(`lookup ${index}: expected ${expected}, got ${result}`);
      }
    });
    return '20 lookups, each got its own answer';
  }, 45000);

  await step(
    'failed DNS lookup emits error, then close (needs a resolver)',
    async log => {
      const client: any = net.connect(80, 'no-such-host.invalid');
      const events = recordEvents(client);
      let message = '';
      let code = '';
      let syscall = '';
      let hostname = '';
      client.on('error', (err: any) => {
        message = err.message;
        code = err.code;
        syscall = err.syscall;
        hostname = err.hostname;
      });
      const closed = onceClosed(client);
      await closed;
      await delay(200);

      log(`events: ${JSON.stringify(events)}, error: ${message}, code: ${code}`);
      if (JSON.stringify(events) !== JSON.stringify(['error', 'close'])) {
        throw new Error(
          `expected ["error","close"], got ${JSON.stringify(events)}`,
        );
      }
      // ENOTFOUND with a working resolver; offline it is ETIMEOUT or similar.
      if (!code || code === 'EUNKNOWN') {
        throw new Error(`the error carries no DNS code: ${message}`);
      }
      if (syscall !== 'getaddrinfo' || hostname !== 'no-such-host.invalid') {
        throw new Error(`syscall ${syscall}, hostname ${hostname}`);
      }
      return message;
    },
    45000,
  );

  await step('destroy before the connection is made', async log => {
    const server: any = net.createServer();
    let accepted = 0;
    server.on('connection', () => accepted++);
    const port = await listen(server);

    try {
      const client: any = net.connect(port, HOST);
      const events = recordEvents(client);
      client.destroy();
      await delay(500);

      log(`events: ${JSON.stringify(events)}, accepted: ${accepted}`);
      if (JSON.stringify(events) !== JSON.stringify(['close'])) {
        throw new Error(`expected ["close"], got ${JSON.stringify(events)}`);
      }
      if (accepted !== 0) {
        throw new Error('the destroyed socket still connected to the server');
      }
      return 'close only, never connected';
    } finally {
      await closeServer(server);
    }
  });

  await step('close is emitted exactly once', async log => {
    const server: any = net.createServer();
    const port = await listen(server);

    try {
      const client = await connectClient(port, 'client', log);
      let closes = 0;
      client.on('close', () => closes++);

      client.destroy();
      client.destroy();
      await delay(300);
      client.destroy();
      await delay(300);

      if (closes !== 1) {
        throw new Error(`'close' was emitted ${closes} times`);
      }
      return '1 close for 3 destroy() calls';
    } finally {
      await closeServer(server);
    }
  });

  await step('a paused socket stays paused and stops reading', async log => {
    const total = 8 * 1024 * 1024;
    const writeSize = 64 * 1024;

    // Sends `total` bytes as soon as the client says go.
    const server: any = net.createServer((socket: any) => {
      socket.on('error', () => {});
      socket.once('data', () => {
        const chunk = Buffer.alloc(writeSize, 0x61);
        for (let sent = 0; sent < total; sent += writeSize) {
          socket.write(chunk);
        }
      });
    });
    const port = await listen(server);

    try {
      const client = await connectClient(port, 'client', log);
      let dataEvents = 0;
      let received = 0;
      client.on('data', (chunk: Buffer) => {
        dataEvents++;
        received += chunk.length;
      });

      client.pause();
      client.write('go');
      await delay(1000);

      const buffered: number = client.readableLength;
      log(
        `while paused: ${dataEvents} data events, ${buffered} bytes buffered ` +
          `of ${total} sent`,
      );
      if (dataEvents !== 0) {
        throw new Error(`${dataEvents} 'data' events arrived while paused`);
      }
      // With backpressure the native reads stop soon after the buffer fills;
      // without it the whole payload ends up buffered in JS.
      if (buffered >= total / 2) {
        throw new Error(
          `${buffered} of ${total} bytes were buffered while paused, ` +
            'native reads were not stopped',
        );
      }

      const done = new Promise<void>(resolve => {
        const check = () => {
          if (received >= total) {
            client.removeListener('data', check);
            resolve();
          }
        };
        client.on('data', check);
      });
      client.resume();
      await done;

      if (received !== total) {
        throw new Error(`received ${received} bytes, expected ${total}`);
      }
      const closed = waitFor(client, 'close');
      client.destroy();
      await closed;
      return `${buffered} bytes buffered while paused, all ${total} after resume`;
    } finally {
      await closeServer(server);
    }
  });

  await step("reading with 'readable' and read()", async log => {
    const server: any = net.createServer((socket: any) => {
      socket.on('error', () => {});
      socket.on('data', (chunk: Buffer) => socket.write(chunk));
    });
    const port = await listen(server);

    try {
      const message = Buffer.from('read me in paused mode');
      const client: any = net.connect(port, HOST);
      traceSocket(client, 'client', log);

      // Attached before the connection is made, so the stream never flows.
      const chunks: Buffer[] = [];
      let received = 0;
      const done = new Promise<void>(resolve => {
        client.on('readable', () => {
          let chunk: Buffer | null;
          while ((chunk = client.read()) !== null) {
            chunks.push(chunk);
            received += chunk.length;
          }
          if (received >= message.length) {
            resolve();
          }
        });
      });

      await waitFor(client, 'connect');
      client.write(message);
      await done;

      const data = Buffer.concat(chunks);
      if (!data.equals(message)) {
        throw new Error(`got "${data.toString('utf8')}"`);
      }
      if (client.readableFlowing === true) {
        throw new Error('the stream was switched to flowing mode');
      }
      const closed = waitFor(client, 'close');
      client.destroy();
      await closed;
      return `${data.length} bytes via read()`;
    } finally {
      await closeServer(server);
    }
  });

  await step('setTimeout fires on inactivity and can be disabled', async log => {
    const server: any = net.createServer((socket: any) => {
      socket.on('error', () => {});
    });
    const port = await listen(server);

    try {
      const client = await connectClient(port, 'client', log);
      let timeouts = 0;
      client.on('timeout', () => timeouts++);

      // 1. fires after roughly the configured time
      const start = Date.now();
      client.setTimeout(300);
      await waitFor(client, 'timeout');
      const elapsed = Date.now() - start;
      log(`timeout after ${elapsed}ms`);
      if (elapsed < 250) {
        throw new Error(`timeout fired too early, after ${elapsed}ms`);
      }
      if (client.destroyed) {
        throw new Error("'timeout' must not destroy the socket by itself");
      }

      // 2. activity pushes it back
      timeouts = 0;
      client.setTimeout(400);
      for (let i = 0; i < 4; i++) {
        await delay(200);
        client.write('ping');
      }
      if (timeouts !== 0) {
        throw new Error('timeout fired although the socket was active');
      }

      // 3. zero disables it
      client.setTimeout(0);
      await delay(800);
      if (timeouts !== 0) {
        throw new Error('timeout fired after it was disabled');
      }

      const closed = waitFor(client, 'close');
      client.destroy();
      await closed;
      return `fired after ${elapsed}ms, refreshed by writes, disabled by 0`;
    } finally {
      await closeServer(server);
    }
  });

  await step('server.close() on a server that is not listening', async () => {
    const server: any = net.createServer();
    const err = await new Promise<Error | undefined>(resolve =>
      server.close((e?: Error) => resolve(e)),
    );
    if (!err) {
      throw new Error('the callback was called without an error');
    }
    return err.message;
  });

  await step('connection count returns to zero after close', async log => {
    const server: any = net.createServer((socket: any) => {
      socket.on('error', () => {});
    });
    const port = await listen(server);

    const clients: any[] = [];
    for (let i = 0; i < 3; i++) {
      clients.push(await connectClient(port, `client ${i}`, log));
    }
    // let the server see all three
    await delay(200);

    const count = () =>
      new Promise<number>(resolve =>
        server.getConnections((_: Error | null, n: number) => resolve(n)),
      );

    const before = await count();
    await closeServer(server);
    await delay(300);
    const after = await count();

    log(`connections before close: ${before}, after: ${after}`);
    if (before !== 3) {
      throw new Error(`expected 3 connections before close, got ${before}`);
    }
    if (after !== 0) {
      throw new Error(`expected 0 connections after close, got ${after}`);
    }
    clients.forEach(client => client.destroy());
    return `${before} -> ${after}`;
  });

  // Echoes whatever it receives; `host` picks the address family it listens on.
  async function startEcho(host: string) {
    const server: any = net.createServer((socket: any) => {
      socket.on('error', () => {});
      socket.on('data', (chunk: Buffer) => socket.write(chunk));
    });
    server.listen(0, host);
    await waitFor(server, 'listening');
    return { server, port: server.address().port as number };
  }

  async function echoOnce(client: any, text: string) {
    const reading = readBytes(client, text.length);
    client.write(text);
    const { data } = await reading;
    if (data.toString() !== text) {
      throw new Error(`echo mismatch: ${JSON.stringify(data.toString())}`);
    }
  }

  async function endClient(client: any) {
    const closed = waitFor(client, 'close');
    client.end();
    await closed;
  }

  await step('IPv6: listen and connect on ::1', async log => {
    const { server, port } = await startEcho('::1');
    const address = server.address();
    log(`listening on ${JSON.stringify(address)}`);

    const client: any = net.connect(port, '::1');
    traceSocket(client, 'client', log);
    await waitFor(client, 'connect');
    await echoOnce(client, 'hello over IPv6');
    const { remoteAddress, remoteFamily } = client;
    await endClient(client);
    await closeServer(server);

    if (address.family !== 'IPv6') {
      throw new Error(`server family is ${address.family}`);
    }
    if (remoteFamily !== 'IPv6') {
      throw new Error(`client remoteFamily is ${remoteFamily}`);
    }
    return `connected to [${remoteAddress}]:${port}`;
  });

  // "localhost" has an IPv4 and an IPv6 address. Whichever the server listens
  // on, the client has to get there, trying the other address first if need be.
  for (const host of [HOST, '::1']) {
    await step(`connect by name reaches a server on ${host}`, async log => {
      const { server, port } = await startEcho(host);

      const client: any = net.connect(port, 'localhost');
      traceSocket(client, 'client', log);
      await waitFor(client, 'connect');
      await echoOnce(client, 'hello by name');
      const { remoteAddress } = client;
      await endClient(client);
      await closeServer(server);

      return `localhost -> ${remoteAddress}`;
    });
  }

  await step('an address that does not answer is skipped', async log => {
    const { server, port } = await startEcho(HOST);

    // 192.0.2.1 is reserved for documentation: nothing answers there, so the
    // attempt hangs (or, without a network, fails at once). Either way the
    // second address has to be reached, and quickly.
    const addresses = [
      { address: '192.0.2.1', family: 4 },
      { address: HOST, family: 4 },
    ];
    const start = Date.now();
    const client: any = net.connect({
      port,
      host: 'two-addresses.test',
      lookup: (_host: string, _options: any, callback: any) =>
        callback(null, addresses),
      autoSelectFamilyAttemptTimeout: 300,
    });
    traceSocket(client, 'client', log);
    await waitFor(client, 'connect');
    const took = Date.now() - start;
    log(`connected to ${client.remoteAddress} after ${took}ms`);

    await echoOnce(client, 'hello after falling back');
    const { remoteAddress } = client;
    await endClient(client);
    await closeServer(server);

    if (remoteAddress !== HOST) {
      throw new Error(`connected to ${remoteAddress}`);
    }
    if (took > 3000) {
      throw new Error(`falling back took ${took}ms`);
    }
    return `reached ${remoteAddress} in ${took}ms`;
  });

  await step('connect and listen errors say what went wrong', async log => {
    const { server, port } = await startEcho(HOST);

    // the port is taken
    const second: any = net.createServer();
    const listenError = new Promise<any>(resolve => second.once('error', resolve));
    second.listen(port, HOST);
    const listenErr = await listenError;
    log(`listen: ${listenErr.message} (errno ${listenErr.errno})`);

    await closeServer(server);

    // nothing listens there anymore
    const client: any = net.connect(port, HOST);
    const connectErr = await new Promise<any>(resolve =>
      client.once('error', resolve),
    );
    log(`connect: ${connectErr.message} (errno ${connectErr.errno})`);

    for (const [syscall, err] of [
      ['listen', listenErr],
      ['connect', connectErr],
    ] as const) {
      if (!err.message.startsWith(`${syscall}: `) || !(err.errno < 0)) {
        throw new Error(`${syscall} error has no detail: ${err.message}`);
      }
    }
    if (listenErr.message === connectErr.message.replace('connect', 'listen')) {
      throw new Error('both failures report the same reason');
    }
    // Node's fields: the error name as `code`, the operation as `syscall`
    for (const [syscall, code, err] of [
      ['listen', 'EADDRINUSE', listenErr],
      ['connect', 'ECONNREFUSED', connectErr],
    ] as const) {
      if (err.code !== code || err.syscall !== syscall) {
        throw new Error(
          `${syscall} error: code ${err.code}, syscall ${err.syscall}; ` +
            `expected ${code}, ${syscall}`,
        );
      }
    }
    return `${listenErr.message} / ${connectErr.message}`;
  });

  await step('setNoDelay and setKeepAlive', async log => {
    let serverSocket: any = null;
    const server: any = net.createServer((socket: any) => {
      serverSocket = socket;
      socket.on('error', () => {});
      // on an accepted socket
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30000);
      socket.on('data', (chunk: Buffer) => socket.write(chunk));
    });
    const port = await listen(server);

    const client: any = net.connect(port, HOST);
    traceSocket(client, 'client', log);
    // before the connection exists: must be remembered and applied later
    const chained = client.setNoDelay().setKeepAlive(true);
    if (chained !== client) {
      throw new Error('the setters do not return the socket');
    }
    await waitFor(client, 'connect');
    await echoOnce(client, 'first');

    // on a connected socket, switching both off again
    client.setNoDelay(false);
    client.setKeepAlive(false);
    await echoOnce(client, 'second');

    await endClient(client);
    await closeServer(server);
    if (!serverSocket) {
      throw new Error('the server never saw the connection');
    }
    // The options themselves are not readable from JS; this only shows that
    // setting them at every stage does not break the connection.
    return 'set before connect, after connect and on an accepted socket';
  });

  await step('dns: a query can be given a timeout', async log => {
    // A timeout can only be observed if the timer fires before the answer
    // arrives, and a resolver on the local network can answer in a couple of
    // milliseconds. So: ask for names nobody has cached, with the shortest
    // timeout there is, a few times over. One ETIMEOUT proves the mechanism;
    // if the resolver wins every time the step cannot tell and is skipped.
    const ATTEMPTS = 8;
    let serial = 0;
    const freshName = () =>
      `t${Date.now().toString(36)}${serial++}.timeout-test.example.org`;

    type Query = (hostname: string, done: (err: any) => void) => void;

    async function expectTimeout(label: string, query: Query): Promise<string> {
      const codes: string[] = [];
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const hostname = freshName();
        let calls = 0;
        const start = Date.now();
        const err = await new Promise<any>(resolve =>
          query(hostname, e => {
            calls++;
            resolve(e);
          }),
        );
        const took = Date.now() - start;
        // long enough for the answer that lost the race to show up
        await delay(300);

        const code = err ? err.code : 'answered';
        codes.push(code);
        log(`${label} attempt ${attempt + 1}: ${code} after ${took}ms`);
        if (calls !== 1) {
          throw new Error(`${label}: the callback ran ${calls} times`);
        }
        if (code === 'ETIMEOUT') {
          if (!err.message.includes(hostname)) {
            throw new Error(`${label}: unexpected message: ${err.message}`);
          }
          return `${label}: ETIMEOUT after ${took}ms`;
        }
      }
      throw new SkipError(
        `${label}: the resolver answered all ${ATTEMPTS} queries before a 1ms ` +
          `timer could fire (${codes.join(', ')})`,
      );
    }

    const direct = await expectTimeout('resolve4', (hostname, done) =>
      dns.resolve4(hostname, { timeout: 1 }, done),
    );

    // the default applies to lookups that do not name one, net.connect included
    dns.setDefaultTimeout(1);
    let viaDefault: string;
    try {
      viaDefault = await expectTimeout('lookup', (hostname, done) =>
        dns.lookup(hostname, done),
      );
    } finally {
      dns.setDefaultTimeout(0);
    }
    return `${direct}; ${viaDefault}`;
  }, 30000);

  await step('connect and listen check their arguments', async () => {
    const checks: Array<[string, string, () => unknown]> = [
      ['connect(70000)', 'RangeError', () => net.connect(70000)],
      ['connect(-1)', 'RangeError', () => net.connect(-1)],
      ['connect(1.5)', 'RangeError', () => net.connect(1.5)],
      ['connect({})', 'RangeError', () => net.connect({} as any)],
      ['connect(path)', 'Error', () => net.connect('/tmp/socket' as any)],
      ['connect()', 'TypeError', () => (net.connect as any)()],
      ['listen(65536)', 'RangeError', () => net.createServer().listen(65536)],
    ];
    for (const [label, name, fn] of checks) {
      expectThrow(label, name, fn);
    }
    return `${checks.length} bad calls rejected`;
  });

  await step('connect overloads default the host to 127.0.0.1', async log => {
    const { server, port } = await startEcho(HOST);
    try {
      const forms: Array<[string, (listener: () => void) => any]> = [
        ['connect(port, listener)', listener => net.connect(port, listener)],
        ['connect({ port }, listener)', listener => net.connect({ port }, listener)],
        ['connect(port, host, listener)', listener => net.connect(port, HOST, listener)],
        [
          'createConnection({ port, host }, listener)',
          listener => net.createConnection({ port, host: HOST }, listener),
        ],
      ];
      for (const [label, open] of forms) {
        let listenerCalls = 0;
        const client = open(() => listenerCalls++);
        traceSocket(client, label, log);
        if (!client.connecting || client.readyState !== 'opening') {
          throw new Error(
            `${label}: connecting ${client.connecting}, readyState ${client.readyState}`,
          );
        }
        await waitFor(client, 'connect');
        if (listenerCalls !== 1) {
          throw new Error(`${label}: the listener ran ${listenerCalls} times`);
        }
        if (client.connecting || client.readyState !== 'open') {
          throw new Error(
            `${label}: connecting ${client.connecting}, readyState ${client.readyState}`,
          );
        }
        if (client.remoteAddress !== HOST) {
          throw new Error(`${label}: connected to ${client.remoteAddress}`);
        }
        await echoOnce(client, label);
        await endClient(client);
      }
      return `${forms.length} forms reached ${HOST}`;
    } finally {
      await closeServer(server);
    }
  });

  await step("'lookup' is emitted before 'connect' or 'error'", async log => {
    const { server, port } = await startEcho(HOST);
    // Asynchronous, like dns.lookup: listeners are attached after connect()
    // returns, so a synchronous answer would come before them.
    const lookupAnswering =
      (err: any, addresses: any[]) =>
      (_host: string, _options: any, callback: any) =>
        setTimeout(() => callback(err, addresses), 0);

    try {
      const client: any = net.connect({
        port,
        host: 'custom.test',
        lookup: lookupAnswering(null, [{ address: HOST, family: 4 }]),
      });
      traceSocket(client, 'client', log);
      const events: string[] = [];
      let lookupArgs: any[] = [];
      client.on('lookup', (...args: any[]) => {
        events.push('lookup');
        lookupArgs = args;
      });
      client.on('connect', () => events.push('connect'));
      await waitFor(client, 'connect');
      await endClient(client);

      if (JSON.stringify(events) !== '["lookup","connect"]') {
        throw new Error(`events: ${JSON.stringify(events)}`);
      }
      const [err, address, family, host] = lookupArgs;
      if (err !== null || address !== HOST || family !== 4 || host !== 'custom.test') {
        throw new Error(`'lookup' arguments: ${JSON.stringify(lookupArgs)}`);
      }

      // a failed lookup: 'lookup' carries the error, 'error' keeps its code
      const failure = Object.assign(new Error('getaddrinfo ENOTFOUND failing.test'), {
        code: 'ENOTFOUND',
      });
      const failing: any = net.connect({
        port,
        host: 'failing.test',
        lookup: lookupAnswering(failure, []),
      });
      const failEvents: string[] = [];
      let lookupErr: any = null;
      let socketErr: any = null;
      failing.on('lookup', (e: any) => {
        failEvents.push('lookup');
        lookupErr = e;
      });
      failing.on('error', (e: any) => {
        failEvents.push('error');
        socketErr = e;
      });
      failing.on('close', () => failEvents.push('close'));
      await onceClosed(failing);
      if (JSON.stringify(failEvents) !== '["lookup","error","close"]') {
        throw new Error(`failed lookup events: ${JSON.stringify(failEvents)}`);
      }
      if (lookupErr !== failure || socketErr?.code !== 'ENOTFOUND') {
        throw new Error(`failed lookup error: ${socketErr?.code} ${socketErr?.message}`);
      }

      // a lookup that answers with no address at all
      const empty: any = net.connect({
        port,
        host: 'empty.test',
        lookup: lookupAnswering(null, []),
      });
      let emptyErr: any = null;
      empty.on('error', (e: any) => (emptyErr = e));
      await onceClosed(empty);
      log(`no addresses: ${emptyErr?.message}`);
      if (!emptyErr) {
        throw new Error("a lookup without addresses did not emit 'error'");
      }

      // A lookup that fails synchronously, inside connect(): the events still
      // reach the listeners attached after connect() returns, and nothing is
      // thrown out of connect().
      let syncFailing: any;
      try {
        syncFailing = net.connect({
          port,
          host: 'sync.test',
          lookup: (_host: string, _options: any, callback: any) =>
            callback(failure, []),
        });
      } catch (err) {
        throw new Error(`a synchronous lookup failure threw: ${errorMessage(err)}`);
      }
      const syncEvents: string[] = [];
      syncFailing.on('lookup', () => syncEvents.push('lookup'));
      syncFailing.on('error', () => syncEvents.push('error'));
      syncFailing.on('close', () => syncEvents.push('close'));
      await onceClosed(syncFailing);
      if (JSON.stringify(syncEvents) !== '["lookup","error","close"]') {
        throw new Error(`synchronous failed lookup events: ${JSON.stringify(syncEvents)}`);
      }
      return 'lookup -> connect, lookup -> error -> close, also when synchronous';
    } finally {
      await closeServer(server);
    }
  });

  await step("'close' says whether the socket had an error", async log => {
    const closeArgument = (socket: any) =>
      new Promise<unknown>(resolve =>
        socket.once('close', (hadError: unknown) => resolve(hadError)),
      );

    // a failed connect
    const probe: any = net.createServer();
    const freePort = await listen(probe);
    await closeServer(probe);
    const failed: any = net.connect(freePort, HOST);
    failed.on('error', () => {});
    const afterFailure = await closeArgument(failed);

    const { server, port } = await startEcho(HOST);
    try {
      // a clean end
      const clean = await connectClient(port, 'clean', log);
      const cleanClosed = closeArgument(clean);
      clean.end();
      const afterEnd = await cleanClosed;

      // destroy(err)
      const broken = await connectClient(port, 'broken', log);
      let emitted: any = null;
      broken.on('error', (e: any) => (emitted = e));
      const brokenClosed = closeArgument(broken);
      broken.destroy(new Error('boom'));
      const afterDestroy = await brokenClosed;

      const results = { afterFailure, afterEnd, afterDestroy };
      log(JSON.stringify(results));
      if (afterFailure !== true || afterEnd !== false || afterDestroy !== true) {
        throw new Error(`hadError: ${JSON.stringify(results)}`);
      }
      if (emitted?.message !== 'boom') {
        throw new Error(`destroy(err) emitted ${emitted?.message}`);
      }
      return 'failed connect: true, end: false, destroy(err): true';
    } finally {
      await closeServer(server);
    }
  });

  await step('addresses are undefined until connected', async log => {
    const { server, port } = await startEcho(HOST);
    try {
      const client: any = new net.Socket();
      const fields = [
        'localAddress',
        'localPort',
        'localFamily',
        'remoteAddress',
        'remotePort',
        'remoteFamily',
      ];
      for (const field of fields) {
        if (client[field] !== undefined) {
          throw new Error(`before connect, ${field} is ${client[field]}`);
        }
      }
      if (JSON.stringify(client.address()) !== '{}') {
        throw new Error(`before connect, address() is ${JSON.stringify(client.address())}`);
      }

      client.connect(port, HOST);
      traceSocket(client, 'client', log);
      await waitFor(client, 'connect');
      const address = client.address();
      const remote = `${client.remoteAddress}:${client.remotePort} ${client.remoteFamily}`;
      await endClient(client);

      log(`address() ${JSON.stringify(address)}, remote ${remote}`);
      if (
        address.address !== HOST ||
        address.family !== 'IPv4' ||
        !(address.port > 0) ||
        address.port !== client.localPort
      ) {
        throw new Error(`address() is ${JSON.stringify(address)}`);
      }
      if (remote !== `${HOST}:${port} IPv4`) {
        throw new Error(`remote end is ${remote}`);
      }
      return JSON.stringify(address);
    } finally {
      await closeServer(server);
    }
  });

  await step('connect options: timeout, noDelay, keepAlive', async log => {
    const { server, port } = await startEcho(HOST);
    try {
      const client: any = net.connect({
        port,
        host: HOST,
        timeout: 300,
        noDelay: true,
        keepAlive: true,
        keepAliveInitialDelay: 1000,
      });
      traceSocket(client, 'client', log);
      await waitFor(client, 'connect');
      await echoOnce(client, 'with options');

      const idleStart = Date.now();
      await waitFor(client, 'timeout');
      const idle = Date.now() - idleStart;
      log(`'timeout' after ${idle}ms idle`);
      if (idle < 150) {
        throw new Error(`'timeout' after only ${idle}ms`);
      }
      if (client.destroyed) {
        throw new Error("'timeout' destroyed the socket");
      }
      await echoOnce(client, 'still open');
      await endClient(client);
      return `'timeout' after ${idle}ms idle, socket still usable`;
    } finally {
      await closeServer(server);
    }
  });

  await step('server options: pauseOnConnect, noDelay, keepAlive', async log => {
    let onAccepted: (socket: any) => void = () => {};
    const accepted = new Promise<any>(resolve => (onAccepted = resolve));
    const server: any = net.createServer(
      { pauseOnConnect: true, noDelay: true, keepAlive: true, keepAliveInitialDelay: 1000 },
      (socket: any) => {
        socket.on('error', () => {});
        onAccepted(socket);
      },
    );
    const port = await listen(server);

    try {
      const client = await connectClient(port, 'client', log);
      const socket = await accepted;
      client.write('hello');
      await delay(300);
      if (socket.bytesRead !== 0) {
        throw new Error(`the paused socket read ${socket.bytesRead} bytes`);
      }

      // a 'data' listener starts reading
      const { data } = await readBytes(socket, 5);
      if (data.toString() !== 'hello') {
        throw new Error(`server got ${JSON.stringify(data.toString())}`);
      }
      const back = readBytes(client, 4);
      socket.write('back');
      if ((await back).data.toString() !== 'back') {
        throw new Error('the reply did not arrive');
      }
      await endClient(client);
      return 'nothing read until a listener was attached';
    } finally {
      await closeServer(server);
    }
  });

  await step('server option allowHalfOpen keeps the write side open', async log => {
    const server: any = net.createServer({ allowHalfOpen: true }, (socket: any) => {
      socket.on('error', (err: Error) => log(`server socket: error: ${err.message}`));
      socket.resume();
      // the client has ended its side; this one may still write
      socket.on('end', () => setTimeout(() => socket.end('after end'), 100));
    });
    const port = await listen(server);

    try {
      const client = await connectClient(port, 'client', log);
      const received = collectText(client);
      const closed = onceClosed(client);
      client.end();
      await closed;

      log(`received ${JSON.stringify(received.text)}`);
      if (received.text !== 'after end') {
        throw new Error(
          `received ${JSON.stringify(received.text)} after ending: the server ` +
            'closed its write side together with its read side',
        );
      }
      return 'the server wrote after the client ended';
    } finally {
      await closeServer(server);
    }
  });

  await step('connect option allowHalfOpen keeps the write side open', async log => {
    // The server ends its side first, then waits for the client's reply.
    let onReply: (text: string) => void = () => {};
    const reply = new Promise<string>(resolve => (onReply = resolve));
    const server: any = net.createServer((socket: any) => {
      socket.on('error', (err: Error) => log(`server socket: error: ${err.message}`));
      let text = '';
      socket.on('data', (chunk: Buffer) => (text += chunk.toString()));
      socket.on('end', () => onReply(text));
      socket.end('bye');
    });
    const port = await listen(server);

    try {
      const client: any = net.connect({ port, host: HOST, allowHalfOpen: true });
      traceSocket(client, 'client', log);
      const closed = onceClosed(client);
      let ended = false;
      client.on('data', () => {});
      client.on('end', () => {
        ended = true;
        // still writable after the server's end
        setTimeout(() => client.end('reply after end'), 100);
      });

      const text = await reply;
      await closed;
      log(`server received ${JSON.stringify(text)}`);
      if (!ended) {
        throw new Error("the client never got 'end'");
      }
      if (text !== 'reply after end') {
        throw new Error(
          `the server received ${JSON.stringify(text)}: the client closed its ` +
            'write side together with its read side',
        );
      }
      if (!client.destroyed) {
        throw new Error('the client was not destroyed once both sides ended');
      }
      return 'the client wrote after the server ended, then closed';
    } finally {
      await closeServer(server);
    }
  });

  await step('listen overloads, and listen() returns the server', async () => {
    const servers: any[] = [];
    const make = () => {
      const server: any = net.createServer();
      servers.push(server);
      return server;
    };

    try {
      // listen(options, callback)
      const a = make();
      let aCalled = false;
      if (a.listen({ port: 0, host: HOST }, () => (aCalled = true)) !== a) {
        throw new Error('listen() does not return the server');
      }
      await waitFor(a, 'listening');

      // listen(port, host, backlog, callback): the backlog is ignored
      const b = make();
      let bCalled = false;
      b.listen(0, HOST, 511, () => (bCalled = true));
      await waitFor(b, 'listening');

      // listen(callback): any port, on 127.0.0.1
      const c = make();
      let cCalled = false;
      c.listen(() => (cCalled = true));
      await waitFor(c, 'listening');

      if (!aCalled || !bCalled || !cCalled) {
        throw new Error(`callbacks: ${aCalled}, ${bCalled}, ${cCalled}`);
      }
      for (const server of servers) {
        const address = server.address();
        if (address?.address !== HOST || !(address.port > 0)) {
          throw new Error(`listening on ${JSON.stringify(address)}`);
        }
      }

      // again while listening: nothing happens
      let listenings = 0;
      a.on('listening', () => listenings++);
      if (a.listen(0) !== a) {
        throw new Error('a second listen() does not return the server');
      }
      await delay(200);
      if (listenings !== 0) {
        throw new Error("a second listen() emitted 'listening'");
      }
      return 'options, port/host/backlog, callback only';
    } finally {
      await Promise.all(servers.filter(s => s.address()).map(closeServer));
    }
  });

  await step('ref, unref and destroySoon', async log => {
    const payload = makePayload(256 * 1024);
    let onServerEnd: (bytes: number) => void = () => {};
    const serverEnd = new Promise<number>(resolve => (onServerEnd = resolve));
    const server: any = net.createServer((socket: any) => {
      socket.on('error', () => {});
      let bytes = 0;
      socket.on('data', (chunk: Buffer) => (bytes += chunk.length));
      socket.on('end', () => onServerEnd(bytes));
    });
    const port = await listen(server);

    try {
      const client = await connectClient(port, 'client', log);
      if (client.ref() !== client || client.unref() !== client) {
        throw new Error('ref() and unref() do not return the socket');
      }
      const closed = onceClosed(client);
      client.write(payload);
      client.destroySoon();
      const bytes = await serverEnd;
      await closed;

      if (bytes !== payload.length) {
        throw new Error(`the server got ${bytes} of ${payload.length} bytes`);
      }
      if (!client.destroyed) {
        throw new Error('destroySoon() did not destroy the socket');
      }
      return `${bytes} bytes written, then destroyed`;
    } finally {
      await closeServer(server);
    }
  });

  await step('isIP, and dns.lookup of an IP address', async () => {
    const ipCases: Array<[string, number]> = [
      ['127.0.0.1', 4],
      ['255.255.255.255', 4],
      ['256.0.0.1', 0],
      ['::1', 6],
      ['fe80::1%en0', 6],
      ['2001:db8::192.0.2.1', 6],
      ['localhost', 0],
      ['', 0],
    ];
    for (const [input, expected] of ipCases) {
      const got = [net.isIP(input), net.isIPv4(input), net.isIPv6(input)];
      const want = [expected, expected === 4, expected === 6];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`${JSON.stringify(input)}: got ${got}, expected ${want}`);
      }
    }

    // answered as is, without a query, but never synchronously
    let returned = false;
    let synchronous = false;
    const one = await new Promise<any[]>(resolve => {
      dns.lookup('127.0.0.1', (...args) => {
        synchronous = !returned;
        resolve(args);
      });
      returned = true;
    });
    const all = await new Promise<any[]>(resolve =>
      dns.lookup('::1', { all: true }, (...args) => resolve(args)),
    );
    const named = await new Promise<any[]>(resolve =>
      dns.lookup('127.0.0.1', { family: 'IPv4' }, (...args) => resolve(args)),
    );

    if (synchronous) {
      throw new Error('the callback ran before lookup() returned');
    }
    if (JSON.stringify(one) !== '[null,"127.0.0.1",4]') {
      throw new Error(`lookup(ip): ${JSON.stringify(one)}`);
    }
    if (JSON.stringify(all) !== '[null,[{"address":"::1","family":6}]]') {
      throw new Error(`lookup(ip, { all: true }): ${JSON.stringify(all)}`);
    }
    if (JSON.stringify(named) !== '[null,"127.0.0.1",4]') {
      throw new Error(`lookup(ip, { family: 'IPv4' }): ${JSON.stringify(named)}`);
    }
    return `${ipCases.length} isIP cases, 3 lookups`;
  });

  await step('dns checks its arguments', async () => {
    const callback = () => {};
    const checks: Array<[string, string, () => unknown]> = [
      ['lookup(host, 5)', 'TypeError', () => dns.lookup('example.com', 5, callback)],
      ["lookup(host, 'x')", 'TypeError', () => dns.lookup('example.com', 'x' as any, callback)],
      ['lookup without callback', 'TypeError', () => (dns.lookup as any)('example.com', {})],
      ['setDefaultTimeout(-1)', 'TypeError', () => dns.setDefaultTimeout(-1)],
      [
        'resolve4 with timeout -1',
        'TypeError',
        () => dns.resolve4('example.com', { timeout: -1 }, callback),
      ],
      ["resolve(host, 'MX')", 'Error', () => dns.resolve('example.com', 'MX' as any, callback)],
    ];
    for (const [label, name, fn] of checks) {
      expectThrow(label, name, fn);
    }
    if (dns.getDefaultTimeout() !== 0) {
      throw new Error(`a rejected setDefaultTimeout() changed it to ${dns.getDefaultTimeout()}`);
    }

    const constants: Array<[string, string]> = [
      [dns.NOTFOUND, 'ENOTFOUND'],
      [dns.TIMEOUT, 'ETIMEOUT'],
      [dns.SERVFAIL, 'ESERVFAIL'],
      [dns.CANCELLED, 'ECANCELLED'],
    ];
    for (const [value, expected] of constants) {
      if (value !== expected) {
        throw new Error(`dns constant is ${value}, expected ${expected}`);
      }
    }
    return `${checks.length} bad calls rejected`;
  });

  await step('dns: flags, result order and promises, as Node', async () => {
    const same = (label: string, actual: unknown, expected: unknown) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
      }
    };
    same('constants', [dns.ADDRCONFIG, dns.ALL, dns.V4MAPPED], [1024, 256, 2048]);
    same('default order', dns.getDefaultResultOrder(), 'verbatim');
    dns.setDefaultResultOrder('ipv4first');
    same('set order', dns.getDefaultResultOrder(), 'ipv4first');
    dns.setDefaultResultOrder('verbatim');

    // Node's messages
    const message = (fn: () => unknown) => {
      try {
        fn();
      } catch (err: any) {
        return `${err.code}: ${err.message}`;
      }
      return 'no error';
    };
    same('bad order', message(() => dns.setDefaultResultOrder('random' as any)),
      "ERR_INVALID_ARG_VALUE: The argument 'dnsOrder' must be one of: 'verbatim', 'ipv4first', 'ipv6first'. Received 'random'");
    same('bad hints', message(() => dns.lookup('example.com', { hints: 9999 }, () => {})),
      "ERR_INVALID_ARG_VALUE: The argument 'hints' is invalid. Received 9999");
    same('bad family', message(() => dns.lookup('example.com', 5, () => {})),
      "ERR_INVALID_ARG_VALUE: The argument 'family' must be one of: 0, 4, 6. Received 5");

    // an empty hostname answers null, as Node (with a DEP0118 warning)
    const empty = await new Promise(resolve => dns.lookup('', (...args: unknown[]) => resolve(args)));
    same("lookup('')", empty, [null, null, 4]);
    same("promises.lookup('')", await dnsPromises.lookup(''), { address: null, family: 4 });
    same('promises IP', await dnsPromises.lookup('10.0.0.1'), { address: '10.0.0.1', family: 4 });
    if (dnsPromises.lookup !== dns.promises.lookup) {
      throw new Error('dns/promises is not dns.promises');
    }
    return 'constants, order, errors, promises';
  });

  await step('dns: lookup order and V4MAPPED (needs network)', async log => {
    const all = (options: dns.LookupOptions) =>
      new Promise<dns.LookupAddress[]>((resolve, reject) =>
        dns.lookup('example.com', { ...options, all: true }, (err, addresses: any) => (err ? reject(err) : resolve(addresses))),
      );
    const v4first = await all({ order: 'ipv4first' });
    const v6first = await all({ order: 'ipv6first' });
    log(`ipv4first: ${v4first.map(a => a.address).join(', ')}`);
    if (v4first[0]?.family !== 4 || !v4first.some(a => a.family === 6)) {
      throw new Error(`ipv4first: ${JSON.stringify(v4first)}`);
    }
    if (v6first[0]?.family !== 6) {
      throw new Error(`ipv6first: ${JSON.stringify(v6first)}`);
    }
    const mapped = await all({ family: 6, hints: dns.V4MAPPED | dns.ALL });
    if (!mapped.some(a => a.address.startsWith('::ffff:')) || mapped.some(a => a.family !== 6)) {
      throw new Error(`V4MAPPED|ALL: ${JSON.stringify(mapped)}`);
    }
    const one = await dns.promises.lookup('example.com', { family: 4 });
    if (one.family !== 4) {
      throw new Error(`promises.lookup: ${JSON.stringify(one)}`);
    }
    return `${v4first.length} addresses, ${mapped.filter(a => a.address.startsWith('::ffff:')).length} mapped`;
  }, 20000);
}
