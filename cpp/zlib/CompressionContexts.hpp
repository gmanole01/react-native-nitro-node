#pragma once

#include <zlib.h>

#include <brotli/decode.h>
#include <brotli/encode.h>
#include <zstd.h>
#include <zstd_errors.h>

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "ZlibError.hpp"

namespace margelo::nitro::node {

// Node's node_zlib_mode
enum ZlibMode {
  ZLIB_MODE_NONE,
  ZLIB_MODE_DEFLATE,
  ZLIB_MODE_INFLATE,
  ZLIB_MODE_GZIP,
  ZLIB_MODE_GUNZIP,
  ZLIB_MODE_DEFLATERAW,
  ZLIB_MODE_INFLATERAW,
  ZLIB_MODE_UNZIP,
  ZLIB_MODE_BROTLI_DECODE,
  ZLIB_MODE_BROTLI_ENCODE,
  ZLIB_MODE_ZSTD_COMPRESS,
  ZLIB_MODE_ZSTD_DECOMPRESS,
};

// One engine of a stream, as Node's ZlibContext, BrotliEncoderContext, ...
// (src/node_zlib.cc). The stream (HybridZlib) runs one step at a time and
// calls these with its lock held.
class CompressionContext {
public:
  virtual ~CompressionContext() = default;

  virtual void setBuffers(const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen) = 0;
  // Called after each step: nothing may point into the caller's buffers then.
  virtual void clearBuffers() = 0;
  virtual void setFlush(int flush) = 0;
  virtual void afterWriteOffsets(size_t* availIn, size_t* availOut) const = 0;
  virtual void doWork() = 0;
  virtual std::optional<ZlibError> errorInfo() const = 0;
  virtual std::optional<ZlibError> resetStream() = 0;
  // zlib only: Brotli and zstd have no params(), as in Node
  virtual std::optional<ZlibError> setParams(int /*level*/, int /*strategy*/) {
    return std::nullopt;
  }
  virtual void close() = 0;
};

class ZlibContext final : public CompressionContext {
public:
  ZlibContext(ZlibMode mode, int level, int windowBits, int memLevel, int strategy, std::vector<unsigned char> dictionary);
  ~ZlibContext() override;

  void setBuffers(const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen) override;
  void clearBuffers() override;
  void setFlush(int flush) override;
  void afterWriteOffsets(size_t* availIn, size_t* availOut) const override;
  void doWork() override;
  std::optional<ZlibError> errorInfo() const override;
  std::optional<ZlibError> resetStream() override;
  std::optional<ZlibError> setParams(int level, int strategy) override;
  void close() override;

private:
  bool initZlib();
  ZlibError errorFor(const char* message) const;
  std::optional<ZlibError> setDictionary();

  ZlibMode mode_;
  int level_;
  int windowBits_;
  int memLevel_;
  int strategy_;
  int flush_ = Z_NO_FLUSH;
  int err_ = Z_OK;
  int gzipIdBytesRead_ = 0;
  std::vector<unsigned char> dictionary_;
  z_stream strm_{};
  bool zlibInitDone_ = false;
};

class BrotliEncoderContext final : public CompressionContext {
public:
  ~BrotliEncoderContext() override;
  std::optional<ZlibError> init();
  std::optional<ZlibError> setParameter(int key, uint32_t value);

  void setBuffers(const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen) override;
  void clearBuffers() override;
  void setFlush(int flush) override;
  void afterWriteOffsets(size_t* availIn, size_t* availOut) const override;
  void doWork() override;
  std::optional<ZlibError> errorInfo() const override;
  std::optional<ZlibError> resetStream() override;
  void close() override;

private:
  BrotliEncoderState* state_ = nullptr;
  const uint8_t* nextIn_ = nullptr;
  uint8_t* nextOut_ = nullptr;
  size_t availIn_ = 0;
  size_t availOut_ = 0;
  BrotliEncoderOperation flush_ = BROTLI_OPERATION_PROCESS;
  bool lastResult_ = false;
};

class BrotliDecoderContext final : public CompressionContext {
public:
  ~BrotliDecoderContext() override;
  std::optional<ZlibError> init();
  std::optional<ZlibError> setParameter(int key, uint32_t value);

  void setBuffers(const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen) override;
  void clearBuffers() override;
  void setFlush(int flush) override;
  void afterWriteOffsets(size_t* availIn, size_t* availOut) const override;
  void doWork() override;
  std::optional<ZlibError> errorInfo() const override;
  std::optional<ZlibError> resetStream() override;
  void close() override;

private:
  BrotliDecoderState* state_ = nullptr;
  const uint8_t* nextIn_ = nullptr;
  uint8_t* nextOut_ = nullptr;
  size_t availIn_ = 0;
  size_t availOut_ = 0;
  BrotliEncoderOperation flush_ = BROTLI_OPERATION_PROCESS;
  BrotliDecoderResult lastResult_ = BROTLI_DECODER_RESULT_SUCCESS;
  BrotliDecoderErrorCode error_ = BROTLI_DECODER_NO_ERROR;
  std::string errorString_;
};

class ZstdContext : public CompressionContext {
public:
  void setBuffers(const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen) override;
  void clearBuffers() override;
  void setFlush(int flush) override;
  void afterWriteOffsets(size_t* availIn, size_t* availOut) const override;
  std::optional<ZlibError> errorInfo() const override;
  void close() override {}

protected:
  void setError(size_t result);

  ZSTD_EndDirective flush_ = ZSTD_e_continue;
  ZSTD_inBuffer input_ = {nullptr, 0, 0};
  ZSTD_outBuffer output_ = {nullptr, 0, 0};
  ZSTD_ErrorCode error_ = ZSTD_error_no_error;
  std::string errorString_;
  std::string errorCodeString_;
};

class ZstdCompressContext final : public ZstdContext {
public:
  ~ZstdCompressContext() override;
  std::optional<ZlibError> init(uint64_t pledgedSrcSize, const std::vector<uint8_t>& dictionary = {});
  std::optional<ZlibError> setParameter(int key, int value);

  void doWork() override;
  std::optional<ZlibError> resetStream() override;

private:
  ZSTD_CCtx* cctx_ = nullptr;
  uint64_t pledgedSrcSize_ = ZSTD_CONTENTSIZE_UNKNOWN;
};

class ZstdDecompressContext final : public ZstdContext {
public:
  ~ZstdDecompressContext() override;
  std::optional<ZlibError> init(const std::vector<uint8_t>& dictionary = {});
  std::optional<ZlibError> setParameter(int key, int value);

  void doWork() override;
  std::optional<ZlibError> resetStream() override;

private:
  ZSTD_DCtx* dctx_ = nullptr;
};

} // namespace margelo::nitro::node
