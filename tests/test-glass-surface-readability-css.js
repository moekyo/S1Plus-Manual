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
    "浅色 dialog 玻璃背景应更实但仍保留透明度，保证设置面板和内部信息块可读性。",
  ],
  [
    "--s1p-dialog-glass-filter: blur(3px) saturate(1.02);",
    "dialog 玻璃面应保留轻量滤镜变量。",
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
    "--s1p-floating-surface-bg: rgba(255, 255, 255, 0.48);",
    "浅色浮动面背景应保持通透，同时通过磨砂滤镜保持可读。",
  ],
  [
    "--s1p-floating-surface-filter: blur(6px) saturate(1.08);",
    "浅色浮动面应使用统一磨砂滤镜。",
  ],
  [
    "--s1p-toast-glass-bg: var(--s1p-floating-surface-bg);",
    "toast 背景应复用统一浮动面背景。",
  ],
  [
    "--s1p-toast-glass-filter: var(--s1p-floating-surface-filter);",
    "toast 应复用统一浮动面磨砂滤镜。",
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
const darkRootStart = sourceCode.indexOf(":root {", darkMediaIndex);
const darkRootOpenBrace = sourceCode.indexOf("{", darkRootStart);
let darkRootDepth = 0;
let darkRootEnd = -1;

for (let index = darkRootOpenBrace; index < sourceCode.length; index += 1) {
  if (sourceCode[index] === "{") {
    darkRootDepth += 1;
  } else if (sourceCode[index] === "}") {
    darkRootDepth -= 1;
    if (darkRootDepth === 0) {
      darkRootEnd = index + 1;
      break;
    }
  }
}

assert.notEqual(darkRootEnd, -1, "无法解析深色模式根变量块。");
const darkMediaBlock = sourceCode.slice(darkRootStart, darkRootEnd);

[
  [
    "--s1p-overlay-blur: 0.9px;",
    "深色全屏蒙版 blur 也应保持轻量。",
  ],
  [
    "--s1p-dialog-glass-bg: rgba(17, 24, 39, 0.91);",
    "深色 dialog 玻璃背景应更实，避免背景文字透出。",
  ],
  [
    "--s1p-popover-glass-bg: rgba(17, 24, 39, 0.92);",
    "深色悬浮控件背景应更实。",
  ],
  [
    "--s1p-floating-surface-bg: rgba(17, 24, 39, 0.82);",
    "深色浮动面背景应保持可读。",
  ],
  [
    "--s1p-toast-glass-bg: var(--s1p-floating-surface-bg);",
    "深色 toast 背景应复用统一浮动面背景。",
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

[
  [
    "--s1p-first-level-glass-confirm-bg: linear-gradient(",
    "浅色一级确认弹窗应使用独立的 prompt 渐变材质。",
  ],
  [
    "--s1p-first-level-glass-confirm-filter: blur(14px) saturate(1.04);",
    "浅色一级确认弹窗应使用独立的 prompt 磨砂滤镜。",
  ],
  [
    "--s1p-first-level-glass-confirm-overlay: rgba(16, 35, 79, 0.14);",
    "浅色一级确认弹窗应使用独立的 prompt backdrop。",
  ],
  [
    "0 22px 54px rgba(16, 35, 79, 0.22)",
    "浅色一级确认弹窗应使用独立的 prompt 深度阴影。",
  ],
  [
    "inset 0 1px 0 rgba(255, 255, 255, 0.86)",
    "浅色一级确认弹窗应保留 prompt 玻璃高光。",
  ],
].forEach(([needle, message]) => expectIncludes(needle, message));

[
  [
    "--s1p-first-level-glass-confirm-bg: linear-gradient(",
    "深色一级确认弹窗应使用独立校准的 prompt 渐变材质。",
  ],
  [
    "--s1p-first-level-glass-confirm-filter: blur(14px) saturate(1.03);",
    "深色一级确认弹窗应使用独立校准的 prompt 磨砂滤镜。",
  ],
  [
    "--s1p-first-level-glass-confirm-overlay: rgba(2, 6, 23, 0.44);",
    "深色一级确认弹窗应使用独立校准的 prompt backdrop。",
  ],
  [
    "0 24px 60px rgba(0, 0, 0, 0.52)",
    "深色一级确认弹窗应使用独立校准的 prompt 深度阴影。",
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

const assertSurfaceUsesMaterialVariables = (
  selector,
  { backgroundVariable, shadowVariable, filterVariable }
) => {
  const block = getRuleBlock(selector);
  assert.match(
    block,
    new RegExp(`background:\\s*var\\(${backgroundVariable}\\);`),
    `${selector} 应使用 ${backgroundVariable} 作为背景。`
  );
  assert.match(
    block,
    new RegExp(`box-shadow:\\s*var\\(${shadowVariable}\\);`),
    `${selector} 应使用 ${shadowVariable} 作为阴影。`
  );
  assert.match(
    block,
    new RegExp(`-webkit-backdrop-filter:\\s*var\\(${filterVariable}\\);[\\s\\S]*backdrop-filter:\\s*var\\(${filterVariable}\\);`),
    `${selector} 应使用 ${filterVariable}，不能硬编码强 blur。`
  );
  return block;
};

assertSurfaceUsesMaterialVariables(
  ".s1p-first-level-glass",
  {
    backgroundVariable: "--s1p-first-level-glass-bg",
    shadowVariable: "--s1p-first-level-glass-shadow",
    filterVariable: "--s1p-first-level-glass-filter",
  }
);
const confirmPresetBlock = getRuleBlock(".s1p-first-level-glass--confirm");
assert.match(
  confirmPresetBlock,
  /--s1p-first-level-glass-bg:\s*var\(--s1p-first-level-glass-confirm-bg\);[\s\S]*--s1p-first-level-glass-filter:\s*var\(--s1p-first-level-glass-confirm-filter\);[\s\S]*--s1p-first-level-glass-shadow:\s*var\(--s1p-first-level-glass-confirm-shadow\);/,
  "一级确认弹窗预设应把统一玻璃材质变量映射到 confirm 主题变量。"
);
assert.match(
  confirmPresetBlock,
  /border:\s*none;/,
  "一级确认弹窗 prompt material 必须保持无边框。"
);
assert.doesNotMatch(
  sourceCode,
  /--s1p-first-level-glass-confirm-border:/,
  "一级确认弹窗不得引入独立 border token。"
);
for (const needle of [
  "--s1p-first-level-glass-confirm-bg: var(--s1p-floating-surface-bg);",
  "--s1p-first-level-glass-confirm-filter: var(--s1p-floating-surface-filter);",
  "--s1p-first-level-glass-confirm-shadow: var(--s1p-floating-surface-shadow);",
]) {
  assert.equal(
    sourceCode.includes(needle),
    false,
    "一级确认弹窗必须使用独立 prompt material，不能重新 alias generic floating surface。"
  );
}
const confirmOverlayBlock = getRuleBlock(
  ".s1p-fullscreen-modal.s1p-confirm-modal::before"
);
assert.match(
  confirmOverlayBlock,
  /background:\s*var\(--s1p-first-level-glass-confirm-overlay\);/,
  "一级确认弹窗 backdrop 应消费 dedicated prompt overlay token。"
);

const dialogContentBlock = getRuleBlock(".s1p-dialog-content");
assert.doesNotMatch(
  dialogContentBlock,
  /(?:background|box-shadow|backdrop-filter):/,
  "通用弹窗内容壳只负责结构和文本，材质应由一级或二级玻璃类提供。"
);
assert.match(
  sourceCode,
  /const buildS1pDialogContentClassName = \([\s\S]*?surfaceContext\?\.isSettingsSecondaryModal[\s\S]*?buildSettingsSecondaryGlassClassName\([\s\S]*?: buildFirstLevelGlassClassName\(\s*S1P_FIRST_LEVEL_GLASS_CONFIRM_PRESET_CLASS,/,
  "通用内容壳必须按 surface context 统一选择二级或一级玻璃材质。"
);
assertSurfaceUsesMaterialVariables(
  ":is(\n      .s1p-settings-secondary-modal > .s1p-dialog-content.s1p-settings-secondary-glass,\n      .s1p-date-picker.s1p-settings-secondary-glass\n    )",
  {
    backgroundVariable: "--s1p-settings-secondary-glass-bg",
    shadowVariable: "--s1p-settings-secondary-glass-shadow",
    filterVariable: "--s1p-settings-secondary-glass-filter",
  }
);
assert.ok(
  !sourceCode.includes("s1p-token-config-content") &&
    !sourceCode.includes("s1p-reading-progress-content") &&
    !sourceCode.includes("s1p-confirm-content"),
  "一级和二级通用弹窗不应保留旧的专属外壳类。"
);
assertSurfaceUsesFilterVariable(
  ".s1p-glass-panel",
  "--s1p-glass-panel-filter"
);
assert.ok(
  sourceCode.includes("--s1p-glass-panel-filter: var(--s1p-dialog-glass-filter);"),
  "统一 glass panel 滤镜应指向弹窗玻璃滤镜变量。"
);
assert.ok(
  /modal\.innerHTML = `<div class="\$\{buildFirstLevelGlassClassName\(\s*S1P_FIRST_LEVEL_GLASS_SETTINGS_PRESET_CLASS,\s*"s1p-modal-content",\s*"s1p-glass-panel"\s*\)\}">/.test(
    sourceCode
  ),
  "设置面板 shell 应挂载统一 first-level settings 材质类。"
);
assertSurfaceUsesFilterVariable(
  ".s1p-tag-popover",
  "--s1p-floating-surface-filter"
);
assertSurfaceUsesFilterVariable(
  ".s1p-generic-display-popover",
  "--s1p-floating-surface-filter"
);
assertSurfaceUsesFilterVariable(
  ".s1p-date-picker",
  "--s1p-floating-surface-filter"
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
  dialogContentBlock,
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
