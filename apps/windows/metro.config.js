const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const fs = require('fs');
const path = require('path');
// The library's Metro setup; apps use require('react-native-nitro-node/metro').
const { withNitroNode } = require('../../metro');
const root = path.resolve(__dirname, '../..');

const rnwPath = fs.realpathSync(
  path.resolve(require.resolve('react-native-windows/package.json'), '..'),
);

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  // the whole repository: the library's src/ and the mobile app's App.tsx
  watchFolders: [root],
  resolver: {
    blockList: [
      // run-windows' build output: Metro crashes or hits EBUSY on files
      // MSBuild holds (react-native-windows' cpp-app template)
      new RegExp(`${path.resolve(__dirname, 'windows').replace(/[/\\]/g, '/')}.*`),
      new RegExp(`${rnwPath.replace(/[/\\]/g, '/')}/build/.*`),
      new RegExp(`${rnwPath.replace(/[/\\]/g, '/')}/target/.*`),
      /.*\.ProjectImports\.zip/,
    ],
  },
};

module.exports = withNitroNode(
  mergeConfig(getDefaultConfig(__dirname), config),
  {
    debug: true,
  },
);
