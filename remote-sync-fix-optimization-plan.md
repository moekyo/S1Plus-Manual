# S1 Plus 同步系统修复与优化方案

## 1. 目标与范围

本方案覆盖两个问题域：

1. 远程同步是否存在问题，哪些点可以优化。
2. 自动同步功能（尤其“启用自动后台同步”）是否存在问题，哪些点可以优化。

涉及文件：

- `S1Plus.js`（同步主逻辑、导入导出、启动同步、后台同步、网络请求）。

涉及配置开关：

1. 启用远程同步
2. 启用每日首次加载时同步
3. 启动时强制拉取云端数据
4. 启用自动后台同步
5. 启用手动同步高级模式（悬停选择）

---

## 2. 已识别问题清单（按优先级）

## 2.1 高风险

1. 每日同步“先标记已同步，再执行同步”。  
   问题：若网络或鉴权失败，当天不再重试。  
   位置：`handleStartupSync` 内 `s1p_last_daily_sync_date` 写入时机。

2. 未处理 Gist 文件 `truncated/raw_url`。  
   问题：数据量大时读取 `content` 可能不完整，解析失败。  
   位置：`fetchRemoteData` 读取 `files["s1plus_sync.json"].content` 的逻辑。

## 2.2 中高风险

1. 存在“读-判定-写”并发覆盖窗口。  
   问题：拉取后到推送前远端可能已变化，当前缺少二次版本确认。  
   位置：`performAutoSync`（fetch 后直接 push）。

2. 自动后台同步缺少单飞（single-flight）保护。  
   问题：多次触发可能并发执行多个同步流程。  
   位置：`triggerRemoteSyncPush` / `performAutoSync`。

## 2.3 中风险

1. 同步中直接丢弃本地修改时间更新与触发。  
   问题：同步进行中发生本地变更，可能长时间不上传。  
   位置：`updateLastModifiedTimestamp` 中 `isInitialSyncInProgress` 分支。

2. `suppressPostSync` 不能完全抑制导入后的二次触发。  
   问题：导入时底层 `save*` 仍更新时间戳并触发后台同步链路，造成冗余请求。  
   位置：`importLocalData` 与 `saveBlockedThreads/saveBlockedUsers/saveUserTags/saveTitleFilterRules/saveBookmarkedReplies/saveBlockedPosts/saveSettings`。

3. 自动后台同步无跨标签页锁。  
   问题：多标签页可重复执行同步，带来冲突概率。  
   位置：后台同步链路（启动同步已有锁，后台链路无锁）。

## 2.4 可优化

1. 请求层无 timeout/retry/backoff。  
2. 每次全量双哈希成本高（`contentHash + baseContentHash`）。  
3. 冲突弹窗可能频繁打扰。  
4. 阅读进度高频变更可能造成后台同步压力。  
5. 调试日志可能打印敏感同步配置（需确保 PAT 不落日志）。

---

## 3. 修复原则

1. 数据安全优先于自动化便利性。
2. 自动同步必须“可恢复、可抑制、可观测”。
3. 先消除数据丢失与误覆盖，再做性能优化。
4. 任何“自动覆盖”都必须有明确条件与可回退策略。

---

## 4. 分阶段实施计划

## 4.1 P0（必须先做，防丢数据）

1. 调整每日同步成功标记时机。  
   要求：仅在 `performAutoSync(true)` 返回成功后写 `s1p_last_daily_sync_date`。  
   失败、冲突、取消都不写入。

2. 增加 single-flight + pending 机制。  
   要求：后台同步若已在执行，则只记录“待同步”标志；当前同步结束后自动补跑一次。

3. 修复“同步中本地改动丢失”问题。  
   要求：`isInitialSyncInProgress` 期间，不再直接丢弃触发信号，改为设置 dirty 标记并在结束后补同步。

4. 统一导入静默写入。  
   要求：导入流程调用底层 `save*` 时可传 `suppressSyncTrigger=true`，保证拉取/导入不会触发冗余自动同步。

5. 清理敏感日志。  
   要求：禁止打印 PAT，必要日志做脱敏。

## 4.2 P1（高优先级，提升可靠性）

1. 支持 `truncated/raw_url`。  
   要求：当 Gist 文件被截断时，自动通过 `raw_url` 获取完整内容。

2. 请求层加入 timeout + retry + 指数退避。  
   要求：GET/PATCH 均支持。重试上限可配置，避免无限重试。

3. 增加并发覆盖防护（乐观并发控制）。  
   要求：push 前二次确认远端版本（如 `updated_at` 或等价版本信息），不一致则进入冲突处理而非直接覆盖。

4. 增加后台同步跨标签页锁（短 TTL）。  
   要求：避免多标签并发执行后台同步。

## 4.3 P2（体验与性能优化）

1. 哈希缓存策略。  
   要求：基于 `s1p_last_modified` 缓存哈希，减少重复计算。

2. 阅读进度触发限频。  
   要求：对阅读进度类改动单独限频，降低 API 压力。

3. 冲突提示冷却。  
   要求：同类冲突在冷却窗口内仅 toast，不重复弹窗。

4. 可观测性增强。  
   要求：记录最近失败原因、连续失败次数、上次成功时间、上次动作类型。

---

## 5. 关键实现点（函数级）

1. 同步入口与防抖  
   - `debouncedTriggerRemoteSyncPush`  
   - `triggerRemoteSyncPush`  
   - `performAutoSync`

2. 导入与写入触发  
   - `importLocalData`  
   - `saveBlockedThreads`  
   - `saveBlockedUsers`  
   - `saveUserTags`  
   - `saveTitleFilterRules`  
   - `saveBookmarkedReplies`  
   - `saveBlockedPosts`  
   - `saveSettings`

3. 启动同步  
   - `handleStartupSync`  
   - `handlePerLoadSyncCheck`

4. 网络层  
   - `fetchRemoteData`  
   - `pushRemoteData`

---

## 6. 验证与验收标准（DoD）

1. 单标签高频操作 2 分钟。  
   结果：无并发重入、无漏同步、无多余冲突弹窗。

2. 双标签同时修改。  
   结果：无静默覆盖；检测到版本变化时进入冲突流程。

3. 弱网/断网恢复。  
   结果：可自动重试；最终错误信息明确；恢复后可继续同步。

4. 大体量 Gist（触发 truncated）。  
   结果：可通过 `raw_url` 拉取并正确解析。

5. 导入/拉取流程。  
   结果：不触发冗余后台同步，不出现“拉取后立即再同步”的多余请求。

6. 安全检查。  
   结果：控制台不出现 PAT 明文。

---

## 7. 实施顺序与里程碑

1. 里程碑 A（P0 完成）：先上线防丢数据改动。  
2. 里程碑 B（P1 完成）：上线可靠性与并发防护。  
3. 里程碑 C（P2 完成）：上线性能与体验优化。  
4. 每个里程碑都需附带回归测试记录与变更说明。

---

## 8. 回滚策略

1. 为每个里程碑独立提交，便于快速回滚。  
2. 若出现异常，以“关闭自动后台同步 + 保留手动同步”作为兜底运行模式。  
3. 保证任何回滚不影响本地数据读取与手动导入导出能力。

---

## 9. 后续执行建议

1. 先按 P0 提交最小可行补丁并验证。  
2. 再推进 P1 的网络层与并发控制。  
3. 最后进行 P2 的性能和 UX 优化，避免一次性改动过大。

