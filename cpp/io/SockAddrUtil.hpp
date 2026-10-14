#pragma once

#include <string>
#include <variant>
#include <uv.h>

#include <NitroModules/Null.hpp>

#include "SockAddr.hpp"

namespace margelo::nitro::node {

// Which end of a connection an address belongs to.
enum class SockAddrEnd {
  Local, // our side (getsockname)
  Peer,  // the remote side (getpeername)
};

// Parses a numeric IPv4 or IPv6 address into `out`. Returns 0 or a libuv error
// code. Host names are not resolved here, that is done on the JS side.
int parseSockAddr(const std::string& host, int port, struct sockaddr_storage* out);

// Reads the address of the given end of `handle`. Must be called on the UV loop
// thread. Returns NullType on any failure.
std::variant<nitro::NullType, SockAddr> sockAddrOf(uv_tcp_t* handle, SockAddrEnd end);

} // namespace margelo::nitro::node
