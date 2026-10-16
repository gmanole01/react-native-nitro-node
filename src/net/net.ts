import { NitroNet } from '../native';
import { Duplex } from 'readable-stream';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import type { NitroNodeNetServer, NitroNodeNetSocket, SockAddr } from '../native';
import process from 'process';
import { generateWriteId } from '../utils';
import * as dns from '../dns';
import { UV_EOF } from '../uv';
import { uvError } from '../errors';
import { isIP, isIPv4, isIPv6 } from '../ip';
import type {
  AddressInfo,
  BufferEncoding,
  DnsException,
  ErrnoException,
} from '../types';

export { isIP, isIPv4, isIPv6 };
export type { AddressInfo };

/** Node's net.LookupFunction, as called by connect(). */
export type LookupFunction = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (
    err: DnsException | null,
    addresses: dns.LookupAddress[],
  ) => void,
) => void;

/** Node's net.SocketConstructorOpts, the supported part of it. */
export interface SocketConstructorOpts {
  allowHalfOpen?: boolean;
  readable?: boolean;
  writable?: boolean;
}

/** Node's net.TcpSocketConnectOpts, the supported part of it. */
export interface TcpSocketConnectOpts {
  port: number;
  /** Defaults to '127.0.0.1'. */
  host?: string;
  /** 0 (both, the default), 4 or 6: which addresses of `host` to try. */
  family?: number;
  /** Replaces dns.lookup() for resolving `host`. */
  lookup?: LookupFunction;
  /** Calls setNoDelay() on the socket. */
  noDelay?: boolean;
  /** Calls setKeepAlive() on the socket. */
  keepAlive?: boolean;
  keepAliveInitialDelay?: number;
  /** Calls setTimeout() on the socket. */
  timeout?: number;
  /**
   * Milliseconds an attempt to one address of `host` may take before the next
   * is tried. Defaults to 2000, at least 100.
   */
  autoSelectFamilyAttemptTimeout?: number;
}

export type NetConnectOpts = SocketConstructorOpts & TcpSocketConnectOpts;

/** Node's net.ServerOpts, the supported part of it. */
export interface ServerOpts {
  /** Passed on to every accepted socket. */
  allowHalfOpen?: boolean;
  /** Accepted sockets start paused instead of reading. */
  pauseOnConnect?: boolean;
  /** Calls setNoDelay() on every accepted socket. */
  noDelay?: boolean;
  /** Calls setKeepAlive() on every accepted socket. */
  keepAlive?: boolean;
  keepAliveInitialDelay?: number;
}

/** Node's net.ListenOptions, the supported part of it. */
export interface ListenOptions {
  /** 0 or omitted: a free port is chosen. */
  port?: number;
  /** Defaults to '127.0.0.1'. */
  host?: string;
  /** Accepted for compatibility, the native backlog is fixed. */
  backlog?: number;
}

export type SocketReadyState =
  | 'opening'
  | 'open'
  | 'readOnly'
  | 'writeOnly'
  | 'closed';

/** The events of a Socket and their listeners, as in Node. */
export interface SocketEventMap {
  close: (hadError: boolean) => void;
  connect: () => void;
  data: (data: Buffer) => void;
  drain: () => void;
  end: () => void;
  error: (err: ErrnoException) => void;
  lookup: (
    err: DnsException | null,
    address: string | undefined,
    family: number | undefined,
    host: string,
  ) => void;
  ready: () => void;
  timeout: () => void;
}

/** The events of a Server and their listeners, as in Node. */
export interface ServerEventMap {
  close: () => void;
  connection: (socket: Socket) => void;
  error: (err: ErrnoException) => void;
  listening: () => void;
}

// Options only the library passes to the Socket constructor.
interface InternalSocketOpts extends SocketConstructorOpts {
  // an accepted connection, already connected
  _nativeSocket?: NitroNodeNetSocket;
}

type ConnectArgs =
  | [options: NetConnectOpts, connectionListener?: () => void]
  | [port: number, host?: string, connectionListener?: () => void]
  | [port: number, connectionListener?: () => void];

/** Brings the overloaded arguments of connect() into one shape. */
function normalizeConnectArgs(args: ConnectArgs): {
  options: NetConnectOpts;
  listener: (() => void) | undefined;
} {
  const [first, second, third] = args;

  if (typeof first === 'object' && first !== null) {
    return {
      options: { ...first },
      listener: typeof second === 'function' ? second : undefined,
    };
  }

  if (typeof first === 'number') {
    if (typeof second === 'function') {
      // connect(port, connectListener)
      return { options: { port: first }, listener: second };
    }
    // connect(port[, host][, connectListener])
    return {
      options: { port: first, host: second },
      listener: typeof third === 'function' ? third : undefined,
    };
  }

  if (typeof first === 'string') {
    throw new Error('UNIX socket not supported, yet?');
  }
  throw new TypeError('connect() needs a port or an options object');
}

function validatePort(port: unknown, name: string = 'port'): number {
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  ) {
    throw new RangeError(`${name} must be an integer from 0 to 65535`);
  }
  return port;
}

