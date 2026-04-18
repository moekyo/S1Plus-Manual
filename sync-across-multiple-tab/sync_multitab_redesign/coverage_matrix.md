# S1 Plus 同步重构覆盖矩阵与选读指南

## 1. 文档作用

这份文档解决两个问题：

1. 某个问题 ID 落在哪个阶段
2. 某个用户现象出现时，默认该读哪些文档

如果已经明确要做哪个 phase，通常不用整份读完，只看对应部分即可。

## 2. 问题 ID 到阶段的映射

### 2.1 启动期问题

- `3.1.1` -> `Phase 1`
- `3.1.2` -> `Phase 1`
- `3.1.3` -> `Phase 1`
- `3.1.4` -> `Phase 1`
- `3.1.5` -> `Phase 1`
- `3.1.6` -> `Phase 1`

### 2.2 自动刷新与提示语义

- `3.2.1` -> `Phase 6`, `Phase 7`
- `3.2.2` -> `Phase 7`

### 2.3 前台探测与可见页轮询

- `3.3.1` -> `Phase 3`, `Phase 4`
- `3.3.2` -> `Phase 4`
- `3.3.3` -> `Phase 4`, `Phase 6`
- `3.3.4` -> `Phase 2`, `Phase 4`

### 2.4 阅读进度写入问题

- `3.4.1` -> `Phase 2`
- `3.4.2` -> `Phase 2`
- `3.4.3` -> `Phase 2`
- `3.4.4` -> `Phase 2`
- `3.4.5` -> `Phase 2`

### 2.5 多标签页协作问题

- `3.5.1` -> `Phase 3`
- `3.5.2` -> `Phase 3`
- `3.5.3` -> `Phase 4`
- `3.5.4` -> `Phase 5`, `Phase 6`

### 2.6 cleanup 与手动同步语义

- `3.6.1` -> `Phase 5`
- `3.6.2` -> `Phase 5`
- `3.6.3` -> `Phase 5`
- `3.6.4` -> `Phase 5`
- `3.6.5` -> `Phase 5`, `Phase 6`
- `3.6.6` -> `Phase 6`

### 2.7 多标签专项要求

- `8.1` -> `Phase 2`
- `8.2` -> `Phase 3`
- `8.3` -> `Phase 3`, `Phase 4`
- `8.4` -> `Phase 5`, `Phase 6`
- `8.5` -> `Phase 7`

## 3. 现象到阶段的反查

### 3.1 “早上第一次打开没触发，过几分钟才突然刷新”

默认读：

1. [根文档](../sync_multitab_review_and_redesign.md)
2. [Phase 1](./phases/phase_1_startup_and_trigger_model.md)

必要时补读：

- [problem_catalog.md](./problem_catalog.md) 里的 `3.1.x`

### 3.2 “页面开了很久，突然提示云端有更新并刷新”

默认读：

1. [根文档](../sync_multitab_review_and_redesign.md)
2. [Phase 1](./phases/phase_1_startup_and_trigger_model.md)
3. [Phase 4](./phases/phase_4_foreground_probe_and_visible_poll.md)

必要时补读：

- [architecture_principles.md](./architecture_principles.md) 里的启动期模型和前台探测原则

### 3.3 “后台打开多个帖子，只看其中一个，3 到 5 分钟后出现红色提示”

默认读：

1. [根文档](../sync_multitab_review_and_redesign.md)
2. [Phase 2](./phases/phase_2_read_progress_denoising.md)
3. [Phase 4](./phases/phase_4_foreground_probe_and_visible_poll.md)

如果涉及“一个页影响所有页”，再补读：

- [Phase 3](./phases/phase_3_sync_state_layering.md)

### 3.4 “点了导航栏处理后，怎么变成自动清理完成了”

默认读：

1. [根文档](../sync_multitab_review_and_redesign.md)
2. [Phase 5](./phases/phase_5_cleanup_provenance_and_manual_sync.md)
3. [Phase 6](./phases/phase_6_interaction_and_copy.md)

