# S1 Plus 自动同步/自动拉取 — 实施修复方案

## 问题总览

当前自动同步/自动拉取存在三个可验证的缺口，导致单设备误报"远端有更新"、同机多标签误刷新：

| # | 问题 | 根因 | 影响 |
|---|---|---|---|
| A | `per_load` 无会话级冷却 | `handlePerLoadSyncCheck`（L36441）每次页加载执行全量 push/pull/merge，无 session throttle | 同 session 内反复触发无意义全网请求 + 可能 reload |
| B | 同机归因只抑制文案，不抑制刷新 | `suppressMessage`（L36460）只控制 toast，`shouldApplyAutoPullRefreshForSyncResult`（L10338）不管 `sameSessionRemoteWrite`/`sameDeviceRemoteWrite`；非 `merged_read_progress` 的帖子页静默 reload | 静默误动作比通知性误动作更危险 |
| C | probe→sync→refresh 链式耦合 | probe（L21518 `metadataOnly: true`）看到 `updated_at` 变更 → `requestForegroundRemoteSyncCheckFn`（L21656）执行全量 sync → `applyRefreshPolicyForSyncResult`（L21681）自动刷新；整链无节制 | `updated_at` 的误判沿链放大 |

当前 `S1Plus.js` 已有成熟基础设施：hash-first 决策（L19184-L19250）、多级锁（L19695-L19715）、冷切换（L21439-L21447）、阅读进度 guard（L34218-L34291、L34651-L34661）、页面类型感知的刷新策略（L10670-L10710）。问题不在执行层，在**决策层缺口**。

---

## 不做的事（参考 auto-check-redesign 的教训）

| 不做 | 理由 |
|---|---|
| 引入 `SyncCoordinator` / `SyncIntent` / 全局 queue / lease / circuit breaker | GM 存储无事务；`acquireBackgroundSyncLock`（L19695-L19715）是 `GM_setValue` + 读回验证，不是 CAS；跨标签共享状态会在无事务环境下产生竞态漂移 |
| 删除 `per_load` 入口 | `resolveSyncAutoCheckModeValue`（L27127-L27133）有活跃的 `per_load` UI 选项，删除是 breaking change |
| 把多个安全条件叠加成 `safe_foreground` | 阅读进度 guard（L9670-L9699）已证明条件累积 → "永远凑不齐" → 悄悄失效 |
| 一次性大迁移 | 7 阶段全量重构会制造不可验证的中间态；应每步独立实施、独立验收 |
| probe 阶段引入 `contentHash` 二次拉取 | probe 用 `metadataOnly: true`（L21518）是正确的轻量设计，不应改成半个 sync |

---

## 实施：Step 1 & Step 2（最优先，独立实施）

两个 Step 降噪 + 堵误刷新，改动约 30 行，覆盖全部自动同步入口。

### Step 1：给 startup auto-sync（daily + per_load）增加共用冷却

**文件** `S1Plus.js`  
**位置**  
- `handlePerLoadSyncCheck` 函数体开头（L36430）  
- `handleStartupSync` 函数体末尾（L36524+）

**问题**：启动流程是先 `handleStartupSync()` 再 `handlePerLoadSyncCheck()`（L36669-L36676）。若 daily 跑完返回 false（`no_change` 或今日已完成），per_load 立刻再跑一次完整 startup-mode sync。仅给 per_load 自己打时间戳，挡不住 `daily → per_load` 连续双跑。

**修改方案**

