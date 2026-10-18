import { EventEmitter } from 'events';
import { Readable, Writable } from 'readable-stream';
import { HTTPParser } from 'http-parser-js';
import { Buffer } from 'buffer';
import process from '../process';
import { setTimeout, clearTimeout } from '../timers';
import type { Timeout } from '../timers';
import * as net from '../net';
import type { AddressInfo, BufferEncoding, ErrnoException } from '../types';

/** Node's http.IncomingHttpHeaders: header names are lower case. */
export interface IncomingHttpHeaders {
  [header: string]: string | string[] | undefined;
  'set-cookie'?: string[];
}

/** A header value that can be sent, as in Node. */
export type OutgoingHttpHeader = number | string | readonly string[];

/** Node's http.OutgoingHttpHeaders. */
export interface OutgoingHttpHeaders {
  [header: string]: OutgoingHttpHeader | undefined;
}

/** Node's http.ServerOptions, the supported part of it. */
export interface ServerOptions {
  /** Idle time before a kept-alive connection is closed. 0 disables it. */
  keepAliveTimeout?: number;
  /** Time a whole request may take. 0 disables it. */
  requestTimeout?: number;
  /** Time the headers of a request may take. 0 disables it. */
  headersTimeout?: number;
  /** Largest accepted request head, in bytes. */
  maxHeaderSize?: number;
  /** Accepted for compatibility, not enforced. */
  maxRequestsPerSocket?: number;
}

export type RequestListener = (
  req: IncomingMessage,
  res: ServerResponse,
) => void;

/** The events of an http.Server and their listeners, as in Node. */
export interface ServerEventMap {
  checkContinue: RequestListener;
  clientError: (err: ErrnoException, socket: net.Socket) => void;
  close: () => void;
  connect: (req: IncomingMessage, socket: net.Socket, head: Buffer) => void;
  connection: (socket: net.Socket) => void;
  error: (err: ErrnoException) => void;
  listening: () => void;
  request: RequestListener;
  upgrade: (req: IncomingMessage, socket: net.Socket, head: Buffer) => void;
}

/** The events of a ClientRequest and their listeners, as in Node. */
export interface ClientRequestEventMap {
  abort: () => void;
  close: () => void;
  drain: () => void;
  error: (err: ErrnoException) => void;
  finish: () => void;
  response: (response: IncomingMessage) => void;
  socket: (socket: net.Socket) => void;
  timeout: () => void;
}

// Headers whose repeats are dropped, as Node does: only the first counts.
const SINGLE_VALUE_HEADERS = new Set([
  'age',
  'authorization',
  'content-length',
  'content-type',
  'etag',
  'expires',
  'from',
  'host',
  'if-modified-since',
  'if-unmodified-since',
  'last-modified',
  'location',
  'max-forwards',
  'proxy-authorization',
  'referer',
  'retry-after',
  'server',
  'user-agent',
]);

/**
 * Turns the parser's [name, value, name, value, ...] list into headers the
 * way Node does: names in lower case, set-cookie as a list, single-value
 * headers keep their first value and the rest are joined with ', '.
 */
function parseHeaders(raw: string[]): {
  headers: IncomingHttpHeaders;
  rawHeaders: string[];
} {
  const headers: IncomingHttpHeaders = {};
  const rawHeaders: string[] = [];

  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i];
    const value = raw[i + 1];
    if (
      name == null ||
      name === undefined ||
      value == null ||
      value === undefined
    ) {
      continue;
    }
    rawHeaders.push(name, value);

    const key = name.toLowerCase();
    const existing = headers[key];
    if (key === 'set-cookie') {
      const prev = headers['set-cookie'] ?? [];
      headers['set-cookie'] = [...prev, value];
    } else if (existing === undefined) {
      headers[key] = value;
    } else if (!SINGLE_VALUE_HEADERS.has(key)) {
      headers[key] = `${existing}, ${value}`;
    }
  }

  return { headers, rawHeaders };
}

export const STATUS_CODES: Record<number, string> = {
  100: 'Continue',
  101: 'Switching Protocols',
  102: 'Processing',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: "I'm a teapot",
  421: 'Misdirected Request',
  422: 'Unprocessable Entity',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  510: 'Not Extended',
  511: 'Network Authentication Required',
};

export const METHODS = [
  'ACL',
  'BIND',
  'CHECKOUT',
  'CONNECT',
  'COPY',
  'DELETE',
  'GET',
  'HEAD',
  'LINK',
  'LOCK',
  'M-SEARCH',
  'MERGE',
  'MKACTIVITY',
  'MKCALENDAR',
  'MKCOL',
  'MOVE',
  'NOTIFY',
  'OPTIONS',
  'PATCH',
  'POST',
  'PROPFIND',
  'PROPPATCH',
  'PURGE',
  'PUT',
  'REBIND',
  'REPORT',
  'SEARCH',
  'SOURCE',
  'SUBSCRIBE',
  'TRACE',
  'UNBIND',
  'UNLINK',
  'UNLOCK',
  'UNSUBSCRIBE',
];

function noop() {}

/**
 * Closes a socket once everything written to it has been flushed. Used when a
 * connection is not going to be reused, so it does not stay open until the
 * peer decides to close it.
 */
function destroySoon(socket: net.Socket | null) {
  if (!socket || socket.destroyed) {
    return;
  }
  if (socket.writableFinished) {
    socket.destroy();
    return;
  }
  socket.once('finish', () => socket.destroy());
  if (!socket.writableEnded) {
    socket.end();
  }
}

export class IncomingMessage extends Readable {
  public socket: net.Socket;

  /** The request method. Only set on a request a server received. */
  public method?: string;
  /** The request target. Only set on a request a server received. */
  public url?: string;
  public httpVersion: string = '1.1';
  public httpVersionMajor: number = 1;
  public httpVersionMinor: number = 1;
  /** Only set on a response a client received. */
  public statusCode?: number;
  /** Only set on a response a client received. */
  public statusMessage?: string;
  public headers: IncomingHttpHeaders = {};
  /** The headers as received: [name, value, name, value, ...]. */
  public rawHeaders: string[] = [];

