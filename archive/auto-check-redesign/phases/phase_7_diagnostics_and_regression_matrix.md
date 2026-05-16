# Phase 7: 诊断与回归矩阵

## 1. 默认读取集

### 必读

1. [README.md](../README.md)
2. [task_plan.md](../task_plan.md)
3. [notes.md](../notes.md)
4. [Phase 2](./phase_2_sync_coordinator_and_intent_pipeline.md)
5. [Phase 4](./phase_4_safe_auto_pull_probe_and_reconcile.md)
6. [Phase 6](./phase_6_settings_ui_and_status_hub.md)
7. 本文档

### 强烈建议补读

- [Phase 7 旧文档](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/sync_multitab_redesign/phases/phase_7_diagnostics_and_regression.md)
- [same-device-unexpected-remote-update-findings-and-fix-plan.md](/Users/rexxin/Development/S1Plus-Manual/sync-across-multiple-tab/same-device-unexpected-remote-update-findings-and-fix-plan.md)

### 选读

- 现有 `sync-across-multiple-tab/scripts/` 下仍保留的测试脚本与验证思路

## 2. 目标

让新自动同步架构可观测、可解释、可回归，避免未来再次回到“只能凭用户体感追问题，再打一层补丁”的模式。

## 3. 本阶段覆盖的问题

- 旧系统即使补了很多诊断，也仍然存在“根因分散、语义混杂、难以快速判断是哪个层级出的问题”。
- 多设备、多标签、同机多标签这三类场景容易互相混淆，没有固定回归矩阵就会再次遗漏。
- 新统一状态入口如果没有足够的下层诊断支撑，也很容易再次退化成模糊状态灯。

## 4. 本阶段要做成什么样

### 4.0 诊断落地节奏

`Phase 7` 不是所有诊断字段的首次落地点。最低诊断字段必须随前面阶段一起实现：

- `Phase 2`：last intent、intent source、priority、defer / skip reason、lease owner、queue summary。
- `Phase 4`：last probe freshness、local snapshot hash、remote contentHash、writer attribution、reconcile result、allowed action。
- `Phase 5`：page type、apply policy、refresh decision、blocked reason。

本阶段只负责把这些事实源整理成统一展示、补齐扩展字段，并建立固定回归矩阵。

### 4.1 重做诊断字段

- 诊断必须覆盖：
  - 最近 intent
  - intent 被 defer / skip 的原因
  - 最近 probe 结果
  - 最近 reconcile 结果
  - 最近 apply 结果
  - 当前 global pause / circuit / lease 摘要
  - 当前 tab guard 状态
  - 本地 `deviceId`、远端 writer `deviceId` 和最终归因等级

### 4.2 让状态入口与诊断共用同一事实来源

- 导航栏统一状态入口展示的是诊断上游的摘要，而不是平行生成的一套状态。
- 避免“状态入口显示 A，诊断面板显示 B”的漂移。

### 4.3 建立固定回归矩阵

- 至少覆盖三大类：
  - 多设备
  - 多标签
  - 同机不同标签
- 每类都要覆盖：
  - 正常路径
  - defer 路径
  - 冲突路径
  - 恢复路径
- 回归矩阵中还必须显式覆盖：
  - 配置了 `deviceId`
  - 未配置 `deviceId`
  两种模式

### 4.4 建立真实浏览器手测清单

- 把必须在真实论坛页面验证的场景单独列清楚：
  - thread page 长时间阅读
  - 后台开多个帖子
  - bfcache 恢复
  - visible poll
  - same-device remote write
  - dirty settings modal

## 5. 本阶段不要顺手做什么

1. 不在这里回头改架构主流程，除非验证已经明确暴露 blocker。
2. 不在这里重新发明新的用户面概念。
3. 不在这里把所有历史脚本无差别搬回新体系。

## 6. 推荐交付物

1. 新诊断字段与摘要模型
2. 状态入口和诊断共用事实源的约束
3. 多设备 / 多标签 / 同机不同标签回归矩阵
4. 真实浏览器手测清单
5. `deviceId` 有无配置时的归因与提示校验项
6. Phase 2 / 4 / 5 最低诊断字段的展示整合

## 7. 验收标准

1. 诊断能明确区分 intent、probe、reconcile、apply 四个层级的问题。
2. 状态入口和诊断使用同一套事实源，不再互相漂移。
3. 多设备、多标签、同机不同标签都有固定回归表，不再靠零散复现。
4. 新架构未来再出问题时，能优先靠观测和矩阵定位，而不是先猜再补丁。
5. `deviceId` 配置与否都能被诊断和回归明确覆盖，不会形成新的隐性分叉。
6. 早期阶段已经产生的最低诊断字段不会在本阶段被重命名成另一套平行概念。

## 8. 交给下一阶段的输出

- 本阶段是这套重构文档体系中的最后一个实现阶段。
- 若后续仍有延伸工作，应以本阶段产出的诊断与回归基线为出发点，而不是重新发散出新的补丁链路。

