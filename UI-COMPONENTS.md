# S1Plus 自定义 UI 控件目录

> 本文档梳理了 `S1Plus.js` (~43,000 行) 中所有自定义 UI 控件的创建函数、大致行号与功能说明。
> 所有 CSS 类均使用 `s1p-` 前缀。

---

## 核心 CSS 类体系速查

| 用途 | 类名 | 变体 |
|------|------|------|
| 按钮 | `s1p-btn` | `s1p-primary`, `s1p-danger`, `s1p-red-btn`, `s1p-btn-sm` |
| 开关 | `s1p-switch` + `s1p-slider` | `s1p-settings-checkbox`, `s1p-item-toggle` |
| 输入框 | `s1p-input` | `s1p-input-full`, `s1p-input-error`, `s1p-input-with-right-icon` |
| 模态框 | `s1p-modal` / `s1p-confirm-modal` | — |
| 列表 | `s1p-list` / `s1p-item` | `s1p-list-summary`, `s1p-list-pagination`, `s1p-empty` |
| 弹出层 | `s1p-tag-popover` / `s1p-generic-display-popover` | — |
| 工具栏图标 | `s1p-toolbar-icon-btn` / `s1p-authi-action` | — |

---

## 1. 模态对话框 (Modal Dialogs)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 1.1 | 设置管理主模态框 | `createManagementModal()` | L37143 | 带标签页的主设置面板 |
| 1.2 | 简单确认弹窗 | `createConfirmationModal()` | L36012 | 是/否确认对话框 |
| 1.3 | 输入弹窗 | `createInputModal()` | L36128 | 带文本输入的模态框 |
| 1.4 | 高级确认弹窗 | `createAdvancedConfirmationModal()` | L43322 | 可自定义按钮、HTML 内容、CSS 类名 |
| 1.5 | 欢迎/更新弹窗 | `showFirstTimeWelcomeIfNeeded()` | L47984 | 首次运行 / 版本更新后展示更新亮点 |
| 1.6 | Token 过期配置弹窗 | `openTokenExpiryConfigModal()` | L36991 | PAT Token 过期日期配置 |
| 1.7 | 阅读进度详情弹窗 | `createReadingProgressDetailModal()` | L47352 | 按时间段分组的完整阅读进度 |
| 1.8 | 模态框关闭按钮 | `buildModalCloseButtonHtml()` | L2087 | 可复用的右上角 X 关闭按钮 |
| 1.9 | Token 过期警告弹窗 | `checkTokenExpiry()` | L48031 | Token 临近过期时的警告弹窗 |

---

## 2. 按钮 (Buttons)

| # | 控件 | 创建位置 | 行号 | 说明 |
|---|------|---------|------|------|
| 2.1 | 保存设置按钮 | 设置模态框内联 HTML | L40382 | "保存设置" |
| 2.2 | 恢复默认导航按钮 | 设置模态框内联 HTML | L40384 | "恢复默认导航" |
| 2.3 | 清除选中数据按钮 | 设置模态框内联 HTML | L37378 | 批量清除选定数据 |
| 2.4 | 导出/导入按钮 | 设置模态框内联 HTML | L37195-96 | 本地数据导出导入 |
| 2.5 | 远程保存/手动同步按钮 | 设置模态框内联 HTML | L37359-61 | 同步操作按钮 |
| 2.6 | 阅读进度详情按钮 | 设置模态框内联 HTML | L39949 | 打开阅读进度详情弹窗 |
| 2.7 | 新增规则/链接按钮 | 设置模态框内联 HTML | L39405, L40381 | — |
| 2.8 | 快捷日期按钮 | 设置模态框内联 HTML | L37037-40 | 30/60/90/365 天快捷设置 |
| 2.9 | 图片查看器工具栏按钮 | 图片查看器内联 HTML | L24188-92 | 适应/重置/保存/全部保存/打开 |
| 2.10 | 图片查看器图标按钮 | 图片查看器内联 HTML | L24118-72 | 关闭/上一张/下一张/缩放 |
| 2.11 | 个人页屏蔽用户按钮 | `addBlockButtonToUserProfileHeader()` | L46610 | 用户个人页的屏蔽按钮 |
| 2.12 | Debug 面板按钮 | `createS1pDebugButton()` | L33961 | Debug 面板操作/跳转按钮 |
| 2.13 | 编辑备注按钮 | 帖子操作区内联 HTML | L39246 | — |
| 2.14 | 添加备注按钮 | 帖子操作区内联 HTML | L39247 | — |

