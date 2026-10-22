import * as fs from 'react-native-nitro-node/fs';
import fsDefault, { readFileSync } from 'react-native-nitro-node/fs';
import * as os from 'react-native-nitro-node/os';
import { Buffer } from 'buffer';
import {
  SkipError,
  type Step,
  expectThrow,
  makePayload,
} from './testUtils';

/** Runs a Node-style callback API as a promise of its results. */
function call<T extends unknown[]>(
  fn: (callback: (err: Error | null, ...results: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, ...results) => (err ? reject(err) : resolve(results)));
  });
}

/** Calls `fn`, which has to fail with an error whose `code` is `code`. */
function expectCode(label: string, code: string | string[], fn: () => unknown): any {
  const codes = Array.isArray(code) ? code : [code];
  try {
    fn();
  } catch (err: any) {
    if (!codes.includes(err?.code)) {
      throw new Error(`${label}: failed with ${err?.code} (${err?.message}), expected ${codes.join(' or ')}`);
    }
    return err;
  }
  throw new Error(`${label}: did not throw`);
}

/** Like expectCode, for a callback API. */
async function expectCodeAsync(label: string, code: string, promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err: any) {
    if (err?.code !== code) {
      throw new Error(`${label}: failed with ${err?.code} (${err?.message}), expected ${code}`);
    }
    return err;
  }
  throw new Error(`${label}: did not fail`);
}

