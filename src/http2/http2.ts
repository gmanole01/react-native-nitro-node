/**
 * Stubs of Node's `http2`, so packages that import it load. Nothing here
 * connects or listens: sessions, streams and servers are the right classes,
 * with Node's methods, but no events ever arrive. The constants and
 * getDefaultSettings() are Node's.
 */
import { EventEmitter } from 'events';
import { Duplex, Readable, Stream } from 'readable-stream';

/** Node's http2.constants (Node 22). */
export const constants = {
  NGHTTP2_ERR_FRAME_SIZE_ERROR: -522,
  NGHTTP2_SESSION_SERVER: 0,
  NGHTTP2_SESSION_CLIENT: 1,
  NGHTTP2_STREAM_STATE_IDLE: 1,
  NGHTTP2_STREAM_STATE_OPEN: 2,
  NGHTTP2_STREAM_STATE_RESERVED_LOCAL: 3,
  NGHTTP2_STREAM_STATE_RESERVED_REMOTE: 4,
  NGHTTP2_STREAM_STATE_HALF_CLOSED_LOCAL: 5,
  NGHTTP2_STREAM_STATE_HALF_CLOSED_REMOTE: 6,
  NGHTTP2_STREAM_STATE_CLOSED: 7,
  NGHTTP2_FLAG_NONE: 0,
  NGHTTP2_FLAG_END_STREAM: 1,
  NGHTTP2_FLAG_END_HEADERS: 4,
  NGHTTP2_FLAG_ACK: 1,
  NGHTTP2_FLAG_PADDED: 8,
  NGHTTP2_FLAG_PRIORITY: 32,
  DEFAULT_SETTINGS_HEADER_TABLE_SIZE: 4096,
  DEFAULT_SETTINGS_ENABLE_PUSH: 1,
  DEFAULT_SETTINGS_MAX_CONCURRENT_STREAMS: 4294967295,
  DEFAULT_SETTINGS_INITIAL_WINDOW_SIZE: 65535,
  DEFAULT_SETTINGS_MAX_FRAME_SIZE: 16384,
  DEFAULT_SETTINGS_MAX_HEADER_LIST_SIZE: 65535,
  DEFAULT_SETTINGS_ENABLE_CONNECT_PROTOCOL: 0,
  MAX_MAX_FRAME_SIZE: 16777215,
  MIN_MAX_FRAME_SIZE: 16384,
  MAX_INITIAL_WINDOW_SIZE: 2147483647,
  NGHTTP2_SETTINGS_HEADER_TABLE_SIZE: 1,
  NGHTTP2_SETTINGS_ENABLE_PUSH: 2,
  NGHTTP2_SETTINGS_MAX_CONCURRENT_STREAMS: 3,
  NGHTTP2_SETTINGS_INITIAL_WINDOW_SIZE: 4,
  NGHTTP2_SETTINGS_MAX_FRAME_SIZE: 5,
  NGHTTP2_SETTINGS_MAX_HEADER_LIST_SIZE: 6,
  NGHTTP2_SETTINGS_ENABLE_CONNECT_PROTOCOL: 8,
  PADDING_STRATEGY_NONE: 0,
  PADDING_STRATEGY_ALIGNED: 1,
  PADDING_STRATEGY_MAX: 2,
  PADDING_STRATEGY_CALLBACK: 1,
  NGHTTP2_NO_ERROR: 0,
  NGHTTP2_PROTOCOL_ERROR: 1,
  NGHTTP2_INTERNAL_ERROR: 2,
  NGHTTP2_FLOW_CONTROL_ERROR: 3,
  NGHTTP2_SETTINGS_TIMEOUT: 4,
  NGHTTP2_STREAM_CLOSED: 5,
  NGHTTP2_FRAME_SIZE_ERROR: 6,
  NGHTTP2_REFUSED_STREAM: 7,
  NGHTTP2_CANCEL: 8,
  NGHTTP2_COMPRESSION_ERROR: 9,
  NGHTTP2_CONNECT_ERROR: 10,
  NGHTTP2_ENHANCE_YOUR_CALM: 11,
  NGHTTP2_INADEQUATE_SECURITY: 12,
  NGHTTP2_HTTP_1_1_REQUIRED: 13,
  NGHTTP2_DEFAULT_WEIGHT: 16,
  HTTP2_HEADER_STATUS: ':status',
  HTTP2_HEADER_METHOD: ':method',
  HTTP2_HEADER_AUTHORITY: ':authority',
  HTTP2_HEADER_SCHEME: ':scheme',
  HTTP2_HEADER_PATH: ':path',
  HTTP2_HEADER_PROTOCOL: ':protocol',
  HTTP2_HEADER_ACCEPT_ENCODING: 'accept-encoding',
  HTTP2_HEADER_ACCEPT_LANGUAGE: 'accept-language',
  HTTP2_HEADER_ACCEPT_RANGES: 'accept-ranges',
  HTTP2_HEADER_ACCEPT: 'accept',
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_CREDENTIALS:
    'access-control-allow-credentials',
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_HEADERS: 'access-control-allow-headers',
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_METHODS: 'access-control-allow-methods',
  HTTP2_HEADER_ACCESS_CONTROL_ALLOW_ORIGIN: 'access-control-allow-origin',
  HTTP2_HEADER_ACCESS_CONTROL_EXPOSE_HEADERS: 'access-control-expose-headers',
  HTTP2_HEADER_ACCESS_CONTROL_REQUEST_HEADERS: 'access-control-request-headers',
  HTTP2_HEADER_ACCESS_CONTROL_REQUEST_METHOD: 'access-control-request-method',
  HTTP2_HEADER_AGE: 'age',
  HTTP2_HEADER_AUTHORIZATION: 'authorization',
  HTTP2_HEADER_CACHE_CONTROL: 'cache-control',
  HTTP2_HEADER_CONNECTION: 'connection',
  HTTP2_HEADER_CONTENT_DISPOSITION: 'content-disposition',
  HTTP2_HEADER_CONTENT_ENCODING: 'content-encoding',
  HTTP2_HEADER_CONTENT_LENGTH: 'content-length',
  HTTP2_HEADER_CONTENT_TYPE: 'content-type',
  HTTP2_HEADER_COOKIE: 'cookie',
  HTTP2_HEADER_DATE: 'date',
  HTTP2_HEADER_ETAG: 'etag',
  HTTP2_HEADER_FORWARDED: 'forwarded',
  HTTP2_HEADER_HOST: 'host',
  HTTP2_HEADER_IF_MODIFIED_SINCE: 'if-modified-since',
  HTTP2_HEADER_IF_NONE_MATCH: 'if-none-match',
  HTTP2_HEADER_IF_RANGE: 'if-range',
  HTTP2_HEADER_LAST_MODIFIED: 'last-modified',
  HTTP2_HEADER_LINK: 'link',
  HTTP2_HEADER_LOCATION: 'location',
  HTTP2_HEADER_RANGE: 'range',
  HTTP2_HEADER_REFERER: 'referer',
  HTTP2_HEADER_SERVER: 'server',
  HTTP2_HEADER_SET_COOKIE: 'set-cookie',
  HTTP2_HEADER_STRICT_TRANSPORT_SECURITY: 'strict-transport-security',
  HTTP2_HEADER_TRANSFER_ENCODING: 'transfer-encoding',
  HTTP2_HEADER_TE: 'te',
  HTTP2_HEADER_UPGRADE_INSECURE_REQUESTS: 'upgrade-insecure-requests',
  HTTP2_HEADER_UPGRADE: 'upgrade',
  HTTP2_HEADER_USER_AGENT: 'user-agent',
  HTTP2_HEADER_VARY: 'vary',
  HTTP2_HEADER_X_CONTENT_TYPE_OPTIONS: 'x-content-type-options',
  HTTP2_HEADER_X_FRAME_OPTIONS: 'x-frame-options',
  HTTP2_HEADER_KEEP_ALIVE: 'keep-alive',
  HTTP2_HEADER_PROXY_CONNECTION: 'proxy-connection',
  HTTP2_HEADER_X_XSS_PROTECTION: 'x-xss-protection',
  HTTP2_HEADER_ALT_SVC: 'alt-svc',
  HTTP2_HEADER_CONTENT_SECURITY_POLICY: 'content-security-policy',
  HTTP2_HEADER_EARLY_DATA: 'early-data',
  HTTP2_HEADER_EXPECT_CT: 'expect-ct',
  HTTP2_HEADER_ORIGIN: 'origin',
  HTTP2_HEADER_PURPOSE: 'purpose',
  HTTP2_HEADER_TIMING_ALLOW_ORIGIN: 'timing-allow-origin',
  HTTP2_HEADER_X_FORWARDED_FOR: 'x-forwarded-for',
  HTTP2_HEADER_PRIORITY: 'priority',
  HTTP2_HEADER_ACCEPT_CHARSET: 'accept-charset',
  HTTP2_HEADER_ACCESS_CONTROL_MAX_AGE: 'access-control-max-age',
  HTTP2_HEADER_ALLOW: 'allow',
  HTTP2_HEADER_CONTENT_LANGUAGE: 'content-language',
  HTTP2_HEADER_CONTENT_LOCATION: 'content-location',
  HTTP2_HEADER_CONTENT_MD5: 'content-md5',
  HTTP2_HEADER_CONTENT_RANGE: 'content-range',
  HTTP2_HEADER_DNT: 'dnt',
  HTTP2_HEADER_EXPECT: 'expect',
  HTTP2_HEADER_EXPIRES: 'expires',
  HTTP2_HEADER_FROM: 'from',
  HTTP2_HEADER_IF_MATCH: 'if-match',
  HTTP2_HEADER_IF_UNMODIFIED_SINCE: 'if-unmodified-since',
  HTTP2_HEADER_MAX_FORWARDS: 'max-forwards',
  HTTP2_HEADER_PREFER: 'prefer',
  HTTP2_HEADER_PROXY_AUTHENTICATE: 'proxy-authenticate',
  HTTP2_HEADER_PROXY_AUTHORIZATION: 'proxy-authorization',
  HTTP2_HEADER_REFRESH: 'refresh',
  HTTP2_HEADER_RETRY_AFTER: 'retry-after',
  HTTP2_HEADER_TRAILER: 'trailer',
  HTTP2_HEADER_TK: 'tk',
  HTTP2_HEADER_VIA: 'via',
  HTTP2_HEADER_WARNING: 'warning',
  HTTP2_HEADER_WWW_AUTHENTICATE: 'www-authenticate',
  HTTP2_HEADER_HTTP2_SETTINGS: 'http2-settings',
  HTTP2_METHOD_ACL: 'ACL',
  HTTP2_METHOD_BASELINE_CONTROL: 'BASELINE-CONTROL',
  HTTP2_METHOD_BIND: 'BIND',
  HTTP2_METHOD_CHECKIN: 'CHECKIN',
  HTTP2_METHOD_CHECKOUT: 'CHECKOUT',
  HTTP2_METHOD_CONNECT: 'CONNECT',
  HTTP2_METHOD_COPY: 'COPY',
  HTTP2_METHOD_DELETE: 'DELETE',
  HTTP2_METHOD_GET: 'GET',
  HTTP2_METHOD_HEAD: 'HEAD',
  HTTP2_METHOD_LABEL: 'LABEL',
  HTTP2_METHOD_LINK: 'LINK',
  HTTP2_METHOD_LOCK: 'LOCK',
  HTTP2_METHOD_MERGE: 'MERGE',
  HTTP2_METHOD_MKACTIVITY: 'MKACTIVITY',
  HTTP2_METHOD_MKCALENDAR: 'MKCALENDAR',
  HTTP2_METHOD_MKCOL: 'MKCOL',
  HTTP2_METHOD_MKREDIRECTREF: 'MKREDIRECTREF',
  HTTP2_METHOD_MKWORKSPACE: 'MKWORKSPACE',
  HTTP2_METHOD_MOVE: 'MOVE',
  HTTP2_METHOD_OPTIONS: 'OPTIONS',
  HTTP2_METHOD_ORDERPATCH: 'ORDERPATCH',
  HTTP2_METHOD_PATCH: 'PATCH',
  HTTP2_METHOD_POST: 'POST',
  HTTP2_METHOD_PRI: 'PRI',
  HTTP2_METHOD_PROPFIND: 'PROPFIND',
  HTTP2_METHOD_PROPPATCH: 'PROPPATCH',
  HTTP2_METHOD_PUT: 'PUT',
  HTTP2_METHOD_REBIND: 'REBIND',
  HTTP2_METHOD_REPORT: 'REPORT',
  HTTP2_METHOD_SEARCH: 'SEARCH',
  HTTP2_METHOD_TRACE: 'TRACE',
  HTTP2_METHOD_UNBIND: 'UNBIND',
  HTTP2_METHOD_UNCHECKOUT: 'UNCHECKOUT',
  HTTP2_METHOD_UNLINK: 'UNLINK',
  HTTP2_METHOD_UNLOCK: 'UNLOCK',
  HTTP2_METHOD_UPDATE: 'UPDATE',
  HTTP2_METHOD_UPDATEREDIRECTREF: 'UPDATEREDIRECTREF',
  HTTP2_METHOD_VERSION_CONTROL: 'VERSION-CONTROL',
  HTTP_STATUS_CONTINUE: 100,
  HTTP_STATUS_SWITCHING_PROTOCOLS: 101,
  HTTP_STATUS_PROCESSING: 102,
  HTTP_STATUS_EARLY_HINTS: 103,
  HTTP_STATUS_OK: 200,
  HTTP_STATUS_CREATED: 201,
  HTTP_STATUS_ACCEPTED: 202,
  HTTP_STATUS_NON_AUTHORITATIVE_INFORMATION: 203,
  HTTP_STATUS_NO_CONTENT: 204,
  HTTP_STATUS_RESET_CONTENT: 205,
  HTTP_STATUS_PARTIAL_CONTENT: 206,
  HTTP_STATUS_MULTI_STATUS: 207,
  HTTP_STATUS_ALREADY_REPORTED: 208,
  HTTP_STATUS_IM_USED: 226,
  HTTP_STATUS_MULTIPLE_CHOICES: 300,
  HTTP_STATUS_MOVED_PERMANENTLY: 301,
  HTTP_STATUS_FOUND: 302,
  HTTP_STATUS_SEE_OTHER: 303,
  HTTP_STATUS_NOT_MODIFIED: 304,
  HTTP_STATUS_USE_PROXY: 305,
  HTTP_STATUS_TEMPORARY_REDIRECT: 307,
  HTTP_STATUS_PERMANENT_REDIRECT: 308,
  HTTP_STATUS_BAD_REQUEST: 400,
  HTTP_STATUS_UNAUTHORIZED: 401,
  HTTP_STATUS_PAYMENT_REQUIRED: 402,
  HTTP_STATUS_FORBIDDEN: 403,
  HTTP_STATUS_NOT_FOUND: 404,
  HTTP_STATUS_METHOD_NOT_ALLOWED: 405,
  HTTP_STATUS_NOT_ACCEPTABLE: 406,
  HTTP_STATUS_PROXY_AUTHENTICATION_REQUIRED: 407,
  HTTP_STATUS_REQUEST_TIMEOUT: 408,
  HTTP_STATUS_CONFLICT: 409,
  HTTP_STATUS_GONE: 410,
  HTTP_STATUS_LENGTH_REQUIRED: 411,
  HTTP_STATUS_PRECONDITION_FAILED: 412,
  HTTP_STATUS_PAYLOAD_TOO_LARGE: 413,
  HTTP_STATUS_URI_TOO_LONG: 414,
  HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE: 415,
  HTTP_STATUS_RANGE_NOT_SATISFIABLE: 416,
  HTTP_STATUS_EXPECTATION_FAILED: 417,
  HTTP_STATUS_TEAPOT: 418,
  HTTP_STATUS_MISDIRECTED_REQUEST: 421,
  HTTP_STATUS_UNPROCESSABLE_ENTITY: 422,
  HTTP_STATUS_LOCKED: 423,
  HTTP_STATUS_FAILED_DEPENDENCY: 424,
  HTTP_STATUS_TOO_EARLY: 425,
  HTTP_STATUS_UPGRADE_REQUIRED: 426,
  HTTP_STATUS_PRECONDITION_REQUIRED: 428,
  HTTP_STATUS_TOO_MANY_REQUESTS: 429,
  HTTP_STATUS_REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  HTTP_STATUS_UNAVAILABLE_FOR_LEGAL_REASONS: 451,
  HTTP_STATUS_INTERNAL_SERVER_ERROR: 500,
  HTTP_STATUS_NOT_IMPLEMENTED: 501,
  HTTP_STATUS_BAD_GATEWAY: 502,
  HTTP_STATUS_SERVICE_UNAVAILABLE: 503,
  HTTP_STATUS_GATEWAY_TIMEOUT: 504,
  HTTP_STATUS_HTTP_VERSION_NOT_SUPPORTED: 505,
  HTTP_STATUS_VARIANT_ALSO_NEGOTIATES: 506,
  HTTP_STATUS_INSUFFICIENT_STORAGE: 507,
  HTTP_STATUS_LOOP_DETECTED: 508,
  HTTP_STATUS_BANDWIDTH_LIMIT_EXCEEDED: 509,
  HTTP_STATUS_NOT_EXTENDED: 510,
  HTTP_STATUS_NETWORK_AUTHENTICATION_REQUIRED: 511,
} as const;