---

## 3. 菜单 / 下拉 (Menus / Dropdowns)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 3.1 | 内联操作菜单 | `createInlineActionMenu()` | L32940 | 弹出操作菜单（如：图片尺寸选项） |
| 3.2 | 内联确认菜单 | `createInlineConfirmMenu()` | L36463 | 内联确认栏（如：屏蔽主题确认） |
| 3.3 | 标签选项菜单 | `createOptionsMenu()` | L46074 | 标签上的编辑/删除弹出菜单 |
| 3.4 | 标签删除确认菜单 | `createTagDeleteConfirmMenu()` | L45920 | "确认删除标记?" 确认栏 |
| 3.5 | 确认栏构建器 | `buildConfirmationMarkup()` | L36286 | 通用确认/取消栏，支持可选文本输入 |
| 3.6 | 工具栏次要弹窗关闭 | `dismissToolbarSecondaryPopups()` | L36438 | 关闭帖子工具栏中所有次要弹出层 |
| 3.7 | 分段控制器 | 内联 HTML | L37243 | 同步模式等 radio 型选项组 |

---

## 4. 面板 (Panels / Panes)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 4.1 | Debug 统一面板 | `initializeDebugUnifiedPanel()` | L35400 | 可切换的多标签页调试面板 |
| 4.2 | Debug 面板外壳 | `createS1pDebugPanelShell()` | L34012 | 可复用的调试面板容器 |
| 4.3 | Debug 面板组 | `createS1pDebugPanelGroup()` | L33988 | 带标签的按钮编组 |
| 4.4 | Debug 日志面板 | `renderLogPanel()` | L35134 | 控制台日志展示面板 |
| 4.5 | Debug 控制台标签 | `createDebugConsoleLogTabContent()` | L35169 | 含过滤栏和日志区域的完整控制台 |
| 4.6 | Debug 同步诊断标签 | `createDebugSyncDiagnosticsTabContent()` | L35260 | 同步状态诊断面板 |
| 4.7 | 自动同步 Debug 标签 | `createAutoSyncIndicatorDebugTabContent()` | L34204 | 自动同步状态可视化 |

---

## 5. 提示 / 通知 (Toasts / Notifications)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 5.1 | 全局 Toast 通知 | `showMessage()` | L35919 | 可关闭的成功/错误/中性提示 |
| 5.2 | 设置模态框 Toast | `showSettingsMessage()` | L37432 | 设置模态框内的 Toast |
| 5.3 | Token 配置 Toast | `showTokenConfigMessage()` | L37051 | Token 配置弹窗内的 Toast |
| 5.4 | 内容更新徽章 | 线程列表内联 HTML | L42197 | "(内容更新)" 橙色徽章 |
| 5.5 | 新回复数徽章 | `upsertProgressJumpButtonForRow()` | L44608 | 新回复数量蓝色计数徽章 |

---

## 6. 工具提示 (Tooltips)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 6.1 | 简单文本提示 | `setCustomTooltip()` | L2024 | 为元素设置纯文本提示 |
| 6.2 | 模板富文本提示 | `setTemplateTooltip()` | L2039 | 引用 template 模板渲染富文本提示 |
| 6.3 | 通用展示弹出层 | `initializeGenericDisplayPopover()` | L43920 | 富文本悬浮提示系统，支持文档模板 |
| 6.4 | 提示文档构建器 | `buildTooltipDocFromTemplate()` | L44068 | 结构化文档式提示内容构建 |
| 6.5 | 提示渲染/显示 | `renderTooltipContent()` / `showTooltipPopover()` | L44188 / L44297 | 实际渲染和展示弹出提示 |
| 6.6 | 提示清理 | `clearCustomTooltip()` | L2050 | 从元素移除工具提示 |

---

## 7. 表单控件 (Form Controls)

