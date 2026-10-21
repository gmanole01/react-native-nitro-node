import * as http from 'react-native-nitro-node/http';
import * as https from 'react-native-nitro-node/https';
import { Buffer } from 'buffer';
import {
  HOST,
  LOG_PREFIX,
  type Step,
  delay,
  expectThrow,
  waitFor,
} from './testUtils';

type Handler = (req: any, res: any) => void;

/** A server on a free port that counts its connections. */
async function startServer(handler: Handler) {
  const server: any = http.createServer(handler);
  server.on('error', (err: Error) =>
    console.error(`${LOG_PREFIX} agent test server: error: ${err.message}`),
  );
  let connections = 0;
  server.on('connection', () => connections++);
  server.listen(0, HOST);
  await waitFor(server, 'listening');
  return { server, port: server.address().port as number, connections: () => connections };
}

async function stopServer(server: any) {
  const closed = waitFor(server, 'close');
  server.close();
  await closed;
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const { server, port } = await startServer(() => {});
  await stopServer(server);
  return port;
}

interface Result {
  req: any;
  res: any;
  body: string;
  socket: any;
  error?: any;
  closes: number;
}

/**
 * Sends a GET and reads the whole body. Resolves with the error instead of
 * rejecting, and counts the request's 'close' events (after a short wait, to
 * see a second one).
 */
function get(options: any, setup?: (req: any) => void): Promise<Result> {
  return new Promise(resolve => {
    let closes = 0;
    let socket: any = null;
    const done = (result: Omit<Result, 'closes' | 'socket' | 'req'>) =>
      setTimeout(() => resolve({ ...result, req, socket, closes }), 50);
    const req: any = http.request({ host: HOST, ...options }, (res: any) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => done({ res, body }));
    });
    req.on('socket', (s: any) => (socket = s));
    req.on('close', () => closes++);
    req.on('error', (error: any) => done({ res: null, body: '', error }));
    setup?.(req);
    req.end();
  });
}

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

function freeCount(agent: any): number {
  return Object.values(agent.freeSockets as Record<string, unknown[]>).flat().length;
}

/**
 * http.Agent and https.Agent: pooling and keep-alive, the queue, and the
 * request and response events when a connection goes away, all as Node's.
 */
