#pragma once
#include "HybridNitroNodeDnsSpec.hpp"

#include <ares.h>
#include <netdb.h>

namespace margelo::nitro::node {

class HybridDns : public HybridNitroNodeDnsSpec {
public:
  HybridDns() : HybridObject(TAG), HybridNitroNodeDnsSpec() {}

  // The system's, as Node's dns.ADDRCONFIG / ALL / V4MAPPED (not c-ares's ARES_AI_*)
  double getAI_ADDRCONFIG() override { return AI_ADDRCONFIG; }
  double getAI_ALL() override { return AI_ALL; }
  double getAI_V4MAPPED() override { return AI_V4MAPPED; }

  std::shared_ptr<Promise<std::vector<std::string>>> resolve(const std::string& hostname) override;
  std::shared_ptr<Promise<std::vector<std::string>>> resolve4(const std::string& hostname) override;
  std::shared_ptr<Promise<std::vector<std::string>>> resolve6(const std::string& hostname) override;
};

} // namespace margelo::nitro::node
