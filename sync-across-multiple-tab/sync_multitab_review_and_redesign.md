# S1 Plus 同步问题综述与多标签页重构方案

## 1. 现在怎么读这套文档

这份根文档现在只做一件事：当作轻量入口。

后续如果要让 AI 或自己只处理某一个阶段，不需要再把整份“大而全”文档一次性全部塞进上下文。默认按下面的最小读取集来用：

1. 做某个阶段：
   - 先读本文件
   - 再读对应的 phase 文档
2. 追某个现象到底落在哪个阶段：
   - 先读本文件
   - 再读 [coverage_matrix.md](./sync_multitab_redesign/coverage_matrix.md)
3. 需要完整问题背景：
   - 再补读 [problem_catalog.md](./sync_multitab_redesign/problem_catalog.md)
4. 需要跨阶段的通用设计原则：
   - 再补读 [architecture_principles.md](./sync_multitab_redesign/architecture_principles.md)
5. 只有在需要回看原始讨论措辞或追溯讨论过程时：
   - 再读 [discussion.md](./discussion.md)

核心原则是：

- 默认只读“入口 + 当前 phase”
- 只有真的遇到跨阶段依赖或语义不清时，才回看参考总表
- 不再默认把所有问题、所有方案、所有阶段一次性塞进上下文

## 2. 为什么要拆分

之前的单文件版本把这些内容全叠在一起：

- 现象记录
- 问题清单
- 已做局部修复
- 为什么局部修复不够
- 完整设计原则
- 多标签页专项要求
- 分阶段实施路线图

这样做的好处是信息全，但缺点也很明显：

- 后续做 `Phase 3` 时，也会被迫读入 `Phase 6/7` 的大量上下文
- AI 很容易把“参考信息”当成“当前必须处理的信息”
- 多标签页、cleanup、启动期、文案、诊断这些层次混在一起，单次执行容易跑偏

这次拆分的目标不是减少信息，而是把信息按用途分层：

- 入口文档：告诉你该读什么
- 参考文档：完整保留背景与通用设计
- 阶段文档：尽量自包含，只保留当前阶段真正需要的上下文

## 3. 文档地图

### 3.1 参考文档

- [problem_catalog.md](./sync_multitab_redesign/problem_catalog.md)
  - 完整问题清单、讨论中出现过的现象、已做局部修复、为什么补丁还不够
- [architecture_principles.md](./sync_multitab_redesign/architecture_principles.md)
  - 通用设计目标、触发源模型、前台 follow-up 模型、soft block / hard pause、cleanup provenance、多标签页专项要求
- [coverage_matrix.md](./sync_multitab_redesign/coverage_matrix.md)
  - 问题 ID 和阶段的对应关系
  - 常见现象该去读哪些 phase
- [background-open-unexpected-remote-update-investigation.md](./background-open-unexpected-remote-update-investigation.md)
  - 当前“后台开帖后误报云端更新”这条低频问题的专题调查记录、已排除项、诊断字段解释和下次复现场景的取证步骤
- [same-device-unexpected-remote-update-findings-and-fix-plan.md](./same-device-unexpected-remote-update-findings-and-fix-plan.md)
  - 本轮关于“同机远端更新提示”的完整收口文档，汇总根因分层、修复优先级与后续验收计划

### 3.2 分阶段文档

- [Phase 1: 启动期与触发源语义收口](./sync_multitab_redesign/phases/phase_1_startup_and_trigger_model.md)
- [Phase 2: 阅读进度写入链路去噪](./sync_multitab_redesign/phases/phase_2_read_progress_denoising.md)
- [Phase 3: 同步状态模型分层](./sync_multitab_redesign/phases/phase_3_sync_state_layering.md)
- [Phase 4: 前台探测与可见页轮询重构](./sync_multitab_redesign/phases/phase_4_foreground_probe_and_visible_poll.md)
- [Phase 5: cleanup provenance 与手动同步分支重构](./sync_multitab_redesign/phases/phase_5_cleanup_provenance_and_manual_sync.md)
- [Phase 6: 用户交互与提示语义重构](./sync_multitab_redesign/phases/phase_6_interaction_and_copy.md)
- [Phase 7: 诊断、观测与多标签回归体系](./sync_multitab_redesign/phases/phase_7_diagnostics_and_regression.md)

## 4. 阶段速览

