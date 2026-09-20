#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { sourceCodeWithCss: sourceCode } = require("./s1plus-test-helpers");

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
  ) &&
    sourceCode.includes(
      'modal.className = buildSettingsSecondaryModalClassName(\n      "s1p-token-config-modal"'
    ) &&
    sourceCode.includes("host: modalHost,") &&
    sourceCode.includes("mountS1pModalSurface(modal, {"),
  "Token 日期配置应优先挂载到设置面板内容容器，由设置面板承载。"
);
const tokenConfigModalIndex = sourceCode.indexOf(
  ".s1p-settings-secondary-modal {"
);
assert.notEqual(
  tokenConfigModalIndex,
  -1,
  "设置内二级弹窗缺少通用局部容器样式。"
);
assert.match(
  sourceCode.slice(tokenConfigModalIndex, tokenConfigModalIndex + 520),
  /position:\s*absolute;[\s\S]*inset:\s*0;[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--s1p-settings-content-bg,\s*var\(--s1p-bg\)\) 18%,\s*transparent\);/,
  "设置内二级弹窗应作为设置面板内部覆盖层，而不是全屏蒙版。"
);
assert.ok(
  sourceCode.includes(
    'modal.className = buildSettingsSecondaryModalClassName(\n      "s1p-confirm-modal",\n      "s1p-reading-progress-modal"'
  ),
  "阅读记录详情应复用通用设置内二级弹窗结构。"
);
const secondaryGlassSelector =
  ":is(\n      .s1p-settings-secondary-modal > .s1p-dialog-content.s1p-settings-secondary-glass,\n      .s1p-date-picker.s1p-settings-secondary-glass\n    ) {";
const secondaryGlassIndex = sourceCode.indexOf(secondaryGlassSelector);
assert.notEqual(
  secondaryGlassIndex,
  -1,
  "标准二级玻璃材质必须绑定到二级弹窗的直接内容壳。"
);
assert.match(
  sourceCode.slice(secondaryGlassIndex, secondaryGlassIndex + 650),
  /background:\s*var\(--s1p-settings-secondary-glass-bg\);[\s\S]*border:\s*1px solid var\(--s1p-settings-secondary-glass-border\);[\s\S]*box-shadow:\s*var\(--s1p-settings-secondary-glass-shadow\);[\s\S]*backdrop-filter:\s*var\(--s1p-settings-secondary-glass-filter\);/,
  "标准二级玻璃类必须独占完整的背景、边框、阴影和滤镜材质。"
);
assert.ok(
  sourceCode.includes(
    "picker.classList.add(S1P_SETTINGS_SECONDARY_GLASS_CLASS);"
  ),
  "设置二级弹窗触发的日期选择器应显式复用同一材质。"
);
assert.ok(
  sourceCode.includes(
    'const tokenConfigContentClassName = buildS1pDialogContentClassName(\n      surfaceContext,\n      "compact"\n    );'
  ),
  "Token 配置必须使用标准二级内容壳的 compact 尺寸。"
);
assert.ok(
  sourceCode.includes(
    'content.className = buildS1pDialogContentClassName(\n      surfaceContext,\n      "wide"\n    );'
  ),
  "阅读记录详情必须使用标准二级内容壳的 wide 尺寸。"
);
assert.ok(
  !sourceCode.includes("s1p-confirm-content") &&
    !sourceCode.includes("s1p-token-config-content") &&
    !sourceCode.includes("s1p-reading-progress-content"),
  "旧确认、Token 和阅读记录专属外壳类必须完全移除。"
);
[
  ["compact", "400px"],
  ["default", "480px"],
  ["wide", "550px"],
  ["expanded", "580px"],
].forEach(([size, width]) => {
  assert.ok(
    sourceCode.includes(
      `.s1p-dialog-content--${size} {\n      width: ${width};`
    ),
    `标准内容壳缺少 ${size} 尺寸。`
  );
});
assert.match(
  sourceCode,
  /\.s1p-dialog-content--compact \{[\s\S]*?max-height:\s*min\(80vh, calc\(100% - 32px\)\);[\s\S]*?\.s1p-dialog-content--default/,
  "Token 使用的 compact 尺寸必须保留原有高度上限，不能影响其他一级弹窗。"
);
assert.match(
  sourceCode,
  /\.s1p-dialog-content--wide \{[\s\S]*?max-width:\s*100%;[\s\S]*?\.s1p-dialog-content--expanded/,
  "阅读记录使用的 wide 尺寸必须保留原有容器宽度上限。"
);
assert.ok(
  sourceCode.includes('contentSize: "expanded"'),
  "手动同步和同步冲突弹窗必须显式使用 expanded 通用尺寸。"
);
assert.ok(
  sourceCode.includes("host: settingsModalContent,") &&
    sourceCode.includes("surfaceContext?.isSettingsSecondaryModal"),
  "阅读记录详情及通用设置弹窗应通过标准 surface context 挂载到设置面板内容容器。"
);
assert.ok(
  !sourceCode.includes("s1p-token-config-modal--detached"),
  "设置内二级弹窗的 detached 状态不应继续使用 Token 专属结构名。"
);
assert.ok(
  sourceCode.includes("useSettingsSecondaryModal: true") &&
    !sourceCode.includes("useSettingsSecondaryGlass"),
  "设置内弹窗应显式选择完整 secondary modal 语义，而不应只选择玻璃材质。"
);
assert.ok(
  sourceCode.includes("const runS1pLayeredModalOpenSequence = (") &&
    sourceCode.includes("const closeS1pLayeredModalWithSequence = (") &&
    !sourceCode.includes("runS1pFullscreenModalOpenSequence") &&
    !sourceCode.includes("closeS1pFullscreenModalWithSequence"),
  "一级与二级弹窗应共享无全屏语义偏向的 layered modal 动画管线。"
);
[
  ["const createConfirmationModal = (", "const createInputModal = ("],
  ["const createInputModal = (", "const buildConfirmationMarkup = ("],
  ["const createAdvancedConfirmationModal = (", "const addBlockButtonsToThreadRows = ("],
].forEach(([startMarker, endMarker]) => {
  const start = sourceCode.indexOf(startMarker);
  const end = sourceCode.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} 工厂源码范围缺失。`);
  const block = sourceCode.slice(start, end);
  assert.ok(
    block.includes("useSettingsSecondaryModal") &&
      block.includes("buildS1pDialogContentClassName(") &&
      block.includes("buildS1pModalSurfaceClassName(") &&
      block.includes("mountS1pModalSurface(modal, {") &&
      block.includes("closeS1pModalSurface(modal, {") &&
      !block.includes("document.body.appendChild(modal)"),
    `${startMarker} 必须通过完整 modal surface 契约选择一级或设置内二级结构。`
  );
});
const manualUserBlockStart = sourceCode.indexOf(
  "const openManualUserBlockModal = ("
);
const manualUserBlockEnd = sourceCode.indexOf(
  "const renderUserTab = () =>",
  manualUserBlockStart
);
const manualUserBlock = sourceCode.slice(
  manualUserBlockStart,
  manualUserBlockEnd
);
assert.ok(
  manualUserBlock.includes("resolveS1pModalSurfaceContext(true)") &&
    manualUserBlock.includes("mountS1pModalSurface(modal, {") &&
    manualUserBlock.includes("closeS1pModalSurface(modal, {") &&
    !manualUserBlock.includes("buildS1pFullscreenModalClassName"),
  "手动屏蔽用户窗口必须完整复用设置内二级弹窗结构。"
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
