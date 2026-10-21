import * as http from '../http';
import * as tls from '../tls';

// types
import type { URLLike } from '../http';
import type { IncomingMessage } from '../http';
import type { Socket } from '../net';

/** Node's https.RequestOptions, the supported part of it. */
export interface RequestOptions extends http.RequestOptions {
  /** The name the server's certificate has to match. Defaults to the host. */
  servername?: string;
  /**
   * Fail when the server's certificate can't be verified against the system's
   * trust store. Defaults to true.
   */
  rejectUnauthorized?: boolean;
}

type ResponseCallback = (res: IncomingMessage) => void;

/** Node's https.AgentOptions, the supported part of it. */
export interface AgentOptions extends http.AgentOptions {
  /** Accepted for compatibility: TLS sessions are not cached yet. */
  maxCachedSessions?: number;
}

/** Node's https.Agent: an http.Agent whose connections use TLS. */
export class Agent extends http.Agent {
  public defaultPort: number = 443;
  public protocol: string = 'https:';
  public maxCachedSessions: number;

  constructor(options?: AgentOptions) {
    super(options);
    this.maxCachedSessions = options?.maxCachedSessions ?? 100;
  }

  public createConnection(
    options: RequestOptions,
    callback?: () => void,
  ): Socket {
    return tls.connect(
      {
        host: options.host || 'localhost',
        port: options.port || this.defaultPort,
        family: options.family,
        lookup: options.lookup,
        // As Node's https.Agent: the host, unless one is given
        servername: options.servername ?? options.host,
        rejectUnauthorized: options.rejectUnauthorized,
      },
      callback,
    );
  }

  /**
   * As Node's: the TLS options that change the connection are part of the
   * name, so connections with different ones are never shared. Only the
   * ones this library supports can be set.
   */
  public getName(options: RequestOptions = {}): string {
    let name = super.getName(options);
    // ca, cert, clientCertEngine, ciphers, key, pfx: not supported
    name += '::::::';
    name += ':';
    if (options.rejectUnauthorized !== undefined) {
      name += options.rejectUnauthorized;
    }
    name += ':';
    if (options.servername && options.servername !== options.host) {
      name += options.servername;
    }
    // minVersion, maxVersion, secureProtocol, crl, honorCipherOrder,
    // ecdhCurve, dhparam, secureOptions, sessionIdContext, sigalgs,
    // privateKeyIdentifier, privateKeyEngine: not supported
    name += '::::::::::::';
    return name;
  }
}

export class ClientRequest extends http.ClientRequest {
  constructor(url: string | URLLike | RequestOptions, callback?: ResponseCallback);
  constructor(url: string | URLLike, options: RequestOptions, callback?: ResponseCallback);
  constructor(
    urlOrOptions: string | URLLike | RequestOptions,
    optionsOrCallback?: RequestOptions | ResponseCallback,
    callback?: ResponseCallback,
  ) {
    super(urlOrOptions as string, optionsOrCallback as RequestOptions, callback);
  }

  protected get _protocol(): string {
    return 'https:';
  }

  protected get _defaultPort(): number {
    return 443;
  }

  protected get _defaultAgent(): http.Agent {
    return globalAgent;
  }
}

/** As Node's (19+): connections are kept for reuse, up to 5 s unused. */
export const globalAgent = new Agent({
  keepAlive: true,
  scheduling: 'lifo',
  timeout: 5000,
});

/** Like http.request(), over TLS. */
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
