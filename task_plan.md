# Task Plan: 修复后台同步在页面卸载竞态下卡住

## Goal
让后台同步在页面即将卸载时不会留下无法及时恢复的“已拿锁但未启动”状态，同时保持未确认远端写入时不跨标签页接管的安全边界。

## Phases
- [x] Phase 1: 建立可复现的卸载竞态回归测试并确认最小失败链路
- [x] Phase 2: 设计并实现 Running Sync 与生命周期闸门的安全修复
- [x] Phase 3: 完善锁终态、过期恢复和跨标签页诊断
- [x] Phase 4: 运行聚焦测试、全量相关测试并审查差异
- [x] Phase 5: 整理文档与交付状态
- [x] Follow-up: 修复前台不可重试 soft block 导致的 probe/recovery 循环并补齐日志证据

## Key Questions
1. 页面 `pagehide/beforeunload` 发生时，后台执行锁是否仍处于 `acquiring`，且事务回调尚未开始？
2. 在不冒险删除可能已经进行远端写入的锁前提下，哪些锁可以安全释放或标记为取消？
3. 页面恢复、其他标签页接管和 TTL 过期是否都能生成明确的可观察终态？

## Decisions Made
- 先复用现有 `runRunningSync`、生命周期 adapter 和锁模块，不引入新的运行时文件或独立后台进程。
- 只对“当前页即将卸载且事务尚未进入 `runTransaction`”的锁做安全取消；已进入事务的锁继续保留至正常释放或 TTL 失效。
- 通过测试 seam 验证页面生命周期与锁获取之间的时序，不用只测单个 helper 的源码行为。

## Errors Encountered
- 新增的 Running Sync 生命周期测试在修复前实际进入了 `transaction:run`，证明 `runRunningSync` 没有卸载闸门。
- 新增的生产锁获取测试在修复前返回了有效 authority 并留下模式锁/全局锁，证明 `acquireModeSyncLock` 的异步归属校验被 pagehide 中断后没有回滚。

## Status
**All planned phases complete** - 生命周期卸载竞态、锁终态诊断、存储读写失败清理、token 保护、共享回执去重、文档和全量回归均已完成。最新日志复盘发现：前台 follow-up 的不可重试 `blocked + soft` 被旧 recovery 条件误当成可重试，导致同一远端版本每 600ms 重复执行；现已按 exact `requestId + remoteUpdatedAt` 持久化结果并停止循环。当前工作树保留待用户审阅的代码、测试、文档和规划记录；尚未创建新的提交或推送。

## Verification
- `node --check S1Plus.js` passed.
- All 41 `tests/test-*.js` scripts and `tests/settings-migration/test-settings-migration.js` passed (42 scripts total), including the new pagehide/ownership-verification, lock-storage-failure, expiry-classification, shared-receipt-deduplication, and immediate-microtask lifecycle cases.
- `git diff --check` passed.
- Remaining limitation: browser abrupt termination can still prevent the final owner receipt from being written; exports now label this as missing terminal evidence instead of inferring release or expiry. Cross-tab evidence remains best-effort and depends on the shared GM receipt store.
- Follow-up verification also covers non-retryable foreground soft-block recovery, same-version probe suppression, pending-indicator return to idle, and local-mutation reopening; real browser freeze/termination still requires manual multi-tab validation.
