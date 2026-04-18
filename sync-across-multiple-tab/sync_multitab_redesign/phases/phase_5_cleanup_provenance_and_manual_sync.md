# Phase 5: cleanup provenance 与手动同步分支重构

## 1. 默认读取集

### 必读

1. [根文档](../../sync_multitab_review_and_redesign.md)
2. 本文档

### 选读

- [problem_catalog.md](../problem_catalog.md)
- [architecture_principles.md](../architecture_principles.md)

## 2. 目标

彻底拆开“自动清理”“手动删除”“cleanup 快捷同步”“普通阅读进度变化”这几类语义，杜绝 cleanup 标记污染后续同步决策。

## 3. 本阶段覆盖的问题

- `3.6.1` 自动清理模式本身没有失效
- `3.6.2` 手动清理与自动清理共用全局标记
- `3.6.3` 删除别的帖子也会污染当前帖子的处理流程
- `3.6.4` cleanup 快捷分支前提过于宽松
- `3.6.5` cleanup 文案把手动删除说成自动清理
- `3.5.4` 多标签页红提示与 cleanup 快捷分支可能串联
- `8.4` 删除别的帖子阅读记录，不应污染当前页的处理语义

## 4. 本阶段要做成什么样

### 4.1 用结构化对象替换 `s1p_pending_cleanup_info`

至少记录：

- `source`
- `cleanupModeAtCreation`
- `createdAt`
- `deletedCount`
- `threadIds`
- `initiatedFromThreadId`
- `basisHashBefore`
- `basisHashAfter`

### 4.2 cleanup shortcut 必须有严格 guard

至少同时验证：

1. 来源合法
2. cleanup 创建时的基础哈希与当前差异匹配
3. 当前差异确实由这次 cleanup 导致
4. 记录仍未过期

### 4.3 cleanup provenance 与当前触发根因不一致时，不允许强行改写叙事

例如：

- 当前页红提示来自多标签页前台探测
- 但 cleanup provenance 来自别的帖子之前的手动删除

此时：

- 不允许 cleanup 快捷分支覆盖原始触发根因

### 4.4 区分内部语义和后续文案语义

本阶段先把内部状态和分支判定做对：

- 自动清理
- 手动单条删除
- 手动分组删除

真正的最终提示文案细化放到 `Phase 6`

## 5. 本阶段不要顺手做什么

1. 不在这里重写导航栏提示和 preflight 交互
2. 不在这里做完整诊断体系

## 6. 推荐交付物

1. 新的 cleanup provenance 数据结构
2. 新的 cleanup shortcut guard
3. cleanup 来源判定与消费规则
4. 防止 unrelated cleanup 污染当前处理流程的约束

## 7. 验收标准

1. 手动删除的阅读记录不再被内部逻辑当成“自动清理”。
2. 删除别的帖子阅读记录，不再污染当前页的处理语义。
3. 普通阅读进度变化不会再被 cleanup shortcut 误吃掉。
4. cleanup provenance 与当前触发根因不一致时，原始根因仍能保留。

## 8. 交给下一阶段的输出

`Phase 6` 会基于这里已经成立的 provenance 与 guard，去设计真正不会误导用户的交互与文案。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 把 `s1p_pending_cleanup_info` 从全局计数升级为结构化 cleanup provenance，并兼容旧数字格式残留值。
  - 自动清理、手动单条删除、手动分组删除现在会分别记录来源、线程范围、创建时模式以及 cleanup 前后 `read_progress` 哈希。
  - 手动同步中的 cleanup shortcut 已改成严格 guard：只有来源合法、未过期、当前线程上下文相关、`baseContentHash` 一致且本地/云端 `read_progress` 哈希分别匹配 cleanup 前后快照时，才允许自动推送。
  - 当前仍有全局 conflict pause 时，cleanup shortcut 不再覆盖原始触发根因；当前线程页与 cleanup 涉及线程不相关时，也不会再误走 cleanup shortcut。
  - 对比弹窗和 cleanup shortcut 的提示已按来源区分自动清理与手动删除，避免继续把手动删除说成自动清理。
- 涉及文件：
  - `S1Plus.js`
  - `scripts/test-cleanup-provenance-guard.js`
- 验证：
  - `node --check S1Plus.js`
  - `node scripts/test-cleanup-provenance-guard.js`
  - `node scripts/test-safe-sync-execution.js`
  - `node scripts/test-foreground-probe-gate-retry.js`
  - `node scripts/test-auto-sync-indicator-linkage.js`
  - 说明：当前环境仍无法直接完成 Tampermonkey 浏览器内多标签手测，以上验证以语法检查与本地脚本回归为主。
- 剩余工作：
  - 在真实论坛页面补跑多标签手测，确认“当前线程页点处理”“删别的帖子阅读记录后再手动同步”“自动清理后延迟再同步”等场景体验符合预期。
  - 进入 `Phase 6`，继续重写导航栏“处理”、对比弹窗和常驻提示的最终交互与文案。
- 风险 / 限制：
  - 目前对 cleanup 与原始冲突根因的并列呈现还是最小实现，完整的用户可读交互仍留给 `Phase 6`。
  - cleanup shortcut 现在会更保守：命中 conflict pause、无关线程上下文或 cleanup 之后又出现新的阅读进度变化时，会退回常规手动同步决策。
- 下一步：
  - 开始 `Phase 6`，把 cleanup provenance 和原始触发根因在 UI 中并列呈现，而不是互相覆盖。
