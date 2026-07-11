# S1 Plus 多标签性能回归诊断与验证方案

日期：2026-05-06

范围：从 `0d172c9547c024f8e57b9eda31d6b334ca4625f9` 到当前工作区的标题同步状态、后台自动同步 shared scheduler、前台自动拉取相关改动。

## 1. 结论摘要

这次性能问题应按“直接触发器 + 放大器 + 独立风险”理解。

| 级别 | 问题 | 当前判断 |
| --- | --- | --- |
| P0 | 标题同步状态 owner lease 选举/续租自激 | 现场复现已坐实，是这次 CPU 飙高的直接主因 |
| P1 | 标题同步 GM listener 直接跑完整 `syncTitleSyncStatusRuntime()` | P0 的主要放大器，每次 owner/presence/state 写入都会唤醒多 tab |
| P1 | `recoverPendingAutoSyncIfNeeded()` 绕过 shared scheduler | 仍是独立高风险项，但本次现场日志没有显示它是主路径 |
| P2 | `releaseTitleSyncStatusOwnerLease()` 对空 owner 也可能 `GM_deleteValue` | 潜在无意义 owner change 放大器 |
| P2 | 500ms 标题动画 tick 每次重跑完整 runtime | running 阶段持续增加 GM 读压力 |
| P2 | presence 采用整对象 read-modify-write | 多 tab 同时写时容易互相覆盖，诱发 owner 视图不一致 |

旧结论中“`recoverPendingAutoSyncIfNeeded()` 是 CPU 风暴启动器”需要修正：它确实可能启动后台同步/retry 风暴，但当前实测复现的直接启动器是标题同步状态的 owner lease 抖动。

## 2. 现场证据

用户复现时，多个 S1 标签页同时显示了 `[同步中.]` / `[同步中..]` / `[同步中...]`，这说明标题同步状态的单 owner 约束已经失效：正常情况下最多只能有一个后台 tab 显示标题同步状态。

Chrome DevTools 中 `S1P-PERF` 诊断在一个 10 秒窗口内记录到：

| 指标 | 次数 / 10 秒 | 含义 |
| --- | ---: | --- |
| `titleStatus.gmListener.owner` | 1804 | `TITLE_SYNC_STATUS_OWNER_KEY` 高频变更，所有 tab 被唤醒 |
| `titleStatus.runtime` | 1690 | 被 owner change 触发的完整标题 runtime |
| `titleStatus.ownerLeaseWrite` | 116 | 当前 tab 自己也在反复写 owner lease |
| `autoSyncIndicator.resolveDisplayPhase` | 1690 | runtime 热路径反复读取/解析同步显示状态 |
| `titleStatus.runtimeSkip` | 116 | runtime 重入保护生效，但只能跳过部分重入，挡不住跨 tab 风暴 |

同一段日志里，`autoSyncIndicator.resolveDisplayPhase` 的 `displayReason` 是 `foreground_probe_in_flight`，即当时处于前台自动拉取探测的 running 显示态。这个 running 状态本身不是问题，问题是它让标题同步状态进入需要 owner 控制显示的阶段，而 owner 选举开始抖动。

如果本次是 `recoverPendingAutoSyncIfNeeded()` 主导，预期应看到这些日志明显上升：

- `recoverPendingAutoSyncIfNeeded` with `status=scheduled`
- `requestBackgroundSyncRun.timerScheduled` with `reason=pending_recovery`
- `backgroundSync.lockCollision`
- `backgroundRetry.scheduled`

现场主要看到的是 `titleStatus.gmListener.owner` 和 `titleStatus.ownerLeaseWrite` 风暴，因此本次 P0 应落在标题 owner lease 链路。

## 3. 触发链路

这不是“多个标签页挂久了必然触发”，而是多条件叠加后更容易触发：

