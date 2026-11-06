import * as dgram from 'react-native-nitro-node/dgram';
import { Buffer } from 'buffer';
import { Platform } from 'react-native';
import { type Step, expectThrow, waitFor } from './testUtils';

type Socket = dgram.Socket;
type Message = { msg: Buffer; rinfo: dgram.RemoteInfo };

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

/** A socket bound on the loopback, once it is listening. */
async function bound(type: dgram.SocketType = 'udp4'): Promise<Socket> {
  const socket = dgram.createSocket(type);
  socket.bind(0, type === 'udp4' ? '127.0.0.1' : '::1');
  await waitFor(socket, 'listening');
  return socket;
}

function nextMessage(socket: Socket): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no message within 3 s')), 3000);
    socket.once('message', (msg, rinfo) => {
      clearTimeout(timer);
      resolve({ msg, rinfo });
    });
  });
}

/** Calls socket.send(...args) and resolves with what its callback gets. */
function send(socket: Socket, ...args: any[]): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    (socket.send as any)(...args, (err: Error | null, bytes?: number) => (err ? reject(err) : resolve(bytes)));
  });
}

function closeAll(...sockets: Socket[]): Promise<void[]> {
  return Promise.all(sockets.map(s => new Promise<void>(resolve => s.close(() => resolve()))));
}

/** The error `fn` throws, as [code, message]. */
function thrown(label: string, fn: () => unknown): [string, string] {
  try {
    fn();
  } catch (err: any) {
    return [err.code, err.message];
  }
  throw new Error(`${label}: did not throw`);
}

