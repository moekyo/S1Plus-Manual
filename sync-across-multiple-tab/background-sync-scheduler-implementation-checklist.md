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

- [ ] `BACKGROUND_SYNC_DEBOUNCE_STATE_KEY = "s1p_background_sync_debounce_state"`
- [ ] `BACKGROUND_SYNC_DEBOUNCE_OWNER_LEASE_MS`
- [ ] `BACKGROUND_SYNC_DEBOUNCE_OWNER_HEARTBEAT_MS`
- [ ] `BACKGROUND_SYNC_DEBOUNCE_MAX_WAIT_MS`
- [ ] `BACKGROUND_SYNC_DEBOUNCE_FOLLOW_UP_SETTLE_MS`

新增 state helper：

- [ ] `normalizeBackgroundSyncDebounceState(value)`
- [ ] `getBackgroundSyncDebounceState()`
- [ ] `setBackgroundSyncDebounceState(state)`
- [ ] `clearBackgroundSyncDebounceState()`
- [ ] `mergeBackgroundSyncDebounceSources(state, source)`
- [ ] `mergeBackgroundSyncDebounceThreadIds(state, threadId)`
- [ ] `getBackgroundSyncDebounceReason(source)`

state 字段至少包括：

- [ ] `version`
- [ ] `generation`
- [ ] `ownerTabId`
- [ ] `ownerLeaseUntil`
- [ ] `dueAt`
- [ ] `maxWaitUntil`
- [ ] `firstDirtyAt`
- [ ] `lastDirtyAt`
- [ ] `maxLastModified`
- [ ] `sources`
- [ ] `threadIds`
- [ ] `reason`

调度规则：

- [ ] `requestSharedBackgroundSyncDebounce({ source, lastModified, threadId })` 更新共享状态。
- [ ] 每次 dirty 更新递增 `generation`。
- [ ] `maxLastModified` 取最大本地修改时间。
- [ ] `firstDirtyAt` 保留最早 dirty 时间。
- [ ] `lastDirtyAt` 更新为最近 dirty 时间。
- [ ] `sources` 聚合计数。
- [ ] `threadIds` 去重并限制长度，避免状态无限膨胀。
- [ ] `read_progress` dueAt 使用 trailing debounce，但受 `maxWaitUntil` 约束。
- [ ] `general` dueAt 不被后续 `read_progress` 推迟。

## Phase C: owner / timer / lifecycle

新增 owner helper：

- [ ] `tryAcquireBackgroundSyncDebounceOwner(state, now)`
- [ ] `refreshBackgroundSyncDebounceOwnerLease()`
- [ ] `releaseBackgroundSyncDebounceOwner()`
- [ ] `scheduleSharedBackgroundSyncDebounceTimer(state)`
- [ ] `clearSharedBackgroundSyncDebounceTimer()`
- [ ] `handleSharedBackgroundSyncDebounceDue()`

owner 行为：

- [ ] 当前标签页成为 owner 后才启动本地 timer。
- [ ] owner timer 使用 shared state 的 `dueAt`。
- [ ] owner heartbeat 只刷新 debounce owner lease，不替代 background/global sync lock。
- [ ] owner 到点后重读 state，校验 `generation` 和 owner 身份。
- [ ] owner 到点后调用 `triggerRemoteSyncPush(reason, schedulerContext)`。
- [ ] owner 页面 `pagehide` / `beforeunload` 时释放 owner。
- [ ] owner lease 过期后，存活标签页可接管。
- [ ] 如果 `GM_addValueChangeListener` 可用，监听 shared state 变化以便接管或重排 timer。
- [ ] 如果 listener 不可用，依靠 dirty 触发、visibility/page lifecycle、pending recovery 兜底。

## Phase D: pending 聚合与覆盖清理

升级 pending 结构，保留 legacy 兼容：

- [ ] `markPendingAutoSyncRequest()` 写入 `lastModified`，同时写入 `maxLastModified`。
- [ ] pending 聚合 `sources`、`threadIds`、`firstDirtyAt`、`lastDirtyAt`。
- [ ] 读取 pending 时兼容旧结构的 `lastModified`。
- [ ] `recoverPendingAutoSyncIfNeeded()` 使用 `maxLastModified || lastModified` 判断是否仍需补发。

新增 covered 清理 helper：

- [ ] `clearPendingAutoSyncRequestIfCovered(coveredLastModified, context)`
- [ ] `clearSharedBackgroundSyncDebounceIfCovered({ generation, coveredLastModified })`
- [ ] 当前 shared state `generation` 未变且 `maxLastModified <= coveredLastModified` 时才清理。
- [ ] 当前 shared state `generation` 变大时保留 pending。
- [ ] 当前 `maxLastModified > coveredLastModified` 时保留 pending。
- [ ] 保留 pending 时安排 `BACKGROUND_SYNC_DEBOUNCE_FOLLOW_UP_SETTLE_MS` 短 follow-up。
- [ ] 冲突暂停、手动同步完成、远程同步关闭时仍能主动清理调度状态。