| # | 控件 | 创建函数/位置 | 行号 | 说明 |
|---|------|-------------|------|------|
| 7.1 | 功能总开关 | `buildPrimaryFeatureToggleHtml()` | L37677 | 带大标签的功能开启/关闭开关 |
| 7.2 | 内联 Toggle 开关 | 内联 HTML | 各处 | 设置项中的独立开关 |
| 7.3 | 入口选项控制 | `bindOpenModeControl()` | L40167 | 链接打开方式 Radio 控件 |
| 7.4 | 标准文本输入 | 各处 `createElement` | — | `s1p-input` |
| 7.5 | 全宽文本输入 | 内联 HTML | — | `s1p-input s1p-input-full` |
| 7.6 | 带图标输入框 | 内联 HTML | L37334 | 密码/Token 输入框 |
| 7.7 | 错误状态输入框 | JS 动态添加类 | L38058 | `s1p-input s1p-input-error` |
| 7.8 | 图片尺寸数字输入 | 内联 HTML | L40005/12 | 图片预览最大宽高输入 |
| 7.9 | 日期选择器 | `createDatePicker()` | L36760 | 完整日历控件（含年月导航） |
| 7.10 | 颜色选择器 | 标签弹出层内联 HTML | L38547 | 标签颜色色块选择器 |
| 7.11 | 编辑模式文本区 | 标签弹出层内联 HTML | L36370 | 标签/备注编辑文本区域 |
| 7.12 | 同步数据文本区 | 设置模态框内联 HTML | L37198, L38458 | 导入/导出数据的 textarea |
| 7.13 | Token 日期输入 | 内联 HTML | L37033 | 只读日期展示 + 日历触发按钮 |
| 7.14 | 关键词规则输入 | `createRuleEditorItem()` | L39542 | 规则模式输入框 + 开关 + 删除按钮 |
| 7.15 | 搜索输入框 | 内联 HTML | L38686, L35205 | 带搜索图标和清除按钮 |
| 7.16 | 条目开关 | 内联 HTML | L39260 | 列表项中的小开关 |
| 7.17 | 导航链接输入 | `createNavEditorItem()` | L40393 | 导航名称 + href 输入框 |
| 7.18 | 清除数据复选框 | 内联 HTML | L37811 | 数据分类复选框组 |

---

## 8. 标签页 (Tabs)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 8.1 | 设置模态框标签页 | `buildSettingsModalTabsHtml()` | L37382 | 标签栏 + 标签内容面板 |
| 8.2 | 标签页切换处理 | `switchSettingsTab()` | L36708 | 活动标签切换 + 滑块动画 |
| 8.3 | 标签页懒渲染 | `renderSettingsModalTabByKey()` | L40636 | 按需渲染标签内容 |
| 8.4 | Debug 面板标签页 | `initializeDebugUnifiedPanel()` | L35400 | Debug 面板中的标签栏 |
| 8.5 | Debug 标签内容区 | Debug 面板相关函数 | L34205 | 各标签的内容区域 |
| 8.6 | 设置标签页包装器 | 内联 HTML | L37405 | 窄布局下的标签栏包裹 div |

---

## 9. 弹出层 / 覆盖层 (Popovers / Overlays)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 9.1 | 用户标签弹出层 | `initializeTaggingPopover()` | L43666 | 添加/编辑用户标签的弹出层 |
| 9.2 | 通用展示弹出层 | `initializeGenericDisplayPopover()` | L43920 | 结构化内容的悬浮弹出层 |
| 9.3 | 标签选项弹出菜单 | `createOptionsMenu()` | L46074 | 标签旁边的小弹出菜单 |
| 9.4 | 模态框背景遮罩 | CSS 伪元素 | L5291 | 半透明模糊背景遮罩 |

---

## 10. 卡片 / 盒子 (Cards / Boxes)

