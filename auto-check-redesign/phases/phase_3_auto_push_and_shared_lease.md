# Phase 3: 自动推送与共享 Lease

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. [Phase 1](./phase_1_sync_domain_model_and_migration.md)
5. [Phase 2](./phase_2_sync_coordinator_and_intent_pipeline.md)
6. 本文档

### 强烈建议补读

- [S1Plus.js](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js) 中当前后台自动同步、锁、heartbeat、pending recovery 相关实现

### 选读

- [background-open-unexpected-remote-update-investigation.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/background-open-unexpected-remote-update-investigation.md)

## 2. 目标

把后台自动推送正式纳入协调器，和其他自动行为共用 queue、lease、pause、circuit 语义，避免它继续以旁路形式驱动状态和用户反馈。

## 3. 本阶段覆盖的问题

- 当前后台自动推送是最稳定的自动能力之一，但它与新自动获取、状态入口和恢复逻辑还没有统一调度模型。
- 共享锁和 heartbeat 存在，但使用方式仍偏向“调用点自己管自己的锁”。
- pending recovery 与 background push 的先后关系如果不定义清楚，容易互相打断或重复调度。

## 4. 本阶段要做成什么样

### 4.1 把 `local_dirty` 变成标准协调器路径

- 本地数据变动后，不再直接“触发后台自动同步”，而是先发 `local_dirty intent`。
- 协调器决定何时 drain、何时延后、何时重试。

### 4.2 包装共享 lease / 锁 / heartbeat

- 保留现有锁与 heartbeat 能力，但通过协调器统一申请和释放。
- 约束 lease 只表达“谁拥有当前执行权”，不负责表达局部 tab 状态。

### 4.3 固定 push drain 规则

- 当队列中存在多个本地变更时，明确：
  - 是否合并 drain
  - 如何处理中途再次脏写
  - 什么时候回退到重试
- 不允许再通过指示器或补丁式延迟去兜底 drain 行为。

### 4.4 明确 pending recovery 与 background push 的先后

- 明确 pending recovery 属于比普通 background push 更高优先级的收尾行为。
- 避免“遗留变更刚准备补发，新的 local dirty 又把状态重写”这类竞态。

## 5. 本阶段不要顺手做什么

1. 不在这里重建远端 probe / pull。
2. 不在这里重做页面刷新或 soft prompt 文案。
3. 不在这里升级导航栏状态入口 UI。

## 6. 推荐交付物

1. `local_dirty` 的 intent 化路径
2. shared lease / lock / heartbeat 的协调器包装层
3. push drain 规则与 retry 规则
4. pending recovery 与 background push 的优先级与互斥约束

## 7. 验收标准

1. 后台自动推送和其他自动行为使用同一套调度语义。
2. queue / lease / retry 不再由多个调用点各自重写。
3. pending recovery 与 background push 的关系清晰，不再靠经验判断。
4. 本地脏写优先保护原则在协调器中可观测、可验证。

## 8. 交给下一阶段的输出

`Phase 4` 可以在本阶段已有调度骨架上接入自动获取云端更新，而不用再自建第二套锁、队列和状态入口。

## 9. 执行进度

- 状态：`Not Started`
- 本轮完成：
  - 暂无，本阶段尚未开始。
- 涉及文件：
  - 暂无
- 验证：
  - 暂无
- 剩余工作：
  - 将后台自动推送完全纳入协调器，并规范 shared lease 和 drain 行为。
- 风险 / 限制：
  - 若 background push 仍然保留旁路状态写入，后续自动获取与状态入口仍会出现双轨真相源。
- 下一步：
  - 用协调器重接 `local_dirty` 与 pending recovery 路径。
