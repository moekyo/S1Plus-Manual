# S1 Plus LAN Sync Hub（局域网同步中枢）

给 S1 Plus 跨设备同步用的局域网中枢：一台上网设备（本仓库用群晖 NAS）保存一份带版本号的同步快照，任何设备写入后**立即通知**其它在线设备来拉取。数据合并仍然由设备端（userscript）完成，中枢只负责版本化存储、单写者串行化、事件推送和在线状态。

```
 Windows / Mac 上的 S1 Plus
        │  ① 本地变更 → POST /snapshot（带 baseVersion）
        ▼
   ┌──────────────────┐        ② 版本 +1，落盘，广播事件
   │  NAS 上的 hub     │ ──────────────────────────────┐
   │  snapshot.json    │                               │
   └──────────────────┘                               ▼
        ▲  ③ 长轮询 /wait 立即返回新版本        Mac 上开着的 S1 页面
        │     ④ GET /snapshot → 合并 → 原地刷新
        └──────────────────────────────────────────────┘
```

## 这个中枢解决什么

- **实时**：设备之间不再靠 45s 冷却 / 4min 轮询去发现对方，事件到达即拉取；局域网内单程通常 <100ms。
- **单写者串行化**：`baseVersion` 不匹配直接 409，客户端拉取、合并、重试；不会出现两个设备互相覆盖。
- **在线状态（presence）**：能知道「另一台最近同步到哪一版」，指示器可以显示真正的全局状态，而不是本机「待命」。
- **不再消耗 GitHub API 配额**，Gist 只作为跨网 / 备份兜底（接入阶段保留）。

## 目录

| 文件 | 作用 |
| --- | --- |
| `server.js` | 中枢服务（Node 20，零依赖） |
| `test-client.html` | 两台设备验证端到端延迟的测试页，由 hub 同源提供 |
| `docker-compose.yml` | 群晖 Container Manager 部署文件 |
| `.env.example` | 环境变量模板（复制为 `.env`） |
| `test/hub.test.js` | 单元测试（`node --test`） |

## 群晖部署（Container Manager）

1. 确认已安装 **Container Manager**（DSM 7 自带，旧版叫 Docker）。
2. File Station 新建目录，例如 `/docker/s1plus-lan-sync/`，上传 `server.js`、`test-client.html`、`docker-compose.yml`，并把 `.env.example` 复制为 `.env`，填入随机 token：
   ```bash
   openssl rand -hex 24
   ```
   `.env` 内容：`HUB_TOKEN=你生成的token`
3. 在目录里先建一个空的 `data/` 子目录（Docker **不会**自动创建 bind mount 的宿主目录）：
   ```bash
   mkdir -p /volume1/docker/s1plus-lan-sync/data
   ```
4. Container Manager → **项目** → 新增 → 选择该目录的 `docker-compose.yml` → 启动。
4. 验证：
   ```bash
   curl http://NAS_IP:5180/health
   # {"ok":true,"version":0,...}
   ```
   浏览器打开 `http://NAS_IP:5180/` 应看到延迟测试页。
5. 安全：控制面板 → 安全性 → 防火墙，只允许内网网段访问 5180；**不要**在路由器做端口映射，也不要通过 QuickConnect 暴露 WebDAV/该端口。

不想用「项目」时，也可以用 SSH 直接起容器：

```bash
docker run -d --name s1plus-lan-sync --restart unless-stopped \
  -p 5180:5180 \
  -e HUB_TOKEN=你的token \
  -v /volume1/docker/s1plus-lan-sync/server.js:/app/server.js:ro \
  -v /volume1/docker/s1plus-lan-sync/test-client.html:/app/test-client.html:ro \
  -v /volume1/docker/s1plus-lan-sync/data:/data \
  node:20-alpine node /app/server.js
```

升级：替换 `server.js` 后在项目里点「重新启动」即可；数据在 `data/snapshot.json`，历史版本在 `data/history/`（默认保留 10 份）。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HUB_TOKEN` | 必填 | 设备访问令牌 |
| `HUB_PORT` | `5180` | 监听端口 |
| `HUB_HOST` | `0.0.0.0` | 监听地址 |
| `HUB_DATA_DIR` | `/data` | 数据目录 |
| `HUB_HISTORY` | `10` | 保留历史版本数，`0` 关闭 |
| `HUB_MAX_BODY_BYTES` | `8388608` | 请求体上限 |
| `HUB_LONG_POLL_TIMEOUT_MS` | `25000` | 长轮询默认挂起时长 |
| `HUB_SSE_TIMEOUT_MS` | `300000` | SSE 单连接最长时长 |
| `HUB_CORS_ORIGIN` | 空（关闭） | 需要跨域访问时填写允许的来源，例如 `http://192.168.1.10:8080` |

## API

除 `/health` 和测试页外都需要 `Authorization: Bearer <HUB_TOKEN>`（也接受 `X-Sync-Token` 头；SSE 可用 `?token=`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查，返回当前版本/等待者数量 |
| `GET` | `/snapshot[?since=N]` | 取快照；`since >= version` 时返回 `{unchanged:true}` |
| `POST` | `/snapshot` | 写快照 `{baseVersion, deviceId, payload}`；版本不匹配返回 `409 {error:"version_conflict", version, contentHash}`；内容未变化返回 `deduped:true` 不推进版本 |
| `GET` | `/wait?since=N&timeout=25000` | 长轮询，版本变化立即返回；超时返回 `{timeout:true}` |
| `GET` | `/events?since=N` | SSE 流，事件名 `snapshot`，20s 心跳（EventSource 无法带 header，token 用 query） |
| `POST` | `/presence` | 上报 `{deviceId, version}` |
| `GET` | `/presence` | 读取在线设备（10 分钟过期） |

