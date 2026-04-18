# 同机远端更新提示问题汇总与修复方案

## 1. 文档目的

这份文档用于收口本轮关于“后台开帖 / 同机远端更新提示”的完整讨论结果。

它不替代：

- [background-open-unexpected-remote-update-investigation.md](./background-open-unexpected-remote-update-investigation.md)
- [sync_multitab_review_and_redesign.md](./sync_multitab_review_and_redesign.md)
- `Phase 2 / Phase 4 / Phase 7` 的正式阶段文档

它的定位是：

- 汇总这轮讨论里已经确认的现象与判断
- 把根因按“主因 / 次因 / 放大器 / 候选项”分层
- 解释为什么现有 phase 已完成，但问题仍可能低频残留
- 给出后续修复方案、优先级和测试要求

## 2. 与现有调查文档的关系

[background-open-unexpected-remote-update-investigation.md](./background-open-unexpected-remote-update-investigation.md) 主要记录：

- 现象
- 已排除项
- 当时的核心假设
- 已补的诊断能力
- 下次复现时如何取证

它本身不是“已经修复结案”的证明，而是“补齐诊断后的未决问题记录”。

本文件是在那份调查文档基础上，结合本轮新增的：

- 两份诊断快照
- 对 `S1Plus.js` 自动拉取 / 前台探测 / 跨标签收敛链路的回读
- 对 Phase 2 / 4 / 7 落地边界的复核

整理出的完整结论与修复设计。

## 3. 背景与现象矩阵

### 3.1 现象 A：帖子页提示“已保留本地阅读进度并完成自动合并”

典型文案：

- `后台自动同步检测到云端变化，已保留本地阅读进度并完成自动合并。当前在帖子页，暂不自动刷新。`

常见场景：

1. 列表页启用了后台打开帖子
2. 一次性后台打开多个帖子
3. 只真正阅读其中一个
4. 之后当前帖子页出现“检测到云端变化并完成自动合并”的提示

用户直觉为何会觉得“不应该”：

- 没有第二台设备
- 没有手动去改 Gist
- 直觉上“云端变化”应该来自外部

代码上的真实含义：

- 这类文案对应自动同步结果 `merged_read_progress`
- 表示“当前页本地也有阅读进度改动，同时云端版本也已经变化，但双方差异可被判定为只涉及 `read_progress`，于是走了自动合并”
- 线程页命中 `merged_read_progress` 时会走 soft prompt，而不是立刻刷新

需要澄清的一点：

- 这句文案不是 `isLightweightListPageForAutoPullRefresh()` 直接拼出来的
- `isLightweightListPageForAutoPullRefresh()` 只负责识别“轻量列表页”
- 真正负责文案与刷新策略的是自动拉取刷新 helper 链路

关联代码：

- `S1Plus.js:9391`
- `S1Plus.js:9431`
- `S1Plus.js:9449`
- `S1Plus.js:9624`

### 3.2 现象 B：帖子页提示“云端备份比当前页面更新，正在刷新”

典型文案：

- `检测到云端备份比当前页面更新，已自动拉取到本地。正在刷新页面...`

常见场景：

- 操作方式与现象 A 类似，但本次当前页没有自己的本地阅读进度差异，或当前同步分支没有命中自动合并

用户直觉为何会觉得“不应该”：

- 当前电脑上并没有“别的设备”
- 页面看起来也没有做任何特别操作

代码上的真实含义：

- 这类文案对应自动同步结果 `pulled`
- 表示“当前页观察到云端版本比自己当前看到的本地状态更新，因此执行了自动拉取”
- 非 `merged_read_progress` 的普通 `pull` 在帖子页会直接刷新

关联代码：

- `S1Plus.js:9438`
- `S1Plus.js:9456`
- `S1Plus.js:17877`
- `S1Plus.js:19252`

### 3.3 现象 C：所有帖子页都关闭后，回到未刷新的列表页，也提示“远端更新”

常见场景：

1. 先在若干帖子页里阅读
2. 关闭这些帖子页
3. 浏览器焦点回到原来的列表页
4. 列表页本身没有手动刷新
5. 仍然出现“检测到远端更新”类提示

