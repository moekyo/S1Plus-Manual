# Phase 2: 协调器与 Intent 流水线

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. [Phase 1](./phase_1_sync_domain_model_and_migration.md)
5. 本文档

### 强烈建议补读

- [S1Plus.js](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js) 中当前 `performAutoSync`、后台 push 触发、恢复钩子和指示器驱动相关实现

### 选读

- [architecture_principles.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/sync_multitab_redesign/architecture_principles.md)

## 2. 目标

建立统一协调器，让所有自动行为先发 `SyncIntent`，再由协调器根据统一状态做调度和决策，不再允许触发器各自直接同步、直接写状态指示器或直接弹提示。

## 3. 本阶段覆盖的问题

- 当前触发器与执行器耦合，多个入口直接把行为推进到同步或提示层。
- 后台自动推送、每日首次同步、恢复钩子和旧自动检查链路没有被统一到同一个调度模型。
- 导航栏状态指示器和同步执行状态之间缺少单一真相源。

## 4. 本阶段要做成什么样

### 4.1 所有自动入口只发 Intent

- 将以下自动入口统一约束成只发 `SyncIntent`：
  - `local_dirty`
  - `startup_due`
  - `pending_recovery`
  - `foreground_resume`
  - `visible_poll`
- 不允许这些入口再直接：
  - 调 `performAutoSync`
  - 写指示器 phase
  - 弹“远端更新”提示

### 4.2 建立统一调度优先级

- 固定协调器优先级顺序：
  1. `manual_request`
  2. `local_dirty`
  3. `pending_recovery`
  4. `startup_due`
  5. `foreground_resume`
  6. `visible_poll`
- 明确 defer / requeue / skip 的规则。

### 4.3 收口 queue、lease、pause、circuit 的使用方式

- 定义协调器如何读取和写入：
  - queue 摘要
  - 当前共享 lease
  - 全局 hard pause
  - circuit breaker
- 明确这些状态不再由单个触发器任意写入。

### 4.4 定义状态到视图模型的单向映射

- 协调器产出统一状态，视图层只消费 `SyncStatusViewModel`。
- 导航栏入口、toast、诊断面板都不能再维护各自独立真相源。

## 5. 本阶段不要顺手做什么

1. 不在这里细化页面刷新策略。
2. 不在这里重做设置 UI。
3. 不在这里完成远端 probe / reconcile 细节。
4. 不在这里新增复杂用户交互文案。

## 6. 推荐交付物

1. `SyncIntent` 入口与消费流程
2. 协调器优先级与调度规则
3. queue / lease / pause / circuit 的统一使用约束
4. 状态到 `SyncStatusViewModel` 的单向映射关系

## 7. 验收标准

1. 触发器不再直接驱动同步执行或用户反馈。
2. 协调器成为自动行为唯一入口，后续阶段不需要再新增第二套调度骨架。
3. 状态展示层有单一上游，不再同时读多套 phase / reason。
4. 后台自动推送、恢复、前台探测类入口可以共用同一套优先级和 defer 语义。

## 8. 交给下一阶段的输出

`Phase 3` 可以直接基于本阶段输出，把后台自动推送纳入协调器，改造成共用 lease 和 queue 的标准路径。

## 9. 执行进度

- 状态：`Not Started`
- 本轮完成：
  - 暂无，本阶段尚未开始。
- 涉及文件：
  - 暂无
- 验证：
  - 暂无
- 剩余工作：
  - 完成统一协调器、intent 流水线和状态映射的规格与实现。
- 风险 / 限制：
  - 若本阶段没有真正切断触发器直连执行器的路径，后续阶段仍会继续叠加旁路逻辑。
- 下一步：
  - 把自动入口改成 intent-first，并固定协调器优先级与统一调度模型。
