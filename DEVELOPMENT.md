# S1 Plus 开发手册

> 当前代码基线：`v6.10.0` + 未发布改动。当前正在建立模块化构建基础，但正式用户脚本仍然是一个 classic userscript 文件。

## 1. 当前项目形态

### Phase 0：构建基础验证

当前仓库角色如下：

| 路径 | 当前角色 |
|---|---|
| `S1Plus.js` | 唯一 canonical runtime source、正式安装入口、metadata owner、现有 VM 测试输入 |
| `src/main.js` | 临时 esbuild 入口，仅导入根 `S1Plus.js` |
| `dist/S1Plus.user.js` | 被 Git 忽略的构建预览产物 |
| `dist/S1Plus.meta.json` | 被 Git 忽略的 esbuild 构建图 |
| `package.json` / `package-lock.json` | 构建命令与锁定工具链 |

因此：

- 运行时代码仍然直接编辑 `S1Plus.js`。
- 不允许编辑 `dist/` 生成物。
- 不允许在当前阶段把真实业务函数移动到 `src/`。
- 不允许同时在根脚本与 `src/` 保留两份 production implementation。
- 根目录测试继续使用 CommonJS；ESM 仅作用于 `src/` 与 `.mjs` 构建脚本。

完整 source-of-truth、Phase 0.5 cutover、阶段门禁与回滚规则见：

- [`docs/plans/userscript-modularization.md`](./docs/plans/userscript-modularization.md)
- [`src/README.md`](./src/README.md)

### Phase 0.5：第一次模块抽离前的必需切换

在移动任何业务代码前，必须先完成 generated-root cutover：

```text
canonical userscript metadata/version config
src/main.js
src/legacy/main.js
src/**/*.js
        ↓ build
S1Plus.js                 committed formal artifact
dist/S1Plus.user.js       ignored preview artifact
```

切换后：

- `src/` 是唯一可编辑生产源码。
- 根 `S1Plus.js` 是提交到仓库的生成物，不得手改。
- metadata `@version` 与 runtime `SCRIPT_VERSION` 来自同一配置。
- CI 重建根产物并检查没有 diff。
- 本地 loader 改为加载持续构建的 `dist/S1Plus.user.js`。

Phase 0.5 未完成时，不得开始 Phase 1 的纯函数抽离。

## 2. 环境与依赖

要求：

- Node.js `>=20`
- npm 版本按 `package.json#packageManager`
- Tampermonkey / Violentmonkey / Greasemonkey 用于真实浏览器验证

首次安装或 lockfile 未变化时统一执行：

```bash
npm ci
```

不要用未锁定依赖代替 `npm ci`。构建工具当前固定为 `esbuild 0.28.1`。

## 3. 构建与验证

### 3.1 完整 Phase 0 验证

```bash
npm run verify:bundle
```

它依次执行：

1. metadata parser 边界测试
2. 完整 userscript 构建
3. metadata、版本、构建图与体积完整性检查
4. root/bundle VM test-hook parity
5. 连续构建 SHA-256 确定性检查

### 3.2 单独命令

```bash
npm run build
npm run check:metadata-parser
npm run check:bundle
npm run check:bundle-runtime
npm run check:deterministic
```

构建配置在 Phase 0 保持保守：

- classic IIFE output
- `target: esnext`
- `splitting: false`
- `treeShaking: false`
- `minify: false`
- `sourcemap: false`
- `metafile: true`

当前目标是证明迁移通道，不是优化体积。

### 3.3 构建安全边界

构建脚本必须：

- 只从准确的 canonical source 路径移除 metadata。
- 拒绝重复或孤立 metadata marker。
- 允许读取 UTF-8 BOM，但输出不得带 BOM。
- 统一输出 LF。
- 拒绝 symlinked `dist` 或 symlinked output file。
- 验证 realpath 仍在仓库目录内。
- 通过独占临时文件和 atomic rename 写入。
- 只产生一个同步 classic userscript output。
- 不产生 external/runtime import、chunk 或 source map。

## 4. 本地浏览器开发

### 4.1 浏览器设置

Chrome / Edge：

1. 打开 `chrome://extensions`
2. 进入 Tampermonkey 详情
3. 开启“允许访问文件网址”

### 4.2 当前 Phase 0 loader

仓库包含：

