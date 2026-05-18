# 弹窗磨砂玻璃统一样式迁移文档

> **状态**: 进行中（确认类弹窗、Token 配置弹窗、图片查看器、日期选择器、类型 B 轻量浮层与类别 C 覆盖式控件整理已完成）
> **目标**: 统一全屏模态弹窗的磨砂玻璃语言，并按使用场景区分透明度，避免表单/决策弹窗被背景文字干扰

---

## 一、参考样式：设置面板磨砂玻璃（已有）

### 1.1 CSS 变量 — 全屏蒙版层参数

定义在 `S1Plus.js` 全局 CSS 变量区域。

**浅色模式**：
```css
--s1p-overlay-blur: 1.6px;
```

**深色模式**：
```css
--s1p-overlay-blur: 1.8px;
```

### 1.2 全屏蒙版层（overlay backdrop）

适用于 `.s1p-modal`, `.s1p-confirm-modal`, `.s1p-token-config-modal`, `.s1p-image-viewer`：

```css
.s1p-modal,
.s1p-confirm-modal,
.s1p-token-config-modal,
.s1p-image-viewer {
  background-color: transparent;
  -webkit-backdrop-filter: blur(var(--s1p-overlay-blur));
  backdrop-filter: blur(var(--s1p-overlay-blur));
}
```

> 说明：全屏蒙版不再保留全局黑色遮罩变量，只提供统一无色 blur。各弹窗外壳用自身的 Dialog/Shell/Image viewer glass 背景承担层次。

### 1.3 ★ 内容面板磨砂玻璃（核心参考）— 行 5303-5312

```css
.s1p-modal > .s1p-modal-content {
  --s1p-settings-panel-bg: rgba(255, 255, 255, 0.26);
  --s1p-settings-content-bg: var(--s1p-bg);
  --s1p-settings-scrollbar-thumb: rgba(37, 71, 122, 0.42);
  --s1p-settings-scrollbar-thumb-hover: rgba(37, 71, 122, 0.58);
  --s1p-settings-scrollbar-track: transparent;
  background: var(--s1p-settings-panel-bg);
  border: none;
  border-radius: 12px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
  -webkit-backdrop-filter: blur(8px) saturate(1.08);
  backdrop-filter: blur(8px) saturate(1.08);
}
```

**深色模式覆盖** — 行 5314-5319:

```css
@media (prefers-color-scheme: dark) {
  .s1p-modal > .s1p-modal-content {
    --s1p-settings-panel-bg: rgba(30, 41, 59, 0.46);
    --s1p-settings-content-bg: #172033;
    --s1p-settings-scrollbar-thumb: rgba(148, 163, 184, 0.46);
    --s1p-settings-scrollbar-thumb-hover: rgba(148, 163, 184, 0.64);
  }
}
```

**S1 NUX 主题覆盖**：设置面板滚动条不再借用 `.s1p-nux-transition-isolation` CSS 选择器，而是复用脚本已有的 NUX 适配流程。`applyNuxSettingsScrollbarThemeFix()` 会在 `syncNuxThemeModalStyles()` 和 `applyNuxCompatibilityFixes()` 中同步，让滑块颜色跟随 NUX 的 `--prid` / `--pridb`。轨道继续保持透明，并用 `clip-path: inset(0 round 12px)` 裁切原生 scrollbar gutter，避免右侧出现直角沟槽。

```js
modalContent.style.setProperty(
  "--s1p-settings-scrollbar-thumb",
  "var(--prid, rgba(37, 71, 122, 0.42))"
);
modalContent.style.setProperty(
  "--s1p-settings-scrollbar-thumb-hover",
  "var(--pridb, var(--prid, rgba(37, 71, 122, 0.58)))"
);
```

### 1.4 嵌套弹窗防双重模糊 — 行 5993-6002

```css
.s1p-modal ~ .s1p-confirm-modal,
.s1p-modal ~ .s1p-token-config-modal,
.s1p-image-viewer ~ .s1p-confirm-modal,
.s1p-image-viewer ~ .s1p-token-config-modal {
  background: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: none;
}
```

