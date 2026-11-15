#!/usr/bin/env node
// Copies react-native-nitro-modules' C++ core into <outDir>/NitroModules, for
// windows/NitroNode.vcxproj, which builds it into NitroNode.dll: Nitro has no
// Windows package to link. Run by MSBuild before each build.
//
// Flat, as CocoaPods lays Nitro's headers out on iOS: Nitro includes its own
// headers by bare name ("HybridObject.hpp") and Nitrogen's code includes them
// as <NitroModules/HybridObject.hpp>. Its sources are compiled from the copy
// too, so that every file sees the patched headers below (MSVC looks for a
// quoted include in the including file's folder first).
//
// Patched: react-native-windows hands a library's DLL a JsiAbiRuntime, a
// jsi::Runtime over its ABI, whose createArrayBuffer(MutableBuffer) crashes
// (not implemented, VerifyElseCrash). Nitro calls it for every ArrayBuffer it
// returns to JS; on Windows it gets a JS-allocated copy instead.
//
// Usage: node prepare-nitro-windows.js <outDir>
const fs = require('fs');
const path = require('path');

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: prepare-nitro-windows.js <outDir>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
// From the app first: that's the copy its JS uses, and native and JS check
// that their versions match.
const nitroDir = path.dirname(
  require.resolve('react-native-nitro-modules/package.json', { paths: [process.cwd(), root] }),
);
const nitroCpp = path.join(nitroDir, 'cpp');
const target = path.join(outDir, 'NitroModules');

const PATCHES = {
  'JSIConverter+ArrayBuffer.hpp': [
    {
      find: `    // 1. Create jsi::ArrayBuffer
    jsi::ArrayBuffer arrayBuffer(runtime, buffer);
    // 2. Wrap jsi::MutableBuffer in jsi::NativeState holder & attach it
    auto mutableBufferHolder = std::make_shared<MutableBufferNativeState>(buffer);
    arrayBuffer.setNativeState(runtime, mutableBufferHolder);
    // 3. Return jsi::ArrayBuffer (with jsi::NativeState) to JS
    return arrayBuffer;`,
      replace: `    // react-native-nitro-node (scripts/prepare-nitro-windows.js): react-native-windows'
    // JsiAbiRuntime can't wrap native memory (createArrayBuffer() crashes), so JS
    // gets a copy. No NativeState: fromJSI() then reads the JS copy, which JS may
    // have changed, rather than the native buffer.
    size_t size = buffer->size();
    jsi::Function constructor = runtime.global().getPropertyAsFunction(runtime, "ArrayBuffer");
    jsi::ArrayBuffer arrayBuffer =
        constructor.callAsConstructor(runtime, static_cast<double>(size)).getObject(runtime).getArrayBuffer(runtime);
    if (size > 0) {
      std::memcpy(arrayBuffer.data(runtime), buffer->data(), size);
    }
    return arrayBuffer;`,
    },
    { find: '#include <jsi/jsi.h>', replace: '#include <cstring>\n#include <jsi/jsi.h>' },
  ],
};

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

// Only rewrites a file whose content changed, so MSBuild's incremental build
// doesn't recompile Nitro every time.
function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    return;
  }
  fs.writeFileSync(file, content);
}

fs.mkdirSync(target, { recursive: true });
const seen = new Map();
for (const file of walk(nitroCpp)) {
  if (!/\.(h|hpp|cpp)$/.test(file)) {
    continue;
  }
  const name = path.basename(file);
  if (seen.has(name)) {
    throw new Error(`Two Nitro files named ${name}: ${seen.get(name)} and ${file}`);
  }
  seen.set(name, file);

  let content = fs.readFileSync(file, 'utf8');
  for (const { find, replace } of PATCHES[name] ?? []) {
    if (!content.includes(find)) {
      throw new Error(
        `react-native-nitro-modules ${require(path.join(nitroDir, 'package.json')).version}: ` +
          `${name} changed, update the patch in ${path.relative(root, __filename)}`,
      );
    }
    content = content.replace(find, () => replace);
  }
  writeIfChanged(path.join(target, name), content);
}

// Files of an older Nitro, not in this one
for (const name of fs.readdirSync(target)) {
  if (!seen.has(name)) {
    fs.rmSync(path.join(target, name));
  }
}
