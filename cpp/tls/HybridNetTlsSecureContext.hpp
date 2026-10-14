#pragma once

#include "HybridNitroNodeNetTlsSecureContextSpec.hpp"

namespace margelo::nitro::node {

class HybridNetTlsSecureContext : public HybridNitroNodeNetTlsSecureContextSpec {
public:
  HybridNetTlsSecureContext() : HybridObject(TAG), HybridNitroNodeNetTlsSecureContextSpec() {}
  ~HybridNetTlsSecureContext() override = default;

  // TODO: implement
};

} // namespace margelo::nitro::node
