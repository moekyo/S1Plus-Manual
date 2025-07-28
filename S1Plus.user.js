// ==UserScript==
// @name         S1 Plus - Stage1st 体验增强套件
// @namespace    http://tampermonkey.net/
// @version      3.0.1
// @description  为Stage1st论坛提供帖子/用户屏蔽、导航栏自定义、自动签到、阅读进度跟踪等多种功能，全方位优化你的论坛体验。
// @author       moekyo & Elence_ylns1314 (Merged and enhanced by Gemini)
// @match        https://stage1st.com/2b/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = '3.0.1';
    const SCRIPT_RELEASE_DATE = '2025-07-28';

    // --- 样式注入 ---
    GM_addStyle(`
        /* --- 核心修复：禁用论坛自带的用户信息悬浮窗 --- */
        #p_pop { display: none !important; }

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

        /* --- 设置面板样式 --- */
        .s1plus-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; }
        .s1plus-modal-content { background-color: white; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); width: 600px; max-width: 90%; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; }
        .s1plus-modal-header { padding: 16px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
        .s1plus-modal-title { font-size: 18px; font-weight: bold; color: #111827; }
        .s1plus-modal-close { cursor: pointer; font-size: 20px; color: #6b7280; }
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
        .s1plus-item-toggle { font-size: 12px; color: #374151; display: flex; align-items: center; }
        .s1plus-item-toggle input { margin-right: 6px; transform: scale(1.1); }
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
        .s1plus-message.error { background-color: #fee2e2; color: #b91c1c; }

        /* --- 确认弹窗样式 --- */
        @keyframes s1plus-fade-in { from { opacity: 0; } to { opacity: 1; } } @keyframes s1plus-scale-in { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } } @keyframes s1plus-fade-out { from { opacity: 1; } to { opacity: 0; } } @keyframes s1plus-scale-out { from { transform: scale(1); opacity: 1; } to { transform: scale(0.97); opacity: 0; } }
        .s1plus-confirm-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.65); display: flex; justify-content: center; align-items: center; z-index: 10000; animation: s1plus-fade-in 0.2s ease-out; }
        .s1plus-confirm-content { background-color: white; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); width: 420px; max-width: 90%; text-align: left; overflow: hidden; animation: s1plus-scale-in 0.25s ease-out; }
        .s1plus-confirm-body { padding: 20px 24px; font-size: 16px; color: #1f2937; line-height: 1.6; } .s1plus-confirm-body .confirm-title { font-weight: 600; font-size: 18px; margin-bottom: 8px; } .s1plus-confirm-body .confirm-subtitle { font-size: 14px; color: #6b7280; }
        .s1plus-confirm-footer { padding: 12px 16px; background-color: #f3f3f3ff; display: flex; justify-content: flex-end; gap: 12px; }
        .s1plus-confirm-btn { padding: 9px 18px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; border: 1px solid transparent; transition: all 0.15s ease-in-out; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); } .s1plus-confirm-btn:active { transform: translateY(1px); } .s1plus-confirm-btn.cancel { background-color: white; color: #374151; border-color: #d1d5db; } .s1plus-confirm-btn.cancel:hover { background-color: #f9fafb; border-color: #b0b8c2; } .s1plus-confirm-btn.confirm { background-color: #ef4444; color: white; border-color: #ef4444; } .s1plus-confirm-btn.confirm:hover { background-color: #dc2626; border-color: #dc2626; }

        /* --- 界面定制设置样式 --- */
        .s1-settings-group { margin-bottom: 24px; }
        .s1-settings-group-title { font-size: 16px; font-weight: 500; color: #111827; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px; }
        .s1-settings-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
        .s1-settings-label { color: #374151; font-size: 14px; }
        .s1-settings-checkbox { transform: scale(1.2); }
        .s1plus-setting-desc { font-size: 12px; color: #6b7280; margin: -12px 0 16px 4px; padding: 0; line-height: 1.5; }
        .s1-nav-editor-item { display: grid; grid-template-columns: auto 1fr 1fr auto; gap: 8px; align-items: center; padding: 8px; border-radius: 4px; background: #f9fafb; user-select: none; }
        .s1-nav-editor-item:not(:last-child) { margin-bottom: 8px; }
        .s1-nav-editor-item.dragging { opacity: 0.5; background: #dbeafe; }
        .s1-nav-editor-item .drag-handle { cursor: grab; color: #9ca3af; padding: 0 8px; }
        .s1-nav-editor-item .drag-handle:active { cursor: grabbing; }
        .s1-nav-editor-item input { width: 100%; border: 1px solid #d1d5db; border-radius: 4px; padding: 6px 8px; font-size: 14px; box-sizing: border-box; }
        .s1-nav-editor-controls { display: flex; align-items: center; gap: 4px; }
        .s1-nav-editor-btn { padding: 4px; font-size: 18px; line-height: 1; cursor: pointer; border-radius: 4px; border:none; background: transparent; color: #9ca3af; }
        .s1-nav-editor-btn:hover { background: #e5e7eb; color: #374151; }
        .s1-nav-editor-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
        .s1-settings-action-btn { display: inline-block; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.2s; border: none; }
        .s1-settings-action-btn.primary { background-color: #3b82f6; color: white; } .s1-settings-action-btn.primary:hover { background-color: #2563eb; }
        .s1-settings-action-btn.secondary { background-color: #e5e7eb; color: #374151; } .s1-settings-action-btn.secondary:hover { background-color: #d1d5db; }
    `);

    // --- 数据处理 & 核心功能 ---
    const getBlockedThreads = () => GM_getValue('s1plus_blocked_threads', {});
    const saveBlockedThreads = (threads) => GM_setValue('s1plus_blocked_threads', threads);
    const getBlockedUsers = () => GM_getValue('s1plus_blocked_users', {});
    const saveBlockedUsers = (users) => GM_setValue('s1plus_blocked_users', users);
    const blockThread = (id, title, reason = 'manual') => { const b = getBlockedThreads(); if (b[id]) return; b[id] = { title, timestamp: Date.now(), reason }; saveBlockedThreads(b); hideThread(id); };
    const unblockThread = (id) => { const b = getBlockedThreads(); delete b[id]; saveBlockedThreads(b); showThread(id); };
    const hideThread = (id) => { (document.getElementById(`normalthread_${id}`) || document.getElementById(`stickthread_${id}`))?.setAttribute('style', 'display: none !important'); };
    const showThread = (id) => { (document.getElementById(`normalthread_${id}`) || document.getElementById(`stickthread_${id}`))?.removeAttribute('style'); }
    const hideBlockedThreads = () => Object.keys(getBlockedThreads()).forEach(hideThread);
    const blockUser = (id, name) => { const settings = getSettings(); const b = getBlockedUsers(); b[id] = { name, timestamp: Date.now(), blockThreads: settings.blockThreadsOnUserBlock }; saveBlockedUsers(b); hideUserPosts(id); if (b[id].blockThreads) applyUserThreadBlocklist(); };
    const unblockUser = (id) => { const b = getBlockedUsers(); delete b[id]; saveBlockedUsers(b); showUserPosts(id); unblockThreadsByUser(id); };
    const hideUserPosts = (id) => { document.querySelectorAll(`a[href*="space-uid-${id}.html"]`).forEach(l => l.closest('table.plhin')?.setAttribute('style', 'display: none !important')); };
    const showUserPosts = (id) => { document.querySelectorAll(`a[href*="space-uid-${id}.html"]`).forEach(l => l.closest('table.plhin')?.removeAttribute('style')); };
    const hideBlockedUsersPosts = () => Object.keys(getBlockedUsers()).forEach(hideUserPosts);

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
        version: 3.1,
        settings: getSettings(),
        threads: getBlockedThreads(),
        users: getBlockedUsers(),
        read_progress: getReadProgress()
    }, null, 2);

    const importData = (jsonStr) => {
        try {
            const imported = JSON.parse(jsonStr); if (typeof imported !== 'object' || imported === null) throw new Error("无效数据格式");
            let threadsImported = 0, usersImported = 0, progressImported = 0;

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

            if (imported.read_progress) {
                const mergedProgress = { ...getReadProgress(), ...imported.read_progress };
                saveReadProgress(mergedProgress);
                progressImported = Object.keys(imported.read_progress).length;
            }

            hideBlockedThreads();
            hideBlockedUsersPosts();
            applyUserThreadBlocklist();
            initializeNavbar();
            applyInterfaceCustomizations();

            return { success: true, message: `成功导入 ${threadsImported} 条帖子、${usersImported} 条用户、${progressImported} 条阅读进度及相关设置。` };
        } catch (e) { return { success: false, message: `导入失败: ${e.message}` }; }
    };

    // --- 设置管理 ---
    const defaultSettings = {
        enableNavCustomization: true,
        changeLogoLink: true,
        hideBlacklistTip: true,
        blockThreadsOnUserBlock: true,
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
            <div class="s1plus-modal-header"><div class="s1plus-modal-title">S1 Plus 设置</div><div class="s1plus-modal-close">×</div></div>
            <div class="s1plus-modal-body">
                <div class="s1plus-tabs">
                    <button class="s1plus-tab-btn active" data-tab="threads">帖子屏蔽</button>
                    <button class="s1plus-tab-btn" data-tab="users">用户屏蔽</button>
                    <button class="s1plus-tab-btn" data-tab="settings">界面定制</button>
                    <button class="s1plus-tab-btn" data-tab="sync">设置同步</button>
                </div>
                <div id="s1-tab-threads" class="s1plus-tab-content active"></div>
                <div id="s1-tab-users" class="s1plus-tab-content"></div>
                <div id="s1-tab-settings" class="s1plus-tab-content"></div>
                <div id="s1-tab-sync" class="s1plus-tab-content">
                    <div class="s1plus-sync-title">自动云同步 (推荐)</div>
                    <div class="s1plus-sync-desc">
                        本脚本兼容 Tampermonkey 的内置同步功能，可实现全自动、跨设备无缝同步。无需手动导入/导出。
                        <p style="font-weight: bold; margin-top: 8px; margin-bottom: 4px;">如何开启：</p>
                        <ol style="margin: 0; padding-left: 20px; line-height: 1.6;">
                            <li>点击浏览器右上角的 Tampermonkey 扩展图标，选择 “管理面板”。</li>
                            <li>在管理面板顶部的标签页中，找到并点击 “设置”。</li>
                            <li>在设置页面中，将 “配置模式” 从 “新手” 切换为 “高级”。</li>
                            <li>找到 “同步功能” (TESLA)，选择您偏好的云服务 (如 Google Drive, Dropbox, OneDrive) 并授权。</li>
                        </ol>
                        <p style="margin-top: 8px; font-size: 12px; color: #6b7280;">
                            说明：同步频率和冲突解决由 Tampermonkey 自动管理，通常以最新版本为准。开启后，所有设置（黑名单、UI定制等）都将自动同步。
                        </p>
                    </div>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                    <div class="s1plus-sync-title">手动设置同步</div>
                    <div class="s1plus-sync-desc">若不便使用云同步，你仍可通过手动复制/粘贴数据，在不同浏览器或设备间同步你的所有S1 Plus配置。</div>
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
            settings: modal.querySelector('#s1-tab-settings'),
            sync: modal.querySelector('#s1-tab-sync'),
        };

        const renderUserTab = () => {
            const settings = getSettings();
            const blockedUsers = getBlockedUsers();
            const userItemIds = Object.keys(blockedUsers).sort((a, b) => blockedUsers[b].timestamp - blockedUsers[a].timestamp);
            tabs.users.innerHTML = `
                <div class="s1-settings-group" style="margin-bottom: 16px; padding-bottom: 0;">
                    <div class="s1-settings-item">
                        <label class="s1-settings-label" for="s1-blockThreadsOnUserBlock">屏蔽用户时，默认屏蔽其所有主题帖</label>
                        <input type="checkbox" id="s1-blockThreadsOnUserBlock" class="s1-settings-checkbox" ${settings.blockThreadsOnUserBlock ? 'checked' : ''}>
                    </div>
                </div>
                <p class="s1plus-setting-desc">
                    <strong>提示</strong>：顶部总开关仅影响<strong>未来新屏蔽用户</strong>的默认设置。每个用户下方的独立开关，才是控制该用户主题帖的<strong>最终开关</strong>，拥有最高优先级。
                </p>
                ${userItemIds.length === 0
                    ? `<div class="s1plus-empty">暂无屏蔽的用户</div>`
                    : `<div class="s1plus-list">${userItemIds.map(id => {
                        const item = blockedUsers[id];
                        return `<div class="s1plus-item" data-user-id="${id}"><div class="s1plus-item-info"><div class="s1plus-item-title">${item.name || `用户 #${id}`}</div><div class="s1plus-item-meta">屏蔽时间: ${formatDate(item.timestamp)}</div><div class="s1plus-item-toggle"><label><input type="checkbox" class="user-thread-block-toggle" data-user-id="${id}" ${item.blockThreads ? 'checked' : ''}> 屏蔽该用户的主题帖</label></div></div><button class="s1plus-unblock-btn" data-unblock-user-id="${id}">取消屏蔽</button></div>`;
                    }).join('')}</div>`
                }
            `;
        };

        const renderThreadTab = () => {
            const blockedThreads = getBlockedThreads();
            const itemIds = Object.keys(blockedThreads).sort((a, b) => blockedThreads[b].timestamp - blockedThreads[a].timestamp);
            if (itemIds.length === 0) { tabs.threads.innerHTML = `<div class="s1plus-empty">暂无屏蔽的帖子</div>`; }
            else {
                tabs.threads.innerHTML = `<div class="s1plus-list">${itemIds.map(id => {
                    const item = blockedThreads[id];
                    return `<div class="s1plus-item" data-thread-id="${id}"><div class="s1plus-item-info"><div class="s1plus-item-title">${item.title || `帖子 #${id}`}</div><div class="s1plus-item-meta">屏蔽时间: ${formatDate(item.timestamp)} ${item.reason && item.reason !== 'manual' ? `(因屏蔽用户${item.reason.replace('user_','')})` : ''}</div></div><button class="s1plus-unblock-btn" data-unblock-thread-id="${id}">取消屏蔽</button></div>`;
                }).join('')}</div>`;
            }
        };

        const renderSettingsTab = () => {
            const settings = getSettings();
            tabs.settings.innerHTML = `
                <div class="s1-settings-group">
                    <div class="s1-settings-group-title">通用设置</div>
                    <div class="s1-settings-item"><label class="s1-settings-label" for="s1-changeLogoLink">修改论坛Logo链接 (指向论坛首页)</label><input type="checkbox" id="s1-changeLogoLink" class="s1-settings-checkbox" ${settings.changeLogoLink ? 'checked' : ''}></div>
                    <div class="s1-settings-item"><label class="s1-settings-label" for="s1-hideBlacklistTip">隐藏已屏蔽用户发言的黄条提示</label><input type="checkbox" id="s1-hideBlacklistTip" class="s1-settings-checkbox" ${settings.hideBlacklistTip ? 'checked' : ''}></div>
                </div>
                <div class="s1-settings-group">
                    <div class="s1-settings-group-title">导航栏定制</div>
                    <div class="s1-settings-item"><label class="s1-settings-label" for="s1-enableNavCustomization">启用自定义导航栏</label><input type="checkbox" id="s1-enableNavCustomization" class="s1-settings-checkbox" ${settings.enableNavCustomization ? 'checked' : ''}></div>
                    <div class="s1-nav-editor-list" style="margin-top: 12px;"></div>
                    <div class="s1-nav-editor-footer">
                        <button class="s1plus-sync-btn" id="s1-nav-add-btn">添加新链接</button>
                        <button class="s1plus-sync-btn" id="s1-nav-restore-btn" style="background-color: #fca5a5; color: #991b1b;">恢复默认</button>
                    </div>
                </div>
                <div style="text-align: right; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
                     <button id="s1-settings-save-btn" class="s1-settings-action-btn primary">保存界面与导航设置</button>
                </div>
                <div id="s1-settings-message" class="s1plus-message"></div>`;

            const navListContainer = tabs.settings.querySelector('.s1-nav-editor-list');
            const renderNavList = (links) => {
                navListContainer.innerHTML = (links || []).map((link, index) => `
                    <div class="s1-nav-editor-item" draggable="true" data-index="${index}">
                        <div class="drag-handle">::</div>
                        <input type="text" class="nav-name" placeholder="名称" value="${link.name || ''}">
                        <input type="text" class="nav-href" placeholder="链接" value="${link.href || ''}">
                        <div class="s1-nav-editor-controls"><button class="s1-nav-editor-btn" data-action="delete" style="color: #ef4444;">✖</button></div>
                    </div>`).join('');
            };

            renderNavList(settings.customNavLinks);

            let draggedItem = null;
            navListContainer.addEventListener('dragstart', e => { draggedItem = e.target.closest('.s1-nav-editor-item'); e.target.classList.add('dragging'); });
            navListContainer.addEventListener('dragend', e => { e.target.classList.remove('dragging'); });
            navListContainer.addEventListener('dragover', e => { e.preventDefault(); const afterElement = [...navListContainer.querySelectorAll('.s1-nav-editor-item:not(.dragging)')].reduce((closest, child) => { const box = child.getBoundingClientRect(); const offset = e.clientY - box.top - box.height / 2; return (offset < 0 && offset > closest.offset) ? { offset: offset, element: child } : closest; }, { offset: Number.NEGATIVE_INFINITY }).element; if (afterElement == null) { navListContainer.appendChild(draggedItem); } else { navListContainer.insertBefore(draggedItem, afterElement); } });

            tabs.settings.addEventListener('click', e => {
                const target = e.target;
                if (target.id === 's1-nav-add-btn') {
                    const newItem = document.createElement('div');
                    newItem.className = 's1-nav-editor-item'; newItem.draggable = true;
                    newItem.innerHTML = `<div class="drag-handle">::</div><input type="text" class="nav-name" placeholder="新链接"><input type="text" class="nav-href" placeholder="forum.php"><div class="s1-nav-editor-controls"><button class="s1-nav-editor-btn" data-action="delete" style="color: #ef4444;">✖</button></div>`;
                    navListContainer.appendChild(newItem);
                } else if (target.dataset.action === 'delete') {
                    target.closest('.s1-nav-editor-item').remove();
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
                        customNavLinks: Array.from(navListContainer.querySelectorAll('.s1-nav-editor-item')).map(item => ({ name: item.querySelector('.nav-name').value.trim(), href: item.querySelector('.nav-href').value.trim() })).filter(l=>l.name && l.href)
                    };
                    saveSettings(newSettings);
                    applyInterfaceCustomizations();
                    initializeNavbar();
                    showMessage(modal.querySelector('#s1-settings-message'), '设置已保存并立即生效！', true);
                }
            });
        };

        // --- 初始化渲染和事件绑定 ---
        renderThreadTab();
        renderUserTab();
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
            if (e.target.matches('.s1plus-modal, .s1plus-modal-close')) modal.remove();
            if (e.target.matches('.s1plus-tab-btn')) {
                modal.querySelectorAll('.s1plus-tab-btn, .s1plus-tab-content').forEach(el => el.classList.remove('active'));
                e.target.classList.add('active');
                const activeTab = tabs[e.target.dataset.tab];
                if(activeTab) activeTab.classList.add('active');
            }
            const unblockThreadId = e.target.dataset.unblockThreadId; if (unblockThreadId) { unblockThread(unblockThreadId); renderThreadTab(); }
            const unblockUserId = e.target.dataset.unblockUserId; if (unblockUserId) { unblockUser(unblockUserId); renderUserTab(); renderThreadTab(); }

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
                }
            }
            if(e.target.id === 's1-reset-btn') {
                createConfirmationModal(
                    '确认要清除所有数据吗？',
                    '此操作不可逆！将删除所有屏蔽列表、阅读进度和自定义设置。强烈建议先导出备份。',
                    () => {
                        saveBlockedThreads({});
                        saveBlockedUsers({});
                        saveReadProgress({});
                        saveSettings(defaultSettings);

                        hideBlockedThreads();
                        hideBlockedUsersPosts();
                        applyUserThreadBlocklist();
                        initializeNavbar();
                        applyInterfaceCustomizations();

                        renderThreadTab();
                        renderUserTab();
                        renderSettingsTab();

                        showMessage(syncMessageEl, '所有本地数据已成功清除。', true);
                    },
                    '确认清除'
                );
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

    const addBlockButtonsToUsers = () => {
        document.querySelectorAll('.authi > a[href*="space-uid-"]').forEach(authorLink => {
            const plsCell = authorLink.closest('.pls');
            if (!plsCell || plsCell.querySelector('.s1plus-avatar-overlay-container')) return;
            const avatarImg = plsCell.querySelector('.avatar img');
            if (!avatarImg) return;
            plsCell.style.position = 'relative';
            const uidMatch = authorLink.href.match(/space-uid-(\d+)/);
            if (uidMatch) {
                const userId = uidMatch[1];
                const userName = authorLink.textContent.trim();
                const overlayContainer = document.createElement('div');
                overlayContainer.className = 's1plus-avatar-overlay-container';
                const rect = avatarImg.getBoundingClientRect();
                const parentRect = plsCell.getBoundingClientRect();
                overlayContainer.style.top = `${rect.top - parentRect.top}px`;
                overlayContainer.style.left = `${rect.left - parentRect.left}px`;
                overlayContainer.style.width = `${rect.width}px`;
                overlayContainer.style.height = `${rect.height}px`;
                overlayContainer.style.borderRadius = window.getComputedStyle(avatarImg).borderRadius;
                const blockBtn = document.createElement('span');
                blockBtn.className = 's1plus-btn';
                blockBtn.textContent = '屏蔽用户';
                blockBtn.addEventListener('click', e => {
                    e.preventDefault(); e.stopPropagation();
                    const subtitle = getSettings().blockThreadsOnUserBlock
                        ? '该用户的所有帖子和主题帖都将被隐藏，此操作可在设置面板中撤销。'
                        : '该用户的所有帖子都将被隐藏，此操作可在设置面板中撤销。';
                    createConfirmationModal(`确定要屏蔽用户 "${userName}" 吗？`, subtitle, () => blockUser(userId, userName), '确定屏蔽');
                });
                overlayContainer.appendChild(blockBtn);
                plsCell.appendChild(overlayContainer);
            }
        });
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

    // [MODIFIED] 更新了跟踪进度的逻辑，现在记录页面上第一个可见的帖子
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
                // 从所有可见的帖子中，找到ID（即楼层）最小的那个
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

        const runTasks = () => {
            if (window.location.href.includes('thread-') || window.location.href.includes('mod=viewthread')) {
                hideBlockedUsersPosts();
                addBlockButtonsToUsers();
                initReadProgressTracker();
            } else if (window.location.href.includes('forum-')) {
                hideBlockedThreads();
                applyUserThreadBlocklist();
                addBlockButtonsToThreads();
                addProgressJumpButtons();
            }
            applyInterfaceCustomizations();
        };

        runTasks();

        const observer = new MutationObserver(runTasks);
        const mainContent = document.getElementById('ct') || document.body;
        observer.observe(mainContent, { childList: true, subtree: true });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();