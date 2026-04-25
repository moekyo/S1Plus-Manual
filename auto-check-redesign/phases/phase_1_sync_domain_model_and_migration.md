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
- 明确三个枚举的运行语义：
  - `off`：不做自动获取云端更新，仍允许手动同步和后台本地推送。
  - `startup`：只表示“启动期自动获取云端更新”，不得替代、补充或重新耦合现有 `syncDailyFirstLoad` / `daily_startup`。
  - `safe_foreground`：允许前台恢复 / 可见页轮询类自动获取，但必须经过 `safe to probe` gate，不恢复旧 `per_load`。
- 明确旧字段到新字段的迁移规则，以及新安装默认值。
- 明确 `syncDeviceId` 的迁移与保留规则：
  - 保留现有字段
  - 继续允许为空
  - 不因为为空而破坏自动同步主流程
- 明确新安装默认值：
  - `自动推送本地改动`：沿用现有后台自动同步默认策略。
  - `自动获取云端更新`：默认 `off`。
  - `同步状态入口`：默认开启。
  - `syncForcePullOnStartup`：默认关闭。
  - `syncDeviceId`：默认空。

#### 旧字段迁移规则

| 旧字段 | 新落点 | 迁移规则 |
| --- | --- | --- |
| `syncPerLoadCheckEnabled` | `自动获取云端更新` | `true` 迁移为 `safe_foreground`，但只作为兼容信号；不得恢复旧 `per_load` / 每次加载检查语义。 |
| `syncCheckOnReturnToForeground` | `自动获取云端更新` | `true` 迁移为 `safe_foreground`，并统一走 foreground / visible poll 的安全 probe gate。 |
| `syncDailyFirstLoad` | 独立的 `daily_startup` 能力 | 保留原值和原能力，不映射到 `自动获取云端更新=startup`，不作为自动获取链路的运行时真相源。 |
| `syncAutoEnabled` | `自动推送本地改动` | 保留原布尔语义；后续只驱动 `local_dirty` intent，不再由调用点直接触发执行器。 |
| `syncForcePullOnStartup` | 显式高级项 | 旧用户保留原值，新安装默认关闭；不能隐藏保留，也不能静默删除。UI 必须可见、可解释、可修改。 |
| `syncShowAutoSyncIndicator` | `同步状态入口` | 迁移为状态入口显示偏好；只影响 UI 展示，不参与同步 payload / contentHash。 |
| `syncDeviceId` | 可选来源归因输入 | 保留原值，允许为空；只增强 writer attribution，不参与 pull / push / conflict 真值判定。 |

当多个旧字段同时存在时，迁移优先级固定为：任一旧自动检查字段为 `true` 时，`自动获取云端更新=safe_foreground`；两者均为 `false` 时，迁移为 `off`。`startup` 不从旧 `daily_startup` 自动迁入，只能来自新 UI 的明确选择或后续显式迁移。

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
- 明确 writer metadata 契约：
  - `lastWriter` 不以 `deviceId` 非空为存在前提。
  - 即使 `deviceId` 为空，也允许写入 `sessionId`、`sourceTabId`、`source`、`mode`、`writtenAt` 等非敏感来源字段。
  - `deviceId` 只增强 same-device 归因精度；缺失时 same-device 归因可以降级，但不能导致主流程退回 freshness-only 判断。
  - same-session 可以依赖本地 `lastLocalSessionRemoteWrite` 辅助判断，但不能假设远端 `lastWriter` 永远可用或永远带有 `deviceId`。

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
- 明确同步 payload / contentHash 边界，后续实现不得继续沿用“除少数凭据外全部进 payload”的模糊策略：

| 类别 | 示例 | 是否进入远端 payload / contentHash | 规则 |
| --- | --- | --- | --- |
| 远端连接凭据 | Gist ID、PAT | 否 | 只保存在本机，不能同步，不能参与 contentHash。 |
| 本机自动策略 | 自动推送、自动获取、`syncForcePullOnStartup` | 否 | 属于本机运行策略，不能跨设备传播，也不能制造远端 hash 变化。 |
| 状态入口偏好 | `syncShowAutoSyncIndicator` / 状态入口开关 | 否 | 只影响当前设备 UI，不进入同步内容。 |
| 安全提醒偏好 | Token 到期提醒、到期日期 | 否 | 属于本机提醒设置，不跨设备同步。 |
| 可跨设备用户内容 | 屏蔽、标签、收藏、阅读进度、标题过滤等业务数据 | 是 | 进入远端 payload，并参与 contentHash。 |
| 来源归因 metadata | `syncMeta.lastWriter`、writer session / tab / optional deviceId | 进入 metadata，不进入业务 contentHash | 用于解释来源，不作为业务数据差异。 |

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
5. 同步 payload / contentHash 边界表
6. 后续阶段共用的命名约定
7. `syncDeviceId` 的可选输入规则与归因职责说明
8. `syncForcePullOnStartup` 的显式高级项迁移说明

