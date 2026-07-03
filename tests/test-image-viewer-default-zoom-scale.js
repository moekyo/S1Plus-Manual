#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness, sourceCode } = require("./s1plus-test-helpers");

assert.match(
  sourceCode,
  /const S1P_IMAGE_VIEWER_DEFAULT_ZOOM_SCALE_DEFAULT_PERCENT = 100;/,
  "铺满宽度比例默认值应保持当前铺满宽度行为。"
);
assert.match(
  sourceCode,
  /const S1P_IMAGE_VIEWER_DEFAULT_ZOOM_SCALE_MIN_PERCENT = 60;/,
  "铺满宽度比例最小值应为 60%。"
);
assert.match(
  sourceCode,
  /const S1P_IMAGE_VIEWER_DEFAULT_ZOOM_SCALE_MAX_PERCENT = 100;/,
  "铺满宽度比例最大值应保持 100%。"
);

const { hooks } = createHarness();
const { buildNormalizedSettings } = hooks;

assert.equal(
  buildNormalizedSettings({}).settings.imageViewerDefaultZoomScalePercent,
  100,
  "默认设置应补齐铺满宽度比例。"
);
assert.equal(
  buildNormalizedSettings({ imageViewerDefaultZoomScalePercent: 42 }).settings
    .imageViewerDefaultZoomScalePercent,
  60,
  "低于最小值的铺满宽度比例应被夹到 60%。"
);
assert.equal(
  buildNormalizedSettings({ imageViewerDefaultZoomScalePercent: 120 }).settings
    .imageViewerDefaultZoomScalePercent,
  100,
  "高于最大值的铺满宽度比例应被夹到 100%。"
);
assert.equal(
  buildNormalizedSettings({ imageViewerDefaultZoomScalePercent: 85 }).settings
    .imageViewerDefaultZoomScalePercent,
  85,
  "合法铺满宽度比例应保持原值。"
);
assert.ok(
  buildNormalizedSettings({ imageViewerDefaultZoomScalePercent: "bad" })
    .migrationReasons.includes(
      "image_viewer_default_zoom_scale_percent_normalized"
    ),
  "非法铺满宽度比例应记录 normalization 迁移原因。"
);

assert.match(
  sourceCode,
  /applyS1pImageViewerFitBySize = \([\s\S]*?\{ contain = false, allowUpscale = false, scaleRatio = 1 \}/,
  "图片查看器 fit 逻辑应支持铺满宽度比例。"
);
assert.match(
  sourceCode,
  /baseScale \*= safeScaleRatio;/,
  "非完整显示的宽度适配应乘以铺满宽度比例。"
);
assert.match(
  sourceCode,
  /settings\.imageViewerDefaultZoomScalePercent[\s\S]*?\) \/ 100/,
  "默认放大显示应从设置读取比例。"
);
assert.match(
  sourceCode,
  /label: "铺满宽度比例"/,
  "slider 标题应说明它控制铺满宽度比例，而不是查看器顶部的实际缩放百分比。"
);
assert.match(
  sourceCode,
  /顶部百分比显示图片实际缩放/,
  "slider 描述应说明查看器顶部百分比显示的是图片实际缩放。"
);
assert.match(
  sourceCode,
  /id="s1p-imageViewerDefaultZoomScaleContainer" class="s1p-image-viewer-default-scale-range \$\{imageViewerDefaultMode === "full" \? "s1p-hidden" : ""\}"/,
  "完整显示模式下铺满宽度比例 slider 应隐藏。"
);
assert.match(
  sourceCode,
  /<button id="s1p-imageViewerDefaultZoomScaleResetBtn" type="button" class="s1p-btn s1p-range-reset-btn">恢复默认<\/button>/,
  "铺满宽度比例 slider 应提供恢复默认按钮。"
);
assert.match(
  sourceCode,
  /syncImageViewerDefaultZoomScaleVisibility\(modeValue === "full"\);/,
  "默认模式切换应同步铺满宽度比例 slider 显隐。"
);
assert.match(
  sourceCode,
  /imageViewerDefaultZoomScaleSlider\.addEventListener\("change",[\s\S]*?settingKey !== "imageViewerDefaultZoomScalePercent"[\s\S]*?saveSettings\(currentSettings\);[\s\S]*?applyS1pImageViewerDefaultTransform\(\);/,
  "铺满宽度比例 slider 保存后应在查看器打开时重算默认缩放。"
);

console.log(
  "[image-viewer-default-zoom-scale] Image viewer default zoom scale verified."
);