  public complete: boolean = false;

  constructor(socket: net.Socket) {
    super({ autoDestroy: false });

    this.socket = socket;
  }

  /** Sets the HTTP version and headers from what the parser produced. */
  _setHead(
    versionMajor: number,
    versionMinor: number,
    rawHeaders: string[],
  ): void {
    this.httpVersionMajor = versionMajor;
    this.httpVersionMinor = versionMinor;
    this.httpVersion = `${versionMajor}.${versionMinor}`;
    const parsed = parseHeaders(rawHeaders);
    this.headers = parsed.headers;
    this.rawHeaders = parsed.rawHeaders;
  }

  pause(): this {
    super.pause();
    return this;
  }

  resume(): this {
    super.resume();
    return this;
  }

  _read(): void {
    // Restart the socket in case it was paused because our buffer was full.
    if (this.socket && !this.socket.destroyed) {
      this.socket.resume();
    }
  }

  /** Sets the timeout of the underlying socket, see Socket.setTimeout. */
  public setTimeout(msecs: number, callback?: () => void): this {
    this.socket.setTimeout(msecs, callback);
    return this;
  }

  public destroy(error?: Error): this {
    super.destroy(error);
    this.socket.destroy();
    return this;
  }

  public setNoDelay(noDelay: boolean = true): void {
    this.socket.setNoDelay(noDelay);
  }

  public setKeepAlive(enable: boolean = false, initialDelay: number = 0): void {
    this.socket.setKeepAlive(enable, initialDelay);
  }
}

type WriteCallback = (error?: Error | null) => void;

export class OutgoingMessage extends Writable {
  public headersSent: boolean = false;
  protected _headers: OutgoingHttpHeaders = {};
  protected _headerNames: Record<string, string> = {};
  public socket: net.Socket | null = null;

  public chunkedEncoding: boolean = false;
  protected _hasBody: boolean = true;
  protected _sendHeadersSent: boolean = false;
  public aborted: boolean = false;

  constructor() {
    // disable autoDestroy to prevent socket from being destroyed when stream ends
    super({ autoDestroy: false });
  }

  public destroy(error?: Error): this {
    super.destroy(error);
    if (this.socket) {
      this.socket.destroy();
    }
    return this;
  }

  setHeader(name: string, value: OutgoingHttpHeader): this {
    if (this.headersSent)
      throw new Error('Cannot set headers after they are sent');
    const key = name.toLowerCase();
    this._headers[key] = value;
    this._headerNames[key] = name;
    return this;
  }

  getHeader(name: string): number | string | string[] | undefined {
    const value = this._headers[name.toLowerCase()];
    return Array.isArray(value)
      ? [...value]
      : (value as number | string | undefined);
  }

  /** A copy of the headers set so far, keyed by lower-case name. */
  getHeaders(): OutgoingHttpHeaders {
    return { ...this._headers };
  }

  removeHeader(name: string): void {
    if (this.headersSent)
      throw new Error('Cannot remove headers after they are sent');
    const key = name.toLowerCase();
    delete this._headers[key];
    delete this._headerNames[key];
  }

  hasHeader(name: string): boolean {
    return name.toLowerCase() in this._headers;
  }

  getHeaderNames(): string[] {
    return Object.values(this._headerNames);
  }

  public setTimeout(ms: number, callback?: () => void): this {
    if (this.socket) {
      this.socket.setTimeout(ms, () => {
        this.emit('timeout');
        if (callback) callback();
      });
    } else {
      this.once('socket', (s: net.Socket) => {
        s.setTimeout(ms, () => {
          this.emit('timeout');
          if (callback) callback();
        });
      });
    }
    return this;
  }

  protected _renderHeaders(firstLine: string): string {
    let headerStr = firstLine + '\r\n';
    for (const key in this._headers) {
      const name = this._headerNames[key];
      const value = this._headers[key];
      if (Array.isArray(value)) {
        for (const v of value) {
          headerStr += `${name}: ${v}\r\n`;
        }
      } else {
        headerStr += `${name}: ${value}\r\n`;
      }
    }
    headerStr += '\r\n';
    return headerStr;
  }

  protected _sendHeaders(firstLine: string) {
    if (this.headersSent) {
      return;
    }

    // Check for Chunked Encoding
    if (!this.hasHeader('Content-Length') && this._hasBody) {
      this.setHeader('Transfer-Encoding', 'chunked');
      this.chunkedEncoding = true;
    }

    this.headersSent = true;
    const headerStr = this._renderHeaders(firstLine);

    this.socket!.write(Buffer.from(headerStr));
  }

  _write(
    chunk: Buffer | Uint8Array | string,
    encoding: string,
    callback: WriteCallback,
  ) {
    const socket = this.socket;
    if (!socket) {
      callback(new Error('Socket not assigned'));
      return;
    }

    if (this.chunkedEncoding) {
      const len =
        typeof chunk === 'string'
          ? Buffer.byteLength(chunk, encoding as BufferEncoding)
          : chunk.length;
      const header = len.toString(16) + '\r\n';
      socket.write(Buffer.from(header));
      // Note: We don't return the backpressure status here because we are doing multiple writes
      // The final write determines the callback.
      socket.write(chunk, encoding, (err) => {
        if (err) return callback(err);
        socket.write(Buffer.from('\r\n'), callback);
      });
    } else {
      socket.write(chunk, encoding, callback);
    }
  }