/** Marks headers that must not be compressed; as Node's, a unique symbol. */
export const sensitiveHeaders: unique symbol = Symbol('sensitiveHeaders');

export interface Settings {
  headerTableSize?: number;
  enablePush?: boolean;
  initialWindowSize?: number;
  maxFrameSize?: number;
  maxConcurrentStreams?: number;
  maxHeaderListSize?: number;
  maxHeaderSize?: number;
  enableConnectProtocol?: boolean;
  customSettings?: Record<number, number>;
}

export type IncomingHttpHeaders = Record<string, string | string[] | undefined>;
export type OutgoingHttpHeaders = Record<
  string | symbol,
  number | string | readonly string[] | undefined
>;

const DEFAULT_SETTINGS: Settings = {
  headerTableSize: constants.DEFAULT_SETTINGS_HEADER_TABLE_SIZE,
  enablePush: constants.DEFAULT_SETTINGS_ENABLE_PUSH === 1,
  initialWindowSize: constants.DEFAULT_SETTINGS_INITIAL_WINDOW_SIZE,
  maxFrameSize: constants.DEFAULT_SETTINGS_MAX_FRAME_SIZE,
  maxConcurrentStreams: 4294967295,
  maxHeaderSize: 65535,
  maxHeaderListSize: 65535,
  enableConnectProtocol: false,
};