function noop() {}

// Why a connection attempt is being given up on.
enum AttemptOutcome {
  Failed, // native reported an error
  TimedOut, // no answer within the attempt timeout
}

class WrappedDriver {
  private driver: NitroNodeNetSocket;

  // Whether a native handle exists (or is being created) that will report
  // onClose once it is gone. False for a driver that was never connected.
  public open: boolean;

  // Called once by release(), see Socket._nativeSocketReleased.
  private onRelease: (() => void) | null;

  constructor(
    socket: NitroNodeNetSocket,
    open: boolean,
    onRelease: (() => void) | null = null,
  ) {
    this.driver = socket;
    this.open = open;
    this.onRelease = onRelease;
    this._attachListeners();
  }

  public resetEvents() {
    this._onConnect = noop;
    this._onRead = noop;
    this._onWrite = noop;
    this._onClose = noop;
  }

  /**
   * Detaches from the native socket for good.
   *
   * A callback handed to the native object is a GC root for as long as the
   * native object holds it, and the callbacks installed by _attachListeners
   * reference this wrapper, which references the native object. That cycle
   * runs through a root, so it is never collected - and it would keep the
   * owning Socket alive too. Swapping in a shared no-op breaks it.
   */
  public release() {
    this.resetEvents();
    this.open = false;

    const onRelease = this.onRelease;
    this.onRelease = null;
    onRelease?.();

    this.driver.onConnect = noop;
    this.driver.onRead = noop;
    this.driver.onWrite = noop;
    this.driver.onClose = noop;
  }

  private _attachListeners() {
    const self = this;

    function onConnect(status: number) {
      self._onConnect(status);
    }
    function onRead(data: ArrayBuffer, nread: number) {
      self._onRead(data, nread);
    }
    function onWrite(id: number, status: number) {
      self._onWrite(id, status);
    }
    function onClose() {
      self._onClose();
      // the handle is gone, nothing else will ever be reported
      self.release();
    }

    this.driver.onConnect = onConnect;
    this.driver.onRead = onRead;
    this.driver.onWrite = onWrite;
    this.driver.onClose = onClose;
  }

  public _onConnect(status: number) {}
  public _onRead(data: ArrayBuffer, nread: number) {}
  public _onWrite(id: number, status: number) {}
  public _onClose() {}

  public pause() {
    return this.driver.pause();
  }

  public resume() {
    return this.driver.resume();
  }

  public shutdown() {
    return this.driver.shutdown();
  }

  public close() {
    return this.driver.close();
  }

  public getPeerName(): SockAddr | null {
    return this.driver.getPeerName();
  }

  public getSockName(): SockAddr | null {
    return this.driver.getSockName();
  }

  public connect(host: string, port: number) {
    this.open = true;
    return this.driver.connect(host, port);
  }

  public setNoDelay(enable: boolean) {
    return this.driver.setNoDelay(enable);
  }

  public setKeepAlive(enable: boolean, initialDelaySeconds: number) {
    return this.driver.setKeepAlive(enable, initialDelaySeconds);
  }

  public write(id: number, buf: ArrayBuffer) {
    return this.driver.write(id, buf);
  }
}

function wrapSocketDriver(socket: NitroNodeNetSocket) {
  return new WrappedDriver(socket, true);
}

// How long a connection attempt may take, in milliseconds, before the next
// address of the host is tried. The option has Node's name
// (autoSelectFamilyAttemptTimeout) but not its values: Node's 250ms default
// suits wired networks. On a mobile link a handshake alone can take several
// hundred milliseconds, and a lost first packet is only resent after about a
// second, so the default leaves room for one resend. Both values are the
// limits RFC 8305 (Happy Eyeballs) recommends for this delay.
const DEFAULT_CONNECT_ATTEMPT_TIMEOUT = 2000;
const MIN_CONNECT_ATTEMPT_TIMEOUT = 100;

function lookupAndConnect(
  self: Socket,
  options: TcpSocketConnectOpts & { host: string },
) {
  const { host, port } = options;

  // 0 asks for both IPv4 and IPv6 addresses, sorted by the resolver so that
  // the ones this device can actually reach come first.
  const family = options.family ?? 0;

  // Like Node, a custom function can replace the DNS lookup. It is called as
  // lookup(host, { all: true, family }, callback) and has to answer with a
  // list of { address, family }.
  const lookup: LookupFunction = options.lookup ?? dns.lookup;

  // A custom lookup may answer synchronously, inside connect(). Its answer is
  // then handled on the next tick, so that listeners attached after connect()
  // returns still get 'lookup' and 'error'.
  let synchronous = true;
  lookup(host, { all: true, family }, (err, addresses) => {
    if (synchronous) {
      process.nextTick(onLookup, err, addresses);
    } else {
      onLookup(err, addresses);
    }
  });
  synchronous = false;

  function onLookup(
    err: DnsException | null,
    addresses: dns.LookupAddress[],
  ) {
    if (self.destroyed) {
      // destroyed while resolving, _destroy already cleaned up
      return;
    }

    const first = addresses?.[0];
    self.emit('lookup', err, first?.address, first?.family, host);

    if (err || !first) {
      // keeps the code (ENOTFOUND, ETIMEOUT, ...) of the failed lookup
      self._failConnect(err ?? new Error(`No address found for ${host}`));
      return;
    }

    self._startConnecting(
      addresses.map((item) => item.address),
      port,
      Math.max(
        MIN_CONNECT_ATTEMPT_TIMEOUT,
        options.autoSelectFamilyAttemptTimeout ??
          DEFAULT_CONNECT_ATTEMPT_TIMEOUT,
      ),
    );
  }
}

