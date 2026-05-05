# 后台同步调度 Review 与优化方案

本文基于当前 `S1Plus.js` 实现，聚焦用户复现的场景：

> 打开多个帖子标签页逐个阅读；阅读过程中部分页面已经触发阅读进度保存和后台推送；看完后切到非 S1 页面，观察到同步状态出现多次“同步中 -> 成功 -> 同步中 -> 成功”。


## Review 结论

### P1: 阅读进度推送防抖是标签页本地 timer，无法跨标签合并

当前路径：

1. 阅读进度落盘后调用 `updateLastModifiedTimestamp("read_progress")`。
2. 写入共享的 `s1p_pending_auto_sync_request`。
3. 调用当前标签页内存里的 `debouncedTriggerRemoteSyncPush({ source: "read_progress" })`。
4. 每个标签页各自设置 `remotePushTimeout`，阅读进度防抖为 20 秒。
5. timer 到点后进入后台同步，跨标签锁保证同一时刻只有一个标签页推送。

问题在第 4 步：锁只能串行执行，不能合并多个标签页已经排好的未来 timer。

结果是多个帖子页可能依次触发：

```text
帖子 A timer 到点 -> 推送成功
帖子 B timer 到点 -> 推送成功
帖子 C timer 到点 -> 推送成功
```

数据安全上通常没问题，但体验上会表现为连续多轮同步。

相关代码：

- `READ_PROGRESS_SYNC_DEBOUNCE_MS = 20 * 1000`
- `remotePushTimeout` / `armRemotePushTimer()`
- `debouncedTriggerRemoteSyncPush()`
- `triggerRemoteSyncPush()`

### P1: 成功后清理 pending 过于粗粒度

`performAutoSync()` 的成功路径会通过 `asSuccessResult()` 调用 `clearPendingAutoSyncRequest()`。

这对单标签页足够，但多标签下存在语义缺口：

- A 标签页开始同步时导出了 `lastUpdated = T1` 的本地快照。
- B 标签页随后写入阅读进度，写入 pending `lastModified = T2`，并排了自己的 timer。
- A 标签页同步成功后无条件清掉 pending。
- B 的 timer 仍可能稍后触发，所以数据大概率还能同步；但共享 pending 状态短时间内被抹掉，状态提示和恢复逻辑看不到“还有更新待推送”。

这也是“成功”和下一轮“同步中”之间会出现割裂感的原因之一。

更稳妥的规则应是：

```text
只有当 pending.maxLastModified <= 本轮已覆盖的 localDataObject.lastUpdated 时，才允许清 pending。
```

如果 pending 比本轮导出的快照更新，应保留 pending 并安排 follow-up。

### P2: pending 记录是单条覆盖式结构，丢失多标签聚合信息

当前 `s1p_pending_auto_sync_request` 结构近似：

```json
{
  "source": "read_progress",
  "lastModified": 1760000000000,
  "createdAt": 1760000000000
}
```

它只能表达“最近一次 pending”，不能表达：

- 有多少个标签页贡献了待同步变更
- 涉及哪些 `threadId`
- 最早 dirty 时间和最近 dirty 时间
- 当前是否已有共享 debounce owner
- 当前排队任务计划何时触发
- 当前 pending 是否已被某次同步覆盖

这会降低调度合并、诊断和 UI 表达的精度。

### P2: 状态显示先落成功，再很快进入下一轮 pending/running

后台同步外层已经有 drain-loop，单个标签页内同步期间产生的 dirty 可以被同一轮尽量消化，最多 3 次。

但跨标签 timer 不在同一个 drain-loop 内。前一轮完成后，如果另一个标签页 timer 到点，就会再次进入 `pending/running`。

现有导航栏状态与标题状态都复用同一个统一状态源，所以都会如实展示：

```text
success -> pending/running -> success
```

这不是 UI 误报，而是调度层确实启动了新的同步任务。

### P2: pending recovery 能兜底，但不是主动调度器

当前有 `recoverPendingAutoSyncIfNeeded()`，会在初始化、`pageshow`、`visibilitychange` 等场景检查遗留 pending 并补发。

这能防止“页面关闭后 pending 永久丢失”，但它不是跨标签主动调度器：

- 它不会在其他标签页写 pending 时立刻接管。
- 它不负责合并各标签页本地 debounce timer。
- 它不持有 owner / lease / dueAt 这类调度状态。

因此它不能解决本次复现的多轮同步体验问题。

### P3: 诊断缺少“调度层”字段

当前诊断已经能记录触发源、结果、hash、同设备写入等信息，但对后台推送调度本身还不够直观。

建议补充：

- 当前共享 debounce owner
- 共享 debounce dueAt / maxWaitUntil
- dirty source 汇总
- dirty threadId 汇总
- pending maxLastModified
- 本轮同步覆盖的 lastModified
- drain-loop 轮次
- 成功后是否仍保留 newer pending

这样再次看到多轮同步时，可以直接判断是：

