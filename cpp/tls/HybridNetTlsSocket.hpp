#pragma once

#include "HybridNitroNodeNetTlsSocketSpec.hpp"

namespace margelo::nitro::node {

class HybridNetTlsSocket : public HybridNitroNodeNetTlsSocketSpec {
public:
  HybridNetTlsSocket() : HybridObject(TAG), HybridNitroNodeNetTlsSocketSpec() {}
  ~HybridNetTlsSocket() override = default;

  // TODO: implement
};

} // namespace margelo::nitro::node
