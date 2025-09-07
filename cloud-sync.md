### **为S1 Plus脚本添加基于GitHub Gist的远程同步功能**

#### **总目标**

为 "S1 Plus" 油猴脚本添加一个稳定、可靠的、基于 GitHub Gist 的**远程同步**功能。开发将在**现有的“设置同步”标签页内**进行，首先将其现有功能重构为“本地备份”，然后在其下方新增“**远程同步**”模块。最后，开发一个辅助页面以优化新用户的**远程同步**设置体验。

---

### **第零阶段：现有功能的重构 (准备工作)**

* **阶段目标**: 将当前“设置同步”标签页内的功能重构并明确其为“本地备份与恢复”，为后续添加“**远程同步**”模块准备空间和清晰的命名。

#### **子任务 0.1: 重构UI**

* **具体提示**:
    1.  在 `createManagementModal` 函数中，找到 `id="s1p-tab-sync"` 的 `div` 容器。
    2.  **不改变Tab按钮的文本**，保持其为“设置同步”。
    3.  在该 `div` 内部，创建一个新的 `s1p-settings-group`，并添加一个标题 `<div class="s1p-settings-group-title">本地备份与恢复</div>`。
    4.  将现有的“全量设置同步”描述、导出/导入按钮 (`s1p-export-btn`, `s1p-import-btn`)、文本域 (`s1p-sync-textarea`) 和消息提示框 (`s1p-sync-message`) 全部移动到这个新的 `s1p-settings-group` 内部。
    5.  修改描述文字，强调这是通过“**手动复制/粘贴**”实现的**迁移或备份**。

#### **子任务 0.2: 重构UI控件ID和Class (保持清晰)**

* **具体提示**: 对以下ID进行全局搜索和替换，添加 `local-` 前缀，以明确其作用域：
    * `s1p-export-btn` → `s1p-local-export-btn`
    * `s1p-import-btn` → `s1p-local-import-btn`
    * `s1p-sync-textarea` → `s1p-local-sync-textarea`
    * `s1p-sync-message` → `s1p-local-sync-message`

#### **子任务 0.3: 重构核心方法名称 (保持清晰)**

* **具体提示**:
    1.  将 `exportData()` 函数重命名为 `exportLocalData()`。
    2.  将 `importData()` 函数重命名为 `importLocalData()`。
    3.  更新脚本中所有调用这两处的地方，确保使用的是新函数名。

---

### **第一阶段：在同一Tab内实现核心远程同步功能 (MVP)**

* **阶段目标**: 在“设置同步”标签页的“本地备份”模块下方，新增“**远程同步**”模块，并使其能够与手动配置好的GitHub Gist进行双向数据同步。

#### **子任务 1.1: 新增远程同步UI**

* **具体提示**:
    1.  在 `id="s1p-tab-sync"` 的 `div` 容器内，**紧接着“本地备份”的 `s1p-settings-group` 之后**，创建第二个 `s1p-settings-group`。
    2.  为此新 `group` 添加标题 `<div class="s1p-settings-group-title">远程同步 (通过GitHub Gist)</div>`。
    3.  在此 `group` 内部，添加所有**远程同步**所需的UI元素，并使用 `remote-` 前缀命名ID：
        * **启用开关**: 一个 `s1p-settings-item`，包含Toggle开关 `s1p-remote-enabled-toggle`。
        * **Gist API URL输入框**: `s1p-remote-url-input`。
        * **PAT输入框**: `s1p-remote-pat-input` (类型为 `password`)。
        * **辅助链接**: 一个 `<p>` 或 `<a>` 元素，`id="s1p-remote-helper-link"`，用于链接到未来的辅助页面。
        * **操作按钮**: 一个 `s1p-editor-footer`，包含“保存设置” (`s1p-remote-save-btn`) 和“手动同步” (`s1p-remote-manual-sync-btn`) 按钮。
        * **状态显示**: 一个 `<div id="s1p-remote-status" class="s1p-message">`。

#### **子任务 1.2: 管理远程同步配置**

* **具体提示**:
    1.  修改 `defaultSettings` 对象，添加**远程同步**相关的默认值：`syncRemoteEnabled: false`, `syncRemoteApiUrl: ''`, `syncRemotePat: ''`。
    2.  为“保存设置”按钮 (`#s1p-remote-save-btn`) 添加点击事件监听器，用于读取UI输入并保存到脚本存储中。