| # | 控件 | 创建位置 | 行号 | 说明 |
|---|------|---------|------|------|
| 10.1 | 设置分组 | 设置模态框内联 HTML | — | `s1p-settings-group` |
| 10.2 | 设置子分组 | 设置模态框内联 HTML | — | `s1p-settings-sub-group` |
| 10.3 | 设置项行 | 设置模态框内联 HTML | — | 标签 + 控件的单行布局 |
| 10.4 | 确认卡片 | `buildConfirmationMarkup()` | L36350 | 确认栏 + 备注区域的卡片包裹 |
| 10.5 | 系统通知包裹 | 帖子内容 DOM 构建 | L19860 | 屏蔽/包裹系统通知帖子 |
| 10.6 | 引用包裹 | 帖子内容 DOM 构建 | L19677 | 屏蔽/包裹已屏蔽用户引用 |
| 10.7 | 图片容器 | 帖子内容 DOM 构建 | L24812 | 带显示/隐藏切换的图片包裹 |
| 10.8 | 图片一键展示容器 | 帖子内容 DOM 构建 | L21273 | "显示全部图片"按钮的容器 |
| 10.9 | 用户标签展示 | authi 区域渲染 | L46487 | 用户名旁的彩色标签药丸 |
| 10.10 | 用户备注展示 | authi 区域渲染 | L2457 | 用户名下方的备注文字 |
| 10.11 | 个人页屏蔽包裹 | `addBlockButtonToUserProfileHeader()` | L46635 | 个人页屏蔽按钮容器 |

---

## 11. 条 / 指示器 (Bars / Indicators)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 11.1 | 阅读进度跳转按钮 | `upsertProgressJumpButtonForRow()` | L44485 | 线程列表每行的阅读进度指示器 |
| 11.2 | 进度删除按钮 | `upsertProgressJumpButtonForRow()` | L44623 | 删除单条阅读进度的按钮 |
| 11.3 | 导航栏自动同步指示器 | `renderNavbarAutoSyncIndicator()` | L34690 | 导航栏中的动画同步状态图标 |
| 11.4 | 导航栏同步粘性警告 | `renderNavbarPersistentSyncAlert()` | L34537 | 同步异常时的粘性警告横幅 |
| 11.5 | 确认操作栏 | `buildConfirmationMarkup()` | L36286 | 水平确认/取消按钮栏 |
| 11.6 | Debug 控制台状态栏 | Debug 控制台内联 | L35250 | 控制台日志区域下方的状态文字 |
| 11.7 | Debug 控制台过滤栏 | `createDebugConsoleLogTabContent()` | L35178 | 日志级别过滤按钮 + 搜索框 |

---

## 12. 自定义列表 / 表格 (Lists / Tables)

| # | 控件 | 创建函数/位置 | 行号 | 说明 |
|---|------|-------------|------|------|
| 12.1 | 通用列表容器 | 设置模态框内联 HTML | — | `s1p-list` |
| 12.2 | 列表项 | 设置模态框内联 HTML | — | `s1p-item` + `s1p-item-info` + `s1p-item-title` + `s1p-item-meta` |
| 12.3 | 列表摘要 | `buildListSummaryHtml()` | L37652 | 列表分组的计数摘要 |
| 12.4 | 列表分页 | `buildSettingsModalListPaginationHtml()` | L37616 | 列表分页导航 |
| 12.5 | 列表分页重渲染 | `rerenderSettingsModalPaginatedList()` | L40672 | 数据变更后重新渲染分页列表 |
| 12.6 | 空状态 | 内联 HTML | — | `s1p-empty` "暂无数据"提示 |
| 12.7 | 项目操作按钮组 | 内联 HTML | L38523 | 编辑/保存/取消/删除按钮组 |
| 12.8 | 项目编辑器 | 内联 HTML | L38529 | 列表项内的文本区域编辑器 |
| 12.9 | 屏蔽用户项 | 设置模态框内联 HTML | L39250 | 屏蔽用户行 + 开关 + 取消屏蔽 |
| 12.10 | 屏蔽主题项 | 设置模态框内联 HTML | L39456 | 带可展开帖子列表的屏蔽主题行 |
| 12.11 | 屏蔽帖子项 | 设置模态框内联 HTML | L39508 | 屏蔽楼层/帖子行 |
| 12.12 | 关键词规则编辑项 | `createRuleEditorItem()` | L39542 | 可拖拽规则行（输入框+开关+删除） |
| 12.13 | 导航编辑项 | `createNavEditorItem()` | L40393 | 可拖拽导航链接行（名称+href+删除） |
| 12.14 | 书签项 | `renderBookmarksTab()` | L38741 | 书签回复行 + 内容预览展开 |
| 12.15 | 标签项 | `renderTagsTab()` | L38493 | 标签用户行 + 编辑/删除操作 |
| 12.16 | 历史标签列表 | 标签弹出层 | L5202 | 之前使用过的标签列表 |
| 12.17 | 阅读进度分组 | `createReadingProgressDetailModal()` | L47432 | 按时间段分组的阅读进度条目 |

