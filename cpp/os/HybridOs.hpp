#pragma once

#include <cstdlib>
#include <string>

#ifdef _WIN32
#include <uv.h>
#endif

#include "HybridNitroNodeOsSpec.hpp"

namespace margelo::nitro::node {

// iOS and Windows: Android implements NitroNodeOs in Kotlin, see HybridOs.kt.
// iOS points both variables at the app's sandbox when it launches the app.
class HybridOs : public HybridNitroNodeOsSpec {
public:
  HybridOs() : HybridObject(TAG), HybridNitroNodeOsSpec() {}

#ifdef _WIN32
  // As Node on Windows: %TEMP% (or %TMP%, %USERPROFILE%, %WINDIR%\Temp) and
  // %USERPROFILE%, from libuv.
  std::string tmpdir() override {
    return uvPath(uv_os_tmpdir, "C:\\Windows\\Temp");
  }

  std::string homedir() override {
    return uvPath(uv_os_homedir, "C:\\");
  }
#else
  std::string tmpdir() override {
    return env("TMPDIR", "/tmp");
  }

  std::string homedir() override {
    return env("HOME", "/");
  }
#endif

private:
#ifdef _WIN32
  static std::string uvPath(int (*get)(char*, size_t*), const char* fallback) {
    char buffer[4096];
    size_t size = sizeof(buffer);
    return get(buffer, &size) == 0 ? std::string(buffer, size) : fallback;
  }
#else
  static std::string env(const char* name, const char* fallback) {
    const char* value = std::getenv(name);
    return value != nullptr && value[0] != '\0' ? value : fallback;
  }
#endif
};

} // namespace margelo::nitro::node
