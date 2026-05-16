# 后台同步共享调度器实现清单

本文是 [后台同步调度 Review 与优化方案](./background-sync-scheduler-review-and-optimization.md) 的落地清单。

- Review 文档负责说明问题、设计边界和取舍。
- 本文负责记录具体实现步骤、验收项、测试命令和实现进度。
- 实现过程中应更新本文 checkbox，而不是把施工细节继续塞回 review 文档。

## 总原则

- 触发侧分治，执行侧统一。
- 推送侧新增跨标签 shared debounce scheduler，合并本地 dirty，减少多标签重复后台推送。
- 拉取侧维持现有 freshness probe / cooldown / gate 流程，只在状态展示和诊断需要时接入统一状态源增强。
- 共同层继续共用全局同步锁、`performAutoSync()` 裁决核心、统一状态源和诊断体系。
- 不改变 baseline / hash 判定、冲突策略、阅读进度自动合并策略、远端推送前 `updated_at` 检查。

## Non-goals

- 不把自动拉取改成 shared debounce scheduler。
- 不把 metadata probe 改成后台推送式调度。
- 不让 `foreground_followup` 在本地较新时反向自动 push。
- 不为标题提示单独增加一套特殊防抖。
- 不重写 `performAutoSync()` 的裁决语义。

## Phase 0: 准备与代码定位

- [x] 回读 review 文档，确认本轮只改后台推送调度层和必要状态展示。
- [x] 定位现有后台推送入口：
  - `READ_PROGRESS_SYNC_DEBOUNCE_MS`
  - `DEFAULT_SYNC_DEBOUNCE_MS`
  - `remotePushTimeout`
  - `armRemotePushTimer()`
  - `debouncedTriggerRemoteSyncPush()`
  - `updateLastModifiedTimestamp()`
  - `triggerRemoteSyncPush()`
  - `performAutoSync()`
- [x] 定位现有 pending / recovery：
  - `PENDING_AUTO_SYNC_KEY`
  - `markPendingAutoSyncRequest()`
  - `clearPendingAutoSyncRequest()`
  - `recoverPendingAutoSyncIfNeeded()`
- [x] 定位现有状态源和诊断：
  - `AUTO_SYNC_INDICATOR_STATE_KEY`
  - `resolveAutoSyncIndicatorDisplayPhase()`
  - `hasActivePendingAutoSyncRequest()`
  - `buildSyncDiagnosticsRows()`
- [x] 确认当前工作树中是否有用户未提交改动，避免误改无关文件。

Phase 0 定位结果（2026-05-05）：

- 现有后台推送仍由每个标签页本地的 `remotePushTimeout` / `armRemotePushTimer()` / `debouncedTriggerRemoteSyncPush()` 排 timer；`read_progress` 为 20 秒防抖，普通 `general` 为 5 秒防抖。
- `updateLastModifiedTimestamp()` 会先写 `s1p_last_modified` 和 `s1p_pending_auto_sync_request`，再进入本地 debounce；初始同步期间会设置 dirty / follow-up 标记。
- pending 仍是单条覆盖式结构，`markPendingAutoSyncRequest()` 只保存 `source`、`lastModified`、`createdAt`；`recoverPendingAutoSyncIfNeeded()` 负责遗留 pending 的兜底补发。
- `resolveAutoSyncIndicatorDisplayPhase()` 当前只识别 pending request、后台锁、冲突暂停和 circuit breaker；诊断表尚无 shared scheduler 字段。
- `performAutoSync()` 成功路径当前仍通过 `asSuccessResult()` 直接调用 `clearPendingAutoSyncRequest()`；本轮未改裁决语义。
- 工作树进入本轮前已有未提交状态：`background-sync-scheduler-review-and-optimization.md` 已修改，`background-sync-scheduler-implementation-checklist.md` 未跟踪；本轮未改 review 文档。

## Phase A: 测试先行

新增测试脚本：

```text
sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js
```

覆盖用例：

