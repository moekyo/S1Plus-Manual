# Phase 4: 安全自动拉取、Probe 与 Reconcile

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. [Phase 1](./phase_1_sync_domain_model_and_migration.md)
5. [Phase 2](./phase_2_sync_coordinator_and_intent_pipeline.md)
6. [Phase 3](./phase_3_auto_push_and_shared_lease.md)
7. 本文档

### 强烈建议补读

- [same-device-unexpected-remote-update-findings-and-fix-plan.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/same-device-unexpected-remote-update-findings-and-fix-plan.md)
- [architecture_principles.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/sync_multitab_redesign/architecture_principles.md)

### 选读

- [S1Plus.js](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js) 中当前 startup、恢复钩子、same-session / same-device 相关实现

## 2. 目标

重建自动获取云端更新的核心链路，采用 `probe -> reconcile -> apply` 三段式，并确保前台恢复、visible poll、启动期获取都先经过页面安全检查和本地状态收敛。

## 3. 本阶段覆盖的问题

- 旧自动检查链路把 freshness 检查、同步决策、页面提示和用户打扰混在一起。
- `updated_at` 变化被过度解释，容易把同机其他标签页写入误说成“远端更新”。
- 前台恢复、visible poll、pending recovery 容易在本地状态未稳定时重复暴露旧状态。

## 4. 本阶段要做成什么样

### 4.1 统一进入 `probe -> reconcile -> apply`

- `probe` 只负责 freshness 观察，不做最终同步判定。
- `reconcile` 负责在最新本地状态和最新远端状态之间做 pull / push / merge / conflict 判定。
- `apply` 才负责把同步结果真正反映到当前页面和状态入口。

### 4.2 进入 probe 前先过 `safe to probe`

- 明确当前页哪些情况下只能 defer，而不能 probe：
  - pending write
  - debounce
  - dirty settings modal
  - 仍在阅读中的 thread page
  - 尚未稳定的后台恢复状态
- 这些情况只能形成 `tab-local defer`，不能直接升级成全局冲突。

### 4.3 覆盖三类自动获取来源

- `startup_due`
- `foreground_resume`
- `visible_poll`

三类入口都必须共用：

- freshness 观察语义
- defer 语义
- same-session / same-device 分类
- reconcile 入口

### 4.4 降低对 `updated_at` 的过度解释

- `updated_at` 只能当 freshness hint。
- 只有在 reconcile 后，系统才能决定：
  - 无变化
  - 安全可拉取
  - 可自动 merge
  - 需要人工处理

### 4.5 同机会话与同设备识别成为一等公民

- 明确 same-session、same-device、cross-device 三类结果如何分类和展示。
- 同设备写入不能再被默认解释为“外部远端变化”。
- 分类所依赖的输入必须明确：
  - `remoteUpdatedAt`
  - `lastWriter`
  - `sessionId`
  - `sourceTabId`
  - 可选 `deviceId`
- 当 `deviceId` 缺失时，same-device 分类允许失效，但主流程必须优雅退化，不能因此回退到“凡是 freshness 命中就外部变化”的旧设计。

### 4.6 明确 `deviceId` 只做归因，不做真值判定

- `deviceId` 只能帮助解释“这次远端写入更像是谁造成的”。
- 是否真的需要 pull / merge / conflict，仍然必须由：
  - 最新本地状态
  - `contentHash`
  - `baseContentHash`
  - `updated_at`
  一起决定。
- 不允许出现“因为 `deviceId` 不同，所以默认认为一定需要拉取”这种捷径判断。

## 5. 本阶段不要顺手做什么

1. 不在这里敲定最终页面刷新文案。
2. 不在这里重做设置 UI。
3. 不在这里升级导航状态入口交互细节。

## 6. 推荐交付物

1. `probe -> reconcile -> apply` 主链路
2. `safe to probe` 条件与 `tab-local defer` 规则
3. `startup_due` / `foreground_resume` / `visible_poll` 的统一入口
4. same-session / same-device / cross-device 结果分类
5. `deviceId` 缺失时的优雅退化策略

## 7. 验收标准

1. freshness 检查不会再直接触发高打扰反馈。
2. 同机其他标签页导致的远端变化，不再被误说成“外部远端更新”。
3. 页面本地未稳定时会 defer，而不是先 probe 再放大旧状态。
4. 前台恢复、visible poll 和启动期获取在语义上收敛到同一套自动获取模型。
5. `deviceId` 配置与否，只影响归因精度，不影响主同步判定的正确性。

## 8. 交给下一阶段的输出

`Phase 5` 默认可以基于本阶段结果，专注“sync result 如何应用到不同类型页面”，而不用再回头定义 freshness 或 reconcile 语义。

## 9. 执行进度

- 状态：`Not Started`
- 本轮完成：
  - 暂无，本阶段尚未开始。
- 涉及文件：
  - 暂无
- 验证：
  - 暂无
- 剩余工作：
  - 完成新的自动获取主链路、defer 规则和结果分类。
- 风险 / 限制：
  - 若 probe 与 reconcile 仍然没有明确分层，旧的误报与误拉取问题会以新形式继续出现。
- 下一步：
  - 先把 `safe to probe` 条件和 `probe -> reconcile -> apply` 主链路固定下来。