用户直觉为何会觉得“不应该”：

- 当前看到的是旧列表页
- 自己没有刷新页面
- 直觉上它不应该“突然知道远端变了”

代码上的真实含义：

- 列表页从后台恢复到前台时，会触发 `foreground_resume` 相关探测链路
- 这个过程并不需要用户手动刷新页面
- 如果同机会话中的其他帖子页刚刚写入了阅读进度并触发了自动同步，列表页确实可能在恢复到前台时观察到远端版本更新

关联代码：

- `S1Plus.js:9832`
- `S1Plus.js:9854`
- `S1Plus.js:20021`

### 3.4 为什么“没有第二台设备”仍然不能推出“云端不可能变化”

这是整个问题里最容易混淆的点。

即使没有第二台设备，只要本机任意一个标签页：

1. 合法或异常地写入了 `read_progress`
2. 又触发了自动同步推送

云端 Gist 的 `updated_at` 仍然会变化。

所以：

- “没有第二台设备”只能排除跨设备写入
- 不能排除“同一台电脑上的另一个标签页自己把阅读进度推到了云端”

## 4. 本轮证据摘要

### 4.1 已支持“当前活跃页自己合法推送”的证据

现有调查文档已经记录过：

- 某份样本里，当前页的阅读确认来自 `user_interaction`
- 随后同步结果是 `background:pushed`

这说明：

- 至少有一部分“云端变化”不是 UI 误报
- 当前真正被阅读的页，确实可能合法写入并推送阅读进度

可对照：

- [background-open-unexpected-remote-update-investigation.md](./background-open-unexpected-remote-update-investigation.md) 第 5.2 节

### 4.2 已支持“隐藏启动页也会写入”的证据

本轮两份诊断快照又补充了更强的证据：

- 某个 `initHidden=yes` 的帖子页出现了 `rp_last_modified | phase=written, triggerSync=yes`
- 多条 `启动摘要` 显示，若干后台页虽然初始是 `hidden/no`，但后续仍出现了：
  - `confirm=visible_stable`
  - `queued=yes`
  - `modified=yes`

这说明至少存在两种可能：

1. 某些隐藏启动页在关闭、切换或时序抖动中仍然进入了写入链路
2. 某些从未主动激活的后台页，确实有机会拿到足以通过“真实阅读成立”判定的前台信号

### 4.3 本轮快照支持的总体判断

把新旧样本合在一起，当前更合理的结论是：

- 有些“云端变化”是同机当前活跃页合法推上去的
- 但后台打开的新页仍然可能低频地误进入阅读进度写入链路
- 此外，当前页是否已经及时收敛到同机其他标签页的本地变化，本身也不是完全可靠的

也就是说，现象并不只有一个根因。

## 5. 已确认结论

### 5.1 这不是“哈希明明没变却纯 UI 误报”

当前问题不能简化成“提示错了，但数据没变”。

更准确地说，它包含三类情况：

1. 同机其他标签页确实合法改了本地并推上云端
2. 后台页偶发异常走进了阅读进度写入链路
3. 当前页本地状态没有及时收敛，却先做了远端 freshness 判定

### 5.2 同机多标签也会真实改动云端

一旦任一标签页成功执行自动同步推送，Gist 的 `updated_at` 就会变化。

因此，“同机”并不意味着“远端不可能变化”。

### 5.3 现有调查文档不是结案证明

可对照：

- [background-open-unexpected-remote-update-investigation.md](./background-open-unexpected-remote-update-investigation.md) 第 6 节
- [background-open-unexpected-remote-update-investigation.md](./background-open-unexpected-remote-update-investigation.md) 第 11 节
- [background-open-unexpected-remote-update-investigation.md](./background-open-unexpected-remote-update-investigation.md) 第 12 节

这些段落本身就在表达：

- 真正未决的问题仍然存在
- 当时优先补的是诊断能力
- 后续若要继续修，需要回到 Phase 2 / 4 / 7 的结构问题

