#pragma once

#include "HybridNitroNodeCryptoUtilsSpec.hpp"

namespace margelo::nitro::node {

class HybridUtils : public HybridNitroNodeCryptoUtilsSpec {
 public:
  HybridUtils() : HybridObject(TAG) {}

 public:
  bool timingSafeEqual(const std::shared_ptr<ArrayBuffer>& a, const std::shared_ptr<ArrayBuffer>& b) override;

 protected:
  void loadHybridMethods() override;

 private:
  facebook::jsi::Runtime* cachedRuntime_ = nullptr;
  bool cachedIsHermesRuntime_ = false;

  bool isHermesRuntime(facebook::jsi::Runtime& runtime);
  facebook::jsi::Value bufferToJsiString(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisArg,
                                         const facebook::jsi::Value* args, size_t argCount);
  facebook::jsi::Value jsiStringToBuffer(facebook::jsi::Runtime& runtime, const facebook::jsi::Value& thisArg,
                                         const facebook::jsi::Value* args, size_t argCount);
};

} // namespace margelo::nitro::node
