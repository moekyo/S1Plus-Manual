# Phase 1: 领域模型与设置迁移

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. 本文档

### 强烈建议补读

- [DEVELOPMENT.md](/Users/rexxin/Development/S1Plus-Manual/DEVELOPMENT.md)
- [same-device-unexpected-remote-update-findings-and-fix-plan.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/same-device-unexpected-remote-update-findings-and-fix-plan.md)

### 选读

- [S1Plus.js](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js) 中当前 settings 归一化、默认值和同步入口相关实现

## 2. 目标

定义新自动同步架构的领域模型、状态边界、设置迁移目标和兼容边界，让后续所有阶段都基于同一套术语、同一套状态分层和同一套旧字段迁移规则推进。

## 3. 本阶段覆盖的问题

- 旧自动检查链路的设置语义分散，用户面与运行时面不一致。
- 自动同步、自动获取、状态指示器缺少统一的领域模型。
- 旧字段仍然存在，但已经不能再作为新架构的直接驱动入口。
- 没有先定义清楚“全局状态 / 标签页状态 / 业务 provenance”的边界，后续实现容易再次耦合。

## 4. 本阶段要做成什么样

### 4.1 定义新的用户设置模型

- 明确新用户设置面只保留三项主配置：
  - `自动推送本地改动`
  - `自动获取云端更新`
  - `同步状态入口`
- 保留一个高级可选输入项：
  - `设备 ID`
- 明确 `自动获取云端更新` 的枚举值为：
  - `off`
  - `startup`
  - `safe_foreground`
- 明确旧字段到新字段的迁移规则，以及新安装默认值。
- 明确 `syncDeviceId` 的迁移与保留规则：
  - 保留现有字段
  - 继续允许为空
  - 不因为为空而破坏自动同步主流程

### 4.2 定义新的内部领域模型

- 固定并解释以下内部模型：
  - `SyncIntent`
  - `SyncCoordinatorState`
  - `SyncTabGuardState`
  - `SyncStatusViewModel`
- 定义“来源归因”所依赖的最小元数据组合：
  - `sessionId`
  - `sourceTabId`
  - 可选 `deviceId`
  - `lastWriter`
- 明确每个模型的职责、核心字段、生命周期和读写边界。

### 4.3 固定状态分层和兼容边界

- 明确哪些状态属于：
  - 全局持久化状态
  - 标签页本地状态
  - 线程 / 业务 provenance
- 明确旧字段仍保留的范围：
  - 仅迁移
  - 仅兼容回填
  - 不再作为运行时真相源
- 明确 `syncDeviceId` 的特殊角色：
  - 属于用户设置层输入
  - 会进入 writer metadata
  - 只用于来源归因
  - 不参与单独的 pull / push / conflict 真值判定

### 4.4 为后续阶段输出统一命名

- 为后续阶段固定 intent 名称、状态枚举和主要结果分类。
- 避免 `Phase 2-7` 再各自重新发明状态名和原因名。

## 5. 本阶段不要顺手做什么

1. 不在这里接线真实触发器。
2. 不在这里重写导航栏入口。
3. 不在这里重做设置 UI。
4. 不在这里实现 `probe -> reconcile -> apply` 的具体代码。

## 6. 推荐交付物

1. 新 settings 模型与默认值说明
2. 内部四类核心模型定义
3. 旧字段迁移规则表
4. 全局状态 / tab 状态 / provenance 分层约束
5. 后续阶段共用的命名约定
6. `syncDeviceId` 的可选输入规则与归因职责说明

## 7. 验收标准

1. 后续实现者不需要再决定“哪个状态该放全局，哪个状态只该放当前页”。
2. 旧设置到新设置的迁移规则是明确的，没有模糊分支。
3. `Phase 2-7` 可以直接复用本阶段定义的模型名称和状态枚举。
4. 不再存在“README、task_plan、phase 文档里对同一概念叫法不同”的问题。
5. `syncDeviceId` 的角色是明确的：保留、可选、参与归因，但不替代哈希/更新时间判定。

## 8. 交给下一阶段的输出

`Phase 2` 默认可以直接基于本阶段输出：

- 接收 `SyncIntent`
- 建立协调器
- 约束哪些触发器只允许发 intent，不允许直接同步或直接提示

## 9. 执行进度

- 状态：`Not Started`
- 本轮完成：
  - 暂无，本阶段尚未开始。
- 涉及文件：
  - 暂无
- 验证：
  - 暂无
- 剩余工作：
  - 完成本阶段全部领域模型、设置迁移和兼容边界规格。
- 风险 / 限制：
  - 若本阶段命名和边界定不清，后续所有阶段都容易再次出现职责漂移。
- 下一步：
  - 定义新 settings 模型、内部领域模型和旧字段迁移契约。