- [x] 多个 `read_progress` dirty 合并为同一个 shared debounce state。
- [x] `read_progress` 使用 20 秒 settle window。
- [x] `general` 使用 5 秒 settle window。
- [x] 已有 `general` dueAt 时，后续 `read_progress` 不得推迟它。
- [x] 全是 `read_progress` 时允许 trailing debounce。
- [x] trailing debounce 不超过 `maxWaitUntil`。
- [x] 只有 owner 标签页启动本地 timer。
- [x] 非 owner 标签页只更新共享状态，不启动本地 timer。
- [x] owner lease 未过期时，其他标签页不能抢占。
- [x] owner lease 过期后，其他标签页可以接管。
- [x] owner timer 到点前重读 shared state，旧 generation 不触发同步。
- [x] owner timer 到点触发时先消费 shared state，避免留下过期 owner。
- [x] 同步成功只清理已覆盖的 pending / shared debounce。
- [x] 同步期间出现 newer dirty 时保留 pending，并安排短 follow-up。
- [x] 远程同步关闭、自动同步关闭、配置不完整、冲突暂停时清理调度状态。
- [x] 页面关闭 / bfcache / owner 失效后，pending recovery 仍能兜底。

Phase A 实现结果（2026-05-05）：

- 已新增 `sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js`，以红灯测试形式锁定 shared debounce scheduler 的目标行为和测试钩子表面。
- 本轮未实现 `BACKGROUND_SYNC_DEBOUNCE_STATE_KEY`、shared scheduler helper、owner/timer、covered pending 清理或 follow-up 调度；新增脚本当前预期失败于缺少 shared debounce 测试钩子。
- 本轮未改 `performAutoSync()` 裁决语义，未重构自动拉取侧，未改无关功能。
- 验证结果：`node -c S1Plus.js` 通过；`node sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js` 失败于缺少 `normalizeBackgroundSyncDebounceState`、`requestSharedBackgroundSyncDebounce`、owner/timer、covered cleanup 等 shared debounce 测试钩子，符合 Phase A 红灯状态。

## Phase B: 引入 shared debounce state

新增常量：

- [x] `BACKGROUND_SYNC_DEBOUNCE_STATE_KEY = "s1p_background_sync_debounce_state"`
- [x] `BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS`
- [x] `BACKGROUND_SYNC_DEBOUNCE_OWNER_HEARTBEAT_MS`
- [x] `BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS`
- [x] `BACKGROUND_SYNC_DEBOUNCE_FOLLOW_UP_SETTLE_MS`

新增 state helper：

- [x] `normalizeBackgroundSyncDebounceState(value)`
- [x] `getBackgroundSyncDebounceState()`
- [x] `setBackgroundSyncDebounceState(state)`
- [x] `clearBackgroundSyncDebounceState()`
- [x] `mergeBackgroundSyncDebounceSources(state, source)`
- [x] `mergeBackgroundSyncDebounceThreadIds(state, threadId)`
- [x] `getBackgroundSyncDebounceReason(source)`

state 字段至少包括：

- [x] `version`
- [x] `generation`
- [x] `ownerTabId`
- [x] `ownerLeaseUntil`
- [x] `dueAt`
- [x] `maxWaitUntil`
- [x] `firstDirtyAt`
- [x] `lastDirtyAt`
- [x] `maxLastModified`
- [x] `sources`
- [x] `threadIds`
- [x] `reason`

调度规则：

- [x] `requestSharedBackgroundSyncDebounce({ source, lastModified, threadId })` 更新共享状态。
- [x] 每次 dirty 更新递增 `generation`。
- [x] `maxLastModified` 取最大本地修改时间。
- [x] `firstDirtyAt` 保留最早 dirty 时间。
- [x] `lastDirtyAt` 更新为最近 dirty 时间。
- [x] `sources` 聚合计数。
- [x] `threadIds` 去重并限制长度，避免状态无限膨胀。
- [x] `read_progress` dueAt 使用 trailing debounce，但受 `maxWaitUntil` 约束。
- [x] `general` dueAt 不被后续 `read_progress` 推迟。

## Phase C: owner / timer / lifecycle

新增 owner helper：

- [x] `tryAcquireBackgroundSyncDebounceOwner(state, now)`
- [x] `refreshBackgroundSyncDebounceOwnerLease()`
- [x] `releaseBackgroundSyncDebounceOwner()`
- [x] `scheduleSharedBackgroundSyncDebounceTimer(state)`
- [x] `clearSharedBackgroundSyncDebounceTimer()`
- [x] `handleSharedBackgroundSyncDebounceDue()`

owner 行为：

