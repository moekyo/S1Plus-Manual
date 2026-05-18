#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { sourceCode } = require("./s1plus-test-helpers");

const expectIncludes = (needle, message) => {
  assert.ok(sourceCode.includes(needle), message);
};

[
  [
    "--s1p-overlay-blur: 0.8px;",
    "浅色全屏蒙版 blur 应足够轻，不能把论坛背景糊成低对比噪声。",
  ],
  [
    "--s1p-dialog-glass-bg: rgba(255, 255, 255, 0.84);",
    "浅色确认弹窗背景应更实但仍保留玻璃透明度，保证正文可读性。",
  ],
  [
    "--s1p-dialog-glass-filter: blur(3px) saturate(1.02);",
    "确认弹窗应使用轻量玻璃滤镜变量。",
  ],
  [
    "--s1p-popover-glass-bg: rgba(255, 255, 255, 0.86);",
    "浅色悬浮控件背景应稍微更实，避免透出帖子内容。",
  ],
  [
    "--s1p-popover-glass-filter: blur(3px) saturate(1.02);",
    "悬浮控件应使用轻量玻璃滤镜变量。",
  ],
  [
    "--s1p-toast-glass-bg: rgba(255, 255, 255, 0.84);",
    "浅色 toast 背景应更通透，同时通过磨砂滤镜保持短提示可读。",
  ],
  [
    "--s1p-toast-glass-filter: blur(4px) saturate(1.03);",
    "toast 应使用略强一点的玻璃滤镜来补偿更通透的背景。",
  ],
  [
    "--s1p-floating-control-glass-bg: rgba(255, 255, 255, 0.89);",
    "浅色浮动控件背景应更实，避免图标可见性下降。",
  ],
  [
    "--s1p-floating-control-glass-filter: blur(3px) saturate(1.02);",
    "浮动控件应使用轻量玻璃滤镜变量。",
  ],
  [
    "--s1p-dialog-text: #10234f;",
    "确认弹窗应有独立文本 token，避免继承论坛主题导致低对比。",
  ],
  [
    "--s1p-dialog-muted-text: #334a72;",
    "确认弹窗说明文字应有独立弱文本 token。",
  ],
].forEach(([needle, message]) => expectIncludes(needle, message));

const darkMediaIndex = sourceCode.indexOf(
  "@media (prefers-color-scheme: dark) {\n      :root {"
);
assert.notEqual(darkMediaIndex, -1, "缺少深色模式覆写。");
const darkMediaBlock = sourceCode.slice(darkMediaIndex, darkMediaIndex + 2600);

[
  [
    "--s1p-overlay-blur: 0.9px;",
    "深色全屏蒙版 blur 也应保持轻量。",
  ],
  [
    "--s1p-dialog-glass-bg: rgba(17, 24, 39, 0.91);",
    "深色确认弹窗背景应更实，避免背景文字透出。",
  ],
  [
    "--s1p-popover-glass-bg: rgba(17, 24, 39, 0.92);",
    "深色悬浮控件背景应更实。",
  ],
  [
    "--s1p-toast-glass-bg: rgba(17, 24, 39, 0.88);",
    "深色 toast 背景应更通透，同时保持可读性。",
  ],
  [
    "--s1p-floating-control-glass-bg: rgba(17, 24, 39, 0.91);",
    "深色浮动控件背景应更实。",
  ],
  [
    "--s1p-dialog-text: #f1f5f9;",
    "深色确认弹窗正文应使用亮色文本。",
  ],
  [
    "--s1p-dialog-muted-text: #cbd5e1;",
    "深色确认弹窗说明文字应使用亮色弱文本。",
  ],
].forEach(([needle, message]) => {
  assert.ok(darkMediaBlock.includes(needle), message);
});

const getRuleBlock = (selector) => {
  const marker = `\n    ${selector} {`;
  const start = sourceCode.indexOf(marker);
  assert.notEqual(start, -1, `缺少 CSS 规则：${selector}`);
  const end = sourceCode.indexOf("\n    }", start);
  assert.notEqual(end, -1, `无法解析 CSS 规则：${selector}`);
  return sourceCode.slice(start, end);
};

const assertSurfaceUsesFilterVariable = (selector, filterVariable) => {
  const block = getRuleBlock(selector);
  assert.match(
    block,
    new RegExp(`-webkit-backdrop-filter:\\s*var\\(${filterVariable}\\);[\\s\\S]*backdrop-filter:\\s*var\\(${filterVariable}\\);`),
    `${selector} 应使用 ${filterVariable}，不能硬编码强 blur。`
  );
};

