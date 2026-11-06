/**
 * Node's internalBinding('udp_wrap') for lib/dgram.js, on the
 * NitroNodeDgramSocket HybridObject: the same UDP handle API (bind(),
 * send(), recvStart(), getsockname(), bufferSize(), ..., onmessage) and
 * SendWrap, so the ported dgram.js code stays as it is.
 */
import { Buffer } from 'buffer';
import { createNitroDgramSocket } from '../native';
import type { NitroNodeDgramSocket, SockAddr } from '../native';
import { isIPv4, isIPv6 } from '../ip';
import { collectUVExceptionInfo } from '../node-errors';
import { generateWriteId } from '../utils';
import { UV_EBADF, UV_EINVAL, UV_ENOTCONN, UV_ENOTSUP } from '../uv';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const owner_symbol = Symbol('owner_symbol');

// libuv's uv_udp_flags
export const constants = Object.freeze({
  UV_UDP_IPV6ONLY: 1,
  UV_UDP_REUSEPORT: 64,
});
export const UV_UDP_REUSEADDR = 4;

/** What a send keeps until it completes: lib/dgram.js sets the fields. */
export class SendWrap {
  list?: Buffer[];
  address?: string;
  port?: number;
  callback?: (err: Error | null, sent?: number) => void;
  oncomplete?: (status: number, sent: number) => void;
}

interface PendingSend {
  req: SendWrap;
  size: number;
  hasCallback: boolean;
}

interface AddressInfo {
  address?: string;
  family?: string;
  port?: number;
}

let nextAsyncId = 1;

function noop() {}

function familyOf(ip: string): string {
  return isIPv6(ip) ? 'IPv6' : 'IPv4';
}

