// ==UserScript==
// @name         S1 Plus - Stage1st 体验增强套件
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  为Stage1st论坛提供帖子/用户屏蔽、导航栏自定义、自动签到等多种功能，全方位优化你的论坛体验。
// @author       moekyo & Elence_ylns1314 (Merged and enhanced by Gemini)
// @match        https://stage1st.com/2b/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_VERSION = '2.5';
    const SCRIPT_RELEASE_DATE = '2025-07-26';

    // --- 样式注入 ---
    GM_addStyle(`
        /* --- 核心修复：禁用论坛自带的用户信息悬浮窗 --- */
        #p_pop { display: none !important; }

        /* --- 按钮通用样式 --- */
        .s1plus-btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; background-color: #f3f4f6; color: #374151; font-size: 12px; font-weight: bold; cursor: pointer; user-select: none; white-space: nowrap; border: none; }
        .s1plus-btn:hover { background-color: #ef4444; color: white; }

        /* --- 帖子屏蔽按钮动画与布局 (基于v2.4的标签样式) --- */
        .thread-block-btn {
            /* 悬浮定位样式，居中于父容器(td.icn) */
            position: absolute;
            top: 50%;
            left: 50%;
            z-index: 5;

            /* 新的标签外观 */
            padding: 5px 10px 5px 12px;
            border-radius: 0 30px 30px 0; /* 左侧直角，右侧半圆 */
            background-color: #f87171; /* 调整为更柔和的浅红色 */
            color: white;
            font-size: 12px;
            border: none;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);

            /* 动画初始状态：隐藏、缩小 */
            opacity: 0;
            visibility: hidden;
            transform: translate(-50%, -50%) scale(0.85);
            transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        /* 鼠标悬浮于整行时，显示按钮 */
        tbody[id^="normalthread_"]:hover .thread-block-btn,
        tbody[id^="stickthread_"]:hover .thread-block-btn {
            opacity: 1;
            visibility: visible;
            transform: translate(-50%, -50%) scale(1);
            transition-delay: 0.1s;
        }
        /* 鼠标悬浮于按钮本身时，进一步放大突出显示 */
        .thread-block-btn:hover {
            background-color: #ef4444; /* 悬浮颜色也相应变浅 */
            transform: translate(-50%, -50%) scale(1.1);
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
        .s1plus-tab-content { display: none; }
        .s1plus-tab-content.active { display: block; }
        .s1plus-empty { text-align: center; padding: 24px; color: #6b7280; }
        .s1plus-list { display: flex; flex-direction: column; gap: 8px; }
        .s1plus-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-radius: 6px; background-color: #f9fafb; border: 1px solid #e5e7eb; }
        .s1plus-item-info { flex-grow: 1; min-width: 0; }
        .s1plus-item-title { font-weight: 500; color: #111827; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s1plus-item-meta { font-size: 12px; color: #6b7280; }
        .s1plus-unblock-btn { padding: 6px 12px; border-radius: 4px; background-color: #f3f4f6; color: #6b7280; font-size: 14px; cursor: pointer; transition: all 0.2s; border: none; flex-shrink: 0; }
        .s1plus-unblock-btn:hover { background-color: #10b981; color: white; }
        #s1-sync-container { margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
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
    const blockThread = (id, title) => { const b = getBlockedThreads(); b[id] = { title, timestamp: Date.now() }; saveBlockedThreads(b); hideThread(id); };
    const unblockThread = (id) => { const b = getBlockedThreads(); delete b[id]; saveBlockedThreads(b); showThread(id); };
    const hideThread = (id) => { (document.getElementById(`normalthread_${id}`) || document.getElementById(`stickthread_${id}`))?.setAttribute('style', 'display: none !important'); };
    const showThread = (id) => { (document.getElementById(`normalthread_${id}`) || document.getElementById(`stickthread_${id}`))?.removeAttribute('style'); }
    const hideBlockedThreads = () => Object.keys(getBlockedThreads()).forEach(hideThread);
    const blockUser = (id, name) => { const b = getBlockedUsers(); b[id] = { name, timestamp: Date.now() }; saveBlockedUsers(b); hideUserPosts(id); };
    const unblockUser = (id) => { const b = getBlockedUsers(); delete b[id]; saveBlockedUsers(b); showUserPosts(id); };
    const hideUserPosts = (id) => { document.querySelectorAll(`a[href*="space-uid-${id}.html"]`).forEach(l => l.closest('table.plhin')?.setAttribute('style', 'display: none !important')); };
    const showUserPosts = (id) => { document.querySelectorAll(`a[href*="space-uid-${id}.html"]`).forEach(l => l.closest('table.plhin')?.removeAttribute('style')); };
    const hideBlockedUsersPosts = () => Object.keys(getBlockedUsers()).forEach(hideUserPosts);
    const exportData = () => JSON.stringify({ version: 2.0, threads: getBlockedThreads(), users: getBlockedUsers() }, null, 2);
    const importData = (jsonStr) => {
        try {
            const imported = JSON.parse(jsonStr); if (typeof imported !== 'object' || imported === null) throw new Error("无效数据格式");
            let threadsImported = 0, usersImported = 0;
            if (imported.version === 2.0) {
                if (imported.threads) { const merged = { ...getBlockedThreads(), ...imported.threads }; threadsImported = Object.keys(imported.threads).length; saveBlockedThreads(merged); }
                if (imported.users) { const merged = { ...getBlockedUsers(), ...imported.users }; usersImported = Object.keys(imported.users).length; saveBlockedUsers(merged); }
            } else { const merged = { ...getBlockedThreads(), ...imported }; threadsImported = Object.keys(imported).length; saveBlockedThreads(merged); }
            hideBlockedThreads(); hideBlockedUsersPosts();
            return { success: true, message: `成功导入 ${threadsImported} 条帖子和 ${usersImported} 条用户记录。` };
        } catch (e) { return { success: false, message: `导入失败: ${e.message}` }; }
    };

    // --- 设置管理 ---
    const defaultSettings = {
        enableNavCustomization: true,
        changeLogoLink: true,
        hideBlacklistTip: true,
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
    const getSettings = () => GM_getValue('s1plus_settings', defaultSettings);
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
            settings.customNavLinks.forEach(link => {
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

    const createConfirmationModal = (title, subtitle, onConfirm) => {
        document.querySelector('.s1plus-confirm-modal')?.remove();
        const modal = document.createElement('div');
        modal.className = 's1plus-confirm-modal';
        modal.innerHTML = `<div class="s1plus-confirm-content"><div class="s1plus-confirm-body"><div class="confirm-title">${title}</div><div class="confirm-subtitle">${subtitle}</div></div><div class="s1plus-confirm-footer"><button class="s1plus-confirm-btn cancel">取消</button><button class="s1plus-confirm-btn confirm">确定屏蔽</button></div></div>`;
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
                </div>
                <div id="s1-tab-threads" class="s1plus-tab-content active"></div>
                <div id="s1-tab-users" class="s1plus-tab-content"></div>
                <div id="s1-tab-settings" class="s1plus-tab-content"></div>
                <div id="s1-sync-container"><div class="s1plus-sync-section"><div class="s1plus-sync-title">屏蔽列表同步</div><div class="s1plus-sync-desc">通过复制/粘贴数据，在其他设备上同步屏蔽列表。</div><div class="s1plus-sync-buttons"><button id="s1-export-btn" class="s1plus-sync-btn">导出数据</button><button id="s1-import-btn" class="s1plus-sync-btn">导入数据</button></div><textarea id="s1-sync-textarea" class="s1plus-sync-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据"></textarea><div id="s1-sync-message" class="s1plus-message"></div></div></div>
            </div>
            <div class="s1plus-modal-footer">版本: ${SCRIPT_VERSION} (${SCRIPT_RELEASE_DATE})</div>
        </div>`;
        document.body.appendChild(modal);

        const tabs = {
            threads: modal.querySelector('#s1-tab-threads'),
            users: modal.querySelector('#s1-tab-users'),
            settings: modal.querySelector('#s1-tab-settings')
        };
        const syncContainer = modal.querySelector('#s1-sync-container');

        const renderBlockedList = (container, blockedItems, type) => {
            const itemIds = Object.keys(blockedItems).sort((a, b) => blockedItems[b].timestamp - blockedItems[a].timestamp);
            if (itemIds.length === 0) { container.innerHTML = `<div class="s1plus-empty">暂无屏蔽的${type === 'thread' ? '帖子' : '用户'}</div>`; return; }
            container.innerHTML = `<div class="s1plus-list">${itemIds.map(id => { const item = blockedItems[id]; const title = type === 'thread' ? (item.title || `帖子 #${id}`) : (item.name || `用户 #${id}`); return `<div class="s1plus-item" data-${type}-id="${id}"><div class="s1plus-item-info"><div class="s1plus-item-title">${title}</div><div class="s1plus-item-meta">屏蔽时间: ${formatDate(item.timestamp)}</div></div><button class="s1plus-unblock-btn" data-unblock-${type}-id="${id}">取消屏蔽</button></div>`; }).join('')}</div>`;
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
                     <button id="s1-settings-save-btn" class="s1-settings-action-btn primary">保存设置</button>
                </div>
                <div id="s1-settings-message" class="s1plus-message"></div>`;

            const navListContainer = tabs.settings.querySelector('.s1-nav-editor-list');
            const renderNavList = (links) => {
                navListContainer.innerHTML = links.map((link, index) => `
                    <div class="s1-nav-editor-item" draggable="true" data-index="${index}">
                        <div class="drag-handle">::</div>
                        <input type="text" class="nav-name" placeholder="名称" value="${link.name || ''}">
                        <input type="text" class="nav-href" placeholder="链接" value="${link.href || ''}">
                        <div class="s1-nav-editor-controls"><button class="s1-nav-editor-btn" data-action="delete" style="color: #ef4444;">✖</button></div>
                    </div>`).join('');
            };

            renderNavList(settings.customNavLinks);

            let draggedItem = null;
            navListContainer.addEventListener('dragstart', e => { draggedItem = e.target; e.target.classList.add('dragging'); });
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
                        changeLogoLink: tabs.settings.querySelector('#s1-changeLogoLink').checked,
                        hideBlacklistTip: tabs.settings.querySelector('#s1-hideBlacklistTip').checked,
                        enableNavCustomization: tabs.settings.querySelector('#s1-enableNavCustomization').checked,
                        customNavLinks: Array.from(navListContainer.querySelectorAll('.s1-nav-editor-item')).map(item => ({ name: item.querySelector('.nav-name').value.trim(), href: item.querySelector('.nav-href').value.trim() }))
                    };
                    saveSettings(newSettings);
                    applyInterfaceCustomizations();
                    initializeNavbar();
                    showMessage(modal.querySelector('#s1-settings-message'), '设置已保存并立即生效！', true);
                }
            });
        };

        renderBlockedList(tabs.threads, getBlockedThreads(), 'thread');
        renderBlockedList(tabs.users, getBlockedUsers(), 'user');
        renderSettingsTab();
        tabs.threads.appendChild(syncContainer);

        modal.addEventListener('click', (e) => {
            if (e.target.matches('.s1plus-modal, .s1plus-modal-close')) modal.remove();
            if (e.target.matches('.s1plus-tab-btn')) {
                modal.querySelectorAll('.s1plus-tab-btn, .s1plus-tab-content').forEach(el => el.classList.remove('active'));
                e.target.classList.add('active');
                const activeTab = tabs[e.target.dataset.tab];
                activeTab.classList.add('active');
                if (e.target.dataset.tab !== 'settings') {
                    activeTab.appendChild(syncContainer);
                }
            }
            const unblockThreadId = e.target.dataset.unblockThreadId; if (unblockThreadId) { unblockThread(unblockThreadId); renderBlockedList(tabs.threads, getBlockedThreads(), 'thread'); tabs.threads.appendChild(syncContainer); }
            const unblockUserId = e.target.dataset.unblockUserId; if (unblockUserId) { unblockUser(unblockUserId); renderBlockedList(tabs.users, getBlockedUsers(), 'user'); tabs.users.appendChild(syncContainer); }
        });

        const syncTextarea = modal.querySelector('#s1-sync-textarea'); const syncMessageEl = modal.querySelector('#s1-sync-message');
        modal.querySelector('#s1-export-btn').addEventListener('click', () => { syncTextarea.value = exportData(); syncTextarea.select(); try { document.execCommand('copy'); showMessage(syncMessageEl, '数据已导出并复制到剪贴板', true); } catch (err) { showMessage(syncMessageEl, '复制失败，请手动复制', false); } });
        modal.querySelector('#s1-import-btn').addEventListener('click', () => { const jsonStr = syncTextarea.value.trim(); if (!jsonStr) return showMessage(syncMessageEl, '请先粘贴要导入的数据', false); const result = importData(jsonStr); showMessage(syncMessageEl, result.message, result.success); if (result.success) { renderBlockedList(tabs.threads, getBlockedThreads(), 'thread'); renderBlockedList(tabs.users, getBlockedUsers(), 'user'); } });
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

                blockBtn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    blockThread(threadId, threadTitle);
                });
                
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
                    createConfirmationModal(`确定要屏蔽用户 "${userName}" 吗？`, '该用户的所有帖子都将被隐藏，此操作可在设置面板中撤销。', () => blockUser(userId, userName));
                });
                overlayContainer.appendChild(blockBtn);
                plsCell.appendChild(overlayContainer);
            }
        });
    };

    // --- 初始化 ---
    const init = () => {
        applyInterfaceCustomizations();
        initializeNavbar();

        const runTasks = () => {
            if (window.location.href.includes('thread-')) {
                hideBlockedUsersPosts();
                addBlockButtonsToUsers();
            } else if (window.location.href.includes('forum-')) {
                hideBlockedThreads();
                addBlockButtonsToThreads();
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