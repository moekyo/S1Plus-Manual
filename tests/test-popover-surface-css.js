#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { sourceCode } = require("./s1plus-test-helpers");

const requiredVariables = [
  "--s1p-popover-glass-bg",
  "--s1p-popover-glass-filter",
  "--s1p-popover-glass-shadow",
  "--s1p-popover-solid-bg",
  "--s1p-popover-solid-shadow",
];

for (const variableName of requiredVariables) {
  assert.ok(
    sourceCode.includes(variableName),
    `缺少浮层样式变量 ${variableName}。`
  );
}

assert.ok(
  sourceCode.includes("--s1p-popover-glass-bg: rgba(255, 255, 255, 0.86);"),
  "浅色 Light popover glass 应使用稍微更实的白色背景，避免内容透底影响阅读。"
);
assert.ok(
  !sourceCode.includes("--s1p-popover-glass-bg: rgba(236, 237, 235"),
  "浅色 Light popover glass 不应使用灰绿底色。"
);
assert.ok(
  !sourceCode.includes("--s1p-popover-glass-border") &&
    !sourceCode.includes("--s1p-popover-solid-border"),
  "Popover 最外层容器已统一无描边，不应保留 popover 边框变量。"
);

const getRuleBlock = (selector) => {
  const marker = `${selector} {`;
  const start = sourceCode.indexOf(marker);
  assert.notEqual(start, -1, `缺少 CSS 规则：${selector}`);
  const end = sourceCode.indexOf("\n    }", start);
  assert.notEqual(end, -1, `无法解析 CSS 规则：${selector}`);
  return sourceCode.slice(start, end);
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

const assertGlassPopover = (selector) => {
  const block = getRuleBlock(selector);
  assert.match(
    block,
    /background:\s*var\(--s1p-popover-glass-bg\)/,
    `${selector} 应使用轻磨砂浮层背景。`
  );
  assertBorderlessOuterSurface(block, selector);
  assert.match(
    block,
    /backdrop-filter:\s*var\(--s1p-popover-glass-filter\)/,
    `${selector} 应使用统一的轻量 popover 磨砂变量。`
  );
};

const assertSolidPopover = (selector) => {
  const block = getRuleBlock(selector);
  assert.match(
    block,
    /background:\s*var\(--s1p-popover-solid-bg\)/,
    `${selector} 应保持实底浮层背景。`
  );
  assertBorderlessOuterSurface(block, selector);
  assert.doesNotMatch(
    block,
    /backdrop-filter/,
    `${selector} 不应添加磨砂滤镜。`
  );
};

assertGlassPopover(".s1p-tag-popover");
assertGlassPopover(".s1p-date-picker");
assertGlassPopover(".s1p-confirm-wrapper");
assertGlassPopover(".s1p-confirm-card");
assertGlassPopover(".s1p-generic-display-popover");
assertGlassPopover(
  ".s1p-generic-display-popover.s1p-generic-display-popover-doc"
);

assertSolidPopover(".s1p-options-menu");
assertSolidPopover(".s1p-inline-action-menu");
assertSolidPopover(".s1p-tag-options-menu");

assert.ok(
  !sourceCode.includes(
    ".s1p-options-menu.s1p-confirm-wrapper:not(.s1p-inline-confirm-menu)"
  ),
  "列表页帖子屏蔽确认菜单应通过 .s1p-confirm-wrapper 继承轻磨砂，不需要单独特殊规则。"
);

const compactTooltipBlock = getRuleBlock(
  ".s1p-generic-display-popover.s1p-generic-display-popover-compact"
);
assert.match(
  compactTooltipBlock,
  /white-space:\s*nowrap/,
  "紧凑 tooltip 应固定单行，避免靠右定位后被压成竖排。"
);
assert.match(
  compactTooltipBlock,
  /width:\s*max-content/,
  "紧凑 tooltip 应按内容宽度测量，避免显示后反复换行。"
);

console.log("[popover-surface-css] Type B popover surface CSS verified.");