- `S1Plus-Local-Mac.user.js`
- `S1Plus-Local-Windows.user.js`

当前它们仍然 `@require` 根 `S1Plus.js`，因为根脚本仍是 canonical source。Loader 的 `@grant`、`@connect`、`@match` 与 `@run-at` 必须和主脚本保持一致。

使用时：

- 关闭在线正式脚本，避免双实例。
- `@require` 使用本机绝对路径。
- 修改代码后刷新 Stage1st 页面。

Phase 0.5 后，loader 必须改为加载 `dist/S1Plus.user.js`，并配套 watch build。不要让浏览器直接加载多个源码 ESM 文件。

## 5. 测试体系

### 5.1 VM harness

`tests/s1plus-test-helpers.js`：

- 仍为 CommonJS。
- 默认读取根 `S1Plus.js`。
- 可通过 `sourcePath` 或 `sourceCode` 执行其他 userscript，例如最终 bundle。
- 设置 `__S1P_TEST_MODE__ = true`。
- 使用浏览器/GM stub。
- 从 `__S1P_TEST_HOOKS__` 读取测试边界。

不要再次在根 `package.json` 增加 `"type": "module"`，否则现有大量 `require()` 测试会失效。

### 5.2 测试分类

| 类型 | 用途 |
|---|---|
| Module unit | 直接 import 已抽离 factory，验证模块行为 |
| VM characterization | 执行 canonical userscript，冻结迁移前行为 |
| Final bundle integration | 执行最终 bundle，验证真实打包路径 |
| Source structure | 临时 CSS/源码顺序/正则断言 |
| Manual browser | 真实 Tampermonkey、DOM、时序与视觉验收 |

源码结构测试不应阻止正确的文件边界迁移。符号移动后，应将测试改成模块单测、bundle 检查或更稳定的行为断言。

### 5.3 常用测试

设置与数据：

```bash
node tests/settings-migration/test-settings-migration.js
node tests/test-settings-semantics-module.js
node tests/test-core-business-data-module.js
```

页面和组件边界：

```bash
node tests/test-image-viewer-interface.js
node tests/test-page-enhancement-projection.js
node tests/test-post-hash-anchor-alignment.js
```

同步：

```bash
node tests/test-sync-system-facade.js
node tests/test-safe-sync-execution.js
node tests/test-startup-sync-freshness.js
node tests/test-foreground-remote-probe.js
node tests/test-foreground-trigger-integration.js
node tests/test-background-sync-shared-debounce.js
node tests/test-title-sync-status.js
node tests/test-remote-push-uncertain-write.js
```

UI/CSS：

```bash
node tests/test-popover-surface-css.js
node tests/test-glass-surface-readability-css.js
node tests/test-settings-tab-panel-css.js
node tests/test-category-c-and-image-viewer-glass-css.js
```

CSS 静态断言不能替代真实截图或浏览器验收。

## 6. 生产架构边界

详细规则见 [`docs/agents/repository-guide.md`](./docs/agents/repository-guide.md)。以下边界在模块化过程中不得被打散。

### 6.1 初始化

脚本在 `document-start` 启动，并按阶段推进：

```text
document-start
body-ready
forum-ready
services-ready
content-ready
deferred
```

早期阶段只运行低依赖、避免闪烁的工作；首次 DOM 扫描和 MutationObserver 位于 `content-ready`；启动同步及非首屏工作位于 `deferred`。

### 6.2 Settings Semantics

设置读写统一经过：

- `defaultSettings`
- `buildNormalizedSettings()`
- `getSettings()`
- `getSettingsForWrite()`
- `saveSettings()`
- `s1pSettingsSemantics`

新增设置必须同时维护默认值、归一化和语义定义。

### 6.3 Core Business Data

屏蔽帖子、用户、楼层、用户标记、收藏、标题规则和阅读进度由 `s1pCoreBusinessData` 按 logical kind 管理。调用者不得直接复制其 GM key、normalizer、sync identity 或跨标签刷新逻辑。

### 6.4 Page Enhancement Projection

`s1pPageEnhancementProjection` 统一处理：

- full convergence
- scoped mutation 与 fallback
- settings runtime effects
- core-data semantic refresh intents

MutationObserver、设置面板和跨标签 caller 只负责事件收集与传输，不重新实现功能顺序和 fallback 决策。

### 6.5 Reading Progress Session

