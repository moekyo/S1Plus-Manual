# Phase 4: 前台探测与可见页轮询重构

## 1. 默认读取集

### 必读

1. [根文档](../../sync_multitab_review_and_redesign.md)
2. 本文档

### 强烈建议补读

- [Phase 2](./phase_2_read_progress_denoising.md)
- [Phase 3](./phase_3_sync_state_layering.md)

### 选读

- [architecture_principles.md](../architecture_principles.md)

## 2. 目标

让 `foreground_resume` 和 `visible_poll` 从“容易放大小差异的危险入口”变成“低打扰、可重试、会等待本地稳定的探测层”。

## 3. 本阶段覆盖的问题

- `3.3.1` 前台 follow-up 复用 startup 模式
- `3.3.2` 可见页 4 分钟轮询会暴露问题
- `3.3.3` `skipped_push_on_startup` 不应直接弹红提示
- `3.3.4` probe / poll 没有显式感知阅读进度 pending / debounce
- `3.5.3` `visibilitychange/pageshow` 与 visible poll 叠加放大旧状态
- `8.3` 一个标签页的局部问题不应冻结所有标签页

## 4. 本阶段要做成什么样

### 4.1 进入 follow-up sync 前先过 probe gate

显式检查：

- 当前页是否存在 `pendingThreadProgressWrites`
- 当前页是否仍在阅读进度同步防抖窗口
- 最近一次阅读进度写入是否来自初始化噪声而非真实阅读

如果命中上述条件：

- 优先记录 `soft block`
- 短延迟重试
- 静默处理

### 4.2 visible poll 改成低打扰探测层

要求：

- 不再把“普通本地未稳定状态”直接升级成红色冲突提示
- 只在真正高严重度场景中上浮

### 4.3 统一前台恢复与 visible poll 的重试策略

要求：

- 避免 `visibilitychange/pageshow` 和 4 分钟轮询重复暴露同一份旧状态
- 在本地状态稳定后再做最终比较

### 4.4 真正高严重度场景仍可上浮

仅当确认：

- pull 会覆盖重要本地更改
- 或已构成真正双边冲突

才允许升级成强提示或全局阻塞

## 5. 本阶段不要顺手做什么

1. 不在这里重做阅读进度 provenance
2. 不在这里重做 cleanup provenance
3. 不在这里完成最终提示文案设计

## 6. 推荐交付物

1. pending/debounce-aware 的 probe gate
2. visible poll 降级策略
3. 前台探测与轮询统一的重试 / backoff 策略
4. 对 `soft block` 的稳定使用方式

## 7. 验收标准

1. 用户阅读 3 到 5 分钟时，不会因为短时阅读进度变动直接收到红色冲突提示。
2. 当前页本地状态尚未稳定时，前台探测优先重试而非冲突化。
3. `visibilitychange/pageshow` 与 visible poll 不会重复放大同一个旧状态。
4. visible poll 只在真正需要时升级为高严重度提示。

## 8. 交给下一阶段的输出

`Phase 5` 和 `Phase 6` 之后处理 cleanup 与 UI 时，会默认认为：

- 前台探测和 visible poll 已经能把低严重度场景压成 soft block 或重试
- 红色提示只保留给真正需要用户介入的场景

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 为 `foreground_resume` / `visible_poll` 接入显式 probe gate，在阅读进度 `pending write`、同步防抖窗口和最近初始化噪声保护窗口内优先返回当前标签页 `soft block`。
  - 前台补偿重试现在会记录剩余等待时间，并在真正执行 follow-up sync 之前再次检查 probe gate，等待本地状态稳定后再继续。
  - 云端 `updated_at` 与本地已同步版本相同后的保守二次确认，以及 metadata-only 发现 `updated_at` 变新但前台补同步被本地待写入门禁暂缓的复查等待，都会以中性 `sync` pending / running 展示；最终 `hash_equal / no_change` 直接回到 idle，不再显示为待拉取或同步成功。
  - 当前标签页已有前台 retry pending 时，新的前台 probe 会直接返回 `followup_retry_pending`，避免 `visibilitychange/pageshow` 与 visible poll 重复拉起同一份旧状态。
  - 保持 visible poll 低打扰：probe gate 命中时不再升级成高严重度提示，仍只在真正冲突场景上浮。
  - `foreground_resume` / `pageshow(persisted)` 现在会先做核心数据 storage snapshot 收敛，再决定是否继续执行远端 freshness probe。
  - 核心数据 snapshot 收敛会同时刷新：
    - core data cache
    - `comparableStoredValueCache`
    - 当前页待处理的跨标签刷新键
  - 若前台恢复阶段检测到 `pending_recovery` 已成功挂起后台补同步，本轮会先返回 `pending_recovery_settle`，不再立即 probe 远端。
  - 当前浏览器会话若刚刚成功执行过本地 push / merged push，前台 probe 现在会识别 `same-session remote write`：
    - 先做 storage snapshot 收敛
    - 前台 follow-up 会改用 fresh snapshot 导出本地数据，避免“旧 cache + 新 baseline”组合
    - 若最终仍需自动拉取，改为静默处理，不再弹“远端更新”类提示
  - 同步诊断新增核心数据收敛观测字段，可直接看到最近一次 snapshot resync 的时间与 key 集。
  - 同步诊断新增 same-session probe 标记，便于区分“外部远端变化”与“同机会话刚写入云端”。
