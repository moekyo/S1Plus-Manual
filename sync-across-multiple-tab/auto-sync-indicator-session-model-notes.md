# 导航栏自动同步指示器视觉会话优化记录

日期：2026-05-16

相关提交：`0ed09594144605bddd1def4fa2d6e52b33c330a8` (`fix: refine foreground sync indicators`)

## 1. 背景

用户在帖子页持续阅读时，导航栏自动同步指示器出现以下体感：

1. 先显示类似“推送中”的动画。
2. 过一会停下，或者切成等待 / 检查类状态。
3. 又再次显示推送动画。
4. 最后才回到待命。

hover tooltip 中还会出现“回到前台检查等待二次确认”一类文案。用户没有主动切换标签页，但浏览器 / 页面生命周期仍可能触发 `visibilitychange` 或前台恢复链路，因此该提示容易被理解为“明明没有切走，为什么又回到前台检查”。

本记录不使用旧 phase 技能作为事实来源。以下判断直接基于当前代码、用户日志和 `0ed0959` 提交内容。

## 2. 关键结论

这不是帖子页专项问题。

`0ed0959` 的导航栏自动同步指示器目标是“全局自动同步体系摘要灯”，覆盖的不只是阅读进度，也包括：

- `background_push`：后台自动推送，本地数据变更触发，阅读进度只是其中一种来源。
- `daily_startup`：每日首次同步。
- `per_load`：每次页面加载检查。
- `page_load_visible`：页面首次可见检查。
- `foreground_resume`：回到前台检查。
- `visible_poll`：可见页轮询检查。
- `manual_sync`：手动同步。

所以优化不能只为帖子页阅读进度硬编码一套表现。阅读进度只是最容易复现“状态碎片化”的场景，因为用户持续阅读会连续制造本地 `read_progress` 变更。

## 3. 现有实现做对了什么

`0ed0959` 已经把很多方向语义拆清楚了：

- `pending` 阶段可以按 `source + operation` 显示待推送 / 待拉取。
- `running` 阶段才显示真正流动的方向箭头。
- 快速完成的 foreground metadata probe 延迟显示，避免放大镜闪一下。
- `remote_probe_equal_ambiguous:*` 用中性三点，不提前误显示为待拉取。
- `metadata-only` 发现 `updated_at` 变化但 full sync 尚未决策时，也先用中性 sync pending。
- 没有前置写入的 `hash_equal` / `no_change` 可以安静回到 idle；但如果它是同一轮 push / pull 成功后的确认，不能覆盖刚完成的成功态方向。

这些都是正确方向：不要把“检查”误画成“拉取”，也不要在还没决策前显示错误方向。

## 4. 现在的问题

当前问题不是“没有区分推送和拉取”，而是“区分得太机械”。

导航栏表层几乎把同步内部状态机直接暴露给用户：

- 阅读进度变更进入后台防抖队列：`pending push`
- 防抖结束开始写云端：`running push`
- 推送后触发前台 / 版本二次确认：`pending sync`
- 前台 follow-up 检查执行：`running sync`
- 用户继续阅读产生新进度：再次 `pending push` / `running push`

这些内部步骤在日志里是合理的，但在导航栏动画里会被看成多次独立同步：

```text
推送中 -> 停了 / 等待确认 -> 又推送 -> 又确认 -> 待命
```

用户真正关心的是：

```text
本地阅读进度正在同步到云端，并在结束前做了一次安全确认
```

也就是说，底层状态是分段的，但表层视觉应该把相关步骤聚合成一次“同步会话”。

## 5. 用户日志对应的实际方向

从用户日志看，这一段没有发生真正拉取。

```text
00:22:49 - 00:23:02  后台自动同步：推送
00:23:03 - 00:23:05  后台自动同步：检查后 hash_equal，无变化
00:23:41              回到前台检查：安排二次确认
00:24:22 - 00:24:33  后台自动同步：推送新的阅读进度
00:24:48 - 00:24:49  前台补同步：hash_equal，无变化
```

用户视觉上应该理解为：

