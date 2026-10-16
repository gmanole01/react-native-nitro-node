#include "HybridTls.hpp"

#include "HybridTlsSecureContext.hpp"
#include "HybridTlsServer.hpp"
#include "HybridTlsSocket.hpp"

namespace margelo::nitro::node {

std::shared_ptr<HybridNitroNodeTlsSocketSpec> HybridTls::createTlsSocket() {
  return std::make_shared<HybridTlsSocket>();
}

std::shared_ptr<HybridNitroNodeTlsServerSpec> HybridTls::createTlsServer() {
  return std::make_shared<HybridTlsServer>();
}

std::shared_ptr<HybridNitroNodeTlsSecureContextSpec> HybridTls::createTlsSecureContext() {
  return std::make_shared<HybridTlsSecureContext>();
}

} // namespace margelo::nitro::node
