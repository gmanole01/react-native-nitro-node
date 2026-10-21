import * as http from 'react-native-nitro-node/http';
import http2 from 'react-native-nitro-node/http2';
import * as net from 'react-native-nitro-node/net';
import { Buffer } from 'buffer';
import {
  HOST,
  LOG_PREFIX,
  type Log,
  type Step,
  collectText,
  connectClient,
  countOccurrences,
  delay,
  expectConnectError,
  expectThrow,
  makePayload,
  waitFor,
} from './testUtils';

type Handler = (req: any, res: any) => void;

async function startServer(options: any, handler: Handler) {
  const server: any = http.createServer(options, handler);
  server.on('error', (err: Error) =>
    console.error(`${LOG_PREFIX} http server: error: ${err.message}`),
  );
  server.listen(0, HOST);
  await waitFor(server, 'listening');
  const port: number = server.address()?.port ?? 0;
  if (!port) {
    throw new Error('server.address() returned no port');
  }
  return { server, port };
}

async function stopServer(server: any) {
  const closed = waitFor(server, 'close');
  server.close();
  await closed;
}

interface Response {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  // Resolves when the request emits 'close'.
  closed: Promise<void>;
}

/** Sends a request with the library's own client and reads the whole body. */
function request(options: any, body?: Buffer | string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req: any = new http.ClientRequest(
      { host: HOST, ...options },
      (res: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            closed,
          }),
        );
      },
    );
    const closed = new Promise<void>(done => req.once('close', () => done()));
    req.on('error', reject);
    if (body === undefined) {
      req.end();
    } else {
      req.end(body);
    }
  });
}

/** A plain TCP client, for sending hand-written HTTP. */
async function rawClient(port: number, log: Log) {
  const socket = await connectClient(port, 'raw client', log);
  const received = collectText(socket);
  const closed = new Promise<void>(resolve =>
    socket.once('close', () => resolve()),
  );
  return { socket, received, closed };
}

function okResponses(text: string): number {
  return countOccurrences(text, 'HTTP/1.1 200');
}

/**
 * The HTTP fixes: connections are closed when they are done, idle and stalled
 * connections time out, bodies respect backpressure, the server can be closed.
 */