// Typed event listeners, declared only (they are EventEmitter's methods).
interface Socket {
  on<E extends keyof SocketEventMap>(event: E, listener: SocketEventMap[E]): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once<E extends keyof SocketEventMap>(event: E, listener: SocketEventMap[E]): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  addListener<E extends keyof SocketEventMap>(event: E, listener: SocketEventMap[E]): this;
  addListener(event: string | symbol, listener: (...args: any[]) => void): this;
  prependListener<E extends keyof SocketEventMap>(event: E, listener: SocketEventMap[E]): this;
  prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
  prependOnceListener<E extends keyof SocketEventMap>(event: E, listener: SocketEventMap[E]): this;
  prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
}

class Socket extends Duplex {
  protected _nativeSocket: WrappedDriver | null = null;

  protected _connected: boolean = false;
  /** True while connect() has been called and the connection is not up yet. */
  public connecting: boolean = false;

  protected _needsDrain: boolean = false;

  protected _hasError: boolean = false;

  // Writes/_final calls queued while connecting. Flushed on 'connect' and
  // failed on 'error'/'close'. A single guarded listener set is armed for the
  // whole connecting phase, so queued ops never accumulate per-op listeners.
  protected _pendingConnectOps: Array<(err: Error | null) => void> = [];
  protected _connectOpsArmed: boolean = false;
  private _connectOpListener:
    | {
        onConnect: () => void;
        onError: (err: Error) => void;
        onClose: () => void;
      }
    | undefined;

  // Writes currently in flight toward the native socket, keyed by write id.
  // A single armed 'write'/'error'/'close' listener set resolves them all, so a
  // write whose 'write' event never arrives is still failed and released on the
  // socket's first terminal event instead of being retained forever.
  protected _pendingWrites: Map<number, (err: Error | null) => void> =
    new Map();
  private _writeGuardsArmed: boolean = false;
  private _writeGuardListeners:
    | {
        onWrite: (id: number, status: number) => void;
        onError: (err: Error) => void;
        onClose: () => void;
      }
    | undefined;

  public _debug: boolean = false;

  public localAddress: string | undefined = undefined;
  public localPort: number | undefined = undefined;

  public remoteAddress: string | undefined = undefined;
  public remotePort: number | undefined = undefined;

  public bytesRead: number = 0;
  public bytesWritten: number = 0;

  public timeout: number | undefined = undefined;
  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  private _closeScheduled: boolean = false;

  // Addresses of the host that have not been tried yet, see _connectNext.
  private _connectAddresses: string[] = [];
  private _connectPort: number = 0;
  private _connectAttemptTimeout: number = DEFAULT_CONNECT_ATTEMPT_TIMEOUT;
  private _connectAttemptTimer: ReturnType<typeof setTimeout> | null = null;

  // Options set through setNoDelay/setKeepAlive, kept so they can be given to
  // a native socket that is created later.
  private _noDelay: boolean | null = null;
  private _keepAlive: { enable: boolean; delaySeconds: number } | null = null;

  constructor(options?: SocketConstructorOpts) {
    super({
      allowHalfOpen: options?.allowHalfOpen ?? false,
      readable: options?.readable ?? true,
      writable: options?.writable ?? true,
      // 'close' is emitted by this class, see _scheduleClose
      autoDestroy: false,
      emitClose: false,
    });

    const nativeSocket = (options as InternalSocketOpts | undefined)
      ?._nativeSocket;
    if (nativeSocket) {
      this._nativeSocket = wrapSocketDriver(nativeSocket);

      this._connected = true;
      this.connecting = false;
    }

    if (this._nativeSocket) {
      // this is initialized by the server
      this._attachListeners();
    }
  }

  get readyState(): SocketReadyState {
    if (this.connecting) {
      return 'opening';
    }
    if (this._connected) {
      if (this.writable && this.readable) {
        return 'open';
      }
      if (this.writable) {
        return 'writeOnly';
      }
      if (this.readable) {
        return 'readOnly';
      }
    }
    return 'closed';
  }

  get pending(): boolean {
    return !this._connected;
  }

  get localFamily(): 'IPv4' | 'IPv6' | undefined {
    if (!this.localAddress) {
      return undefined;
    }
    if (this.localAddress.includes(':')) {
      return 'IPv6';
    }
    return 'IPv4';
  }

  get remoteFamily(): 'IPv4' | 'IPv6' | undefined {
    if (!this.remoteAddress) {
      return undefined;
    }
    if (this.remoteAddress.includes(':')) {
      return 'IPv6';
    }
    return 'IPv4';
  }

