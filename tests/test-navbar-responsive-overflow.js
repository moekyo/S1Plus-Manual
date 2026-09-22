#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { sourceCodeWithCss: sourceCode } = require("./s1plus-test-helpers");

const nuxCss = fs.readFileSync(
  path.join(__dirname, "..", "S1 NUX.css"),
  "utf8"
);

const overflowStart = sourceCode.indexOf(
  "const setupNavbarCustomOverflow ="
);
const overflowEnd = sourceCode.indexOf(
  "const normalizeNavHrefMatchKey =",
  overflowStart
);
assert.notEqual(overflowStart, -1, "缺少自定义导航溢出处理函数。");
assert.notEqual(overflowEnd, -1, "无法解析自定义导航溢出处理函数边界。");
const overflowBlock = sourceCode.slice(overflowStart, overflowEnd);

assert.match(
  overflowBlock,
  /overflowToggle\.textContent\s*=\s*"更多"/,
  "空间不足时应提供可访问的“更多”入口。"
);
assert.match(
  sourceCode,
  /const S1P_NAV_OVERFLOW_TOGGLE_ID\s*=\s*"s1p-nav-overflow-toggle"/,
  "overflow toggle must have a stable unique id."
);
assert.match(
  sourceCode,
  /const S1P_NAV_OVERFLOW_MENU_ID\s*=\s*"s1p-nav-overflow-menu"/,
  "overflow menu must have a stable unique id."
);
assert.match(
  overflowBlock,
  /overflowToggle\.id\s*=\s*S1P_NAV_OVERFLOW_TOGGLE_ID/,
  "overflow toggle must own its stable id."
);
assert.match(
  overflowBlock,
  /overflowMenu\.id\s*=\s*S1P_NAV_OVERFLOW_MENU_ID/,
  "overflow menu must own its stable id."
);
assert.match(
  overflowBlock,
  /overflowToggle\.setAttribute\("aria-controls",\s*S1P_NAV_OVERFLOW_MENU_ID\)/,
  "overflow toggle must bind aria-controls to its menu owner."
);
assert.match(
  overflowBlock,
  /menuLink\.setAttribute\("tabindex",\s*"-1"\)/,
  "overflow menuitems must be explicitly managed by the menu owner."
);
assert.match(
  overflowBlock,
  /const focusOverflowMenuLink\s*=\s*\(menuLink\)\s*=>/,
  "overflow keyboard focus must use an explicit owner helper."
);
assert.match(
  overflowBlock,
  /menuLink\.scrollIntoView\?\.\(\{ block:\s*"nearest" \}\)/,
  "focused overflow menuitems must be scrolled into the visible menu viewport."
);
assert.match(
  overflowBlock,
  /overflowMenu\.addEventListener\("keydown",\s*handleOverflowMenuKeydown\)/,
  "overflow menu must own directional keyboard navigation."
);
assert.match(
  overflowBlock,
  /case "Home"[\s\S]*?case "End"[\s\S]*?case "Escape"[\s\S]*?case "Tab"/,
  "overflow menu must implement Home, End, Escape, and Tab behavior."
);
assert.match(
  sourceCode,
  /const computeS1pNavbarLayoutProjection = \(metrics = \{\}\) => \{[\s\S]*?while \(primaryCount > 0 && !fits\(demandFor\(primaryCount, true\)\)\)[\s\S]*?primaryCount -= 1;/,
  "响应式决策必须是从右侧低优先级链接开始收缩的纯函数。"
);
assert.match(
  overflowBlock,
  /resetNavbarProjectionToCanonical\(\);[\s\S]*?const metrics = measureNavbarLayout\(\);[\s\S]*?projectNavbarLayout\(projection\);/s,
  "reconcile 必须固定走 canonical 归一化 -> 测量 -> 决策 -> 投影 的单向数据流。"
);
assert.match(
  sourceCode,
  /const measureS1pAvailableInlineWidth = \(\{ element, container \}\) => \{/,
  "可用宽度必须独立测量 container 与固定保留区域，而不是读取折叠后的导航宽度。"
);
assert.match(
  sourceCode,
  /classList\.add\(S1P_NAV_MEASURING_CLASS\)/,
  "需求宽度必须在测量态下读取，避免 flex 收缩把需求宽度压成当前分配宽度。"
);
assert.doesNotMatch(
  overflowBlock,
  /scrollWidth|clientWidth/,
  "响应式判断不得再读取折叠后的 DOM 尺寸（scrollWidth / clientWidth）。"
);
assert.doesNotMatch(
  overflowBlock,
  /setTimeout/,
  "布局稳定不得用固定超时掩盖，必须由 rAF / ResizeObserver / 字体完成事件驱动。"
);
assert.match(
  overflowBlock,
  /document\.fonts\.addEventListener\("loadingdone", handleFontsLoadingDone\)/,
  "字体加载完成必须重新测量，而不是依赖固定等待。"
);
assert.match(
  sourceCode,
  /const measureNavbarLayout = \(\) => \{/,
  "测量必须收敛到单一入口 measureNavbarLayout。"
);

// --- 单一 layout scheduling authority -------------------------------------
const reconcileCallSites = overflowBlock.match(/reconcile\(\)/g) || [];
assert.equal(
  reconcileCallSites.length,
  1,
  "setup 内部只允许首帧同步调用一次 reconcile()，其余入口必须走 scheduler。"
);
assert.match(
  overflowBlock,
  /const scheduleReconcile = \(\) => \{[\s\S]*?layoutFrame = requestAnimationFrame\(reconcile\);/,
  "scheduler 必须是唯一的 rAF 入口。"
);
assert.match(
  overflowBlock,
  /navbarLayoutReconcileRequest = scheduleReconcile;/,
  "就地修改导航 DOM 的代码必须通过通知入口接入同一个 scheduler。"
);
assert.match(
  sourceCode,
  /const requestNavbarLayoutReconcile = \(\) => \{[\s\S]*?navbarLayoutReconcileRequest\(\)/,
  "通知入口必须只转发到已注册的 scheduler。"
);
const updateNavbarSyncButtonBlock = sourceCode.slice(
  sourceCode.indexOf("const updateNavbarSyncButton = () => {"),
  sourceCode.indexOf("const ensureMyThreadsQuickLink = () => {")
);
assert.match(
  updateNavbarSyncButtonBlock,
  /requestNavbarLayoutReconcile\(\)/,
  "同步按钮的就地变更必须请求重算，而不是自己改写投影。"
);
const persistentAlertBlock = sourceCode.slice(
  sourceCode.indexOf("const renderNavbarPersistentSyncAlert = () => {"),
  sourceCode.indexOf("const ensureNavbarAutoSyncIndicatorElement = () => {")
);
assert.match(
  persistentAlertBlock,
  /requestNavbarLayoutReconcile\(\)/,
  "同步状态条的就地变更必须请求重算。"
);

// --- 测量契约 --------------------------------------------------------------
assert.match(
  sourceCode,
  /containerWidth:\s*containerBox\.contentWidth,[\s\S]*?fixedRegionWidth,[\s\S]*?availableWidth:\s*Math\.max\(0,\s*available\)/,
  "可用宽度必须给出「容器宽度 / 固定区域宽度 / 可用宽度」契约。"
);
assert.match(
  sourceCode,
  /containerWidth,\s*fixedRegionWidth,\s*renderedNavbarWidth,\s*partitionApplies,/,
  "测量契约必须包含真实渲染宽度与分区模型是否适用。"
);
assert.match(
  sourceCode,
  /const S1P_NAV_LAYOUT_EPSILON_PX = 2;/,
  "epsilon 必须保持既定的布局量化单位（2 CSS px）。"
);
assert.match(
  sourceCode,
  /#nv\.s1p-nav-measuring > ul > li,[\s\S]*?\.s1p-nav-measuring > ul > li \{/,
  "测量态选择器必须具备足够特异性，避免被主题的 !important ID 规则覆盖。"
);
assert.match(
  overflowBlock,
  /const customNavItems = customNavRecords\.map\(\(record\) => record\.item\)/,
  "响应式 owner 应从 canonical link records 投影 primary item。"
);
assert.match(
  overflowBlock,
  /const overflowMenuLinks = customNavRecords\.map\(\(record\) =>[\s\S]*?menuLink\.href = record\.href[\s\S]*?menuLink\.textContent = record\.name/,
  "overflow menu 必须复用 canonical safe href 和显示名。"
);
assert.doesNotMatch(
  overflowBlock,
  /customNavLinks\.map\(/,
  "overflow owner 不应从未经最终渲染绑定的链接数组重建 identity。"
);
assert.doesNotMatch(
  overflowBlock,
  /menuLink\.href\s*=\s*link\.href/,
  "overflow anchor 不应绕过 canonical safe href。"
);
assert.match(
  overflowBlock,
  /const mode = resolveS1pNavbarLayoutMode\(\{[\s\S]*?nuxCompact: isNuxCompactNavbar\(\)[\s\S]*?measurable: metrics\.measurable/s,
  "响应式策略必须由纯函数 resolveS1pNavbarLayoutMode 选择。"
);
assert.match(
  overflowBlock,
  /if \(mode === "nux-compact"\) \{[\s\S]*?primaryCount: customNavItems\.length/s,
  "NUX 窄屏快捷入口接管时，不应再叠加第二套“更多”入口。"
);
assert.match(
  overflowBlock,
  /else if \(mode === "unmeasured"\) \{[\s\S]*?primaryCount: 0/s,
  "布局尚未稳定时必须给出保守投影，而不是让未稳定的测量成为最终 overflow 依据。"
);
assert.match(
  overflowBlock,
  /document\.body\.appendChild\(overflowMenu\)/,
  "溢出菜单应脱离顶栏裁剪上下文，避免菜单本身被截断。"
);
assert.match(
  overflowBlock,
  /setSearchCollapsed/,
  "空间不足时应将原生搜索栏收缩为入口。"
);
assert.match(
  overflowBlock,
  /searchToggle\.textContent\s*=\s*"搜索"/,
  "搜索入口应使用清晰的文字标签。"
);
assert.doesNotMatch(
  overflowBlock,
  /setSanitizedIconHtml\(searchToggle/,
  "搜索入口不应使用图标替代文字。"
);
assert.match(
  overflowBlock,
  /searchBarParent\.replaceChild\(searchPlaceholder, searchBar\)/,
  "搜索栏折叠时应移出顶栏，但保留原 DOM 节点。"
);
assert.match(
  overflowBlock,
  /searchPlaceholder\.parentNode\.replaceChild\(searchBar, searchPlaceholder\)/,
  "搜索栏展开后应恢复到原始顶栏位置。"
);
assert.match(
  overflowBlock,
  /searchPopover\.classList\.toggle\([\s\S]*?S1P_NAV_SEARCH_POPOVER_VISIBLE_CLASS/,
  "搜索入口应通过独立浮层展开，而不是复制搜索表单。"
);
assert.match(
  sourceCode,
  /setupNavbarCustomOverflow\([\s\S]*?searchBar:\s*document\.getElementById\("scbar"\)/,
  "自定义导航初始化时应把原生搜索栏交给响应式折叠逻辑。"
);
assert.match(
  sourceCode,
  /canonicalCustomNavRecords\.push\(\{[\s\S]*?item:\s*li,[\s\S]*?name:\s*linkName,[\s\S]*?href:\s*linkHref/s,
  "primary rendering must create canonical records from final safe link values."
);
assert.match(
  sourceCode,
  /if \(canonicalCustomNavRecords\.length > 0\) \{[\s\S]*?setupNavbarCustomOverflow/s,
  "all rejected custom links must not create an overflow fallback owner."
);

const navbarStyleStart = sourceCode.indexOf(
  "/* --- 自定义导航与原生登录区的窄宽度协作 --- */"
);
const navbarStyleEnd = sourceCode.indexOf(
  "/* --- [MODIFIED] 手动同步导航按钮",
  navbarStyleStart
);
assert.notEqual(navbarStyleStart, -1, "缺少自定义导航兼容 CSS。");
assert.notEqual(navbarStyleEnd, -1, "无法解析自定义导航兼容 CSS 边界。");
const navbarStyleBlock = sourceCode.slice(navbarStyleStart, navbarStyleEnd);

assert.match(
  navbarStyleBlock,
  /\.s1p-nav-customized-header #scbar[\s\S]*?flex:\s*1 1 0 !important/,
  "搜索区应允许在认证区之前收缩。"
);
assert.match(
  navbarStyleBlock,
  /\.s1p-nav-customized-header #um[\s\S]*?flex-shrink:\s*0 !important[\s\S]*?min-width:\s*max-content/,
  "原生登录区应保持完整宽度并拥有更高布局优先级。"
);
assert.match(
  navbarStyleBlock,
  /\.s1p-nav-customized-header \.fastlg button\.pn[\s\S]*?width:\s*auto !important[\s\S]*?white-space:\s*nowrap !important/,
  "自定义导航布局下，登录按钮必须按内容保留单行宽度。"
);
assert.match(
  navbarStyleBlock,
  /\.s1p-nav-overflow-menu\[hidden\][\s\S]*?display:\s*none !important/,
  "隐藏状态下的“更多”浮层不应参与布局或拦截点击。"
);
assert.match(
  navbarStyleBlock,
  /\.s1p-nav-overflow-menu[\s\S]*?max-height:\s*calc\(100vh - 16px\)[\s\S]*?overflow-y:\s*auto[\s\S]*?overscroll-behavior:\s*contain/,
  "短视口下的“更多”浮层应在自身内部滚动并限制过度滚动。"
);
assert.match(
  navbarStyleBlock,
  /\.s1p-nav-search-toggle[\s\S]*?display:\s*none/,
  "搜索入口默认应隐藏，只有搜索栏进入紧凑状态时才显示。"
);
assert.match(
  navbarStyleBlock,
  /\.s1p-nav-search-toggle[\s\S]*?align-self:\s*center[\s\S]*?font:\s*inherit[\s\S]*?line-height:\s*35px/,
  "搜索文字入口应继承顶栏字体并与 NUX 导航项保持对齐。"
);
assert.match(
  navbarStyleBlock,
  /\.s1p-nav-overflow > a:focus-visible[\s\S]*?background:\s*var\(--s1p-hover-overlay\) !important/,
  "“更多”入口应保留清晰的 focus-visible 状态。"
);
assert.match(
  navbarStyleBlock,
  /\.s1p-nav-search-popover[\s\S]*?position:\s*fixed[\s\S]*?display:\s*flex/,
  "展开后的搜索表单应使用顶层固定浮层，避免被顶栏裁剪。"
);

assert.match(
  sourceCode,
  /#nv, #mu, #um, #hd, \.s1p-nav-overflow-menu, \.s1p-nav-search-popover/,
  "溢出菜单和搜索浮层链接应沿用顶部导航的新标签页策略。"
);
assert.match(
  sourceCode,
  /const NARROW_SCREEN_MAX_WIDTH_PX = 909/,
  "自定义导航应复用 S1 NUX 的 909px 断点。"
);
assert.match(
  nuxCss,
  /@media \(max-width: 909px\)[\s\S]*?#nv ul \{[\s\S]*?width: 72px[\s\S]*?overflow: hidden/,
  "回归应确认 S1 NUX 的 909px 快捷入口规则仍由 NUX 自己持有。"
);

console.log(
  "[navbar-responsive-overflow] custom-nav overflow and S1 NUX compatibility contracts verified."
);
