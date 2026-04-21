#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { sourceCode } = require("./s1plus-test-helpers");

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

[
  [
    /for="s1p-show-auto-sync-indicator-toggle">显示自动同步状态指示器/,
    "同步设置页未更新自动同步指示器的新文案。",
  ],
  [
    /id="s1p-auto-sync-indicator-subgroup" class="s1p-settings-sub-group s1p-settings-sub-group-flat"/,
    "自动同步指示器设置仍保留子项缩进样式。",
  ],
  [
    /包括每日首次、每次加载、页面首次可见\/回到前台检查后的自动同步，以及后台自动同步/,
    "自动同步指示器说明文案未覆盖统一联动语义。",
  ],
  [
    /for="s1p-sync-auto-check-mode-control">自动检查云端更新/,
    "同步设置页缺少新的自动检查模式标签。",
  ],
  [
    /id="s1p-sync-auto-check-mode-control" class="s1p-segmented-control s1p-sync-auto-check-control" data-s1p-sync-control/,
    "同步设置页缺少新的自动检查模式分段控件。",
  ],
  [
    /id="s1p-sync-auto-check-mode-help-btn"[\s\S]*查看自动检查方式说明/,
    "同步设置页缺少自动检查模式说明问号按钮。",
  ],
  [
    /const SYNC_AUTO_CHECK_MODE_HELP_TOOLTIP_CONFIG = Object\.freeze\(\{[\s\S]*templateId:\s*SYNC_AUTO_CHECK_MODE_TOOLTIP_TEMPLATE_ID,/,
    "自动检查模式说明未使用独立的 tooltip 配置。",
  ],
  [
    /页面持续可见时[\s\S]*低频复查/,
    "自动检查模式说明未覆盖可见页低频轮询的实际行为。",
  ],
  [
    /const resolveSyncAutoCheckModeValue = \(settingsSnapshot = \{\}\) => \{[\s\S]*syncPerLoadCheckEnabled[\s\S]*syncCheckOnReturnToForeground/,
    "同步设置页缺少自动检查模式的回填映射 helper。",
  ],
  [
    /syncAutoCheckModeControl\.addEventListener\("click",[\s\S]*markSyncSettingsDirty\(\);/,
    "同步设置页切换自动检查模式时未标记为脏状态。",
  ],
  [
    /applySyncSettingsToModal\s*=\s*\(settingsSnapshot\)\s*=>\s*\{[\s\S]*setSyncAutoCheckModeControlValue\(\s*resolveSyncAutoCheckModeValue\(settingsSnapshot\)/,
    "同步设置页未通过统一 helper 回填自动检查模式控件。",
  ],
  [
    /for="s1p-sync-device-id-input">同步设备 ID/,
    "同步设置页缺少同步设备 ID 标签。",
  ],
  [
    /id="s1p-sync-device-id-input" class="s1p-input s1p-input-full" placeholder="例如：MacBook-Pro-主力机"/,
    "同步设置页缺少同步设备 ID 输入框。",
  ],
  [
    /留空则忽略，不会同步到其他设备，也不参与冲突裁决/,
    "同步设备 ID 说明文案未明确 local-only 与非决策语义。",
  ],
  [
    /syncSettingsControls = \{[\s\S]*syncDeviceIdInput: modal\.querySelector\("#s1p-sync-device-id-input"\)/,
    "同步设备 ID 输入框未接入同步设置控件集合。",
  ],
  [
    /applySyncSettingsToModal\s*=\s*\(settingsSnapshot\)\s*=>\s*\{[\s\S]*syncDeviceIdInput\.value = settingsSnapshot\.syncDeviceId \|\| "";/,
    "同步设置页未回填同步设备 ID。",
  ],
  [
    /buildSyncSettingsFromModal\s*=\s*\(\)\s*=>\s*\{[\s\S]*syncDeviceId: syncDeviceIdInput\.value\.trim\(\),/,
    "保存设置时未收集同步设备 ID。",
  ],
  [
    /setTemplateTooltip\(\s*syncAutoCheckModeHelpBtn,\s*SYNC_AUTO_CHECK_MODE_HELP_TOOLTIP_TEXT,\s*SYNC_AUTO_CHECK_MODE_HELP_TOOLTIP_CONFIG\s*\)/,
    "自动检查模式说明按钮仍未绑定到独立 tooltip 模板。",
  ],
  [
    /const refreshSyncTabControlsFromSettings = \(\) => \{\s*applySyncSettingsToModal\(getSettings\(\)\);/m,
    "跨标签刷新时未通过统一 helper 回填同步设置。",
  ],
  [
    /selectedKeys\.includes\("settings"\)[\s\S]*applySyncSettingsToModal\(defaultSettings\);/,
    "重置设置后未通过统一 helper 恢复同步设置默认值。",
  ],
  [
    /buildSyncSettingsFromModal\s*=\s*\(\)\s*=>\s*\{[\s\S]*const syncAutoCheckMode = getSyncAutoCheckModeControlValue\(\);[\s\S]*applySyncAutoCheckModeToSettings\(nextSettings, syncAutoCheckMode\);/,
    "保存设置时未从新的自动检查模式控件收集值。",
  ],
  [
    /data-value="off">关闭<\/div>[\s\S]*data-value="per_load">每次加载<\/div>[\s\S]*data-value="foreground">回到前台<\/div>/,
    "同步设置页缺少自动检查模式的三个选项。",
  ],
  [
    /s1p-daily-first-load-sync-enabled-toggle[\s\S]*id="s1p-force-pull-subgroup"[\s\S]*id="s1p-sync-auto-check-mode-control"[\s\S]*id="s1p-auto-sync-indicator-subgroup"[\s\S]*id="s1p-auto-sync-enabled-toggle"/,
    "自动同步指示器设置未提升为自动后台同步之前的独立选项。",
  ],
].forEach(([pattern, message]) => {
  expectMatch(pattern, message);
});

[
  [
    /选择一种自动检查方式：关闭、每次页面加载时检查，或仅在标签页回到前台时检查。上方“每日首次加载时同步”仍为独立开关。/,
    "自动检查模式下方的冗余说明文案未移除。",
  ],
  [
    /s1p-sync-toast-debug-panel|data-s1p-sync-toast-debug|同步提示调试（临时）/,
    "用于验证 toast 的临时调试面板未移除。",
  ],
].forEach(([pattern, message]) => {
  assert.doesNotMatch(sourceCode, pattern, message);
});

console.log("[sync-settings-ui] Phase 2 sync settings wiring verified.");
