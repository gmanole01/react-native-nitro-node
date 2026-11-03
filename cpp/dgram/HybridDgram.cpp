#include "HybridDgram.hpp"
#include "HybridDgramSocket.hpp"

namespace margelo::nitro::node {

std::shared_ptr<HybridNitroNodeDgramSocketSpec> HybridDgram::createSocket() {
  return std::make_shared<HybridDgramSocket>();
}

} // namespace margelo::nitro::node
