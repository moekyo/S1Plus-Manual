# GPT 评估文档的代码交叉验证报告

## 结论

`sync-auto-check-evaluation.md` 的评估结论**基本正确**，每条判断都能在 `S1Plus.js` 中找到代码佐证。它对两份材料的取舍建议合理：
- `auto-check-redesign/` 的诊断值得保留，但协调器架构在当前 GM 存储模型下不可行
- `sync-auto-check-fix-plan.md` 的增量修复方向正确，但 Step 3（probe 阶段 hash 化）和 Step 4 优先级需要调整

## 逐条验证：evaluation 中的事实性声明

### ✅ per_load 没有会话级冷却

`handlePerLoadSyncCheck` 在 `S1Plus.js:36441` 直接调用 `runStartupModeAutoSyncCheckWithIndicator`，进入前不做任何 session-level throttle。

```javascript
// S1Plus.js:36430-36441
const handlePerLoadSyncCheck = async () => {
    const settings = getSettings();
    if (
      !settings.syncPerLoadCheckEnabled ||
      // ... 仅检查配置开关
    ) {
      return false;
    }
    // 直接进入全量同步，无 session 级冷却
    const result = await runStartupModeAutoSyncCheckWithIndicator({...});
```

而且 `per_load` 走的是**全量同步**（push/pull/merge），不仅仅是 probe。`runStartupModeAutoSyncCheck` 在 `S1Plus.js:20700+` 展示了完整的 pull/push/merge 分支逻辑。比 evaluation 描述的"每次新页面都可能执行一次远端同步检查"更严重——实际上是"每次新页面都可能执行一次全量双向同步"。

### ✅ probe → sync → refresh 链式耦合

`S1Plus.js:21518`（probe: `metadataOnly: true`）→ `S1Plus.js:21656`（命中后调 `requestForegroundRemoteSyncCheckFn` 做全量同步）→ `S1Plus.js:21681-21693`（sync 成功后调用 `applyRefreshPolicyForSyncResult`）。

整条链路中间只有一个 `shouldApplyAutoPullRefreshForSyncResult` 判断符不符合刷新条件，但它只看 `status === "success"` 和 `action` 类型：

```javascript
// S1Plus.js:10338-10343
const shouldApplyAutoPullRefreshForSyncResult = (syncResult) =>
    Boolean(
      syncResult &&
      syncResult.status === "success" &&
      isAutoPullRefreshAction(syncResult.action)
    );
```

**完全不管 `sameSessionRemoteWrite` 或 `sameDeviceRemoteWrite`。**

### ✅ 同机归因只抑制文案，不抑制刷新

`S1Plus.js:36460` 在 per_load 入口传了 `suppressMessage: result.sameSessionRemoteWrite === true`，但这个值只影响是否显示 toast/提示文案：

```javascript
// S1Plus.js:10783-10785
if (!plan.shouldReload) {        // ← 真正的刷新决策
    if (shouldShowMessage) {     // ← suppressMessage 只控制这里
        showMessageFn(...);
    }
    return { reloadSchedule: { status: "suppressed" } };
}
```

而 `plan.shouldReload` 来自 `getAutoPullRefreshPlan`，对同机归因完全无感知。在帖子页上，对于普通 `pulled`/`force_pulled` 结果：

```javascript
// S1Plus.js:10818-10824
const applyRefreshPolicyForSyncResult = (syncResult, options = {}) => {
    // ...
    const action = syncResult.action || "pulled";
    const allowThreadSoftPrompt = action === "merged_read_progress"; // 仅此情况允许 soft prompt
```

因此非 `merged_read_progress` 的帖子页，同机写入会导致**静默刷新**（suppressMessage 抑制了提示，但页面仍然被刷新）。静默误动作比通知性误动作更危险。

### ✅ `decideSyncActionByVersion` 是 hash-first，不是只靠 `updated_at`

```javascript
// S1Plus.js:19184-19189
if (
    !localDataObject ||
    !remoteDataObject ||
    remoteDataObject.contentHash === localDataObject.contentHash
) {
    return { action: "no_change", reason: "hash_equal", localNewer: false };
}
```

```javascript
// S1Plus.js:19192-19197
const baselineState = getSyncBaselineState();
if (baselineState) {
    const localChanged = localDataObject.contentHash !== baselineState.contentHash;
    const remoteChangedByHash = ...;
    // 优先用 contentHash 判断
}
```

只有在 hash 不可用时才回退到 `updated_at` 比较（`S1Plus.js:19250`）。evaluation 在第 43-44 行正确指出了这一点，说明 `auto-check-redesign/` 对"纯靠 `updated_at`"的批评是过度泛化的。

### ✅ foreground probe 已有丰富防护

`S1Plus.js:21418-21462` 展示了探头前的多层防护：