快照 payload 由客户端定义，中枢不解析；建议客户端把它当作 S1 Plus 导出的同步 JSON 整体存储。

## 验证延迟（两台设备）

1. 两台设备各打开 `http://NAS_IP:5180/`，填同一个 token，点「拉取快照」确认连通；
2. A 设备点「开始长轮询监听」，B 设备点「推送测试进度」；
3. A 的日志会显示「端到端延迟 N ms」（两台设备时钟建议开 NTP；同一局域网典型 5–50ms，事件链路本身的传输通常 <100ms）；
4. 表格里能看到两台设备的 presence 和各自同步到的版本。

## 安全注意事项（公开仓库必读）

- **本仓库是公开的**：`lan-sync-hub/.env` 与 `lan-sync-hub/data/` 已在 `lan-sync-hub/.gitignore` 中忽略；提交前跑
  `git status --short` 和 `git check-ignore -v lan-sync-hub/.env lan-sync-hub/data/snapshot.json`，确认它们不会进入提交。
- token 只放在 NAS 的 `.env`（或 Container Manager 环境变量）和每台设备的 S1 Plus 设置里；不要写进 README、compose、截图或 issue。
- 快照里是阅读记录/设置等个人数据，**只在内网提供**，NAS 防火墙收紧到内网网段，不做端口映射/QuickConnect 暴露。
- 默认不发送 CORS 头（`HUB_CORS_ORIGIN` 为空）；`/health` 公开但只返回版本号和在线计数，不返回快照内容或 token。
- SSE 的 token 放在 URL query 里会进反向代理日志；优先用长轮询（`Authorization` 头）。
- 如需 HTTPS，可用 DSM 反向代理把 `https://nas.lan:5181` 转到 `127.0.0.1:5180`，并给设备装内网 CA。
- 接入 S1 Plus 时 `syncLanToken` 必须像 `syncRemotePat` 一样从 `getSyncedSettings()` 和导入流程里排除，**绝不能进入同步快照**——否则它会跟着快照进 Gist，或被任何拿到快照的人看到。
- `data/` 不要同步到公网网盘；升级前先备份 `data/snapshot.json`。

## 接入 S1 Plus 的下一步（尚未实现）

1. 设置项：`syncLanEnabled` / `syncLanUrl` / `syncLanToken`（设备标识复用现有 `syncDeviceId`）；**token 不进入同步设置导出**，与 `syncRemotePat` 同级处理；
2. 启动/可见时：`GET /snapshot`，与本地 `contentHash` 对比；不同则按现有 `importLocalData` + `mergeReadProgressMaps` 合并；
3. 本地变更：LAN 模式下把阅读进度同步去抖从 20s 降到 ~0.5–1s，`POST /snapshot`；收到 409 时先拉取合并再重试；
4. 监听：`GM_xmlhttpRequest` 长轮询 `/wait?since=N&timeout=25s`（请求超时设 35s），事件到达后拉取并**原地刷新列表徽标**（`scheduleProgressJumpButtonsRefresh`），不再整页 reload；
5. presence：读取 `/presence`，导航栏指示器可以显示「另一台已同步到 vN」；
6. 回退：LAN 连续失败 N 次后回到现有 Gist 逻辑；Gist 仍可作为备份（例如 LAN 不可用或跨网时）；
7. 测试：新增 transport/mocks 单测（409 重试、断线回退、去抖），跑现有同步回归（`test-background-sync-shared-debounce.js` 等）。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| `curl /health` 不通 | 容器是否在运行（`docker logs s1plus-lan-sync`）；NAS 防火墙是否放行内网 5180；`docker ps` 看端口映射 |
| 接口返回 401 | token 不一致；`Authorization: Bearer <token>` 或 `X-Sync-Token` |
| 接口返回 409 `version_conflict` | 正常并发：客户端先 GET `/snapshot` 合并，再用新版本重试（测试页已内置重试） |
| Container Manager 提示 `${HUB_TOKEN:?...}` 无法解析 | 把 compose 里那行改成字面量：`HUB_TOKEN: "你的token"` |
| 长轮询迟迟不返回 | 不要经过会缓冲响应的反向代理；直连 `http://NAS_IP:5180`；服务端已带 `X-Accel-Buffering: no` |
| `Bind mount failed: .../data does not exist` | 宿主目录不存在：`mkdir -p /volume1/docker/s1plus-lan-sync/data` 后重新 `docker compose up -d` |
| `data/snapshot.json` 写入失败 | volume 挂载路径权限；node 镜像默认 root，检查目录属主 |
| presence 时间不对 | NAS 和两台设备都开 NTP（时间只用于展示，不参与冲突判定） |

## 本地开发

```bash
# 单元测试
node --test test/hub.test.js

# 本地起服务（数据写到 ./data）
HUB_TOKEN=dev-token node server.js
# 然后浏览器打开 http://127.0.0.1:5180/
```
