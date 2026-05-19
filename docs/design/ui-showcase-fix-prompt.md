# UI 组件展示面板 — 修复提示

> 以下提示用于指导 ChatGPT 修复 S1Plus.js 中"UI 组件"调试面板标签页的现有实现。

---

## 背景

S1Plus.js（Tampermonkey 用户脚本）的调试面板中新增了第 4 个标签页"UI 组件"，用来展示脚本中所有自定义 UI 控件的交互式预览。代码已实现但存在三类问题，需要基于现有代码修复。

### 文件说明

- **S1Plus.js** — 用户脚本主文件，所有修改只在这个文件内
- 新增代码位于 `UI_COMPONENT_CATEGORIES` 起始行到 `createDebugUIComponentsTabContent` 结束行之间
- 修改点还包括 `DEBUG_UNIFIED_TABS` 数组和 `initializeDebugUnifiedPanel()` 的注册行

---

## 问题 1：视觉风格与其他调试面板不一致

现有调试面板使用暗色玻璃拟态风格，但 UI 展示面板用的全是浅色主题。

### 当前状态（错误）

```css
/* sidebar */
.s1p-ui-showcase-sidebar {
  border-right: 1px solid var(--s1p-pri);
  background: var(--s1p-bg);           /* 浅色背景 */
}
.s1p-ui-showcase-cat-btn:hover {
  background: var(--s1p-sub);          /* 浅色 hover */
}
.s1p-ui-showcase-cat-btn.active {
  background: var(--s1p-sec);          /* 主题色 */
  color: var(--s1p-white);
}

/* variant 行 */
.s1p-ui-showcase-variant {
  border: 1px solid var(--s1p-sub);    /* 浅色边框 */
  background: var(--s1p-bg);           /* 浅色背景 */
}

/* section 标题 */
.s1p-ui-showcase-section-title {
  font-size: 14px; font-weight: 700; color: var(--s1p-t);
}
.s1p-ui-showcase-section-desc {
  font-size: 11px; color: var(--s1p-desc-t); font-family: monospace;
}

/* section 标题底部分隔线 */
.s1p-ui-showcase-section-header {
  border-bottom: 1px solid var(--s1p-pri);
}
```

### 目标状态（参考调试面板 CSS L3121-L3170）

```css
.s1p-debug-panel {
  background: color-mix(in srgb, var(--s1p-bg-alt) 88%, black 12%);
  border: none;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  border-radius: 12px;
}
.s1p-debug-panel .s1p-debug-panel-title     { font-size: 13px; font-weight: 700; }
.s1p-debug-panel .s1p-debug-panel-group-label { font-size: 11px; font-weight: 700; color: var(--s1p-desc-t); }
.s1p-debug-panel .s1p-debug-btn {
  min-height: 30px; padding: 6px 8px; font-size: 12px;
}
/* 暗色玻璃拟态下的半透明表面 */
#s1p-debug-unified-panel {
  --s1p-debug-console-surface-soft: #eef2f7;
  --s1p-debug-console-panel-bg: rgba(255, 255, 255, 0.08);
}
```

### 修复要求（逐条对照）

| 选择器 | 当前值 | 改为 |
|--------|--------|------|
| `.s1p-ui-showcase-sidebar` | `background: var(--s1p-bg); border-right: 1px solid var(--s1p-pri)` | `background: var(--s1p-debug-console-panel-bg); border-right: 1px solid color-mix(in srgb, var(--s1p-pri) 20%, transparent)` |
| `.s1p-ui-showcase-cat-btn` | 12px, `color: var(--s1p-desc-t)` | 11px, `font-weight: 600`, `color: var(--s1p-desc-t)` 保持 |
| `.s1p-ui-showcase-cat-btn:hover` | `background: var(--s1p-sub); color: var(--s1p-t)` | `background: color-mix(in srgb, var(--s1p-pri) 15%, transparent); color: var(--s1p-t)` |
| `.s1p-ui-showcase-cat-btn.active` | 保持 | 保持（`var(--s1p-sec)` + `var(--s1p-white)`） |
| `.s1p-ui-showcase-variant` | `border: 1px solid var(--s1p-sub); background: var(--s1p-bg); border-radius: 6px` | `border: none; background: color-mix(in srgb, var(--s1p-debug-console-surface-soft) 90%, transparent); border-radius: 6px` |
| `.s1p-ui-showcase-section-title` | 14px | 13px（匹配 `.s1p-debug-panel-title`） |
| `.s1p-ui-showcase-section-desc` | 保持 | 保持 |
| `.s1p-ui-showcase-section-header` | `border-bottom: 1px solid var(--s1p-pri)` | `border-bottom: 1px solid color-mix(in srgb, var(--s1p-pri) 20%, transparent)` |
| `.s1p-ui-showcase-variant-label` | 11px, `color: var(--s1p-desc-t)` | 保持（字体和颜色匹配 `.s1p-debug-panel-group-label`） |

