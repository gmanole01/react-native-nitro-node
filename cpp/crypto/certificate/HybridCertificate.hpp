#pragma once

#include "HybridNitroNodeCryptoCertificateSpec.hpp"

namespace margelo::nitro::node {

class HybridCertificate : public HybridNitroNodeCryptoCertificateSpec {
 public:
  HybridCertificate() : HybridObject(TAG) {}

  bool verifySpkac(const std::shared_ptr<ArrayBuffer>& spkac) override;
  std::shared_ptr<ArrayBuffer> exportPublicKey(const std::shared_ptr<ArrayBuffer>& spkac) override;
  std::shared_ptr<ArrayBuffer> exportChallenge(const std::shared_ptr<ArrayBuffer>& spkac) override;
};

} // namespace margelo::nitro::node
