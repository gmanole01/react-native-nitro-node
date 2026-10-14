#pragma once

#include "HybridNitroNodeNetTlsServerSpec.hpp"

namespace margelo::nitro::node {

class HybridNetTlsServer : public HybridNitroNodeNetTlsServerSpec {
public:
  HybridNetTlsServer() : HybridObject(TAG), HybridNitroNodeNetTlsServerSpec() {}
  ~HybridNetTlsServer() override = default;

  // TODO: implement
};

} // namespace margelo::nitro::node
