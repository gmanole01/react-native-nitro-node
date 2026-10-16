import { Socket, isIP } from '../net';
import type { SocketEventMap, TcpSocketConnectOpts } from '../net';
import { NitroTls } from '../native';
import type { NitroNodeNetSocket, NitroNodeTlsSocket } from '../native';
import type { ErrnoException } from '../types';

// The native handshake's message when TCP closed before it finished; Node
// reports it with this code.
const DISCONNECTED_MESSAGE =
  'Client network socket disconnected before secure TLS connection was established';

function noop() {}

/** Node's tls.TLSSocketOptions, the supported part of it. */
export interface TLSSocketOptions {
  /** Sent as SNI, and the name the server's certificate has to match. */
  servername?: string;
  /**
   * Fail when the server's certificate can't be verified against the system's
   * trust store. Defaults to true.
   */
  rejectUnauthorized?: boolean;
  /** ALPN protocols to offer, most preferred first. */
  ALPNProtocols?: string[];
  allowHalfOpen?: boolean;
}

/** Node's tls.ConnectionOptions, the supported part of it. */
export interface ConnectionOptions
  extends Omit<TcpSocketConnectOpts, 'port'>,
    TLSSocketOptions {
  port?: number;
}

/** The events of a TLSSocket: a Socket's, plus 'secureConnect'. */
export interface TLSSocketEventMap extends SocketEventMap {
  /** The TLS handshake has completed. */
  secureConnect: () => void;
}

// Typed event listeners, declared only (they are EventEmitter's methods).
export interface TLSSocket {
  on<E extends keyof TLSSocketEventMap>(
    event: E,
    listener: TLSSocketEventMap[E],
  ): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once<E extends keyof TLSSocketEventMap>(
    event: E,
    listener: TLSSocketEventMap[E],
  ): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  addListener<E extends keyof TLSSocketEventMap>(
    event: E,
    listener: TLSSocketEventMap[E],
  ): this;
  addListener(event: string | symbol, listener: (...args: any[]) => void): this;
  prependListener<E extends keyof TLSSocketEventMap>(
    event: E,
    listener: TLSSocketEventMap[E],
  ): this;
  prependListener(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this;
  prependOnceListener<E extends keyof TLSSocketEventMap>(
    event: E,
    listener: TLSSocketEventMap[E],
  ): this;
  prependOnceListener(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this;
}

/**
 * A TLS client socket. The encryption is native (OpenSSL): the socket
 * underneath only ever hands this class plaintext, so reading, writing,
 * ending and closing all work as on a net.Socket.
 *
 * 'connect' is emitted when TCP is up, 'secureConnect' when the handshake is
 * done. Data written before that is sent after it.
 */
export class TLSSocket extends Socket {
  /** Always true, to tell it from a net.Socket. */
  public readonly encrypted = true;

  /**
   * Whether the server's certificate was verified. Only ever true with
   * rejectUnauthorized: without it nothing is checked.
   */
  public authorized: boolean = false;

  /** The protocol the server chose with ALPN, false if none. Null until secure. */
  public alpnProtocol: string | false | null = null;

  /** The name sent as SNI, undefined if none. */
  public readonly servername: string | undefined;

  private readonly _rejectUnauthorized: boolean;
  private readonly _ALPNProtocols: string[] | undefined;

  // The TLS socket of the current connection attempt.
  private _tlsHandle: NitroNodeTlsSocket | null = null;

  constructor(socket?: Socket, options?: TLSSocketOptions) {
    super({ allowHalfOpen: options?.allowHalfOpen });

    if (socket) {
      throw new Error(
        'TLS on top of an existing socket is not supported yet: use tls.connect()',
      );
    }

    // Like Node: no SNI for an IP address. Its certificate is then only
    // checked for its chain, not for the address.
    const servername = options?.servername;
    this.servername = servername && !isIP(servername) ? servername : undefined;
    this._rejectUnauthorized = options?.rejectUnauthorized ?? true;
    this._ALPNProtocols = options?.ALPNProtocols;
  }

  protected _createNativeSocket(): NitroNodeNetSocket {
    const handle = NitroTls.createTlsSocket();
    handle.onSecure = (error) => this._onSecure(handle, error);
    handle.startTls({
      servername: this.servername,
      ALPNProtocols: this._ALPNProtocols,
      rejectUnauthorized: this._rejectUnauthorized,
    });
    this._tlsHandle = handle;
    // The same members as a net socket: the base class drives it unchanged.
    return handle;
  }

  protected _nativeSocketReleased(socket: NitroNodeNetSocket): void {
    // Like the callbacks WrappedDriver clears: one left on the native object
    // would keep this socket alive.
    const handle = socket as unknown as NitroNodeTlsSocket;
    handle.onSecure = noop;
    if (this._tlsHandle === handle) {
      this._tlsHandle = null;
    }
  }

  private _onSecure(handle: NitroNodeTlsSocket, error: string | undefined) {
    if (handle !== this._tlsHandle || this.destroyed) {
      // an abandoned connection attempt
      return;
    }

    if (error !== undefined) {
      const err: ErrnoException = new Error(error);
      if (error === DISCONNECTED_MESSAGE) {
        err.code = 'ECONNRESET';
      }
      this.destroy(err);
      return;
    }

    this.authorized = this._rejectUnauthorized;
    this.alpnProtocol = handle.getAlpnProtocol() ?? false;
    this.emit('secureConnect');
  }
}

/** Not implemented yet. */
export class Server {}

/**
 * Opens a TLS connection. `callback` is called on 'secureConnect'. `host`
 * defaults to '127.0.0.1', and is the servername unless one is given.
 */
export function connect(
  options: ConnectionOptions,
  callback?: () => void,
): TLSSocket;
export function connect(port: number, callback?: () => void): TLSSocket;
export function connect(
  port: number,
  host?: string,
  callback?: () => void,
): TLSSocket;
export function connect(
  port: number,
  host?: string,
  options?: ConnectionOptions,
  callback?: () => void,
): TLSSocket;
export function connect(
  portOrOptions: number | ConnectionOptions,
  ...rest: Array<string | ConnectionOptions | (() => void) | undefined>
): TLSSocket {
  let options: ConnectionOptions;
  let callback: (() => void) | undefined;

  if (typeof portOrOptions === 'object' && portOrOptions !== null) {
    options = { ...portOrOptions };
    callback = typeof rest[0] === 'function' ? rest[0] : undefined;
  } else {
    // port[, host][, options][, callback]
    const args = [...rest];
    const host =
      typeof args[0] === 'string' ? (args.shift() as string) : undefined;
    const extra =
      typeof args[0] === 'object' && args[0] !== null
        ? (args.shift() as ConnectionOptions)
        : {};
    callback = typeof args[0] === 'function' ? args[0] : undefined;
    options = { ...extra, port: portOrOptions as number };
    if (host !== undefined) {
      options.host = host;
    }
  }

  if (options.port === undefined) {
    throw new TypeError('connect() needs a port');
  }
  const host = options.host || '127.0.0.1';

  const socket = new TLSSocket(undefined, {
    ...options,
    servername: options.servername ?? host,
  });
  if (callback) {
    socket.once('secureConnect', callback);
  }
  return socket.connect({ ...options, host, port: options.port });
}

// The names of 0.1.0.
export { TLSSocket as TlsSocket, Server as TlsServer };
export type TlsSocketOptions = TLSSocketOptions;
export type TlsOptions = ConnectionOptions;
