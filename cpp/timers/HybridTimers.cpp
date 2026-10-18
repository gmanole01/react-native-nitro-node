#include "HybridTimers.hpp"

#include <cstdint>

#include "Common.hpp"

namespace margelo::nitro::node {

namespace {

// Past this a double no longer holds every integer; libuv clamps the deadline
// itself when loop time + timeout overflows.
constexpr double kMaxTimeout = 9007199254740991.0; // 2^53 - 1

// The delay in whole milliseconds. NaN and negative delays fire right away;
// what Node does with those (1 ms) is up to JS.
uint64_t toTimeout(double delay) {
  if (!(delay > 0)) {
    return 0;
  }
  if (delay > kMaxTimeout) {
    return static_cast<uint64_t>(kMaxTimeout);
  }
  return static_cast<uint64_t>(delay);
}

} // namespace

HybridTimers::~HybridTimers() {
  // Tasks posted by start()/stop() capture `this` and may still be queued. The
  // queue is FIFO, so they have all run by the time this one does, and nothing
  // can post new ones while the object is being destroyed.
  loop_.runSync([this](uv_loop_t*) {
    // Closing a timer stops it, so none of them can call onTimer, and with it
    // reach `this`, anymore. onTimerClosed frees them later.
    for (auto& [id, timer] : timers_) {
      uv_close((uv_handle_t*) &timer->handle, onTimerClosed);
    }
    timers_.clear();

    // The same for immediates: closing stops both handles.
    if (immediates_ != nullptr) {
      uv_close((uv_handle_t*) &immediates_->check, onImmediatesClosed);
      uv_close((uv_handle_t*) &immediates_->idle, onImmediatesClosed);
      immediates_ = nullptr;
    }
  });
}

void HybridTimers::start(double id, double delay) {
  const uint64_t timeout = toTimeout(delay);

  loop_.post([this, id, timeout](uv_loop_t* loop) {
    Timer*& timer = timers_[id];
    if (timer == nullptr) {
      timer = new Timer{};
      timer->id = id;
      timer->owner = this;
      uv_timer_init(loop, &timer->handle); // can't fail
      timer->handle.data = timer;
    }

    // libuv counts from the time cached at the start of this loop iteration,
    // which is behind by however long the tasks before this one took.
    uv_update_time(loop);

    // Restarts the timer when it is already armed.
    uv_timer_start(&timer->handle, onTimer, timeout, 0);
  });
}

void HybridTimers::stop(double id) {
  loop_.post([this, id](uv_loop_t*) {
    auto it = timers_.find(id);
    if (it == timers_.end()) {
      // Already fired, already stopped, or never started.
      return;
    }
    Timer* timer = it->second;
    timers_.erase(it);
    uv_close((uv_handle_t*) &timer->handle, onTimerClosed);
  });
}

void HybridTimers::scheduleImmediate() {
  loop_.post([this](uv_loop_t* loop) {
    if (immediates_ == nullptr) {
      immediates_ = new Immediates{};
      immediates_->owner = this;
      immediates_->openHandles = 2;
      uv_check_init(loop, &immediates_->check); // can't fail
      uv_idle_init(loop, &immediates_->idle);   // can't fail
      immediates_->check.data = immediates_;
      immediates_->idle.data = immediates_;
    }

    // Already scheduled: this call shares that onImmediate. Starting active
    // handles again would be a no-op anyway.
    if (uv_is_active((uv_handle_t*) &immediates_->check)) {
      return;
    }
    uv_check_start(&immediates_->check, onCheck);
    // The idle callback has nothing to do; the handle only has to be active.
    uv_idle_start(&immediates_->idle, [](uv_idle_t*) {});
  });
}

void HybridTimers::onTimer(uv_timer_t* handle) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  // Only armed timers are open, and the destructor closes them all, so the
  // owner is alive here.
  auto* timer = static_cast<Timer*>(handle->data);
  HybridTimers* owner = timer->owner;
  const double id = timer->id;

  // One-shot: done with the handle. Dropping it from the map first makes a
  // later stop(id) a no-op and lets start(id) arm a fresh one.
  owner->timers_.erase(id);
  uv_close((uv_handle_t*) handle, onTimerClosed);

  owner->onTimeout_.call(id);
}

void HybridTimers::onTimerClosed(uv_handle_t* handle) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();
  delete static_cast<Timer*>(handle->data);
}

void HybridTimers::onCheck(uv_check_t* handle) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();

  // Only the destructor closes these handles, so the owner is alive.
  auto* immediates = static_cast<Immediates*>(handle->data);

  // Once per scheduleImmediate(): JS asks again for the next batch.
  uv_check_stop(&immediates->check);
  uv_idle_stop(&immediates->idle);

  immediates->owner->onImmediate_.call();
}

void HybridTimers::onImmediatesClosed(uv_handle_t* handle) {
  NITRO_NODE_ASSERT_ON_LOOP_THREAD();
  auto* immediates = static_cast<Immediates*>(handle->data);
  if (--immediates->openHandles == 0) {
    delete immediates;
  }
}

} // namespace margelo::nitro::node
