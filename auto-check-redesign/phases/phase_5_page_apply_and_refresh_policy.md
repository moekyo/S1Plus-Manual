# Phase 5: 页面应用与刷新策略

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. [Phase 4](./phase_4_safe_auto_pull_probe_and_reconcile.md)
5. 本文档

### 强烈建议补读

- [S1Plus.js](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js) 中当前 auto pull refresh policy、thread/list 页面判定和 dirty modal 保护相关实现

### 选读

- [background-open-unexpected-remote-update-investigation.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/background-open-unexpected-remote-update-investigation.md)

## 2. 目标

把同步结果如何应用到页面，以及何时刷新页面，统一成保守策略，优先保护阅读体验、未保存编辑和当前页本地稳定性。

## 3. 本阶段覆盖的问题

- 即使同步判定是正确的，页面应用策略如果太激进，也会制造“打断阅读”“突然刷新”“用户感觉不可信”的问题。
- thread/list/generic 页面当前采用的策略不够统一，也还混杂了旧自动检查链路遗留语义。
- dirty settings modal、阅读中的 thread page、只涉及 read_progress 的 merge，这些场景需要比普通页面更保守。

## 4. 本阶段要做成什么样

### 4.1 固定页面分类

- 明确页面只分三类：
  - `thread`
  - `list`
  - `generic`
- 不再让每条同步路径各自推断是否应该刷新。

### 4.2 把页面应用策略收敛为少数稳定结果

- 自动同步结果应用到页面时，只允许少数几种明确策略：
  - 静默应用
  - 延后处理
  - soft prompt
  - 自动刷新
  - 强制转手动处理

### 4.3 保护 thread page 与阅读会话

- thread page 默认不因为 freshness 命中就直接自动刷新。
- 正在阅读、仍有 pending write / debounce、或刚从后台恢复的 thread page，应优先 defer 或 soft prompt。

### 4.4 保护 dirty settings modal

- 设置弹窗存在未保存编辑时，不允许自动刷新页面。
- 这类保护属于当前页 `tab-local guard`，不应升级成全局冲突或全局暂停。

### 4.5 明确 read_progress 自动 merge 的页面行为

- 只涉及 read_progress 的自动 merge，在页面上如何呈现必须固定下来：
  - 哪些页面静默处理
  - 哪些页面只做轻量提示
  - 哪些页面允许延后再应用

## 5. 本阶段不要顺手做什么

1. 不在这里重做导航栏统一状态入口。
2. 不在这里扩展大量诊断字段。
3. 不在这里重新定义 settings 模型。

## 6. 推荐交付物

1. thread / list / generic 三类页面的固定策略表
2. 页面应用结果枚举
3. dirty settings modal 与阅读会话保护规则
4. read_progress merge 的页面行为约束

## 7. 验收标准

1. thread page 不再被自动同步轻易打断。
2. list/generic 页面在安全条件满足时仍能平滑追平，不会变成“全都只能手动处理”。
3. dirty settings modal 保护是稳定规则，不再是零散调用点判断。
4. 页面应用策略不再依赖触发来源分支，而是依赖统一的 sync result 和 page context。

## 8. 交给下一阶段的输出

`Phase 6` 可以在本阶段固定的页面行为和状态结果之上，设计设置 UI 和统一状态入口，而不用再次讨论 thread/list 页面如何处理。

## 9. 执行进度

- 状态：`Not Started`
- 本轮完成：
  - 暂无，本阶段尚未开始。
- 涉及文件：
  - 暂无
- 验证：
  - 暂无
- 剩余工作：
  - 固定页面分类、页面应用策略和用户打扰边界。
- 风险 / 限制：
  - 若本阶段策略不够收口，后续 UI 文案和状态入口会重新被页面分支牵着走。
- 下一步：
  - 先定义 thread / list / generic 三类页面的统一处理表。