`s1pReadingProgressSession` 是页面侧唯一接口，私有拥有 observer、确认策略、timer、pending write、生命周期 finalizer 和诊断状态。

### 6.6 Sync System

页面与 UI 只通过 `s1pSyncSystem` 表达：

- local mutation
- lifecycle event
- sync request
- projected state read

以下内部边界不得被页面 caller 直接协调：

- Running Sync
- Pending Dirty Scheduler
- Lifecycle Adapter
- Indicator State Projection
- Result Phase Policy
- owner lease、generation、timer、heartbeat 和锁

手动拉取/推送是显式高优先级覆盖操作；后台、启动和前台补同步必须保持事务、锁释放和 result phase 的既有顺序。

### 6.7 UI 和安全

- 用户内容使用 `textContent`。
- 受控 HTML 使用 `sanitizeHtmlFragment()`。
- URL 使用 `getSafeUrlAttributeValue()`。
- 导入/存储对象使用 `sanitizeRecordObject()`。
- 大型玻璃 shell 复用 `.s1p-glass-panel`。
- 一级 viewport modal 使用 `.s1p-fullscreen-modal`。
- 设置内二级弹窗使用完整 settings-secondary contract。
- 图片查看器外部 caller 只使用 `s1pImageViewer` interface。

## 7. 模块抽离流程

每次抽离前记录：

- symbol/cluster
- current owner
- intended module
- mutable state
- callers
- side effects
- test hooks
- tests
- rollback

允许依赖方向：

```text
platform + shared -> core -> sync/features -> ui -> main
```

不允许循环依赖。优先移动 factory definition，待 caller 完成迁移后再移动 singleton construction。

第一批候选仅限真正纯函数：

- 数字 ID 归一化
- record sanitization 与危险键过滤
- deterministic sort/serialization
- 不读取 DOM、window、GM API 的字符串解析

不要首先移动同步系统、阅读进度、核心数据 singleton、页面投影 singleton、图片查看器、初始化、MutationObserver、大型 CSS/HTML template 或 browser/GM adapter。

## 8. 发布策略

### Phase 0

正式发布仍使用根 `S1Plus.js`。发布时必须同步：

- metadata `@version`
- runtime `SCRIPT_VERSION`
- `SCRIPT_RELEASE_DATE`
- `CHANGELOG.md`
- welcome popup copy

bundle checker 会检查 metadata 版本与 runtime 版本一致。

### Phase 0.5 以后

- 版本和 metadata 来自一个 canonical config。
- `npm run build:release` 生成根 `S1Plus.js`。
- root artifact 提交到 Git，继续维持现有 raw/update/GreasyFork 路径。
- `dist` 保持 ignored，用于 preview/watch。
- CI 使用 `npm ci`，重建正式 artifact，并检查工作树无 diff。
- release build 禁止 source map；开发 source map 如有需要只能外置并忽略。

## 9. Phase 0 完成条件

自动条件：

- `npm ci` 成功且 lockfile 不变化。
- `npm run verify:bundle` 在完整当前脚本上成功。
- 代表性的现有 CommonJS 测试成功。
- symlink output 测试拒绝写入且不修改根脚本。

人工条件：

- `dist/S1Plus.user.js` 能被 Tampermonkey 正确安装为 `6.10.0`。
- Stage1st 基础启动正常。
- 没有双初始化、明显功能回归或权限 metadata 漂移。

在真实浏览器证据完成前，只能说明自动 foundation checks 通过，不能宣称 Phase 0 已正式关闭。

## 10. 相关文档

- 模块化计划：[`docs/plans/userscript-modularization.md`](./docs/plans/userscript-modularization.md)
- Agent repository guide：[`docs/agents/repository-guide.md`](./docs/agents/repository-guide.md)
- Source module rules：[`src/README.md`](./src/README.md)
- UI 组件说明：[`UI-COMPONENTS.md`](./UI-COMPONENTS.md)
- 更新日志：[`CHANGELOG.md`](./CHANGELOG.md)
- 历史同步与调查材料：[`archive/`](./archive/)

更早的单文件开发手册细节仍可从本仓库 Git 历史中的 Phase 0 基线提交 `f13b2d548c57f96834944f15b1dc5e9a16e45303` 查阅；当前文件以现行构建、ownership 和测试流程为准。
