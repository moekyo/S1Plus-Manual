#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness,
  cssSource,
  sourceCode,
} = require("./s1plus-test-helpers");

const { hooks } = createHarness();
const { resolveS1pThemeState } = hooks;

assert.equal(
  typeof resolveS1pThemeState,
  "function",
  "主题 authority 应暴露纯解析器用于回归验证。"
);

assert.deepEqual(
  JSON.parse(JSON.stringify(resolveS1pThemeState({
    nuxEnabled: false,
    nuxDarkThemeRaw: "1",
    systemPrefersDark: true,
  }))),
  { isDark: false, source: "default-light" },
  "NUX 未启用时不能因为系统深色而把 S1 Plus 切成深色。"
);

assert.deepEqual(
  JSON.parse(JSON.stringify(resolveS1pThemeState({
    nuxEnabled: true,
    nuxDarkThemeRaw: "0",
    systemPrefersDark: true,
  }))),
  { isDark: false, source: "nux-darktheme" },
  "系统深色 + NUX 实际浅色时必须服从 NUX。"
);

assert.deepEqual(
  JSON.parse(JSON.stringify(resolveS1pThemeState({
    nuxEnabled: true,
    nuxDarkThemeRaw: "1",
    systemPrefersDark: false,
  }))),
  { isDark: true, source: "nux-darktheme" },
  "系统浅色 + NUX 实际深色时必须服从 NUX。"
);

assert.deepEqual(
  JSON.parse(JSON.stringify(resolveS1pThemeState({
    nuxEnabled: true,
    nuxDarkThemeRaw: "",
    systemPrefersDark: true,
  }))),
  { isDark: true, source: "nux-system-fallback" },
  "仅在 NUX 已检测到但缺少 --darktheme 时允许回退系统配色。"
);

assert.equal(
  cssSource.includes("@media (prefers-color-scheme: dark)"),
  false,
  "S1 Plus 样式不得再直接以系统深色媒体查询作为主题 authority。"
);
assert.ok(
  cssSource.includes("html.s1p-theme-dark .s1p-modal > .s1p-modal-content"),
  "设置面板深色 surface 必须由统一主题投影 class 驱动。"
);
assert.ok(
  cssSource.includes("html.s1p-theme-dark .s1p-tab-slider"),
  "设置标签深色状态必须由统一主题投影 class 驱动。"
);
assert.ok(
  sourceCode.includes("syncS1pThemeProjection();\n      applyNuxTransitionIsolationFix(modal);"),
  "设置面板存活期间应持续同步 NUX 实际主题投影。"
);
assert.ok(
  sourceCode.includes("html.${S1P_THEME_DARK_CLASS} .s1p-input:focus"),
  "运行时注入的 NUX 深色兼容样式也必须消费统一主题 class。"
);

console.log("[nux-theme-authority] NUX theme authority contracts verified.");
