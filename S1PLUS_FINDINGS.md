**关键问题（建议优先修复）**
1. `P1 安全（已修复）` 自定义导航链接已增加协议校验与归一化。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:131`（`normalizeCustomNavLinks`）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7056`（渲染时二次校验）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:10071` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:10092`（保存时过滤并提示）。

2. `P1 安全/行为（已修复）` 全局链接拦截改为稳健判定。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5167` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5174`，使用 `trim + lowercase` 并覆盖 `javascript:`/`vbscript:`/`data:text/html`，且统一走 `isSafeUrlAttributeValue(href)`。

3. `P2 行为一致性（已修复）` 屏蔽/取消屏蔽用户后，提醒区可即时刷新。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4015`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4049` 已补充 `hideBlockedUserNotifications()`。

4. `P2 数据一致性（已修复）` 导入缺字段时改为显式清空，避免“混合态”残留。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5448` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5544` 对 `user_tags`、`read_progress`、`bookmarked_replies`、`blocked_posts` 使用 `hasOwnProperty` + 规范化落盘策略。

**可优化点（已全数修复）**
1. 为高频数据读取增加短生命周期缓存（类似 `settings` 缓存）。  
`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3758`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3766`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3792`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4664`。  
`blocked_threads/users/posts/read_progress` 在热路径中反复 `GM_getValue`，可用“内存缓存 + save* 失效”降开销。

2. `applyGlobalLinkBehavior` 可避免重复解绑/重绑。  
`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5236` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5241` 每次都 remove/add，且被多处调用。  
可维护一个 `isBound` 状态，仅在开关状态变化时操作监听器。

3. Observer 的 quote/rating/notification scoped 集合可加上限降峰值。  
`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:13971` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:13973`。  
thread/post 已有限流阈值，但这三类 pending scope 尚无上限；大批量变更时可能出现短时集合膨胀。

4. 统一链接安全策略复用，避免“sanitize 里安全、导航里直写”不一致。  
`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:98` 的 `isSafeUrlAttributeValue` 与导航保存/渲染路径建议复用同一校验。

**审阅说明**
- 本次是静态审阅，未做端到端交互回归。  
- 如果你要，我可以下一步按优先级直接落地修复：先 `P1` 两项，再 `P2` 两项。

---

**自动后台同步专项审视（2026-02-15）**
1. `P1 稳定性（已修复）` 冲突后仍可能被“同步期间脏写”再次排队，形成冲突重入循环（连续日志/连续弹窗）。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3693` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3699`（同步中置 dirty + pending）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6631` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6651`（drain 循环持续执行）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6987` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6995`（冲突结局清空补同步队列与 pending）。

2. `P2 设计一致性（已修复）` “自动同步冲突暂停”状态已接入调度门控，冲突暂停从“名义状态”变为“可执行状态”。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3460` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3489`（状态读取与活动态封装）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3564`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3620`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3683`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6420`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6655`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6814`（恢复/调度/执行链路读取并门控）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6851`（冲突写入）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6839`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:11878`（自动/手动成功后清理）。

3. `P2 并发控制（已修复）` 新增全局互斥锁并接入三类同步锁链，避免“后台/手动/启动”并行互撞。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:350` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:353`（全局锁键与模式定义）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6228` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6312`（全局锁读写/刷新/释放 + 其他模式活跃锁兜底检查）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6319` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6385`（手动锁获取时联动全局锁）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6418` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6490`（后台锁获取时联动全局锁）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6522` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6587`（启动锁获取时联动全局锁）。

4. `P2 误触发补同步（已修复）` 同步中已区分“仅时间戳修正”和“需要补同步”的 dirty 信号，`triggerSync=false` 不再误触发补同步链。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5900`（导入抑制场景触发 `triggerSync=false`）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3732` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3746`（同步中仅在 `triggerSync=true` 时置 `syncDirtyNeedsFollowUpSync` 与 pending）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7270` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7278`（finally 仅在 `syncDirtyNeedsFollowUpSync` 为真时补跑后台同步）。

5. `P3 体验一致性（已修复）` 冲突弹窗冷却改为“按冷却组分桶”，后台冲突与启动冲突共享同一冷却窗口，不再交替弹出。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:371` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:374`（冲突类型映射到共享组 `sync_conflict`）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3441` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3445`（冷却键改为按 group 生成）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6653`（后台冲突调用）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:15000`（启动冲突调用）。

**补充说明**
- 你日志里的 `A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received` 更像浏览器扩展消息通道异常，不是这套同步状态机直接抛出的业务错误。  
- 本章节为静态审视结论，尚未补充端到端自动化回归用例。


**主要问题（按严重级别）**
1. `P2 并发一致性（已修复）` 心跳续租失败现在会被消费并触发中止路径；自动/手动同步都新增锁所有权断言，避免“失锁继续跑”。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6549`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6658`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6758`（三类心跳续租失败时立即停止并告警）；`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6467` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6472`（统一 `assertSyncLockOwned` 断言）；`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7166` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7467`（自动同步全链路门控并在 `lock_lost` 时中止）；`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:12299` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:12795`（手动同步关键远程/落盘步骤加锁断言与中止处理）。

2. `P2 UX一致性（已修复）` 冲突弹窗冷却改为“跨标签短锁 + 读写临界区”流程，避免并发双弹窗。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:383` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:386`（冷却锁键与 TTL 常量）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3459` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3516`（获取/校验/释放锁并在临界区内更新冷却时间）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6805`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:15262`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:15303`（主要冲突入口改为 `await` 原子门控）。

