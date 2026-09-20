#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { sourceCode } = require("./s1plus-test-helpers");

const staticDataPath = path.resolve(__dirname, "../S1Plus-static-data.json");
const staticData = JSON.parse(fs.readFileSync(staticDataPath, "utf8"));
const uiShowcaseData = staticData.uiShowcase;
const uiRuntimeStart = sourceCode.indexOf(
  "const createDebugUIComponentsTabContent = () => {"
);
const uiRuntimeEnd = sourceCode.indexOf(
  "const createDebugConsoleLogTabContent = () => {",
  uiRuntimeStart
);
const designDocPath = path.resolve(
  __dirname,
  "../docs/design/ui-showcase-panel.md"
);
const designDoc = fs.existsSync(designDocPath)
  ? fs.readFileSync(designDocPath, "utf8")
  : "";

assert.ok(Array.isArray(uiShowcaseData.categories), "缺少 UI 组件展示面板分类定义。");
assert.ok(uiShowcaseData.sections && typeof uiShowcaseData.sections === "object");

const uiShowcaseCode = [
  sourceCode.slice(uiRuntimeStart, uiRuntimeEnd),
  uiShowcaseData.css,
  ...Object.values(uiShowcaseData.sections),
  uiShowcaseData.syncPreviewHtml,
  uiShowcaseData.readingProgressHtml,
  ...Object.values(uiShowcaseData.actionBodies),
].join("\n");
const getUiShowcaseRule = (selector) => {
  const marker = `${selector} {`;
  const start = uiShowcaseCode.indexOf(marker);
  assert.notEqual(start, -1, `缺少 UI showcase 样式规则：${selector}`);
  const end = uiShowcaseCode.indexOf("\n      }", start);
  assert.notEqual(end, -1, `无法解析 UI showcase 样式规则：${selector}`);
  return uiShowcaseCode.slice(start, end);
};

