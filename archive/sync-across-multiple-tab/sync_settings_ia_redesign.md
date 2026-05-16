# 云端同步设置区功能梳理与 UI 重组方案

本文基于 `S1Plus.js` 当前实现反向梳理“设置同步”页中自动检查、自动后台同步、可见页复查和状态指示器的真实行为。目标是让设置文案和排布贴合代码语义，而不是只做视觉美化。

## 一、代码功能梳理表

| 当前设置项 | 配置字段 / 默认值 | 相关函数 / 触发点 | 实际行为 | 功能分类 | 发现的问题 |
| --- | --- | --- | --- | --- | --- |
| 自动检查云端更新 | 无单一字段；由 `syncPerLoadCheckEnabled` 默认 `false` 与 `syncCheckOnReturnToForeground` 默认 `true` 组合表达；存储于 `s1p_settings` | `resolveSyncAutoCheckModeValue()`、`applySyncAutoCheckModeToSettings()`、`buildNormalizedSettings()` | UI 上是一个三态策略控件；保存时写回两个布尔字段，归一化时若旧数据两个都为 true，则收敛为 `per_load` 优先 | 检查云端更新 | 名称像一个总开关，但真实含义是“额外检查策略”；容易与后台自动同步混淆 |
| 检查策略：关闭 / 每次加载 / 回到前台 | `off` => 两字段都 false；`per_load` => `syncPerLoadCheckEnabled=true`；`foreground` => `syncCheckOnReturnToForeground=true`；存储于 `s1p_settings` | `handlePerLoadSyncCheck()`、`handleInitialForegroundRemoteFreshnessCheck()`、`triggerForegroundRemoteFreshnessProbe()`、`handlePendingAutoSyncRecoveryVisibilityChange()`、`handlePendingAutoSyncRecoveryPageShow()` | `per_load` 每次页面加载执行一次完整安全同步检查；`foreground` 在首次可见、回到前台、bfcache 恢复时先做 metadata-only probe，确认远端变更后才 follow-up safe sync；`off` 关闭这两类额外检查 | 检查云端更新；自动下载 / 合并云端数据的触发入口 | “回到前台”不是直接拉取；它先轻量探测，再复用安全同步决策。旧文案没有把 probe 与真正同步区分清楚 |
| 页面保持可见时低频检查云端更新 | `syncVisibleRemotePollingEnabled` 默认 `false`；存储于 `s1p_settings` | `isVisibleRemoteFreshnessPollingEnabled()`、`scheduleVisibleRemoteFreshnessPolling()`、`syncVisibleRemoteFreshnessPollingForCurrentState()`、`handleVisibleRemoteFreshnessUserActivity()`；由 `bindPendingAutoSyncRecoveryHooks()`、设置保存和跨标签刷新同步运行状态 | 仅在远程同步配置完整且 `syncCheckOnReturnToForeground=true` 时生效；页面一直可见时，活跃约 4 分钟、空闲约 12 分钟调用同一套 foreground metadata probe | 高级优化选项；检查云端更新的子行为 | 不是独立检查模式，必须是“回到前台”策略的高级子项；平铺时会让用户误以为它可独立工作 |
| 显示自动同步状态指示器 | `syncShowAutoSyncIndicator` 默认 `true`；存储于 `s1p_settings` | `hasEnabledAutoSyncIndicatorPath()`、`renderNavbarAutoSyncIndicator()`、`getAutoSyncIndicatorTitle()`、`startAutoSyncIndicatorCycle()` | 在导航栏展示自动/手动同步状态；覆盖每日首次、每次加载、首次可见、回到前台、可见页轮询、后台同步和手动同步；不改变同步行为 | 状态展示 | 旧位置靠近后台自动同步，容易被理解为“后台同步的子开关”；实际是全局状态展示 |
| 启用自动后台同步 | `syncAutoEnabled` 默认 `true`；存储于 `s1p_settings` | `updateLastModifiedTimestamp()`、`debouncedTriggerRemoteSyncPush()`、`requestBackgroundSyncRun()`、`triggerRemoteSyncPush()`、`performAutoSync(false, SYNC_LOCK_MODE_BACKGROUND)`、`recoverPendingAutoSyncIfNeeded()` | 本地配置/数据变更后写 `s1p_last_modified` 与 pending request，按普通数据约 5 秒、阅读进度约 20 秒防抖后后台执行智能同步；主要处理本地变更上传，也可能因版本判断进入安全拉取/阅读进度合并 | 自动上传本地变更；自动下载 / 合并云端数据的安全执行路径 | 名称中的“自动同步”容易与“自动检查云端更新”混为一谈；它不是轮询云端，而是本地变更驱动 |
| 每日首次打开时同步（相邻项） | `syncDailyFirstLoad` 默认 `true`；存储于 `s1p_settings` | `handleStartupSync()`、`runStartupModeAutoSyncCheckWithIndicator()`、`runStartupSyncFlowDeferred()` | 每天第一次打开论坛时执行一次启动期安全同步检查；独立于额外检查策略 | 检查云端更新；自动下载 / 合并云端数据 | 是云端更新检查的一种启动期入口，应与检查策略放在同组但保持独立开关 |
| 启动时强制拉取云端数据（相邻项） | `syncForcePullOnStartup` 默认 `false`；存储于 `s1p_settings`，归一化时要求 `syncDailyFirstLoad=true` | `buildNormalizedSettings()`、`performAutoSync()` 启动分支 | 仅作用于每日首次打开时同步；启用后启动期检测到不一致会优先用云端覆盖本地 | 自动下载云端数据；高级风险选项 | 必须作为每日首次同步的子项，不能与普通检查策略平级 |

