# Task Plan: 自动同步统一架构重构

## Goal

构建一套面向多设备、多标签页、同机多标签页场景的稳定自动同步架构，把自动推送、自动获取云端更新、页面应用策略、导航栏状态入口和诊断体系统一到同一个设计里，并从根上避免旧自动检查链路反复出现的误报、误拉取和误刷新问题。

## Current Status

- Current phase: `Phase 7`
- Current status: `Phase 7` 已完成，并已追加完成 2026-04-25 的四项回归修复：旧设置迁移会强制持久化，`safe_foreground` 候选结果会进入受控 apply，普通 `focus` 会触发前台恢复自动获取，自动获取完成后状态入口会从 pending 解析为 success / conflict / failure / idle。
- Overall progress: `7 of 7 implementation phases completed`

## Phases

- [x] Phase 1: 领域模型与设置迁移
- [x] Phase 2: 协调器与 intent 流水线
- [x] Phase 3: 自动推送与共享 lease
- [x] Phase 4: 安全自动拉取、probe 与 reconcile
- [x] Phase 5: 页面应用与刷新策略
- [x] Phase 6: 设置 UI 与统一状态入口
- [x] Phase 7: 诊断与回归矩阵

## Decisions Made

- 不继续延长旧“自动检查云端更新”运行链路，而是以统一自动同步架构替代。
- 文档与阶段跟踪面独立放在 `auto-check-redesign/` 下，不复用仓库根目录现有 `task_plan.md` / `notes.md`。
- 新架构默认采用“保守优先”行为策略：宁可慢一点，也优先避免误报、误拉取、误刷新。
- 新架构实施方式采用“分阶段迁移”，但从第一阶段起就按最终架构设计，不再接受补丁式局部修修补补。
- 设置面允许大改，导航栏自动同步指示器升级为统一状态入口，而不是继续停留在轻量状态灯模型。
- 新架构不恢复旧 `per_load` 模式；它被视为高噪声触发源，不进入新设计。
- 保留可选 `syncDeviceId`，并将它明确定位为“来源归因字段”，而不是同步判定的真相源。
- `Phase 3` 已把后台自动推送的 `local_dirty` drain、pending recovery 优先级、shared lease 包装和 retry 调度收敛进 coordinator；后续自动获取不得另起第二套锁或普通 push 通道。
- `manual_request` 以协调器观测态参与互斥和诊断，但手动同步的强制推送、强制拉取和高级选择交互仍保留在原手动流程内。
- `Phase 4` 已把自动获取固定为只读 probe + reconcile，再由受控 apply helper 处理候选结果：普通远端较新只做 `importLocalData(..., { suppressPostSync: true })`，仅阅读进度分歧可做受控 merge 回写；本地较新仍只能转交 `local_dirty` / 手动处理，不能普通 push。
- `Phase 5` 已固定页面应用矩阵：普通 `pulled` 在 thread 页不自动 reload；list / generic 在无本地 guard 时可 `auto_refresh`；`merged_read_progress` 在 thread 页 soft prompt，在 list / generic 静默处理；`conflict_manual` 不刷新，只要求手动处理。
- `Phase 6` 已固定用户面三项主模型和状态入口枚举：`idle` / `queued_push` / `probing` / `syncing` / `applied` / `deferred_local_busy` / `conflict_manual` / `paused_failure`。状态入口只解释状态并导向手动同步，不替代手动同步的强制推送、强制拉取和高级选择流程。
- `Phase 7` 已固定统一诊断事实源和回归矩阵：状态入口、诊断面板和复制诊断都从 intent / probe / reconcile / apply / runtime / attribution 六层事实派生；多设备、多标签、同机不同标签均按正常 / defer / 冲突 / 恢复路径覆盖，且每项都要求 `deviceId` 配置与未配置两种模式。

## Architecture Lock-In

以下约束来自方案 review 后的收敛结论，后续实现阶段不得再临场改口：

- 不恢复旧 `per_load` 运行语义。旧 `syncPerLoadCheckEnabled=true` 只能作为迁移信号，迁移到受 `safe to probe` gate 保护的 `safe_foreground`，不能恢复“每次加载都检查”的高噪声行为。
- `daily_startup` 是现有每日首次同步能力，和新 `自动获取云端更新=startup` 是两个概念。`startup` 只表示启动期自动获取策略，不替代、不补充、不重新耦合 `syncDailyFirstLoad` / `daily_startup`。
- 自动获取链路默认是只读 probe + reconcile，不允许普通 push。任何本地改动推送只能走 `local_dirty` / background push 路径；自动获取最多产出 pull candidate、read_progress 受控 merge candidate、manual required 或 defer。
- 从 `Phase 2` 起，每个核心阶段都必须随实现落地最低诊断字段。`Phase 7` 只负责扩展展示、统一矩阵和真实浏览器手测清单，不能把早期可观测验收全部推迟到最后。
- 手动同步继续是最终裁决入口。协调器可以统一互斥、状态和可观测性，但不能吞掉强制推送、强制拉取和高级选择交互。

## Open Questions

- 当前没有阻塞性开放问题；若后续实现中暴露新的浏览器时序差异或迁移兼容风险，再补记到本节。

## Risks / Blockers

- 旧设置迁移后的用户心智需要重新收口，尤其是“每日首次加载时同步”“回到前台检查”“后台自动同步”这些旧概念的映射。
- `syncDeviceId` 是可选字段，因此 same-device 识别必须允许“未配置时优雅退化”，不能因为用户没填就退回高误报设计。
- 真实浏览器、Tampermonkey、bfcache 和多标签时序的组合行为，仍需按 Phase 7 矩阵做发布前补测；Node harness 只能覆盖状态机、结果码、诊断字段和文档矩阵。

## Next Step

- 代码阶段 7 个 phase 已完成。下一步是在真实 Stage1st 页面按 `auto-check-redesign/regression_matrix.md` 补跑 Tampermonkey / Greasemonkey 手测，并把任何新失败样本映射回对应 phase，而不是重新发散旧补丁链路。