### 5.4 Phase 2 / 4 / 7 的 `Completed` 不是“这条低频场景已归零”

可对照：

- [phase_2_read_progress_denoising.md](./sync_multitab_redesign/phases/phase_2_read_progress_denoising.md) 的“剩余工作 / 风险 / 限制”
- [phase_4_foreground_probe_and_visible_poll.md](./sync_multitab_redesign/phases/phase_4_foreground_probe_and_visible_poll.md) 的“剩余工作 / 风险 / 限制”
- [phase_7_diagnostics_and_regression.md](./sync_multitab_redesign/phases/phase_7_diagnostics_and_regression.md) 的“剩余工作 / 风险 / 限制”

这些文档都保留了：

- 真实论坛页面上的 Tampermonkey 多标签补测
- 后台开帖 / bfcache / visible poll 的真实浏览器行为验证

因此，`Completed` 更准确地表示：

- 通用重构目标已落地
- 诊断与脚本基线已建立

而不是：

- 后台开帖这条低频浏览器时序问题已被实机证明确认归零

## 6. 根因分层

### 6.1 主因 A：后台打开的新页没有被显式标记为“被动页”

当前后台打开线程时，实际执行的是：

- `GM_openInTab(anchor.href, { active: !background })`

但新开的线程页没有拿到一个明确的：

- “我是由后台打开产生的新页”
- “在获得真实前台资格前只能被动初始化”

的显式状态。

现在的阅读进度状态初始化主要仍然依赖：

- `document.visibilityState`
- `document.hasFocus()`
- 可见楼层候选
- 后续 `visibilitychange / focus / interaction`

来推断当前会话是否已进入真实阅读。

问题在于：

- 只要浏览器 / 油猴在某个时序里把后台页短暂喂成了“像前台页”的生命周期信号
- 当前逻辑就仍有机会把它推进到 `reading_confirmed`

也就是说，Phase 2 已经把链路大幅收紧了，但没有做到“后台新页天然带有不可误判的被动身份”。

关联代码：

- `S1Plus.js:17167`
- `S1Plus.js:31318`
- `S1Plus.js:32192`

### 6.2 主因 B：核心数据跨标签收敛不可靠

设置同步和核心数据同步现在的可靠性并不对等。

设置同步这边，已经专门补了对 GM 监听误报 / 漏报的兜底：

- 即使 `isCrossContextChange` 不可靠，也会回退到直接对账存储快照

但核心数据这边不是这样。

`s1p_read_progress`、`s1p_blocked_posts`、`s1p_user_tags` 等核心数据的跨标签同步，当前更依赖：

- `GM_addValueChangeListener`
- `isCrossContextChange`

对于大多数核心数据 key，是否处理变化几乎等价于：

- `return Boolean(isCrossContextChange)`

这会带来两个问题：

1. 如果某次 GM 监听没有被正确标成 cross-context，当前页可能根本没吃到其他标签页刚写下的本地变化
2. 当前页随后若立刻做 foreground probe，就会拿“旧本地视图”去对“新远端状态”

于是用户感受到的就会是：

- 明明只是同机会话里别的标签页刚刚推了一次 Gist
- 当前页却把它看成了“远端比当前页面更新”

关联代码：

- `S1Plus.js:20962`
- `S1Plus.js:21522`

对照设置同步 fallback：

- `S1Plus.js:21080`

### 6.3 次因 C：前台恢复时 pending recovery 与 foreground probe 并发

列表页“关闭帖子后回到前台仍提示远端更新”这一类现象，还很可能被以下竞态放大：

页面重新 visible 时，当前实现会：

1. 先触发 `recoverPendingAutoSyncIfNeeded()`
2. 紧接着立刻触发 `triggerForegroundRemoteFreshnessProbe(...)`

但 `recoverPendingAutoSyncIfNeeded()` 实际并不会立刻同步完成本地收敛，它只是：

- 安排一条延迟后台同步任务

所以当前流程更像：