1. 打开了多个 S1 标签页。
2. 开启了“标题显示同步状态”。
3. 某段时间进入 running 显示态，例如 `foreground_probe_in_flight`、后台同步、手动同步。
4. 多个 tab 的 presence/owner 视图出现不一致。
5. owner lease 到期、接近续租窗口，或由于 presence 排序变化被判定需要换 owner。
6. 多个 tab 几乎同时认为“自己应该是 title status owner”。
7. 每个 tab 写 `TITLE_SYNC_STATUS_OWNER_KEY`。
8. owner key 的 GM change 事件广播到所有 tab。
9. 所有 tab 再次执行 `syncTitleSyncStatusRuntime()`，部分 tab 再次写 owner lease。
10. 循环放大，CPU 被同步 GM 读写、DOM title 更新和 listener callback 占满。

简化流程：

```text
Tab A/B/C... 读 presence + owner
  -> 各自本地计算 preferred owner
  -> 多个 tab 认为自己是 owner
  -> 写 s1p_title_sync_status_owner
  -> 所有 tab 的 GM_addValueChangeListener 被唤醒
  -> 每个 tab 跑 syncTitleSyncStatusRuntime()
  -> 再次读 GM 状态、计算 owner、可能续租
  -> owner key 再写入
```

## 4. 具体热点

行号基于 2026-05-06 当前 debug 工作区，后续编辑后可能偏移。

| 位置 | 问题 |
| --- | --- |
| `S1Plus.js:26984` `writeCurrentTitleSyncStatusPresence()` | presence 是整个 tabs 对象 read-modify-write，多 tab 同时写时容易丢失其他 tab 的记录 |
| `S1Plus.js:27047` `writeTitleSyncStatusOwnerLease()` | 只要调用就直接写 owner lease，没有写前确认当前 owner 状态是否仍允许本 tab 写 |
| `S1Plus.js:27104` `resolveTitleSyncStatusTabDisplayDecision()` | owner 由每个 tab 根据本地 presence/owner 视图独立计算，非原子 |
| `S1Plus.js:27144` owner preferred sorting | 使用 `lastActiveAt` / `createdAt` 排序，presence 视图不一致时不同 tab 可能选出不同 owner |
| `S1Plus.js:27365` `maybeRefreshTitleSyncStatusOwnerLease()` | owner change 触发的 runtime 也可能续租，导致自激 |
| Sync Indicator 投影热路径（现为 `readSyncIndicatorStateProjection()` / `projectSyncIndicatorState()`） | runtime 热路径会读取多项 GM 状态，多 tab storm 下读放大明显 |
| `S1Plus.js:27619` owner GM listener | `TITLE_SYNC_STATUS_OWNER_KEY` 每次变化都直接跑完整 runtime，没有 debounce，也没有“owner_change 不续租”保护 |

## 5. 为什么多个标签会同时显示同步中

标题同步状态的设计目标是：

- 有前台 tab 时，不需要后台 tab 显示同步状态。
- 没有前台 tab 时，只选一个后台 tab 作为 owner，在标题上显示 `[同步中.]`。

现场多个标签显示 `[同步中.]`，说明多个 tab 在同一时间窗口内都得到了 `shouldDisplay=true`。这通常来自两个原因：

1. 不同 tab 读到的 presence 不一致，所以 `preferredOwnerTabId` 不一致。
2. owner key 正在快速被不同 tab 覆盖，某些 tab 刚写完 owner，马上认为自己是 owner 并开始显示。

因此“多个标签显示同步中”不是 UI 小问题，而是 owner 选举已经抖动的可见证据。

## 6. `recoverPendingAutoSyncIfNeeded()` 的独立风险

虽然本次现场 P0 是标题 owner lease 风暴，但 `recoverPendingAutoSyncIfNeeded()` 仍然需要修。

该函数在初始化时运行，也会在 `pageshow` / `visibilitychange -> visible` 时再次运行。它看到 `s1p_pending_auto_sync_request` 后，只检查本 tab 的局部 busy 状态：

- `isInitialSyncInProgress`
- `isBackgroundAutoSyncInProgress`
- `hasPendingBackgroundSync`
- `backgroundSyncRetryTimeout`

