# Phase 2: 协调器与 Intent 流水线

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. [Phase 1](./phase_1_sync_domain_model_and_migration.md)
5. 本文档

### 强烈建议补读

- [S1Plus.js](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js) 中当前 `performAutoSync`、后台 push 触发、恢复钩子和指示器驱动相关实现

### 选读

- [architecture_principles.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/sync_multitab_redesign/architecture_principles.md)

## 2. 目标

建立统一协调器，让所有自动行为先发 `SyncIntent`，再由协调器根据统一状态做调度和决策，不再允许触发器各自直接同步、直接写状态指示器或直接弹提示。

## 3. 本阶段覆盖的问题

- 当前触发器与执行器耦合，多个入口直接把行为推进到同步或提示层。
- 后台自动推送、每日首次同步、恢复钩子和旧自动检查链路没有被统一到同一个调度模型。
- 导航栏状态指示器和同步执行状态之间缺少单一真相源。

## 4. 本阶段要做成什么样

### 4.1 所有自动入口只发 Intent

- 将以下自动入口统一约束成只发 `SyncIntent`：
  - `local_dirty`
  - `startup_due`
  - `pending_recovery`
  - `foreground_resume`
  - `visible_poll`
- 不允许这些入口再直接：
  - 调 `performAutoSync`
  - 写指示器 phase
  - 弹“远端更新”提示
- 必须点名收编当前代码里已有的旁路，不能只覆盖新自动获取入口：
  - `triggerRemoteSyncPush` 不能直接写 pending 指示器并调用 `performAutoSync`，只能发 `local_dirty intent`。
  - pending recovery / 恢复钩子不能直接进入 recovery 执行链路，必须先进入协调器。
  - startup sync wrapper 不能自建独立锁和状态包装，必须使用协调器的 lease / queue / view model。
  - indicator pending wrapper 只能消费协调器状态，不能成为执行入口或事实源。

### 4.2 建立统一调度优先级

- 固定协调器优先级顺序：
  1. `manual_request`
  2. `pending_recovery`
  3. `local_dirty`
  4. `startup_due`
  5. `foreground_resume`
  6. `visible_poll`
- 明确 defer / requeue / skip 的规则。
- 明确 `manual_request` 的协调器边界：
  - 手动同步进入协调器，占用统一 lease / pause / 状态通道，以阻塞自动任务并让状态入口可解释。
  - 手动同步保留现有用户决策流程，包括强制推送、强制拉取和高级悬停选择。
  - 协调器不得把手动同步重写成自动流程，也不得吞掉需要用户选择的弹窗或确认步骤。
- 明确 `pending_recovery` 高于普通 `local_dirty`，因为它是遗留同步收尾行为，不应被新的后台推送反复打断。

### 4.3 收口 queue、lease、pause、circuit 的使用方式

- 定义协调器如何读取和写入：
  - queue 摘要
  - 当前共享 lease
  - 全局 hard pause
  - circuit breaker
- 明确这些状态不再由单个触发器任意写入。

### 4.4 定义状态到视图模型的单向映射

- 协调器产出统一状态，视图层只消费 `SyncStatusViewModel`。
- 导航栏入口、toast、诊断面板都不能再维护各自独立真相源。

### 4.5 随协调器落地最低诊断字段

本阶段不能把可观测性全部推迟到 `Phase 7`。协调器实现时至少要记录：

- 最近一个 intent 名称与来源入口。
- intent priority 与进入队列时间。
- defer / skip / requeue 的原因码。
- 当前 lease owner 与 lease source。
- queue summary，包括 pending intent 数量和最高优先级。
- 最近一次自动入口被拒绝的原因。

## 5. 本阶段不要顺手做什么

1. 不在这里细化页面刷新策略。
2. 不在这里重做设置 UI。
3. 不在这里完成远端 probe / reconcile 细节。
4. 不在这里新增复杂用户交互文案。

## 6. 推荐交付物

1. `SyncIntent` 入口与消费流程
2. 协调器优先级与调度规则
3. queue / lease / pause / circuit 的统一使用约束
4. 状态到 `SyncStatusViewModel` 的单向映射关系
5. 现有旁路入口收编清单
6. Phase 2 最低诊断字段

## 7. 验收标准

