#include "HybridNetSocket.hpp"

#include <stdlib.h>
#include <string.h>

#include "Common.hpp"
#include "SockAddrUtil.hpp"
#include "UVLoop.hpp"

namespace margelo::nitro::node {

namespace {

// Everything a single uv_write needs until its callback fires. Allocated with
// malloc like the rest of the libuv objects; the buffer it owns is freed by
// onWrite (or the sync-failure path in write()).
struct WriteRequest {
  uv_write_t req;
  uint64_t id;
  uv_buf_t buf;
};

} // namespace

HybridNetSocket::~HybridNetSocket() {
  // Safe on any thread: the handle is detached and left to close on its own,
  // so nothing here waits on the loop (on the loop thread runSync runs inline).

  // Tasks posted by connect()/write()/close()/... capture `this` and may still
  // be queued. The queue is FIFO, so by the time this task runs they have all
  // completed; nothing can post new ones since the object is being destroyed.
  // It also means uvSocket_ is only ever inspected on the loop thread.
  loop_.runSync([this](uv_loop_t*) {
    if (uvSocket_ == nullptr) {
      // Never connected, or already closed and freed by onClosed.
      return;
    }

    // Detach: every libuv callback reaches us through handle->data only, so
    // from here on the pending connect/write/close callbacks see no socket and
    // just release their own resources - none of the JS callbacks can fire
    // anymore. The handle outlives us and is freed by onClosed.
    uvSocket_->data = nullptr;

    // Checking uv_is_closing serializes us against close() tasks, so uv_close
    // is issued exactly once.
    if (!uv_is_closing((uv_handle_t*) uvSocket_)) {
      uv_close((uv_handle_t*) uvSocket_, HybridNetSocket::onClosed);
    }
    uvSocket_ = nullptr;
  });
}

void HybridNetSocket::pause() {
  loop_.post([this](uv_loop_t*) {
    if (uvSocket_ != nullptr && !uv_is_closing((uv_handle_t*) uvSocket_)) {
      uv_read_stop((uv_stream_t*) uvSocket_);
    }
  });
}

void HybridNetSocket::resume() {
  loop_.post([this](uv_loop_t*) {
    if (uvSocket_ != nullptr && !uv_is_closing((uv_handle_t*) uvSocket_)) {
      uv_read_start((uv_stream_t*) uvSocket_, onAlloc, onRead);
    }
  });
}

void HybridNetSocket::write(double _id, const std::shared_ptr<ArrayBuffer>& buffer) {
  const uint64_t id = static_cast<uint64_t>(_id);

  // Copy the JS buffer: the caller's ArrayBuffer may be released before the
  // queued write runs on the loop thread.
  const size_t size = buffer->size();
  char* copy = size > 0 ? static_cast<char*>(malloc(size)) : nullptr;
  if (copy != nullptr) {
    memcpy(copy, buffer->data(), size);
  }

  loop_.post([this, id, copy, size](uv_loop_t*) {
    if (size > 0 && copy == nullptr) {
      LOGD("write failed: out of memory");
      onWrite_.call(static_cast<double>(id), UV_ENOMEM);
      return;
    }

    if (uvSocket_ == nullptr || uv_is_closing((uv_handle_t*) uvSocket_)) {
      LOGD("write failed: socket is null or closing");
      free(copy);
      onWrite_.call(static_cast<double>(id), UV_EINVAL);
      return;
    }

    auto* wr = static_cast<WriteRequest*>(malloc(sizeof(WriteRequest)));
    if (wr == nullptr) {
      LOGD("write failed: out of memory");
      free(copy);
      onWrite_.call(static_cast<double>(id), UV_ENOMEM);
      return;
    }
    wr->id = id;
    wr->buf = uv_buf_init(copy, size);
    wr->req.data = wr;

    int r = uv_write(&wr->req, (uv_stream_t*) uvSocket_, &wr->buf, 1, onWrite);
    if (r < 0) {
      LOGD("write returned error: %d", r);
      const uint64_t failedId = wr->id;
      free(wr->buf.base);
      free(wr);
      onWrite_.call(static_cast<double>(failedId), r);
    }
  });
}

double HybridNetSocket::getWriteQueueSize() {
  return loop_.runSync<double>([this](uv_loop_t*) -> double {
    if (uvSocket_ == nullptr || uv_is_closing((uv_handle_t*) uvSocket_)) {
      return 0;
    }
    return static_cast<double>(uvSocket_->write_queue_size);
  });
}

void HybridNetSocket::connect(const std::string& host, double _port) {
  if (connectCalled_) {
    return;
  }
  connectCalled_ = true;

  const int port = static_cast<int>(_port);

  // Every failure below is reported through onConnect, exactly like a failure
  // that libuv reports later through onConnected.
  loop_.post([this, host, port](uv_loop_t* loop) {
    struct sockaddr_storage dest;
    int r = parseSockAddr(host, port, &dest);
    if (r < 0) {
      LOGD("not an IP address: %s", host.c_str());
      onConnect_.call(static_cast<double>(r));
      return;
    }

    auto* tcp = static_cast<uv_tcp_t*>(malloc(sizeof(uv_tcp_t)));
    if (tcp == nullptr) {
      onConnect_.call(UV_ENOMEM);
      return;
    }

    r = uv_tcp_init(loop, tcp);
    if (r < 0) {
      LOGD("uv_tcp_init failed: %d", r);
      free(tcp);
      onConnect_.call(static_cast<double>(r));
      return;
    }
    tcp->data = this;
    uvSocket_ = tcp;

    auto* req = static_cast<uv_connect_t*>(malloc(sizeof(uv_connect_t)));
    if (req == nullptr) {
      // Same order as a failed connect in onConnected: close, then report.
      uv_close((uv_handle_t*) tcp, onClosed);
      onConnect_.call(UV_ENOMEM);
      return;
    }

    r = uv_tcp_connect(req, tcp, (const struct sockaddr*) &dest, onConnected);
    if (r < 0) {
      LOGD("uv_tcp_connect failed synchronously: %d", r);
      // onConnected will never fire, so do its job here: release the request,
      // close the handle and report.
      free(req);
      uv_close((uv_handle_t*) tcp, onClosed);
      onConnect_.call(static_cast<double>(r));
      return;
    }

    // The handle has its file descriptor now, so the options asked for before
    // connect() can be applied.
    applyNoDelay();
    applyKeepAlive();
  });
}

void HybridNetSocket::setNoDelay(bool enable) {
  loop_.post([this, enable](uv_loop_t*) {
    noDelay_ = enable;
    applyNoDelay();
  });
}

void HybridNetSocket::setKeepAlive(bool enable, double initialDelaySeconds) {
  const auto delay = initialDelaySeconds >= 1 ? static_cast<unsigned int>(initialDelaySeconds) : kDefaultKeepAliveDelay;

  loop_.post([this, enable, delay](uv_loop_t*) {
    keepAlive_ = enable;
    keepAliveDelay_ = delay;
    applyKeepAlive();
  });
}

void HybridNetSocket::applyNoDelay() {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  if (uvSocket_ == nullptr || uv_is_closing((uv_handle_t*) uvSocket_)) {
    // not connected yet: connect() applies it
    return;
  }

  int r = uv_tcp_nodelay(uvSocket_, noDelay_ ? 1 : 0);
  if (r < 0) {
    LOGD("uv_tcp_nodelay failed: %d", r);
  }
}

void HybridNetSocket::applyKeepAlive() {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  if (uvSocket_ == nullptr || uv_is_closing((uv_handle_t*) uvSocket_)) {
    // not connected yet: connect() applies it
    return;
  }

  int r = uv_tcp_keepalive(uvSocket_, keepAlive_ ? 1 : 0, keepAliveDelay_);
  if (r < 0) {
    LOGD("uv_tcp_keepalive failed: %d", r);
  }
}

void HybridNetSocket::shutdown() {
  loop_.post([this](uv_loop_t*) {
    if (uvSocket_ == nullptr || uv_is_closing((uv_handle_t*) uvSocket_)) {
      return;
    }

    auto* req = static_cast<uv_shutdown_t*>(malloc(sizeof(uv_shutdown_t)));
    if (req == nullptr) {
      LOGD("shutdown failed: out of memory");
      return;
    }

    int r = uv_shutdown(req, (uv_stream_t*) uvSocket_, onShutdown);
    if (r < 0) {
      LOGD("uv_shutdown returned error: %d", r);
      free(req);
    }
  });
}

void HybridNetSocket::close() {
  loop_.post([this](uv_loop_t*) {
    if (uvSocket_ == nullptr || uv_is_closing((uv_handle_t*) uvSocket_)) {
      return;
    }
    uv_close((uv_handle_t*) uvSocket_, onClosed);
  });
}

std::variant<nitro::NullType, SockAddr> HybridNetSocket::getSockName() {
  return loop_.runSync<std::variant<nitro::NullType, SockAddr>>(
    [this](uv_loop_t*) { return sockAddrOf(uvSocket_, SockAddrEnd::Local); });
}

std::variant<nitro::NullType, SockAddr> HybridNetSocket::getPeerName() {
  return loop_.runSync<std::variant<nitro::NullType, SockAddr>>(
    [this](uv_loop_t*) { return sockAddrOf(uvSocket_, SockAddrEnd::Peer); });
}

void HybridNetSocket::onAlloc(uv_handle_t*, size_t suggestedSize, uv_buf_t* buf) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  const size_t size = suggestedSize > 0 ? suggestedSize : 1;
  buf->base = static_cast<char*>(malloc(size));
  // A zero length makes libuv report UV_ENOBUFS instead of reading into null.
  buf->len = buf->base != nullptr ? size : 0;
}

