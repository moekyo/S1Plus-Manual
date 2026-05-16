# Phase 4: 安全自动拉取、Probe 与 Reconcile

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. [Phase 1](./phase_1_sync_domain_model_and_migration.md)
5. [Phase 2](./phase_2_sync_coordinator_and_intent_pipeline.md)
6. [Phase 3](./phase_3_auto_push_and_shared_lease.md)
7. 本文档

### 强烈建议补读

- [same-device-unexpected-remote-update-findings-and-fix-plan.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/same-device-unexpected-remote-update-findings-and-fix-plan.md)
- [architecture_principles.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/sync_multitab_redesign/architecture_principles.md)

### 选读

- [S1Plus.js](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js) 中当前 startup、恢复钩子、same-session / same-device 相关实现

## 2. 目标

重建自动获取云端更新的核心链路，采用 `probe -> reconcile -> apply` 三段式，并确保前台恢复、visible poll、启动期获取都先经过页面安全检查和本地状态收敛。

## 3. 本阶段覆盖的问题

- 旧自动检查链路把 freshness 检查、同步决策、页面提示和用户打扰混在一起。
- `updated_at` 变化被过度解释，容易把同机其他标签页写入误说成“远端更新”。
- 前台恢复、visible poll、pending recovery 容易在本地状态未稳定时重复暴露旧状态。

## 4. 本阶段要做成什么样

### 4.1 统一进入 `probe -> reconcile -> apply`

- `probe` 只负责 freshness 观察，不做最终同步判定。
- `reconcile` 负责在最新本地状态和最新远端状态之间做 pull / merge / manual / defer 判定。
- `apply` 才负责把同步结果真正反映到当前页面和状态入口。
- 自动获取来源的 `reconcile` 结果只允许：
  - `no_change`
  - `pull_candidate`
  - `read_progress_merge_candidate`
  - `manual_required`
  - `defer`
- 普通 `push` 不允许由自动获取链路触发；如果发现本地有待推送改动，应转交 `local_dirty` intent 或转手动处理。

### 4.2 进入 probe 前先过 `safe to probe`

- probe 前必须先完成两个硬前置：
  - core data snapshot resync 已完成，当前本地视图不是旧快照。
  - pending recovery 已 settle，不存在仍在补发或恢复中的遗留同步。
- 明确当前页哪些情况下只能 defer，而不能 probe：
  - pending write
  - debounce
  - dirty settings modal
  - 仍在阅读中的 thread page
  - 尚未稳定的后台恢复状态
- 这些情况只能形成 `tab-local defer`，不能直接升级成全局冲突。
- `foreground_resume`、`visible_poll`、`startup_due` 都必须先过同一套 gate，不能各自开例外。

### 4.3 覆盖三类自动获取来源

- `startup_due`
- `foreground_resume`
- `visible_poll`

三类入口都必须共用：

- freshness 观察语义
- defer 语义
- same-session / same-device 分类
- reconcile 入口

### 4.4 降低对 `updated_at` 的过度解释

- `updated_at` 只能当 freshness hint。
- freshness 命中不能直接弹“远程有更新”，也不能直接触发 pull / reload。
- 只有在 reconcile 后，系统才能决定：
  - 无变化
  - 安全可拉取
  - 可自动 merge
  - 需要人工处理

### 4.5 同机会话与同设备识别成为一等公民

- 明确 same-session、same-device、cross-device 三类结果如何分类和展示。
- 同设备写入不能再被默认解释为“外部远端变化”。
- 分类所依赖的输入必须明确：
  - `remoteUpdatedAt`
  - `lastWriter`
  - `sessionId`
  - `sourceTabId`
  - 可选 `deviceId`
- 当 `deviceId` 缺失时，same-device 分类允许失效，但主流程必须优雅退化，不能因此回退到“凡是 freshness 命中就外部变化”的旧设计。

### 4.6 明确 `deviceId` 只做归因，不做真值判定

