# 自动同步指示器联动设计文档

## 1. 背景

当前导航栏里的 `s1p-nav-auto-sync-indicator` 仍然是按“后台自动同步状态指示器”设计的：

- 仅在 `syncAutoEnabled === true` 时显示
- 主要联动后台自动推送/自动同步队列
- tooltip 与设置文案都强调“后台自动同步”

但当前远程同步相关的自动路径已经不止后台自动同步一条，还包括：

- 每日首次加载时同步
- 每次页面加载检查
- 回到前台时检查
- 可见页低频轮询后触发的 follow-up safe sync
- 后台自动同步

这导致用户会遇到一个明显的不一致：

- 某些自动同步已经发生了
- 但导航栏指示器没有反映
- 指示器和“自动同步”这个产品概念并没有真正联动

## 2. 设计目标

本次联动方案的目标不是新增一套复杂 UI，而是把现有导航栏指示器升级为“统一自动同步状态指示器”。

需要满足：

1. 统一反映所有自动同步执行路径，而不只反映后台自动同步
2. 保持低打扰，不因为高频 probe 或轮询而让指示器频繁闪动
3. 尽量复用现有状态机、图标、TTL 和跨标签同步机制
4. 不改动现有同步决策逻辑，只在状态汇总与展示层做联动
5. 与现有常驻 alert 分工明确，避免职责重叠

## 3. 非目标

本方案暂不追求以下事情：

- 不为前台 probe 新增单独图标状态
- 不把每一次 metadata-only probe 都显示成导航栏动画
- 不替代现有 toast 反馈
- 不替代现有常驻冲突/熔断 alert
- 不改写 `performAutoSync()` 的判定语义

## 4. 核心设计

### 4.1 产品语义调整

将当前“后台自动同步状态指示器”升级为：

- 新名称：`自动同步状态指示器`

它代表的是“自动同步体系的当前摘要状态”，而不是“后台自动同步子模块的专属状态”。

### 4.2 显示条件

当前显示条件过窄：

- `syncRemoteEnabled === true`
- `syncAutoEnabled === true`
- `syncShowAutoSyncIndicator === true`

建议调整为：

- `syncRemoteEnabled === true`
- `syncShowAutoSyncIndicator === true`
- 且至少有一种自动路径开启

自动路径定义为以下任一项为真：

- `syncDailyFirstLoad`
- `syncPerLoadCheckEnabled`
- `syncCheckOnReturnToForeground`
- `syncAutoEnabled`

这样可以覆盖“只开每日首次”或“只开回到前台检查”的场景。

### 4.3 状态模型

继续复用现有 6 个显示态：

- `idle`
- `pending`
- `running`
- `success`
- `failure`
- `conflict`

不新增新图标态，只补充“来源”维度。

建议在现有 indicator state 上增加可选字段：

- `source`
- `reason`

`source` 建议取值：

- `background`
- `daily_startup`
- `per_load`
- `foreground_followup`

其中：

- `background` 表示后台自动同步
- `daily_startup` 表示每日首次加载时同步
- `per_load` 表示每次页面加载检查
- `foreground_followup` 表示前台 probe 发现远端变化后，进入 follow-up safe sync

### 4.4 指示器与 probe 的边界

这里必须故意“克制”。

建议联动的是“真正进入自动同步执行”的时刻，而不是所有轻量探测动作。

具体规则：

- metadata-only probe 结果为 `unchanged`
  - 不点亮 indicator
- metadata-only probe 因 cooldown / active sync / disabled 被跳过
  - 不点亮 indicator
- probe 发现远端更新，但还没进入 safe sync
  - 原则上不单独显示 `pending`
- 只有真正调用 follow-up safe sync 时
  - 才切换到 `running`
- follow-up sync 结束后
  - 再根据结果切到 `success / failure / conflict`

这样可以避免：

