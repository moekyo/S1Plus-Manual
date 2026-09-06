# Findings: 后台同步卸载竞态

## Evidence from user log

- `sync.auto_sync_decision`（id 296）判定 `skip_push_on_foreground_followup`，原因是 `local_changed_since_baseline`；本地变化分类为 `read_progress_only_changed`，并且已有 `pendingSources: read_progress`。
- 随后共享后台调度触发操作 `_37`。`lock.owner_pagehide` 记录该后台锁仍为 `stage: acquiring`, `active: true`, 剩余约 45 秒。
- 紧接着出现 `runtime.pagehide`；该 operation 没有 `background_run_start`、网络请求、远端写入或 `lock.released` 事件。
- 新 runtime 观察到 `_37` 的 `active_execution_lock` 后延迟恢复。更晚的 `_56`、`_10` 是不同标签页/不同 operation 的锁接力，不是同一 operation 持续几十分钟。

## Current implementation constraints

- `BACKGROUND_SYNC_LOCK_TTL_MS` 为 45 秒。
- 生命周期 adapter 当前只处理 Scheduler Owner 的 handoff；按照同步设计，不能在 pagehide 无条件删除未 settle 的 Running Sync Lock。
- `runBackgroundAutoSyncIteration()` 在 `runRunningSync({ mode: background })` 的 `runTransaction` 回调内部才记录 `background_run_start`，因此缺少该事件可作为“事务回调尚未开始”的证据。
- 可安全收窄的边界是：当前页在生命周期卸载闸门生效后，尚未进入事务回调的后台锁。已进入事务或已经开始远端操作的锁仍必须保留原有 TTL/正常释放语义。

## Hypotheses to test

1. **H1（主假设）**：后台 scheduler 在 pagehide 闸门之前取得执行锁，导致空的 `acquiring` 锁遗留。若在 lock acquisition 前后加入生命周期代际校验，并在尚未启动事务时安全取消，竞态测试应变绿且不会调用 transaction。
2. **H2**：锁已进入事务但日志缺失。若成立，测试应能观察到 `background_run_start` 或事务 adapter 被调用；用户日志没有该迹象，因此优先级较低。
3. **H3**：恢复调度只依赖可见页面 timer。若成立，即使锁正确过期，隐藏页面仍不能及时接管；需要通过 visible/pageshow 的 recovery 和 owner lease 测试验证。

## Verification target

最小回归场景：安排一个后台迭代在取得锁后、事务回调前触发 `pagehide`；断言旧 operation 不进入 transaction，执行锁最终是明确的 canceled/释放状态；新页面可以在同一 pending dirty 上取得锁并开始后台迭代，不必等待原 45 秒 TTL。

## Implemented result

- 生命周期代次现在在 pagehide/beforeunload 时阻止新 Running Sync，并让 ownership verification 期间的 provisional acquisition 失效。
- 事务前边界的操作由生命周期同步取消，按 execution token 删除匹配的模式锁和全局锁；`stage: acquiring`，或已验证但仍处于 `transaction_start` 且本地 `transactionStarted !== true` 的锁可以取消，已开始事务的锁不由卸载路径删除。
- 诊断新增 acquisition start/cancel/failure、beforeunload 快照和操作终态字段；`lock.expired_observed` 仍只表示观察到 TTL，缺失持有者回执会显示为证据缺口。
- `test-safe-sync-execution.js`、`test-background-sync-shared-debounce.js` 和 `test-structured-diagnostics.js` 已覆盖新增边界；41 个常规测试脚本与设置迁移脚本共 42 个测试均通过。

## 后续日志边界审查

- 发现并修正生命周期 adapter 在卸载微任务中复位 Running Sync 栅栏的问题。调度器的 handoff 标记仍可按原流程复位，但锁获取栅栏会一直保持到 pageshow、确认取消卸载的恢复 task 或显式解绑，避免 50ms ownership verification 窗口重新开放。
- 发现释放路径原来只按 owner/token 判断，可能在 TTL 已过期但记录尚存时误记 `lock.released`。现在释放同时校验模式锁和全局锁的 TTL，过期残留记录记为 `lock.expired_cleanup`，存储读取/删除失败记为 `lock.release_failed`。
- 共享锁回执读取、写入和合并现在会做结构校验、按事件/操作/执行 token/时间等稳定身份去重，并跳过损坏记录；这减少重复回执对操作摘要的干扰，同时保留跨标签页只能尽力收集的限制。
- 共享调度锁占用重试原先把 generation 放进日志去重键，generation 每秒变化会让重复记录持续增长；现在按原因、锁身份和锁阶段聚合，并保留最新锁 operation、阶段和 TTL 快照。
- 终态审查发现，事务完成日志可能晚于锁释放日志，若只保留一个 `terminalEvent`，后续完成事件会掩盖锁释放失败。操作摘要现在保留 `lockTerminal*`、`transactionTerminal*` 和终态事件链，并以锁终态证据作为 `terminalEvidence` 优先值；已结束 operation 的后续 `sync.complete` 也会在 5 秒窗口内按 mode/最近释放时间回填 operationId。
- 收尾异常审查发现，生命周期快照、临时锁逐项取消、停止心跳、锁释放调用、锁后清理、结果处理和手动意图边界原来有路径只写 console 或会中断后续结果处理。现在这些路径都有结构化事件；锁释放调用抛出时明确标记结果未知，生命周期快照失败也不会阻止卸载栅栏。

## 最新前台循环日志

- 新日志中的第一次 metadata-only probe 和后续完整读取均返回 HTTP 200；没有网络失败或锁释放失败。
- 同一 `remoteUpdatedAt=2026-09-06T17:38:55Z` 下，`sync.auto_sync_decision` 连续判定 `local_changed_with_remote_timestamp_drift`，本地变化为 `read_progress_only_changed`，动作是 `skip_push_on_foreground_followup`。
- 每轮 `foreground_followup` 都取得并正常释放自己的 mode/global lock；循环来自 `foreground_pending_recovery_result` 之后把所有 `blocked` 结果重新排入 600ms recovery。旧记录里的 `lock.expired_observed` 是更早的后台锁 TTL 观察，和后续 13 轮前台补同步不是同一个 operation。
- 修复后，durable foreground intent 记录精确的 `requestId`、远端版本、最近尝试和 soft-block 结果；不可重试的 soft block 会停止 recovery/reprobe，重复 probe 只留下 suppression 证据，新的本地 mutation 才会解除 marker。可重试的阅读进度待写入、防抖和初始化噪声仍按有界重试运行。
