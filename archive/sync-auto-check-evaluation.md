# S1 Plus 自动同步/自动拉取问题评估报告

## 结论

当前应优先采用 `sync-auto-check-fix-plan.md` 的增量修复路线，而不是继续推进 `auto-check-redesign/` 的全量协调器重构。

`auto-check-redesign/` 对问题的诊断大体正确：当前确实存在 per-load 噪声、probe → sync → refresh 链式放大、同机写入归因只影响文案不影响刷新等问题。但它低估了当前 `S1Plus.js` 已经存在的 hash 决策、锁、冷却、读取进度 guard、刷新策略等基础设施，因而给出了过重的协调器方案。

更合适的方向是：保留当前执行层，在现有入口之后补一个集中决策函数，把“是否提示、是否自动刷新、是否继续拉取/应用”的判断统一起来，并补齐 per-load 会话级冷却和 same-session/same-device guard。

## 当前代码事实

当前自动同步不是单一入口，而是多个入口共同触发。

`daily_startup` 由 `handleStartupSync()` 触发，每日一次，依赖 `s1p_last_daily_sync_date` 去重；见 [S1Plus.js:36473](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36473)、[S1Plus.js:36480](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36480)。

`per_load` 由 `handlePerLoadSyncCheck()` 触发，只要 `syncPerLoadCheckEnabled` 打开，每次 fresh startup flow 都可能执行；见 [S1Plus.js:36430](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36430)、[S1Plus.js:36676](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36676)。

前台初始 probe 由 `handleInitialForegroundRemoteFreshnessCheck()` 触发；见 [S1Plus.js:36682](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36682)、[S1Plus.js:10832](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:10832)。

前台恢复 probe 由 `pageshow` 和 `visibilitychange` 触发；见 [S1Plus.js:11044](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:11044)、[S1Plus.js:11073](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:11073)。

visible polling 开启后 active 4 分钟、idle 12 分钟轮询；见 [S1Plus.js:924](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:924)、[S1Plus.js:10151](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:10151)、[S1Plus.js:10200](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:10200)。

background push 由本地变更触发 `triggerRemoteSyncPush()`；见 [S1Plus.js:20134](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:20134)、[S1Plus.js:11126](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:11126)。

`syncPerLoadCheckEnabled` 不是迁移占位，而是实际运行时开关。它有默认值、迁移逻辑、UI 映射和运行时门控；见 [S1Plus.js:21883](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:21883)、[S1Plus.js:22120](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:22120)、[S1Plus.js:27126](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:27126)、[S1Plus.js:36431](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36431)。

`SyncCoordinator`、`SyncIntent`、`syncAutoFetchMode`、`safeAutoPull` 在当前 `S1Plus.js` 中不存在。当前代码仍是旧布尔设置 + 分散入口 + 局部 guard 的结构。

## 对 auto-check-redesign 的评估

它说对的部分：

per-load 噪声判断准确。当前 per-load 没有会话级冷却，只要用户处于该模式，每个新页面启动流程都可能执行一次远端同步检查；见 [S1Plus.js:36676](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36676)、[S1Plus.js:36441](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36441)。

probe → sync → refresh 链式放大判断准确。foreground probe 看到远端 `updated_at` 变化后，会触发 follow-up sync；sync 结果如果是 `pulled`、`force_pulled` 或 `merged_read_progress`，会进入刷新策略；见 [S1Plus.js:21525](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:21525)、[S1Plus.js:21656](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:21656)、[S1Plus.js:21681](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:21681)。

同机归因判断准确。当前代码能识别 `sameSessionRemoteWrite` 和 `sameDeviceRemoteWrite`，但 `shouldApplyAutoPullRefreshForSyncResult()` 不读取这些字段，只看 action；见 [S1Plus.js:7991](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7991)、[S1Plus.js:10338](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:10338)。入口处最多只是 `suppressMessage`，不能阻止刷新；见 [S1Plus.js:36457](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36457)、[S1Plus.js:10798](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:10798)。

它说得过头的部分：

当前同步决策不是纯粹依赖 `updated_at`。`decideSyncActionByVersion()` 优先使用 `contentHash` 和 baseline 判断内容是否真正变化，只有缺少 hash 时才回退到 `updated_at`；见 [S1Plus.js:19184](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:19184)、[S1Plus.js:19231](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:19231)、[S1Plus.js:19250](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:19250)。

