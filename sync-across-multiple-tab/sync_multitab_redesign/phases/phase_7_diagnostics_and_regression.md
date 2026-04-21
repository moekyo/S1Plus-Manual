# Phase 7: 诊断、观测与多标签回归体系

## 1. 默认读取集

### 必读

1. [根文档](../../sync_multitab_review_and_redesign.md)
2. 本文档

### 选读

- [problem_catalog.md](../problem_catalog.md)
- [architecture_principles.md](../architecture_principles.md)

## 2. 目标

把前面所有阶段的状态、触发源和决策路径纳入稳定诊断系统，并建立多标签页专项回归基线，防止后续功能迭代把问题带回来。

## 3. 本阶段覆盖的问题

- `3.2.2` 自动刷新前的诊断信息不足
- `8.5` 多标签页测试必须成为回归基线

同时承接前面所有阶段的状态与结果码设计。

## 4. 本阶段要做成什么样

### 4.1 诊断字段足够描述一次同步决策

至少包含：

- `triggerSource`
- `pageVisibility`
- `tabId`
- `threadId`
- `localHash`
- `remoteHash`
- `baselineHash`
- `cleanupSource`
- `pendingCleanupCount`
- `syncResultKind`
- `syncBlockKind`
- `hadConfirmedVisiblePost`

### 4.2 关键结果码稳定可区分

至少要能稳定区分：

- `local_changed_during_sync`
- `startup_local_newer`
- `cleanup_shortcut_applied`
- `cleanup_shortcut_rejected`

### 4.3 多标签页专项回归成为固定基线

至少覆盖：

1. 单标签页正常阅读
2. 列表页后台打开多个帖子，逐个切换前台
3. 后台打开后从未真正阅读，再切回前台
4. 当前页保持可见 4 分钟以上
5. 某个标签页先写阅读进度，另一个页 later visible poll
6. 手动删除别的帖子阅读记录后，再在当前帖子页点击“处理”
7. 自动清理模式与手动清理模式分别验证
8. bfcache 恢复
9. 页面隐藏 / 显示快速切换
10. 当前页存在 `pendingThreadProgressWrites` 或阅读进度同步防抖时，`foreground_resume / visible_poll` 不应立刻升级成红色冲突提示

## 5. 本阶段不要顺手做什么

1. 不在这里再回头修改基础状态机设计
2. 不把诊断补丁当成对前面结构问题的替代方案

如果前面 phase 的模型还没成立，应先回到对应 phase，而不是在这里硬补日志。

## 6. 推荐交付物

1. 新的诊断字段集合
2. 更完整的控制台日志或诊断面板
3. 多标签页专项测试集
4. 固定回归 checklist

## 7. 验收标准

1. 再次出现类似问题时，能够直接从诊断里看出：
   - 谁触发了
   - 为什么没有自动拉取
   - 为什么出现 cleanup 或冲突文案
2. 多标签页场景成为固定回归基线，而不是事后人工追查。
3. 诊断输出与 UI 语义一致，不再出现“日志和提示像在说两件不同的事”。

## 8. 完成后的使用方式

当前面各阶段都落地后，后续排查某个问题时，推荐最小读取集会变成：

1. [根文档](../../sync_multitab_review_and_redesign.md)
2. 命中的 phase 文档
3. 需要时查看这份诊断文档定义的字段与结果码