它没有先检查全局 `s1p_background_sync_debounce_state` 是否已经覆盖当前 pending，也没有尊重 shared scheduler 的 owner lease。结果是多个新 tab 在同一个 pending 存在时可能各自调用 `requestBackgroundSyncRun("pending_recovery", 600)`，排自己的 per-tab timer。

这条链路的风险是：

```text
多个新 tab 看到同一个 pending
  -> 每个 tab 排 pending_recovery timer
  -> 多个 triggerRemoteSyncPush 同时抢 background sync lock
  -> 抢不到的 tab scheduleBackgroundSyncRetry
  -> retry / indicator state write 继续触发标题同步 GM listener
```

所以它不是这次现场日志里的直接主因，但它能和标题 owner storm 互相放大，仍应作为 P1 修复。

## 7. 为什么自动拉取没有同样爆

自动拉取和标题状态都使用 timer、GM 状态、跨标签事件，但拓扑不同。

| 自动拉取 / foreground probe | 标题状态 / pending recovery 风险 |
| --- | --- |
| hidden tab 不跑首次 foreground probe | 多个 tab 都会初始化标题状态 listener |
| visible polling 在 hidden 时停止 | 标题 heartbeat 在启用路径下每 tab 运行 |
| 有 shared cooldown 和 probe lock | 标题 owner 选举没有原子 CAS |
| 前台 retry 要求页面 visible | 标题 owner listener 不按 visible 限制 |
| 分钟级轮询 | 标题 heartbeat 10s，running 动画 500ms |
| 同一个 probe lock 控制跨 tab 执行 | owner key 写入本身会唤醒所有 tab，再触发可能的下一次写入 |

自动拉取是“可见 tab 主动检查 + 全局 probe lock/cooldown”。标题状态这条问题路径是“所有 tab 监听同一个 owner key，listener 被唤醒后又可能写同一个 owner key”。后者更容易形成正反馈。

## 8. 修复建议

### P0：修标题 owner lease 自激

目标：owner key 变化不能导致 owner key 再次被多 tab 抢写。

建议：

1. `owner_change` listener 不直接执行会续租 owner 的完整 runtime，改为轻量刷新或 debounced runtime。
2. 给 `syncTitleSyncStatusRuntime()` 增加来源语义，例如 `{ allowOwnerLeaseRefresh: false }`，owner/presence listener 默认不续租。
3. `maybeRefreshTitleSyncStatusOwnerLease()` 写前重新读取 owner：
   - 如果当前 owner 是其他 tab 且 lease 仍有效，直接返回，不抢。
   - 如果当前 owner 是自己，且剩余 lease 足够，不写。
   - 如果当前 owner 为空或已过期，才允许接管。
4. 写 owner lease 后做一次 verify；如果写入后 owner 不是自己，立即停止显示。
5. owner 切换加入 grace/hysteresis，避免 `lastActiveAt` 微小变化导致来回切换。
6. 当 display phase 是 idle，或者存在 foreground tab 时，不需要积极续租 owner。

### P1：降低标题 GM listener 放大

建议：

1. `TITLE_SYNC_STATUS_OWNER_KEY`、`TITLE_SYNC_STATUS_PRESENCE_KEY`、`AUTO_SYNC_INDICATOR_STATE_KEY` listener 合并成 debounce，例如 100-250ms。
2. `AUTO_SYNC_INDICATOR_STATE_KEY` 的标题 listener 加 guard，参考导航栏 listener：
   - `isCrossContextChange`
   - `autoSyncIndicatorWriteInFlightCount`
   - `hasComparableValueChanged`
3. Sync Indicator 投影路径增加短 TTL 内存缓存，例如 200-500ms。
4. `animation_tick` 只推进标题动画帧，不重新读取所有 GM runtime 状态。

### P1：修 pending recovery 绕过 shared scheduler

建议：

1. `recoverPendingAutoSyncIfNeeded()` 读取 `s1p_background_sync_debounce_state`。
2. 如果 shared debounce 已覆盖当前 pending 且 owner lease 有效，返回 skipped，例如 `covered_by_shared_debounce`。
3. 如果 shared debounce 存在但 owner lease 过期，尝试接管 shared debounce owner，而不是排 per-tab `requestBackgroundSyncRun`。
4. 只有没有 shared debounce 覆盖 pending 时，才允许恢复调度。

