#pragma once

#include <functional>
#include <unordered_map>
#include <uv.h>

#include "HybridNitroNodeTimersSpec.hpp"
#include "CallbackSlot.hpp"
#include "UVLoop.hpp"

namespace margelo::nitro::node {

// One-shot uv_timer_t handles keyed by the id JS gave them. A timer's handle
// is closed as soon as it fires or is stopped, so only armed timers hold one.
//
// Immediates use one uv_check_t, which runs right after the loop's poll (I/O)
// phase, as in Node; JS keeps the queue itself.
class HybridTimers : public HybridNitroNodeTimersSpec {
public:
  HybridTimers() : HybridObject(TAG), HybridNitroNodeTimersSpec(), loop_(UVLoop::shared()) {}

  ~HybridTimers() override;

  // Properties
  std::function<void(double)> getOnTimeout() override { return onTimeout_.get(); }
  void setOnTimeout(const std::function<void(double)>& cb) override { onTimeout_.set(cb); }

  std::function<void()> getOnImmediate() override { return onImmediate_.get(); }
  void setOnImmediate(const std::function<void()>& cb) override { onImmediate_.set(cb); }

  // Methods
  void start(double id, double delay) override;
  void stop(double id) override;
  void scheduleImmediate() override;

private:
  struct Timer {
    uv_timer_t handle;
    double id;
    HybridTimers* owner;
  };

  // The check handle that runs immediates, and an idle handle active
  // alongside it: while one is active, the loop polls for I/O without
  // blocking, so the check phase comes right away.
  struct Immediates {
    uv_check_t check;
    uv_idle_t idle;
    HybridTimers* owner;
    int openHandles;
  };

  static void onTimer(uv_timer_t* handle);
  static void onTimerClosed(uv_handle_t* handle);
  static void onCheck(uv_check_t* handle);
  static void onImmediatesClosed(uv_handle_t* handle);

  UVLoop& loop_;

  // The armed timers. Only touched on the loop thread.
  std::unordered_map<double, Timer*> timers_;

  // Created by the first scheduleImmediate(). Only touched on the loop thread.
  Immediates* immediates_ = nullptr;

  // Assigned from the JS thread, invoked from the UV loop thread.
  CallbackSlot<void(double)> onTimeout_;
  CallbackSlot<void()> onImmediate_;
};

} // namespace margelo::nitro::node