1. `Phase 1`
   - 把启动期、每日首次同步、触发源语义收拢到统一模型里
2. `Phase 2`
   - 切断“后台标签页或初始化观察器制造假本地改动”的根因
3. `Phase 3`
   - 把“当前标签页局部状态”和“全局同步状态”拆开
4. `Phase 4`
   - 把前台探测和 4 分钟 visible poll 改成低打扰、会等待本地稳定的探测层
5. `Phase 5`
   - 把 cleanup 从“全局模糊计数”改成“有来源、有线程、有可验证前后关系”的结构化状态
6. `Phase 6`
   - 让导航栏提示、toast、手动同步入口的语义与真实作用域对齐
7. `Phase 7`
   - 建立足够清晰的诊断字段和多标签页回归基线

## 5. 推荐读取路径

### 5.1 如果现在要开始做某个阶段

建议只读：

1. 本文件
2. 对应 `phase_xxx.md`

只有在以下情况再补读参考文档：

- 需要确认这个阶段覆盖哪些问题 ID：读 [coverage_matrix.md](./sync_multitab_redesign/coverage_matrix.md)
- 需要看该问题最初的完整现象和风险：读 [problem_catalog.md](./sync_multitab_redesign/problem_catalog.md)
- 需要看跨阶段通用原则：读 [architecture_principles.md](./sync_multitab_redesign/architecture_principles.md)

### 5.2 如果现在是在排查一个现象

建议顺序：

1. 先读本文件
2. 再读 [coverage_matrix.md](./sync_multitab_redesign/coverage_matrix.md) 里的“按现象反查”部分
3. 只进入命中的 phase 文档
4. 只有仍然不清楚时，再回看 [problem_catalog.md](./sync_multitab_redesign/problem_catalog.md)

### 5.3 如果现在要评审整个重构方向

建议顺序：

1. 本文件
2. [problem_catalog.md](./sync_multitab_redesign/problem_catalog.md)
3. [architecture_principles.md](./sync_multitab_redesign/architecture_principles.md)
4. [coverage_matrix.md](./sync_multitab_redesign/coverage_matrix.md)

## 6. 使用约定

为了减少上下文污染，后续建议固定遵守下面这几条：

1. 不再默认把 [discussion.md](./discussion.md) 放进实现阶段的上下文。
2. 不再默认把完整问题总表和完整架构原则一起放进每一次实现阶段。
3. phase 文档里已经写过的内容，不重复去大段拷贝参考文档。
4. 只有在出现跨阶段边界问题时，才补读：
   - [problem_catalog.md](./sync_multitab_redesign/problem_catalog.md)
   - [architecture_principles.md](./sync_multitab_redesign/architecture_principles.md)
   - [coverage_matrix.md](./sync_multitab_redesign/coverage_matrix.md)

## 7. 当前结论

这套拆分后的阅读策略，仍然完整覆盖我们之前讨论过的所有问题和方案，但把“默认上下文”收窄到了更适合执行的粒度。

之后如果要推进实现，最推荐的默认输入就是：

- 本文件
- 当前 phase 文档

而不是重新把整个重构总文档一次性喂进去。

## 8. 实施进度

- 当前 phase：`Phase 7`
- 总体进度：`7 / 7 phases completed`
- Phase 1：`Completed`
- Phase 2：`Completed`
- Phase 3：`Completed`
- Phase 4：`Completed`
- Phase 5：`Completed`
- Phase 6：`Completed`
- Phase 7：`Completed`

### 8.1 Phase 1 本轮落地内容

- 在 `S1Plus.js` 中补齐并统一了启动期相关触发源命名：
  - `daily_startup`
  - `per_load`
  - `page_load_visible`
  - `foreground_resume`
  - `visible_poll`
  - `background_push`
  - `manual_sync`
- 把启动期分支收口成显式的 startup orchestrator 决策：
  - fresh 时运行完整 startup flow
  - stale 时只允许顺延或补执行 `daily_startup`
  - stale 时不再补跑 `per_load` / `page_load_visible`
- `s1p_deferred_startup_sync` 现在持久化：
  - `date`
  - `createdAt`
  - `reason`
  - `scheduledBy`
- 导航栏自动同步指示器现在会按真实来源显示启动期相关状态，不再把前台 follow-up / 可见页轮询都折叠成模糊来源。

### 8.2 Phase 1 当前结论

