#include "pch.h"

#include "NitroPlatform.h"

#include <NitroModules/Dispatcher.hpp>
#include <NitroModules/NitroLogger.hpp>
#include <NitroModules/ThreadUtils.hpp>

#include <future>
#include <mutex>
#include <stdexcept>
#include <string>

// Nitro's platform code for Windows: the ThreadUtils and Logger functions that
// its ios/platform and android/src/main/cpp/platform implement there.

namespace margelo::nitro {

using winrt::Microsoft::ReactNative::ReactDispatcher;

namespace {

std::mutex uiDispatcherMutex;
ReactDispatcher uiDispatcher;

ReactDispatcher currentUIDispatcher() {
  std::lock_guard<std::mutex> lock(uiDispatcherMutex);
  return uiDispatcher;
}

// Runs functions on the UI thread, as Nitro's UIThreadDispatcher on iOS.
class UIThreadDispatcher final : public Dispatcher {
public:
  explicit UIThreadDispatcher(ReactDispatcher dispatcher) : dispatcher_(std::move(dispatcher)) {}

  void runAsync(std::function<void()>&& function) override {
    dispatcher_.Post([function = std::move(function)]() noexcept { function(); });
  }

  void runSync(std::function<void()>&& function) override {
    if (dispatcher_.HasThreadAccess()) {
      function();
      return;
    }
    std::promise<void> done;
    dispatcher_.Post([&function, &done]() noexcept {
      try {
        function();
        done.set_value();
      } catch (...) {
        done.set_exception(std::current_exception());
      }
    });
    done.get_future().get();
  }

private:
  ReactDispatcher dispatcher_;
};

} // namespace

void setUIThreadDispatcher(ReactDispatcher dispatcher) {
  std::lock_guard<std::mutex> lock(uiDispatcherMutex);
  uiDispatcher = std::move(dispatcher);
}

std::string ThreadUtils::getThreadName() {
  PWSTR description = nullptr;
  if (SUCCEEDED(GetThreadDescription(GetCurrentThread(), &description))) {
    std::string name = winrt::to_string(description);
    LocalFree(description);
    if (!name.empty()) {
      return name;
    }
  }
  return "Thread #" + std::to_string(GetCurrentThreadId());
}

void ThreadUtils::setThreadName(const std::string& name) {
  SetThreadDescription(GetCurrentThread(), winrt::to_hstring(name).c_str());
}

bool ThreadUtils::isUIThread() {
  return currentUIDispatcher().HasThreadAccess();
}

std::shared_ptr<Dispatcher> ThreadUtils::createUIThreadDispatcher() {
  ReactDispatcher dispatcher = currentUIDispatcher();
  if (!dispatcher) {
    throw std::runtime_error("The UI thread's dispatcher is not available yet");
  }
  return std::make_shared<UIThreadDispatcher>(std::move(dispatcher));
}

void Logger::nativeLog([[maybe_unused]] LogLevel level,
                       [[maybe_unused]] const char* NON_NULL tag,
                       [[maybe_unused]] const std::string& message) {
#ifdef NITRO_DEBUG
  // Visual Studio's Output window, or DebugView
  std::string line = std::string("[Nitro] [") + tag + "] " + message + "\n";
  OutputDebugStringA(line.c_str());
#endif
}

} // namespace margelo::nitro
