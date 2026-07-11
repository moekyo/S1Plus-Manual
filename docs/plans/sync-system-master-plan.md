# S1 Plus 同步系统 Master Plan

## 当前状态

- 计划状态：Phase 1、Phase 2 与 Phase 3 实现、自动验证和独立审查已完成，真实多窗口点验待执行。
- 总体进度：0/6 个阶段完成。
- 当前阶段：Phase 3，等待真实多窗口点验。
- 代码状态：Phase 3 生命周期 adapter、interface 场景测试和架构文档已完成并通过审查后复验。
- 架构依据：2026-07-11 完成同步锁遗留问题的实机复现、代码定位和架构复核。

## 背景

本次调查确认了后台同步延迟的直接原因。后台同步路径在取得后台模式锁和全局锁后，会依次执行远端同步、共享调度清理、指示器状态计算和结果处理。`handleBackgroundAutoSyncResult()` 包含弹窗、刷新、提示和重试调度，并且可能等待异步操作，但锁要等它全部结束后才在 `finally` 中释放。

实机复现中，原标签页已经成功写入远端，随后在结果处理完成前关闭。该页面的 JavaScript 上下文消失，释放后台模式锁和全局锁的 `finally` 没有执行。剩余页面在锁的 45 秒 TTL 内只能持续延后共享调度；如果剩余页面同时被浏览器隐藏或冻结，timer 和恢复逻辑还可能暂停，直到页面重新回到前台。

这不是单纯的冷却时间问题。当前实现把 Running Sync 的事务、Sync Lock 和 Result Phase 处理放在同一段生命周期内，导致已经完成的远端事务继续占用执行锁。

## 目标

本计划有两个目标：先修复已确认的遗留锁问题，再把现有同步能力逐步收敛成一个对外 interface 小、内部 implementation 深的同步系统。

完成后的系统应满足以下条件：

- Running Sync 完整拥有 Sync Lock 的获取、续租、失锁处理、事务收尾和释放顺序。
- Pending Dirty、Scheduler Owner、页面生命周期和状态显示各自形成有明确 seam 的 deep module。
- 页面调用者只表达本地变化、生命周期变化、同步请求和状态读取，不直接操作锁、timer、generation 或 owner lease。
- 测试通过 module 的 interface 验证行为，不再依赖大量内部测试 hook 或源码正则。
- 每个阶段都能独立合并、验证和回滚，后续阶段未完成时，已完成阶段仍然可用。

## 约束

- 所有运行时代码继续保留在 `S1Plus.js`，不引入构建步骤、打包器或新的运行时文件。
- Running Sync 不能跨标签页转移。页面在未确认事务结果时关闭，其他页面必须等待 Sync Lock 按 TTL 失效后再从新快照恢复。
- `pagehide` 和 `beforeunload` 不得无条件删除执行锁。该行为会造成结果不确定的远端写入与新同步并发。
- `performAutoSync()` 继续作为同步事务的 deep implementation。它已经集中处理版本决策、冲突、基线、阅读进度合并、写入结果复查和同步期间本地变化，不进行机械拆分。
- 手动拉取和推送保留主动抢占语义。首轮不把手动抢占并入自动同步执行路径。
- 普通 userscript 没有独立后台进程。如果所有 S1 Plus 页面都被浏览器冻结，系统不能承诺 timer 按时运行；系统要保证状态可恢复，并在任一页面恢复运行时立即接管。
- 首轮不修改远端同步数据协议、用户设置格式或 Gist 文件结构。

## 目标结构

```text
页面事件 / 本地变化 / 手动操作
               │
        同步系统 façade
               │
    ┌──────────┼───────────┐
    │          │           │
Pending Dirty  Running Sync  Result Phase
Scheduler      │             Policy
               │
        Sync Transaction
       （现有 performAutoSync）
               │
      Sync Lock / Gist / GM adapter
               │
       Sync Status Projection
          ┌────┴────┐
        Navbar   Title Owner
```

