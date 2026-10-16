#pragma once

#include <cstddef>
#include <cstdint>

namespace margelo::nitro::node {

// Lets native code (the TLS layer) consume a HybridNetSocket's raw TCP stream
// instead of JS, like a StreamListener in Node. While a listener is set, the
// socket reports everything here and none of its JS callbacks fire.
//
// Every method is called on the UV loop thread.
class TransportListener {
public:
  virtual ~TransportListener() = default;

  // The connection started by connect() succeeded (0) or failed (< 0). On
  // failure the handle is already closing; onTransportClose follows.
  virtual void onTransportConnect(int status) = 0;

  // Bytes read from the socket. They are only valid during the call.
  virtual void onTransportData(const char* data, size_t size) = 0;

  // The peer ended its side (UV_EOF) or reading failed (another error).
  virtual void onTransportEnd(int status) = 0;

  // A write started with writeRaw() completed (0) or failed (< 0).
  virtual void onTransportWrite(uint64_t id, int status) = 0;

  // The handle is closed; the socket can't be used anymore.
  virtual void onTransportClose() = 0;
};

} // namespace margelo::nitro::node