### P2：其他降噪

建议：

1. `releaseTitleSyncStatusOwnerLease()` 在 owner 为空时不要 `GM_deleteValue`。
2. presence 写入前 merge 最新 state，降低整对象覆盖概率。
3. heartbeat 无状态变化时不写 presence。
4. 标题状态关闭时，尽量不绑定或尽早退出 GM listener 热路径。

## 9. 验证方案

### 9.1 手动观察

性能诊断开关和 `S1P-PERF` 埋点已在修复完成后移除。后续实测使用浏览器任务管理器、DevTools Performance 面板和肉眼标题状态观察。

建议记录：

- Chrome/Edge 任务管理器里 S1 tab 的 CPU 是否长期接近 100%。
- 是否有多个 S1 tab 同时显示 `[同步中.]`。
- 选中任意一个 S1 tab 时，后台 S1 tab 是否仍显示同步提示。
- 睡眠唤醒或切换一组 S1 tab 时，CPU 峰值是否很快回落。

### 9.2 验证 A：标题 owner storm

前置：

- 开启远程同步。
- 开启标题显示同步状态。
- 打开 10 个以上 S1 tab。
- 触发一次 running 状态，例如前台自动探测、后台同步、手动同步。

修复前预期：

- 可能多个 tab 同时显示 `[同步中.]`。
- `titleStatus.gmListener.owner` 在 10 秒窗口内可达到数百到数千次。
- `titleStatus.ownerLeaseWrite` 在 10 秒窗口内明显大于 1。
- CPU 可升至 99-100%。

修复后成功标准：

- 同一时间最多一个 tab 显示 `[同步中.]`。
- `titleStatus.gmListener.owner` 不随 tab 数爆炸。
- `titleStatus.ownerLeaseWrite` 接近 owner lease 续租频率，不出现每秒多次。
- `titleStatus.runtime` 不再和 owner listener 等量暴涨。
- CPU 不再因 S1 多标签长期占满。

### 9.3 验证 B：关闭标题状态隔离

前置：

- 关闭标题显示同步状态。
- 保持远程同步和自动拉取开启。
- 打开同样数量的 S1 tab。

预期：

- `titleStatus.*` 相关指标应消失或接近 0。
- 如果 CPU 仍然飙高，再重点检查 pending recovery / background retry。
- 如果 CPU 明显下降，说明标题状态链路是主放大器。

### 9.4 验证 C：pending recovery shared scheduler

前置：

- 开启阅读进度同步和后台自动同步。
- 制造一个阅读进度 dirty。
- 在 read progress debounce 窗口内打开多个新 S1 tab。

修复前风险信号：

- 多个 tab 出现 `recoverPendingAutoSyncIfNeeded status=scheduled`。
- 多个 tab 出现 `requestBackgroundSyncRun.timerScheduled reason=pending_recovery`。
- 出现 `backgroundSync.lockCollision` 和 `backgroundRetry.scheduled`。

修复后成功标准：

- 当 shared debounce 覆盖 pending 时，新 tab 应返回 skipped，例如 `covered_by_shared_debounce`。
- 同一个 pending 不应导致多个 per-tab `pending_recovery` timer。
- background sync lock collision 不应随 tab 数增长。

### 9.5 验证 D：自动拉取对照

前置：

- 开启前台自动拉取 / visible polling。
- 不制造本地 pending dirty。
- 打开多个 S1 tab，切换前后台。

预期：

- hidden tab 不主动 probe。
- probe 受 shared cooldown / lock 控制。
- 不出现大量 `titleStatus.gmListener.owner`。
- 不出现 pending recovery timer 风暴。

### 9.6 Performance 面板采样

CPU 飙高时录制 10-20 秒 Performance。重点查看调用栈是否集中在：