assert.match(
  uiShowcaseCode,
  /createAdvancedConfirmationModal\(\s*"高级确认弹窗",[\s\S]*?\[\s*\{/,
  "高级确认弹窗预览必须按真实签名传入 title、bodyHtml、buttons，而不是单个配置对象。"
);
assert.doesNotMatch(
  uiShowcaseCode,
  /createAdvancedConfirmationModal\(\s*\{/,
  "高级确认弹窗预览不能把配置对象传给 createAdvancedConfirmationModal。"
);
assert.match(
  uiShowcaseCode,
  /createDatePicker\(\s*dateInput,\s*new Date\(\),\s*\(selectedDate\) =>/,
  "日期选择器预览必须传入 input、初始 Date 和 onSelect 回调。"
);
assert.doesNotMatch(
  uiShowcaseCode,
  /createDatePicker\(\s*fakeInput,\s*\(\) => \{\}\s*\)/,
  "日期选择器预览不能把回调误传到 initialDate 参数。"
);
assert.match(
  uiShowcaseCode,
  /openS1pImageViewer\(\s*"https:\/\/picsum\.photos\/800\/600/,
  "图片查看器预览必须传入字符串 URL。"
);
assert.doesNotMatch(
  uiShowcaseCode,
  /openS1pImageViewer\(\s*\[/,
  "图片查看器预览不能把数组传给 openS1pImageViewer。"
);
assert.doesNotMatch(
  uiShowcaseCode,
  /showFirstTimeWelcomeIfNeeded\(\)/,
  "欢迎弹窗预览不能依赖首次运行版本标记，应使用可控的普通确认弹窗占位。"
);
assert.doesNotMatch(
  uiShowcaseCode,
  /showMessage\([^;]*,\s*"(?:success|error)"/,
  "UI showcase 不能用字符串状态调用 showMessage，真实签名使用 true/false/null。"
);

assert.match(
  uiShowcaseData.sections.buttons,
  /class="s1p-btn s1p-primary"/,
  "按钮展示必须包含真实的 s1p-primary 变体。"
);
assert.ok(
  uiShowcaseData.categories.some(
    ({ key, label }) => key === "ranges" && label === "范围滑块"
  ),
  "UI 组件展示面板必须包含范围滑块分类。"
);
assert.match(
  uiShowcaseData.sections.ranges,
  /s1p-range-control[\s\S]*?s1p-range-input/,
  "范围滑块展示必须复用真实的 s1p-range-control / s1p-range-input 结构。"
);
assert.match(
  uiShowcaseCode,
  /syncS1pRangeInputProgress\(target\)/,
  "范围滑块展示拖动时必须同步自定义轨道进度。"
);
assert.match(
  uiShowcaseCode,
  /\.s1p-ui-showcase-panel \.s1p-btn\.s1p-primary\s*\{[\s\S]*?background-color:\s*#3b82f6;[\s\S]*?color:\s*var\(--s1p-white\);/,
  "UI 展示面板必须补齐脱离列表作用域后的 s1p-primary 按钮样式。"
);
const sidebarRule = getUiShowcaseRule(".s1p-ui-showcase-sidebar");
assert.match(
  sidebarRule,
  /background:\s*color-mix\(in srgb, var\(--s1p-debug-console-surface-soft\) 40%, transparent\);/,
  "UI 展示面板侧边栏应复用调试面板半透明 surface。"
);
assert.match(
  sidebarRule,
  /backdrop-filter:\s*blur\(12px\);/,
  "UI 展示面板侧边栏应保留当前玻璃化 blur。"
);
const variantRule = getUiShowcaseRule(".s1p-ui-showcase-variant");
assert.match(
  variantRule,
  /border:\s*none;/,
  "UI 展示项不应使用普通设置面板实线边框。"
);
assert.match(
  variantRule,
  /background:\s*color-mix\(in srgb, var\(--s1p-debug-console-surface-soft\) 90%, transparent\);/,
  "UI 展示项应使用调试面板半透明 surface，避免和其他调试标签页风格割裂。"
);
assert.match(
  uiShowcaseData.sections.confirmbars,
  /class="s1p-confirm-action-btn s1p-confirm"[\s\S]*?class="s1p-confirm-action-btn s1p-cancel"/,
  "确认栏展示必须使用真实的圆形图标按钮结构。"
);
assert.doesNotMatch(
  uiShowcaseData.sections.confirmbars,
  /s1p-confirm-action-btn s1p-btn/,
  "确认栏 action 按钮不能混入 s1p-btn/s1p-btn-sm 文本按钮样式。"
);
assert.match(
  uiShowcaseData.sections.toggles,
  /class="s1p-settings-group"[\s\S]*?class="s1p-settings-item s1p-feature-toggle-item"[\s\S]*?class="s1p-settings-label s1p-settings-section-title-label"/,
  "功能大开关展示应复用真实设置分组和 feature toggle 层级。"
);
assert.doesNotMatch(
  uiShowcaseData.sections.cards,
  /class="s1p-settings-group" style="border:1px solid var\(--s1p-pri\)/,
  "卡片分组展示不能给 s1p-settings-group 额外加内联边框。"
);

if (designDoc) {
  assert.match(
    designDoc,
    /## 9\. 已知问题与修复记录/,
    "UI showcase 设计文档应把历史问题沉淀为修复记录。"
  );
  assert.doesNotMatch(
    designDoc,
    /## 9\. 悬而未决/,
    "UI showcase 设计文档不应继续把已修复签名问题列为悬而未决。"
  );
  [
    /createConfirmationModal\(title, subtitle, onConfirm, confirmText = "确定", options = \{\}\)/,
    /createInputModal\(title, subtitle, defaultValue, onConfirm, confirmText = "确定", placeholder = "", options = \{\}\)/,
    /createAdvancedConfirmationModal\(title, bodyHtml, buttons, options = \{\}\)/,
    /createDatePicker\(inputEl, initialDate: Date, onSelect: fn\)/,
    /showMessage\(message, isSuccess: boolean \| null, options = \{\}\)/,
    /openS1pImageViewer\(sourceUrl: string, options = \{\}\)/,
  ].forEach((pattern) => {
    assert.match(designDoc, pattern, `设计文档缺少真实签名速查：${pattern}`);
  });
}

console.log("[ui-showcase-panel] UI showcase preview actions verified.");