## 二、关系分析

- `syncRemoteEnabled`、`syncRemoteGistId`、`syncRemotePat` 是远程同步总前提。关闭远程同步或缺少凭据时，自动检查、后台同步、状态指示器都不能实际工作。
- `syncPerLoadCheckEnabled` 与 `syncCheckOnReturnToForeground` 不是平级开关，而是一个互斥策略的两个存储位。当前归一化逻辑已经把旧版“双开”状态收敛为 `per_load`。
- `syncVisibleRemotePollingEnabled` 是 `syncCheckOnReturnToForeground` 的子项。运行时必须同时满足 foreground 策略和自身开关，不能独立于 foreground 工作。
- `syncAutoEnabled` 与“检查策略”独立。前者由本地变更触发后台上传/智能同步，后者由页面生命周期触发云端检查。
- `syncShowAutoSyncIndicator` 与所有同步行为独立，只负责展示。它不应该放在“自动后台同步”下面。
- `syncDailyFirstLoad` 与“检查策略”同属“云端更新检查”，但不是同一个策略控件。它是每日启动期检查，检查策略是额外检查。
- `syncForcePullOnStartup` 是 `syncDailyFirstLoad` 的风险子项，父项关闭时应禁用并最终归一化为 false。

## 三、推荐的新设置结构

- 云端更新检查
  - 每日首次打开时同步
  - 启动时强制拉取云端数据
  - 检查策略：关闭 / 每次加载 / 回到前台
  - 持续可见时低频复查（仅“回到前台”策略下显示）
- 自动上传本地变更
  - 本地变更后自动后台同步
- 状态显示
  - 显示导航栏同步状态
- 手动同步与数据选项
  - 手动同步高级模式
  - 收藏回复同步完整正文
  - 同步设备 ID
- GitHub 连接
  - Gist ID
  - PAT
  - Token 更新提醒

## 四、推荐 UI 文案和控件