- [x] 当前标签页成为 owner 后才启动本地 timer。
- [x] owner timer 使用 shared state 的 `dueAt`。
- [x] owner heartbeat 只刷新 debounce owner lease，不替代 background/global sync lock。
- [x] owner 到点后重读 state，校验 `generation` 和 owner 身份。
- [x] owner 到点后调用 `triggerRemoteSyncPush(reason, schedulerContext)`。
- [x] owner 页面 `pagehide` / `beforeunload` 时释放 owner。
- [x] owner lease 过期后，存活标签页可接管。
- [x] 如果 `GM_addValueChangeListener` 可用，监听 shared state 变化以便接管或重排 timer。
- [x] 如果 listener 不可用，依靠 dirty 触发、visibility/page lifecycle、pending recovery 兜底。

Phase B / C 实现结果（2026-05-05）：

- 已在 `S1Plus.js` 增加 `s1p_background_sync_debounce_state` 共享调度状态、owner lease / heartbeat / max wait / follow-up settle 常量，以及 state normalize/get/set/clear、source/threadId 合并和 reason helper。
- 已实现 `requestSharedBackgroundSyncDebounce()`：多次 dirty 递增 `generation`，聚合 `sources` / `threadIds`，保留 `firstDirtyAt`，更新 `lastDirtyAt`，维护 `maxLastModified`；`read_progress` 使用 20 秒 trailing debounce 并受 `maxWaitUntil` 限制，已有 `general` dueAt 不会被后续阅读进度推迟。
- 已实现 owner 获取、续租、释放、timer 调度、到点重读 state 校验、`GM_addValueChangeListener` 接管/重排，以及 `pagehide` / `beforeunload` / `visibilitychange` 生命周期处理。
- 已将 `debouncedTriggerRemoteSyncPush()` 保留为兼容 wrapper，内部转入 shared scheduler；`updateLastModifiedTimestamp(..., { triggerSync: true })` 写 pending 后进入 shared scheduler；owner 到点触发前会消费 shared state，避免 Phase D/F 未接入前留下过期 owner。本轮未重构自动拉取侧，未改变 `performAutoSync()` 的核心裁决。
- 验证结果：`node -c S1Plus.js` 通过；`node sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js` 通过。

## Phase D: pending 聚合与覆盖清理

升级 pending 结构，保留 legacy 兼容：

- [x] `markPendingAutoSyncRequest()` 写入 `lastModified`，同时写入 `maxLastModified`。
- [x] pending 聚合 `sources`、`threadIds`、`firstDirtyAt`、`lastDirtyAt`。
- [x] 读取 pending 时兼容旧结构的 `lastModified`。
- [x] `recoverPendingAutoSyncIfNeeded()` 使用 `maxLastModified || lastModified` 判断是否仍需补发。

新增 covered 清理 helper：

- [x] `clearPendingAutoSyncRequestIfCovered(coveredLastModified, context)`
- [x] `clearSharedBackgroundSyncDebounceIfCovered({ generation, coveredLastModified })`
- [x] 当前 shared state `generation` 未变且 `maxLastModified <= coveredLastModified` 时才清理。
- [x] 当前 shared state `generation` 变大时保留 pending。
- [x] 当前 `maxLastModified > coveredLastModified` 时保留 pending。
- [x] 保留 pending 时安排 `BACKGROUND_SYNC_DEBOUNCE_FOLLOW_UP_SETTLE_MS` 短 follow-up。
- [x] 冲突暂停、手动同步完成、远程同步关闭时仍能主动清理调度状态。

## Phase E: 接入 dirty 写入链路

- [x] 保留 `debouncedTriggerRemoteSyncPush()` 作为 wrapper。
- [x] wrapper 内部改为调用 `requestSharedBackgroundSyncDebounce()`。
- [x] `updateLastModifiedTimestamp(source, { triggerSync: true })` 写 pending 后进入 shared scheduler。
- [x] `triggerSync=false` 只更新时间戳和 provenance，不进入 shared scheduler。
- [x] 初始同步 / 后台同步进行中出现 dirty 时，继续设置现有 dirty flag，并确保 pending / shared state 不被本轮成功误清。
- [x] `readProgressSyncDebounceDueAt` 改为读取 shared debounce dueAt，供 foreground gate 判断阅读进度仍在 settle window。
- [x] 清理旧 `remotePushTimeout` 路径，或让它只作为 shared owner timer 使用。

## Phase F: 接入后台同步执行结果

- [x] `triggerRemoteSyncPush(reason, options)` 接收 scheduler context：
  - `debounceGeneration`
  - `intendedMaxLastModified`
  - `scheduledDueAt`
  - `schedulerReason`
