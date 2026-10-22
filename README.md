<div align="center">

# react-native-nitro-node

**Node.js core modules for React Native, on a real libuv event loop: packages written for Node run unchanged, and keep running in the background.**

**Network** `net` · `tls` · `dns` · `http` · `https`<br>
**Files and system** `fs` · `os` · `path` · `process`<br>
**Data** `crypto` · `zlib` · `buffer` · `stream` · `events` · `util` · `querystring` · `punycode`<br>
**Scheduling** `timers` · `timers/promises`<br>
**Stubs, so packages that import them load** `http2` · `diagnostics_channel`

[![npm](https://img.shields.io/npm/v/react-native-nitro-node?color=cb3837&logo=npm)](https://www.npmjs.com/package/react-native-nitro-node)
[![license](https://img.shields.io/npm/l/react-native-nitro-node?color=blue)](./LICENSE)
![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-lightgrey)
![powered by Nitro](https://img.shields.io/badge/powered%20by-Nitro%20Modules-orange)

</div>

---

Use Node.js APIs in React Native: open raw TCP and TLS sockets, run an HTTP server on the device, make HTTP requests with connection pooling, resolve DNS names, read and write files, hash, encrypt and sign, and compress with gzip, Brotli or zstd. They are Node's APIs, with Node's options, events and error codes, so npm packages written for Node work as they are: the [Metro plugin](#metro) points their `require('net')`, `require('node:zlib')`, … at this library.

```ts
import net from 'react-native-nitro-node/net';

const server = net.createServer((socket) => {
  socket.write('hello from your phone 👋\n');
  socket.pipe(socket); // echo
});

server.listen(8080, '0.0.0.0', () => {
  console.log('listening on', server.address());
});
```

Underneath is **[libuv](https://libuv.org)**, the C library behind Node.js's own event loop, with **[c-ares](https://c-ares.org)** for DNS, **[OpenSSL 3](https://www.openssl.org)** for TLS and crypto, and zlib, **[Brotli](https://github.com/google/brotli)** and **[zstd](https://github.com/facebook/zstd)** for compression, as in Node. The library compiles them into your app and exposes them to JavaScript through **[Nitro Modules](https://nitro.margelo.com)**, with direct JSI bindings and no bridge.

## ✨ Features

- 🧩 **Drop-in for Node packages:** a [Metro plugin](#metro) (`withNitroNode`) redirects `fs`, `node:net`, `zlib`, … in your dependencies to this library, and a [polyfill](#globals) sets `global.Buffer` and `global.crypto` for packages that use them without importing.
- 🌙 **Keeps running in the background:** everything runs on a libuv loop on its own thread, including the timers. React Native pauses its own timers in the background; these, `process.nextTick`, and the sockets, requests and callbacks built on them go on for as long as the system lets the app run.
- 🔌 **Real TCP sockets and servers:** `net.Socket` and `net.Server` are libuv `uv_tcp_t` handles, not a WebSocket or a platform HTTP stack. A server on the device accepts connections from the network.
- 🌐 **HTTP client and server:** `http` with streaming bodies, chunked encoding, keep-alive, upgrade/CONNECT and Node's server timeouts. `http.Agent` / `https.Agent` pool and reuse connections, with Node 19+'s keep-alive `globalAgent`.
- 🔒 **Native TLS client:** TLS 1.2 and 1.3 sockets and `https` requests on **OpenSSL 3**, verified against the system's trust store, with SNI and ALPN. Encryption runs on the native side; JavaScript only sees plaintext. *(See the [security notes](#-security-notes).)*
- 🧭 **Native DNS:** `dns.lookup` and `dns.resolve*` on **[c-ares](https://c-ares.org)**, which Node also uses.
- 🔑 **Crypto:** Node's `crypto` (hashes, HMAC, ciphers, key pairs, sign/verify, KDFs, random, X.509) and WebCrypto's `subtle`, on **OpenSSL 3**, ported from [react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto).
- 🗜️ **Compression:** Node's `zlib`, ported from Node: gzip and deflate on the system's zlib, **Brotli** and **zstd** on the versions Node bundles, with Node's exact output.
- 📁 **File system:** `fs` with files, file descriptors, directories, `stat` and `statfs`, in callback and `*Sync` forms.
- ⏱️ **Timers:** `setTimeout`, `setInterval`, `setImmediate` and `timers/promises` (with `AbortSignal` and `for await` intervals), with Node's timing rules.
- 🧵 **Off the JS thread:** I/O, DNS, TLS, file system callbacks and async compression run off the JS thread. Results come back to JavaScript as events and callbacks.
- 🧰 **Node-compatible behavior:** Node's argument checks, `ERR_*` codes and messages, and errors with `code`, `errno` and `syscall` (`ECONNREFUSED`, `ENOTFOUND`, …), mapped from libuv, c-ares, zlib, Brotli and zstd. Where it differs from Node, the [compatibility tables](#-nodejs-api-compatibility) say so.
- 📦 **Node-style imports:** every module has both a default and named exports: `import net from '…/net'` and `import { connect } from '…/net'`.
- 🟦 **TypeScript first:** written in TypeScript, with typed event maps (`socket.on('data', (buf) => …)` knows `buf` is a `Buffer`).

## 📦 Installation

```sh
npm install react-native-nitro-node react-native-nitro-modules
# or
yarn add react-native-nitro-node react-native-nitro-modules
```

Then install the native code:

```sh
cd ios && pod install
```

Android needs no extra steps; autolinking picks the library up. OpenSSL comes prebuilt, so there is nothing else to install: on iOS, `pod install` downloads react-native-quick-crypto's static build, and on Android it's the [`openssl-static`](https://central.sonatype.com/artifact/io.github.ronickg/openssl-static) Maven package.

The XSalsa20 ciphers of `crypto` need [libsodium](https://libsodium.org), which is left out by default. To build it in, set `SODIUM_ENABLED=1` when you run `pod install`, and `sodiumEnabled=true` in your app's `android/gradle.properties`.

### Metro

Wrap your Metro config with `withNitroNode`:

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNitroNode } = require('react-native-nitro-node/metro');

const config = {};

module.exports = withNitroNode(mergeConfig(getDefaultConfig(__dirname), config));
```

It makes Node's module names resolve to this library in the packages you use: `fs`, `net`, `process` and the rest, also as `node:fs` and `fs/`. Packages written for Node then work as they are.

It matters most for `process`. Streams (and so sockets and HTTP bodies) defer their events with `process.nextTick` from the `process` npm package, which runs on React Native's timers, and React Native pauses those while the app is in the background. This library's `nextTick` runs on its own libuv timers, which keep going. Without the redirect everything works while the app is in the foreground, but stream events such as `'end'`, `'finish'` and `'close'` wait until the app comes back.

Your own code is left alone: there, import the library's modules by their own names, `react-native-nitro-node/fs` and so on. TypeScript can't follow the redirect: it types `import fs from 'fs'` as Node's `fs` (from `@types/node`, which comes with the stream types), so your code would compile against functions this library doesn't have yet. To redirect your code too, set `includeAppCode`:

```js
module.exports = withNitroNode(mergeConfig(getDefaultConfig(__dirname), config), {
  includeAppCode: true,
});
```

A package counts as a dependency when its files are in a `node_modules` folder. In a monorepo, packages that Metro reaches through a symlink (workspaces) have their real path, outside `node_modules`, so they count as your code.

To redirect only some modules, list them:

```js
module.exports = withNitroNode(mergeConfig(getDefaultConfig(__dirname), config), {
  modules: ['process', 'timers'],
});
```

The names are `buffer`, `crypto`, `diagnostics_channel`, `dns`, `events`, `fs`, `http`, `http2`, `https`, `net`, `os`, `path`, `process`, `punycode`, `querystring`, `stream`, `timers`, `timers/promises`, `tls`, `util` and `zlib`, also exported as `MODULES`. To redirect all but some, filter it: `MODULES.filter(name => name !== 'fs')`. Any `resolveRequest` you already have still handles everything else.

To see what gets redirected, set `debug`. Metro then logs every request for one of these names, with the file that makes it and where it goes, or why it is left alone:

```js
module.exports = withNitroNode(mergeConfig(getDefaultConfig(__dirname), config), {
  debug: true,
});
```

```
[withNitroNode] redirecting buffer, dns, events, fs, ... in dependencies
[withNitroNode] node_modules/readable-stream/lib/internal/streams/end-of-stream.js: 'process/' → node_modules/react-native-nitro-node/src/process/index.ts
[withNitroNode] App.tsx: 'process' left alone (app code, see `includeAppCode`) → node_modules/process/browser.js
```

Metro caches what it resolves, so start it with `--reset-cache` to see every request again.

`withNitroNode` takes whatever Metro takes as a config: an object, a promise of one, or a function returning either. Some plugins return a function (`withRozenite`, for one), so it can go before or after them:

```js
module.exports = withNitroNode(withRozenite(mergeConfig(getDefaultConfig(__dirname), config)));
```

### Globals

Some packages use `Buffer` or `crypto` from the global scope, without importing them; Node and browsers define them, React Native doesn't. The Metro plugin can't help there, since nothing is imported. Import the polyfill first in your app's entry file:

```js
// index.js
import 'react-native-nitro-node/polyfill';
import { AppRegistry } from 'react-native';
// ...
```

It sets `global.Buffer` to this library's `Buffer`, the same class `require('buffer')` gets through the Metro plugin, and `global.crypto` to its `crypto`, which has the Web Crypto API's `subtle`, `getRandomValues()` and `randomUUID()`. It has to come before the other imports: some packages read `Buffer` while their own module loads.

It also wraps the global `Proxy` (and `Proxy.revocable`), so that [`util.types.isProxy()`](#util) can tell the proxies made from then on: JavaScript can't tell a proxy from its target, and Hermes has no API for it. Proxies keep working as before; a WeakMap remembers each one's target and handler.

> [!NOTE]
> The library contains native code, so it does not work in Expo Go. Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/) instead.

### Requirements

| | Minimum |
|---|---|
| React Native | New Architecture |
| `react-native-nitro-modules` | 0.35 |
| iOS | 15.1 |
| Android | API 23 (Android 6.0) |

## 🚀 Usage

Each module has its own entry point, like Node's built-ins:

```ts
import fs from 'react-native-nitro-node/fs';
import net from 'react-native-nitro-node/net';
import tls from 'react-native-nitro-node/tls';
import dns from 'react-native-nitro-node/dns';
import http from 'react-native-nitro-node/http';
import https from 'react-native-nitro-node/https';
import crypto from 'react-native-nitro-node/crypto';
import { EventEmitter } from 'react-native-nitro-node/events';
import { Readable, pipeline } from 'react-native-nitro-node/stream';
import { setTimeout, setImmediate } from 'react-native-nitro-node/timers';
import querystring from 'react-native-nitro-node/querystring';
import os from 'react-native-nitro-node/os';
import path from 'react-native-nitro-node/path';
import process from 'react-native-nitro-node/process';
import { Buffer } from 'react-native-nitro-node/buffer';

// Named imports work too:
import { createServer, Socket } from 'react-native-nitro-node/net';
import { lookup } from 'react-native-nitro-node/dns';
import { readFileSync } from 'react-native-nitro-node/fs';
```

Types that several modules share live at the root:

```ts
import type { ErrnoException } from 'react-native-nitro-node';
```

### File system

```ts
import fs from 'react-native-nitro-node/fs';
import os from 'react-native-nitro-node/os';
import { Buffer } from 'react-native-nitro-node/buffer';

// tmpdir() for scratch files; for files that must persist, a folder inside
// os.homedir(), e.g. `${os.homedir()}/Documents` on iOS or `${os.homedir()}/files` on Android
const dir = os.tmpdir();

fs.mkdirSync(`${dir}/notes`, { recursive: true });
fs.writeFileSync(`${dir}/notes/today.txt`, 'Buy milk\n');
fs.appendFileSync(`${dir}/notes/today.txt`, 'Call mom\n');

fs.readFile(`${dir}/notes/today.txt`, 'utf8', (err, text) => {
  if (err) return console.error(err.code); // e.g. 'ENOENT'
  console.log(text);
});

console.log(fs.readdirSync(`${dir}/notes`)); // ['today.txt']

const stats = fs.statSync(`${dir}/notes/today.txt`);
console.log(stats.isFile(), stats.size, stats.mtime); // true 18 2026-…
fs.statSync(`${dir}/missing`, { throwIfNoEntry: false }); // undefined

// File descriptors, with explicit positions
const fd = fs.openSync(`${dir}/data.bin`, 'w+');
fs.writeSync(fd, Buffer.from([1, 2, 3, 4]));
const head = Buffer.alloc(2);
fs.readSync(fd, head, 0, 2, 0); // <Buffer 01 02>
fs.closeSync(fd);
```

### TCP client

```ts
import net from 'react-native-nitro-node/net';

const socket = net.connect({ host: 'example.com', port: 80 }, () => {
  socket.write('GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
});

socket.setEncoding('utf8');
socket.on('data', (chunk) => console.log(chunk));
socket.on('end', () => console.log('server closed the connection'));
socket.on('error', (err) => console.error(err.code, err.message)); // e.g. ECONNREFUSED
```

When a host has both IPv4 and IPv6 addresses, `connect` tries each address in turn, like Node's `autoSelectFamily`.

### HTTP server on the device

```ts
import http from 'react-native-nitro-node/http';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ method: req.method, url: req.url }));
});

server.listen(3000, '0.0.0.0');
```

### HTTP and HTTPS requests

```ts
import https from 'react-native-nitro-node/https';

https.get('https://example.com/', (res) => {
  console.log(res.statusCode, res.headers['content-type']);

  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => console.log(body.length, 'characters'));
});
```

```ts
import http from 'react-native-nitro-node/http';

const req = http.request(
  { host: 'httpbin.org', path: '/post', method: 'POST', headers: { 'Content-Type': 'application/json' } },
  (res) => res.pipe(myWritable),
);
req.end(JSON.stringify({ hello: 'world' }));
```

### TLS sockets

```ts
import tls from 'react-native-nitro-node/tls';

const socket = tls.connect(443, 'example.com', () => {
  // 'secureConnect': the handshake is done and the certificate was verified
  console.log('authorized:', socket.authorized, 'ALPN:', socket.alpnProtocol);
  socket.write('GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
});

socket.on('data', (data) => console.log(data.toString()));
socket.on('error', (err) => console.error(err.message)); // e.g. 'certificate verify failed'
```

`servername` (SNI, and the name the certificate must match) defaults to the host. Pass `ALPNProtocols` to negotiate a protocol, and only for testing, `rejectUnauthorized: false` to skip verification:

```ts
tls.connect({ host: '192.168.1.10', port: 8443, servername: 'my-server.local', ALPNProtocols: ['http/1.1'] });
```

### Events

`events` re-exports [`EventEmitter`](https://www.npmjs.com/package/events), the same class the sockets and servers are built on. As in Node, it is also the default export, and what packages get from `require('events')`:

```ts
import { EventEmitter } from 'react-native-nitro-node/events';

const bus = new EventEmitter();
bus.on('ping', (n: number) => console.log('ping', n));
bus.emit('ping', 1);
```

### Streams

`stream` re-exports [`readable-stream`](https://www.npmjs.com/package/readable-stream), Node's own streams packaged for other platforms. As in Node, the default export, and what packages get from `require('stream')`, is the legacy `Stream` class with the rest on it (`Stream.Readable`, `Stream.pipeline`, …). Sockets, HTTP bodies and requests are these streams, so they combine with your own:

```ts
import { Transform, promises } from 'react-native-nitro-node/stream';
import net from 'react-native-nitro-node/net';

// a shouting echo server
net.createServer(async (socket) => {
  const upperCase = new Transform({
    transform(chunk, _encoding, callback) {
      callback(null, chunk.toString().toUpperCase());
    },
  });
  await promises.pipeline(socket, upperCase, socket);
}).listen(7000);
```

### Query strings

`querystring` is ported from Node's own module, so it encodes exactly like Node:

```ts
import querystring from 'react-native-nitro-node/querystring';

querystring.stringify({ q: 'nitro node', tags: ['tcp', 'tls'], page: 2 });
// 'q=nitro%20node&tags=tcp&tags=tls&page=2'

querystring.escape('a&b=c'); // 'a%26b%3Dc'
```

### Timers

`timers` has Node's `setTimeout`, `setInterval` and `setImmediate`, with their `clear*` functions:

```ts
import { setInterval, clearInterval, setImmediate } from 'react-native-nitro-node/timers';

const poll = setInterval(() => console.log('still running'), 60_000);
// ...
clearInterval(poll);

setImmediate(() => console.log('after the I/O that is already in'));
```

They run on the library's libuv loop, not on React Native's timers, which React Native pauses while the app is in the background. This library's timers keep going for as long as the operating system lets the app run. iOS suspends an app soon after it goes to the background unless it has a background mode or task, and Android may freeze apps in the background; nothing runs in JavaScript then.

The global `setTimeout` and friends stay React Native's: import these where you need them. With [`withNitroNode`](#metro), packages that `require('timers')` get them too.

`setImmediate` runs its callback after the I/O events that are already in, like Node, and not as a microtask, like React Native's own.

`timers/promises` (also `timers.promises`) has the promise versions, on the same loop:

```ts
import { setTimeout, setInterval, scheduler } from 'react-native-nitro-node/timers/promises';

await setTimeout(1000);

const controller = new AbortController(); // controller.abort() rejects with an AbortError
const value = await setTimeout(100, 'value', { signal: controller.signal });

for await (const _ of setInterval(60_000)) {
  console.log('still running');
}

await scheduler.yield(); // let the I/O that is already in run first
```

### Process

`process.nextTick` defers a callback to after the current code, like Node's:

```ts
import process from 'react-native-nitro-node/process';

process.nextTick((name) => console.log(`hello ${name}`), 'nitro');
```

It runs on the library's `setImmediate`, so it keeps working in the background too; `net`, `http`, `dns` and, with [`withNitroNode`](#metro), streams use it. Like Node's, it comes before timers and before immediates set after it. Unlike Node's, it comes after promise callbacks, after I/O events that are already waiting, and after immediates set before it. The rest of `process` is the [`process`](https://www.npmjs.com/package/process) package's browser stand-in, see [the table](#process-1).

### DNS

```ts
import dns from 'react-native-nitro-node/dns';

dns.lookup('example.com', { all: true }, (err, addresses) => {
  // [{ address: '93.184.215.14', family: 4 }, { address: '2606:2800:…', family: 6 }]
});

dns.resolve4('example.com', (err, addresses) => {
  // ['93.184.215.14']
});

// Not part of Node: give queries a deadline, in milliseconds.
dns.setDefaultTimeout(5000);
```

### Crypto

```ts
import crypto, { createHash, randomBytes, subtle } from 'react-native-nitro-node/crypto';

createHash('sha256').update('abc').digest('hex');

const key = randomBytes(32);
const iv = randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
const encrypted = Buffer.concat([cipher.update('secret', 'utf8'), cipher.final()]);

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const signature = crypto.sign(null, Buffer.from('data'), privateKey);

const digest = await subtle.digest('SHA-256', Buffer.from('abc'));
```

For packages that look for `crypto` (or `Buffer`) in the global scope, see [Globals](#globals).

### Errors

Errors look like Node's, so you can reuse the same error-handling code:

```ts
socket.on('error', (err) => {
  if (err.code === 'ECONNREFUSED') retryLater();
});

dns.lookup('nope.invalid', (err) => {
  err?.code; // 'ENOTFOUND'
  err?.syscall; // 'getaddrinfo'
});
```

## 🧩 Node.js API compatibility

✅ supported · 🟡 partial · ❌ not yet

### `fs`

| API | Status | Notes |
|---|:---:|---|
| `readFile` / `writeFile` / `appendFile` (+ `Sync`) | ✅ | `encoding`, `flag`, `mode`; strings or any `ArrayBufferView`. Like Node, `readFile` refuses files over 2 GiB (`ERR_FS_FILE_TOO_LARGE`) |
| `open` / `close` / `read` / `write` / `ftruncate` (+ `Sync`) | ✅ | Every Node string flag (`'r'`, `'w+'`, `'ax'`, …); `position: null` uses the file offset. 64-bit positions on every platform and ABI, so files past 2 GiB work |
| `mkdir` / `readdir` / `rmdir` / `rm` / `unlink` (+ `Sync`) | ✅ | `mkdir({ recursive })`, `rm({ recursive, force })` |
| `access` / `exists` / `existsSync` | ✅ | |
| `stat` / `lstat` / `fstat` (+ `Sync`) | ✅ | `Stats` with every field, the `*Ms` times with their nanoseconds and as `Date`s, and `isFile()`, `isDirectory()`, `isSymbolicLink()`, …; `throwIfNoEntry`. `birthtime` is the creation time on iOS; Android doesn't record one, so it's `ctime`, as in Node without `statx` |
| `stat({ bigint: true })` / `BigIntStats` | ❌ | Planned; throws a `TypeError` for now |
| `statfs` (+ `Sync`) | ✅ | |
| `constants` | ✅ | The platform's real values; constants a platform lacks are left out |
| `readdir({ withFileTypes })` / `Dirent` | ❌ | Planned |
| `fs.promises` | ❌ | Planned |
| `createReadStream` / `createWriteStream` | ❌ | Planned |
| `rename`, `copyFile`, `symlink`, `chmod`, `watch`, … | ❌ | Planned |

### `net`

| API | Status | Notes |
|---|:---:|---|
| `net.connect()` / `net.createConnection()` | ✅ | `port`, `host`, `family`, `lookup`, `noDelay`, `keepAlive`, `timeout`, `autoSelectFamilyAttemptTimeout` |
| `net.createServer()` | ✅ | `allowHalfOpen`, `pauseOnConnect`, `noDelay`, `keepAlive` |
| `net.Socket` | ✅ | A full `stream.Duplex`: `write`, `end`, `pipe`, `pause`/`resume`, `setEncoding`, `setTimeout`, `setNoDelay`, `setKeepAlive`, `address`, `destroy`, `readyState`, `ref`/`unref`, … |
| `net.Server` | ✅ | `listen`, `close`, `address`, `getConnections` |
| `net.isIP()` / `isIPv4()` / `isIPv6()` | ✅ | |
| Events | ✅ | `connect`, `ready`, `lookup`, `data`, `drain`, `end`, `timeout`, `error`, `close`, `connection`, `listening` |
| IPC / Unix domain sockets | ❌ | |
| `net.BlockList`, `net.SocketAddress` | ❌ | |

### `tls`

| API | Status | Notes |
|---|:---:|---|
| `tls.connect()` | ✅ | TLS 1.2 and 1.3 on OpenSSL. `host`, `port`, `servername`, `rejectUnauthorized` (default `true`), `ALPNProtocols`, plus `net.connect()`'s `family`, `lookup`, `timeout`, … |
| `tls.TLSSocket` | 🟡 | Client side, created by `tls.connect()`. `encrypted`, `authorized`, `alpnProtocol`, `servername`; emits `connect`, then `secureConnect` |
| Certificate verification | ✅ | Against the system's trust store, including the host name. See the [security notes](#-security-notes) |
| `getPeerCertificate()`, `getProtocol()`, `getCipher()`, `authorizationError` | ❌ | Planned |
| `ca`, `cert`, `key`, `tls.createSecureContext()` | ❌ | Planned: custom CAs and client certificates |
| `new TLSSocket(socket)` / `tls.connect({ socket })` | ❌ | TLS over an existing socket (STARTTLS, proxies) is planned |
| `tls.createServer()` | ❌ | Planned |

### `http`

| API | Status | Notes |
|---|:---:|---|
| `http.createServer()` | ✅ | `keepAliveTimeout`, `requestTimeout`, `headersTimeout`, `maxHeaderSize` |
| `http.request()` / `http.get()` | ✅ | URL strings, `URL` objects or options; `auth`, `timeout`, `lookup`, `family` |
| `IncomingMessage` / `ServerResponse` / `ClientRequest` | ✅ | Streaming bodies, chunked transfer encoding, header helpers |
| Server events | ✅ | `request`, `connection`, `upgrade`, `connect`, `checkContinue`, `clientError`, … As in Node, a connection's errors go to `clientError` (without a listener the connection is closed), and a request whose client leaves emits `aborted` and `close` |
| `http.STATUS_CODES`, `http.METHODS` | ✅ | |
| `http.Agent` / `http.globalAgent` | ✅ | Connection pooling and keep-alive reuse: `keepAlive`, `keepAliveMsecs`, `maxSockets`, `maxTotalSockets`, `maxFreeSockets`, `scheduling`, `timeout`. `globalAgent` keeps connections for reuse, up to 5 s unused, as in Node 19+; `agent: false` for a connection of its own |

### `https`

| API | Status | Notes |
|---|:---:|---|
| `https.request()` / `https.get()` | ✅ | Same as `http`, over `tls`, with `servername` and `rejectUnauthorized` |
| `https.Agent` / `https.globalAgent` | ✅ | As `http.Agent`, over `tls`. `maxCachedSessions` is accepted, but TLS sessions are not cached yet |
| `https.createServer()` | ❌ | Waits on `tls.createServer()` |

### `dns`

| API | Status | Notes |
|---|:---:|---|
| `dns.lookup()` | ✅ | `family`, `all`, plus a `timeout` option |
| `dns.resolve()` / `resolve4()` / `resolve6()` | ✅ | A and AAAA records, via c-ares |
| Error code constants (`dns.NOTFOUND`, …) | ✅ | |
| `dns.promises` | ❌ | Planned |
| `resolveMx`, `resolveTxt`, `resolveSrv`, `reverse`, … | ❌ | Planned |

### `timers`

| API | Status | Notes |
|---|:---:|---|
| `setTimeout()` / `clearTimeout()` | ✅ | On the libuv loop. Delays below 1 ms or above 2³¹−1 ms become 1 ms, as in Node |
| `setInterval()` / `clearInterval()` | ✅ | The next tick is timed from the end of the callback, as in Node |
| `setImmediate()` / `clearImmediate()` | ✅ | After the loop's I/O phase, as in Node |
| `Timeout` | ✅ | `refresh()`, `close()`, `hasRef()`, `Symbol.toPrimitive` (so `clearTimeout(+timer)` works) and `Symbol.dispose` where the runtime has it |
| `Immediate` | ✅ | `hasRef()` and `Symbol.dispose` where the runtime has it |
| `ref()` / `unref()` | ✅ | Accepted, but no effect: an app has no process exit for a timer to hold up |
| `timers/promises` | ✅ | `setTimeout`, `setImmediate`, `setInterval` (an async iterator) and `scheduler.wait()` / `scheduler.yield()`, also as `timers.promises`. `signal` rejects with Node's `AbortError`; `ref` is accepted, with no effect |

### `http2`

Stubs only, so packages that import `http2` (often to use it only when it's there) load: the base classes and the commonly used functions. `http2.constants` and `getDefaultSettings()` are Node's; nothing else does anything yet.

| API | Status | Notes |
|---|:---:|---|
| `constants`, `sensitiveHeaders` | ✅ | Node 22's constants |
| `getDefaultSettings()` | ✅ | |
| `getPackedSettings()` / `getUnpackedSettings()` | ❌ | Not exported |
| `connect()` / `ClientHttp2Session` / `ClientHttp2Stream` | ❌ | Stubs: the session never connects, its streams never get a response, and no event is ever emitted |
| `createServer()` / `createSecureServer()` / `performServerHandshake()` | ❌ | Stubs: `listen()` does nothing and never calls back |
| `Http2ServerRequest` / `Http2ServerResponse` | ❌ | Stubs; the response keeps the headers you set, and sends nothing |

### `crypto`

The [react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto) implementation, so its [coverage](https://github.com/margelo/react-native-quick-crypto/blob/main/docs/data/coverage.ts) applies.

| API | Status | Notes |
|---|:---:|---|
| `createHash()` / `hash()` / `getHashes()` | ✅ | OpenSSL's digests, including SHA-3, SHAKE and BLAKE2; also `blake3`, `turboshake`, `kmac` |
| `createHmac()` | ✅ | |
| `createCipheriv()` / `createDecipheriv()` / `getCiphers()` | ✅ | AES (CBC, CTR, GCM, CCM, OCB, …), ChaCha20 and ChaCha20-Poly1305, XChaCha20-Poly1305. XSalsa20 and XSalsa20-Poly1305 only with libsodium, see [Installation](#-installation) |
| `publicEncrypt()` / `privateDecrypt()` / `privateEncrypt()` / `publicDecrypt()` | ✅ | |
| `generateKeyPair()` / `generateKeyPairSync()` / `generateKey()` | ✅ | RSA, RSA-PSS, DSA, EC, Ed25519/Ed448, X25519/X448, DH, ML-DSA, ML-KEM, SLH-DSA |
| `createPrivateKey()` / `createPublicKey()` / `createSecretKey()` / `KeyObject` | ✅ | PEM, DER and JWK |
| `sign()` / `verify()` / `createSign()` / `createVerify()` | ✅ | |
| `createDiffieHellman()` / `getDiffieHellman()` / `createECDH()` / `diffieHellman()` | ✅ | |
| `pbkdf2()` / `scrypt()` / `hkdf()` / `argon2()` (+ `Sync`) | ✅ | |
| `randomBytes()` / `randomFill()` / `randomInt()` / `randomUUID()` / `getRandomValues()` | ✅ | |
| `generatePrime()` / `checkPrime()` (+ `Sync`) | ✅ | |
| `X509Certificate` / `Certificate` (SPKAC) | ✅ | |
| `timingSafeEqual()` / `getCurves()` / `constants` | ✅ | |
| `subtle` (WebCrypto) | 🟡 | `digest`, `encrypt`/`decrypt`, `sign`/`verify`, `deriveBits`/`deriveKey`, `generateKey`, `importKey`/`exportKey` (some algorithms support only some formats), `wrapKey`/`unwrapKey` |
| `install()` | ✅ | Not in Node: sets `global.crypto` and `global.Buffer`, what `react-native-nitro-node/polyfill` does, see [Globals](#globals) |
| `setFips()` / `getFips()` / `setEngine()` / `secureHeapUsed()` | ❌ | |

Callbacks are called on the library's `process.nextTick`, so they also arrive while the app is in the background.

### `util`

Node 22's own code for the parts below, ported (`lib/internal/util/inspect.js`, `lib/internal/util/comparisons.js`, `promisify()`): the same output, options and errors as Node. The rest of `util` is the [`util`](https://www.npmjs.com/package/util) npm package, which packages got for `require('util')` before.

| API | Status | Notes |
|---|:---:|---|
| `util.inspect()` / `InspectOptions` | ✅ | Every option (`depth`, `colors`, `compact`, `breakLength`, `sorted`, `getters`, `showHidden`, `showProxy`, `maxArrayLength`, `maxStringLength`, `numericSeparator`), `inspect.custom`, `inspect.defaultOptions`. Promises show their state from React Native's `Promise` (the `promise` package), as Node; a promise of another implementation shows `Promise { <unknown> }`. Hermes can't show the entries of a Map or Set iterator, or WeakMap/WeakSet entries with `showHidden` (`<items unknown>`). Classes and async functions that Babel compiled show as plain functions |
| `util.format()` / `util.formatWithOptions()` | ✅ | Node's, on `inspect()` |
| `util.isDeepStrictEqual()` | ✅ | Node's comparison: prototypes, cycles, Maps, Sets, typed arrays, boxed primitives, errors, … |
| `util.promisify()` / `promisify.custom` | ✅ | |
| `util.types.isProxy()` | ✅ | For proxies made after [`react-native-nitro-node/polyfill`](#globals) ran; without it, always `false` |
| Other `util.types.*`, `inherits`, `deprecate`, `debuglog`, `callbackify`, `is*()` | ✅ | The npm `util` package's |
| `TextEncoder` / `TextDecoder`, `parseArgs`, `styleText`, `MIMEType`, … | ❌ | |

### `events`, `stream`, `querystring`, `punycode`, `buffer`, `os`, `path`

| API | Status | Notes |
|---|:---:|---|
| `events.EventEmitter` | ✅ | Re-exports the [`events`](https://www.npmjs.com/package/events) package |
| `querystring.stringify()` / `encode()` / `escape()` | ✅ | Ported from Node: the same output, the same `ParsedUrlQueryInput` and `StringifyOptions` types |
| `querystring.parse()` / `decode()` / `unescape()` | ❌ | Planned |
| `punycode` | ✅ | `encode`, `decode`, `toASCII`, `toUnicode`, `ucs2` and `version`, from the [`punycode`](https://www.npmjs.com/package/punycode) package, the code Node's own (deprecated) `punycode` is |
| `stream` | ✅ | `Readable`, `Writable`, `Duplex`, `Transform`, `PassThrough`, `Stream`, `pipeline`, `finished` and `promises`, from the [`readable-stream`](https://www.npmjs.com/package/readable-stream) package |
| `buffer.Buffer` | ✅ | Re-exports the [`buffer`](https://www.npmjs.com/package/buffer) package |
| `os.tmpdir()` / `os.homedir()` | ✅ | The app's own folders: the tmp directory and sandbox on iOS, the cache and data directories on Android |
| `os.EOL` | ✅ | |
| `os.networkInterfaces()` | ✅ | As Node's, from libuv: addresses by interface, with `cidr` and `scopeid`. The system hides MAC addresses from apps: on iOS most are `02:00:00:00:00:00`, on Android 11+ `00:00:00:00:00:00` |
| Rest of `os` (`platform`, `cpus`, …) | ❌ | |
| `path` | ✅ | The full POSIX implementation: `join`, `resolve`, `normalize`, `relative`, `dirname`, `basename`, `extname`, `isAbsolute`, `sep`, `delimiter`, `posix` |

### `process`

| API | Status | Notes |
|---|:---:|---|
| `process.nextTick()` | ✅ | On the library's `setImmediate`: before timers, but after promise callbacks, pending I/O and earlier immediates, unlike Node's |
| `env`, `argv`, `version`, `versions` | ✅ | Empty: `{}`, `[]`, `''` and `{}` |
| `title`, `browser` | ✅ | `'browser'` and `true`, as in the `process` package |
| `cwd()` / `umask()` | ✅ | Always `'/'` and `0` |
| `on()`, `once()`, `emit()` and the other listener methods | ✅ | Do nothing; `listeners()` returns `[]` |
| `chdir()` / `binding()` | ❌ | Throw |
| `exit()`, `pid`, `platform`, `memoryUsage()`, `hrtime()`, … | ❌ | |

### `zlib`

Node 22's `lib/zlib.js`, ported: the same streams, options, flush handling, errors and messages. gzip and deflate run on the system's zlib (iOS's and Android's); Brotli 1.1.0 and zstd 1.5.7, the versions Node 22 bundles, are built in. The callback functions and streams compress and decompress on a worker thread; the `*Sync` ones on the calling thread, as in Node.

| API | Status | Notes |
|---|:---:|---|
| `createGzip()` / `createGunzip()` / `createDeflate()` / `createInflate()` / `createDeflateRaw()` / `createInflateRaw()` / `createUnzip()` | ✅ | Transform streams with Node's options: `level`, `windowBits`, `memLevel`, `strategy`, `dictionary`, `chunkSize`, `flush`, `finishFlush`, `info`, `maxOutputLength`, `rejectGarbageAfterEnd`. `flush()`, `params()`, `reset()`, `close()`, `bytesWritten` |
| `gzip()` / `gunzip()` / `deflate()` / `inflate()` / `deflateRaw()` / `inflateRaw()` / `unzip()` (+ `Sync`) | ✅ | Strings, Buffers, TypedArrays, DataViews and ArrayBuffers. Multi-member gzip, and `unzip` detects gzip or deflate |
| `Gzip`, `Deflate`, … classes | ✅ | With or without `new`, as in Node |
| `crc32()` | ✅ | |
| `constants` / `codes` | ✅ | Node 22's; `ZLIB_VERNUM` is the system zlib's |
| Brotli: `createBrotliCompress()` / `createBrotliDecompress()`, `brotliCompress()` / `brotliDecompress()` (+ `Sync`) | ✅ | Node's `params` (`BROTLI_PARAM_*`, `BROTLI_DECODER_PARAM_*`), errors and codes. The same compressed bytes as Node |
| zstd: `createZstdCompress()` / `createZstdDecompress()`, `zstdCompress()` / `zstdDecompress()` (+ `Sync`) | ✅ | Node's `params` (`ZSTD_c_*`, `ZSTD_d_*`, including `nbWorkers`), `pledgedSrcSize` and `dictionary`. The same compressed bytes as Node. Node still marks zstd experimental |
| Compressed bytes, gzip and deflate | 🟡 | Valid and readable by any zlib, but they can differ from Node's for the same input: Node bundles its own zlib, this library uses the system's |

## 🏗️ How it works

```mermaid
flowchart TB
    subgraph JS["JavaScript (Hermes)"]
        API["net · tls · http · https · dns · fs · timers · zlib<br/><sub>Node-compatible TypeScript API</sub>"]
    end

    subgraph Native["Native (C++)"]
        Nitro["Nitro HybridObjects<br/><sub>JSI, no bridge</sub>"]
        Loop["libuv event loop<br/><sub>dedicated thread</sub>"]
        TLS["TLS socket<br/><sub>OpenSSL 3, via tlsuv</sub>"]
        Ares["c-ares<br/><sub>async DNS</sub>"]
    end

    OS[("iOS / Android<br/>BSD sockets · trust store")]

    API --> Nitro
    Nitro -- "post work" --> Loop
    Loop -- "callbacks → events" --> Nitro
    Nitro --> TLS
    TLS -- "ciphertext" --> Loop
    Nitro --> Ares
    Loop --> OS
    TLS --> OS
    Ares --> OS
```

- **One libuv loop, one thread.** A single `uv_loop_t` runs on its own thread for the whole life of the process. JavaScript calls post work to that thread, and libuv callbacks reach JavaScript as events. The JS thread never blocks on I/O.
- **Nitro Modules** generate the C++ ↔ JS bindings, so every call goes straight through JSI with no serialization over a bridge.
- **c-ares** performs DNS resolution asynchronously. On Android it's initialized with the system's DNS servers from `ConnectivityManager`.
- **Timers** are `uv_timer_t` handles on the loop thread, and immediates a `uv_check_t` that runs after each I/O phase, as in Node. JavaScript keeps the timers' callbacks and asks the loop to wake it.
- **fs** calls go straight to POSIX. Every call has two native versions: the `*Sync` forms run on the JS thread, and the callback forms run on Nitro's thread pool, so they never block JavaScript.
- **TLS** is native: a TLS socket wraps the TCP socket on the loop thread, the way Node's `TLSWrap` wraps a `TCPWrap`. Encrypted bytes never leave C++: [OpenSSL](https://www.openssl.org) 3.6, driven through [tlsuv](https://github.com/openziti/tlsuv)'s engine, decrypts them, and JavaScript gets plaintext through the same callbacks as a plain socket. That's why `TLSSocket` is a `net.Socket` in JavaScript.
- **crypto** is [react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto)'s implementation: C++ HybridObjects over OpenSSL (the same OpenSSL 3.6 as TLS) and Node's [ncrypto](https://github.com/nodejs/ncrypto), with [simdutf](https://github.com/simdutf/simdutf) for base64 and hex. Most calls run on the JS thread; the slow ones, such as key generation and key derivation, also have asynchronous forms that run on Nitro's thread pool.
- **Certificates** are checked against the operating system's trust store. On iOS that's Apple's own verification (`SecTrust`, with the TLS server policy and the host name); on Android, OpenSSL checks the chain against the system's CA certificates in `/etc/security/cacerts` and checks the host name itself.

## 🔐 Security notes

`tls.connect()` and `https.request()` verify the server's certificate by default: the chain must lead to a root the system trusts, the certificate must be valid now, and it must be issued for the host name (`servername`). A connection that fails these checks fails with an error before any data is sent.

Know the limits:

> [!WARNING]
> - **`rejectUnauthorized: false` turns all of that off.** The connection is still encrypted, but to anyone who answers. Use it for local testing only.
> - **Connecting to an IP address checks no name.** Without a host name there is no SNI and nothing to match, so only the chain is verified. Pass a `servername` when the server's certificate has one.

> [!NOTE]
> - **Android: only the system's CA certificates count.** User-installed CAs, your app's [Network Security Config](https://developer.android.com/privacy-and-security/security-config) and its certificate pinning do not apply to this library's connections, and certificates are not checked for revocation.
> - **Errors are not as detailed as Node's.** A refused certificate fails with `certificate verify failed`, without Node's codes such as `CERT_HAS_EXPIRED` or `ERR_TLS_CERT_ALTNAME_INVALID`.
> - **OpenSSL is part of this package.** It's linked into your app statically, so OpenSSL security fixes reach you through updates of this library: keep it up to date. It stays separate from any other OpenSSL in your app: on iOS its symbols are renamed (`rnqc_*`), on Android they are kept out of the library's exported symbols. The exception is react-native-quick-crypto, which ships the same iOS build: with both installed, the app links one copy.

## 🗺️ Roadmap

### Next up
- [ ] `tls.createServer()` and `https.createServer()`
- [ ] Custom CAs and client certificates (`ca`, `cert`, `key`, `tls.createSecureContext()`)
- [ ] `getPeerCertificate()`, `authorizationError` and Node's certificate error codes
- [ ] Certificate checks for IP addresses
- [ ] TLS over an existing socket (`tls.connect({ socket })`), for STARTTLS and proxies
- [ ] `dns.promises` and `fs.promises`
- [ ] `querystring.parse()`
- [ ] `readdir({ withFileTypes })` with `Dirent`
- [ ] `fs.watch` and `fs.watchFile`
- [ ] `fs` streams: `createReadStream` and `createWriteStream`

### Later
- [ ] More DNS record types: `resolveMx`, `resolveTxt`, `resolveSrv`, `resolveCname`, `resolveNs`, `reverse`
- [ ] `http2`: client and server (only stubs for now)
- [ ] `dgram`: UDP sockets on libuv
- [ ] Unix domain sockets for `net`
- [ ] A `url` entry point, for a fuller drop-in `node:*` replacement
- [ ] The rest of `util` in Node's own code (`TextEncoder`/`TextDecoder`, `parseArgs`, `styleText`, …)

### Done
- [x] `net`: TCP client and server on libuv
- [x] `dns`: `lookup` and `resolve4`/`resolve6` on c-ares
- [x] `http`: client and server
- [x] `http.Agent` / `https.Agent`: connection pooling and keep-alive reuse
- [x] `tls` / `https`: native TLS 1.2 and 1.3 client on OpenSSL
- [x] Certificate verification against the system trust store, with `servername` (SNI), `rejectUnauthorized` and ALPN
- [x] `events`, `stream`, `querystring` and `punycode` entry points
- [x] `timers`: `setTimeout`, `setInterval` and `setImmediate` on libuv, running in the background, and `timers/promises`
- [x] A Metro resolver (`withNitroNode`) that maps `fs`, `net`, `node:net`, … to this library, with a `debug` log of what it redirects
- [x] Node-compatible error objects (`code`, `errno`, `syscall`)
- [x] `crypto`: Node's API and WebCrypto's `subtle`, ported from react-native-quick-crypto
- [x] `fs`: files, file descriptors, directories, `stat` / `lstat` / `fstat` and `statfs`
- [x] `zlib`: Node's zlib, ported, with Brotli and zstd
- [x] `util`: Node's `inspect()`, `format()`, `isDeepStrictEqual()`, `promisify()` and `types.isProxy()`
- [x] `buffer`, `os` (`tmpdir`, `homedir`, `networkInterfaces`), `path` and `process` (`nextTick`) helpers
- [x] Per-module subpath imports with default and named exports

Have a use case that's missing? [Open an issue](https://github.com/gmanole01/react-native-nitro-node/issues).

## 🧪 Example app

The [`example/`](./example) app runs the library's test suites (`net`, `dns`, `http`, `tls`, `fs`, `os`, `timers` and `process`, `crypto`, `zlib`, `util`, memory and GC) on a device or simulator. Some dependencies in `deps/` are git submodules, so clone with `--recursive`, or fetch them in an existing clone:

```sh
git submodule update --init
yarn
cd example
yarn ios      # or: yarn android
```

## 🤝 Contributing

Contributions are welcome. After changing the native specs in `src/native/specs/`, regenerate the bindings:

```sh
yarn nitrogen
```

Then rebuild the example app to try your change.

## 🙏 Acknowledgements

- [libuv](https://libuv.org): the event loop at the heart of Node.js, and of this library
- [c-ares](https://c-ares.org): asynchronous DNS resolution
- [OpenSSL](https://www.openssl.org): the TLS implementation, licensed under the Apache License 2.0
- [tlsuv](https://github.com/openziti/tlsuv) by NetFoundry: the TLS engine layer over OpenSSL, licensed under the MIT License
- [react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto) by Margelo: the `crypto` implementation, licensed under the MIT License
- [ncrypto](https://github.com/nodejs/ncrypto) (Node.js's OpenSSL wrapper), [simdutf](https://github.com/simdutf/simdutf), [BLAKE3](https://github.com/BLAKE3-team/BLAKE3) and [fastpbkdf2](https://github.com/ctz/fastpbkdf2): used by `crypto`
- [Nitro Modules](https://nitro.margelo.com) by Margelo: the fastest way to build native modules for React Native
- [Node.js](https://nodejs.org): for the APIs this library follows

## 📄 License

[MIT](./LICENSE) © George Manole

The third-party code this library contains or builds with, and its licenses, are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