## 7. 验收标准

1. 后续实现者不需要再决定“哪个状态该放全局，哪个状态只该放当前页”。
2. 旧设置到新设置的迁移规则是明确的，没有模糊分支。
3. `Phase 2-7` 可以直接复用本阶段定义的模型名称和状态枚举。
4. 不再存在“README、task_plan、phase 文档里对同一概念叫法不同”的问题。
5. `syncDeviceId` 的角色是明确的：保留、可选、参与归因，但不替代哈希/更新时间判定。
6. `syncForcePullOnStartup` 不会变成隐藏遗留状态，也不会被静默删除。
7. 本机策略、凭据、安全提醒和状态入口偏好不会继续进入远端 payload / contentHash。

## 8. 交给下一阶段的输出

`Phase 2` 默认可以直接基于本阶段输出：

- 接收 `SyncIntent`
- 建立协调器
- 约束哪些触发器只允许发 intent，不允许直接同步或直接提示

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 在 `S1Plus.js` 中新增 `syncAutoFetchMode`，固定 `off` / `startup` / `safe_foreground` 三值模型，新安装默认 `off`。
  - 旧 `syncPerLoadCheckEnabled=true` 与 `syncCheckOnReturnToForeground=true` 统一迁移为 `safe_foreground`；`syncPerLoadCheckEnabled` 归一化后不再保持 true，避免恢复旧 `per_load` 运行语义。
  - `syncDailyFirstLoad` 继续作为独立 `daily_startup` 能力保留，不自动映射到 `syncAutoFetchMode=startup`。
  - 落地 `SyncIntent` 类型、固定优先级、协调器状态、tab guard 状态和状态入口 view model 分类常量，供后续阶段复用。
  - 将本机同步策略、远端连接凭据、状态入口偏好、Token 提醒和 `syncDeviceId` 从远端 settings payload / business `contentHash` 中剔除。
  - 调整 `syncMeta.lastWriter` 归一化和写入契约，使 writer metadata 可以在 `deviceId` 为空时保留 session / tab / action / mode / writtenAt 等归因字段。
  - 更新迁移夹具和测试脚本，覆盖新默认值、旧字段迁移、payload 边界、intent 优先级和无 `deviceId` writer metadata。
- 涉及文件：
  - `S1Plus.js`
  - `tests/settings-migration/fixtures.json`
  - `sync-across-multiple-tab/scripts/test-settings-migration.js`
  - `auto-check-redesign/task_plan.md`
  - `auto-check-redesign/progress.md`
  - `auto-check-redesign/phases/phase_1_sync_domain_model_and_migration.md`
- 验证：
  - `node --check S1Plus.js`
  - `node sync-across-multiple-tab/scripts/test-settings-migration.js`
  - `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
  - `node sync-across-multiple-tab/scripts/test-safe-sync-execution.js`
  - `node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
  - `node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js`
  - `node sync-across-multiple-tab/scripts/test-background-open-passive-session.js`
  - `node sync-across-multiple-tab/scripts/test-cleanup-provenance-guard.js`
- 剩余工作：
  - 不接真实触发器、不实现协调器、不重做设置 UI，分别留给 Phase 2、Phase 4 和 Phase 6。
  - 旧设置 UI 仍保留历史三段式文案；现阶段只保证保存 / 归一化落入新模型。
  - 真实论坛页、Tampermonkey、多标签和 bfcache 组合行为仍需后续阶段手测。
- 风险 / 限制：
  - 既有远端 payload 可能仍含旧本机策略字段；新边界会在导入时剔除这些字段，后续 Phase 2-4 需要继续处理由此产生的版本 / reconcile 过渡行为。
  - `startup` 枚举已可作为模型值存在，但当前没有 UI 入口；不得从 `daily_startup` 静默推导。
- 下一步：
  - 等用户明确选择 `Phase 2` 后，基于本阶段输出建立协调器和 intent 流水线。

### 2026-04-25 回归修复补记

- 旧设置迁移路径已改为强制持久化规范化后的 `s1p_settings`：`saveSettings` 支持 `forcePersist`，`migrateLegacySettingsIfNeeded()` 在保持 `suppressSyncTrigger: true` 和 `markDataChangedWhenSuppressed: true` 的同时写回 GM 存储。
- 新增迁移持久化回归：旧 `syncCheckOnReturnToForeground=true` 首次启动后 GM 存储包含 `syncAutoFetchMode: "safe_foreground"`，第二次启动不再触发迁移。
