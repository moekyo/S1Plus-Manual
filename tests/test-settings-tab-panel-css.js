#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { sourceCode } = require("./s1plus-test-helpers");

const hiddenSelector =
  ".s1p-modal > .s1p-modal-content > .s1p-modal-body > .s1p-tab-panels > .s1p-tab-content";
const activeSelector = `${hiddenSelector}.active`;

const hiddenIndex = sourceCode.indexOf(hiddenSelector);
const activeIndex = sourceCode.indexOf(activeSelector);

assert.notEqual(
  hiddenIndex,
  -1,
  "设置面板 tab 内容缺少 scoped inactive 隐藏规则。"
);
assert.notEqual(
  activeIndex,
  -1,
  "设置面板 active tab 内容恢复规则必须匹配 scoped panel selector。"
);
assert.ok(
  activeIndex > hiddenIndex,
  "active tab 内容恢复规则必须位于 inactive 隐藏规则之后，以覆盖 height/visibility。"
);

assert.match(
  sourceCode.slice(activeIndex, activeIndex + 420),
  /height:\s*auto;[\s\S]*visibility:\s*visible;[\s\S]*content-visibility:\s*visible;/,
  "active tab 内容规则必须恢复高度、可见性和 content-visibility。"
);

const modalBodySelector =
  ".s1p-modal > .s1p-modal-content > .s1p-modal-body";
const modalBodyIndex = sourceCode.indexOf(`${modalBodySelector} {`);
const modalOverlayIndex = sourceCode.indexOf(".s1p-fullscreen-modal::before {");

assert.notEqual(
  modalBodyIndex,
  -1,
  "设置面板 modal body 缺少 scoped 样式规则。"
);
assert.notEqual(
  modalOverlayIndex,
  -1,
  "设置面板必须复用统一全屏弹层伪元素蒙版。"
);
assert.match(
  sourceCode.slice(modalOverlayIndex, modalOverlayIndex + 420),
  /pointer-events:\s*none;[\s\S]*backdrop-filter:\s*blur\(var\(--s1p-overlay-blur\)\);/,
  "统一全屏蒙版应复用全局 blur 变量，且不能拦截点击关闭。"
);
assert.ok(
  sourceCode.includes('buildS1pFullscreenModalClassName("s1p-modal")'),
  "设置面板 root 必须挂载统一全屏弹层基础类。"
);
assert.ok(
  !sourceCode.includes('buildS1pFullscreenModalClassName("s1p-token-config-modal")'),
  "Token 日期配置是设置面板内部二级弹窗，不应挂载统一全屏蒙版类。"
);
assert.ok(
  sourceCode.includes(
    'const settingsModalContent = document.querySelector(\n      ".s1p-modal > .s1p-modal-content"\n    );'
  ) && sourceCode.includes("modalHost.appendChild(modal);"),
  "Token 日期配置应优先挂载到设置面板内容容器，由设置面板承载。"
);
const tokenConfigModalIndex = sourceCode.indexOf(
  ".s1p-token-config-modal {"
);
assert.notEqual(
  tokenConfigModalIndex,
  -1,
  "Token 日期配置缺少局部弹窗容器样式。"
);
assert.match(
  sourceCode.slice(tokenConfigModalIndex, tokenConfigModalIndex + 520),
  /position:\s*absolute;[\s\S]*inset:\s*0;[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--s1p-settings-content-bg,\s*var\(--s1p-bg\)\) 18%,\s*transparent\);/,
  "Token 日期配置应作为设置面板内部覆盖层，而不是全屏蒙版。"
);
assert.match(
  sourceCode.slice(modalBodyIndex, modalBodyIndex + 420),
  /background:\s*var\(--s1p-settings-body-surface-bg\);/,
  "设置面板滚动视口必须持有固定背景，避免滚动时圆角随内容移走。"
);
assert.ok(
  sourceCode.includes(
    "--s1p-settings-body-surface-bg: color-mix(in srgb, var(--s1p-settings-content-bg) 94%, transparent);"
  ) &&
    sourceCode.includes(
      "--s1p-settings-body-surface-bg: color-mix(in srgb, var(--s1p-settings-content-bg) 98%, transparent);"
    ),
  "设置面板滚动视口背景必须分别提供浅色和深色主题值。"
);
assert.match(
  sourceCode.slice(modalBodyIndex, modalBodyIndex + 760),
  /scrollbar-gutter:\s*stable;[\s\S]*scrollbar-color:\s*var\(--s1p-settings-scrollbar-thumb\) var\(--s1p-settings-scrollbar-track\);[\s\S]*scrollbar-width:\s*thin;/,
  "设置面板滚动条必须复用自定义颜色并使用 thin 宽度。"
);
assert.match(
  sourceCode.slice(modalBodyIndex, modalBodyIndex + 360),
  /clip-path:\s*inset\(0 round 12px\);/,
  "设置面板滚动视口必须裁切原生 scrollbar gutter，避免右侧直角。"
);
assert.ok(
  sourceCode.includes("--s1p-settings-scrollbar-thumb: rgba(37, 71, 122, 0.42);"),
  "浅色设置面板滚动条应复用脚本既有的自定义 thumb 色。"
);
assert.match(
  sourceCode,
  /::-webkit-scrollbar\s*\{\s*width:\s*12px;/,
  "设置面板 WebKit 滚动条轨道宽度应保持为 12px。"
);
assert.ok(
  sourceCode.includes(
    "const applyNuxSettingsScrollbarThemeFix = (settingsModal = null) =>"
  ),
  "NUX 设置面板滚动条应复用现有 NUX 适配管线，而不是只靠 CSS 类覆盖。"
);
assert.ok(
  sourceCode.includes(
    'modalContent.style.setProperty(\n        NUX_SETTINGS_SCROLLBAR_THUMB_VAR,\n        "var(--prid'
  ),
  "NUX 启用时设置面板滚动条 thumb 应跟随 S1 NUX 的 --prid。"
);
assert.ok(
  !sourceCode.includes("NUX_SETTINGS_SCROLLBAR_TRACK_VAR"),
  "设置面板的 track 应保持透明，不能跟随 NUX --bg 形成直角沟槽。"
);
assert.ok(
  sourceCode.includes("::-webkit-scrollbar-track-piece") &&
    sourceCode.includes("::-webkit-scrollbar-corner"),
  "设置面板应覆盖 WebKit track-piece/corner，避免 NUX 或浏览器默认轨道露出直角。"
);
assert.match(
  sourceCode.slice(hiddenIndex - 220, hiddenIndex),
  /background:\s*transparent;[\s\S]*border-radius:\s*0;/,
  "设置面板 tab 内容容器不能持有圆角背景，否则滚动时会露出直角。"
);
assert.ok(
  sourceCode.slice(modalBodyIndex, modalBodyIndex + 1800).includes(
    "border: 4px solid transparent !important;"
  ) &&
    sourceCode.slice(modalBodyIndex, modalBodyIndex + 1800).includes(
      "border-radius: 999px !important;"
    ),
  "设置面板 scrollbar thumb 的内缩和圆角应覆盖外部主题规则。"
);
assert.ok(
  sourceCode.includes("applyNuxSettingsScrollbarThemeFix(modal);"),
  "设置面板打开后应通过 modal-scoped NUX 同步逻辑刷新滚动条主题。"
);
assert.ok(
  sourceCode.includes("applyNuxSettingsScrollbarThemeFix();"),
  "全局 NUX 兼容性刷新时应同步设置面板滚动条主题。"
);

console.log("[settings-tab-panel-css] Settings tab panel CSS selectors verified.");