同步系统 façade 在最后一个阶段建立。前面的阶段先让内部 module 形成足够的 depth，避免 façade 只是把现有全局状态和几十个测试 hook 包装成更大的 shallow interface。

## 架构决定

### Running Sync 完整拥有 Sync Lock

Running Sync 的 implementation 负责模式锁、全局锁、心跳、远端事务、事务内持久化收尾和锁释放。Result Phase 的刷新、提示、弹窗和重试调度只能在锁释放后执行。

### 事务收尾与结果处理分开

以下行为属于事务收尾，需要在锁内完成：

- 保存同步基线和最后同步时间。
- 保存成功的远端 writer 信息。
- 清理本轮已经覆盖的 Pending Dirty 和 shared generation。
- 保留同步期间产生的更新 dirty，并安排后续同步。

以下行为属于 Result Phase 处理，需要在锁外完成：

- 导航栏和标题状态更新。
- 页面刷新策略。
- 成功、失败和冲突提示。
- 冲突弹窗。
- 失败重试调度。

### 只在真实 seam 使用 adapter

模式锁已经存在后台、启动、前台补同步和手动四种 implementation，因此模式差异是一个真实 seam。GM 存储与测试内存存储、Gist 请求与测试替身也分别构成生产和测试 adapter。没有第二种 implementation 的位置不新增空壳 adapter。

### interface 是测试面

新测试优先通过 deep module 的 interface 验证可观察结果。旧测试如果只验证内部函数调用顺序或源码 wiring，应在对应 module 的行为测试稳定后删除，避免新旧两套测试长期叠加。

## 报告候选与实施阶段映射

| 实施阶段 | 架构报告候选 | 推荐强度 | 处理方式 |
|---------|-------------|---------|---------|
| Phase 1 | 01：Running Sync 与 Sync Lock | Strong | 必做，直接修复本次问题 |
| Phase 2 | 02：Pending Dirty 与 Scheduler Owner | Strong | 必做，收敛调度和恢复 |
| Phase 3 | 03：浏览器生命周期 adapter | Worth exploring | 实施，集中事件顺序 |
| Phase 4 | 04：Sync Indicator State 投影 | Worth exploring | 实施，统一 Navbar 与 Title Owner 的状态事实 |
| Phase 5 | 05：Result Phase Policy | Speculative | 通过进入门槛后实施，否则明确跳过 |
| Phase 6 | 报告外新增：同步系统 façade | 最终收口 | 在内部 module 具备 depth 后建立 |

## Phase 1：深化 Running Sync

- 状态：实现、自动验证和独立审查已完成；真实多窗口点验待执行。
- 目标：让后台、启动和前台补同步复用同一套 Running Sync 生命周期，修复事务完成后仍持锁的问题。
- 实施范围：
  - 收敛四组模式锁中重复的读取、获取、验证、续租、停止心跳和释放逻辑。
  - 让后台、启动和前台补同步通过同一个 Running Sync module 执行。
  - 保留 `performAutoSync()` 作为事务 implementation。
  - 把 `cleanupBackgroundSchedulerAfterSuccess()` 保留在事务收尾内。
  - 把指示器聚合和 `handleBackgroundAutoSyncResult()` 移到锁释放之后。
- 暂不处理：
  - 不重写 Pending Dirty Scheduler。
  - 不调整 Sync Indicator State 投影。
  - 不迁移手动同步抢占流程。
- 验收：
  - 远端推送成功后，即使结果处理一直不返回，后台模式锁和全局锁也已经释放。
  - 页面在远端事务尚未 settle 时关闭，锁继续保留到 TTL，其他页面不会并发写入。
  - Result Phase 处理抛出异常时，不会重新占用或延长执行锁。
  - 启动和前台补同步的现有锁 TTL、失锁和指示器行为不变。