export function getDefaultSettings(): Settings {
  // As Node's, an object without a prototype
  return Object.assign(Object.create(null), DEFAULT_SETTINGS);
}

/** Http2Session's state, as Node reports it. A stub session has none. */
export interface SessionState {
  effectiveLocalWindowSize?: number;
  effectiveRecvDataLength?: number;
  nextStreamID?: number;
  localWindowSize?: number;
  lastProcStreamID?: number;
  remoteWindowSize?: number;
  outboundQueueSize?: number;
  deflateDynamicTableSize?: number;
  inflateDynamicTableSize?: number;
}

/** Node's Http2Session: a stub that never connects. */
export class Http2Session extends EventEmitter {
  readonly alpnProtocol: string | undefined = undefined;
  readonly closed: boolean = false;
  readonly connecting: boolean = false;
  readonly destroyed: boolean = false;
  readonly encrypted: boolean | undefined = undefined;
  readonly localSettings: Settings = getDefaultSettings();
  readonly originSet: string[] | undefined = undefined;
  readonly pendingSettingsAck: boolean = false;
  readonly remoteSettings: Settings = getDefaultSettings();
  readonly socket: unknown = null;
  readonly state: SessionState = {};
  readonly type: number;

  /** @internal */
  constructor(type: number) {
    super();
    this.type = type;
  }

