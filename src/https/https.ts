import * as http from '../http';
import * as tls from '../tls';

// types
import type { RequestOptions, URLLike } from '../http';
import type { IncomingMessage } from '../http';
import type { Socket } from '../net';

export type { RequestOptions };

type ResponseCallback = (res: IncomingMessage) => void;

export class ClientRequest extends http.ClientRequest {
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
    const socket = tls.connect({ host: options.host, port: options.port });

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
    socket.once('secureConnect', onConnect);

    return socket;
  }
}

/**
 * Not available yet: TLS does not verify certificates, so requests over it
 * would not be secure. Throws.
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
export function request(): ClientRequest {
  throw new Error('https.request() is not implemented yet');
}

/**
 * Not available yet: TLS does not verify certificates, so requests over it
 * would not be secure. Throws.
 */
export function get(
  url: string | URLLike | RequestOptions,
  callback?: ResponseCallback,
): ClientRequest;
export function get(
  url: string | URLLike,
  options: RequestOptions,
  callback?: ResponseCallback,
): ClientRequest;
export function get(): ClientRequest {
  throw new Error('https.get() is not implemented yet');
}
