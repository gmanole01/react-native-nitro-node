'use strict';

/**
 * Metro setup for react-native-nitro-node.
 *
 * Makes Node's module names (`fs`, `net`, `process`, ...) resolve to this
 * library's modules in the app's dependencies. Packages written for Node then
 * work as is, and the ones that defer work with `process.nextTick`
 * (readable-stream, which net and http streams are built on, among them) use
 * our nextTick: it runs on the libuv loop and keeps going while the app is in
 * the background, unlike React Native's timers.
 *
 *   const { withNitroNode } = require('react-native-nitro-node/metro');
 *   module.exports = withNitroNode(mergeConfig(getDefaultConfig(__dirname), config));
 *
 * The app's own code is left alone by default: there, TypeScript would type
 * `import fs from 'fs'` as Node's fs anyway, so importing
 * 'react-native-nitro-node/fs' is the clearer way. To redirect it too, and
 * to redirect only some modules:
 *
 *   withNitroNode(config, { includeAppCode: true, modules: ['process', 'timers'] });
 */

const path = require('path');

/** The Node modules this library implements, each in src/<name>/index.ts. */
const MODULES = [
  'buffer',
  'dns',
  'events',
  'fs',
  'http',
  'https',
  'net',
  'os',
  'path',
  'process',
  'querystring',
  'stream',
  'timers',
  'tls',
];

/**
 * Our modules that re-export an npm package, and that package. Requests from
 * inside the package are left alone: readable-stream asking for `stream` must
 * not get our stream, which is readable-stream itself.
 */
const WRAPPED_PACKAGES = {
  buffer: 'buffer',
  events: 'events',
  stream: 'readable-stream',
};

// Our own code imports the npm packages under the same names (src/buffer
// imports 'buffer'), so requests from it are never redirected.
const OWN_CODE = [
  path.join(__dirname, 'src') + path.sep,
  path.join(__dirname, 'lib') + path.sep,
];

/**
 * The module a request names, for `fs`, `fs/` (the npm package, as some
 * packages ask for it) and `node:fs`; null for anything else.
 */
function nodeModuleName(request) {
  const name = request.startsWith('node:')
    ? request.slice(5)
    : request.replace(/\/$/, '');
  return MODULES.includes(name) ? name : null;
}

function isInsidePackage(file, pkg) {
  return file.includes(`${path.sep}node_modules${path.sep}${pkg}${path.sep}`);
}

/**
 * Whether a file belongs to one of the app's dependencies: whether it is in a
 * node_modules folder. Packages of a monorepo that Metro reaches through a
 * symlink have their real path, outside node_modules, and so count as the
 * app's code.
 */
function isDependency(file) {
  return file.includes(`${path.sep}node_modules${path.sep}`);
}

/**
 * Returns `config` with its resolver sending Node module names to this
 * library. Any resolveRequest already in `config` still handles everything
 * else.
 *
 * @template {import('metro-config').MetroConfig} T
 * @param {T} config
 * @param {{ modules?: string[], includeAppCode?: boolean }} [options]
 *   `modules`: the names to redirect, from `MODULES`. Defaults to all of them.
 *   `includeAppCode`: redirect them in the app's own code too, not only in
 *   its dependencies. Defaults to false.
 * @returns {T}
 */
function withNitroNode(config, options = {}) {
  const modules = new Set(options.modules ?? MODULES);
  for (const name of modules) {
    if (!MODULES.includes(name)) {
      throw new Error(
        `withNitroNode: react-native-nitro-node has no "${name}" module. ` +
          `It has: ${MODULES.join(', ')}.`,
      );
    }
  }

  const includeAppCode = options.includeAppCode === true;

  const resolver = config.resolver ?? {};
  const previous = resolver.resolveRequest;

  return {
    ...config,
    resolver: {
      ...resolver,
      resolveRequest(context, moduleName, platform) {
        const name = nodeModuleName(moduleName);
        const from = context.originModulePath;
        if (
          name !== null &&
          modules.has(name) &&
          (includeAppCode || isDependency(from)) &&
          !OWN_CODE.some((dir) => from.startsWith(dir)) &&
          !(
            name in WRAPPED_PACKAGES &&
            isInsidePackage(from, WRAPPED_PACKAGES[name])
          )
        ) {
          return {
            type: 'sourceFile',
            filePath: path.join(__dirname, 'src', name, 'index.ts'),
          };
        }
        const resolve = previous ?? context.resolveRequest;
        return resolve(context, moduleName, platform);
      },
    },
  };
}

module.exports = { withNitroNode, MODULES };