foreground probe 也不是毫无防护。它已有 in-flight 检查、sync lock、local/shared cooldown、storage resync、读取进度 gate；见 [S1Plus.js:21418](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:21418)、[S1Plus.js:21447](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:21447)、[S1Plus.js:21571](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:21571)、[S1Plus.js:9670](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:9670)。

读取进度后台误写也已有 guard。代码会检查 hidden/passive background/open hint/visible confirmation，再决定是否保存阅读进度；见 [S1Plus.js:34218](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:34218)、[S1Plus.js:34277](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:34277)、[S1Plus.js:34651](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:34651)。

统一协调器思路有概念价值，但不适合作为当前实现路径。当前 GM 锁是 `GM_setValue` 后延迟读回验证，不是事务，也不是 compare-and-set；见 [S1Plus.js:19424](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:19424)、[S1Plus.js:19457](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:19457)、[S1Plus.js:19673](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:19673)。在这种存储模型上构建全局 queue、lease、intent、status hub，会放大跨标签状态漂移、过期锁误判和局部状态覆盖问题。

## 对 sync-auto-check-fix-plan 的评估

这份方案的主方向正确：不推倒重写，而是在当前代码基础上补关键 guard，并把分散判断收敛到集中决策函数。

它能堵住单设备误报链路的三个关键点：

第一，给 per-load 增加会话级冷却。当前 per-load 每页都可能跑 full sync，没有 session-level throttle；见 [S1Plus.js:36430](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36430)、[S1Plus.js:36676](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:36676)。

第二，让 same-session/same-device 参与自动刷新决策。当前 attribution 已经存在，但只影响文案，不影响 `shouldApplyAutoPullRefreshForSyncResult()`；见 [S1Plus.js:7991](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7991)、[S1Plus.js:10338](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:10338)。

第三，明确 `updated_at` 只是 probe hint。当前 sync 层已经 hash-first，但 probe 层仍然用 `updated_at` 变化触发 follow-up sync；见 [S1Plus.js:21525](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:21525)、[S1Plus.js:21656](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:21656)。

需要修正的地方：

Step 3 不应轻率要求 foreground probe 阶段直接使用 `contentHash`。当前 probe 使用 `metadataOnly`，实际只读取远端 meta 的 `updatedAt`；见 [S1Plus.js:21516](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:21516)。更稳的做法是先在 follow-up sync 结果之后集中决策，避免同机或 no-op 结果触发用户可见动作。

“thread 页已有 soft prompt”只部分正确。`getAutoPullRefreshPlan()` 支持 thread soft prompt，但 `applyRefreshPolicyForSyncResult()` 只有 `merged_read_progress` 会允许它；普通 `pulled` / `force_pulled` 在线程页仍会 reload；见 [S1Plus.js:10681](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:10681)、[S1Plus.js:10818](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:10818)。

Step 4 应作为验证项而不是最高优先级实现项，因为读取进度的后台误写 guard 已经存在。应先确认是否仍有具体漏网场景，再决定是否补。

## 推荐取舍

从 `auto-check-redesign/` 中保留：问题诊断、`probe -> reconcile -> apply` 的概念分层、`updated_at` 只是 freshness hint、writer attribution 必须参与最终动作、真实浏览器/Tampermonkey 回归矩阵。

从 `auto-check-redesign/` 中舍弃：`SyncCoordinator`、`SyncIntent`、全局 queue/lease/status hub、删除或隐藏 per-load、替换设置模型、一次性大迁移。

从 `sync-auto-check-fix-plan.md` 中保留：增量修复路线、集中纯决策函数、per-load cooldown、same-session/same-device guard、hash-first 语义约束。

从 `sync-auto-check-fix-plan.md` 中修正：probe 阶段不要强行 hash 化；thread soft prompt 现状要改为“仅部分完成”；读取进度后台 guard 先验证再补。

## 最优先事项

最应该先做两件事：第一，把 `sameSessionRemoteWrite` / `sameDeviceRemoteWrite` 纳入自动刷新决策，阻止同机写入导致的 reload 或远端更新提示；第二，给 `per_load` 增加会话级冷却和最近同机写入短路。