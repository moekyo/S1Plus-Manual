# Phase 3: 自动推送与共享 Lease

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. [Phase 1](./phase_1_sync_domain_model_and_migration.md)
5. [Phase 2](./phase_2_sync_coordinator_and_intent_pipeline.md)
6. 本文档

### 强烈建议补读

- [S1Plus.js](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js) 中当前后台自动同步、锁、heartbeat、pending recovery 相关实现

### 选读

- [background-open-unexpected-remote-update-investigation.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/background-open-unexpected-remote-update-investigation.md)

## 2. 目标

把后台自动推送正式纳入协调器，和其他自动行为共用 queue、lease、pause、circuit 语义，避免它继续以旁路形式驱动状态和用户反馈。

## 3. 本阶段覆盖的问题

- 当前后台自动推送是最稳定的自动能力之一，但它与新自动获取、状态入口和恢复逻辑还没有统一调度模型。
- 共享锁和 heartbeat 存在，但使用方式仍偏向“调用点自己管自己的锁”。
- pending recovery 与 background push 的先后关系如果不定义清楚，容易互相打断或重复调度。

## 4. 本阶段要做成什么样

### 4.1 把 `local_dirty` 变成标准协调器路径

- 本地数据变动后，不再直接“触发后台自动同步”，而是先发 `local_dirty intent`。
- 协调器决定何时 drain、何时延后、何时重试。
- `local_dirty` 只能表达“本机有待推送业务变更”，不能被自动获取链路借用来做普通 push。

### 4.2 包装共享 lease / 锁 / heartbeat

- 保留现有锁与 heartbeat 能力，但通过协调器统一申请和释放。
- 约束 lease 只表达“谁拥有当前执行权”，不负责表达局部 tab 状态。

### 4.3 固定 push drain 规则

- 当队列中存在多个本地变更时，明确：
  - 是否合并 drain
  - 如何处理中途再次脏写
  - 什么时候回退到重试
- 不允许再通过指示器或补丁式延迟去兜底 drain 行为。

### 4.4 明确 pending recovery 与 background push 的先后

- 明确 pending recovery 属于比普通 background push 更高优先级的收尾行为。
- 本阶段必须和 `Phase 2` 使用同一优先级：
  1. `manual_request`
  2. `pending_recovery`
  3. `local_dirty`
  4. `startup_due`
  5. `foreground_resume`
  6. `visible_poll`
- 避免“遗留变更刚准备补发，新的 local dirty 又把状态重写”这类竞态。
- 当 pending recovery 与新的 local dirty 同时存在时，协调器先完成 recovery settle；新的 local dirty 只能排队或合并 drain，不能抢占 recovery。

## 5. 本阶段不要顺手做什么

1. 不在这里重建远端 probe / pull。
2. 不在这里重做页面刷新或 soft prompt 文案。
3. 不在这里升级导航栏状态入口 UI。

## 6. 推荐交付物

1. `local_dirty` 的 intent 化路径
2. shared lease / lock / heartbeat 的协调器包装层
3. push drain 规则与 retry 规则
4. pending recovery 与 background push 的优先级与互斥约束
5. 与 `Phase 2` 完全一致的 intent 优先级引用

## 7. 验收标准

1. 后台自动推送和其他自动行为使用同一套调度语义。
2. queue / lease / retry 不再由多个调用点各自重写。
3. pending recovery 与 background push 的关系清晰，不再靠经验判断。
4. 本地脏写优先保护原则在协调器中可观测、可验证。
5. Phase 2 和 Phase 3 对 `pending_recovery` / `local_dirty` 的先后关系没有冲突文本。

## 8. 交给下一阶段的输出

`Phase 4` 可以在本阶段已有调度骨架上接入自动获取云端更新，而不用再自建第二套锁、队列和状态入口。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 将 coordinator queue 的后台 intent 增加合并语义：多个 `local_dirty` 会合并为一次后台 drain，新的 `local_dirty` 命中正在运行的后台 drain 时会并入当前执行，不再堆出第二条并行事实源。
  - 固定 `pending_recovery` 高于 `local_dirty` 的执行关系：排队中的 `local_dirty` 会被新进入的 `pending_recovery` 吸收并随 recovery settle 一起完成，避免遗留补发被普通后台推送抢占。
  - 新增 shared lease 包装层，统一 coordinator 对 background / startup / manual 锁、heartbeat、release 的访问；后台推送执行器已改为通过 coordinator lease 申请和释放 background 锁。
  - 将后台 retry 从独立 timeout 触发 `triggerRemoteSyncPush("background_retry")` 改为 delayed `local_dirty` intent，retry 去重、最大次数和 queue 状态都回到 coordinator 语义内。
  - 增加后台推送 drain 诊断字段，记录最近 drain loop 数、合并 intent 数和 retry 原因，并在现有诊断面展示。
  - 扩展 `test-sync-coordinator-intent-pipeline.js`，覆盖 `local_dirty` 合并、`pending_recovery` 吸收 queued dirty、后台 lease 包装和 retry 重新入队规则。
- 涉及文件：
  - `S1Plus.js`
  - `sync-across-multiple-tab/scripts/test-sync-coordinator-intent-pipeline.js`
  - `auto-check-redesign/task_plan.md`
  - `auto-check-redesign/progress.md`
  - `auto-check-redesign/phases/phase_3_auto_push_and_shared_lease.md`
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
  - 关键字一致性搜索覆盖 `per_load`、`startup`、`daily_startup`、`syncForcePullOnStartup`、`manual_request`、`pending_recovery`、`payload`、`contentHash`、`pulled`、`Phase 7`。
- 剩余工作：
  - 不重建远端 probe / pull，不修改页面刷新策略，不升级导航栏状态入口 UI；这些分别留给 Phase 4、Phase 5 和 Phase 6。
  - `performAutoSync` 内部的 push / pull / conflict 判定仍沿用现有稳定路径，本阶段只收敛后台推送的调度、lease、retry 和 drain。
  - 真实 Tampermonkey、多标签、bfcache 和网络异常组合仍未手测，本阶段完成静态与脚本级验证。
- 风险 / 限制：
  - shared lease 包装已覆盖 background 执行器，并提供 startup / manual 控制器入口；startup / manual 的业务流程仍保留既有外层函数和手动选择 UI。
  - delayed retry 现在依赖 coordinator queue 的定时 drain；若真实用户脚本环境对跨标签定时器有额外限制，仍需要 Phase 7 手测矩阵覆盖。
- 下一步：
  - 等用户明确选择后进入 `Phase 4`，在当前 shared lease / queue 上接入安全自动拉取、只读 probe 与 reconcile。
