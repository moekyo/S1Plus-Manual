# 自动同步 & 自动拉取误报修复方案

## 0. 背景与现有基线

### 0.1 三条独立的自动同步入口

| 入口 | 函数 | 门控字段 | 频率 |
| --- | --- | --- | --- |
| 每页加载 | `handlePerLoadSyncCheck` (L36431) | `syncPerLoadCheckEnabled` | 每次页面加载 |
| 每日首次 | `handleStartupSync` (L36474) | `syncDailyFirstLoad` | 每天一次 |
| 前台恢复 | `runForegroundFollowUpAutoSyncCheckWithIndicator` | `syncCheckOnReturnToForeground` | 切回前台 / visible poll |

此外还有 `triggerRemoteSyncPush` 负责后台推送本地变更。

### 0.2 已经具备的基础设施（不需要重建）

- `resolveRecentRemoteWriteMatch` (L7992)：按 `remoteUpdatedAt` + `deviceId` + 本地近期写记录判断 same-session / same-device 归因
- `getRemoteWriteMatchKind` (L8022)：将归因分类为 `same_session_write` / `same_device_write` / `external_remote_change`
- `isForegroundRemoteFreshnessCheckEnabled` (L10105)：前台探测的门控开关
- `getAutoPullRefreshPlan` (L10670)：页面类型感知的刷新策略（thread 页 soft prompt / list 页 reload / settings dirty defer）
- `shouldApplyAutoPullRefreshForSyncResult`：自动拉取后是否应刷新的判断
- `LOCAL_SESSION_REMOTE_WRITE_TTL_MS`：本地近期写记录，用于 same-session 判定
- `syncDeviceId` 的 lastWriter 追踪链（L7733–L7752）

### 0.3 当前真正的痛点

1. **解码点散落**：每个入口自己判断是否能同步，自己管 lock/retry/defer/suppress，逻辑重复且边界不一致
2. **`per_load` 噪声最高**：每次页面加载都探测远端，但两次浏览之间远端几乎不可能变化
3. **`updated_at` 被过度解读**：远端时间戳变化直接链式触发"全量同步 → 页面刷新"，中间没有节制
4. **同机归因只抑制文案，不抑制拉取**：`suppressMessage` 静默了提示弹窗，但 `applyRefreshPolicyForSyncResult` 仍然会跑，非 thread 页仍会误刷新

---

## 1. 核心思路：集中决策点，而不是协调器大厦

### 1.1 `auto-check-redesign/` 的"统一协调器"为什么不行

`auto-check-redesign/` 的诊断是对的，但开出的药方有问题。它设想的 `SyncCoordinator` 依赖以下假设：

**问题一：全局 lease/queue/circuit breaker 依赖 GM 存储的可靠性假设**

```js
// auto-check-redesign 设想的协调器需要跨标签读写：
// - global lease state
// - queue drain state
// - circuit breaker state
// - shared cooldown timestamps
// 全部走 GM_setValue / GM_getValue
```

GM 存储不是数据库。跨标签写入无事务。你用 `GM_setValue("s1p_coordinator_lease", {...})` 的那一刻，另一个标签页可能正在同时写同一个 key。这不是理论问题——现有代码里 `backgroundSyncLock` 和 `globalSyncLock` 本身就是通过 timestamp-based TTL 来做乐观锁，已经侧面说明没有真正的互斥。协调器越"智能"（queue 合并、优先级重排、circuit break），对状态一致性的假设就越强，在 GM 存储上就越容易出 bug。

**问题二：过度抽象带来的排查成本**

`auto-check-redesign/` 新增了 `SyncIntent`、`SyncCoordinatorState`、`SyncTabGuardState`、`SyncStatusViewModel` 四层模型，每层有自己的字段、生命周期、序列化/反序列化。37597 行的脚本再加这些，排查一个"为什么这次没自动同步"要从 trigger → intent → coordinator → queue → lease → probe → reconcile → apply 追 8 层。在生产环境里，这意味着每次出问题都是一次考古。

**问题三：所有 phase 必须全部完成才生效**

