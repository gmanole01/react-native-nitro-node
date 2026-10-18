import type { HybridObject } from 'react-native-nitro-modules';

export interface SockAddr {
  ip: string;
  port: number;
}

/** What statfs(2) reports about a file system, as Node's fs.StatFs. */
export interface StatFs {
  type: number;
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
  files: number;
  ffree: number;
}

// prettier-ignore
export interface NitroNodeNetSocket extends HybridObject<{ android: 'c++', ios: 'c++' }> {
  // Properties
  onConnect: (status: number) => void;
  onRead: (data: ArrayBuffer, status: number) => void;
  onWrite: (id: number, status: number) => void;
  onClose: () => void;

  // Methods
  pause(): void;
  resume(): void;
  shutdown(): void;
  close(): void;
  write(id: number, buffer: ArrayBuffer): void;
  connect(host: string, port: number): void;
  getWriteQueueSize(): number;

  // Both can be called before connect(), the setting is applied once connected.
  setNoDelay(enable: boolean): void;
  // A delay of 0 keeps the system's default.
  setKeepAlive(enable: boolean, initialDelaySeconds: number): void;

  getSockName(): SockAddr | null;
  getPeerName(): SockAddr | null;
}

// prettier-ignore
export interface NitroNodeNetServer
  extends HybridObject<{ android: 'c++'; ios: 'c++' }> {
  // Properties
  onListening: (status: number) => void;
  onConnection: (socket: NitroNodeNetSocket | null, status: number) => void;
  onClose: () => void;

  // Methods
  listen(host: string, port: number): void;
  close(): void;

  getSockName(): SockAddr | null;
}

/** How a TLS client connection is set up, see NitroNodeTlsSocket.startTls(). */
export interface TlsClientOptions {
  /** Sent as SNI, and the name the server's certificate has to match. */
  servername?: string;
  /** ALPN protocols to offer, most preferred first. */
  ALPNProtocols?: string[];
  /** Fail the handshake when the server's certificate can't be verified. */
  rejectUnauthorized: boolean;
}

/**
 * A TCP socket that speaks TLS. JS drives it exactly like a NitroNodeNetSocket
 * (the members up to getPeerName are the same): onRead delivers decrypted data
 * and write() takes plaintext.
 */
// prettier-ignore
export interface NitroNodeTlsSocket extends HybridObject<{ android: 'c++', ios: 'c++' }> {
  // Properties
  onConnect: (status: number) => void;
  onRead: (data: ArrayBuffer, status: number) => void;
  onWrite: (id: number, status: number) => void;
  onClose: () => void;

  // Methods
  pause(): void;
  resume(): void;
  shutdown(): void;
  close(): void;
  write(id: number, buffer: ArrayBuffer): void;
  connect(host: string, port: number): void;
  getWriteQueueSize(): number;

  // Both can be called before connect(), the setting is applied once connected.
  setNoDelay(enable: boolean): void;
  // A delay of 0 keeps the system's default.
  setKeepAlive(enable: boolean, initialDelaySeconds: number): void;

  getSockName(): SockAddr | null;
  getPeerName(): SockAddr | null;

  // TLS
  /** The handshake finished: without an error it succeeded. */
  onSecure: (error?: string) => void;

  /**
   * Starts the client handshake as soon as the socket is connected (right
   * away when it already is). Writes made before the handshake finishes are
   * sent after it.
   */
  startTls(options: TlsClientOptions): void;

  /** The protocol the server picked with ALPN, once secure. */
  getAlpnProtocol(): string | undefined;
}

// prettier-ignore
export interface NitroNodeTlsServer extends HybridObject<{ android: 'c++', ios: 'c++' }> {}

// prettier-ignore
export interface NitroNodeTlsSecureContext extends HybridObject<{ android: 'c++'; ios: 'c++' }> {}

