#include "CompressionContexts.hpp"

namespace margelo::nitro::node {

namespace {

constexpr unsigned char GZIP_HEADER_ID1 = 0x1f;
constexpr unsigned char GZIP_HEADER_ID2 = 0x8b;

// Node's ZlibStrerror: the name of a zlib status.
const char* zlibStrerror(int err) {
  switch (err) {
    case Z_OK: return "Z_OK";
    case Z_STREAM_END: return "Z_STREAM_END";
    case Z_NEED_DICT: return "Z_NEED_DICT";
    case Z_ERRNO: return "Z_ERRNO";
    case Z_STREAM_ERROR: return "Z_STREAM_ERROR";
    case Z_DATA_ERROR: return "Z_DATA_ERROR";
    case Z_MEM_ERROR: return "Z_MEM_ERROR";
    case Z_BUF_ERROR: return "Z_BUF_ERROR";
    case Z_VERSION_ERROR: return "Z_VERSION_ERROR";
    default: return "Z_UNKNOWN_ERROR";
  }
}

// Node's ZstdStrerror: the name of a zstd error.
const char* zstdStrerror(int err) {
#define V(code) \
  if (err == code) return #code;
  V(ZSTD_error_no_error)
  V(ZSTD_error_GENERIC)
  V(ZSTD_error_prefix_unknown)
  V(ZSTD_error_version_unsupported)
  V(ZSTD_error_frameParameter_unsupported)
  V(ZSTD_error_frameParameter_windowTooLarge)
  V(ZSTD_error_corruption_detected)
  V(ZSTD_error_checksum_wrong)
  V(ZSTD_error_literals_headerWrong)
  V(ZSTD_error_dictionary_corrupted)
  V(ZSTD_error_dictionary_wrong)
  V(ZSTD_error_dictionaryCreation_failed)
  V(ZSTD_error_parameter_unsupported)
  V(ZSTD_error_parameter_combination_unsupported)
  V(ZSTD_error_parameter_outOfBound)
  V(ZSTD_error_tableLog_tooLarge)
  V(ZSTD_error_maxSymbolValue_tooLarge)
  V(ZSTD_error_maxSymbolValue_tooSmall)
  V(ZSTD_error_stabilityCondition_notRespected)
  V(ZSTD_error_stage_wrong)
  V(ZSTD_error_init_missing)
  V(ZSTD_error_memory_allocation)
  V(ZSTD_error_workSpace_tooSmall)
  V(ZSTD_error_dstSize_tooSmall)
  V(ZSTD_error_srcSize_wrong)
  V(ZSTD_error_dstBuffer_null)
  V(ZSTD_error_noForwardProgress_destFull)
  V(ZSTD_error_noForwardProgress_inputEmpty)
#undef V
  return "ZSTD_error_GENERIC";
}

ZlibError error(const char* message, const char* code, int err) {
  return ZlibError(message, err, code);
}

} // namespace

// ---- zlib: Node's ZlibContext ----

ZlibContext::ZlibContext(ZlibMode mode, int level, int windowBits, int memLevel, int strategy,
                         std::vector<unsigned char> dictionary)
    : mode_(mode), level_(level), windowBits_(windowBits), memLevel_(memLevel), strategy_(strategy),
      dictionary_(std::move(dictionary)) {
  if (mode_ == ZLIB_MODE_GZIP || mode_ == ZLIB_MODE_GUNZIP) {
    windowBits_ += 16;
  }
  if (mode_ == ZLIB_MODE_UNZIP) {
    windowBits_ += 32;
  }
  if (mode_ == ZLIB_MODE_DEFLATERAW || mode_ == ZLIB_MODE_INFLATERAW) {
    windowBits_ *= -1;
  }
}

ZlibContext::~ZlibContext() {
  close();
}

void ZlibContext::setBuffers(const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen) {
  strm_.avail_in = static_cast<uInt>(inLen);
  strm_.next_in = const_cast<Bytef*>(in);
  strm_.avail_out = static_cast<uInt>(outLen);
  strm_.next_out = out;
}

void ZlibContext::clearBuffers() {
  strm_.next_in = nullptr;
  strm_.next_out = nullptr;
}

void ZlibContext::setFlush(int flush) {
  flush_ = flush;
}

void ZlibContext::afterWriteOffsets(size_t* availIn, size_t* availOut) const {
  *availIn = strm_.avail_in;
  *availOut = strm_.avail_out;
}

bool ZlibContext::initZlib() {
  if (zlibInitDone_) {
    return false;
  }
  switch (mode_) {
    case ZLIB_MODE_DEFLATE:
    case ZLIB_MODE_GZIP:
    case ZLIB_MODE_DEFLATERAW:
      err_ = deflateInit2(&strm_, level_, Z_DEFLATED, windowBits_, memLevel_, strategy_);
      break;
    case ZLIB_MODE_INFLATE:
    case ZLIB_MODE_GUNZIP:
    case ZLIB_MODE_INFLATERAW:
    case ZLIB_MODE_UNZIP:
      err_ = inflateInit2(&strm_, windowBits_);
      break;
    default:
      return false;
  }
  if (err_ != Z_OK) {
    dictionary_.clear();
    mode_ = ZLIB_MODE_NONE;
    return true;
  }
  setDictionary();
  zlibInitDone_ = true;
  return true;
}

void ZlibContext::doWork() {
  bool firstInit = initZlib();
  if (firstInit && err_ != Z_OK) {
    return;
  }

  const Bytef* nextExpectedHeaderByte = nullptr;
  switch (mode_) {
    case ZLIB_MODE_DEFLATE:
    case ZLIB_MODE_GZIP:
    case ZLIB_MODE_DEFLATERAW:
      err_ = deflate(&strm_, flush_);
      break;
    case ZLIB_MODE_UNZIP:
      if (strm_.avail_in > 0) {
        nextExpectedHeaderByte = strm_.next_in;
      }
      switch (gzipIdBytesRead_) {
        case 0:
          if (nextExpectedHeaderByte == nullptr) {
            break;
          }
          if (*nextExpectedHeaderByte == GZIP_HEADER_ID1) {
            gzipIdBytesRead_ = 1;
            nextExpectedHeaderByte++;
            if (strm_.avail_in == 1) {
              // the only available byte was already read
              break;
            }
          } else {
            mode_ = ZLIB_MODE_INFLATE;
            break;
          }
          [[fallthrough]];
        case 1:
          if (nextExpectedHeaderByte == nullptr) {
            break;
          }
          if (*nextExpectedHeaderByte == GZIP_HEADER_ID2) {
            gzipIdBytesRead_ = 2;
            mode_ = ZLIB_MODE_GUNZIP;
          } else {
            mode_ = ZLIB_MODE_INFLATE;
          }
          break;
        default:
          break;
      }
      [[fallthrough]];
    case ZLIB_MODE_INFLATE:
    case ZLIB_MODE_GUNZIP:
    case ZLIB_MODE_INFLATERAW:
      err_ = inflate(&strm_, flush_);
      // A dictionary was used to encode (INFLATERAW sets it in setDictionary)
      if (mode_ != ZLIB_MODE_INFLATERAW && err_ == Z_NEED_DICT && !dictionary_.empty()) {
        err_ = inflateSetDictionary(&strm_, dictionary_.data(), static_cast<uInt>(dictionary_.size()));
        if (err_ == Z_OK) {
          err_ = inflate(&strm_, flush_);
        } else if (err_ == Z_DATA_ERROR) {
          // Both inflateSetDictionary() and inflate() return Z_DATA_ERROR:
          // tell a bad dictionary from bad input
          err_ = Z_NEED_DICT;
        }
      }
      while (strm_.avail_in > 0 && mode_ == ZLIB_MODE_GUNZIP && err_ == Z_STREAM_END && strm_.next_in[0] != 0x00) {
        // More input: another member of the same gzip file, or trailing
        // garbage. Trailing zero bytes are fine, they are often padding.
        resetStream();
        err_ = inflate(&strm_, flush_);
      }
      break;
    default:
      break;
  }
}

ZlibError ZlibContext::errorFor(const char* message) const {
  if (strm_.msg != nullptr) {
    message = strm_.msg;
  }
  return error(message, zlibStrerror(err_), err_);
}

std::optional<ZlibError> ZlibContext::errorInfo() const {
  if (mode_ == ZLIB_MODE_NONE && !zlibInitDone_ && err_ == Z_OK) {
    // closed
    return error("zlib binding closed", zlibStrerror(Z_STREAM_ERROR), Z_STREAM_ERROR);
  }
  // Acceptable error states depend on the type of zlib stream
  switch (err_) {
    case Z_OK:
    case Z_BUF_ERROR:
      if (strm_.avail_out != 0 && flush_ == Z_FINISH) {
        return errorFor("unexpected end of file");
      }
      [[fallthrough]];
    case Z_STREAM_END:
      // normal statuses, not fatal
      break;
    case Z_NEED_DICT:
      return errorFor(dictionary_.empty() ? "Missing dictionary" : "Bad dictionary");
    default:
      return errorFor("Zlib error");
  }
  return std::nullopt;
}

std::optional<ZlibError> ZlibContext::setDictionary() {
  if (dictionary_.empty()) {
    return std::nullopt;
  }
  err_ = Z_OK;
  switch (mode_) {
    case ZLIB_MODE_DEFLATE:
    case ZLIB_MODE_DEFLATERAW:
      err_ = deflateSetDictionary(&strm_, dictionary_.data(), static_cast<uInt>(dictionary_.size()));
      break;
    case ZLIB_MODE_INFLATERAW:
      // the other inflate modes set it when inflate() returns Z_NEED_DICT
      err_ = inflateSetDictionary(&strm_, dictionary_.data(), static_cast<uInt>(dictionary_.size()));
      break;
    default:
      break;
  }
  if (err_ != Z_OK) {
    return errorFor("Failed to set dictionary");
  }
  return std::nullopt;
}

std::optional<ZlibError> ZlibContext::resetStream() {
  bool firstInit = initZlib();
  if (firstInit && err_ != Z_OK) {
    return errorFor("Failed to init stream before reset");
  }
  err_ = Z_OK;
  switch (mode_) {
    case ZLIB_MODE_DEFLATE:
    case ZLIB_MODE_DEFLATERAW:
    case ZLIB_MODE_GZIP:
      err_ = deflateReset(&strm_);
      break;
    case ZLIB_MODE_INFLATE:
    case ZLIB_MODE_INFLATERAW:
    case ZLIB_MODE_GUNZIP:
      err_ = inflateReset(&strm_);
      break;
    default:
      break;
  }
  if (err_ != Z_OK) {
    return errorFor("Failed to reset stream");
  }
  return setDictionary();
}

std::optional<ZlibError> ZlibContext::setParams(int level, int strategy) {
  bool firstInit = initZlib();
  if (firstInit && err_ != Z_OK) {
    return errorFor("Failed to init stream before set parameters");
  }
  err_ = Z_OK;
  // deflateParams() runs deflate(Z_BLOCK), which needs buffers: Node's stream
  // still points at the last write's, ours points nowhere after a write. JS
  // calls params() right after a sync flush, so nothing is left to write.
  unsigned char scratch[64];
  setBuffers(scratch, 0, scratch, sizeof(scratch));
  switch (mode_) {
    case ZLIB_MODE_DEFLATE:
    case ZLIB_MODE_DEFLATERAW:
      err_ = deflateParams(&strm_, level, strategy);
      break;
    default:
      break;
  }
  clearBuffers();
  strm_.avail_out = 0;
  if (err_ != Z_OK && err_ != Z_BUF_ERROR) {
    return errorFor("Failed to set parameters");
  }
  return std::nullopt;
}

void ZlibContext::close() {
  if (zlibInitDone_) {
    if (mode_ == ZLIB_MODE_DEFLATE || mode_ == ZLIB_MODE_GZIP || mode_ == ZLIB_MODE_DEFLATERAW) {
      deflateEnd(&strm_);
    } else if (mode_ == ZLIB_MODE_INFLATE || mode_ == ZLIB_MODE_GUNZIP || mode_ == ZLIB_MODE_INFLATERAW ||
               mode_ == ZLIB_MODE_UNZIP) {
      inflateEnd(&strm_);
    }
  }
  zlibInitDone_ = false;
  mode_ = ZLIB_MODE_NONE;
  dictionary_.clear();
}

// ---- Brotli: Node's BrotliEncoderContext and BrotliDecoderContext ----

BrotliEncoderContext::~BrotliEncoderContext() {
  close();
}

std::optional<ZlibError> BrotliEncoderContext::init() {
  if (state_ != nullptr) {
    BrotliEncoderDestroyInstance(state_);
  }
  state_ = BrotliEncoderCreateInstance(nullptr, nullptr, nullptr);
  if (state_ == nullptr) {
    return error("Could not initialize Brotli instance", "ERR_ZLIB_INITIALIZATION_FAILED", -1);
  }
  return std::nullopt;
}

std::optional<ZlibError> BrotliEncoderContext::setParameter(int key, uint32_t value) {
  if (!BrotliEncoderSetParameter(state_, static_cast<BrotliEncoderParameter>(key), value)) {
    return error("Setting parameter failed", "ERR_BROTLI_PARAM_SET_FAILED", -1);
  }
  return std::nullopt;
}

void BrotliEncoderContext::setBuffers(const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen) {
  nextIn_ = in;
  nextOut_ = out;
  availIn_ = inLen;
  availOut_ = outLen;
}

void BrotliEncoderContext::clearBuffers() {
  nextIn_ = nullptr;
  nextOut_ = nullptr;
}

void BrotliEncoderContext::setFlush(int flush) {
  flush_ = static_cast<BrotliEncoderOperation>(flush);
}

void BrotliEncoderContext::afterWriteOffsets(size_t* availIn, size_t* availOut) const {
  *availIn = availIn_;
  *availOut = availOut_;
}

void BrotliEncoderContext::doWork() {
  if (state_ == nullptr) {
    lastResult_ = false;
    return;
  }
  const uint8_t* nextIn = nextIn_;
  lastResult_ = BrotliEncoderCompressStream(state_, flush_, &availIn_, &nextIn, &availOut_, &nextOut_, nullptr);
  nextIn_ = nextIn;
}

std::optional<ZlibError> BrotliEncoderContext::errorInfo() const {
  if (!lastResult_) {
    return error("Compression failed", "ERR_BROTLI_COMPRESSION_FAILED", -1);
  }
  return std::nullopt;
}

std::optional<ZlibError> BrotliEncoderContext::resetStream() {
  // as Node: a new instance, without the parameters set at init
  return init();
}

void BrotliEncoderContext::close() {
  if (state_ != nullptr) {
    BrotliEncoderDestroyInstance(state_);
    state_ = nullptr;
  }
}

BrotliDecoderContext::~BrotliDecoderContext() {
  close();
}

std::optional<ZlibError> BrotliDecoderContext::init() {
  if (state_ != nullptr) {
    BrotliDecoderDestroyInstance(state_);
  }
  state_ = BrotliDecoderCreateInstance(nullptr, nullptr, nullptr);
  if (state_ == nullptr) {
    return error("Could not initialize Brotli instance", "ERR_ZLIB_INITIALIZATION_FAILED", -1);
  }
  return std::nullopt;
}

std::optional<ZlibError> BrotliDecoderContext::setParameter(int key, uint32_t value) {
  if (!BrotliDecoderSetParameter(state_, static_cast<BrotliDecoderParameter>(key), value)) {
    return error("Setting parameter failed", "ERR_BROTLI_PARAM_SET_FAILED", -1);
  }
  return std::nullopt;
}

void BrotliDecoderContext::setBuffers(const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen) {
  nextIn_ = in;
  nextOut_ = out;
  availIn_ = inLen;
  availOut_ = outLen;
}

void BrotliDecoderContext::clearBuffers() {
  nextIn_ = nullptr;
  nextOut_ = nullptr;
}

void BrotliDecoderContext::setFlush(int flush) {
  flush_ = static_cast<BrotliEncoderOperation>(flush);
}

void BrotliDecoderContext::afterWriteOffsets(size_t* availIn, size_t* availOut) const {
  *availIn = availIn_;
  *availOut = availOut_;
}

void BrotliDecoderContext::doWork() {
  if (state_ == nullptr) {
    lastResult_ = BROTLI_DECODER_RESULT_ERROR;
    error_ = BROTLI_DECODER_ERROR_UNREACHABLE;
    errorString_ = std::string("ERR_") + BrotliDecoderErrorString(error_);
    return;
  }
  const uint8_t* nextIn = nextIn_;
  lastResult_ = BrotliDecoderDecompressStream(state_, &availIn_, &nextIn, &availOut_, &nextOut_, nullptr);
  nextIn_ = nextIn;
  if (lastResult_ == BROTLI_DECODER_RESULT_ERROR) {
    error_ = BrotliDecoderGetErrorCode(state_);
    errorString_ = std::string("ERR_") + BrotliDecoderErrorString(error_);
  }
}

std::optional<ZlibError> BrotliDecoderContext::errorInfo() const {
  if (error_ != BROTLI_DECODER_NO_ERROR) {
    return error("Decompression failed", errorString_.c_str(), static_cast<int>(error_));
  }
  if (flush_ == BROTLI_OPERATION_FINISH && lastResult_ == BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT) {
    // Match zlib's behaviour, as brotli doesn't have its own code for this
    return error("unexpected end of file", "Z_BUF_ERROR", Z_BUF_ERROR);
  }
  return std::nullopt;
}

std::optional<ZlibError> BrotliDecoderContext::resetStream() {
  return init();
}

void BrotliDecoderContext::close() {
  if (state_ != nullptr) {
    BrotliDecoderDestroyInstance(state_);
    state_ = nullptr;
  }
}

// ---- zstd: Node's ZstdContext, ZstdCompressContext and ZstdDecompressContext ----

void ZstdContext::setBuffers(const uint8_t* in, size_t inLen, uint8_t* out, size_t outLen) {
  input_.src = in;
  input_.size = inLen;
  input_.pos = 0;
  output_.dst = out;
  output_.size = outLen;
  output_.pos = 0;
}

void ZstdContext::clearBuffers() {
  // the offsets stay: afterWriteOffsets() still reads them
  input_.src = nullptr;
  output_.dst = nullptr;
}

void ZstdContext::setFlush(int flush) {
  flush_ = static_cast<ZSTD_EndDirective>(flush);
}

void ZstdContext::afterWriteOffsets(size_t* availIn, size_t* availOut) const {
  *availIn = input_.size - input_.pos;
  *availOut = output_.size - output_.pos;
}

std::optional<ZlibError> ZstdContext::errorInfo() const {
  if (error_ != ZSTD_error_no_error) {
    return error(errorString_.c_str(), errorCodeString_.c_str(), static_cast<int>(error_));
  }
  return std::nullopt;
}

void ZstdContext::setError(size_t result) {
  if (ZSTD_isError(result)) {
    error_ = ZSTD_getErrorCode(result);
    errorCodeString_ = zstdStrerror(error_);
    errorString_ = ZSTD_getErrorString(error_);
  }
}

ZstdCompressContext::~ZstdCompressContext() {
  ZSTD_freeCCtx(cctx_);
}

std::optional<ZlibError> ZstdCompressContext::init(uint64_t pledgedSrcSize, const std::vector<uint8_t>& dictionary) {
  pledgedSrcSize_ = pledgedSrcSize;
  ZSTD_freeCCtx(cctx_);
  cctx_ = ZSTD_createCCtx();
  if (cctx_ == nullptr) {
    return error("Could not initialize zstd instance", "ERR_ZLIB_INITIALIZATION_FAILED", -1);
  }
  if (!dictionary.empty()) {
    size_t ret = ZSTD_CCtx_loadDictionary(cctx_, dictionary.data(), dictionary.size());
    if (ZSTD_isError(ret)) {
      return error("Failed to load zstd dictionary", "ERR_ZLIB_DICTIONARY_LOAD_FAILED", -1);
    }
  }
  size_t result = ZSTD_CCtx_setPledgedSrcSize(cctx_, pledgedSrcSize);
  if (ZSTD_isError(result)) {
    return error("Could not set pledged src size", "ERR_ZLIB_INITIALIZATION_FAILED", -1);
  }
  return std::nullopt;
}

std::optional<ZlibError> ZstdCompressContext::setParameter(int key, int value) {
  size_t result = ZSTD_CCtx_setParameter(cctx_, static_cast<ZSTD_cParameter>(key), value);
  if (ZSTD_isError(result)) {
    return error("Setting parameter failed", "ERR_ZSTD_PARAM_SET_FAILED", -1);
  }
  return std::nullopt;
}

void ZstdCompressContext::doWork() {
  setError(ZSTD_compressStream2(cctx_, &output_, &input_, flush_));
}

std::optional<ZlibError> ZstdCompressContext::resetStream() {
  // as Node: a new context, without the dictionary and parameters
  return init(pledgedSrcSize_);
}

ZstdDecompressContext::~ZstdDecompressContext() {
  ZSTD_freeDCtx(dctx_);
}

std::optional<ZlibError> ZstdDecompressContext::init(const std::vector<uint8_t>& dictionary) {
  ZSTD_freeDCtx(dctx_);
  dctx_ = ZSTD_createDCtx();
  if (dctx_ == nullptr) {
    return error("Could not initialize zstd instance", "ERR_ZLIB_INITIALIZATION_FAILED", -1);
  }
  if (!dictionary.empty()) {
    size_t ret = ZSTD_DCtx_loadDictionary(dctx_, dictionary.data(), dictionary.size());
    if (ZSTD_isError(ret)) {
      return error("Failed to load zstd dictionary", "ERR_ZLIB_DICTIONARY_LOAD_FAILED", -1);
    }
  }
  return std::nullopt;
}

std::optional<ZlibError> ZstdDecompressContext::setParameter(int key, int value) {
  size_t result = ZSTD_DCtx_setParameter(dctx_, static_cast<ZSTD_dParameter>(key), value);
  if (ZSTD_isError(result)) {
    return error("Setting parameter failed", "ERR_ZSTD_PARAM_SET_FAILED", -1);
  }
  return std::nullopt;
}

void ZstdDecompressContext::doWork() {
  setError(ZSTD_decompressStream(dctx_, &output_, &input_));
}

std::optional<ZlibError> ZstdDecompressContext::resetStream() {
  return init();
}

} // namespace margelo::nitro::node
