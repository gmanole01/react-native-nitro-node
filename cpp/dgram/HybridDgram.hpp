#pragma once

#include "HybridNitroNodeDgramSpec.hpp"
#include "HybridNitroNodeDgramSocketSpec.hpp"

namespace margelo::nitro::node {

class HybridDgram : public HybridNitroNodeDgramSpec {
public:
  HybridDgram() : HybridObject(TAG), HybridNitroNodeDgramSpec() {}

  std::shared_ptr<HybridNitroNodeDgramSocketSpec> createSocket() override;
};

} // namespace margelo::nitro::node