  public write(
    chunk: Buffer | Uint8Array | string,
    callback?: WriteCallback,
  ): boolean;
  public write(
    chunk: Buffer | Uint8Array | string,
    encoding?: BufferEncoding,
    callback?: WriteCallback,
  ): boolean;
  public write(
    chunk: Buffer | Uint8Array | string,
    encoding?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean {
    const ret = super.write(chunk, encoding as BufferEncoding, callback);
    // If writableLength is too high, return false
    // But since we are proxying to socket, we should also check socket backpressure
    if (this.socket) {
      return ret && !this.socket.writableNeedDrain;
    }
    return ret;
  }

  // _final is called by the stream when all writes are complete before 'finish' event
  _final(callback: (error?: Error | null) => void) {
    if (this.chunkedEncoding && this.socket) {
      let terminator = '0\r\n\r\n';
      this.socket.write(Buffer.from(terminator), (err) => {
        callback(err);
      });
    } else {
      callback();
    }
  }

  end(callback?: () => void): this;
  end(chunk: Buffer | Uint8Array | string, callback?: () => void): this;
  end(
    chunk: Buffer | Uint8Array | string,
    encoding?: BufferEncoding,
    callback?: () => void,
  ): this;
  end(...args: EndArgs): this {
    const { chunk, encoding, callback } = normalizeEndArgs(args);

    if (chunk != null) {
      this.write(chunk, encoding);
    }
    super.end(callback);
    return this;
  }

  // Kept so that they can be given to a socket that does not exist yet: a
  // ClientRequest only gets its socket once it starts connecting.
  private _noDelay: boolean | null = null;
  private _keepAlive: { enable: boolean; initialDelay: number } | null = null;

  public setNoDelay(noDelay: boolean = true): void {
    this._noDelay = noDelay;
    this.socket?.setNoDelay(noDelay);
  }

  public setSocketKeepAlive(
    enable: boolean = false,
    initialDelay: number = 0,
  ): void {
    this._keepAlive = { enable, initialDelay };
    this.socket?.setKeepAlive(enable, initialDelay);
  }

  /** Gives the options set so far to the socket this message just got. */
  protected _applySocketOptions(): void {
    if (!this.socket) {
      return;
    }
    if (this._noDelay !== null) {
      this.socket.setNoDelay(this._noDelay);
    }
    if (this._keepAlive !== null) {
      this.socket.setKeepAlive(
        this._keepAlive.enable,
        this._keepAlive.initialDelay,
      );
    }
  }
}

type EndArgs = [
  chunk?: Buffer | Uint8Array | string | (() => void),
  encoding?: BufferEncoding | (() => void),
  callback?: () => void,
];

/** Brings the overloaded arguments of end() into one shape. */
function normalizeEndArgs(args: EndArgs): {
  chunk: Buffer | Uint8Array | string | null;
  encoding: BufferEncoding | undefined;
  callback: (() => void) | undefined;
} {
  const [chunk, encoding, callback] = args;
  if (typeof chunk === 'function') {
    return { chunk: null, encoding: undefined, callback: chunk };
  }
  if (typeof encoding === 'function') {
    return { chunk: chunk ?? null, encoding: undefined, callback: encoding };
  }
  return { chunk: chunk ?? null, encoding, callback };
}

// ========== ServerResponse ==========

export class ServerResponse extends OutgoingMessage {
  public statusCode: number = 200;
  /** Defaults to the standard text for statusCode. */
  public statusMessage: string = '';

  // Whether the connection may be reused after this response. Set by the
  // server from the request (HTTP version and Connection header).
  public shouldKeepAlive: boolean = true;

  constructor(socket: net.Socket) {
    super();

    this.socket = socket;

    const onClose = () => {
      if (this.socket) {
        this.socket.removeListener('close', onClose);
      }
      this.removeListener('finish', onClose);
      this.emit('close');
    };
    this.once('finish', onClose);
    socket.once('close', onClose);
  }

  /** Sends "100 Continue", for a request with "Expect: 100-continue". */
  writeContinue(callback?: () => void): void {
    this.socket?.write(Buffer.from('HTTP/1.1 100 Continue\r\n\r\n'), () =>
      callback?.(),
    );
  }

  writeHead(
    statusCode: number,
    statusMessage?: string,
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ): this;
  writeHead(
    statusCode: number,
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ): this;
  writeHead(
    statusCode: number,
    statusMessageOrHeaders?:
      | string
      | OutgoingHttpHeaders
      | OutgoingHttpHeader[],
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ): this {
    if (this.headersSent)
      throw new Error('Cannot write headers after they are sent');
    this.statusCode = statusCode;
    if (typeof statusMessageOrHeaders === 'object') {
      headers = statusMessageOrHeaders;
    } else if (statusMessageOrHeaders) {
      this.statusMessage = statusMessageOrHeaders;
    }
    if (Array.isArray(headers)) {
      // [name, value, name, value, ...]
      for (let i = 0; i + 1 < headers.length; i += 2) {
        this.setHeader(
          String(headers[i]),
          headers[i + 1] as OutgoingHttpHeader,
        );
      }
    } else if (headers) {
      for (const key in headers) {
        const value = headers[key];
        if (value !== undefined) {
          this.setHeader(key, value);
        }
      }
    }
    // Note: Do NOT send headers here. They will be sent on first write/end
    // when Content-Length can be determined.
    return this;
  }

  private _sendResponseHeaders() {
    if (this.headersSent) return;
    if (!this.hasHeader('connection')) {
      // tell the client what we are going to do with the connection
      this.setHeader(
        'Connection',
        this.shouldKeepAlive ? 'keep-alive' : 'close',
      );
    }
    const firstLine = `HTTP/1.1 ${this.statusCode} ${
      this.statusMessage || STATUS_CODES[this.statusCode] || 'OK'
    }`;
    this._sendHeaders(firstLine);
  }

  _write(
    chunk: Buffer | Uint8Array | string,
    encoding: string,
    callback: WriteCallback,
  ) {
    if (!this.headersSent) {
      this._sendResponseHeaders();
    }
    super._write(chunk, encoding, callback);
  }

