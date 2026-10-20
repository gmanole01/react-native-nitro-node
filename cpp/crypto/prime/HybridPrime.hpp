#pragma once

#include "HybridNitroNodeCryptoPrimeSpec.hpp"

namespace margelo::nitro::node {

class HybridPrime : public HybridNitroNodeCryptoPrimeSpec {
 public:
  HybridPrime() : HybridObject(TAG) {}

  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> generatePrime(double size, bool safe,
                                                                       const std::optional<std::shared_ptr<ArrayBuffer>>& add,
                                                                       const std::optional<std::shared_ptr<ArrayBuffer>>& rem) override;
  std::shared_ptr<ArrayBuffer> generatePrimeSync(double size, bool safe, const std::optional<std::shared_ptr<ArrayBuffer>>& add,
                                                 const std::optional<std::shared_ptr<ArrayBuffer>>& rem) override;
  std::shared_ptr<Promise<bool>> checkPrime(const std::shared_ptr<ArrayBuffer>& candidate, double checks) override;
  bool checkPrimeSync(const std::shared_ptr<ArrayBuffer>& candidate, double checks) override;
};

} // namespace margelo::nitro::node
