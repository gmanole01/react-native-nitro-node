#pragma once

#include <NitroModules/ArrayBuffer.hpp>
#include <NitroModules/Promise.hpp>
#include <memory>
#include <optional>
#include <string>

#include "HybridNitroNodeCryptoTurboShakeSpec.hpp"

namespace margelo::nitro::node {

using namespace facebook;

class HybridTurboShake : public HybridNitroNodeCryptoTurboShakeSpec {
 public:
  HybridTurboShake() : HybridObject(TAG) {}

 public:
  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>> turboShake(TurboShakeVariant variant, double domainSeparation, double outputLength,
                                                                    const std::shared_ptr<ArrayBuffer>& data) override;

  std::shared_ptr<Promise<std::shared_ptr<ArrayBuffer>>>
  kangarooTwelve(KangarooTwelveVariant variant, double outputLength, const std::shared_ptr<ArrayBuffer>& data,
                 const std::optional<std::shared_ptr<ArrayBuffer>>& customization) override;
};

} // namespace margelo::nitro::node
