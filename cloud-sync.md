

-----

### **为S1 Plus脚本添加基于GitHub Gist的云同步功能**

**总目标：**

为 "S1 Plus" 油猴脚本添加一个稳定、可靠的云同步功能。该功能将 **GitHub Gist** 作为后端，并通过一个**辅助配置页面**来简化用户的设置流程，最终实现用户配置（包括设置项、屏蔽列表、用户标记等）在多设备间的无缝同步。

**核心用户体验流程：**

1.  用户在脚本的“设置”面板中进入新的“云同步”标签页。
2.  点击“开始设置同步”按钮，该按钮会打开一个**新的浏览器标签页**，加载“S1 Plus Gist 同步助手”页面。
3.  **辅助页面**会引导用户完成唯一需要手动操作的步骤：生成一个仅包含 `gist` 权限的 GitHub Personal Access Token (PAT)，并提供清晰的图文指引。
4.  用户将生成好的PAT粘贴到辅助页面的输入框中，并点击“一键生成配置”按钮。
5.  辅助页面自动完成以下操作：
      * 调用GitHub API，为用户创建一个新的、私密的(secret) Gist。
      * 从API返回结果中提取Gist ID，并拼接成最终的API端点URL。
6.  辅助页面向用户展示最终需要填写的两条信息：**API端点URL** 和用户自己的 **认证密钥 (PAT)**。
7.  用户将这两条信息复制并粘贴回油猴脚本的“云同步”设置页面，点击保存。设置完成。

-----

**具体实现要求：**

#### **第一部分：创建“S1 Plus Gist 同步助手”页面**

这是一个独立的、纯前端的静态页面（单个HTML文件，内含CSS和JavaScript），可以托管在GitHub Pages等任意静态网站服务上。

  * **功能1：引导用户创建Token**
      * 页面需包含一个指向GitHub Token创建页面的链接。
      * 提供清晰、简洁的图文说明，强调权限（Scope）**只需勾选 `gist`**。
  * **功能2：自动化配置生成**
      * 提供一个输入框，用于接收用户粘贴的PAT。
      * 提供一个“一键生成配置”按钮。点击后，通过JavaScript执行：
          * **API请求**：向 `https://api.github.com/gists` 发送一个 `POST` 请求。
          * **请求头 (Headers)**：必须包含 `Authorization: Bearer <用户粘贴的PAT>` 和 `Accept: application/vnd.github.v3+json`。
          * **请求体 (Body)**：
            ```json
            {
              "description": "S1 Plus Script Sync Data",
              "public": false, // 必须为false，创建secret Gist
              "files": {
                "s1plus_sync.json": {
                  "content": "{ \"status\": \"initialized\" }" // 初始化的内容
                }
              }
            }
            ```
          * **处理响应**：从成功的响应中解析出 `id` 字段（即Gist ID）。
          * **输出结果**：在页面上醒目地显示最终配置信息：
              * **API端点URL**：`https://api.github.com/gists/<解析出的Gist_ID>`
              * **认证密钥**：用户输入的PAT

#### **第二部分：修改S1 Plus油猴脚本**

1.  **新增“云同步”UI界面 (在设置面板中)**

      * **功能总开关**：用于启用/禁用云同步。
      * **配置区域**：
          * 一个醒目的 **“点击此处开始设置”** 按钮，链接到上述的“辅助助手”页面。
          * 一个`API 端点URL`的输入框。
          * 一个`认证密钥 (Personal Access Token)`的密码类型输入框。
      * **操作与状态**：
          * “保存并测试连接”按钮。
          * “手动同步”按钮。
          * 状态显示区，用于反馈同步状态。

2.  **数据结构与同步策略**

      * **同步策略**：维持 **全量同步**、**最后修改时间优先 (Last Write Wins)** 和 **事件驱动** 的核心策略不变。
      * **数据结构**：所有待同步的数据需封装在以下结构中，再进行JSON字符串化后存入Gist：
        ```json
        {
          "lastUpdated": 1678886400000,
          "version": "4.5.0",
          "data": { ... } // exportData() 的完整内容
        }
        ```

3.  **核心同步逻辑实现 (适配Gist API)**

      * **统一数据写入接口**：改造脚本内所有的数据保存函数（如`saveSettings`, `saveBlockedUsers`等）。每次调用时，必须先更新全局的`lastUpdated`时间戳，然后（在同步功能开启时）触发数据上传。
      * **数据上传 `pushRemoteData()`**：
          * 使用 `GM_xmlhttpRequest` 向用户配置的Gist API端点URL发送 `PATCH` 请求（**注意是PATCH，不是POST**，用于更新现有Gist）。
          * **请求头**：必须包含 `Authorization: Bearer <用户配置的PAT>` 和 `Accept: application/vnd.github.v3+json`。
          * **请求体**：
            ```json
            {
              "files": {
                "s1plus_sync.json": {
                  "content": "..." // 这里是包含时间戳和数据的完整JSON对象的字符串形式
                }
              }
            }
            ```
      * **数据下载 `fetchRemoteData()`**：
          * 使用 `GM_xmlhttpRequest` 向Gist API端点URL发送 `GET` 请求。
          * **请求头**：同上。
          * **处理响应**：
            1.  解析返回的JSON。
            2.  数据内容位于 `response.files['s1plus_sync.json'].content`。
            3.  这是一个JSON字符串，需要再次 `JSON.parse()` 才能得到包含`lastUpdated`和`data`的对象。
      * **主控制器 `performSync()`**：
          * 在脚本加载和点击“手动同步”时调用。
          * 执行 `fetchRemoteData()` 获取云端数据及时间戳。
          * 与本地时间戳比较，如果云端更新，则用云端数据覆盖本地，并刷新界面。
          * 处理各种网络和API错误，并在UI上给出明确反馈。