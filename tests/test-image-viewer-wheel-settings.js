#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { sourceCode } = require("./s1plus-test-helpers");

assert.match(
  sourceCode,
  /const S1P_IMAGE_VIEWER_WHEEL_ZOOM_STEP_DEFAULT_PERCENT = 6;/,
  "滚轮缩放幅度默认值应为 6%。"
);
assert.match(
  sourceCode,
  /const S1P_IMAGE_VIEWER_WHEEL_SCROLL_STEP_DEFAULT_PERCENT = 6;/,
  "滚轮滚动幅度默认值应为 6%。"
);
assert.match(
  sourceCode,
  /<button id="s1p-imageViewerWheelStepResetBtn" type="button" class="s1p-btn s1p-range-reset-btn">恢复默认<\/button>/,
  "滚轮行为 slider 应提供恢复默认按钮。"
);
assert.match(
  sourceCode,
  /\.s1p-image-viewer-wheel-range\s*\{[\s\S]*?width:\s*100%;[\s\S]*?margin-top:\s*2px;[\s\S]*?\}/,
  "滚轮行为 slider 外层应占满当前设置分组的可用宽度。"
);
assert.match(
  sourceCode,
  /\.s1p-image-viewer-wheel-range \.s1p-range-control\s*\{[\s\S]*?width:\s*100%;[\s\S]*?\}/,
  "滚轮行为 slider 本体应占满外层宽度，让数值与恢复默认按钮右对齐。"
);
assert.match(
  sourceCode,
  /const getImageViewerWheelDefaultStepPercent = \(mode\) =>[\s\S]*?S1P_IMAGE_VIEWER_WHEEL_SCROLL_STEP_DEFAULT_PERCENT[\s\S]*?S1P_IMAGE_VIEWER_WHEEL_ZOOM_STEP_DEFAULT_PERCENT;/,
  "恢复默认应根据当前滚轮模式选择对应默认值。"
);
assert.match(
  sourceCode,
  /imageViewerWheelStepResetBtn\.addEventListener\("click",[\s\S]*?const config = getImageViewerWheelSliderConfig\(modeValue\);[\s\S]*?currentSettings\[config\.settingKey\]\s*=\s*getImageViewerWheelDefaultStepPercent\(modeValue\);[\s\S]*?saveSettings\(currentSettings\);[\s\S]*?syncImageViewerWheelSlider\(modeValue\);/,
  "恢复默认按钮应只写回当前模式对应的 slider 设置。"
);

console.log("[image-viewer-wheel-settings] Image viewer wheel settings verified.");