  close(_callback?: () => void): void {}
  destroy(_error?: Error, _code?: number): void {}
  goaway(
    _code?: number,
    _lastStreamID?: number,
    _opaqueData?: Uint8Array,
  ): void {}
  ping(_payload?: unknown, _callback?: unknown): boolean {
    return false;
  }
  ref(): void {}
  unref(): void {}
  setLocalWindowSize(_windowSize: number): void {}
  setTimeout(_msecs: number, _callback?: () => void): void {}
  settings(_settings: Settings, _callback?: unknown): void {}
}

/** Node's ClientHttp2Session: what connect() returns. */
export class ClientHttp2Session extends Http2Session {
  /** @internal */
  constructor() {
    super(constants.NGHTTP2_SESSION_CLIENT);
  }

  /** Returns a stream that never sends or receives anything. */
  request(
    _headers?: OutgoingHttpHeaders,
    _options?: unknown,
  ): ClientHttp2Stream {
    return new ClientHttp2Stream(this);
  }
}

/** Node's ServerHttp2Session. */
export class ServerHttp2Session extends Http2Session {
  readonly server: unknown;

  /** @internal */
  constructor(server?: unknown) {
    super(constants.NGHTTP2_SESSION_SERVER);
    this.server = server;
  }

  altsvc(_alt: string, _originOrStream: unknown): void {}
  origin(..._origins: unknown[]): void {}
}