7 个 phase 相互依赖——phase 1 定义模型，phase 2 才能接入口，phase 4 依赖 phase 3 的 lease 包装，phase 6 依赖前 5 个 phase 的策略矩阵。任何一个 phase 没完成，整条链路就是半成品。而在现有代码的日常维护中，要求一次性完成 7 个阶段的改动几乎不可能。

**问题四：保守策略可能过于保守，导致自动同步悄悄失效**

`auto-check-redesign/` 中 `safe_foreground` 模式设想了 cooldown、tab quiet window、pending recovery settle、core data snapshot resync 等一整套前置条件。真实浏览场景下——用户来回切标签、页面在加载中、随时产生阅读进度——这些条件可能**永远凑不齐**。结果不是"安全地同步"，而是"安静地什么都不做"。用户以为功能正常工作，实际上自动同步已经悄悄瘫痪了。相比误报，沉默失效更难被发现。

**问题五：测试不可行**

`auto-check-redesign/regression_matrix.md` 定义了多设备 × 多标签 × 4 路径 × 2 种 deviceId 模式共 12 类场景，并要求在真实浏览器 + Tampermonkey 环境中手测。Node harness 只能验证状态机、结果码和数据结构，无法模拟真实 GM API 的跨标签延迟、后台定时器节流、bfcache 恢复时序。更关键的是，这份回归矩阵要求自动同步和自动拉取已被整合进同一架构后才能开始验证——在此之前，没有任何一步能独立验收。

**问题六：粗暴删除 `per_load` 入口会制造新问题**

`auto-check-redesign/` 将 `per_load` 定性为"高噪声触发源"并直接移出设计。但现实中 `per_load` 是用户显式可选的设置项——有些用户就是偏好"每次打开页面都检查一下远端"。删除它不是消除噪声，而是把一个用户主动选择的行为模式替换成系统替用户做的保守判断。这不是修 bug，是改产品行为。更安全的做法是保留入口但降低其触发频率（如 session 级冷静期），让用户策略和系统节制共存。

### 1.2 折中方案：一个集中的决策函数

"统一决策"这个概念本身是好的。但实现方式不应该是建一座协调器大厦，而应该是**一个函数**：

```js
function decideWhatToDoWithRemoteChange(syncResult, context) {
  // 1. 全局锁 / 冲突暂停检查（已有）
  // 2. 本地脏状态检查（已有）
  // 3. 同 session / 同 device 归因（已有，需加强——见 Step 2）
  // 4. 页面类型 × 结果类型的策略矩阵（已有 getAutoPullRefreshPlan）
  // 5. 冷静期检查（需新增——见 Step 1）

  return {
    shouldPull: ...,
    shouldRefresh: ...,
    shouldNotify: ...,
    reason: "..."
  };
}
```

所有入口（per_load、daily_startup、前台恢复、background push 回写后）把 sync 结果丢进这个函数，按返回值统一行动。**集中的是决策逻辑，不是执行机制。**

这与现有代码中散落在各处的 `switch` / `if` 差异化处理不同之处在于：
- 决策逻辑只写一次，不复制粘贴
- 策略变更只改一处
- 每个入口的行为差异通过 `context` 参数表达（如 `{ source: "per_load", pageType: "thread" }`），而不是各自写一套独立分支

---

## 2. 修复步骤

### Step 1: 给 `per_load` 入口增加 session 级冷静期

**目标**：消除"在同 session 内远端不可能变化时，却触发无意义同步检查"的噪声。

**具体**：在 `handlePerLoadSyncCheck` 中，探测前先检查**本 session 内是否有过近期同步记录**。如果当前 session 内刚刚做过一次同步（无论是 push 还是 pull），且远端 `updated_at` 与上次同步时记录的 `updated_at` 相同或相同 session 的写入记录显示远端就是本 session 写的，则直接 skip。

**实现位置**：`handlePerLoadSyncCheck` 函数体开头，`runStartupModeAutoSyncCheckWithIndicator` 调用之前。

