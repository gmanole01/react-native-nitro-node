#include "pch.h"

#include "ReactPackageProvider.h"
#if __has_include("ReactPackageProvider.g.cpp")
#include "ReactPackageProvider.g.cpp"
#endif

#include <JSI/JsiAbiApi.h>
#include <ReactContext.h>

#include <mutex>

#include "NitroModulesTurboModule.h"
#include "NitroNodeAutolinking.h"
#include "NitroPlatform.h"

using namespace winrt::Microsoft::ReactNative;

namespace winrt::NitroNode::implementation
{

void ReactPackageProvider::CreatePackage(IReactPackageBuilder const &packageBuilder) noexcept
{
  // Once per process: the registry is global, and an app creates a package per
  // React instance
  static std::once_flag registered;
  std::call_once(registered, [] { margelo::nitro::node::registerAllHybridObjects(); });

  // AddTurboModuleProvider<NitroModulesTurboModule>(packageBuilder, L"NitroModules"),
  // which also keeps the UI thread's dispatcher for Nitro's ThreadUtils
  packageBuilder.AddTurboModule(
      L"NitroModules", [](IReactModuleBuilder const &moduleBuilder) noexcept -> winrt::Windows::Foundation::IInspectable {
        IJsiHostObject abiTurboModule{nullptr};
        // Called right away for TurboModules
        moduleBuilder.AddInitializer([&abiTurboModule](IReactContext const &context) mutable {
          ReactContext reactContext{context};
          margelo::nitro::setUIThreadDispatcher(reactContext.UIDispatcher());
          auto turboModule = std::make_shared<margelo::nitro::NitroModulesTurboModule>(reactContext.CallInvoker());
          abiTurboModule = winrt::make<JsiHostObjectGetOrCreateWrapper>(context, std::move(turboModule));
        });
        return abiTurboModule.as<winrt::Windows::Foundation::IInspectable>();
      });
}

} // namespace winrt::NitroNode::implementation