```text
待推送 -> 推送中 -> 推送后确认中 -> 又有新进度待推送 -> 推送中 -> 待命
```

而不是：

```text
推送中 -> 停止 -> 回到前台检查等待 -> 又推送 -> 又停止 -> 又检查
```

## 6. 优化目标

不加常驻文字。

导航栏默认仍然只显示图标和动画，但要让图标表达更稳定：

1. 用户应该能从图标方向看出当前主方向是推送还是拉取。
2. 未决策的检查不能提前显示成推送或拉取。
3. 紧跟在推送后的二次确认，不应该抢走主方向叙事。
4. 相关的 pending / running / verification 应该视觉上属于同一轮同步会话。
5. hover tooltip 再提供完整细节和来源，不要求非 hover 状态承载所有内部信息。

## 7. 建议模型：视觉会话层

在现有 `phase / source / operation` 之上增加一层展示判断，称为“视觉会话层”。

底层仍然保留真实状态：

- `phase`
- `source`
- `reason`
- `operation`
- active locks
- pending scheduler
- foreground retry
- last resolved result

表层新增一个派生概念：

- `displaySessionKind`
- `displayDominantDirection`
- `displaySubstate`

建议含义：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| `displaySessionKind` | `local_push_session` / `remote_pull_session` / `cloud_probe_session` / `manual_session` | 用户感知上的一次同步会话 |
| `displayDominantDirection` | `push` / `pull` / `sync` / `probe` | 当前主方向 |
| `displaySubstate` | `pending` / `running` / `settling` / `done` / `blocked` | 会话内部阶段 |

这样底层可以继续精确，导航栏只展示聚合后的用户态。

## 8. 会话边界与归因规则

视觉会话必须有明确边界，否则实现时会把“不相关的同步”错误粘在一起。

建议只用运行时派生状态，不新增持久化存储。会话边界按以下规则判断：

| 规则 | 建议值 / 条件 | 说明 |
| --- | --- | --- |
| 同步会话最大归并窗口 | `30s` | 最近一次 push / pull / merge 结束后，窗口内的确认类 probe 可以归到同一会话 |
| 同步会话最短可见收尾 | `900ms` | push / pull 刚结束后至少保留一小段收尾感，避免直接硬切 |
| 同步会话最长收尾 | `5s` | 如果没有 pending / retry / probe，最多 5 秒后回 idle |
| 同机会话归因 | `sameSessionRemoteWrite === true` 或 last local session write 命中 | 优先判定为同一浏览会话刚写入云端 |
| 同设备归因 | `sameDeviceRemoteWrite === true` 且设备 ID 一致 | 可以降噪，但弱于同一浏览会话 |
| 数据来源连续 | 同为本地 dirty push 链路，或 pending 的 `maxLastModified` 晚于最近 push 开始时间 | 阅读进度、屏蔽、标签等本地变更都可归入 local push session |
| 远端变化打断 | full sync 已决策为 `pull` / `conflict` / `manual_decision_required` | 必须结束 push 会话，切到 pull 或 blocked |
| 手动同步打断 | `manual_sync` 锁或手动弹窗出现 | 手动同步是独立会话，不继承后台 push/pull 叙事 |
| 失败 / 冲突打断 | `failure` / `conflict` / hard pause | 立即切到需要处理，不保留 settling |

“相关”的最小定义：

1. 同一次本地 dirty 链路产生的 `pending push -> running push -> no_change/hash_equal verification`。
2. 同一浏览会话刚 push 后，由 `remote_probe_equal_ambiguous:*` 触发的二次确认。
3. 上一次 push 尚在 `30s` 窗口内，同时没有外部远端变化、手动同步或冲突打断。

如果只满足时间窗口，但归因显示远端来自其他设备 / 其他会话，不能继承 push settling，应该显示独立 probe 或 pull。

## 9. settling 状态时长

`settling` 不是一个新的强状态，而是“主方向会话的收尾表现”。

建议：

