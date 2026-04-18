# Phase 2: 阅读进度写入链路去噪

## 1. 默认读取集

### 必读

1. [根文档](../../sync_multitab_review_and_redesign.md)
2. 本文档

### 选读

- [problem_catalog.md](../problem_catalog.md)
- [architecture_principles.md](../architecture_principles.md)

## 2. 目标

切断“后台打开标签页或初始化观察器就制造本地改动”的根因，让同步层拿到的阅读进度变化尽量都是真实用户行为。

## 3. 本阶段覆盖的问题

- `3.4.1` 线程页一加载就启动阅读进度跟踪
- `3.4.2` 首轮 `IntersectionObserver` 回调后无条件安排保存
- `3.4.3` 没有真实可见楼层时回退到主楼记录
- `3.4.4` 后台打开的帖子标签页也可能制造本地改动
- `3.4.5` 阅读进度写入缺少“真实阅读 vs 初始化噪声” provenance
- `3.3.4` 的前半部分：为后续 probe gate 暴露 pending / debounce 信号
- `8.1` 后台打开的新帖子页必须是“被动标签页”

## 4. 本阶段要做成什么样

### 4.1 把阅读进度跟踪拆成明确状态

建议至少拆成：

1. 观察初始化
2. 候选记录收集
3. 真实阅读确认
4. 落盘

### 4.2 后台打开的新帖子页默认只允许“被动初始化”

要求：

- 可以建立观察器
- 不应直接制造可同步的本地改动

### 4.3 初次回调后不再无条件安排保存

只有满足“真实阅读成立”的条件时，才允许安排持久化，例如：

- 页面可见且稳定停留超过短时间窗口
- 观察到真实可见楼层
- 用户产生明确阅读行为，如滚动或键盘翻页

### 4.4 初次保存禁止使用主楼 fallback 生成 synthetic progress

除非满足极少数显式兜底条件，否则不得把“没拿到真实可见记录”硬转成“主楼已读”。

### 4.5 为阅读进度写入增加 provenance

至少包括：

- `sourceTabId`
- `threadId`
- `page`
- `saveReason`
- `documentVisibilityState`
- `hadConfirmedVisiblePost`
- `createdAt`
- `initiatedWhileHidden`

### 4.6 显式区分 pending write 与 stable dirty

这一步是后续 `Phase 4` 的前提。

前台探测与 visible poll 之后要能读到：

- 当前页是否还有待持久化写入
- 当前页是否仍处于同步防抖窗口

## 5. 本阶段不要顺手做什么

1. 不在这里重做前台探测与 visible poll 的重试策略
2. 不在这里引入 soft block / hard pause 全模型
3. 不在这里改 cleanup provenance
4. 不在这里重写导航栏文案

## 6. 推荐交付物

1. 新的阅读进度候选状态机
2. 背景标签页不落盘策略
3. 无 synthetic fallback 的初始写入策略
4. 带 provenance 的阅读进度元数据
5. 可供 probe 使用的 pending / debounce 状态信号

## 7. 验收标准

1. 从列表页后台打开多个帖子，在未真实阅读前，不应平白产生可同步本地改动。
2. 初始观察回调不再自动写主楼阅读进度。
3. 用户真实阅读时，阅读进度仍能稳定保存，不丢进度。
4. 后续探测链路能够读取“当前页是否仍在 pending / debounce”状态。

## 8. 交给下一阶段的输出

`Phase 3` 和 `Phase 4` 会直接依赖这里产出的：

- 真实阅读 vs 初始化噪声的 provenance
- pending write / debounce 状态信号

如果这里没做干净，后面的冲突判定再精细，也只是在噪声上做决策。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 在线程页阅读进度链路中加入显式运行时状态，区分观察初始化、候选收集与真实阅读确认
  - 将阅读进度保存改成“确认真实阅读后再进入写入队列”，确认条件包含：
    - 页面保持可见并稳定停留一个短窗口
    - 或发生滚轮 / 触摸 / 键盘翻页类交互
    - 且已经拿到真实可见楼层记录
  - 后台打开的新帖子页默认保持被动，不再在隐藏状态下安排阅读进度保存
  - 删除“没有真实可见楼层时回退主楼生成 synthetic progress”的候选解析路径
  - 为新写入的阅读进度记录补入 provenance：
    - `sourceTabId`
    - `threadId`
    - `page`
    - `saveReason`
    - `documentVisibilityState`
    - `hadConfirmedVisiblePost`
    - `createdAt`
    - `initiatedWhileHidden`
  - 暴露 `getReadProgressProbeGuardState()`，供后续 `Phase 4` 读取：
    - 当前页是否仍有 pending save / pending persist
    - 当前页是否仍处于阅读进度同步防抖窗口
    - 当前会话是否由隐藏页启动
- 涉及文件：
  - `S1Plus.js`
  - `sync_multitab_review_and_redesign.md`
  - `sync_multitab_redesign/phases/phase_2_read_progress_denoising.md`
  - `sync_multitab_redesign/problem_catalog.md`
- 验证：
  - 已通过 `node --check S1Plus.js`
  - 已人工回读阅读进度候选解析、隐藏页切换、落盘与 provenance 生成链路
  - 当前环境无法直接完成 Tampermonkey / 浏览器内多标签手测，已记录为后续补充验证项
- 剩余工作：
  - 在真实论坛页面补跑后台开帖、多标签切换、关闭标签页的手测
  - 将本阶段暴露的 pending / debounce 信号接入 `foreground_resume` 与 `visible_poll` 的 gate 逻辑
- 风险 / 限制：
  - 当前仍保留“主楼本身可见但楼层 DOM 缺失时，将其楼层视为 1 楼”的局部解析兜底；它不再用于“没有真实可见楼层”的 synthetic fallback
  - `getReadProgressProbeGuardState()` 目前只提供运行时信号，真正的 probe gate 消费逻辑留在 `Phase 4`
- 下一步：
  - 进入 `Phase 3` 处理同步状态分层；并在可用浏览器环境补跑 Phase 2 的多标签回归手测
