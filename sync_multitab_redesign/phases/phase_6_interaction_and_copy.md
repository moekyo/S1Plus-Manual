# Phase 6: 用户交互与提示语义重构

## 1. 默认读取集

### 必读

1. [根文档](../../sync_multitab_review_and_redesign.md)
2. 本文档

### 强烈建议补读

- [Phase 5](./phase_5_cleanup_provenance_and_manual_sync.md)

### 选读

- [architecture_principles.md](../architecture_principles.md)

## 2. 目标

让导航栏常驻提示、自动同步 toast、手动同步入口的产品语义与真实作用域对齐，避免用户在错误心智模型下操作。

## 3. 本阶段覆盖的问题

- `3.2.1` “检测到云端有更新”文案过于宽泛
- `3.6.5` cleanup 文案把手动删除说成自动清理
- `3.6.6` “处理”按钮的作用域与用户心智不一致
- `3.5.4` 多标签页红提示与 cleanup 快捷分支串联后掩盖真实根因

## 4. 本阶段要做成什么样

### 4.1 自动刷新与自动拉取文案必须区分原因

至少区分：

- 当前页落后于云端
- 远端变化，但本地仍未稳定
- 真正冲突，需要手动决策

### 4.2 常驻提示必须区分“当前页问题”和“全局同步问题”

用户要能从提示上直接理解：

- 这次是当前标签页局部问题
- 还是全局同步进入 hard pause

### 4.3 “处理”按钮必须显式表明自己是全局手动同步

点击前应有简短 preflight 说明：

- 将发起全局手动同步
- 可能消费哪些待处理状态
- 是否包含：
  - 阅读进度
  - cleanup 删除
  - 云端变化

### 4.4 cleanup provenance 与原始根因要并列呈现，而不是互相覆盖

如果：

- 原始红提示来自多标签页前台探测
- cleanup provenance 来自别的帖子

则 UI 中应把它们分开写清，而不是点完“处理”后突然变成另一套故事。

## 5. 本阶段不要顺手做什么

1. 不在这里新增状态机
2. 不在这里扩展底层诊断字段

这些分别留给前面阶段和 `Phase 7`

## 6. 推荐交付物

1. 新的常驻提示文案体系
2. 新的 toast 分类
3. “处理”按钮的 preflight 说明
4. 保留原始根因的 UI 呈现规则

## 7. 验收标准

1. 用户能明确知道“处理”按钮做的是全局同步。
2. 用户不会再把 cleanup shortcut 误解成“当前帖子被自动清理”。
3. 自动刷新和自动拉取提示能表达清楚触发源和原因。
4. 红提示与 cleanup provenance 同时存在时，用户仍能看出最初触发问题的根因。

## 8. 交给下一阶段的输出

`Phase 7` 会基于这里确定下来的交互语义，补齐对应的诊断字段、结果码和回归测试。

## 9. 执行进度

- 状态：`Completed`
- 本轮完成：
  - 自动拉取 / 自动刷新 / 前台探测反馈文案已按真实语义拆开，能区分“当前页落后于云端”“云端变化但本地未稳定”“真正冲突”。
  - 导航栏常驻提示已改成显式的“全局同步暂停”叙事，按钮文案收口为 `全局同步`，并在点击后先展示 preflight 说明。
  - preflight 现在会提前说明：这次操作不是只处理当前帖子，而是一次全局手动同步，并会一起比较云端变化、阅读进度与 cleanup 删除来源。
  - 手动同步对比弹窗新增“原始触发原因”与“另有 cleanup 记录”两块独立说明，cleanup provenance 不再覆盖最初触发红提示的根因。
  - cleanup provenance 来自其他帖子时，UI 会明确说明那只是本次全局同步的附带比较信息，不代表当前帖子被自动清理。
  - 新增 `scripts/test-phase6-interaction-copy.js`，固化常驻提示、preflight、手动同步弹窗和自动拉取文案的 Phase 6 语义。
- 涉及文件：
  - `S1Plus.js`
  - `scripts/test-phase6-interaction-copy.js`
  - `sync_multitab_review_and_redesign.md`
  - `sync_multitab_redesign/phases/phase_6_interaction_and_copy.md`
  - `sync_multitab_redesign/problem_catalog.md`
- 验证：
  - `node --check S1Plus.js`
  - `node scripts/test-phase6-interaction-copy.js`
  - `node scripts/test-auto-sync-indicator-linkage.js`
  - `node scripts/test-cleanup-provenance-guard.js`
  - `node scripts/test-safe-sync-execution.js`
  - 说明：当前环境仍无法直接完成 Tampermonkey 浏览器内多标签手测，以上验证以语法检查与本地脚本回归为主。
- 剩余工作：
  - 在真实论坛页面补跑多标签手测，确认“当前帖子页看到常驻提示后点全局同步”“cleanup provenance 来自其他帖子”“自动拉取后帖子页不刷新只提示”等场景的最终体验。
  - 进入 `Phase 7`，把本阶段定下来的交互语义补齐到诊断字段、结果码和回归基线里。
- 风险 / 限制：
  - 当前 preflight 与对比弹窗的正确性主要通过本地脚本断言，仍需真实 Tampermonkey 页面确认 hover / tooltip / 常驻提示交互是否符合预期。
  - 本阶段刻意没有扩展底层诊断字段；如果后续需要更细的 trigger / hash / visibility 可观测性，仍应放到 `Phase 7` 完成。
- 下一步：
  - 开始 `Phase 7`，补齐诊断、观测与多标签页回归体系。