// prettier-ignore
export interface NitroNodeUv extends HybridObject<{ android: 'c++'; ios: 'c++' }> {
  // error codes
  readonly UV_E2BIG: number;
  readonly UV_EACCES: number;
  readonly UV_EADDRINUSE: number;
  readonly UV_EADDRNOTAVAIL: number;
  readonly UV_EAFNOSUPPORT: number;
  readonly UV_EAGAIN: number;
  readonly UV_EAI_ADDRFAMILY: number;
  readonly UV_EAI_AGAIN: number;
  readonly UV_EAI_BADFLAGS: number;
  readonly UV_EAI_BADHINTS: number;
  readonly UV_EAI_CANCELED: number;
  readonly UV_EAI_FAIL: number;
  readonly UV_EAI_FAMILY: number;
  readonly UV_EAI_MEMORY: number;
  readonly UV_EAI_NODATA: number;
  readonly UV_EAI_NONAME: number;
  readonly UV_EAI_OVERFLOW: number;
  readonly UV_EAI_PROTOCOL: number;
  readonly UV_EAI_SERVICE: number;
  readonly UV_EAI_SOCKTYPE: number;
  readonly UV_EALREADY: number;
  readonly UV_EBADF: number;
  readonly UV_EBUSY: number;
  readonly UV_ECANCELED: number;
  readonly UV_ECHARSET: number;
  readonly UV_ECONNABORTED: number;
  readonly UV_ECONNREFUSED: number;
  readonly UV_ECONNRESET: number;
  readonly UV_EDESTADDRREQ: number;
  readonly UV_EEXIST: number;
  readonly UV_EFAULT: number;
  readonly UV_EFBIG: number;
  readonly UV_EHOSTUNREACH: number;
  readonly UV_EINTR: number;
  readonly UV_EINVAL: number;
  readonly UV_EIO: number;
  readonly UV_EISCONN: number;
  readonly UV_EISDIR: number;
  readonly UV_ELOOP: number;
  readonly UV_EMFILE: number;
  readonly UV_EMSGSIZE: number;
  readonly UV_ENAMETOOLONG: number;
  readonly UV_ENETDOWN: number;
  readonly UV_ENETUNREACH: number;
  readonly UV_ENFILE: number;
  readonly UV_ENOBUFS: number;
  readonly UV_ENODEV: number;
  readonly UV_ENOENT: number;
  readonly UV_ENOMEM: number;
  readonly UV_ENONET: number;
  readonly UV_ENOPROTOOPT: number;
  readonly UV_ENOSPC: number;
  readonly UV_ENOSYS: number;
  readonly UV_ENOTCONN: number;
  readonly UV_ENOTDIR: number;
  readonly UV_ENOTEMPTY: number;
  readonly UV_ENOTSOCK: number;
  readonly UV_ENOTSUP: number;
  readonly UV_EOVERFLOW: number;
  readonly UV_EPERM: number;
  readonly UV_EPIPE: number;
  readonly UV_EPROTO: number;
  readonly UV_EPROTONOSUPPORT: number;
  readonly UV_EPROTOTYPE: number;
  readonly UV_ERANGE: number;
  readonly UV_EROFS: number;
  readonly UV_ESHUTDOWN: number;
  readonly UV_ESPIPE: number;
  readonly UV_ESRCH: number;
  readonly UV_ETIMEDOUT: number;
  readonly UV_ETXTBSY: number;
  readonly UV_EXDEV: number;
  readonly UV_UNKNOWN: number;
  readonly UV_EOF: number;
  readonly UV_ENXIO: number;
  readonly UV_EMLINK: number;
  readonly UV_EHOSTDOWN: number;
  readonly UV_EREMOTEIO: number;
  readonly UV_ENOTTY: number;
  readonly UV_EFTYPE: number;
  readonly UV_EILSEQ: number;
  readonly UV_ESOCKTNOSUPPORT: number;
  readonly UV_ENODATA: number;
  readonly UV_EUNATCH: number;
  readonly UV_ENOEXEC: number;

  uv_strerror(error: number): string;
}

/**
 * One-shot timers on the libuv loop, the native half of setTimeout and
 * setInterval. JS picks the ids and runs the callbacks; an interval re-arms
 * its timer after each callback, as Node does.
 *
 * A timer can fire just as it is stopped, so onTimeout may still arrive for
 * an id that was stopped: ignore ids you don't know. Starting an armed id again
 * restarts it, but a firing already on its way would still arrive, so use a
 * new id to restart a timer (refresh()).
 *
 * Immediates (setImmediate) run, as in Node, right after the loop's I/O
 * phase: JS keeps the queue and asks for one onImmediate per batch.
 */
// prettier-ignore
export interface NitroNodeTimers extends HybridObject<{ android: 'c++'; ios: 'c++' }> {
  // Properties
  onTimeout: (id: number) => void;
  onImmediate: () => void;

  // Methods
  /** Fires onTimeout(id) once after `delay` milliseconds (truncated, at least 0). */
  start(id: number, delay: number): void;
  /** Cancels the timer; a no-op for an id that already fired or never started. */
  stop(id: number): void;
  /**
   * Fires onImmediate once, after the I/O phase of the loop's current
   * iteration. Calls made before it fires get that same onImmediate.
   */
  scheduleImmediate(): void;
}