---

## 问题 2：组件渲染与实际差距大

### 2a. 确认栏按钮 — 严重错误

**当前展示**（用文字矩形按钮）：
```html
<button class="s1p-confirm-action-btn s1p-btn s1p-btn-sm">确认</button>
<button class="s1p-confirm-action-btn s1p-btn s1p-btn-sm s1p-danger">取消</button>
```

**实际正确的确认栏按钮**（`buildConfirmationMarkup`，L36865-L36925）是**圆形 28x28 纯图标按钮**，SVG 作背景图：
```html
<button class="s1p-confirm-action-btn s1p-confirm"></button>   <!-- checkmark SVG 背景 -->
<button class="s1p-confirm-action-btn s1p-cancel"></button>    <!-- X SVG 背景 -->
```
```css
.s1p-confirm-action-btn { width: 28px; height: 28px; border-radius: 50%; background-size: 55%; }
```

**修复**：把确认栏 variant 的按钮 class 改为纯 `s1p-confirm-action-btn s1p-confirm` 和 `s1p-confirm-action-btn s1p-cancel`，**严禁混入** `s1p-btn`、`s1p-btn-sm`、`s1p-danger` 等 class。按钮内部不要文字。

分隔符用 `<span class="s1p-confirm-separator"></span>`（CSS 通过 `border-left` 实现竖线），不要用文字 `|`。

确认文本用 `<span class="s1p-confirm-text">确认执行此操作？</span>`。

### 2b. 功能开关 wrapper 层级不对

**当前**：
```html
<div class="s1p-feature-toggle"><div class="s1p-feature-toggle-item"><span>示例功能</span>...-->
```

**正确结构**（参考 `buildPrimaryFeatureToggleHtml`）：
```html
<div class="s1p-settings-group">
  <div class="s1p-settings-item s1p-feature-toggle-item">
    <label class="s1p-settings-label s1p-settings-section-title-label">示例功能</label>
    <label class="s1p-switch"><input type="checkbox" checked><span class="s1p-slider"></span></label>
  </div>
</div>
```

### 2c. 设置分组卡片多余边框

当前 `.s1p-settings-group` 上写了 `border:1px solid var(--s1p-pri); border-radius:8px`（内联 style）。真实的 `.s1p-settings-group` 没有边框。去掉这些装饰。

设置项的 label 需要用 `<label class="s1p-settings-label">`，当前的 `<span>` 没有样式。

### 2d. 分段控制器多余内联样式

当前 `.s1p-segmented-control-slider` 和 `.s1p-segmented-control-option` 上写了大量与 CSS 已有规则重复的 `style="..."`（`position:relative`, `z-index:1`, `padding:4px 12px`, `border-radius:4px`, `width:52px`，各种颜色属性等）。

**规则**：CSS 已有的属性一律不要重复写在 `style=""` 里。slider 的 `width:52px` 是硬编码，真实场景由 JS 动态计算——这里可以保留一个静态宽度声明（模拟选中"选项A"的 slider 位置），但其余与 CSS 重复的全部去掉。

### 2e. s1p-primary 按钮缺少全局样式

当前 `s1p-primary` 只在 `.s1p-item-actions .s1p-btn.s1p-primary` 作用域内有蓝色样式。面板内不在该作用域下，显示为普通灰色。

在面板 `<style>` 中补充：
```css
.s1p-ui-showcase-panel .s1p-btn.s1p-primary {
  background-color: #3b82f6; color: var(--s1p-white);
}
.s1p-ui-showcase-panel .s1p-btn.s1p-primary.s1p-ui-force-hover {
  background-color: #2563eb;
}
```

### 2f. 全面清理与 CSS 重复的内联样式

整个面板中大量元素带着 `style="..."` 重复声明 CSS 已有规则。

**保留规则**（以下情况允许保留内联 style）：
1. `disabled` 属性已足够，不需要额外内联样式
2. 需要覆盖 CSS 变量值时（如 tag 颜色 `style="background-color:var(--s1p-tag-red)"`，因为 class 名只能控制 6 种颜色中的一个，不同颜色必须内联）
3. 确实没有被任何 CSS class 覆盖的布局属性（极少）

