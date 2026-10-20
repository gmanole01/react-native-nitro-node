#pragma once

#include "HybridNitroNodeCryptoRsaCipherSpec.hpp"
#include <memory>

namespace margelo::nitro::node {

class HybridRsaCipher : public HybridNitroNodeCryptoRsaCipherSpec {
 public:
  HybridRsaCipher() : HybridObject(TAG) {}

  std::shared_ptr<ArrayBuffer> encrypt(const std::shared_ptr<HybridNitroNodeCryptoKeyObjectHandleSpec>& keyHandle,
                                       const std::shared_ptr<ArrayBuffer>& data, double padding, const std::string& hashAlgorithm,
                                       const std::optional<std::shared_ptr<ArrayBuffer>>& label) override;

  std::shared_ptr<ArrayBuffer> decrypt(const std::shared_ptr<HybridNitroNodeCryptoKeyObjectHandleSpec>& keyHandle,
                                       const std::shared_ptr<ArrayBuffer>& data, double padding, const std::string& hashAlgorithm,
                                       const std::optional<std::shared_ptr<ArrayBuffer>>& label) override;

  std::shared_ptr<ArrayBuffer> publicDecrypt(const std::shared_ptr<HybridNitroNodeCryptoKeyObjectHandleSpec>& keyHandle,
                                             const std::shared_ptr<ArrayBuffer>& data, double padding) override;

  std::shared_ptr<ArrayBuffer> privateEncrypt(const std::shared_ptr<HybridNitroNodeCryptoKeyObjectHandleSpec>& keyHandle,
                                              const std::shared_ptr<ArrayBuffer>& data, double padding) override;

  std::shared_ptr<ArrayBuffer> privateDecrypt(const std::shared_ptr<HybridNitroNodeCryptoKeyObjectHandleSpec>& keyHandle,
                                              const std::shared_ptr<ArrayBuffer>& data, double padding, const std::string& hashAlgorithm,
                                              const std::optional<std::shared_ptr<ArrayBuffer>>& label) override;

  void loadHybridMethods() override;
};

} // namespace margelo::nitro::node