- `Phase 1` 代码实现已完成，并已做语法校验。
- 浏览器内 Tampermonkey 多标签手测仍需在真实环境补跑，但不影响进入 `Phase 2` 的代码阶段。

### 8.3 Phase 2 本轮落地内容

- 在 `S1Plus.js` 中为帖子页阅读进度新增显式运行时状态：
  - `observer_initialized`
  - `candidate_pending`
  - `reading_confirmed`
- 阅读进度现在只会在“真实阅读成立”后进入写入链路：
  - 页面处于前台并稳定停留一个短窗口
  - 或用户产生滚轮 / 触摸 / 键盘翻页类交互
  - 且已经拿到真实可见楼层记录
- 后台打开的新帖子页默认保持被动：
  - 隐藏页不再安排阅读进度保存
  - 回到前台后才重新进入确认窗口
- 列表页后台开帖现在会写入短寿命 opener hint：
  - 线程页若消费到匹配 hint，会把本次阅读会话标记为 `passiveBackgroundOpened`
  - 命中该标记的会话，必须在稳定前台后满足“明确交互”或“当前页真正拿到焦点”，才允许完成首次阅读确认
- 阅读进度候选记录不再在“没有真实可见楼层”时回退成主楼 synthetic progress。
- 新写入的阅读进度记录现在带有 provenance：
  - `sourceTabId`
  - `threadId`
  - `page`
  - `saveReason`
  - `documentVisibilityState`
  - `hadConfirmedVisiblePost`
  - `createdAt`
  - `initiatedWhileHidden`
- 已暴露后续 probe / visible poll 可直接读取的本地信号：
  - `getReadProgressProbeGuardState()`
  - 阅读进度本地 pending save / pending persist 状态
  - 阅读进度同步防抖窗口状态

### 8.4 Phase 2 当前结论

- `Phase 2` 代码实现已完成，并已通过语法校验。
- 当前环境仍无法直接完成 Tampermonkey 浏览器内多标签手测，需在真实论坛页面补跑：
  - 后台打开多个帖子页不应平白产生 `read_progress`
  - 后台打开后长时间挂起、首次真正激活时仍不应仅靠 `visible_stable` 提前确认阅读
  - 前台稳定阅读后应能正常保存进度，包括短帖 / 无滚动但当前页真正拿到焦点的场景
  - 切后台或关闭页面时，仅应提交已确认阅读会话中的待写入记录

### 8.5 Phase 3 本轮落地内容

- 在 `S1Plus.js` 中把前台 follow-up 从 startup 模式里拆出，新增独立的 `foreground_followup` 执行模式，不再复用 `skipped_push_on_startup` 语义。
- 同步决策现在按执行模式分流本地较新场景：
  - `startup` 仍返回 `skip_push_on_startup`
  - `background` 仍允许 `push`
  - `foreground_followup` 改为 `skip_push_on_foreground_followup`
- 前台 follow-up 新增仅当前标签页运行时可见的 `soft block` 状态：
  - 默认只影响当前标签页
  - 命中帖子页阅读进度 pending / debounce / 最近持久化上下文时，会附带 `threadId` / `page` 边界
  - 不再写全局 `s1p_auto_sync_conflict_pause`
- 全局 `hard pause` 继续只保留给真正冲突或启动期明确需要人工决策的场景：
  - `setAutoSyncConflictPause()` / `clearAutoSyncConflictPause()` 会主动清理前台局部 soft block，避免局部状态和全局暂停叙事叠加
- 前台探测诊断现在能区分 soft block：
  - `lastProbeTriggeredSyncResult` 会记录为 `blocked:soft:<reason>`
  - 前台局部脏状态不再被默认升级成高打扰提示

### 8.6 Phase 3 当前结论

- `Phase 3` 代码实现已完成，并已通过语法检查与相关脚本测试。
- 当前环境仍无法直接完成 Tampermonkey 浏览器内多标签手测，但 Phase 3 的结构性目标已经到位：
  - 单标签页局部 `local newer` 不再直接冻结所有标签页
  - 前台 follow-up 已有 tab-local / thread-local soft block 边界
  - 全局 hard pause 写入条件已明显收窄

### 8.7 Phase 4 本轮落地内容

- 在 `S1Plus.js` 中为前台探测新增显式 probe gate：
  - 命中阅读进度 `pending write`
  - 命中阅读进度同步防抖窗口
  - 命中最近初始化噪声保护窗口
  - 上述场景会优先落成当前标签页 `soft block`，不再直接进入 follow-up sync
