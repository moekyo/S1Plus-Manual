#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness } = require("./s1plus-test-helpers");

class EventTargetStub {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }
}

const { hooks } = createHarness();
assert.equal(
  typeof hooks.s1pCreateModalBackdropClickGuard,
  "function",
  "未暴露共享弹窗蒙版点击判定 helper。"
);

const modal = new EventTargetStub();
const contentInput = new EventTargetStub();
const shouldCloseOnBackdropClick = hooks.s1pCreateModalBackdropClickGuard(modal);

modal.dispatch("pointerdown", { target: contentInput, pointerId: 1 });
assert.equal(
  shouldCloseOnBackdropClick({ target: modal }),
  false,
  "内容区发起的拖选松开在蒙版上不应关闭弹窗。"
);

modal.dispatch("pointerdown", { target: modal, pointerId: 2 });
assert.equal(
  shouldCloseOnBackdropClick({ target: modal }),
  true,
  "从蒙版开始的普通点击应继续关闭弹窗。"
);

modal.dispatch("pointerdown", { target: contentInput, pointerId: 3 });
assert.equal(
  shouldCloseOnBackdropClick({ target: contentInput }),
  false,
  "内容区普通点击不应被识别为蒙版点击。"
);

assert.equal(
  shouldCloseOnBackdropClick({ target: modal }),
  true,
  "判定完成后不应残留上一次内容区指针状态。"
);

modal.dispatch("pointerdown", { target: contentInput, pointerId: 4 });
modal.dispatch("pointercancel", { target: contentInput, pointerId: 4 });
assert.equal(
  shouldCloseOnBackdropClick({ target: modal }),
  true,
  "取消的指针序列不应污染后续蒙版点击。"
);

console.log("[modal-backdrop-click] drag-safe backdrop dismissal verified.");
