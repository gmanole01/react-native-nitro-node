#include "HybridNet.hpp"

#include "io/HybridNetServer.hpp"
#include "io/HybridNetSocket.hpp"
#include "tls/HybridNetTlsSecureContext.hpp"
#include "tls/HybridNetTlsServer.hpp"
#include "tls/HybridNetTlsSocket.hpp"

namespace margelo::nitro::node {

std::shared_ptr<HybridNitroNodeNetSocketSpec> HybridNet::createSocket() {
  return std::make_shared<HybridNetSocket>();
}

std::shared_ptr<HybridNitroNodeNetServerSpec> HybridNet::createServer() {
  return std::make_shared<HybridNetServer>();
}

std::shared_ptr<HybridNitroNodeNetTlsSocketSpec> HybridNet::createTlsSocket() {
  return std::make_shared<HybridNetTlsSocket>();
}

std::shared_ptr<HybridNitroNodeNetTlsServerSpec> HybridNet::createTlsServer() {
  return std::make_shared<HybridNetTlsServer>();
}

std::shared_ptr<HybridNitroNodeNetTlsSecureContextSpec> HybridNet::createTlsSecureContext() {
  return std::make_shared<HybridNetTlsSecureContext>();
}

} // namespace margelo::nitro::node