export interface NitroNodeDnsInit extends HybridObject<{ android: 'kotlin' }> {
  init(): void;
}

/**
 * The app's folders, for Node's os module. On Android they come from the app's
 * Context, so the implementation is in Kotlin there.
 */
export interface NitroNodeOs
  extends HybridObject<{ ios: 'c++'; android: 'kotlin' }> {
  /** iOS: $TMPDIR. Android: Context.getCacheDir(). */
  tmpdir(): string;
  /** iOS: $HOME, the app's sandbox. Android: the app's data directory. */
  homedir(): string;
}

// prettier-ignore
export interface NitroNodeDns extends HybridObject<{ android: 'c++'; ios: 'c++' }> {
  resolve(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

// prettier-ignore
export interface NitroNodeNet extends HybridObject<{ android: 'c++', ios: 'c++' }> {
  createSocket(): NitroNodeNetSocket;
  createServer(): NitroNodeNetServer;
}

// prettier-ignore
export interface NitroNodeTls extends HybridObject<{ android: 'c++', ios: 'c++' }> {
  createTlsSocket(): NitroNodeTlsSocket;
  createTlsServer(): NitroNodeTlsServer;
  createTlsSecureContext(): NitroNodeTlsSecureContext;
}

/**
 * The platform's values of the fs constants; -1 where the platform has no such
 * constant.
 */
// prettier-ignore
export interface NitroNodeFsConstants extends HybridObject<{ android: 'c++', ios: 'c++' }> {
  readonly O_RDONLY: number;
  readonly O_WRONLY: number;
  readonly O_RDWR: number;
  readonly O_CREAT: number;
  readonly O_EXCL: number;
  readonly O_NOCTTY: number;
  readonly O_TRUNC: number;
  readonly O_APPEND: number;
  readonly O_DIRECTORY: number;
  readonly O_NOATIME: number;
  readonly O_NOFOLLOW: number;
  readonly O_SYNC: number;
  readonly O_DSYNC: number;
  readonly O_SYMLINK: number;
  readonly O_DIRECT: number;
  readonly O_NONBLOCK: number;
  readonly S_IRWXU: number;
  readonly S_IRUSR: number;
  readonly S_IWUSR: number;
  readonly S_IXUSR: number;
  readonly S_IRWXG: number;
  readonly S_IRGRP: number;
  readonly S_IWGRP: number;
  readonly S_IXGRP: number;
  readonly S_IRWXO: number;
  readonly S_IROTH: number;
  readonly S_IWOTH: number;
  readonly S_IXOTH: number;
  readonly F_OK: number;
  readonly R_OK: number;
  readonly W_OK: number;
  readonly X_OK: number;
}

/**
 * File system calls. Calls returning a number give the result (0, a file
 * descriptor, a byte count) or, when they fail, the negated errno, which is
 * also the libuv status of the error. The others throw or reject with an
 * error whose message contains `[errno N]`, N being that same status.
 *
 * A `position` of -1 reads or writes at the file's current offset.
 */
// prettier-ignore
export interface NitroNodeFs extends HybridObject<{ android: 'c++', ios: 'c++' }> {
  open(path: string, flags: number, mode: number): number;
  close(fd: number): number;
  ftruncate(fd: number, length: number): number;

  read(fd: number, length: number, position: number): Promise<ArrayBuffer>;
  readSync(fd: number, buffer: ArrayBuffer, offset: number, length: number, position: number): number;
  write(fd: number, buffer: ArrayBuffer, offset: number, length: number, position: number): Promise<number>;
  writeSync(fd: number, buffer: ArrayBuffer, offset: number, length: number, position: number): number;

  readFile(path: string): Promise<ArrayBuffer>;
  readFileSync(path: string): ArrayBuffer;
  writeFile(path: string, data: ArrayBuffer, offset: number, length: number, flags: number, mode: number): Promise<void>;
  writeFileSync(path: string, data: ArrayBuffer, offset: number, length: number, flags: number, mode: number): number;

  mkdir(path: string, mode: number): number;
  /** mkdir -p. */
  mkdirRecursive(path: string, mode: number): number;
  unlink(path: string): number;
  rmdir(path: string): number;
  /** rm -r: the path and, for a directory, everything in it. */
  rmRecursive(path: string): number;
  access(path: string, mode: number): number;
  /** The names in a directory, without '.' and '..'. */
  readdir(path: string): string[];
  statfs(path: string): StatFs;
}