- `foreground_resume` 与 `visible_poll` 现在复用同一条前台补偿重试链路：
  - retry 会记录剩余等待时间
  - retry 执行前会再次检查 probe gate
  - 只有本地状态稳定后才真正进入 follow-up sync
- 当前标签页一旦已有前台 retry 在等待，新的 `visibilitychange/pageshow` probe 会先返回 `followup_retry_pending`：
  - 不再重复请求远端 metadata
  - 不再把同一份旧状态连续放大
- `foreground_resume` / `pageshow(persisted)` 现在会先做核心数据 storage snapshot 收敛：
  - 先把同机会话里可能漏掉的核心数据变更直接从 GM 存储拉回当前页 cache
  - 再决定是否继续执行远端 freshness probe
- 如果前台恢复阶段已经挂起了 `pending_recovery` 后台补同步：
  - 当前轮次会先返回 `pending_recovery_settle`
  - 不再立即 probe 远端并把同机自写远端误看成“远端更新”
- 当前浏览器会话若刚刚完成本地 push / merged push：
  - 前台 probe 现在会识别 `same-session remote write`
  - 会先做 storage snapshot 收敛，再用 fresh snapshot 执行 foreground follow-up
  - 若仍需自动拉取，会改成静默处理，不再弹“远端更新”类提示
- 新增 `scripts/test-foreground-probe-gate-retry.js`，把以下行为固化成脚本回归：
  - 远端已变但本地未稳定时先 quiet soft block
  - retry pending 期间抑制重复前台探测
  - 本地稳定后只补做一次 follow-up sync

### 8.8 Phase 4 当前结论

- `Phase 4` 代码实现已完成，并已通过语法检查与相关脚本测试。
- 当前环境仍无法直接完成 Tampermonkey 浏览器内多标签手测，但本阶段的结构性目标已经到位：
  - `foreground_resume / visible_poll` 已显式感知阅读进度 pending / debounce
  - visible poll 低严重度场景会优先进入 soft block + retry
  - 前台 retry pending 时，不会再重复放大同一份旧状态
  - 前台恢复会先做核心数据 snapshot 收敛，并在 `pending_recovery` 已挂起时暂停即时 probe
  - same-session remote write 已能被识别并静默处理，foreground follow-up 也已改用 fresh snapshot 规避旧 cache 干扰

### 8.8A Phase 4 Follow-up（2026-04-21）

- 继续补齐“同机误判远端更新”的剩余链路：
  - `background / foreground_followup` 现在默认都用 `fresh snapshot`
  - 新增 `s1p_core_data_refresh_signal`，核心数据监听不可靠时也能通过 signal + storage snapshot 收敛当前页 cache
  - same-session quiet handling 已扩展到 background / per-load / daily 的自动拉取刷新策略
- 新增 same-device 识别：
  - 本机设置了 `syncDeviceId` 后，远端 `syncMeta.lastWriter.deviceId` 命中当前设备时，会改用“同设备已同步更新”类提示
  - same-session 仍优先静默，避免把同机会话自己的刚写远端继续误说成“外部云端变化”

### 8.8B Follow-up（2026-04-25）

- 已把 `visible_poll` 从“回到前台检查”中拆成独立设置 `syncVisibleRemotePollingEnabled`：
  - 新用户与旧用户默认关闭
  - 只有 `syncCheckOnReturnToForeground=true` 且该子开关也开启时，才会安排活跃约 4 分钟 / 空闲约 12 分钟的可见页低频探测
  - 保存设置、跨标签设置刷新、远程同步配置启停都会重新同步轮询状态，关闭后立即停止 timer
- 前台 probe 在命中 `updated_at` 变化后，会先做 storage snapshot 收敛，再进入完整 foreground follow-up 判断。
- 远端变化结果补充来源分层：
  - `hash_equal_after_resync` 静默更新 baseline，不提示、不刷新
  - `same_session_write` 静默处理
  - `same_device_write` 使用同设备文案
  - `external_remote_change` 保留云端更新语义
- 新增 review 文档：`auto-background-sync-and-cloud-check-review.md`。

### 8.9 Phase 5 本轮落地内容

