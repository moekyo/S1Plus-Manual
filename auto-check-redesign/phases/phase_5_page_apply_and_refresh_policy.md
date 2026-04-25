# Phase 5: 页面应用与刷新策略

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. [Phase 4](./phase_4_safe_auto_pull_probe_and_reconcile.md)
5. 本文档

### 强烈建议补读

- [S1Plus.js](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js) 中当前 auto pull refresh policy、thread/list 页面判定和 dirty modal 保护相关实现

### 选读

- [background-open-unexpected-remote-update-investigation.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/background-open-unexpected-remote-update-investigation.md)

## 2. 目标

把同步结果如何应用到页面，以及何时刷新页面，统一成保守策略，优先保护阅读体验、未保存编辑和当前页本地稳定性。

## 3. 本阶段覆盖的问题

- 即使同步判定是正确的，页面应用策略如果太激进，也会制造“打断阅读”“突然刷新”“用户感觉不可信”的问题。
- thread/list/generic 页面当前采用的策略不够统一，也还混杂了旧自动检查链路遗留语义。
- dirty settings modal、阅读中的 thread page、只涉及 read_progress 的 merge，这些场景需要比普通页面更保守。

## 4. 本阶段要做成什么样

### 4.1 固定页面分类

- 明确页面只分三类：
  - `thread`
  - `list`
  - `generic`
- 不再让每条同步路径各自推断是否应该刷新。

### 4.2 把页面应用策略收敛为少数稳定结果

- 自动同步结果应用到页面时，只允许少数几种明确策略：
  - 静默应用
  - 延后处理
  - soft prompt
  - 自动刷新
  - 强制转手动处理

### 4.3 保护 thread page 与阅读会话

- thread page 默认不因为 freshness 命中就直接自动刷新。
- 正在阅读、仍有 pending write / debounce、或刚从后台恢复的 thread page，应优先 defer 或 soft prompt。

### 4.4 保护 dirty settings modal

- 设置弹窗存在未保存编辑时，不允许自动刷新页面。
- 这类保护属于当前页 `tab-local guard`，不应升级成全局冲突或全局暂停。

### 4.5 明确 read_progress 自动 merge 的页面行为

- 只涉及 read_progress 的自动 merge，在页面上如何呈现必须固定下来：
  - 哪些页面静默处理
  - 哪些页面只做轻量提示
  - 哪些页面允许延后再应用

### 4.6 固定 page × sync result 处理矩阵

页面应用策略必须依赖统一的 sync result 和 page context，不得由触发来源临场分支决定：

| sync result | `thread` | `list` | `generic` |
| --- | --- | --- | --- |
| `pulled` | 默认 soft prompt 或 defer，不自动 reload；只有用户确认后才刷新或应用。 | 页面安全时可自动刷新或静默追平；存在本地 guard 时 defer。 | 页面安全时可自动刷新；存在 dirty modal / pending guard 时 defer。 |
| `force_pulled` | 只能来自显式手动选择；允许按手动同步语义刷新或重载。 | 只能来自显式手动选择；按手动同步语义应用。 | 只能来自显式手动选择；按手动同步语义应用。 |
| `merged_read_progress` | 不打断阅读；优先 soft prompt 或延后到安全点应用。 | 可静默处理或轻量提示。 | 可静默处理。 |
| `conflict_manual` | 不自动刷新；显示手动处理入口。 | 不自动刷新；显示手动处理入口。 | 不自动刷新；显示手动处理入口。 |
| `deferred` | 保持当前阅读状态，只更新状态入口原因。 | 保持页面，只更新状态入口原因。 | 保持页面，只更新状态入口原因。 |

`thread × pulled` 是本阶段的硬保护点：普通 pull 不能沿用旧逻辑直接 reload。`force_pulled` 必须有显式用户动作来源，不能由自动获取升级得到。

### 4.7 随页面应用落地最低诊断字段

本阶段至少要记录：

- page type：`thread` / `list` / `generic`。
- sync result。
- apply policy：silent / defer / soft prompt / auto refresh / manual required。
- refresh decision：none / prompt / reload / deferred。
- blocked reason：reading session / dirty modal / pending write / debounce / manual required 等。

## 5. 本阶段不要顺手做什么

1. 不在这里重做导航栏统一状态入口。
2. 不在这里扩展大量诊断字段；但必须保留本阶段最低诊断字段。
3. 不在这里重新定义 settings 模型。

## 6. 推荐交付物