---

## 二、磨砂玻璃分层标准

不同弹窗的信息密度不同，不再所有面板共用同一透明度。

| 层级 | 适用范围 | 浅色背景 | 深色背景 | 说明 |
|------|---------|---------|---------|------|
| Shell glass | 设置面板外壳 | `rgba(255, 255, 255, 0.26)` | `rgba(30, 41, 59, 0.46)` | 设置面板内部已有实底内容区，外壳可以更通透 |
| Dialog glass | 确认/输入/Token/同步选择等决策弹窗 | `var(--s1p-dialog-glass-bg)` = `rgba(255, 255, 255, 0.42)` | `var(--s1p-dialog-glass-bg)` = `rgba(30, 41, 59, 0.58)` | 小表单和决策弹窗需要更稳，避免背景文字抢戏 |
| Image viewer glass | 图片查看器外壳/图片舞台 | 外壳 `rgba(255,255,255,0.42)`；舞台 `rgba(212,221,206,0.72)` | 外壳 `rgba(30,41,59,0.58)`；舞台 `rgba(34,42,50,0.76)` | 全屏蒙版无色磨砂；图片舞台沿用原浅黄绿/深色底色并轻磨砂 |
| Utility glass | Toast、浮动控制 | `var(--s1p-toast-glass-bg)` / `var(--s1p-floating-control-glass-bg)` | 对应深色变量 | 覆盖页面内容的轻量 UI 使用轻磨砂，状态色 Toast 保留语义色 |
| Solid content | 同步对比表格、日期输入、图片读数控件 | `var(--s1p-bg)` | `var(--s1p-bg)` | 信息密集或需要精确阅读的子内容保留实底 |
| Light popover glass | B1/B2/B4/B6/B7/B8 与文档型帮助浮层 | `var(--s1p-popover-glass-bg)` = `rgba(255,255,255,0.52)` | `var(--s1p-popover-glass-bg)` = `rgba(30,41,59,0.76)` | 面板感较强的确认浮层和 tooltip 使用无色、保守轻磨砂，不使用 dialog/shell 透明度 |
| Solid popover | B3/B5 等即时操作菜单 | `var(--s1p-popover-solid-bg)` | `var(--s1p-popover-solid-bg)` | 操作入口菜单保持实底，只统一背景、阴影和圆角；主容器不显示描边 |

Dialog/Shell 层的通用滤镜和结构仍保持一致；Popover 层单独使用 6px blur，最外层容器统一不显示描边：

```css
-webkit-backdrop-filter: blur(8px) saturate(1.08);
backdrop-filter: blur(8px) saturate(1.08);
border-radius: 12px;
border: none;
```

当前代码新增的 dialog / popover 变量：

```css
:root {
  --s1p-dialog-glass-bg: rgba(255, 255, 255, 0.42);
  --s1p-dialog-glass-shadow: 0 18px 44px rgba(0, 0, 0, 0.22);
  --s1p-dialog-glass-divider: rgba(37, 71, 122, 0.16);
  --s1p-popover-glass-bg: rgba(255, 255, 255, 0.52);
  --s1p-popover-glass-shadow: 0 16px 34px rgba(0, 0, 0, 0.2);
  --s1p-popover-solid-bg: var(--s1p-bg);
  --s1p-popover-solid-shadow: 0 10px 24px rgba(var(--s1p-shadow-color-rgb), 0.16);
}

@media (prefers-color-scheme: dark) {
  :root {
    --s1p-dialog-glass-bg: rgba(30, 41, 59, 0.58);
    --s1p-dialog-glass-shadow: 0 18px 44px rgba(0, 0, 0, 0.28);
    --s1p-dialog-glass-divider: rgba(148, 163, 184, 0.2);
    --s1p-popover-glass-bg: rgba(30, 41, 59, 0.76);
    --s1p-popover-glass-shadow: 0 18px 38px rgba(0, 0, 0, 0.32);
    --s1p-popover-solid-bg: var(--s1p-bg);
    --s1p-popover-solid-shadow: 0 12px 28px rgba(0, 0, 0, 0.34);
  }
}
```

