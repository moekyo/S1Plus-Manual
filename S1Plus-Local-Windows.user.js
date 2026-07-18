// ==UserScript==
// @name         S1 Plus (Local Windows)
// @namespace    http://tampermonkey.net/
// @version      99.9.10
// @description  本地开发版；Phase 0 直接加载根 S1Plus.js，Phase 0.5 后切换到 dist 预览产物（Windows）
// @author       Antigravity
// @match        https://stage1st.com/2b/*
// @require      file:///D:/MyZone/S1Plus-Manual/S1Plus.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_download
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_listValues
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";
  console.log("[S1 Plus] Windows 本地加载器已启动");
})();
