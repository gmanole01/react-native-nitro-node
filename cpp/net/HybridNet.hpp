#pragma once

#include "HybridNitroNodeNetSpec.hpp"
#include "HybridNitroNodeNetSocketSpec.hpp"
#include "HybridNitroNodeNetServerSpec.hpp"

namespace margelo::nitro::node {

class HybridNet : public HybridNitroNodeNetSpec {
public:
  HybridNet() : HybridObject(TAG), HybridNitroNodeNetSpec() {}

  std::shared_ptr<HybridNitroNodeNetSocketSpec> createSocket() override;
  std::shared_ptr<HybridNitroNodeNetServerSpec> createServer() override;
};

} // namespace margelo::nitro::node
