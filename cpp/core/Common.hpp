#pragma once

// Deliberately not named `TAG`: that would shadow the `TAG` constant every
// Nitro spec class passes to HybridObject.
#define NITRO_NODE_LOG_TAG "NitroNode"

#include <cstring>
#include <uv.h>

// printf-style logging. The format must be a string literal.
#if defined(__ANDROID__)
#include <android/log.h>
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, NITRO_NODE_LOG_TAG, __VA_ARGS__)
#elif defined(_WIN32)
// A Windows app has no console: the debugger's output (Visual Studio's Output
// window, DebugView).
#include <cstdarg>
#include <cstdio>
#include <windows.h>
namespace margelo::nitro::node {
inline void debugLog(const char* format, ...) {
  char line[1024];
  va_list args;
  va_start(args, format);
  vsnprintf(line, sizeof(line), format, args);
  va_end(args);
  OutputDebugStringA(line);
}
} // namespace margelo::nitro::node
#define LOGD(format, ...) \
  ::margelo::nitro::node::debugLog("[" NITRO_NODE_LOG_TAG "] " format "\n" __VA_OPT__(,) __VA_ARGS__)
#else
// stderr shows up in the Xcode console and in `log stream` for the app.
#include <cstdio>
#define LOGD(format, ...) fprintf(stderr, "[" NITRO_NODE_LOG_TAG "] " format "\n" __VA_OPT__(,) __VA_ARGS__)
#endif
