/**
 * @format
 */

// First: global.Buffer and global.crypto, for packages that use them
import 'react-native-nitro-node/polyfill';
import { AppRegistry } from 'react-native';
// The test app and its suites are the mobile app's, shared as they are
import App from '../mobile/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
