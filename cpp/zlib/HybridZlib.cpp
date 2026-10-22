#include "HybridZlib.hpp"

#include <stdexcept>

namespace margelo::nitro::node {

namespace {

// Raw bytes [offset, offset + length) of `buffer`; throws when that range is
// outside of it. JS-owned buffers can only be read on the JS thread.
uint8_t* rangeOf(const std::shared_ptr<ArrayBuffer>& buffer, double offset, double length) {
  if (offset < 0 || length < 0 || offset + length > static_cast<double>(buffer->size())) {
    throw std::invalid_argument("zlib: range outside of the buffer");
  }
  uint8_t* data = buffer->data();
  if (data == nullptr) {
    if (length == 0) {
      return nullptr;
    }
    throw std::invalid_argument("zlib: the buffer is gone");
  }
  return data + static_cast<size_t>(offset);
}

std::vector<uint8_t> bytesOf(const std::optional<std::shared_ptr<ArrayBuffer>>& buffer) {
  if (!buffer.has_value() || *buffer == nullptr) {
    return {};
  }
  const auto& b = *buffer;
  uint8_t* data = rangeOf(b, 0, static_cast<double>(b->size()));
  return data != nullptr ? std::vector<uint8_t>(data, data + b->size()) : std::vector<uint8_t>{};
}

// Node's params arrays: -1 (as a Uint32, 2^32 - 1) is "not set"
constexpr double kUnset = 4294967295.0;

ZlibError closedError() {
  return ZlibError("zlib binding closed", Z_STREAM_ERROR, "Z_STREAM_ERROR");
}

} // namespace

void HybridZlib::init(double mode, double windowBits, double level, double memLevel, double strategy,
                      const std::optional<std::shared_ptr<ArrayBuffer>>& dictionary) {
  auto m = static_cast<ZlibMode>(static_cast<int>(mode));
  if (m < ZLIB_MODE_DEFLATE || m > ZLIB_MODE_UNZIP) {
    throw std::invalid_argument("zlib: bad mode");
  }
  auto bytes = bytesOf(dictionary);
  std::lock_guard<std::mutex> lock(mutex_);
  ctx_ = std::make_unique<ZlibContext>(m, static_cast<int>(level), static_cast<int>(windowBits),
                                       static_cast<int>(memLevel), static_cast<int>(strategy),
                                       std::vector<unsigned char>(bytes.begin(), bytes.end()));
}

std::optional<ZlibError> HybridZlib::initBrotli(double mode, const std::vector<double>& params) {
  std::lock_guard<std::mutex> lock(mutex_);
  // As Node's BrotliCompressionStream::Init: the instance, then each parameter set
  auto setParams = [&params](auto& context) -> std::optional<ZlibError> {
    if (auto err = context.init()) {
      return err;
    }
    for (size_t key = 0; key < params.size(); key++) {
      if (params[key] == kUnset) {
        continue;
      }
      if (auto err = context.setParameter(static_cast<int>(key), static_cast<uint32_t>(params[key]))) {
        return err;
      }
    }
    return std::nullopt;
  };
  if (static_cast<int>(mode) == ZLIB_MODE_BROTLI_ENCODE) {
    auto context = std::make_unique<BrotliEncoderContext>();
    auto err = setParams(*context);
    ctx_ = std::move(context);
    return err;
  }
  if (static_cast<int>(mode) == ZLIB_MODE_BROTLI_DECODE) {
    auto context = std::make_unique<BrotliDecoderContext>();
    auto err = setParams(*context);
    ctx_ = std::move(context);
    return err;
  }
  throw std::invalid_argument("zlib: bad Brotli mode");
}

std::optional<ZlibError> HybridZlib::initZstd(double mode, const std::vector<double>& params,
                                              std::optional<double> pledgedSrcSize,
                                              const std::optional<std::shared_ptr<ArrayBuffer>>& dictionary) {
  auto dict = bytesOf(dictionary);
  std::lock_guard<std::mutex> lock(mutex_);
  // As Node's ZstdStream::Init: the context and dictionary, then each parameter
  auto setParams = [&params](auto& context) -> std::optional<ZlibError> {
    for (size_t key = 0; key < params.size(); key++) {
      if (params[key] == kUnset) {
        continue;
      }
      // a Uint32 read as an int, as Node
      int value = static_cast<int>(static_cast<uint32_t>(params[key]));
      if (auto err = context.setParameter(static_cast<int>(key), value)) {
        return err;
      }
    }
    return std::nullopt;
  };
  if (static_cast<int>(mode) == ZLIB_MODE_ZSTD_COMPRESS) {
    auto context = std::make_unique<ZstdCompressContext>();
    uint64_t size = pledgedSrcSize.has_value() ? static_cast<uint64_t>(*pledgedSrcSize) : ZSTD_CONTENTSIZE_UNKNOWN;
    auto err = context->init(size, dict);
    if (!err) {
      err = setParams(*context);
    }
    ctx_ = std::move(context);
    return err;
  }
  if (static_cast<int>(mode) == ZLIB_MODE_ZSTD_DECOMPRESS) {
    auto context = std::make_unique<ZstdDecompressContext>();
    auto err = context->init(dict);
    if (!err) {
      err = setParams(*context);
    }
    ctx_ = std::move(context);
    return err;
  }
  throw std::invalid_argument("zlib: bad zstd mode");
}

void HybridZlib::beginWrite() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (writeInProgress_) {
    throw std::logic_error("zlib: a write is already in progress");
  }
  writeInProgress_ = true;
}

