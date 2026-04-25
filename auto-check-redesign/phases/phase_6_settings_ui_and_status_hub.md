# Phase 6: 设置 UI 与统一状态入口

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. [Phase 1](./phase_1_sync_domain_model_and_migration.md)
5. [Phase 5](./phase_5_page_apply_and_refresh_policy.md)
6. 本文档

### 强烈建议补读

- [S1Plus.js](/Users/rexxin/Development/S1Plus-Manual/S1Plus.js) 中当前同步设置页、导航栏状态指示器和手动同步交互

### 选读

- [DEVELOPMENT.md](/Users/rexxin/Development/S1Plus-Manual/DEVELOPMENT.md)

## 2. 目标

重做同步设置区，并把导航栏自动同步指示器升级为统一状态入口，让用户面对的是清晰的同步模型，而不是旧时代零碎开关和来源文案的残留组合。

## 3. 本阶段覆盖的问题

- 旧设置区中的“每日首次同步”“每次加载检查”“回到前台检查”“后台自动同步”在用户心智上已经过于分散。
- 导航栏指示器过去更像轻量状态灯，难以承接“当前为什么没有自动处理”“下一步应该怎么做”。
- 手动同步虽然是最终裁决入口，但目前并没有被明确置于新的统一状态体系里。

## 4. 本阶段要做成什么样

### 4.1 重做同步设置区

- 以新三项模型重建“自动行为”设置区：
  - `自动推送本地改动`
  - `自动获取云端更新`
  - `同步状态入口`
- 保留一个高级可选输入项：
  - `设备 ID`
- `设备 ID` 的文案必须明确说明：
  - 可选
  - 用于区分同设备写入与外部设备写入
  - 不会单独改变同步结果
- 让用户设置和运行时语义一一对应。
- 明确三项主模型只管理自动同步行为，不吞掉远程同步配置区里的非自动同步配置。以下能力必须继续保留，并在 UI 中有清晰位置：
  - Gist ID。
  - GitHub PAT。
  - Token 到期提醒与到期日期。
  - 收藏完整正文同步。
  - 手动同步高级模式 / 直接选择模式。
  - 手动同步入口及其强制推送、强制拉取、高级选择流程。
- 这些非自动同步配置不属于三项主模型的一部分，不能因为设置区重做而被删除、隐藏或弱化。

### 4.2 统一迁移后的展示与解释

- 旧设置迁移到新模型后，界面必须能清楚解释当前处于哪种策略。
- 避免用户看到新 UI 时仍然需要理解旧 `per_load` / `foreground` 概念。

### 4.3 把导航栏指示器升级成统一状态入口

- 状态入口不再只是展示 phase，而要承接：
  - 当前全局状态
  - 当前主要原因
  - 当前允许的动作
- 入口状态收敛为稳定枚举，例如：
  - `idle`
  - `queued_push`
  - `probing`
  - `syncing`
  - `applied`
  - `deferred_local_busy`
  - `conflict_manual`
  - `paused_failure`

### 4.4 明确状态到动作的映射

- 每个状态都要明确：
  - 文案
  - 二级说明
  - 是否显示动作按钮
  - 动作按钮做什么
- 手动同步必须作为“最终处理入口”被明确承接，而不是隐藏在旧逻辑里。

## 5. 本阶段不要顺手做什么

1. 不在这里补大量诊断字段。
2. 不在这里重写同步主流程。
3. 不在这里继续扩展更多用户可见策略枚举。

## 6. 推荐交付物

1. 新同步设置区结构与迁移后的展示规则
2. 统一状态入口的状态枚举与交互规格
3. 状态到动作映射表
4. 手动同步在新架构中的统一入口说明
5. 可选 `设备 ID` 的展示、说明和保存规则
6. 非自动同步配置的保留清单与 UI 分区说明

## 7. 验收标准

1. 用户无需理解旧自动检查概念，也能知道当前自动同步的主要行为模式。
2. 导航栏入口能解释“为什么现在没自动处理”和“下一步能做什么”。
3. 手动同步作为最终裁决入口，在 UI 上是显式的，而不是暗知识。
4. 设置区和状态入口使用同一套核心术语，不再各说各话。
5. 用户能理解 `设备 ID` 是可选归因输入，而不是必须填写的同步主开关。
6. Gist ID、PAT、Token 到期提醒、收藏完整正文同步和手动同步高级模式在设置区重做后仍可见、可配置。
7. 三项主模型只影响自动行为，不改变连接配置、凭据、安全提醒和手动同步能力的职责边界。

## 8. 交给下一阶段的输出

