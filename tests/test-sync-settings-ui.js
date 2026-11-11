#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { sourceCodeWithResources: sourceCode } = require("./s1plus-test-helpers");

const expectMatch = (pattern, message) => {
  assert.match(sourceCode, pattern, message);
};

const navbarSyncButtonBlock =
  sourceCode.match(
    /const updateNavbarSyncButton = \(\) => \{[\s\S]*?\n  \};\n\n  const ensureMyThreadsQuickLink/
  )?.[0] || "";

[
  [
    /<div class="s1p-sync-settings-section-title">手动同步<\/div>[\s\S]*导航栏同步按钮可点击或悬停打开“拉取 \/ 推送”菜单：两个方向都会先比较云端与本地[\s\S]*不会直接覆盖任何一端/,
    "同步设置页缺少手动同步分组或导航栏菜单的安全比较说明。",
  ],
  [
    /id="s1p-sync-override-block"[\s\S]*覆盖式操作（危险）[\s\S]*不比较、不合并[\s\S]*id="s1p-force-push-btn"[^>]*>强制推送（覆盖云端）<\/button>[\s\S]*id="s1p-force-pull-btn"[^>]*>强制拉取（覆盖本地）<\/button>/,
    "覆盖式强制推送/拉取未移动到设置页并标注危险语义。",
  ],
  [
    /e\.target\.id === "s1p-force-push-btn" \|\|[\s\S]*e\.target\.id === "s1p-force-pull-btn"/,
    "设置页覆盖式操作按钮未绑定处理器。",
  ],
  [
    /覆盖云端备份？[\s\S]*会把当前本地数据整体覆盖到云端，不比较、不合并；云端独有的阅读进度等数据将直接丢失，且不可撤销。[\s\S]*强制推送，覆盖云端/,
    "设置页强制推送确认弹窗未写清不比较、不合并与数据丢失。",
  ],
  [
    /强制拉取到本地？[\s\S]*会用云端备份整体覆盖本地数据，不比较、不合并；本地独有的阅读进度等数据将直接丢失，且不可撤销。[\s\S]*强制拉取，覆盖本地/,
    "设置页强制拉取确认弹窗未写清不比较、不合并与数据丢失。",
  ],
  [
    /会把此刻的本地数据整体覆盖到云端，不比较、不合并；云端独有的阅读进度等数据将丢失，且不可撤销。[\s\S]*会用云端备份整体覆盖本地数据，不比较、不合并；本地独有的阅读进度等数据将丢失，且不可撤销。/,
    "排队中的覆盖式请求确认弹窗未写清不比较、不合并与数据丢失。",
  ],
  [
    /confirmationActions\.onSwitchToGlobalSync[\s\S]*requestGlobalManualSync\(\)/,
    "排队中的覆盖式请求确认弹窗缺少改用全局同步的出口。",
  ],
  [
    /text: "改用全局同步"[\s\S]*void runSettingsManualSync\(\);/,
    "覆盖式操作确认弹窗缺少改用全局同步的出口。",
  ],
  [
    /void \(isForcePush \? handleForcePush\(\) : handleForcePull\(\)\);/,
    "设置页覆盖式操作未调用强制推送/强制拉取处理器。",
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
    /syncAutoCheckModeControl\.addEventListener\("click",[\s\S]*markSyncSettingsDirty\(\);/,
    "同步设置页切换检查策略时未标记为脏状态。",
  ],
  [
    /for="s1p-visible-remote-polling-enabled-toggle">持续可见时低频复查/,
    "同步设置页缺少持续可见低频复查子开关。",
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
    /syncSettingsControls = \{[\s\S]*syncDeviceIdInput: modal\.querySelector\("#s1p-sync-device-id-input"\)/,
    "同步设备 ID 输入框未接入同步设置控件集合。",
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
    /id="s1p-manual-sync-section"[\s\S]*id="s1p-auto-push-section"[\s\S]*id="s1p-auto-pull-section"[\s\S]*id="s1p-sync-status-section"[\s\S]*id="s1p-github-connection-section"/,
    "同步设置页未按手动同步、自动推送、自动拉取、状态显示、GitHub 连接重排。",
  ],
  [
    /const openSyncChoiceMenu = \(\) => \{[\s\S]*kind:\s*"manual_sync",\s*options:\s*\{ preferredDirection: "pull" \},[\s\S]*kind:\s*"manual_sync",\s*options:\s*\{ preferredDirection: "push" \},[\s\S]*a\.addEventListener\("click", \(e\) => \{[\s\S]*openSyncChoiceMenu\(\);[\s\S]*li\.addEventListener\("mouseenter", openSyncChoiceMenu\);/,
    "导航栏同步按钮点击和悬停未共用安全比较菜单。",
  ],
].forEach(([pattern, message]) => {
  expectMatch(pattern, message);
});

assert.ok(
  navbarSyncButtonBlock,
  "未能定位导航栏同步按钮渲染代码块。"
);
assert.match(
  navbarSyncButtonBlock,
  /kind:\s*"manual_sync"/,
  "导航栏同步按钮必须走安全比较流程。"
);
assert.doesNotMatch(
  navbarSyncButtonBlock,
  /kind:\s*"manual_(pull|push)"/,
  "导航栏同步按钮不得再直接触发覆盖式强制拉取/推送。"
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

// --- 局域网同步（LAN Hub）设置页 UI -----------------------------------------
[
  [
    /id="s1p-github-connection-section"[\s\S]*id="s1p-lan-sync-section"[\s\S]*<div class="s1p-notice">/,
    "局域网同步分组未位于 GitHub 连接之后、通知区之前。",
  ],
  [
    /<div class="s1p-sync-settings-section(?: [^"]*)?" id="s1p-lan-sync-section">[\s\S]*<div class="s1p-sync-settings-section-title">局域网同步（LAN Hub）<\/div>/,
    "同步设置页缺少局域网同步分组标题。",
  ],
  [
    /for="s1p-lan-sync-enabled-toggle">启用局域网同步[\s\S]*id="s1p-lan-sync-enabled-toggle" class="s1p-settings-checkbox" data-s1p-sync-control/,
    "局域网同步总开关未接入同步控件门控。",
  ],
  [
    /for="s1p-lan-sync-url-input">Hub 地址[\s\S]*id="s1p-lan-sync-url-input" class="s1p-input s1p-input-full" placeholder="http:\/\/NAS_IP:5180"[^>]*data-s1p-sync-control/,
    "Hub 地址输入框缺失或未接入同步控件门控。",
  ],
  [
    /for="s1p-lan-sync-token-input">Hub 令牌 \(HUB_TOKEN\)[\s\S]*id="s1p-lan-sync-token-input" class="s1p-input s1p-input-with-right-icon"[^>]*data-s1p-sync-control[\s\S]*id="s1p-toggle-lan-token-visibility" type="button" class="s1p-icon-btn-overlay"[\s\S]*\{\{SVG_ICON_EYE\}\}/,
    "Hub 令牌密码框或眼睛显示切换按钮缺失。",
  ],
  [
    /id="s1p-lan-sync-test-btn"[^>]*data-s1p-sync-control>测试连接<\/button>[\s\S]*id="s1p-lan-sync-status"[^>]*role="status" aria-live="polite"/,
    "测试连接按钮或状态输出区域缺失。",
  ],
  [
    /开启后自动同步会优先走局域网 Hub，比 GitHub Gist 更快；GitHub Gist 保留为手动备份与跨网兜底，关闭后完全回到 Gist/,
    "局域网同步说明未表达 Hub 优先、Gist 兜底与关闭后回到 Gist。",
  ],
  [
    /Hub 地址与令牌只保存在本浏览器，不会写入同步数据/,
    "局域网同步说明未表达地址与令牌仅保存在本浏览器。",
  ],
  [
    /测试连接会依次请求 \/health 与 \/snapshot，校验地址与令牌/,
    "测试连接说明未表达 /health 与 /snapshot 校验。",
  ],
  [
    /lanSyncEnabledToggle: modal\.querySelector\("#s1p-lan-sync-enabled-toggle"\)[\s\S]*lanSyncUrlInput: modal\.querySelector\("#s1p-lan-sync-url-input"\)[\s\S]*lanSyncTokenInput: modal\.querySelector\("#s1p-lan-sync-token-input"\)[\s\S]*lanTokenVisibilityBtn: modal\.querySelector\(\s*"#s1p-toggle-lan-token-visibility"\s*\)[\s\S]*lanSyncTestBtn: modal\.querySelector\("#s1p-lan-sync-test-btn"\)[\s\S]*lanSyncStatus: modal\.querySelector\("#s1p-lan-sync-status"\)/,
    "局域网同步控件未完整接入 syncSettingsControls。",
  ],
  [
    /const applySyncSettingsToModal = \(settingsSnapshot\) => \{[\s\S]*projectLanSyncSettings\(settingsSnapshot\)[\s\S]*lanSyncEnabledToggle\.checked = lanProjection\.enabled[\s\S]*lanSyncUrlInput\.value = lanProjection\.url[\s\S]*lanSyncTokenInput\.value = lanProjection\.token/,
    "打开设置或跨标签刷新时未回填局域网同步设置。",
  ],
  [
    /const buildSyncSettingsFromModal = \(\) =>[\s\S]*syncLanEnabled:[\s\S]*syncLanUrl:[\s\S]*syncLanToken:/,
    "保存同步设置时未收集局域网同步三个设置项。",
  ],
  [
    /const validateLanSyncSettingsForSave = \(settingsSnapshot\) => \{[\s\S]*settingsSnapshot\.syncLanEnabled !== true[\s\S]*test\(normalizedUrl\)[\s\S]*Hub 令牌（HUB_TOKEN）[\s\S]*return false;/,
    "局域网同步保存校验未在开启时校验 URL scheme 与令牌。",
  ],
  [
    /e\.target\.id === "s1p-remote-save-btn"[\s\S]*validateLanSyncSettingsForSave\(currentSettings\)[\s\S]*saveSettings\(currentSettings/,
    "保存按钮未在写入前校验局域网同步配置。",
  ],
  [
    /bindDirtyListenerForTextInput\(lanSyncUrlInput\);[\s\S]*bindDirtyListenerForTextInput\(lanSyncTokenInput\);/,
    "局域网同步 URL/令牌输入未绑定脏状态监听。",
  ],
  [
    /lanSyncEnabledToggle,\s*\]\.forEach\(\(toggleControl\) =>[\s\S]*markSyncSettingsDirty/,
    "局域网同步开关未绑定脏状态监听。",
  ],
  [
    /if \(lanSyncTestBtn\) \{[\s\S]*lanSyncTestBtn\.addEventListener\("click", \(\) => \{[\s\S]*void testLanSyncConnection\(\);/,
    "测试连接按钮未绑定处理器。",
  ],
  [
    /e\.target\.closest\("#s1p-toggle-lan-token-visibility"\)[\s\S]*input\.type = "text"[\s\S]*setSanitizedIconHtml\(lanTokenVisibilityBtn, SVG_ICON_EYE_SLASH\)[\s\S]*input\.type = "password"[\s\S]*setSanitizedIconHtml\(lanTokenVisibilityBtn, SVG_ICON_EYE\)/,
    "Hub 令牌显示切换未复用 PAT 的密码框/图标切换行为。",
  ],
  [
    /const LAN_TEST_CONNECTION_TIMEOUT_MS = 8000;/,
    "测试连接未使用 8 秒超时。",
  ],
  [
    /id="s1p-github-connection-section">[\s\S]*data-s1p-sync-section-toggle="github" aria-expanded="true"[\s\S]*data-s1p-sync-section-body="github"/,
    "GitHub 连接分组未实现默认展开的折叠结构。",
  ],
  [
    /id="s1p-lan-sync-section">[\s\S]*data-s1p-sync-section-toggle="lan" aria-expanded="false"[\s\S]*data-s1p-sync-section-body="lan" hidden/,
    "局域网同步分组未默认折叠。",
  ],
  [
    /data-s1p-sync-section-body="lan" hidden[\s\S]*id="s1p-lan-sync-enabled-toggle"/,
    "局域网同步总开关未被放进折叠体，收起分组时仍会露在外面。",
  ],
  [
    /const setSyncSettingsSectionExpanded = \(sectionName, expanded\) => \{[\s\S]*aria-expanded[\s\S]*body\.hidden = !nextExpanded/,
    "折叠分组的展开/收起逻辑缺失。",
  ],
  [
    /const updateLanSyncSectionInputsState = \(\) => \{[\s\S]*lanSyncUrlInput\.disabled = !enabled[\s\S]*lanSyncTokenInput\.disabled = !enabled/,
    "局域网关闭时未禁用 Hub 地址与令牌输入框。",
  ],
  [
    /lanSyncEnabledToggle\.addEventListener\("change",[\s\S]*lanSyncEnabledToggle\.checked === true[\s\S]*setSyncSettingsSectionExpanded\(\s*"lan",\s*true\s*\)/,
    "局域网开关开启时未自动展开分组。",
  ],
].forEach(([pattern, message]) => {
  expectMatch(pattern, message);
});

const lanSectionStart = sourceCode.indexOf('id="s1p-lan-sync-section"');
const lanSectionEnd = sourceCode.indexOf('<div class="s1p-notice">', lanSectionStart);
const lanSectionHtml = sourceCode.slice(lanSectionStart, lanSectionEnd);
assert.ok(
  lanSectionHtml.indexOf('data-s1p-sync-section-body="lan"') <
    lanSectionHtml.indexOf('id="s1p-lan-sync-enabled-toggle"'),
  "局域网同步总开关必须位于折叠体内部，收起分组时随其他控件一起隐藏。"
);

// --- Gist 镜像（由 NAS 执行，脚本只做配置与状态展示） ----------------------
[
  [
    /id="s1p-gist-mirror-enabled-toggle"[\s\S]*id="s1p-gist-mirror-schedule-control" class="s1p-segmented-control[^"]*"[\s\S]*data-value="hourly"[\s\S]*data-value="every6h"[\s\S]*data-value="daily"[\s\S]*id="s1p-gist-mirror-hour-input"[\s\S]*>时<[\s\S]*id="s1p-gist-mirror-minute-input"[\s\S]*>分</,
    "Gist 镜像缺少启用开关、滑块式频率选择或时/分输入框。",
  ],
  [
    /\.s1p-time-part-group \{[\s\S]*?\.s1p-settings-item \.s1p-time-part-group \.s1p-time-part-input \{[^}]*width: 56px[^}]*text-align: center/,
    "时/分输入框未使用统一的窄输入样式。",
  ],
  [
    /const sanitizeGistMirrorTimePartInput = \(input, max\) => \{[\s\S]*replace\(\/\\D\/g, ""\)[\s\S]*Number\(digits\) > max/,
    "镜像时间输入未限制为数字并做上限收敛。",
  ],
  [
    /const validateGistMirrorTimeInputs = \(\) => \{[\s\S]*小时必须填写 0-23[\s\S]*分钟必须填写 0-59[\s\S]*小时必须在 0-23 之间[\s\S]*分钟必须在 0-59 之间/,
    "镜像时间输入缺少 0-23 / 0-59 区间校验。",
  ],
  [
    /const getGistMirrorScheduleValue = \(\) =>[\s\S]*getSegmentedControlValue\(gistMirrorScheduleControl/,
    "镜像频率未接入滑块式分段控件。",
  ],
  [
    /id="s1p-gist-mirror-save-btn"[\s\S]*id="s1p-gist-mirror-now-btn"[\s\S]*id="s1p-gist-mirror-status"[^>]*role="status" aria-live="polite"/,
    "Gist 镜像缺少保存、立即镜像按钮或状态区域。",
  ],
  [
    /data-s1p-sync-section-body="lan" hidden[\s\S]*id="s1p-gist-mirror-enabled-toggle"/,
    "Gist 镜像控件应位于局域网折叠体内。",
  ],
  [
    /const s1pFetchGistMirrorStatus = async \(\) => \{[\s\S]*path: "\/mirror"/,
    "脚本未从 NAS Hub 读取 Gist 镜像状态。",
  ],
  [
    /const s1pSaveGistMirrorConfig = async \(patch = \{\}\) => \{[\s\S]*path: "\/mirror\/config"/,
    "脚本未把镜像配置保存到 NAS Hub。",
  ],
  [
    /const s1pRunGistMirrorOnHub = async \(\) => \{[\s\S]*path: "\/mirror\/run"/,
    "脚本未调用 NAS Hub 的手动镜像接口。",
  ],
  [
    /const refreshGistMirrorPanel = async \(\) => \{[\s\S]*s1pFetchGistMirrorStatus\(\)[\s\S]*setGistMirrorControlsDisabled/,
    "设置页未加载或未禁用 NAS 镜像控件。",
  ],
  [
    /gistMirrorSaveBtn\.addEventListener\(\"click\"[\s\S]*saveGistMirrorConfigFromControls/,
    "保存镜像设置按钮未绑定处理器。",
  ],
  [
    /gistMirrorNowBtn\.addEventListener\(\"click\"[\s\S]*runGistMirrorOnHubFromControls/,
    "立即镜像按钮未绑定处理器。",
  ],
  [
    /setSyncSettingsSectionExpanded\("lan", isLanSyncSectionEnabled\(\)\);\s*\n\s*void refreshGistMirrorPanel\(\);/,
    "打开设置时未刷新 NAS 镜像状态。",
  ],
].forEach(([pattern, message]) => {
  expectMatch(pattern, message);
});

assert.doesNotMatch(
  sourceCode,
  /syncGistMirrorMode|s1pRunGistMirrorOnce|s1pScheduleGistMirror/,
  "Gist 镜像调度与合并逻辑应放在 NAS Hub，脚本里只保留配置与状态展示。"
);
assert.doesNotMatch(
  sourceCode,
  /id="s1p-gist-mirror-daily-time-input"/,
  "每天镜像时间应使用时/分输入框，不再使用原生 time 输入框。"
);
assert.doesNotMatch(
  sourceCode,
  /s1p-time-picker-popover|openGistMirrorTimePicker/,
  "每天镜像时间不应再使用弹层选择器。"
);

const lanTestConnectionBlock =
  sourceCode.match(
    /const testLanSyncConnection = async \(\) => \{[\s\S]*?\n    \};\n\n    const updateForcePullState/
  )?.[0] || "";
assert.ok(lanTestConnectionBlock, "未能定位局域网同步测试连接实现。");
assert.match(
  lanTestConnectionBlock,
  /url: `\$\{baseUrl\}\/health`/,
  "测试连接未请求 /health。"
);
assert.match(
  lanTestConnectionBlock,
  /url: `\$\{baseUrl\}\/snapshot`/,
  "测试连接未请求 /snapshot。"
);
assert.match(
  lanTestConnectionBlock,
  /Authorization: `Bearer \$\{token\}`/,
  "测试连接请求 /snapshot 时未携带 Bearer 令牌。"
);
assert.equal(
  (lanTestConnectionBlock.match(/timeout: LAN_TEST_CONNECTION_TIMEOUT_MS/g) || [])
    .length,
  2,
  "测试连接的 /health 与 /snapshot 请求应各使用 8 秒超时。"
);
assert.match(
  lanTestConnectionBlock,
  /连接成功：Hub 版本 v\$\{hubVersion\}，快照大小约 \$\{snapshotSizeKb\} KB/,
  "测试连接成功提示未包含 Hub 版本与快照大小。"
);
assert.match(
  lanTestConnectionBlock,
  /令牌无效，请检查 HUB_TOKEN/,
  "测试连接未区分 401 令牌无效。"
);
assert.match(
  lanTestConnectionBlock,
  /连接失败：\$\{describeLanTestRequestError\(error\)\}/,
  "测试连接未给出网络/超时失败原因。"
);
assert.match(
  lanTestConnectionBlock,
  /lanSyncTestBtn\.textContent = "测试中…"/,
  "测试连接期间未显示测试中状态。"
);
assert.doesNotMatch(
  lanTestConnectionBlock,
  /console\./,
  "测试连接实现不得在控制台输出令牌或请求详情。"
);

const attentionCssStart = sourceCode.indexOf(
  "/* NAS 镜像提示需要手动同步时"
);
const attentionCssEnd = sourceCode.indexOf(
  ".s1p-sync-textarea {",
  attentionCssStart
);
const attentionCssBlock =
  attentionCssStart >= 0 && attentionCssEnd > attentionCssStart
    ? sourceCode.slice(attentionCssStart, attentionCssEnd)
    : "";
assert.notEqual(
  attentionCssBlock.length,
  0,
  "缺少 NAS 镜像手动同步提示动画样式块。"
);

[
  [
    /\.s1p-manual-sync-attention\.is-playing\s*\{[\s\S]*?animation:\s*[\s\S]*?s1p-manual-sync-shake 0\.66s[^;]*,[\s\S]*?s1p-manual-sync-scale 2\.4s cubic-bezier\(0\.4, 0, 0\.2, 1\) 0\.36s/,
    "晃动与缩放应作为两条动画同时声明，缩放通过 0.36s 延迟与晃动重叠。",
  ],
  [
    /@keyframes s1p-manual-sync-shake\s*\{[\s\S]*?translate:\s*-3px 0;[\s\S]*?translate:\s*3px 0;/,
    "晃动关键帧应使用独立的 translate 属性，才能在缩放同时叠加。",
  ],
  [
    /@keyframes s1p-manual-sync-scale\s*\{[\s\S]*?scale:\s*1\.1;[\s\S]*?scale:\s*1;/,
    "缩放关键帧应使用独立的 scale 属性，才能与晃动同时叠加。",
  ],
  [
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.s1p-manual-sync-attention\s*\{[^}]*outline:/,
    "手动同步提示在 reduced-motion 下应改为静态描边提示。",
  ],
  [
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.s1p-manual-sync-attention\.is-playing\s*\{[^}]*animation:\s*none/,
    "手动同步提示动画缺少 reduced-motion 降级。",
  ],
  [
    /manualSyncButton\.classList\.add\("is-playing"\)/,
    "两段动画应通过同一个 is-playing 状态同时启动。",
  ],
  [
    /GIST_MIRROR_MANUAL_SYNC_ATTENTION_SCALE_DELAY_MS \+[\s\S]*?GIST_MIRROR_MANUAL_SYNC_ATTENTION_SCALE_MS \+[\s\S]*?120/,
    "手动同步提示缺少按“缩放延迟 + 缩放时长”计算的总时长兜底清理。",
  ],
  [
    /dataset\.s1pAttentionToken = attentionToken;[\s\S]*?clearAttention/,
    "手动同步提示缺少 token 去重清理。",
  ],
  [
    /const playGistMirrorManualSyncAttention = async \(status\) => \{[\s\S]*?modalBody\.scrollTo\(\{[\s\S]*?behavior: "smooth"/,
    "NAS 镜像需要手动同步时未自动滚动到“手动同步”按钮。",
  ],
  [
    /const runGistMirrorOnHubFromControls = async \(\) => \{[\s\S]*?s1pRunGistMirrorOnHub\(\)[\s\S]*?needsManualSyncAttention = status\?\.lastStatus === "conflict"[\s\S]*?onDismiss: \(\{ reason \}\) => \{[\s\S]*?reason === "replaced"[\s\S]*?playGistMirrorManualSyncAttention\(status\)/,
    "镜像结果提示消失后未触发手动同步提示动画（应在 toast 的 onDismiss 里触发）。",
  ],
].forEach(([pattern, message]) => assert.match(sourceCode, pattern, message));

const attentionShakeMsMatch = sourceCode.match(
  /const GIST_MIRROR_MANUAL_SYNC_ATTENTION_SHAKE_MS = (\d+);/
);
const attentionScaleDelayMsMatch = sourceCode.match(
  /const GIST_MIRROR_MANUAL_SYNC_ATTENTION_SCALE_DELAY_MS = (\d+);/
);
const attentionScaleMsMatch = sourceCode.match(
  /const GIST_MIRROR_MANUAL_SYNC_ATTENTION_SCALE_MS = (\d+);/
);
assert.ok(
  attentionShakeMsMatch && attentionScaleDelayMsMatch && attentionScaleMsMatch,
  "缺少晃动 / 缩放延迟 / 缩放时长常量。"
);
const attentionShakeMs = Number(attentionShakeMsMatch[1]);
const attentionScaleDelayMs = Number(attentionScaleDelayMsMatch[1]);
const attentionScaleMs = Number(attentionScaleMsMatch[1]);
assert.equal(attentionShakeMs, 660, "晃动时长应为 0.66s。");
assert.equal(attentionScaleDelayMs, 360, "缩放应在 0.36s 时启动。");
assert.equal(attentionScaleMs, 2400, "缩放时长应为 2.4s。");
assert.ok(
  attentionScaleDelayMs < attentionShakeMs,
  "缩放必须在晃动结束前启动，两段时间区间需要有重叠，避免动画割裂。"
);
assert.ok(
  attentionShakeMs - attentionScaleDelayMs >= 250,
  "两段动画的纯重叠时间至少应有约 0.25s。"
);

assert.doesNotMatch(
  attentionCssBlock,
  /box-shadow/,
  "手动同步提示动画不应使用光晕（box-shadow）。"
);

assert.equal(
  (sourceCode.match(/playGistMirrorManualSyncAttention/g) || []).length,
  2,
  "手动同步提示动画只应从“立即镜像到 Gist”的结果触发，不应在切换 tab / 普通刷新时播放。"
);

console.log("[sync-settings-ui] Sync settings restructure verified.");
