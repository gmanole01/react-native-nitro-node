#include "HybridTlsSocket.hpp"

#include <stdlib.h>
#include <string.h>

#include "Common.hpp"

namespace margelo::nitro::node {

namespace {

// Plaintext is handed to JS in chunks of up to this size.
constexpr size_t kReadSize = 64 * 1024;

const char* const kDisconnectedMessage =
  "Client network socket disconnected before secure TLS connection was established";

// The tlsuv contexts every socket shares: one verifies the server against the
// system's trust store, the other accepts any certificate. Created on first
// use, on the loop thread, and kept for the life of the process.
tls_context* sharedContext(bool verify) {
  if (verify) {
    static tls_context* verifying = default_tls_context(nullptr, 0);
    return verifying;
  }
  static tls_context* trusting = [] {
    tls_context* ctx = default_tls_context(nullptr, 0);
    if (ctx != nullptr) {
      ctx->set_cert_verify(ctx, [](const struct tlsuv_certificate_s*, void*) { return 0; }, nullptr);
    }
    return ctx;
  }();
  return trusting;
}

} // namespace

HybridTlsSocket::HybridTlsSocket()
    : HybridObject(TAG), HybridNitroNodeTlsSocketSpec(), loop_(UVLoop::shared()), transport_(std::make_shared<HybridNetSocket>()) {
  // Nothing can be read before this: a net socket only reads once resumed.
  transport_->setTransportListener(this);
}

HybridTlsSocket::~HybridTlsSocket() {
  // Tasks posted by our methods capture `this`; the queue is FIFO, so they
  // have all run by the time this one does (see ~HybridNetSocket).
  loop_.runSync([this](uv_loop_t*) {
    // From here on no transport event reaches us. The transport itself is
    // released after this and closes its handle on its own.
    transport_->setTransportListener(nullptr);
    if (engine_ != nullptr) {
      engine_->free(engine_);
      engine_ = nullptr;
    }
  });
}

// MARK: - Methods (JS thread)

void HybridTlsSocket::pause() {
  loop_.post([this](uv_loop_t*) {
    paused_ = true;
    updateReading();
  });
}

void HybridTlsSocket::resume() {
  loop_.post([this](uv_loop_t*) {
    paused_ = false;
    updateReading();
    // The engine may hold plaintext that arrived while paused, or the end of
    // the stream: no new TCP read would deliver it.
    drainPlaintext();
  });
}

void HybridTlsSocket::shutdown() {
  loop_.post([this](uv_loop_t*) {
    if (state_ == State::Open) {
      finishShutdown();
    } else if (state_ == State::Handshaking || (state_ == State::Idle && started_)) {
      // after the queued writes, once secure
      shutdownPending_ = true;
    } else {
      transport_->shutdown();
    }
  });
}

void HybridTlsSocket::close() {
  transport_->close();
}

void HybridTlsSocket::write(double _id, const std::shared_ptr<ArrayBuffer>& buffer) {
  const uint64_t id = static_cast<uint64_t>(_id);
  // Copy the JS buffer: it may be released before the task runs.
  const auto* bytes = reinterpret_cast<const char*>(buffer->data());
  std::vector<char> data(bytes, bytes + buffer->size());

  loop_.post([this, id, data = std::move(data)](uv_loop_t*) mutable {
    if (state_ == State::Idle || state_ == State::Handshaking) {
      queuedBytes_ += data.size();
      queuedWrites_.push_back(QueuedWrite{id, std::move(data)});
      return;
    }
    writePlaintext(id, data.data(), data.size());
  });
}

void HybridTlsSocket::connect(const std::string& host, double port) {
  transport_->connect(host, port);
}

double HybridTlsSocket::getWriteQueueSize() {
  return loop_.runSync<double>([this](uv_loop_t*) -> double {
    return transport_->getWriteQueueSize() + static_cast<double>(queuedBytes_ + outbound_.size());
  });
}

void HybridTlsSocket::setNoDelay(bool enable) {
  transport_->setNoDelay(enable);
}

void HybridTlsSocket::setKeepAlive(bool enable, double initialDelaySeconds) {
  transport_->setKeepAlive(enable, initialDelaySeconds);
}

std::variant<nitro::NullType, SockAddr> HybridTlsSocket::getSockName() {
  return transport_->getSockName();
}

std::variant<nitro::NullType, SockAddr> HybridTlsSocket::getPeerName() {
  return transport_->getPeerName();
}

void HybridTlsSocket::startTls(const TlsClientOptions& options) {
  loop_.post([this, options](uv_loop_t*) {
    if (started_) {
      return;
    }
    started_ = true;

    tls_context* ctx = sharedContext(options.rejectUnauthorized);
    // Without a servername there is no SNI and no name to check.
    const char* servername =
      options.servername.has_value() && !options.servername->empty() ? options.servername->c_str() : nullptr;
    engine_ = ctx != nullptr ? ctx->new_engine(ctx, servername) : nullptr;
    if (engine_ == nullptr) {
      failHandshake("Could not create a TLS engine");
      return;
    }
    engine_->set_io(engine_, this, engineRead, engineWrite);

    if (options.ALPNProtocols.has_value() && !options.ALPNProtocols->empty()) {
      std::vector<const char*> protocols;
      for (const auto& protocol : *options.ALPNProtocols) {
        protocols.push_back(protocol.c_str());
      }
      engine_->set_protocols(engine_, protocols.data(), static_cast<int>(protocols.size()));
    }

    if (connected_) {
      beginHandshake();
    }
  });
}

std::optional<std::string> HybridTlsSocket::getAlpnProtocol() {
  return loop_.runSync<std::optional<std::string>>([this](uv_loop_t*) { return alpn_; });
}

// MARK: - Transport events (loop thread)

void HybridTlsSocket::onTransportConnect(int status) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  connected_ = status == 0;
  // Like Node: 'connect' when TCP is up, 'secureConnect' (onSecure) later.
  onConnect_.call(static_cast<double>(status));
  if (connected_ && started_ && state_ == State::Idle) {
    beginHandshake();
  }
}

