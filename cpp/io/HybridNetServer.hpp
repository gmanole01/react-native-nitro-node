#pragma once

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <uv.h>

#include "HybridNitroNodeNetServerSpec.hpp"
#include "CallbackSlot.hpp"
#include "HybridNetSocket.hpp"
#include "SockAddr.hpp"
#include "UVLoop.hpp"

namespace margelo::nitro::node {

class HybridNetServer : public HybridNitroNodeNetServerSpec {
public:
  HybridNetServer() : HybridObject(TAG), HybridNitroNodeNetServerSpec(), loop_(UVLoop::shared()) {}

  ~HybridNetServer() override;

  // Properties
  std::function<void(double)> getOnListening() override { return onListening_.get(); }
  void setOnListening(const std::function<void(double)>& cb) override { onListening_.set(cb); }

  std::function<void(const std::optional<std::variant<nitro::NullType, std::shared_ptr<HybridNitroNodeNetSocketSpec>>>&, double)> getOnConnection() override { return onConnection_.get(); }
  void setOnConnection(const std::function<void(const std::optional<std::variant<nitro::NullType, std::shared_ptr<HybridNitroNodeNetSocketSpec>>>&, double)>& cb) override { onConnection_.set(cb); }

  std::function<void()> getOnClose() override { return onClose_.get(); }
  void setOnClose(const std::function<void()>& cb) override { onClose_.set(cb); }

  // Methods
  void listen(const std::string& host, double port) override;
  void close() override;
  std::variant<nitro::NullType, SockAddr> getSockName() override;

private:
  static void onConnection(uv_stream_t* server, int status);
  static void onServerClosed(uv_handle_t* handle);
  static void onListenFailed(uv_handle_t* handle);

  uv_tcp_t* uvServer_ = nullptr;
  UVLoop& loop_;

  // Assigned from the JS thread, invoked from the UV loop thread.
  CallbackSlot<void(double)> onListening_;
  CallbackSlot<void(const std::optional<std::variant<nitro::NullType, std::shared_ptr<HybridNitroNodeNetSocketSpec>>>&, double)> onConnection_;
  CallbackSlot<void()> onClose_;
};

} // namespace margelo::nitro::node
