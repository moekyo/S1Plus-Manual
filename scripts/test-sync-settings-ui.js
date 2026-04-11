#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "S1Plus.js");
const sourceCode = fs.readFileSync(sourcePath, "utf8");

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

expectMatch(
  /for="s1p-check-on-return-to-foreground-toggle">启用回到前台时检查云端更新/,
  "同步设置页缺少前台检查开关标签。"
);
expectMatch(
  /id="s1p-check-on-return-to-foreground-toggle" class="s1p-settings-checkbox" data-s1p-sync-control/,
  "同步设置页缺少前台检查开关输入控件。"
);
expectMatch(
  /foregroundSyncCheckToggle[\s\S]*autoSyncToggle/,
  "同步设置页脏状态监听未覆盖前台检查开关。"
);
expectMatch(
  /applySyncSettingsToModal\s*=\s*\(settingsSnapshot\)\s*=>\s*\{[\s\S]*syncCheckOnReturnToForeground/,
  "同步设置页未通过统一 helper 回填前台检查开关。"
);
expectMatch(
  /const refreshSyncTabControlsFromSettings = \(\) => \{\s*applySyncSettingsToModal\(getSettings\(\)\);/m,
  "跨标签刷新时未通过统一 helper 回填同步设置。"
);
expectMatch(
  /selectedKeys\.includes\("settings"\)[\s\S]*applySyncSettingsToModal\(defaultSettings\);/,
  "重置设置后未通过统一 helper 恢复同步设置默认值。"
);
expectMatch(
  /buildSyncSettingsFromModal\s*=\s*\(\)\s*=>\s*\(\{[\s\S]*syncCheckOnReturnToForeground:\s*foregroundSyncCheckToggle\.checked,/,
  "保存设置时未从控件收集前台检查开关值。"
);
expectMatch(
  /syncCheckOnReturnToForeground/,
  "源码中未包含前台检查设置字段。"
);

console.log("[sync-settings-ui] Phase 2 sync settings wiring verified.");