- push / pull 成功后，如果马上出现新的同方向 pending，直接进入新的 `pending`，不要闪一下 `settling`。
- 如果成功后出现 `remote_probe_equal_ambiguous:*`，且归因命中同机会话 push，则显示 `push settling`。
- `push settling` 最短显示 `900ms`，最长显示到二次确认结束或 `5s`，取较短者。
- 如果二次确认执行超过 `5s`，再切回中性 `sync/probe`，避免长期用 push 图标掩盖真实等待。
- 如果 settling 期间出现新本地 dirty，立即切到 `push pending`。
- 如果 settling 期间发现真正远端变化，立即切到 `pull pending/running` 或 `blocked`。

这样能避免日志里 `00:23:02` push 完成、`00:23:03` 又有新 push 时出现多余的收尾闪烁。

## 10. 短期运行时记忆

建议维护一个只在当前页面运行时存在的 `lastDisplaySyncSession`，不要写入 GM 存储。

建议字段：

```js
{
  kind: "local_push_session",
  direction: "push",
  source: "background_push",
  reason: "debounced_read_progress",
  threadIds: ["2268704"],
  startedAt: 1778862169000,
  completedAt: 1778862182000,
  remoteUpdatedAt: "2026-05-15T16:23:04Z",
  contentHash: "b0230d91cf...",
  sameSessionWrite: true
}
```

`contentHash` 来源：由 `performAutoSync()` 结果中 `extraResult.contentHash ?? syncBaseline.contentHash` 获取，经过 `recordSuccessfulRemoteWriteIfNeeded()` → `recordLocalSessionRemoteWrite()` → `rememberAutoSyncIndicatorDisplaySessionFromRemoteWrite()` 链路写入 runtime 记忆。

建立时机：

- `finishAutoSyncIndicatorCycle()` 收到 `success + pushed / force_push / manual_push / smart_progress_push / merged_read_progress`。
- `performAutoSync()` 结果中能确认本机会话写入云端。
- 后台 push 成功并记录了 `recordLocalSessionRemoteWrite()` 后。
- `recordSuccessfulRemoteWriteIfNeeded()` 被调用时（含 `forcePush` 等手动路径），传入 `contentHash` 参数。

清除时机：

- 超过 `30s` 最大归并窗口。
- 进入 `pull`、`conflict`、`failure`、`manual_sync`。
- 页面隐藏超过一段较长时间后重新可见，例如 `60s`，避免旧会话污染新前台检查。
- `remoteWriter` 明确来自其他设备 / 其他会话，并且 full sync 判断需要拉取或冲突处理。
- 用户关闭 / 刷新页面自然丢弃。

实际实现中的 `lastAutoSyncIndicatorDisplaySession` 为完整对象，非最小版本。

## 11. 多来源本地变更交织

阅读进度不是唯一会触发后台 push 的来源。用户阅读时同时改屏蔽、标签、收藏，也可能进入同一个本地 push 会话。

建议 UI 层不要把 `local_push_session` 绑定为“阅读进度会话”，而是：

- 如果 pending sources 只有 `read_progress`，tooltip 写“阅读进度待推送 / 推送中”。
- 如果 pending sources 混合了 `read_progress` 和其他本地数据，tooltip 写“本地变更待推送 / 推送中”。
- 如果来源明确是 cleanup，tooltip 可以写“阅读记录变更待推送”或“清理结果待推送”。
- 非 hover 图标只关心方向，统一用 push。

这能避免为帖子详情页做特殊分支，同时保留更具体的 tooltip。

## 12. 派生逻辑伪代码

下面伪代码只描述展示层，不改变同步决策。

实际实现中函数名为 `applyAutoSyncIndicatorDisplaySession()`，但核心判定逻辑一致。

