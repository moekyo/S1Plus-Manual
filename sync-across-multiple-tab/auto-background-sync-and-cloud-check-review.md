# 自动后台同步与自动检查云端更新实现 Review

本文基于 `S1Plus.js` 当前实现整理，重点审查自动后台同步、自动检查云端更新、同步状态判断，以及“没有外部操作却提示云端更新”的可解释路径。

## 1. 自动后台同步入口与状态流

后台同步不是独立轮询云端，而是由本地数据改动驱动：

1. 本地数据写入后调用 `updateLastModifiedTimestamp(source, { triggerSync })`。
2. 若 `triggerSync=true`，会写入 `s1p_pending_auto_sync_request`，并通过 `debouncedTriggerRemoteSyncPush()` 进入防抖。
3. 防抖完成后进入 `requestBackgroundSyncRun()` / `triggerRemoteSyncPush()`，最后执行 `performAutoSync()`，模式为 `background`。
4. `performAutoSync()` 会先拉取远端完整数据、导出本地数据，再用 `decideSyncActionByVersion()` 比较 `localHash / remoteHash / baselineHash`。

后台同步结果的主要状态：

- `no_change`：本地与远端内容 hash 相同，或在 baseline 比较下确认无内容变化。
- `pushed` / `pushed_initial`：本地较新，写入远端。
- `pulled` / `force_pulled`：远端较新，应用远端到本地。
- `merged_read_progress`：本地与远端都变了，但可判定只有阅读进度分歧，于是自动合并阅读进度、回写云端，并应用合并结果到本地。
- `conflict`：本地和远端都变了且不能安全自动合并。

截图一的“后台自动同步检测到云端变化，已保留本地阅读进度并完成自动合并”只会在后台同步真实返回 `success + merged_read_progress` 后进入刷新策略。因此它不是纯 UI 误报，而是完整同步逻辑已经判定并执行了自动合并。

## 2. 自动检查云端更新入口与状态流

自动检查云端更新有三类触发：

- 页面首次可见：`handleInitialForegroundRemoteFreshnessCheck()`。
- 回到前台 / bfcache 恢复：`visibilitychange`、`pageshow(persisted)`。
- 页面保持可见时低频轮询：现在已拆成独立设置 `syncVisibleRemotePollingEnabled`，默认关闭。

前台探测的流程：

1. 先做 metadata-only 请求，只读 Gist `updated_at`。
2. 若 `updated_at` 与已同步版本相同，返回 `unchanged`，不进入完整同步。
3. 若 `updated_at` 变化，先做本地 storage snapshot 收敛，再进入 gate 判断。
4. gate 未阻断时，执行 foreground follow-up 完整同步；该同步默认使用 fresh local snapshot，避免旧页面缓存参与 hash 比较。
5. 根据完整同步结果决定是否提示和刷新。

截图二的“检测到云端备份比当前页面更新，已自动拉取到本地”只会在完整同步真实返回 `success + pulled` 后触发。因此它同样不是单纯 UI 误报。

## 3. `pulled` 与 `merged_read_progress` 的精确条件

`pulled` 的核心条件：

- 本地内容 hash 与远端内容 hash 不同。
- 已有同步 baseline。
- 远端内容 hash 相对 baseline 变化。
- 本地内容 hash 相对 baseline 未变化。
- 启动强制拉取未把它改写成 `force_pulled`。

满足后，代码会 `importLocalData(remote.full, { suppressPostSync: true })`，更新本地数据和 baseline，然后返回 `success + pulled`。

`merged_read_progress` 的核心条件：

- 本地内容 hash 与远端内容 hash 不同。
- baseline 判定本地和远端都发生变化，原始判定进入 `conflict`。
- 本地和远端的 base hash 可比较，且排除 `read_progress` 后一致。
- 代码构建合并后的阅读进度 payload，推送到远端，再导入合并后的本地数据。

因此 `merged_read_progress` 表示“至少一次完整同步已经确认本地/远端存在阅读进度层面的分歧，并完成了自动合并”，不是 toast 层自行猜测。

## 4. 当前现象的可确认结论

可确认：

- 原实现里，“回到前台检查”会隐式启用“页面持续可见时低频轮询”。用户只开启前台检查时，也会在可见页按活跃约 4 分钟、空闲约 12 分钟持续探测。
- 原前台探测在 `updated_at` 变化后，只对 same-session 写入先做 storage snapshot 收敛。非 same-session 变化会直接进入完整同步判断。
- 如果当前页面缓存仍旧，而 baseline 或其他标签页已经推进，就可能出现“旧页面 local snapshot + 新远端 / 新 baseline”组合，进而把同机或同设备写入泛化成“云端更新”。
- 若完整同步返回 `pulled` 或 `merged_read_progress`，原文案大多使用“云端变化 / 云端较新”，没有把 same-session、same-device、external 三类来源分开。

不能仅凭现有截图确认：

