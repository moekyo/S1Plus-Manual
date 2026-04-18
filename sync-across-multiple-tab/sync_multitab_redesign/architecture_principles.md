# S1 Plus 同步与多标签页重构的通用设计原则

## 1. 文档作用

这份文档只放跨阶段的通用设计原则，不放具体阶段的实施顺序。

如果已经知道自己在做哪个 phase，默认只需要：

1. 读根文档
2. 读对应 phase 文档

只有遇到跨阶段边界问题时，再回来看这份文档。

## 2. 完整重构目标

完整方案应同时满足下面这些目标：

1. 启动期行为稳定，不晚到打断阅读。
2. 前台探测与 visible poll 低打扰，不把普通多标签页差异升级成严重冲突。
3. 阅读进度只有在“真实阅读成立”时才落盘。
4. 多标签页之间只共享真正需要共享的全局状态，不放大全局影响面。
5. cleanup 相关逻辑能够明确知道：
   - 来源是自动还是手动
   - 删除的是哪些帖子
   - 哪次同步可以安全消费这个标记
6. 用户提示文案能准确说明：
   - 谁触发了同步
   - 为什么没有自动拉取
   - 当前是否真的存在冲突
7. 多标签页场景成为固定回归基线，而不是事后补追查。

## 3. 触发源模型

同步触发源统一划分为以下几类：

1. `daily_startup`
   - 每日首次同步
2. `per_load`
   - 页面加载检查
3. `page_load_visible`
   - 新开页面首次可见时的启动型前台探测
4. `foreground_resume`
   - `visibilitychange` / `pageshow` 恢复后的前台探测
5. `visible_poll`
   - 页面保持可见时的低频轮询
6. `background_push`
   - 本地改动触发的后台自动同步
7. `manual_sync`
   - 用户主动点击处理/同步

基本规则：

- 每类触发源都要有自己明确的 policy。
- `foreground_resume` / `visible_poll` 不再直接套用 `startup` 语义。

## 4. 启动期模型

启动期遵循“早决策、晚到只补必要动作”：

1. 页面初始化后，在很短时间内完成“是否需要每日首次同步”的决策。
2. 如果启动专属检查已经错过 freshness window：
   - 永远不再补跑：
     - `per_load`
     - `page_load_visible`
   - 只允许记录或补偿：
     - `daily_startup`
3. 每日首次同步的顺延状态单独持久化，并带上：
   - `date`
   - `createdAt`
   - `reason`
   - `scheduledBy`
4. 已顺延的每日首次同步在下一次新页面必须优先执行，不再重新走 freshness 判定。

## 5. 前台 follow-up 模型

前台探测命中远端变化后，不再复用 startup 模式，而是进入新的前台 follow-up 模式。

该模式的规则：

1. 如果本地只是短期阅读进度变更：
   - 不写全局 conflict pause
   - 不弹高严重度红色提示
   - 进入 soft block 或延迟重试
2. 如果本地存在非阅读进度类的真实改动：
   - 可以提示需要手动同步
   - 但先判断它是当前页局部问题还是全局冲突
3. 只有在确认为真正双边内容冲突时，才允许进入全局 hard pause。

## 6. 双层阻塞模型

### 6.1 全局 hard pause

仅用于：

- 真正的同步冲突
- 双边都发生了非阅读进度类变化
- 明确需要人工决策才能继续

特点：

- 对所有标签页生效
- 导航栏常驻提示显示“请手动同步”
- 后台自动同步队列停止

### 6.2 页级 soft block

用于：

- 当前标签页正在阅读，存在短时本地阅读进度改动
- visible poll 命中远端变化，但本页还没过防抖窗口
- synthetic read progress 刚落盘，尚不应升级成全局暂停
- 当前页仍有待持久化或待同步防抖的阅读进度写入

特点：

- 只影响当前标签页的自动拉取
- 可以自动重试
- 不应写全局 conflict pause
- 不应直接显示高严重度红色提示

## 7. 阅读进度落盘原则

阅读进度必须改成“真实阅读成立后才落盘”。

### 7.1 基本规则

1. 页面隐藏时不落盘。
2. 后台打开的新标签页默认只建立观察器，不立即生成可同步的本地改动。
3. 只有满足以下至少一项时，才允许生成真实阅读进度：
   - 页面可见且稳定停留超过短时间窗口
   - 观察到真实可见楼层进入 viewport
   - 用户产生明确阅读行为，如滚动、键盘翻页等
4. 初次保存时禁止使用“主楼 fallback”生成 synthetic progress。
5. `first-post fallback` 只能作为极少数显式兜底逻辑存在，且必须满足：
   - 页面当前可见
   - 之前已经有真实可见记录
   - 或页面即将卸载，且本次会话中已确认用户真的在阅读