- 主要文件：`S1Plus.js`、`tests/test-safe-sync-execution.js`、`tests/test-background-sync-shared-debounce.js`、`DEVELOPMENT.md`、`docs/agents/repository-guide.md`。

### Phase 1 进度更新

- 已完成：
  - 新增 `runRunningSync()`，统一后台、启动和前台补同步的锁、心跳、完整事务、释放锁和 Result Phase 顺序；该 interface 不接受独立 finalizer，事务收尾必须在 `runTransaction` resolve 前完成。
  - 新增 mode profile，让手动、后台、启动和前台补同步共用模式锁读取、获取、续租和释放 implementation。
  - 新增生产路径 `runBackgroundAutoSyncIteration()` seam，将后台 scheduler cleanup 保留在同步事务内，将指示器聚合和 `handleBackgroundAutoSyncResult()` 移到锁释放后。
  - 保留手动同步的主动抢占流程，只复用模式锁 implementation。
  - 新增 Running Sync interface 场景测试，覆盖完整事务收尾、Result Phase 失败、心跳启动失败释放和四种模式 TTL。
  - 新增真实 GM 后台模式锁与全局锁回归：生产后台迭代进入永久等待的 Result Phase 后，两把锁均已释放，且 scheduler cleanup 已在锁内完成。
- 独立审查：
  - 使用一个 subagent 同时按仓库规范与 Phase 1 spec 审查，发现 2 个 P2，均已修正。
  - 移除“先调用再拒绝”的异步 finalizer 设计，避免异步 continuation 在锁释放后继续修改事务状态。
  - 用生产后台迭代 seam 和真实持久化锁替代只依赖 fake lock adapter 的关键回归，并加入可长期 pending 的 Result Phase gate。
  - consolidated review 的后续问题已修正：`afterRelease` 和停止心跳失败改为记录警告并继续释放锁/处理既有结果，drain loop 变量遮蔽已消除。
  - 补齐模式锁过期重取、其他模式锁阻塞、ownership verification 失败回滚，以及锁获取/lock-unavailable callback 异常传播的边界测试。
  - 修复后按 Standards/Spec 两轴复审：0 个硬性规范问题，0 个 spec findings；仅修正文档中普通锁竞争与锁获取异常的措辞区分。
- 自动验证：
  - `node --check S1Plus.js` 通过。
  - 16 个 sync / foreground / startup / remote 相关测试文件全部通过。
  - `git diff --check` 通过。
- 尚未完成：
  - 真实多窗口手动点验，本轮自动实现环境尚未执行。
- 下一步：按本文件的多窗口步骤完成 Phase 1 人工验收；通过后将 Phase 1 标为已完成，再进入 Phase 2。

## Phase 2：深化 Pending Dirty Scheduler

- 状态：实现、自动验证和独立审查已完成；真实多窗口点验待执行。
- 目标：集中 Pending Dirty、shared generation、Scheduler Owner、lease、retry 和 covered cleanup。
- 实施范围：
  - 让 dirty 合并、owner 获取与续租、due timer、冻结恢复和成功清理归属同一个 module。
  - 将 GM 存储、时钟和 timer 作为内部 adapter，测试使用内存 adapter。
  - 保留更新 generation 和更新 dirty，避免旧同步清除新变化。
  - 统一 shared scheduler 重试与本地 retry fallback 的选择。
- 暂不处理：
  - 不改变远端同步决策。
  - 不改变浏览器生命周期事件的绑定位置。
- 验收：
  - 场景测试只需表达 queued、retained、covered、handoff 和 recovered，不再逐个调用 owner、timer 和 coverage helper。
  - Scheduler Owner 关闭或 lease 过期后，其他可运行页面能够接管。
  - 同步期间产生的新 dirty 保留并触发后续同步。
  - Sync Lock 有效时，Scheduler 不会启动并发 Running Sync。
