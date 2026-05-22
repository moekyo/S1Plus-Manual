# 调试面板收起/展开功能

## 概述

为调试面板新增"收起"状态，允许用户将面板最小化为一个右下角圆形悬浮按钮（FAB），点击可重新展开。状态跨页面持久化。

---

## 状态机

面板从二元（展开 / 关闭）变为三元状态：

```
         ┌─────────┐
    ┌───→│  关闭    │←──────┐
    │    │ (全隐藏)  │       │
    │    └────┬─────┘       │
    │ 版本号  │ 版本号        │ FAB悬停2s
    │ 触发    │ 触发         │ 再点X
    │    ┌───▼──────┐       │
    │    │  展开    │───────┘
    │    │ (面板可见) │
    │    └──┬──────┘
    │ 点击  │  点击header
    │ FAB  │  收起按钮
    │    ┌──▼──────┐
    └────┤  收起    │
         │ (仅FAB)  │
         └─────────┘
```

### 状态转换规则

| 当前状态 | 触发方式 | 目标状态 | 说明 |
|---|---|---|---|
| 展开 | 点击 header 收起按钮 | 收起 | Hero 动画面板缩向 FAB |
| 展开 | 点击 header X 按钮 | 关闭 | 停日志采集器，全隐藏 |
| 展开 | 版本号彩蛋触发 | 关闭 | `toggleDebugUnifiedPanel` |
| 收起 | 点击 FAB | 展开 | Hero 动画面板从 FAB 扩出 |
| 收起 | 版本号彩蛋触发 | 关闭 | 停日志采集器，FAB 消失 |
| 收起 | FAB 悬停 2s 后点 X | 关闭 | 图标从 bug 变为 X 再关闭 |
| 关闭 | 版本号彩蛋触发 | 展开 | 始终回到展开（不记住收起状态） |

---

## 关键设计决策

### 持久化方案

- **存储键**: 修改现有 `s1p_debug_console_visible`，从布尔值改为枚举字符串
  - `"expanded"` — 面板完整可见
  - `"collapsed"` — 仅 FAB 可见
  - `"closed"` — 全隐藏
- **兼容性**: 无需数据迁移（当前唯一用户）

### 日志采集器行为

| 状态 | 采集器 |
|---|---|
| 展开 | 运行 |
| 收起 | 运行 |
| 关闭 | 停止 |

### 页面加载行为

根据持久化状态决定初始化方式：
- `"expanded"` — 创建完整面板（现有行为）
- `"collapsed"` — 仅创建 FAB，不创建面板 DOM（避免闪烁），启动日志采集器
- `"closed"` — 不创建任何 UI

---

## UI 规格

### 收起按钮

- **位置**: header 内，X 关闭按钮右侧
- **图标**:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M12 15.6315L20.9679 10.8838L20.0321 9.11619L12 13.3685L3.9679 9.11619L3.03212 10.8838L12 15.6315Z"/>
</svg>
```
- **样式**: 参考 X 关闭按钮（`s1p-settings-close-btn`）

### 圆形悬浮按钮 (FAB)

- **直径**: 44px
- **位置**: 圆心 = 面板右下角顶点（`border-radius` 之前的那个角）
- **层级**: 在 `#s1p-debug-panel-host` 内部，`z-index` 高于面板
- **视觉风格**: 磨玻璃（`backdrop-filter`）+ 阴影，与面板 `#s1p-debug-unified-panel.s1p-debug-panel` 一致
- **图标（默认）**:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
  <path d="M13 19.9C15.2822 19.4367 17 17.419 17 15V12C17 11.299 16.8564 10.6219 16.5846 10H7.41538C7.14358 10.6219 7 11.299 7 12V15C7 17.419 8.71776 19.4367 11 19.9V14H13V19.9ZM5.5358 17.6907C5.19061 16.8623 5 15.9534 5 15H2V13H5V12C5 11.3573 5.08661 10.7348 5.2488 10.1436L3.0359 8.86602L4.0359 7.13397L6.05636 8.30049C6.11995 8.19854 6.18609 8.09835 6.25469 8H17.7453C17.8139 8.09835 17.88 8.19854 17.9436 8.30049L19.9641 7.13397L20.9641 8.86602L18.7512 10.1436C18.9134 10.7348 19 11.3573 19 12V13H22V15H19C19 15.9534 18.8094 16.8623 18.4642 17.6907L20.9641 19.134L19.9641 20.866L17.4383 19.4077C16.1549 20.9893 14.1955 22 12 22C9.80453 22 7.84512 20.9893 6.56171 19.4077L4.0359 20.866L3.0359 19.134L5.5358 17.6907ZM8 6C8 3.79086 9.79086 2 12 2C14.2091 2 16 3.79086 16 6H8Z"/>
