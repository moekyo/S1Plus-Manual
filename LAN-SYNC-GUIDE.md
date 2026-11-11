# S1 Plus 局域网同步（LAN Hub）部署与使用指南

局域网同步让同一局域网内的多台设备共用 NAS（或任何常开主机）上的一个小服务 **LAN Hub** 来同步数据：自动同步走局域网，通常 1–2 秒内完成，比 GitHub Gist 快得多；GitHub Gist 保留为手动备份与跨网兜底，NAS 还可以定时把局域网快照镜像到 Gist，供不在局域网里的设备拉取。

> **适用版本**：设置 → 同步 中能看到「局域网同步（LAN Hub）」分组的 S1 Plus 版本。
> **Hub 服务端**：源码在仓库 [`lan-sync-hub/`](./lan-sync-hub/) 目录；完整接口、环境变量与安全说明见 [`lan-sync-hub/README.md`](./lan-sync-hub/README.md)。

---

## 1. 它是怎么工作的

```
 Windows / Mac / 其它设备上的 S1 Plus
        │  ① 本地变更 → 自动同步优先 POST /snapshot（带 baseVersion）
        ▼
   ┌──────────────────┐        ② 版本 +1、落盘、广播版本变化
   │ NAS 上的 LAN Hub │ ──────────────────────────────┐
   │ data/snapshot.json│                              ▼
   └──────────────────┘         ③ 其它设备短轮询 /health 发现版本变化
        ▲                              ④ GET /snapshot → 在设备端合并
        └──────────────────────────────────────────────┘
```

- **设备端**：原有的同步引擎、合并规则、冲突裁决、同步锁全部不变，只把「远端读写」换成 LAN Hub。
- **Hub**：只做版本化存储、单写者串行化（`baseVersion` 不匹配返回 409，设备先拉取合并再重试）和版本变化通知。它不解析数据内容，也不保存 Gist 凭证。
- **Gist**：自动同步不再写 Gist；设置页的「手动同步 / 强制推送 / 强制拉取」仍然走 Gist，作为备份与跨网兜底。

---

## 2. 准备工作

1. **一台常开的内网主机**：群晖 NAS（DSM 7 自带 Container Manager）即可；任何能跑 Docker 的 Linux 主机也可以，直接跑 Node 20 也能部署。
2. **同一局域网**：参与同步的设备与 Hub 在同一网段，能访问 `http://NAS_IP:5180`。
3. **各设备已安装 S1 Plus**：同一浏览器配置里启用了脚本，且已能正常使用 GitHub Gist 远程同步（Gist ID + PAT）。
   - 说明：当前版本的自动同步调度门槛仍会检查 **Gist ID 与 PAT 是否完整**，所以即使用局域网同步，也需要先在「GitHub 连接」里填好 Gist（Gist 同时承担手动备份、跨网兜底与镜像目标）；自动同步本身不会写 Gist、不消耗 GitHub API 配额。
   - 如果还没配置过 Gist，先按设置页底部「点击此处查看设置教程」完成 Gist 配置，再回来启用局域网同步。
4. **建议**在设置页填写「同步设备 ID」（例如 `MacBook-书房`），用于识别写入设备和显示在线状态；不填也能用，但自动推送相关提示与在线状态会缺失。
5. **端口**：默认 `5180`。如果与 NAS 上已有服务冲突，需要同时改 `docker-compose.yml` 里的 `ports` 映射与 `HUB_PORT`（或 `docker run` 的 `-p` 与 `-e HUB_PORT`）。

---

## 3. 在 NAS 上部署 Hub

### 3.1 准备文件

在 File Station 新建目录，例如 `/docker/s1plus-lan-sync/`，上传仓库 `lan-sync-hub/` 里的这些文件：

| 文件 | 作用 |
| --- | --- |
| `server.js` | Hub 服务（Node 20，零依赖） |
| `test-client.html` | 同源提供的端到端延迟测试页 |
| `docker-compose.yml` | 群晖 Container Manager 部署文件 |
| `.env.example` | 环境变量模板（复制成 `.env` 后填 token） |