| 防护 | 位置 | 含义 |
|---|---|---|
| in-flight 检查 | L21418 | 已有 probe 在飞行中 |
| sync in-flight 检查 | L21421 | 已有 sync 在飞行中 |
| retry pending | L21427-21434 | 上次 retry 未到期 |
| sync lock active | L21436 | 有同步锁 |
| local cooldown | L21439 | 本地冷却期 |
| shared cooldown | L21447 | 跨标签共享冷却 |
| read progress gate | L21615 + L9670-9699 | 阅读进度在写入/debounce/初始化噪音中 |

evaluation 在第 45-46 行指出这些守卫是正确的。

### ✅ 阅读进度有后台误写 guard

```javascript
// S1Plus.js:34218-34222
const requiresExplicitInteractionForReadProgressConfirmation = () =>
    Boolean(
      readProgressTrackingState?.initiatedWhileHidden === true ||
        readProgressTrackingState?.passiveBackgroundOpened === true
    );
```

```javascript
// S1Plus.js:34291-34298 - hidden 页面不保存
} else if (
    document.visibilityState !== "visible" &&
    !isFlushReason
) {
    // ... blocked
    return;
}
```

```javascript
// S1Plus.js:34651-34662 - 追踪后台打开标记
let backgroundOpenHint = null;
if (hasContextChanged) {
    backgroundOpenHint = consumeBackgroundOpenThreadHint({ threadId, page: currentPage });
    if (backgroundOpenHint && readProgressTrackingState) {
        readProgressTrackingState.passiveBackgroundOpened = true;
```

evaluation 在第 47-48 行判断正确。

### ✅ `syncPerLoadCheckEnabled` 是运行时开关，不是迁移占位

```javascript
// S1Plus.js:21883 - 默认值
const defaultSettings = {
    syncPerLoadCheckEnabled: false,  // ← 默认关闭
```

```javascript
// S1Plus.js:22136-22162 - 迁移逻辑
const normalizedSyncPerLoadCheckEnabled = normalizeBooleanWithDefault(
    hasLegacyImplicitPerLoadCheckEnabled ? true : settings.syncPerLoadCheckEnabled,
    defaultSettings.syncPerLoadCheckEnabled
);
```

```javascript
// S1Plus.js:27127-27133 - UI 三态映射
const resolveSyncAutoCheckModeValue = (settingsSnapshot = {}) => {
    if (settingsSnapshot.syncPerLoadCheckEnabled === true) return "per_load";
    if (settingsSnapshot.syncCheckOnReturnToForeground === true) return "foreground";
    return "off";
};
```

```javascript
// S1Plus.js:36433 - 运行时门控
if (!settings.syncPerLoadCheckEnabled) { return false; }
```

这个字段贯穿了**默认值 → 迁移 → UI → 运行时**四层，是活跃的运行入口。evaluation 在第 27 行的判断正确。

### ✅ `SyncCoordinator`/`SyncIntent`/`syncAutoFetchMode`/`safeAutoPull` 在当前代码中不存在

在 `S1Plus.js` 中 grep 所有四个关键词，结果全部为零匹配。仅在 `sync-across-multiple-tab/` 测试脚本中出现，属于另一个已废弃分支的痕迹。

### ✅ GM 锁不是事务，不是 CAS

```javascript
// S1Plus.js:19695-19698 - 写入
GM_setValue(BACKGROUND_SYNC_LOCK_KEY, {
    owner: BACKGROUND_SYNC_OWNER_ID,
    timestamp: now,
});
```

```javascript
// S1Plus.js:19705-19715 - 读回验证（非原子操作）
const acquired = await verifySyncLockOwnership(() => {
    const verifiedModeLock = getBackgroundSyncLockValue();
    const verifiedGlobalLock = getGlobalSyncLockValue();
    return (
        verifiedModeLock && verifiedModeLock.owner === BACKGROUND_SYNC_OWNER_ID &&
        verifiedGlobalLock && verifiedGlobalLock.owner === BACKGROUND_SYNC_OWNER_ID
    );
});
```

在 `GM_setValue` 和 `verifySyncLockOwnership()` 读回之间，另一个标签页可以同时写入。这是 best-effort 乐观锁，不是 compare-and-swap。任何依赖跨标签共享 lease/queue/circuit breaker 的协调器抽象，都在这个基础上引入了无法消解的竞态。evaluation 第 49-50 行对此的分析准确。

---

## 对 `auto-check-redesign/` 的立场

### 值得保留的

