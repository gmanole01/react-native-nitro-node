import path, {
  basename,
  join,
  matchesGlob,
  posix,
  sep,
  win32,
} from 'react-native-nitro-node/path';
import * as fs from 'react-native-nitro-node/fs';
import * as os from 'react-native-nitro-node/os';
import process from 'react-native-nitro-node/process';
import { Platform } from 'react-native';
import { type Step } from './testUtils';

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

/** The error `fn` throws. */
function thrown(fn: () => unknown): any {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('did not throw');
}

// The expected values are Node's
export async function runPathTests(step: Step) {
  await step("path: the platform's, as Node", async () => {
    const windows = Platform.OS === 'windows';
    expectEqual('default is win32 on Windows, posix elsewhere', path === (windows ? win32 : posix), true);
    expectEqual('sep, delimiter', [sep, path.delimiter], windows ? ['\\', ';'] : ['/', ':']);
    expectEqual('named exports are the default\'s', [join === path.join, basename === path.basename, matchesGlob === path.matchesGlob], [true, true, true]);
    expectEqual('win32 and posix point to each other', [path.win32 === win32, path.posix === posix, win32.posix === posix, posix.win32 === win32], [true, true, true, true]);
    expectEqual('_makeLong (DEP0080)', path._makeLong === path.toNamespacedPath, true);
    return `${windows ? 'win32' : 'posix'}, sep ${JSON.stringify(sep)}`;
  });

  await step('path.win32 and path.posix, on any platform', async () => {
    expectEqual('win32.join', win32.join('C:\\a', 'b/c', '..', 'd.txt'), 'C:\\a\\b\\d.txt');
    expectEqual('win32.parse', win32.parse('C:\\a\\b.txt'), { root: 'C:\\', dir: 'C:\\a', base: 'b.txt', ext: '.txt', name: 'b' });
    expectEqual('win32.relative', win32.relative('C:\\a\\b', 'C:\\a\\c\\d'), '..\\c\\d');
    expectEqual('win32 UNC', [win32.isAbsolute('\\\\server\\share\\x'), win32.dirname('\\\\server\\share\\x')], [true, '\\\\server\\share\\']);
    expectEqual('win32.toNamespacedPath', win32.toNamespacedPath('C:\\a'), '\\\\?\\C:\\a');
    expectEqual('posix.join', posix.join('/a', 'b/c', '..', 'd.txt'), '/a/b/d.txt');
    expectEqual('posix.relative', posix.relative('/a/b', '/a/c/d'), '../c/d');
    expectEqual('posix.format(parse())', posix.format(posix.parse('/a/b.tar.gz')), '/a/b.tar.gz');
    return 'join, parse, relative, UNC, format';
  });

  await step("path.matchesGlob(), on Node's minimatch", async () => {
    expectEqual('win32', [win32.matchesGlob('C:\\a\\b.js', 'C:\\a\\*.{js,ts}'), win32.matchesGlob('C:\\A\\B.JS', 'c:\\a\\*.js')], [true, false]);
    expectEqual('posix', [posix.matchesGlob('/a/x/b.js', '/a/**/*.js'), posix.matchesGlob('/a/.b.js', '/a/*.js')], [true, false]);
    return 'braces, **, dot files';
  });

  await step('process.cwd(), chdir(), path.resolve() and fs, as Node', async () => {
    const windows = Platform.OS === 'windows';
    const start = process.cwd();
    if (!(windows ? win32.isAbsolute(start) : start.startsWith('/'))) {
      throw new Error(`cwd() is not absolute: ${start}`);
    }
    if (!windows) {
      // the app starts in its data directory (/var and /private/var on iOS are
      // the same folder: compared by inode)
      const [a, b] = [fs.statSync(start), fs.statSync(os.homedir())];
      expectEqual('starts in os.homedir()', [a.dev, a.ino], [b.dev, b.ino]);
    }
    expectEqual('resolve() of a relative path', path.resolve('a', 'b'), path.join(start, 'a', 'b'));

    const tmp = os.tmpdir();
    process.chdir(tmp);
    try {
      const name = `nitro-node-cwd-${Date.now()}.txt`;
      fs.writeFileSync(name, 'relative');
      expectEqual('fs relative path is in cwd()', fs.readFileSync(path.join(tmp, name), 'utf8'), 'relative');
      fs.unlinkSync(name);
    } finally {
      process.chdir(start);
    }
    expectEqual('back', process.cwd(), start);

    const error = thrown(() => process.chdir('nitro-node-missing-dir'));
    expectEqual('chdir error', [error.code, error.syscall, error.path, error.dest], ['ENOENT', 'chdir', start, 'nitro-node-missing-dir']);
    expectEqual('chdir message', error.message.endsWith(`chdir '${start}' -> 'nitro-node-missing-dir'`), true);
    expectEqual('chdir(1)', thrown(() => process.chdir(1 as any)).code, 'ERR_INVALID_ARG_TYPE');
    return start;
  });

  await step("path: Node's errors", async () => {
    expectEqual('format(null)', thrown(() => win32.format(null as any)).code, 'ERR_INVALID_ARG_TYPE');
    expectEqual('join(1)', thrown(() => posix.join(1 as any)).code, 'ERR_INVALID_ARG_TYPE');
    expectEqual('matchesGlob(1)', thrown(() => posix.matchesGlob(1 as any, '*')).code, 'ERR_INVALID_ARG_TYPE');
    return 'ERR_INVALID_ARG_TYPE';
  });
}