- `deviceId` 只能帮助解释“这次远端写入更像是谁造成的”。
- 是否真的需要 pull / merge / conflict，仍然必须由：
  - 最新本地状态
  - `contentHash`
  - `baseContentHash`
  - `updated_at`
  一起决定。
- 不允许出现“因为 `deviceId` 不同，所以默认认为一定需要拉取”这种捷径判断。

### 4.7 随 probe / reconcile 落地最低诊断字段

本阶段至少要记录：

- 最近 probe 的 freshness hint 与 `remoteUpdatedAt`。
- probe 前使用的 local snapshot hash / version。
- 远端 `contentHash` 与本地 `contentHash` / `baseContentHash`。
- writer attribution：same-session / same-device / cross-device / unknown。
- reconcile result。
- allowed action：`none` / `pull_candidate` / `read_progress_merge_candidate` / `manual_required` / `defer`。
- safe-to-probe gate 拒绝原因。

## 5. 本阶段不要顺手做什么

1. 不在这里敲定最终页面刷新文案。
2. 不在这里重做设置 UI。
3. 不在这里升级导航状态入口交互细节。

## 6. 推荐交付物

1. `probe -> reconcile -> apply` 主链路
2. `safe to probe` 条件与 `tab-local defer` 规则
3. `startup_due` / `foreground_resume` / `visible_poll` 的统一入口
4. same-session / same-device / cross-device 结果分类
5. `deviceId` 缺失时的优雅退化策略
6. 自动获取来源允许结果表，明确不允许普通 push
7. Phase 4 最低诊断字段

## 7. 验收标准

1. freshness 检查不会再直接触发高打扰反馈。
2. 同机其他标签页导致的远端变化，不再被误说成“外部远端更新”。
3. 页面本地未稳定时会 defer，而不是先 probe 再放大旧状态。
4. 前台恢复、visible poll 和启动期获取在语义上收敛到同一套自动获取模型。
5. `deviceId` 配置与否，只影响归因精度，不影响主同步判定的正确性。
6. probe 前已经完成本地 core data snapshot resync，并等待 pending recovery settle。
7. 自动获取链路不会因为检查远端而普通 push 到远端。
8. `updated_at` 命中只能进入 reconcile，不能直接形成“远程有更新”提示。

## 8. 交给下一阶段的输出

`Phase 5` 默认可以基于本阶段结果，专注“sync result 如何应用到不同类型页面”，而不用再回头定义 freshness 或 reconcile 语义。2026-04-25 的回归修复已补全候选结果的受控 apply：probe / reconcile 本身仍保持 read-only，候选 apply helper 才负责导入或阅读进度 merge。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 在 `S1Plus.js` 中新增 `startup_due` 作为独立自动获取触发源，保持它与既有 `daily_startup` 每日首次同步语义分离。
  - 将 `startup_due` / `foreground_resume` / `visible_poll` 接入统一 coordinator intent，不新增第二套队列或锁语义。
  - 新增 `safe to probe` gate：probe 前先执行 core data snapshot resync，并检查 pending recovery 是否已 settle；dirty settings modal、pending read-progress write、同步防抖、local dirty pending、manual request、阅读中的 thread page、未稳定后台恢复状态都会形成 tab-local `defer`。
  - 新增 read-only `probe -> reconcile` 主链路：先用远端 `updated_at` 作为 freshness hint，再按需拉取完整远端数据做 hash / baseline / writer attribution 判定。
  - 固定自动获取允许结果：`no_change`、`pull_candidate`、`read_progress_merge_candidate`、`manual_required`、`defer`；probe / reconcile 执行器不会直接调用 `performAutoSync`、`pushRemoteData` 或 `importLocalData`，候选结果由后续受控 apply helper 处理。
  - 本地较新时只转交 `local_dirty` / background push 或进入手动处理，不由自动获取普通 push。
  - same-session / same-device / cross-device / unknown writer attribution 已进入 reconcile 结果与诊断；`syncDeviceId` 缺失时降级为 `unknown`，不影响 hash / baseline 判定。
  - 新增 Phase 4 最低诊断字段并在诊断摘要展示 probe freshness、remoteUpdatedAt、本地/远端/base/baseline hash、writer attribution、reconcile result、allowed action 和 safe gate 拒绝原因。
  - 新增 `sync-across-multiple-tab/scripts/test-safe-auto-pull-probe-reconcile.js`，覆盖入口映射、safe gate、writer attribution、候选结果映射，以及自动获取执行器 read-only 约束。
