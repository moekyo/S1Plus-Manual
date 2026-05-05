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

- [ ] 回读 `title-sync-status.md`。
- [ ] 确认本轮只实现标题同步状态展示，不改同步核心。
- [ ] 定位现有自定义标题后缀逻辑：
  - `resolveInterfaceTitleBase()`
  - `applyInterfaceCustomizations()`
  - `lastAppliedCustomTitleSuffix`
  - `document.title` 写入点
- [ ] 定位统一状态源：
  - `AUTO_SYNC_INDICATOR_STATE_KEY`
  - `getAutoSyncIndicatorState()`
  - `resolveAutoSyncIndicatorDisplayPhase()`
  - `getAutoSyncIndicatorResolvedTtlMs()`
  - `initializeAutoSyncIndicatorCrossTabSync()`
- [ ] 定位同步状态设置项 UI：
  - `syncShowAutoSyncIndicator`
  - “设置同步 -> 状态显示”区块
  - `test-sync-settings-ui.js`
- [ ] 确认当前工作树是否有用户未提交改动，避免误改无关文件。

## Phase A: 测试先行

新增测试脚本：

```text
sync-across-multiple-tab/scripts/test-title-sync-status.js
```

覆盖标题组合：

- [ ] 无同步状态时：标题为 `原始标题 + 自定义标题后缀`。
- [ ] running 时：标题为 `[同步中.] 原始标题 + 自定义标题后缀`。
- [ ] success 时：标题为 `[同步成功] 原始标题 + 自定义标题后缀`。
- [ ] failure 时：标题为 `[同步失败] 原始标题 + 自定义标题后缀`。
- [ ] conflict 时：标题为 `[冲突] 原始标题 + 自定义标题后缀`。
- [ ] 重复刷新不会叠加多个同步状态前缀。
- [ ] 自定义标题后缀更新后，前缀仍保留或按状态正确清除。

覆盖状态映射：

- [ ] `idle` 不显示。
- [ ] `pending` 不显示。
- [ ] `running` 显示同步中动画。
- [ ] `success` 显示 2 分钟。
- [ ] `failure` 显示 5 分钟。
- [ ] `conflict` 显示 10 分钟。
- [ ] 前后台切换不重置结果状态 TTL。

覆盖多标签协调：

- [ ] 单个 S1 标签页 visible 且 focused 时不显示。
- [ ] 单个 S1 标签页 hidden 时可显示。
- [ ] 单个 S1 标签页 visible 但 `document.hasFocus() === false` 时视为后台。
- [ ] 多个 S1 标签页中任意一个前台时，所有标签页都不显示。
- [ ] 所有 S1 标签页都后台时，只负责人标签页显示。
- [ ] 非负责人标签页不启动动画 timer。
- [ ] 负责人关闭后，其他标签页在 owner lease 过期后接管。
- [ ] 超过 presence TTL 的标签页被忽略，不阻塞显示。

覆盖设置：

- [ ] `syncShowTitleSyncStatus` 默认 `false`。
- [ ] 关闭远程同步时，标题状态开关置灰。
- [ ] 关闭标题状态开关后，标题恢复原样并停止动画 timer。
- [ ] 关闭导航栏状态开关不影响标题状态。
- [ ] 关闭标题状态开关不影响导航栏状态。
- [ ] 设置项随设置同步。

## Phase B: 设置项与 UI

- [ ] 在默认设置中新增 `syncShowTitleSyncStatus: false`。
- [ ] 在设置归一化 / 迁移路径中纳入 `syncShowTitleSyncStatus`。
- [ ] 在设置保存路径中纳入 `syncShowTitleSyncStatus`。
- [ ] 在“设置同步 -> 状态显示”区块中，在“显示导航栏同步状态”后新增开关。
- [ ] 开关文案为“显示标签页标题同步状态”。
- [ ] 说明文案为“开启后，仅当所有 S1 标签页都不在前台时，第一个标签页标题会在同步发生时显示状态提示（同步中/成功/失败/冲突）。”
- [ ] 样式复用“显示导航栏同步状态”开关。
- [ ] 远程同步关闭时置灰禁用。
- [ ] 禁用行为与“显示导航栏同步状态”开关保持一致。
- [ ] 更新 `test-sync-settings-ui.js`，断言标题状态开关位于状态显示区块。

## Phase C: 统一标题组合函数

新增或重构标题写入路径：

- [ ] 新增 `refreshDocumentTitle()`。
- [ ] 新增 `getCurrentTitleSyncStatusPrefix()`。
- [ ] 新增 `stripLastAppliedTitleSyncStatusPrefix(title)`。
- [ ] 新增 `composeDocumentTitle({ prefix, titleBase, suffix })`。
- [ ] 现有自定义标题后缀改为调用 `refreshDocumentTitle()`。
- [ ] 标题同步状态也只调用 `refreshDocumentTitle()`。
- [ ] 不再在多个路径直接写 `document.title`。
- [ ] 每次写标题前先剥离本功能上次添加的前缀。
- [ ] 页面原始标题变化时，能更新 titleBase，不被旧前缀污染。

标题组合顺序：

```text
[同步状态前缀] 原始标题 自定义标题后缀
```

无前缀时：

```text
原始标题 自定义标题后缀
```

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

- [ ] Phase 0: 准备与代码定位
- [ ] Phase A: 测试先行
- [ ] Phase B: 设置项与 UI
- [ ] Phase C: 统一标题组合函数
- [ ] Phase D: 标题状态映射与动画
- [ ] Phase E: 多标签 presence 与负责人选举
- [ ] Phase F: 跨标签通知与资源清理
- [ ] Phase G: 与统一状态源增强的关系
- [ ] Phase H: 回归验证