  _attachListeners() {
    if (!this._nativeSocket) {
      // no native socket, nothing to attach
      return;
    }

    this._nativeSocket._onConnect = this._onConnect.bind(this);
    this._nativeSocket._onRead = this._onRead.bind(this);
    this._nativeSocket._onWrite = this._onWrite.bind(this);
    this._nativeSocket._onClose = this._onClose.bind(this);
  }

  /**
   * Queue an operation that must wait for the connection to be established.
   * Instead of one 'connect'/'error' listener pair per queued operation (which
   * leaks if the connection stalls), a single armed set is torn down as soon as
   * the connecting phase resolves one way or the other.
   */
  protected _queueConnectOp(op: (err: Error | null) => void) {
    if (this._connected) {
      // Already connected: no future 'connect' event will arrive, so run the
      // operation immediately instead of arming listeners that would leak.
      op(null);
      return;
    }

    this._pendingConnectOps.push(op);

    if (this._connectOpsArmed) {
      return;
    }
    this._connectOpsArmed = true;

    const onConnect = () => {
      this._flushConnectOps(null);
    };
    const onError = (err: Error) => {
      this._flushConnectOps(err);
    };
    const onClose = () => {
      this._flushConnectOps(
        new Error('Socket closed before connection was established'),
      );
    };

    this._connectOpListener = { onConnect, onError, onClose };

    this.once('connect', onConnect);
    this.once('error', onError);
    this.once('close', onClose);
  }

  private _flushConnectOps(err: Error | null) {
    if (!this._connectOpsArmed) {
      return;
    }
    this._connectOpsArmed = false;

    if (this._connectOpListener) {
      this.removeListener('connect', this._connectOpListener.onConnect);
      this.removeListener('error', this._connectOpListener.onError);
      this.removeListener('close', this._connectOpListener.onClose);
      this._connectOpListener = undefined;
    }

    const pending = this._pendingConnectOps;
    this._pendingConnectOps = [];

    for (const op of pending) {
      op(err);
    }
  }

  /**
   * Registers a pending write with the shared registry and arms the single
   * 'write'/'error'/'close' guard set for this socket. Returns false if the
   * socket can no longer accept writes (in which case the caller must not call
   * into the native socket).
   */
  public _registerPendingWrite(
    id: number,
    cb: (err: Error | null) => void,
  ): boolean {
    if (this.destroyed || !this.writable) {
      return false;
    }

    this._pendingWrites.set(id, cb);

    if (this._writeGuardsArmed) {
      return true;
    }
    this._writeGuardsArmed = true;

    const onWrite = (eventId: number, status: number) => {
      const pendingCb = this._pendingWrites.get(eventId);
      if (!pendingCb) {
        // not for us (already failed/removed)
        return;
      }
      this._pendingWrites.delete(eventId);

      if (this._debug) {
        console.log('got onWrite for id ' + eventId + ' with status ' + status);
      }

      if (status < 0) {
        pendingCb(uvError('write', status));
      } else {
        pendingCb(null);
      }

      this._disarmWriteGuardsIfEmpty();
    };
    const onError = (err: Error) => {
      this._failPendingWrites(err);
    };
    const onClose = () => {
      this._failPendingWrites(new Error('Socket closed'));
    };

    this._writeGuardListeners = { onWrite, onError, onClose };

    this.on('write', onWrite);
    this.on('error', onError);
    this.on('close', onClose);

    return true;
  }

  private _failPendingWrites(err: Error) {
    if (this._pendingWrites.size === 0) {
      return;
    }

    const pending = this._pendingWrites;
    this._pendingWrites = new Map();

    for (const pendingCb of pending.values()) {
      pendingCb(err);
    }

    this._disarmWriteGuards();
  }

  private _disarmWriteGuardsIfEmpty() {
    if (this._pendingWrites.size > 0) {
      return;
    }
    this._disarmWriteGuards();
  }

  private _disarmWriteGuards() {
    if (!this._writeGuardsArmed) {
      return;
    }
    this._writeGuardsArmed = false;

    if (this._writeGuardListeners) {
      this.removeListener('write', this._writeGuardListeners.onWrite);
      this.removeListener('error', this._writeGuardListeners.onError);
      this.removeListener('close', this._writeGuardListeners.onClose);
      this._writeGuardListeners = undefined;
    }
  }

  /**
   * Drops the native socket and its callbacks. Nothing native is reported
   * after this, so whoever calls it is responsible for emitting 'close'.
   */
  private _releaseNative() {
    if (this._nativeSocket) {
      this._nativeSocket.release();
      this._nativeSocket = null;
    }
  }

  /** Emits 'close' on the next tick, at most once per socket. */
  private _scheduleClose() {
    if (this._closeScheduled) {
      return;
    }
    this._closeScheduled = true;

    process.nextTick(() => {
      this.emit('close', this._hasError);
    });
  }

