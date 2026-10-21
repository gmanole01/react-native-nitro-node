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
 *
 * `debug: true` logs every request for a Node module name, with the file that
 * makes it and what it resolves to.
 */

const path = require('path');

/** The Node modules this library implements, each in src/<name>/index.ts. */
const MODULES = [
  'buffer',
  'crypto',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'process',
  'punycode',
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
  punycode: 'punycode',
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
 * Why a request for Node module `name` from `from` is left to the default
 * resolver, or null when it goes to this library.
 */
function keepReason(name, from, modules, includeAppCode) {
  if (!modules.has(name)) {
    return 'not in `modules`';
  }
  if (OWN_CODE.some((dir) => from.startsWith(dir))) {
    return "react-native-nitro-node's own code";
  }
  if (!includeAppCode && !isDependency(from)) {
    return 'app code, see `includeAppCode`';
  }
  if (name in WRAPPED_PACKAGES && isInsidePackage(from, WRAPPED_PACKAGES[name])) {
    return `inside ${WRAPPED_PACKAGES[name]}, which our ${name} wraps`;
  }
  return null;
}

/** What a resolution points to, for the debug log. */
function describeResolution(resolution, root) {
  if (resolution.type === 'sourceFile') {
    return path.relative(root, resolution.filePath);
  }
  if (resolution.type === 'assetFiles') {
    return resolution.filePaths.map((file) => path.relative(root, file)).join(', ');
  }
  return `(${resolution.type})`;
}

/**
 * Returns `config` with its resolver sending Node module names to this
 * library. Any resolveRequest already in `config` still handles everything
 * else.
 *
 * @template {import('metro-config').MetroConfig} T
 * @param {T} config
 * @param {{ modules?: string[], includeAppCode?: boolean, debug?: boolean }} [options]
 *   `modules`: the names to redirect, from `MODULES`. Defaults to all of them.
 *   `includeAppCode`: redirect them in the app's own code too, not only in
 *   its dependencies. Defaults to false.
 *   `debug`: log each request for a Node module name and how it resolves.
 *   Defaults to false.
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
  const debug = options.debug === true;
  // Paths in the log are relative to the app
  const root = config.projectRoot ?? process.cwd();
  const log = (from, moduleName, outcome) =>
    console.log(
      `[withNitroNode] ${path.relative(root, from)}: '${moduleName}' ${outcome}`,
    );

  if (debug) {
    console.log(
      `[withNitroNode] redirecting ${[...modules].join(', ')} in ` +
        (includeAppCode ? 'dependencies and app code' : 'dependencies'),
    );
  }

  const resolver = config.resolver ?? {};
  const previous = resolver.resolveRequest;

  return {
    ...config,
    resolver: {
      ...resolver,
      resolveRequest(context, moduleName, platform) {
        const resolve = previous ?? context.resolveRequest;
        const name = nodeModuleName(moduleName);
        if (name === null) {
          return resolve(context, moduleName, platform);
        }
        const from = context.originModulePath;
        const reason = keepReason(name, from, modules, includeAppCode);
        if (reason === null) {
          const filePath = path.join(__dirname, 'src', name, 'index.ts');
          if (debug) {
            log(from, moduleName, `→ ${path.relative(root, filePath)}`);
          }
          return { type: 'sourceFile', filePath };
        }
        if (!debug) {
          return resolve(context, moduleName, platform);
        }
        let resolution;
        try {
          resolution = resolve(context, moduleName, platform);
        } catch (error) {
          log(from, moduleName, `left alone (${reason}) → not found`);
          throw error;
        }
        log(
          from,
          moduleName,
          `left alone (${reason}) → ${describeResolution(resolution, root)}`,
        );
        return resolution;
      },
    },
  };
}

module.exports = { withNitroNode, MODULES };