| 保留内容 | 原因 |
|---|---|
| 对三种误报场景的诊断（单设备、同机多标签、链式放大） | 与代码事实完全吻合 |
| `probe → reconcile → apply` 的概念分层 | 有助于理解现有三段链路的问题所在 |
| `updated_at` 只是 freshness hint | `decideSyncActionByVersion` 已是 hash-first，但 probe 层没严格遵守 |
| writer attribution 必须参与最终动作决策 | 目前 `sameSessionRemoteWrite` 在 `shouldApplyAutoPullRefreshForSyncResult` 中完全被忽略 |
| 浏览器/Tampermonkey 回归矩阵 | 场景覆盖全面 |

### 应当舍弃的

| 舍弃内容 | 代码层面的理由 |
|---|---|
| `SyncCoordinator` 全局协调器 | GM 存储无事务保证（见 `acquireBackgroundSyncLock` 的竞态窗口） |
| `SyncIntent` 队列/优先级 | 跨标签 intent 队的依赖 GM 存储一致性，在无事务环境下不可靠 |
| 全局 lease/queue/circuit breaker | 同 L19695-L19715：任何共享状态的"智能合并"都会因跨标签写入无 CAS 而出现状态漂移 |
| 删除 per_load 入口 | `S1Plus.js:27127-27133` 中有显式的 `per_load` UI 选项，删除属于 breaking change |
| 7 阶段全量重构 | 当前 `S1Plus.js` 已有 hash 决策、多级锁、冷切换、阅读进度 guard，不需要重写执行层 |
| `safe_foreground` 累积多个前置条件 | 阅读进度 guard（L9670-L9699）已证明：多条件叠加 → "永远凑不齐" → 悄悄失效 |

### 为什么实现版效果反而更差

不是设计理念错了，是**在 GM 存储上构建的事务假设被现实打破**。具体机制链：

1. 共享 lease 通过 `GM_setValue` 发布 → 读取回验证 → 窗口期另一个标签页已覆盖同一 key
2. queue 合并/重排依赖准确的全局 queue 快照 → 跨标签延迟导致"看到旧 queue，合并到新 queue"的竞态
3. circuit breaker 的"何时恢复"依赖全局故障计数器 → 多标签各自维护、互相覆盖
4. 四个条件（cooldown + quiet window + pending recovery settle + snapshot resync）在真实浏览中很难同时满足 → 系统安静地什么都不做，比误报更难被发现

---

## 对 `sync-auto-check-fix-plan.md` 的立场

### 方向正确

核心思路——在现有代码上补关键 guard，把分散判断收敛到集中决策函数——是务实的。当前代码的执行层（lock、hash、guard、刷新策略）是成熟的，问题在**决策层**的缺口。

### fix-plan 的 6 个问题分析在代码中找到的佐证

| 问题 | 代码证据 |
|---|---|
| 问题一：GM 存储不可靠 | L19695-L19715：无 CAS 保证 |
| 问题二：抽象层过多 | 当前 37,597 行 + 4 层模型 = 每次调试追 8+ 层调用 |
| 问题三：7 阶段必须全完工 | 半成品协调器 = 一半入口直接不在调度器管辖内 |
| 问题四：条件累积导致静默失效 | L9670-L9699 阅读进度 guard 已使 probe 经常被 block，再加条件更甚 |
| 问题五：测试不可行 | bfcache/跨标签时序/visibility throttle 无法在 Node 复现 |
| 问题六：删除 per_load 是 breaking change | L27127 有活跃的 `per_load` UI 选项 |

### 需要修正的地方

**Step 3（probe 阶段 hash 化）不宜在 probe 层执行。** `S1Plus.js:21518` 的 probe 使用 `metadataOnly: true`，这是正确的设计——probe 就该轻量。把 contentHash 拉取塞进 probe 等于把 probe 变成了半个 sync，失去了"轻量观察"的意义。应该在 follow-up sync 的决策阶段集中判断同机/no-op 是否应阻止后续动作。

**Step 4（后台假脏写）应先验证再补代码。** `S1Plus.js:34218`、`S1Plus.js:34291`、`S1Plus.js:34651` 已有三重 guard（initiatedWhileHidden 检查、hidden 页面跳过保存、被动后台打开标记）。先确认是否仍有具体漏网场景（例如：`visibilitychange` 时序中 hidden→visible 切换瞬间的 race），再决定补什么。

**线程页 soft prompt 的声明不够精确。** `getAutoPullRefreshPlan` 有 thread soft prompt（L10681-L10695），但 `applyRefreshPolicyForSyncResult` 仅在 `action === "merged_read_progress"` 时启用（L10819）。普通 `pulled`/`force_pulled` 在线程页仍是 `reload_now`。fix-plan 应明确说"仅 `merged_read_progress` 享 soft prompt，其余仍是 reload"。

---

## 两套方案的取舍

### 从 `auto-check-redesign/` 取

- 问题诊断（单设备误报、同机归因、链式放大）
- `probe → reconcile → apply` 概念分层
- `updated_at` = freshness hint 的语义约束
- writer attribution 必须参与最终动作决策
- 回归矩阵中的测试场景清单