  /**
   * The connection attempt is over and failed: tear the socket down like any
   * other dead socket ('error', then 'close') so nothing waiting on either
   * event is left hanging.
   */
  _failConnect(err: Error) {
    this._clearConnectAttemptTimer();
    this._releaseNative();
    this._hasError = true;

    this._connected = false;
    this.connecting = false;

    if (this.destroyed) {
      // destroyed while connecting; the error is of no interest anymore
      this._scheduleClose();
      return;
    }

    // With the native socket gone, _destroy schedules 'close' itself.
    this.destroy();
    this.emit('error', err);
  }

  /** Starts connecting to `addresses` in turn, see _connectNext. */
  _startConnecting(addresses: string[], port: number, attemptTimeout: number) {
    this._connectAddresses = addresses;
    this._connectPort = port;
    this._connectAttemptTimeout = attemptTimeout;
    this._connectNext();
  }

  /**
   * Starts a connection attempt to the next address of the host. A host can
   * have several (IPv6 and IPv4, or more than one server); they are tried in
   * order until one accepts the connection.
   */
  _connectNext() {
    const address = this._connectAddresses.shift() as string;
    const port = this._connectPort;

    this._nativeSocket!.connect(address, port);

    if (this._connectAddresses.length > 0) {
      // An address that never answers would hold up the ones after it for as
      // long as the system keeps trying, which can be over a minute. The last
      // address gets no limit: there is nothing left to fall back to.
      this._connectAttemptTimer = setTimeout(() => {
        this._connectAttemptTimer = null;
        if (this.destroyed || !this.connecting) {
          return;
        }
        this._retryConnect(AttemptOutcome.TimedOut);
      }, this._connectAttemptTimeout);
    }
  }

  private _clearConnectAttemptTimer() {
    if (this._connectAttemptTimer) {
      clearTimeout(this._connectAttemptTimer);
      this._connectAttemptTimer = null;
    }
  }

  /**
   * Gives up on the current connection attempt and starts one to the next
   * address. A native socket connects only once, so each attempt gets its own.
   */
  private _retryConnect(outcome: AttemptOutcome) {
    this._clearConnectAttemptTimer();

    const previous = this._nativeSocket;
    if (previous) {
      // Released first, so that whatever the abandoned socket still reports
      // (its failure, its close) is not mistaken for the end of this Socket.
      previous.release();
      if (outcome === AttemptOutcome.TimedOut) {
        // still connecting: a failed attempt has closed its handle already
        previous.close();
      }
    }

    this._nativeSocket = this._createSocketDriver();
    this._attachListeners();
    this._applySocketOptions();
    this._connectNext();
  }

  private _applySocketOptions() {
    if (!this._nativeSocket) {
      return;
    }
    if (this._noDelay !== null) {
      this._nativeSocket.setNoDelay(this._noDelay);
    }
    if (this._keepAlive !== null) {
      this._nativeSocket.setKeepAlive(
        this._keepAlive.enable,
        this._keepAlive.delaySeconds,
      );
    }
  }

  setNoDelay(noDelay: boolean = true): this {
    this._noDelay = noDelay;
    this._applySocketOptions();
    return this;
  }

  /** `initialDelay` is in milliseconds, 0 keeps the system's default. */
  setKeepAlive(enable: boolean = false, initialDelay: number = 0): this {
    this._keepAlive = {
      enable,
      delaySeconds: Math.max(0, Math.floor(initialDelay / 1000)),
    };
    this._applySocketOptions();
    return this;
  }

  _onConnect(status: number) {
    if (status < 0) {
      if (this._connectAddresses.length > 0 && !this.destroyed) {
        this._retryConnect(AttemptOutcome.Failed);
        return;
      }

      this._failConnect(uvError('connect', status));
      return;
    }

    this._clearConnectAttemptTimer();
    this._connectAddresses = [];

    this._connected = true;
    this.connecting = false;

    // update address
    this._updateAddresses();

    this.emit('connect');
    this.emit('ready');

    // resume after emitting the event
    // maybe we get "pause"
    this.resume();
  }

  _handleReadData(data: Buffer) {
    if (!this.push(data)) {
      // The stream's buffer is full: stop reading until _read asks for more.
      this._nativeSocket?.pause();
    }
  }

  _onRead(data: ArrayBuffer, nread: number) {
    const self = this;

    if (nread > 0) {
      if (data && data.byteLength > 0) {
        const buffer = Buffer.from(data);
        self.bytesRead += buffer.length;

        self._refreshTimeout();
        self._handleReadData(buffer);
      }
      return;
    }

    if (nread === 0) {
      return;
    }

    if (nread < 0) {
      if (nread !== UV_EOF) {
        self.destroy(uvError('read', nread));
        return;
      }

      // EOF
      // Defer this until we actually emit end
      if (self._readableState.endEmitted) {
        self._destroyAfterEnd();
      } else {
        self.once('end', () => {
          self._destroyAfterEnd();
        });

        // Push a null to signal the end of data.
        // Do it before `maybeDestroy` for correct order of events:
        // `end` -> `close`
        self.push(null);
      }

      return;
    }
  }

