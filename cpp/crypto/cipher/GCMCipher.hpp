#pragma once

#include "HybridCipher.hpp"

namespace margelo::nitro::node {

class GCMCipher : public HybridCipher {
 public:
  GCMCipher() : HybridObject(TAG) {}

  void init(const std::shared_ptr<ArrayBuffer> cipher_key, const std::shared_ptr<ArrayBuffer> iv) override;
};

} // namespace margelo::nitro::node