---

## 13. 可折叠区域 (Accordions / Collapsible)

| # | 控件 | 创建位置 | 行号 | 说明 |
|---|------|---------|------|------|
| 13.1 | 可折叠设置组 | 设置模态框内联 HTML | L39411/30 | 带展开箭头的分组标题 |
| 13.2 | 可折叠内容区 | 设置模态框内联 HTML | L39416/35 | 折叠/展开的内容区域 |
| 13.3 | 主题头部（屏蔽帖子） | 设置模态框内联 HTML | L39495 | 屏蔽主题列表中的可展开主题头 |
| 13.4 | 主题帖子列表（可折叠） | 设置模态框内联 HTML | L39500 | 屏蔽主题下的可折叠帖子列表 |

---

## 14. 徽章 / 标签 (Badges / Tags)

| # | 控件 | 创建位置 | 行号 | 说明 |
|---|------|---------|------|------|
| 14.1 | 用户标签药丸 | authi 区域渲染 | L46487 | `s1p-user-tag-display` 彩色标签 |
| 14.2 | 用户备注徽章 | authi 区域渲染 | L2457 | 用户名旁的小备注 |
| 14.3 | 历史标签项 | 标签弹出层 | L5219 | 历史使用过的标签药丸 |
| 14.4 | 内容更新徽章 | 线程列表 | L42197 | `s1p-progress-update-badge` 橙色 |
| 14.5 | 新回复数徽章 | 线程列表 | L44608 | `s1p-new-replies-badge` 蓝色计数 |
| 14.6 | 内联代码徽章 | 确认弹窗 | L39809 | `s1p-inline-code-badge` 等宽字体 |
| 14.7 | 书签仅预览提示 | 书签列表 | L38792 | `(仅预览)` 提示 |

---

## 15. 内联编辑控件 (Inline Editing)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 15.1 | 标签编辑模式 | `renderEditMode()` | L43723 | 标签名称/颜色内联编辑器 |
| 15.2 | 备注编辑器 | `buildConfirmationMarkup()` | L36369 | 确认栏内的备注输入文本区 |
| 15.3 | 书签条目编辑器 | 书签列表内联 HTML | L38529 | 书签内容内联编辑文本区 |
| 15.4 | 编辑备注按钮 | 帖子操作区内联 | L39246 | 触发内联备注编辑 |
| 15.5 | 添加备注按钮 | 帖子操作区内联 | L39247 | 触发新增备注输入 |

---

## 16. 搜索 / 过滤控件

| # | 控件 | 创建位置 | 行号 | 说明 |
|---|------|---------|------|------|
| 16.1 | 书签搜索栏 | 书签标签页内联 HTML | L38685-88 | 带图标和清除按钮的搜索输入 |
| 16.2 | Debug 控制台级别过滤 | `createDebugConsoleLogTabContent()` | L35181 | 日志级别切换按钮组 |
| 16.3 | Debug 控制台搜索 | `createDebugConsoleLogTabContent()` | L35205 | 控制台日志文本搜索 |
| 16.4 | 关键词规则启用开关 | `createRuleEditorItem()` | L39551 | 每条规则的独立 on/off |
| 16.5 | 清除数据复选框 | 设置模态框内联 | L37811 | 选择清除数据类别的复选框组 |

---

## 17. 布局组件 (Layout)

| # | 控件 | 创建位置 | 行号 | 说明 |
|---|------|---------|------|------|
| 17.1 | Authi 容器 | `addActionsToSinglePost()` | L46217 | Flex 容器包裹原生 authi + 脚本操作 |
| 17.2 | Debug 控制台调整手柄 | `createDebugConsoleLogTabContent()` | L35078 | 可拖拽的控制台面板高度调整 |
| 17.3 | Debug 面板网格 | CSS 样式 | L1666 | Debug 按钮的网格布局 |
| 17.4 | 图片一键展示容器 | 帖子内容 DOM 构建 | L21273 | 图片批量切换按钮容器 |
| 17.5 | 帖子底部操作 | `addActionsToPostFooter()` | L46545 | 每个帖子的底部操作渲染 |

---

