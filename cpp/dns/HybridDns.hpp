#pragma once
#include "HybridNitroNodeDnsSpec.hpp"

#include <ares.h>

namespace margelo::nitro::node {

class HybridDns : public HybridNitroNodeDnsSpec {
public:
  HybridDns() : HybridObject(TAG), HybridNitroNodeDnsSpec() {}

  std::shared_ptr<Promise<std::vector<std::string>>> resolve(const std::string& hostname) override;
  std::shared_ptr<Promise<std::vector<std::string>>> resolve4(const std::string& hostname) override;
  std::shared_ptr<Promise<std::vector<std::string>>> resolve6(const std::string& hostname) override;
};

} // namespace margelo::nitro::node