- Windows 设备是否完全没有写入。理论上没有用户操作就不应主动产生本地 dirty，但如果旧页面、启动同步、设置同步或脚本恢复流程触发过写入，仍需看诊断中的 `remoteWriter`、`writerMatchKind`、`lastDirtySource`。
- 某一次 `updated_at` 变化是否只有 Gist 元数据漂移。现在完整同步会把 hash 相同的情况归为 `hash_equal_after_resync`，静默更新 baseline。

## 5. 本次修正

- 新增 `syncVisibleRemotePollingEnabled: false`。新用户与旧用户默认都关闭可见页低频轮询。
- “自动检查云端更新 = 回到前台”只负责页面打开、回到前台、bfcache 恢复时的一次性检查。
- 可见页低频轮询必须同时满足：
  - 远程同步配置完整。
  - `syncCheckOnReturnToForeground === true`。
  - `syncVisibleRemotePollingEnabled === true`。
- 设置保存、跨标签设置刷新、远程同步启停时都会重新同步轮询状态；关闭开关会立即停止现有 timer。
- 前台 probe 在发现 `updated_at` 变化后，先执行 storage snapshot 收敛，再进入完整同步判断。
- foreground follow-up 继续使用 fresh local snapshot，并按结果分层：
  - `hash_equal_after_resync`：静默更新 baseline，不提示、不刷新。
  - `same_session_write`：静默处理，必要刷新但不弹“云端更新”。
  - `same_device_write`：使用“同设备已同步更新”文案。
  - `external_remote_change`：保留“云端更新”语义。
- 诊断补充 `remoteWriter`、`writerMatchKind`、`lastAppliedContentHash`、`lastLocalModified`、`lastDirtySource`，便于复盘是哪台设备、哪个触发源推进了状态。

## 6. 设备 ID 的帮助与边界

`syncDeviceId` 有帮助，但不应参与冲突裁决。

它能帮助：

- 在远端 `syncMeta.lastWriter` 中标记写入来源。
- 将同设备写入与外部设备写入分开，降低“自己写的云端变化”被说成外部云端变化的概率。
- 在诊断面板中直接看到设备 ID、tab、session、action、sync mode。

它不能解决：

- 未设置设备 ID 时无法判断同设备来源。
- 两台设备使用相同 ID 会降低诊断可信度。
- 内容冲突仍必须由 hash、baseline、可合并性判断决定，不能因为设备 ID 相同就跳过数据安全检查。

结论：设备 ID 是诊断与文案降噪字段，不是同步冲突的裁决字段。

## 7. 2026-04-25 追加发现：后台 `merged_read_progress` 来源标记丢失

用户再次复现的提示文案是：

- “后台自动同步检测到云端变化，已保留本地阅读进度并完成自动合并。当前在帖子页，暂不自动刷新。”

这条文案只来自 `handleBackgroundAutoSyncResult()` 处理 `success + merged_read_progress` 的路径，不是前台 probe，也不是可见页低频轮询。

本次 review 确认一个独立缺陷：

1. `performAutoSync()` 在进入阅读进度自动合并前，会通过 `resolveRecentRemoteWriteMatch()` 计算远端写入是否属于 same-session 或 same-device。
2. `pulled` / `force_pulled` / `no_change` 已经把 `recentRemoteWriteResultContext` 放在 `asSuccessResult()` 第三个参数 `extraResult` 里，因此提示层可以读到 `result.sameSessionRemoteWrite` / `result.sameDeviceRemoteWrite`。
3. 但 `merged_read_progress` 分支把这些字段放进了第二个参数 `syncBaseline`。`asSuccessResult(action, syncBaseline, extraResult)` 只会把第三个参数合并进最终返回值，第二个参数只用于更新 baseline。
4. 结果是：后台自动合并已经知道“这可能是本会话 / 同设备写入”，但 `handleBackgroundAutoSyncResult()` 读到的 `result.sameSessionRemoteWrite` 为空，于是无法静默，也无法使用 same-device 文案，最终退回“云端变化”的泛化提示。

已修正：

- `merged_read_progress` 现在只把 `contentHash / remoteUpdatedAt` 放进 `syncBaseline`。
- `reason`、`remoteWriter`、`appliedRemoteWriter`、`sameSessionRemoteWrite`、`sameDeviceRemoteWrite` 放进 `extraResult`。
- 后台刷新策略可正确执行：
  - same-session：静默处理，必要时刷新但不弹“云端变化”。
  - same-device：显示“同设备已同步更新”文案。
  - external：保留“云端变化”文案。

边界仍然存在：如果没有设置 `syncDeviceId`，且某次同机写入已经超过 same-session 记录 TTL，系统无法可靠证明它来自同一台物理设备。这时仍可能只能按 external 处理。因此建议给 Mac / Windows 分别设置清晰的同步设备 ID，用于后续诊断和文案降噪。