1. 页面回前台
2. 先记一条待补同步
3. 但几乎同时就去做远端 freshness probe
4. 此时本地还可能没补同步、没收敛
5. probe 提前把“同机会话刚写上去的远端变化”视为远端较新

这不是唯一根因，但它非常像“回到未刷新的列表页也提示”的重要放大器。

关联代码：

- `S1Plus.js:9832`
- `S1Plus.js:9077`

### 6.4 放大器 D：`comparableStoredValueCache` 无 TTL

`comparableStoredValueCache` 是一个无 TTL 的内存 `Map`。

它的特点是：

- 本地写入成功时会更新
- 监听成功接到跨标签变化时也会更新
- 但如果监听漏了一次，它可能长期停留在旧值

而多个 `save*` 函数在判断“值有没有变化”时，使用的正是这层缓存。

这意味着：

- 当前页可能只是“追上了别的标签页早已写过的相同值”
- 但由于缓存还停在旧状态，它仍会被判断成“发生了新变化”

接下来可能连锁触发：

1. 无意义 `last_modified` 推进
2. 多余后台同步
3. 更多“远端刚变化”的观察结果

它不一定是最初根因，但会把问题放大成更频繁、更难理解的体感。

关联代码：

- `S1Plus.js:10830`
- `S1Plus.js:12444`

### 6.5 放大器 E：共享 baseline 与滞后本地快照组合

当前 baseline 属于全局共享状态。

同步判定时会做：

- `localDataObject.contentHash !== baselineState.contentHash`
- `remoteDataObject.contentHash !== baselineState.contentHash`

问题在于：

- baseline 可能已经被另一个标签页推进到了新版本
- 但当前页本地数据仍然停在旧快照

这样一来，当前页很可能并不是“真的本地也改了”，而只是“落后于同机会话已完成的同步结果”，但在判定层里却可能长成：

- `local_changed_since_baseline`
- `both_changed_since_baseline`

这类结果

这条和“核心数据跨标签收敛不可靠”是联动关系：

- baseline 是共享的
- 本地快照收敛却不是完全同步的

关联代码：

- `S1Plus.js:17775`
- `S1Plus.js:17843`

### 6.6 候选但未证实项

以下问题目前值得保留，但不应写成已确认根因：

1. `first-post fallback` 的残余局部兜底，是否仍会在极端 DOM 缺失场景放大误判
2. `pagehide / beforeunload` flush 在某些浏览器实现里是否过于积极
3. `s1p_last_modified` 本身没有对应的跨标签监听，这是否会制造“新时间戳 + 旧本地视图”的短时导出窗口

这些都可能放大现象，但当前证据还不足以下结论。

## 7. 为什么“Phase 2 / 4 / 7 已完成”但问题还在

这个问题的关键不在于 phase 文档写错了，而在于“已完成”的语义很容易被误读。

### 7.1 `Completed` 的真实含义

它表示：

- 该阶段原定的结构性改造已在代码层完成
- 已有对应脚本基线和诊断字段

它不表示：

- 真实 Tampermonkey 多标签浏览器中的低频时序 bug 已被实机证明确认归零

### 7.2 Phase 2 实际完成了什么

Phase 2 真正完成的是：

- 阅读进度状态机拆分
- `visible_stable / user_interaction` 的确认门槛
- 去掉明显的 synthetic fallback 写入
- 暴露 pending / debounce guard

但它没有做到：

- 为后台打开的新页引入“显式被动页”身份握手

所以它可以显著降低噪声，但不能彻底封死浏览器生命周期抖动带来的漏判。

### 7.3 Phase 4 实际完成了什么

Phase 4 真正完成的是：

- 当前页 probe gate
- foreground resume / visible poll 的 quiet retry
- soft block 与低打扰处理

但它主要保护的是：

- 当前页自己的 pending write / debounce / 初始化噪声

它并不天然负责区分：

- 外部设备改了远端
- 同机其他标签页刚刚推了一次远端

### 7.4 Phase 7 实际完成了什么

Phase 7 真正完成的是：

- 诊断字段
- 启动摘要
- 阅读调试轨迹
- 固定脚本回归基线