- 主要文件：`S1Plus.js`、`tests/test-background-sync-shared-debounce.js`、`DEVELOPMENT.md`、`docs/agents/repository-guide.md`。

### Phase 2 进度更新

- 已完成：
  - 建立 `pendingDirtyScheduler` deep module，通过 `createPendingDirtyScheduler()` 在构造时绑定 clock/tab/settings/timer adapter，以语义操作取代页面调用者与测试对 owner、lease、timer、generation、coverage helper 的直接协调。
  - 将本地 dirty 入口、pending recovery、初始化恢复、生命周期 hidden/visible/handoff、Running Sync covered cleanup 和后台 retry 切到统一 interface。
  - 保留 generation 与 maxLastModified 的覆盖边界；旧同步只清理已覆盖 dirty，新 generation/更新 dirty 保留并只排一个短 follow-up。
  - 将 shared scheduler 与本地 retry fallback 的选择收进 module；共享状态连续写入竞争失败时返回 `scheduler_state_write_lost`，再明确选择本地 fallback，不再误报 shared scheduled。
  - 删除 20 余个 scheduler implementation 测试 hook；将原有逐 helper 测试替换为 queued、retained、covered、handoff、recovered、active Sync Lock、write race、hidden flush 和 lifecycle checkpoint 场景测试。
  - 生产继续使用 GM storage/真实 clock/timer，测试通过同一 factory 一次性绑定 harness 的内存 GM adapter 与可控 clock/timer adapter；测试不再直接 seed owner/lease/generation 或手动执行 recovery callback。
- 独立审查：
  - 按用户要求启用一个 subagent 联合检查 Standards 与 Phase 2 spec，发现 2 个 P2，均已修正。
  - covered cleanup 增加删除前 identity 复核与删除后 `last_modified` 恢复，覆盖 pending/shared 两种 read-delete 竞争，避免新 dirty 被旧同步删除。
  - 将浅层 `resume(context.phase/pending)` dispatcher 改为构造时绑定 adapter 的语义 interface，并再次替换测试，使 queued、retained、covered、handoff、recovered 和 Sync Lock 场景不再协调内部状态字段。
  - 针对 commit `cb587c8` 的综合复审继续收紧 interface：`handoff()` 直接委托返回语义结果，`scheduleFallback` 改为构造期必需 adapter，并删除静默的 `strategy: "none"` 分支。
  - 并发删除恢复复用与最新 `last_modified` 精确匹配的本地 dirty provenance，保留 `read_progress` 来源和 threadId，避免恢复后退化为普通数据的 5 秒策略。
  - 补齐 blocked retry、缺失 fallback adapter 与 read-progress 并发恢复测试；内部 hooks 不回填，继续以 `inspect()` interface 与 SyncTrace 作为测试快照和生产诊断面。
  - 修复后按 Standards/Spec 两轴独立复审：Spec 0 findings；Standards 的新增函数 `s1p` 前缀问题已修正并复审关闭，最终 0 个未解决 findings。
- 自动验证：
  - `node --check S1Plus.js` 通过。
  - 16 个 sync / foreground / startup / remote 相关测试文件全部通过。
  - `git diff --check` 通过。
- 尚未完成：
  - Phase 1/Phase 2 真实多窗口手动点验，本轮自动实现环境尚未执行。
- 下一步：按本文件的多窗口步骤完成 Phase 1/Phase 2 人工验收；通过后依次标记阶段完成，再进入 Phase 3。

## Phase 3：收拢浏览器生命周期 adapter

- 状态：实现、自动验证和独立审查已完成；真实多窗口点验待执行。
- 目标：集中 `visibilitychange`、`pageshow`、`pagehide` 和 `beforeunload` 的同步处理顺序。
- 实施范围：
  - 合并 pending recovery 和 shared scheduler 的重复事件绑定。
  - 固定本地变化 finalize、Pending Dirty 重读、Scheduler Owner handoff 和前台恢复的顺序。
  - 继续复用现有 sync lifecycle checkpoint，不复制其 implementation。