export async function runHttpTests(step: Step) {
  await step('http: GET round trip closes both ends', async log => {
    let serverSocketClosed: Promise<void> | null = null;
    const { server, port } = await startServer({}, (req, res) => {
      serverSocketClosed = waitFor(req.socket, 'close');
      res.end('hello');
    });

    try {
      // agent: false: the global agent keeps connections open for reuse, as
      // Node's does, and this checks the request that closes them
      const response = await request({ port, path: '/', agent: false });
      log(`status ${response.status}, headers ${JSON.stringify(response.headers)}`);

      if (response.status !== 200) {
        throw new Error(`status ${response.status}`);
      }
      if (response.body.toString('utf8') !== 'hello') {
        throw new Error(`body "${response.body.toString('utf8')}"`);
      }
      if (response.headers.connection !== 'close') {
        throw new Error(
          `expected "Connection: close", got "${response.headers.connection}"`,
        );
      }

      await response.closed;
      log("request emitted 'close'");
      if (!serverSocketClosed) {
        throw new Error('the handler never ran');
      }
      await serverSocketClosed;
      log('server side of the connection closed');
      return 'response received, request and server socket closed';
    } finally {
      await stopServer(server);
    }
  });

  await step('http: POST body is delivered and echoed', async () => {
    const { server, port } = await startServer({}, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => res.end(Buffer.concat(chunks)));
    });

    try {
      const body = makePayload(100 * 1024);
      const response = await request({ port, path: '/', method: 'POST' }, body);
      if (!response.body.equals(body)) {
        throw new Error(
          `echo mismatch, got ${response.body.length} of ${body.length} bytes`,
        );
      }
      return `${body.length} bytes echoed`;
    } finally {
      await stopServer(server);
    }
  });

  await step('http: server closes after "Connection: close"', async log => {
    const { server, port } = await startServer({}, (_req, res) => res.end('bye'));

    try {
      const { socket, received, closed } = await rawClient(port, log);
      socket.write('GET / HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n');

      const text = await received.until(t => t.endsWith('bye'));
      if (!/\r\nconnection: close\r\n/i.test(text)) {
        throw new Error(`no "Connection: close" header in: ${JSON.stringify(text)}`);
      }
      // We never end the socket ourselves: the server has to close it.
      await closed;
      return 'server closed the connection';
    } finally {
      await stopServer(server);
    }
  });

  await step('http: keep-alive reuses the connection, then idles out', async log => {
    const keepAliveTimeout = 400;
    let sockets = 0;
    const seen = new Set<any>();
    const { server, port } = await startServer(
      { keepAliveTimeout },
      (req, res) => {
        if (!seen.has(req.socket)) {
          seen.add(req.socket);
          sockets++;
        }
        res.end('ok');
      },
    );

    try {
      const { socket, received, closed } = await rawClient(port, log);

      socket.write('GET /1 HTTP/1.1\r\nHost: test\r\n\r\n');
      const first = await received.until(t => okResponses(t) === 1 && t.endsWith('ok'));
      if (!/\r\nconnection: keep-alive\r\n/i.test(first)) {
        throw new Error(`no "Connection: keep-alive" header in: ${JSON.stringify(first)}`);
      }

      socket.write('GET /2 HTTP/1.1\r\nHost: test\r\n\r\n');
      await received.until(t => okResponses(t) === 2 && t.endsWith('ok'));
      if (sockets !== 1) {
        throw new Error(`the two requests used ${sockets} connections`);
      }

      const idleStart = Date.now();
      await closed;
      const idle = Date.now() - idleStart;
      log(`closed after ${idle}ms idle`);
      if (idle < keepAliveTimeout / 2) {
        throw new Error(`closed after only ${idle}ms, before keepAliveTimeout`);
      }
      seen.clear();
      return `2 requests on 1 connection, closed after ${idle}ms idle`;
    } finally {
      await stopServer(server);
    }
  });

  await step('http: headersTimeout closes a silent connection', async log => {
    const headersTimeout = 400;
    const { server, port } = await startServer({ headersTimeout }, (_req, res) =>
      res.end('never'),
    );

    try {
      const start = Date.now();
      const { closed } = await rawClient(port, log);
      // send nothing at all
      await closed;
      const elapsed = Date.now() - start;
      if (elapsed < headersTimeout / 2) {
        throw new Error(`closed after only ${elapsed}ms`);
      }
      return `closed after ${elapsed}ms`;
    } finally {
      await stopServer(server);
    }
  });

  await step('http: requestTimeout closes a stalled request', async log => {
    const requestTimeout = 400;
    let requests = 0;
    const { server, port } = await startServer({ requestTimeout }, () => {
      // never responds; the body never arrives either
      requests++;
    });

    try {
      const { socket, closed } = await rawClient(port, log);
      const start = Date.now();
      socket.write('POST / HTTP/1.1\r\nHost: test\r\nContent-Length: 10\r\n\r\n');
      await closed;
      const elapsed = Date.now() - start;
      if (requests !== 1) {
        throw new Error(`the handler ran ${requests} times`);
      }
      if (elapsed < requestTimeout / 2) {
        throw new Error(`closed after only ${elapsed}ms`);
      }
      return `closed after ${elapsed}ms`;
    } finally {
      await stopServer(server);
    }
  });

  await step('http: an unread request body does not stall keep-alive', async log => {
    // The handler answers without ever reading the body.
    const { server, port } = await startServer({}, (_req, res) => res.end('ok'));

    try {
      const { socket, received } = await rawClient(port, log);
      const body = Buffer.alloc(200 * 1024, 0x62);

      socket.write(
        `POST /upload HTTP/1.1\r\nHost: test\r\nContent-Length: ${body.length}\r\n\r\n`,
      );
      socket.write(body);
      await received.until(t => okResponses(t) === 1 && t.endsWith('ok'));
      log('first response received');

      socket.write('GET /next HTTP/1.1\r\nHost: test\r\n\r\n');
      await received.until(t => okResponses(t) === 2 && t.endsWith('ok'));

      const closed = waitFor(socket, 'close');
      socket.destroy();
      await closed;
      return 'second request answered on the same connection';
    } finally {
      await stopServer(server);
    }
  });

  await step('http: Expect: 100-continue', async log => {
    const { server, port } = await startServer({}, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => res.end(Buffer.concat(chunks)));
    });

    try {
      const { socket, received } = await rawClient(port, log);
      socket.write(
        'POST / HTTP/1.1\r\nHost: test\r\nExpect: 100-continue\r\n' +
          'Content-Length: 5\r\nConnection: close\r\n\r\n',
      );
      await received.until(t => t.includes('HTTP/1.1 100 Continue\r\n\r\n'));
      log('got 100 Continue');

      socket.write('hello');
      const text = await received.until(
        t => okResponses(t) === 1 && t.endsWith('hello'),
      );
      return `${text.length} bytes received in total`;
    } finally {
      await stopServer(server);
    }
  });

  await step('http: an unread response is not buffered whole', async log => {
    const total = 8 * 1024 * 1024;
    const { server, port } = await startServer({}, (_req, res) =>
      res.end(Buffer.alloc(total, 0x63)),
    );

    try {
      const res: any = await new Promise((resolve, reject) => {
        const req: any = new http.ClientRequest({ host: HOST, port, path: '/' }, resolve);
        req.on('error', reject);
        req.end();
      });

      // Do not read yet. With backpressure the socket is paused once the
      // response's buffer is full; without it the whole body piles up here.
      await delay(1000);
      const buffered: number = res.readableLength;
      log(`${buffered} of ${total} bytes buffered while unread`);
      if (buffered >= total / 2) {
        throw new Error(
          `${buffered} of ${total} bytes were buffered while nobody was reading`,
        );
      }

      let received = 0;
      await new Promise<void>((resolve, reject) => {
        res.on('data', (chunk: Buffer) => (received += chunk.length));
        res.on('error', reject);
        res.on('end', () => resolve());
      });
      if (received !== total) {
        throw new Error(`received ${received} bytes, expected ${total}`);
      }
      return `${buffered} bytes buffered while unread, all ${total} once read`;
    } finally {
      await stopServer(server);
    }
  });

  // Both hand the socket over to the listener. Bytes sent in the same packet
  // as the headers must reach it as `head`, and nothing sent afterwards may go
  // to the HTTP parser.
  const handovers = [
    {
      event: 'upgrade',
      request:
        'GET /chat HTTP/1.1\r\nHost: test\r\n' +
        'Connection: Upgrade\r\nUpgrade: test\r\n\r\n',
      reply: 'HTTP/1.1 101 Switching Protocols\r\n\r\n',
    },
    {
      event: 'connect',
      request: 'CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n',
      reply: 'HTTP/1.1 200 Connection Established\r\n\r\n',
    },
  ];
  for (const { event, request: head, reply } of handovers) {
    await step(`http: '${event}' receives the bytes after the headers`, async log => {
      let requests = 0;
      let headLength = -1;
      const { server, port } = await startServer({}, (_req, res) => {
        requests++;
        res.end('unexpected');
      });
      server.on(event, (_req: any, socket: any, early: Buffer) => {
        headLength = early.length;
        socket.on('error', () => {});
        socket.write(reply);
        socket.write(early);
        socket.on('data', (chunk: Buffer) => socket.write(chunk));
      });

      const client = await connectClient(port, 'client', log);
      const received = collectText(client);
      // one write, so the headers and EARLY normally arrive as one chunk
      client.write(head + 'EARLY');
      await received.until(text => text.includes('EARLY'));
      log(`head was ${headLength} bytes`);

      client.write('LATER');
      await received.until(text => text.includes('LATER'));
      await delay(100);

      const text = received.text;
      const closed = waitFor(client, 'close');
      client.destroy();
      await closed;
      await stopServer(server);

      if (text !== reply + 'EARLYLATER') {
        throw new Error(`unexpected data: ${JSON.stringify(text.slice(0, 200))}`);
      }
      if (requests !== 0) {
        throw new Error(`'request' was emitted ${requests} times`);
      }
      if (headLength !== 5) {
        // Not a failure of the library if the packet was split, but then the
        // head path was not exercised.
        throw new Error(`head was ${headLength} bytes, expected 5`);
      }
      return 'head delivered, later data went to the listener only';
    });
  }

  await step('http: socket options set before the request connects', async () => {
    const { server, port } = await startServer({}, (_req, res) => res.end('ok'));

    const body = await new Promise<string>((resolve, reject) => {
      const req: any = new http.ClientRequest(
        { host: HOST, port, path: '/' },
        (res: any) => {
          let text = '';
          res.on('data', (chunk: Buffer) => (text += chunk.toString()));
          res.on('error', reject);
          res.on('end', () => resolve(text));
        },
      );
      req.on('error', reject);
      // The request has no socket yet at this point.
      req.setNoDelay(true);
      req.setSocketKeepAlive(true, 30000);
      req.end();
    });
    await stopServer(server);

    if (body !== 'ok') {
      throw new Error(`unexpected body: ${JSON.stringify(body)}`);
    }
    // The options are not readable from JS; this shows only that setting them
    // early neither throws nor breaks the request.
    return 'request completed';
  });

  await step('http: request to a closed port emits error', async log => {
    const probe: any = net.createServer();
    probe.listen(0, HOST);
    await waitFor(probe, 'listening');
    const port: number = probe.address().port;
    const probeClosed = waitFor(probe, 'close');
    probe.close();
    await probeClosed;

    let message = '';
    try {
      await request({ port, path: '/' });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    log(`error: ${message}`);
    if (!message) {
      throw new Error('the request succeeded against a closed port');
    }
    return message;
  });

  await step('http: server.close() stops the server', async log => {
    const { server, port } = await startServer({}, (_req, res) => res.end('ok'));

    const response = await request({ port, path: '/' });
    if (response.status !== 200) {
      throw new Error(`status ${response.status}`);
    }

    let callbackCalled = false;
    const closed = waitFor(server, 'close');
    server.close(() => {
      callbackCalled = true;
    });
    await closed;
    await delay(50);
    if (!callbackCalled) {
      throw new Error('the close callback was not called');
    }

    const message = await expectConnectError(port, HOST);
    log(`connect after close: ${message}`);
    return 'closed, port no longer accepts connections';
  });

  await step('http.request and http.get take a URL or options', async log => {
    const handler: Handler = (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization ?? null,
        }),
      );
    };
    const { server, port } = await startServer({}, handler);
    const v6: any = http.createServer(handler);
    v6.listen(0, '::1');
    await waitFor(v6, 'listening');
    const v6Port: number = v6.address().port;

    const base = `http://${HOST}:${port}`;
    const basic = (credentials: string) =>
      'Basic ' + Buffer.from(credentials).toString('base64');
    type Send = (callback: (res: any) => void) => any;
    const cases: Array<[string, Send, object]> = [
      [
        'get(url)',
        cb => http.get(`${base}/a?b=1`, cb),
        { method: 'GET', url: '/a?b=1', authorization: null },
      ],
      [
        'get({ href })',
        cb => http.get({ href: `${base}/href` }, cb),
        { method: 'GET', url: '/href', authorization: null },
      ],
      [
        'request(url, options) with a lower-case method',
        cb => {
          const req = http.request(`${base}/post`, { method: 'post' }, cb);
          req.end('x');
          return req;
        },
        { method: 'POST', url: '/post', authorization: null },
      ],
      [
        'request(options)',
        cb => {
          const req = http.request({ host: HOST, port, path: '/opts' }, cb);
          req.end();
          return req;
        },
        { method: 'GET', url: '/opts', authorization: null },
      ],
      [
        'get(url, options): the options win',
        cb => http.get(`${base}/from-url`, { path: '/from-options' }, cb),
        { method: 'GET', url: '/from-options', authorization: null },
      ],
      [
        'get(url with credentials)',
        cb => http.get(`http://user:p%40ss@${HOST}:${port}/auth`, cb),
        { method: 'GET', url: '/auth', authorization: basic('user:p@ss') },
      ],
      [
        'get({ auth })',
        cb => http.get({ host: HOST, port, path: '/auth', auth: 'a:b' }, cb),
        { method: 'GET', url: '/auth', authorization: basic('a:b') },
      ],
      [
        'get({ defaultPort })',
        cb => http.get({ host: HOST, defaultPort: port, path: '/dp' }, cb),
        { method: 'GET', url: '/dp', authorization: null },
      ],
      [
        'get(url with an IPv6 host)',
        cb => http.get(`http://[::1]:${v6Port}/v6`, cb),
        { method: 'GET', url: '/v6', authorization: null },
      ],
    ];

    try {
      for (const [label, send, expected] of cases) {
        const answer = await new Promise<string>((resolve, reject) => {
          const req = send((res: any) => readBody(res).then(resolve, reject));
          req.on('error', reject);
        }).catch(err => {
          throw new Error(`${label}: ${err.message}`);
        });
        log(`${label}: ${answer}`);
        if (answer !== JSON.stringify(expected)) {
          throw new Error(`${label}: got ${answer}, expected ${JSON.stringify(expected)}`);
        }
      }
      return `${cases.length} forms answered`;
    } finally {
      await stopServer(server);
      await stopServer(v6);
    }
  });

  await step('http.request rejects what it cannot send', async () => {
    const checks: Array<[string, string, () => unknown]> = [
      ['an https: URL', 'TypeError', () => http.request('https://example.com/')],
      ["protocol 'ftp:'", 'TypeError', () => http.request({ protocol: 'ftp:', host: HOST })],
      ['not a URL', 'TypeError', () => http.request('not a url')],
    ];
    for (const [label, name, fn] of checks) {
      expectThrow(label, name, fn);
    }
    return `${checks.length} requests refused`;
  });

  await step("http: the timeout option emits 'timeout'", async log => {
    // never answers
    const { server, port } = await startServer({}, () => {});
    try {
      const start = Date.now();
      const req: any = http.request({ host: HOST, port, path: '/', timeout: 300 });
      req.on('error', (err: Error) => log(`request: error: ${err.message}`));
      req.end();
      await waitFor(req, 'timeout');
      const elapsed = Date.now() - start;
      req.destroy();
      log(`'timeout' after ${elapsed}ms`);
      if (elapsed < 150) {
        throw new Error(`'timeout' after only ${elapsed}ms`);
      }
      return `'timeout' after ${elapsed}ms`;
    } finally {
      await stopServer(server);
    }
  });

  await step('http: IncomingMessage.setTimeout times the socket', async log => {
    let fired = 0;
    let start = 0;
    const { server, port } = await startServer({}, (req, res) => {
      req.setTimeout(300, () => {
        fired++;
        res.end('timed out');
      });
    });
    try {
      const { socket, received } = await rawClient(port, log);
      start = Date.now();
      // the body never comes
      socket.write(
        'POST / HTTP/1.1\r\nHost: test\r\nContent-Length: 10\r\nConnection: close\r\n\r\n',
      );
      await received.until(t => t.endsWith('timed out'));
      const elapsed = Date.now() - start;
      socket.destroy();
      if (fired !== 1) {
        throw new Error(`the callback ran ${fired} times`);
      }
      if (elapsed < 150) {
        throw new Error(`fired after only ${elapsed}ms`);
      }
      return `fired after ${elapsed}ms`;
    } finally {
      await stopServer(server);
    }
  });

  await step('http: a client combines repeated response headers like Node', async log => {
    const server: any = net.createServer((socket: any) => {
      socket.on('error', () => {});
      socket.once('data', () =>
        socket.end(
          'HTTP/1.1 200 Fine\r\n' +
            'Set-Cookie: a=1\r\n' +
            'Set-Cookie: b=2\r\n' +
            'X-Multi: one\r\n' +
            'x-multi: two\r\n' +
            'Content-Type: text/plain\r\n' +
            'Content-Type: text/html\r\n' +
            'Content-Length: 2\r\n' +
            'Connection: close\r\n' +
            '\r\nok',
        ),
      );
    });
    server.listen(0, HOST);
    await waitFor(server, 'listening');
    const port: number = server.address().port;

    try {
      const res: any = await new Promise((resolve, reject) => {
        const req = http.get({ host: HOST, port, path: '/' }, resolve);
        req.on('error', reject);
      });
      const body = await readBody(res);
      const seen = {
        setCookie: res.headers['set-cookie'],
        multi: res.headers['x-multi'],
        contentType: res.headers['content-type'],
        rawHeaders: res.rawHeaders.length,
        firstRaw: res.rawHeaders[0],
        statusMessage: res.statusMessage,
        version: [res.httpVersion, res.httpVersionMajor, res.httpVersionMinor],
        body,
      };
      const expected = {
        setCookie: ['a=1', 'b=2'],
        multi: 'one, two',
        contentType: 'text/plain',
        rawHeaders: 16,
        firstRaw: 'Set-Cookie',
        statusMessage: 'Fine',
        version: ['1.1', 1, 1],
        body: 'ok',
      };
      log(JSON.stringify(seen));
      if (JSON.stringify(seen) !== JSON.stringify(expected)) {
        throw new Error(`got ${JSON.stringify(seen)}`);
      }
      return 'set-cookie listed, repeats joined, single-value headers keep the first';
    } finally {
      await stopServer(server);
    }
  });

  await step('http: a server combines repeated request headers like Node', async log => {
    let seen: any = null;
    const { server, port } = await startServer({}, (req, res) => {
      seen = {
        version: [req.httpVersion, req.httpVersionMajor, req.httpVersionMinor],
        host: req.headers.host,
        multi: req.headers['x-multi'],
        rawHeaders: req.rawHeaders,
      };
      res.end('ok');
    });
    try {
      const { socket, received } = await rawClient(port, log);
      socket.write(
        'GET / HTTP/1.0\r\nHost: first\r\nHost: second\r\nX-Multi: one\r\nx-multi: two\r\n\r\n',
      );
      await received.until(t => t.endsWith('ok'));
      socket.destroy();

      const expected = {
        version: ['1.0', 1, 0],
        host: 'first',
        multi: 'one, two',
        rawHeaders: ['Host', 'first', 'Host', 'second', 'X-Multi', 'one', 'x-multi', 'two'],
      };
      log(JSON.stringify(seen));
      if (JSON.stringify(seen) !== JSON.stringify(expected)) {
        throw new Error(`got ${JSON.stringify(seen)}`);
      }
      return 'HTTP/1.0 parsed, repeats combined';
    } finally {
      await stopServer(server);
    }
  });

  await step("http: a malformed request gets 400, or goes to 'clientError'", async log => {
    let requests = 0;
    const { server, port } = await startServer({}, (_req, res) => {
      requests++;
      res.end('unexpected');
    });
    try {
      // without a listener: 400 and the connection is closed
      const first = await rawClient(port, log);
      first.socket.write('NOT HTTP AT ALL\r\n\r\n');
      const answer = await first.received.until(t => t.includes('\r\n\r\n'));
      await first.closed;
      if (!answer.startsWith('HTTP/1.1 400 ')) {
        throw new Error(`without a listener: ${JSON.stringify(answer)}`);
      }

      // with one, the listener answers
      let clientErr: any = null;
      server.on('clientError', (err: any, socket: any) => {
        clientErr = err;
        socket.end("HTTP/1.1 418 I'm a Teapot\r\nConnection: close\r\n\r\n");
      });
      const second = await rawClient(port, log);
      second.socket.write('NOT HTTP AT ALL\r\n\r\n');
      const custom = await second.received.until(t => t.includes('\r\n\r\n'));
      await second.closed;
      log(`clientError: ${clientErr?.code} ${clientErr?.message}`);
      if (!custom.startsWith('HTTP/1.1 418 ')) {
        throw new Error(`with a listener: ${JSON.stringify(custom)}`);
      }
      if (typeof clientErr?.code !== 'string' || !clientErr.message) {
        throw new Error(`'clientError' got ${clientErr}`);
      }
      if (requests !== 0) {
        throw new Error(`'request' was emitted ${requests} times`);
      }
      return `400 by default, 418 from the listener (${clientErr.code})`;
    } finally {
      await stopServer(server);
    }
  });

  await step('http: a request head over maxHeaderSize is refused', async log => {
    const { server, port } = await startServer({ maxHeaderSize: 1024 }, (_req, res) =>
      res.end('ok'),
    );
    try {
      const small = await request({ port, path: '/' });
      if (small.status !== 200) {
        throw new Error(`a small request got ${small.status}`);
      }

      // the head is not even complete yet: it is refused as soon as it is too big
      const { socket, received, closed } = await rawClient(port, log);
      socket.write('GET / HTTP/1.1\r\nHost: test\r\nX-Big: ' + 'a'.repeat(4096));
      const answer = await received.until(t => t.includes('\r\n\r\n'));
      await closed;
      if (!answer.startsWith('HTTP/1.1 400 ')) {
        throw new Error(`got ${JSON.stringify(answer)}`);
      }
      return 'small request answered, 4KB head refused with 400';
    } finally {
      await stopServer(server);
    }
  });

  await step('http: a response that is not HTTP fails the request', async log => {
    const server: any = net.createServer((socket: any) => {
      socket.on('error', () => {});
      socket.once('data', () => socket.write('THIS IS NOT HTTP\r\n\r\n'));
    });
    server.listen(0, HOST);
    await waitFor(server, 'listening');
    const port: number = server.address().port;

    try {
      let responded = false;
      const err: any = await new Promise(resolve => {
        const req = http.get({ host: HOST, port, path: '/' }, () => (responded = true));
        req.on('error', resolve);
      });
      log(`error: ${err?.code} ${err?.message}`);
      if (responded) {
        throw new Error("'response' was emitted");
      }
      return err?.message ?? String(err);
    } finally {
      await stopServer(server);
    }
  });

  await step("http: writeHead with a header list, getHeaders, 'connection'", async log => {
    let connections = 0;
    let headerChecks = '';
    const server: any = http.createServer((_req: any, res: any) => {
      res.setHeader('X-List', ['1', '2']);
      // both hand out copies
      res.getHeader('x-list').push('3');
      res.getHeaders()['x-other'] = 'only in the copy';
      headerChecks = JSON.stringify([res.getHeader('x-list'), res.hasHeader('x-other')]);

      res.writeHead(201, 'Made It', ['X-Pair', 'value', 'Content-Type', 'text/plain']);
      res.end('ok');
    });
    server.on('connection', () => connections++);
    server.listen({ port: 0, host: HOST });
    await waitFor(server, 'listening');
    const port: number = server.address().port;

    try {
      const res: any = await new Promise((resolve, reject) => {
        const req = http.get({ host: HOST, port, path: '/' }, resolve);
        req.on('error', reject);
      });
      const body = await readBody(res);
      const seen = {
        status: `${res.statusCode} ${res.statusMessage}`,
        pair: res.headers['x-pair'],
        list: res.headers['x-list'],
        contentType: res.headers['content-type'],
        body,
        headerChecks,
        connections,
      };
      const expected = {
        status: '201 Made It',
        pair: 'value',
        list: '1, 2',
        contentType: 'text/plain',
        body: 'ok',
        headerChecks: '[["1","2"],false]',
        connections: 1,
      };
      log(JSON.stringify(seen));
      if (JSON.stringify(seen) !== JSON.stringify(expected)) {
        throw new Error(`got ${JSON.stringify(seen)}`);
      }
      return 'status, list headers and copies as expected';
    } finally {
      await stopServer(server);
    }
  });

  await step('http: a client leaving mid-request aborts the request, as Node', async log => {
    const run = (listenForError: boolean) =>
      new Promise<string[]>(async resolve => {
        const events: string[] = [];
        const { server, port } = await startServer({}, (req, res) => {
          events.push('request');
          req.on('aborted', () => events.push('aborted'));
          // without an 'error' listener the request gets none, as in Node
          if (listenForError) {
            req.on('error', (err: any) => events.push(`error ${err.code} ${err.message}`));
          }
          req.on('close', async () => {
            events.push('close');
            // answering a client that left is dropped, not an error
            res.end('too late');
            await delay(100);
            await stopServer(server);
            resolve(events);
          });
        });
        const client = await connectClient(port, 'client', log);
        // the body never completes
        client.write(`POST / HTTP/1.1\r\nHost: ${HOST}\r\nContent-Length: 100\r\n\r\npart`);
        await delay(100);
        client.destroy();
      });
    const withListener = await run(true);
    const without = await run(false);
    log(`${withListener.join(' → ')} | ${without.join(' → ')}`);
    const expected = ['request', 'aborted', 'error ECONNRESET aborted', 'close'];
    if (withListener.join() !== expected.join()) {
      throw new Error(`with an error listener: ${withListener.join(' → ')}`);
    }
    if (without.join() !== ['request', 'aborted', 'close'].join()) {
      throw new Error(`without one: ${without.join(' → ')}`);
    }
    return "'aborted' and 'close', an error only for a listener";
  });

  await step('http: a checkContinue listener answers with writeContinue', async log => {
    let requests = 0;
    const { server, port } = await startServer({}, () => requests++);
    server.on('checkContinue', (req: any, res: any) => {
      res.writeContinue();
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => res.end(Buffer.concat(chunks)));
    });

    try {
      const { socket, received } = await rawClient(port, log);
      socket.write(
        'POST / HTTP/1.1\r\nHost: test\r\nExpect: 100-continue\r\n' +
          'Content-Length: 5\r\nConnection: close\r\n\r\n',
      );
      await received.until(t => t.includes('HTTP/1.1 100 Continue\r\n\r\n'));
      socket.write('hello');
      await received.until(t => okResponses(t) === 1 && t.endsWith('hello'));
      socket.destroy();
      if (requests !== 0) {
        throw new Error(`'request' was emitted ${requests} times`);
      }
      return '100 Continue from the listener, body echoed';
    } finally {
      await stopServer(server);
    }
  });

  await step('http2: the stubs load and do nothing', async () => {
    if (http2.constants.HTTP2_HEADER_PATH !== ':path' || http2.constants.NGHTTP2_CANCEL !== 8) {
      throw new Error('constants are not Node\'s');
    }
    if (http2.getDefaultSettings().enablePush !== true) {
      throw new Error('getDefaultSettings: enablePush is not true');
    }
    let events = 0;
    const session = http2.connect('https://example.com', () => events++);
    const stream = session.request({ ':path': '/' });
    stream.on('response', () => events++);
    stream.end();
    const server = http2.createServer(() => events++);
    server.listen(0, () => events++);
    await delay(100);
    session.close();
    server.close();
    if (events !== 0) {
      throw new Error(`${events} events from the stubs`);
    }
  });
}

/** Reads a response body as text. */
function readBody(res: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    res.on('data', (chunk: Buffer) => (text += chunk.toString()));
    res.on('error', reject);
    res.on('end', () => resolve(text));
  });
}