- 多标签 timer 未合并
- 锁竞争重试
- 同步期间新 dirty
- pending recovery 补发
- 真实远端冲突或失败重试

### P3: 自动同步指示器可以利用调度层减少抖动

同步核心优化后，指示器自然会少跳。但即使不改 UI，也可以让状态源读取共享调度状态：

- 有共享 debounce 且未到点时显示 `pending`
- owner 已触发且锁有效时显示 `running`
- 没有 pending、没有 active lock、没有 retry 时才显示最终结果

这属于状态源增强，不是标题提示特例。

## 推荐优化方案

### 目标

把“每个标签页各自排 timer”改为“同设备所有 S1 标签页共享一个后台推送调度器”。

目标效果：

```text
多个帖子页在短时间内产生阅读进度 dirty
-> 合并到一次 shared debounce
-> 由一个 owner 标签页触发一次后台同步
-> 同步成功后只在确实还有更新 dirty 时补一轮
```

### 新增共享调度状态

建议新增 GM/local storage 状态键：

```js
const BACKGROUND_SYNC_DEBOUNCE_STATE_KEY = "s1p_background_sync_debounce_state";
```

建议结构：

```json
{
  "version": 1,
  "generation": 12,
  "ownerTabId": "s1p_tab_xxx",
  "ownerLeaseUntil": 1760000030000,
  "dueAt": 1760000020000,
  "maxWaitUntil": 1760000060000,
  "firstDirtyAt": 1760000000000,
  "lastDirtyAt": 1760000009000,
  "maxLastModified": 1760000009001,
  "sources": {
    "read_progress": 3,
    "general": 1
  },
  "threadIds": ["123", "456"],
  "reason": "debounced_read_progress"
}
```

字段说明：

- `generation`: 每次 dirty 更新递增，避免旧 owner 用旧 timer 触发。
- `ownerTabId`: 当前负责调度 timer 的标签页。
- `ownerLeaseUntil`: owner 失效时间，页面关闭或休眠后其他标签页可接管。
- `dueAt`: 最近一次允许触发同步的时间。
- `maxWaitUntil`: 最大等待上限，避免一直阅读导致无限推迟。
- `maxLastModified`: 当前共享 dirty 集合里的最大本地修改时间。
- `sources` / `threadIds`: 诊断与文案使用，不参与冲突裁决。

### 调度规则

1. `updateLastModifiedTimestamp(source)` 仍然负责推进 `s1p_last_modified`。
2. 如果 `triggerSync=true`，不再直接给当前标签页安排本地 `remotePushTimeout`。
3. 改为调用 `requestSharedBackgroundSyncDebounce({ source, lastModified, threadId })`。
4. 该函数更新共享调度状态：
   - `read_progress` 使用 20 秒 settle window。
   - `general` 使用 5 秒 settle window。
   - 如果已有 `general` dueAt，不被后续 `read_progress` 推迟。
   - 如果当前都是 `read_progress`，允许 trailing debounce，但不超过 `maxWaitUntil`。
5. 只有 owner 标签页启动本地 timer。
6. 非 owner 标签页只监听共享状态变化，不运行 timer。
7. owner 页面 `pagehide / beforeunload` 时释放 owner；其他存活标签页可接管。
8. owner lease 过期时，任意标签页可尝试接管。

### 触发同步时的覆盖判定

owner 到点触发同步前，读取共享调度状态并记录：

```js
const coveredGeneration = state.generation;
const intendedMaxLastModified = state.maxLastModified;
```

同步完成后：

1. 读取当前最新共享调度状态。
2. 如果当前 `generation === coveredGeneration`，且 `maxLastModified <= localDataObject.lastUpdated`：
   - 清掉 pending / shared debounce。
3. 如果当前 `generation > coveredGeneration`，或 `maxLastModified > localDataObject.lastUpdated`：
   - 不清 pending。
   - 安排 follow-up，建议短 settle：`300ms ~ 1500ms`。

这样可以避免“本轮成功误清下一轮 pending”。

### 和现有 drain-loop 的关系

保留现有 drain-loop。

分工如下：

- shared debounce: 合并多标签页在同步开始前产生的 dirty。
- drain-loop: 消化同一个 owner 同步执行期间产生的 dirty。
- pending recovery: 页面关闭、bfcache、浏览器恢复后的兜底补发。

这三层不是替代关系。

### 和同步核心裁决的关系

不改变：

- `performAutoSync()`
- `decideSyncActionByVersion()`
- baseline / hash 判定
- 冲突暂停
- 自动合并阅读进度
- 远端推送前 `updated_at` 检查

本优化只改变“什么时候、由哪个标签页发起后台同步”。

## 其他建议优化

### 1. pending 结构升级为聚合 dirty state

可以把 `s1p_pending_auto_sync_request` 升级为结构化聚合状态，或让它引用新的 shared debounce state。

建议至少增加：