> **关键点**: 设置面板外壳可以通透；凡是承载表单、确认、冲突决策、同步选择的弹窗，统一走 Dialog glass。

---

## 三、完整弹窗清单

### 类别 A：全屏模态弹窗（统一磨砂或明确排除）— 12 个

| # | 弹窗 | 用途 | 内容面板选择器 | 创建行号 | 当前背景 | 状态 |
|---|------|------|-------------|---------|---------|------|
| A1 | 设置面板 | S1 Plus 全部设置（7个标签页） | `.s1p-modal > .s1p-modal-content` | 36994 | `rgba(255,255,255,0.26)` + blur | ✅ 已有磨砂 |
| A2 | 确认对话框 | 通用确认/取消（清空数据、屏蔽确认等） | `.s1p-confirm-content` | 35589 | Dialog glass：`0.42` / `0.58` + blur | ✅ 已完成 |
| A3 | 高级确认对话框 | 自定义标题/内容/按钮的增强确认框 | `.s1p-confirm-content` (同上) | 42910 | 继承 A2（共用选择器） | ✅ 已完成 |
| A4 | 输入框弹窗 | 带文本输入区的表单弹窗（编辑屏蔽备注） | `.s1p-confirm-content` (同上) | 35705 | 继承 A2（共用选择器） | ✅ 已完成 |
| A5 | 图片查看器 | 全屏查看图片，支持缩放/平移/翻页/批量保存 | `.s1p-image-viewer__panel` | 23966 | Image viewer glass 外壳 + 半透明深色图片舞台 | ✅ 已完成 |
| A6 | Token配置弹窗 | GitHub Token 过期日期设置（含日期选择器） | `.s1p-token-config-content` | 36568 | Dialog glass：`0.42` / `0.58` + blur | ✅ 已完成，待视觉确认 |
| A7 | 手动屏蔽用户弹窗 | 手动输入用户名/UID 屏蔽用户（含备注） | `.s1p-confirm-content` (同上) | 38530 | 继承 A2（共用选择器） | ✅ 已完成 |
| A8 | 阅读进度详情弹窗 | 阅读记录按时间分组展示，支持按组删除 | `.s1p-confirm-content` (同上) | 46940 | 继承 A2（共用选择器） | ✅ 已完成 |
| A9 | 欢迎/更新弹窗 | 首次安装/版本更新后展示更新内容 | `.s1p-confirm-content` (同上) | 47599 | 继承 A2（共用选择器） | ✅ 已完成 |
| A10 | NUX推荐弹窗 | NUX 主题推荐用户切换到标准主题 | `.s1p-confirm-content` (同上) | 46362 | 继承 A2（共用选择器） | ✅ 已完成 |
| A11 | Token过期警告 | 后台同步 Token 即将到期提醒 | `.s1p-confirm-content` (同上) | 47644 | 继承 A2（共用选择器） | ✅ 已完成 |
| A12 | 同步对比对话框 | 多端数据冲突时展示差异，供用户选择合并 | `.s1p-confirm-content` (同上) | 34220 | 继承 A2（共用选择器） | ✅ 已完成 |

> 注：A2~A4, A7~A12 共 9 个弹窗共享 `.s1p-confirm-content` 选择器，改一处即可覆盖全部。

### 类别 B：绝对定位浮层弹窗 — 8 个