- `GM_addValueChangeListener` callback
- `syncTitleSyncStatusRuntime`
- `runTitleSyncStatusRuntimeSync`
- `readSyncIndicatorStateProjection`
- `getTitleSyncStatusOwnerState`
- `writeTitleSyncStatusOwnerLease`
- `GM_getValue`
- `GM_setValue`

如果修复后仍有高 CPU，但调用栈转移到：

- `recoverPendingAutoSyncIfNeeded`
- `requestBackgroundSyncRun`
- `triggerRemoteSyncPush`
- `scheduleBackgroundSyncRetry`

则说明 pending recovery 独立风险仍需继续处理。

## 10. 修复进度

更新时间：2026-05-06

总体状态：完整版重构已完成代码落地，自动化回归测试已通过；还需要安装到 Tampermonkey/Greasemonkey 后做一次真实多标签复测，确认不再出现 owner storm 或 shared scheduler retry 风暴。

| 项目 | 优先级 | 当前状态 | 已完成内容 | 验证状态 | 剩余动作 |
| --- | --- | --- | --- | --- | --- |
| 标题 owner lease 自激 | P0 | 已重构修复 | listener 触发的 runtime 默认禁止续租；owner 写前确认有效 lease；写后使用 token/generation verify；有效 owner lease 未过期时保持 owner 稳定 | `test-title-sync-status.js` 已覆盖 owner guard / lease stability，自动化通过 | 浏览器实测 10+ S1 tab，确认同一时间最多一个 tab 显示 `[同步中.]` |
| 标题 GM listener storm | P1 | 已修复 | owner/presence/state GM listener 合并为 150ms debounce；`AUTO_SYNC_INDICATOR_STATE_KEY` 增加本地写入和无差异变化 guard | `test-title-sync-status.js`、`test-auto-sync-indicator-linkage.js` 通过 | 实测观察 CPU 不再随 tab 数持续升高，标题同步状态不再多 tab 抢显示 |
| 当前选中的 S1 tab 被误判为后台 | P1 | 已修复 | 标题状态 foreground 判定改为 `visibilityState === "visible"`；`document.hasFocus()` 仅保留作诊断信息 | `test-title-sync-status.js` 已覆盖 visible-but-not-focused 场景，自动化通过 | 实测选中任意 S1 tab 时，后台 tab 不应继续显示 `[同步中.]` |
| runtime 热路径 GM 读放大 | P1 | 已修复 | 标题 runtime 对 `readSyncIndicatorStateProjection({ surface: "title", allowCache: true })` 启用 250ms 短缓存；其它路径默认实时读取 | `test-auto-sync-indicator-linkage.js` 覆盖缓存不影响实时读取，已通过 | 实测观察 Sync Indicator 投影频率明显下降 |
| pending recovery 绕过 shared scheduler | P1 | 已修复 | `recoverPendingAutoSyncIfNeeded()` 先检查 shared debounce 是否覆盖 pending；必要时接管 shared owner，不直接排 per-tab recovery | `test-background-sync-shared-debounce.js` 已覆盖 `covered_by_shared_debounce`，通过 | 实测 pending dirty + 多 tab 打开时不应出现多个 `pending_recovery` timer |
| background retry per-tab timer | P1 | 已重构修复 | `scheduleBackgroundSyncRetry()` 优先进入 shared debounce forced-delay 路径，由 shared owner 排 retry timer | `test-background-sync-shared-debounce.js` 已覆盖 `background_retry` forced dueAt，自动化通过 | 实测 lock collision / failure 后不应出现多个 tab 各自 retry |
| owner 空删放大器 | P2 | 已修复 | owner 为空时 `releaseTitleSyncStatusOwnerLease()` 直接返回，不再 `GM_deleteValue` | `test-title-sync-status.js` 已覆盖，自动化通过 | 无 |
| running 动画 tick 过重 | P2 | 已修复 | 500ms 动画 tick 只推进标题动画帧，不再重跑完整 runtime | 源码断言和标题状态测试通过 | 实测 running 状态下 CPU 无持续抬升 |
| presence 整对象覆盖 | P2 | 已重构修复 | 新版 presence 改为 per-tab key `s1p_title_sync_status_tab:*`；通过 `s1p_title_sync_status_presence_signal` 通知刷新；legacy aggregate 只读兼容 | `test-title-sync-status.js` 已覆盖 partitioned presence storage，自动化通过 | 实测确认多 tab 切换时 owner 不再抖动 |
| 性能诊断开关 | 辅助 | 已移除 | 定位完成后移除 `window.__s1pPerfDebug`、`S1P-PERF` 输出和相关埋点调用 | `node --check S1Plus.js` 通过 | 后续用浏览器任务管理器和 Performance 面板验证 |
| auto sync indicator stored phase 长期 running | P2 | 观察中 | 当前通过 resolved display phase fallback 和短缓存缓解读取成本 | 自动拉取/indicator 联动测试通过 | 不是本次 P0；如果复测仍有异常，再单独处理落盘 resolved phase |

