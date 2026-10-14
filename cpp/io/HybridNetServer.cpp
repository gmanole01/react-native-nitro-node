#include "HybridNetServer.hpp"

#include <stdlib.h>

#include "Common.hpp"
#include "SockAddrUtil.hpp"
#include "UVLoop.hpp"

namespace margelo::nitro::node {

namespace {

constexpr int kDefaultBacklog = 128;

// Frees a rejected/accepted client handle that was never wrapped in a socket.
void freeHandle(uv_handle_t* handle) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();
  free(handle);
}

} // namespace

HybridNetServer::~HybridNetServer() {
  // Safe on any thread: the handle is detached and left to close on its own,
  // so nothing here waits on the loop (on the loop thread runSync runs inline).

  // Tasks posted by listen()/close() capture `this` and may still be queued.
  // The queue is FIFO, so by the time this task runs they have all completed;
  // nothing can post new ones since the object is being destroyed. It also
  // means uvServer_ is only ever inspected on the loop thread.
  loop_.runSync([this](uv_loop_t*) {
    if (uvServer_ == nullptr) {
      // Never listened (or listen failed), or already closed and freed by
      // onServerClosed.
      return;
    }

    // Detach: libuv callbacks reach us through handle->data only, so from here
    // on they see no server - none of the JS callbacks can fire anymore. The
    // handle outlives us and is freed by onServerClosed.
    uvServer_->data = nullptr;

    // Checking uv_is_closing serializes us against close() tasks, so uv_close
    // is issued exactly once.
    if (!uv_is_closing((uv_handle_t*) uvServer_)) {
      uv_close((uv_handle_t*) uvServer_, HybridNetServer::onServerClosed);
    }
    uvServer_ = nullptr;
  });
}

void HybridNetServer::listen(const std::string& host, double _port) {
  const int port = static_cast<int>(_port);

  loop_.post([this, host, port](uv_loop_t* loop) {
    // uvServer_ is set while listening and until a close has fully completed;
    // it is null again after a close or a failed listen, so the server can be
    // listened on any number of times, just not twice at once.
    if (uvServer_ != nullptr) {
      LOGD("listen failed: already listening");
      onListening_.call(UV_EALREADY);
      return;
    }

    auto* server = static_cast<uv_tcp_t*>(malloc(sizeof(uv_tcp_t)));
    if (server == nullptr) {
      onListening_.call(UV_ENOMEM);
      return;
    }
    server->data = nullptr;

    int r = uv_tcp_init(loop, server);
    if (r < 0) {
      free(server);
      onListening_.call(static_cast<double>(r));
      return;
    }

    struct sockaddr_storage addr;
    r = parseSockAddr(host, port, &addr);
    if (r < 0) {
      LOGD("not an IP address: %s", host.c_str());
      uv_close((uv_handle_t*) server, onListenFailed);
      onListening_.call(static_cast<double>(r));
      return;
    }

    r = uv_tcp_bind(server, (const struct sockaddr*) &addr, 0);
    if (r < 0) {
      LOGD("uv_tcp_bind failed: %d", r);
      uv_close((uv_handle_t*) server, onListenFailed);
      onListening_.call(static_cast<double>(r));
      return;
    }

    r = uv_listen((uv_stream_t*) server, kDefaultBacklog, onConnection);
    if (r < 0) {
      LOGD("uv_listen failed: %d", r);
      uv_close((uv_handle_t*) server, onListenFailed);
      onListening_.call(static_cast<double>(r));
      return;
    }

    server->data = this;
    uvServer_ = server;

    onListening_.call(0);
  });
}

void HybridNetServer::close() {
  loop_.post([this](uv_loop_t*) {
    if (uvServer_ == nullptr || uv_is_closing((uv_handle_t*) uvServer_)) {
      return;
    }
    uv_close((uv_handle_t*) uvServer_, onServerClosed);
  });
}

std::variant<nitro::NullType, SockAddr> HybridNetServer::getSockName() {
  return loop_.runSync<std::variant<nitro::NullType, SockAddr>>(
    [this](uv_loop_t*) { return sockAddrOf(uvServer_, SockAddrEnd::Local); });
}

void HybridNetServer::onConnection(uv_stream_t* server, int status) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  auto* srv = static_cast<HybridNetServer*>(server->data);

  if (status < 0) {
    if (srv != nullptr) {
      srv->onConnection_.call(nitro::NullType(), static_cast<double>(status));
    }
    return;
  }

  // libuv delivers no further connections until the pending one is accepted,
  // and accepting needs a client handle. Without one the listener would stay
  // open but silently dead, so report the error and close it instead; closing
  // also drops the pending connection.
  auto closeListener = [server, srv](int error) {
    LOGD("cannot accept, closing the listener: %d", error);
    if (srv != nullptr) {
      srv->onConnection_.call(nitro::NullType(), static_cast<double>(error));
    }
    if (!uv_is_closing((uv_handle_t*) server)) {
      uv_close((uv_handle_t*) server, onServerClosed);
    }
  };

  auto* client = static_cast<uv_tcp_t*>(malloc(sizeof(uv_tcp_t)));
  if (client == nullptr) {
    closeListener(UV_ENOMEM);
    return;
  }
  client->data = nullptr;

  int r = uv_tcp_init(server->loop, client);
  if (r < 0) {
    free(client);
    closeListener(r);
    return;
  }

  r = uv_accept(server, (uv_stream_t*) client);
  if (r == 0) {
    if (srv != nullptr && srv->onConnection_) {
      auto netSock = std::make_shared<HybridNetSocket>(client);
      srv->onConnection_.call(netSock, 0);
    } else {
      // No handler to hand the socket to - close the client directly instead
      // of wrapping it in a HybridNetSocket first.
      uv_close((uv_handle_t*) client, freeHandle);
    }
  } else {
    uv_close((uv_handle_t*) client, freeHandle);
    if (srv != nullptr) {
      srv->onConnection_.call(nitro::NullType(), static_cast<double>(r));
    }
  }
}

void HybridNetServer::onServerClosed(uv_handle_t* handle) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  auto* srv = static_cast<HybridNetServer*>(handle->data);

  if (srv != nullptr) {
    srv->uvServer_ = nullptr;
    srv->onClose_.call();
  }

  free(handle);
}

void HybridNetServer::onListenFailed(uv_handle_t* handle) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();
  free(handle);
}

} // namespace margelo::nitro::node