/** Http2Stream's state, as Node reports it. A stub stream has none. */
export interface StreamState {
  localWindowSize?: number;
  state?: number;
  localClose?: number;
  remoteClose?: number;
  sumDependencyWeight?: number;
  weight?: number;
}

/** Node's Http2Stream: a stub Duplex that never reads or writes. */
export class Http2Stream extends Duplex {
  readonly aborted: boolean = false;
  readonly bufferSize: number = 0;
  readonly closed: boolean = false;
  readonly endAfterHeaders: boolean = false;
  readonly id: number | undefined = undefined;
  readonly pending: boolean = true;
  readonly rstCode: number | undefined = undefined;
  readonly sentHeaders: OutgoingHttpHeaders = {};
  readonly sentInfoHeaders: OutgoingHttpHeaders[] | undefined = undefined;
  readonly sentTrailers: OutgoingHttpHeaders | undefined = undefined;
  readonly session: Http2Session | undefined;
  readonly state: StreamState = {};

  /** @internal */
  constructor(session?: Http2Session) {
    super();
    this.session = session;
  }

  override _read(_size: number): void {}
  override _write(
    _chunk: unknown,
    _encoding: string,
    _callback: (error?: Error | null) => void,
  ): void {}

  close(_code?: number, _callback?: () => void): void {}
  priority(_options: unknown): void {}
  sendTrailers(_headers: OutgoingHttpHeaders): void {}
  setTimeout(_msecs: number, _callback?: () => void): void {}
}

