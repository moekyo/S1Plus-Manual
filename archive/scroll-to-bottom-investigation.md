# 刷新后自动滚到底部排查记录

## 问题现象

- 刷新 Stage1st 页面后，视口偶尔会落到页面底部附近。
- 刷新前可能在顶部，也可能在页面中间。
- 目前不是必现，也没有只限定在列表页或帖子页；列表页、帖子页以外的页面也可能出现。

## 当前代码判断

- 目前排查到的 S1 Plus 代码里，没有普通页面加载后主动执行“滚到底部”的逻辑。
- 代码中确实存在滚到底部调用，但它属于增强悬浮控件的“返回底部”按钮，只应在用户点击时触发。
- 设置弹窗里也有少量 `scrollIntoView()`，但它们只作用于设置弹窗中的同步设置项，不属于普通刷新流程。

## 当前假设

- 更可疑的是浏览器原生滚动位置恢复、论坛自身 DOM 加载时序、S1 Plus 对页面布局的修改共同形成竞态。
- 刷新时浏览器会尝试恢复原来的 `scrollY`。
- 如果恢复发生时页面高度暂时较短，浏览器可能把目标滚动位置夹到当时的最大滚动位置，也就是接近底部。
- 随后论坛内容、图片、脚本插入或 S1 Plus 的屏蔽/隐藏/阅读进度/图片处理等逻辑继续改变页面高度，于是最终表现为“刷新后莫名其妙到了底部”。

## 临时诊断策略

- `S1Plus.js` 中已经加入临时滚动诊断。
- 这套诊断默认开启，不需要用户在控制台里手动开启。
- 不做设置页开关；这不是正式功能。
- 等根因确认并修复后，应该直接移除这套临时诊断代码。

## 日志保存方式

- 日志通过 `GM_setValue("s1p_scroll_debug_events", ...)` 保存。
- 使用最多 120 条的环形缓冲区。
- 日志会跨刷新保留，所以即使问题发生在刷新过程中，刷新后的页面仍然可以读取上一轮记录。

## 控制台命令

这些命令只是用来查看或管理已经捕获的日志，不是用来开启诊断。

```js
__S1P_SCROLL_DEBUG__.table()
```

打印简化表格，适合第一眼查看。

```js
__S1P_SCROLL_DEBUG__.dump()
```

返回完整事件对象，适合复制出来进一步分析。

```js
__S1P_SCROLL_DEBUG__.clear()
```

清空已保存的诊断日志。

```js
__S1P_SCROLL_DEBUG__.mark("这里写标记")
```

手动插入一条标记，方便对照自己的操作。

## 复现后重点看什么

- 优先找 `unexpected_bottom_candidate` 事件。
- 看它前后的事件，尤其是：
  - `phase`
  - `scrollY`
  - `maxScrollY`
  - `distanceToBottom`
  - `scrollHeight`
  - `hash`
  - `navigationType`
  - `scrollRestoration`
  - `lastUserInteractionAgeMs`
  - `auto_pull_reload_*`
  - `manual_*_reload_*`

## 当前已记录的关键节点

- `scroll_debug_lifecycle_init`
- `dom_content_loaded`
- `pageshow`
- `window_load`
- `window_scroll`
- `visibilitychange`
- `pagehide`
- `beforeunload`
- `init_phase_start`
- `init_phase_end`
- `body_ready_detected`
- `apply_changes_start`
- `apply_changes_end`
- `dom_observer_apply_start`
- `dom_observer_apply_end`
- `auto_pull_reload_scheduled`
- `auto_pull_reload_fire`
- `manual_force_pull_reload_scheduled`
- `manual_force_pull_reload_fire`
- `manual_initial_pull_reload_scheduled`
- `manual_initial_pull_reload_fire`
- `manual_pull_reload_scheduled`
- `manual_pull_reload_fire`

## 后续处理原则

- 先用日志判断到底是浏览器滚动恢复、论坛锚点跳转、同步刷新，还是 S1 Plus 的布局变化触发了异常。
- 在确认根因前，不直接改成 `history.scrollRestoration = "manual"`，避免破坏正常刷新恢复位置的体验。
- 修复后删除临时诊断代码和本文档中不再需要的临时说明。
