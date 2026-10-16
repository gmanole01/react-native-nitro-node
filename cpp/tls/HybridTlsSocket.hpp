#pragma once

#include <deque>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include <tlsuv/tls_engine.h>

#include "HybridNitroNodeTlsSocketSpec.hpp"
#include "HybridNetSocket.hpp"
#include "TransportListener.hpp"

namespace margelo::nitro::node {

// A TLS client socket. It owns a HybridNetSocket as its transport and sits on
// it as its TransportListener, like Node's TLSWrap on a TCPWrap: the encrypted
// bytes stay native, a tlsuv engine (OpenSSL) turns them into plaintext, and
// JS only ever sees that plaintext - through the same callbacks as a plain
// net socket.
class HybridTlsSocket : public HybridNitroNodeTlsSocketSpec, private TransportListener {
public:
  HybridTlsSocket();
  ~HybridTlsSocket() override;

  // Properties
  std::function<void(double)> getOnConnect() override { return onConnect_.get(); }
  void setOnConnect(const std::function<void(double)>& cb) override { onConnect_.set(cb); }

  std::function<void(const std::shared_ptr<ArrayBuffer>&, double)> getOnRead() override { return onRead_.get(); }
  void setOnRead(const std::function<void(const std::shared_ptr<ArrayBuffer>&, double)>& cb) override { onRead_.set(cb); }

  std::function<void(double, double)> getOnWrite() override { return onWrite_.get(); }
  void setOnWrite(const std::function<void(double, double)>& cb) override { onWrite_.set(cb); }

  std::function<void()> getOnClose() override { return onClose_.get(); }
  void setOnClose(const std::function<void()>& cb) override { onClose_.set(cb); }

  std::function<void(const std::optional<std::string>&)> getOnSecure() override { return onSecure_.get(); }
  void setOnSecure(const std::function<void(const std::optional<std::string>&)>& cb) override { onSecure_.set(cb); }

  // Methods
  void pause() override;
  void resume() override;
  void shutdown() override;
  void close() override;
  void write(double id, const std::shared_ptr<ArrayBuffer>& buffer) override;
  void connect(const std::string& host, double port) override;
  double getWriteQueueSize() override;
  void setNoDelay(bool enable) override;
  void setKeepAlive(bool enable, double initialDelaySeconds) override;
  std::variant<nitro::NullType, SockAddr> getSockName() override;
  std::variant<nitro::NullType, SockAddr> getPeerName() override;

  void startTls(const TlsClientOptions& options) override;
  std::optional<std::string> getAlpnProtocol() override;

private:
  enum class State {
    Idle,        // startTls() not called yet, or not connected yet
    Handshaking,
    Open,
    Failed,      // the handshake failed or the stream is broken
  };

  // A JS write made before the handshake finished.
  struct QueuedWrite {
    uint64_t id;
    std::vector<char> data;
  };

  // TransportListener. All on the loop thread.
  void onTransportConnect(int status) override;
  void onTransportData(const char* data, size_t size) override;
  void onTransportEnd(int status) override;
  void onTransportWrite(uint64_t id, int status) override;
  void onTransportClose() override;

  // The engine's IO: it pulls ciphertext from inbound_ and pushes into outbound_.
  static ssize_t engineRead(io_ctx ctx, char* buf, size_t len);
  static ssize_t engineWrite(io_ctx ctx, const char* buf, size_t len);

  // Everything below runs on the loop thread.
  void beginHandshake();
  void continueHandshake();
  void failHandshake(const std::string& message);
  void writePlaintext(uint64_t id, const char* data, size_t size);
  void drainPlaintext();
  void deliverEof();
  void finishShutdown();
  // Sends what the engine produced. `jsId` is the JS write it belongs to, if
  // any: its onWrite fires when this raw write completes.
  void flushOutbound(std::optional<uint64_t> jsId = std::nullopt);
  // Reads from the transport while the handshake needs it, or JS wants data.
  void updateReading();
  std::string engineError(const char* fallback) const;

  UVLoop& loop_;
  std::shared_ptr<HybridNetSocket> transport_;

  // Only touched on the UV loop thread.
  tlsuv_engine_t engine_ = nullptr;
  State state_ = State::Idle;
  bool started_ = false;            // startTls() was called
  bool connected_ = false;          // the transport is connected
  bool transportEnded_ = false;     // the peer ended its side of TCP
  bool eofDelivered_ = false;       // JS got its end of stream
  bool paused_ = true;              // JS wants no data (net sockets start paused)
  bool reading_ = false;            // the transport is reading
  bool shutdownPending_ = false;    // shutdown() asked for before the handshake finished
  bool closeNotifySent_ = false;    // we ended our side of the TLS stream
  std::string inbound_;             // ciphertext not yet consumed by the engine
  size_t inboundOffset_ = 0;
  std::string outbound_;            // ciphertext the engine produced, not yet sent
  std::deque<QueuedWrite> queuedWrites_;
  size_t queuedBytes_ = 0;
  // Raw writes in flight, oldest first (libuv completes them in order), each
  // with the JS write it completes.
  std::deque<std::optional<uint64_t>> rawWrites_;
  uint64_t nextRawId_ = 1;
  std::optional<std::string> alpn_;

  // Assigned from the JS thread, invoked from the UV loop thread.
  CallbackSlot<void(double)> onConnect_;
  CallbackSlot<void(const std::shared_ptr<ArrayBuffer>&, double)> onRead_;
  CallbackSlot<void(double, double)> onWrite_;
  CallbackSlot<void()> onClose_;
  CallbackSlot<void(const std::optional<std::string>&)> onSecure_;
};

} // namespace margelo::nitro::node