- 在 `S1Plus.js` 中把 `s1p_pending_cleanup_info` 从全局数字计数升级为结构化 cleanup provenance，统一记录：
  - `source`
  - `cleanupModeAtCreation`
  - `createdAt`
  - `deletedCount`
  - `threadIds`
  - `initiatedFromThreadId`
  - `basisHashBefore`
  - `basisHashAfter`
- 自动清理、手动单条删除、手动分组删除现在分别写入明确来源：
  - `auto_expire_cleanup`
  - `manual_single_delete`
  - `manual_group_delete`
- 手动同步里的 cleanup shortcut 已改成严格 guard：
  - 只接受合法来源
  - 校验 cleanup 是否仍在有效期内
  - 校验本地 / 云端 `read_progress` 哈希是否分别匹配 cleanup 前后快照
  - 继续要求 `baseContentHash` 一致，避免把非阅读进度差异误吞成 cleanup
- 当前页处理路径现在会显式隔离 unrelated cleanup：
  - 当前线程页与 cleanup 涉及线程不相关时，不再触发 cleanup shortcut
  - 当前仍有全局 conflict pause 时，cleanup shortcut 不再覆盖原始触发根因
- 手动同步对比弹窗和 cleanup shortcut 的提示已改成按来源表达，至少不再把手动删除说成自动清理。
- 新增 `scripts/test-cleanup-provenance-guard.js`，把以下行为固化成脚本回归：
  - 合法 cleanup 差异允许 shortcut push
  - unrelated cleanup 不得污染当前线程页处理路径
  - conflict pause 存在时 cleanup 不得抢叙事
  - cleanup 后又发生新的阅读进度变化时，不再误走 shortcut

### 8.10 Phase 5 当前结论

- `Phase 5` 代码实现已完成，并已通过语法检查与相关脚本测试。
- 当前环境仍无法直接完成 Tampermonkey 浏览器内多标签手测，但本阶段的结构性目标已经到位：
  - cleanup provenance 已不再是来源不明的全局计数
  - cleanup shortcut 已要求前后 `read_progress` 哈希和基础哈希同时匹配
  - unrelated cleanup 不再轻易覆盖当前页或红提示原始根因

### 8.11 Phase 6 本轮落地内容

- 在 `S1Plus.js` 中重写了自动拉取 / 自动刷新相关文案，明确区分：
  - 当前页落后于云端
  - 云端有变化但本地仍未稳定
  - 真正需要人工决策的全局冲突
- 导航栏常驻提示现在明确表达自己是“全局同步暂停”：
  - 按钮文案从模糊的“处理”收口为 `全局同步`
  - 点击后先出现 preflight 说明，明确这不是只处理当前帖子
  - preflight 会提前说明会一起检查云端变化、阅读进度与 cleanup 删除来源
- 手动同步对比弹窗现在会把“原始触发原因”和“cleanup provenance”分开呈现：
  - cleanup 来自别的帖子时，会明确说明那只是附带比较信息
  - 不再把当前红提示的根因直接改写成“自动清理完成”
- 新增 `scripts/test-phase6-interaction-copy.js`，把以下 Phase 6 语义固化成脚本回归：
  - 常驻提示明确是全局同步
  - preflight 明确不是只处理当前帖子
  - 手动同步弹窗并列展示原始根因与 cleanup provenance
  - 自动拉取文案明确表达“云端备份较新”

### 8.12 Phase 6 当前结论

- `Phase 6` 代码实现已完成，并已通过语法检查与相关脚本回归。
- 当前环境仍无法直接完成 Tampermonkey 浏览器内多标签手测，但本阶段的交互目标已经到位：
  - 常驻提示、toast、手动同步入口的作用域不再含混
  - cleanup provenance 不再覆盖原始触发根因
  - 用户能在点击前就知道自己将发起的是一次全局手动同步

### 8.13 Phase 7 本轮落地内容

- 在 `S1Plus.js` 中把最近一次同步 / 探测决策的关键上下文写入持久诊断：
  - `triggerSource`
  - `pageVisibility`
  - `tabId`
  - `threadId`
  - `localHash`
  - `remoteHash`
  - `baselineHash`
  - `cleanupSource`
  - `pendingCleanupCount`
  - `syncResultKind`
  - `syncResultCode`
  - `syncBlockKind`
  - `syncBlockReason`
  - `hadConfirmedVisiblePost`
