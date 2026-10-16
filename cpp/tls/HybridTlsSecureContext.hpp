#pragma once

#include "HybridNitroNodeTlsSecureContextSpec.hpp"

namespace margelo::nitro::node {

class HybridTlsSecureContext : public HybridNitroNodeTlsSecureContextSpec {
public:
  HybridTlsSecureContext() : HybridObject(TAG), HybridNitroNodeTlsSecureContextSpec() {}
  ~HybridTlsSecureContext() override = default;

  // TODO: implement
};

} // namespace margelo::nitro::node