/** The bytes of `buf` as their own ArrayBuffer: a Buffer is often a slice of a shared pool. */
function arrayBufferOf(buf: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = buf;
  if (byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer as ArrayBuffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

/** The handle of one dgram socket, as Node's UDPWrap. */
export class UDP {
  [owner_symbol]: any;
  lookup: any;
  onmessage:
    | ((nread: number, handle: UDP, buf?: Buffer, rinfo?: AddressInfo) => void)
    | null = null;
  onerror: ((nread: number, handle: UDP, error: Error) => void) | null = null;

  private readonly _native: NitroNodeDgramSocket = createNitroDgramSocket();
  private readonly _sends = new Map<number, PendingSend>();
  private readonly _asyncId = nextAsyncId++;
  private _attached = false;
  private _hasRef = true;
  private _onclose: (() => void) | null = null;

  /**
   * Hands the native socket the callbacks, once it has something to report:
   * they reference this handle, and a callback the native object holds is a
   * GC root, so from here on the handle stays alive until closed, as a
   * receiving socket in Node keeps going. A socket that never sends nor
   * receives can still be collected. onClose lets go of them.
   */
  private _attach() {
    if (this._attached) {
      return;
    }
    this._attached = true;
    const self = this;
    this._native.onMessage = (data, from, status) =>
      self._onMessage(data, from, status);
    this._native.onSend = (id, status) => self._onSend(id, status);
    this._native.onClose = () => self._onClose();
  }

  private _onMessage(
    data: ArrayBuffer,
    from: SockAddr | null | undefined,
    status: number,
  ) {
    if (status < 0 || from == null) {
      this.onmessage?.(status, this);
      return;
    }
    const rinfo = {
      address: from.ip,
      family: familyOf(from.ip),
      port: from.port,
    };
    this.onmessage?.(status, this, Buffer.from(data), rinfo);
  }

  private _onSend(id: number, status: number) {
    const pending = this._sends.get(id);
    if (pending === undefined) {
      return;
    }
    this._sends.delete(id);
    if (pending.hasCallback) {
      pending.req.oncomplete?.(status, pending.size);
    }
  }

  private _onClose() {
    this._native.onMessage = noop;
    this._native.onSend = noop;
    this._native.onClose = noop;
    this._sends.clear();
    const cb = this._onclose;
    this._onclose = null;
    cb?.();
  }

  bind(ip: string, port: number, flags: number): number {
    return this._bind(ip, port, flags, isIPv4);
  }

  bind6(ip: string, port: number, flags: number): number {
    return this._bind(ip, port, flags, isIPv6);
  }

  private _bind(
    ip: string,
    port: number,
    flags: number,
    isFamily: (ip: string) => boolean,
  ): number {
    if (!isFamily(ip)) {
      return UV_EINVAL;
    }
    return this._native.bind(ip, port, flags);
  }

  connect(ip: string, port: number): number {
    return isIPv4(ip) ? this._native.connect(ip, port) : UV_EINVAL;
  }

  connect6(ip: string, port: number): number {
    return isIPv6(ip) ? this._native.connect(ip, port) : UV_EINVAL;
  }

  disconnect(): number {
    return this._native.disconnect();
  }

  open(_fd: number): number {
    return UV_ENOTSUP;
  }

  // send(req, list, count, port, ip, hasCallback), or for a connected
  // socket send(req, list, count, hasCallback)
  send(req: SendWrap, list: Buffer[], count: number, ...rest: any[]): number {
    return this._send(isIPv4, req, list, count, rest);
  }

  send6(req: SendWrap, list: Buffer[], count: number, ...rest: any[]): number {
    return this._send(isIPv6, req, list, count, rest);
  }

  private _send(
    isFamily: (ip: string) => boolean,
    req: SendWrap,
    list: Buffer[],
    count: number,
    rest: any[],
  ): number {
    const sendTo = rest.length === 3;
    let to: SockAddr | undefined;
    if (sendTo) {
      const [port, ip] = rest as [number, string];
      if (!isFamily(ip)) {
        return UV_EINVAL;
      }
      to = { ip, port };
    }
    const hasCallback = Boolean(rest[rest.length - 1]);

    const buffers: ArrayBuffer[] = [];
    let size = 0;
    for (let i = 0; i < count; i++) {
      buffers.push(arrayBufferOf(list[i]!));
      size += list[i]!.byteLength;
    }

    this._attach();
    const id = generateWriteId();
    const err = this._native.send(id, buffers, to);
    if (err === 0) {
      this._sends.set(id, { req, size, hasCallback });
    }
    return err;
  }

  recvStart(): number {
    this._attach();
    return this._native.recvStart();
  }

  recvStop(): number {
    return this._native.recvStop();
  }

  getsockname(out: AddressInfo): number {
    return this._address(this._native.getSockName(), out, UV_EBADF);
  }

  getpeername(out: AddressInfo): number {
    return this._address(this._native.getPeerName(), out, UV_ENOTCONN);
  }

  private _address(
    addr: SockAddr | null,
    out: AddressInfo,
    err: number,
  ): number {
    if (addr === null) {
      return err;
    }
    out.address = addr.ip;
    out.family = familyOf(addr.ip);
    out.port = addr.port;
    return 0;
  }

  setBroadcast(on: number): number {
    return this._native.setBroadcast(Boolean(on));
  }

  setTTL(ttl: number): number {
    return this._native.setTTL(ttl);
  }

  setMulticastTTL(ttl: number): number {
    return this._native.setMulticastTTL(ttl);
  }

  setMulticastLoopback(on: number): number {
    return this._native.setMulticastLoopback(Boolean(on));
  }

  setMulticastInterface(iface: string): number {
    return this._native.setMulticastInterface(iface);
  }

  // As Node's binding, an interface that isn't given (undefined or null) lets
  // the system pick one
  addMembership(multicastAddress: string, iface?: string | null): number {
    return this._native.addMembership(
      String(multicastAddress),
      iface == null ? undefined : String(iface),
    );
  }

  dropMembership(multicastAddress: string, iface?: string | null): number {
    return this._native.dropMembership(
      String(multicastAddress),
      iface == null ? undefined : String(iface),
    );
  }

  addSourceSpecificMembership(
    source: string,
    group: string,
    iface?: string | null,
  ): number {
    return this._native.addSourceSpecificMembership(
      source,
      group,
      iface == null ? undefined : String(iface),
    );
  }

  dropSourceSpecificMembership(
    source: string,
    group: string,
    iface?: string | null,
  ): number {
    return this._native.dropSourceSpecificMembership(
      source,
      group,
      iface == null ? undefined : String(iface),
    );
  }

  /** The size, or undefined with the error's details in `ctx`. */
  bufferSize(size: number, recv: boolean, ctx: object): number | undefined {
    const syscall = recv ? 'uv_recv_buffer_size' : 'uv_send_buffer_size';
    if (size !== (size | 0)) {
      collectUVExceptionInfo(ctx, UV_EINVAL, syscall);
      return undefined;
    }
    const ret = this._native.bufferSize(size, recv);
    if (ret < 0) {
      collectUVExceptionInfo(ctx, ret, syscall);
      return undefined;
    }
    return ret;
  }

  getSendQueueSize(): number {
    return Math.max(this._native.getSendQueueSize(), 0);
  }

  getSendQueueCount(): number {
    return Math.max(this._native.getSendQueueCount(), 0);
  }

  close(cb?: () => void): void {
    if (typeof cb === 'function') {
      this._onclose = cb;
      this._attach();
    }
    this._native.close();
  }

  // The loop never exits in an app, so there is nothing to keep it alive for
  ref(): void {
    this._hasRef = true;
  }

  unref(): void {
    this._hasRef = false;
  }

  hasRef(): boolean {
    return this._hasRef;
  }

  getAsyncId(): number {
    return this._asyncId;
  }
}
