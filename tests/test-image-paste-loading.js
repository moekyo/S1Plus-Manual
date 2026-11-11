#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness, cssSource, toPlainObject } = require("./s1plus-test-helpers");

const LOADING_TEXT = "图片上传中，请稍候…";

// --- CSS：提示的视觉结构、主题变量与堆叠策略 ---
const loadingBlockMatch = cssSource.match(/\.s1p-image-paste-loading \{([\s\S]*?)\}/);
assert.ok(loadingBlockMatch, "缺少上传中提示的基础样式。");
const loadingBlock = loadingBlockMatch[1];
assert.ok(
  loadingBlock.includes("color: var(--s1p-toast-text)"),
  "提示文字应使用 toast 文字主题变量。"
);
assert.ok(
  !loadingBlock.includes("z-index"),
  "提示不单独抬升 z-index：与 toast 同层时让后出现的提示（如错误信息）保持可见。"
);
assert.ok(loadingBlock.includes("position: fixed"), "提示应固定悬浮。");
assert.ok(loadingBlock.includes("pointer-events: none"), "提示不应拦截点击。");
assert.ok(
  cssSource.includes(".s1p-image-paste-loading.visible"),
  "缺少上传中提示的显示状态样式。"
);
assert.ok(
  cssSource.includes("@keyframes s1p-image-paste-loading-spin"),
  "缺少上传中提示的旋转动画。"
);
assert.ok(
  cssSource.includes("animation: s1p-image-paste-loading-spin 0.8s linear infinite"),
  "旋转动画应挂在 spinner 上。"
);
assert.ok(
  /\.s1p-image-paste-loading:not\(\.visible\)[\s\S]{0,200}animation:\s*none/.test(
    cssSource
  ),
  "隐藏时 spinner 应停止动画。"
);
assert.ok(
  /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,800}\.s1p-image-paste-loading-spinner/.test(
    cssSource
  ),
  "减少动态偏好下应停用旋转动画。"
);
// 深浅色主题都提供可读的 toast 文字色（深色玻璃底上不能沿用深蓝 --s1p-t）。
assert.match(cssSource, /--s1p-toast-text:\s*var\(--s1p-t\)/);
assert.match(
  cssSource,
  /html\.s1p-theme-dark \{[\s\S]{0,12000}--s1p-toast-text:\s*#e5e7eb/
);
const toastBlockMatch = cssSource.match(/\.s1p-toast-notification \{([\s\S]*?)\}/);
assert.ok(toastBlockMatch, "缺少 toast 基础样式。");
assert.ok(
  toastBlockMatch[1].includes("color: var(--s1p-toast-text)"),
  "toast 应使用主题文字变量。"
);

// --- 逻辑：状态收敛、真实队列联动、提交拦截、快捷键守卫 ---
const { sandbox, hooks } = createHarness({
  hookErrorMessage: "未能从 S1Plus.js 暴露图片上传 Loading 测试 seam。",
});
const api = hooks.s1pImagePasteLoadingTest;
const advancedApi = hooks.s1pAdvancedEditorImagePasteTest;
assert.ok(api, "缺少 s1pImagePasteLoadingTest 测试 seam。");
assert.ok(
  advancedApi && typeof advancedApi.handleSubmitEvent === "function",
  "缺少高级编辑器提交处理器测试 seam。"
);

assert.equal(api.getText(), LOADING_TEXT, "提示文案应集中在常量里。");
assert.equal(api.getPendingCount(), 0, "初始没有待上传任务。");
assert.equal(api.getElement(), null, "初始不应创建提示元素。");
assert.deepEqual(toPlainObject(api.resolveState(0)), { visible: false, text: "" });
assert.deepEqual(toPlainObject(api.resolveState(-3)), { visible: false, text: "" });
assert.deepEqual(toPlainObject(api.resolveState("not-a-number")), {
  visible: false,
  text: "",
});
assert.deepEqual(toPlainObject(api.resolveState(1)), {
  visible: true,
  text: LOADING_TEXT,
});
assert.deepEqual(toPlainObject(api.resolveState("2")), {
  visible: true,
  text: `${LOADING_TEXT}（2 张）`,
});

assert.equal(
  api.isSubmitShortcut({ ctrlKey: true, keyCode: 13 }),
  true,
  "Ctrl+Enter（keyCode）应命中提交快捷键。"
);
assert.equal(
  api.isSubmitShortcut({ ctrlKey: true, key: "Enter", keyCode: 0 }),
  true,
  "Ctrl+Enter（key）应命中提交快捷键。"
);
assert.equal(
  api.isSubmitShortcut({ altKey: true, code: "KeyS" }),
  true,
  "Alt+S（code）应命中提交快捷键，兼容 macOS 的 ß。"
);
assert.equal(api.isSubmitShortcut({ altKey: true, key: "s" }), true);
assert.equal(api.isSubmitShortcut({ ctrlKey: false, keyCode: 13 }), false);
assert.equal(api.isSubmitShortcut({ altKey: true, keyCode: 65 }), false);
assert.equal(api.isSubmitShortcut(null), false);

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.id = "";
    this.className = "";
    this.textContent = "";
    this.children = [];
    this.attributes = new Map();
    this.parentElement = null;
    this.isConnected = true;
    this.style = {};
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(String(name))),
      remove: (...names) => names.forEach((name) => classes.delete(String(name))),
      contains: (name) => classes.has(String(name)),
      toggle: (name, force) => {
        const normalized = String(name);
        const shouldAdd =
          force === undefined ? !classes.has(normalized) : force === true;
        if (shouldAdd) classes.add(normalized);
        else classes.delete(normalized);
        return shouldAdd;
      },
      toArray: () => Array.from(classes),
    };
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    child.parentElement = null;
    return child;
  }
  remove() {
    this.isConnected = false;
  }
  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }
  getAttribute(name) {
    return this.attributes.get(String(name)) || "";
  }
  removeAttribute(name) {
    this.attributes.delete(String(name));
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  addEventListener() { }
  removeEventListener() { }
  contains() {
    return false;
  }
}

