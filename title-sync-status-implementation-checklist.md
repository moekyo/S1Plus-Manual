# 标签页标题同步状态实现清单

本文是 [新增功能：标签页标题同步状态提示](./title-sync-status.md) 的落地清单。

- 需求文档负责说明目标、行为和边界。
- 本文负责记录具体实现步骤、测试项、验收项和实现进度。
- 实现过程中应更新本文 checkbox，而不是把施工细节继续塞回需求文档。

## 总原则

- 这是纯展示层功能。
- 不新增同步触发逻辑。
- 不修改远程同步流程。
- 不修改冲突处理逻辑。
- 不改变 `performAutoSync()` 裁决语义。
- 标题状态与导航栏状态共用统一状态源，但两个展示开关彼此独立。
- 只在所有 S1 标签页都不在前台时，由一个负责人标签页显示标题同步状态。

## Non-goals

- 不把标题提示做成新的同步调度器。
- 不复制一套独立同步状态判断。
- 不让标题提示影响导航栏状态显示。
- 不让导航栏状态开关控制标题状态。
- 不在多个位置无序直接写 `document.title`。
- 不依赖浏览器标签真实排列顺序选负责人。

## Phase 0: 准备与代码定位

- [x] 回读 `title-sync-status.md`。
- [x] 确认本轮只实现标题同步状态展示，不改同步核心。
- [x] 定位现有自定义标题后缀逻辑：
  - `resolveInterfaceTitleBase()`
  - `applyInterfaceCustomizations()`
  - `lastAppliedCustomTitleSuffix`
  - `document.title` 写入点
- [x] 定位统一状态源：
  - `AUTO_SYNC_INDICATOR_STATE_KEY`
  - `getAutoSyncIndicatorState()`
  - `resolveAutoSyncIndicatorDisplayPhase()`
  - `getAutoSyncIndicatorResolvedTtlMs()`
  - `initializeAutoSyncIndicatorCrossTabSync()`
- [x] 定位同步状态设置项 UI：
  - `syncShowAutoSyncIndicator`
  - “设置同步 -> 状态显示”区块
  - `test-sync-settings-ui.js`
- [x] 确认当前工作树是否有用户未提交改动，避免误改无关文件。

Phase 0 定位结果（2026-05-06）：

- 已回读标题同步状态需求、后台 shared scheduler review 和 shared scheduler 实现清单；确认 shared scheduler / 统一状态源增强已经完成，本轮标题功能只消费现有统一状态源。
- 现有自定义标题后缀仍由 `resolveInterfaceTitleBase()` / `applyInterfaceCustomizations()` 维护，`lastAppliedCustomTitleSuffix` 用于剥离旧后缀，当前 `document.title` 写入点仍在 `applyInterfaceCustomizations()` 内。
- 统一状态源入口已定位：`AUTO_SYNC_INDICATOR_STATE_KEY`、`getAutoSyncIndicatorState()`、`resolveAutoSyncIndicatorDisplayPhase()`、`getAutoSyncIndicatorResolvedTtlMs()` 和 `initializeAutoSyncIndicatorCrossTabSync()`；其中 display phase 已接入 shared debounce / pending / active lock / foreground probe 等状态。
- 同步状态设置 UI 已定位：“设置同步 -> 状态显示”区块当前只有 `syncShowAutoSyncIndicator`，对应测试为 `sync-across-multiple-tab/scripts/test-sync-settings-ui.js`。
- 本轮首次检查曾看到 `S1Plus.js` 和 `sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js` 处于已修改状态；本轮未编辑这两个文件。最终核对时，当前工作树只剩本轮新增/更新的标题状态测试与清单文件。

## Phase A: 测试先行

新增测试脚本：

```text
sync-across-multiple-tab/scripts/test-title-sync-status.js
```

覆盖标题组合：

- [x] 无同步状态时：标题为 `原始标题 + 自定义标题后缀`。
- [x] running 时：标题为 `[同步中.] 原始标题 + 自定义标题后缀`。
- [x] success 时：标题为 `[同步成功] 原始标题 + 自定义标题后缀`。
- [x] failure 时：标题为 `[同步失败] 原始标题 + 自定义标题后缀`。
- [x] conflict 时：标题为 `[冲突] 原始标题 + 自定义标题后缀`。
- [x] 重复刷新不会叠加多个同步状态前缀。
- [x] 自定义标题后缀更新后，前缀仍保留或按状态正确清除。

覆盖状态映射：

- [x] `idle` 不显示。
- [x] `pending` 不显示。
- [x] `running` 显示同步中动画。
- [x] `success` 显示 2 分钟。
- [x] `failure` 显示 5 分钟。
- [x] `conflict` 显示 10 分钟。
- [x] 前后台切换不重置结果状态 TTL。

