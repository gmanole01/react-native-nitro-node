/**
 * @format
 */

// First: global.Buffer and global.crypto, for packages that use them
import 'react-native-nitro-node/polyfill';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