它的价值在于：

- 再次出现问题时，终于可以从诊断里直接看到线索

它不是：

- “问题已经修完”的证明

## 8. 修复方案

### 8.1 方案 1：显式引入“后台打开被动页”握手

优先级：最高

目标：

- 把“后台打开的新页必须先被动初始化”从推断规则升级成显式状态

实现要求：

1. 列表页后台打开线程时，除 `GM_openInTab(..., { active: false })` 外，再写一份短寿命 opener-side 标记
2. 新开的线程页启动时读取该标记，把当前会话明确设为：
   - `passive_background_opened`
3. 在该标记未解除前：
   - 允许观察器初始化
   - 不允许进入 `hasConfirmedReading`
   - 不允许 `visible_stable` 单独完成首次确认
4. 只有满足以下任一条件才解除被动状态：
   - 当前页真正获得前台焦点并稳定可见一小段时间
   - 当前页发生明确用户交互，如 `wheel / touchstart / keydown`
5. `pageshow(normal)` 或瞬时 `visibilityState === "visible"` 不能单独解除被动状态

建议新增状态：

- `backgroundOpenSessionId`
- `readProgressTrackingState.passiveBackgroundOpened`

建议补入诊断：

- 启动摘要里新增“是否命中 passive 背景打开”

预期收益：

- 把当前最像主因的“后台页被误认为前台页”从根上收紧

### 8.2 方案 2：为核心数据跨标签同步补 storage snapshot fallback

优先级：第二

目标：

- 提高同机不同标签页之间的本地状态收敛可靠性

实现要求：

1. 给核心数据增加与 settings 类似的 snapshot fallback，对以下 key 做统一处理：
   - `s1p_read_progress`
   - `s1p_blocked_threads`
   - `s1p_blocked_users`
   - `s1p_blocked_posts`
   - `s1p_user_tags`
   - `s1p_bookmarked_replies`
   - `s1p_title_filter_rules`
2. 当前页从 hidden -> visible 时，如果发现核心数据可能存在待收敛状态，先直接从 GM 存储拉取最新 snapshot 并对账
3. 若监听缺失但 snapshot 与本地缓存有差异，则：
   - 立即刷新 cache
   - 记录一次 `core_data_snapshot_resync`

建议新增接口：

- `syncCoreDataFromStorageSnapshotIfNeeded()`

建议新增诊断字段：

- `lastCoreDataSnapshotResyncAt`
- `lastCoreDataSnapshotResyncKeys`

预期收益：

- 减少“同机其他页其实已改本地 / 已推云端，但当前页还拿旧本地视图做判定”的情况

### 8.3 方案 3：串行化 foreground recovery 流程

优先级：第三

目标：

- 消除“回到前台时 recovery 和 probe 抢跑”的竞态

实现要求：

1. `visibilitychange -> visible` 后，不再立即并发跑：
   - pending recovery
   - foreground probe
2. 改成固定顺序：
   1. 先做核心数据 snapshot 收敛
   2. 再处理 `recoverPendingAutoSyncIfNeeded()`
   3. 如果这一步确实安排了 pending recovery，则当前页 foreground probe 进入 quiet wait
   4. 只有在本地状态稳定、且没有待执行 recovery 时，才执行 foreground probe
3. 这一步要合并进现有 Phase 4 的 probe gate，不要做两套并行等待逻辑

建议新增行为：

- `pending_recovery` 对 foreground probe 形成新的 soft block / retry 理由

建议新增结果码：

- `blocked:soft:pending_recovery_settle`
- `skipped:core_data_snapshot_resync_pending`

预期收益：

- 减少列表页从后台回来时，先看到“远端更新”，后才慢慢收敛的体验

### 8.4 方案 4：继续收紧“真实阅读成立”条件

优先级：第四

目标：

- 对隐藏启动页再加一道阅读确认门槛

实现要求：

1. 对 `initiatedWhileHidden === true` 的线程页，首次确认必须同时要求：
   - 真正进入前台后稳定可见
   - 且至少满足以下其一：
     - 至少一次明确用户交互
     - 当前页已经真正拿到焦点
