#pragma once

#include <functional>
#include <memory>
#include <variant>
#include <uv.h>

#include "HybridNitroNodeNetSocketSpec.hpp"
#include "CallbackSlot.hpp"
#include "SockAddr.hpp"
#include "UVLoop.hpp"

namespace margelo::nitro::node {

class HybridNetSocket : public HybridNitroNodeNetSocketSpec {
public:
  HybridNetSocket() : HybridObject(TAG), HybridNitroNodeNetSocketSpec(), loop_(UVLoop::shared()) {}

  // Wraps a handle accepted by a server.
  explicit HybridNetSocket(uv_tcp_t* uvSocket)
      : HybridObject(TAG), HybridNitroNodeNetSocketSpec(), uvSocket_(uvSocket), loop_(UVLoop::shared()) {
    if (uvSocket_ != nullptr) {
      uvSocket_->data = this;
    }
    // An accepted socket is already connected: connect() must not replace (and
    // leak) its handle, so it is ignored like any repeated connect().
    connectCalled_ = true;
  }

  ~HybridNetSocket() override;

  // Properties
  std::function<void(double)> getOnConnect() override { return onConnect_.get(); }
  void setOnConnect(const std::function<void(double)>& cb) override { onConnect_.set(cb); }

  std::function<void(const std::shared_ptr<ArrayBuffer>&, double)> getOnRead() override { return onRead_.get(); }
  void setOnRead(const std::function<void(const std::shared_ptr<ArrayBuffer>&, double)>& cb) override { onRead_.set(cb); }

  std::function<void(double, double)> getOnWrite() override { return onWrite_.get(); }
  void setOnWrite(const std::function<void(double, double)>& cb) override { onWrite_.set(cb); }

  std::function<void()> getOnClose() override { return onClose_.get(); }
  void setOnClose(const std::function<void()>& cb) override { onClose_.set(cb); }

  // Methods
  void pause() override;
  void resume() override;
  void write(double id, const std::shared_ptr<ArrayBuffer>& buffer) override;
  double getWriteQueueSize() override;
  void connect(const std::string& host, double port) override;
  void setNoDelay(bool enable) override;
  void setKeepAlive(bool enable, double initialDelaySeconds) override;
  void shutdown() override;
  void close() override;
  std::variant<nitro::NullType, SockAddr> getSockName() override;
  std::variant<nitro::NullType, SockAddr> getPeerName() override;

private:
  static void onAlloc(uv_handle_t* handle, size_t suggestedSize, uv_buf_t* buf);
  static void onRead(uv_stream_t* client, ssize_t nread, const uv_buf_t* buf);
  static void onWrite(uv_write_t* req, int status);
  static void onClosed(uv_handle_t* handle);
  static void onConnected(uv_connect_t* req, int status);
  static void onShutdown(uv_shutdown_t* req, int status);

  // Apply the stored option to the handle, if there is one.
  void applyNoDelay();
  void applyKeepAlive();

  // Idle seconds before the first keep-alive probe when none were asked for.
  // libuv does not accept 0; this is the usual system default.
  static constexpr unsigned int kDefaultKeepAliveDelay = 7200;

  uv_tcp_t* uvSocket_ = nullptr;
  UVLoop& loop_;
  bool connectCalled_ = false;

  // Socket options. Only touched on the UV loop thread.
  bool noDelay_ = false;
  bool keepAlive_ = false;
  unsigned int keepAliveDelay_ = kDefaultKeepAliveDelay;

  // Assigned from the JS thread, invoked from the UV loop thread.
  CallbackSlot<void(double)> onConnect_;
  CallbackSlot<void(const std::shared_ptr<ArrayBuffer>&, double)> onRead_;
  CallbackSlot<void(double, double)> onWrite_;
  CallbackSlot<void()> onClose_;
};

} // namespace margelo::nitro::node