| 显示位置 | 新标题 | 说明文字 | 控件类型 | 字段映射 |
| --- | --- | --- | --- | --- |
| 云端更新检查 | 每日首次打开时同步 | 每天第一次打开论坛时执行一次安全同步检查；关闭后不会再隐式切换为“每次加载”。 | Switch | `syncDailyFirstLoad` |
| 云端更新检查 / 子项 | 启动时强制拉取云端数据 | 仅作用于每日首次打开时同步；若云端与本地不一致，将直接用云端覆盖本地。请谨慎开启。 | Switch | `syncForcePullOnStartup` |
| 云端更新检查 | 检查策略 | 这是每日首次同步之外的额外检查：可完全关闭，也可选择每次页面加载检查，或仅在页面首次可见、回到前台、后退缓存恢复时轻量探测。 | Segmented control | `syncPerLoadCheckEnabled` / `syncCheckOnReturnToForeground` |
| 云端更新检查 / 高级子项 | 持续可见时低频复查 | 仅在“回到前台”策略下生效；页面一直保持可见时，活跃约 4 分钟、空闲约 12 分钟轻量探测一次云端。 | Switch | `syncVisibleRemotePollingEnabled` |
| 自动上传本地变更 | 本地变更后自动后台同步 | 启用后，屏蔽、标记、阅读进度等本地数据变化会在停止操作后自动上传或合并；关闭后仍可手动同步，也不影响上方云端更新检查。 | Switch | `syncAutoEnabled` |
| 状态显示 | 显示导航栏同步状态 | 只影响导航栏状态提示，不改变同步行为；会覆盖每日首次、每次加载、前台复查、可见页复查、后台同步和手动同步。 | Switch | `syncShowAutoSyncIndicator` |

## 五、交互规则

- 关闭“启用远程同步”：远程同步区域整体禁用，但“保存设置”按钮保持可用；已填入的 Gist/PAT 和子设置值保留。
- 关闭“每日首次打开时同步”：禁用“启动时强制拉取云端数据”；保存时 `syncForcePullOnStartup` 按现有逻辑写为 false。
- 检查策略选择“关闭”：写入 `syncPerLoadCheckEnabled=false`、`syncCheckOnReturnToForeground=false`；隐藏“持续可见时低频复查”，但保留其勾选值，便于用户切回 foreground 时恢复。
- 检查策略选择“每次加载”：写入 `syncPerLoadCheckEnabled=true`、`syncCheckOnReturnToForeground=false`；隐藏“持续可见时低频复查”。
- 检查策略选择“回到前台”：写入 `syncPerLoadCheckEnabled=false`、`syncCheckOnReturnToForeground=true`；显示“持续可见时低频复查”。
- 关闭“本地变更后自动后台同步”：只停止本地变更驱动的后台同步，不影响每日首次同步、每次加载检查、前台探测和手动同步。
- 关闭“显示导航栏同步状态”：只移除导航栏指示器，不影响任何同步、检查、拉取或上传逻辑。
- 旧数据中若 `syncPerLoadCheckEnabled` 与 `syncCheckOnReturnToForeground` 同时为 true，保持现有归一化策略：`per_load` 优先。

## 六、实现建议

- 复用现有字段，不新增配置：`syncPerLoadCheckEnabled`、`syncCheckOnReturnToForeground`、`syncVisibleRemotePollingEnabled`、`syncAutoEnabled`、`syncShowAutoSyncIndicator` 足够表达当前功能。
- UI 层保留 `resolveSyncAutoCheckModeValue()` 与 `applySyncAutoCheckModeToSettings()`，继续用互斥策略控件映射两个布尔字段。
- `updateVisibleRemotePollingToggleState()` 应同时负责隐藏/显示和禁用/启用“持续可见时低频复查”，避免它看起来像独立模式。
- `updateForcePullState()` 应同时检查远程同步总开关和每日首次同步父开关，避免总开关打开/关闭后子项状态错位。
- 设置迁移不需要新增数据迁移；但 `migrateLegacySettingsIfNeeded()` 必须强制写回清理后的设置，否则被删除的旧字段会因为 `saveSettings()` 的相等短路而在每次加载时重复触发迁移。
- 需要修改/关注的代码位置：
  - `defaultSettings` 与 `buildNormalizedSettings()`
  - `migrateLegacySettingsIfNeeded()`、`saveSettings()`
  - `createManagementModal()` 中的 `buildSyncSettingsTabHtml()`
  - `resolveSyncAutoCheckModeValue()`、`applySyncAutoCheckModeToSettings()`
  - `updateVisibleRemotePollingToggleState()`、`updateForcePullState()`
  - `handlePerLoadSyncCheck()`、`checkRemoteFreshnessOnForeground()`、`scheduleVisibleRemoteFreshnessPolling()`、`triggerRemoteSyncPush()`
- 回归脚本至少覆盖：
  - `node --check S1Plus.js`
  - `node sync-across-multiple-tab/scripts/test-settings-migration.js`
  - `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
