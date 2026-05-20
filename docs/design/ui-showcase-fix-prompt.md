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

---

## 问题 2：组件渲染与实际差距大

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
createAdvancedConfirmationModal(title, bodyHtml, buttons, (options = {}));
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
    {
      text: "取消",
      class: "s1p-btn s1p-danger",
      onClick: () => {},
      closeOnClick: true,
    },
    {
      text: "确认",
      class: "s1p-btn",
      onClick: () => {
        showMessage("已确认", "success");
      },
      closeOnClick: true,
    },
  ],
);
```

### 3b. openS1pImageViewer 参数类型错误

**当前调用**（错误 — 传了数组）：

```js
openS1pImageViewer([{url:"...", filename:"..."}, ...], 0)
```

**实际签名** `openS1pImageViewer(sourceUrl, options = {})`，`sourceUrl` 必须是**字符串 URL**，函数内部调用 `new URL(sourceUrl)` 解析。

**修复**：移除图片查看器预览按钮，因为面板场景下无真实图片上下文。或者改为：

```js
openS1pImageViewer("https://picsum.photos/800/600");
```

### 3c. createDatePicker 参数缺失

**当前调用**（错误 — 少了一个参数，第二参数类型错误）：

```js
createDatePicker(fakeInput, () => {}); // initialDate 位置传了函数
```

**实际签名**：`createDatePicker(inputEl, initialDate(Date), onSelect(fn))`

**修复为**：

```js
const dateInput = target
  .closest(".s1p-ui-showcase-variant")
  .querySelector("input[readonly]");
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
  "确认",
  "取消",
  () => {},
  () => {},
);
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