```javascript
// 放在同步常量区（与 LOCAL_SESSION_REMOTE_WRITE_TTL_MS 等常量放在一起）
const STARTUP_AUTO_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const STARTUP_AUTO_SYNC_LAST_TS_KEY = "s1p_startup_auto_sync_last_ts";

// ——— handlePerLoadSyncCheck（L36430）———

const handlePerLoadSyncCheck = async () => {
    const settings = getSettings();
    if (
      !settings.syncPerLoadCheckEnabled ||
      !settings.syncRemoteEnabled ||
      !settings.syncRemoteGistId ||
      !settings.syncRemotePat
    ) {
      return false;
    }

    // ── 新增：startup 共用冷却 ──
    const lastStartupAutoSyncAt = GM_getValue(STARTUP_AUTO_SYNC_LAST_TS_KEY, 0);
    if (Date.now() - lastStartupAutoSyncAt < STARTUP_AUTO_SYNC_COOLDOWN_MS) {
      return false;
    }
    // ── 新增结束 ──

    const result = await runStartupModeAutoSyncCheckWithIndicator({
      source: AUTO_SYNC_INDICATOR_SOURCE_PER_LOAD,
      // ... 原有参数
    });

    // ── 新增：同步完成后记录时间 ──
    if (shouldRefreshStartupAutoSyncCooldown(result)) {
      GM_setValue(STARTUP_AUTO_SYNC_LAST_TS_KEY, Date.now());
    }
    // ── 新增结束 ──
    // ... 原有逻辑
```

同时在 `handleStartupSync` 末尾写入 `STARTUP_AUTO_SYNC_LAST_TS_KEY`，使 daily 也能刷新冷却计时。但需要收窄写入条件——不是所有 `skipped` 都代表同步完成：

```javascript
// ——— 新增 helper，定义在同步常量区附近 ———
// 纯函数，只判断不写入。写入统一在调用点执行。
const shouldRefreshStartupAutoSyncCooldown = (result) => {
    if (result.status === "success") return true;
    if (result.status === "skipped") {
      // 只有以下 reason 代表"同步已完成或不应马上重试"，可以写入冷却：
      return (
        result.reason === "daily_sync_already_completed" ||  // L36514
        result.reason === "conflict_paused"                   // 冲突暂停，不该重试
      );
    }
    return false;
};
// ——— helper 结束 ———

// ——— handleStartupSync（L36524+，在 markDailyStartupSyncCompletedForToday 之后）———

    // ── 新增：daily 同步完成后也刷新冷却 ──
    if (shouldRefreshStartupAutoSyncCooldown(result)) {
      GM_setValue(STARTUP_AUTO_SYNC_LAST_TS_KEY, Date.now());
    }
    // ── 新增结束 ──
    // ... 原有 switch/apply 逻辑
```

**不写冷却的情形举例**：`startup_lock_unavailable`（L20937-L20939，另一标签持有锁，本次未执行），不应让一次未获取锁的尝试压制后续 5 分钟的 per_load。

**要点**
- "冷却"是跨标签、短 TTL 的 GM 存储冷却（~跨标签共享），不是浏览器 sessionStorage 意义上的 session 冷却。这实际上更适合降噪
- daily 和 per_load 共用同一个 key `s1p_startup_auto_sync_last_ts`，避免"daily 刚跑完、per_load 紧接着跑"的重复
- 不依赖 `LAST_LOCAL_SESSION_REMOTE_WRITE_KEY`（L7901-L7917 `isPushLikeSyncAction` 只记录 push，不记录 pull）
- 默认冷却窗口 5 分钟，可通过修改常量调整

---

### Step 2：同机/同会话归因阻止自动 reload

**文件** `S1Plus.js`  
**位置** `applyRefreshPolicyForSyncResult`（L10813）

**当前行为**

```javascript
// L10813-L10825 (现状)
const applyRefreshPolicyForSyncResult = (syncResult, options = {}) => {
    if (!shouldApplyAutoPullRefreshForSyncResult(syncResult)) {
      return null;
    }
    const action = syncResult.action || "pulled";
    const allowThreadSoftPrompt = action === "merged_read_progress";
    return applyAutoPullRefreshPolicy({
      ...options,
      action,
      allowThreadSoftPrompt,
    });
};
```

- `shouldApplyAutoPullRefreshForSyncResult`（L10338）只看 `status === "success"` + action 类型，不检查归因
- `allowThreadSoftPrompt` 仅 `merged_read_progress` 为 true；普通 `pulled`/`force_pulled` 在帖子页仍 `reload_now`（L10682 `return { policy: "reload_now", ... }`）
- `getAutoPullRefreshPlan`（L10669）对 list/generic 页永远返回 `shouldReload: true`，不受 `allowThreadSoftPrompt` 影响；仅线程页（L10681）受此参数影响

因此单纯设置 `allowThreadSoftPrompt: true` 不足以阻止列表页和通用页的 reload。

