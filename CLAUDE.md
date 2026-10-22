# react-native-nitro-node

Node.js core modules (`fs`, `net`, `tls`, `dns`, `http`, `https`, `crypto`,
`timers` (and `timers/promises`), `stream` (and `stream/promises`), `zlib`, `url`, `util` (in part), `process`, `buffer`, `events`, `stream`, `os`, `path`, `querystring`,
`punycode`, and `http2` as stubs) for React Native, built on **libuv** through **Nitro Modules** (nitrogen 0.35.x).
Goal: packages written for Node work unchanged in a React Native app, and keep
working while the app is in the background. Author: George Manole.

README.md is the user-facing documentation (usage, the compatibility tables,
How it works, Roadmap). Read it for what is implemented; keep it up to date
when adding or changing an API.

## Layout

- `src/native/specs/node.nitro.ts`: the Nitro specs (HybridObject interfaces
  and structs). After changing it run `npx nitrogen`, which regenerates
  `nitrogen/generated/` (never edit that by hand). New native files must also
  be added to `android/CMakeLists.txt` (sources and include dirs) and
  `NitroNode.podspec` (header paths), and new HybridObjects to `nitro.json`
  autolinking. Nitrogen adding files means `pod install` / a Gradle sync.
- `src/native/index.ts`: creates the HybridObjects and exports them to the TS
  modules.
- `src/<module>/<module>.ts` + `index.ts`: one folder per Node module, each a
  `package.json` export (`react-native-nitro-node/<module>`). A sub-module has a
  folder inside its module's: `src/timers/promises/` for `timers/promises`.
- `src/http2/`: stubs only, the base classes (sessions, streams, servers,
  `Http2ServerRequest`/`Response`) and the common functions (`connect`,
  `createServer`, `createSecureServer`, `getDefaultSettings`, `constants`).
  The user removed `getPackedSettings`/`getUnpackedSettings`; don't add them back.