#### **子任务 1.3: 实现Gist数据读取 (`fetchRemoteData`)**

* **具体提示**:
    1.  创建一个新的异步函数 `fetchRemoteData()`。
    2.  函数内部通过 `getSettings()` 获取 `syncRemoteApiUrl` 和 `syncRemotePat`。如果任一为空，则直接返回`Promise.reject('配置不完整')`。
    3.  使用 `GM_xmlhttpRequest` 发起一个 `method: 'GET'` 请求到 `syncRemoteApiUrl`。
    4.  在 `headers` 中设置 `Authorization: 'Bearer ' + syncRemotePat` 和 `Accept: 'application/vnd.github.v3+json'`。
    5.  在 `onload` 回调中，检查 `response.status` 是否为200，成功则解析 `response.responseText.files['s1plus_sync.json'].content` 并返回最终的JS对象。在 `onerror` 或状态码非200时 `reject` 错误。

#### **子任务 1.4: 实现Gist数据写入 (`pushRemoteData`)**

* **具体提示**:
    1.  创建一个新的异步函数 `pushRemoteData(dataObject)`。
    2.  准备请求体 (body)，格式为：`{ files: { 's1plus_sync.json': { content: JSON.stringify(dataObject) } } }`。
    3.  使用 `GM_xmlhttpRequest` 发起一个 `method: 'PATCH'` 请求到 `syncRemoteApiUrl`，携带正确的 `headers` 和 `data`。
    4.  根据请求结果 `resolve` 或 `reject` Promise。

#### **子任务 1.5: 改造数据保存流程以触发远程同步**

* **具体提示**:
    1.  创建一个新的函数 `triggerRemoteSyncPush()`。
    2.  此函数检查**远程同步**是否启用 (`getSettings().syncRemoteEnabled`)，如是，则调用 `exportLocalData()` 获取全量数据，为其附加/更新 `lastUpdated` 时间戳，然后调用 `pushRemoteData()` 上传。
    3.  在所有核心数据保存函数（如 `saveBlockedUsers`, `saveSettings` 等）的末尾，追加对 `triggerRemoteSyncPush()` 的调用。

#### **子任务 1.6: 实现主远程同步控制器 (`performRemoteSync`)**

* **具体提示**:
    1.  创建一个主函数 `performRemoteSync(isManual = false)`。
    2.  函数调用 `fetchRemoteData()`，获取远程数据和时间戳。
    3.  与本地时间戳进行比较：
        * **远程 > 本地**: 调用 `importLocalData()` 应用远程数据，并提示用户刷新。
        * **本地 > 远程**: 调用 `pushRemoteData()` 上传本地数据。
        * **时间戳相等**: 更新UI状态为“已是最新”。
    4.  在脚本初始化流程和“手动同步”按钮的点击事件中调用 `performRemoteSync()`。

---

### **第二阶段：开发“S1 Plus Gist 同步助手”页面 (用户体验优化)**

* **阶段目标**: 创建一个独立的静态网页，帮助非技术用户轻松生成**第一阶段远程同步**模块所需的两条配置信息。

#### **子任务 2.1: 页面结构与样式**

* **具体提示**:
    1.  创建一个 `index.html` 文件。
    2.  **引导区**: 包含清晰的图文说明，引导用户去GitHub生成**只选 `gist` 权限**的PAT，并附上直接跳转链接。
    3.  **操作区**: 一个 `type="password"` 的 `<input>` 用于粘贴PAT，一个`<button>`用于触发生成。
    4.  **结果区**: 两个只读的 `<input>`，分别用于展示生成的“API端点URL”和用户输入的“PAT”。每个输入框旁边配一个“复制”按钮。

#### **子任务 2.2: 实现页面核心逻辑**

* **具体提示**:
    1.  为“生成”按钮添加 `click` 事件监听器。
    2.  在监听器中，使用 `fetch()` API 向 `https://api.github.com/gists` 发送 `POST` 请求，请求体需包含 `description`, `public: false` 和 `files` 对象。
    3.  成功后，从返回的JSON中获取 `id`，拼接成最终的API URL，并将其与用户输入的PAT一起展示在结果区。
    4.  实现错误处理和“复制”按钮功能。
    5.  将此页面部署到任意静态网站托管服务，并将最终URL填入**第一阶段**创建的 `s1p-remote-helper-link` 元素的 `href` 属性中。