### 3.2 生成令牌并写 `.env`

```bash
openssl rand -hex 24
```

把输出填进 `.env`（同目录，从 `.env.example` 复制）：

```ini
HUB_TOKEN=你的随机令牌
# 可选：NAS 端 Gist 镜像（需要带 gist 权限的 GitHub Token）
HUB_GIST_MIRROR_GIST_ID=
HUB_GIST_MIRROR_TOKEN=
```

> 令牌只放在 NAS 的 `.env` 和每台设备的 S1 Plus 设置里。不要写进仓库、compose 文件、截图或 issue。`.env` 与 `data/` 已在 `lan-sync-hub/.gitignore` 中忽略。

### 3.3 建数据目录

Docker **不会**自动创建 bind mount 的宿主目录，先手动建：

```bash
mkdir -p /volume1/docker/s1plus-lan-sync/data
```

### 3.4 启动容器

**方式 A：Container Manager（推荐）**

Container Manager → **项目** → 新增 → 选择该目录的 `docker-compose.yml` → 启动。

> 如果 Container Manager 提示 `${HUB_TOKEN:?...}` 无法解析，把 compose 里那行改成字面量：`HUB_TOKEN: "你的令牌"`。

**方式 B：SSH 直接起容器**

```bash
docker run -d --name s1plus-lan-sync --restart unless-stopped \
  -p 5180:5180 \
  -e HUB_TOKEN=你的令牌 \
  -v /volume1/docker/s1plus-lan-sync/server.js:/app/server.js:ro \
  -v /volume1/docker/s1plus-lan-sync/test-client.html:/app/test-client.html:ro \
  -v /volume1/docker/s1plus-lan-sync/data:/data \
  node:20-alpine node /app/server.js
```

### 3.5 验证

```bash
curl http://NAS_IP:5180/health
# {"ok":true,"version":0,...}
```

浏览器打开 `http://NAS_IP:5180/` 应能看到延迟测试页（两台设备可以用它验证端到端延迟，典型 5–50ms）。

### 3.6 安全（公开仓库必读）

- **只在内网提供**：控制面板 → 安全性 → 防火墙，只允许内网网段访问 5180；**不要**在路由器上做端口映射，也不要通过 QuickConnect 暴露。
- **不要开启 CORS**：默认不发送 CORS 头；跨域访问才需要配置 `HUB_CORS_ORIGIN`，普通同网段使用不需要。
- **HTTPS 可选**：如需 HTTPS，用 DSM 反向代理把 `https://nas.lan:5181` 转到 `127.0.0.1:5180`，并给设备安装内网 CA。
- `data/` 里是阅读记录与设置等个人数据，不要同步到公网网盘；升级前先备份 `data/snapshot.json`。

### 3.7 升级与备份

- 升级：替换 `server.js`（和 `test-client.html`）后在 Container Manager 项目里点「重新启动」。
- 数据在 `data/snapshot.json`，历史版本在 `data/history/`（默认保留 10 份，`HUB_HISTORY=0` 可关闭）。
- 常用环境变量：`HUB_TOKEN`（必填）、`HUB_PORT`、`HUB_HOST`、`HUB_DATA_DIR`、`HUB_HISTORY`、`HUB_MAX_BODY_BYTES` 等，完整清单见 [`lan-sync-hub/README.md`](./lan-sync-hub/README.md)。

### 3.8（可选）配置 Gist 镜像凭证

想让外网/未开局域网的设备也能拿到最新数据，需要在 `.env` 里补：

```ini
HUB_GIST_MIRROR_GIST_ID=你的 Gist ID
HUB_GIST_MIRROR_TOKEN=带 gist 权限的 GitHub Token
```

这两个值只保存在 NAS，不会下发到浏览器，也不会写进日志。重启容器后，S1 Plus 设置页的镜像状态才会从「不可用」变为可用。

---

## 4. 在 S1 Plus 里配置