| # | 弹窗 | 选择器 | 创建行号 | 用途 | 样式决策 |
|---|------|--------|---------|------|---------|
| B1 | 用户标记编辑器 | `#s1p-tag-popover-main` | 43254 | 添加/编辑用户标签+颜色选择器 | ✅ Light popover glass |
| B2 | 日期选择器 | `.s1p-date-picker` | 36337 | Token过期日期选择 | ✅ Light popover glass |
| B3 | 帖子内联操作菜单 | `.s1p-inline-action-menu` | 32600 | 帖子旁操作按钮栏 | ✅ Solid popover |
| B4 | 内联确认菜单 | `.s1p-inline-confirm-menu` | 36040 | "屏蔽该帖子/用户？" | ✅ Light popover glass |
| B5 | 标签选项菜单 | `.s1p-tag-options-menu` | 45662 | 标签编辑/删除下拉菜单 | ✅ Solid popover |
| B6 | 标签删除确认 | (复用 `.s1p-inline-confirm-menu`) | 45508 | 删除标签确认 | ✅ Light popover glass |
| B7 | 主题屏蔽选项菜单 | `.s1p-options-menu.s1p-confirm-wrapper:not(.s1p-inline-confirm-menu)` | 43162 | 屏蔽列表中的操作菜单 | ✅ Light popover glass |
| B8 | 通用提示浮层 | `#s1p-generic-display-popover` | 43508 | hover tooltip | ✅ Light popover glass |

> 注：类型 B 不整体套用全屏弹窗的 `0.26` 透明度。B1/B2/B4/B6/B7/B8 和文档型帮助浮层作为小面板或确认提示使用更保守的 Light popover glass；B3/B5 作为纯操作入口菜单保持实底，只统一阴影、圆角和背景变量。

### 类别 C：通知/面板/内部组件 — 12 个

| # | 弹窗 | 选择器 | 创建行号 | 用途 | 磨砂？ |
|---|------|--------|---------|------|--------|
| C1 | 全局Toast | `#s1p-global-toast-root` | 35413 | 页面底部成功/错误/中性消息通知 | ✅ Light utility glass |
| C2 | 设置面板内Toast | (modal内) | 37009 | 设置面板内的操作结果通知 | ✅ Light utility glass |
| C3 | 调试面板 | `#s1p-debug-unified-panel` | 34975 | 开发用统一调试面板（Log/同步诊断/自动同步） | ✅ 已是磨砂玻璃 |
| C4 | 自动同步调试面板 | `#s1p-auto-sync-debug-panel` | 33839 | 调试面板内的自动同步标签页 | ✅ 归入 C3，不单独迁移 |
| C5 | 浮动控制按钮 | `#s1p-floating-controls-wrapper` | 46668 | 右侧悬浮置顶/置底/设置按钮 | ✅ Light utility glass |
| C6 | 通知折叠 | `.s1p-notification-wrapper` | 19531 | 论坛通知帖子的展开/折叠控制 | 不需要（页面内嵌元素，不覆盖其他内容） |
| C7 | 引用折叠 | `.s1p-quote-toggle` | 19430 | 帖子中长引用的展开/折叠控制 | 不需要（同上） |
| C8 | 可折叠区块 | `.s1p-collapsible-header` | 38987 | 设置面板中屏蔽列表等可折叠区域 | 不需要（嵌套在已有磨砂的设置面板内） |
| C9 | 设置Tab导航 | `.s1p-tab-btn` | 36742 | 设置面板内切换各设置页签 | 不需要（同上） |
| C10 | 分段控制器 | `.s1p-segmented-control` | 36820 | 设置面板内选项分段选择（如同步模式） | 不需要（同上） |
| C11 | 列表分页 | `.s1p-list-pagination` | 37192 | 设置面板内长列表翻页控件 | 不需要（同上） |
| C12 | 书签搜索框 | `#s1p-bookmark-search-input` | 38262 | 设置面板内书签列表搜索过滤 | 不需要（同上） |

---

## 四、迁移步骤

### 步骤 1：确认对话框内容面板（`.s1p-confirm-content`）— 已完成

影响所有 A2~A4, A7~A12（共 9 个弹窗），改一处全部生效。

**当前样式** — 行 6003-6016:
```css
.s1p-confirm-content {
  background-color: var(--s1p-bg);
  border-radius: 12px;
  box-shadow: 0 10px 25px -5px ..., 0 10px 10px -5px ...;
  ...
}
```

