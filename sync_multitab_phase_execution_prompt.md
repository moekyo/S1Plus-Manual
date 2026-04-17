# S1 Plus 同步 / 多标签重构分阶段执行提示

下面这份提示用于让 AI 在本仓库里按阶段推进同步 / 多标签重构，并在每个阶段完成后同步更新文档状态、进展、验证和剩余工作。

优先级说明：

1. 如果当前环境支持项目 skill，优先直接使用：
   - `使用 $s1plus-sync-phase-workflow 执行 Phase 1`
   - `使用 $s1plus-sync-phase-workflow 继续 Phase 4`
2. 只有在当前环境不会稳定触发 skill，或你要复制给别的模型 / 别的工具时，再使用下面这份长版 prompt

使用方式：

1. 复制下方“通用主提示”
2. 把其中“当前阶段”那一段替换成你要做的 phase 块
3. 直接发送给 AI

---

## 通用主提示

```text
你现在在仓库 `/Users/rexxin/Development/S1Plus-Manual` 中工作，任务是按阶段推进 S1 Plus 的“同步问题 / 多标签页重构”。

本轮只处理当前阶段，不要默认把后续阶段一起实现，也不要把所有参考文档一次性全部塞进上下文。

如果环境支持技能，请使用：
- `phase-progress-updater`
- 只有在确实需要做行为不变的代码清理时再使用 `code-simplifier`

当前阶段：
<在这里替换成对应 phase 块>

阶段全景只用于确认依赖顺序，不代表本轮全部实现：
1. Phase 1：启动期与触发源语义收口
2. Phase 2：阅读进度写入链路去噪
3. Phase 3：同步状态模型分层
4. Phase 4：前台探测与可见页轮询重构
5. Phase 5：cleanup provenance 与手动同步分支重构
6. Phase 6：用户交互与提示语义重构
7. Phase 7：诊断、观测与多标签回归体系

阅读约束：
1. 必读：
   - `/Users/rexxin/Development/S1Plus-Manual/sync_multitab_review_and_redesign.md`
   - 当前 phase 文档
2. 只有在确实需要时才补读：
   - `/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/coverage_matrix.md`
   - `/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/problem_catalog.md`
   - `/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/architecture_principles.md`
3. 默认不要把 `/Users/rexxin/Development/S1Plus-Manual/discussion.md` 放进实现阶段上下文，除非你明确需要追溯原始讨论措辞。

执行要求：
1. 先阅读最小上下文，并复述你对“当前阶段范围”的理解。
2. 只实现当前阶段文档中列出的目标、覆盖问题、核心改造、验收标准。
3. 不要把后续 phase 的大改混进本轮，除非它是修通当前阶段所必需的极小前置调整；如果发生这种情况，要明确说明。
4. 保留已有已修复行为，不要把前面阶段已经成立的边界重新打破。
5. 多标签页场景要作为默认高优先级约束来考虑，避免单标签页视角下“看起来可行”但多标签页会放大的方案。
6. 如果发现当前阶段文档不完整、存在歧义、或与代码现状冲突：
   - 先在代码里基于当前阶段目标做最保守、最一致的实现
   - 再把新发现同步更新到对应文档
7. 本轮需要完成到“可交付状态”为止：
   - 代码修改
   - 必要验证
   - 文档状态更新
   - 剩余工作与风险记录

文档更新要求：

A. 更新根文档 `/Users/rexxin/Development/S1Plus-Manual/sync_multitab_review_and_redesign.md`
- 如果还没有总进度区块，则新增一个简洁的“当前实施进度”区块
- 至少记录：
  - 当前阶段
  - 每个 phase 的状态
  - 当前总体进度（例如：`2 / 7 phases completed`）
  - 当前下一步

推荐状态枚举：
- `Not Started`
- `In Progress`
- `Completed`
- `Blocked`
- `Deferred`

B. 更新当前 phase 文档
- 如果还没有“执行进展”区块，则新增
- 至少记录以下字段：
  - `状态`
  - `本轮完成`
  - `涉及文件`
  - `验证`
  - `剩余工作`
  - `风险 / 限制`
  - `下一步`
- 只有在当前阶段的 intended output 已存在，且关键验证已完成或明确写明为何未执行时，才能标记为 `Completed`

C. 仅在必要时更新参考文档
- `/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/problem_catalog.md`
  - 仅在你发现了新的问题、现象、风险、或已做局部修复需要登记时更新
- `/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/architecture_principles.md`
  - 仅在通用设计原则真的发生变化时更新
- `/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/coverage_matrix.md`
  - 仅在问题与阶段映射、默认选读路径、或阶段边界发生变化时更新

文档更新原则：
1. 只写现在已经成立的事实，不要把“计划做”写成“已经完成”
2. 明确区分：
   - 已完成
   - 部分完成
   - 未开始
   - 被阻塞
   - 推迟
3. 如果验证未执行，必须明确写原因
4. 如果本轮只完成当前阶段的一部分，phase 状态应保持 `In Progress`，并写清剩余项

代码与实现约束：
1. 优先保持行为边界清晰，不要为了“顺手优化”把 phase 范围扩散
2. 不要回退用户已有改动
3. 不要做无关重构
4. 对多标签页相关状态、阅读进度、cleanup provenance、startup 语义尤其谨慎
5. 如果当前阶段涉及提示语义，不要只改文案而不改实际状态机；如果只改了部分，则必须在文档里明确记录这是阶段内的局部完成

验证要求：
1. 至少执行与当前阶段直接相关的检查
2. 能跑的自动检查就跑
3. 跑不了的浏览器 / 多标签场景测试，要明确列出建议验证路径
4. 在 phase 文档和最终总结里都记录验证结果

最终输出要求：
1. 先说明当前阶段结果：`Completed` / `In Progress` / `Blocked`
2. 简述本轮代码改动
3. 简述验证结果
4. 列出本轮更新过的文档
5. 说明剩余工作、风险、以及是否进入下一 phase

不要停在纯分析；只要当前阶段可以推进，就直接落代码、跑验证、更新文档。
```

