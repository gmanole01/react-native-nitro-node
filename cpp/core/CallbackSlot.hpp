#pragma once

#include <functional>
#include <mutex>
#include <utility>

namespace margelo::nitro::node {

// Holds a JS callback that is assigned from the JS thread and invoked from the
// UV loop thread. Every access is serialized by a mutex.
//
// Invoking under the lock is fine: Nitro's void callbacks only schedule the
// call on the JS thread, they never run JS inline. A replaced callback is
// always released by the caller, outside the lock, so the JS function is never
// destroyed on the loop thread.
template <typename Signature>
class CallbackSlot;

template <typename... Args>
class CallbackSlot<void(Args...)> {
public:
  using Fn = std::function<void(Args...)>;

  Fn get() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return fn_;
  }

  void set(Fn fn) {
    std::lock_guard<std::mutex> lock(mutex_);
    fn_.swap(fn);
    // The previous callback now lives in `fn` and is destroyed after the lock
    // is released, on the calling thread.
  }

  explicit operator bool() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return static_cast<bool>(fn_);
  }

  // Invokes the callback if one is set; a no-op otherwise.
  template <typename... CallArgs>
  void call(CallArgs&&... args) const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (fn_) {
      fn_(std::forward<CallArgs>(args)...);
    }
  }

private:
  mutable std::mutex mutex_;
  Fn fn_;
};

} // namespace margelo::nitro::node
