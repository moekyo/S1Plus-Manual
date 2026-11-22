# S1 Plus - Stage1st 体验增强套件

[![Greasy Fork 版本](https://img.shields.io/greasyfork/v/543685)](https://greasyfork.org/zh-CN/scripts/543685)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Userscript](https://img.shields.io/badge/userscript-Tampermonkey%20%7C%20Violentmonkey%20%7C%20Greasemonkey-2ea44f)](#安装)

> 面向 Stage1st 的用户脚本：屏蔽、标记、收藏、阅读进度、图片增强、自动签到与跨设备同步，安装一次，全站生效。

**[安装 S1 Plus](https://greasyfork.org/zh-CN/scripts/543685)** ｜ [更新日志](CHANGELOG.md) ｜ [开发文档](DEVELOPMENT.md) ｜ [局域网同步指南](LAN-SYNC-GUIDE.md)

## 安装

1. 安装脚本管理器：[Tampermonkey](https://www.tampermonkey.net/)、Violentmonkey 或 Greasemonkey。
2. 打开 [Greasy Fork 安装页](https://greasyfork.org/zh-CN/scripts/543685) 安装；也可以把仓库里的 `S1Plus.js` 手动导入脚本管理器。
3. 打开论坛任意页面，点导航栏的「S1 Plus 设置」按需配置。

### 本地开发

```bash
node scripts/generate-local-loader.mjs
```

会生成 `S1Plus-Local-Mac.user.js` / `S1Plus-Local-Windows.user.js`（已被 Git 忽略）。在脚本管理器中安装生成的 Loader，并开启“允许访问文件网址”；脚本元数据或资源变化后，重新运行生成命令并重装 Loader。更多说明见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 快速上手

1. 在导航栏打开「S1 Plus 设置」。
2. 按需配置「通用设置 / 屏蔽 / 标记 / 收藏 / 导航 / 同步」。
3. 使用云同步时填写 Gist ID + PAT 并保存；开启自动推送还需要填写同步设备 ID。
4. 第一次配置完建议手动同步一次，确认链路正常。

## 功能

### 屏蔽与标记

- 四层屏蔽：列表页帖子、标题关键字/正则、单条回复、用户（可联动屏蔽其主题帖）。
- 标题正则带风险检测，高风险规则自动降级为关键字匹配。
- 用户标记：颜色标签、备注、搜索、导入/导出，跨页面刷新。
- 与论坛原生黑名单双向联动，并支持在论坛黑名单页逐页导入。
- 屏蔽与标记列表支持多关键词搜索和高亮；本人楼层提供快捷编辑入口。
- 可选自动隐藏“系统已屏蔽楼层”。

### 阅读进度与收藏

- 自动记录楼层与页码：列表页显示跳转按钮，帖内显示“当前阅读位置”（可关闭）。
- 同帖多标签采用“只前进不回退”，可见楼层为空时用主楼兜底，降低漏记。
- 清理模式：按时间自动清理（一个月 / 三个月 / 六个月 / 永不）或手动分组删除。
- 回复收藏：帖内一键收藏、搜索高亮、长文展开/收起；同步可选“仅预览（默认）”或“完整正文”。

### 图片与上传

- 默认隐藏帖子图片，支持单图/整楼切换；超大图限制默认 `800x1200`，可自定义并恢复默认。
- 回复弹窗与高级编辑器粘贴截图时自动上传并插入光标处；超过论坛限制自动压缩，删图后回收未提交附件，上传期间显示提示并拦截提前提交。
- 快速回复框与版块列表的快速发帖框保留论坛原生上传流程；一次粘贴里含超限截图时，整次改由 S1 Plus 压缩上传。
- 自定义图片查看器：滚轮缩放/滚动、拖拽平移、多图切换、失败重试、单图/全部保存，适配深色模式与 `prefers-reduced-motion`。

### 导航、链接与界面

- 链接打开方式按来源独立控制：帖子/消息、阅读进度跳转、顶部导航、帖子详情页、其他论坛链接，均支持“关闭 / 新标签页 / 后台打开”。
- 纯文本 URL 自动转链接；自定义导航栏支持增删改与排序，空间不足的入口进入“更多”菜单。
- S1 NUX 主题判定统一：跟随 NUX 实际渲染的深浅色，兼容其自定义主题与 2026.11 起的 `--darktheme` 语义。
- 增强型悬浮控件（返回顶部 / 快速回复等）、NUX 顶栏“帖子”快捷入口与 S1 NUX 搭配推荐（可关闭）。
- 设置面板、确认弹窗、图片查看器与调试面板统一玻璃分层，支持 `Esc` 关闭和深色模式。

### 同步（Gist / 局域网）

- GitHub Gist 远程同步；可选局域网 LAN Hub，自动同步优先走局域网（通常 1–2 秒），Gist 保留为手动备份与跨网兜底。
- 导航栏推送/拉取走安全比较：仅阅读进度分歧时自动合并，核心数据冲突先弹窗选择，不静默覆盖；覆盖式强制推送/拉取位于设置页，确认弹窗会写明数据会丢失。
- 自动检查覆盖每日首次、每次加载、回到前台与持续可见时的低频轮询；先做轻量远端 probe，确认云端变化后再进入完整同步。
- 多标签页保护：手动/后台/启动/前台四类锁与全局互斥；离场页面把执行锁保留窗口压缩到 45 秒；冲突时暂停自动同步。
- 自动推送需填写同步设备 ID；Token 到期前 3 天提醒。
- LAN Hub 的部署、配置与故障排查见 [LAN-SYNC-GUIDE.md](LAN-SYNC-GUIDE.md)。

### 自动签到

- 按 UID 隔离，多账号互不干扰；全天候尝试，只有服务端明确返回成功/已签到才记为成功。
- 失败按指数退避重试并支持跨页面恢复；同一 UID 用 Web Locks 串行化多标签请求。
- 日期按论坛时区（GMT+8）计算；优先使用页面签到链接，缺失时用 `formhash` 构造签到地址。

## 文档

| 文档 | 内容 |
| --- | --- |
| [CHANGELOG.md](CHANGELOG.md) | 版本更新记录 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 初始化、存储、同步机制、测试与发布 |
| [AGENTS.md](AGENTS.md) | AI / 开发者的仓库入口约定 |
| [CONTEXT.md](CONTEXT.md) | 同步、状态与阅读进度的领域词汇 |
| [LAN-SYNC-GUIDE.md](LAN-SYNC-GUIDE.md) | NAS Hub 部署与局域网同步 |
| [UI-COMPONENTS.md](UI-COMPONENTS.md) | UI 组件与样式约定 |
| [docs/agents/repository-guide.md](docs/agents/repository-guide.md) | 开发命令与仓库结构 |

## 开发

- 仓库没有构建步骤，直接编辑 `S1Plus.js`；样式与静态数据在 `S1Plus.css`、`S1Plus-static-data.json`。
- 全量测试：

  ```bash
  for t in tests/test-*.js tests/settings-migration/test-*.js; do node "$t"; done
  ```

- 发布产物由 `release-min` 分支承载，`main` 保留可读源码；发布流程见 [DEVELOPMENT.md](DEVELOPMENT.md) 与 `.agents/skills/`。

## 常见问题

**数据会不会丢？** 本地数据保存在浏览器中；启用远程同步后会额外保存到你的 Gist。覆盖式强制推送/拉取会丢失一端数据，确认弹窗会明确提示。

**功能看起来没生效？** 先确认对应总开关已开启、脚本已在脚本管理器中启用，且当前页面类型匹配（列表页 / 帖子页 / 个人页）。

**本地 Loader 和 Greasy Fork 版能同时启用吗？** 不要同时启用，两个实例会重复处理同一页面；切换时先停用其中一个，再刷新论坛页面。

**局域网同步怎么部署？** 一台 NAS / 常开主机运行 `lan-sync-hub/` 里的 Hub 服务（Docker 或 Node 20），各设备在「同步 → 局域网同步」填 Hub 地址和令牌即可；完整步骤见 [LAN-SYNC-GUIDE.md](LAN-SYNC-GUIDE.md)。

**同步异常怎么排查？** 先检查 Token / Gist / 网络；局域网同步先确认 Hub 地址可达。在设置页底部版本区域悬停 5 秒，点击出现的小点打开调试控制台，在「日志与诊断」查看同步快照与日志。

## 版本与发布

- 当前发布：`v7.2.3`（2026-11-22）。
- Greasy Fork 产物由 `release-min` 分支发布（压缩版，约 1.4MB）；`main` 保留可读源码，可能包含尚未发布的改动。

## 反馈

- Issue：<https://github.com/moekyo/S1Plus-Manual/issues>

## 许可证

[MIT License](LICENSE)