export async function runAgentTests(step: Step) {
  await step('http.Agent: keepAlive reuses one connection', async log => {
    const { server, port, connections } = await startServer((_req, res) => res.end('ok'));
    const agent: any = new http.Agent({ keepAlive: true });
    try {
      const a = await get({ port, agent });
      const b = await get({ port, agent });
      log(`sent ${a.req.getHeader('connection')}, got ${a.res.headers.connection}`);
      expectEqual('bodies', [a.body, b.body], ['ok', 'ok']);
      expectEqual('Connection sent', a.req.getHeader('connection'), 'keep-alive');
      expectEqual('Connection received', a.res.headers.connection, 'keep-alive');
      expectEqual('same socket', a.socket === b.socket, true);
      expectEqual('server connections', connections(), 1);
      expectEqual('free sockets', freeCount(agent), 1);
      return '2 requests on 1 connection, then back in the pool';
    } finally {
      agent.destroy();
      await stopServer(server);
    }
  });

  await step('http.globalAgent / https.globalAgent: keep-alive, as Node 19+', async () => {
    const defaults = (agent: any) => [agent.keepAlive, agent.scheduling, agent.options.timeout];
    expectEqual('http.globalAgent', defaults(http.globalAgent), [true, 'lifo', 5000]);
    expectEqual('https.globalAgent', defaults(https.globalAgent), [true, 'lifo', 5000]);
    expectEqual('https.globalAgent is an https.Agent', https.globalAgent instanceof https.Agent, true);

    const { server, port, connections } = await startServer((_req, res) => res.end('ok'));
    try {
      const a = await get({ port });
      const b = await get({ port });
      expectEqual('agent', a.req.agent === http.globalAgent, true);
      expectEqual('same socket', a.socket === b.socket, true);
      expectEqual('server connections', connections(), 1);
      return 'requests without an agent share a connection';
    } finally {
      await stopServer(server);
    }
  });

  await step('http.Agent: agent: false and Connection: close are not pooled', async () => {
    const { server, port, connections } = await startServer((_req, res) => res.end('ok'));
    const agent: any = new http.Agent({ keepAlive: true });
    try {
      const a = await get({ port, agent: false });
      const b = await get({ port, agent: false });
      expectEqual('agent: false sends', a.req.getHeader('connection'), 'close');
      expectEqual('agent: false agents', [a.req.agent instanceof http.Agent, a.req.agent !== b.req.agent], [true, true]);
      const c = await get({ port, agent, headers: { connection: 'close' } });
      expectEqual('Connection: close body', c.body, 'ok');
      expectEqual('pooled after Connection: close', freeCount(agent), 0);
      expectEqual('server connections', connections(), 3);
      return '3 requests, 3 connections';
    } finally {
      agent.destroy();
      await stopServer(server);
    }
  });

  await step('http.Agent: maxSockets queues the requests', async log => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { server, port, connections } = await startServer((_req, res) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => {
        inFlight--;
        res.end('ok');
      }, 100);
    });
    const agent: any = new http.Agent({ maxSockets: 1 });
    try {
      const results = await Promise.all([1, 2, 3].map(i => get({ port, agent, path: `/${i}` })));
      log(`at most ${maxInFlight} at a time, ${connections()} connection(s)`);
      expectEqual('bodies', results.map(r => r.body), ['ok', 'ok', 'ok']);
      expectEqual('at most at a time', maxInFlight, 1);
      // a finite maxSockets keeps the connection for the queued requests
      expectEqual('server connections', connections(), 1);
      expectEqual('left queued', Object.keys(agent.requests).length, 0);
      return '3 requests, one at a time, on 1 connection';
    } finally {
      agent.destroy();
      await stopServer(server);
    }
  });

  await step('http.Agent: a queued request runs when the one before it fails', async () => {
    const { server, port } = await startServer((req, res) =>
      req.url === '/drop' ? req.socket.destroy() : res.end('ok'),
    );
    const agent: any = new http.Agent({ maxSockets: 1 });
    try {
      const [dropped, next] = await Promise.all([
        get({ port, agent, path: '/drop' }),
        get({ port, agent, path: '/next' }),
      ]);
      expectEqual('dropped', [dropped.error?.code, dropped.error?.message], ['ECONNRESET', 'socket hang up']);
      expectEqual('next', next.body, 'ok');
      return 'the queued request was answered';
    } finally {
      agent.destroy();
      await stopServer(server);
    }
  });

  await step('http.Agent: maxTotalSockets gives its places back', async () => {
    const refused = await closedPort();
    const { server, port } = await startServer((_req, res) => res.end('ok'));
    const agent: any = new http.Agent({ maxTotalSockets: 1 });
    try {
      // each one would wait forever if the one before kept its place
      const a = await get({ port: refused, agent });
      const b = await get({ port, agent });
      const c = await get({ port, agent, headers: { connection: 'close' } });
      const d = await get({ port, agent });
      expectEqual('results', [a.error?.code, b.body, c.body, d.body], ['ECONNREFUSED', 'ok', 'ok', 'ok']);
      return 'a refused connection and 3 requests, one place';
    } finally {
      agent.destroy();
      await stopServer(server);
    }
  });

  await step("http: 'socket hang up' and a single 'close', as Node", async log => {
    const refused = await closedPort();
    const { server, port } = await startServer((req, res) => {
      if (req.url === '/drop') {
        req.socket.destroy();
      } else if (req.url === '/slow') {
        setTimeout(() => res.end('late'), 300);
      } else {
        res.end('ok');
      }
    });
    try {
      const seen: Record<string, [string | undefined, string | undefined, number]> = {};
      const record = (label: string, r: Result, checkMessage = true) =>
        (seen[label] = [r.error?.code, checkMessage ? r.error?.message : undefined, r.closes]);
      record('normal', await get({ port, agent: false }));
      record('server drops', await get({ port, agent: false, path: '/drop' }));
      record('destroy()', await get({ port, agent: false, path: '/slow' }, req => setTimeout(() => req.destroy(), 50)));
      record('destroy(err)', await get({ port, agent: false, path: '/slow' }, req => setTimeout(() => req.destroy(new Error('mine')), 50)));
      record('destroy() at once', await get({ port, agent: false, path: '/slow' }, req => req.destroy()));
      // the message is net's ('connect: connection refused'), not Node's
      record('refused', await get({ port: refused, agent: false }), false);
      log(JSON.stringify(seen));
      expectEqual('events', seen, {
        normal: [undefined, undefined, 1],
        'server drops': ['ECONNRESET', 'socket hang up', 1],
        'destroy()': ['ECONNRESET', 'socket hang up', 1],
        'destroy(err)': [undefined, 'mine', 1],
        'destroy() at once': ['ECONNRESET', 'socket hang up', 1],
        refused: ['ECONNREFUSED', undefined, 1],
      });
      return '6 cases, one error and one close each';
    } finally {
      await stopServer(server);
    }
  });

  await step("http: a response cut off mid-body is 'aborted'", async log => {
    const { server, port } = await startServer((req, res) => {
      res.writeHead(200, { 'content-length': 100 });
      res.write('part');
      setTimeout(() => req.socket.destroy(), 50);
    });
    const run = (listenForError: boolean) =>
      new Promise<string[]>(resolve => {
        const events: string[] = [];
        const req: any = http.get({ host: HOST, port, agent: false }, (res: any) => {
          res.on('aborted', () => events.push('res aborted'));
          // without an 'error' listener the response gets none, as in Node
          if (listenForError) {
            res.on('error', (err: any) => events.push(`res error ${err.code} ${err.message}`));
          }
          res.on('close', () => {
            events.push(`res close (aborted: ${res.aborted})`);
            resolve(events);
          });
          res.resume();
        });
        req.on('error', (err: Error) => events.push(`req error ${err.message}`));
        req.on('close', () => events.push('req close'));
      });
    try {
      const withListener = await run(true);
      const without = await run(false);
      log(`${withListener.join(' → ')} | ${without.join(' → ')}`);
      expectEqual('with a res error listener', withListener, [
        'res aborted',
        'req close',
        'res error ECONNRESET aborted',
        'res close (aborted: true)',
      ]);
      expectEqual('without one', without, ['res aborted', 'req close', 'res close (aborted: true)']);
      return "'aborted', and an error only for a listener";
    } finally {
      await stopServer(server);
    }
  });

  await step('http.Agent: destroying a finished response leaves its socket alone', async () => {
    const { server, port } = await startServer((req, res) =>
      setTimeout(() => res.end(`ok ${req.url}`), req.url === '/slow' ? 200 : 0),
    );
    const agent: any = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const first = await get({ port, agent, path: '/fast' });
      const second = get({ port, agent, path: '/slow' });
      await delay(50);
      // the next request is using that socket now
      first.res.destroy();
      const result = await second;
      expectEqual('second', [result.body, result.socket === first.socket], ['ok /slow', true]);
      return 'the next request on the socket was answered';
    } finally {
      agent.destroy();
      await stopServer(server);
    }
  });

  await step('http.Agent: an error on a pooled socket is handled', async () => {
    const { server, port } = await startServer((_req, res) => res.end('ok'));
    const agent: any = new http.Agent({ keepAlive: true });
    try {
      const first = await get({ port, agent });
      expectEqual('pooled', freeCount(agent), 1);
      // two, as a socket can report more than one
      first.socket.emit('error', new Error('late 1'));
      first.socket.emit('error', new Error('late 2'));
      await delay(50);
      expectEqual('after the errors', [freeCount(agent), first.socket.destroyed], [0, true]);
      const next = await get({ port, agent });
      expectEqual('next', [next.body, next.socket !== first.socket], ['ok', true]);
      return 'the socket left the pool, the next request got a new one';
    } finally {
      agent.destroy();
      await stopServer(server);
    }
  });

  await step('http.Agent: socket options and timeouts on a reused socket', async () => {
    const { server, port } = await startServer((req, res) =>
      setTimeout(() => res.end('ok'), req.url === '/slow' ? 300 : 0),
    );
    const agent: any = new http.Agent({ keepAlive: true });
    try {
      const first = await get({ port, agent });
      const socket = first.socket;
      const calls: string[] = [];
      const setNoDelay = socket.setNoDelay.bind(socket);
      socket.setNoDelay = (value: boolean) => {
        calls.push(`setNoDelay(${value})`);
        return setNoDelay(value);
      };

      // set before the request has its socket
      let timeouts = 0;
      const second = await get({ port, agent, timeout: 100 }, req => {
        req.setNoDelay(true);
        req.on('timeout', () => timeouts++);
      });
      expectEqual('second', [second.socket === socket, calls], [true, ['setNoDelay(true)']]);

      // longer than the finished request's timeout
      const third = await get({ port, agent, path: '/slow' });
      expectEqual('third', [third.body, third.socket === socket], ['ok', true]);
      expectEqual("the finished request's timeout", timeouts, 0);
      return 'options applied, an old timeout did not fire';
    } finally {
      agent.destroy();
      await stopServer(server);
    }
  });

  await step('http.Agent: an unread response does not stall the pooled socket', async log => {
    // bigger than a response's buffer, small enough to arrive all at once
    const big = Buffer.alloc(20000, 'a');
    const { server, port } = await startServer((req, res) =>
      res.end(req.url === '/big' ? big : 'small'),
    );
    const agent: any = new http.Agent({ keepAlive: true });
    try {
      const unread: any = await new Promise(resolve => {
        const req = http.get({ host: HOST, port, path: '/big', agent }, resolve);
        req.on('error', () => {});
      });
      await delay(200);
      const next = await get({ port, agent, path: '/small' });
      log(`next on the same socket: ${next.socket === unread.socket}`);
      expectEqual('next', next.body, 'small');
      let read = 0;
      unread.on('data', (chunk: Buffer) => (read += chunk.length));
      await waitFor(unread, 'end');
      expectEqual('unread response, read afterwards', read, big.length);
      return 'next request answered, the old body still whole';
    } finally {
      agent.destroy();
      await stopServer(server);
    }
  });

  await step('http.Agent: timeout and keepAliveMsecs', async () => {
    const { server, port } = await startServer((req, res) =>
      setTimeout(() => res.end('ok'), req.url === '/slow' ? 400 : 0),
    );
    const agent: any = new http.Agent({ keepAlive: true, keepAliveMsecs: 1234, timeout: 200 });
    try {
      // a request without a timeout of its own gets the agent's
      let timedOut = false;
      await get({ port, agent, path: '/slow' }, req =>
        req.on('timeout', () => {
          timedOut = true;
          req.destroy();
        }),
      );
      expectEqual("the agent's timeout", timedOut, true);

      const calls: string[] = [];
      const pooled = await get({ port, agent }, req =>
        req.on('socket', (socket: any) => {
          const setKeepAlive = socket.setKeepAlive.bind(socket);
          socket.setKeepAlive = (enable: boolean, delayMs: number) => {
            calls.push(`${enable},${delayMs}`);
            return setKeepAlive(enable, delayMs);
          };
        }),
      );
      expectEqual('setKeepAlive when pooled', calls, ['true,1234']);
      expectEqual('pooled', freeCount(agent), 1);
      await delay(400);
      expectEqual('free socket after the timeout', [freeCount(agent), pooled.socket.destroyed], [0, true]);
      return "'timeout' from the agent, TCP keep-alive, idle sockets closed";
    } finally {
      agent.destroy();
      await stopServer(server);
    }
  });

  await step('http.Agent: destroy() closes the sockets and stops the idle timers', async () => {
    const { server, port } = await startServer((_req, res) => res.end('ok'));
    const agent: any = new http.Agent({ keepAlive: true, timeout: 10000 });
    try {
      const { socket } = await get({ port, agent });
      expectEqual('idle timer while pooled', Boolean(socket._agentIdleTimer), true);
      agent.destroy();
      expectEqual('after destroy()', [Boolean(socket._agentIdleTimer), socket.destroyed], [false, true]);
      return 'socket destroyed, timer stopped';
    } finally {
      await stopServer(server);
    }
  });

  await step('http.Agent / https.Agent: names and protocols, as Node', async () => {
    const httpAgent: any = new http.Agent();
    const httpsAgent: any = new https.Agent();
    // what Node 22's getName() returns
    const names: Array<[any, string, string]> = [
      [{}, 'localhost::', 'localhost::::::::::::::::::::::'],
      [{ host: 'a.com', port: 80 }, 'a.com:80:', 'a.com:80:::::::::::::::::::::'],
      [{ host: 'a.com', port: 8080, localAddress: '10.0.0.1' }, 'a.com:8080:10.0.0.1', 'a.com:8080:10.0.0.1::::::::::::::::::::'],
      [{ host: 'a.com', port: 1, family: 4 }, 'a.com:1::4', 'a.com:1::4::::::::::::::::::::'],
      [{ host: 'a.com', port: 1, family: 0 }, 'a.com:1:', 'a.com:1:::::::::::::::::::::'],
      [{ host: 'a.com', port: 443, servername: 'b.com' }, 'a.com:443:', 'a.com:443:::::::::b.com::::::::::::'],
      [{ host: 'a.com', port: 443, servername: 'a.com', rejectUnauthorized: false }, 'a.com:443:', 'a.com:443::::::::false:::::::::::::'],
    ];
    for (const [options, httpName, httpsName] of names) {
      expectEqual(`http getName(${JSON.stringify(options)})`, httpAgent.getName(options), httpName);
      expectEqual(`https getName(${JSON.stringify(options)})`, httpsAgent.getName(options), httpsName);
    }

    expectEqual(
      'http.Agent',
      [httpAgent.protocol, httpAgent.defaultPort],
      ['http:', 80],
    );
    expectEqual(
      'https.Agent',
      [httpsAgent instanceof http.Agent, httpsAgent.protocol, httpsAgent.defaultPort, httpsAgent.maxCachedSessions],
      [true, 'https:', 443, 100],
    );

    // the agent decides the protocol
    expectThrow('https.request with an http.Agent', 'TypeError', () =>
      https.request({ host: HOST, agent: httpAgent }),
    );
    expectThrow('http.request with an https.Agent', 'TypeError', () =>
      http.request({ host: HOST, agent: httpsAgent }),
    );
    const own: any = https.request({ host: HOST, port: 1, agent: false });
    own.on('error', () => {});
    own.destroy();
    expectEqual('https agent: false', own.agent instanceof https.Agent && own.agent !== https.globalAgent, true);
    return `${names.length * 2} names, protocols checked`;
  });
}
