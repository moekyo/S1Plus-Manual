# 自动同步统一架构重构计划

## 摘要

- 这次不再重建“自动检查云端更新”这一条孤立链路，而是直接把 `自动拉取`、`自动后台推送`、`多标签页收敛`、`自动同步状态指示器`、`页面刷新策略` 合并成一套统一的自动同步架构。
- 新架构默认走 `保守优先`：宁可晚一点同步，也不允许在单设备、多标签、阅读中、未稳定页面这些场景里误报、误拉取、误刷新。
- 实施方式采用 `分阶段迁移`，但从第一阶段开始就按最终架构设计，不再接受“先补个触发器、后面再补状态”的补丁式路线。

## 接口与用户面变更

- 同步设置区允许大改，旧的三块分散语义收敛成新的统一模型：
  - `自动推送本地改动`：布尔开关，替代当前 `syncAutoEnabled` 的用户面语义。
  - `自动获取云端更新`：枚举 `off | startup | safe_foreground`。
  - `同步状态入口`：布尔开关，控制导航栏统一状态入口是否显示。
- 新 UI 中移除 `每次加载检查` 这一模式，不再恢复旧 `per_load` 语义；它是高噪声来源之一，不进入新架构。
- `每日首次加载时同步` 不再作为单独用户开关存在，而是并入 `自动获取云端更新=startup`。
- `回到前台检查` 与 `可见页轮询` 不再以“补丁式触发器”暴露，而是并入 `safe_foreground` 策略。
- 旧设置字段只用于迁移，不再作为新运行时的主控制面：
  - `syncAutoEnabled -> syncAutoPushEnabled`
  - `syncDailyFirstLoad=true -> syncAutoPullMode=startup`
  - `syncPerLoadCheckEnabled=true` 或 `syncCheckOnReturnToForeground=true -> syncAutoPullMode=safe_foreground`
  - 都未开启则迁移到 `off`
  - `syncShowAutoSyncIndicator -> syncStatusEntryEnabled`
- 手动同步继续保留，且明确为“全局最终处理入口”；任何真实冲突都只允许落到手动同步，不允许自动分支继续猜。

## 架构方案

### 1. 统一成一个自动同步协调器

- 在 `S1Plus.js` 内把现有“多个触发器直接调 `performAutoSync` / 直接写指示器”的方式，改成单一协调器。
- 所有自动行为都先生成 `SyncIntent`，再由协调器统一判定是否执行：
  - `manual_request`
  - `local_dirty`
  - `startup_due`
  - `pending_recovery`
  - `foreground_resume`
  - `visible_poll`
- 协调器只做三件事：
  - 接收 intent
  - 基于当前全局/本地状态决策下一步动作
  - 驱动唯一的同步执行入口与唯一的状态视图模型
- 触发器本身不再直接写导航状态、不再直接弹“远端更新”、不再自己决定 pull / push / retry。

### 2. 明确分层状态，杜绝“局部噪声放大全局”

- 把状态拆成三层，任何逻辑都必须先判断自己属于哪一层：
  - `全局持久化状态`：跨标签共享，包含队列摘要、当前 lease、最近远端观察、最近成功同步、全局 hard pause、熔断状态。
  - `标签页本地状态`：仅当前 tab 有效，包含 visibility/focus、最近用户活动、未保存设置弹窗、阅读进度 pending write / debounce、是否为后台被动打开页。
  - `线程/业务 provenance`：阅读进度、cleanup、最近写入来源、thread/page 边界。
- 导航栏状态入口不再维护一套独立的“可漂移 phase 状态机”；它改为从协调器状态推导 `SyncStatusViewModel`。
- 旧的“一个后台页临时脏、一个线程页 synthetic progress、一个 modal dirty”都只能形成 `tab-local defer/soft block`，不能再直接升级成全局冲突或“远端有更新”提示。

### 3. 把“远端 freshness”从“同步执行”里拆出来