  /**
   * The peer has ended its side. Without allowHalfOpen that ends the socket.
   * With it, this side may go on writing: the socket is destroyed once it
   * has been ended too and everything is written.
   */
  _destroyAfterEnd() {
    if (!this.allowHalfOpen || this.writableFinished) {
      this.destroy();
      return;
    }
    this.once('finish', () => this.destroy());
  }

  _onWrite(id: number, status: number) {
    this.emit('write', id, status);
  }

  _onClose() {
    this._connected = false;
    this.connecting = false;

    this._releaseNative();
    this._clearTimeout();

    if (!this.destroyed) {
      // the handle went away without destroy() being called
      this.destroy();
    }

    this._scheduleClose();
  }

  _updateAddresses() {
    const local = this._nativeSocket?.getSockName();
    this.localAddress = local?.ip;
    this.localPort = local?.port;

    const peer = this._nativeSocket?.getPeerName();
    this.remoteAddress = peer?.ip;
    this.remotePort = peer?.port;
  }

  /** The local end of the connection, or {} when there is none. */
  address(): AddressInfo | {} {
    if (
      this.localAddress === undefined ||
      this.localPort === undefined ||
      this.localFamily === undefined
    ) {
      return {};
    }
    return {
      address: this.localAddress,
      family: this.localFamily,
      port: this.localPort,
    };
  }

  /** No-op: there is no event loop for a socket to keep alive. */
  ref(): this {
    return this;
  }

  /** No-op: there is no event loop for a socket to keep alive. */
  unref(): this {
    return this;
  }

  /** Ends the socket, then destroys it once everything has been written. */
  destroySoon(): void {
    if (this.writable) {
      this.end();
    }
    if (this.writableFinished) {
      this.destroy();
    } else {
      this.once('finish', () => this.destroy());
    }
  }

  _read(): void {
    // The stream wants more data. Only restart the native reads: calling
    // resume() here would force flowing mode and undo a pause().
    this._nativeSocket?.resume();
  }

  _write(
    chunk: Buffer | Uint8Array | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const self = this;

    if (!this._nativeSocket) {
      return callback(new Error('Native socket not initialized'));
    }

    if (!this._connected && this.connecting) {
      this._queueConnectOp((err) => {
        if (err) {
          return callback(err);
        }
        this._write(chunk, encoding, callback);
      });
      return;
    }

    const buffer =
      typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk);
    if (!buffer.length) {
      return callback(null);
    }

    this._refreshTimeout();

    // assign id
    const id = generateWriteId();

    if (
      !this._registerPendingWrite(id, (err) => {
        if (err) {
          return callback(err);
        }

        self.bytesWritten += buffer.length;

        return callback();
      })
    ) {
      return callback(new Error('Socket is closed or not writable'));
    }

    const ab: ArrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;

    this._nativeSocket.write(id, ab);

    if (this._debug) {
      console.log(
        'doWrite id ' + id + ', pending writes: ' + this._pendingWrites.size,
      );
    }
  }

  _final(callback: (error?: Error | null) => void): void {
    if (!this._nativeSocket) {
      return callback(null);
    }
    if (!this._connected && this.connecting) {
      this._queueConnectOp((err) => {
        if (err) {
          // Preserve the original behavior: _final completes cleanly on a
          // failed connection instead of surfacing the connect error.
          return callback(null);
        }
        this._final(callback);
      });
      return;
    }

    if (this._nativeSocket) {
      this._nativeSocket.shutdown();
    }

    callback(null);
  }

  _destroy(err: Error | null, callback: (error: Error | null) => void): void {
    this._connected = false;
    this.connecting = false;
    if (err) {
      this._hasError = true;
    }

    // The native socket is going away now, so no remaining 'write' events can
    // resolve in-flight writes. Fail them to release their payloads/callbacks.
    this._failPendingWrites(err ?? new Error('Socket destroyed'));

    this._clearTimeout();
    this._clearConnectAttemptTimer();

    if (this._nativeSocket?.open) {
      // destroy actually closes the tcp handle in libuv; 'close' is emitted
      // once the native side reports it through _onClose
      this._nativeSocket.close();
    } else {
      // No handle to wait for (never connected, or already gone): nothing
      // native will report back, so finish here.
      this._releaseNative();
      this._scheduleClose();
    }

    callback(err);
  }

  destroy(err?: Error, callback?: (error: Error | null) => void): this {
    return super.destroy(err, callback);
  }

  pause(): this {
    super.pause();
    if (this._nativeSocket) {
      this._nativeSocket.pause();
    }
    return this;
  }

  resume(): this {
    super.resume();
    if (this._nativeSocket) {
      this._nativeSocket.resume();
    }
    return this;
  }

  /**
   * Creates the native socket for a connection attempt (each attempt gets a
   * new one). tls overrides it to create a TLS socket instead.
   */
  protected _createNativeSocket(): NitroNodeNetSocket {
    return NitroNet.createSocket();
  }

  /**
   * The native socket of an attempt is dropped for good, see
   * WrappedDriver.release(). An override releases what it attached itself.
   */
  protected _nativeSocketReleased(_socket: NitroNodeNetSocket): void {}

  private _createSocketDriver(): WrappedDriver {
    const socket = this._createNativeSocket();
    return new WrappedDriver(socket, false, () =>
      this._nativeSocketReleased(socket),
    );
  }

  /**
   * Opens the connection. `host` defaults to '127.0.0.1'; a host name is
   * resolved and each of its addresses tried in turn.
   */
  connect(options: NetConnectOpts, connectionListener?: () => void): this;
  connect(port: number, host?: string, connectionListener?: () => void): this;
  connect(port: number, connectionListener?: () => void): this;
  connect(...args: ConnectArgs): this {
    if (this._nativeSocket) {
      return this;
    }

    if (this._connected || this.connecting) {
      return this;
    }

    const { options, listener } = normalizeConnectArgs(args);
    const port = validatePort(options.port);
    const host = options.host || '127.0.0.1';

    this.connecting = true;

    if (listener) {
      this.on('connect', listener);
    }

    if (options.noDelay) {
      this.setNoDelay(true);
    }
    if (options.keepAlive) {
      this.setKeepAlive(true, options.keepAliveInitialDelay);
    }
    if (options.timeout !== undefined) {
      this.setTimeout(options.timeout);
    }

    // init the connect here
    this._nativeSocket = this._createSocketDriver();

    // attach listeners
    this._attachListeners();
    this._applySocketOptions();

    lookupAndConnect(this, { ...options, host, port });

    return this;
  }

  /**
   * Emits 'timeout' after `timeout` milliseconds without reads or writes. It
   * only notifies: the socket stays open. 0 disables it.
   */
  setTimeout(timeout: number, callback?: () => void): this {
    this.timeout = timeout > 0 ? timeout : undefined;

    if (callback) {
      if (timeout > 0) {
        this.once('timeout', callback);
      } else {
        this.removeListener('timeout', callback);
      }
    }

    this._refreshTimeout();

    return this;
  }

  private _clearTimeout() {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
  }

  /** (Re)starts the inactivity timer; called on every read and write. */
  private _refreshTimeout() {
    this._clearTimeout();

    if (!this.timeout || this.destroyed) {
      return;
    }

    this._timeoutTimer = setTimeout(() => {
      this._timeoutTimer = null;
      // like node: only notify, the listener decides whether to destroy
      this.emit('timeout');
    }, this.timeout);
  }
}

