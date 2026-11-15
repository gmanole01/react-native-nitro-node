#include "pch.h"

#include "NitroModulesTurboModule.h"

#include <NitroModules/CallInvokerDispatcher.hpp>
#include <NitroModules/InstallNitro.hpp>
#include <NitroModules/NitroLogger.hpp>

namespace margelo::nitro {

using namespace facebook;

namespace {

// As React Native's handleJSError() (RuntimeScheduler, iOS and Android): an
// uncaught JS error goes to ErrorUtils, the red box in development.
void reportFatalError(jsi::Runtime& runtime, const jsi::Value& error) {
  try {
    jsi::Value errorUtils = runtime.global().getProperty(runtime, "ErrorUtils");
    if (errorUtils.isObject() && errorUtils.getObject(runtime).hasProperty(runtime, "reportFatalError")) {
      errorUtils.getObject(runtime).getPropertyAsFunction(runtime, "reportFatalError").call(runtime, error);
      return;
    }
    Logger::log(LogLevel::Error, "NitroModules", "Uncaught JS error, and ErrorUtils isn't set up");
  } catch (const std::exception& exc) {
    Logger::log(LogLevel::Error, "NitroModules", "Failed to report a JS error: %s", exc.what());
  }
}

// react-native-windows' CallInvoker (AbiCallInvoker) doesn't catch what its
// functions throw, as RuntimeScheduler does on iOS and Android: an error thrown
// by a JS callback Nitro calls (a timer's, a socket's, ...) crosses its ABI and
// aborts the app. This one catches it and reports it, as they do.
class ReportingCallInvoker final : public react::CallInvoker {
public:
  explicit ReportingCallInvoker(std::shared_ptr<react::CallInvoker> inner) : inner_(std::move(inner)) {}

  void invokeAsync(react::CallFunc&& func) noexcept override {
    inner_->invokeAsync(wrap(std::move(func)));
  }
  void invokeAsync(react::SchedulerPriority priority, react::CallFunc&& func) noexcept override {
    inner_->invokeAsync(priority, wrap(std::move(func)));
  }
  // The caller gets what invokeSync throws, as with React Native's own
  void invokeSync(react::CallFunc&& func) override {
    inner_->invokeSync(std::move(func));
  }

private:
  static react::CallFunc wrap(react::CallFunc&& func) {
    return [func = std::move(func)](jsi::Runtime& runtime) {
      try {
        func(runtime);
      } catch (const jsi::JSError& error) {
        reportFatalError(runtime, error.value());
      } catch (const std::exception& exc) {
        reportFatalError(runtime, jsi::JSError(runtime, exc.what()).value());
      }
    };
  }

  std::shared_ptr<react::CallInvoker> inner_;
};

} // namespace

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
    auto dispatcher = std::make_shared<CallInvokerDispatcher>(std::make_shared<ReportingCallInvoker>(self.jsInvoker_));
    margelo::nitro::install(runtime, dispatcher);
    return jsi::Value::undefined();
  } catch (const std::exception& exc) {
    Logger::log(LogLevel::Error, "NitroModules", "Failed to install Nitro! %s", exc.what());
    return jsi::String::createFromUtf8(runtime, exc.what());
  }
}

} // namespace margelo::nitro
