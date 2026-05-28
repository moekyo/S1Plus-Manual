# 同步设置项重构计划

## 执行进度

- 状态：已完成
- 已完成：
  - 读取同步设置重构计划与仓库同步/设置指南。
  - 定位 `syncDirectChoiceMode` 在默认设置、归一化、跨标签刷新、设置弹窗、导航栏按钮和文档中的引用。
  - 从设置默认值、归一化、跨标签刷新字段、设置弹窗读写链路中移除 `syncDirectChoiceMode`。
  - 将远程同步设置页重排为“手动同步 / 自动推送 / 自动拉取 / 状态显示 / GitHub 连接”，并移除“手动同步高级模式”开关。
  - 将导航栏同步按钮改为点击和悬停均打开“拉取 / 推送”菜单，继续复用 `handleForcePull` / `handleForcePush`。
  - 替换用户可见“智能同步 / 高级模式 / 自动上传本地变更”相关文案，更新 README、DEVELOPMENT、CHANGELOG 和回归测试。
  - 确认验证目标：`node tests/settings-migration/test-settings-migration.js`、`node tests/test-sync-settings-ui.js`、`node tests/test-startup-sync-freshness.js`、`node tests/test-safe-sync-execution.js`。
  - 运行验证：
    - `node tests/settings-migration/test-settings-migration.js` 通过。
    - `node tests/test-sync-settings-ui.js` 通过。
    - `node tests/test-startup-sync-freshness.js` 通过。
    - `node tests/test-safe-sync-execution.js` 通过。
    - `git diff --check` 通过。
- 剩余：无。
- 风险：未做真实浏览器手动点验；导航栏菜单行为已由源码回归测试覆盖点击/悬停共用菜单，直接推送/拉取抢占行为由现有安全执行测试覆盖。

## 需求理解

同步设置页目前把“手动同步高级模式（悬停选择）”“云端更新检查”“自动上传本地变更”放在同一层，用户很难判断每个开关到底管的是推送、拉取，还是手动操作。重构目标是按数据方向重新组织：手动同步、自动推送、自动拉取、状态显示、GitHub 连接。

这次还要把“智能同步”从界面概念里拿掉。用户不需要看到“智能同步”“高级模式”“点击智能判断”这类说法；界面上只暴露明确动作和开关。`handleManualSync` 的安全仲裁能力仍然保留，用在初始化、冲突处理、云端损坏修复等内部流程里。

## 目标结构

```
启用远程同步 (master toggle)
├── 手动同步
│   ├── 导航栏按钮：点击/悬停均弹出推送/拉取菜单
│   ├── 导航栏手动推送/拉取优先级最高，会中断正在进行的自动同步
│   └── 收藏回复同步完整正文
├── 自动推送
│   ├── 本地变更后自动后台同步 (toggle)
│   └── 同步设备 ID
├── 自动拉取
│   ├── 每日首次打开时同步 (toggle)
│   ├──   启动时强制拉取 (conditional)
│   ├── 检查策略 (segmented: 关闭/每次加载/回到前台)
│   └──   持续可见时低频复查 (conditional)
├── 状态显示
│   ├── 显示导航栏同步状态
│   └── 显示标签页标题同步状态
└── GitHub 连接
    ├── Gist ID / PAT
    └── Token 过期提醒
```

说明：
- “自动拉取”包含 probe / safe sync / merge，并不等同于无条件覆盖本地。文案需要保留“发现变化后仍进入安全判断”的意思。
- “收藏回复同步完整正文”虽然放在“手动同步”分组下，但实际影响所有远程导出的收藏回复内容，包括自动推送。文案不能让用户误以为只影响手动操作。

## 代码发现

### `syncDirectChoiceMode` 实际行为

| 模式 | 点击按钮 | 悬停按钮 |
|------|---------|---------|
| 关闭（默认） | `handleManualSync`（安全仲裁，必要时弹窗对比） | tooltip 提示 |
| 开启 | `handleManualSync`（同上） | 推送/拉取选择菜单 |