  end(callback?: () => void): this;
  end(chunk: Buffer | Uint8Array | string, callback?: () => void): this;
  end(
    chunk: Buffer | Uint8Array | string,
    encoding?: BufferEncoding,
    callback?: () => void,
  ): this;
  end(...args: EndArgs): this {
    const { chunk, encoding, callback } = normalizeEndArgs(args);

    if (!this.headersSent) {
      // If we have a single chunk and no headers sent yet, we can add Content-Length
      // to avoid chunked encoding for simple responses.
      if (chunk != null) {
        const len =
          typeof chunk === 'string'
            ? Buffer.byteLength(chunk, encoding)
            : chunk.length;
        this.setHeader('Content-Length', len);
      } else if (!this.hasHeader('Transfer-Encoding')) {
        this.setHeader('Content-Length', 0);
      }
      this._sendResponseHeaders();
    }

    if (chunk != null) {
      this.write(chunk, encoding);
    }
    super.end(callback);
    return this;
  }
}

// Typed event listeners, declared only (they are EventEmitter's methods).
interface Server {
  on<E extends keyof ServerEventMap>(
    event: E,
    listener: ServerEventMap[E],
  ): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once<E extends keyof ServerEventMap>(
    event: E,
    listener: ServerEventMap[E],
  ): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  addListener<E extends keyof ServerEventMap>(
    event: E,
    listener: ServerEventMap[E],
  ): this;
  addListener(event: string | symbol, listener: (...args: any[]) => void): this;
  prependListener<E extends keyof ServerEventMap>(
    event: E,
    listener: ServerEventMap[E],
  ): this;
  prependListener(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this;
  prependOnceListener<E extends keyof ServerEventMap>(
    event: E,
    listener: ServerEventMap[E],
  ): this;
  prependOnceListener(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this;
}

class Server extends EventEmitter {
  private _netServer: net.Server;
  private _httpConnections: Set<net.Socket> = new Set<net.Socket>();

  public maxHeaderSize: number = 16384;
  public maxRequestsPerSocket: number = 0;
  public headersTimeout: number = 60000;
  public requestTimeout: number = 300000;
  public keepAliveTimeout: number = 5000;

  constructor(requestListener?: RequestListener);
  constructor(options: ServerOptions, requestListener?: RequestListener);
  constructor(
    options?: ServerOptions | RequestListener,
    requestListener?: RequestListener,
  ) {
    super();

    let listener: RequestListener | undefined;
    if (typeof options === 'function') {
      listener = options;
    } else if (options) {
      if (options.keepAliveTimeout !== undefined) {
        this.keepAliveTimeout = options.keepAliveTimeout;
      }
      if (options.requestTimeout !== undefined) {
        this.requestTimeout = options.requestTimeout;
      }
      if (options.headersTimeout !== undefined) {
        this.headersTimeout = options.headersTimeout;
      }
      if (options.maxHeaderSize !== undefined) {
        this.maxHeaderSize = options.maxHeaderSize;
      }
      if (options.maxRequestsPerSocket !== undefined) {
        this.maxRequestsPerSocket = options.maxRequestsPerSocket;
      }
      listener = requestListener;
    }

    if (listener) {
      this.on('request', listener);
    }

    this._netServer = new net.Server();

    // Forward net.Server events
    this._netServer.on('listening', () => this.emit('listening'));
    this._netServer.on('close', () => this.emit('close'));
    this._netServer.on('error', (err) => this.emit('error', err));

    this._netServer.on('connection', (socket) => {
      this.emit('connection', socket);
      this._setupHttpConnection(socket);
    });
  }

  private _setupHttpConnection(socket: net.Socket) {
    this._httpConnections.add(socket);

    let req: IncomingMessage | null = null;
    let res: ServerResponse | null = null;
    // The request whose body is still being received. Unlike `req` it is not
    // reset when the response finishes, the body may still be arriving then.
    let incoming: IncomingMessage | null = null;
    // Set when the headers of a CONNECT or upgrade request were parsed. The
    // event is emitted from onData, once the parser has returned and the bytes
    // that followed the headers in the same chunk are known.
    let handover: {
      event: 'connect' | 'upgrade';
      req: IncomingMessage;
    } | null = null;
    const parser = new HTTPParser(HTTPParser.REQUEST);
    parser.maxHeaderSize = this.maxHeaderSize;

    const self = this;

    // Without these a client that connects and goes quiet would hold its
    // connection (and everything attached to it) open forever.
    //   headers:   waiting for the headers of a request
    //   request:   waiting for the rest of a request
    //   keepAlive: idle between two requests
    type TimerName = 'headers' | 'request' | 'keepAlive';
    const timers: Record<TimerName, Timeout | null> = {
      headers: null,
      request: null,
      keepAlive: null,
    };
    function clearTimer(name: TimerName) {
      const timer = timers[name];
      if (timer) {
        clearTimeout(timer);
        timers[name] = null;
      }
    }
    function startTimer(name: TimerName, ms: number) {
      clearTimer(name);
      if (ms > 0) {
        timers[name] = setTimeout(() => {
          timers[name] = null;
          socket.destroy();
        }, ms);
      }
    }
    function clearTimers() {
      clearTimer('headers');
      clearTimer('request');
      clearTimer('keepAlive');
    }

    startTimer('headers', this.headersTimeout);

    parser[HTTPParser.kOnHeadersComplete] = function (parserReq) {
      const method = HTTPParser.methods[parserReq.method];

      clearTimer('headers');

      if (method === 'CONNECT') {
        // the socket is handed over to the user from here on
        clearTimers();

        const connectReq = new IncomingMessage(socket);
        connectReq.method = method;
        connectReq.url = parserReq.url;
        connectReq._setHead(
          parserReq.versionMajor,
          parserReq.versionMinor,
          parserReq.headers,
        );

        handover = { event: 'connect', req: connectReq };
        // 2 makes the parser stop right after the headers: whatever follows
        // them belongs to the tunnel, not to an HTTP body.
        return 2;
      }

      const currentReq = new IncomingMessage(socket);
      currentReq.method = method;
      currentReq.url = parserReq.url;
      currentReq._setHead(
        parserReq.versionMajor,
        parserReq.versionMinor,
        parserReq.headers,
      );
      req = currentReq;
      incoming = currentReq;

      const upgrade = currentReq.headers['upgrade'];
      if (upgrade && self.listenerCount('upgrade') > 0) {
        // the socket is handed over to the user from here on
        clearTimers();
        handover = { event: 'upgrade', req: currentReq };
        // as for CONNECT: the rest of the chunk is the new protocol's data
        return 2;
      }

      startTimer('request', self.requestTimeout);

      const currentRes = new ServerResponse(socket);
      currentRes.shouldKeepAlive = parserReq.shouldKeepAlive !== false;
      res = currentRes;

      currentRes.on('finish', () => {
        if (req === currentReq) {
          req = null;
        }
        if (res === currentRes) {
          res = null;
        }

        if (!currentReq.readableEnded) {
          // The handler did not read the whole body. Drain it, otherwise it
          // stalls the socket and the next request is never parsed.
          currentReq.resume();
        }

        const connection = String(
          currentRes.getHeader('connection') ?? '',
        ).toLowerCase();

        if (!currentRes.shouldKeepAlive || connection === 'close') {
          // The connection is not going to be reused, so close it instead of
          // waiting for the client to do it.
          clearTimers();
          destroySoon(socket);
        } else {
          startTimer('keepAlive', self.keepAliveTimeout);
        }
      });

      const expect = currentReq.headers['expect'];
      if (
        expect &&
        typeof expect === 'string' &&
        expect.toLowerCase() === '100-continue'
      ) {
        if (self.listenerCount('checkContinue') > 0) {
          self.emit('checkContinue', currentReq, currentRes);
        } else {
          currentRes.writeContinue();
          self.emit('request', currentReq, currentRes);
        }
      } else {
        self.emit('request', currentReq, currentRes);
      }
      return undefined;
    };
    parser[HTTPParser.kOnBody] = function (chunk, offset, length) {
      if (!incoming) {
        return;
      }
      const buffer = Buffer.from(chunk.slice(offset, length));
      if (buffer.length && !incoming.push(buffer)) {
        // The request's buffer is full: stop reading until it is consumed
        // (IncomingMessage._read resumes the socket).
        socket.pause();
      }
    };
    parser[HTTPParser.kOnMessageComplete] = function () {
      clearTimer('request');
      if (!incoming) {
        return;
      }
      incoming.complete = true;
      incoming.push(null);
      incoming = null;
    };

    function onData(data: Buffer) {
      if (timers.keepAlive) {
        // a new request is starting on an idle connection
        clearTimer('keepAlive');
        startTimer('headers', self.headersTimeout);
      }
      const consumed = parser.execute(data);

      if (consumed instanceof Error) {
        // Not HTTP, or a head over maxHeaderSize. Like Node: 'clientError'
        // decides, and without a listener the client gets a 400.
        clearTimers();
        socket.removeListener('data', onData);
        const err: ErrnoException = consumed;
        err.code = err.code ?? 'HPE_INVALID';
        if (self.listenerCount('clientError') > 0) {
          self.emit('clientError', err, socket);
        } else {
          socket.end(
            Buffer.from(
              'HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n',
            ),
          );
          destroySoon(socket);
        }
        return;
      }

      if (handover) {
        const { event, req: handedReq } = handover;
        handover = null;

        // Stop feeding the parser, the user is responsible for the socket's
        // data from now on.
        socket.removeListener('data', onData);

        // The bytes that arrived together with the headers. They are not
        // emitted again, so the listener has to take them from here.
        const head = data.subarray(consumed);

        if (self.listenerCount(event) > 0) {
          self.emit(event, handedReq, socket, head);
        } else {
          // Default behavior: close connection if no listener
          socket.destroy();
        }
      }
    }

    socket.on('data', onData);
    socket.on('end', () => {
      // we got the entire message
      parser.finish();
    });

    // CRITICAL: Ensure server-side socket starts flowing!
    socket.resume();

    socket.on('close', () => {
      clearTimers();
      this._httpConnections.delete(socket);
      if (incoming) {
        // the connection died in the middle of a request
        incoming.push(null);
        incoming = null;
      }
    });

    socket.on('error', (err: Error) => {
      if (req) {
        req.emit('error', err);
      } else {
        this.emit('error', err);
      }
    });
  }

  /** Where the server listens, or null when it does not. */
  address(): AddressInfo | null {
    return this._netServer.address();
  }

  /** Starts accepting connections; the arguments are net.Server.listen's. */
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
  listen(port?: number, backlog?: number, listeningListener?: () => void): this;
  listen(port?: number, listeningListener?: () => void): this;
  listen(options: net.ListenOptions, listeningListener?: () => void): this;
  listen(...args: unknown[]): this {
    (this._netServer.listen as (...listenArgs: unknown[]) => net.Server)(
      ...args,
    );
    return this;
  }

  close(callback?: (err?: Error) => void): this {
    // net.Server.close also destroys every open connection, which fires the
    // 'close' handlers set up in _setupHttpConnection.
    this._netServer.close(callback);
    return this;
  }
}

/** Creates an http.Server; see its constructor. */
export function createServer(requestListener?: RequestListener): Server;
export function createServer(
  options: ServerOptions,
  requestListener?: RequestListener,
): Server;
export function createServer(
  options?: ServerOptions | RequestListener,
  requestListener?: RequestListener,
): Server {
  return new Server(options as ServerOptions, requestListener);
}

export { Server };

// @TODO: Agent
export class Agent extends EventEmitter {
  constructor() {
    super();
  }
}

/** Node's http.RequestOptions, the supported part of it. */
export interface RequestOptions {
  /** 'http:' here, 'https:' for https.request. */
  protocol?: string;
  /** Host to connect to; `hostname` wins if both are set. Default 'localhost'. */
  host?: string;
  hostname?: string;
  /** 0 (both, the default), 4 or 6: which addresses of the host to try. */
  family?: number;
  /** Defaults to `defaultPort`. */
  port?: number;
  /** Defaults to 80, or 443 for https. */
  defaultPort?: number;
  /** Defaults to 'GET'. */
  method?: string;
  /** Path and query string. Defaults to '/'. */
  path?: string;
  headers?: OutgoingHttpHeaders;
  /** 'user:password' for basic authentication. */
  auth?: string;
  /** Accepted for compatibility: every request uses its own connection. */
  agent?: Agent | boolean;
  /** Calls setTimeout() on the request. */
  timeout?: number;
  /** Replaces dns.lookup() for resolving the host. */
  lookup?: net.LookupFunction;
}

/** Anything with an `href`, such as a URL object. */
export interface URLLike {
  href: string;
}

type ResponseCallback = (res: IncomingMessage) => void;

/**
 * Reads "http://user:pass@host:port/path?query" into request options. The
 * URL class is not relied on, as React Native's is incomplete.
 */
function urlToOptions(url: string): RequestOptions {
  const match =
    /^([a-z][a-z0-9+.-]*:)\/\/(?:([^@/?#]*)@)?(\[[^\]]*\]|[^:/?#]*)(?::(\d*))?([^#]*)/i.exec(
      url,
    );
  if (!match) {
    throw new TypeError(`Invalid URL: ${url}`);
  }
  const [, protocol, auth, host, port, path] = match;

  const options: RequestOptions = {
    protocol: protocol!.toLowerCase(),
    // brackets are URL syntax only
    hostname: host!.replace(/^\[|\]$/g, ''),
    path: path || '/',
  };
  if (port) {
    options.port = Number(port);
  }
  if (auth) {
    options.auth = decodeURIComponent(auth);
  }
  return options;
}

/** Brings the overloaded arguments of request() into one shape. */
function normalizeRequestArgs(
  urlOrOptions: string | URLLike | RequestOptions,
  optionsOrCallback?: RequestOptions | ResponseCallback,
  callback?: ResponseCallback,
): { options: RequestOptions; callback: ResponseCallback | undefined } {
  let options: RequestOptions;
  if (typeof urlOrOptions === 'string') {
    options = urlToOptions(urlOrOptions);
  } else if ('href' in urlOrOptions && typeof urlOrOptions.href === 'string') {
    options = urlToOptions(urlOrOptions.href);
  } else {
    options = { ...(urlOrOptions as RequestOptions) };
  }

  if (typeof optionsOrCallback === 'function') {
    return { options, callback: optionsOrCallback };
  }
  // request(url, options, callback): the options win over the URL
  return { options: { ...options, ...optionsOrCallback }, callback };
}

// Typed event listeners, declared only (they are EventEmitter's methods).
export interface ClientRequest {
  on<E extends keyof ClientRequestEventMap>(
    event: E,
    listener: ClientRequestEventMap[E],
  ): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once<E extends keyof ClientRequestEventMap>(
    event: E,
    listener: ClientRequestEventMap[E],
  ): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  addListener<E extends keyof ClientRequestEventMap>(
    event: E,
    listener: ClientRequestEventMap[E],
  ): this;
  addListener(event: string | symbol, listener: (...args: any[]) => void): this;
  prependListener<E extends keyof ClientRequestEventMap>(
    event: E,
    listener: ClientRequestEventMap[E],
  ): this;
  prependListener(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this;
  prependOnceListener<E extends keyof ClientRequestEventMap>(
    event: E,
    listener: ClientRequestEventMap[E],
  ): this;
  prependOnceListener(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this;
}

export class ClientRequest extends OutgoingMessage {
  public method: string;
  public path: string;
  public host: string;
  private _res?: IncomingMessage;
  private _options: RequestOptions;
  private _connected: boolean = false;
  private _pendingWrites: Array<{
    chunk: Buffer | Uint8Array | string;
    encoding?: string;
    callback?: WriteCallback;
  }> = [];
  private _ended: boolean = false;
  private _expectContinue: boolean = false;
  private _continueReceived: boolean = false;
  private _isFlushing = false;
  private _netSocketCleanup: (() => void) | null = null;

  private _getChunkByteLength(
    chunk: Buffer | Uint8Array | string | null | undefined,
    encoding?: string | null,
  ): number {
    if (chunk == null) return 0;
    if (typeof chunk === 'string') {
      return Buffer.byteLength(
        chunk,
        (typeof encoding === 'string' ? encoding : undefined) as
          | BufferEncoding
          | undefined,
      );
    }
    return chunk.length;
  }

  private _getPendingBodyLength(): number {
    return this._pendingWrites.reduce((total, pending) => {
      return total + this._getChunkByteLength(pending.chunk, pending.encoding);
    }, 0);
  }

  /** The protocol this class speaks; https overrides it. */
  protected get _protocol(): string {
    return 'http:';
  }

  /** The port used when none is given; https overrides it. */
  protected get _defaultPort(): number {
    return 80;
  }

  constructor(
    url: string | URLLike | RequestOptions,
    callback?: ResponseCallback,
  );
  constructor(
    url: string | URLLike,
    options: RequestOptions,
    callback?: ResponseCallback,
  );
  constructor(
    urlOrOptions: string | URLLike | RequestOptions,
    optionsOrCallback?: RequestOptions | ResponseCallback,
    responseCallback?: ResponseCallback,
  ) {
    super();

    const { options, callback } = normalizeRequestArgs(
      urlOrOptions,
      optionsOrCallback,
      responseCallback,
    );

    if (options.protocol && options.protocol !== this._protocol) {
      throw new TypeError(
        `Protocol "${options.protocol}" not supported. Expected "${this._protocol}"`,
      );
    }

    this.method = (options.method || 'GET').toUpperCase();
    this.path = options.path || '/';
    this.host = options.hostname || options.host || 'localhost';

    this._options = {
      ...options,
      host: this.host,
      port: options.port ?? options.defaultPort ?? this._defaultPort,
    };

    if (['GET', 'HEAD'].includes(this.method)) {
      this._hasBody = false;
    }

    if (options.headers) {
      for (const key in options.headers) {
        const value = options.headers[key];
        if (value !== undefined) {
          this.setHeader(key, value);
        }
      }
    }

    if (options.auth && !this.hasHeader('authorization')) {
      this.setHeader(
        'Authorization',
        'Basic ' + Buffer.from(options.auth).toString('base64'),
      );
    }

    if (!this.hasHeader('connection')) {
      this.setHeader('connection', 'close');
    }

    if (callback) {
      this.once('response', callback);
    }

    if (options.timeout !== undefined) {
      this.setTimeout(options.timeout);
    }

    process.nextTick(() => {
      this.onSocket(null);
    });
  }

  private onSocket(socket: net.Socket | null) {
    if (socket) {
      throw new Error('Not yet implemented');
    } else {
      this._connect();
    }
  }

  protected _createConnection(
    options: RequestOptions,
    callback: (err: Error | null, socket: net.Socket | null) => void,
  ): net.Socket {
    const socket = net.createConnection({
      host: options.host,
      port: options.port!,
      family: options.family,
      lookup: options.lookup,
    });

    let called = false;
    function onConnect() {
      if (called) {
        return;
      }
      called = true;
      callback(null, socket);
    }
    function onError(err: Error) {
      if (called) {
        return;
      }
      called = true;
      callback(err, null);
    }

    socket.once('error', onError);
    socket.once('connect', onConnect);

    return socket;
  }

  private _connect() {
    const connectCallback = (err: Error | null, socket: net.Socket | null) => {
      if (err || !socket) {
        err = err ?? new Error('No socket');
        this._failPendingWrites(err);
        this.emit('error', err);
        return;
      }

      this.socket = socket;
      this._connected = true;
      this.emit('socket', this.socket);
      // IMPORTANT: attach response listeners BEFORE flushing writes.
      // If we flush first, the server may respond before we have a data listener.
      this._attachSocketListeners();
      // _flushPendingWrites() internally calls _sendRequest() if headers not sent yet.
      // Do NOT call _sendRequest() separately here — _flushPendingWrites() needs to
      // inspect headersSent and _pendingWrites together so it can set Content-Length
      // before sending headers (to avoid chunked encoding when body is already known).
      this._flushPendingWrites();
    };

    this.socket = this._createConnection(this._options, connectCallback);
    this._applySocketOptions();
  }

  private _attachSocketListeners() {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    const self = this;
    const parser = new HTTPParser(HTTPParser.RESPONSE);

    parser[HTTPParser.kOnHeadersComplete] = function (parserReq) {
      const res = new IncomingMessage(socket);
      res.statusCode = parserReq.statusCode;
      res.statusMessage = parserReq.statusMessage;
      res._setHead(
        parserReq.versionMajor,
        parserReq.versionMinor,
        parserReq.headers,
      );

      self._res = res;

      self.emit('response', res);
      return undefined;
    };
    parser[HTTPParser.kOnBody] = function (body) {
      const res = self._res;
      if (!res || res.complete) {
        return;
      }
      const buffer = Buffer.from(body);
      if (!buffer.length) {
        return;
      }
      if (!res.push(buffer)) {
        // The response's buffer is full: stop reading until it is consumed
        // (IncomingMessage._read resumes the socket).
        self.socket?.pause();
      }
    };
    parser[HTTPParser.kOnMessageComplete] = function () {
      const res = self._res;
      if (!res || res.complete) {
        return;
      }

      res.complete = true;

      res.once('end', () => {
        self.emit('close');
        res.emit('close');
      });
      res.push(null);
      self._cleanupSocket();
    };

    const onData = (data: Buffer) => {
      const res = self._res;
      if (res && res.complete) {
        // we have a response, and it's complete
        // that means we got data from the socket after completion
        // just ignore
        return;
      }

      // feed data to parser
      const consumed = parser.execute(data);
      if (consumed instanceof Error) {
        // not an HTTP response
        socket.destroy(consumed);
      }
    };

    const onError = (err: Error) => {
      const res = self._res;
      if (res && res.complete) {
        // we got error after finish, we don't care
        return;
      }

      self._cleanupSocket();

      // emit on next tick
      process.nextTick(() => {
        self.emit('error', err);
        if (res) {
          res.emit('error', err);
        }

        self.emit('close');
        if (res) {
          res.emit('close');
        }
      });
    };

    const onClose = () => {
      const res = self._res;
      if (res && res.complete) {
        // we are done here
        return;
      }

      self._cleanupSocket();

      // emit on next tick
      process.nextTick(() => {
        self.emit('close');
        if (res) {
          res.emit('close');
        }
      });
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);

    this._netSocketCleanup = () => {
      this.socket?.removeListener('data', onData);
      this.socket?.removeListener('error', onError);
      this.socket?.removeListener('close', onClose);
    };
  }

  private _cleanupSocket() {
    const socket = this.socket;

    // clear net.Socket events
    if (this._netSocketCleanup) {
      this._netSocketCleanup();
      this._netSocketCleanup = null;
    }
    // remove socket
    this.socket = null;

    // The connection is never reused (every request is sent with
    // "Connection: close" and there is no agent), so close it here instead of
    // relying on the server to do it.
    if (socket && !socket.destroyed) {
      // our listeners are gone, make sure a late error is not left unhandled
      socket.on('error', noop);
      socket.destroy();
    }
    // we're no longer connected
    this._connected = false;
    // Fail any writes stranded in the pending queue: they were never handed to
    // the stream machinery, so without this their payloads and callbacks would
    // be retained indefinitely.
    this._failPendingWrites(new Error('Request socket closed'));
  }

  private _failPendingWrites(err: Error) {
    if (this._pendingWrites.length === 0) {
      return;
    }
    const pending = this._pendingWrites;
    this._pendingWrites = [];
    for (const write of pending) {
      if (typeof write.callback === 'function') {
        write.callback(err);
      }
    }
  }

  private _flushPendingWrites() {
    if (!this.socket || this._isFlushing) {
      return;
    }

    this._isFlushing = true;

    try {
      if (!this.headersSent) {
        // KEY FIX: When all body data is already queued AND the request is ending,
        // we can calculate the exact Content-Length and avoid chunked encoding.
        //
        // Why this matters: without Content-Length, the request is sent with
        // Transfer-Encoding: chunked. The Rust HTTP parser on the server side
        // stores chunked body bytes in its internal buffer after parsing headers,
        // but calling parser.feed(empty_buffer) to drain those bytes does NOT work
        // — the drain call returns empty metadata and the body is permanently lost.
        //
        // By setting Content-Length here (when we have all the data), the body is
        // sent as raw bytes. The server parser simply reads N bytes and marks the
        // request complete — no chunked framing, no drain issues.
        if (
          this._ended &&
          !this.hasHeader('Content-Length') &&
          !this.hasHeader('Transfer-Encoding') &&
          this._pendingWrites.length > 0
        ) {
          const totalLen = this._getPendingBodyLength();
          this.setHeader('Content-Length', totalLen);
        }
        this._sendRequest();
      }

      // If we are waiting for 100-continue, don't flush yet
      if (this._expectContinue && !this._continueReceived) {
        return;
      }

      // Keep draining the queue as long as it has items
      // This handles writes that might happen while we are flushing (e.g. from callbacks)
      while (this._pendingWrites.length > 0) {
        const writes = this._pendingWrites;
        this._pendingWrites = [];
        for (const pending of writes) {
          // Call super._write (OutgoingMessage._write) directly
          super._write(
            pending.chunk,
            pending.encoding ?? 'utf8',
            pending.callback ?? noop,
          );
        }
      }

      if (this._ended) {
        super.end();
      }
    } finally {
      this._isFlushing = false;
    }
  }

  private _sendRequest() {
    if (this.headersSent) {
      return;
    }

    if (!this.hasHeader('host')) {
      this.setHeader('Host', this.host);
    }

    const firstLine = `${this.method.toUpperCase()} ${this.path} HTTP/1.1`;
    this._sendHeaders(firstLine);
  }

  _write(
    chunk: Buffer | Uint8Array | string,
    encoding: string,
    callback: WriteCallback,
  ) {
    this._hasBody = true;
    if (!this._connected || this._isFlushing) {
      this._pendingWrites.push({ chunk, encoding, callback });
      return;
    }
    if (!this.headersSent) {
      this._sendRequest();
    }
    super._write(chunk, encoding, callback);
  }

  write(chunk: Buffer | Uint8Array | string, callback?: WriteCallback): boolean;
  write(
    chunk: Buffer | Uint8Array | string,
    encoding?: BufferEncoding,
    callback?: WriteCallback,
  ): boolean;
  write(
    chunk: Buffer | Uint8Array | string,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean {
    const encoding =
      typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    if (typeof encodingOrCallback === 'function') {
      callback = encodingOrCallback;
    }

    this._hasBody = true;
    // If not connected OR currently flushing, enqueue to preserve order
    if (!this._connected || this._isFlushing) {
      this._pendingWrites.push({ chunk, encoding, callback });
      return true;
    }
    return super.write(chunk, encoding, callback);
  }

  end(callback?: () => void): this;
  end(chunk: Buffer | Uint8Array | string, callback?: () => void): this;
  end(
    chunk: Buffer | Uint8Array | string,
    encoding?: BufferEncoding,
    callback?: () => void,
  ): this;
  end(...args: EndArgs): this {
    const { chunk, encoding, callback } = normalizeEndArgs(args);

    if (chunk) {
      this._hasBody = true;
      if (!this.headersSent && !this.hasHeader('Content-Length')) {
        const len =
          this._getPendingBodyLength() +
          this._getChunkByteLength(chunk, encoding);
        this.setHeader('Content-Length', len);
      }
      // Use this.write to handle pending queue if not connected
      this.write(chunk, encoding);
    }

    this._ended = true;

    if (this._connected) {
      // Only end if the queue is empty. _flushPendingWrites will handle it otherwise.
      if (this._pendingWrites.length === 0) {
        super.end(callback);
      } else if (callback) {
        this.once('finish', callback);
      }
    } else {
      if (callback) {
        this.once('finish', callback);
      }
    }
    return this;
  }

  public abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.emit('abort');
    this.destroy();
  }

  public destroy(error?: Error): this {
    this._failPendingWrites(error ?? new Error('Request destroyed'));
    return super.destroy(error);
  }

  public flushHeaders(): void {
    if (this._connected && !this.headersSent) {
      this._sendRequest();
    }
  }
}

/**
 * Sends an HTTP request, like Node's http.request(). Call end() on the result
 * to send it; the response arrives through `callback` or 'response'.
 */
export function request(
  url: string | URLLike | RequestOptions,
  callback?: ResponseCallback,
): ClientRequest;
export function request(
  url: string | URLLike,
  options: RequestOptions,
  callback?: ResponseCallback,
): ClientRequest;
export function request(
  url: string | URLLike | RequestOptions,
  optionsOrCallback?: RequestOptions | ResponseCallback,
  callback?: ResponseCallback,
): ClientRequest {
  return new ClientRequest(
    url as string,
    optionsOrCallback as RequestOptions,
    callback,
  );
}

/** Like request(), for a GET request that is sent right away. */
export function get(
  url: string | URLLike | RequestOptions,
  callback?: ResponseCallback,
): ClientRequest;
export function get(
  url: string | URLLike,
  options: RequestOptions,
  callback?: ResponseCallback,
): ClientRequest;
export function get(
  url: string | URLLike | RequestOptions,
  optionsOrCallback?: RequestOptions | ResponseCallback,
  callback?: ResponseCallback,
): ClientRequest {
  const req = request(
    url as string,
    optionsOrCallback as RequestOptions,
    callback,
  );
  req.end();
  return req;
}
