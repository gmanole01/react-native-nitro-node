const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');
// The library's Metro setup; apps use require('react-native-nitro-node/metro').
const { withNitroNode } = require('../metro');
const root = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [root],
};

module.exports = withNitroNode(mergeConfig(getDefaultConfig(__dirname), config));