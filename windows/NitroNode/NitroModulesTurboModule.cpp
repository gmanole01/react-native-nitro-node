#include "pch.h"

#include "NitroModulesTurboModule.h"

#include <NitroModules/CallInvokerDispatcher.hpp>
#include <NitroModules/InstallNitro.hpp>
#include <NitroModules/NitroLogger.hpp>

namespace margelo::nitro {

using namespace facebook;

NitroModulesTurboModule::NitroModulesTurboModule(std::shared_ptr<react::CallInvoker> jsInvoker)
    : TurboModule("NitroModules", std::move(jsInvoker)) {
  methodMap_["install"] = MethodMetadata{0, &NitroModulesTurboModule::invokeInstall};
}

// As Nitro's NativeNitroModules on iOS: undefined, or the error's message.
jsi::Value NitroModulesTurboModule::invokeInstall(jsi::Runtime& runtime,
                                                  react::TurboModule& turboModule,
                                                  const jsi::Value* /* args */,
                                                  size_t /* count */) {
  auto& self = static_cast<NitroModulesTurboModule&>(turboModule);
  try {
    auto dispatcher = std::make_shared<CallInvokerDispatcher>(self.jsInvoker_);
    margelo::nitro::install(runtime, dispatcher);
    return jsi::Value::undefined();
  } catch (const std::exception& exc) {
    Logger::log(LogLevel::Error, "NitroModules", "Failed to install Nitro! %s", exc.what());
    return jsi::String::createFromUtf8(runtime, exc.what());
  }
}

} // namespace margelo::nitro
