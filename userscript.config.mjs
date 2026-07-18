export const USERSCRIPT_VERSION = "6.10.0";

export const USERSCRIPT_METADATA_LINES = Object.freeze([
  "// ==UserScript==",
  "// @name         S1 Plus - Stage1st 体验增强套件",
  "// @namespace    http://tampermonkey.net/",
  `// @version      ${USERSCRIPT_VERSION}`,
  "// @description  为Stage1st论坛提供帖子/用户/楼层屏蔽、导航栏自定义、自动签到、阅读进度跟踪、回复收藏、远程同步等多种功能，全方位优化你的论坛体验。",
  "// @author       moekyo",
  "// @match        https://stage1st.com/2b/*",
  "// @grant        GM_setValue",
  "// @grant        GM_getValue",
  "// @grant        GM_addStyle",
  "// @grant        GM_deleteValue",
  "// @grant        GM_xmlhttpRequest",
  "// @grant        GM_openInTab",
  "// @grant        GM_download",
  "// @grant        GM_addValueChangeListener",
  "// @grant        GM_removeValueChangeListener",
  "// @grant        GM_listValues",
  "// @connect      *",
  "// @license      MIT",
  "// @run-at       document-start",
  "// ==/UserScript==",
]);

export const renderUserscriptMetadata = () =>
  USERSCRIPT_METADATA_LINES.join("\n");
