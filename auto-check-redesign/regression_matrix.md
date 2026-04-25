# Phase 7 Regression Matrix: 自动同步诊断与回归基线

## 1. 统一诊断事实源

诊断面板、复制诊断和导航栏状态入口共用 `buildSyncDiagnosticsFactSnapshot(...)` 派生出的事实层，不再各自解释状态。

| 层级 | 事实字段 | 用途 |
| --- | --- | --- |
| intent | 最近 intent、来源、priority、decision、queue、lease | 判断任务是否进入协调器、是否被 defer / skip / requeue |
| probe | freshness hint、remoteUpdatedAt、safe gate reason | 判断是否只是远端时间戳提示，以及 probe 前是否被 gate 拦截 |
| reconcile | local / remote / base / baseline hash、writer attribution、allowed action | 判断是否真的需要 pull / merge / manual / defer |
| apply | page type、sync result、apply policy、refresh decision、blocked reason | 判断当前页面为什么刷新、软提示、静默或延后 |
| runtime | global pause、circuit、shared lease、queue、tab guard | 判断全局保护和当前标签页保护是否正在生效 |
| attribution | 本地 deviceId、远端 writer、same-session / same-device / cross-device / unknown | 判断远端写入来源；配置 deviceId 与未配置 deviceId 都必须可解释 |

## 2. 固定回归矩阵

每一行都必须覆盖 `配置 deviceId` 与 `未配置 deviceId` 两种模式；未配置时 writer attribution 可以降级为 `unknown`，但同步判断仍以 hash / baseline / updated_at 为准。

| ID | 场景类 | 路径 | deviceId 覆盖 | 触发入口 | 预期诊断 / 行为 | 自动脚本基线 | 浏览器补测 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P7-MD-01 | 多设备 | 正常路径 | 配置 deviceId / 未配置 deviceId | `startup_due` / `foreground_resume` | cross-device 远端变化进入 `pull_candidate` 或 `read_progress_merge_candidate`，不普通 push | `test-safe-auto-pull-probe-reconcile.js` | 多设备实际写入后当前页检查 |
| P7-MD-02 | 多设备 | defer 路径 | 配置 deviceId / 未配置 deviceId | `foreground_resume` | dirty settings modal / pending write 只形成 tab-local defer | `test-phase7-diagnostics-regression-matrix.js`、`test-post-sync-refresh-policy.js` | dirty settings modal |
| P7-MD-03 | 多设备 | 冲突路径 | 配置 deviceId / 未配置 deviceId | `visible_poll` | hash / baseline 冲突进入 `manual_required`，状态入口导向全局手动同步 | `test-safe-auto-pull-probe-reconcile.js`、`test-auto-sync-indicator-linkage.js` | 多设备同时编辑后检查状态入口 |
| P7-MD-04 | 多设备 | 恢复路径 | 配置 deviceId / 未配置 deviceId | `pageshow(persisted)` | 先 core data snapshot resync / pending recovery settle，再决定是否 probe | `test-core-data-snapshot-resync.js` | bfcache 恢复 |
| P7-MT-01 | 多标签 | 正常路径 | 配置 deviceId / 未配置 deviceId | `local_dirty` | 本地改动进入 shared lease / queue drain，状态为 `queued_push` 或 `syncing` | `test-sync-coordinator-intent-pipeline.js` | 多标签连续本地写入 |
| P7-MT-02 | 多标签 | defer 路径 | 配置 deviceId / 未配置 deviceId | `foreground_resume` / `visible_poll` | 当前页 pending write / sync debounce 不升级为红色冲突 | `test-background-open-passive-session.js`、`test-post-sync-refresh-policy.js` | thread page 长时间阅读 |
| P7-MT-03 | 多标签 | 冲突路径 | 配置 deviceId / 未配置 deviceId | `manual_request` | 手动同步占用协调器互斥，自动 intent 被解释为等待或手动要求 | `test-sync-coordinator-intent-pipeline.js` | 手动同步弹窗打开时触发自动入口 |
| P7-MT-04 | 多标签 | 恢复路径 | 配置 deviceId / 未配置 deviceId | `pending_recovery` | pending recovery 优先于 `local_dirty`，settle 后再 drain 本地 dirty | `test-sync-coordinator-intent-pipeline.js` | 恢复遗留 pending 后再浏览 |
| P7-SD-01 | 同机不同标签 | 正常路径 | 配置 deviceId / 未配置 deviceId | `visible_poll` | same-session / same-device 写入不被说成外部远端更新；未配置时降级 unknown 但仍按 hash 判定 | `test-safe-auto-pull-probe-reconcile.js` | same-device remote write |
| P7-SD-02 | 同机不同标签 | defer 路径 | 配置 deviceId / 未配置 deviceId | `foreground_resume` | 后台打开但未真实阅读的页面处于 tab guard，不能制造可同步 read_progress | `test-background-open-passive-session.js` | 后台开多个帖子 |
| P7-SD-03 | 同机不同标签 | 冲突路径 | 配置 deviceId / 未配置 deviceId | `visible_poll` | 同机写入若仍产生真实 hash 冲突，进入 `manual_required`，不自动刷新 thread 页 | `test-safe-auto-pull-probe-reconcile.js`、`test-post-sync-refresh-policy.js` | 一个标签页编辑后另一个标签页仍有未保存状态 |
| P7-SD-04 | 同机不同标签 | 恢复路径 | 配置 deviceId / 未配置 deviceId | `pageshow(persisted)` / `visibilitychange` | 恢复后先收敛 core snapshot，状态入口和诊断面板显示同一 intent / probe / reconcile facts | `test-phase7-diagnostics-regression-matrix.js`、`test-core-data-snapshot-resync.js` | bfcache 恢复与快速隐藏 / 显示切换 |

## 3. 真实浏览器手测清单

这些场景必须在真实 Stage1st 页面 + Tampermonkey / Greasemonkey 环境补跑；Node harness 只能覆盖状态机、结果码、诊断字段和文档矩阵。

1. `thread page 长时间阅读`：帖子页持续阅读并产生阅读进度，确认 `foreground_resume` / `visible_poll` 被 tab guard 延后，不自动刷新 thread 页。
2. `后台开多个帖子`：列表页后台打开多个帖子，只真正阅读其中一个，确认未激活页不会制造可同步 `read_progress`。
3. `bfcache 恢复`：帖子页或列表页后退 / 前进恢复，确认 `pageshow(persisted)` 后先收敛 snapshot，再 probe。
4. `visible poll`：页面保持可见超过一个轮询间隔，确认只读 probe / reconcile，不直接普通 push。
5. `same-device remote write`：同机另一标签页完成后台 push 后当前页回前台，确认 configured deviceId 显示 same-device；未配置 deviceId 显示 unknown 但不误报。
6. `dirty settings modal`：设置弹窗存在未保存编辑时触发自动获取，确认状态入口显示 deferred_local_busy，诊断记录 dirty settings modal。
7. 每日首次全量同步与 `自动获取云端更新=startup` 同时存在：确认两者在文案、触发源和诊断中分别显示 `daily_startup` 与 `startup_due`。
8. S1 标准主题与 S1 NUX 主题：确认导航栏状态入口点击面板不遮挡、不溢出，诊断摘要可读。

## 4. Phase 7 验收口径

- 未来新增自动同步路径时，必须先决定它写入哪个事实层：intent、probe、reconcile、apply、runtime 或 attribution。
- 新脚本回归应优先扩展固定矩阵，而不是另起一套临时复现脚本。
- 浏览器手测未完成不阻塞 Phase 7 代码阶段完成，但必须作为发布前补测项保留。
