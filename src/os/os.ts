import { NitroOs } from '../native';

/** The line separator. */
export const EOL = '\n';

/**
 * The app's directory for temporary files: iOS's per-app tmp directory, or
 * Android's cache directory. The system may delete its files when it needs
 * space. Like Node's, the path has no trailing slash.
 */
export function tmpdir(): string {
  const dir = NitroOs.tmpdir();
  // iOS's $TMPDIR ends with a slash; Node strips it
  return dir.length > 1 && dir.endsWith('/') ? dir.slice(0, -1) : dir;
}

/**
 * The app's private data directory: the app's sandbox on iOS (which holds
 * Documents, Library and tmp), or /data/user/0/<package> on Android. On iOS
 * the directory itself is not writable, only the folders in it.
 */
export function homedir(): string {
  return NitroOs.homedir();
}
