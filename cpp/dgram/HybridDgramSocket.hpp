#pragma once

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>
#include <uv.h>

#include "HybridNitroNodeDgramSocketSpec.hpp"
#include "CallbackSlot.hpp"
#include "SockAddr.hpp"
#include "UVLoop.hpp"

namespace margelo::nitro::node {

class HybridDgramSocket : public HybridNitroNodeDgramSocketSpec {
public:
  HybridDgramSocket();
  ~HybridDgramSocket() override;

  using MaybeSockAddr = std::variant<nitro::NullType, SockAddr>;
  using OnMessage = void(const std::shared_ptr<ArrayBuffer>&, const std::optional<MaybeSockAddr>&, double);

  // Properties
  std::function<OnMessage> getOnMessage() override { return onMessage_.get(); }
  void setOnMessage(const std::function<OnMessage>& cb) override { onMessage_.set(cb); }

  std::function<void(double, double)> getOnSend() override { return onSend_.get(); }
  void setOnSend(const std::function<void(double, double)>& cb) override { onSend_.set(cb); }

  std::function<void()> getOnClose() override { return onClose_.get(); }
  void setOnClose(const std::function<void()>& cb) override { onClose_.set(cb); }

  // Methods
  double bind(const std::string& host, double port, double flags) override;
  double connect(const std::string& host, double port) override;
  double disconnect() override;
  double send(double id, const std::vector<std::shared_ptr<ArrayBuffer>>& buffers, const std::optional<SockAddr>& to) override;
  double recvStart() override;
  double recvStop() override;
  void close() override;
  MaybeSockAddr getSockName() override;
  MaybeSockAddr getPeerName() override;

  double setBroadcast(bool enable) override;
  double setTTL(double ttl) override;
  double setMulticastTTL(double ttl) override;
  double setMulticastLoopback(bool enable) override;
  double setMulticastInterface(const std::string& interfaceAddress) override;
  double addMembership(const std::string& multicastAddress, const std::optional<std::string>& interfaceAddress) override;
  double dropMembership(const std::string& multicastAddress, const std::optional<std::string>& interfaceAddress) override;
  double addSourceSpecificMembership(const std::string& sourceAddress, const std::string& groupAddress,
                                     const std::optional<std::string>& interfaceAddress) override;
  double dropSourceSpecificMembership(const std::string& sourceAddress, const std::string& groupAddress,
                                      const std::optional<std::string>& interfaceAddress) override;

  double bufferSize(double size, bool recv) override;
  double getSendQueueSize() override;
  double getSendQueueCount() override;

private:
  static void onAlloc(uv_handle_t* handle, size_t suggestedSize, uv_buf_t* buf);
  static void onRecv(uv_udp_t* handle, ssize_t nread, const uv_buf_t* buf, const struct sockaddr* addr, unsigned flags);
  static void onSent(uv_udp_send_t* req, int status);
  static void onClosed(uv_handle_t* handle);

  // Runs `fn` with the handle on the loop thread and returns its result, or
  // UV_EBADF when the socket is closed (or its handle couldn't be created).
  double withHandle(std::function<int(uv_udp_t*)> fn);

  int setMembership(const std::string& multicastAddress, const std::optional<std::string>& interfaceAddress,
                    uv_membership membership);
  int setSourceMembership(const std::string& sourceAddress, const std::string& groupAddress,
                          const std::optional<std::string>& interfaceAddress, uv_membership membership);

  // Only touched on the UV loop thread.
  uv_udp_t* uvSocket_ = nullptr;
  UVLoop& loop_;

  // Assigned from the JS thread, invoked from the UV loop thread.
  CallbackSlot<OnMessage> onMessage_;
  CallbackSlot<void(double, double)> onSend_;
  CallbackSlot<void()> onClose_;
};

} // namespace margelo::nitro::node