/** dgram: UDP sockets on the loopback. */
export async function runDgramTests(step: Step) {
  await step('dgram: send and receive, as Node', async () => {
    const a = await bound();
    const b = await bound();
    const addr = a.address();
    expectEqual('address()', [addr.address, addr.family, addr.port > 0], ['127.0.0.1', 'IPv4', true]);

    const received = nextMessage(b);
    const bytes = await send(a, 'hello', b.address().port, '127.0.0.1');
    const { msg, rinfo } = await received;
    expectEqual('bytes sent', bytes, 5);
    expectEqual('message', msg.toString(), 'hello');
    expectEqual('rinfo', rinfo, { address: '127.0.0.1', family: 'IPv4', port: addr.port, size: 5 });

    // a list of buffers is one datagram, and send(buf, offset, length, ...)
    const list = nextMessage(b);
    await send(a, [Buffer.from('ab'), new Uint8Array([99]), 'de'], b.address().port, '127.0.0.1');
    expectEqual('list', (await list).msg.toString(), 'abcde');
    const part = nextMessage(b);
    await send(a, Buffer.from('xxpartxx'), 2, 4, b.address().port, '127.0.0.1');
    expectEqual('offset and length', (await part).msg.toString(), 'part');
    const empty = nextMessage(b);
    await send(a, [], b.address().port, '127.0.0.1');
    expectEqual('empty datagram', (await empty).rinfo.size, 0);

    await closeAll(a, b);
    return `${bytes} bytes from ${rinfo.address}:${rinfo.port}`;
  });

  await step('dgram: send before bind, to a host name', async () => {
    const b = await bound();
    const a = dgram.createSocket('udp4');
    const received = nextMessage(b);
    // binds a on its own first, as Node; 'localhost' goes through dns.lookup
    await send(a, 'early', b.address().port, 'localhost');
    expectEqual('message', (await received).msg.toString(), 'early');
    expectEqual('bound', a.address().port > 0, true);
    await closeAll(a, b);
    return 'queued until bound';
  });

  await step('dgram: connect(), remoteAddress() and disconnect()', async () => {
    const a = await bound();
    const b = await bound();
    const port = b.address().port;
    a.connect(port, '127.0.0.1');
    await waitFor(a, 'connect');
    expectEqual('remoteAddress()', a.remoteAddress(), { address: '127.0.0.1', family: 'IPv4', port });

    const received = nextMessage(b);
    await send(a, 'connected');
    expectEqual('message', (await received).msg.toString(), 'connected');
    expectEqual('send with an address', thrown('send', () => a.send('x', 0, 1, port, '127.0.0.1')), [
      'ERR_SOCKET_DGRAM_IS_CONNECTED',
      'Already connected',
    ]);
    expectEqual('connect twice', thrown('connect', () => a.connect(port)), [
      'ERR_SOCKET_DGRAM_IS_CONNECTED',
      'Already connected',
    ]);

    a.disconnect();
    expectEqual('remoteAddress() after', thrown('remoteAddress', () => a.remoteAddress()), [
      'ERR_SOCKET_DGRAM_NOT_CONNECTED',
      'Not connected',
    ]);
    await closeAll(a, b);
    return `connected to ${port}`;
  });

  await step('dgram: udp6 on ::1', async () => {
    const a = await bound('udp6');
    const b = await bound('udp6');
    const received = nextMessage(b);
    await send(a, 'six', b.address().port, '::1');
    const { msg, rinfo } = await received;
    expectEqual('message', msg.toString(), 'six');
    expectEqual('rinfo', [rinfo.address, rinfo.family], ['::1', 'IPv6']);
    await closeAll(a, b);
    return `from [${rinfo.address}]:${rinfo.port}`;
  });

  await step('dgram: Node\'s errors', async () => {
    expectEqual('bad type', thrown('createSocket', () => dgram.createSocket('udp5' as any)), [
      'ERR_SOCKET_BAD_TYPE',
      'Bad socket type specified. Valid types are: udp4, udp6',
    ]);

    const a = await bound();
    expectEqual('bind twice', thrown('bind', () => a.bind(0)), ['ERR_SOCKET_ALREADY_BOUND', 'Socket is already bound']);
    expectEqual('bad port', thrown('send', () => a.send('x', 70000, '127.0.0.1')), [
      'ERR_SOCKET_BAD_PORT',
      'Port should be > 0 and < 65536. Received type number (70000).',
    ]);
    expectThrow('bad buffer', 'TypeError', () => a.send(42 as any, 1, '127.0.0.1'));
    expectEqual('bad buffer size', thrown('setRecvBufferSize', () => a.setRecvBufferSize(-1)), [
      'ERR_SOCKET_BAD_BUFFER_SIZE',
      'Buffer size must be a positive integer',
    ]);

    // the port is taken: an 'error' event, Node's message
    const b = dgram.createSocket('udp4');
    b.bind(a.address().port, '127.0.0.1');
    const err: any = await new Promise(resolve => b.once('error', resolve));
    expectEqual('EADDRINUSE', [err.code, err.syscall, err.message], [
      'EADDRINUSE',
      'bind',
      `bind EADDRINUSE 127.0.0.1:${a.address().port}`,
    ]);
    b.close();

    // the send callback gets a lookup failure
    const lookupErr: any = await send(a, 'x', 1234, 'no-such-host.invalid').then(
      () => null,
      e => e,
    );
    expectEqual('lookup failure', lookupErr?.code, 'ENOTFOUND');

    await closeAll(a);
    expectEqual('after close', thrown('address', () => a.address()), ['ERR_SOCKET_DGRAM_NOT_RUNNING', 'Not running']);
    return 'codes and messages as Node';
  });

  await step('dgram: socket options and buffer sizes', async () => {
    const a = await bound();
    a.setBroadcast(true);
    expectEqual('setTTL', a.setTTL(64), 64);
    expectEqual('setMulticastTTL', a.setMulticastTTL(4), 4);
    expectEqual('setMulticastLoopback', a.setMulticastLoopback(true), true);
    const ttlErr: any = thrown('setTTL', () => a.setTTL(0));
    expectEqual('setTTL(0)', ttlErr, ['EINVAL', 'setTTL EINVAL']);

    a.setRecvBufferSize(65536);
    a.setSendBufferSize(65536);
    const recv = a.getRecvBufferSize();
    const sendSize = a.getSendBufferSize();
    // Linux (Android) reports double what was asked for
    if (recv < 65536 || sendSize < 65536) {
      throw new Error(`buffer sizes ${recv} / ${sendSize}`);
    }
    expectEqual('send queue', [a.getSendQueueSize(), a.getSendQueueCount()], [0, 0]);
    await closeAll(a);
    return `recv ${recv}, send ${sendSize}`;
  });

  await step('dgram: close() and the createSocket() options', async () => {
    const a = dgram.createSocket({ type: 'udp4', reuseAddr: true, recvBufferSize: 32768 }, () => {});
    a.bind({ port: 0, address: '127.0.0.1' });
    await waitFor(a, 'listening');
    if (a.getRecvBufferSize() < 32768) {
      throw new Error(`recvBufferSize: ${a.getRecvBufferSize()}`);
    }
    const events: string[] = [];
    a.on('close', () => events.push('close'));
    a.close(() => events.push('callback'));
    await new Promise(resolve => setTimeout(resolve, 50));
    expectEqual('close events', events, ['close', 'callback']);

    // aborting the signal closes the socket
    const controller = new AbortController();
    const b = dgram.createSocket({ type: 'udp4', signal: controller.signal });
    const closed = waitFor(b, 'close');
    controller.abort();
    await closed;
    return 'closed';
  });

  await step('dgram: reusePort, as Node on Linux (Android) and macOS (iOS)', async () => {
    const a = dgram.createSocket({ type: 'udp4', reusePort: true });
    a.bind(0, '127.0.0.1');
    const err: any = await new Promise(resolve => {
      a.once('listening', () => resolve(null));
      a.once('error', resolve);
    });

    if (Platform.OS === 'ios') {
      // libuv has no SO_REUSEPORT for Apple systems
      expectEqual('error', [err?.code, err?.message], ['ENOTSUP', 'bind ENOTSUP 127.0.0.1']);
      a.close();
      return 'ENOTSUP, as Node on macOS';
    }

    if (err) {
      throw err;
    }
    // a second socket shares the port
    const port = a.address().port;
    const b = dgram.createSocket({ type: 'udp4', reusePort: true });
    b.bind(port, '127.0.0.1');
    await waitFor(b, 'listening');
    expectEqual('same port', b.address().port, port);
    // without reusePort, it's taken
    const c = dgram.createSocket('udp4');
    c.bind(port, '127.0.0.1');
    const taken: any = await new Promise(resolve => c.once('error', resolve));
    expectEqual('without reusePort', taken.code, 'EADDRINUSE');
    c.close();
    await closeAll(a, b);
    return `two sockets on port ${port}`;
  });
}