1. thread / list / generic 三类页面的固定策略表
2. 页面应用结果枚举
3. dirty settings modal 与阅读会话保护规则
4. read_progress merge 的页面行为约束
5. page × sync result 处理矩阵
6. Phase 5 最低诊断字段

## 7. 验收标准

1. thread page 不再被自动同步轻易打断。
2. list/generic 页面在安全条件满足时仍能平滑追平，不会变成“全都只能手动处理”。
3. dirty settings modal 保护是稳定规则，不再是零散调用点判断。
4. 页面应用策略不再依赖触发来源分支，而是依赖统一的 sync result 和 page context。
5. 普通 `pulled` 在 thread 页不会自动 reload；`force_pulled` 只来自显式手动选择。
6. 页面应用决策能通过最低诊断字段解释。

## 8. 交给下一阶段的输出

`Phase 6` 可以在本阶段固定的页面行为和状态结果之上，设计设置 UI 和统一状态入口，而不用再次讨论 thread/list 页面如何处理。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 在 `S1Plus.js` 中固定页面分类为 `thread` / `list` / `generic`，旧 `thread_detail` / `lightweight_list` 分类不再作为刷新策略输出。
  - 将页面 apply 结果收敛为 `silent` / `defer` / `soft_prompt` / `auto_refresh` / `manual_required`，刷新决策收敛为 `none` / `prompt` / `reload` / `deferred`。
  - 固定 `pulled`：thread 页 soft prompt 且不自动 reload；list / generic 页面在无本地 guard 时自动刷新。
  - 固定 `force_pulled`：按显式强制语义允许自动刷新，但仍受 dirty settings / pending guard 保护。
  - 固定 `merged_read_progress`：thread 页 soft prompt；list / generic 页面静默处理，不再调度全页刷新。
  - 固定 `conflict_manual` / `deferred`：不自动刷新，分别进入手动处理或延后处理策略。
  - 将 dirty settings modal、pending write、sync debounce、后台恢复未稳定等当前页状态统一为 tab-local `defer`，不升级为全局冲突。
  - 新增 Phase 5 最低诊断字段并展示最近页面 apply / 刷新决策：page type、sync result、apply policy、refresh decision、blocked reason。
  - 更新 `test-post-sync-refresh-policy.js`，覆盖新页面矩阵、dirty modal defer、thread `pulled` 不 reload、read_progress merge 静默处理、`conflict_manual` 不刷新和诊断记录。
- 涉及文件：
  - `S1Plus.js`
  - `sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
  - `auto-check-redesign/task_plan.md`
  - `auto-check-redesign/progress.md`
  - `auto-check-redesign/notes.md`
  - `auto-check-redesign/phases/phase_5_page_apply_and_refresh_policy.md`
- 验证：
  - `node --check S1Plus.js`
  - `node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
  - `node sync-across-multiple-tab/scripts/test-safe-auto-pull-probe-reconcile.js`
  - `node sync-across-multiple-tab/scripts/test-sync-coordinator-intent-pipeline.js`
  - `node sync-across-multiple-tab/scripts/test-safe-sync-execution.js`
  - `node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js`
  - `node sync-across-multiple-tab/scripts/test-settings-migration.js`
  - `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
  - `node sync-across-multiple-tab/scripts/test-background-open-passive-session.js`
  - `node sync-across-multiple-tab/scripts/test-cleanup-provenance-guard.js`
  - `node sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
  - `node sync-across-multiple-tab/scripts/test-phase6-interaction-copy.js`
  - 关键字一致性搜索覆盖 `per_load`、`daily_startup`、`syncForcePullOnStartup`、`manual_request`、`pending_recovery`、`contentHash`、`pulled`、`force_pulled`、`Phase 7`。
- 剩余工作：
  - 本阶段不重做设置 UI 或统一状态入口；`conflict_manual` / deferred 的主入口和处理按钮仍留给 `Phase 6`。
  - 本阶段不展开完整诊断矩阵；仅落地页面 apply 最低字段，统一整理和手测矩阵留给 `Phase 7`。
  - 真实论坛页、Tampermonkey、多标签、bfcache 和长时间可见页轮询仍需 `Phase 7` 手测。
- 风险 / 限制：
  - `merged_read_progress` 在 list / generic 页面静默处理，不再主动刷新列表上的阅读进度标识；若未来需要即时视觉追平，应通过局部重绘或状态入口方案评估。
  - 当前 `conflict_manual` 固定为不刷新 + 手动处理，但完整的用户入口体验仍依赖 Phase 6。
- 下一步：
  - 等用户明确选择后进入 `Phase 6`，基于本阶段固定的页面行为收口设置 UI 和统一状态入口。