/** Node's ClientHttp2Stream: what session.request() returns. */
export class ClientHttp2Stream extends Http2Stream {}

/** Node's ServerHttp2Stream. */
export class ServerHttp2Stream extends Http2Stream {
  readonly headersSent: boolean = false;
  readonly pushAllowed: boolean = false;

  additionalHeaders(_headers: OutgoingHttpHeaders): void {}
  pushStream(
    _headers: OutgoingHttpHeaders,
    _options?: unknown,
    _callback?: unknown,
  ): void {}
  respond(_headers?: OutgoingHttpHeaders, _options?: unknown): void {}
  respondWithFD(
    _fd: unknown,
    _headers?: OutgoingHttpHeaders,
    _options?: unknown,
  ): void {}
  respondWithFile(
    _path: string,
    _headers?: OutgoingHttpHeaders,
    _options?: unknown,
  ): void {}
}

/** Node's Http2ServerRequest: a stub Readable that never has data. */
export class Http2ServerRequest extends Readable {
  readonly aborted: boolean = false;
  readonly authority: string = '';
  readonly complete: boolean = false;
  readonly headers: IncomingHttpHeaders;
  readonly httpVersion: string = '2.0';
  readonly httpVersionMajor: number = 2;
  readonly httpVersionMinor: number = 0;
  readonly method: string = '';
  readonly rawHeaders: string[];
  readonly rawTrailers: string[] = [];
  readonly scheme: string = '';
  readonly stream: ServerHttp2Stream;
  readonly trailers: IncomingHttpHeaders = {};
  url: string = '';

  constructor(
    stream: ServerHttp2Stream,
    headers: IncomingHttpHeaders = {},
    _options?: unknown,
    rawHeaders: string[] = [],
  ) {
    super();
    this.stream = stream;
    this.headers = headers;
    this.rawHeaders = rawHeaders;
  }

  get socket(): unknown {
    return null;
  }

  get connection(): unknown {
    return null;
  }

  override _read(_size: number): void {}

  setTimeout(_msecs: number, _callback?: () => void): this {
    return this;
  }
}

/** Node's Http2ServerResponse: a stub that sends nothing. */
export class Http2ServerResponse extends Stream {
  readonly finished: boolean = false;
  readonly headersSent: boolean = false;
  readonly req: Http2ServerRequest | undefined = undefined;
  sendDate: boolean = true;
  statusCode: number = 200;
  statusMessage: string = '';
  readonly stream: ServerHttp2Stream;
  readonly writableEnded: boolean = false;
  private readonly _headers = new Map<
    string,
    number | string | readonly string[]
  >();