```
handlePerLoadSyncCheck 中：
  检查 LOCALSESSION_REMOTE_WRITE_TTL_MS 内的写入记录
  如果有同 session 写入记录 且 远端 updated_at 与上次一致：
    return false
```

**影响范围**：仅 `per_load` 入口，不影响 `daily_startup` 和前台恢复。

**为什么不是直接删除 `per_load`**：它是用户显式可选的配置项，删除属于 breaking change。降噪比删除更安全。

---

### Step 2: 让同机归因抑制拉取行为本身，而不只是抑制提示

**目标**：同机另一标签页推送导致的远端变化，不再触发实际拉取 + 刷新。

**现有行为**：`suppressMessage: result.sameSessionRemoteWrite === true` 只抑制提示弹窗，但 `applyRefreshPolicyForSyncResult` 仍然会执行页面应用（对于非 thread 页意味着自动刷新）。等于"不告诉你，但偷偷刷新了"——静默误动作比告知误动作更危险。

**具体**：在 `shouldApplyAutoPullRefreshForSyncResult` 中增加条件——如果归因为 same-session 或 same-device，且本地和远端内容实质上未发生业务级别的变化（contentHash 一致或仅阅读进度差异），则**不触发刷新**，只静默更新本地 metadata 记录。

```
shouldApplyAutoPullRefreshForSyncResult 中：
  if syncResult.sameSessionRemoteWrite === true：
    if syncResult.action === "pulled" 且不是 force_pulled：
      检查实质差异
      if 无实质差异或仅 read_progress 差异：
        return false  // 只更新 metadata，不触发刷新
  if syncResult.sameDeviceRemoteWrite === true：
    同理降级
```

**影响范围**：所有自动拉取入口（per_load、daily_startup、前台恢复、background_push 后的自动拉取）。

---

### Step 3: 在 probe → sync → refresh 链路中插入节制层

**目标**：`updated_at` 变化不能不受节制地直接触发全量同步 + 页面操作。

**现有链路实际上已有三阶段**：
1. probe（`triggerForegroundRemoteFreshnessProbe`）
2. sync（`performAutoSync`）
3. apply（`applyRefreshPolicyForSyncResult`）

问题是三者**耦合太紧**——probe 命中后自动进 sync，sync 成功后自动进 apply。中间没有节制。

**具体**：在 probe → sync 之间加一个判断：probe 只负责"远端可能变了"，sync 的执行需要额外确认**远端 contentHash 与本地有实质性差异**。

最轻量的实现：在 `runForegroundFollowUpAutoSyncCheckWithIndicator` 调用前，由调用方执行一次轻量远端 metadata 拉取（不拉完整 payload），对比远端 `contentHash` 与本地记录。一致且归因为 same-session/same-device 的，直接回落为 `no_change`，不进入 sync。

```
在 probe 的 follow-up sync 调用前：
  轻量拉取远端 metadata（仅 syncMeta + contentHash 摘要）
  与本地 s1p_last_sync_content_hash 对比
  if 一致 且 (sameSession || sameDevice)：
    return { status: "no_change" }  // 不触发后续 sync
```

**实现收敛点**：这个判断逻辑最终可以作为 `decideWhatToDoWithRemoteChange` 的一部分（见 1.2 节）。

---

### Step 4: 防止后台标签页制造假脏写

**目标**：后台打开的帖子页如果不被用户真实阅读，不应产生可同步的 `read_progress`。

**现有防护**：`test-background-open-passive-session.js` 测试已覆盖此场景的数据流。

**实际代码中**：需确认 `s1p_readingProgress` 的写入入口是否有"标签页是否为后台打开"的判断。如果没有或不够严格，补充：标签页在首次获得用户交互（scroll / click / 手动编辑）之前，不应执行 `saveReadingProgress`。

---

### Step 5: 统一 `updated_at` 在整条链路中的决策权重

**目标**：消除不同入口对 `updated_at` 的解读不一致。

**规则表**：

| 阶段 | `updated_at` 可以做什么 | 不能做什么 |
| --- | --- | --- |
| probe | 标记"需要继续观察" | 直接触发 sync |
| sync | 参与冲突判断的多项条件之一 | 单独决定 pull / push 方向 |
| apply | 无直接用途（用 contentHash 判断） | 决定是否刷新 |