const fakeForm = new FakeElement("form");
fakeForm.id = "postform";
sandbox.document.createElement = (tagName) => new FakeElement(tagName);
sandbox.document.getElementById = (id) => (id === "postform" ? fakeForm : null);

const flushTick = () => new Promise((resolve) => setTimeout(resolve, 0));

(async () => {
  // 手动渲染：显示 / 多图计数 / 隐藏时清理 live region
  api.render(0);
  assert.equal(api.getElement(), null, "没有任务时不应创建提示元素。");

  api.render(1);
  const element = api.getElement();
  assert.ok(element, "有任务时应创建提示元素。");
  assert.equal(element.id, api.getId());
  assert.equal(element.className, "s1p-image-paste-loading");
  assert.equal(element.getAttribute("role"), "status");
  assert.equal(element.getAttribute("aria-live"), "polite");
  assert.equal(element.children.length, 2, "提示应包含 spinner 与文案两个子节点。");
  const [spinner, textSpan] = element.children;
  assert.equal(spinner.className, "s1p-image-paste-loading-spinner");
  assert.equal(spinner.getAttribute("aria-hidden"), "true");
  assert.equal(textSpan.className, "s1p-image-paste-loading-text");
  assert.equal(textSpan.textContent, LOADING_TEXT);
  assert.equal(element.classList.contains("visible"), true);
  assert.equal(element.getAttribute("aria-hidden"), "");

  api.render(2);
  assert.equal(api.getElement(), element, "多个任务时应复用同一个提示元素。");
  assert.equal(element.children.length, 2, "复用元素不应重复追加子节点。");
  assert.equal(element.children[1].textContent, `${LOADING_TEXT}（2 张）`);

  api.render(0);
  assert.equal(element.classList.contains("visible"), false, "队列清空后应隐藏提示。");
  assert.equal(
    element.getAttribute("aria-hidden"),
    "true",
    "隐藏后应退出无障碍树。"
  );
  assert.equal(element.children[1].textContent, "", "隐藏后应清空 live region 文本。");
  assert.equal(element.isConnected, true, "隐藏时保留元素，下次上传直接复用。");

  api.render(1);
  assert.equal(element.getAttribute("aria-hidden"), "", "再次显示时应回到无障碍树。");
  assert.equal(element.children[1].textContent, LOADING_TEXT);
  api.render(0);

  // 元素被移除后不应复用失效节点。
  element.remove();
  api.render(1);
  const recreated = api.getElement();
  assert.ok(recreated && recreated !== element, "元素被移除后应重新创建。");
  api.render(0);

  // 真实队列联动：enqueue → 显示；目标失效 → 不再计入 pending 并隐藏。
  const advancedQueue = api.getAdvancedQueue();
  assert.ok(advancedQueue, "缺少高级编辑器上传队列测试 seam。");
  assert.equal(advancedQueue.pending(), 0);

  advancedQueue.enqueue({ file: { size: 10, type: "image/png" }, extension: "png" });
  assert.equal(advancedQueue.pending(), 1, "有存活任务时应计入 pending。");
  assert.equal(api.getPendingCount(), 1, "提示计数应汇总真实队列。");
  assert.equal(api.hasInFlight(), true);
  assert.equal(
    api.getElement().classList.contains("visible"),
    true,
    "enqueue 后应立刻显示提示。"
  );

  // 上传中提交应被拦截（原生 submit / 点击保存路径）。
  const blockedEvent = {
    type: "submit",
    target: fakeForm,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
  };
  advancedApi.handleSubmitEvent(blockedEvent);
  assert.equal(blockedEvent.prevented, true, "上传中提交应被 preventDefault。");
  assert.equal(blockedEvent.stopped, true, "上传中提交应停止后续处理。");

  // 上传中：临时包装的论坛编辑器快捷键提交应被拦下。
  let originalCtlentCalls = 0;
  const originalCtlent = function () {
    originalCtlentCalls += 1;
  };
  sandbox.window.ctlent = originalCtlent;
  api.refresh();
  assert.equal(
    api.isSubmitShortcutGuardInstalled(),
    true,
    "上传中应安装编辑器快捷键守卫。"
  );
  assert.notEqual(sandbox.window.ctlent, originalCtlent, "页面 ctlent 应被临时替换。");
  const shortcutEvent = {
    ctrlKey: true,
    keyCode: 13,
    key: "Enter",
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  sandbox.window.ctlent(shortcutEvent);
  assert.equal(shortcutEvent.prevented, true, "快捷键提交应被 preventDefault。");
  assert.equal(originalCtlentCalls, 0, "上传中快捷键不应透传给论坛 ctlent。");
  sandbox.window.ctlent({ ctrlKey: false, keyCode: 65, key: "a" });
  assert.equal(originalCtlentCalls, 1, "非提交快捷键应继续交给论坛处理。");

  // 目标被关闭后：旧任务不再计入 pending，提示与拦截都应立即解除。
  fakeForm.isConnected = false;
  assert.equal(advancedQueue.pending(), 0, "目标已关闭的任务不应计入 pending。");
  api.refresh();
  assert.equal(
    api.getElement().classList.contains("visible"),
    false,
    "目标关闭后应隐藏提示。"
  );
  assert.equal(api.isSubmitShortcutGuardInstalled(), false, "目标关闭后应恢复 ctlent。");
  assert.equal(sandbox.window.ctlent, originalCtlent);
  fakeForm.isConnected = true;

  await flushTick();
  assert.equal(api.hasInFlight(), false, "任务收尾后不应再有在途上传。");

  // 任务正常收尾后提示应自动消失（不依赖手动 refresh）。
  fakeForm.isConnected = true;
  advancedQueue.enqueue({ file: { size: 10, type: "image/png" }, extension: "png" });
  assert.equal(
    api.getElement().classList.contains("visible"),
    true,
    "新任务入队后应显示提示。"
  );
  await flushTick();
  assert.equal(
    api.getElement().classList.contains("visible"),
    false,
    "任务收尾后应自动隐藏提示。"
  );
  assert.equal(api.hasInFlight(), false);

  // 空闲时提交不应被拦截。
  const idleEvent = {
    type: "submit",
    target: fakeForm,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
  };
  advancedApi.handleSubmitEvent(idleEvent);
  assert.equal(idleEvent.prevented, false, "空闲时不应拦截提交。");

  console.log("test-image-paste-loading: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
