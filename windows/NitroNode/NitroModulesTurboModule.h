#pragma once

#include <ReactCommon/TurboModule.h>

namespace margelo::nitro {

// The "NitroModules" TurboModule, whose install() react-native-nitro-modules'
// JS calls to put global.NitroModulesProxy in the runtime. Its iOS and Android
// packages provide it there; it has none for Windows, so this DLL does, with
// Nitro's C++ core built in (see NitroNode.vcxproj).
class NitroModulesTurboModule final : public facebook::react::TurboModule {
public:
  explicit NitroModulesTurboModule(std::shared_ptr<facebook::react::CallInvoker> jsInvoker);

private:
  static facebook::jsi::Value invokeInstall(facebook::jsi::Runtime& runtime,
                                            facebook::react::TurboModule& turboModule,
                                            const facebook::jsi::Value* args,
                                            size_t count);
};

} // namespace margelo::nitro