// Typed event listeners, declared only (they are EventEmitter's methods).
interface Server {
  on<E extends keyof ServerEventMap>(event: E, listener: ServerEventMap[E]): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once<E extends keyof ServerEventMap>(event: E, listener: ServerEventMap[E]): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  addListener<E extends keyof ServerEventMap>(event: E, listener: ServerEventMap[E]): this;
  addListener(event: string | symbol, listener: (...args: any[]) => void): this;
  prependListener<E extends keyof ServerEventMap>(event: E, listener: ServerEventMap[E]): this;
  prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
  prependOnceListener<E extends keyof ServerEventMap>(event: E, listener: ServerEventMap[E]): this;
  prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
}

class Server extends EventEmitter {
  private _server: NitroNodeNetServer;
  private _options: ServerOpts;
  private _sockets: Set<Socket> = new Set<Socket>();
  private _connections: number = 0;
  private _listening: boolean = false;

  // pending actions
  private _listenPending: boolean = false;
  private _closePending: boolean = false;

  constructor(connectionListener?: (socket: Socket) => void);
  constructor(
    options?: ServerOpts,
    connectionListener?: (socket: Socket) => void,
  );
  constructor(
    options?: ServerOpts | ((socket: Socket) => void),
    connectionListener?: (socket: Socket) => void,
  ) {
    if (typeof options === 'function') {
      connectionListener = options;
      options = {};
    }

    super();

    this._options = { ...options };
    this._server = NitroNet.createServer();

    // The native callbacks are attached in listen() and detached once the
    // server is closed, see _detachListeners.

    if (connectionListener) {
      this.on('connection', connectionListener);
    }
  }

  /**
   * A callback handed to the native server is a GC root for as long as the
   * native object holds it, and those callbacks reference this Server, which
   * references the native object. Swapping in a shared no-op whenever the
   * server is not listening breaks that cycle so a closed server can be
   * collected.
   */
  _detachListeners() {
    this._server.onListening = noop;
    this._server.onConnection = noop;
    this._server.onClose = noop;
  }