void HybridTlsSocket::onTransportData(const char* data, size_t size) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  if (state_ == State::Failed) {
    return;
  }
  if (inboundOffset_ > 0) {
    inbound_.erase(0, inboundOffset_);
    inboundOffset_ = 0;
  }
  inbound_.append(data, size);

  if (state_ == State::Handshaking) {
    continueHandshake();
  } else if (state_ == State::Open) {
    drainPlaintext();
  }
}

void HybridTlsSocket::onTransportEnd(int status) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  if (status != UV_EOF) {
    // A broken connection: JS gets the error like from a plain socket.
    const bool wasFailed = state_ == State::Failed;
    state_ = State::Failed;
    transportEnded_ = true;
    updateReading();
    if (!wasFailed) {
      onRead_.call(ArrayBuffer::allocate(0), static_cast<double>(status));
    }
    return;
  }

  transportEnded_ = true;
  updateReading();
  switch (state_) {
    case State::Handshaking:
      failHandshake(kDisconnectedMessage);
      break;
    case State::Open:
      // The engine reads what is left, then reports the end of the stream.
      drainPlaintext();
      break;
    case State::Idle:
      deliverEof();
      break;
    case State::Failed:
      break;
  }
}

void HybridTlsSocket::onTransportWrite(uint64_t, int status) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  if (rawWrites_.empty()) {
    return;
  }
  const std::optional<uint64_t> jsId = rawWrites_.front();
  rawWrites_.pop_front();
  if (jsId.has_value()) {
    onWrite_.call(static_cast<double>(*jsId), static_cast<double>(status));
  }
}