std::shared_ptr<Promise<ZlibWriteResult>> HybridZlib::write(double flush, const std::shared_ptr<ArrayBuffer>& input,
                                                            double inOff, double inLen, double outLen) {
  // a copy: the input can only be read here, on the JS thread
  const uint8_t* in = rangeOf(input, inOff, inLen);
  std::vector<uint8_t> inCopy(in, in + static_cast<size_t>(inLen));
  beginWrite();
  auto self = this->shared_cast<HybridZlib>();
  auto outSize = static_cast<size_t>(outLen);
  return Promise<ZlibWriteResult>::async([self, flush, inCopy = std::move(inCopy), outSize]() {
    std::vector<uint8_t> out(outSize);
    ZlibWriteResult result = self->process(static_cast<int>(flush), inCopy.data(), inCopy.size(), out.data(), outSize);
    size_t produced = outSize - static_cast<size_t>(result.availOut);
    result.output = produced > 0 ? ArrayBuffer::copy(out.data(), produced) : ArrayBuffer::allocate(0);
    return result;
  });
}

ZlibWriteResult HybridZlib::writeSync(double flush, const std::shared_ptr<ArrayBuffer>& input, double inOff,
                                      double inLen, const std::shared_ptr<ArrayBuffer>& output, double outOff,
                                      double outLen) {
  const uint8_t* in = rangeOf(input, inOff, inLen);
  uint8_t* out = rangeOf(output, outOff, outLen);
  beginWrite();
  return process(static_cast<int>(flush), in, static_cast<size_t>(inLen), out, static_cast<size_t>(outLen));
}

ZlibWriteResult HybridZlib::process(int flush, const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen) {
  std::lock_guard<std::mutex> lock(mutex_);
  std::optional<ZlibError> error;
  size_t availIn = inLen;
  size_t availOut = outLen;
  if (ctx_ == nullptr) {
    // closed, or never set up
    error = closedError();
  } else {
    ctx_->setBuffers(in, inLen, out, outLen);
    ctx_->setFlush(flush);
    ctx_->doWork();
    error = ctx_->errorInfo();
    ctx_->afterWriteOffsets(&availIn, &availOut);
    ctx_->clearBuffers();
  }
  writeInProgress_ = false;
  if (pendingClose_) {
    pendingClose_ = false;
    if (ctx_ != nullptr) {
      ctx_->close();
      ctx_.reset();
    }
  }
  return ZlibWriteResult(static_cast<double>(availOut), static_cast<double>(availIn), std::nullopt, error);
}

std::optional<ZlibError> HybridZlib::params(double level, double strategy) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (ctx_ == nullptr) {
    return closedError();
  }
  return ctx_->setParams(static_cast<int>(level), static_cast<int>(strategy));
}

std::optional<ZlibError> HybridZlib::reset() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (ctx_ == nullptr) {
    return closedError();
  }
  return ctx_->resetStream();
}

void HybridZlib::close() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (writeInProgress_) {
    pendingClose_ = true;
    return;
  }
  if (ctx_ != nullptr) {
    ctx_->close();
    ctx_.reset();
  }
}

double HybridZlib::crc32(const std::shared_ptr<ArrayBuffer>& data, double offset, double length, double value) {
  const uint8_t* bytes = rangeOf(data, offset, length);
  return static_cast<double>(::crc32(static_cast<uLong>(value), bytes, static_cast<uInt>(length)));
}

} // namespace margelo::nitro::node
