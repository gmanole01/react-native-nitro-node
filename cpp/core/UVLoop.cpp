#include "UVLoop.hpp"

#include <future>
#include <stdexcept>

namespace margelo::nitro::node {

UVLoop& UVLoop::shared() {
  // Intentionally leaked. A static instance would be destroyed at exit while
  // its thread is still running, and destroying a joinable std::thread calls
  // std::terminate.
  static UVLoop* instance = new UVLoop();
  return *instance;
}

UVLoop::UVLoop() {
  // A private loop rather than uv_default_loop(), which is process-global and
  // could be shared with other libuv users in the app.
  if (uv_loop_init(&loop_) != 0) {
    throw std::runtime_error("Failed to initialize the libuv loop");
  }

  if (uv_async_init(&loop_, &async_, &UVLoop::onAsync) != 0) {
    throw std::runtime_error("Failed to initialize the libuv async handle");
  }
  async_.data = this;

  thread_ = std::thread([this]() {
    threadId_.store(uv_thread_self());
    uv_run(&loop_, UV_RUN_DEFAULT);
  });
}

bool UVLoop::isOnLoopThread() const {
  uv_thread_t self = uv_thread_self();
  uv_thread_t id = threadId_.load();
  return uv_thread_equal(&self, &id) != 0;
}

void UVLoop::post(LoopTask task) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    queue_.push(std::move(task));
  }
  uv_async_send(&async_);
}

void UVLoop::runSync(const LoopTask& task) {
  if (isOnLoopThread()) {
    task(&loop_);
    return;
  }

  std::promise<void> promise;
  std::future<void> future = promise.get_future();
  post([&task, &promise](uv_loop_t* loop) {
    try {
      task(loop);
      promise.set_value();
    } catch (...) {
      promise.set_exception(std::current_exception());
    }
  });
  future.get();
}

void UVLoop::onAsync(uv_async_t* handle) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();
  static_cast<UVLoop*>(handle->data)->drain();
}

void UVLoop::drain() {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  std::queue<LoopTask> pending;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    std::swap(pending, queue_);
  }

  while (!pending.empty()) {
    LoopTask task = std::move(pending.front());
    pending.pop();
    // A throwing task must not take down the loop thread - and with it every
    // socket in the app.
    try {
      task(&loop_);
    } catch (...) {
      LOGD("task threw on the UV loop thread");
    }
  }
}

} // namespace margelo::nitro::node
