// ==UserScript==
// @name         S1 Plus - Stage1st 体验增强套件
// @namespace    http://tampermonkey.net/
// @version      6.10.0
// @description  为Stage1st论坛提供帖子/用户/楼层屏蔽、导航栏自定义、自动签到、阅读进度跟踪、回复收藏、远程同步等多种功能，全方位优化你的论坛体验。
// @author       moekyo
// @match        https://stage1st.com/2b/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_download
// @grant        GM_addValueChangeListener
// @connect      stage1st.com
// @connect      img.stage1st.com
// @connect      api.github.com
// @connect      gist.githubusercontent.com
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";
  const IS_S1P_TEST_MODE =
    typeof globalThis !== "undefined" && globalThis.__S1P_TEST_MODE__ === true;

  const SCRIPT_VERSION = "6.10.0";
  const SCRIPT_RELEASE_DATE = "2026-03-28";

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
    const newObj = Object.create(null);
    for (const key of sortedKeys) {
      newObj[key] = deterministicSort(obj[key]);
    }
    return newObj;
  };

  /**
   * HTML 文本节点转义，避免将用户数据直接作为 HTML 解析。
   * @param {any} value
   * @returns {string}
   */
  const escapeHTML = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  /**
   * HTML 属性值转义（当前与文本转义策略一致，语义上便于区分用途）。
   * @param {any} value
   * @returns {string}
   */
  const escapeAttr = (value) => escapeHTML(value);

  // 绝对链接白名单策略（收紧版）：
  // 1) 允许任意 https 链接；
  // 2) 允许同源 http 链接（兼容极少数同源回退场景）；
  // 3) 不允许 mailto/tel/ftp 等协议，降低钓鱼或非预期跳转面。
  const isAllowedAbsoluteUrl = (parsedUrl) => {
    if (parsedUrl.protocol === "https:") {
      return true;
    }
    if (parsedUrl.protocol === "http:") {
      return parsedUrl.origin === window.location.origin;
    }
    return false;
  };
  const getSafeUrlAttributeValue = (
    value,
    { allowEmpty = true } = {}
  ) => {
    const trimmedValue = String(value ?? "").trim();
    if (!trimmedValue) {
      return allowEmpty ? "" : null;
    }

    // 协议相对 URL 会继承当前协议，容易引入不受控跳转，按不安全处理。
    if (/^\/\//.test(trimmedValue)) {
      return null;
    }

    // 锚点与站内相对路径默认允许。
    if (
      /^#/.test(trimmedValue) ||
      /^\//.test(trimmedValue) ||
      /^\?/.test(trimmedValue) ||
      /^\.\.?\//.test(trimmedValue)
    ) {
      return trimmedValue;
    }

    try {
      const parsedUrl = new URL(trimmedValue, window.location.origin);
      return isAllowedAbsoluteUrl(parsedUrl) ? trimmedValue : null;
    } catch (e) {
      return null;
    }
  };
  const isSafeUrlAttributeValue = (value, options = undefined) =>
    getSafeUrlAttributeValue(value, options) !== null;

  const isObjectRecord = (value) =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  // 避免通过导入数据中的特殊键污染对象原型链。
  const UNSAFE_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const isUnsafeRecordKey = (key) => UNSAFE_RECORD_KEYS.has(String(key));
  const hasUnsafeRecordKeys = (value) =>
    isObjectRecord(value) &&
    Object.keys(value).some((key) => isUnsafeRecordKey(key));
  const sanitizeRecordObject = (value) => {
    if (!isObjectRecord(value)) {
      return {};
    }
    const sanitized = {};
    Object.keys(value).forEach((key) => {
      if (isUnsafeRecordKey(key)) {
        return;
      }
      sanitized[key] = value[key];
    });
    return sanitized;
  };

  const normalizeCustomNavLinks = (links = []) => {
    if (!Array.isArray(links)) {
      return [];
    }

    return links.reduce((acc, link) => {
      if (!isObjectRecord(link)) {
        return acc;
      }

      const name = String(link.name ?? "").trim();
      const href = getSafeUrlAttributeValue(link.href, { allowEmpty: false });
      if (!name || !href) {
        return acc;
      }

      acc.push({ name, href });
      return acc;
    }, []);
  };

  const normalizeNumericId = (value) => {
    const normalized = String(value ?? "").trim();
    return /^\d+$/.test(normalized) ? normalized : "";
  };
  const extractUidFromProfileHref = (href) => {
    const uidMatch = String(href || "").match(/space-uid-(\d+)/);
    return uidMatch && uidMatch[1] ? uidMatch[1] : "";
  };
  const getPostTableById = (postId) => {
    const normalizedPostId = normalizeNumericId(postId);
    return normalizedPostId ? document.getElementById(`pid${normalizedPostId}`) : null;
  };
  const PLAIN_URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s<>"']*/gi;
  const URL_DETECTOR_REGEX = /(?:https?:\/\/|www\.)/i;
  const PLAIN_URL_TRAILING_PUNCTUATION_REGEX = /[.,!?;:，。！？；：、]/u;
  const PLAIN_URL_AUTOLINK_CLASS_NAME = "s1p-autolink-url";
  const PLAIN_URL_AUTOLINK_DATA_VALUE = "url";
  const PLAIN_URL_AUTOLINK_FALLBACK_ROOT_IDS = ["postlist", "ct"];
  const PLAIN_URL_AUTOLINK_SKIP_SELECTOR = [
    "a",
    "script",
    "style",
    "textarea",
    "input",
    "button",
    "select",
    "option",
    "code",
    "pre",
    ".s1p-modal",
    ".s1p-confirm-modal",
    "[contenteditable='true']",
    ".tedt",
    ".edt",
  ].join(", ");
  const AUTO_LINKED_URL_ANCHOR_SELECTOR =
    'a.s1p-autolink-url[data-s1p-autolink="url"], a.s1p-autolink-bilibili[data-s1p-autolink="bilibili"]';
  const OPEN_IN_NEW_TAB_THREAD_LIST_SCOPE_SELECTOR = "#threadlist";
  const OPEN_IN_NEW_TAB_NOTIFICATION_SCOPE_SELECTOR = ".xld.xlda";
  const OPEN_IN_NEW_TAB_NAV_SCOPE_SELECTOR = "#nv, #mu, #um, #hd";
  const OPEN_IN_NEW_TAB_PRIMARY_KEYS = [
    "threadList",
    "progress",
    "nav",
    "postContentLinks",
  ];
  const OPEN_IN_NEW_TAB_EXCLUDED_SCOPE_SELECTOR =
    ".s1p-modal, .s1p-confirm-modal, .s1p-options-menu, .s1p-tag-popover, .pob, .pgs, .pgbtn, #s1p-nav-link, #s1p-nav-sync-btn";
  const isLikelyDownloadLink = (anchorElement, hrefValue) => {
    if (!(anchorElement instanceof HTMLAnchorElement)) {
      return false;
    }
    if (anchorElement.hasAttribute("download")) {
      return true;
    }
    const normalizedHref = String(hrefValue || "").trim().toLowerCase();
    if (!normalizedHref) {
      return false;
    }
    if (
      /(?:^|[?&])mod=attachment(?:&|$)/.test(normalizedHref) ||
      /(?:^|[?&])(?:action|op|do)=download(?:&|$)/.test(normalizedHref) ||
      /(?:^|\/)attachment\.php(?:[?#]|$)/.test(normalizedHref)
    ) {
      return true;
    }
    try {
      const parsedUrl = new URL(anchorElement.href || hrefValue, window.location.origin);
      const pathname = String(parsedUrl.pathname || "").toLowerCase();
      if (pathname.endsWith("/attachment.php") || pathname === "/attachment.php") {
        return true;
      }
      const mod = String(parsedUrl.searchParams.get("mod") || "").toLowerCase();
      if (mod === "attachment") {
        return true;
      }
      const action = String(parsedUrl.searchParams.get("action") || "").toLowerCase();
      if (action === "download") {
        return true;
      }
      const op = String(parsedUrl.searchParams.get("op") || "").toLowerCase();
      if (op === "download") {
        return true;
      }
      const doParam = String(parsedUrl.searchParams.get("do") || "").toLowerCase();
      return doParam === "download";
    } catch (e) {
      return false;
    }
  };
  const isLikelyLogoutLink = (anchorElement, hrefValue) => {
    if (!(anchorElement instanceof HTMLAnchorElement)) {
      return false;
    }
    const normalizedHref = String(hrefValue || "").trim().toLowerCase();
    if (!normalizedHref) {
      return false;
    }
    if (
      /(?:^|[?&])mod=logging(?:&|$)/.test(normalizedHref) &&
      /(?:^|[?&])action=logout(?:&|$)/.test(normalizedHref)
    ) {
      return true;
    }
    try {
      const parsedUrl = new URL(anchorElement.href || hrefValue, window.location.origin);
      if (parsedUrl.origin !== window.location.origin) {
        return false;
      }
      const pathname = String(parsedUrl.pathname || "").toLowerCase();
      const mod = String(parsedUrl.searchParams.get("mod") || "").toLowerCase();
      const action = String(parsedUrl.searchParams.get("action") || "").toLowerCase();
      const op = String(parsedUrl.searchParams.get("op") || "").toLowerCase();
      const doParam = String(parsedUrl.searchParams.get("do") || "").toLowerCase();
      if (mod === "logging" && action === "logout") {
        return true;
      }
      if (pathname.endsWith("/member.php") || pathname === "/member.php") {
        return action === "logout" || op === "logout" || doParam === "logout";
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  /**
   * 对受限场景中的 HTML 片段进行白名单清洗。
   * 仅保留允许标签与允许属性，剔除注释、事件处理器与 javascript: 链接。
   * @param {any} html
   * @param {string[]} allowedTags
   * @param {Record<string, string[]>} allowedAttrsByTag
   * @returns {string}
   */
  const sanitizeHtmlFragment = (html, allowedTags = [], allowedAttrsByTag = {}) => {
    const template = document.createElement("template");
    template.innerHTML = String(html ?? "");
    const allowedTagSet = new Set(
      allowedTags.map((tag) => String(tag).toUpperCase())
    );
    const normalizedAllowedAttrsByTag = {};
    Object.keys(allowedAttrsByTag).forEach((tag) => {
      normalizedAllowedAttrsByTag[String(tag).toUpperCase()] = new Set(
        (allowedAttrsByTag[tag] || []).map((attr) => String(attr).toLowerCase())
      );
    });

    const sanitizeNode = (root) => {
      Array.from(root.childNodes).forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.tagName.toUpperCase();
          if (!allowedTagSet.has(tagName)) {
            node.replaceWith(document.createTextNode(node.textContent || ""));
            return;
          }

          const allowedAttrs = normalizedAllowedAttrsByTag[tagName] || new Set();
          Array.from(node.attributes).forEach((attr) => {
            const attrName = attr.name.toLowerCase();
            const attrValue = String(attr.value || "");

            if (attrName.startsWith("on")) {
              node.removeAttribute(attr.name);
              return;
            }

            if (
              attrName === "href" || attrName === "xlink:href"
            ) {
              const safeUrlValue = getSafeUrlAttributeValue(attrValue, {
                allowEmpty: true,
              });
              if (safeUrlValue === null) {
                node.removeAttribute(attr.name);
                return;
              }
              if (safeUrlValue !== attrValue) {
                node.setAttribute(attr.name, safeUrlValue);
              }
            }

            if (
              attrName === "style" &&
              /(expression\s*\(|javascript:|vbscript:|data\s*:\s*text\/html)/i.test(
                attrValue
              )
            ) {
              node.removeAttribute(attr.name);
              return;
            }

            if (!allowedAttrs.has(attrName)) {
              node.removeAttribute(attr.name);
            }
          });

          sanitizeNode(node);
          return;
        }

        if (node.nodeType === Node.COMMENT_NODE) {
          node.remove();
        }
      });
    };

    sanitizeNode(template.content);
    return template.innerHTML;
  };

  const sanitizeSubtitleHtml = (html) =>
    sanitizeHtmlFragment(
      html,
      ["br", "strong", "b", "em", "i", "code", "p", "span"],
      {}
    );

  const sanitizeInlineActionLabelHtml = (html) =>
    sanitizeHtmlFragment(
      html,
      ["svg", "path", "span", "polyline", "circle"],
      {
        svg: [
          "xmlns",
          "viewbox",
          "fill",
          "width",
          "height",
          "style",
          "stroke",
          "stroke-width",
          "stroke-linecap",
          "stroke-linejoin",
        ],
        path: [
          "d",
          "fill",
          "style",
          "stroke",
          "stroke-width",
          "stroke-linecap",
          "stroke-linejoin",
        ],
        span: ["class", "style"],
        polyline: [
          "points",
          "fill",
          "style",
          "stroke",
          "stroke-width",
          "stroke-linecap",
          "stroke-linejoin",
        ],
        circle: [
          "class",
          "cx",
          "cy",
          "r",
          "fill",
          "style",
          "stroke",
          "stroke-width",
          "stroke-linecap",
          "stroke-linejoin",
        ],
      }
    );

  const setSanitizedIconHtml = (element, html) => {
    if (!element) return;
    element.innerHTML = sanitizeInlineActionLabelHtml(html);
  };

  const sanitizeAdvancedModalHtml = (html) =>
    sanitizeHtmlFragment(
      html,
      ["a", "br", "code", "div", "h2", "p", "span", "strong"],
      {
        a: ["class", "href", "rel", "target", "title"],
        br: [],
        code: ["class", "style"],
        div: ["class", "style"],
        h2: ["class", "style"],
        p: ["class", "style"],
        span: ["class", "style"],
        strong: ["class", "style"],
      }
    );

  // --- [新增] 全局状态标志，用于防止启动时的同步竞态条件 ---
  let isInitialSyncInProgress = false;
  let syncDirtyDuringSync = false;
  let syncDirtyNeedsFollowUpSync = false;
  let syncDirtyTimestamp = 0;
  let isBackgroundAutoSyncInProgress = false;
  let manualSyncInFlightPromise = null;
  let forceSyncInFlight = false;
  let hasPendingBackgroundSync = false;
  let backgroundSyncRetryTimeout = null;
  let backgroundSyncRetryAttempts = 0;
  let backgroundSyncLockHeartbeatTimer = null;
  let manualSyncLockHeartbeatTimer = null;
  let startupSyncLockHeartbeatTimer = null;
  let isAutoSignInFlight = false;

  const BACKGROUND_SYNC_OWNER_ID = `tab_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const BACKGROUND_SYNC_LOCK_KEY = "s1p_background_sync_lock";
  const BACKGROUND_SYNC_LOCK_TTL_MS = 45 * 1000;
  const BACKGROUND_SYNC_LOCK_HEARTBEAT_MS = 10 * 1000;
  const BACKGROUND_SYNC_LOCK_RETRY_DELAY_MS = 8 * 1000;
  const BACKGROUND_SYNC_MAX_RETRY_ATTEMPTS = 120;
  const BACKGROUND_SYNC_MAX_DRAIN_LOOPS = 3;
  const GLOBAL_SYNC_LOCK_KEY = "s1p_sync_global_lock";
  const SYNC_LOCK_MODE_MANUAL = "manual";
  const SYNC_LOCK_MODE_BACKGROUND = "background";
  const SYNC_LOCK_MODE_STARTUP = "startup";
  const MANUAL_SYNC_LOCK_KEY = "s1p_manual_sync_lock";
  const MANUAL_SYNC_LOCK_TTL_MS = 3 * 60 * 1000;
  const MANUAL_SYNC_LOCK_HEARTBEAT_MS = 10 * 1000;
  const STARTUP_SYNC_LOCK_KEY = "s1p_startup_sync_lock";
  const STARTUP_SYNC_LOCK_TTL_MS = 3 * 60 * 1000;
  const STARTUP_SYNC_LOCK_HEARTBEAT_MS = 10 * 1000;
  const SYNC_LOCK_VERIFY_DELAY_MS = 50;

  const REMOTE_SYNC_REQUEST_TIMEOUT_MS = 12 * 1000;
  const REMOTE_SYNC_MAX_RETRIES = 2;
  const REMOTE_SYNC_RETRY_BASE_DELAY_MS = 600;
  const REMOTE_SYNC_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
  const REMOTE_VERSION_CONFLICT_CODE = "REMOTE_VERSION_CHANGED";
  const READ_PROGRESS_SYNC_DEBOUNCE_MS = 20 * 1000;
  const DEFAULT_SYNC_DEBOUNCE_MS = 5 * 1000;
  const SYNC_CONFLICT_MODAL_COOLDOWN_MS = 2 * 60 * 1000;
  const SYNC_CONFLICT_MODAL_COOLDOWN_GROUP_MAP = Object.freeze({
    background_conflict: "sync_conflict",
    startup_conflict: "sync_conflict",
    auto_conflict_paused: "sync_conflict",
    startup_local_newer: "sync_conflict",
  });
  const SYNC_DIAGNOSTICS_KEY = "s1p_sync_diagnostics";
  const AUTO_SYNC_FAILURE_COUNT_KEY = "s1p_auto_sync_failure_count";
  const AUTO_SYNC_CIRCUIT_OPEN_UNTIL_KEY = "s1p_auto_sync_circuit_open_until";
  const AUTO_SYNC_CONFLICT_PAUSE_KEY = "s1p_auto_sync_conflict_pause";
  const PENDING_AUTO_SYNC_KEY = "s1p_pending_auto_sync_request";
  const AUTO_SYNC_INDICATOR_STATE_KEY = "s1p_auto_sync_indicator_state";
  const AUTO_SYNC_INDICATOR_PHASE_IDLE = "idle";
  const AUTO_SYNC_INDICATOR_PHASE_PENDING = "pending";
  const AUTO_SYNC_INDICATOR_PHASE_RUNNING = "running";
  const AUTO_SYNC_INDICATOR_PHASE_SUCCESS = "success";
  const AUTO_SYNC_INDICATOR_PHASE_FAILURE = "failure";
  const AUTO_SYNC_INDICATOR_PHASE_CONFLICT = "conflict";
  const AUTO_SYNC_INDICATOR_PENDING_STALE_MS = 90 * 1000;
  const AUTO_SYNC_INDICATOR_RUNNING_STALE_MS = 3 * 60 * 1000;
  const AUTO_SYNC_INDICATOR_SUCCESS_TTL_MS = 2 * 60 * 1000;
  const AUTO_SYNC_INDICATOR_FAILURE_TTL_MS = 5 * 60 * 1000;
  const AUTO_SYNC_INDICATOR_CONFLICT_TTL_MS = 10 * 60 * 1000;
  const SETTINGS_CROSS_TAB_SIGNAL_KEY = "s1p_settings_refresh_signal";
  const SETTINGS_CROSS_TAB_SIGNAL_SOURCE_ID = `s1p_tab_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
  const SYNC_BASELINE_STATE_KEY = "s1p_sync_baseline_state";
  const SYNC_LOCK_LOST_CODE = "SYNC_LOCK_LOST";
  const SYNC_CONFLICT_MODAL_COOLDOWN_LOCK_KEY =
    "s1p_sync_conflict_modal_cooldown_lock";
  const SYNC_CONFLICT_MODAL_COOLDOWN_LOCK_TTL_MS = 1500;
  const AUTO_SYNC_CIRCUIT_BREAKER_THRESHOLD = 3;
  const AUTO_SYNC_CIRCUIT_OPEN_DURATION_MS = 10 * 60 * 1000;
  // 当时间戳相差过大时，不再自动依据“谁大谁新”做决策，转为冲突保护。
  const SYNC_TIMESTAMP_SKEW_TOLERANCE_MS = 12 * 60 * 60 * 1000;
  const DOM_OBSERVER_DEBOUNCE_MS = 120;
  const SETTINGS_CACHE_TTL_MS = 1000;
  const CORE_DATA_CACHE_TTL_MS = 1000;
  const OBSERVER_INCREMENTAL_THREAD_ROW_LIMIT = 80;
  const OBSERVER_INCREMENTAL_POST_TABLE_LIMIT = 80;
  const OBSERVER_INCREMENTAL_QUOTE_SCOPE_LIMIT = 80;
  const OBSERVER_INCREMENTAL_RATINGS_SCOPE_LIMIT = 80;
  const OBSERVER_INCREMENTAL_NOTIFICATION_SCOPE_LIMIT = 80;
  // 帖子列表页阅读进度刷新防抖，避免跨标签高频更新导致频繁重绘。
  const READ_PROGRESS_LIST_REFRESH_DEBOUNCE_MS = 120;
  // 帖内工具栏图标默认悬浮提示延迟，避免扫过时频繁闪现。
  const DEFAULT_TOOLBAR_TOOLTIP_DELAY_MS = 350;
  // 与 NUX 窄屏规则保持一致的断点。
  const NARROW_SCREEN_MAX_WIDTH_PX = 909;
  // 列表页阅读按钮悬停超过该时长后显示删除入口。
  const READ_PROGRESS_DELETE_REVEAL_DELAY_MS = 1 * 1000;
  // 帖子页阅读进度持久化防抖：以内存批量累积为主，隐藏/卸载前强制落盘。
  const READ_PROGRESS_PERSIST_DEBOUNCE_MS = 5 * 1000;
  const NATIVE_BLACKLIST_VIEW_URL =
    "https://stage1st.com/2b/home.php?mod=space&do=friend&view=blacklist";
  const NATIVE_BLACKLIST_IMPORT_BUTTON_ID = "s1p-native-blacklist-import-btn";
  const NATIVE_BLACKLIST_IMPORT_HINT_ID = "s1p-native-blacklist-import-hint";
  const NATIVE_BLACKLIST_IMPORTED_BADGE_CLASS = "s1p-native-imported-badge";
  const NATIVE_BLACKLIST_IMPORTED_BADGE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5 2H19C19.5523 2 20 2.44772 20 3V22.1433C20 22.4194 19.7761 22.6434 19.5 22.6434C19.4061 22.6434 19.314 22.6168 19.2344 22.5669L12 18.0313L4.76559 22.5669C4.53163 22.7136 4.22306 22.6429 4.07637 22.4089C4.02647 22.3293 4 22.2373 4 22.1433V3C4 2.44772 4.44772 2 5 2ZM18 4H6V19.4324L12 15.6707L18 19.4324V4Z"></path></svg>`;
  const NATIVE_BLACKLIST_IMPORTED_BADGE_TITLE = "已在 S1 Plus 屏蔽列表";
  // 阅读位置标识的正文留白与右侧安全间距。
  const READ_INDICATOR_CONTENT_GAP_PX = 8;
  const READ_INDICATOR_RIGHT_SAFE_GAP_PX = 14;
  // 收藏内容同步只保留短预览，避免整段文本参与哈希和上传。
  const BOOKMARK_SYNC_PREVIEW_MAX_LENGTH = 280;
  const SUPPORTS_CSS_HAS_SELECTOR = (() => {
    try {
      return Boolean(
        window.CSS &&
        typeof window.CSS.supports === "function" &&
        window.CSS.supports("selector(:has(*))")
      );
    } catch (error) {
      return false;
    }
  })();
  const IMAGE_PREVIEW_LIMIT_MIN = 100;
  const IMAGE_PREVIEW_LIMIT_MAX = 5000;
  const IMAGE_PREVIEW_DEFAULT_WIDTH = 800;
  const IMAGE_PREVIEW_DEFAULT_HEIGHT = 1200;
  const IMAGE_PREVIEW_LIMIT_ROOT_CLASS = "s1p-limit-images-by-size-enabled";
  const IMAGE_PREVIEW_LIMIT_IMAGE_CLASS = "s1p-size-limited-image";
  const S1P_IMAGE_VIEWER_IMAGE_SELECTOR = "img.zoom, img[id^='aimg_']";
  const IMAGE_PREVIEW_TITLE_DATA_KEY = "s1pOriginalTitle";
  const IMAGE_PREVIEW_TITLE_HINT = "\u70b9\u51fb\u67e5\u770b\u539f\u56fe";
  const S1P_IMAGE_VIEWER_MIN_SCALE = 0.08;
  const S1P_IMAGE_VIEWER_MAX_SCALE = 8;
  const S1P_IMAGE_VIEWER_ZOOM_STEP = 0.16;
  const S1P_IMAGE_VIEWER_SCROLL_STEP_RATIO = 0.24;
  const S1P_IMAGE_VIEWER_SCROLL_STEP_MIN_PX = 56;
  const S1P_IMAGE_VIEWER_SCROLL_STEP_MAX_PX = 360;
  const S1P_IMAGE_VIEWER_BUTTON_ZOOM_ANIMATION_MS = 160;
  const S1P_IMAGE_VIEWER_BUTTON_SCROLL_ANIMATION_MS = 220;
  const S1P_IMAGE_VIEWER_BUTTON_HOLD_DELAY_MS = 260;
  const S1P_IMAGE_VIEWER_BUTTON_ZOOM_REPEAT_INTERVAL_MS =
    S1P_IMAGE_VIEWER_BUTTON_ZOOM_ANIMATION_MS;
  const S1P_IMAGE_VIEWER_BUTTON_SCROLL_REPEAT_INTERVAL_MS =
    S1P_IMAGE_VIEWER_BUTTON_SCROLL_ANIMATION_MS;
  const S1P_IMAGE_VIEWER_OPEN_CLOSE_ANIMATION_MS = 180;
  const S1P_IMAGE_VIEWER_OPEN_PANEL_DELAY_MS =
    S1P_IMAGE_VIEWER_OPEN_CLOSE_ANIMATION_MS;
  const S1P_IMAGE_VIEWER_CLOSE_OVERLAY_DELAY_MS =
    S1P_IMAGE_VIEWER_OPEN_CLOSE_ANIMATION_MS;
  const S1P_IMAGE_VIEWER_SWITCH_ANIMATION_MS = 220;
  const S1P_IMAGE_VIEWER_NAV_AUTO_HIDE_MS = 1400;
  const S1P_IMAGE_VIEWER_NAV_LEAVE_HIDE_MS = 220;
  const S1P_IMAGE_VIEWER_NAV_MOVE_THROTTLE_MS = 120;
  const normalizeImagePreviewLimitValue = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    const rounded = Math.round(parsed);
    return Math.min(
      IMAGE_PREVIEW_LIMIT_MAX,
      Math.max(IMAGE_PREVIEW_LIMIT_MIN, rounded)
    );
  };
  const normalizeBooleanWithDefault = (value, defaultValue = true) =>
    typeof value === "boolean" ? value : defaultValue;
  const resolveImagePreviewLimitState = (rawSettings = {}) => {
    const source = sanitizeRecordObject(rawSettings);
    return {
      enableGeneralSettings: normalizeBooleanWithDefault(
        source.enableGeneralSettings,
        true
      ),
      limitImagesBySize: normalizeBooleanWithDefault(
        source.limitImagesBySize,
        true
      ),
      imagePreviewMaxWidth: normalizeImagePreviewLimitValue(
        source.imagePreviewMaxWidth,
        IMAGE_PREVIEW_DEFAULT_WIDTH
      ),
      imagePreviewMaxHeight: normalizeImagePreviewLimitValue(
        source.imagePreviewMaxHeight,
        IMAGE_PREVIEW_DEFAULT_HEIGHT
      ),
    };
  };
  const applyImagePreviewLimitRootState = (state = {}) => {
    const rootElement = document.documentElement;
    if (!rootElement) return;
    rootElement.style.setProperty(
      "--s1p-image-preview-max-width",
      `${state.imagePreviewMaxWidth}px`
    );
    rootElement.style.setProperty(
      "--s1p-image-preview-max-height",
      `${state.imagePreviewMaxHeight}px`
    );
    rootElement.classList.toggle(
      IMAGE_PREVIEW_LIMIT_ROOT_CLASS,
      state.enableGeneralSettings === true && state.limitImagesBySize === true
    );
  };
  const applyEarlyImagePreviewLimitRootState = () => {
    const rawSettings = GM_getValue("s1p_settings", {});
    const normalizedState = resolveImagePreviewLimitState(rawSettings);
    applyImagePreviewLimitRootState(normalizedState);
  };
  if (!IS_S1P_TEST_MODE) {
    applyEarlyImagePreviewLimitRootState();
  }

  let readProgressListRefreshTimer = null;
  let pendingReadProgressDataForRefresh = null;

  let localDataHashCache = {
    cacheKey: null,
    contentHash: null,
    baseContentHash: null,
  };

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

  // 构建同步数据快照，确保导出期间不受后续就地写入影响。
  const deepCloneSyncValue = (value) => {
    if (typeof value !== "object" || value === null) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => deepCloneSyncValue(item));
    }
    const cloned = {};
    Object.keys(value).forEach((key) => {
      cloned[key] = deepCloneSyncValue(value[key]);
    });
    return cloned;
  };
  const SVG_ICON_DELETE_DEFAULT = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='%23374151'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0' /%3E%3C/svg%3E`;
  const SVG_ICON_DELETE_HOVER = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke-width='1.5' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0' /%3E%3C/svg%3E`;
  const SVG_ICON_ARROW_MASK = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 16'%3E%3Cpath d='M2 2L8 8L2 14' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E`;
  const SVG_ICON_EYE = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>`;
  const SVG_ICON_EYE_SLASH = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>`;
  const SVG_ICON_EXTERNAL_LINK = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>`;

  // --- 帖子楼层工具栏图标 ---
  const TOOLBAR_ICONS = {
    // 只看该用户 - 眼睛图标 (Thickened 0.5)
    viewAuthor: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M12 3C17.3917 3 21.8778 6.87976 22.8194 12C21.8778 17.1202 17.3917 21 12 21C6.60828 21 2.12226 17.1202 1.18055 12C2.12226 6.87976 6.60828 3 12 3ZM12 19C16.2355 19 19.8602 16.0521 20.7773 12C19.8602 7.94792 16.2355 5 12 5C7.76454 5 4.13984 7.94792 3.22266 12C4.13984 16.0521 7.76454 19 12 19ZM12 16.5C9.51468 16.5 7.49997 14.4853 7.49997 12C7.49997 9.51472 9.51468 7.5 12 7.5C14.4852 7.5 16.5 9.51472 16.5 12C16.5 14.4853 14.4852 16.5 12 16.5ZM12 14.5C13.3807 14.5 14.5 13.3807 14.5 12C14.5 10.6193 13.3807 9.5 12 9.5C10.6193 9.5 9.49997 10.6193 9.49997 12C9.49997 13.3807 10.6193 14.5 12 14.5Z"></path></svg>`,
    // 收藏回复 - 书签图标 (Thickened 0.5)
    bookmark: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M5 2H19C19.5523 2 20 2.44772 20 3V21.1433C20 21.4194 19.7761 21.6434 19.5 21.6434C19.4061 21.6434 19.314 21.6168 19.2344 21.5669L12 16.8968L4.76559 21.5669C4.53163 21.7136 4.22306 21.6429 4.07637 21.4089C4.02647 21.3293 4 21.2373 4 21.1433V3C4 2.44772 4.44772 2 5 2ZM18 4H6V18.4324L12 14.6577L18 18.4324V4Z"></path></svg>`,
    // 收藏回复（已收藏）- 实心书签图标 (Thickened 0.5)
    bookmarked: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M5 2H19C19.5523 2 20 2.44772 20 3V21.1433C20 21.4194 19.7761 21.6434 19.5 21.6434C19.4061 21.6434 19.314 21.6168 19.2344 21.5669L12 16.8968L4.76559 21.5669C4.53163 21.7136 4.22306 21.6429 4.07637 21.4089C4.02647 21.3293 4 21.2373 4 21.1433V3C4 2.44772 4.44772 2 5 2Z"></path></svg>`,
    // 屏蔽用户 - 用户禁止图标 (Thickened 0.5)
    blockUser: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M8 7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7C16 9.20914 14.2091 11 12 11C9.79086 11 8 9.20914 8 7ZM12 1C8.68629 1 6 3.68629 6 7C6 10.3137 8.68629 13 12 13C15.3137 13 18 10.3137 18 7C18 3.68629 15.3137 1 12 1ZM15 18C15 16.3431 16.3431 15 18 15C18.4631 15 18.9018 15.105 19.2934 15.2924L15.2924 19.2934C15.105 18.9018 15 18.4631 15 18ZM16.7066 20.7076L20.7076 16.7066C20.895 17.0982 21 17.5369 21 18C21 19.6569 19.6569 21 18 21C17.5369 21 17.0982 20.895 16.7066 20.7076ZM18 13C15.2386 13 13 15.2386 13 18C13 20.7614 15.2386 23 18 23C20.7614 23 23 20.7614 23 18C23 15.2386 20.7614 13 18 13ZM12 14C12.0843 14 12.1683 14.0013 12.252 14.0039C11.8236 14.6189 11.4914 15.3059 11.2772 16.0431C8.30431 16.4 6 18.9309 6 22H4C4 17.5817 7.58172 14 12 14Z"></path></svg>`,
    // 屏蔽楼层 - 评论关闭图标 (Thickened 0.5)
    blockPost: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M2.80777 1.3934L22.6068 21.1924L21.1925 22.6066L17.5846 18.9994L6.45516 19L2.00016 22.5V4C2.00016 3.8307 2.04223 3.67123 2.11649 3.53146L1.39355 2.80762L2.80777 1.3934ZM3.99955 5.4134L4.00016 18.3853L5.76349 17L15.5846 16.9994L3.99955 5.4134ZM21.0002 3C21.5524 3 22.0002 3.44772 22.0002 4V17.785L20.0002 15.785V5L9.21316 4.999L7.21416 3H21.0002Z"></path></svg>`,
    // 标记用户 - 标签图标 (Thickened 0.5)
    tagUser: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M10.9042 2.10025L20.8037 3.51446L22.2179 13.414L13.0255 22.6063C12.635 22.9969 12.0019 22.9969 11.6113 22.6063L1.71184 12.7069C1.32131 12.3163 1.32131 11.6832 1.71184 11.2926L10.9042 2.10025ZM11.6113 4.22157L3.83316 11.9997L12.3184 20.485L20.0966 12.7069L19.036 5.28223L11.6113 4.22157ZM13.7327 10.5855C12.9516 9.80448 12.9516 8.53815 13.7327 7.7571C14.5137 6.97606 15.78 6.97606 16.5611 7.7571C17.3421 8.53815 17.3421 9.80448 16.5611 10.5855C15.78 11.3666 14.5137 11.3666 13.7327 10.5855Z"></path></svg>`,
    // 编辑回复 - 铅笔图标 (Thickened 0.5)
    editPost: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M16.7574 2.99678L14.7574 4.99678H5V18.9968H19V9.23943L21 7.23943V19.9968C21 20.5491 20.5523 20.9968 20 20.9968H4C3.44772 20.9968 3 20.5491 3 19.9968V3.99678C3 3.4445 3.44772 2.99678 4 2.99678H16.7574ZM20.4853 2.09729L21.8995 3.5115L12.7071 12.7039L11.2954 12.7064L11.2929 11.2897L20.4853 2.09729Z"></path></svg>`,
    // 显示全部楼层 - 列表图标 (Thickened 0.5)
    showAll: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M8 4H21V6H8V4ZM3 3.5H6V6.5H3V3.5ZM3 10.5H6V13.5H3V10.5ZM3 17.5H6V20.5H3V17.5ZM8 11H21V13H8V11ZM8 18H21V20H8V18Z"></path></svg>`,
    // 正序看帖 - 箭头向下 (Thickened 0.5)
    sortAsc: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 20 20" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M13 5V16.17L17.59 11.58L19 13L12 20L5 13L6.41 11.59L11 16.17V5H13Z"></path></svg>`,
    // 倒序看帖 - 箭头向上 (Thickened 0.5)
    sortDesc: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 20 20" fill="currentColor" stroke="currentColor" stroke-width="0.5"><path d="M13 19V7.83L17.59 12.42L19 11L12 4L5 11L6.41 12.41L11 7.83V19H13Z"></path></svg>`,
  };

  GM_addStyle(`
    /* --- 通用颜色 --- */
    :root {
      /* -- 基础调色板 -- */
      --s1p-bg: #ecedeb;
      --s1p-pri: #d1d9c1;
      --s1p-sub: #e9ebe8;
      --s1p-white: #ffffff;
      --s1p-black-rgb: 0, 0, 0;
      --s1p-border: #d1d5db;
      --s1p-hover-overlay: rgba(0, 0, 0, 0.08);

      /* -- [新增] 阴影 -- */
      --s1p-shadow-color-rgb: 0, 0, 0;

      /* -- 主题色 -- */
      --s1p-t: #022c80;
      --s1p-desc-t: #10388a;
      --s1p-sec: #2563eb;
      --s1p-sec-h: #306bebff;
      --s1p-sub-h: #2563eb;
      --s1p-sub-h-t: var(--s1p-white);

      /* -- 状态色 -- */
      --s1p-red: #ef4444;
      --s1p-red-h: #dc2626;
      --s1p-green: #22c55e;
      --s1p-green-h: #28b05aff;
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
      --s1p-readprogress-bg: #b8d56f;

      --s1p-list-item-status-bg: #dddddd;
      --s1p-list-item-status-text: #022c80;

      /* -- 阅读进度 -- */
      --s1p-progress-hot: rgb(192, 51, 34);
      --s1p-progress-cold: rgb(107, 114, 128);
      --s1p-progress-delete-bg: var(--s1p-progress-hot);
      --s1p-progress-delete-hover-bg: rgb(154, 41, 28);
      --s1p-progress-delete-text: #ffffff;

      /* -- 用户标记颜色 -- */
      --s1p-tag-red: #EF4444;
      --s1p-tag-orange: #F97316;
      --s1p-tag-yellow: #EAB308;
      --s1p-tag-green: #22C55E;
      --s1p-tag-blue: #3B82F6;
      --s1p-tag-purple: #8B5CF6;
      
      /* -- [新增] 用户名高亮 -- */
      --s1p-username-bg: #bccda8; /* Sage Green */
      --s1p-username-text: #0b2163; /* Dark Blue */
      --s1p-image-preview-max-width: 800px;
      --s1p-image-preview-max-height: 1200px;
      --s1p-image-viewer-viewport-bg: #d4ddce;
      /* 帖子工具栏二级菜单层级：保持低于 Discuz 原生回复弹窗 #fwin_reply (z-index: 201) */
      --s1p-post-toolbar-layer-z: 180;

    }

    /* --- [新增的功能] 系统屏蔽楼层隐藏 --- */
    html.s1p-hide-system-blocked-enabled table.plhin:has(.locked) {
      display: none !important;
    }
    .s1p-system-blocked-fallback-hidden {
      display: none !important;
    }
    .s1p-hidden-blocked-rating-block {
      display: none !important;
    }


    @keyframes s1p-tab-fade-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes s1p-fade-in-down {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes s1p-fade-out-up {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(-10px);
      }
    }

    /* --- [新增] 用户备注样式 (适配自定义Popvoer) --- */
    .s1p-user-remark-display {
      font-size: 12px;
      color: var(--s1p-desc-t);
      /* max-width: 150px; 移除最大宽度限制 */
      overflow: hidden; 
      text-overflow: ellipsis; 
      white-space: nowrap;
      display: inline-block;
      vertical-align: middle;
      cursor: default;
      /* 增加一点样式以示区别 */
      background: rgba(0, 0, 0, 0.03);
      padding: 0 4px;
      border-radius: 4px;
      max-width: 100%; /* 确保不超过容器宽度 */
    }
    .s1p-profile-block-user-wrap {
      margin-top: 8px;
    }
    .s1p-profile-block-user-wrap .s1p-profile-block-user-btn {
      font-weight: 600;
      padding: 4px 12px;
    }
    .s1p-profile-block-user-btn.is-blocked {
      cursor: pointer;
    }

    /* --- [FIX] 导航栏垂直居中对齐修正 ---
    * 仅在宽屏启用，避免干扰 S1 NUX 窄屏下的悬浮导航交互逻辑。
    */
    @media (min-width: ${NARROW_SCREEN_MAX_WIDTH_PX + 1}px) {
      #nv > ul {
        display: flex !important;
        align-items: center !important;
      }
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
      stroke-width: 0.6px; /* 描边宽度，可调整此值改变加粗程度 */
      stroke-linejoin: round; /* 让描边的边角更平滑 */
    }
    #s1p-nav-sync-btn a:hover svg {
      color: var(--s1p-t);
      transform: scale(1.1);
    }

    /* --- [核心修复] 针对 S1 NUX 窄屏模式的兼容性适配 --- */
    @media (max-width: ${NARROW_SCREEN_MAX_WIDTH_PX}px) {
      #nv ul #s1p-nav-sync-btn {
        margin-left: 0 !important; /* 移除外边距，解决背景断裂问题 */
      }
      #nv ul #s1p-nav-sync-btn a {
        /* [修改] 增加了左侧内边距，使其与左侧按钮的视觉间距更协调 */
        padding: 0 4px 0 8px !important;
      }
      #nv ul #s1p-nav-auto-sync-indicator {
        margin-left: 0 !important;
      }
      #nv ul #s1p-nav-auto-sync-indicator .s1p-nav-auto-sync-indicator-wrap {
        padding: 0 4px 0 6px !important;
      }
    }

    /* --- [MODIFIED] 最终简化版同步动画 (只有旋转) --- */
    @keyframes s1p-sync-simple-rotate {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
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

    #s1p-nav-auto-sync-indicator {
      flex-shrink: 0;
      margin-left: 0;
      opacity: 1;
    }
    #s1p-nav-auto-sync-indicator .s1p-nav-auto-sync-indicator-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 0 3px;
      box-sizing: border-box;
      cursor: default;
    }
    #s1p-nav-auto-sync-indicator .s1p-nav-auto-sync-indicator-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
    }
    #s1p-nav-auto-sync-indicator svg {
      width: 16px;
      height: 16px;
      color: var(--t, var(--s1p-t));
      transition: opacity 0.25s ease;
      position: relative;
      top: 1.5px;
      vector-effect: non-scaling-stroke;
      shape-rendering: geometricPrecision;
    }
    #s1p-nav-auto-sync-indicator svg path {
      stroke: currentColor;
      stroke-width: 0.6px;
      stroke-linejoin: round;
    }
    #s1p-nav-auto-sync-indicator[data-sync-state="idle"] svg {
      opacity: 1;
    }
    #s1p-nav-auto-sync-indicator[data-sync-state="pending"] svg {
      opacity: 1;
    }
    #s1p-nav-auto-sync-indicator[data-sync-state="running"] svg {
      opacity: 1;
    }
    #s1p-nav-auto-sync-indicator[data-sync-state="success"] svg {
      opacity: 1;
    }
    #s1p-nav-auto-sync-indicator[data-sync-state="failure"] svg,
    #s1p-nav-auto-sync-indicator[data-sync-state="conflict"] svg {
      opacity: 1;
    }

    @keyframes s1p-auto-sync-dot-bounce {
      0%, 80%, 100% {
        transform: translateY(0);
        opacity: 0.4;
      }
      40% {
        transform: translateY(-1.8px);
        opacity: 1;
      }
    }
    #s1p-nav-auto-sync-indicator svg.s1p-auto-sync-running .s1p-dot {
      animation: s1p-auto-sync-dot-bounce 1s ease-in-out infinite;
      transform-origin: center;
    }
    #s1p-nav-auto-sync-indicator svg.s1p-auto-sync-running .s1p-dot:nth-child(1) {
      animation-delay: 0s;
    }
    #s1p-nav-auto-sync-indicator svg.s1p-auto-sync-running .s1p-dot:nth-child(2) {
      animation-delay: 0.16s;
    }
    #s1p-nav-auto-sync-indicator svg.s1p-auto-sync-running .s1p-dot:nth-child(3) {
      animation-delay: 0.32s;
    }

    /* 顶栏“帖子”快捷入口：与 NUX 顶栏悬停展开交互保持一致 */
    #um #s1p-my-threads-link {
      order: -1;
      margin: 0;
      font-size: 0;
      white-space: nowrap;
    }
    #um:hover #s1p-my-threads-link {
      margin-right: 8px;
      font-size: 13px;
    }

    /* --- 手动同步弹窗样式 --- */
    .s1p-sync-choice-info {
      background-color: var(--s1p-sub);
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

    /* --- [MODIFIED V3] 手动同步对比弹窗样式 (美化版) --- */
    .s1p-sync-last-action {
      font-size: 13px;
      color: var(--s1p-desc-t);
      text-align: center;
      margin: 12px 0 4px 0;
      padding: 8px;
      background-color: var(--s1p-sub);
      border-radius: 6px;
    }
    .s1p-sync-comparison-table {
      margin-top: 16px;
      border: 1px solid var(--s1p-pri);
      border-radius: 8px;
      overflow: hidden;
      font-size: 14px;
    }
    .s1p-sync-comparison-row {
      display: grid;
      grid-template-columns: auto 1fr 1fr; /* <-- [核心修改] 使用 auto 关键字 */
      align-items: center;
      border-bottom: 1px solid var(--s1p-pri);
      transition: background-color 0.2s ease;
    }
    .s1p-sync-comparison-row:last-child {
      border-bottom: none;
    }
    /* 斑马条纹效果 */
    .s1p-sync-comparison-row:nth-child(even) {
      background-color: var(--s1p-sub);
    }
    .s1p-sync-comparison-row:hover {
      background-color: var(--s1p-pri);
    }
    /* 表头样式 */
    .s1p-sync-comparison-header {
      font-weight: 600;
      background-color: var(--s1p-pri) !important;
      color: var(--s1p-t);
      border-bottom: 1px solid var(--s1p-pri);
    }
    .s1p-sync-comparison-header > div {
      padding: 10px 14px;
      text-align: center;
    }
    .s1p-sync-comparison-header > div:first-child {
      text-align: left;
    }
    /* 单元格样式 */
    .s1p-sync-comparison-label,
    .s1p-sync-comparison-value {
      padding: 10px 14px;
    }
    .s1p-sync-comparison-label {
      font-weight: 500;
      color: var(--s1p-t);
      white-space: nowrap;
      font-size: 13px;
    }
    .s1p-sync-comparison-value {
      /* [S1P-FIX] 使用 Flexbox 实现完美的垂直居中对齐 */
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px; /* 使用 gap 定义元素间距，比 margin 更现代 */
      font-family: monospace, sans-serif;
      font-size: 13px;
    }
    .s1p-newer-badge {
      /* [S1P-FIX V4] 统一字体以解决跨平台对齐根源问题 */
      font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei",
        sans-serif;
      color: var(--s1p-success-text);
      font-weight: bold;
      font-size: 12px;
      position: relative;
      /* [S1P-FIX V4] 统一为在 Windows 上视觉对齐的偏移值 */
      top: -1px;
    }
    /* --- [新增] 为手动同步弹窗设定更宽的尺寸 --- */
    .s1p-sync-modal .s1p-confirm-content {
      width: 580px;
    }

    .s1p-progress-update-badge {
      font-size: 12px;
      font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei",
        sans-serif;
      color: var(--s1p-sec);
      font-weight: bold;
      /* [S1P-FIX V4] 统一为在 Windows 上视觉对齐的偏移值 */
      position: relative;
      top: -1px;
      /* margin-left 已被父元素的 gap 替代 */
      /* vertical-align 在 Flexbox 布局中无效 */
    }
    .s1p-sync-conflict-title {
      color: var(--s1p-red);
    }
    .s1p-sync-danger-text {
      color: var(--s1p-red);
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
    .s1p-notice-top16 {
      margin-top: 16px;
    }
    .s1p-notice-gap8 {
      gap: 8px;
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
      box-shadow: 0 1px 3px rgba(var(--s1p-shadow-color-rgb), 0.1);
      transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .s1p-segmented-control:hover .s1p-segmented-control-slider {
      box-shadow: 0 2px 6px rgba(var(--s1p-shadow-color-rgb), 0.15);
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
    /* S1 NUX 部分深色主题下，分段控件激活项改用深色文字以提升对比度 */
    .s1p-modal.s1p-nux-segmented-contrast-fix .s1p-segmented-control-option.active {
      color: var(--s1p-segmented-active-contrast-text, var(--icl, #111827));
      text-shadow: none;
    }
    /* S1 NUX 酒红主题下，强化标签页激活态与非激活态对比 */
    .s1p-modal.s1p-nux-vine-tab-tone .s1p-tabs {
      background-color: var(--pri, #953a55);
    }
    .s1p-modal.s1p-nux-vine-tab-tone .s1p-tab-btn {
      color: var(--tg, #a6949d);
    }
    .s1p-modal.s1p-nux-vine-tab-tone .s1p-tab-btn:hover:not(.active) {
      color: var(--tl, #ece0e5);
      background-color: rgba(0, 0, 0, 0.12);
    }
    .s1p-modal.s1p-nux-vine-tab-tone .s1p-tab-slider {
      background-color: #7c3046;
    }
    .s1p-modal.s1p-nux-vine-tab-tone .s1p-tab-btn.active {
      color: #fff6fb;
    }

    /* --- [S1PLUS-MOD] 帖子列表最终布局修正 --- */
    /* [MODIFIED] 此处已移除隐藏 .icn 和 .icn_new 的样式规则 */
    #atarget,
    a.closeprev.y[title="隐藏置顶帖"] {
      display: none !important;
    }

    /* 2. 为脚本注入的“操作列”及“表头占位符”提供统一、明确的样式 */
    #threadlisttableid .th .s1p-header-placeholder {
      width: 32px !important;
      padding: 0 8px !important;
      box-sizing: border-box !important;
    }
    .s1p-options-cell {
      position: relative;
      text-align: center;
      vertical-align: middle;
      width: 20px !important;
      padding: 0px !important;
      box-sizing: border-box !important;
    }

    /* --- 核心修复与通用布局 --- */
    #p_pop {
      display: none !important;
    }

    /* 1. [核心修正] 精确隐藏作为“空白分隔符”的 separatorline，
        通过 .emptb 类来识别，避免隐藏“版块主题”行。*/
    #separatorline.emptb {
      display: none !important;
    }

    /* 3. 统一所有列的对齐方式为左对齐，以匹配原始样式 */
    #threadlisttableid td.by,
    #threadlisttableid td.num,
    #threadlisttableid .th .by,
    #threadlisttableid .th .num {
      text-align: left !important;
    }

    /* --- 关键字屏蔽样式 --- */
    .s1p-hidden-by-keyword,
    .s1p-hidden-by-quote {
      display: none !important;
    }

    /* --- 按钮通用样式 (V4 - 精致阴影与安全区适配) --- */
    .s1p-btn,
    .s1p-confirm-btn,
    .s1p-inline-toggle-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 14px;
      border-radius: 6px;
      background-color: var(--s1p-sub);
      color: var(--s1p-t);
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      border: none;
      /* [MODIFIED] 采用更收敛、精致的默认阴影，并微调Y轴位移 */
      box-shadow: 0 1px 2px rgba(var(--s1p-shadow-color-rgb), 0.12);
      transform: translateY(-1px);
      /* [MODIFIED] 优化过渡动画曲线，使其更平滑 */
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .s1p-btn:hover,
    .s1p-confirm-btn:hover,
    .s1p-inline-toggle-btn:hover {
      background-color: var(--s1p-sub-h);
      color: var(--s1p-sub-h-t);
      /* [MODIFIED] 同样采用更收敛的悬停阴影，并微调Y轴位移 */
      transform: translateY(-3px);
      box-shadow: 0 3px 6px rgba(var(--s1p-shadow-color-rgb), 0.18);
    }

    /* --- [MODIFIED] 危险/红色按钮样式 - 仅在高亮时变色 --- */

    /* * 注意：原有的 .s1p-red-btn 默认红色样式已被移除。
    * 现在，所有带 .s1p-red-btn 或 .s1p-danger 类的按钮，
    * 在默认状态下都将显示上方 .s1p-btn 定义的通用灰色样式。
    */

    /* [MODIFIED] 将所有危险/红色按钮的变色逻辑统一到 hover 状态 */
    .s1p-btn.s1p-red-btn:hover,
    .s1p-btn.s1p-danger:hover,
    .s1p-confirm-btn.s1p-confirm:hover {
      background-color: var(--s1p-red-h); /* 使用更深的红色作为悬停色 */
      border-color: transparent; /* 确保没有边框颜色 */
      color: var(--s1p-white);
    }

    /* --- 帖子操作按钮 (三点图标) --- */
    .s1p-options-btn {
      position: relative; /* 为 ::after 伪元素提供定位上下文 */
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
    /* [S1PLUS-REPLACE-BLOCK] */
    /* [MODIFIED] 创建一个透明的“交互桥梁”，覆盖按钮和菜单之间的物理间隙 */
    .s1p-options-btn::after {
      content: '';
      position: absolute;
      top: 0;
      right: 100%; /* [S1P-MODIFIED] 从 left 改为 right，适配右侧按钮 */
      width: 2px; /* [核心修改] 大幅缩减桥梁宽度，防止其影响旁边的元素 */
      height: 100%;
    }
    .s1p-options-btn:hover {
      background-color: var(--s1p-pri);
      color: var(--s1p-t);
      opacity: 1;
    }
    .s1p-options-menu {
      position: absolute;
      top: 50%;
      right: 100%; /* [S1P-MODIFIED] 从 left 改为 right，让菜单在按钮左侧弹出 */
      /* [S1P-FIX] 移除 margin-left，将间距改为 padding-right，从而消除按钮和菜单间的交互断层 */
      margin-left: 0;
      transform: translateY(-50%);
      z-index: 10;
      background-color: var(--s1p-bg);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(var(--s1p-shadow-color-rgb), 0.1);
      /* [S1P-MODIFIED] 将内边距调整到右侧，以在视觉上保持间距 */
      padding: 5px 11px 5px 5px;
      min-width: 110px;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 0.15s ease-out, visibility 0.15s;
    }
    /* 当左侧空间不足时，让帖子列表确认菜单改为向右弹出 */
    .s1p-options-cell.s1p-open-right:hover > .s1p-options-btn::after {
      left: 100%;
      right: auto;
    }
    .s1p-options-cell.s1p-open-right:hover > .s1p-options-menu {
      left: 100%;
      right: auto;
      padding: 5px 5px 5px 11px;
    }
    /* [修改] 将菜单的触发条件改为悬停图标按钮，并让菜单自身在悬停时保持显示 */
    .s1p-options-btn:hover + .s1p-options-menu,
    .s1p-options-menu:hover {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }

    /* --- [MODIFIED] 统一确认UI (去除边框，优化间距) --- */
    .s1p-confirm-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 6px;
      font-size: 13px;
      color: var(--s1p-t);
      white-space: nowrap;
    }
    .s1p-confirm-bar.s1p-confirm-bar-text-first {
      padding-left: 12px;
    }
    .s1p-confirm-bar.s1p-has-expander .s1p-confirm-text {
      flex: 1;
      min-width: 0;
    }
    .s1p-confirm-separator {
      border-left: 1px solid var(--s1p-pri);
      height: 16px; /* 减小高度 */
      margin: 0 2px 0 6px;
    }
    .s1p-confirm-action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px; /* 减小尺寸 */
      height: 28px; /* 减小尺寸 */
      border: none;
      border-radius: 50%;
      cursor: pointer;
      transition: background-color 0.2s ease, transform 0.1s ease,
        background-image 0.2s ease;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 55%; /* 减小图标大小 */
      flex-shrink: 0;
    }
    .s1p-confirm-action-btn:active {
      transform: scale(0.95);
    }
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

    /* --- [MODIFIED] 统一确认菜单容器 (去除间距以统一高度) --- */
    .s1p-confirm-wrapper {
      padding: 0 !important;
      background-color: var(--s1p-bg);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(var(--s1p-shadow-color-rgb), 0.15);
      border: none !important;
    }
    .s1p-confirm-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .s1p-confirm-card {
      background-color: var(--s1p-bg);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(var(--s1p-shadow-color-rgb), 0.15);
      border: none;
      overflow: hidden;
    }
    .s1p-inline-confirm-menu.s1p-has-remark-input {
      background: transparent !important;
      box-shadow: none !important;
      border: none !important;
    }
    .s1p-inline-confirm-menu.s1p-has-remark-input .s1p-confirm-container {
      gap: 12px;
    }
    .s1p-confirm-expand-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--s1p-t);
      cursor: pointer;
      padding: 0;
      margin-right: 2px;
      flex-shrink: 0;
      transition: transform 0.2s ease, background-color 0.2s ease;
    }
    .s1p-confirm-expand-btn:hover {
      background-color: var(--s1p-hover-bg);
    }
    .s1p-confirm-expand-btn.expanded {
      transform: rotate(90deg);
    }
    .s1p-confirm-expand-btn svg {
      width: 16px;
      height: 16px;
    }

    .s1p-options-menu.s1p-inline-confirm-menu {
      transform: translateY(0) !important;
      z-index: 10004;
      opacity: 0;
      transform: translateX(-8px) scale(0.95) !important;
      transition: opacity 0.15s ease-out, transform 0.15s ease-out;
      pointer-events: none;
      visibility: visible !important;
    }
    .s1p-options-menu.s1p-inline-confirm-menu[data-s1p-scope="post-toolbar"] {
      z-index: var(--s1p-post-toolbar-layer-z);
    }

    .s1p-inline-confirm-menu.visible {
      opacity: 1;
      transform: translateX(0) scale(1) !important;
      pointer-events: auto;
    }

    .s1p-confirm-remark-area {
      padding: 12px;
      display: none;
      animation: s1p-fade-in-down 0.2s ease forwards;
    }

    .s1p-confirm-text {
      font-size: 13px;
      color: var(--s1p-t);
      font-weight: normal;
    }
    .s1p-confirm-action-btn.s1p-thread-block-author-btn {
      background-color: transparent;
      color: var(--s1p-icon-color);
    }
    .s1p-confirm-action-btn.s1p-thread-block-author-btn svg {
      width: 16px;
      height: 16px;
      display: block;
      pointer-events: none;
    }
    .s1p-confirm-action-btn.s1p-thread-block-author-btn:hover {
      background-color: var(--s1p-pri);
      color: var(--s1p-red);
    }
    .s1p-confirm-action-btn.s1p-thread-block-author-btn.s1p-selected {
      background-color: transparent;
      color: var(--s1p-red);
    }
    .s1p-confirm-action-btn.s1p-thread-block-author-btn.s1p-selected:hover {
      background-color: var(--s1p-pri);
      color: var(--s1p-red-h);
    }

    /* --- [NEW] Inline Action Menu --- */
    .s1p-inline-action-menu {
      position: absolute;
      z-index: 10004;
      display: flex;
      align-items: center;
      gap: 4px;
      background-color: var(--s1p-bg);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(var(--s1p-shadow-color-rgb), 0.1);
      padding: 5px;
      opacity: 0;
      visibility: hidden;
      transform: translateY(5px) scale(0.95);
      transition: opacity 0.15s ease-out, transform 0.15s ease-out,
        visibility 0.15s;
      pointer-events: none;
    }
    .s1p-inline-action-menu[data-s1p-scope="post-toolbar"] {
      z-index: var(--s1p-post-toolbar-layer-z);
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
      border-radius: 6px;
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
      content: "";
      display: inline-block;
      width: 1.1em;
      height: 1.1em;
      background-color: currentColor;
      mask-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3e%3cpath d='M19 15l-6 6-1.42-1.42L15.17 16H4V4h2v10h9.17l-3.59-3.58L13 9l6 6z' fill='black'/%3e%3c/svg%3e");
      mask-size: contain;
      mask-repeat: no-repeat;
      mask-position: center;
    }
    .s1p-progress-delete-btn {
      width: 0;
      box-sizing: border-box;
      margin-left: 0;
      padding: 1px 0;
      border: 0 solid var(--s1p-progress-delete-bg);
      border-radius: 4px;
      background: var(--s1p-progress-delete-bg);
      color: var(--s1p-progress-delete-text);
      font-size: 12px;
      font-weight: bold;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      cursor: pointer;
      transition: width 0.2s ease, opacity 0.2s ease, margin-left 0.2s ease,
        border-width 0.2s ease, padding 0.2s ease;
    }
    .s1p-progress-container.s1p-show-delete-btn .s1p-progress-delete-btn {
      width: 44px;
      margin-left: 4px;
      padding: 1px 6px;
      border-width: 1px;
      opacity: 1;
      pointer-events: auto;
    }
    .s1p-progress-delete-btn:hover {
      background-color: var(--s1p-progress-delete-hover-bg);
      border-color: var(--s1p-progress-delete-hover-bg);
      color: var(--s1p-progress-delete-text);
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
    .s1p-progress-container .s1p-progress-jump-btn,
    .s1p-progress-container .s1p-new-replies-badge {
      transition: box-shadow 0.8s ease-out;
      box-shadow: 0 0 0 0 transparent;
    }
    .s1p-progress-container.s1p-progress-refresh-flash .s1p-progress-jump-btn {
      box-shadow: 0 0 4px 0 rgba(180, 80, 50, 0.18);
    }
    .s1p-progress-container.s1p-progress-refresh-flash .s1p-new-replies-badge {
      box-shadow: 0 0 4px 0 rgba(180, 80, 50, 0.18);
    }
    @media (prefers-reduced-motion: reduce) {
      .s1p-progress-container .s1p-progress-jump-btn,
      .s1p-progress-container .s1p-new-replies-badge {
        transition: none;
      }
      .s1p-progress-container.s1p-progress-refresh-flash .s1p-progress-jump-btn,
      .s1p-progress-container.s1p-progress-refresh-flash .s1p-new-replies-badge {
        box-shadow: none;
      }
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
      transition: border-color 0.2s ease-in-out,
        background-color 0.2s ease-in-out;
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

    /* --- [新增] 优化密码输入框样式 --- */
    #s1p-remote-pat-input {
      /* 统一字体栈，确保跨平台最佳渲染 */
      font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei",
        sans-serif;
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
      box-shadow: 0 4px 20px rgba(var(--s1p-shadow-color-rgb), 0.08);
      opacity: 0;
      visibility: hidden;
      transform: translateY(5px) scale(0.98);
      transition: opacity 0.2s ease-out, transform 0.2s ease-out,
        visibility 0.2s;
      pointer-events: none;
      font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei",
        sans-serif;
    }
    .s1p-tag-popover.visible {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    .s1p-tag-popover[data-s1p-scope="post-toolbar"] {
      z-index: var(--s1p-post-toolbar-layer-z);
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
      line-height: 1.6;
    }
    .s1p-username-highlight {
      background-color: var(--s1p-username-bg);
      color: var(--s1p-username-text);
      padding: 2px 6px;
      border-radius: 6px;
      margin: 0 4px;
      display: inline-block;
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
      box-shadow: 0 2px 10px rgba(var(--s1p-shadow-color-rgb), 0.12);
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
    .s1p-generic-display-popover[data-s1p-scope="post-toolbar"] {
      z-index: var(--s1p-post-toolbar-layer-z);
    }
    .s1p-generic-display-popover[data-s1p-scope="image-viewer"] {
      z-index: 100010;
    }
    /* --- [NEW] Date Picker Component --- */
    .s1p-date-picker {
      position: absolute;
      /* top/left managed by JS */
      width: 280px;
      background-color: var(--s1p-bg);
      border: 1px solid var(--s1p-border);
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(var(--s1p-shadow-color-rgb), 0.3);
      z-index: 20005; /* Above modal */
      padding: 16px;
      display: none;
      user-select: none;
    }
    .s1p-date-picker.visible {
      display: block;
      animation: s1p-fade-in 0.2s ease-out;
    }
    .s1p-dp-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .s1p-dp-title {
      font-weight: bold;
      color: var(--s1p-t);
      font-size: 16px;
      cursor: pointer;
    }
    .s1p-dp-nav-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--s1p-desc-t);
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .s1p-dp-nav-btn:hover {
      background-color: var(--s1p-sub-h);
      color: var(--s1p-sub-h-t);
    }
    .s1p-dp-nav-btn svg {
      width: 16px;
      height: 16px;
    }
    .s1p-dp-year-arrow-offset {
      display: inline-flex;
      margin-left: -10px;
    }
    .s1p-dp-weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      text-align: center;
      font-size: 12px;
      color: var(--s1p-desc-t);
      margin-bottom: 8px;
    }
    .s1p-dp-days {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
    }
    .s1p-dp-day {
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border-radius: 4px;
      font-size: 14px;
      color: var(--s1p-t);
      transition: all 0.1s ease;
    }
    .s1p-dp-day:hover {
      background-color: var(--s1p-sub-h);
      color: var(--s1p-sub-h-t);
    }
    .s1p-dp-day.selected {
      background-color: var(--s1p-pri);
      color: var(--s1p-t);
      font-weight: bold;
      border: 1px solid var(--s1p-pri);
    }
    .s1p-dp-day.today {
      border: 1px solid var(--s1p-sec);
    }
    .s1p-dp-day.today:hover {
        background-color: var(--s1p-sec);
        color: #fff;
    }
    .s1p-dp-day.empty {
      pointer-events: none;
      cursor: default;
    }
    .s1p-dp-day.other-month {
      color: var(--s1p-text-empty);
    }
    /* 仅作用于脚本接管的帖子头部布局，避免影响 NUX 窄屏的其他 .pi/.authi 区块 */
    #postlist .plc .pi.s1p-authi-layout {
      display: flex !important;
      align-items: center;
      gap: 8px;
      position: relative !important; /* <-- [新增] 为绝对定位的子元素提供定位上下文 */
    }
    #postlist .plc .pi.s1p-authi-layout > .pti {
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
    #postlist .plc .pi.s1p-authi-layout > strong {
      flex-shrink: 0;
      order: 4;
      visibility: hidden; /* <-- 核心修改：初始不可见 */
      transition: visibility 0s; /* 确保状态改变是瞬时的 */
    }
    #postlist .plc .pi.s1p-authi-layout > strong.s1p-layout-ready {
      visibility: visible; /* <-- 脚本添加此类后立即显示 */
    }
    #postlist .plc .pi.s1p-authi-layout > #fj {
      margin-left: 0;
      order: 5;
      flex-shrink: 0;
      position: static !important;
      z-index: auto !important;
    }
    #postlist .plc .authi.s1p-authi-layout {
      display: flex !important;
      align-items: center;
      flex-wrap: nowrap;
      overflow: hidden;
      white-space: nowrap !important;
    }

    /* 1. 最外层容器: flex布局，这是基础 */
    .s1p-authi-container {
      display: flex;
      align-items: center;
      min-width: 0;
      /* 与右侧工具图标使用同一水平节奏。 */
      --s1p-authi-action-inline-gap: 10px;
      /* 视觉补偿：首个图标有内边距，外侧额外补 5px 使观感更接近图标间距。 */
      --s1p-authi-leading-gap-optical-fix: 5px;
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
      margin-left: calc(
        var(--s1p-authi-action-inline-gap) + var(--s1p-authi-leading-gap-optical-fix)
      );
      gap: var(--s1p-authi-action-inline-gap);
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

    /* --- 工具栏图标按钮样式 --- */
    .s1p-authi-actions-wrapper > a.s1p-toolbar-icon-btn,
    .authi a.s1p-toolbar-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 2px;
      border-radius: 4px;
      color: inherit;
      opacity: 1;
      transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
    }
    .s1p-authi-actions-wrapper > a.s1p-toolbar-icon-btn:hover,
    .authi a.s1p-toolbar-icon-btn:hover {
      opacity: 1;
      background-color: var(--s1p-pri);
      color: var(--s1p-t);
    }
    .s1p-authi-actions-wrapper > a.s1p-toolbar-icon-btn svg,
    .authi a.s1p-toolbar-icon-btn svg {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
    }
    /* 已收藏状态 */
    .s1p-authi-actions-wrapper > a.s1p-toolbar-icon-btn.s1p-bookmarked {
      opacity: 1;
      color: var(--s1p-pri);
    }
    .s1p-authi-actions-wrapper > a.s1p-toolbar-icon-btn.s1p-bookmarked:hover {
      color: var(--s1p-t);
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

    /* --- 用户标记颜色样式 --- */
    .s1p-user-tag-container.s1p-tag-color-red .s1p-user-tag-display,
    .s1p-user-tag-container.s1p-tag-color-red .s1p-user-tag-options {
      background-color: var(--s1p-tag-red);
      color: var(--s1p-white);
    }
    .s1p-user-tag-container.s1p-tag-color-red .s1p-user-tag-options:hover {
      filter: brightness(0.9);
    }
    .s1p-user-tag-container.s1p-tag-color-orange .s1p-user-tag-display,
    .s1p-user-tag-container.s1p-tag-color-orange .s1p-user-tag-options {
      background-color: var(--s1p-tag-orange);
      color: var(--s1p-white);
    }
    .s1p-user-tag-container.s1p-tag-color-orange .s1p-user-tag-options:hover {
      filter: brightness(0.9);
    }
    .s1p-user-tag-container.s1p-tag-color-yellow .s1p-user-tag-display,
    .s1p-user-tag-container.s1p-tag-color-yellow .s1p-user-tag-options {
      background-color: var(--s1p-tag-yellow);
      color: #422006;
    }
    .s1p-user-tag-container.s1p-tag-color-yellow .s1p-user-tag-options:hover {
      filter: brightness(0.9);
    }
    .s1p-user-tag-container.s1p-tag-color-green .s1p-user-tag-display,
    .s1p-user-tag-container.s1p-tag-color-green .s1p-user-tag-options {
      background-color: var(--s1p-tag-green);
      color: var(--s1p-white);
    }
    .s1p-user-tag-container.s1p-tag-color-green .s1p-user-tag-options:hover {
      filter: brightness(0.9);
    }
    .s1p-user-tag-container.s1p-tag-color-blue .s1p-user-tag-display,
    .s1p-user-tag-container.s1p-tag-color-blue .s1p-user-tag-options {
      background-color: var(--s1p-tag-blue);
      color: var(--s1p-white);
    }
    .s1p-user-tag-container.s1p-tag-color-blue .s1p-user-tag-options:hover {
      filter: brightness(0.9);
    }
    .s1p-user-tag-container.s1p-tag-color-purple .s1p-user-tag-display,
    .s1p-user-tag-container.s1p-tag-color-purple .s1p-user-tag-options {
      background-color: var(--s1p-tag-purple);
      color: var(--s1p-white);
    }
    .s1p-user-tag-container.s1p-tag-color-purple .s1p-user-tag-options:hover {
      filter: brightness(0.9);
    }

    /* --- 颜色选择器样式 --- */
    .s1p-color-picker {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .s1p-color-picker-label {
      font-size: 13px;
      color: var(--s1p-desc-t);
      flex-shrink: 0;
    }
    .s1p-color-options {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .s1p-color-option {
      color: white; /* 默认选中标识为白色 (适配彩色背景) */
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    .s1p-color-option:hover {
      transform: scale(1.1);
    }
    .s1p-color-option.selected {
      border-color: var(--s1p-t);
      box-shadow: 0 0 0 2px var(--s1p-bg);
    }
    .s1p-color-option svg {
      width: 12px;
      height: 12px;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .s1p-color-option.selected svg {
      opacity: 1;
    }
    .s1p-color-option[data-color=""] {
      color: var(--s1p-t); /* 默认/透明背景选中标识为主题色 (适配浅色背景) */
      background-color: var(--s1p-sub);
      border: 2px solid var(--s1p-pri);
    }
    .s1p-color-option[data-color=""].selected {
      border-color: var(--s1p-t);
    }
    .s1p-color-option[data-color="red"] { background-color: var(--s1p-tag-red); }
    .s1p-color-option[data-color="orange"] { background-color: var(--s1p-tag-orange); }
    .s1p-color-option[data-color="yellow"] { background-color: var(--s1p-tag-yellow); }
    .s1p-color-option[data-color="green"] { background-color: var(--s1p-tag-green); }
    .s1p-color-option[data-color="blue"] { background-color: var(--s1p-tag-blue); }
    .s1p-color-option[data-color="purple"] { background-color: var(--s1p-tag-purple); }

    /* --- 历史标记列表样式 --- */
    .s1p-history-tags-container {
      margin-top: 12px;
      margin-bottom: 12px;
    }
    .s1p-history-tags-label {
      font-size: 13px;
      color: var(--s1p-desc-t);
      margin-bottom: 6px;
    }
    .s1p-history-tags-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-height: 200px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .s1p-history-tag-item {
      max-width: 120px;
      padding: 4px 10px;
      font-size: 12px;
      border-radius: 12px;
      background-color: var(--s1p-sub);
      color: var(--s1p-t);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: background-color 0.15s ease, transform 0.15s ease;
    }
    .s1p-history-tag-item:hover {
      background-color: var(--s1p-pri);
      transform: scale(1.02);
    }
    /* 历史标记颜色变体 */
    .s1p-history-tag-item[data-color="red"] { background-color: var(--s1p-tag-red); color: #fff; }
    .s1p-history-tag-item[data-color="orange"] { background-color: var(--s1p-tag-orange); color: #fff; }
    .s1p-history-tag-item[data-color="yellow"] { background-color: var(--s1p-tag-yellow); color: #333; }
    .s1p-history-tag-item[data-color="green"] { background-color: var(--s1p-tag-green); color: #fff; }
    .s1p-history-tag-item[data-color="blue"] { background-color: var(--s1p-tag-blue); color: #fff; }
    .s1p-history-tag-item[data-color="purple"] { background-color: var(--s1p-tag-purple); color: #fff; }
    .s1p-history-tag-item[data-color="red"]:hover { filter: brightness(1.1); }
    .s1p-history-tag-item[data-color="orange"]:hover { filter: brightness(1.1); }
    .s1p-history-tag-item[data-color="yellow"]:hover { filter: brightness(1.05); }
    .s1p-history-tag-item[data-color="green"]:hover { filter: brightness(1.1); }
    .s1p-history-tag-item[data-color="blue"]:hover { filter: brightness(1.1); }
    .s1p-history-tag-item[data-color="purple"]:hover { filter: brightness(1.1); }

    /* --- [MODIFIED] Tag Options Menu (高度比例调整) --- */
    .s1p-tag-options-menu {
      position: absolute;
      z-index: 10002;
      background-color: var(--s1p-bg);
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(var(--s1p-shadow-color-rgb), 0.15);
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: max-content;
    }
    .s1p-tag-options-menu[data-s1p-scope="post-toolbar"] {
      z-index: var(--s1p-post-toolbar-layer-z);
    }
    .s1p-tag-options-menu button {
      background: none;
      border: none;
      /* [MODIFIED] 增加垂直内边距，以达到目标高度 */
      padding: 8px 10px;
      text-align: left;
      cursor: pointer;
      border-radius: 4px;
      font-size: 13px;
      color: var(--s1p-t);
      white-space: nowrap;
      line-height: 1.5;
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
    .s1p-modal {
      display: flex;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(var(--s1p-black-rgb), 0.5);
      justify-content: center;
      align-items: center;
      z-index: 9999;
    }
    .s1p-modal-content {
      background-color: var(--s1p-bg);
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(var(--s1p-shadow-color-rgb), 0.1);
      width: 600px;
      max-width: 90%;
      max-height: 80vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      position: relative;

      /* [优化] 为设置面板设定统一的字体族和渲染方式 */
      /* 使用 system-ui 让浏览器自动选择各平台最佳系统字体 */
      /* Windows: Microsoft YaHei, macOS: PingFang SC, Linux: Noto Sans CJK */
      font-family: system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB",
        "Microsoft YaHei", "Segoe UI", Roboto, "Helvetica Neue", Arial,
        sans-serif;
      /* 移除 font-smoothing，让各平台使用默认的最优渲染方式 */
      /* macOS 默认使用 antialiased，Windows 默认使用 ClearType 子像素抗锯齿 */
    }
    .s1p-modal-header {
      background: var(--s1p-pri);
      padding: 16px;
      border-bottom: 1px solid var(--s1p-pri);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .s1p-modal-title {
      /* [优化 V2] 微调主标题尺寸 */
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.5px;
    }
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
    .s1p-modal-body {
      padding: 8px 16px 16px;
      overflow-y: auto;
      flex-grow: 1;
      /* --- [调试新增] --- */
      transition: height 0.35s cubic-bezier(0.4, 0, 0.2, 1);
      /* 暂时移除 flex-grow 以便手动控制高度 */
      flex-grow: 0;
    }
    .s1p-modal-footer {
      /* [MODIFIED] 增加上下内边距，为按钮阴影提供空间 */
      padding: 16px;
      border-top: 1px solid var(--s1p-pri);
      text-align: right;
      font-size: 12px;
    }
    .s1p-token-config-modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(var(--s1p-black-rgb), 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 20000;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .s1p-token-config-content {
      width: 400px;
      max-width: 90%;
      border-radius: 12px;
      border: 1px solid var(--s1p-border);
      box-shadow: 0 10px 25px rgba(var(--s1p-shadow-color-rgb), 0.3);
    }
    .s1p-token-config-header {
      background: var(--s1p-sub);
      border-bottom-color: var(--s1p-border);
      border-top-left-radius: 12px;
      border-top-right-radius: 12px;
    }
    .s1p-token-config-title {
      font-size: 16px;
      color: var(--s1p-t);
    }
    .s1p-token-config-body {
      padding: 20px;
      overflow-y: visible;
    }
    .s1p-token-config-desc {
      margin-top: 0;
    }
    .s1p-token-config-date-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      margin-top: 16px;
    }
    .s1p-token-config-date-input {
      width: 100%;
      cursor: pointer;
      background: var(--s1p-bg);
    }
    .s1p-token-config-quick-buttons {
      margin-top: 16px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .s1p-token-config-footer {
      border-top-color: var(--s1p-border);
      background: var(--s1p-sub);
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      border-bottom-left-radius: 12px;
      border-bottom-right-radius: 12px;
    }

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
      box-shadow: 0 1px 2px rgba(var(--s1p-shadow-color-rgb), 0.1);
    }
    .s1p-tab-content.active {
      display: block;
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
    .s1p-empty {
      text-align: center;
      padding: 24px;
      color: var(--s1p-desc-t);
    }
    .s1p-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .s1p-list-summary {
      margin: -4px 0 10px;
      color: var(--s1p-desc-t);
      font-size: 12px;
      line-height: 1.5;
    }
    /* 展开状态下的列表，移除顶部间距以更紧凑 */
    .s1p-thread-posts.expanded .s1p-list {
      margin-top: 0;
    }
    .s1p-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 12px;
      border-radius: 6px;
      background-color: var(--s1p-bg);
      border: 1px solid var(--s1p-pri);
    }
    .s1p-item-info {
      flex-grow: 1;
      min-width: 0;
    }
    .s1p-item-title {
      /* [优化] 统一列表项标题样式 */
      font-size: 15px;
      font-weight: 500;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .s1p-item-meta {
      /* [优化] 统一列表项元信息样式 */
      font-size: 12px;
      color: var(--s1p-desc-t);
    }
    /* [NEW] 帖子分组样式 */
    .s1p-thread-groups {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .s1p-thread-group {
      border: 1px solid var(--s1p-pri);
      border-radius: 6px;
      overflow: hidden;
    }
    .s1p-thread-header {
      padding: 12px;
      background-color: var(--s1p-bg);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      user-select: none;
      transition: background-color 0.2s;
    }
    .s1p-thread-header:hover {
      background-color: var(--s1p-hover);
    }
    .s1p-thread-title {
      flex-grow: 1;
      font-size: 14px;
      font-weight: 500;
    }
    .s1p-thread-count {
      font-size: 12px;
      color: var(--s1p-desc-t);
    }
    .s1p-thread-posts {
      padding: 12px;
      background-color: var(--s1p-bg-alt);
    }
    .s1p-thread-posts.s1p-collapsible-content {
      /* [统一] 使用 grid-template-rows 实现展开/收起动画，与一般可折叠内容保持一致 */
      display: grid;
      grid-template-rows: 0fr;
      padding: 0;
      transition: grid-template-rows 0.4s cubic-bezier(0.4, 0, 0.2, 1),
        padding 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
    }
    .s1p-thread-posts.s1p-collapsible-content > div {
      overflow: hidden;
    }
    .s1p-thread-posts.s1p-collapsible-content.expanded {
      grid-template-rows: 1fr;
      padding: 0 12px 12px 12px; /* 移除上边距，保持其他边距 */
    }
    .s1p-item-toggle {
      font-size: 12px;
      color: var(--s1p-desc-t);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .s1p-item-toggle input {
      /* Handled by .s1p-switch */
    }
    .s1p-blocked-user-item {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
    }
    .s1p-blocked-user-top-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        width: 100%;
    }
    .s1p-item-row-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 0;
      width: 100%;
    }
    /* Fixed width for toggle container to prevent shrinking */
    .s1p-item-row-controls .s1p-item-toggle {
      flex-shrink: 0;
      margin-top: 0; /* Reset margin from s1p-item-toggle if any */
    }
    .s1p-remark-container {
      flex-grow: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0; /* Crucial for text-overflow */
      justify-content: flex-end; /* Align to the right */
      margin-left: 4px;
    }
    .s1p-remark-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--s1p-desc-t);
      font-size: 13px;
      cursor: default;
      max-width: 100%;
      /* [Refactor] Add background styling */
      /* [Refactor] Add background styling */
      background-color: var(--s1p-sub);
      border-radius: 8px;
      padding: 2px 8px;
      /* flex-grow: 1;  Removed to allow wrapping content only */
      margin-right: 4px;
      text-align: right;
    }
    .s1p-btn-sm {
      padding: 6px 8px;
      font-size: 12px;
      height: auto;
      line-height: 1.2;
      min-width: auto;
      flex-shrink: 0;
    }
    .s1p-unblock-btn:hover {
      background-color: var(--s1p-red-h);
    }
    .s1p-unblock-post-btn:hover {
      background-color: var(--s1p-red-h);
    }
    .s1p-local-sync-desc {
      /* [优化] 调整描述文字样式，提升可读性 */
      font-size: 13px;
      color: var(--s1p-desc-t);
      margin-bottom: 16px;
      line-height: 1.7;
    }
    .s1p-local-sync-buttons {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
    }
    .s1p-sync-textarea {
      width: 100%;
      min-height: 80px;
      margin-bottom: 8px;
    }
    /* --- [新增] 论坛黑名单同步状态提示 --- */
    .s1p-native-sync-status {
      display: inline-block;
      background-color: var(--s1p-list-item-status-bg);
      color: var(--s1p-list-item-status-text);
      padding: 2px 8px;
      border-radius: 7px;
      font-style: normal;
      font-weight: 500;
      font-size: 11px;
      margin-left: 8px;
      vertical-align: middle;
      position: relative;
      top: -1px;
    }
    /* --- [OPTIMIZED] Sync Settings Panel Disabled State --- */
    #s1p-remote-sync-controls-wrapper {
      transition: opacity 0.3s ease-out;
    }
    #s1p-remote-sync-controls-wrapper.is-disabled {
      opacity: 0.5;
    }
    #s1p-auto-sync-indicator-subgroup.is-disabled {
      opacity: 0.5;
      pointer-events: none;
    }

    /* --- 悬浮提示框 (Toast Notification) --- */
    @keyframes s1p-toast-shake {
      10%,
      90% {
        transform: translate(-51%, 0);
      }
      20%,
      80% {
        transform: translate(-49%, 0);
      }
      30%,
      50%,
      70% {
        transform: translate(-52%, 0);
      }
      40%,
      60% {
        transform: translate(-48%, 0);
      }
    }
    .s1p-toast-notification {
      position: fixed;
      left: 50%;
      bottom: 20px;
      transform: translate(-50%, 50px);
      z-index: 100120;
      padding: 10px 18px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      color: var(--s1p-t); /* <-- 修改了此行 */
      background-color: var(--s1p-bg); /* <-- 修改了此行 */
      box-shadow: 0 4px 12px rgba(var(--s1p-shadow-color-rgb), 0.15);
      opacity: 0;
      transition: opacity 0.3s ease-out, transform 0.3s ease-out;
      pointer-events: none;
      white-space: nowrap;
      text-align: center;
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
      border-color: #27da80; /* 覆盖边框颜色 */
    }
    .s1p-toast-notification.error {
      background-color: var(--s1p-red);
      color: var(--s1p-white); /* 确保失败状态字体为白色 */
      border-color: var(--s1p-red); /* 覆盖边框颜色 */
    }
    .s1p-toast-notification.error.visible {
      animation: s1p-toast-shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
    }

    /* --- 确认弹窗样式 --- */
    @keyframes s1p-fade-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @keyframes s1p-scale-in {
      from {
        transform: scale(0.95);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }
    @keyframes s1p-fade-out {
      from {
        opacity: 1;
      }
      to {
        opacity: 0;
      }
    }
    @keyframes s1p-scale-out {
      from {
        transform: scale(1);
        opacity: 1;
      }
      to {
        transform: scale(0.97);
        opacity: 0;
      }
    }
    .s1p-confirm-modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(var(--s1p-black-rgb), 0.65);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      animation: s1p-fade-in 0.2s ease-out;
    }
    /* 已有蒙版（设置面板）时，confirm modal 不重复显示蒙版背景 */
    .s1p-modal ~ .s1p-confirm-modal {
      background-color: transparent;
    }
    .s1p-confirm-content {
      background-color: var(--s1p-bg);
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(var(--s1p-shadow-color-rgb), 0.1),
        0 10px 10px -5px rgba(var(--s1p-shadow-color-rgb), 0.04);
      width: 480px;
      max-width: 90%;
      text-align: left;
      overflow: hidden;
      animation: s1p-scale-in 0.25s ease-out;
    }
    .s1p-confirm-body {
      padding: 20px 24px;
      font-size: 16px;
      line-height: 1.6;
    }
    .s1p-confirm-body .s1p-confirm-title {
      font-weight: 600;
      font-size: 18px;
      margin-bottom: 8px;
    }
    .s1p-confirm-body .s1p-confirm-subtitle {
      font-size: 14px;
      color: var(--s1p-desc-t);
    }
    .s1p-confirm-footer {
      padding: 12px 24px 20px;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }
    .s1p-confirm-footer.s1p-centered {
      justify-content: center;
    }
    .s1p-manual-block-form {
      margin-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .s1p-manual-block-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .s1p-manual-block-field-label {
      font-size: 14px;
      color: var(--s1p-t);
      font-weight: 600;
    }
    .s1p-manual-block-remark-input {
      min-height: 88px;
      resize: vertical;
      font-family: inherit;
    }
    .s1p-native-blacklist-import-btn {
      margin-left: 8px;
    }
    .s1p-native-blacklist-import-hint {
      margin-left: 8px;
      color: var(--s1p-desc-t);
      font-size: 12px;
    }
    .s1p-native-imported-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      float: right;
      width: 16px;
      height: 16px;
      margin-left: 8px;
      color: var(--s1p-list-item-status-text);
      line-height: 0;
      pointer-events: auto;
      cursor: help;
    }
    .s1p-native-imported-badge > svg {
      width: 16px;
      height: 16px;
      display: block;
    }

    /* --- 阅读记录详情弹窗样式 --- */
    .s1p-reading-progress-content {
      max-width: 550px;
      width: 100%;
      position: relative;
    }
    .s1p-reading-progress-content .s1p-modal-close {
      position: absolute;
      top: 20px;
      right: 20px;
    }
    /* 表格改为真正的CSS Grid，确保列对齐 */
    .s1p-reading-progress-modal .s1p-sync-comparison-table {
      display: grid;
      grid-template-columns: auto 1fr auto;
      pointer-events: auto;
    }
    .s1p-reading-progress-modal .s1p-sync-comparison-row {
      display: contents;
    }
    .s1p-reading-progress-modal .s1p-sync-comparison-row > div {
      padding: 12px 16px;
      border-bottom: 1px solid var(--s1p-pri);
    }
    .s1p-reading-progress-modal .s1p-sync-comparison-header > div {
      background-color: var(--s1p-pri);
      font-weight: 600;
    }
    .s1p-reading-progress-modal .s1p-sync-comparison-row:last-child > div {
      border-bottom: none;
    }
    /* 斑马条纹 - 每3个单元格为一行 */
    .s1p-reading-progress-modal .s1p-sync-comparison-row:nth-child(even) > div {
      background-color: var(--s1p-sub);
    }
    /* 列对齐 */
    .s1p-reading-progress-modal .s1p-sync-comparison-label {
      text-align: left;
    }
    .s1p-reading-progress-modal .s1p-sync-comparison-value {
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
    }

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
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        background-color 0.2s ease;
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
      transition: grid-template-rows 0.4s cubic-bezier(0.4, 0, 0.2, 1),
        padding-top 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
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
      /* [调试] 暂时禁用这里的动画，以便测试我们自己的 height 动画 */
      transition: none;
      margin-top: 0;
    }
    .s1p-feature-content.expanded {
      grid-template-rows: 1fr;
      margin-top: 0px;
    }
    .s1p-feature-content > div {
      overflow: hidden;
      /* [调试] 暂时禁用这里的动画 */
      transition: none;
    }
    .s1p-feature-content:not(.expanded) > div {
      opacity: 0;
      transition-duration: 0s;
    }
    .s1p-feature-content.expanded > div {
      opacity: 1;
      transition-delay: 0s;
    }

    /* --- 界面定制设置样式 --- */
    .s1p-settings-group {
      /* margin-bottom: 0; */
      padding: 8px;
    }
    .s1p-settings-group-compact {
      margin-bottom: 16px;
      padding-bottom: 0;
    }
    .s1p-settings-group-title {
      /* [优化 V2] 调整次级分组标题，拉开层级 */
      font-size: 15px;
      font-weight: 500;
      border-bottom: 1px solid var(--s1p-pri);
      padding-bottom: 12px;
      margin-bottom: 16px;
    }

    /* --- [修改] 统一的设置子选项分组缩进样式 --- */
    .s1p-settings-sub-group {
      padding-left: 20px;
      border-left: none;
      margin-left: 8px;
      margin-top: 8px;
      transition: all 0.3s ease;
    }

    .s1p-settings-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
    }
    .s1p-settings-item-top8 {
      margin-top: 8px;
    }
    .s1p-settings-item-top12 {
      margin-top: 12px;
    }
    .s1p-settings-item-column {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
    .s1p-feature-toggle-item {
      padding: 0;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--s1p-pri);
    }
    .s1p-settings-item .s1p-input {
      width: auto;
      min-width: 200px;
    }
    .s1p-settings-item-column > .s1p-input,
    .s1p-settings-item-column > .s1p-relative-full {
      width: 100%;
      align-self: stretch;
    }
    .s1p-settings-item-column .s1p-input {
      width: 100%;
      min-width: 0;
    }
    .s1p-settings-group-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .s1p-settings-group-head .s1p-settings-group-title {
      margin-bottom: 0;
      border-bottom: none;
      padding-bottom: 0;
    }
    .s1p-settings-group-head .s1p-btn {
      padding: 4px 10px;
      font-size: 13px;
    }
    .s1p-link-open-mode-section {
      margin-top: 8px;
      padding-top: 0;
    }
    .s1p-setting-desc-top8 {
      margin-top: 8px;
      margin-bottom: 16px;
    }
    .s1p-setting-desc-top8-no-bottom {
      margin-top: 8px;
      margin-bottom: 0;
    }
    .s1p-setting-desc-save-hint {
      margin-top: 14px;
      margin-bottom: 8px;
    }
    .s1p-sync-last-sync-time {
      margin-top: -8px;
      margin-bottom: 16px;
    }
    .s1p-sync-token-expiry-info {
      margin-top: 4px;
      min-height: 20px;
    }
    .s1p-sync-footer-actions {
      margin-top: 16px;
      justify-content: flex-end;
      gap: 8px;
    }
    .s1p-editor-footer.s1p-sync-footer-actions {
      justify-content: flex-end;
      gap: 8px;
    }
    .s1p-notice + .s1p-setting-desc-save-hint {
      margin-top: 14px;
    }
    .s1p-clear-data-options {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background-color: var(--s1p-bg);
      border: 1px solid var(--s1p-pri);
      border-radius: 6px;
      padding: 12px;
    }
    .s1p-clear-data-footer {
      margin-top: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .s1p-clear-data-select-all {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .s1p-hidden {
      display: none;
    }
    .s1p-input-full {
      width: 100%;
    }
    .s1p-relative-full {
      position: relative;
      width: 100%;
    }
    .s1p-input-with-right-icon {
      width: 100%;
      padding-right: 32px;
    }
    .s1p-icon-btn-overlay {
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      color: var(--s1p-desc-t);
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
      transition: opacity 0.2s;
    }
    .s1p-setting-desc-top0-bottom16 {
      margin-top: 0;
      margin-bottom: 16px;
    }
    .s1p-settings-group-margin-bottom16 {
      margin-bottom: 16px;
    }
    .s1p-item-info-no-margin {
      margin-bottom: 0;
    }
    .s1p-keyword-rules-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .s1p-editor-footer-start {
      justify-content: flex-start;
      gap: 8px;
    }
    .s1p-settings-item-top16 {
      margin-top: 16px;
    }
    .s1p-setting-desc-top-negative4 {
      margin-top: -4px;
    }
    .s1p-flex-row-center-gap12 {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .s1p-progress-detail-btn {
      padding: 6px 12px;
      white-space: nowrap;
    }
    .s1p-progress-detail-btn-icon {
      margin-right: 6px;
      vertical-align: middle;
    }
    .s1p-settings-item-auto-cleanup {
      margin-top: -8px;
    }
    .s1p-settings-label-indent16 {
      padding-left: 16px;
    }
    .s1p-setting-desc-progress-hint {
      margin-top: -2px;
      padding-left: 2px;
    }
    .s1p-nav-editor-actions {
      display: flex;
      gap: 8px;
    }
    .s1p-inline-code-badge {
      background-color: var(--s1p-secondary-bg);
      padding: 2px 4px;
      border-radius: 4px;
    }
    .s1p-welcome-highlight-paragraph {
      margin-top: 16px;
    }
    .s1p-link-open-mode-group {
      display: grid;
      gap: 8px;
    }
    .s1p-link-open-mode-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 0;
    }
    .s1p-link-open-mode-desc {
      margin-top: 0;
      margin-bottom: 12px;
    }
    .s1p-link-open-mode-item .s1p-settings-label {
      flex: 1 1 auto;
    }
    .s1p-link-open-mode-control {
      flex-shrink: 0;
    }
    .s1p-link-open-mode-item.is-disabled {
      opacity: 0.52;
    }
    .s1p-link-open-mode-item.is-disabled .s1p-link-open-mode-control {
      pointer-events: none;
    }
    .s1p-image-size-limit-panel {
      display: grid;
      gap: 6px;
    }
    .s1p-image-size-limit-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .s1p-image-size-limit-header .s1p-setting-desc {
      margin: 0;
      flex: 1 1 auto;
    }
    .s1p-image-size-limit-header .s1p-btn {
      flex-shrink: 0;
      white-space: nowrap;
      padding: 4px 10px;
      font-size: 13px;
    }
    .s1p-image-size-limit-panel:not(.is-enabled) {
      opacity: 0.5;
      pointer-events: none;
    }
    .s1p-image-size-limit-controls {
      display: grid;
      gap: 6px;
    }
    .s1p-image-size-limit-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .s1p-image-size-limit-field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .s1p-image-size-limit-input-wrap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .s1p-image-size-limit-input.s1p-input {
      min-width: 74px;
      width: 74px;
      text-align: right;
      padding: 6px 8px;
      appearance: textfield;
      -moz-appearance: textfield;
    }
    .s1p-image-size-limit-input.s1p-input::-webkit-outer-spin-button,
    .s1p-image-size-limit-input.s1p-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .s1p-image-size-limit-unit {
      font-size: 14px;
      font-weight: 500;
      color: var(--s1p-t);
      min-width: 18px;
      line-height: 1;
    }
    @media (max-width: 640px) {
      .s1p-image-size-limit-header {
        flex-wrap: wrap;
      }
      .s1p-image-size-limit-input.s1p-input {
        width: 100px;
        min-width: 100px;
      }
    }
    .s1p-settings-label {
      /* [优化] 设定设置项标签的基础样式 */
      font-size: 14px;
      font-weight: 500;
    }
    .s1p-diag-wrapper {
      margin-bottom: 12px;
    }
    .s1p-diag-header {
      padding-bottom: 8px;
    }
    .s1p-diag-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .s1p-diag-btn {
      height: 28px;
      padding: 0 10px;
    }
    .s1p-diag-panel {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
    }
    .s1p-diag-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      gap: 12px;
    }
    .s1p-diag-label {
      font-size: 12px;
      color: var(--s1p-desc-t);
    }
    .s1p-diag-value {
      font-size: 12px;
      color: var(--s1p-t);
      word-break: break-word;
      text-align: right;
    }
    .s1p-settings-section-title-label {
      /* [优化 V2] 调整主要分组标题，响应用户反馈 */
      font-size: 16px;
      font-weight: 600;
    }
    .s1p-settings-checkbox {
      /* Handled by .s1p-switch */
    }
    .s1p-setting-desc {
      /* [优化] 统一描述文字的样式，提升可读性 */
      font-size: 13px;
      color: var(--s1p-desc-t);
      margin: -4px 0 12px 0;
      padding: 0;
      line-height: 1.7;
    }
    /* --- [新增] 警告文本样式 --- */
    .s1p-warning-text {
      font-weight: bold;
      color: var(--s1p-red);
    }
    .s1p-editor-item {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 6px;
      border-radius: 4px;
      background: var(--s1p-bg);
    }
    .s1p-editor-item select {
      background: var(--s1p-bg);
      width: 100%;
      border: 1px solid var(--s1p-pri);
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 14px;
      box-sizing: border-box;
    }
    .s1p-editor-item-controls {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .s1p-editor-btn {
      padding: 4px;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      border-radius: 4px;
      border: none;
      background: transparent;
      color: #9ca3af;
    }
    /* --- [修正] 使用 :not() 伪类来排除删除按钮，防止其悬浮样式被覆盖 --- */
    .s1p-editor-btn:not(.s1p-delete-button):hover {
      background: var(--s1p-secondary-bg);
      color: var(--s1p-secondary-text);
    }
    /* --- [新增] 为删除按钮定义统一的尺寸和边距 (骨架) --- */
    .s1p-editor-btn.s1p-delete-button {
      width: 26px;
      height: 26px;
      padding: 4px;
      box-sizing: border-box;
      font-size: 0;
    }
    /* --- [修改] 固化S1 Plus经典删除按钮样式 --- */
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
    .s1p-drag-handle {
      font-size: 18pt;
      cursor: grab;
    }
    .s1p-editor-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 12px;
    }

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
      transition: background-color 0.2s ease, opacity 0.2s ease,
        transform 0.2s ease;
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
    .s1p-switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
      vertical-align: middle;
      flex-shrink: 0;
    }
    .s1p-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .s1p-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--s1p-pri);
      transition: 0.3s;
      border-radius: 22px;
    }
    .s1p-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: var(--s1p-white);
      transition: 0.3s;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(var(--s1p-shadow-color-rgb), 0.1);
    }
    input:checked + .s1p-slider {
      background-color: var(--s1p-sec);
    }
    input:checked + .s1p-slider:before {
      transform: translateX(18px);
    }

    /* --- [NEW] 设置面板窄屏适配 --- */
    @media (max-width: ${NARROW_SCREEN_MAX_WIDTH_PX}px) {
      .s1p-modal {
        align-items: stretch;
        padding: 8px;
        box-sizing: border-box;
      }
      .s1p-modal-content {
        width: 100% !important;
        max-width: 100%;
        max-height: calc(100vh - 16px);
      }
      .s1p-modal-header {
        padding: 12px;
      }
      .s1p-modal-title {
        font-size: 16px;
      }
      .s1p-modal-body {
        padding: 8px 12px 12px;
        overflow-x: hidden;
      }
      .s1p-modal-footer {
        padding: 10px 12px;
      }

      .s1p-tabs-wrapper {
        justify-content: center;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 2px;
      }
      .s1p-tabs {
        min-width: max-content;
        flex-shrink: 0;
        margin-bottom: 12px;
      }
      .s1p-tab-btn {
        padding: 6px 12px;
        font-size: 13px;
      }

      .s1p-settings-sub-group {
        padding-left: 12px;
        margin-left: 0;
      }
      .s1p-settings-item {
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 10px;
      }
      .s1p-settings-label {
        flex: 1 1 auto;
        min-width: 0;
        line-height: 1.5;
        word-break: break-word;
      }
      .s1p-settings-item > .s1p-switch {
        margin-left: auto;
      }
      .s1p-settings-item .s1p-input {
        min-width: 0;
      }
      .s1p-settings-item > .s1p-input {
        width: 100%;
        flex: 1 1 100%;
      }

      :is(#s1p-cleanupModeContainer, #s1p-readingProgressCleanupContainer) {
        flex-wrap: wrap;
      }
      :is(#s1p-cleanupModeContainer, #s1p-readingProgressCleanupContainer)
        > .s1p-settings-label {
        flex: 1 1 100%;
        padding-left: 0 !important;
      }
      #s1p-cleanupModeContainer > div {
        width: 100%;
        display: flex !important;
        flex-wrap: wrap;
        gap: 8px !important;
        align-items: center !important;
      }
      :is(#s1p-cleanupMode-control, #s1p-readingProgressCleanupDays-control) {
        max-width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
      }
      .s1p-link-open-mode-control {
        max-width: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
      }
      #s1p-readingProgressCleanupDays-control {
        width: 100%;
      }
      #s1p-readingProgressCleanupDays-control .s1p-segmented-control-option {
        text-align: center;
      }
      #s1p-open-progress-detail-btn {
        max-width: 100%;
        padding: 6px 10px !important;
      }

      :is(.s1p-local-sync-buttons, .s1p-diag-actions) {
        flex-wrap: wrap;
      }
    }

    /* --- Nav Editor Dragging --- */
    .s1p-editor-item.s1p-dragging {
      opacity: 0.5;
    }

    /* --- 用户标记设置面板专属样式 --- */
    .s1p-item-meta-id {
      font-family: monospace;
      background-color: var(--s1p-bg);
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 11px;
      color: var(--s1p-t);
    }
    .s1p-item-content {
      /* [优化] 调整列表项正文内容的样式 */
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--s1p-pri);
      color: var(--s1p-t);
      font-size: 14px;
      font-weight: 400; /* 使用常规字重 */
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
    }
    /* --- [微调] 统一调整用户标记和回复收藏列表的内容区样式 --- */
    #s1p-tags-list-container .s1p-item-content,
    #s1p-bookmarks-list-container .s1p-item-content {
      font-size: 14px;
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
    .s1p-item-editor textarea {
      width: 100%;
      min-height: 60px;
      margin-top: 8px;
    }
    .s1p-item-actions {
      display: flex;
      align-self: flex-start;
      flex-shrink: 0;
      gap: 8px;
      margin-left: 16px;
    }
    .s1p-item-actions .s1p-btn.s1p-primary {
      background-color: #3b82f6;
      color: var(--s1p-white);
    }
    .s1p-item-actions .s1p-btn.s1p-primary:hover {
      background-color: #2563eb;
    }

    /* [MODIFIED] 移除了 .s1p-item-actions .s1p-btn.s1p-danger 的默认红色背景规则 */

    /* [MODIFIED] 将危险按钮的红色样式只应用在 hover 状态 */
    .s1p-item-actions .s1p-btn.s1p-danger:hover {
      background-color: var(--s1p-red-h);
      border-color: transparent; /* 再次确保边框透明 */
      color: var(--s1p-white);
    }

    /* --- 引用屏蔽占位符 --- */
    .s1p-quote-placeholder,
    .s1p-notification-placeholder {
      background-color: var(--s1p-bg);
      border: 1px solid var(--s1p-pri);
      padding: 8px 12px;
      border-radius: 6px;
      margin: 14px 0 10px;
      font-size: 13px;
      color: var(--s1p-desc-t);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    td.t_f > .pstatus {
      display: block;
      margin: 0 0 18px !important;
    }
    td.t_f > .pstatus + br {
      display: none;
    }
    td.t_f > .pstatus + .s1p-quote-placeholder,
    td.t_f > .pstatus + .s1p-notification-placeholder {
      margin-top: 0 !important;
    }
    .s1p-inline-toggle-btn:focus-visible {
      outline: 2px solid var(--s1p-sub-h);
      outline-offset: 1px;
    }
    .s1p-quote-wrapper {
      overflow: hidden;
      transition: max-height 0.35s ease-in-out;
    }

    /* --- [新增] 通知/提醒屏蔽样式 --- */
    .s1p-notification-wrapper {
      overflow: hidden;
      transition: max-height 0.35s ease-in-out;
      margin-bottom: 10px;
    }

    /* --- Image Hiding --- */
    .s1p-image-container {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      margin: 8px 0;
    }
    html.s1p-limit-images-by-size-enabled div.t_fsz img.zoom,
    html.s1p-limit-images-by-size-enabled div.t_fsz img[id^="aimg_"],
    html.s1p-limit-images-by-size-enabled .s1p-size-limited-image {
      max-width: var(--s1p-image-preview-max-width) !important;
      max-height: var(--s1p-image-preview-max-height) !important;
      width: auto !important;
      height: auto !important;
    }
    .s1p-image-placeholder {
      display: inline-flex;
      align-items: center;
      /* gap: 6px; */ /* [S1P-MOD] 移除gap，因为没有图标 */
      padding: 6px 14px; /* [S1P-MOD] 匹配 s1p-btn 内边距 */
      border-radius: 6px;
      background-color: var(--s1p-pri);
      color: var(--s1p-t);
      border: none; /* [S1P-MOD] 匹配 s1p-btn 边框 */
      cursor: pointer;
      font-size: 14px; /* [S1P-MOD] 匹配 s1p-btn 字体大小 */
      font-weight: bold; /* [S1P-MOD] 匹配 s1p-btn 字体粗细 */
      transition: all 0.2s ease;
      /* [S1P-MOD] 模拟 s1p-btn 的其他属性 */
      justify-content: center;
      user-select: none;
      white-space: nowrap;
    }
    .s1p-image-placeholder:hover {
      background-color: var(--s1p-sub-h);
      color: var(--s1p-sub-h-t);
      /* [S1P-MOD] 移除 border-color，因为 border: none */
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
      /* gap: 6px; */ /* [S1P-MOD] 移除gap，因为没有图标 */
      padding: 6px 14px; /* [S1P-MOD] 匹配 s1p-btn 内边距 */
      border-radius: 6px;
      background-color: var(--s1p-pri);
      color: var(--s1p-t);
      border: none; /* [S1P-MOD] 匹配 s1p-btn 边框 */
      cursor: pointer;
      font-size: 14px; /* [S1P-MOD] 匹配 s1p-btn 字体大小 */
      font-weight: bold; /* [S1P-MOD] 匹配 s1p-btn 字体粗细 */
      transition: all 0.2s ease;
      /* [S1P-MOD] 模拟 s1p-btn 的其他属性 */
      justify-content: center;
      user-select: none;
      white-space: nowrap;
    }
    .s1p-image-toggle-all-btn:hover {
      background-color: var(--s1p-sub-h);
      color: var(--s1p-sub-h-t);
      /* [S1P-MOD] 移除 border-color，因为 border: none */
    }

    /* --- [新增 V9] 可禁用/启用的增强型悬浮控件 --- */
    /* --- 模式 B: 增强控件关闭 (默认状态) --- */
    /* 默认隐藏脚本创建的控件 */
    .s1p-image-viewer {
      position: fixed;
      inset: 0;
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(var(--s1p-black-rgb), 0.7);
      backdrop-filter: blur(2px);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity ${S1P_IMAGE_VIEWER_OPEN_CLOSE_ANIMATION_MS}ms
        cubic-bezier(0.22, 1, 0.36, 1);
    }
    .s1p-image-viewer.is-visible {
      visibility: visible;
    }
    .s1p-image-viewer.is-overlay-open {
      opacity: 1;
      pointer-events: auto;
    }
    .s1p-image-viewer.is-dragging .s1p-image-viewer__viewport {
      cursor: grabbing;
    }
    .s1p-image-viewer__panel {
      width: min(96vw, 1600px);
      height: min(94vh, 1200px);
      border-radius: 12px;
      border: 1px solid var(--s1p-pri);
      background: var(--s1p-bg);
      box-shadow: 0 12px 40px rgba(var(--s1p-shadow-color-rgb), 0.35);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      opacity: 0;
      transform: translate3d(0, 12px, 0);
      transition:
        transform ${S1P_IMAGE_VIEWER_OPEN_CLOSE_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
        opacity ${S1P_IMAGE_VIEWER_OPEN_CLOSE_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
      will-change: transform, opacity;
    }
    .s1p-image-viewer.is-panel-open .s1p-image-viewer__panel {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
    @media (prefers-reduced-motion: reduce) {
      .s1p-image-viewer,
      .s1p-image-viewer__panel,
      .s1p-image-viewer__image-stage--main,
      .s1p-image-viewer__image-stage--ghost,
      .s1p-image-viewer__image {
        transition: none !important;
        animation: none !important;
      }
    }
    .s1p-image-viewer__toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--s1p-pri);
      background: var(--s1p-sub);
      flex-wrap: wrap;
    }
    .s1p-image-viewer__title {
      font-weight: 600;
      color: var(--s1p-t);
      margin-right: auto;
      font-size: 13px;
    }
    .s1p-image-viewer__zoom {
      font-size: 12px;
      color: var(--s1p-desc-t);
      background: var(--s1p-bg);
      border: 1px solid var(--s1p-pri);
      border-radius: 999px;
      padding: 4px 8px;
      min-width: 64px;
      text-align: center;
      white-space: nowrap;
    }
    .s1p-image-viewer__index {
      font-size: 12px;
      color: var(--s1p-desc-t);
      background: var(--s1p-bg);
      border: 1px solid var(--s1p-pri);
      border-radius: 999px;
      padding: 4px 8px;
      min-width: 56px;
      text-align: center;
      white-space: nowrap;
    }
    .s1p-image-viewer__toolbar .s1p-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .s1p-image-viewer__toolbar .s1p-image-viewer__icon-btn {
      width: 34px;
      height: 34px;
      min-width: 34px;
      padding: 0;
      flex: 0 0 34px;
      font-size: 0;
      line-height: 0;
    }
    .s1p-image-viewer__zoom-icon {
      display: block;
      width: 16px;
      height: 16px;
      fill: currentColor;
      pointer-events: none;
    }
    .s1p-image-viewer__toolbar .s1p-image-viewer__close-btn {
      width: 34px;
      height: 34px;
      min-width: 34px;
      padding: 0;
      flex: 0 0 34px;
      font-size: 0;
      line-height: 0;
    }
    .s1p-image-viewer__close-icon {
      display: block;
      width: 14px;
      height: 14px;
      stroke: currentColor;
      stroke-width: 2.2;
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .s1p-image-viewer__viewport {
      position: relative;
      flex: 1;
      overflow: hidden;
      background: var(--s1p-image-viewer-viewport-bg);
      cursor: grab;
      user-select: none;
    }
    .s1p-image-viewer__nav-btn {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      z-index: 3;
      width: 38px;
      height: 38px;
      border-radius: 999px;
      border: none;
      background: var(--s1p-sub);
      color: var(--s1p-t);
      font-size: 0;
      line-height: 0;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 2px rgba(var(--s1p-shadow-color-rgb), 0.12);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease,
        background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
        color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
        box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
    }
    .s1p-image-viewer__nav-icon {
      display: block;
      width: 16px;
      height: 16px;
      margin: 0 auto;
      stroke: currentColor;
      stroke-width: 2.2;
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .s1p-image-viewer__nav-btn[data-action="prev"] {
      left: 14px;
    }
    .s1p-image-viewer__nav-btn[data-action="next"] {
      right: 14px;
    }
    .s1p-image-viewer.has-gallery.is-nav-visible .s1p-image-viewer__nav-btn {
      opacity: 1;
      pointer-events: auto;
    }
    .s1p-image-viewer:not(.has-gallery) .s1p-image-viewer__nav-btn {
      display: none;
    }
    .s1p-image-viewer__nav-btn:hover:not(:disabled) {
      transform: translateY(calc(-50% - 2px));
      background: var(--s1p-sub-h);
      color: var(--s1p-sub-h-t);
      box-shadow: 0 3px 6px rgba(var(--s1p-shadow-color-rgb), 0.18);
    }
    .s1p-image-viewer__nav-btn:active:not(:disabled) {
      transform: translateY(calc(-50% - 1px));
    }
    .s1p-image-viewer__nav-btn:disabled {
      opacity: 0.45 !important;
      cursor: not-allowed;
      color: var(--s1p-desc-t);
      box-shadow: 0 1px 2px rgba(var(--s1p-shadow-color-rgb), 0.1);
    }
    .s1p-image-viewer__image-stage {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      transform: translate3d(0, 0, 0);
      transform-origin: 0 0;
      will-change: transform;
      opacity: 1;
    }
    .s1p-image-viewer__image-stage--ghost {
      z-index: 1;
      opacity: 0;
    }
    .s1p-image-viewer.has-switch-ghost .s1p-image-viewer__image-stage--ghost {
      opacity: 1;
    }
    .s1p-image-viewer__image-stage--main {
      z-index: 2;
    }
    .s1p-image-viewer__image {
      position: absolute;
      top: 0;
      left: 0;
      max-width: none;
      max-height: none;
      transform-origin: 0 0 !important;
      will-change: transform;
      pointer-events: none;
      user-select: none;
      -webkit-user-drag: none;
      opacity: 1;
      transition: none !important;
      animation: none !important;
    }
    .s1p-image-viewer.is-preparing-switch
      .s1p-image-viewer__image-stage--main
      .s1p-image-viewer__image {
      opacity: 0;
    }
    .s1p-image-viewer.is-switching-next .s1p-image-viewer__image-stage--main {
      animation: s1p-image-viewer-slide-in-next ${S1P_IMAGE_VIEWER_SWITCH_ANIMATION_MS}ms
        cubic-bezier(0.22, 1, 0.36, 1);
    }
    .s1p-image-viewer.is-switching-prev .s1p-image-viewer__image-stage--main {
      animation: s1p-image-viewer-slide-in-prev ${S1P_IMAGE_VIEWER_SWITCH_ANIMATION_MS}ms
        cubic-bezier(0.22, 1, 0.36, 1);
    }
    .s1p-image-viewer.has-switch-ghost.is-switching-next
      .s1p-image-viewer__image-stage--ghost {
      animation: s1p-image-viewer-slide-out-next ${S1P_IMAGE_VIEWER_SWITCH_ANIMATION_MS}ms
        cubic-bezier(0.22, 1, 0.36, 1);
    }
    .s1p-image-viewer.has-switch-ghost.is-switching-prev
      .s1p-image-viewer__image-stage--ghost {
      animation: s1p-image-viewer-slide-out-prev ${S1P_IMAGE_VIEWER_SWITCH_ANIMATION_MS}ms
        cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes s1p-image-viewer-slide-in-next {
      from {
        transform: translate3d(56px, 0, 0);
      }
      to {
        transform: translate3d(0, 0, 0);
      }
    }
    @keyframes s1p-image-viewer-slide-in-prev {
      from {
        transform: translate3d(-56px, 0, 0);
      }
      to {
        transform: translate3d(0, 0, 0);
      }
    }
    @keyframes s1p-image-viewer-slide-out-next {
      from {
        transform: translate3d(0, 0, 0);
        opacity: 1;
      }
      to {
        transform: translate3d(-56px, 0, 0);
        opacity: 0;
      }
    }
    @keyframes s1p-image-viewer-slide-out-prev {
      from {
        transform: translate3d(0, 0, 0);
        opacity: 1;
      }
      to {
        transform: translate3d(56px, 0, 0);
        opacity: 0;
      }
    }
    @media (max-width: ${NARROW_SCREEN_MAX_WIDTH_PX}px) {
      .s1p-image-viewer__panel {
        width: 100vw;
        height: 100vh;
        border-radius: 0;
        border: none;
      }
      .s1p-image-viewer__toolbar {
        gap: 6px;
        padding: 8px;
      }
      .s1p-image-viewer__title {
        width: 100%;
        margin-right: 0;
      }
      .s1p-image-viewer__toolbar .s1p-btn {
        flex: 1;
        min-width: 0;
      }
      .s1p-image-viewer__toolbar .s1p-image-viewer__icon-btn {
        width: 32px;
        height: 32px;
        min-width: 32px;
        flex: 0 0 32px;
        padding: 0;
      }
      .s1p-image-viewer__zoom-icon {
        width: 15px;
        height: 15px;
      }
      .s1p-image-viewer__toolbar .s1p-image-viewer__close-btn {
        width: 32px;
        height: 32px;
        min-width: 32px;
        flex: 0 0 32px;
      }
      .s1p-image-viewer__close-icon {
        width: 13px;
        height: 13px;
      }
      .s1p-image-viewer__nav-btn {
        width: 34px;
        height: 34px;
      }
      .s1p-image-viewer__nav-icon {
        width: 14px;
        height: 14px;
      }
      .s1p-image-viewer.has-gallery .s1p-image-viewer__nav-btn {
        opacity: 1;
        pointer-events: auto;
      }
    }
    #s1p-floating-controls-wrapper {
      display: none;
    }

    /* --- 模式 A: 增强控件开启 (当 body 有 s1p-enhanced-controls-active 时) --- */
    /* 1. 让脚本控件显示出来 */
    body.s1p-enhanced-controls-active #s1p-floating-controls-wrapper {
      display: block;
    }
    /* 2. 同时，彻底隐藏原生控件 */
    body.s1p-enhanced-controls-active #scrolltop {
      display: none !important;
    }

    /* 3. 以下是脚本控件自身的样式 (与之前版本类似，但选择器更严谨) */
    #s1p-floating-controls-wrapper {
      position: fixed;
      top: 50%;
      right: 10px;
      transform: translateY(-50%);
      z-index: 9998;
      pointer-events: none; /* <--- 把这一行加在这里 */
    }
    #s1p-controls-handle {
      position: absolute;
      top: 50%;
      right: -10px;
      transform: translateY(-50%);
      width: 20px;
      height: 40px;
      background-color: var(--s1p-bg);
      border-right: none;
      border-radius: 10px 0 0 10px;
      box-shadow: -2px 2px 8px rgba(var(--s1p-shadow-color-rgb), 0.1);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.3s ease 0.1s;
      pointer-events: auto; /* [新增] 唯独让手柄可以响应鼠标 */
    }
    #s1p-controls-handle::before {
      content: "";
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
      /* [S1PLUS-MODIFIED] 将左侧内边距设为一个 >20px 的值，从而制造按钮和屏幕边缘的间距 */
      padding-left: 35px;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease,
        visibility 0.3s;
    }
    #s1p-floating-controls-wrapper:hover #s1p-controls-handle {
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    #s1p-floating-controls-wrapper:hover #s1p-floating-controls {
      transform: translateX(0);
      opacity: 1;
      visibility: visible;
      pointer-events: auto; /* [修改] 之前是auto，现在明确写出以确保逻辑完整 */
    }
    #s1p-floating-controls a {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background-color: var(--s1p-bg);
      box-shadow: 0 2px 8px rgba(var(--s1p-shadow-color-rgb), 0.15);
      transition: all 0.2s ease-in-out;
      padding: 0;
      box-sizing: border-box;
    }
    #s1p-floating-controls a:hover {
      background-color: var(--s1p-pri);
      transform: scale(1.1);
      fill-opacity: 1;
    }
    #s1p-floating-controls a svg {
      width: 18px;
      height: 18px;
      color: var(--s1p-t);
      fill-opacity: 0.5;
    }
    #s1p-floating-controls a svg:hover {
      fill-opacity: 1;
    }
    #s1p-floating-controls a.s1p-scroll-btn svg {
      width: 22px;
      height: 22px;
      fill-opacity: 0.5;
    }
    #s1p-floating-controls a.s1p-scroll-btn svg:hover {
      fill-opacity: 1;
    }
    /* --- [更新] 回复收藏内容切换 V3 --- */
    .s1p-bookmark-preview,
    .s1p-bookmark-full {
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

    /* --- [修改] 收藏夹内帖子跳转链接样式 --- */
    .s1p-bookmark-meta-line {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
    }
    .s1p-bookmark-meta-line > span {
      flex-shrink: 0;
      white-space: nowrap;
    }
    .s1p-bookmark-thread-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      text-decoration: none;
      font-weight: 500;
      color: var(--s1p-desc-t);
      transition: color 0.2s ease;
      min-width: 0; /* 核心修复：允许此弹性项目收缩至小于其内容宽度 */
    }
    .s1p-bookmark-thread-link:hover {
      color: var(--s1p-sec);
      text-decoration: underline;
    }
    .s1p-bookmark-thread-link svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0; /* 防止图标被压缩 */
    }
    .s1p-bookmark-title-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* --- [修改] 阅读进度提示条 - 渐变动画 --- */
    @keyframes s1p-indicator-fade-in {
      from {
        opacity: 0;
        /* 保持垂直居中，并从一个轻微的放大状态恢复，使出现动画更柔和 */
        transform: translateY(-50%) scale(1.05);
      }
      to {
        opacity: 1;
        transform: translateY(-50%) scale(1);
      }
    }
    @keyframes s1p-indicator-fade-out {
      from {
        opacity: 1;
        transform: translateY(-50%) scale(1);
      }
      to {
        opacity: 0;
        /* 消失时轻微缩小，使其更自然 */
        transform: translateY(-50%) scale(0.95);
      }
    }
    .s1p-read-indicator.s1p-anim-appear {
      /* 使用新的 fade-in 动画，时长0.3秒 */
      animation: s1p-indicator-fade-in 0.3s ease-out forwards;
    }
    .s1p-read-indicator.s1p-anim-disappear {
      /* 使用新的 fade-out 动画，时长0.25秒 */
      animation: s1p-indicator-fade-out 0.25s ease-in forwards;
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
      box-shadow: 0 0 4px rgba(var(--s1p-shadow-color-rgb), 0.1);
      line-height: 1;
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
    @media (max-width: ${NARROW_SCREEN_MAX_WIDTH_PX}px) {
      /* 窄屏时将“当前阅读位置”压缩为小图标，避免遮挡工具栏按钮 */
      .s1p-read-indicator {
        gap: 0;
        padding: 4px;
        border-radius: 999px;
      }
      .s1p-read-indicator > span:not(.s1p-read-indicator-icon) {
        display: none;
      }
      .s1p-read-indicator-icon {
        width: 12px;
        height: 12px;
        top: 0;
      }
    }
    /* --- [新增] S1 NUX 推荐弹窗按钮专属样式 --- */
    .s1p-nux-recommend-modal .s1p-confirm-btn.s1p-confirm:hover {
      background-color: var(--s1p-sub-h);
      color: var(--s1p-white);
      border-color: transparent;
    }
    .s1p-nux-recommend-modal .s1p-confirm-btn.s1p-cancel:hover {
      background-color: var(--s1p-red-h);
      color: var(--s1p-white);
      border-color: transparent;
    }

    /* --- [新增] 深色模式样式覆写 --- */
    @media (prefers-color-scheme: dark) {
      :root {
        /* 将阅读进度条背景改为更柔和的橄榄绿 */
        --s1p-readprogress-bg: #99a17a;
        /* [移除] --s1p-list-item-status-bg 的覆写：该变量在系统深色模式但 NUX 禁用时会导致标识背景过深 */

        /* -- 用户标记颜色 (深色模式) -- */
        --s1p-tag-red: #F87171;
        --s1p-tag-orange: #FB923C;
        --s1p-tag-yellow: #FACC15;
        --s1p-tag-green: #10B981;
        --s1p-tag-blue: #60A5FA;
        --s1p-tag-purple: #A78BFA;

        /* -- 用户名高亮 (深色模式) -- */
        --s1p-username-bg: #3F4F3A;
        --s1p-username-text: #E5E7EB;

        --s1p-border: #4b5563;
        --s1p-hover-overlay: rgba(255, 255, 255, 0.15);
        --s1p-progress-delete-bg: var(--s1p-progress-hot);
        --s1p-progress-delete-hover-bg: rgb(154, 41, 28);
        --s1p-progress-delete-text: #ffffff;
        --s1p-image-viewer-viewport-bg: rgba(var(--s1p-black-rgb), 0.78);
      }

      /* [移除] 删除按钮白色图标覆写：在系统深色模式但 NUX 禁用时会导致图标不可见 */

      /* --- [新增] 深色模式阴影适配 --- */
      .s1p-segmented-control-slider {
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }
      .s1p-segmented-control:hover .s1p-segmented-control-slider {
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
      }
      .s1p-btn,
      .s1p-confirm-btn,
      .s1p-inline-toggle-btn {
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.05);
      }
      .s1p-btn:hover,
      .s1p-confirm-btn:hover,
      .s1p-inline-toggle-btn:hover {
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.07);
      }
      .s1p-options-menu,
      .s1p-inline-action-menu {
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      }
      .s1p-tag-popover {
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
      }
      .s1p-generic-display-popover {
        box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
      }
      .s1p-tag-options-menu {
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
      }
      .s1p-modal-content {
        box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
      }
      .s1p-tab-slider {
        background-color: #2f3a46;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
      }
      .s1p-tab-btn.active {
        color: #e5edf6;
      }
      .s1p-toast-notification {
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      }
      .s1p-confirm-content {
        box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.3);
      }
      .s1p-slider:before {
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      }
      .s1p-read-indicator {
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      }
      #s1p-controls-handle {
        box-shadow: -2px 2px 8px rgba(0, 0, 0, 0.25);
      }
      #s1p-floating-controls a {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .s1p-toast-notification {
        background-color: #303030;
        /* color: var(--s1p-bg); */
      }
      .s1p-toast-notification.success {
        /* 使用一个更柔和的绿色 */
        background-color: var(--s1p-green-h);
      }
      .s1p-toast-notification.error {
        /* 使用一个更深的红色 */
        background-color: var(--s1p-red-h);
      }

      .s1p-authi-actions-wrapper > a.s1p-toolbar-icon-btn:hover,
      .authi a.s1p-toolbar-icon-btn:hover {
        background-color: var(--s1p-hover-overlay);
      }

      /* --- [新增] 深色模式下更柔和的警告文本颜色 --- */
      .s1p-warning-text {
        color: #f87171; /* A softer, less jarring red for dark backgrounds */
      }
      /* [移除] 输入框深色聚焦背景覆写：在系统深色模式但 NUX 禁用时会导致输入框背景过深 */
    }

    /* --- [新增] NUX 深色主题下的帖子黑字可读性修复 --- */
    .s1p-nux-dark-text-fixed {
      color: var(--t, #d1d5db) !important;
      -webkit-text-fill-color: var(--t, #d1d5db) !important;
    }
  `);

  // --- S1 NUX 兼容性检测 ---
  let isS1NuxEnabled = false;
  const NUX_DARK_TEXT_MIN_CONTRAST_RATIO = 2.8;
  const NUX_DARK_TEXT_FIX_CLASS = "s1p-nux-dark-text-fixed";
  const NUX_DARK_TEXT_CANDIDATE_SELECTOR =
    [
      "td.t_f [style*='color:']",
      "td.t_f [style*='-webkit-text-fill-color']",
      "td.t_f font[color]",
      "td.t_f span[color]",
      "td.t_f a[color]",
      "td.t_f p[color]",
      "td.t_f div[color]",
      "td.t_f em[color]",
      "td.t_f strong[color]",
      "td.t_f b[color]",
      "td.t_f i[color]",
      "td.t_f u[color]",
      "td.t_f li[color]",
      "td.t_f blockquote[color]",
    ].join(", ");
  const NUX_DARK_TEXT_IGNORED_TAGS = new Set([
    "IMG",
    "VIDEO",
    "SVG",
    "PATH",
    "CODE",
    "PRE",
    "SCRIPT",
    "STYLE",
    "IFRAME",
    "INPUT",
    "TEXTAREA",
    "BUTTON",
  ]);
  const NUX_SEGMENTED_CONTRAST_FIX_CLASS = "s1p-nux-segmented-contrast-fix";
  const NUX_VINE_TAB_TONE_CLASS = "s1p-nux-vine-tab-tone";
  const NUX_SEGMENTED_ACTIVE_TEXT_COLOR_VAR =
    "--s1p-segmented-active-contrast-text";
  const NUX_SEGMENTED_LOW_CONTRAST_SEC_SIGNATURES = [
    { r: 255, g: 182, b: 8 },   // blueprint
    { r: 54, g: 255, b: 114 },  // vine
    { r: 199, g: 232, b: 11 },  // jungle
  ];
  const NUX_VINE_SEC_SIGNATURE = { r: 54, g: 255, b: 114 };
  const NUX_THEME_SEC_SIGNATURE_TOLERANCE = 3;
  let isNuxDarkModeChangeListenerBound = false;

  const parseRgbaColor = (colorText) => {
    const colorTextSafe = String(colorText || "").trim();
    const hexMatch = colorTextSafe.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      const expandHex = (input) =>
        input.length <= 4
          ? input
            .split("")
            .map((char) => `${char}${char}`)
            .join("")
          : input;
      const normalizedHex = expandHex(hex);
      const hasAlpha = normalizedHex.length === 8;
      const alphaHex = hasAlpha ? normalizedHex.slice(6, 8) : "ff";
      return {
        r: Number.parseInt(normalizedHex.slice(0, 2), 16),
        g: Number.parseInt(normalizedHex.slice(2, 4), 16),
        b: Number.parseInt(normalizedHex.slice(4, 6), 16),
        a: Number.parseInt(alphaHex, 16) / 255,
      };
    }
    const rgbMatch = colorTextSafe.match(
      /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i
    );
    if (!rgbMatch) {
      return null;
    }

    const toChannel = (raw) =>
      Math.max(0, Math.min(255, Math.round(Number.parseFloat(raw))));
    const alphaRaw = Number.parseFloat(rgbMatch[4]);
    return {
      r: toChannel(rgbMatch[1]),
      g: toChannel(rgbMatch[2]),
      b: toChannel(rgbMatch[3]),
      a: Number.isFinite(alphaRaw) ? Math.max(0, Math.min(1, alphaRaw)) : 1,
    };
  };

  const toLinearSrgb = (channel) => {
    const normalized = Math.max(0, Math.min(255, channel)) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const getRelativeLuminance = (color) =>
    0.2126 * toLinearSrgb(color.r) +
    0.7152 * toLinearSrgb(color.g) +
    0.0722 * toLinearSrgb(color.b);

  const getContrastRatio = (colorA, colorB) => {
    const luminanceA = getRelativeLuminance(colorA);
    const luminanceB = getRelativeLuminance(colorB);
    const lighter = Math.max(luminanceA, luminanceB);
    const darker = Math.min(luminanceA, luminanceB);
    return (lighter + 0.05) / (darker + 0.05);
  };

  const blendRgbaOver = (foreground, background) => {
    const fgAlpha = Math.max(0, Math.min(1, Number(foreground.a) || 0));
    const bgAlpha = Math.max(0, Math.min(1, Number(background.a) || 1));
    const outAlpha = fgAlpha + bgAlpha * (1 - fgAlpha);
    if (outAlpha <= 0) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    return {
      r: Math.round(
        (foreground.r * fgAlpha + background.r * bgAlpha * (1 - fgAlpha)) /
        outAlpha
      ),
      g: Math.round(
        (foreground.g * fgAlpha + background.g * bgAlpha * (1 - fgAlpha)) /
        outAlpha
      ),
      b: Math.round(
        (foreground.b * fgAlpha + background.b * bgAlpha * (1 - fgAlpha)) /
        outAlpha
      ),
      a: outAlpha,
    };
  };

  const isNuxDarkThemeActive = () => {
    if (!isS1NuxEnabled) {
      return false;
    }
    const rootStyle = window.getComputedStyle(document.documentElement);
    const darkThemeRaw = rootStyle.getPropertyValue("--darktheme").trim();
    const darkThemeFlag = Number.parseInt(darkThemeRaw, 10);
    if (Number.isFinite(darkThemeFlag)) {
      return darkThemeFlag === 1;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  };

  const isColorClose = (colorA, colorB, tolerance = 0) =>
    Math.abs(colorA.r - colorB.r) <= tolerance &&
    Math.abs(colorA.g - colorB.g) <= tolerance &&
    Math.abs(colorA.b - colorB.b) <= tolerance;

  const resolveNuxSecColor = () => {
    const rootStyle = window.getComputedStyle(document.documentElement);
    return parseRgbaColor(rootStyle.getPropertyValue("--sec"));
  };

  const shouldApplyNuxSegmentedContrastFix = () => {
    if (!isNuxDarkThemeActive()) {
      return false;
    }
    const secColor = resolveNuxSecColor();
    if (!secColor || secColor.a <= 0.08) {
      return false;
    }
    return NUX_SEGMENTED_LOW_CONTRAST_SEC_SIGNATURES.some((signature) =>
      isColorClose(secColor, signature, NUX_THEME_SEC_SIGNATURE_TOLERANCE)
    );
  };

  const applyNuxSegmentedContrastFix = (settingsModal = null) => {
    const targetModal = settingsModal || document.querySelector(".s1p-modal");
    if (!(targetModal instanceof HTMLElement)) {
      return;
    }
    const shouldApply = shouldApplyNuxSegmentedContrastFix();
    targetModal.classList.toggle(NUX_SEGMENTED_CONTRAST_FIX_CLASS, shouldApply);
    if (shouldApply) {
      const rootStyle = window.getComputedStyle(document.documentElement);
      const textColor = rootStyle.getPropertyValue("--icl").trim() || "#111827";
      targetModal.style.setProperty(NUX_SEGMENTED_ACTIVE_TEXT_COLOR_VAR, textColor);
    } else {
      targetModal.style.removeProperty(NUX_SEGMENTED_ACTIVE_TEXT_COLOR_VAR);
    }
  };

  const applyNuxVineTabToneFix = (settingsModal = null) => {
    const targetModal = settingsModal || document.querySelector(".s1p-modal");
    if (!(targetModal instanceof HTMLElement)) {
      return;
    }
    const secColor = resolveNuxSecColor();
    const isVineBySecColor =
      !!secColor &&
      secColor.a > 0.08 &&
      isColorClose(
        secColor,
        NUX_VINE_SEC_SIGNATURE,
        NUX_THEME_SEC_SIGNATURE_TOLERANCE
      );
    targetModal.classList.toggle(NUX_VINE_TAB_TONE_CLASS, isVineBySecColor);
  };

  const resolveFallbackBackgroundColor = () => {
    const bodyColor = parseRgbaColor(
      window.getComputedStyle(document.body || document.documentElement).backgroundColor
    );
    const rootColor = parseRgbaColor(
      window.getComputedStyle(document.documentElement).backgroundColor
    );
    const fallback =
      (bodyColor && bodyColor.a > 0.02 && bodyColor) ||
      (rootColor && rootColor.a > 0.02 && rootColor) ||
      { r: 22, g: 22, b: 22, a: 1 };
    return { r: fallback.r, g: fallback.g, b: fallback.b, a: 1 };
  };

  const resolveEffectiveBackgroundColor = (element, stopNode = null) => {
    const fallback = resolveFallbackBackgroundColor();
    let current = element;
    while (current instanceof Element) {
      const bgColor = parseRgbaColor(window.getComputedStyle(current).backgroundColor);
      if (bgColor && bgColor.a > 0.02) {
        if (bgColor.a >= 0.995) {
          return { r: bgColor.r, g: bgColor.g, b: bgColor.b, a: 1 };
        }
        return blendRgbaOver(bgColor, fallback);
      }
      if (current === stopNode) {
        break;
      }
      current = current.parentElement;
    }
    return fallback;
  };

  const shouldApplyNuxDarkTextFix = (node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if (NUX_DARK_TEXT_IGNORED_TAGS.has(node.tagName)) {
      return false;
    }
    if (!/\S/.test(node.textContent || "")) {
      return false;
    }

    const inlineColorText = String(node.style.color || "").trim();
    const inlineTextFillColorText = String(node.style.webkitTextFillColor || "").trim();
    const hasInlineColor = inlineColorText.length > 0 || inlineTextFillColorText.length > 0;
    const hasLegacyColorAttr = node.hasAttribute("color");
    if (!hasInlineColor && !hasLegacyColorAttr) {
      return false;
    }

    const textColor = parseRgbaColor(window.getComputedStyle(node).color);
    if (!textColor || textColor.a <= 0.08) {
      return false;
    }

    const postContent = node.closest("td.t_f");
    const backgroundColor = resolveEffectiveBackgroundColor(node, postContent);
    const contrastRatio = getContrastRatio(textColor, backgroundColor);
    if (contrastRatio >= NUX_DARK_TEXT_MIN_CONTRAST_RATIO) {
      return false;
    }

    const textLuminance = getRelativeLuminance(textColor);
    const backgroundLuminance = getRelativeLuminance(backgroundColor);
    if (textLuminance > backgroundLuminance || backgroundLuminance > 0.55) {
      return false;
    }

    return true;
  };

  const applyNuxDarkTextContrastFix = (postTables = null) => {
    const targetPostTables = Array.isArray(postTables)
      ? postTables.filter((table) => table instanceof Element)
      : null;
    const collectBySelector = (selector) => {
      if (!targetPostTables) {
        return Array.from(document.querySelectorAll(selector));
      }
      const nodes = [];
      const seen = new Set();
      targetPostTables.forEach((table) => {
        if (!(table instanceof Element)) return;
        if (table.matches(selector) && !seen.has(table)) {
          seen.add(table);
          nodes.push(table);
        }
        table.querySelectorAll(selector).forEach((node) => {
          if (seen.has(node)) return;
          seen.add(node);
          nodes.push(node);
        });
      });
      return nodes;
    };

    if (!isNuxDarkThemeActive()) {
      collectBySelector(`.${NUX_DARK_TEXT_FIX_CLASS}`).forEach((node) => {
        node.classList.remove(NUX_DARK_TEXT_FIX_CLASS);
      });
      return;
    }

    collectBySelector(`.${NUX_DARK_TEXT_FIX_CLASS}`).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      if (!node.matches(NUX_DARK_TEXT_CANDIDATE_SELECTOR)) {
        node.classList.remove(NUX_DARK_TEXT_FIX_CLASS);
      }
    });

    collectBySelector(NUX_DARK_TEXT_CANDIDATE_SELECTOR).forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      node.classList.toggle(NUX_DARK_TEXT_FIX_CLASS, shouldApplyNuxDarkTextFix(node));
    });
  };

  const bindNuxDarkModeChangeListener = () => {
    if (isNuxDarkModeChangeListenerBound || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleNuxDarkModeChange = () => {
      if (!isS1NuxEnabled) {
        return;
      }
      applyNuxDarkTextContrastFix();
      applyNuxSegmentedContrastFix();
      applyNuxVineTabToneFix();
    };
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleNuxDarkModeChange);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(handleNuxDarkModeChange);
    } else {
      return;
    }
    isNuxDarkModeChangeListenerBound = true;
  };

  const detectS1Nux = () => {
    const archiverLink = document.querySelector('a[href*="archiver"]');
    if (archiverLink) {
      const style = window.getComputedStyle(archiverLink, "::before");
      if (style && style.content.includes("NUXISENABLED")) {
        console.log("S1 Plus: S1 NUX is enabled");
        isS1NuxEnabled = true;

        // [新增] 仅当 NUX 启用时才注入深色模式专用样式，避免影响 NUX 禁用时的浅色模式
        GM_addStyle(`
          @media (prefers-color-scheme: dark) {
            /* 输入框焦点：使用深灰色背景 */
            .s1p-input:focus {
              background-color: #3e3d3d;
              border-color: var(--s1p-sec-h);
            }
            /* 删除按钮：使用白色图标 */
            .s1p-editor-btn.s1p-delete-button {
              background-image: url("${SVG_ICON_DELETE_HOVER}") !important;
            }
            /* 状态标识：使用深色背景和浅色文字 */
            :root {
              --s1p-list-item-status-bg: #3e3d3d;
              --s1p-list-item-status-text: #d1d5db;
            }
          }
        `);
        bindNuxDarkModeChangeListener();
      } else {
        console.log("S1 Plus: S1 NUX is not enabled");
      }
    }
  };

  let dynamicallyHiddenThreads = {};

  const invalidateLocalDataHashCache = () => {
    localDataHashCache = {
      cacheKey: null,
      contentHash: null,
      baseContentHash: null,
    };
  };

  const SYNC_DIAGNOSTICS_DEFAULT = Object.freeze({
    lastAttemptTimestamp: 0,
    lastSuccessTimestamp: 0,
    lastFailureTimestamp: 0,
    lastFailureReason: "",
    consecutiveFailureCount: 0,
    lastActionType: "",
    lastConflictTimestamp: 0,
  });
  const normalizeSyncDiagnostics = (value) => {
    const source =
      value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    const normalizeTimestamp = (rawValue) => {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    };
    const normalizeCount = (rawValue) => {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
    };
    const normalizeText = (rawValue, maxLength = 220) =>
      String(rawValue || "")
        .replace(/\s+/g, " ")
        .replace(/[<>]/g, "")
        .slice(0, maxLength);

    return {
      lastAttemptTimestamp: normalizeTimestamp(source.lastAttemptTimestamp),
      lastSuccessTimestamp: normalizeTimestamp(source.lastSuccessTimestamp),
      lastFailureTimestamp: normalizeTimestamp(source.lastFailureTimestamp),
      lastFailureReason: normalizeText(source.lastFailureReason, 500),
      consecutiveFailureCount: normalizeCount(source.consecutiveFailureCount),
      lastActionType: normalizeText(source.lastActionType, 120),
      lastConflictTimestamp: normalizeTimestamp(source.lastConflictTimestamp),
    };
  };
  const getSyncDiagnostics = () => {
    return normalizeSyncDiagnostics(
      GM_getValue(SYNC_DIAGNOSTICS_KEY, SYNC_DIAGNOSTICS_DEFAULT)
    );
  };

  const saveSyncDiagnostics = (nextDiagnostics) => {
    const normalizedDiagnostics = normalizeSyncDiagnostics(nextDiagnostics);
    const currentDiagnostics = normalizeSyncDiagnostics(
      GM_getValue(SYNC_DIAGNOSTICS_KEY, SYNC_DIAGNOSTICS_DEFAULT)
    );
    const currentSignature = JSON.stringify(
      deterministicSort(currentDiagnostics)
    );
    const nextSignature = JSON.stringify(
      deterministicSort(normalizedDiagnostics)
    );
    if (currentSignature === nextSignature) {
      return;
    }
    GM_setValue(SYNC_DIAGNOSTICS_KEY, normalizedDiagnostics);
  };

  const resetSyncDiagnostics = () => {
    GM_setValue(SYNC_DIAGNOSTICS_KEY, { ...SYNC_DIAGNOSTICS_DEFAULT });
  };

  const formatSyncTime = (timestamp) => {
    if (!timestamp || timestamp <= 0) return "—";
    return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
  };

  const sanitizeDiagnosticText = (text, maxLength = 220) =>
    String(text || "")
      .replace(/\s+/g, " ")
      .replace(/[<>]/g, "")
      .slice(0, maxLength);

  const buildSyncDiagnosticsSummary = () => {
    const diagnostics = getSyncDiagnostics();
    const lines = [
      `S1 Plus 同步诊断快照`,
      `版本: ${SCRIPT_VERSION} (${SCRIPT_RELEASE_DATE})`,
      `最近动作: ${diagnostics.lastActionType || "—"}`,
      `最近尝试: ${formatSyncTime(diagnostics.lastAttemptTimestamp)}`,
      `最近成功: ${formatSyncTime(diagnostics.lastSuccessTimestamp)}`,
      `最近冲突: ${formatSyncTime(diagnostics.lastConflictTimestamp)}`,
      `最近失败: ${formatSyncTime(diagnostics.lastFailureTimestamp)}`,
      `连续失败: ${diagnostics.consecutiveFailureCount || 0}`,
      `失败原因: ${diagnostics.lastFailureReason
        ? sanitizeDiagnosticText(diagnostics.lastFailureReason, 500)
        : "—"
      }`,
    ];
    return lines.join("\n");
  };

  const recordSyncAttempt = (mode = "background", trigger = "auto") => {
    const current = getSyncDiagnostics();
    saveSyncDiagnostics({
      ...current,
      lastAttemptTimestamp: Date.now(),
      lastActionType: `${mode}:${trigger}:attempt`,
    });
  };

  const recordSyncSuccess = (action, mode = "background") => {
    const current = getSyncDiagnostics();
    saveSyncDiagnostics({
      ...current,
      lastSuccessTimestamp: Date.now(),
      consecutiveFailureCount: 0,
      lastFailureReason: "",
      lastActionType: `${mode}:${action}`,
    });
  };

  const recordSyncFailure = (reason, mode = "background") => {
    const current = getSyncDiagnostics();
    saveSyncDiagnostics({
      ...current,
      lastFailureTimestamp: Date.now(),
      lastFailureReason: sanitizeDiagnosticText(reason || "未知错误", 500),
      consecutiveFailureCount: (current.consecutiveFailureCount || 0) + 1,
      lastActionType: `${mode}:failure`,
    });
  };

  const recordSyncConflict = (reason, mode = "background") => {
    const current = getSyncDiagnostics();
    saveSyncDiagnostics({
      ...current,
      lastConflictTimestamp: Date.now(),
      lastActionType: `${mode}:conflict:${reason || "generic"}`,
    });
  };

  const getConflictModalCooldownLock = () => {
    const lock = GM_getValue(SYNC_CONFLICT_MODAL_COOLDOWN_LOCK_KEY, null);
    if (
      lock &&
      typeof lock === "object" &&
      lock.owner &&
      typeof lock.timestamp === "number"
    ) {
      return lock;
    }
    return null;
  };

  const isConflictModalCooldownLockValid = (lock, now = Date.now()) =>
    Boolean(
      lock &&
      typeof lock.timestamp === "number" &&
      now - lock.timestamp < SYNC_CONFLICT_MODAL_COOLDOWN_LOCK_TTL_MS
    );

  const acquireConflictModalCooldownLock = async () => {
    const now = Date.now();
    const currentLock = getConflictModalCooldownLock();
    const currentLockIsValid = isConflictModalCooldownLockValid(currentLock, now);

    if (
      currentLockIsValid &&
      currentLock.owner !== BACKGROUND_SYNC_OWNER_ID
    ) {
      return false;
    }

    GM_setValue(SYNC_CONFLICT_MODAL_COOLDOWN_LOCK_KEY, {
      owner: BACKGROUND_SYNC_OWNER_ID,
      timestamp: now,
    });

    return verifySyncLockOwnership(() => {
      const verifiedLock = getConflictModalCooldownLock();
      return Boolean(
        verifiedLock &&
        verifiedLock.owner === BACKGROUND_SYNC_OWNER_ID &&
        isConflictModalCooldownLockValid(verifiedLock)
      );
    });
  };

  const releaseConflictModalCooldownLock = () => {
    const currentLock = getConflictModalCooldownLock();
    if (currentLock && currentLock.owner === BACKGROUND_SYNC_OWNER_ID) {
      GM_deleteValue(SYNC_CONFLICT_MODAL_COOLDOWN_LOCK_KEY);
    }
  };

  const shouldShowConflictModal = async (type = "generic") => {
    if (!(await acquireConflictModalCooldownLock())) {
      return false;
    }

    try {
      const normalizedType = String(type || "generic");
      const cooldownGroup =
        SYNC_CONFLICT_MODAL_COOLDOWN_GROUP_MAP[normalizedType] || normalizedType;
      const key = `s1p_last_conflict_modal_ts_${cooldownGroup}`;
      const now = Date.now();
      const lastShown = GM_getValue(key, 0);
      if (now - lastShown < SYNC_CONFLICT_MODAL_COOLDOWN_MS) {
        return false;
      }
      GM_setValue(key, now);
      return true;
    } finally {
      releaseConflictModalCooldownLock();
    }
  };

  const getAutoSyncCircuitState = () => {
    const openUntil = GM_getValue(AUTO_SYNC_CIRCUIT_OPEN_UNTIL_KEY, 0);
    const now = Date.now();
    if (openUntil > now) {
      return { open: true, until: openUntil };
    }
    if (openUntil > 0) {
      GM_deleteValue(AUTO_SYNC_CIRCUIT_OPEN_UNTIL_KEY);
      GM_setValue(AUTO_SYNC_FAILURE_COUNT_KEY, 0);
    }
    return { open: false, until: 0 };
  };

  const resetAutoSyncFailureState = () => {
    GM_setValue(AUTO_SYNC_FAILURE_COUNT_KEY, 0);
    GM_deleteValue(AUTO_SYNC_CIRCUIT_OPEN_UNTIL_KEY);
  };

  const normalizeAutoSyncIndicatorPhase = (
    phase,
    { allowRunning = true, allowPending = true } = {}
  ) => {
    switch (String(phase || "").trim()) {
      case AUTO_SYNC_INDICATOR_PHASE_IDLE:
        return AUTO_SYNC_INDICATOR_PHASE_IDLE;
      case AUTO_SYNC_INDICATOR_PHASE_PENDING:
        return allowPending ? AUTO_SYNC_INDICATOR_PHASE_PENDING : "";
      case AUTO_SYNC_INDICATOR_PHASE_RUNNING:
        return allowRunning ? AUTO_SYNC_INDICATOR_PHASE_RUNNING : "";
      case AUTO_SYNC_INDICATOR_PHASE_SUCCESS:
        return AUTO_SYNC_INDICATOR_PHASE_SUCCESS;
      case AUTO_SYNC_INDICATOR_PHASE_FAILURE:
        return AUTO_SYNC_INDICATOR_PHASE_FAILURE;
      case AUTO_SYNC_INDICATOR_PHASE_CONFLICT:
        return AUTO_SYNC_INDICATOR_PHASE_CONFLICT;
      default:
        return "";
    }
  };

  const normalizeAutoSyncIndicatorState = (rawValue = null) => {
    const raw =
      rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
        ? rawValue
        : {};
    const phase =
      normalizeAutoSyncIndicatorPhase(raw.phase, { allowRunning: true }) ||
      AUTO_SYNC_INDICATOR_PHASE_IDLE;
    const timestamp = Number(raw.timestamp) || 0;
    const token = typeof raw.token === "string" ? raw.token : "";

    const fallbackResolvedPhase =
      phase === AUTO_SYNC_INDICATOR_PHASE_RUNNING ||
        phase === AUTO_SYNC_INDICATOR_PHASE_PENDING
        ? AUTO_SYNC_INDICATOR_PHASE_IDLE
        : normalizeAutoSyncIndicatorPhase(phase, {
          allowRunning: false,
          allowPending: false,
        }) ||
        AUTO_SYNC_INDICATOR_PHASE_IDLE;

    const lastResolvedPhase =
      normalizeAutoSyncIndicatorPhase(raw.lastResolvedPhase, {
        allowRunning: false,
        allowPending: false,
      }) || fallbackResolvedPhase;
    const lastResolvedTimestamp =
      Number(raw.lastResolvedTimestamp) ||
      (phase === AUTO_SYNC_INDICATOR_PHASE_RUNNING ||
        phase === AUTO_SYNC_INDICATOR_PHASE_PENDING
        ? 0
        : timestamp);

    return {
      phase,
      timestamp,
      token,
      lastResolvedPhase,
      lastResolvedTimestamp,
    };
  };

  const getAutoSyncIndicatorState = () =>
    normalizeAutoSyncIndicatorState(
      GM_getValue(AUTO_SYNC_INDICATOR_STATE_KEY, null)
    );

  const hasActiveBackgroundSyncLock = (now = Date.now()) => {
    const backgroundLock = getBackgroundSyncLockValue();
    const globalLock = getGlobalSyncLockValue();
    return (
      isModeSyncLockValid(backgroundLock, BACKGROUND_SYNC_LOCK_TTL_MS, now) ||
      Boolean(
        globalLock &&
        globalLock.mode === SYNC_LOCK_MODE_BACKGROUND &&
        isGlobalSyncLockValid(globalLock, now)
      )
    );
  };

  const hasActivePendingAutoSyncRequest = () => {
    const pending = GM_getValue(PENDING_AUTO_SYNC_KEY, null);
    return Boolean(pending && typeof pending === "object");
  };

  const getAutoSyncIndicatorResolvedTtlMs = (phase) => {
    switch (phase) {
      case AUTO_SYNC_INDICATOR_PHASE_SUCCESS:
        return AUTO_SYNC_INDICATOR_SUCCESS_TTL_MS;
      case AUTO_SYNC_INDICATOR_PHASE_FAILURE:
        return AUTO_SYNC_INDICATOR_FAILURE_TTL_MS;
      case AUTO_SYNC_INDICATOR_PHASE_CONFLICT:
        return AUTO_SYNC_INDICATOR_CONFLICT_TTL_MS;
      default:
        return 0;
    }
  };

  let autoSyncIndicatorWriteInFlightCount = 0;

  const persistAutoSyncIndicatorState = (nextState) => {
    const normalized = normalizeAutoSyncIndicatorState(nextState);
    autoSyncIndicatorWriteInFlightCount += 1;
    try {
      GM_setValue(AUTO_SYNC_INDICATOR_STATE_KEY, normalized);
    } finally {
      autoSyncIndicatorWriteInFlightCount = Math.max(
        0,
        autoSyncIndicatorWriteInFlightCount - 1
      );
    }
    renderNavbarAutoSyncIndicator(normalized);
    return normalized;
  };

  const resolveAutoSyncIndicatorDisplayPhase = (stateInput = null) => {
    const state = stateInput
      ? normalizeAutoSyncIndicatorState(stateInput)
      : getAutoSyncIndicatorState();
    const now = Date.now();
    const hasActiveBackgroundLock = hasActiveBackgroundSyncLock(now);
    const hasPendingRequest = hasActivePendingAutoSyncRequest();
    const hasConflictPause = Boolean(getActiveAutoSyncConflictPause());
    const hasOpenCircuit = getAutoSyncCircuitState().open;
    const canShowPending = hasPendingRequest && !hasConflictPause && !hasOpenCircuit;

    if (hasActiveBackgroundLock) {
      return { ...state, displayPhase: AUTO_SYNC_INDICATOR_PHASE_RUNNING };
    }

    const resolveWithTtl = (phase, timestamp) => {
      const normalizedPhase = normalizeAutoSyncIndicatorPhase(phase, {
        allowRunning: false,
        allowPending: false,
      });
      if (!normalizedPhase || normalizedPhase === AUTO_SYNC_INDICATOR_PHASE_IDLE) {
        return AUTO_SYNC_INDICATOR_PHASE_IDLE;
      }
      if (
        normalizedPhase === AUTO_SYNC_INDICATOR_PHASE_CONFLICT &&
        getActiveAutoSyncConflictPause()
      ) {
        return AUTO_SYNC_INDICATOR_PHASE_CONFLICT;
      }
      const ttlMs = getAutoSyncIndicatorResolvedTtlMs(normalizedPhase);
      if (ttlMs <= 0) {
        return normalizedPhase;
      }
      return now - (Number(timestamp) || 0) <= ttlMs
        ? normalizedPhase
        : AUTO_SYNC_INDICATOR_PHASE_IDLE;
    };

    if (state.phase === AUTO_SYNC_INDICATOR_PHASE_RUNNING) {
      if (now - state.timestamp <= AUTO_SYNC_INDICATOR_RUNNING_STALE_MS) {
        return { ...state, displayPhase: AUTO_SYNC_INDICATOR_PHASE_RUNNING };
      }
      const fallbackPhase = resolveWithTtl(
        state.lastResolvedPhase,
        state.lastResolvedTimestamp
      );
      return {
        ...state,
        displayPhase:
          fallbackPhase === AUTO_SYNC_INDICATOR_PHASE_IDLE && canShowPending
            ? AUTO_SYNC_INDICATOR_PHASE_PENDING
            : fallbackPhase,
      };
    }

    if (state.phase === AUTO_SYNC_INDICATOR_PHASE_PENDING) {
      const shouldKeepPending =
        canShowPending || now - state.timestamp <= AUTO_SYNC_INDICATOR_PENDING_STALE_MS;
      if (shouldKeepPending) {
        return { ...state, displayPhase: AUTO_SYNC_INDICATOR_PHASE_PENDING };
      }
      const fallbackPhase = resolveWithTtl(
        state.lastResolvedPhase,
        state.lastResolvedTimestamp
      );
      return { ...state, displayPhase: fallbackPhase };
    }

    const resolvedPhase = resolveWithTtl(state.phase, state.timestamp);
    return {
      ...state,
      displayPhase:
        resolvedPhase === AUTO_SYNC_INDICATOR_PHASE_IDLE && canShowPending
          ? AUTO_SYNC_INDICATOR_PHASE_PENDING
          : resolvedPhase,
    };
  };

  const setAutoSyncIndicatorPendingPhase = (source = "background_queue") => {
    const current = getAutoSyncIndicatorState();
    if (current.phase === AUTO_SYNC_INDICATOR_PHASE_RUNNING) {
      return false;
    }

    const now = Date.now();
    // 对高频 pending 触发做短时去重，避免跨标签 GM 写入风暴。
    if (
      current.phase === AUTO_SYNC_INDICATOR_PHASE_PENDING &&
      now - (Number(current.timestamp) || 0) < 1000
    ) {
      return false;
    }
    persistAutoSyncIndicatorState({
      phase: AUTO_SYNC_INDICATOR_PHASE_PENDING,
      timestamp: now,
      token: current.token || "",
      source: String(source || "background_queue"),
      lastResolvedPhase:
        current.lastResolvedPhase || AUTO_SYNC_INDICATOR_PHASE_IDLE,
      lastResolvedTimestamp:
        Number(current.lastResolvedTimestamp) ||
        Number(current.timestamp) ||
        0,
    });
    return true;
  };

  const startBackgroundAutoSyncIndicatorCycle = (
    source = "background_local_change"
  ) => {
    const current = getAutoSyncIndicatorState();
    const lastResolvedPhase =
      current.phase === AUTO_SYNC_INDICATOR_PHASE_RUNNING
        ? current.lastResolvedPhase || AUTO_SYNC_INDICATOR_PHASE_IDLE
        : current.lastResolvedPhase ||
        normalizeAutoSyncIndicatorPhase(current.phase, {
            allowRunning: false,
            allowPending: false,
          }) ||
        AUTO_SYNC_INDICATOR_PHASE_IDLE;
    const lastResolvedTimestamp =
      current.phase === AUTO_SYNC_INDICATOR_PHASE_RUNNING
        ? current.lastResolvedTimestamp || current.timestamp || 0
        : current.lastResolvedTimestamp || current.timestamp || 0;

    const token = `${BACKGROUND_SYNC_OWNER_ID}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    persistAutoSyncIndicatorState({
      phase: AUTO_SYNC_INDICATOR_PHASE_RUNNING,
      timestamp: Date.now(),
      token,
      source: String(source || "background_local_change"),
      lastResolvedPhase,
      lastResolvedTimestamp,
    });
    return token;
  };

  const finishBackgroundAutoSyncIndicatorCycle = (token, phase) => {
    if (!token) {
      return false;
    }
    const current = getAutoSyncIndicatorState();
    if (current.token !== token) {
      if (
        current.phase === AUTO_SYNC_INDICATOR_PHASE_RUNNING &&
        !hasActiveBackgroundSyncLock()
      ) {
        const resolvedPhase =
          normalizeAutoSyncIndicatorPhase(phase, {
            allowRunning: false,
            allowPending: false,
          }) ||
          current.lastResolvedPhase ||
          AUTO_SYNC_INDICATOR_PHASE_IDLE;
        const now = Date.now();
        persistAutoSyncIndicatorState({
          phase: resolvedPhase,
          timestamp: now,
          token: current.token || token,
          lastResolvedPhase: resolvedPhase,
          lastResolvedTimestamp: now,
        });
        return true;
      }
      return false;
    }

    const resolvedPhase =
      normalizeAutoSyncIndicatorPhase(phase, {
        allowRunning: false,
        allowPending: false,
      }) ||
      current.lastResolvedPhase ||
      AUTO_SYNC_INDICATOR_PHASE_IDLE;
    const now = Date.now();
    persistAutoSyncIndicatorState({
      phase: resolvedPhase,
      timestamp: now,
      token,
      lastResolvedPhase: resolvedPhase,
      lastResolvedTimestamp: now,
    });
    return true;
  };

  const setAutoSyncIndicatorResolvedPhase = (phase) => {
    const resolvedPhase = normalizeAutoSyncIndicatorPhase(phase, {
      allowRunning: false,
      allowPending: false,
    });
    if (!resolvedPhase) {
      return false;
    }
    const current = getAutoSyncIndicatorState();
    const now = Date.now();
    persistAutoSyncIndicatorState({
      phase: resolvedPhase,
      timestamp: now,
      token: current.token || "",
      lastResolvedPhase: resolvedPhase,
      lastResolvedTimestamp: now,
    });
    return true;
  };

  const getAutoSyncIndicatorPhaseFromResult = (result = null) => {
    if (!result || typeof result !== "object") {
      return "";
    }
    switch (result.status) {
      case "success":
        return AUTO_SYNC_INDICATOR_PHASE_SUCCESS;
      case "failure":
        return AUTO_SYNC_INDICATOR_PHASE_FAILURE;
      case "conflict":
        return AUTO_SYNC_INDICATOR_PHASE_CONFLICT;
      case "skipped":
        if (result.reason === "conflict_paused") {
          return AUTO_SYNC_INDICATOR_PHASE_CONFLICT;
        }
        if (result.reason === "circuit_open") {
          return AUTO_SYNC_INDICATOR_PHASE_FAILURE;
        }
        return "";
      default:
        return "";
    }
  };

  const getAutoSyncConflictPauseState = () => {
    const saved = GM_getValue(AUTO_SYNC_CONFLICT_PAUSE_KEY, null);
    if (
      !saved ||
      typeof saved !== "object" ||
      saved.paused !== true
    ) {
      return { paused: false, reason: "", timestamp: 0 };
    }
    return {
      paused: true,
      reason: String(saved.reason || ""),
      timestamp: Number(saved.timestamp) || 0,
    };
  };

  const setAutoSyncConflictPause = (reason = "generic") => {
    GM_setValue(AUTO_SYNC_CONFLICT_PAUSE_KEY, {
      paused: true,
      reason: String(reason || "generic"),
      timestamp: Date.now(),
    });
  };

  const clearAutoSyncConflictPause = () => {
    GM_deleteValue(AUTO_SYNC_CONFLICT_PAUSE_KEY);
  };

  const getActiveAutoSyncConflictPause = () => {
    const pauseState = getAutoSyncConflictPauseState();
    return pauseState.paused ? pauseState : null;
  };

  const registerAutoSyncFailure = (mode = "background") => {
    if (mode !== "background" && mode !== "startup") {
      return { count: 0, opened: false };
    }

    const nextCount = GM_getValue(AUTO_SYNC_FAILURE_COUNT_KEY, 0) + 1;
    GM_setValue(AUTO_SYNC_FAILURE_COUNT_KEY, nextCount);

    if (nextCount < AUTO_SYNC_CIRCUIT_BREAKER_THRESHOLD) {
      return { count: nextCount, opened: false };
    }

    const currentCircuit = getAutoSyncCircuitState();
    if (currentCircuit.open) {
      return { count: nextCount, opened: false, until: currentCircuit.until };
    }

    const until = Date.now() + AUTO_SYNC_CIRCUIT_OPEN_DURATION_MS;
    GM_setValue(AUTO_SYNC_CIRCUIT_OPEN_UNTIL_KEY, until);
    showMessage(
      `自动同步连续失败 ${nextCount} 次，已暂停约 ${Math.round(
        AUTO_SYNC_CIRCUIT_OPEN_DURATION_MS / 60000
      )} 分钟。请先手动同步排查问题。`,
      false
    );
    return { count: nextCount, opened: true, until };
  };

  const markPendingAutoSyncRequest = (source = "general", lastModified = null) => {
    GM_setValue(PENDING_AUTO_SYNC_KEY, {
      source: String(source || "general"),
      lastModified:
        typeof lastModified === "number"
          ? lastModified
          : GM_getValue("s1p_last_modified", 0),
      createdAt: Date.now(),
    });
  };

  const clearPendingAutoSyncRequest = () => {
    GM_deleteValue(PENDING_AUTO_SYNC_KEY);
  };

  const recoverPendingAutoSyncIfNeeded = () => {
    const pending = GM_getValue(PENDING_AUTO_SYNC_KEY, null);
    if (!pending || typeof pending !== "object") {
      return;
    }

    const diagnostics = getSyncDiagnostics();
    const pendingCreatedAt =
      typeof pending.createdAt === "number" ? pending.createdAt : 0;
    if (
      diagnostics.lastConflictTimestamp > 0 &&
      pendingCreatedAt > 0 &&
      pendingCreatedAt <= diagnostics.lastConflictTimestamp
    ) {
      clearPendingAutoSyncRequest();
      return;
    }

    const settings = getSettings();
    if (
      !settings.syncRemoteEnabled ||
      !settings.syncAutoEnabled ||
      !settings.syncRemoteGistId ||
      !settings.syncRemotePat
    ) {
      return;
    }

    if (getActiveAutoSyncConflictPause()) {
      return;
    }

    const pendingLastModified =
      typeof pending.lastModified === "number" ? pending.lastModified : 0;
    const currentLastModified = GM_getValue("s1p_last_modified", 0);
    const effectiveLastModified = Math.max(pendingLastModified, currentLastModified);
    const lastSyncTs = GM_getValue("s1p_last_sync_timestamp", 0);

    if (effectiveLastModified <= lastSyncTs) {
      clearPendingAutoSyncRequest();
      return;
    }

    if (
      isInitialSyncInProgress ||
      isBackgroundAutoSyncInProgress ||
      hasPendingBackgroundSync ||
      backgroundSyncRetryTimeout
    ) {
      return;
    }

    console.log(
      "S1 Plus: 检测到跨页面遗留的待同步变更，正在补发后台同步任务。"
    );
    requestBackgroundSyncRun("pending_recovery", 600);
  };

  const bindPendingAutoSyncRecoveryHooks = () => {
    if (window.__s1pPendingAutoSyncRecoveryBound) {
      return;
    }
    window.__s1pPendingAutoSyncRecoveryBound = true;

    // 处理浏览器后退缓存（bfcache）恢复场景：页面不会重新执行 main。
    window.addEventListener("pageshow", (event) => {
      if (event && event.persisted) {
        console.log("S1 Plus: 检测到页面从 bfcache 恢复，检查待同步任务...");
      }
      recoverPendingAutoSyncIfNeeded();
    });

    // 处理标签页从后台恢复到前台的场景。
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        recoverPendingAutoSyncIfNeeded();
      }
    });
  };

  const requestBackgroundSyncRun = (
    reason = "pending_update",
    delayMs = 0
  ) => {
    if (getActiveAutoSyncConflictPause()) {
      clearAutoSyncRuntimeQueue();
      return;
    }

    hasPendingBackgroundSync = true;
    setAutoSyncIndicatorPendingPhase(reason);

    if (isInitialSyncInProgress || isBackgroundAutoSyncInProgress) {
      return;
    }

    if (backgroundSyncRetryTimeout) {
      clearTimeout(backgroundSyncRetryTimeout);
    }
    backgroundSyncRetryTimeout = setTimeout(() => {
      backgroundSyncRetryTimeout = null;
      triggerRemoteSyncPush(reason);
    }, Math.max(0, delayMs));
  };

  // [MODIFIED] 为远程推送增加防抖机制，并防止重入
  let remotePushTimeout;
  let remotePushDueTimestamp = 0;
  let remotePushScheduledReason = "debounced_local_change";
  const clearRemotePushDebounceTimer = () => {
    if (remotePushTimeout) {
      clearTimeout(remotePushTimeout);
      remotePushTimeout = null;
    }
    remotePushDueTimestamp = 0;
    remotePushScheduledReason = "debounced_local_change";
  };
  const clearAutoSyncRuntimeQueue = () => {
    hasPendingBackgroundSync = false;
    if (backgroundSyncRetryTimeout) {
      clearTimeout(backgroundSyncRetryTimeout);
      backgroundSyncRetryTimeout = null;
    }
    clearRemotePushDebounceTimer();
  };
  const armRemotePushTimer = (dueTimestamp, reason) => {
    remotePushDueTimestamp = dueTimestamp;
    remotePushScheduledReason = reason;
    remotePushTimeout = setTimeout(() => {
      remotePushTimeout = null;
      remotePushDueTimestamp = 0;
      const triggerReason = remotePushScheduledReason;
      remotePushScheduledReason = "debounced_local_change";
      triggerRemoteSyncPush(triggerReason);
    }, Math.max(0, dueTimestamp - Date.now()));
  };

  const debouncedTriggerRemoteSyncPush = ({ source = "general" } = {}) => {
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
    if (getActiveAutoSyncConflictPause()) {
      clearRemotePushDebounceTimer();
      return;
    }
    setAutoSyncIndicatorPendingPhase(
      source === "read_progress"
        ? "debounced_read_progress"
        : "debounced_local_change"
    );
    const debounceMs =
      source === "read_progress"
        ? READ_PROGRESS_SYNC_DEBOUNCE_MS
        : DEFAULT_SYNC_DEBOUNCE_MS;
    const nextDueTimestamp = Date.now() + debounceMs;
    const nextReason =
      source === "read_progress"
        ? "debounced_read_progress"
        : "debounced_local_change";

    if (!remotePushTimeout) {
      armRemotePushTimer(nextDueTimestamp, nextReason);
      return;
    }

    if (source === "general") {
      // 普通数据改动保持标准防抖：以最后一次改动为准。
      clearTimeout(remotePushTimeout);
      armRemotePushTimer(nextDueTimestamp, nextReason);
      return;
    }

    // 阅读进度改动不应推迟已经安排好的普通同步。
    if (remotePushScheduledReason === "debounced_local_change") {
      return;
    }

    // 仅在当前也是阅读进度任务时做 trailing debounce。
    clearTimeout(remotePushTimeout);
    armRemotePushTimer(nextDueTimestamp, nextReason);
  };

  // 只有在数据实际变动时才更新时间戳；可按需仅更新时间戳而不触发自动同步
  const updateLastModifiedTimestamp = (
    source = "general",
    { triggerSync = true } = {}
  ) => {
    const currentLastModified = GM_getValue("s1p_last_modified", 0);
    const nextLastModified = Math.max(Date.now(), currentLastModified + 1);
    // 如果初始同步正在进行，不直接丢弃信号，改为记录 dirty 标记并在同步后补跑。
    if (isInitialSyncInProgress) {
      syncDirtyDuringSync = true;
      syncDirtyTimestamp = Math.max(syncDirtyTimestamp, nextLastModified);
      if (triggerSync) {
        syncDirtyNeedsFollowUpSync = true;
        hasPendingBackgroundSync = true;
        markPendingAutoSyncRequest(source, nextLastModified);
        setAutoSyncIndicatorPendingPhase(`${source}_dirty_during_sync`);
        console.log(
          "S1 Plus: 同步进行中检测到本地变更，已记录为待补同步任务。"
        );
      } else {
        console.log(
          "S1 Plus: 同步进行中检测到仅本地时间戳修正，已记录但不会触发补同步。"
        );
      }
      return;
    }
    GM_setValue("s1p_last_modified", nextLastModified);
    if (triggerSync) {
      markPendingAutoSyncRequest(source, nextLastModified);
      debouncedTriggerRemoteSyncPush({ source });
    }
  };

  // [NEW] 更新上次同步时间的显示
  const updateSyncDiagnosticsPanel = () => {
    const panel = document.querySelector("#s1p-sync-diagnostics-panel");
    if (!panel) return;

    const diagnostics = getSyncDiagnostics();
    const rows = [
      ["最近动作", diagnostics.lastActionType || "—"],
      ["最近尝试", formatSyncTime(diagnostics.lastAttemptTimestamp)],
      ["最近成功", formatSyncTime(diagnostics.lastSuccessTimestamp)],
      ["最近冲突", formatSyncTime(diagnostics.lastConflictTimestamp)],
      ["最近失败", formatSyncTime(diagnostics.lastFailureTimestamp)],
      ["连续失败", String(diagnostics.consecutiveFailureCount || 0)],
      [
        "失败原因",
        diagnostics.lastFailureReason
          ? sanitizeDiagnosticText(diagnostics.lastFailureReason)
          : "—",
      ],
    ];

    panel.textContent = "";
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "s1p-diag-row";

      const labelEl = document.createElement("span");
      labelEl.className = "s1p-diag-label";
      labelEl.textContent = String(label ?? "");

      const valueEl = document.createElement("span");
      valueEl.className = "s1p-diag-value";
      valueEl.textContent = String(value ?? "");

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      panel.appendChild(row);
    });
  };

  const updateLastSyncTimeDisplay = () => {
    const container = document.querySelector("#s1p-last-sync-time-container");
    if (!container) {
      updateSyncDiagnosticsPanel();
      return;
    }
    const lastSyncTs = GM_getValue("s1p_last_sync_timestamp", 0);

    if (lastSyncTs > 0) {
      container.textContent = `上次成功同步于: ${new Date(lastSyncTs).toLocaleString(
        "zh-CN",
        { hour12: false }
      )}`;
    } else {
      container.textContent = "尚未进行过远程同步。";
    }
    updateSyncDiagnosticsPanel();
  };

  /**
   * 从当前页面获取 formhash，用于安全验证。
   * @returns {string|null} 成功则返回 formhash 字符串，否则返回 null。
   */
  const getFormhash = () => {
    const formhashInput = document.querySelector('input[name="formhash"]');
    if (formhashInput && formhashInput.value) {
      return formhashInput.value;
    }
    console.error("S1 Plus: 未能获取到 formhash，无法同步论坛黑名单。");
    return null;
  };

  const normalizeUsernameInput = (value) => {
    const firstLine = String(value ?? "").split(/\r?\n/)[0] || "";
    return firstLine.trim().replace(/^@+/, "");
  };

  const extractUidFromSpaceUrl = (url) => {
    const rawUrl = String(url || "");
    if (!rawUrl) {
      return "";
    }

    const uidFromProfileHref = extractUidFromProfileHref(rawUrl);
    if (uidFromProfileHref) {
      return uidFromProfileHref;
    }

    const uidFromQueryMatch = rawUrl.match(/[?&]uid=(\d+)/);
    if (uidFromQueryMatch && uidFromQueryMatch[1]) {
      return uidFromQueryMatch[1];
    }

    try {
      const parsedUrl = new URL(rawUrl, window.location.origin);
      return normalizeNumericId(parsedUrl.searchParams.get("uid"));
    } catch (error) {
      return "";
    }
  };

  const findUidByUsernameFromLinks = (links, username) => {
    const normalizedUsername = normalizeUsernameInput(username);
    if (!normalizedUsername || !links) {
      return "";
    }

    for (const link of Array.from(links)) {
      if (!(link instanceof Element)) {
        continue;
      }
      const linkName = normalizeUsernameInput(link.textContent);
      if (linkName !== normalizedUsername) {
        continue;
      }
      const uid = extractUidFromSpaceUrl(
        link.getAttribute("href") || link.href || ""
      );
      if (uid) {
        return uid;
      }
    }
    return "";
  };

  const findUidByUsernameInHtml = (htmlText, username) => {
    const sourceHtml = String(htmlText || "");
    if (!sourceHtml) {
      return "";
    }
    try {
      const parser = new DOMParser();
      const htmlDoc = parser.parseFromString(sourceHtml, "text/html");

      const matchedUid = findUidByUsernameFromLinks(
        htmlDoc.querySelectorAll('a[href*="space-uid-"], a[href*="uid="]'),
        username
      );
      if (matchedUid) {
        return matchedUid;
      }

      const canonicalHref =
        htmlDoc.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
        "";
      const canonicalUid = extractUidFromSpaceUrl(canonicalHref);
      if (canonicalUid) {
        return canonicalUid;
      }

      // 当页面内仅存在一个 UID 候选时，可安全地作为兜底。
      const uidCandidates = new Set();
      htmlDoc
        .querySelectorAll('a[href*="space-uid-"], a[href*="uid="]')
        .forEach((link) => {
          const uid = extractUidFromSpaceUrl(
            link.getAttribute("href") || link.href || ""
          );
          if (uid) {
            uidCandidates.add(uid);
          }
        });
      if (uidCandidates.size === 1) {
        return Array.from(uidCandidates)[0];
      }
    } catch (error) {
      console.warn("S1 Plus: 解析用户名查询结果失败。", error);
    }
    return "";
  };

  const requestUserProfileLookupPage = (url) =>
    new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 10000,
        onload: (response) => {
          if (response.status >= 200 && response.status < 400) {
            resolve(response);
            return;
          }
          reject(new Error(`HTTP status ${response.status}`));
        },
        onerror: (error) => reject(error),
        ontimeout: () => reject(new Error("请求超时")),
      });
    });

  const createUserLookupError = (code, message) => {
    const error = new Error(message);
    error.code = code;
    return error;
  };

  const resolveUidByUsername = async (username) => {
    const normalizedUsername = normalizeUsernameInput(username);
    if (!normalizedUsername) {
      throw createUserLookupError("EMPTY_USERNAME", "用户名不能为空。");
    }

    const uidOnCurrentPage = findUidByUsernameFromLinks(
      document.querySelectorAll('a[href*="space-uid-"], a[href*="uid="]'),
      normalizedUsername
    );
    if (uidOnCurrentPage) {
      return uidOnCurrentPage;
    }

    const lookupUrls = [
      `home.php?mod=space&username=${encodeURIComponent(normalizedUsername)}`,
      `home.php?mod=space&uid=0&do=profile&username=${encodeURIComponent(
        normalizedUsername
      )}`,
      `space-username-${encodeURIComponent(normalizedUsername)}.html`,
    ];
    let hasSuccessfulResponse = false;
    let lastRequestError = null;

    for (const lookupUrl of lookupUrls) {
      try {
        const response = await requestUserProfileLookupPage(lookupUrl);
        hasSuccessfulResponse = true;

        const finalUrl = String(response.finalUrl || response.responseURL || "");
        const uidFromFinalUrl = extractUidFromSpaceUrl(finalUrl);
        if (uidFromFinalUrl) {
          return uidFromFinalUrl;
        }

        const redirectLocationMatch = String(response.responseHeaders || "").match(
          /^\s*location:\s*(.+)$/im
        );
        if (redirectLocationMatch && redirectLocationMatch[1]) {
          const uidFromLocation = extractUidFromSpaceUrl(
            redirectLocationMatch[1].trim()
          );
          if (uidFromLocation) {
            return uidFromLocation;
          }
        }

        const uidFromHtml = findUidByUsernameInHtml(
          response.responseText,
          normalizedUsername
        );
        if (uidFromHtml) {
          return uidFromHtml;
        }
      } catch (error) {
        lastRequestError = error;
      }
    }

    if (hasSuccessfulResponse) {
      throw createUserLookupError(
        "UID_NOT_FOUND",
        `未找到用户名为 ${normalizedUsername} 的用户。`
      );
    }
    const requestError = createUserLookupError(
      "LOOKUP_REQUEST_FAILED",
      "用户名查询请求失败。"
    );
    requestError.cause = lastRequestError;
    throw requestError;
  };

  const buildUserBlockConfirmText = (settings = getSettings()) => {
    const baseText =
      settings.blockThreadsOnUserBlock === true
        ? "屏蔽用户并隐藏其主题帖？"
        : "确认屏蔽该用户？";
    return settings.syncWithNativeBlacklist === true
      ? `${baseText} (将同步至论坛黑名单)`
      : baseText;
  };

  const showUserBlockResultMessage = (
    userName,
    nativeSyncSucceeded,
    settings = getSettings()
  ) => {
    const displayName = String(userName || "该用户");
    if (nativeSyncSucceeded) {
      showMessage(
        settings.syncWithNativeBlacklist === true
          ? `已屏蔽用户 ${displayName} 并同步至论坛黑名单。`
          : `已屏蔽用户 ${displayName}。`,
        true
      );
      return;
    }
    showMessage(`已屏蔽用户 ${displayName}，但同步论坛黑名单失败。`, false);
  };

  const isNativeBlacklistPage = () => {
    if (!/\/home\.php$/i.test(String(window.location.pathname || ""))) {
      return false;
    }
    const searchParams = new URLSearchParams(window.location.search);
    return (
      searchParams.get("mod") === "space" &&
      searchParams.get("do") === "friend" &&
      searchParams.get("view") === "blacklist"
    );
  };

  const getNativeBlacklistPaginationInfo = (root = document) => {
    const searchParams = new URLSearchParams(window.location.search);
    let currentPage = Number.parseInt(searchParams.get("page") || "1", 10);
    if (!Number.isFinite(currentPage) || currentPage <= 0) {
      currentPage = 1;
    }

    const currentPageFromPager = Number.parseInt(
      String(root.querySelector(".pg strong")?.textContent || ""),
      10
    );
    if (Number.isFinite(currentPageFromPager) && currentPageFromPager > 0) {
      currentPage = currentPageFromPager;
    }

    let totalPages = currentPage;
    const totalPageText = String(
      root.querySelector(".pg label span[title*='页']")?.getAttribute("title") ||
      root.querySelector(".pg label span")?.textContent ||
      ""
    );
    const totalPageMatch = totalPageText.match(/(\d+)\s*页/);
    if (totalPageMatch && totalPageMatch[1]) {
      const parsedTotalPage = Number.parseInt(totalPageMatch[1], 10);
      if (Number.isFinite(parsedTotalPage) && parsedTotalPage > 0) {
        totalPages = parsedTotalPage;
      }
    }
    return { currentPage, totalPages };
  };

  const buildNativeBlacklistImportHintText = (root = document) => {
    const paginationInfo = getNativeBlacklistPaginationInfo(root);
    return paginationInfo.totalPages > 1
      ? `当前第 ${paginationInfo.currentPage}/${paginationInfo.totalPages} 页，可逐页导入。`
      : "将当前页系统黑名单导入脚本。";
  };

  const getNativeBlacklistCardUserMeta = (listItem) => {
    if (!(listItem instanceof Element)) {
      return {
        userId: "",
        userName: "",
      };
    }

    // 黑名单卡片结构里，用户名链接是 h4 的直接子节点；
    // “黑名单除名”在 h4 > span.y 里，不能拿它当用户名。
    const headingProfileLink = listItem.querySelector("h4 > a");
    const uidFallbackLink = listItem.querySelector(
      '.avt a[href*="space-uid-"], .avt a[href*="mod=space&uid="], .avt a[href*="uid="]'
    );
    const uidReferenceLink = headingProfileLink || uidFallbackLink;
    const fallbackUidMatch = String(listItem.id || "").match(/^friend_(\d+)_li$/);

    const userId = normalizeNumericId(
      extractUidFromSpaceUrl(
        uidReferenceLink?.getAttribute("href") || uidReferenceLink?.href || ""
      ) || (fallbackUidMatch && fallbackUidMatch[1])
    );
    const userName = normalizeUsernameInput(headingProfileLink?.textContent || "");

    return {
      userId,
      userName,
    };
  };

  const resolveNativeBlacklistCardActionBar = (listItem) => {
    if (!(listItem instanceof Element)) {
      return null;
    }
    // 黑名单卡片里第一个 `.xg1` 是底部操作行；
    // 互动弹层是额外节点，不作为标识挂载点。
    for (const child of Array.from(listItem.children)) {
      if (
        child instanceof Element &&
        child.tagName === "DIV" &&
        child.classList.contains("xg1")
      ) {
        return child;
      }
    }
    return null;
  };

  const collectNativeBlacklistUsersFromPage = (root = document) => {
    const userMap = new Map();
    root.querySelectorAll('#friend_ul li[id^="friend_"]').forEach((listItem) => {
      const { userId, userName } = getNativeBlacklistCardUserMeta(listItem);
      if (!userId || !userName) {
        return;
      }
      if (!userMap.has(userId)) {
        userMap.set(userId, userName);
      }
    });

    return Array.from(userMap.entries()).map(([id, name]) => ({ id, name }));
  };

  const updateNativeBlacklistImportedBadges = (root = document) => {
    if (!isNativeBlacklistPage()) {
      return 0;
    }

    const blockedUsers = getBlockedUsers();
    const blockedUserIdSet = new Set(
      Object.keys(blockedUsers)
        .map((id) => normalizeNumericId(id))
        .filter(Boolean)
    );
    const blockedUserNameSet = new Set();
    Object.values(blockedUsers).forEach((entry) => {
      const normalizedName = normalizeUsernameInput(entry?.name);
      if (normalizedName) {
        blockedUserNameSet.add(normalizedName);
      }
    });

    let markedCount = 0;
    root.querySelectorAll('#friend_ul li[id^="friend_"]').forEach((listItem) => {
      if (!(listItem instanceof Element)) {
        return;
      }
      const { userId, userName } = getNativeBlacklistCardUserMeta(listItem);
      const shouldMarkAsImported = Boolean(
        (userId && blockedUserIdSet.has(userId)) ||
          (userName && blockedUserNameSet.has(userName))
      );

      const existingBadges = Array.from(
        listItem.querySelectorAll(`.${NATIVE_BLACKLIST_IMPORTED_BADGE_CLASS}`)
      );

      if (shouldMarkAsImported) {
        let badge = existingBadges[0];
        if (!(badge instanceof Element)) {
          badge = document.createElement("span");
          badge.className = NATIVE_BLACKLIST_IMPORTED_BADGE_CLASS;
        }
        const actionBar = resolveNativeBlacklistCardActionBar(listItem);
        if (actionBar) {
          actionBar.appendChild(badge);
        } else {
          listItem.appendChild(badge);
        }
        setSanitizedIconHtml(badge, NATIVE_BLACKLIST_IMPORTED_BADGE_ICON);
        badge.classList.add("s1p-has-tooltip");
        badge.dataset.fullTag = NATIVE_BLACKLIST_IMPORTED_BADGE_TITLE;
        badge.dataset.s1pTooltipDelay = "120";
        badge.removeAttribute("title");
        existingBadges.slice(1).forEach((node) => node.remove());
        markedCount += 1;
      } else {
        existingBadges.forEach((node) => node.remove());
      }
    });

    return markedCount;
  };

  const importNativeBlacklistUsersFromCurrentPage = () => {
    const usersToImport = collectNativeBlacklistUsersFromPage(document);
    if (usersToImport.length === 0) {
      return {
        hasEntries: false,
        hasChanges: false,
        addedCount: 0,
        updatedCount: 0,
        duplicatedByIdCount: 0,
        duplicatedByNameCount: 0,
      };
    }

    const settings = getSettings();
    const blockedUsers = getBlockedUsers();
    const nextBlockedUsers = { ...blockedUsers };
    const blockedNameSet = new Set();
    Object.values(nextBlockedUsers).forEach((entry) => {
      const normalizedName = normalizeUsernameInput(entry?.name);
      if (normalizedName) {
        blockedNameSet.add(normalizedName);
      }
    });

    let addedCount = 0;
    let updatedCount = 0;
    let duplicatedByIdCount = 0;
    let duplicatedByNameCount = 0;
    const importTimestamp = Date.now();

    usersToImport.forEach((item, index) => {
      const userId = normalizeNumericId(item.id);
      const userName = normalizeUsernameInput(item.name);
      if (!userId || !userName) {
        return;
      }

      const existingItem = nextBlockedUsers[userId];
      if (existingItem) {
        let shouldUpdateExistingItem = false;
        let nextExistingItem = existingItem;

        const existingName = String(existingItem?.name || "");
        const shouldRefreshName =
          !normalizeUsernameInput(existingName) ||
          /^用户\s*#\d+$/.test(existingName);
        if (shouldRefreshName && existingName !== userName) {
          nextExistingItem = { ...nextExistingItem, name: userName };
          shouldUpdateExistingItem = true;
        }
        if (existingItem.addedToNativeBlacklist !== true) {
          nextExistingItem = {
            ...nextExistingItem,
            addedToNativeBlacklist: true,
          };
          shouldUpdateExistingItem = true;
        }

        if (shouldUpdateExistingItem) {
          nextBlockedUsers[userId] = nextExistingItem;
          blockedNameSet.add(userName);
          updatedCount += 1;
        } else {
          duplicatedByIdCount += 1;
        }
        return;
      }

      if (blockedNameSet.has(userName)) {
        duplicatedByNameCount += 1;
        return;
      }

      nextBlockedUsers[userId] = {
        name: userName,
        timestamp: importTimestamp + index,
        blockThreads: settings.blockThreadsOnUserBlock === true,
        addedToNativeBlacklist: true,
      };
      blockedNameSet.add(userName);
      addedCount += 1;
    });

    const hasChanges = addedCount > 0 || updatedCount > 0;
    if (hasChanges) {
      saveBlockedUsers(nextBlockedUsers);
      hideBlockedUsersPosts();
      hideBlockedUserQuotes();
      hideBlockedUserRatings();
      hideBlockedUserNotifications();
      if (settings.enablePostBlocking) {
        applyUserThreadBlocklist();
      }
    }
    updateNativeBlacklistImportedBadges(document);

    return {
      hasEntries: true,
      hasChanges,
      addedCount,
      updatedCount,
      duplicatedByIdCount,
      duplicatedByNameCount,
    };
  };

  const ensureNativeBlacklistImportButton = () => {
    if (!isNativeBlacklistPage()) {
      return false;
    }

    const blacklistForm = document.querySelector('form[name="blackform"]');
    const addButton = blacklistForm?.querySelector(
      'button[name="blacklistsubmit_btn"]'
    );
    if (!(addButton instanceof Element)) {
      updateNativeBlacklistImportedBadges(document);
      return false;
    }
    const actionCell = addButton.parentElement;
    if (!(actionCell instanceof Element)) {
      updateNativeBlacklistImportedBadges(document);
      return false;
    }

    let importBtn = actionCell.querySelector(`#${NATIVE_BLACKLIST_IMPORT_BUTTON_ID}`);
    if (!(importBtn instanceof Element)) {
      importBtn = document.createElement("button");
      importBtn.type = "button";
      importBtn.id = NATIVE_BLACKLIST_IMPORT_BUTTON_ID;
      importBtn.className = "pn vm s1p-native-blacklist-import-btn";
      importBtn.innerHTML = "<em>导入本页到 S1 Plus</em>";

      importBtn.addEventListener("click", () => {
        if (importBtn.disabled) {
          return;
        }

        importBtn.disabled = true;
        showMessage("正在导入当前页论坛黑名单...", null);
        try {
          const result = importNativeBlacklistUsersFromCurrentPage();
          if (!result.hasEntries) {
            showMessage("当前页面未检测到可导入的黑名单用户。", false);
            return;
          }

          const latestPaginationInfo = getNativeBlacklistPaginationInfo(document);
          const pageSuffix =
            latestPaginationInfo.totalPages > 1
              ? `第 ${latestPaginationInfo.currentPage}/${latestPaginationInfo.totalPages} 页`
              : "当前页";
          const continueHint =
            latestPaginationInfo.totalPages > 1 &&
            latestPaginationInfo.currentPage < latestPaginationInfo.totalPages
              ? " 请继续翻页后重复导入。"
              : "";

          if (!result.hasChanges) {
            showMessage(`${pageSuffix}导入完成：无新增，均已存在。${continueHint}`, true);
            return;
          }

          showMessage(
            `${pageSuffix}导入完成：新增 ${result.addedCount}，更新 ${result.updatedCount}，重复UID ${result.duplicatedByIdCount}，重名跳过 ${result.duplicatedByNameCount}。${continueHint}`,
            true
          );
        } catch (error) {
          console.error("S1 Plus: 导入论坛黑名单失败。", error);
          showMessage("导入失败，请稍后重试。", false);
        } finally {
          importBtn.disabled = false;
        }
      });
      addButton.insertAdjacentElement("afterend", importBtn);
    }

    let importHint = actionCell.querySelector(`#${NATIVE_BLACKLIST_IMPORT_HINT_ID}`);
    if (!(importHint instanceof Element)) {
      importHint = document.createElement("span");
      importHint.id = NATIVE_BLACKLIST_IMPORT_HINT_ID;
      importHint.className = "s1p-native-blacklist-import-hint";
      importBtn.insertAdjacentElement("afterend", importHint);
    }
    importHint.textContent = buildNativeBlacklistImportHintText(document);
    updateNativeBlacklistImportedBadges(document);
    return true;
  };

  /**
   * 异步将指定用户添加到论坛黑名单。
   * @param {string} username - 要屏蔽的用户名。
   * @param {string} formhash - 安全验证令牌。
   * @returns {Promise<void>}
   */
  const addToNativeBlacklist = (username, formhash) => {
    return new Promise((resolve, reject) => {
      const url = "home.php?mod=spacecp&ac=friend&op=blacklist&start=";
      const postData = `username=${encodeURIComponent(
        username
      )}&formhash=${formhash}&blacklistsubmit_btn=true&blacklistsubmit=true`;
      const refererUrl =
        "https://stage1st.com/2b/home.php?mod=spacecp&ac=friend&op=blacklist";

      GM_xmlhttpRequest({
        method: "POST",
        url: url,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: refererUrl,
        },
        data: postData,
        onload: (response) => {
          const responseText = String(response.responseText || "");
          if (
            response.status === 200 &&
            responseText.includes("操作成功")
          ) {
            console.log(`S1 Plus: 已成功将用户 ${username} 同步到论坛黑名单。`);
            resolve();
          } else {
            console.error(`S1 Plus: 同步论坛黑名单失败 (添加)。`, response);
            reject(
              new Error(`HTTP status ${response.status} 或未找到成功标识`)
            );
          }
        },
        onerror: (error) => {
          console.error("S1 Plus: 同步论坛黑名单网络请求失败 (添加)", error);
          reject(error);
        },
      });
    });
  };

  /**
   * 异步将指定用户从论坛黑名单中移除。
   * @param {string} uid - 要取消屏蔽的用户ID。
   * @param {string} formhash - 安全验证令牌。
   * @returns {Promise<void>}
   */
  const removeFromNativeBlacklist = (uid, formhash) => {
    return new Promise((resolve, reject) => {
      // 根据用户提供的网络日志，精确模拟请求
      const url = `home.php?mod=spacecp&ac=friend&op=blacklist&subop=delete&uid=${uid}`;
      const refererUrl = NATIVE_BLACKLIST_VIEW_URL;

      GM_xmlhttpRequest({
        method: "GET",
        url: url,
        headers: {
          Referer: refererUrl,
        },
        onload: (response) => {
          const responseText = String(response.responseText || "");
          // [最终修正] 采用用户发现的通用成功标识 "操作成功"
          if (
            response.status === 200 &&
            responseText.includes("操作成功")
          ) {
            console.log(`S1 Plus: 已成功将 UID:${uid} 从论坛黑名单同步移除。`);
            resolve();
          } else {
            console.error(`S1 Plus: 同步论坛黑名单失败 (移除)。`, response);
            reject(
              new Error(`HTTP status ${response.status} 或未找到成功标识`)
            );
          }
        },
        onerror: (error) => {
          console.error("S1 Plus: 同步论坛黑名单网络请求失败 (移除)", error);
          reject(error);
        },
      });
    });
  };

  // --- 数据处理 & 核心功能 ---
  const createCoreDataCacheState = (normalize = sanitizeRecordObject) => ({
    value: null,
    expiresAt: 0,
    normalize,
  });
  const blockedThreadsCache = createCoreDataCacheState();
  const blockedUsersCache = createCoreDataCacheState();
  const blockedPostsCache = createCoreDataCacheState();
  const readProgressCache = createCoreDataCacheState();
  const userTagsCache = createCoreDataCacheState();
  const bookmarkedRepliesCache = createCoreDataCacheState();
  const titleFilterRulesCache = createCoreDataCacheState((value) =>
    Array.isArray(value) ? value : []
  );
  const setCoreDataCacheValue = (cacheState, value) => {
    const normalize =
      cacheState && typeof cacheState.normalize === "function"
        ? cacheState.normalize
        : sanitizeRecordObject;
    cacheState.value = normalize(value);
    cacheState.expiresAt = Date.now() + CORE_DATA_CACHE_TTL_MS;
  };
  const getCoreDataFromCache = (cacheState, key, fallbackValue = {}) => {
    if (cacheState.value && Date.now() < cacheState.expiresAt) {
      return cacheState.value;
    }
    const latestValue = GM_getValue(key, fallbackValue);
    setCoreDataCacheValue(cacheState, latestValue);
    return cacheState.value;
  };
  const COMPARABLE_RECORD_STORAGE_KEYS = new Set([
    "s1p_blocked_threads",
    "s1p_blocked_users",
    "s1p_user_tags",
    "s1p_bookmarked_replies",
    "s1p_blocked_posts",
    "s1p_read_progress",
  ]);
  const comparableStoredValueCache = new Map();
  const normalizeComparableStoredValueByKey = (key, value) => {
    if (COMPARABLE_RECORD_STORAGE_KEYS.has(key)) {
      return sanitizeRecordObject(value);
    }
    if (key === "s1p_title_filter_rules") {
      return Array.isArray(value) ? value : [];
    }
    return value;
  };
  const getComparableStoredValue = (key, fallbackValue = {}) => {
    if (comparableStoredValueCache.has(key)) {
      return comparableStoredValueCache.get(key);
    }
    const normalizedValue = normalizeComparableStoredValueByKey(
      key,
      GM_getValue(key, fallbackValue)
    );
    const cachedValue = isComparableObjectValue(normalizedValue)
      ? deepCloneSyncValue(normalizedValue)
      : normalizedValue;
    comparableStoredValueCache.set(key, cachedValue);
    return cachedValue;
  };
  const setComparableStoredValue = (key, value) => {
    const normalizedValue = normalizeComparableStoredValueByKey(key, value);
    const cachedValue = isComparableObjectValue(normalizedValue)
      ? deepCloneSyncValue(normalizedValue)
      : normalizedValue;
    comparableStoredValueCache.set(
      key,
      cachedValue
    );
  };
  const isComparableObjectValue = (value) =>
    value !== null && typeof value === "object";
  const computeComparableValueShapeSignature = (value) => {
    if (value === null) {
      return "null";
    }
    const valueType = typeof value;
    if (valueType !== "object") {
      return `${valueType}:${String(value)}`;
    }
    if (Array.isArray(value)) {
      const length = value.length;
      const firstType = length > 0 ? typeof value[0] : "none";
      const lastType = length > 0 ? typeof value[length - 1] : "none";
      return `array:${length}:${firstType}:${lastType}`;
    }
    const keys = Object.keys(value).sort();
    let keyHash = 2166136261;
    for (const key of keys) {
      for (let i = 0; i < key.length; i++) {
        keyHash ^= key.charCodeAt(i);
        keyHash = Math.imul(keyHash, 16777619);
      }
      keyHash = Math.imul(keyHash ^ key.length, 16777619);
    }
    return `object:${keys.length}:${keyHash >>> 0}`;
  };
  const areComparableValuesEqual = (leftValue, rightValue) => {
    if (Object.is(leftValue, rightValue)) {
      return true;
    }
    if (typeof leftValue !== typeof rightValue) {
      return false;
    }
    if (
      !isComparableObjectValue(leftValue) ||
      !isComparableObjectValue(rightValue)
    ) {
      return false;
    }

    const leftIsArray = Array.isArray(leftValue);
    if (leftIsArray !== Array.isArray(rightValue)) {
      return false;
    }
    if (leftIsArray) {
      if (leftValue.length !== rightValue.length) {
        return false;
      }
      for (let i = 0; i < leftValue.length; i++) {
        if (!areComparableValuesEqual(leftValue[i], rightValue[i])) {
          return false;
        }
      }
      return true;
    }

    const leftKeys = Object.keys(leftValue);
    const rightKeys = Object.keys(rightValue);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(rightValue, key)) {
        return false;
      }
      if (!areComparableValuesEqual(leftValue[key], rightValue[key])) {
        return false;
      }
    }
    return true;
  };
  const hasComparableValueChanged = (currentValue, nextValue) => {
    const currentSignature = computeComparableValueShapeSignature(currentValue);
    const nextSignature = computeComparableValueShapeSignature(nextValue);
    if (currentSignature !== nextSignature) {
      return true;
    }
    return !areComparableValuesEqual(currentValue, nextValue);
  };
  const getBlockedThreads = () =>
    getCoreDataFromCache(blockedThreadsCache, "s1p_blocked_threads");
  const saveBlockedThreads = (threads, suppressSyncTrigger = false) => {
    const normalizedThreads = sanitizeRecordObject(threads);
    const currentStoredThreads = getComparableStoredValue(
      "s1p_blocked_threads",
      {}
    );
    if (!hasComparableValueChanged(currentStoredThreads, normalizedThreads)) {
      setCoreDataCacheValue(blockedThreadsCache, normalizedThreads);
      return;
    }
    invalidateLocalDataHashCache();
    GM_setValue("s1p_blocked_threads", normalizedThreads);
    setComparableStoredValue("s1p_blocked_threads", normalizedThreads);
    setCoreDataCacheValue(blockedThreadsCache, normalizedThreads);
    if (!suppressSyncTrigger) {
      updateLastModifiedTimestamp();
    }
  };
  const getBlockedUsers = () =>
    getCoreDataFromCache(blockedUsersCache, "s1p_blocked_users");
  const saveBlockedUsers = (users, suppressSyncTrigger = false) => {
    const normalizedUsers = sanitizeRecordObject(users);
    const currentStoredUsers = getComparableStoredValue("s1p_blocked_users", {});
    if (!hasComparableValueChanged(currentStoredUsers, normalizedUsers)) {
      setCoreDataCacheValue(blockedUsersCache, normalizedUsers);
      return;
    }
    invalidateLocalDataHashCache();
    GM_setValue("s1p_blocked_users", normalizedUsers);
    setComparableStoredValue("s1p_blocked_users", normalizedUsers);
    setCoreDataCacheValue(blockedUsersCache, normalizedUsers);
    if (!suppressSyncTrigger) {
      updateLastModifiedTimestamp();
    }
  };
  const saveUserTags = (tags, suppressSyncTrigger = false) => {
    const normalizedTags = sanitizeRecordObject(tags);
    const currentStoredTags = getComparableStoredValue("s1p_user_tags", {});
    if (!hasComparableValueChanged(currentStoredTags, normalizedTags)) {
      setCoreDataCacheValue(userTagsCache, normalizedTags);
      return;
    }
    invalidateLocalDataHashCache();
    GM_setValue("s1p_user_tags", normalizedTags);
    setComparableStoredValue("s1p_user_tags", normalizedTags);
    setCoreDataCacheValue(userTagsCache, normalizedTags);
    if (!suppressSyncTrigger) {
      updateLastModifiedTimestamp();
    }
  };
  // [NEW] Bookmarked Replies data functions
  const getBookmarkedReplies = () =>
    getCoreDataFromCache(
      bookmarkedRepliesCache,
      "s1p_bookmarked_replies"
    );
  const saveBookmarkedReplies = (replies, suppressSyncTrigger = false) => {
    const normalizedReplies = sanitizeRecordObject(replies);
    const currentStoredReplies = getComparableStoredValue(
      "s1p_bookmarked_replies",
      {}
    );
    if (!hasComparableValueChanged(currentStoredReplies, normalizedReplies)) {
      setCoreDataCacheValue(bookmarkedRepliesCache, normalizedReplies);
      return;
    }
    invalidateLocalDataHashCache();
    GM_setValue("s1p_bookmarked_replies", normalizedReplies);
    setComparableStoredValue("s1p_bookmarked_replies", normalizedReplies);
    setCoreDataCacheValue(bookmarkedRepliesCache, normalizedReplies);
    if (!suppressSyncTrigger) {
      updateLastModifiedTimestamp();
    }
  };
  const normalizeBookmarkTextForPreview = (text) => {
    const rawText = String(text ?? "");
    if (!rawText) {
      return "";
    }
    // 仅处理前部窗口，避免对超长正文在同步路径做全量扫描。
    const windowedText =
      rawText.length > BOOKMARK_SYNC_PREVIEW_MAX_LENGTH * 4
        ? rawText.slice(0, BOOKMARK_SYNC_PREVIEW_MAX_LENGTH * 4)
        : rawText;
    return windowedText.trim().replace(/\n{3,}/g, "\n\n");
  };
  const buildBookmarkContentPreview = (text) => {
    const normalized = normalizeBookmarkTextForPreview(text);
    if (!normalized) {
      return "";
    }
    if (normalized.length <= BOOKMARK_SYNC_PREVIEW_MAX_LENGTH) {
      return normalized;
    }
    return `${normalized.slice(0, BOOKMARK_SYNC_PREVIEW_MAX_LENGTH)}...`;
  };
  const getBookmarkedRepliesForSync = () => {
    const bookmarkedReplies = getBookmarkedReplies();
    const compactReplies = {};
    Object.keys(bookmarkedReplies).forEach((postId) => {
      const item = bookmarkedReplies[postId];
      if (!isObjectRecord(item)) {
        return;
      }
      const compactItem = sanitizeRecordObject(item);
      const contentPreview =
        buildBookmarkContentPreview(compactItem.contentPreview) ||
        buildBookmarkContentPreview(compactItem.postContent);
      delete compactItem.postContent;
      if (contentPreview) {
        compactItem.contentPreview = contentPreview;
      } else {
        delete compactItem.contentPreview;
      }
      compactReplies[postId] = compactItem;
    });
    return compactReplies;
  };

  // [NEW] Blocked Posts data functions
  const buildBlockedPostContentPreview = (text) =>
    buildBookmarkContentPreview(text);
  const normalizeBlockedPostsRecord = (postId, item) => {
    if (!isObjectRecord(item)) {
      return null;
    }
    const normalizedPostId = normalizeNumericId(item.postId || postId);
    if (!normalizedPostId) {
      return null;
    }
    const normalizedItem = sanitizeRecordObject(item);
    normalizedItem.postId = normalizedPostId;
    normalizedItem.threadId =
      normalizeNumericId(normalizedItem.threadId) || "unknown_thread";
    normalizedItem.threadTitle = String(normalizedItem.threadTitle || "");
    normalizedItem.floor = String(normalizedItem.floor || "");
    normalizedItem.authorId = normalizeNumericId(normalizedItem.authorId) || "";
    normalizedItem.authorName = String(normalizedItem.authorName || "");
    normalizedItem.timestamp =
      Number.isFinite(Number(normalizedItem.timestamp)) &&
        Number(normalizedItem.timestamp) > 0
        ? Number(normalizedItem.timestamp)
        : 0;
    if (typeof normalizedItem.postContent !== "undefined") {
      normalizedItem.postContent = String(normalizedItem.postContent || "");
    }
    const previewText = buildBlockedPostContentPreview(
      normalizedItem.contentPreview || normalizedItem.postContent
    );
    if (previewText) {
      normalizedItem.contentPreview = previewText;
    } else {
      delete normalizedItem.contentPreview;
    }
    return normalizedItem;
  };
  const normalizeBlockedPostsPayload = (posts) => {
    const source = sanitizeRecordObject(posts);
    const normalizedPosts = {};
    Object.keys(source).forEach((postId) => {
      const normalizedRecord = normalizeBlockedPostsRecord(postId, source[postId]);
      if (!normalizedRecord) {
        return;
      }
      normalizedPosts[normalizedRecord.postId] = normalizedRecord;
    });
    return normalizedPosts;
  };
  const getBlockedPostsForSync = () => {
    const blockedPosts = getBlockedPosts();
    const compactPosts = {};
    Object.keys(blockedPosts).forEach((postId) => {
      const item = blockedPosts[postId];
      if (!isObjectRecord(item)) {
        return;
      }
      const compactItem = sanitizeRecordObject(item);
      const contentPreview = buildBlockedPostContentPreview(
        compactItem.contentPreview || compactItem.postContent
      );
      delete compactItem.postContent;
      if (contentPreview) {
        compactItem.contentPreview = contentPreview;
      } else {
        delete compactItem.contentPreview;
      }
      compactPosts[postId] = compactItem;
    });
    return compactPosts;
  };
  const getBlockedPosts = () => {
    const blockedPosts = getCoreDataFromCache(blockedPostsCache, "s1p_blocked_posts");
    const normalizedPosts = normalizeBlockedPostsPayload(blockedPosts);
    if (hasComparableValueChanged(blockedPosts, normalizedPosts)) {
      setCoreDataCacheValue(blockedPostsCache, normalizedPosts);
      setComparableStoredValue("s1p_blocked_posts", normalizedPosts);
    }
    return normalizedPosts;
  };
  const saveBlockedPosts = (posts, suppressSyncTrigger = false) => {
    const normalizedPosts = normalizeBlockedPostsPayload(posts);
    const currentStoredPosts = getComparableStoredValue("s1p_blocked_posts", {});
    if (!hasComparableValueChanged(currentStoredPosts, normalizedPosts)) {
      setCoreDataCacheValue(blockedPostsCache, normalizedPosts);
      return;
    }
    invalidateLocalDataHashCache();
    GM_setValue("s1p_blocked_posts", normalizedPosts);
    setComparableStoredValue("s1p_blocked_posts", normalizedPosts);
    setCoreDataCacheValue(blockedPostsCache, normalizedPosts);
    if (!suppressSyncTrigger) {
      updateLastModifiedTimestamp();
    }
  };

  // [MODIFIED] 升级并获取用户标记，自动迁移旧数据
  const getUserTags = () => {
    const tags = getCoreDataFromCache(userTagsCache, "s1p_user_tags");
    let needsMigration = false;
    const migratedTags = { ...tags };

    Object.keys(migratedTags).forEach((id) => {
      const rawEntry = migratedTags[id];
      const isLegacyString = typeof rawEntry === "string";
      const isTagObject = isObjectRecord(rawEntry);

      if (!isLegacyString && !isTagObject) {
        needsMigration = true;
        delete migratedTags[id];
        return;
      }

      const normalizedTag = String(
        isLegacyString ? rawEntry : rawEntry.tag || ""
      ).trim();
      if (!normalizedTag) {
        needsMigration = true;
        delete migratedTags[id];
        return;
      }

      const normalizedName = String(
        (isTagObject && rawEntry.name) || `用户 #${id}`
      ).trim() || `用户 #${id}`;
      const parsedTimestamp = Number(isTagObject ? rawEntry.timestamp : 0);
      const normalizedTimestamp =
        Number.isFinite(parsedTimestamp) && parsedTimestamp > 0
          ? parsedTimestamp
          : Date.now();
      const normalizedColor =
        isTagObject && typeof rawEntry.color === "string"
          ? rawEntry.color.trim()
          : "";

      const normalizedEntry = {
        name: normalizedName,
        tag: normalizedTag,
        timestamp: normalizedTimestamp,
      };
      if (normalizedColor) {
        normalizedEntry.color = normalizedColor;
      }

      if (!isTagObject || hasComparableValueChanged(rawEntry, normalizedEntry)) {
        needsMigration = true;
      }

      migratedTags[id] = normalizedEntry;
    });

    if (needsMigration) {
      console.log("S1 Plus: 正在将用户标记迁移到新版数据结构...");
      saveUserTags(migratedTags, true);
      updateLastModifiedTimestamp("general", { triggerSync: false });
      return migratedTags;
    }

    return tags;
  };

  const getTitleFilterRules = () => {
    if (
      titleFilterRulesCache.value &&
      Date.now() < titleFilterRulesCache.expiresAt
    ) {
      return titleFilterRulesCache.value;
    }

    const rules = GM_getValue("s1p_title_filter_rules", null);
    if (rules !== null) {
      setCoreDataCacheValue(titleFilterRulesCache, rules);
      return titleFilterRulesCache.value;
    }

    // --- 向下兼容：迁移旧的关键字数据 ---
    const oldKeywords = GM_getValue("s1p_title_keywords", null);
    if (Array.isArray(oldKeywords)) {
      const newRules = oldKeywords.map((k) => ({
        pattern: k,
        enabled: true,
        id: `rule_${Date.now()}_${Math.random()}`,
      }));
      saveTitleFilterRules(newRules, true);
      GM_setValue("s1p_title_keywords", null); // 清理旧数据
      updateLastModifiedTimestamp("general", { triggerSync: false });
      return newRules;
    }
    setCoreDataCacheValue(titleFilterRulesCache, []);
    return titleFilterRulesCache.value;
  };

  /**
   * [NEW] 检测本地“价值数据”是否为空 (屏蔽、标记、收藏等)
   * 用于优化首次开启同步时的体验
   * @returns {boolean}
   */
  const isLocalDataEmpty = () => {
    const threadCount = Object.keys(getBlockedThreads()).length;
    const userCount = Object.keys(getBlockedUsers()).length;
    const tagCount = Object.keys(getUserTags()).length;
    const bookmarkCount = Object.keys(getBookmarkedReplies()).length;
    const postCount = Object.keys(getBlockedPosts()).length;
    const ruleCount = getTitleFilterRules().length;

    return (
      threadCount === 0 &&
      userCount === 0 &&
      tagCount === 0 &&
      bookmarkCount === 0 &&
      postCount === 0 &&
      ruleCount === 0
    );
  };
  const saveTitleFilterRules = (rules, suppressSyncTrigger = false) => {
    const normalizedRules = Array.isArray(rules) ? rules : [];
    const currentRules = getComparableStoredValue("s1p_title_filter_rules", []);
    if (!hasComparableValueChanged(currentRules, normalizedRules)) {
      setCoreDataCacheValue(titleFilterRulesCache, normalizedRules);
      return;
    }
    invalidateLocalDataHashCache();
    GM_setValue("s1p_title_filter_rules", normalizedRules);
    setComparableStoredValue("s1p_title_filter_rules", normalizedRules);
    setCoreDataCacheValue(titleFilterRulesCache, normalizedRules);
    if (!suppressSyncTrigger) {
      updateLastModifiedTimestamp();
    }
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
  const THREAD_ROW_DOM_SELECTOR =
    'tbody[id^="normalthread_"], tbody[id^="stickthread_"]';
  const getThreadRowsFromScope = (rows = null) => {
    if (Array.isArray(rows)) {
      return rows.filter(
        (row) =>
          row instanceof Element &&
          row.isConnected &&
          row.matches(THREAD_ROW_DOM_SELECTOR)
      );
    }
    if (rows instanceof Element) {
      if (rows.matches(THREAD_ROW_DOM_SELECTOR)) {
        return [rows];
      }
      return Array.from(rows.querySelectorAll(THREAD_ROW_DOM_SELECTOR));
    }
    return Array.from(document.querySelectorAll(THREAD_ROW_DOM_SELECTOR));
  };
  const applyBlockedThreadVisibilityForRows = (rows = null) => {
    const blockedThreads = getBlockedThreads();
    getThreadRowsFromScope(rows).forEach((row) => {
      const threadId = row.id.replace(/^(normalthread_|stickthread_)/, "");
      if (!threadId) return;
      if (blockedThreads[threadId]) {
        hideThread(threadId);
      } else {
        showThread(threadId);
      }
    });
  };
  const hideBlockedThreads = () => {
    applyBlockedThreadVisibilityForRows();
  };

  const blockUser = async (id, name, remark = "") => {
    // [优化] 函数变为异步并返回布尔值
    const settings = getSettings();
    const b = getBlockedUsers();
    const shouldSyncToNativeBlacklist = settings.syncWithNativeBlacklist === true;
    b[id] = {
      name,
      timestamp: Date.now(),
      blockThreads: settings.blockThreadsOnUserBlock,
      // [修复] 仅在论坛黑名单同步成功后再标记为 true。
      addedToNativeBlacklist: false,
      remark: remark, // [新增] 用户备注
    };
    saveBlockedUsers(b);

    let nativeSyncSucceeded = !shouldSyncToNativeBlacklist;
    if (shouldSyncToNativeBlacklist) {
      const formhash = getFormhash();
      if (!formhash) {
        nativeSyncSucceeded = false;
      } else {
        try {
          await addToNativeBlacklist(name, formhash);
          nativeSyncSucceeded = true;
        } catch (e) {
          nativeSyncSucceeded = false;
        }
      }

      if (nativeSyncSucceeded) {
        const latestBlockedUsers = getBlockedUsers();
        const latestUser = latestBlockedUsers[id];
        if (latestUser) {
          // 避免直接修改缓存对象，防止“同值短路”误判导致状态未落盘。
          const nextBlockedUsers = {
            ...latestBlockedUsers,
            [id]: {
              ...latestUser,
              addedToNativeBlacklist: true,
            },
          };
          saveBlockedUsers(nextBlockedUsers);
        }
      }
    }

    hideUserPosts(id);
    hideBlockedUserQuotes();
    hideBlockedUserRatings();
    hideBlockedUserNotifications();
    if (b[id].blockThreads) applyUserThreadBlocklist();
    return nativeSyncSucceeded;
  };

  const unblockUser = async (id) => {
    // [优化] 函数变为异步并返回布尔值
    const b = getBlockedUsers();
    // [修改] 先获取要删除的用户数据
    const userToUnblock = b[id];

    // 如果用户不存在，直接返回成功
    if (!userToUnblock) return true;

    // 先执行论坛端移除，成功后再落地本地删除，避免本地/论坛状态分裂。
    if (userToUnblock.addedToNativeBlacklist === true) {
      const formhash = getFormhash();
      if (!formhash) {
        return false;
      }
      try {
        await removeFromNativeBlacklist(id, formhash);
      } catch (e) {
        return false; // 同步失败
      }
    }

    // 论坛端移除成功（或无需移除）后，再从脚本存储中删除用户
    delete b[id];
    saveBlockedUsers(b);

    showUserPosts(id);
    hideBlockedUserQuotes();
    hideBlockedUserRatings();
    hideBlockedUserNotifications();
    unblockThreadsByUser(id);
    return true; // 全部成功
  };

  // [NEW] Block specific post/floor functions
  const blockPost = (postId, threadId, threadTitle, floor, authorId, authorName, postContent) => {
    const normalizedPostId = normalizeNumericId(postId);
    if (!normalizedPostId) {
      return false;
    }
    const b = getBlockedPosts();
    b[normalizedPostId] = {
      postId: normalizedPostId,
      threadId: normalizeNumericId(threadId) || "unknown_thread",
      threadTitle: String(threadTitle || ""),
      floor: String(floor || ""),
      authorId: normalizeNumericId(authorId) || "",
      authorName: String(authorName || ""),
      postContent: String(postContent || ""),
      timestamp: Date.now(),
    };
    saveBlockedPosts(b);
    hidePost(normalizedPostId);
    return true;
  };

  const unblockPost = (postId) => {
    const normalizedPostId = normalizeNumericId(postId);
    if (!normalizedPostId) return true;
    const b = getBlockedPosts();
    if (!b[normalizedPostId]) return true;
    delete b[normalizedPostId];
    saveBlockedPosts(b);
    showPost(normalizedPostId);
    return true;
  };

  const hidePost = (postId) => {
    const postTable = getPostTableById(postId);
    if (postTable) {
      postTable.setAttribute("style", "display: none !important");
    }
  };

  const showPost = (postId) => {
    const postTable = getPostTableById(postId);
    if (postTable) {
      postTable.removeAttribute("style");
    }
  };

  const hideBlockedPosts = () => {
    const settings = getSettings();
    if (!settings.enablePostBlocking) return;
    Object.keys(getBlockedPosts()).forEach(hidePost);
  };

  const hideBlockedPostsInTables = (postTables = []) => {
    const settings = getSettings();
    if (!settings.enablePostBlocking || !Array.isArray(postTables)) return;

    const blockedPostIdSet = new Set(Object.keys(getBlockedPosts()));
    if (blockedPostIdSet.size === 0) return;

    postTables.forEach((postTable) => {
      if (!(postTable instanceof Element)) return;
      const postIdMatch = postTable.id ? postTable.id.match(/^pid(\d+)$/) : null;
      const postId = postIdMatch ? postIdMatch[1] : null;
      if (postId && blockedPostIdSet.has(postId)) {
        postTable.setAttribute("style", "display: none !important");
      }
    });
  };

  const hideSystemBlockedPosts = () => {
    const settings = getSettings();
    const shouldHideSystemBlocked =
      settings.enableGeneralSettings === true &&
      settings.hideSystemBlockedPosts === true;
    document.documentElement.classList.toggle(
      "s1p-hide-system-blocked-enabled",
      shouldHideSystemBlocked
    );

    // `:has` 在旧内核可能不支持，兜底为运行时 class 标记隐藏。
    if (SUPPORTS_CSS_HAS_SELECTOR) {
      if (!shouldHideSystemBlocked) {
        document
          .querySelectorAll("table.plhin.s1p-system-blocked-fallback-hidden")
          .forEach((postTable) =>
            postTable.classList.remove("s1p-system-blocked-fallback-hidden")
          );
      }
      return;
    }

    document.querySelectorAll("table.plhin").forEach((postTable) => {
      const hasLockedPost = Boolean(postTable.querySelector(".locked"));
      postTable.classList.toggle(
        "s1p-system-blocked-fallback-hidden",
        shouldHideSystemBlocked && hasLockedPost
      );
    });
  };

  // [FIX] 更精确地定位帖子作者，避免错误隐藏被评分的帖子
  const hideUserPosts = (id) => {
    const normalizedUserId = normalizeNumericId(id);
    if (!normalizedUserId) return;
    document
      .querySelectorAll('.authi a[href*="space-uid-"]')
      .forEach((link) => {
        if (extractUidFromProfileHref(link.href) !== normalizedUserId) {
          return;
        }
        link
          .closest("table.plhin")
          ?.setAttribute("style", "display: none !important");
      });
  };
  const showUserPosts = (id) => {
    const normalizedUserId = normalizeNumericId(id);
    if (!normalizedUserId) return;
    document
      .querySelectorAll('.authi a[href*="space-uid-"]')
      .forEach((link) => {
        if (extractUidFromProfileHref(link.href) !== normalizedUserId) {
          return;
        }
        link.closest("table.plhin")?.removeAttribute("style");
      });
  };

  const hideBlockedUsersPosts = () => {
    const blockedUserIdSet = new Set(Object.keys(getBlockedUsers()));
    if (blockedUserIdSet.size === 0) return;

    // 单次扫描帖子，避免“按用户多次全表查询”在大页上的额外开销。
    document.querySelectorAll("table.plhin").forEach((postTable) => {
      const userLink = postTable.querySelector('.authi a[href*="space-uid-"]');
      if (!userLink) return;

      const uidMatch = userLink.href.match(/space-uid-(\d+)/);
      if (uidMatch && uidMatch[1] && blockedUserIdSet.has(uidMatch[1])) {
        postTable.setAttribute("style", "display: none !important");
      }
    });
  };

  const hideBlockedUsersPostsInTables = (postTables = []) => {
    const settings = getSettings();
    if (!settings.enableUserBlocking || !Array.isArray(postTables)) return;

    const blockedUserIdSet = new Set(Object.keys(getBlockedUsers()));
    if (blockedUserIdSet.size === 0) return;

    postTables.forEach((postTable) => {
      if (!(postTable instanceof Element)) return;
      const userLink = postTable.querySelector('.authi a[href*="space-uid-"]');
      if (!userLink) return;

      const uidMatch = userLink.href.match(/space-uid-(\d+)/);
      if (uidMatch && uidMatch[1] && blockedUserIdSet.has(uidMatch[1])) {
        postTable.setAttribute("style", "display: none !important");
      }
    });
  };

  const restoreManagedVisibilityAfterDataImport = (settings = getSettings()) => {
    const shouldApplyPostBlocking = settings.enablePostBlocking === true;
    const shouldApplyUserBlocking = settings.enableUserBlocking === true;
    const blockedThreadIdSet = shouldApplyPostBlocking
      ? new Set(Object.keys(getBlockedThreads()))
      : new Set();
    const blockedPostIdSet = shouldApplyPostBlocking
      ? new Set(Object.keys(getBlockedPosts()))
      : new Set();
    const blockedUserIdSet = shouldApplyUserBlocking
      ? new Set(Object.keys(getBlockedUsers()))
      : new Set();

    document
      .querySelectorAll('tbody[id^="normalthread_"], tbody[id^="stickthread_"]')
      .forEach((row) => {
        const threadId = row.id.replace(/^(normalthread_|stickthread_)/, "");
        if (!threadId || !blockedThreadIdSet.has(threadId)) {
          row.removeAttribute("style");
        }
      });

    document.querySelectorAll("table.plhin").forEach((postTable) => {
      const postIdMatch = postTable.id ? postTable.id.match(/^pid(\d+)$/) : null;
      const postId = postIdMatch ? postIdMatch[1] : null;

      const userLink = postTable.querySelector('.authi a[href*="space-uid-"]');
      const uidMatch = userLink ? userLink.href.match(/space-uid-(\d+)/) : null;
      const authorId = uidMatch && uidMatch[1] ? uidMatch[1] : null;

      const shouldRemainHidden =
        (postId && blockedPostIdSet.has(postId)) ||
        (authorId && blockedUserIdSet.has(authorId));

      if (!shouldRemainHidden) {
        postTable.removeAttribute("style");
      }
    });
  };

  const normalizeScopeRoots = (scopeRoots) => {
    if (Array.isArray(scopeRoots)) {
      return scopeRoots.filter((root) => root instanceof Element);
    }
    if (scopeRoots instanceof Element) {
      return [scopeRoots];
    }
    return null;
  };

  const collectNodesByScope = (scopeRoots, selector) => {
    const roots = normalizeScopeRoots(scopeRoots);
    if (roots === null) {
      return Array.from(document.querySelectorAll(selector));
    }

    const visited = new Set();
    const nodes = [];
    const addNode = (node) => {
      if (!(node instanceof Element) || visited.has(node)) return;
      visited.add(node);
      nodes.push(node);
    };

    roots.forEach((root) => {
      if (root.matches(selector)) {
        addNode(root);
      }
      root.querySelectorAll(selector).forEach(addNode);
    });

    return nodes;
  };
  const setInlineToggleExpandedState = (toggleElement, isExpanded) => {
    if (!(toggleElement instanceof HTMLButtonElement)) {
      return;
    }
    toggleElement.textContent = isExpanded ? "点击折叠" : "点击展开";
    toggleElement.classList.toggle("is-expanded", isExpanded);
    toggleElement.setAttribute("aria-expanded", String(isExpanded));
  };

  const hideBlockedUserQuotes = (scopeRoots = null) => {
    const settings = getSettings();
    const blockedUsers = getBlockedUsers();
    const blockedUserNameSet = new Set(
      Object.values(blockedUsers).map((u) => u.name)
    );

    const targetQuotes = collectNodesByScope(scopeRoots, "div.quote");
    targetQuotes.forEach((quoteElement) => {
      const quoteAuthorElement = quoteElement.querySelector(
        'blockquote font[color="#999999"]'
      );
      if (!quoteAuthorElement) return;

      const text = quoteAuthorElement.textContent.trim();
      const match = text.match(/^(.*)\s发表于\s.*$/);
      if (!match || !match[1]) return;

      const authorName = match[1];
      const isBlocked =
        settings.enableUserBlocking && blockedUserNameSet.has(authorName);

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
          const quotePlaceholderText = document.createElement("span");
          quotePlaceholderText.textContent = "一条来自已屏蔽用户的引用已被隐藏。";
          const quoteToggle = document.createElement("button");
          quoteToggle.type = "button";
          quoteToggle.className = "s1p-quote-toggle s1p-inline-toggle-btn";
          setInlineToggleExpandedState(quoteToggle, false);
          newPlaceholder.appendChild(quotePlaceholderText);
          newPlaceholder.appendChild(quoteToggle);
          newWrapper.parentNode.insertBefore(newPlaceholder, newWrapper);

          quoteToggle.addEventListener("click", function () {
            const isCollapsed = newWrapper.style.maxHeight === "0px";
            if (isCollapsed) {
              const style = window.getComputedStyle(quoteElement);
              const marginTop = parseFloat(style.marginTop);
              const marginBottom = parseFloat(style.marginBottom);
              newWrapper.style.maxHeight =
                quoteElement.offsetHeight + marginTop + marginBottom + "px";
            } else {
              newWrapper.style.maxHeight = "0px";
            }
            setInlineToggleExpandedState(this, isCollapsed);
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
  const hideBlockedUserRatings = (scopeRoots = null) => {
    const settings = getSettings();
    const isUserBlockingEnabled = settings.enableUserBlocking === true;
    const blockedUserIdSet = new Set(Object.keys(getBlockedUsers()));
    const getRatingAuthorId = (row) => {
      if (!(row instanceof Element)) {
        return "";
      }
      const userLink = row.querySelector('a[href*="space-uid-"], a[href*="uid="]');
      if (!userLink) {
        return "";
      }
      return extractUidFromSpaceUrl(
        userLink.getAttribute("href") || userLink.href || ""
      );
    };
    const targetRows = collectNodesByScope(scopeRoots, "tbody.ratl_l tr");
    targetRows.forEach((row) => {
      const authorId = getRatingAuthorId(row);
      if (!authorId) return;

      const isBlocked = isUserBlockingEnabled && blockedUserIdSet.has(authorId);
      row.style.display = isBlocked ? "none" : "";
    });

    const targetRateBlocks =
      scopeRoots === null
        ? Array.from(document.querySelectorAll("dl.rate"))
        : collectNodesByScope(scopeRoots, "dl.rate");
    targetRateBlocks.forEach((rateBlock) => {
      const ratingRows = Array.from(rateBlock.querySelectorAll("tbody.ratl_l tr"));
      if (ratingRows.length === 0) {
        rateBlock.classList.remove("s1p-hidden-blocked-rating-block");
        return;
      }

      const hasAnyUnblockedRating = ratingRows.some((row) => {
        const authorId = getRatingAuthorId(row);
        if (!authorId) {
          return true;
        }
        return !blockedUserIdSet.has(authorId);
      });

      rateBlock.classList.toggle(
        "s1p-hidden-blocked-rating-block",
        isUserBlockingEnabled && !hasAnyUnblockedRating
      );
    });
  };

  // [修改 V2] 隐藏来自已屏蔽用户的消息提醒 (占位符替换模式)
  const hideBlockedUserNotifications = (scopeRoots = null) => {
    const noticeContainer = document.querySelector(".xld.xlda");
    if (!noticeContainer) return;

    const settings = getSettings();
    const isUserBlockingEnabled = settings.enableUserBlocking === true;

    const blockedUserIdSet = new Set(Object.keys(getBlockedUsers()));
    const targetElements =
      scopeRoots === null
        ? Array.from(
          noticeContainer.querySelectorAll(
            "dl.cl, .s1p-notification-placeholder + .s1p-notification-wrapper"
          )
        )
        : (() => {
          const scopeNodes = collectNodesByScope(
            scopeRoots,
            [
              "dl.cl",
              ".s1p-notification-wrapper",
              ".s1p-notification-placeholder",
              ".xld.xlda",
            ].join(", ")
          );
          const visited = new Set();
          const nodes = [];
          const addNode = (node) => {
            if (!(node instanceof Element) || visited.has(node)) return;
            if (!noticeContainer.contains(node)) return;
            visited.add(node);
            nodes.push(node);
          };

          scopeNodes.forEach((node) => {
            if (node.matches("dl.cl, .s1p-notification-wrapper")) {
              addNode(node);
            }
            if (node.matches(".s1p-notification-placeholder")) {
              const next = node.nextElementSibling;
              if (
                next &&
                next.classList.contains("s1p-notification-wrapper")
              ) {
                addNode(next);
              }
            }
          });

          return nodes;
        })();

    // 遍历所有提醒元素或已存在的占位符的下一个元素
    targetElements.forEach((element) => {
      let dlElement;
      // 确定我们正在处理的是原始dl还是wrapper内的dl
      if (element.classList.contains("s1p-notification-wrapper")) {
        dlElement = element.querySelector("dl.cl");
      } else {
        dlElement = element;
      }

      if (!dlElement) return;

      const userLink = dlElement.querySelector('a[href*="space-uid-"]');
      if (!userLink) return;

      const uidMatch = userLink.href.match(/space-uid-(\d+)/);
      const authorId = uidMatch ? uidMatch[1] : null;
      const isBlocked =
        isUserBlockingEnabled && authorId && blockedUserIdSet.has(authorId);

      const wrapper = dlElement.parentElement.classList.contains(
        "s1p-notification-wrapper"
      )
        ? dlElement.parentElement
        : null;

      if (isBlocked) {
        if (!wrapper) {
          // 需要屏蔽，但尚未被包装 -> 执行包装和隐藏
          const newWrapper = document.createElement("div");
          newWrapper.className = "s1p-notification-wrapper";
          dlElement.parentNode.insertBefore(newWrapper, dlElement);
          newWrapper.appendChild(dlElement);

          // 关键：先获取高度，再设置为0，以便动画生效
          const initialHeight = dlElement.scrollHeight;
          newWrapper.style.maxHeight = initialHeight + "px"; // 确保初始状态正确

          requestAnimationFrame(() => {
            newWrapper.style.maxHeight = "0px";
          });

          const placeholder = document.createElement("div");
          placeholder.className = "s1p-notification-placeholder";
          const notificationPlaceholderText = document.createElement("span");
          notificationPlaceholderText.textContent =
            "一条来自已屏蔽用户的提醒已被隐藏。";
          const notificationToggle = document.createElement("button");
          notificationToggle.type = "button";
          notificationToggle.className =
            "s1p-notification-toggle s1p-inline-toggle-btn";
          setInlineToggleExpandedState(notificationToggle, false);
          placeholder.appendChild(notificationPlaceholderText);
          placeholder.appendChild(notificationToggle);
          newWrapper.parentNode.insertBefore(placeholder, newWrapper);

          notificationToggle.addEventListener("click", function () {
            const isCollapsed = newWrapper.style.maxHeight === "0px";
            if (isCollapsed) {
              newWrapper.style.maxHeight = dlElement.scrollHeight + "px";
            } else {
              newWrapper.style.maxHeight = "0px";
            }
            setInlineToggleExpandedState(this, isCollapsed);
          });
        }
      } else {
        if (wrapper) {
          // 不需要屏蔽，但已被包装 -> 解除包装
          const placeholder = wrapper.previousElementSibling;
          if (
            placeholder &&
            placeholder.classList.contains("s1p-notification-placeholder")
          ) {
            placeholder.remove();
          }
          wrapper.parentNode.insertBefore(dlElement, wrapper);
          wrapper.remove();
        }
      }
    });
  };

  const normalizePatternAsKeyword = (pattern) =>
    String(pattern || "")
      .replace(/\\(.)/g, "$1")
      .replace(/[.*+?^${}()|[\]\\]/g, "")
      .trim();
  const TITLE_RULE_MAX_REGEX_LENGTH = 160;
  const TITLE_RULE_MAX_QUANTIFIER_COUNT = 12;
  const TITLE_RULE_MAX_REPEAT_UPPER_BOUND = 200;
  const TITLE_RULE_MATCH_TITLE_MAX_LENGTH = 160;
  const getRegexPatternRiskReason = (pattern) => {
    const raw = String(pattern || "");
    if (!raw) return "空规则";
    if (raw.length > TITLE_RULE_MAX_REGEX_LENGTH) {
      return "规则长度过长";
    }
    if (/\\[1-9]/.test(raw)) {
      return "包含反向引用";
    }
    if (/\(\?/.test(raw)) {
      return "包含高级分组/断言";
    }

    let escaped = false;
    let inCharClass = false;
    let quantifierCount = 0;
    let previousToken = "none";

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (escaped) {
        escaped = false;
        previousToken = "literal";
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (inCharClass) {
        if (ch === "]") {
          inCharClass = false;
          previousToken = "literal";
        }
        continue;
      }
      if (ch === "[") {
        inCharClass = true;
        previousToken = "literal";
        continue;
      }
      if (ch === "(" || ch === ")" || ch === "|") {
        return "包含分组或管道";
      }
      if (ch === ".") {
        previousToken = "wildcard";
        continue;
      }
      if (ch === "*" || ch === "+" || ch === "?") {
        quantifierCount += 1;
        if (previousToken === "wildcard") {
          return "对通配符使用了贪婪量词";
        }
        previousToken = "quantifier";
        continue;
      }
      if (ch === "{") {
        const endIndex = raw.indexOf("}", i + 1);
        if (endIndex === -1) {
          return "量词语法不完整";
        }
        const body = raw.slice(i + 1, endIndex).trim();
        if (!/^\d+(?:,\d*)?$/.test(body)) {
          return "包含非标准量词";
        }
        const parts = body.split(",");
        const min = parseInt(parts[0], 10);
        const max =
          parts.length > 1 && parts[1] !== ""
            ? parseInt(parts[1], 10)
            : null;
        if (!Number.isFinite(min) || min > TITLE_RULE_MAX_REPEAT_UPPER_BOUND) {
          return "量词上限过大";
        }
        if (
          max !== null &&
          (!Number.isFinite(max) ||
            max > TITLE_RULE_MAX_REPEAT_UPPER_BOUND ||
            max < min)
        ) {
          return "量词范围不安全";
        }
        quantifierCount += 1;
        if (previousToken === "wildcard") {
          return "对通配符使用了范围量词";
        }
        previousToken = "quantifier";
        i = endIndex;
        continue;
      }

      previousToken = "literal";
    }

    if (inCharClass || escaped) {
      return "规则语法不完整";
    }
    if (quantifierCount > TITLE_RULE_MAX_QUANTIFIER_COUNT) {
      return "量词数量过多";
    }
    return "";
  };
  let titleRuleMatcherCacheSignature = "";
  let titleRuleMatcherCache = [];
  const buildTitleRuleMatcherCacheSignature = (rules) =>
    rules
      .map((r) => `${String(r.id || "")}\u0001${String(r.pattern || "")}`)
      .join("\u0002");
  const getCompiledTitleRuleMatchers = (rules) => {
    const signature = buildTitleRuleMatcherCacheSignature(rules);
    if (signature === titleRuleMatcherCacheSignature) {
      return titleRuleMatcherCache;
    }

    const compiled = rules
      .map((r) => {
        const pattern = String(r.pattern || "");
        const riskReason = getRegexPatternRiskReason(pattern);
        if (riskReason) {
          const keyword = normalizePatternAsKeyword(pattern);
          if (!keyword) {
            console.warn(
              `S1 Plus: 屏蔽规则 "${pattern}" 已拒绝（${riskReason}），且无法安全降级为关键词，已忽略。`
            );
            return null;
          }
          console.warn(
            `S1 Plus: 屏蔽规则 "${pattern}" 已拒绝（${riskReason}），已降级为关键词匹配。`
          );
          return {
            pattern,
            test: (title) => title.includes(keyword),
          };
        }
        try {
          const regex = new RegExp(pattern, "u");
          return {
            pattern,
            test: (title) =>
              regex.test(
                String(title || "").slice(0, TITLE_RULE_MATCH_TITLE_MAX_LENGTH)
              ),
          };
        } catch (e) {
          console.error(
            `S1 Plus: 屏蔽规则 "${pattern}" 不是一个有效的正则表达式，将被忽略。`,
            e
          );
          return null;
        }
      })
      .filter(Boolean);
    titleRuleMatcherCacheSignature = signature;
    titleRuleMatcherCache = compiled;
    return compiled;
  };

  const applyKeywordThreadHidingForRows = (
    rows = null,
    { rebuildHiddenState = true } = {}
  ) => {
    const rules = getTitleFilterRules().filter((r) => r.enabled && r.pattern);
    const matchers = getCompiledTitleRuleMatchers(rules);
    const targetRows = getThreadRowsFromScope(rows);
    const nextHiddenThreads = rebuildHiddenState
      ? {}
      : { ...dynamicallyHiddenThreads };

    targetRows.forEach((row) => {
      const titleElement = row.querySelector("th a.s.xst");
      if (!titleElement) return;

      const title = titleElement.textContent.trim();
      const threadId = row.id.replace(/^(normalthread_|stickthread_)/, "");
      if (!threadId) return;
      let isHidden = false;

      if (matchers.length > 0) {
        const matchingRule = matchers.find((r) => r.test(title));
        if (matchingRule) {
          nextHiddenThreads[threadId] = {
            title,
            pattern: matchingRule.pattern,
          };
          row.classList.add("s1p-hidden-by-keyword");
          isHidden = true;
        }
      }

      if (!isHidden) {
        row.classList.remove("s1p-hidden-by-keyword");
        delete nextHiddenThreads[threadId];
      }
    });
    dynamicallyHiddenThreads = nextHiddenThreads;
  };

  const hideThreadsByTitleKeyword = () => {
    applyKeywordThreadHidingForRows(null, { rebuildHiddenState: true });
  };

  const getReadProgress = () =>
    getCoreDataFromCache(readProgressCache, "s1p_read_progress");

  const normalizeReadProgressData = (progress) => {
    if (!progress || typeof progress !== "object" || Array.isArray(progress)) {
      return { normalizedProgress: {}, hasLegacyType: Boolean(progress) };
    }

    const normalizedProgress = {};
    let hasLegacyType = false;

    Object.keys(progress).forEach((threadId) => {
      const record = progress[threadId];
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        hasLegacyType = true;
        return;
      }

      const normalizedRecord = { ...record };
      if (
        Object.prototype.hasOwnProperty.call(normalizedRecord, "lastReadFloor") &&
        normalizedRecord.lastReadFloor !== undefined &&
        normalizedRecord.lastReadFloor !== null
      ) {
        const parsedFloor = parseInt(normalizedRecord.lastReadFloor, 10);
        if (Number.isFinite(parsedFloor) && parsedFloor > 0) {
          const normalizedFloor = String(parsedFloor);
          if (normalizedRecord.lastReadFloor !== normalizedFloor) {
            hasLegacyType = true;
          }
          normalizedRecord.lastReadFloor = normalizedFloor;
        } else {
          hasLegacyType = true;
          delete normalizedRecord.lastReadFloor;
        }
      }

      normalizedProgress[threadId] = normalizedRecord;
    });

    return { normalizedProgress, hasLegacyType };
  };

  const parseReadProgressOrderNumber = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const compareReadProgressRecords = (leftRecord, rightRecord) => {
    const leftPage = parseReadProgressOrderNumber(leftRecord?.page);
    const rightPage = parseReadProgressOrderNumber(rightRecord?.page);
    if (leftPage !== rightPage) {
      return leftPage - rightPage;
    }

    const leftFloor = parseReadProgressOrderNumber(leftRecord?.lastReadFloor);
    const rightFloor = parseReadProgressOrderNumber(rightRecord?.lastReadFloor);
    if (leftFloor !== rightFloor) {
      return leftFloor - rightFloor;
    }

    const leftTs = Number(leftRecord?.timestamp) || 0;
    const rightTs = Number(rightRecord?.timestamp) || 0;
    return leftTs - rightTs;
  };

  const mergeReadProgressMaps = (localProgress, remoteProgress) => {
    const { normalizedProgress: localNormalized } = normalizeReadProgressData(
      localProgress || {}
    );
    const { normalizedProgress: remoteNormalized } = normalizeReadProgressData(
      remoteProgress || {}
    );
    const merged = { ...remoteNormalized };

    Object.keys(localNormalized).forEach((threadId) => {
      const localRecord = localNormalized[threadId];
      const remoteRecord = merged[threadId];
      if (!remoteRecord) {
        merged[threadId] = localRecord;
        return;
      }

      if (compareReadProgressRecords(localRecord, remoteRecord) >= 0) {
        merged[threadId] = localRecord;
      }
    });

    return merged;
  };
  const buildComparableDataWithoutReadProgress = (dataObject) => {
    const sourceData = isObjectRecord(dataObject) ? dataObject : {};
    const comparableData = { ...sourceData };
    delete comparableData.read_progress;

    const rawBookmarks = sanitizeRecordObject(comparableData.bookmarked_replies);
    const normalizedBookmarks = {};
    Object.keys(rawBookmarks).forEach((postId) => {
      const item = rawBookmarks[postId];
      if (!isObjectRecord(item)) {
        return;
      }
      const normalizedItem = sanitizeRecordObject(item);
      const comparablePreview =
        buildBookmarkContentPreview(normalizedItem.contentPreview) ||
        buildBookmarkContentPreview(normalizedItem.postContent);
      delete normalizedItem.postContent;
      if (comparablePreview) {
        normalizedItem.contentPreview = comparablePreview;
      } else {
        delete normalizedItem.contentPreview;
      }
      normalizedBookmarks[postId] = normalizedItem;
    });
    comparableData.bookmarked_replies = normalizedBookmarks;
    return comparableData;
  };
  const calculateComparableBaseHashWithoutReadProgress = async (dataObject) =>
    calculateDataHash(buildComparableDataWithoutReadProgress(dataObject));
  const shortHashForLog = (hashValue) => {
    if (typeof hashValue !== "string" || !hashValue) {
      return "n/a";
    }
    return hashValue.slice(0, 10);
  };

  const saveReadProgress = (progress, suppressSyncTrigger = false) => {
    const normalizedProgress = sanitizeRecordObject(progress);
    const currentStoredProgress = getComparableStoredValue("s1p_read_progress", {});
    if (!hasComparableValueChanged(currentStoredProgress, normalizedProgress)) {
      setCoreDataCacheValue(readProgressCache, normalizedProgress);
      return;
    }
    invalidateLocalDataHashCache();
    GM_setValue("s1p_read_progress", normalizedProgress);
    setComparableStoredValue("s1p_read_progress", normalizedProgress);
    setCoreDataCacheValue(readProgressCache, normalizedProgress);
    if (!suppressSyncTrigger) {
      updateLastModifiedTimestamp("read_progress");
    }
  };

  const migrateLegacyReadProgressData = () => {
    const progress = getReadProgress();
    const { normalizedProgress, hasLegacyType } = normalizeReadProgressData(progress);
    if (!hasLegacyType) {
      return;
    }

    console.log("S1 Plus: 检测到旧版阅读进度类型，正在自动升级格式。");
    saveReadProgress(normalizedProgress, true);
    // 迁移仅修正本地格式，不直接触发自动推送；但需要更新时间戳避免后续被误判为"同时间戳冲突"。
    updateLastModifiedTimestamp("read_progress", { triggerSync: false });
  };

  const shouldAdvanceThreadProgress = (
    currentProgress,
    nextPageNumber,
    nextFloorNumber
  ) => {
    if (!currentProgress) {
      return true;
    }

    const currentPage = parseInt(currentProgress.page, 10) || 0;
    const currentFloor = parseInt(currentProgress.lastReadFloor, 10) || 0;

    if (nextPageNumber > currentPage) {
      return true;
    }
    if (nextPageNumber < currentPage) {
      return false;
    }

    return nextFloorNumber > currentFloor;
  };

  const updateThreadProgress = (threadId, postId, page, lastReadFloor) => {
    if (!postId || !page || !lastReadFloor) return;

    const nextPageNumber = parseInt(page, 10);
    const nextFloorNumber = parseInt(lastReadFloor, 10);
    if (
      !Number.isFinite(nextPageNumber) ||
      nextPageNumber <= 0 ||
      !Number.isFinite(nextFloorNumber) ||
      nextFloorNumber <= 0
    ) {
      return;
    }

    const pendingProgress = pendingThreadProgressWrites[threadId] || null;
    const currentProgress = pendingProgress || getReadProgress()[threadId];
    if (
      !shouldAdvanceThreadProgress(currentProgress, nextPageNumber, nextFloorNumber)
    ) {
      return;
    }

    pendingThreadProgressWrites[threadId] = {
      postId: String(postId),
      page: String(nextPageNumber),
      timestamp: Date.now(),
      lastReadFloor: String(nextFloorNumber),
    };
    schedulePendingThreadProgressPersist();
  };

  // 删除单个帖子阅读记录（用于列表页悬停删除入口）
  const deleteThreadReadProgress = (threadId) => {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) return false;

    if (Object.prototype.hasOwnProperty.call(pendingThreadProgressWrites, normalizedThreadId)) {
      delete pendingThreadProgressWrites[normalizedThreadId];
    }

    const progress = getReadProgress();
    if (!Object.prototype.hasOwnProperty.call(progress, normalizedThreadId)) {
      return false;
    }

    const nextProgress = { ...progress };
    delete nextProgress[normalizedThreadId];

    // 与已有手动清理逻辑保持一致，便于同步层识别本地清理行为。
    const pendingCleanupCount = parseInt(
      String(GM_getValue("s1p_pending_cleanup_info", 0)),
      10
    );
    GM_setValue(
      "s1p_pending_cleanup_info",
      (Number.isFinite(pendingCleanupCount) ? pendingCleanupCount : 0) + 1
    );
    saveReadProgress(nextProgress, false);
    scheduleProgressJumpButtonsRefresh(nextProgress);
    return true;
  };

  /**
   * 按时间区间分组阅读记录
   * @param {Object} progress - 阅读进度数据对象
   * @returns {Array} 分组后的数组，每个元素包含 label, count, ageRange, records
   */
  const groupReadProgressByTime = (progress) => {
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    // 定义时间区间（从新到旧）
    const timeRanges = [
      { label: "今天", minDays: 0, maxDays: 1 },
      { label: "本周", minDays: 1, maxDays: 7 },
      { label: "本月", minDays: 7, maxDays: 30 },
      { label: "3个月内", minDays: 30, maxDays: 90 },
      { label: "6个月内", minDays: 90, maxDays: 180 },
      { label: "1年内", minDays: 180, maxDays: 365 },
      { label: "1年以上", minDays: 365, maxDays: Infinity },
    ];

    // 初始化分组
    const groups = timeRanges.map((range) => ({
      label: range.label,
      count: 0,
      ageRange: [range.minDays * DAY_MS, range.maxDays * DAY_MS],
      records: [],
    }));

    // 遍历阅读记录，分配到对应的时间组
    for (const threadId in progress) {
      if (Object.prototype.hasOwnProperty.call(progress, threadId)) {
        const record = progress[threadId];
        if (!record.timestamp) continue;

        const age = now - record.timestamp;

        // 找到对应的时间组
        for (let i = 0; i < timeRanges.length; i++) {
          const range = timeRanges[i];
          if (age >= range.minDays * DAY_MS && age < range.maxDays * DAY_MS) {
            groups[i].count++;
            groups[i].records.push({ threadId, ...record });
            break;
          }
        }
      }
    }

    // 只返回有记录的分组
    return groups.filter((group) => group.count > 0);
  };

  const applyUserThreadBlocklistForRows = (rows = null) => {
    const blockedUsers = getBlockedUsers();
    const usersToBlockThreads = new Set(
      Object.keys(blockedUsers).filter((uid) => blockedUsers[uid].blockThreads)
    );
    if (usersToBlockThreads.size === 0) return;

    getThreadRowsFromScope(rows).forEach((row) => {
      const authorLink = row.querySelector(
        'td.by cite a[href*="space-uid-"]'
      );
      if (authorLink) {
        const uidMatch = authorLink.href.match(/space-uid-(\d+)\.html/);
        const authorId = uidMatch ? uidMatch[1] : null;
        if (authorId && usersToBlockThreads.has(authorId)) {
          const threadId = row.id.replace(/^(normalthread_|stickthread_)/, "");
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

  const applyUserThreadBlocklist = () => {
    applyUserThreadBlocklistForRows();
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

  const manageImageToggleAllButtons = (postTables = null) => {
    const settings = getSettings();
    const shouldHideImagesByDefault =
      settings.enableGeneralSettings === true &&
      settings.hideImagesByDefault === true;
    const targetPostTables = Array.isArray(postTables)
      ? postTables.filter((table) => table instanceof Element)
      : Array.from(document.querySelectorAll("table.plhin"));

    // 如果没有开启“默认隐藏图片”，则移除所有切换按钮并直接返回
    if (!shouldHideImagesByDefault) {
      const containers =
        postTables === null
          ? document.querySelectorAll(".s1p-image-toggle-all-container")
          : targetPostTables.reduce((acc, table) => {
            acc.push(...table.querySelectorAll(".s1p-image-toggle-all-container"));
            return acc;
          }, []);
      containers.forEach((el) => el.remove());
      return;
    }

    targetPostTables.forEach((postContainer) => {
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

  const restoreImagePreviewTitle = (img) => {
    if (!(img instanceof HTMLImageElement)) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(img.dataset, IMAGE_PREVIEW_TITLE_DATA_KEY)) {
      return;
    }
    const originalTitle = String(img.dataset[IMAGE_PREVIEW_TITLE_DATA_KEY] || "");
    if (originalTitle) {
      img.setAttribute("title", originalTitle);
    } else {
      img.removeAttribute("title");
    }
    delete img.dataset[IMAGE_PREVIEW_TITLE_DATA_KEY];
  };
  const buildImagePreviewTitleWithHint = (originalTitle) => {
    if (!originalTitle) {
      return IMAGE_PREVIEW_TITLE_HINT;
    }
    if (originalTitle.includes(IMAGE_PREVIEW_TITLE_HINT)) {
      return originalTitle;
    }
    return `${originalTitle} | ${IMAGE_PREVIEW_TITLE_HINT}`;
  };
  const applyImageSizeLimits = (postTables = null) => {
    const settings = getSettings();
    const normalizedState = resolveImagePreviewLimitState(settings);
    applyImagePreviewLimitRootState(normalizedState);

    const targetPostTables = Array.isArray(postTables)
      ? postTables.filter((table) => table instanceof Element)
      : null;
    const collectBySelector = (selector) => {
      if (!targetPostTables) {
        return Array.from(document.querySelectorAll(selector));
      }
      const collected = [];
      const seen = new Set();
      targetPostTables.forEach((table) => {
        if (!(table instanceof Element)) return;
        if (table.matches(selector) && !seen.has(table)) {
          seen.add(table);
          collected.push(table);
        }
        table.querySelectorAll(selector).forEach((node) => {
          if (seen.has(node)) return;
          seen.add(node);
          collected.push(node);
        });
      });
      return collected;
    };
    const targetImages = collectBySelector(
      "div.t_fsz img.zoom, div.t_fsz img[id^='aimg_']"
    );

    if (!targetPostTables) {
      const targetImageSet = new Set(targetImages);
      document
        .querySelectorAll(`img.${IMAGE_PREVIEW_LIMIT_IMAGE_CLASS}`)
        .forEach((img) => {
          if (!(img instanceof HTMLImageElement) || targetImageSet.has(img)) {
            return;
          }
          img.classList.remove(IMAGE_PREVIEW_LIMIT_IMAGE_CLASS);
          restoreImagePreviewTitle(img);
        });
    }

    const shouldLimitImages =
      normalizedState.enableGeneralSettings === true &&
      normalizedState.limitImagesBySize === true;

    targetImages.forEach((img) => {
      if (!(img instanceof HTMLImageElement)) {
        return;
      }

      if (!shouldLimitImages) {
        img.classList.remove(IMAGE_PREVIEW_LIMIT_IMAGE_CLASS);
        restoreImagePreviewTitle(img);
        return;
      }

      if (!Object.prototype.hasOwnProperty.call(img.dataset, IMAGE_PREVIEW_TITLE_DATA_KEY)) {
        img.dataset[IMAGE_PREVIEW_TITLE_DATA_KEY] = img.getAttribute("title") || "";
      }
      const originalTitle = String(img.dataset[IMAGE_PREVIEW_TITLE_DATA_KEY] || "");
      const nextTitle = buildImagePreviewTitleWithHint(originalTitle);
      img.classList.add(IMAGE_PREVIEW_LIMIT_IMAGE_CLASS);
      img.setAttribute("title", nextTitle);
    });
  };

  // --- [新增] 修改“只看该作者”为“只看该用户”的函数 ---
  const clampS1pImageViewerScale = (value) =>
    Math.min(
      S1P_IMAGE_VIEWER_MAX_SCALE,
      Math.max(S1P_IMAGE_VIEWER_MIN_SCALE, Number(value) || 1)
    );
  const normalizeS1pImageViewerSourceUrl = (rawUrl) => {
    const candidate = String(rawUrl || "").trim();
    if (!candidate || !isSafeUrlAttributeValue(candidate, { allowEmpty: false })) {
      return "";
    }
    try {
      return new URL(candidate, window.location.href).href;
    } catch (error) {
      return "";
    }
  };
  const resolveS1pImageViewerSourceUrl = (img) => {
    if (!(img instanceof HTMLImageElement)) {
      return "";
    }
    const anchor = img.closest("a[href]");
    const candidates = [
      img.getAttribute("file"),
      img.getAttribute("zoomfile"),
      anchor ? anchor.getAttribute("href") : "",
      anchor ? anchor.href : "",
      img.currentSrc,
      img.getAttribute("src"),
      img.src,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeS1pImageViewerSourceUrl(candidate);
      if (normalized) {
        return normalized;
      }
    }
    return "";
  };
  const s1pImageViewerState = {
    overlay: null,
    viewport: null,
    image: null,
    ghostImage: null,
    zoomLabel: null,
    indexLabel: null,
    zoomOutBtn: null,
    zoomInBtn: null,
    scrollUpBtn: null,
    scrollDownBtn: null,
    fitBtn: null,
    saveBtn: null,
    saveAllBtn: null,
    prevBtn: null,
    nextBtn: null,
    toolbarContinuousActionStops: [],
    toolbarContinuousActionDisposers: [],
    sourceUrl: "",
    galleryItems: [],
    currentIndex: -1,
    pendingSwitchDirection: 0,
    hasPreparedSwitchTransform: false,
    switchRequestId: 0,
    switchAnimationTimer: 0,
    transformAnimationTimer: 0,
    closeOverlayTimer: 0,
    closeAnimationTimer: 0,
    closeTransitionTarget: null,
    closeTransitionEndHandler: null,
    openPanelTimer: 0,
    openAnimationFrameId: 0,
    navHideTimer: 0,
    lastNavMoveAt: 0,
    scale: 1,
    translateX: 0,
    translateY: 0,
    isOpen: false,
    isClosing: false,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
    bodyOverflowBeforeOpen: "",
    previouslyFocusedElement: null,
    lastZoomPercent: null,
    isSingleSaving: false,
    isBatchSaving: false,
  };
  const isS1pReducedMotionPreferred = () => {
    if (typeof window.matchMedia !== "function") {
      return false;
    }
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (error) {
      return false;
    }
  };
  const resolveS1pImageViewerAnimationDuration = (durationMs) => {
    if (isS1pReducedMotionPreferred()) {
      return 0;
    }
    return Math.max(0, Number(durationMs) || 0);
  };
  const hideS1pGenericDisplayPopoverImmediately = () => {
    const popover = document.getElementById("s1p-generic-display-popover");
    if (popover && popover.s1p_api && typeof popover.s1p_api.hide === "function") {
      popover.s1p_api.hide();
    }
  };
  const clearS1pImageViewerOpenTransitionState = () => {
    const state = s1pImageViewerState;
    if (state.openAnimationFrameId) {
      window.cancelAnimationFrame(state.openAnimationFrameId);
      state.openAnimationFrameId = 0;
    }
    if (state.openPanelTimer) {
      window.clearTimeout(state.openPanelTimer);
      state.openPanelTimer = 0;
    }
  };
  const detachS1pImageViewerCloseTransitionListener = () => {
    const state = s1pImageViewerState;
    if (
      state.closeTransitionTarget instanceof Element &&
      typeof state.closeTransitionEndHandler === "function"
    ) {
      state.closeTransitionTarget.removeEventListener(
        "transitionend",
        state.closeTransitionEndHandler
      );
    }
    state.closeTransitionTarget = null;
    state.closeTransitionEndHandler = null;
  };
  const clearS1pImageViewerCloseTransitionState = () => {
    const state = s1pImageViewerState;
    if (state.closeOverlayTimer) {
      window.clearTimeout(state.closeOverlayTimer);
      state.closeOverlayTimer = 0;
    }
    if (state.closeAnimationTimer) {
      window.clearTimeout(state.closeAnimationTimer);
      state.closeAnimationTimer = 0;
    }
    detachS1pImageViewerCloseTransitionListener();
  };
  const resetS1pImageViewerOverlayVisibilityClasses = () => {
    const state = s1pImageViewerState;
    if (!state.overlay) {
      return;
    }
    state.overlay.classList.remove("is-visible");
    state.overlay.classList.remove("is-panel-open");
    state.overlay.classList.remove("is-overlay-open");
    state.overlay.classList.remove("is-nav-visible");
    state.overlay.classList.remove("has-gallery");
  };
  const canContinueS1pImageViewerClosing = () => {
    const state = s1pImageViewerState;
    return Boolean(!state.isOpen && state.isClosing && state.overlay);
  };
  const finalizeS1pImageViewerCloseState = () => {
    const state = s1pImageViewerState;
    if (state.isOpen) {
      return false;
    }
    clearS1pImageViewerCloseTransitionState();
    state.isClosing = false;
    resetS1pImageViewerOverlayVisibilityClasses();
    if (document.body) {
      document.body.style.overflow = state.bodyOverflowBeforeOpen || "";
    }
    state.sourceUrl = "";
    state.galleryItems = [];
    state.currentIndex = -1;
    syncS1pImageViewerNavigationState();
    return true;
  };
  const restoreFocusAfterS1pImageViewerClose = () => {
    const state = s1pImageViewerState;
    const overlay = state.overlay;
    const activeElement = document.activeElement;
    const restoreTarget = state.previouslyFocusedElement;
    state.previouslyFocusedElement = null;
    if (
      !(overlay instanceof HTMLElement) ||
      !(activeElement instanceof HTMLElement) ||
      !overlay.contains(activeElement)
    ) {
      return;
    }
    if (
      restoreTarget instanceof HTMLElement &&
      restoreTarget.isConnected &&
      !overlay.contains(restoreTarget)
    ) {
      try {
        restoreTarget.focus({ preventScroll: true });
      } catch (error) {
        restoreTarget.focus();
      }
    }
    const focusedElement = document.activeElement;
    if (focusedElement instanceof HTMLElement && overlay.contains(focusedElement)) {
      focusedElement.blur();
    }
  };
  const clearS1pImageViewerNavHideTimer = () => {
    const state = s1pImageViewerState;
    if (state.navHideTimer) {
      window.clearTimeout(state.navHideTimer);
      state.navHideTimer = 0;
    }
  };
  const clearS1pImageViewerSwitchGhost = () => {
    const state = s1pImageViewerState;
    if (!state.overlay) {
      return;
    }
    state.overlay.classList.remove("has-switch-ghost");
    if (state.ghostImage instanceof HTMLImageElement) {
      state.ghostImage.removeAttribute("src");
      state.ghostImage.style.transform = "";
    }
  };
  const resolveS1pImageViewerSwitchDirection = (previousIndex, nextIndex) => {
    if (previousIndex < 0 || nextIndex === previousIndex) {
      return 0;
    }
    return nextIndex > previousIndex ? 1 : -1;
  };
  const setS1pImageViewerImageTransition = (durationMs = 0) => {
    const state = s1pImageViewerState;
    if (!(state.image instanceof HTMLImageElement)) {
      return;
    }
    const resolvedDuration = resolveS1pImageViewerAnimationDuration(durationMs);
    if (resolvedDuration <= 0) {
      state.image.style.setProperty("transition", "none", "important");
      return;
    }
    const safeDuration = Math.max(60, resolvedDuration);
    state.image.style.setProperty(
      "transition",
      `transform ${safeDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      "important"
    );
  };
  const clearS1pImageViewerTransformButtonAnimation = () => {
    const state = s1pImageViewerState;
    if (state.transformAnimationTimer) {
      window.clearTimeout(state.transformAnimationTimer);
      state.transformAnimationTimer = 0;
    }
    setS1pImageViewerImageTransition(0);
  };
  const syncS1pImageViewerTransformStateFromRendered = () => {
    const state = s1pImageViewerState;
    if (!(state.image instanceof HTMLImageElement)) {
      return false;
    }
    let transformValue = "";
    try {
      transformValue = String(window.getComputedStyle(state.image).transform || "");
    } catch (error) {
      return false;
    }
    if (!transformValue || transformValue === "none") {
      return false;
    }
    const MatrixCtor =
      typeof DOMMatrixReadOnly === "function"
        ? DOMMatrixReadOnly
        : typeof DOMMatrix === "function"
          ? DOMMatrix
          : null;
    if (!MatrixCtor) {
      return false;
    }
    try {
      const matrix = new MatrixCtor(transformValue);
      const scaleX = Number(matrix.m11);
      const scaleY = Number(matrix.m22);
      const translateX = Number(matrix.m41);
      const translateY = Number(matrix.m42);
      const resolvedScale = Number.isFinite(scaleX) && Number.isFinite(scaleY)
        ? (Math.abs(scaleX) + Math.abs(scaleY)) / 2
        : Number.isFinite(scaleX)
          ? Math.abs(scaleX)
          : Number.isFinite(scaleY)
            ? Math.abs(scaleY)
            : NaN;
      let hasSynced = false;
      if (Number.isFinite(resolvedScale) && resolvedScale > 0) {
        state.scale = clampS1pImageViewerScale(resolvedScale);
        hasSynced = true;
      }
      if (Number.isFinite(translateX)) {
        state.translateX = translateX;
        hasSynced = true;
      }
      if (Number.isFinite(translateY)) {
        state.translateY = translateY;
        hasSynced = true;
      }
      return hasSynced;
    } catch (error) {
      return false;
    }
  };
  const clearS1pImageViewerSwitchAnimation = ({ keepGhost = false } = {}) => {
    const state = s1pImageViewerState;
    if (!state.overlay) {
      return;
    }
    if (state.switchAnimationTimer) {
      window.clearTimeout(state.switchAnimationTimer);
      state.switchAnimationTimer = 0;
    }
    state.overlay.classList.remove(
      "is-switching",
      "is-switching-prev",
      "is-switching-next",
      "is-preparing-switch"
    );
    if (!keepGhost) {
      clearS1pImageViewerSwitchGhost();
    }
  };
  const prepareS1pImageViewerSwitchGhost = () => {
    const state = s1pImageViewerState;
    if (
      !state.overlay ||
      !(state.image instanceof HTMLImageElement) ||
      !(state.ghostImage instanceof HTMLImageElement)
    ) {
      return false;
    }
    const currentSourceUrl = normalizeS1pImageViewerSourceUrl(
      state.image.currentSrc || state.image.src
    );
    if (!currentSourceUrl) {
      clearS1pImageViewerSwitchGhost();
      return false;
    }
    state.ghostImage.src = currentSourceUrl;
    state.ghostImage.style.transform =
      state.image.style.transform ||
      `translate3d(${state.translateX}px, ${state.translateY}px, 0) scale(${state.scale})`;
    state.overlay.classList.add("has-switch-ghost");
    return true;
  };
  const playS1pImageViewerSwitchAnimation = (direction) => {
    const state = s1pImageViewerState;
    if (!state.overlay || !state.isOpen) {
      return;
    }
    const normalizedDirection = Number(direction);
    if (!Number.isFinite(normalizedDirection) || normalizedDirection === 0) {
      clearS1pImageViewerSwitchAnimation();
      return;
    }
    const switchAnimationDurationMs = resolveS1pImageViewerAnimationDuration(
      S1P_IMAGE_VIEWER_SWITCH_ANIMATION_MS
    );
    if (switchAnimationDurationMs <= 0) {
      clearS1pImageViewerSwitchAnimation();
      return;
    }
    clearS1pImageViewerSwitchAnimation({ keepGhost: true });
    void state.overlay.offsetWidth;
    const directionClass =
      normalizedDirection > 0 ? "is-switching-next" : "is-switching-prev";
    state.overlay.classList.add("is-switching", directionClass);
    state.switchAnimationTimer = window.setTimeout(() => {
      const latestState = s1pImageViewerState;
      latestState.switchAnimationTimer = 0;
      if (!latestState.overlay) {
        return;
      }
      clearS1pImageViewerSwitchAnimation();
    }, switchAnimationDurationMs + 40);
  };
  const showS1pImageViewerNavTemporarily = (
    durationMs = S1P_IMAGE_VIEWER_NAV_AUTO_HIDE_MS
  ) => {
    const state = s1pImageViewerState;
    if (!state.overlay || !state.isOpen || state.galleryItems.length <= 1) {
      return;
    }
    state.overlay.classList.add("is-nav-visible");
    clearS1pImageViewerNavHideTimer();
    const safeDuration = Math.max(
      120,
      Number(durationMs) || S1P_IMAGE_VIEWER_NAV_AUTO_HIDE_MS
    );
    state.navHideTimer = window.setTimeout(() => {
      const latestState = s1pImageViewerState;
      latestState.navHideTimer = 0;
      if (!latestState.overlay || !latestState.isOpen || latestState.isDragging) {
        return;
      }
      latestState.overlay.classList.remove("is-nav-visible");
    }, safeDuration);
  };
  const hideS1pImageViewerNavSoon = (
    durationMs = S1P_IMAGE_VIEWER_NAV_LEAVE_HIDE_MS
  ) => {
    const state = s1pImageViewerState;
    if (!state.overlay || !state.isOpen || state.galleryItems.length <= 1) {
      return;
    }
    clearS1pImageViewerNavHideTimer();
    state.navHideTimer = window.setTimeout(() => {
      const latestState = s1pImageViewerState;
      latestState.navHideTimer = 0;
      if (!latestState.overlay || !latestState.isOpen || latestState.isDragging) {
        return;
      }
      latestState.overlay.classList.remove("is-nav-visible");
    }, Math.max(80, Number(durationMs) || S1P_IMAGE_VIEWER_NAV_LEAVE_HIDE_MS));
  };
  const handleS1pImageViewerViewportMouseMove = () => {
    const state = s1pImageViewerState;
    if (!state.isOpen) {
      return;
    }
    const now = Date.now();
    if (now - state.lastNavMoveAt < S1P_IMAGE_VIEWER_NAV_MOVE_THROTTLE_MS) {
      return;
    }
    state.lastNavMoveAt = now;
    showS1pImageViewerNavTemporarily();
  };
  const handleS1pImageViewerViewportMouseLeave = () => {
    hideS1pImageViewerNavSoon();
  };
  const collectS1pImageViewerGalleryFromTarget = (targetImage) => {
    if (!(targetImage instanceof HTMLImageElement)) {
      return { items: [], initialIndex: 0 };
    }
    const root =
      targetImage.closest("td.t_f") ||
      targetImage.closest("div.t_fsz") ||
      targetImage.closest("table.plhin") ||
      document;
    const galleryItems = [];
    const indexByUrl = new Map();
    let initialIndex = -1;
    Array.from(root.querySelectorAll(S1P_IMAGE_VIEWER_IMAGE_SELECTOR)).forEach((img) => {
      const sourceUrl = resolveS1pImageViewerSourceUrl(img);
      if (!sourceUrl) {
        return;
      }
      if (!indexByUrl.has(sourceUrl)) {
        indexByUrl.set(sourceUrl, galleryItems.length);
        galleryItems.push(sourceUrl);
      }
      if (img === targetImage) {
        initialIndex = indexByUrl.get(sourceUrl);
      }
    });
    const targetSourceUrl = resolveS1pImageViewerSourceUrl(targetImage);
    if (targetSourceUrl && !indexByUrl.has(targetSourceUrl)) {
      indexByUrl.set(targetSourceUrl, galleryItems.length);
      galleryItems.push(targetSourceUrl);
    }
    if (initialIndex < 0 && targetSourceUrl && indexByUrl.has(targetSourceUrl)) {
      initialIndex = indexByUrl.get(targetSourceUrl);
    }
    if (initialIndex < 0 || initialIndex >= galleryItems.length) {
      initialIndex = 0;
    }
    return { items: galleryItems, initialIndex };
  };
  const getS1pImageViewerViewportSize = () => {
    const state = s1pImageViewerState;
    if (!(state.viewport instanceof HTMLElement)) {
      return { width: 0, height: 0 };
    }
    const width = Number(state.viewport.clientWidth || 0);
    const height = Number(state.viewport.clientHeight || 0);
    if (width > 0 && height > 0) {
      return { width, height };
    }
    const viewportRect = state.viewport.getBoundingClientRect();
    return {
      width: Number(viewportRect.width || 0),
      height: Number(viewportRect.height || 0),
    };
  };
  const syncS1pImageViewerNavigationState = () => {
    const state = s1pImageViewerState;
    const count = state.galleryItems.length;
    const hasGallery = count > 1;
    if (state.overlay) {
      state.overlay.classList.toggle("has-gallery", hasGallery);
      if (!hasGallery) {
        state.overlay.classList.remove("is-nav-visible");
      }
    }
    if (!hasGallery) {
      clearS1pImageViewerNavHideTimer();
    }
    const safeCount = Math.max(1, count);
    let safeIndex = 0;
    if (count > 0) {
      safeIndex = Math.min(count - 1, Math.max(0, Number(state.currentIndex) || 0));
    }
    if (state.indexLabel) {
      state.indexLabel.textContent = `${safeIndex + 1}/${safeCount}`;
    }
    const disablePrev = count <= 1 || safeIndex <= 0;
    const disableNext = count <= 1 || safeIndex >= count - 1;
    if (state.prevBtn) {
      state.prevBtn.disabled = disablePrev;
    }
    if (state.nextBtn) {
      state.nextBtn.disabled = disableNext;
    }
    syncS1pImageViewerDownloadButtonState();
  };
  const requestS1pImageViewerSourceSwitch = (sourceUrl, requestId) => {
    const normalizedSourceUrl = normalizeS1pImageViewerSourceUrl(sourceUrl);
    if (!normalizedSourceUrl) {
      return;
    }
    const preloadImage = new Image();
    let isHandled = false;
    const finalizeSwitch = (naturalWidth, naturalHeight, usePreparedTransform) => {
      if (isHandled) {
        return;
      }
      isHandled = true;
      const state = s1pImageViewerState;
      if (
        !state.isOpen ||
        !state.image ||
        state.switchRequestId !== requestId ||
        state.sourceUrl !== normalizedSourceUrl
      ) {
        return;
      }
      if (state.overlay) {
        const hasGhost = state.overlay.classList.contains("has-switch-ghost");
        state.overlay.classList.toggle("is-preparing-switch", hasGhost);
      }
      state.hasPreparedSwitchTransform =
        usePreparedTransform &&
        applyS1pImageViewerFitBySize(naturalWidth, naturalHeight, {
          contain: false,
          allowUpscale: true,
        });
      state.image.src = normalizedSourceUrl;
    };
    preloadImage.addEventListener("load", () => {
      finalizeSwitch(
        Number(preloadImage.naturalWidth || 0),
        Number(preloadImage.naturalHeight || 0),
        true
      );
    });
    preloadImage.addEventListener("error", () => {
      finalizeSwitch(0, 0, false);
    });
    preloadImage.decoding = "async";
    preloadImage.src = normalizedSourceUrl;
    if (preloadImage.complete && Number(preloadImage.naturalWidth || 0) > 0) {
      finalizeSwitch(
        Number(preloadImage.naturalWidth || 0),
        Number(preloadImage.naturalHeight || 0),
        true
      );
    }
  };
  const setS1pImageViewerActiveIndex = (
    nextIndex,
    { allowSameIndexReset = false } = {}
  ) => {
    const state = s1pImageViewerState;
    const count = state.galleryItems.length;
    if (count <= 0) {
      state.currentIndex = -1;
      state.sourceUrl = "";
      syncS1pImageViewerNavigationState();
      return false;
    }
    const parsedIndex = Number.parseInt(String(nextIndex), 10);
    const normalizedIndex = Number.isFinite(parsedIndex)
      ? Math.min(count - 1, Math.max(0, parsedIndex))
      : 0;
    const nextSourceUrl = state.galleryItems[normalizedIndex];
    const previousIndex = state.currentIndex;
    const isSameTarget =
      state.currentIndex === normalizedIndex && state.sourceUrl === nextSourceUrl;
    state.currentIndex = normalizedIndex;
    state.sourceUrl = nextSourceUrl;
    syncS1pImageViewerNavigationState();
    if (!state.image) {
      return false;
    }
    if (!allowSameIndexReset && isSameTarget) {
      return false;
    }
    stopS1pImageViewerDragging();
    clearS1pImageViewerTransformButtonAnimation();
    if (state.image.src !== nextSourceUrl) {
      state.pendingSwitchDirection = resolveS1pImageViewerSwitchDirection(
        previousIndex,
        normalizedIndex
      );
      clearS1pImageViewerSwitchAnimation();
      state.switchRequestId += 1;
      const switchRequestId = state.switchRequestId;
      if (previousIndex < 0) {
        state.hasPreparedSwitchTransform = false;
        state.image.src = nextSourceUrl;
      } else {
        prepareS1pImageViewerSwitchGhost();
        requestS1pImageViewerSourceSwitch(nextSourceUrl, switchRequestId);
      }
      return true;
    }
    state.switchRequestId += 1;
    state.pendingSwitchDirection = 0;
    state.hasPreparedSwitchTransform = false;
    clearS1pImageViewerSwitchAnimation();
    if (state.image.complete && Number(state.image.naturalWidth || 0) > 0) {
      resetS1pImageViewerTransform();
    } else {
      state.scale = 1;
      state.translateX = 0;
      state.translateY = 0;
      applyS1pImageViewerTransform();
    }
    return true;
  };
  const stepS1pImageViewerActiveIndex = (delta) => {
    const state = s1pImageViewerState;
    if (state.galleryItems.length <= 1) {
      return false;
    }
    showS1pImageViewerNavTemporarily();
    return setS1pImageViewerActiveIndex(state.currentIndex + delta);
  };
  const applyS1pImageViewerTransform = () => {
    const state = s1pImageViewerState;
    if (!state.image) {
      return;
    }
    state.image.style.transform = `translate3d(${state.translateX}px, ${state.translateY}px, 0) scale(${state.scale})`;
    if (state.zoomLabel) {
      const zoomPercent = Math.round(state.scale * 100);
      if (zoomPercent !== state.lastZoomPercent) {
        state.lastZoomPercent = zoomPercent;
        state.zoomLabel.textContent = `${zoomPercent}%`;
      }
    }
  };
  const applyS1pImageViewerFitBySize = (
    naturalWidth,
    naturalHeight,
    { contain = false, allowUpscale = false } = {}
  ) => {
    const state = s1pImageViewerState;
    if (!state.viewport) {
      return false;
    }
    clearS1pImageViewerTransformButtonAnimation();
    const width = Number(naturalWidth || 0);
    const height = Number(naturalHeight || 0);
    if (width <= 0 || height <= 0) {
      return false;
    }
    const viewportSize = getS1pImageViewerViewportSize();
    const viewportWidth = Math.max(1, Number(viewportSize.width || 0));
    const viewportHeight = Math.max(1, Number(viewportSize.height || 0));
    const widthScale = viewportWidth / width;
    const containScale = Math.min(viewportWidth / width, viewportHeight / height);
    let baseScale = widthScale;
    if (contain) {
      baseScale = containScale;
    }
    if (!allowUpscale) {
      baseScale = Math.min(1, baseScale);
    }
    const targetScale = clampS1pImageViewerScale(baseScale);
    const fittedWidth = width * targetScale;
    const fittedHeight = height * targetScale;
    state.scale = targetScale;
    state.translateX = (viewportWidth - fittedWidth) / 2;
    state.translateY = contain
      ? (viewportHeight - fittedHeight) / 2
      : fittedHeight > viewportHeight
        ? 0
        : (viewportHeight - fittedHeight) / 2;
    applyS1pImageViewerTransform();
    return true;
  };
  const fitS1pImageViewerToViewport = () => {
    const state = s1pImageViewerState;
    if (!state.image || !state.viewport) {
      return false;
    }
    const naturalWidth = Number(state.image.naturalWidth || 0);
    const naturalHeight = Number(state.image.naturalHeight || 0);
    return applyS1pImageViewerFitBySize(naturalWidth, naturalHeight, {
      contain: false,
      allowUpscale: true,
    });
  };
  const fitS1pImageViewerContainToViewport = () => {
    const state = s1pImageViewerState;
    if (!state.image || !state.viewport) {
      return false;
    }
    const naturalWidth = Number(state.image.naturalWidth || 0);
    const naturalHeight = Number(state.image.naturalHeight || 0);
    return applyS1pImageViewerFitBySize(naturalWidth, naturalHeight, {
      contain: true,
      allowUpscale: false,
    });
  };
  const resetS1pImageViewerTransform = () => {
    if (fitS1pImageViewerToViewport()) {
      return;
    }
    const state = s1pImageViewerState;
    state.scale = 1;
    state.translateX = 0;
    state.translateY = 0;
    applyS1pImageViewerTransform();
  };
  const handleS1pImageViewerMouseMove = (event) => {
    const state = s1pImageViewerState;
    if (!state.isDragging) {
      return;
    }
    if ((event.buttons & 1) !== 1) {
      stopS1pImageViewerDragging();
      return;
    }
    state.translateX = state.dragOriginX + (event.clientX - state.dragStartX);
    state.translateY = state.dragOriginY + (event.clientY - state.dragStartY);
    applyS1pImageViewerTransform();
  };
  const stopS1pImageViewerDragging = () => {
    const state = s1pImageViewerState;
    if (!state.isDragging) {
      return;
    }
    state.isDragging = false;
    if (state.overlay) {
      state.overlay.classList.remove("is-dragging");
    }
    window.removeEventListener("mousemove", handleS1pImageViewerMouseMove, true);
    window.removeEventListener("mouseup", stopS1pImageViewerDragging, true);
    window.removeEventListener("blur", stopS1pImageViewerDragging, true);
  };
  const handleS1pImageViewerKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeS1pImageViewer();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepS1pImageViewerActiveIndex(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      stepS1pImageViewerActiveIndex(1);
    }
  };
  const closeS1pImageViewer = () => {
    const state = s1pImageViewerState;
    stopS1pImageViewerDragging();
    clearS1pImageViewerTransformButtonAnimation();
    stopS1pImageViewerToolbarContinuousActions();
    hideS1pGenericDisplayPopoverImmediately();
    if (!state.overlay || !state.isOpen) {
      return;
    }
    clearS1pImageViewerOpenTransitionState();
    clearS1pImageViewerCloseTransitionState();
    const closeOverlayDelayMs = resolveS1pImageViewerAnimationDuration(
      S1P_IMAGE_VIEWER_CLOSE_OVERLAY_DELAY_MS
    );
    const closeAnimationDurationMs = resolveS1pImageViewerAnimationDuration(
      S1P_IMAGE_VIEWER_OPEN_CLOSE_ANIMATION_MS
    );
    state.overlay.classList.remove("is-panel-open");
    clearS1pImageViewerSwitchAnimation();
    restoreFocusAfterS1pImageViewerClose();
    state.overlay.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", handleS1pImageViewerKeydown, true);
    state.isOpen = false;
    state.isClosing = true;
    state.pendingSwitchDirection = 0;
    state.hasPreparedSwitchTransform = false;
    state.switchRequestId += 1;
    state.lastNavMoveAt = 0;
    clearS1pImageViewerNavHideTimer();
    const handleCloseTransitionEnd = (event) => {
      const latestState = s1pImageViewerState;
      if (
        !canContinueS1pImageViewerClosing() ||
        event.target !== latestState.overlay ||
        event.propertyName !== "opacity"
      ) {
        return;
      }
      finalizeS1pImageViewerCloseState();
    };
    state.closeTransitionTarget = state.overlay;
    state.closeTransitionEndHandler = handleCloseTransitionEnd;
    state.overlay.addEventListener("transitionend", handleCloseTransitionEnd);
    state.closeOverlayTimer = window.setTimeout(() => {
      const latestState = s1pImageViewerState;
      latestState.closeOverlayTimer = 0;
      if (!canContinueS1pImageViewerClosing()) {
        return;
      }
      latestState.overlay.classList.remove("is-overlay-open");
      if (closeAnimationDurationMs <= 0) {
        finalizeS1pImageViewerCloseState();
      }
    }, closeOverlayDelayMs);
    state.closeAnimationTimer = window.setTimeout(() => {
      const latestState = s1pImageViewerState;
      latestState.closeAnimationTimer = 0;
      if (!canContinueS1pImageViewerClosing()) {
        return;
      }
      finalizeS1pImageViewerCloseState();
    }, closeOverlayDelayMs + Math.max(80, closeAnimationDurationMs) + 120);
  };
  const openS1pImageInNewTab = () => {
    const sourceUrl = String(s1pImageViewerState.sourceUrl || "");
    if (!sourceUrl) {
      return;
    }
    try {
      GM_openInTab(sourceUrl, { active: true });
    } catch (error) {
      window.open(sourceUrl, "_blank", "noopener,noreferrer");
    }
  };
  const triggerS1pImageViewerBlobDownload = (blob, fileName) => {
    if (!(blob instanceof Blob) || blob.size <= 0) {
      return false;
    }
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 3000);
    return true;
  };
  const sanitizeS1pImageViewerDownloadFileName = (fileName) => {
    const safeName = String(fileName || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "");
    return safeName;
  };
  const resolveS1pImageViewerDownloadFileName = (sourceUrl) => {
    const fallbackName = `s1plus-image-${new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14)}.jpg`;
    const normalizedSourceUrl = normalizeS1pImageViewerSourceUrl(sourceUrl);
    if (!normalizedSourceUrl) {
      return fallbackName;
    }
    try {
      const parsedUrl = new URL(normalizedSourceUrl, window.location.href);
      const queryFilenameKeys = ["filename", "file", "name", "attname"];
      for (const key of queryFilenameKeys) {
        const queryFileName = sanitizeS1pImageViewerDownloadFileName(
          parsedUrl.searchParams.get(key)
        );
        if (queryFileName) {
          return queryFileName;
        }
      }
      const rawFileName = parsedUrl.pathname.split("/").pop() || "";
      let decodedFileName = rawFileName;
      try {
        decodedFileName = decodeURIComponent(rawFileName);
      } catch (error) {
        decodedFileName = rawFileName;
      }
      const safeFileName = sanitizeS1pImageViewerDownloadFileName(decodedFileName);
      if (safeFileName) {
        return safeFileName;
      }
    } catch (error) {
      return fallbackName;
    }
    return fallbackName;
  };
  const resolveS1pHostConnectPermission = (host) => {
    const normalizedHost = String(host || "")
      .trim()
      .toLowerCase();
    if (!normalizedHost) {
      return { known: false, allowed: false };
    }
    const hasScriptConnects =
      typeof GM_info !== "undefined" &&
      GM_info &&
      GM_info.script &&
      Array.isArray(GM_info.script.connects);
    if (!hasScriptConnects) {
      return { known: false, allowed: false };
    }
    const connects = GM_info.script.connects;
    if (connects.length === 0) {
      return { known: false, allowed: false };
    }
    const allowed = connects.some((rule) => {
      const normalizedRule = String(rule || "")
        .trim()
        .toLowerCase();
      if (!normalizedRule) {
        return false;
      }
      if (normalizedRule === "*" || normalizedRule === "<all_urls>") {
        return true;
      }
      if (normalizedRule === normalizedHost) {
        return true;
      }
      if (normalizedRule.startsWith("*.")) {
        const suffix = normalizedRule.slice(2);
        return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
      }
      return false;
    });
    return { known: true, allowed };
  };
  const buildS1pImageDownloadRequestHeaders = () => {
    const headers = {};
    const referrer = String(window.location.href || "").trim();
    const origin = String(window.location.origin || "").trim();
    if (referrer) {
      headers.Referer = referrer;
    }
    if (origin) {
      headers.Origin = origin;
    }
    return headers;
  };
  const resolveS1pDownloadErrorMessage = (errorLike, fallbackMessage = "下载失败") => {
    if (!errorLike) {
      return fallbackMessage;
    }
    if (errorLike instanceof Error) {
      return String(errorLike.message || fallbackMessage);
    }
    if (typeof errorLike === "string") {
      return errorLike;
    }
    if (typeof errorLike === "object") {
      const code = String(errorLike.error || errorLike.code || "").trim();
      const details = String(errorLike.details || errorLike.message || "").trim();
      if (code && details && details !== code) {
        return `${code}: ${details}`;
      }
      if (code) {
        return code;
      }
      if (details) {
        return details;
      }
    }
    return fallbackMessage;
  };
  const createS1pImageDownloadResult = (success, errorMessage = "") => {
    return {
      success: success === true,
      errorMessage: String(errorMessage || ""),
    };
  };
  const downloadS1pImageByUrl = async (
    sourceUrl,
    { fileName = "", timeoutMs = 20000 } = {}
  ) => {
    const normalizedSourceUrl = normalizeS1pImageViewerSourceUrl(sourceUrl);
    if (!normalizedSourceUrl) {
      return createS1pImageDownloadResult(false, "图片地址无效");
    }
    const resolvedFileName =
      sanitizeS1pImageViewerDownloadFileName(fileName) ||
      resolveS1pImageViewerDownloadFileName(normalizedSourceUrl);
    const targetHost = (() => {
      try {
        return new URL(normalizedSourceUrl, window.location.href).hostname || "";
      } catch (error) {
        return "";
      }
    })();
    const requestHeaders = buildS1pImageDownloadRequestHeaders();
    let gmDownloadErrorMessage = "";

    const hasLegacyGMDownload = typeof GM_download === "function";
    const hasPromiseGMDownload =
      typeof GM === "object" && GM && typeof GM.download === "function";
    const connectPermission = resolveS1pHostConnectPermission(targetHost);

    if (connectPermission.known && !connectPermission.allowed) {
      const permissionErrorMessage = `Tampermonkey 未授权连接 ${targetHost || "目标域名"}（@connect）`;
      console.warn(
        "S1 Plus: 图片保存被 @connect 策略拦截。",
        normalizedSourceUrl,
        permissionErrorMessage
      );
      return createS1pImageDownloadResult(
        false,
        `${permissionErrorMessage}。请更新本地加载器并重新授予权限`
      );
    }

    if (hasLegacyGMDownload || hasPromiseGMDownload) {
      try {
        const downloadOptions = {
          url: normalizedSourceUrl,
          name: resolvedFileName,
          saveAs: false,
          headers: requestHeaders,
        };
        if (hasLegacyGMDownload) {
          await new Promise((resolve, reject) => {
            let settled = false;
            const resolveOnce = () => {
              if (settled) {
                return;
              }
              settled = true;
              resolve(true);
            };
            const rejectOnce = (error) => {
              if (settled) {
                return;
              }
              settled = true;
              reject(
                error instanceof Error
                  ? error
                  : new Error(resolveS1pDownloadErrorMessage(error))
              );
            };
            try {
              GM_download({
                ...downloadOptions,
                onload: resolveOnce,
                ontimeout: () => rejectOnce(new Error("下载超时")),
                onerror: (error) => rejectOnce(error),
              });
            } catch (error) {
              rejectOnce(error);
            }
          });
        } else {
          await GM.download(downloadOptions);
        }
        return createS1pImageDownloadResult(true);
      } catch (downloadError) {
        gmDownloadErrorMessage = resolveS1pDownloadErrorMessage(downloadError);
        console.warn(
          "S1 Plus: GM_download 失败，尝试回退方案。",
          normalizedSourceUrl,
          gmDownloadErrorMessage,
          downloadError
        );
      }
    }

    try {
      const response = await new Promise((resolve, reject) => {
        const requestOptions = {
          method: "GET",
          url: normalizedSourceUrl,
          responseType: "blob",
          timeout: Math.max(2000, Number(timeoutMs) || 20000),
          headers: requestHeaders,
          anonymous: false,
          onload: (rawResponse) => resolve(rawResponse),
          ontimeout: () => reject(new Error("请求超时")),
          onerror: (errorDetails) =>
            reject(
              new Error(
                `网络请求失败（${resolveS1pDownloadErrorMessage(errorDetails, "未知错误")}）`
              )
            ),
        };
        const cookieText = String(document.cookie || "").trim();
        if (cookieText) {
          requestOptions.cookie = cookieText;
        }
        GM_xmlhttpRequest({
          ...requestOptions,
        });
      });
      const statusCode = Number(response.status || 0);
      const responsePayload = response.response;
      if (statusCode !== 0 && (statusCode < 200 || statusCode >= 300)) {
        throw new Error(`HTTP ${statusCode}`);
      }
      let imageBlob = null;
      if (responsePayload instanceof Blob) {
        imageBlob = responsePayload;
      } else if (responsePayload instanceof ArrayBuffer) {
        imageBlob = new Blob([responsePayload]);
      } else if (ArrayBuffer.isView(responsePayload)) {
        imageBlob = new Blob([
          new Uint8Array(
            responsePayload.buffer,
            responsePayload.byteOffset,
            responsePayload.byteLength
          ),
        ]);
      }
      if (!(imageBlob instanceof Blob) || imageBlob.size <= 0) {
        throw new Error("图片响应格式不受支持");
      }
      if (triggerS1pImageViewerBlobDownload(imageBlob, resolvedFileName)) {
        return createS1pImageDownloadResult(true);
      }
      return createS1pImageDownloadResult(false, "浏览器触发下载失败");
    } catch (gmRequestError) {
      try {
        const fetchResponse = await fetch(normalizedSourceUrl, {
          method: "GET",
          credentials: "include",
          mode: "cors",
        });
        if (!fetchResponse.ok) {
          throw new Error(`HTTP ${fetchResponse.status}`);
        }
        const imageBlob = await fetchResponse.blob();
        if (triggerS1pImageViewerBlobDownload(imageBlob, resolvedFileName)) {
          return createS1pImageDownloadResult(true);
        }
        return createS1pImageDownloadResult(false, "浏览器触发下载失败");
      } catch (fetchError) {
        const gmRequestErrorMessage = resolveS1pDownloadErrorMessage(gmRequestError);
        const fetchErrorMessage = resolveS1pDownloadErrorMessage(fetchError);
        const errorFragments = [
          gmDownloadErrorMessage,
          gmRequestErrorMessage,
          fetchErrorMessage,
        ].filter(Boolean);
        const combinedErrorMessage = errorFragments.join("；");
        console.warn(
          "S1 Plus: 图片保存失败。",
          normalizedSourceUrl,
          combinedErrorMessage,
          gmRequestError,
          fetchError
        );
        return createS1pImageDownloadResult(
          false,
          combinedErrorMessage || "网络请求失败"
        );
      }
    }
  };
  const buildS1pImageViewerBatchDownloadFileName = (sourceUrl, index, totalCount) => {
    const baseFileName = resolveS1pImageViewerDownloadFileName(sourceUrl);
    const safeIndex = Math.max(1, Number(index) || 1);
    const safeTotalCount = Math.max(1, Number(totalCount) || 1);
    const padLength = Math.max(2, String(safeTotalCount).length);
    const indexPrefix = String(safeIndex).padStart(padLength, "0");
    return `${indexPrefix}-${baseFileName}`;
  };
  const syncS1pImageViewerDownloadButtonState = () => {
    const state = s1pImageViewerState;
    const hasSourceUrl = Boolean(String(state.sourceUrl || "").trim());
    if (state.saveBtn) {
      state.saveBtn.disabled = !hasSourceUrl || state.isBatchSaving || state.isSingleSaving;
      state.saveBtn.textContent = state.isSingleSaving ? "正在保存..." : "保存图片";
    }
    if (state.saveAllBtn) {
      const shouldShowSaveAllBtn = state.galleryItems.length > 1;
      state.saveAllBtn.style.display = shouldShowSaveAllBtn ? "" : "none";
      state.saveAllBtn.disabled =
        !shouldShowSaveAllBtn || state.isBatchSaving || state.isSingleSaving;
      state.saveAllBtn.textContent = state.isBatchSaving
        ? "正在保存..."
        : "保存全部图片";
    }
  };
  const saveS1pImageToLocal = async () => {
    const state = s1pImageViewerState;
    if (state.isSingleSaving || state.isBatchSaving) {
      showMessage("正在保存图片，请稍候...", null);
      return false;
    }
    const sourceUrl = String(state.sourceUrl || "");
    if (!sourceUrl) {
      showMessage("当前没有可保存的图片。", false);
      return false;
    }
    state.isSingleSaving = true;
    syncS1pImageViewerDownloadButtonState();
    showMessage("正在保存图片...", null);
    let result = null;
    try {
      result = await downloadS1pImageByUrl(sourceUrl);
    } finally {
      state.isSingleSaving = false;
      syncS1pImageViewerDownloadButtonState();
    }
    if (!result.success) {
      console.warn("S1 Plus: 单图保存失败。", {
        sourceUrl,
        error: String(result.errorMessage || ""),
      });
      showMessage("保存失败。", false);
      return false;
    }
    showMessage("图片已开始保存。", true);
    return true;
  };
  const saveAllS1pImagesToLocal = async () => {
    const state = s1pImageViewerState;
    if (state.isBatchSaving || state.isSingleSaving) {
      showMessage("正在保存图片，请稍候...", null);
      return false;
    }
    const imageUrls = Array.isArray(state.galleryItems)
      ? state.galleryItems.filter((url) => normalizeS1pImageViewerSourceUrl(url))
      : [];
    if (imageUrls.length <= 1) {
      showMessage("当前没有多图可批量保存。", false);
      return false;
    }

    state.isBatchSaving = true;
    syncS1pImageViewerDownloadButtonState();
    const total = imageUrls.length;
    let successCount = 0;
    let firstFailureMessage = "";
    showMessage(`开始保存，共 ${total} 张图片。`, null);
    try {
      for (let index = 0; index < total; index += 1) {
        if (!state.isOpen) {
          break;
        }
        const imageUrl = imageUrls[index];
        const fileName = buildS1pImageViewerBatchDownloadFileName(
          imageUrl,
          index + 1,
          total
        );
        // 逐张下载，减少浏览器对并发下载的拦截概率。
        const result = await downloadS1pImageByUrl(imageUrl, { fileName });
        if (result.success) {
          successCount += 1;
        } else if (!firstFailureMessage) {
          firstFailureMessage = String(result.errorMessage || "");
        }
        if (!result.success) {
          console.warn("S1 Plus: 批量保存失败项。", {
            imageUrl,
            error: String(result.errorMessage || ""),
          });
        }
        await sleep(180);
      }
    } finally {
      state.isBatchSaving = false;
      syncS1pImageViewerDownloadButtonState();
    }

    if (successCount === total) {
      showMessage(`已开始保存 ${successCount} 张图片。`, true);
      return true;
    }
    if (successCount > 0) {
      if (firstFailureMessage) {
        console.warn("S1 Plus: 批量保存部分失败。", {
          successCount,
          total,
          firstError: firstFailureMessage,
        });
      }
      showMessage(
        `部分成功：已开始保存 ${successCount}/${total} 张图片。`,
        false
      );
      return true;
    }
    console.warn("S1 Plus: 批量保存全部失败。", {
      total,
      firstError: firstFailureMessage,
    });
    showMessage("保存失败。", false);
    return false;
  };
  const handleS1pImageViewerMouseDown = (event) => {
    const state = s1pImageViewerState;
    if (!state.isOpen || event.button !== 0) {
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest(".s1p-image-viewer__nav-btn")
    ) {
      return;
    }
    showS1pImageViewerNavTemporarily();
    clearS1pImageViewerTransformButtonAnimation();
    event.preventDefault();
    state.isDragging = true;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.dragOriginX = state.translateX;
    state.dragOriginY = state.translateY;
    if (state.overlay) {
      state.overlay.classList.add("is-dragging");
    }
    window.addEventListener("mousemove", handleS1pImageViewerMouseMove, true);
    window.addEventListener("mouseup", stopS1pImageViewerDragging, true);
    window.addEventListener("blur", stopS1pImageViewerDragging, true);
  };
  const handleS1pImageViewerWheel = (event) => {
    const state = s1pImageViewerState;
    if (!state.isOpen || !state.viewport) {
      return;
    }
    showS1pImageViewerNavTemporarily();
    if (state.isDragging) {
      stopS1pImageViewerDragging();
    }
    clearS1pImageViewerTransformButtonAnimation();
    event.preventDefault();
    zoomS1pImageViewerByStep(event.deltaY < 0 ? 1 : -1);
  };
  const zoomS1pImageViewerByStep = (direction) => {
    const zoomFactor =
      Number(direction) >= 0
        ? 1 + S1P_IMAGE_VIEWER_ZOOM_STEP
        : 1 / (1 + S1P_IMAGE_VIEWER_ZOOM_STEP);
    return applyS1pImageViewerZoomFactor(zoomFactor);
  };
  const applyS1pImageViewerZoomFactor = (zoomFactor) => {
    const state = s1pImageViewerState;
    if (!state.isOpen || !state.viewport) {
      return false;
    }
    const safeZoomFactor =
      Number.isFinite(Number(zoomFactor)) && Number(zoomFactor) > 0
        ? Number(zoomFactor)
        : NaN;
    if (!Number.isFinite(safeZoomFactor) || safeZoomFactor <= 0) {
      return false;
    }
    const previousScale = state.scale;
    if (!Number.isFinite(previousScale) || previousScale <= 0) {
      return false;
    }
    const nextScale = clampS1pImageViewerScale(previousScale * safeZoomFactor);
    if (Math.abs(nextScale - previousScale) < 0.0001) {
      return false;
    }
    const viewportSize = getS1pImageViewerViewportSize();
    const centerX = Number(viewportSize.width || 0) / 2;
    const centerY = Number(viewportSize.height || 0) / 2;
    const imageX = (centerX - state.translateX) / previousScale;
    const imageY = (centerY - state.translateY) / previousScale;
    state.translateX = centerX - imageX * nextScale;
    state.translateY = centerY - imageY * nextScale;
    state.scale = nextScale;
    applyS1pImageViewerTransform();
    return true;
  };
  const zoomS1pImageViewerByContinuousDelta = (direction, deltaMs) => {
    const normalizedDirection = Number(direction);
    const safeDirection = normalizedDirection >= 0 ? 1 : -1;
    const safeDeltaMs = Math.max(1, Math.min(48, Number(deltaMs) || 0));
    const baselineDurationSec =
      Math.max(60, S1P_IMAGE_VIEWER_BUTTON_ZOOM_ANIMATION_MS) / 1000;
    const stepScalePerBaseline =
      safeDirection > 0
        ? 1 + S1P_IMAGE_VIEWER_ZOOM_STEP
        : 1 / (1 + S1P_IMAGE_VIEWER_ZOOM_STEP);
    const normalizedProgress = safeDeltaMs / (baselineDurationSec * 1000);
    const zoomFactor = Math.pow(stepScalePerBaseline, normalizedProgress);
    return applyS1pImageViewerZoomFactor(zoomFactor);
  };
  const resolveS1pImageViewerScrollStepPx = () => {
    const state = s1pImageViewerState;
    if (!state.isOpen || !state.viewport) {
      return 0;
    }
    const viewportSize = getS1pImageViewerViewportSize();
    const viewportHeight = Number(viewportSize.height || 0);
    const scrollStepPx = Math.min(
      S1P_IMAGE_VIEWER_SCROLL_STEP_MAX_PX,
      Math.max(
        S1P_IMAGE_VIEWER_SCROLL_STEP_MIN_PX,
        viewportHeight * S1P_IMAGE_VIEWER_SCROLL_STEP_RATIO
      )
    );
    if (!Number.isFinite(scrollStepPx) || scrollStepPx <= 0) {
      return 0;
    }
    return scrollStepPx;
  };
  const scrollS1pImageViewerByStep = (direction) => {
    const state = s1pImageViewerState;
    if (!state.isOpen || !state.viewport) {
      return false;
    }
    const scrollStepPx = resolveS1pImageViewerScrollStepPx();
    if (scrollStepPx <= 0) {
      return false;
    }
    const normalizedDirection = Number(direction);
    const deltaY = normalizedDirection >= 0 ? -scrollStepPx : scrollStepPx;
    state.translateY += deltaY;
    applyS1pImageViewerTransform();
    return true;
  };
  const scrollS1pImageViewerByContinuousDelta = (direction, deltaMs) => {
    const state = s1pImageViewerState;
    if (!state.isOpen || !state.viewport) {
      return false;
    }
    const baseStepPx = resolveS1pImageViewerScrollStepPx();
    if (baseStepPx <= 0) {
      return false;
    }
    const safeDeltaMs = Math.max(1, Math.min(48, Number(deltaMs) || 0));
    const baselineDurationSec =
      Math.max(80, S1P_IMAGE_VIEWER_BUTTON_SCROLL_ANIMATION_MS) / 1000;
    const distance = (baseStepPx * safeDeltaMs) / (baselineDurationSec * 1000);
    if (!Number.isFinite(distance) || distance <= 0) {
      return false;
    }
    const normalizedDirection = Number(direction);
    const deltaY = normalizedDirection >= 0 ? -distance : distance;
    state.translateY += deltaY;
    applyS1pImageViewerTransform();
    return true;
  };
  const animateS1pImageViewerTransformAction = (
    applyTransformChange,
    { syncFromRendered = false, durationMs = S1P_IMAGE_VIEWER_BUTTON_ZOOM_ANIMATION_MS } = {}
  ) => {
    const state = s1pImageViewerState;
    if (
      !state.isOpen ||
      !(state.image instanceof HTMLImageElement) ||
      typeof applyTransformChange !== "function"
    ) {
      return false;
    }
    if (syncFromRendered) {
      syncS1pImageViewerTransformStateFromRendered();
    }
    if (state.transformAnimationTimer) {
      window.clearTimeout(state.transformAnimationTimer);
      state.transformAnimationTimer = 0;
    }
    const safeDuration = resolveS1pImageViewerAnimationDuration(
      Math.max(60, Number(durationMs) || 0)
    );
    setS1pImageViewerImageTransition(safeDuration);
    const didApplyChange = applyTransformChange();
    if (!didApplyChange) {
      clearS1pImageViewerTransformButtonAnimation();
      return false;
    }
    if (safeDuration <= 0) {
      return true;
    }
    state.transformAnimationTimer = window.setTimeout(() => {
      const latestState = s1pImageViewerState;
      latestState.transformAnimationTimer = 0;
      setS1pImageViewerImageTransition(0);
    }, safeDuration + 24);
    return true;
  };
  const runS1pImageViewerToolbarTransformAction = (action) => {
    showS1pImageViewerNavTemporarily();
    if (s1pImageViewerState.isDragging) {
      stopS1pImageViewerDragging();
    }
    return action();
  };
  const animateS1pImageViewerZoomStep = (direction) => {
    return animateS1pImageViewerTransformAction(() =>
      zoomS1pImageViewerByStep(direction),
      {
        syncFromRendered: true,
        durationMs: S1P_IMAGE_VIEWER_BUTTON_ZOOM_ANIMATION_MS,
      }
    );
  };
  const animateS1pImageViewerScrollStep = (direction) => {
    return animateS1pImageViewerTransformAction(() =>
      scrollS1pImageViewerByStep(direction),
      {
        syncFromRendered: false,
        durationMs: S1P_IMAGE_VIEWER_BUTTON_SCROLL_ANIMATION_MS,
      }
    );
  };
  const stopS1pImageViewerToolbarContinuousActions = () => {
    const state = s1pImageViewerState;
    const stopHandlers = Array.isArray(state.toolbarContinuousActionStops)
      ? state.toolbarContinuousActionStops
      : [];
    stopHandlers.forEach((stop) => {
      if (typeof stop === "function") {
        stop();
      }
    });
  };
  const disposeS1pImageViewerToolbarContinuousActions = () => {
    const state = s1pImageViewerState;
    const disposeHandlers = Array.isArray(state.toolbarContinuousActionDisposers)
      ? state.toolbarContinuousActionDisposers
      : [];
    disposeHandlers.forEach((dispose) => {
      if (typeof dispose === "function") {
        dispose();
      }
    });
    state.toolbarContinuousActionStops = [];
    state.toolbarContinuousActionDisposers = [];
  };
  const bindS1pImageViewerToolbarContinuousAction = (
    button,
    action,
    {
      holdDelayMs = S1P_IMAGE_VIEWER_BUTTON_HOLD_DELAY_MS,
      repeatIntervalMs = S1P_IMAGE_VIEWER_BUTTON_ZOOM_REPEAT_INTERVAL_MS,
      continuousAction = null,
    } = {}
  ) => {
    if (!(button instanceof HTMLButtonElement) || typeof action !== "function") {
      return { stop: () => {}, dispose: () => {} };
    }

    const safeHoldDelay = Math.max(
      120,
      Number(holdDelayMs) || S1P_IMAGE_VIEWER_BUTTON_HOLD_DELAY_MS
    );
    const safeRepeatInterval = Math.max(
      48,
      Number(repeatIntervalMs) || S1P_IMAGE_VIEWER_BUTTON_ZOOM_REPEAT_INTERVAL_MS
    );
    let holdDelayTimer = 0;
    let repeatTimer = 0;
    let repeatRafId = 0;
    let repeatRafLastTime = 0;
    let activePointerId = null;
    let isPressing = false;
    let hasTriggeredContinuousAction = false;
    let suppressNextClick = false;
    let ignoreSyntheticMouseUntil = 0;
    const removeListeners = [];

    const clearTimers = () => {
      if (holdDelayTimer) {
        window.clearTimeout(holdDelayTimer);
        holdDelayTimer = 0;
      }
      if (repeatTimer) {
        window.clearInterval(repeatTimer);
        repeatTimer = 0;
      }
      if (repeatRafId) {
        window.cancelAnimationFrame(repeatRafId);
        repeatRafId = 0;
      }
      repeatRafLastTime = 0;
    };
    const stopPress = ({ resetClickSuppression = false } = {}) => {
      clearTimers();
      isPressing = false;
      if (
        activePointerId !== null &&
        typeof button.hasPointerCapture === "function" &&
        button.hasPointerCapture(activePointerId)
      ) {
        try {
          button.releasePointerCapture(activePointerId);
        } catch (error) {
          // Ignore browser-level pointer capture release failures.
        }
      }
      activePointerId = null;
      if (resetClickSuppression) {
        hasTriggeredContinuousAction = false;
        suppressNextClick = false;
      }
    };
    const addManagedListener = (target, type, listener, options) => {
      if (
        !target ||
        typeof target.addEventListener !== "function" ||
        typeof target.removeEventListener !== "function"
      ) {
        return;
      }
      target.addEventListener(type, listener, options);
      const capture =
        typeof options === "boolean"
          ? options
          : Boolean(options && typeof options === "object" && options.capture);
      removeListeners.push(() => {
        target.removeEventListener(type, listener, capture);
      });
    };
    const runContinuousActionStep = () => {
      if (!isPressing) {
        return;
      }
      if (button.disabled) {
        clearTimers();
        return;
      }
      const didApply = runS1pImageViewerToolbarTransformAction(action);
      if (didApply === false) {
        clearTimers();
      }
    };
    const runContinuousActionFrame = (now) => {
      if (!isPressing) {
        repeatRafId = 0;
        repeatRafLastTime = 0;
        return;
      }
      if (button.disabled) {
        clearTimers();
        return;
      }
      const safeNow = Number(now) || 0;
      const safeDeltaMs = Math.max(
        1,
        Math.min(
          48,
          repeatRafLastTime > 0 ? safeNow - repeatRafLastTime : 16
        )
      );
      repeatRafLastTime = safeNow;
      const didApply =
        typeof continuousAction === "function"
          ? continuousAction(safeDeltaMs)
          : false;
      if (didApply === false) {
        clearTimers();
        return;
      }
      repeatRafId = window.requestAnimationFrame(runContinuousActionFrame);
    };
    const beginPress = () => {
      if (button.disabled) {
        return false;
      }
      stopPress({ resetClickSuppression: true });
      isPressing = true;
      activePointerId = null;
      hasTriggeredContinuousAction = false;
      suppressNextClick = false;
      holdDelayTimer = window.setTimeout(() => {
        holdDelayTimer = 0;
        if (!isPressing || button.disabled) {
          return;
        }
        hasTriggeredContinuousAction = true;
        if (typeof continuousAction === "function") {
          showS1pImageViewerNavTemporarily();
          if (s1pImageViewerState.isDragging) {
            stopS1pImageViewerDragging();
          }
          clearS1pImageViewerTransformButtonAnimation();
          syncS1pImageViewerTransformStateFromRendered();
          repeatRafLastTime = 0;
          repeatRafId = window.requestAnimationFrame(runContinuousActionFrame);
          return;
        }
        runContinuousActionStep();
        repeatTimer = window.setInterval(runContinuousActionStep, safeRepeatInterval);
      }, safeHoldDelay);
      return true;
    };
    const handlePressStart = (event) => {
      if (!(event instanceof PointerEvent)) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      if (!beginPress()) {
        return;
      }
      activePointerId = event.pointerId;
      if (typeof button.setPointerCapture === "function") {
        try {
          button.setPointerCapture(event.pointerId);
        } catch (error) {
          // Ignore browser-level pointer capture failures.
        }
      }
    };
    const isPointerIdMatched = (event) => {
      if (
        event instanceof PointerEvent &&
        activePointerId !== null &&
        event.pointerId !== activePointerId
      ) {
        return false;
      }
      return true;
    };
    const handlePressEnd = (event) => {
      if (!isPointerIdMatched(event)) {
        return;
      }
      const shouldSuppressClick = hasTriggeredContinuousAction;
      stopPress();
      hasTriggeredContinuousAction = false;
      suppressNextClick = shouldSuppressClick;
    };
    const handlePressCancel = (event) => {
      if (!isPointerIdMatched(event) || !isPressing) {
        return;
      }
      stopPress({ resetClickSuppression: true });
    };
    const handleMouseDown = (event) => {
      if (!(event instanceof MouseEvent) || event.button !== 0) {
        return;
      }
      if (Date.now() < ignoreSyntheticMouseUntil) {
        return;
      }
      beginPress();
    };
    const handleMouseUp = () => {
      handlePressEnd();
    };
    const handleTouchStart = (event) => {
      if (!(event instanceof TouchEvent) || event.touches.length > 1) {
        return;
      }
      ignoreSyntheticMouseUntil = Date.now() + 800;
      beginPress();
    };
    const handleTouchEnd = () => {
      handlePressEnd();
    };
    const handleSuppressedClick = (event) => {
      if (!suppressNextClick) {
        return;
      }
      suppressNextClick = false;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    };
    const handleWindowBlur = () => {
      if (!isPressing) {
        return;
      }
      stopPress({ resetClickSuppression: true });
    };

    if (typeof window.PointerEvent === "function") {
      addManagedListener(button, "pointerdown", handlePressStart);
      addManagedListener(button, "pointerup", handlePressEnd);
      addManagedListener(button, "pointercancel", handlePressCancel);
      addManagedListener(button, "lostpointercapture", handlePressCancel);
    } else {
      addManagedListener(button, "mousedown", handleMouseDown);
      addManagedListener(window, "mouseup", handleMouseUp, true);
      addManagedListener(button, "touchstart", handleTouchStart, { passive: true });
      addManagedListener(button, "touchend", handleTouchEnd);
      addManagedListener(button, "touchcancel", handlePressCancel);
    }
    addManagedListener(button, "click", handleSuppressedClick, { capture: true });
    addManagedListener(window, "blur", handleWindowBlur);

    const stop = () => {
      stopPress({ resetClickSuppression: true });
    };
    const dispose = () => {
      stop();
      removeListeners.forEach((remove) => {
        remove();
      });
      removeListeners.length = 0;
    };
    return { stop, dispose };
  };
  const ensureS1pImageViewer = () => {
    const state = s1pImageViewerState;
    if (state.overlay && state.overlay.isConnected) {
      return;
    }
    disposeS1pImageViewerToolbarContinuousActions();
    const overlay = document.createElement("div");
    overlay.className = "s1p-image-viewer";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="s1p-image-viewer__panel" role="dialog" aria-modal="true" aria-label="S1 Plus \u56fe\u7247\u67e5\u770b\u5668">
        <div class="s1p-image-viewer__toolbar">
          <span class="s1p-image-viewer__title">S1 Plus \u56fe\u7247\u67e5\u770b\u5668</span>
          <span class="s1p-image-viewer__index">1/1</span>
          <span class="s1p-image-viewer__zoom">100%</span>
          <button
            type="button"
            class="s1p-btn s1p-image-viewer__icon-btn s1p-has-tooltip"
            data-action="zoom-out"
            data-full-tag="\u7f29\u5c0f\uff08\u957f\u6309\u53ef\u8fde\u7eed\u7f29\u653e\uff09"
            aria-label="\u7f29\u5c0f\uff08\u957f\u6309\u53ef\u8fde\u7eed\u7f29\u653e\uff09"
          >
            <svg
              class="s1p-image-viewer__zoom-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748ZM7 10H15V12H7V10Z"></path>
            </svg>
          </button>
          <button
            type="button"
            class="s1p-btn s1p-image-viewer__icon-btn s1p-has-tooltip"
            data-action="zoom-in"
            data-full-tag="\u653e\u5927\uff08\u957f\u6309\u53ef\u8fde\u7eed\u7f29\u653e\uff09"
            aria-label="\u653e\u5927\uff08\u957f\u6309\u53ef\u8fde\u7eed\u7f29\u653e\uff09"
          >
            <svg
              class="s1p-image-viewer__zoom-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748ZM10 10V7H12V10H15V12H12V15H10V12H7V10H10Z"></path>
            </svg>
          </button>
          <button
            type="button"
            class="s1p-btn s1p-image-viewer__icon-btn s1p-has-tooltip"
            data-action="scroll-up"
            data-full-tag="\u5411\u4e0a\u6eda\u52a8\uff08\u957f\u6309\u53ef\u8fde\u7eed\u6eda\u52a8\uff09"
            aria-label="\u5411\u4e0a\u6eda\u52a8\uff08\u957f\u6309\u53ef\u8fde\u7eed\u6eda\u52a8\uff09"
          >
            <svg
              class="s1p-image-viewer__zoom-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M7.41 14.59 12 10l4.59 4.59L18 13.17l-6-6-6 6z"></path>
            </svg>
          </button>
          <button
            type="button"
            class="s1p-btn s1p-image-viewer__icon-btn s1p-has-tooltip"
            data-action="scroll-down"
            data-full-tag="\u5411\u4e0b\u6eda\u52a8\uff08\u957f\u6309\u53ef\u8fde\u7eed\u6eda\u52a8\uff09"
            aria-label="\u5411\u4e0b\u6eda\u52a8\uff08\u957f\u6309\u53ef\u8fde\u7eed\u6eda\u52a8\uff09"
          >
            <svg
              class="s1p-image-viewer__zoom-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m7.41 8.59 4.59 4.58 4.59-4.58L18 10l-6 6-6-6z"></path>
            </svg>
          </button>
          <button type="button" class="s1p-btn" data-action="fit">\u5b8c\u6574\u663e\u793a</button>
          <button type="button" class="s1p-btn" data-action="reset">\u91cd\u7f6e\u89c6\u56fe</button>
          <button type="button" class="s1p-btn" data-action="save">\u4fdd\u5b58\u56fe\u7247</button>
          <button type="button" class="s1p-btn" data-action="save-all">\u4fdd\u5b58\u5168\u90e8\u56fe\u7247</button>
          <button type="button" class="s1p-btn" data-action="open">\u65b0\u6807\u7b7e\u6253\u5f00\u539f\u56fe</button>
          <button
            type="button"
            class="s1p-btn s1p-image-viewer__close-btn"
            data-action="close"
            aria-label="\u5173\u95ed (Esc)"
            title="\u5173\u95ed (Esc)"
          >
            <svg class="s1p-image-viewer__close-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M5 5L15 15"></path>
              <path d="M15 5L5 15"></path>
            </svg>
          </button>
        </div>
        <div class="s1p-image-viewer__viewport">
          <button type="button" class="s1p-image-viewer__nav-btn" data-action="prev" aria-label="\u4e0a\u4e00\u5f20">
            <svg class="s1p-image-viewer__nav-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M12.5 4.5L7 10l5.5 5.5"></path>
            </svg>
          </button>
          <div class="s1p-image-viewer__image-stage s1p-image-viewer__image-stage--ghost">
            <img class="s1p-image-viewer__image s1p-image-viewer__image-ghost" alt="" />
          </div>
          <div class="s1p-image-viewer__image-stage s1p-image-viewer__image-stage--main">
            <img class="s1p-image-viewer__image s1p-image-viewer__image-main" alt="S1 Plus \u56fe\u7247\u67e5\u770b\u5668" />
          </div>
          <button type="button" class="s1p-image-viewer__nav-btn" data-action="next" aria-label="\u4e0b\u4e00\u5f20">
            <svg class="s1p-image-viewer__nav-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M7.5 4.5L13 10l-5.5 5.5"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const panel = overlay.querySelector(".s1p-image-viewer__panel");
    const viewport = overlay.querySelector(".s1p-image-viewer__viewport");
    const imageStage = overlay.querySelector(".s1p-image-viewer__image-stage--main");
    const ghostImage = overlay.querySelector(".s1p-image-viewer__image-ghost");
    const image = overlay.querySelector(".s1p-image-viewer__image-main");
    const indexLabel = overlay.querySelector(".s1p-image-viewer__index");
    const zoomLabel = overlay.querySelector(".s1p-image-viewer__zoom");
    const zoomOutBtn = overlay.querySelector('button[data-action="zoom-out"]');
    const zoomInBtn = overlay.querySelector('button[data-action="zoom-in"]');
    const scrollUpBtn = overlay.querySelector('button[data-action="scroll-up"]');
    const scrollDownBtn = overlay.querySelector('button[data-action="scroll-down"]');
    const fitBtn = overlay.querySelector('button[data-action="fit"]');
    const prevBtn = overlay.querySelector('button[data-action="prev"]');
    const nextBtn = overlay.querySelector('button[data-action="next"]');
    const resetBtn = overlay.querySelector('button[data-action="reset"]');
    const saveBtn = overlay.querySelector('button[data-action="save"]');
    const saveAllBtn = overlay.querySelector('button[data-action="save-all"]');
    const openBtn = overlay.querySelector('button[data-action="open"]');
    const closeBtn = overlay.querySelector('button[data-action="close"]');

    if (
      !(panel instanceof HTMLElement) ||
      !(viewport instanceof HTMLElement) ||
      !(imageStage instanceof HTMLElement) ||
      !(ghostImage instanceof HTMLImageElement) ||
      !(image instanceof HTMLImageElement) ||
      !(indexLabel instanceof HTMLElement) ||
      !(zoomLabel instanceof HTMLElement) ||
      !(zoomOutBtn instanceof HTMLButtonElement) ||
      !(zoomInBtn instanceof HTMLButtonElement) ||
      !(scrollUpBtn instanceof HTMLButtonElement) ||
      !(scrollDownBtn instanceof HTMLButtonElement) ||
      !(fitBtn instanceof HTMLButtonElement) ||
      !(prevBtn instanceof HTMLButtonElement) ||
      !(nextBtn instanceof HTMLButtonElement) ||
      !(resetBtn instanceof HTMLButtonElement) ||
      !(saveBtn instanceof HTMLButtonElement) ||
      !(saveAllBtn instanceof HTMLButtonElement) ||
      !(openBtn instanceof HTMLButtonElement) ||
      !(closeBtn instanceof HTMLButtonElement)
    ) {
      overlay.remove();
      return;
    }

    image.style.setProperty("transition", "none", "important");
    image.style.transformOrigin = "0 0";
    ghostImage.style.setProperty("transition", "none", "important");
    ghostImage.style.transformOrigin = "0 0";

    image.addEventListener("dragstart", (event) => {
      event.preventDefault();
    });
    image.addEventListener("load", () => {
      const latestState = s1pImageViewerState;
      if (!latestState.isOpen || !latestState.image) {
        return;
      }
      const hasPreparedTransform = latestState.hasPreparedSwitchTransform === true;
      latestState.hasPreparedSwitchTransform = false;
      if (!hasPreparedTransform) {
        resetS1pImageViewerTransform();
      }
      if (latestState.overlay) {
        latestState.overlay.classList.remove("is-preparing-switch");
      }
      requestAnimationFrame(() => {
        const syncedState = s1pImageViewerState;
        if (!syncedState.isOpen || !syncedState.image) {
          return;
        }
        const direction = Number(syncedState.pendingSwitchDirection) || 0;
        syncedState.pendingSwitchDirection = 0;
        playS1pImageViewerSwitchAnimation(direction);
      });
    });
    image.addEventListener("error", () => {
      const latestState = s1pImageViewerState;
      latestState.hasPreparedSwitchTransform = false;
      latestState.pendingSwitchDirection = 0;
      if (latestState.overlay) {
        latestState.overlay.classList.remove("is-preparing-switch");
      }
      clearS1pImageViewerSwitchAnimation();
    });
    viewport.addEventListener("mouseenter", showS1pImageViewerNavTemporarily);
    viewport.addEventListener("mousemove", handleS1pImageViewerViewportMouseMove);
    viewport.addEventListener("mouseleave", handleS1pImageViewerViewportMouseLeave);
    viewport.addEventListener("mousedown", handleS1pImageViewerMouseDown);
    viewport.addEventListener("wheel", handleS1pImageViewerWheel, {
      passive: false,
    });
    const toolbarTransformControls = [
      {
        button: zoomOutBtn,
        action: () => animateS1pImageViewerZoomStep(-1),
        continuousAction: (deltaMs) =>
          zoomS1pImageViewerByContinuousDelta(-1, deltaMs),
        repeatIntervalMs: S1P_IMAGE_VIEWER_BUTTON_ZOOM_REPEAT_INTERVAL_MS,
      },
      {
        button: zoomInBtn,
        action: () => animateS1pImageViewerZoomStep(1),
        continuousAction: (deltaMs) =>
          zoomS1pImageViewerByContinuousDelta(1, deltaMs),
        repeatIntervalMs: S1P_IMAGE_VIEWER_BUTTON_ZOOM_REPEAT_INTERVAL_MS,
      },
      {
        button: scrollUpBtn,
        action: () => animateS1pImageViewerScrollStep(-1),
        continuousAction: (deltaMs) =>
          scrollS1pImageViewerByContinuousDelta(-1, deltaMs),
        repeatIntervalMs: S1P_IMAGE_VIEWER_BUTTON_SCROLL_REPEAT_INTERVAL_MS,
      },
      {
        button: scrollDownBtn,
        action: () => animateS1pImageViewerScrollStep(1),
        continuousAction: (deltaMs) =>
          scrollS1pImageViewerByContinuousDelta(1, deltaMs),
        repeatIntervalMs: S1P_IMAGE_VIEWER_BUTTON_SCROLL_REPEAT_INTERVAL_MS,
      },
    ];
    const toolbarContinuousActionStops = [];
    const toolbarContinuousActionDisposers = [];
    toolbarTransformControls.forEach((control) => {
      const runAction = () => runS1pImageViewerToolbarTransformAction(control.action);
      control.button.addEventListener("click", runAction);
      const binding = bindS1pImageViewerToolbarContinuousAction(
        control.button,
        control.action,
        {
          repeatIntervalMs: control.repeatIntervalMs,
          continuousAction: control.continuousAction,
        }
      );
      if (binding && typeof binding.stop === "function") {
        toolbarContinuousActionStops.push(binding.stop);
      }
      if (binding && typeof binding.dispose === "function") {
        toolbarContinuousActionDisposers.push(binding.dispose);
      }
    });
    fitBtn.addEventListener("click", () => {
      fitS1pImageViewerContainToViewport();
    });
    prevBtn.addEventListener("click", () => {
      stepS1pImageViewerActiveIndex(-1);
    });
    nextBtn.addEventListener("click", () => {
      stepS1pImageViewerActiveIndex(1);
    });
    resetBtn.addEventListener("click", () => {
      resetS1pImageViewerTransform();
    });
    saveBtn.addEventListener("click", () => {
      void saveS1pImageToLocal();
    });
    saveAllBtn.addEventListener("click", () => {
      void saveAllS1pImagesToLocal();
    });
    openBtn.addEventListener("click", () => {
      openS1pImageInNewTab();
    });
    closeBtn.addEventListener("click", () => {
      closeS1pImageViewer();
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeS1pImageViewer();
      }
    });

    state.overlay = overlay;
    state.viewport = viewport;
    state.image = image;
    state.ghostImage = ghostImage;
    state.indexLabel = indexLabel;
    state.zoomLabel = zoomLabel;
    state.zoomOutBtn = zoomOutBtn;
    state.zoomInBtn = zoomInBtn;
    state.scrollUpBtn = scrollUpBtn;
    state.scrollDownBtn = scrollDownBtn;
    state.fitBtn = fitBtn;
    state.saveBtn = saveBtn;
    state.saveAllBtn = saveAllBtn;
    state.prevBtn = prevBtn;
    state.nextBtn = nextBtn;
    state.toolbarContinuousActionStops = toolbarContinuousActionStops;
    state.toolbarContinuousActionDisposers = toolbarContinuousActionDisposers;
    syncS1pImageViewerNavigationState();
  };
  const openS1pImageViewer = (sourceUrl, options = {}) => {
    const normalizedSourceUrl = normalizeS1pImageViewerSourceUrl(sourceUrl);
    if (!normalizedSourceUrl) {
      return false;
    }
    ensureS1pImageViewer();
    const state = s1pImageViewerState;
    if (!state.overlay || !state.image) {
      return false;
    }
    const wasClosing = state.isClosing === true;
    clearS1pImageViewerCloseTransitionState();
    state.isClosing = false;
    clearS1pImageViewerOpenTransitionState();
    if (!state.isOpen && !wasClosing) {
      const activeElement = document.activeElement;
      state.previouslyFocusedElement =
        activeElement instanceof HTMLElement ? activeElement : null;
      state.bodyOverflowBeforeOpen = document.body ? document.body.style.overflow : "";
    }
    if (document.body) {
      document.body.style.overflow = "hidden";
    }
    const rawGalleryItems = Array.isArray(options.galleryItems)
      ? options.galleryItems
      : [normalizedSourceUrl];
    const galleryItems = Array.from(
      new Set(
        rawGalleryItems
          .map((url) => normalizeS1pImageViewerSourceUrl(url))
          .filter(Boolean)
      )
    );
    if (!galleryItems.includes(normalizedSourceUrl)) {
      galleryItems.push(normalizedSourceUrl);
    }
    const requestedInitialIndex = Number.parseInt(String(options.initialIndex), 10);
    const initialIndex = Number.isFinite(requestedInitialIndex)
      ? Math.min(galleryItems.length - 1, Math.max(0, requestedInitialIndex))
      : Math.max(0, galleryItems.indexOf(normalizedSourceUrl));
    state.galleryItems = galleryItems;
    state.currentIndex = -1;
    state.pendingSwitchDirection = 0;
    state.hasPreparedSwitchTransform = false;
    state.switchRequestId += 1;
    state.lastNavMoveAt = 0;
    state.lastZoomPercent = null;
    syncS1pImageViewerNavigationState();
    const openPanelDelayMs = resolveS1pImageViewerAnimationDuration(
      S1P_IMAGE_VIEWER_OPEN_PANEL_DELAY_MS
    );
    state.overlay.classList.add("is-visible");
    state.overlay.classList.remove("is-overlay-open");
    state.overlay.classList.remove("is-panel-open");
    state.overlay.setAttribute("aria-hidden", "false");
    state.isOpen = true;
    void state.overlay.offsetWidth;
    state.openAnimationFrameId = window.requestAnimationFrame(() => {
      const latestState = s1pImageViewerState;
      latestState.openAnimationFrameId = 0;
      if (!latestState.isOpen || !latestState.overlay) {
        return;
      }
      latestState.overlay.classList.add("is-overlay-open");
      if (openPanelDelayMs <= 0) {
        latestState.overlay.classList.add("is-panel-open");
        return;
      }
      latestState.openPanelTimer = window.setTimeout(() => {
        const delayedState = s1pImageViewerState;
        delayedState.openPanelTimer = 0;
        if (!delayedState.isOpen || !delayedState.overlay) {
          return;
        }
        delayedState.overlay.classList.add("is-panel-open");
      }, openPanelDelayMs);
    });
    document.removeEventListener("keydown", handleS1pImageViewerKeydown, true);
    document.addEventListener("keydown", handleS1pImageViewerKeydown, true);
    setS1pImageViewerActiveIndex(initialIndex, { allowSameIndexReset: true });
    requestAnimationFrame(() => {
      if (!state.isOpen) {
        return;
      }
      if (state.image.complete && Number(state.image.naturalWidth || 0) > 0) {
        resetS1pImageViewerTransform();
        clearS1pImageViewerSwitchAnimation();
      } else {
        state.scale = 1;
        state.translateX = 0;
        state.translateY = 0;
        applyS1pImageViewerTransform();
      }
      showS1pImageViewerNavTemporarily();
    });
    return true;
  };
  const getS1pImageViewerTargetImage = (eventTarget) => {
    if (!(eventTarget instanceof Element)) {
      return null;
    }
    const directMatch = eventTarget.closest(S1P_IMAGE_VIEWER_IMAGE_SELECTOR);
    if (directMatch && directMatch.closest("div.t_fsz")) {
      return directMatch;
    }
    const anchor = eventTarget.closest("a[href]");
    if (!anchor || !anchor.closest("div.t_fsz")) {
      return null;
    }
    return anchor.querySelector(S1P_IMAGE_VIEWER_IMAGE_SELECTOR);
  };
  const isPrimaryUnmodifiedClick = (event) => {
    if (!event || event.defaultPrevented) {
      return false;
    }
    if (event.button !== 0) {
      return false;
    }
    return !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey);
  };
  const s1pImageViewerClickHandler = (event) => {
    if (!isPrimaryUnmodifiedClick(event)) {
      return;
    }
    const settings = getSettings();
    const shouldUseS1pImageViewer =
      settings.enableGeneralSettings === true &&
      settings.useS1PlusImageViewer === true;
    if (!shouldUseS1pImageViewer) {
      return;
    }
    const targetImage = getS1pImageViewerTargetImage(event.target);
    if (!(targetImage instanceof HTMLImageElement)) {
      return;
    }
    const sourceUrl = resolveS1pImageViewerSourceUrl(targetImage);
    if (!sourceUrl) {
      return;
    }
    const galleryContext = collectS1pImageViewerGalleryFromTarget(targetImage);
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    openS1pImageViewer(sourceUrl, {
      galleryItems: galleryContext.items,
      initialIndex: galleryContext.initialIndex,
    });
  };
  let isS1pImageViewerBehaviorBound = false;
  let s1pImageViewerBehaviorBoundTarget = null;
  const applyS1pImageViewerBehavior = (_scopeRoots = null) => {
    const settings = getSettings();
    const shouldEnableS1pImageViewer =
      settings.enableGeneralSettings === true &&
      settings.useS1PlusImageViewer === true;
    const target = document;

    if (
      isS1pImageViewerBehaviorBound &&
      (!shouldEnableS1pImageViewer || s1pImageViewerBehaviorBoundTarget !== target)
    ) {
      if (s1pImageViewerBehaviorBoundTarget) {
        s1pImageViewerBehaviorBoundTarget.removeEventListener(
          "click",
          s1pImageViewerClickHandler,
          true
        );
      }
      isS1pImageViewerBehaviorBound = false;
      s1pImageViewerBehaviorBoundTarget = null;
      closeS1pImageViewer();
    }

    if (!shouldEnableS1pImageViewer) {
      return;
    }

    if (isS1pImageViewerBehaviorBound) {
      return;
    }
    target.addEventListener("click", s1pImageViewerClickHandler, true);
    isS1pImageViewerBehaviorBound = true;
    s1pImageViewerBehaviorBoundTarget = target;
  };

  const renameAuthorLinks = (scopeRoots = null) => {
    const roots = Array.isArray(scopeRoots)
      ? scopeRoots.filter((root) => root instanceof Element)
      : scopeRoots instanceof Element
        ? [scopeRoots]
        : [];
    const forEachScopedMatch = (selector, callback) => {
      if (roots.length === 0) {
        document.querySelectorAll(selector).forEach(callback);
        return;
      }
      const visited = new Set();
      roots.forEach((root) => {
        if (root.matches(selector) && !visited.has(root)) {
          visited.add(root);
          callback(root);
        }
        root.querySelectorAll(selector).forEach((node) => {
          if (visited.has(node)) return;
          visited.add(node);
          callback(node);
        });
      });
    };

    forEachScopedMatch(
      'div.authi a[href*="authorid="], .s1p-authi-actions-wrapper a[href*="authorid="]',
      (link) => {
        const linkText = link.textContent.trim();
        if (linkText === "只看该作者" || linkText === "只看该用户") {
          if (link.classList.contains("s1p-toolbar-icon-btn")) return; // 已处理过
          link.classList.add("s1p-toolbar-icon-btn", "s1p-has-tooltip");
          setSanitizedIconHtml(link, TOOLBAR_ICONS.viewAuthor);
          link.dataset.fullTag = "只看该用户";
          link.removeAttribute("title");
        }
      }
    );
    // 处理"显示全部楼层"链接
    forEachScopedMatch("div.authi a, .s1p-authi-actions-wrapper a", (link) => {
      const linkText = link.textContent.trim();
      if (linkText === "显示全部楼层") {
        if (link.classList.contains("s1p-toolbar-icon-btn")) return; // 已处理过
        link.classList.add("s1p-toolbar-icon-btn", "s1p-has-tooltip");
        setSanitizedIconHtml(link, TOOLBAR_ICONS.showAll);
        link.dataset.fullTag = "显示全部楼层";
        link.removeAttribute("title");
      } else if (linkText.includes("倒序")) {
        if (link.classList.contains("s1p-toolbar-icon-btn")) return; // 已处理过
        link.classList.add("s1p-toolbar-icon-btn", "s1p-has-tooltip");
        setSanitizedIconHtml(link, TOOLBAR_ICONS.sortDesc);
        link.dataset.fullTag = linkText;
        link.removeAttribute("title");
      } else if (linkText.includes("正序")) {
        if (link.classList.contains("s1p-toolbar-icon-btn")) return; // 已处理过
        link.classList.add("s1p-toolbar-icon-btn", "s1p-has-tooltip");
        setSanitizedIconHtml(link, TOOLBAR_ICONS.sortAsc);
        link.dataset.fullTag = linkText;
        link.removeAttribute("title");
      }
    }
    );
  };

  // [MODIFIED] 图片隐藏功能的核心逻辑 (支持实时切换)
  const applyImageHiding = (postTables = null) => {
    const settings = getSettings();
    const shouldHideImagesByDefault =
      settings.enableGeneralSettings === true &&
      settings.hideImagesByDefault === true;
    const targetPostTables = Array.isArray(postTables)
      ? postTables.filter((table) => table instanceof Element)
      : null;
    const collectBySelector = (selector) => {
      if (!targetPostTables) {
        return Array.from(document.querySelectorAll(selector));
      }
      const nodes = [];
      targetPostTables.forEach((table) => {
        if (table.matches(selector)) {
          nodes.push(table);
        }
        nodes.push(...table.querySelectorAll(selector));
      });
      return nodes;
    };

    // 如果功能未开启，则移除所有包装和占位符
    if (!shouldHideImagesByDefault) {
      collectBySelector(".s1p-image-container").forEach((container) => {
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
    collectBySelector("div.t_fsz img.zoom").forEach((img) => {
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
    collectBySelector(".s1p-image-container").forEach((container) => {
      const placeholder = container.querySelector(".s1p-image-placeholder");
      if (!placeholder) return;

      const shouldBeHidden =
        shouldHideImagesByDefault && container.dataset.manualShow !== "true";

      container.classList.toggle("hidden", shouldBeHidden);

      if (shouldBeHidden) {
        placeholder.textContent = "显示图片";
      } else {
        placeholder.textContent = "隐藏图片";
      }
    });
  };

  const trimTrailingPunctuationFromPlainUrl = (rawUrlText) => {
    let urlText = String(rawUrlText || "");
    let trailingText = "";
    while (urlText && PLAIN_URL_TRAILING_PUNCTUATION_REGEX.test(urlText.slice(-1))) {
      trailingText = urlText.slice(-1) + trailingText;
      urlText = urlText.slice(0, -1);
    }
    return { urlText, trailingText };
  };

  const normalizePlainUrlAutolinkHref = (urlText) => {
    const normalizedInput = String(urlText || "").trim();
    if (!normalizedInput) {
      return null;
    }
    const hrefCandidate = /^www\./i.test(normalizedInput)
      ? `https://${normalizedInput}`
      : normalizedInput;
    try {
      const parsedUrl = new URL(hrefCandidate, window.location.origin);
      if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
        return parsedUrl.href;
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  const resolvePlainUrlAutolinkRoots = (scopeRoots = null) => {
    const normalizedRoots = Array.isArray(scopeRoots)
      ? scopeRoots.filter((root) => root instanceof Element && root.isConnected)
      : [];
    if (normalizedRoots.length > 0) {
      return normalizedRoots;
    }

    const fallbackRoots = [];
    PLAIN_URL_AUTOLINK_FALLBACK_ROOT_IDS.forEach((rootId) => {
      const root = document.getElementById(rootId);
      if (!(root instanceof Element) || !root.isConnected) {
        return;
      }
      if (!fallbackRoots.includes(root)) {
        fallbackRoots.push(root);
      }
    });
    if (fallbackRoots.length === 0 && document.body instanceof Element) {
      fallbackRoots.push(document.body);
    }
    return fallbackRoots;
  };

  const isPlainUrlAutolinkCandidateTextNode = (node) => {
    if (!(node instanceof Text)) {
      return false;
    }
    const textContent = String(node.textContent || "");
    if (!textContent || !URL_DETECTOR_REGEX.test(textContent)) {
      return false;
    }
    const parentElement = node.parentElement;
    if (!parentElement) {
      return false;
    }
    return !parentElement.closest(PLAIN_URL_AUTOLINK_SKIP_SELECTOR);
  };

  const collectPlainUrlAutolinkCandidateTextNodes = (root) => {
    if (!(root instanceof Element)) {
      return [];
    }
    const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isPlainUrlAutolinkCandidateTextNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const candidateTextNodes = [];
    while (textWalker.nextNode()) {
      candidateTextNodes.push(textWalker.currentNode);
    }
    return candidateTextNodes;
  };

  const buildPlainUrlAutolinkFragment = (textContent) => {
    if (!URL_DETECTOR_REGEX.test(textContent)) {
      return null;
    }

    PLAIN_URL_REGEX.lastIndex = 0;
    let hasValidMatch = false;
    let previousIndex = 0;
    const fragment = document.createDocumentFragment();
    let match = PLAIN_URL_REGEX.exec(textContent);

    while (match) {
      const rawMatchedText = String(match[0] || "");
      const matchIndex = Number(match.index) || 0;

      if (matchIndex > previousIndex) {
        fragment.appendChild(
          document.createTextNode(textContent.slice(previousIndex, matchIndex))
        );
      }

      const { urlText, trailingText } =
        trimTrailingPunctuationFromPlainUrl(rawMatchedText);
      const safeHref = normalizePlainUrlAutolinkHref(urlText);
      if (urlText && safeHref) {
        const anchor = document.createElement("a");
        anchor.href = safeHref;
        anchor.textContent = urlText;
        anchor.className = PLAIN_URL_AUTOLINK_CLASS_NAME;
        anchor.dataset.s1pAutolink = PLAIN_URL_AUTOLINK_DATA_VALUE;
        fragment.appendChild(anchor);
        if (trailingText) {
          fragment.appendChild(document.createTextNode(trailingText));
        }
        hasValidMatch = true;
      } else {
        fragment.appendChild(document.createTextNode(rawMatchedText));
      }

      previousIndex = matchIndex + rawMatchedText.length;
      match = PLAIN_URL_REGEX.exec(textContent);
    }

    if (!hasValidMatch) {
      return null;
    }

    if (previousIndex < textContent.length) {
      fragment.appendChild(
        document.createTextNode(textContent.slice(previousIndex))
      );
    }
    return fragment;
  };

  const restorePlainTextUrlAutolinks = (scopeRoots = null) => {
    const rootsToScan = resolvePlainUrlAutolinkRoots(scopeRoots);
    if (rootsToScan.length === 0) {
      return;
    }

    rootsToScan.forEach((root) => {
      if (!(root instanceof Element)) {
        return;
      }
      root.querySelectorAll(AUTO_LINKED_URL_ANCHOR_SELECTOR).forEach((anchor) => {
        if (!(anchor instanceof HTMLAnchorElement)) {
          return;
        }
        anchor.replaceWith(document.createTextNode(anchor.textContent || ""));
      });
    });
  };

  const applyPlainTextUrlAutolinks = (scopeRoots = null) => {
    const settings = getSettings();
    if (
      settings.enableGeneralSettings !== true ||
      settings.autoLinkPlainTextUrls !== true
    ) {
      restorePlainTextUrlAutolinks(scopeRoots);
      return;
    }

    const rootsToScan = resolvePlainUrlAutolinkRoots(scopeRoots);

    if (rootsToScan.length === 0) {
      return;
    }

    rootsToScan.forEach((root) => {
      const candidateTextNodes = collectPlainUrlAutolinkCandidateTextNodes(root);

      candidateTextNodes.forEach((textNode) => {
        if (!(textNode instanceof Text) || !textNode.isConnected) {
          return;
        }
        const textContent = String(textNode.textContent || "");
        if (!textContent) {
          return;
        }
        const linkifiedFragment = buildPlainUrlAutolinkFragment(textContent);
        if (linkifiedFragment) {
          textNode.replaceWith(linkifiedFragment);
        }
      });
    });
  };

  const globalLinkClickHandler = (e) => {
    if (!isPrimaryUnmodifiedClick(e)) return;

    const settings = getSettings();
    const openTabSettings = settings.openInNewTab;

    if (settings.enableGeneralSettings !== true) return;
    if (!isObjectRecord(openTabSettings)) return;

    const eventTarget = e.target;
    if (!(eventTarget instanceof Element)) return;
    const anchor = eventTarget.closest("a[href]");
    if (!anchor) return;

    const href = String(anchor.getAttribute("href") || "");
    const normalizedHref = href.trim().toLowerCase();
    if (!href || normalizedHref.startsWith("#")) return;
    if (isLikelyDownloadLink(anchor, href)) return;
    const isPlainTextAutoLinkedAnchor = anchor.matches(
      AUTO_LINKED_URL_ANCHOR_SELECTOR
    );
    const isSafeForManagedOpen =
      isSafeUrlAttributeValue(href) ||
      (isPlainTextAutoLinkedAnchor && /^https?:\/\//i.test(normalizedHref));
    if (
      normalizedHref.startsWith("javascript:") ||
      normalizedHref.startsWith("vbscript:") ||
      normalizedHref.startsWith("data:text/html") ||
      isLikelyLogoutLink(anchor, href) ||
      !isSafeForManagedOpen ||
      anchor.closest(OPEN_IN_NEW_TAB_EXCLUDED_SCOPE_SELECTOR)
    ) {
      return;
    }

    // --- [核心重构 V2] 真正与执行顺序无关的精确识别 ---
    const getLinkType = (targetAnchor) => {
      // 步骤 1: 识别链接所具备的所有身份，不提前返回
      const identities = [];
      if (
        targetAnchor.classList.contains("s1p-progress-jump-btn") &&
        targetAnchor.closest(OPEN_IN_NEW_TAB_THREAD_LIST_SCOPE_SELECTOR)
      ) {
        identities.push("progress_jump");
      }
      if (targetAnchor.closest(OPEN_IN_NEW_TAB_THREAD_LIST_SCOPE_SELECTOR)) {
        identities.push("thread_list");
      }
      if (targetAnchor.closest(OPEN_IN_NEW_TAB_NOTIFICATION_SCOPE_SELECTOR)) {
        identities.push("notification");
      }
      if (targetAnchor.closest(OPEN_IN_NEW_TAB_NAV_SCOPE_SELECTOR)) {
        identities.push("header");
      }

      // 若未命中上方专属范围，则归类为全站通用链接（兜底分类）。
      if (identities.length === 0) {
        return "sitewide_link";
      }

      // 步骤 2: 定义身份的优先级顺序 (从最具体到最宽泛)
      const priorityOrder = [
        "progress_jump",
        "thread_list",
        "notification",
        "header",
      ];

      // 步骤 3: 根据优先级列表，返回链接身份中优先级最高的一个
      for (const priorityType of priorityOrder) {
        if (identities.includes(priorityType)) {
          return priorityType;
        }
      }

      // 理论上不会执行到这里，作为安全保障
      return "sitewide_link";
    };

    const linkType = getLinkType(anchor);
    const openRuleByLinkType = {
      sitewide_link: {
        openKey: "postContentLinks",
        backgroundKey: "postContentLinksInBackground",
      },
      progress_jump: {
        openKey: "progress",
        backgroundKey: "progressInBackground",
      },
      thread_list: {
        openKey: "threadList",
        backgroundKey: "threadListInBackground",
      },
      notification: {
        openKey: "threadList",
        backgroundKey: "threadListInBackground",
      },
      header: {
        openKey: "nav",
        backgroundKey: "navInBackground",
      },
    };
    const openRule = openRuleByLinkType[linkType];
    if (!openRule) {
      return;
    }

    let open = false;
    let background = false;
    let settingApplied = false;

    if (openTabSettings[openRule.openKey] === true) {
      open = true;
      background = openTabSettings[openRule.backgroundKey] === true;
      settingApplied = true;
    }

    if (open && settingApplied) {
      e.preventDefault();
      GM_openInTab(anchor.href, { active: !background });
    }
  };

  let isGlobalLinkBehaviorBound = false;
  let globalLinkBehaviorBoundTarget = null;
  const hasAnyOpenInNewTabRuleEnabled = (openInNewTabSettings) => {
    if (!openInNewTabSettings || typeof openInNewTabSettings !== "object") {
      return false;
    }
    return OPEN_IN_NEW_TAB_PRIMARY_KEYS.some(
      (key) => openInNewTabSettings[key] === true
    );
  };

  const applyGlobalLinkBehavior = () => {
    const settings = getSettings();
    const shouldBind =
      settings.enableGeneralSettings === true &&
      hasAnyOpenInNewTabRuleEnabled(settings.openInNewTab);
    const target = document.body;

    if (
      isGlobalLinkBehaviorBound &&
      (!shouldBind || globalLinkBehaviorBoundTarget !== target)
    ) {
      if (globalLinkBehaviorBoundTarget) {
        globalLinkBehaviorBoundTarget.removeEventListener(
          "click",
          globalLinkClickHandler
        );
      }
      isGlobalLinkBehaviorBound = false;
      globalLinkBehaviorBoundTarget = null;
    }

    if (!shouldBind || !target || isGlobalLinkBehaviorBound) {
      return;
    }

    target.addEventListener("click", globalLinkClickHandler);
    isGlobalLinkBehaviorBound = true;
    globalLinkBehaviorBoundTarget = target;
  };

  const getSyncedSettings = (settings = null) => {
    const sourceSettings = settings || getSettings();
    const { syncRemoteGistId, syncRemotePat, ...syncedSettings } = sourceSettings;
    return syncedSettings;
  };

  const hasSyncedSettingsChanged = (previousSettings, nextSettings) =>
    hasComparableValueChanged(
      getSyncedSettings(previousSettings),
      getSyncedSettings(nextSettings)
    );

  // [MODIFIED] 导出数据对象，采用新的嵌套结构并包含内容哈希
  const exportLocalDataObject = async (
    { compactBookmarksForSync = null, compactBlockedPostsForSync = true } = {}
  ) => {
    const currentSettings = getSettings();
    const syncedSettings = getSyncedSettings(currentSettings);
    const shouldCompactBookmarksForSync =
      typeof compactBookmarksForSync === "boolean"
        ? compactBookmarksForSync
        : currentSettings.syncBookmarkFullContent !== true;

    const data = {
      settings: syncedSettings, // 使用过滤后的设置对象
      threads: getBlockedThreads(),
      users: getBlockedUsers(),
      user_tags: getUserTags(),
      title_filter_rules: getTitleFilterRules(),
      read_progress: getReadProgress(),
      bookmarked_replies: shouldCompactBookmarksForSync
        ? getBookmarkedRepliesForSync()
        : getBookmarkedReplies(),
      blocked_posts: compactBlockedPostsForSync
        ? getBlockedPostsForSync()
        : getBlockedPosts(), // [NEW] 添加楼层屏蔽数据
    };
    const dataSnapshot = deepCloneSyncValue(data);
    const lastUpdated = GM_getValue("s1p_last_modified", 0);
    const lastUpdatedFormatted = new Date(lastUpdated).toLocaleString("zh-CN", {
      hour12: false,
    });
    const cacheKey = String(lastUpdated);
    let contentHash = localDataHashCache.contentHash;
    let baseContentHash = localDataHashCache.baseContentHash;

    if (localDataHashCache.cacheKey !== cacheKey || !contentHash || !baseContentHash) {
      contentHash = await calculateDataHash(dataSnapshot);
      const dataForBaseHash = { ...dataSnapshot };
      delete dataForBaseHash.read_progress;
      baseContentHash = await calculateDataHash(dataForBaseHash);
      localDataHashCache = {
        cacheKey,
        contentHash,
        baseContentHash,
      };
    }

    return {
      version: 5.0, // 版本号升级
      lastUpdated,
      lastUpdatedFormatted,
      contentHash,
      baseContentHash, // 新增基础哈希
      data: dataSnapshot,
    };
  };

  const exportLocalData = async () =>
    JSON.stringify(
      await exportLocalDataObject({
        compactBookmarksForSync: false,
        compactBlockedPostsForSync: false,
      }),
      null,
      2
    );

  // [MODIFIED] 导入数据，兼容新旧两种数据结构，并增加控制选项
  const importLocalData = (jsonStr, options = {}) => {
    const { suppressPostSync = false, suppressSyncTrigger = suppressPostSync } =
      options;
    try {
      invalidateLocalDataHashCache();

      // [S1P-FIX-A] 导入前重置观察器和绑定标记，避免导入后阅读进度跟踪中断。
      resetReadProgressObserver({ clearObservedMarkers: true });
      console.log("S1 Plus: 已在导入数据前重置阅读进度观察器。");

      const imported = JSON.parse(jsonStr);
      if (!isObjectRecord(imported)) {
        throw new Error("无效数据格式");
      }

      const dataToImportSource =
        imported.data && imported.version >= 4.0 ? imported.data : imported;
      if (!isObjectRecord(dataToImportSource)) {
        throw new Error("无效数据格式");
      }
      const dataToImport = sanitizeRecordObject(dataToImportSource);

      let threadsImported = 0,
        usersImported = 0,
        progressImported = 0,
        rulesImported = 0,
        tagsImported = 0,
        bookmarksImported = 0,
        postsImported = 0;
      let hasSuppressedSyncedDataTransform = false;
      let hasImportNormalizationAdjustments = false;

      const upgradeDataStructure = (type, importedData) => {
        const shouldNormalizeNumericId = type === "users" || type === "threads";
        if (!isObjectRecord(importedData)) {
          return { data: {}, changed: Boolean(importedData) };
        }

        let changed = false;
        const upgradedData = {};
        Object.keys(importedData).forEach((id) => {
          if (isUnsafeRecordKey(id)) {
            changed = true;
            return;
          }
          const normalizedId = shouldNormalizeNumericId
            ? normalizeNumericId(id)
            : id;
          if (shouldNormalizeNumericId && !normalizedId) {
            changed = true;
            return;
          }
          const targetId = normalizedId || id;
          if (targetId !== id) {
            changed = true;
          }
          const item = importedData[id];
          let nextItem = null;

          if (isObjectRecord(item)) {
            nextItem = sanitizeRecordObject(item);
            if (hasUnsafeRecordKeys(item)) {
              changed = true;
            }
          } else if (typeof item === "string" && item.trim()) {
            nextItem =
              type === "users"
                ? { name: item.trim() }
                : type === "threads"
                  ? { title: item.trim() }
                  : null;
            changed = true;
          } else {
            changed = true;
            return;
          }

          if (!nextItem || typeof nextItem !== "object") {
            changed = true;
            return;
          }

          const parsedTimestamp = Number(nextItem.timestamp);
          if (!Number.isFinite(parsedTimestamp) || parsedTimestamp <= 0) {
            nextItem.timestamp = Date.now();
            changed = true;
          }

          if (type === "users") {
            if (typeof nextItem.blockThreads === "undefined") {
              nextItem.blockThreads = false;
              changed = true;
            }
            if (!nextItem.name) {
              nextItem.name = `用户 #${targetId}`;
              changed = true;
            }
          }

          if (type === "threads") {
            if (typeof nextItem.reason === "undefined") {
              nextItem.reason = "manual";
              changed = true;
            }
            if (!nextItem.title) {
              nextItem.title = `帖子 #${targetId}`;
              changed = true;
            }
          }

          const existingItem = upgradedData[targetId];
          if (!existingItem) {
            upgradedData[targetId] = nextItem;
            return;
          }
          // 归一化后若发生 key 冲突，优先保留时间戳较新的记录。
          const existingTimestamp = Number(existingItem.timestamp) || 0;
          const nextTimestamp = Number(nextItem.timestamp) || 0;
          if (nextTimestamp >= existingTimestamp) {
            upgradedData[targetId] = nextItem;
          }
          changed = true;
        });

        return { data: upgradedData, changed };
      };

      if (dataToImport.settings) {
        const importedSettings = sanitizeRecordObject(dataToImport.settings);
        const hadUnsafeImportedSettingsKeys = hasUnsafeRecordKeys(
          dataToImport.settings
        );
        delete importedSettings.syncRemoteGistId;
        delete importedSettings.syncRemotePat;
        const {
          settings: mergedSettingsForImport,
          migrationApplied: settingsTransformedDuringImport,
        } = buildNormalizedSettings({ ...getSettings(), ...importedSettings });
        if (suppressSyncTrigger) {
          const importedSyncedSettings = deterministicSort(
            getSyncedSettings(importedSettings)
          );
          const mergedSyncedSettings = deterministicSort(
            getSyncedSettings(mergedSettingsForImport)
          );
          if (
            JSON.stringify(importedSyncedSettings) !==
            JSON.stringify(mergedSyncedSettings)
          ) {
            hasSuppressedSyncedDataTransform = true;
          }
          if (settingsTransformedDuringImport) {
            hasSuppressedSyncedDataTransform = true;
          }
          if (hadUnsafeImportedSettingsKeys) {
            hasSuppressedSyncedDataTransform = true;
          }
        }
        if (settingsTransformedDuringImport || hadUnsafeImportedSettingsKeys) {
          hasImportNormalizationAdjustments = true;
        }
        saveSettings(
          mergedSettingsForImport,
          { suppressSyncTrigger }
        );
      }

      const {
        data: threadsToSave,
        changed: threadsTransformedDuringImport,
      } = upgradeDataStructure(
        "threads",
        dataToImport.threads || {}
      );
      saveBlockedThreads(threadsToSave, suppressSyncTrigger);
      threadsImported = Object.keys(threadsToSave).length;
      if (suppressSyncTrigger && threadsTransformedDuringImport) {
        hasSuppressedSyncedDataTransform = true;
      }
      if (threadsTransformedDuringImport) {
        hasImportNormalizationAdjustments = true;
      }

      const {
        data: usersToSave,
        changed: usersTransformedDuringImport,
      } = upgradeDataStructure(
        "users",
        dataToImport.users || {}
      );
      saveBlockedUsers(usersToSave, suppressSyncTrigger);
      usersImported = Object.keys(usersToSave).length;
      if (suppressSyncTrigger && usersTransformedDuringImport) {
        hasSuppressedSyncedDataTransform = true;
      }
      if (usersTransformedDuringImport) {
        hasImportNormalizationAdjustments = true;
      }

      const hasUserTagsField = Object.prototype.hasOwnProperty.call(
        dataToImport,
        "user_tags"
      );
      const userTagsIsValidRecord =
        hasUserTagsField && isObjectRecord(dataToImport.user_tags);
      const userTagsToSave = userTagsIsValidRecord
        ? sanitizeRecordObject(dataToImport.user_tags)
        : {};
      saveUserTags(userTagsToSave, suppressSyncTrigger);
      tagsImported = Object.keys(userTagsToSave).length;
      if (
        suppressSyncTrigger &&
        (
          !userTagsIsValidRecord ||
          hasUnsafeRecordKeys(dataToImport.user_tags)
        )
      ) {
        hasSuppressedSyncedDataTransform = true;
      }
      if (!userTagsIsValidRecord || hasUnsafeRecordKeys(dataToImport.user_tags)) {
        hasImportNormalizationAdjustments = true;
      }

      const hasTitleRulesField = Object.prototype.hasOwnProperty.call(
        dataToImport,
        "title_filter_rules"
      );
      const hasLegacyTitleKeywordsField = Object.prototype.hasOwnProperty.call(
        dataToImport,
        "title_keywords"
      );
      const hasTitleRulesArray = Array.isArray(dataToImport.title_filter_rules);
      const hasLegacyTitleKeywordsArray = Array.isArray(
        dataToImport.title_keywords
      );

      if (hasTitleRulesArray) {
        saveTitleFilterRules(
          dataToImport.title_filter_rules,
          suppressSyncTrigger
        );
        rulesImported = dataToImport.title_filter_rules.length;
      } else if (hasLegacyTitleKeywordsArray) {
        const newRules = dataToImport.title_keywords.map((k) => ({
          pattern: k,
          enabled: true,
          id: `rule_${Date.now()}_${Math.random()}`,
        }));
        saveTitleFilterRules(newRules, suppressSyncTrigger);
        rulesImported = newRules.length;
        if (suppressSyncTrigger) {
          hasSuppressedSyncedDataTransform = true;
        }
        hasImportNormalizationAdjustments = true;
      } else {
        saveTitleFilterRules([], suppressSyncTrigger);
        rulesImported = 0;
        if (
          suppressSyncTrigger &&
          (
            !hasTitleRulesField ||
            (hasTitleRulesField && !hasTitleRulesArray) ||
            (hasLegacyTitleKeywordsField && !hasLegacyTitleKeywordsArray)
          )
        ) {
          hasSuppressedSyncedDataTransform = true;
        }
        if (
          !hasTitleRulesField ||
          (hasTitleRulesField && !hasTitleRulesArray) ||
          (hasLegacyTitleKeywordsField && !hasLegacyTitleKeywordsArray)
        ) {
          hasImportNormalizationAdjustments = true;
        }
      }

      const hasReadProgressField = Object.prototype.hasOwnProperty.call(
        dataToImport,
        "read_progress"
      );
      const { normalizedProgress, hasLegacyType } = normalizeReadProgressData(
        hasReadProgressField ? dataToImport.read_progress : {}
      );
      saveReadProgress(normalizedProgress, suppressSyncTrigger);
      progressImported = Object.keys(normalizedProgress).length;
      if (suppressSyncTrigger && (hasLegacyType || !hasReadProgressField)) {
        hasSuppressedSyncedDataTransform = true;
      }
      if (hasLegacyType || !hasReadProgressField) {
        hasImportNormalizationAdjustments = true;
      }

      const hasBookmarksField = Object.prototype.hasOwnProperty.call(
        dataToImport,
        "bookmarked_replies"
      );
      const bookmarksIsValidRecord =
        hasBookmarksField && isObjectRecord(dataToImport.bookmarked_replies);
      const bookmarksToSave = bookmarksIsValidRecord
        ? sanitizeRecordObject(dataToImport.bookmarked_replies)
        : {};
      saveBookmarkedReplies(bookmarksToSave, suppressSyncTrigger);
      bookmarksImported = Object.keys(bookmarksToSave).length;
      if (
        suppressSyncTrigger &&
        (
          !bookmarksIsValidRecord ||
          hasUnsafeRecordKeys(dataToImport.bookmarked_replies)
        )
      ) {
        hasSuppressedSyncedDataTransform = true;
      }
      if (
        !bookmarksIsValidRecord ||
        hasUnsafeRecordKeys(dataToImport.bookmarked_replies)
      ) {
        hasImportNormalizationAdjustments = true;
      }

      const hasBlockedPostsField = Object.prototype.hasOwnProperty.call(
        dataToImport,
        "blocked_posts"
      );
      const blockedPostsIsValidRecord =
        hasBlockedPostsField && isObjectRecord(dataToImport.blocked_posts);
      const blockedPostsToSave = blockedPostsIsValidRecord
        ? sanitizeRecordObject(dataToImport.blocked_posts)
        : {};
      saveBlockedPosts(blockedPostsToSave, suppressSyncTrigger);
      postsImported = Object.keys(blockedPostsToSave).length;
      if (
        suppressSyncTrigger &&
        (
          !blockedPostsIsValidRecord ||
          hasUnsafeRecordKeys(dataToImport.blocked_posts)
        )
      ) {
        hasSuppressedSyncedDataTransform = true;
      }
      if (
        !blockedPostsIsValidRecord ||
        hasUnsafeRecordKeys(dataToImport.blocked_posts)
      ) {
        hasImportNormalizationAdjustments = true;
      }

      const importedLastUpdated = Number(imported.lastUpdated);
      const currentLastModified = Number(GM_getValue("s1p_last_modified", 0)) || 0;
      const maxAllowedImportedLastUpdated =
        Date.now() + SYNC_TIMESTAMP_SKEW_TOLERANCE_MS;
      const normalizedImportedLastUpdated =
        Number.isFinite(importedLastUpdated) && importedLastUpdated > 0
          ? Math.min(importedLastUpdated, maxAllowedImportedLastUpdated)
          : Date.now();
      const safeLastUpdated = Math.max(
        normalizedImportedLastUpdated,
        currentLastModified + 1
      );
      GM_setValue("s1p_last_modified", safeLastUpdated);
      if (suppressSyncTrigger && hasSuppressedSyncedDataTransform) {
        updateLastModifiedTimestamp("general", { triggerSync: false });
      }

      const importedSettingsSnapshot = getSettings();
      restoreManagedVisibilityAfterDataImport(importedSettingsSnapshot);

      if (importedSettingsSnapshot.enablePostBlocking) {
        hideBlockedThreads();
        hideBlockedPosts();
        applyUserThreadBlocklist();
        hideThreadsByTitleKeyword();
      } else {
        document.querySelectorAll(".s1p-hidden-by-keyword").forEach((row) => {
          row.classList.remove("s1p-hidden-by-keyword");
        });
        dynamicallyHiddenThreads = {};
      }

      if (importedSettingsSnapshot.enableUserBlocking) {
        hideBlockedUsersPosts();
      }
      // 引用/提醒/评分函数本身会根据开关决定“隐藏或恢复”，导入后统一刷新可避免残留状态。
      hideBlockedUserQuotes();
      hideBlockedUserRatings();
      hideBlockedUserNotifications();
      initializeNavbar();
      applyInterfaceCustomizations();

      // [S1P-FIX-B] 只有在非抑制模式下（例如手动编辑文本框导入）才触发后续同步，修复强制拉取后的冗余操作问题。
      if (!suppressPostSync) {
        triggerRemoteSyncPush();
      }

      const normalizationNotice = hasImportNormalizationAdjustments
        ? " 检测到导入内容包含无效 ID 或旧格式字段，已自动修正/忽略；若修正后与当前数据等价，后续手动同步可能提示“数据已最新”。"
        : "";
      const autoSyncNotice = !suppressPostSync
        ? " 已按当前配置请求后台自动同步（若远程同步已开启）。"
        : "";
      return {
        success: true,
        message: `成功导入 ${threadsImported} 条帖子、${usersImported} 条用户、${tagsImported} 条标记、${bookmarksImported} 条收藏、${postsImported} 条楼层屏蔽、${rulesImported} 条标题规则、${progressImported} 条阅读进度及相关设置。${normalizationNotice}${autoSyncNotice}`,
      };
    } catch (e) {
      return { success: false, message: `导入失败: ${e.message}` };
    } finally {
      trackReadProgressInThread();
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const createRemoteVersionConflictError = (message, details = {}) => {
    const error = new Error(message);
    error.code = REMOTE_VERSION_CONFLICT_CODE;
    Object.assign(error, details);
    return error;
  };

  const gmRequestWithTimeout = (requestOptions) =>
    new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: REMOTE_SYNC_REQUEST_TIMEOUT_MS,
        ...requestOptions,
        onload: (response) => {
          resolve(response);
        },
        ontimeout: () => {
          const timeoutError = new Error("请求超时。");
          timeoutError.retryable = true;
          timeoutError.code = "REQUEST_TIMEOUT";
          reject(timeoutError);
        },
        onerror: () => {
          const networkError = new Error("网络请求失败。");
          networkError.retryable = true;
          reject(networkError);
        },
      });
    });

  const runRemoteRequestWithRetry = async (requestOptions) => {
    let attempt = 0;
    while (attempt <= REMOTE_SYNC_MAX_RETRIES) {
      try {
        const response = await gmRequestWithTimeout(requestOptions);
        if (response.status >= 200 && response.status < 300) {
          return response;
        }

        const httpError = new Error(`HTTP ${response.status}`);
        httpError.status = response.status;
        httpError.response = response;
        const responseTextLower = String(response.responseText || "").toLowerCase();
        const isRetryableGitHubRateLimit403 =
          response.status === 403 &&
          (responseTextLower.includes("secondary rate limit") ||
            responseTextLower.includes("api rate limit exceeded") ||
            responseTextLower.includes("retry after"));
        httpError.retryable =
          REMOTE_SYNC_RETRYABLE_STATUS.has(response.status) ||
          isRetryableGitHubRateLimit403;
        throw httpError;
      } catch (error) {
        const canRetry =
          attempt < REMOTE_SYNC_MAX_RETRIES &&
          (error.retryable || REMOTE_SYNC_RETRYABLE_STATUS.has(error.status));

        if (!canRetry) {
          throw error;
        }

        const backoffMs =
          REMOTE_SYNC_RETRY_BASE_DELAY_MS * Math.pow(2, attempt) +
          Math.floor(Math.random() * 200);
        await sleep(backoffMs);
        attempt += 1;
      }
    }
  };

  const getSyncBaselineState = () => {
    const saved = GM_getValue(SYNC_BASELINE_STATE_KEY, null);
    if (!saved || typeof saved !== "object") {
      return null;
    }
    const contentHash =
      typeof saved.contentHash === "string" && saved.contentHash
        ? saved.contentHash
        : null;
    const remoteUpdatedAt =
      typeof saved.remoteUpdatedAt === "string" && saved.remoteUpdatedAt
        ? saved.remoteUpdatedAt
        : null;
    if (!contentHash) {
      return null;
    }
    return { contentHash, remoteUpdatedAt };
  };

  const setSyncBaselineState = ({ contentHash = null, remoteUpdatedAt = null } = {}) => {
    const nextContentHash =
      typeof contentHash === "string" && contentHash ? contentHash : null;
    const nextRemoteUpdatedAt =
      typeof remoteUpdatedAt === "string" && remoteUpdatedAt
        ? remoteUpdatedAt
        : null;

    GM_setValue(SYNC_BASELINE_STATE_KEY, {
      contentHash: nextContentHash,
      remoteUpdatedAt: nextRemoteUpdatedAt,
      savedAt: Date.now(),
    });
  };

  const decideSyncActionByVersion = ({
    localDataObject,
    remoteDataObject,
    remoteUpdatedAt = undefined,
    isStartupSync = false,
    forcePullOnStartup = false,
  }) => {
    if (
      !localDataObject ||
      !remoteDataObject ||
      remoteDataObject.contentHash === localDataObject.contentHash
    ) {
      return { action: "no_change", reason: "hash_equal", localNewer: false };
    }

    const baselineState = getSyncBaselineState();
    if (baselineState) {
      const localChanged = localDataObject.contentHash !== baselineState.contentHash;
      const remoteChangedByHash =
        typeof remoteDataObject.contentHash === "string" &&
          remoteDataObject.contentHash
          ? remoteDataObject.contentHash !== baselineState.contentHash
          : null;
      const hasComparableRemoteUpdatedAt =
        typeof remoteUpdatedAt === "string" &&
        remoteUpdatedAt &&
        typeof baselineState.remoteUpdatedAt === "string" &&
        baselineState.remoteUpdatedAt;
      const remoteChangedByUpdatedAt = hasComparableRemoteUpdatedAt
        ? remoteUpdatedAt !== baselineState.remoteUpdatedAt
        : false;

      if (remoteChangedByHash === true) {
        if (localChanged) {
          return {
            action: "conflict",
            reason: "both_changed_since_baseline",
            localNewer: false,
          };
        }
        if (isStartupSync && forcePullOnStartup) {
          return {
            action: "force_pull",
            reason: "startup_force_pull_with_remote_change",
            localNewer: false,
          };
        }
        return {
          action: "pull",
          reason: "remote_changed_since_baseline",
          localNewer: false,
        };
      }

      if (remoteChangedByHash === false) {
        if (localChanged) {
          return {
            action: isStartupSync ? "skip_push_on_startup" : "push",
            reason: remoteChangedByUpdatedAt
              ? "local_changed_with_remote_timestamp_drift"
              : "local_changed_since_baseline",
            localNewer: true,
          };
        }
        return {
          action: "no_change",
          reason: remoteChangedByUpdatedAt
            ? "hash_equal_with_remote_timestamp_drift"
            : "hash_equal_since_baseline",
          localNewer: false,
        };
      }

      // 哈希不可用时回退到 updated_at 比较（兼容极端旧数据/异常数据）。
      if (hasComparableRemoteUpdatedAt) {
        if (localChanged && remoteChangedByUpdatedAt) {
          return {
            action: "conflict",
            reason: "both_changed_since_baseline_by_updated_at",
            localNewer: false,
          };
        }
        if (!localChanged && remoteChangedByUpdatedAt) {
          if (isStartupSync && forcePullOnStartup) {
            return {
              action: "force_pull",
              reason: "startup_force_pull_with_remote_change",
              localNewer: false,
            };
          }
          return {
            action: "pull",
            reason: "remote_changed_since_baseline",
            localNewer: false,
          };
        }
        if (localChanged && !remoteChangedByUpdatedAt) {
          return {
            action: isStartupSync ? "skip_push_on_startup" : "push",
            reason: "local_changed_since_baseline",
            localNewer: true,
          };
        }
      }

      return {
        action: "conflict",
        reason: "baseline_indicates_no_change_but_hash_diff",
        localNewer: false,
      };
    }

    const localTs = Number(localDataObject.lastUpdated);
    const remoteTs = Number(remoteDataObject.lastUpdated);
    const hasComparableTimestamps =
      Number.isFinite(localTs) &&
      localTs > 0 &&
      Number.isFinite(remoteTs) &&
      remoteTs > 0;

    if (!hasComparableTimestamps) {
      if (isStartupSync && forcePullOnStartup) {
        return {
          action: "force_pull",
          reason: "startup_force_pull_without_comparable_timestamps",
          localNewer: false,
        };
      }
      return {
        action: "conflict",
        reason: "insufficient_version_ordering",
        localNewer: false,
      };
    }

    if (localTs === remoteTs) {
      return {
        action: "conflict",
        reason: "timestamps_match_hash_diff",
        localNewer: false,
      };
    }

    if (Math.abs(localTs - remoteTs) > SYNC_TIMESTAMP_SKEW_TOLERANCE_MS) {
      return {
        action: "conflict",
        reason: "clock_skew_suspected",
        localNewer: localTs > remoteTs,
      };
    }

    if (isStartupSync && forcePullOnStartup) {
      return {
        action: "force_pull",
        reason: "startup_force_pull",
        localNewer: false,
      };
    }

    if (remoteTs > localTs) {
      return {
        action: "pull",
        reason: "timestamp_remote_newer",
        localNewer: false,
      };
    }

    return {
      action: isStartupSync ? "skip_push_on_startup" : "push",
      reason: "timestamp_local_newer",
      localNewer: true,
    };
  };

  const getManualSyncLockValue = () => {
    const lock = GM_getValue(MANUAL_SYNC_LOCK_KEY, null);
    if (
      lock &&
      typeof lock === "object" &&
      lock.owner &&
      typeof lock.timestamp === "number"
    ) {
      return lock;
    }
    return null;
  };

  const getGlobalSyncLockValue = () => {
    const lock = GM_getValue(GLOBAL_SYNC_LOCK_KEY, null);
    const ttlMs = Number(lock?.ttlMs);
    if (
      lock &&
      typeof lock === "object" &&
      lock.owner &&
      typeof lock.timestamp === "number" &&
      typeof lock.mode === "string" &&
      Number.isFinite(ttlMs) &&
      ttlMs > 0
    ) {
      return {
        owner: lock.owner,
        timestamp: lock.timestamp,
        mode: lock.mode,
        ttlMs,
      };
    }
    return null;
  };

  const isModeSyncLockValid = (lock, ttlMs, now = Date.now()) =>
    Boolean(lock && now - lock.timestamp < ttlMs);

  const isGlobalSyncLockValid = (lock, now = Date.now()) =>
    Boolean(lock && now - lock.timestamp < lock.ttlMs);

  const hasActiveOtherModeSyncLock = (currentMode, now = Date.now()) => {
    const lockStates = [
      {
        mode: SYNC_LOCK_MODE_MANUAL,
        lock: getManualSyncLockValue(),
        ttlMs: MANUAL_SYNC_LOCK_TTL_MS,
      },
      {
        mode: SYNC_LOCK_MODE_BACKGROUND,
        lock: getBackgroundSyncLockValue(),
        ttlMs: BACKGROUND_SYNC_LOCK_TTL_MS,
      },
      {
        mode: SYNC_LOCK_MODE_STARTUP,
        lock: getStartupSyncLockValue(),
        ttlMs: STARTUP_SYNC_LOCK_TTL_MS,
      },
    ];

    return lockStates.some(
      ({ mode, lock, ttlMs }) =>
        mode !== currentMode && isModeSyncLockValid(lock, ttlMs, now)
    );
  };

  const setGlobalSyncLock = (mode, timestamp, ttlMs) => {
    GM_setValue(GLOBAL_SYNC_LOCK_KEY, {
      owner: BACKGROUND_SYNC_OWNER_ID,
      mode,
      timestamp,
      ttlMs,
    });
  };

  const refreshGlobalSyncLock = (mode, ttlMs) => {
    const currentLock = getGlobalSyncLockValue();
    if (
      !currentLock ||
      currentLock.owner !== BACKGROUND_SYNC_OWNER_ID ||
      currentLock.mode !== mode
    ) {
      return false;
    }
    setGlobalSyncLock(mode, Date.now(), ttlMs);
    return true;
  };

  const releaseGlobalSyncLock = (mode) => {
    const currentLock = getGlobalSyncLockValue();
    if (
      currentLock &&
      currentLock.owner === BACKGROUND_SYNC_OWNER_ID &&
      currentLock.mode === mode
    ) {
      GM_deleteValue(GLOBAL_SYNC_LOCK_KEY);
    }
  };

  const verifySyncLockOwnership = async (verifyFn) => {
    await sleep(SYNC_LOCK_VERIFY_DELAY_MS);
    return Boolean(typeof verifyFn === "function" && verifyFn());
  };

  const getSyncLockStateByMode = (mode) => {
    switch (mode) {
      case SYNC_LOCK_MODE_MANUAL:
        return {
          getModeLock: getManualSyncLockValue,
          ttlMs: MANUAL_SYNC_LOCK_TTL_MS,
        };
      case SYNC_LOCK_MODE_BACKGROUND:
        return {
          getModeLock: getBackgroundSyncLockValue,
          ttlMs: BACKGROUND_SYNC_LOCK_TTL_MS,
        };
      case SYNC_LOCK_MODE_STARTUP:
        return {
          getModeLock: getStartupSyncLockValue,
          ttlMs: STARTUP_SYNC_LOCK_TTL_MS,
        };
      default:
        return null;
    }
  };

  const isSyncLockOwned = (mode, now = Date.now()) => {
    const state = getSyncLockStateByMode(mode);
    if (!state) {
      return false;
    }

    const modeLock = state.getModeLock();
    if (
      !modeLock ||
      modeLock.owner !== BACKGROUND_SYNC_OWNER_ID ||
      !isModeSyncLockValid(modeLock, state.ttlMs, now)
    ) {
      return false;
    }

    const globalLock = getGlobalSyncLockValue();
    return Boolean(
      globalLock &&
      globalLock.owner === BACKGROUND_SYNC_OWNER_ID &&
      globalLock.mode === mode &&
      isGlobalSyncLockValid(globalLock, now)
    );
  };

  const getSyncLockModeDisplayName = (mode) => {
    switch (mode) {
      case SYNC_LOCK_MODE_MANUAL:
        return "手动同步";
      case SYNC_LOCK_MODE_BACKGROUND:
        return "后台同步";
      case SYNC_LOCK_MODE_STARTUP:
        return "启动同步";
      default:
        return "同步";
    }
  };

  const createSyncLockLostError = (mode, stage = "unknown") => {
    const error = new Error(
      `${getSyncLockModeDisplayName(mode)}锁已失效，任务已中止（阶段: ${stage}）。`
    );
    error.code = SYNC_LOCK_LOST_CODE;
    error.syncLockMode = mode;
    error.syncLockStage = stage;
    return error;
  };

  const assertSyncLockOwned = (mode, stage = "unknown") => {
    if (!mode) {
      return;
    }
    if (!isSyncLockOwned(mode)) {
      throw createSyncLockLostError(mode, stage);
    }
  };

  const acquireManualSyncLock = async () => {
    const now = Date.now();
    const currentLock = getManualSyncLockValue();
    const lockIsValid =
      currentLock && now - currentLock.timestamp < MANUAL_SYNC_LOCK_TTL_MS;
    const globalLock = getGlobalSyncLockValue();
    const globalLockIsValid = isGlobalSyncLockValid(globalLock, now);

    if (lockIsValid && currentLock.owner !== BACKGROUND_SYNC_OWNER_ID) {
      return false;
    }
    if (hasActiveOtherModeSyncLock(SYNC_LOCK_MODE_MANUAL, now)) {
      return false;
    }
    if (
      globalLockIsValid &&
      (globalLock.owner !== BACKGROUND_SYNC_OWNER_ID ||
        globalLock.mode !== SYNC_LOCK_MODE_MANUAL)
    ) {
      return false;
    }

    GM_setValue(MANUAL_SYNC_LOCK_KEY, {
      owner: BACKGROUND_SYNC_OWNER_ID,
      timestamp: now,
    });
    setGlobalSyncLock(SYNC_LOCK_MODE_MANUAL, now, MANUAL_SYNC_LOCK_TTL_MS);

    const acquired = await verifySyncLockOwnership(() => {
      const verifiedModeLock = getManualSyncLockValue();
      const verifiedGlobalLock = getGlobalSyncLockValue();
      return (
        verifiedModeLock &&
        verifiedModeLock.owner === BACKGROUND_SYNC_OWNER_ID &&
        verifiedGlobalLock &&
        verifiedGlobalLock.owner === BACKGROUND_SYNC_OWNER_ID &&
        verifiedGlobalLock.mode === SYNC_LOCK_MODE_MANUAL
      );
    });
    if (!acquired) {
      releaseManualSyncLock();
    }
    return acquired;
  };

  const refreshManualSyncLock = () => {
    const currentLock = getManualSyncLockValue();
    if (!currentLock || currentLock.owner !== BACKGROUND_SYNC_OWNER_ID) {
      return false;
    }
    if (!refreshGlobalSyncLock(SYNC_LOCK_MODE_MANUAL, MANUAL_SYNC_LOCK_TTL_MS)) {
      return false;
    }
    GM_setValue(MANUAL_SYNC_LOCK_KEY, {
      owner: BACKGROUND_SYNC_OWNER_ID,
      timestamp: Date.now(),
    });
    return true;
  };

  const releaseManualSyncLock = () => {
    const currentLock = getManualSyncLockValue();
    if (currentLock && currentLock.owner === BACKGROUND_SYNC_OWNER_ID) {
      GM_deleteValue(MANUAL_SYNC_LOCK_KEY);
    }
    releaseGlobalSyncLock(SYNC_LOCK_MODE_MANUAL);
  };

  const startManualSyncLockHeartbeat = () => {
    if (manualSyncLockHeartbeatTimer) {
      clearInterval(manualSyncLockHeartbeatTimer);
    }
    manualSyncLockHeartbeatTimer = setInterval(() => {
      if (!refreshManualSyncLock()) {
        stopManualSyncLockHeartbeat();
        console.warn("S1 Plus: 手动同步锁续租失败，当前任务将中止。");
      }
    }, MANUAL_SYNC_LOCK_HEARTBEAT_MS);
  };

  const stopManualSyncLockHeartbeat = () => {
    if (manualSyncLockHeartbeatTimer) {
      clearInterval(manualSyncLockHeartbeatTimer);
      manualSyncLockHeartbeatTimer = null;
    }
  };

  const getBackgroundSyncLockValue = () => {
    const lock = GM_getValue(BACKGROUND_SYNC_LOCK_KEY, null);
    if (
      lock &&
      typeof lock === "object" &&
      lock.owner &&
      typeof lock.timestamp === "number"
    ) {
      return lock;
    }
    return null;
  };

  const acquireBackgroundSyncLock = async () => {
    const now = Date.now();
    const currentLock = getBackgroundSyncLockValue();
    const lockIsValid =
      currentLock && now - currentLock.timestamp < BACKGROUND_SYNC_LOCK_TTL_MS;
    const globalLock = getGlobalSyncLockValue();
    const globalLockIsValid = isGlobalSyncLockValid(globalLock, now);

    if (lockIsValid && currentLock.owner !== BACKGROUND_SYNC_OWNER_ID) {
      return false;
    }
    if (hasActiveOtherModeSyncLock(SYNC_LOCK_MODE_BACKGROUND, now)) {
      return false;
    }
    if (
      globalLockIsValid &&
      (globalLock.owner !== BACKGROUND_SYNC_OWNER_ID ||
        globalLock.mode !== SYNC_LOCK_MODE_BACKGROUND)
    ) {
      return false;
    }

    GM_setValue(BACKGROUND_SYNC_LOCK_KEY, {
      owner: BACKGROUND_SYNC_OWNER_ID,
      timestamp: now,
    });
    setGlobalSyncLock(
      SYNC_LOCK_MODE_BACKGROUND,
      now,
      BACKGROUND_SYNC_LOCK_TTL_MS
    );

    const acquired = await verifySyncLockOwnership(() => {
      const verifiedModeLock = getBackgroundSyncLockValue();
      const verifiedGlobalLock = getGlobalSyncLockValue();
      return (
        verifiedModeLock &&
        verifiedModeLock.owner === BACKGROUND_SYNC_OWNER_ID &&
        verifiedGlobalLock &&
        verifiedGlobalLock.owner === BACKGROUND_SYNC_OWNER_ID &&
        verifiedGlobalLock.mode === SYNC_LOCK_MODE_BACKGROUND
      );
    });
    if (!acquired) {
      releaseBackgroundSyncLock();
    }
    return acquired;
  };

  const refreshBackgroundSyncLock = () => {
    const currentLock = getBackgroundSyncLockValue();
    if (!currentLock || currentLock.owner !== BACKGROUND_SYNC_OWNER_ID) {
      return false;
    }
    if (
      !refreshGlobalSyncLock(
        SYNC_LOCK_MODE_BACKGROUND,
        BACKGROUND_SYNC_LOCK_TTL_MS
      )
    ) {
      return false;
    }
    GM_setValue(BACKGROUND_SYNC_LOCK_KEY, {
      owner: BACKGROUND_SYNC_OWNER_ID,
      timestamp: Date.now(),
    });
    return true;
  };

  const releaseBackgroundSyncLock = () => {
    const currentLock = getBackgroundSyncLockValue();
    if (currentLock && currentLock.owner === BACKGROUND_SYNC_OWNER_ID) {
      GM_deleteValue(BACKGROUND_SYNC_LOCK_KEY);
    }
    releaseGlobalSyncLock(SYNC_LOCK_MODE_BACKGROUND);
  };

  const startBackgroundSyncLockHeartbeat = () => {
    if (backgroundSyncLockHeartbeatTimer) {
      clearInterval(backgroundSyncLockHeartbeatTimer);
    }
    backgroundSyncLockHeartbeatTimer = setInterval(() => {
      if (!refreshBackgroundSyncLock()) {
        stopBackgroundSyncLockHeartbeat();
        console.warn("S1 Plus: 后台同步锁续租失败，当前任务将中止。");
      }
    }, BACKGROUND_SYNC_LOCK_HEARTBEAT_MS);
  };

  const stopBackgroundSyncLockHeartbeat = () => {
    if (backgroundSyncLockHeartbeatTimer) {
      clearInterval(backgroundSyncLockHeartbeatTimer);
      backgroundSyncLockHeartbeatTimer = null;
    }
  };

  const getStartupSyncLockValue = () => {
    const lock = GM_getValue(STARTUP_SYNC_LOCK_KEY, null);
    if (
      lock &&
      typeof lock === "object" &&
      lock.owner &&
      typeof lock.timestamp === "number"
    ) {
      return lock;
    }
    return null;
  };

  const acquireStartupSyncLock = async () => {
    const now = Date.now();
    const currentLock = getStartupSyncLockValue();
    const lockIsValid =
      currentLock && now - currentLock.timestamp < STARTUP_SYNC_LOCK_TTL_MS;
    const globalLock = getGlobalSyncLockValue();
    const globalLockIsValid = isGlobalSyncLockValid(globalLock, now);

    if (lockIsValid && currentLock.owner !== BACKGROUND_SYNC_OWNER_ID) {
      return false;
    }
    if (hasActiveOtherModeSyncLock(SYNC_LOCK_MODE_STARTUP, now)) {
      return false;
    }
    if (
      globalLockIsValid &&
      (globalLock.owner !== BACKGROUND_SYNC_OWNER_ID ||
        globalLock.mode !== SYNC_LOCK_MODE_STARTUP)
    ) {
      return false;
    }

    GM_setValue(STARTUP_SYNC_LOCK_KEY, {
      owner: BACKGROUND_SYNC_OWNER_ID,
      timestamp: now,
    });
    setGlobalSyncLock(SYNC_LOCK_MODE_STARTUP, now, STARTUP_SYNC_LOCK_TTL_MS);

    const acquired = await verifySyncLockOwnership(() => {
      const verifiedModeLock = getStartupSyncLockValue();
      const verifiedGlobalLock = getGlobalSyncLockValue();
      return (
        verifiedModeLock &&
        verifiedModeLock.owner === BACKGROUND_SYNC_OWNER_ID &&
        verifiedGlobalLock &&
        verifiedGlobalLock.owner === BACKGROUND_SYNC_OWNER_ID &&
        verifiedGlobalLock.mode === SYNC_LOCK_MODE_STARTUP
      );
    });
    if (!acquired) {
      releaseStartupSyncLock();
    }
    return acquired;
  };

  const refreshStartupSyncLock = () => {
    const currentLock = getStartupSyncLockValue();
    if (!currentLock || currentLock.owner !== BACKGROUND_SYNC_OWNER_ID) {
      return false;
    }
    if (!refreshGlobalSyncLock(SYNC_LOCK_MODE_STARTUP, STARTUP_SYNC_LOCK_TTL_MS)) {
      return false;
    }
    GM_setValue(STARTUP_SYNC_LOCK_KEY, {
      owner: BACKGROUND_SYNC_OWNER_ID,
      timestamp: Date.now(),
    });
    return true;
  };

  const releaseStartupSyncLock = () => {
    const currentLock = getStartupSyncLockValue();
    if (currentLock && currentLock.owner === BACKGROUND_SYNC_OWNER_ID) {
      GM_deleteValue(STARTUP_SYNC_LOCK_KEY);
    }
    releaseGlobalSyncLock(SYNC_LOCK_MODE_STARTUP);
  };

  const startStartupSyncLockHeartbeat = () => {
    if (startupSyncLockHeartbeatTimer) {
      clearInterval(startupSyncLockHeartbeatTimer);
    }
    startupSyncLockHeartbeatTimer = setInterval(() => {
      if (!refreshStartupSyncLock()) {
        stopStartupSyncLockHeartbeat();
        console.warn("S1 Plus: 启动同步锁续租失败，当前任务将中止。");
      }
    }, STARTUP_SYNC_LOCK_HEARTBEAT_MS);
  };

  const stopStartupSyncLockHeartbeat = () => {
    if (startupSyncLockHeartbeatTimer) {
      clearInterval(startupSyncLockHeartbeatTimer);
      startupSyncLockHeartbeatTimer = null;
    }
  };

  const scheduleBackgroundSyncRetry = (
    delayMs = BACKGROUND_SYNC_LOCK_RETRY_DELAY_MS
  ) => {
    if (getActiveAutoSyncConflictPause()) {
      clearAutoSyncRuntimeQueue();
      setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_CONFLICT);
      return;
    }

    hasPendingBackgroundSync = true;
    setAutoSyncIndicatorPendingPhase("background_retry");
    if (backgroundSyncRetryTimeout) {
      clearTimeout(backgroundSyncRetryTimeout);
    }
    backgroundSyncRetryTimeout = setTimeout(() => {
      backgroundSyncRetryTimeout = null;
      if (isInitialSyncInProgress || isBackgroundAutoSyncInProgress) {
        backgroundSyncRetryAttempts += 1;
        if (backgroundSyncRetryAttempts >= BACKGROUND_SYNC_MAX_RETRY_ATTEMPTS) {
          console.warn(
            "S1 Plus: 后台同步重试达到上限，已暂停当前重试链，等待下一次同步触发。"
          );
          return;
        }
        scheduleBackgroundSyncRetry(delayMs);
        return;
      }
      backgroundSyncRetryAttempts = 0;
      triggerRemoteSyncPush("background_retry");
    }, Math.max(0, delayMs));
  };

  const handleBackgroundAutoSyncResult = async (result) => {
    switch (result.status) {
      case "conflict":
        if (!(await shouldShowConflictModal("background_conflict"))) {
          showMessage(
            "再次检测到后台同步冲突，已进入提示冷却。请稍后手动同步处理。",
            false
          );
          break;
        }
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
                handleManualSync();
              },
            },
          ],
          { allowBodyHtml: true }
        );
        break;

      case "failure":
        showMessage(`后台同步失败: ${result.error}`, false);
        break;

      case "success":
        if (result.action === "pulled" || result.action === "force_pulled") {
          showMessage(
            "后台同步完成：云端有更新已被自动拉取。建议刷新页面。",
            true
          );
        }
        break;

      case "skipped":
        if (result.reason === "conflict_paused") {
          console.log("S1 Plus: 后台自动同步因冲突暂停状态被门控。");
        } else if (result.reason === "lock_lost") {
          console.warn("S1 Plus: 后台自动同步因锁失效中止，稍后将自动重试。");
          scheduleBackgroundSyncRetry(1200);
        }
        break;
    }
  };

  const fetchRemoteData = async (options = {}) => {
    const { metadataOnly = false } = options;
    const { syncRemoteGistId, syncRemotePat } = getSettings();
    if (!syncRemoteGistId || !syncRemotePat) {
      throw new Error("配置不完整");
    }

    const syncRemoteApiUrl = `https://api.github.com/gists/${syncRemoteGistId}`;
    let gistData;
    try {
      const response = await runRemoteRequestWithRetry({
        method: "GET",
        url: syncRemoteApiUrl,
        headers: {
          Authorization: `Bearer ${syncRemotePat}`,
          Accept: "application/vnd.github.v3+json",
          "Cache-Control": "no-cache",
        },
      });
      gistData = JSON.parse(response.responseText);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("解析Gist元数据失败。");
      }
      if (typeof error.status === "number") {
        throw new Error(`GitHub API请求失败，状态码: ${error.status}`);
      }
      throw error;
    }

    const syncFile = gistData.files?.["s1plus_sync.json"];
    let parsedData = {};

    if (!metadataOnly && syncFile) {
      let fileContent = syncFile.content;

      if ((syncFile.truncated || !fileContent) && syncFile.raw_url) {
        const rawResponse = await runRemoteRequestWithRetry({
          method: "GET",
          url: syncFile.raw_url,
          headers: {
            Authorization: `Bearer ${syncRemotePat}`,
            "Cache-Control": "no-cache",
          },
        });
        fileContent = rawResponse.responseText;
      } else if (syncFile.truncated && !syncFile.raw_url) {
        throw new Error("Gist 文件内容被截断且缺少 raw_url。");
      }

      if (fileContent && fileContent.trim()) {
        try {
          parsedData = JSON.parse(fileContent);
        } catch (error) {
          throw new Error(`解析Gist数据失败: ${error.message}`);
        }
      }
    }

    return {
      data: parsedData,
      meta: {
        updatedAt:
          typeof gistData.updated_at === "string"
            ? gistData.updated_at
            : undefined,
        fileTruncated: Boolean(syncFile?.truncated),
      },
    };
  };

  const pushRemoteData = async (dataObject, options = {}) => {
    const { expectedRemoteUpdatedAt } = options;
    const { syncRemoteGistId, syncRemotePat } = getSettings();
    if (!syncRemoteGistId || !syncRemotePat) {
      throw new Error("配置不完整");
    }

    if (typeof expectedRemoteUpdatedAt !== "undefined") {
      const { meta } = await fetchRemoteData({
        metadataOnly: true,
      });
      if (meta.updatedAt !== expectedRemoteUpdatedAt) {
        throw createRemoteVersionConflictError(
          "云端数据在推送前已发生变化，已停止自动覆盖。",
          {
            expectedRemoteUpdatedAt,
            actualRemoteUpdatedAt: meta.updatedAt,
          }
        );
      }
    }

    const syncRemoteApiUrl = `https://api.github.com/gists/${syncRemoteGistId}`;
    const payload = {
      files: {
        "s1plus_sync.json": {
          content: JSON.stringify(dataObject, null, 2),
        },
      },
    };

    try {
      const response = await runRemoteRequestWithRetry({
        method: "PATCH",
        url: syncRemoteApiUrl,
        headers: {
          Authorization: `Bearer ${syncRemotePat}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        data: JSON.stringify(payload),
      });

      let updatedAt = null;
      try {
        updatedAt = JSON.parse(response.responseText)?.updated_at || null;
      } catch (_) {
        updatedAt = null;
      }

      return { success: true, message: "数据已成功推送到Gist。", updatedAt };
    } catch (error) {
      if (error.code === REMOTE_VERSION_CONFLICT_CODE) {
        throw error;
      }

      let errorMessage = `Gist 更新失败${typeof error.status === "number" ? ` (状态码: ${error.status})` : ""
        }。`;
      try {
        const apiResponse = JSON.parse(error.response?.responseText || "{}");
        if (apiResponse && apiResponse.message) {
          errorMessage += `原因: ${apiResponse.message}`;
        } else {
          errorMessage += "请检查网络连接或 Gist 配置。";
        }
      } catch (_) {
        errorMessage += "请检查网络连接或 Gist 配置。";
      }
      throw new Error(errorMessage);
    }
  };

  // [MODIFIED] 触发式推送函数，加入 single-flight + pending + 跨标签锁
  const triggerRemoteSyncPush = (reason = "local_change") => {
    const settings = getSettings();
    if (
      !settings.syncRemoteEnabled ||
      !settings.syncAutoEnabled ||
      !settings.syncRemoteGistId ||
      !settings.syncRemotePat
    ) {
      return;
    }
    const conflictPauseState = getActiveAutoSyncConflictPause();
    if (conflictPauseState) {
      clearAutoSyncRuntimeQueue();
      setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_CONFLICT);
      console.log(
        `S1 Plus: 自动同步冲突暂停生效，已跳过后台同步触发(${reason})。`,
        {
          reason: conflictPauseState.reason || "generic",
          pausedAt: conflictPauseState.timestamp || 0,
        }
      );
      return;
    }

    if (!isInitialSyncInProgress && !isBackgroundAutoSyncInProgress) {
      backgroundSyncRetryAttempts = 0;
    }
    hasPendingBackgroundSync = true;
    setAutoSyncIndicatorPendingPhase(reason);
    if (isInitialSyncInProgress || isBackgroundAutoSyncInProgress) {
      console.log(
        `S1 Plus: 后台同步请求(${reason})已加入队列，等待当前同步完成。`
      );
      return;
    }

    (async () => {
      if (isBackgroundAutoSyncInProgress) {
        return;
      }

      let indicatorCycleToken = "";
      let indicatorFinalPhase = "";
      isBackgroundAutoSyncInProgress = true;
      let drainCount = 0;

      try {
        while (
          hasPendingBackgroundSync &&
          drainCount < BACKGROUND_SYNC_MAX_DRAIN_LOOPS
        ) {
          hasPendingBackgroundSync = false;
          drainCount += 1;

          if (!(await acquireBackgroundSyncLock())) {
            hasPendingBackgroundSync = true;
            console.log(
              "S1 Plus: 检测到其他同步任务正在执行，稍后将重试。"
            );
            scheduleBackgroundSyncRetry();
            break;
          }
          if (!indicatorCycleToken) {
            indicatorCycleToken = startBackgroundAutoSyncIndicatorCycle(reason);
          }

          startBackgroundSyncLockHeartbeat();
          try {
            console.log("S1 Plus: 检测到数据变更，触发后台智能同步检查...");
            const result = await performAutoSync(
              false,
              SYNC_LOCK_MODE_BACKGROUND
            );
            const phaseFromResult = getAutoSyncIndicatorPhaseFromResult(result);
            if (phaseFromResult) {
              indicatorFinalPhase = phaseFromResult;
            }
            await handleBackgroundAutoSyncResult(result);
          } finally {
            stopBackgroundSyncLockHeartbeat();
            releaseBackgroundSyncLock();
          }
        }

        if (
          hasPendingBackgroundSync &&
          drainCount >= BACKGROUND_SYNC_MAX_DRAIN_LOOPS
        ) {
          scheduleBackgroundSyncRetry(1500);
        }
      } finally {
        isBackgroundAutoSyncInProgress = false;
        if (
          hasPendingBackgroundSync &&
          !isInitialSyncInProgress &&
          !backgroundSyncRetryTimeout
        ) {
          scheduleBackgroundSyncRetry(300);
        }

        const shouldStayQueued =
          hasPendingBackgroundSync ||
          Boolean(backgroundSyncRetryTimeout) ||
          isInitialSyncInProgress;
        if (shouldStayQueued) {
          setAutoSyncIndicatorPendingPhase("background_queue");
        } else if (indicatorCycleToken) {
          const currentIndicatorState = getAutoSyncIndicatorState();
          finishBackgroundAutoSyncIndicatorCycle(
            indicatorCycleToken,
            indicatorFinalPhase ||
            currentIndicatorState.lastResolvedPhase ||
            AUTO_SYNC_INDICATOR_PHASE_IDLE
          );
        } else if (indicatorFinalPhase) {
          setAutoSyncIndicatorResolvedPhase(indicatorFinalPhase);
        }
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

    let data, version, contentHash, baseContentHash, lastUpdated;

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

      // [新增 V5] 计算或获取 baseContentHash
      if (remoteGistObject.version >= 5.0 && remoteGistObject.baseContentHash) {
        baseContentHash = remoteGistObject.baseContentHash;
      } else {
        const dataForBaseHash = { ...data };
        delete dataForBaseHash.read_progress;
        baseContentHash = await calculateDataHash(dataForBaseHash);
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

      // [新增 V5] 为旧数据也计算 baseContentHash
      const dataForBaseHash = { ...data };
      delete dataForBaseHash.read_progress;
      baseContentHash = await calculateDataHash(dataForBaseHash);
    }

    return {
      data,
      version,
      contentHash,
      baseContentHash,
      lastUpdated,
      full: remoteGistObject,
    };
  };

  // [MODIFIED] 自动同步控制器 (逻辑优化版)
  const performAutoSync = async (isStartupSync = false, syncLockMode = null) => {
    const settings = getSettings();
    if (
      !settings.syncRemoteEnabled ||
      !settings.syncRemoteGistId ||
      !settings.syncRemotePat
    ) {
      return { status: "skipped", reason: "disabled" };
    }
    const conflictPauseState = getActiveAutoSyncConflictPause();
    if (conflictPauseState) {
      return {
        status: "skipped",
        reason: "conflict_paused",
        conflictReason: conflictPauseState.reason || "generic",
        pausedAt: conflictPauseState.timestamp || 0,
      };
    }
    const circuitState = getAutoSyncCircuitState();
    if (circuitState.open) {
      return {
        status: "skipped",
        reason: "circuit_open",
        until: circuitState.until,
      };
    }

    const syncMode = isStartupSync ? "startup" : "background";
    const assertAutoSyncLockOwned = (stage) => {
      if (!syncLockMode) {
        return;
      }
      assertSyncLockOwned(syncLockMode, `auto_sync:${stage}`);
    };
    const runWithAutoSyncLockGuard = async (stage, callback) => {
      assertAutoSyncLockOwned(`${stage}:before`);
      const result = await callback();
      assertAutoSyncLockOwned(`${stage}:after`);
      return result;
    };
    let syncOutcome = "unknown";
    const asSuccessResult = (action, syncBaseline = null) => {
      syncOutcome = "success";
      if (action === "skipped_push_on_startup") {
        // 启动安全模式命中“本地较新”时，冻结后续自动同步，等待手动同步决策。
        setAutoSyncConflictPause("startup_local_newer");
        clearAutoSyncRuntimeQueue();
      } else {
        clearPendingAutoSyncRequest();
        clearAutoSyncConflictPause();
      }
      if (syncBaseline) {
        setSyncBaselineState(syncBaseline);
      }
      resetAutoSyncFailureState();
      recordSyncSuccess(action, syncMode);
      updateLastSyncTimeDisplay();
      return { status: "success", action };
    };
    const asConflictResult = (reason) => {
      syncOutcome = "conflict";
      clearPendingAutoSyncRequest();
      setAutoSyncConflictPause(reason);
      clearAutoSyncRuntimeQueue();
      resetAutoSyncFailureState();
      recordSyncConflict(reason, syncMode);
      updateLastSyncTimeDisplay();
      return { status: "conflict", reason };
    };

    // 在进入自动同步临界区前，先执行一次本地旧数据结构迁移。
    // 这样可以避免“迁移写入发生在同步中，导致同时间戳内容变化”的假冲突。
    getUserTags();
    getTitleFilterRules();
    migrateLegacyReadProgressData();

    syncDirtyDuringSync = false;
    syncDirtyNeedsFollowUpSync = false;
    syncDirtyTimestamp = 0;
    isInitialSyncInProgress = true;
    recordSyncAttempt(syncMode, "auto");
    console.log(
      `S1 Plus (Sync): 启动同步检查... (模式: ${isStartupSync ? "Startup" : "Normal"
      })`
    );

    try {
      const { data: rawRemoteData, meta: remoteMeta } =
        await runWithAutoSyncLockGuard("fetch_remote_data", () =>
          fetchRemoteData()
        );
      if (Object.keys(rawRemoteData).length === 0) {
        console.log(`S1 Plus (Sync): 远程为空，推送本地数据...`);
        const localData = await runWithAutoSyncLockGuard(
          "export_local_data_initial_push",
          () => exportLocalDataObject()
        );
        const pushResult = await runWithAutoSyncLockGuard(
          "push_initial_data",
          () =>
            pushRemoteData(localData, {
              expectedRemoteUpdatedAt: remoteMeta.updatedAt,
            })
        );
        GM_setValue("s1p_last_sync_timestamp", Date.now());
        return asSuccessResult("pushed_initial", {
          contentHash: localData.contentHash,
          remoteUpdatedAt: pushResult?.updatedAt || null,
        });
      }

      const remote = await runWithAutoSyncLockGuard(
        "validate_remote_data",
        () => migrateAndValidateRemoteData(rawRemoteData)
      );
      const localDataObject = await runWithAutoSyncLockGuard(
        "export_local_data",
        () => exportLocalDataObject()
      );

      const versionDecision = decideSyncActionByVersion({
        localDataObject,
        remoteDataObject: remote,
        remoteUpdatedAt: remoteMeta.updatedAt,
        isStartupSync,
        forcePullOnStartup: settings.syncForcePullOnStartup,
      });
      const syncAction = versionDecision.action;

      // --- 执行阶段 ---
      switch (syncAction) {
        case "no_change":
          console.log(`S1 Plus (Sync): 本地与远程数据哈希一致，无需同步。`);
          assertAutoSyncLockOwned("return_no_change");
          return asSuccessResult("no_change", {
            contentHash: localDataObject.contentHash,
            remoteUpdatedAt: remoteMeta.updatedAt || null,
          });

        case "force_pull":
          console.log(
            `S1 Plus (Sync): 检测到启动时强制拉取已开启，将使用云端数据覆盖本地。`
          );
          assertAutoSyncLockOwned("apply_force_pull_remote_data");
          importLocalData(JSON.stringify(remote.full), {
            suppressPostSync: true,
          });
          GM_setValue("s1p_last_sync_timestamp", Date.now());
          return asSuccessResult("force_pulled", {
            contentHash: remote.contentHash,
            remoteUpdatedAt: remoteMeta.updatedAt || null,
          });

        case "pull":
          console.log(`S1 Plus (Sync): 远程数据比本地新，正在后台应用...`);
          assertAutoSyncLockOwned("apply_pull_remote_data");
          importLocalData(JSON.stringify(remote.full), {
            suppressPostSync: true,
          });
          GM_setValue("s1p_last_sync_timestamp", Date.now());
          return asSuccessResult("pulled", {
            contentHash: remote.contentHash,
            remoteUpdatedAt: remoteMeta.updatedAt || null,
          });

        case "skip_push_on_startup":
          console.warn(
            `S1 Plus (Sync): 启动同步检测到本地数据较新，已跳过自动推送以确保数据安全。如有需要，请手动同步。`
          );
          assertAutoSyncLockOwned("return_skip_push_on_startup");
          return asSuccessResult("skipped_push_on_startup");

        case "push":
          console.log(`S1 Plus (Sync): 本地数据比远程新，正在后台推送...`);
          {
            const pushResult = await runWithAutoSyncLockGuard(
              "push_latest_local_data",
              () =>
                pushRemoteData(localDataObject, {
                  expectedRemoteUpdatedAt: remoteMeta.updatedAt,
                })
            );
            GM_setValue("s1p_last_sync_timestamp", Date.now());
            return asSuccessResult("pushed", {
              contentHash: localDataObject.contentHash,
              remoteUpdatedAt: pushResult?.updatedAt || null,
            });
          }

        case "conflict":
          console.warn("S1 Plus (Sync): 冲突判定明细", {
            reason: versionDecision.reason || "version_conflict",
            localHash: shortHashForLog(localDataObject.contentHash),
            remoteHash: shortHashForLog(remote.contentHash),
            baselineHash: shortHashForLog(getSyncBaselineState()?.contentHash),
            localBaseHash: shortHashForLog(localDataObject.baseContentHash),
            remoteBaseHash: shortHashForLog(remote.baseContentHash),
            remoteUpdatedAt: remoteMeta.updatedAt || "n/a",
          });
          {
            const isBothChangedReason =
              versionDecision.reason === "both_changed_since_baseline" ||
              versionDecision.reason === "both_changed_since_baseline_by_updated_at";
            let canAutoMergeReadProgress = false;
            if (isBothChangedReason) {
              const directBaseHashMatch =
                localDataObject.baseContentHash &&
                remote.baseContentHash &&
                localDataObject.baseContentHash === remote.baseContentHash;
              if (directBaseHashMatch) {
                canAutoMergeReadProgress = true;
              } else {
                const localComparableHash = await runWithAutoSyncLockGuard(
                  "calc_local_comparable_hash",
                  () =>
                    calculateComparableBaseHashWithoutReadProgress(
                      localDataObject.data
                    )
                );
                const remoteComparableHash = await runWithAutoSyncLockGuard(
                  "calc_remote_comparable_hash",
                  () =>
                    calculateComparableBaseHashWithoutReadProgress(remote.data)
                );
                canAutoMergeReadProgress =
                  localComparableHash === remoteComparableHash;
                console.warn("S1 Plus (Sync): 冲突可比哈希判定", {
                  localComparableHash: shortHashForLog(localComparableHash),
                  remoteComparableHash: shortHashForLog(remoteComparableHash),
                  canAutoMergeReadProgress,
                });
              }
            }

            if (!canAutoMergeReadProgress) {
              console.warn(
                `S1 Plus (Sync): 检测到同步冲突 (${versionDecision.reason})，自动同步已暂停。请手动同步以解决冲突。`
              );
              assertAutoSyncLockOwned("return_conflict");
              return asConflictResult(versionDecision.reason || "version_conflict");
            }

            console.warn(
              "S1 Plus (Sync): 检测到仅阅读进度分歧，正在执行自动合并并回写云端。"
            );
            const mergedReadProgress = mergeReadProgressMaps(
              localDataObject.data?.read_progress,
              remote.data?.read_progress
            );
            const mergedData = {
              ...localDataObject.data,
              read_progress: mergedReadProgress,
            };
            const mergedLastUpdated = Math.max(
              Number(localDataObject.lastUpdated) || 0,
              Number(remote.lastUpdated) || 0,
              Date.now()
            );
            const mergedContentHash = await runWithAutoSyncLockGuard(
              "calc_merged_content_hash",
              () => calculateDataHash(mergedData)
            );
            const mergedPayload = {
              version: 5.0,
              lastUpdated: mergedLastUpdated,
              lastUpdatedFormatted: new Date(mergedLastUpdated).toLocaleString(
                "zh-CN",
                { hour12: false }
              ),
              data: mergedData,
              contentHash: mergedContentHash,
              baseContentHash: localDataObject.baseContentHash,
            };

            const pushResult = await runWithAutoSyncLockGuard(
              "push_merged_read_progress",
              () =>
                pushRemoteData(mergedPayload, {
                  expectedRemoteUpdatedAt: remoteMeta.updatedAt,
                })
            );
            assertAutoSyncLockOwned("apply_merged_payload");
            importLocalData(JSON.stringify(mergedPayload), {
              suppressPostSync: true,
            });
            GM_setValue("s1p_last_sync_timestamp", Date.now());
            return asSuccessResult("merged_read_progress", {
              contentHash: mergedContentHash,
              remoteUpdatedAt: pushResult?.updatedAt || null,
            });
          }
      }
    } catch (error) {
      if (error?.code === REMOTE_VERSION_CONFLICT_CODE) {
        console.warn("S1 Plus (Sync): 推送前检测到远端版本变更，已转为冲突处理。");
        return asConflictResult("remote_changed_before_push");
      }
      if (error?.code === SYNC_LOCK_LOST_CODE) {
        syncOutcome = "lock_lost";
        console.warn("S1 Plus (Sync): 同步锁失效，当前任务已中止。", {
          mode: error?.syncLockMode || syncLockMode || syncMode,
          stage: error?.syncLockStage || "unknown",
        });
        return {
          status: "skipped",
          reason: "lock_lost",
          mode: error?.syncLockMode || syncLockMode || syncMode,
          stage: error?.syncLockStage || "unknown",
        };
      }
      syncOutcome = "failure";
      console.error("S1 Plus: 自动同步失败:", error);
      recordSyncFailure(error.message, syncMode);
      const failureState = registerAutoSyncFailure(syncMode);
      updateLastSyncTimeDisplay();
      return { status: "failure", error: error.message, failureState };
    } finally {
      isInitialSyncInProgress = false;
      if (syncOutcome === "conflict") {
        // 冲突时不应继续自动补同步，否则会在同一轮 drain 中反复触发冲突。
        hasPendingBackgroundSync = false;
        clearPendingAutoSyncRequest();
        syncDirtyDuringSync = false;
        syncDirtyNeedsFollowUpSync = false;
        syncDirtyTimestamp = 0;
        console.log(
          "S1 Plus (Sync): 冲突状态下已清空自动补同步队列，等待手动同步解决冲突。"
        );
      } else if (syncOutcome === "lock_lost") {
        console.warn("S1 Plus (Sync): 由于锁失效，当前自动同步已提前终止。");
      } else if (syncDirtyDuringSync) {
        const currentLastModified = GM_getValue("s1p_last_modified", 0);
        const nextDirtyLastModified = Math.max(
          syncDirtyTimestamp || Date.now(),
          currentLastModified + 1
        );
        GM_setValue(
          "s1p_last_modified",
          nextDirtyLastModified
        );
        if (syncDirtyNeedsFollowUpSync) {
          requestBackgroundSyncRun("dirty_during_sync", 300);
          console.log(
            "S1 Plus (Sync): 检测到同步期间的本地变更，已自动加入补同步队列。"
          );
        } else {
          console.log(
            "S1 Plus (Sync): 检测到同步期间仅时间戳修正，本轮不触发补同步。"
          );
        }
      }
      syncDirtyDuringSync = false;
      syncDirtyNeedsFollowUpSync = false;
      syncDirtyTimestamp = 0;
      console.log("S1 Plus (Sync): 同步检查完成。");
    }
  };

  const defaultSettings = {
    enablePostBlocking: true,
    enableGeneralSettings: true,
    enableUserBlocking: true,
    enableUserTagging: true,
    enableReadProgress: true,
    showReadIndicator: true,
    enableBookmarkReplies: true,
    readingProgressCleanupDays: 0,
    cleanupMode: 'auto',
    openInNewTab: {
      threadList: false,
      threadListInBackground: false,
      progress: false,
      progressInBackground: false,
      nav: false,
      navInBackground: false,
      postContentLinks: false,
      postContentLinksInBackground: false,
    },
    autoLinkPlainTextUrls: true,
    enableNavCustomization: true,
    changeLogoLink: true,
    hideBlacklistTip: true,
    hideSystemBlockedPosts: false,
    blockThreadsOnUserBlock: true,
    syncWithNativeBlacklist: true,
    showBlockedByKeywordList: false,
    showManuallyBlockedList: false,
    hideImagesByDefault: false,
    limitImagesBySize: true,
    useS1PlusImageViewer: true,
    imagePreviewMaxWidth: IMAGE_PREVIEW_DEFAULT_WIDTH,
    imagePreviewMaxHeight: IMAGE_PREVIEW_DEFAULT_HEIGHT,
    enhanceFloatingControls: true,
    recommendS1Nux: true,
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
    syncShowAutoSyncIndicator: true,
    syncForcePullOnStartup: false, // <-- [新增] 新增功能开关
    syncDirectChoiceMode: false,
    syncBookmarkFullContent: false,
    syncRemoteGistId: "",
    syncRemotePat: "",
    syncTokenExpiryEnabled: false, // [新增] Token 过期提醒
    syncTokenExpiryDate: null,     // [新增] Token 过期时间戳
  };

  const buildNormalizedSettings = (rawSettings = {}) => {
    const saved = sanitizeRecordObject(rawSettings);
    const settings = { ...defaultSettings, ...saved };
    let migrationApplied = false;
    const migrationReasons = [];
    const markMigration = (reason) => {
      migrationApplied = true;
      if (
        reason &&
        !migrationReasons.includes(reason)
      ) {
        migrationReasons.push(reason);
      }
    };
    const normalizedDefaultCustomNavLinks = normalizeCustomNavLinks(
      defaultSettings.customNavLinks
    );
    const savedOpenInNewTab =
      saved.openInNewTab &&
        typeof saved.openInNewTab === "object" &&
        !Array.isArray(saved.openInNewTab)
        ? sanitizeRecordObject(saved.openInNewTab)
        : {};

    const hasLegacyOpenInNewTabRootKeys =
      typeof saved.openThreadsInNewTab !== "undefined" ||
      typeof saved.openThreadsInBackground !== "undefined" ||
      typeof saved.openProgressInNewTab !== "undefined" ||
      typeof saved.openProgressInBackground !== "undefined";
    const hasLegacyOpenInNewTabNestedKeys =
      typeof savedOpenInNewTab.threads !== "undefined" ||
      typeof savedOpenInNewTab.threadsInBackground !== "undefined" ||
      typeof savedOpenInNewTab.sidebar !== "undefined" ||
      typeof savedOpenInNewTab.sidebarInBackground !== "undefined";
    const hasLegacyOpenInNewTabPlainTextKeys =
      typeof savedOpenInNewTab.plainTextUrls !== "undefined" ||
      typeof savedOpenInNewTab.plainTextUrlsInBackground !== "undefined";
    const hasCurrentOpenInNewTabPostContentKeys =
      typeof savedOpenInNewTab.postContentLinks !== "undefined" ||
      typeof savedOpenInNewTab.postContentLinksInBackground !== "undefined";
    const hasLegacyOpenInNewTabMaster =
      typeof savedOpenInNewTab.master !== "undefined";
    let normalizedOpenInNewTab = {
      ...defaultSettings.openInNewTab,
      ...savedOpenInNewTab,
    };

    if (hasLegacyOpenInNewTabRootKeys || hasLegacyOpenInNewTabNestedKeys) {
      const oldOpenTab = savedOpenInNewTab;
      normalizedOpenInNewTab = {
        ...defaultSettings.openInNewTab,
        threadList:
          oldOpenTab.threadList ??
          oldOpenTab.threads ??
          saved.openThreadsInNewTab ??
          defaultSettings.openInNewTab.threadList,
        threadListInBackground:
          oldOpenTab.threadListInBackground ??
          oldOpenTab.threadsInBackground ??
          saved.openThreadsInBackground ??
          false,
        progress:
          oldOpenTab.progress ??
          saved.openProgressInNewTab ??
          defaultSettings.openInNewTab.progress,
        progressInBackground:
          oldOpenTab.progressInBackground ??
          saved.openProgressInBackground ??
          false,
        nav: oldOpenTab.nav ?? defaultSettings.openInNewTab.nav,
        navInBackground: oldOpenTab.navInBackground ?? false,
        postContentLinks:
          oldOpenTab.postContentLinks ?? oldOpenTab.plainTextUrls ?? false,
        postContentLinksInBackground:
          oldOpenTab.postContentLinksInBackground ??
          oldOpenTab.plainTextUrlsInBackground ??
          false,
      };
      markMigration("open_in_new_tab_legacy_root_or_nested_keys");
    }
    if (
      !hasCurrentOpenInNewTabPostContentKeys &&
      hasLegacyOpenInNewTabPlainTextKeys
    ) {
      normalizedOpenInNewTab = {
        ...normalizedOpenInNewTab,
        postContentLinks:
          savedOpenInNewTab.plainTextUrls ??
          defaultSettings.openInNewTab.postContentLinks,
        postContentLinksInBackground:
          savedOpenInNewTab.plainTextUrlsInBackground ??
          defaultSettings.openInNewTab.postContentLinksInBackground,
      };
      markMigration("open_in_new_tab_legacy_plain_text_keys");
    }
    if (hasLegacyOpenInNewTabMaster) {
      // 旧版由 master 总开关门控，迁移后需固化为各子开关，避免升级后行为突变。
      const legacyMasterEnabled = savedOpenInNewTab.master === true;
      normalizedOpenInNewTab = {
        ...normalizedOpenInNewTab,
        threadList:
          legacyMasterEnabled && normalizedOpenInNewTab.threadList === true,
        progress: legacyMasterEnabled && normalizedOpenInNewTab.progress === true,
        nav: legacyMasterEnabled && normalizedOpenInNewTab.nav === true,
        postContentLinks:
          legacyMasterEnabled && normalizedOpenInNewTab.postContentLinks === true,
      };
      markMigration("open_in_new_tab_legacy_master");
    }
    Object.keys(defaultSettings.openInNewTab).forEach((key) => {
      const normalizedValue = normalizeBooleanWithDefault(
        normalizedOpenInNewTab[key],
        defaultSettings.openInNewTab[key]
      );
      if (normalizedOpenInNewTab[key] !== normalizedValue) {
        markMigration(`open_in_new_tab_normalized_bool:${key}`);
      }
      normalizedOpenInNewTab[key] = normalizedValue;
    });
    settings.openInNewTab = normalizedOpenInNewTab;

    const legacyRootKeys = [
      "openThreadsInNewTab",
      "openThreadsInBackground",
      "openProgressInNewTab",
      "openProgressInBackground",
    ];
    legacyRootKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        delete settings[key];
        markMigration(`open_in_new_tab_legacy_root_key_removed:${key}`);
      }
    });

    if (settings.openInNewTab && typeof settings.openInNewTab === "object") {
      const legacyNestedKeys = [
        "master",
        "threads",
        "threadsInBackground",
        "sidebar",
        "sidebarInBackground",
        "plainTextUrls",
        "plainTextUrlsInBackground",
      ];
      legacyNestedKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(settings.openInNewTab, key)) {
          delete settings.openInNewTab[key];
          markMigration(`open_in_new_tab_legacy_nested_key_removed:${key}`);
        }
      });
    }

    const normalizedSavedCustomNavLinks = normalizeCustomNavLinks(
      saved.customNavLinks
    );
    if (Array.isArray(saved.customNavLinks)) {
      settings.customNavLinks = normalizedSavedCustomNavLinks;
      if (
        JSON.stringify(deterministicSort(saved.customNavLinks)) !==
        JSON.stringify(deterministicSort(normalizedSavedCustomNavLinks))
      ) {
        markMigration("custom_nav_links_normalized");
      }
    } else {
      settings.customNavLinks = normalizedDefaultCustomNavLinks;
      if (typeof saved.customNavLinks !== "undefined") {
        markMigration("custom_nav_links_reset_to_default");
      }
    }

    const normalizedTokenExpiryEnabled = settings.syncTokenExpiryEnabled === true;
    if (settings.syncTokenExpiryEnabled !== normalizedTokenExpiryEnabled) {
      markMigration("sync_token_expiry_enabled_normalized");
    }
    settings.syncTokenExpiryEnabled = normalizedTokenExpiryEnabled;

    const parsedTokenExpiryDate = Number(settings.syncTokenExpiryDate);
    const normalizedTokenExpiryDate =
      Number.isFinite(parsedTokenExpiryDate) && parsedTokenExpiryDate > 0
        ? parsedTokenExpiryDate
        : null;
    if (!Object.is(settings.syncTokenExpiryDate, normalizedTokenExpiryDate)) {
      markMigration("sync_token_expiry_date_normalized");
    }
    settings.syncTokenExpiryDate = normalizedTokenExpiryDate;

    const normalizedSyncBookmarkFullContent =
      settings.syncBookmarkFullContent === true;
    if (
      settings.syncBookmarkFullContent !== normalizedSyncBookmarkFullContent
    ) {
      markMigration("sync_bookmark_full_content_normalized");
    }
    settings.syncBookmarkFullContent = normalizedSyncBookmarkFullContent;

    const normalizedLimitImagesBySize = normalizeBooleanWithDefault(
      settings.limitImagesBySize,
      true
    );
    if (settings.limitImagesBySize !== normalizedLimitImagesBySize) {
      markMigration("limit_images_by_size_normalized");
    }
    settings.limitImagesBySize = normalizedLimitImagesBySize;

    const normalizedUseS1PlusImageViewer = normalizeBooleanWithDefault(
      settings.useS1PlusImageViewer,
      true
    );
    if (
      settings.useS1PlusImageViewer !== normalizedUseS1PlusImageViewer
    ) {
      markMigration("use_s1plus_image_viewer_normalized");
    }
    settings.useS1PlusImageViewer = normalizedUseS1PlusImageViewer;

    const normalizedImagePreviewMaxWidth = normalizeImagePreviewLimitValue(
      settings.imagePreviewMaxWidth,
      IMAGE_PREVIEW_DEFAULT_WIDTH
    );
    if (!Object.is(settings.imagePreviewMaxWidth, normalizedImagePreviewMaxWidth)) {
      markMigration("image_preview_max_width_normalized");
    }
    settings.imagePreviewMaxWidth = normalizedImagePreviewMaxWidth;

    const normalizedImagePreviewMaxHeight = normalizeImagePreviewLimitValue(
      settings.imagePreviewMaxHeight,
      IMAGE_PREVIEW_DEFAULT_HEIGHT
    );
    if (
      !Object.is(settings.imagePreviewMaxHeight, normalizedImagePreviewMaxHeight)
    ) {
      markMigration("image_preview_max_height_normalized");
    }
    settings.imagePreviewMaxHeight = normalizedImagePreviewMaxHeight;

    const autoLinkPlainTextUrlsSourceValue =
      typeof saved.autoLinkPlainTextUrls !== "undefined"
        ? settings.autoLinkPlainTextUrls
        : settings.autoLinkBilibiliPlainText;
    const normalizedAutoLinkPlainTextUrls = normalizeBooleanWithDefault(
      autoLinkPlainTextUrlsSourceValue,
      defaultSettings.autoLinkPlainTextUrls
    );
    if (
      settings.autoLinkPlainTextUrls !==
      normalizedAutoLinkPlainTextUrls
    ) {
      markMigration("auto_link_plain_text_urls_normalized");
    }
    settings.autoLinkPlainTextUrls = normalizedAutoLinkPlainTextUrls;
    if (Object.prototype.hasOwnProperty.call(settings, "autoLinkBilibiliPlainText")) {
      delete settings.autoLinkBilibiliPlainText;
      markMigration("auto_link_bilibili_plain_text_removed");
    }

    return { settings, migrationApplied, migrationReasons };
  };

  if (IS_S1P_TEST_MODE) {
    const testHookHost = typeof globalThis !== "undefined" ? globalThis : {};
    testHookHost.__S1P_TEST_HOOKS__ = {
      ...(testHookHost.__S1P_TEST_HOOKS__ || {}),
      buildNormalizedSettings,
      defaultSettings,
    };
  }

  let settingsCacheValue = null;
  let settingsCacheExpiresAt = 0;
  let localSettingsWriteInFlightCount = 0;
  const cloneSettingsObject = (settings) => {
    if (!settings || typeof settings !== "object") {
      return buildNormalizedSettings({}).settings;
    }
    if (typeof structuredClone === "function") {
      return structuredClone(settings);
    }
    try {
      return JSON.parse(JSON.stringify(settings));
    } catch (error) {
      return buildNormalizedSettings(settings).settings;
    }
  };
  const setSettingsCache = (settings) => {
    settingsCacheValue = cloneSettingsObject(settings);
    settingsCacheExpiresAt = Date.now() + SETTINGS_CACHE_TTL_MS;
  };
  const invalidateSettingsCache = () => {
    settingsCacheValue = null;
    settingsCacheExpiresAt = 0;
  };
  const SETTINGS_CROSS_TAB_FULL_APPLY_PATHS = [
    "enablePostBlocking",
    "enableGeneralSettings",
    "enableUserBlocking",
    "enableUserTagging",
    "enableReadProgress",
    "enableBookmarkReplies",
  ];
  const SETTINGS_CROSS_TAB_LIGHTWEIGHT_PATHS = [
    "openInNewTab",
    "hideImagesByDefault",
    "limitImagesBySize",
    "useS1PlusImageViewer",
    "imagePreviewMaxWidth",
    "imagePreviewMaxHeight",
    "showReadIndicator",
    "autoLinkPlainTextUrls",
    "changeLogoLink",
    "hideBlacklistTip",
    "customTitleSuffix",
    "enableNavCustomization",
    "customNavLinks",
    "hideSystemBlockedPosts",
    "enhanceFloatingControls",
    "syncRemoteEnabled",
    "syncRemoteGistId",
    "syncRemotePat",
    "syncDirectChoiceMode",
  ];
  const SETTINGS_CROSS_TAB_PASSIVE_PATHS = [
    "readingProgressCleanupDays",
    "cleanupMode",
    "blockThreadsOnUserBlock",
    "syncWithNativeBlacklist",
    "showBlockedByKeywordList",
    "showManuallyBlockedList",
    "recommendS1Nux",
    "syncDailyFirstLoad",
    "syncAutoEnabled",
    "syncShowAutoSyncIndicator",
    "syncForcePullOnStartup",
    "syncBookmarkFullContent",
    "syncTokenExpiryEnabled",
    "syncTokenExpiryDate",
  ];
  const SETTINGS_FALLBACK_SYNC_POLL_MIN_INTERVAL_MS = 1500;
  const SETTINGS_FALLBACK_SYNC_POLL_MAX_INTERVAL_MS = 20 * 1000;
  const SETTINGS_FALLBACK_SYNC_POLL_BACKOFF_STEP_MS = 2500;
  const SETTINGS_FALLBACK_SYNC_SIGNAL_HEALTH_WINDOW_MS = 60 * 1000;
  const isSettingPathMatched = (changedPath, targetPath) => {
    if (!changedPath || !targetPath) {
      return false;
    }
    return (
      changedPath === targetPath ||
      changedPath.startsWith(`${targetPath}.`) ||
      targetPath.startsWith(`${changedPath}.`)
    );
  };
  const hasSettingPathInChangedSet = (changedPathSet, targetPath) => {
    for (const changedPath of changedPathSet) {
      if (isSettingPathMatched(changedPath, targetPath)) {
        return true;
      }
    }
    return false;
  };
  const collectChangedSettingPaths = (
    previousSettings,
    nextSettings
  ) => {
    const changedPathSet = new Set();
    const visitPath = (previousValue, nextValue, path) => {
      if (!hasComparableValueChanged(previousValue, nextValue)) {
        return;
      }
      const previousIsPlainObject =
        previousValue &&
        typeof previousValue === "object" &&
        !Array.isArray(previousValue);
      const nextIsPlainObject =
        nextValue &&
        typeof nextValue === "object" &&
        !Array.isArray(nextValue);
      if (!previousIsPlainObject || !nextIsPlainObject) {
        if (path) {
          changedPathSet.add(path);
        }
        return;
      }
      const keys = new Set([
        ...Object.keys(previousValue),
        ...Object.keys(nextValue),
      ]);
      if (keys.size === 0 && path) {
        changedPathSet.add(path);
        return;
      }
      keys.forEach((key) => {
        const childPath = path ? `${path}.${key}` : key;
        visitPath(previousValue[key], nextValue[key], childPath);
      });
    };
    visitPath(previousSettings, nextSettings, "");
    return Array.from(changedPathSet);
  };
  const pendingSettingsCrossTabRefreshPaths = new Set();
  let pendingSettingsCrossTabNeedsFullApply = false;
  let settingsModalCrossTabSyncController = null;
  let lastSettingsCrossTabSignalReceivedAt = 0;
  let hasObservedSettingsCrossTabSignal = false;
  let settingsRuntimeAppliedSnapshot = null;
  const markSettingsRuntimeAppliedSnapshot = (settings) => {
    settingsRuntimeAppliedSnapshot = cloneSettingsObject(
      buildNormalizedSettings(settings).settings
    );
  };
  const hasSettingsRuntimeAppliedDrift = (nextSettings) => {
    if (!settingsRuntimeAppliedSnapshot) {
      return true;
    }
    return hasComparableValueChanged(settingsRuntimeAppliedSnapshot, nextSettings);
  };
  const parseSettingsCrossTabSignalPayload = (rawValue) => {
    if (
      rawValue &&
      typeof rawValue === "object" &&
      !Array.isArray(rawValue)
    ) {
      return {
        sender:
          typeof rawValue.sender === "string" ? rawValue.sender : "",
        ts: Number(rawValue.ts) || 0,
      };
    }
    return {
      sender: "",
      ts: Number(rawValue) || 0,
    };
  };
  const shouldHandleCoreDataCrossTabChange = (
    key,
    newValue,
    isCrossContextChange
  ) => {
    if (key !== SETTINGS_CROSS_TAB_SIGNAL_KEY) {
      return Boolean(isCrossContextChange);
    }
    const signalPayload = parseSettingsCrossTabSignalPayload(newValue);
    if (
      signalPayload.sender &&
      signalPayload.sender === SETTINGS_CROSS_TAB_SIGNAL_SOURCE_ID
    ) {
      return false;
    }
    return Boolean(isCrossContextChange || signalPayload.sender);
  };
  const normalizeSettingChangedPath = (path) =>
    typeof path === "string" ? path.trim() : "";
  const appendSettingChangedPathsToSet = (targetSet, changedPaths = []) => {
    if (!(targetSet instanceof Set) || !Array.isArray(changedPaths)) {
      return;
    }
    changedPaths.forEach((path) => {
      const normalizedPath = normalizeSettingChangedPath(path);
      if (normalizedPath) {
        targetSet.add(normalizedPath);
      }
    });
  };
  const syncOpenSettingsModalFromCrossTab = ({
    changedPathSet = new Set(),
    forceFullApply = false,
  } = {}) => {
    if (!settingsModalCrossTabSyncController) {
      return;
    }
    if (
      typeof settingsModalCrossTabSyncController.sync !== "function" ||
      typeof settingsModalCrossTabSyncController.isAlive !== "function" ||
      !settingsModalCrossTabSyncController.isAlive()
    ) {
      settingsModalCrossTabSyncController = null;
      return;
    }
    try {
      settingsModalCrossTabSyncController.sync({ changedPathSet, forceFullApply });
    } catch (error) {
      console.warn(
        "S1 Plus: 跨标签设置面板同步失败，将在下次事件中重试。",
        error
      );
    }
  };
  const scheduleSettingsCrossTabRefresh = (changedPaths = []) => {
    if (Array.isArray(changedPaths) && changedPaths.length > 0) {
      appendSettingChangedPathsToSet(
        pendingSettingsCrossTabRefreshPaths,
        changedPaths
      );
    } else {
      pendingSettingsCrossTabNeedsFullApply = true;
    }
    scheduleCoreDataCrossTabRefresh("s1p_settings_refresh");
  };
  const stageSettingsCrossTabRefreshForImmediateRun = ({
    changedPaths = null,
    forceFullApply = false,
  } = {}) => {
    pendingSettingsCrossTabRefreshPaths.clear();
    pendingSettingsCrossTabNeedsFullApply = Boolean(forceFullApply);
    if (pendingSettingsCrossTabNeedsFullApply) {
      return;
    }
    if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
      pendingSettingsCrossTabNeedsFullApply = true;
      return;
    }
    appendSettingChangedPathsToSet(pendingSettingsCrossTabRefreshPaths, changedPaths);
  };
  const queueSettingsCrossTabRefresh = ({
    changedPaths = null,
    forceFullApply = false,
    applyImmediately = false,
  } = {}) => {
    if (applyImmediately) {
      stageSettingsCrossTabRefreshForImmediateRun({
        changedPaths,
        forceFullApply,
      });
      runSettingsCrossTabRefresh();
      return;
    }
    if (forceFullApply || !Array.isArray(changedPaths) || changedPaths.length === 0) {
      scheduleSettingsCrossTabRefresh();
      return;
    }
    scheduleSettingsCrossTabRefresh(changedPaths);
  };
  const initializeSettingsCacheSync = () => {
    if (window.__s1pSettingsCacheSyncBound) {
      return;
    }
    window.__s1pSettingsCacheSyncBound = true;

    if (typeof GM_addValueChangeListener === "function") {
      GM_addValueChangeListener(
        "s1p_settings",
        (_key, oldValue, newValue, isCrossContextChange) => {
          const { settings: nextSettings } = buildNormalizedSettings(newValue);
          const currentSettingsSnapshot = getSettings();
          const differsFromCurrentCache = hasComparableValueChanged(
            currentSettingsSnapshot,
            nextSettings
          );

          // 某些油猴实现里 isCrossContextChange 在对象值上存在误报。
          // 兜底策略：若新值与当前缓存确有差异，仍按跨标签更新处理；
          // 但本标签页写入中的回调仍跳过，避免重复调度。
          if (
            !isCrossContextChange &&
            (localSettingsWriteInFlightCount > 0 || !differsFromCurrentCache)
          ) {
            return;
          }
          const { settings: previousSettings } = buildNormalizedSettings(
            oldValue &&
              typeof oldValue === "object" &&
              !Array.isArray(oldValue)
              ? oldValue
              : {}
          );
          setSettingsCache(nextSettings);
          if (hasComparableValueChanged(previousSettings, nextSettings)) {
            scheduleSettingsCrossTabRefresh(
              collectChangedSettingPaths(previousSettings, nextSettings)
            );
          } else if (differsFromCurrentCache) {
            // old/new 值无法可靠对比时，回退为全量刷新，保证关闭态也能收敛。
            scheduleSettingsCrossTabRefresh();
          }
        }
      );
    }
  };
  const pullSettingsFromStorageSnapshot = () =>
    buildNormalizedSettings(GM_getValue("s1p_settings", {})).settings;
  const syncSettingsFromStorageSnapshotIfNeeded = ({
    forceFullApply = false,
    applyImmediately = false,
    forceApplyWhenUnchanged = false,
  } = {}) => {
    if (localSettingsWriteInFlightCount > 0) {
      return false;
    }
    const cachedSettings = getSettings();
    const storedSettings = pullSettingsFromStorageSnapshot();
    if (!hasComparableValueChanged(cachedSettings, storedSettings)) {
      if (!forceApplyWhenUnchanged) {
        if (!(forceFullApply && hasSettingsRuntimeAppliedDrift(storedSettings))) {
          return false;
        }
      }
      queueSettingsCrossTabRefresh({
        forceFullApply: true,
        applyImmediately,
      });
      return true;
    }

    const changedPaths = collectChangedSettingPaths(cachedSettings, storedSettings);
    setSettingsCache(storedSettings);
    queueSettingsCrossTabRefresh({
      changedPaths,
      forceFullApply,
      applyImmediately,
    });
    return true;
  };
  const initializeSettingsFallbackSync = () => {
    if (window.__s1pSettingsFallbackSyncBound) {
      return;
    }
    window.__s1pSettingsFallbackSyncBound = true;
    let fallbackPollTimer = null;
    let fallbackPollIntervalMs = SETTINGS_FALLBACK_SYNC_POLL_MIN_INTERVAL_MS;
    const stopFallbackPoll = () => {
      if (fallbackPollTimer) {
        clearTimeout(fallbackPollTimer);
        fallbackPollTimer = null;
      }
    };
    const hasHealthyCrossTabSettingsSignalChannel = () => {
      if (!hasObservedSettingsCrossTabSignal) {
        return false;
      }
      return (
        Date.now() - lastSettingsCrossTabSignalReceivedAt <=
        SETTINGS_FALLBACK_SYNC_SIGNAL_HEALTH_WINDOW_MS
      );
    };

    const trySyncFromStorage = ({ forceFullApply = false } = {}) => {
      if (document.visibilityState === "hidden") {
        return false;
      }
      return syncSettingsFromStorageSnapshotIfNeeded({ forceFullApply });
    };

    const adjustFallbackPollInterval = ({ didSync = false } = {}) => {
      if (didSync || !hasHealthyCrossTabSettingsSignalChannel()) {
        fallbackPollIntervalMs = SETTINGS_FALLBACK_SYNC_POLL_MIN_INTERVAL_MS;
        return;
      }
      fallbackPollIntervalMs = Math.min(
        SETTINGS_FALLBACK_SYNC_POLL_MAX_INTERVAL_MS,
        fallbackPollIntervalMs + SETTINGS_FALLBACK_SYNC_POLL_BACKOFF_STEP_MS
      );
    };
    const scheduleNextFallbackPoll = () => {
      if (document.visibilityState !== "visible") {
        stopFallbackPoll();
        return;
      }
      stopFallbackPoll();
      fallbackPollTimer = setTimeout(() => {
        fallbackPollTimer = null;
        if (document.visibilityState !== "visible") {
          return;
        }
        const shouldForceFullApplyInPoll =
          !hasHealthyCrossTabSettingsSignalChannel();
        const didSync = trySyncFromStorage({
          forceFullApply: shouldForceFullApplyInPoll,
        });
        adjustFallbackPollInterval({ didSync });
        scheduleNextFallbackPoll();
      }, fallbackPollIntervalMs);
    };
    const resyncSettingsOnForeground = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      trySyncFromStorage({ forceFullApply: true });
      adjustFallbackPollInterval({ didSync: false });
      scheduleNextFallbackPoll();
    };

    scheduleNextFallbackPoll();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        resyncSettingsOnForeground();
        return;
      }
      stopFallbackPoll();
    });
    window.addEventListener("focus", resyncSettingsOnForeground);
    window.addEventListener("pageshow", resyncSettingsOnForeground);
  };
  let coreDataCrossTabRefreshTimer = null;
  const pendingCoreDataCrossTabRefreshKeys = new Set();
  const runFullSettingsCrossTabRefresh = (changedPathSet) => {
    initializeNavbar();
    applyChanges();
    markSettingsRuntimeAppliedSnapshot(getSettings());
    syncOpenSettingsModalFromCrossTab({
      changedPathSet,
      forceFullApply: true,
    });
    return true;
  };
  const runSettingsCrossTabRefresh = () => {
    const changedPathSet = new Set();
    appendSettingChangedPathsToSet(
      changedPathSet,
      Array.from(pendingSettingsCrossTabRefreshPaths)
    );
    pendingSettingsCrossTabRefreshPaths.clear();

    const forceFullApply = pendingSettingsCrossTabNeedsFullApply;
    pendingSettingsCrossTabNeedsFullApply = false;

    if (forceFullApply || changedPathSet.size === 0) {
      return runFullSettingsCrossTabRefresh(changedPathSet);
    }

    let requiresFullApply = false;
    for (const changedPath of changedPathSet) {
      if (
        SETTINGS_CROSS_TAB_FULL_APPLY_PATHS.some((targetPath) =>
          isSettingPathMatched(changedPath, targetPath)
        )
      ) {
        requiresFullApply = true;
        break;
      }
      const handledByLightweightPath =
        SETTINGS_CROSS_TAB_LIGHTWEIGHT_PATHS.some((targetPath) =>
          isSettingPathMatched(changedPath, targetPath)
        );
      if (handledByLightweightPath) {
        continue;
      }
      const handledByPassivePath = SETTINGS_CROSS_TAB_PASSIVE_PATHS.some(
        (targetPath) => isSettingPathMatched(changedPath, targetPath)
      );
      if (!handledByPassivePath) {
        requiresFullApply = true;
        break;
      }
    }

    if (requiresFullApply) {
      return runFullSettingsCrossTabRefresh(changedPathSet);
    }

    const settings = getSettings();
    const shouldReinitializeNavbar =
      hasSettingPathInChangedSet(changedPathSet, "enableNavCustomization") ||
      hasSettingPathInChangedSet(changedPathSet, "customNavLinks") ||
      hasSettingPathInChangedSet(changedPathSet, "syncRemoteEnabled") ||
      hasSettingPathInChangedSet(changedPathSet, "syncAutoEnabled") ||
      hasSettingPathInChangedSet(changedPathSet, "syncShowAutoSyncIndicator") ||
      hasSettingPathInChangedSet(changedPathSet, "syncDirectChoiceMode");
    if (shouldReinitializeNavbar) {
      initializeNavbar();
    } else if (
      hasSettingPathInChangedSet(changedPathSet, "syncRemoteGistId") ||
      hasSettingPathInChangedSet(changedPathSet, "syncRemotePat")
    ) {
      updateNavbarSyncButton();
    }
    if (
      hasSettingPathInChangedSet(changedPathSet, "changeLogoLink") ||
      hasSettingPathInChangedSet(changedPathSet, "hideBlacklistTip") ||
      hasSettingPathInChangedSet(changedPathSet, "customTitleSuffix")
    ) {
      applyInterfaceCustomizations();
    }
    if (hasSettingPathInChangedSet(changedPathSet, "enhanceFloatingControls")) {
      manageFloatingControls();
    }
    if (hasSettingPathInChangedSet(changedPathSet, "hideImagesByDefault")) {
      applyImageHiding();
      manageImageToggleAllButtons();
      applyS1pImageViewerBehavior();
    }
    if (
      hasSettingPathInChangedSet(changedPathSet, "limitImagesBySize") ||
      hasSettingPathInChangedSet(changedPathSet, "imagePreviewMaxWidth") ||
      hasSettingPathInChangedSet(changedPathSet, "imagePreviewMaxHeight")
    ) {
      applyImageSizeLimits();
      applyS1pImageViewerBehavior();
    }
    if (
      hasSettingPathInChangedSet(changedPathSet, "useS1PlusImageViewer")
    ) {
      applyS1pImageViewerBehavior();
    }
    if (hasSettingPathInChangedSet(changedPathSet, "openInNewTab")) {
      applyGlobalLinkBehavior();
    }
    if (hasSettingPathInChangedSet(changedPathSet, "autoLinkPlainTextUrls")) {
      applyPlainTextUrlAutolinks();
    }
    if (
      (hasSettingPathInChangedSet(changedPathSet, "openInNewTab.progress") ||
        hasSettingPathInChangedSet(
          changedPathSet,
          "openInNewTab.progressInBackground"
        )) &&
      settings.enableGeneralSettings === true &&
      settings.enableReadProgress === true &&
      isThreadListPage()
    ) {
      scheduleProgressJumpButtonsRefresh();
    }
    if (hasSettingPathInChangedSet(changedPathSet, "showReadIndicator")) {
      if (!settings.showReadIndicator) {
        updateReadIndicatorUI(null);
      } else if (
        settings.enableGeneralSettings === true &&
        settings.enableReadProgress === true
      ) {
        trackReadProgressInThread();
      }
    }
    if (hasSettingPathInChangedSet(changedPathSet, "hideSystemBlockedPosts")) {
      hideSystemBlockedPosts();
    }

    markSettingsRuntimeAppliedSnapshot(settings);
    syncOpenSettingsModalFromCrossTab({ changedPathSet });
    return false;
  };
  const runCoreDataCrossTabRefresh = () => {
    coreDataCrossTabRefreshTimer = null;
    if (pendingCoreDataCrossTabRefreshKeys.size === 0) {
      return;
    }

    const keys = Array.from(pendingCoreDataCrossTabRefreshKeys);
    pendingCoreDataCrossTabRefreshKeys.clear();
    const changedKeys = new Set(keys);

    if (changedKeys.has(SETTINGS_CROSS_TAB_SIGNAL_KEY)) {
      changedKeys.delete(SETTINGS_CROSS_TAB_SIGNAL_KEY);
      lastSettingsCrossTabSignalReceivedAt = Date.now();
      hasObservedSettingsCrossTabSignal = true;
      const didApplyFromSignal = syncSettingsFromStorageSnapshotIfNeeded({
        forceFullApply: true,
        applyImmediately: true,
        forceApplyWhenUnchanged: true,
      });
      if (didApplyFromSignal) {
        pendingSettingsCrossTabRefreshPaths.clear();
        pendingSettingsCrossTabNeedsFullApply = false;
        changedKeys.delete("s1p_settings_refresh");
        if (changedKeys.size === 0) {
          return;
        }
      }
    }

    if (changedKeys.has("s1p_settings_refresh")) {
      const didRunFullSettingsApply = runSettingsCrossTabRefresh();
      changedKeys.delete("s1p_settings_refresh");
      if (didRunFullSettingsApply && changedKeys.size === 0) {
        return;
      }
    }

    const settings = getSettings();

    if (changedKeys.has("s1p_blocked_threads")) {
      if (settings.enablePostBlocking) {
        hideBlockedThreads();
        applyUserThreadBlocklist();
        hideThreadsByTitleKeyword();
      } else {
        restoreManagedVisibilityAfterDataImport(settings);
        document.querySelectorAll(".s1p-hidden-by-keyword").forEach((row) => {
          row.classList.remove("s1p-hidden-by-keyword");
        });
        dynamicallyHiddenThreads = {};
      }
    }

    if (changedKeys.has("s1p_blocked_users")) {
      restoreManagedVisibilityAfterDataImport(settings);
      if (settings.enableUserBlocking) {
        hideBlockedUsersPosts();
      }
      hideBlockedUserQuotes();
      hideBlockedUserRatings();
      hideBlockedUserNotifications();
      if (settings.enablePostBlocking) {
        applyUserThreadBlocklist();
      }
    }

    if (changedKeys.has("s1p_blocked_posts")) {
      restoreManagedVisibilityAfterDataImport(settings);
      if (settings.enablePostBlocking) {
        hideBlockedPosts();
      }
    }

    if (
      changedKeys.has("s1p_read_progress") &&
      settings.enableGeneralSettings === true &&
      settings.enableReadProgress === true
    ) {
      if (isThreadListPage()) {
        scheduleProgressJumpButtonsRefresh();
      } else if (document.querySelector('table[id^="pid"]')) {
        trackReadProgressInThread();
        if (settings.showReadIndicator) {
          const currentThreadId = getCurrentThreadId();
          if (currentThreadId) {
            const currentThreadProgress = getReadProgress()[currentThreadId];
            updateReadIndicatorUI(
              normalizeNumericId(currentThreadProgress?.postId) || null
            );
          } else {
            updateReadIndicatorUI(null);
          }
        }
      }
    }

    if (changedKeys.has("s1p_title_filter_rules")) {
      if (settings.enablePostBlocking) {
        hideThreadsByTitleKeyword();
      } else {
        document.querySelectorAll(".s1p-hidden-by-keyword").forEach((row) => {
          row.classList.remove("s1p-hidden-by-keyword");
        });
        dynamicallyHiddenThreads = {};
      }
    }

    if (
      (changedKeys.has("s1p_user_tags") ||
        changedKeys.has("s1p_bookmarked_replies") ||
        changedKeys.has("s1p_blocked_posts")) &&
      (settings.enableUserTagging ||
        settings.enableBookmarkReplies ||
        settings.enablePostBlocking) &&
      document.querySelector('table[id^="pid"]')
    ) {
      refreshAllAuthiActions();
    }

  };
  const ensureCoreDataCrossTabRefreshScheduled = (delayMs = 120) => {
    if (document.visibilityState === "hidden") {
      return;
    }
    if (coreDataCrossTabRefreshTimer) {
      return;
    }
    coreDataCrossTabRefreshTimer = setTimeout(runCoreDataCrossTabRefresh, delayMs);
  };
  const scheduleCoreDataCrossTabRefresh = (key) => {
    if (!key) {
      return;
    }
    pendingCoreDataCrossTabRefreshKeys.add(key);
    ensureCoreDataCrossTabRefreshScheduled();
  };
  const initializeCoreDataCacheSync = () => {
    if (window.__s1pCoreDataCacheSyncBound) {
      return;
    }
    window.__s1pCoreDataCacheSyncBound = true;

    if (typeof GM_addValueChangeListener !== "function") {
      return;
    }

    const bindCoreDataCacheSync = (key, cacheState = null) => {
      GM_addValueChangeListener(
        key,
        (_changedKey, _oldValue, newValue, isCrossContextChange) => {
          if (
            !shouldHandleCoreDataCrossTabChange(
              key,
              newValue,
              isCrossContextChange
            )
          ) {
            return;
          }
          setComparableStoredValue(key, newValue);
          if (cacheState) {
            setCoreDataCacheValue(cacheState, newValue);
          }
          scheduleCoreDataCrossTabRefresh(key);
        }
      );
    };

    bindCoreDataCacheSync("s1p_blocked_threads", blockedThreadsCache);
    bindCoreDataCacheSync("s1p_blocked_users", blockedUsersCache);
    bindCoreDataCacheSync("s1p_blocked_posts", blockedPostsCache);
    bindCoreDataCacheSync("s1p_read_progress", readProgressCache);
    bindCoreDataCacheSync("s1p_title_filter_rules", titleFilterRulesCache);
    bindCoreDataCacheSync("s1p_user_tags", userTagsCache);
    bindCoreDataCacheSync("s1p_bookmarked_replies", bookmarkedRepliesCache);
    bindCoreDataCacheSync(SETTINGS_CROSS_TAB_SIGNAL_KEY);
    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        pendingCoreDataCrossTabRefreshKeys.size > 0 &&
        !coreDataCrossTabRefreshTimer
      ) {
        ensureCoreDataCrossTabRefreshScheduled(0);
      }
    });
  };
  const getSettings = () => {
    if (settingsCacheValue && Date.now() < settingsCacheExpiresAt) {
      return settingsCacheValue;
    }

    if (settingsCacheValue) {
      invalidateSettingsCache();
    }
    const saved = GM_getValue("s1p_settings", {});
    const { settings } = buildNormalizedSettings(saved);
    setSettingsCache(settings);
    return settingsCacheValue;
  };
  // 写操作请使用此函数，避免直接修改缓存对象。
  const getSettingsForWrite = () => cloneSettingsObject(getSettings());

  // [S1PLUS-ADD-ABOVE: saveSettings]
  /**
   * [NEW] 设置一个嵌套对象的值。
   * @param {object} obj - 要修改的对象。
   * @param {string} path - 属性路径，用点号分隔，例如 'openInNewTab.threadList'。
   * @param {any} value - 要设置的值。
   */
  const setNestedValue = (obj, path, value) => {
    const keys = path.split(".");
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof current[keys[i]] === "undefined") {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
  };

  const normalizeSaveSettingsOptions = (
    suppressSyncTriggerOrOptions = false,
    legacyMarkDataChangedWhenSuppressed = false
  ) => {
    if (
      typeof suppressSyncTriggerOrOptions === "object" &&
      suppressSyncTriggerOrOptions !== null
    ) {
      return {
        suppressSyncTrigger: Boolean(
          suppressSyncTriggerOrOptions.suppressSyncTrigger
        ),
        markDataChangedWhenSuppressed: Boolean(
          suppressSyncTriggerOrOptions.markDataChangedWhenSuppressed
        ),
      };
    }
    return {
      suppressSyncTrigger: Boolean(suppressSyncTriggerOrOptions),
      markDataChangedWhenSuppressed: Boolean(
        legacyMarkDataChangedWhenSuppressed
      ),
    };
  };

  // [MODIFIED] 增加 suppressSyncTrigger 参数以阻止在特定情况下触发自动同步
  const saveSettings = (
    settings,
    suppressSyncTriggerOrOptions = false,
    legacyMarkDataChangedWhenSuppressed = false
  ) => {
    const { suppressSyncTrigger, markDataChangedWhenSuppressed } =
      normalizeSaveSettingsOptions(
        suppressSyncTriggerOrOptions,
        legacyMarkDataChangedWhenSuppressed
      );
    const normalizedSettings = buildNormalizedSettings(settings).settings;
    const currentSettings = getSettings();
    if (!hasComparableValueChanged(currentSettings, normalizedSettings)) {
      setSettingsCache(normalizedSettings);
      return;
    }
    invalidateLocalDataHashCache();
    localSettingsWriteInFlightCount += 1;
    try {
      GM_setValue("s1p_settings", normalizedSettings);
      GM_setValue(SETTINGS_CROSS_TAB_SIGNAL_KEY, {
        ts: Date.now(),
        sender: SETTINGS_CROSS_TAB_SIGNAL_SOURCE_ID,
        nonce: Math.random(),
      });
      setSettingsCache(normalizedSettings);
    } finally {
      localSettingsWriteInFlightCount = Math.max(
        0,
        localSettingsWriteInFlightCount - 1
      );
    }
    console.log("S1 Plus: Settings saved.");
    if (!suppressSyncTrigger) {
      updateLastModifiedTimestamp();
    } else if (markDataChangedWhenSuppressed) {
      updateLastModifiedTimestamp("general", { triggerSync: false });
    }
  };

  const migrateLegacySettingsIfNeeded = () => {
    const saved = GM_getValue("s1p_settings", {});
    const { settings, migrationApplied, migrationReasons = [] } =
      buildNormalizedSettings(saved);
    if (!migrationApplied) {
      return false;
    }

    console.log("S1 Plus: 检测到旧版设置结构，正在执行一次性迁移...");
    if (migrationReasons.length > 0) {
      console.log("S1 Plus: 设置迁移原因:", migrationReasons.join(", "));
    }
    // 推进本地版本时间戳以避免“时间戳相同但内容不同”的假冲突，同时不触发自动推送。
    saveSettings(settings, {
      suppressSyncTrigger: true,
      markDataChangedWhenSuppressed: true,
    });
    console.log("S1 Plus: 设置迁移完成。");
    return true;
  };

  let interfaceTitleBaseCache = null;
  let lastAppliedCustomTitleSuffix = "";
  const TITLE_BASE_PATTERN =
    /^(.+?)(?:论坛)?(?:\s*-\s*Stage1st)?\s*-\s*stage1\/s1\s+游戏动漫论坛$/;
  const resolveInterfaceTitleBase = () => {
    const currentTitle = String(document.title || "");
    const matched = currentTitle.match(TITLE_BASE_PATTERN);
    if (matched && matched[1]) {
      interfaceTitleBaseCache = matched[1];
      return interfaceTitleBaseCache;
    }
    if (
      lastAppliedCustomTitleSuffix &&
      currentTitle.endsWith(lastAppliedCustomTitleSuffix)
    ) {
      const strippedTitle = currentTitle.slice(
        0,
        -lastAppliedCustomTitleSuffix.length
      );
      if (strippedTitle) {
        interfaceTitleBaseCache = strippedTitle;
        return interfaceTitleBaseCache;
      }
    }
    if (!interfaceTitleBaseCache) {
      interfaceTitleBaseCache = currentTitle;
    }
    return interfaceTitleBaseCache;
  };

  // --- 界面定制功能 ---
  const applyInterfaceCustomizations = () => {
    const settings = getSettings();
    const generalSettingsEnabled = settings.enableGeneralSettings === true;

    const logoLink = document.querySelector("#hd h2 a");
    if (logoLink) {
      if (!logoLink.dataset.s1pOriginalHref) {
        const originalHref = logoLink.getAttribute("href");
        if (typeof originalHref === "string") {
          logoLink.dataset.s1pOriginalHref = originalHref;
        }
      }
      const originalHref = logoLink.dataset.s1pOriginalHref || "./";
      if (generalSettingsEnabled && settings.changeLogoLink) {
        logoLink.setAttribute("href", "./forum.php");
      } else {
        logoLink.setAttribute("href", originalHref);
      }
    }

    const blacklistTip = document.getElementById("hiddenpoststip");
    if (blacklistTip) {
      if (generalSettingsEnabled && settings.hideBlacklistTip) {
        blacklistTip.style.display = "none";
      } else {
        blacklistTip.style.removeProperty("display");
      }
    }

    const titleBase = resolveInterfaceTitleBase();
    const nextSuffix = generalSettingsEnabled
      ? String(settings.customTitleSuffix || "")
      : "";
    document.title = nextSuffix ? `${titleBase}${nextSuffix}` : titleBase;
    lastAppliedCustomTitleSuffix = nextSuffix;
  };

  /**
   * [NEW & EXTENDED V6 - SVG & ClassName Support] 创建一个更通用的行内动作菜单
   * @param {HTMLElement} anchorElement - 菜单定位的锚点元素
   * @param {Array<Object>} buttons - 按钮配置数组，例如 [{ label, title, action, className, callback }]
   * @param {Function} [onCloseCallback] - 菜单关闭时执行的回调函数
   */
  const createInlineActionMenu = (
    anchorElement,
    buttons,
    onCloseCallback,
    options = {}
  ) => {
    // 确保同一时间只有一个菜单
    const existingMenu = document.querySelector(".s1p-inline-action-menu");
    if (existingMenu) {
      if (
        existingMenu.s1p_api &&
        typeof existingMenu.s1p_api.destroy === "function"
      ) {
        existingMenu.s1p_api.destroy();
      } else {
        existingMenu.remove();
      }
    }

    const menu = document.createElement("div");
    menu.className = "s1p-inline-action-menu";
    const isAnchorInAuthiActions = Boolean(
      anchorElement?.closest?.(".s1p-authi-actions-wrapper")
    );
    if (isAnchorInAuthiActions) {
      menu.dataset.s1pScope = POPUP_SCOPE_POST_TOOLBAR;
    }

    let isClosing = false;
    let hideTimeout = null;
    const detachHoverListeners = () => {
      anchorElement.removeEventListener("mouseleave", startHideTimer);
      menu.removeEventListener("mouseenter", cancelHideTimer);
      menu.removeEventListener("mouseleave", startHideTimer);
    };
    const notifyClose = () => {
      if (onCloseCallback) onCloseCallback();
    };
    const closeMenu = () => {
      if (isClosing) return;
      isClosing = true;
      cancelHideTimer();
      detachHoverListeners();
      menu.classList.remove("visible");
      setTimeout(() => {
        if (menu.parentNode) menu.remove();
        notifyClose();
      }, 200);
    };
    const destroyMenu = () => {
      if (isClosing) return;
      isClosing = true;
      cancelHideTimer();
      detachHoverListeners();
      if (menu.parentNode) menu.remove();
      notifyClose();
    };

    buttons.forEach((btnConfig) => {
      const button = document.createElement("button");
      button.className = "s1p-action-btn";
      // [新增] 支持自定义 className
      if (btnConfig.className) {
        button.classList.add(...btnConfig.className.split(" "));
      }

      button.dataset.action = btnConfig.action;
      const buttonLabel =
        btnConfig.label === undefined || btnConfig.label === null
          ? ""
          : String(btnConfig.label);
      if (btnConfig.allowLabelHtml === true) {
        button.innerHTML = sanitizeInlineActionLabelHtml(buttonLabel);
      } else {
        button.textContent = buttonLabel;
      }
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
    const positionAnchorElement =
      options.positionAnchorElement instanceof Element
        ? options.positionAnchorElement
        : anchorElement;
    const rawAnchorGapPx = Number(options.anchorGapPx);
    const anchorGapPx = Number.isFinite(rawAnchorGapPx)
      ? Math.max(0, rawAnchorGapPx)
      : 4;
    const anchorRect = positionAnchorElement.getBoundingClientRect();
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
      left = anchorRect.right + window.scrollX + anchorGapPx;
    } else {
      left = anchorRect.left + window.scrollX - menuRect.width - anchorGapPx;
    }

    if (left < window.scrollX) {
      left = window.scrollX + 8;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    // --- 交互逻辑 ---
    const startHideTimer = () => {
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(closeMenu, 300);
    };
    const cancelHideTimer = () => {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    };

    anchorElement.addEventListener("mouseleave", startHideTimer);
    menu.addEventListener("mouseenter", cancelHideTimer);
    menu.addEventListener("mouseleave", startHideTimer);
    menu.s1p_api = {
      close: closeMenu,
      destroy: destroyMenu,
      startHideTimer,
      cancelHideTimer,
    };

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
    if (manualSyncInFlightPromise || forceSyncInFlight) {
      showMessage("手动同步正在进行，请稍候...", null);
      if (icon) {
        icon.classList.remove("s1p-syncing");
      }
      return;
    }
    forceSyncInFlight = true;
    if (!(await acquireManualSyncLock())) {
      showMessage("当前有其他同步任务正在执行，请稍后再试。", false);
      forceSyncInFlight = false;
      if (icon) {
        icon.classList.remove("s1p-syncing");
      }
      return;
    }
    startManualSyncLockHeartbeat();
    const assertManualSyncLockOwned = (stage) => {
      assertSyncLockOwned(SYNC_LOCK_MODE_MANUAL, `force_push:${stage}`);
    };
    recordSyncAttempt("manual", "force_push");
    showMessage("正在向云端推送数据...", null);
    try {
      assertManualSyncLockOwned("before_export_local_data");
      const localData = await exportLocalDataObject();
      assertManualSyncLockOwned("before_push_remote_data");
      await pushRemoteData(localData);
      assertManualSyncLockOwned("after_push_remote_data");
      // [FIX] 强制推送后清除残留的清理标记
      GM_deleteValue("s1p_pending_cleanup_info");
      clearPendingAutoSyncRequest();
      clearAutoSyncConflictPause();
      GM_setValue("s1p_last_sync_timestamp", Date.now());
      setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_SUCCESS);
      resetAutoSyncFailureState();
      recordSyncSuccess("force_push", "manual");
      updateLastSyncTimeDisplay();
      showMessage("推送成功！已更新云端备份。", true);
    } catch (e) {
      if (e?.code === SYNC_LOCK_LOST_CODE) {
        showMessage("手动同步锁已失效，本次任务已中止，请重新发起同步。", false);
        return;
      }
      setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_FAILURE);
      recordSyncFailure(e.message, "manual");
      updateLastSyncTimeDisplay();
      showMessage(`推送失败: ${e.message}`, false);
    } finally {
      forceSyncInFlight = false;
      stopManualSyncLockHeartbeat();
      releaseManualSyncLock();
      if (icon) {
        icon.classList.remove("s1p-syncing");
        setTimeout(() => (icon.style.transform = ""), 1200); // 重置 transform
      }
    }
  };

  const handleForcePull = async () => {
    const icon = document.querySelector("#s1p-nav-sync-btn svg");
    if (icon) icon.classList.add("s1p-syncing");
    if (manualSyncInFlightPromise || forceSyncInFlight) {
      showMessage("手动同步正在进行，请稍候...", null);
      if (icon) {
        icon.classList.remove("s1p-syncing");
      }
      return;
    }
    forceSyncInFlight = true;
    if (!(await acquireManualSyncLock())) {
      showMessage("当前有其他同步任务正在执行，请稍后再试。", false);
      forceSyncInFlight = false;
      if (icon) {
        icon.classList.remove("s1p-syncing");
      }
      return;
    }
    startManualSyncLockHeartbeat();
    const assertManualSyncLockOwned = (stage) => {
      assertSyncLockOwned(SYNC_LOCK_MODE_MANUAL, `force_pull:${stage}`);
    };
    recordSyncAttempt("manual", "force_pull");
    showMessage("正在从云端拉取数据...", null);
    try {
      assertManualSyncLockOwned("before_fetch_remote_data");
      const { data: remoteData } = await fetchRemoteData();
      assertManualSyncLockOwned("after_fetch_remote_data");
      if (Object.keys(remoteData).length === 0) {
        throw new Error("云端没有数据，无法拉取。");
      }
      const validatedRemote = await migrateAndValidateRemoteData(remoteData);
      assertManualSyncLockOwned("before_import_local_data");
      // [S1P-FIX] 调用导入时，传入 suppressPostSync 选项来阻止不必要的二次同步
      const result = importLocalData(JSON.stringify(validatedRemote.full), {
        suppressPostSync: true,
      });
      assertManualSyncLockOwned("after_import_local_data");
      if (result.success) {
        // [FIX] 强制拉取成功后清除残留的清理标记
        GM_deleteValue("s1p_pending_cleanup_info");
        clearPendingAutoSyncRequest();
        clearAutoSyncConflictPause();
        GM_setValue("s1p_last_sync_timestamp", Date.now());
        setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_SUCCESS);
        resetAutoSyncFailureState();
        recordSyncSuccess("force_pull", "manual");
        updateLastSyncTimeDisplay();
        showMessage("拉取成功！页面即将刷新以应用新数据。", true);
        setTimeout(() => location.reload(), 1500);
      } else {
        throw new Error(result.message);
      }
    } catch (e) {
      if (e?.code === SYNC_LOCK_LOST_CODE) {
        showMessage("手动同步锁已失效，本次任务已中止，请重新发起同步。", false);
        return;
      }
      setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_FAILURE);
      recordSyncFailure(e.message, "manual");
      updateLastSyncTimeDisplay();
      showMessage(`拉取失败: ${e.message}`, false);
    } finally {
      forceSyncInFlight = false;
      stopManualSyncLockHeartbeat();
      releaseManualSyncLock();
      if (icon) {
        icon.classList.remove("s1p-syncing");
        setTimeout(() => (icon.style.transform = ""), 1200); // 重置 transform
      }
    }
  };

  const getAutoSyncIndicatorTitleByPhase = (phase) => {
    switch (phase) {
      case AUTO_SYNC_INDICATOR_PHASE_PENDING:
        return "后台自动同步：待同步";
      case AUTO_SYNC_INDICATOR_PHASE_RUNNING:
        return "后台自动同步：进行中";
      case AUTO_SYNC_INDICATOR_PHASE_SUCCESS:
        return "后台自动同步：已完成";
      case AUTO_SYNC_INDICATOR_PHASE_FAILURE:
        return "后台自动同步：失败（待下次同步）";
      case AUTO_SYNC_INDICATOR_PHASE_CONFLICT:
        return "后台自动同步：冲突（请手动同步）";
      case AUTO_SYNC_INDICATOR_PHASE_IDLE:
      default:
        return "后台自动同步：待命";
    }
  };

  const getAutoSyncIndicatorIconHtmlByPhase = (phase) => {
    switch (phase) {
      case AUTO_SYNC_INDICATOR_PHASE_PENDING:
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 16" fill="currentColor"><circle cx="4" cy="8" r="1.75"></circle><circle cx="10" cy="8" r="1.75"></circle><circle cx="16" cy="8" r="1.75"></circle></svg>`;
      case AUTO_SYNC_INDICATOR_PHASE_RUNNING:
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 16" fill="currentColor"><circle class="s1p-dot" cx="4" cy="8" r="1.75"></circle><circle class="s1p-dot" cx="10" cy="8" r="1.75"></circle><circle class="s1p-dot" cx="16" cy="8" r="1.75"></circle></svg>`;
      case AUTO_SYNC_INDICATOR_PHASE_SUCCESS:
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 1 22 22" fill="currentColor"><path d="M4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12ZM12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM17.4571 9.45711L16.0429 8.04289L11 13.0858L8.20711 10.2929L6.79289 11.7071L11 15.9142L17.4571 9.45711Z"></path></svg>`;
      case AUTO_SYNC_INDICATOR_PHASE_FAILURE:
      case AUTO_SYNC_INDICATOR_PHASE_CONFLICT:
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 1 22 22" fill="currentColor"><path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM7 11H17V13H7V11Z"></path></svg>`;
      case AUTO_SYNC_INDICATOR_PHASE_IDLE:
      default:
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="2.25"></circle></svg>`;
    }
  };

  const ensureNavbarAutoSyncIndicatorElement = () => {
    const settings = getSettings();
    const existingIndicator = document.getElementById("s1p-nav-auto-sync-indicator");
    const managerLink = document.getElementById("s1p-nav-link");
    if (
      !settings.syncRemoteEnabled ||
      !settings.syncAutoEnabled ||
      settings.syncShowAutoSyncIndicator !== true ||
      !managerLink
    ) {
      if (existingIndicator) {
        existingIndicator.remove();
      }
      return null;
    }

    if (existingIndicator) {
      return existingIndicator;
    }

    const li = document.createElement("li");
    li.id = "s1p-nav-auto-sync-indicator";
    li.setAttribute("aria-hidden", "true");
    const wrap = document.createElement("span");
    wrap.className = "s1p-nav-auto-sync-indicator-wrap";
    const icon = document.createElement("span");
    icon.className = "s1p-nav-auto-sync-indicator-icon";
    wrap.appendChild(icon);
    li.appendChild(wrap);

    const syncButton = document.getElementById("s1p-nav-sync-btn");
    if (syncButton) {
      syncButton.insertAdjacentElement("afterend", li);
    } else {
      managerLink.insertAdjacentElement("afterend", li);
    }

    return li;
  };

  const renderNavbarAutoSyncIndicator = (stateInput = null) => {
    const indicatorLi = ensureNavbarAutoSyncIndicatorElement();
    if (!indicatorLi) {
      return;
    }

    const iconHost = indicatorLi.querySelector(".s1p-nav-auto-sync-indicator-icon");
    if (!iconHost) {
      return;
    }

    const resolvedState = resolveAutoSyncIndicatorDisplayPhase(stateInput);
    const displayPhase =
      normalizeAutoSyncIndicatorPhase(resolvedState.displayPhase, {
        allowRunning: true,
      }) || AUTO_SYNC_INDICATOR_PHASE_IDLE;

    setSanitizedIconHtml(
      iconHost,
      getAutoSyncIndicatorIconHtmlByPhase(displayPhase)
    );
    const svg = iconHost.querySelector("svg");
    if (svg) {
      svg.classList.add(`s1p-auto-sync-${displayPhase}`);
    }

    indicatorLi.dataset.syncState = displayPhase;
    indicatorLi.title = getAutoSyncIndicatorTitleByPhase(displayPhase);
  };

  const initializeAutoSyncIndicatorCrossTabSync = () => {
    if (window.__s1pAutoSyncIndicatorCrossTabSyncBound) {
      return;
    }
    window.__s1pAutoSyncIndicatorCrossTabSyncBound = true;

    if (typeof GM_addValueChangeListener === "function") {
      GM_addValueChangeListener(
        AUTO_SYNC_INDICATOR_STATE_KEY,
        (_key, _oldValue, newValue, isCrossContextChange) => {
          const nextState = normalizeAutoSyncIndicatorState(newValue);
          const currentStateSnapshot = getAutoSyncIndicatorState();
          const differsFromCurrentCache = hasComparableValueChanged(
            currentStateSnapshot,
            nextState
          );
          if (
            !isCrossContextChange &&
            (autoSyncIndicatorWriteInFlightCount > 0 || !differsFromCurrentCache)
          ) {
            return;
          }
          renderNavbarAutoSyncIndicator(nextState);
        }
      );
    }

    const refreshIndicator = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      renderNavbarAutoSyncIndicator();
    };

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshIndicator();
      }
    });
    window.addEventListener("focus", refreshIndicator);
    window.addEventListener("pageshow", refreshIndicator);
  };

  const updateNavbarSyncButton = () => {
    const settings = getSettings();
    const existingBtnLi = document.getElementById("s1p-nav-sync-btn");
    const managerLink = document.getElementById("s1p-nav-link");

    if (!settings.syncRemoteEnabled) {
      if (existingBtnLi) existingBtnLi.remove();
      document.getElementById("s1p-nav-auto-sync-indicator")?.remove();
      return;
    }

    if (existingBtnLi || !managerLink) {
      renderNavbarAutoSyncIndicator();
      return;
    }

    const li = document.createElement("li");
    li.id = "s1p-nav-sync-btn";
    const a = document.createElement("a");
    a.href = "javascript:void(0);";
    // --- [核心修正] 恢复为原始的、基于“填充(fill)”的实心图标定义 ---
    setSanitizedIconHtml(
      a,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4C14.7486 4 17.1749 5.38626 18.6156 7.5H16V9.5H22V3.5H20V5.99936C18.1762 3.57166 15.2724 2 12 2C6.47715 2 2 6.47715 2 12H4C4 7.58172 7.58172 4 12 4ZM20 12C20 16.4183 16.4183 20 12 20C9.25144 20 6.82508 18.6137 5.38443 16.5H8V14.5H2V20.5H4V18.0006C5.82381 20.4283 8.72764 22 12 22C17.5228 22 22 17.5228 22 12H20Z"></path></svg>`
    );
    li.appendChild(a);

    if (settings.syncDirectChoiceMode) {
      // --- [MODIFIED] 模式2: 高级模式 (点击->智能判断 | 悬停->直接选择) ---
      let activeMenu = null;

      // [核心修改] 为高级模式下的按钮增加与默认模式完全相同的“点击”行为
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        const icon = a.querySelector("svg");
        if (!icon || icon.classList.contains("s1p-syncing")) return;

        icon.classList.remove("s1p-sync-success", "s1p-sync-error");
        icon.classList.add("s1p-syncing");

        try {
          // 调用我们已优化的核心同步函数
          await handleManualSync();
          // 注意：由于handleManualSync现在自己处理所有反馈，这里不再需要处理其返回值来增删图标class
          icon.classList.remove("s1p-syncing");
        } catch (error) {
          icon.classList.remove("s1p-syncing");
          console.error("S1 Plus: Manual sync handler threw an error:", error);
        } finally {
          // 移除动画类，并重置可能存在的transform
          setTimeout(() => {
            icon.classList.remove("s1p-sync-success", "s1p-sync-error");
            icon.style.transform = "";
          }, 1200);
        }
      });

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
                allowLabelHtml: true,
                action: "pull",
                title:
                  "用云端备份覆盖您当前的本地数据，本地未同步的修改将丢失！",
                callback: handleForcePull,
              },
              {
                label: `${pushIconSVG} <span>推送</span>`,
                allowLabelHtml: true,
                action: "push",
                title: "将您当前的本地数据覆盖到云端备份，此操作不可逆。",
                callback: handleForcePush,
              },
            ],
            () => {
              activeMenu = null;
            },
            {
              positionAnchorElement: a.querySelector("svg"),
              anchorGapPx: 8,
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

        try {
          // 调用我们已优化的核心同步函数
          await handleManualSync();
          icon.classList.remove("s1p-syncing");
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
    renderNavbarAutoSyncIndicator();
  };

  const ensureMyThreadsQuickLink = () => {
    const userMenuRoot = document.querySelector("#um");
    if (!userMenuRoot) {
      return;
    }

    const isLoggedIn = Boolean(
      userMenuRoot.querySelector('a[href^="member.php?mod=logging&action=logout"]') ||
      userMenuRoot.querySelector("strong.vwmy a")
    );
    if (!isLoggedIn) {
      userMenuRoot.querySelector("#s1p-my-threads-link")?.remove();
      return;
    }

    const threadListUrl = "https://stage1st.com/2b/home.php?mod=space&do=thread&view=me";
    const baseContainer = userMenuRoot.querySelector("p") || userMenuRoot;
    const existingLink = userMenuRoot.querySelector("#s1p-my-threads-link");

    const threadLink = existingLink || document.createElement("a");
    if (!existingLink) {
      threadLink.id = "s1p-my-threads-link";
      threadLink.textContent = "帖子";
      threadLink.title = "查看我的帖子";
      threadLink.setAttribute("hidefocus", "true");
    }
    if (threadLink.getAttribute("href") !== threadListUrl) {
      threadLink.setAttribute("href", threadListUrl);
    }

    const preferredAnchor = baseContainer.querySelector(
      'a[href="home.php?mod=spacecp"], #loginstatus, #myprompt, #pm_ntc'
    );
    if (preferredAnchor && preferredAnchor !== threadLink) {
      baseContainer.insertBefore(threadLink, preferredAnchor);
      return;
    }
    if (threadLink.parentElement !== baseContainer) {
      baseContainer.appendChild(threadLink);
    }
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
    document.getElementById("s1p-nav-auto-sync-indicator")?.remove();

    if (settings.enableNavCustomization) {
      navUl.textContent = "";
      normalizeCustomNavLinks(settings.customNavLinks).forEach((link) => {
        const linkName = String(link?.name ?? "").trim();
        const linkHref = getSafeUrlAttributeValue(link?.href, { allowEmpty: false });
        if (!linkName || !linkHref) return;
        const li = document.createElement("li");
        if (window.location.href.includes(linkHref)) li.className = "a";
        const a = document.createElement("a");
        a.href = linkHref;
        a.textContent = linkName;
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

    const restoreNodeChildren = (target, sourceSnapshot) => {
      const clone = sourceSnapshot.cloneNode(true);
      target.replaceChildren(...Array.from(clone.childNodes));
    };

    const allItems = Array.from(list.querySelectorAll(".s1p-item"));
    const itemCache = allItems.map((item) => {
      const contentEl = item.querySelector(".s1p-item-content");
      const metaEl = item.querySelector(".s1p-item-meta");
      const contentSnapshot = contentEl.cloneNode(true);
      const metaSnapshot = metaEl.cloneNode(true);

      return {
        element: item,
        searchableText: (
          contentEl.textContent +
          " " +
          metaEl.textContent
        ).toLowerCase(),
        contentEl: contentEl,
        metaEl: metaEl,
        contentSnapshot: contentSnapshot,
        metaSnapshot: metaSnapshot,
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

        // Reset highlights first by restoring original DOM snapshots
        restoreNodeChildren(item.contentEl, item.contentSnapshot);
        restoreNodeChildren(item.metaEl, item.metaSnapshot);
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

  const dismissExistingConfirmModal = (
    { reason = "replaced", immediate = true } = {}
  ) => {
    const existingModal = document.querySelector(".s1p-confirm-modal");
    if (!existingModal) {
      return;
    }
    if (
      existingModal.s1p_api &&
      typeof existingModal.s1p_api.dismiss === "function"
    ) {
      existingModal.s1p_api.dismiss({ reason, immediate });
    } else {
      existingModal.remove();
    }
  };

  const createConfirmationModal = (
    title,
    subtitle,
    onConfirm,
    confirmText = "确定",
    options = {}
  ) => {
    const { allowSubtitleHtml = false, onDismiss = null } = options;

    dismissExistingConfirmModal({ reason: "replaced", immediate: true });
    const modal = document.createElement("div");
    modal.className = "s1p-confirm-modal";

    const content = document.createElement("div");
    content.className = "s1p-confirm-content";

    const body = document.createElement("div");
    body.className = "s1p-confirm-body";

    const titleEl = document.createElement("div");
    titleEl.className = "s1p-confirm-title";
    titleEl.textContent = String(title ?? "");

    const subtitleEl = document.createElement("div");
    subtitleEl.className = "s1p-confirm-subtitle";
    if (allowSubtitleHtml) {
      subtitleEl.innerHTML = sanitizeSubtitleHtml(subtitle);
    } else {
      subtitleEl.textContent = String(subtitle ?? "");
    }

    body.appendChild(titleEl);
    body.appendChild(subtitleEl);

    const footer = document.createElement("div");
    footer.className = "s1p-confirm-footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "s1p-confirm-btn s1p-cancel";
    cancelBtn.textContent = "取消";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "s1p-confirm-btn s1p-confirm";
    confirmBtn.textContent = String(confirmText ?? "");

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    content.appendChild(body);
    content.appendChild(footer);
    modal.appendChild(content);

    let settled = false;
    let closing = false;
    const settleDismiss = (reason = "dismissed") => {
      if (settled) {
        return;
      }
      settled = true;
      if (typeof onDismiss === "function") {
        try {
          onDismiss(reason);
        } catch (error) {
          console.error("S1 Plus: 弹窗 onDismiss 执行失败。", error);
        }
      }
    };
    const closeModal = ({
      reason = "dismissed",
      invokeDismiss = true,
      immediate = false,
    } = {}) => {
      if (closing) {
        return;
      }
      if (invokeDismiss) {
        settleDismiss(reason);
      }
      closing = true;
      if (immediate) {
        modal.remove();
        return;
      }
      const confirmContent = modal.querySelector(".s1p-confirm-content");
      if (confirmContent) {
        confirmContent.style.animation = "s1p-scale-out 0.25s ease-out forwards";
      }
      modal.style.animation = "s1p-fade-out 0.25s ease-out forwards";
      setTimeout(() => modal.remove(), 250);
    };
    modal.s1p_api = {
      dismiss: ({ reason = "dismissed", immediate = false } = {}) =>
        closeModal({ reason, immediate, invokeDismiss: true }),
    };
    confirmBtn.addEventListener("click", () => {
      settled = true;
      try {
        onConfirm();
      } catch (error) {
        console.error("S1 Plus: 确认弹窗 onConfirm 执行失败。", error);
      } finally {
        closeModal({ invokeDismiss: false });
      }
    });
    cancelBtn.addEventListener("click", () => closeModal({ reason: "cancel" }));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeModal({ reason: "overlay_click" });
      }
    });
    document.body.appendChild(modal);
  };

  /**
   * [新增] 创建一个带输入的模态框
   */
  const createInputModal = (
    title,
    subtitle,
    defaultValue,
    onConfirm,
    confirmText = "确定",
    placeholder = "",
    options = {}
  ) => {
    const { allowSubtitleHtml = false, onDismiss = null } = options;

    dismissExistingConfirmModal({ reason: "replaced", immediate: true });
    const modal = document.createElement("div");
    modal.className = "s1p-confirm-modal";

    const content = document.createElement("div");
    content.className = "s1p-confirm-content";

    const body = document.createElement("div");
    body.className = "s1p-confirm-body";

    const titleEl = document.createElement("div");
    titleEl.className = "s1p-confirm-title";
    titleEl.textContent = String(title ?? "");

    const subtitleEl = document.createElement("div");
    subtitleEl.className = "s1p-confirm-subtitle";
    if (allowSubtitleHtml) {
      subtitleEl.innerHTML = sanitizeSubtitleHtml(subtitle);
    } else {
      subtitleEl.textContent = String(subtitle ?? "");
    }

    const input = document.createElement("textarea");
    input.className = "s1p-input s1p-confirm-input-field";
    input.placeholder = String(placeholder ?? "");
    input.style.width = "100%";
    input.style.marginTop = "12px";
    input.style.minHeight = "80px";
    input.style.resize = "vertical";
    input.style.fontFamily = "inherit";
    input.autocomplete = "off";
    input.value = String(defaultValue ?? "");

    body.appendChild(titleEl);
    body.appendChild(subtitleEl);
    body.appendChild(input);

    const footer = document.createElement("div");
    footer.className = "s1p-confirm-footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "s1p-confirm-btn s1p-cancel";
    cancelBtn.textContent = "取消";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "s1p-confirm-btn s1p-confirm";
    confirmBtn.textContent = String(confirmText ?? "");

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    content.appendChild(body);
    content.appendChild(footer);
    modal.appendChild(content);

    let settled = false;
    let closing = false;
    const settleDismiss = (reason = "dismissed") => {
      if (settled) {
        return;
      }
      settled = true;
      if (typeof onDismiss === "function") {
        try {
          onDismiss(reason);
        } catch (error) {
          console.error("S1 Plus: 弹窗 onDismiss 执行失败。", error);
        }
      }
    };
    const closeModal = ({
      reason = "dismissed",
      invokeDismiss = true,
      immediate = false,
    } = {}) => {
      if (closing) {
        return;
      }
      if (invokeDismiss) {
        settleDismiss(reason);
      }
      closing = true;
      if (immediate) {
        modal.remove();
        return;
      }
      const content = modal.querySelector(".s1p-confirm-content");
      if (content) {
        content.style.animation = "s1p-scale-out 0.25s ease-out forwards";
      }
      modal.style.animation = "s1p-fade-out 0.25s ease-out forwards";
      setTimeout(() => modal.remove(), 250);
    };
    modal.s1p_api = {
      dismiss: ({ reason = "dismissed", immediate = false } = {}) =>
        closeModal({ reason, immediate, invokeDismiss: true }),
    };

    // Auto focus and select slightly delayed to ensure DOM is ready and transition doesn't interfere
    setTimeout(() => {
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);

    // Enter to confirm (Ctrl+Enter or Command+Enter), Escape to cancel
    input.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        settled = true;
        try {
          onConfirm(input.value);
        } catch (error) {
          console.error("S1 Plus: 输入弹窗 onConfirm 执行失败。", error);
        } finally {
          closeModal({ invokeDismiss: false });
        }
      } else if (e.key === "Escape") {
        closeModal({ reason: "escape_key" });
      }
    });

    confirmBtn.addEventListener("click", () => {
      settled = true;
      try {
        onConfirm(input.value);
      } catch (error) {
        console.error("S1 Plus: 输入弹窗 onConfirm 执行失败。", error);
      } finally {
        closeModal({ invokeDismiss: false });
      }
    });
    cancelBtn.addEventListener("click", () => closeModal({ reason: "cancel" }));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeModal({ reason: "overlay_click" });
      }
    });
    document.body.appendChild(modal);
  };

  /**
   * [NEW] 创建一个通用的确认菜单内容结构
   * @param {string} confirmText - 确认提示文本
   * @param {object} options - 额外选项
   * @returns {HTMLElement} 返回包含内容的 div
   */
  const buildConfirmationMarkup = (confirmText, options = {}) => {
    const container = document.createElement("div");
    container.className = "s1p-confirm-container";
    const hasRemarkInput = Boolean(options.inputPlaceholder);
    const useTextFirstLayout =
      hasRemarkInput || options.actionLayout === "text-first";

    const bar = document.createElement("div");
    bar.className = "s1p-confirm-bar";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "s1p-confirm-action-btn s1p-confirm";
    confirmBtn.title = "确认";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "s1p-confirm-action-btn s1p-cancel";
    cancelBtn.title = "取消";

    const separator = document.createElement("span");
    separator.className = "s1p-confirm-separator";

    const text = document.createElement("span");
    text.className = "s1p-confirm-text";
    text.textContent = String(confirmText ?? "");

    if (hasRemarkInput) {
      bar.classList.add("s1p-has-expander");
      const expandBtn = document.createElement("button");
      expandBtn.type = "button";
      expandBtn.className = "s1p-confirm-expand-btn";

      const ns = "http://www.w3.org/2000/svg";
      const icon = document.createElementNS(ns, "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("width", "16");
      icon.setAttribute("height", "16");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("stroke-width", "2");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke-linecap", "round");
      icon.setAttribute("stroke-linejoin", "round");
      const polyline = document.createElementNS(ns, "polyline");
      polyline.setAttribute("points", "9 18 15 12 9 6");
      icon.appendChild(polyline);
      expandBtn.appendChild(icon);
      bar.appendChild(expandBtn);
    } else if (useTextFirstLayout) {
      bar.classList.add("s1p-confirm-bar-text-first");
    }

    if (useTextFirstLayout) {
      bar.appendChild(text);
      bar.appendChild(separator);
      bar.appendChild(cancelBtn);
      bar.appendChild(confirmBtn);
    } else {
      bar.appendChild(confirmBtn);
      bar.appendChild(cancelBtn);
      bar.appendChild(separator);
      bar.appendChild(text);
    }

    if (hasRemarkInput) {
      const barCard = document.createElement("div");
      barCard.className = "s1p-confirm-card s1p-confirm-bar-card";
      barCard.appendChild(bar);
      container.appendChild(barCard);
    } else {
      container.appendChild(bar);
    }

    if (hasRemarkInput) {
      const uniqueId = `s1p-confirm-${Date.now()}`;
      const remarkArea = document.createElement("div");
      remarkArea.className = "s1p-confirm-card s1p-confirm-remark-area";
      remarkArea.id = `${uniqueId}-remark-area`;

      const label = document.createElement("div");
      label.style.fontSize = "13px";
      label.style.marginBottom = "8px";
      label.style.color = "var(--s1p-t)";
      label.textContent = "备注：";

      const textarea = document.createElement("textarea");
      textarea.className = "s1p-confirm-input s1p-input";
      textarea.placeholder = String(options.inputPlaceholder);
      textarea.style.width = "100%";
      textarea.style.minWidth = "300px";
      textarea.style.minHeight = "80px";
      textarea.style.resize = "vertical";
      textarea.style.fontFamily = "inherit";
      textarea.style.boxSizing = "border-box";
      textarea.value = String(options.inputDefaultValue ?? "");

      remarkArea.appendChild(label);
      remarkArea.appendChild(textarea);
      container.appendChild(remarkArea);
    }

    return container;
  };

  const POPUP_SCOPE_POST_TOOLBAR = "post-toolbar";
  const POPUP_SCOPE_IMAGE_VIEWER = "image-viewer";
  const POST_TOOLBAR_ACTIONS_SELECTOR = ".s1p-authi-actions-wrapper";
  const IMAGE_VIEWER_ROOT_SELECTOR = ".s1p-image-viewer";
  const POST_TOOLBAR_POPUP_SELECTOR = [
    `.s1p-inline-confirm-menu[data-s1p-scope="${POPUP_SCOPE_POST_TOOLBAR}"]`,
    `.s1p-inline-action-menu[data-s1p-scope="${POPUP_SCOPE_POST_TOOLBAR}"]`,
    `.s1p-tag-options-menu[data-s1p-scope="${POPUP_SCOPE_POST_TOOLBAR}"]`,
  ].join(", ");

  const isPostToolbarAnchor = (anchorElement) =>
    Boolean(anchorElement?.closest?.(POST_TOOLBAR_ACTIONS_SELECTOR));
  const isImageViewerAnchor = (anchorElement) =>
    Boolean(anchorElement?.closest?.(IMAGE_VIEWER_ROOT_SELECTOR));
  const applyPostToolbarPopupScope = (popupElement, anchorElement) => {
    if (!(popupElement instanceof Element)) {
      return false;
    }
    const shouldUsePostToolbarScope = isPostToolbarAnchor(anchorElement);
    if (shouldUsePostToolbarScope) {
      popupElement.dataset.s1pScope = POPUP_SCOPE_POST_TOOLBAR;
      return true;
    }
    if (isImageViewerAnchor(anchorElement)) {
      popupElement.dataset.s1pScope = POPUP_SCOPE_IMAGE_VIEWER;
      return false;
    }
    delete popupElement.dataset.s1pScope;
    return false;
  };
  const markAsPostToolbarPopup = (popupElement) => {
    if (popupElement instanceof Element) {
      popupElement.dataset.s1pScope = POPUP_SCOPE_POST_TOOLBAR;
    }
  };

  const destroyPopupMenuImmediately = (menu) => {
    if (!(menu instanceof Element)) return;
    if (menu.s1p_api && typeof menu.s1p_api.destroy === "function") {
      try {
        menu.s1p_api.destroy({ immediate: true });
        return;
      } catch (error) {
        console.warn("S1 Plus: 二级菜单 destroy 失败，回退为直接移除。", error);
      }
    }
    menu.remove();
  };

  // 清理帖子工具栏相关二级弹窗，确保按钮切换时不会叠窗。
  const dismissToolbarSecondaryPopups = () => {
    document
      .querySelectorAll(POST_TOOLBAR_POPUP_SELECTOR)
      .forEach((menu) => destroyPopupMenuImmediately(menu));

    const tagPopover = document.getElementById("s1p-tag-popover-main");
    if (
      tagPopover &&
      tagPopover.dataset.s1pScope === POPUP_SCOPE_POST_TOOLBAR
    ) {
      if (tagPopover.s1p_api && typeof tagPopover.s1p_api.hide === "function") {
        tagPopover.s1p_api.hide();
      } else {
        tagPopover.classList.remove("visible");
      }
    }
  };

  /**
   * [MODIFIED] 创建一个行内确认菜单 (V2: 带智能定位和动画)
   * @param {HTMLElement} anchorElement - 锚点元素
   * @param {string} confirmText - 确认提示文本
   * @param {Function} onConfirm - 点击确认后执行的回调函数
   * @param {object} options - 额外选项
   */
  const createInlineConfirmMenu = (
    anchorElement,
    confirmText,
    onConfirm,
    options = {}
  ) => {
    const existingInlineConfirmMenu = document.querySelector(
      ".s1p-inline-confirm-menu"
    );
    if (existingInlineConfirmMenu) {
      if (
        existingInlineConfirmMenu.s1p_api &&
        typeof existingInlineConfirmMenu.s1p_api.destroy === "function"
      ) {
        existingInlineConfirmMenu.s1p_api.destroy({ immediate: true });
      } else {
        existingInlineConfirmMenu.remove();
      }
    }

    const menu = document.createElement("div");
    menu.className = "s1p-options-menu s1p-inline-confirm-menu s1p-confirm-wrapper";
    const resolvedOptions = { ...options };
    const isAnchorInAuthiActions = applyPostToolbarPopupScope(
      menu,
      anchorElement
    );
    if (!resolvedOptions.actionLayout && isAnchorInAuthiActions) {
      resolvedOptions.actionLayout = "text-first";
    }
    const hasRemarkInput = Boolean(resolvedOptions.inputPlaceholder);
    if (hasRemarkInput) {
      menu.classList.add("s1p-has-remark-input");
    }
    menu.style.width = "max-content";

    const content = buildConfirmationMarkup(confirmText, resolvedOptions);
    menu.appendChild(content);

    const cancelBtn = menu.querySelector(".s1p-cancel");
    const confirmBtn = menu.querySelector(".s1p-confirm");

    document.body.appendChild(menu);
    const anchorRect = anchorElement.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    const top =
      anchorRect.top +
      window.scrollY +
      anchorRect.height / 2 -
      menuRect.height / 2; // 初步居中，后续可能需要微调

    // 重新计算 left，确保包含展开后的潜在宽度（虽然初始是隐藏的，但尽量留足空间）
    let left;
    const spaceOnRight = window.innerWidth - anchorRect.right;
    const requiredSpace = 320; // 预估展开后的宽度

    if (spaceOnRight >= requiredSpace) {
      left = anchorRect.right + window.scrollX + 8;
    } else {
      // 作为一个简单的策略，如果右边放不下，就放左边
      // 但实际上左边可能也放不下... 这里暂时维持原逻辑，优先保证主菜单可见
      left = anchorRect.left + window.scrollX - menuRect.width - 8;
    }

    if (left < window.scrollX) {
      left = window.scrollX + 8;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    // Logic for Expand Button
    if (hasRemarkInput) {
      const expandBtn = menu.querySelector(".s1p-confirm-expand-btn");
      const remarkArea = menu.querySelector(".s1p-confirm-remark-area");

      if (expandBtn && remarkArea) {
        let closeAnimationEndHandler = null;
        const clearCloseAnimationEndHandler = () => {
          if (closeAnimationEndHandler) {
            remarkArea.removeEventListener("animationend", closeAnimationEndHandler);
            closeAnimationEndHandler = null;
          }
        };
        const setRemarkExpandedState = (expanded) => {
          expandBtn.classList.toggle("expanded", expanded);
          expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
          remarkArea.dataset.expanded = expanded ? "true" : "false";
        };
        const collapseRemarkArea = () => {
          clearCloseAnimationEndHandler();
          setRemarkExpandedState(false);
          remarkArea.classList.add("closing");
          remarkArea.style.animation = "s1p-fade-out-up 0.2s ease forwards";
          closeAnimationEndHandler = () => {
            remarkArea.style.display = "none";
            remarkArea.classList.remove("closing");
            remarkArea.style.animation = "";
            clearCloseAnimationEndHandler();
          };
          remarkArea.addEventListener("animationend", closeAnimationEndHandler, {
            once: true,
          });
        };
        const expandRemarkArea = () => {
          clearCloseAnimationEndHandler();
          remarkArea.classList.remove("closing");
          remarkArea.style.display = "block";
          remarkArea.style.animation = "s1p-fade-in-down 0.2s ease forwards";
          setRemarkExpandedState(true);
          const textarea = remarkArea.querySelector("textarea");
          if (textarea) {
            requestAnimationFrame(() => textarea.focus());
          }
        };
        remarkArea.style.display = "none";
        setRemarkExpandedState(false);

        expandBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isExpanded =
            remarkArea.dataset.expanded === "true" &&
            !remarkArea.classList.contains("closing");

          if (isExpanded) {
            collapseRemarkArea();
          } else {
            expandRemarkArea();
          }
        });

        // Prevent clicks inside remark area from closing the menu
        remarkArea.addEventListener("click", (e) => {
          e.stopPropagation();
        });
      }
    }

    let isClosing = false;
    let closeMenuOnClick = null;
    let bindDocumentClickTimer = null;
    const closeMenu = ({ immediate = false } = {}) => {
      if (isClosing) return;
      isClosing = true;
      if (bindDocumentClickTimer) {
        clearTimeout(bindDocumentClickTimer);
        bindDocumentClickTimer = null;
      }
      document.removeEventListener("click", closeMenuOnClick);
      if (immediate) {
        if (menu.parentNode) {
          menu.remove();
        }
        return;
      }
      menu.classList.remove("visible");

      setTimeout(() => {
        if (menu.parentNode) {
          menu.remove();
        }
      }, 200);
    };

    closeMenuOnClick = (e) => {
      if (!menu.contains(e.target)) {
        closeMenu();
      }
    };

    menu.s1p_api = {
      destroy: ({ immediate = true } = {}) => closeMenu({ immediate }),
    };

    bindDocumentClickTimer = setTimeout(() => {
      bindDocumentClickTimer = null;
      if (!isClosing) {
        document.addEventListener("click", closeMenuOnClick);
      }
    }, 0);

    menu.querySelector(".s1p-confirm").addEventListener("click", (e) => {
      e.stopPropagation();
      const remarkTextarea = menu.querySelector(".s1p-confirm-remark-area textarea");
      const inputValue = remarkTextarea ? remarkTextarea.value.trim() : undefined;
      try {
        onConfirm(inputValue);
      } catch (error) {
        console.error("S1 Plus: 行内确认菜单 onConfirm 执行失败。", error);
      } finally {
        closeMenu();
      }
    });

    menu.querySelector(".s1p-cancel").addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
    });

    requestAnimationFrame(() => {
      menu.classList.add("visible");
    });
  };

  const removeProgressJumpButtons = () =>
    document
      .querySelectorAll(".s1p-progress-container")
      .forEach((el) => el.remove());
  const removeBlockButtonsFromThreads = () => {
    document
      .querySelectorAll(
        ".s1p-options-cell, .s1p-header-placeholder, .s1p-separator-placeholder"
      )
      .forEach((el) => el.remove());

    // 兼容旧版本：历史上分隔行补位单元格未打 class，兜底收敛到原始列数(5)。
    const separatorRow = document.querySelector("#separatorline > tr.ts");
    if (separatorRow) {
      while (separatorRow.childElementCount > 5) {
        separatorRow.lastElementChild?.remove();
      }
    }
  };

  const refreshUserPostsOnPage = (userId) => {
    const normalizedUserId = normalizeNumericId(userId);
    if (!normalizedUserId) return;
    document
      .querySelectorAll('.authi a[href*="space-uid-"]')
      .forEach((userLink) => {
        if (extractUidFromProfileHref(userLink.href) !== normalizedUserId) {
          return;
        }
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
      // --- [核心修正] 动画参数现在由JS直接控制 ---
      // 您可以在这里轻松修改动画时长，单位是秒(s)
      const animationDuration = "0.45s";
      const animationEasing = "cubic-bezier(0.4, 0, 0.2, 1)";
      // ---------------------------------------------

      const tabContainerRect = tabContainer.getBoundingClientRect();
      const activeTabRect = activeTab.getBoundingClientRect();
      const newWidth = activeTabRect.width;
      const newLeft = activeTabRect.left - tabContainerRect.left;

      // 1. 在下一帧，立即为滑块应用过渡动画效果
      requestAnimationFrame(() => {
        slider.style.transition = `width ${animationDuration} ${animationEasing}, transform ${animationDuration} ${animationEasing}`;

        // 2. 紧接着，设置滑块的目标宽度和位置，这将触发动画
        slider.style.width = `${newWidth.toFixed(3)}px`;
        slider.style.transform = `translateX(${newLeft.toFixed(3)}px)`;
      });

      // 保持 transition 内联样式，避免频繁重算时堆积 transitionend 监听器。
    }
  };
  const scheduleTabSliderSync = (tabContainer) => {
    if (!tabContainer) return;
    const syncSliderPosition = () => {
      if (tabContainer.isConnected) {
        moveTabSlider(tabContainer);
      }
    };

    // 首次渲染时布局可能还在收敛，连续校准几次可避免“刚打开/截图时”尺寸偏差。
    syncSliderPosition();
    requestAnimationFrame(syncSliderPosition);
    setTimeout(syncSliderPosition, 120);

    const fontsReady = document.fonts && document.fonts.ready;
    if (fontsReady && typeof fontsReady.then === "function") {
      fontsReady.then(syncSliderPosition).catch(() => {});
    }
  };

  /**
   * [新增] 自定义日期选择器逻辑 (Portal 模式，挂载到 body 以避免被截断)
   * @param {HTMLElement} inputEl - 触发和显示日期的输入框
   * @param {Date} initialDate - 初始日期
   * @param {Function} onSelect - 选择回调
   */
  const createDatePicker = (inputEl, initialDate, onSelect) => {
    let currentDate = new Date(initialDate); // 当前浏览的月份
    let selectedDate = new Date(initialDate); // 当前选中的日期
    let picker = null;

    const render = () => {
      // 懒加载：初次渲染时创建 DOM
      if (!picker) {
        picker = document.createElement("div");
        picker.className = "s1p-date-picker";
        document.body.appendChild(picker);

        picker.addEventListener("click", (e) => e.stopPropagation());
      }

      const year = currentDate.getFullYear();
      const month = currentDate.getMonth(); // 0-11

      // 头部
      const header = document.createElement("div");
      header.className = "s1p-dp-header";
      const createNavBtn = (cls, title, html) => {
        const btn = document.createElement("button");
        btn.className = `s1p-dp-nav-btn ${cls}`;
        btn.title = title;
        setSanitizedIconHtml(btn, html);
        return btn;
      };
      const leftArrowSvg =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">` +
        `<path d="M15 19l-7-7 7-7" /></svg>`;
      const rightArrowSvg =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">` +
        `<path d="M9 5l7 7-7 7" /></svg>`;
      const prevYearHtml =
        leftArrowSvg +
        `<span class="s1p-dp-year-arrow-offset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 19l-7-7 7-7" /></svg></span>`;
      const nextYearHtml =
        rightArrowSvg +
        `<span class="s1p-dp-year-arrow-offset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7" /></svg></span>`;

      const prevYearBtn = createNavBtn("prev-year", "上一年", prevYearHtml);
      const prevMonthBtn = createNavBtn("prev-month", "上个月", leftArrowSvg);
      const nextMonthBtn = createNavBtn("next-month", "下个月", rightArrowSvg);
      const nextYearBtn = createNavBtn("next-year", "下一年", nextYearHtml);

      const titleEl = document.createElement("div");
      titleEl.className = "s1p-dp-title";
      titleEl.textContent = `${year}年 ${month + 1}月`;

      header.appendChild(prevYearBtn);
      header.appendChild(prevMonthBtn);
      header.appendChild(titleEl);
      header.appendChild(nextMonthBtn);
      header.appendChild(nextYearBtn);

      // 星期头
      const weekdays = document.createElement("div");
      weekdays.className = "s1p-dp-weekdays";
      ["日", "一", "二", "三", "四", "五", "六"].forEach(d => {
        const el = document.createElement("div");
        el.className = "s1p-dp-weekday";
        el.textContent = d;
        weekdays.appendChild(el);
      });

      // 日期网格
      const daysGrid = document.createElement("div");
      daysGrid.className = "s1p-dp-days";

      // 计算
      const firstDay = new Date(year, month, 1).getDay(); // 当月第一天是星期几
      const daysInMonth = new Date(year, month + 1, 0).getDate(); // 当月总天数
      const daysInPrevMonth = new Date(year, month, 0).getDate(); // 上月总天数

      // 填充上月
      for (let i = 0; i < firstDay; i++) {
        const d = daysInPrevMonth - firstDay + i + 1;
        const el = document.createElement("div");
        el.className = "s1p-dp-day other-month";
        el.textContent = d;
        el.addEventListener("click", () => {
          currentDate.setMonth(month - 1);
          currentDate.setDate(d);
          render();
          updatePosition(); // 重新渲染后保持位置
        });
        daysGrid.appendChild(el);
      }

      // 填充当月
      const today = new Date();
      for (let i = 1; i <= daysInMonth; i++) {
        const el = document.createElement("div");
        el.className = "s1p-dp-day";
        el.textContent = i;

        // 选中状态
        if (selectedDate &&
          selectedDate.getFullYear() === year &&
          selectedDate.getMonth() === month &&
          selectedDate.getDate() === i) {
          el.classList.add("selected");
        }

        // 今天
        if (today.getFullYear() === year && today.getMonth() === month && today.getDate() === i) {
          el.classList.add("today");
        }

        el.addEventListener("click", (e) => {
          e.stopPropagation();
          // 更新选中日期
          selectedDate = new Date(year, month, i);
          if (onSelect) onSelect(selectedDate);
          close();
        });
        daysGrid.appendChild(el);
      }

      // 填充下月 (补齐42格)
      const totalCells = firstDay + daysInMonth;
      const nextMonthDays = 42 - totalCells;
      for (let i = 1; i <= nextMonthDays; i++) {
        const el = document.createElement("div");
        el.className = "s1p-dp-day other-month";
        el.textContent = i;
        el.addEventListener("click", () => {
          currentDate.setMonth(month + 1);
          render();
          updatePosition();
        });
        daysGrid.appendChild(el);
      }

      picker.textContent = "";
      picker.appendChild(header);
      picker.appendChild(weekdays);
      picker.appendChild(daysGrid);

      // 绑定导航事件
      picker.querySelector(".prev-month").addEventListener("click", (e) => { e.stopPropagation(); currentDate.setMonth(month - 1); render(); updatePosition(); });
      picker.querySelector(".next-month").addEventListener("click", (e) => { e.stopPropagation(); currentDate.setMonth(month + 1); render(); updatePosition(); });
      picker.querySelector(".prev-year").addEventListener("click", (e) => { e.stopPropagation(); currentDate.setFullYear(year - 1); render(); updatePosition(); });
      picker.querySelector(".next-year").addEventListener("click", (e) => { e.stopPropagation(); currentDate.setFullYear(year + 1); render(); updatePosition(); });
    };

    const updatePosition = () => {
      if (!picker) return;
      const rect = inputEl.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

      // 默认显示在下方
      let top = rect.bottom + scrollTop + 8;
      let left = rect.left + scrollLeft;

      // 简单的边界检查 (如果下方空间不足，则显示在上方 - 可选优化)
      // 暂且统一显示在下方，zIndex 足够高即可

      picker.style.top = top + "px";
      picker.style.left = left + "px";
    };

    const open = () => {
      render(); // 确保 picker 存在
      updatePosition();
      picker.classList.add("visible");

      // 使用 requestAnimationFrame 避免点击事件直接触发 document 的关闭监听
      requestAnimationFrame(() => {
        document.addEventListener("click", handleOutsideClick);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true); // 捕获滚动
      });
    };

    const close = () => {
      if (picker) {
        picker.classList.remove("visible");
        // 稍微延迟移除 DOM 以便动画播放，或者保留 DOM 仅隐藏？
        // 这里选择保留 DOM 但隐藏
      }
      document.removeEventListener("click", handleOutsideClick);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };

    const handleOutsideClick = (e) => {
      if (picker && !picker.contains(e.target) && e.target !== inputEl) {
        close();
      }
    };

    // 销毁方法 (例如模态框关闭时)
    const destroy = () => {
      close();
      if (picker) {
        picker.remove();
        picker = null;
      }
    };

    inputEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (picker && picker.classList.contains("visible")) {
        close();
      } else {
        open();
      }
    });

    // 不需要立即 render，点击时再 render 即可

    return {
      updateDate: (d) => {
        selectedDate = new Date(d);
        currentDate = new Date(d);
        if (picker && picker.classList.contains("visible")) {
          render();
        }
      },
      destroy: destroy
    };
  };

  /**
   * [新增] 打开 Token 有效期配置模态框
   * @param {Function} onSave - 保存后的回调，接收选定的时间戳
   * @param {Function} onCancel - 取消后的回调
   */
  const openTokenExpiryConfigModal = (onSave, onCancel) => {
    const currentSettings = getSettings();
    // [FIX] 不移除现有的设置面板 (.s1p-modal)，而是叠加一个新的模态框
    // document.querySelector(".s1p-modal")?.remove(); 

    const modal = document.createElement("div");
    modal.className = "s1p-token-config-modal"; // [FIX] 使用不同的类名以避免冲突 (CSS需适配或复用样式)

    // 默认过期日期：优先读取已保存的配置
    let defaultDate;
    const savedExpiryTimestamp = Number(currentSettings.syncTokenExpiryDate);
    if (
      Number.isFinite(savedExpiryTimestamp) &&
      savedExpiryTimestamp > 0
    ) {
      defaultDate = new Date(savedExpiryTimestamp);
    } else {
      defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + 30);
    }
    const formatDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    modal.innerHTML = `
        <div class="s1p-modal-content s1p-token-config-content">
            <div class="s1p-modal-header s1p-token-config-header">
                <div class="s1p-modal-title s1p-token-config-title">设置 Token 有效期</div>
                <div class="s1p-modal-close"></div>
            </div>
            <div class="s1p-modal-body s1p-token-config-body">
                <p class="s1p-setting-desc s1p-token-config-desc">请设置您的 GitHub Personal Access Token 的过期时间，以便脚本在过期前提醒您。</p>
                
                <div class="s1p-settings-item s1p-token-config-date-item">
                    <label class="s1p-settings-label">过期日期</label>
                    <input type="text" id="s1p-token-expiry-date-input" class="s1p-input s1p-token-config-date-input" value="${formatDate(defaultDate)}" readonly placeholder="点击选择日期">
                </div>

                <div class="s1p-settings-group s1p-token-config-quick-buttons">
                    <button class="s1p-btn s1p-quick-date-btn" data-days="30">30天后</button>
                    <button class="s1p-btn s1p-quick-date-btn" data-days="60">60天后</button>
                    <button class="s1p-btn s1p-quick-date-btn" data-days="90">90天后</button>
                     <button class="s1p-btn s1p-quick-date-btn" data-days="365">1年后</button>
                </div>
            </div>
             <div class="s1p-modal-footer s1p-token-config-footer">
                 <button class="s1p-btn s1p-cancel-btn">取消</button>
                 <button class="s1p-btn s1p-confirm-btn s1p-primary">保存</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // 动画显示
    requestAnimationFrame(() => {
      modal.style.opacity = "1";
    });

    const close = () => {
      modal.style.opacity = "0";
      setTimeout(() => modal.remove(), 200);
      if (onCancel) onCancel();
      // [FIX] 销毁日历实例
      if (dp) dp.destroy();
    };

    // 成功保存时不调 onCancel
    const closeOnSave = () => {
      modal.style.opacity = "0";
      setTimeout(() => modal.remove(), 200);
      // [FIX] 销毁日历实例
      if (dp) dp.destroy();
    };

    modal.querySelector(".s1p-modal-close").addEventListener("click", close);
    modal.querySelector(".s1p-cancel-btn").addEventListener("click", close);

    const dateInput = modal.querySelector("#s1p-token-expiry-date-input");

    // [NEW] 初始化自定义日期选择器
    let currentSelectedDate = defaultDate;
    const dp = createDatePicker(dateInput, defaultDate, (date) => {
      currentSelectedDate = date;
      dateInput.value = formatDate(date);
    });

    // 快捷按钮逻辑
    modal.querySelectorAll(".s1p-quick-date-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const days = parseInt(btn.dataset.days);
        const date = new Date();
        date.setDate(date.getDate() + days);

        // 更新输入框和选择器状态
        dateInput.value = formatDate(date);
        currentSelectedDate = date;
        dp.updateDate(date);
      });
    });

    modal.querySelector(".s1p-confirm-btn").addEventListener("click", () => {
      // 将日期转换为当天的结束时间 (23:59:59) 以避免时区造成的提前过期
      const expiryDate = new Date(currentSelectedDate);
      expiryDate.setHours(23, 59, 59, 999);
      const timestamp = expiryDate.getTime();

      if (timestamp < Date.now()) {
        showMessage("过期日期不能早于当前时间", false);
        return;
      }

      if (onSave) onSave(timestamp);

      closeOnSave();
    });
  };


  const createManagementModal = () => {
    const calculateModalWidth = () => {
      const measureContainer = document.createElement("div");
      measureContainer.style.cssText =
        "position: absolute; left: -9999px; top: -9999px; visibility: hidden; pointer-events: none;";

      const tabsDiv = document.createElement("div");
      tabsDiv.className = "s1p-tabs";
      tabsDiv.style.display = "inline-flex";
      [
        "通用设置",
        "帖子屏蔽",
        "用户屏蔽",
        "用户标记",
        "回复收藏",
        "导航栏定制",
        "设置同步",
      ].forEach((text) => {
        const btn = document.createElement("button");
        btn.className = "s1p-tab-btn";
        btn.textContent = text;
        tabsDiv.appendChild(btn);
      });
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

      return totalTabsWidth + 32;
    };
    const shouldAutoFitModalWidth =
      window.innerWidth > NARROW_SCREEN_MAX_WIDTH_PX;
    const requiredWidth = shouldAutoFitModalWidth ? calculateModalWidth() : 0;
    settingsModalCrossTabSyncController = null;
    document.querySelector(".s1p-modal")?.remove();
    const buildSyncSettingsTabHtml = () => `
      <div class="s1p-settings-group">
        <div class="s1p-settings-group-title s1p-settings-section-title-label">本地备份与恢复</div>
        <div class="s1p-local-sync-desc">通过手动复制/粘贴数据，在不同浏览器或设备间迁移或备份你的所有S1 Plus配置，包括屏蔽列表、导航栏、阅读进度和各项开关设置。</div>
        <div class="s1p-local-sync-buttons">
          <button id="s1p-local-export-btn" class="s1p-btn">导出数据</button>
          <button id="s1p-local-import-btn" class="s1p-btn">导入数据</button>
        </div>
        <textarea id="s1p-local-sync-textarea" class="s1p-input s1p-textarea s1p-sync-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据" autocomplete="off"></textarea>
      </div>

      <div class="s1p-settings-group">
        <div class="s1p-settings-group-title s1p-settings-section-title-label">远程同步 (通过GitHub Gist)</div>
        <div id="s1p-last-sync-time-container" class="s1p-setting-desc s1p-sync-last-sync-time"></div>
        <div id="s1p-sync-diagnostics-wrapper" class="s1p-settings-sub-group s1p-diag-wrapper s1p-hidden">
          <div class="s1p-settings-item s1p-diag-header">
            <label class="s1p-settings-label">同步诊断信息</label>
            <div class="s1p-diag-actions">
              <button id="s1p-sync-diagnostics-copy-btn" class="s1p-btn s1p-diag-btn" type="button">复制诊断</button>
              <button id="s1p-sync-diagnostics-reset-btn" class="s1p-btn s1p-diag-btn" type="button">重置诊断</button>
            </div>
          </div>
          <div id="s1p-sync-diagnostics-panel" class="s1p-diag-panel"></div>
        </div>
        <div class="s1p-settings-item">
          <label class="s1p-settings-label" for="s1p-remote-enabled-toggle">启用远程同步</label>
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

          <div id="s1p-force-pull-subgroup" class="s1p-settings-sub-group">
            <div class="s1p-settings-item">
              <label class="s1p-settings-label" for="s1p-force-pull-on-startup-toggle">启动时强制拉取云端数据</label>
              <label class="s1p-switch">
                <input type="checkbox" id="s1p-force-pull-on-startup-toggle" class="s1p-settings-checkbox" data-s1p-sync-control>
                <span class="s1p-slider"></span>
              </label>
            </div>
            <p class="s1p-setting-desc s1p-warning-text">开启后，每日首次加载时若检测到云端与本地数据不一致，将总是使用云端数据覆盖本地，不再进行提示。请谨慎开启，这可能导致本地未同步的修改丢失。</p>
          </div>
          <div class="s1p-settings-item">
            <label class="s1p-settings-label" for="s1p-auto-sync-enabled-toggle">启用自动后台同步</label>
            <label class="s1p-switch">
              <input type="checkbox" id="s1p-auto-sync-enabled-toggle" class="s1p-settings-checkbox" data-s1p-sync-control>
              <span class="s1p-slider"></span>
            </label>
          </div>
          <p class="s1p-setting-desc">启用后，数据将在停止操作5秒后自动同步。关闭后将切换为纯手动同步模式。</p>
          <div id="s1p-auto-sync-indicator-subgroup" class="s1p-settings-sub-group">
            <div class="s1p-settings-item">
              <label class="s1p-settings-label" for="s1p-show-auto-sync-indicator-toggle">显示后台同步状态指示器</label>
              <label class="s1p-switch">
                <input type="checkbox" id="s1p-show-auto-sync-indicator-toggle" class="s1p-settings-checkbox" data-s1p-sync-control>
                <span class="s1p-slider"></span>
              </label>
            </div>
            <p class="s1p-setting-desc">开启后，将在导航栏显示后台自动同步状态（待命/同步中/完成/异常）。</p>
          </div>
          <div class="s1p-settings-item">
            <label class="s1p-settings-label" for="s1p-direct-choice-mode-toggle">启用手动同步高级模式 (悬停选择)</label>
            <label class="s1p-switch">
              <input type="checkbox" id="s1p-direct-choice-mode-toggle" class="s1p-settings-checkbox">
              <span class="s1p-slider"></span>
            </label>
          </div>
          <p class="s1p-setting-desc">关闭时，点击同步按钮将智能判断；开启时，悬停同步按钮可直接选择推送或拉取。</p>
          <div class="s1p-settings-item">
            <label class="s1p-settings-label" for="s1p-sync-bookmark-full-content-toggle">收藏回复同步完整正文</label>
            <label class="s1p-switch">
              <input type="checkbox" id="s1p-sync-bookmark-full-content-toggle" class="s1p-settings-checkbox" data-s1p-sync-control>
              <span class="s1p-slider"></span>
            </label>
          </div>
          <p class="s1p-setting-desc">关闭时仅同步 280 字预览（更快更省流量）；开启后会同步完整收藏内容（跨设备可查看全文，但体积更大）。</p>
          <div class="s1p-settings-item s1p-settings-item-column">
            <label class="s1p-settings-label" for="s1p-remote-gist-id-input">Gist ID</label>
            <input type="text" id="s1p-remote-gist-id-input" class="s1p-input s1p-input-full" placeholder="从 Gist 网址中复制的那一长串 ID" autocomplete="off" data-s1p-sync-control>
          </div>
          <div class="s1p-settings-item s1p-settings-item-column s1p-settings-item-top12">
            <label class="s1p-settings-label" for="s1p-remote-pat-input">GitHub Personal Access Token (PAT)</label>
            <div class="s1p-relative-full">
              <input type="password" id="s1p-remote-pat-input" class="s1p-input s1p-input-with-right-icon" placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" autocomplete="new-password" data-s1p-sync-control>
              <button id="s1p-toggle-pat-visibility" type="button" class="s1p-icon-btn-overlay">
                ${SVG_ICON_EYE}
              </button>
            </div>
          </div>
          <div class="s1p-settings-item s1p-settings-item-top12">
            <label class="s1p-settings-label" for="s1p-token-expiry-reminder-toggle">Sync Token 更新提醒</label>
            <label class="s1p-switch">
              <input type="checkbox" id="s1p-token-expiry-reminder-toggle" class="s1p-settings-checkbox" data-s1p-sync-control>
              <span class="s1p-slider"></span>
            </label>
          </div>
          <p class="s1p-setting-desc">开启后会在 Token 到期前三天弹窗提醒</p>
          <div id="s1p-token-expiry-info-container" class="s1p-setting-desc s1p-sync-token-expiry-info"></div>
          <div class="s1p-notice">
            <div class="s1p-notice-icon"></div>
            <div class="s1p-notice-content">
              <a href="https://silver-s1plus.netlify.app/" target="_blank" rel="noopener noreferrer">点击此处查看设置教程</a>
              <p>Token只会保存在你的浏览器本地，不会上传到任何地方。</p>
            </div>
          </div>
          <p class="s1p-setting-desc s1p-setting-desc-save-hint">以上同步配置修改后，需点击“保存设置”才会生效。</p>
          <div class="s1p-editor-footer s1p-sync-footer-actions">
            <button id="s1p-remote-save-btn" class="s1p-btn" data-s1p-sync-control>保存设置</button>
            <button id="s1p-remote-manual-sync-btn" class="s1p-btn" data-s1p-sync-control>手动同步</button>
            <button id="s1p-open-gist-page-btn" class="s1p-btn" data-s1p-sync-control>打开 Gist 页面</button>
          </div>
        </div>
      </div>

      <div class="s1p-settings-group">
        <div class="s1p-settings-group-title s1p-settings-section-title-label">危险操作</div>
        <div class="s1p-local-sync-desc">以下操作会立即清空脚本在<b>当前浏览器</b>中的所选数据，且无法撤销。请在操作前务必通过“导出数据”功能进行备份。</div>
        <div id="s1p-clear-data-options" class="s1p-clear-data-options"></div>
        <div class="s1p-clear-data-footer">
          <div class="s1p-clear-data-select-all">
            <label class="s1p-settings-label" for="s1p-clear-select-all">全选</label>
            <label class="s1p-switch">
              <input type="checkbox" id="s1p-clear-select-all">
              <span class="s1p-slider"></span>
            </label>
          </div>
          <button id="s1p-clear-selected-btn" class="s1p-btn s1p-red-btn">清除选中数据</button>
        </div>
      </div>
    `;

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
                <div id="s1p-tab-sync" class="s1p-tab-content"></div>
            </div>
            <div class="s1p-modal-footer">版本: ${SCRIPT_VERSION} (${SCRIPT_RELEASE_DATE})</div>
        </div>`;

    const modalContent = modal.querySelector(".s1p-modal-content");
    if (shouldAutoFitModalWidth && requiredWidth > 600) {
      modalContent.style.width = `${requiredWidth}px`;
    }

    document.body.appendChild(modal);
    const syncNuxThemeModalStyles = () => {
      if (!modal.isConnected) {
        return;
      }
      applyNuxSegmentedContrastFix(modal);
      applyNuxVineTabToneFix(modal);
    };
    syncNuxThemeModalStyles();
    let modalThemeSyncTimer = window.setInterval(syncNuxThemeModalStyles, 350);

    const tabs = {
      "general-settings": modal.querySelector("#s1p-tab-general-settings"),
      threads: modal.querySelector("#s1p-tab-threads"),
      users: modal.querySelector("#s1p-tab-users"),
      tags: modal.querySelector("#s1p-tab-tags"),
      bookmarks: modal.querySelector("#s1p-tab-bookmarks"),
      "nav-settings": modal.querySelector("#s1p-tab-nav-settings"),
      sync: modal.querySelector("#s1p-tab-sync"),
    };
    let bookmarkTabClickHandler = null;
    let userTabClickHandler = null;
    let threadTabClickHandler = null;
    let navSettingsTabClickHandler = null;
    const formatListSummaryText = (count, itemLabel = "条记录") => {
      const safeCount = Math.max(0, Number(count) || 0);
      return `当前共 ${safeCount} ${itemLabel}`;
    };
    const buildListSummaryHtml = (summaryId, count, itemLabel) => {
      const safeCount = Math.max(0, Number(count) || 0);
      const hiddenClass = safeCount > 0 ? "" : " s1p-hidden";
      return `<div id="${summaryId}" class="s1p-list-summary${hiddenClass}">${formatListSummaryText(
        safeCount,
        itemLabel
      )}</div>`;
    };
    const setListSummaryText = (summaryId, count, itemLabel) => {
      const summaryEl = modal.querySelector(`#${summaryId}`);
      if (!summaryEl) {
        return;
      }
      const safeCount = Math.max(0, Number(count) || 0);
      summaryEl.classList.toggle("s1p-hidden", safeCount <= 0);
      if (safeCount > 0) {
        summaryEl.textContent = formatListSummaryText(safeCount, itemLabel);
      }
    };
    const rebindTabClickHandler = (tabElement, previousHandler, nextHandler) => {
      if (previousHandler) {
        tabElement.removeEventListener("click", previousHandler);
      }
      tabElement.addEventListener("click", nextHandler);
      return nextHandler;
    };
    const buildPrimaryFeatureToggleHtml = ({
      id,
      featureKey,
      label,
      checked = false,
    }) => `
      <div class="s1p-settings-group">
        <div class="s1p-settings-item s1p-feature-toggle-item">
          <label class="s1p-settings-label s1p-settings-section-title-label" for="${id}">${label}</label>
          <label class="s1p-switch">
            <input type="checkbox" id="${id}" data-feature="${featureKey}" class="s1p-feature-toggle" ${checked ? "checked" : ""
      }>
            <span class="s1p-slider"></span>
          </label>
        </div>
      </div>
    `;
    const renderSyncTab = () => {
      tabs["sync"].innerHTML = buildSyncSettingsTabHtml();
    };
    renderSyncTab();
    updateLastSyncTimeDisplay();
    const SETTINGS_MODAL_DIRTY_TAB = Object.freeze({
      THREAD_RULES: "thread_rules",
      NAV_SETTINGS: "nav_settings",
      SYNC_SETTINGS: "sync_settings",
    });
    const settingsModalDirtyState = {
      [SETTINGS_MODAL_DIRTY_TAB.THREAD_RULES]: false,
      [SETTINGS_MODAL_DIRTY_TAB.NAV_SETTINGS]: false,
      [SETTINGS_MODAL_DIRTY_TAB.SYNC_SETTINGS]: false,
    };
    let lastSettingsModalDirtyNoticeAt = 0;
    const SETTINGS_MODAL_DIRTY_NOTICE_COOLDOWN_MS = 5000;
    const setSettingsModalDirtyState = (tabKey, isDirty = true) => {
      if (!tabKey) {
        return;
      }
      settingsModalDirtyState[tabKey] = isDirty === true;
    };
    const isSettingsModalDirty = (tabKey) =>
      tabKey ? settingsModalDirtyState[tabKey] === true : false;
    const notifySettingsModalDirtyTabDeferredRefresh = (tabLabels = []) => {
      if (!Array.isArray(tabLabels) || tabLabels.length === 0) {
        return;
      }
      const now = Date.now();
      if (
        now - lastSettingsModalDirtyNoticeAt <
        SETTINGS_MODAL_DIRTY_NOTICE_COOLDOWN_MS
      ) {
        return;
      }
      lastSettingsModalDirtyNoticeAt = now;
      const uniqueLabels = Array.from(
        new Set(
          tabLabels
            .map((label) => String(label || "").trim())
            .filter((label) => label)
        )
      );
      if (uniqueLabels.length === 0) {
        return;
      }
      showMessage(
        `检测到其他标签页设置变更，已保留当前未保存编辑（${uniqueLabels.join("、")}）。请先保存后再查看最新状态。`,
        null
      );
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
      clearDataOptionsContainer.textContent = "";
      Object.keys(dataClearanceConfig).forEach((key) => {
        const item = document.createElement("div");
        item.className = "s1p-settings-item";
        item.style.padding = "8px 0";

        const label = document.createElement("label");
        label.className = "s1p-settings-label";
        label.htmlFor = `s1p-clear-chk-${key}`;
        label.textContent = String(dataClearanceConfig[key].label || "");

        const switchLabel = document.createElement("label");
        switchLabel.className = "s1p-switch";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "s1p-clear-data-checkbox";
        checkbox.id = `s1p-clear-chk-${key}`;
        checkbox.dataset.clearKey = key;

        const slider = document.createElement("span");
        slider.className = "s1p-slider";

        switchLabel.appendChild(checkbox);
        switchLabel.appendChild(slider);
        item.appendChild(label);
        item.appendChild(switchLabel);
        clearDataOptionsContainer.appendChild(item);
      });
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
          const shouldKeepEnabled = el.id === "s1p-remote-save-btn";
          el.disabled = shouldKeepEnabled ? false : !isMasterEnabled;
        });
    };

    // [MODIFIED] Start of changes
    const dailySyncToggle = modal.querySelector(
      "#s1p-daily-first-load-sync-enabled-toggle"
    );
    const autoSyncToggle = modal.querySelector("#s1p-auto-sync-enabled-toggle");
    const autoSyncIndicatorToggle = modal.querySelector(
      "#s1p-show-auto-sync-indicator-toggle"
    );
    const autoSyncIndicatorSubGroup = modal.querySelector(
      "#s1p-auto-sync-indicator-subgroup"
    );
    const bookmarkFullContentToggle = modal.querySelector(
      "#s1p-sync-bookmark-full-content-toggle"
    );
    const remoteGistIdInput = modal.querySelector("#s1p-remote-gist-id-input");
    const remotePatInput = modal.querySelector("#s1p-remote-pat-input");
    const forcePullWrapper = modal.querySelector("#s1p-force-pull-subgroup");
    const forcePullToggle = modal.querySelector(
      "#s1p-force-pull-on-startup-toggle"
    );
    const markSyncSettingsDirty = () =>
      setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.SYNC_SETTINGS, true);

    const updateForcePullState = () => {
      const isDailySyncEnabled = dailySyncToggle.checked;
      if (isDailySyncEnabled) {
        forcePullWrapper.style.opacity = "1";
        forcePullWrapper.style.pointerEvents = "auto";
        forcePullToggle.disabled = false;
      } else {
        forcePullWrapper.style.opacity = "0.5";
        forcePullWrapper.style.pointerEvents = "none";
        forcePullToggle.disabled = true;
      }
    };

    const updateAutoSyncIndicatorToggleState = () => {
      const isEnabled =
        remoteToggle.checked === true && autoSyncToggle.checked === true;
      if (autoSyncIndicatorSubGroup) {
        autoSyncIndicatorSubGroup.classList.toggle("is-disabled", !isEnabled);
      }
      autoSyncIndicatorToggle.disabled = !isEnabled;
    };

    dailySyncToggle.addEventListener("change", updateForcePullState);
    autoSyncToggle.addEventListener("change", updateAutoSyncIndicatorToggleState);
    // End of changes

    const settings = getSettings();
    remoteToggle.checked = settings.syncRemoteEnabled;
    const syncDiagnosticsWrapper = modal.querySelector(
      "#s1p-sync-diagnostics-wrapper"
    );
    let isSyncDiagnosticsVisible = false;
    const setSyncDiagnosticsVisible = (visible) => {
      if (!syncDiagnosticsWrapper) return;
      isSyncDiagnosticsVisible = visible;
      syncDiagnosticsWrapper.classList.toggle("s1p-hidden", !visible);
      if (visible) {
        updateSyncDiagnosticsPanel();
      }
    };
    setSyncDiagnosticsVisible(false);

    const versionFooter = modal.querySelector(".s1p-modal-footer");
    if (versionFooter) {
      let versionClickCount = 0;
      let versionClickTimer = null;
      versionFooter.addEventListener("click", () => {
        versionClickCount += 1;
        if (versionClickTimer) {
          clearTimeout(versionClickTimer);
        }
        if (versionClickCount >= 3) {
          versionClickCount = 0;
          const nextVisible = !isSyncDiagnosticsVisible;
          setSyncDiagnosticsVisible(nextVisible);
          showMessage(
            nextVisible
              ? "同步诊断信息已启用（仅当前设置窗口）。"
              : "同步诊断信息已隐藏。",
            true
          );
          return;
        }
        versionClickTimer = setTimeout(() => {
          versionClickCount = 0;
          versionClickTimer = null;
        }, 1200);
      });
    }

    const directChoiceModeToggle = modal.querySelector(
      "#s1p-direct-choice-mode-toggle"
    );
    if (directChoiceModeToggle) {
      directChoiceModeToggle.checked = settings.syncDirectChoiceMode;
    }

    dailySyncToggle.checked = settings.syncDailyFirstLoad;
    autoSyncToggle.checked = settings.syncAutoEnabled;
    autoSyncIndicatorToggle.checked = settings.syncShowAutoSyncIndicator !== false;
    bookmarkFullContentToggle.checked = settings.syncBookmarkFullContent;
    forcePullToggle.checked = settings.syncForcePullOnStartup;
    remoteGistIdInput.value = settings.syncRemoteGistId || "";
    remotePatInput.value = settings.syncRemotePat || "";

    remoteToggle.addEventListener("change", () => {
      updateRemoteSyncInputsState();
      updateAutoSyncIndicatorToggleState();
    });
    const bindDirtyListenerForTextInput = (inputControl) => {
      inputControl.addEventListener("input", markSyncSettingsDirty);
      inputControl.addEventListener("change", markSyncSettingsDirty);
    };
    [
      remoteToggle,
      dailySyncToggle,
      autoSyncToggle,
      autoSyncIndicatorToggle,
      forcePullToggle,
      directChoiceModeToggle,
      bookmarkFullContentToggle,
    ].forEach((toggleControl) =>
      toggleControl?.addEventListener("change", markSyncSettingsDirty)
    );
    bindDirtyListenerForTextInput(remoteGistIdInput);
    bindDirtyListenerForTextInput(remotePatInput);

    // [新增] Token 过期提醒逻辑
    const tokenExpiryToggle = modal.querySelector("#s1p-token-expiry-reminder-toggle");
    const normalizeTokenExpiryDateValue = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    let pendingTokenExpiryDate = normalizeTokenExpiryDateValue(
      settings.syncTokenExpiryDate
    );
    const applyPendingTokenExpiryDate = (value, { markDirty = true } = {}) => {
      const normalizedTimestamp = normalizeTokenExpiryDateValue(value);
      if (normalizedTimestamp === null) {
        return false;
      }
      if (!Object.is(pendingTokenExpiryDate, normalizedTimestamp)) {
        pendingTokenExpiryDate = normalizedTimestamp;
        if (markDirty) {
          markSyncSettingsDirty();
        }
      }
      return true;
    };
    const markSyncSettingsDirtyAndRefreshTokenExpiryInfo = () => {
      markSyncSettingsDirty();
      updateTokenExpiryInfo();
    };
    const updateTokenExpiryInfo = () => {
      const infoContainer = modal.querySelector("#s1p-token-expiry-info-container");
      const expiryTimestamp = pendingTokenExpiryDate;

      infoContainer.textContent = "";
      if (
        tokenExpiryToggle.checked &&
        Number.isFinite(expiryTimestamp) &&
        expiryTimestamp > 0
      ) {
        const date = new Date(expiryTimestamp);
        const dateStr = date.toLocaleDateString("zh-CN");
        const daysLeft = Math.ceil((expiryTimestamp - Date.now()) / (1000 * 60 * 60 * 24));
        const color = daysLeft <= 3 ? "var(--s1p-red)" : "var(--s1p-success-text)";

        infoContainer.appendChild(document.createTextNode("过期时间："));
        const dateEl = document.createElement("span");
        dateEl.style.fontWeight = "bold";
        dateEl.style.color = color;
        dateEl.textContent = dateStr;
        infoContainer.appendChild(dateEl);
        infoContainer.appendChild(
          document.createTextNode(` (剩余 ${daysLeft} 天) `)
        );

        const editBtn = document.createElement("button");
        editBtn.id = "s1p-edit-token-expiry";
        editBtn.className = "s1p-btn";
        editBtn.style.marginLeft = "8px";
        editBtn.style.padding = "2px 8px";
        editBtn.style.fontSize = "12px";
        editBtn.style.height = "auto";
        editBtn.textContent = "修改";
        infoContainer.appendChild(editBtn);

        editBtn.addEventListener("click", () => {
          openTokenExpiryConfigModal((ts) => {
            if (!applyPendingTokenExpiryDate(ts)) {
              return;
            }
            tokenExpiryToggle.checked = true;
            updateTokenExpiryInfo();
          });
        });
      }
    };

    tokenExpiryToggle.checked = settings.syncTokenExpiryEnabled || false;
    tokenExpiryToggle.addEventListener("change", (e) => {
      const isChecked = e.target.checked === true;

      if (isChecked) {
        if (!pendingTokenExpiryDate) {
          openTokenExpiryConfigModal((ts) => {
            if (!applyPendingTokenExpiryDate(ts)) {
              e.target.checked = false;
              updateTokenExpiryInfo();
              return;
            }
            e.target.checked = true;
            updateTokenExpiryInfo();
          }, () => {
            e.target.checked = false;
            updateTokenExpiryInfo();
          });
        } else {
          markSyncSettingsDirtyAndRefreshTokenExpiryInfo();
        }
      } else {
        markSyncSettingsDirtyAndRefreshTokenExpiryInfo();
      }
    });
    updateTokenExpiryInfo();

    const setModalCheckedControl = (selector, checked) => {
      const control = modal.querySelector(selector);
      if (!control) {
        return;
      }
      const nextChecked = checked === true;
      if (control.checked !== nextChecked) {
        control.checked = nextChecked;
      }
    };
    const setModalInputValue = (selector, value) => {
      const control = modal.querySelector(selector);
      if (!control) {
        return;
      }
      const nextValue = String(value ?? "");
      if (control.value !== nextValue) {
        control.value = nextValue;
      }
    };
    const refreshSyncTabControlsFromSettings = () => {
      const latestSettings = getSettings();
      setModalCheckedControl(
        "#s1p-remote-enabled-toggle",
        latestSettings.syncRemoteEnabled
      );
      setModalCheckedControl(
        "#s1p-daily-first-load-sync-enabled-toggle",
        latestSettings.syncDailyFirstLoad
      );
      setModalCheckedControl(
        "#s1p-auto-sync-enabled-toggle",
        latestSettings.syncAutoEnabled
      );
      setModalCheckedControl(
        "#s1p-show-auto-sync-indicator-toggle",
        latestSettings.syncShowAutoSyncIndicator !== false
      );
      setModalCheckedControl(
        "#s1p-sync-bookmark-full-content-toggle",
        latestSettings.syncBookmarkFullContent
      );
      setModalCheckedControl(
        "#s1p-force-pull-on-startup-toggle",
        latestSettings.syncForcePullOnStartup
      );
      setModalCheckedControl(
        "#s1p-token-expiry-reminder-toggle",
        latestSettings.syncTokenExpiryEnabled
      );
      applyPendingTokenExpiryDate(latestSettings.syncTokenExpiryDate, {
        markDirty: false,
      });
      setModalCheckedControl(
        "#s1p-direct-choice-mode-toggle",
        latestSettings.syncDirectChoiceMode
      );
      setModalInputValue("#s1p-remote-gist-id-input", latestSettings.syncRemoteGistId);
      setModalInputValue("#s1p-remote-pat-input", latestSettings.syncRemotePat);
      updateRemoteSyncInputsState();
      updateForcePullState();
      updateAutoSyncIndicatorToggleState();
      updateTokenExpiryInfo();
    };

    updateRemoteSyncInputsState();
    updateForcePullState(); // [MODIFIED] 初始化子选项的状态
    updateAutoSyncIndicatorToggleState();

    const renderTagsTab = (options = {}) => {
      const editingUserId = options.editingUserId;
      const settings = getSettings();
      const isEnabled = settings.enableUserTagging;

      const toggleHTML = buildPrimaryFeatureToggleHtml({
        id: "s1p-enableUserTagging",
        featureKey: "enableUserTagging",
        label: "启用用户标记功能",
        checked: isEnabled,
      });
      const userTags = getUserTags();
      const tagItems = Object.entries(userTags).sort(
        ([, a], [, b]) => (b.timestamp || 0) - (a.timestamp || 0)
      );
      tabs["tags"].innerHTML = `
                ${toggleHTML}
                <div class="s1p-feature-content ${isEnabled ? "expanded" : ""}">
                    <div>
	                        <div class="s1p-settings-group">
	                            <div class="s1p-settings-group-title">用户标记管理</div>
                            <p class="s1p-setting-desc s1p-setting-desc-top0-bottom16">
                                在此集中管理、编辑、导出或导入您为所有用户添加的标记。
                            </p>
                            <div class="s1p-local-sync-buttons">
                                <button id="s1p-export-tags-btn" class="s1p-btn">导出全部标记</button>
                                <button id="s1p-import-tags-btn" class="s1p-btn">导入标记</button>
                            </div>
                            <textarea id="s1p-tags-sync-textarea" class="s1p-input s1p-textarea s1p-sync-textarea" placeholder="在此粘贴导入数据或从此处复制导出数据..." autocomplete="off"></textarea>
                        </div>

	                        <div class="s1p-settings-group">
	                            ${buildListSummaryHtml(
                                "s1p-tags-list-summary",
                                tagItems.length,
                                "条用户标记"
                              )}
	                            <div id="s1p-tags-list-container"></div>
	                        </div>
	                    </div>
	                </div>
	            `;

      const listContainer = tabs["tags"].querySelector("#s1p-tags-list-container");
      if (listContainer) {
        if (tagItems.length === 0) {
          const emptyEl = document.createElement("div");
          emptyEl.className = "s1p-empty";
          emptyEl.textContent = "暂无用户标记";
          listContainer.appendChild(emptyEl);
        } else {
          const listEl = document.createElement("div");
          listEl.className = "s1p-list";
          const colors = ["", "red", "orange", "yellow", "green", "blue", "purple"];
          const checkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

          tagItems.forEach(([id, data]) => {
            const item = document.createElement("div");
            item.className = "s1p-item";
            item.dataset.userId = String(id ?? "");

            const itemInfo = document.createElement("div");
            itemInfo.className = "s1p-item-info";

            const title = document.createElement("div");
            title.className = "s1p-item-title";
            const displayName = String(data?.name || `用户 #${id}`);
            title.textContent = displayName;
            itemInfo.appendChild(title);

            const meta = document.createElement("div");
            meta.className = "s1p-item-meta";
            meta.appendChild(document.createTextNode("ID: "));

            const idSpan = document.createElement("span");
            idSpan.className = "s1p-item-meta-id";
            idSpan.textContent = String(id ?? "");
            meta.appendChild(idSpan);

            if (id !== editingUserId) {
              meta.appendChild(document.createTextNode(" \u00A0 标记于: "));
              meta.appendChild(
                document.createTextNode(formatDate(data?.timestamp || Date.now()))
              );
            }
            itemInfo.appendChild(meta);

            const actions = document.createElement("div");
            actions.className = "s1p-item-actions";

            if (id === editingUserId) {
              item.dataset.currentColor = String(data?.color || "");

              const editor = document.createElement("div");
              editor.className = "s1p-item-editor";

              const textarea = document.createElement("textarea");
              textarea.className = "s1p-input s1p-textarea s1p-tag-edit-area";
              textarea.autocomplete = "off";
              textarea.value = String(data?.tag || "");
              editor.appendChild(textarea);

              const colorPicker = document.createElement("div");
              colorPicker.className = "s1p-color-picker";
              colorPicker.style.marginTop = "8px";

              const colorLabel = document.createElement("span");
              colorLabel.className = "s1p-color-picker-label";
              colorLabel.textContent = "标记颜色：";
              colorPicker.appendChild(colorLabel);

              const colorOptions = document.createElement("div");
              colorOptions.className = "s1p-color-options";
              colors.forEach((color) => {
                const option = document.createElement("span");
                option.className = "s1p-color-option";
                option.dataset.color = color;
                if (color === (data?.color || "")) {
                  option.classList.add("selected");
                }
                setSanitizedIconHtml(option, checkSvg);
                colorOptions.appendChild(option);
              });
              colorPicker.appendChild(colorOptions);
              editor.appendChild(colorPicker);
              itemInfo.appendChild(editor);

              const saveBtn = document.createElement("button");
              saveBtn.className = "s1p-btn s1p-primary";
              saveBtn.dataset.action = "save-tag-edit";
              saveBtn.dataset.userId = String(id ?? "");
              saveBtn.dataset.userName = displayName;
              saveBtn.textContent = "保存";
              actions.appendChild(saveBtn);

              const cancelBtn = document.createElement("button");
              cancelBtn.className = "s1p-btn";
              cancelBtn.dataset.action = "cancel-tag-edit";
              cancelBtn.textContent = "取消";
              actions.appendChild(cancelBtn);
            } else {
              const content = document.createElement("div");
              content.className = "s1p-item-content";

              if (data?.color) {
                const colorDot = document.createElement("span");
                colorDot.className = "s1p-color-option";
                colorDot.dataset.color = String(data.color);
                colorDot.style.width = "14px";
                colorDot.style.height = "14px";
                colorDot.style.display = "inline-block";
                colorDot.style.verticalAlign = "middle";
                colorDot.style.marginRight = "6px";
                colorDot.style.pointerEvents = "none";
                content.appendChild(colorDot);
              }
              content.appendChild(
                document.createTextNode(`用户标记：${String(data?.tag || "")}`)
              );
              itemInfo.appendChild(content);

              const editBtn = document.createElement("button");
              editBtn.className = "s1p-btn";
              editBtn.dataset.action = "edit-tag-item";
              editBtn.dataset.userId = String(id ?? "");
              editBtn.textContent = "编辑";
              actions.appendChild(editBtn);

              const deleteBtn = document.createElement("button");
              deleteBtn.className = "s1p-btn s1p-danger";
              deleteBtn.dataset.action = "delete-tag-item";
              deleteBtn.dataset.userId = String(id ?? "");
              deleteBtn.dataset.userName = displayName;
              deleteBtn.textContent = "删除";
              actions.appendChild(deleteBtn);
            }

            item.appendChild(itemInfo);
            item.appendChild(actions);
            listEl.appendChild(item);
          });

          listContainer.appendChild(listEl);
        }
      }

      if (editingUserId) {
        const textarea = tabs["tags"].querySelector(".s1p-tag-edit-area");
        if (textarea) {
          textarea.focus();
          textarea.selectionStart = textarea.selectionEnd =
            textarea.value.length;
        }
        // 颜色选择器点击事件
        tabs["tags"].querySelectorAll(".s1p-color-option").forEach(opt => {
          opt.addEventListener("click", () => {
            tabs["tags"].querySelectorAll(".s1p-color-option").forEach(o => o.classList.remove("selected"));
            opt.classList.add("selected");
          });
        });
      }
    };
    const renderBookmarksTab = () => {
      const settings = getSettings();
      const isEnabled = settings.enableBookmarkReplies;

      const toggleHTML = buildPrimaryFeatureToggleHtml({
        id: "s1p-enableBookmarkReplies",
        featureKey: "enableBookmarkReplies",
        label: "启用回复收藏功能",
        checked: isEnabled,
      });
      const bookmarkedReplies = getBookmarkedReplies();
      const bookmarkItems = Object.values(bookmarkedReplies).sort(
        (a, b) => b.timestamp - a.timestamp
      );

      const hasBookmarks = bookmarkItems.length > 0;
      tabs["bookmarks"].innerHTML = `
                ${toggleHTML}
                <div class="s1p-feature-content ${isEnabled ? "expanded" : ""}">
                    <div>
	                        ${hasBookmarks
	          ? `
	                        <div class="s1p-settings-group s1p-settings-group-margin-bottom16">
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
	                        <div class="s1p-settings-group">
		                            ${buildListSummaryHtml(
	                                "s1p-bookmarks-list-summary",
	                                bookmarkItems.length,
	                                "条收藏回复"
	                              )}
		                            <div id="s1p-bookmarks-list-container"></div>
		                            <div id="s1p-bookmarks-no-results" class="s1p-empty s1p-hidden">没有找到匹配的收藏</div>
		                        </div>
		                    </div>
		                </div>
            `;

      const bookmarksContainer = tabs["bookmarks"].querySelector(
        "#s1p-bookmarks-list-container"
      );
      if (bookmarksContainer) {
        if (!hasBookmarks) {
          const emptyEl = document.createElement("div");
          emptyEl.id = "s1p-bookmarks-empty-message";
          emptyEl.className = "s1p-empty";
          emptyEl.textContent = "暂无收藏的回复";
          bookmarksContainer.appendChild(emptyEl);
        } else {
          const listEl = document.createElement("div");
          listEl.className = "s1p-list";
          listEl.id = "s1p-bookmarks-list";

          bookmarkItems.forEach((item) => {
            const rawPostId = String(item?.postId ?? "");
            const postIdForUrl = encodeURIComponent(rawPostId);
            const threadIdForUrl = encodeURIComponent(String(item?.threadId ?? ""));
            const authorName = String(item?.authorName || `用户 #${item?.authorId ?? "?"}`);
            const threadTitle = String(item?.threadTitle || "");
            const localFullText = String(item?.postContent || "");
            const previewText = String(item?.contentPreview || "");
            const fullText = localFullText || previewText;
            const displayText = fullText || "无法获取内容";
            const canExpand = localFullText.length > 150;

            const rowEl = document.createElement("div");
            rowEl.className = "s1p-item";
            rowEl.dataset.postId = rawPostId;
            rowEl.style.position = "relative";

            const removeBtn = document.createElement("button");
            removeBtn.className = "s1p-btn s1p-danger";
            removeBtn.dataset.action = "remove-bookmark";
            removeBtn.dataset.postId = rawPostId;
            removeBtn.style.position = "absolute";
            removeBtn.style.top = "12px";
            removeBtn.style.right = "12px";
            removeBtn.style.padding = "4px 8px";
            removeBtn.textContent = "取消收藏";
            rowEl.appendChild(removeBtn);

            const infoEl = document.createElement("div");
            infoEl.className = "s1p-item-info";
            infoEl.style.width = "100%";
            infoEl.style.paddingRight = "100px";

            const contentEl = document.createElement("div");
            contentEl.className = "s1p-item-content";

            const previewEl = document.createElement("div");
            previewEl.className = "s1p-bookmark-preview";
            const previewTextSpan = document.createElement("span");
            previewTextSpan.textContent = canExpand
              ? `${fullText.substring(0, 150)}... `
              : displayText;
            previewEl.appendChild(previewTextSpan);

            if (canExpand) {
              const showFullLink = document.createElement("a");
              showFullLink.href = "javascript:void(0);";
              showFullLink.className = "s1p-bookmark-toggle";
              showFullLink.dataset.action = "toggle-bookmark-content";
              showFullLink.textContent = "查看完整回复";
              previewEl.appendChild(showFullLink);
            }
            contentEl.appendChild(previewEl);

            if (canExpand) {
              const fullEl = document.createElement("div");
              fullEl.className = "s1p-bookmark-full";
              fullEl.style.display = "none";

              const fullTextSpan = document.createElement("span");
              fullTextSpan.textContent = `${fullText} `;
              fullEl.appendChild(fullTextSpan);

              const collapseLink = document.createElement("a");
              collapseLink.href = "javascript:void(0);";
              collapseLink.className = "s1p-bookmark-toggle";
              collapseLink.dataset.action = "toggle-bookmark-content";
              collapseLink.textContent = "收起";
              fullEl.appendChild(collapseLink);
              contentEl.appendChild(fullEl);
            }

            infoEl.appendChild(contentEl);

            const metaEl = document.createElement("div");
            metaEl.className = "s1p-item-meta";
            metaEl.style.marginTop = "10px";

            const authorEl = document.createElement("strong");
            authorEl.textContent = authorName;
            metaEl.appendChild(authorEl);
            metaEl.appendChild(
              document.createTextNode(` · 收藏于: ${formatDate(item?.timestamp)}`)
            );

            const metaLine = document.createElement("div");
            metaLine.className = "s1p-bookmark-meta-line";

            const fromLabel = document.createElement("span");
            fromLabel.textContent = "来自：";
            metaLine.appendChild(fromLabel);

            const threadLink = document.createElement("a");
            threadLink.className = "s1p-bookmark-thread-link";
            threadLink.href = `forum.php?mod=redirect&goto=findpost&ptid=${threadIdForUrl}&pid=${postIdForUrl}`;
            threadLink.target = "_blank";
            threadLink.title = threadTitle;

            const threadTitleEl = document.createElement("span");
            threadTitleEl.className = "s1p-bookmark-title-text";
            threadTitleEl.textContent = threadTitle;
            threadLink.appendChild(threadTitleEl);

            const linkIcon = document.createElement("span");
            setSanitizedIconHtml(linkIcon, SVG_ICON_EXTERNAL_LINK);
            threadLink.appendChild(linkIcon.firstElementChild || linkIcon);

            metaLine.appendChild(threadLink);
            metaEl.appendChild(metaLine);
            infoEl.appendChild(metaEl);

            rowEl.appendChild(infoEl);
            listEl.appendChild(rowEl);
          });

          bookmarksContainer.appendChild(listEl);
        }
      }

      bookmarkTabClickHandler = rebindTabClickHandler(
        tabs["bookmarks"],
        bookmarkTabClickHandler,
        (e) => {
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
        }
      );
      if (hasBookmarks) {
        setupBookmarkSearchComponent(tabs["bookmarks"]);
      }
    };
    const openManualUserBlockModal = (
      defaultUsername = "",
      defaultRemark = ""
    ) => {
      dismissExistingConfirmModal({ reason: "replaced", immediate: true });

      const modal = document.createElement("div");
      modal.className = "s1p-confirm-modal";

      const content = document.createElement("div");
      content.className = "s1p-confirm-content";

      const body = document.createElement("div");
      body.className = "s1p-confirm-body";

      const titleEl = document.createElement("div");
      titleEl.className = "s1p-confirm-title";
      titleEl.textContent = "手动屏蔽用户";

      const subtitleEl = document.createElement("div");
      subtitleEl.className = "s1p-confirm-subtitle";
      subtitleEl.textContent = "输入用户名后，脚本会自动识别 UID，并支持备注。";

      const form = document.createElement("div");
      form.className = "s1p-manual-block-form";

      const usernameField = document.createElement("div");
      usernameField.className = "s1p-manual-block-field";
      const usernameLabel = document.createElement("div");
      usernameLabel.className = "s1p-manual-block-field-label";
      usernameLabel.textContent = "用户名：";
      const usernameInput = document.createElement("input");
      usernameInput.type = "text";
      usernameInput.className = "s1p-input";
      usernameInput.placeholder = "输入用户名（支持 @用户名）";
      usernameInput.autocomplete = "off";
      usernameInput.value = String(defaultUsername || "");
      usernameField.appendChild(usernameLabel);
      usernameField.appendChild(usernameInput);

      const remarkField = document.createElement("div");
      remarkField.className = "s1p-manual-block-field";
      const remarkLabel = document.createElement("div");
      remarkLabel.className = "s1p-manual-block-field-label";
      remarkLabel.textContent = "备注：";
      const remarkInput = document.createElement("textarea");
      remarkInput.className = "s1p-input s1p-manual-block-remark-input";
      remarkInput.placeholder = "添加备注（可选）";
      remarkInput.value = String(defaultRemark || "");
      remarkField.appendChild(remarkLabel);
      remarkField.appendChild(remarkInput);

      form.appendChild(usernameField);
      form.appendChild(remarkField);

      body.appendChild(titleEl);
      body.appendChild(subtitleEl);
      body.appendChild(form);

      const footer = document.createElement("div");
      footer.className = "s1p-confirm-footer";

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "s1p-confirm-btn s1p-cancel";
      cancelBtn.textContent = "取消";

      const confirmBtn = document.createElement("button");
      confirmBtn.className = "s1p-confirm-btn s1p-confirm";
      confirmBtn.textContent = "确认屏蔽";

      footer.appendChild(cancelBtn);
      footer.appendChild(confirmBtn);

      content.appendChild(body);
      content.appendChild(footer);
      modal.appendChild(content);

      let isClosing = false;
      let isSubmitting = false;
      const closeModal = ({ immediate = false } = {}) => {
        if (isClosing) return;
        isClosing = true;
        if (immediate) {
          modal.remove();
          return;
        }
        content.style.animation = "s1p-scale-out 0.25s ease-out forwards";
        modal.style.animation = "s1p-fade-out 0.25s ease-out forwards";
        setTimeout(() => modal.remove(), 250);
      };

      const setSubmittingState = (submitting) => {
        isSubmitting = submitting;
        confirmBtn.disabled = submitting;
        cancelBtn.disabled = submitting;
      };

      const handleSubmit = async () => {
        if (isSubmitting) return;
        const rawUsernameInput = String(usernameInput.value || "");
        const rawRemarkInput = String(remarkInput.value || "");
        const userName = normalizeUsernameInput(rawUsernameInput);

        if (!userName) {
          showMessage("请输入用户名。", false);
          usernameInput.focus();
          return;
        }

        const blockedUsers = getBlockedUsers();
        const duplicatedByName = Object.values(blockedUsers).some(
          (entry) => normalizeUsernameInput(entry?.name) === userName
        );
        if (duplicatedByName) {
          showMessage(`用户 ${userName} 已在屏蔽列表中。`, false);
          return;
        }

        setSubmittingState(true);
        showMessage(`正在查找用户 ${userName}...`, null);
        try {
          const userId = await resolveUidByUsername(userName);
          const latestBlockedUsers = getBlockedUsers();
          if (latestBlockedUsers[userId]) {
            const existingName = latestBlockedUsers[userId]?.name || userName;
            showMessage(`用户 ${existingName} 已在屏蔽列表中。`, false);
            setSubmittingState(false);
            return;
          }

          const remark = rawRemarkInput.trim();
          const nativeSyncSucceeded = await blockUser(userId, userName, remark);

          renderUserTab();
          renderThreadTab();
          closeModal();

          showUserBlockResultMessage(
            userName,
            nativeSyncSucceeded,
            getSettings()
          );
        } catch (error) {
          if (error?.code === "UID_NOT_FOUND") {
            showMessage("未找到该用户名，请检查后重试。", false);
            usernameInput.focus();
            usernameInput.select();
          } else if (error?.code === "LOOKUP_REQUEST_FAILED") {
            showMessage("查询用户失败，请稍后重试。", false);
          } else {
            showMessage("手动屏蔽失败，请稍后重试。", false);
          }
          setSubmittingState(false);
        }
      };

      cancelBtn.addEventListener("click", () => {
        if (!isSubmitting) {
          closeModal();
        }
      });
      confirmBtn.addEventListener("click", handleSubmit);

      usernameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          handleSubmit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (!isSubmitting) {
            closeModal();
          }
        }
      });
      remarkInput.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          handleSubmit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (!isSubmitting) {
            closeModal();
          }
        }
      });

      modal.addEventListener("click", (e) => {
        if (e.target === modal && !isSubmitting) {
          closeModal();
        }
      });

      document.body.appendChild(modal);
      setTimeout(() => {
        usernameInput.focus();
        usernameInput.select();
      }, 50);
    };
    const renderUserTab = () => {
      const settings = getSettings();
      const isEnabled = settings.enableUserBlocking;

      const toggleHTML = buildPrimaryFeatureToggleHtml({
        id: "s1p-enableUserBlocking",
        featureKey: "enableUserBlocking",
        label: "启用用户屏蔽功能",
        checked: isEnabled,
      });
      const blockedUsers = getBlockedUsers();
      const userItemIds = Object.keys(blockedUsers).sort(
        (a, b) => blockedUsers[b].timestamp - blockedUsers[a].timestamp
      );
      const nativeBlacklistLinkHtml = `<a class="s1p-bookmark-thread-link" href="${NATIVE_BLACKLIST_VIEW_URL}" target="_blank" rel="noopener noreferrer" title="论坛黑名单"><span class="s1p-bookmark-title-text">论坛黑名单</span>${SVG_ICON_EXTERNAL_LINK}</a>`;
      const contentHTML = `
                <div class="s1p-settings-group s1p-settings-group-compact">
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-blockThreadsOnUserBlock">屏蔽用户时，默认屏蔽其所有主题帖</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-blockThreadsOnUserBlock" class="s1p-settings-checkbox" ${settings.blockThreadsOnUserBlock ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div> 
                    <p class="s1p-setting-desc s1p-setting-desc-top8">
                        <strong>提示</strong>：顶部总开关仅影响<strong>未来新屏蔽用户</strong>的默认设置。每个用户下方的独立开关，才是控制该用户主题帖的<strong>最终开关</strong>，拥有最高优先级。
                    </p>                   
                    <div class="s1p-settings-item s1p-settings-item-top8">
                        <label class="s1p-settings-label" for="s1p-syncWithNativeBlacklist">同步至论坛黑名单</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-syncWithNativeBlacklist" class="s1p-settings-checkbox" data-setting="syncWithNativeBlacklist" ${settings.syncWithNativeBlacklist ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>

		                    <p class="s1p-setting-desc s1p-setting-desc-top8">
		                        <strong>提示</strong>：开启“同步至论坛黑名单”后，新屏蔽的用户会同时加入
		                        ${nativeBlacklistLinkHtml}。
		                    </p>
		                    <div class="s1p-settings-item s1p-settings-item-top8">
		                        <label class="s1p-settings-label" for="s1p-open-native-blacklist-import-btn">导入论坛黑名单到脚本</label>
		                        <button id="s1p-open-native-blacklist-import-btn" class="s1p-btn" type="button">前往黑名单页面导入</button>
		                    </div>
		                    <p class="s1p-setting-desc s1p-setting-desc-top8-no-bottom">
		                        跳转后可在论坛黑名单页点击“导入本页到 S1 Plus”，支持逐页导入并自动去重。
		                    </p>
		                </div>
		                <div class="s1p-settings-group s1p-settings-group-compact">
		                    <div class="s1p-settings-item">
		                        <label class="s1p-settings-label" for="s1p-manual-block-user-btn">手动输入用户名屏蔽</label>
		                        <button id="s1p-manual-block-user-btn" class="s1p-btn" type="button">添加屏蔽用户</button>
	                    </div>
	                    <p class="s1p-setting-desc s1p-setting-desc-top8-no-bottom">
	                        输入用户名后，脚本会自动识别 UID，并支持填写备注后加入屏蔽列表。
	                    </p>
		                </div>
	                <div class="s1p-settings-group">
	                    ${buildListSummaryHtml(
                        "s1p-blocked-user-list-summary",
                        userItemIds.length,
                        "位屏蔽用户"
                      )}
	                    <div id="s1p-blocked-user-list-container">
		                        ${userItemIds.length === 0
	          ? `<div class="s1p-empty">暂无屏蔽的用户</div>`
          : `<div class="s1p-list">${userItemIds
            .map((id) => {
              const item = blockedUsers[id];
              const safeIdAttr = escapeAttr(id);
              const displayName = item?.name || `用户 #${id}`;
              const safeDisplayName = escapeHTML(displayName);
              // [新增] 根据标记生成状态提示
              const syncStatusHtml =
                item.addedToNativeBlacklist === true
                  ? '<span class="s1p-native-sync-status">已同步至论坛黑名单</span>'
                  : "";

              // [Modified] New Layout: Toggle and Remark in same row
              const remark = String(item.remark || "");
              const safeRemarkText = escapeHTML(remark);
              const safeRemarkAttr = escapeAttr(remark);

              const remarkControlsHtml = remark
                ? `<span class="s1p-remark-text s1p-user-remark-display" data-full-tag="${safeRemarkAttr}">备注：${safeRemarkText}</span>
	                   <button class="s1p-btn s1p-btn-sm s1p-edit-remark-btn" data-user-id="${safeIdAttr}" data-current-remark="${safeRemarkAttr}">编辑</button>`
                : `<button class="s1p-btn s1p-btn-sm s1p-add-remark-btn" data-user-id="${safeIdAttr}">添加备注</button>`;

              return `
		              <div class="s1p-item s1p-blocked-user-item" data-user-id="${safeIdAttr}">
		                <div class="s1p-blocked-user-top-row">
		                    <div class="s1p-item-info s1p-item-info-no-margin">
		                        <div class="s1p-item-title">${safeDisplayName}${syncStatusHtml}</div>
		                        <div class="s1p-item-meta">屏蔽时间: ${formatDate(item.timestamp)}</div>
		                    </div>
	                    <button class="s1p-unblock-btn s1p-btn" data-unblock-user-id="${safeIdAttr}">取消屏蔽</button>
	                </div>
	                
	                <div class="s1p-item-row-controls">
	                    <div class="s1p-item-toggle">
	                        <label class="s1p-switch">
	                            <input type="checkbox" class="s1p-user-thread-block-toggle" data-user-id="${safeIdAttr}" ${item.blockThreads ? "checked" : ""}>
	                            <span class="s1p-slider"></span>
	                        </label>
	                        <span>屏蔽该用户的主题帖</span>
	                    </div>
                    <div class="s1p-remark-container">
                        ${remarkControlsHtml}
                    </div>
                </div>
              </div>`;
            })
            .join("")}</div>`
        }
                    </div>
                </div>
            `;
      tabs["users"].innerHTML = `
                ${toggleHTML}
                <div class="s1p-feature-content ${isEnabled ? "expanded" : ""}">
                    <div>${contentHTML}</div>
                </div>
            `;

      // [新增] 备注编辑事件监听
      userTabClickHandler = rebindTabClickHandler(
        tabs["users"],
        userTabClickHandler,
        (e) => {
          const target = e.target;
          if (
            target.classList.contains("s1p-add-remark-btn") ||
            target.classList.contains("s1p-edit-remark-btn")
          ) {
            const userId = target.dataset.userId;
            const currentRemark = target.dataset.currentRemark || "";

            // Replaced prompt with custom input modal
            const blockedUsers = getBlockedUsers(); // [Fix] Get users to display name
            const userName = blockedUsers[userId]?.name || `用户 #${userId}`; // [Fix] Get user name
            const safeUserName = escapeHTML(userName);

            createInputModal(
              "编辑备注",
              `请为 <strong>${safeUserName}</strong> 添加或修改备注（留空则删除备注）：`,
              currentRemark,
              (newRemark) => {
                const blockedUsers = getBlockedUsers();
                const currentUser = blockedUsers[userId];
                if (currentUser) {
                  const nextUser = { ...currentUser };
                  if (newRemark === null || newRemark.trim() === "") {
                    delete nextUser.remark;
                  } else {
                    nextUser.remark = newRemark.trim();
                  }
                  const nextBlockedUsers = {
                    ...blockedUsers,
                    [userId]: nextUser,
                  };
                  saveBlockedUsers(nextBlockedUsers);
                  renderUserTab(); // Re-render to show changes
                }
              },
              "保存",
              "",
              { allowSubtitleHtml: true }
            );
          }
        }
      );
    };
    const renderThreadTab = () => {
      setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.THREAD_RULES, false);
      const settings = getSettings();
      const isEnabled = settings.enablePostBlocking;

      const toggleHTML = buildPrimaryFeatureToggleHtml({
        id: "s1p-enablePostBlocking",
        featureKey: "enablePostBlocking",
        label: "启用帖子屏蔽功能",
        checked: isEnabled,
      });
      const blockedThreads = getBlockedThreads();
      const manualItemIds = Object.keys(blockedThreads).sort(
        (a, b) => blockedThreads[b].timestamp - blockedThreads[a].timestamp
      );
      const blockedPosts = getBlockedPosts();
      const blockedPostIds = Object.keys(blockedPosts).sort(
        (a, b) => blockedPosts[b].timestamp - blockedPosts[a].timestamp
      );
      const initialTitleFilterRules = getTitleFilterRules();
      const keywordRuleCount = initialTitleFilterRules.length;
      const dynamicallyHiddenCount = Object.keys(dynamicallyHiddenThreads).length;
      const contentHTML = `
                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">标题关键字屏蔽规则</div>
                    <p class="s1p-setting-desc">将自动屏蔽标题匹配已启用规则的帖子，支持正则表达式。修改后请点击“保存规则”以生效。</p>
                    ${buildListSummaryHtml(
                      "s1p-keyword-rules-summary",
                      keywordRuleCount,
                      "条标题规则"
                    )}
                    <div id="s1p-keyword-rules-list" class="s1p-keyword-rules-list"></div>
                    <div class="s1p-editor-footer s1p-editor-footer-start">
                         <button id="s1p-keyword-rule-add-btn" class="s1p-btn">添加新规则</button>
                         <button id="s1p-keyword-rules-save-btn" class="s1p-btn">保存规则</button>
                    </div>
                </div>

                <div class="s1p-settings-group">
                    <div id="s1p-blocked-by-keyword-header" class="s1p-settings-group-title s1p-collapsible-header">
                        <span>关键字/规则的屏蔽帖子列表</span>
                        <span class="s1p-expander-arrow ${settings.showBlockedByKeywordList ? "expanded" : ""
        }"></span>
                    </div>
                    <div id="s1p-dynamically-hidden-list-container" class="s1p-collapsible-content ${settings.showBlockedByKeywordList ? "expanded" : ""
        }">
                        <div>
                            ${buildListSummaryHtml(
                              "s1p-dynamically-hidden-summary",
                              dynamicallyHiddenCount,
                              "条当前页面命中帖子"
                            )}
                            <div id="s1p-dynamically-hidden-list"></div>
                        </div>
                    </div>
                </div>

                <div class="s1p-settings-group">
                    <div id="s1p-manually-blocked-header" class="s1p-settings-group-title s1p-collapsible-header">
                        <span>手动屏蔽的帖子列表</span>
                        <span class="s1p-expander-arrow ${settings.showManuallyBlockedList ? "expanded" : ""
        }"></span>
                    </div>
                    <div id="s1p-manually-blocked-list-container" class="s1p-collapsible-content ${settings.showManuallyBlockedList ? "expanded" : ""
        }">
                    <div>
		                    ${buildListSummaryHtml(
                            "s1p-manually-blocked-summary",
                            manualItemIds.length,
                            "条手动屏蔽帖子"
                          )}
		                    ${manualItemIds.length === 0
          ? `<div class="s1p-empty">暂无手动屏蔽的帖子</div>`
          : `<div class="s1p-list">${manualItemIds
            .map((id) => {
              const item = blockedThreads[id];
              const safeThreadIdAttr = escapeAttr(id);
              const safeTitleText = escapeHTML(item.title || `帖子 #${id}`);
              const reasonText =
                item.reason && item.reason !== "manual"
                  ? `(因屏蔽用户${escapeHTML(
                    String(item.reason).replace("user_", "")
                  )})`
                  : "";
              return `<div class="s1p-item" data-thread-id="${safeThreadIdAttr}"><div class="s1p-item-info"><div class="s1p-item-title">${safeTitleText
                }</div><div class="s1p-item-meta">屏蔽时间: ${formatDate(
                  item.timestamp
                )} ${reasonText}</div></div><button class="s1p-unblock-btn s1p-btn" data-unblock-thread-id="${safeThreadIdAttr}">取消屏蔽</button></div>`;
            })
            .join("")}</div>`
        }
                    </div>
                    </div>
                </div>

                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">已屏蔽的楼层</div>
                    <p class="s1p-setting-desc">手动屏蔽的特定楼层回复列表，按帖子分组显示。</p>
                    <div id="s1p-blocked-posts-list-container">
                    <div>
                        ${buildListSummaryHtml(
                          "s1p-blocked-posts-summary",
                          blockedPostIds.length,
                          "条屏蔽楼层"
                        )}
                        ${(() => {
          if (blockedPostIds.length === 0) {
            return `<div class="s1p-empty">暂无屏蔽的楼层</div>`;
          }

          // 按threadId分组
          const postsByThread = new Map();
          blockedPostIds.forEach((postId) => {
            const post = blockedPosts[postId];
            const threadId = String(post?.threadId ?? "unknown_thread");
            if (!postsByThread.has(threadId)) {
              postsByThread.set(threadId, {
                threadId,
                threadTitle: post?.threadTitle,
                posts: [],
              });
            }
            postsByThread.get(threadId).posts.push(post);
          });

          // 获取折叠状态
          const collapsedThreads = sanitizeRecordObject(
            GM_getValue("s1p_blocked_posts_collapsed_threads", {})
          );

          return `<div class="s1p-thread-groups">${Array.from(postsByThread.values())
            .map((thread) => {
              const isCollapsed = collapsedThreads[thread.threadId] === true;
              const safeThreadIdAttr = escapeAttr(thread.threadId);
              const safeThreadTitleText = escapeHTML(
                thread.threadTitle || "未知帖子"
              );
              return `
	                                    <div class="s1p-thread-group" data-thread-id="${safeThreadIdAttr}">
	                                        <div class="s1p-thread-header s1p-collapsible-header ${isCollapsed ? '' : 'expanded'}">
	                                            <span class="s1p-thread-title">${safeThreadTitleText}</span>
	                                            <span class="s1p-thread-count">(${thread.posts.length}个楼层)</span>
	                                            <span class="s1p-expander-arrow ${isCollapsed ? '' : 'expanded'}"></span>
	                                        </div>
	                                        <div class="s1p-thread-posts s1p-collapsible-content ${isCollapsed ? '' : 'expanded'}">
	                                            <div class="s1p-list">${thread.posts
                  .map((post) => {
                    const safePostIdAttr = escapeAttr(post.postId);
                    const safeFloorText = escapeHTML(post.floor);
                    const safeAuthorText = escapeHTML(
                      post.authorName || `用户 #${post.authorId}`
                    );
                    return `<div class="s1p-item" data-post-id="${safePostIdAttr}"><div class="s1p-item-info"><div class="s1p-item-title">第${safeFloorText}楼</div><div class="s1p-item-meta">作者: ${safeAuthorText} | 屏蔽时间: ${formatDate(post.timestamp)}</div></div><button class="s1p-unblock-post-btn s1p-btn" data-unblock-post-id="${safePostIdAttr}">取消屏蔽</button></div>`;
                  })
                  .join("")}</div>
	                                        </div>
	                                    </div>`;
            })
            .join("")}</div>`;
        })()
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

      const createRuleEmptyMessage = () => {
        const emptyEl = document.createElement("div");
        emptyEl.className = "s1p-empty";
        emptyEl.style.padding = "12px";
        emptyEl.textContent = "暂无规则";
        return emptyEl;
      };

      const createRuleEditorItem = ({
        ruleId,
        enabled = true,
        pattern = "",
      }) => {
        const item = document.createElement("div");
        item.className = "s1p-editor-item";
        item.dataset.ruleId = String(ruleId ?? "");

        const switchLabel = document.createElement("label");
        switchLabel.className = "s1p-switch";

        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.className = "s1p-settings-checkbox s1p-keyword-rule-enable";
        toggle.checked = !!enabled;

        const slider = document.createElement("span");
        slider.className = "s1p-slider";
        switchLabel.appendChild(toggle);
        switchLabel.appendChild(slider);

        const patternInput = document.createElement("input");
        patternInput.type = "text";
        patternInput.className = "s1p-input s1p-keyword-rule-pattern";
        patternInput.placeholder = "输入关键字或正则表达式";
        patternInput.autocomplete = "off";
        patternInput.value = String(pattern ?? "");

        const controls = document.createElement("div");
        controls.className = "s1p-editor-item-controls";

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "s1p-editor-btn s1p-delete-button";
        deleteBtn.dataset.action = "delete";
        deleteBtn.title = "删除规则";
        controls.appendChild(deleteBtn);

        item.appendChild(switchLabel);
        item.appendChild(patternInput);
        item.appendChild(controls);
        return item;
      };

      const renderDynamicallyHiddenList = () => {
        const listContainer = tabs["threads"].querySelector(
          "#s1p-dynamically-hidden-list"
        );
        if (!listContainer) return;

        const hiddenItems = Object.entries(dynamicallyHiddenThreads);
        setListSummaryText(
          "s1p-dynamically-hidden-summary",
          hiddenItems.length,
          "条当前页面命中帖子"
        );
        listContainer.textContent = "";
        if (hiddenItems.length === 0) {
          const emptyEl = document.createElement("div");
          emptyEl.className = "s1p-empty";
          emptyEl.style.paddingTop = "12px";
          emptyEl.textContent = "当前页面没有被关键字屏蔽的帖子";
          listContainer.appendChild(emptyEl);
        } else {
          const listEl = document.createElement("div");
          listEl.className = "s1p-list";

          hiddenItems.forEach(([id, item]) => {
            const rowEl = document.createElement("div");
            rowEl.className = "s1p-item";
            rowEl.dataset.threadId = String(id ?? "");

            const infoEl = document.createElement("div");
            infoEl.className = "s1p-item-info";

            const titleEl = document.createElement("div");
            titleEl.className = "s1p-item-title";
            const rawTitle = String(item?.title ?? "");
            titleEl.title = rawTitle;
            titleEl.textContent = rawTitle;

            const metaEl = document.createElement("div");
            metaEl.className = "s1p-item-meta";
            metaEl.appendChild(document.createTextNode("匹配规则: "));

            const codeEl = document.createElement("code");
            codeEl.style.background = "var(--s1p-code-bg)";
            codeEl.style.padding = "2px 4px";
            codeEl.style.borderRadius = "3px";
            codeEl.textContent = String(item?.pattern ?? "");
            metaEl.appendChild(codeEl);

            infoEl.appendChild(titleEl);
            infoEl.appendChild(metaEl);
            rowEl.appendChild(infoEl);
            listEl.appendChild(rowEl);
          });

          listContainer.appendChild(listEl);
        }
      };
      const renderRules = (rulesOverride = null) => {
        const rules = Array.isArray(rulesOverride)
          ? rulesOverride
          : getTitleFilterRules();
        const container = tabs["threads"].querySelector(
          "#s1p-keyword-rules-list"
        );
        if (!container) return;
        setListSummaryText("s1p-keyword-rules-summary", rules.length, "条标题规则");

        container.textContent = "";
        rules.forEach((rule) => {
          container.appendChild(
            createRuleEditorItem({
              ruleId: rule.id,
              enabled: rule.enabled,
              pattern: rule.pattern || "",
            })
          );
        });
        if (rules.length === 0) {
          container.appendChild(createRuleEmptyMessage());
        }
      };

      renderRules(initialTitleFilterRules);
      renderDynamicallyHiddenList();
      const rulesContainer = tabs["threads"].querySelector("#s1p-keyword-rules-list");
      if (rulesContainer) {
        rulesContainer.addEventListener("input", (event) => {
          const target = event.target;
          if (target && target.matches(".s1p-keyword-rule-pattern")) {
            setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.THREAD_RULES, true);
          }
        });
        rulesContainer.addEventListener("change", (event) => {
          const target = event.target;
          if (target && target.matches(".s1p-keyword-rule-enable")) {
            setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.THREAD_RULES, true);
          }
        });
      }
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
        renderRules(newRules);
        setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.THREAD_RULES, false);
      };

      threadTabClickHandler = rebindTabClickHandler(
        tabs["threads"],
        threadTabClickHandler,
        (e) => {
          const target = e.target;
          const header = target.closest(".s1p-collapsible-header");

          if (header) {
            if (header.id === "s1p-blocked-by-keyword-header") {
              const currentSettings = getSettingsForWrite();
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
              const currentSettings = getSettingsForWrite();
              const isNowExpanded = !currentSettings.showManuallyBlockedList;
              currentSettings.showManuallyBlockedList = isNowExpanded;
              saveSettings(currentSettings);

              header
                .querySelector(".s1p-expander-arrow")
                .classList.toggle("expanded", isNowExpanded);
              tabs["threads"]
                .querySelector("#s1p-manually-blocked-list-container")
                .classList.toggle("expanded", isNowExpanded);
            } else if (header.classList.contains("s1p-thread-header")) {
              // 处理帖子分组的折叠
              const threadGroup = header.closest(".s1p-thread-group");
              const threadId = String(threadGroup?.dataset.threadId || "");
              if (!threadId) {
                return;
              }
              const collapsedThreads = sanitizeRecordObject(
                GM_getValue("s1p_blocked_posts_collapsed_threads", {})
              );
              const isNowCollapsed = collapsedThreads[threadId] !== true;

              collapsedThreads[threadId] = isNowCollapsed;
              GM_setValue("s1p_blocked_posts_collapsed_threads", collapsedThreads);

              header.classList.toggle("expanded", !isNowCollapsed);
              header.querySelector(".s1p-expander-arrow").classList.toggle("expanded", !isNowCollapsed);
              threadGroup.querySelector(".s1p-thread-posts").classList.toggle("expanded", !isNowCollapsed);
            }
          } else if (target.id === "s1p-keyword-rule-add-btn") {
            const container = tabs["threads"].querySelector(
              "#s1p-keyword-rules-list"
            );
            const emptyMsg = container.querySelector(".s1p-empty");
            if (emptyMsg) emptyMsg.remove();

            const newItem = createRuleEditorItem({
              ruleId: `new_${Date.now()}`,
              enabled: true,
              pattern: "",
            });
            container.appendChild(newItem);
            newItem.querySelector('input[type="text"]').focus();
            setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.THREAD_RULES, true);
          } else if (target.closest(".s1p-delete-button")) {
            const item = target.closest(".s1p-editor-item");
            if (item) {
              const pattern =
                item.querySelector(".s1p-keyword-rule-pattern").value.trim() ||
                "空规则";
              const safePatternForHtml = escapeHTML(pattern);
              createConfirmationModal(
                "确认删除该屏蔽规则吗？",
                `规则内容: <code class="s1p-inline-code-badge">${safePatternForHtml}</code><br>此操作将立即生效并从存储中删除该规则。`,
                () => {
                  const ruleIdToDelete = item.dataset.ruleId;
                  if (!ruleIdToDelete || ruleIdToDelete.startsWith("new_")) {
                    item.remove();
                    const container = tabs["threads"].querySelector(
                      "#s1p-keyword-rules-list"
                    );
                    if (container.children.length === 0) {
                      container.appendChild(createRuleEmptyMessage());
                    }
                    setSettingsModalDirtyState(
                      SETTINGS_MODAL_DIRTY_TAB.THREAD_RULES,
                      true
                    );
                    showMessage("未保存的新规则已移除。", null);
                    return;
                  }
                  const currentRules = getTitleFilterRules();
                  const newRules = currentRules.filter(
                    (rule) => rule.id !== ruleIdToDelete
                  );
                  saveTitleFilterRules(newRules);
                  hideThreadsByTitleKeyword();
                  renderDynamicallyHiddenList();
                  renderRules(newRules);
                  setSettingsModalDirtyState(
                    SETTINGS_MODAL_DIRTY_TAB.THREAD_RULES,
                    false
                  );
                  showMessage("规则已成功删除。", true);
                },
                "确认删除",
                { allowSubtitleHtml: true }
              );
            }
          } else if (target.id === "s1p-keyword-rules-save-btn") {
            saveKeywordRules();
            showMessage("规则已保存！", true);
          }
        }
      );
    };
    const renderGeneralSettingsTab = () => {
      const settings = getSettings();
      const openTabSettings = settings.openInNewTab;
      const isReadProgressEnabled = settings.enableReadProgress === true;
      const resolveOpenModeValue = (isEnabled, isBackground) => {
        if (!isEnabled) return "off";
        return isBackground ? "background" : "foreground";
      };
      const openModeValues = {
        threadList: resolveOpenModeValue(
          openTabSettings.threadList,
          openTabSettings.threadListInBackground
        ),
        progress: resolveOpenModeValue(
          openTabSettings.progress,
          openTabSettings.progressInBackground
        ),
        nav: resolveOpenModeValue(
          openTabSettings.nav,
          openTabSettings.navInBackground
        ),
        postContentLinks: resolveOpenModeValue(
          openTabSettings.postContentLinks,
          openTabSettings.postContentLinksInBackground
        ),
      };

      tabs["general-settings"].innerHTML = `
        ${buildPrimaryFeatureToggleHtml({
          id: "s1p-enableGeneralSettings",
          featureKey: "enableGeneralSettings",
          label: "启用通用设置",
          checked: settings.enableGeneralSettings,
        })}
        <div class="s1p-feature-content ${settings.enableGeneralSettings ? "expanded" : ""
        }">
            <div>
                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">阅读/浏览增强</div>
                    <div class="s1p-settings-item s1p-settings-item-top16">
                        <label class="s1p-settings-label" for="s1p-autoLinkPlainTextUrls">将纯文本链接自动转为可点击超链接</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-autoLinkPlainTextUrls" class="s1p-settings-checkbox" data-setting="autoLinkPlainTextUrls" ${settings.autoLinkPlainTextUrls ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>
                    <p class="s1p-setting-desc s1p-setting-desc-top-negative4">处理常见 http://、https://、www. 开头的纯文本链接；原本已可点击的链接会自动跳过。</p>

                     <div class="s1p-settings-item s1p-settings-item-top16">
                        <label class="s1p-settings-label" for="s1p-enableReadProgress">启用阅读进度跟踪</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-enableReadProgress" data-feature="enableReadProgress" class="s1p-feature-toggle" ${settings.enableReadProgress ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-feature-content ${settings.enableReadProgress ? "expanded" : ""
        }">
                      <div class="s1p-settings-sub-group">
                        <div class="s1p-settings-item" id="s1p-showReadIndicator-container">
                            <label class="s1p-settings-label" for="s1p-showReadIndicator">显示“当前阅读位置”浮动标识</label>
                            <label class="s1p-switch"><input type="checkbox" id="s1p-showReadIndicator" class="s1p-settings-checkbox" data-setting="showReadIndicator" ${settings.showReadIndicator ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                        </div>
                        <div class="s1p-settings-item" id="s1p-cleanupModeContainer">
                            <label class="s1p-settings-label">阅读记录清理方式</label>
                            <div class="s1p-flex-row-center-gap12">
                                <div id="s1p-cleanupMode-control" class="s1p-segmented-control">
                                    <div class="s1p-segmented-control-slider"></div>
                                    <div class="s1p-segmented-control-option ${settings.cleanupMode === 'auto' ? 'active' : ''}" data-value="auto">自动</div>
                                    <div class="s1p-segmented-control-option ${settings.cleanupMode === 'manual' ? 'active' : ''}" data-value="manual">手动</div>
                                </div>
                                <button id="s1p-open-progress-detail-btn" class="s1p-btn s1p-progress-detail-btn ${settings.cleanupMode === 'manual' ? '' : 's1p-hidden'}">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" class="s1p-progress-detail-btn-icon">
                                        <path d="M3 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3ZM4 5V19H20V5H4ZM7 7H11V11H7V7ZM7 13H11V17H7V13ZM13 7H17V11H13V7ZM13 13H17V17H13V13Z"></path>
                                    </svg>
                                    阅读记录详情
                                </button>
                            </div>
                        </div>
                        <div class="s1p-settings-item s1p-auto-cleanup-options s1p-settings-item-auto-cleanup ${settings.cleanupMode === 'auto' ? '' : 's1p-hidden'}" id="s1p-readingProgressCleanupContainer">
                            <label class="s1p-settings-label s1p-settings-label-indent16">自动清理超过以下时间的阅读记录</label>
                            <div id="s1p-readingProgressCleanupDays-control" class="s1p-segmented-control">
                                <div class="s1p-segmented-control-slider"></div>
                                <div class="s1p-segmented-control-option ${settings.readingProgressCleanupDays == 30 ? 'active' : ''}" data-value="30">1个月</div>
                                <div class="s1p-segmented-control-option ${settings.readingProgressCleanupDays == 90 ? 'active' : ''}" data-value="90">3个月</div>
                                <div class="s1p-segmented-control-option ${settings.readingProgressCleanupDays == 180 ? 'active' : ''}" data-value="180">6个月</div>
                                <div class="s1p-segmented-control-option ${settings.readingProgressCleanupDays == 0 ? 'active' : ''}" data-value="0">永不</div>
                            </div>
                        </div>
                      </div>
                    </div>
                     <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-hideImagesByDefault">默认隐藏帖子图片</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-hideImagesByDefault" class="s1p-settings-checkbox" data-setting="hideImagesByDefault" ${settings.hideImagesByDefault ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-useS1PlusImageViewer">所有帖子图片使用 S1 Plus 查看器（替代论坛原生查看器）</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-useS1PlusImageViewer" class="s1p-settings-checkbox" data-setting="useS1PlusImageViewer" ${settings.useS1PlusImageViewer ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-limitImagesBySize">\u9650\u5236\u8d85\u5927\u56fe\u7247\u5c3a\u5bf8\uff08\u70b9\u51fb\u67e5\u770b\u539f\u56fe\uff09</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-limitImagesBySize" class="s1p-settings-checkbox" data-setting="limitImagesBySize" ${settings.limitImagesBySize ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>
                    <div id="s1p-image-size-limit-panel" class="s1p-image-size-limit-panel ${settings.limitImagesBySize ? "is-enabled" : ""}">
                        <div class="s1p-image-size-limit-header">
                            <p class="s1p-setting-desc">超过阈值的图片会按比例缩放，点击可查看原图（由上方查看器开关决定使用 S1 Plus 或论坛原生）。</p>
                            <button id="s1p-image-size-reset-btn" type="button" class="s1p-btn">\u6062\u590d\u9ed8\u8ba4</button>
                        </div>
                        <div class="s1p-settings-sub-group s1p-image-size-limit-controls">
                            <div class="s1p-image-size-limit-grid">
                                <div class="s1p-image-size-limit-field">
                                    <label class="s1p-settings-label" for="s1p-imagePreviewMaxWidth">\u6700\u5927\u5bbd\u5ea6</label>
                                    <div class="s1p-image-size-limit-input-wrap">
                                        <input type="number" id="s1p-imagePreviewMaxWidth" class="s1p-input s1p-image-size-limit-input" data-setting="imagePreviewMaxWidth" min="${IMAGE_PREVIEW_LIMIT_MIN}" max="${IMAGE_PREVIEW_LIMIT_MAX}" step="1" value="${settings.imagePreviewMaxWidth}">
                                        <span class="s1p-image-size-limit-unit">px</span>
                                    </div>
                                </div>
                                <div class="s1p-image-size-limit-field">
                                    <label class="s1p-settings-label" for="s1p-imagePreviewMaxHeight">\u6700\u5927\u9ad8\u5ea6</label>
                                    <div class="s1p-image-size-limit-input-wrap">
                                        <input type="number" id="s1p-imagePreviewMaxHeight" class="s1p-input s1p-image-size-limit-input" data-setting="imagePreviewMaxHeight" min="${IMAGE_PREVIEW_LIMIT_MIN}" max="${IMAGE_PREVIEW_LIMIT_MAX}" step="1" value="${settings.imagePreviewMaxHeight}">
                                        <span class="s1p-image-size-limit-unit">px</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-hideSystemBlockedPosts">默认隐藏被系统屏蔽的楼层</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-hideSystemBlockedPosts" class="s1p-settings-checkbox" data-setting="hideSystemBlockedPosts" ${settings.hideSystemBlockedPosts ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>
                    <p class="s1p-setting-desc">开启后，被屏蔽楼层将被自动隐藏。</p>
                </div>
                <div class="s1p-settings-group s1p-link-open-mode-section">
                        <div class="s1p-settings-group-head">
                            <div class="s1p-settings-group-title">链接打开方式（新标签页）</div>
                            <button id="s1p-reset-open-in-new-tab-settings-btn" type="button" class="s1p-btn">恢复默认</button>
                        </div>
                        <p class="s1p-setting-desc s1p-link-open-mode-desc">按来源单独控制打开行为：关闭 / 自动切换到新标签页 / 后台打开不切换。最后一项仅作用于除“帖子/消息链接”“阅读进度跳转”“顶部导航/菜单链接”之外的其他论坛链接。</p>
                        <div class="s1p-link-open-mode-group">
                            <div class="s1p-link-open-mode-item">
                                <label class="s1p-settings-label" for="s1p-openMode-threadList-control">帖子/消息链接</label>
                                <div id="s1p-openMode-threadList-control" class="s1p-segmented-control s1p-link-open-mode-control">
                                    <div class="s1p-segmented-control-slider"></div>
                                    <div class="s1p-segmented-control-option ${openModeValues.threadList === "off" ? "active" : ""}" data-value="off">关闭</div>
                                    <div class="s1p-segmented-control-option ${openModeValues.threadList === "foreground" ? "active" : ""}" data-value="foreground">自动切换</div>
                                    <div class="s1p-segmented-control-option ${openModeValues.threadList === "background" ? "active" : ""}" data-value="background">后台打开</div>
                                </div>
                            </div>
                            <div class="s1p-link-open-mode-item ${isReadProgressEnabled ? "" : "is-disabled"}">
                                <label class="s1p-settings-label" for="s1p-openMode-progress-control">阅读进度跳转</label>
                                <div id="s1p-openMode-progress-control" class="s1p-segmented-control s1p-link-open-mode-control">
                                    <div class="s1p-segmented-control-slider"></div>
                                    <div class="s1p-segmented-control-option ${openModeValues.progress === "off" ? "active" : ""}" data-value="off">关闭</div>
                                    <div class="s1p-segmented-control-option ${openModeValues.progress === "foreground" ? "active" : ""}" data-value="foreground">自动切换</div>
                                    <div class="s1p-segmented-control-option ${openModeValues.progress === "background" ? "active" : ""}" data-value="background">后台打开</div>
                                </div>
                            </div>
                            ${isReadProgressEnabled
          ? ""
          : '<p class="s1p-setting-desc s1p-setting-desc-progress-hint">需先开启“阅读进度跟踪”。</p>'}
                            <div class="s1p-link-open-mode-item">
                                <label class="s1p-settings-label" for="s1p-openMode-nav-control">顶部导航/菜单链接</label>
                                <div id="s1p-openMode-nav-control" class="s1p-segmented-control s1p-link-open-mode-control">
                                    <div class="s1p-segmented-control-slider"></div>
                                    <div class="s1p-segmented-control-option ${openModeValues.nav === "off" ? "active" : ""}" data-value="off">关闭</div>
                                    <div class="s1p-segmented-control-option ${openModeValues.nav === "foreground" ? "active" : ""}" data-value="foreground">自动切换</div>
                                    <div class="s1p-segmented-control-option ${openModeValues.nav === "background" ? "active" : ""}" data-value="background">后台打开</div>
                                </div>
                            </div>
                            <div class="s1p-link-open-mode-item">
                                <label class="s1p-settings-label" for="s1p-openMode-postContentLinks-control">其他论坛链接（含自动补链）</label>
                                <div id="s1p-openMode-postContentLinks-control" class="s1p-segmented-control s1p-link-open-mode-control">
                                    <div class="s1p-segmented-control-slider"></div>
                                    <div class="s1p-segmented-control-option ${openModeValues.postContentLinks === "off" ? "active" : ""}" data-value="off">关闭</div>
                                    <div class="s1p-segmented-control-option ${openModeValues.postContentLinks === "foreground" ? "active" : ""}" data-value="foreground">自动切换</div>
                                    <div class="s1p-segmented-control-option ${openModeValues.postContentLinks === "background" ? "active" : ""}" data-value="background">后台打开</div>
                                </div>
                            </div>
                        </div>
                    </div>
                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">界面与个性化</div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-recommendS1Nux">推荐 S1 NUX 安装</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-recommendS1Nux" class="s1p-settings-checkbox" data-setting="recommendS1Nux" ${settings.recommendS1Nux ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>
                    <p class="s1p-setting-desc">S1 Plus 与 S1 NUX 论坛美化美化扩展搭配使用效果更佳。开启后，若检测到您未安装 S1 NUX，脚本会适时弹出对话框进行推荐。</p>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-enhanceFloatingControls">使用 S1 Plus 增强型悬浮控件</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-enhanceFloatingControls" class="s1p-settings-checkbox" data-setting="enhanceFloatingControls" ${settings.enhanceFloatingControls ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>
                    <p class="s1p-setting-desc">开启后，将使用脚本提供的全新悬停展开式控件；关闭则恢复使用论坛原生的滚动控件。</p>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-changeLogoLink">修改论坛Logo链接 (指向论坛首页)</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-changeLogoLink" class="s1p-settings-checkbox" data-setting="changeLogoLink" ${settings.changeLogoLink ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>
                    <div class="s1p-settings-item">
                        <label class="s1p-settings-label" for="s1p-hideBlacklistTip">隐藏已屏蔽用户发言的黄条提示</label>
                        <label class="s1p-switch"><input type="checkbox" id="s1p-hideBlacklistTip" class="s1p-settings-checkbox" data-setting="hideBlacklistTip" ${settings.hideBlacklistTip ? "checked" : ""
        }><span class="s1p-slider"></span></label>
                    </div>

	                    <div class="s1p-settings-item">
	                        <label class="s1p-settings-label" for="s1p-customTitleSuffix">自定义标题后缀</label>
	                        <input type="text" id="s1p-customTitleSuffix" class="s1p-input" data-setting="customTitleSuffix" value="${escapeAttr(settings.customTitleSuffix || "")
        }" autocomplete="off">
	                    </div>
	                </div>
            </div>
        </div>`;

      const tabContent = tabs["general-settings"];
      const resetOpenInNewTabSettingsBtn = tabContent.querySelector(
        "#s1p-reset-open-in-new-tab-settings-btn"
      );
      if (resetOpenInNewTabSettingsBtn) {
        resetOpenInNewTabSettingsBtn.addEventListener("click", (event) => {
          event.preventDefault();
          const currentSettings = getSettingsForWrite();
          currentSettings.openInNewTab = {
            ...currentSettings.openInNewTab,
            threadList: defaultSettings.openInNewTab.threadList,
            threadListInBackground:
              defaultSettings.openInNewTab.threadListInBackground,
            progress: defaultSettings.openInNewTab.progress,
            progressInBackground: defaultSettings.openInNewTab.progressInBackground,
            nav: defaultSettings.openInNewTab.nav,
            navInBackground: defaultSettings.openInNewTab.navInBackground,
            postContentLinks: defaultSettings.openInNewTab.postContentLinks,
            postContentLinksInBackground:
              defaultSettings.openInNewTab.postContentLinksInBackground,
          };
          saveSettings(currentSettings);
          applyGlobalLinkBehavior();
          removeProgressJumpButtons();
          if (
            currentSettings.enableGeneralSettings === true &&
            currentSettings.enableReadProgress === true
          ) {
            addProgressJumpButtons();
          }
          renderGeneralSettingsTab();
          showMessage("“链接打开方式（新标签页）”已恢复默认。", true);
        });
      }

      const moveSlider = (control, skipAnimation = false) => {
        if (!control) return;
        requestAnimationFrame(() => {
          const slider = control.querySelector(".s1p-segmented-control-slider");
          const activeOption = control.querySelector(
            ".s1p-segmented-control-option.active"
          );
          if (
            slider &&
            activeOption &&
            activeOption.offsetWidth > 0 &&
            activeOption.offsetParent !== null
          ) {
            if (skipAnimation) {
              slider.style.transition = "none";
            }
            slider.style.width = `${activeOption.offsetWidth}px`;
            slider.style.transform = `translateX(${activeOption.offsetLeft}px)`;

            if (skipAnimation) {
              // Force reflow
              void slider.offsetWidth;
              // Restore transition next frame to ensure it doesn't animate the initial state
              requestAnimationFrame(() => {
                slider.style.transition = "";
              });
            }
          } else if (slider && activeOption) {
            setTimeout(() => moveSlider(control, skipAnimation), 100);
          }
        });
      };
      const setOpenModeOption = (control, modeValue) => {
        if (!control) return;
        control
          .querySelectorAll(".s1p-segmented-control-option")
          .forEach((opt) => opt.classList.remove("active"));
        const targetOption = control.querySelector(
          `.s1p-segmented-control-option[data-value="${modeValue}"]`
        );
        if (targetOption) {
          targetOption.classList.add("active");
        }
        moveSlider(control);
      };
      const applyOpenModeToSettings = (settingsForWrite, openKey, backgroundKey, mode) => {
        if (
          !settingsForWrite.openInNewTab ||
          typeof settingsForWrite.openInNewTab !== "object"
        ) {
          settingsForWrite.openInNewTab = { ...defaultSettings.openInNewTab };
        }
        if (mode === "background") {
          settingsForWrite.openInNewTab[openKey] = true;
          settingsForWrite.openInNewTab[backgroundKey] = true;
          return;
        }
        if (mode === "foreground") {
          settingsForWrite.openInNewTab[openKey] = true;
          settingsForWrite.openInNewTab[backgroundKey] = false;
          return;
        }
        settingsForWrite.openInNewTab[openKey] = false;
        settingsForWrite.openInNewTab[backgroundKey] = false;
      };
      const bindOpenModeControl = (
        controlId,
        openKey,
        backgroundKey,
        { disabled = false } = {}
      ) => {
        const control = tabContent.querySelector(`#${controlId}`);
        if (!control) {
          return;
        }
        moveSlider(control, true);
        if (disabled) {
          return;
        }
        control.addEventListener("click", (event) => {
          const option = event.target.closest(".s1p-segmented-control-option");
          if (!option || option.classList.contains("active")) {
            return;
          }
          const mode = option.dataset.value;
          const nextSettings = getSettingsForWrite();
          applyOpenModeToSettings(nextSettings, openKey, backgroundKey, mode);
          saveSettings(nextSettings);
          setOpenModeOption(control, mode);
          applyGlobalLinkBehavior();
          if (openKey === "progress") {
            removeProgressJumpButtons();
            if (
              nextSettings.enableGeneralSettings === true &&
              nextSettings.enableReadProgress === true
            ) {
              addProgressJumpButtons();
            }
          }
        });
      };
      bindOpenModeControl(
        "s1p-openMode-threadList-control",
        "threadList",
        "threadListInBackground"
      );
      bindOpenModeControl(
        "s1p-openMode-progress-control",
        "progress",
        "progressInBackground",
        { disabled: !isReadProgressEnabled }
      );
      bindOpenModeControl("s1p-openMode-nav-control", "nav", "navInBackground");
      bindOpenModeControl(
        "s1p-openMode-postContentLinks-control",
        "postContentLinks",
        "postContentLinksInBackground"
      );

      const cleanupControl = tabs["general-settings"].querySelector(
        "#s1p-readingProgressCleanupDays-control"
      );
      if (cleanupControl) {
        moveSlider(cleanupControl, true);
        cleanupControl.addEventListener("click", (e) => {
          const target = e.target.closest(".s1p-segmented-control-option");
          if (!target || target.classList.contains("active")) return;
          const newValue = parseInt(target.dataset.value, 10);
          const currentSettings = getSettingsForWrite();
          currentSettings.readingProgressCleanupDays = newValue;
          saveSettings(currentSettings);
          // [FIX] 当设置为"永不"清理时，清除残留的清理标记
          if (newValue === 0) {
            GM_deleteValue("s1p_pending_cleanup_info");
          }
          cleanupControl
            .querySelectorAll(".s1p-segmented-control-option")
            .forEach((opt) => opt.classList.remove("active"));
          target.classList.add("active");
          moveSlider(cleanupControl);
        });
      }

      // 清理模式切换（自动/手动）
      const cleanupModeControl = tabs["general-settings"].querySelector(
        "#s1p-cleanupMode-control"
      );
      const autoCleanupOptions = tabs["general-settings"].querySelector(
        "#s1p-readingProgressCleanupContainer"
      );
      const progressDetailBtn = tabs["general-settings"].querySelector(
        "#s1p-open-progress-detail-btn"
      );

      if (cleanupModeControl) {
        moveSlider(cleanupModeControl, true);
        cleanupModeControl.addEventListener("click", (e) => {
          const target = e.target.closest(".s1p-segmented-control-option");
          if (!target || target.classList.contains("active")) return;
          const newMode = target.dataset.value;
          const currentSettings = getSettingsForWrite();
          currentSettings.cleanupMode = newMode;
          saveSettings(currentSettings);
          cleanupModeControl
            .querySelectorAll(".s1p-segmented-control-option")
            .forEach((opt) => opt.classList.remove("active"));
          target.classList.add("active");
          moveSlider(cleanupModeControl);

          // 显示/隐藏对应的选项
          if (newMode === "auto") {
            autoCleanupOptions?.classList.remove("s1p-hidden");
            progressDetailBtn?.classList.add("s1p-hidden");
          } else {
            autoCleanupOptions?.classList.add("s1p-hidden");
            progressDetailBtn?.classList.remove("s1p-hidden");
            // [FIX] 切换到手动模式时，清除残留的自动清理标记，防止误触发自动推送逻辑
            GM_deleteValue("s1p_pending_cleanup_info");
          }
        });
      }

      // 打开阅读记录详情按钮
      const openProgressDetailBtn = tabs["general-settings"].querySelector(
        "#s1p-open-progress-detail-btn"
      );
      if (openProgressDetailBtn) {
        openProgressDetailBtn.addEventListener("click", () => {
          createReadingProgressDetailModal();
        });
      }
      const imageSizeLimitPanel = tabs["general-settings"].querySelector(
        "#s1p-image-size-limit-panel"
      );
      const imageSizeLimitToggle = tabs["general-settings"].querySelector(
        "#s1p-limitImagesBySize"
      );
      if (imageSizeLimitToggle && imageSizeLimitPanel) {
        imageSizeLimitToggle.addEventListener("change", (event) => {
          imageSizeLimitPanel.classList.toggle(
            "is-enabled",
            event.target.checked === true
          );
        });
      }
      const imageSizeResetButton = tabs["general-settings"].querySelector(
        "#s1p-image-size-reset-btn"
      );
      if (imageSizeResetButton) {
        imageSizeResetButton.addEventListener("click", (event) => {
          event.preventDefault();
          const currentSettings = getSettingsForWrite();
          currentSettings.imagePreviewMaxWidth = IMAGE_PREVIEW_DEFAULT_WIDTH;
          currentSettings.imagePreviewMaxHeight = IMAGE_PREVIEW_DEFAULT_HEIGHT;
          saveSettings(currentSettings);
          const latestSettings = getSettings();
          const widthInput = tabs["general-settings"].querySelector(
            "#s1p-imagePreviewMaxWidth"
          );
          const heightInput = tabs["general-settings"].querySelector(
            "#s1p-imagePreviewMaxHeight"
          );
          if (widthInput) {
            widthInput.value = String(latestSettings.imagePreviewMaxWidth);
          }
          if (heightInput) {
            heightInput.value = String(latestSettings.imagePreviewMaxHeight);
          }
          applyImageSizeLimits();
          showMessage(
            "\u5df2\u6062\u590d\u9ed8\u8ba4\u5927\u56fe\u9650\u5236\uff1a800 / 1200 px\u3002",
            true
          );
        });
      }
    };
    const renderNavSettingsTab = () => {
      setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.NAV_SETTINGS, false);
      const settings = getSettings();
      tabs["nav-settings"].innerHTML = `
        ${buildPrimaryFeatureToggleHtml({
          id: "s1p-enableNavCustomization",
          featureKey: "enableNavCustomization",
          label: "启用自定义导航栏",
          checked: settings.enableNavCustomization,
        })}
        <div class="s1p-feature-content ${settings.enableNavCustomization ? "expanded" : ""
        }">
            <div>
                <div class="s1p-settings-group">
                    <div class="s1p-settings-group-title">导航链接编辑器</div>
                    ${buildListSummaryHtml(
                      "s1p-nav-link-summary",
                      Array.isArray(settings.customNavLinks)
                        ? settings.customNavLinks.length
                        : 0,
                      "个导航链接"
	                    )}
	                    <div class="s1p-list s1p-nav-editor-list"></div>
	                    <div class="s1p-editor-footer">
	                        <div class="s1p-nav-editor-actions">
	                            <button id="s1p-nav-add-btn" class="s1p-btn">添加新链接</button>
	                            <button id="s1p-settings-save-btn" class="s1p-btn">保存设置</button>
	                        </div>
                        <button id="s1p-nav-restore-btn" class="s1p-btn s1p-red-btn">恢复默认导航</button>
                    </div>
                </div>
            </div>
        </div>`;

      const navListContainer = tabs["nav-settings"].querySelector(
        ".s1p-nav-editor-list"
      );
      const createNavEditorItem = (index, name = "", href = "") => {
        const item = document.createElement("div");
        item.className = "s1p-editor-item";
        item.draggable = true;
        item.dataset.index = String(index ?? "");
        item.style.gridTemplateColumns = "auto 1fr 1fr auto";
        item.style.userSelect = "none";

        const dragHandle = document.createElement("div");
        dragHandle.className = "s1p-drag-handle";
        dragHandle.textContent = "::";

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "s1p-input s1p-nav-name";
        nameInput.placeholder = "名称";
        nameInput.autocomplete = "off";
        nameInput.value = String(name ?? "");

        const hrefInput = document.createElement("input");
        hrefInput.type = "text";
        hrefInput.className = "s1p-input s1p-nav-href";
        hrefInput.placeholder = "链接";
        hrefInput.autocomplete = "off";
        hrefInput.value = String(href ?? "");

        const controls = document.createElement("div");
        controls.className = "s1p-editor-item-controls";

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "s1p-editor-btn s1p-delete-button";
        deleteBtn.dataset.action = "delete";
        deleteBtn.title = "删除链接";
        controls.appendChild(deleteBtn);

        item.appendChild(dragHandle);
        item.appendChild(nameInput);
        item.appendChild(hrefInput);
        item.appendChild(controls);
        return item;
      };

      const renderNavList = (links) => {
        navListContainer.textContent = "";
        const safeLinks = Array.isArray(links) ? links : [];
        safeLinks.forEach((link, index) => {
          navListContainer.appendChild(
            createNavEditorItem(index, link.name || "", link.href || "")
          );
        });
        setListSummaryText("s1p-nav-link-summary", safeLinks.length, "个导航链接");
      };

      renderNavList(settings.customNavLinks);
      navListContainer.addEventListener("input", (e) => {
        const target = e.target;
        if (
          target &&
          (target.classList.contains("s1p-nav-name") ||
            target.classList.contains("s1p-nav-href"))
        ) {
          setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.NAV_SETTINGS, true);
        }
      });

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
          setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.NAV_SETTINGS, true);
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
      navSettingsTabClickHandler = rebindTabClickHandler(
        tabs["nav-settings"],
        navSettingsTabClickHandler,
        (e) => {
          const target = e.target;
          if (target.id === "s1p-nav-add-btn") {
            const newItem = createNavEditorItem(`new_${Date.now()}`, "", "");
            newItem.querySelector(".s1p-nav-name").placeholder = "新链接";
            newItem.querySelector(".s1p-nav-href").placeholder = "forum.php";
            navListContainer.appendChild(newItem);
            setListSummaryText(
              "s1p-nav-link-summary",
              navListContainer.querySelectorAll(".s1p-editor-item").length,
              "个导航链接"
            );
            setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.NAV_SETTINGS, true);
          } else if (target.closest(".s1p-delete-button")) {
            const item = target.closest(".s1p-editor-item");
            if (item) {
              const name =
                item.querySelector(".s1p-nav-name").value.trim() || "未命名链接";
              const safeNameForHtml = escapeHTML(name);
              createConfirmationModal(
                "确认删除该导航链接吗？",
                `链接名称: ${safeNameForHtml}<br>此操作仅在UI上移除，需要点击下方的“保存设置”按钮才会真正生效。`,
                () => {
                  item.remove();
                  setListSummaryText(
                    "s1p-nav-link-summary",
                    navListContainer.querySelectorAll(".s1p-editor-item").length,
                    "个导航链接"
                  );
                  setSettingsModalDirtyState(
                    SETTINGS_MODAL_DIRTY_TAB.NAV_SETTINGS,
                    true
                  );
                  showMessage("链接已从列表移除。", true);
                },
                "确认删除",
                { allowSubtitleHtml: true }
              );
            }
          } else if (target.id === "s1p-nav-restore-btn") {
            createConfirmationModal(
              "确认要恢复默认导航栏吗？",
              "您当前的自定义导航链接将被重置为脚本的默认设置。",
              () => {
                const currentSettings = getSettingsForWrite();
                currentSettings.enableNavCustomization =
                  defaultSettings.enableNavCustomization;
                currentSettings.customNavLinks = defaultSettings.customNavLinks;
                saveSettings(currentSettings);
                setSettingsModalDirtyState(
                  SETTINGS_MODAL_DIRTY_TAB.NAV_SETTINGS,
                  false
                );
                renderNavSettingsTab();
                initializeNavbar();
                showMessage("导航栏已恢复为默认设置！", true);
              },
              "确认恢复"
            );
          } else if (target.id === "s1p-settings-save-btn") {
            const rawCustomNavLinks = Array.from(
              navListContainer.querySelectorAll(".s1p-editor-item")
            )
              .map((item) => ({
                name: item.querySelector(".s1p-nav-name").value.trim(),
                href: item.querySelector(".s1p-nav-href").value.trim(),
              }))
              .filter((l) => l.name && l.href);
            const normalizedCustomNavLinks = normalizeCustomNavLinks(
              rawCustomNavLinks
            );
            const newSettings = {
              ...getSettings(),
              enableNavCustomization: tabs["nav-settings"].querySelector(
                "#s1p-enableNavCustomization"
              ).checked,
              customNavLinks: normalizedCustomNavLinks,
            };
            saveSettings(newSettings);
            setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.NAV_SETTINGS, false);
            initializeNavbar();
            if (normalizedCustomNavLinks.length < rawCustomNavLinks.length) {
              showMessage("检测到不安全导航链接，已自动忽略。", false);
            }
            showMessage("设置已保存！", true);
          }
        }
      );
    };

    renderGeneralSettingsTab();
    renderThreadTab();
    renderUserTab();
    renderTagsTab();
    renderBookmarksTab();
    renderNavSettingsTab();

    let handleTabSliderLayoutChange = null;
    let tabSliderResizeObserver = null;
    const closeManagementModal = () => {
      if (
        settingsModalCrossTabSyncController &&
        settingsModalCrossTabSyncController.modalElement === modal
      ) {
        settingsModalCrossTabSyncController = null;
      }
      if (handleTabSliderLayoutChange) {
        window.removeEventListener("resize", handleTabSliderLayoutChange);
      }
      if (tabSliderResizeObserver) {
        tabSliderResizeObserver.disconnect();
      }
      if (modalThemeSyncTimer) {
        window.clearInterval(modalThemeSyncTimer);
        modalThemeSyncTimer = 0;
      }
      modal.remove();
    };
    const shouldRefreshModalTabByPaths = (changedPathSet, watchedPaths) => {
      if (!(changedPathSet instanceof Set) || changedPathSet.size === 0) {
        return true;
      }
      return watchedPaths.some((path) =>
        hasSettingPathInChangedSet(changedPathSet, path)
      );
    };
    const refreshOpenSettingsModalByChangedPaths = ({
      changedPathSet = new Set(),
      forceFullApply = false,
    } = {}) => {
      if (!modal.isConnected) {
        return;
      }
      const shouldRefreshGeneralTab =
        forceFullApply ||
        shouldRefreshModalTabByPaths(changedPathSet, [
          "enableGeneralSettings",
          "enableReadProgress",
          "readingProgressCleanupDays",
          "cleanupMode",
          "openInNewTab",
          "showReadIndicator",
          "autoLinkPlainTextUrls",
          "hideImagesByDefault",
          "limitImagesBySize",
          "useS1PlusImageViewer",
          "imagePreviewMaxWidth",
          "imagePreviewMaxHeight",
          "hideSystemBlockedPosts",
          "recommendS1Nux",
          "enhanceFloatingControls",
          "changeLogoLink",
          "hideBlacklistTip",
          "customTitleSuffix",
        ]);
      const shouldRefreshThreadTab =
        forceFullApply ||
        shouldRefreshModalTabByPaths(changedPathSet, [
          "enablePostBlocking",
          "blockThreadsOnUserBlock",
          "syncWithNativeBlacklist",
          "showBlockedByKeywordList",
          "showManuallyBlockedList",
        ]);
      const shouldRefreshUserTab =
        forceFullApply ||
        shouldRefreshModalTabByPaths(changedPathSet, [
          "enableUserBlocking",
          "syncWithNativeBlacklist",
        ]);
      const shouldRefreshTagsTab =
        forceFullApply ||
        shouldRefreshModalTabByPaths(changedPathSet, ["enableUserTagging"]);
      const shouldRefreshBookmarksTab =
        forceFullApply ||
        shouldRefreshModalTabByPaths(changedPathSet, ["enableBookmarkReplies"]);
      const shouldRefreshNavTab =
        forceFullApply ||
        shouldRefreshModalTabByPaths(changedPathSet, [
          "enableNavCustomization",
          "customNavLinks",
        ]);
      const shouldRefreshSyncTab =
        forceFullApply ||
        shouldRefreshModalTabByPaths(changedPathSet, [
          "syncRemoteEnabled",
          "syncDailyFirstLoad",
          "syncAutoEnabled",
          "syncShowAutoSyncIndicator",
          "syncForcePullOnStartup",
          "syncDirectChoiceMode",
          "syncBookmarkFullContent",
          "syncRemoteGistId",
          "syncRemotePat",
          "syncTokenExpiryEnabled",
          "syncTokenExpiryDate",
        ]);
      const deferredDirtyTabLabels = [];

      if (shouldRefreshGeneralTab) {
        renderGeneralSettingsTab();
      }
      if (shouldRefreshThreadTab) {
        if (isSettingsModalDirty(SETTINGS_MODAL_DIRTY_TAB.THREAD_RULES)) {
          deferredDirtyTabLabels.push("帖子屏蔽");
        } else {
          renderThreadTab();
        }
      }
      if (shouldRefreshUserTab) {
        renderUserTab();
      }
      if (shouldRefreshTagsTab) {
        renderTagsTab();
      }
      if (shouldRefreshBookmarksTab) {
        renderBookmarksTab();
      }
      if (shouldRefreshNavTab) {
        if (isSettingsModalDirty(SETTINGS_MODAL_DIRTY_TAB.NAV_SETTINGS)) {
          deferredDirtyTabLabels.push("导航栏定制");
        } else {
          renderNavSettingsTab();
        }
      }
      if (shouldRefreshSyncTab) {
        if (isSettingsModalDirty(SETTINGS_MODAL_DIRTY_TAB.SYNC_SETTINGS)) {
          deferredDirtyTabLabels.push("设置同步");
        } else {
          refreshSyncTabControlsFromSettings();
        }
      }
      if (deferredDirtyTabLabels.length > 0) {
        notifySettingsModalDirtyTabDeferredRefresh(deferredDirtyTabLabels);
      }
    };
    settingsModalCrossTabSyncController = {
      modalElement: modal,
      isAlive: () => modal.isConnected,
      sync: ({ changedPathSet = new Set(), forceFullApply = false } = {}) => {
        refreshOpenSettingsModalByChangedPaths({ changedPathSet, forceFullApply });
      },
    };

    const tabContainer = modal.querySelector(".s1p-tabs");
    const syncTabSliderLayout = () => moveTabSlider(tabContainer);
    scheduleTabSliderSync(tabContainer);
    handleTabSliderLayoutChange = syncTabSliderLayout;
    window.addEventListener("resize", handleTabSliderLayoutChange, {
      passive: true,
    });
    if (typeof ResizeObserver === "function") {
      tabSliderResizeObserver = new ResizeObserver(syncTabSliderLayout);
      tabSliderResizeObserver.observe(tabContainer);
    }

    modal.style.transition = "opacity 0.2s ease-out";
    requestAnimationFrame(() => {
      modal.style.opacity = "1";
    });
    // [REPLACE ENTIRE EVENT LISTENER BLOCK]
    modal.addEventListener("change", (e) => {
      const target = e.target;
      const settings = getSettingsForWrite();
      const featureKey = target.dataset.feature;
      const settingKey = target.dataset.setting;

      if (settingKey) {
        const value =
          target.type === "checkbox"
            ? target.checked
            : target.type === "number" || target.tagName === "SELECT"
              ? parseInt(target.value, 10)
              : target.value;

        // [MODIFIED] 使用新的辅助函数来处理嵌套和非嵌套设置
        setNestedValue(settings, settingKey, value);
        saveSettings(settings);

        if (settingKey === "enhanceFloatingControls") {
          applyChanges();
          return;
        }

        applyInterfaceCustomizations();
        if (settingKey === "showReadIndicator" && !target.checked) {
          updateReadIndicatorUI(null);
        }
        if (settingKey === "hideImagesByDefault") {
          applyImageHiding();
          manageImageToggleAllButtons();
          applyS1pImageViewerBehavior();
        }
        if (
          settingKey === "limitImagesBySize" ||
          settingKey === "imagePreviewMaxWidth" ||
          settingKey === "imagePreviewMaxHeight"
        ) {
          const latestSettings = getSettings();
          if (
            settingKey === "imagePreviewMaxWidth" ||
            settingKey === "imagePreviewMaxHeight"
          ) {
            target.value = String(latestSettings[settingKey]);
          }
          const imageLimitPanel = modal.querySelector("#s1p-image-size-limit-panel");
          if (imageLimitPanel) {
            imageLimitPanel.classList.toggle(
              "is-enabled",
              latestSettings.limitImagesBySize === true
            );
          }
          applyImageSizeLimits();
          applyS1pImageViewerBehavior();
        }
        // [MODIFIED] 当任何一个新标签页设置改变时，都重新应用全局行为
        if (settingKey === "useS1PlusImageViewer") {
          applyS1pImageViewerBehavior();
        }
        if (settingKey === "autoLinkPlainTextUrls") {
          applyPlainTextUrlAutolinks();
        }
        if (settingKey.startsWith("openInNewTab.")) {
          applyGlobalLinkBehavior();
          // 如果是阅读进度相关的设置改变了，则刷新按钮
          if (settingKey.includes("progress")) {
            removeProgressJumpButtons();
            addProgressJumpButtons();
          }
        }
        if (settingKey === "hideSystemBlockedPosts") {
          hideSystemBlockedPosts();
        }
      }

      if (featureKey && target.classList.contains("s1p-feature-toggle")) {
        let contentWrapper =
          target.closest(".s1p-settings-item")?.nextElementSibling;
        if (
          !contentWrapper ||
          !contentWrapper.classList.contains("s1p-feature-content")
        ) {
          contentWrapper = target.closest(
            ".s1p-settings-group"
          )?.nextElementSibling;
        }

        const modalBody = modal.querySelector(".s1p-modal-body");

        if (
          !modalBody ||
          !contentWrapper ||
          !contentWrapper.classList.contains("s1p-feature-content")
        ) {
          console.warn(
            "S1 Plus Debug: Animation structure not found for this toggle, but will proceed with saving."
          );
        }

        const isChecked = target.checked;
        settings[featureKey] = isChecked;
        saveSettings(settings);

        if (
          contentWrapper &&
          contentWrapper.classList.contains("s1p-feature-content")
        ) {
          const oldHeight = modalBody.offsetHeight;
          modalBody.style.height = `${oldHeight}px`;
          contentWrapper.classList.toggle("expanded", isChecked);
          requestAnimationFrame(() => {
            modalBody.style.height = "auto";
            const newHeight = modalBody.offsetHeight;
            modalBody.style.height = `${oldHeight}px`;
            requestAnimationFrame(() => {
              modalBody.style.height = `${newHeight}px`;
            });
          });
          modalBody.addEventListener(
            "transitionend",
            function onEnd() {
              modalBody.removeEventListener("transitionend", onEnd);
              modalBody.style.height = "auto";
            },
            { once: true }
          );
        }

        switch (featureKey) {
          case "enableGeneralSettings":
            applyInterfaceCustomizations();
            applyGlobalLinkBehavior();
            applyImageHiding();
            manageImageToggleAllButtons();
            applyImageSizeLimits();
            applyS1pImageViewerBehavior();
            if (isChecked) {
              addProgressJumpButtons();
            } else {
              removeProgressJumpButtons();
              updateReadIndicatorUI(null);
            }
            renderGeneralSettingsTab();
            break;
          case "enablePostBlocking":
            isChecked
              ? addBlockButtonsToThreads()
              : removeBlockButtonsFromThreads();
            refreshAllAuthiActions();
            if (isChecked) {
              hideBlockedPosts();
            } else {
              Object.keys(getBlockedPosts()).forEach(showPost);
            }
            renderThreadTab();
            break;
          case "enableUserBlocking":
            refreshAllAuthiActions();
            if (isChecked) {
              hideBlockedUsersPosts();
            } else {
              Object.keys(getBlockedUsers()).forEach(showUserPosts);
            }
            hideBlockedUserQuotes();
            hideBlockedUserRatings();
            hideBlockedUserNotifications();
            renderUserTab();
            break;
          case "enableUserTagging":
            refreshAllAuthiActions();
            renderTagsTab();
            break;
          case "enableReadProgress":
            renderGeneralSettingsTab();
            if (isChecked) {
              addProgressJumpButtons();
              trackReadProgressInThread();
            } else {
              removeProgressJumpButtons();
              updateReadIndicatorUI(null);
              resetReadProgressObserver({
                clearObservedMarkers: true,
                flushPendingProgress: true,
              });
            }
            break;
          case "enableBookmarkReplies":
            refreshAllAuthiActions();
            renderBookmarksTab();
            break;
          case "enableNavCustomization":
            initializeNavbar();
            renderNavSettingsTab(); // 重新渲染以更新其内部的设置状态
            break;
        }
        return;
      } else if (target.matches(".s1p-user-thread-block-toggle")) {
        const userId = target.dataset.userId;
        const blockThreads = target.checked;
        const users = getBlockedUsers();
        const userEntry = users[userId];
        if (userEntry) {
          const nextUsers = {
            ...users,
            [userId]: {
              ...userEntry,
              blockThreads: blockThreads,
            },
          };
          saveBlockedUsers(nextUsers);
          if (blockThreads) applyUserThreadBlocklist();
          else unblockThreadsByUser(userId);
          renderThreadTab();
        }
      } else if (target.matches("#s1p-blockThreadsOnUserBlock")) {
        const currentSettings = getSettingsForWrite();
        currentSettings.blockThreadsOnUserBlock = target.checked;
        saveSettings(currentSettings);
      }
    });

    const renderEmptyState = (container, text, inlineStyle = "") => {
      if (!container) return;
      const summaryEl = container.querySelector(".s1p-list-summary");
      container
        .querySelectorAll(".s1p-list, .s1p-thread-groups, .s1p-empty")
        .forEach((node) => node.remove());
      const targetContainer =
        summaryEl instanceof Element && summaryEl.parentElement
          ? summaryEl.parentElement
          : container;
      const emptyEl = document.createElement("div");
      emptyEl.className = "s1p-empty";
      if (inlineStyle) {
        emptyEl.style.cssText = inlineStyle;
      }
      emptyEl.textContent = text;
      targetContainer.appendChild(emptyEl);
    };

    function removeListItem(triggerElement, emptyText, onEmptyCallback) {
      const item = triggerElement.closest(".s1p-item");
      if (!item) return;

      const list = item.parentElement;
      item.remove();

      if (list && list.children.length === 0) {
        const container = list.parentElement;
        renderEmptyState(container, emptyText);
        if (onEmptyCallback) {
          onEmptyCallback(container);
        }
      }
    }

    modal.addEventListener("click", async (e) => {
      const target = e.target;
      if (e.target.matches(".s1p-modal, .s1p-modal-close")) closeManagementModal();
      if (e.target.matches(".s1p-tab-btn")) {
        const tabContainer = e.target.closest(".s1p-tabs");
        modal
          .querySelectorAll(".s1p-tab-btn, .s1p-tab-content")
          .forEach((el) => el.classList.remove("active"));
        e.target.classList.add("active");
        const activeTab = tabs[e.target.dataset.tab];
        if (activeTab) activeTab.classList.add("active");
        moveTabSlider(tabContainer);
      }

      if (target.id === "s1p-manual-block-user-btn") {
        openManualUserBlockModal();
        return;
      }
      if (target.id === "s1p-open-native-blacklist-import-btn") {
        try {
          if (typeof GM_openInTab === "function") {
            GM_openInTab(NATIVE_BLACKLIST_VIEW_URL, {
              active: true,
              insert: true,
              setParent: true,
            });
          } else {
            window.open(NATIVE_BLACKLIST_VIEW_URL, "_blank", "noopener");
          }
        } catch (error) {
          console.error("S1 Plus: 打开论坛黑名单页面失败。", error);
          window.open(NATIVE_BLACKLIST_VIEW_URL, "_blank", "noopener");
        }
        return;
      }

      const unblockThreadId = e.target.dataset.unblockThreadId;
      if (unblockThreadId) {
        const item = target.closest(".s1p-item");
        const title = item
          ? item.querySelector(".s1p-item-title").textContent.trim()
          : `帖子 #${unblockThreadId}`;
        createConfirmationModal(
          "确认取消屏蔽该帖子吗？",
          `帖子标题: ${title}`,
              () => {
                unblockThread(unblockThreadId);
                removeListItem(
                  target,
                  "暂无手动屏蔽的帖子"
                );
                setListSummaryText(
                  "s1p-manually-blocked-summary",
                  Object.keys(getBlockedThreads()).length,
                  "条手动屏蔽帖子"
                );
                showMessage("帖子已取消屏蔽。", true);
              },
              "确认取消"
            );
      }

      const unblockUserId = e.target.dataset.unblockUserId;
      if (unblockUserId) {
        const item = target.closest(".s1p-item");

        // 通过克隆、移除状态元素的方式，来安全地获取纯净的用户名。
        let userName;
        if (item) {
          const titleEl = item.querySelector(".s1p-item-title");
          if (titleEl) {
            const titleClone = titleEl.cloneNode(true);
            const statusSpan = titleClone.querySelector(
              ".s1p-native-sync-status"
            );
            if (statusSpan) {
              statusSpan.remove();
            }
            userName = titleClone.textContent.trim();
          } else {
            userName = `用户 #${unblockUserId}`;
          }
        } else {
          userName = `用户 #${unblockUserId}`;
        }

        createConfirmationModal(
          `确认取消屏蔽 “${userName}” 吗？`,
          "该用户及其主题帖（如果已关联屏蔽）将被取消屏蔽。",
          async () => {
            const allBlockedThreads = getBlockedThreads();
            const threadsToUnblock = Object.keys(allBlockedThreads).filter(
              (threadId) =>
                allBlockedThreads[threadId].reason === `user_${unblockUserId}`
            );

            const blockedUsers = getBlockedUsers();
            const userToUnblockData = blockedUsers[unblockUserId];
            const wasSynced =
              userToUnblockData?.addedToNativeBlacklist === true;

            const success = await unblockUser(unblockUserId);

            if (success) {
              removeListItem(
                target,
                "暂无屏蔽的用户"
              );
              setListSummaryText(
                "s1p-blocked-user-list-summary",
                Object.keys(getBlockedUsers()).length,
                "位屏蔽用户"
              );

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
                    renderEmptyState(container, "暂无手动屏蔽的帖子");
                  }
                }
              }
              setListSummaryText(
                "s1p-manually-blocked-summary",
                Object.keys(getBlockedThreads()).length,
                "条手动屏蔽帖子"
              );
              const message = wasSynced
                ? `已取消对 ${userName} 的屏蔽并从论坛同步移除。`
                : `已取消对 ${userName} 的屏蔽。`;
              showMessage(message, true);
            } else {
              const failureMessage = wasSynced
                ? `取消失败：无法从论坛黑名单移除，已保留本地屏蔽状态。`
                : `取消失败：请稍后重试。`;
              showMessage(failureMessage, false);
            }
          },
          "确认取消"
        );
      }

      const unblockPostId = e.target.dataset.unblockPostId;
      if (unblockPostId) {
        const item = target.closest(".s1p-item");
        const title = item
          ? item.querySelector(".s1p-item-title").textContent.trim()
          : `楼层 #${unblockPostId}`;
        createConfirmationModal(
          "确认取消屏蔽该楼层吗？",
          `楼层信息: ${title}`,
          () => {
            unblockPost(unblockPostId);

            // 对于分组列表，需要特殊处理
            const threadGroup = item.closest(".s1p-thread-group");
            if (threadGroup) {
              // 移除当前楼层项
              item.remove();

              // 检查该帖子分组是否还有其他楼层
              const remainingPosts = threadGroup.querySelector(".s1p-list");
              if (remainingPosts && remainingPosts.children.length === 0) {
                // 如果该帖子没有其他楼层了，移除整个帖子分组
                threadGroup.remove();
              }

              // 检查是否还有任何帖子分组
              const threadGroups = document.querySelector(".s1p-thread-groups");
              if (threadGroups && threadGroups.children.length === 0) {
                // 如果没有任何帖子分组了，显示空提示
                const container = document.querySelector("#s1p-blocked-posts-list-container");
                if (container) {
                  renderEmptyState(container, "暂无屏蔽的楼层");
                }
              }
              } else {
                // 非分组列表的处理（向后兼容）
                removeListItem(
                  target,
                  "暂无屏蔽的楼层"
                );
              }
              setListSummaryText(
                "s1p-blocked-posts-summary",
                Object.keys(getBlockedPosts()).length,
                "条屏蔽楼层"
              );

              showMessage("楼层已取消屏蔽。", true);
            },
            "确认取消"
        );
      }

      const removeBookmarkId = target.closest('[data-action="remove-bookmark"]')
        ?.dataset.postId;
      if (removeBookmarkId) {
        createConfirmationModal(
          "确认取消收藏该回复吗？",
          "此操作将从您的收藏列表中永久移除该条目。",
          () => {
            const bookmarks = getBookmarkedReplies();
            delete bookmarks[removeBookmarkId];
            saveBookmarkedReplies(bookmarks);
            refreshSinglePostActions(removeBookmarkId);
            removeListItem(
              target,
              "暂无收藏的回复",
              () => {
                document
                  .querySelector("#s1p-bookmark-search-input")
                  ?.closest(".s1p-settings-group")
                  ?.remove();
              }
            );
            setListSummaryText(
              "s1p-bookmarks-list-summary",
              Object.keys(getBookmarkedReplies()).length,
              "条收藏回复"
            );
            showMessage("已取消收藏。", true);
          },
          "确认取消"
        );
      }

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
              setSettingsModalDirtyState(
                SETTINGS_MODAL_DIRTY_TAB.SYNC_SETTINGS,
                false
              );
              setSettingsModalDirtyState(
                SETTINGS_MODAL_DIRTY_TAB.NAV_SETTINGS,
                false
              );
              setSettingsModalDirtyState(
                SETTINGS_MODAL_DIRTY_TAB.THREAD_RULES,
                false
              );
              remoteToggle.checked = false;
              dailySyncToggle.checked = true;
              autoSyncToggle.checked = true;
              bookmarkFullContentToggle.checked = false;
              remoteGistIdInput.value = "";
              remotePatInput.value = "";
              updateRemoteSyncInputsState();
            }

            const currentSettingsSnapshot = getSettings();
            restoreManagedVisibilityAfterDataImport(currentSettingsSnapshot);

            if (currentSettingsSnapshot.enablePostBlocking) {
              hideBlockedThreads();
              hideBlockedPosts();
              applyUserThreadBlocklist();
              hideThreadsByTitleKeyword();
            } else {
              document.querySelectorAll(".s1p-hidden-by-keyword").forEach((row) => {
                row.classList.remove("s1p-hidden-by-keyword");
              });
              dynamicallyHiddenThreads = {};
            }

            if (currentSettingsSnapshot.enableUserBlocking) {
              hideBlockedUsersPosts();
            }
            hideBlockedUserQuotes();
            hideBlockedUserRatings();
            hideBlockedUserNotifications();
            initializeNavbar();
            applyInterfaceCustomizations();
            if (currentSettingsSnapshot.enableReadProgress) {
              addProgressJumpButtons();
            } else {
              removeProgressJumpButtons();
            }

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

      if (e.target.closest("#s1p-toggle-pat-visibility")) {
        const input = modal.querySelector("#s1p-remote-pat-input");
        const btn = modal.querySelector("#s1p-toggle-pat-visibility");
        if (input.type === "password") {
          input.type = "text";
          setSanitizedIconHtml(btn, SVG_ICON_EYE_SLASH);
        } else {
          input.type = "password";
          setSanitizedIconHtml(btn, SVG_ICON_EYE);
        }
      }

      if (e.target.id === "s1p-remote-save-btn") {
        const button = e.target;
        const manualSyncButton = modal.querySelector("#s1p-remote-manual-sync-btn");
        button.disabled = true;
        if (manualSyncButton) {
          manualSyncButton.disabled = true;
        }
        button.textContent = "正在保存...";

        try {
          const previousSettings = getSettings();
          const currentSettings = { ...previousSettings };
          currentSettings.syncRemoteEnabled = remoteToggle.checked;
          currentSettings.syncDailyFirstLoad = dailySyncToggle.checked;
          currentSettings.syncAutoEnabled = autoSyncToggle.checked;
          currentSettings.syncShowAutoSyncIndicator =
            autoSyncIndicatorToggle.checked;
          currentSettings.syncForcePullOnStartup =
            dailySyncToggle.checked && forcePullToggle.checked;
          currentSettings.syncDirectChoiceMode =
            directChoiceModeToggle?.checked === true;
          currentSettings.syncBookmarkFullContent =
            bookmarkFullContentToggle.checked;
          currentSettings.syncRemoteGistId = remoteGistIdInput.value.trim();
          currentSettings.syncRemotePat = remotePatInput.value.trim();
          currentSettings.syncTokenExpiryEnabled = modal.querySelector(
            "#s1p-token-expiry-reminder-toggle"
          ).checked;
          currentSettings.syncTokenExpiryDate = pendingTokenExpiryDate;
          const didRemoteTargetChange =
            String(previousSettings.syncRemoteGistId || "").trim() !==
            currentSettings.syncRemoteGistId;
          const didDisableRemoteSync =
            previousSettings.syncRemoteEnabled === true &&
            currentSettings.syncRemoteEnabled !== true;
          const didPatChange =
            String(previousSettings.syncRemotePat || "").trim() !==
            currentSettings.syncRemotePat;

          const shouldMarkSyncedDataChange = hasSyncedSettingsChanged(
            previousSettings,
            currentSettings
          );
          saveSettings(currentSettings, {
            suppressSyncTrigger: true,
            markDataChangedWhenSuppressed: shouldMarkSyncedDataChange,
          });
          if (didRemoteTargetChange || didDisableRemoteSync) {
            // 远端目标切换/关闭远程同步后，清理旧会话残留状态，避免新目标沿用旧基线造成误判。
            GM_deleteValue(SYNC_BASELINE_STATE_KEY);
            clearPendingAutoSyncRequest();
            clearAutoSyncConflictPause();
            clearAutoSyncRuntimeQueue();
            resetAutoSyncFailureState();
            setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_IDLE);
          }
          setSettingsModalDirtyState(SETTINGS_MODAL_DIRTY_TAB.SYNC_SETTINGS, false);
          updateNavbarSyncButton();

          if (
            currentSettings.syncRemoteEnabled &&
            currentSettings.syncRemoteGistId &&
            currentSettings.syncRemotePat
          ) {
            if (didPatChange) {
              showMessage("设置已保存，正在验证新的 Token 凭据...", null);
              try {
                await fetchRemoteData({ metadataOnly: true });
                // PAT 验证成功后，仅重置失败熔断状态，不影响 baseline。
                resetAutoSyncFailureState();
                if (!getActiveAutoSyncConflictPause()) {
                  setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_IDLE);
                }
              } catch (probeError) {
                const probeErrorMessage = String(probeError?.message || "");
                const isAuthRejected =
                  /(?:状态码|HTTP)\s*[: ]?\s*(401|403)\b/i.test(
                    probeErrorMessage
                  ) || /bad credentials|requires authentication/i.test(
                    probeErrorMessage
                  );
                if (isAuthRejected) {
                  showMessage(
                    "新 Token 验证失败：认证被拒绝（401/403）。请检查 Token 权限、有效期和 Gist 访问范围。",
                    false
                  );
                  return;
                }
                showMessage(
                  `Token 验证未完成（${probeErrorMessage || "网络异常"
                  }），将继续尝试首次同步检查...`,
                  false
                );
              }
            }
            showMessage("设置已保存，正在启动首次同步检查...", null);
            await handleManualSync(false, true); // 标记为首次设置
          } else {
            showMessage("远程同步设置已保存。", true);
          }
        } finally {
          button.disabled = false;
          button.textContent = "保存设置";
          if (manualSyncButton) {
            manualSyncButton.disabled = false;
          }
          updateRemoteSyncInputsState();
        }
      }

      if (e.target.id === "s1p-remote-manual-sync-btn") {
        const manualSyncButton = e.target;
        const saveButton = modal.querySelector("#s1p-remote-save-btn");
        if (manualSyncButton.disabled) {
          return;
        }

        const originalButtonText = manualSyncButton.textContent;
        manualSyncButton.disabled = true;
        manualSyncButton.textContent = "同步中...";
        if (saveButton) {
          saveButton.disabled = true;
        }

        try {
          await handleManualSync();
        } finally {
          manualSyncButton.textContent = originalButtonText;
          manualSyncButton.disabled = false;
          if (saveButton) {
            saveButton.disabled = false;
          }
          updateRemoteSyncInputsState();
        }
      }

      if (e.target.id === "s1p-sync-diagnostics-copy-btn") {
        const diagnosticsText = buildSyncDiagnosticsSummary();
        try {
          await navigator.clipboard.writeText(diagnosticsText);
          showMessage("同步诊断已复制到剪贴板。", true);
        } catch (_) {
          const tempTextarea = document.createElement("textarea");
          tempTextarea.value = diagnosticsText;
          tempTextarea.style.position = "fixed";
          tempTextarea.style.opacity = "0";
          tempTextarea.style.pointerEvents = "none";
          document.body.appendChild(tempTextarea);
          tempTextarea.focus();
          tempTextarea.select();
          try {
            const copied = document.execCommand("copy");
            showMessage(
              copied
                ? "同步诊断已复制到剪贴板。"
                : "复制失败，请稍后重试。",
              copied
            );
          } finally {
            tempTextarea.remove();
          }
        }
      }

      if (e.target.id === "s1p-sync-diagnostics-reset-btn") {
        createConfirmationModal(
          "确认重置同步诊断吗？",
          "将清空最近同步成功/失败/冲突记录，不影响实际同步数据。",
          () => {
            resetSyncDiagnostics();
            updateLastSyncTimeDisplay();
            showMessage("同步诊断已重置。", true);
          },
          "确认重置"
        );
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
                "暂无用户标记"
              );
              showMessage(`已删除对 ${userName} 的标记。`, true);
            },
            "确认删除"
          );
        } else if (action === "save-tag-edit") {
          const userName = target.dataset.userName;
          const itemEl = targetTab.querySelector(`.s1p-item[data-user-id="${userId}"]`);
          const newTag = itemEl.querySelector(".s1p-tag-edit-area").value.trim();
          const selectedColorOpt = itemEl.querySelector(".s1p-color-option.selected");
          const newColor = selectedColorOpt ? selectedColorOpt.dataset.color : "";
          const tags = getUserTags();
          if (newTag) {
            tags[userId] = {
              ...tags[userId],
              tag: newTag,
              color: newColor,
              timestamp: Date.now(),
              name: userName,
            };
            saveUserTags(tags);
            refreshUserPostsOnPage(userId);
            renderTagsTab();
            showMessage(`已更新对 ${userName} 的标记。`, true);
          } else {
            createConfirmationModal(
              `标记内容为空`,
              "您希望删除对该用户的标记吗？",
              () => {
                delete tags[userId];
                saveUserTags(tags);
                refreshUserPostsOnPage(userId);
                renderTagsTab();
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
            if (!isObjectRecord(imported))
              throw new Error("无效数据格式，应为一个对象。");
            const sanitizedImported = sanitizeRecordObject(imported);
            Object.keys(sanitizedImported).forEach((key) => {
              const item = sanitizedImported[key];
              if (
                typeof item !== "object" ||
                item === null ||
                typeof item.tag === "undefined" ||
                typeof item.name === "undefined"
              )
                throw new Error(`用户 #${key} 的数据格式不正确。`);
            });
            createConfirmationModal(
              "确认导入用户标记吗？",
              "导入的数据将覆盖现有相同用户的标记。",
              () => {
                const currentTags = getUserTags();
                const mergedTags = { ...currentTags, ...sanitizedImported };
                saveUserTags(mergedTags);
                renderTagsTab();
                showMessage(
                  `成功导入/更新 ${Object.keys(sanitizedImported).length} 条用户标记。`,
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
   * [MODIFIED V4] 创建手动同步时的对比详情HTML (增加阅读进度智能更新提示)
   * @param {object} localDataObj - 本地数据对象
   * @param {object} remoteDataObj - 远程数据对象
   * @param {boolean} isConflict - 是否为冲突状态
   * @param {number} pendingCleanupCount - [S1PLUS-CLEANUP-FIX] 待处理计数
   * @returns {string} - 用于弹窗的HTML字符串
   */
  const createSyncComparisonHtml = (
    localDataObj,
    remoteDataObj,
    isConflict,
    pendingCleanupCount = 0,
    syncDecision = null
  ) => {
    const lastSyncInfo = GM_getValue("s1p_last_manual_sync_info", null);
    let lastActionHtml = "";
    if (lastSyncInfo && lastSyncInfo.timestamp && lastSyncInfo.action) {
      const actionText = lastSyncInfo.action === "push" ? "推送" : "拉取";
      const formattedTime = new Date(lastSyncInfo.timestamp).toLocaleString(
        "zh-CN",
        { hour12: false }
      );
      lastActionHtml = `<div class="s1p-sync-last-action">这台电脑上次手动操作: 于 ${formattedTime} <strong>${actionText}</strong>了数据</div>`;
    }

    // [融合版] 使用 Kyo 方案的解释性措辞，配合 Cosmo 方案的判断条件
    let cleanupNoticeHtml = "";
    if (isConflict && pendingCleanupCount > 0) {
      cleanupNoticeHtml = `
        <div class="s1p-notice s1p-notice-top16">
            <div class="s1p-notice-icon"></div>
            <div class="s1p-notice-content">根据您的设置，S1 Plus 自动清理了 <strong>${pendingCleanupCount}</strong> 条陈旧的阅读记录，导致本地数据与云端不一致。</div>
        </div>
      `;
    }

    const localNewer =
      syncDecision && typeof syncDecision === "object"
        ? syncDecision.localNewer === true
        : false;
    let title = "";
    if (isConflict) {
      title = `<h2 class="s1p-sync-conflict-title">检测到同步冲突！</h2><p>无法安全自动判定新旧，请仔细选择要保留的版本。</p>`;
    } else if (localNewer) {
      title = `<h2>本地数据较新</h2><p>建议选择“推送”以更新云端备份。</p>`;
    } else {
      title = `<h2>云端备份较新</h2><p>建议选择“拉取”以更新本地数据。</p>`;
    }

    const formatTime = (ts) =>
      new Date(ts || 0).toLocaleString("zh-CN", { hour12: false });
    const localTime = formatTime(localDataObj.lastUpdated);
    const remoteTime = formatTime(remoteDataObj.lastUpdated);
    const newerBadge = '<span class="s1p-newer-badge">(较新)</span>';

    const categories = [
      { label: "屏蔽用户", key: "users" },
      { label: "屏蔽帖子", key: "threads" },
      { label: "用户标记", key: "user_tags" },
      { label: "回复收藏", key: "bookmarked_replies" },
      { label: "标题规则", key: "title_filter_rules" },
      { label: "阅读进度", key: "read_progress" },
    ];

    const sortAndStringify = (obj) => {
      // 一个简化的确定性序列化，用于对比
      if (!obj || typeof obj !== "object") return JSON.stringify(obj);
      return JSON.stringify(
        Object.keys(obj)
          .sort()
          .reduce((result, key) => {
            result[key] = obj[key];
            return result;
          }, Object.create(null))
      );
    };

    const tableRows = categories
      .map((cat) => {
        const localData = localDataObj.data[cat.key] || {};
        const remoteData = remoteDataObj.data[cat.key] || {};
        const localCount = Object.keys(localData).length;
        const remoteCount = Object.keys(remoteData).length;

        let localBadge = "";
        let remoteBadge = "";

        // [核心升级] 仅对“阅读进度”进行智能更新检查
        if (
          cat.key === "read_progress" &&
          localCount === remoteCount &&
          localCount > 0
        ) {
          const localContentStr = sortAndStringify(localData);
          const remoteContentStr = sortAndStringify(remoteData);

          if (localContentStr !== remoteContentStr) {
            // 内容不一致，根据整体时间戳判断哪边是更新的
            const updateBadge =
              '<span class="s1p-progress-update-badge">(内容更新)</span>';
            if (localNewer) {
              localBadge = updateBadge;
            } else {
              remoteBadge = updateBadge;
            }
          }
        }

        return `
            <div class="s1p-sync-comparison-row">
                <div class="s1p-sync-comparison-label">${cat.label}</div>
                <div class="s1p-sync-comparison-value">${localCount} ${localBadge}</div>
                <div class="s1p-sync-comparison-value">${remoteCount} ${remoteBadge}</div>
            </div>
        `;
      })
      .join("");

    return `
        ${title}
        ${cleanupNoticeHtml}
        ${lastActionHtml}
        <div class="s1p-sync-comparison-table">
            <div class="s1p-sync-comparison-row s1p-sync-comparison-header">
                <div>数据项</div>
                <div>本地数量</div>
                <div>云端数量</div>
            </div>
            ${tableRows}
            <div class="s1p-sync-comparison-row">
                <div class="s1p-sync-comparison-label">最后更新</div>
                <div class="s1p-sync-comparison-value">${localTime} ${localNewer && !isConflict ? newerBadge : ""
      }</div>
                <div class="s1p-sync-comparison-value">${remoteTime} ${!localNewer && !isConflict ? newerBadge : ""
      }</div>
            </div>
        </div>
    `;
  };

  /**
   * [NEW] 获取当前页面的帖子ID
   * @returns {string|null} 帖子ID或null
   */
  const getCurrentThreadId = () => {
    const threadIdMatch = window.location.href.match(/thread-(\d+)-/);
    if (threadIdMatch && threadIdMatch[1]) {
      return threadIdMatch[1];
    }
    const params = new URLSearchParams(window.location.search);
    const tid = params.get("tid") || params.get("ptid");
    if (tid) {
      return tid;
    }
    const tidInput = document.querySelector('input[name="tid"]#tid');
    if (tidInput && tidInput.value) {
      return tidInput.value;
    }
    return null;
  };

  const handleManualSync = async (
    suppressInitialMessage = false,
    isInitialSetup = false
  ) => {
    const MANUAL_SYNC_LOCK_BUSY_MESSAGE =
      "当前有其他同步任务正在执行，本次手动同步已跳过，请稍后再试。";
    const MANUAL_SYNC_LOCK_LOST_MESSAGE =
      "手动同步锁已失效，本次任务已中止，请重新发起同步。";

    if (manualSyncInFlightPromise) {
      if (!suppressInitialMessage) {
        showMessage("手动同步正在进行，请稍候...", null);
      }
      return manualSyncInFlightPromise;
    }
    if (forceSyncInFlight) {
      if (!suppressInitialMessage) {
        showMessage("手动同步正在进行，请稍候...", null);
      }
      return false;
    }

    if (!(await acquireManualSyncLock())) {
      showMessage(MANUAL_SYNC_LOCK_BUSY_MESSAGE, false);
      return false;
    }
    startManualSyncLockHeartbeat();
    let manualSyncLockHeldByThisRun = true;

    const assertManualSyncLockOwned = (stage) => {
      assertSyncLockOwned(SYNC_LOCK_MODE_MANUAL, `manual_sync:${stage}`);
    };
    const runWithManualSyncLockGuard = async (stage, callback) => {
      assertManualSyncLockOwned(`${stage}:before`);
      const result = await callback();
      assertManualSyncLockOwned(`${stage}:after`);
      return result;
    };
    const releaseManualSyncLockForDecision = () => {
      if (!manualSyncLockHeldByThisRun) {
        return;
      }
      stopManualSyncLockHeartbeat();
      releaseManualSyncLock();
      manualSyncLockHeldByThisRun = false;
    };
    const ensureManualSyncLockForDecisionAction = async (stage) => {
      if (manualSyncLockHeldByThisRun && isSyncLockOwned(SYNC_LOCK_MODE_MANUAL)) {
        return true;
      }
      if (manualSyncLockHeldByThisRun) {
        stopManualSyncLockHeartbeat();
        releaseManualSyncLock();
        manualSyncLockHeldByThisRun = false;
      }
      if (!(await acquireManualSyncLock())) {
        showMessage(MANUAL_SYNC_LOCK_BUSY_MESSAGE, false);
        return false;
      }
      startManualSyncLockHeartbeat();
      manualSyncLockHeldByThisRun = true;
      assertManualSyncLockOwned(`${stage}:lock_ready`);
      return true;
    };

    manualSyncInFlightPromise = new Promise((resolve) => {
      (async () => {
        const settings = getSettings();
        if (
          !settings.syncRemoteEnabled ||
          !settings.syncRemoteGistId ||
          !settings.syncRemotePat
        ) {
          showMessage("远程同步未启用或配置不完整。", false);
          return resolve(false);
        }

        let remoteMetaUpdatedAt;
        recordSyncAttempt("manual", "manual_sync");
        const noteManualSuccess = (action, syncBaseline = null) => {
          clearPendingAutoSyncRequest();
          clearAutoSyncConflictPause();
          // 手动同步成功后，立即覆盖后台指示器的旧失败/冲突态，避免残留样式持续到 TTL 结束。
          setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_SUCCESS);
          if (syncBaseline) {
            setSyncBaselineState(syncBaseline);
          }
          resetAutoSyncFailureState();
          recordSyncSuccess(action, "manual");
          updateLastSyncTimeDisplay();
        };
        const noteManualFailure = (message) => {
          setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_FAILURE);
          recordSyncFailure(message, "manual");
          updateLastSyncTimeDisplay();
        };
        const noteManualConflict = (reason) => {
          clearPendingAutoSyncRequest();
          setAutoSyncIndicatorResolvedPhase(AUTO_SYNC_INDICATOR_PHASE_CONFLICT);
          recordSyncConflict(reason, "manual");
          updateLastSyncTimeDisplay();
        };
        const tryReacquireDecisionLock = async (stage) => {
          if (await ensureManualSyncLockForDecisionAction(stage)) {
            return true;
          }
          resolve(false);
          return false;
        };
        const resolveWithLockLostNotice = () => {
          showMessage(MANUAL_SYNC_LOCK_LOST_MESSAGE, false);
          resolve(false);
        };
        const handleManualLockLostError = (error) => {
          if (error?.code !== SYNC_LOCK_LOST_CODE) {
            return false;
          }
          resolveWithLockLostNotice();
          return true;
        };
        const fetchLatestValidatedRemoteForDecision = async (
          stageSuffix,
          emptyDataErrorMessage
        ) => {
          const { data: latestRawRemoteData, meta: latestMeta } =
            await runWithManualSyncLockGuard(
              `fetch_remote_data_${stageSuffix}`,
              () => fetchRemoteData()
            );
          if (Object.keys(latestRawRemoteData).length === 0) {
            throw new Error(emptyDataErrorMessage);
          }
          const latestRemoteDataObject = await runWithManualSyncLockGuard(
            `validate_remote_data_${stageSuffix}`,
            () => migrateAndValidateRemoteData(latestRawRemoteData)
          );
          return {
            remoteDataObject: latestRemoteDataObject,
            remoteUpdatedAt:
              typeof latestMeta?.updatedAt === "string"
                ? latestMeta.updatedAt
                : null,
          };
        };

        if (!suppressInitialMessage) {
          showMessage("正在检查云端数据...", null);
        }

        try {
          const { data: rawRemoteData, meta } = await runWithManualSyncLockGuard(
            "fetch_remote_data",
            () => fetchRemoteData()
          );
          remoteMetaUpdatedAt =
            typeof meta?.updatedAt === "string" ? meta.updatedAt : undefined;

          const remoteExists = Object.keys(rawRemoteData).length > 0;

          // [优化] 如果是首次设置且本地为空环境，且云端有数据，则直接引导拉取
          if (isInitialSetup && isLocalDataEmpty() && remoteExists) {
            await runWithManualSyncLockGuard(
              "validate_remote_data_for_initial_pull",
              () => migrateAndValidateRemoteData(rawRemoteData)
            );
            const pullAction = {
              text: "立即从云端恢复数据",
              className: "s1p-confirm",
              action: async () => {
                if (!(await tryReacquireDecisionLock("initial_pull_recover"))) {
                  return;
                }
                try {
                  const {
                    remoteDataObject: latestRemoteDataObj,
                    remoteUpdatedAt: latestRemoteUpdatedAt,
                  } = await fetchLatestValidatedRemoteForDecision(
                    "initial_pull_confirm",
                    "云端没有数据，无法恢复。"
                  );

                  const result = importLocalData(
                    JSON.stringify(latestRemoteDataObj.full),
                    {
                      suppressPostSync: true,
                    }
                  );
                  if (result.success) {
                    GM_setValue("s1p_last_sync_timestamp", Date.now());
                    noteManualSuccess("initial_pull_recover", {
                      contentHash: latestRemoteDataObj.contentHash,
                      remoteUpdatedAt: latestRemoteUpdatedAt,
                    });
                    showMessage("恢复成功！页面即将刷新。", true);
                    setTimeout(() => location.reload(), 1200);
                    resolve(true);
                  } else {
                    noteManualFailure(result.message);
                    showMessage(`恢复失败: ${result.message}`, false);
                    resolve(false);
                  }
                } catch (error) {
                  if (handleManualLockLostError(error)) {
                    return;
                  }
                  noteManualFailure(error?.message || "恢复失败");
                  showMessage(`恢复失败: ${error?.message || "未知错误"}`, false);
                  resolve(false);
                }
              },
            };
            const cancelAction = {
              text: "暂不恢复",
              className: "s1p-cancel",
              action: () => {
                showMessage("已跳过数据恢复。", null);
                resolve(null);
              },
            };
            releaseManualSyncLockForDecision();
            createAdvancedConfirmationModal(
              "初始化 S1 Plus 同步",
              "检测到这台电脑尚无本地数据，但云端已有备份，是否立即从云端恢复您的配置？",
              [pullAction, cancelAction],
              {
                modalClassName: "s1p-sync-modal",
                onDismiss: () => {
                  resolve(null);
                },
              }
            );
            return;
          }

          if (!remoteExists) {
            const pushAction = {
              text: "推送本地数据到云端",
              className: "s1p-confirm",
              action: async () => {
                if (!(await tryReacquireDecisionLock("initial_push_seed"))) {
                  return;
                }
                showMessage("正在向云端推送数据...", null);
                try {
                  const localData = await runWithManualSyncLockGuard(
                    "export_local_data_initial_push",
                    () => exportLocalDataObject()
                  );
                  const pushResult = await runWithManualSyncLockGuard(
                    "push_initial_local_data",
                    () =>
                      pushRemoteData(localData, {
                        expectedRemoteUpdatedAt: remoteMetaUpdatedAt,
                      })
                  );
                  GM_setValue("s1p_last_sync_timestamp", Date.now());
                  GM_setValue("s1p_last_manual_sync_info", {
                    action: "push",
                    timestamp: Date.now(),
                  });
                  noteManualSuccess("initial_push_seed", {
                    contentHash: localData.contentHash,
                    remoteUpdatedAt: pushResult?.updatedAt || null,
                  });
                  showMessage("推送成功！已初始化云端备份。", true);
                  resolve(true);
                } catch (e) {
                  if (e?.code === REMOTE_VERSION_CONFLICT_CODE) {
                    noteManualConflict("remote_changed_before_initial_push");
                    showMessage(
                      "推送失败：云端数据已变化，请重新执行手动同步。",
                      false
                    );
                    resolve(false);
                    return;
                  }
                  noteManualFailure(e.message);
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
            releaseManualSyncLockForDecision();
            createAdvancedConfirmationModal(
              "初始化云端同步",
              "<p>检测到云端备份为空，是否将当前本地数据作为初始版本推送到云端？</p>",
              [pushAction, cancelAction],
              {
                modalClassName: "s1p-sync-modal",
                allowBodyHtml: true,
                onDismiss: () => {
                  resolve(null);
                },
              }
            );
            return;
          }

          const remote = await runWithManualSyncLockGuard(
            "validate_remote_data",
            () => migrateAndValidateRemoteData(rawRemoteData)
          );
          const localDataObject = await runWithManualSyncLockGuard(
            "export_local_data",
            () => exportLocalDataObject()
          );
          const versionDecision = decideSyncActionByVersion({
            localDataObject,
            remoteDataObject: remote,
            remoteUpdatedAt: remoteMetaUpdatedAt,
          });

          if (remote.contentHash === localDataObject.contentHash) {
            showMessage("数据已是最新，无需同步。", true);
            GM_setValue("s1p_last_sync_timestamp", Date.now());
            noteManualSuccess("no_change", {
              contentHash: localDataObject.contentHash,
              remoteUpdatedAt: remoteMetaUpdatedAt || null,
            });
            return resolve(true);
          }

          const localNewer = versionDecision.localNewer === true;
          const pendingCleanupCount = GM_getValue("s1p_pending_cleanup_info", 0);

          // 智能检查：当“清理”发生时，只在“基础数据”完全一致的情况下才自动推送
          if (
            localNewer &&
            versionDecision.action === "push" &&
            pendingCleanupCount > 0 &&
            localDataObject.baseContentHash === remote.baseContentHash
          ) {
            console.log(
              "S1 Plus (Sync): 确认基础数据一致，差异仅由阅读记录清理导致，执行自动推送。"
            );
            showMessage("阅读记录已自动清理，正在同步至云端...", null);
            try {
              const pushResult = await runWithManualSyncLockGuard(
                "push_cleanup_auto_sync",
                () =>
                  pushRemoteData(localDataObject, {
                    expectedRemoteUpdatedAt: remoteMetaUpdatedAt,
                  })
              );
              GM_deleteValue("s1p_pending_cleanup_info");
              GM_setValue("s1p_last_sync_timestamp", Date.now());
              GM_setValue("s1p_last_manual_sync_info", {
                action: "push",
                timestamp: Date.now(),
              });
              noteManualSuccess("cleanup_auto_push", {
                contentHash: localDataObject.contentHash,
                remoteUpdatedAt: pushResult?.updatedAt || null,
              });
              showMessage("自动清理与同步成功！", true);
              return resolve(true);
            } catch (e) {
              if (e?.code === REMOTE_VERSION_CONFLICT_CODE) {
                noteManualConflict("remote_changed_before_cleanup_push");
                showMessage(
                  "自动推送失败：云端数据已变化，请重新执行手动同步。",
                  false
                );
                return resolve(false);
              }
              noteManualFailure(e.message);
              showMessage(`自动推送失败: ${e.message}`, false);
              return resolve(false);
            }
          }

          // 智能检查：当在帖子内，且只有当前帖子的阅读进度变化时，自动同步
          const currentThreadId = getCurrentThreadId();
          if (
            currentThreadId &&
            !isInitialSyncInProgress &&
            (versionDecision.action === "push" || versionDecision.action === "pull") &&
            localDataObject.baseContentHash === remote.baseContentHash
          ) {
            if (localNewer) {
              showMessage(
                "智能同步：阅读进度已更新，正在自动推送到云端...",
                null
              );
              try {
                const pushResult = await runWithManualSyncLockGuard(
                  "push_smart_progress",
                  () =>
                    pushRemoteData(localDataObject, {
                      expectedRemoteUpdatedAt: remoteMetaUpdatedAt,
                    })
                );
                GM_setValue("s1p_last_sync_timestamp", Date.now());
                noteManualSuccess("smart_progress_push", {
                  contentHash: localDataObject.contentHash,
                  remoteUpdatedAt: pushResult?.updatedAt || null,
                });
                showMessage("智能同步成功！已将本地最新进度推送到云端。", true);
                return resolve(true);
              } catch (e) {
                if (e?.code === REMOTE_VERSION_CONFLICT_CODE) {
                  noteManualConflict("remote_changed_before_smart_push");
                  showMessage(
                    "智能推送失败：云端数据已变化，请重新执行手动同步。",
                    false
                  );
                  return resolve(false);
                }
                noteManualFailure(e.message);
                showMessage(`智能推送失败: ${e.message}`, false);
                return resolve(false);
              }
            } else {
              const currentThreadLocalProgress = localDataObject.data
                .read_progress
                ? localDataObject.data.read_progress[currentThreadId]
                : undefined;
              showMessage("智能同步：正在合并云端数据与当前阅读进度...", null);
              assertManualSyncLockOwned("smart_merge_pull_import");
              importLocalData(JSON.stringify(remote.full), {
                suppressPostSync: true,
              });
              if (currentThreadLocalProgress) {
                const progress = { ...getReadProgress() };
                progress[currentThreadId] = { ...currentThreadLocalProgress };
                saveReadProgress(progress);
              }
              GM_setValue("s1p_last_sync_timestamp", Date.now());
              noteManualSuccess("smart_merge_pull", {
                contentHash: remote.contentHash,
                remoteUpdatedAt: remoteMetaUpdatedAt || null,
              });
              showMessage("智能同步成功！已保留当前帖子的最新阅读进度。", true);
              return resolve(true);
            }
          }
          // --- 智能检查结束 ---

          // 如果以上智能检查都未通过，则进入手动选择流程
          const isConflict = versionDecision.action === "conflict";
          if (isConflict) {
            noteManualConflict(versionDecision.reason || "manual_decision_required");
          }
          const bodyHtml = createSyncComparisonHtml(
            localDataObject,
            remote,
            isConflict,
            pendingCleanupCount,
            versionDecision
          );
          const pullAction = {
            text: "从云端拉取",
            className: "s1p-confirm",
            action: async () => {
              if (!(await tryReacquireDecisionLock("manual_pull_choice"))) {
                return;
              }
              try {
                const {
                  remoteDataObject: latestRemote,
                  remoteUpdatedAt: latestRemoteUpdatedAt,
                } = await fetchLatestValidatedRemoteForDecision(
                  "manual_pull_confirm",
                  "云端没有数据，无法拉取。"
                );
                const result = importLocalData(JSON.stringify(latestRemote.full), {
                  suppressPostSync: true,
                });
                if (result.success) {
                  GM_deleteValue("s1p_pending_cleanup_info");
                  GM_setValue("s1p_last_sync_timestamp", Date.now());
                  GM_setValue("s1p_last_manual_sync_info", {
                    action: "pull",
                    timestamp: Date.now(),
                  });
                  noteManualSuccess("manual_pull", {
                    contentHash: latestRemote.contentHash,
                    remoteUpdatedAt: latestRemoteUpdatedAt,
                  });
                  showMessage(`拉取成功！页面即将刷新。`, true);
                  setTimeout(() => location.reload(), 1200);
                  resolve(true);
                } else {
                  noteManualFailure(result.message);
                  showMessage(`导入失败: ${result.message}`, false);
                  resolve(false);
                }
              } catch (error) {
                if (handleManualLockLostError(error)) {
                  return;
                }
                noteManualFailure(error?.message || "导入失败");
                showMessage(`导入失败: ${error?.message || "未知错误"}`, false);
                resolve(false);
              }
            },
          };
          const pushAction = {
            text: "向云端推送",
            className: "s1p-confirm",
            action: async () => {
              if (!(await tryReacquireDecisionLock("manual_push_choice"))) {
                return;
              }
              try {
                const pushResult = await runWithManualSyncLockGuard(
                  "push_manual_choice",
                  () =>
                    pushRemoteData(localDataObject, {
                      expectedRemoteUpdatedAt: remoteMetaUpdatedAt,
                    })
                );
                GM_deleteValue("s1p_pending_cleanup_info");
                GM_setValue("s1p_last_sync_timestamp", Date.now());
                GM_setValue("s1p_last_manual_sync_info", {
                  action: "push",
                  timestamp: Date.now(),
                });
                noteManualSuccess("manual_push", {
                  contentHash: localDataObject.contentHash,
                  remoteUpdatedAt: pushResult?.updatedAt || null,
                });
                showMessage("推送成功！已更新云端备份。", true);
                resolve(true);
              } catch (e) {
                if (e?.code === REMOTE_VERSION_CONFLICT_CODE) {
                  noteManualConflict("remote_changed_before_manual_push");
                  showMessage(
                    "推送失败：云端数据已变化，请重新执行手动同步。",
                    false
                  );
                  resolve(false);
                  return;
                }
                noteManualFailure(e.message);
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
          releaseManualSyncLockForDecision();
          createAdvancedConfirmationModal(
            "手动同步选择",
            bodyHtml,
            [pullAction, pushAction, cancelAction],
            {
              modalClassName: "s1p-sync-modal",
              allowBodyHtml: true,
              onDismiss: () => {
                resolve(null);
              },
            }
          );
        } catch (error) {
          if (handleManualLockLostError(error)) {
            return;
          }
          const corruptionErrorMessage = "云端备份已损坏";
          if (error?.message.includes(corruptionErrorMessage)) {
            const forcePushAction = {
              text: "强制推送，覆盖云端",
              className: "s1p-confirm",
              action: async () => {
                if (
                  !(await tryReacquireDecisionLock("manual_force_push_repair"))
                ) {
                  return;
                }
                try {
                  const localDataObjectForPush = await runWithManualSyncLockGuard(
                    "export_local_data_force_repair",
                    () => exportLocalDataObject()
                  );
                  const pushResult = await runWithManualSyncLockGuard(
                    "push_force_repair",
                    () =>
                      pushRemoteData(localDataObjectForPush, {
                        expectedRemoteUpdatedAt: remoteMetaUpdatedAt,
                      })
                  );
                  GM_setValue("s1p_last_sync_timestamp", Date.now());
                  GM_setValue("s1p_last_manual_sync_info", {
                    action: "push",
                    timestamp: Date.now(),
                  });
                  noteManualSuccess("manual_force_push_repair", {
                    contentHash: localDataObjectForPush.contentHash,
                    remoteUpdatedAt: pushResult?.updatedAt || null,
                  });
                  showMessage("推送成功！已使用本地数据修复云端备份。", true);
                  resolve(true);
                } catch (e) {
                  if (e?.code === REMOTE_VERSION_CONFLICT_CODE) {
                    noteManualConflict("remote_changed_before_repair_push");
                    showMessage(
                      "强制推送失败：云端数据已变化，请重新执行手动同步。",
                      false
                    );
                    resolve(false);
                    return;
                  }
                  noteManualFailure(e.message);
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
            releaseManualSyncLockForDecision();
            createAdvancedConfirmationModal(
              "检测到云端备份损坏",
              `<p class="s1p-sync-danger-text">云端备份文件校验失败，为保护数据已暂停同步。</p><p>是否用当前健康的本地数据强制覆盖云端损坏的备份？</p>`,
              [forcePushAction, cancelAction],
              {
                modalClassName: "s1p-sync-modal",
                allowBodyHtml: true,
                onDismiss: () => {
                  resolve(null);
                },
              }
            );
          } else {
            noteManualFailure(error.message);
            showMessage(`操作失败: ${error.message}`, false);
            resolve(false);
          }
        }
      })().catch((error) => {
        if (error?.code === SYNC_LOCK_LOST_CODE) {
          console.warn("S1 Plus: 手动同步因锁失效被中止。", {
            mode: error?.syncLockMode || SYNC_LOCK_MODE_MANUAL,
            stage: error?.syncLockStage || "unknown",
          });
          showMessage(MANUAL_SYNC_LOCK_LOST_MESSAGE, false);
          resolve(false);
          return;
        }
        const fallbackMessage = error?.message || "未知错误";
        console.error("S1 Plus: 手动同步发生未捕获异常:", error);
        recordSyncFailure(fallbackMessage, "manual");
        updateLastSyncTimeDisplay();
        showMessage(`操作失败: ${fallbackMessage}`, false);
        resolve(false);
      });
    });

    return manualSyncInFlightPromise.finally(() => {
      stopManualSyncLockHeartbeat();
      releaseManualSyncLock();
      manualSyncLockHeldByThisRun = false;
      manualSyncInFlightPromise = null;
    });
  };

  const createAdvancedConfirmationModal = (
    title,
    bodyHtml,
    buttons,
    options = {}
  ) => {
    const {
      modalClassName,
      allowTitleHtml = false,
      allowBodyHtml = false,
      onDismiss = null,
    } = options;
    const renderedTitle = allowTitleHtml
      ? sanitizeAdvancedModalHtml(title)
      : String(title ?? "");
    const renderedBody = allowBodyHtml
      ? sanitizeAdvancedModalHtml(bodyHtml)
      : String(bodyHtml ?? "");

    // [修改] 新弹窗创建前优雅关闭旧弹窗，避免覆盖导致的流程悬挂。
    dismissExistingConfirmModal({ reason: "replaced", immediate: true });
    const modal = document.createElement("div");
    modal.className = "s1p-confirm-modal";

    // [新增] 如果传入了自定义类名，则添加到 modal 元素上
    if (modalClassName) {
      modal.classList.add(modalClassName);
    }

    const content = document.createElement("div");
    content.className = "s1p-confirm-content";

    const body = document.createElement("div");
    body.className = "s1p-confirm-body";

    const titleEl = document.createElement("div");
    titleEl.className = "s1p-confirm-title";
    if (allowTitleHtml) {
      titleEl.innerHTML = renderedTitle;
    } else {
      titleEl.textContent = renderedTitle;
    }

    const subtitleEl = document.createElement("div");
    subtitleEl.className = "s1p-confirm-subtitle";
    if (allowBodyHtml) {
      subtitleEl.innerHTML = renderedBody;
    } else {
      subtitleEl.textContent = renderedBody;
    }

    body.appendChild(titleEl);
    body.appendChild(subtitleEl);

    const footer = document.createElement("div");
    footer.className = "s1p-confirm-footer s1p-centered";

    const buttonEls = [];
    buttons.forEach((btn) => {
      const buttonEl = document.createElement("button");
      buttonEl.className = "s1p-confirm-btn";
      if (btn.className) {
        buttonEl.classList.add(
          ...String(btn.className)
            .split(/\s+/)
            .filter(Boolean)
        );
      }
      buttonEl.textContent = String(btn.text || "");
      footer.appendChild(buttonEl);
      buttonEls.push(buttonEl);
    });

    content.appendChild(body);
    content.appendChild(footer);
    modal.appendChild(content);

    let settled = false;
    let closing = false;
    const settleDismiss = (reason = "dismissed") => {
      if (settled) {
        return;
      }
      settled = true;
      if (typeof onDismiss === "function") {
        try {
          onDismiss(reason);
        } catch (error) {
          console.error("S1 Plus: 弹窗 onDismiss 执行失败。", error);
        }
      }
    };

    const closeModal = ({
      reason = "dismissed",
      invokeDismiss = true,
      immediate = false,
    } = {}) => {
      if (closing) {
        return;
      }
      if (invokeDismiss) {
        settleDismiss(reason);
      }
      closing = true;
      if (immediate) {
        modal.remove();
        return;
      }
      const confirmContent = modal.querySelector(".s1p-confirm-content");
      if (confirmContent) {
        confirmContent.style.animation = "s1p-scale-out 0.25s ease-out forwards";
      }
      modal.style.animation = "s1p-fade-out 0.25s ease-out forwards";
      setTimeout(() => modal.remove(), 250);
    };

    modal.s1p_api = {
      dismiss: ({ reason = "dismissed", immediate = false } = {}) =>
        closeModal({ reason, immediate, invokeDismiss: true }),
    };

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        const cancelButton = modal.querySelector(".s1p-confirm-btn.s1p-cancel");
        if (cancelButton) {
          cancelButton.click();
        } else {
          closeModal({ reason: "overlay_click" });
        }
      }
    });

    buttons.forEach((btn, index) => {
      const buttonEl = buttonEls[index];
      if (!buttonEl) return;
      buttonEl.addEventListener("click", () => {
        settled = true;
        try {
          if (btn.action) {
            btn.action();
          }
        } catch (error) {
          console.error("S1 Plus: 弹窗按钮 action 执行失败。", error);
        } finally {
          closeModal({ invokeDismiss: false });
        }
      });
    });

    document.body.appendChild(modal);
  };

  const addBlockButtonsToThreadRows = (rows = []) => {
    const THREAD_BLOCK_AUTHOR_TOOLTIP_TEXT = {
      disabled: "开启后，确认时会同时屏蔽发帖人",
      enabled: "已启用：确认时会同时屏蔽发帖人",
    };
    const setThreadBlockAuthorButtonSelectedState = (button, isSelected) => {
      button.classList.toggle("s1p-selected", isSelected);
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
      button.dataset.fullTag = isSelected
        ? THREAD_BLOCK_AUTHOR_TOOLTIP_TEXT.enabled
        : THREAD_BLOCK_AUTHOR_TOOLTIP_TEXT.disabled;
    };
    const createThreadBlockAuthorButton = () => {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "s1p-confirm-action-btn s1p-thread-block-author-btn s1p-has-tooltip";
      setThreadBlockAuthorButtonSelectedState(button, false);
      setSanitizedIconHtml(button, TOOLBAR_ICONS.blockUser);
      return button;
    };
    const blockThreadAuthor = async (authorId, authorName) => {
      const currentSettings = getSettings();
      if (currentSettings.enableUserBlocking !== true) {
        showMessage("帖子已屏蔽。自动拉黑未执行：请先开启“用户屏蔽功能”。", false);
        return;
      }
      if (!authorId || !authorName) {
        showMessage("帖子已屏蔽。自动拉黑未执行：未能识别发帖人。", false);
        return;
      }

      const blockedUsers = getBlockedUsers();
      if (blockedUsers[authorId]) {
        return;
      }

      const nativeSyncSucceeded = await blockUser(authorId, authorName);
      const latestSettings = getSettings();
      if (nativeSyncSucceeded) {
        const message = latestSettings.syncWithNativeBlacklist
          ? `已屏蔽帖子并拉黑作者 ${authorName}（已同步至论坛黑名单）。`
          : `已屏蔽帖子并拉黑作者 ${authorName}。`;
        showMessage(message, true);
        return;
      }
      showMessage(
        `已屏蔽帖子并拉黑作者 ${authorName}，但同步论坛黑名单失败。`,
        false
      );
    };

    if (!Array.isArray(rows) || rows.length === 0) return;

    // 核心修复：注入一个空的表头单元格，以匹配内容行的列数。
    // S1Plus 原脚本会给每个内容行动态添加一个“操作列”单元格，但没有给表头行添加，导致列数不匹配。
    // 此代码通过给表头也添加一个对应的占位单元格，使得结构恢复一致，从而让浏览器能够正确对齐所有列。
    const headerTr = document.querySelector("#threadlisttableid .th tr");
    if (headerTr && !headerTr.querySelector(".s1p-header-placeholder")) {
      const placeholderCell = document.createElement("td");
      placeholderCell.className = "s1p-header-placeholder";
      headerTr.appendChild(placeholderCell);
    }

    rows.forEach((row) => {
      if (!(row instanceof Element) || !row.isConnected) return;

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
      const authorLink = row.querySelector('td.by cite a[href*="space-uid-"]');
      const authorId = authorLink
        ? extractUidFromProfileHref(authorLink.href)
        : "";
      const authorName = authorLink ? authorLink.textContent.trim() : "";

      const optionsCell = document.createElement("td");
      optionsCell.className = "s1p-options-cell";

      const optionsBtn = document.createElement("div");
      optionsBtn.className = "s1p-options-btn";
      optionsBtn.title = "屏蔽此贴";
      setSanitizedIconHtml(
        optionsBtn,
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`
      );

      const optionsMenu = document.createElement("div");
      optionsMenu.className = "s1p-options-menu s1p-confirm-wrapper";

      const content = buildConfirmationMarkup("屏蔽该帖子吗？");
      const confirmBar = content.querySelector(".s1p-confirm-bar");
      const confirmSeparator = content.querySelector(".s1p-confirm-separator");
      const blockAuthorBtn = createThreadBlockAuthorButton();
      if (confirmBar && confirmSeparator) {
        confirmBar.insertBefore(blockAuthorBtn, confirmSeparator);
      }
      optionsMenu.appendChild(content);

      const cancelBtn = optionsMenu.querySelector(".s1p-cancel");
      const confirmBtn = optionsMenu.querySelector(".s1p-confirm");
      blockAuthorBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const nextSelected = !blockAuthorBtn.classList.contains("s1p-selected");
        setThreadBlockAuthorButtonSelectedState(blockAuthorBtn, nextSelected);
      });

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

      confirmBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        blockThread(threadId, threadTitle);

        const shouldBlockAuthor = blockAuthorBtn.classList.contains("s1p-selected");
        if (!shouldBlockAuthor) {
          return;
        }
        await blockThreadAuthor(authorId, authorName);
      });

      const updateOptionsMenuDirection = () => {
        // 根据当前可视空间动态决定左右方向，避免窄屏时菜单超出视口
        const rect = optionsCell.getBoundingClientRect();
        const menuWidth = optionsMenu.offsetWidth || 120;
        const viewportPadding = 8;
        const spaceOnLeft = rect.left;
        const spaceOnRight = window.innerWidth - rect.right;
        const shouldOpenRight =
          spaceOnLeft < menuWidth + viewportPadding && spaceOnRight > spaceOnLeft;

        optionsCell.classList.toggle("s1p-open-right", shouldOpenRight);
      };

      optionsBtn.addEventListener("mouseenter", updateOptionsMenuDirection);
      optionsMenu.addEventListener("mouseenter", updateOptionsMenuDirection);
      optionsCell.addEventListener("mouseleave", () =>
        optionsCell.classList.remove("s1p-open-right")
      );
      updateOptionsMenuDirection();

      optionsCell.appendChild(optionsBtn);
      optionsCell.appendChild(optionsMenu);
      tr.appendChild(optionsCell);

      const separatorRow = document.querySelector("#separatorline > tr.ts");
      if (separatorRow && separatorRow.childElementCount < 6) {
        const emptyTd = document.createElement("td");
        emptyTd.className = "s1p-separator-placeholder";
        separatorRow.appendChild(emptyTd);
      }
    });
  };

  const addBlockButtonsToThreads = () => {
    addBlockButtonsToThreadRows(
      Array.from(
        document.querySelectorAll(
          'tbody[id^="normalthread_"], tbody[id^="stickthread_"]'
        )
      )
    );
  };

  const initializeTaggingPopover = () => {
    let popover = document.getElementById("s1p-tag-popover-main");
    if (!popover) {
      popover = document.createElement("div");
      popover.id = "s1p-tag-popover-main";
      popover.className = "s1p-tag-popover";
      document.body.appendChild(popover);
    }
    markAsPostToolbarPopup(popover);

    // 确保主点击监听只绑定一次，避免 applyChanges 反复调用导致监听器累积。
    if (popover.dataset.s1pInitialized === "true") {
      return;
    }
    popover.dataset.s1pInitialized = "true";

    // --- [S1P-FIX START] 优化交互逻辑为“点击外部关闭” ---
    let currentAnchor = null; // 保存触发弹窗的锚点元素

    const closePopover = () => {
      popover.classList.remove("visible");
      // 移除全局点击监听器，避免内存泄漏
      document.removeEventListener("click", handleOutsideClick);
      currentAnchor = null;
    };

    const handleOutsideClick = (e) => {
      // 如果点击事件发生在弹窗内部，或者发生在触发弹窗的原始锚点上，则不关闭
      if (
        popover.contains(e.target) ||
        (currentAnchor && currentAnchor.contains(e.target))
      ) {
        return;
      }
      closePopover();
    };
    // --- [S1P-FIX END] ---

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

    const renderEditMode = (userName, userId, currentTag = "", currentColor = "") => {
      const colors = ["", "red", "orange", "yellow", "green", "blue", "purple"];
      const checkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

      // 生成历史标记列表（显示所有不同用户的标记，不去重）
      const allTags = getUserTags();
      const historyTags = Object.entries(allTags)
        .filter(([id]) => id !== userId) // 排除当前用户
        .map(([, data]) => data)
        .slice(0, 50); // 限制显示数量

      popover.textContent = "";

      const content = document.createElement("div");
      content.className = "s1p-popover-content";

      const header = document.createElement("div");
      header.className = "s1p-edit-mode-header";
      header.appendChild(document.createTextNode("为 "));

      const userNameHighlight = document.createElement("span");
      userNameHighlight.className = "s1p-username-highlight";
      userNameHighlight.textContent = String(userName ?? "");
      header.appendChild(userNameHighlight);
      header.appendChild(
        document.createTextNode(currentTag ? " 编辑标记" : " 添加标记")
      );
      content.appendChild(header);

      const textarea = document.createElement("textarea");
      textarea.className = "s1p-input s1p-textarea s1p-edit-mode-textarea";
      textarea.placeholder = "输入标记内容...";
      textarea.autocomplete = "off";
      textarea.value = String(currentTag ?? "");
      content.appendChild(textarea);

      const colorPicker = document.createElement("div");
      colorPicker.className = "s1p-color-picker";

      const colorPickerLabel = document.createElement("span");
      colorPickerLabel.className = "s1p-color-picker-label";
      colorPickerLabel.textContent = "标记颜色：";
      colorPicker.appendChild(colorPickerLabel);

      const colorOptions = document.createElement("div");
      colorOptions.className = "s1p-color-options";
      colors.forEach((color) => {
        const option = document.createElement("span");
        option.className = "s1p-color-option";
        option.dataset.color = color;
        if (color === currentColor) {
          option.classList.add("selected");
        }
        setSanitizedIconHtml(option, checkSvg);
        colorOptions.appendChild(option);
      });
      colorPicker.appendChild(colorOptions);
      content.appendChild(colorPicker);

      if (historyTags.length > 0) {
        const historyContainer = document.createElement("div");
        historyContainer.className = "s1p-history-tags-container";

        const historyLabel = document.createElement("div");
        historyLabel.className = "s1p-history-tags-label";
        historyLabel.textContent = `历史标记（${historyTags.length}）：`;
        historyContainer.appendChild(historyLabel);

        const historyList = document.createElement("div");
        historyList.className = "s1p-history-tags-list";
        historyTags.forEach((item) => {
          const tagValue = String(item?.tag ?? "");
          const colorValue = String(item?.color ?? "");
          const historyItem = document.createElement("span");
          historyItem.className = "s1p-history-tag-item";
          historyItem.dataset.tag = tagValue;
          historyItem.dataset.color = colorValue;
          historyItem.dataset.fullTag = tagValue;
          historyItem.textContent = tagValue;
          historyList.appendChild(historyItem);
        });
        historyContainer.appendChild(historyList);
        content.appendChild(historyContainer);
      }

      const actions = document.createElement("div");
      actions.className = "s1p-edit-mode-actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "s1p-btn";
      cancelBtn.dataset.action = "cancel-edit";
      cancelBtn.textContent = "取消";
      actions.appendChild(cancelBtn);

      const saveBtn = document.createElement("button");
      saveBtn.className = "s1p-btn";
      saveBtn.dataset.action = "save";
      saveBtn.textContent = "保存";
      actions.appendChild(saveBtn);

      content.appendChild(actions);
      popover.appendChild(content);

      // 颜色选择器点击事件
      popover.querySelectorAll(".s1p-color-option").forEach((opt) => {
        opt.addEventListener("click", () => {
          popover
            .querySelectorAll(".s1p-color-option")
            .forEach((o) => o.classList.remove("selected"));
          opt.classList.add("selected");
        });
      });

      // 历史标记点击事件
      popover.querySelectorAll(".s1p-history-tag-item").forEach((item) => {
        item.addEventListener("click", () => {
          textarea.value = item.dataset.tag || "";

          // 同时更新颜色选择
          const color = item.dataset.color || "";
          popover.querySelectorAll(".s1p-color-option").forEach((opt) => {
            opt.classList.toggle("selected", opt.dataset.color === color);
          });

          textarea.focus();
        });
      });

      textarea.focus();
    };

    const show = (anchorElement, userId, userName) => {
      // --- [S1P-FIX START] 更新显示逻辑 ---
      // 如果弹窗已显示且由同一个锚点触发，则不执行任何操作（防止重复打开）
      if (
        popover.classList.contains("visible") &&
        currentAnchor === anchorElement
      ) {
        return;
      }

      currentAnchor = anchorElement; // 保存当前触发的锚点

      popover.dataset.userId = userId;
      popover.dataset.userName = userName;

      const userTags = getUserTags();
      const userTag = userTags[userId];
      renderEditMode(userName, userId, userTag?.tag || "", userTag?.color || "");

      popover.classList.add("visible");
      repositionPopover(anchorElement);

      // 延迟添加全局监听器，以防止触发弹窗的同一次点击事件立即将其关闭
      setTimeout(() => {
        document.addEventListener("click", handleOutsideClick);
      }, 0);
      // --- [S1P-FIX END] ---
    };

    popover.show = show;
    popover.hide = closePopover;
    popover.s1p_api = { show, hide: closePopover };

    popover.addEventListener("click", (e) => {
      const target = e.target.closest("button[data-action]");
      if (!target) return;

      const { userId, userName } = popover.dataset;
      const userTags = getUserTags();

      switch (target.dataset.action) {
        case "save":
          const newTag = popover.querySelector("textarea").value.trim();
          const selectedColorOpt = popover.querySelector(".s1p-color-option.selected");
          const newColor = selectedColorOpt ? selectedColorOpt.dataset.color : "";
          if (newTag) {
            userTags[userId] = {
              name: userName,
              tag: newTag,
              color: newColor,
              timestamp: Date.now(),
            };
          } else {
            delete userTags[userId];
          }
          saveUserTags(userTags);
          refreshUserPostsOnPage(userId);
          closePopover(); // [S1P-FIX] 改为调用新的关闭函数
          break;
        case "cancel-edit":
          closePopover(); // [S1P-FIX] 改为调用新的关闭函数
          break;
      }
    });
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

    const show = (anchor, text, delay = 50) => {
      clearTimeout(hideTimeout);
      clearTimeout(showTimeout); // [NEW] 额外清理 showTimeout 确保不会叠加
      showTimeout = setTimeout(() => {
        applyPostToolbarPopupScope(popover, anchor);

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
      }, delay);
    };

    const hide = () => {
      clearTimeout(showTimeout);
      clearTimeout(hideTimeout);
      popover.classList.remove("visible");
    };

    // [MODIFIED] Attach API to the element for external use
    if (!popover.s1p_api) {
      popover.s1p_api = { show, hide };
    }
    const resolveTooltipDelay = (target, isTooltip) => {
      if (!isTooltip) {
        return 50;
      }
      const configuredTooltipDelay = parseInt(
        String(target?.dataset?.s1pTooltipDelay || ""),
        10
      );
      if (!Number.isFinite(configuredTooltipDelay)) {
        return DEFAULT_TOOLBAR_TOOLTIP_DELAY_MS;
      }
      return Math.max(0, configuredTooltipDelay);
    };

    // Keep existing listeners for user tags and add support for user remarks and history tags
    document.body.addEventListener("mouseover", (e) => {
      const target = e.target.closest(
        ".s1p-user-tag-display, .s1p-user-remark-display, .s1p-history-tag-item, .s1p-has-tooltip"
      );
      if (target && target.dataset.fullTag) {
        // 如果是文本展示类，则需要检测是否溢出；如果是强制工具提示类，则直接显示
        const isTooltip = target.classList.contains("s1p-has-tooltip");
        if (isTooltip || target.scrollWidth > target.clientWidth) {
          const delay = resolveTooltipDelay(target, isTooltip);
          show(target, target.dataset.fullTag, delay);
        }
      }
    });

    document.body.addEventListener("mouseout", (e) => {
      const target = e.target.closest(
        ".s1p-user-tag-display, .s1p-user-remark-display, .s1p-history-tag-item, .s1p-has-tooltip"
      );
      if (target) {
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

  // 帖子列表行选择器：阅读进度按钮仅在列表场景下渲染/刷新。
  const THREAD_LIST_ROW_SELECTOR =
    'tbody[id^="normalthread_"], tbody[id^="stickthread_"]';
  const isThreadListPage = () => Boolean(document.querySelector(THREAD_LIST_ROW_SELECTOR));

  const normalizeReadProgressPayload = (payload) =>
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : {};

  const getThreadIdFromListRow = (row) => {
    const threadIdMatch = row.id.match(/(?:normalthread_|stickthread_)(\d+)/);
    return threadIdMatch ? threadIdMatch[1] : null;
  };

  const upsertProgressJumpButtonForRow = (row, progressData, now) => {
    const container = row.querySelector("th");
    if (!container) return;

    const threadId = getThreadIdFromListRow(row);
    if (!threadId) return;

    const progress = progressData[threadId];
    let progressContainer = container.querySelector(".s1p-progress-container");
    if (!progress || !progress.page || !progress.postId) {
      if (progressContainer) {
        if (progressContainer.__s1pDeleteRevealTimer) {
          clearTimeout(progressContainer.__s1pDeleteRevealTimer);
          progressContainer.__s1pDeleteRevealTimer = null;
        }
        progressContainer.remove();
      }
      return;
    }

    const postId = String(progress.postId);
    const page = String(progress.page);
    const timestamp = Number(progress.timestamp) || 0;
    const savedFloorText =
      progress.lastReadFloor !== undefined &&
        progress.lastReadFloor !== null &&
        String(progress.lastReadFloor).trim() !== ""
        ? String(progress.lastReadFloor)
        : "";
    const savedFloorNumber = parseInt(savedFloorText, 10);
    const hasSavedFloor = Number.isFinite(savedFloorNumber) && savedFloorNumber > 0;
    const hoursDiff = (now - timestamp) / 3600000;
    const fcolor = getTimeBasedColor(hoursDiff);

    const replyEl = row.querySelector("td.num a.xi2");
    const currentReplies = replyEl
      ? parseInt(replyEl.textContent.replace(/,/g, ""), 10) || 0
      : 0;
    const latestFloor = currentReplies + 1;
    const newReplies =
      hasSavedFloor && latestFloor > savedFloorNumber
        ? latestFloor - savedFloorNumber
        : 0;
    const dataSignature = [postId, page, savedFloorText, newReplies].join("|");
    const previousDataSignature = progressContainer
      ? progressContainer.dataset.dataSignature || ""
      : "";

    const renderSignature = [
      postId,
      page,
      savedFloorText,
      newReplies,
      fcolor,
    ].join("|");

    if (progressContainer && progressContainer.dataset.renderSignature === renderSignature) {
      return;
    }

    if (!progressContainer) {
      progressContainer = document.createElement("span");
      progressContainer.className = "s1p-progress-container";
      progressContainer.addEventListener("mouseleave", () => {
        if (progressContainer.__s1pDeleteRevealTimer) {
          clearTimeout(progressContainer.__s1pDeleteRevealTimer);
          progressContainer.__s1pDeleteRevealTimer = null;
        }
        progressContainer.classList.remove("s1p-show-delete-btn");
      });
      container.appendChild(progressContainer);
    }
    if (progressContainer.__s1pDeleteRevealTimer) {
      clearTimeout(progressContainer.__s1pDeleteRevealTimer);
      progressContainer.__s1pDeleteRevealTimer = null;
    }
    progressContainer.classList.remove("s1p-show-delete-btn");
    progressContainer.dataset.renderSignature = renderSignature;
    progressContainer.dataset.dataSignature = dataSignature;
    progressContainer.replaceChildren();

    const jumpBtn = document.createElement("a");
    jumpBtn.className = "s1p-progress-jump-btn";
    if (hasSavedFloor) {
      jumpBtn.textContent = `P${page}-#${savedFloorText}`;
      jumpBtn.title = `跳转至上次离开的第 ${page} 页，第 ${savedFloorText} 楼`;
    } else {
      jumpBtn.textContent = `P${page}`;
      jumpBtn.title = `跳转至上次离开的第 ${page} 页`;
    }

    jumpBtn.href = `forum.php?mod=redirect&goto=findpost&ptid=${threadId}&pid=${postId}`;
    jumpBtn.style.color = fcolor;
    jumpBtn.style.borderColor = fcolor;

    jumpBtn.addEventListener("mouseover", () => {
      jumpBtn.style.backgroundColor = fcolor;
      jumpBtn.style.color = "var(--s1p-white)";
    });
    jumpBtn.addEventListener("mouseout", () => {
      jumpBtn.style.backgroundColor = "transparent";
      jumpBtn.style.color = fcolor;
    });
    jumpBtn.addEventListener("mouseenter", () => {
      if (progressContainer.__s1pDeleteRevealTimer) {
        clearTimeout(progressContainer.__s1pDeleteRevealTimer);
      }
      progressContainer.__s1pDeleteRevealTimer = setTimeout(() => {
        progressContainer.classList.add("s1p-show-delete-btn");
        progressContainer.__s1pDeleteRevealTimer = null;
      }, READ_PROGRESS_DELETE_REVEAL_DELAY_MS);
    });
    jumpBtn.addEventListener("mouseleave", () => {
      if (progressContainer.__s1pDeleteRevealTimer) {
        clearTimeout(progressContainer.__s1pDeleteRevealTimer);
        progressContainer.__s1pDeleteRevealTimer = null;
      }
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
    } else {
      jumpBtn.style.borderTopRightRadius = "";
      jumpBtn.style.borderBottomRightRadius = "";
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "s1p-progress-delete-btn";
    deleteBtn.textContent = "删除";
    deleteBtn.title = "删除该帖阅读记录";
    deleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (deleteThreadReadProgress(threadId)) {
        showMessage("已删除该帖阅读记录", true);
      } else {
        showMessage("该帖暂无可删除的阅读记录", true);
      }
    });
    progressContainer.appendChild(deleteBtn);

    if (previousDataSignature && previousDataSignature !== dataSignature) {
      progressContainer.classList.remove("s1p-progress-refresh-flash");
      if (progressContainer.__s1pRefreshAnimCleanupTimer) {
        clearTimeout(progressContainer.__s1pRefreshAnimCleanupTimer);
      }
      // 先禁用子元素 transition 让发光瞬间出现
      const flashTargets = progressContainer.querySelectorAll(
        ".s1p-progress-jump-btn, .s1p-new-replies-badge"
      );
      flashTargets.forEach((el) => (el.style.transition = "none"));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          progressContainer.classList.add("s1p-progress-refresh-flash");
          // 发光保持短暂停留后，恢复 transition 并移除 class 触发柔和消退
          progressContainer.__s1pRefreshAnimCleanupTimer = setTimeout(() => {
            flashTargets.forEach((el) => (el.style.transition = ""));
            progressContainer.classList.remove("s1p-progress-refresh-flash");
            progressContainer.__s1pRefreshAnimCleanupTimer = null;
          }, 350);
        });
      });
    }
  };

  const scheduleProgressJumpButtonsRefresh = (progressDataOverride = null) => {
    if (
      progressDataOverride &&
      typeof progressDataOverride === "object" &&
      !Array.isArray(progressDataOverride)
    ) {
      pendingReadProgressDataForRefresh = progressDataOverride;
    }

    if (readProgressListRefreshTimer) {
      clearTimeout(readProgressListRefreshTimer);
    }
    readProgressListRefreshTimer = setTimeout(() => {
      readProgressListRefreshTimer = null;
      const settings = getSettings();
      if (
        settings.enableGeneralSettings !== true ||
        settings.enableReadProgress !== true
      ) {
        return;
      }
      if (!isThreadListPage()) {
        return;
      }

      const progressDataToUse = pendingReadProgressDataForRefresh;
      pendingReadProgressDataForRefresh = null;
      addProgressJumpButtons(progressDataToUse);
    }, READ_PROGRESS_LIST_REFRESH_DEBOUNCE_MS);
  };

  const initializeReadProgressCrossTabRefresh = () => {
    if (window.__s1pReadProgressCrossTabRefreshBound) {
      return;
    }
    window.__s1pReadProgressCrossTabRefreshBound = true;

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && isThreadListPage()) {
        scheduleProgressJumpButtonsRefresh();
      }
    });
  };

  const addProgressJumpButtons = (progressDataOverride = null) => {
    const settings = getSettings();
    if (
      settings.enableGeneralSettings !== true ||
      settings.enableReadProgress !== true
    ) {
      return;
    }
    const progressData =
      progressDataOverride === null
        ? getReadProgress()
        : normalizeReadProgressPayload(progressDataOverride);

    const now = Date.now();

    document
      .querySelectorAll(THREAD_LIST_ROW_SELECTOR)
      .forEach((row) => {
        upsertProgressJumpButtonForRow(row, progressData, now);
      });
  };

  const addProgressJumpButtonsForRows = (rows, progressDataOverride = null) => {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const settings = getSettings();
    if (
      settings.enableGeneralSettings !== true ||
      settings.enableReadProgress !== true
    ) {
      return;
    }
    const progressData =
      progressDataOverride === null
        ? getReadProgress()
        : normalizeReadProgressPayload(progressDataOverride);
    const now = Date.now();
    rows.forEach((row) => {
      if (!(row instanceof Element) || !row.isConnected) return;
      upsertProgressJumpButtonForRow(row, progressData, now);
    });
  };

  const updateReadIndicatorUI = (targetPostId) => {
    // [核心修复] 在函数入口处直接检查设置状态
    // 如果开关关闭，则强制将目标ID设为null，这将触发后续的隐藏逻辑
    const settings = getSettings();
    if (
      settings.enableGeneralSettings !== true ||
      settings.showReadIndicator !== true
    ) {
      targetPostId = null;
    }

    if (!readIndicatorElement) {
      readIndicatorElement = document.createElement("div");
      readIndicatorElement.className = "s1p-read-indicator";
      const indicatorIcon = document.createElement("span");
      indicatorIcon.className = "s1p-read-indicator-icon";
      const indicatorText = document.createElement("span");
      indicatorText.textContent = "当前阅读位置";
      readIndicatorElement.appendChild(indicatorIcon);
      readIndicatorElement.appendChild(indicatorText);
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
            if (newPti && indicatorWidth > 0) {
              newPti.style.paddingRight =
                `${indicatorWidth + READ_INDICATOR_CONTENT_GAP_PX}px`;
            }
            if (!indicator.parentElement) {
              newParentPi.appendChild(indicator);
            }
            const floorEl = newParentPi.querySelector("strong");
            const actionsEl = newParentPi.querySelector("#fj");
            const rightOffset =
              (floorEl ? floorEl.offsetWidth : 0) +
              (actionsEl ? actionsEl.offsetWidth : 0) +
              READ_INDICATOR_RIGHT_SAFE_GAP_PX;
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
  let readProgressVisiblePosts = new Map();
  let readProgressSaveTimeout = null;
  let readProgressPersistTimeout = null;
  let pendingThreadProgressWrites = {};
  let readProgressContext = null;
  const flushPendingThreadProgressWrites = ({ suppressSyncTrigger = false } = {}) => {
    if (readProgressPersistTimeout) {
      clearTimeout(readProgressPersistTimeout);
      readProgressPersistTimeout = null;
    }

    const pendingThreadIds = Object.keys(pendingThreadProgressWrites);
    if (pendingThreadIds.length === 0) {
      return false;
    }

    const progress = { ...getReadProgress() };
    let hasChanges = false;

    pendingThreadIds.forEach((threadId) => {
      const pendingRecord = pendingThreadProgressWrites[threadId];
      if (!pendingRecord) return;

      const pendingPageNumber = parseInt(pendingRecord.page, 10);
      const pendingFloorNumber = parseInt(pendingRecord.lastReadFloor, 10);
      if (
        !Number.isFinite(pendingPageNumber) ||
        pendingPageNumber <= 0 ||
        !Number.isFinite(pendingFloorNumber) ||
        pendingFloorNumber <= 0
      ) {
        return;
      }

      const currentProgress = progress[threadId];
      if (
        !shouldAdvanceThreadProgress(
          currentProgress,
          pendingPageNumber,
          pendingFloorNumber
        )
      ) {
        return;
      }

      progress[threadId] = pendingRecord;
      hasChanges = true;
    });

    pendingThreadProgressWrites = {};

    if (hasChanges) {
      saveReadProgress(progress, suppressSyncTrigger);
      return true;
    }
    return false;
  };
  const schedulePendingThreadProgressPersist = () => {
    if (readProgressPersistTimeout) return;
    readProgressPersistTimeout = setTimeout(() => {
      readProgressPersistTimeout = null;
      flushPendingThreadProgressWrites();
    }, READ_PROGRESS_PERSIST_DEBOUNCE_MS);
  };
  const saveCurrentReadProgress = () => {
    if (!readProgressContext || readProgressVisiblePosts.size === 0) return;

    let maxFloor = 0;
    let finalPostId = null;
    readProgressVisiblePosts.forEach((floor, postId) => {
      if (floor > maxFloor) {
        maxFloor = floor;
        finalPostId = postId;
      }
    });

    if (finalPostId && maxFloor > 0) {
      if (getSettings().showReadIndicator) {
        updateReadIndicatorUI(finalPostId);
      }
      updateThreadProgress(
        readProgressContext.threadId,
        finalPostId,
        readProgressContext.currentPage,
        maxFloor
      );
    }
  };
  const flushReadProgressSave = () => {
    if (readProgressSaveTimeout) {
      clearTimeout(readProgressSaveTimeout);
      readProgressSaveTimeout = null;
    }
    saveCurrentReadProgress();
    flushPendingThreadProgressWrites();
  };
  const scheduleReadProgressSave = () => {
    if (readProgressSaveTimeout) {
      clearTimeout(readProgressSaveTimeout);
    }
    readProgressSaveTimeout = setTimeout(() => {
      readProgressSaveTimeout = null;
      saveCurrentReadProgress();
    }, 1500);
  };
  const handleReadProgressVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      flushReadProgressSave();
    }
  };
  const resetReadProgressObserver = ({
    clearObservedMarkers = false,
    flushPendingProgress = false,
  } = {}) => {
    if (flushPendingProgress) {
      flushPendingThreadProgressWrites();
    } else {
      if (readProgressPersistTimeout) {
        clearTimeout(readProgressPersistTimeout);
        readProgressPersistTimeout = null;
      }
      pendingThreadProgressWrites = {};
    }
    if (pageObserver) {
      pageObserver.disconnect();
      pageObserver = null;
    }
    if (readProgressSaveTimeout) {
      clearTimeout(readProgressSaveTimeout);
      readProgressSaveTimeout = null;
    }
    readProgressVisiblePosts.clear();
    readProgressContext = null;
    document.removeEventListener(
      "visibilitychange",
      handleReadProgressVisibilityChange
    );
    window.removeEventListener("beforeunload", flushReadProgressSave);
    window.removeEventListener("pagehide", flushReadProgressSave);
    if (clearObservedMarkers) {
      document
        .querySelectorAll('table[id^="pid"][data-s1p-observed]')
        .forEach((el) => {
          el.removeAttribute("data-s1p-observed");
        });
    }
  };
  let currentLoggedInUid = null; // [新增] 缓存当前登录用户的UID
  /**
   * [新增 & 修正] 获取当前登录用户的UID
   * (根据用户提供的HTML片段修正了选择器和正则表达式)
   * @returns {string|null} 当前登录用户的UID，如果未找到则返回null
   */
  const getCurrentLoggedInUid = () => {
    if (currentLoggedInUid) {
      return currentLoggedInUid;
    }

    // 方案 1: 查找 #um strong.vwmy a (来自用户截图)
    // <strong class="vwmy"><a href="space-uid-425635.html" ...>moekyo</a></strong>
    let userSpaceLink = document.querySelector(
      '#um strong.vwmy a[href*="space-uid-"]'
    );
    if (userSpaceLink) {
      const match = userSpaceLink.href.match(/space-uid-(\d+)/);
      if (match && match[1]) {
        currentLoggedInUid = match[1];
        // console.log("S1 Plus: 当前登录用户 UID (vwmy) ->", currentLoggedInUid);
        return currentLoggedInUid;
      }
    }

    console.warn(
      "S1 Plus: 无法确定当前登录用户的 UID。屏蔽/标记按钮可能也会显示在自己的帖子上。"
    );
    return null;
  };

  const trackReadProgressInThread = (postTables = null) => {
    const settings = getSettings();
    const postListElement = document.getElementById("postlist");
    if (
      settings.enableGeneralSettings !== true ||
      settings.enableReadProgress !== true ||
      !postListElement
    ) {
      if (
        pageObserver ||
        readProgressSaveTimeout ||
        readProgressPersistTimeout ||
        readProgressContext ||
        Object.keys(pendingThreadProgressWrites).length > 0
      ) {
        resetReadProgressObserver({
          clearObservedMarkers: true,
          flushPendingProgress: true,
        });
      }
      return;
    }

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

    const hasContextChanged =
      !readProgressContext ||
      readProgressContext.threadId !== threadId ||
      readProgressContext.currentPage !== currentPage;
    if (hasContextChanged) {
      readProgressVisiblePosts.clear();
      if (readProgressSaveTimeout) {
        clearTimeout(readProgressSaveTimeout);
        readProgressSaveTimeout = null;
      }
    }
    readProgressContext = { threadId, currentPage };

    // --- [核心修改] 确保 pageObserver 只初始化一次，并能监控后续新增的元素 ---
    if (!pageObserver) {
      const getFloorFromElement = (el) => {
        const floorElement = el.querySelector(".pi em");
        return floorElement ? parseInt(floorElement.textContent) || 0 : 0;
      };

      pageObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const postId = entry.target.id.replace("pid", "");
            if (entry.isIntersecting) {
              const floor = getFloorFromElement(entry.target);
              if (floor > 0) {
                readProgressVisiblePosts.set(postId, floor);
              }
            } else {
              readProgressVisiblePosts.delete(postId);
            }
          });
          scheduleReadProgressSave();
        },
        { threshold: 0.3 }
      );

      document.removeEventListener(
        "visibilitychange",
        handleReadProgressVisibilityChange
      );
      window.removeEventListener("beforeunload", flushReadProgressSave);
      window.removeEventListener("pagehide", flushReadProgressSave);
      document.addEventListener(
        "visibilitychange",
        handleReadProgressVisibilityChange
      );
      window.addEventListener("beforeunload", flushReadProgressSave);
      window.addEventListener("pagehide", flushReadProgressSave);
    }

    const scopedRoots = normalizeScopeRoots(postTables);
    const targetPostTables =
      scopedRoots === null
        ? Array.from(document.querySelectorAll('table[id^="pid"]'))
        : collectNodesByScope(scopedRoots, 'table[id^="pid"]');

    // [新增] 每次函数运行时（包括页面动态变化后），都检查并添加未被监控的帖子
    targetPostTables.forEach((el) => {
      // 使用一个自定义属性来避免重复添加监控
      if (!el.dataset.s1pObserved) {
        pageObserver.observe(el);
        el.dataset.s1pObserved = "true";
      }
    });
  };

  const resetAuthiLayoutState = (authiDiv) => {
    if (!authiDiv) return;

    authiDiv.classList.remove("s1p-authi-layout");

    const piContainer = authiDiv.closest(".pi");
    if (!piContainer) return;

    piContainer.classList.remove("s1p-authi-layout");

    const spacer = piContainer.querySelector(".s1p-layout-spacer");
    if (spacer) {
      spacer.remove();
    }

    const floorNumberEl = piContainer.querySelector("strong.s1p-layout-ready");
    if (floorNumberEl) {
      floorNumberEl.classList.remove("s1p-layout-ready");
    }
  };

  const detachAuthiContainer = (container) => {
    if (!container) return;

    const parent = container.parentElement;
    const authiDiv = container.querySelector(".authi");
    if (authiDiv && parent) {
      // 将原生 .authi 元素移回其原始位置（即总容器的前面）
      parent.insertBefore(authiDiv, container);
      resetAuthiLayoutState(authiDiv);
    }
    // 彻底移除脚本创建的总容器，这样里面的脚本按钮（.s1p-authi-actions-wrapper）也会一并被移除
    container.remove();
  };

  const refreshAllAuthiActions = () => {
    // 遍历每个由脚本创建的、用于包裹原生按钮和脚本按钮的总容器
    document.querySelectorAll(".s1p-authi-container").forEach(detachAuthiContainer);

    // 在完成彻底的清理后，重新调用主函数，根据当前最新的设置来添加按钮
    addActionsToPostFooter();
  };

  const refreshSinglePostActions = (postId) => {
    const postTable = getPostTableById(postId);
    if (!postTable) return;

    const container = postTable.querySelector(".s1p-authi-container");
    detachAuthiContainer(container);
    addActionsToSinglePost(postTable);
  };

  const createTagDeleteConfirmMenu = (anchorElement, tagOptionsAnchor) => {
    // 清理任何已存在的确认菜单
    const existingConfirmMenu = document.querySelector(
      ".s1p-inline-confirm-menu[data-s1p-confirm-for-tag]"
    );
    if (existingConfirmMenu) {
      if (
        existingConfirmMenu.s1p_api &&
        typeof existingConfirmMenu.s1p_api.destroy === "function"
      ) {
        existingConfirmMenu.s1p_api.destroy({ immediate: true });
      } else {
        existingConfirmMenu.remove();
      }
    }

    const { userId, userName } = tagOptionsAnchor.dataset;

    const menu = document.createElement("div");
    menu.className = "s1p-options-menu s1p-inline-confirm-menu s1p-confirm-wrapper";
    menu.dataset.s1pConfirmForTag = "true"; // 添加唯一标识
    markAsPostToolbarPopup(menu);
    menu.style.width = "max-content";

    const content = buildConfirmationMarkup("确认删除？", {
      actionLayout: "text-first",
    });
    menu.appendChild(content);
    document.body.appendChild(menu);

    const cancelBtn = menu.querySelector(".s1p-cancel");
    const confirmBtn = menu.querySelector(".s1p-confirm");

    // --- [修正] 智能定位 (修正垂直对齐逻辑) ---
    const anchorRect = anchorElement.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    // 直接将确认菜单的顶部与触发它的“删除标记”按钮的顶部对齐
    const top = anchorRect.top + window.scrollY - 2;

    let left;
    const spaceOnRight = window.innerWidth - anchorRect.right;
    const requiredSpace = menuRect.width + 10;

    if (spaceOnRight >= requiredSpace) {
      // 右侧定位: 在按钮右侧留出 10px 间距
      left = anchorRect.right + window.scrollX + 8;
    } else {
      // [最终修正 V2] 左侧定位:
      // 在理论值 17px 的基础上，增加 7px 的安全边距，总偏移量为 24px。
      // 这足以覆盖浏览器渲染时产生的未知布局偏差。
      left = anchorRect.left + window.scrollX - menuRect.width - 28;
    }

    if (left < window.scrollX) {
      left = window.scrollX + 8;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    // --- 交互逻辑 ---
    let isClosing = false;
    let bindDocumentClickTimer = null;
    const optionsMenu = anchorElement.closest(".s1p-tag-options-menu");
    const destroyConfirmMenu = ({ immediate = false } = {}) => {
      if (isClosing) return;
      isClosing = true;
      if (bindDocumentClickTimer) {
        clearTimeout(bindDocumentClickTimer);
        bindDocumentClickTimer = null;
      }
      document.removeEventListener("click", closeAllMenusOnClick);
      if (immediate) {
        menu.remove();
        return;
      }
      menu.classList.remove("visible");
      setTimeout(() => menu.remove(), 200);
    };

    const closeAllMenus = () => {
      destroyConfirmMenu();
      if (optionsMenu) {
        if (optionsMenu.s1p_api && typeof optionsMenu.s1p_api.destroy === "function") {
          optionsMenu.s1p_api.destroy();
        } else {
          optionsMenu.remove();
        }
      }
    };

    const closeAllMenusOnClick = (e) => {
      if (
        !e.target.closest(
          ".s1p-tag-options-menu, .s1p-inline-confirm-menu[data-s1p-confirm-for-tag]"
        )
      ) {
        closeAllMenus();
      }
    };

    menu.querySelector(".s1p-confirm").addEventListener("click", (e) => {
      e.stopPropagation();
      const tags = getUserTags();
      delete tags[userId];
      saveUserTags(tags);
      refreshUserPostsOnPage(userId);
      closeAllMenus();
    });

    menu.querySelector(".s1p-cancel").addEventListener("click", (e) => {
      e.stopPropagation();
      closeAllMenus();
    });

    menu.s1p_api = { destroy: destroyConfirmMenu };

    // 让确认菜单也参与到主菜单的悬停逻辑中
    if (optionsMenu && optionsMenu.s1p_api) {
      menu.addEventListener("mouseenter", optionsMenu.s1p_api.cancelHideTimer);
      menu.addEventListener("mouseleave", optionsMenu.s1p_api.startHideTimer);
    }

    // 添加全局点击监听器，用于在点击空白处时关闭所有菜单
    bindDocumentClickTimer = setTimeout(() => {
      bindDocumentClickTimer = null;
      if (!isClosing) {
        document.addEventListener("click", closeAllMenusOnClick);
      }
    }, 0);

    // 动画入场
    requestAnimationFrame(() => menu.classList.add("visible"));
  };

  const NATIVE_POST_EDIT_LINK_SELECTOR =
    'a.editp, .pob a[href*="action=edit"], .po.hin a[href*="action=edit"], a[onclick*="showWindow"][onclick*="edit"]';

  const createPostEditToolbarLink = (postTable) => {
    const nativeEditLink = postTable.querySelector(NATIVE_POST_EDIT_LINK_SELECTOR);
    if (!nativeEditLink) {
      return null;
    }
    const editLink = nativeEditLink.cloneNode(true);
    editLink.className =
      "s1p-authi-action s1p-toolbar-icon-btn s1p-edit-post-in-authi s1p-has-tooltip";
    setSanitizedIconHtml(editLink, TOOLBAR_ICONS.editPost);
    editLink.dataset.fullTag = "编辑当前回复";
    editLink.removeAttribute("id");
    editLink.removeAttribute("title");
    return editLink;
  };

  const createOptionsMenu = (anchorElement) => {
    // 如果菜单已存在，则取消其隐藏计时器，防止因快速移入移出导致闪烁
    const existingMenu = document.querySelector(".s1p-tag-options-menu");
    if (existingMenu) {
      if (existingMenu.__s1pAnchorElement === anchorElement) {
        if (existingMenu.s1p_api) existingMenu.s1p_api.cancelHideTimer();
        return;
      }
      if (
        existingMenu.s1p_api &&
        typeof existingMenu.s1p_api.destroy === "function"
      ) {
        existingMenu.s1p_api.destroy();
      } else {
        existingMenu.remove();
      }
    }

    // 打开用户标记二级菜单前，先清空其他类型的二级弹窗，避免叠窗。
    dismissToolbarSecondaryPopups();

    // 在创建新菜单前，清理所有可能残留的菜单
    const existingConfirmMenu = document.querySelector(
      ".s1p-inline-confirm-menu[data-s1p-confirm-for-tag]"
    );
    if (existingConfirmMenu) {
      if (
        existingConfirmMenu.s1p_api &&
        typeof existingConfirmMenu.s1p_api.destroy === "function"
      ) {
        existingConfirmMenu.s1p_api.destroy({ immediate: true });
      } else {
        existingConfirmMenu.remove();
      }
    }

    const { userId, userName } = anchorElement.dataset;
    const menu = document.createElement("div");
    menu.className = "s1p-tag-options-menu";
    markAsPostToolbarPopup(menu);

    const editBtn = document.createElement("button");
    editBtn.dataset.action = "edit";
    editBtn.textContent = "编辑标记";
    menu.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.dataset.action = "delete";
    deleteBtn.className = "s1p-delete";
    deleteBtn.textContent = "删除标记";
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);

    // --- 悬停与计时器逻辑 ---
    let hideTimeout;
    let isMenuClosed = false;
    const detachHoverListeners = () => {
      anchorElement.removeEventListener("mouseleave", startHideTimer);
      menu.removeEventListener("mouseenter", cancelHideTimer);
      menu.removeEventListener("mouseleave", startHideTimer);
    };
    const closeAllMenus = () => {
      if (isMenuClosed) return;
      isMenuClosed = true;
      cancelHideTimer();
      detachHoverListeners();
      menu.remove();
      const confirmMenu = document.querySelector(
        ".s1p-inline-confirm-menu[data-s1p-confirm-for-tag]"
      );
      if (confirmMenu) {
        if (
          confirmMenu.s1p_api &&
          typeof confirmMenu.s1p_api.destroy === "function"
        ) {
          confirmMenu.s1p_api.destroy({ immediate: true });
        } else {
          confirmMenu.remove();
        }
      }
    };

    const startHideTimer = () => {
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => {
        const confirmMenu = document.querySelector(
          ".s1p-inline-confirm-menu[data-s1p-confirm-for-tag]"
        );
        // 如果鼠标不在触发点、选项菜单或确认菜单上，则关闭所有
        if (
          !anchorElement.matches(":hover") &&
          !menu.matches(":hover") &&
          (!confirmMenu || !confirmMenu.matches(":hover"))
        ) {
          closeAllMenus();
        }
      }, 300);
    };

    const cancelHideTimer = () => clearTimeout(hideTimeout);

    // 将API附加到菜单元素上，以便其他部分（如确认菜单）可以调用
    menu.__s1pAnchorElement = anchorElement;
    menu.s1p_api = { startHideTimer, cancelHideTimer, destroy: closeAllMenus };

    anchorElement.addEventListener("mouseleave", startHideTimer);
    menu.addEventListener("mouseenter", cancelHideTimer);
    menu.addEventListener("mouseleave", startHideTimer);

    // --- 定位 ---
    const rect = anchorElement.getBoundingClientRect();
    menu.style.top = `${rect.bottom + window.scrollY + 2}px`;
    menu.style.left = `${rect.right + window.scrollX - menu.offsetWidth}px`;

    // --- 按钮事件 ---
    menu.addEventListener("click", (e) => {
      e.stopPropagation();
      const targetButton = e.target.closest("button");
      if (!targetButton) return;
      const action = targetButton.dataset.action;

      if (action === "edit") {
        const popover = document.getElementById("s1p-tag-popover-main");
        if (popover && popover.show) {
          popover.show(anchorElement, userId, userName);
        }
        closeAllMenus();
      } else if (action === "delete") {
        // 点击删除时，取消隐藏计时器并弹出确认菜单
        cancelHideTimer();
        createTagDeleteConfirmMenu(targetButton, anchorElement);
      }
    });

    // 初始调用，防止鼠标快速划过时意外触发关闭
    cancelHideTimer();
  };

  /**
   * [修改] 帖子楼层内操作按钮注入 (V2 - 增加当前用户判断)
   * * @param {HTMLElement} postTable - 帖子的 <table> DOM 元素
   */
  const addActionsToSinglePost = (postTable) => {
    const settings = getSettings();
    const authiDiv = postTable.querySelector(".plc .authi");
    if (!authiDiv) return;

    // --- [核心修改] 将 pi 容器作为操作目标 ---
    const piContainer = authiDiv.closest(".pi");
    if (!piContainer) return;

    // 标记为脚本接管布局，避免样式影响到其他 .pi/.authi 区块
    piContainer.classList.add("s1p-authi-layout");
    authiDiv.classList.add("s1p-authi-layout");

    // --- [这里是新增的“伸缩器”逻辑] ---
    // 检查并添加永久的布局伸缩器，确保布局稳定
    if (!piContainer.querySelector(".s1p-layout-spacer")) {
      const spacer = document.createElement("div");
      spacer.className = "s1p-layout-spacer";
      piContainer.appendChild(spacer);
    }
    // --- [新增逻辑结束] ---

    if (authiDiv.parentElement.classList.contains("s1p-authi-container")) {
      // --- [新增] 即使容器已存在，也要确保楼层号可见 ---
      const floorNumberEl = piContainer.querySelector("strong");
      if (floorNumberEl) {
        floorNumberEl.classList.add("s1p-layout-ready");
      }
      return;
    }

    const plsCell = postTable.querySelector("td.pls");
    if (!plsCell) return;
    const userProfileLink = plsCell.querySelector('a[href*="space-uid-"]');
    if (!userProfileLink) return;
    const uidMatch = userProfileLink.href.match(/space-uid-(\d+)\.html/);
    const userId = uidMatch ? uidMatch[1] : null; // 这是帖子作者的 UID
    if (!userId) return;

    // --- [新增] 获取当前登录用户的UID，并进行比较 ---
    const loggedInUid = getCurrentLoggedInUid();
    const isCurrentUserPost = loggedInUid && loggedInUid === userId;
    // ------------------------------------------

    const postId = postTable.id.replace("pid", "");
    const floorElement = postTable.querySelector(`#postnum${postId} em`);
    const floor = floorElement ? parseInt(floorElement.textContent, 10) : 0;
    const userName = userProfileLink.textContent.trim();
    const userAvatar = plsCell.querySelector(".avatar img")?.src;

    const newContainer = document.createElement("div");
    newContainer.className = "s1p-authi-container";
    const scriptActionsWrapper = document.createElement("span");
    scriptActionsWrapper.className = "s1p-authi-actions-wrapper";
    scriptActionsWrapper.addEventListener(
      "click",
      (event) => {
        const clickTarget = event.target instanceof Element ? event.target : null;
        if (!clickTarget || !clickTarget.closest("a, .s1p-user-tag-options")) {
          return;
        }
        dismissToolbarSecondaryPopups();
      },
      true
    );

    // --- [新增] 将原生的“只看该作者”、“显示全部楼层”和“倒序/正序浏览”按钮移动到脚本的操作栏中 ---
    // 收集需要移动的按钮，以便我们可以控制它们的排列顺序
    const nativeLinks = {
      order: null,    // 倒序/正序浏览 (排第一)
      author: null,   // 只看该作者 (排第二)
      showAll: null   // 显示全部楼层 (排第三)
    };

    authiDiv.querySelectorAll('a').forEach(link => {
      const linkText = link.textContent.trim();
      const isAuthorLink = (link.href.includes('authorid=') && (linkText === "只看该作者" || linkText === "只看该用户" || link.title === "只看该用户" || link.querySelector('svg')));
      const isShowAllLink = (linkText === "显示全部楼层" || link.title === "显示全部楼层");
      const isOrderLink = (linkText.includes("倒序") || linkText.includes("正序"));

      if (isAuthorLink) nativeLinks.author = link;
      else if (isShowAllLink) nativeLinks.showAll = link;
      else if (isOrderLink) nativeLinks.order = link;

      if (isAuthorLink || isShowAllLink || isOrderLink) {
        // 移除原 authiDiv 中紧跟在该链接之前的分隔符 (pipe)
        const prev = link.previousElementSibling;
        if (prev && (prev.classList.contains('pipe') || (prev.tagName === 'SPAN' && prev.textContent.trim() === '|'))) {
          prev.remove();
        }
      }
    });

    // 按指定顺序添加到脚本操作栏
    if (nativeLinks.order) scriptActionsWrapper.appendChild(nativeLinks.order);
    if (nativeLinks.author) scriptActionsWrapper.appendChild(nativeLinks.author);
    if (nativeLinks.showAll) scriptActionsWrapper.appendChild(nativeLinks.showAll);

    // 仅在“当前楼层属于本人”时尝试创建编辑按钮；若论坛未提供原生编辑入口则返回 null
    const pendingEditLink = isCurrentUserPost
      ? createPostEditToolbarLink(postTable)
      : null;

    if (settings.enableBookmarkReplies) {
      const bookmarkedReplies = getBookmarkedReplies();
      const isBookmarked = !!bookmarkedReplies[postId];

      const bookmarkLink = document.createElement("a");
      bookmarkLink.href = "javascript:void(0);";
      bookmarkLink.className = "s1p-authi-action s1p-toolbar-icon-btn s1p-bookmark-reply s1p-has-tooltip";
      if (isBookmarked) {
        bookmarkLink.classList.add("s1p-bookmarked");
      }
      setSanitizedIconHtml(
        bookmarkLink,
        isBookmarked ? TOOLBAR_ICONS.bookmarked : TOOLBAR_ICONS.bookmark
      );
      bookmarkLink.dataset.fullTag = isBookmarked ? "取消收藏" : "收藏该回复";
      bookmarkLink.addEventListener("click", (e) => {
        e.preventDefault();
        const currentBookmarks = getBookmarkedReplies();
        const wasBookmarked = !!currentBookmarks[postId];
        if (wasBookmarked) {
          delete currentBookmarks[postId];
          saveBookmarkedReplies(currentBookmarks);
          setSanitizedIconHtml(bookmarkLink, TOOLBAR_ICONS.bookmark);
          bookmarkLink.dataset.fullTag = "收藏该回复";
          bookmarkLink.classList.remove("s1p-bookmarked");
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
                ".pstatus, .quote, .s1p-image-toggle-all-container, .s1p-quote-placeholder"
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
            contentPreview: buildBookmarkContentPreview(postContent),
            postContent: postContent,
            timestamp: Date.now(),
          };
          saveBookmarkedReplies(currentBookmarks);
          setSanitizedIconHtml(bookmarkLink, TOOLBAR_ICONS.bookmarked);
          bookmarkLink.dataset.fullTag = "取消收藏";
          bookmarkLink.classList.add("s1p-bookmarked");
          showMessage("已收藏该回复。", true);
        }
      });
      scriptActionsWrapper.appendChild(bookmarkLink);
    }

    if (!isCurrentUserPost) {
      if (settings.enableUserBlocking) {

        const blockLink = document.createElement("a");
        blockLink.href = "javascript:void(0);";
        blockLink.className = "s1p-authi-action s1p-toolbar-icon-btn s1p-block-user-in-authi s1p-has-tooltip";
        setSanitizedIconHtml(blockLink, TOOLBAR_ICONS.blockUser);
        blockLink.dataset.fullTag = "屏蔽该用户";
        blockLink.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          // 将 e.currentTarget (即被点击的 a 标签)作为第一个参数传入
          createInlineConfirmMenu(
            e.currentTarget,
            buildUserBlockConfirmText(getSettings()),
            async (remark) => {
              const nativeSyncSucceeded = await blockUser(userId, userName, remark);
              showUserBlockResultMessage(
                userName,
                nativeSyncSucceeded,
                getSettings()
              );
            },
            { inputPlaceholder: "添加备注 (可选)" }
          );
        });
        scriptActionsWrapper.appendChild(blockLink);
      }

      // [NEW] Block specific post/floor
      if (settings.enablePostBlocking) {
        const blockedPosts = getBlockedPosts();
        const isPostBlocked = !!blockedPosts[postId];

        if (!isPostBlocked) {

          const blockPostLink = document.createElement("a");
          blockPostLink.href = "javascript:void(0);";
          blockPostLink.className = "s1p-authi-action s1p-toolbar-icon-btn s1p-block-post-in-authi s1p-has-tooltip";
          setSanitizedIconHtml(blockPostLink, TOOLBAR_ICONS.blockPost);
          blockPostLink.dataset.fullTag = "屏蔽该楼层";
          blockPostLink.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Get thread information
            const threadTitleEl = document.querySelector("#thread_subject");
            const threadTitle = threadTitleEl
              ? threadTitleEl.textContent.trim()
              : "未知标题";
            const threadIdMatch = window.location.href.match(/thread-(\d+)-/);
            const params = new URLSearchParams(window.location.search);
            const threadId = threadIdMatch
              ? threadIdMatch[1]
              : params.get("tid") || params.get("ptid");

            // Get post content
            const contentEl = postTable.querySelector("td.t_f");
            let postContent = "无法获取内容";
            if (contentEl) {
              const contentClone = contentEl.cloneNode(true);
              contentClone
                .querySelectorAll(
                  ".pstatus, .quote, .s1p-image-toggle-all-container, .s1p-quote-placeholder"
                )
                .forEach((el) => el.remove());
              postContent = contentClone.innerText
                .trim()
                .replace(/\n{3,}/g, "\n\n");
            }

            createInlineConfirmMenu(e.currentTarget, "确认屏蔽该楼层？", () => {
              blockPost(postId, threadId, threadTitle, floor, userId, userName, postContent);
              showMessage(`已屏蔽第 ${floor} 楼。`, true);
            });
          });
          scriptActionsWrapper.appendChild(blockPostLink);
        }
      }

      if (settings.enableUserTagging) {
        const userTags = getUserTags();
        const userTag = userTags[userId];

        if (userTag && userTag.tag) {
          const tagContainer = document.createElement("span");
          tagContainer.className = "s1p-authi-action s1p-user-tag-container";
          // 应用用户选择的颜色
          if (userTag.color) {
            tagContainer.classList.add(`s1p-tag-color-${userTag.color}`);
          }
          const fullTagText = userTag.tag;
          const tagDisplay = document.createElement("span");
          tagDisplay.className = "s1p-user-tag-display";
          tagDisplay.textContent = `用户标记：${fullTagText}`;
          tagDisplay.dataset.fullTag = fullTagText;
          tagDisplay.removeAttribute("title");
          const optionsIcon = document.createElement("span");
          optionsIcon.className = "s1p-user-tag-options";
          optionsIcon.textContent = "\u22EE";
          optionsIcon.dataset.userId = userId;
          optionsIcon.dataset.userName = userName;
          optionsIcon.addEventListener("mouseenter", (e) => {
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
          tagLink.className = "s1p-authi-action s1p-toolbar-icon-btn s1p-tag-user-in-authi s1p-has-tooltip";
          setSanitizedIconHtml(tagLink, TOOLBAR_ICONS.tagUser);
          tagLink.dataset.fullTag = "标记该用户";
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
    }

    // 按需求固定放在工具栏最后
    if (pendingEditLink) {
      scriptActionsWrapper.appendChild(pendingEditLink);
    }



    if (scriptActionsWrapper.hasChildNodes()) {
      authiDiv.parentElement.insertBefore(newContainer, authiDiv);
      newContainer.appendChild(authiDiv);
      newContainer.appendChild(scriptActionsWrapper);
    }

    const floorNumberEl = piContainer.querySelector("strong");
    if (floorNumberEl) {
      floorNumberEl.classList.add("s1p-layout-ready");
    }
  };

  const addActionsToPostFooter = () => {
    const settings = getSettings();
    if (
      !settings.enableUserBlocking &&
      !settings.enableUserTagging &&
      !settings.enableBookmarkReplies &&
      !settings.enablePostBlocking
    )
      return;
    document
      .querySelectorAll('table[id^="pid"]')
      .forEach(addActionsToSinglePost);
  };

  const PROFILE_HEADER_SELECTOR = "#uhd .h.cl";
  const PROFILE_HEADER_FALLBACK_SELECTOR = ".h.cl";
  const PROFILE_HEADER_USER_LINK_SELECTOR =
    '.icn.avt a[href*="space-uid-"], .icn.avt a[href*="uid="]';

  const findProfileHeader = () =>
    document.querySelector(PROFILE_HEADER_SELECTOR) ||
    Array.from(document.querySelectorAll(PROFILE_HEADER_FALLBACK_SELECTOR)).find(
      (header) =>
        header.querySelector(".icn.avt") &&
        header.querySelector("h2.mt") &&
        header.querySelector(PROFILE_HEADER_USER_LINK_SELECTOR)
    );

  const resolveProfileHeaderIdentity = (profileHeader) => {
    if (!(profileHeader instanceof Element)) {
      return { userId: "", userName: "" };
    }

    const searchParams = new URLSearchParams(window.location.search);
    const profileLink = profileHeader.querySelector(
      PROFILE_HEADER_USER_LINK_SELECTOR
    );
    const shortUidMatch = window.location.search.match(/^\?(\d+)$/);
    const uidFromSummaryTextMatch =
      profileHeader.textContent.match(/\(UID[:：]\s*(\d+)\)/i) ||
      document.body.textContent.match(/\(UID[:：]\s*(\d+)\)/i);

    const userId =
      extractUidFromSpaceUrl(profileLink?.href || "") ||
      normalizeNumericId(searchParams.get("uid")) ||
      normalizeNumericId(shortUidMatch && shortUidMatch[1]) ||
      extractUidFromSpaceUrl(window.location.href) ||
      normalizeNumericId(uidFromSummaryTextMatch && uidFromSummaryTextMatch[1]);
    const userName = normalizeUsernameInput(
      profileHeader.querySelector("h2.mt")?.textContent?.trim() || ""
    );
    return { userId, userName };
  };

  let profileHeaderBlockButtonRetryTimer = null;
  const scheduleProfileHeaderBlockButtonRefresh = (delayMs = 700) => {
    if (profileHeaderBlockButtonRetryTimer) {
      clearTimeout(profileHeaderBlockButtonRetryTimer);
    }
    profileHeaderBlockButtonRetryTimer = setTimeout(() => {
      profileHeaderBlockButtonRetryTimer = null;
      addBlockButtonToUserProfileHeader();
    }, Math.max(0, Number(delayMs) || 0));
  };

  const addBlockButtonToUserProfileHeader = () => {
    const profileHeader = findProfileHeader();
    if (!profileHeader) {
      return false;
    }
    profileHeader
      .querySelectorAll(".s1p-profile-block-user-wrap")
      .forEach((node) => node.remove());

    const settings = getSettings();
    if (!settings.enableUserBlocking) {
      return true;
    }

    const { userId, userName } = resolveProfileHeaderIdentity(profileHeader);
    if (!userId || !userName) {
      return false;
    }

    const loggedInUid = getCurrentLoggedInUid();
    if (loggedInUid && loggedInUid === userId) {
      return true;
    }

    const actionWrap = document.createElement("span");
    actionWrap.className = "s1p-profile-block-user-wrap";
    actionWrap.style.cssText = "display:inline-block; vertical-align:middle; margin-left:10px;";

    const titleEl = profileHeader.querySelector("h2.mt");
    if (titleEl) {
      titleEl.style.display = "inline-block";
      titleEl.style.verticalAlign = "middle";
    }

    const blockBtn = document.createElement("button");
    blockBtn.type = "button";
    blockBtn.className = "s1p-btn s1p-profile-block-user-btn";

    const blockedUsers = getBlockedUsers();
    const alreadyBlocked = Boolean(blockedUsers[userId]);
    blockBtn.textContent = alreadyBlocked ? "已屏蔽该用户" : "屏蔽该用户";
    if (alreadyBlocked) {
      blockBtn.classList.add("is-blocked");
    }

    actionWrap.appendChild(blockBtn);
    if (titleEl) {
      titleEl.insertAdjacentElement("afterend", actionWrap);
    } else {
      profileHeader.appendChild(actionWrap);
    }

    blockBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const isCurrentlyBlocked = blockBtn.classList.contains("is-blocked");

      if (isCurrentlyBlocked) {
        createInlineConfirmMenu(
          blockBtn,
          `确认解除对 ${userName} 的屏蔽？`,
          async () => {
            const blockedUsers = getBlockedUsers();
            const wasSynced =
              blockedUsers[userId]?.addedToNativeBlacklist === true;
            const success = await unblockUser(userId);
            if (success) {
              addBlockButtonToUserProfileHeader();
              showMessage(`已解除对 ${userName} 的屏蔽。`, true);
            } else {
              showMessage(
                wasSynced
                  ? "取消失败：无法从论坛黑名单移除，已保留本地屏蔽状态。"
                  : "取消失败：请稍后重试。",
                false
              );
            }
          }
        );
      } else {
        createInlineConfirmMenu(
          blockBtn,
          buildUserBlockConfirmText(getSettings()),
          async (remark) => {
            const nativeSyncSucceeded = await blockUser(userId, userName, remark);
            addBlockButtonToUserProfileHeader();
            showUserBlockResultMessage(
              userName,
              nativeSyncSucceeded,
              getSettings()
            );
          },
          { inputPlaceholder: "添加备注 (可选)" }
        );
      }
    });
    return true;
  };

  // [新增] S1 NUX 安装推荐函数
  const handleNuxRecommendation = () => {
    // 1. 如果已启用 NUX，则不执行任何操作
    if (isS1NuxEnabled) return;

    // 2. 检查用户是否在设置中关闭了推荐
    const settings = getSettings();
    if (!settings.recommendS1Nux) return;

    // 3. 频率控制：每7天最多推荐一次
    const LAST_REC_KEY = "s1p_last_nux_recommendation_timestamp";
    const lastRecommendationTimestamp = GM_getValue(LAST_REC_KEY, 0);
    const now = Date.now();
    const threeDaysInMillis = 7 * 24 * 60 * 60 * 1000;

    if (now - lastRecommendationTimestamp < threeDaysInMillis) {
      console.log(
        "S1 Plus: S1 NUX recommendation throttled (less than 7 days ago)."
      );
      return;
    }

    // 4. 创建并显示推荐弹窗
    const bodyHtml = `
        <p>检测到您尚未安装 <strong>S1 NUX</strong> 论坛美化扩展。</p>
        <p>S1 Plus 与 S1 NUX 搭配使用可获得最佳论坛浏览体验，强烈推荐安装！</p>
        <div class="s1p-notice s1p-notice-top16 s1p-notice-gap8">
             <div class="s1p-notice-icon"></div>
             <div class="s1p-notice-content">
                <a href="https://stage1st.com/2b/thread-1826103-1-2.html" target="_blank" rel="noopener noreferrer">点击此处，了解 S1 NUX 详情</a>
                <p>一个由 S1 用户创作的、旨在优化论坛视觉和交互的 CSS 样式扩展。</p>
             </div>
        </div>
    `;

    const installButton = {
      text: "前往安装",
      className: "s1p-confirm",
      action: () => {
        GM_openInTab("https://userstyles.world/style/539", true);
        const currentSettings = getSettingsForWrite();
        if (currentSettings.recommendS1Nux) {
          currentSettings.recommendS1Nux = false;
          saveSettings(currentSettings);
        }
      },
    };

    const disableButton = {
      text: "不再提示",
      className: "s1p-cancel",
      action: () => {
        const currentSettings = getSettingsForWrite();
        currentSettings.recommendS1Nux = false;
        saveSettings(currentSettings);
        showMessage("好的，将不再为您推荐 S1 NUX。", true);
      },
    };

    // [核心修改] 调用时传入 modalClassName
    createAdvancedConfirmationModal(
      "S1 Plus 体验升级推荐",
      bodyHtml,
      [disableButton, installButton],
      { modalClassName: "s1p-nux-recommend-modal", allowBodyHtml: true }
    );

    // 5. 更新推荐时间戳
    GM_setValue(LAST_REC_KEY, now);
  };

  /**
   * [修改] 自动签到 (V2 - 支持多账号)
   * 修正了多账号切换时，签到记录互相干扰的问题。
   */
  function autoSign() {
    if (isAutoSignInFlight) {
      return;
    }

    const checkinLink = document.querySelector(
      'a[href*="study_daily_attendance-daily_attendance.html"]'
    );
    if (!checkinLink) return;

    // --- [新增] 获取当前用户UID ---
    const uid = getCurrentLoggedInUid();
    if (!uid) {
      // 如果没有UID（未登录），则不执行签到
      return;
    }
    const signedDateKey = `signedDate_${uid}`; // <-- [修改] Key 变为 per-user
    const signAttemptDateKey = `signedAttemptDate_${uid}`;
    // ----------------------------

    const now = new Date();
    const nowTs = Date.now();
    const date =
      now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
    const signedDate = GM_getValue(signedDateKey); // <-- [修改]
    const rawAttemptState = GM_getValue(signAttemptDateKey, null);
    const attemptState =
      rawAttemptState && typeof rawAttemptState === "object"
        ? rawAttemptState
        : typeof rawAttemptState === "string"
          ? { date: rawAttemptState, nextRetryAt: 0, failCount: 1 }
          : null;

    if (signedDate === date) {
      checkinLink.style.display = "none";
      return;
    }

    if (attemptState && attemptState.date === date) {
      const nextRetryAt = Number(attemptState.nextRetryAt) || 0;
      if (nextRetryAt > nowTs) {
        return;
      }
    }

    if (now.getHours() < 6) return;

    const setAttemptState = (failCount = 0, delayMs = 0) => {
      const safeFailCount = Math.max(0, Number(failCount) || 0);
      const nowForRetry = Date.now();
      GM_setValue(signAttemptDateKey, {
        date,
        failCount: safeFailCount,
        nextRetryAt: Math.max(0, nowForRetry + Math.max(0, delayMs)),
      });
    };
    const scheduleRetryAfterFailure = () => {
      const latestStateRaw = GM_getValue(signAttemptDateKey, null);
      const latestState =
        latestStateRaw && typeof latestStateRaw === "object"
          ? latestStateRaw
          : typeof latestStateRaw === "string"
            ? { date: latestStateRaw, nextRetryAt: 0, failCount: 1 }
            : null;
      const previousFailCount =
        latestState && latestState.date === date
          ? Number(latestState.failCount) || 0
          : 0;
      const nextFailCount = previousFailCount + 1;
      const baseDelay = 3 * 60 * 1000;
      const cappedDelay = 60 * 60 * 1000;
      const delayMs = Math.min(
        cappedDelay,
        baseDelay * Math.pow(2, Math.max(0, nextFailCount - 1))
      );
      setAttemptState(nextFailCount, delayMs);
    };

    isAutoSignInFlight = true;
    // 请求发出后先短暂锁定，避免页面内/多标签重复触发；失败后会改写为退避重试时间。
    setAttemptState(
      attemptState && attemptState.date === date
        ? Number(attemptState.failCount) || 0
        : 0,
      2 * 60 * 1000
    );

    GM_xmlhttpRequest({
      method: "GET",
      url: checkinLink.href,
      timeout: REMOTE_SYNC_REQUEST_TIMEOUT_MS,
      onload: function (response) {
        isAutoSignInFlight = false;
        if (response.status >= 200 && response.status < 300) {
          GM_setValue(signedDateKey, date); // <-- [修改]
          GM_deleteValue(signAttemptDateKey);
          checkinLink.style.display = "none";
          console.log(
            `S1 Plus: Auto check-in for UID ${uid} sent. Status:`,
            response.status
          );
          return;
        }
        console.warn(
          `S1 Plus: Auto check-in for UID ${uid} returned non-2xx status:`,
          response.status
        );
        scheduleRetryAfterFailure();
      },
      onerror: function (response) {
        isAutoSignInFlight = false;
        console.error(
          `S1 Plus: Auto check-in for UID ${uid} failed.`,
          response
        );
        scheduleRetryAfterFailure();
      },
      ontimeout: function () {
        isAutoSignInFlight = false;
        console.error(`S1 Plus: Auto check-in for UID ${uid} timed out.`);
        scheduleRetryAfterFailure();
      },
    });
  }
  // [修改] 将设置项重命名为 enhanceFloatingControls
  const createCustomFloatingControls = () => {
    // 1. 如果自定义控件已存在，则直接退出
    if (document.getElementById("s1p-floating-controls-wrapper")) {
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
    wrapper.id = "s1p-floating-controls-wrapper";
    // [核心修改] 读取新命名的设置并添加对应的class
    const settings = getSettings();
    if (
      settings.enableGeneralSettings === true &&
      settings.enhanceFloatingControls === true
    ) {
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
      setSanitizedIconHtml(link, svg);
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

  // --- [新增] 悬浮控件管理器 ---
  const manageFloatingControls = () => {
    const settings = getSettings();
    const shouldEnableEnhancedControls =
      settings.enableGeneralSettings === true &&
      settings.enhanceFloatingControls === true;
    // 根据设置，切换body上的class，从而激活不同的CSS规则
    document.body.classList.toggle(
      "s1p-enhanced-controls-active",
      shouldEnableEnhancedControls
    );

    if (shouldEnableEnhancedControls) {
      // 如果设置为开启，则调用创建函数（它内部有防重复机制）
      createCustomFloatingControls();
    } else {
      // 如果设置为关闭，则确保移除脚本创建的控件
      document.getElementById("s1p-floating-controls-wrapper")?.remove();
    }
  };

  const cleanupOldReadProgress = () => {
    const settings = getSettings();
    // 只有在自动清理模式下才执行清理
    if (settings.cleanupMode !== 'auto') return;
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
      // [S1PLUS-CLEANUP-FIX] 标记已发生清理，等待用户同步确认
      GM_setValue("s1p_pending_cleanup_info", cleanedCount);
      // [核心修正] 将 suppressSyncTrigger 改为 false，以确保时间戳被更新
      saveReadProgress(cleanedProgress, false);
    }
  };

  // 手动清理阅读记录
  /**
   * 删除指定时间范围内的阅读记录
   * @param {Array} ageRange - 时间范围 [minMs, maxMs]
   * @param {string} groupLabel - 分组标签（用于提示信息）
   */
  const deleteProgressGroup = (ageRange, groupLabel) => {
    const progress = getReadProgress();
    const originalCount = Object.keys(progress).length;
    if (originalCount === 0) {
      showMessage("暂无阅读记录", true);
      return;
    }

    const now = Date.now();
    const [minAge, maxAge] = ageRange;
    const cleanedProgress = {};
    let deletedCount = 0;

    for (const threadId in progress) {
      if (Object.prototype.hasOwnProperty.call(progress, threadId)) {
        const record = progress[threadId];
        if (record.timestamp) {
          const age = now - record.timestamp;
          // 如果不在删除范围内，则保留
          if (age < minAge || age >= maxAge) {
            cleanedProgress[threadId] = record;
          } else {
            deletedCount++;
          }
        } else {
          // 没有时间戳的记录保留
          cleanedProgress[threadId] = record;
        }
      }
    }

    if (deletedCount > 0) {
      // [FIX] 设置清理标记，使同步逻辑能识别这是一次清理操作
      GM_setValue("s1p_pending_cleanup_info", deletedCount);
      saveReadProgress(cleanedProgress, false);
      showMessage(`成功删除"${groupLabel}"分组的 ${deletedCount} 条阅读记录`, true);
      // 刷新弹窗内容
      const modal = document.querySelector(".s1p-reading-progress-modal");
      if (modal) {
        // 关闭当前弹窗并重新打开
        modal.remove();
        setTimeout(() => createReadingProgressDetailModal(), 100);
      }
    } else {
      showMessage(`"${groupLabel}"分组没有记录需要删除`, true);
    }
  };

  /**
   * 创建阅读记录详情弹窗
   */
  const createReadingProgressDetailModal = () => {
    // 移除已存在的弹窗
    document.querySelector(".s1p-reading-progress-modal")?.remove();

    const progress = getReadProgress();
    const totalCount = Object.keys(progress).length;

    if (totalCount === 0) {
      showMessage("暂无阅读记录", true);
      return;
    }

    // 按时间分组
    const groups = groupReadProgressByTime(progress);

    // 创建弹窗
    const modal = document.createElement("div");
    modal.className = "s1p-confirm-modal s1p-reading-progress-modal";

    const content = document.createElement("div");
    content.className = "s1p-confirm-content s1p-reading-progress-content";

    const closeIcon = document.createElement("div");
    closeIcon.className = "s1p-modal-close s1p-close-modal";
    content.appendChild(closeIcon);

    const body = document.createElement("div");
    body.className = "s1p-confirm-body";

    const title = document.createElement("h2");
    title.style.fontSize = "18px";
    title.style.fontWeight = "600";
    title.style.margin = "0 0 4px 0";
    title.textContent = "阅读记录详情";
    body.appendChild(title);

    const summary = document.createElement("p");
    summary.style.fontSize = "13px";
    summary.style.color = "var(--s1p-desc-t)";
    summary.style.margin = "0 0 16px 0";
    summary.textContent = `共 ${totalCount} 条阅读记录`;
    body.appendChild(summary);

    const table = document.createElement("div");
    table.className = "s1p-sync-comparison-table";

    const headerRow = document.createElement("div");
    headerRow.className = "s1p-sync-comparison-row s1p-sync-comparison-header";
    ["时间范围", "记录数", "操作"].forEach((text) => {
      const headerCell = document.createElement("div");
      headerCell.className = "s1p-sync-comparison-value";
      if (text === "时间范围") {
        headerCell.className = "s1p-sync-comparison-label";
      }
      headerCell.textContent = text;
      headerRow.appendChild(headerCell);
    });
    table.appendChild(headerRow);

    groups.forEach((group) => {
      const row = document.createElement("div");
      row.className = "s1p-sync-comparison-row";

      const labelCell = document.createElement("div");
      labelCell.className = "s1p-sync-comparison-label";
      labelCell.textContent = String(group?.label ?? "");
      row.appendChild(labelCell);

      const countCell = document.createElement("div");
      countCell.className = "s1p-sync-comparison-value";
      countCell.textContent = `${group?.count || 0} 条`;
      row.appendChild(countCell);

      const actionCell = document.createElement("div");
      actionCell.className = "s1p-sync-comparison-value";

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "s1p-btn s1p-red-btn s1p-progress-group-delete";
      deleteBtn.style.padding = "4px 12px";
      deleteBtn.style.fontSize = "13px";
      deleteBtn.textContent = "删除";
      deleteBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const ageRange = group?.ageRange;
        const label = String(group?.label ?? "");

        // 二次确认
        createAdvancedConfirmationModal(
          "确认删除",
          `<p>确定要删除"${escapeHTML(label)}"分组的所有阅读记录吗？</p><p>此操作不可撤销。</p>`,
          [
            {
              text: "取消",
              className: "s1p-cancel",
              action: () => { },
            },
            {
              text: "确认删除",
              className: "s1p-confirm",
              action: () => {
                deleteProgressGroup(ageRange, label);
              },
            },
          ],
          { allowBodyHtml: true }
        );
      });
      actionCell.appendChild(deleteBtn);

      row.appendChild(actionCell);
      table.appendChild(row);
    });

    body.appendChild(table);
    content.appendChild(body);
    modal.appendChild(content);

    // 关闭弹窗函数
    const closeModal = () => {
      content.style.animation = "s1p-scale-out 0.25s ease-out forwards";
      modal.style.animation = "s1p-fade-out 0.25s ease-out forwards";
      setTimeout(() => modal.remove(), 250);
    };

    // 点击遮罩层关闭
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    // 关闭按钮
    const closeBtn = modal.querySelector(".s1p-close-modal");
    if (closeBtn) {
      closeBtn.addEventListener("click", closeModal);
    }

    document.body.appendChild(modal);
  };

  const notifyAutoSyncConflictPausedIfNeeded = async () => {
    if (!(await shouldShowConflictModal("auto_conflict_paused"))) {
      return;
    }
    showMessage(
      "自动同步因上次冲突仍处于暂停状态，请先在导航栏执行手动同步。",
      false
    );
  };

  const handlePerLoadSyncCheck = async () => {
    const settings = getSettings();

    if (
      !settings.syncDailyFirstLoad &&
      settings.syncAutoEnabled &&
      settings.syncRemoteEnabled &&
      settings.syncRemoteGistId &&
      settings.syncRemotePat
    ) {
      if (!(await acquireStartupSyncLock())) {
        console.log(
          "S1 Plus: 检测到其他同步任务正在执行，本次常规启动同步检查已跳过。"
        );
        return false;
      }
      startStartupSyncLockHeartbeat();

      console.log("S1 Plus: 执行常规启动时同步检查（因每日首次同步已关闭）...");
      try {
        // [S1P-FIX] 调用时传入 true，启用启动安全模式，并绑定启动锁上下文。
        const result = await performAutoSync(true, SYNC_LOCK_MODE_STARTUP);
        switch (result.status) {
          case "success":
            if (result.action === "pulled" || result.action === "force_pulled") {
              showMessage("检测到云端有更新，正在刷新页面...", true);
              setTimeout(() => location.reload(), 1500);
              return true;
            }
            if (result.action === "skipped_push_on_startup") {
              showMessage(
                "检测到本地数据较新，已跳过本次启动自动推送。请稍后在导航栏手动同步。",
                false
              );
            }
            break;
          case "failure":
            showMessage(`启动同步检查失败: ${result.error}`, false);
            break;
          case "conflict":
            showMessage("启动同步检查检测到冲突，请在导航栏执行手动同步。", false);
            break;
          case "skipped":
            if (result.reason === "circuit_open") {
              showMessage(
                `自动同步因连续失败已暂停，预计恢复时间：${new Date(
                  result.until
                ).toLocaleTimeString("zh-CN", { hour12: false })}。`,
                false
              );
            } else if (result.reason === "conflict_paused") {
              await notifyAutoSyncConflictPausedIfNeeded();
            } else if (result.reason === "lock_lost") {
              showMessage("常规启动同步检查因锁失效已中止，本次将跳过。", false);
            }
            break;
        }
      } finally {
        stopStartupSyncLockHeartbeat();
        releaseStartupSyncLock();
      }
    }
    return false;
  };
  const handleStartupSync = async () => {
    const settings = getSettings();
    if (!settings.syncRemoteEnabled || !settings.syncDailyFirstLoad) {
      return false;
    }

    const today = new Date().toLocaleDateString("sv");
    const lastSyncDate = GM_getValue("s1p_last_daily_sync_date", null);

    if (today === lastSyncDate) {
      return false;
    }

    if (!(await acquireStartupSyncLock())) {
      console.log(
        "S1 Plus: 检测到其他同步任务正在执行，本次启动同步已跳过。"
      );
      return false;
    }

    startStartupSyncLockHeartbeat();

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

      const result = await performAutoSync(true, SYNC_LOCK_MODE_STARTUP);
      if (
        result.status === "success" &&
        result.action !== "skipped_push_on_startup"
      ) {
        GM_setValue("s1p_last_daily_sync_date", today);
      }

      switch (result.status) {
        case "success":
          // [修改] 增加对 "force_pulled" 状态的处理
          if (result.action === "pulled" || result.action === "force_pulled") {
            const message =
              result.action === "force_pulled"
                ? "启动时强制同步完成：已使用云端数据覆盖本地。正在刷新..."
                : "每日同步完成：云端有更新已被自动拉取。正在刷新...";
            showMessage(message, true);
            setTimeout(() => location.reload(), 1500);
            return true;
          } else if (result.action === "skipped_push_on_startup") {
            if (!(await shouldShowConflictModal("startup_local_newer"))) {
              showMessage(
                "检测到本地数据较新，已进入提示冷却。请稍后在导航栏手动同步。",
                false
              );
              return false;
            }
            createAdvancedConfirmationModal(
              "检测到本地有未同步的更改",
              "<p>S1 Plus 在启动时发现，您的本地数据比云端备份要新。这可能意味着您在其他设备的工作未推送，或有离线修改未同步。</p><p>为防止数据丢失，自动同步已暂停。请选择如何处理：</p>",
              [
                {
                  text: "稍后处理",
                  className: "s1p-cancel",
                  action: () => {
                    showMessage("同步已暂停，您可稍后从导航栏手动同步。", null);
                  },
                },
                {
                  text: "立即解决",
                  className: "s1p-confirm",
                  action: () => {
                    // [S1P-UX-FIX] 调用时传入 true，进入静默模式，避免弹出多余的提示
                    handleManualSync(true);
                  },
                },
              ],
              { allowBodyHtml: true }
            );
            return "popup_shown"; // [FIX] 标记已显示弹窗，阻止后续 Token 过期弹窗覆盖
          } else {
            if (result.action !== "pushed_initial") {
              showMessage("每日首次同步完成，数据已是最新。", true);
            }
          }
          break;
        case "failure":
          showMessage(`每日首次同步失败: ${result.error}`, false);
          break;

        case "conflict":
          if (!(await shouldShowConflictModal("startup_conflict"))) {
            showMessage(
              "再次检测到启动同步冲突，已进入提示冷却。请稍后手动同步处理。",
              false
            );
            return false;
          }
          createAdvancedConfirmationModal(
            "检测到同步冲突",
            "<p>S1 Plus在自动同步时发现，您的本地数据和云端备份可能都已更改。</p><p>为防止数据丢失，自动同步已暂停。请手动选择要保留的版本来解决冲突。</p>",
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
                  // [S1P-UX-FIX] 此处也应进入静默模式
                  handleManualSync(true);
                },
              },
            ],
            { allowBodyHtml: true }
          );
          return "popup_shown"; // [FIX] 标记已显示弹窗，阻止后续 Token 过期弹窗覆盖
        case "skipped":
          if (result.reason === "circuit_open") {
            showMessage(
              `自动同步因连续失败已暂停，预计恢复时间：${new Date(
                result.until
              ).toLocaleTimeString("zh-CN", { hour12: false })}。`,
              false
            );
          } else if (result.reason === "conflict_paused") {
            await notifyAutoSyncConflictPausedIfNeeded();
          } else if (result.reason === "lock_lost") {
            showMessage("启动同步因锁失效已中止，本次将跳过。", false);
          }
          break;
      }
    } finally {
      stopStartupSyncLockHeartbeat();
      releaseStartupSyncLock();
      console.log("S1 Plus: 同步锁已释放。");
    }

    return false;
  };

  /**
   * [MODIFIED] 首次加载此版本时，显示更新亮点弹窗，并返回是否显示了弹窗。
   * @returns {boolean} 如果显示了弹窗则返回 true，否则返回 false。
   */
  const showFirstTimeWelcomeIfNeeded = () => {
    // [OPTIMIZED] 动态生成欢迎标记的键，确保每个版本只显示一次
    const WELCOME_FLAG_KEY = `s1p_v${SCRIPT_VERSION.replace(
      /\./g,
      "_"
    )}_welcomed`;
    const hasSeenWelcome = GM_getValue(WELCOME_FLAG_KEY, false);

    if (hasSeenWelcome) {
      return false; // 已看过，不显示弹窗，返回 false
    }

    // [OPTIMIZED] 优化HTML结构以改善文本布局和换行
    const bodyHtml = `
    <p>已更新至 v${SCRIPT_VERSION}！这次更新主要是把链接打开体验做得更顺手。</p>
    <p>链接跳转更稳定了，误跳转和打断阅读的情况更少。</p>
    <p>旧设置升级也更平滑，开关状态会更容易保持一致。</p>
  `;

    const buttons = [
      {
        text: "我明白了",
        className: "s1p-confirm",
        action: () => {
          GM_setValue(WELCOME_FLAG_KEY, true);
        },
      },
    ];

    // [OPTIMIZED] 动态获取版本号
    createAdvancedConfirmationModal(
      `S1 Plus v${SCRIPT_VERSION} 更新亮点`,
      bodyHtml,
      buttons,
      {
        modalClassName: "s1p-welcome-modal",
        allowBodyHtml: true,
      }
    );

    return true; // 确认显示了弹窗，返回 true
  };

  /**
   * [新增] 检查 Token 是否即将过期
   * @returns {boolean} 是否显示了提醒弹窗
   */
  const checkTokenExpiry = () => {
    const settings = getSettings();
    if (!settings.syncRemoteEnabled || !settings.syncTokenExpiryEnabled) {
      return false;
    }

    const expiryTimestamp = Number(settings.syncTokenExpiryDate);
    if (!Number.isFinite(expiryTimestamp) || expiryTimestamp <= 0) {
      return false;
    }

    const today = new Date().toLocaleDateString("sv");
    const lastCheckDate = GM_getValue("s1p_last_token_check_date", null);

    if (today === lastCheckDate) return false;

    const daysLeft = Math.ceil((expiryTimestamp - Date.now()) / (1000 * 60 * 60 * 24));

    // Expired or within 3 days
    if (daysLeft <= 3) {
      GM_setValue("s1p_last_token_check_date", today); // Set checked today

      let title = "Sync Token 即将过期";
      let content = `<p>您的 GitHub Personal Access Token 将于 <strong>${daysLeft}</strong> 天后过期。</p><p>请及时更新 Token 以免影响同步功能。</p>`;

      if (daysLeft < 0) {
        title = "Sync Token 已过期";
        content = `<p>您的 GitHub Personal Access Token 已过期 <strong>${Math.abs(daysLeft)}</strong> 天。</p><p>同步功能可能已无法使用，请立即更新。</p>`;
      } else if (daysLeft === 0) {
        title = "Sync Token 今天过期";
        content = `<p>您的 GitHub Personal Access Token 将在今天过期。</p><p>请及时更新。</p>`;
      }

      createAdvancedConfirmationModal(
        title,
        content,
        [
          {
            text: "知道了",
            className: "s1p-btn", // Just a normal button
            action: () => { } // Do nothing, date already updated
          },
          {
            text: "前往生成",
            className: "s1p-btn",
            action: () => {
              GM_openInTab("https://github.com/settings/tokens", true);
            }
          },
          {
            text: "已更新",
            className: "s1p-confirm",
            action: () => {
              const existingSettingsModal = document.querySelector(".s1p-modal");
              if (!existingSettingsModal) {
                createManagementModal();
              }
              const focusSyncSettings = () => {
                const settingsModal = document.querySelector(".s1p-modal");
                if (!settingsModal) {
                  return;
                }
                settingsModal
                  .querySelector('.s1p-tab-btn[data-tab="sync"]')
                  ?.click();
                settingsModal
                  .querySelector("#s1p-token-expiry-info-container")
                  ?.scrollIntoView({ block: "center", behavior: "smooth" });
                showMessage(
                  "请在“设置同步”中更新 Token 有效期，并点击“保存设置”后生效。",
                  true
                );
              };
              if (existingSettingsModal) {
                focusSyncSettings();
              } else {
                setTimeout(focusSyncSettings, 80);
              }
            }
          }
        ],
        { modalClassName: "s1p-token-expiry-modal", allowBodyHtml: true }
      );
      return true; // Shown
    }
    return false;
  };

  async function main() {
    // [即时生效] 立即应用楼层屏蔽CSS类，防止FOUC (Flash of Unstyled Content)
    // 必须放在 await handleStartupSync 之前
    hideSystemBlockedPosts();
    migrateLegacySettingsIfNeeded();

    // [修改] 调用欢迎弹窗并接收其状态
    const welcomePopupWasShown = showFirstTimeWelcomeIfNeeded();

    // --- [核心修改] 按照您的建议，分离启动同步的调用 ---
    // 步骤1: 尝试执行每日首次同步
    const startupSyncResult = await handleStartupSync();
    if (startupSyncResult === true) {
      return; // 如果页面即将刷新，则中断后续所有脚本初始化操作
    }
    // 步骤2: 尝试执行常规的“每次加载”同步检查
    const isReloadingAfterPerLoadSync = await handlePerLoadSyncCheck();
    if (isReloadingAfterPerLoadSync) {
      return; // 如果页面即将刷新，则中断后续所有脚本初始化操作
    }

    // [FIX] 将 Token 过期检查移到同步流程之后，避免弹窗被同步弹窗覆盖
    if (!welcomePopupWasShown && startupSyncResult !== "popup_shown") {
      checkTokenExpiry();
    }

    migrateLegacyReadProgressData();
    cleanupOldReadProgress();
    detectS1Nux();

    // [核心修正] 只有在未显示欢迎弹窗时，才检查NUX推荐，避免冲突
    if (!welcomePopupWasShown) {
      handleNuxRecommendation();
    }

    initializeNavbar();
    initializeAutoSyncIndicatorCrossTabSync();
    bindPendingAutoSyncRecoveryHooks();
    recoverPendingAutoSyncIfNeeded();
    initializeGenericDisplayPopover();
    initializeSettingsCacheSync();
    initializeSettingsFallbackSync();
    initializeCoreDataCacheSync();
    initializeReadProgressCrossTabRefresh();

    let observer = null;
    let observerApplyTimer = null;
    let observerIsApplying = false;
    let observerPendingNavReinit = false;
    let observerPendingThreadRefresh = false;
    let observerPendingPostRefresh = false;
    let observerRequireFullApply = false;
    let observerPendingThreadRows = new Set();
    let observerPendingPostTables = new Set();
    let observerPendingThreadNeedsFullRefresh = false;
    let observerPendingPostNeedsFullRefresh = false;
    let observerPendingQuoteRefresh = false;
    let observerPendingRatingsRefresh = false;
    let observerPendingNotificationRefresh = false;
    let observerPendingQuoteScopes = new Set();
    let observerPendingRatingsScopes = new Set();
    let observerPendingNotificationScopes = new Set();
    let observerPendingQuoteScopesOverflow = false;
    let observerPendingRatingsScopesOverflow = false;
    let observerPendingNotificationScopesOverflow = false;
    const threadMutationSelector =
      'tbody[id^="normalthread_"], tbody[id^="stickthread_"], #threadlist';
    const postMutationSelector =
      '#postlist, table[id^="pid"], .authi, .xld.xlda, tbody.ratl_l, #uhd';
    const threadRowSelector = 'tbody[id^="normalthread_"], tbody[id^="stickthread_"]';
    const postTableSelector = 'table[id^="pid"]';
    const quoteMutationSelector =
      "div.quote, .s1p-quote-wrapper, .s1p-quote-placeholder";
    const ratingsMutationSelector = "tbody.ratl_l";
    const notificationMutationSelector =
      ".xld.xlda, .s1p-notification-wrapper, .s1p-notification-placeholder";
    const quoteScopeSelector =
      "div.quote, .s1p-quote-wrapper, .s1p-quote-placeholder";
    const ratingsScopeSelector = "tbody.ratl_l, tbody.ratl_l tr";
    const notificationScopeSelector =
      ".xld.xlda, dl.cl, .s1p-notification-wrapper, .s1p-notification-placeholder";
    const observerRelevantMutationSelector = [
      threadMutationSelector,
      postMutationSelector,
      quoteMutationSelector,
      ratingsMutationSelector,
      notificationMutationSelector,
    ].join(", ");
    const observerThreadSetMaxSize = OBSERVER_INCREMENTAL_THREAD_ROW_LIMIT + 1;
    const observerPostSetMaxSize = OBSERVER_INCREMENTAL_POST_TABLE_LIMIT + 1;
    const observerQuoteScopeSetMaxSize =
      OBSERVER_INCREMENTAL_QUOTE_SCOPE_LIMIT + 1;
    const observerRatingsScopeSetMaxSize =
      OBSERVER_INCREMENTAL_RATINGS_SCOPE_LIMIT + 1;
    const observerNotificationScopeSetMaxSize =
      OBSERVER_INCREMENTAL_NOTIFICATION_SCOPE_LIMIT + 1;
    const resolveObserverWatchTarget = () =>
      document.getElementById("ct") ||
      document.getElementById("wp") ||
      document.body;

    const mutationTouchesSelector = (node, selector) => {
      if (!(node instanceof Element)) {
        return false;
      }
      if (node.matches(selector)) {
        return true;
      }
      if (!node.firstElementChild) {
        return false;
      }
      return Boolean(node.querySelector(selector));
    };
    const collectMatchesToSet = (
      node,
      selector,
      targetSet,
      maxSize = Number.POSITIVE_INFINITY
    ) => {
      if (!(node instanceof Element) || targetSet.size > maxSize) return;
      const addNode = (targetNode) => {
        targetSet.add(targetNode);
        return targetSet.size <= maxSize;
      };
      if (node.matches(selector) && !addNode(node)) {
        return;
      }
      if (!node.firstElementChild) {
        return;
      }
      for (const matchedNode of node.querySelectorAll(selector)) {
        if (!addNode(matchedNode)) {
          break;
        }
      }
    };
    const classifyMutationBatch = (mutationList) => {
      let touchesThreadArea = false;
      let touchesPostArea = false;
      let shouldForceFullApply = false;
      let threadNeedsFullRefresh = false;
      let postNeedsFullRefresh = false;
      let touchesQuoteArea = false;
      let touchesRatingsArea = false;
      let touchesNotificationArea = false;
      const addedThreadRows = new Set();
      const addedPostTables = new Set();
      const addedQuoteScopes = new Set();
      const addedRatingsScopes = new Set();
      const addedNotificationScopes = new Set();
      const inspectNode = (node, { isRemoved = false } = {}) => {
        if (!(node instanceof Element)) {
          return;
        }
        if (node.id === "wp" || node.id === "ct") {
          shouldForceFullApply = true;
          return;
        }
        if (!mutationTouchesSelector(node, observerRelevantMutationSelector)) {
          return;
        }
        if (!touchesThreadArea && mutationTouchesSelector(node, threadMutationSelector)) {
          touchesThreadArea = true;
          if (isRemoved) {
            threadNeedsFullRefresh = true;
          }
        }
        if (!touchesPostArea && mutationTouchesSelector(node, postMutationSelector)) {
          touchesPostArea = true;
          if (isRemoved) {
            postNeedsFullRefresh = true;
          }
        }
        if (!touchesQuoteArea && mutationTouchesSelector(node, quoteMutationSelector)) {
          touchesQuoteArea = true;
        }
        if (
          !touchesRatingsArea &&
          mutationTouchesSelector(node, ratingsMutationSelector)
        ) {
          touchesRatingsArea = true;
        }
        if (
          !touchesNotificationArea &&
          mutationTouchesSelector(node, notificationMutationSelector)
        ) {
          touchesNotificationArea = true;
        }
        if (!isRemoved) {
          collectMatchesToSet(
            node,
            threadRowSelector,
            addedThreadRows,
            observerThreadSetMaxSize
          );
          collectMatchesToSet(
            node,
            postTableSelector,
            addedPostTables,
            observerPostSetMaxSize
          );
          collectMatchesToSet(
            node,
            quoteScopeSelector,
            addedQuoteScopes,
            observerQuoteScopeSetMaxSize
          );
          collectMatchesToSet(
            node,
            ratingsScopeSelector,
            addedRatingsScopes,
            observerRatingsScopeSetMaxSize
          );
          collectMatchesToSet(
            node,
            notificationScopeSelector,
            addedNotificationScopes,
            observerNotificationScopeSetMaxSize
          );
        }
      };

      mutationList.forEach((mutation) => {
        if (
          !touchesThreadArea &&
          mutation.target instanceof Element &&
          mutationTouchesSelector(mutation.target, threadMutationSelector)
        ) {
          touchesThreadArea = true;
          if (mutation.addedNodes.length === 0) {
            threadNeedsFullRefresh = true;
          }
        }
        if (
          !touchesPostArea &&
          mutation.target instanceof Element &&
          mutationTouchesSelector(mutation.target, postMutationSelector)
        ) {
          touchesPostArea = true;
          if (mutation.addedNodes.length === 0) {
            postNeedsFullRefresh = true;
          }
        }
        if (
          mutation.target instanceof Element &&
          mutation.target.matches(quoteMutationSelector)
        ) {
          touchesQuoteArea = true;
          collectMatchesToSet(
            mutation.target,
            quoteScopeSelector,
            addedQuoteScopes,
            observerQuoteScopeSetMaxSize
          );
        }
        if (
          mutation.target instanceof Element &&
          mutation.target.matches(ratingsMutationSelector)
        ) {
          touchesRatingsArea = true;
          collectMatchesToSet(
            mutation.target,
            ratingsScopeSelector,
            addedRatingsScopes,
            observerRatingsScopeSetMaxSize
          );
        }
        if (
          mutation.target instanceof Element &&
          mutation.target.matches(notificationMutationSelector)
        ) {
          touchesNotificationArea = true;
          collectMatchesToSet(
            mutation.target,
            notificationScopeSelector,
            addedNotificationScopes,
            observerNotificationScopeSetMaxSize
          );
        }
        mutation.addedNodes.forEach((node) => inspectNode(node, { isRemoved: false }));
        mutation.removedNodes.forEach((node) => inspectNode(node, { isRemoved: true }));
      });

      const addedQuoteScopesOverflow =
        addedQuoteScopes.size > OBSERVER_INCREMENTAL_QUOTE_SCOPE_LIMIT;
      const addedRatingsScopesOverflow =
        addedRatingsScopes.size > OBSERVER_INCREMENTAL_RATINGS_SCOPE_LIMIT;
      const addedNotificationScopesOverflow =
        addedNotificationScopes.size >
        OBSERVER_INCREMENTAL_NOTIFICATION_SCOPE_LIMIT;

      return {
        touchesThreadArea,
        touchesPostArea,
        shouldForceFullApply,
        threadNeedsFullRefresh,
        postNeedsFullRefresh,
        touchesQuoteArea,
        touchesRatingsArea,
        touchesNotificationArea,
        addedThreadRows,
        addedPostTables,
        addedQuoteScopes,
        addedRatingsScopes,
        addedNotificationScopes,
        addedQuoteScopesOverflow,
        addedRatingsScopesOverflow,
        addedNotificationScopesOverflow,
      };
    };
    const mergePendingScopedNodesWithLimit = (
      pendingSet,
      incomingSet,
      limit,
      hasOverflow
    ) => {
      if (hasOverflow) {
        return true;
      }
      for (const node of incomingSet) {
        pendingSet.add(node);
        if (pendingSet.size > limit) {
          pendingSet.clear();
          return true;
        }
      }
      return false;
    };
    const applyIncrementalChanges = () => {
      const settings = getSettings();
      const shouldEnableReadProgress =
        settings.enableGeneralSettings === true &&
        settings.enableReadProgress === true;
      let shouldRefreshGlobalLinkBehavior = false;
      const pendingThreadRows = Array.from(observerPendingThreadRows).filter(
        (row) => row instanceof Element && row.isConnected
      );
      const pendingPostTables = Array.from(observerPendingPostTables).filter(
        (table) => table instanceof Element && table.isConnected
      );
      const pendingQuoteScopes = Array.from(observerPendingQuoteScopes).filter(
        (node) => node instanceof Element && node.isConnected
      );
      const pendingRatingsScopes = Array.from(observerPendingRatingsScopes).filter(
        (node) => node instanceof Element && node.isConnected
      );
      const pendingNotificationScopes = Array.from(
        observerPendingNotificationScopes
      ).filter((node) => node instanceof Element && node.isConnected);
      const canUseScopedThreadRefresh =
        pendingThreadRows.length > 0 &&
        pendingThreadRows.length <= OBSERVER_INCREMENTAL_THREAD_ROW_LIMIT &&
        !observerPendingThreadNeedsFullRefresh;
      const canUseScopedPostRefresh =
        pendingPostTables.length > 0 &&
        pendingPostTables.length <= OBSERVER_INCREMENTAL_POST_TABLE_LIMIT &&
        !observerPendingPostNeedsFullRefresh;
      const canUseScopedQuoteRefresh =
        !observerPendingQuoteScopesOverflow &&
        pendingQuoteScopes.length > 0 &&
        pendingQuoteScopes.length <= OBSERVER_INCREMENTAL_QUOTE_SCOPE_LIMIT;
      const canUseScopedRatingsRefresh =
        !observerPendingRatingsScopesOverflow &&
        pendingRatingsScopes.length > 0 &&
        pendingRatingsScopes.length <= OBSERVER_INCREMENTAL_RATINGS_SCOPE_LIMIT;
      const canUseScopedNotificationRefresh =
        !observerPendingNotificationScopesOverflow &&
        pendingNotificationScopes.length > 0 &&
        pendingNotificationScopes.length <=
        OBSERVER_INCREMENTAL_NOTIFICATION_SCOPE_LIMIT;

      if (observerPendingThreadRefresh) {
        if (settings.enablePostBlocking) {
          if (canUseScopedThreadRefresh) {
            addBlockButtonsToThreadRows(pendingThreadRows);
            applyBlockedThreadVisibilityForRows(pendingThreadRows);
            applyKeywordThreadHidingForRows(pendingThreadRows, {
              rebuildHiddenState: false,
            });
            applyUserThreadBlocklistForRows(pendingThreadRows);
          } else {
            hideBlockedThreads();
            hideThreadsByTitleKeyword();
            addBlockButtonsToThreads();
            applyUserThreadBlocklist();
          }
        }
        if (shouldEnableReadProgress) {
          if (canUseScopedThreadRefresh) {
            addProgressJumpButtonsForRows(pendingThreadRows);
          } else {
            addProgressJumpButtons();
          }
        }
        shouldRefreshGlobalLinkBehavior = true;
      }
      if (observerPendingPostRefresh) {
        if (settings.enableUserBlocking) {
          if (canUseScopedPostRefresh) {
            hideBlockedUsersPostsInTables(pendingPostTables);
          } else {
            hideBlockedUsersPosts();
          }
          if (observerPendingQuoteRefresh) {
            const quoteScopeRoots =
              canUseScopedQuoteRefresh
                ? pendingQuoteScopes
                : canUseScopedPostRefresh
                  ? pendingPostTables
                  : null;
            hideBlockedUserQuotes(quoteScopeRoots);
          }
          if (observerPendingRatingsRefresh) {
            const ratingsScopeRoots =
              canUseScopedRatingsRefresh
                ? pendingRatingsScopes
                : canUseScopedPostRefresh
                  ? pendingPostTables
                  : null;
            hideBlockedUserRatings(ratingsScopeRoots);
          }
          if (observerPendingNotificationRefresh) {
            const notificationScopeRoots =
              canUseScopedNotificationRefresh
                ? pendingNotificationScopes
                : null;
            hideBlockedUserNotifications(notificationScopeRoots);
          }
        }
        if (settings.enablePostBlocking) {
          if (canUseScopedPostRefresh) {
            hideBlockedPostsInTables(pendingPostTables);
          } else {
            hideBlockedPosts();
          }
        }
        if (settings.hideSystemBlockedPosts) {
          hideSystemBlockedPosts();
        }
        if (
          settings.enableUserBlocking ||
          settings.enableUserTagging ||
          settings.enableBookmarkReplies ||
          settings.enablePostBlocking
        ) {
          if (canUseScopedPostRefresh) {
            pendingPostTables.forEach(addActionsToSinglePost);
          } else {
            addActionsToPostFooter();
          }
        }
        addBlockButtonToUserProfileHeader();
        renameAuthorLinks(canUseScopedPostRefresh ? pendingPostTables : null);
        if (settings.enableUserTagging) {
          initializeTaggingPopover();
        }
        if (canUseScopedPostRefresh) {
          applyImageHiding(pendingPostTables);
          manageImageToggleAllButtons(pendingPostTables);
          applyImageSizeLimits(pendingPostTables);
          applyS1pImageViewerBehavior(pendingPostTables);
          applyNuxDarkTextContrastFix(pendingPostTables);
          applyPlainTextUrlAutolinks(pendingPostTables);
        } else {
          applyImageHiding();
          manageImageToggleAllButtons();
          applyImageSizeLimits();
          applyS1pImageViewerBehavior();
          applyNuxDarkTextContrastFix();
          applyPlainTextUrlAutolinks();
        }
        shouldRefreshGlobalLinkBehavior = true;
        trackReadProgressInThread(
          canUseScopedPostRefresh ? pendingPostTables : null
        );
      }
      if (shouldRefreshGlobalLinkBehavior) {
        applyGlobalLinkBehavior();
      }
      ensureMyThreadsQuickLink();
    };

    const observerCallback = (mutationList = []) => {
      if (observerIsApplying) {
        return;
      }

      observerPendingNavReinit =
        observerPendingNavReinit || !document.getElementById("s1p-nav-link");
      const mutationFlags = classifyMutationBatch(mutationList);
      observerPendingThreadRefresh =
        observerPendingThreadRefresh || mutationFlags.touchesThreadArea;
      observerPendingPostRefresh =
        observerPendingPostRefresh || mutationFlags.touchesPostArea;
      observerRequireFullApply =
        observerRequireFullApply ||
        mutationFlags.shouldForceFullApply;
      observerPendingThreadNeedsFullRefresh =
        observerPendingThreadNeedsFullRefresh ||
        mutationFlags.threadNeedsFullRefresh;
      observerPendingPostNeedsFullRefresh =
        observerPendingPostNeedsFullRefresh ||
        mutationFlags.postNeedsFullRefresh;
      observerPendingQuoteRefresh =
        observerPendingQuoteRefresh || mutationFlags.touchesQuoteArea;
      observerPendingRatingsRefresh =
        observerPendingRatingsRefresh || mutationFlags.touchesRatingsArea;
      observerPendingNotificationRefresh =
        observerPendingNotificationRefresh || mutationFlags.touchesNotificationArea;
      for (const row of mutationFlags.addedThreadRows) {
        observerPendingThreadRows.add(row);
        if (observerPendingThreadRows.size >= observerThreadSetMaxSize) {
          break;
        }
      }
      for (const table of mutationFlags.addedPostTables) {
        observerPendingPostTables.add(table);
        if (observerPendingPostTables.size >= observerPostSetMaxSize) {
          break;
        }
      }
      if (mutationFlags.addedQuoteScopesOverflow) {
        observerPendingQuoteScopesOverflow = true;
        observerPendingQuoteScopes.clear();
      } else {
        observerPendingQuoteScopesOverflow = mergePendingScopedNodesWithLimit(
          observerPendingQuoteScopes,
          mutationFlags.addedQuoteScopes,
          OBSERVER_INCREMENTAL_QUOTE_SCOPE_LIMIT,
          observerPendingQuoteScopesOverflow
        );
      }
      if (mutationFlags.addedRatingsScopesOverflow) {
        observerPendingRatingsScopesOverflow = true;
        observerPendingRatingsScopes.clear();
      } else {
        observerPendingRatingsScopesOverflow = mergePendingScopedNodesWithLimit(
          observerPendingRatingsScopes,
          mutationFlags.addedRatingsScopes,
          OBSERVER_INCREMENTAL_RATINGS_SCOPE_LIMIT,
          observerPendingRatingsScopesOverflow
        );
      }
      if (mutationFlags.addedNotificationScopesOverflow) {
        observerPendingNotificationScopesOverflow = true;
        observerPendingNotificationScopes.clear();
      } else {
        observerPendingNotificationScopesOverflow =
          mergePendingScopedNodesWithLimit(
            observerPendingNotificationScopes,
            mutationFlags.addedNotificationScopes,
            OBSERVER_INCREMENTAL_NOTIFICATION_SCOPE_LIMIT,
            observerPendingNotificationScopesOverflow
          );
      }
      if (
        !observerPendingNavReinit &&
        !observerPendingThreadRefresh &&
        !observerPendingPostRefresh &&
        !observerRequireFullApply
      ) {
        return;
      }

      if (observerApplyTimer) {
        clearTimeout(observerApplyTimer);
      }

      observerApplyTimer = setTimeout(() => {
        observerApplyTimer = null;
        observerIsApplying = true;
        observer.disconnect();
        try {
          if (observerPendingNavReinit) {
            console.log("S1 Plus: 检测到导航栏被重置，正在重新应用自定义设置。");
            initializeNavbar();
          }
          if (observerRequireFullApply) {
            applyChanges();
          } else {
            applyIncrementalChanges();
          }
        } finally {
          observerPendingNavReinit = false;
          observerPendingThreadRefresh = false;
          observerPendingPostRefresh = false;
          observerRequireFullApply = false;
          observerPendingThreadRows.clear();
          observerPendingPostTables.clear();
          observerPendingThreadNeedsFullRefresh = false;
          observerPendingPostNeedsFullRefresh = false;
          observerPendingQuoteRefresh = false;
          observerPendingRatingsRefresh = false;
          observerPendingNotificationRefresh = false;
          observerPendingQuoteScopes.clear();
          observerPendingRatingsScopes.clear();
          observerPendingNotificationScopes.clear();
          observerPendingQuoteScopesOverflow = false;
          observerPendingRatingsScopesOverflow = false;
          observerPendingNotificationScopesOverflow = false;
          const watchTarget = resolveObserverWatchTarget();
          observer.observe(watchTarget, { childList: true, subtree: true });
          observerIsApplying = false;
        }
      }, DOM_OBSERVER_DEBOUNCE_MS);
    };

    observer = new MutationObserver(observerCallback);
    applyChanges();
    const watchTarget = resolveObserverWatchTarget();
    observer.observe(watchTarget, { childList: true, subtree: true });
  }

  function applyChanges() {
    const settings = getSettings();
    const shouldEnablePostBlocking = settings.enablePostBlocking === true;
    const shouldEnableUserBlocking = settings.enableUserBlocking === true;
    const shouldEnableReadProgress =
      settings.enableGeneralSettings === true &&
      settings.enableReadProgress === true;
    let hasRestoredManagedVisibility = false;
    const ensureManagedVisibilityRestored = () => {
      if (hasRestoredManagedVisibility) {
        return;
      }
      restoreManagedVisibilityAfterDataImport(settings);
      hasRestoredManagedVisibility = true;
    };

    manageFloatingControls(); // <-- [核心修改]

    if (shouldEnablePostBlocking) {
      hideBlockedThreads();
      hideThreadsByTitleKeyword();
      addBlockButtonsToThreads();
      applyUserThreadBlocklist();
      hideBlockedPosts();
    } else {
      ensureManagedVisibilityRestored();
      removeBlockButtonsFromThreads();
      document.querySelectorAll(".s1p-hidden-by-keyword").forEach((row) => {
        row.classList.remove("s1p-hidden-by-keyword");
      });
      dynamicallyHiddenThreads = {};
    }

    if (shouldEnableUserBlocking) {
      hideBlockedUsersPosts();
    } else {
      ensureManagedVisibilityRestored();
    }
    hideBlockedUserQuotes();
    hideBlockedUserRatings();
    hideBlockedUserNotifications(); // [新增] 调用提醒屏蔽函数
    hideSystemBlockedPosts();

    refreshAllAuthiActions();
    const profileHeaderBlockButtonApplied = addBlockButtonToUserProfileHeader();
    if (!profileHeaderBlockButtonApplied) {
      scheduleProfileHeaderBlockButtonRefresh(900);
    }
    // 将工具栏文字链接转换为图标
    renameAuthorLinks();
    if (settings.enableUserTagging) {
      initializeTaggingPopover();
    }
    if (shouldEnableReadProgress) {
      addProgressJumpButtons();
    } else {
      removeProgressJumpButtons();
      updateReadIndicatorUI(null);
    }

    applyInterfaceCustomizations();
    applyImageHiding();
    manageImageToggleAllButtons();
    applyImageSizeLimits();
    applyS1pImageViewerBehavior();
    applyNuxDarkTextContrastFix();
    applyPlainTextUrlAutolinks();
    applyGlobalLinkBehavior(); // <--- MODIFIED
    const nativeBlacklistImportButtonApplied = ensureNativeBlacklistImportButton();
    if (!nativeBlacklistImportButtonApplied && isNativeBlacklistPage()) {
      setTimeout(() => ensureNativeBlacklistImportButton(), 700);
    }
    ensureMyThreadsQuickLink();
    trackReadProgressInThread();
    markSettingsRuntimeAppliedSnapshot(settings);
    try {
      autoSign();
    } catch (e) {
      console.error("S1 Plus: Error caught while running autoSign():", e);
    }
  }

  if (!IS_S1P_TEST_MODE) {
    main();
  }
})();
