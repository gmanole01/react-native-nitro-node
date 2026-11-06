#include "HybridDgramSocket.hpp"

#include <stdlib.h>
#include <string.h>

#include "Common.hpp"
#include "SockAddrUtil.hpp"

namespace margelo::nitro::node {

namespace {

// Everything a single uv_udp_send needs until its callback fires. The data it
// owns is freed by onSent (or by send() when the send couldn't start).
struct SendRequest {
  uv_udp_send_t req;
  uint64_t id;
  uv_buf_t buf;
};

} // namespace

HybridDgramSocket::HybridDgramSocket() : HybridObject(TAG), HybridNitroNodeDgramSocketSpec(), loop_(UVLoop::shared()) {
  // As Node's UDPWrap, the handle exists from the start; it gets its file
  // descriptor when bound (or on the first send). The queue is FIFO, so it is
  // there before any other call runs.
  loop_.post([this](uv_loop_t* loop) {
    auto* udp = static_cast<uv_udp_t*>(malloc(sizeof(uv_udp_t)));
    if (udp == nullptr) {
      LOGD("dgram socket: out of memory");
      return;
    }
    int r = uv_udp_init(loop, udp);
    if (r < 0) {
      LOGD("uv_udp_init failed: %d", r);
      free(udp);
      return;
    }
    udp->data = this;
    uvSocket_ = udp;
  });
}

HybridDgramSocket::~HybridDgramSocket() {
  // As HybridNetSocket: runs after every task already posted with `this`, then
  // detaches the handle, which closes on its own and is freed by onClosed.
  loop_.runSync([this](uv_loop_t*) {
    if (uvSocket_ == nullptr) {
      return;
    }
    uvSocket_->data = nullptr;
    if (!uv_is_closing((uv_handle_t*) uvSocket_)) {
      uv_close((uv_handle_t*) uvSocket_, HybridDgramSocket::onClosed);
    }
    uvSocket_ = nullptr;
  });
}

double HybridDgramSocket::withHandle(std::function<int(uv_udp_t*)> fn) {
  return loop_.runSync<double>([this, &fn](uv_loop_t*) -> double {
    if (uvSocket_ == nullptr || uv_is_closing((uv_handle_t*) uvSocket_)) {
      return UV_EBADF;
    }
    return fn(uvSocket_);
  });
}

double HybridDgramSocket::bind(const std::string& host, double port, double _flags) {
  struct sockaddr_storage addr;
  int r = parseSockAddr(host, static_cast<int>(port), &addr);
  if (r < 0) {
    return r;
  }
  // As Node's UDPWrap: passed to libuv as they are, which rejects unknown
  // ones (EINVAL) and UV_UDP_REUSEPORT where the system can't (ENOTSUP)
  const unsigned int flags = static_cast<unsigned int>(_flags);
  return withHandle([&](uv_udp_t* udp) { return uv_udp_bind(udp, (const struct sockaddr*) &addr, flags); });
}

double HybridDgramSocket::connect(const std::string& host, double port) {
  struct sockaddr_storage addr;
  int r = parseSockAddr(host, static_cast<int>(port), &addr);
  if (r < 0) {
    return r;
  }
  return withHandle([&](uv_udp_t* udp) { return uv_udp_connect(udp, (const struct sockaddr*) &addr); });
}

double HybridDgramSocket::disconnect() {
  return withHandle([](uv_udp_t* udp) { return uv_udp_connect(udp, nullptr); });
}

double HybridDgramSocket::send(double _id, const std::vector<std::shared_ptr<ArrayBuffer>>& buffers,
                               const std::optional<SockAddr>& to) {
  const uint64_t id = static_cast<uint64_t>(_id);

  struct sockaddr_storage dest;
  if (to.has_value()) {
    int r = parseSockAddr(to->ip, static_cast<int>(to->port), &dest);
    if (r < 0) {
      return r;
    }
  }

  // One datagram: the buffers are copied together, as the JS ones can't be
  // touched once this returns, and the send completes later.
  size_t size = 0;
  for (const auto& buffer : buffers) {
    size += buffer->size();
  }
  char* data = nullptr;
  if (size > 0) {
    data = static_cast<char*>(malloc(size));
    if (data == nullptr) {
      return UV_ENOMEM;
    }
    size_t offset = 0;
    for (const auto& buffer : buffers) {
      memcpy(data + offset, buffer->data(), buffer->size());
      offset += buffer->size();
    }
  }

  const struct sockaddr* addr = to.has_value() ? (const struct sockaddr*) &dest : nullptr;
  double r = withHandle([&](uv_udp_t* udp) {
    auto* sr = static_cast<SendRequest*>(malloc(sizeof(SendRequest)));
    if (sr == nullptr) {
      return static_cast<int>(UV_ENOMEM);
    }
    sr->id = id;
    sr->buf = uv_buf_init(data, size);
    sr->req.data = sr;

    int r = uv_udp_send(&sr->req, udp, &sr->buf, 1, addr, onSent);
    if (r < 0) {
      free(sr);
      return r;
    }
    // onSent frees it now
    data = nullptr;
    return 0;
  });
  free(data);
  return r;
}

double HybridDgramSocket::recvStart() {
  return withHandle([](uv_udp_t* udp) {
    int r = uv_udp_recv_start(udp, onAlloc, onRecv);
    // Already receiving is fine, as in Node
    return r == UV_EALREADY ? 0 : r;
  });
}

double HybridDgramSocket::recvStop() {
  return withHandle([](uv_udp_t* udp) { return uv_udp_recv_stop(udp); });
}

void HybridDgramSocket::close() {
  loop_.post([this](uv_loop_t*) {
    if (uvSocket_ == nullptr || uv_is_closing((uv_handle_t*) uvSocket_)) {
      return;
    }
    uv_close((uv_handle_t*) uvSocket_, onClosed);
  });
}

HybridDgramSocket::MaybeSockAddr HybridDgramSocket::getSockName() {
  return loop_.runSync<MaybeSockAddr>([this](uv_loop_t*) { return sockAddrOf(uvSocket_, SockAddrEnd::Local); });
}

HybridDgramSocket::MaybeSockAddr HybridDgramSocket::getPeerName() {
  return loop_.runSync<MaybeSockAddr>([this](uv_loop_t*) { return sockAddrOf(uvSocket_, SockAddrEnd::Peer); });
}

double HybridDgramSocket::setBroadcast(bool enable) {
  return withHandle([enable](uv_udp_t* udp) { return uv_udp_set_broadcast(udp, enable ? 1 : 0); });
}

double HybridDgramSocket::setTTL(double ttl) {
  return withHandle([ttl](uv_udp_t* udp) { return uv_udp_set_ttl(udp, static_cast<int>(ttl)); });
}

double HybridDgramSocket::setMulticastTTL(double ttl) {
  return withHandle([ttl](uv_udp_t* udp) { return uv_udp_set_multicast_ttl(udp, static_cast<int>(ttl)); });
}

double HybridDgramSocket::setMulticastLoopback(bool enable) {
  return withHandle([enable](uv_udp_t* udp) { return uv_udp_set_multicast_loop(udp, enable ? 1 : 0); });
}

double HybridDgramSocket::setMulticastInterface(const std::string& interfaceAddress) {
  return withHandle(
    [&interfaceAddress](uv_udp_t* udp) { return uv_udp_set_multicast_interface(udp, interfaceAddress.c_str()); });
}

double HybridDgramSocket::addMembership(const std::string& multicastAddress,
                                        const std::optional<std::string>& interfaceAddress) {
  return setMembership(multicastAddress, interfaceAddress, UV_JOIN_GROUP);
}

double HybridDgramSocket::dropMembership(const std::string& multicastAddress,
                                         const std::optional<std::string>& interfaceAddress) {
  return setMembership(multicastAddress, interfaceAddress, UV_LEAVE_GROUP);
}

double HybridDgramSocket::addSourceSpecificMembership(const std::string& sourceAddress,
                                                      const std::string& groupAddress,
                                                      const std::optional<std::string>& interfaceAddress) {
  return setSourceMembership(sourceAddress, groupAddress, interfaceAddress, UV_JOIN_GROUP);
}

double HybridDgramSocket::dropSourceSpecificMembership(const std::string& sourceAddress,
                                                       const std::string& groupAddress,
                                                       const std::optional<std::string>& interfaceAddress) {
  return setSourceMembership(sourceAddress, groupAddress, interfaceAddress, UV_LEAVE_GROUP);
}

int HybridDgramSocket::setMembership(const std::string& multicastAddress,
                                     const std::optional<std::string>& interfaceAddress, uv_membership membership) {
  // Without an interface, the system picks one
  const char* iface = interfaceAddress.has_value() ? interfaceAddress->c_str() : nullptr;
  return static_cast<int>(withHandle([&](uv_udp_t* udp) {
    return uv_udp_set_membership(udp, multicastAddress.c_str(), iface, membership);
  }));
}

int HybridDgramSocket::setSourceMembership(const std::string& sourceAddress, const std::string& groupAddress,
                                           const std::optional<std::string>& interfaceAddress,
                                           uv_membership membership) {
  const char* iface = interfaceAddress.has_value() ? interfaceAddress->c_str() : nullptr;
  return static_cast<int>(withHandle([&](uv_udp_t* udp) {
    return uv_udp_set_source_membership(udp, groupAddress.c_str(), iface, sourceAddress.c_str(), membership);
  }));
}

double HybridDgramSocket::bufferSize(double size, bool recv) {
  return withHandle([size, recv](uv_udp_t* udp) {
    // 0 reads the size, anything else sets it; either way it's left in `value`
    int value = static_cast<int>(size);
    int r = recv ? uv_recv_buffer_size((uv_handle_t*) udp, &value) : uv_send_buffer_size((uv_handle_t*) udp, &value);
    return r < 0 ? r : value;
  });
}

double HybridDgramSocket::getSendQueueSize() {
  return withHandle([](uv_udp_t* udp) { return static_cast<int>(uv_udp_get_send_queue_size(udp)); });
}

double HybridDgramSocket::getSendQueueCount() {
  return withHandle([](uv_udp_t* udp) { return static_cast<int>(uv_udp_get_send_queue_count(udp)); });
}

void HybridDgramSocket::onAlloc(uv_handle_t*, size_t suggestedSize, uv_buf_t* buf) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  // libuv suggests 64 KB, the largest datagram
  const size_t size = suggestedSize > 0 ? suggestedSize : 1;
  buf->base = static_cast<char*>(malloc(size));
  // A zero length makes libuv report UV_ENOBUFS instead of reading into null.
  buf->len = buf->base != nullptr ? size : 0;
}