覆盖多标签协调：

- [x] 单个 S1 标签页 visible 且 focused 时不显示。
- [x] 单个 S1 标签页 hidden 时可显示。
- [x] 单个 S1 标签页 visible 但 `document.hasFocus() === false` 时视为后台。
- [x] 多个 S1 标签页中任意一个前台时，所有标签页都不显示。
- [x] 所有 S1 标签页都后台时，只负责人标签页显示。
- [x] 非负责人标签页不启动动画 timer。
- [x] 负责人关闭后，其他标签页在 owner lease 过期后接管。
- [x] 超过 presence TTL 的标签页被忽略，不阻塞显示。

覆盖设置：

- [x] `syncShowTitleSyncStatus` 默认 `false`。
- [x] 关闭远程同步时，标题状态开关置灰。
- [x] 关闭标题状态开关后，标题恢复原样并停止动画 timer。
- [x] 关闭导航栏状态开关不影响标题状态。
- [x] 关闭标题状态开关不影响导航栏状态。
- [x] 设置项随设置同步。

Phase A 实现结果（2026-05-06）：

- 已新增 `sync-across-multiple-tab/scripts/test-title-sync-status.js`，以红灯测试形式锁定标题组合、状态前缀映射、统一状态源 TTL、多标签前后台协调、presence / owner lease、设置项默认值、UI 接线和导航栏/标题状态开关独立性。
- 测试脚本定义了后续实现需要暴露的窄范围测试钩子：`composeDocumentTitle()`、`stripLastAppliedTitleSyncStatusPrefix()`、`getTitleSyncStatusPrefixForPhase()`、`isTitleSyncStatusForegroundTab()`、`resolveTitleSyncStatusTabDisplayDecision()`、`hasEnabledTitleSyncStatusPath()`、`getTitleSyncStatusRuntimeStateForTest()` 和 `getTitleSyncStatusTestConstants()`。
- 本轮未实现标题同步状态功能、未新增 `syncShowTitleSyncStatus` 设置、未重构 `document.title` 写入路径、未接入多标签 presence / owner 逻辑；新增测试当前预期失败于缺少标题同步状态测试钩子和 Phase B+ 功能。
- 本轮未改 `performAutoSync()`，未改 shared scheduler，未新增同步触发逻辑，未在标题层处理同步状态抖动。
- 验证结果：`node -c S1Plus.js` 通过；`node sync-across-multiple-tab/scripts/test-title-sync-status.js` 失败 6/6 个测试组，失败点均为缺少 Phase B+ 将实现/暴露的标题同步状态测试钩子，符合 Phase A 红灯预期。

## Phase B: 设置项与 UI

- [x] 在默认设置中新增 `syncShowTitleSyncStatus: false`。
- [x] 在设置归一化 / 迁移路径中纳入 `syncShowTitleSyncStatus`。
- [x] 在设置保存路径中纳入 `syncShowTitleSyncStatus`。
- [x] 在“设置同步 -> 状态显示”区块中，在“显示导航栏同步状态”后新增开关。
- [x] 开关文案为“显示标签页标题同步状态”。
- [x] 说明文案为“开启后，仅当所有 S1 标签页都不在前台时，第一个标签页标题会在同步发生时显示状态提示（同步中/成功/失败/冲突）。”
- [x] 样式复用“显示导航栏同步状态”开关。
- [x] 远程同步关闭时置灰禁用。
- [x] 禁用行为与“显示导航栏同步状态”开关保持一致。
- [x] 更新 `test-sync-settings-ui.js`，断言标题状态开关位于状态显示区块。

Phase B 实现结果（2026-05-06）：

- 已在 `defaultSettings` 新增 `syncShowTitleSyncStatus: false`，并通过 `buildNormalizedSettings()` 以显式布尔值归一化；新增迁移 fixture 覆盖非布尔旧值会回落为 `false`。
- 已把 `syncShowTitleSyncStatus` 纳入设置保存、跨标签设置同步刷新、设置面板回填和重置默认路径；该设置会随 `getSyncedSettings()` 的设置同步数据一起导出/导入，不包含本地凭据。
- 已在“设置同步 -> 状态显示”里紧跟“显示导航栏同步状态”新增标题状态开关，复用同一 switch/sub-group 样式；远程同步关闭时随同组控件置灰禁用。
- 已更新 `sync-across-multiple-tab/scripts/test-sync-settings-ui.js`，断言开关位置、文案、禁用逻辑、保存回填和控件接线。

## Phase C: 统一标题组合函数

新增或重构标题写入路径：

