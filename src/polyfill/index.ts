/**
 * Patches the globals that packages written for Node or the web expect:
 * `global.Buffer` (this library's `buffer`) and `global.crypto` (its
 * `crypto`, with `subtle`, `getRandomValues` and `randomUUID`).
 *
 * Import it first, before anything that uses them, in the app's entry file:
 *
 *   import 'react-native-nitro-node/polyfill';
 *
 * Some packages read `Buffer` while their own module loads, so a call made
 * later, from a component, would be too late for them.
 */
import { install } from '../crypto';

install();