void HybridTlsSocket::onTransportClose() {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  connected_ = false;
  reading_ = false;
  // Writes still waiting for the handshake will never be sent.
  for (const auto& queued : queuedWrites_) {
    onWrite_.call(static_cast<double>(queued.id), static_cast<double>(UV_ECANCELED));
  }
  queuedWrites_.clear();
  queuedBytes_ = 0;
  onClose_.call();
}

// MARK: - Engine IO (loop thread, from inside engine calls)

ssize_t HybridTlsSocket::engineRead(io_ctx ctx, char* buf, size_t len) {
  auto* self = static_cast<HybridTlsSocket*>(ctx);
  const size_t available = self->inbound_.size() - self->inboundOffset_;
  if (available == 0) {
    // 0 is the end of the stream for the engine; TLS_AGAIN means "later".
    return self->transportEnded_ ? 0 : TLS_AGAIN;
  }
  const size_t n = len < available ? len : available;
  memcpy(buf, self->inbound_.data() + self->inboundOffset_, n);
  self->inboundOffset_ += n;
  if (self->inboundOffset_ == self->inbound_.size()) {
    self->inbound_.clear();
    self->inboundOffset_ = 0;
  }
  return static_cast<ssize_t>(n);
}

ssize_t HybridTlsSocket::engineWrite(io_ctx ctx, const char* buf, size_t len) {
  auto* self = static_cast<HybridTlsSocket*>(ctx);
  // Collected and sent as one write once the engine call returns.
  self->outbound_.append(buf, len);
  return static_cast<ssize_t>(len);
}

// MARK: - TLS (loop thread)

void HybridTlsSocket::beginHandshake() {
  state_ = State::Handshaking;
  updateReading();
  continueHandshake();
}

void HybridTlsSocket::continueHandshake() {
  if (state_ != State::Handshaking) {
    return;
  }

  const tls_handshake_state hs = engine_->handshake(engine_);
  flushOutbound();

  if (hs == TLS_HS_ERROR) {
    failHandshake(engineError("TLS handshake failed"));
    return;
  }
  if (hs != TLS_HS_COMPLETE) {
    // waiting for the server's next flight
    return;
  }

  state_ = State::Open;
  // The engine owns the string, and allocates a new one on every call.
  const char* alpn = engine_->get_alpn(engine_);
  if (alpn != nullptr && alpn[0] != '\0') {
    alpn_ = alpn;
  }
  onSecure_.call(std::nullopt);

  while (!queuedWrites_.empty()) {
    QueuedWrite queued = std::move(queuedWrites_.front());
    queuedWrites_.pop_front();
    queuedBytes_ -= queued.data.size();
    writePlaintext(queued.id, queued.data.data(), queued.data.size());
  }
  if (shutdownPending_) {
    shutdownPending_ = false;
    finishShutdown();
  }

  updateReading();
  // The server's first records may have come with its last handshake flight.
  drainPlaintext();
}

void HybridTlsSocket::failHandshake(const std::string& message) {
  state_ = State::Failed;
  updateReading();
  for (const auto& queued : queuedWrites_) {
    onWrite_.call(static_cast<double>(queued.id), static_cast<double>(UV_ECANCELED));
  }
  queuedWrites_.clear();
  queuedBytes_ = 0;
  onSecure_.call(std::optional<std::string>(message));
}

void HybridTlsSocket::writePlaintext(uint64_t id, const char* data, size_t size) {
  if (state_ != State::Open) {
    onWrite_.call(static_cast<double>(id), static_cast<double>(UV_EPIPE));
    return;
  }
  if (size == 0) {
    onWrite_.call(static_cast<double>(id), 0.0);
    return;
  }

  // The engine encrypts all of it: engineWrite never pushes back.
  const int r = engine_->write(engine_, data, size);
  if (r < 0) {
    LOGD("TLS write failed: %s", engineError("unknown error").c_str());
    outbound_.clear();
    onWrite_.call(static_cast<double>(id), static_cast<double>(UV_EPROTO));
    return;
  }
  flushOutbound(id);
}