- 页面可见轮询导致导航栏持续闪烁
- 用户误以为“探测”已经等同于“同步”

## 5. 各自动路径的联动规则

### 5.1 每日首次加载时同步

入口：`handleStartupSync()`

联动方式：

- 进入 `runStartupModeAutoSyncCheck()` 且准备执行 `performAutoSync()` 时
  - indicator -> `running`
  - `source = daily_startup`
- 完成后
  - `success`：显示成功态
  - `failure`：显示失败态
  - `conflict`：显示冲突态
  - `skipped`：通常不改 indicator，保留当前摘要状态

特殊说明：

- `daily_sync_already_completed`
  - 不应触发指示器变化
- `skipped_push_on_startup`
  - 如果语义是“为保护本地而暂停自动处理”，建议落到 `conflict`
  - 因为对用户来说这是“需要手动介入”的状态

### 5.2 每次页面加载检查

入口：`handlePerLoadSyncCheck()`

联动方式与每日首次一致，只是：

- `source = per_load`

### 5.3 回到前台检查 / 可见页轮询

入口链路：

- `checkRemoteFreshnessOnForeground()`
- `requestForegroundRemoteSyncCheck()`

联动原则：

- 纯 probe 阶段静默
- 只有发现远端变化并真正进入 follow-up sync 时才联动 indicator

具体规则：

- probe unchanged / cooldown / skipped
  - indicator 不变化
- probe changed -> request follow-up sync
  - indicator -> `running`
  - `source = foreground_followup`
- follow-up sync 结果：
  - `success` -> `success`
  - `failure` -> `failure`
  - `conflict` -> `conflict`
  - `skipped` -> 视原因决定是否落态

建议：

- `skipped` 且原因是 `conflict_paused`
  - indicator -> `conflict`
- `skipped` 且原因是 `circuit_open`
  - indicator -> `failure`
- `skipped` 且原因是 `startup_lock_unavailable` / `foreground_sync_in_flight`
  - 不改 indicator

### 5.4 后台自动同步

入口：`triggerRemoteSyncPush()`

继续保留现有机制：

- 有队列时 -> `pending`
- 开始执行 -> `running`
- 完成后 -> `success / failure / conflict`

但语义上改为“自动同步体系中的后台来源”，而不再是整个 indicator 的唯一来源。

## 6. Tooltip 与设置文案调整

### 6.1 导航栏 tooltip

当前 tooltip 仍然是：

- `后台自动同步：待命`
- `后台自动同步：进行中`
- `后台自动同步：已完成`

建议改为 source-aware 文案，例如：

- `自动同步：待命`
- `自动同步：后台同步待处理`
- `自动同步：每日首次同步中`
- `自动同步：每次加载检查中`
- `自动同步：前台发现更新，正在同步`
- `自动同步：自动同步已完成`
- `自动同步：自动同步失败（待下次同步）`
- `自动同步：发现冲突，请手动同步`

设计原则：

- 标题仍保持短句
- 必要时通过 `source` 提供来源上下文
- 不在 tooltip 里塞过长技术细节

### 6.2 设置项文案

建议把当前设置项：

- `显示后台同步状态指示器`

改为：

- `显示自动同步状态指示器`

说明文案建议改为：

- `开启后，会在导航栏显示自动同步状态摘要，包括每日首次、每次加载、回到前台检查后的自动同步，以及后台自动同步。`

### 6.3 设置层级

当前这个开关挂在“启用自动后台同步”的子组下，语义已经不准确。

建议将其提升为远程同步区域中的独立选项，不再作为“自动后台同步”的子项。

原因：

- 它现在服务的是整个自动同步体系
- 用户可能不开后台自动同步，但会开启每日首次或前台检查

## 7. 与常驻 alert 的分工

必须明确 indicator 和 sticky alert 的职责边界。

建议分工如下：

- indicator
  - 负责显示“自动同步摘要状态”
  - 回答“现在自动同步整体是什么状态”