### 从 `auto-check-redesign/` 舍

- 全部协调器抽象（SyncCoordinator / SyncIntent / queue / lease / circuit breaker）
- 删除或隐藏 per_load 入口
- 一次性 7 阶段大迁移
- 替换设置模型（现有三段式 UI 功能完整）

### 从 `sync-auto-check-fix-plan.md` 取

- 增量修复路线
- 集中纯决策函数概念
- per_load session 冷却
- same-session / same-device guard

### 从 `sync-auto-check-fix-plan.md` 修正

- Step 3：probe 不要强行 hash 化，把 hash 判断收敛到 follow-up sync 的决策阶段
- Step 4：先确认漏网场景再补代码，不是直接写
- 线程页 soft prompt 声明应精确化："仅 merged_read_progress，非全部 pull 结果"

---

## 优先级排序与实施口径

### 关键前置认知

在进入具体实施前，需要澄清两个约束：

**约束 1：`shouldApplyAutoPullRefreshForSyncResult` 只能控制"刷新"，不能控制"拉取"。**

该函数在 `importLocalData()` 已经执行完成之后才调用（L20656/L20684）。当结果已经是 `pulled` / `force_pulled` 时，远端数据已经被写入本地存储了。此时能阻止的是随后的 reload / 提示，不是拉取本身。如果要阻止 import，必须把决策前移到 `decideSyncActionByVersion()` 之后、`importLocalData()` 之前——那就不再是最小改动了。

因此实施口径是：**阻止刷新，接受已完成的 import**。同机导入的数据（如另一标签页的阅读进度推送）落在本地存储中本身无害，问题出在随后未经判断就触发页面刷新。

**约束 2：`LAST_LOCAL_SESSION_REMOTE_WRITE_KEY` 不能直接复用于 per_load 冷却。**

`isPushLikeSyncAction`（L7901-L7917）只记录 `pushed`、`pushed_initial`、`merged_read_progress` 等 push 类 action，不记录 `pulled` / `force_pulled` / `no_change`。per_load 走完整 `performAutoSync`，产生的结果可能是 pull 而非 push。如果只检查该 key，pull 类结果将无法命中冷却条件，per_load 仍会反复触发。

因此 per_load 冷却必须用**独立实现**——要么新增专用 session cooldown key，要么用纯时间窗口（如"上次 per_load 同步完成时间 + 冷却期"）直接挡。

---

### 第一优先：同机/同会话归因阻止自动 reload

**位置：`shouldApplyAutoPullRefreshForSyncResult`（S1Plus.js:10338）或在 `applyRefreshPolicyForSyncResult`（S1Plus.js:10813）**

**口径**：`sameSessionRemoteWrite === true` 或 `sameDeviceRemoteWrite === true` 的 sync 结果，默认不触发 `reload_now`，降级为 `thread_soft_prompt` 或静默更新状态。不假设"无实质变化"——hash 判断（L19184/L19192/L19209）说明 `pulled` 意味着内容确实变了，但变化来源是同机，不需要打断当前浏览。

**原因**：所有入口（per_load、daily_startup、前台恢复、background push 后回写）最终都经过这两个函数。同机归因在此处统一拦截，改动面最小、覆盖面最广。

### 第二优先：给 per_load 增加独立的 session 冷却

**位置：`handlePerLoadSyncCheck`（S1Plus.js:36430）函数体开头**

**方案 A（推荐）**：纯时间窗口冷却。在 `handlePerLoadSyncCheck` 内部维护 `GM_setValue("s1p_per_load_last_sync_ts", Date.now())`，进入前检查距离上次同步是否在冷却窗口内。不依赖任何现有 key 语义，逻辑独立。

**方案 B**：新增专用 session key，记录每次 per_load 的完成时间和远端 `updated_at`，下次进入时对比。

**原因**：per_load 是唯一没有 session 级节流的入口，且它走全量 push/pull/merge（L20700+），不是轻量 probe。用独立冷却实现，避免与 `LAST_LOCAL_SESSION_REMOTE_WRITE_KEY` 的 push-only 语义冲突。

### 第三优先（后续）：收敛决策逻辑到集中函数

在 Step 1-2 完成后，将所有入口的判断逻辑（lock/脏/归因/cooldown/页面策略）收敛到一个纯函数 `decideWhatToDoWithRemoteChange(syncResult, context)`，不写 GM 存储，不管锁生命周期，只做判断。

---

## 一句话建议

**在 auto-reload 决策层将同机/同会话归因降级为不打断浏览的轻量反馈，再用纯时间窗口给 per_load 加独立 session 冷却——两步合起来不到 30 行，堵住当前可验证的两个最大缺口。**
