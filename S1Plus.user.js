// ==UserScript==
// @name         S1 Plus - Stage1st 体验增强套件
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  为Stage1st论坛提供帖子/用户屏蔽、自动签到等多种功能，全方位优化你的论坛体验。
// @author       moekyo (modified by Gemini)
// @match        https://stage1st.com/2b/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_VERSION = '2.3';
    const SCRIPT_RELEASE_DATE = '2025-07-26';

    // --- 样式注入 ---
    GM_addStyle(`
        /* --- 核心修复：禁用论坛自带的用户信息悬浮窗 --- */
        #p_pop { display: none !important; }

        /* --- 按钮通用样式 --- */
        .s1filter-block-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            background-color: #f3f4f6;
            color: #374151;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
            border: none;
        }
        .s1filter-block-btn:hover {
            background-color: #ef4444;
            color: white;
        }

        /* --- (新) 帖子屏蔽按钮动画与布局 (兼容 S1 NUX) --- */
        .thread-block-btn {
            opacity: 0;
            visibility: hidden;
            max-width: 0;
            margin: 0; /* 重置外边距 */
            padding: 0; /* 重置内边距 */
            overflow: hidden;
            vertical-align: middle; /* 确保垂直对齐 */
            transition: opacity 0.2s ease, max-width 0.3s ease, margin 0.3s ease, padding 0.3s ease;
        }
        tbody[id^="normalthread_"]:hover .thread-block-btn,
        tbody[id^="stickthread_"]:hover .thread-block-btn {
            opacity: 1;
            visibility: visible;
            max-width: 50px;
            margin: 0 8px 0 4px; /* 核心修复：使用 margin 提供一致的左右间距 */
            padding: 2px 8px;
            transition-delay: 0.4s;
        }

        /* --- 用户屏蔽悬停交互样式 --- */
        .s1filter-avatar-overlay-container {
            position: absolute;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: rgba(0, 0, 0, 0.55);
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
            pointer-events: auto;
            z-index: 10;
        }

        /* 用户屏蔽按钮在遮罩内的特定样式 */
        .s1filter-avatar-overlay-container .s1filter-block-btn {
            color: white;
            background-color: rgba(0, 0, 0, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.5);
            transform: scale(1);
            transition: all 0.2s ease-in-out;
            padding: 4px 8px; /* 确保用户屏蔽按钮有正确的padding */
        }
        
        .s1filter-avatar-overlay-container .s1filter-block-btn:hover {
            background-color: #ef4444;
            border-color: #ef4444;
            transform: scale(1.05);
        }
        
        .pls:hover .s1filter-avatar-overlay-container {
            opacity: 1;
            visibility: visible;
        }

        /* --- 屏蔽管理界面样式 --- */
        .s1filter-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; align-items: center; z-index: 9999; }
        .s1filter-modal-content { background-color: white; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); width: 600px; max-width: 90%; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; }
        .s1filter-modal-header { padding: 16px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; }
        .s1filter-modal-title { font-size: 18px; font-weight: bold; color: #111827; }
        .s1filter-modal-close { cursor: pointer; font-size: 20px; color: #6b7280; }
        .s1filter-modal-body { padding: 0 16px 16px; overflow-y: auto; flex-grow: 1; }
        .s1filter-modal-footer { padding: 12px 16px; border-top: 1px solid #e5e7eb; text-align: right; font-size: 12px; color: #9ca3af; }
        .s1filter-empty { text-align: center; padding: 24px; color: #6b7280; }
        .s1filter-list { display: flex; flex-direction: column; gap: 8px; }
        .s1filter-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-radius: 6px; background-color: #f9fafb; border: 1px solid #e5e7eb; }
        .s1filter-item-info { flex-grow: 1; min-width: 0; }
        .s1filter-item-title { font-weight: 500; color: #111827; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s1filter-item-meta { font-size: 12px; color: #6b7280; }
        .s1filter-unblock-btn { padding: 6px 12px; border-radius: 4px; background-color: #f3f4f6; color: #6b7280; font-size: 14px; cursor: pointer; transition: all 0.2s; border: none; flex-shrink: 0; }
        .s1filter-unblock-btn:hover { background-color: #10b981; color: white; }
        .s1filter-tabs { display: flex; border-bottom: 1px solid #e5e7eb; margin-bottom: 16px; }
        .s1filter-tab-btn { padding: 12px 16px; cursor: pointer; border: none; background-color: transparent; font-size: 14px; color: #6b7280; border-bottom: 2px solid transparent; transition: all 0.2s; }
        .s1filter-tab-btn:hover { color: #111827; }
        .s1filter-tab-btn.active { color: #3b82f6; border-bottom-color: #3b82f6; font-weight: 500; }
        .s1filter-tab-content { display: none; }
        .s1filter-tab-content.active { display: block; }
        .s1filter-sync-section { margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
        .s1filter-sync-title { font-weight: 500; color: #111827; margin-bottom: 8px; }
        .s1filter-sync-desc { font-size: 14px; color: #6b7280; margin-bottom: 12px; line-height: 1.5; }
        .s1filter-sync-buttons { display: flex; gap: 8px; margin-bottom: 16px; }
        .s1filter-sync-btn { padding: 6px 12px; border-radius: 4px; background-color: #f3f4f6; color: #6b7280; font-size: 14px; cursor: pointer; transition: all 0.2s; border: none; }
        .s1filter-sync-btn:hover { background-color: #3b82f6; color: white; }
        .s1filter-sync-textarea { width: 100%; min-height: 80px; padding: 8px; border-radius: 4px; border: 1px solid #e5e7eb; font-family: monospace; font-size: 12px; resize: vertical; margin-bottom: 8px; box-sizing: border-box; }
        .s1filter-sync-message { font-size: 14px; margin-top: 8px; padding: 8px; border-radius: 4px; }
        .s1filter-sync-success { background-color: #d1fae5; color: #065f46; }
        .s1filter-sync-error { background-color: #fee2e2; color: #b91c1c; }

        /* --- (新) 确认弹窗样式 (v2) --- */
        @keyframes s1filter-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes s1filter-scale-in { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes s1filter-fade-out { from { opacity: 1; } to { opacity: 0; } }
        @keyframes s1filter-scale-out { from { transform: scale(1); opacity: 1; } to { transform: scale(0.97); opacity: 0; } }

        .s1filter-confirm-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.65);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            animation: s1filter-fade-in 0.2s ease-out;
        }
        .s1filter-confirm-content {
            background-color: white;
            border-radius: 12px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            width: 420px;
            max-width: 90%;
            text-align: left; /* 改为左对齐 */
            overflow: hidden;
            animation: s1filter-scale-in 0.25s ease-out;
        }
        .s1filter-confirm-body {
            padding: 20px 24px;
            font-size: 16px;
            color: #1f2937;
            line-height: 1.6;
        }
        .s1filter-confirm-body .confirm-title {
            font-weight: 600;
            font-size: 18px;
            margin-bottom: 8px;
        }
        .s1filter-confirm-body .confirm-subtitle {
            font-size: 14px;
            color: #6b7280;
        }
        .s1filter-confirm-footer {
            padding: 12px 16px;
            background-color: #f3f3f3ff;
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }
        .s1filter-confirm-btn {
            padding: 9px 18px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            border: 1px solid transparent;
            transition: all 0.15s ease-in-out;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }
        .s1filter-confirm-btn:active {
            transform: translateY(1px);
        }
        .s1filter-confirm-btn.cancel {
            background-color: white;
            color: #374151;
            border-color: #d1d5db;
        }
        .s1filter-confirm-btn.cancel:hover {
            background-color: #f9fafb;
            border-color: #b0b8c2;
        }
        .s1filter-confirm-btn.confirm {
            background-color: #ef4444;
            color: white;
            border-color: #ef4444;
        }
        .s1filter-confirm-btn.confirm:hover {
            background-color: #dc2626;
            border-color: #dc2626;
        }
    `);

    // --- 数据处理 & 核心功能 ---
    const getBlockedThreads = () => GM_getValue('s1filter_blocked_threads', {});
    const saveBlockedThreads = (threads) => GM_setValue('s1filter_blocked_threads', threads);
    const getBlockedUsers = () => GM_getValue('s1filter_blocked_users', {});
    const saveBlockedUsers = (users) => GM_setValue('s1filter_blocked_users', users);
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

    // --- UI 创建 ---
    const formatDate = (timestamp) => new Date(timestamp).toLocaleString('zh-CN');

    const createConfirmationModal = (title, subtitle, onConfirm) => {
        document.querySelector('.s1filter-confirm-modal')?.remove(); // 移除已存在的确认弹窗
        const modal = document.createElement('div');
        modal.className = 's1filter-confirm-modal';
        
        modal.innerHTML = `
            <div class="s1filter-confirm-content">
                <div class="s1filter-confirm-body">
                    <div class="confirm-title">${title}</div>
                    <div class="confirm-subtitle">${subtitle}</div>
                </div>
                <div class="s1filter-confirm-footer">
                    <button class="s1filter-confirm-btn cancel">取消</button>
                    <button class="s1filter-confirm-btn confirm">确定屏蔽</button>
                </div>
            </div>
        `;

        const closeModal = () => {
            const content = modal.querySelector('.s1filter-confirm-content');
            // 确保动画属性存在
            if (content) {
                content.style.animation = 's1filter-scale-out 0.25s ease-out forwards';
            }
            modal.style.animation = 's1filter-fade-out 0.25s ease-out forwards';
            setTimeout(() => modal.remove(), 250); // 匹配动画时长
        };
        
        modal.querySelector('.confirm').addEventListener('click', () => {
            onConfirm();
            closeModal();
        });

        modal.querySelector('.cancel').addEventListener('click', closeModal);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        document.body.appendChild(modal);
    };

    const createManagementModal = () => {
        document.querySelector('.s1filter-modal')?.remove();
        const modal = document.createElement('div');
        modal.className = 's1filter-modal';
        const closeModal = () => modal.remove();
        modal.innerHTML = `<div class="s1filter-modal-content"><div class="s1filter-modal-header"><div class="s1filter-modal-title">屏蔽管理</div><div class="s1filter-modal-close">×</div></div><div class="s1filter-modal-body"><div class="s1filter-tabs"><button class="s1filter-tab-btn active" data-tab="threads">帖子屏蔽</button><button class="s1filter-tab-btn" data-tab="users">用户屏蔽</button></div><div id="s1-tab-threads" class="s1filter-tab-content active"></div><div id="s1-tab-users" class="s1filter-tab-content"></div><div id="s1-sync-container"><div class="s1filter-sync-section"><div class="s1filter-sync-title">多设备同步</div><div class="s1filter-sync-desc">通过复制/粘贴数据，在其他设备上同步屏蔽列表。</div><div class="s1filter-sync-buttons"><button id="s1-export-btn" class="s1filter-sync-btn">导出数据</button><button id="s1-import-btn" class="s1filter-sync-btn">导入数据</button></div><textarea id="s1-sync-textarea" class="s1filter-sync-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据"></textarea><div id="s1-sync-message" class="s1filter-sync-message" style="display: none;"></div></div></div></div><div class="s1filter-modal-footer">版本: ${SCRIPT_VERSION} (${SCRIPT_RELEASE_DATE})</div></div>`;
        document.body.appendChild(modal);
        const threadsTab = modal.querySelector('#s1-tab-threads');
        const usersTab = modal.querySelector('#s1-tab-users');
        const syncContainer = modal.querySelector('#s1-sync-container');
        const renderList = (container, blockedItems, type) => {
            const itemIds = Object.keys(blockedItems).sort((a, b) => blockedItems[b].timestamp - blockedItems[a].timestamp);
            if (itemIds.length === 0) { container.innerHTML = `<div class="s1filter-empty">暂无屏蔽的${type === 'thread' ? '帖子' : '用户'}</div>`; return; }
            container.innerHTML = `<div class="s1filter-list">${itemIds.map(id => { const item = blockedItems[id]; const title = type === 'thread' ? (item.title || `帖子 #${id}`) : (item.name || `用户 #${id}`); return `<div class="s1filter-item" data-${type}-id="${id}"><div class="s1filter-item-info"><div class="s1filter-item-title">${title}</div><div class="s1filter-item-meta">屏蔽时间: ${formatDate(item.timestamp)}</div></div><button class="s1filter-unblock-btn" data-unblock-${type}-id="${id}">取消屏蔽</button></div>`; }).join('')}</div>`;
        };
        renderList(threadsTab, getBlockedThreads(), 'thread');
        renderList(usersTab, getBlockedUsers(), 'user');
        threadsTab.appendChild(syncContainer);
        modal.addEventListener('click', (e) => {
            if (e.target.matches('.s1filter-modal, .s1filter-modal-close')) closeModal();
            if (e.target.matches('.s1filter-tab-btn')) {
                modal.querySelectorAll('.s1filter-tab-btn, .s1filter-tab-content').forEach(el => el.classList.remove('active'));
                e.target.classList.add('active');
                const activeTab = modal.querySelector(`#s1-tab-${e.target.dataset.tab}`);
                activeTab.classList.add('active');
                activeTab.appendChild(syncContainer);
            }
            const unblockThreadId = e.target.dataset.unblockThreadId; if (unblockThreadId) { unblockThread(unblockThreadId); renderList(threadsTab, getBlockedThreads(), 'thread'); threadsTab.appendChild(syncContainer); }
            const unblockUserId = e.target.dataset.unblockUserId; if (unblockUserId) { unblockUser(unblockUserId); renderList(usersTab, getBlockedUsers(), 'user'); usersTab.appendChild(syncContainer); }
        });
        const syncTextarea = modal.querySelector('#s1-sync-textarea'); const syncMessage = modal.querySelector('#s1-sync-message');
        const showSyncMessage = (message, isSuccess) => { syncMessage.textContent = message; syncMessage.className = `s1filter-sync-message ${isSuccess ? 's1filter-sync-success' : 's1filter-sync-error'}`; syncMessage.style.display = 'block'; setTimeout(() => { syncMessage.style.display = 'none'; }, 3000); };
        modal.querySelector('#s1-export-btn').addEventListener('click', () => { syncTextarea.value = exportData(); syncTextarea.select(); document.execCommand('copy'); showSyncMessage('数据已导出并复制到剪贴板', true); });
        modal.querySelector('#s1-import-btn').addEventListener('click', () => { const jsonStr = syncTextarea.value.trim(); if (!jsonStr) return showSyncMessage('请先粘贴要导入的数据', false); const result = importData(jsonStr); showSyncMessage(result.message, result.success); if (result.success) { renderList(threadsTab, getBlockedThreads(), 'thread'); renderList(usersTab, getBlockedUsers(), 'user'); } });
    };

    const addBlockButtonsToThreads = () => {
        document.querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]').forEach(row => {
            if(row.querySelector('.s1filter-block-btn.thread-block-btn')) return;
            const titleElement = row.querySelector('th a.s.xst');
            if (titleElement) {
                const threadId = row.id.replace(/^(normalthread_|stickthread_)/, '');
                const threadTitle = titleElement.textContent.trim();
                const blockBtn = document.createElement('span');
                blockBtn.className = 's1filter-block-btn thread-block-btn';
                blockBtn.textContent = '屏蔽';
                blockBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); blockThread(threadId, threadTitle); });
                
                // 固定为前置插入，边距等样式完全由CSS控制
                titleElement.parentNode.insertBefore(blockBtn, titleElement);
            }
        });
    };

    const addBlockButtonsToUsers = () => {
        document.querySelectorAll('.authi > a[href*="space-uid-"]').forEach(authorLink => {
            const plsCell = authorLink.closest('.pls');
            if (!plsCell || plsCell.querySelector('.s1filter-avatar-overlay-container')) return;
            
            const avatarImg = plsCell.querySelector('.avatar img');
            if (!avatarImg) return;
            
            plsCell.style.position = 'relative';

            const uidMatch = authorLink.href.match(/space-uid-(\d+)/);
            if (uidMatch) {
                const userId = uidMatch[1];
                const userName = authorLink.textContent.trim();

                const overlayContainer = document.createElement('div');
                overlayContainer.className = 's1filter-avatar-overlay-container';

                const rect = avatarImg.getBoundingClientRect();
                const parentRect = plsCell.getBoundingClientRect();
                
                overlayContainer.style.top = `${rect.top - parentRect.top}px`;
                overlayContainer.style.left = `${rect.left - parentRect.left}px`;
                overlayContainer.style.width = `${rect.width}px`;
                overlayContainer.style.height = `${rect.height}px`;
                
                const avatarStyle = window.getComputedStyle(avatarImg);
                overlayContainer.style.borderRadius = avatarStyle.borderRadius;

                const blockBtn = document.createElement('span');
                blockBtn.className = 's1filter-block-btn';
                blockBtn.textContent = '屏蔽用户';
                
                blockBtn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    createConfirmationModal(
                        `确定要屏蔽用户 "${userName}" 吗？`,
                        '该用户的所有帖子都将被隐藏，此操作可在屏蔽管理中撤销。',
                        () => {
                            blockUser(userId, userName);
                        }
                    );
                });

                overlayContainer.appendChild(blockBtn);
                plsCell.appendChild(overlayContainer);
            }
        });
    };
    
    const addManagerToNav = () => {
        if (document.getElementById('s1-filter-nav-link')) return;
        const navUl = document.querySelector('#nv ul');
        if (navUl) {
            const navItem = document.createElement('li');
            navItem.id = 's1-filter-nav-link';
            navItem.innerHTML = `<a href="javascript:void(0);">屏蔽管理</a>`;
            navItem.firstElementChild.addEventListener('click', createManagementModal);
            navUl.appendChild(navItem);
        }
    };

    // --- 初始化 ---
    const init = () => {
        addManagerToNav();
        const runTasks = () => {
            if (window.location.href.includes('thread-')) {
                hideBlockedUsersPosts();
                addBlockButtonsToUsers();
            } else if (window.location.href.includes('forum-')) {
                hideBlockedThreads();
                addBlockButtonsToThreads();
            }
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