1. 打开 **设置 → 同步**（先确保「启用远程同步」已打开）。
2. 展开 **局域网同步（LAN Hub）** 分组。
3. 打开 **启用局域网同步**，填写：
   - **Hub 地址**：`http://NAS_IP:5180`（只接受 `http://` / `https://` 开头的根地址，保存时自动去掉末尾斜杠）
   - **Hub 令牌 (HUB_TOKEN)**：与 NAS `.env` 完全一致
4. 点 **保存设置**（同步配置修改后需要保存才生效）。
5. 点 **测试连接**：会用输入框里的当前值依次请求 `/health` 与 `/snapshot`（各 8 秒超时），校验地址和令牌，**无需先保存**。
6. **多设备启用顺序**：先在一台设备上启用，让它把本地快照推成 v1；确认没问题后再启用第二台。这样第一台的数据就是初始基线，避免两台设备几乎同时写入带来的冲突提示。

### 验证实时性

- 在 A 设备改一条阅读进度（或取消一个屏蔽），几秒内 B 设备的列表徽标/数据应更新；
- 打开 `http://NAS_IP:5180/` 测试页，两台设备填同一个 token，A 点「开始长轮询监听」、B 点「推送测试进度」，日志会显示端到端延迟。

---

## 5. 日常使用行为

| 操作 | 走的通道 | 说明 |
| --- | --- | --- |
| 自动同步（启动 / 回到前台 / 后台 / 可见页复查） | **LAN Hub** | 开启局域网同步后优先走 Hub，局域网内通常 1–2 秒完成 |
| 设置页「手动同步」 | **Gist** | 备份语义；比较与合并逻辑不变 |
| 设置页「强制推送 / 强制拉取」 | **Gist** | 不比较、不合并，危险操作；仍会用 Gist 覆盖 |
| NAS 定时 Gist 镜像（可选） | **Hub → Gist** | 由 NAS 进程执行，不依赖浏览器标签页 |

- **关闭「启用局域网同步」** 并保存后，立即回到原来的纯 Gist 路径，其余设置不受影响。
- **版本冲突（409）** 是正常并发：设备会先拉取最新快照、合并本地改动后重试，不需要你手动处理。
- **Hub 不可用时**：LAN 自动同步会失败并提示，**不会静默改走 Gist**。此时可以：
  1. 用导航栏同步按钮或设置页「手动同步」按 Gist 备份走一次；
  2. 或临时关闭「启用局域网同步」回到 Gist；
  3. 然后按第 8 节排查 Hub。
- **多标签页**：同一浏览器多标签页共享设置，同步锁与去重逻辑沿用原实现；LAN 模式下阅读进度的同步去抖从 20 秒降到约 1 秒，所以同一设备多标签页也会更快收敛。

---

## 6. Gist 镜像（可选，NAS 端执行）

用途：自动同步只写 Hub，未开局域网的设备（手机流量、异地电脑）读的是 Gist，会落后。让 NAS 定时把 Hub 快照安全合并到 Gist，这些设备就能通过原来的 Gist 自动/手动同步拿到最新数据。

配置步骤：

1. 按 3.8 在 NAS `.env` 填好 `HUB_GIST_MIRROR_GIST_ID` / `HUB_GIST_MIRROR_TOKEN` 并重启容器；
2. S1 Plus 设置 → 同步 → 局域网同步分组里：
   - 打开 **启用 Gist 镜像**；
   - 选择 **镜像频率**：每小时 / 每 6 小时 / 每天（每天需填执行时间 `HH` 时 `MM` 分）；
   - 点 **保存镜像设置**（配置保存在 Hub，不是浏览器）；
   - 需要立刻生效时点 **立即镜像到 Gist**。
3. 分组里的状态区域会显示 Hub 返回的上次镜像时间与结果；打开设置页时会自动刷新。

合并与冲突语义：

- 只有**阅读进度**差异时自动合并（按页 / 楼层 / 时间逐条取较新值）；
- 只有 Hub 一侧改了核心数据（例如局域网内取消屏蔽了某用户）时，会安全快进到 Gist；
- Gist 与 Hub 都改过核心数据时**跳过本轮并标记冲突**，绝不覆盖任何一端；此时按提示用「手动同步」比较后再决定；
- 镜像期间 Hub 收到新写入时，本轮只写 Gist，Hub 留到下一轮收敛。

