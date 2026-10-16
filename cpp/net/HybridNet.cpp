#include "HybridNet.hpp"
#include "HybridNetServer.hpp"
#include "HybridNetSocket.hpp"

namespace margelo::nitro::node {

std::shared_ptr<HybridNitroNodeNetSocketSpec> HybridNet::createSocket() {
  return std::make_shared<HybridNetSocket>();
}

std::shared_ptr<HybridNitroNodeNetServerSpec> HybridNet::createServer() {
  return std::make_shared<HybridNetServer>();
}

} // namespace margelo::nitro::node