```json
{
  "maxLastModified": 1760000000000,
  "sources": { "read_progress": 2 },
  "threadIds": ["123", "456"],
  "firstDirtyAt": 1760000000000,
  "lastDirtyAt": 1760000005000
}
```

### 2. 成功结果延迟落最终态

在同步状态源里，如果发现仍有 shared pending 或 background retry，不应立刻落最终 `success`。

推荐：

```text
有 active lock -> running
无 active lock 但有 shared pending / retry -> pending
无 pending / retry -> success / failure / conflict
```

这样导航栏状态和标题状态都能减少“成功后马上同步中”的割裂。

### 3. 为 shared scheduler 增加 storage / GM value listener

如果可用，监听共享调度状态变化：

- owner 变更
- dueAt 提前
- remote sync 关闭
- conflict pause 开启

这样 owner 不需要依赖下一次可见性变化才接管。

### 4. owner lease 与锁 TTL 分开

后台同步锁 TTL 当前是 45 秒，并有 10 秒 heartbeat。

共享 debounce owner lease 可以更短，例如：

- owner lease: 15 秒
- owner heartbeat: 5 秒
- owner 到点触发同步后，实际同步安全仍交给 background/global sync lock

这样调度 owner 失效能更快接管，但不会削弱同步互斥锁。

### 5. 文案与诊断避免把调度合并说成云端变化

如果某次同步只是本地阅读进度批量上传，状态文案可以更准确：

- “正在同步阅读进度”
- “阅读进度已同步”
- “多个标签页的阅读进度已合并上传”

这属于后续体验优化，不影响第一阶段的调度修复。

## 分阶段实施建议

### Phase A: 观测与测试先行

新增测试脚本：

```text
sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js
```

覆盖：

1. 多个 read_progress dirty 合并为一次 dueAt。
2. general dirty 不被 read_progress 延后。
3. read_progress trailing debounce 不超过 maxWaitUntil。
4. 只有 owner 标签页启动 timer。
5. owner lease 过期后可接管。
6. 成功只清理已覆盖的 pending。
7. 同步期间出现 newer dirty 时保留 pending 并安排 follow-up。

### Phase B: 引入共享 debounce state

新增 helper：

- `normalizeBackgroundSyncDebounceState`
- `getBackgroundSyncDebounceState`
- `setBackgroundSyncDebounceState`
- `requestSharedBackgroundSyncDebounce`
- `tryAcquireBackgroundSyncDebounceOwner`
- `scheduleSharedBackgroundSyncDebounceTimer`
- `clearSharedBackgroundSyncDebounceIfCovered`

先保留旧 `debouncedTriggerRemoteSyncPush()` 作为 wrapper，内部改调 shared scheduler。

### Phase C: 接入后台同步结果覆盖判定

让后台同步触发时携带调度上下文：

```js
triggerRemoteSyncPush(reason, {
  debounceGeneration,
  intendedMaxLastModified,
});
```

同步成功后按 `intendedMaxLastModified` 判断是否清 pending。

### Phase D: 状态源和诊断增强

补充：

- 诊断面板显示 shared scheduler 状态。
- 自动同步指示器读取 shared pending / retry 状态。
- 标题同步状态自然复用统一状态源，不需要单独特殊处理。

## 验收标准

1. 打开多个帖子逐个阅读，短时间内多个阅读进度 dirty 应尽量合并为一次后台推送。
2. 如果同步过程中确实产生新的 dirty，最多出现一次必要 follow-up。
3. 成功后不应因为旧 timer 陆续到点而连续触发多轮后台同步。
4. 普通数据变更仍保持 5 秒防抖，不被阅读进度 20 秒窗口延后。
5. 页面关闭、bfcache 恢复、owner 标签页崩溃后，pending 仍可恢复。
6. 冲突暂停、手动同步、远程同步关闭时，shared scheduler 能立即停止并清理。
7. 现有同步核心裁决测试不应回退。

## 回归命令建议

```bash
node -c S1Plus.js
node sync-across-multiple-tab/scripts/test-background-sync-shared-debounce.js
node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js
node sync-across-multiple-tab/scripts/test-safe-sync-execution.js
node sync-across-multiple-tab/scripts/test-foreground-trigger-integration.js
node sync-across-multiple-tab/scripts/test-foreground-probe-gate-retry.js
node sync-across-multiple-tab/scripts/test-background-open-passive-session.js
node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js
node sync-across-multiple-tab/scripts/test-settings-migration.js
node sync-across-multiple-tab/scripts/test-sync-settings-ui.js
```

## 当前建议优先级

优先做：

1. shared debounce scheduler
2. pending covered-lastModified 清理规则
3. scheduler 诊断字段

暂缓做：

1. 大改同步核心裁决
2. 改冲突处理策略
3. 单独为标题提示做特殊防抖

理由：本次现象的根因在后台调度层。只要调度层合并多标签 dirty，导航栏状态、标题状态和 toast 都会自然变少，不需要每个展示面各自打补丁。