**修改方案**

改动分两处：① `applyRefreshPolicyForSyncResult` 返回结构化 suppressed plan；② 调用方用 `hasScheduledAutoPullReload()` 判断是否 reload，而非假设调了就一定 reload。

**① `applyRefreshPolicyForSyncResult`（L10813）**

```javascript
const applyRefreshPolicyForSyncResult = (syncResult, options = {}) => {
    if (!shouldApplyAutoPullRefreshForSyncResult(syncResult)) {
      return null;
    }
    const action = syncResult.action || "pulled";

    // ── 新增：同机归因降级 ──
    const isSameMachineWrite =
      syncResult.sameSessionRemoteWrite === true ||
      syncResult.sameDeviceRemoteWrite === true;
    if (isSameMachineWrite) {
      // 不进入自动刷新链。同机导入的数据已落在本地存储，无害。
      console.log("S1 Plus: 同机归因自动刷新已抑制", {
        action,
        sameSessionRemoteWrite: syncResult.sameSessionRemoteWrite === true,
        sameDeviceRemoteWrite: syncResult.sameDeviceRemoteWrite === true,
        deviceId: syncResult?.remoteWriter?.deviceId || "",
      });
      return {
        policy: "same_machine_suppressed",
        pageType: "generic",
        shouldReload: false,
        action,
        reloadSchedule: { status: "suppressed", reason: "same_machine_write" },
      };
    }
    // ── 新增结束 ──

    const allowThreadSoftPrompt = action === "merged_read_progress";
    return applyAutoPullRefreshPolicy({
      ...options,
      action,
      allowThreadSoftPrompt,
    });
};
```

**② 调用方：用 `hasScheduledAutoPullReload` 决定是否 `return true`**

当前代码在 `handlePerLoadSyncCheck`（L36457-L36467）和 `handleStartupSync`（L36543-L36558）中：

```javascript
// 现状（有问题）：return true 基于 shouldApplyAutoPullRefreshForSyncResult，
// 不检查 apply 是否真的调度了 reload。
if (shouldApplyAutoPullRefreshForSyncResult(result)) {
  applyRefreshPolicyForSyncResult(result, { ... });
  return true;  // ← 假设调了就一定会 reload
}
```

应改为：

```javascript
if (shouldApplyAutoPullRefreshForSyncResult(result)) {
  const refreshPlan = applyRefreshPolicyForSyncResult(result, { ... });
  // hasScheduledAutoPullReload 已存在于 L10827-L10830
  return hasScheduledAutoPullReload(refreshPlan);
}
```

**要点**
- 返回 `{ policy: "same_machine_suppressed", shouldReload: false }` 而非 `null`，保持返回值类型一致，`hasScheduledAutoPullReload()`（L10827-L10830）可直接判断
- 调用方不再盲目 `return true`，而是检查 reload 是否真的被调度了——同机归因 suppressed plan 的 `reloadSchedule.status === "suppressed"`，所以 `return false`，不影响后续启动流程
- `sameSessionRemoteWrite` 和 `sameDeviceRemoteWrite` 已在 `recentRemoteWriteResultContext`（L20593）中注入 sync result，所有入口的 result 都携带这两个字段
- 此修改不影响手动同步、不影响跨设备远端变化
- 同机的 `merged_read_progress` 也会被抑制 reload（这是期望的行为：同机合并阅读进度不需要刷新）
- **约束**：sync 已完成、`importLocalData()`（L20693）已执行——这里只能阻止随后的 reload，不能阻止已发生的 import

---

## 实施：Step 3（后续，可独立实施）

### probe→sync 链路的节制层

**当前链路：**

```
foreground probe (metadataOnly) → updated_at 变更
  → requestForegroundRemoteSyncCheckFn (完整 sync)    // L21656
    → shouldApplyAutoPullRefreshForSyncResult           // L21681
      → applyRefreshPolicyForSyncResult                 // L21682
```

问题在第二步：probe 只用 `updated_at` 做判断，但 `decideSyncActionByVersion`（L19184）在 sync 内部已经是 hash-first。如果 sync result 是 `no_change`（hash 一致）、或归因为 same-session/same-device，不应进入 apply 环节。

