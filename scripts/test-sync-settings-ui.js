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
  /for="s1p-sync-auto-check-mode-control">自动检查云端更新/,
  "同步设置页缺少新的自动检查模式标签。"
);
expectMatch(
  /id="s1p-sync-auto-check-mode-control" class="s1p-segmented-control s1p-sync-auto-check-control" data-s1p-sync-control/,
  "同步设置页缺少新的自动检查模式分段控件。"
);
expectMatch(
  /id="s1p-sync-auto-check-mode-help-btn"[\s\S]*查看自动检查方式说明/,
  "同步设置页缺少自动检查模式说明问号按钮。"
);
expectMatch(
  /const SYNC_AUTO_CHECK_MODE_HELP_TOOLTIP_CONFIG = Object\.freeze\(\{[\s\S]*templateId:\s*SYNC_AUTO_CHECK_MODE_TOOLTIP_TEMPLATE_ID,/,
  "自动检查模式说明未使用独立的 tooltip 配置。"
);
expectMatch(
  /页面持续可见时[\s\S]*低频复查/,
  "自动检查模式说明未覆盖可见页低频轮询的实际行为。"
);
expectMatch(
  /const resolveSyncAutoCheckModeValue = \(settingsSnapshot = \{\}\) => \{[\s\S]*syncPerLoadCheckEnabled[\s\S]*syncCheckOnReturnToForeground/,
  "同步设置页缺少自动检查模式的回填映射 helper。"
);
expectMatch(
  /syncAutoCheckModeControl\.addEventListener\("click",[\s\S]*markSyncSettingsDirty\(\);/,
  "同步设置页切换自动检查模式时未标记为脏状态。"
);
expectMatch(
  /applySyncSettingsToModal\s*=\s*\(settingsSnapshot\)\s*=>\s*\{[\s\S]*setSyncAutoCheckModeControlValue\(\s*resolveSyncAutoCheckModeValue\(settingsSnapshot\)/,
  "同步设置页未通过统一 helper 回填自动检查模式控件。"
);
expectMatch(
  /setTemplateTooltip\(\s*syncAutoCheckModeHelpBtn,\s*SYNC_AUTO_CHECK_MODE_HELP_TOOLTIP_TEXT,\s*SYNC_AUTO_CHECK_MODE_HELP_TOOLTIP_CONFIG\s*\)/,
  "自动检查模式说明按钮仍未绑定到独立 tooltip 模板。"
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
  /buildSyncSettingsFromModal\s*=\s*\(\)\s*=>\s*\{[\s\S]*const syncAutoCheckMode = getSyncAutoCheckModeControlValue\(\);[\s\S]*applySyncAutoCheckModeToSettings\(nextSettings, syncAutoCheckMode\);/,
  "保存设置时未从新的自动检查模式控件收集值。"
);
expectMatch(
  /data-value="off">关闭<\/div>[\s\S]*data-value="per_load">每次加载<\/div>[\s\S]*data-value="foreground">回到前台<\/div>/,
  "同步设置页缺少自动检查模式的三个选项。"
);
expectMatch(
  /s1p-daily-first-load-sync-enabled-toggle[\s\S]*id="s1p-force-pull-subgroup"[\s\S]*id="s1p-sync-auto-check-mode-control"/,
  "“启动时强制拉取云端数据”未作为“每日首次加载时同步”的子项显示在自动检查模式之前。"
);
assert.doesNotMatch(
  sourceCode,
  /选择一种自动检查方式：关闭、每次页面加载时检查，或仅在标签页回到前台时检查。上方“每日首次加载时同步”仍为独立开关。/,
  "自动检查模式下方的冗余说明文案未移除。"
);

console.log("[sync-settings-ui] Phase 2 sync settings wiring verified.");
