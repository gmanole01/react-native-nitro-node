// @ts-nocheck
/**
 * Node 22's lib/internal/dgram.js, ported: the UDP handles of dgram sockets
 * (see ./binding), with the dns lookup they resolve addresses with. Not
 * type-checked: it stays Node's JavaScript.
 */
/* eslint-disable */
import { primordials } from '../util/primordials';
import { ERR_SOCKET_BAD_TYPE, isInt32 } from '../node-errors';
import { UDP } from './binding';
import { validateFunction } from '../node-internals';
import { UV_EINVAL } from '../uv';
import * as dns from '../dns/dns';

// No file descriptors to open in an app: none is a UDP socket
function guessHandleType(fd) {
  return 'UNKNOWN';
}

// Plain globals (Symbol) are not taken from primordials, see ../util
const {
  FunctionPrototypeBind,
} = primordials;

const kStateSymbol = Symbol('state symbol');


function lookup4(lookup, address, callback) {
  return lookup(address || '127.0.0.1', 4, callback);
}


function lookup6(lookup, address, callback) {
  return lookup(address || '::1', 6, callback);
}

function newHandle(type, lookup) {
  if (lookup === undefined) {
    lookup = dns.lookup;
  } else {
    validateFunction(lookup, 'lookup');
  }

  if (type === 'udp4') {
    const handle = new UDP();

    handle.lookup = FunctionPrototypeBind(lookup4, handle, lookup);
    return handle;
  }

  if (type === 'udp6') {
    const handle = new UDP();

    handle.lookup = FunctionPrototypeBind(lookup6, handle, lookup);
    handle.bind = handle.bind6;
    handle.connect = handle.connect6;
    handle.send = handle.send6;
    return handle;
  }

  throw new ERR_SOCKET_BAD_TYPE();
}


function _createSocketHandle(address, port, addressType, fd, flags) {
  const handle = newHandle(addressType);
  let err;

  if (isInt32(fd) && fd > 0) {
    const type = guessHandleType(fd);
    if (type !== 'UDP') {
      err = UV_EINVAL;
    } else {
      err = handle.open(fd);
    }
  } else if (port || address) {
    err = handle.bind(address, port || 0, flags);
  }

  if (err) {
    handle.close();
    return err;
  }

  return handle;
}


export {
  kStateSymbol,
  _createSocketHandle,
  newHandle,
};