当前改动已经从补丁式 guard 推进到协议层重构：标题 presence 不再依赖共享整对象写入，owner lease 增加 token/generation 验证，后台 retry/recovery 进入 shared scheduler。仍然没有重写远程同步核心上传/拉取逻辑，改动集中在跨标签协调协议和调度入口。

验收建议：

1. 安装当前修复版 userscript。
2. 打开 10 个以上 S1 标签页，触发一次前台探测或后台同步 running 状态。
3. 挂机 30-40 分钟，并覆盖一次睡眠唤醒或浏览器切回。
4. 成功标准：不再出现多个标签同时显示 `[同步中.]`；选中任意 S1 tab 时后台 tab 不显示同步提示；CPU 峰值能快速回落，不再长期 99-100%。

## 11. 本次已落地修复

2026-05-06 已在 `S1Plus.js` 中完成以下修复：

| 风险 | 修复方式 | 预期效果 |
| --- | --- | --- |
| 标题 owner lease 自激 | `owner_change` / `presence_change` / `state_change` listener 改为 150ms debounce，且默认 `allowOwnerLeaseRefresh=false` | 跨 tab GM change 只能刷新显示判断，不能在 listener 回调里继续抢写 owner |
| 多 tab 抢 owner | `writeTitleSyncStatusOwnerLease()` 写前重新读取 owner，其他 tab lease 有效时不覆盖；写后用 owner token/generation verify | 同一时间只允许一个有效 owner 显示标题同步状态 |
| owner 空删制造额外事件 | `releaseTitleSyncStatusOwnerLease()` 在 owner 为空时直接返回 | 避免无意义 `GM_deleteValue` 触发 owner change |
| running 动画 tick 过重 | 500ms 动画 tick 只推进 title frame，不重跑完整 runtime | running 状态下不再每秒额外触发多次 GM 读 |
| display phase GM 读放大 | 标题 runtime 显式启用 250ms 短 TTL 缓存；其它路径默认实时读取 | 降低 storm 时同步 GM 读压力，同时避免影响导航栏/测试实时性 |
| `AUTO_SYNC_INDICATOR_STATE_KEY` 标题 listener 无 guard | 对本 tab 写入和无差异变化做跳过，并走 debounce | 减少状态落盘时对所有 tab 的重复唤醒 |
| presence 整对象覆盖 | 改为 per-tab presence key + presence signal；legacy aggregate 仅用于兼容读取 | 消除多 tab 对同一个 presence 对象 read-modify-write 的覆盖风险 |
| pending recovery 绕过 shared scheduler | `recoverPendingAutoSyncIfNeeded()` 先检查 shared debounce 是否覆盖 pending，必要时接管 shared owner，不再直接排 per-tab recovery | 同一个 pending 不会让每个新 tab 都排独立后台同步 timer |
| background retry per-tab timer | `scheduleBackgroundSyncRetry()` 优先写入 shared debounce forced-delay state | lock collision / failure 后由 shared owner 统一 retry，避免多 tab retry 链 |
| 现场定位困难 | 定位阶段曾使用 `window.__s1pPerfDebug` 诊断开关，修复完成后已移除 | 避免长期保留诊断埋点带来的额外运行成本 |