void HybridDgramSocket::onRecv(uv_udp_t* handle, ssize_t nread, const uv_buf_t* buf, const struct sockaddr* addr,
                               unsigned) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  auto* socket = static_cast<HybridDgramSocket*>(handle->data);

  // Nothing left to read; not a datagram (an empty one has an address)
  if (socket == nullptr || !socket->onMessage_ || (nread == 0 && addr == nullptr)) {
    free(buf->base);
    return;
  }

  if (nread < 0) {
    free(buf->base);
    socket->onMessage_.call(ArrayBuffer::allocate(0), std::optional<MaybeSockAddr>(nitro::NullType()),
                            static_cast<double>(nread));
    return;
  }

  // As HybridNetSocket::onRead: hand the buffer itself to JS, shrunk to the
  // datagram's size.
  const size_t size = static_cast<size_t>(nread);
  std::shared_ptr<ArrayBuffer> data;
  if (size == 0) {
    free(buf->base);
    data = ArrayBuffer::allocate(0);
  } else {
    char* base = buf->base;
    if (auto* shrunk = static_cast<char*>(realloc(base, size))) {
      base = shrunk;
    }
    data = ArrayBuffer::wrap((uint8_t*) base, size, [base]() { free(base); });
  }
  socket->onMessage_.call(data, std::optional<MaybeSockAddr>(toSockAddr(addr)), static_cast<double>(nread));
}

void HybridDgramSocket::onSent(uv_udp_send_t* req, int status) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  auto* sr = static_cast<SendRequest*>(req->data);
  // Through the handle, never the request: the destructor detaches it
  auto* socket = static_cast<HybridDgramSocket*>(req->handle->data);

  if (socket != nullptr) {
    socket->onSend_.call(static_cast<double>(sr->id), static_cast<double>(status));
  }

  free(sr->buf.base);
  free(sr);
}

void HybridDgramSocket::onClosed(uv_handle_t* handle) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  auto* socket = static_cast<HybridDgramSocket*>(handle->data);

  if (socket != nullptr) {
    socket->uvSocket_ = nullptr;
    socket->onClose_.call();
  }

  free(handle);
}

} // namespace margelo::nitro::node
