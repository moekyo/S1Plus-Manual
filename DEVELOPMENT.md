# S1 Plus 开发与同步指南

为了实现“保存即生效”以及多设备间的无缝同步，建议采用 **“Git 仓库 + 本地文件加载”** 的组合方案。

## 方案 A：单机“保存即生效” (Hot Reload)

### 1. 开启 Chrome 权限 (关键)
必须手动允许插件访问本地文件：
1. 访问：`chrome://extensions`
2. 找到 **Tampermonkey**，点击 **详细信息 (Details)**
3. 开启 **允许访问文件网址 (Allow access to file URLs)**

### 2. 创建本地加载器脚本 (Loader)
在 Tampermonkey 中新建一个名为 `S1 Plus (Local)` 的脚本，内容如下：

```javascript
// ==UserScript==
// @name         S1 Plus (Local)
// @namespace    http://tampermonkey.net/
// @version      99.9.9
// @description  本地开发版，直接加载磁盘文件
// @author       Antigravity
// @match        *://*.saraba1st.com/*
// @match        *://*.stage1st.com/*
// @require      file:///[YOUR_LOCAL_PATH]/S1Plus.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      api.github.com
// ==/UserScript==

(function() {
    'use strict';
    console.log('[S1 Plus] 本地加载器已启动');
})();
```

### 3. 使用方法
- **关闭原来的脚本**: 在 Tampermonkey 控制面板中，禁用正式版 `S1 Plus`。
- **保存即生效**: 此后你只需要在编辑器中保存 `S1Plus.js`，然后在 S1 论坛页面刷新，浏览器就会自动读取最新的本地代码。

## 注意事项
- **权限授予**: 如果没有执行步骤 1，脚本会报错无法找到文件。
- **缓存问题**: 极少数情况下脚本更新不及时，可以在 Tampermonkey 的设置中将“外部更新检查”频率调高，或者点击 Tampermonkey 图标选择“手动检查更新”。

---

## 方案 B：多设备 Git 同步更新

如果你在多台电脑上进行开发或同步更新，可以按照以下标准流程操作：

### 1. 初始设置 (每台新电脑执行一次)
- **克隆代码**: `git clone git@github.com:moekyo/S1Plus-Manual.git`
- **重复方案 A**: 完成 Chrome 权限开启和 Tampermonkey Loader 的配置。
  > [!IMPORTANT]
  > 确保 Loader 中的 `@require` 路径指向该电脑上正确的 `S1Plus.js` 绝对路径。
  >
  > **Windows 路径格式提示**:
  > 如果你的代码在 `C:\Users\YourName\Documents\S1Plus-Manual\S1Plus.js`，那么 `@require` 应该写成：
  > `// @require      file:///C:/Users/YourName/Documents/S1Plus-Manual/S1Plus.js`
  > (注意：使用 `file:///` 开头，并把反斜杠 `\` 换成正斜杠 `/`)
  >
  > **如何快速获取路径？**
  > - **方法 1 (推荐)**: 选中文件，按下 `Shift` 键的同时点击**鼠标右键**，选择“**复制为路径 (Copy as path)**”。
  > - **方法 2 (Win11)**: 直接右键点击文件，顶部工具栏有一个“复制为路径”图标。
  > - **注意**: 粘贴后记得删掉两边的双引号 `"`。

### 2. 日常同步流程
1. **在电脑 A 提交更改**:
   ```bash
   git add .
   git commit -m "update scripts"
   git push
   ```
2. **在电脑 B 获取更新**:
   ```bash
   git pull
   ```
3. **即刻生效**:
   由于电脑 B 的 Tampermonkey 已经通过本地文件模式加载了 `S1Plus.js`，执行完 `git pull` 后，直接刷新浏览器页面即是最新版本，**无需再次操作 Tampermonkey**。