  constructor(stream: ServerHttp2Stream) {
    super();
    this.stream = stream;
  }

  get socket(): unknown {
    return null;
  }

  get connection(): unknown {
    return null;
  }

  addTrailers(_trailers: OutgoingHttpHeaders): void {}
  appendHeader(_name: string, _value: string | string[]): this {
    return this;
  }
  createPushResponse(_headers: OutgoingHttpHeaders, _callback: unknown): void {}
  end(_data?: unknown, _encoding?: unknown, _callback?: unknown): this {
    return this;
  }
  getHeader(name: string): number | string | readonly string[] | undefined {
    return this._headers.get(name.toLowerCase());
  }
  getHeaderNames(): string[] {
    return [...this._headers.keys()];
  }
  getHeaders(): OutgoingHttpHeaders {
    return Object.fromEntries(this._headers);
  }
  hasHeader(name: string): boolean {
    return this._headers.has(name.toLowerCase());
  }
  removeHeader(name: string): void {
    this._headers.delete(name.toLowerCase());
  }
  setHeader(name: string, value: number | string | readonly string[]): this {
    this._headers.set(name.toLowerCase(), value);
    return this;
  }
  setTimeout(_msecs: number, _callback?: () => void): this {
    return this;
  }
  write(_chunk: unknown, _encoding?: unknown, _callback?: unknown): boolean {
    return true;
  }
  writeContinue(): void {}
  writeEarlyHints(_hints: Record<string, string | string[]>): void {}
  writeHead(
    statusCode: number,
    _statusMessageOrHeaders?: unknown,
    _headers?: unknown,
  ): this {
    this.statusCode = statusCode;
    return this;
  }
}

/** Node's Http2Server: a stub that never listens. */
export class Http2Server extends EventEmitter {
  readonly listening: boolean = false;
  timeout: number = 0;

  /** @internal */
  constructor(onRequestHandler?: (...args: any[]) => void) {
    super();
    if (onRequestHandler !== undefined) {
      this.on('request', onRequestHandler);
    }
  }

  address(): null {
    return null;
  }
  close(_callback?: (error?: Error) => void): this {
    return this;
  }
  listen(..._args: unknown[]): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  setTimeout(_msecs?: number, _callback?: () => void): this {
    return this;
  }
  updateSettings(_settings: Settings): void {}
}

/** Node's Http2SecureServer. */
export class Http2SecureServer extends Http2Server {}

type RequestHandler = (
  request: Http2ServerRequest,
  response: Http2ServerResponse,
) => void;

export function createServer(onRequestHandler?: RequestHandler): Http2Server;
export function createServer(
  options: unknown,
  onRequestHandler?: RequestHandler,
): Http2Server;
export function createServer(
  optionsOrHandler?: unknown,
  onRequestHandler?: RequestHandler,
): Http2Server {
  return new Http2Server(
    typeof optionsOrHandler === 'function'
      ? (optionsOrHandler as RequestHandler)
      : onRequestHandler,
  );
}

export function createSecureServer(
  onRequestHandler?: RequestHandler,
): Http2SecureServer;
export function createSecureServer(
  options: unknown,
  onRequestHandler?: RequestHandler,
): Http2SecureServer;
export function createSecureServer(
  optionsOrHandler?: unknown,
  onRequestHandler?: RequestHandler,
): Http2SecureServer {
  return new Http2SecureServer(
    typeof optionsOrHandler === 'function'
      ? (optionsOrHandler as RequestHandler)
      : onRequestHandler,
  );
}

/**
 * Returns a session that never connects: the listener, a 'connect' listener,
 * is never called.
 */
export function connect(
  _authority: string | URL,
  optionsOrListener?: unknown,
  listener?: (session: ClientHttp2Session, socket: unknown) => void,
): ClientHttp2Session {
  const session = new ClientHttp2Session();
  const onConnect =
    typeof optionsOrListener === 'function' ? optionsOrListener : listener;
  if (typeof onConnect === 'function') {
    session.once('connect', onConnect as (...args: any[]) => void);
  }
  return session;
}

/** Returns a server session on `socket` that never exchanges anything. */
export function performServerHandshake(
  _socket: unknown,
  _options?: unknown,
): ServerHttp2Session {
  return new ServerHttp2Session();
}