void HybridNetSocket::onRead(uv_stream_t* client, ssize_t nread, const uv_buf_t* buf) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  auto* socket = static_cast<HybridNetSocket*>(client->data);

  if (socket == nullptr || !socket->onRead_) {
    free(buf->base);
    return;
  }

  if (nread == 0) {
    // EAGAIN/EWOULDBLOCK: nothing was read and nothing is wrong, so there is
    // nothing to tell JS about.
    free(buf->base);
    return;
  }

  if (nread < 0) {
    // EOF or error: there is no data to hand over.
    free(buf->base);
    socket->onRead_.call(ArrayBuffer::allocate(0), static_cast<double>(nread));
    return;
  }

  // Hand the read buffer itself to JS instead of copying it. libuv allocates
  // for the largest possible read (64 KB), so first shrink it to what was
  // actually received - JS may hold on to the chunk for a while.
  const size_t size = static_cast<size_t>(nread);
  char* base = buf->base;
  if (auto* shrunk = static_cast<char*>(realloc(base, size))) {
    base = shrunk;
  }

  // The ArrayBuffer owns the memory now; it is freed whenever JS releases it.
  std::shared_ptr<ArrayBuffer> data = ArrayBuffer::wrap((uint8_t*) base, size, [base]() { free(base); });
  socket->onRead_.call(data, static_cast<double>(nread));
}