**目标样式**（改为磨砂玻璃）:
```css
.s1p-confirm-content {
  background: var(--s1p-dialog-glass-bg);
  border: none;
  border-radius: 12px;
  box-shadow: var(--s1p-dialog-glass-shadow);
  -webkit-backdrop-filter: blur(8px) saturate(1.08);
  backdrop-filter: blur(8px) saturate(1.08);
  ...
}
```

**注意事项**:
- `.s1p-confirm-body` 内文字颜色 (`--s1p-t`) 需要确认在磨砂背景上的可读性
- `.s1p-confirm-footer` 当前保持透明，继承父级 `.s1p-confirm-content` 的磨砂背景
- `.s1p-sync-modal .s1p-confirm-footer` 已移除 `background-color: var(--s1p-bg)`，避免手动同步选择弹窗 footer 重新变成实底
- `.s1p-sync-comparison-table` 已改为实底 `var(--s1p-bg)`，避免同步对比内容在玻璃面板上可读性下降
- 嵌套嵌套时 (`.s1p-modal ~ .s1p-confirm-modal`) 的防双重模糊规则已存在，无需额外处理

### 步骤 2：Token 配置弹窗内容面板（`.s1p-token-config-content`）— 已完成，待视觉确认

**当前样式** — 行 5424-5433:
```css
.s1p-token-config-content {
  background: var(--s1p-dialog-glass-bg);
  border: none;
  width: 400px;
  max-width: 90%;
  border-radius: 12px;
  box-shadow: var(--s1p-dialog-glass-shadow);
  -webkit-backdrop-filter: blur(8px) saturate(1.08);
  backdrop-filter: blur(8px) saturate(1.08);
}
```

> Review 备注：`.s1p-token-config-content` 的父级是 `.s1p-token-config-modal`，不会命中 `.s1p-modal > .s1p-modal-content`，因此需要单独声明完整磨砂配方。header/footer 已改为透明继承，只保留浅色/深色下的轻分割线；日期输入框仍保留实底以保证可读性。

**目标样式**:
```css
.s1p-token-config-content {
  background: var(--s1p-dialog-glass-bg);
  border: none;
  border-radius: 12px;
  box-shadow: var(--s1p-dialog-glass-shadow);
  -webkit-backdrop-filter: blur(8px) saturate(1.08);
  backdrop-filter: blur(8px) saturate(1.08);
  ...
}
```

**注意事项**:
- `.s1p-token-config-header` / `.s1p-token-config-footer` 当前透明继承父级磨砂，只保留轻分割线
- 日期选择器 (`.s1p-date-picker`) 是嵌套在此弹窗内打开的，需确认其背景

### 步骤 3：图片查看器面板（`.s1p-image-viewer__panel`）— 已完成

**目标样式**:
```css
.s1p-image-viewer__panel {
  width: min(96vw, 1600px);
  height: min(94vh, 1200px);
  border-radius: 12px;
  background: var(--s1p-image-viewer-panel-bg);
  border: none;
  box-shadow: var(--s1p-image-viewer-panel-shadow);
  -webkit-backdrop-filter: blur(8px) saturate(1.08);
  backdrop-filter: blur(8px) saturate(1.08);
  ...
}
```

> Review 决策更新：图片查看器改为玻璃外壳，但全屏蒙版不使用深色遮罩，和设置面板一样保持无色磨砂。`.s1p-image-viewer__viewport` 沿用原浅色 `#d4ddce` / 深色 `#222a32` 的色相，改成半透明轻磨砂，避免论坛正文直接干扰图片判断。

**注意事项**:
- 全屏蒙版统一是 `background-color: transparent` + blur，不再需要图片查看器单独覆写黑色遮罩。
- 面板自身使用 `blur(8px) saturate(1.08)`。
- 工具栏使用 `--s1p-image-viewer-toolbar-bg` 透明继承玻璃外壳。
- 图片舞台使用 `blur(6px) saturate(1.04)` 的轻磨砂，并保留浅色浅黄绿 / 深色深灰蓝的原设计倾向。
- 缩放/页码胶囊等读数控件继续保持清晰实底，优先保证读数可读性。

### 步骤 4：类别 C 覆盖式控件 — 已完成

