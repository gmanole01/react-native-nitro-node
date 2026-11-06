#include "SockAddrUtil.hpp"

#include <netinet/in.h>
#include <string>

#include "UVLoop.hpp"

namespace margelo::nitro::node {

int parseSockAddr(const std::string& host, int port, struct sockaddr_storage* out) {
  if (uv_ip4_addr(host.c_str(), port, (struct sockaddr_in*) out) == 0) {
    return 0;
  }
  return uv_ip6_addr(host.c_str(), port, (struct sockaddr_in6*) out);
}

std::variant<nitro::NullType, SockAddr> toSockAddr(const struct sockaddr* addr) {
  char ip[INET6_ADDRSTRLEN] = {0};
  int port = 0;

  if (addr->sa_family == AF_INET) {
    auto* in4 = (const struct sockaddr_in*) addr;
    uv_ip4_name(in4, ip, sizeof(ip));
    port = ntohs(in4->sin_port);
  } else if (addr->sa_family == AF_INET6) {
    auto* in6 = (const struct sockaddr_in6*) addr;
    uv_ip6_name(in6, ip, sizeof(ip));
    port = ntohs(in6->sin6_port);
  } else {
    return nitro::NullType();
  }

  return SockAddr(std::string(ip), static_cast<double>(port));
}

std::variant<nitro::NullType, SockAddr> sockAddrOf(uv_tcp_t* handle, SockAddrEnd end) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  if (handle == nullptr || uv_is_closing((uv_handle_t*) handle)) {
    return nitro::NullType();
  }

  struct sockaddr_storage addr;
  int len = sizeof(addr);

  int r = end == SockAddrEnd::Peer ? uv_tcp_getpeername(handle, (struct sockaddr*) &addr, &len)
                                   : uv_tcp_getsockname(handle, (struct sockaddr*) &addr, &len);
  if (r != 0) {
    return nitro::NullType();
  }
  return toSockAddr((struct sockaddr*) &addr);
}

std::variant<nitro::NullType, SockAddr> sockAddrOf(uv_udp_t* handle, SockAddrEnd end) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  if (handle == nullptr || uv_is_closing((uv_handle_t*) handle)) {
    return nitro::NullType();
  }

  struct sockaddr_storage addr;
  int len = sizeof(addr);

  int r = end == SockAddrEnd::Peer ? uv_udp_getpeername(handle, (struct sockaddr*) &addr, &len)
                                   : uv_udp_getsockname(handle, (struct sockaddr*) &addr, &len);
  if (r != 0) {
    return nitro::NullType();
  }
  return toSockAddr((struct sockaddr*) &addr);
}

} // namespace margelo::nitro::node