- 涉及文件：
  - `S1Plus.js`
  - `scripts/test-foreground-probe-gate-retry.js`
  - `sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
  - `sync-across-multiple-tab/scripts/test-foreground-trigger-integration.js`
  - `sync-across-multiple-tab/scripts/test-foreground-same-session-remote-write.js`
- 验证：
  - `node --check S1Plus.js`
  - `node scripts/test-safe-sync-execution.js`
  - `node scripts/test-foreground-probe-diagnostics-feedback.js`
  - `node scripts/test-foreground-trigger-integration.js`
  - `node scripts/test-visible-remote-polling.js`
  - `node scripts/test-auto-sync-indicator-linkage.js`
  - `node scripts/test-foreground-probe-gate-retry.js`
  - `node sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
  - `node sync-across-multiple-tab/scripts/test-foreground-trigger-integration.js`
  - `node sync-across-multiple-tab/scripts/test-foreground-same-session-remote-write.js`
  - 说明：当前环境仍无法直接完成 Tampermonkey 浏览器内多标签手测，以上验证以脚本/语法检查为主。
- 剩余工作：
  - 在真实论坛页面补跑多标签手测，确认长时间阅读、后台开帖、bfcache 恢复和 visible poll 的实际体验。
  - 继续观察 same-session quiet handling 在真实论坛中对列表页自动刷新体感是否仍需进一步收紧。
  - 继续观察 same-device writer 文案在真实论坛中的体感，确认是否还需要进一步收紧为更多静默场景。
- 进入 `Phase 5`，处理 cleanup provenance、手动删除来源和当前页处理链路隔离。
- 风险 / 限制：
  - 当前 probe gate 主要面向阅读进度相关的短时本地未稳定状态，cleanup provenance 仍未结构化。
  - `soft block` 与 retry 仍是当前标签页运行时状态，不会跨刷新持久化。
  - 核心数据 snapshot resync 与 comparable cache TTL 已覆盖当前高价值 key；本轮 follow-up 又把 `background / foreground_followup` 默认导出切到 `fresh snapshot`，但更激进的全量 fresh snapshot 策略仍属于后续稳定性增强。
- 下一步：
  - 开始 `Phase 5`，把 cleanup 分支改成有来源、有线程边界、能校验前后关系的结构化状态。

## 10. 2026-04-21 Follow-up

- 已继续补齐“同机误判远端更新”的 Phase 4 遗漏链路：
  - `background / foreground_followup` 现在默认都用 `fresh snapshot`
  - 新增 `s1p_core_data_refresh_signal`，当前页在核心数据监听不可靠时也能通过 signal + storage snapshot 收敛
  - same-session quiet handling 已从 foreground probe 扩展到 background / per-load / daily 的自动拉取刷新策略
- 新增 `same-device remote write` 识别：
  - 当本机配置了 `syncDeviceId` 且远端 `syncMeta.lastWriter.deviceId` 命中当前设备时，自动拉取文案会改成“同设备已同步更新”
  - same-session 仍优先静默，不再把同机会话自己的刚写远端误说成“外部远端变化”
