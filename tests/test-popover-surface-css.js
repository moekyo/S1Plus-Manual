#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { sourceCodeWithCss: sourceCode } = require("./s1plus-test-helpers");

const requiredVariables = [
  "--s1p-floating-surface-bg",
  "--s1p-floating-surface-filter",
  "--s1p-floating-surface-shadow",
  "--s1p-inline-action-surface-bg",
  "--s1p-inline-action-surface-shadow",
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

const assertFloatingSurface = (selector) => {
  const block = getRuleBlock(selector);
  assert.match(
    block,
    /background:\s*var\(--s1p-floating-surface-bg\)/,
    `${selector} 应使用统一浮动面背景。`
  );
  assertBorderlessOuterSurface(block, selector);
  assert.match(
    block,
    /backdrop-filter:\s*var\(--s1p-floating-surface-filter\)/,
    `${selector} 应使用统一浮动面磨砂变量。`
  );
};

const assertInlineActionSurface = (selector) => {
  const block = getRuleBlock(selector);
  assert.match(
    block,
    /background:\s*var\(--s1p-inline-action-surface-bg\)/,
    `${selector} 应使用轻量行内操作背景。`
  );
  assertBorderlessOuterSurface(block, selector);
  assert.match(
    block,
    /backdrop-filter:\s*var\(--s1p-floating-surface-filter\)/,
    `${selector} 应复用统一浮动面磨砂变量。`
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

assertFloatingSurface(".s1p-tag-popover");
assertFloatingSurface(".s1p-date-picker");
assertFloatingSurface(".s1p-confirm-wrapper");
assertFloatingSurface(".s1p-floating-surface");
assertFloatingSurface(".s1p-generic-display-popover");
assertFloatingSurface(".s1p-tag-options-menu");
assertFloatingSurface(
  ".s1p-generic-display-popover.s1p-generic-display-popover-doc"
);
assertInlineActionSurface(".s1p-inline-action-menu");

assertSolidPopover(".s1p-options-menu");

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
const tooltipPositionStart = sourceCode.indexOf(
  "const positionTooltipPopover ="
);
assert.notEqual(tooltipPositionStart, -1, "缺少 tooltip 定位函数。");
const tooltipPositionEnd = sourceCode.indexOf(
  "const applyTooltipLayout =",
  tooltipPositionStart
);
assert.notEqual(tooltipPositionEnd, -1, "无法解析 tooltip 定位函数边界。");
const tooltipPositionBlock = sourceCode.slice(
  tooltipPositionStart,
  tooltipPositionEnd
);
assert.match(
  sourceCode,
  /const getS1pLayoutViewportWidth = \(\) =>\s*document\.documentElement\?\.clientWidth\s*\|\|\s*window\.innerWidth/s,
  "应集中提供布局视口宽度 helper，避免浮层定位直接使用 innerWidth。"
);
assert.match(
  tooltipPositionBlock,
  /layoutViewportWidth\s*=\s*getS1pLayoutViewportWidth\(\)/,
  "tooltip 横向夹取应使用 documentElement.clientWidth，避免在有垂直滚动条时按 innerWidth 放进滚动条槽。"
);
assert.doesNotMatch(
  tooltipPositionBlock,
  /window\.scrollX\s*\+\s*window\.innerWidth/,
  "tooltip 右侧边界不应直接使用 window.innerWidth。"
);
assert.doesNotMatch(
  sourceCode,
  /spaceOnRight\s*=\s*window\.innerWidth/,
  "浮层右侧空间判断不应直接使用 window.innerWidth。"
);
assert.doesNotMatch(
  sourceCode,
  /left\s*\+\s*\w+(?:\.\w+)*\s*>\s*window\.innerWidth/,
  "浮层右侧夹取不应直接使用 window.innerWidth。"
);

console.log("[popover-surface-css] Type B popover surface CSS verified.");