**删除规则**（以下内联样式一律删除，CSS class 已覆盖）：
- `display:flex` / `display:inline-flex` / `display:inline-block` / `display:block`
- `align-items:center` / `justify-content:space-between`
- `padding`, `margin`, `gap`（已有 class 定义）
- `font-size`, `font-weight`（已有 class 定义）
- `color`, `background-color`（除非是动态 tag 颜色）
- `border-radius`（已有 class 定义）
- `cursor:pointer`（已有 class 定义）
- `position:relative` / `position:absolute` / `z-index`（分段控制器场景已有CSS）

---

## 问题 3：弹窗按钮点了没反应

### 3a. createAdvancedConfirmationModal 参数形状错误

**当前调用**（错误 — 传了一个 object）：
```js
createAdvancedConfirmationModal({
  title: "...", bodyHtml: "...", buttons: [...]
})
```

**实际签名**（4 个独立参数）：
```js
createAdvancedConfirmationModal(title, bodyHtml, buttons, options = {})
// title: string
// bodyHtml: string
// buttons: Array<{text, class, onClick, closeOnClick}>
// options: { modalClassName, allowTitleHtml, allowBodyHtml, onDismiss }
```

**修复为**：
```js
createAdvancedConfirmationModal(
  "高级确认弹窗",
  "<div><p>这是高级确认弹窗的 <strong>HTML 内容</strong>。</p></div>",
  [
    { text: "取消", class: "s1p-btn s1p-danger", onClick: () => {}, closeOnClick: true },
    { text: "确认", class: "s1p-btn", onClick: () => { showMessage("已确认", "success"); }, closeOnClick: true }
  ]
)
```

### 3b. openS1pImageViewer 参数类型错误

**当前调用**（错误 — 传了数组）：
```js
openS1pImageViewer([{url:"...", filename:"..."}, ...], 0)
```

**实际签名** `openS1pImageViewer(sourceUrl, options = {})`，`sourceUrl` 必须是**字符串 URL**，函数内部调用 `new URL(sourceUrl)` 解析。

**修复**：移除图片查看器预览按钮，因为面板场景下无真实图片上下文。或者改为：
```js
openS1pImageViewer("https://picsum.photos/800/600")
```

### 3c. createDatePicker 参数缺失

**当前调用**（错误 — 少了一个参数，第二参数类型错误）：
```js
createDatePicker(fakeInput, () => {})  // initialDate 位置传了函数
```

**实际签名**：`createDatePicker(inputEl, initialDate(Date), onSelect(fn))`

**修复为**：
```js
const dateInput = target.closest(".s1p-ui-showcase-variant").querySelector("input[readonly]");
if (dateInput) {
  createDatePicker(dateInput, new Date(), (selectedDate) => {
    dateInput.value = selectedDate.toISOString().slice(0, 10);
  });
}
```

### 3d. showFirstTimeWelcomeIfNeeded 行为不可控

该函数读取 `GM_getValue` 检查版本标记，已展示过的版本不弹窗。点按钮没反应是**预期行为**。

**修复**：移除欢迎弹窗按钮，改为用一个普通确认弹窗占位：
```js
createConfirmationModal(
  "欢迎弹窗",
  "实际弹窗由首次运行/版本更新触发，此处仅展示入口",
  "确认", "取消",
  () => {}, () => {}
)
```
或者完全移除这个入口。

---

## 问题 4：更新设计文档

更新 `docs/design/ui-showcase-panel.md`：

1. 第 9 节"悬而未决"替换为"已知问题与修复记录"，列出上述所有已修复的问题
2. 在文档末尾新增一节"依赖函数签名速查"：

```
createConfirmationModal(title, subtitle, confirmText, cancelText, onConfirm, onCancel)
createInputModal(title, subtitle, placeholder, confirmText, cancelText, onSubmit)
createAdvancedConfirmationModal(title, bodyHtml, buttons, options)
createDatePicker(inputEl, initialDate: Date, onSelect: fn)
showMessage(message, type?: "success" | "error")
openS1pImageViewer(sourceUrl: string, options?)
```

---

## 出参

1. 修改后的 `S1Plus.js` 中 UI showcase 相关代码（所有 `build*Showcase` 函数 + 内嵌 `<style>` + 事件处理 + `createDebugUIComponentsTabContent`）
2. 更新后的 `docs/design/ui-showcase-panel.md`