**当前已有部分防护**：`getForegroundRemoteChangeKind`（L21675-L21680）和 `isHashEqualAfterResync`（L21695-L21696）在 probe 层已做归类和降级判断，但最终仍由 `shouldApplyAutoPullRefreshForSyncResult` 决定是否 apply。

**Step 2 完成后此优先级降低**：因为 Step 2 已在 apply 层把同机归因降级，`sameDeviceRemoteWrite` 或 `sameSessionRemoteWrite` 的结果将不触发 reload——probe 触发的 sync 即使执行了 import，也不会刷新页面。剩余价值是减少无意义的 sync 请求。

**可选增强**：在 `runStartupModeAutoSyncCheck` 之后（L20604+），如果 `versionDecision` 是 `no_change` 且 `recentRemoteWriteResultContext` 显示同机归因，标记 result 为静默完成，禁止后续 apply。此改动影响面限于 `performAutoSync` 内部，不改变接口。

**当前进度（2026-04-30）**：Step 3 已实现基础节制逻辑，但浏览器侧验收继续观察，不在本文档中标记为完全验收。后续重点看前台恢复、visible poll、foreground retry、同机不可合并冲突诊断四类路径是否符合预期。

---

### Step 3b：同机冲突诊断增强，不自动解决

**位置**：`performAutoSync` 的 `conflict` 分支（L20800+），在 `canAutoMergeReadProgress === false`、即将进入 `asConflictResult(...)` 之前。

**目标**：当 `both_changed_since_baseline` 无法自动合并时，如果远端 writer 与当前本地设备/session 存在归因匹配，只增强日志和诊断面板说明，不改变冲突暂停行为。

**行为**：

```javascript
if (isBothChangedReason && !canAutoMergeReadProgress) {
  const match = recentRemoteWriteResultContext;
  if (match.sameDeviceRemoteWrite || match.sameSessionRemoteWrite) {
    console.warn("S1 Plus (Sync): 同设备/同会话归因冲突，自动同步仍暂停等待手动处理。", {
      sameDevice: match.sameDeviceRemoteWrite === true,
      sameSession: match.sameSessionRemoteWrite === true,
      remoteWriter: match.remoteWriter,
      localHash: shortHashForLog(localDataObject.contentHash),
      remoteHash: shortHashForLog(remote.contentHash),
      baselineHash: shortHashForLog(getSyncBaselineState()?.contentHash),
      localBaseHash: shortHashForLog(localDataObject.baseContentHash),
      remoteBaseHash: shortHashForLog(remote.baseContentHash),
    });
  }
}
```

**说明**：

- `sameDeviceRemoteWrite === true` 只表示远端 writer 的 `deviceId` 与当前本地 `syncDeviceId` 相同；设备 ID 是用户配置值，可能重名、复制或迁移。
- `sameSessionRemoteWrite === true` 是更强的同会话信号，但仍依赖本地近期写入记录和 TTL，不应单独作为自动覆盖依据。
- 默认仍返回 `asConflictResult(...)`，交给手动同步处理。

**未来自动恢复条件**：

只有未来同时满足以下条件时，才考虑自动恢复，而不是默认自动覆盖：

1. 强同会话归因命中。
2. 本地 dirty 时间严格晚于远端 writer 写入时间。
3. 远端 `updated_at` 在判定期间未再次变化。
4. 本地/远端差异被证明只限阅读进度或其他可安全合并字段。

否则仍保持当前行为：暂停自动同步，提示用户手动同步。

---

## 实施：Step 4（先验证，再决定是否补代码）

### 后台标签页假脏写

**已有防护（已确认有效）：**

| 防护 | 位置 | 机制 |
|---|---|---|
| 被动后台检测 | L34651-L34661 | `consumeBackgroundOpenThreadHint` → `passiveBackgroundOpened = true` |
| 需显式交互确认 | L34218-L34222 | `initiatedWhileHidden \|\| passiveBackgroundOpened` → 必须用户交互后才允许保存 |
| hidden 页面跳过 | L34291-L34298 | `visibilityState !== "visible"` 且在非 flush 场景下，直接 return 不保存 |

