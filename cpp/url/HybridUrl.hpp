#pragma once

#include <optional>
#include <string>

#include "HybridNitroNodeUrlSpec.hpp"

namespace margelo::nitro::node {

// Node's URL binding (src/node_url.cc) on ada, the WHATWG URL parser Node
// uses. Stateless: where Node's binding fills a shared Uint32Array with the
// components, these return them with the href.
class HybridUrl : public HybridNitroNodeUrlSpec {
public:
  HybridUrl() : HybridObject(TAG), HybridNitroNodeUrlSpec() {}

  std::optional<UrlParsed> parse(const std::string& input, const std::optional<std::string>& base) override;
  bool canParse(const std::string& input, const std::optional<std::string>& base) override;
  std::optional<UrlParsed> update(const std::string& href, double action, const std::string& value) override;
  std::string format(const std::string& href, bool hash, bool unicode, bool search, bool auth) override;
  std::optional<std::string> getOrigin(const std::string& input) override;
  std::string domainToASCII(const std::string& input) override;
  std::string domainToUnicode(const std::string& input) override;
  std::optional<UrlParsed> pathToFileURL(const std::string& path, bool windows,
                                         const std::optional<std::string>& hostname) override;
  std::string toASCII(const std::string& input) override;
  std::string toUnicode(const std::string& input) override;
};

} // namespace margelo::nitro::node
