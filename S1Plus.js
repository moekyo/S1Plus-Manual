// ==UserScript==
// @name         S1 Plus - Stage1st 体验增强套件
// @namespace    http://tampermonkey.net/
// @version      5.1.4
// @description  为Stage1st论坛提供帖子/用户屏蔽、导航栏自定义、自动签到、阅读进度跟踪、回复收藏、远程同步等多种功能，全方位优化你的论坛体验。
// @author       moekyo
// @match        https://stage1st.com/2b/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      api.github.com
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_VERSION = "5.1.4";
  const SCRIPT_RELEASE_DATE = "2025-09-07";

  // --- [新增] SHA-256 哈希计算库 (基于 Web Crypto API) ---
  /**
   * 计算字符串的 SHA-256 哈希值。
   * @param {string} message - 要计算哈希的字符串。
   * @returns {Promise<string>} 64个字符的十六进制哈希字符串。
   */
  const sha256 = async (message) => {
    // 将消息编码为 Uint8Array
    const msgUint8 = new TextEncoder().encode(message);
    // 使用 subtle.digest 进行哈希计算
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
    // 将 ArrayBuffer 转换为字节数组
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // 将字节数组转换为十六进制字符串
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  // --- [新增] 确定性JSON序列化与哈希计算辅助函数 ---

  /**
   * 对对象进行深度排序，确保键的顺序一致，以便生成稳定的哈希值。
   * @param {any} obj 要排序的对象。
   * @returns {any} 键已排序的对象。
   */
  const deterministicSort = (obj) => {
    if (typeof obj !== "object" || obj === null) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(deterministicSort);
    }
    const sortedKeys = Object.keys(obj).sort();
    const newObj = {};
    for (const key of sortedKeys) {
      newObj[key] = deterministicSort(obj[key]);
    }
    return newObj;
  };

  // --- [新增] 全局状态标志，用于防止启动时的同步竞态条件 ---
  let isInitialSyncInProgress = false;

  /**
   * 计算数据对象的 SHA-256 哈希值。
   * @param {object} dataObject - 要计算哈希的数据对象 (即 `data` 字段的内容)。
   * @returns {Promise<string>} 计算出的哈希值。
   */
  const calculateDataHash = async (dataObject) => {
    // 1. 深度排序对象键，确保序列化结果的确定性
    const sortedData = deterministicSort(dataObject);
    // 2. 序列化为JSON字符串
    const stringifiedData = JSON.stringify(sortedData);
    // 3. 计算SHA-256哈希
    return await sha256(stringifiedData);
  };
  const SVG_ICON_DELETE_DEFAULT = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='%23374151'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0' /%3E%3C/svg%3E`;
  const SVG_ICON_DELETE_HOVER = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0' /%3E%3C/svg%3E`;
  const SVG_ICON_ARROW_MASK = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 16'%3E%3Cpath d='M2 2L8 8L2 14' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E`;

  GM_addStyle(`
        /* --- 通用颜色 --- */
        :root {
            /* -- 基础调色板 -- */
            --s1p-bg: #ECEDEB;
            --s1p-pri: #D1D9C1;
            --s1p-sub: #e9ebe8;
            --s1p-white: #ffffff;
            --s1p-black-rgb: 0, 0, 0;

            /* -- 主题色 -- */
            --s1p-t: #022C80;
            --s1p-desc-t: #10388a;
            --s1p-sec: #2563eb;
            --s1p-sec-h: #306bebff;
            --s1p-sub-h: #2563eb;
            --s1p-sub-h-t: var(--s1p-white);

            /* -- 状态色 -- */
            --s1p-red: #ef4444;
            --s1p-red-h: #dc2626;
            --s1p-green: #22c55e;
            --s1p-success-bg: #d1fae5;
            --s1p-success-text: #065f46;
            --s1p-error-bg: #fee2e2;

            /* -- 组件专属 -- */
            --s1p-text-empty: #888;
            --s1p-icon-color: #a1a1aa;
            --s1p-icon-close: #9ca3af;
            --s1p-icon-arrow: #6b7280;
            --s1p-confirm-hover-bg: #27da80;
            --s1p-cancel-hover-bg: #ff6464;
            --s1p-secondary-bg: #e5e7eb;
            --s1p-secondary-text: #374151;
            --s1p-code-bg: #eee;
            --s1p-readprogress-bg: #B8D56F;

            /* -- 阅读进度 -- */
            --s1p-progress-hot: rgb(192, 51, 34);
            --s1p-progress-cold: rgb(107, 114, 128);

            /* -- [新增] 主题覆写颜色 -- */
            --s1p-scrollbar-thumb: #C3D17F;
            --s1p-sec-classic: #a4bf7bff;
            --s1p-sub-h-classic: #b0d440;
        }

        /* --- [新增] Tab内容淡入动画 --- */
        @keyframes s1p-tab-fade-in {
            from { opacity: 0; transform: translateY(5px); }
            to   { opacity: 1; transform: translateY(0); }
        }

        /* --- [FIX] 导航栏垂直居中对齐修正 --- */
        #nv > ul {
            display: flex !important;
            align-items: center !important;
        }

        /* --- [MODIFIED] 手动同步导航按钮 (v5) --- */
        #s1p-nav-sync-btn {
            flex-shrink: 0;
            margin-left: 8px;
        }

        #s1p-nav-sync-btn a {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            vertical-align: middle;
            padding: 0 10px;
            box-sizing: border-box;
        }
        #s1p-nav-sync-btn svg {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
            color: var(--s1p-t);
            transition: color 0.3s ease, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            top: 1.5px;
        }
        /* [新增] 通过为图标的路径同时应用填充和同色描边，来实现视觉上的“加粗”效果 */
        #s1p-nav-sync-btn svg path {
            stroke: currentColor; /* 描边颜色与填充色(currentColor)一致 */
            stroke-width: 0.6px;  /* 描边宽度，可调整此值改变加粗程度 */
            stroke-linejoin: round; /* 让描边的边角更平滑 */
        }
        #s1p-nav-sync-btn a:hover svg {
            color: var(--s1p-t);
            transform: scale(1.1);
        }

        /* --- [MODIFIED] 最终简化版同步动画 (只有旋转) --- */
        @keyframes s1p-sync-simple-rotate {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
        }

        #s1p-nav-sync-btn svg.s1p-syncing {
            animation: s1p-sync-simple-rotate 0.8s linear infinite;
            pointer-events: none;
        }
        #s1p-nav-sync-btn svg.s1p-sync-success {
            /* 移除了所有成功状态的视觉效果 */
        }
        #s1p-nav-sync-btn svg.s1p-sync-error {
            /* 移除了所有失败状态的视觉效果 */
        }

        /* --- [NEW] Nav Sync Menu --- */
        .s1p-nav-sync-menu {
            position: absolute;
            z-index: 10002;
            background-color: var(--s1p-bg);
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(var(--s1p-black-rgb), 0.15);
            border: 1px solid var(--s1p-pri);
            padding: 4px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: max-content;
            opacity: 0;
            visibility: hidden;
            transform: translateY(4px);
            transition: opacity 0.15s ease-out, transform 0.15s ease-out, visibility 0.15s;
            pointer-events: none;
        }
        .s1p-nav-sync-menu.visible {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
            pointer-events: auto;
        }
        .s1p-nav-sync-menu button {
            background: none;
            border: none;
            padding: 6px 12px;
            text-align: left;
            cursor: pointer;
            border-radius: 4px;
            font-size: 14px;
            color: var(--s1p-t);
            white-space: nowrap;
        }
        .s1p-nav-sync-menu button:hover {
            background-color: var(--s1p-sub-h);
            color: var(--s1p-sub-h-t);
        }
        .s1p-nav-sync-menu button.s1p-cancel-btn:hover {
            background-color: var(--s1p-secondary-bg);
            color: var(--s1p-secondary-text);
        }

        /* --- 手动同步弹窗样式 --- */
        .s1p-sync-choice-info {
            background-color: var(--s1p-sub);
            border: 1px solid var(--s1p-pri);
            border-radius: 6px;
            padding: 12px;
            margin-top: 12px;
            font-size: 13px;
            line-height: 1.7;
        }
        .s1p-sync-choice-info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .s1p-sync-choice-info-label {
            font-weight: 500;
            color: var(--s1p-t);
        }
        .s1p-sync-choice-info-time {
            font-family: monospace, sans-serif;
        }
        .s1p-sync-choice-newer {
            color: var(--s1p-success-text);
            font-weight: bold;
        }

        /* --- 提示框样式 --- */
        .s1p-notice {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            background-color: var(--s1p-sub);
            border: 1px solid var(--s1p-pri);
            border-radius: 6px;
            padding: 12px;
            margin-top: 12px;
        }
        .s1p-notice-icon {
            flex-shrink: 0;
            width: 20px;
            height: 20px;
            background-color: var(--s1p-t);
            mask-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3e%3cpath d='M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM11 7H13V9H11V7ZM11 11H13V17H11V11Z'%3e%3c/path%3e%3c/svg%3e");
            mask-size: contain;
            mask-position: center;
            mask-repeat: no-repeat;
            margin-top: 1px;
        }
        .s1p-notice-content {
            font-size: 13px;
            line-height: 1.6;
            color: var(--s1p-desc-t);
        }
        .s1p-notice-content a {
            color: var(--s1p-t);
            font-weight: 500;
            text-decoration: none;
        }
        .s1p-notice-content a:hover {
            text-decoration: underline;
        }
        .s1p-notice-content p {
            margin: 4px 0 0 0;
            padding: 0;
        }

        /* --- 滑块式分段控件样式 --- */
        .s1p-segmented-control {
            position: relative;
            display: inline-flex;
            background-color: var(--s1p-sub);
            border-radius: 6px;
            padding: 2px;
            user-select: none;
        }
        .s1p-segmented-control-slider {
            position: absolute;
            top: 2px;
            left: 0;
            height: calc(100% - 4px);
            background-color: var(--s1p-sec);
            border-radius: 5px;
            box-shadow: 0 1px 3px rgba(var(--s1p-black-rgb), 0.1);
            transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1), transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .s1p-segmented-control:hover .s1p-segmented-control-slider {
            box-shadow: 0 2px 6px rgba(var(--s1p-black-rgb), 0.15);
        }
        .s1p-segmented-control-option {
            position: relative;
            z-index: 1;
            padding: 4px 12px;
            color: var(--s1p-desc-t);
            cursor: pointer;
            transition: color 0.25s ease-in-out, background-color 0.2s ease-in-out;
            font-size: 13px;
            line-height: 1.5;
            white-space: nowrap;
            border-radius: 4px;
        }
        .s1p-segmented-control-option.active {
            color: var(--s1p-white);
            font-weight: 500;
            cursor: default;
        }
        .s1p-segmented-control-option:not(.active):hover {
            background-color: var(--s1p-pri);
            color: var(--s1p-t);
        }

        /* --- 核心修复与通用布局 --- */
        #p_pop { display: none !important; }
        #threadlisttableid td.icn {
            padding-left: 2px !important;
        }

        /* --- [FIX FINAL v3] 帖子列表对齐与分隔符修正 --- */

        /* 1. [核心修正] 精确隐藏作为“空白分隔符”的 separatorline，
        通过 .emptb 类来识别，避免隐藏“版块主题”行。*/
        #separatorline.emptb {
            display: none !important;
        }

        /* 2. 为S1Plus注入的表头占位单元格设置宽度 */
        #threadlisttableid .th .s1p-header-placeholder {
            width: 14px;
        }

        /* 3. 统一所有列的对齐方式为左对齐，以匹配原始样式 */
        #threadlisttableid td.by,
        #threadlisttableid td.num,
        #threadlisttableid .th .by,
        #threadlisttableid .th .num {
            text-align: left !important;
        }

        /* --- 关键字屏蔽样式 --- */
        .s1p-hidden-by-keyword, .s1p-hidden-by-quote { display: none !important; }

        /* --- 按钮通用样式 --- */
        .s1p-btn { display: inline-flex; align-items: center; justify-content: center; padding: 5px 10px 5px 12px; border-radius: 4px; background-color: var(--s1p-sub); color: var(--s1p-t); font-size: 14px; font-weight: bold; cursor: pointer; user-select: none; white-space: nowrap; border: 1px solid var(--s1p-pri); transition: all 0.2s ease-in-out;}
        .s1p-btn:hover { background-color: var(--s1p-sub-h); color: var(--s1p-sub-h-t); border-color: var(--s1p-sub-h); }
        .s1p-red-btn { background-color: var(--s1p-red); color: var(--s1p-white); border-color: var(--s1p-red); }
        .s1p-red-btn:hover { background-color: var(--s1p-red-h); border-color: var(--s1p-red-h); }
        .s1p-btn.s1p-danger:hover {
            background-color: var(--s1p-red-h);
            border-color: var(--s1p-red-h);
            color: var(--s1p-white);
        }

        /* --- 帖子操作按钮 (三点图标) --- */
        .s1p-options-cell {
            position: relative;
            width: 14px;
            padding: 0 !important;
            text-align: center;
            vertical-align: middle;
        }
        .s1p-options-cell::after {
            content: '';
            position: absolute;
            top: 0;
            left: 100%;
            width: 6px;
            height: 100%;
        }
        .s1p-options-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 24px;
            border-radius: 4px;
            cursor: pointer;
            color: var(--s1p-icon-color);
            opacity: 0.4;
            transition: background-color 0.2s ease, color 0.2s ease, opacity 0.2s ease;
        }
        .s1p-options-cell:hover .s1p-options-btn {
            background-color: var(--s1p-pri);
            color: var(--s1p-t);
            opacity: 1;
        }
        .s1p-options-menu {
            position: absolute;
            top: 50%;
            left: 100%;
            margin-left: 6px;
            transform: translateY(-50%);
            z-index: 10;
            background-color: var(--s1p-bg);
            border: 1px solid var(--s1p-pri);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(var(--s1p-black-rgb), 0.1);
            padding: 5px;
            min-width: 110px;
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transition: opacity 0.15s ease-out, visibility 0.15s;
        }
        .s1p-options-cell:hover .s1p-options-menu {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
        }

        /* --- 直接确认UI --- */
        .s1p-direct-confirm {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            font-size: 14px;
            color: var(--s1p-t);
            padding: 2px 6px;
            white-space: nowrap;
        }
        .s1p-confirm-separator {
            border-left: 1px solid var(--s1p-pri);
            height: 20px;
            margin: 0 2px 0 8px;
        }
        .s1p-confirm-action-btn {
            display: flex; align-items: center; justify-content: center;
            width: 32px; height: 32px;
            border: none; border-radius: 50%;
            cursor: pointer;
            transition: background-color 0.2s ease, transform 0.1s ease, background-image 0.2s ease;
            background-repeat: no-repeat;
            background-position: center;
            background-size: 60%;
            flex-shrink: 0;
        }
        .s1p-confirm-action-btn:active { transform: scale(0.95); }
        .s1p-confirm-action-btn.s1p-confirm {
            background-color: transparent;
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='2.5' stroke='%2322c55e'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' d='M4.5 12.75l6 6 9-13.5' /%3e%3c/svg%3e");
        }
        .s1p-confirm-action-btn.s1p-confirm:hover {
            background-color: var(--s1p-confirm-hover-bg);
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='2.5' stroke='%23ffffff'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' d='M4.5 12.75l6 6 9-13.5' /%3e%3c/svg%3e");
        }
        .s1p-confirm-action-btn.s1p-cancel {
            background-color: transparent;
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='2.5' stroke='%23ef4444'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' d='M6 18L18 6M6 6l12 12' /%3e%3c/svg%3e");
        }
        .s1p-confirm-action-btn.s1p-cancel:hover {
            background-color: var(--s1p-cancel-hover-bg);
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='2.5' stroke='%23ffffff'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' d='M6 18L18 6M6 6l12 12' /%3e%3c/svg%3e");
        }

        /* --- 行内确认菜单样式 (带动画) --- */
        .s1p-inline-confirm-menu {
            transform: translateY(0) !important;
            margin-left: 0 !important;
            z-index: 10004;
            opacity: 0;
            transform: translateX(-8px) scale(0.95) !important;
            transition: opacity 0.15s ease-out, transform 0.15s ease-out;
            pointer-events: none;
            visibility: visible !important;
        }
        .s1p-inline-confirm-menu.visible {
            opacity: 1;
            transform: translateX(0) scale(1) !important;
            pointer-events: auto;
        }

        /* --- [NEW] Inline Action Menu --- */
        .s1p-inline-action-menu {
            position: absolute;
            z-index: 10004;
            display: flex;
            align-items: center;
            gap: 4px;
            background-color: var(--s1p-bg);
            border: 1px solid var(--s1p-pri);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(var(--s1p-black-rgb), 0.1);
            padding: 5px;
            opacity: 0;
            visibility: hidden;
            transform: translateY(5px) scale(0.95);
            transition: opacity 0.15s ease-out, transform 0.15s ease-out, visibility 0.15s;
            pointer-events: none;
        }
        .s1p-inline-action-menu.visible {
            opacity: 1;
            visibility: visible;
            transform: translateY(0) scale(1);
            pointer-events: auto;
        }
        .s1p-inline-action-menu .s1p-action-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 14px;
            font-weight: 500;
            color: var(--s1p-t);
            background-color: transparent;
            border: none;
            cursor: pointer;
            transition: background-color 0.2s ease, color 0.2s ease;
        }
        .s1p-inline-action-menu .s1p-action-btn:hover {
            background-color: var(--s1p-sub);
        }

        /* --- [MODIFIED] Icon Styling within Action Buttons --- */
        .s1p-inline-action-menu .s1p-action-btn svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0; /* 防止图标被压缩 */
        }

        /* --- 阅读进度UI样式 --- */
        .s1p-progress-container {
            display: inline-flex;
            align-items: center;
            margin: 0 8px;
            vertical-align: middle;
            line-height: 1;
        }
        .s1p-progress-jump-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 12px;
            font-weight: bold;
            text-decoration: none;
            border: 1px solid;
            border-radius: 4px;
            padding: 1px 6px 1px 4px;
            transition: all 0.2s ease-in-out;
            line-height: 1.4;
        }
        .s1p-progress-jump-btn::before {
            content: '';
            display: inline-block;
            width: 1.1em;
            height: 1.1em;
            background-color: currentColor;
            mask-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3e%3cpath d='M19 15l-6 6-1.42-1.42L15.17 16H4V4h2v10h9.17l-3.59-3.58L13 9l6 6z' fill='black'/%3e%3c/svg%3e");
            mask-size: contain;
            mask-repeat: no-repeat;
            mask-position: center;
        }
        .s1p-new-replies-badge {
            display: inline-block;
            color: var(--s1p-white);
            font-size: 12px;
            font-weight: bold;
            padding: 1px 5px;
            border: 1px solid;
            border-left: none;
            border-radius: 0 4px 4px 0;
            line-height: 1.4;
            user-select: none;
        }

        /* --- 通用输入框样式 --- */
        .s1p-input {
            width: 100%;
            background: var(--s1p-bg);
            border: 1px solid var(--s1p-pri);
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 14px;
            box-sizing: border-box;
            transition: border-color 0.2s ease-in-out, background-color 0.2s ease-in-out;
            color: var(--s1p-t);
        }
        .s1p-input:focus {
            outline: none;
            border-color: var(--s1p-sec);
            background-color: var(--s1p-white);
        }
        .s1p-textarea {
            resize: vertical;
            min-height: 80px;
        }

        /* --- [新增] 优化 Windows 下密码输入框样式 --- */
        #s1p-remote-pat-input {
            /* 修正部分 Windows 系统下字体渲染问题 */
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            /* 增加字符间距，让星号 (*) 显示更清晰 */
            letter-spacing: 1.5px;
        }
        #s1p-remote-pat-input::-ms-reveal {
            /* 隐藏 Windows Edge/IE 浏览器自带的显示密码图标 */
            display: none;
        }

        /* --- 用户标记悬浮窗 --- */
        .s1p-tag-popover {
            position: absolute;
            z-index: 10001;
            width: 300px;
            background-color: var(--s1p-bg);
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(var(--s1p-black-rgb), 0.08);
            border: 1px solid var(--s1p-pri);
            opacity: 0;
            visibility: hidden;
            transform: translateY(5px) scale(0.98);
            transition: opacity 0.2s ease-out, transform 0.2s ease-out, visibility 0.2s;
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        .s1p-tag-popover.visible {
            opacity: 1;
            visibility: visible;
            transform: translateY(0) scale(1);
            pointer-events: auto;
        }
        .s1p-popover-content {
            padding: 16px;
        }
        .s1p-popover-main-content {
            font-size: 14px;
            line-height: 1.6;
            color: var(--s1p-t);
            padding: 4px 4px 20px 4px;
            min-height: 30px;
            word-wrap: break-word;
            white-space: pre-wrap;
        }
        .s1p-popover-main-content.s1p-empty {
            text-align: center;
            color: var(--s1p-text-empty);
        }
        .s1p-popover-hr {
            border: none;
            border-top: 1px solid var(--s1p-pri);
            margin: 0;
        }
        .s1p-popover-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding-top: 16px;
        }
        .s1p-popover-user-container {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }
        .s1p-popover-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
            background-color: var(--s1p-pri);
        }
        .s1p-popover-user-info {
            flex-grow: 1;
            min-width: 0;
        }
        .s1p-popover-username {
            font-weight: 500;
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .s1p-popover-user-id {
            font-size: 12px;
            color: var(--s1p-desc-t);
            white-space: nowrap;
        }
        .s1p-popover-actions {
            display: flex;
            gap: 8px;
            flex-shrink: 0;
        }
        .s1p-edit-mode-header {
            font-weight: 600;
            font-size: 15px;
            margin-bottom: 12px;
        }
        .s1p-edit-mode-textarea {
            height: 90px;
            margin-bottom: 12px;
        }
        .s1p-edit-mode-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        /* --- [NEW] 通用显示悬浮窗 --- */
        .s1p-generic-display-popover {
            position: absolute;
            z-index: 10003;
            max-width: 350px;
            background-color: var(--s1p-bg);
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(var(--s1p-black-rgb), 0.12);
            border: 1px solid var(--s1p-pri);
            padding: 10px 14px;
            font-size: 13px;
            line-height: 1.6;
            color: var(--s1p-t);
            opacity: 0;
            visibility: hidden;
            transform: translateY(5px);
            transition: opacity 0.15s ease-out, transform 0.15s ease-out;
            pointer-events: none;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .s1p-generic-display-popover.visible {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        /* --- [ULTIMATE FIX V2.1] Flexbox Layout Fix (Ultimate Version) --- */
        .pi {
            display: flex !important;
            align-items: center;
            gap: 8px;
            position: relative !important; /* <-- [新增] 为绝对定位的子元素提供定位上下文 */
        }
        .pi > .pti {
            min-width: 0;
            position: static !important;
            z-index: auto !important;
            order: 1;
            overflow: hidden;
        }
        /* [新增] 布局伸缩器，永久固定右侧元素 */
        .s1p-layout-spacer {
            margin-left: auto;
            order: 2;
        }
        .pi > strong {
            flex-shrink: 0;
            order: 4;
        }
        .pi > #fj {
            margin-left: 0;
            order: 5;
            flex-shrink: 0;
            position: static !important;
            z-index: auto !important;
        }
        .authi {
            display: flex !important;
            align-items: center;
            flex-wrap: nowrap;
            overflow: hidden;
            white-space: nowrap !important;
        }

        /* --- [FINAL FIX v2] Corrected CSS Selector Specificity --- */

        /* 1. 最外层容器: flex布局，这是基础 */
        .s1p-authi-container {
            display: flex;
            align-items: center;
            min-width: 0;
        }

        /* 2. 原生按钮容器: 绝对不允许被压缩 */
        .s1p-authi-container > .authi {
            flex-shrink: 0;
            white-space: nowrap;
        }

        /* 3. 脚本按钮总容器: 作为被压缩的主要对象，内部强制不换行 */
        .s1p-authi-container > .s1p-authi-actions-wrapper {
            display: flex;
            align-items: center;
            flex-shrink: 1;
            min-width: 0;
            flex-wrap: nowrap;
        }

        /* 4. [已修正冲突] 脚本容器 *内部* 元素的精确规则: */

        /* a) 用户标记容器(.s1p-user-tag-container): 这是唯一允许被压缩的元素 */
        .s1p-authi-actions-wrapper > .s1p-user-tag-container {
            flex-shrink: 1;
            min-width: 30px;
        }

        /* b) 其他所有按钮(<a>)和分隔符(<span>): 绝对不允许被压缩 */
        .s1p-authi-actions-wrapper > a.s1p-authi-action,
        .s1p-authi-actions-wrapper > span.pipe {
            flex-shrink: 0;
        }

        .s1p-authi-actions-wrapper {
            display: inline-flex;
            align-items: center;
            min-width: 0;
            vertical-align: middle;
        }
        .s1p-user-tag-container {
            display: inline-flex;
            align-items: center;
            flex-shrink: 1;
            min-width: 30px;
            vertical-align: middle;
            overflow: hidden;
            border-radius: 6px;
        }
        .s1p-user-tag-display {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: block;
            background-color: var(--s1p-sub);
            color: var(--s1p-t);
            padding: 2px 8px;
            font-size: 12px;
            cursor: default;
        }
        .s1p-user-tag-options {
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: var(--s1p-sub);
            color: var(--s1p-t);
            padding: 0 8px;
            flex-shrink: 0;
            align-self: stretch;
            cursor: pointer;
            transition: background-color 0.2s ease-in-out;
        }
        .s1p-user-tag-options:hover {
            background-color: var(--s1p-pri);
        }

        /* --- Tag Options Menu --- */
        .s1p-tag-options-menu {
            position: absolute;
            z-index: 10002;
            background-color: var(--s1p-bg);
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(var(--s1p-black-rgb), 0.15);
            border: 1px solid var(--s1p-pri);
            padding: 4px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: max-content;
        }
        .s1p-tag-options-menu button {
            background: none;
            border: none;
            padding: 6px 12px;
            text-align: left;
            cursor: pointer;
            border-radius: 4px;
            font-size: 14px;
            color: var(--s1p-t);
            white-space: nowrap;
        }
        .s1p-tag-options-menu button:hover {
            background-color: var(--s1p-sub-h);
            color: var(--s1p-sub-h-t);
        }
        .s1p-tag-options-menu button.s1p-delete:hover {
            background-color: var(--s1p-red);
            color: var(--s1p-white);
        }

        /* --- 设置面板样式 --- */
        .s1p-modal { display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%;  background-color: rgba(var(--s1p-black-rgb), 0.5); justify-content: center; align-items: center; z-index: 9999; }
        .s1p-modal-content { background-color: var(--s1p-bg); border-radius: 8px; box-shadow: 0 4px 6px rgba(var(--s1p-black-rgb), 0.1); width: 600px; max-width: 90%; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; position: relative; }
        .s1p-modal-header { background: var(--s1p-pri) ;padding: 16px; border-bottom: 1px solid var(--s1p-pri); display: flex; justify-content: space-between; align-items: center; }
        .s1p-modal-title { font-size: 18px; font-weight: bold; }
        .s1p-modal-close {
            width: 12px;
            height: 12px;
            cursor: pointer;
            color: var(--s1p-icon-close);
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M2 2L14 14M14 2L2 14' stroke='currentColor' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: center;
            background-size: contain;
            transition: color 0.2s ease-in-out, transform 0.2s ease-in-out;
            transform: rotate(0deg);
        }
        .s1p-modal-close:hover {
            color: var(--s1p-red);
            transform: rotate(90deg);
        }
        .s1p-modal-body { padding: 8px 16px 16px; overflow-y: auto; flex-grow: 1; }
        .s1p-modal-footer { padding: 12px 16px; border-top: 1px solid var(--s1p-pri); text-align: right; font-size: 12px; }

        /* --- [OPTIMIZED] 设置面板Tabs样式 (Pill / 滑块样式) --- */
        .s1p-tabs {
            position: relative;
            display: inline-flex; /* 使容器宽度自适应内容 */
            background-color: var(--s1p-sub);
            border-radius: 6px;
            padding: 4px;
            margin-bottom: 16px;
        }
        .s1p-tab-slider {
            position: absolute;
            top: 4px;
            left: 0;
            height: calc(100% - 8px);
            background-color: var(--s1p-white);
            border-radius: 4px;
            box-shadow: 0 1px 2px rgba(var(--s1p-black-rgb), 0.1);
            transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1), transform 1s cubic-bezier(0.4, 0, 0.2, 1);
        }
          .s1p-tab-content.active {
          display: block;
          animation: s1p-tab-fade-in 0.55s ease-out forwards;
        }
        .s1p-tab-btn {
            position: relative;
            z-index: 1;
            padding: 6px 16px;
            cursor: pointer;
            border: none;
            background-color: transparent;
            font-size: 14px;
            font-weight: 500;
            color: var(--s1p-desc-t);
            white-space: nowrap;
            border-radius: 4px;
            /* [修改] 增加 background-color 的过渡动画 */
            transition: color 0.25s ease, background-color 0.2s ease;
        }
        .s1p-tab-btn:hover:not(.active) {
            color: var(--s1p-t);
            /* [新增] 添加背景色高亮效果 */
            background-color: var(--s1p-pri);
        }
        .s1p-tab-btn.active {
            color: var(--s1p-t);
            cursor: default;
        }
        .s1p-tab-content {
            display: none;
            padding-top: 0;
        }
        
        .s1p-tabs-wrapper {
            display: flex;
            justify-content: center;
        }
        .s1p-empty { text-align: center; padding: 24px; color: var(--s1p-desc-t); }
        .s1p-list { display: flex; flex-direction: column; gap: 8px; }
        .s1p-item { display: flex; justify-content: space-between; align-items: flex-start; padding: 12px; border-radius: 6px; background-color: var(--s1p-bg); border: 1px solid var(--s1p-pri); }
        .s1p-item-info { flex-grow: 1; min-width: 0; }
        .s1p-item-title { font-weight: 500; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s1p-item-meta { font-size: 12px; color: var(--s1p-desc-t);}
        .s1p-item-toggle { font-size: 12px; color: var(--s1p-desc-t); display: flex; align-items: center; gap: 8px; }
        .s1p-item-toggle input { /* Handled by .s1p-switch */ }
        .s1p-unblock-btn:hover { background-color: #07855b; border-color: #07855b; }
        .s1p-sync-title { font-size: 14px; font-weight: 500; margin-bottom: 8px; }
        .s1p-local-sync-desc { font-size: 14px; color: var(--s1p-desc-t); margin-bottom: 12px; line-height: 1.5; }
        .s1p-local-sync-buttons { display: flex; gap: 8px; margin-bottom: 16px; }
        .s1p-sync-textarea { width: 100%; min-height: 80px; margin-bottom: 20px;}

        /* --- [OPTIMIZED] Sync Settings Panel Disabled State --- */
        #s1p-remote-sync-controls-wrapper {
            transition: opacity 0.3s ease-out;
        }
        #s1p-remote-sync-controls-wrapper.is-disabled {
            opacity: 0.5;
            pointer-events: none;
        }

        /* --- 悬浮提示框 (Toast Notification) --- */
        @keyframes s1p-toast-shake {
            10%, 90% { transform: translate(-51%, 0); }
            20%, 80% { transform: translate(-49%, 0); }
            30%, 50%, 70% { transform: translate(-52%, 0); }
            40%, 60% { transform: translate(-48%, 0); }
        }
        .s1p-toast-notification {
            position: fixed;
            left: 50%;
            bottom: 20px;
            transform: translate(-50%, 50px);
            z-index: 10005;
            padding: 10px 18px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            color: var(--s1p-t); /* <-- 修改了此行 */
            background-color: var(--s1p-bg); /* <-- 修改了此行 */
            box-shadow: 0 4px 12px rgba(var(--s1p-black-rgb), 0.15);
            opacity: 0;
            transition: opacity 0.3s ease-out, transform 0.3s ease-out;
            pointer-events: none;
            white-space: nowrap;
            text-align: center;
            /* [新增] 为浅色背景增加边框以提高辨识度 */
            border: 1px solid var(--s1p-pri);
        }
        .s1p-modal-content .s1p-toast-notification {
            position: absolute;
            bottom: 15px;
        }
        .s1p-toast-notification.visible {
            opacity: 1;
            transform: translate(-50%, 0);
        }
        .s1p-toast-notification.success {
            background-color: #27da80;
            color: var(--s1p-white); /* 确保成功状态字体为白色 */
            border-color: #27da80;   /* 覆盖边框颜色 */
        }
        .s1p-toast-notification.error {
            background-color: var(--s1p-red);
            color: var(--s1p-white); /* 确保失败状态字体为白色 */
            border-color: var(--s1p-red);   /* 覆盖边框颜色 */
        }
        .s1p-toast-notification.error.visible {
            animation: s1p-toast-shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
        }

        /* --- 确认弹窗样式 --- */
        @keyframes s1p-fade-in { from { opacity: 0; } to { opacity: 1; } } @keyframes s1p-scale-in { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } } @keyframes s1p-fade-out { from { opacity: 1; } to { opacity: 0; } } @keyframes s1p-scale-out { from { transform: scale(1); opacity: 1; } to { transform: scale(0.97); opacity: 0; } }
        .s1p-confirm-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(var(--s1p-black-rgb), 0.65); display: flex; justify-content: center; align-items: center; z-index: 10000; animation: s1p-fade-in 0.2s ease-out; }
        .s1p-confirm-content { background-color: var(--s1p-bg); border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(var(--s1p-black-rgb), 0.1), 0 10px 10px -5px rgba(var(--s1p-black-rgb), 0.04); width: 480px; max-width: 90%; text-align: left; overflow: hidden; animation: s1p-scale-in 0.25s ease-out; }
        .s1p-confirm-body { padding: 20px 24px; font-size: 16px; line-height: 1.6; }
        .s1p-confirm-body .s1p-confirm-title { font-weight: 600; font-size: 18px; margin-bottom: 8px; }
        .s1p-confirm-body .s1p-confirm-subtitle { font-size: 14px; color: var(--s1p-desc-t); }
        .s1p-confirm-footer { padding: 12px 24px 20px; display: flex; justify-content: flex-end; gap: 12px; }
        .s1p-confirm-footer.s1p-centered { justify-content: center; }
        .s1p-confirm-btn { padding: 9px 14px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: all 0.15s ease-in-out; box-shadow: 0 1px 2px 0 rgba(var(--s1p-black-rgb), 0.05); white-space: nowrap; }
        .s1p-confirm-btn:active { transform: translateY(1px); }
        .s1p-confirm-btn.s1p-cancel { background-color: var(--s1p-sub); border-color: var(--s1p-pri); }
        .s1p-confirm-btn.s1p-cancel:hover { border-color: var(--s1p-red); background-color: var(--s1p-error-bg); }
        .s1p-confirm-btn.s1p-confirm { background-color: var(--s1p-red); color: var(--s1p-white); border-color: var(--s1p-red); }
        .s1p-confirm-btn.s1p-confirm:hover { background-color: var(--s1p-red-h); border-color: var(--s1p-red-h); }

        /* --- [MODIFIED] Collapsible Section (V7 - Mask Image Fix) --- */
        .s1p-collapsible-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            user-select: none;
        }
        .s1p-settings-group-title.s1p-collapsible-header {
            margin-bottom: 0;
            transition: color 0.2s ease;
        }
        .s1p-settings-group-title.s1p-collapsible-header:hover {
            color: var(--s1p-sec);
        }
        .s1p-expander-arrow {
            display: inline-block;
            width: 12px;
            height: 12px;
            /* [NEW METHOD] 使用 mask 定义图标形状 */
            -webkit-mask-image: url("${SVG_ICON_ARROW_MASK}");
            mask-image: url("${SVG_ICON_ARROW_MASK}");
            -webkit-mask-size: contain;
            mask-size: contain;
            -webkit-mask-repeat: no-repeat;
            mask-repeat: no-repeat;
            -webkit-mask-position: center;
            mask-position: center;
            /* [NEW METHOD] 使用 background-color 来上色 */
            background-color: var(--s1p-icon-arrow); /* 默认颜色 */
            /* [NEW METHOD] 为 background-color 和 transform 添加过渡效果 */
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s ease;
        }
        .s1p-settings-group-title.s1p-collapsible-header:hover .s1p-expander-arrow {
            background-color: var(--s1p-sec); /* 悬停颜色 */
        }
        .s1p-expander-arrow.expanded {
            transform: rotate(90deg);
        }
        .s1p-collapsible-content {
            display: grid;
            grid-template-rows: 0fr;
            padding-top: 0;
            transition: grid-template-rows 0.4s cubic-bezier(0.4, 0, 0.2, 1), padding-top 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .s1p-collapsible-content > div {
             overflow: hidden;
        }
        .s1p-collapsible-content.expanded {
            grid-template-rows: 1fr;
            padding-top: 12px;
        }

        /* --- Feature Content Animation --- */
        .s1p-feature-content {
            display: grid;
            grid-template-rows: 0fr;
            transition: grid-template-rows 0.6s ease-in-out, margin-top 0.6s ease-in-out;
            margin-top: 0;
        }
        .s1p-feature-content.expanded {
            grid-template-rows: 1fr;
            margin-top: 16px;
        }
        .s1p-feature-content > div {
            overflow: hidden;
            transition: opacity 0.5s ease-in-out;
        }
        .s1p-feature-content:not(.expanded) > div {
            opacity: 0;
            transition-duration: 0.25s;
        }
        .s1p-feature-content.expanded > div {
            opacity: 1;
            transition-delay: 0.15s;
        }

        /* --- 界面定制设置样式 --- */
        .s1p-settings-group { margin-bottom: 24px; }
        .s1p-settings-group-title { font-size: 16px; font-weight: 500; border-bottom: 1px solid var(--s1p-pri); padding-bottom: 16px; margin-bottom: 12px; }
        .s1p-settings-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
        .s1p-settings-item .s1p-input { width: auto; min-width: 200px; }
        .s1p-settings-label { font-size: 14px; }
        .s1p-settings-checkbox { /* Handled by .s1p-switch */ }
        .s1p-setting-desc { font-size: 12px; color: var(--s1p-desc-t); margin: -4px 0 8px 0; padding: 0; line-height: 1.5; }
        .s1p-editor-item { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 6px; border-radius: 4px; background: var(--s1p-bg); }
        .s1p-editor-item select { background: var(--s1p-bg);  width: 100%; border: 1px solid var(--s1p-pri); border-radius: 4px; padding: 6px 8px; font-size: 14px; box-sizing: border-box; }
        .s1p-editor-item-controls { display: flex; align-items: center; gap: 4px; }
        .s1p-editor-btn { padding: 4px; font-size: 18px; line-height: 1; cursor: pointer; border-radius: 4px; border:none; background: transparent; color: #9ca3af; }
        /* --- [修正] 使用 :not() 伪类来排除删除按钮，防止其悬浮样式被覆盖 --- */
        .s1p-editor-btn:not(.s1p-delete-button):hover { background: var(--s1p-secondary-bg); color: var(--s1p-secondary-text); }
        /* --- [新增] 为删除按钮定义统一的尺寸和边距 (骨架) --- */
        .s1p-editor-btn.s1p-delete-button {
            width: 26px;
            height: 26px;
            padding: 4px;
            box-sizing: border-box;
            font-size: 0;
        }
        /* --- [联动修改] 仅在未启用NUX兼容模式时，应用S1 Plus的背景图标 (皮肤) --- */
        body:not(.s1p-follow-nux-theme) .s1p-editor-btn.s1p-delete-button {
            background-image: url("${SVG_ICON_DELETE_DEFAULT}");
            background-repeat: no-repeat;
            background-position: center;
            background-size: 18px 18px;
            transition: all 0.2s ease;
        }
        body:not(.s1p-follow-nux-theme) .s1p-editor-btn.s1p-delete-button:hover {
            background-color: var(--s1p-red);
            background-image: url("${SVG_ICON_DELETE_HOVER}");
        }
        .s1p-drag-handle { font-size: 18pt; cursor: grab; }
        .s1p-editor-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
        .s1p-settings-action-btn { display: inline-block; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; border: none; }
        .s1p-settings-action-btn.s1p-primary { background-color: var(--s1p-sec); color: var(--s1p-white); }
        .s1p-settings-action-btn.s1p-primary:hover { background-color: var(--s1p-sec-h); }
        .s1p-settings-action-btn.s1p-secondary { background-color: var(--s1p-secondary-bg); color: var(--s1p-secondary-text); }
        .s1p-settings-action-btn.s1p-secondary:hover { background-color: var(--s1p-secondary-hover-bg); }

        /* --- 带图标的搜索框 --- */
        .s1p-search-input-wrapper {
            position: relative;
            display: flex;
            align-items: center;
            width: 100%;
        }
        .s1p-search-input-wrapper .s1p-input {
            padding-left: 34px;
            padding-right: 34px;
        }
        .s1p-search-input-wrapper svg.s1p-search-icon {
            position: absolute;
            left: 10px;
            top: 50%;
            transform: translateY(-50%);
            width: 16px;
            height: 16px;
            color: var(--s1p-icon-color);
            pointer-events: none;
            transition: color 0.2s ease-in-out;
        }
        .s1p-search-input-wrapper .s1p-input:focus + svg.s1p-search-icon {
            color: var(--s1p-sec);
        }

        /* --- 搜索框清空按钮 --- */
        .s1p-search-clear-btn {
            position: absolute;
            right: 10px;
            top: 50%;
            transform: translateY(-50%);
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: transparent;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            opacity: 1;
            transition: background-color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
            padding: 0;
        }
        .s1p-search-clear-btn.hidden {
            opacity: 0;
            pointer-events: none;
            transform: translateY(-50%) scale(0.8);
        }
        .s1p-search-clear-btn:hover {
            background-color: var(--s1p-pri);
        }
        .s1p-search-clear-btn svg {
            width: 12px;
            height: 12px;
            color: var(--s1p-icon-arrow);
        }

       /* --- 搜索关键词高亮 --- */
        mark.s1p-highlight {
            background-color: var(--s1p-pri);
            color: var(--s1p-t);
            font-weight: bold;
            padding: 1px 3px;
            border-radius: 3px;
            text-decoration: none;
        }

        /* --- Modern Toggle Switch --- */
        .s1p-switch { position: relative; display: inline-block; width: 40px; height: 22px; vertical-align: middle; flex-shrink: 0; }
        .s1p-switch input { opacity: 0; width: 0; height: 0; }
        .s1p-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--s1p-pri); transition: .3s; border-radius: 22px; }
        .s1p-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: var(--s1p-white); transition: .3s; border-radius: 50%; box-shadow: 0 1px 3px rgba(var(--s1p-black-rgb), 0.1); }
        input:checked + .s1p-slider { background-color: var(--s1p-sec); }
        input:checked + .s1p-slider:before { transform: translateX(18px); }

        /* --- Nav Editor Dragging --- */
        .s1p-editor-item.s1p-dragging { opacity: 0.5; }

        /* --- 用户标记设置面板专属样式 --- */
        .s1p-item-meta-id { font-family: monospace; background-color: var(--s1p-bg); padding: 1px 5px; border-radius: 4px; font-size: 11px; color: var(--s1p-t); }
        .s1p-item-content {
            margin-top: 10px; /* 增加上边距 */
            padding-top: 10px; /* 增加上内边距，文字与分割线间的空间 */
            border-top: 1px solid var(--s1p-pri); /* 添加分割线 */
            color: var(--s1p-t); /* 使用更醒目的主文本颜色 */
            font-size: 12px; /* 增大字体 */
            font-weight: bold;
            line-height: 1.6;
            white-space: pre-wrap;
            word-break: break-all;
        }
        #s1p-tab-bookmarks .s1p-item-content {
            background-color: transparent;
            border: none;
            border-bottom: 1px solid var(--s1p-pri);
            border-radius: 0;
            padding: 0 0 10px 0;
            margin-top: 0;
            margin-bottom: 10px;
        }
        .s1p-item-editor textarea { width: 100%; min-height: 60px; margin-top: 8px; }
        .s1p-item-actions { display: flex; align-self: flex-start; flex-shrink: 0; gap: 8px; margin-left: 16px; }
        .s1p-item-actions .s1p-btn.s1p-primary { background-color: #3b82f6; color: var(--s1p-white); }
        .s1p-item-actions .s1p-btn.s1p-primary:hover { background-color: #2563eb; }
        .s1p-item-actions .s1p-btn.s1p-danger { background-color: var(--s1p-red); color: var(--s1p-white); }
        .s1p-item-actions .s1p-btn.s1p-danger:hover { background-color: var(--s1p-red-h); border-color: var(--s1p-red-h);}

        /* --- 引用屏蔽占位符 --- */
        .s1p-quote-placeholder {
            background-color: var(--s1p-bg);
            border: 1px solid var(--s1p-pri);
            padding: 8px 12px;
            border-radius: 6px;
            margin: 10px 0;
            font-size: 13px;
            color: var(--s1p-desc-t);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        div.s1p-quote-placeholder span.s1p-quote-toggle {
            color: var(--s1p-t);
            font-weight: 500;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            transition: background-color 0.2s ease, color 0.2s ease;
        }
        div.s1p-quote-placeholder span.s1p-quote-toggle:hover {
            background-color: var(--s1p-sub);
            color: var(--s1p-t);
        }
        .s1p-quote-wrapper {
            overflow: hidden;
            transition: max-height 0.35s ease-in-out;
        }

        /* --- Image Hiding --- */
        .s1p-image-container {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 8px;
            margin: 8px 0;
        }
        .s1p-image-placeholder {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 6px;
            background-color: var(--s1p-sub);
            color: var(--s1p-t);
            border: 1px solid var(--s1p-pri);
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s ease;
        }
        .s1p-image-placeholder:hover {
            background-color: var(--s1p-sub-h);
            color: var(--s1p-sub-h-t);
            border-color: var(--s1p-sub-h);
        }
        .s1p-image-container.hidden > .zoom {
            display: none;
        }
        .s1p-image-toggle-all-container {
            margin-bottom: 10px;
        }
        .s1p-image-toggle-all-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 6px;
            background-color: var(--s1p-sub);
            color: var(--s1p-t);
            border: 1px solid var(--s1p-pri);
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s ease;
        }
        .s1p-image-toggle-all-btn:hover {
            background-color: var(--s1p-sub-h);
            color: var(--s1p-sub-h-t);
            border-color: var(--s1p-sub-h);
        }
        /* --- [新增 V9] 可禁用/启用的增强型悬浮控件 --- */
        /* --- 模式 B: 增强控件关闭 (默认状态) --- */
        /* 默认隐藏脚本创建的控件 */
        #s1p-controls-wrapper {
            display: none;
        }

        /* --- 模式 A: 增强控件开启 (当 body 有 s1p-enhanced-controls-active 时) --- */
        /* 1. 让脚本控件显示出来 */
        body.s1p-enhanced-controls-active #s1p-controls-wrapper {
            display: block;
        }
        /* 2. 同时，彻底隐藏原生控件 */
        body.s1p-enhanced-controls-active #scrolltop {
            display: none !important;
        }

        /* 3. 以下是脚本控件自身的样式 (与之前版本类似，但选择器更严谨) */
        #s1p-controls-wrapper {
            position: fixed;
            top: 50%;
            right: 0;
            transform: translateY(-50%);
            z-index: 9998;
        }
        #s1p-controls-handle {
            position: absolute;
            top: 50%;
            right: 0;
            transform: translateY(-50%);
            width: 20px;
            /* [修改] 将高度从 60px 调整为 40px */
            height: 40px;
            background-color: var(--s1p-bg);
            border: 1px solid var(--s1p-pri);
            border-right: none;
            border-radius: 10px 0 0 10px;
            box-shadow: -2px 2px 8px rgba(var(--s1p-black-rgb), 0.1);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.3s ease 0.1s;
        }
        #s1p-controls-handle::before {
            content: '';
            display: block;
            width: 4px;
            height: 16px;
            background-color: var(--s1p-icon-color);
            -webkit-mask-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 16' fill='currentColor'%3e%3ccircle cx='2' cy='2' r='1.5'/%3e%3ccircle cx='2' cy='8' r='1.5'/%3e%3ccircle cx='2' cy='14' r='1.5'/%3e%3c/svg%3e");
            mask-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 16' fill='currentColor'%3e%3ccircle cx='2' cy='2' r='1.5'/%3e%3ccircle cx='2' cy='8' r='1.5'/%3e%3ccircle cx='2' cy='14' r='1.5'/%3e%3c/svg%3e");
            -webkit-mask-size: contain;
            mask-size: contain;
            -webkit-mask-repeat: no-repeat;
            mask-repeat: no-repeat;
            -webkit-mask-position: center;
            mask-position: center;
        }
        #s1p-floating-controls {
            transform: translateX(100%);
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-left: 20px;
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, visibility 0.3s;
        }
        #s1p-controls-wrapper:hover #s1p-controls-handle {
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease;
        }
        #s1p-controls-wrapper:hover #s1p-floating-controls {
            transform: translateX(0);
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
        }
        #s1p-floating-controls a {
            display: flex;
            justify-content: center;
            align-items: center;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background-color: var(--s1p-bg);
            box-shadow: 0 2px 8px rgba(var(--s1p-black-rgb), 0.15);
            border: 1px solid var(--s1p-pri);
            transition: all 0.2s ease-in-out;
            padding: 0;
            box-sizing: border-box;
        }
        #s1p-floating-controls a:hover {
            background-color: var(--s1p-pri);
            transform: scale(1.1);
        }
        #s1p-floating-controls a svg {
            width: 24px;
            height: 24px;
            color: var(--s1p-t);
        }
        #s1p-floating-controls a.s1p-scroll-btn svg {
            width: 28px;
            height: 28px;
        }
        /* --- [更新] 回复收藏内容切换 V3 --- */
        .s1p-bookmark-preview, .s1p-bookmark-full {
            /* 保留换行和空格，确保纯文本格式正确显示 */
            white-space: pre-wrap;
            word-break: break-word;
        }
        .s1p-bookmark-full {
            display: none;
        }
        .s1p-bookmark-toggle {
            /* 保持为行内元素，自然跟在文字后方 */
            display: inline;
            margin-left: 4px; /* 与文字稍微隔开 */
            font-weight: 500;
            color: var(--s1p-t);
            cursor: pointer;
            text-decoration: none;
            font-size: 13px;
        }
        .s1p-bookmark-toggle:hover {
            color: var(--s1p-sec);
            text-decoration: underline;
        }
        @keyframes s1p-indicator-appear {
            0% { opacity: 0; transform: translateY(-50%) scale(0.8) rotate(0deg); }
            50% { opacity: 1; transform: translateY(-50%) scale(1.08) rotate(5deg); }
            70% { transform: translateY(-50%) scale(0.98) rotate(-3deg); }
            90% { transform: translateY(-50%) scale(1.02) rotate(1deg); }
            100% { opacity: 1; transform: translateY(-50%) scale(1) rotate(0deg); }
        }
        @keyframes s1p-indicator-disappear {
            from { opacity: 1; transform: translateY(-50%) scale(1); }
            to { opacity: 0; transform: translateY(-50%) scale(0.8); }
        }
        .s1p-read-indicator {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background-color: var(--s1p-readprogress-bg);
            color: var(--s1p-white);
            padding: 3px 8px 4px; /* <-- [修改] 使用非对称内边距修正视觉重心 */
            border-radius: 16px;
            font-size: 11px;
            font-weight: bold;
            user-select: none;
            white-space: nowrap;
            box-shadow: 0 0 4px rgba(13, 13, 13, 0.1);
            line-height: 1;
        }
        .s1p-read-indicator.s1p-anim-appear {
            animation: s1p-indicator-appear 0.5s cubic-bezier(0.5, 0, 0.1, 1) forwards;
        }
        .s1p-read-indicator.s1p-anim-disappear {
            animation: s1p-indicator-disappear 0.3s ease-out forwards;
        }
        .s1p-read-indicator-icon {
            width: 14px; /* <-- [核心修改] 减小图标宽度 */
            height: 14px; /* <-- [核心修改] 减小图标高度 */
            background-color: currentColor;
            mask-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3e%3cpath d='M2 3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V20.0066C22 20.5552 21.5447 21 21.0082 21H2.9918C2.44405 21 2 20.5551 2 20.0066V3.9934ZM11 5H4V19H11V5ZM13 5V19H20V5H13ZM14 7H19V9H14V7ZM14 10H19V12H14V10Z'%3e%3c/path%3e%3c/svg%3e");
            mask-size: contain;
            mask-repeat: no-repeat;
            mask-position: center;
            /* -- [新增] 针对Windows平台的垂直对齐微调 -- */
            position: relative;
            top: 1px;
        }
    `);

  // --- S1 NUX 兼容性检测 ---
  let isS1NuxEnabled = false;
  const detectS1Nux = () => {
    const archiverLink = document.querySelector('a[href*="archiver"]');
    if (archiverLink) {
      const style = window.getComputedStyle(archiverLink, "::before");
      if (style && style.content.includes("NUXISENABLED")) {
        console.log("S1 Plus: S1 NUX is enabled");
        isS1NuxEnabled = true;
      } else {
        console.log("S1 Plus: S1 NUX is not enabled");
      }
    }
  };

  let dynamicallyHiddenThreads = {};

  // [MODIFIED] 为远程推送增加防抖机制，并防止与初始同步冲突
  let remotePushTimeout;
  const debouncedTriggerRemoteSyncPush = () => {
    // [OPTIMIZATION] 如果初始同步正在进行，则跳过由数据变更触发的推送
    if (isInitialSyncInProgress) {
      console.log("S1 Plus: 初始同步进行中，已跳过本次自动推送请求。");
      return;
    }

    const settings = getSettings();
    // [MODIFIED] 增加对自动同步子开关的判断
    if (
      !settings.syncRemoteEnabled ||
      !settings.syncAutoEnabled ||
      !settings.syncRemoteGistId ||
      !settings.syncRemotePat
    ) {
      return;
    }
    clearTimeout(remotePushTimeout);
    // 延迟5秒推送，如果在5秒内有新的数据变动，则重新计时
    remotePushTimeout = setTimeout(() => {
      triggerRemoteSyncPush();
    }, 5000);
  };

  // [FIXED] 只有在数据实际变动时才更新时间戳并触发同步
  const updateLastModifiedTimestamp = () => {
    // [FIX] 如果初始同步正在进行，则阻止更新时间戳，以防因数据迁移导致错误的覆盖。
    if (isInitialSyncInProgress) {
      console.log(
        "S1 Plus: 同步进行中，已阻止本次 last_modified 时间戳更新，以防数据覆盖。"
      );
      return;
    }
    GM_setValue("s1p_last_modified", Date.now());
    debouncedTriggerRemoteSyncPush();
  };

  // [NEW] 更新上次同步时间的显示
  const updateLastSyncTimeDisplay = () => {
    const container = document.querySelector("#s1p-last-sync-time-container");
    if (!container) return;
    const lastSyncTs = GM_getValue("s1p_last_sync_timestamp", 0);
    if (lastSyncTs > 0) {
      container.textContent = `上次成功同步于: ${new Date(
        lastSyncTs
      ).toLocaleString("zh-CN", { hour12: false })}`;
    } else {
      container.textContent = "尚未进行过远程同步。";
    }
  };

  // --- 数据处理 & 核心功能 ---
  const getBlockedThreads = () => GM_getValue("s1p_blocked_threads", {});
  const saveBlockedThreads = (threads) => {
    GM_setValue("s1p_blocked_threads", threads);
    updateLastModifiedTimestamp();
  };
  const getBlockedUsers = () => GM_getValue("s1p_blocked_users", {});
  const saveBlockedUsers = (users) => {
    GM_setValue("s1p_blocked_users", users);
    updateLastModifiedTimestamp();
  };
  const saveUserTags = (tags) => {
    GM_setValue("s1p_user_tags", tags);
    updateLastModifiedTimestamp();
  };
  // [NEW] Bookmarked Replies data functions
  const getBookmarkedReplies = () => GM_getValue("s1p_bookmarked_replies", {});
  const saveBookmarkedReplies = (replies) => {
    GM_setValue("s1p_bookmarked_replies", replies);
    updateLastModifiedTimestamp();
  };

  // [MODIFIED] 升级并获取用户标记，自动迁移旧数据
  const getUserTags = () => {
    const tags = GM_getValue("s1p_user_tags", {});
    let needsMigration = false;
    const migratedTags = { ...tags };

    Object.keys(migratedTags).forEach((id) => {
      if (typeof migratedTags[id] === "string" || !migratedTags[id].timestamp) {
        needsMigration = true;
        const oldTag =
          typeof migratedTags[id] === "string"
            ? migratedTags[id]
            : migratedTags[id].tag;
        const oldName =
          migratedTags[id] && migratedTags[id].name
            ? migratedTags[id].name
            : `用户 #${id}`;
        migratedTags[id] = {
          name: oldName,
          tag: oldTag,
          timestamp:
            (migratedTags[id] && migratedTags[id].timestamp) || Date.now(),
        };
      }
    });

    if (needsMigration) {
      console.log("S1 Plus: 正在将用户标记迁移到新版数据结构...");
      saveUserTags(migratedTags);
      return migratedTags;
    }

    return tags;
  };

  const getTitleFilterRules = () => {
    const rules = GM_getValue("s1p_title_filter_rules", null);
    if (rules !== null) return rules;

    // --- 向下兼容：迁移旧的关键字数据 ---
    const oldKeywords = GM_getValue("s1p_title_keywords", null);
    if (Array.isArray(oldKeywords)) {
      const newRules = oldKeywords.map((k) => ({
        pattern: k,
        enabled: true,
        id: `rule_${Date.now()}_${Math.random()}`,
      }));
      saveTitleFilterRules(newRules);
      GM_setValue("s1p_title_keywords", null); // 清理旧数据
      return newRules;
    }
    return [];
  };
  const saveTitleFilterRules = (rules) => {
    GM_setValue("s1p_title_filter_rules", rules);
    updateLastModifiedTimestamp();
  };

  const blockThread = (id, title, reason = "manual") => {
    const b = getBlockedThreads();
    if (b[id]) return;
    b[id] = { title, timestamp: Date.now(), reason };
    saveBlockedThreads(b);
    hideThread(id);
  };
  const unblockThread = (id) => {
    const b = getBlockedThreads();
    delete b[id];
    saveBlockedThreads(b);
    showThread(id);
  };
  const hideThread = (id) => {
    (
      document.getElementById(`normalthread_${id}`) ||
      document.getElementById(`stickthread_${id}`)
    )?.setAttribute("style", "display: none !important");
  };
  const showThread = (id) => {
    (
      document.getElementById(`normalthread_${id}`) ||
      document.getElementById(`stickthread_${id}`)
    )?.removeAttribute("style");
  };
  const hideBlockedThreads = () =>
    Object.keys(getBlockedThreads()).forEach(hideThread);
  const blockUser = (id, name) => {
    const settings = getSettings();
    const b = getBlockedUsers();
    b[id] = {
      name,
      timestamp: Date.now(),
      blockThreads: settings.blockThreadsOnUserBlock,
    };
    saveBlockedUsers(b);
    hideUserPosts(id);
    hideBlockedUserQuotes();
    hideBlockedUserRatings();
    if (b[id].blockThreads) applyUserThreadBlocklist();
  };

  // [MODIFIED] 增加调用评分刷新函数
  const unblockUser = (id) => {
    const b = getBlockedUsers();
    delete b[id];
    saveBlockedUsers(b);
    showUserPosts(id);
    hideBlockedUserQuotes();
    hideBlockedUserRatings();
    unblockThreadsByUser(id);
  };

  // [FIX] 更精确地定位帖子作者，避免错误隐藏被评分的帖子
  const hideUserPosts = (id) => {
    document
      .querySelectorAll(`.authi a[href*="space-uid-${id}.html"]`)
      .forEach((l) =>
        l
          .closest("table.plhin")
          ?.setAttribute("style", "display: none !important")
      );
  };
  const showUserPosts = (id) => {
    document
      .querySelectorAll(`.authi a[href*="space-uid-${id}.html"]`)
      .forEach((l) => l.closest("table.plhin")?.removeAttribute("style"));
  };

  const hideBlockedUsersPosts = () =>
    Object.keys(getBlockedUsers()).forEach(hideUserPosts);

  const hideBlockedUserQuotes = () => {
    const settings = getSettings();
    const blockedUsers = getBlockedUsers();
    const blockedUserNames = Object.values(blockedUsers).map((u) => u.name);

    document.querySelectorAll("div.quote").forEach((quoteElement) => {
      const quoteAuthorElement = quoteElement.querySelector(
        'blockquote font[color="#999999"]'
      );
      if (!quoteAuthorElement) return;

      const text = quoteAuthorElement.textContent.trim();
      const match = text.match(/^(.*)\s发表于\s.*$/);
      if (!match || !match[1]) return;

      const authorName = match[1];
      const isBlocked =
        settings.enableUserBlocking && blockedUserNames.includes(authorName);

      const wrapper = quoteElement.parentElement.classList.contains(
        "s1p-quote-wrapper"
      )
        ? quoteElement.parentElement
        : null;

      if (isBlocked) {
        if (!wrapper) {
          const newWrapper = document.createElement("div");
          newWrapper.className = "s1p-quote-wrapper";
          quoteElement.parentNode.insertBefore(newWrapper, quoteElement);
          newWrapper.appendChild(quoteElement);
          newWrapper.style.maxHeight = "0";

          const newPlaceholder = document.createElement("div");
          newPlaceholder.className = "s1p-quote-placeholder";
          newPlaceholder.innerHTML = `<span>一条来自已屏蔽用户的引用已被隐藏。</span><span class="s1p-quote-toggle s1p-popover-btn">点击展开</span>`;
          newWrapper.parentNode.insertBefore(newPlaceholder, newWrapper);

          newPlaceholder
            .querySelector(".s1p-quote-toggle")
            .addEventListener("click", function () {
              const isCollapsed = newWrapper.style.maxHeight === "0px";
              if (isCollapsed) {
                const style = window.getComputedStyle(quoteElement);
                const marginTop = parseFloat(style.marginTop);
                const marginBottom = parseFloat(style.marginBottom);
                newWrapper.style.maxHeight =
                  quoteElement.offsetHeight + marginTop + marginBottom + "px";
                this.textContent = "点击折叠";
              } else {
                newWrapper.style.maxHeight = "0px";
                this.textContent = "点击展开";
              }
            });
        }
      } else {
        if (wrapper) {
          const placeholder = wrapper.previousElementSibling;
          if (
            placeholder &&
            placeholder.classList.contains("s1p-quote-placeholder")
          ) {
            placeholder.remove();
          }
          wrapper.parentNode.insertBefore(quoteElement, wrapper);
          wrapper.remove();
        }
      }
    });
  };

  // [MODIFIED] 函数现在可以同时处理隐藏和显示，是一个完整的“刷新”功能
  const hideBlockedUserRatings = () => {
    const settings = getSettings();
    const blockedUserIds = Object.keys(getBlockedUsers());
    document.querySelectorAll("tbody.ratl_l tr").forEach((row) => {
      const userLink = row.querySelector('a[href*="space-uid-"]');
      if (userLink) {
        const uidMatch = userLink.href.match(/space-uid-(\d+)/);
        if (uidMatch && uidMatch[1]) {
          const isBlocked =
            settings.enableUserBlocking && blockedUserIds.includes(uidMatch[1]);
          row.style.display = isBlocked ? "none" : "";
        }
      }
    });
  };

  const hideThreadsByTitleKeyword = () => {
    const rules = getTitleFilterRules().filter((r) => r.enabled && r.pattern);
    const newHiddenThreads = {};

    const regexes = rules
      .map((r) => {
        try {
          return { regex: new RegExp(r.pattern), pattern: r.pattern };
        } catch (e) {
          console.error(
            `S1 Plus: 屏蔽规则 "${r.pattern}" 不是一个有效的正则表达式，将被忽略。`,
            e
          );
          return null;
        }
      })
      .filter(Boolean);

    document
      .querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]')
      .forEach((row) => {
        const titleElement = row.querySelector("th a.s.xst");
        if (!titleElement) return;

        const title = titleElement.textContent.trim();
        const threadId = row.id.replace(/^(normalthread_|stickthread_)/, "");
        let isHidden = false;

        if (regexes.length > 0) {
          const matchingRule = regexes.find((r) => r.regex.test(title));
          if (matchingRule) {
            newHiddenThreads[threadId] = {
              title,
              pattern: matchingRule.pattern,
            };
            row.classList.add("s1p-hidden-by-keyword");
            isHidden = true;
          }
        }

        if (!isHidden) {
          row.classList.remove("s1p-hidden-by-keyword");
        }
      });
    dynamicallyHiddenThreads = newHiddenThreads;
  };

  const getReadProgress = () => GM_getValue("s1p_read_progress", {});
  const saveReadProgress = (progress) => {
    GM_setValue("s1p_read_progress", progress);
    updateLastModifiedTimestamp();
  };
  const updateThreadProgress = (threadId, postId, page, lastReadFloor) => {
    if (!postId || !page || !lastReadFloor) return;
    const progress = getReadProgress();
    progress[threadId] = {
      postId,
      page,
      timestamp: Date.now(),
      lastReadFloor: lastReadFloor,
    };
    saveReadProgress(progress);
  };

  const applyUserThreadBlocklist = () => {
    const blockedUsers = getBlockedUsers();
    const usersToBlockThreads = Object.keys(blockedUsers).filter(
      (uid) => blockedUsers[uid].blockThreads
    );
    if (usersToBlockThreads.length === 0) return;

    document
      .querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]')
      .forEach((row) => {
        const authorLink = row.querySelector(
          'td.by cite a[href*="space-uid-"]'
        );
        if (authorLink) {
          const uidMatch = authorLink.href.match(/space-uid-(\d+)\.html/);
          const authorId = uidMatch ? uidMatch[1] : null;
          if (authorId && usersToBlockThreads.includes(authorId)) {
            const threadId = row.id.replace(
              /^(normalthread_|stickthread_)/,
              ""
            );
            const titleElement = row.querySelector("th a.s.xst");
            if (threadId && titleElement) {
              blockThread(
                threadId,
                titleElement.textContent.trim(),
                `user_${authorId}`
              );
            }
          }
        }
      });
  };

  const unblockThreadsByUser = (userId) => {
    const allBlockedThreads = getBlockedThreads();
    const reason = `user_${userId}`;
    Object.keys(allBlockedThreads).forEach((threadId) => {
      if (allBlockedThreads[threadId].reason === reason) {
        unblockThread(threadId);
      }
    });
  };

  const updatePostImageButtonState = (postContainer) => {
    const toggleButton = postContainer.querySelector(
      ".s1p-image-toggle-all-btn"
    );
    if (!toggleButton) return;

    const totalImages = postContainer.querySelectorAll(
      ".s1p-image-container"
    ).length;
    if (totalImages <= 1) {
      const container = toggleButton.closest(".s1p-image-toggle-all-container");
      if (container) container.remove();
      return;
    }

    const hiddenImages = postContainer.querySelectorAll(
      ".s1p-image-container.hidden"
    ).length;

    if (hiddenImages > 0) {
      toggleButton.textContent = `显示本楼所有图片 (${hiddenImages}/${totalImages})`;
    } else {
      toggleButton.textContent = `隐藏本楼所有图片 (${totalImages}/${totalImages})`;
    }
  };

  const manageImageToggleAllButtons = () => {
    const settings = getSettings();

    // 如果没有开启“默认隐藏图片”，则移除所有切换按钮并直接返回
    if (!settings.hideImagesByDefault) {
      document
        .querySelectorAll(".s1p-image-toggle-all-container")
        .forEach((el) => el.remove());
      return;
    }

    document.querySelectorAll("table.plhin").forEach((postContainer) => {
      const imageContainers = postContainer.querySelectorAll(
        ".s1p-image-container"
      );
      const postContentArea = postContainer.querySelector("td.t_f");

      if (!postContentArea) return;

      let toggleButtonContainer = postContainer.querySelector(
        ".s1p-image-toggle-all-container"
      );

      if (imageContainers.length <= 1) {
        if (toggleButtonContainer) toggleButtonContainer.remove();
        return;
      }

      if (!toggleButtonContainer) {
        toggleButtonContainer = document.createElement("div");
        toggleButtonContainer.className = "s1p-image-toggle-all-container";

        const toggleButton = document.createElement("button");
        toggleButton.className = "s1p-image-toggle-all-btn";
        toggleButtonContainer.appendChild(toggleButton);

        toggleButton.addEventListener("click", (e) => {
          e.preventDefault();
          const imagesInPost = postContainer.querySelectorAll(
            ".s1p-image-container"
          );
          const shouldShowAll = postContainer.querySelector(
            ".s1p-image-container.hidden"
          );

          if (shouldShowAll) {
            imagesInPost.forEach((container) => {
              container.classList.remove("hidden");
              container.dataset.manualShow = "true";
            });
          } else {
            imagesInPost.forEach((container) => {
              container.classList.add("hidden");
              delete container.dataset.manualShow;
            });
          }
          updatePostImageButtonState(postContainer);
        });

        postContentArea.prepend(toggleButtonContainer);
      }

      updatePostImageButtonState(postContainer);
    });
  };

  // --- [新增] 修改“只看该作者”为“只看该用户”的函数 ---
  const renameAuthorLinks = () => {
    document
      .querySelectorAll('div.authi a[href*="authorid="]')
      .forEach((link) => {
        if (link.textContent.trim() === "只看该作者") {
          link.textContent = "只看该用户";
        }
      });
  };

  // [MODIFIED] 图片隐藏功能的核心逻辑 (支持实时切换)
  const applyImageHiding = () => {
    const settings = getSettings();

    // 如果功能未开启，则移除所有包装和占位符
    if (!settings.hideImagesByDefault) {
      document.querySelectorAll(".s1p-image-container").forEach((container) => {
        const originalElement =
          container.querySelector("img.zoom")?.closest("a") ||
          container.querySelector("img.zoom");
        if (originalElement) {
          container.parentNode.insertBefore(originalElement, container);
        }
        container.remove();
      });
      return;
    }

    // 步骤 1: 遍历所有帖子图片，确保它们都被容器包裹并绑定切换事件
    document.querySelectorAll("div.t_fsz img.zoom").forEach((img) => {
      if (img.closest(".s1p-image-container")) return; // 如果已被包裹，则跳过

      const targetElement = img.closest("a") || img;
      const container = document.createElement("div");
      container.className = "s1p-image-container";

      const placeholder = document.createElement("span");
      placeholder.className = "s1p-image-placeholder";
      // 初始文本不重要，会在步骤2中被正确设置
      placeholder.textContent = "图片处理中...";

      targetElement.parentNode.insertBefore(container, targetElement);
      container.appendChild(placeholder);
      container.appendChild(targetElement);

      placeholder.addEventListener("click", (e) => {
        e.preventDefault();
        const isHidden = container.classList.toggle("hidden");

        if (isHidden) {
          placeholder.textContent = "显示图片";
          delete container.dataset.manualShow;
        } else {
          placeholder.textContent = "隐藏图片";
          container.dataset.manualShow = "true";
        }

        const postContainer = container.closest("table.plhin");
        if (postContainer) {
          updatePostImageButtonState(postContainer);
        }
      });
    });

    // 步骤 2: 根据当前设置和图片状态，同步所有容器的 class 和占位符文本
    document.querySelectorAll(".s1p-image-container").forEach((container) => {
      const placeholder = container.querySelector(".s1p-image-placeholder");
      if (!placeholder) return;

      const shouldBeHidden =
        settings.hideImagesByDefault && container.dataset.manualShow !== "true";

      container.classList.toggle("hidden", shouldBeHidden);

      if (shouldBeHidden) {
        placeholder.textContent = "显示图片";
      } else {
        placeholder.textContent = "隐藏图片";
      }
    });
  };

  /**
   * 点击事件处理函数，用于在新标签页打开帖子。
   * @param {MouseEvent} e - 点击事件对象。
   */
  const threadLinkClickHandler = (e) => {
    const settings = getSettings();
    // 再次检查设置，确保功能开启
    if (settings.openThreadsInNewTab) {
      e.preventDefault();
      GM_openInTab(e.currentTarget.href, {
        active: !settings.openThreadsInBackground,
      });
    }
  };

  /**
   * 遍历帖子列表的所有标题链接，并根据用户设置应用或移除“新标签页打开”的行为。
   */
  const applyThreadLinkBehavior = () => {
    const settings = getSettings();
    document
      .querySelectorAll(
        'tbody[id^="normalthread_"] th a.s.xst, tbody[id^="stickthread_"] th a.s.xst'
      )
      .forEach((link) => {
        // 先移除旧的监听器，以防重复添加或在禁用功能时清理
        link.removeEventListener("click", threadLinkClickHandler);

        // 如果功能启用，则添加新的监听器
        if (settings.openThreadsInNewTab) {
          link.addEventListener("click", threadLinkClickHandler);
        }
      });
  };

  /**
   * 遍历帖子列表的所有页码链接，并根据用户设置应用或移除“新标签页打开”的行为。
   */
  const applyPageLinkBehavior = () => {
    const settings = getSettings();
    document
      .querySelectorAll(
        'tbody[id^="normalthread_"] span.tps a, tbody[id^="stickthread_"] span.tps a'
      )
      .forEach((link) => {
        // 移除旧的监听器和 onclick 属性
        link.removeEventListener("click", threadLinkClickHandler);
        link.removeAttribute("onclick");

        // 如果功能启用，则添加新的监听器
        if (settings.openThreadsInNewTab) {
          link.addEventListener("click", threadLinkClickHandler);
        }
      });
  };

  // [MODIFIED] 导出数据对象，采用新的嵌套结构并包含内容哈希
  const exportLocalDataObject = async () => {
    const lastUpdated = GM_getValue("s1p_last_modified", 0);
    const lastUpdatedFormatted = new Date(lastUpdated).toLocaleString("zh-CN", {
      hour12: false,
    });

    // --- [FIX] 从要同步的设置中排除 Gist ID 和 PAT ---
    const allSettings = getSettings();
    const { syncRemoteGistId, syncRemotePat, ...syncedSettings } = allSettings;
    // -----------------------------------------------------

    const data = {
      settings: syncedSettings, // 使用过滤后的设置对象
      threads: getBlockedThreads(),
      users: getBlockedUsers(),
      user_tags: getUserTags(),
      title_filter_rules: getTitleFilterRules(),
      read_progress: getReadProgress(),
      bookmarked_replies: getBookmarkedReplies(),
    };

    const contentHash = await calculateDataHash(data);

    return {
      version: 4.0, // 版本号升级
      lastUpdated,
      lastUpdatedFormatted,
      contentHash, // 新增内容哈希字段
      data, // 所有用户数据被封装在 data 对象中
    };
  };

  const exportLocalData = async () =>
    JSON.stringify(await exportLocalDataObject(), null, 2);

  // [MODIFIED] 导入数据，兼容新旧两种数据结构
  const importLocalData = (jsonStr) => {
    try {
      const imported = JSON.parse(jsonStr);
      if (typeof imported !== "object" || imported === null)
        throw new Error("无效数据格式");

      // --- 兼容性处理：判断是新结构还是旧结构 ---
      const dataToImport =
        imported.data && imported.version >= 4.0 ? imported.data : imported;

      let threadsImported = 0,
        usersImported = 0,
        progressImported = 0,
        rulesImported = 0,
        tagsImported = 0,
        bookmarksImported = 0;

      // [修正] 此辅助函数仅用于升级数据结构，不再执行合并操作。
      const upgradeDataStructure = (type, importedData) => {
        if (!importedData || typeof importedData !== "object") return {};
        Object.keys(importedData).forEach((id) => {
          const item = importedData[id];
          if (type === "users" && typeof item.blockThreads === "undefined")
            item.blockThreads = false;
          if (type === "threads" && typeof item.reason === "undefined")
            item.reason = "manual";
        });
        return importedData;
      };

      if (dataToImport.settings) {
        // --- [FIX] 导入设置时忽略 Gist ID 和 PAT，保留本地配置 ---
        const importedSettings = { ...dataToImport.settings };
        delete importedSettings.syncRemoteGistId;
        delete importedSettings.syncRemotePat;
        // 设置是扁平对象，合并是安全的，予以保留
        saveSettings({ ...getSettings(), ...importedSettings });
        // ----------------------------------------------------------
      }

      // [修正] 关键修复：不再与本地数据合并，直接使用导入的数据进行覆盖
      const threadsToSave = upgradeDataStructure(
        "threads",
        dataToImport.threads || {}
      );
      saveBlockedThreads(threadsToSave);
      threadsImported = Object.keys(threadsToSave).length;

      // [修正] 关键修复：不再与本地数据合并，直接使用导入的数据进行覆盖
      const usersToSave = upgradeDataStructure(
        "users",
        dataToImport.users || {}
      );
      saveBlockedUsers(usersToSave);
      usersImported = Object.keys(usersToSave).length;

      // [修正] 关键修复：不再与本地数据合并，直接使用导入的数据进行覆盖
      if (
        dataToImport.user_tags &&
        typeof dataToImport.user_tags === "object"
      ) {
        saveUserTags(dataToImport.user_tags);
        tagsImported = Object.keys(dataToImport.user_tags).length;
      }

      if (
        dataToImport.title_filter_rules &&
        Array.isArray(dataToImport.title_filter_rules)
      ) {
        // 数组直接替换，逻辑正确，无需修改
        saveTitleFilterRules(dataToImport.title_filter_rules);
        rulesImported = dataToImport.title_filter_rules.length;
      } else if (
        dataToImport.title_keywords &&
        Array.isArray(dataToImport.title_keywords)
      ) {
        // 向后兼容导入旧格式
        const newRules = dataToImport.title_keywords.map((k) => ({
          pattern: k,
          enabled: true,
          id: `rule_${Date.now()}_${Math.random()}`,
        }));
        saveTitleFilterRules(newRules);
        rulesImported = newRules.length;
      }

      // [修正] 关键修复：不再与本地数据合并，直接使用导入的数据进行覆盖
      if (dataToImport.read_progress) {
        saveReadProgress(dataToImport.read_progress);
        progressImported = Object.keys(dataToImport.read_progress).length;
      }

      // [修正] 关键修复：不再与本地数据合并，直接使用导入的数据进行覆盖
      if (dataToImport.bookmarked_replies) {
        saveBookmarkedReplies(dataToImport.bookmarked_replies);
        bookmarksImported = Object.keys(dataToImport.bookmarked_replies).length;
      }

      // [FIXED] 导入成功后，将本地时间戳与导入的时间戳同步
      GM_setValue("s1p_last_modified", imported.lastUpdated || 0);

      hideBlockedThreads();
      hideBlockedUsersPosts();
      applyUserThreadBlocklist();
      hideThreadsByTitleKeyword();
      initializeNavbar();
      applyInterfaceCustomizations();
      // 导入数据是一次大数据变更，直接触发一次推送
      triggerRemoteSyncPush();

      return {
        success: true,
        message: `成功导入 ${threadsImported} 条帖子、${usersImported} 条用户、${tagsImported} 条标记、${bookmarksImported} 条收藏、${rulesImported} 条标题规则、${progressImported} 条阅读进度及相关设置。`,
      };
    } catch (e) {
      return { success: false, message: `导入失败: ${e.message}` };
    }
  };

  const fetchRemoteData = () =>
    new Promise((resolve, reject) => {
      const { syncRemoteGistId, syncRemotePat } = getSettings();
      if (!syncRemoteGistId || !syncRemotePat) {
        return reject(new Error("配置不完整"));
      }
      const syncRemoteApiUrl = `https://api.github.com/gists/${syncRemoteGistId}`;

      GM_xmlhttpRequest({
        method: "GET",
        url: syncRemoteApiUrl,
        headers: {
          Authorization: `Bearer ${syncRemotePat}`,
          Accept: "application/vnd.github.v3+json",
        },
        onload: (response) => {
          if (response.status === 200) {
            try {
              const gistData = JSON.parse(response.responseText);
              const fileContent = gistData.files["s1plus_sync.json"]?.content;
              if (fileContent) {
                resolve(JSON.parse(fileContent));
              } else {
                // If file doesn't exist, it's not an error, just means it's the first sync.
                // Return an empty object so it can be populated.
                resolve({});
              }
            } catch (e) {
              reject(new Error(`解析Gist数据失败: ${e.message}`));
            }
          } else {
            reject(new Error(`GitHub API请求失败，状态码: ${response.status}`));
          }
        },
        onerror: () => {
          reject(new Error("网络请求失败。"));
        },
      });
    });

  const pushRemoteData = (dataObject) =>
    new Promise((resolve, reject) => {
      const { syncRemoteGistId, syncRemotePat } = getSettings();
      if (!syncRemoteGistId || !syncRemotePat) {
        return reject(new Error("配置不完整"));
      }
      const syncRemoteApiUrl = `https://api.github.com/gists/${syncRemoteGistId}`;

      const payload = {
        files: {
          "s1plus_sync.json": {
            content: JSON.stringify(dataObject, null, 2),
          },
        },
      };

      GM_xmlhttpRequest({
        method: "PATCH",
        url: syncRemoteApiUrl,
        headers: {
          Authorization: `Bearer ${syncRemotePat}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        data: JSON.stringify(payload),
        onload: (response) => {
          if (response.status === 200) {
            resolve({ success: true, message: "数据已成功推送到Gist。" });
          } else {
            reject(
              new Error(
                `Gist更新失败，状态码: ${response.status}, 响应: ${response.responseText}`
              )
            );
          }
        },
        onerror: () => {
          reject(new Error("网络请求失败。"));
        },
      });
    });

  // [MODIFIED] 触发式推送函数，现在是异步的
  const triggerRemoteSyncPush = () => {
    // 异步执行，不阻塞主流程
    (async () => {
      const settings = getSettings();
      if (
        !settings.syncRemoteEnabled ||
        !settings.syncAutoEnabled || // [修正] 确保自动同步子开关也开启
        !settings.syncRemoteGistId ||
        !settings.syncRemotePat
      ) {
        return;
      }

      console.log("S1 Plus: 检测到数据变更，触发后台智能同步检查...");

      // [核心修改] 不再是“盲目推送”，而是调用完整的智能同步引擎
      const result = await performAutoSync();

      // [新增] 根据智能同步的结果，决定是否需要用户交互
      switch (result.status) {
        case "conflict":
          // 如果检测到冲突，则调用与启动时同步完全相同的弹窗，让用户解决
          createAdvancedConfirmationModal(
            "检测到后台同步冲突",
            "<p>S1 Plus在后台自动同步时发现，您的本地数据和云端备份可能都已更改，为防止数据丢失，自动同步已暂停。</p><p>请手动选择要保留的版本来解决冲突。</p>",
            [
              {
                text: "稍后处理",
                className: "s1p-cancel",
                action: () => {
                  showMessage("同步已暂停，您可以在设置中手动同步。", null);
                },
              },
              {
                text: "立即解决",
                className: "s1p-confirm",
                action: () => {
                  handleManualSync(); // 调用功能最完善的手动同步流程
                },
              },
            ]
          );
          break;

        case "failure":
          // 如果同步失败，用一个无打扰的toast提示用户
          showMessage(`后台同步失败: ${result.error}`, false);
          break;

        case "success":
          if (result.action === "pulled") {
            // 如果后台自动拉取了数据，提示用户，因为页面内容可能已过期
            showMessage(
              "后台同步完成：云端有更新已被自动拉取。建议刷新页面。",
              true
            );
          }
          // 对于推送成功(pushed)或无需更改(no_change)的情况，控制台日志已足够，无需打扰用户
          break;
      }
    })();
  };

  /**
   * [新增] 迁移并校验远程数据
   * @param {object} remoteGistObject - 从 Gist 拉取的原始对象
   * @returns {Promise<object>} 返回一个包含 data, version, contentHash, lastUpdated 的规范化对象
   */
  const migrateAndValidateRemoteData = async (remoteGistObject) => {
    if (!remoteGistObject || typeof remoteGistObject !== "object") {
      throw new Error("远程数据为空或格式无效");
    }

    let data, version, contentHash, lastUpdated;

    // 场景1: 新版数据结构 (v4.0+)
    if (remoteGistObject.data && remoteGistObject.version >= 4.0) {
      data = remoteGistObject.data;
      version = remoteGistObject.version;
      contentHash = remoteGistObject.contentHash;
      lastUpdated = remoteGistObject.lastUpdated;

      // --- 核心校验逻辑 ---
      const calculatedHash = await calculateDataHash(data);
      if (calculatedHash !== contentHash) {
        throw new Error(
          "云端备份已损坏 (哈希校验失败)，同步已暂停以保护您的本地数据。"
        );
      }

      // 场景2: 旧版扁平数据结构 (需要迁移)
    } else {
      console.log("S1 Plus: 检测到旧版云端数据格式，将进行自动迁移。");
      version = remoteGistObject.version || 3.2; // 假设旧版版本
      lastUpdated = remoteGistObject.lastUpdated || 0;
      // 从顶层属性中提取数据
      data = {
        settings: remoteGistObject.settings || defaultSettings,
        threads: remoteGistObject.threads || {},
        users: remoteGistObject.users || {},
        user_tags: remoteGistObject.user_tags || {},
        title_filter_rules: remoteGistObject.title_filter_rules || [],
        read_progress: remoteGistObject.read_progress || {},
        bookmarked_replies: remoteGistObject.bookmarked_replies || {},
      };
      // 旧版数据没有哈希，我们计算一个用于后续比较
      contentHash = await calculateDataHash(data);
    }

    return { data, version, contentHash, lastUpdated, full: remoteGistObject };
  };

  // 自动同步控制器，集成哈希校验逻辑并返回操作结果
  const performAutoSync = async () => {
    const settings = getSettings();
    if (
      !settings.syncRemoteEnabled ||
      !settings.syncRemoteGistId ||
      !settings.syncRemotePat
    ) {
      return { status: "skipped", reason: "disabled" };
    }

    // [OPTIMIZATION] 开始同步前，设置标志位
    isInitialSyncInProgress = true;
    console.log("S1 Plus (Sync): 启动同步检查...");

    try {
      const rawRemoteData = await fetchRemoteData();
      if (Object.keys(rawRemoteData).length === 0) {
        // Gist为空，首次同步
        console.log(`S1 Plus (Sync): 远程为空，推送本地数据...`);
        const localData = await exportLocalDataObject();
        await pushRemoteData(localData);
        GM_setValue("s1p_last_sync_timestamp", Date.now());
        return { status: "success", action: "pushed_initial" };
      }

      // 1. 校验和迁移远程数据
      const remote = await migrateAndValidateRemoteData(rawRemoteData);
      const remoteTimestamp = remote.lastUpdated;
      const remoteHash = remote.contentHash;

      // 2. 计算本地哈希和时间戳
      const localDataObject = await exportLocalDataObject();
      const localTimestamp = localDataObject.lastUpdated;
      const localHash = localDataObject.contentHash;

      // 场景A: 完全一致
      if (remoteHash === localHash) {
        console.log(`S1 Plus (Sync): 本地与远程数据哈希一致，无需同步。`);
        return { status: "success", action: "no_change" };
      }

      // 哈希不一致，根据时间戳决策
      // 场景B: 远程有更新
      if (remoteTimestamp > localTimestamp) {
        console.log(`S1 Plus (Sync): 远程数据比本地新，正在后台应用...`);
        importLocalData(JSON.stringify(remote.full));
        GM_setValue("s1p_last_sync_timestamp", Date.now());
        return { status: "success", action: "pulled" };
        // 场景C: 本地有更新
      } else if (localTimestamp > remoteTimestamp) {
        console.log(`S1 Plus (Sync): 本地数据比远程新，正在后台推送...`);
        await pushRemoteData(localDataObject);
        GM_setValue("s1p_last_sync_timestamp", Date.now());
        return { status: "success", action: "pushed" };
        // 场景D: 冲突 (时间戳相同但哈希不同)
      } else {
        console.warn(
          `S1 Plus (Sync): 检测到同步冲突 (时间戳相同但内容不同)，自动同步已暂停。请手动同步以解决冲突。`
        );
        return {
          status: "conflict",
          reason: "timestamps match but hashes differ",
        };
      }
    } catch (error) {
      console.error("S1 Plus: 自动同步失败:", error);
      return { status: "failure", error: error.message };
    } finally {
      // [OPTIMIZATION] 无论成功或失败，最后都清除标志位，以允许后续正常的防抖同步
      isInitialSyncInProgress = false;
      console.log("S1 Plus (Sync): 同步检查完成。");
    }
  };

  // --- 设置管理 ---
  const defaultSettings = {
    enablePostBlocking: true,
    enableUserBlocking: true,
    enableUserTagging: true,
    enableReadProgress: true,
    showReadIndicator: true, // [新增] 阅读进度浮动标识开关
    enableBookmarkReplies: true,
    readingProgressCleanupDays: 0,
    openProgressInNewTab: true,
    openProgressInBackground: false,
    openThreadsInNewTab: false,
    openThreadsInBackground: false,
    enableNavCustomization: true,
    changeLogoLink: true,
    hideBlacklistTip: true,
    blockThreadsOnUserBlock: true,
    showBlockedByKeywordList: false,
    showManuallyBlockedList: false,
    hideImagesByDefault: false,
    followS1NuxTheme: true, // <-- [新增]
    enhanceFloatingControls: true,
    threadBlockHoverDelay: 1,
    customTitleSuffix: " - STAGE1ₛₜ",
    customNavLinks: [
      { name: "论坛", href: "forum.php" },
      { name: "归墟", href: "forum-157-1.html" },
      { name: "漫区", href: "forum-6-1.html" },
      { name: "游戏", href: "forum-4-1.html" },
      { name: "影视", href: "forum-48-1.html" },
      { name: "PC数码", href: "forum-51-1.html" },
      { name: "黑名单", href: "home.php?mod=space&do=friend&view=blacklist" },
    ],
    syncRemoteEnabled: false,
    syncDailyFirstLoad: true,
    syncAutoEnabled: true,
    syncDirectChoiceMode: false, // [新增] 手动同步高级模式开关
    syncRemoteGistId: "",
    syncRemotePat: "",
  };

  const getSettings = () => {
    const saved = GM_getValue("s1p_settings", {});
    // 如果用户已保存自定义导航，则保留，否则使用默认值
    if (saved.customNavLinks && Array.isArray(saved.customNavLinks)) {
      return {
        ...defaultSettings,
        ...saved,
        customNavLinks: saved.customNavLinks,
      };
    }
    return { ...defaultSettings, ...saved };
  };
  const saveSettings = (settings) => {
    GM_setValue("s1p_settings", settings);
    updateLastModifiedTimestamp();
  };

  // --- [新增] 主题覆写样式管理 ---
  let themeOverrideStyleElement = null;
  let deleteButtonOverrideStyleElement = null;
  const applyThemeOverrideStyle = () => {
    const THEME_OVERRIDE_CSS = `
            /* 适用于 Chrome, Edge 等 WebKit 内核浏览器 */
            html::-webkit-scrollbar-thumb {
                background-color: var(--s1p-scrollbar-thumb) !important;
            }
            html::-webkit-scrollbar-track {
                background-color: var(--s1p-bg) !important;
            }
            /* 适用于 Firefox 浏览器 */
            html {
                scrollbar-color: var(--s1p-scrollbar-thumb) var(--s1p-bg) !important;
            }
            /* 强制恢复 S1 Plus 开关的原始高亮颜色 */
            :root {
                --s1p-sec: var(--s1p-sec-classic) !important;
                --s1p-sub-h: var(--s1p-sub-h-classic) !important;
            }
        `;
    const settings = getSettings();
    // 当 "跟随S1Nux主题" 开启时，移除自定义样式
    if (settings.followS1NuxTheme) {
      if (
        themeOverrideStyleElement &&
        themeOverrideStyleElement.parentElement
      ) {
        themeOverrideStyleElement.remove();
        themeOverrideStyleElement = null;
      }
    } else {
      // 当 "跟随S1Nux主题" 关闭时，如果样式不存在则添加它
      if (
        !themeOverrideStyleElement ||
        !themeOverrideStyleElement.parentElement
      ) {
        themeOverrideStyleElement = GM_addStyle(THEME_OVERRIDE_CSS);
      }
    }
  };

  const applyDeleteButtonThemeStyle = () => {
    const OVERRIDE_CSS = `
            .s1p-editor-btn.s1p-delete-button {
                font-size: 0 !important;
                width: 26px !important;
                height: 26px !important;
                padding: 4px !important;
                box-sizing: border-box !important;
                background-image: url("${SVG_ICON_DELETE_DEFAULT}") !important;
                background-repeat: no-repeat !important;
                background-position: center !important;
                background-size: 18px 18px !important;
                background-color: transparent !important;
                mask: none !important;
                transition: all 0.2s ease;
            }
            .s1p-editor-btn.s1p-delete-button:hover {
                background-color: var(--s1p-red) !important;
                background-image: url("${SVG_ICON_DELETE_HOVER}") !important;
            }
        `;
    const settings = getSettings();

    // --- [联动修改] 全新逻辑 ---
    if (settings.followS1NuxTheme) {
      // 模式：跟随 NUX
      // 1. 给 body 添加标记类，让标准CSS失效
      document.body.classList.add("s1p-follow-nux-theme");
      // 2. 移除 !important 强制规则 (如果存在)，彻底让位给 S1 NUX
      if (
        deleteButtonOverrideStyleElement &&
        deleteButtonOverrideStyleElement.parentElement
      ) {
        deleteButtonOverrideStyleElement.remove();
        deleteButtonOverrideStyleElement = null;
      }
    } else {
      // 模式：S1 Plus 经典
      // 1. 从 body 移除标记类，让标准CSS可以先生效
      document.body.classList.remove("s1p-follow-nux-theme");
      // 2. 添加 !important 强制规则，确保能覆盖 S1 NUX
      if (!deleteButtonOverrideStyleElement) {
        deleteButtonOverrideStyleElement = GM_addStyle(OVERRIDE_CSS);
      }
    }
  };

  // --- 界面定制功能 ---
  const applyInterfaceCustomizations = () => {
    const settings = getSettings();
    if (settings.changeLogoLink)
      document.querySelector("#hd h2 a")?.setAttribute("href", "./forum.php");
    if (settings.hideBlacklistTip)
      document.getElementById("hiddenpoststip")?.remove();

    // 添加标题后缀修改
    if (settings.customTitleSuffix) {
      const titlePattern =
        /^(.+?)(?:论坛)?(?:\s*-\s*Stage1st)?\s*-\s*stage1\/s1\s+游戏动漫论坛$/;
      if (titlePattern.test(document.title)) {
        document.title =
          document.title.replace(titlePattern, "$1") +
          settings.customTitleSuffix;
      }
    }
  };

  /**
   * [NEW & EXTENDED V6 - SVG & ClassName Support] 创建一个更通用的行内动作菜单
   * @param {HTMLElement} anchorElement - 菜单定位的锚点元素
   * @param {Array<Object>} buttons - 按钮配置数组，例如 [{ label, title, action, className, callback }]
   * @param {Function} [onCloseCallback] - 菜单关闭时执行的回调函数
   */
  const createInlineActionMenu = (anchorElement, buttons, onCloseCallback) => {
    // 确保同一时间只有一个菜单
    document.querySelector(".s1p-inline-action-menu")?.remove();

    const menu = document.createElement("div");
    menu.className = "s1p-inline-action-menu";

    let isClosing = false;
    const closeMenu = () => {
      if (isClosing) return;
      isClosing = true;
      menu.classList.remove("visible");
      setTimeout(() => {
        if (menu.parentNode) menu.remove();
        if (onCloseCallback) onCloseCallback();
      }, 200);
    };

    buttons.forEach((btnConfig) => {
      const button = document.createElement("button");
      button.className = "s1p-action-btn";
      // [新增] 支持自定义 className
      if (btnConfig.className) {
        button.classList.add(...btnConfig.className.split(" "));
      }

      button.dataset.action = btnConfig.action;
      // [核心修正] 使用 innerHTML 替代 textContent 来渲染 SVG
      button.innerHTML = btnConfig.label;
      menu.appendChild(button);

      button.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btnConfig.callback) {
          btnConfig.callback();
        }
        closeMenu();
      });

      const popover = document.getElementById("s1p-generic-display-popover");
      if (popover && popover.s1p_api && btnConfig.title) {
        button.addEventListener("mouseover", (e) =>
          popover.s1p_api.show(e.currentTarget, btnConfig.title)
        );
        button.addEventListener("mouseout", () => popover.s1p_api.hide());
      }
    });

    document.body.appendChild(menu);

    // --- 定位与显示 ---
    const anchorRect = anchorElement.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    const top =
      anchorRect.top +
      window.scrollY +
      anchorRect.height / 2 -
      menuRect.height / 2;
    let left;

    const spaceOnRight = window.innerWidth - anchorRect.right;
    const requiredSpace = menuRect.width + 16;

    if (spaceOnRight >= requiredSpace) {
      left = anchorRect.right + window.scrollX + 8;
    } else {
      left = anchorRect.left + window.scrollX - menuRect.width - 8;
    }

    if (left < window.scrollX) {
      left = window.scrollX + 8;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    // --- 交互逻辑 ---
    let hideTimeout;
    const startHideTimer = () => {
      hideTimeout = setTimeout(closeMenu, 300);
    };
    const cancelHideTimer = () => {
      clearTimeout(hideTimeout);
    };

    anchorElement.addEventListener("mouseleave", startHideTimer);
    menu.addEventListener("mouseenter", cancelHideTimer);
    menu.addEventListener("mouseleave", startHideTimer);

    requestAnimationFrame(() => {
      menu.classList.add("visible");
    });

    return menu;
  };

  /**
   * [NEW] 强制推送处理器，用于手动将本地数据覆盖到云端。
   */
  const handleForcePush = async () => {
    const icon = document.querySelector("#s1p-nav-sync-btn svg");
    if (icon) icon.classList.add("s1p-syncing");
    showMessage("正在向云端推送数据...", null);
    try {
      const localData = await exportLocalDataObject();
      await pushRemoteData(localData);
      GM_setValue("s1p_last_sync_timestamp", Date.now());
      updateLastSyncTimeDisplay();
      showMessage("推送成功！已更新云端备份。", true);
    } catch (e) {
      showMessage(`推送失败: ${e.message}`, false);
    } finally {
      if (icon) {
        icon.classList.remove("s1p-syncing");
        setTimeout(() => (icon.style.transform = ""), 1200); // 重置 transform
      }
    }
  };

  /**
   * [NEW] 强制拉取处理器，用于手动将云端数据覆盖到本地。
   */
  const handleForcePull = async () => {
    const icon = document.querySelector("#s1p-nav-sync-btn svg");
    if (icon) icon.classList.add("s1p-syncing");
    showMessage("正在从云端拉取数据...", null);
    try {
      const remoteData = await fetchRemoteData();
      if (Object.keys(remoteData).length === 0) {
        throw new Error("云端没有数据，无法拉取。");
      }
      const validatedRemote = await migrateAndValidateRemoteData(remoteData);
      const result = importLocalData(JSON.stringify(validatedRemote.full));
      if (result.success) {
        GM_setValue("s1p_last_sync_timestamp", Date.now());
        updateLastSyncTimeDisplay();
        showMessage("拉取成功！页面即将刷新以应用新数据。", true);
        setTimeout(() => location.reload(), 1500);
      } else {
        throw new Error(result.message);
      }
    } catch (e) {
      showMessage(`拉取失败: ${e.message}`, false);
    } finally {
      if (icon) {
        icon.classList.remove("s1p-syncing");
        setTimeout(() => (icon.style.transform = ""), 1200); // 重置 transform
      }
    }
  };

  const updateNavbarSyncButton = () => {
    const settings = getSettings();
    const existingBtnLi = document.getElementById("s1p-nav-sync-btn");
    const managerLink = document.getElementById("s1p-nav-link");

    if (!settings.syncRemoteEnabled) {
      if (existingBtnLi) existingBtnLi.remove();
      return;
    }

    if (existingBtnLi || !managerLink) return;

    const li = document.createElement("li");
    li.id = "s1p-nav-sync-btn";
    const a = document.createElement("a");
    a.href = "javascript:void(0);";
    // --- [核心修正] 恢复为原始的、基于“填充(fill)”的实心图标定义 ---
    a.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4C9.25144 4 6.82508 5.38626 5.38443 7.5H8V9.5H2V3.5H4V5.99936C5.82381 3.57166 8.72764 2 12 2C17.5228 2 22 6.47715 22 12H20C20 7.58172 16.4183 4 12 4ZM4 12C4 16.4183 7.58172 20 12 20C14.7486 20 17.1749 18.6137 18.6156 16.5H16V14.5H22V20.5H20V18.0006C18.1762 20.4283 15.2724 22 12 22C6.47715 22 2 17.5228 2 12H4Z"></path></svg>`;
    li.appendChild(a);

    if (settings.syncDirectChoiceMode) {
      // --- 模式2: 高级模式 (调用新的内联动作菜单) ---
      a.style.cursor = "default";
      let activeMenu = null;

      const pullIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 14.5C1 12.1716 2.22429 10.1291 4.06426 8.9812C4.56469 5.044 7.92686 2 12 2C16.0731 2 19.4353 5.044 19.9357 8.9812C21.7757 10.1291 23 12.1716 23 14.5C23 17.9216 20.3562 20.7257 17 20.9811L7 21C3.64378 20.7257 1 17.9216 1 14.5ZM16.8483 18.9868C19.1817 18.8093 21 16.8561 21 14.5C21 12.927 20.1884 11.4962 18.8771 10.6781L18.0714 10.1754L17.9517 9.23338C17.5735 6.25803 15.0288 4 12 4C8.97116 4 6.42647 6.25803 6.0483 9.23338L5.92856 10.1754L5.12288 10.6781C3.81156 11.4962 3 12.927 3 14.5C3 16.8561 4.81833 18.8093 7.1517 18.9868L7.325 19H16.675L16.8483 18.9868ZM13 12H16L12 17L8 12H11V8H13V12Z"></path></svg>`;
      const pushIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 14.5C1 12.1716 2.22429 10.1291 4.06426 8.9812C4.56469 5.044 7.92686 2 12 2C16.0731 2 19.4353 5.044 19.9357 8.9812C21.7757 10.1291 23 12.1716 23 14.5C23 17.9216 20.3562 20.7257 17 20.9811L7 21C3.64378 20.7257 1 17.9216 1 14.5ZM16.8483 18.9868C19.1817 18.8093 21 16.8561 21 14.5C21 12.927 20.1884 11.4962 18.8771 10.6781L18.0714 10.1754L17.9517 9.23338C17.5735 6.25803 15.0288 4 12 4C8.97116 4 6.42647 6.25803 6.0483 9.23338L5.92856 10.1754L5.12288 10.6781C3.81156 11.4962 3 12.927 3 14.5C3 16.8561 4.81833 18.8093 7.1517 18.9868L7.325 19H16.675L16.8483 18.9868ZM13 13V17H11V13H8L12 8L16 13H13Z"></path></svg>`;

      li.addEventListener("mouseenter", () => {
        const existingMenu = document.querySelector(".s1p-inline-action-menu");
        if (existingMenu) {
          existingMenu.dispatchEvent(new MouseEvent("mouseenter"));
        } else {
          activeMenu = createInlineActionMenu(
            li,
            [
              {
                label: `${pullIconSVG} <span>拉取</span>`,
                action: "pull",
                title:
                  "用云端备份覆盖您当前的本地数据，本地未同步的修改将丢失！",
                callback: handleForcePull,
              },
              {
                label: `${pushIconSVG} <span>推送</span>`,
                action: "push",
                title: "将您当前的本地数据覆盖到云端备份，此操作不可逆。",
                callback: handleForcePush,
              },
            ],
            () => {
              activeMenu = null;
            }
          );
        }
      });
    } else {
      // --- 模式1: 默认模式 (点击后智能判断) ---
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        const icon = a.querySelector("svg");
        if (!icon || icon.classList.contains("s1p-syncing")) return;

        icon.classList.remove("s1p-sync-success", "s1p-sync-error");
        icon.classList.add("s1p-syncing");

        let success = false;
        try {
          success = await handleManualSync();
          icon.classList.remove("s1p-syncing");
          if (success !== null) {
            icon.classList.add(success ? "s1p-sync-success" : "s1p-sync-error");
          }
        } catch (error) {
          icon.classList.remove("s1p-syncing");
          console.error("S1 Plus: Manual sync handler threw an error:", error);
        } finally {
          setTimeout(() => {
            icon.classList.remove("s1p-sync-success", "s1p-sync-error");
            icon.style.transform = "";
          }, 1200);
        }
      });

      a.addEventListener("mouseover", (e) => {
        const popover = document.getElementById("s1p-generic-display-popover");
        if (popover && popover.s1p_api) {
          popover.s1p_api.show(e.currentTarget, "手动同步数据 (智能判断)");
        }
      });
      a.addEventListener("mouseout", () => {
        const popover = document.getElementById("s1p-generic-display-popover");
        if (popover && popover.s1p_api) {
          popover.s1p_api.hide();
        }
      });
    }

    managerLink.insertAdjacentElement("afterend", li);
  };

  const initializeNavbar = () => {
    const settings = getSettings();
    const navUl = document.querySelector("#nv > ul");
    if (!navUl) return;

    const createManagerLink = () => {
      const li = document.createElement("li");
      li.id = "s1p-nav-link";
      const a = document.createElement("a");
      a.href = "javascript:void(0);";
      a.textContent = "S1 Plus 设置";
      a.addEventListener("click", createManagementModal);
      li.appendChild(a);
      return li;
    };

    document.getElementById("s1p-nav-link")?.remove();
    document.getElementById("s1p-nav-sync-btn")?.remove();

    if (settings.enableNavCustomization) {
      navUl.innerHTML = "";
      (settings.customNavLinks || []).forEach((link) => {
        if (!link.name || !link.href) return;
        const li = document.createElement("li");
        if (window.location.href.includes(link.href)) li.className = "a";
        const a = document.createElement("a");
        a.href = link.href;
        a.textContent = link.name;
        a.setAttribute("hidefocus", "true");
        li.appendChild(a);
        navUl.appendChild(li);
      });
    }
    navUl.appendChild(createManagerLink());
    updateNavbarSyncButton();
  };

  // --- [NEW] Helper function for search component
  /**
   * Escapes special characters in a string for use in a regular expression.
   * @param {string} str The string to escape.
   * @returns {string} The escaped string.
   */
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Recursively finds and highlights text in a DOM node without breaking HTML.
   * @param {Node} node The starting DOM node.
   * @param {RegExp} regex The regex to match text with.
   */
  function highlightTextInNode(node, regex) {
    if (node.nodeType === 3) {
      // Text node
      const text = node.textContent;
      const matches = [...text.matchAll(regex)];
      if (matches.length > 0) {
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        matches.forEach((match) => {
          if (match.index > lastIndex) {
            fragment.appendChild(
              document.createTextNode(text.substring(lastIndex, match.index))
            );
          }
          const mark = document.createElement("mark");
          mark.className = "s1p-highlight";
          mark.textContent = match[0];
          fragment.appendChild(mark);
          lastIndex = match.index + match[0].length;
        });
        if (lastIndex < text.length) {
          fragment.appendChild(
            document.createTextNode(text.substring(lastIndex))
          );
        }
        node.parentNode.replaceChild(fragment, node);
      }
    } else if (
      node.nodeType === 1 &&
      node.childNodes &&
      !/^(script|style)$/i.test(node.tagName)
    ) {
      // Element node
      const children = Array.from(node.childNodes);
      for (const child of children) {
        highlightTextInNode(child, regex);
      }
    }
  }

  // [REPLACED] Bookmark search component with safe highlighting
  /**
   * Sets up the interactive search functionality for the bookmarks tab.
   * @param {HTMLElement} bookmarksTabElement The container element for the bookmarks tab.
   */
  function setupBookmarkSearchComponent(bookmarksTabElement) {
    const searchInput = bookmarksTabElement.querySelector(
      "#s1p-bookmark-search-input"
    );
    const clearButton = bookmarksTabElement.querySelector(
      "#s1p-bookmark-search-clear-btn"
    );
    const list = bookmarksTabElement.querySelector("#s1p-bookmarks-list");
    const noResultsMessage = bookmarksTabElement.querySelector(
      "#s1p-bookmarks-no-results"
    );
    const emptyMessage = bookmarksTabElement.querySelector(
      "#s1p-bookmarks-empty-message"
    );

    if (!searchInput || !list || !clearButton || !noResultsMessage) return;

    const allItems = Array.from(list.querySelectorAll(".s1p-item"));
    const itemCache = allItems.map((item) => {
      const contentEl = item.querySelector(".s1p-item-content");
      const metaEl = item.querySelector(".s1p-item-meta");

      // Store original HTML if not already stored
      if (!contentEl.dataset.originalHtml) {
        contentEl.dataset.originalHtml = contentEl.innerHTML;
      }
      if (!metaEl.dataset.originalHtml) {
        metaEl.dataset.originalHtml = metaEl.innerHTML;
      }

      return {
        element: item,
        searchableText: (
          contentEl.textContent +
          " " +
          metaEl.textContent
        ).toLowerCase(),
        contentEl: contentEl,
        metaEl: metaEl,
      };
    });

    const performSearch = () => {
      const query = searchInput.value.toLowerCase().trim();
      clearButton.classList.toggle("hidden", query.length === 0);

      const keywords = query.split(/\s+/).filter((k) => k);
      let visibleCount = 0;

      const highlightRegex =
        keywords.length > 0
          ? new RegExp(keywords.map(escapeRegExp).join("|"), "gi")
          : null;

      for (const item of itemCache) {
        const isVisible =
          keywords.length === 0 ||
          keywords.every((keyword) => item.searchableText.includes(keyword));

        // Reset highlights first by restoring original HTML
        item.contentEl.innerHTML = item.contentEl.dataset.originalHtml;
        item.metaEl.innerHTML = item.metaEl.dataset.originalHtml;
        item.element.style.display = isVisible ? "flex" : "none";

        if (isVisible) {
          visibleCount++;
          if (highlightRegex) {
            // Apply new, safe highlighting that only targets text nodes
            highlightTextInNode(item.contentEl, highlightRegex);
            highlightTextInNode(item.metaEl, highlightRegex);
          }
        }
      }

      const hasAnyItems = allItems.length > 0;
      list.style.display = hasAnyItems ? "flex" : "none";
      emptyMessage.style.display = !hasAnyItems ? "block" : "none";
      noResultsMessage.style.display =
        hasAnyItems && visibleCount === 0 && query.length > 0
          ? "block"
          : "none";
    };

    searchInput.addEventListener("input", performSearch);

    clearButton.addEventListener("click", () => {
      searchInput.value = "";
      performSearch();
      searchInput.focus();
    });

    clearButton.classList.toggle("hidden", searchInput.value.length === 0);
  }

  // --- UI 创建 ---
  const formatDate = (timestamp) => new Date(timestamp).toLocaleString("zh-CN");

  let currentToast = null; // 用一个全局变量来管理当前的提示框实例

  /**
   * [MODIFIED] 显示消息，支持 true(成功)/false(失败)/null(中立) 三种状态
   * @param {string} message - 要显示的消息内容。
   * @param {boolean|null} isSuccess - 消息状态。
   */
  const showMessage = (message, isSuccess) => {
    // 如果上一个提示框还存在，立即移除，防止重叠
    if (currentToast) {
      currentToast.remove();
    }

    const toast = document.createElement("div");
    toast.textContent = message;

    // --- [核心修正] ---
    // 使用更完善的逻辑来处理三种状态
    let toastClass = "s1p-toast-notification";
    if (isSuccess === true) {
      toastClass += " success";
    } else if (isSuccess === false) {
      toastClass += " error";
    }
    // 如果 isSuccess 是 null 或 undefined，则不添加额外 class，显示默认的黑灰色样式
    toast.className = toastClass;
    // --- [修正结束] ---

    const modalContent = document.querySelector(".s1p-modal-content");
    if (modalContent) {
      modalContent.appendChild(toast);
    } else {
      document.body.appendChild(toast);
    }
    currentToast = toast;

    // 让动画生效
    setTimeout(() => {
      toast.classList.add("visible");
    }, 50);

    // 3秒后自动消失
    setTimeout(() => {
      toast.classList.remove("visible");
      toast.addEventListener(
        "transitionend",
        () => {
          if (toast.parentNode) {
            toast.remove();
          }
          if (currentToast === toast) {
            currentToast = null;
          }
        },
        { once: true }
      );
    }, 3000);
  };

  const createConfirmationModal = (
    title,
    subtitle,
    onConfirm,
    confirmText = "确定"
  ) => {
    document.querySelector(".s1p-confirm-modal")?.remove();
    const modal = document.createElement("div");
    modal.className = "s1p-confirm-modal";
    modal.innerHTML = `<div class="s1p-confirm-content"><div class="s1p-confirm-body"><div class="s1p-confirm-title">${title}</div><div class="s1p-confirm-subtitle">${subtitle}</div></div><div class="s1p-confirm-footer"><button class="s1p-confirm-btn s1p-cancel">取消</button><button class="s1p-confirm-btn s1p-confirm">${confirmText}</button></div></div>`;
    const closeModal = () => {
      modal.querySelector(".s1p-confirm-content").style.animation =
        "s1p-scale-out 0.25s ease-out forwards";
      modal.style.animation = "s1p-fade-out 0.25s ease-out forwards";
      setTimeout(() => modal.remove(), 250);
    };
    modal.querySelector(".s1p-confirm").addEventListener("click", () => {
      onConfirm();
      closeModal();
    });
    modal.querySelector(".s1p-cancel").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.body.appendChild(modal);
  };

  /**
   * [MODIFIED] 创建一个行内确认菜单 (V2: 带智能定位和动画)
   * @param {HTMLElement} anchorElement - 菜单定位的锚点元素
   * @param {string} confirmText - 确认提示文本
   * @param {Function} onConfirm - 点击确认后执行的回调函数
   */
  const createInlineConfirmMenu = (anchorElement, confirmText, onConfirm) => {
    document.querySelector(".s1p-inline-confirm-menu")?.remove();

    const menu = document.createElement("div");
    menu.className = "s1p-options-menu s1p-inline-confirm-menu";
    menu.style.width = "max-content";

    menu.innerHTML = `
            <div class="s1p-direct-confirm">
                <span>${confirmText}</span>
                <span class="s1p-confirm-separator"></span>
                <button class="s1p-confirm-action-btn s1p-cancel" title="取消"></button>
                <button class="s1p-confirm-action-btn s1p-confirm" title="确认"></button>
            </div>
        `;

    document.body.appendChild(menu);
    const anchorRect = anchorElement.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    const top =
      anchorRect.top +
      window.scrollY +
      anchorRect.height / 2 -
      menuRect.height / 2;
    let left;

    const spaceOnRight = window.innerWidth - anchorRect.right;
    const requiredSpace = menuRect.width + 16;

    if (spaceOnRight >= requiredSpace) {
      left = anchorRect.right + window.scrollX + 8;
    } else {
      left = anchorRect.left + window.scrollX - menuRect.width - 8;
    }

    if (left < window.scrollX) {
      left = window.scrollX + 8;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    let isClosing = false;
    const closeMenu = () => {
      if (isClosing) return;
      isClosing = true;
      document.removeEventListener("click", closeMenu);
      menu.classList.remove("visible");

      setTimeout(() => {
        if (menu.parentNode) {
          menu.remove();
        }
      }, 200);
    };

    menu.querySelector(".s1p-confirm").addEventListener("click", (e) => {
      e.stopPropagation();
      onConfirm();
      closeMenu();
    });

    menu.querySelector(".s1p-cancel").addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
    });

    requestAnimationFrame(() => {
      menu.classList.add("visible");
    });

    setTimeout(() => {
      document.addEventListener("click", closeMenu, { once: true });
    }, 0);
  };

  const removeProgressJumpButtons = () =>
    document
      .querySelectorAll(".s1p-progress-container")
      .forEach((el) => el.remove());
  const removeBlockButtonsFromThreads = () =>
    document.querySelectorAll(".s1p-options-cell").forEach((el) => el.remove());

  const refreshUserPostsOnPage = (userId) => {
    if (!userId) return;
    document
      .querySelectorAll(`.authi a[href*="space-uid-${userId}"]`)
      .forEach((userLink) => {
        const postTable = userLink.closest('table[id^="pid"]');
        if (postTable) {
          const postId = postTable.id.replace("pid", "");
          refreshSinglePostActions(postId);
        }
      });
  };
  // [最终版] 用于移动Tabs滑块的辅助函数
  const moveTabSlider = (tabContainer) => {
    if (!tabContainer) return;
    const slider = tabContainer.querySelector(".s1p-tab-slider");
    const activeTab = tabContainer.querySelector(".s1p-tab-btn.active");
    if (slider && activeTab) {
      const newWidth = activeTab.offsetWidth;
      const newLeft = activeTab.offsetLeft;

      // 使用 requestAnimationFrame 来确保动画在下一帧渲染，从而稳定触发
      requestAnimationFrame(() => {
        slider.style.width = `${newWidth}px`;
        // [核心修改] 使用 transform 进行位移，而不是 left
        slider.style.transform = `translateX(${newLeft}px)`;
      });
    }
  };
  const createManagementModal = () => {
    // ... (此处省略 calculateModalWidth 内部代码，与原文件一致) ...
    const calculateModalWidth = () => {
      const measureContainer = document.createElement("div");
      measureContainer.style.cssText =
        "position: absolute; left: -9999px; top: -9999px; visibility: hidden; pointer-events: none;";

      const tabsDiv = document.createElement("div");
      tabsDiv.className = "s1p-tabs";
      tabsDiv.style.display = "inline-flex";
      tabsDiv.innerHTML = `
                <button class="s1p-tab-btn">通用设置</button>
                <button class="s1p-tab-btn">帖子屏蔽</button>
                <button class="s1p-tab-btn">用户屏蔽</button>
                <button class="s1p-tab-btn">用户标记</button>
                <button class="s1p-tab-btn">回复收藏</button>
                <button class="s1p-tab-btn">导航栏定制</button>
                <button class="s1p-tab-btn">设置同步</button>
            `;
      measureContainer.appendChild(tabsDiv);
      document.body.appendChild(measureContainer);

      let totalTabsWidth = 0;
      tabsDiv.querySelectorAll(".s1p-tab-btn").forEach((btn) => {
        const style = window.getComputedStyle(btn);
        totalTabsWidth +=
          btn.offsetWidth +
          parseFloat(style.marginLeft) +
          parseFloat(style.marginRight);
      });
      document.body.removeChild(measureContainer);

      return totalTabsWidth + 32; // 32px for padding
    };
    const requiredWidth = calculateModalWidth();
    document.querySelector(".s1p-modal")?.remove();

    const modal = document.createElement("div");
    modal.className = "s1p-modal";
    modal.style.opacity = "0";
    modal.innerHTML = `<div class="s1p-modal-content">
            <div class="s1p-modal-header"><div class="s1p-modal-title">S1 Plus 设置</div><div class="s1p-modal-close"></div></div>
            <div class="s1p-modal-body">
                <div class="s1p-tabs-wrapper">
                    <div class="s1p-tabs">
                        <div class="s1p-tab-slider"></div>
                        <button class="s1p-tab-btn active" data-tab="general-settings">通用设置</button>
                        <button class="s1p-tab-btn" data-tab="threads">帖子屏蔽</button>
                        <button class="s1p-tab-btn" data-tab="users">用户屏蔽</button>
                        <button class="s1p-tab-btn" data-tab="tags">用户标记</button>
                        <button class="s1p-tab-btn" data-tab="bookmarks">回复收藏</button>
                        <button class="s1p-tab-btn" data-tab="nav-settings">导航栏定制</button>
                        <button class="s1p-tab-btn" data-tab="sync">设置同步</button>
                    </div>
                </div>
                <div id="s1p-tab-general-settings" class="s1p-tab-content active"></div>
                <div id="s1p-tab-threads" class="s1p-tab-content"></div>
                <div id="s1p-tab-users" class="s1p-tab-content"></div>
                <div id="s1p-tab-tags" class="s1p-tab-content"></div>
                <div id="s1p-tab-bookmarks" class="s1p-tab-content"></div>
                <div id="s1p-tab-nav-settings" class="s1p-tab-content"></div>
                <div id="s1p-tab-sync" class="s1p-tab-content">
                    <div class="s1p-settings-group">
                        <div class="s1p-settings-group-title">本地备份与恢复</div>
                        <div class="s1p-local-sync-desc">通过手动复制/粘贴数据，在不同浏览器或设备间迁移或备份你的所有S1 Plus配置，包括屏蔽列表、导航栏、阅读进度和各项开关设置。</div>
                        <div class="s1p-local-sync-buttons">
                            <button id="s1p-local-export-btn" class="s1p-btn">导出数据</button>
                            <button id="s1p-local-import-btn" class="s1p-btn">导入数据</button>
                        </div>
                        <textarea id="s1p-local-sync-textarea" class="s1p-input s1p-textarea s1p-sync-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据" autocomplete="off"></textarea>
                    </div>

                    <div class="s1p-settings-group">
                        <div class="s1p-settings-group-title">远程同步 (通过GitHub Gist)</div>
                        <div id="s1p-last-sync-time-container" class="s1p-setting-desc" style="margin-top: -8px; margin-bottom: 16px;"></div>
                        <div class="s1p-settings-item">
                            <label class="s1p-settings-label" for="s1p-remote-enabled-toggle">启用远程同步 (总开关)</label>
                            <label class="s1p-switch">
                                <input type="checkbox" id="s1p-remote-enabled-toggle" class="s1p-settings-checkbox">
                                <span class="s1p-slider"></span>
                            </label>
                        </div>
                         <p class="s1p-setting-desc">启用后，你可以在导航栏手动同步，或开启下面的自动同步。</p>

                        <div id="s1p-remote-sync-controls-wrapper">
                            <div class="s1p-settings-item">
                                <label class="s1p-settings-label" for="s1p-daily-first-load-sync-enabled-toggle">启用每日首次加载时同步</label>
                                <label class="s1p-switch">
                                    <input type="checkbox" id="s1p-daily-first-load-sync-enabled-toggle" class="s1p-settings-checkbox" data-s1p-sync-control>
                                    <span class="s1p-slider"></span>
                                </label>
                            </div>
                            <p class="s1p-setting-desc">启用后，每天第一次打开论坛时会自动检查并同步数据。此功能独立于下方的“自动后台同步”。</p>

                            <div class="s1p-settings-item">
                                <label class="s1p-settings-label" for="s1p-auto-sync-enabled-toggle">启用自动后台同步</label>
                                <label class="s1p-switch">
                                    <input type="checkbox" id="s1p-auto-sync-enabled-toggle" class="s1p-settings-checkbox" data-s1p-sync-control>
                                    <span class="s1p-slider"></span>
                                </label>
                            </div>
                            <p class="s1p-setting-desc">启用后，数据将在停止操作5秒后自动同步。关闭后将切换为纯手动同步模式。</p>
                            <div class="s1p-settings-item">
                                <label class="s1p-settings-label" for="s1p-direct-choice-mode-toggle">启用手动同步高级模式 (悬停选择)</label>
                                <label class="s1p-switch">
                                    <input type="checkbox" id="s1p-direct-choice-mode-toggle" class="s1p-settings-checkbox" data-setting="syncDirectChoiceMode">
                                    <span class="s1p-slider"></span>
                                </label>
                            </div>
                            <p class="s1p-setting-desc">关闭时，点击同步按钮将智能判断；开启时，悬停同步按钮可直接选择推送或拉取。</p>
                            <div class="s1p-settings-item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                                <label class="s1p-settings-label" for="s1p-remote-gist-id-input">Gist ID</label>
                                <input type="text" id="s1p-remote-gist-id-input" class="s1p-input" placeholder="从 Gist 网址中复制的那一长串 ID" style="width: 100%;" autocomplete="off" data-s1p-sync-control>
                            </div>
                            <div class="s1p-settings-item" style="flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 12px;">
                                <label class="s1p-settings-label" for="s1p-remote-pat-input">GitHub Personal Access Token (PAT)</label>
                                <input type="password" id="s1p-remote-pat-input" class="s1p-input" placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" style="width: 100%;" autocomplete="new-password" data-s1p-sync-control>
                            </div>
                            <div class="s1p-notice">
                                <div class="s1p-notice-icon"></div>
                                <div class="s1p-notice-content">
                                    <a href="https://silver-s1plus.netlify.app/" target="_blank">点击此处查看设置教程</a>
                                    <p>Token只会保存在你的浏览器本地，不会上传到任何地方。</p>
                                </div>
                            </div>
                            <div class="s1p-editor-footer" style="margin-top: 16px; justify-content: flex-end; gap: 8px;">
                                 <button id="s1p-remote-save-btn" class="s1p-btn" data-s1p-sync-control>保存设置</button>
                                 <button id="s1p-remote-manual-sync-btn" class="s1p-btn" data-s1p-sync-control>手动同步</button>
                                 <button id="s1p-open-gist-page-btn" class="s1p-btn" data-s1p-sync-control>打开 Gist 页面</button>
                            </div>
                        </div>
                    </div>

                    <div class="s1p-sync-title">危险操作</div>
                    <div class="s1p-local-sync-desc">以下操作会立即清空脚本在<b>当前浏览器</b>中的所选数据，且无法撤销。请在操作前务必通过“导出数据”功能进行备份。</div>
                    <div id="s1p-clear-data-options" style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px; background-color: var(--s1p-bg); border: 1px solid var(--s1p-pri); border-radius: 6px; padding: 12px;">
                        </div>
                    <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <label class="s1p-settings-label" for="s1p-clear-select-all">全选</label>
                            <label class="s1p-switch">
                                <input type="checkbox" id="s1p-clear-select-all">
                                <span class="s1p-slider"></span>
                            </label>
                        </div>
                        <button id="s1p-clear-selected-btn" class="s1p-btn s1p-red-btn">清除选中数据</button>
                    </div>
                </div>
            </div>
            <div class="s1p-modal-footer">版本: ${SCRIPT_VERSION} (${SCRIPT_RELEASE_DATE})</div>
        </div>`;

    // ... (此处省略 modal 宽度计算、tabs 定义、渲染逻辑等，与原文件一致) ...
    const modalContent = modal.querySelector(".s1p-modal-content");
    if (requiredWidth > 600) {
      modalContent.style.width = `${requiredWidth}px`;
    }

    document.body.appendChild(modal);
    updateLastSyncTimeDisplay();

    const tabs = {
      "general-settings": modal.querySelector("#s1p-tab-general-settings"),
      threads: modal.querySelector("#s1p-tab-threads"),
      users: modal.querySelector("#s1p-tab-users"),
      tags: modal.querySelector("#s1p-tab-tags"),
      bookmarks: modal.querySelector("#s1p-tab-bookmarks"),
      "nav-settings": modal.querySelector("#s1p-tab-nav-settings"),
      sync: modal.querySelector("#s1p-tab-sync"),
    };
    const dataClearanceConfig = {
      blockedThreads: {
        label: "手动屏蔽的帖子和用户主题帖",
        clear: () => saveBlockedThreads({}),
      },
      blockedUsers: {
        label: "屏蔽的用户列表",
        clear: () => saveBlockedUsers({}),
      },
      userTags: { label: "全部用户标记", clear: () => saveUserTags({}) },
      titleFilterRules: {
        label: "标题关键字屏蔽规则",
        clear: () => {
          saveTitleFilterRules([]);
          GM_setValue("s1p_title_keywords", null);
        },
      },
      readProgress: {
        label: "所有帖子阅读进度",
        clear: () => saveReadProgress({}),
      },
      bookmarkedReplies: {
        label: "收藏的回复",
        clear: () => saveBookmarkedReplies({}),
      },
      settings: {
        label: "界面、导航栏及其他设置",
        clear: () => saveSettings(defaultSettings),
      },
    };
    const clearDataOptionsContainer = modal.querySelector(
      "#s1p-clear-data-options"
    );
    if (clearDataOptionsContainer) {
      clearDataOptionsContainer.innerHTML = Object.keys(dataClearanceConfig)
        .map(
          (key) => `
                <div class="s1p-settings-item" style="padding: 8px 0;">
                    <label class="s1p-settings-label" for="s1p-clear-chk-${key}">${dataClearanceConfig[key].label}</label>
                    <label class="s1p-switch">
                        <input type="checkbox" class="s1p-clear-data-checkbox" id="s1p-clear-chk-${key}" data-clear-key="${key}">
                        <span class="s1p-slider"></span>
                    </label>
                </div>
            `
        )
        .join("");
    }

    const remoteToggle = modal.querySelector("#s1p-remote-enabled-toggle");
    const controlsWrapper = modal.querySelector(
      "#s1p-remote-sync-controls-wrapper"
    );
    const updateRemoteSyncInputsState = () => {
      const isMasterEnabled = remoteToggle.checked;
      controlsWrapper.classList.toggle("is-disabled", !isMasterEnabled);
      controlsWrapper
        .querySelectorAll("[data-s1p-sync-control]")
        .forEach((el) => {
          el.disabled = !isMasterEnabled;
        });
    };

    const settings = getSettings();
    remoteToggle.checked = settings.syncRemoteEnabled;
    // --- 在这里新增下面的代码块 ---
    const directChoiceModeToggle = modal.querySelector(
      "#s1p-direct-choice-mode-toggle"
    );
    if (directChoiceModeToggle) {
      directChoiceModeToggle.checked = settings.syncDirectChoiceMode;
      directChoiceModeToggle.addEventListener("change", (e) => {
        const currentSettings = getSettings();
        currentSettings.syncDirectChoiceMode = e.target.checked;
        saveSettings(currentSettings);
        // 立即刷新导航栏按钮以应用新模式
        initializeNavbar();
      });
    }
    // --- 新增代码结束 ---

    modal.querySelector("#s1p-daily-first-load-sync-enabled-toggle").checked =
      settings.syncDailyFirstLoad;
    modal.querySelector("#s1p-auto-sync-enabled-toggle").checked =
      settings.syncAutoEnabled;
    modal.querySelector("#s1p-remote-gist-id-input").value =
      settings.syncRemoteGistId || "";
    modal.querySelector("#s1p-remote-pat-input").value =
      settings.syncRemotePat || "";

    remoteToggle.addEventListener("change", updateRemoteSyncInputsState);
    updateRemoteSyncInputsState();

    // ... (此处省略所有 render...Tab 函数的内部代码和事件绑定逻辑，与原文件一致) ...
    // [REFACTORED] 全新用户标记标签页渲染逻辑
    const renderTagsTab = (options = {}) => {
      const editingUserId = options.editingUserId;
      const settings = getSettings();
      const isEnabled = settings.enableUserTagging;

      const toggleHTML = `
                <div class="s1p-settings-item" style="padding: 0; padding-bottom: 16px; margin-bottom: 10px; border-bottom: 1px solid var(--s1p-pri);">
                    <label class="s1p-settings-label" for="s1p-enableUserTagging">启用用户标记功能</label>
                    <label class="s1p-switch"><input type="checkbox" id="s1p-enableUserTagging" data-feature="enableUserTagging" class="s1p-feature-toggle" ${
                      isEnabled ? "checked" : ""
                    }><span class="s1p-slider"></span></label>
                </div>
            `;
      const userTags = getUserTags();
      const tagItems = Object.entries(userTags).sort(
        ([, a], [, b]) => (b.timestamp || 0) - (a.timestamp || 0)
      );
      const contentHTML = `
                <div class="s1p-settings-group">
                    <div class="s1p-sync-title">用户标记管理</div>
                    <p class="s1p-setting-desc" style="margin-top: 0; margin-bottom: 16px;">
                        在此集中管理、编辑、导出或导入您为所有用户添加的标记。
                    </p>
                    <div class="s1p-local-sync-buttons">
                        <button id="s1p-export-tags-btn" class="s1p-btn">导出全部标记</button>
                        <button id="s1p-import-tags-btn" class="s1p-btn">导入标记</button>
                    </div>
                    <textarea id="s1p-tags-sync-textarea" class="s1p-input s1p-textarea s1p-sync-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据..." autocomplete="off"></textarea>
                </div>

                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">已标记用户列表</div>
                    <div id="s1p-tags-list-container">
                        ${
                          tagItems.length === 0
                            ? `<div class="s1p-empty">暂无用户标记</div>`
                            : `<div class="s1p-list">${tagItems
                                .map(([id, data]) => {
                                  if (id === editingUserId) {
                                    // --- 编辑模式 ---
                                    return `
                                <div class="s1p-item" data-user-id="${id}">
                                    <div class="s1p-item-info">
                                        <div class="s1p-item-title">${data.name}</div>
                                        <div class="s1p-item-meta">
                                            ID: <span class="s1p-item-meta-id">${id}</span>
                                        </div>
                                        <div class="s1p-item-editor">
                                            <textarea class="s1p-input s1p-textarea s1p-tag-edit-area" autocomplete="off">${data.tag}</textarea>
                                        </div>
                                    </div>
                                    <div class="s1p-item-actions">
                                        <button class="s1p-btn s1p-primary" data-action="save-tag-edit" data-user-id="${id}" data-user-name="${data.name}">保存</button>
                                        <button class="s1p-btn" data-action="cancel-tag-edit">取消</button>
                                    </div>
                                </div>`;
                                  } else {
                                    // --- 正常显示模式 ---
                                    return `
                                <div class="s1p-item" data-user-id="${id}">
                                    <div class="s1p-item-info">
                                        <div class="s1p-item-title">${
                                          data.name
                                        }</div>
                                        <div class="s1p-item-meta">
                                            ID: <span class="s1p-item-meta-id">${id}</span> &nbsp;
                                            标记于: ${formatDate(
                                              data.timestamp
                                            )}
                                        </div>
                                        <div class="s1p-item-content">${
                                          data.tag
                                        }</div>
                                    </div>
                                    <div class="s1p-item-actions">
                                        <button class="s1p-btn" data-action="edit-tag-item" data-user-id="${id}">编辑</button>
                                        <button class="s1p-btn s1p-danger" data-action="delete-tag-item" data-user-id="${id}" data-user-name="${
                                      data.name
                                    }">删除</button>
                                    </div>
                                </div>`;
                                  }
                                })
                                .join("")}</div>`
                        }
                    </div>
                </div>
            `;
      tabs["tags"].innerHTML = `
                ${toggleHTML}
                <div class="s1p-feature-content ${isEnabled ? "expanded" : ""}">
                    <div>${contentHTML}</div>
                </div>
            `;
      if (editingUserId) {
        const textarea = tabs["tags"].querySelector(".s1p-tag-edit-area");
        if (textarea) {
          textarea.focus();
          textarea.selectionStart = textarea.selectionEnd =
            textarea.value.length;
        }
      }
    };
    const renderBookmarksTab = () => {
      const settings = getSettings();
      const isEnabled = settings.enableBookmarkReplies;

      const toggleHTML = `
                <div class="s1p-settings-item" style="padding: 0; padding-bottom: 16px; margin-bottom: 10px; border-bottom: 1px solid var(--s1p-pri);">
                    <label class="s1p-settings-label" for="s1p-enableBookmarkReplies">启用回复收藏功能</label>
                    <label class="s1p-switch"><input type="checkbox" id="s1p-enableBookmarkReplies" data-feature="enableBookmarkReplies" class="s1p-feature-toggle" ${
                      isEnabled ? "checked" : ""
                    }><span class="s1p-slider"></span></label>
                </div>
            `;
      const bookmarkedReplies = getBookmarkedReplies();
      const bookmarkItems = Object.values(bookmarkedReplies).sort(
        (a, b) => b.timestamp - a.timestamp
      );

      const hasBookmarks = bookmarkItems.length > 0;
      const contentHTML = `
                ${
                  hasBookmarks
                    ? `
                <div class="s1p-settings-group" style="margin-bottom: 16px;">
                    <div class="s1p-search-input-wrapper">
                        <input type="text" id="s1p-bookmark-search-input" class="s1p-input" placeholder="搜索内容、作者、标题..." autocomplete="off">
                        <svg class="s1p-search-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                        <button id="s1p-bookmark-search-clear-btn" class="s1p-search-clear-btn hidden" title="清空搜索" aria-label="清空搜索">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
                        </button>
                    </div>
                </div>`
                    : ""
                }
                <div id="s1p-bookmarks-list-container">
                    ${
                      !hasBookmarks
                        ? `<div id="s1p-bookmarks-empty-message" class="s1p-empty">暂无收藏的回复</div>`
                        : `<div class="s1p-list" id="s1p-bookmarks-list">
                        ${bookmarkItems
                          .map((item) => {
                            const fullText = item.postContent || "";
                            const isLong = fullText.length > 150;
                            let contentBlock;
                            if (isLong) {
                              const previewText = fullText.substring(0, 150);
                              contentBlock = `<div class="s1p-bookmark-preview"><span>${previewText}... </span><a href="javascript:void(0);" class="s1p-bookmark-toggle" data-action="toggle-bookmark-content">查看完整回复</a></div><div class="s1p-bookmark-full" style="display: none;"><span>${fullText} </span><a href="javascript:void(0);" class="s1p-bookmark-toggle" data-action="toggle-bookmark-content">收起</a></div>`;
                            } else {
                              contentBlock = `<div class="s1p-bookmark-preview"><span>${fullText}</span></div>`;
                            }
                            return `
                        <div class="s1p-item" data-post-id="${
                          item.postId
                        }" style="position: relative;">
                            <button class="s1p-btn s1p-danger" data-action="remove-bookmark" data-post-id="${
                              item.postId
                            }" style="position: absolute; top: 12px; right: 12px; padding: 4px 8px; font-size: 12px;">取消收藏</button>
                            <div class="s1p-item-info" style="width: 100%; padding-right: 100px;">
                                <div class="s1p-item-content">${contentBlock}</div>
                                <div class="s1p-item-meta" style="margin-top: 10px;">
                                    <strong>${
                                      item.authorName
                                    }</strong> · 收藏于: ${formatDate(
                              item.timestamp
                            )}
                                    <br>
                                    来自帖子: <a href="forum.php?mod=redirect&goto=findpost&ptid=${
                                      item.threadId
                                    }&pid=${
                              item.postId
                            }" target="_blank" style="font-weight: 500;">${
                              item.threadTitle
                            }</a>
                                </div>
                            </div>
                        </div>`;
                          })
                          .join("")}
                    </div>`
                    }
                </div>
                <div id="s1p-bookmarks-no-results" class="s1p-empty" style="display: none;">没有找到匹配的收藏</div>
            `;
      tabs["bookmarks"].innerHTML = `
                ${toggleHTML}
                <div class="s1p-feature-content ${isEnabled ? "expanded" : ""}">
                    <div>${contentHTML}</div>
                </div>
            `;
      tabs["bookmarks"].addEventListener("click", (e) => {
        const toggleLink = e.target.closest(
          '[data-action="toggle-bookmark-content"]'
        );
        if (toggleLink) {
          e.preventDefault();
          e.stopPropagation();
          const contentItem = toggleLink.closest(".s1p-item-content");
          if (!contentItem) return;
          const preview = contentItem.querySelector(".s1p-bookmark-preview");
          const full = contentItem.querySelector(".s1p-bookmark-full");
          if (!preview || !full) return;

          const isCurrentlyCollapsed =
            window.getComputedStyle(full).display === "none";
          if (isCurrentlyCollapsed) {
            full.style.display = "block";
            preview.style.display = "none";
          } else {
            full.style.display = "none";
            preview.style.display = "block";
          }
        }
      });
      if (hasBookmarks) {
        setupBookmarkSearchComponent(tabs["bookmarks"]);
      }
    };
    const renderUserTab = () => {
      const settings = getSettings();
      const isEnabled = settings.enableUserBlocking;

      const toggleHTML = `
                <div class="s1p-settings-item" style="padding: 0; padding-bottom: 16px; margin-bottom: 10px; border-bottom: 1px solid var(--s1p-pri);">
                    <label class="s1p-settings-label" for="s1p-enableUserBlocking">启用用户屏蔽功能</label>
                    <label class="s1p-switch"><input type="checkbox" id="s1p-enableUserBlocking" data-feature="enableUserBlocking" class="s1p-feature-toggle" ${
                      isEnabled ? "checked" : ""
                    }><span class="s1p-slider"></span></label>
                </div>
            `;
      const blockedUsers = getBlockedUsers();
      const userItemIds = Object.keys(blockedUsers).sort(
        (a, b) => blockedUsers[b].timestamp - blockedUsers[a].timestamp
      );
      const contentHTML = `
                <div class="s1p-settings-group" style="margin-bottom: 16px; padding-bottom: 0;">
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-blockThreadsOnUserBlock">屏蔽用户时，默认屏蔽其所有主题帖</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-blockThreadsOnUserBlock" class="s1p-settings-checkbox" ${
                          settings.blockThreadsOnUserBlock ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                </div>
                <p class="s1p-setting-desc" style="margin-top: -4px; margin-bottom: 16px;">
                    <strong>提示</strong>：顶部总开关仅影响<strong>未来新屏蔽用户</strong>的默认设置。每个用户下方的独立开关，才是控制该用户主题帖的<strong>最终开关</strong>，拥有最高优先级。
                </p>
                <div id="s1p-blocked-user-list-container">
                    ${
                      userItemIds.length === 0
                        ? `<div class="s1p-empty">暂无屏蔽的用户</div>`
                        : `<div class="s1p-list">${userItemIds
                            .map((id) => {
                              const item = blockedUsers[id];
                              return `<div class="s1p-item" data-user-id="${id}"><div class="s1p-item-info"><div class="s1p-item-title">${
                                item.name || `用户 #${id}`
                              }</div><div class="s1p-item-meta">屏蔽时间: ${formatDate(
                                item.timestamp
                              )}</div><div class="s1p-item-toggle"><label class="s1p-switch"><input type="checkbox" class="s1p-user-thread-block-toggle" data-user-id="${id}" ${
                                item.blockThreads ? "checked" : ""
                              }><span class="s1p-slider"></span></label><span>屏蔽该用户的主题帖</span></div></div><button class="s1p-unblock-btn s1p-btn" data-unblock-user-id="${id}">取消屏蔽</button></div>`;
                            })
                            .join("")}</div>`
                    }
                </div>
            `;
      tabs["users"].innerHTML = `
                ${toggleHTML}
                <div class="s1p-feature-content ${isEnabled ? "expanded" : ""}">
                    <div>${contentHTML}</div>
                </div>
            `;
    };
    const renderThreadTab = () => {
      const settings = getSettings();
      const isEnabled = settings.enablePostBlocking;

      const toggleHTML = `
                <div class="s1p-settings-item" style="padding: 0; padding-bottom: 16px; margin-bottom: 10px; border-bottom: 1px solid var(--s1p-pri);">
                    <label class="s1p-settings-label" for="s1p-enablePostBlocking">启用帖子屏蔽功能</label>
                    <label class="s1p-switch"><input type="checkbox" id="s1p-enablePostBlocking" data-feature="enablePostBlocking" class="s1p-feature-toggle" ${
                      isEnabled ? "checked" : ""
                    }><span class="s1p-slider"></span></label>
                </div>
            `;
      const blockedThreads = getBlockedThreads();
      const manualItemIds = Object.keys(blockedThreads).sort(
        (a, b) => blockedThreads[b].timestamp - blockedThreads[a].timestamp
      );
      const contentHTML = `
                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">标题关键字屏蔽规则</div>
                    <p class="s1p-setting-desc">将自动屏蔽标题匹配已启用规则的帖子，支持正则表达式。修改后请点击“保存规则”以生效。</p>
                    <div id="s1p-keyword-rules-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
                    <div class="s1p-editor-footer" style="justify-content: flex-start; gap: 8px;">
                         <button id="s1p-keyword-rule-add-btn" class="s1p-btn">添加新规则</button>
                         <button id="s1p-keyword-rules-save-btn" class="s1p-btn">保存规则</button>
                    </div>
                </div>

                <div class="s1p-settings-group">
                    <div id="s1p-blocked-by-keyword-header" class="s1p-settings-group-title s1p-collapsible-header">
                        <span>关键字/规则的屏蔽帖子列表</span>
                        <span class="s1p-expander-arrow ${
                          settings.showBlockedByKeywordList ? "expanded" : ""
                        }"></span>
                    </div>
                    <div id="s1p-dynamically-hidden-list-container" class="s1p-collapsible-content ${
                      settings.showBlockedByKeywordList ? "expanded" : ""
                    }">
                        <div id="s1p-dynamically-hidden-list"></div>
                    </div>
                </div>

                <div class="s1p-settings-group">
                     <div id="s1p-manually-blocked-header" class="s1p-settings-group-title s1p-collapsible-header">
                        <span>手动屏蔽的帖子列表</span>
                        <span class="s1p-expander-arrow ${
                          settings.showManuallyBlockedList ? "expanded" : ""
                        }"></span>
                    </div>
                    <div id="s1p-manually-blocked-list-container" class="s1p-collapsible-content ${
                      settings.showManuallyBlockedList ? "expanded" : ""
                    }">
                    <div>
                    ${
                      manualItemIds.length === 0
                        ? `<div class="s1p-empty">暂无手动屏蔽的帖子</div>`
                        : `<div class="s1p-list">${manualItemIds
                            .map((id) => {
                              const item = blockedThreads[id];
                              return `<div class="s1p-item" data-thread-id="${id}"><div class="s1p-item-info"><div class="s1p-item-title">${
                                item.title || `帖子 #${id}`
                              }</div><div class="s1p-item-meta">屏蔽时间: ${formatDate(
                                item.timestamp
                              )} ${
                                item.reason && item.reason !== "manual"
                                  ? `(因屏蔽用户${item.reason.replace(
                                      "user_",
                                      ""
                                    )})`
                                  : ""
                              }</div></div><button class="s1p-unblock-btn s1p-btn" data-unblock-thread-id="${id}">取消屏蔽</button></div>`;
                            })
                            .join("")}</div>`
                    }
                    </div>
                    </div>
                </div>
            `;

      tabs["threads"].innerHTML = `
                ${toggleHTML}
                <div class="s1p-feature-content ${isEnabled ? "expanded" : ""}">
                    <div>${contentHTML}</div>
                </div>
            `;

      const renderDynamicallyHiddenList = () => {
        const listContainer = tabs["threads"].querySelector(
          "#s1p-dynamically-hidden-list"
        );
        const hiddenItems = Object.entries(dynamicallyHiddenThreads);
        if (hiddenItems.length === 0) {
          listContainer.innerHTML = `<div class="s1p-empty" style="padding-top: 12px;">当前页面没有被关键字屏蔽的帖子</div>`;
        } else {
          listContainer.innerHTML = `<div class="s1p-list">${hiddenItems
            .map(
              ([id, item]) => `
                        <div class="s1p-item" data-thread-id="${id}">
                            <div class="s1p-item-info">
                                <div class="s1p-item-title" title="${item.title}">${item.title}</div>
                                <div class="s1p-item-meta">匹配规则: <code style="background: var(--s1p-code-bg); padding: 2px 4px; border-radius: 3px;">${item.pattern}</code></div>
                            </div>
                        </div>
                    `
            )
            .join("")}</div>`;
        }
      };
      const renderRules = () => {
        const rules = getTitleFilterRules();
        const container = tabs["threads"].querySelector(
          "#s1p-keyword-rules-list"
        );
        if (!container) return;
        container.innerHTML = rules
          .map(
            (rule) => `
                    <div class="s1p-editor-item" data-rule-id="${rule.id}">
                        <label class="s1p-switch"><input type="checkbox" class="s1p-settings-checkbox s1p-keyword-rule-enable" ${
                          rule.enabled ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                        <input type="text" class="s1p-input s1p-keyword-rule-pattern" placeholder="输入关键字或正则表达式" value="${
                          rule.pattern || ""
                        }" autocomplete="off">
                        <div class="s1p-editor-item-controls">
                            <button class="s1p-editor-btn s1p-delete-button" data-action="delete" title="删除规则"></button>
                        </div>
                    </div>
                `
          )
          .join("");
        if (rules.length === 0) {
          container.innerHTML = `<div class="s1p-empty" style="padding: 12px;">暂无规则</div>`;
        }
      };

      renderRules();
      renderDynamicallyHiddenList();
      const saveKeywordRules = () => {
        const newRules = [];
        tabs["threads"]
          .querySelectorAll("#s1p-keyword-rules-list .s1p-editor-item")
          .forEach((item) => {
            const pattern = item
              .querySelector(".s1p-keyword-rule-pattern")
              .value.trim();
            if (pattern) {
              let id = item.dataset.ruleId;
              if (id.startsWith("new_")) {
                id = `rule_${Date.now()}_${Math.random()}`;
              }
              newRules.push({
                id: id,
                enabled: item.querySelector(".s1p-keyword-rule-enable").checked,
                pattern: pattern,
              });
            }
          });
        saveTitleFilterRules(newRules);
        hideThreadsByTitleKeyword();
        renderDynamicallyHiddenList();
        renderRules();
      };

      tabs["threads"].addEventListener("click", (e) => {
        const target = e.target;
        const header = target.closest(".s1p-collapsible-header");

        if (header) {
          if (header.id === "s1p-blocked-by-keyword-header") {
            const currentSettings = getSettings();
            const isNowExpanded = !currentSettings.showBlockedByKeywordList;
            currentSettings.showBlockedByKeywordList = isNowExpanded;
            saveSettings(currentSettings);

            header
              .querySelector(".s1p-expander-arrow")
              .classList.toggle("expanded", isNowExpanded);
            tabs["threads"]
              .querySelector("#s1p-dynamically-hidden-list-container")
              .classList.toggle("expanded", isNowExpanded);
          } else if (header.id === "s1p-manually-blocked-header") {
            const currentSettings = getSettings();
            const isNowExpanded = !currentSettings.showManuallyBlockedList;
            currentSettings.showManuallyBlockedList = isNowExpanded;
            saveSettings(currentSettings);

            header
              .querySelector(".s1p-expander-arrow")
              .classList.toggle("expanded", isNowExpanded);
            tabs["threads"]
              .querySelector("#s1p-manually-blocked-list-container")
              .classList.toggle("expanded", isNowExpanded);
          }
        } else if (target.id === "s1p-keyword-rule-add-btn") {
          const container = tabs["threads"].querySelector(
            "#s1p-keyword-rules-list"
          );
          const emptyMsg = container.querySelector(".s1p-empty");
          if (emptyMsg) emptyMsg.remove();

          const newItem = document.createElement("div");
          newItem.className = "s1p-editor-item";
          newItem.dataset.ruleId = `new_${Date.now()}`;
          newItem.innerHTML = `
                        <label class="s1p-switch"><input type="checkbox" class="s1p-settings-checkbox s1p-keyword-rule-enable" checked><span class="s1p-slider"></span></label>
                        <input type="text" class="s1p-input s1p-keyword-rule-pattern" placeholder="输入关键字或正则表达式" value="" autocomplete="off">
                        <div class="s1p-editor-item-controls">
                            <button class="s1p-editor-btn s1p-delete-button" data-action="delete" title="删除规则"></button>
                        </div>
                    `;
          container.appendChild(newItem);
          newItem.querySelector('input[type="text"]').focus();
        } else if (target.classList.contains("s1p-delete-button")) {
          const item = target.closest(".s1p-editor-item");
          item.remove();
          const container = tabs["threads"].querySelector(
            "#s1p-keyword-rules-list"
          );
          if (container.children.length === 0) {
            container.innerHTML = `<div class="s1p-empty" style="padding: 12px;">暂无规则</div>`;
          }
        } else if (target.id === "s1p-keyword-rules-save-btn") {
          saveKeywordRules();
          showMessage("规则已保存！", true);
        }
      });
    };
    // [修改] 更新开关的文本描述，并简化事件逻辑
    const renderGeneralSettingsTab = () => {
      const settings = getSettings();
      tabs["general-settings"].innerHTML = `
                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">阅读/浏览增强</div>

                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-openThreadsInNewTab">在新窗口打开帖子</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-openThreadsInNewTab" class="s1p-settings-checkbox" data-setting="openThreadsInNewTab" ${
                          settings.openThreadsInNewTab ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item" id="s1p-openThreadsInBackground-item" style="padding-left: 20px; ${
                      !settings.openThreadsInNewTab ? "display: none;" : ""
                    }">
                        <label class="s1p-settings-label" for="s1p-openThreadsInBackground">后台打开 (不激活新标签页)</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-openThreadsInBackground" class="s1p-settings-checkbox" data-setting="openThreadsInBackground" ${
                          settings.openThreadsInBackground ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>

                     <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-enableReadProgress">启用阅读进度跟踪</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-enableReadProgress" data-feature="enableReadProgress" class="s1p-feature-toggle" ${
                          settings.enableReadProgress ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item" id="s1p-showReadIndicator-container" style="padding-left: 20px; ${
                      !settings.enableReadProgress ? "display: none;" : ""
                    }">
                        <label class="s1p-settings-label" for="s1p-showReadIndicator">显示“当前阅读位置”浮动标识</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-showReadIndicator" class="s1p-settings-checkbox" data-setting="showReadIndicator" ${
                          settings.showReadIndicator ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item" id="s1p-readingProgressCleanupContainer" style="padding-left: 20px; ${
                      !settings.enableReadProgress ? "display: none;" : ""
                    }">
                        <label class="s1p-settings-label">自动清理超过以下时间的阅读记录</label>
                        <div id="s1p-readingProgressCleanupDays-control" class="s1p-segmented-control">
                            <div class="s1p-segmented-control-slider"></div>
                            <div class="s1p-segmented-control-option ${
                              settings.readingProgressCleanupDays == 30
                                ? "active"
                                : ""
                            }" data-value="30">1个月</div>
                            <div class="s1p-segmented-control-option ${
                              settings.readingProgressCleanupDays == 90
                                ? "active"
                                : ""
                            }" data-value="90">3个月</div>
                            <div class="s1p-segmented-control-option ${
                              settings.readingProgressCleanupDays == 180
                                ? "active"
                                : ""
                            }" data-value="180">6个月</div>
                            <div class="s1p-segmented-control-option ${
                              settings.readingProgressCleanupDays == 0
                                ? "active"
                                : ""
                            }" data-value="0">永不</div>
                        </div>
                    </div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-openProgressInNewTab">在新窗口打开阅读进度</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-openProgressInNewTab" class="s1p-settings-checkbox" data-setting="openProgressInNewTab" ${
                          settings.openProgressInNewTab ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item" id="s1p-openProgressInBackground-item" style="padding-left: 20px; ${
                      !settings.openProgressInNewTab ? "display: none;" : ""
                    }">
                        <label class="s1p-settings-label" for="s1p-openProgressInBackground">后台打开 (不激活新标签页)</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-openProgressInBackground" class="s1p-settings-checkbox" data-setting="openProgressInBackground" ${
                          settings.openProgressInBackground ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                     <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-hideImagesByDefault">默认隐藏帖子图片</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-hideImagesByDefault" class="s1p-settings-checkbox" data-setting="hideImagesByDefault" ${
                          settings.hideImagesByDefault ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                </div>
                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">界面与个性化</div>
                     <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-followS1NuxTheme">跟随 S1 NUX 视觉风格</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-followS1NuxTheme" class="s1p-settings-checkbox" data-setting="followS1NuxTheme" ${
                          settings.followS1NuxTheme ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                    <p class="s1p-setting-desc">UI 兼容模式：<b>开启</b>后，部分UI (如滚动条、删除按钮) 将适配 \`S1 NUX\` 风格；<b>关闭</b>则强制恢复 S1 Plus 的经典独立样式。</p>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-enhanceFloatingControls">使用 S1 Plus 增强型悬浮控件</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-enhanceFloatingControls" class="s1p-settings-checkbox" data-setting="enhanceFloatingControls" ${
                          settings.enhanceFloatingControls ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                    <p class="s1p-setting-desc">开启后，将使用脚本提供的全新悬停展开式控件；关闭则恢复使用论坛原生的滚动控件。</p>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-changeLogoLink">修改论坛Logo链接 (指向论坛首页)</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-changeLogoLink" class="s1p-settings-checkbox" data-setting="changeLogoLink" ${
                          settings.changeLogoLink ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-hideBlacklistTip">隐藏已屏蔽用户发言的黄条提示</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-hideBlacklistTip" class="s1p-settings-checkbox" data-setting="hideBlacklistTip" ${
                          settings.hideBlacklistTip ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-customTitleSuffix">自定义标题后缀</label>
                        <input type="text" id="s1p-customTitleSuffix" class="s1p-input" data-setting="customTitleSuffix" value="${
                          settings.customTitleSuffix || ""
                        }" autocomplete="off">
                    </div>
                </div>`;

      // [核心修改] 将此函数内的 moveSlider 逻辑改为使用 transform
      const moveSlider = (control, retries = 3) => {
        if (!control || retries <= 0) return;
        const slider = control.querySelector(".s1p-segmented-control-slider");
        const activeOption = control.querySelector(
          ".s1p-segmented-control-option.active"
        );

        if (slider && activeOption) {
          const width = activeOption.offsetWidth;
          if (width === 0) {
            setTimeout(() => moveSlider(control, retries - 1), 50);
            return;
          }
          slider.style.width = `${width}px`;
          slider.style.transform = `translateX(${activeOption.offsetLeft}px)`;
        }
      };

      const openInNewTabCheckbox = tabs["general-settings"].querySelector(
        "#s1p-openProgressInNewTab"
      );
      const openInBackgroundItem = tabs["general-settings"].querySelector(
        "#s1p-openProgressInBackground-item"
      );
      const openThreadsInNewTabCheckbox = tabs[
        "general-settings"
      ].querySelector("#s1p-openThreadsInNewTab");
      const openThreadsInBackgroundItem = tabs[
        "general-settings"
      ].querySelector("#s1p-openThreadsInBackground-item");
      openInNewTabCheckbox.addEventListener("change", (e) => {
        openInBackgroundItem.style.display = e.target.checked ? "flex" : "none";
      });
      openThreadsInNewTabCheckbox.addEventListener("change", (e) => {
        openThreadsInBackgroundItem.style.display = e.target.checked
          ? "flex"
          : "none";
      });
      const cleanupControl = tabs["general-settings"].querySelector(
        "#s1p-readingProgressCleanupDays-control"
      );
      if (cleanupControl) {
        setTimeout(() => moveSlider(cleanupControl), 0);
        cleanupControl.addEventListener("click", (e) => {
          const target = e.target.closest(".s1p-segmented-control-option");
          if (!target || target.classList.contains("active")) return;

          const newValue = parseInt(target.dataset.value, 10);

          const currentSettings = getSettings();
          currentSettings.readingProgressCleanupDays = newValue;
          saveSettings(currentSettings);

          cleanupControl
            .querySelectorAll(".s1p-segmented-control-option")
            .forEach((opt) => opt.classList.remove("active"));
          target.classList.add("active");
          moveSlider(cleanupControl);
        });
      }

      tabs["general-settings"].addEventListener("change", (e) => {
        const target = e.target;
        const settingKey = target.dataset.setting;
        if (settingKey) {
          const settings = getSettings();
          if (target.type === "checkbox") {
            settings[settingKey] = target.checked;
          } else if (target.type === "number" || target.tagName === "SELECT") {
            settings[settingKey] = parseInt(target.value, 10);
          } else {
            settings[settingKey] = target.value;
          }
          saveSettings(settings);

          if (settingKey === "enhanceFloatingControls") {
            applyChanges();
            return;
          }

          if (settingKey === "followS1NuxTheme") {
            applyThemeOverrideStyle();
            applyDeleteButtonThemeStyle();
          }

          applyInterfaceCustomizations();

          if (settingKey === "showReadIndicator" && !target.checked) {
            updateReadIndicatorUI(null);
          }

          if (settingKey === "hideImagesByDefault") {
            applyImageHiding();
            manageImageToggleAllButtons();
          }

          if (
            settingKey === "openThreadsInNewTab" ||
            settingKey === "openThreadsInBackground"
          ) {
            applyThreadLinkBehavior();
            applyPageLinkBehavior();
          }

          if (
            settingKey === "openProgressInNewTab" ||
            settingKey === "openProgressInBackground"
          ) {
            removeProgressJumpButtons();
            addProgressJumpButtons();
          }
        }
      });
    };
    const renderNavSettingsTab = () => {
      const settings = getSettings();
      tabs["nav-settings"].innerHTML = `
                <div class="s1p-settings-group">
                    <div class="s1p-settings-item" style="padding: 0;">
                        <label class="s1p-settings-label" for="s1p-enableNavCustomization">启用自定义导航栏</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-enableNavCustomization" class="s1p-settings-checkbox" ${
                          settings.enableNavCustomization ? "checked" : ""
                        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-nav-editor-list" style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;"></div>
                </div>
                <div class="s1p-editor-footer">
                    <div style="display: flex; gap: 8px;">
                        <button id="s1p-nav-add-btn" class="s1p-btn">添加新链接</button>
                        <button id="s1p-settings-save-btn" class="s1p-btn">保存设置</button>
                    </div>
                    <button id="s1p-nav-restore-btn" class="s1p-btn s1p-red-btn">恢复默认导航</button>
                </div>`;
      const navListContainer = tabs["nav-settings"].querySelector(
        ".s1p-nav-editor-list"
      );
      const renderNavList = (links) => {
        navListContainer.innerHTML = (links || [])
          .map(
            (link, index) => `
                    <div class="s1p-editor-item" draggable="true" data-index="${index}" style="grid-template-columns: auto 1fr 1fr auto; user-select: none;">
                        <div class="s1p-drag-handle">::</div>
                        <input type="text" class="s1p-input s1p-nav-name" placeholder="名称" value="${
                          link.name || ""
                        }" autocomplete="off">
                        <input type="text" class="s1p-input s1p-nav-href" placeholder="链接" value="${
                          link.href || ""
                        }" autocomplete="off">
                        <div class="s1p-editor-item-controls"><button class="s1p-editor-btn s1p-delete-button" data-action="delete" title="删除链接"></button></div>
                    </div>`
          )
          .join("");
      };

      renderNavList(settings.customNavLinks);

      let draggedItem = null;
      navListContainer.addEventListener("dragstart", (e) => {
        if (e.target.classList.contains("s1p-editor-item")) {
          draggedItem = e.target;
          setTimeout(() => {
            e.target.classList.add("s1p-dragging");
          }, 0);
        }
      });
      navListContainer.addEventListener("dragend", (e) => {
        if (draggedItem) {
          draggedItem.classList.remove("s1p-dragging");
          draggedItem = null;
        }
      });
      navListContainer.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!draggedItem) return;

        const container = e.currentTarget;
        const otherItems = [
          ...container.querySelectorAll(".s1p-editor-item:not(.s1p-dragging)"),
        ];
        const nextSibling = otherItems.find((item) => {
          const rect = item.getBoundingClientRect();
          return e.clientY < rect.top + rect.height / 2;
        });

        if (nextSibling) {
          container.insertBefore(draggedItem, nextSibling);
        } else {
          container.appendChild(draggedItem);
        }
      });
      tabs["nav-settings"].addEventListener("click", (e) => {
        const target = e.target;
        if (target.id === "s1p-nav-add-btn") {
          const newItem = document.createElement("div");
          newItem.className = "s1p-editor-item";
          newItem.draggable = true;
          newItem.style.gridTemplateColumns = "auto 1fr 1fr auto";
          // --- [联动修改] 同样重新添加 data-action="delete" ---
          newItem.innerHTML = `<div class="s1p-drag-handle">::</div><input type="text" class="s1p-input s1p-nav-name" placeholder="新链接" autocomplete="off"><input type="text" class="s1p-input s1p-nav-href" placeholder="forum.php" autocomplete="off"><div class="s1p-editor-item-controls"><button class="s1p-editor-btn s1p-delete-button" data-action="delete" title="删除链接"></button></div>`;
          navListContainer.appendChild(newItem);
        } else if (target.classList.contains("s1p-delete-button")) {
          target.closest(".s1p-editor-item").remove();
        } else if (target.id === "s1p-nav-restore-btn") {
          const currentSettings = getSettings();
          currentSettings.enableNavCustomization =
            defaultSettings.enableNavCustomization;
          currentSettings.customNavLinks = defaultSettings.customNavLinks;
          saveSettings(currentSettings);
          renderNavSettingsTab();
          applyInterfaceCustomizations();
          initializeNavbar();
          showMessage("导航栏已恢复为默认设置！", true);
        } else if (target.id === "s1p-settings-save-btn") {
          const newSettings = {
            ...getSettings(),
            enableNavCustomization: tabs["nav-settings"].querySelector(
              "#s1p-enableNavCustomization"
            ).checked,
            customNavLinks: Array.from(
              navListContainer.querySelectorAll(".s1p-editor-item")
            )
              .map((item) => ({
                name: item.querySelector(".s1p-nav-name").value.trim(),
                href: item.querySelector(".s1p-nav-href").value.trim(),
              }))
              .filter((l) => l.name && l.href),
          };
          saveSettings(newSettings);
          applyInterfaceCustomizations();
          initializeNavbar();
          showMessage("设置已保存！", true);
        }
      });
    };
    // --- 初始化渲染和事件绑定 ---
    renderGeneralSettingsTab();
    renderThreadTab();
    renderUserTab();
    renderTagsTab();
    renderBookmarksTab();
    renderNavSettingsTab();

    // [新增] 初始化滑块位置
    const tabContainer = modal.querySelector(".s1p-tabs");
    setTimeout(() => moveTabSlider(tabContainer), 50);

    modal.style.transition = "opacity 0.2s ease-out";
    requestAnimationFrame(() => {
      modal.style.opacity = "1";
    });
    modal.addEventListener("change", (e) => {
      const target = e.target;
      const settings = getSettings();
      const featureKey = target.dataset.feature;

      if (featureKey && target.classList.contains("s1p-feature-toggle")) {
        const isChecked = target.checked;
        settings[featureKey] = isChecked;

        const contentWrapper =
          target.closest(".s1p-settings-item")?.nextElementSibling;
        if (
          contentWrapper &&
          contentWrapper.classList.contains("s1p-feature-content")
        ) {
          contentWrapper.classList.toggle("expanded", isChecked);
        }
        saveSettings(settings);

        switch (featureKey) {
          case "enablePostBlocking":
            isChecked
              ? addBlockButtonsToThreads()
              : removeBlockButtonsFromThreads();
            break;
          case "enableUserBlocking":
            refreshAllAuthiActions();
            isChecked
              ? hideBlockedUsersPosts()
              : Object.keys(getBlockedUsers()).forEach(showUserPosts);
            hideBlockedUserQuotes();
            hideBlockedUserRatings();
            break;
          case "enableUserTagging":
            refreshAllAuthiActions();
            break;
          case "enableReadProgress":
            document.getElementById(
              "s1p-showReadIndicator-container"
            ).style.display = isChecked ? "flex" : "none";
            document.getElementById(
              "s1p-readingProgressCleanupContainer"
            ).style.display = isChecked ? "flex" : "none";
            isChecked ? addProgressJumpButtons() : removeProgressJumpButtons();
            if (!isChecked) {
              updateReadIndicatorUI(null);
            }
            break;
          case "enableBookmarkReplies":
            refreshAllAuthiActions();
            break;
        }
        return;
      } else if (target.matches(".s1p-user-thread-block-toggle")) {
        const userId = target.dataset.userId;
        const blockThreads = target.checked;
        const users = getBlockedUsers();
        if (users[userId]) {
          users[userId].blockThreads = blockThreads;
          saveBlockedUsers(users);
          if (blockThreads) applyUserThreadBlocklist();
          else unblockThreadsByUser(userId);
          renderThreadTab();
        }
      } else if (target.matches("#s1p-blockThreadsOnUserBlock")) {
        const currentSettings = getSettings();
        currentSettings.blockThreadsOnUserBlock = target.checked;
        saveSettings(currentSettings);
      }
    });
    /**
     * [OPTIMIZED] 从UI列表中移除一个项目，并在列表为空时显示提示信息。
     * @param {HTMLElement} triggerElement - 触发删除操作的元素（如按钮）。
     * @param {string} emptyHTML - 当列表为空时，要设置给容器的innerHTML。
     * @param {function} [onEmptyCallback] - 列表变为空后执行的可选回调函数。
     */
    function removeListItem(triggerElement, emptyHTML, onEmptyCallback) {
      const item = triggerElement.closest(".s1p-item");
      if (!item) return;

      const list = item.parentElement;
      item.remove();

      if (list && list.children.length === 0) {
        const container = list.parentElement;
        if (container) {
          container.innerHTML = emptyHTML;
        }
        if (onEmptyCallback) {
          onEmptyCallback(container);
        }
      }
    }

    modal.addEventListener("click", async (e) => {
      const target = e.target;
      if (e.target.matches(".s1p-modal, .s1p-modal-close")) modal.remove();
      if (e.target.matches(".s1p-tab-btn")) {
        const tabContainer = e.target.closest(".s1p-tabs");
        modal
          .querySelectorAll(".s1p-tab-btn, .s1p-tab-content")
          .forEach((el) => el.classList.remove("active"));
        e.target.classList.add("active");
        const activeTab = tabs[e.target.dataset.tab];
        if (activeTab) activeTab.classList.add("active");
        // [新增] 调用函数移动滑块
        moveTabSlider(tabContainer);
      }

      const unblockThreadId = e.target.dataset.unblockThreadId;
      if (unblockThreadId) {
        unblockThread(unblockThreadId);
        removeListItem(
          target,
          '<div class="s1p-empty">暂无手动屏蔽的帖子</div>'
        );
      }

      const unblockUserId = e.target.dataset.unblockUserId;
      if (unblockUserId) {
        // [OPTIMIZED] 深度联动优化，避免重绘帖子列表
        const allBlockedThreads = getBlockedThreads();
        const threadsToUnblock = Object.keys(allBlockedThreads).filter(
          (threadId) =>
            allBlockedThreads[threadId].reason === `user_${unblockUserId}`
        );

        unblockUser(unblockUserId);

        removeListItem(target, '<div class="s1p-empty">暂无屏蔽的用户</div>');

        const threadList = document.querySelector(
          "#s1p-manually-blocked-list-container .s1p-list"
        );
        if (threadList) {
          threadsToUnblock.forEach((threadId) => {
            const threadItemToRemove = threadList.querySelector(
              `.s1p-item[data-thread-id="${threadId}"]`
            );
            threadItemToRemove?.remove();
          });
          if (threadList.children.length === 0) {
            const container = threadList.closest(
              "#s1p-manually-blocked-list-container"
            );
            if (container) {
              container.innerHTML =
                '<div class="s1p-empty">暂无手动屏蔽的帖子</div>';
            }
          }
        }
      }

      const removeBookmarkId = target.closest('[data-action="remove-bookmark"]')
        ?.dataset.postId;
      if (removeBookmarkId) {
        const bookmarks = getBookmarkedReplies();
        delete bookmarks[removeBookmarkId];
        saveBookmarkedReplies(bookmarks);
        refreshSinglePostActions(removeBookmarkId);
        removeListItem(
          target,
          '<div class="s1p-empty">暂无收藏的回复</div>',
          () => {
            // 列表清空后，移除搜索框
            document
              .querySelector("#s1p-bookmark-search-input")
              ?.closest(".s1p-settings-group")
              ?.remove();
          }
        );
      }

      // --- 本地备份与恢复事件 (已优化) ---
      const syncTextarea = modal.querySelector("#s1p-local-sync-textarea");
      if (e.target.id === "s1p-local-export-btn") {
        const dataToExport = await exportLocalData();
        syncTextarea.value = dataToExport;
        syncTextarea.select();
        navigator.clipboard
          .writeText(dataToExport)
          .then(() => {
            showMessage("数据已导出并复制到剪贴板", true);
          })
          .catch(() => {
            showMessage("自动复制失败，请手动复制", false);
          });
      }
      if (e.target.id === "s1p-local-import-btn") {
        const jsonStr = syncTextarea.value.trim();
        if (!jsonStr) return showMessage("请先粘贴要导入的数据", false);
        const result = importLocalData(jsonStr);
        showMessage(result.message, result.success);
        if (result.success) {
          renderThreadTab();
          renderUserTab();
          renderGeneralSettingsTab();
          renderTagsTab();
          renderBookmarksTab();
        }
      }
      if (e.target.id === "s1p-clear-select-all") {
        const isChecked = e.target.checked;
        modal
          .querySelectorAll(".s1p-clear-data-checkbox")
          .forEach((chk) => (chk.checked = isChecked));
      }

      if (e.target.id === "s1p-clear-selected-btn") {
        const selectedKeys = Array.from(
          modal.querySelectorAll(".s1p-clear-data-checkbox:checked")
        ).map((chk) => chk.dataset.clearKey);
        if (selectedKeys.length === 0) {
          return showMessage("请至少选择一个要清除的数据项。", false);
        }

        const itemsToClear = selectedKeys
          .map((key) => `“${dataClearanceConfig[key].label}”`)
          .join("、");
        createConfirmationModal(
          "确认要清除所选数据吗？",
          `即将删除 ${itemsToClear} 的所有数据，此操作不可逆！`,
          () => {
            selectedKeys.forEach((key) => {
              if (dataClearanceConfig[key]) {
                dataClearanceConfig[key].clear();
              }
            });

            if (selectedKeys.includes("settings")) {
              modal.querySelector("#s1p-remote-enabled-toggle").checked = false;
              modal.querySelector(
                "#s1p-daily-first-load-sync-enabled-toggle"
              ).checked = true; // [整合] 重置新开关
              modal.querySelector(
                "#s1p-auto-sync-enabled-toggle"
              ).checked = true;
              modal.querySelector("#s1p-remote-gist-id-input").value = "";
              modal.querySelector("#s1p-remote-pat-input").value = "";
              updateRemoteSyncInputsState();
            }

            // 全局刷新
            hideBlockedThreads();
            hideBlockedUsersPosts();
            applyUserThreadBlocklist();
            hideThreadsByTitleKeyword();
            initializeNavbar();
            applyInterfaceCustomizations();
            document
              .querySelectorAll(".s1p-progress-container")
              .forEach((el) => el.remove());

            // 重新渲染所有标签页
            renderThreadTab();
            renderUserTab();
            renderGeneralSettingsTab();
            renderTagsTab();
            renderBookmarksTab();
            showMessage("选中的本地数据已成功清除。", true);
          },
          "确认清除"
        );
      }

      if (e.target.id === "s1p-remote-save-btn") {
        const button = e.target;
        button.disabled = true;
        button.textContent = "正在保存并测试...";

        const currentSettings = getSettings();
        currentSettings.syncRemoteEnabled = modal.querySelector(
          "#s1p-remote-enabled-toggle"
        ).checked;
        currentSettings.syncDailyFirstLoad = modal.querySelector(
          "#s1p-daily-first-load-sync-enabled-toggle"
        ).checked;
        currentSettings.syncAutoEnabled = modal.querySelector(
          "#s1p-auto-sync-enabled-toggle"
        ).checked;
        currentSettings.syncRemoteGistId = modal
          .querySelector("#s1p-remote-gist-id-input")
          .value.trim();
        currentSettings.syncRemotePat = modal
          .querySelector("#s1p-remote-pat-input")
          .value.trim();

        // 1. 先保存设置，这样后续的 API 调用才能使用最新的凭据
        saveSettings(currentSettings);
        updateNavbarSyncButton();

        try {
          // 2. 只有在 Gist ID 和 PAT 都填写时才执行连通性测试
          if (
            currentSettings.syncRemoteGistId &&
            currentSettings.syncRemotePat
          ) {
            showMessage("设置已保存，正在测试连接...", null);
            await fetchRemoteData(); // 这个函数在失败时会 reject/throw error
            showMessage("连接成功！", true);
          } else {
            // 如果字段不完整，只提示保存成功，不进行测试
            showMessage("远程同步设置已保存。", true);
          }
        } catch (error) {
          // 3. 捕获 fetchRemoteData 抛出的任何错误
          showMessage("连接失败，请检查 Gist ID 和 PAT 是否正确。", false);
          console.error("S1 Plus Sync Connection Test Failed:", error);
        } finally {
          // 4. 无论测试成功与否，最后都恢复按钮的状态
          button.disabled = false;
          button.textContent = "保存设置";
        }
      }

      if (e.target.id === "s1p-remote-manual-sync-btn") {
        handleManualSync();
      }

      if (e.target.id === "s1p-open-gist-page-btn") {
        const gistId = modal
          .querySelector("#s1p-remote-gist-id-input")
          .value.trim();
        if (gistId) {
          GM_openInTab(`https://gist.github.com/${gistId}`, true);
        } else {
          showMessage("请先填写 Gist ID。", false);
        }
      }

      // --- 用户标记标签页专属事件 ---
      const targetTab = target.closest("#s1p-tab-tags");
      if (targetTab) {
        const action = target.dataset.action;
        const userId = target.dataset.userId;

        if (action === "edit-tag-item")
          renderTagsTab({ editingUserId: userId });
        if (action === "cancel-tag-edit") renderTagsTab();
        if (action === "delete-tag-item") {
          const userName = target.dataset.userName;
          createConfirmationModal(
            `确认删除对 "${userName}" 的标记吗?`,
            "此操作不可撤销。",
            () => {
              const tags = getUserTags();
              delete tags[userId];
              saveUserTags(tags);
              refreshUserPostsOnPage(userId);
              removeListItem(
                target,
                `<div class="s1p-empty">暂无用户标记</div>`
              );
              showMessage(`已删除对 ${userName} 的标记。`, true);
            },
            "确认删除"
          );
        } else if (action === "save-tag-edit") {
          const userName = target.dataset.userName;
          const newTag = targetTab
            .querySelector(
              `.s1p-item[data-user-id="${userId}"] .s1p-tag-edit-area`
            )
            .value.trim();
          const tags = getUserTags();
          if (newTag) {
            tags[userId] = {
              ...tags[userId],
              tag: newTag,
              timestamp: Date.now(),
              name: userName,
            };
            saveUserTags(tags);
            refreshUserPostsOnPage(userId);
            renderTagsTab(); // 保存后需要重绘以退出编辑模式
            showMessage(`已更新对 ${userName} 的标记。`, true);
          } else {
            createConfirmationModal(
              `标记内容为空`,
              "您希望删除对该用户的标记吗？",
              () => {
                delete tags[userId];
                saveUserTags(tags);
                refreshUserPostsOnPage(userId);
                renderTagsTab(); // 删除后需要重绘
                showMessage(`已删除对 ${userName} 的标记。`, true);
              },
              "确认删除"
            );
          }
        } else if (target.id === "s1p-export-tags-btn") {
          const textarea = targetTab.querySelector("#s1p-tags-sync-textarea");
          const dataToExport = JSON.stringify(getUserTags(), null, 2);
          textarea.value = dataToExport;
          textarea.select();
          navigator.clipboard
            .writeText(dataToExport)
            .then(() => {
              showMessage("用户标记已导出并复制到剪贴板。", true);
            })
            .catch(() => {
              showMessage("复制失败，请手动复制。", false);
            });
        } else if (target.id === "s1p-import-tags-btn") {
          const textarea = targetTab.querySelector("#s1p-tags-sync-textarea");
          const jsonStr = textarea.value.trim();
          if (!jsonStr) return showMessage("请先粘贴要导入的数据。", false);

          try {
            const imported = JSON.parse(jsonStr);
            if (
              typeof imported !== "object" ||
              imported === null ||
              Array.isArray(imported)
            )
              throw new Error("无效数据格式，应为一个对象。");
            for (const key in imported) {
              const item = imported[key];
              if (
                typeof item !== "object" ||
                item === null ||
                typeof item.tag === "undefined" ||
                typeof item.name === "undefined"
              )
                throw new Error(`用户 #${key} 的数据格式不正确。`);
            }
            createConfirmationModal(
              "确认导入用户标记吗？",
              "导入的数据将覆盖现有相同用户的标记。",
              () => {
                const currentTags = getUserTags();
                const mergedTags = { ...currentTags, ...imported };
                saveUserTags(mergedTags);
                renderTagsTab();
                showMessage(
                  `成功导入/更新 ${Object.keys(imported).length} 条用户标记。`,
                  true
                );
                textarea.value = "";
                refreshAllAuthiActions();
              },
              "确认导入"
            );
          } catch (e) {
            showMessage(`导入失败: ${e.message}`, false);
          }
        }
      }
    });
  };

  /**
   * [OPTIMIZED] 手动同步处理器，解耦UI逻辑并返回布尔值结果。
   * @returns {Promise<boolean|null>} 返回 true 表示成功, false 表示失败, null 表示用户取消操作。
   */
  const handleManualSync = () => {
    return new Promise(async (resolve) => {
      const settings = getSettings();
      if (
        !settings.syncRemoteEnabled ||
        !settings.syncRemoteGistId ||
        !settings.syncRemotePat
      ) {
        showMessage("远程同步未启用或配置不完整。", false);
        return resolve(false);
      }

      showMessage("正在检查云端数据...", null);

      try {
        const rawRemoteData = await fetchRemoteData();

        if (Object.keys(rawRemoteData).length === 0) {
          const pushAction = {
            text: "推送本地数据到云端",
            className: "s1p-confirm",
            action: async () => {
              showMessage("正在向云端推送数据...", null);
              try {
                const localData = await exportLocalDataObject();
                await pushRemoteData(localData);
                GM_setValue("s1p_last_sync_timestamp", Date.now());
                updateLastSyncTimeDisplay();
                showMessage("推送成功！已初始化云端备份。", true);
                resolve(true);
              } catch (e) {
                showMessage(`推送失败: ${e.message}`, false);
                resolve(false);
              }
            },
          };
          const cancelAction = {
            text: "取消",
            className: "s1p-cancel",
            action: () => {
              showMessage("操作已取消。", null);
              resolve(null);
            },
          };
          createAdvancedConfirmationModal(
            "初始化云端同步",
            "<p>检测到云端备份为空，是否将当前本地数据作为初始版本推送到云端？</p>",
            [pushAction, cancelAction]
          );
          return;
        }

        const remote = await migrateAndValidateRemoteData(rawRemoteData);
        const localDataObject = await exportLocalDataObject();

        if (remote.contentHash === localDataObject.contentHash) {
          showMessage("数据已是最新，无需同步。", true);
          GM_setValue("s1p_last_sync_timestamp", Date.now());
          updateLastSyncTimeDisplay();
          return resolve(true);
        }

        const formatForDisplay = (ts) =>
          new Date(ts || 0).toLocaleString("zh-CN", { hour12: false });
        const localNewer = localDataObject.lastUpdated > remote.lastUpdated;
        const isConflict = localDataObject.lastUpdated === remote.lastUpdated;
        let bodyHtml = isConflict
          ? `<p style="color: var(--s1p-red); font-weight: bold;">警告：检测到同步冲突！</p><p>两份数据的时间戳相同但内容不同。请仔细选择您希望保留的版本。</p>`
          : `<p>检测到本地数据与云端备份不一致，请选择同步方式：</p>`;
        bodyHtml += `<div class="s1p-sync-choice-info"><div class="s1p-sync-choice-info-row"><span class="s1p-sync-choice-info-label">本地数据:</span><span class="s1p-sync-choice-info-time ${
          localNewer && !isConflict ? "s1p-sync-choice-newer" : ""
        }">${formatForDisplay(
          localDataObject.lastUpdated
        )}</span></div><div class="s1p-sync-choice-info-row"><span class="s1p-sync-choice-info-label">云端备份:</span><span class="s1p-sync-choice-info-time ${
          !localNewer && !isConflict ? "s1p-sync-choice-newer" : ""
        }">${formatForDisplay(remote.lastUpdated)}</span></div></div>`;

        const pullAction = {
          text: "从云端拉取",
          className: "s1p-confirm",
          action: () => {
            const result = importLocalData(JSON.stringify(remote.full));
            if (result.success) {
              GM_setValue("s1p_last_sync_timestamp", Date.now());
              updateLastSyncTimeDisplay();
              showMessage(`拉取成功！页面即将刷新。`, true);
              setTimeout(() => location.reload(), 1200);
              resolve(true);
            } else {
              showMessage(`导入失败: ${result.message}`, false);
              resolve(false);
            }
          },
        };
        const pushAction = {
          text: "向云端推送",
          className: "s1p-confirm",
          action: async () => {
            try {
              await pushRemoteData(localDataObject);
              GM_setValue("s1p_last_sync_timestamp", Date.now());
              updateLastSyncTimeDisplay();
              showMessage("推送成功！已更新云端备份。", true);
              resolve(true);
            } catch (e) {
              showMessage(`推送失败: ${e.message}`, false);
              resolve(false);
            }
          },
        };
        const cancelAction = {
          text: "取消",
          className: "s1p-cancel",
          action: () => {
            showMessage("操作已取消。", null);
            resolve(null);
          },
        };
        createAdvancedConfirmationModal("手动同步选择", bodyHtml, [
          pullAction,
          pushAction,
          cancelAction,
        ]);
      } catch (error) {
        const corruptionErrorMessage = "云端备份已损坏";
        if (error?.message.includes(corruptionErrorMessage)) {
          const forcePushAction = {
            text: "强制推送，覆盖云端",
            className: "s1p-confirm",
            action: async () => {
              try {
                const localDataObjectForPush = await exportLocalDataObject();
                await pushRemoteData(localDataObjectForPush);
                GM_setValue("s1p_last_sync_timestamp", Date.now());
                updateLastSyncTimeDisplay();
                showMessage("推送成功！已使用本地数据修复云端备份。", true);
                resolve(true);
              } catch (e) {
                showMessage(`强制推送失败: ${e.message}`, false);
                resolve(false);
              }
            },
          };
          const cancelAction = {
            text: "暂不处理",
            className: "s1p-cancel",
            action: () => {
              showMessage("操作已取消。云端备份仍处于损坏状态。", null);
              resolve(null);
            },
          };
          createAdvancedConfirmationModal(
            "检测到云端备份损坏",
            `<p style="color: var(--s1p-red);">云端备份文件校验失败，为保护数据已暂停同步。</p><p>是否用当前健康的本地数据强制覆盖云端损坏的备份？</p>`,
            [forcePushAction, cancelAction]
          );
        } else {
          showMessage(`操作失败: ${error.message}`, false);
          resolve(false);
        }
      }
    });
  };

  const createAdvancedConfirmationModal = (title, bodyHtml, buttons) => {
    document.querySelector(".s1p-confirm-modal")?.remove();
    const modal = document.createElement("div");
    modal.className = "s1p-confirm-modal";

    const footerButtons = buttons
      .map(
        (btn, index) =>
          `<button class="s1p-confirm-btn ${
            btn.className || ""
          }" data-btn-index="${index}">${btn.text}</button>`
      )
      .join("");

    modal.innerHTML = `
            <div class="s1p-confirm-content">
                <div class="s1p-confirm-body">
                    <div class="s1p-confirm-title">${title}</div>
                    <div class="s1p-confirm-subtitle">${bodyHtml}</div>
                </div>
                <div class="s1p-confirm-footer s1p-centered">
                    ${footerButtons}
                </div>
            </div>`;

    const closeModal = () => {
      modal.querySelector(".s1p-confirm-content").style.animation =
        "s1p-scale-out 0.25s ease-out forwards";
      modal.style.animation = "s1p-fade-out 0.25s ease-out forwards";
      setTimeout(() => modal.remove(), 250);
    };

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        const cancelButton = modal.querySelector(".s1p-confirm-btn.s1p-cancel");
        if (cancelButton) {
          cancelButton.click();
        } else {
          closeModal();
        }
      }
    });

    buttons.forEach((btn, index) => {
      const buttonEl = modal.querySelector(`[data-btn-index="${index}"]`);
      if (buttonEl) {
        buttonEl.addEventListener("click", () => {
          if (btn.action) btn.action();
          closeModal();
        });
      }
    });

    document.body.appendChild(modal);
  };

  const addBlockButtonsToThreads = () => {
    // --- [S1PLUS-FIX START] ---
    // 核心修复：注入一个空的表头单元格，以匹配内容行的列数。
    // S1Plus 原脚本会给每个内容行动态添加一个“操作列”单元格，但没有给表头行添加，导致列数不匹配。
    // 此代码通过给表头也添加一个对应的占位单元格，使得结构恢复一致，从而让浏览器能够正确对齐所有列。
    const headerTr = document.querySelector("#threadlisttableid .th tr");
    if (headerTr && !headerTr.querySelector(".s1p-header-placeholder")) {
      const placeholderCell = document.createElement("td");
      placeholderCell.className = "s1p-header-placeholder";
      headerTr.prepend(placeholderCell);
    }
    // --- [S1PLUS-FIX END] ---

    document
      .querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]')
      .forEach((row) => {
        const tr = row.querySelector("tr");
        if (
          !tr ||
          row.querySelector(".s1p-options-cell") ||
          tr.classList.contains("ts") ||
          tr.classList.contains("th")
        )
          return;

        const titleElement = row.querySelector("th a.s.xst");
        if (!titleElement) return;

        const threadId = row.id.replace(/^(normalthread_|stickthread_)/, "");
        const threadTitle = titleElement.textContent.trim();

        const optionsCell = document.createElement("td");
        optionsCell.className = "s1p-options-cell";

        const optionsBtn = document.createElement("div");
        optionsBtn.className = "s1p-options-btn";
        optionsBtn.title = "屏蔽此贴";
        optionsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;

        const optionsMenu = document.createElement("div");
        optionsMenu.className = "s1p-options-menu";
        optionsMenu.innerHTML = `
                <div class="s1p-direct-confirm">
                    <span>屏蔽该帖子吗？</span>
                    <span class="s1p-confirm-separator"></span>
                    <button class="s1p-confirm-action-btn s1p-cancel" title="取消"></button>
                    <button class="s1p-confirm-action-btn s1p-confirm" title="确认屏蔽"></button>
                </div>
            `;

        const cancelBtn = optionsMenu.querySelector(".s1p-cancel");
        const confirmBtn = optionsMenu.querySelector(".s1p-confirm");

        cancelBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          const parentCell = e.currentTarget.closest(".s1p-options-cell");
          if (parentCell) {
            optionsMenu.style.visibility = "hidden";
            optionsMenu.style.opacity = "0";
            parentCell.style.pointerEvents = "none";
            setTimeout(() => {
              optionsMenu.style.removeProperty("visibility");
              optionsMenu.style.removeProperty("opacity");
              parentCell.style.removeProperty("pointer-events");
            }, 200);
          }
        });

        confirmBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          blockThread(threadId, threadTitle);
        });

        optionsCell.appendChild(optionsBtn);
        optionsCell.appendChild(optionsMenu);
        tr.prepend(optionsCell);

        // [S1PLUS-FIX]: 已移除原始的有问题的 colspan 逻辑，它已被上面的表头单元格注入方案彻底取代。

        const separatorRow = document.querySelector("#separatorline > tr.ts");
        if (separatorRow && separatorRow.childElementCount < 6) {
          const emptyTd = document.createElement("td");
          separatorRow.prepend(emptyTd);
        }
      });
  };

  const initializeTaggingPopover = () => {
    let popover = document.getElementById("s1p-tag-popover-main");
    if (!popover) {
      popover = document.createElement("div");
      popover.id = "s1p-tag-popover-main";
      popover.className = "s1p-tag-popover";
      document.body.appendChild(popover);
    }

    let hideTimeout, showTimeout;
    let isComposing = false;

    const startHideTimer = () => {
      if (isComposing) return;
      clearTimeout(showTimeout);
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => popover.classList.remove("visible"), 300);
    };

    const cancelHideTimer = () => clearTimeout(hideTimeout);

    const repositionPopover = (anchorElement) => {
      if (!anchorElement) return;
      const rect = anchorElement.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();

      let top = rect.bottom + window.scrollY + 5;
      let left = rect.left + window.scrollX;

      if (left + popoverRect.width > window.innerWidth - 10) {
        left = window.innerWidth - popoverRect.width - 10;
      }
      if (left < 10) {
        left = 10;
      }

      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
    };

    const renderEditMode = (userName, userId, currentTag = "") => {
      popover.innerHTML = `
                 <div class="s1p-popover-content">
                    <div class="s1p-edit-mode-header">为 ${userName} ${
        currentTag ? "编辑" : "添加"
      }标记</div>
                    <textarea class="s1p-input s1p-textarea s1p-edit-mode-textarea" placeholder="输入标记内容..." autocomplete="off">${currentTag}</textarea>
                    <div class="s1p-edit-mode-actions">
                        <button class="s1p-btn" data-action="cancel-edit">取消</button>
                        <button class="s1p-btn" data-action="save">保存</button>
                    </div>
                </div>`;
      popover.querySelector("textarea").focus();
    };

    const show = (anchorElement, userId, userName) => {
      cancelHideTimer();
      clearTimeout(showTimeout);

      showTimeout = setTimeout(() => {
        popover.dataset.userId = userId;
        popover.dataset.userName = userName;

        const userTags = getUserTags();
        renderEditMode(userName, userId, userTags[userId]?.tag || "");

        popover.classList.add("visible");
        repositionPopover(anchorElement);
      }, 0);
    };

    popover.show = show;

    popover.addEventListener("click", (e) => {
      const target = e.target.closest("button[data-action]");
      if (!target) return;

      const { userId, userName } = popover.dataset;
      const userTags = getUserTags();

      switch (target.dataset.action) {
        case "save":
          const newTag = popover.querySelector("textarea").value.trim();
          if (newTag) {
            userTags[userId] = {
              name: userName,
              tag: newTag,
              timestamp: Date.now(),
            };
          } else {
            delete userTags[userId];
          }
          saveUserTags(userTags);
          refreshUserPostsOnPage(userId);
          popover.classList.remove("visible");
          break;
        case "cancel-edit":
          popover.classList.remove("visible");
          break;
      }
    });

    popover.addEventListener("mouseenter", cancelHideTimer);
    popover.addEventListener("mouseleave", startHideTimer);
    popover.addEventListener("compositionstart", () => (isComposing = true));
    popover.addEventListener("compositionend", () => (isComposing = false));
  };

  const initializeGenericDisplayPopover = () => {
    let popover = document.getElementById("s1p-generic-display-popover");
    if (!popover) {
      popover = document.createElement("div");
      popover.id = "s1p-generic-display-popover";
      popover.className = "s1p-generic-display-popover";
      document.body.appendChild(popover);
    }

    let showTimeout, hideTimeout;

    const show = (anchor, text) => {
      clearTimeout(hideTimeout);
      showTimeout = setTimeout(() => {
        popover.textContent = text;
        const rect = anchor.getBoundingClientRect();

        popover.style.display = "block";
        let top = rect.top + window.scrollY - popover.offsetHeight - 6;
        let left =
          rect.left + window.scrollX + rect.width / 2 - popover.offsetWidth / 2;
        if (top < window.scrollY) {
          top = rect.bottom + window.scrollY + 6;
        }

        if (left < 10) left = 10;
        if (left + popover.offsetWidth > window.innerWidth) {
          left = window.innerWidth - popover.offsetWidth - 10;
        }

        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
        popover.classList.add("visible");
      }, 50);
    };

    const hide = () => {
      clearTimeout(showTimeout);
      hideTimeout = setTimeout(() => {
        popover.classList.remove("visible");
      }, 100);
    };

    // [MODIFIED] Attach API to the element for external use
    if (!popover.s1p_api) {
      popover.s1p_api = { show, hide };
    }

    // Keep existing listeners for user tags
    document.body.addEventListener("mouseover", (e) => {
      const tagDisplay = e.target.closest(".s1p-user-tag-display");
      if (
        tagDisplay &&
        tagDisplay.dataset.fullTag &&
        tagDisplay.scrollWidth > tagDisplay.clientWidth
      ) {
        show(tagDisplay, tagDisplay.dataset.fullTag);
      }
    });

    document.body.addEventListener("mouseout", (e) => {
      const tagDisplay = e.target.closest(".s1p-user-tag-display");
      if (tagDisplay) {
        hide();
      }
    });
  };

  const getTimeBasedColor = (hours) => {
    if (hours <= 1) return "var(--s1p-progress-hot)";
    if (hours <= 24)
      return `rgb(${Math.round(192 - hours * 4)}, ${Math.round(
        51 + hours * 2
      )}, ${Math.round(34 + hours * 2)})`;
    if (hours <= 168)
      return `rgb(${Math.round(100 - (hours - 24) / 3)}, ${Math.round(
        100 + (hours - 24) / 4
      )}, ${Math.round(80 + (hours - 24) / 4)})`;
    return "var(--s1p-progress-cold)";
  };

  const addProgressJumpButtons = () => {
    const settings = getSettings();
    const progressData = getReadProgress();
    if (Object.keys(progressData).length === 0) return;

    const now = Date.now();

    document
      .querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]')
      .forEach((row) => {
        const container = row.querySelector("th");
        if (!container || container.querySelector(".s1p-progress-container"))
          return;

        const threadIdMatch = row.id.match(
          /(?:normalthread_|stickthread_)(\d+)/
        );
        if (!threadIdMatch) return;
        const threadId = threadIdMatch[1];

        const progress = progressData[threadId];
        if (progress && progress.page) {
          const {
            postId,
            page,
            timestamp,
            lastReadFloor: savedFloor,
          } = progress;
          const hoursDiff = (now - (timestamp || 0)) / 3600000;
          const fcolor = getTimeBasedColor(hoursDiff);

          const replyEl = row.querySelector("td.num a.xi2");
          const currentReplies = replyEl
            ? parseInt(replyEl.textContent.replace(/,/g, "")) || 0
            : 0;
          const latestFloor = currentReplies + 1;
          const newReplies =
            savedFloor !== undefined && latestFloor > savedFloor
              ? latestFloor - savedFloor
              : 0;

          const progressContainer = document.createElement("span");
          progressContainer.className = "s1p-progress-container";

          const jumpBtn = document.createElement("a");
          jumpBtn.className = "s1p-progress-jump-btn";
          if (savedFloor) {
            jumpBtn.textContent = `P${page}-#${savedFloor}`;
            jumpBtn.title = `跳转至上次离开的第 ${page} 页，第 ${savedFloor} 楼`;
          } else {
            jumpBtn.textContent = `P${page}`;
            jumpBtn.title = `跳转至上次离开的第 ${page} 页`;
          }

          jumpBtn.href = `forum.php?mod=redirect&goto=findpost&ptid=${threadId}&pid=${postId}`;
          jumpBtn.style.color = fcolor;
          jumpBtn.style.borderColor = fcolor;

          jumpBtn.addEventListener("click", (e) => {
            e.preventDefault();
            if (settings.openProgressInNewTab) {
              GM_openInTab(jumpBtn.href, {
                active: !settings.openProgressInBackground,
              });
            } else {
              window.location.href = jumpBtn.href;
            }
          });
          jumpBtn.addEventListener("mouseover", () => {
            jumpBtn.style.backgroundColor = fcolor;
            jumpBtn.style.color = "var(--s1p-white)";
          });
          jumpBtn.addEventListener("mouseout", () => {
            jumpBtn.style.backgroundColor = "transparent";
            jumpBtn.style.color = fcolor;
          });

          progressContainer.appendChild(jumpBtn);
          if (newReplies > 0) {
            const newRepliesBadge = document.createElement("span");
            newRepliesBadge.className = "s1p-new-replies-badge";
            newRepliesBadge.textContent = `+${newReplies}`;
            newRepliesBadge.title = `有 ${newReplies} 条新回复`;
            newRepliesBadge.style.backgroundColor = fcolor;
            newRepliesBadge.style.borderColor = fcolor;
            progressContainer.appendChild(newRepliesBadge);
            jumpBtn.style.borderTopRightRadius = "0";
            jumpBtn.style.borderBottomRightRadius = "0";
          }

          container.appendChild(progressContainer);
        }
      });
  };

  const updateReadIndicatorUI = (targetPostId) => {
    // [核心修复] 在函数入口处直接检查设置状态
    // 如果开关关闭，则强制将目标ID设为null，这将触发后续的隐藏逻辑
    if (!getSettings().showReadIndicator) {
      targetPostId = null;
    }

    if (!readIndicatorElement) {
      readIndicatorElement = document.createElement("div");
      readIndicatorElement.className = "s1p-read-indicator";
      readIndicatorElement.innerHTML = `
                <span class="s1p-read-indicator-icon"></span>
                <span>当前阅读位置</span>
            `;
    }
    const indicator = readIndicatorElement;
    const currentPostId = currentIndicatorParent
      ?.closest('table[id^="pid"]')
      ?.id.replace("pid", "");

    if (targetPostId === currentPostId) {
      return;
    }

    const oldParentPi = currentIndicatorParent;
    const isVisible = !!currentIndicatorParent;

    if (isVisible) {
      indicator.classList.remove("s1p-anim-appear");
      indicator.classList.add("s1p-anim-disappear");
    }

    setTimeout(
      () => {
        let indicatorWidth = 0;
        if (oldParentPi) {
          const oldPti = oldParentPi.querySelector(".pti");
          if (oldPti) {
            oldPti.style.paddingRight = "";
          }
        }
        if (indicator.parentElement) {
          indicatorWidth = indicator.offsetWidth;
          indicator.parentElement.removeChild(indicator);
        }
        currentIndicatorParent = null;

        if (targetPostId) {
          const postTable = document.getElementById(`pid${targetPostId}`);
          const newParentPi = postTable?.querySelector("td.plc .pi");
          if (newParentPi) {
            if (indicatorWidth === 0) {
              newParentPi.appendChild(indicator);
              indicatorWidth = indicator.offsetWidth;
            }
            const newPti = newParentPi.querySelector(".pti");
            const gap = 8;
            if (newPti && indicatorWidth > 0) {
              newPti.style.paddingRight = `${indicatorWidth + gap}px`;
            }
            if (!indicator.parentElement) {
              newParentPi.appendChild(indicator);
            }
            const floorEl = newParentPi.querySelector("strong");
            const actionsEl = newParentPi.querySelector("#fj");
            const rightOffset =
              (floorEl ? floorEl.offsetWidth : 0) +
              (actionsEl ? actionsEl.offsetWidth : 0) +
              gap;
            indicator.style.right = `${rightOffset}px`;
            currentIndicatorParent = newParentPi;

            indicator.classList.remove("s1p-anim-disappear");
            requestAnimationFrame(() => {
              indicator.classList.add("s1p-anim-appear");
            });
          }
        }
      },
      isVisible ? 300 : 0
    );
  };

  let readIndicatorElement = null;
  let currentIndicatorParent = null;
  let pageObserver = null;

  const trackReadProgressInThread = () => {
    const settings = getSettings();
    if (!settings.enableReadProgress || !document.getElementById("postlist"))
      return;

    let threadId = null;
    const threadIdMatch = window.location.href.match(/thread-(\d+)-/);
    if (threadIdMatch) {
      threadId = threadIdMatch[1];
    } else {
      const params = new URLSearchParams(window.location.search);
      threadId = params.get("tid") || params.get("ptid");
    }
    if (!threadId) {
      const tidInput = document.querySelector('input[name="tid"]#tid');
      if (tidInput) {
        threadId = tidInput.value;
      }
    }
    if (!threadId) return;

    let currentPage = "1";
    const threadPageMatch = window.location.href.match(/thread-\d+-(\d+)-/);
    const params = new URLSearchParams(window.location.search);
    if (threadPageMatch) {
      currentPage = threadPageMatch[1];
    } else if (params.has("page")) {
      currentPage = params.get("page");
    } else {
      const currentPageElement = document.querySelector("div.pg strong");
      if (currentPageElement && !isNaN(currentPageElement.textContent.trim())) {
        currentPage = currentPageElement.textContent.trim();
      }
    }

    // --- [核心修改] 确保 pageObserver 只初始化一次，并能监控后续新增的元素 ---

    // 仅当 pageObserver 未被创建时才创建，确保全局唯一
    if (!pageObserver) {
      let visiblePosts = new Map();
      let saveTimeout;

      const getFloorFromElement = (el) => {
        const floorElement = el.querySelector(".pi em");
        return floorElement ? parseInt(floorElement.textContent) || 0 : 0;
      };

      const saveCurrentProgress = () => {
        if (visiblePosts.size === 0) return;
        let maxFloor = 0;
        let finalPostId = null;

        visiblePosts.forEach((floor, postId) => {
          if (floor > maxFloor) {
            maxFloor = floor;
            finalPostId = postId;
          }
        });

        if (finalPostId && maxFloor > 0) {
          if (getSettings().showReadIndicator) {
            updateReadIndicatorUI(finalPostId);
          }
          updateThreadProgress(threadId, finalPostId, currentPage, maxFloor);
        }
      };

      const debouncedSave = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveCurrentProgress, 1500);
      };

      pageObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const postId = entry.target.id.replace("pid", "");
            if (entry.isIntersecting) {
              const floor = getFloorFromElement(entry.target);
              if (floor > 0) {
                visiblePosts.set(postId, floor);
              }
            } else {
              visiblePosts.delete(postId);
            }
          });
          debouncedSave();
        },
        { threshold: 0.3 }
      );

      const finalSave = () => {
        clearTimeout(saveTimeout);
        saveCurrentProgress();
      };

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          finalSave();
        }
      });
      window.addEventListener("beforeunload", finalSave);
    }

    // [新增] 每次函数运行时（包括页面动态变化后），都检查并添加未被监控的帖子
    document.querySelectorAll('table[id^="pid"]').forEach((el) => {
      // 使用一个自定义属性来避免重复添加监控
      if (!el.dataset.s1pObserved) {
        pageObserver.observe(el);
        el.dataset.s1pObserved = "true";
      }
    });
  };

  const refreshAllAuthiActions = () => {
    document
      .querySelectorAll(".s1p-authi-actions-wrapper")
      .forEach((el) => el.remove());
    addActionsToPostFooter();
  };

  const refreshSinglePostActions = (postId) => {
    const postTable = document.querySelector(`table#pid${postId}`);
    if (!postTable) return;

    const container = postTable.querySelector(".s1p-authi-container");
    if (container) {
      const authiDiv = container.querySelector(".authi");
      if (authiDiv) {
        container.parentElement.insertBefore(authiDiv, container);
      }
      container.remove();
    }
    addActionsToSinglePost(postTable);
  };

  const createOptionsMenu = (anchorElement) => {
    document.querySelector(".s1p-tag-options-menu")?.remove();
    const { userId, userName } = anchorElement.dataset;
    const menu = document.createElement("div");
    menu.className = "s1p-tag-options-menu";
    menu.innerHTML = `
            <button data-action="edit">编辑标记</button>
            <button data-action="delete" class="s1p-delete">删除标记</button>
        `;
    document.body.appendChild(menu);

    const rect = anchorElement.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 2}px`;
    menu.style.left = `${rect.right + window.scrollX - menu.offsetWidth}px`;
    const closeMenu = () => menu.remove();

    menu.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = e.target.dataset.action;

      if (action === "edit") {
        const popover = document.getElementById("s1p-tag-popover-main");
        if (popover && popover.show) {
          popover.show(anchorElement, userId, userName);
        }
        closeMenu();
      } else if (action === "delete") {
        createInlineConfirmMenu(anchorElement, "确认删除？", () => {
          const tags = getUserTags();
          delete tags[userId];
          saveUserTags(tags);
          refreshUserPostsOnPage(userId);
        });
        closeMenu();
      }
    });

    setTimeout(() => {
      document.addEventListener("click", closeMenu, { once: true });
    }, 0);
  };

  /**
   * [OPTIMIZED V2] Adds action buttons and layout spacer to a single post.
   * @param {HTMLTableElement} postTable - The main table element for a single post.
   */
  const addActionsToSinglePost = (postTable) => {
    const settings = getSettings();
    const authiDiv = postTable.querySelector(".plc .authi");
    if (!authiDiv) return;

    // --- [核心修改] 将 pi 容器作为操作目标 ---
    const piContainer = authiDiv.closest(".pi");
    if (!piContainer) return;

    // --- [这里是新增的“伸缩器”逻辑] ---
    // 检查并添加永久的布局伸缩器，确保布局稳定
    if (!piContainer.querySelector(".s1p-layout-spacer")) {
      const spacer = document.createElement("div");
      spacer.className = "s1p-layout-spacer";
      piContainer.appendChild(spacer);
    }
    // --- [新增逻辑结束] ---

    if (authiDiv.parentElement.classList.contains("s1p-authi-container")) {
      return;
    }

    const plsCell = postTable.querySelector("td.pls");
    if (!plsCell) return;
    const userProfileLink = plsCell.querySelector('a[href*="space-uid-"]');
    if (!userProfileLink) return;
    const uidMatch = userProfileLink.href.match(/space-uid-(\d+)\.html/);
    const userId = uidMatch ? uidMatch[1] : null;
    if (!userId) return;

    const postId = postTable.id.replace("pid", "");
    const floorElement = postTable.querySelector(`#postnum${postId} em`);
    const floor = floorElement ? parseInt(floorElement.textContent, 10) : 0;
    const userName = userProfileLink.textContent.trim();
    const userAvatar = plsCell.querySelector(".avatar img")?.src;

    const newContainer = document.createElement("div");
    newContainer.className = "s1p-authi-container";
    const scriptActionsWrapper = document.createElement("span");
    scriptActionsWrapper.className = "s1p-authi-actions-wrapper";

    if (settings.enableBookmarkReplies) {
      const bookmarkedReplies = getBookmarkedReplies();
      const isBookmarked = !!bookmarkedReplies[postId];
      const pipe = document.createElement("span");
      pipe.className = "pipe";
      pipe.textContent = "|";
      scriptActionsWrapper.appendChild(pipe);
      const bookmarkLink = document.createElement("a");
      bookmarkLink.href = "javascript:void(0);";
      bookmarkLink.className = "s1p-authi-action s1p-bookmark-reply";
      bookmarkLink.textContent = isBookmarked ? "该回复已收藏" : "收藏该回复";
      bookmarkLink.addEventListener("click", (e) => {
        e.preventDefault();
        const currentBookmarks = getBookmarkedReplies();
        const wasBookmarked = !!currentBookmarks[postId];
        if (wasBookmarked) {
          delete currentBookmarks[postId];
          saveBookmarkedReplies(currentBookmarks);
          bookmarkLink.textContent = "收藏该回复";
          showMessage("已取消收藏该回复。", true);
        } else {
          const threadTitleEl = document.querySelector("#thread_subject");
          const threadTitle = threadTitleEl
            ? threadTitleEl.textContent.trim()
            : "未知标题";
          const threadIdMatch = window.location.href.match(/thread-(\d+)-/);
          const params = new URLSearchParams(window.location.search);
          const threadId = threadIdMatch
            ? threadIdMatch[1]
            : params.get("tid") || params.get("ptid");
          const contentEl = postTable.querySelector("td.t_f");

          let postContent = "无法获取内容";
          if (contentEl) {
            const contentClone = contentEl.cloneNode(true);
            contentClone
              .querySelectorAll(
                ".pstatus, .quote, .s1p-image-toggle-all-container"
              )
              .forEach((el) => el.remove());
            postContent = contentClone.innerText
              .trim()
              .replace(/\n{3,}/g, "\n\n");
          }

          if (!threadId) {
            showMessage("无法获取帖子ID，收藏失败。", false);
            return;
          }
          currentBookmarks[postId] = {
            postId,
            threadId,
            threadTitle,
            floor,
            authorId: userId,
            authorName: userName,
            postContent: postContent,
            timestamp: Date.now(),
          };
          saveBookmarkedReplies(currentBookmarks);
          bookmarkLink.textContent = "该回复已收藏";
          showMessage("已收藏该回复。", true);
        }
      });
      scriptActionsWrapper.appendChild(bookmarkLink);
    }

    if (settings.enableUserBlocking) {
      const pipe = document.createElement("span");
      pipe.className = "pipe";
      pipe.textContent = "|";
      scriptActionsWrapper.appendChild(pipe);
      const blockLink = document.createElement("a");
      blockLink.href = "javascript:void(0);";
      blockLink.textContent = "屏蔽该用户";
      blockLink.className = "s1p-authi-action s1p-block-user-in-authi";
      blockLink.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const confirmText = getSettings().blockThreadsOnUserBlock
          ? `屏蔽用户并隐藏其主题帖？`
          : `确认屏蔽该用户？`;
        createInlineConfirmMenu(e.currentTarget, confirmText, () =>
          blockUser(userId, userName)
        );
      });
      scriptActionsWrapper.appendChild(blockLink);
    }

    if (settings.enableUserTagging) {
      const userTags = getUserTags();
      const userTag = userTags[userId];
      const pipe = document.createElement("span");
      pipe.className = "pipe";
      pipe.textContent = "|";
      scriptActionsWrapper.appendChild(pipe);
      if (userTag && userTag.tag) {
        const tagContainer = document.createElement("span");
        tagContainer.className = "s1p-authi-action s1p-user-tag-container";
        const fullTagText = userTag.tag;
        const tagDisplay = document.createElement("span");
        tagDisplay.className = "s1p-user-tag-display";
        tagDisplay.textContent = `用户标记：${fullTagText}`;
        tagDisplay.dataset.fullTag = fullTagText;
        tagDisplay.removeAttribute("title");
        const optionsIcon = document.createElement("span");
        optionsIcon.className = "s1p-user-tag-options";
        optionsIcon.innerHTML = "&#8942;";
        optionsIcon.dataset.userId = userId;
        optionsIcon.dataset.userName = userName;
        optionsIcon.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          createOptionsMenu(e.currentTarget);
        });
        tagContainer.appendChild(tagDisplay);
        tagContainer.appendChild(optionsIcon);
        scriptActionsWrapper.appendChild(tagContainer);
      } else {
        const tagLink = document.createElement("a");
        tagLink.href = "javascript:void(0);";
        tagLink.textContent = "标记该用户";
        tagLink.className = "s1p-authi-action s1p-tag-user-in-authi";
        tagLink.addEventListener("click", (e) => {
          e.preventDefault();
          const popover = document.getElementById("s1p-tag-popover-main");
          if (popover && popover.show) {
            popover.show(e.currentTarget, userId, userName, userAvatar);
          }
        });
        scriptActionsWrapper.appendChild(tagLink);
      }
    }

    if (scriptActionsWrapper.hasChildNodes()) {
      authiDiv.parentElement.insertBefore(newContainer, authiDiv);
      newContainer.appendChild(authiDiv);
      newContainer.appendChild(scriptActionsWrapper);
    }
  };

  const addActionsToPostFooter = () => {
    const settings = getSettings();
    if (
      !settings.enableUserBlocking &&
      !settings.enableUserTagging &&
      !settings.enableBookmarkReplies
    )
      return;
    document
      .querySelectorAll('table[id^="pid"]')
      .forEach(addActionsToSinglePost);
  };

  function autoSign() {
    const checkinLink = document.querySelector(
      'a[href*="study_daily_attendance-daily_attendance.html"]'
    );
    if (!checkinLink) return;

    var now = new Date();
    var date =
      now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
    var signedDate = GM_getValue("signedDate");

    if (signedDate == date) {
      checkinLink.style.display = "none";
      return;
    }

    if (now.getHours() < 6) return;

    GM_xmlhttpRequest({
      method: "GET",
      url: checkinLink.href,
      onload: function (response) {
        GM_setValue("signedDate", date);
        checkinLink.style.display = "none";
        console.log(
          "S1 Plus: Auto check-in request sent. Status:",
          response.status
        );
      },
      onerror: function (response) {
        console.error("S1 Plus: Auto check-in request failed.", response);
      },
    });
  }
  // [修改] 将设置项重命名为 enhanceFloatingControls
  const createCustomFloatingControls = () => {
    // 1. 如果自定义控件已存在，则直接退出
    if (document.getElementById("s1p-controls-wrapper")) {
      return;
    }

    // 2. 从原生 #scrolltop 控件中搜集信息
    const originalContainer = document.getElementById("scrolltop");
    let replyAction = null;
    let returnAction = null;
    if (originalContainer) {
      const replyLink = originalContainer.querySelector("a.replyfast");
      if (replyLink) {
        replyAction = {
          href: replyLink.href,
          onclick: replyLink.onclick,
          title: replyLink.title,
        };
      }
      const returnLink = originalContainer.querySelector(
        "a.returnboard, a.returnlist"
      );
      if (returnLink) {
        returnAction = { href: returnLink.href, title: returnLink.title };
      }
    }

    // 3. 定义SVG图标
    const svgs = {
      scrollTop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 13.9142L16.7929 18.7071L18.2071 17.2929L12 11.0858L5.79289 17.2929L7.20711 18.7071L12 13.9142ZM6 7L18 7V9L6 9L6 7Z"></path></svg>`,
      scrollBottom: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.0858L7.20711 5.29291L5.79289 6.70712L12 12.9142L18.2071 6.70712L16.7929 5.29291L12 10.0858ZM18 17L6 17L6 15L18 15V17Z"></path></svg>`,
      reply: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M14 22.5L11.2 19H6C5.44772 19 5 18.5523 5 18V7.10256C5 6.55028 5.44772 6.10256 6 6.10256H22C22.5523 6.10256 23 6.55028 23 7.10256V18C23 18.5523 22.5523 19 22 19H16.8L14 22.5ZM15.8387 17H21V8.10256H7V17H11.2H12.1613L14 19.2984L15.8387 17ZM2 2H19V4H3V15H1V3C1 2.44772 1.44772 2 2 2Z"></path></svg>`,
      board: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4C2 3.44772 2.44772 3 3 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4ZM4 5V19H20V5H4ZM6 7H8V9H6V7ZM8 11H6V13H8V11ZM6 15H8V17H6V15ZM18 7H10V9H18V7ZM10 15H18V17H10V15ZM18 11H10V13H18V11Z"></path></svg>`,
    };

    // 4. 创建DOM结构
    const wrapper = document.createElement("div");
    wrapper.id = "s1p-controls-wrapper";
    // [核心修改] 读取新命名的设置并添加对应的class
    const settings = getSettings();
    if (settings.enhanceFloatingControls) {
      wrapper.classList.add("s1p-hover-interaction-enabled");
    }

    const handle = document.createElement("div");
    handle.id = "s1p-controls-handle";

    const panel = document.createElement("div");
    panel.id = "s1p-floating-controls";

    // 5. 创建按钮并添加到 panel 中
    const createButton = (title, className, svg, href, onclick) => {
      const link = document.createElement("a");
      link.title = title;
      link.className = className;
      link.innerHTML = svg;
      if (href) link.href = href;
      if (onclick) link.onclick = onclick;
      return link;
    };

    if (replyAction) {
      panel.appendChild(
        createButton(
          replyAction.title,
          "",
          svgs.reply,
          replyAction.href,
          replyAction.onclick
        )
      );
    }
    const scrollTopBtn = createButton(
      "返回顶部",
      "s1p-scroll-btn",
      svgs.scrollTop,
      "javascript:void(0);",
      (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    );
    const scrollBottomBtn = createButton(
      "返回底部",
      "s1p-scroll-btn",
      svgs.scrollBottom,
      "javascript:void(0);",
      (e) => {
        e.preventDefault();
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      }
    );
    panel.appendChild(scrollTopBtn);
    panel.appendChild(scrollBottomBtn);
    if (returnAction) {
      panel.appendChild(
        createButton(
          returnAction.title,
          "",
          svgs.board,
          returnAction.href,
          null
        )
      );
    }

    // 6. 组装并添加到页面
    wrapper.appendChild(panel);
    wrapper.appendChild(handle);
    document.body.appendChild(wrapper);
  };

  const cleanupOldReadProgress = () => {
    const settings = getSettings();
    if (
      !settings.readingProgressCleanupDays ||
      settings.readingProgressCleanupDays <= 0
    )
      return;
    const progress = getReadProgress();
    const originalCount = Object.keys(progress).length;
    if (originalCount === 0) return;

    const now = Date.now();
    const maxAge = settings.readingProgressCleanupDays * 24 * 60 * 60 * 1000;
    const cleanedProgress = {};
    let cleanedCount = 0;

    for (const threadId in progress) {
      if (Object.prototype.hasOwnProperty.call(progress, threadId)) {
        const record = progress[threadId];
        if (record.timestamp && now - record.timestamp < maxAge) {
          cleanedProgress[threadId] = record;
        } else {
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(
        `S1 Plus: Cleaned up ${cleanedCount} old reading progress records (older than ${settings.readingProgressCleanupDays} days).`
      );
      saveReadProgress(cleanedProgress);
    }
  };

  /**
   * [整合版] 脚本启动时的同步总控制器。
   * [优化 v3] 优化了冲突处理方式，使用阻塞式对话框主动引导用户解决。
   * @returns {Promise<boolean>} - 返回 true 表示页面即将刷新，主流程应中断。
   */
  const handleStartupSync = async () => {
    const settings = getSettings();
    if (!settings.syncRemoteEnabled) {
      return false; // 总开关未开，直接跳过所有启动同步。
    }

    // --- 跨标签页同步锁 ---
    const SYNC_LOCK_KEY = "s1p_sync_lock";
    const SYNC_LOCK_TIMEOUT_MS = 60 * 1000; // 为锁设置1分钟的超时，防止因标签页崩溃导致死锁。

    const today = new Date().toLocaleDateString("sv");
    const lastSyncDate = GM_getValue("s1p_last_daily_sync_date", null);

    if (settings.syncDailyFirstLoad && today !== lastSyncDate) {
      const lockTimestamp = GM_getValue(SYNC_LOCK_KEY, 0);
      if (Date.now() - lockTimestamp < SYNC_LOCK_TIMEOUT_MS) {
        console.log(
          "S1 Plus: 检测到另一个标签页可能正在同步，本次启动同步已跳过。"
        );
        return false;
      }

      GM_setValue(SYNC_LOCK_KEY, Date.now());

      try {
        const currentDateAfterLock = GM_getValue(
          "s1p_last_daily_sync_date",
          null
        );
        if (currentDateAfterLock === today) {
          console.log("S1 Plus: 在锁定期间检测到同步已完成，已取消重复操作。");
          return false;
        }

        console.log("S1 Plus: 正在执行每日首次加载同步...");
        showMessage("S1 Plus: 正在执行每日首次自动同步...", null);
        GM_setValue("s1p_last_daily_sync_date", today);

        const result = await performAutoSync();

        switch (result.status) {
          case "success":
            if (result.action === "pulled") {
              showMessage("每日同步完成，正在刷新页面以应用最新数据...", true);
              setTimeout(() => location.reload(), 1500);
              return true;
            } else {
              showMessage("每日首次同步完成。", true);
            }
            break;
          case "failure":
            showMessage(`每日首次同步失败: ${result.error}`, false);
            break;

          // --- [修复] 冲突处理优化 ---
          case "conflict":
            // 使用已有的 createAdvancedConfirmationModal 函数来创建一个阻塞式对话框
            createAdvancedConfirmationModal(
              "检测到同步冲突",
              "<p>S1 Plus在自动同步时发现，您的本地数据和云端备份可能都已更改。</p><p>为防止数据丢失，自动同步已暂停。请手动选择要保留的版本来解决冲突。</p>",
              [
                {
                  text: "稍后处理",
                  className: "s1p-cancel",
                  action: () => {
                    // 如果用户选择稍后处理，给一个标准的提示
                    showMessage("同步已暂停，您可以在设置中手动同步。", null);
                  },
                },
                {
                  text: "立即解决",
                  className: "s1p-confirm",
                  action: () => {
                    // 调用现有的手动同步函数，它已经内置了完整的冲突解决UI（推送/拉取选择）
                    handleManualSync();
                  },
                },
              ]
            );
            break;
          // --- [修复结束] ---
        }
      } finally {
        GM_deleteValue(SYNC_LOCK_KEY);
        console.log("S1 Plus: 同步锁已释放。");
      }
      return false;
    }

    // --- 逻辑2: 如果不执行每日同步，则回退到原有的“自动后台同步”的启动检查 ---
    if (settings.syncAutoEnabled) {
      console.log("S1 Plus: 执行常规启动时同步检查...");
      const result = await performAutoSync();
      if (result.status === "success" && result.action === "pulled") {
        showMessage("检测到云端有更新，正在刷新页面...", true);
        setTimeout(() => location.reload(), 1500);
        return true;
      }
    }

    return false;
  };

  // [S1 PLUS 整合版]
  // --- 优点: 采纳了 kyo 方案的中断逻辑，当页面需要刷新时，停止后续无效操作，提升效率。
  // --- [FIX] 增强了 MutationObserver，使其能够监测并修复因执行时机问题而被重置的导航栏，解决启动同步时的UI Bug。

  // --- 主流程 ---
  async function main() {
    // [整合] 首先执行启动同步逻辑，并根据结果决定是否中断
    const isReloading = await handleStartupSync();
    if (isReloading) {
      return; // 如果页面即将刷新，则中断后续所有脚本初始化操作
    }

    cleanupOldReadProgress();

    detectS1Nux();
    initializeNavbar();
    initializeGenericDisplayPopover();
    applyThemeOverrideStyle(); // <-- [新增] 启动时应用主题样式

    // --- [FIXED] 增强的 MutationObserver 逻辑 ---
    const observerCallback = (mutations, observer) => {
      // 检查我们的自定义导航链接是否意外消失。
      // 这是判断导航栏是否被（因任何原因）重置的最可靠方法。
      const navNeedsReinit = !document.getElementById("s1p-nav-link");

      // 在我们修改 DOM 之前，先断开观察，防止无限循环。
      observer.disconnect();

      // 如果导航栏需要重新初始化，则执行它，进行“自我修复”。
      if (navNeedsReinit) {
        console.log("S1 Plus: 检测到导航栏被重置，正在重新应用自定义设置。");
        initializeNavbar();
      }

      // 运行常规的内容变化应用函数。
      applyChanges();

      // 将观察器重新附加到更高层级的父元素上，以确保能监听到包括导航栏在内的所有变化。
      const watchTarget = document.getElementById("wp") || document.body;
      observer.observe(watchTarget, { childList: true, subtree: true });
    };

    const observer = new MutationObserver(observerCallback);

    // 首次加载时，应用所有动态内容变更。
    applyChanges();

    // 开始观察，目标是包含导航栏和内容区的父元素#wp。
    const watchTarget = document.getElementById("wp") || document.body;
    observer.observe(watchTarget, { childList: true, subtree: true });
  }
  // --- [新增] 悬浮控件管理器 ---
  const manageFloatingControls = () => {
    const settings = getSettings();
    // 根据设置，切换body上的class，从而激活不同的CSS规则
    document.body.classList.toggle(
      "s1p-enhanced-controls-active",
      settings.enhanceFloatingControls
    );

    if (settings.enhanceFloatingControls) {
      // 如果设置为开启，则调用创建函数（它内部有防重复机制）
      createCustomFloatingControls();
    } else {
      // 如果设置为关闭，则确保移除脚本创建的控件
      document.getElementById("s1p-controls-wrapper")?.remove();
    }
  };
  // [修改] 调用新的控件管理器，不再直接创建控件
  function applyChanges() {
    const settings = getSettings();

    manageFloatingControls(); // <-- [核心修改]

    if (settings.enablePostBlocking) {
      hideBlockedThreads();
      hideThreadsByTitleKeyword();
      addBlockButtonsToThreads();
      applyUserThreadBlocklist();
    }
    if (settings.enableUserBlocking) {
      hideBlockedUsersPosts();
      hideBlockedUserQuotes();
      hideBlockedUserRatings();
    }
    if (
      settings.enableUserBlocking ||
      settings.enableUserTagging ||
      settings.enableBookmarkReplies
    ) {
      addActionsToPostFooter();
    }
    if (settings.enableUserTagging) {
      initializeTaggingPopover();
    }
    if (settings.enableReadProgress) {
      addProgressJumpButtons();
    }
    applyDeleteButtonThemeStyle();
    applyInterfaceCustomizations();
    applyImageHiding();
    manageImageToggleAllButtons();
    renameAuthorLinks();
    applyThreadLinkBehavior();
    applyPageLinkBehavior();
    trackReadProgressInThread();
    try {
      autoSign();
    } catch (e) {
      console.error("S1 Plus: Error caught while running autoSign():", e);
    }
  }

  main();
})();