void HybridNetSocket::onWrite(uv_write_t* req, int status) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  auto* wr = static_cast<WriteRequest*>(req->data);
  auto* socket = static_cast<HybridNetSocket*>(req->handle->data);

  if (socket != nullptr) {
    socket->onWrite_.call(static_cast<double>(wr->id), static_cast<double>(status));
  }

  free(wr->buf.base);
  free(wr);
}

void HybridNetSocket::onClosed(uv_handle_t* handle) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  auto* socket = static_cast<HybridNetSocket*>(handle->data);

  if (socket != nullptr) {
    socket->uvSocket_ = nullptr;
    socket->onClose_.call();
  }

  free(handle);
}

void HybridNetSocket::onConnected(uv_connect_t* req, int status) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  // Reach the socket through the handle, never the request: the destructor
  // detaches by clearing handle->data.
  auto* socket = static_cast<HybridNetSocket*>(req->handle->data);

  if (status < 0) {
    auto* handle = (uv_handle_t*) req->handle;
    if (!uv_is_closing(handle)) {
      uv_close(handle, onClosed);
    }
  }

  free(req);

  if (socket != nullptr) {
    socket->onConnect_.call(static_cast<double>(status));
  }
}

void HybridNetSocket::onShutdown(uv_shutdown_t* req, int) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();
  free(req);
}

} // namespace margelo::nitro::node