## Phase E: 接入 dirty 写入链路

- [ ] 保留 `debouncedTriggerRemoteSyncPush()` 作为 wrapper。
- [ ] wrapper 内部改为调用 `requestSharedBackgroundSyncDebounce()`。
- [ ] `updateLastModifiedTimestamp(source, { triggerSync: true })` 写 pending 后进入 shared scheduler。
- [ ] `triggerSync=false` 只更新时间戳和 provenance，不进入 shared scheduler。
- [ ] 初始同步 / 后台同步进行中出现 dirty 时，继续设置现有 dirty flag，并确保 pending / shared state 不被本轮成功误清。
- [ ] `readProgressSyncDebounceDueAt` 改为读取 shared debounce dueAt，供 foreground gate 判断阅读进度仍在 settle window。
- [ ] 清理旧 `remotePushTimeout` 路径，或让它只作为 shared owner timer 使用。

## Phase F: 接入后台同步执行结果

- [ ] `triggerRemoteSyncPush(reason, options)` 接收 scheduler context：
  - `debounceGeneration`
  - `intendedMaxLastModified`
  - `scheduledDueAt`
  - `schedulerReason`
- [ ] 进入同步前记录本轮计划覆盖的 `generation` 和 `maxLastModified`。
- [ ] `performAutoSync()` 的成功结果补充只读诊断字段，例如 `coveredLocalLastUpdated`，不参与裁决。
- [ ] background 成功后用 covered helper 清 pending / shared debounce。
- [ ] background 失败后保留 pending，并走现有 retry / circuit breaker。
- [ ] background 冲突后清 runtime queue，设置 conflict pause，避免继续自动推送。
- [ ] drain-loop 继续负责消化同一个 owner 同步执行期间产生的 dirty。
- [ ] shared debounce 只负责合并同步开始前跨标签产生的 dirty。

## Phase G: 统一状态源与诊断增强

推送侧状态：

- [ ] `hasActivePendingAutoSyncRequest()` 同时识别 pending request 和 active shared debounce state。
- [ ] `resolveAutoSyncIndicatorDisplayPhase()` 在 shared pending / retry 存在时保持 `pending`。
- [ ] 有 background/global active lock 时显示 `running`。
- [ ] 无 pending、无 active lock、无 retry 时才显示最终 success / failure / conflict。

拉取侧小增强：

- [ ] 保持现有 foreground freshness probe / cooldown / gate 流程。
- [ ] foreground probe in-flight 时统一状态源可表达探测中。
- [ ] foreground follow-up sync in-flight 时统一状态源可表达 running。
- [ ] foreground retry pending 时统一状态源可表达 pending。
- [ ] foreground gate 暂缓时诊断能显示 block reason / retryAfterMs。
- [ ] 不把 foreground 拉取侧接入 shared debounce scheduler。
- [ ] 不让 `foreground_followup` 本地较新时自动 push。

诊断字段：

- [ ] shared scheduler owner。
- [ ] owner lease 剩余时间。
- [ ] dueAt / maxWaitUntil。
- [ ] generation。
- [ ] sources。
- [ ] threadIds。
- [ ] maxLastModified。
- [ ] coveredGeneration。
- [ ] coveredLastModified。
- [ ] drain-loop 轮次。
- [ ] 成功后是否保留 newer pending。

## Phase H: 设置、暂停与清理

- [ ] 远程同步关闭时清理 shared debounce state。
- [ ] 自动同步关闭时清理 shared debounce state。
- [ ] Gist ID / PAT / device ID 配置不完整时清理 shared debounce state。
- [ ] conflict pause 开启时清理 owner timer，并阻止新 owner 启动。
- [ ] conflict pause 清除后，不主动同步旧 dirty；依靠 pending recovery 或下一次 dirty 触发。
- [ ] 手动同步开始时阻止后台 owner 触发。
- [ ] 手动同步成功后清理已覆盖 pending / shared debounce。
- [ ] 页面恢复可见时尝试 recover pending 并接管过期 owner。

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
- [ ] Phase B: 引入 shared debounce state
- [ ] Phase C: owner / timer / lifecycle
- [ ] Phase D: pending 聚合与覆盖清理
- [ ] Phase E: 接入 dirty 写入链路
- [ ] Phase F: 接入后台同步执行结果
- [ ] Phase G: 统一状态源与诊断增强
- [ ] Phase H: 设置、暂停与清理
- [ ] Phase I: 回归验证
