// ==UserScript==
// @name         S1Reader - Stage1st阅读增强工具
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  为Stage1st论坛添加阅读增强功能，可以屏蔽不想看到的帖子，支持多设备同步和置顶帖屏蔽
// @author       moekyo
// @match        https://stage1st.com/2b/forum.php*
// @match        https://stage1st.com/2b/forum-*-*.html
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // 添加样式
    GM_addStyle(`
        /* 屏蔽按钮样式 */
        .s1filter-block-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-left: 6px;
            margin-right: 6px;
            padding: 2px 6px;
            border-radius: 4px;
            background-color: #f3f4f6;
            color: #6b7280;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .s1filter-block-btn:hover {
            background-color: #ef4444;
            color: white;
        }
        
        /* 屏蔽管理界面样式 */
        .s1filter-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
        }
        
        .s1filter-modal-content {
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            width: 600px;
            max-width: 90%;
            max-height: 80vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        
        .s1filter-modal-header {
            padding: 16px;
            border-bottom: 1px solid #e5e7eb;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .s1filter-modal-title {
            font-size: 18px;
            font-weight: bold;
            color: #111827;
        }
        
        .s1filter-modal-close {
            cursor: pointer;
            font-size: 20px;
            color: #6b7280;
        }
        
        .s1filter-modal-body {
            padding: 16px;
            overflow-y: auto;
            flex-grow: 1;
        }
        
        .s1filter-empty {
            text-align: center;
            padding: 24px;
            color: #6b7280;
        }
        
        .s1filter-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .s1filter-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            border-radius: 6px;
            background-color: #f9fafb;
            border: 1px solid #e5e7eb;
        }
        
        .s1filter-item-info {
            flex-grow: 1;
        }
        
        .s1filter-item-title {
            font-weight: 500;
            color: #111827;
            margin-bottom: 4px;
        }
        
        .s1filter-item-meta {
            font-size: 12px;
            color: #6b7280;
        }
        
        .s1filter-unblock-btn {
            padding: 6px 12px;
            border-radius: 4px;
            background-color: #f3f4f6;
            color: #6b7280;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
        }
        
        .s1filter-unblock-btn:hover {
            background-color: #10b981;
            color: white;
        }
        
        /* 导航栏按钮样式 */
        .s1filter-nav-btn {
            display: inline-block;
            padding: 0 15px;
            height: 100%;
            line-height: 33px;
            color: #444;
            text-decoration: none;
            cursor: pointer;
        }
        
        .s1filter-nav-btn:hover {
            background-color: #e9e9e9;
        }
        
        /* 同步功能样式 */
        .s1filter-sync-section {
            margin-top: 20px;
            padding-top: 16px;
            padding-left: 0;
            padding-right: 0;
            border-top: 1px solid #e5e7eb;
        }
        
        .s1filter-sync-title {
            font-weight: 500;
            color: #111827;
            margin-bottom: 8px;
        }
        
        .s1filter-sync-desc {
            font-size: 14px;
            color: #6b7280;
            margin-bottom: 12px;
            line-height: 1.5;
        }
        
        .s1filter-sync-buttons {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
        }
        
        .s1filter-sync-btn {
            padding: 6px 12px;
            border-radius: 4px;
            background-color: #f3f4f6;
            color: #6b7280;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
        }
        
        .s1filter-sync-btn:hover {
            background-color: #3b82f6;
            color: white;
        }
        
        .s1filter-sync-input {
            width: 100%;
            padding: 8px 12px;
            border-radius: 4px;
            border: 1px solid #d1d5db;
            font-size: 14px;
            margin-bottom: 8px;
        }
        
        .s1filter-sync-input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
        }
        
        /* 屏蔽帖子样式 */
        .s1filter-blocked {
            display: none !important;
        }
    `);

    // 存储屏蔽的帖子信息
    let blockedThreads = GM_getValue('blockedThreads', {});

    // 创建导航栏按钮
    function createNavButton() {
        const navBar = document.querySelector('#nv ul');
        if (!navBar) return;

        const navItem = document.createElement('li');
        const navBtn = document.createElement('a');
        navBtn.className = 's1filter-nav-btn';
        navBtn.textContent = '屏蔽管理';
        navBtn.addEventListener('click', openBlockedThreadsModal);
        navItem.appendChild(navBtn);
        navBar.appendChild(navItem);
    }

    // 添加屏蔽按钮到帖子
    function addBlockButtons() {
        // 处理普通帖子
        const threadRows = document.querySelectorAll('#threadlisttableid tbody[id^="normalthread_"]');
        threadRows.forEach(row => {
            if (row.querySelector('.s1filter-block-btn')) return;

            const titleElement = row.querySelector('th.common a.xst');
            if (!titleElement) return;

            const threadId = row.id.replace('normalthread_', '');
            const threadTitle = titleElement.textContent.trim();

            // 检查是否已被屏蔽
            if (blockedThreads[threadId]) {
                row.classList.add('s1filter-blocked');
                return;
            }

            const blockBtn = document.createElement('span');
            blockBtn.className = 's1filter-block-btn';
            blockBtn.textContent = '屏蔽';
            blockBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                blockThread(threadId, threadTitle);
                row.classList.add('s1filter-blocked');
            });

            titleElement.parentNode.insertBefore(blockBtn, titleElement.nextSibling);
        });

        // 处理置顶帖
        const stickyRows = document.querySelectorAll('#threadlisttableid tbody[id^="stickthread_"]');
        stickyRows.forEach(row => {
            if (row.querySelector('.s1filter-block-btn')) return;

            const titleElement = row.querySelector('th.common a.xst');
            if (!titleElement) return;

            const threadId = row.id.replace('stickthread_', '');
            const threadTitle = titleElement.textContent.trim();

            // 检查是否已被屏蔽
            if (blockedThreads[threadId]) {
                row.classList.add('s1filter-blocked');
                return;
            }

            const blockBtn = document.createElement('span');
            blockBtn.className = 's1filter-block-btn';
            blockBtn.textContent = '屏蔽';
            blockBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                blockThread(threadId, threadTitle);
                row.classList.add('s1filter-blocked');
            });

            titleElement.parentNode.insertBefore(blockBtn, titleElement.nextSibling);
        });
    }

    // 屏蔽帖子
    function blockThread(threadId, threadTitle) {
        blockedThreads[threadId] = {
            title: threadTitle,
            timestamp: Date.now()
        };
        GM_setValue('blockedThreads', blockedThreads);
    }

    // 取消屏蔽帖子
    function unblockThread(threadId) {
        delete blockedThreads[threadId];
        GM_setValue('blockedThreads', blockedThreads);

        // 刷新页面上的帖子显示
        const threadRow = document.getElementById(`normalthread_${threadId}`) || document.getElementById(`stickthread_${threadId}`);
        if (threadRow) {
            threadRow.classList.remove('s1filter-blocked');
        }
    }

    // 创建屏蔽管理模态框
    function createBlockedThreadsModal() {
        const modal = document.createElement('div');
        modal.className = 's1filter-modal';
        modal.style.display = 'none';

        const modalContent = document.createElement('div');
        modalContent.className = 's1filter-modal-content';

        const modalHeader = document.createElement('div');
        modalHeader.className = 's1filter-modal-header';

        const modalTitle = document.createElement('div');
        modalTitle.className = 's1filter-modal-title';
        modalTitle.textContent = '屏蔽管理';

        const closeBtn = document.createElement('div');
        closeBtn.className = 's1filter-modal-close';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        modalHeader.appendChild(modalTitle);
        modalHeader.appendChild(closeBtn);

        const modalBody = document.createElement('div');
        modalBody.className = 's1filter-modal-body';

        // 添加同步功能区域
        const syncSection = document.createElement('div');
        syncSection.className = 's1filter-sync-section';

        const syncTitle = document.createElement('div');
        syncTitle.className = 's1filter-sync-title';
        syncTitle.textContent = '多设备同步';

        const syncDesc = document.createElement('div');
        syncDesc.className = 's1filter-sync-desc';
        syncDesc.textContent = '您可以导出当前设备的屏蔽列表，并在其他设备上导入，实现多设备间的数据同步。';

        const syncButtons = document.createElement('div');
        syncButtons.className = 's1filter-sync-buttons';

        const exportBtn = document.createElement('button');
        exportBtn.className = 's1filter-sync-btn';
        exportBtn.textContent = '导出数据';
        exportBtn.addEventListener('click', exportBlockedThreads);

        const importBtn = document.createElement('button');
        importBtn.className = 's1filter-sync-btn';
        importBtn.textContent = '导入数据';
        importBtn.addEventListener('click', () => {
            try {
                const importData = JSON.parse(syncInput.value.trim());
                if (typeof importData === 'object') {
                    blockedThreads = importData;
                    GM_setValue('blockedThreads', blockedThreads);
                    updateBlockedThreadsList(modalBody);
                    syncInput.value = '';
                    alert('导入成功！');
                    location.reload();
                } else {
                    alert('导入失败：数据格式不正确');
                }
            } catch (e) {
                alert('导入失败：' + e.message);
            }
        });

        const syncInput = document.createElement('textarea');
        syncInput.className = 's1filter-sync-input';
        syncInput.placeholder = '粘贴导出的数据到这里...';
        syncInput.rows = 4;

        syncButtons.appendChild(exportBtn);
        syncButtons.appendChild(importBtn);

        syncSection.appendChild(syncTitle);
        syncSection.appendChild(syncDesc);
        syncSection.appendChild(syncInput);
        syncSection.appendChild(syncButtons);

        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modalContent.appendChild(syncSection);

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        return { modal, modalBody };
    }

    // 导出屏蔽列表
    function exportBlockedThreads() {
        const exportData = JSON.stringify(blockedThreads);
        navigator.clipboard.writeText(exportData).then(() => {
            alert('数据已复制到剪贴板！');
        }).catch(err => {
            console.error('复制失败:', err);
            prompt('请手动复制以下数据:', exportData);
        });
    }

    // 更新屏蔽列表显示
    function updateBlockedThreadsList(modalBody) {
        // 清空现有内容
        modalBody.innerHTML = '';

        const blockedIds = Object.keys(blockedThreads);

        if (blockedIds.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 's1filter-empty';
            emptyMsg.textContent = '您还没有屏蔽任何帖子';
            modalBody.appendChild(emptyMsg);
            return;
        }

        const list = document.createElement('div');
        list.className = 's1filter-list';

        // 按时间倒序排列
        blockedIds.sort((a, b) => {
            return (blockedThreads[b].timestamp || 0) - (blockedThreads[a].timestamp || 0);
        });

        blockedIds.forEach(threadId => {
            const thread = blockedThreads[threadId];
            const item = document.createElement('div');
            item.className = 's1filter-item';

            const itemInfo = document.createElement('div');
            itemInfo.className = 's1filter-item-info';

            const itemTitle = document.createElement('div');
            itemTitle.className = 's1filter-item-title';
            itemTitle.textContent = thread.title || '未知标题';

            const itemMeta = document.createElement('div');
            itemMeta.className = 's1filter-item-meta';
            if (thread.timestamp) {
                const date = new Date(thread.timestamp);
                itemMeta.textContent = `屏蔽时间: ${date.toLocaleString()}`;
            } else {
                itemMeta.textContent = '屏蔽时间: 未知';
            }

            const unblockBtn = document.createElement('button');
            unblockBtn.className = 's1filter-unblock-btn';
            unblockBtn.textContent = '取消屏蔽';
            unblockBtn.addEventListener('click', () => {
                unblockThread(threadId);
                item.remove();
                if (list.children.length === 0) {
                    updateBlockedThreadsList(modalBody);
                }
            });

            itemInfo.appendChild(itemTitle);
            itemInfo.appendChild(itemMeta);

            item.appendChild(itemInfo);
            item.appendChild(unblockBtn);

            list.appendChild(item);
        });

        modalBody.appendChild(list);
    }

    // 打开屏蔽管理模态框
    let modalElements;
    function openBlockedThreadsModal() {
        if (!modalElements) {
            modalElements = createBlockedThreadsModal();
        }

        updateBlockedThreadsList(modalElements.modalBody);
        modalElements.modal.style.display = 'flex';
    }

    // 处理动态加载的内容
    function observePageChanges() {
        const observer = new MutationObserver((mutations) => {
            let needsUpdate = false;
            mutations.forEach(mutation => {
                if (mutation.addedNodes.length > 0) {
                    needsUpdate = true;
                }
            });

            if (needsUpdate) {
                addBlockButtons();
            }
        });

        observer.observe(document.getElementById('threadlisttableid') || document.body, {
            childList: true,
            subtree: true
        });
    }

    // 初始化
    function init() {
        createNavButton();
        addBlockButtons();
        observePageChanges();
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();