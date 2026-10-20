# react-native-nitro-node

Node.js core modules (`fs`, `net`, `tls`, `dns`, `http`, `https`, `timers`,
`process`, `buffer`, `events`, `stream`, `os`, `path`, `querystring`) for
React Native, built on **libuv** through **Nitro Modules** (nitrogen 0.35.x).
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
  `package.json` export (`react-native-nitro-node/<module>`).
- `src/utils.ts`, `src/errors.ts` (`fsError`, errno → Node error codes).
- `cpp/core/`: `UVLoop` (the single libuv loop on its own thread, `post` /
  `runSync`, FIFO, never destroyed) and `CallbackSlot` (a mutex-guarded JS
  callback set from JS and called from the loop thread).
- `cpp/<module>/Hybrid*.{hpp,cpp}`: the native side of each module.
- `deps/`: libuv, c-ares, openssl, tlsuv (vendored).
- `metro.js`: the `withNitroNode` Metro plugin (see below).
- `example/`: the test app. `App.tsx` + `*Tests.ts` (`netTests`, `httpTests`,
  `tlsTests`, `fsTests`, `timersTests`, `gcTests`, `memoryTest`), runner in
  `testUtils.ts`.

## Rules (decided with the user, don't undo)

- **Deferred work uses our libuv timers** (`setImmediate` / `setTimeout` from
  `src/timers`), never `queueMicrotask`, React Native's timers or RN's global
  `setImmediate` (a queueMicrotask shim in the New Architecture). RN pauses
  those in the background; ours run on the libuv loop and don't. This applies
  to `process.nextTick` (implemented with our `setImmediate`), fs callbacks,
  `rethrowLater`, etc. Don't propose switching for speed or Node ordering.
- **`process`** (`src/process/process.ts`) is the npm `process` package code,
  ported by the user, on top of our timers. Keep it close to the original.
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
  app too. Never redirects our own `src/`/`lib/`, nor `buffer`/`events`/
  `readable-stream` asking for their own name (`WRAPPED_PACKAGES`). App code
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