- [x] 进入同步前记录本轮计划覆盖的 `generation` 和 `maxLastModified`。
- [x] `performAutoSync()` 的成功结果补充只读诊断字段，例如 `coveredLocalLastUpdated`，不参与裁决。
- [x] background 成功后用 covered helper 清 pending / shared debounce。
- [x] background 失败后保留 pending，并走现有 retry / circuit breaker。
- [x] background 冲突后清 runtime queue，设置 conflict pause，避免继续自动推送。
- [x] drain-loop 继续负责消化同一个 owner 同步执行期间产生的 dirty。
- [x] shared debounce 只负责合并同步开始前跨标签产生的 dirty。

Phase D / E / F 实现结果（2026-05-05）：

- Phase D 已完成：`s1p_pending_auto_sync_request` 升级为聚合结构，保留 legacy `lastModified` 读取兼容，并新增 `maxLastModified`、`sources`、`threadIds`、`firstDirtyAt`、`lastDirtyAt`；pending recovery 改用 `maxLastModified || lastModified` 判断是否仍需补发。
- Phase E 已完成：`updateLastModifiedTimestamp(..., { triggerSync: true })` 写入聚合 pending 后进入 shared scheduler；`triggerSync=false` 仅更新时间戳和 provenance；同步进行中 dirty 继续走现有 dirty flag / follow-up 机制，且不会被本轮后台成功无条件清除；旧 `remotePushTimeout` / `armRemotePushTimer()` per-tab 路径已移除。
- Phase F 已完成：`triggerRemoteSyncPush(reason, options)` 接收 scheduler context，后台执行前记录本轮 `debounceGeneration` / `intendedMaxLastModified`；`performAutoSync()` 成功结果补充 `coveredLocalLastUpdated` / `coveredLastModified` 只读字段；background 成功后按 covered helper 清理 pending/shared debounce，newer dirty 会保留并排短 follow-up；background failure 保留 pending 并继续 retry / circuit breaker；background conflict 继续清 runtime queue 并进入冲突暂停。
- 本轮未改变 `performAutoSync()` 的核心裁决语义；`foreground_followup` 本地较新仍走 `skip_push_on_foreground_followup` soft block，不会自动 push。
- 验证结果：`node -c S1Plus.js` 通过；`node sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js` 通过；`node sync-across-multiple-tab/scripts/test-safe-sync-execution.js` 通过；`node sync-across-multiple-tab/scripts/test-background-open-passive-session.js` 通过；`node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js` 通过。

## Phase G: 统一状态源与诊断增强

推送侧状态：

- [x] `hasActivePendingAutoSyncRequest()` 同时识别 pending request 和 active shared debounce state。
- [x] `resolveAutoSyncIndicatorDisplayPhase()` 在 shared pending / retry 存在时保持 `pending`。
- [x] 有 background/global active lock 时显示 `running`。
- [x] 无 pending、无 active lock、无 retry 时才显示最终 success / failure / conflict。

拉取侧小增强：

- [x] 保持现有 foreground freshness probe / cooldown / gate 流程。
- [x] foreground probe in-flight 时统一状态源可表达探测中。
- [x] foreground follow-up sync in-flight 时统一状态源可表达 running。
- [x] foreground retry pending 时统一状态源可表达 pending。
- [x] foreground gate 暂缓时诊断能显示 block reason / retryAfterMs。
- [x] 不把 foreground 拉取侧接入 shared debounce scheduler。
- [x] 不让 `foreground_followup` 本地较新时自动 push。

诊断字段：

- [x] shared scheduler owner。
- [x] owner lease 剩余时间。
- [x] dueAt / maxWaitUntil。
- [x] generation。
- [x] sources。
- [x] threadIds。
- [x] maxLastModified。
- [x] coveredGeneration。
- [x] coveredLastModified。
- [x] drain-loop 轮次。
- [x] 成功后是否保留 newer pending。

## Phase H: 设置、暂停与清理

- [x] 远程同步关闭时清理 shared debounce state。
- [x] 自动同步关闭时清理 shared debounce state。
- [x] Gist ID / PAT / device ID 配置不完整时清理 shared debounce state。
- [x] conflict pause 开启时清理 owner timer，并阻止新 owner 启动。
- [x] conflict pause 清除后，不主动同步旧 dirty；依靠 pending recovery 或下一次 dirty 触发。
- [x] 手动同步开始时阻止后台 owner 触发。
- [x] 手动同步成功后清理已覆盖 pending / shared debounce。
- [x] 页面恢复可见时尝试 recover pending 并接管过期 owner。

## Phase I: 回归验证