- 本轮补跑验证：
  - `node --check S1Plus.js`
  - `node sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
  - `node sync-across-multiple-tab/scripts/test-foreground-same-session-remote-write.js`
  - `node sync-across-multiple-tab/scripts/test-foreground-trigger-integration.js`
  - `node sync-across-multiple-tab/scripts/test-foreground-remote-probe.js`
  - `node sync-across-multiple-tab/scripts/test-foreground-probe-diagnostics-feedback.js`
  - `node sync-across-multiple-tab/scripts/test-safe-sync-execution.js`
  - `node sync-across-multiple-tab/scripts/test-background-open-passive-session.js`

## 11. 2026-04-25 Follow-up

- `visible_poll` 已从“回到前台检查”中拆出为独立设置 `syncVisibleRemotePollingEnabled`，默认关闭。
- `syncCheckOnReturnToForeground=true` 现在只表示页面首次可见、回到前台、bfcache 恢复时做一次性远端 freshness probe。
- 页面持续可见时的低频 probe 需要同时开启 `syncCheckOnReturnToForeground` 和 `syncVisibleRemotePollingEnabled`。
- 前台 metadata-only probe 不能被本地 `clean-state fence` 吞掉；本地没有待推送只能证明本机不需要 push，不能证明其他设备没有写入远端。
- 前台 probe 命中远端 `updated_at` 变化后，会先执行 storage snapshot 收敛，再用 fresh local snapshot 进入 foreground follow-up。
- 新增远端变化来源分层：
  - `hash_equal_after_resync`
  - `same_session_write`
  - `same_device_write`
  - `external_remote_change`
- 新增 review 文档：`../auto-background-sync-and-cloud-check-review.md`。

## 12. 2026-05-17 Follow-up

- 本轮用户日志显示：后台同步先完成 `merged_read_progress`，随后列表页刷新来自 `background_merge_refresh`，而不是后续前台首次可见 probe 的自动拉取；前台二次确认最终为 `hash_equal / same_machine_hash_equal` 并已静默。
- 因此优化点落在 post-sync refresh policy：
  - `merged_read_progress` 是阅读进度专用自动合并，合并结果已经导入本地，不再按普通 `pulled` 处理。
  - 列表页策略从 `reload_now` 降级为 `read_progress_merged_inline`，只调度阅读进度按钮原地刷新。
  - `pulled / force_pulled` 仍保持原有整页刷新策略，避免把真正云端拉取也静默掉。
  - same-session / same-device 的阅读进度合并会保留 inline refresh，但不显示“云端变化 / 正在刷新页面”。
- 涉及文件：
  - `S1Plus.js`
  - `tests/test-post-sync-refresh-policy.js`
  - `archive/sync-across-multiple-tab/sync_multitab_review_and_redesign.md`
  - `archive/sync-across-multiple-tab/sync_multitab_redesign/phases/phase_4_foreground_probe_and_visible_poll.md`
- 验证：
  - `node --check S1Plus.js`
  - `node tests/test-post-sync-refresh-policy.js`
  - `node tests/test-safe-sync-execution.js`
  - `node tests/test-auto-sync-indicator-linkage.js`
  - `node tests/test-foreground-same-session-remote-write.js`
  - `node tests/test-foreground-trigger-integration.js`
  - `node tests/test-background-open-passive-session.js`
  - `node tests/test-core-data-snapshot-resync.js`
  - `node tests/test-background-sync-shared-debounce.js`
  - `node tests/test-cleanup-provenance-guard.js`
  - `node tests/test-foreground-probe-diagnostics-feedback.js`
  - `node tests/test-foreground-probe-gate-retry.js`
  - `node tests/test-foreground-remote-probe.js`
  - `node tests/test-visible-remote-polling.js`
  - `node tests/test-sync-settings-ui.js`
  - `node tests/test-phase6-interaction-copy.js`
  - `node tests/settings-migration/test-settings-migration.js`
- 剩余工作：
  - 真实论坛 + Tampermonkey 多标签手测仍需补跑，重点确认列表页阅读进度按钮会原地更新且不发生整页 reload。
  - 若仍出现后台未激活帖子页制造阅读进度写入，应继续回到 Phase 2 的真实阅读确认条件排查。

## 13. 2026-05-24 Follow-up

- 本轮现象不是前台 probe 误拉取，而是启动同步在后台阅读进度刚收敛后，又撞上当前帖子新产生的阅读进度本地写入，并把它当成启动期本地较新 hard pause。
- 落地三段式修正：
  - 新增 `classifyLocalSyncDelta()`，用 `baseContentHash` 严格识别 `read_progress_only_changed`；pending request、shared debounce 和 dirty provenance 只进入诊断摘要。
  - `decideSyncActionByVersion()` 在 `startup + local_changed_since_baseline + read_progress_only_changed` 时返回 `merge_read_progress`，不再返回 `skip_push_on_startup`。
  - `performAutoSync()` 把阅读进度合并回写抽成 `mergeReadProgressAndPush()`，供 startup read-progress-only 与原 conflict 自动合并分支共用。
- 关键保护：
  - 核心数据 base hash 不一致时仍保持启动安全暂停。
  - 缺少 base hash 时不会仅凭来源字段自动合并，避免异常旧数据误推。
  - 非后台模式完成 `merged_read_progress` 后会尝试清理已覆盖的 pending / shared debounce，避免旧调度残留再次触发。
- 涉及文件：
  - `S1Plus.js`
  - `tests/test-safe-sync-execution.js`
  - `tests/test-post-sync-refresh-policy.js`
  - `CHANGELOG.md`
  - `archive/sync-across-multiple-tab/sync_multitab_review_and_redesign.md`
  - `archive/sync-across-multiple-tab/sync_multitab_redesign/phases/phase_4_foreground_probe_and_visible_poll.md`
- 验证：
  - `node --check S1Plus.js`
  - `node tests/test-safe-sync-execution.js`
  - `node tests/test-background-sync-shared-debounce.js`
  - `node tests/test-post-sync-refresh-policy.js`
  - `node tests/test-startup-sync-freshness.js`
  - `node tests/test-foreground-trigger-integration.js`
  - `node tests/test-foreground-remote-probe.js`
  - `node tests/test-auto-sync-indicator-linkage.js`
  - `node tests/test-foreground-probe-gate-retry.js`
  - `node tests/test-core-data-snapshot-resync.js`
  - `node tests/settings-migration/test-settings-migration.js`
- 剩余工作：
  - 在真实 Tampermonkey 多标签页环境复现用户日志路径，确认弹窗消失且阅读进度正常回写云端。
  - 若仍出现后台未真实阅读就产生 read_progress，应继续回到 Phase 2 的阅读确认条件排查。