### 3.5 “删除的是别的帖子，为什么污染了当前帖子的处理流程”

默认读：

1. [根文档](../sync_multitab_review_and_redesign.md)
2. [Phase 5](./phases/phase_5_cleanup_provenance_and_manual_sync.md)
3. [Phase 6](./phases/phase_6_interaction_and_copy.md)

### 3.6 “为什么明明没做什么操作，也说本地有未处理改动”

默认读：

1. [根文档](../sync_multitab_review_and_redesign.md)
2. [Phase 2](./phases/phase_2_read_progress_denoising.md)
3. [Phase 4](./phases/phase_4_foreground_probe_and_visible_poll.md)

如果涉及多标签全局冻结，再补读：

- [Phase 3](./phases/phase_3_sync_state_layering.md)

## 4. 每个阶段默认应该读什么

### Phase 1

- 必读：
  - [根文档](../sync_multitab_review_and_redesign.md)
  - [Phase 1](./phases/phase_1_startup_and_trigger_model.md)
- 选读：
  - [problem_catalog.md](./problem_catalog.md)
  - [architecture_principles.md](./architecture_principles.md)

### Phase 2

- 必读：
  - [根文档](../sync_multitab_review_and_redesign.md)
  - [Phase 2](./phases/phase_2_read_progress_denoising.md)
- 选读：
  - [problem_catalog.md](./problem_catalog.md)
  - [architecture_principles.md](./architecture_principles.md)

### Phase 3

- 必读：
  - [根文档](../sync_multitab_review_and_redesign.md)
  - [Phase 3](./phases/phase_3_sync_state_layering.md)
- 选读：
  - [architecture_principles.md](./architecture_principles.md)

### Phase 4

- 必读：
  - [根文档](../sync_multitab_review_and_redesign.md)
  - [Phase 4](./phases/phase_4_foreground_probe_and_visible_poll.md)
- 选读：
  - [Phase 2](./phases/phase_2_read_progress_denoising.md)
  - [Phase 3](./phases/phase_3_sync_state_layering.md)
  - [architecture_principles.md](./architecture_principles.md)

### Phase 5

- 必读：
  - [根文档](../sync_multitab_review_and_redesign.md)
  - [Phase 5](./phases/phase_5_cleanup_provenance_and_manual_sync.md)
- 选读：
  - [architecture_principles.md](./architecture_principles.md)
  - [problem_catalog.md](./problem_catalog.md)

### Phase 6

- 必读：
  - [根文档](../sync_multitab_review_and_redesign.md)
  - [Phase 6](./phases/phase_6_interaction_and_copy.md)
- 选读：
  - [Phase 5](./phases/phase_5_cleanup_provenance_and_manual_sync.md)
  - [architecture_principles.md](./architecture_principles.md)

### Phase 7

- 必读：
  - [根文档](../sync_multitab_review_and_redesign.md)
  - [Phase 7](./phases/phase_7_diagnostics_and_regression.md)
- 选读：
  - [problem_catalog.md](./problem_catalog.md)
  - [architecture_principles.md](./architecture_principles.md)

## 5. 依赖顺序

推荐顺序仍然是：

1. `Phase 1`
2. `Phase 2`
3. `Phase 3`
4. `Phase 4`
5. `Phase 5`
6. `Phase 6`
7. `Phase 7`

原因：

1. 先把触发源和启动期边界收口。
2. 再切断假本地改动的来源。
3. 再拆分全局状态与页级状态。
4. 然后重写前台探测与 visible poll 的策略。
5. 再重做 cleanup provenance 与手动同步分支。
6. 最后做交互文案和诊断体系，避免在不稳定状态模型上先改 UI。

## 6. 使用建议

如果后续让 AI 执行某个 phase，建议直接提供：

1. [根文档](../sync_multitab_review_and_redesign.md)
2. 对应 phase 文档

只有在它明确遇到跨阶段依赖时，再补这份覆盖矩阵或参考文档。