- 暂不处理：
  - 不在卸载事件中删除未 settle 的 Running Sync Lock。
  - 不保证所有页面被冻结时仍能执行 timer。
- 验收：
  - 每个浏览器生命周期事件只有一个同步入口。
  - hidden、visible、pagehide、beforeunload 和 pageshow 均有确定的场景测试。
  - pagehide 只 finalize Pending Dirty 并转移 Scheduler Owner，不接管 Running Sync。
- 主要文件：`S1Plus.js`、`tests/test-background-sync-shared-debounce.js`、`tests/test-foreground-trigger-integration.js`、`DEVELOPMENT.md`。

### Phase 3 进度更新

- 已完成：
  - 新增 `s1pSyncLifecycleAdapter` deep module，以 `bind()` / `unbind()` / `handle()` interface 统一 hidden、visible、pageshow、pagehide 和 beforeunload；重复调用 bind/unbind 保持幂等，并可完整释放 DOM、GM listener、activity hooks 与 polling 资源。
  - 合并 shared scheduler 与 pending recovery 的两套 `pageshow` / `visibilitychange` 监听；shared state change listener 和前台 polling support 由同一次 adapter 绑定初始化。
  - 固定 phase 顺序：先运行本地 mutation finalizer 与 sync lifecycle checkpoint，再执行 Scheduler flush/recover/handoff；visible/pageshow 最后执行存储快照重读、Pending Dirty recovery、remote probe 和 polling 更新。
  - 删除 checkpoint 之外的第二次卸载 handoff；pagehide/beforeunload 只 finalize Pending Dirty 并转移 Scheduler Owner，不接管 Running Sync 或删除执行锁。
  - 将阅读进度 hidden/visible/pageshow/pagehide/beforeunload 处理收进已注册 finalizer，移除其独立生命周期 DOM 监听，避免同一变化重复 flush。
  - 测试改从生命周期 adapter interface 覆盖单次绑定、五种 phase 顺序、前台恢复，以及 pagehide finalize + owner handoff 且不触发同步。
- 独立审查：
  - 按用户要求启用一个 subagent 联合检查 Standards 与 Phase 3 spec，共确认 3 个 P2，均已修正并复审关闭，最终 0 findings。
  - 卸载 handoff 增加 generation fence，阻止当前页的本地 GM change listener 对刚写出的空 owner 状态立即重新接管。
  - `bind()` 只在初始化与事件注册全部成功后提交 bound 状态；初始化失败可重试，并复用稳定 handler 引用避免重复 DOM 注册。
  - `beforeunload` 被取消时，通过下一轮 macrotask 判断页面仍存活且可见后恢复 Scheduler Owner；真正离页时任务随页面上下文销毁，不接管 Running Sync。
  - 针对 commit `23c36db` 的三方综合复审后续问题已修复：共享 GM/activity listener 改为 lease 管理，避免重复注册或提前移除；生命周期 transition generation 会使 bfcache/pageshow/unbind 之后的旧微任务与恢复任务失效。
  - 补齐默认 `queueMicrotask`/Promise fallback、post-unload 可见性与 transition 门禁、handoff generation fence 隔离、前台 support 初始化/释放隔离，以及 bind/unbind/rebind 场景测试。
- 自动验证：
  - `node --check S1Plus.js` 通过。
  - 16 个 sync / foreground / startup / remote 相关测试文件全部通过。
  - `git diff --check` 通过。
- 尚未完成：
  - Phase 1/Phase 2/Phase 3 真实多窗口手动点验。
- 下一步：按本文件多窗口步骤做 Phase 1/Phase 2/Phase 3 联合人工验收，追加取消离页与确认离页场景；通过后再进入 Phase 4。

## Phase 4：深化 Sync Indicator State 投影