当前修复仍保留原有架构：没有重写同步系统，主要是在跨标签入口处增加 guard、debounce、写前确认和热路径缓存。改动量属于中等，集中在标题同步状态、pending recovery shared scheduler、诊断日志和对应回归测试。

已通过验证：

- `node --check S1Plus.js`
- `node sync-across-multiple-tab/scripts/test-title-sync-status.js`
- `node sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js`
- `node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js`
- `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
- `node sync-across-multiple-tab/scripts/test-foreground-remote-probe.js`
- `node sync-across-multiple-tab/scripts/test-visible-remote-polling.js`
- `sync-across-multiple-tab/scripts/test-*.js` 相关同步测试全量通过

## 12. 其他潜在问题

以下问题没有在本次现场日志中被证明为直接 P0，但都可能在多标签、长时间打开、同步状态频繁变化时增加触发概率或放大 CPU 压力。

| 风险 | 影响 | 建议处理 |
| --- | --- | --- |
| presence 整对象写入会丢更新 | 多 tab 同时写 `s1p_title_sync_status_tabs` 时，后写 tab 可能覆盖其他 tab 的 presence，导致每个 tab 看到的 live tab 集合不同 | 已改为 per-tab presence key；legacy aggregate 仅保留读取/监听兼容 |
| DevTools / 窗口焦点影响 foreground 判断 | `document.hasFocus()` 在 DevTools 聚焦时可能为 false，页面会误以为没有前台 tab，更容易进入后台 owner 显示路径 | foreground 判断应容忍 DevTools 场景，或 owner 选举不要强依赖瞬时 focus |
| 标题状态关闭时 listener 仍有成本 | 即使配置关闭，GM listener 已经绑定，disabled 分支仍可能做 presence/owner 清理 | 已避免空 owner delete；如果仍需继续降噪，可在 listener 入口根据设置尽早跳过 |
| `AUTO_SYNC_INDICATOR_STATE_KEY` 标题 listener 没有 guard | 同步状态每次写入都会触发标题 runtime，和导航栏 listener 的防重复策略不一致 | 已补本地写入/无差异 guard，并统一走 debounce |
| running 动画 tick 过重 | 500ms tick 本应只更新 `[同步中.]` 动画帧，却重跑完整 runtime 和 GM 读取 | 已改为只处理 title frame |
| `recoverPendingAutoSyncIfNeeded()` 仍可能单独触发 retry 风暴 | 多 tab 看到同一个 pending 时，各自排 per-tab recovery timer | 已用 shared debounce 覆盖检查替代直接 per-tab recovery；background retry 也优先走 shared scheduler |
| auto sync indicator stored phase 可能长期停在 `running` | `readSyncIndicatorStateProjection({ surface })` 会 fallback 到 idle，但 stored state 长期 running 会让判断路径更复杂 | 在 running lock/probe 结束后尽量落盘 resolved phase，减少后续判断成本 |

当前剩余关注顺序：

1. 先做真实多标签复测，确认 P0 owner storm 不再复现。
2. 如果仍有 CPU 抬升，再用 DevTools Performance 面板确认热点是否转移到 pending recovery / background retry。
3. 如果标题 owner 已稳定但仍有 display phase 读高频，再考虑进一步降低 stored running phase 的残留成本。
4. 如果仍偶发 owner 抖动，再看 legacy aggregate 混跑或 Tampermonkey `GM_listValues` 可用性；必要时增加更严格的滚动升级隔离。

## 13. 临时缓解方案

在修复发布前，最有效的用户侧缓解是关闭“标题显示同步状态”。这样可以切断 owner lease 风暴的主要显示/监听路径。

如果已经出现 CPU 100%：

1. 关闭多余 S1 tab。
2. 关闭标题显示同步状态。
3. 重新打开需要的页面。

这与现场观察一致：关闭 S1 相关页面后，脚本上下文、GM listener、heartbeat、animation timer 都被销毁，CPU 立即下降。
