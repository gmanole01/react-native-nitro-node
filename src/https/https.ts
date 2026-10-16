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

  protected _createConnection(
    options: RequestOptions,
    callback: (err: Error | null, socket: Socket | null) => void,
  ): Socket {
    const socket = tls.connect({
      host: options.host,
      port: options.port,
      family: options.family,
      lookup: options.lookup,
      servername: options.servername,
      rejectUnauthorized: options.rejectUnauthorized,
    });

    let called = false;
    function onSecure() {
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
    socket.once('secureConnect', onSecure);

    return socket;
  }
}

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