**实现**：在现有相关函数中，用 `contentHash` / `baseContentHash` 替代仅靠 `updated_at` 的判断。如果某处只用 `updated_at` 做判断且无法替换，至少要求同时满足"归因不是 same_session 或 same_device"。

---

## 3. 实施顺序与依赖

每步独立实施，但存在推荐顺序：

1. **Step 5（统一决策权重）**：实际上是理清规则，不写很多代码，但为后续 step 提供判断依据
2. **Step 1（冷静期）**：改一行，消除最大噪声源
3. **Step 2（同机归因抑制拉取）**：解决核心的误刷场景
4. **Step 3（probe→sync 节制层）**：提升整体链路可靠性
5. **Step 4（后台假脏写）**：兜底

推荐在 Step 1–3 完成后，将判断逻辑收敛到 `decideWhatToDoWithRemoteChange` 中，作为所有入口的统一决策点。

---

## 4. 收敛效果：集中决策点的具体形态

完成后，所有自动同步入口的调用模式从：

```
入口 → 自己判锁 → 自己判脏 → 自己判归因 → 调 sync → 自己判要不要刷新
```

变为：

```
入口 → 调 sync → 调 decideWhatToDoWithRemoteChange(result, context) → 统一行动
```

其中 `decideWhatToDoWithRemoteChange` 内部：

```
1. 全局冲突暂停检查        ← 已有，集中到此处
2. 同 session/device 归因   ← Step 2 加强
3. session 内冷静期检查     ← Step 1 新增
4. 页面类型 × 结果策略      ← 已有 getAutoPullRefreshPlan
5. updated_at 在对应阶段的角色 ← Step 5 明确

返回：{ shouldPull, shouldRefresh, shouldNotify, reason }
```

这不是一个类，不是一个状态机。就是一个纯函数。不写 GM 存储，不管理队列，不管锁生命周期。**只做判断，不做执行。**

---

## 5. 不应做的事

- 不要引入 `SyncCoordinator`、`SyncIntent`、`SyncStatusViewModel` 等新抽象层——理由见 1.1 节问题一、二
- 不要实现跨标签的全局共享 lease/queue/circuit breaker——GM 存储不支持事务，此类抽象在用户脚本场景下不可靠（见 1.1 问题一）
- 不要让安全条件累积到"永远凑不齐"的程度——每多一个前置条件，自动同步就更靠近"悄悄失效"（见 1.1 问题四）
- 不要删除 `per_load` 入口——它是用户可配置项，删除属于 breaking change。应保留入口但降低触发频率（见 1.1 问题六）
- 不要重建设置 UI——现有 UI 功能完整，改动性价比低
- 不要新增 Node 测试脚本作为主要验收手段——现有 harness 无法验证多标签时序和多设备网络（见 1.1 问题五）

---

## 6. 验收场景

1. **单设备本地浏览**：正常浏览论坛，不弹出"远端有更新"
2. **同机多标签正常推送**：标签 A 推送阅读进度后切到标签 B，B 不弹出"云端有更新"，也不触发页面刷新
3. **帖子页阅读中**：远端有变化时只在导航栏轻量提示，不自动刷新页面（现有 `getAutoPullRefreshPlan` 已做到 thread 页的 soft prompt，Step 2 加固后更可靠）
4. **同 session 内快速浏览**：连续打开页面，`per_load` 入口因冷静期命中而 skip，不重复探测
5. **per_load 模式下冷静期生效**：同 session 内远端无变化时不重复同步

---

## 7. 与 `auto-check-redesign/` 的关系

- **保留**：`auto-check-redesign/` 作为历史参考归档，其中对旧链路问题的诊断是有价值的
- **替代**：本方案替代 `auto-check-redesign/` 作为实施基线
- **核心区别**：旧方案试图用一座完整的协调器架构解决问题，但过度工程化且在代码中从未落地；本方案只补齐关键 guard 并将决策逻辑集中化，每个 step 可独立实施和交付