- 涉及文件：
  - `S1Plus.js`
  - `sync-across-multiple-tab/scripts/test-safe-auto-pull-probe-reconcile.js`
  - `auto-check-redesign/task_plan.md`
  - `auto-check-redesign/progress.md`
  - `auto-check-redesign/phases/phase_4_safe_auto_pull_probe_and_reconcile.md`
- 验证：
  - `node --check S1Plus.js`
  - `node sync-across-multiple-tab/scripts/test-safe-auto-pull-probe-reconcile.js`
  - `node sync-across-multiple-tab/scripts/test-sync-coordinator-intent-pipeline.js`
  - `node sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
  - `node sync-across-multiple-tab/scripts/test-safe-sync-execution.js`
  - `node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js`
  - `node sync-across-multiple-tab/scripts/test-settings-migration.js`
  - `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
  - `node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
  - `node sync-across-multiple-tab/scripts/test-background-open-passive-session.js`
  - `node sync-across-multiple-tab/scripts/test-cleanup-provenance-guard.js`
  - 关键字一致性搜索覆盖 `per_load`、`startup`、`daily_startup`、`syncForcePullOnStartup`、`manual_request`、`pending_recovery`、`payload`、`contentHash`、`pulled`、`Phase 7`，并额外由新测试断言 Phase 4 自动获取执行器不直接 `performAutoSync` / `pushRemoteData` / `importLocalData`。
- 剩余工作：
  - 页面 soft prompt / auto refresh 文案和页面策略仍由 `Phase 5` 定义；本阶段只负责产出候选并在回归修复后接入受控 apply helper。
  - 设置 UI 仍是旧三段式文案，用户面收口留给 `Phase 6`。
  - 真实论坛页、Tampermonkey、多标签、bfcache、可见页长时间轮询行为仍需 `Phase 7` 手测矩阵覆盖。
- 风险 / 限制：
  - `visible_poll` 使用保守的 5 分钟间隔和 probe cooldown；真实浏览器后台定时器节流可能导致触发时间晚于脚本级预期。
  - Phase 4 的 probe / reconcile 保持 read-only；候选 apply 已补齐，但用户可见处理体验仍依赖 Phase 5 / Phase 6 的页面策略和状态入口。
- 下一步：
  - 等用户明确选择后进入 `Phase 5`，基于本阶段的候选结果实现页面 apply / refresh policy。

### 2026-04-25 回归修复补记

- 新增 `runSafeAutoPullProbeReconcileAndApply()` / `handleSafeAutoPullResult()`：`requestSafeAutoPullProbeRun()` 现在会在 coordinator 内把 `pull_candidate` / `read_progress_merge_candidate` 继续交给受控 apply，而不是只把候选结果塞进 `autoFetchResult`。
- `pull_candidate` 会重新拉取并校验远端 payload，确认 `updated_at` / `contentHash` 未偏离 probe 候选后，使用 `importLocalData(JSON.stringify(remote.full), { suppressPostSync: true })` 导入本地，更新 baseline / `s1p_last_sync_timestamp`，再走既有页面刷新策略。
- `read_progress_merge_candidate` 会重新确认仍只有阅读进度可合并，使用 `buildMergedReadProgressPayload()` 和带 `expectedRemoteUpdatedAt` 的 `pushRemoteData()` 回写合并结果，再导入本地；这属于受控 merge，不恢复普通自动 push。
- 普通 `window focus` 已接入 `foreground_resume` 调度器；`visibilitychange(visible)`、persisted `pageshow` 和 focus 统一进入前台恢复 probe，且前台恢复可绕过 shared cooldown。
