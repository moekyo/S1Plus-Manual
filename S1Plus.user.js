// ==UserScript==
// @name         S1 Plus - Stage1st 体验增强套件
// @namespace    http://tampermonkey.net/
// @version      4.6.0
// @description  为Stage1st论坛提供帖子/用户屏蔽、导航栏自定义、自动签到、阅读进度跟踪等多种功能，全方位优化你的论坛体验。
// @author       moekyo
// @match        https://stage1st.com/2b/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';


    const SCRIPT_VERSION = '4.6.0';
    const SCRIPT_RELEASE_DATE = '2025-08-28';

    // --- 样式注入 ---
    GM_addStyle(`
       /* --- 通用颜色 --- */
        :root {
            /* -- 基础调色板 -- */
            --s1p-bg: #ECEDEB;
            --s1p-pri: #D1D9C1;
            --s1p-sub: #e9ebe8;
            --s1p-input-bg: #d1d5db;
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
            --s1p-secondary-hover-bg: #d1d5db;
            --s1p-code-bg: #eee;

            /* -- 阅读进度 -- */
            --s1p-progress-hot: rgb(192, 51, 34);
            --s1p-progress-cold: rgb(107, 114, 128);
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
        /* [FIXED] 移除了时间戳的背景色、边距和圆角 */
        .s1p-sync-choice-info-time {
            font-family: monospace, sans-serif;
        }
        .s1p-sync-choice-newer {
            color: var(--s1p-success-text);
            font-weight: bold;
        }
        
        /* --- [NEW] 提示框样式 --- */
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

        /* --- [NEW] 滑块式分段控件样式 --- */
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
            height: calc(100% - 4px);
            background-color: var(--s1p-sec);
            border-radius: 5px;
            box-shadow: 0 1px 3px rgba(var(--s1p-black-rgb), 0.1);
            transition: all 0.25s ease-in-out;
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
            transition: color 0.25s ease-in-out, background-color 0.2s ease-in-out; /* [修改] 增加背景色过渡 */
            font-size: 13px;
            line-height: 1.5;
            white-space: nowrap;
            border-radius: 4px; /* [新增] 为选项本身也增加圆角，使其在悬停时更好看 */
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


        /* --- 核心修复：禁用论坛自带的用户信息悬浮窗 --- */
        #p_pop { display: none !important; }

        /* --- [FIX] 核心修复：解决主题帖作者栏布局与点击问题 --- */
        .pi { overflow: hidden; }
        .pi > .pti { position: relative; z-index: 1; }

        /* --- [FIX] 修正 .pti 背景遮挡“电梯直达”和“楼主”链接的问题 --- */
        .pi > #fj,
        .pi > strong {
            position: relative;
            z-index: 2;
        }

        /* --- [S1P-FIX] 减小帖子图标与左侧的间距 --- */
        #threadlisttableid td.icn {
            padding-left: 2px !important;
        }


        /* --- 关键字屏蔽样式 --- */
        .s1p-hidden-by-keyword, .s1p-hidden-by-quote { display: none !important; }

        /* --- 按钮通用样式 --- */
        .s1p-btn { display: inline-flex; align-items: center; justify-content: center; padding: 5px 10px 5px 12px; border-radius: 4px; background-color: var(--s1p-sub); color: var(--s1p-t); font-size: 14px; font-weight: bold; cursor: pointer; user-select: none; white-space: nowrap; border: 1px solid var(--s1p-pri); transition: all 0.2s ease-in-out;}
        .s1p-btn:hover { background-color: var(--s1p-sub-h); color: var(--s1p-sub-h-t); border-color: var(--s1p-sub-h); }
        .s1p-red-btn { background-color: var(--s1p-red); color: var(--s1p-white); border-color: var(--s1p-red); }
        .s1p-red-btn:hover { background-color: var(--s1p-red-h); border-color: var(--s1p-red-h); }
        
        /* --- [MODIFIED] 帖子操作按钮 (三点图标) --- */
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
            opacity: 0.4; /* <<< 新增：默认状态为40%透明度 */
            transition: background-color 0.2s ease, color 0.2s ease, opacity 0.2s ease; /* <<< 修改：为透明度增加过渡动画 */
        }

        .s1p-options-cell:hover .s1p-options-btn {
            background-color: var(--s1p-pri);
            color: var(--s1p-t);
            opacity: 1; /* <<< 新增：悬停时恢复为100%不透明 */
        }

        /* --- [MODIFIED] 帖子操作弹出菜单 --- */
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
        
        /* --- [NEW] 直接确认UI --- */
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
        
        /* --- [MODIFIED] 行内确认菜单样式 (带动画) --- */
        .s1p-inline-confirm-menu {
            transform: translateY(0) !important; /* 覆盖继承的transform */
            margin-left: 0 !important;
            z-index: 10004; /* Higher than other popovers */
            
            /* 动画初始状态 */
            opacity: 0;
            transform: translateX(-8px) scale(0.95) !important;
            transition: opacity 0.15s ease-out, transform 0.15s ease-out;
            pointer-events: none;
            /* 覆盖继承的 visibility，让 opacity 来控制 */
            visibility: visible !important;
        }

        .s1p-inline-confirm-menu.visible {
            /* 动画结束状态 */
            opacity: 1;
            transform: translateX(0) scale(1) !important;
            pointer-events: auto;
        }

        /* [MODIFIED] 阅读进度UI样式 */
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

        /* --- 文本框基础样式 --- */
        .s1p-textarea {
            background: var(--s1p-input-bg);
            border: 1px solid var(--s1p-pri);
            border-radius: 8px;
            padding: 8px;
            font-size: 14px;
            resize: vertical;
            box-sizing: border-box;
        }

        /* --- [MODIFIED] 用户标记悬浮窗 (Style Revamp per Image 2) --- */
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
            width: 100%;
            height: 90px;
            margin-bottom: 12px;
        }
        .s1p-edit-mode-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        /* --- [NEW] 用户标记显示悬浮窗 --- */
        .s1p-tag-display-popover {
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
        .s1p-tag-display-popover.visible {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }

        /* --- [NEW] Authi User Tag Display --- */
        .authi {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
        }
        .s1p-authi-actions-wrapper {
            display: inline-flex;
            align-items: center;
            vertical-align: middle;
        }
        .s1p-user-tag-container {
            display: inline-flex;
            align-items: center;
            vertical-align: middle;
            border-radius: 6px;
            overflow: hidden;
        }
        .s1p-user-tag-display {
            background-color: var(--s1p-sub);
            color: var(--s1p-t);
            padding: 2px 8px;
            font-size: 12px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: default;
        }
        .s1p-user-tag-options {
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: var(--s1p-sub);
            color: var(--s1p-t);
            font-size: 14px;
            font-weight: bold;
            padding: 0 8px;
            flex-shrink: 0;
            align-self: stretch;
            cursor: pointer;
            transition: background-color 0.2s ease-in-out;
        }
        .s1p-user-tag-options:hover {
            background-color: var(--s1p-pri);
        }

        /* --- [NEW] Tag Options Menu --- */
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
        .s1p-modal-body { padding: 0 16px 16px; overflow-y: auto; flex-grow: 1; }
        .s1p-modal-footer { padding: 12px 16px; border-top: 1px solid var(--s1p-pri); text-align: right; font-size: 12px; }
        .s1p-tabs { display: flex; border-bottom: 1px solid var(--s1p-pri); }
        .s1p-tab-btn { padding: 12px 16px; cursor: pointer; border: none; background-color: transparent; font-size: 14px; border-bottom: 2px solid transparent; transition: all 0.2s; }
        .s1p-tab-btn.active { color: var(--s1p-sec); border-bottom-color: var(--s1p-sec); font-weight: 500; }
        .s1p-tab-content { display: none; padding-top: 16px; }
        .s1p-tab-content.active { display: block; }
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

        /* --- [OPTIMIZED] 悬浮提示框 (Toast Notification) V2 --- */
        /* 新增一个抖动动画的定义 */
        @keyframes s1p-toast-shake {
            10%, 90% { transform: translate(-51%, 0); }
            20%, 80% { transform: translate(-49%, 0); }
            30%, 50%, 70% { transform: translate(-52%, 0); }
            40%, 60% { transform: translate(-48%, 0); }
        }

        .s1p-toast-notification {
            position: absolute;
            /* 核心改动：定位到屏幕底部中央 */
            left: 50%;
            bottom: 15px; /* [修改] 调整与面板底部的距离 */
            /* 初始位置在屏幕外，为向上滑入动画做准备 */
            transform: translate(-50%, 50px);
            z-index: 10005;
            padding: 10px 18px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            color: var(--s1p-white);
            background-color: #323232; /* 默认使用一个深灰色背景 */
            box-shadow: 0 4px 12px rgba(var(--s1p-black-rgb), 0.15);
            opacity: 0;
            transition: opacity 0.3s ease-out, transform 0.3s ease-out;
            pointer-events: none;
            white-space: nowrap;
            text-align: center;
        }
        .s1p-toast-notification.visible {
            opacity: 1;
            /* 最终位置 */
            transform: translate(-50%, 0);
        }
        .s1p-toast-notification.success {
            background-color: #27da80; /* 成功状态使用绿色 */
        }
        .s1p-toast-notification.error {
            background-color: var(--s1p-red); /* 失败状态使用红色 */
        }
        /* 核心改动：为可见的错误提示应用抖动动画 */
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
        /* [MODIFIED] 恢复默认的靠右对齐 */
        .s1p-confirm-footer { padding: 12px 24px 20px; display: flex; justify-content: flex-end; gap: 12px; }
        /* [NEW] 为需要居中的弹窗（如手动同步）提供单独的居中样式 */
        .s1p-confirm-footer.s1p-centered { justify-content: center; }
        .s1p-confirm-btn { padding: 9px 14px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: all 0.15s ease-in-out; box-shadow: 0 1px 2px 0 rgba(var(--s1p-black-rgb), 0.05); white-space: nowrap; }
        .s1p-confirm-btn:active { transform: translateY(1px); }
        .s1p-confirm-btn.s1p-cancel { background-color: var(--s1p-sub); border-color: var(--s1p-pri); }
        .s1p-confirm-btn.s1p-cancel:hover { border-color: var(--s1p-t); }
        .s1p-confirm-btn.s1p-confirm { background-color: var(--s1p-red); color: var(--s1p-white); border-color: var(--s1p-red); }
        .s1p-confirm-btn.s1p-confirm:hover { background-color: var(--s1p-red-h); border-color: var(--s1p-red-h); }

        /* --- Collapsible Section --- */
        .s1p-collapsible-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; transition: color 0.2s ease; }
        .s1p-settings-group-title.s1p-collapsible-header { margin-bottom: 0; }
        .s1p-collapsible-header:hover { color: var(--s1p-sec); }
        .s1p-collapsible-header:hover .s1p-expander-arrow { color: var(--s1p-sec); }
        .s1p-expander-arrow {
            display: inline-block; width: 12px; height: 12px; color: var(--s1p-icon-arrow);
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 16'%3E%3Cpath d='M2 2L8 8L2 14' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E");
            background-repeat: no-repeat; background-position: center; background-size: contain; transition: transform 0.3s ease-in-out, color 0.2s ease;
        }
        .s1p-expander-arrow.expanded { transform: rotate(90deg); }
        .s1p-collapsible-content { max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out; }
        .s1p-collapsible-content.expanded { max-height: 500px; transition: max-height 0.4s ease-in; padding-top: 12px; }

        /* --- [NEW] Feature Content Animation --- */
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
        .s1p-settings-item .s1p-title-suffix-input { background: var(--s1p-bg); width: 100%; border: 1px solid var(--s1p-pri); border-radius: 4px; padding: 6px 8px; font-size: 14px; box-sizing: border-box; }
        .s1p-settings-label { font-size: 14px; }
        .s1p-settings-checkbox { /* Handled by .s1p-switch */ }
        .s1p-setting-desc { font-size: 12px; color: var(--s1p-desc-t); margin: -4px 0 12px 0; padding: 0; line-height: 1.5; }
        .s1p-editor-item { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 6px; border-radius: 4px; background: var(--s1p-bg); }
        .s1p-editor-item input[type="text"], .s1p-settings-item select { background: var(--s1p-bg);  width: 100%; border: 1px solid var(--s1p-pri); border-radius: 4px; padding: 6px 8px; font-size: 14px; box-sizing: border-box; }
        .s1p-editor-item-controls { display: flex; align-items: center; gap: 4px; }
        .s1p-editor-btn { padding: 4px; font-size: 18px; line-height: 1; cursor: pointer; border-radius: 4px; border:none; background: transparent; color: #9ca3af; }
        .s1p-editor-btn:hover { background: var(--s1p-secondary-bg); color: var(--s1p-secondary-text); }
        .s1p-editor-btn.s1p-keyword-rule-delete,
        .s1p-editor-btn[data-action="delete"] {
            font-size: 0;
            width: 26px;
            height: 26px;
            padding: 4px;
            box-sizing: border-box;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='%23374151'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0' /%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: center;
            background-size: 18px 18px;
            transition: all 0.2s ease;
        }
        .s1p-editor-btn.s1p-keyword-rule-delete:hover,
        .s1p-editor-btn[data-action="delete"]:hover {
            background-color: var(--s1p-red);
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0' /%3E%3C/svg%3E");
        }
        .s1p-drag-handle { font-size: 18pt; cursor: grab; }
        .s1p-editor-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
        .s1p-settings-action-btn { display: inline-block; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; border: none; }
        .s1p-settings-action-btn.s1p-primary { background-color: var(--s1p-sec); color: var(--s1p-white); }
        .s1p-settings-action-btn.s1p-primary:hover { background-color: var(--s1p-sec-h); }
        .s1p-settings-action-btn.s1p-secondary { background-color: var(--s1p-secondary-bg); color: var(--s1p-secondary-text); }
        .s1p-settings-action-btn.s1p-secondary:hover { background-color: var(--s1p-secondary-hover-bg); }

        /* --- Modern Toggle Switch --- */
        .s1p-switch { position: relative; display: inline-block; width: 40px; height: 22px; vertical-align: middle; flex-shrink: 0; }
        .s1p-switch input { opacity: 0; width: 0; height: 0; }
        .s1p-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--s1p-pri); transition: .3s; border-radius: 22px; }
        .s1p-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: var(--s1p-white); transition: .3s; border-radius: 50%; box-shadow: 0 1px 3px rgba(var(--s1p-black-rgb), 0.1); }
        input:checked + .s1p-slider { background-color: var(--s1p-sec); }
        input:checked + .s1p-slider:before { transform: translateX(18px); }

        /* --- Nav Editor Dragging --- */
        .s1p-editor-item.s1p-dragging { opacity: 0.5; }

        /* --- [NEW] 用户标记设置面板专属样式 --- */
        .s1p-item-meta-id { font-family: monospace; background-color: var(--s1p-bg); padding: 1px 5px; border-radius: 4px; font-size: 11px; color: var(--s1p-t); }
        .s1p-item-content { margin-top: 8px; color: var(--s1p-desc-t); line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
        .s1p-item-editor textarea { width: 100%; min-height: 60px; margin-top: 8px; }
        .s1p-item-actions { display: flex; align-self: flex-start; flex-shrink: 0; gap: 8px; margin-left: 16px; }
        .s1p-item-actions .s1p-btn.s1p-primary { background-color: #3b82f6; color: var(--s1p-white); }
        .s1p-item-actions .s1p-btn.s1p-primary:hover { background-color: #2563eb; }
        .s1p-item-actions .s1p-btn.s1p-danger { background-color: var(--s1p-red); color: var(--s1p-white); }
        .s1p-item-actions .s1p-btn.s1p-danger:hover { background-color: var(--s1p-red-h); border-color: var(--s1p-red-h);}

        /* --- [NEW] 引用屏蔽占位符 (Refined Style) --- */
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

        /* --- [NEW] Quote Collapse Animation --- */
        .s1p-quote-wrapper {
            overflow: hidden;
            transition: max-height 0.35s ease-in-out;
        }

        /* --- [NEW] Image Hiding --- */
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

        /* --- [MODIFIED] Image Toggle All Button --- */
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
    `);

    // --- S1 NUX 兼容性检测 ---
    let isS1NuxEnabled = false;
    const detectS1Nux = () => {
        const archiverLink = document.querySelector('a[href*="archiver"]');
        if (archiverLink) {
            const style = window.getComputedStyle(archiverLink, '::before');
            if (style && style.content.includes('NUXISENABLED')) {
                isS1NuxEnabled = true;
            }
        }
        // For debugging, you can uncomment the next line
        // console.log('S1 Plus: S1 NUX detection result:', isS1NuxEnabled);
    };

    let dynamicallyHiddenThreads = {};

    // [NEW] 为远程推送增加防抖机制，避免过于频繁的API调用
    let remotePushTimeout;
    const debouncedTriggerRemoteSyncPush = () => {
        const settings = getSettings();
        if (!settings.syncRemoteEnabled || !settings.syncRemoteGistId || !settings.syncRemotePat) {
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
        GM_setValue('s1p_last_modified', Date.now());
        debouncedTriggerRemoteSyncPush();
    };

    // [NEW] 更新上次同步时间的显示
    const updateLastSyncTimeDisplay = () => {
        const container = document.querySelector('#s1p-last-sync-time-container');
        if (!container) return;
        const lastSyncTs = GM_getValue('s1p_last_sync_timestamp', 0);
        if (lastSyncTs > 0) {
            container.textContent = `上次成功同步于: ${new Date(lastSyncTs).toLocaleString('zh-CN', { hour12: false })}`;
        } else {
            container.textContent = '尚未进行过远程同步。';
        }
    };


    // --- 数据处理 & 核心功能 ---
    const getBlockedThreads = () => GM_getValue('s1p_blocked_threads', {});
    const saveBlockedThreads = (threads) => {
        GM_setValue('s1p_blocked_threads', threads);
        updateLastModifiedTimestamp();
    };
    const getBlockedUsers = () => GM_getValue('s1p_blocked_users', {});
    const saveBlockedUsers = (users) => {
        GM_setValue('s1p_blocked_users', users);
        updateLastModifiedTimestamp();
    };
    const saveUserTags = (tags) => {
        GM_setValue('s1p_user_tags', tags);
        updateLastModifiedTimestamp();
    };

    // [MODIFIED] 升级并获取用户标记，自动迁移旧数据
    const getUserTags = () => {
        const tags = GM_getValue('s1p_user_tags', {});
        let needsMigration = false;
        const migratedTags = { ...tags };

        Object.keys(migratedTags).forEach(id => {
            if (typeof migratedTags[id] === 'string' || !migratedTags[id].timestamp) {
                needsMigration = true;
                const oldTag = typeof migratedTags[id] === 'string' ? migratedTags[id] : migratedTags[id].tag;
                const oldName = (migratedTags[id] && migratedTags[id].name) ? migratedTags[id].name : `用户 #${id}`;
                migratedTags[id] = {
                    name: oldName,
                    tag: oldTag,
                    timestamp: (migratedTags[id] && migratedTags[id].timestamp) || Date.now()
                };
            }
        });

        if (needsMigration) {
            console.log('S1 Plus: 正在将用户标记迁移到新版数据结构...');
            saveUserTags(migratedTags);
            return migratedTags;
        }

        return tags;
    };

    const getTitleFilterRules = () => {
        const rules = GM_getValue('s1p_title_filter_rules', null);
        if (rules !== null) return rules;

        // --- 向下兼容：迁移旧的关键字数据 ---
        const oldKeywords = GM_getValue('s1p_title_keywords', null);
        if (Array.isArray(oldKeywords)) {
            const newRules = oldKeywords.map(k => ({ pattern: k, enabled: true, id: `rule_${Date.now()}_${Math.random()}` }));
            saveTitleFilterRules(newRules);
            GM_setValue('s1p_title_keywords', null); // 清理旧数据
            return newRules;
        }
        return [];
    };
    const saveTitleFilterRules = (rules) => {
        GM_setValue('s1p_title_filter_rules', rules);
        updateLastModifiedTimestamp();
    };

    const blockThread = (id, title, reason = 'manual') => { const b = getBlockedThreads(); if (b[id]) return; b[id] = { title, timestamp: Date.now(), reason }; saveBlockedThreads(b); hideThread(id); };
    const unblockThread = (id) => { const b = getBlockedThreads(); delete b[id]; saveBlockedThreads(b); showThread(id); };
    const hideThread = (id) => { (document.getElementById(`normalthread_${id}`) || document.getElementById(`stickthread_${id}`))?.setAttribute('style', 'display: none !important'); };
    const showThread = (id) => { (document.getElementById(`normalthread_${id}`) || document.getElementById(`stickthread_${id}`))?.removeAttribute('style'); }
    const hideBlockedThreads = () => Object.keys(getBlockedThreads()).forEach(hideThread);
    const blockUser = (id, name) => { const settings = getSettings(); const b = getBlockedUsers(); b[id] = { name, timestamp: Date.now(), blockThreads: settings.blockThreadsOnUserBlock }; saveBlockedUsers(b); hideUserPosts(id); hideBlockedUserQuotes(); hideBlockedUserRatings(); if (b[id].blockThreads) applyUserThreadBlocklist(); };

    // [MODIFIED] 增加调用评分刷新函数
    const unblockUser = (id) => { const b = getBlockedUsers(); delete b[id]; saveBlockedUsers(b); showUserPosts(id); hideBlockedUserQuotes(); hideBlockedUserRatings(); unblockThreadsByUser(id); };

    // [FIX] 更精确地定位帖子作者，避免错误隐藏被评分的帖子
    const hideUserPosts = (id) => { document.querySelectorAll(`.authi a[href*="space-uid-${id}.html"]`).forEach(l => l.closest('table.plhin')?.setAttribute('style', 'display: none !important')); };
    const showUserPosts = (id) => { document.querySelectorAll(`.authi a[href*="space-uid-${id}.html"]`).forEach(l => l.closest('table.plhin')?.removeAttribute('style')); };

    const hideBlockedUsersPosts = () => Object.keys(getBlockedUsers()).forEach(hideUserPosts);

    const hideBlockedUserQuotes = () => {
        const settings = getSettings();
        const blockedUsers = getBlockedUsers();
        const blockedUserNames = Object.values(blockedUsers).map(u => u.name);

        document.querySelectorAll('div.quote').forEach(quoteElement => {
            const quoteAuthorElement = quoteElement.querySelector('blockquote font[color="#999999"]');
            if (!quoteAuthorElement) return;

            const text = quoteAuthorElement.textContent.trim();
            const match = text.match(/^(.*)\s发表于\s.*$/);
            if (!match || !match[1]) return;

            const authorName = match[1];
            const isBlocked = settings.enableUserBlocking && blockedUserNames.includes(authorName);

            const wrapper = quoteElement.parentElement.classList.contains('s1p-quote-wrapper') ? quoteElement.parentElement : null;

            if (isBlocked) {
                if (!wrapper) {
                    const newWrapper = document.createElement('div');
                    newWrapper.className = 's1p-quote-wrapper';
                    quoteElement.parentNode.insertBefore(newWrapper, quoteElement);
                    newWrapper.appendChild(quoteElement);
                    newWrapper.style.maxHeight = '0';

                    const newPlaceholder = document.createElement('div');
                    newPlaceholder.className = 's1p-quote-placeholder';
                    newPlaceholder.innerHTML = `<span>一条来自已屏蔽用户的引用已被隐藏。</span><span class="s1p-quote-toggle s1p-popover-btn">点击展开</span>`;
                    newWrapper.parentNode.insertBefore(newPlaceholder, newWrapper);

                    newPlaceholder.querySelector('.s1p-quote-toggle').addEventListener('click', function () {
                        const isCollapsed = newWrapper.style.maxHeight === '0px';
                        if (isCollapsed) {
                            const style = window.getComputedStyle(quoteElement);
                            const marginTop = parseFloat(style.marginTop);
                            const marginBottom = parseFloat(style.marginBottom);
                            newWrapper.style.maxHeight = (quoteElement.offsetHeight + marginTop + marginBottom) + 'px';
                            this.textContent = '点击折叠';
                        } else {
                            newWrapper.style.maxHeight = '0px';
                            this.textContent = '点击展开';
                        }
                    });
                }
            } else {
                if (wrapper) {
                    const placeholder = wrapper.previousElementSibling;
                    if (placeholder && placeholder.classList.contains('s1p-quote-placeholder')) {
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
        document.querySelectorAll('tbody.ratl_l tr').forEach(row => {
            const userLink = row.querySelector('a[href*="space-uid-"]');
            if (userLink) {
                const uidMatch = userLink.href.match(/space-uid-(\d+)/);
                if (uidMatch && uidMatch[1]) {
                    const isBlocked = settings.enableUserBlocking && blockedUserIds.includes(uidMatch[1]);
                    row.style.display = isBlocked ? 'none' : '';
                }
            }
        });
    };

    const hideThreadsByTitleKeyword = () => {
        const rules = getTitleFilterRules().filter(r => r.enabled && r.pattern);
        const newHiddenThreads = {};

        const regexes = rules.map(r => {
            try {
                return { regex: new RegExp(r.pattern), pattern: r.pattern };
            } catch (e) {
                console.error(`S1 Plus: 屏蔽规则 "${r.pattern}" 不是一个有效的正则表达式，将被忽略。`, e);
                return null;
            }
        }).filter(Boolean);

        document.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]').forEach(row => {
            const titleElement = row.querySelector('th a.s.xst');
            if (!titleElement) return;

            const title = titleElement.textContent.trim();
            const threadId = row.id.replace(/^(normalthread_|stickthread_)/, '');
            let isHidden = false;

            if (regexes.length > 0) {
                const matchingRule = regexes.find(r => r.regex.test(title));
                if (matchingRule) {
                    newHiddenThreads[threadId] = { title, pattern: matchingRule.pattern };
                    row.classList.add('s1p-hidden-by-keyword');
                    isHidden = true;
                }
            }

            if (!isHidden) {
                row.classList.remove('s1p-hidden-by-keyword');
            }
        });
        dynamicallyHiddenThreads = newHiddenThreads;
    };

    const getReadProgress = () => GM_getValue('s1p_read_progress', {});
    const saveReadProgress = (progress) => {
        GM_setValue('s1p_read_progress', progress);
        updateLastModifiedTimestamp();
    };
    const updateThreadProgress = (threadId, postId, page, lastReadFloor) => {
        if (!postId || !page || !lastReadFloor) return;
        const progress = getReadProgress();
        progress[threadId] = { postId, page, timestamp: Date.now(), lastReadFloor: lastReadFloor };
        saveReadProgress(progress);
    };

    const applyUserThreadBlocklist = () => {
        const blockedUsers = getBlockedUsers();
        const usersToBlockThreads = Object.keys(blockedUsers).filter(uid => blockedUsers[uid].blockThreads);
        if (usersToBlockThreads.length === 0) return;

        document.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]').forEach(row => {
            const authorLink = row.querySelector('td.by cite a[href*="space-uid-"]');
            if (authorLink) {
                const uidMatch = authorLink.href.match(/space-uid-(\d+)\.html/);
                const authorId = uidMatch ? uidMatch[1] : null;
                if (authorId && usersToBlockThreads.includes(authorId)) {
                    const threadId = row.id.replace(/^(normalthread_|stickthread_)/, '');
                    const titleElement = row.querySelector('th a.s.xst');
                    if (threadId && titleElement) {
                        blockThread(threadId, titleElement.textContent.trim(), `user_${authorId}`);
                    }
                }
            }
        });
    };

    const unblockThreadsByUser = (userId) => {
        const allBlockedThreads = getBlockedThreads();
        const reason = `user_${userId}`;
        Object.keys(allBlockedThreads).forEach(threadId => {
            if (allBlockedThreads[threadId].reason === reason) {
                unblockThread(threadId);
            }
        });
    };

    const updatePostImageButtonState = (postContainer) => {
        const toggleButton = postContainer.querySelector('.s1p-image-toggle-all-btn');
        if (!toggleButton) return;

        const totalImages = postContainer.querySelectorAll('.s1p-image-container').length;
        if (totalImages <= 1) {
            const container = toggleButton.closest('.s1p-image-toggle-all-container');
            if (container) container.remove();
            return;
        }

        const hiddenImages = postContainer.querySelectorAll('.s1p-image-container.hidden').length;

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
            document.querySelectorAll('.s1p-image-toggle-all-container').forEach(el => el.remove());
            return;
        }

        document.querySelectorAll('table.plhin').forEach(postContainer => {
            const imageContainers = postContainer.querySelectorAll('.s1p-image-container');
            const postContentArea = postContainer.querySelector('td.t_f');

            if (!postContentArea) return;

            let toggleButtonContainer = postContainer.querySelector('.s1p-image-toggle-all-container');

            if (imageContainers.length <= 1) {
                if (toggleButtonContainer) toggleButtonContainer.remove();
                return;
            }

            if (!toggleButtonContainer) {
                toggleButtonContainer = document.createElement('div');
                toggleButtonContainer.className = 's1p-image-toggle-all-container';

                const toggleButton = document.createElement('button');
                toggleButton.className = 's1p-image-toggle-all-btn';
                toggleButtonContainer.appendChild(toggleButton);

                toggleButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    const imagesInPost = postContainer.querySelectorAll('.s1p-image-container');
                    const shouldShowAll = postContainer.querySelector('.s1p-image-container.hidden');

                    if (shouldShowAll) {
                        imagesInPost.forEach(container => {
                            container.classList.remove('hidden');
                            container.dataset.manualShow = 'true';
                        });
                    } else {
                        imagesInPost.forEach(container => {
                            container.classList.add('hidden');
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
        document.querySelectorAll('div.authi a[href*="authorid="]').forEach(link => {
            if (link.textContent.trim() === '只看该作者') {
                link.textContent = '只看该用户';
            }
        });
    };

    // [MODIFIED] 图片隐藏功能的核心逻辑 (支持实时切换)
    const applyImageHiding = () => {
        const settings = getSettings();

        // 如果功能未开启，则移除所有包装和占位符
        if (!settings.hideImagesByDefault) {
            document.querySelectorAll('.s1p-image-container').forEach(container => {
                const originalElement = container.querySelector('img.zoom')?.closest('a') || container.querySelector('img.zoom');
                if (originalElement) {
                    container.parentNode.insertBefore(originalElement, container);
                }
                container.remove();
            });
            return;
        }

        // 步骤 1: 遍历所有帖子图片，确保它们都被容器包裹并绑定切换事件
        document.querySelectorAll('div.t_fsz img.zoom').forEach(img => {
            if (img.closest('.s1p-image-container')) return; // 如果已被包裹，则跳过

            const targetElement = img.closest('a') || img;
            const container = document.createElement('div');
            container.className = 's1p-image-container';

            const placeholder = document.createElement('span');
            placeholder.className = 's1p-image-placeholder';
            // 初始文本不重要，会在步骤2中被正确设置
            placeholder.textContent = '图片处理中...';

            targetElement.parentNode.insertBefore(container, targetElement);
            container.appendChild(placeholder);
            container.appendChild(targetElement);

            placeholder.addEventListener('click', (e) => {
                e.preventDefault();
                const isHidden = container.classList.toggle('hidden');

                if (isHidden) {
                    placeholder.textContent = '显示图片';
                    delete container.dataset.manualShow;
                } else {
                    placeholder.textContent = '隐藏图片';
                    container.dataset.manualShow = 'true';
                }

                const postContainer = container.closest('table.plhin');
                if (postContainer) {
                    updatePostImageButtonState(postContainer);
                }
            });
        });

        // 步骤 2: 根据当前设置和图片状态，同步所有容器的 class 和占位符文本
        document.querySelectorAll('.s1p-image-container').forEach(container => {
            const placeholder = container.querySelector('.s1p-image-placeholder');
            if (!placeholder) return;

            const shouldBeHidden = settings.hideImagesByDefault && container.dataset.manualShow !== 'true';

            container.classList.toggle('hidden', shouldBeHidden);

            if (shouldBeHidden) {
                placeholder.textContent = '显示图片';
            } else {
                placeholder.textContent = '隐藏图片';
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
            GM_openInTab(e.currentTarget.href, { active: !settings.openThreadsInBackground });
        }
    };

    /**
     * 遍历帖子列表的所有标题链接，并根据用户设置应用或移除“新标签页打开”的行为。
     */
    const applyThreadLinkBehavior = () => {
        const settings = getSettings();
        document.querySelectorAll('tbody[id^="normalthread_"] th a.s.xst, tbody[id^="stickthread_"] th a.s.xst').forEach(link => {
            // 先移除旧的监听器，以防重复添加或在禁用功能时清理
            link.removeEventListener('click', threadLinkClickHandler);

            // 如果功能启用，则添加新的监听器
            if (settings.openThreadsInNewTab) {
                link.addEventListener('click', threadLinkClickHandler);
            }
        });
    };

    /**
     * 遍历帖子列表的所有页码链接，并根据用户设置应用或移除“新标签页打开”的行为。
     */
    const applyPageLinkBehavior = () => {
        const settings = getSettings();
        document.querySelectorAll('tbody[id^="normalthread_"] span.tps a, tbody[id^="stickthread_"] span.tps a').forEach(link => {
            // 移除旧的监听器和 onclick 属性
            link.removeEventListener('click', threadLinkClickHandler);
            link.removeAttribute('onclick');

            // 如果功能启用，则添加新的监听器
            if (settings.openThreadsInNewTab) {
                link.addEventListener('click', threadLinkClickHandler);
            }
        });
    };

    // [FIXED] 导出数据对象，使用持久化的时间戳
    const exportLocalDataObject = () => {
        const lastUpdated = GM_getValue('s1p_last_modified', 0);
        const lastUpdatedFormatted = new Date(lastUpdated).toLocaleString('zh-CN', { hour12: false });
        return {
            version: 3.2,
            lastUpdated,
            lastUpdatedFormatted,
            settings: getSettings(),
            threads: getBlockedThreads(),
            users: getBlockedUsers(),
            user_tags: getUserTags(),
            title_filter_rules: getTitleFilterRules(),
            read_progress: getReadProgress()
        }
    };

    const exportLocalData = () => JSON.stringify(exportLocalDataObject(), null, 2);

    const importLocalData = (jsonStr) => {
        try {
            const imported = JSON.parse(jsonStr); if (typeof imported !== 'object' || imported === null) throw new Error("无效数据格式");
            let threadsImported = 0, usersImported = 0, progressImported = 0, rulesImported = 0, tagsImported = 0;

            const upgradeAndMerge = (type, importedData, getter, saver) => {
                if (!importedData || typeof importedData !== 'object') return 0;
                Object.keys(importedData).forEach(id => {
                    const item = importedData[id];
                    if (type === 'users' && typeof item.blockThreads === 'undefined') item.blockThreads = false;
                    if (type === 'threads' && typeof item.reason === 'undefined') item.reason = 'manual';
                });
                const merged = { ...getter(), ...importedData };
                saver(merged);
                return Object.keys(importedData).length;
            };

            if (imported.settings) {
                saveSettings({ ...getSettings(), ...imported.settings });
            }

            threadsImported = upgradeAndMerge('threads', imported.threads, getBlockedThreads, saveBlockedThreads);
            usersImported = upgradeAndMerge('users', imported.users, getBlockedUsers, saveBlockedUsers);

            if (imported.user_tags && typeof imported.user_tags === 'object') {
                const mergedTags = { ...getUserTags(), ...imported.user_tags };
                saveUserTags(mergedTags);
                tagsImported = Object.keys(imported.user_tags).length;
            }

            if (imported.title_filter_rules && Array.isArray(imported.title_filter_rules)) {
                saveTitleFilterRules(imported.title_filter_rules);
                rulesImported = imported.title_filter_rules.length;
            } else if (imported.title_keywords && Array.isArray(imported.title_keywords)) { // 向后兼容导入旧格式
                const newRules = imported.title_keywords.map(k => ({ pattern: k, enabled: true, id: `rule_${Date.now()}_${Math.random()}` }));
                saveTitleFilterRules(newRules);
                rulesImported = newRules.length;
            }

            if (imported.read_progress) {
                const mergedProgress = { ...getReadProgress(), ...imported.read_progress };
                saveReadProgress(mergedProgress);
                progressImported = Object.keys(imported.read_progress).length;
            }

            // [FIXED] 导入成功后，将本地时间戳与导入的时间戳同步
            GM_setValue('s1p_last_modified', imported.lastUpdated || 0);

            hideBlockedThreads();
            hideBlockedUsersPosts();
            applyUserThreadBlocklist();
            hideThreadsByTitleKeyword();
            initializeNavbar();
            applyInterfaceCustomizations();
            // 导入数据是一次大数据变更，直接触发一次推送
            triggerRemoteSyncPush();

            return { success: true, message: `成功导入 ${threadsImported} 条帖子、${usersImported} 条用户、${tagsImported} 条标记、${rulesImported} 条标题规则、${progressImported} 条阅读进度及相关设置。` };
        } catch (e) { return { success: false, message: `导入失败: ${e.message}` }; }
    };

    const fetchRemoteData = () => new Promise((resolve, reject) => {
        const { syncRemoteGistId, syncRemotePat } = getSettings();
        if (!syncRemoteGistId || !syncRemotePat) {
            return reject(new Error('配置不完整'));
        }
        const syncRemoteApiUrl = `https://api.github.com/gists/${syncRemoteGistId}`;

        GM_xmlhttpRequest({
            method: 'GET',
            url: syncRemoteApiUrl,
            headers: {
                'Authorization': `Bearer ${syncRemotePat}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            onload: (response) => {
                if (response.status === 200) {
                    try {
                        const gistData = JSON.parse(response.responseText);
                        const fileContent = gistData.files['s1plus_sync.json']?.content;
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
                reject(new Error('网络请求失败。'));
            }
        });
    });

    const pushRemoteData = (dataObject) => new Promise((resolve, reject) => {
        const { syncRemoteGistId, syncRemotePat } = getSettings();
        if (!syncRemoteGistId || !syncRemotePat) {
            return reject(new Error('配置不完整'));
        }
        const syncRemoteApiUrl = `https://api.github.com/gists/${syncRemoteGistId}`;

        const payload = {
            files: {
                's1plus_sync.json': {
                    content: JSON.stringify(dataObject, null, 2)
                }
            }
        };

        GM_xmlhttpRequest({
            method: 'PATCH',
            url: syncRemoteApiUrl,
            headers: {
                'Authorization': `Bearer ${syncRemotePat}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            data: JSON.stringify(payload),
            onload: (response) => {
                if (response.status === 200) {
                    resolve({ success: true, message: '数据已成功推送到Gist。' });
                } else {
                    reject(new Error(`Gist更新失败，状态码: ${response.status}, 响应: ${response.responseText}`));
                }
            },
            onerror: () => {
                reject(new Error('网络请求失败。'));
            }
        });
    });

    // [NEW] 触发式推送函数，用于在数据保存后自动上传
    const triggerRemoteSyncPush = () => {
        // 异步执行，不阻塞主流程
        (async () => {
            const settings = getSettings();
            if (!settings.syncRemoteEnabled || !settings.syncRemoteGistId || !settings.syncRemotePat) {
                return;
            }
            console.log('S1 Plus: 检测到数据变更，触发远程同步推送...');
            try {
                const dataToPush = exportLocalDataObject();
                await pushRemoteData(dataToPush);
                GM_setValue('s1p_last_sync_timestamp', Date.now());
                updateLastSyncTimeDisplay();
                console.log('S1 Plus: 数据已成功推送到远程。');
            } catch (error) {
                console.error('S1 Plus: 自动推送数据失败:', error);
            }
        })();
    };

    // [MODIFIED] 自动同步控制器，用于页面加载时静默执行
    const performAutoSync = async () => {
        const settings = getSettings();
        if (!settings.syncRemoteEnabled || !settings.syncRemoteGistId || !settings.syncRemotePat) {
            return;
        }

        try {
            const remoteData = await fetchRemoteData();
            const remoteTimestamp = remoteData.lastUpdated || 0;
            const localTimestamp = GM_getValue('s1p_last_modified', 0);

            if (remoteTimestamp > localTimestamp) {
                console.log(`S1 Plus (AutoSync): 远程数据 (TS: ${remoteTimestamp}) 比本地 (TS: ${localTimestamp}) 更新，正在后台应用...`);
                importLocalData(JSON.stringify(remoteData));
                GM_setValue('s1p_last_sync_timestamp', Date.now());
            } else if (localTimestamp > remoteTimestamp) {
                console.log(`S1 Plus (AutoSync): 本地数据 (TS: ${localTimestamp}) 比远程 (TS: ${remoteTimestamp}) 更新，正在后台推送...`);
                const localData = exportLocalDataObject();
                await pushRemoteData(localData);
                GM_setValue('s1p_last_sync_timestamp', Date.now());
            } else {
                console.log(`S1 Plus (AutoSync): 本地与远程数据版本一致 (TS: ${localTimestamp})，无需同步。`);
            }
        } catch (error) {
            console.error('S1 Plus: 自动同步失败:', error);
        }
    };

    // --- 设置管理 ---
    const defaultSettings = {
        enablePostBlocking: true,
        enableUserBlocking: true,
        enableUserTagging: true,
        enableReadProgress: true,
        readingProgressCleanupDays: 0,     // [MODIFIED] Default to 0 (Never)
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
        threadBlockHoverDelay: 1,
        customTitleSuffix: ' - STAGE1ₛₜ',
        customNavLinks: [
            { name: '论坛', href: 'forum.php' },
            { name: '归墟', href: 'forum-157-1.html' },
            { name: '漫区', href: 'forum-6-1.html' },
            { name: '游戏', href: 'forum-4-1.html' },
            { name: '影视', href: 'forum-48-1.html' },
            { name: 'PC数码', href: 'forum-51-1.html' },
            { name: '黑名单', href: 'home.php?mod=space&do=friend&view=blacklist' }
        ],
        syncRemoteEnabled: false,
        syncRemoteGistId: '',
        syncRemotePat: '',
    };
    const getSettings = () => {
        const saved = GM_getValue('s1p_settings', {});
        // 如果用户已保存自定义导航，则保留，否则使用默认值
        if (saved.customNavLinks && Array.isArray(saved.customNavLinks)) {
            return { ...defaultSettings, ...saved, customNavLinks: saved.customNavLinks };
        }
        return { ...defaultSettings, ...saved };
    };
    const saveSettings = (settings) => {
        GM_setValue('s1p_settings', settings);
        updateLastModifiedTimestamp();
    };

    // --- 界面定制功能 ---
    const applyInterfaceCustomizations = () => {
        const settings = getSettings();
        if (settings.changeLogoLink) document.querySelector('#hd h2 a')?.setAttribute('href', './forum.php');
        if (settings.hideBlacklistTip) document.getElementById('hiddenpoststip')?.remove();

        // 添加标题后缀修改
        if (settings.customTitleSuffix) {
            const titlePattern = /^(.+?)(?:论坛)?(?:\s*-\s*Stage1st)?\s*-\s*stage1\/s1\s+游戏动漫论坛$/;
            if (titlePattern.test(document.title)) {
                document.title = document.title.replace(titlePattern, '$1') + settings.customTitleSuffix;
            }
        }
    };

    const initializeNavbar = () => {
        const settings = getSettings();
        const navUl = document.querySelector('#nv > ul');
        if (!navUl) return;

        const createManagerLink = () => {
            const li = document.createElement('li');
            li.id = 's1p-nav-link';
            const a = document.createElement('a');
            a.href = 'javascript:void(0);';
            a.textContent = 'S1 Plus 设置';
            a.addEventListener('click', createManagementModal);
            li.appendChild(a);
            return li;
        };

        document.getElementById('s1p-nav-link')?.remove();

        if (settings.enableNavCustomization) {
            navUl.innerHTML = '';
            (settings.customNavLinks || []).forEach(link => {
                if (!link.name || !link.href) return;
                const li = document.createElement('li');
                if (window.location.href.includes(link.href)) li.className = 'a';
                const a = document.createElement('a');
                a.href = link.href;
                a.textContent = link.name;
                a.setAttribute('hidefocus', 'true');
                li.appendChild(a);
                navUl.appendChild(li);
            });
        }
        navUl.appendChild(createManagerLink());
    };

    // --- UI 创建 ---
    const formatDate = (timestamp) => new Date(timestamp).toLocaleString('zh-CN');

    // --- [OPTIMIZED] 使用悬浮提示框重写 showMessage 函数 ---
    // 使用 Map 存储当前活跃的提示，防止在同一按钮上短时内触发多条提示重叠
    const activeToasts = new Map();

    // --- [OPTIMIZED] 替换旧的 showMessage 函数 V2 ---

    let currentToast = null; // 用一个全局变量来管理当前的提示框实例

    /**
     * 显示消息。如果设置面板打开，则在面板底部显示，否则在屏幕底部显示。
     * @param {string} message - 要显示的消息内容。
     * @param {boolean} isSuccess - 消息是否为成功状态（决定颜色和动画）。
     */
    const showMessage = (message, isSuccess) => {
        // 如果上一个提示框还存在，立即移除，防止重叠
        if (currentToast) {
            currentToast.remove();
        }

        // 1. 动态创建提示框元素
        const toast = document.createElement('div');
        toast.className = `s1p-toast-notification ${isSuccess ? 'success' : 'error'}`;
        toast.textContent = message;

        // 2. 决定将提示框附加到哪里
        const modalContent = document.querySelector('.s1p-modal-content');
        if (modalContent) {
            // 如果设置面板存在，附加到面板内部
            modalContent.appendChild(toast);
        } else {
            // 否则，作为备选方案，附加到 body
            document.body.appendChild(toast);
        }
        currentToast = toast;

        // 3. 触发显示动画
        setTimeout(() => {
            toast.classList.add('visible');
        }, 50); // 延迟以确保动画触发

        // 4. 3秒后触发消失动画，并在动画结束后移除元素
        setTimeout(() => {
            toast.classList.remove('visible');
            toast.addEventListener('transitionend', () => {
                if (toast.parentNode) {
                    toast.remove();
                }
                // 如果被移除的是当前活动的toast，则清空变量
                if (currentToast === toast) {
                    currentToast = null;
                }
            }, { once: true });
        }, 3000);
    };


    const createConfirmationModal = (title, subtitle, onConfirm, confirmText = '确定') => {
        document.querySelector('.s1p-confirm-modal')?.remove();
        const modal = document.createElement('div');
        modal.className = 's1p-confirm-modal';
        modal.innerHTML = `<div class="s1p-confirm-content"><div class="s1p-confirm-body"><div class="s1p-confirm-title">${title}</div><div class="s1p-confirm-subtitle">${subtitle}</div></div><div class="s1p-confirm-footer"><button class="s1p-confirm-btn s1p-cancel">取消</button><button class="s1p-confirm-btn s1p-confirm">${confirmText}</button></div></div>`;
        const closeModal = () => { modal.querySelector('.s1p-confirm-content').style.animation = 's1p-scale-out 0.25s ease-out forwards'; modal.style.animation = 's1p-fade-out 0.25s ease-out forwards'; setTimeout(() => modal.remove(), 250); };
        modal.querySelector('.s1p-confirm').addEventListener('click', () => { onConfirm(); closeModal(); });
        modal.querySelector('.s1p-cancel').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        document.body.appendChild(modal);
    };

    /**
     * [MODIFIED] 创建一个行内确认菜单 (带动画和右侧定位)
     * @param {HTMLElement} anchorElement - 菜单定位的锚点元素
     * @param {string} confirmText - 确认提示文本
     * @param {Function} onConfirm - 点击确认后执行的回调函数
     */
    const createInlineConfirmMenu = (anchorElement, confirmText, onConfirm) => {
        document.querySelector('.s1p-inline-confirm-menu')?.remove();

        const menu = document.createElement('div');
        menu.className = 's1p-options-menu s1p-inline-confirm-menu';
        menu.style.width = 'max-content';

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

        // --- 新的定位逻辑 ---
        // 1. 垂直居中对齐
        const top = anchorRect.top + window.scrollY + (anchorRect.height / 2) - (menuRect.height / 2);
        // 2. 放置在锚点右侧，并留出间隙
        const left = anchorRect.right + window.scrollX + 8;

        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;

        let isClosing = false;
        const closeMenu = () => {
            if (isClosing) return;
            isClosing = true;
            document.removeEventListener('click', closeMenu); // 立即移除监听器
            menu.classList.remove('visible'); // 触发消失动画

            // 在动画结束后移除 DOM 元素，设置一个安全的延时
            setTimeout(() => {
                if (menu.parentNode) {
                    menu.remove();
                }
            }, 200); // 动画时长为 0.15s，200ms 足够
        };

        menu.querySelector('.s1p-confirm').addEventListener('click', (e) => {
            e.stopPropagation();
            onConfirm();
            closeMenu();
        });

        menu.querySelector('.s1p-cancel').addEventListener('click', (e) => {
            e.stopPropagation();
            closeMenu();
        });

        // 触发进入动画
        requestAnimationFrame(() => {
            menu.classList.add('visible');
        });

        // 在下一个事件循环中添加外部点击关闭监听，以防止触发打开的同一次点击立即关闭它
        setTimeout(() => {
            document.addEventListener('click', closeMenu, { once: true });
        }, 0);
    };


    const removeProgressJumpButtons = () => document.querySelectorAll('.s1p-progress-container').forEach(el => el.remove());
    const removeBlockButtonsFromThreads = () => document.querySelectorAll('.s1p-options-cell').forEach(el => el.remove());

    const createManagementModal = () => {
        document.querySelector('.s1p-modal')?.remove();
        const modal = document.createElement('div');
        modal.className = 's1p-modal';
        // --- [OPTIMIZED] 移除所有静态的 message div ---
        modal.innerHTML = `<div class="s1p-modal-content">
            <div class="s1p-modal-header"><div class="s1p-modal-title">S1 Plus 设置</div><div class="s1p-modal-close"></div></div>
            <div class="s1p-modal-body">
                <div class="s1p-tabs">
                    <button class="s1p-tab-btn active" data-tab="general-settings">通用设置</button>
                    <button class="s1p-tab-btn" data-tab="threads">帖子屏蔽</button>
                    <button class="s1p-tab-btn" data-tab="users">用户屏蔽</button>
                    <button class="s1p-tab-btn" data-tab="tags">用户标记</button>
                    <button class="s1p-tab-btn" data-tab="nav-settings">导航栏定制</button>
                    <button class="s1p-tab-btn" data-tab="sync">设置同步</button>
                </div>
                <div id="s1p-tab-general-settings" class="s1p-tab-content active"></div>
                <div id="s1p-tab-threads" class="s1p-tab-content"></div>
                <div id="s1p-tab-users" class="s1p-tab-content"></div>
                <div id="s1p-tab-tags" class="s1p-tab-content"></div>
                <div id="s1p-tab-nav-settings" class="s1p-tab-content"></div>
                <div id="s1p-tab-sync" class="s1p-tab-content">
                    <div class="s1p-settings-group">
                        <div class="s1p-settings-group-title">本地备份与恢复</div>
                        <div class="s1p-local-sync-desc">通过手动复制/粘贴数据，在不同浏览器或设备间迁移或备份你的所有S1 Plus配置，包括屏蔽列表、导航栏、阅读进度和各项开关设置。</div>
                        <div class="s1p-local-sync-buttons">
                            <button id="s1p-local-export-btn" class="s1p-btn">导出数据</button>
                            <button id="s1p-local-import-btn" class="s1p-btn">导入数据</button>
                        </div>
                        <textarea id="s1p-local-sync-textarea" class="s1p-sync-textarea s1p-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据"></textarea>
                    </div>

                    <div class="s1p-settings-group">
                        <div class="s1p-settings-group-title">远程同步 (通过GitHub Gist)</div>
                        <div id="s1p-last-sync-time-container" class="s1p-setting-desc" style="margin-top: -8px; margin-bottom: 16px;"></div>
                        <div class="s1p-settings-item">
                            <label class="s1p-settings-label" for="s1p-remote-enabled-toggle">启用远程同步</label>
                            <label class="s1p-switch">
                                <input type="checkbox" id="s1p-remote-enabled-toggle" class="s1p-settings-checkbox">
                                <span class="s1p-slider"></span>
                            </label>
                        </div>
                        <p class="s1p-setting-desc">启用后，数据将在停止操作5秒后自动同步。你也可以随时手动同步。</p>
                        <div class="s1p-settings-item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                            <label class="s1p-settings-label" for="s1p-remote-gist-id-input">Gist ID</label>
                            <input type="text" id="s1p-remote-gist-id-input" class="s1p-title-suffix-input" placeholder="从 Gist 网址中复制的那一长串 ID" style="width: 100%;">
                        </div>
                        <div class="s1p-settings-item" style="flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 12px;">
                            <label class="s1p-settings-label" for="s1p-remote-pat-input">GitHub Personal Access Token (PAT)</label>
                            <input type="password" id="s1p-remote-pat-input" class="s1p-title-suffix-input" placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" style="width: 100%;">
                        </div>
                        <div class="s1p-notice">
                            <div class="s1p-notice-icon"></div>
                            <div class="s1p-notice-content">
                                <a href="https://silver-s1plus.netlify.app/" target="_blank">点击此处查看设置教程</a>
                                <p>Token只会保存在你的浏览器本地，不会上传到任何地方。</p>
                            </div>
                        </div>
                        <div class="s1p-editor-footer" style="margin-top: 16px; justify-content: flex-end; gap: 8px;">
                             <button id="s1p-remote-save-btn" class="s1p-btn">保存设置</button>
                             <button id="s1p-remote-manual-sync-btn" class="s1p-btn">手动同步</button>
                             <button id="s1p-open-gist-page-btn" class="s1p-btn">打开 Gist 页面</button>
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
        document.body.appendChild(modal);
        updateLastSyncTimeDisplay();

        const tabs = {
            'general-settings': modal.querySelector('#s1p-tab-general-settings'),
            'threads': modal.querySelector('#s1p-tab-threads'),
            'users': modal.querySelector('#s1p-tab-users'),
            'tags': modal.querySelector('#s1p-tab-tags'),
            'nav-settings': modal.querySelector('#s1p-tab-nav-settings'),
            'sync': modal.querySelector('#s1p-tab-sync'),
        };

        const dataClearanceConfig = {
            blockedThreads: { label: '手动屏蔽的帖子和用户主题帖', clear: () => saveBlockedThreads({}) },
            blockedUsers: { label: '屏蔽的用户列表', clear: () => saveBlockedUsers({}) },
            userTags: { label: '全部用户标记', clear: () => saveUserTags({}) },
            titleFilterRules: { label: '标题关键字屏蔽规则', clear: () => { saveTitleFilterRules([]); GM_setValue('s1p_title_keywords', null); } },
            readProgress: { label: '所有帖子阅读进度', clear: () => saveReadProgress({}) },
            settings: { label: '界面、导航栏及其他设置', clear: () => saveSettings(defaultSettings) }
        };

        const clearDataOptionsContainer = modal.querySelector('#s1p-clear-data-options');
        if (clearDataOptionsContainer) {
            clearDataOptionsContainer.innerHTML = Object.keys(dataClearanceConfig).map(key => `
                <div class="s1p-settings-item" style="padding: 8px 0;">
                    <label class="s1p-settings-label" for="s1p-clear-chk-${key}">${dataClearanceConfig[key].label}</label>
                    <label class="s1p-switch">
                        <input type="checkbox" class="s1p-clear-data-checkbox" id="s1p-clear-chk-${key}" data-clear-key="${key}">
                        <span class="s1p-slider"></span>
                    </label>
                </div>
            `).join('');
        }

        const remoteToggle = modal.querySelector('#s1p-remote-enabled-toggle');
        const gistInputItem = modal.querySelector('#s1p-remote-gist-id-input').closest('.s1p-settings-item');
        const patInputItem = modal.querySelector('#s1p-remote-pat-input').closest('.s1p-settings-item');
        const remoteFooter = modal.querySelector('#s1p-remote-manual-sync-btn').closest('.s1p-editor-footer');
        const remoteHelperLink = modal.querySelector('.s1p-notice a');

        const updateRemoteSyncInputsState = () => {
            const isEnabled = remoteToggle.checked;
            const targetOpacity = isEnabled ? '1' : '0.6';
            const targetPointerEvents = isEnabled ? 'auto' : 'none';

            const elementsToStyle = [gistInputItem, patInputItem, remoteFooter, remoteHelperLink];
            elementsToStyle.forEach(el => {
                if (el) {
                    el.style.opacity = targetOpacity;
                    el.style.pointerEvents = targetPointerEvents;
                }
            });

            if (gistInputItem) gistInputItem.querySelector('input').disabled = !isEnabled;
            if (patInputItem) patInputItem.querySelector('input').disabled = !isEnabled;
            if (remoteFooter) {
                const manualSyncBtn = remoteFooter.querySelector('#s1p-remote-manual-sync-btn');
                if (manualSyncBtn) manualSyncBtn.disabled = !isEnabled;
            }
        };

        // --- 加载远程同步设置到UI ---
        const settings = getSettings();
        remoteToggle.checked = settings.syncRemoteEnabled;
        modal.querySelector('#s1p-remote-gist-id-input').value = settings.syncRemoteGistId || '';
        modal.querySelector('#s1p-remote-pat-input').value = settings.syncRemotePat || '';
        if (remoteToggle) {
            remoteToggle.addEventListener('change', updateRemoteSyncInputsState);
            updateRemoteSyncInputsState(); // 打开设置时，根据当前状态初始化一次
        }


        // [REFACTORED] 全新用户标记标签页渲染逻辑
        const renderTagsTab = (options = {}) => {
            const editingUserId = options.editingUserId;
            const settings = getSettings();
            const isEnabled = settings.enableUserTagging;

            const toggleHTML = `
                <div class="s1p-settings-item" style="padding: 0; padding-bottom: 16px; margin-bottom: 10px; border-bottom: 1px solid var(--s1p-pri);">
                    <label class="s1p-settings-label" for="s1p-enableUserTagging">启用用户标记功能</label>
                    <label class="s1p-switch"><input type="checkbox" id="s1p-enableUserTagging" data-feature="enableUserTagging" class="s1p-feature-toggle" ${isEnabled ? 'checked' : ''}><span class="s1p-slider"></span></label>
                </div>
            `;

            const userTags = getUserTags();
            const tagItems = Object.entries(userTags).sort(([, a], [, b]) => (b.timestamp || 0) - (a.timestamp || 0));

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
                    <textarea id="s1p-tags-sync-textarea" class="s1p-sync-textarea s1p-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据..."></textarea>
                </div>

                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">已标记用户列表</div>
                    ${tagItems.length === 0
                    ? `<div class="s1p-empty">暂无用户标记</div>`
                    : `<div class="s1p-list">${tagItems.map(([id, data]) => {
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
                                        <textarea class="s1p-tag-edit-area">${data.tag}</textarea>
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
                                    <div class="s1p-item-title">${data.name}</div>
                                    <div class="s1p-item-meta">
                                        ID: <span class="s1p-item-meta-id">${id}</span> &nbsp;
                                        标记于: ${formatDate(data.timestamp)}
                                    </div>
                                    <div class="s1p-item-content">${data.tag}</div>
                                </div>
                                <div class="s1p-item-actions">
                                    <button class="s1p-btn" data-action="edit-tag-item" data-user-id="${id}">编辑</button>
                                    <button class="s1p-btn s1p-danger" data-action="delete-tag-item" data-user-id="${id}" data-user-name="${data.name}">删除</button>
                                </div>
                            </div>`;
                        }
                    }).join('')}</div>`
                }
                </div>
            `;

            tabs['tags'].innerHTML = `
                ${toggleHTML}
                <div class="s1p-feature-content ${isEnabled ? 'expanded' : ''}">
                    <div>${contentHTML}</div>
                </div>
            `;

            if (editingUserId) {
                const textarea = tabs['tags'].querySelector('.s1p-tag-edit-area');
                if (textarea) {
                    textarea.focus();
                    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
                }
            }
        };

        const renderUserTab = () => {
            const settings = getSettings();
            const isEnabled = settings.enableUserBlocking;

            const toggleHTML = `
                <div class="s1p-settings-item" style="padding: 0; padding-bottom: 16px; margin-bottom: 10px; border-bottom: 1px solid var(--s1p-pri);">
                    <label class="s1p-settings-label" for="s1p-enableUserBlocking">启用用户屏蔽功能</label>
                    <label class="s1p-switch"><input type="checkbox" id="s1p-enableUserBlocking" data-feature="enableUserBlocking" class="s1p-feature-toggle" ${isEnabled ? 'checked' : ''}><span class="s1p-slider"></span></label>
                </div>
            `;

            const blockedUsers = getBlockedUsers();
            const userItemIds = Object.keys(blockedUsers).sort((a, b) => blockedUsers[b].timestamp - blockedUsers[a].timestamp);
            const contentHTML = `
                <div class="s1p-settings-group" style="margin-bottom: 16px; padding-bottom: 0;">
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-blockThreadsOnUserBlock">屏蔽用户时，默认屏蔽其所有主题帖</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-blockThreadsOnUserBlock" class="s1p-settings-checkbox" ${settings.blockThreadsOnUserBlock ? 'checked' : ''}><span class="s1p-slider"></span></label>
                    </div>
                </div>
                <p class="s1p-setting-desc" style="margin-top: -4px; margin-bottom: 16px;">
                    <strong>提示</strong>：顶部总开关仅影响<strong>未来新屏蔽用户</strong>的默认设置。每个用户下方的独立开关，才是控制该用户主题帖的<strong>最终开关</strong>，拥有最高优先级。
                </p>
                ${userItemIds.length === 0
                    ? `<div class="s1p-empty">暂无屏蔽的用户</div>`
                    : `<div class="s1p-list">${userItemIds.map(id => {
                        const item = blockedUsers[id];
                        return `<div class="s1p-item" data-user-id="${id}"><div class="s1p-item-info"><div class="s1p-item-title">${item.name || `用户 #${id}`}</div><div class="s1p-item-meta">屏蔽时间: ${formatDate(item.timestamp)}</div><div class="s1p-item-toggle"><label class="s1p-switch"><input type="checkbox" class="s1p-user-thread-block-toggle" data-user-id="${id}" ${item.blockThreads ? 'checked' : ''}><span class="s1p-slider"></span></label><span>屏蔽该用户的主题帖</span></div></div><button class="s1p-unblock-btn s1p-btn" data-unblock-user-id="${id}">取消屏蔽</button></div>`;
                    }).join('')}</div>`
                }
            `;

            tabs['users'].innerHTML = `
                ${toggleHTML}
                <div class="s1p-feature-content ${isEnabled ? 'expanded' : ''}">
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
                    <label class="s1p-switch"><input type="checkbox" id="s1p-enablePostBlocking" data-feature="enablePostBlocking" class="s1p-feature-toggle" ${isEnabled ? 'checked' : ''}><span class="s1p-slider"></span></label>
                </div>
            `;

            const blockedThreads = getBlockedThreads();
            const manualItemIds = Object.keys(blockedThreads).sort((a, b) => blockedThreads[b].timestamp - blockedThreads[a].timestamp);

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
                        <span>当前页面被关键字屏蔽的帖子</span>
                        <span class="s1p-expander-arrow ${settings.showBlockedByKeywordList ? 'expanded' : ''}"></span>
                    </div>
                    <div id="s1p-dynamically-hidden-list-container" class="s1p-collapsible-content ${settings.showBlockedByKeywordList ? 'expanded' : ''}">
                        <div id="s1p-dynamically-hidden-list"></div>
                    </div>
                </div>

                <div class="s1p-settings-group">
                     <div id="s1p-manually-blocked-header" class="s1p-settings-group-title s1p-collapsible-header">
                        <span>手动屏蔽的帖子列表</span>
                        <span class="s1p-expander-arrow ${settings.showManuallyBlockedList ? 'expanded' : ''}"></span>
                    </div>
                    <div id="s1p-manually-blocked-list-container" class="s1p-collapsible-content ${settings.showManuallyBlockedList ? 'expanded' : ''}">
                    ${manualItemIds.length === 0
                    ? `<div class="s1p-empty">暂无手动屏蔽的帖子</div>`
                    : `<div class="s1p-list">${manualItemIds.map(id => {
                        const item = blockedThreads[id];
                        return `<div class="s1p-item" data-thread-id="${id}"><div class="s1p-item-info"><div class="s1p-item-title">${item.title || `帖子 #${id}`}</div><div class="s1p-item-meta">屏蔽时间: ${formatDate(item.timestamp)} ${item.reason && item.reason !== 'manual' ? `(因屏蔽用户${item.reason.replace('user_', '')})` : ''}</div></div><button class="s1p-unblock-btn s1p-btn" data-unblock-thread-id="${id}">取消屏蔽</button></div>`;
                    }).join('')}</div>`
                }
                    </div>
                </div>
            `;

            tabs['threads'].innerHTML = `
                ${toggleHTML}
                <div class="s1p-feature-content ${isEnabled ? 'expanded' : ''}">
                    <div>${contentHTML}</div>
                </div>
            `;

            const renderDynamicallyHiddenList = () => {
                const listContainer = tabs['threads'].querySelector('#s1p-dynamically-hidden-list');
                const hiddenItems = Object.entries(dynamicallyHiddenThreads);
                if (hiddenItems.length === 0) {
                    listContainer.innerHTML = `<div class="s1p-empty" style="padding-top: 12px;">当前页面没有被关键字屏蔽的帖子</div>`;
                } else {
                    listContainer.innerHTML = `<div class="s1p-list">${hiddenItems.map(([id, item]) => `
                        <div class="s1p-item" data-thread-id="${id}">
                            <div class="s1p-item-info">
                                <div class="s1p-item-title" title="${item.title}">${item.title}</div>
                                <div class="s1p-item-meta">匹配规则: <code style="background: var(--s1p-code-bg); padding: 2px 4px; border-radius: 3px;">${item.pattern}</code></div>
                            </div>
                        </div>
                    `).join('')}</div>`;
                }
            };

            const renderRules = () => {
                const rules = getTitleFilterRules();
                const container = tabs['threads'].querySelector('#s1p-keyword-rules-list');
                if (!container) return; // Exit if content is not rendered
                container.innerHTML = rules.map(rule => `
                    <div class="s1p-editor-item" data-rule-id="${rule.id}">
                        <label class="s1p-switch"><input type="checkbox" class="s1p-settings-checkbox s1p-keyword-rule-enable" ${rule.enabled ? 'checked' : ''}><span class="s1p-slider"></span></label>
                        <input type="text" class="s1p-keyword-rule-pattern" placeholder="输入关键字或正则表达式" value="${rule.pattern || ''}">
                        <div class="s1p-editor-item-controls">
                            <button class="s1p-editor-btn s1p-keyword-rule-delete" title="删除规则"></button>
                        </div>
                    </div>
                `).join('');
                if (rules.length === 0) {
                    container.innerHTML = `<div class="s1p-empty" style="padding: 12px;">暂无规则</div>`;
                }
            };

            renderRules();
            renderDynamicallyHiddenList();

            const saveKeywordRules = () => {
                const newRules = [];
                tabs['threads'].querySelectorAll('#s1p-keyword-rules-list .s1p-editor-item').forEach(item => {
                    const pattern = item.querySelector('.s1p-keyword-rule-pattern').value.trim();
                    if (pattern) {
                        let id = item.dataset.ruleId;
                        if (id.startsWith('new_')) {
                            id = `rule_${Date.now()}_${Math.random()}`;
                        }
                        newRules.push({
                            id: id,
                            enabled: item.querySelector('.s1p-keyword-rule-enable').checked,
                            pattern: pattern
                        });
                    }
                });
                saveTitleFilterRules(newRules);
                hideThreadsByTitleKeyword();
                renderDynamicallyHiddenList();
                renderRules(); // Re-render to show the saved state and assign permanent IDs.
            };

            tabs['threads'].addEventListener('click', e => {
                const target = e.target;
                const header = target.closest('.s1p-collapsible-header');

                if (header) {
                    if (header.id === 's1p-blocked-by-keyword-header') {
                        const currentSettings = getSettings();
                        const isNowExpanded = !currentSettings.showBlockedByKeywordList;
                        currentSettings.showBlockedByKeywordList = isNowExpanded;
                        saveSettings(currentSettings);

                        header.querySelector('.s1p-expander-arrow').classList.toggle('expanded', isNowExpanded);
                        tabs['threads'].querySelector('#s1p-dynamically-hidden-list-container').classList.toggle('expanded', isNowExpanded);
                    } else if (header.id === 's1p-manually-blocked-header') {
                        const currentSettings = getSettings();
                        const isNowExpanded = !currentSettings.showManuallyBlockedList;
                        currentSettings.showManuallyBlockedList = isNowExpanded;
                        saveSettings(currentSettings);

                        header.querySelector('.s1p-expander-arrow').classList.toggle('expanded', isNowExpanded);
                        tabs['threads'].querySelector('#s1p-manually-blocked-list-container').classList.toggle('expanded', isNowExpanded);
                    }
                } else if (target.id === 's1p-keyword-rule-add-btn') {
                    const container = tabs['threads'].querySelector('#s1p-keyword-rules-list');
                    const emptyMsg = container.querySelector('.s1p-empty');
                    if (emptyMsg) emptyMsg.remove();

                    const newItem = document.createElement('div');
                    newItem.className = 's1p-editor-item';
                    newItem.dataset.ruleId = `new_${Date.now()}`;
                    newItem.innerHTML = `
                        <label class="s1p-switch"><input type="checkbox" class="s1p-settings-checkbox s1p-keyword-rule-enable" checked><span class="s1p-slider"></span></label>
                        <input type="text" class="s1p-keyword-rule-pattern" placeholder="输入关键字或正则表达式" value="">
                        <div class="s1p-editor-item-controls">
                            <button class="s1p-editor-btn s1p-keyword-rule-delete" title="删除规则"></button>
                        </div>
                    `;
                    container.appendChild(newItem);
                    newItem.querySelector('input[type="text"]').focus();
                } else if (target.classList.contains('s1p-keyword-rule-delete')) {
                    const item = target.closest('.s1p-editor-item');
                    item.remove();
                    const container = tabs['threads'].querySelector('#s1p-keyword-rules-list');
                    if (container.children.length === 0) {
                        container.innerHTML = `<div class="s1p-empty" style="padding: 12px;">暂无规则</div>`;
                    }
                } else if (target.id === 's1p-keyword-rules-save-btn') {
                    saveKeywordRules();
                    showMessage('规则已保存！', true);
                }
            });
        };

        const renderGeneralSettingsTab = () => {
            const settings = getSettings();
            tabs['general-settings'].innerHTML = `
                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">功能开关</div>
                    
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-openThreadsInNewTab">在新窗口打开帖子</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-openThreadsInNewTab" class="s1p-settings-checkbox" data-setting="openThreadsInNewTab" ${settings.openThreadsInNewTab ? 'checked' : ''}><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item" id="s1p-openThreadsInBackground-item" style="padding-left: 20px; ${!settings.openThreadsInNewTab ? 'display: none;' : ''}">
                        <label class="s1p-settings-label" for="s1p-openThreadsInBackground">后台打开 (不激活新标签页)</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-openThreadsInBackground" class="s1p-settings-checkbox" data-setting="openThreadsInBackground" ${settings.openThreadsInBackground ? 'checked' : ''}><span class="s1p-slider"></span></label>
                    </div>

                     <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-enableReadProgress">启用阅读进度跟踪</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-enableReadProgress" data-feature="enableReadProgress" class="s1p-feature-toggle" ${settings.enableReadProgress ? 'checked' : ''}><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item" id="s1p-readingProgressCleanupContainer" style="padding-left: 20px; ${!settings.enableReadProgress ? 'display: none;' : ''}">
                        <label class="s1p-settings-label">自动清理超过以下时间的阅读记录</label>
                        <div id="s1p-readingProgressCleanupDays-control" class="s1p-segmented-control">
                            <div class="s1p-segmented-control-slider"></div>
                            <div class="s1p-segmented-control-option ${settings.readingProgressCleanupDays == 30 ? 'active' : ''}" data-value="30">1个月</div>
                            <div class="s1p-segmented-control-option ${settings.readingProgressCleanupDays == 90 ? 'active' : ''}" data-value="90">3个月</div>
                            <div class="s1p-segmented-control-option ${settings.readingProgressCleanupDays == 180 ? 'active' : ''}" data-value="180">6个月</div>
                            <div class="s1p-segmented-control-option ${settings.readingProgressCleanupDays == 0 ? 'active' : ''}" data-value="0">永不</div>
                        </div>
                    </div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-openProgressInNewTab">在新窗口打开阅读进度</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-openProgressInNewTab" class="s1p-settings-checkbox" data-setting="openProgressInNewTab" ${settings.openProgressInNewTab ? 'checked' : ''}><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item" id="s1p-openProgressInBackground-item" style="padding-left: 20px; ${!settings.openProgressInNewTab ? 'display: none;' : ''}">
                        <label class="s1p-settings-label" for="s1p-openProgressInBackground">后台打开 (不激活新标签页)</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-openProgressInBackground" class="s1p-settings-checkbox" data-setting="openProgressInBackground" ${settings.openProgressInBackground ? 'checked' : ''}><span class="s1p-slider"></span></label>
                    </div>
                     <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-hideImagesByDefault">默认隐藏帖子图片</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-hideImagesByDefault" class="s1p-settings-checkbox" data-setting="hideImagesByDefault" ${settings.hideImagesByDefault ? 'checked' : ''}><span class="s1p-slider"></span></label>
                    </div>
                </div>
                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">通用设置</div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-changeLogoLink">修改论坛Logo链接 (指向论坛首页)</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-changeLogoLink" class="s1p-settings-checkbox" data-setting="changeLogoLink" ${settings.changeLogoLink ? 'checked' : ''}><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-hideBlacklistTip">隐藏已屏蔽用户发言的黄条提示</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-hideBlacklistTip" class="s1p-settings-checkbox" data-setting="hideBlacklistTip" ${settings.hideBlacklistTip ? 'checked' : ''}><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-customTitleSuffix">自定义标题后缀</label>
                        <input type="text" id="s1p-customTitleSuffix" class="s1p-title-suffix-input" data-setting="customTitleSuffix" value="${settings.customTitleSuffix || ''}" style="width: 200px;">
                    </div>
                </div>`;

            // [NEW] Function to position the slider
            const moveSlider = (control, retries = 3) => { // 新增一个重试计数器
                if (!control || retries <= 0) return; // 如果重试次数用尽，则停止

                const slider = control.querySelector('.s1p-segmented-control-slider');
                const activeOption = control.querySelector('.s1p-segmented-control-option.active');

                if (slider && activeOption) {
                    const width = activeOption.offsetWidth;
                    // 如果获取到的宽度无效 (为0)，则延迟后重试
                    if (width === 0) {
                        setTimeout(() => moveSlider(control, retries - 1), 50); // 50毫秒后重试
                        return;
                    }
                    slider.style.width = `${width}px`;
                    slider.style.left = `${activeOption.offsetLeft}px`;
                }
            };

            // 为“在新窗口打开”开关添加事件，以控制“后台打开”的可见性
            const openInNewTabCheckbox = tabs['general-settings'].querySelector('#s1p-openProgressInNewTab');
            const openInBackgroundItem = tabs['general-settings'].querySelector('#s1p-openProgressInBackground-item');
            const openThreadsInNewTabCheckbox = tabs['general-settings'].querySelector('#s1p-openThreadsInNewTab');
            const openThreadsInBackgroundItem = tabs['general-settings'].querySelector('#s1p-openThreadsInBackground-item');

            openInNewTabCheckbox.addEventListener('change', (e) => {
                openInBackgroundItem.style.display = e.target.checked ? 'flex' : 'none';
            });
            openThreadsInNewTabCheckbox.addEventListener('change', (e) => {
                openThreadsInBackgroundItem.style.display = e.target.checked ? 'flex' : 'none';
            });

            const cleanupControl = tabs['general-settings'].querySelector('#s1p-readingProgressCleanupDays-control');
            if (cleanupControl) {
                // Initialize slider position
                setTimeout(() => moveSlider(cleanupControl), 0);

                cleanupControl.addEventListener('click', (e) => {
                    const target = e.target.closest('.s1p-segmented-control-option');
                    if (!target || target.classList.contains('active')) return;

                    const newValue = parseInt(target.dataset.value, 10);

                    const currentSettings = getSettings();
                    currentSettings.readingProgressCleanupDays = newValue;
                    saveSettings(currentSettings);

                    // Update UI
                    cleanupControl.querySelectorAll('.s1p-segmented-control-option').forEach(opt => opt.classList.remove('active'));
                    target.classList.add('active');

                    // Move slider to new position
                    moveSlider(cleanupControl);
                });
            }


            // 总的设置变更事件监听
            tabs['general-settings'].addEventListener('change', e => {
                const target = e.target;
                const settingKey = target.dataset.setting;
                if (settingKey) {
                    const settings = getSettings();
                    if (target.type === 'checkbox') {
                        settings[settingKey] = target.checked;
                    } else if (target.type === 'number' || target.tagName === 'SELECT') {
                        settings[settingKey] = parseInt(target.value, 10);
                    } else {
                        settings[settingKey] = target.value;
                    }
                    saveSettings(settings);
                    applyInterfaceCustomizations();

                    if (settingKey === 'hideImagesByDefault') {
                        applyImageHiding();
                        manageImageToggleAllButtons();
                    }

                    if (settingKey === 'openThreadsInNewTab' || settingKey === 'openThreadsInBackground') {
                        applyThreadLinkBehavior();
                        applyPageLinkBehavior();
                    }

                    // [FIX] 如果是阅读进度相关的设置变更，则立即刷新按钮
                    if (settingKey === 'openProgressInNewTab' || settingKey === 'openProgressInBackground') {
                        removeProgressJumpButtons();
                        addProgressJumpButtons();
                    }
                }
            });
        };

        const renderNavSettingsTab = () => {
            const settings = getSettings();
            tabs['nav-settings'].innerHTML = `
                <div class="s1p-settings-group">
                    <div class="s1p-settings-item" style="padding: 0;">
                        <label class="s1p-settings-label" for="s1p-enableNavCustomization">启用自定义导航栏</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-enableNavCustomization" class="s1p-settings-checkbox" ${settings.enableNavCustomization ? 'checked' : ''}><span class="s1p-slider"></span></label>
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

            const navListContainer = tabs['nav-settings'].querySelector('.s1p-nav-editor-list');
            const renderNavList = (links) => {
                navListContainer.innerHTML = (links || []).map((link, index) => `
                    <div class="s1p-editor-item" draggable="true" data-index="${index}" style="grid-template-columns: auto 1fr 1fr auto; user-select: none;">
                        <div class="s1p-drag-handle">::</div>
                        <input type="text" class="s1p-nav-name" placeholder="名称" value="${link.name || ''}">
                        <input type="text" class="s1p-nav-href" placeholder="链接" value="${link.href || ''}">
                        <div class="s1p-editor-item-controls"><button class="s1p-editor-btn" data-action="delete" title="删除链接"></button></div>
                    </div>`).join('');
            };

            renderNavList(settings.customNavLinks);

            let draggedItem = null;
            navListContainer.addEventListener('dragstart', e => {
                if (e.target.classList.contains('s1p-editor-item')) {
                    draggedItem = e.target;
                    setTimeout(() => {
                        e.target.classList.add('s1p-dragging');
                    }, 0);
                }
            });

            navListContainer.addEventListener('dragend', e => {
                if (draggedItem) {
                    draggedItem.classList.remove('s1p-dragging');
                    draggedItem = null;
                }
            });

            navListContainer.addEventListener('dragover', e => {
                e.preventDefault();
                if (!draggedItem) return;

                const container = e.currentTarget;
                const otherItems = [...container.querySelectorAll('.s1p-editor-item:not(.s1p-dragging)')];

                const nextSibling = otherItems.find(item => {
                    const rect = item.getBoundingClientRect();
                    return e.clientY < rect.top + rect.height / 2;
                });

                if (nextSibling) {
                    container.insertBefore(draggedItem, nextSibling);
                } else {
                    container.appendChild(draggedItem);
                }
            });

            tabs['nav-settings'].addEventListener('click', e => {
                const target = e.target;
                if (target.id === 's1p-nav-add-btn') {
                    const newItem = document.createElement('div');
                    newItem.className = 's1p-editor-item'; newItem.draggable = true;
                    newItem.style.gridTemplateColumns = 'auto 1fr 1fr auto';
                    newItem.innerHTML = `<div class="s1p-drag-handle">::</div><input type="text" class="s1p-nav-name" placeholder="新链接"><input type="text" class="s1p-nav-href" placeholder="forum.php"><div class="s1p-editor-item-controls"><button class="s1p-editor-btn" data-action="delete" title="删除链接"></button></div>`;
                    navListContainer.appendChild(newItem);
                } else if (target.dataset.action === 'delete') {
                    target.closest('.s1p-editor-item').remove();
                } else if (target.id === 's1p-nav-restore-btn') {
                    const currentSettings = getSettings();
                    currentSettings.enableNavCustomization = defaultSettings.enableNavCustomization;
                    currentSettings.customNavLinks = defaultSettings.customNavLinks;
                    saveSettings(currentSettings);
                    renderNavSettingsTab();
                    applyInterfaceCustomizations();
                    initializeNavbar();
                    showMessage('导航栏已恢复为默认设置！', true);
                } else if (target.id === 's1p-settings-save-btn') {
                    const newSettings = {
                        ...getSettings(),
                        enableNavCustomization: tabs['nav-settings'].querySelector('#s1p-enableNavCustomization').checked,
                        customNavLinks: Array.from(navListContainer.querySelectorAll('.s1p-editor-item')).map(item => ({ name: item.querySelector('.s1p-nav-name').value.trim(), href: item.querySelector('.s1p-nav-href').value.trim() })).filter(l => l.name && l.href)
                    };
                    saveSettings(newSettings);
                    applyInterfaceCustomizations();
                    initializeNavbar();
                    showMessage('设置已保存！', true);
                }
            });
        };

        // --- 初始化渲染和事件绑定 ---
        renderGeneralSettingsTab();
        renderThreadTab();
        renderUserTab();
        renderTagsTab();
        renderNavSettingsTab();

        modal.addEventListener('change', e => {
            const target = e.target;
            const settings = getSettings();
            const featureKey = target.dataset.feature;

            if (featureKey && target.classList.contains('s1p-feature-toggle')) {
                const isChecked = target.checked;
                settings[featureKey] = isChecked;

                const contentWrapper = target.closest('.s1p-settings-item')?.nextElementSibling;
                if (contentWrapper && contentWrapper.classList.contains('s1p-feature-content')) {
                    contentWrapper.classList.toggle('expanded', isChecked);
                }
                saveSettings(settings);

                switch (featureKey) {
                    case 'enablePostBlocking':
                        isChecked ? addBlockButtonsToThreads() : removeBlockButtonsFromThreads();
                        break;
                    case 'enableUserBlocking':
                        refreshAllAuthiActions();
                        isChecked ? hideBlockedUsersPosts() : Object.keys(getBlockedUsers()).forEach(showUserPosts);
                        hideBlockedUserQuotes();
                        hideBlockedUserRatings();
                        break;
                    case 'enableUserTagging':
                        refreshAllAuthiActions();
                        break;
                    case 'enableReadProgress':
                        // [MODIFIED] Link visibility of cleanup settings to this toggle
                        const cleanupItem = document.getElementById('s1p-readingProgressCleanupContainer');
                        if (cleanupItem) cleanupItem.style.display = isChecked ? 'flex' : 'none';

                        isChecked ? addProgressJumpButtons() : removeProgressJumpButtons();
                        break;
                }
                return;
            }
            else if (target.matches('.s1p-user-thread-block-toggle')) {
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
            }
            else if (target.matches('#s1p-blockThreadsOnUserBlock')) {
                const currentSettings = getSettings();
                currentSettings.blockThreadsOnUserBlock = target.checked;
                saveSettings(currentSettings);
            }
        });

        modal.addEventListener('click', async (e) => {
            const target = e.target;
            if (e.target.matches('.s1p-modal, .s1p-modal-close')) modal.remove();
            if (e.target.matches('.s1p-tab-btn')) {
                modal.querySelectorAll('.s1p-tab-btn, .s1p-tab-content').forEach(el => el.classList.remove('active'));
                e.target.classList.add('active');
                const activeTab = tabs[e.target.dataset.tab];
                if (activeTab) activeTab.classList.add('active');
            }
            const unblockThreadId = e.target.dataset.unblockThreadId; if (unblockThreadId) { unblockThread(unblockThreadId); renderThreadTab(); }
            const unblockUserId = e.target.dataset.unblockUserId; if (unblockUserId) { unblockUser(unblockUserId); renderUserTab(); renderThreadTab(); }

            // --- 本地备份与恢复事件 (已优化) ---
            const syncTextarea = modal.querySelector('#s1p-local-sync-textarea');
            if (e.target.id === 's1p-local-export-btn') {
                const dataToExport = exportLocalData();
                syncTextarea.value = dataToExport;
                syncTextarea.select();
                // --- [OPTIMIZED] 使用新的 Clipboard API ---
                navigator.clipboard.writeText(dataToExport).then(() => {
                    showMessage('数据已导出并复制到剪贴板', true);
                }).catch(() => {
                    showMessage('自动复制失败，请手动复制', false);
                });
            }
            if (e.target.id === 's1p-local-import-btn') {
                const jsonStr = syncTextarea.value.trim();
                if (!jsonStr) return showMessage('请先粘贴要导入的数据', false);
                const result = importLocalData(jsonStr);
                showMessage(result.message, result.success);
                if (result.success) {
                    renderThreadTab();
                    renderUserTab();
                    renderGeneralSettingsTab();
                    renderTagsTab();
                }
            }
            if (e.target.id === 's1p-clear-select-all') {
                const isChecked = e.target.checked;
                modal.querySelectorAll('.s1p-clear-data-checkbox').forEach(chk => chk.checked = isChecked);
            }

            if (e.target.id === 's1p-clear-selected-btn') {
                const selectedKeys = Array.from(modal.querySelectorAll('.s1p-clear-data-checkbox:checked')).map(chk => chk.dataset.clearKey);
                if (selectedKeys.length === 0) {
                    return showMessage('请至少选择一个要清除的数据项。', false);
                }

                const itemsToClear = selectedKeys.map(key => `“${dataClearanceConfig[key].label}”`).join('、');

                createConfirmationModal(
                    '确认要清除所选数据吗？',
                    `即将删除 ${itemsToClear} 的所有数据，此操作不可逆！`,
                    () => {
                        selectedKeys.forEach(key => {
                            if (dataClearanceConfig[key]) {
                                dataClearanceConfig[key].clear();
                            }
                        });

                        // [FIXED] 清除设置后，立即更新UI
                        if (selectedKeys.includes('settings')) {
                            modal.querySelector('#s1p-remote-enabled-toggle').checked = false;
                            modal.querySelector('#s1p-remote-gist-id-input').value = '';
                            modal.querySelector('#s1p-remote-pat-input').value = '';
                            updateRemoteSyncInputsState();
                        }

                        // 全局刷新
                        hideBlockedThreads();
                        hideBlockedUsersPosts();
                        applyUserThreadBlocklist();
                        hideThreadsByTitleKeyword();
                        initializeNavbar();
                        applyInterfaceCustomizations();
                        document.querySelectorAll('.s1p-progress-container').forEach(el => el.remove());

                        // 重新渲染所有标签页
                        renderThreadTab();
                        renderUserTab();
                        renderGeneralSettingsTab();
                        renderTagsTab();
                        showMessage('选中的本地数据已成功清除。', true);
                    },
                    '确认清除'
                );
            }

            // --- [FIXED] 远程同步设置保存事件（不再错误地更新时间戳） ---
            if (e.target.id === 's1p-remote-save-btn') {
                const currentSettings = getSettings();
                currentSettings.syncRemoteEnabled = modal.querySelector('#s1p-remote-enabled-toggle').checked;
                currentSettings.syncRemoteGistId = modal.querySelector('#s1p-remote-gist-id-input').value.trim();
                currentSettings.syncRemotePat = modal.querySelector('#s1p-remote-pat-input').value.trim();

                // 直接保存设置，但不调用会触发时间戳更新的 saveSettings() 函数
                GM_setValue('s1p_settings', currentSettings);

                showMessage('远程同步设置已保存。', true);
            }

            // --- [NEW] 手动同步逻辑，带用户选择 ---
            if (e.target.id === 's1p-remote-manual-sync-btn') {
                handleManualSync(e.target);
            }
            
            // --- [NEW] 打开 Gist 页面 ---
            if (e.target.id === 's1p-open-gist-page-btn') {
                const gistId = modal.querySelector('#s1p-remote-gist-id-input').value.trim();
                if (gistId) {
                    GM_openInTab(`https://gist.github.com/${gistId}`, true);
                } else {
                    showMessage('请先填写 Gist ID。', false);
                }
            }


            // --- [NEW] 用户标记标签页专属事件 ---
            const targetTab = target.closest('#s1p-tab-tags');
            if (targetTab) {
                const action = target.dataset.action;
                const userId = target.dataset.userId;

                if (action === 'edit-tag-item') renderTagsTab({ editingUserId: userId });
                if (action === 'cancel-tag-edit') renderTagsTab();

                if (action === 'delete-tag-item') {
                    const userName = target.dataset.userName;
                    createConfirmationModal(`确认删除对 "${userName}" 的标记吗?`, '此操作不可撤销。', () => {
                        const tags = getUserTags();
                        delete tags[userId];
                        saveUserTags(tags);
                        renderTagsTab();
                        refreshAllAuthiActions();
                        showMessage(`已删除对 ${userName} 的标记。`, true);
                    }, '确认删除');
                }
                else if (action === 'save-tag-edit') {
                    const userName = target.dataset.userName;
                    const newTag = targetTab.querySelector(`.s1p-item[data-user-id="${userId}"] .s1p-tag-edit-area`).value.trim();
                    const tags = getUserTags();
                    if (newTag) {
                        tags[userId] = { ...tags[userId], tag: newTag, timestamp: Date.now(), name: userName };
                        saveUserTags(tags);
                        renderTagsTab();
                        refreshAllAuthiActions();
                        showMessage(`已更新对 ${userName} 的标记。`, true);
                    } else {
                        createConfirmationModal(`标记内容为空`, '您希望删除对该用户的标记吗？', () => {
                            delete tags[userId];
                            saveUserTags(tags);
                            renderTagsTab();
                            refreshAllAuthiActions();
                            showMessage(`已删除对 ${userName} 的标记。`, true);
                        }, '确认删除');
                    }
                }
                else if (target.id === 's1p-export-tags-btn') {
                    const textarea = targetTab.querySelector('#s1p-tags-sync-textarea');
                    const dataToExport = JSON.stringify(getUserTags(), null, 2);
                    textarea.value = dataToExport;
                    textarea.select();
                    // --- [OPTIMIZED] 使用新的 Clipboard API ---
                    navigator.clipboard.writeText(dataToExport).then(() => {
                        showMessage('用户标记已导出并复制到剪贴板。', true);
                    }).catch(() => {
                        showMessage('复制失败，请手动复制。', false);
                    });
                }
                else if (target.id === 's1p-import-tags-btn') {
                    const textarea = targetTab.querySelector('#s1p-tags-sync-textarea');
                    const jsonStr = textarea.value.trim();
                    if (!jsonStr) return showMessage('请先粘贴要导入的数据。', false);

                    try {
                        const imported = JSON.parse(jsonStr);
                        if (typeof imported !== 'object' || imported === null || Array.isArray(imported)) throw new Error("无效数据格式，应为一个对象。");
                        for (const key in imported) {
                            const item = imported[key];
                            if (typeof item !== 'object' || item === null || typeof item.tag === 'undefined' || typeof item.name === 'undefined') throw new Error(`用户 #${key} 的数据格式不正确。`);
                        }
                        createConfirmationModal('确认导入用户标记吗？', '导入的数据将覆盖现有相同用户的标记。', () => {
                            const currentTags = getUserTags();
                            const mergedTags = { ...currentTags, ...imported };
                            saveUserTags(mergedTags);
                            renderTagsTab();
                            showMessage(`成功导入/更新 ${Object.keys(imported).length} 条用户标记。`, true);
                            textarea.value = '';
                        }, '确认导入');
                    } catch (e) { showMessage(`导入失败: ${e.message}`, false); }
                }
            }
        });
    };

    // --- [MODIFIED] 手动同步处理流程 ---
    const handleManualSync = async (anchorEl) => {
        const settings = getSettings();
        if (!settings.syncRemoteEnabled || !settings.syncRemoteGistId || !settings.syncRemotePat) {
            showMessage('远程同步未启用或配置不完整。', false);
            return;
        }

        showMessage('正在检查云端数据...', true);

        try {
            const remoteData = await fetchRemoteData();
            const remoteTimestamp = remoteData.lastUpdated || 0;
            const localTimestamp = GM_getValue('s1p_last_modified', 0);

            // [MODIFIED] 仅在数据不一致时弹出选择框
            if (remoteTimestamp === localTimestamp) {
                showMessage('数据已是最新，无需同步。', true);
                GM_setValue('s1p_last_sync_timestamp', Date.now());
                updateLastSyncTimeDisplay();
                return;
            }

            const formatForDisplay = (ts) => {
                if (!ts) return "无记录 (新设备)";
                const date = new Date(ts);
                return `${date.toLocaleString('zh-CN', { hour12: false })} <span class="s1p-sync-choice-newer">${(ts > 0 && Date.now() - ts < 60000 ? '(刚刚)' : '')}</span>`;
            };

            const localNewer = localTimestamp > remoteTimestamp;

            const bodyHtml = `
                <p>检测到本地数据与云端备份不一致，请选择同步方式：</p>
                <div class="s1p-sync-choice-info">
                    <div class="s1p-sync-choice-info-row">
                       <span class="s1p-sync-choice-info-label">本地数据更新于:</span>
                       <span class="s1p-sync-choice-info-time ${localNewer ? 's1p-sync-choice-newer' : ''}">${formatForDisplay(localTimestamp)}</span>
                    </div>
                     <div class="s1p-sync-choice-info-row">
                       <span class="s1p-sync-choice-info-label">云端备份更新于:</span>
                       <span class="s1p-sync-choice-info-time ${!localNewer ? 's1p-sync-choice-newer' : ''}">${formatForDisplay(remoteTimestamp)}</span>
                    </div>
                </div>
            `;

            const pullAction = {
                text: '从云端拉取 (覆盖本地)', className: 's1p-confirm', action: async () => {
                    showMessage('正在从云端拉取数据...', true);
                    const result = importLocalData(JSON.stringify(remoteData));
                    if (result.success) {
                        GM_setValue('s1p_last_sync_timestamp', Date.now());
                        updateLastSyncTimeDisplay();
                        showMessage('拉取成功！已从云端恢复数据。', true);
                        if (document.querySelector('.s1p-modal')) {
                            document.querySelector('.s1p-modal-close').click();
                            createManagementModal();
                            document.querySelector('button[data-tab="sync"]').click();
                        }
                    } else {
                        showMessage(`拉取失败: ${result.message}`, false);
                    }
                }
            };

            const pushAction = {
                text: '向云端推送 (覆盖云端)', className: 's1p-confirm', action: async () => {
                    showMessage('正在向云端推送数据...', true);
                    try {
                        const localData = exportLocalDataObject();
                        await pushRemoteData(localData);
                        GM_setValue('s1p_last_sync_timestamp', Date.now());
                        updateLastSyncTimeDisplay();
                        showMessage('推送成功！已更新云端备份。', true);
                    } catch (e) {
                        showMessage(`推送失败: ${e.message}`, false);
                    }
                }
            };

            const cancelAction = { text: '取消', className: 's1p-cancel', action: null };

            createAdvancedConfirmationModal('手动同步选择方式', bodyHtml, [pullAction, pushAction, cancelAction]);

        } catch (error) {
            showMessage(`操作失败: ${error.message}`, false);
        }
    };

    // --- [MODIFIED] 更通用的确认弹窗，支持完全自定义按钮和内容 ---
    const createAdvancedConfirmationModal = (title, bodyHtml, buttons) => {
        document.querySelector('.s1p-confirm-modal')?.remove();
        const modal = document.createElement('div');
        modal.className = 's1p-confirm-modal';

        const footerButtons = buttons.map((btn, index) =>
            `<button class="s1p-confirm-btn ${btn.className || ''}" data-btn-index="${index}">${btn.text}</button>`
        ).join('');

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

        const closeModal = () => { modal.querySelector('.s1p-confirm-content').style.animation = 's1p-scale-out 0.25s ease-out forwards'; modal.style.animation = 's1p-fade-out 0.25s ease-out forwards'; setTimeout(() => modal.remove(), 250); };

        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        buttons.forEach((btn, index) => {
            const buttonEl = modal.querySelector(`[data-btn-index="${index}"]`);
            if (buttonEl) {
                buttonEl.addEventListener('click', () => {
                    if (btn.action) btn.action();
                    closeModal(); // Always close the modal after a button click
                });
            }
        });

        document.body.appendChild(modal);
    };


    // --- [REPLACED] 帖子屏蔽交互逻辑重构 ---
    const addBlockButtonsToThreads = () => {
        document.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]').forEach(row => {
            const tr = row.querySelector('tr');
            if (!tr || row.querySelector('.s1p-options-cell') || tr.classList.contains('ts') || tr.classList.contains('th')) return;

            const titleElement = row.querySelector('th a.s.xst');
            if (!titleElement) return;

            const threadId = row.id.replace(/^(normalthread_|stickthread_)/, '');
            const threadTitle = titleElement.textContent.trim();

            const optionsCell = document.createElement('td');
            optionsCell.className = 's1p-options-cell';

            // 1. 创建三点操作按钮
            const optionsBtn = document.createElement('div');
            optionsBtn.className = 's1p-options-btn';
            optionsBtn.title = '屏蔽此贴';
            optionsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;

            // 2. 创建弹出菜单
            const optionsMenu = document.createElement('div');
            optionsMenu.className = 's1p-options-menu';

            // --- 创建直接确认UI ---
            const directConfirmContainer = document.createElement('div');
            directConfirmContainer.className = 's1p-direct-confirm';

            const confirmText = document.createElement('span');
            confirmText.textContent = '屏蔽该帖子吗？';

            const separator = document.createElement('span');
            separator.className = 's1p-confirm-separator';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 's1p-confirm-action-btn s1p-cancel';
            cancelBtn.title = '取消';

            const confirmBtn = document.createElement('button');
            confirmBtn.className = 's1p-confirm-action-btn s1p-confirm';
            confirmBtn.title = '确认屏蔽';

            // --- [最终修复] 为取消按钮添加事件监听 ---
            cancelBtn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();

                const parentCell = e.currentTarget.closest('.s1p-options-cell');
                if (parentCell) {
                    // 步骤1：立即用JS强制隐藏，确保视觉上消失
                    optionsMenu.style.visibility = 'hidden';
                    optionsMenu.style.opacity = '0';

                    // 步骤2：立即禁用鼠标事件，强制:hover状态重置
                    parentCell.style.pointerEvents = 'none';

                    // 步骤3：在动画结束后，清除所有临时添加的样式，让组件恢复原状
                    setTimeout(() => {
                        optionsMenu.style.removeProperty('visibility');
                        optionsMenu.style.removeProperty('opacity');
                        parentCell.style.removeProperty('pointer-events');
                    }, 200);
                }
            });

            // 组装直接确认UI
            directConfirmContainer.appendChild(confirmText);
            directConfirmContainer.appendChild(separator);
            directConfirmContainer.appendChild(cancelBtn);
            directConfirmContainer.appendChild(confirmBtn);

            // 将UI添加到菜单
            optionsMenu.appendChild(directConfirmContainer);

            // 组装单元格
            optionsCell.appendChild(optionsBtn);
            optionsCell.appendChild(optionsMenu);

            // 6. 将新的操作单元格插入到行首
            tr.prepend(optionsCell);

            // --- 事件监听 ---
            confirmBtn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                blockThread(threadId, threadTitle);
            });

            // --- [S1P-FIX] 修复因添加新列导致的表头和分隔行错位问题 ---
            // 修正表头，将第一格的列合并数（colspan）从2增加到3
            const headerTh = document.querySelector('#threadlist > .th th:first-child');
            if (headerTh) {
                headerTh.colSpan = 3;
            }

            // 修正“版块主题”分隔行，为其在最前面添加一个空的单元格
            const separatorRow = document.querySelector('#separatorline > tr.ts');
            if (separatorRow && separatorRow.childElementCount < 6) {
                const emptyTd = document.createElement('td');
                separatorRow.prepend(emptyTd);
            }
            // --- 修复结束 ---

        });
    };


    // [MODIFIED] 根据用户需求，简化了浮窗逻辑
    const initializeTaggingPopover = () => {
        let popover = document.getElementById('s1p-tag-popover-main');
        if (!popover) {
            popover = document.createElement('div');
            popover.id = 's1p-tag-popover-main';
            popover.className = 's1p-tag-popover';
            document.body.appendChild(popover);
        }

        let hideTimeout, showTimeout;
        let isComposing = false;
        let currentAnchorElement = null;

        const startHideTimer = () => {
            if (isComposing) return;
            clearTimeout(showTimeout);
            clearTimeout(hideTimeout);
            hideTimeout = setTimeout(() => popover.classList.remove('visible'), 300);
        };

        const cancelHideTimer = () => clearTimeout(hideTimeout);

        const repositionPopover = (anchorElement) => {
            if (!anchorElement) return;
            const rect = anchorElement.getBoundingClientRect();
            const popoverRect = popover.getBoundingClientRect();

            let top = rect.bottom + window.scrollY + 5;
            let left = rect.left + window.scrollX;

            // Adjust if it goes off-screen
            if ((left + popoverRect.width) > (window.innerWidth - 10)) {
                left = window.innerWidth - popoverRect.width - 10;
            }
            if (left < 10) {
                left = 10;
            }

            popover.style.top = `${top}px`;
            popover.style.left = `${left}px`;
        };

        const renderEditMode = (userName, userId, currentTag = '') => {
            popover.innerHTML = `
                 <div class="s1p-popover-content">
                    <div class="s1p-edit-mode-header">为 ${userName} ${currentTag ? '编辑' : '添加'}标记</div>
                    <textarea class="s1p-edit-mode-textarea s1p-textarea" placeholder="输入标记内容...">${currentTag}</textarea>
                    <div class="s1p-edit-mode-actions">
                        <button class="s1p-btn" data-action="cancel-edit">取消</button>
                        <button class="s1p-btn" data-action="save">保存</button>
                    </div>
                </div>`;
            popover.querySelector('textarea').focus();
        };

        const show = (anchorElement, userId, userName, userAvatar, delay = 0, startInEditMode = false) => {
            cancelHideTimer();
            clearTimeout(showTimeout);

            showTimeout = setTimeout(() => {
                currentAnchorElement = anchorElement;
                popover.dataset.userId = userId;
                popover.dataset.userName = userName;
                popover.dataset.userAvatar = userAvatar;

                // Per user request, always go to edit mode.
                const userTags = getUserTags();
                renderEditMode(userName, userId, userTags[userId]?.tag || '');

                popover.classList.add('visible');
                repositionPopover(anchorElement);
            }, delay);
        };

        popover.show = show; // Expose the show function

        popover.addEventListener('click', (e) => {
            const target = e.target.closest('button[data-action]');
            if (!target) return;

            const { userId, userName } = popover.dataset;
            const userTags = getUserTags();

            switch (target.dataset.action) {
                case 'save':
                    const newTag = popover.querySelector('textarea').value.trim();
                    if (newTag) {
                        userTags[userId] = { name: userName, tag: newTag, timestamp: Date.now() };
                    } else {
                        delete userTags[userId];
                    }
                    saveUserTags(userTags);
                    refreshAllAuthiActions();
                    popover.classList.remove('visible');
                    break;
                case 'cancel-edit':
                    // Per user request, cancel closes the popover entirely.
                    popover.classList.remove('visible');
                    break;
            }
        });

        popover.addEventListener('mouseenter', cancelHideTimer);
        popover.addEventListener('mouseleave', startHideTimer);
        popover.addEventListener('compositionstart', () => isComposing = true);
        popover.addEventListener('compositionend', () => isComposing = false);
    };


    // --- [NEW/MODIFIED] 用户标记显示悬浮窗 ---
    const initializeTagDisplayPopover = () => {
        let popover = document.getElementById('s1p-tag-display-popover');
        if (!popover) {
            popover = document.createElement('div');
            popover.id = 's1p-tag-display-popover';
            popover.className = 's1p-tag-display-popover';
            document.body.appendChild(popover);
        }

        let showTimeout, hideTimeout;

        const show = (anchor, text) => {
            clearTimeout(hideTimeout);
            showTimeout = setTimeout(() => {
                popover.textContent = text;
                const rect = anchor.getBoundingClientRect();

                // 优先在上方显示
                let top = rect.top + window.scrollY - popover.offsetHeight - 6;
                let left = rect.left + window.scrollX + (rect.width / 2) - (popover.offsetWidth / 2);

                // 如果上方空间不足，则在下方显示
                if (top < window.scrollY) {
                    top = rect.bottom + window.scrollY + 6;
                }

                // 边界检测，防止穿出屏幕
                if (left < 10) left = 10;
                if (left + popover.offsetWidth > window.innerWidth) {
                    left = window.innerWidth - popover.offsetWidth - 10;
                }

                popover.style.top = `${top}px`;
                popover.style.left = `${left}px`;
                popover.classList.add('visible');
            }, 50);
        };

        const hide = () => {
            clearTimeout(showTimeout);
            hideTimeout = setTimeout(() => {
                popover.classList.remove('visible');
            }, 100);
        };

        // 使用事件委托来处理所有标记的悬停事件
        document.body.addEventListener('mouseover', e => {
            const tagDisplay = e.target.closest('.s1p-user-tag-display');
            // 仅当文本溢出且存在 data-full-tag 属性时才显示悬浮窗
            if (tagDisplay && tagDisplay.dataset.fullTag && tagDisplay.scrollWidth > tagDisplay.clientWidth) {
                show(tagDisplay, tagDisplay.dataset.fullTag);
            }
        });

        document.body.addEventListener('mouseout', e => {
            const tagDisplay = e.target.closest('.s1p-user-tag-display');
            if (tagDisplay) {
                hide();
            }
        });
    };


    const getTimeBasedColor = (hours) => {
        if (hours <= 1) return 'var(--s1p-progress-hot)';
        if (hours <= 24) return `rgb(${Math.round(192 - hours * 4)}, ${Math.round(51 + hours * 2)}, ${Math.round(34 + hours * 2)})`;
        if (hours <= 168) return `rgb(${Math.round(100 - (hours - 24) / 3)}, ${Math.round(100 + (hours - 24) / 4)}, ${Math.round(80 + (hours - 24) / 4)})`;
        return 'var(--s1p-progress-cold)';
    };

    const addProgressJumpButtons = () => {
        const settings = getSettings();
        const progressData = getReadProgress();
        if (Object.keys(progressData).length === 0) return;

        const now = Date.now();

        document.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]').forEach(row => {
            const container = row.querySelector('th');
            if (!container || container.querySelector('.s1p-progress-container')) return;

            const threadIdMatch = row.id.match(/(?:normalthread_|stickthread_)(\d+)/);
            if (!threadIdMatch) return;
            const threadId = threadIdMatch[1];

            const progress = progressData[threadId];
            if (progress && progress.page) {
                const { postId, page, timestamp, lastReadFloor: savedFloor } = progress;

                const hoursDiff = (now - (timestamp || 0)) / 3600000;
                const fcolor = getTimeBasedColor(hoursDiff);

                const replyEl = row.querySelector('td.num a.xi2');
                const currentReplies = replyEl ? parseInt(replyEl.textContent.replace(/,/g, '')) || 0 : 0;
                const latestFloor = currentReplies + 1;
                const newReplies = (savedFloor !== undefined && latestFloor > savedFloor) ? latestFloor - savedFloor : 0;

                const progressContainer = document.createElement('span');
                progressContainer.className = 's1p-progress-container';

                const jumpBtn = document.createElement('a');
                jumpBtn.className = 's1p-progress-jump-btn';

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

                jumpBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (settings.openProgressInNewTab) {
                        GM_openInTab(jumpBtn.href, { active: !settings.openProgressInBackground });
                    } else {
                        window.location.href = jumpBtn.href;
                    }
                });

                jumpBtn.addEventListener('mouseover', () => {
                    jumpBtn.style.backgroundColor = fcolor;
                    jumpBtn.style.color = 'var(--s1p-white)';
                });
                jumpBtn.addEventListener('mouseout', () => {
                    jumpBtn.style.backgroundColor = 'transparent';
                    jumpBtn.style.color = fcolor;
                });

                progressContainer.appendChild(jumpBtn);

                if (newReplies > 0) {
                    const newRepliesBadge = document.createElement('span');
                    newRepliesBadge.className = 's1p-new-replies-badge';
                    newRepliesBadge.textContent = `+${newReplies}`;
                    newRepliesBadge.title = `有 ${newReplies} 条新回复`;
                    newRepliesBadge.style.backgroundColor = fcolor;
                    newRepliesBadge.style.borderColor = fcolor;
                    progressContainer.appendChild(newRepliesBadge);
                    jumpBtn.style.borderTopRightRadius = '0';
                    jumpBtn.style.borderBottomRightRadius = '0';
                }

                container.appendChild(progressContainer);
            }
        });
    };

    const trackReadProgressInThread = () => {
        const settings = getSettings();
        if (!settings.enableReadProgress || !document.getElementById('postlist')) return;

        // --- [MODIFIED] Universal Thread ID & Page Number Extraction ---
        let threadId = null;

        // Method 1: Try extracting from URL (thread-xxx-x-x.html format)
        const threadIdMatch = window.location.href.match(/thread-(\d+)-/);
        if (threadIdMatch) {
            threadId = threadIdMatch[1];
        } else {
            // Method 2: Try extracting from URL query parameters (forum.php?mod=viewthread...)
            const params = new URLSearchParams(window.location.search);
            threadId = params.get('tid') || params.get('ptid');
        }

        // Method 3: Fallback to finding the thread ID from a hidden input in the page
        if (!threadId) {
            const tidInput = document.querySelector('input[name="tid"]#tid');
            if (tidInput) {
                threadId = tidInput.value;
            }
        }

        if (!threadId) return; // If no thread ID can be found, exit.

        // --- Page Number Extraction ---
        let currentPage = '1';
        const threadPageMatch = window.location.href.match(/thread-\d+-(\d+)-/);
        const params = new URLSearchParams(window.location.search);

        if (threadPageMatch) {
            currentPage = threadPageMatch[1];
        } else if (params.has('page')) {
            currentPage = params.get('page');
        } else {
            // Fallback for page number from pagination control if no param exists
            const currentPageElement = document.querySelector('div.pg strong');
            if (currentPageElement && !isNaN(currentPageElement.textContent.trim())) {
                currentPage = currentPageElement.textContent.trim();
            }
        }

        let visiblePosts = new Map();
        let saveTimeout;

        const getFloorFromElement = (el) => {
            const floorElement = el.querySelector('.pi em');
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
                updateThreadProgress(threadId, finalPostId, currentPage, maxFloor);
            }
        };

        const debouncedSave = () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(saveCurrentProgress, 1500); // 停止滚动1.5秒后保存
        };

        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                const postId = entry.target.id.replace('pid', '');
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
        }, { threshold: 0.1 });

        document.querySelectorAll('table[id^="pid"]').forEach(el => observer.observe(el));

        const finalSave = () => {
            clearTimeout(saveTimeout);
            saveCurrentProgress();
        };

        // 监听 visibilitychange 用于切换标签页或最小化
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                finalSave();
            }
        });

        // 监听 beforeunload 用于关闭页面或刷新
        window.addEventListener('beforeunload', finalSave);
    };

    const refreshAllAuthiActions = () => {
        document.querySelectorAll('.s1p-authi-actions-wrapper').forEach(el => el.remove());
        addActionsToPostFooter();
    };

    const createOptionsMenu = (anchorElement) => {
        // Remove any existing menu
        document.querySelector('.s1p-tag-options-menu')?.remove();

        const { userId, userName, userAvatar } = anchorElement.dataset;

        const menu = document.createElement('div');
        menu.className = 's1p-tag-options-menu';
        menu.innerHTML = `
            <button data-action="edit">编辑标记</button>
            <button data-action="delete" class="s1p-delete">删除标记</button>
        `;

        document.body.appendChild(menu);

        const rect = anchorElement.getBoundingClientRect();
        menu.style.top = `${rect.bottom + window.scrollY + 2}px`;
        menu.style.left = `${rect.right + window.scrollX - menu.offsetWidth}px`;

        const closeMenu = () => menu.remove();

        menu.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent the outside-click listener from firing immediately
            const action = e.target.dataset.action;

            if (action === 'edit') {
                const popover = document.getElementById('s1p-tag-popover-main');
                if (popover && popover.show) {
                    popover.show(anchorElement, userId, userName, userAvatar, 0, true);
                }
                closeMenu();
            } else if (action === 'delete') {
                // [MODIFIED] Replace menu content with confirmation UI
                menu.innerHTML = `
                    <div class="s1p-direct-confirm">
                        <span>确认删除？</span>
                        <span class="s1p-confirm-separator"></span>
                        <button class="s1p-confirm-action-btn s1p-cancel" title="取消"></button>
                        <button class="s1p-confirm-action-btn s1p-confirm" title="确认"></button>
                    </div>
                `;
                // Re-add event listeners for the new buttons
                menu.querySelector('.s1p-confirm').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const tags = getUserTags();
                    delete tags[userId];
                    saveUserTags(tags);
                    refreshAllAuthiActions();
                    closeMenu();
                });
                menu.querySelector('.s1p-cancel').addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeMenu();
                });
            }
        });

        // Close menu when clicking outside
        setTimeout(() => {
            document.addEventListener('click', closeMenu, { once: true });
        }, 0);
    };

    const addActionsToPostFooter = () => {
        const settings = getSettings();
        if (!settings.enableUserBlocking && !settings.enableUserTagging) return;

        document.querySelectorAll('div.authi a[href*="authorid="]').forEach(viewAuthorLink => {
            const authiDiv = viewAuthorLink.closest('.authi');
            if (!authiDiv) return;

            // --- Self-Healing: Clean up old/broken elements before proceeding ---
            authiDiv.querySelector('.s1p-authi-actions-wrapper')?.remove();
            const oldBlockLink = authiDiv.querySelector('a.s1p-block-user-in-authi:not(.s1p-authi-action)');
            if (oldBlockLink) {
                const precedingPipe = oldBlockLink.previousElementSibling;
                if (precedingPipe && precedingPipe.classList.contains('pipe')) precedingPipe.remove();
                oldBlockLink.remove();
            }

            const urlParams = new URLSearchParams(viewAuthorLink.href.split('?')[1]);
            const userId = urlParams.get('authorid');
            if (!userId) return;

            const postContainer = authiDiv.closest('td.plc');
            const plsCell = postContainer ? postContainer.previousElementSibling : null;
            if (!plsCell) return;

            const userLinkInPi = plsCell.querySelector(`.pi .authi a[href*="space-uid-${userId}"]`);
            const userName = userLinkInPi ? userLinkInPi.textContent.trim() : `用户 #${userId}`;
            const userAvatar = plsCell.querySelector('.avatar img')?.src;

            const wrapper = document.createElement('span');
            wrapper.className = 's1p-authi-actions-wrapper';

            // --- [S1P-FIX] Add listeners to prevent script buttons from triggering native hover effects ---
            // Only apply this fix if S1 NUX is not detected.
            if (!isS1NuxEnabled) {
                wrapper.addEventListener('mouseenter', () => {
                    const triangleSpan = authiDiv.querySelector('.none');
                    if (triangleSpan) {
                        triangleSpan.style.display = 'inline';
                    }
                });
                wrapper.addEventListener('mouseleave', () => {
                    const triangleSpan = authiDiv.querySelector('.none');
                    if (triangleSpan) {
                        triangleSpan.style.removeProperty('display');
                    }
                });
            }

            // --- Robust Width Calculation ---
            const authiRect = authiDiv.getBoundingClientRect();
            const lastElementRect = viewAuthorLink.getBoundingClientRect();
            let availableWidth = authiRect.right - lastElementRect.right - 15;

            if (settings.enableUserBlocking) {
                const pipe = document.createElement('span');
                pipe.className = 'pipe';
                pipe.textContent = '|';
                wrapper.appendChild(pipe);

                const blockLink = document.createElement('a');
                blockLink.href = 'javascript:void(0);';
                blockLink.textContent = '屏蔽该用户';
                blockLink.className = 's1p-authi-action s1p-block-user-in-authi';
                // [MODIFIED] Use inline confirm menu instead of modal
                blockLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const confirmText = getSettings().blockThreadsOnUserBlock
                        ? `屏蔽用户并隐藏其主题帖？`
                        : `确认屏蔽该用户？`;
                    createInlineConfirmMenu(e.currentTarget, confirmText, () => blockUser(userId, userName));
                });
                wrapper.appendChild(blockLink);
                availableWidth -= 85; // Estimated width for block link + pipe
            }

            if (settings.enableUserTagging) {
                const userTags = getUserTags();
                const userTag = userTags[userId];
                const pipe = document.createElement('span');
                pipe.className = 'pipe';
                pipe.textContent = '|';
                wrapper.appendChild(pipe);
                availableWidth -= 10; // Estimated width for pipe

                if (userTag && userTag.tag) {
                    const tagContainer = document.createElement('span');
                    tagContainer.className = 's1p-authi-action s1p-user-tag-container';

                    const fullTagText = userTag.tag;
                    const tagDisplay = document.createElement('span');
                    tagDisplay.className = 's1p-user-tag-display';
                    tagDisplay.textContent = `用户标记：${fullTagText}`;
                    tagDisplay.dataset.fullTag = fullTagText;
                    tagDisplay.removeAttribute('title');

                    const optionsIcon = document.createElement('span');
                    optionsIcon.className = 's1p-user-tag-options';
                    optionsIcon.innerHTML = '&#8942;';
                    optionsIcon.dataset.userId = userId;
                    optionsIcon.dataset.userName = userName;
                    optionsIcon.dataset.userAvatar = userAvatar;
                    optionsIcon.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        createOptionsMenu(e.currentTarget);
                    });

                    tagContainer.appendChild(tagDisplay);
                    tagContainer.appendChild(optionsIcon);

                    if (availableWidth > 50) {
                        tagContainer.style.maxWidth = `${availableWidth}px`;
                    }

                    wrapper.appendChild(tagContainer);
                } else {
                    const tagLink = document.createElement('a');
                    tagLink.href = 'javascript:void(0);';
                    tagLink.textContent = '标记该用户';
                    tagLink.className = 's1p-authi-action s1p-tag-user-in-authi';
                    tagLink.addEventListener('click', (e) => {
                        e.preventDefault();
                        const popover = document.getElementById('s1p-tag-popover-main');
                        if (popover && popover.show) {
                            popover.show(e.currentTarget, userId, userName, userAvatar, 0, true);
                        }
                    });
                    wrapper.appendChild(tagLink);
                }
            }

            // --- [S1P-FIX] Take control of native hover buttons to fix layout shifts and CSS conflicts ---
            const ordertypeLink = authiDiv.querySelector('a[href*="ordertype=1"]');
            const readmodeLink = authiDiv.querySelector('a[onclick*="readmode"]');

            // --- [MODIFIED] Find the "只看大图" link by its text content ---
            let viewImagesLink = null;
            for (const link of authiDiv.querySelectorAll('a')) {
                if (link.textContent.trim() === '只看大图') {
                    viewImagesLink = link;
                    break;
                }
            }

            const insertionPoint = readmodeLink || viewAuthorLink;
            insertionPoint.after(wrapper);

            if (ordertypeLink && readmodeLink) {
                const nativeElements = [
                    ordertypeLink.previousElementSibling, // pipe
                    ordertypeLink,
                    readmodeLink.previousElementSibling, // pipe
                    readmodeLink
                ].filter(Boolean); // Filter out nulls if elements don't exist

                // 1. Override any stylesheet by hiding elements by default
                nativeElements.forEach(el => el.style.display = 'none');

                // 2. Add precise event listeners to show the buttons
                const showNativeButtons = () => {
                    nativeElements.forEach(el => el.style.display = 'inline');
                };

                viewAuthorLink.addEventListener('mouseenter', showNativeButtons);

                // --- [MODIFIED] Add listener to "只看大图" link if found
                if (viewImagesLink) {
                    viewImagesLink.addEventListener('mouseenter', showNativeButtons);
                }

                // 3. Hide buttons when the mouse leaves the entire author info area
                authiDiv.addEventListener('mouseleave', () => {
                    nativeElements.forEach(el => el.style.display = 'none');
                });
            }
        });
    };

    // 自动签到 (适配 study_daily_attendance 插件)
    function autoSign() {
        console.log('S1 Plus: Running autoSign...');
        const checkinLink = document.querySelector('a[href*="study_daily_attendance-daily_attendance.html"]');
        if (!checkinLink) {
            console.log('S1 Plus: Check-in link not found. Exiting autoSign.');
            return;
        }
        console.log('S1 Plus: Check-in link found:', checkinLink.href);

        var now = new Date();
        var date = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
        var signedDate = GM_getValue("signedDate");
        console.log(`S1 Plus: Today is ${date}. Last signed date is ${signedDate}.`);

        // 如果今天已经签到，直接隐藏链接并返回
        if (signedDate == date) {
            console.log('S1 Plus: Already signed in today. Hiding link.');
            checkinLink.style.display = 'none';
            return;
        }

        // 早上6点后才执行签到操作
        if (now.getHours() < 6) {
            console.log('S1 Plus: It is before 6 AM. Skipping sign-in action for now.');
            return;
        }

        console.log('S1 Plus: Proceeding with check-in request...');
        // 使用 GM_xmlhttpRequest 访问签到链接
        GM_xmlhttpRequest({
            method: "GET",
            url: checkinLink.href,
            onload: function (response) {
                // 标记为已签到，防止重复请求
                GM_setValue("signedDate", date);
                // 成功后隐藏链接
                checkinLink.style.display = 'none';
                console.log('S1 Plus: Auto check-in request sent. Status:', response.status);
            },
            onerror: function (response) {
                console.error('S1 Plus: Auto check-in request failed.', response);
            }
        });
    }

    // [MODIFIED] Function to clean up old reading progress records
    const cleanupOldReadProgress = () => {
        const settings = getSettings();
        if (!settings.readingProgressCleanupDays || settings.readingProgressCleanupDays <= 0) {
            return; // Exit if cleanup is set to "Never" (0)
        }

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
                if (record.timestamp && (now - record.timestamp < maxAge)) {
                    cleanedProgress[threadId] = record; // Keep this record
                } else {
                    cleanedCount++; // This record is old, discard it
                }
            }
        }

        if (cleanedCount > 0) {
            console.log(`S1 Plus: Cleaned up ${cleanedCount} old reading progress records (older than ${settings.readingProgressCleanupDays} days).`);
            saveReadProgress(cleanedProgress);
        }
    };


    // --- 主流程 ---
    function main() {
        performAutoSync(); // 实现启动时自动同步
        cleanupOldReadProgress();

        detectS1Nux(); // 检测 S1 NUX 是否启用
        initializeNavbar();
        initializeTagDisplayPopover();

        const observerCallback = (mutations, observer) => {
            // 在处理DOM变化前先断开观察，防止无限循环
            observer.disconnect();
            // 执行所有DOM修改
            applyChanges();
            // 完成后再重新连接观察器
            const ctElement = document.getElementById('ct');
            if (ctElement) {
                observer.observe(ctElement, { childList: true, subtree: true });
            }
        };

        const observer = new MutationObserver(observerCallback);

        // 首次加载时直接运行一次
        applyChanges();

        // 开始观察 #ct 容器的变化
        const ctElement = document.getElementById('ct');
        if (ctElement) {
            observer.observe(ctElement, { childList: true, subtree: true });
        }
    }

    function applyChanges() {
        const settings = getSettings();
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
        if (settings.enableUserBlocking || settings.enableUserTagging) {
            addActionsToPostFooter();
        }
        if (settings.enableUserTagging) {
            initializeTaggingPopover();
        }
        if (settings.enableReadProgress) {
            addProgressJumpButtons();
        }
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
            console.error('S1 Plus: Error caught while running autoSign():', e);
        }
    }

    main();

})();