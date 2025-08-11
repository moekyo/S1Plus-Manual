// ==UserScript==
// @name         S1 Plus - Stage1st 体验增强套件
// @namespace    http://tampermonkey.net/
// @version      4.3.6
// @description  为Stage1st论坛提供帖子/用户屏蔽、导航栏自定义、自动签到、阅读进度跟踪等多种功能，全方位优化你的论坛体验。
// @author       moekyo
// @match        https://stage1st.com/2b/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';


    const SCRIPT_VERSION = '4.3.6';
    const SCRIPT_RELEASE_DATE = '2025-08-11';

    // --- 样式注入 ---
    GM_addStyle(`
        /* --- 通用颜色 --- */
        :root {
            --s1p-bg: #ECEDEB;
            --s1p-t: #022C80;
            --s1p-desc-t: #10388a;
            --s1p-pri: #D1D9C1;
            --s1p-sec: #2563eb;
            --s1p-sec-h: #306bebff;
            --s1p-red: #ef4444;
            --s1p-red-h: #dc2626;
            --s1p-input-bg: #d1d5db;
            --s1p-sub: #e9ebe8;
            --s1p-sub-h: #2563eb;
            --s1p-sub-h-t: white;
        }

        /* --- 核心修复：禁用论坛自带的用户信息悬浮窗 --- */
        #p_pop { display: none !important; }

        /* --- 关键字屏蔽样式 --- */

        .s1p-hidden-by-keyword, .s1p-hidden-by-quote { display: none !important; }

        /* --- 按钮通用样式 --- */
        .s1p-btn { display: inline-flex; align-items: center; justify-content: center; padding: 5px 10px 5px 12px; border-radius: 4px; background-color: var(--s1p-sub); color: var(--s1p-t); font-size: 14px; font-weight: bold; cursor: pointer; user-select: none; white-space: nowrap; border: 1px solid var(--s1p-pri); transition: all 0.2s ease-in-out;}
        .s1p-btn:hover { background-color: var(--s1p-sub-h); color: white; border-color: var(--s1p-sub-h); }
        .s1p-red-btn { background-color: var(--s1p-red); color: white; border-color: var(--s1p-red); }
        .s1p-red-btn:hover { background-color: var(--s1p-red-h); border-color: var(--s1p-red-h); }

        /* --- [REPLACED] 帖子屏蔽按钮动画与布局 --- */
        /* 承载所有操作按钮的主容器，它会在悬停时出现 */
        .s1p-action-container {
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            z-index: 5;
            height: 26px;
            opacity: 0;
            transition: opacity 0.2s ease-in-out;
            display: flex;
            align-items: center;
            pointer-events: none; /* 隐藏时阻断点击 */
        }

        /* 当鼠标悬停在图标单元格上时，显示主容器 */
        tbody.s1p-hover-reveal .s1p-action-container {
            opacity: 1;
            pointer-events: auto; /* 可见时允许点击 */
        }

        /* 初始的“屏蔽”按钮样式 */
        .thread-block-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 26px; padding: 5px 4px;
            border-radius: 0 12px 12px 0;
            background-color: var(--s1p-red); color: white;
            font-size: 12px; border: none;
            box-shadow: 0 1px 3px #00000033;
            cursor: pointer;
            transition: background-color 0.2s ease-in-out;
        }
        .thread-block-btn:hover { background-color: var(--s1p-red-h); }

        /* --- [REPLACED] 帖子行悬停/确认平移效果 --- */
        /* 为所有会移动的单元格准备过渡动画 */
        tbody[id^="normalthread_"] th,
        tbody[id^="stickthread_"] th,
        .icn > a {
            transition: transform 0.2s ease-in-out;
        }

        /* 鼠标悬停在图标单元格上时，平移帖子内容，为“屏蔽”按钮腾出空间 */
        tbody.s1p-hover-reveal .icn > a,
        tbody.s1p-hover-reveal .icn + th {
            transform: translateX(28px);
        }

        /* --- [NEW] 屏蔽确认状态的样式 --- */
        /* 确认/取消按钮的容器，默认隐藏 */
        .s1p-thread-block-confirm-actions {
            display: none;
            align-items: center;
            gap: 4px;
            margin-left: 4px;
        }
        /* 当帖子行处于确认状态时，显示确认/取消按钮 */
        tbody.s1p-blocking-confirm .s1p-thread-block-confirm-actions { display: flex; }
        
        /* 确认(勾)和取消(叉)按钮本身的样式 */
        .s1p-confirm-action-btn {
            display: flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; /* Make it a square */
            border: none; border-radius: 50%; /* Make it a circle */
            cursor: pointer;
            transition: background-color 0.2s ease, transform 0.1s ease;
            background-repeat: no-repeat;
            background-position: center;
            background-size: 60%;
        }
        .s1p-confirm-action-btn:active { transform: scale(0.95); }
        .s1p-confirm-action-btn.confirm {
            background-color: transparent;
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='2.5' stroke='%2322c55e'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' d='M4.5 12.75l6 6 9-13.5' /%3e%3c/svg%3e");
        }
        .s1p-confirm-action-btn.confirm:hover {
            background-color: #e0f2e9; /* A light green */
        }
        .s1p-confirm-action-btn.cancel {
            background-color: transparent;
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='2.5' stroke='%23ef4444'%3e%3cpath stroke-linecap='round' stroke-linejoin='round' d='M6 18L18 6M6 6l12 12' /%3e%3c/svg%3e");
        }
        .s1p-confirm-action-btn.cancel:hover {
            background-color: #fee2e2; /* A light red from the theme's error messages */
        }

        /* 当帖子行处于确认状态时，将内容进一步向右平移，为所有按钮腾出空间 */
        tbody.s1p-blocking-confirm .icn > a,
        tbody.s1p-blocking-confirm .icn + th {
            transform: translateX(94px);
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
            border: 1px solid; /* Color will be set by JS */
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
            color: white;
            font-size: 12px;
            font-weight: bold;
            padding: 1px 5px;
            border: 1px solid; /* Color will be set by JS */
            border-left: none;
            border-radius: 0 4px 4px 0;
            line-height: 1.4;
            user-select: none;
        }

        /* --- 用户屏蔽悬停交互样式 --- */
        .s1p-avatar-overlay-container { position: absolute; display: flex; align-items: center; justify-content: center; background-color: #0000008c; opacity: 0; visibility: hidden; transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out; pointer-events: auto; z-index: 10; }
        .pls:hover .s1p-avatar-overlay-container { opacity: 1; visibility: visible; }
        .s1p-avatar-overlay-container .s1p-btn { color: white; background-color: #00000066; border: 1px solid var(--s1p-pri); transform: scale(1); transition: all 0.2s ease-in-out; padding: 4px 8px; }
        .s1p-avatar-overlay-container .s1p-btn:hover { background-color: var(--s1p-red); border-color: var(--s1p-red); transform: scale(1.05); }

        /* --- 文本框基础样式 --- */
        .s1p-textarea {
            background: var(--s1p-input);
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
            box-shadow: 0 4px 20px #00000014;
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
        .s1p-popover-main-content.empty {
            text-align: center;
            color: #888;
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

        /* --- 设置面板样式 --- */
        .s1p-modal { display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%;  background-color: rgba(0, 0, 0, 0.5); justify-content: center; align-items: center; z-index: 9999; }
        .s1p-modal-content { background-color: var(--s1p-bg); border-radius: 8px; box-shadow: 0 4px 6px #0000001a; width: 600px; max-width: 90%; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; }
        .s1p-modal-header { background: var(--s1p-pri) ;padding: 16px; border-bottom: 1px solid var(--s1p-pri); display: flex; justify-content: space-between; align-items: center; }
        .s1p-modal-title { font-size: 18px; font-weight: bold; }
        .s1p-modal-close {
            width: 12px;
            height: 12px;
            cursor: pointer;
            color: #9ca3af;
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
        .s1p-sync-desc { font-size: 14px; color: var(--s1p-desc-t); margin-bottom: 12px; line-height: 1.5; }
        .s1p-sync-buttons { display: flex; gap: 8px; margin-bottom: 16px; }
        .s1p-sync-textarea { width: 100%; min-height: 80px; margin-bottom: 20px;}
        .s1p-message { font-size: 14px; margin-top: 8px; padding: 8px; border-radius: 4px; display:none; text-align: center; }
        .s1p-message.success { background-color: #d1fae5; color: #065f46; }
        .s1p-message.error { background-color: #fee2e2; color: var(--s1p-red); }

        /* --- 确认弹窗样式 --- */
        @keyframes s1p-fade-in { from { opacity: 0; } to { opacity: 1; } } @keyframes s1p-scale-in { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } } @keyframes s1p-fade-out { from { opacity: 1; } to { opacity: 0; } } @keyframes s1p-scale-out { from { transform: scale(1); opacity: 1; } to { transform: scale(0.97); opacity: 0; } }
        .s1p-confirm-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.65); display: flex; justify-content: center; align-items: center; z-index: 10000; animation: s1p-fade-in 0.2s ease-out; }
        .s1p-confirm-content { background-color: var(--s1p-bg); border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); width: 420px; max-width: 90%; text-align: left; overflow: hidden; animation: s1p-scale-in 0.25s ease-out; }
        .s1p-confirm-body { padding: 20px 24px; font-size: 16px; line-height: 1.6; }
        .s1p-confirm-body .confirm-title { font-weight: 600; font-size: 18px; margin-bottom: 8px; }
        .s1p-confirm-body .confirm-subtitle { font-size: 14px; color: var(--s1p-desc-t); }
        .s1p-confirm-footer { padding: 12px 16px; display: flex; justify-content: flex-end; gap: 12px; }
        .s1p-confirm-btn { padding: 9px 18px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: all 0.15s ease-in-out; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); }
        .s1p-confirm-btn:active { transform: translateY(1px); }
        .s1p-confirm-btn.cancel { background-color: var(--s1p-sub); border-color: var(--s1p-pri); }
        .s1p-confirm-btn.cancel:hover { border-color: var(--s1p-t); }
        .s1p-confirm-btn.confirm { background-color: var(--s1p-red); color: white; border-color: var(--s1p-red); }
        .s1p-confirm-btn.confirm:hover { background-color: var(--s1p-red-h); border-color: var(--s1p-red-h); }

        /* --- Collapsible Section --- */
        .s1p-collapsible-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; transition: color 0.2s ease; }
        .s1p-settings-group-title.s1p-collapsible-header { margin-bottom: 0; }
        .s1p-collapsible-header:hover { color: var(--s1p-sec); }
        .s1p-collapsible-header:hover .s1p-expander-arrow { color: var(--s1p-sec); }
        .s1p-expander-arrow {
            display: inline-block; width: 12px; height: 12px; color: #6b7280;
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
        .s1p-settings-item .title-suffix-input { background: var(--s1p-bg); width: 100%; border: 1px solid var(--s1p-pri); border-radius: 4px; padding: 6px 8px; font-size: 14px; box-sizing: border-box; }
        .s1p-settings-label { font-size: 14px; }
        .s1p-settings-checkbox { /* Handled by .s1p-switch */ }
        .s1p-setting-desc { font-size: 12px; color: var(--s1p-desc-t); margin: -4px 0 12px 0; padding: 0; line-height: 1.5; }
        .s1p-editor-item { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 6px; border-radius: 4px; background: var(--s1p-bg); }
        .s1p-editor-item input[type="text"] { background: var(--s1p-bg);  width: 100%; border: 1px solid var(--s1p-pri); border-radius: 4px; padding: 6px 8px; font-size: 14px; box-sizing: border-box; }
        .s1p-editor-item-controls { display: flex; align-items: center; gap: 4px; }
        .s1p-editor-btn { padding: 4px; font-size: 18px; line-height: 1; cursor: pointer; border-radius: 4px; border:none; background: transparent; color: #9ca3af; }
        .s1p-editor-btn:hover { background: #e5e7eb; color: #374151; }
        .s1p-editor-btn.keyword-rule-delete,
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
        .s1p-editor-btn.keyword-rule-delete:hover,
        .s1p-editor-btn[data-action="delete"]:hover {
            background-color: var(--s1p-red);
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0' /%3E%3C/svg%3E");
        }
        .s1p-drag-handle { font-size: 18pt; cursor: grab; }
        .s1p-editor-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
        .s1p-settings-action-btn { display: inline-block; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; border: none; }
        .s1p-settings-action-btn.primary { background-color: var(--s1p-sec); color: white; }
        .s1p-settings-action-btn.primary:hover { background-color: var(--s1p-sec-h); }
        .s1p-settings-action-btn.secondary { background-color: #e5e7eb; color: #374151; }
        .s1p-settings-action-btn.secondary:hover { background-color: #d1d5db; }

        /* --- Modern Toggle Switch --- */
        .s1p-switch { position: relative; display: inline-block; width: 40px; height: 22px; vertical-align: middle; flex-shrink: 0; }
        .s1p-switch input { opacity: 0; width: 0; height: 0; }
        .s1p-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--s1p-pri); transition: .3s; border-radius: 22px; }
        .s1p-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        input:checked + .s1p-slider { background-color: var(--s1p-sec); }
        input:checked + .s1p-slider:before { transform: translateX(18px); }

        /* --- Nav Editor Dragging --- */
        .s1p-editor-item.dragging { opacity: 0.5; }

        /* --- [NEW] 用户标记设置面板专属样式 --- */
        .s1p-item-meta-id { font-family: monospace; background-color: var(--s1p-bg); padding: 1px 5px; border-radius: 4px; font-size: 11px; color: var(--s1p-t); }
        .s1p-item-content { margin-top: 8px; color: var(--s1p-desc-t); line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
        .s1p-item-editor textarea { width: 100%; min-height: 60px; margin-top: 8px; }
        .s1p-item-actions { display: flex; align-self: flex-start; flex-shrink: 0; gap: 8px; margin-left: 16px; }
        .s1p-item-actions .s1p-btn.primary { background-color: #3b82f6; color: white; }
        .s1p-item-actions .s1p-btn.primary:hover { background-color: #2563eb; }
        .s1p-item-actions .s1p-btn.danger { background-color: var(--s1p-red); color: white; }
        .s1p-item-actions .s1p-btn.danger:hover { background-color: var(--s1p-red-h); border-color: var(--s1p-red-h);}

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

    let dynamicallyHiddenThreads = {};

    // --- 数据处理 & 核心功能 ---
    const getBlockedThreads = () => GM_getValue('s1p_blocked_threads', {});
    const saveBlockedThreads = (threads) => GM_setValue('s1p_blocked_threads', threads);
    const getBlockedUsers = () => GM_getValue('s1p_blocked_users', {});
    const saveBlockedUsers = (users) => GM_setValue('s1p_blocked_users', users);
    const saveUserTags = (tags) => GM_setValue('s1p_user_tags', tags);

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
    const saveTitleFilterRules = (rules) => GM_setValue('s1p_title_filter_rules', rules);

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
        const blockedUsers = getBlockedUsers();
        const blockedUserNames = Object.values(blockedUsers).map(u => u.name);

        document.querySelectorAll('div.quote').forEach(quoteElement => {
            const quoteAuthorElement = quoteElement.querySelector('blockquote font[color="#999999"]');
            if (!quoteAuthorElement) return;

            const text = quoteAuthorElement.textContent.trim();
            const match = text.match(/^(.*)\s发表于\s.*$/);
            if (!match || !match[1]) return;

            const authorName = match[1];
            const isBlocked = blockedUserNames.includes(authorName);

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

                    newPlaceholder.querySelector('.s1p-quote-toggle').addEventListener('click', function() {
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
        const blockedUserIds = Object.keys(getBlockedUsers());
        document.querySelectorAll('tbody.ratl_l tr').forEach(row => {
            const userLink = row.querySelector('a[href*="space-uid-"]');
            if (userLink) {
                const uidMatch = userLink.href.match(/space-uid-(\d+)/);
                if (uidMatch && uidMatch[1]) {
                    if (blockedUserIds.includes(uidMatch[1])) {
                        row.style.display = 'none';
                    } else {
                        // [FIX] 增加逻辑，将被取消屏蔽的用户评分重新显示
                        row.style.display = '';
                    }
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

        document.querySelectorAll('tbody[id^="normalthread_"]').forEach(row => {
            const titleElement = row.querySelector('th a.s.xst');
            if (!titleElement) return;

            const title = titleElement.textContent.trim();
            const threadId = row.id.replace('normalthread_', '');
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
    const saveReadProgress = (progress) => GM_setValue('s1p_read_progress', progress);
    const updateThreadProgress = (threadId, postId, page, lastReadFloor) => {
        if (!postId || !page) return;
        const progress = getReadProgress();
        progress[threadId] = { postId, page, timestamp: Date.now(), lastReadFloor: lastReadFloor };
        saveReadProgress(progress);
    };


    const applyUserThreadBlocklist = () => {
        const blockedUsers = getBlockedUsers();
        const usersToBlockThreads = Object.keys(blockedUsers).filter(uid => blockedUsers[uid].blockThreads);
        if (usersToBlockThreads.length === 0) return;

        document.querySelectorAll('tbody[id^="normalthread_"]').forEach(row => {
            const authorLink = row.querySelector('td.by cite a[href*="space-uid-"]');
            if (authorLink) {
                const uidMatch = authorLink.href.match(/space-uid-(\d+)\.html/);
                const authorId = uidMatch ? uidMatch[1] : null;
                if (authorId && usersToBlockThreads.includes(authorId)) {
                    const threadId = row.id.replace('normalthread_', '');
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

    const exportData = () => JSON.stringify({
        version: 3.2,
        settings: getSettings(),
        threads: getBlockedThreads(),
        users: getBlockedUsers(),
        user_tags: getUserTags(),
        title_filter_rules: getTitleFilterRules(),
        read_progress: getReadProgress()
    }, null, 2);

    const importData = (jsonStr) => {
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

            if(imported.settings) {
                saveSettings({...getSettings(), ...imported.settings});
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

            hideBlockedThreads();
            hideBlockedUsersPosts();
            applyUserThreadBlocklist();
            hideThreadsByTitleKeyword();
            initializeNavbar();
            applyInterfaceCustomizations();

            return { success: true, message: `成功导入 ${threadsImported} 条帖子、${usersImported} 条用户、${tagsImported} 条标记、${rulesImported} 条标题规则、${progressImported} 条阅读进度及相关设置。` };
        } catch (e) { return { success: false, message: `导入失败: ${e.message}` }; }
    };

    // --- 设置管理 ---
    const defaultSettings = {
        enablePostBlocking: true,
        enableUserBlocking: true,
        enableUserTagging: true,
        enableReadProgress: true,
        enableNavCustomization: true,
        changeLogoLink: true,
        hideBlacklistTip: true,
        blockThreadsOnUserBlock: true,
        showBlockedByKeywordList: false,
        showManuallyBlockedList: false,
        hideImagesByDefault: false,
        customTitleSuffix: ' - STAGE1ₛₜ',
        customNavLinks: [
            { name: '论坛', href: 'forum.php' },
            { name: '归墟', href: 'forum-157-1.html' },
            { name: '漫区', href: 'forum-6-1.html' },
            { name: '游戏', href: 'forum-4-1.html' },
            { name: '影视', href: 'forum-48-1.html' },
            { name: 'PC数码', href: 'forum-51-1.html' },
            { name: '黑名单', href: 'home.php?mod=space&do=friend&view=blacklist' }
        ]
    };
    const getSettings = () => {
        const saved = GM_getValue('s1p_settings', {});
        // 如果用户已保存自定义导航，则保留，否则使用默认值
        if (saved.customNavLinks && Array.isArray(saved.customNavLinks)) {
            return { ...defaultSettings, ...saved, customNavLinks: saved.customNavLinks };
        }
        return { ...defaultSettings, ...saved };
    };
    const saveSettings = (settings) => GM_setValue('s1p_settings', settings);

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
                if(!link.name || !link.href) return;
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
    const showMessage = (msgEl, message, isSuccess) => { msgEl.textContent = message; msgEl.className = `s1p-message ${isSuccess ? 'success' : 'error'}`; msgEl.style.display = 'block'; setTimeout(() => { msgEl.style.display = 'none'; }, 3000); };

    const createConfirmationModal = (title, subtitle, onConfirm, confirmText = '确定') => {
        document.querySelector('.s1p-confirm-modal')?.remove();
        const modal = document.createElement('div');
        modal.className = 's1p-confirm-modal';
        modal.innerHTML = `<div class="s1p-confirm-content"><div class="s1p-confirm-body"><div class="confirm-title">${title}</div><div class="confirm-subtitle">${subtitle}</div></div><div class="s1p-confirm-footer"><button class="s1p-confirm-btn cancel">取消</button><button class="s1p-confirm-btn confirm">${confirmText}</button></div></div>`;
        const closeModal = () => { modal.querySelector('.s1p-confirm-content').style.animation = 's1p-scale-out 0.25s ease-out forwards'; modal.style.animation = 's1p-fade-out 0.25s ease-out forwards'; setTimeout(() => modal.remove(), 250); };
        modal.querySelector('.confirm').addEventListener('click', () => { onConfirm(); closeModal(); });
        modal.querySelector('.cancel').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        document.body.appendChild(modal);
    };

    const createManagementModal = () => {
        document.querySelector('.s1p-modal')?.remove();
        const modal = document.createElement('div');
        modal.className = 's1p-modal';
        modal.innerHTML = `<div class="s1p-modal-content">
            <div class="s1p-modal-header"><div class="s1p-modal-title">S1 Plus 设置</div><div class="s1p-modal-close"></div></div>
            <div class="s1p-modal-body">
                <div class="s1p-tabs">
                    <button class="s1p-tab-btn active" data-tab="threads">帖子屏蔽</button>
                    <button class="s1p-tab-btn" data-tab="users">用户屏蔽</button>
                    <button class="s1p-tab-btn" data-tab="tags">用户标记</button>
                    <button class="s1p-tab-btn" data-tab="nav-settings">导航栏定制</button>
                    <button class="s1p-tab-btn" data-tab="general-settings">通用设置</button>
                    <button class="s1p-tab-btn" data-tab="sync">设置同步</button>
                </div>
                <div id="s1p-tab-threads" class="s1p-tab-content active"></div>
                <div id="s1p-tab-users" class="s1p-tab-content"></div>
                <div id="s1p-tab-tags" class="s1p-tab-content"></div>
                <div id="s1p-tab-nav-settings" class="s1p-tab-content"></div>
                <div id="s1p-tab-general-settings" class="s1p-tab-content"></div>
                <div id="s1p-tab-sync" class="s1p-tab-content">
                    <div class="s1p-sync-title">全量设置同步</div>
                    <div class="s1p-sync-desc">通过复制/粘贴数据，在不同浏览器或设备间同步你的所有S1 Plus配置，包括屏蔽列表、导航栏、阅读进度和各项开关设置。</div>
                    <div class="s1p-sync-buttons">
                        <button id="s1p-export-btn" class="s1p-btn">导出数据</button>
                        <button id="s1p-import-btn" class="s1p-btn">导入数据</button>
                    </div>
                    <textarea id="s1p-sync-textarea" class="s1p-sync-textarea s1p-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据"></textarea>
                    <div id="s1p-sync-message" class="s1p-message"></div>
                    <div class="s1p-sync-title">危险操作</div>
                    <div class="s1p-sync-desc">以下操作会立即清空脚本在<b>当前浏览器</b>中的所选数据，且无法撤销。请在操作前务必通过“导出数据”功能进行备份。</div>
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

        const tabs = {
            'threads': modal.querySelector('#s1p-tab-threads'),
            'users': modal.querySelector('#s1p-tab-users'),
            'tags': modal.querySelector('#s1p-tab-tags'),
            'nav-settings': modal.querySelector('#s1p-tab-nav-settings'),
            'general-settings': modal.querySelector('#s1p-tab-general-settings'),
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
                    <div class="s1p-sync-buttons">
                        <button id="s1p-export-tags-btn" class="s1p-btn">导出全部标记</button>
                        <button id="s1p-import-tags-btn" class="s1p-btn">导入标记</button>
                    </div>
                    <textarea id="s1p-tags-sync-textarea" class="s1p-sync-textarea s1p-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据..."></textarea>
                    <div id="s1p-tags-sync-message" class="s1p-message"></div>
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
                                    <button class="s1p-btn primary" data-action="save-tag-edit" data-user-id="${id}" data-user-name="${data.name}">保存</button>
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
                                    <button class="s1p-btn danger" data-action="delete-tag-item" data-user-id="${id}" data-user-name="${data.name}">删除</button>
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
                        return `<div class="s1p-item" data-user-id="${id}"><div class="s1p-item-info"><div class="s1p-item-title">${item.name || `用户 #${id}`}</div><div class="s1p-item-meta">屏蔽时间: ${formatDate(item.timestamp)}</div><div class="s1p-item-toggle"><label class="s1p-switch"><input type="checkbox" class="user-thread-block-toggle" data-user-id="${id}" ${item.blockThreads ? 'checked' : ''}><span class="s1p-slider"></span></label><span>屏蔽该用户的主题帖</span></div></div><button class="s1p-unblock-btn s1p-btn" data-unblock-user-id="${id}">取消屏蔽</button></div>`;
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
                    <div id="s1p-keywords-message" class="s1p-message"></div>
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
                            return `<div class="s1p-item" data-thread-id="${id}"><div class="s1p-item-info"><div class="s1p-item-title">${item.title || `帖子 #${id}`}</div><div class="s1p-item-meta">屏蔽时间: ${formatDate(item.timestamp)} ${item.reason && item.reason !== 'manual' ? `(因屏蔽用户${item.reason.replace('user_','')})` : ''}</div></div><button class="s1p-unblock-btn s1p-btn" data-unblock-thread-id="${id}">取消屏蔽</button></div>`;
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
                                <div class="s1p-item-meta">匹配规则: <code style="background: #eee; padding: 2px 4px; border-radius: 3px;">${item.pattern}</code></div>
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
                        <label class="s1p-switch"><input type="checkbox" class="s1p-settings-checkbox keyword-rule-enable" ${rule.enabled ? 'checked' : ''}><span class="s1p-slider"></span></label>
                        <input type="text" class="keyword-rule-pattern" placeholder="输入关键字或正则表达式" value="${rule.pattern || ''}">
                        <div class="s1p-editor-item-controls">
                            <button class="s1p-editor-btn keyword-rule-delete" title="删除规则"></button>
                        </div>
                    </div>
                `).join('');
                 if (rules.length === 0) {
                    container.innerHTML = `<div class="s1p-empty" style="padding: 12px;">暂无规则</div>`;
                }
            };

            renderRules();
            renderDynamicallyHiddenList();

            const saveAndApplyKeywordRules = () => {
                const newRules = [];
                tabs['threads'].querySelectorAll('#s1p-keyword-rules-list .s1p-editor-item').forEach(item => {
                    const pattern = item.querySelector('.keyword-rule-pattern').value.trim();
                    if (pattern) {
                        let id = item.dataset.ruleId;
                        if (id.startsWith('new_')) {
                            id = `rule_${Date.now()}_${Math.random()}`;
                        }
                        newRules.push({
                            id: id,
                            enabled: item.querySelector('.keyword-rule-enable').checked,
                            pattern: pattern
                        });
                    }
                });
                saveTitleFilterRules(newRules);
                hideThreadsByTitleKeyword();
                renderDynamicallyHiddenList();
                renderRules(); // Re-render to show the saved state and assign permanent IDs.
                showMessage(tabs['threads'].querySelector('#s1p-keywords-message'), '规则已保存！', true);
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
                        <label class="s1p-switch"><input type="checkbox" class="s1p-settings-checkbox keyword-rule-enable" checked><span class="s1p-slider"></span></label>
                        <input type="text" class="keyword-rule-pattern" placeholder="输入关键字或正则表达式" value="">
                        <div class="s1p-editor-item-controls">
                            <button class="s1p-editor-btn keyword-rule-delete" title="删除规则"></button>
                        </div>
                    `;
                    container.appendChild(newItem);
                    newItem.querySelector('input[type="text"]').focus();
                } else if (target.classList.contains('keyword-rule-delete')) {
                    const item = target.closest('.s1p-editor-item');
                    item.remove();
                    const container = tabs['threads'].querySelector('#s1p-keyword-rules-list');
                    if (container.children.length === 0) {
                        container.innerHTML = `<div class="s1p-empty" style="padding: 12px;">暂无规则</div>`;
                    }
                } else if (target.id === 's1p-keyword-rules-save-btn') {
                    saveAndApplyKeywordRules();
                }
            });
        };

        const renderGeneralSettingsTab = () => {
            const settings = getSettings();
            tabs['general-settings'].innerHTML = `
                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">功能开关</div>
                     <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-enableReadProgress">启用阅读进度跟踪</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-enableReadProgress" data-feature="enableReadProgress" class="s1p-feature-toggle" ${settings.enableReadProgress ? 'checked' : ''}><span class="s1p-slider"></span></label>
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
                        <input type="text" id="s1p-customTitleSuffix" class="title-suffix-input" data-setting="customTitleSuffix" value="${settings.customTitleSuffix || ''}" style="width: 200px;">
                    </div>
                </div>`;

            tabs['general-settings'].addEventListener('change', e => {
                const target = e.target;
                const settingKey = target.dataset.setting;
                if (settingKey) {
                    const settings = getSettings();
                    if (target.type === 'checkbox') {
                        settings[settingKey] = target.checked;
                    } else {
                        settings[settingKey] = target.value;
                    }
                    saveSettings(settings);
                    applyInterfaceCustomizations();
                    // [NEW] 如果是图片隐藏开关，则立即调用函数刷新页面状态
                    if (settingKey === 'hideImagesByDefault') {
                        applyImageHiding();
                        manageImageToggleAllButtons();
                    }
                }
            });
        };

        const renderNavSettingsTab = () => {
            const settings = getSettings();
            tabs['nav-settings'].innerHTML = `
                <div class="s1p-settings-group">
                    <div class="s1p-settings-item">
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
                </div>
                <div id="s1p-settings-message" class="s1p-message"></div>`;

            const navListContainer = tabs['nav-settings'].querySelector('.s1p-nav-editor-list');
            const renderNavList = (links) => {
                navListContainer.innerHTML = (links || []).map((link, index) => `
                    <div class="s1p-editor-item" draggable="true" data-index="${index}" style="grid-template-columns: auto 1fr 1fr auto; user-select: none;">
                        <div class="s1p-drag-handle">::</div>
                        <input type="text" class="nav-name" placeholder="名称" value="${link.name || ''}">
                        <input type="text" class="nav-href" placeholder="链接" value="${link.href || ''}">
                        <div class="s1p-editor-item-controls"><button class="s1p-editor-btn" data-action="delete" title="删除链接"></button></div>
                    </div>`).join('');
            };

            renderNavList(settings.customNavLinks);

            let draggedItem = null;
            navListContainer.addEventListener('dragstart', e => {
                if (e.target.classList.contains('s1p-editor-item')) {
                    draggedItem = e.target;
                    setTimeout(() => {
                        e.target.classList.add('dragging');
                    }, 0);
                }
            });

            navListContainer.addEventListener('dragend', e => {
                if (draggedItem) {
                    draggedItem.classList.remove('dragging');
                    draggedItem = null;
                }
            });

            navListContainer.addEventListener('dragover', e => {
                e.preventDefault();
                if (!draggedItem) return;

                const container = e.currentTarget;
                const otherItems = [...container.querySelectorAll('.s1p-editor-item:not(.dragging)')];

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
                    newItem.innerHTML = `<div class="s1p-drag-handle">::</div><input type="text" class="nav-name" placeholder="新链接"><input type="text" class="nav-href" placeholder="forum.php"><div class="s1p-editor-item-controls"><button class="s1p-editor-btn" data-action="delete" title="删除链接"></button></div>`;
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
                    showMessage(modal.querySelector('#s1p-settings-message'), '导航栏已恢复为默认设置！', true);
                } else if (target.id === 's1p-settings-save-btn') {
                    const newSettings = {
                        ...getSettings(),
                        enableNavCustomization: tabs['nav-settings'].querySelector('#s1p-enableNavCustomization').checked,
                        customNavLinks: Array.from(navListContainer.querySelectorAll('.s1p-editor-item')).map(item => ({ name: item.querySelector('.nav-name').value.trim(), href: item.querySelector('.nav-href').value.trim() })).filter(l=>l.name && l.href)
                    };
                    saveSettings(newSettings);
                    applyInterfaceCustomizations();
                    initializeNavbar();
                    showMessage(modal.querySelector('#s1p-settings-message'), '设置已保存！', true);
                }
            });
        };

        // --- 初始化渲染和事件绑定 ---
        renderThreadTab();
        renderUserTab();
        renderTagsTab();
        renderGeneralSettingsTab();
        renderNavSettingsTab();

        modal.addEventListener('change', e => {
            const target = e.target;
            const settings = getSettings();

            const featureKey = target.dataset.feature;
            if (featureKey && target.classList.contains('s1p-feature-toggle')) {
                // [MODIFIED] Handle feature toggles with animation, no full re-render
                settings[featureKey] = target.checked;
                const contentWrapper = target.closest('.s1p-settings-item')?.nextElementSibling;
                if (contentWrapper && contentWrapper.classList.contains('s1p-feature-content')) {
                    contentWrapper.classList.toggle('expanded', target.checked);
                }
                 saveSettings(settings);
                // We handled it, so we stop here.
                return;
            }
            else if(target.matches('.user-thread-block-toggle')) {
                const userId = target.dataset.userId;
                const blockThreads = target.checked;
                const users = getBlockedUsers();
                if(users[userId]) {
                    users[userId].blockThreads = blockThreads;
                    saveBlockedUsers(users);
                    if(blockThreads) applyUserThreadBlocklist();
                    else unblockThreadsByUser(userId);
                    renderThreadTab();
                }
            }
            else if(target.matches('#s1p-blockThreadsOnUserBlock')) {
                const currentSettings = getSettings();
                currentSettings.blockThreadsOnUserBlock = target.checked;
                saveSettings(currentSettings);
            }
        });

        modal.addEventListener('click', (e) => {
            const target = e.target;
            if (e.target.matches('.s1p-modal, .s1p-modal-close')) modal.remove();
            if (e.target.matches('.s1p-tab-btn')) {
                modal.querySelectorAll('.s1p-tab-btn, .s1p-tab-content').forEach(el => el.classList.remove('active'));
                e.target.classList.add('active');
                const activeTab = tabs[e.target.dataset.tab];
                if(activeTab) activeTab.classList.add('active');
            }
            const unblockThreadId = e.target.dataset.unblockThreadId; if (unblockThreadId) { unblockThread(unblockThreadId); renderThreadTab(); }
            const unblockUserId = e.target.dataset.unblockUserId; if (unblockUserId) { unblockUser(unblockUserId); renderUserTab(); renderThreadTab(); }

            // --- 全局同步事件 ---
            const syncTextarea = modal.querySelector('#s1p-sync-textarea');
            const syncMessageEl = modal.querySelector('#s1p-sync-message');
            if(e.target.id === 's1p-export-btn') {
                syncTextarea.value = exportData();
                syncTextarea.select();
                try { document.execCommand('copy'); showMessage(syncMessageEl, '数据已导出并复制到剪贴板', true); }
                catch (err) { showMessage(syncMessageEl, '复制失败，请手动复制', false); }
            }
            if(e.target.id === 's1p-import-btn') {
                const jsonStr = syncTextarea.value.trim();
                if (!jsonStr) return showMessage(syncMessageEl, '请先粘贴要导入的数据', false);
                const result = importData(jsonStr);
                showMessage(syncMessageEl, result.message, result.success);
                if (result.success) {
                    renderThreadTab();
                    renderUserTab();
                    renderSettingsTab();
                    renderTagsTab();
                }
            }
            if(e.target.id === 's1p-clear-select-all') {
                const isChecked = e.target.checked;
                modal.querySelectorAll('.s1p-clear-data-checkbox').forEach(chk => chk.checked = isChecked);
            }

            if(e.target.id === 's1p-clear-selected-btn') {
                const selectedKeys = Array.from(modal.querySelectorAll('.s1p-clear-data-checkbox:checked')).map(chk => chk.dataset.clearKey);
                if (selectedKeys.length === 0) {
                    return showMessage(syncMessageEl, '请至少选择一个要清除的数据项。', false);
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
                        renderSettingsTab();
                        renderTagsTab();

                        showMessage(syncMessageEl, '选中的本地数据已成功清除。', true);
                    },
                    '确认清除'
                );
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
                        showMessage(targetTab.querySelector('#s1p-tags-sync-message'), `已删除对 ${userName} 的标记。`, true);
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
                        showMessage(targetTab.querySelector('#s1p-tags-sync-message'), `已更新对 ${userName} 的标记。`, true);
                    } else {
                        createConfirmationModal(`标记内容为空`, '您希望删除对该用户的标记吗？', () => {
                             delete tags[userId];
                             saveUserTags(tags);
                             renderTagsTab();
                             showMessage(targetTab.querySelector('#s1p-tags-sync-message'), `已删除对 ${userName} 的标记。`, true);
                        }, '确认删除');
                    }
                }
                else if (target.id === 's1p-export-tags-btn') {
                    const textarea = targetTab.querySelector('#s1p-tags-sync-textarea');
                    const messageEl = targetTab.querySelector('#s1p-tags-sync-message');
                    textarea.value = JSON.stringify(getUserTags(), null, 2);
                    textarea.select();
                    try { document.execCommand('copy'); showMessage(messageEl, '用户标记已导出并复制到剪贴板。', true); }
                    catch (err) { showMessage(messageEl, '复制失败，请手动复制。', false); }
                }
                else if (target.id === 's1p-import-tags-btn') {
                    const textarea = targetTab.querySelector('#s1p-tags-sync-textarea');
                    const messageEl = targetTab.querySelector('#s1p-tags-sync-message');
                    const jsonStr = textarea.value.trim();
                    if (!jsonStr) return showMessage(messageEl, '请先粘贴要导入的数据。', false);

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
                            showMessage(messageEl, `成功导入/更新 ${Object.keys(imported).length} 条用户标记。`, true);
                            textarea.value = '';
                        }, '确认导入');
                    } catch (e) { showMessage(messageEl, `导入失败: ${e.message}`, false); }
                }
            }
        });
    };

    // [MODIFIED] 增加带二次确认的屏蔽按钮
    const addBlockButtonsToThreads = () => {
        document.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]').forEach(row => {
            // 防止重复添加按钮
            if (row.querySelector('.s1p-action-container')) return;
    
            const iconCell = row.querySelector('td.icn');
            const titleElement = row.querySelector('th a.s.xst');
    
            if (iconCell && titleElement) {
                iconCell.style.position = 'relative';

                let hoverTimeout;
                iconCell.addEventListener('mouseenter', () => {
                    hoverTimeout = setTimeout(() => {
                        row.classList.add('s1p-hover-reveal');
                    }, 1000);
                });
                iconCell.addEventListener('mouseleave', () => {
                    clearTimeout(hoverTimeout);
                    row.classList.remove('s1p-hover-reveal');
                });

                const threadId = row.id.replace(/^(normalthread_|stickthread_)/, '');
                const threadTitle = titleElement.textContent.trim();
    
                // 1. 创建在悬停时出现的主容器
                const actionContainer = document.createElement('div');
                actionContainer.className = 's1p-action-container';
    
                // 2. 创建初始的“屏蔽”按钮
                const blockBtn = document.createElement('span');
                blockBtn.className = 'thread-block-btn';
                blockBtn.textContent = '屏蔽';
                blockBtn.title = '屏蔽此贴';
    
                // 3. 创建确认/取消按钮的容器 (默认通过CSS隐藏)
                const confirmActionsContainer = document.createElement('div');
                confirmActionsContainer.className = 's1p-thread-block-confirm-actions';
    
                // 3a. 创建“取消”按钮 (叉)
                const cancelBtn = document.createElement('button');
                cancelBtn.className = 's1p-confirm-action-btn cancel';
                cancelBtn.innerHTML = ''; // '✗'
                cancelBtn.title = '取消';
    
                // 3b. 创建“确认”按钮 (勾)
                const confirmBtn = document.createElement('button');
                confirmBtn.className = 's1p-confirm-action-btn confirm';
                confirmBtn.innerHTML = ''; // '✓'
                confirmBtn.title = '确认屏蔽';
    
                // 组装确认按钮 (顺序：叉，然后是勾)
                confirmActionsContainer.appendChild(cancelBtn);
                confirmActionsContainer.appendChild(confirmBtn);
    
                // 组装主容器
                actionContainer.appendChild(blockBtn);
                actionContainer.appendChild(confirmActionsContainer);
    
                // 将完整的UI添加到帖子行中
                iconCell.appendChild(actionContainer);
    
                // --- 事件监听 ---
    
                // 点击初始“屏蔽”按钮，为帖子行添加一个class，以触发CSS来显示确认UI
                blockBtn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    row.classList.add('s1p-blocking-confirm');
                });
    
                // 点击“取消”按钮，移除class，恢复UI
                cancelBtn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    row.classList.remove('s1p-blocking-confirm');
                });
    
                // 点击“确认”按钮，执行真正的屏蔽操作
                confirmBtn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    blockThread(threadId, threadTitle);
                    // 帖子行被隐藏后，无需再清理class
                });
                
                // 为整行添加鼠标移出事件，如果确认UI是打开的，则自动关闭它。
                // 这是一个优化体验的细节，避免确认状态被卡住。
                row.addEventListener('mouseleave', () => {
                    if (row.classList.contains('s1p-blocking-confirm')) {
                        row.classList.remove('s1p-blocking-confirm');
                    }
                });
            }
        });
    };

    // --- [FIXED] 重构用户屏蔽按钮添加逻辑，解决竞态条件问题 ---
    const addBlockButtonsToUsers = () => {
        document.querySelectorAll('.authi > a[href*="space-uid-"]').forEach(authorLink => {
            const plsCell = authorLink.closest('.pls');
            // 如果没有父元素，或已处理过，则跳过
            if (!plsCell || plsCell.dataset.s1pBlocked) return;
            plsCell.dataset.s1pBlocked = 'true'; // 添加标记，防止重复处理

            const avatarImg = plsCell.querySelector('.avatar img');
            if (!avatarImg) return;

            const uidMatch = authorLink.href.match(/space-uid-(\d+)/);
            if (!uidMatch) return;

            const userId = uidMatch[1];
            const userName = authorLink.textContent.trim();

            // 预先创建好元素
            const overlayContainer = document.createElement('div');
            overlayContainer.className = 's1p-avatar-overlay-container';

            const blockBtn = document.createElement('span');
            blockBtn.className = 's1p-btn';
            blockBtn.textContent = '屏蔽用户';
            blockBtn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                const subtitle = getSettings().blockThreadsOnUserBlock ?
                    '该用户的所有帖子和主题帖都将被隐藏，此操作可在设置面板中撤销。' :
                    '该用户的所有帖子都将被隐藏，此操作可在设置面板中撤销。';
                createConfirmationModal(`确定要屏蔽用户 "${userName}" 吗？`, subtitle, () => blockUser(userId, userName), '确定屏蔽');
            });
            overlayContainer.appendChild(blockBtn);

            // 定义一个函数来计算和放置悬浮层
            // 只有当图片加载完成后（即拥有正确尺寸后）才能执行此函数
            const placeOverlay = () => {
                // 为父元素设置相对定位，作为悬浮层的定位基准
                plsCell.style.position = 'relative';

                const rect = avatarImg.getBoundingClientRect();
                const parentRect = plsCell.getBoundingClientRect();

                // 如果计算出的尺寸仍然为0，则不显示损坏的悬浮层
                if (rect.width === 0 || rect.height === 0) {
                    console.warn(`S1 Plus: 用户 ${userName} 的头像无尺寸，跳过悬浮层。`);
                    return;
                }

                overlayContainer.style.top = `${rect.top - parentRect.top}px`;
                overlayContainer.style.left = `${rect.left - parentRect.left}px`;
                overlayContainer.style.width = `${rect.width}px`;
                overlayContainer.style.height = `${rect.height}px`;
                overlayContainer.style.borderRadius = window.getComputedStyle(avatarImg).borderRadius;

                // 只有当所有计算完成后，才将悬浮层添加到页面
                plsCell.appendChild(overlayContainer);
            };

            // 检查图片是否已经加载完成（例如来自浏览器缓存）
            // .complete 属性为 true 且 naturalHeight 不为 0 意味着图片已成功加载并有实际尺寸
            if (avatarImg.complete && avatarImg.naturalHeight !== 0) {
                placeOverlay();
            } else {
                // 如果图片尚未加载，则等待 onload 事件
                avatarImg.onload = placeOverlay;
                // 添加一个错误处理，防止因图片加载失败导致脚本问题
                avatarImg.onerror = () => {
                   console.warn(`S1 Plus: 无法加载用户 ${userName} 的头像。`);
                };
            }
        });
    };

    // [MODIFIED] 全新悬浮窗逻辑
    const initializeTaggingPopover = () => {
        let popover = document.getElementById('s1p-tag-popover-main');
        if (!popover) {
            popover = document.createElement('div');
            popover.id = 's1p-tag-popover-main';
            popover.className = 's1p-tag-popover';
            document.body.appendChild(popover);
        }

        let hideTimeout, showTimeout;
        let isComposing = false; // Flag to track IME composition state
        let currentAnchorElement = null; // To store the element the popover is anchored to

        const startHideTimer = () => {
            if (isComposing) return; // Don't hide popover during IME composition
            clearTimeout(showTimeout);
            clearTimeout(hideTimeout);
            hideTimeout = setTimeout(() => {
                popover.classList.remove('visible');
                delete popover.dataset.currentUserId;
                delete popover.dataset.currentUserAvatar;
                currentAnchorElement = null;
            }, 300);
        };

        const cancelHideTimer = () => {
            clearTimeout(hideTimeout);
        };

        const updatePopoverWidth = (popoverElement) => {
            popoverElement.style.visibility = 'hidden';
            popoverElement.style.display = 'block';
            popoverElement.style.left = '-9999px';
            popoverElement.style.width = 'auto';

            const footer = popoverElement.querySelector('.s1p-popover-footer');
            const actionsContainer = popoverElement.querySelector('.s1p-popover-actions');
            const popoverContent = popoverElement.querySelector('.s1p-popover-content');
            const avatar = popoverElement.querySelector('.s1p-popover-avatar');
            const userContainer = popoverElement.querySelector('.s1p-popover-user-container');
            const usernameDiv = popoverElement.querySelector('.s1p-popover-username');
            const uidDiv = popoverElement.querySelector('.s1p-popover-user-id');

            if (footer && actionsContainer && popoverContent && avatar && userContainer && usernameDiv && uidDiv) {
                const maxTextWidth = Math.max(usernameDiv.offsetWidth, uidDiv.offsetWidth);
                const userContainerGap = parseFloat(window.getComputedStyle(userContainer).gap);
                const requiredUserContainerWidth = avatar.offsetWidth + userContainerGap + maxTextWidth;
                const contentStyle = window.getComputedStyle(popoverContent);
                const paddingX = parseFloat(contentStyle.paddingLeft) + parseFloat(contentStyle.paddingRight);
                const footerGap = parseFloat(window.getComputedStyle(footer).gap);
                const requiredFooterWidth = requiredUserContainerWidth + actionsContainer.offsetWidth + footerGap;
                const requiredPopoverWidth = requiredFooterWidth + paddingX;
                const mainContentWidth = popoverElement.querySelector('.s1p-popover-main-content').offsetWidth + paddingX;
                const defaultWidth = 300;
                const finalWidth = Math.ceil(Math.max(defaultWidth, requiredPopoverWidth, mainContentWidth));
                popoverElement.style.width = `${finalWidth}px`;
            }

            popoverElement.style.visibility = '';
            popoverElement.style.display = '';
            popoverElement.style.left = '';
        };

        const repositionPopover = (popoverElement, anchorElement) => {
            if (!anchorElement) return;
            const rect = anchorElement.getBoundingClientRect();
            popoverElement.style.top = `${rect.top + window.scrollY}px`;
            popoverElement.style.left = `${rect.right + window.scrollX + 10}px`;
        };

        const renderPopoverContent = (userName, userId, tagData = null, avatarUrl) => {
            const tag = tagData ? tagData.tag : '';
            const hasTag = tag.trim() !== '';
            const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="var(--s1p-pri)"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="sans-serif" font-size="40" fill="#999">S1</text></svg>`;
            const fallbackAvatar = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgIcon)}`;


            const mainContentHTML = hasTag
                ? `<div class="s1p-popover-main-content">${tag}</div>`
                : `<div class="s1p-popover-main-content empty">目前暂无标记</div>`;

            const actionsHTML = hasTag
                ? `
                <button class="s1p-popover-btn s1p-btn" data-action="edit-tag" data-user-id="${userId}" data-user-name="${userName}">编辑标记</button>
                <button class="s1p-popover-btn s1p-btn s1p-red-btn" data-action="delete-tag" data-user-id="${userId}" data-user-name="${userName}">清空标记</button>
                `
                : `
                <button class="s1p-popover-btn s1p-btn" data-action="add-tag" data-user-id="${userId}" data-user-name="${userName}">添加标记</button>
                `;

            popover.innerHTML = `
                <div class="s1p-popover-content">
                    ${mainContentHTML}
                    <hr class="s1p-popover-hr" />
                    <div class="s1p-popover-footer">
                        <div class="s1p-popover-user-container">
                            <img class="s1p-popover-avatar" src="${avatarUrl || fallbackAvatar}" onerror="this.onerror=null;this.src='${fallbackAvatar}'">
                            <div class="s1p-popover-user-info">
                                <div class="s1p-popover-username">${userName}</div>
                                <div class="s1p-popover-user-id">UID: ${userId}</div>
                            </div>
                        </div>
                        <div class="s1p-popover-actions">${actionsHTML}</div>
                    </div>
                </div>
            `;
        };

        const renderEditMode = (userName, userId, currentTag = '') => {
            popover.innerHTML = `
                 <div class="s1p-popover-content">
                    <div class="s1p-edit-mode-header">为 ${userName} ${currentTag ? '编辑' : '添加'}标记</div>
                    <textarea class="s1p-edit-mode-textarea s1p-textarea" id="s1p-tag-textarea" placeholder="输入标记内容...">${currentTag}</textarea>
                    <div class="s1p-edit-mode-actions">
                        <button class="s1p-popover-btn s1p-btn" data-action="cancel-edit" data-user-id="${userId}" data-user-name="${userName}">取消</button>
                        <button class="s1p-popover-btn s1p-btn" data-action="save-tag" data-user-id="${userId}" data-user-name="${userName}">保存</button>
                    </div>
                </div>
            `;
            const textarea = popover.querySelector('#s1p-tag-textarea');
            textarea.focus();

            textarea.addEventListener('compositionstart', () => { isComposing = true; });
            textarea.addEventListener('compositionend', () => { isComposing = false; });
        };

        popover.addEventListener('click', (event) => {
            const target = event.target.closest('.s1p-popover-btn');
            if (!target) return;

            isComposing = false;

            const { action, userId, userName } = target.dataset;
            const userTags = getUserTags();
            const avatarUrl = popover.dataset.currentUserAvatar;

            if (action === 'add-tag' || action === 'edit-tag') {
                renderEditMode(userName, userId, userTags[userId] ? userTags[userId].tag : '');
            } else if (action === 'cancel-edit') {
                renderPopoverContent(userName, userId, userTags[userId] || null, avatarUrl);
                updatePopoverWidth(popover);
                repositionPopover(popover, currentAnchorElement);
            } else if (action === 'save-tag') {
                const textarea = popover.querySelector('#s1p-tag-textarea');
                const newTag = textarea.value.trim();
                if (newTag) {
                    userTags[userId] = { name: userName, tag: newTag, timestamp: Date.now() };
                } else {
                    delete userTags[userId];
                }
                saveUserTags(userTags);
                renderPopoverContent(userName, userId, userTags[userId] || null, avatarUrl);
                updatePopoverWidth(popover);
                repositionPopover(popover, currentAnchorElement);
            } else if (action === 'delete-tag') {
                createConfirmationModal(
                    `确认要删除对 "${userName}" 的标记吗？`,
                    '此操作不可撤销。',
                    () => {
                        delete userTags[userId];
                        saveUserTags(userTags);
                        renderPopoverContent(userName, userId, null, avatarUrl);
                        updatePopoverWidth(popover);
                        repositionPopover(popover, currentAnchorElement);
                    },
                    '确认删除'
                );
            }
        });

        popover.addEventListener('mouseenter', cancelHideTimer);
        popover.addEventListener('mouseleave', startHideTimer);

        const attachPopoverEvents = (cell) => {
            cell.addEventListener('mouseenter', () => {
                cancelHideTimer();
                clearTimeout(showTimeout);

                showTimeout = setTimeout(() => {
                    const authorLink = cell.querySelector('.authi > a[href*="space-uid-"]');
                    const avatarImg = cell.querySelector('.avatar img');
                    if (!authorLink || !avatarImg) return;
                    const avatarUrl = avatarImg.src;

                    const uidMatch = authorLink.href.match(/space-uid-(\d+)/);
                    if (!uidMatch) return;
                    const userId = uidMatch[1];

                    if (popover.classList.contains('visible') && popover.dataset.currentUserId === userId) {
                        return;
                    }

                    const userName = authorLink.textContent.trim();
                    const userTags = getUserTags();
                    popover.dataset.currentUserId = userId;
                    popover.dataset.currentUserAvatar = avatarUrl;
                    currentAnchorElement = avatarImg;

                    renderPopoverContent(userName, userId, userTags[userId] || null, avatarUrl);
                    updatePopoverWidth(popover);
                    repositionPopover(popover, currentAnchorElement);
                    popover.classList.add('visible');
                }, 150);
            });

            cell.addEventListener('mouseleave', startHideTimer);
        };

        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        const cells = node.matches('.pls') ? [node] : node.querySelectorAll('.pls');
                        cells.forEach(cell => {
                            if (!cell.dataset.s1pPopover) {
                                cell.dataset.s1pPopover = 'true';
                                attachPopoverEvents(cell);
                            }
                        });
                    }
                });
            });
        });

        const mainContent = document.getElementById('ct') || document.body;
        mainContent.querySelectorAll('.pls').forEach(cell => {
            if (!cell.dataset.s1pPopover) {
                cell.dataset.s1pPopover = 'true';
                attachPopoverEvents(cell);
            }
        });
        observer.observe(mainContent, { childList: true, subtree: true });
    };


    const getTimeBasedColor = (hours) => {
        if (hours <= 1) return 'rgb(192, 51, 34)';
        if (hours <= 24) return `rgb(${Math.round(192 - hours * 4)}, ${Math.round(51 + hours * 2)}, ${Math.round(34 + hours * 2)})`;
        if (hours <= 168) return `rgb(${Math.round(100 - (hours-24)/3)}, ${Math.round(100 + (hours-24)/4)}, ${Math.round(80 + (hours-24)/4)})`;
        return 'rgb(107, 114, 128)';
    };

    const addProgressJumpButtons = () => {
        const progressData = getReadProgress();
        if (Object.keys(progressData).length === 0) return;

        const now = Date.now();

        document.querySelectorAll('tbody[id^="normalthread_"]').forEach(row => {
            const container = row.querySelector('th');
            if (!container || container.querySelector('.s1p-progress-container')) return;

            const threadIdMatch = row.id.match(/normalthread_(\d+)/);
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

                jumpBtn.addEventListener('mouseover', () => {
                    jumpBtn.style.backgroundColor = fcolor;
                    jumpBtn.style.color = 'white';
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

    const addBlockButtonToPostFooter = () => {
        // Find all the "View author's posts only" links
        document.querySelectorAll('div.authi a[href*="authorid="]').forEach(authorLink => {
            const authiDiv = authorLink.closest('.authi');
            // Prevent duplicate buttons
            if (!authiDiv || authiDiv.querySelector('.s1p-block-user-in-authi')) {
                return;
            }

            // 1. Extract User ID
            const urlParams = new URLSearchParams(authorLink.href.split('?')[1]);
            const userId = urlParams.get('authorid');
            if (!userId) {
                return;
            }

            // 2. Find User Name
            const postContainer = authiDiv.closest('td.plc');
            if (!postContainer) {
                return;
            }
            const plsCell = postContainer.previousElementSibling;
            if (!plsCell) {
                return;
            }
            const userLinkInPi = plsCell.querySelector(`.pi .authi a[href*="space-uid-${userId}"]`);
            const userName = userLinkInPi ? userLinkInPi.textContent.trim() : `用户 #${userId}`;

            // 3. Create and insert the new elements
            const pipe = document.createElement('span');
            pipe.className = 'pipe';
            pipe.textContent = '|';

            const blockLink = document.createElement('a');
            blockLink.href = 'javascript:void(0);';
            blockLink.textContent = '屏蔽该用户';
            blockLink.className = 's1p-block-user-in-authi';

            // 4. Add click listener
            blockLink.addEventListener('click', (e) => {
                e.preventDefault();
                const subtitle = getSettings().blockThreadsOnUserBlock ?
                    '该用户的所有帖子和主题帖都将被隐藏，此操作可在设置面板中撤销。' :
                    '该用户的所有帖子都将被隐藏，此操作可在设置面板中撤销。';
                createConfirmationModal(`确定要屏蔽用户 "${userName}" 吗？`, subtitle, () => blockUser(userId, userName), '确定屏蔽');
            });

            authorLink.after(pipe, blockLink);
        });
    };

    // --- 主流程 ---
    function main() {
        initializeNavbar();

        const observerCallback = (mutations, observer) => {
            // 在处理DOM变化前先断开观察，防止无限循环
            observer.disconnect();
            // 执行所有DOM修改
            applyChanges();
            // 完成后再重新连接观察器
            observer.observe(document.getElementById('ct'), { childList: true, subtree: true });
        };

        const observer = new MutationObserver(observerCallback);

        // 首次加载时直接运行一次
        applyChanges();

        // 开始观察 #ct 容器的变化
        observer.observe(document.getElementById('ct'), { childList: true, subtree: true });

        // 记录阅读进度
        if (getSettings().enableReadProgress && document.getElementById('postlist')) {
            const threadIdMatch = window.location.href.match(/thread-(\d+)-/);
            if (threadIdMatch) {
                const threadId = threadIdMatch[1];
                const lastPost = Array.from(document.querySelectorAll('div[id^="post_"]')).pop();
                if (lastPost) {
                    const postId = lastPost.id.replace('post_', '');
                    const pageElement = document.querySelector('.pgs .pg a.xw1');
                    const page = pageElement ? pageElement.textContent : '1';
                    const lastReadFloor = lastPost.querySelector('td.plc a.xw1[id^="postnum"]')?.textContent?.replace(/#/, '');
                    updateThreadProgress(threadId, postId, page, lastReadFloor);
                }
            }
        }

        // 自动签到
        const checkinLink = document.querySelector('a[href*="plugin.php?id=dsu_paulsign:sign"]');
        if (checkinLink && checkinLink.textContent.includes('每日签到')) {
            fetch(checkinLink.href).then(() => console.log('S1 Plus: 已自动签到。'));
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
            addBlockButtonsToUsers();
            addBlockButtonToPostFooter();
            hideBlockedUserQuotes();
            hideBlockedUserRatings();
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
    }

    main();

})();