assertSurfaceUsesFilterVariable(
  ".s1p-confirm-content",
  "--s1p-dialog-glass-filter"
);
assertSurfaceUsesFilterVariable(
  ".s1p-token-config-content",
  "--s1p-dialog-glass-filter"
);
assertSurfaceUsesFilterVariable(
  ".s1p-modal > .s1p-modal-content",
  "--s1p-dialog-glass-filter"
);
assert.match(
  getRuleBlock(".s1p-modal > .s1p-modal-content"),
  /--s1p-settings-panel-bg:\s*rgba\(255, 255, 255, 0\.82\)/,
  "设置面板 shell 背景应略微加实，但仍保留磨砂玻璃层。"
);
assert.ok(
  sourceCode.includes(
    "--s1p-settings-panel-bg: rgba(17, 24, 39, 0.88);"
  ),
  "深色设置面板 shell 背景应同步加实。"
);
assertSurfaceUsesFilterVariable(
  ".s1p-tag-popover",
  "--s1p-popover-glass-filter"
);
assertSurfaceUsesFilterVariable(
  ".s1p-generic-display-popover",
  "--s1p-popover-glass-filter"
);
assertSurfaceUsesFilterVariable(
  ".s1p-date-picker",
  "--s1p-popover-glass-filter"
);
assertSurfaceUsesFilterVariable(
  ".s1p-toast-notification",
  "--s1p-toast-glass-filter"
);

const strongGlassFilterPattern =
  /(?:-webkit-)?backdrop-filter:\s*blur\((?:6|8)px\) saturate\(1\.0[458]\)/;
const sourceWithoutImageViewerRestoredRules = sourceCode
  .replace(
    /\n    \.s1p-image-viewer__toolbar \{[\s\S]*?\n    \}/,
    "\n    .s1p-image-viewer__toolbar { /* restored image viewer style omitted */\n    }"
  )
  .replace(
    /--s1p-image-viewer-viewport-glass-filter:\s*blur\(6px\) saturate\(1\.04\);/g,
    "--s1p-image-viewer-viewport-glass-filter: __restored_image_viewer_filter__;"
  );
assert.doesNotMatch(
  sourceWithoutImageViewerRestoredRules,
  strongGlassFilterPattern,
  "弹窗、悬浮层和自定义控件不应继续硬编码 6px/8px 的强磨砂滤镜；图片查看器还原样式除外。"
);

assert.match(
  getRuleBlock(".s1p-confirm-content"),
  /color:\s*var\(--s1p-dialog-text\)/,
  "确认弹窗正文应使用独立文本 token。"
);
assert.match(
  getRuleBlock(".s1p-confirm-body .s1p-confirm-subtitle"),
  /color:\s*var\(--s1p-dialog-muted-text\)/,
  "确认弹窗说明文字应使用独立弱文本 token。"
);

const syncChoiceInfoBlock = getRuleBlock(".s1p-sync-choice-info");
assert.match(
  syncChoiceInfoBlock,
  /background-color:\s*color-mix\(in srgb, var\(--s1p-dialog-glass-bg\)/,
  "手动同步选择说明块应建立自身背景，避免直接透出帖子列表。"
);
assert.match(
  syncChoiceInfoBlock,
  /color:\s*var\(--s1p-dialog-muted-text\)/,
  "手动同步选择说明块正文应使用弹窗弱文本 token。"
);
assert.match(
  getRuleBlock(".s1p-sync-choice-info-label"),
  /color:\s*var\(--s1p-dialog-text\)/,
  "手动同步选择说明块标签应使用弹窗正文 token。"
);
assert.match(
  getRuleBlock(".s1p-sync-last-action"),
  /color:\s*var\(--s1p-dialog-muted-text\)[\s\S]*background-color:\s*color-mix\(in srgb, var\(--s1p-dialog-glass-bg\)/,
  "手动同步上次操作提示应使用弹窗弱文本和自身背景。"
);
assert.match(
  getRuleBlock(".s1p-sync-comparison-table"),
  /background:\s*color-mix\(in srgb, var\(--s1p-dialog-glass-bg\)[\s\S]*color:\s*var\(--s1p-dialog-text\)/,
  "手动同步对比表格应使用弹窗背景和正文 token。"
);
assert.match(
  getRuleBlock(".s1p-sync-comparison-header"),
  /color:\s*var\(--s1p-dialog-text\)/,
  "手动同步对比表头应使用弹窗正文 token。"
);

console.log("[glass-surface-readability-css] Glass surface readability CSS verified.");