```js
function resolveAutoSyncIndicatorDisplaySession(context) {
  const {
    state,
    runningState,
    pendingState,
    foregroundRetry,
    probeState,
    lastSession,
    now,
  } = context;

  // 1. 失败/冲突/手动同步 → blocked/manual
  if (hasHardPauseOrConflict(context)) {
    return blockedSession(context);
  }
  if (isManualSyncActive(context)) {
    return {
      displaySessionKind: "manual_session",
      displayDominantDirection: state.operation || "sync",
      displaySubstate: "running",
    };
  }

  // 2. 明确 pull → 优先于本地 push
  if (runningState.isRunning && runningState.operation === "pull") {
    return {
      displaySessionKind: "remote_pull_session",
      displayDominantDirection: "pull",
      displaySubstate: "running",
    };
  }
  if (foregroundRetry?.operation === "pull" && foregroundRetry.hasPending) {
    return {
      displaySessionKind: "remote_pull_session",
      displayDominantDirection: "pull",
      displaySubstate: "pending",
    };
  }

  // 3. 明确 push running
  if (runningState.isRunning && runningState.operation === "push") {
    return {
      displaySessionKind: "local_push_session",
      displayDominantDirection: "push",
      displaySubstate: "running",
    };
  }

  // 4. 本地 pending push（优先级高于 foreground retry）
  if (pendingState.hasPending && pendingState.source === "background_push") {
    return {
      displaySessionKind: "local_push_session",
      displayDominantDirection: "push",
      displaySubstate: "pending",
    };
  }

  // 5. 同机会话推送后的二次确认 → push settling
  if (
    foregroundRetry.reason.startsWith("remote_probe_equal_ambiguous:") &&
    canInheritPushSettling(lastSession, foregroundRetry, now)
  ) {
    return {
      displaySessionKind: "local_push_session",
      displayDominantDirection: "push",
      displaySubstate: "settling",
    };
  }

  // 6. 远端有变化但未决策 → 中性 cloud probe
  if (
    foregroundRetry.reason.startsWith("remote_probe_changed:") &&
    !hasFullSyncPullDecision(context)
  ) {
    return {
      displaySessionKind: "cloud_probe_session",
      displayDominantDirection: "sync",
      displaySubstate: "pending",
    };
  }

  // 7. probe 执行中
  if (probeState.isVisible) {
    return {
      displaySessionKind: "cloud_probe_session",
      displayDominantDirection: "probe",
      displaySubstate: "running",
    };
  }

  // 8. 收尾态延续
  if (hasRecentSettlingSession(lastSession, now)) {
    return {
      displaySessionKind: lastSession.kind,
      displayDominantDirection: lastSession.direction,
      displaySubstate: "settling",
    };
  }

  return idleSession();
}
```

关键辅助判断（实际未依赖 retry.remoteUpdatedAt 对比，简化为仅时间窗口 + sameSessionWrite）：

```js
function canInheritPushSettling(lastSession, retry, now) {
  return (
    lastSession?.direction === "push" &&
    lastSession.sameSessionWrite === true &&
    now - lastSession.completedAt <= 30000
  );
}
```

## 13. 非 hover 图标规则

建议默认图标规则如下：

| 用户态 | 图标 / 动画 | 说明 |
| --- | --- | --- |
| 待推送 | 静态向上箭头 | 本地变更已进入防抖 / pending 队列 |
| 推送中 | 流动向上箭头 | 正在把本地数据写到云端 |
| 推送后确认中 | 向上箭头的轻微收尾态 | 不切成三点主状态，表示这仍是推送会话的收尾确认 |
| 待拉取 | 静态向下箭头 | full sync 已确认云端应写回本地，等待执行 |
| 拉取中 | 流动向下箭头 | 正在从云端应用到本地 |
| 云端检查中 | 放大镜或中性三点 | metadata-only probe，尚未决定推送或拉取 |
| 等待复查 | 中性三点 | 没有可继承方向，或确实是独立云端复查 |
| 待命 | 单点 / idle | 无待处理同步 |
| 需要处理 | 减号 / 警示态 | 失败、冲突、需要全局手动同步 |

关键点：

- “推送后确认中”不应像一次新的同步任务。
- “二次确认”如果能归因到刚刚的同机会话推送，应继承 `push` 主方向，但动画要降噪。
- “云端检查中”仍然不能伪装成拉取，除非 full sync 已经决策出 `pull`。

## 14. tooltip 规则

hover tooltip 可以保留完整内部细节，但应换成用户更容易理解的说法。

