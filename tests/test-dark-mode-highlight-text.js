#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { cssSource } = require("./s1plus-test-helpers");

const stripCssComments = (cssText) =>
  String(cssText || "").replace(/\/\*[\s\S]*?\*\//g, "");

const cssWithoutComments = stripCssComments(cssSource);

const parseCssBlocks = (cssText) =>
  Array.from(String(cssText || "").matchAll(/([^{}]+)\{([^{}]*)\}/g)).map(
    (match) => ({
      selector: match[1].replace(/\s+/g, " ").trim(),
      body: match[2],
      source: match[0],
    })
  );

const cssBlocks = parseCssBlocks(cssWithoutComments);

const findRuleBlock = (selector) =>
  cssBlocks.find((block) => block.selector.split(",").map((part) => part.trim()).includes(selector));

const escapeRegExp = (text) =>
  String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractLiteralHexVar = (body, name) => {
  const match = body.match(new RegExp(`--${escapeRegExp(name)}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  return match ? match[1] : "";
};

const hexLuminance = (hex) => {
  const cleaned = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return null;
  }
  const [r, g, b] = [0, 2, 4].map((index) => {
    const channel = parseInt(cleaned.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (foreground, background) => {
  const foregroundLuminance = hexLuminance(foreground);
  const backgroundLuminance = hexLuminance(background);
  assert.notEqual(foregroundLuminance, null, `无效前景色: ${foreground}`);
  assert.notEqual(backgroundLuminance, null, `无效背景色: ${background}`);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

const hasWhiteText = (body) =>
  /(?:^|;)\s*color\s*:\s*(?:var\(--s1p-white\)|#fff(?:fff)?)\s*(?:;|$)/i.test(body);

const hasAccentBackground = (body) =>
  /(?:^|;)\s*background(?:-color)?\s*:\s*[^;]*var\(--s1p-(?:sec|sub-h)\b/.test(body);

const findWhiteTextOnAccentBackground = (cssText) =>
  parseCssBlocks(stripCssComments(cssText))
    .filter((block) => hasWhiteText(block.body) && hasAccentBackground(block.body))
    .map((block) => block.selector);

const testUnblockHoverColorContract = () => {
  assert.match(
    cssWithoutComments,
    /\.s1p-unblock-btn:hover\s*\{[^}]*background-color:\s*var\(--s1p-red-h\);[^}]*color:\s*var\(--s1p-white\);/,
    "取消屏蔽按钮高亮时应显式使用白色文字，避免深色主题继承深色字。"
  );
  assert.match(
    cssWithoutComments,
    /\.s1p-unblock-post-btn:hover\s*\{[^}]*background-color:\s*var\(--s1p-red-h\);[^}]*color:\s*var\(--s1p-white\);/,
    "取消屏蔽楼层按钮高亮时应显式使用白色文字。"
  );
};

const testDarkModeTextTokenContract = () => {
  const rootBlock = findRuleBlock(":root");
  assert.ok(rootBlock, "缺少 :root 颜色变量定义块。");
  assert.match(
    rootBlock.body,
    /--s1p-sub-h-t:\s*var\(--s1p-white\)/,
    "浅色主题下 --s1p-sub-h-t 必须回退为白色文字。"
  );
  const darkBlock = findRuleBlock("html.s1p-theme-dark");
  assert.ok(darkBlock, "缺少 html.s1p-theme-dark 深色变量覆写块。");
  assert.match(
    darkBlock.body,
    /--s1p-sub-h-t:\s*var\(--icl,\s*#111827\)/,
    "深色主题下 --s1p-sub-h-t 必须跟随 NUX 的 --icl（深色字），否则白色文字会压在提亮的强调背景上。"
  );
};

const testDarkModeHighlightTextContract = () => {
  const accentTextRules = [
    [
      "#s1p-debug-unified-panel .s1p-debug-panel-group .s1p-debug-btn.is-active",
      "调试面板激活按钮",
    ],
    [".s1p-segmented-control-option.active", "分段控件选中项"],
    [".s1p-dp-day.today:hover", "日期选择器“今天”悬停"],
    [".s1p-bookmark-toggle:hover", "回复收藏展开按钮悬停"],
    [".s1p-bookmark-toggle:active", "回复收藏展开按钮按下"],
    [
      ".s1p-nux-recommend-modal .s1p-confirm-btn.s1p-confirm:hover",
      "NUX 推荐弹窗确认按钮悬停",
    ],
  ];
  accentTextRules.forEach(([selector, label]) => {
    assert.match(
      cssWithoutComments,
      new RegExp(
        `${escapeRegExp(selector)}\\s*\\{[^}]*color:\\s*var\\(--s1p-sub-h-t\\);`
      ),
      `${label}的强调背景在深色主题下应使用随主题变化的文字色（--s1p-sub-h-t），避免白字压亮色底。`
    );
  });
};

const testNoWhiteTextOnAccentBackground = () => {
  assert.deepEqual(
    findWhiteTextOnAccentBackground(
      ":root { --s1p-sec: #ffb608; } .s1p-new-widget:hover { background: var(--s1p-sec); color: var(--s1p-white); }"
    ),
    [".s1p-new-widget:hover"],
    "扫描器应能识别固定白字压强调色背景的规则。"
  );
  assert.deepEqual(
    findWhiteTextOnAccentBackground(cssSource),
    [],
    "不允许再出现“固定白字 + 会被深色主题提亮的强调背景”的悬停/激活态规则；应改用 var(--s1p-sub-h-t)。"
  );
};

const testRedHoverButtonsKeepWhiteText = () => {
  assert.match(
    cssWithoutComments,
    /\.s1p-btn\.s1p-red-btn:hover,\s*\.s1p-btn\.s1p-danger:hover,\s*\.s1p-confirm-btn\.s1p-confirm:hover\s*\{[^}]*background-color:\s*var\(--s1p-red-h\);[^}]*color:\s*var\(--s1p-white\);/,
    "通用红底危险按钮悬停应保持白色文字。"
  );
  assert.match(
    cssWithoutComments,
    /\.s1p-item-actions \.s1p-btn\.s1p-danger:hover\s*\{[^}]*background-color:\s*var\(--s1p-red-h\);[^}]*color:\s*var\(--s1p-white\);/,
    "列表操作区的红底危险按钮悬停应保持白色文字。"
  );
  assert.match(
    cssWithoutComments,
    /\.s1p-nux-recommend-modal \.s1p-confirm-btn\.s1p-cancel:hover\s*\{[^}]*background-color:\s*var\(--s1p-red-h\);[^}]*color:\s*var\(--s1p-white\);/,
    "NUX 推荐弹窗的红底取消按钮悬停应保持白色文字。"
  );
};

const testLowContrastFixesContract = () => {
  const rootBody = findRuleBlock(":root").body;
  const darkBody = findRuleBlock("html.s1p-theme-dark").body;
  const pickVar = (name) =>
    extractLiteralHexVar(darkBody, name) || extractLiteralHexVar(rootBody, name);

  // 1) 用户标记颜色选择器：白勾只在对比度足够的色块上保留，其余用暖褐勾。
  const softCheck = pickVar("s1p-color-option-check-soft");
  assert.equal(softCheck, "#5a4a22", "彩色色块应使用暖褐勾选 token。");
  assert.match(
    cssWithoutComments,
    /\.s1p-color-option\[data-color="orange"\],\s*\.s1p-color-option\[data-color="green"\],\s*\.s1p-color-option\[data-color="yellow"\]\s*\{[^}]*color:\s*var\(--s1p-color-option-check-soft\);/,
    "浅色标签色块（橙/绿/黄）应使用暖褐勾选。"
  );
  assert.match(
    cssWithoutComments,
    /html\.s1p-theme-dark \.s1p-color-option\[data-color\]:not\(\[data-color=""\]\)\s*\{[^}]*color:\s*var\(--s1p-color-option-check-soft\);/,
    "深色主题下彩色色块应统一使用暖褐勾选。"
  );

  const colorKeys = ["red", "orange", "yellow", "green", "blue", "purple"];
  const lightTagVars = Object.fromEntries(
    colorKeys.map((key) => [key, extractLiteralHexVar(rootBody, `s1p-tag-${key}`)])
  );
  const darkTagVars = Object.fromEntries(
    colorKeys.map((key) => [key, extractLiteralHexVar(darkBody, `s1p-tag-${key}`)])
  );
  const lightWhiteKeys = new Set(["red", "blue", "purple"]);
  colorKeys.forEach((key) => {
    const lightCheck = lightWhiteKeys.has(key) ? "#ffffff" : softCheck;
    assert.ok(
      contrastRatio(lightCheck, lightTagVars[key]) >= 3,
      `浅色主题 ${key} 色块勾选对比度不足 3:1。`
    );
    assert.ok(
      contrastRatio(softCheck, darkTagVars[key]) >= 3,
      `深色主题 ${key} 色块勾选对比度不足 3:1。`
    );
  });

  // 2) 阅读位置指示器：新增按主题的文字 token，两种主题都 >= 4.5:1。
  assert.equal(
    extractLiteralHexVar(rootBody, "s1p-readprogress-text"),
    "#4c571f",
    "浅色主题阅读指示器文字 token 应为中等橄榄绿。"
  );
  assert.equal(
    extractLiteralHexVar(darkBody, "s1p-readprogress-text"),
    "#2d3717",
    "深色主题阅读指示器文字 token 应保持可读对比度。"
  );
  assert.match(
    cssWithoutComments,
    /\.s1p-read-indicator\s*\{[^}]*color:\s*var\(--s1p-readprogress-text\);/,
    "阅读位置指示器应使用主题化文字 token。"
  );
  assert.ok(
    contrastRatio(
      extractLiteralHexVar(rootBody, "s1p-readprogress-text"),
      extractLiteralHexVar(rootBody, "s1p-readprogress-bg")
    ) >= 4.5,
    "浅色主题阅读指示器文字对比度不足 4.5:1。"
  );
  assert.ok(
    contrastRatio(
      extractLiteralHexVar(darkBody, "s1p-readprogress-text"),
      extractLiteralHexVar(darkBody, "s1p-readprogress-bg")
    ) >= 4.5,
    "深色主题阅读指示器文字对比度不足 4.5:1。"
  );

  // 3) 内联确认菜单：保持亮色悬停底色，把白色图标换成深色图标。
  const confirmHoverBody = findRuleBlock(
    ".s1p-confirm-action-btn.s1p-confirm:hover"
  ).body;
  const cancelHoverBody = findRuleBlock(
    ".s1p-confirm-action-btn.s1p-cancel:hover"
  ).body;
  assert.match(
    confirmHoverBody,
    /background-image:\s*url\("data:image\/svg\+xml,[^"]*stroke='%23256b45'/,
    "确认按钮悬停图标应改为深绿色，以保证亮绿底上的可读性。"
  );
  assert.match(
    cancelHoverBody,
    /background-image:\s*url\("data:image\/svg\+xml,[^"]*stroke='%238a1f1f'/,
    "取消按钮悬停图标应改为深红色，以保证亮红底上的可读性。"
  );
  assert.ok(
    contrastRatio(
      "#256b45",
      extractLiteralHexVar(rootBody, "s1p-confirm-hover-bg")
    ) >= 3,
    "确认按钮悬停图标对比度不足 3:1。"
  );
  assert.ok(
    contrastRatio(
      "#8a1f1f",
      extractLiteralHexVar(rootBody, "s1p-cancel-hover-bg")
    ) >= 3,
    "取消按钮悬停图标对比度不足 3:1。"
  );
};

testUnblockHoverColorContract();
testDarkModeTextTokenContract();
testLowContrastFixesContract();
testDarkModeHighlightTextContract();
testNoWhiteTextOnAccentBackground();
testRedHoverButtonsKeepWhiteText();

console.log(
  "[dark-mode-highlight-text] unblock hover, theme-aware accent text, low-contrast control fixes and red danger button text contrast verified."
);