## 18. 浮动按钮 / 导航栏入口

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 18.1 | 导航栏设置链接 | `createManagerLink()` | L35717 | 论坛导航栏中的 "S1 Plus 设置" |
| 18.2 | 导航栏同步按钮 | `initializeNavbar()` | L35537 | 导航栏中的同步状态图标按钮 |

---

## 19. 首次运行 / 警告弹窗

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 19.1 | 版本欢迎弹窗 | `showFirstTimeWelcomeIfNeeded()` | L47984 | 每次版本更新后的更新亮点展示 |
| 19.2 | Token 过期警告 | `checkTokenExpiry()` | L48031 | PAT Token 临近过期时的警告弹窗 |

---

## 20. 加载指示器 (Loading Spinners)

| # | 控件 | 创建位置 | 行号 | 说明 |
|---|------|---------|------|------|
| 20.1 | 图片查看器切换加载 | 图片查看器内联 | L24215 | 切换图片时的旋转加载器 + 取消按钮 |
| 20.2 | 同步旋转指示器 | 导航栏 CSS 动画 | L2572 | 同步时的旋转 SVG 图标 |
| 20.3 | 图片查看器加载遮罩 | CSS 动画 | L7489-7527 | 全视口加载遮罩 |

---

## 21. 图片查看器 (Image Viewer - 完整组件)

`openS1pImageViewer()` 创建于 L24508

| # | 子控件 | CSS 类 / 行号 |
|---|--------|-------------|
| 21.1 | 查看器面板（侧边信息栏） | `s1p-image-viewer__panel` (L24103) |
| 21.2 | 查看器工具栏 | `s1p-image-viewer__toolbar` (L24118) |
| 21.3 | 查看器视口（图片显示区） | `s1p-image-viewer__viewport` (L7458) |
| 21.4 | 主图片舞台 | `s1p-image-viewer__image-stage--main` (L7338) |
| 21.5 | 幽灵图片舞台 | `s1p-image-viewer__image-stage--ghost` |
| 21.6 | 图片标题 | `s1p-image-viewer__title` (L7390) |
| 21.7 | 缩放百分比显示 | `s1p-image-viewer__zoom` (L7396) |
| 21.8 | 图片索引显示 | `s1p-image-viewer__index` (L7407) |
| 21.9 | 保存状态遮罩 | `s1p-image-viewer__save-status-overlay` (L7357) |
| 21.10 | 关闭按钮 | `s1p-image-viewer__close-btn` (L7438) |
| 21.11 | 缩放图标 | `s1p-image-viewer__zoom-icon` (L7431) |

---

## 22. 帖子工具栏操作图标 (Post Authi Actions)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 22.1 | 帖子编辑链接 | `createPostEditToolbarLink()` | L46059 | authi 区域中的编辑按钮 |
| 22.2 | 书签回复链接 | `addActionsToSinglePost()` | L46327 | 收藏回复按钮 |
| 22.3 | 屏蔽用户链接 | `addActionsToSinglePost()` | L46402 | 屏蔽用户按钮 |
| 22.4 | 屏蔽帖子链接 | `addActionsToSinglePost()` | L46436 | 屏蔽楼层/帖子按钮 |
| 22.5 | 标签用户链接 | `addActionsToSinglePost()` | L46511 | 给用户打标签按钮 |
| 22.6 | 书签已标记状态 | JS 动态添加 | L5040 | 已收藏帖子的视觉高亮 `s1p-bookmarked` |
| 22.7 | 引用切换按钮 | 帖子内容 DOM 构建 | L19689 | 显示/隐藏已屏蔽用户引用 |
| 22.8 | 系统通知切换按钮 | 帖子内容 DOM 构建 | L19877 | 显示/隐藏系统通知 |
| 22.9 | 图片切换按钮 | 帖子内容 DOM 构建 | L21273 | 单帖 "显示全部图片" 按钮 |
| 22.10 | 内联切换按钮基类 | CSS 样式 | L4100 | `s1p-inline-toggle-btn` 基础样式 |

---