建议文案：

| 场景 | 当前容易误解的表达 | 建议 tooltip |
| --- | --- | --- |
| 阅读进度防抖 | 后台自动同步待推送 | 阅读进度待推送 |
| 后台 push | 后台自动同步推送中 | 阅读进度推送中 / 本地变更推送中 |
| 同机会话推送后的二次确认 | 回到前台检查等待二次确认 | 推送完成，正在确认云端状态 |
| 独立 foreground probe | 回到前台检查正在检查云端更新 | 正在检查云端更新 |
| probe 发现远端更新但暂缓 | 等待云端复查 | 云端有变化，等待本地状态稳定后复查 |
| full sync 决策为 pull | 待拉取 / 拉取中 | 云端更新待拉取 / 云端更新拉取中 |
| no_change / hash_equal | 无前置写入时安静回 idle；作为写入后的确认时保留成功态方向 | 已确认本地与云端一致 |

这样既不牺牲诊断细节，也不会让“回到前台检查”这种来源名成为用户的主理解。

## 15. 主方向判定建议

建议按以下优先级派生 `displayDominantDirection`：

1. 失败 / 冲突 / hard pause 优先显示 `blocked`，不讨论方向。
2. 正在执行且 operation 明确为 `push` / `pull` 时，直接使用该方向。
3. foreground retry 如果 operation 明确为 `pull`，显示 `pull`，优先级高于本地 pending push（避免 pull 信号被掩盖）。
4. 存在后台本地变更 pending / shared debounce / pending auto sync request 时，使用 `push`。
5. foreground retry 如果 reason 是 `remote_probe_equal_ambiguous:*`，且最近一次本机会话写入云端是 `push`，显示为 `push + settling`。
6. foreground retry 如果是 `remote_probe_changed:*` 但 full sync 还没有决策，显示中性 `sync`，不要提前显示 `pull`。
7. metadata-only probe 正在执行时显示 `probe`。
8. full sync 结果或 running cycle 已明确 `pull` 时，才显示 `pull`。
9. 没有 pending / running / result TTL 时回到 `idle`。

这套规则的目标是：方向更明确，但状态切换更少。

## 16. 应避免的表现

不要让这类连续路径在视觉上变成多次不相关同步：

```text
push running -> idle -> sync pending -> push running -> sync running -> idle
```

更理想的表现是：

```text
push pending -> push running -> push settling -> push pending -> push running -> idle
```

如果中间确实出现独立远端更新，再切换到：

```text
probe -> pull pending -> pull running
```

## 17. 不是本次优化目标

以下不应混进这次优化：

- 不重写同步决策算法。
- 不改变 GitHub Gist 读写、锁、重试、baseline/hash 判定。
- 不把导航栏指示器改成常驻文字标签。
- 不只为帖子详情页写特殊分支。
- 不减少日志和诊断信息的精度。

## 18. 建议验收标准

1. 持续阅读帖子时，阅读进度相关同步在导航栏上表现为连续的推送会话，而不是多段互相打断的同步。
2. 用户不 hover 时，也能通过箭头方向判断当前主方向是推送还是拉取。
3. `remote_probe_equal_ambiguous:*` 若归因到同机会话刚推送，非 hover 状态不抢主图标，只表现为推送会话收尾。
4. 未决策的 foreground probe 不显示为待拉取。
5. 真正拉取云端数据时，必须明确显示向下箭头。
6. hover tooltip 能解释当前细节，但不直接暴露让用户误解的内部来源名。
7. 没有前置成功写入的 `no_change` / `hash_equal` 回 idle；同一轮 drain 内已有成功推送或拉取后的确认不能覆盖 success 方向（保留为 success + push / pull）。
8. settling 期间如果 1 秒内出现新的本地 dirty，不闪烁 idle / sync，而是直接续到 `push pending`。
9. 同时存在阅读进度和其他本地变更时，非 hover 仍显示 push，tooltip 升级为“本地变更待推送 / 推送中”。
10. 超过会话归并窗口后触发的 foreground probe 不继承旧 push 方向。
11. 明确的 pull retry 与本地 pending push 并存时，pull 方向不被掩盖。

