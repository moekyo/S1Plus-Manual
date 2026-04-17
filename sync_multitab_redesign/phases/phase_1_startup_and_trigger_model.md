# Phase 1: 启动期与触发源语义收口

## 1. 默认读取集

### 必读

1. [根文档](../../sync_multitab_review_and_redesign.md)
2. 本文档

### 选读

- [problem_catalog.md](../problem_catalog.md)
- [architecture_principles.md](../architecture_principles.md)

## 2. 目标

把启动期行为、触发源分类和已经做过的局部修复正式收进统一模型，避免后续阶段又把 stale startup、每日首次同步和手动同步语义重新混到一起。

## 3. 本阶段覆盖的问题

- `3.1.1` 每日首次同步触发时机漂移
- `3.1.2` stale startup callback 晚到执行启动专属检查
- `3.1.3` 顺延每日首次同步时误伤其他启动任务
- `3.1.4` deferred daily sync 饥饿风险
- `3.1.5` 手动同步替代每日首次自动同步
- `3.1.6` 顺延状态的导航栏语义不准确

## 4. 本阶段要做成什么样

### 4.1 统一 trigger source 枚举

至少显式区分：

- `daily_startup`
- `per_load`
- `page_load_visible`
- `foreground_resume`
- `visible_poll`
- `background_push`
- `manual_sync`

### 4.2 建立统一的 startup orchestrator

要求：

1. 启动专属动作只允许在 freshness window 内运行。
2. 超出 freshness window 后：
   - 不再补跑 `per_load`
   - 不再补跑 `page_load_visible`
   - 只允许记录或补偿 `daily_startup`
3. deferred daily sync 一旦存在，下一次新页面必须优先补执行。

### 4.3 明确每日首次自动同步与手动同步的状态边界

要求：

- 手动同步不写每日首次自动同步完成状态
- 每日首次自动同步与手动同步分别持有自己的语义和完成条件

### 4.4 导航栏待处理状态要对齐来源

要求：

- 顺延的是每日首次同步，就显示每日首次同步待处理
- 不再复用“后台同步待处理”之类模糊语义

## 5. 本阶段不要顺手做什么

为了控制上下文和改动范围，本阶段先不要顺手把这些也一起做了：

1. 不重写阅读进度落盘逻辑
2. 不改 visible poll 的低打扰策略
3. 不改 cleanup provenance
4. 不改导航栏“处理”按钮的交互设计

这些分别留给 `Phase 2`、`Phase 4`、`Phase 5`、`Phase 6`

## 6. 推荐交付物

1. 统一的 trigger source 模型
2. 统一的 startup orchestrator
3. 正式的 deferred daily sync 状态结构
4. 启动期相关日志与状态命名修正

## 7. 验收标准

1. 早上首次打开论坛时，每日首次同步在短窗口内决策，不会几分钟后晚到强刷。
2. 页面开了很久后，不会因为 stale startup callback 又补跑 `per_load` / `page_load_visible`。
3. 已顺延的每日首次同步会在下一次新页面补执行，不会持续饥饿。
4. 手动同步不会覆盖每日首次自动同步语义。
5. 导航栏待处理状态能准确表明“每日首次同步已顺延”。

## 8. 交给下一阶段的输出

`Phase 2` 和后续阶段都默认依赖这里已经成立的触发源枚举与 startup 语义边界。

如果这一步没先做稳，后面很容易又把前台探测或 visible poll 错塞回 startup 语义。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 在 `S1Plus.js` 中补齐并统一 trigger source 命名，覆盖 `daily_startup`、`per_load`、`page_load_visible`、`foreground_resume`、`visible_poll`、`background_push`、`manual_sync`
  - 将启动期入口整理为显式的 startup orchestrator 决策分支，fresh 与 stale 路径分别落到独立决策
  - stale startup 现在只允许两类补偿：
    - 顺延 `daily_startup`
    - 对已顺延的 `daily_startup` 进行优先补执行
  - `s1p_deferred_startup_sync` 持久化结构补入 `scheduledBy`
  - 导航栏自动同步指示器的来源文案已按真实 source 对齐，不再把启动期相关状态折叠成模糊来源
- 涉及文件：
  - `S1Plus.js`
  - `sync_multitab_review_and_redesign.md`
  - `sync_multitab_redesign/phases/phase_1_startup_and_trigger_model.md`
- 验证：
  - 已通过 `node --check S1Plus.js`
  - 已人工回读 startup orchestrator、deferred daily sync、前台 follow-up source 推导相关代码路径
  - 当前环境无法直接完成 Tampermonkey 浏览器内多标签手测，已记录为后续补充验证项
- 剩余工作：
  - `Phase 1` 无新的代码阻塞项
  - 真实浏览器中的多标签/挂起恢复手测仍建议补跑一次
- 风险 / 限制：
  - 老的持久化自动同步指示器来源值如果仍是历史 `foreground_followup`，会在下一次状态刷新前被兼容映射为 `foreground_resume`
  - `visible_poll_active` / `visible_poll_idle` 仍保留为轮询子原因；本阶段只统一 source，不改轮询策略本身
- 下一步：
  - 进入 `Phase 2`，处理阅读进度写入去噪、后台打开标签页默认被动化，以及后续探测所需的 pending/debounce 信号