本轮只处理覆盖在页面内容之上的轻量 UI，不处理页面内嵌控件：

```css
.s1p-toast-notification {
  background: var(--s1p-toast-glass-bg);
  border: none;
  box-shadow: var(--s1p-toast-glass-shadow);
  -webkit-backdrop-filter: blur(8px) saturate(1.08);
  backdrop-filter: blur(8px) saturate(1.08);
}

#s1p-controls-handle,
#s1p-floating-controls a,
#s1p-floating-controls button {
  background: var(--s1p-floating-control-glass-bg);
  box-shadow: var(--s1p-floating-control-glass-shadow);
  -webkit-backdrop-filter: blur(8px) saturate(1.08);
  backdrop-filter: blur(8px) saturate(1.08);
}
```

**处理结果**:
- C1/C2 Toast 使用 Light utility glass；成功/错误状态保留状态色，但改为半透明状态色玻璃。
- C3 调试面板已是磨砂玻璃风格，不重复迁移。
- C4 自动同步调试面板是 C3 内部标签页，归入 C3。
- C5 浮动控制把手和按钮使用 Light utility glass。
- C6~C12 是页面内嵌或设置面板内部控件，不迁移。

---

## 五、迁移后需要验证的场景

- [ ] 在浅色/深色/NUX主题下分别验证
- [x] 静态检查确认框在设置面板之上嵌套打开时命中防双重模糊 selector
- [ ] 确认框带输入框（textarea）的可读性
- [ ] 确认框带自定义HTML（欢迎弹窗、同步对比）的显示效果
- [ ] 图片查看器无色全屏蒙版 + 主题色轻磨砂图片舞台的看图可读性
- [ ] 全局 Toast / 设置面板内 Toast 的 Light utility glass 显示效果
- [ ] 浮动控制把手和按钮的 Light utility glass 在帖子列表/阅读页上的可见性
- [ ] Token配置弹窗 + Light popover 日期选择器嵌套显示
- [ ] B1/B2/B4/B6/B7/B8 与文档型帮助浮层的 Light popover glass 在帖子文字、头像、表格线背景上的可读性
- [ ] B3/B5 的 Solid popover 是否保持清晰、轻、稳定
- [ ] 窄屏/移动端的弹窗显示

---

## 六、2026-05-17 Review 记录

### 已确认可继续保留

- `.s1p-confirm-content` 已改为 Dialog glass，覆盖 A2~A4、A7~A12，也覆盖手动同步选择/冲突对比弹窗。
- `.s1p-modal`、`.s1p-confirm-modal`、`.s1p-token-config-modal` 与 `.s1p-image-viewer` 的全屏蒙版统一使用透明背景，只保留无色 blur。
- `.s1p-confirm-footer` 保持无自有背景；手动同步弹窗的 `.s1p-sync-modal .s1p-confirm-footer` 已不再覆盖实底。
- `.s1p-token-config-content` 已改为 Dialog glass，header/footer 透明继承，日期输入框保留实底。
- `.s1p-date-picker` 已改为无外框的 Light popover glass，选中日期与 hover 状态保持实底/高对比。
- `.s1p-tag-popover` 已使用 Light popover glass，透明度高于全屏 Dialog glass；用户标记编辑器主容器不显示外框。
- `.s1p-generic-display-popover` 与 `.s1p-generic-display-popover-doc` 已使用 Light popover glass；紧凑短 tooltip 继续通过 `max-content` 和 `nowrap` 避免换行成竖排。
- `.s1p-inline-confirm-menu`、`.s1p-confirm-card`、`.s1p-options-menu.s1p-confirm-wrapper` 使用 Light popover glass；带备注输入框的确认菜单外层保持透明，内部确认条和备注区各自轻磨砂。
- `.s1p-inline-action-menu`、`.s1p-tag-options-menu` 保持 Solid popover；纯操作入口主容器不显示描边。
- S1 NUX 启用时，设置面板内部滚动条滑块会跟随 NUX 的 `--prid` / `--pridb`；track 保持透明并裁切圆角，避免 NUX 的 `--bg` 轨道形成直角沟槽。
- `.s1p-image-viewer` 全屏蒙版已改为无色磨砂；`.s1p-image-viewer__panel` 是玻璃外壳；`.s1p-image-viewer__viewport` 沿用浅黄绿/深色底并改为轻磨砂图片舞台。
- `.s1p-toast-notification` 已改为 Light utility glass；success/error 保留状态色但改为半透明状态色玻璃。
- `#s1p-controls-handle` 与 `#s1p-floating-controls` 内按钮已改为 Light utility glass。
- `#s1p-debug-unified-panel` 已经是磨砂玻璃风格；`#s1p-auto-sync-debug-panel` 作为调试面板内部标签页归入 C3，不单独迁移。
- 自定义 UI 的最外层容器统一不显示描边；输入框、按钮、分割线、表格和设置面板内部列表项仍保留必要的功能性边界。
- 同步对比表格使用实底 `var(--s1p-bg)`，表头改为低调的 `var(--s1p-sub)`，可读性比直接透玻璃更稳。
- 类型 B 已按“轻量浮层统一样式”处理：B1/B2/B4/B6/B7/B8 与文档型帮助浮层轻磨砂，B3/B5 实底。

