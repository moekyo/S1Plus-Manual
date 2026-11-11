# S1 Plus LAN 接入方案（Stage 1 设计）

状态：**待实现**。目标是让 LAN hub 成为可选传输层，默认关闭、行为与现状完全一致；开启后完整快照走 LAN，Gist 降为备份/跨网回退。

## 原则

1. **默认关闭**：`syncLanEnabled=false` 时所有代码路径、UI、同步行为与现在一致，不影响其他 Gist 用户。
2. **复用现有同步引擎**：不另写一套决策/合并/锁逻辑，只在远端传输边界分流到 LAN hub；`performAutoSync` 的决策、`mergeReadProgressMaps` 的合并、同步锁与调度器全部复用。
3. **Gist 保留**：LAN 开启后，自动同步（启动/前台/后台/可见页轮询）走 LAN；设置页的「强制推送/强制拉取/全局同步」仍走 Gist，作为手动备份；后续可加低频自动镜像。
4. **token 隔离**：`syncLanToken` 与 `syncRemotePat` 同级处理，不进入同步设置导出/导入。

## 传输边界

现有远端读写集中在两个函数（`S1Plus.js`）：

- `fetchRemoteData({ metadataOnly, settingsSnapshot })` — [L30377](S1Plus.js#L30377)
- `pushRemoteData(dataObject, { expectedRemoteUpdatedAt, writerContext, settingsSnapshot })` — [L30580](S1Plus.js#L30580)

计划在两者顶部按设置分流：

```js
if (isLanSyncTransportActive(settingsSnapshot) && options.transport !== "gist") {
  return await fetchRemoteDataViaLan(options);   // 或 pushRemoteDataViaLan
}
```

调用方保持不变：

| 调用方 | 位置 | 说明 |
| --- | --- | --- |
| 自动同步拉取 | [L31716](S1Plus.js#L31716) | `performAutoSync` 内 |
| 自动同步推送 | [L31756](S1Plus.js#L31756) | 同上 |
| 强制推送 / 强制拉取 | [L37793](S1Plus.js#L37793) / [L37941](S1Plus.js#L37941) | 加 `transport: "gist"` 保持备份语义 |
| 前台探测元数据 | [L33327](S1Plus.js#L33327) | 走 `fetchRemoteData({metadataOnly:true})`，自动分流 |

## LAN 适配层（新增，约 150–200 行）

```js
const lanRequest = (path, { method = "GET", body, timeoutMs = 12000 } = {}) => Promise<...>;
// GM_xmlhttpRequest + Authorization: Bearer <syncLanToken>；返回 {status, json, error}

const fetchLanRemoteState = async () => {
  // GET /health -> { version, updatedAt }
  // 返回 { version, updatedAt: iso(updatedAt), contentHash? }
};

const fetchRemoteDataViaLan = async ({ metadataOnly }) => {
  // metadataOnly: GET /health，返回 { data: {}, meta: { updatedAt } }
  // 否则: GET /snapshot?since=<knownVersion>
  //   unchanged -> { data: {}, meta: { updatedAt } }
  //   changed   -> { data: payload, meta: { updatedAt, fileTruncated:false } }
  // 成功后把 { version, contentHash, updatedAt } 写入 GM `s1p_lan_remote_state`
};

const pushRemoteDataViaLan = async (dataObject, options) => {
  // baseVersion 来自 `s1p_lan_remote_state`（缺失则先 GET /health）
  // POST /snapshot { baseVersion, deviceId, payload: dataObject }
  // 200 -> 更新 GM state，返回 { success, updatedAt: iso(res.updatedAt), writerMetadata }
  // 409 -> 更新 GM state.version = res.version，抛 retryable 错误，
  //        让 performAutoSync 重新 fetch -> 决策（pull/合并/push）自动重跑
};
```

要点：

- `updatedAt` 用 ISO 字符串（保留毫秒），与现有 `remoteUpdatedAt` 比较逻辑兼容；
- payload 就是现有同步 JSON（含 `version/lastUpdated/data/contentHash`），不需要新格式；
- `remoteWriter` 继续通过 `recordSuccessfulRemoteWriteIfNeeded` 写入，供「本机写入」判定使用；
- 请求失败映射为可重试错误（网络/5xx）或鉴权错误（401），复用现有失败/重试/提示逻辑。

## LAN 事件循环

- 页面初始化（services-ready 后）且 `syncLanEnabled`：启动 LAN 事件循环；
- `GET /health` 短轮询（3s 一次）：
  - 版本变化 → 更新 GM state → `requestBackgroundSyncRun("lan_remote_update", 0)`，让现有后台调度器拉取/合并；
  - 断线 → 1.5s 起指数退避重试（上限 30s）；401 → 停止事件循环并提示令牌失效；
  - 不用 `/wait` 长轮询：GM_xmlhttpRequest 的长连接会占住请求通道，同步拉取/推送排在其后，实测要等满一个长轮询周期（25s）才发得出去；`/wait` 仍保留给测试页/其它客户端；
- `visibilitychange → visible` 时立即补一次 `GET /health`，版本落后则触发一次同步；
- 快照读取：`GET /snapshot` 首次超时 8s，超时/网络错误换新连接重试一次（上限 20s）；hub 对 >4KB 的 JSON 响应按 `Accept-Encoding` 返回 gzip（240KB → 约 25KB），减少 Wi-Fi 丢包导致的 TCP 重传停顿；
- 锁离场：持有者页面 `pagehide` 时把 LAN 执行锁的保留窗口压缩到 1.5s（Gist 仍保留 45s），避免关页/跳转后其他标签页和手动推送被锁住几十秒；
- 本地变更：沿用现有 read progress / 数据写入触发器（`saveReadProgress` 的 `triggerSync`、core data 写入等），无需新钩子；LAN 模式下把阅读进度同步去抖从 20s 降到 1s（见下）。

## Gist 镜像（NAS 端执行）

局域网模式下自动同步只写 Hub，未开局域网的设备仍然读 Gist，因此会落后。镜像由 NAS Hub 执行，不依赖浏览器标签页：

- 凭证：`HUB_GIST_MIRROR_GIST_ID` / `HUB_GIST_MIRROR_TOKEN` 只放 NAS `.env`（Token 需要 `gist` 权限），不会下发给浏览器，也不写日志；
- 调度：设置页通过 `PUT /mirror/config` 保存 `{enabled, schedule: hourly|every6h|daily, dailyTime}`；Hub 进程内定时器执行，全部标签页关闭也照常运行；
- 合并：读取 Hub 快照与 Gist `s1plus_sync.json` 并校验 hash。只有阅读进度差异时按“页 / 楼层 / 时间”逐条合并，写回 Gist 后把合并结果写回 Hub（版本 +1 并广播）。核心数据不一致时先判断 Gist 自上次成功镜像后是否被改动：Gist 核心数据未变（Hub 单侧改动，例如局域网内取消屏蔽用户）则安全快进，把 Hub 核心数据写入 Gist（保留 Gist 自己的 settings）；Gist 与 Hub 都有核心数据改动才记录 `gist_mirror_conflict` 并跳过，绝不覆盖；
- 手动：`POST /mirror/run` 立即执行一次；设置页“立即镜像到 Gist”调用该接口；
- 状态：`GET /health` 的 `gistMirror` 字段（不含 token）与 `GET /mirror` 提供上次时间 / 结果，设置页直接展示；
- 边界：Hub 在镜像期间收到新写入时，本轮只写 Gist，Hub 留到下一轮收敛；Gist 为旧版格式时提示先用浏览器同步一次。

## 去抖与设置

- 阅读进度同步去抖：`READ_PROGRESS_SYNC_DEBOUNCE_MS`（[L3742](S1Plus.js#L3742)）在 LAN 模式下改用约 1s（新增常量 `READ_PROGRESS_SYNC_DEBOUNCE_LAN_MS = 1000`，在读取该值的位置按传输选择）；
- 新增设置（`defaultSettings` [L33987](S1Plus.js#L33987)、`buildNormalizedSettings`、`s1pCreateSettingsSemantics` [L34186](S1Plus.js#L34186)）：
  - `syncLanEnabled: false`
  - `syncLanUrl: ""`
  - `syncLanToken: ""`
- 同步设置导出/导入：在 [L27541](S1Plus.js#L27541) 的解构里排除 `syncLanUrl`/`syncLanToken`，在 [L27671](S1Plus.js#L27671) 的导入清理里删除同名键；
- 设置页「同步」tab 增加三个字段（开关、URL、token），保存走 `saveSettings()`；打开开关时校验 URL 可访问（`GET /health`）并提示 token 是否有效。

## 测试计划

1. 新增 `tests/test-lan-transport.js`（沿用 [tests/s1plus-test-hooks.js](tests/s1plus-test-hooks.js) 沙箱）：
   - mock `GM_xmlhttpRequest` 模拟 hub；
   - 覆盖：metadataOnly 探测、全量拉取、推送成功、409 后重试、401 错误映射、LAN 关闭时不发请求；
2. 回归现有同步测试：
   `test-background-sync-shared-debounce.js`、`test-safe-sync-execution.js`、`test-foreground-remote-probe.js`、`test-startup-sync-freshness.js`、`test-foreground-trigger-integration.js`；
3. 手工验证：
   - 默认关闭：两台设备行为与现在完全一致（Gist）；
   - 开启：Windows 阅读 → Mac 1–2s 内更新徽标；断网/关 hub → 回退 Gist 自动同步；
   - 两端同时改阅读进度 → 楼层取大合并，无回退。

## 分阶段

- **Stage 1**：传输分流 + LAN 事件循环 + 去抖 + 设置键（不含 UI，先用 GM 控制台/设置 JSON 验证）；默认关闭。
- **Stage 2**：设置页 UI、Gist 备份（强制推送/拉取走 Gist、可选 10 分钟镜像）、presence 显示、测试补齐。

## 回滚

- `syncLanEnabled=false` 即回到纯 Gist 路径；
- 不改动 Gist 代码，不修改现有 GM key 结构（仅新增 `s1p_lan_*`）；
- 出问题可整段删除 `fetchRemoteDataViaLan`/`pushRemoteDataViaLan`/事件循环及其调用点。

## Stage 1 实现状态（2026-11-04，分支 feat/lan-sync，未提交）

已在 `S1Plus.js` 实现（约 780 行改动）：

- 新增设置：`syncLanEnabled=false` / `syncLanUrl=""` / `syncLanToken=""`；token 与 URL 不进同步导出/导入，诊断脱敏已覆盖 token；
- `fetchRemoteData` / `pushRemoteData` 顶部按传输分流，Gist 请求代码未改；
- LAN 适配：`/health` 元数据、`/snapshot` 全量拉取、`POST /snapshot` 推送；`baseVersion` 来自最近一次全量读取；409 时推进版本并抛可重试错误，由现有结果阶段重跑「拉取 → 合并 → 推送」；
- `/health` 短轮询事件循环（3s，`s1pSyncSystem.initialize` 启动、`dispose` 停止）；版本变化触发后台同步；断线 1.5s 起指数退避（不用 `/wait` 长轮询，避免占住 GM 请求通道）；
- LAN 模式去抖：阅读进度同步 1s（Gist 20s）、阅读进度落盘 1s（Gist 5s）；
- 手动同步 / 强制推送 / 强制拉取 / 设置页 Token 校验显式 `transport: "gist"`，保留 Gist 备份语义；
- 默认关闭时所有新增路径不执行，Gist 用户行为不变。

复核与测试：`node --check S1Plus.js`；`test-background-sync-shared-debounce`、`test-safe-sync-execution`、`test-foreground-remote-probe`、`test-startup-sync-freshness`、`test-foreground-trigger-integration` 全部通过；设置迁移 17/17、settings semantics / sync facade / manual priority / sync settings UI 通过。

预期端到端：楼层确认约 1.5s + 落盘 1s + 同步去抖 1s + 拉取与刷新，约 **4–8 秒**（列表页拉取后仍走现有 reload 刷新策略）。Stage 2 做「仅阅读进度变化时原地刷徽标」后可到 1–2 秒。

### 开启方式（两台设备）

1. 确认 hub 的 `data/` 已清空（`/health` 返回 `version: 0`）；
2. 先在**一台**设备上启用，让它把本地快照推成 v1，再启用另一台；
3. 页面 Tampermonkey 控制台执行（token 从 NAS `.env` 读取，不要提交到仓库）：

```js
const s = GM_getValue("s1p_settings", {});
GM_setValue("s1p_settings", {
  ...s,
  syncLanEnabled: true,
  syncLanUrl: "http://NAS_IP:5180",
  syncLanToken: "<HUB_TOKEN>",
  syncRemoteEnabled: true,
  syncAutoEnabled: true,
  syncRemoteGistId: s.syncRemoteGistId,
  syncRemotePat: s.syncRemotePat,
  syncDeviceId: s.syncDeviceId || "device-a",
});
location.reload();
```

回退：`syncLanEnabled: false` 后刷新。

### Stage 2 实现状态（2026-11-04）

设置页 UI 已实现：设置 → 同步新增「局域网同步（LAN Hub）」分组（开关 / Hub 地址 / 令牌 + 眼睛显示切换 / 测试连接）；保存时校验 URL scheme 与令牌并写入 `syncLanEnabled`/`syncLanUrl`/`syncLanToken`；测试连接使用输入框当前值依次请求 `/health` 与 `/snapshot`（各 8s 超时）。

### Stage 2 待办

仅阅读进度的原地刷新（目标 1–2s）、hub 连续失败后的 Gist 降级与定期镜像、presence 展示、`tests/test-lan-transport.js` 固化测试。