**验证方式**：
1. 在 Tampermonkey 环境后台打开 3 个帖子页（中键/右键 → 后台标签页打开）
2. 等 5 分钟不与这些标签页交互
3. 检查 `s1p_readingProgress` 是否产生了新写入
4. 如果有漏网场景（如 `visibilitychange` hidden→visible 切换瞬间的 race），记录具体的触发时序后再补 guard

**验证辅助**：当前 `S1Plus.js` 中已加入临时 `s1pBgReadTest.start()` / `s1pBgReadTest.report()` / `s1pBgReadTest.reset()` 验证器，用于记录测试开始时的阅读进度快照，并在等待一段时间后判断后台开帖是否造成新增或更新。

**验证记录（2026-04-30）**：已完成一轮后台开帖验证。`s1pBgReadTest.start()` 于 `2026/4/30 23:44:23` 建立快照，初始 `readProgressCount: 1190`，初始 `lastModified: 2026/4/30 23:20:58`；约 `415742ms` 后执行 `s1pBgReadTest.report()`，返回 `verdict: "PASS"`、`changedCount: 0`。本轮未发现后台被动打开帖子造成阅读进度新增或更新。

**结论**：Step 4 当前作为验证项已通过一轮真实浏览器检查，不在本方案中追加业务逻辑改动。若后续验证器返回 `WARN` / `FAIL`，再根据具体变更记录定位漏网时序并补 guard。

---

## 实施：Step 5（收敛到集中决策函数）

在 Step 1-2 完成后执行。Step 3 的浏览器侧观察不阻塞 Step 5，但 Step 5 不能依赖"Step 3 已完全验收"这个假设。

### 实施边界

Step 5 只做现有自动同步结果的**刷新/提示决策收敛**，不扩大同步行为：

- 只新增纯函数，不引入 `SyncCoordinator` / `SyncIntent` / 全局 queue / lease / circuit breaker。
- 只决定 `shouldApply`、`shouldReload`、`shouldNotify`、`suppressMessage`、`reason` 等 UI 后续动作，不重新决定 push/pull/merge/conflict。
- 不自动解决冲突，不新增本地覆盖远端，不改变 `conflict -> 手动同步` 默认路径。
- 优先替换自动同步路径：`per_load`、`daily_startup`、foreground probe/follow-up、foreground retry；手动同步主流程和冲突弹窗保持原行为。
- 保留 `applyRefreshPolicyForSyncResult` / `applyAutoPullRefreshPolicy` 作为执行层；集中决策函数只产出判断或计划，不直接执行 reload、toast、GM 写入。

### 实施顺序

1. 盘点 `shouldApplyAutoPullRefreshForSyncResult`、`applyRefreshPolicyForSyncResult`、`hasScheduledAutoPullReload` 的现有调用点。
2. 在现有刷新策略 helper 附近新增集中决策函数，先不替换调用点。
3. 先替换 startup/per_load 两个入口，确认 `same_machine_suppressed`、`thread_soft_prompt`、`reload_now` 返回值都保持等价。
4. 再替换 foreground probe/follow-up 与 foreground retry 路径，把 Step 3 已有的 no-op / 同机抑制原因接入同一决策出口。
5. 最后删除或收窄重复判断，保留必要的兼容 wrapper，避免一次性重排手动同步和冲突处理。

### 目标形态

```javascript
const decideWhatToDoWithRemoteChange = (syncResult, context = {}) => {
  // 0. 非可 apply 的结果 → 统一返回 no-op
  if (!shouldApplyAutoPullRefreshForSyncResult(syncResult)) {
    return {
      shouldApply: false,
      shouldReload: false,
      shouldNotify: false,
      suppressMessage: true,
      reason: syncResult?.reason || "not_applicable",
    };
  }

  // 1. 同 session / 同 device 归因 → 不 reload，不通知
  if (
    syncResult.sameSessionRemoteWrite === true ||
    syncResult.sameDeviceRemoteWrite === true
  ) {
    return {
      shouldApply: false,
      shouldReload: false,
      shouldNotify: false,
      suppressMessage: true,
      reason: "same_machine_write",
    };
  }

  // 2. 跨设备或外部变更 → 按页面类型 + action 决策
  const plan = getAutoPullRefreshPlan({
    ...context,
    action: syncResult.action,
    allowThreadSoftPrompt: syncResult.action === "merged_read_progress",
  });

  // 注意：即使 shouldReload: false，也可能需要显示提示
  // - thread_soft_prompt: 帖子页轻量提示
  // - settings_dirty: 设置弹窗未保存警告
  // 见 applyAutoPullRefreshPolicy 中 L10785-L10788
  const needsSoftPrompt =
    plan.policy === "thread_soft_prompt" ||
    plan.policy === "settings_dirty";

  return {
    shouldApply: true,
    shouldReload: plan.shouldReload,
    shouldNotify: plan.shouldReload || needsSoftPrompt,
    suppressMessage: !(plan.shouldReload || needsSoftPrompt),
    reason: plan.policy,
    refreshPlan: plan,
  };
};
```