- `updated_at` 只作为 freshness hint，永远不能单独作为“必须提示用户远端有更新”的证据。
- 新架构中的自动获取分两步：
  - `probe`：只做 metadata / freshness 观察，更新最近远端观察状态。
  - `reconcile`：在本地稳定后，才进入真正的 pull / push / merge / conflict 决策。
- 任何 `foreground_resume` / `visible_poll` 在进入 probe 前，必须先执行一次本地状态收敛：
  - 先把 GM 存储中的核心快照同步到当前页内存
  - 再看当前页是否仍有本地 pending write / debounce / dirty modal / 阅读中状态
  - 只有页面处于 `safe to probe` 才允许继续
- `same-session` / `same-device` 远端写入是新架构的一等公民：
  - 保留并强化 `syncDeviceId` 与 `syncMeta.lastWriter`
  - 同设备写入不再走“检测到云端有更新”的吓人文案
  - 同设备且仅是别的标签页推送时，优先归类为“本机其他页面已同步”，并降级提示或静默处理

### 4. 把自动推送与自动拉取放进同一调度模型

- 后台自动推送不再是单独的旁路逻辑，而是协调器中的高优先级 intent：
  - `local_dirty` 先排队
  - 在共享 lease 空闲、全局未 pause、本地数据稳定时执行 push
- 自动获取云端更新不再与后台 push 平行竞争，而是共享同一调度器与同一状态入口。
- 推荐优先级固定为：
  1. `manual_request`
  2. `local_dirty`
  3. `pending_recovery`
  4. `startup_due`
  5. `foreground_resume`
  6. `visible_poll`
- 这样可以保证：本地改动优先保护，本地恢复优先收尾，前台探测只在系统空闲且页面安全时进行。

### 5. 重新定义页面策略，先保护阅读，再考虑刷新

- `thread detail` 页面默认永不“直接因为探测到远端更新而自动刷新”。
- 帖子页的自动获取只允许两种结果：
  - 静默记录“有更新可应用”，等待安全窗口或用户手动处理
  - 在明确只涉及可安全合并内容时，做本地应用但不打断阅读
- `list/generic` 页面可在满足安全条件时自动刷新，但前提仍然是：
  - 没有未保存设置
  - 没有当前运行中的交互式弹窗
  - 没有本地 pending write
- `read_progress only` 分歧继续允许自动 merge，但它在新架构中归类为“业务级 reconcile 结果”，不再被前台探测链路直接放大成“云端更新警报”。

### 6. 把导航栏指示器升级成统一状态入口

- 导航栏不再只是一个轻量状态灯，而是新的自动同步统一入口。
- 它的展示与交互全部基于 `SyncStatusViewModel`，状态收敛为一组稳定枚举：
  - `idle`
  - `queued_push`
  - `probing`
  - `syncing`
  - `applied`
  - `deferred_local_busy`
  - `conflict_manual`
  - `paused_failure`
- 入口文案必须区分四类信息，不能再全压成“检测到云端有更新”：
  - 本机其他标签页刚刚同步
  - 其他设备可能有更新，等待本页稳定后处理
  - 当前页本地仍忙，暂缓自动处理
  - 存在真实冲突，需全局手动同步
- 入口内必须直接提供下一步动作，不再让用户自己猜：
  - `立即处理`
  - `稍后处理`
  - `查看当前原因`
  - `恢复自动同步`
- 旧 `s1p_auto_sync_indicator_state` 不再是独立真相源，最终由协调器状态统一驱动。

## 分阶段实施

### Phase 1：先落统一状态模型与迁移

- 新增 `SyncIntent`、`SyncCoordinatorState`、`SyncTabGuardState`、`SyncStatusViewModel` 这四类内部模型。
- 建立新的设置迁移逻辑和新的用户面枚举；旧字段只参与迁移，不再被运行时直接读取。
- 保留现有锁与 heartbeat 机制，但把它们包装到协调器 lease 层，避免后续继续散落调用。

### Phase 2：重接所有自动触发入口