</svg>
```
- **图标（悬停 2s 后）**: X 关闭图标（复用 `MODAL_CLOSE_BUTTON_ICON_SVG`）

### 动画

- **技术**: FLIP（First, Last, Invert, Play）
- **时长**: 300ms
- **缓动**: `cubic-bezier(0.34, 1.56, 0.64, 1)`
- **效果**: 面板以右下角为 `transform-origin` 缩放/淡出，FAB 同步反向缩放/淡入，形成面板"收缩变身"为 FAB 的视觉错觉

---

## 实现清单

### CSS 变更

- [ ] `.s1p-debug-collapse-btn` — header 收起按钮样式，参考 `s1p-settings-close-btn`
- [ ] `#s1p-debug-fab` — FAB 容器，`position: absolute`，`width/height: 44px`，`border-radius: 50%`，磨玻璃背景 + 阴影
- [ ] `#s1p-debug-fab.s1p-fab-hidden` — FAB 隐藏状态
- [ ] `#s1p-debug-fab .s1p-fab-icon` / `.s1p-fab-x-icon` — 两个图标的切换过渡
- [ ] `.s1p-debug-panel.s1p-collapsing` / `.s1p-debug-panel.s1p-expanding` — hero 动画状态类
- [ ] `#s1p-debug-unified-panel.s1p-collapsed` — 收起状态（暂时保留 DOM 但不可见，动画完成后设为 `display: none`）

### JS 变更

- [ ] 新增 `DEBUG_CONSOLE_STATE_EXPANDED / COLLAPSED / CLOSED` 常量
- [ ] 修改 `isDebugConsolePersistentlyVisible()` — 返回 `true` 当 state 为 expanded 或 collapsed
- [ ] 修改 `setDebugConsolePersistentlyVisible()` — 接受枚举
- [ ] 新增 `getDebugConsoleState()` — 读存储返回枚举，默认 `"closed"`
- [ ] 新增 `setDebugConsoleState(state)` — 写存储
- [ ] 修改 `createS1pDebugPanelShell()` — 在 header 增添加收起按钮 + 点击 handler
- [ ] 新增 `createDebugPanelFAB()` — 创建悬浮按钮 DOM，含悬停计时器和点击处理
- [ ] 新增 `collapseDebugPanel(panel, fab)` — FLIP 动画收起面板，显示 FAB，更新持久化状态
- [ ] 新增 `expandDebugPanel(panel, fab)` — FLIP 动画展开面板，隐藏 FAB，更新持久化状态
- [ ] 修改 `toggleDebugUnifiedPanel()` — 三态逻辑：展开/收起→关闭，关闭→展开
- [ ] 修改 `initializeDebugUnifiedPanel()` — 收起状态仅创建 FAB 不创建面板
- [ ] 修改 `hideDebugUnifiedPanel()` — 关闭时同时移除 FAB
- [ ] 修改 deferred 阶段（约 L49554）— 根据状态初始化 FAB / 面板 / 无
- [ ] 修改 `document-start` 阶段（约 L49660）— 日志采集器启动检查适配 collapsed 状态

### 常量

- `DEBUG_HOVER_REVEAL_MS = 2000` — FAB 悬停后切换到 X 图标的延迟
