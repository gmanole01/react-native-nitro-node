#pragma once
#include "HybridNitroNodeNetSpec.hpp"
#include "HybridNitroNodeNetSocketSpec.hpp"
#include "HybridNitroNodeNetServerSpec.hpp"
#include "HybridNitroNodeNetTlsSocketSpec.hpp"
#include "HybridNitroNodeNetTlsServerSpec.hpp"
#include "HybridNitroNodeNetTlsSecureContextSpec.hpp"

namespace margelo::nitro::node {

class HybridNet : public HybridNitroNodeNetSpec {
public:
  HybridNet() : HybridObject(TAG), HybridNitroNodeNetSpec() {}

  std::shared_ptr<HybridNitroNodeNetSocketSpec> createSocket() override;
  std::shared_ptr<HybridNitroNodeNetServerSpec> createServer() override;
  std::shared_ptr<HybridNitroNodeNetTlsSocketSpec> createTlsSocket() override;
  std::shared_ptr<HybridNitroNodeNetTlsServerSpec> createTlsServer() override;
  std::shared_ptr<HybridNitroNodeNetTlsSecureContextSpec> createTlsSecureContext() override;
};

} // namespace margelo::nitro::node
