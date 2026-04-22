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

## 7. 验收标准

1. 诊断能明确区分 intent、probe、reconcile、apply 四个层级的问题。
2. 状态入口和诊断使用同一套事实源，不再互相漂移。
3. 多设备、多标签、同机不同标签都有固定回归表，不再靠零散复现。
4. 新架构未来再出问题时，能优先靠观测和矩阵定位，而不是先猜再补丁。
5. `deviceId` 配置与否都能被诊断和回归明确覆盖，不会形成新的隐性分叉。

## 8. 交给下一阶段的输出

- 本阶段是这套重构文档体系中的最后一个实现阶段。
- 若后续仍有延伸工作，应以本阶段产出的诊断与回归基线为出发点，而不是重新发散出新的补丁链路。

## 9. 执行进度

- 状态：`Not Started`
- 本轮完成：
  - 暂无，本阶段尚未开始。
- 涉及文件：
  - 暂无
- 验证：
  - 暂无
- 剩余工作：
  - 完成新诊断模型、回归矩阵和真实浏览器手测清单。
- 风险 / 限制：
  - 如果没有本阶段的观测与回归基线，新架构后续仍会退化回“体感驱动排查”。
- 下一步：
  - 为新架构设计统一诊断面、状态摘要和固定回归矩阵。
