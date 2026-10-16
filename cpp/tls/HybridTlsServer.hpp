#pragma once

#include "HybridNitroNodeTlsServerSpec.hpp"

namespace margelo::nitro::node {

class HybridTlsServer : public HybridNitroNodeTlsServerSpec {
public:
  HybridTlsServer() : HybridObject(TAG), HybridNitroNodeTlsServerSpec() {}
  ~HybridTlsServer() override = default;

  // TODO: implement
};

} // namespace margelo::nitro::node
