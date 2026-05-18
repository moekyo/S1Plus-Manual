#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { sourceCode } = require("./s1plus-test-helpers");

const getRuleBlock = (selector) => {
  const marker = `\n    ${selector} {`;
  const start = sourceCode.indexOf(marker);
  assert.notEqual(start, -1, `缺少 CSS 规则：${selector}`);
  const end = sourceCode.indexOf("\n    }", start);
  assert.notEqual(end, -1, `无法解析 CSS 规则：${selector}`);
  return sourceCode.slice(start, end);
};

[
  "--s1p-toast-glass-bg",
  "--s1p-floating-control-glass-bg",
  "--s1p-image-viewer-panel-bg",
  "--s1p-image-viewer-toolbar-bg",
  "--s1p-image-viewer-viewport-bg",
].forEach((variableName) => {
  assert.ok(sourceCode.includes(variableName), `缺少变量 ${variableName}。`);
});

const assertHasGlassFilter = (block, selector) => {
  assert.match(
    block,
    /-webkit-backdrop-filter:\s*blur\(8px\) saturate\(1\.08\);[\s\S]*backdrop-filter:\s*blur\(8px\) saturate\(1\.08\);/,
    `${selector} 应使用 8px 磨砂滤镜。`
  );
};

const assertHasLightGlassFilter = (block, selector) => {
  assert.match(
    block,
    /-webkit-backdrop-filter:\s*blur\(6px\) saturate\(1\.04\);[\s\S]*backdrop-filter:\s*blur\(6px\) saturate\(1\.04\);/,
    `${selector} 应使用 6px 轻磨砂滤镜。`
  );
};

const assertBorderlessOuterSurface = (block, selector) => {
  const visibleBorderDeclarations = Array.from(
    block.matchAll(/\bborder(?:-color)?:\s*([^;]+)/g),
    (match) => match[1].trim()
  ).filter((value) => !/^(none|0|transparent)\b/.test(value));
  assert.deepEqual(
    visibleBorderDeclarations,
    [],
    `${selector} 的最外层容器不应显示描边。`
  );
};

const toastBlock = getRuleBlock(".s1p-toast-notification");
assert.match(
  toastBlock,
  /background:\s*var\(--s1p-toast-glass-bg\)/,
  "Toast 应使用轻磨砂背景。"
);
assertBorderlessOuterSurface(toastBlock, ".s1p-toast-notification");
assertHasGlassFilter(toastBlock, ".s1p-toast-notification");
assert.match(
  getRuleBlock(".s1p-toast-notification.success"),
  /background:\s*var\(--s1p-toast-success-bg\)/,
  "成功 Toast 应使用状态色玻璃背景。"
);
assert.match(
  getRuleBlock(".s1p-toast-notification.error"),
  /background:\s*var\(--s1p-toast-error-bg\)/,
  "错误 Toast 应使用状态色玻璃背景。"
);

const imageViewerPanelBlock = getRuleBlock(".s1p-image-viewer__panel");
const overlayBlock = getRuleBlock(
  ".s1p-modal,\n    .s1p-confirm-modal,\n    .s1p-token-config-modal,\n    .s1p-image-viewer"
);
assert.ok(
  !sourceCode.includes("--s1p-overlay-backdrop"),
  "全屏蒙版不应再保留全局黑色遮罩变量。"
);
assert.match(
  overlayBlock,
  /background-color:\s*transparent/,
  "全屏蒙版应统一保持无色磨砂，不应使用深色遮罩。"
);
assert.match(
  overlayBlock,
  /backdrop-filter:\s*blur\(var\(--s1p-overlay-blur\)\)/,
  "全屏蒙版仍应保留统一 blur。"
);
assert.match(
  imageViewerPanelBlock,
  /background:\s*var\(--s1p-image-viewer-panel-bg\)/,
  "图片查看器面板应使用磨砂玻璃背景。"
);
assert.match(
  imageViewerPanelBlock,
  /border:\s*none/,
  "图片查看器面板主容器不应显示边框。"
);
assertBorderlessOuterSurface(
  imageViewerPanelBlock,
  ".s1p-image-viewer__panel"
);
assertHasGlassFilter(imageViewerPanelBlock, ".s1p-image-viewer__panel");
assert.match(
  getRuleBlock(".s1p-image-viewer__toolbar"),
  /background:\s*var\(--s1p-image-viewer-toolbar-bg\)/,
  "图片查看器工具栏应透明继承玻璃外壳。"
);
assert.match(
  sourceCode,
  /--s1p-image-viewer-viewport-bg:\s*rgba\(212,\s*221,\s*206,\s*0\.72\);/,
  "浅色图片舞台应沿用原浅黄绿色底色并改为半透明玻璃。"
);
assert.match(
  sourceCode,
  /--s1p-image-viewer-viewport-bg:\s*rgba\(34,\s*42,\s*50,\s*0\.76\);/,
  "深色图片舞台应沿用原深色底色并改为半透明玻璃。"
);
const imageViewerViewportBlock = getRuleBlock(".s1p-image-viewer__viewport");
assert.match(
  imageViewerViewportBlock,
  /background:\s*var\(--s1p-image-viewer-viewport-bg\)/,
  "图片查看器图片舞台应使用专用主题玻璃背景。"
);
assertHasLightGlassFilter(imageViewerViewportBlock, ".s1p-image-viewer__viewport");
assert.ok(
  !sourceCode.includes("--s1p-image-viewer-loading-border"),
  "图片切换加载浮层已统一无描边，不应保留 loading border 变量。"
);
assertBorderlessOuterSurface(
  getRuleBlock(".s1p-image-viewer__switch-loading"),
  ".s1p-image-viewer__switch-loading"
);

const floatingHandleBlock = getRuleBlock("#s1p-controls-handle");
assert.match(
  floatingHandleBlock,
  /background:\s*var\(--s1p-floating-control-glass-bg\)/,
  "浮动控制把手应使用轻磨砂背景。"
);
assertBorderlessOuterSurface(floatingHandleBlock, "#s1p-controls-handle");
assertHasGlassFilter(floatingHandleBlock, "#s1p-controls-handle");

const floatingButtonSelector =
  "#s1p-floating-controls a,\n    #s1p-floating-controls button";
const floatingButtonBlock = getRuleBlock(floatingButtonSelector);
assert.match(
  floatingButtonBlock,
  /background:\s*var\(--s1p-floating-control-glass-bg\)/,
  "浮动控制按钮应使用轻磨砂背景。"
);
assertBorderlessOuterSurface(floatingButtonBlock, floatingButtonSelector);
assertHasGlassFilter(floatingButtonBlock, floatingButtonSelector);

assertBorderlessOuterSurface(
  getRuleBlock(".s1p-debug-panel"),
  ".s1p-debug-panel"
);
assertBorderlessOuterSurface(
  getRuleBlock("#s1p-debug-unified-panel.s1p-debug-panel"),
  "#s1p-debug-unified-panel.s1p-debug-panel"
);
assert.match(
  getRuleBlock("#s1p-debug-unified-panel.s1p-debug-panel"),
  /backdrop-filter:\s*blur\(5px\) saturate\(1\.08\)/,
  "调试面板已经是磨砂玻璃风格，不应回退为实底。"
);

console.log(
  "[category-c-and-image-viewer-glass-css] Category C and image viewer glass CSS verified."
);
