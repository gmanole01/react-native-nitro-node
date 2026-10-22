#pragma once

#include <zlib.h>

#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "CompressionContexts.hpp"
#include "HybridNitroNodeZlibSpec.hpp"

namespace margelo::nitro::node {

// Node's CompressionStream (src/node_zlib.cc): one zlib, Brotli or zstd
// stream, on the engine its init*() picks. One write runs at a time (JS waits
// for it); a close() during an async write is done when the write is.
class HybridZlib : public HybridNitroNodeZlibSpec {
public:
  HybridZlib() : HybridObject(TAG), HybridNitroNodeZlibSpec() {}
  ~HybridZlib() override = default;

  double getVersion() override {
    return ZLIB_VERNUM;
  }

  void init(double mode, double windowBits, double level, double memLevel, double strategy,
            const std::optional<std::shared_ptr<ArrayBuffer>>& dictionary) override;
  std::optional<ZlibError> initBrotli(double mode, const std::vector<double>& params) override;
  std::optional<ZlibError> initZstd(double mode, const std::vector<double>& params, std::optional<double> pledgedSrcSize,
                                    const std::optional<std::shared_ptr<ArrayBuffer>>& dictionary) override;
  std::shared_ptr<Promise<ZlibWriteResult>> write(double flush, const std::shared_ptr<ArrayBuffer>& input, double inOff,
                                                  double inLen, double outLen) override;
  ZlibWriteResult writeSync(double flush, const std::shared_ptr<ArrayBuffer>& input, double inOff, double inLen,
                            const std::shared_ptr<ArrayBuffer>& output, double outOff, double outLen) override;
  std::optional<ZlibError> params(double level, double strategy) override;
  std::optional<ZlibError> reset() override;
  void close() override;
  double crc32(const std::shared_ptr<ArrayBuffer>& data, double offset, double length, double value) override;

private:
  // One step on [in, in + inLen) into [out, out + outLen).
  ZlibWriteResult process(int flush, const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen);
  void beginWrite();

  std::mutex mutex_;
  std::unique_ptr<CompressionContext> ctx_;
  bool writeInProgress_ = false;
  bool pendingClose_ = false;
};

} // namespace margelo::nitro::node