```javascript
// 调用方改用决策函数 + apply：
const decision = decideWhatToDoWithRemoteChange(result, {
  pageType: /* 从当前页面推断 */,
  source: "per_load" | "daily_startup" | "foreground" | "background",
});
if (decision.shouldReload || decision.shouldNotify) {
  applyRefreshPolicyForSyncResult(result, {
    suppressMessage: !decision.shouldNotify,
    ...
  });
}
```

**调用点改造：** 将所有入口（per_load、daily_startup、前台恢复、background push 回写后）中类似的：

```javascript
if (shouldApplyAutoPullRefreshForSyncResult(result)) {
  applyRefreshPolicyForSyncResult(result, { ... });
}
```

替换为：

```javascript
const decision = decideWhatToDoWithRemoteChange(result, {
  pageType: /* 从当前页面推断 */,
  source: "per_load" | "daily_startup" | "foreground" | "background",
});
if (decision.shouldReload || decision.shouldNotify) {
  applyRefreshPolicyForSyncResult(result, { suppressMessage: !decision.shouldNotify, ... });
}
```

纯函数，不写 GM 存储，不管锁生命周期。**只做判断，不做执行。**

**验收重点**：Step 5 成功的标准不是新增能力，而是调用点从散落的 `shouldApplyAutoPullRefreshForSyncResult` + `applyRefreshPolicyForSyncResult` + `hasScheduledAutoPullReload` 组合，收敛到同一个决策出口；行为上除已定义的同机/no-op 抑制外，应保持现有自动同步表现等价。

---

## 验证清单

实施后，在真实 Tampermonkey 环境中确认：

| # | 场景 | 期望 |
|---|---|---|
| 1 | 单设备正常浏览论坛 | 不弹出"远端有更新" |
| 2 | 开启 `per_load` 模式，同 session 快速翻页 | 不会每页都触发全量同步（冷却生效），daily 跑完后 per_load 不再重复跑 |
| 3 | 标签 A 推送阅读进度 → 切到标签 B | B 不弹"云端有更新"，不刷新页面 |
| 4 | 标签 A 修改设置 → 切到标签 B | B 检测到变更、静默应用、不刷新（同机归因降级） |
| 5 | 设备 A 推送 → 设备 B 启动 | B 正常拉取、可刷新（跨设备变更不受影响） |
| 6 | 列表页，远端有跨设备变更 | 正常自动刷新 |
| 7 | `daily_startup` 仍按天去重 | 不受冷却影响（daily 完成后会写冷却时间，但 daily 自身按天去重不受冷却读取） |
| 8 | 另一标签页持有锁（`startup_lock_unavailable`）| 冷却时间未被刷新，per_load 下一轮仍可正常触发 |

---

## 风险与回滚

- **Step 1 冷却窗口的选择**：5 分钟是经验值。如果用户极端高频浏览（per_load 模式下密集翻帖），冷却可能让最新数据延迟 5 分钟同步。可缩小到 2 分钟或做成配置项
- **Step 2 同机归因依赖 `syncDeviceId`**：`sameDeviceRemoteWrite` 要求用户配置设备 ID。未配置时，`isPushLikeSyncAction`（L7901-L7917）仍可通过 `LOCAL_SESSION_REMOTE_WRITE_TTL_MS` 内的时间窗口做 same-session 判断；配置后精度提升到 same-device
- **回滚成本**：两个 Step 均为局部改动，各自不超过 15 行。出问题直接 revert 不影响其他逻辑

