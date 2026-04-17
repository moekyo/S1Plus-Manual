# Phase 3: 同步状态模型分层

## 1. 默认读取集

### 必读

1. [根文档](../../sync_multitab_review_and_redesign.md)
2. 本文档

### 选读

- [architecture_principles.md](../architecture_principles.md)
- [Phase 2](./phase_2_read_progress_denoising.md)

## 2. 目标

把“当前标签页局部状态”和“全局同步状态”拆开，引入独立的 `foreground_followup` 模式，以及 `soft block / hard pause` 双层阻塞模型。

## 3. 本阶段覆盖的问题

- `3.3.1` 前台 follow-up 复用 startup 模式
- `3.5.1` 一个标签页的本地较新放大成全局暂停
- `3.5.2` 缺少页级和线程级边界
- `8.2` 多标签页共享的应只有远端探测状态
- `8.3` 一个标签页的局部问题不应冻结所有标签页

## 4. 本阶段要做成什么样

### 4.1 前台 follow-up 不再走 startup 执行路径

要求：

- 有独立的 `foreground_followup` 模式
- 不再沿用 `skipped_push_on_startup` 这一套启动期语义来解释前台探测结果

### 4.2 引入双层阻塞模型

#### 全局 hard pause

仅用于：

- 真正的双边冲突
- 非阅读进度类的重要本地更改会被 pull 覆盖

#### 页级 soft block

仅用于：

- 当前标签页的短时 local dirty
- 当前页仍在防抖或待持久化窗口
- 当前页局部问题尚不足以上升到全局冲突

### 4.3 明确状态归属

需要明确哪些状态属于：

1. 全局共享
2. 标签页本地
3. 线程级或当前页上下文

目标是避免：

- 某一页的短时脏状态污染全局
- 某一个线程页的短时差异冻结其他页

## 5. 本阶段不要顺手做什么

1. 不在这里重写 visible poll 的重试 / backoff 策略
2. 不在这里重做 cleanup provenance
3. 不在这里改文案与交互

这些分别留给 `Phase 4`、`Phase 5`、`Phase 6`

## 6. 推荐交付物

1. 新的 `foreground_followup` 模型
2. `soft block / hard pause` 状态结构
3. 全局 / 页级 / 线程级状态边界定义
4. 收窄后的全局 conflict pause 写入条件

## 7. 验收标准

1. 单个标签页的局部“本地较新”不再冻结所有标签页。
2. 前台探测命中本地短时差异时，不再直接写全局冲突暂停。
3. 全局 pause 只在真正双边冲突时出现。

## 8. 交给下一阶段的输出

`Phase 4` 会基于这里的 `soft block / hard pause` 模型来重写前台探测和 visible poll。

如果没有先把状态分层，`Phase 4` 很容易只能继续沿用“可见页一报警就全局暂停”的旧结构。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 为自动同步补齐独立的 `foreground_followup` 执行模式，前台 follow-up 不再复用 startup 判定路径。
  - 将“本地较新”判定按执行模式拆开：
    - `startup` 保持 `skip_push_on_startup`
    - `background` 保持 `push`
    - `foreground_followup` 改成 `skip_push_on_foreground_followup`
  - 新增当前标签页运行时 `soft block` 状态，并在帖子页携带 `threadId` / `page` / `readProgress` guard 上下文，明确 tab-local 与 thread-local 边界。
  - 收窄全局 hard pause 写入条件，前台 follow-up 命中的局部 dirty / local newer 不再直接写全局 `conflict_pause`。
  - 同步诊断已能记录 `blocked:soft:<reason>`，为 Phase 4 的 probe gate 继续复用提供状态基础。
- 涉及文件：
  - `S1Plus.js`
  - `scripts/test-safe-sync-execution.js`
  - `scripts/test-foreground-probe-diagnostics-feedback.js`
  - `scripts/test-auto-sync-indicator-linkage.js`
  - `scripts/test-foreground-trigger-integration.js`
- 验证：
  - `node --check S1Plus.js`
  - `node scripts/test-safe-sync-execution.js`
  - `node scripts/test-foreground-probe-diagnostics-feedback.js`
  - `node scripts/test-foreground-remote-probe.js`
  - `node scripts/test-auto-sync-indicator-linkage.js`
  - `node scripts/test-foreground-trigger-integration.js`
  - 说明：`test-foreground-probe-diagnostics-feedback.js` 内含故意触发的 failure-case 日志，用来验证诊断记录，脚本整体通过。
- 剩余工作：
  - 在 `Phase 4` 中把 `soft block` 正式接入 `foreground_resume` / `visible_poll` 的显式门控与延迟重试。
  - 在真实 Tampermonkey 多标签页环境补跑浏览器手测。
- 风险 / 限制：
  - `soft block` 目前是当前标签页运行时状态，不会跨刷新持久化。
  - visible poll 还没有基于 soft block 做更细的降级、重试和 backoff，这部分仍留给 `Phase 4`。
- 下一步：
  - 开始 `Phase 4`，基于本阶段产出的 soft/hard 分层，把前台探测与可见页轮询改成会等待本地状态稳定的 probe 层。