- [x] 新增 `refreshDocumentTitle()`。
- [x] 新增 `getCurrentTitleSyncStatusPrefix()`。
- [x] 新增 `stripLastAppliedTitleSyncStatusPrefix(title)`。
- [x] 新增 `composeDocumentTitle({ prefix, titleBase, suffix })`。
- [x] 现有自定义标题后缀改为调用 `refreshDocumentTitle()`。
- [x] 标题同步状态也只调用 `refreshDocumentTitle()`。
- [x] 不再在多个路径直接写 `document.title`。
- [x] 每次写标题前先剥离本功能上次添加的前缀。
- [x] 页面原始标题变化时，能更新 titleBase，不被旧前缀污染。

标题组合顺序：

```text
[同步状态前缀] 原始标题 自定义标题后缀
```

无前缀时：

```text
原始标题 自定义标题后缀
```

Phase C 实现结果（2026-05-06）：

- 已新增统一标题组合路径：`composeDocumentTitle()` 负责 `[同步状态前缀] 原始标题 自定义标题后缀` 的顺序，`refreshDocumentTitle()` 是唯一直接写入 `document.title` 的函数。
- 已将原有自定义标题后缀从 `applyInterfaceCustomizations()` 内的直接写入改为调用 `refreshDocumentTitle()`；`resolveInterfaceTitleBase()` 会先剥离本轮标题状态前缀，再处理旧后缀和论坛原始标题格式。
- 已新增标题状态相关纯函数与测试钩子：`getCurrentTitleSyncStatusPrefix()`、`stripLastAppliedTitleSyncStatusPrefix()`、`getTitleSyncStatusPrefixForPhase()`、`isTitleSyncStatusForegroundTab()`、`resolveTitleSyncStatusTabDisplayDecision()` 和 `getTitleSyncStatusTestConstants()`。
- 验证结果：`node -c S1Plus.js`、`node sync-across-multiple-tab/scripts/test-title-sync-status.js`、`node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`、`node sync-across-multiple-tab/scripts/test-settings-migration.js` 均已通过。
- 剩余：Phase D-F 的真实运行时监听、动画 timer、GM presence / owner lease 写入和跨标签清理仍未落地；本轮只完成设置接线、统一标题组合与可测试的纯逻辑。

## Phase D: 标题状态映射与动画

- [ ] 标题状态直接消费统一状态源 display phase。
- [ ] 推荐复用 `resolveAutoSyncIndicatorDisplayPhase()`。
- [ ] `idle` 不显示。
- [ ] `pending` 不显示。
- [ ] `running` 显示同步中动画。
- [ ] `success` 显示 `[同步成功]`。
- [ ] `failure` 显示 `[同步失败]`。
- [ ] `conflict` 显示 `[冲突]`。
- [ ] 同步中动画每 500ms 在 `[同步中.]`、`[同步中..]`、`[同步中...]` 间切换。
- [ ] running 覆盖尚未过期的 success / failure / conflict。
- [ ] 结果状态过期后恢复原始标题。
- [ ] 前后台切换只暂停标题显示，不重置状态 TTL。
- [ ] 状态过期时停止动画 timer。

## Phase E: 多标签 presence 与负责人选举

推荐优先使用 GM value：

- [ ] 新增标题状态 presence key，例如 `s1p_title_sync_status_tabs`。
- [ ] 新增当前标签页唯一 `titleSyncStatusTabId`。
- [ ] 每个标签页记录 `tabId`、`createdAt`、`lastSeen`、`isForeground`。
- [ ] `isForeground` 使用 `document.visibilityState === "visible" && document.hasFocus()`。
- [ ] 监听 `visibilitychange`。
- [ ] 监听 `focus`。
- [ ] 监听 `blur`。
- [ ] 监听 `pageshow`。
- [ ] 监听 `pagehide`。
- [ ] 监听 `beforeunload`。
- [ ] 定期 heartbeat 更新 `lastSeen`。
- [ ] `lastSeen` 超过 2 分钟的标签页从 presence 判断中忽略。
- [ ] owner lease 使用 20 到 30 秒，负责人关闭后可更快接管。
- [ ] 当前仍存活标签页中 `createdAt` 最早者为负责人。
- [ ] 如果有任意标签页 `isForeground === true`，所有标题状态都隐藏。
- [ ] 只有负责人标签页可以显示标题状态。
- [ ] 非负责人标签页必须恢复原始标题并停止动画 timer。

fallback：

- [ ] 如果 GM value listener 不可用，使用 `localStorage` 和 `storage` event。
- [ ] fallback 仅负责同源标签协调。
- [ ] fallback 仍需满足 owner / presence / foreground 规则。

## Phase F: 跨标签通知与资源清理