3. `P3 性能/同步噪音（已修复）` 保存函数新增“同值短路”，仅在数据实际变更时才落盘并更新时间戳。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4005` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4052`（新增存储快照读取与深比较工具）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4056`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4072`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4086`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4101`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4163`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5169`（各保存函数短路分支）。

4. `P3 跨标签一致性（已修复）` 跨标签监听已覆盖 `user_tags` 和 `bookmarked_replies`，并在变更后触发帖子操作区刷新。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7879`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7880`（新增监听键）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7828` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:7834`（跨标签变更后调用 `refreshAllAuthiActions` 统一刷新标记/收藏状态）。

**可优化点**
1. `getSettings()` 热路径优化（已修复）：`getSettings` 改为返回只读缓存对象，写操作改用 `getSettingsForWrite()` 克隆后再修改。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8014` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8028`（读缓存 + 写时克隆）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:9973`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:11560`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:14841`（写路径改为 `getSettingsForWrite`）。

2. 保存函数写放大优化（已修复）：新增“轻量签名（key 数+快速哈希）+ 深比较兜底”，并缓存已知存储快照，减少重复落盘。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4005` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4090`（快照缓存/轻量签名/比较策略）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4123` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4188`（`saveBlockedThreads/users/tags/bookmarks`）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4240` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4249`（`saveBlockedPosts`）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5251` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5266`（`saveReadProgress`）。

3. 冲突冷却原子门闩（已修复）：冲突冷却锁已复用同步锁体系的 `verifySyncLockOwnership` 校验链路。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3465` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:3490`（冲突冷却锁获取时复用统一锁归属校验）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6555` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6558`（`verifySyncLockOwnership` 公共实现）。

4. 同步相关 UI 模板内联样式较多，长期维护可拆到样式类。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:9052`、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:9200`。

**审阅说明**
- 这是静态审阅结论，未做多标签并发的端到端实测。  
- 如你愿意，我可以下一步直接修前两项（锁失效中止 + 冲突冷却原子化）。

---

**冻结审计矩阵（2026-02-16，基线 commit: `963c6df`）**
- 审计口径：按“功能轴 × 质量轴”逐项静态检查。  
- 功能轴覆盖：同步流程、锁与并发、跨标签同步、存储与迁移、导入导出、帖子/用户屏蔽、阅读进度、收藏回复、用户标记、设置中心、导航与悬浮控件、弹窗与菜单、自动签到、DOM 观察器增量刷新。  
- 质量轴覆盖：正确性、并发一致性、数据完整性、性能、稳定性与容错、可恢复性、安全、兼容性、可维护性、UX 一致性。  
- 说明：兼容性结论为静态评估，未做多浏览器/多油猴实现实测。

**冻结清单修复结果（2026-02-16，本轮已完成）**
1. `P2 跨标签关闭态不收敛（已修复）` 全量刷新入口已改为“开启/关闭双态收敛”，关闭态会统一执行清理路径。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8346` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8392`（跨标签全量仍走 `applyChanges`）；`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:17218` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:17278`（新增 `ensureManagedVisibilityRestored`、关闭态清理、阅读进度/操作栏收敛）。

2. `P2 主开关语义不完整（已修复）` 通用设置主开关已在运行时门控通用能力。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5926` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6047`（全局新标签页拦截与绑定门控）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5693` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:5836`（图片默认隐藏门控）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:14601` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:14957`（阅读进度按钮/指示器/观察器门控）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8748`（界面定制门控）。

3. `P2 标题后缀可逆性不足（已修复）` 标题后缀改为可逆模型，支持改值/清空时即时回收。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8718` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8734`（基准标题解析 + 上次后缀剥离）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8777` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8782`（可逆写回）。

4. `P2 界面定制恢复路径不完整（已修复）` Logo 链接和黄条提示都具备“应用/恢复”双向路径。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8754` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8761`（Logo 原始 href 缓存与恢复）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8770` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:8773`（黄条显示状态恢复）。

5. `P3 同步设置比较顺序敏感（已修复）` 同步设置比较已改为可比较值深比较，不再依赖 `JSON.stringify` 键序。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6078` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6082`（`hasComparableValueChanged(getSyncedSettings(...))`）。

6. `P3 兼容性风险（已修复）` `:has()` 已加入能力检测与回退 class 方案。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:418`（`SUPPORTS_CSS_HAS_SELECTOR`）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:549`（fallback class 样式）、`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4755` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:4784`（运行时 fallback 逻辑）。

7. `P3 导入 key 归一化缺口（已修复）` 导入 `threads/users` 已统一做数字 ID 归一化并处理归一化冲突。  
证据：`/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6176` 到 `/Users/rexxin/Development/S1Plus-Manual/S1Plus.js:6264`（`shouldNormalizeNumericId`、`normalizeNumericId`、冲突时按较新时间戳保留）。

**收口规则（本轮）**
1. 冻结清单 7 项已全部落地，不新增额外功能。  
2. 下一步建议基于同一口径做复审；未在清单内的新发现单独标注为“下一轮候选”，避免范围漂移。  
3. 复审前建议保持当前实现为单一基线，避免并行改动影响问题归因。

---

**同口径复审（2026-02-16，单一基线）**
- 复审口径：沿用本文件“冻结审计矩阵”的功能轴与质量轴，不扩展审计范围。  
- 单一基线标识：  
  `S1Plus.js` SHA-256 = `a1245ce7f8ae2ee99b188644eac46bbd8560c182502b7ae644e9b07f9bbda414`  
  复审记录时间点：2026-02-16（本段更新即为基线审计记录，不再引入文档自哈希）。
- 复审结论：冻结清单 7 项均已在代码路径中闭环，未发现回归到“待修复”状态的项。

**下一轮候选（不并入本轮）**
- 本次同口径复审未新增候选项。