`Phase 7` 可以在本阶段固定的状态枚举和用户入口上，补充诊断字段与回归矩阵，而不用再改用户面主结构。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 在 `S1Plus.js` 中将同步设置区重分为三项主模型：`自动推送本地改动`、`自动获取云端更新`、`同步状态入口`。
  - 将 `自动获取云端更新` UI 固定为 `off` / `startup` / `safe_foreground`，不再向用户暴露旧 `per_load` / `foreground` 选项；旧值仅保留为保存和迁移兼容路径。
  - 保留并明确展示非三项主模型配置：每日首次全量同步、`syncForcePullOnStartup`、设备 ID、Gist ID、PAT、Token 到期提醒、收藏完整正文同步、手动同步高级模式和手动同步入口。
  - 明确设备 ID 为可选归因输入：用于区分同设备写入与外部设备写入，不同步到其他设备，也不单独改变 pull / push / conflict 判断。
  - 新增统一状态入口 view model，固定状态枚举为 `idle` / `queued_push` / `probing` / `syncing` / `applied` / `deferred_local_busy` / `conflict_manual` / `paused_failure`。
  - 将导航栏自动同步指示器升级为可点击状态入口：图标仍展示轻量状态，点击后显示状态、主要原因、来源、当前状态枚举，并在延后 / 冲突 / 暂停 / 待命时提供全局手动同步动作。
  - 更新 `test-sync-settings-ui.js` 和 `test-auto-sync-indicator-linkage.js`，覆盖三项主模型、非自动同步配置保留、状态入口显示条件、状态枚举映射和动作映射。
- 涉及文件：
  - `S1Plus.js`
  - `sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
  - `sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js`
  - `auto-check-redesign/task_plan.md`
  - `auto-check-redesign/progress.md`
  - `auto-check-redesign/notes.md`
  - `auto-check-redesign/phases/phase_6_settings_ui_and_status_hub.md`
- 验证：
  - `node --check S1Plus.js`
  - `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
  - `node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js`
  - `node sync-across-multiple-tab/scripts/test-phase6-interaction-copy.js`
  - `node sync-across-multiple-tab/scripts/test-sync-coordinator-intent-pipeline.js`
  - `node sync-across-multiple-tab/scripts/test-safe-auto-pull-probe-reconcile.js`
  - `node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
  - `node sync-across-multiple-tab/scripts/test-settings-migration.js`
  - `node sync-across-multiple-tab/scripts/test-safe-sync-execution.js`
  - `node sync-across-multiple-tab/scripts/test-background-open-passive-session.js`
  - `node sync-across-multiple-tab/scripts/test-cleanup-provenance-guard.js`
  - `node sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
  - 关键字一致性搜索覆盖 `per_load`、`startup`、`daily_startup`、`syncForcePullOnStartup`、`manual_request`、`pending_recovery`、`payload`、`contentHash`、`pulled`、`Phase 7`。
- 剩余工作：
  - 本阶段不扩展完整诊断矩阵，不新增大量诊断字段；状态入口只展示核心状态、来源、原因和手动处理动作。
  - 真实论坛页、Tampermonkey、多标签、bfcache、导航栏空间较窄和状态入口点击面板的视觉 / 可用性仍需 Phase 7 手测矩阵覆盖。
- 风险 / 限制：
  - 状态入口点击面板属于脚本级实现，当前已通过静态和 hook 测试，但尚未在真实 S1 标准主题 / S1 NUX 主题中完成视觉验收。
  - `每日首次全量同步` 作为独立高级自动同步项保留，仍需在 Phase 7 的用户心智与手测矩阵里确认不会被误解为 `自动获取云端更新=startup`。
- 下一步：
  - 等用户明确选择后进入 `Phase 7`，基于本阶段固定的设置模型和状态入口，整理诊断展示、回归矩阵和真实浏览器手测清单。

### 2026-04-25 回归修复补记

- 自动获取 coordinator intent 完成后会调用统一结果映射 helper，将结果解析到状态入口 resolved phase：success / no-change 显示成功态，manual / conflict 显示人工处理，failure 显示失败，defer / skipped 回到 idle。
- 这样可以避免 `foreground_resume` / `visible_poll` 入队时留下的三点 pending 依赖 90 秒 stale 过期，也避免 `s1p_pending_auto_sync_request` 的兜底把已完成的自动获取继续显示为 pending。
- `自动获取云端更新` 说明段落新增 `s1p-sync-auto-check-desc` 专用类，并把 `margin-top` 调整为 `6px`，覆盖全局说明文本负 margin。
- `test-auto-sync-indicator-linkage.js` 已覆盖自动获取完成后的 success / idle 解析，`test-sync-settings-ui.js` 已覆盖说明段落专用类和间距规则。
