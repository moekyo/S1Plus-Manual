# Notes: 自动同步统一架构重构

## 1. 为什么旧补丁路线失败

- 问题已经重复出现很多次，且不是单次偶发现象；旧链路经过多轮补丁后仍然会在“不可能发生远端变化”的场景里误报“远端有更新”。
- 旧系统把以下行为耦合得过深：
  - 轻量 freshness 检查
  - 远端 probe
  - 自动同步
  - 页面刷新
  - toast / 红色提示
  - 重试 / 补偿 / 冷却
- 这种耦合导致一个环节的误判，会沿着整条链路被放大成“远端有变化”“要刷新页面”“需要用户介入”之类的高打扰行为。
- 同机多标签场景尤其容易出问题：
  - 某个标签页的局部噪声会被另一个标签页观察到
  - `updated_at` 变化会被误当成“外部远端变化”
  - 页面恢复、visible poll、pending recovery 之间容易重复暴露旧状态

## 2. 当前代码基线：保留了什么，删除了什么

### 2.1 已删除

- 旧自动检查运行链路已经从 `S1Plus.js` 删除：
  - 每次加载自动检查
  - 首次可见探测
  - 回到前台探测
  - 页面持续可见时的低频轮询
  - 这些链路附带的反馈、冷却、重试和专属指示器来源

### 2.2 已保留

- 设置页中的三段式 UI、问号说明、现有文案仍然保留。
- `syncPerLoadCheckEnabled` 和 `syncCheckOnReturnToForeground` 仍被保存、归一化和回填。
- 这两个字段现在只是 UI 占位和未来兼容位，不再驱动任何自动检查运行逻辑。

### 2.3 当前仍然有效的同步来源

- `daily_startup`
- `background_push`
- `manual_sync`

### 2.4 当前仍需保护、不能误伤的能力

- 每日首次加载时同步
- 后台自动同步推送
- 手动同步
- 阅读进度相关同步行为
- cleanup 相关行为
- 跨标签设置同步
- 核心数据快照收敛与恢复链路

## 3. 新架构必须防住的典型误报场景

### 3.1 单设备本地浏览误报

- 只有一台设备在使用
- 没有其他设备在同时浏览
- 没有人直接修改远端
- 当前页面仍然提示“远端更新”或触发自动拉取 / 自动刷新

这是本次重构最核心的反例场景，新架构必须把它作为第一验收项，而不是附带检查项。

### 3.2 同机其他标签页刚推送后的误归因

- 同一台设备上的另一个标签页合法推送了阅读进度或其他变更
- 当前标签页随后观察到远端版本变化
- 系统把这种场景误说成“云端有更新”或“外部变化”

新架构必须区分：

- same-session
- same-device
- cross-device

不能再把所有情况都压成一种叙事。

### 3.3 后台打开的新页制造假本地改动

- 后台打开的新帖子页尚未真正被用户阅读
- 页面仍然可能在初始化、恢复、可见性抖动或关闭时序中写入 `read_progress`
- 这类写入再经过自动推送，会反过来制造“远端有更新”的假象

新架构必须让后台打开的新标签页默认是“被动页”，在未满足真实阅读成立前，不能制造可同步本地改动。

### 3.4 阅读中页面被高打扰刷新或强提示打断

- 帖子页正在阅读
- 页面本地存在短时 pending write 或 debounce
- 远端 freshness 检查命中变化
- 系统立刻刷新页面、弹红提示或升级成全局冲突

新架构必须先保护阅读，再考虑同步追平。

### 3.5 恢复链路重复放大旧状态

- `visibilitychange`
- `pageshow`
- pending recovery
- visible poll

这些入口如果互相不收敛，就会在同一份旧状态上重复发声，导致用户以为系统“又检测到一次变化”。

## 4. 多设备 / 多标签 / 同设备多标签的设计约束

### 4.1 共享什么，不能共享什么

可以跨标签共享的：

- 远端 freshness 观察结果
- 当前全局 lease / lock 摘要
- 全局 hard pause / circuit 状态
- 最近成功同步的远端版本信息

