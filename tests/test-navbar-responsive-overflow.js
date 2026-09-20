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
  overflowBlock,
  /for \(let index = customNavItems\.length - 1; index >= 0; index -= 1\)/,
  "自定义导航应从右侧低优先级链接开始收进菜单。"
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
  /if \(isNuxCompactNavbar\(\) \|\| navUl\.clientWidth <= 0\)[\s\S]*?return;/s,
  "NUX 窄屏快捷入口接管时，不应再叠加第二套“更多”入口。"
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