两个模式的点击行为完全相同。`syncDirectChoiceMode` 唯一作用是控制悬浮菜单是否出现。旧文案里“关闭时点击智能判断”的说法容易让用户以为这是两套点击逻辑，实际不是。

### 自动同步与 `handleManualSync` 的关系

自动推送和自动拉取已经覆盖了大多数日常同步场景：
- 本地变更会通过后台自动同步上传。
- 每日首次、每次加载、回到前台、持续可见复查会检查云端变化。
- 阅读进度差异已有自动合并路径。
- 自动同步遇到冲突会暂停，等待用户决策。

但 `handleManualSync` 还承担自动路径不应该直接做的安全仲裁：
- 本地为空、云端有数据时，引导恢复。
- 云端为空时，引导初始化推送。
- 本地和云端都有变化时，展示对比并让用户选择拉取、推送或取消。
- 云端备份损坏时，引导用户用本地数据修复云端。

结论：智能同步不再作为产品入口出现，但 `handleManualSync` 不能删除。它应作为内部兜底能力保留。

### 手动操作抢占机制

`handleForcePush` / `handleForcePull` 已通过 `preemptActiveSync: true` 实现抢占：
- 取消所有进行中的远程请求
- 清除待处理的自动同步队列
- 释放所有同步锁
- 停止各模式的心跳

`handleManualSync` 不抢占。它只在锁空闲时获取锁，锁忙则跳过。后续文案要区分“导航栏直接推送/拉取”和 `handleManualSync` 的安全仲裁流程。

### 当前设置项关系

```
syncRemoteEnabled              → 启用远程同步 (master)
syncDailyFirstLoad              → 每日首次打开时同步
syncForcePullOnStartup          → 启动时强制拉取 (依赖 syncDailyFirstLoad)
syncPerLoadCheckEnabled         → 每次加载检查 (检查策略的一部分)
syncCheckOnReturnToForeground   → 回到前台检查 (检查策略的一部分)
syncVisibleRemotePollingEnabled → 持续可见时低频复查 (依赖 foreground 模式)
syncAutoEnabled                 → 自动推送 / 本地变更后自动后台同步
syncDeviceId                    → 同步设备 ID (syncAutoEnabled 开启时必填)
syncDirectChoiceMode            → 手动同步高级模式，待删除
syncBookmarkFullContent         → 收藏回复同步完整正文
syncShowAutoSyncIndicator       → 显示导航栏同步状态
syncShowTitleSyncStatus         → 显示标签页标题同步状态
```

## 漏项与修正

原计划只写了“导航栏按钮始终显示推送/拉取菜单”，还不够。需求是点击和悬停都弹出推送/拉取菜单，所以实现时必须移除点击 `handleManualSync()` 的路径。只把高级模式分支常开，会留下“点击仍然智能同步”的旧行为。

`syncDirectChoiceMode` 还出现在跨标签设置刷新路径里，删除设置项时也要清理：
- `SETTINGS_CROSS_TAB_LIGHTWEIGHT_PATHS`
- `shouldReinitializeNavbar`
- 设置弹窗跨标签刷新字段列表

删除 `defaultSettings.syncDirectChoiceMode` 后，归一化层的 allowed-key 清理会把旧用户数据里的 `syncDirectChoiceMode` 删除。需要加迁移测试，确认旧键不会继续留在 `s1p_settings` 或云端同步数据里。

README 和 DEVELOPMENT 里仍有“高级模式”表述，需要同步改掉：
- README 的同步说明仍写“高级模式下可悬停同步按钮”
- DEVELOPMENT 的手动覆盖章节仍写“高级同步模式下”

`handleManualSync` 里还有用户可见的“智能同步”提示。即使保留内部逻辑，也要把这些提示改成中性文案，避免界面继续露出智能同步概念。

## 实施范围

- 删除 `syncDirectChoiceMode` 设置项：默认值、归一化、设置读写、跨标签刷新字段、迁移测试。
- 设置页重组为“手动同步 / 自动推送 / 自动拉取 / 状态显示 / GitHub 连接”。
- 删除“手动同步高级模式（悬停选择）”开关和相关说明。
- 导航栏同步按钮点击和悬停都打开推送/拉取菜单。
- 导航栏推送/拉取继续使用 `handleForcePush` / `handleForcePull`，保留抢占自动同步的行为。
- 去掉用户可见文案里的“智能同步”“高级模式”。
- 更新 README、DEVELOPMENT 中的同步说明。

