/**
 * Node's dgram, ported from Node 22 (lib/dgram.js and lib/internal/dgram.js)
 * on libuv's UDP sockets: createSocket() and dgram.Socket.
 */
import type { EventEmitter } from 'events';
import type { Buffer } from 'buffer';
import * as impl from './dgram';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SocketType = 'udp4' | 'udp6';

/** Who sent a datagram. */
export interface RemoteInfo {
  address: string;
  family: 'IPv4' | 'IPv6';
  port: number;
  size: number;
}

export interface AddressInfo {
  address: string;
  family: string;
  port: number;
}

export interface BindOptions {
  port?: number;
  address?: string;
  exclusive?: boolean;
  fd?: number;
}

/** What check() answers for: Node's net.BlockList, or anything like it. */
export interface BlockListLike {
  check(address: string, family?: string): boolean;
}

export interface SocketOptions {
  type: SocketType;
  reuseAddr?: boolean;
  reusePort?: boolean;
  ipv6Only?: boolean;
  recvBufferSize?: number;
  sendBufferSize?: number;
  lookup?: (
    hostname: string,
    family: number,
    callback: (err: Error | null, address: string, family: number) => void,
  ) => void;
  signal?: AbortSignal;
  receiveBlockList?: BlockListLike;
  sendBlockList?: BlockListLike;
}

type MessageListener = (msg: Buffer, rinfo: RemoteInfo) => void;
type SendCallback = (error: Error | null, bytes?: number) => void;
type Message =
  string | ArrayBufferView | ReadonlyArray<string | ArrayBufferView>;

/** Node's dgram.Socket. */
export interface Socket extends EventEmitter {
  readonly type: SocketType;

  addMembership(multicastAddress: string, multicastInterface?: string): void;
  dropMembership(multicastAddress: string, multicastInterface?: string): void;
  addSourceSpecificMembership(
    sourceAddress: string,
    groupAddress: string,
    multicastInterface?: string,
  ): void;
  dropSourceSpecificMembership(
    sourceAddress: string,
    groupAddress: string,
    multicastInterface?: string,
  ): void;

  address(): AddressInfo;
  remoteAddress(): AddressInfo;

  bind(port?: number, address?: string, callback?: () => void): this;
  bind(port?: number, callback?: () => void): this;
  bind(callback?: () => void): this;
  bind(options: BindOptions, callback?: () => void): this;

  close(callback?: () => void): this;

  connect(port: number, address?: string, callback?: () => void): void;
  connect(port: number, callback: () => void): void;
  disconnect(): void;

  send(
    msg: Message,
    port?: number,
    address?: string,
    callback?: SendCallback,
  ): void;
  send(msg: Message, port?: number, callback?: SendCallback): void;
  send(msg: Message, callback?: SendCallback): void;
  send(
    msg: string | ArrayBufferView,
    offset: number,
    length: number,
    port?: number,
    address?: string,
    callback?: SendCallback,
  ): void;
  send(
    msg: string | ArrayBufferView,
    offset: number,
    length: number,
    port?: number,
    callback?: SendCallback,
  ): void;
  send(
    msg: string | ArrayBufferView,
    offset: number,
    length: number,
    callback?: SendCallback,
  ): void;

  setBroadcast(flag: boolean): void;
  setMulticastInterface(multicastInterface: string): void;
  setMulticastLoopback(flag: boolean): boolean;
  setMulticastTTL(ttl: number): number;
  setTTL(ttl: number): number;

  setRecvBufferSize(size: number): void;
  setSendBufferSize(size: number): void;
  getRecvBufferSize(): number;
  getSendBufferSize(): number;
  getSendQueueSize(): number;
  getSendQueueCount(): number;

  ref(): this;
  unref(): this;

  on(event: 'close', listener: () => void): this;
  on(event: 'connect', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'listening', listener: () => void): this;
  on(event: 'message', listener: MessageListener): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: 'close', listener: () => void): this;
  once(event: 'connect', listener: () => void): this;
  once(event: 'error', listener: (err: Error) => void): this;
  once(event: 'listening', listener: () => void): this;
  once(event: 'message', listener: MessageListener): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
}

export interface SocketConstructor {
  new (type: SocketType | SocketOptions, callback?: MessageListener): Socket;
  prototype: Socket;
}

export const Socket = impl.Socket as unknown as SocketConstructor;

export const createSocket = impl.createSocket as (
  type: SocketType | SocketOptions,
  callback?: MessageListener,
) => Socket;

export default { createSocket, Socket };
