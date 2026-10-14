#pragma once

#include <atomic>
#include <cassert>
#include <functional>
#include <future>
#include <mutex>
#include <queue>
#include <thread>
#include <uv.h>

#include "Common.hpp"

namespace margelo::nitro::node {

// A unit of work executed on the UV loop thread.
using LoopTask = std::function<void(uv_loop_t*)>;

// Owns the single libuv loop and the thread that runs it. Callers marshal work
// onto the loop thread with `post`/`runSync`.
//
// The instance lives for the whole process and is never destroyed: sockets and
// servers detach their handles and let them close on the loop after they are
// gone, so there is no point at which the loop could be safely torn down.
class UVLoop {
public:
  static UVLoop& shared();

  bool isOnLoopThread() const;

  // Queues `task` to run on the loop thread. Never blocks.
  void post(LoopTask task);

  // Runs `task` on the loop thread and returns its result. When called from the
  // loop thread the task runs inline, avoiding a self-deadlock. An exception
  // thrown by `task` is rethrown to the caller.
  template <typename T>
  T runSync(std::function<T(uv_loop_t*)> task) {
    if (isOnLoopThread()) {
      return task(&loop_);
    }
    std::promise<T> promise;
    std::future<T> future = promise.get_future();
    post([&task, &promise](uv_loop_t* loop) {
      try {
        promise.set_value(task(loop));
      } catch (...) {
        promise.set_exception(std::current_exception());
      }
    });
    return future.get();
  }

  // Same as above, for tasks that return nothing.
  void runSync(const LoopTask& task);

private:
  UVLoop();
  UVLoop(const UVLoop&) = delete;
  UVLoop& operator=(const UVLoop&) = delete;
  ~UVLoop() = delete;

  static void onAsync(uv_async_t* handle);
  void drain();

  uv_loop_t loop_{};
  uv_async_t async_{};
  std::atomic<uv_thread_t> threadId_{};
  std::mutex mutex_;
  std::queue<LoopTask> queue_;
  std::thread thread_;
};

} // namespace margelo::nitro::node

// Documents and checks that the enclosing function only ever runs on the UV
// loop thread. Compiled out when NDEBUG is defined, i.e. in release builds.
#define NITRO_NODE_ASSERT_ON_LOOP_THREAD() assert(::margelo::nitro::node::UVLoop::shared().isOnLoopThread())
