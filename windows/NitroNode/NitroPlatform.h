#pragma once

#include <ReactDispatcher.h>

namespace margelo::nitro {

// The UI thread's dispatcher, for Nitro's ThreadUtils (NitroPlatform.cpp). Set
// when the NitroModules TurboModule is created.
void setUIThreadDispatcher(winrt::Microsoft::ReactNative::ReactDispatcher dispatcher);

} // namespace margelo::nitro