- 前台探测、自动同步、手动同步与 cleanup shortcut 现在都会把稳定结果码写入同一套诊断快照，至少能直接区分：
  - `local_changed_during_sync`
  - `startup_local_newer`
  - `cleanup_shortcut_applied`
  - `cleanup_shortcut_rejected`
- 同步诊断面板与“复制诊断”摘要已扩展到可直接查看最近触发源、阻断级别、cleanup 上下文和 hash 摘要，不再只能看时间戳。
- 又为阅读进度补了一层面向多标签排查的生命周期调试轨迹：
  - 最近几次 `pageshow / visibilitychange / focus / blur`
  - 首个可见楼层候选何时出现
  - 阅读是被 `visible_stable` 还是 `user_interaction` 确认
  - 实际何时入队写入、何时 flush、何时触发 `read_progress` 时间戳更新
  - 这样再次出现“后台开帖但从未激活，几分钟后却提示云端有更新”时，可以直接从诊断里看出到底是哪一个标签页先走到了写入链路
- 另外补了两个更直接的快速判断字段：
  - `阅读启动快照`
  - `最近阅读确认`
  便于先单独验证“后台新开页是否在启动时就拿到了异常的 `visible` 初始值”以及“是否曾经仅靠 `visible_stable` 就通过确认”
- 现在又把“后台新开页启动摘要”从事件流水里单独拆成了摘要列表：
  - 每个帖子页按 `tabId + threadId + page + startedAt` 单独保留一张摘要卡
  - 记录初始 `visibility / focus`、首次 `visibilitychange / pageshow / focus`、首个可见楼层候选、首次确认、首次入队写入、首次 `read_progress` 时间戳更新
  - 即使当前活跃页后续产生大量滚轮事件，也不会再把后台页启动时的证据刷掉
- 自动拉取后的刷新策略继续收口到统一 helper，并补齐了对应回归，确保：
  - 列表页自动刷新
  - 帖子页 soft prompt
  - 设置弹窗有未保存编辑时抑制刷新
- Phase 7 的固定脚本回归基线已收口到以下脚本：
  - `scripts/test-auto-sync-indicator-linkage.js`
  - `scripts/test-safe-sync-execution.js`
  - `scripts/test-foreground-trigger-integration.js`
  - `scripts/test-foreground-probe-gate-retry.js`
  - `scripts/test-foreground-probe-diagnostics-feedback.js`
  - `scripts/test-cleanup-provenance-guard.js`
  - `scripts/test-phase6-interaction-copy.js`
  - `scripts/test-post-sync-refresh-policy.js`
  - `scripts/test-visible-remote-polling.js`

### 8.14 Phase 7 当前结论

- `Phase 7` 代码实现已完成，并已通过语法检查与上述脚本回归。
- 当前环境仍无法直接完成 Tampermonkey 真实论坛页面上的多标签手测，但本阶段的结构性目标已经到位：
  - 复杂同步决策已有统一诊断字段和稳定结果码
  - cleanup shortcut 的 apply / reject 已能直接从诊断里识别
  - 后台开帖页的生命周期与阅读进度确认链路现在也能直接落进诊断，不再只能靠推测
  - 多标签相关的 probe / retry / refresh / cleanup / 文案链路已形成固定脚本基线

### 8.14A Phase 7 Follow-up（2026-04-21）

- 诊断与回归继续扩大：
  - 诊断新增 `本机设备 ID`、`最近远端写入`、`最近探测是否同设备写入`
  - 远端同步文件新增 `syncMeta.lastWriter`，用于可观测性，不参与 `contentHash / baseContentHash`
  - 新增 / 扩展脚本：
    - `sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
    - `sync-across-multiple-tab/scripts/test-foreground-same-session-remote-write.js`
    - `sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
    - `sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
- 这轮 follow-up 的目标不是改写 Phase 4 / 7 已完成结论，而是把同机误判远端更新的剩余观察盲区补齐，并把对应场景固化进脚本基线。

### 8.15 下一步

- 先按“列表页后台打开多个帖子、只阅读其中一个”的路径复现一次，并复制新的阅读进度调试轨迹。
- 复现时优先看新的“启动摘要”列表，再用 `阅读调试 1..N` 补细节。
- 再根据轨迹判断是继续收紧 Phase 2 的真实阅读确认条件，还是去修后台开帖页启动期的可见性判定。
- 继续把这套脚本回归作为后续同步改动的默认基线。