## 23. 导航栏组件 (Navbar)

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 23.1 | 导航栏初始化 | `initializeNavbar()` | L35711 | 构建自定义导航栏链接 |
| 23.2 | 设置导航链接 | `createManagerLink()` | L35717 | 导航栏中的设置入口链接 |
| 23.3 | 自定义导航链接 | `initializeNavbar()` | L35736 | 用户在设置中定义的导航链接 |
| 23.4 | 导航栏同步按钮 | `initializeNavbar()` | L35537 | 同步状态/操作图标 |
| 23.5 | 导航设置标签渲染 | `renderNavSettingsTab()` | L40355 | 自定义导航链接编辑标签 |
| 23.6 | 导航列表渲染 | `renderNavList()` | L40435 | 可拖拽导航链接列表 |
| 23.7 | 导航编辑器底部 | 设置模态框内联 | L40379 | 新增按钮 + 保存按钮 |

---

## 24. Debug 控制台子控件

| # | 控件 | CSS 类 | 说明 |
|---|------|--------|------|
| 24.1 | 日志条目行 | `s1p-debug-console-log-line` | 单条日志行 |
| 24.2 | 日志时间戳 | `s1p-debug-console-log-ts` | 时间列 |
| 24.3 | 日志级别标记 | `s1p-debug-console-log-level` | 颜色编码的级别徽章 |
| 24.4 | 日志消息 | `s1p-debug-console-log-msg` | 消息文本区域 |
| 24.5 | 日志展开按钮 | `s1p-debug-console-expand-line` | 展开折叠的日志 |
| 24.6 | 日志复制按钮 | `s1p-debug-console-copy-line` | 复制日志条目 |
| 24.7 | 调试工具栏 | `s1p-debug-console-toolbar` | 控制台工具栏 |
| 24.8 | 诊断工具栏 | `s1p-debug-diagnostics-toolbar` | 诊断标签工具栏 |
| 24.9 | 头部操作按钮组 | `s1p-debug-console-head-actions` | — |
| 24.10 | 内联确认栏 | `s1p-debug-confirm-inline` | 诊断标签中的重置确认 |
| 24.11 | 按钮反馈动画 | `s1p-debug-console-feedback` | 按钮点击的视觉反馈闪烁 |

---

## 25. 线程列表屏蔽控件

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 25.1 | 主题屏蔽作者按钮 | `createThreadBlockAuthorButton()` | L43487 | 屏蔽主题时同时屏蔽作者 |
| 25.2 | 线程行屏蔽按钮 | `addBlockButtonsToThreadRows()` | L43475 | 为线程行添加屏蔽控件 |
| 25.3 | 线程屏蔽应用 | `addBlockButtonsToThreads()` | L43656 | 统筹添加屏蔽控件到所有线程 |

---

## 26. 其他控件

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 26.1 | 文本搜索高亮 | `highlightTextInNode()` | L35792 | 用 `<mark>` 包裹匹配文本 |
| 26.2 | 个人页屏蔽包裹 | `addBlockButtonToUserProfileHeader()` | L46635 | 个人页屏蔽按钮容器 |
| 26.3 | 内联图片尺寸选项 | 多项 | — | `s1p-image-size-option` |

---

## 27. NUX 主题兼容修正

| # | 控件 | 创建函数 | 行号 | 说明 |
|---|------|---------|------|------|
| 27.1 | NUX 主题检测 | `detectS1Nux()` | L8948 | 检测是否使用 S1 NUX 主题 |
| 27.2 | 分段控件对比度修正 | `applyNuxSegmentedContrastFix()` | L8536 | NUX 下分段控件对比度修复 |
| 27.3 | 标签色调修正 | `applyNuxVineTabToneFix()` | L8552 | NUX 下标签颜色修复 |
| 27.4 | 过渡动画隔离修正 | `applyNuxTransitionIsolationFix()` | L8568 | 隔离 NUX CSS transition 影响 |
| 27.5 | 滚动条主题修正 | `applyNuxSettingsScrollbarThemeFix()` | L8576 | NUX 下设置页滚动条颜色 |
| 27.6 | 暗色文本对比度修正 | `applyNuxDarkTextContrastFix()` | L8814 | NUX 暗色主题文本对比度 |
| 27.7 | 亮色背景内容修正 | `applyNuxLightBgContentFixToNode()` | L8713 | NUX 下亮色背景帖子修复 |

---

## 统计

- **总类别**: 27 大类
- **总控件数**: ~135 个
- **CSS 前缀**: `s1p-`（全部统一）
- **核心系统**: 模态框(9)、表单控件(18)、列表(17)、图片查看器(11)、Debug(11+)、帖子工具栏(10)
