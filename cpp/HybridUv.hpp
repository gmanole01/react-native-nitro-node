#pragma once

#include <uv.h>

#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

#include "HybridNitroNodeUvSpec.hpp"

#define UV_ERROR(name)                 \
  double getUV_##name() override {     \
    return UV_##name;                  \
  }

namespace margelo::nitro::node {

class HybridUv : public HybridNitroNodeUvSpec {
public:
  HybridUv() : HybridObject(TAG), HybridNitroNodeUvSpec() {}

  // Properties
  UV_ERROR(E2BIG)
  UV_ERROR(EACCES)
  UV_ERROR(EADDRINUSE)
  UV_ERROR(EADDRNOTAVAIL)
  UV_ERROR(EAFNOSUPPORT)
  UV_ERROR(EAGAIN)
  UV_ERROR(EAI_ADDRFAMILY)
  UV_ERROR(EAI_AGAIN)
  UV_ERROR(EAI_BADFLAGS)
  UV_ERROR(EAI_BADHINTS)
  UV_ERROR(EAI_CANCELED)
  UV_ERROR(EAI_FAIL)
  UV_ERROR(EAI_FAMILY)
  UV_ERROR(EAI_MEMORY)
  UV_ERROR(EAI_NODATA)
  UV_ERROR(EAI_NONAME)
  UV_ERROR(EAI_OVERFLOW)
  UV_ERROR(EAI_PROTOCOL)
  UV_ERROR(EAI_SERVICE)
  UV_ERROR(EAI_SOCKTYPE)
  UV_ERROR(EALREADY)
  UV_ERROR(EBADF)
  UV_ERROR(EBUSY)
  UV_ERROR(ECANCELED)
  UV_ERROR(ECHARSET)
  UV_ERROR(ECONNABORTED)
  UV_ERROR(ECONNREFUSED)
  UV_ERROR(ECONNRESET)
  UV_ERROR(EDESTADDRREQ)
  UV_ERROR(EEXIST)
  UV_ERROR(EFAULT)
  UV_ERROR(EFBIG)
  UV_ERROR(EHOSTUNREACH)
  UV_ERROR(EINTR)
  UV_ERROR(EINVAL)
  UV_ERROR(EIO)
  UV_ERROR(EISCONN)
  UV_ERROR(EISDIR)
  UV_ERROR(ELOOP)
  UV_ERROR(EMFILE)
  UV_ERROR(EMSGSIZE)
  UV_ERROR(ENAMETOOLONG)
  UV_ERROR(ENETDOWN)
  UV_ERROR(ENETUNREACH)
  UV_ERROR(ENFILE)
  UV_ERROR(ENOBUFS)
  UV_ERROR(ENODEV)
  UV_ERROR(ENOENT)
  UV_ERROR(ENOMEM)
  UV_ERROR(ENONET)
  UV_ERROR(ENOPROTOOPT)
  UV_ERROR(ENOSPC)
  UV_ERROR(ENOSYS)
  UV_ERROR(ENOTCONN)
  UV_ERROR(ENOTDIR)
  UV_ERROR(ENOTEMPTY)
  UV_ERROR(ENOTSOCK)
  UV_ERROR(ENOTSUP)
  UV_ERROR(EOVERFLOW)
  UV_ERROR(EPERM)
  UV_ERROR(EPIPE)
  UV_ERROR(EPROTO)
  UV_ERROR(EPROTONOSUPPORT)
  UV_ERROR(EPROTOTYPE)
  UV_ERROR(ERANGE)
  UV_ERROR(EROFS)
  UV_ERROR(ESHUTDOWN)
  UV_ERROR(ESPIPE)
  UV_ERROR(ESRCH)
  UV_ERROR(ETIMEDOUT)
  UV_ERROR(ETXTBSY)
  UV_ERROR(EXDEV)
  UV_ERROR(UNKNOWN)
  UV_ERROR(EOF)
  UV_ERROR(ENXIO)
  UV_ERROR(EMLINK)
  UV_ERROR(EHOSTDOWN)
  UV_ERROR(EREMOTEIO)
  UV_ERROR(ENOTTY)
  UV_ERROR(EFTYPE)
  UV_ERROR(EILSEQ)
  UV_ERROR(ESOCKTNOSUPPORT)
  UV_ERROR(ENODATA)
  UV_ERROR(EUNATCH)
  UV_ERROR(ENOEXEC)

  // Methods
  std::string uv_strerror(double error) override {
    return ::uv_strerror(static_cast<int>(error));
  }

  // As Node's GetInterfaceAddresses (src/node_os.cc).
  std::vector<InterfaceAddress> uv_interface_addresses() override {
    uv_interface_address_t* interfaces = nullptr;
    int count = 0;
    int err = ::uv_interface_addresses(&interfaces, &count);
    if (err == UV_ENOSYS) {
      return {};
    }
    if (err != 0) {
      throw std::runtime_error("[errno " + std::to_string(err) + "]");
    }

    std::vector<InterfaceAddress> result;
    result.reserve(count);
    for (int i = 0; i < count; i++) {
      const uv_interface_address_t& iface = interfaces[i];
      char mac[18];
      std::snprintf(mac, sizeof(mac), "%02x:%02x:%02x:%02x:%02x:%02x",
                    static_cast<unsigned char>(iface.phys_addr[0]),
                    static_cast<unsigned char>(iface.phys_addr[1]),
                    static_cast<unsigned char>(iface.phys_addr[2]),
                    static_cast<unsigned char>(iface.phys_addr[3]),
                    static_cast<unsigned char>(iface.phys_addr[4]),
                    static_cast<unsigned char>(iface.phys_addr[5]));

      char ip[INET6_ADDRSTRLEN] = {0};
      char netmask[INET6_ADDRSTRLEN] = {0};
      std::string family;
      double scopeid = -1;
      if (iface.address.address4.sin_family == AF_INET) {
        uv_ip4_name(&iface.address.address4, ip, sizeof(ip));
        uv_ip4_name(&iface.netmask.netmask4, netmask, sizeof(netmask));
        family = "IPv4";
      } else if (iface.address.address4.sin_family == AF_INET6) {
        uv_ip6_name(&iface.address.address6, ip, sizeof(ip));
        uv_ip6_name(&iface.netmask.netmask6, netmask, sizeof(netmask));
        family = "IPv6";
        scopeid = iface.address.address6.sin6_scope_id;
      } else {
        std::snprintf(ip, sizeof(ip), "<unknown sa family>");
        family = "<unknown>";
      }

      result.emplace_back(iface.name, ip, netmask, family, mac,
                          iface.is_internal != 0, scopeid);
    }
    uv_free_interface_addresses(interfaces, count);
    return result;
  }
};

} // namespace margelo::nitro::node

#undef UV_ERROR