---

## 实施状态（2026-04-28）

- 状态：Step 1 与 Step 2 已完成。
- 本轮完成：
  - 在 `S1Plus.js` 中新增 `s1p_startup_auto_sync_last_ts` 与 5 分钟 startup auto-sync 共用冷却。
  - `handlePerLoadSyncCheck` 会在执行前读取共用冷却，避免 daily 刚完成后 per_load 立即重复全量同步。
  - `handleStartupSync` 与 `handlePerLoadSyncCheck` 会在 `success`、`daily_sync_already_completed`、`conflict_paused` 时刷新冷却；`startup_lock_unavailable` 等未执行结果不会刷新冷却。
  - `applyRefreshPolicyForSyncResult` 对 `sameSessionRemoteWrite` / `sameDeviceRemoteWrite` 返回 `same_machine_suppressed` 结构化计划，阻止自动 reload。
  - `handleStartupSync` 与 `handlePerLoadSyncCheck` 改为通过 `hasScheduledAutoPullReload(refreshPlan)` 判断是否返回 reload 中断信号。
- 涉及文件：
  - `S1Plus.js`
  - `sync-auto-check-impl-plan.md`
- 验证：
  - `node --check S1Plus.js` 通过。
- 剩余工作：
  - 真实 Tampermonkey / Greasemonkey 环境中的 8 项场景验证尚未在本环境执行。
- 风险 / 限制：
  - 冷却窗口仍为固定 5 分钟，后续如反馈延迟感过强，可再评估是否缩短或配置化。
- 下一步：
  - 按验证清单做浏览器侧回归，重点看单设备多标签、per_load 快速翻页、跨设备远端变化三类路径。

---

## 实施状态（2026-04-30）

- 状态：Step 3 已实现，浏览器侧验收后续继续观察；Step 4 已完成一轮验证，结果通过。
- 本轮完成：
  - 新增前台 probe follow-up sync 的刷新节制判断：`no_change` / `hash_equal_after_resync` / `sameSessionRemoteWrite` / `sameDeviceRemoteWrite` 不再进入 `applyRefreshPolicyForSyncResult`。
  - 前台 probe 正常路径与 foreground retry 路径都返回/记录 `foreground_probe_suppressed` 计划或日志，保留诊断可见性但不调度 reload。
  - `performAutoSync` 的 `no_change` 结果附带前台刷新抑制原因，帮助 probe 层识别 hash 等价或同机 hash 等价结果。
  - `both_changed_since_baseline` / `both_changed_since_baseline_by_updated_at` 且无法自动合并时，如果命中同会话/同设备归因，只增强 console 与同步诊断结果码；仍返回原冲突 reason，继续暂停自动同步等待手动处理。
  - 新增临时 `s1pBgReadTest` 验证器，用于更低操作成本地观察后台标签页是否产生阅读进度假脏写。
- 涉及文件：
  - `S1Plus.js`
  - `sync-auto-check-impl-plan.md`
- 验证：
  - `node --check S1Plus.js` 通过。
  - `git diff --check` 通过。
  - Step 4 浏览器侧验证通过：`s1pBgReadTest.report()` 返回 `verdict: "PASS"`、`changedCount: 0`，观察时长约 `415742ms`。
- 剩余工作：
  - Step 3 浏览器侧验收继续观察：仍需回归前台恢复、visible poll、foreground retry、同机不可合并冲突诊断四类路径。
  - Step 4 暂无新增代码动作；若后续验证器出现 `WARN` / `FAIL`，再补充具体 guard。
- 风险 / 限制：
  - Step 3 仍保持 `metadataOnly` probe 轻量设计；不会在 probe 阶段拉取 content hash，因此不能阻止所有 follow-up sync，只阻止 no-op / 同机归因结果进入刷新策略。
  - Step 4 本轮验证只证明观察窗口内没有阅读进度假脏写，不等同于覆盖所有浏览器/主题/打开方式组合。
- 下一步：
  - Step 3 继续按真实使用慢慢观察；若未出现异常，可进入 Step 5 的集中决策函数收敛。
