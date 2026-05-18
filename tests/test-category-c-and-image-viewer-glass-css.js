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
  "--s1p-image-viewer-toolbar-bg",
  "--s1p-image-viewer-viewport-bg",
  "--s1p-image-viewer-viewport-glass-bg",
  "--s1p-image-viewer-viewport-glass-filter",
].forEach((variableName) => {
  assert.ok(sourceCode.includes(variableName), `缺少变量 ${variableName}。`);
});
assert.ok(
  !sourceCode.includes("--s1p-image-viewer-panel-bg"),
  "图片查看器面板不应再保留独立背景变量，避免与舞台透明度叠加。"
);

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
  /background:\s*transparent/,
  "图片查看器面板应保持透明，只负责裁切和阴影。"
);
assert.doesNotMatch(
  imageViewerPanelBlock,
  /backdrop-filter:/,
  "图片查看器面板不应再提供 backdrop-filter，避免影响舞台独立调参。"
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
const imageViewerToolbarBlock = getRuleBlock(".s1p-image-viewer__toolbar");
assert.match(
  imageViewerToolbarBlock,
  /background:\s*var\(--s1p-image-viewer-toolbar-bg\)/,
  "图片查看器工具栏应使用自身背景，不再继承面板底色。"
);
assertHasGlassFilter(imageViewerToolbarBlock, ".s1p-image-viewer__toolbar");
assert.match(
  sourceCode,
  /--s1p-image-viewer-toolbar-bg:\s*rgba\(255,\s*255,\s*255,\s*0\.85\);/,
  "浅色图片查看器工具栏应使用独立等效玻璃背景。"
);
assert.match(
  sourceCode,
  /--s1p-image-viewer-toolbar-bg:\s*rgba\(18,\s*27,\s*45,\s*0\.97\);/,
  "深色图片查看器工具栏应使用独立等效玻璃背景。"
);
assert.match(
  sourceCode,
  /--s1p-image-viewer-viewport-bg:\s*rgba\(226,\s*232,\s*222,\s*0\.7\);/,
  "浅色图片舞台应使用独立等效玻璃背景。"
);
assert.match(
  sourceCode,
  /--s1p-image-viewer-viewport-bg:\s*rgba\(33,\s*42,\s*52,\s*0\.9\);/,
  "深色图片舞台应使用独立等效玻璃背景。"
);
assert.match(
  sourceCode,
  /--s1p-image-viewer-viewport-glass-bg:\s*rgba\(255,\s*255,\s*255,\s*0\.04\);/,
  "浅色图片舞台应通过独立磨砂层保留玻璃感。"
);
assert.match(
  sourceCode,
  /--s1p-image-viewer-viewport-glass-bg:\s*rgba\(148,\s*163,\s*184,\s*0\.035\);/,
  "深色图片舞台应通过独立磨砂层保留玻璃感。"
);
assert.equal(
  Array.from(
    sourceCode.matchAll(
      /--s1p-image-viewer-viewport-glass-filter:\s*blur\(6px\) saturate\(1\.04\);/g
    )
  ).length,
  2,
  "浅色和深色图片舞台应使用一致的轻磨砂滤镜。"
);
assert.ok(
  !sourceCode.includes("--s1p-image-viewer-viewport-backdrop-filter"),
  "图片舞台不应再使用旧的直接 backdrop-filter 变量。"
);
assert.doesNotMatch(
  sourceCode,
  /--s1p-image-viewer-viewport-glass-filter:\s*none;/,
  "深色图片舞台不应禁用磨砂滤镜，应和浅色保持同一处理。"
);
const imageViewerViewportBlock = getRuleBlock(".s1p-image-viewer__viewport");
assert.match(
  imageViewerViewportBlock,
  /background:\s*var\(--s1p-image-viewer-viewport-bg\)/,
  "图片查看器图片舞台应使用专用主题玻璃背景。"
);
assert.match(
  imageViewerViewportBlock,
  /isolation:\s*isolate/,
  "图片舞台应建立独立层叠上下文，固定底色层和磨砂层的关系。"
);
assert.doesNotMatch(
  imageViewerViewportBlock,
  /backdrop-filter:/,
  "图片舞台本体不应直接采样页面背景，磨砂应交给独立伪元素层。"
);
const imageViewerViewportGlassBlock = getRuleBlock(
  ".s1p-image-viewer__viewport::before"
);
assert.match(
  imageViewerViewportGlassBlock,
  /background:\s*var\(--s1p-image-viewer-viewport-glass-bg\)/,
  "图片舞台磨砂层应使用独立背景变量。"
);
assert.match(
  imageViewerViewportGlassBlock,
  /backdrop-filter:\s*var\(--s1p-image-viewer-viewport-glass-filter\)/,
  "图片舞台磨砂层应使用独立滤镜变量。"
);
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