- [ ] 使用 `GM_addValueChangeListener` 监听统一状态源变化。
- [ ] 使用 `GM_addValueChangeListener` 或 storage event 监听 presence 变化。
- [ ] 任意 S1 标签页切回前台时，所有标签页立即恢复原始标题。
- [ ] 任意 S1 标签页切回前台时，负责人停止动画 timer。
- [ ] 所有 S1 标签页进入后台后，重新选举负责人。
- [ ] 用户关闭 `syncShowTitleSyncStatus` 时，所有标签页恢复原始标题。
- [ ] 用户关闭 `syncShowTitleSyncStatus` 时，停止动画 timer。
- [ ] 远程同步关闭时，所有标签页恢复原始标题。
- [ ] 远程同步关闭时，停止动画 timer。
- [ ] 页面 `pagehide` / `beforeunload` 时释放当前标签页 presence。
- [ ] 页面 `pagehide` / `beforeunload` 时停止动画 timer。
- [ ] 非负责人标签页不运行动画 timer。
- [ ] 不需要显示状态时，不进行高频轮询。

## Phase G: 与统一状态源增强的关系

- [ ] 如果后台 shared scheduler 尚未完成，标题功能仍只消费现有 display phase，不自行补防抖。
- [ ] 如果后台 shared scheduler 已完成，标题功能应自动受益于更稳定的 display phase。
- [ ] 标题功能不单独解决 `success -> pending / running -> success` 抖动。
- [ ] 标题功能不读取后台 shared debounce state 做单独判断，除非统一状态源已暴露该 display phase。
- [ ] foreground probe / follow-up / retry / gate 的标题表现来自统一状态源小增强。
- [ ] 标题层不改 foreground probe / cooldown / gate 流程。

## Phase H: 回归验证

语法检查：

```bash
node -c S1Plus.js
```

专项测试：

```bash
node sync-across-multiple-tab/scripts/test-title-sync-status.js
```

建议回归：

```bash
node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js
node sync-across-multiple-tab/scripts/test-sync-settings-ui.js
node sync-across-multiple-tab/scripts/test-settings-migration.js
```

如果本轮也触碰统一状态源，补跑：

```bash
node sync-across-multiple-tab/scripts/test-safe-sync-execution.js
node sync-across-multiple-tab/scripts/test-foreground-probe-gate-retry.js
node sync-across-multiple-tab/scripts/test-foreground-trigger-integration.js
```

## 手工验收

- [ ] 前台 S1 页面永远不显示标题同步状态。
- [ ] 切到浏览器里的非 S1 标签页后，S1 标签页可显示标题同步状态。
- [ ] 切到其他应用后，S1 标签页可显示标题同步状态。
- [ ] 多个 S1 标签页中任意一个前台时，所有标题恢复原样。
- [ ] 多个 S1 标签页全部后台时，只有一个负责人显示标题状态。
- [ ] 负责人关闭后，其他标签页可接管。
- [ ] 崩溃或异常关闭标签页超过 TTL 后被忽略。
- [ ] 同步中动画每 0.5 秒切换一次。
- [ ] 同步成功 2 分钟后自动消失。
- [ ] 同步失败 5 分钟后自动消失。
- [ ] 冲突 10 分钟后自动消失。
- [ ] 前后台切换不重置结果状态 TTL。
- [ ] 自定义标题后缀始终保留。
- [ ] 不重复叠加标题前缀。
- [ ] 关闭标题状态开关后，所有标题恢复原样并停止 timer。
- [ ] 远程同步关闭后，开关置灰且标题恢复原样。
- [ ] 关闭导航栏状态开关不影响标题状态。

## 风险点

- [ ] 只看 `document.visibilityState` 可能无法覆盖“切到其他应用”场景，必须结合 `document.hasFocus()`。
- [ ] 多路径直接写 `document.title` 会导致前缀和自定义后缀互相覆盖，必须收口到统一 composer。
- [ ] `localStorage` 只能同源协调，跨 S1 域名应优先使用 GM value。
- [ ] 后台 timer 会被浏览器限流，presence TTL 不能太短。
- [ ] owner 接管等待完整 2 分钟会显得迟钝，应使用更短 owner lease。
- [ ] 如果统一状态源仍抖动，标题层会放大抖动，不应在标题层单独补复杂同步逻辑。

## 实现进度

- [x] Phase 0: 准备与代码定位
- [x] Phase A: 测试先行
- [x] Phase B: 设置项与 UI
- [x] Phase C: 统一标题组合函数
- [ ] Phase D: 标题状态映射与动画
- [ ] Phase E: 多标签 presence 与负责人选举
- [ ] Phase F: 跨标签通知与资源清理
- [ ] Phase G: 与统一状态源增强的关系
- [ ] Phase H: 回归验证