void HybridTlsSocket::drainPlaintext() {
  while (state_ == State::Open && !paused_ && !eofDelivered_) {
    auto* out = static_cast<char*>(malloc(kReadSize));
    if (out == nullptr) {
      state_ = State::Failed;
      updateReading();
      onRead_.call(ArrayBuffer::allocate(0), static_cast<double>(UV_ENOMEM));
      return;
    }

    size_t n = 0;
    const int r = engine_->read(engine_, out, &n, kReadSize);
    // Reading can make the engine answer: TLS 1.3 key updates, alerts.
    flushOutbound();

    if (n > 0) {
      // As in HybridNetSocket: shrink, then JS owns the memory.
      char* base = out;
      if (auto* shrunk = static_cast<char*>(realloc(out, n))) {
        base = shrunk;
      }
      onRead_.call(ArrayBuffer::wrap((uint8_t*) base, n, [base]() { free(base); }), static_cast<double>(n));
    } else {
      free(out);
    }

    if (r == TLS_ERR) {
      LOGD("TLS read failed: %s", engineError("unknown error").c_str());
      state_ = State::Failed;
      updateReading();
      onRead_.call(ArrayBuffer::allocate(0), static_cast<double>(UV_EPROTO));
      return;
    }
    if (r == TLS_EOF) {
      // tlsuv also says EOF once we sent our close_notify, while the peer may
      // still be sending (a half-close): then only the end of TCP ends it.
      if (closeNotifySent_ && !transportEnded_) {
        return;
      }
      deliverEof();
      return;
    }
    if (n == 0) {
      // TLS_AGAIN: everything received so far is consumed.
      if (transportEnded_ && inbound_.size() == inboundOffset_) {
        deliverEof();
      }
      return;
    }
  }
}

void HybridTlsSocket::deliverEof() {
  if (eofDelivered_) {
    return;
  }
  eofDelivered_ = true;
  onRead_.call(ArrayBuffer::allocate(0), static_cast<double>(UV_EOF));
}

void HybridTlsSocket::finishShutdown() {
  // close_notify first, then the TCP half-close behind it.
  engine_->close(engine_);
  closeNotifySent_ = true;
  flushOutbound();
  transport_->shutdown();
}

void HybridTlsSocket::flushOutbound(std::optional<uint64_t> jsId) {
  if (outbound_.empty()) {
    if (jsId.has_value()) {
      onWrite_.call(static_cast<double>(*jsId), 0.0);
    }
    return;
  }

  const size_t size = outbound_.size();
  auto* data = static_cast<char*>(malloc(size));
  if (data == nullptr) {
    outbound_.clear();
    if (jsId.has_value()) {
      onWrite_.call(static_cast<double>(*jsId), static_cast<double>(UV_ENOMEM));
    }
    return;
  }
  memcpy(data, outbound_.data(), size);
  outbound_.clear();

  rawWrites_.push_back(jsId);
  const int r = transport_->writeRaw(nextRawId_++, data, size);
  if (r < 0) {
    rawWrites_.pop_back();
    if (jsId.has_value()) {
      onWrite_.call(static_cast<double>(*jsId), static_cast<double>(r));
    }
  }
}

void HybridTlsSocket::updateReading() {
  const bool want = connected_ && !transportEnded_ &&
                    (state_ == State::Handshaking || (state_ == State::Open && !paused_));
  if (want == reading_) {
    return;
  }
  reading_ = want;
  if (want) {
    transport_->resume();
  } else {
    transport_->pause();
  }
}

std::string HybridTlsSocket::engineError(const char* fallback) const {
  const char* error = engine_ != nullptr ? engine_->strerror(engine_) : nullptr;
  return error != nullptr && error[0] != '\0' ? error : fallback;
}

} // namespace margelo::nitro::node