2. 单靠 `visible_stable`，不足以让“隐藏启动页”进入 `reading_confirmed`
3. 对正常前台打开的线程页，继续保留 `visible_stable` 路径，避免回归体验

建议新增或明确的状态：

- `confirmationEligibility`

建议补入诊断：

- `visible_stable_confirmed`
- `user_interaction_confirmed_after_hidden_start`

预期收益：

- 即使方案 1 尚未完全覆盖所有浏览器时序，这里也能再拦住一部分隐藏启动页误确认

### 8.5 方案 5：为“同机自己写远端”增加本地识别与降噪

优先级：第五

目标：

- 改善用户体感，减少把“同机会话自己的 push”表述成“好像外部远端变了”

实现要求：

1. 本地记录最近一次成功 `push / merged push` 的来源标签页、线程页、动作和 `remoteUpdatedAt`
2. 当前页 foreground probe 若只命中了“同浏览器会话内刚完成的一次 push”，优先做静默收敛
3. 只在确认不是同机会话自身刚写入，或者当前页本地确实落后时，才展示现有“远端更新”类提示

建议新增状态：

- `lastLocalSessionRemoteWrite`

字段至少包括：

- session/device id
- `sourceTabId`
- `threadId`
- `action`
- `remoteUpdatedAt`
- `createdAt`

预期收益：

- 同机会话内部的正常自动同步不再那么像“外部远端突变”

### 8.6 方案 6：修整缓存层放大器

优先级：第六

目标：

- 降低缓存滞后导致的重复写入、时间戳放大与多余同步

实现要求：

1. `comparableStoredValueCache` 改成 TTL 缓存，或在 foreground resume 时强制与存储对账
2. `s1p_last_modified` 在关键 foreground 收敛点参与一致性检查
3. `exportLocalDataObject()` 在 foreground follow-up 场景可选使用“fresh snapshot 模式”，减少“旧 cache + 新 baseline”组合

预期收益：

- 减少重复写入和无意义后台同步
- 降低 “local_changed_since_baseline / both_changed_since_baseline” 被放大的概率

### 8.7 当前实现进度（2026-04-18）

本轮已落地：

1. 方案 1：后台打开被动页握手
   - 列表页后台开帖时会写入短寿命 opener hint
   - 线程页启动时若消费到匹配 hint，会把本次阅读会话标记为 `passiveBackgroundOpened`
2. 方案 2：核心数据 storage snapshot fallback
   - 前台恢复前会直接从 GM 存储对账核心数据
   - resync 会同时刷新 core data cache 和 `comparableStoredValueCache`
3. 方案 3：foreground recovery 串行化
   - `visibilitychange -> visible` 与 `pageshow(persisted)` 现在会先做核心数据收敛，再处理 `pending_recovery`
   - 若确实已挂起 `pending_recovery`，当前轮次会先返回 `pending_recovery_settle`
4. 方案 4：收紧隐藏启动页首次确认
   - 对 `initiatedWhileHidden === true` 或命中 `passiveBackgroundOpened` 的线程页，首次确认必须满足“稳定前台 + 明确交互 / 当前页真正拿到焦点”
   - 单靠 `visible_stable` 已不能完成首次确认
5. 方案 5：same-session remote write 降噪
   - 当前浏览器会话成功 push / merged push 后，会记录最近一次本地远端写入
   - 前台 probe 命中同一 `remoteUpdatedAt` 时，会先做 storage snapshot 收敛
   - 若仍需自动拉取，会改成静默处理，不再弹“远端更新”类提示
6. 方案 6：缓存层放大器治理
   - `comparableStoredValueCache` 现在带 TTL
   - foreground follow-up 已改用 `useFreshSnapshot` 导出本地数据，减少“旧 cache + 新 baseline”组合

本轮同步补齐：

- 诊断快照新增“最近核心数据收敛”字段
- 诊断快照新增“最近探测是否同机会话写入”字段
- 阅读启动摘要新增 `passive=yes/no`
- 新增脚本测试：
  - `scripts/test-background-open-passive-session.js`
  - `scripts/test-core-data-snapshot-resync.js`
  - `scripts/test-foreground-same-session-remote-write.js`