- `src/polyfill/index.ts`: `react-native-nitro-node/polyfill`, a side-effect
  import (first in the app's entry file) that sets `global.Buffer` and
  `global.crypto` through crypto's `install()`, and wraps `Proxy` for
  util.types.isProxy(). The example imports it first
  in `example/index.js`.
- `src/utils.ts`, `src/errors.ts` (`fsError`, errno → Node error codes).
- `cpp/core/`: `UVLoop` (the single libuv loop on its own thread, `post` /
  `runSync`, FIFO, never destroyed) and `CallbackSlot` (a mutex-guarded JS
  callback set from JS and called from the loop thread).
- `cpp/<module>/Hybrid*.{hpp,cpp}`: the native side of each module.
- `src/crypto/` (with its own specs in `src/crypto/specs/`) and `cpp/crypto/`:
  `crypto`, ported from react-native-quick-crypto
  (`~/Desktop/react-native-quick-crypto/packages/react-native-quick-crypto`).
- OpenSSL 3.6.2 is react-native-quick-crypto's: on iOS the podspec downloads
  its `QuickCryptoOpenSSL.xcframework` (symbols renamed `rnqc_*`, prefix header
  force-included) into `ios/openssl/`; on Android the `openssl-static` prefab
  (`opensslstatic::ssl/crypto`), which tlsuv also links
  (`deps/tlsuv/src/openssl/CMakeLists.txt` is patched for it).
- `deps/`: libuv, c-ares, tlsuv (vendored); blake3, ncrypto, simdutf
  (git submodules) and fastpbkdf2 (quick-crypto's patched copy), for crypto;
  brotli and zstd (git submodules), for zlib; ada (vendored, its release
  single-header files), for url. `package.json`'s `files` leaves
  out their tests, tools and other languages.
- `metro.js`: the `withNitroNode` Metro plugin (see below).
- `example/`: the test app. `App.tsx` + `*Tests.ts` (`netTests`, `httpTests`, `agentTests`,
  `tlsTests`, `fsTests`, `osTests`, `timersTests`, `cryptoTests`, `zlibTests`, `utilTests`, `urlTests`, `gcTests`,
  `memoryTest`), runner in `testUtils.ts`.

## Rules (decided with the user, don't undo)

- **Deferred work uses our libuv timers** (`setImmediate` / `setTimeout` from
  `src/timers`), never `queueMicrotask`, React Native's timers or RN's global
  `setImmediate` (a queueMicrotask shim in the New Architecture). RN pauses
  those in the background; ours run on the libuv loop and don't. This applies
  to `process.nextTick` (implemented with our `setImmediate`), fs callbacks,
  `rethrowLater`, etc. Don't propose switching for speed or Node ordering.
- **`process`** (`src/process/process.ts`) is the npm `process` package code,
  ported by the user, on top of our timers. Keep it close to the original.
- **`crypto`** is react-native-quick-crypto's code, adapted only where our
  library needs it: HybridObjects named `NitroNodeCrypto<Name>` (the TS
  imports them under their old names, `NitroNodeCryptoHash as NativeHash`;
  the C++ classes keep theirs, `HybridHash`), C++ namespace
  `margelo::nitro::node`, the `buffer` package instead of
  `@craftzdog/react-native-buffer`, our `process.nextTick` and timers, no
  `react-native-quick-base64`, no Expo plugin. Don't fix its bugs or refactor
  it; keep it close to the original.
- **`zlib`** is Node 22's `lib/zlib.js` (`src/zlib/zlib.ts`), kept close to the
  original, on `src/zlib/binding.ts`, which gives it Node's internal binding API
  (`init`, `write`, `writeSync`, `params`, `reset`, `close`, `onerror`) over the
  `NitroNodeZlib` HybridObject (`cpp/zlib/`, a port of Node's
  `CompressionStream` and its contexts in `src/node_zlib.cc`: `HybridZlib` is
  the stream, `CompressionContexts` the engines). gzip/deflate use the system
  zlib (`-lz`); Brotli and zstd are git submodules in `deps/` at the versions
  Node 22 bundles (1.1.0, 1.5.7), built from their `.c` files only (Android:
  static archives with hidden symbols; iOS: `source_files`, headers kept out
  of the header map) with zstd's `ZSTD_MULTITHREAD`, as Node. iOS also needs
  `ZSTD_STATIC_LINKING_ONLY` in the pod's definitions: Clang modules import
  zstd.h through zstd's `module.modulemap`, ignoring its sources' own
  `#define`. Async writes
  copy the input and the output across, as JS buffers can't be touched off
  the JS thread. Brotli and zstd give Node's exact bytes, gzip/deflate can
  differ (another zlib), so zlib tests decompress rather than compare bytes.
- **`util`** is partly Node 22's own code: `src/util/inspect.ts`
  (`lib/internal/util/inspect.js`) and `src/util/comparisons.ts`
  (`lib/internal/util/comparisons.js`), kept verbatim and `// @ts-nocheck`,
  on `./primordials` (Node's primordials, built from their names) and
  `./internals` (what V8 gives Node, in JavaScript: brand checks, and markers
  where Hermes can't: iterator entries; a promise's state is read from React
  Native's `promise` polyfill fields `_x`/`_y`/`_z`/`_A`, which `inspect` and
  `isDeepStrictEqual` skip as keys). Plain globals are not
  taken from primordials there: Babel's module code uses `Object` before the
  destructuring would set it. `types.isProxy()` only knows the proxies made
  after the polyfill wrapped `Proxy` (`./proxies`). Everything else in `util`
  is the npm `util` package (Metro: `util` is a wrapped package).
- **`url`** is Node 22's `lib/url.js` (`src/url/url.ts`) and
  `lib/internal/url.js` (`src/url/internal.ts`), verbatim and `// @ts-nocheck`
  like util's, on `src/url/binding.ts` (Node's `internalBinding('url')` API)
  over the `NitroNodeUrl` HybridObject (`cpp/url/`, Node's `src/node_url.cc`
  on ada, vendored in `deps/ada` at Node 22's version). Class static blocks
  became static private fields (no Babel transform for them in React
  Native's preset). `createObjectURL()` is React Native's. `querystring` is
  Node's `lib/querystring.js` the same way.
- **`Symbol.dispose`** on `Timeout` / `Immediate` is set on the prototype, and
  only when `Symbol.dispose` exists. Not a class member, not `Symbol.for`.
- **Every fs native call is a pair**: `foo` (returns a `Promise`, runs on
  Nitro's thread pool via `Promise<T>::async`) and `fooSync` (calling thread).
  Node's callback/promise APIs use the async one, `*Sync` the sync one. Shared
  work lives in free functions in the anonymous namespace of `HybridFs.cpp`.
- **Native error convention**: numeric calls return the result or `-errno`;
  others throw `"[errno N]"`. TS turns these into Node errors with `check`,
  `toFsError`, `fsError`.
- **Callbacks must never be called twice**: don't write
  `.then(cb).catch(...)`. Use `.then(ok, err)` with the user callback wrapped
  in `rethrowLater` (fs uses `settleWith` / `settle` / `settleStatus`), so an
  exception thrown by the user's callback is rethrown on a later tick and
  reaches RN's `ErrorUtils` handler once.
- **Metro plugin** `withNitroNode(config, { modules?, includeAppCode? })`
  redirects Node module names (`fs`, `fs/`, `node:fs`) to `src/<name>` **only
  for files inside `node_modules`** by default; `includeAppCode: true` does the
  app too. Never redirects our own `src/`/`lib/`, nor `buffer`/`events`/`punycode`/
  `readable-stream` asking for their own name (`WRAPPED_PACKAGES`). `events`
  and `stream` (`CALLABLE_MODULES`) go straight to the package they wrap
  (`events`, `readable-stream/lib/stream.js`), resolved from our `src/`,
  instead of `index.ts`: Node's `require()` of them is a function
  (EventEmitter, Stream), and `require()` of an ES module gives its
  namespace, which `new` fails on ("Object is not a constructor"). Their
  `index.ts` default export is that same function, and they must stay pure
  re-exports (the user dropped `cjs.js` shims for this). The config may be an object, a promise or a function
  (`withRozenite` returns an async function); spreading one of those as an
  object silently drops the whole config. App code
  should import `react-native-nitro-node/<module>`: TypeScript always types
  bare `'fs'` as Node's (`@types/node` comes in via `@types/readable-stream`,
  and its ambient modules beat `paths`).
- **Follow Node's behavior** (argument validation and `ERR_*` codes, Stats
  date rounding, `throwIfNoEntry`, timer delay rules, etc.) and document any
  difference in the README compatibility tables.

## Working with the user

- Don't commit unless asked.
- Don't run the example tests automatically (no auto-run in `App.tsx`); they
  start from the "Run tests" button, on a device the user runs.
- When the user rejects or reverts a change, ask/record why and don't bring it
  back later.
- Verify without a device where possible: small Node harnesses in the
  scratchpad that mock the Nitro HybridObjects (`NitroTimers`, `NitroFs`, ...)
  and run the TS modules / example test files, standalone C++ builds of the
  native code against libuv (with ASan), and real Metro bundles of the example
  to check resolution. Run `npx tsc --noEmit` at the root and in `example/`.
- Add or update example tests for new features (`example/*Tests.ts`) and the
  README alongside the code.
- Code style: match the surrounding code; comments explain why, briefly.
