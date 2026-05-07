# 诊断记录：标题同步状态与调度表现

## 参考文档
- `background-sync-scheduler-review-and-optimization.md` 明确共享 debounce 只优化本地 dirty state 驱动的自动推送；前台 freshness 检查仍是独立的 pull / probe 路径。
- `background-sync-scheduler-implementation-checklist.md` 记录共享 debounce scheduler 的 Phase A-I 已实现，人工验收仍待补充。

## 初始假设
- 如果仍有至少一个 S1 标签页报告前台状态（`visibilityState === "visible" && hasFocus === true`），标题状态会被隐藏；或者状态 owner 不是用户正在观察的那个浏览器标签页标题。
- 回到详情页后反复看到导航栏 `同步中 -> 成功`，可能是前台 probe / follow-up，而不是后台 push debounce。

## 结论
- 修复前，标题状态是 single-owner：当所有 S1 标签页都在后台时，由最早打开且仍存活的 S1 标签页显示标题前缀。非 owner 标签页保持原始标题，所以在浏览器标签页列表里很容易看漏。
- 标题状态不会显示 `pending`；共享 debounce 等待 / settling 阶段在标题里保持静默。标题只显示 `running`、`success`、`failure`、`conflict`。
- 共享后台 scheduler 只合并本地 dirty push。它会在阅读进度 settle 窗口（`20s`）结束或 max wait 命中后开始；它无法知道用户后面还打算继续读其他已打开的帖子。
- 阅读进度本身需要先通过可见 / 已读确认再落盘。一旦写入真实的 `read_progress` 变更，共享 debounce 就会安排推送。
- 切回详情页前台会触发 `handlePendingAutoSyncRecoveryVisibilityChange()`：核心数据快照 resync、pending recovery，然后做前台远端 freshness probe。
- 前台 freshness probe / follow-up 明确不属于共享后台 debounce 的范围。即使没有新的后台 push，它也可能让导航栏显示运行态，因为它正在做 metadata 探测或一次很快的 follow-up。
- same-session / same-device 写入会抑制 reload / toast，但导航栏指示器仍会展示 probe / follow-up 活动，因为它消费统一状态源。

## 已实现修复
- presence 记录新增 `lastActiveAt`。
- 标题状态 owner 现在优先选择 `lastActiveAt` 最新的存活标签页，并以较新的 `createdAt` 作为兜底。
- 运行时决策会用当前标签页的实时 visibility / focus 状态覆盖旧 presence，同时保留已有 `lastActiveAt`。
- 导航栏自动同步指示器新增 `probe` 展示类型：`foreground_probe_in_flight` 使用独立的放大镜视觉状态，与真正同步执行的三个点区分。
