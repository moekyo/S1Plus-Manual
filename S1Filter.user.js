// ==UserScript==
// @name         S1Filter - Stage1st帖子屏蔽工具
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  为Stage1st论坛添加帖子屏蔽功能，可以屏蔽不想看到的帖子
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
            padding: 2px 6px;
            border-radius: 4px;
            background-color: #f3f4f6;
            color: #6b7280;
            font-size: 12px;
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
    `);

    // 获取屏蔽列表
    const getBlockedThreads = () => {
        return GM_getValue('s1filter_blocked_threads', {});
    };

    // 保存屏蔽列表
    const saveBlockedThreads = (blockedThreads) => {
        GM_setValue('s1filter_blocked_threads', blockedThreads);
    };

    // 屏蔽帖子
    const blockThread = (threadId, threadTitle) => {
        const blockedThreads = getBlockedThreads();
        blockedThreads[threadId] = {
            title: threadTitle,
            timestamp: Date.now()
        };
        saveBlockedThreads(blockedThreads);
        hideThread(threadId);
    };

    // 取消屏蔽帖子
    const unblockThread = (threadId) => {
        const blockedThreads = getBlockedThreads();
        delete blockedThreads[threadId];
        saveBlockedThreads(blockedThreads);
        // 如果当前页面有这个帖子，则显示出来
        const threadElement = document.getElementById(`normalthread_${threadId}`);
        if (threadElement) {
            threadElement.style.display = '';
        }
    };

    // 隐藏帖子
    const hideThread = (threadId) => {
        const threadElement = document.getElementById(`normalthread_${threadId}`);
        if (threadElement) {
            threadElement.style.display = 'none';
        }
    };

    // 格式化时间
    const formatDate = (timestamp) => {
        const date = new Date(timestamp);
        return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    };

    // 创建屏蔽管理界面
    const createBlockedThreadsModal = () => {
        // 如果已经存在，则先移除
        const existingModal = document.querySelector('.s1filter-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.className = 's1filter-modal';

        const modalContent = document.createElement('div');
        modalContent.className = 's1filter-modal-content';

        const modalHeader = document.createElement('div');
        modalHeader.className = 's1filter-modal-header';

        const modalTitle = document.createElement('div');
        modalTitle.className = 's1filter-modal-title';
        modalTitle.textContent = '屏蔽管理';

        const modalClose = document.createElement('div');
        modalClose.className = 's1filter-modal-close';
        modalClose.textContent = '×';
        modalClose.addEventListener('click', () => {
            modal.remove();
        });

        modalHeader.appendChild(modalTitle);
        modalHeader.appendChild(modalClose);

        const modalBody = document.createElement('div');
        modalBody.className = 's1filter-modal-body';

        const blockedThreads = getBlockedThreads();
        const blockedThreadIds = Object.keys(blockedThreads);

        if (blockedThreadIds.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 's1filter-empty';
            emptyMessage.textContent = '暂无屏蔽的帖子';
            modalBody.appendChild(emptyMessage);
        } else {
            const list = document.createElement('div');
            list.className = 's1filter-list';

            // 按时间倒序排列
            blockedThreadIds
                .sort((a, b) => blockedThreads[b].timestamp - blockedThreads[a].timestamp)
                .forEach(threadId => {
                    const thread = blockedThreads[threadId];
                    const item = document.createElement('div');
                    item.className = 's1filter-item';
                    item.dataset.threadId = threadId;

                    const itemInfo = document.createElement('div');
                    itemInfo.className = 's1filter-item-info';

                    const itemTitle = document.createElement('div');
                    itemTitle.className = 's1filter-item-title';
                    itemTitle.textContent = thread.title || `帖子 #${threadId}`;

                    const itemMeta = document.createElement('div');
                    itemMeta.className = 's1filter-item-meta';
                    itemMeta.textContent = `屏蔽时间: ${formatDate(thread.timestamp)}`;

                    itemInfo.appendChild(itemTitle);
                    itemInfo.appendChild(itemMeta);

                    const unblockBtn = document.createElement('button');
                    unblockBtn.className = 's1filter-unblock-btn';
                    unblockBtn.textContent = '取消屏蔽';
                    unblockBtn.addEventListener('click', () => {
                        unblockThread(threadId);
                        item.remove();
                        if (list.children.length === 0) {
                            const emptyMessage = document.createElement('div');
                            emptyMessage.className = 's1filter-empty';
                            emptyMessage.textContent = '暂无屏蔽的帖子';
                            modalBody.innerHTML = '';
                            modalBody.appendChild(emptyMessage);
                        }
                    });

                    item.appendChild(itemInfo);
                    item.appendChild(unblockBtn);
                    list.appendChild(item);
                });

            modalBody.appendChild(list);
        }

        modalContent.appendChild(modalHeader);
        modalContent.appendChild(modalBody);
        modal.appendChild(modalContent);

        document.body.appendChild(modal);

        // 点击模态框外部关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    };

    // 添加屏蔽按钮到帖子
    const addBlockButtonsToThreads = () => {
        const threadRows = document.querySelectorAll('tbody[id^="normalthread_"]');
        threadRows.forEach(row => {
            const threadId = row.id.replace('normalthread_', '');
            // 修改选择器，同时支持th.common和th.new类名
            const titleElement = row.querySelector('th.common a.s.xst') || row.querySelector('th.new a.s.xst');
            
            // 检查是否已经添加过屏蔽按钮，如果没有则添加
            if (titleElement && !titleElement.parentNode.querySelector('.s1filter-block-btn')) {
                const threadTitle = titleElement.textContent;
                
                const blockBtn = document.createElement('span');
                blockBtn.className = 's1filter-block-btn';
                blockBtn.textContent = '屏蔽';
                blockBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    blockThread(threadId, threadTitle);
                });
                
                // 将按钮添加到标题元素后面，而不是作为子元素
                titleElement.parentNode.insertBefore(blockBtn, titleElement.nextSibling);
            }
        });
    };

    // 添加屏蔽管理按钮到导航栏
    const addBlockManagerToNav = () => {
        // 检查是否已经添加过
        if (document.getElementById('s1-blocker-nav-link')) {
            return;
        }

        const navUl = document.querySelector('#nv ul');
        if (navUl) {
            const navItem = document.createElement('li');
            navItem.id = 's1-blocker-nav-link';
            
            const navLink = document.createElement('a');
            navLink.href = 'javascript:void(0);';
            navLink.textContent = '屏蔽管理';
            navLink.addEventListener('click', createBlockedThreadsModal);
            
            navItem.appendChild(navLink);
            navUl.appendChild(navItem);
        }
    };

    // 隐藏已屏蔽的帖子
    const hideBlockedThreads = () => {
        const blockedThreads = getBlockedThreads();
        Object.keys(blockedThreads).forEach(threadId => {
            hideThread(threadId);
        });
    };

    // 初始化
    const init = () => {
        // 添加屏蔽管理按钮到导航栏
        addBlockManagerToNav();
        
        // 隐藏已屏蔽的帖子
        hideBlockedThreads();
        
        // 添加屏蔽按钮到帖子
        addBlockButtonsToThreads();
        
        // 监听可能的动态加载内容
        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            
            mutations.forEach(mutation => {
                if (mutation.addedNodes.length) {
                    for (let i = 0; i < mutation.addedNodes.length; i++) {
                        const node = mutation.addedNodes[i];
                        if (node.nodeType === 1) {
                            // 检查是否是帖子元素或者包含帖子元素
                            if (node.id && node.id.startsWith('normalthread_') || 
                                node.querySelector && node.querySelector('tbody[id^="normalthread_"]')) {
                                shouldUpdate = true;
                                break;
                            }
                        }
                    }
                }
            });
            
            if (shouldUpdate) {
                setTimeout(() => {
                    hideBlockedThreads();
                    addBlockButtonsToThreads();
                }, 100); // 添加短暂延迟确保DOM完全更新
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
    };

    // 当页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();