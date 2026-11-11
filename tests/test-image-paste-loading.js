#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness, cssSource, toPlainObject } = require("./s1plus-test-helpers");

const LOADING_TEXT = "图片上传中，请稍候…";

// --- CSS：提示的视觉结构与主题变量 ---
assert.ok(
  cssSource.includes(".s1p-image-paste-loading {"),
  "缺少上传中提示的基础样式。"
);
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
  cssSource.includes("border-right-color: transparent"),
  "spinner 应绘制成缺口圆环。"
);
assert.ok(
  /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,800}\.s1p-image-paste-loading-spinner/.test(
    cssSource
  ),
  "减少动态偏好下应停用旋转动画。"
);
assert.ok(
  /\.s1p-image-paste-loading \{[\s\S]*?var\(--s1p-toast-glass-bg\)[\s\S]*?var\(--s1p-t\)/.test(
    cssSource
  ),
  "提示应复用 toast 的玻璃背景与主题文字色变量。"
);
const loadingZIndex = Number(
  (cssSource.match(/\.s1p-image-paste-loading \{[\s\S]*?z-index:\s*(\d+)/) || [])[1]
);
const toastZIndex = Number(
  (cssSource.match(/\.s1p-toast-notification \{[\s\S]*?z-index:\s*(\d+)/) || [])[1]
);
assert.ok(Number.isFinite(loadingZIndex) && Number.isFinite(toastZIndex));
assert.ok(
  loadingZIndex > toastZIndex,
  "上传中提示应位于 toast 之上，避免被结果提示遮挡。"
);

// --- 逻辑：状态收敛与真实 DOM 渲染路径 ---
const { sandbox, hooks } = createHarness({
  hookErrorMessage: "未能从 S1Plus.js 暴露图片上传 Loading 测试 seam。",
});
const api = hooks.s1pImagePasteLoadingTest;
assert.ok(api, "缺少 s1pImagePasteLoadingTest 测试 seam。");

assert.equal(api.getPendingCount(), 0, "初始没有待上传任务。");
assert.equal(api.getElement(), null, "初始不应创建提示元素。");
assert.deepEqual(toPlainObject(api.resolveState(0)), {
  visible: false,
  text: "",
});
assert.deepEqual(toPlainObject(api.resolveState(-3)), {
  visible: false,
  text: "",
});
assert.deepEqual(toPlainObject(api.resolveState("not-a-number")), {
  visible: false,
  text: "",
});
assert.deepEqual(toPlainObject(api.resolveState(1)), {
  visible: true,
  text: LOADING_TEXT,
});
const multiState = api.resolveState(3);
assert.equal(multiState.visible, true);
assert.equal(multiState.text, `${LOADING_TEXT}（3 张）`);
assert.deepEqual(toPlainObject(api.resolveState("2")), {
  visible: true,
  text: `${LOADING_TEXT}（2 张）`,
});

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
      add: (name) => classes.add(String(name)),
      remove: (name) => classes.delete(String(name)),
      contains: (name) => classes.has(String(name)),
      toggle: (name, force) => {
        const normalized = String(name);
        const shouldAdd = force === undefined ? !classes.has(normalized) : force === true;
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
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}

sandbox.document.createElement = (tagName) => new FakeElement(tagName);

api.render(1);
const element = api.getElement();
assert.ok(element, "有任务时应创建 Loading 元素。");
assert.equal(element.id, api.getId());
assert.equal(element.className, "s1p-image-paste-loading");
assert.equal(element.getAttribute("role"), "status");
assert.equal(element.getAttribute("aria-live"), "polite");
assert.equal(element.children.length, 2, "Loading 元素应包含 spinner 与文案两个子节点。");
const [spinner, text] = element.children;
assert.equal(spinner.className, "s1p-image-paste-loading-spinner");
assert.equal(spinner.getAttribute("aria-hidden"), "true");
assert.equal(text.className, "s1p-image-paste-loading-text");
assert.equal(text.textContent, LOADING_TEXT);
assert.equal(element.classList.contains("visible"), true);

api.render(2);
assert.equal(api.getElement(), element, "多图时应复用同一个 Loading 元素。");
assert.equal(element.children.length, 2, "复用元素不应重复追加子节点。");
assert.equal(element.children[1].textContent, `${LOADING_TEXT}（2 张）`);
assert.equal(element.classList.contains("visible"), true);

api.render(0);
assert.equal(element.classList.contains("visible"), false, "队列清空后应隐藏提示。");
assert.equal(element.isConnected, true, "隐藏时保留元素，下次上传直接复用。");

api.refresh();
assert.equal(
  element.classList.contains("visible"),
  false,
  "refresh 在队列空闲时不应显示提示。"
);

// 元素被页面移除后（例如面板重渲染）不应复用失效节点。
element.remove();
api.render(1);
const recreated = api.getElement();
assert.ok(recreated && recreated !== element, "元素被移除后应重新创建。");
assert.equal(recreated.classList.contains("visible"), true);
assert.equal(recreated.children[1].textContent, LOADING_TEXT);

console.log("test-image-paste-loading: ok");