  _attachListeners() {
    const self = this;

    this._server.onListening = (status: number) => {
      if (status < 0) {
        // the attempt is over, allow listen() to be called again
        self._listenPending = false;
        self._detachListeners();
        this.emit('error', uvError('listen', status));
        return;
      }

      if (!self._listenPending) {
        // We got "onListening" but no listen was pending, abort
        return;
      }

      self._listenPending = false;
      self._listening = true;

      self.emit('listening');
    };
    this._server.onConnection = (socket, status) => {
      if (status != 0) {
        // If native could not go on accepting it also closes the listener,
        // and 'close' follows this error.
        this.emit('error', uvError('accept', status));
        return;
      }

      const nativeSocket = socket!;

      const socketOptions: InternalSocketOpts = {
        _nativeSocket: nativeSocket,
        allowHalfOpen: self._options.allowHalfOpen,
      };
      const jsSocket = new Socket(socketOptions);

      jsSocket._updateAddresses();
      if (self._options.noDelay) {
        jsSocket.setNoDelay(true);
      }
      if (self._options.keepAlive) {
        jsSocket.setKeepAlive(true, self._options.keepAliveInitialDelay);
      }

      this._sockets.add(jsSocket);
      this._connections++;

      jsSocket.once('close', () => {
        this._sockets.delete(jsSocket);
        this._connections--;
      });

      this.emit('connection', jsSocket);

      /**
       * Proof of concept:
       *
       * if (!jsSocket._pauseCalled && !jsSocket._resumeCalled) {
       *   // if the user did not call pause or resume in the event, we assume he wants to read the data
       *   // otherwise, he should've called pause
       *   jsSocket.resume();
       * }
       */

      if (!self._options.pauseOnConnect) {
        // start reading data
        jsSocket.resume();
      }
    };
    this._server.onClose = () => {
      // no longer listening, allow listen() to be called again
      self._listening = false;
      self._listenPending = false;
      self._detachListeners();
      this.emit('close');
    };
  }

  /**
   * Starts accepting connections. `port` 0 or omitted picks a free port, and
   * `host` defaults to '127.0.0.1'. `backlog` is accepted for compatibility
   * but has no effect. Calling it while listening does nothing.
   */
  listen(
    port?: number,
    hostname?: string,
    backlog?: number,
    listeningListener?: () => void,
  ): this;
  listen(
    port?: number,
    hostname?: string,
    listeningListener?: () => void,
  ): this;
  listen(
    port?: number,
    backlog?: number,
    listeningListener?: () => void,
  ): this;
  listen(port?: number, listeningListener?: () => void): this;
  listen(options: ListenOptions, listeningListener?: () => void): this;
  listen(...args: unknown[]): this {
    let port: unknown = 0;
    let host: string | undefined;
    let callback: (() => void) | undefined;

    const [first, ...rest] = args;
    if (typeof first === 'object' && first !== null) {
      const options = first as ListenOptions;
      port = options.port ?? 0;
      host = options.host;
    } else if (typeof first === 'function') {
      // listen(callback): any port
      callback = first as () => void;
    } else if (first != null) {
      port = first;
    }
    for (const arg of rest) {
      if (typeof arg === 'function') {
        callback = arg as () => void;
      } else if (typeof arg === 'string') {
        host = arg;
      }
      // a number is the backlog, which is ignored
    }

    const validPort = validatePort(port);

    if (this._listening || this._listenPending) {
      // already listening
      return this;
    }

    if (callback) {
      // once: the server can listen again later with a different callback
      this.once('listening', callback);
    }

    this._listenPending = true;
    this._attachListeners();
    this._server.listen(host || '127.0.0.1', validPort);
    return this;
  }

  close(callback?: (err?: Error) => void): this {
    if (!this._listening && !this._listenPending) {
      // nothing native to close, so no 'close' event will ever arrive
      if (callback) {
        process.nextTick(callback, new Error('Server is not running'));
      }
      return this;
    }

    // Destroy all active connections first. Each one removes itself from
    // _sockets and decrements _connections in its own 'close' handler.
    for (const socket of Array.from(this._sockets)) {
      socket.destroy();
    }

    this._server.close();

    if (callback) {
      this.once('close', callback);
    }

    return this;
  }

  /** Where the server listens, or null when it does not. */
  address(): AddressInfo | null {
    try {
      const addr = this._server.getSockName();
      if (addr) {
        const port = addr.port;
        const ip = addr.ip;
        const address = ip.replace(/[\[\]]/g, '');
        const family = address.includes(':') ? 'IPv6' : 'IPv4';
        return { port, family, address };
      }
    } catch (e) {
      // Ignore
    }
    return null;
  }

  getConnections(cb: (err: Error | null, count: number) => void): void {
    cb(null, this._connections);
  }
}

/** Creates a Socket and connects it; see Socket.connect. */
function connect(
  options: NetConnectOpts,
  connectionListener?: () => void,
): Socket;
function connect(
  port: number,
  host?: string,
  connectionListener?: () => void,
): Socket;
function connect(port: number, connectionListener?: () => void): Socket;
function connect(...args: ConnectArgs): Socket {
  const [first] = args;
  const socket = new Socket(
    typeof first === 'object' && first !== null ? first : undefined,
  );
  return socket.connect(...(args as [NetConnectOpts]));
}

/** Creates a Server; see the Server constructor. */
function createServer(connectionListener?: (socket: Socket) => void): Server;
function createServer(
  options?: ServerOpts,
  connectionListener?: (socket: Socket) => void,
): Server;
function createServer(
  options?: ServerOpts | ((socket: Socket) => void),
  connectionListener?: (socket: Socket) => void,
): Server {
  return new Server(options as ServerOpts, connectionListener);
}

export { Server, Socket, createServer, connect, connect as createConnection };