不应直接放大全局的：

- 当前标签页的短时 local dirty
- 当前标签页的 pending write / debounce
- 某个线程页的临时阅读位置
- 未保存设置弹窗的 dirty 状态

### 4.2 `updated_at` 只能是 freshness hint

- 远端 `updated_at` 变化只能说明“远端版本可能变了”
- 它不能单独说明“必须 pull”
- 更不能直接说明“应该打断用户”

新架构应显式拆分：

- `probe`
- `reconcile`
- `apply`

### 4.3 可选 `syncDeviceId` 的定位

- 可选 `syncDeviceId` 有价值，而且当前代码基线已经支持它。
- 它应该继续保留在同步设置里，但定位必须明确：
  - 它是“来源归因输入”
  - 不是“同步真相源”
- 它主要用于回答：
  - 这次远端写入是不是 same-session
  - 是不是 same-device
  - 还是 cross-device
- 它不能代替：
  - `contentHash`
  - `baseContentHash`
  - `updated_at`
  - `sessionId`
  - `sourceTabId`

设计上的正确组合应是：

- `updated_at` 负责发现“可能变了”
- hash 负责判断“内容到底有没有实质变化”
- `syncDeviceId` / writer metadata 负责判断“是谁写的”

如果 `syncDeviceId` 缺失，新架构必须优雅退化到：

- same-session 判断
- hash / updated_at 判定
- 更保守的提示与处理策略

而不是因为用户没填设备 ID，就重新回到高误报状态。

### 4.4 手动同步仍然是最终裁决入口

- 自动同步只负责低风险、可解释、可回退的路径
- 一旦进入真实冲突、重大不确定性或需要用户取舍的场景，就必须回到全局手动同步
- 导航栏状态入口可以承接“立即处理”，但它本质上是在引导进入手动同步，不是替代手动同步

## 5. 旧资料的使用方式

- `sync-across-multiple-tab/` 下的文档现在只作为历史设计资料和问题调查参考
- 它们可以帮助理解旧问题、旧尝试、旧失败点
- 它们不再反向定义新架构的命名、分层或触发模型

## 6. 后续笔记更新规则

- 这里只写事实、约束、反例、取舍和新发现
- 不把“某阶段已经完成”这类进度叙事写到这里
- 若后续实现中出现新的失败样本、浏览器时序差异或迁移兼容问题，继续追加到对应主题下

## 7. Phase 4 实现事实

- 自动获取链路现在把 `startup_due` 作为独立来源处理，不复用 `daily_startup` 的每日首次同步语义。
- `foreground_resume` / `visible_poll` / `startup_due` 进入远端探测前共用同一套 safe-to-probe gate：core data snapshot resync、pending recovery settle、当前标签页本地 guard。
- Phase 4 自动获取执行器是 read-only：不会直接调用 `performAutoSync`、`pushRemoteData` 或 `importLocalData`；远端变化只会变成 candidate / manual / defer 结果。
- `updated_at` 只记录 freshness hint，真正 reconcile 仍回到本地/远端 `contentHash`、`baseContentHash`、baseline 和 writer metadata。
- `syncDeviceId` 缺失时 writer attribution 降级为 `unknown`，不会把 freshness 命中升级成外部变化结论。

## 8. Phase 5 实现事实

- 页面 apply 层现在只输出三类页面：`thread`、`list`、`generic`。
- 页面应用策略现在只输出五类：`silent`、`defer`、`soft_prompt`、`auto_refresh`、`manual_required`；刷新决策只输出 `none`、`prompt`、`reload`、`deferred`。
- 普通 `pulled` 在 thread 页固定为 soft prompt，不调度自动 reload；list / generic 页面在没有当前页本地 guard 时仍可自动刷新追平。
- `merged_read_progress` 在 thread 页 soft prompt，在 list / generic 页面静默处理，不再为了阅读进度合并做全页 reload。
- dirty settings modal、pending write、sync debounce、后台恢复未稳定等当前页状态统一作为 tab-local `defer`，不会升级为全局冲突。
- Phase 5 最低诊断字段已落地：page type、sync result、apply policy、refresh decision、blocked reason。

