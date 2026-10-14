import { makeTLSClient, setCryptoImplementation } from '@reclaimprotocol/tls';
import { Socket } from '../net';
import type { SocketEventMap } from '../net';
import { Buffer } from 'buffer';
import { pureJsCrypto } from '@reclaimprotocol/tls/purejs-crypto';
import { generateWriteId } from '../utils';
import type { BufferEncoding } from '../types';

setCryptoImplementation(pureJsCrypto);

export interface TlsSocketOptions {}

/** The events of a TLSSocket: a Socket's, plus 'secureConnect'. */
export interface TLSSocketEventMap extends SocketEventMap {
  /** The TLS handshake has completed. */
  secureConnect: () => void;
}

type TLSClient = ReturnType<typeof makeTLSClient>;

type WriteCallback = (error?: Error | null) => void;

// Typed event listeners, declared only (they are EventEmitter's methods).
export interface TlsSocket {
  on<E extends keyof TLSSocketEventMap>(event: E, listener: TLSSocketEventMap[E]): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once<E extends keyof TLSSocketEventMap>(event: E, listener: TLSSocketEventMap[E]): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  addListener<E extends keyof TLSSocketEventMap>(event: E, listener: TLSSocketEventMap[E]): this;
  addListener(event: string | symbol, listener: (...args: any[]) => void): this;
  prependListener<E extends keyof TLSSocketEventMap>(event: E, listener: TLSSocketEventMap[E]): this;
  prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
  prependOnceListener<E extends keyof TLSSocketEventMap>(event: E, listener: TLSSocketEventMap[E]): this;
  prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
}

export class TlsSocket extends Socket {
  private socket: Socket | undefined;
  private tls: TLSClient | null = null;

  private handshakeDone: boolean = false;

  constructor(socket?: Socket, options?: TlsSocketOptions) {
    super();

    this.socket = socket;

    // take native socket from the TCP socket and save it
    this._nativeSocket = socket ? (socket as TlsSocket)._nativeSocket : null;

    // attach listeners again, because we steal the native socket
    this._attachListeners();
  }

  /**
   * Override this function in order to replace
   */
  _handleReadData(data: Buffer): void {
    if (!this.tls) {
      throw new Error('Received data but TLS is not initialized');
    }

    this.tls.handleReceivedBytes(data);
  }

  protected _afterEmitConnect(): void {
    /**
     * Emit has been emitted. Start the handshake.
     */

    if (!this.tls) {
      throw new Error(
        'TCP handshake needs to start, but TLS is not initialized',
      );
    }

    this.tls.startHandshake();
  }

  _write(
    chunk: Buffer | Uint8Array | string,
    encoding: BufferEncoding,
    callback: WriteCallback,
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
        self._write(chunk, encoding, callback);
      });
      return;
    }

    if (!this.handshakeDone) {
      // handshake not done, we need to wait for it
      this.once('handshake', () => {
        self._write(chunk, encoding, callback);
      });
      return;
    }

    const buffer =
      typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk);
    if (!buffer.length) {
      return callback(null);
    }

    if (!this.tls) {
      // writing without TLS initialized
      throw new Error('Writing data but TLS is not initialized');
    }

    this.tls.write(buffer).then(
      () => {
        return callback();
      },
      (err) => {
        return callback(err);
      },
    );
  }

  _doWrite(data: Buffer, callback: WriteCallback) {
    const self = this;

    if (!this._nativeSocket) {
      return callback(new Error('No native socket assigned'));
    }

    // assign id
    const id = generateWriteId();

    if (!this._registerPendingWrite(id, (err) => {
      if (err) {
        return callback(err);
      }
      self.bytesWritten += data.length;
      return callback();
    })) {
      return callback(new Error('Socket is closed or not writable'));
    }

    const ab: ArrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;

    this._nativeSocket.write(id, ab);

    if (this._debug) {
      console.log(
        'doWrite id ' +
          id +
          ', pending writes: ' +
          this._pendingWrites.size,
      );
    }
  }

  _doWritePromise(data: Buffer): Promise<void> {
    const self = this;
    return new Promise<void>((resolve, reject) => {
      self._doWrite(data, (err) => {
        if (err) {
          return reject(err);
        }
        return resolve();
      });
    });
  }

  protected _beforeConnect(host: string): void {
    const self = this;

    this.tls = makeTLSClient({
      host,
      verifyServerCertificate: false,
      cipherSuites: [
        // TLSv1.3
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_256_GCM_SHA384',
        'TLS_AES_128_GCM_SHA256',

        // TLSv1.2
        'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
        'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
        'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
        'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
        'TLS_RSA_WITH_AES_128_GCM_SHA256',
        'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
        'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
        'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
        'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA',
      ],
      onApplicationData(data) {
        self.push(Buffer.from(data));
      },
      onHandshake() {
        self.handshakeDone = true;

        // emit event
        self.emit('handshake');
        self.emit('secureConnect');
      },
      async write({ header, content }) {
        await self._doWritePromise(Buffer.from(header));
        await self._doWritePromise(Buffer.from(content));
      },
    });
  }
}

/** Not implemented yet. */
export class TlsServer {}

/** Node's tls.ConnectionOptions, the supported part of it. */
export interface TlsOptions {
  host?: string;
  port?: number;
}

export type ConnectionOptions = TlsOptions;

export function connect(options: TlsOptions): TlsSocket;
export function connect(options: TlsOptions, callback: () => void): TlsSocket;
export function connect(port: number): TlsSocket;
export function connect(port: number, callback: () => void): TlsSocket;
export function connect(port: number, host: string): TlsSocket;
export function connect(port: number, host: string, callback: () => void): TlsSocket;
export function connect(port: number, host: string, options: TlsOptions): TlsSocket;
export function connect(port: number, host: string, options: TlsOptions, callback: () => void): TlsSocket;
export function connect(
  port: number | TlsOptions,
  host?: string | (() => void),
  options?: TlsOptions | (() => void),
  callback?: () => void,
): TlsSocket {
  if (typeof port !== 'number') {
    // options[, callback]
    const _options = port;
    const _callback = typeof host === 'function' ? host : undefined;
    const _host = _options?.host ?? '127.0.0.1';
    const _port = _options?.port;
    if (_port === undefined) {
      throw new TypeError('connect() needs a port');
    }
    return connect(_port, _host, _options, _callback!);
  }

  if (typeof host === 'function') {
    // port, callback
    return connect(port, '127.0.0.1', {}, host);
  } else if (typeof options === 'function') {
    // port, host, callback
    return connect(port, host ?? '127.0.0.1', {}, options);
  }

  // port, host, options, callback

  const tlsOptions: TlsOptions = {
    ...(options ?? {}),
    host,
    port,
  };

  const tcpSocket = new Socket();

  const socket = new TlsSocket(tcpSocket, tlsOptions);

  return socket.connect(port, host ?? '127.0.0.1', callback);
}

/** Node's name for the class. */
export { TlsSocket as TLSSocket };
