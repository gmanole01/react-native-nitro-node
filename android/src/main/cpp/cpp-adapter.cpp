#include <jni.h>
#include <fbjni/fbjni.h>
#include "NitroNodeOnLoad.hpp"
#include <ares.h>
#include <android/log.h>

#define ALOG(...) __android_log_print(ANDROID_LOG_DEBUG, "NitroNode", __VA_ARGS__)

#ifdef __cplusplus
extern "C" {
#endif

JNIEXPORT void JNICALL Java_com_margelo_nitro_node_HybridDnsInit_caresInit(
  JNIEnv* /* env */,
  jobject /* thisArg */,
  jobject connectivityManager
) {
  // Init c-ares
  int ret = ares_library_init_android(connectivityManager);
  ALOG("Called caresInit, return value: %d\n", ret);
}

#ifdef __cplusplus
}
#endif

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  int ret = ares_library_init(ARES_LIB_INIT_ALL);
  ares_library_init_jvm(vm);

  ALOG("Called JNI_OnLoad, ret: %d\n", ret);

  return facebook::jni::initialize(vm, []() {
    margelo::nitro::node::registerAllNatives();
  });
}