---

## 7. 安全与隐私

- **令牌**只存在两个地方：NAS 的 `.env`（或 Container Manager 环境变量）和每台设备的 S1 Plus 本地设置。它不写入同步快照、不导出、不进入 Gist，诊断日志里也会脱敏。
- **个人数据**（阅读进度、屏蔽列表、设置）只保存在内网 Hub 的 `data/` 目录与各浏览器本地；不要把 `data/` 放进公网网盘或公开仓库。
- **不要暴露公网**：不做端口映射、不用 QuickConnect 暴露该端口；需要跨网时用 Gist 镜像/手动同步，而不是把 Hub 开放到公网。
- Hub 的 `/health` 是公开的，但只返回版本号与在线计数，不返回快照内容或令牌。

---

## 8. 故障排查

| 现象 | 处理 |
| --- | --- |
| 设置页「测试连接」失败 | 先在 NAS 上 `curl http://NAS_IP:5180/health`；检查容器是否运行、端口映射、防火墙是否放行内网 5180 |
| 接口返回 401 | 设置里的 Hub 令牌与 NAS `.env` 的 `HUB_TOKEN` 不一致；注意不要带多余空格 |
| 接口返回 409 `version_conflict` | 正常并发，设备会自动拉取合并重试；若持续冲突，检查是否两台设备同时大量写入 |
| 镜像状态显示「不可用」 | NAS `.env` 未配置 `HUB_GIST_MIRROR_GIST_ID` / `HUB_GIST_MIRROR_TOKEN`，或 token 没有 `gist` 权限；重启容器后再看 |
| 镜像冲突提示 | Gist 与 Hub 都有核心数据改动，按提示用「手动同步」比较后手动推送；不要直接强制覆盖 |
| Container Manager 提示 `${HUB_TOKEN:?...}` 无法解析 | 把 compose 里的 `HUB_TOKEN: "${HUB_TOKEN:?...}"` 改成字面量 `HUB_TOKEN: "你的令牌"` |
| `Bind mount failed: .../data does not exist` | 宿主目录不存在：`mkdir -p /volume1/docker/s1plus-lan-sync/data` 后重新启动 |
| `data/snapshot.json` 写入失败 | 检查 volume 挂载路径与目录权限 |
| 自动同步仍提示连 Gist | 局域网开关没保存、地址/令牌不完整，或页面没刷新；修改后点「保存设置」 |
| 两台设备都开了 LAN 但数据不更新 | 用 Hub 测试页确认两端都能读到同一 token 与快照；检查 NAS 与设备时间（只影响显示，不影响冲突判定） |

更多服务端问题（健康检查、长轮询、SSE、CORS、历史版本）见 [`lan-sync-hub/README.md`](./lan-sync-hub/README.md) 的「故障排查」一节。

---

## 9. 回滚 / 卸载

1. S1 Plus 设置 → 同步 → 局域网同步：关闭「启用局域网同步」并保存 → 立即回到纯 Gist 路径。
2. 不再需要 Hub 时：Container Manager 项目里停止并删除容器即可；`data/` 目录可保留备份后删除。
3. 想清空局域网同步基线：删除 Hub 的 `data/snapshot.json`（以及 `data/history/`）后重启容器，`/health` 回到 `version: 0`；各设备的本地数据不受影响，下次同步会重新建立基线。

---

## 10. 相关文件

- [`lan-sync-hub/README.md`](./lan-sync-hub/README.md) — Hub 部署、接口、环境变量、服务端故障排查
- [`lan-sync-hub/INTEGRATION.md`](./lan-sync-hub/INTEGRATION.md) — 设备端接入方案与实现细节
- [`lan-sync-hub/server.js`](./lan-sync-hub/server.js) — Hub 服务源码
- [`lan-sync-hub/docker-compose.yml`](./lan-sync-hub/docker-compose.yml) — 群晖 Container Manager 部署文件