- 状态：未开始。
- 目标：集中 Pending Dirty、Sync Lock、Live Runner、Result Phase 和 TTL 到展示状态的投影规则。
- 实施范围：
  - 让 Navbar 与 Title Owner 使用同一份状态事实。
  - 保留 ADR-0001 的要求，标题 Running Phase 必须验证 Live Runner。
  - 集中 pending、running、result、conflict 和 idle 的优先级。
  - 保留 Navbar 对外来后台锁的现有展示差异，不把标题规则错误复用到 Navbar。
- 暂不处理：
  - 不改视觉样式和动画设计。
  - 不改变 Result Phase 的 TTL 数值。
- 验收：
  - Navbar 和 Title Owner 不再分别解释同一锁和 pending 状态。
  - 外来新鲜 Sync Lock 不能让标题显示 Ghost Running。
  - Result Phase 仍可通过 Title Owner handoff，Running Sync 仍不可转移。
  - 删除依赖内部状态拼接和源码正则的重复测试。
- 主要文件：`S1Plus.js`、`tests/test-auto-sync-indicator-linkage.js`、`tests/test-title-sync-status.js`、`DEVELOPMENT.md`、`CONTEXT.md`。

## Phase 5：有条件地深化 Result Phase Policy

- 状态：未开始，进入门槛尚未验证。
- 目标：确认后台、启动、每次加载和前台补同步是否共享足够多的结果策略；只有能形成真实 depth 时才收拢。
- 进入门槛：
  - 至少两个调用路径共享相同的刷新、提示或重试规则。
  - 删除候选 module 后，复杂度会重新分散到多个调用点，能够通过 deletion test。
  - 新的行为测试可以替换现有源码 wiring 正则，而不是在旧 helper 外再增加一层转发。
- 通过门槛后的实施范围：
  - 集中 Result Phase 到刷新、提示、冲突暂停和重试意图的决策。
  - 保证该 module 的所有行为位于 Running Sync 释放锁之后。
  - 保留各入口确实不同的产品文案和刷新 adapter。
- 未通过门槛时：
  - 将 Phase 5 标为“已评估，跳过”。
  - 保留现有 refresh policy helper，不为了结构对称强行合并。
  - 直接进入 Phase 6。
- 验收：
  - 通过门槛时，调用者只消费结果策略，不重复维护状态 switch。
  - 未通过门槛时，文档记录跳过原因，运行行为和测试保持不变。
- 主要文件：`S1Plus.js`、`tests/test-post-sync-refresh-policy.js`，通过门槛后再确定其他受影响测试。

## Phase 6：建立同步系统 façade

- 状态：未开始。
- 目标：在内部 module 已经具备 depth 后，为页面调用者建立最终同步入口。
- 实施范围：
  - 页面代码只表达本地变化、生命周期变化、同步请求和状态读取。
  - Running Sync、Pending Dirty Scheduler、生命周期 adapter、状态投影和通过门槛的 Result Phase Policy 保持内部实现细节。
  - 清理调用者对锁、timer、generation、owner lease 和指示器内部状态的直接访问。
  - 清理已经被 module interface 场景测试替代的全局 test hooks。
- 暂不处理：
  - 不为了 façade 引入 class、事件总线或新的配置系统。
  - 不改变用户可见同步设置和远端数据协议。
- 验收：
  - 页面调用点不再直接协调 Sync Lock 和调度顺序。
  - 新增同步触发来源时，不需要修改多个执行入口。
  - 系统级测试可以从同步意图运行到最终状态，不穿透内部 implementation。
  - 删除 façade 后，复杂度会重新分散到多个调用点，证明该 module 具有真实 depth。
- 主要文件：`S1Plus.js`、同步相关测试、`DEVELOPMENT.md`、`docs/agents/repository-guide.md`、`CONTEXT.md`。

## 跨阶段回归矩阵