- `daily_startup`、`background_push`、`pageshow/visibility recovery`、`foreground_resume`、`visible_poll` 全部改成只发 intent。
- 删除剩余“触发器直接写 phase / reason / toast / retry”的链路。
- 明确 `visible_poll` 只属于 `safe_foreground` 模式，且必须带共享 cooldown、tab quiet window、recent activity 条件。

### Phase 3：重做自动获取与页面应用策略

- 实现新的 `probe -> reconcile -> apply` 三段流程。
- 把同设备 / 同 session / 跨设备的 writer 语义统一接入结果分类。
- 重做 thread/list/generic 三类页面的刷新与延后应用策略。
- 重新定义 soft block / hard pause，只保留：
  - `tab-local defer`
  - `global manual-required conflict`
  两级，不再出现旧式多层补偿状态机。

### Phase 4：重做同步设置区与导航栏状态入口

- 用新的三项设置模型替换旧碎片化 UI。
- 导航栏状态入口升级为统一 hub，并把手动同步作为其中明确动作。
- 诊断面板与统一状态入口使用同一套 view model，不再各说各话。

### Phase 5：补齐观测与回归体系

- 诊断数据按新架构重做，重点记录：
  - 最近 intent
  - intent 被拒绝/延后的原因
  - 最近 probe 结论
  - 最近 reconcile 结论
  - 最近 apply 结论
  - 当前 tab guard 状态
  - 当前 global pause / lease / queue 摘要
- 建立多标签、多设备、同设备不同标签的固定回归矩阵，避免以后再回到“复现一次再加一层补丁”。

## 测试与验收

- 设置迁移：
  - 旧 `daily/per_load/foreground/autoEnabled/indicator` 组合全部正确迁移到新模型
  - 新安装默认值为 `auto push = on`、`auto pull = startup`、`status hub = on`
- 单设备多标签：
  - 后台打开多个帖子页但未真正阅读，不得产生可同步本地改动
  - 一个标签页推送阅读进度后，另一个标签页恢复前台不得再出现“远端不可能变化却提示变化”的旧问题
  - 同设备其他标签页导致的远端变化，文案必须降级为“本机其他页面已同步”或静默状态
- 多设备：
  - 设备 A 推送，设备 B 启动页能安全获取
  - 设备 B 长驻列表页在 `safe_foreground` 下能探测到变化，但不误打断
  - 设备 B 帖子页阅读中命中变化时，只允许 defer / soft prompt，不允许直接刷新
- 冲突与保护：
  - 本地 dirty during sync
  - read_progress only merge
  - true dual-side conflict
  - conflict pause / circuit open / lock lost
  - 设置弹窗 dirty、cleanup provenance、bfcache 恢复
- 状态入口：
  - 每个 `SyncStatusViewModel` 状态都能稳定映射到标题、说明、动作按钮
  - 不再存在“引擎状态已变，但指示器还停在旧 phase”的漂移问题
- 回归标准：
  - 不再出现“单设备本地浏览却反复提示远端有更新”的旧问题
  - 不再出现“后台标签页的局部噪声放大全局”的旧问题
  - 手动同步仍是唯一最终裁决入口，且文案明确表示它处理的是全局同步

## 假设与默认

- 远端后端继续使用 GitHub Gist，现有远端数据主体结构不重写；`syncMeta.lastWriter` 与 `syncDeviceId` 继续保留并强化使用。
- 新架构不恢复 `per_load` 模式；它被视为旧补丁时代的高噪声触发源，直接退出新设计。
- 默认值采用保守配置：
  - `自动推送本地改动 = 开`
  - `自动获取云端更新 = startup`
  - `同步状态入口 = 开`
- `safe_foreground` 是高级自动获取模式，不是默认值；它包含 `foreground_resume + visible_poll`，但必须经过共享 cooldown、页面 quiet window、tab guard 检查。
- `sync-across-multiple-tab/` 下旧 phase 文档继续只作为历史参考，不再反向约束新架构必须沿用旧触发和旧状态命名。