1. 触发器不再直接驱动同步执行或用户反馈。
2. 协调器成为自动行为唯一入口，后续阶段不需要再新增第二套调度骨架。
3. 状态展示层有单一上游，不再同时读多套 phase / reason。
4. 后台自动推送、恢复、前台探测类入口可以共用同一套优先级和 defer 语义。
5. `manual_request` 被协调器观察和互斥，但手动同步的用户决策流程不被自动化吞掉。
6. `pending_recovery` 与 `local_dirty` 的优先级在本阶段和 `Phase 3` 中保持一致。
7. intent 进入、延后、跳过和 lease 占用都能被最低诊断字段解释。

## 8. 交给下一阶段的输出

`Phase 3` 可以直接基于本阶段输出，把后台自动推送纳入协调器，改造成共用 lease 和 queue 的标准路径。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 在 `S1Plus.js` 中落地 `SyncCoordinator` 运行骨架：intent 归一化、固定优先级、queue、defer / skip / requeue / completed 决策记录、状态持久化和 `SyncStatusViewModel` 单向映射。
  - 将 `triggerRemoteSyncPush` 改为只提交 `local_dirty` intent，不再直接写 pending 指示器或直接调用 `performAutoSync`。
  - 将 `requestBackgroundSyncRun("pending_recovery")` 和 pending recovery hook 的补同步路径收编进协调器，保持 `pending_recovery` 高于普通 `local_dirty`。
  - 将 startup indicator wrapper 改为先提交 `startup_due` intent，再由协调器执行现有 startup lock / heartbeat / `performAutoSync` 路径。
  - 将手动同步、强制推送和强制拉取登记为 `manual_request` 协调器活动，用于阻塞自动 intent drain 和记录状态，同时保留原有手动决策 UI。
  - 将防抖、同步中 dirty、background retry、daily startup defer 等 pending 状态改为通过协调器 preview / view model 写入，不再由触发器直接写指示器。
  - 扩展最低诊断字段，记录最近 intent 名称 / 来源 / priority / 入队时间、decision reason、lease owner / source、queue summary 和最近拒绝原因。
  - 新增 `sync-across-multiple-tab/scripts/test-sync-coordinator-intent-pipeline.js`，覆盖优先级、queue 调度顺序、view model 映射，以及自动入口不再直连执行器 / 指示器。
- 涉及文件：
  - `S1Plus.js`
  - `sync-across-multiple-tab/scripts/test-sync-coordinator-intent-pipeline.js`
  - `auto-check-redesign/task_plan.md`
  - `auto-check-redesign/progress.md`
  - `auto-check-redesign/phases/phase_2_sync_coordinator_and_intent_pipeline.md`
- 验证：
  - `node --check S1Plus.js`
  - `node sync-across-multiple-tab/scripts/test-sync-coordinator-intent-pipeline.js`
  - `node sync-across-multiple-tab/scripts/test-safe-sync-execution.js`
  - `node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js`
  - `node sync-across-multiple-tab/scripts/test-settings-migration.js`
  - `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
  - `node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
  - `node sync-across-multiple-tab/scripts/test-background-open-passive-session.js`
  - `node sync-across-multiple-tab/scripts/test-cleanup-provenance-guard.js`
  - `node sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
  - 文档 / 代码关键字一致性搜索覆盖 `per_load`、`startup`、`daily_startup`、`syncForcePullOnStartup`、`manual_request`、`pending_recovery`、`payload`、`contentHash`、`pulled`、`Phase 7`。
- 剩余工作：
  - `foreground_resume` 和 `visible_poll` 的真实远端 probe / reconcile 仍未实现，按计划留给 `Phase 4`。
  - 共享 lease 的后台自动推送标准化仍只复用现有 background lock / global lock，完整改造留给 `Phase 3`。
  - 导航栏状态入口仍使用现有指示器承接 view model；统一状态中心 UI 留给 `Phase 6`。
  - 真实 Tampermonkey、多标签、bfcache 和网络异常组合仍未手测。
- 风险 / 限制：
  - 本阶段保守保留了现有 background lock / retry / drain 语义，以降低回归风险；`Phase 3` 需要继续把它收敛成共享 lease 标准路径。
  - 手动同步现在被协调器观测并阻塞自动 queue，但手动选择弹窗期间仍依赖现有 `manualSyncInFlightPromise` 作为运行态互斥信号。
- 下一步：
  - 等用户明确选择后进入 `Phase 3`，把后台自动推送和 retry / drain 正式改造成共用 lease 与 queue 的标准路径。