这样就不需要每次都重新加载全部历史讨论。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 把最近一次同步 / 探测决策的上下文字段接入 `s1p_sync_diagnostics`，包括触发源、页面可见性、标签页 ID、帖子 ID、hash 摘要、cleanup 来源与数量、结果类型 / 结果码、阻断级别 / 原因、`hadConfirmedVisiblePost`
  - 让前台探测、自动同步、手动同步和 cleanup shortcut 共用同一套稳定结果码，至少可直接区分 `local_changed_during_sync`、`startup_local_newer`、`cleanup_shortcut_applied`、`cleanup_shortcut_rejected`
  - 扩展同步诊断面板和“复制诊断”摘要，直接展示最近一次决策的根因，而不再只停留在时间戳层面
  - 为帖子页阅读进度新增一组面向多标签排查的调试轨迹，持久记录最近几次 `pageshow / visibilitychange / focus / blur`、首个可见楼层候选、阅读确认原因、实际入队写入与 `read_progress` 时间戳触发，便于验证“后台打开但从未激活的标签页”是否真的拿到了前台信号
  - 在诊断面板里额外补了两个快速判断字段：
    - `阅读启动快照`
    - `最近阅读确认`
    这样可以先单独验证“后台新开页初始可见性是否异常”与“是否曾经仅靠 visible stable 通过确认”，不必等到再次出现云端更新提示
  - 进一步把“后台新开页启动摘要”从事件流水里拆成独立列表，按 `tabId + threadId + page + startedAt` 为每个帖子页单独保留首个生命周期信号：
    - 初始 `visibility / focus`
    - 首次 `visibilitychange / pageshow / focus`
    - 首个可见楼层候选
    - 首次阅读确认
    - 首次入队写入
    - 首次 `read_progress` 时间戳更新
    这样即使当前活跃页后续产生大量 `wheel` 调试事件，也不会把后台页的启动证据冲掉
  - 把自动拉取后的刷新策略验证、cleanup shortcut 诊断结果码验证、foreground probe 诊断验证收口进固定脚本回归基线
- 涉及文件：
  - `S1Plus.js`
  - `scripts/test-foreground-probe-diagnostics-feedback.js`
  - `scripts/test-post-sync-refresh-policy.js`
  - `scripts/test-cleanup-provenance-guard.js`
  - `sync_multitab_review_and_redesign.md`
  - `sync_multitab_redesign/problem_catalog.md`
- 验证：
  - `node --check S1Plus.js`
  - `node scripts/test-auto-sync-indicator-linkage.js`
  - `node scripts/test-safe-sync-execution.js`
  - `node scripts/test-foreground-trigger-integration.js`
  - `node scripts/test-foreground-probe-gate-retry.js`
  - `node scripts/test-foreground-probe-diagnostics-feedback.js`
  - `node scripts/test-cleanup-provenance-guard.js`
  - `node scripts/test-phase6-interaction-copy.js`
  - `node scripts/test-post-sync-refresh-policy.js`
  - `node scripts/test-visible-remote-polling.js`
  - 针对本轮阅读进度调试增强，已额外重跑：
    - `node sync-across-multiple-tab/scripts/test-safe-sync-execution.js`
    - `node sync-across-multiple-tab/scripts/test-foreground-trigger-integration.js`
    - `node sync-across-multiple-tab/scripts/test-foreground-probe-gate-retry.js`
    - `node sync-across-multiple-tab/scripts/test-foreground-probe-diagnostics-feedback.js`
    - `node sync-across-multiple-tab/scripts/test-visible-remote-polling.js`
  - 当前环境无法直接完成真实 Stage1st 页面上的 Tampermonkey 多标签手测，已在下方 checklist 保留为后续必跑项
- 剩余工作：
  - 在真实论坛页面按“列表页后台打开多个帖子、只阅读其中一个”的路径复现一次，并对照新的“启动摘要”确认后台页到底拿到了哪类生命周期信号
  - 在真实论坛页面补跑多标签页手测
  - 后续如再改同步链路，继续把新增场景补进脚本基线
- 风险 / 限制：
  - Node harness 能覆盖状态机、结果码和诊断字段，但不能完整模拟真实浏览器里的长时驻留、GM API、bfcache 恢复细节和多标签页交互节奏
  - 这次新增的阅读进度调试轨迹能把“后台页是否拿到前台信号”记下来，但是否出现异常初始 `visibilityState` 仍然要靠真实浏览器复现场景确认
  - 真实论坛 DOM 结构或浏览器节流策略变化，仍可能影响最终体感
- 下一步：
  - 先用新的“启动摘要 + 调试轨迹”复现并确认后台开帖页的真实生命周期，再决定是继续收紧 Phase 2 的“真实阅读成立”条件，还是去修 `GM_openInTab` 背景打开链路上的启动期判断