| 场景 | 必须保持的行为 |
|------|---------------|
| 推送成功后结果处理卡住 | Sync Lock 已释放，其他页面不等待无意义 TTL |
| 页面在网络事务中关闭 | 锁保留到 TTL，恢复时重新读取云端快照 |
| PATCH 结果不确定 | 完整回读云端；hash 相同则按成功收尾 |
| 同步期间产生新 dirty | 旧覆盖范围清理，新 dirty 保留并补发 |
| Scheduler Owner 关闭 | 其他页面在 lease 失效后接管 |
| 所有页面隐藏或冻结 | 不承诺后台准时执行；恢复后从持久化状态接管 |
| Result Phase 处理失败 | 不重新持有执行锁，pending 和 retry 仍可恢复 |
| 前台补同步遇到局部 dirty | 保持 soft block，不升级为错误的全局冲突 |
| 手动拉取或推送 | 保持主动抢占、取消旧请求和重新读取快照 |
| 标题 Running Phase | 只有 Live Runner 可以显示，外来 Sync Lock 不足以证明 Running Sync |
| Result Phase 标题 handoff | Result Phase 可转移，Running Sync 不可转移 |

## 验证

每个涉及同步执行或锁的阶段至少运行：

```bash
node --check S1Plus.js
node tests/test-safe-sync-execution.js
node tests/test-background-sync-shared-debounce.js
node tests/test-foreground-trigger-integration.js
node tests/test-foreground-remote-probe.js
node tests/test-auto-sync-indicator-linkage.js
```

涉及标题投影时追加：

```bash
node tests/test-title-sync-status.js
```

涉及 Result Phase Policy 时追加：

```bash
node tests/test-post-sync-refresh-policy.js
```

每个阶段还要运行：

```bash
git diff --check
```

Phase 1、Phase 2 和 Phase 3 完成后需要做真实多窗口点验：

1. 在多个标签页产生阅读进度变化。
2. 让一个标签页成为 Running Sync。
3. 分别在事务中和事务 settle 后关闭该标签页。
4. 将剩余窗口保持在后台至少 90 秒。
5. 检查 Sync Lock、Scheduler Owner、Pending Dirty、远端 writer 和导航栏状态。
6. 回到前台后确认没有重复推送、Ghost Running 或丢失 dirty。

## 数据兼容与回滚

- Phase 1 到 Phase 4 默认不修改持久化数据 schema。
- 如果 Sync Lock 增加诊断字段，旧字段继续兼容，读取端必须允许字段缺失。
- 每个阶段单独提交，回滚时只需要回退该阶段代码和对应测试、文档。
- 不通过数据迁移删除旧状态。过期锁、pending 和 owner lease 继续依赖既有 TTL 与归一化逻辑恢复。
- 如果某阶段无法保持现有行为，停止进入下一阶段，先回退该阶段并记录失败场景。

## 预计修改范围

完整路线累计会涉及超过 8 个代码、测试和文档文件，但单个阶段应控制在 3 到 5 个主要文件。计划不新增后台进程、远端服务、第三方账号或凭据。

## 阶段进度更新规则

本文件是六阶段工作的状态源。每个阶段完成后，在进入下一阶段前更新以下内容：

- 将阶段状态改为“已完成”“部分完成”“已评估，跳过”或“受阻”。
- 写明完成的代码、测试和文档。
- 记录实际运行的验证命令和结果。
- 保留尚未完成的内容、限制和风险。
- 更新总体进度和当前阶段。
- 写明下一阶段的具体入口。

阶段只有在目标产物存在且验证完成后才能标记为已完成。未运行的验证必须写明原因，不能把计划、实现和验证混写成同一种完成状态。

## 批准门槛

本计划获批后从 Phase 1 开始。每个阶段完成实现、测试、文档更新和独立审查后，再进入下一阶段。Phase 5 仍受进入门槛约束；Phase 6 不要求 Phase 5 必须实施，但要求 Phase 5 已经完成评估并记录结论。