- 扩展脚本测试：
  - `scripts/test-foreground-trigger-integration.js`

暂未落地：

- 更激进的全量 fresh snapshot 导出策略
- `s1p_last_modified` 与更多非核心缓存层的一致性治理

## 9. 测试与验收

### 9.1 当前脚本测试覆盖

当前已覆盖：

- `scripts/test-background-open-passive-session.js`
  - 验证后台打开页在未获前台 + 无交互前不会进入 `reading_confirmed`
  - 验证 `passiveBackgroundOpened` 与 `initiatedWhileHidden` 会话在“稳定前台 + 真正拿到焦点”后可记录短帖 / 无滚动阅读进度
- `scripts/test-core-data-snapshot-resync.js`
  - 验证核心数据监听缺失时，foreground resync 仍能收敛
  - 验证 foreground follow-up 的 `fresh snapshot` 导出可绕过旧 cache
- `scripts/test-foreground-trigger-integration.js`
  - 覆盖 `visibilitychange / pageshow(persisted)` 下的 snapshot resync、`pending_recovery_settle` 和 probe 串行化
- `scripts/test-foreground-same-session-remote-write.js`
  - 覆盖“同机会话刚 push，另一页回前台”的 quiet handling、诊断标记与必要刷新保留
- `scripts/test-post-sync-refresh-policy.js`
  - 验证 `pulled / merged_read_progress` 在列表页、帖子页、设置脏态页上的刷新策略
  - 验证 quiet handling 的 `suppressMessage` 分支会静默保留刷新，而不会再弹“远端更新”类提示

### 9.2 浏览器手测场景

以下场景仍需在真实浏览器 + Tampermonkey 环境补跑，目前仓库内脚本测试尚未替代这些时序验证：

1. 列表页后台打开多个帖子，只真正阅读其中一个
2. 后台打开后从未激活的帖子页保持挂起 2 到 3 分钟
3. 关闭刚阅读过的帖子页，立即回到未刷新的列表页
4. 某个标签页刚完成后台 push，另一标签页随后触发 `foreground_resume`
5. bfcache 恢复
6. 快速隐藏 / 显示切换
7. 油猴监听故障模拟或被动验证
8. 主楼 DOM 异常缺失的线程页

### 9.3 验收标准

修复完成后应满足：

1. 后台打开但从未真正阅读的帖子页，不再产生可同步 `read_progress`
2. 刚关闭帖子页回到列表页时，不会因为同机会话自身刚推送而弹“远端更新”提示
3. 当前页若只是尚未收敛到同机其他页已写入的数据，会先静默收敛，再决定是否需要提示
4. 诊断能直接看出：
   - 是否命中 passive background session
   - 是否命中 core data snapshot resync
   - 是否因为 pending recovery 延迟了 foreground probe
   - 是否识别为 same-session remote write

## 10. 建议的默认实施顺序

默认优先级建议如下：

1. 被动页显式握手
2. 核心数据 snapshot fallback
3. foreground recovery 串行化
4. 阅读确认条件再收紧
5. same-session remote write 降噪
6. 缓存层清理

原因是：

- 前三项直接决定“同机会话里到底会不会被误写、会不会先 probe 后收敛”
- 第四项是在 Phase 2 上补刀
- 第五项偏体验层
- 第六项更像稳定性收口和放大器治理

## 11. 当前默认假设

- 继续采用“新增独立文档 + 在旧调查文档增加跳转”的方式，而不是改写历史 phase 结论
- 不把这份文档当成“问题已修复”的标记，而是当成下一轮实际修复的设计输入
- 如果后续证据证明“后台页没有误写，只是当前页收敛滞后”，则优先提高方案 2 / 3 / 6 的优先级
- 如果后续证据再次证明“从未激活后台页确实能命中 `confirm=visible_stable + queued=yes + modified=yes`”，则优先执行方案 1 / 4
