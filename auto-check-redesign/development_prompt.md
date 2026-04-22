# 自动同步统一架构重构开发提示

## 用途

这份提示是给后续开发 session 直接使用的执行提示。

它的目标不是重新解释整个背景，而是让新的实现 session：

- 先读对文档
- 只做当前 phase
- 不回到补丁式思路
- 做完后同步更新 `task_plan.md`、`progress.md` 和当前 phase 文档

建议优先使用下面的“长版提示”。

## 长版提示

```markdown
你现在在 `/Users/rexxin/Development/S1Plus-Manual` 仓库里工作。

任务目标：
基于 `auto-check-redesign/` 下的文档体系，推进“自动同步统一架构重构”的当前阶段实现。这个任务不是继续修旧的“自动检查云端更新”补丁链路，而是按新的统一架构分阶段落地。

工作方式要求：
1. 先读文档，不要上来就写代码。
2. 只实现当前阶段，不要跨 phase 顺手做后面的内容。
3. 多标签页、同机多标签、多设备场景是第一优先级约束，不要把它们当边角情况。
4. 不要把 `sync-across-multiple-tab/` 下旧文档当当前实现基线，它们只作为历史参考。
5. `syncDeviceId` 要继续保留，而且是可选项；它只用于来源归因，不是同步判定真相源。
6. 不允许重新走“打一层补丁、加一个触发器、补一个提示”的思路，必须遵守新架构的分层：
   - `probe`
   - `reconcile`
   - `apply`

本轮开始前必须阅读：
1. `auto-check-redesign/README.md`
2. `auto-check-redesign/task_plan.md`
3. `auto-check-redesign/notes.md`
4. 当前 phase 文档：
   - `auto-check-redesign/phases/phase_X_...md`

如果当前 phase 需要额外上下文，再按 phase 文档里的“默认读取集”补读，不要默认把旧大文档全塞进上下文。

执行约束：
1. 先用当前代码基线确认现状，再开始实现。
2. 只围绕当前 phase 的目标、推荐交付物、验收标准开展工作。
3. 不要提前实现后续 phase 的 UI、诊断、文案或交互，除非它是当前 phase 的最小前置依赖。
4. 保留现有稳定能力，不要误伤：
   - 每日首次加载时同步
   - 后台自动同步推送
   - 手动同步
   - 阅读进度相关同步行为
   - cleanup 相关行为
   - 跨标签设置同步
   - 核心数据快照收敛与恢复链路

文档更新要求：
完成当前阶段的实际工作后，必须在同一轮里同步更新这 3 个文件：
1. `auto-check-redesign/task_plan.md`
2. `auto-check-redesign/progress.md`
3. `auto-check-redesign/phases/当前阶段文档`

更新时必须如实写清：
- 状态：`Not Started | In Progress | Completed | Blocked | Deferred`
- 本轮完成
- 涉及文件
- 验证
- 剩余工作
- 风险 / 限制
- 下一步

不要只在对话里说“完成了”，不更新文档。

实现原则：
1. `updated_at` 只能作为 freshness hint。
2. `contentHash` / `baseContentHash` 才是实质变化判定核心。
3. `syncDeviceId` / `lastWriter` 只用于 same-session / same-device / cross-device 归因。
4. 即使配置了 `syncDeviceId`，也不能绕过哈希和本地最新状态判断。
5. 如果用户没有填写 `syncDeviceId`，系统必须优雅退化，不能退回高误报设计。
6. thread 页面优先保护阅读，不要轻易自动刷新或高打扰提示。
7. 当前标签页的局部噪声不能放大全局。

输出要求：
1. 先简要汇报你理解的当前 phase 目标和非目标。
2. 再实现当前 phase。
3. 最后汇报：
   - 当前 phase 状态
   - 主要改动
   - 验证结果
   - 已更新哪些文档
   - 剩余工作和下一步

现在开始前，请先读取：
- `auto-check-redesign/README.md`
- `auto-check-redesign/task_plan.md`
- `auto-check-redesign/notes.md`
- `auto-check-redesign/phases/phase_X_...md`

然后只推进当前 phase。
```

## 短版提示

```markdown
基于 `auto-check-redesign/` 文档体系推进当前 phase 的实现。

先读：
- `auto-check-redesign/README.md`
- `auto-check-redesign/task_plan.md`
- `auto-check-redesign/notes.md`
- 当前 phase 文档

要求：
- 只做当前 phase，不跨 phase 扩散
- 多设备 / 多标签 / 同机多标签是第一优先级约束
- 不走补丁式思路，遵守 `probe -> reconcile -> apply`
- `syncDeviceId` 保留且可选，只用于来源归因，不替代哈希/更新时间判定
- 完成后必须同步更新：
  - `auto-check-redesign/task_plan.md`
  - `auto-check-redesign/progress.md`
  - 当前 phase 文档

请先汇报你对当前 phase 的理解，再开始实现。
```

## 使用建议

- 长版提示适合：
  - 新开 session
  - 切换到新的 phase
  - 交给别的模型或别的工具继续做
- 短版提示适合：
  - 当前上下文已经比较完整
  - 只是继续推进同一个 phase

## 注意事项

- 这份提示依赖 `auto-check-redesign/` 下的文档体系，不适合脱离这些文件单独使用。
- 如果后续调整了 phase 边界、settings 模型或 `syncDeviceId` 的定位，应同步更新本文件。