- sticky alert
  - 负责显示“需要用户介入的持续问题”
  - 回答“你现在需要做什么”

因此：

- 冲突暂停
  - indicator 可以显示 `conflict`
  - sticky alert 继续承担主提示入口
- 连续失败熔断
  - indicator 可以显示 `failure`
  - sticky alert 继续提示“预计何时恢复 / 可立即手动同步”

这样层级清晰，不会把所有细节都压进一个小圆点里。

## 8. 实现建议

### 8.1 推荐做法

不要为每一条自动路径各写一套新的 indicator 逻辑。

更稳妥的做法是把现有后台专用 helper 抽象成通用 helper：

- `startAutoSyncIndicatorCycle(source, options?)`
- `finishAutoSyncIndicatorCycle(token, phase, options?)`
- `setAutoSyncIndicatorResolvedPhase(phase, options?)`

然后让后台同步继续复用，只是在调用时显式传入：

- `source = background`

再让以下入口也接入这套 helper：

- `handleStartupSync()`
- `handlePerLoadSyncCheck()`
- `requestForegroundRemoteSyncCheck()`

### 8.2 推荐保留的既有能力

以下现有机制建议保留：

- resolved state TTL
- 跨标签 GM 状态同步
- running stale 兜底
- pending stale 兜底
- conflict/failure TTL

### 8.3 推荐避免的改法

以下做法不推荐：

- 让 `checkRemoteFreshnessOnForeground()` 的每一次 probe 都调用 `pending`
- 给 probe 单独新增一个“探测中”图标态
- 把 sticky alert 的逻辑硬塞进 indicator tooltip
- 为不同来源复制多份 phase 转换逻辑

## 9. 低风险落地顺序

建议按以下顺序实施：

1. 先改文案与显示条件
2. 再把 indicator helper 泛化为 source-aware
3. 接入每日首次 / 每次加载
4. 接入前台 follow-up sync
5. 最后回归 tooltip、TTL、跨标签显示和静默 probe 行为

这样做的好处是：

- 先拿到正确的产品语义
- 再逐步扩大联动范围
- 每一步都比较容易回归验证

## 10. 需要覆盖的回归点

### 10.1 基础显示

- 仅开启每日首次同步时，indicator 仍可显示
- 仅开启每次加载时，indicator 仍可显示
- 仅开启回到前台检查时，indicator 仍可显示
- 仅开启后台自动同步时，indicator 仍可显示
- 四项都关闭时，indicator 不显示

### 10.2 来源联动

- 每日首次触发时，tooltip 显示每日首次来源
- 每次加载触发时，tooltip 显示每次加载来源
- 前台 follow-up sync 触发时，tooltip 显示前台来源
- 后台自动同步仍保留 pending 能力

### 10.3 静默 probe

- 前台 probe unchanged 不应改变 indicator
- 可见页轮询 cooldown 不应改变 indicator
- active sync 导致的 probe skipped 不应改变 indicator

### 10.4 异常与冲突

- `conflict_paused` 能正确显示为 `conflict`
- `circuit_open` 能正确显示为 `failure`
- 本地改动阻止自动拉取时，indicator 与 sticky alert 语义一致

### 10.5 跨标签

- 一个标签页触发自动同步后，其他标签页的 indicator 能同步到最终状态
- 不因跨标签监听造成状态来回闪动

## 11. 结论

本方案的核心不是“给 indicator 增加更多动画”，而是把它从“后台自动同步小灯”升级成“自动同步总览状态”。

最重要的设计判断有两个：

1. 指示器联动的是“真正执行自动同步”的时刻，不是所有轻量 probe
2. sticky alert 继续负责需要用户介入的持续问题，indicator 只做摘要

如果按这个方向实施，改动面主要集中在状态汇总层和文案层，能够在不重写同步引擎的前提下，把导航栏反馈和现有自动同步体系真正对齐。
