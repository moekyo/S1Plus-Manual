# 刷新后自动滚到底部排查记录

## 问题现象

- 刷新 Stage1st 页面后，视口偶尔会落到页面底部附近。
- 问题不是必现；同一页面连续刷新时，可能某次停在顶部，某次在 `pageshow` 后突然跳到底部。
- 已观察到的复现页包含论坛列表页，例如 `/2b/forum-157-1.html`。

## 日志结论

滚动诊断日志显示，异常轮次的加载流程从 `document-start` 到 `pageshow` 都保持在顶部：

- `scrollY=0`
- `hash=""`
- `navigationType="reload"`
- `history.scrollRestoration="auto"`
- 没有用户交互
- 没有同步拉取触发的 `location.reload()`

异常发生在 `pageshow` 后约 8ms：浏览器触发一次原生 `window_scroll`，直接从 `scrollY=0` 跳到 `scrollY=maxScrollY`。这说明触发点不是 S1 Plus 初始化任务、MutationObserver、阅读进度、同步刷新，也不是悬浮控件的“返回底部”按钮，而是浏览器原生滚动恢复在 reload 后异步恢复了一个陈旧位置。

## 根因判断

根因是 reload 时浏览器的原生滚动恢复与论坛页面加载时序形成竞态。

Chrome 会在 `history.scrollRestoration="auto"` 时尝试恢复历史滚动位置。异常轮次里，恢复动作晚于 `pageshow`，并且恢复目标被夹到当前页面的最大可滚动位置，所以表现为“刷新后自动滚到底部”。

## 已落地修复

`S1Plus.js` 中保留了一个窄范围 reload scroll guard：

- 在 `pagehide` / `beforeunload` 时，用 `sessionStorage` 记录当前页面的滚动位置。
- 下一次同 URL 且 `navigationType="reload"` 时，如果上一轮记录显示刷新前在顶部附近，且当前 URL 没有 hash，才临时介入。
- 介入时短暂设置 `history.scrollRestoration="manual"`，避免浏览器恢复陈旧滚动位置。
- 如果加载后短窗口内仍无用户交互地跳到页面底部附近，则拉回到刷新前记录的顶部位置。
- `pageshow` 后 2.5 秒释放保护，并恢复原来的 `history.scrollRestoration`。

这避免了全局禁用滚动恢复，因此用户在页面中部刷新后仍可保留浏览器默认恢复体验。

## 清理结果

临时滚动诊断系统已经移除：

- 不再写入 `GM_setValue("s1p_scroll_debug_events", ...)`。
- 不再暴露 `__S1P_SCROLL_DEBUG__` / `__s1pScrollDebug` 控制台 API。
- 不再记录初始化阶段、MutationObserver、同步 reload 等调试事件。
- 本地 loader 不需要 `unsafeWindow` grant。

保留的持久状态只有当前标签页内的 `sessionStorage` key：`s1p_reload_scroll_guard_state`。它用于下一次同页 reload 的窄范围判断，不参与 GM 存储或跨标签同步。
