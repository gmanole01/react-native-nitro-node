#pragma once

#include "HybridNitroNodeTlsSpec.hpp"
#include "HybridNitroNodeTlsSocketSpec.hpp"
#include "HybridNitroNodeTlsServerSpec.hpp"
#include "HybridNitroNodeTlsSecureContextSpec.hpp"

namespace margelo::nitro::node {

class HybridTls : public HybridNitroNodeTlsSpec {
public:
  HybridTls() : HybridObject(TAG), HybridNitroNodeTlsSpec() {}

  std::shared_ptr<HybridNitroNodeTlsSocketSpec> createTlsSocket() override;
  std::shared_ptr<HybridNitroNodeTlsServerSpec> createTlsServer() override;
  std::shared_ptr<HybridNitroNodeTlsSecureContextSpec> createTlsSecureContext() override;
};

} // namespace margelo::nitro::node