---

## 当前阶段替换块

### Phase 1 块

```text
- Phase 1：启动期与触发源语义收口
- 当前 phase 文档：`/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/phases/phase_1_startup_and_trigger_model.md`
- 本轮只处理：
  - 启动期 freshness window 与 startup orchestrator 的正式收口
  - `daily_startup` / `per_load` / `page_load_visible` / `foreground_resume` / `visible_poll` / `background_push` / `manual_sync` 的触发源语义边界
  - deferred daily sync 的正式状态结构与补偿规则
  - 手动同步不替代每日首次自动同步
  - 启动期相关导航栏待处理状态语义
```

### Phase 2 块

```text
- Phase 2：阅读进度写入链路去噪
- 当前 phase 文档：`/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/phases/phase_2_read_progress_denoising.md`
- 本轮只处理：
  - 阅读进度跟踪从“初始化即可能落盘”改成“真实阅读成立后才落盘”
  - 后台打开标签页默认被动，不应制造可同步本地改动
  - 去掉初始 synthetic progress / 主楼 fallback 写入
  - 增加阅读进度 provenance
  - 显式暴露 pending write / debounce 状态给后续 probe 使用
```

### Phase 3 块

```text
- Phase 3：同步状态模型分层
- 当前 phase 文档：`/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/phases/phase_3_sync_state_layering.md`
- 本轮只处理：
  - `foreground_followup` 不再复用 startup 模式
  - 引入 `soft block / hard pause` 双层阻塞模型
  - 收窄全局 conflict pause 的触发条件
  - 明确全局状态、页级状态、线程级状态的边界
  - 避免单个标签页的局部问题冻结所有标签页
```

### Phase 4 块

```text
- Phase 4：前台探测与可见页轮询重构
- 当前 phase 文档：`/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/phases/phase_4_foreground_probe_and_visible_poll.md`
- 本轮只处理：
  - `foreground_resume` / `visible_poll` 的 probe gate
  - 显式检查 pendingThreadProgressWrites / 阅读进度 debounce / 初始化噪声 provenance
  - visible poll 的低打扰降级策略
  - 前台探测与 visible poll 的统一重试 / backoff
  - 避免 3 到 5 分钟后把短时本地差异直接升级成红色冲突提示
```

### Phase 5 块

```text
- Phase 5：cleanup provenance 与手动同步分支重构
- 当前 phase 文档：`/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/phases/phase_5_cleanup_provenance_and_manual_sync.md`
- 本轮只处理：
  - 用结构化 provenance 替换 `s1p_pending_cleanup_info`
  - 区分自动清理、手动单条删除、手动分组删除
  - 为 cleanup shortcut 增加严格 guard
  - 避免别的帖子 cleanup 污染当前页处理流程
  - 避免多标签页红提示被 cleanup 快捷分支改写成另一套叙事
```

### Phase 6 块

```text
- Phase 6：用户交互与提示语义重构
- 当前 phase 文档：`/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/phases/phase_6_interaction_and_copy.md`
- 本轮只处理：
  - 自动刷新 / 自动拉取文案的原因细分
  - 常驻提示区分当前页问题与全局同步问题
  - “处理”按钮显式说明自己是全局手动同步
  - cleanup provenance 与原始根因并列呈现，不互相覆盖
  - 保证用户点击“处理”前后的叙事连续，不再像换了一套故事
```

### Phase 7 块

```text
- Phase 7：诊断、观测与多标签回归体系
- 当前 phase 文档：`/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/phases/phase_7_diagnostics_and_regression.md`
- 本轮只处理：
  - 扩展诊断字段与结果码
  - 让日志 / 诊断能明确看出触发源、未自动拉取原因、cleanup / conflict 的真实来源
  - 建立多标签页专项回归基线
  - 把 pending / debounce / visible poll / foreground_resume / cleanup 污染场景纳入固定验证集
```

---

## 最短使用方式

如果你想最省事，直接复制“通用主提示”，再把“当前阶段”替换成上面的某个块即可。

例如要做 `Phase 4`，只需要把：

```text
当前阶段：
<在这里替换成对应 phase 块>
```

替换成：

```text
当前阶段：
- Phase 4：前台探测与可见页轮询重构
- 当前 phase 文档：`/Users/rexxin/Development/S1Plus-Manual/sync_multitab_redesign/phases/phase_4_foreground_probe_and_visible_poll.md`
- 本轮只处理：
  - `foreground_resume` / `visible_poll` 的 probe gate
  - 显式检查 pendingThreadProgressWrites / 阅读进度 debounce / 初始化噪声 provenance
  - visible poll 的低打扰降级策略
  - 前台探测与 visible poll 的统一重试 / backoff
  - 避免 3 到 5 分钟后把短时本地差异直接升级成红色冲突提示
```

就可以直接使用。