## 19. 实现记录

实际实现要点：

1. 新增函数 `applyAutoSyncIndicatorDisplaySession()` 在 `resolveAutoSyncIndicatorDisplayPhase()` 的 `finishDisplayState` 处包裹，将内部状态机映射为用户态 `displaySessionKind` / `displayDominantDirection` / `displaySubstate`。
2. 运行时记忆 `lastAutoSyncIndicatorDisplaySession`，由 `rememberAutoSyncIndicatorDisplaySessionFromRemoteWrite()` 在每次 push 成功后建立，`contentHash` 由 `performAutoSync` 链路透传。
3. reason 字符串 `"foreground_probe_verification_retry"` 和 `"foreground_probe_changed_retry"` 提取为常量 `AUTO_SYNC_INDICATOR_REASON_FOREGROUND_PROBE_VERIFICATION_RETRY` / `_CHANGED_RETRY`，生产端（`scheduleForegroundRemoteSyncRetry`）和消费端（`applyAutoSyncIndicatorDisplaySession`、`getAutoSyncIndicatorTitle`）统一引用。
4. `getAutoSyncRuntimePendingDisplayState` 中 pull retry 短路返回，确保远端 pull 信号不被本地 pending push 掩盖。
5. `getAutoSyncIndicatorTitle` 移除 sourceLabel，改用 `getAutoSyncIndicatorLocalChangeLabel` 按来源组合输出用户语义（阅读进度 / 清理结果 / 阅读记录变更 / 本地变更）。
6. `startAutoSyncIndicatorExpiryTimer` 对 settling 子状态做专门过期处理，区分 `push_settling_verification`（用 settlingStartedAt+MAX）和普通 settling（用 completedAt+MIN）。
7. 成功态方向由同步结果 / 手动动作 `action` 派生并透传到 `finishAutoSyncIndicatorCycle()` 或 `setAutoSyncIndicatorResolvedPhase()`，即使经过最短 running 时长的延迟落态，push / pull 完成后也分别保留 `displayDominantDirection`，tooltip 显示“本地变更已推送”或“云端更新已拉取”。
8. 后台 drain 记录“最后一次有方向的成功结果”而不是只记录是否发生过 push-like 写入，避免后续 `no_change` 把 pull / push success 压成泛化成功。
9. pending stale 保护同时覆盖 shared debounce 和 `PENDING_AUTO_SYNC_KEY`，旧的待同步请求超过窗口后不再驱动导航栏显示“待推送”。
10. 锁 TTL 继续用于同步安全，但导航栏 running 展示只信最近仍在续租的锁，避免 startup/manual 这类 3 分钟锁残留把“同步中”动画拖到用户可感知的长时间。
11. `remote_probe_changed:*` 触发的前台 follow-up 在 full sync 决策前继续显示 probe 语义；真正决策为 push / pull 后再切方向。
12. `test-auto-sync-indicator-linkage.js` ：
   - `testDisplaySessionCoalescesPushVerification`：同机会话 push settling 继承、新 dirty 续接、多来源 tooltip、过期 session 不继承。
   - `testPullRetryKeepsCloudDirectionOverLocalPending`：pull retry + 本地 pending 并存时 pull 方向不被掩盖。
   - `testSuccessDisplayKeepsDirectionalCompletion`：push / pull 成功态保留方向和 tooltip。
   - `testDeferredResolvedPhaseKeepsOperation`：延迟落成功态时仍保留 operation。
   - `testForegroundFollowupLockDisplayDoesNotUseFullLockTtl`：锁 TTL 内但已停止续租时不再让导航栏保持 running，`remote_probe_changed` follow-up 决策前保持放大镜。
   - `testStalePendingAutoSyncRequestDoesNotDisplay`：过期 pending request 不再显示待推送，新鲜 pending request 仍正常显示。
   - 已有测试的 tooltip 断言全部更新为用户语义（不再含 sourceLabel）。

核心思路：底层继续诚实，导航栏表层少一点内部碎片感。