### 仍需处理的问题

- **手动视觉验证未完成**：Dialog glass 新透明度、A5 图片查看器无色全屏蒙版和主题色轻磨砂图片舞台、C1/C2 Toast、C5 浮动控制、Light popover 日期选择器、B1/B4/B6/B7/B8/文档型帮助浮层轻磨砂、B3/B5 实底浮层、设置面板滚动条跟随 NUX 主题、浅色、深色、NUX、窄屏、Token 配置、输入框弹窗、欢迎弹窗、同步选择/冲突对比弹窗都还需要浏览器实测。

### 建议下一步

1. 刷新本地脚本后打开 Token 有效期、日期选择器、普通确认、手动同步选择/冲突对比弹窗，确认背景文字不再抢戏。
2. 逐个打开 B1~B8 浮层，确认 B1/B2/B4/B6/B7/B8 和文档型帮助浮层有轻磨砂但文字清楚，B3/B5 保持实底。
3. 打开设置面板并滚动长标签页，确认 NUX 启用时滚动条滑块颜色跟随当前 NUX 主题，标准主题下使用 S1 Plus fallback；同时右侧滚动槽不出现直角。
4. 打开图片查看器，确认全屏蒙版不发黑，外壳和工具栏有磨砂玻璃感，图片舞台保留浅黄绿/深色调且不影响透明图/暗色图判断。
5. 触发全局 Toast、设置面板内 Toast 和浮动控制，确认类别 C 覆盖式控件轻磨砂但不喧宾夺主。
6. 做一次浅色/深色/NUX 的手动截图验收。

---

## 七、相关文件行号索引

| 内容 | 行号范围 |
|------|---------|
| CSS 变量 — 浅色蒙版 blur | 全局变量区 |
| CSS 变量 — 深色蒙版 blur | 深色变量区 |
| 蒙版层无色磨砂规则 | 全局弹层 CSS |
| 设置面板内容磨砂（参考） | 5303-5312 |
| 设置面板深色模式 | 5314-5319 |
| 确认框内容当前样式 | 6003-6016 |
| Token弹窗内容当前样式 | 5424-5433 |
| 嵌套防双重模糊 | 5993-6002 |
| 图片查看器面板当前样式 | 7237-7242 |
| 创建确认框函数 | 35589 |
| 创建高级确认框函数 | 42910 |
| 创建输入框弹窗函数 | 35705 |
| 创建图片查看器 | 23966 |
| 创建Token配置弹窗 | 36568 |
| 创建手动屏蔽弹窗 | 38530 |
| 创建阅读进度详情弹窗 | 46940 |
| 创建欢迎弹窗 | 47599 |
| 创建NUX推荐弹窗 | 46362 |
| Token过期警告 | 47644 |
| 同步对比对话框 | 34220 |