### 7.2 provenance 要求

阅读进度写入应带上至少这些信息：

- `sourceTabId`
- `threadId`
- `page`
- `saveReason`
- `documentVisibilityState`
- `hadConfirmedVisiblePost`
- `createdAt`
- `initiatedWhileHidden`

同步层必须能识别：

- 这是一条真实阅读写入
- 还是一条初始化噪声

## 8. cleanup provenance 原则

`s1p_pending_cleanup_info` 不应再只是一个数字，而应改成结构化来源记录。

推荐结构：

```json
{
  "source": "manual_group_delete",
  "cleanupModeAtCreation": "manual",
  "createdAt": 1760000000000,
  "deletedCount": 3,
  "threadIds": ["123", "456", "789"],
  "initiatedFromThreadId": "456",
  "basisHashBefore": "xxx",
  "basisHashAfter": "yyy"
}
```

推荐来源枚举：

- `auto_expire_cleanup`
- `manual_single_delete`
- `manual_group_delete`

cleanup 快捷分支只有在以下条件全部满足时才能生效：

1. cleanup 记录来源合法
2. cleanup 创建时的基础哈希和当前差异相匹配
3. 当前待同步差异确实由这次 cleanup 导致
4. cleanup 记录仍在有效期内

否则必须退回常规手动同步决策。

## 9. 文案原则

### 9.1 自动刷新与自动拉取文案

文案必须明确区分：

- 当前页落后于云端
- 远端变化但本地未稳定
- 真正冲突

不能再把所有场景都压成“检测到云端有更新”。

### 9.2 cleanup 文案

文案必须按来源表达：

- 自动清理：
  - “已自动清理过期阅读记录，正在同步至云端...”
- 手动删除：
  - “已删除的阅读记录正在同步至云端...”
- 来源不确定：
  - 只说“检测到阅读记录变更，正在同步”

只有来源明确是 `auto_expire_cleanup` 时，才允许说“自动清理”。

### 9.3 导航栏“处理”按钮

必须明确这是“全局手动同步”入口，而不是“仅处理当前帖子页”。

如果当前提示的根因来自多标签页红提示，而 cleanup provenance 来自别的帖子：

- UI 中应分开呈现
- 不允许 cleanup 快捷分支覆盖原始根因叙事

## 10. visible poll 与前台探测原则

`foreground_resume` 与 `visible_poll` 应优先静默处理，而不是第一时间冲突化。

进入 follow-up sync 前，显式检查：

- 当前页是否存在待持久化的阅读进度写入
- 当前页是否仍处于阅读进度同步防抖窗口
- 最近一次阅读进度写入是否来自初始化 / 恢复而非真实阅读

若任一条件成立：

- 优先记录 soft block
- 按较短延迟重试
- 避免立即进入 `skipped_push_on_startup` 或 conflict 类反馈

## 11. 多标签页专项要求

### 11.1 后台打开的新帖子页必须是“被动标签页”

- 后台标签页加载时可以做 DOM 初始化，但默认不应制造可同步的本地改动
- 在真正进入前台并确认真实阅读之前，不应写 `read_progress`

### 11.2 多标签页共享的应只有“远端探测状态”

可共享：

- remote probe cooldown
- remote probe lock
- last observed remote updated_at

不应直接全局共享或放大的：

- 当前标签页的短时 local dirty
- 某一次 synthetic read progress
- 某一个线程页的临时阅读位置

### 11.3 一个标签页的局部问题不应冻结所有标签页

- `foreground_followup` 下的 local dirty，不应写全局 pause
- visible poll 下的暂时性本地差异，不应升级成全局冲突

### 11.4 删除别的帖子阅读记录，不应污染当前页的处理语义

cleanup provenance 至少要知道：

- 删除的是哪些 `threadId`
- 来自单条删除还是分组删除

如果当前页常驻提示的根因与 cleanup provenance 不一致：

- 处理流程应优先保留原始根因说明
- 不允许被 cleanup 快捷分支改写成另一套叙事

## 12. 诊断原则

关键提示和诊断至少应包含：

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

其中至少需要稳定区分：

- `local_changed_during_sync`
- `startup_local_newer`
- `cleanup_shortcut_applied`
- `cleanup_shortcut_rejected`

## 13. 回到分阶段文档

做实现时，建议回到：

- 根文档 [sync_multitab_review_and_redesign.md](../sync_multitab_review_and_redesign.md)
- 对应的 phase 文档

不要默认把这份通用原则全文和所有 phase 一起塞进上下文。