## 8.1 本阶段交付物

- 代码侧新增统一诊断事实快照 `buildSyncDiagnosticsFactSnapshot(...)`，把状态入口、诊断面板和复制诊断统一到 intent / probe / reconcile / apply / runtime / attribution 六层事实源。
- 状态入口 view model 新增 `diagnosticSummary`，点击面板显示与诊断面板同源的 intent、reconcile、tab guard 摘要，避免状态入口与诊断输出漂移。
- 诊断面板和复制诊断新增顶部摘要行：状态入口摘要、诊断层级覆盖、全局保护、当前 Tab Guard、归因摘要。
- 新增 [regression_matrix.md](../regression_matrix.md)，固定多设备 / 多标签 / 同机不同标签矩阵，并显式要求配置 `deviceId` 与未配置 `deviceId` 两种模式都覆盖。
- 新增脚本 `sync-across-multiple-tab/scripts/test-phase7-diagnostics-regression-matrix.js`，验证统一诊断快照、状态入口诊断摘要、诊断输出行和回归矩阵文档覆盖。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 在 `S1Plus.js` 中新增统一诊断事实快照，覆盖最近 intent、defer / skip / decision、probe freshness、safe gate、reconcile result、allowed action、apply policy、refresh decision、global pause / circuit / lease / queue、tab guard、local deviceId 与 writer attribution。
  - 将导航栏状态入口接入同一诊断事实摘要，状态入口 view model 会携带 `diagnosticSummary`，点击面板展示 intent / reconcile / guard 摘要。
  - 扩展诊断面板和复制诊断摘要，顶部先展示 Phase 7 统一摘要，再继续保留既有详细字段与阅读进度调试轨迹。
  - 新增固定回归矩阵文档，覆盖多设备、多标签、同机不同标签；每类均覆盖正常路径、defer 路径、冲突路径、恢复路径，并明确 `deviceId` 配置 / 未配置两种模式。
  - 建立真实浏览器手测清单，覆盖 thread page 长时间阅读、后台开多个帖子、bfcache 恢复、visible poll、same-device remote write、dirty settings modal、每日首次同步与 startup 自动获取区分、S1 标准主题 / S1 NUX 主题状态入口视觉检查。
  - 新增 Phase 7 回归脚本，验证代码诊断模型与文档矩阵不会静默漂移。
- 涉及文件：
  - `S1Plus.js`
  - `sync-across-multiple-tab/scripts/test-phase7-diagnostics-regression-matrix.js`
  - `auto-check-redesign/README.md`
  - `auto-check-redesign/regression_matrix.md`
  - `auto-check-redesign/task_plan.md`
  - `auto-check-redesign/progress.md`
  - `auto-check-redesign/notes.md`
  - `auto-check-redesign/phases/phase_7_diagnostics_and_regression_matrix.md`
- 验证：
  - `node --check S1Plus.js`
  - `node sync-across-multiple-tab/scripts/test-phase7-diagnostics-regression-matrix.js`
  - `node sync-across-multiple-tab/scripts/test-sync-coordinator-intent-pipeline.js`
  - `node sync-across-multiple-tab/scripts/test-safe-auto-pull-probe-reconcile.js`
  - `node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
  - `node sync-across-multiple-tab/scripts/test-auto-sync-indicator-linkage.js`
  - `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
  - `node sync-across-multiple-tab/scripts/test-settings-migration.js`
  - `node sync-across-multiple-tab/scripts/test-background-open-passive-session.js`
  - `node sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
  - `node sync-across-multiple-tab/scripts/test-safe-sync-execution.js`
  - `node sync-across-multiple-tab/scripts/test-cleanup-provenance-guard.js`
  - `node sync-across-multiple-tab/scripts/test-phase6-interaction-copy.js`
  - 关键字一致性搜索覆盖 `per_load`、`startup`、`daily_startup`、`syncForcePullOnStartup`、`manual_request`、`pending_recovery`、`payload`、`contentHash`、`pulled`、`force_pulled`、`Phase 7`。
- 剩余工作：
  - 真实 Stage1st 页面 + Tampermonkey / Greasemonkey 下的多标签、bfcache、长时间 visible poll 和 S1 NUX 视觉验收仍需按 `regression_matrix.md` 手动补跑。
  - 后续若新增自动同步行为，需要继续把新增路径挂入 Phase 7 矩阵和统一诊断事实源。
- 风险 / 限制：
  - Node harness 能覆盖状态机、结果码、诊断字段和文档矩阵，但不能完整替代真实浏览器中的 GM API、多标签时序、后台定时器节流和 DOM 主题差异。
  - 状态入口新增诊断摘要属于紧凑展示；更长的排障信息仍以设置面板诊断和复制诊断为准。
- 下一步：
  - 按 `regression_matrix.md` 在真实论坛环境补跑手测；后续问题排查应先看统一诊断快照和矩阵命中项，再决定是否进入具体 phase 修复。