## 9. Phase 6 实现事实

- 同步设置区现在以三项主模型呈现：`自动推送本地改动`、`自动获取云端更新`、`同步状态入口`。
- `自动获取云端更新` UI 只暴露 `off`、`startup`、`safe_foreground`；旧 `per_load` / `foreground` 只存在于保存 helper 的兼容映射中，不再作为用户可选项。
- `每日首次全量同步` 和 `syncForcePullOnStartup` 继续作为独立高级项可见可配，并在文案中明确不等同于 `自动获取云端更新=startup`。
- Gist ID、GitHub PAT、Token 到期提醒、收藏完整正文同步、手动同步高级模式和手动同步入口仍在同步设置区可见；三项主模型不吞掉连接配置、凭据、安全提醒和手动能力。
- 设备 ID 文案固定为可选来源归因输入：不跨设备同步，不单独改变 pull / push / conflict 判断。
- 状态入口 view model 固定八个用户面状态：`idle`、`queued_push`、`probing`、`syncing`、`applied`、`deferred_local_busy`、`conflict_manual`、`paused_failure`。
- 导航栏自动同步指示器现在是可点击状态入口；它解释当前状态、主要原因、来源和状态枚举，并在需要人工处理时提供全局手动同步动作。
- Phase 6 没有新增完整诊断矩阵；状态入口只承接核心解释和手动入口，完整诊断整理仍留给 Phase 7。

## 10. Phase 7 实现事实

- 统一诊断事实源现在按六层组织：intent、probe、reconcile、apply、runtime、attribution。
- 状态入口、设置面板诊断和复制诊断共享同一事实快照；状态入口只展示紧凑摘要，完整排障仍看诊断面板 / 复制诊断。
- runtime 层显式包含 global pause、circuit、shared lease、queue 和当前 tab guard；tab guard 会显示 dirty settings、pending write、passive background、reading active 等保护原因。
- attribution 层同时保留本地 `deviceId`、远端 writer summary 和 same-session / same-device / cross-device / unknown 归因；未配置 `deviceId` 时只降低归因精度，不改变 hash / baseline 判定。
- 固定回归矩阵已收口到 `auto-check-redesign/regression_matrix.md`：多设备、多标签、同机不同标签均按正常 / defer / 冲突 / 恢复路径覆盖，并要求配置 `deviceId` 与未配置 `deviceId` 两种模式都执行。
- Phase 7 仍无法在当前 Node harness 中替代真实浏览器手测；thread page 长时间阅读、后台开多个帖子、bfcache 恢复、visible poll、same-device remote write、dirty settings modal 和 S1 NUX 视觉体验必须在真实论坛环境补跑。

## 11. 2026-04-25 四项回归修复事实

- 设置迁移不能只依赖 `getSettings()` 返回的规范化缓存。迁移路径必须强制写回 `s1p_settings`，否则旧 `syncCheckOnReturnToForeground` / `syncPerLoadCheckEnabled` 结构会在每次启动继续触发迁移日志。
- `safe_foreground` 的 probe / reconcile 层仍保持“不普通 push”的边界，但候选结果必须进入受控 apply：`pull_candidate` 重新确认远端版本后导入本地；`read_progress_merge_candidate` 只在可合并时执行阅读进度 merge 并用远端 `updated_at` 做回写保护。
- “激活一个已经打开的页面”主要表现为 `window focus`，不能只依赖 `visibilitychange` 或 12 秒后的 visible poll；focus 应进入同一前台恢复调度器，并允许绕过 shared cooldown。
- 自动获取 intent 进入 coordinator pending 后，完成点必须显式解析状态入口。success / no-change 显示成功态，manual / conflict 显示人工处理，failure 显示失败，defer / skipped 回到 idle；不能让三点 pending 依靠 90 秒 stale 自然过期。
- 设置页自动获取说明段落需要专用间距类覆盖全局 `s1p-setting-desc` 负 margin，避免分段开关和说明文字在标准主题 / S1 NUX 下贴边。