function expectEqual<T>(label: string, actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

const GiB = 1024 * 1024 * 1024;

/** File system tests, in a fresh directory under os.tmpdir(). */
export async function runFsTests(step: Step) {
  const root = `${os.tmpdir()}/nitro-node-fs-test-${Date.now()}`;
  const file = `${root}/a.txt`;

  await step('fs: a fresh test directory under os.tmpdir()', async () => {
    fs.mkdirSync(root);
    return root;
  });

  await step('fs default and named exports match', async () => {
    expectEqual('default.readFileSync', fsDefault.readFileSync, fs.readFileSync);
    expectEqual('named readFileSync', readFileSync, fs.readFileSync);
    const { O_RDONLY, O_WRONLY, O_CREAT, F_OK } = fs.constants;
    for (const [name, value] of Object.entries({ O_RDONLY, O_WRONLY, O_CREAT, F_OK })) {
      if (typeof value !== 'number') {
        throw new Error(`constants.${name} is ${value}`);
      }
    }
    return `${Object.keys(fs.constants).length} constants`;
  });

  await step('fs writeFileSync / readFileSync round trip', async () => {
    fs.writeFileSync(file, 'héllo wörld');
    expectEqual('utf8 text', fs.readFileSync(file, 'utf8'), 'héllo wörld');
    expectEqual('as Buffer', fs.readFileSync(file).toString('hex'), Buffer.from('héllo wörld').toString('hex'));

    // a small Buffer is a view into a shared pool: only its own bytes may be written
    const pooled = Buffer.from('hi');
    fs.writeFileSync(file, pooled);
    expectEqual('pooled Buffer', fs.readFileSync(file, 'utf8'), 'hi');

    fs.appendFileSync(file, '!');
    expectEqual('after appendFileSync', fs.readFileSync(file, 'latin1'), 'hi!');
    fs.writeFileSync(file, new Uint8Array([0, 1, 2, 255]));
    expectEqual('Uint8Array', fs.readFileSync(file).toString('hex'), '000102ff');
  });

  await step('fs writeFile / readFile on the thread pool', async () => {
    const payload = makePayload(8 * 1024 * 1024);
    let calledBack = false;
    const written = call(cb => fs.writeFile(file, payload, cb)).then(() => (calledBack = true));
    if (calledBack) {
      throw new Error('writeFile called back synchronously');
    }
    await written;
    const [data] = await call<[Buffer]>(cb => fs.readFile(file, cb));
    if (!Buffer.isBuffer(data) || !data.equals(payload)) {
      throw new Error(`read back ${data?.length} bytes that differ from the 8 MB written`);
    }
    const [hex] = await call<[string]>(cb => fs.readFile(file, { encoding: 'hex' }, cb as any));
    // Buffer.from: on Hermes, subarray() returns a plain Uint8Array, not a Buffer
    expectEqual('hex prefix', hex.slice(0, 8), Buffer.from(payload.buffer, payload.byteOffset, 4).toString('hex'));
    return '8 MB written and read back';
  }, 30000);

  await step('fs errors look like Node', async () => {
    const missing = `${root}/missing.txt`;
    const err = expectCode('readFileSync(missing)', 'ENOENT', () => fs.readFileSync(missing));
    expectEqual('syscall', err.syscall, 'open');
    expectEqual('path', err.path, missing);
    if (!(err.errno < 0)) {
      throw new Error(`errno is ${err.errno}`);
    }
    expectEqual('message', err.message, `ENOENT: no such file or directory, open '${missing}'`);
    await expectCodeAsync('readFile(missing)', 'ENOENT', call(cb => fs.readFile(missing, cb)));
    expectCode('accessSync(missing)', 'ENOENT', () => fs.accessSync(missing));
    expectCode('readdirSync(missing)', 'ENOENT', () => fs.readdirSync(missing));
    expectCode('unlinkSync(missing)', 'ENOENT', () => fs.unlinkSync(missing));
    expectThrow("openSync(file, 'bogus')", 'TypeError', () => fs.openSync(file, 'bogus'));
    return err.message;
  });

  await step('fs file descriptors: read, write, positions', async () => {
    const fd = fs.openSync(file, 'w+');
    expectEqual('writeSync string', fs.writeSync(fd, 'hello world'), 11);

    // read into the middle of a larger buffer, from an explicit position
    const big = Buffer.alloc(20, '.');
    expectEqual('readSync', fs.readSync(fd, big.subarray(5, 15), 0, 5, 6), 5);
    expectEqual('readSync target', big.toString(), '.....world..........');

    const [written] = await call<[number]>(cb => fs.write(fd, Buffer.from('XXhelloXX'), 2, 5, 0, cb));
    expectEqual('async write', written, 5);
    const [bytesRead, back] = await call<[number, Buffer]>(cb => fs.read(fd, Buffer.alloc(11), 0, 11, 0, cb));
    expectEqual('async read', `${bytesRead}:${back.toString()}`, '11:hello world');

    await call(cb => fs.ftruncate(fd, 5, cb));
    expectEqual('after ftruncate', fs.readFileSync(file, 'utf8'), 'hello');
    await call(cb => fs.close(fd, cb));
    expectCode('closeSync twice', 'EBADF', () => fs.closeSync(fd));
    expectCode("openSync(existing, 'wx')", 'EEXIST', () => fs.openSync(file, 'wx'));
  });

  await step('fs directories: mkdir, readdir, rm', async () => {
    const deep = `${root}/x/y/z`;
    fs.mkdirSync(deep, { recursive: true });
    fs.mkdirSync(deep, { recursive: true });
    expectCode('mkdirSync(existing)', 'EEXIST', () => fs.mkdirSync(deep));
    fs.writeFileSync(`${deep}/f.txt`, 'x');

    const [names] = await call<[string[]]>(cb => fs.readdir(`${root}/x/y`, cb));
    expectEqual('readdir', names.join(','), 'z');
    expectCode('rmdirSync(non-empty)', 'ENOTEMPTY', () => fs.rmdirSync(`${root}/x`));
    expectCode('rmSync(dir) without recursive', ['EISDIR', 'EPERM'], () => fs.rmSync(`${root}/x`));

    await call(cb => fs.rm(`${root}/x`, { recursive: true }, cb));
    expectEqual('existsSync after rm', fs.existsSync(`${root}/x`), false);
    fs.rmSync(`${root}/x`, { recursive: true, force: true });
    expectCode('rmSync(missing)', 'ENOENT', () => fs.rmSync(`${root}/x`));

    fs.mkdirSync(`${root}/empty`);
    await call(cb => fs.rmdir(`${root}/empty`, cb));
    const exists = await new Promise<boolean>(resolve => fs.exists(root, resolve));
    expectEqual('exists(root)', exists, true);
  });

  await step('fs every callback form, on the thread pool', async () => {
    const dir = `${root}/cb`;
    await call(cb => fs.mkdir(dir, cb));
    await expectCodeAsync('mkdir(existing)', 'EEXIST', call(cb => fs.mkdir(dir, cb)));
    await call(cb => fs.mkdir(`${dir}/a/b`, { recursive: true }, cb));
    await call(cb => fs.mkdir(`${dir}/a/b`, { recursive: true }, cb));

    const [fd] = await call<[number]>(cb => fs.open(`${dir}/a/f.txt`, 'w+', cb));
    if (!(fd > 2)) {
      throw new Error(`open gave fd ${fd}`);
    }
    await call(cb => fs.write(fd, 'callbacks', cb as any));
    const [stats] = await call<[fs.Stats]>(cb => fs.fstat(fd, cb));
    expectEqual('fstat size', stats.size, 9);
    await call(cb => fs.ftruncate(fd, 4, cb));
    await call(cb => fs.close(fd, cb));
    await expectCodeAsync('close(closed)', 'EBADF', call(cb => fs.close(fd, cb)));
    await expectCodeAsync("open(missing, 'r')", 'ENOENT', call(cb => fs.open(`${dir}/nope`, 'r', cb)));
    expectEqual('content', fs.readFileSync(`${dir}/a/f.txt`, 'utf8'), 'call');

    await call(cb => fs.access(`${dir}/a/f.txt`, fs.constants.R_OK, cb));
    const accessErr = await expectCodeAsync('access(missing)', 'ENOENT', call(cb => fs.access(`${dir}/nope`, cb)));
    expectEqual('access error', accessErr.message, `ENOENT: no such file or directory, access '${dir}/nope'`);
    expectEqual('exists(missing)', await new Promise<boolean>(r => fs.exists(`${dir}/nope`, r)), false);

    const [names] = await call<[string[]]>(cb => fs.readdir(`${dir}/a`, cb));
    expectEqual('readdir', names.sort().join(','), 'b,f.txt');
    const readdirErr = await expectCodeAsync('readdir(missing)', 'ENOENT', call(cb => fs.readdir(`${dir}/nope`, cb)));
    expectEqual('readdir syscall', readdirErr.syscall, 'scandir');
    const [lst] = await call<[fs.Stats]>(cb => fs.lstat(`${dir}/a/b`, cb));
    expectEqual('lstat isDirectory', lst.isDirectory(), true);
    await expectCodeAsync('statfs(missing)', 'ENOENT', call(cb => fs.statfs(`${dir}/nope`, cb)));

    await call(cb => fs.unlink(`${dir}/a/f.txt`, cb));
    await expectCodeAsync('unlink(missing)', 'ENOENT', call(cb => fs.unlink(`${dir}/a/f.txt`, cb)));
    await expectCodeAsync('rmdir(non-empty)', 'ENOTEMPTY', call(cb => fs.rmdir(`${dir}/a`, cb)));
    await call(cb => fs.rm(`${dir}/nope`, { force: true }, cb));
    await expectCodeAsync('rm(missing)', 'ENOENT', call(cb => fs.rm(`${dir}/nope`, cb)));
    await call(cb => fs.rm(dir, { recursive: true }, cb));
    expectEqual('existsSync after rm', fs.existsSync(dir), false);
  });

  await step('fs accepts file:// strings and URL objects', async () => {
    fs.writeFileSync(`file://${root}/url%20file.txt`, 'via url');
    expectEqual('file:// string', fs.readFileSync(`${root}/url file.txt`, 'utf8'), 'via url');
    // React Native's own URL class reports '/' as the pathname of any file: URL
    expectEqual('URL object', fs.readFileSync(new URL(`file://${root}/url%20file.txt`), 'utf8'), 'via url');
    expectThrow('http URL', 'TypeError', () => fs.readFileSync(new URL('https://example.com/a')));
  });

  await step('fs statfs', async () => {
    const info = fs.statfsSync(root);
    if (!(info.bsize > 0 && info.blocks > 0 && info.bavail <= info.blocks)) {
      throw new Error(`implausible statfs: ${JSON.stringify(info)}`);
    }
    const [again] = await call<[fs.StatFs]>(cb => fs.statfs(root, cb));
    expectEqual('statfs bsize', again.bsize, info.bsize);
    return `${((info.bavail * info.bsize) / GiB).toFixed(1)} GiB free`;
  });

  await step('fs stat, lstat and fstat', async () => {
    const before = Date.now();
    fs.writeFileSync(file, 'hello stat');
    const s = fs.statSync(file);
    if (!(s instanceof fs.Stats) || !s.isFile() || s.isDirectory() || s.isSymbolicLink()) {
      throw new Error(`not a plain file: mode ${s.mode.toString(8)}`);
    }
    expectEqual('size', s.size, 10);
    expectEqual('nlink', s.nlink, 1);
    if (!(s.ino > 0 && s.blksize > 0 && s.mode & fs.constants.S_IRUSR)) {
      throw new Error(`implausible stats: ${JSON.stringify(s)}`);
    }
    // the file system may round the time down to a second or so
    if (!(s.mtimeMs > before - 2000 && s.mtimeMs < Date.now() + 2000)) {
      throw new Error(`mtime ${s.mtime.toISOString()} is not now`);
    }
    expectEqual('mtime Date', s.mtime.getTime(), Math.round(s.mtimeMs));
    if (!(s.birthtimeMs > 0 && s.birthtimeMs <= s.mtimeMs + 1)) {
      throw new Error(`birthtime ${s.birthtimeMs} after mtime ${s.mtimeMs}`);
    }
    if (!fs.statSync(root).isDirectory()) {
      throw new Error('the test directory is not a directory');
    }

    const fd = fs.openSync(file, 'r');
    try {
      expectEqual('fstatSync ino', fs.fstatSync(fd).ino, s.ino);
      const [viaFd] = await call<[fs.Stats]>(cb => fs.fstat(fd, cb));
      expectEqual('fstat size', viaFd.size, 10);
    } finally {
      fs.closeSync(fd);
    }
    const [viaCallback] = await call<[fs.Stats]>(cb => fs.stat(file, cb));
    expectEqual('stat ino', viaCallback.ino, s.ino);

    const missing = `${root}/missing`;
    const err = expectCode('statSync(missing)', 'ENOENT', () => fs.statSync(missing));
    expectEqual('error syscall', err.syscall, 'stat');
    expectEqual('error message', err.message, `ENOENT: no such file or directory, stat '${missing}'`);
    await expectCodeAsync('lstat(missing)', 'ENOENT', call(cb => fs.lstat(missing, cb)));
    expectEqual('throwIfNoEntry: false', fs.statSync(missing, { throwIfNoEntry: false }), undefined);
    expectCode('fstatSync(-1)', 'EBADF', () => fs.fstatSync(-1));

    // fs can't make symbolic links yet; the system has a few
    const link = ['/var', '/etc', '/sdcard', '/tmp'].find(p => {
      try {
        return fs.lstatSync(p).isSymbolicLink();
      } catch {
        return false;
      }
    });
    if (link !== undefined && fs.statSync(link).isSymbolicLink()) {
      throw new Error(`statSync(${link}) did not follow the link`);
    }
    return `${s.size} bytes, mode ${(s.mode & 0o7777).toString(8)}, ` +
      (link ? `lstat sees ${link} as a link` : 'no system link to lstat');
  });

  await step('fs files past 2 GiB and 4 GiB', async () => {
    // a sparse file: writing at 5 GiB takes no real space on APFS, ext4 or f2fs
    const huge = `${root}/huge.bin`;
    const at5G = 5 * GiB + 7;
    const fd = fs.openSync(huge, 'w+');
    try {
      try {
        fs.writeSync(fd, 'far away', at5G);
      } catch (err: any) {
        if (err?.code === 'EFBIG' || err?.code === 'ENOSPC') {
          throw new SkipError(`this file system refuses a 5 GiB offset (${err.code})`);
        }
        throw err;
      }
      const back = Buffer.alloc(8);
      expectEqual('readSync at 5 GiB', fs.readSync(fd, back, 0, 8, at5G), 8);
      expectEqual('content at 5 GiB', back.toString(), 'far away');
      const [, asyncBack] = await call<[number, Buffer]>(cb => fs.read(fd, Buffer.alloc(8), 0, 8, at5G, cb));
      expectEqual('async read at 5 GiB', asyncBack.toString(), 'far away');
      expectEqual('fstatSync size past 4 GiB', fs.fstatSync(fd).size, at5G + 8);

      await call(cb => fs.ftruncate(fd, 6 * GiB, cb));
      const err = expectCode('readFileSync(6 GiB)', 'ERR_FS_FILE_TOO_LARGE', () => fs.readFileSync(huge));
      if (!(err instanceof RangeError)) {
        throw new Error('ERR_FS_FILE_TOO_LARGE is not a RangeError');
      }
      await expectCodeAsync('readFile(6 GiB)', 'ERR_FS_FILE_TOO_LARGE', call(cb => fs.readFile(huge, cb)));
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(huge);
    }
    return 'read/write at 5 GiB, ftruncate to 6 GiB';
  });

  await step('fs callbacks never run synchronously', async () => {
    const order: string[] = [];
    const done = call(cb => fs.access(root, cb)).then(() => order.push('callback'));
    order.push('after call');
    await done;
    expectEqual('order', order.join(','), 'after call,callback');
  });

  await step('fs cleanup', async () => {
    fs.rmSync(root, { recursive: true, force: true });
    expectEqual('existsSync(root)', fs.existsSync(root), false);
  });
}
