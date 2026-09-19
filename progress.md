# Progress Report: 卸载竞态与日志系统增强

## Phase 1 — 回归场景

- Status: Completed.
- Added red-capable tests for two distinct failure windows: `runRunningSync()` receiving a pagehide after lock acquisition, and `acquireModeSyncLock()` being interrupted during its 50ms ownership verification.
- The pre-fix failures confirmed that the transaction could start after pagehide and that both mode/global locks could remain in storage without a terminal event.

## Phase 2 — 生命周期与锁修复

- Status: Completed.
- Added a lifecycle unloading gate and generation fence shared by the lifecycle adapter and lock acquisition path.
- New acquisitions are refused while unloading. An acquisition whose verification generation becomes stale is canceled before it can enter `runTransaction()`.
- Only operations still at the transaction-before boundary are canceled on pagehide/beforeunload: `stage: "acquiring"`, or a verified `stage: "transaction_start"` operation whose local `transactionStarted !== true`. Running transactions retain their mode/global locks until normal settlement or TTL expiry.
- Running Sync now performs a second lifecycle check after acquiring a lock and before starting heartbeat or transaction work.
- Mode lock convenience wrappers retain the latest local execution token for safe refresh, heartbeat, and release operations.
- Lock storage write failures clean up partial mode/global records and produce a terminal `lock.acquisition_failed` event.

## Phase 3 — 诊断证据增强

- Status: Completed.
- Added `lock.acquisition_started`, `lock.acquisition_canceled`, and `lock.acquisition_failed` events, plus beforeunload diagnostics and unload disposition details.
- Operation summaries now expose `terminalEvent`, `terminalStatus`, `terminalReason`, `terminalAt`, `observedExpiryAt`, `lastStage`, `lastOutcome`, and `terminalEvidence`.
- Operation summaries also fold in deduplicated shared lock receipts and expose `evidenceSources` / `sharedReceiptCount`, so an observer tab can see a holder's terminal receipt without pretending it collected the holder's full log.
- `lock.expired_observed` remains an observer fact and is never converted into a fabricated owner release. Missing owner receipts remain `no_terminal_evidence`.
- Shared lock receipts remain best-effort and immutable when `GM_listValues` is available; cross-tab merging still labels its evidence limits.
- 追加边界审查：持有者在释放时会同时校验模式锁和全局锁的 TTL；已过期的残留记录标记为 `lock.expired_cleanup`，锁状态读取或删除失败标记为 `lock.release_failed`，避免把过期或存储失败误报为正常释放。共享回执读取/合并会校验、去重并跳过损坏记录。
- 再次审查收尾路径：生命周期快照读取失败会独立记录且不能阻止栅栏生效；临时锁逐项取消失败不会阻塞其它操作；锁释放调用、停止心跳、锁后清理、结果处理和手动意图边界异常均进入结构化诊断。操作摘要同时保留锁终态、事务终态和收尾终态链，失败证据优先于后续成功释放或完成事件；已结束操作的后续 `sync.complete` 会按最近释放时间关联回原 operation。
- 共享调度因锁占用的高频重试改为按原因、锁身份和阶段聚合，最新记录带出占锁 operation、执行 ID、阶段、取得时间、过期时间和剩余 TTL，避免大量重复日志掩盖真正的占锁原因。

## Phase 4 — Verification

- Status: Completed.
- `node --check S1Plus.js` passed.
- All 41 `tests/test-*.js` scripts and `tests/settings-migration/test-settings-migration.js` passed (42 scripts total).
- `git diff --check` passed.
- Focused assertions verify pagehide cancellation, no transaction start after lifecycle abort (including an immediate scheduler microtask), terminal release/expiry evidence, lock renewal/release storage failures, and lock-storage acquisition cleanup.
- Additional assertions verify stage-persistence cleanup, cleanup exception events, release-call exceptions preserving result handling, and lock evidence retained after a later transaction completion event.

## Phase 5 — Documentation and delivery state

- Status: Completed.
- Updated `DEVELOPMENT.md`, `docs/agents/repository-guide.md`, `CONTEXT.md`, and `docs/plans/sync-system-master-plan.md` with the new lifecycle and evidence semantics.
- The source and tests are intentionally left uncommitted for review. A browser-level multi-tab/freeze test is still the only validation that cannot be reproduced by the Node harness.
- The Running Sync lifecycle fence now stays closed after the scheduler unload microtask and reopens only on pageshow, proven canceled-unload recovery, or explicit unbind.
- The latest source changes remain uncommitted and unpushed; browser-level abrupt termination and frozen-tab behavior still require manual multi-tab validation because Node cannot emulate those host guarantees.

## Phase 6 — 前台 soft-block 循环修复

- Status: Completed.
- The latest user log showed successful metadata requests followed by repeated `local_changed_with_remote_timestamp_drift` soft blocks. Recovery treated every blocked result as retryable, so the same durable foreground intent ran again every 600ms and alternated the probe and sync indicators.
- Durable foreground intents now retain the exact request generation and result evidence. Non-retryable soft blocks suppress recovery/reprobe timers and the pending indicator until a new local mutation or newer remote observation appears; retryable read-progress stabilization reasons keep bounded retries.
- Added attempt, settlement, suppression, same-version probe suppression, and local-mutation clear diagnostics. High-value retention protects those events alongside lock and transaction terminal evidence.
- Verification: `node --check S1Plus.js`, the three focused foreground/diagnostics tests, `git diff --check`, and the full repository suite (42 scripts) passed. Real browser freeze/termination still requires manual multi-tab validation.