## 11. 2026-04-21 Follow-up

- 诊断继续补齐“同机误判远端更新”所需字段：
  - `本机设备 ID`
  - `最近远端写入`
  - `最近探测是否同设备写入`
- 远端同步文件新增 `syncMeta.lastWriter`，诊断可直接看到最近一次远端写入来自哪个设备 / 会话 / 标签页，以及动作与模式。
- 固定脚本回归基线继续扩大：
  - `sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
    - 增加 background 默认 `fresh snapshot`
    - 增加 `syncDeviceId` local-only 导出校验
  - `sync-across-multiple-tab/scripts/test-foreground-same-session-remote-write.js`
    - 增加 same-device writer 提示与诊断标记
  - `sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
    - 增加 same-device 刷新文案与 background wiring 断言
  - `sync-across-multiple-tab/scripts/test-sync-settings-ui.js`
    - 增加同步设备 ID 输入框 / 说明 / 保存回填断言
- 本轮补跑验证：
  - `node --check S1Plus.js`
  - `node sync-across-multiple-tab/scripts/test-core-data-snapshot-resync.js`
  - `node sync-across-multiple-tab/scripts/test-foreground-same-session-remote-write.js`
  - `node sync-across-multiple-tab/scripts/test-post-sync-refresh-policy.js`
  - `node sync-across-multiple-tab/scripts/test-sync-settings-ui.js`

## 10. 固定回归 Checklist

1. 单标签页正常阅读
   - 脚本基线：`scripts/test-safe-sync-execution.js`
   - 浏览器补充：真实帖子页确认阅读进度保存、自动同步与诊断字段一致
2. 列表页后台打开多个帖子，逐个切换前台
   - 脚本基线：`scripts/test-foreground-trigger-integration.js`
   - 浏览器补充：确认后台打开页不会直接制造红色冲突提示
3. 后台打开后从未真正阅读，再切回前台
   - 脚本基线：`scripts/test-foreground-probe-gate-retry.js`
   - 浏览器补充：确认仅在真实阅读建立后才进入写入链路
4. 当前页保持可见 4 分钟以上
   - 脚本基线：`scripts/test-visible-remote-polling.js`
   - 浏览器补充：确认 visible poll 只做低打扰探测，不无故升级冲突
5. 某个标签页先写阅读进度，另一个页 later visible poll
   - 脚本基线：`scripts/test-foreground-probe-gate-retry.js`
   - 浏览器补充：确认另一页等待本地稳定后再 follow-up
6. 手动删除别的帖子阅读记录后，再在当前帖子页点击“处理”
   - 脚本基线：`scripts/test-cleanup-provenance-guard.js`、`scripts/test-phase6-interaction-copy.js`
   - 浏览器补充：确认 cleanup provenance 只作附带信息，不覆盖原始根因
7. 自动清理模式与手动清理模式分别验证
   - 脚本基线：`scripts/test-cleanup-provenance-guard.js`
   - 浏览器补充：确认 `cleanup_shortcut_applied` / `cleanup_shortcut_rejected` 与实际场景一致
8. bfcache 恢复
   - 脚本基线：`scripts/test-foreground-trigger-integration.js`
   - 浏览器补充：确认 `pageshow(persisted)` 后只走预期恢复链路
9. 页面隐藏 / 显示快速切换
   - 脚本基线：`scripts/test-foreground-probe-diagnostics-feedback.js`
   - 浏览器补充：确认诊断能直接看出触发源与最终阻断原因
10. 当前页存在 `pendingThreadProgressWrites` 或阅读进度同步防抖时，`foreground_resume / visible_poll` 不应立刻升级成红色冲突提示
   - 脚本基线：`scripts/test-foreground-probe-gate-retry.js`、`scripts/test-foreground-probe-diagnostics-feedback.js`
   - 浏览器补充：确认最近结果码和阻断原因能直接定位到 quiet soft block
