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
#else
// stderr shows up in the Xcode console and in `log stream` for the app.
#include <cstdio>
#define LOGD(format, ...) fprintf(stderr, "[" NITRO_NODE_LOG_TAG "] " format "\n" __VA_OPT__(,) __VA_ARGS__)
#endif
