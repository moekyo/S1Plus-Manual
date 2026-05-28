#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { sourceCode } = require("./s1plus-test-helpers");

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const navbarSyncButtonBlock =
  sourceCode.match(
    /const updateNavbarSyncButton = \(\) => \{[\s\S]*?\n  \};\n\n  const ensureMyThreadsQuickLink/
  )?.[0] || "";

[
  [
    /<div class="s1p-sync-settings-section-title">手动同步<\/div>[\s\S]*导航栏同步按钮可点击或悬停打开“拉取 \/ 推送”菜单/,
    "同步设置页缺少手动同步分组或导航栏菜单说明。",
  ],
  [
    /id="s1p-manual-sync-section"[\s\S]*for="s1p-sync-bookmark-full-content-toggle">收藏回复同步完整正文/,
    "收藏回复完整正文开关未归入手动同步分组。",
  ],
  [
    /影响所有远程导出的收藏回复内容，包括自动推送/,
    "收藏回复完整正文说明未表达会影响自动推送。",
  ],
  [
    /<div class="s1p-sync-settings-section-title">自动推送<\/div>[\s\S]*for="s1p-auto-sync-enabled-toggle">本地变更后自动后台同步/,
    "自动后台同步未归入自动推送分组。",
  ],
  [
    /关闭后仍可手动推送\/拉取，也不影响自动拉取/,
    "自动推送说明未区分本地变更上传与自动拉取。",
  ],
  [
    /for="s1p-sync-device-id-input">同步设备 ID（自动推送必填）/,
    "同步设备 ID 未标记为自动推送必填。",
  ],
  [
    /开启自动推送时必填[\s\S]*留空则忽略，不会同步到其他设备，也不参与冲突裁决/,
    "同步设备 ID 说明文案未明确自动推送、local-only 与非决策语义。",
  ],
  [
    /<div class="s1p-sync-settings-section-title">自动拉取<\/div>/,
    "同步设置页缺少自动拉取分组。",
  ],
  [
    /决定何时主动查看云端是否有新数据；发现变化后仍会进入安全同步判断，不会直接覆盖本地/,
    "自动拉取说明未准确表达 probe 后仍需安全同步判断。",
  ],
  [
    /for="s1p-daily-first-load-sync-enabled-toggle">每日首次打开时同步/,
    "自动拉取分组缺少每日首次打开时同步开关。",
  ],
  [
    /for="s1p-force-pull-on-startup-toggle">启动时强制拉取/,
    "自动拉取分组缺少启动时强制拉取开关。",
  ],
  [
    /for="s1p-sync-auto-check-mode-control">检查策略/,
    "同步设置页缺少检查策略标签。",
  ],
  [
    /id="s1p-sync-auto-check-mode-control" class="s1p-segmented-control s1p-sync-auto-check-control" data-s1p-sync-control/,
    "同步设置页缺少检查策略分段控件。",
  ],
  [
    /data-value="off">关闭<\/div>[\s\S]*data-value="per_load">每次加载<\/div>[\s\S]*data-value="foreground">回到前台<\/div>/,
    "同步设置页缺少检查策略的三个选项。",
  ],
  [
    /id="s1p-sync-auto-check-mode-help-btn"[\s\S]*查看检查策略说明/,
    "同步设置页缺少检查策略说明问号按钮。",
  ],
  [
    /const SYNC_AUTO_CHECK_MODE_HELP_TOOLTIP_CONFIG = Object\.freeze\(\{[\s\S]*templateId:\s*SYNC_AUTO_CHECK_MODE_TOOLTIP_TEMPLATE_ID,/,
    "检查策略说明未使用独立的 tooltip 配置。",
  ],
  [
    /关闭额外自动拉取检查；每日首次同步、手动同步和自动推送仍按各自开关运行/,
    "检查策略说明未说明关闭模式不影响其他同步入口。",
  ],
  [
    /持续可见页面的低频复查由同组子开关控制/,
    "检查策略说明未标明可见页低频复查是同组子开关。",
  ],
  [
    /const resolveSyncAutoCheckModeValue = \(settingsSnapshot = \{\}\) => \{[\s\S]*syncPerLoadCheckEnabled[\s\S]*syncCheckOnReturnToForeground/,
    "同步设置页缺少检查策略的回填映射 helper。",
  ],
  [
    /syncAutoCheckModeControl\.addEventListener\("click",[\s\S]*markSyncSettingsDirty\(\);/,
    "同步设置页切换检查策略时未标记为脏状态。",
  ],
  [
    /applySyncSettingsToModal\s*=\s*\(settingsSnapshot\)\s*=>\s*\{[\s\S]*setSyncAutoCheckModeControlValue\(\s*resolveSyncAutoCheckModeValue\(settingsSnapshot\)/,
    "同步设置页未通过统一 helper 回填检查策略控件。",
  ],
  [
    /for="s1p-visible-remote-polling-enabled-toggle">持续可见时低频复查/,
    "同步设置页缺少持续可见低频复查子开关。",
  ],
  [
    /syncVisibleRemotePollingEnabled:\s*visibleRemotePollingToggle\?\.checked === true/,
    "保存设置时未收集持续可见低频复查开关。",
  ],
  [
    /settingsSnapshot\.syncVisibleRemotePollingEnabled === true/,
    "同步设置页未回填持续可见低频复查开关。",
  ],
  [
    /const updateVisibleRemotePollingToggleState = \(\) => \{[\s\S]*isForegroundMode = getSyncAutoCheckModeControlValue\(\) === "foreground"[\s\S]*"s1p-hidden"[\s\S]*visibleRemotePollingToggle\.disabled = !isEnabled;/,
    "持续可见低频复查子开关未被回到前台模式门控并隐藏。",
  ],
  [
    /<div class="s1p-sync-settings-section-title">状态显示<\/div>[\s\S]*for="s1p-show-auto-sync-indicator-toggle">显示导航栏同步状态/,
    "同步状态指示器未归入状态显示分组。",
  ],
  [
    /只影响导航栏状态提示，不改变同步行为；会覆盖每日首次、每次加载、前台复查、可见页复查、后台同步和手动同步/,
    "同步状态指示器说明未表达其独立展示语义。",
  ],
  [
    /id="s1p-auto-sync-indicator-subgroup"[\s\S]*id="s1p-title-sync-status-subgroup"[\s\S]*for="s1p-show-title-sync-status-toggle">显示标签页标题同步状态/,
    "标题同步状态开关未位于导航栏同步状态开关之后。",
  ],
  [
    /开启后，仅当所有 S1 标签页都不在前台时，最近离开的 S1 标签页标题会在本地推送或同步冲突时显示状态提示（同步中\/成功\/失败\/冲突）。/,
    "标题同步状态开关说明文案不符合预期。",
  ],
  [
    /<div class="s1p-sync-settings-section-title">GitHub 连接<\/div>[\s\S]*for="s1p-remote-gist-id-input">Gist ID[\s\S]*for="s1p-remote-pat-input">GitHub Personal Access Token \(PAT\)/,
    "GitHub 连接分组缺少 Gist ID 或 PAT。",
  ],
  [
    /for="s1p-token-expiry-reminder-toggle">Token 过期提醒/,
    "Token 过期提醒未归入 GitHub 连接分组。",
  ],
  [
    /titleSyncStatusToggle:\s*modal\.querySelector\("#s1p-show-title-sync-status-toggle"\)/,
    "标题同步状态开关未接入同步设置控件集合。",
  ],
  [
    /const updateTitleSyncStatusToggleState = \(\) => \{[\s\S]*titleSyncStatusToggle\.disabled = !isEnabled;/,
    "标题同步状态开关未随远程同步总开关置灰。",
  ],
  [
    /syncShowTitleSyncStatus:\s*titleSyncStatusToggle\.checked/,
    "保存设置时未收集标题同步状态开关。",
  ],
  [
    /settingsSnapshot\.syncShowTitleSyncStatus === true/,
    "同步设置页未回填标题同步状态开关。",
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
    "检查策略说明按钮仍未绑定到独立 tooltip 模板。",
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
    "保存设置时未从新的检查策略控件收集值。",
  ],
  [
    /id="s1p-manual-sync-section"[\s\S]*id="s1p-auto-push-section"[\s\S]*id="s1p-auto-pull-section"[\s\S]*id="s1p-sync-status-section"[\s\S]*id="s1p-github-connection-section"/,
    "同步设置页未按手动同步、自动推送、自动拉取、状态显示、GitHub 连接重排。",
  ],
  [
    /const openSyncChoiceMenu = \(\) => \{[\s\S]*callback: handleForcePull[\s\S]*callback: handleForcePush[\s\S]*a\.addEventListener\("click", \(e\) => \{[\s\S]*openSyncChoiceMenu\(\);[\s\S]*li\.addEventListener\("mouseenter", openSyncChoiceMenu\);/,
    "导航栏同步按钮点击和悬停未共用推送/拉取菜单。",
  ],
].forEach(([pattern, message]) => {
  expectMatch(pattern, message);
});

assert.ok(
  navbarSyncButtonBlock,
  "未能定位导航栏同步按钮渲染代码块。"
);
assert.doesNotMatch(
  navbarSyncButtonBlock,
  /handleManualSync/,
  "导航栏同步按钮点击路径不应再调用手动安全仲裁。"
);

[
  [
    /syncDirectChoiceMode|directChoiceModeToggle|s1p-direct-choice-mode-toggle/,
    "废弃的手动同步高级模式设置仍存在。",
  ],
  [
    /手动同步高级模式|点击同步按钮将智能判断|智能同步/,
    "同步设置或手动流程仍暴露旧的智能同步/高级模式文案。",
  ],
  [
    /<div class="s1p-sync-settings-section-title">云端更新检查<\/div>/,
    "同步设置页仍使用旧的云端更新检查分组名。",
  ],
  [
    /<div class="s1p-sync-settings-section-title">自动上传本地变更<\/div>/,
    "同步设置页仍使用旧的自动上传本地变更分组名。",
  ],
  [
    /<div class="s1p-sync-settings-section-title">手动同步与数据选项<\/div>/,
    "同步设置页仍使用旧的手动同步与数据选项分组名。",
  ],
  [
    /选择一种自动检查方式：关闭、每次页面加载时检查，或仅在标签页回到前台时检查。上方“每日首次加载时同步”仍为独立开关。/,
    "自动检查模式下方的冗余说明文案未移除。",
  ],
  [
    /for="s1p-show-auto-sync-indicator-toggle">显示自动同步状态指示器/,
    "自动同步指示器仍使用旧文案。",
  ],
  [
    /for="s1p-auto-sync-enabled-toggle">启用自动后台同步/,
    "自动后台同步仍使用旧文案。",
  ],
  [
    /for="s1p-sync-auto-check-mode-control">自动检查云端更新/,
    "检查策略仍使用旧的总标题文案。",
  ],
  [
    /s1p-sync-toast-debug-panel|data-s1p-sync-toast-debug|同步提示调试（临时）/,
    "用于验证 toast 的临时调试面板未移除。",
  ],
].forEach(([pattern, message]) => {
  assert.doesNotMatch(sourceCode, pattern, message);
});

console.log("[sync-settings-ui] Sync settings restructure verified.");
