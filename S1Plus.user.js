// ==UserScript==
// @name         S1 Plus - Stage1st 体验增强套件
// @namespace    http://tampermonkey.net/
// @version      4.1.0
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

    const SCRIPT_VERSION = '4.1.0';
    const SCRIPT_RELEASE_DATE = '2025-08-05';

    // --- 样式注入 ---
    GM_addStyle(`
        /* --- 核心修复：禁用论坛自带的用户信息悬浮窗 --- */
        #p_pop { display: none !important; }

        /* --- 关键字屏蔽样式 --- */
        .s1plus-hidden-by-keyword, .s1plus-hidden-by-quote { display: none !important; }

        /* --- 按钮通用样式 --- */
        .s1plus-btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; background-color: #f3f4f6; color: #374151; font-size: 12px; font-weight: bold; cursor: pointer; user-select: none; white-space: nowrap; border: none; }
        .s1plus-btn:hover { background-color: #ef4444; color: white; }

        /* --- 帖子屏蔽按钮动画与布局 --- */
        .thread-block-btn { position: absolute; top: 50%; left: 50%; z-index: 5; padding: 5px 10px 5px 12px; border-radius: 0 30px 30px 0; background-color: #f87171; color: white; font-size: 12px; border: none; box-shadow: 0 1px 3px rgba(0,0,0,0.2); opacity: 0; visibility: hidden; transform: translate(-50%, -50%) scale(0.85); transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        tbody[id^="normalthread_"]:hover .thread-block-btn, tbody[id^="stickthread_"]:hover .thread-block-btn { opacity: 1; visibility: visible; transform: translate(-50%, -50%) scale(1); transition-delay: 0.1s; }
        .thread-block-btn:hover { background-color: #ef4444; transform: translate(-50%, -50%) scale(1.1); }

        /* 阅读进度跳转按钮样式 */
        .s1plus-progress-jump-btn {
            display: inline-block;
            margin: 0 8px;
            font-size: 12px;
            font-weight: normal;
            color: #6b7280;
            text-decoration: none;
            border: 1px solid #e5e7eb;
            background-color: #f9fafb;
            border-radius: 4px;
            padding: 1px 6px;
            transition: all 0.2s ease-in-out;
            vertical-align: middle;
        }
        .s1plus-progress-jump-btn:hover {
            color: white;
            background-color: #3b82f6;
            border-color: #3b82f6;
        }

        /* --- 用户屏蔽悬停交互样式 --- */
        .s1plus-avatar-overlay-container { position: absolute; display: flex; align-items: center; justify-content: center; background-color: rgba(0, 0, 0, 0.55); opacity: 0; visibility: hidden; transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out; pointer-events: auto; z-index: 10; }
        .pls:hover .s1plus-avatar-overlay-container { opacity: 1; visibility: visible; }
        .s1plus-avatar-overlay-container .s1plus-btn { color: white; background-color: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.5); transform: scale(1); transition: all 0.2s ease-in-out; padding: 4px 8px; }
        .s1plus-avatar-overlay-container .s1plus-btn:hover { background-color: #ef4444; border-color: #ef4444; transform: scale(1.05); }

        /* --- [MODIFIED] 用户标记悬浮窗 (Style Revamp per Image 2) --- */
        .s1plus-tag-popover {
            position: absolute;
            z-index: 10001;
            width: 300px;
            background-color: white;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
            border: 1px solid #f0f0f0;
            opacity: 0;
            visibility: hidden;
            transform: translateY(5px) scale(0.98);
            transition: opacity 0.2s ease-out, transform 0.2s ease-out, visibility 0.2s;
            pointer-events: none;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        .s1plus-tag-popover.visible {
            opacity: 1;
            visibility: visible;
            transform: translateY(0) scale(1);
            pointer-events: auto;
        }
        .s1plus-popover-content {
            padding: 16px;
        }
        .s1plus-popover-main-content {
            font-size: 14px;
            line-height: 1.6;
            color: #1a1a1a;
            padding: 4px 4px 20px 4px;
            min-height: 30px;
            word-wrap: break-word;
            white-space: pre-wrap;
        }
        .s1plus-popover-main-content.empty {
            text-align: center;
            color: #888;
        }
        .s1plus-popover-hr {
            border: none;
            border-top: 1px solid #f0f0f0;
            margin: 0;
        }
        .s1plus-popover-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding-top: 16px;
        }
        .s1plus-popover-user-container {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }
        .s1plus-popover-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
            background-color: #f0f0f0;
        }
        .s1plus-popover-user-info {
            flex-grow: 1;
            min-width: 0;
        }
        .s1plus-popover-username {
            font-weight: 500;
            color: #111;
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .s1plus-popover-user-id {
            font-size: 12px;
            color: #888;
            white-space: nowrap;
        }
        .s1plus-popover-actions {
            display: flex;
            gap: 8px;
            flex-shrink: 0;
        }
        .s1plus-popover-btn {
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 500;
            border-radius: 6px;
            cursor: pointer;
            border: none;
            transition: background-color 0.2s ease, color 0.2s ease;
            background-color: #f1f2f3;
            color: #333;
            white-space: nowrap;
            text-decoration: none !important;
        }
        /* [FIX] Blue hover for most buttons */
        .s1plus-popover-btn:hover {
            background-color: #3b82f6;
            color: white;
            text-decoration: none !important;
        }
        /* [FIX] Red hover specifically for the delete button */
        .s1plus-popover-btn[data-action="delete-tag"]:hover {
            background-color: #ef4444;
            color: white;
        }
        .s1plus-edit-mode-header {
            font-weight: 600;
            color: #111;
            font-size: 15px;
            margin-bottom: 12px;
        }
        .s1plus-edit-mode-textarea {
            width: 100%;
            height: 90px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 10px;
            font-size: 14px;
            resize: vertical;
            box-sizing: border-box;
            margin-bottom: 12px;
        }
        .s1plus-edit-mode-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        /* --- 设置面板样式 --- */
        .s1plus-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; }
        .s1plus-modal-content { background-color: white; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); width: 600px; max-width: 90%; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; }
        .s1plus-modal-header { padding: 16px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
        .s1plus-modal-title { font-size: 18px; font-weight: bold; color: #111827; }
        .s1plus-modal-close {
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
        .s1plus-modal-close:hover {
            color: #ef4444;
            transform: rotate(90deg);
        }
        .s1plus-modal-body { padding: 0 16px 16px; overflow-y: auto; flex-grow: 1; }
        .s1plus-modal-footer { padding: 12px 16px; border-top: 1px solid #e5e7eb; text-align: right; font-size: 12px; color: #9ca3af; }
        .s1plus-tabs { display: flex; border-bottom: 1px solid #e5e7eb; margin-bottom: 16px; }
        .s1plus-tab-btn { padding: 12px 16px; cursor: pointer; border: none; background-color: transparent; font-size: 14px; color: #6b7280; border-bottom: 2px solid transparent; transition: all 0.2s; }
        .s1plus-tab-btn:hover { color: #111827; }
        .s1plus-tab-btn.active { color: #3b82f6; border-bottom-color: #3b82f6; font-weight: 500; }
        .s1plus-tab-content { display: none; padding-top: 8px; }
        .s1plus-tab-content.active { display: block; }
        .s1plus-empty { text-align: center; padding: 24px; color: #6b7280; }
        .s1plus-list { display: flex; flex-direction: column; gap: 8px; }
        .s1plus-item { display: flex; justify-content: space-between; align-items: flex-start; padding: 12px; border-radius: 6px; background-color: #f9fafb; border: 1px solid #e5e7eb; }
        .s1plus-item-info { flex-grow: 1; min-width: 0; }
        .s1plus-item-title { font-weight: 500; color: #111827; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s1plus-item-meta { font-size: 12px; color: #6b7280; margin-bottom: 8px; }
        .s1plus-item-toggle { font-size: 12px; color: #374151; display: flex; align-items: center; gap: 8px; }
        .s1plus-item-toggle input { /* Handled by .s1plus-switch */ }
        .s1plus-unblock-btn { padding: 6px 12px; border-radius: 4px; background-color: #f3f4f6; color: #6b7280; font-size: 14px; cursor: pointer; transition: all 0.2s; border: none; flex-shrink: 0; align-self: center; }
        .s1plus-unblock-btn:hover { background-color: #10b981; color: white; }
        .s1plus-sync-title { font-weight: 500; color: #111827; margin-bottom: 8px; }
        .s1plus-sync-desc { font-size: 14px; color: #6b7280; margin-bottom: 12px; line-height: 1.5; }
        .s1plus-sync-buttons { display: flex; gap: 8px; margin-bottom: 16px; }
        .s1plus-sync-btn { padding: 6px 12px; border-radius: 4px; background-color: #f3f4f6; color: #6b7280; font-size: 14px; cursor: pointer; transition: all 0.2s; border: none; }
        .s1plus-sync-btn:hover { background-color: #3b82f6; color: white; }
        .s1plus-sync-textarea { width: 100%; min-height: 80px; padding: 8px; border-radius: 4px; border: 1px solid #e5e7eb; font-family: monospace; font-size: 12px; resize: vertical; margin-bottom: 8px; box-sizing: border-box; }
        .s1plus-message { font-size: 14px; margin-top: 8px; padding: 8px; border-radius: 4px; display:none; text-align: center; }
        .s1plus-message.success { background-color: #d1fae5; color: #065f46; }
        .s1plus-message.error { background-color: #fee2e2; color: #ef4444; }

        /* --- 确认弹窗样式 --- */
        @keyframes s1plus-fade-in { from { opacity: 0; } to { opacity: 1; } } @keyframes s1plus-scale-in { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } } @keyframes s1plus-fade-out { from { opacity: 1; } to { opacity: 0; } } @keyframes s1plus-scale-out { from { transform: scale(1); opacity: 1; } to { transform: scale(0.97); opacity: 0; } }
        .s1plus-confirm-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.65); display: flex; justify-content: center; align-items: center; z-index: 10000; animation: s1plus-fade-in 0.2s ease-out; }
        .s1plus-confirm-content { background-color: white; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); width: 420px; max-width: 90%; text-align: left; overflow: hidden; animation: s1plus-scale-in 0.25s ease-out; }
        .s1plus-confirm-body { padding: 20px 24px; font-size: 16px; color: #1f2937; line-height: 1.6; } .s1plus-confirm-body .confirm-title { font-weight: 600; font-size: 18px; margin-bottom: 8px; } .s1plus-confirm-body .confirm-subtitle { font-size: 14px; color: #6b7280; }
        .s1plus-confirm-footer { padding: 12px 16px; background-color: #f3f3f3ff; display: flex; justify-content: flex-end; gap: 12px; }
        .s1plus-confirm-btn { padding: 9px 18px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: all 0.15s ease-in-out; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); } .s1plus-confirm-btn:active { transform: translateY(1px); } .s1plus-confirm-btn.cancel { background-color: white; color: #374151; border-color: #d1d5db; } .s1plus-confirm-btn.cancel:hover { background-color: #f9fafb; border-color: #b0b8c2; } .s1plus-confirm-btn.confirm { background-color: #ef4444; color: white; border-color: #ef4444; } .s1plus-confirm-btn.confirm:hover { background-color: #dc2626; border-color: #dc2626; }

        /* --- Collapsible Section --- */
        .s1plus-collapsible-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; transition: color 0.2s ease; }
        .s1-settings-group-title.s1plus-collapsible-header { margin-bottom: 0; }
        .s1plus-collapsible-header:hover { color: #3b82f6; }
        .s1plus-collapsible-header:hover .s1plus-expander-arrow { color: #3b82f6; }
        .s1plus-expander-arrow {
            display: inline-block; width: 12px; height: 12px; color: #6b7280;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 16'%3E%3Cpath d='M2 2L8 8L2 14' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E");
            background-repeat: no-repeat; background-position: center; background-size: contain; transition: transform 0.3s ease-in-out, color 0.2s ease;
        }
        .s1plus-expander-arrow.expanded { transform: rotate(90deg); }
        .s1plus-collapsible-content { max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out; }
        .s1plus-collapsible-content.expanded { max-height: 500px; transition: max-height 0.4s ease-in; padding-top: 12px; }

        /* --- 界面定制设置样式 --- */
        .s1-settings-group { margin-bottom: 24px; }
        .s1-settings-group-title { font-size: 16px; font-weight: 500; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; }
        .s1-settings-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
        .s1-settings-label { color: #374151; font-size: 14px; }
        .s1-settings-checkbox { /* Handled by .s1plus-switch */ }
        .s1plus-setting-desc { font-size: 12px; color: #6b7280; margin: -4px 0 12px 0; padding: 0; line-height: 1.5; }
        .s1-editor-item { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 8px; border-radius: 4px; background: #f9fafb; }
        .s1-editor-item:not(:last-child) { margin-bottom: 8px; }
        .s1-editor-item input[type="text"] { width: 100%; border: 1px solid #d1d5db; border-radius: 4px; padding: 6px 8px; font-size: 14px; box-sizing: border-box; }
        .s1-editor-item-controls { display: flex; align-items: center; gap: 4px; }
        .s1-editor-btn { padding: 4px; font-size: 18px; line-height: 1; cursor: pointer; border-radius: 4px; border:none; background: transparent; color: #9ca3af; }
        .s1-editor-btn:hover { background: #e5e7eb; color: #374151; }
        .s1-editor-btn.keyword-rule-delete,
        .s1-editor-btn[data-action="delete"] {
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
        .s1-editor-btn.keyword-rule-delete:hover,
        .s1-editor-btn[data-action="delete"]:hover {
            background-color: #ef4444;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0' /%3E%3C/svg%3E");
        }
        .s1-editor-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
        .s1-settings-action-btn { display: inline-block; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; border: none; }
        .s1-settings-action-btn.primary { background-color: #3b82f6; color: white; } .s1-settings-action-btn.primary:hover { background-color: #2563eb; }
        .s1-settings-action-btn.secondary { background-color: #e5e7eb; color: #374151; } .s1-settings-action-btn.secondary:hover { background-color: #d1d5db; }

        /* --- Modern Toggle Switch --- */
        .s1plus-switch { position: relative; display: inline-block; width: 40px; height: 22px; vertical-align: middle; flex-shrink: 0; }
        .s1plus-switch input { opacity: 0; width: 0; height: 0; }
        .s1plus-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #d1d5db; transition: .3s; border-radius: 22px; }
        .s1plus-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        input:checked + .s1plus-slider { background-color: #3b82f6; }
        input:checked + .s1plus-slider:before { transform: translateX(18px); }

        /* --- Nav Editor Dragging --- */
        .s1-editor-item.dragging { opacity: 0.5; }

        /* --- [NEW] 用户标记设置面板专属样式 --- */
        .s1plus-item-meta-id { font-family: monospace; background-color: #e5e7eb; padding: 1px 5px; border-radius: 4px; font-size: 11px; color: #4b5563; }
        .s1plus-item-content { margin-top: 8px; color: #374151; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
        .s1plus-item-editor textarea { width: 100%; min-height: 60px; border: 1px solid #d1d5db; border-radius: 4px; padding: 6px 8px; font-size: 14px; resize: vertical; box-sizing: border-box; margin-top: 8px; }
        .s1plus-item-actions { display: flex; align-self: flex-start; flex-shrink: 0; gap: 8px; margin-left: 16px; }
        .s1plus-item-actions .s1plus-btn { padding: 6px 12px; font-size: 14px; background-color: #f3f4f6; color: #6b7280; cursor: pointer; border: none; }
        .s1plus-item-actions .s1plus-btn:hover { background-color: #e5e7eb; color: #1f2937; }
        .s1plus-item-actions .s1plus-btn[data-action="edit-tag-item"]:hover { background-color: #2563eb; color: white; }
        .s1plus-item-actions .s1plus-btn.primary { background-color: #3b82f6; color: white; }
        .s1plus-item-actions .s1plus-btn.primary:hover { background-color: #2563eb; }
        .s1plus-item-actions .s1plus-btn.danger:hover { background-color: #ef4444; color: white; }

        /* --- [NEW] 引用屏蔽占位符 (Refined Style) --- */
        .s1plus-quote-placeholder {
            background-color: transparent;
            border: none;
            padding: 0;
            margin: 10px 0;
            font-size: 13px;
            color: #6b7280;
            display: flex;
            align-items: center;
            gap: 8px; /* Add gap between text and link */
        }

        /* --- [NEW] Quote Collapse Animation --- */
        .s1plus-quote-wrapper {
            overflow: hidden;
            transition: max-height 0.35s ease-in-out;
        }
        
    `);

    let dynamicallyHiddenThreads = {};

    // --- 数据处理 & 核心功能 ---
    const getBlockedThreads = () => GM_getValue('s1plus_blocked_threads', {});
    const saveBlockedThreads = (threads) => GM_setValue('s1plus_blocked_threads', threads);
    const getBlockedUsers = () => GM_getValue('s1plus_blocked_users', {});
    const saveBlockedUsers = (users) => GM_setValue('s1plus_blocked_users', users);
    const saveUserTags = (tags) => GM_setValue('s1plus_user_tags', tags);

    // [MODIFIED] 升级并获取用户标记，自动迁移旧数据
    const getUserTags = () => {
        const tags = GM_getValue('s1plus_user_tags', {});
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
        const rules = GM_getValue('s1plus_title_filter_rules', null);
        if (rules !== null) return rules;

        // --- 向下兼容：迁移旧的关键字数据 ---
        const oldKeywords = GM_getValue('s1plus_title_keywords', null);
        if (Array.isArray(oldKeywords)) {
            const newRules = oldKeywords.map(k => ({ pattern: k, enabled: true, id: `rule_${Date.now()}_${Math.random()}` }));
            saveTitleFilterRules(newRules);
            GM_setValue('s1plus_title_keywords', null); // 清理旧数据
            return newRules;
        }
        return [];
    };
    const saveTitleFilterRules = (rules) => GM_setValue('s1plus_title_filter_rules', rules);

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

            const wrapper = quoteElement.parentElement.classList.contains('s1plus-quote-wrapper') ? quoteElement.parentElement : null;

            if (isBlocked) {
                if (!wrapper) {
                    const newWrapper = document.createElement('div');
                    newWrapper.className = 's1plus-quote-wrapper';
                    quoteElement.parentNode.insertBefore(newWrapper, quoteElement);
                    newWrapper.appendChild(quoteElement);
                    newWrapper.style.maxHeight = '0';

                    const newPlaceholder = document.createElement('div');
                    newPlaceholder.className = 's1plus-quote-placeholder';
                    newPlaceholder.innerHTML = `<span>一条来自已屏蔽用户的引用已被隐藏。</span><a class="s1plus-quote-toggle s1plus-popover-btn">点击展开</a>`;
                    newWrapper.parentNode.insertBefore(newPlaceholder, newWrapper);

                    newPlaceholder.querySelector('.s1plus-quote-toggle').addEventListener('click', function() {
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
                    if (placeholder && placeholder.classList.contains('s1plus-quote-placeholder')) {
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
                    row.classList.add('s1plus-hidden-by-keyword');
                    isHidden = true;
                }
            }

            if (!isHidden) {
                row.classList.remove('s1plus-hidden-by-keyword');
            }
        });
        dynamicallyHiddenThreads = newHiddenThreads;
    };

    const getReadProgress = () => GM_getValue('s1plus_read_progress', {});
    const saveReadProgress = (progress) => GM_setValue('s1plus_read_progress', progress);
    const updateThreadProgress = (threadId, postId, page) => {
        if (!postId || !page) return;
        const progress = getReadProgress();
        progress[threadId] = { postId, page, timestamp: Date.now() };
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
        enableNavCustomization: true,
        changeLogoLink: true,
        hideBlacklistTip: true,
        blockThreadsOnUserBlock: true,
        showBlockedByKeywordList: false,
        showManuallyBlockedList: false,
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
        const saved = GM_getValue('s1plus_settings', {});
        return {...defaultSettings, ...saved};
    };
    const saveSettings = (settings) => GM_setValue('s1plus_settings', settings);

    // --- 界面定制功能 ---
    const applyInterfaceCustomizations = () => {
        const settings = getSettings();
        if (settings.changeLogoLink) document.querySelector('#hd h2 a')?.setAttribute('href', './forum.php');
        if (settings.hideBlacklistTip) document.getElementById('hiddenpoststip')?.remove();
    };

    const initializeNavbar = () => {
        const settings = getSettings();
        const navUl = document.querySelector('#nv > ul');
        if (!navUl) return;

        const createManagerLink = () => {
            const li = document.createElement('li');
            li.id = 's1plus-nav-link';
            const a = document.createElement('a');
            a.href = 'javascript:void(0);';
            a.textContent = 'S1 Plus 设置';
            a.addEventListener('click', createManagementModal);
            li.appendChild(a);
            return li;
        };

        document.getElementById('s1plus-nav-link')?.remove();

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
    const showMessage = (msgEl, message, isSuccess) => { msgEl.textContent = message; msgEl.className = `s1plus-message ${isSuccess ? 'success' : 'error'}`; msgEl.style.display = 'block'; setTimeout(() => { msgEl.style.display = 'none'; }, 3000); };

    const createConfirmationModal = (title, subtitle, onConfirm, confirmText = '确定') => {
        document.querySelector('.s1plus-confirm-modal')?.remove();
        const modal = document.createElement('div');
        modal.className = 's1plus-confirm-modal';
        modal.innerHTML = `<div class="s1plus-confirm-content"><div class="s1plus-confirm-body"><div class="confirm-title">${title}</div><div class="confirm-subtitle">${subtitle}</div></div><div class="s1plus-confirm-footer"><button class="s1plus-confirm-btn cancel">取消</button><button class="s1plus-confirm-btn confirm">${confirmText}</button></div></div>`;
        const closeModal = () => { modal.querySelector('.s1plus-confirm-content').style.animation = 's1plus-scale-out 0.25s ease-out forwards'; modal.style.animation = 's1plus-fade-out 0.25s ease-out forwards'; setTimeout(() => modal.remove(), 250); };
        modal.querySelector('.confirm').addEventListener('click', () => { onConfirm(); closeModal(); });
        modal.querySelector('.cancel').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        document.body.appendChild(modal);
    };

    const createManagementModal = () => {
        document.querySelector('.s1plus-modal')?.remove();
        const modal = document.createElement('div');
        modal.className = 's1plus-modal';
        modal.innerHTML = `<div class="s1plus-modal-content">
            <div class="s1plus-modal-header"><div class="s1plus-modal-title">S1 Plus 设置</div><div class="s1plus-modal-close"></div></div>
            <div class="s1plus-modal-body">
                <div class="s1plus-tabs">
                    <button class="s1plus-tab-btn active" data-tab="threads">帖子屏蔽</button>
                    <button class="s1plus-tab-btn" data-tab="users">用户屏蔽</button>
                    <button class="s1plus-tab-btn" data-tab="tags">用户标记</button>
                    <button class="s1plus-tab-btn" data-tab="settings">界面定制</button>
                    <button class="s1plus-tab-btn" data-tab="sync">设置同步</button>
                </div>
                <div id="s1-tab-threads" class="s1plus-tab-content active"></div>
                <div id="s1-tab-users" class="s1plus-tab-content"></div>
                <div id="s1-tab-tags" class="s1plus-tab-content"></div>
                <div id="s1-tab-settings" class="s1plus-tab-content"></div>
                <div id="s1-tab-sync" class="s1plus-tab-content">
                    <div class="s1plus-sync-title">全量设置同步</div>
                    <div class="s1plus-sync-desc">通过复制/粘贴数据，在不同浏览器或设备间同步你的所有S1 Plus配置，包括屏蔽列表、导航栏、阅读进度和各项开关设置。</div>
                    <div class="s1plus-sync-buttons">
                        <button id="s1-export-btn" class="s1plus-sync-btn">导出数据</button>
                        <button id="s1-import-btn" class="s1plus-sync-btn">导入数据</button>
                    </div>
                    <textarea id="s1-sync-textarea" class="s1plus-sync-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据"></textarea>
                    <div id="s1-sync-message" class="s1plus-message"></div>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                    <div class="s1plus-sync-title">危险操作</div>
                    <div class="s1plus-sync-desc">以下操作会立即清空脚本在<b>当前浏览器</b>中的所有数据（包括屏蔽列表、设置和阅读进度），且无法撤销。请在操作前务必通过“导出数据”功能进行备份。</div>
                    <div style="margin-top: 12px;">
                        <button id="s1-reset-btn" class="s1plus-sync-btn" style="background-color: #ef4444; color: white;">清除并重置所有本地数据</button>
                    </div>
                </div>
            </div>
            <div class="s1plus-modal-footer">版本: ${SCRIPT_VERSION} (${SCRIPT_RELEASE_DATE})</div>
        </div>`;
        document.body.appendChild(modal);

        const tabs = {
            threads: modal.querySelector('#s1-tab-threads'),
            users: modal.querySelector('#s1-tab-users'),
            tags: modal.querySelector('#s1-tab-tags'),
            settings: modal.querySelector('#s1-tab-settings'),
            sync: modal.querySelector('#s1-tab-sync'),
        };

        // [REFACTORED] 全新用户标记标签页渲染逻辑
        const renderTagsTab = (options = {}) => {
            const editingUserId = options.editingUserId;
            const userTags = getUserTags();
            const tagItems = Object.entries(userTags).sort(([, a], [, b]) => (b.timestamp || 0) - (a.timestamp || 0));

            tabs.tags.innerHTML = `
                <div class="s1-settings-group">
                    <div class="s1plus-sync-title">用户标记管理</div>
                    <p class="s1plus-setting-desc" style="margin-top: 0; margin-bottom: 16px;">
                        在此集中管理、编辑、导出或导入您为所有用户添加的标记。
                    </p>
                    <div class="s1plus-sync-buttons">
                        <button id="s1-export-tags-btn" class="s1plus-sync-btn">导出全部标记</button>
                        <button id="s1-import-tags-btn" class="s1plus-sync-btn">导入标记</button>
                    </div>
                    <textarea id="s1-tags-sync-textarea" class="s1plus-sync-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据..."></textarea>
                    <div id="s1-tags-sync-message" class="s1plus-message"></div>
                </div>

                <div class="s1-settings-group">
                    <div class="s1-settings-group-title">已标记用户列表</div>
                    ${tagItems.length === 0
                    ? `<div class="s1plus-empty">暂无用户标记</div>`
                    : `<div class="s1plus-list">${tagItems.map(([id, data]) => {
                        if (id === editingUserId) {
                            // --- 编辑模式 ---
                            return `
                            <div class="s1plus-item" data-user-id="${id}">
                                <div class="s1plus-item-info">
                                    <div class="s1plus-item-title">${data.name}</div>
                                    <div class="s1plus-item-meta">
                                        ID: <span class="s1plus-item-meta-id">${id}</span>
                                    </div>
                                    <div class="s1plus-item-editor">
                                        <textarea class="s1plus-tag-edit-area">${data.tag}</textarea>
                                    </div>
                                </div>
                                <div class="s1plus-item-actions">
                                    <button class="s1plus-btn primary" data-action="save-tag-edit" data-user-id="${id}" data-user-name="${data.name}">保存</button>
                                    <button class="s1plus-btn" data-action="cancel-tag-edit">取消</button>
                                </div>
                            </div>`;
                        } else {
                            // --- 正常显示模式 ---
                            return `
                            <div class="s1plus-item" data-user-id="${id}">
                                <div class="s1plus-item-info">
                                    <div class="s1plus-item-title">${data.name}</div>
                                    <div class="s1plus-item-meta">
                                        ID: <span class="s1plus-item-meta-id">${id}</span> &nbsp;
                                        标记于: ${formatDate(data.timestamp)}
                                    </div>
                                    <div class="s1plus-item-content">${data.tag}</div>
                                </div>
                                <div class="s1plus-item-actions">
                                    <button class="s1plus-btn" data-action="edit-tag-item" data-user-id="${id}">编辑</button>
                                    <button class="s1plus-btn danger" data-action="delete-tag-item" data-user-id="${id}" data-user-name="${data.name}">删除</button>
                                </div>
                            </div>`;
                        }
                    }).join('')}</div>`
                }
                </div>
            `;

            if (editingUserId) {
                const textarea = tabs.tags.querySelector('.s1plus-tag-edit-area');
                if (textarea) {
                    textarea.focus();
                    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
                }
            }
        };

        const renderUserTab = () => {
            const settings = getSettings();
            const blockedUsers = getBlockedUsers();
            const userItemIds = Object.keys(blockedUsers).sort((a, b) => blockedUsers[b].timestamp - blockedUsers[a].timestamp);
            tabs.users.innerHTML = `
                <div class="s1-settings-group" style="margin-bottom: 16px; padding-bottom: 0;">
                    <div class="s1-settings-item">
                        <label class="s1-settings-label" for="s1-blockThreadsOnUserBlock">屏蔽用户时，默认屏蔽其所有主题帖</label>
                        <label class="s1plus-switch"><input type="checkbox" id="s1-blockThreadsOnUserBlock" class="s1-settings-checkbox" ${settings.blockThreadsOnUserBlock ? 'checked' : ''}><span class="s1plus-slider"></span></label>
                    </div>
                </div>
                <p class="s1plus-setting-desc" style="margin-top: -4px; margin-bottom: 16px;">
                    <strong>提示</strong>：顶部总开关仅影响<strong>未来新屏蔽用户</strong>的默认设置。每个用户下方的独立开关，才是控制该用户主题帖的<strong>最终开关</strong>，拥有最高优先级。
                </p>
                ${userItemIds.length === 0
                    ? `<div class="s1plus-empty">暂无屏蔽的用户</div>`
                    : `<div class="s1plus-list">${userItemIds.map(id => {
                        const item = blockedUsers[id];
                        return `<div class="s1plus-item" data-user-id="${id}"><div class="s1plus-item-info"><div class="s1plus-item-title">${item.name || `用户 #${id}`}</div><div class="s1plus-item-meta">屏蔽时间: ${formatDate(item.timestamp)}</div><div class="s1plus-item-toggle"><label class="s1plus-switch"><input type="checkbox" class="user-thread-block-toggle" data-user-id="${id}" ${item.blockThreads ? 'checked' : ''}><span class="s1plus-slider"></span></label><span>屏蔽该用户的主题帖</span></div></div><button class="s1plus-unblock-btn" data-unblock-user-id="${id}">取消屏蔽</button></div>`;
                    }).join('')}</div>`
                }
            `;
        };

        const renderThreadTab = () => {
            const settings = getSettings();
            const blockedThreads = getBlockedThreads();
            const manualItemIds = Object.keys(blockedThreads).sort((a, b) => blockedThreads[b].timestamp - blockedThreads[a].timestamp);

            tabs.threads.innerHTML = `
                <div class="s1-settings-group">
                    <div class="s1-settings-group-title">标题关键字屏蔽规则</div>
                    <p class="s1plus-setting-desc">将自动屏蔽标题匹配已启用规则的帖子，支持正则表达式。修改后请点击“保存规则”以生效。</p>
                    <div id="s1-keyword-rules-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
                    <div class="s1-editor-footer" style="justify-content: flex-start; gap: 8px;">
                         <button id="s1-keyword-rule-add-btn" class="s1plus-sync-btn">添加新规则</button>
                         <button id="s1-keyword-rules-save-btn" class="s1plus-sync-btn">保存规则</button>
                    </div>
                    <div id="s1-keywords-message" class="s1plus-message"></div>
                </div>

                <div class="s1-settings-group">
                    <div id="s1-blocked-by-keyword-header" class="s1-settings-group-title s1plus-collapsible-header">
                        <span>当前页面被关键字屏蔽的帖子</span>
                        <span class="s1plus-expander-arrow ${settings.showBlockedByKeywordList ? 'expanded' : ''}"></span>
                    </div>
                    <div id="s1-dynamically-hidden-list-container" class="s1plus-collapsible-content ${settings.showBlockedByKeywordList ? 'expanded' : ''}">
                        <div id="s1-dynamically-hidden-list"></div>
                    </div>
                </div>

                <div class="s1-settings-group">
                     <div id="s1-manually-blocked-header" class="s1-settings-group-title s1plus-collapsible-header">
                        <span>手动屏蔽的帖子列表</span>
                        <span class="s1plus-expander-arrow ${settings.showManuallyBlockedList ? 'expanded' : ''}"></span>
                    </div>
                    <div id="s1-manually-blocked-list-container" class="s1plus-collapsible-content ${settings.showManuallyBlockedList ? 'expanded' : ''}">
                    ${manualItemIds.length === 0
                        ? `<div class="s1plus-empty">暂无手动屏蔽的帖子</div>`
                        : `<div class="s1plus-list">${manualItemIds.map(id => {
                            const item = blockedThreads[id];
                            return `<div class="s1plus-item" data-thread-id="${id}"><div class="s1plus-item-info"><div class="s1plus-item-title">${item.title || `帖子 #${id}`}</div><div class="s1plus-item-meta">屏蔽时间: ${formatDate(item.timestamp)} ${item.reason && item.reason !== 'manual' ? `(因屏蔽用户${item.reason.replace('user_','')})` : ''}</div></div><button class="s1plus-unblock-btn" data-unblock-thread-id="${id}">取消屏蔽</button></div>`;
                        }).join('')}</div>`
                    }
                    </div>
                </div>
            `;

            const renderDynamicallyHiddenList = () => {
                const listContainer = tabs.threads.querySelector('#s1-dynamically-hidden-list');
                const hiddenItems = Object.entries(dynamicallyHiddenThreads);
                if (hiddenItems.length === 0) {
                    listContainer.innerHTML = `<div class="s1plus-empty" style="padding-top: 12px;">当前页面没有被关键字屏蔽的帖子</div>`;
                } else {
                    listContainer.innerHTML = `<div class="s1plus-list">${hiddenItems.map(([id, item]) => `
                        <div class="s1plus-item" data-thread-id="${id}">
                            <div class="s1plus-item-info">
                                <div class="s1plus-item-title" title="${item.title}">${item.title}</div>
                                <div class="s1plus-item-meta">匹配规则: <code style="background: #eee; padding: 2px 4px; border-radius: 3px;">${item.pattern}</code></div>
                            </div>
                        </div>
                    `).join('')}</div>`;
                }
            };

            const renderRules = () => {
                const rules = getTitleFilterRules();
                const container = tabs.threads.querySelector('#s1-keyword-rules-list');
                container.innerHTML = rules.map(rule => `
                    <div class="s1-editor-item" data-rule-id="${rule.id}">
                        <label class="s1plus-switch"><input type="checkbox" class="s1-settings-checkbox keyword-rule-enable" ${rule.enabled ? 'checked' : ''}><span class="s1plus-slider"></span></label>
                        <input type="text" class="keyword-rule-pattern" placeholder="输入关键字或正则表达式" value="${rule.pattern || ''}">
                        <div class="s1-editor-item-controls">
                            <button class="s1-editor-btn keyword-rule-delete" title="删除规则"></button>
                        </div>
                    </div>
                `).join('');
                 if (rules.length === 0) {
                    container.innerHTML = `<div class="s1plus-empty" style="padding: 12px;">暂无规则</div>`;
                }
            };

            renderRules();
            renderDynamicallyHiddenList();

            const saveAndApplyKeywordRules = () => {
                const newRules = [];
                tabs.threads.querySelectorAll('#s1-keyword-rules-list .s1-editor-item').forEach(item => {
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
                showMessage(tabs.threads.querySelector('#s1-keywords-message'), '规则已保存！', true);
            };

            tabs.threads.addEventListener('click', e => {
                const target = e.target;
                const header = target.closest('.s1plus-collapsible-header');

                if (header) {
                    if (header.id === 's1-blocked-by-keyword-header') {
                        const currentSettings = getSettings();
                        const isNowExpanded = !currentSettings.showBlockedByKeywordList;
                        currentSettings.showBlockedByKeywordList = isNowExpanded;
                        saveSettings(currentSettings);

                        header.querySelector('.s1plus-expander-arrow').classList.toggle('expanded', isNowExpanded);
                        tabs.threads.querySelector('#s1-dynamically-hidden-list-container').classList.toggle('expanded', isNowExpanded);
                    } else if (header.id === 's1-manually-blocked-header') {
                        const currentSettings = getSettings();
                        const isNowExpanded = !currentSettings.showManuallyBlockedList;
                        currentSettings.showManuallyBlockedList = isNowExpanded;
                        saveSettings(currentSettings);

                        header.querySelector('.s1plus-expander-arrow').classList.toggle('expanded', isNowExpanded);
                        tabs.threads.querySelector('#s1-manually-blocked-list-container').classList.toggle('expanded', isNowExpanded);
                    }
                } else if (target.id === 's1-keyword-rule-add-btn') {
                    const container = tabs.threads.querySelector('#s1-keyword-rules-list');
                    const emptyMsg = container.querySelector('.s1plus-empty');
                    if (emptyMsg) emptyMsg.remove();

                    const newItem = document.createElement('div');
                    newItem.className = 's1-editor-item';
                    newItem.dataset.ruleId = `new_${Date.now()}`;
                    newItem.innerHTML = `
                        <label class="s1plus-switch"><input type="checkbox" class="s1-settings-checkbox keyword-rule-enable" checked><span class="s1plus-slider"></span></label>
                        <input type="text" class="keyword-rule-pattern" placeholder="输入关键字或正则表达式" value="">
                        <div class="s1-editor-item-controls">
                            <button class="s1-editor-btn keyword-rule-delete" title="删除规则"></button>
                        </div>
                    `;
                    container.appendChild(newItem);
                    newItem.querySelector('input[type="text"]').focus();
                } else if (target.classList.contains('keyword-rule-delete')) {
                    const item = target.closest('.s1-editor-item');
                    item.remove();
                    const container = tabs.threads.querySelector('#s1-keyword-rules-list');
                    if (container.children.length === 0) {
                        container.innerHTML = `<div class="s1plus-empty" style="padding: 12px;">暂无规则</div>`;
                    }
                } else if (target.id === 's1-keyword-rules-save-btn') {
                    saveAndApplyKeywordRules();
                }
            });
        };

        const renderSettingsTab = () => {
            const settings = getSettings();
            tabs.settings.innerHTML = `
                <div class="s1-settings-group">
                    <div class="s1-settings-group-title">通用设置</div>
                    <div class="s1-settings-item">
                        <label class="s1-settings-label" for="s1-changeLogoLink">修改论坛Logo链接 (指向论坛首页)</label>
                        <label class="s1plus-switch"><input type="checkbox" id="s1-changeLogoLink" class="s1-settings-checkbox" ${settings.changeLogoLink ? 'checked' : ''}><span class="s1plus-slider"></span></label>
                    </div>
                    <div class="s1-settings-item">
                        <label class="s1-settings-label" for="s1-hideBlacklistTip">隐藏已屏蔽用户发言的黄条提示</label>
                        <label class="s1plus-switch"><input type="checkbox" id="s1-hideBlacklistTip" class="s1-settings-checkbox" ${settings.hideBlacklistTip ? 'checked' : ''}><span class="s1plus-slider"></span></label>
                    </div>
                </div>
                <div class="s1-settings-group">
                    <div class="s1-settings-group-title">导航栏定制</div>
                    <div class="s1-settings-item">
                        <label class="s1-settings-label" for="s1-enableNavCustomization">启用自定义导航栏</label>
                        <label class="s1plus-switch"><input type="checkbox" id="s1-enableNavCustomization" class="s1-settings-checkbox" ${settings.enableNavCustomization ? 'checked' : ''}><span class="s1plus-slider"></span></label>
                    </div>
                    <div class="s1-nav-editor-list" style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;"></div>
                </div>
                <div class="s1-editor-footer" style="border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 24px;">
                    <div style="display: flex; gap: 8px;">
                        <button id="s1-nav-add-btn" class="s1plus-sync-btn">添加新链接</button>
                        <button id="s1-settings-save-btn" class="s1plus-sync-btn">保存设置</button>
                    </div>
                    <button id="s1-nav-restore-btn" class="s1plus-sync-btn" style="background-color: #ef4444; color: white;">恢复默认</button>
                </div>
                <div id="s1-settings-message" class="s1plus-message"></div>`;

            const navListContainer = tabs.settings.querySelector('.s1-nav-editor-list');
            const renderNavList = (links) => {
                navListContainer.innerHTML = (links || []).map((link, index) => `
                    <div class="s1-editor-item" draggable="true" data-index="${index}" style="grid-template-columns: auto 1fr 1fr auto; user-select: none;">
                        <div class="drag-handle" style="cursor: grab; color: #9ca3af; padding: 0 8px;">::</div>
                        <input type="text" class="nav-name" placeholder="名称" value="${link.name || ''}">
                        <input type="text" class="nav-href" placeholder="链接" value="${link.href || ''}">
                        <div class="s1-editor-item-controls"><button class="s1-editor-btn" data-action="delete" title="删除链接"></button></div>
                    </div>`).join('');
            };

            renderNavList(settings.customNavLinks);

            let draggedItem = null;
            navListContainer.addEventListener('dragstart', e => {
                if (e.target.classList.contains('s1-editor-item')) {
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
                const otherItems = [...container.querySelectorAll('.s1-editor-item:not(.dragging)')];

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

            tabs.settings.addEventListener('click', e => {
                const target = e.target;
                if (target.id === 's1-nav-add-btn') {
                    const newItem = document.createElement('div');
                    newItem.className = 's1-editor-item'; newItem.draggable = true;
                    newItem.style.gridTemplateColumns = 'auto 1fr 1fr auto';
                    newItem.innerHTML = `<div class="drag-handle" style="cursor: grab; color: #9ca3af; padding: 0 8px;">::</div><input type="text" class="nav-name" placeholder="新链接"><input type="text" class="nav-href" placeholder="forum.php"><div class="s1-editor-item-controls"><button class="s1-editor-btn" data-action="delete" title="删除链接"></button></div>`;
                    navListContainer.appendChild(newItem);
                } else if (target.dataset.action === 'delete') {
                    target.closest('.s1-editor-item').remove();
                } else if (target.id === 's1-nav-restore-btn') {
                    saveSettings(defaultSettings);
                    renderSettingsTab();
                    applyInterfaceCustomizations();
                    initializeNavbar();
                    showMessage(modal.querySelector('#s1-settings-message'), '已恢复默认设置！', true);
                } else if (target.id === 's1-settings-save-btn') {
                    const newSettings = {
                        ...getSettings(),
                        changeLogoLink: tabs.settings.querySelector('#s1-changeLogoLink').checked,
                        hideBlacklistTip: tabs.settings.querySelector('#s1-hideBlacklistTip').checked,
                        enableNavCustomization: tabs.settings.querySelector('#s1-enableNavCustomization').checked,
                        customNavLinks: Array.from(navListContainer.querySelectorAll('.s1-editor-item')).map(item => ({ name: item.querySelector('.nav-name').value.trim(), href: item.querySelector('.nav-href').value.trim() })).filter(l=>l.name && l.href)
                    };
                    saveSettings(newSettings);
                    applyInterfaceCustomizations();
                    initializeNavbar();
                    showMessage(modal.querySelector('#s1-settings-message'), '设置已保存！', true);
                }
            });
        };

        // --- 初始化渲染和事件绑定 ---
        renderThreadTab();
        renderUserTab();
        renderTagsTab();
        renderSettingsTab();

        modal.addEventListener('change', e => {
            const target = e.target;
            if(target.matches('.user-thread-block-toggle')) {
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
            else if(target.matches('#s1-blockThreadsOnUserBlock')) {
                const currentSettings = getSettings();
                currentSettings.blockThreadsOnUserBlock = target.checked;
                saveSettings(currentSettings);
            }
        });

        modal.addEventListener('click', (e) => {
            const target = e.target;
            if (e.target.matches('.s1plus-modal, .s1plus-modal-close')) modal.remove();
            if (e.target.matches('.s1plus-tab-btn')) {
                modal.querySelectorAll('.s1plus-tab-btn, .s1plus-tab-content').forEach(el => el.classList.remove('active'));
                e.target.classList.add('active');
                const activeTab = tabs[e.target.dataset.tab];
                if(activeTab) activeTab.classList.add('active');
            }
            const unblockThreadId = e.target.dataset.unblockThreadId; if (unblockThreadId) { unblockThread(unblockThreadId); renderThreadTab(); }
            const unblockUserId = e.target.dataset.unblockUserId; if (unblockUserId) { unblockUser(unblockUserId); renderUserTab(); renderThreadTab(); }

            // --- 全局同步事件 ---
            const syncTextarea = modal.querySelector('#s1-sync-textarea');
            const syncMessageEl = modal.querySelector('#s1-sync-message');
            if(e.target.id === 's1-export-btn') {
                syncTextarea.value = exportData();
                syncTextarea.select();
                try { document.execCommand('copy'); showMessage(syncMessageEl, '数据已导出并复制到剪贴板', true); }
                catch (err) { showMessage(syncMessageEl, '复制失败，请手动复制', false); }
            }
            if(e.target.id === 's1-import-btn') {
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
            if(e.target.id === 's1-reset-btn') {
                createConfirmationModal(
                    '确认要清除所有数据吗？',
                    '此操作不可逆！将删除所有屏蔽列表、阅读进度和自定义设置。强烈建议先导出备份。',
                    () => {
                        saveBlockedThreads({});
                        saveBlockedUsers({});
                        saveUserTags({});
                        saveReadProgress({});
                        saveTitleFilterRules([]);
                        saveSettings(defaultSettings);
                        GM_setValue('s1plus_title_keywords', null);

                        hideBlockedThreads(); hideBlockedUsersPosts(); applyUserThreadBlocklist(); hideThreadsByTitleKeyword(); initializeNavbar(); applyInterfaceCustomizations();
                        renderThreadTab(); renderUserTab(); renderSettingsTab(); renderTagsTab();

                        showMessage(syncMessageEl, '所有本地数据已成功清除。', true);
                    },
                    '确认清除'
                );
            }

            // --- [NEW] 用户标记标签页专属事件 ---
            const targetTab = target.closest('#s1-tab-tags');
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
                        showMessage(targetTab.querySelector('#s1-tags-sync-message'), `已删除对 ${userName} 的标记。`, true);
                    }, '确认删除');
                }
                else if (action === 'save-tag-edit') {
                    const userName = target.dataset.userName;
                    const newTag = targetTab.querySelector(`.s1plus-item[data-user-id="${userId}"] .s1plus-tag-edit-area`).value.trim();
                    const tags = getUserTags();
                    if (newTag) {
                        tags[userId] = { ...tags[userId], tag: newTag, timestamp: Date.now(), name: userName };
                        saveUserTags(tags);
                        renderTagsTab();
                        showMessage(targetTab.querySelector('#s1-tags-sync-message'), `已更新对 ${userName} 的标记。`, true);
                    } else {
                        createConfirmationModal(`标记内容为空`, '您希望删除对该用户的标记吗？', () => {
                             delete tags[userId];
                             saveUserTags(tags);
                             renderTagsTab();
                             showMessage(targetTab.querySelector('#s1-tags-sync-message'), `已删除对 ${userName} 的标记。`, true);
                        }, '确认删除');
                    }
                }
                else if (target.id === 's1-export-tags-btn') {
                    const textarea = targetTab.querySelector('#s1-tags-sync-textarea');
                    const messageEl = targetTab.querySelector('#s1-tags-sync-message');
                    textarea.value = JSON.stringify(getUserTags(), null, 2);
                    textarea.select();
                    try { document.execCommand('copy'); showMessage(messageEl, '用户标记已导出并复制到剪贴板。', true); }
                    catch (err) { showMessage(messageEl, '复制失败，请手动复制。', false); }
                }
                else if (target.id === 's1-import-tags-btn') {
                    const textarea = targetTab.querySelector('#s1-tags-sync-textarea');
                    const messageEl = targetTab.querySelector('#s1-tags-sync-message');
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

    const addBlockButtonsToThreads = () => {
        document.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]').forEach(row => {
            if (row.querySelector('.s1plus-btn.thread-block-btn')) return;
            const iconCell = row.querySelector('td.icn');
            const titleElement = row.querySelector('th a.s.xst');
            if (iconCell && titleElement) {
                iconCell.style.position = 'relative';
                const threadId = row.id.replace(/^(normalthread_|stickthread_)/, '');
                const threadTitle = titleElement.textContent.trim();
                const blockBtn = document.createElement('span');
                blockBtn.className = 's1plus-btn thread-block-btn';
                blockBtn.textContent = '屏蔽';
                blockBtn.title = '屏蔽此贴';
                blockBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); blockThread(threadId, threadTitle); });
                iconCell.appendChild(blockBtn);
            }
        });
    };

    // --- [FIXED] 重构用户屏蔽按钮添加逻辑，解决竞态条件问题 ---
    const addBlockButtonsToUsers = () => {
        document.querySelectorAll('.authi > a[href*="space-uid-"]').forEach(authorLink => {
            const plsCell = authorLink.closest('.pls');
            // 如果没有父元素，或已处理过，则跳过
            if (!plsCell || plsCell.dataset.s1plusBlocked) return;
            plsCell.dataset.s1plusBlocked = 'true'; // 添加标记，防止重复处理

            const avatarImg = plsCell.querySelector('.avatar img');
            if (!avatarImg) return;

            const uidMatch = authorLink.href.match(/space-uid-(\d+)/);
            if (!uidMatch) return;

            const userId = uidMatch[1];
            const userName = authorLink.textContent.trim();

            // 预先创建好元素
            const overlayContainer = document.createElement('div');
            overlayContainer.className = 's1plus-avatar-overlay-container';

            const blockBtn = document.createElement('span');
            blockBtn.className = 's1plus-btn';
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
        let popover = document.getElementById('s1plus-tag-popover-main');
        if (!popover) {
            popover = document.createElement('div');
            popover.id = 's1plus-tag-popover-main';
            popover.className = 's1plus-tag-popover';
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

            const footer = popoverElement.querySelector('.s1plus-popover-footer');
            const actionsContainer = popoverElement.querySelector('.s1plus-popover-actions');
            const popoverContent = popoverElement.querySelector('.s1plus-popover-content');
            const avatar = popoverElement.querySelector('.s1plus-popover-avatar');
            const userContainer = popoverElement.querySelector('.s1plus-popover-user-container');
            const usernameDiv = popoverElement.querySelector('.s1plus-popover-username');
            const uidDiv = popoverElement.querySelector('.s1plus-popover-user-id');

            if (footer && actionsContainer && popoverContent && avatar && userContainer && usernameDiv && uidDiv) {
                const maxTextWidth = Math.max(usernameDiv.offsetWidth, uidDiv.offsetWidth);
                const userContainerGap = parseFloat(window.getComputedStyle(userContainer).gap);
                const requiredUserContainerWidth = avatar.offsetWidth + userContainerGap + maxTextWidth;
                const contentStyle = window.getComputedStyle(popoverContent);
                const paddingX = parseFloat(contentStyle.paddingLeft) + parseFloat(contentStyle.paddingRight);
                const footerGap = parseFloat(window.getComputedStyle(footer).gap);
                const requiredFooterWidth = requiredUserContainerWidth + actionsContainer.offsetWidth + footerGap;
                const requiredPopoverWidth = requiredFooterWidth + paddingX;
                const mainContentWidth = popoverElement.querySelector('.s1plus-popover-main-content').offsetWidth + paddingX;
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
            const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f0f0f0"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="sans-serif" font-size="40" fill="#999">S1</text></svg>`;
            const fallbackAvatar = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgIcon)}`;


            const mainContentHTML = hasTag
                ? `<div class="s1plus-popover-main-content">${tag}</div>`
                : `<div class="s1plus-popover-main-content empty">目前暂无标记</div>`;

            const actionsHTML = hasTag
                ? `
                <button class="s1plus-popover-btn" data-action="edit-tag" data-user-id="${userId}" data-user-name="${userName}">编辑标记</button>
                <button class="s1plus-popover-btn" data-action="delete-tag" data-user-id="${userId}" data-user-name="${userName}">删除标记</button>
                `
                : `
                <button class="s1plus-popover-btn" data-action="add-tag" data-user-id="${userId}" data-user-name="${userName}">添加标记</button>
                `;

            popover.innerHTML = `
                <div class="s1plus-popover-content">
                    ${mainContentHTML}
                    <hr class="s1plus-popover-hr" />
                    <div class="s1plus-popover-footer">
                        <div class="s1plus-popover-user-container">
                            <img class="s1plus-popover-avatar" src="${avatarUrl || fallbackAvatar}" onerror="this.onerror=null;this.src='${fallbackAvatar}'">
                            <div class="s1plus-popover-user-info">
                                <div class="s1plus-popover-username">${userName}</div>
                                <div class="s1plus-popover-user-id">UID: ${userId}</div>
                            </div>
                        </div>
                        <div class="s1plus-popover-actions">${actionsHTML}</div>
                    </div>
                </div>
            `;
        };

        const renderEditMode = (userName, userId, currentTag = '') => {
            popover.innerHTML = `
                 <div class="s1plus-popover-content">
                    <div class="s1plus-edit-mode-header">为 ${userName} ${currentTag ? '编辑' : '添加'}标记</div>
                    <textarea class="s1plus-edit-mode-textarea" id="s1plus-tag-textarea" placeholder="输入标记内容...">${currentTag}</textarea>
                    <div class="s1plus-edit-mode-actions">
                        <button class="s1plus-popover-btn" data-action="cancel-edit" data-user-id="${userId}" data-user-name="${userName}">取消</button>
                        <button class="s1plus-popover-btn" data-action="save-tag" data-user-id="${userId}" data-user-name="${userName}">保存</button>
                    </div>
                </div>
            `;
            const textarea = popover.querySelector('#s1plus-tag-textarea');
            textarea.focus();

            textarea.addEventListener('compositionstart', () => { isComposing = true; });
            textarea.addEventListener('compositionend', () => { isComposing = false; });
        };

        popover.addEventListener('click', (event) => {
            const target = event.target.closest('.s1plus-popover-btn');
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
                const textarea = popover.querySelector('#s1plus-tag-textarea');
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
                            if (!cell.dataset.s1plusPopover) {
                                cell.dataset.s1plusPopover = 'true';
                                attachPopoverEvents(cell);
                            }
                        });
                    }
                });
            });
        });

        const mainContent = document.getElementById('ct') || document.body;
        mainContent.querySelectorAll('.pls').forEach(cell => {
            if (!cell.dataset.s1plusPopover) {
                cell.dataset.s1plusPopover = 'true';
                attachPopoverEvents(cell);
            }
        });
        observer.observe(mainContent, { childList: true, subtree: true });
    };


    const addProgressJumpButtons = () => {
        const progressData = getReadProgress();
        if (Object.keys(progressData).length === 0) return;

        document.querySelectorAll('tbody[id^="normalthread_"]').forEach(row => {
            if (row.querySelector('.s1plus-progress-jump-btn')) return;

            const threadIdMatch = row.id.match(/normalthread_(\d+)/);
            if (!threadIdMatch) return;
            const threadId = threadIdMatch[1];

            if (progressData[threadId] && progressData[threadId].page) {
                const { postId, page } = progressData[threadId];
                const titleLink = row.querySelector('th a.s.xst');
                if (titleLink) {
                    const jumpBtn = document.createElement('a');
                    jumpBtn.className = 's1plus-progress-jump-btn';
                    jumpBtn.textContent = `上次阅读: P${page}`;
                    jumpBtn.href = `forum.php?mod=redirect&goto=findpost&ptid=${threadId}&pid=${postId}`;
                    jumpBtn.title = `跳转到上次阅读的页面 (第 ${page} 页)`;
                    jumpBtn.target = '_blank';
                    jumpBtn.onclick = (e) => e.stopPropagation();

                    titleLink.insertAdjacentElement('afterend', jumpBtn);
                }
            }
        });
    };

    const initReadProgressTracker = () => {
        const threadIdMatch = window.location.href.match(/thread-(\d+)-/);
        if (!threadIdMatch) return;
        const threadId = threadIdMatch[1];

        const pageMatch = window.location.href.match(/thread-\d+-(\d+)-/);
        const currentPage = pageMatch ? pageMatch[1] : '1';

        let currentProgressPostId = null;

        const observer = new IntersectionObserver((entries) => {
            const visiblePosts = entries.filter(entry => entry.isIntersecting);

            if (visiblePosts.length > 0) {
                const firstVisiblePost = visiblePosts.reduce((first, current) => {
                    const firstId = parseInt(first.target.id.replace('pid', ''));
                    const currentId = parseInt(current.target.id.replace('pid', ''));
                    return currentId < firstId ? current : first;
                });
                currentProgressPostId = firstVisiblePost.target.id.replace('pid', '');
            }
        }, { threshold: 0.1 });

        document.querySelectorAll('table[id^="pid"]').forEach(post => observer.observe(post));

        const saveProgress = () => {
            if (document.visibilityState === 'hidden' && currentProgressPostId) {
                updateThreadProgress(threadId, currentProgressPostId, currentPage);
            }
        };

        document.addEventListener('visibilitychange', saveProgress);
    };


    // 自动签到
    const autoCheckIn = () => {
        const userLink = document.querySelector('div#um a[href*="space-uid-"]');
        if (!userLink) return;
        const uidMatch = userLink.href.match(/space-uid-(\d+)\.html/);
        if (!uidMatch) return;
        const userId = uidMatch[1];
        const today = new Date().toLocaleDateString();
        const lastCheckIn = GM_getValue(`s1filter_last_checkin_${userId}`, '');
        if (lastCheckIn === today) return;

        const checkInLink = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('签到'));
        if (checkInLink && checkInLink.href.includes('daily_attendance')) {
            console.log('S1 Plus: 找到签到链接，正在尝试自动签到...');
            fetch(checkInLink.href, { credentials: 'include' })
                .then(response => {
                    if (response.ok) {
                        GM_setValue(`s1filter_last_checkin_${userId}`, today);
                        console.log(`S1 Plus: 用户 ${userId} 自动签到成功！`);
                        checkInLink.style.fontWeight = 'normal';
                        checkInLink.style.color = 'gray';
                        checkInLink.textContent = '已签到';
                    } else { console.error('S1 Plus: 自动签到失败，服务器响应状态：', response.status); }
                }).catch(error => { console.error('S1 Plus: 自动签到请求失败。', error); });
        }
    };

    // --- 初始化 ---
    const init = () => {
        autoCheckIn();
        applyInterfaceCustomizations();
        initializeNavbar();
        initializeTaggingPopover();

        const runTasks = () => {
            if (window.location.href.includes('thread-') || window.location.href.includes('mod=viewthread')) {
                hideBlockedUsersPosts();
                hideBlockedUserQuotes();
                addBlockButtonsToUsers();
                initReadProgressTracker();
                hideBlockedUserRatings();
            } else if (window.location.href.includes('forum-')) {
                hideBlockedThreads();
                applyUserThreadBlocklist();
                hideThreadsByTitleKeyword();
                addBlockButtonsToThreads();
                addProgressJumpButtons();
            }
            applyInterfaceCustomizations();
        };

        runTasks();

        // 稍微修改 MutationObserver 的逻辑，只对特定容器的子节点变化做出反应，减少不必要的调用
        const observerTarget = document.getElementById('ct');
        if (observerTarget) {
            const observer = new MutationObserver(runTasks);
            observer.observe(observerTarget, { childList: true, subtree: true });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();