语法检查：

```bash
node -c S1Plus.js
```

专项测试：

```bash
node sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js
```

同步回归：

```bash
node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js
node sync-across-multiple-tab/scripts/test-safe-sync-execution.js
node sync-across-multiple-tab/scripts/test-foreground-trigger-integration.js
node sync-across-multiple-tab/scripts/test-foreground-probe-gate-retry.js
node sync-across-multiple-tab/scripts/test-background-open-passive-session.js
node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js
node sync-across-multiple-tab/scripts/test-settings-migration.js
node sync-across-multiple-tab/scripts/test-sync-settings-ui.js
```

建议补跑：

```bash
node sync-across-multiple-tab/scripts/test-foreground-probe-diagnostics-feedback.js
node sync-across-multiple-tab/scripts/test-foreground-remote-probe.js
node sync-across-multiple-tab/scripts/test-foreground-same-session-remote-write.js
node sync-across-multiple-tab/scripts/test-visible-remote-polling.js
```

Phase G / H / I 实现结果（2026-05-05）：

- Phase G 已完成：统一状态源现在同时读取 shared debounce、pending request、background retry、foreground retry、foreground probe/follow-up in-flight 和全局同步锁；shared pending / retry 会覆盖旧 success/failure TTL 显示为 pending，active lock / foreground in-flight 会显示 running；标题文案可区分前台探测中、follow-up 同步中和前台重试等待。
- Phase G 诊断已完成：同步诊断默认值、规范化、面板和复制摘要新增 shared scheduler owner、lease、dueAt、maxWaitUntil、generation、sources、threadIds、maxLastModified、covered generation / lastModified、drain-loop 轮次、cleanup 结果、是否保留 newer pending，以及 foreground gate / retry 的 retryAfterMs / retryWaitUntil。
- Phase H 已完成：远程同步关闭、自动同步关闭、Gist ID / PAT / device ID 不完整、conflict pause 和手动同步开始都会停止 shared scheduler runtime；conflict pause 清除后不主动触发旧 dirty；手动同步成功沿用现有成功清理路径清掉已覆盖 pending / shared debounce；页面恢复可见继续走 pending recovery 和过期 owner 接管。
- Phase I 已完成：下列语法检查、专项测试、同步回归和建议补跑项均已执行通过。`test-sync-settings-ui.js` 首轮发现设备 ID 说明文案缺少 local-only / 非裁决语义，本轮已补齐后重跑通过。

## 手工验收

- [ ] 打开多个帖子逐个阅读，短时间内多个阅读进度 dirty 尽量合并为一次后台推送。
- [ ] 同步执行期间确实产生新 dirty 时，最多出现一次必要 follow-up。
- [ ] 成功后不会因为旧标签页 timer 陆续到点而连续触发多轮后台同步。
- [ ] 普通数据变更仍保持 5 秒防抖，不被阅读进度 20 秒窗口延后。
- [ ] 页面关闭、bfcache 恢复、owner 标签页失效后，pending 仍可恢复。
- [ ] 冲突暂停、手动同步、远程同步关闭时，shared scheduler 立即停止或清理。
- [ ] 自动拉取侧仍按 foreground probe / gate / retry 运转，没有被改成后台推送式调度。
- [ ] 导航栏、标题、诊断状态能区分 pending、running、success、failure、conflict。

## 风险点

- [ ] `GM_setValue` 跨标签写入不是事务，owner 获取需要二次读取确认。
- [ ] 旧 owner 的 timer 可能晚到，触发前必须重读 generation。
- [ ] 成功清 pending 不能无条件删除，否则会吞掉其他标签页的新 dirty。
- [ ] foreground gate 依赖阅读进度 debounce dueAt，切到 shared scheduler 后要继续给 gate 提供准确窗口。
- [ ] 状态源若只看 pending，不看 shared debounce，仍可能短暂落 success。
- [ ] shared state 中的 `threadIds` 必须限长，避免高频阅读无限增长。

## 实现进度

- [x] Phase 0: 准备与代码定位
- [x] Phase A: 测试先行
- [x] Phase B: 引入 shared debounce state
- [x] Phase C: owner / timer / lifecycle
- [x] Phase D: pending 聚合与覆盖清理
- [x] Phase E: 接入 dirty 写入链路
- [x] Phase F: 接入后台同步执行结果
- [x] Phase G: 统一状态源与诊断增强
- [x] Phase H: 设置、暂停与清理
- [x] Phase I: 回归验证