## 暂不处理

- 不删除 `handleManualSync`。
- 不改变自动推送、自动拉取、云端检查的触发逻辑。
- 不改变同步锁机制。
- 不改变 GitHub 连接、Token 过期提醒、状态显示的运行逻辑。
- 不在本轮重构 `handleManualSync` 的内部结构。

## `handleManualSync` 后续简化方向

可以单独做一轮内部简化，但不建议混进这次设置页重构。

优先级较高的简化：
- 抽出通用的手动拉取、手动推送、取消按钮、选择弹窗 helper。
- 合并重复的成功记录、时间戳写入、失败处理、远端版本冲突处理。
- 把“智能同步”相关提示改成中性文案。

需要谨慎评估的行为删除：
- 当前帖子内、只有阅读进度差异时，`handleManualSync` 会自动推送或合并。自动同步已经覆盖大多数日常场景，这段未来可以考虑删除或降级，但需要单独验证阅读进度、冲突恢复和初始化流程。

## 修改点清单

| # | 位置 | 操作 |
|---|------|------|
| 1 | `defaultSettings` | 删除 `syncDirectChoiceMode: false` |
| 2 | `buildNormalizedSettings` | 删除 `syncDirectChoiceMode` 归一化 block，并确认旧键被 allowed-key 清理删除 |
| 3 | `SETTINGS_CROSS_TAB_LIGHTWEIGHT_PATHS` | 删除 `syncDirectChoiceMode` |
| 4 | `shouldReinitializeNavbar` | 删除 `syncDirectChoiceMode` 判断 |
| 5 | 设置弹窗跨标签刷新字段列表 | 删除 `syncDirectChoiceMode` |
| 6 | `buildSyncSettingsTabHtml` | 重组 section、重命名、删除 direct choice toggle、移动 bookmark full content |
| 7 | `syncSettingsControls` | 删除 `directChoiceModeToggle` 查询和解构 |
| 8 | dirty 监听绑定 | 删除 `directChoiceModeToggle` |
| 9 | `applySyncSettingsToModal` | 删除 `directChoiceModeToggle.checked` 赋值 |
| 10 | `buildSyncSettingsFromModal` | 删除 `syncDirectChoiceMode` |
| 11 | 导航栏同步按钮渲染 | 点击和悬停都打开推送/拉取菜单，不再点击调用 `handleManualSync()` |
| 12 | 用户可见文案 | 移除“智能同步”“高级模式”表述 |
| 13 | README / DEVELOPMENT | 更新同步说明 |
| 14 | 测试 | 更新同步设置 UI 测试和设置迁移 fixture |

## 新旧命名对照

| 旧名 | 新名 |
|------|------|
| 云端更新检查 | 自动拉取 |
| 自动上传本地变更 | 自动推送 |
| 手动同步与数据选项 | 手动同步 |
| 手动同步高级模式 (悬停选择) | 删除 |
| 智能同步 | 不作为界面概念出现，仅保留内部安全仲裁能力 |

## 验证

```bash
node tests/settings-migration/test-settings-migration.js
node tests/test-sync-settings-ui.js
node tests/test-startup-sync-freshness.js
node tests/test-safe-sync-execution.js
```

手动验证：
1. 设置页“启用远程同步”关闭时，所有子项灰显不可操作。
2. 开启远程同步后，五个 section 显示为“手动同步 / 自动推送 / 自动拉取 / 状态显示 / GitHub 连接”。
3. 设置页不再出现“手动同步高级模式”“智能同步”“点击智能判断”。
4. 导航栏同步按钮点击和悬停都弹出推送/拉取菜单。
5. 导航栏直接推送/拉取会中断正在进行的自动同步。
6. 初始化、冲突、云端损坏修复仍能通过内部 `handleManualSync` 流程完成。
