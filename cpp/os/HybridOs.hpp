#pragma once

#include <cstdlib>
#include <string>

#include "HybridNitroNodeOsSpec.hpp"

namespace margelo::nitro::node {

// iOS only: Android implements NitroNodeOs in Kotlin, see HybridOs.kt. iOS
// points both variables at the app's sandbox when it launches the app.
class HybridOs : public HybridNitroNodeOsSpec {
public:
  HybridOs() : HybridObject(TAG), HybridNitroNodeOsSpec() {}

  std::string tmpdir() override {
    return env("TMPDIR", "/tmp");
  }

  std::string homedir() override {
    return env("HOME", "/");
  }

private:
  static std::string env(const char* name, const char* fallback) {
    const char* value = std::getenv(name);
    return value != nullptr && value[0] != '\0' ? value : fallback;
  }
};

} // namespace margelo::nitro::node
