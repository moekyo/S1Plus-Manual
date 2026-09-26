"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "S1Plus.js");
const cssResourcePath = path.join(repoRoot, "S1Plus.css");
const staticDataPath = path.join(repoRoot, "S1Plus-static-data.json");
const sourceCode = fs.readFileSync(sourcePath, "utf8");
const cssSource = fs.readFileSync(cssResourcePath, "utf8");
const staticDataSource = fs.readFileSync(staticDataPath, "utf8");
const sourceCodeWithCss = `${sourceCode}\n${cssSource}`;

const noop = () => {};

const createClassListStub = () => ({
  add: noop,
  remove: noop,
  toggle: noop,
  contains: () => false,
});

const createStatefulClassListStub = (initialClasses = []) => {
  const classes = new Set(initialClasses);
  return {
    add: (...names) => names.forEach((name) => classes.add(String(name))),
    remove: (...names) => names.forEach((name) => classes.delete(String(name))),
    toggle: (name, force) => {
      const normalizedName = String(name);
      if (typeof force === "boolean") {
        if (force) classes.add(normalizedName);
        else classes.delete(normalizedName);
        return force;
      }
      if (classes.has(normalizedName)) {
        classes.delete(normalizedName);
        return false;
      }
      classes.add(normalizedName);
      return true;
    },
    contains: (name) => classes.has(String(name)),
    toArray: () => Array.from(classes),
  };
};

const createStyleStub = () => {
  const values = new Map();
  return {
    setProperty: (name, value) => {
      values.set(String(name), String(value));
    },
    removeProperty: (name) => {
      const key = String(name);
      const previous = values.get(key) || "";
      values.delete(key);
      return previous;
    },
    getPropertyValue: (name) => values.get(String(name)) || "",
    _values: values,
  };
};

const createElementStub = () => ({
  style: {},
  classList: createClassListStub(),
  appendChild: noop,
  removeChild: noop,
  remove: noop,
  setAttribute: noop,
  getAttribute: () => "",
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  closest: () => null,
  innerHTML: "",
  textContent: "",
  value: "",
});

const createSessionStorageStub = (initialEntries = []) => {
  const sessionStore = new Map(initialEntries);
  const sessionStorage = {
    getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key) : null),
    setItem: (key, value) => {
      sessionStore.set(key, String(value));
    },
    removeItem: (key) => {
      sessionStore.delete(key);
    },
  };

  return { sessionStore, sessionStorage };
};

const createLocationStub = ({
  href = "https://stage1st.com/2b/",
  search = "",
  origin = "https://stage1st.com",
  reload = noop,
} = {}) => ({
  href,
  search,
  origin,
  reload,
});

const createSandbox = ({
  href = "https://stage1st.com/2b/",
  search = "",
  visibilityState = "visible",
  includeSessionStorage = false,
  sessionStorageEntries = [],
  gmEntries = [],
  sharedStore = null,
  includeGmListValues = true,
  resourceTexts = {},
  addedStyles = null,
  themeRuntime = null,
} = {}) => {
  const store = sharedStore || new Map(gmEntries);
  const effectiveResourceTexts = {
    "s1p-static-data": staticDataSource,
    ...resourceTexts,
  };
  const { sessionStore, sessionStorage } =
    createSessionStorageStub(sessionStorageEntries);

  const themeRuntimeEnabled = Boolean(themeRuntime);
  const rootCssVariables = new Map(
    Object.entries(themeRuntime?.rootCssVariables || {})
  );
  const rootAttributes = new Map();
  const mediaListeners = new Set();
  const mutationObservers = new Set();
  let systemPrefersDark = themeRuntime?.systemPrefersDark === true;
  let nuxMarkerPresent = themeRuntime?.nuxMarkerPresent === true;

  class ThemeHTMLElement {
    constructor(tagName = "DIV") {
      this.tagName = String(tagName || "DIV").toUpperCase();
      this.nodeType = 1;
      this.parentElement = null;
      this.style = createStyleStub();
      this.classList = createStatefulClassListStub();
      this.attributes = new Map();
      this.isConnected = true;
      this.innerHTML = "";
      this.textContent = "";
      this.value = "";
    }
    setAttribute(name, value) {
      this.attributes.set(String(name), String(value));
    }
    getAttribute(name) {
      return this.attributes.get(String(name)) || "";
    }
    hasAttribute(name) {
      return this.attributes.has(String(name));
    }
    removeAttribute(name) {
      this.attributes.delete(String(name));
    }
    appendChild() {}
    removeChild() {}
    remove() {
      this.isConnected = false;
    }
    addEventListener() {}
    removeEventListener() {}
    matches(selector) {
      const normalized = String(selector || "");
      if (normalized.includes("archiver") && this.tagName === "A") {
        return true;
      }
      return false;
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    closest() {
      return null;
    }
  }

  const documentElement = themeRuntimeEnabled
    ? new ThemeHTMLElement("HTML")
    : {
        style: createStyleStub(),
        classList: createClassListStub(),
      };
  if (themeRuntimeEnabled) {
    documentElement.setAttribute = (name, value) => {
      rootAttributes.set(String(name), String(value));
    };
    documentElement.getAttribute = (name) =>
      rootAttributes.get(String(name)) || "";
    documentElement.hasAttribute = (name) =>
      rootAttributes.has(String(name));
    documentElement.removeAttribute = (name) => {
      rootAttributes.delete(String(name));
    };
  }

  const bodyElement = themeRuntimeEnabled
    ? new ThemeHTMLElement("BODY")
    : createElementStub();
  const markerElement = themeRuntimeEnabled
    ? new ThemeHTMLElement("A")
    : null;
  markerElement?.setAttribute("href", "archiver/");

  const settingsModal = themeRuntimeEnabled
    ? new ThemeHTMLElement("DIV")
    : null;
  const settingsModalContent = themeRuntimeEnabled
    ? new ThemeHTMLElement("DIV")
    : null;
  if (settingsModal && settingsModalContent) {
    settingsModal.classList.add("s1p-modal");
    settingsModal.isConnected =
      themeRuntime?.includeSettingsModal === true;
    settingsModalContent.classList.add("s1p-modal-content");
    settingsModalContent.isConnected = settingsModal.isConnected;
    settingsModal.querySelector = (selector) =>
      selector === ".s1p-modal-content" ? settingsModalContent : null;
  }

  const darkTextResidueNode = themeRuntimeEnabled
    ? new ThemeHTMLElement("SPAN")
    : null;
  const lightBgResidueNode = themeRuntimeEnabled
    ? new ThemeHTMLElement("SPAN")
    : null;

  const styleMutationNode = themeRuntimeEnabled
    ? new ThemeHTMLElement("STYLE")
    : null;
  const locationStub = createLocationStub({ href, search });

  const darkMediaQuery = themeRuntimeEnabled
    ? {
        get matches() {
          return systemPrefersDark;
        },
        addEventListener: (type, listener) => {
          if (type === "change" && typeof listener === "function") {
            mediaListeners.add(listener);
          }
        },
        removeEventListener: (type, listener) => {
          if (type === "change") mediaListeners.delete(listener);
        },
        addListener: (listener) => {
          if (typeof listener === "function") mediaListeners.add(listener);
        },
        removeListener: (listener) => {
          mediaListeners.delete(listener);
        },
      }
    : null;

  class ThemeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      mutationObservers.add(this);
    }
    observe() {
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
      mutationObservers.delete(this);
    }
    takeRecords() {
      return [];
    }
  }

  const sandbox = {
    __S1P_TEST_MODE__: true,
    __S1P_TEST_STORE__: store,
    console,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: (callback) =>
      setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: { now: () => Date.now() },
    navigator: { userAgent: "node" },
    location: locationStub,
    window: {
      location: { ...locationStub },
      CSS: { supports: () => false },
      addEventListener: noop,
      removeEventListener: noop,
      pageXOffset: 0,
      pageYOffset: 0,
      innerWidth: 1920,
      innerHeight: 1080,
    },
    document: {
      body: bodyElement,
      documentElement,
      title: "",
      visibilityState,
      addEventListener: noop,
      removeEventListener: noop,
      querySelector: (selector) => {
        if (!themeRuntimeEnabled) return null;
        if (String(selector).includes("archiver")) {
          return nuxMarkerPresent ? markerElement : null;
        }
        if (selector === ".s1p-modal") {
          return settingsModal?.isConnected ? settingsModal : null;
        }
        return null;
      },
      querySelectorAll: (selector) => {
        if (!themeRuntimeEnabled) return [];
        const normalized = String(selector || "");
        if (
          normalized.includes(".s1p-light-bg-content") ||
          normalized.includes("data-s1p-light-bg-removed")
        ) {
          return lightBgResidueNode &&
            (lightBgResidueNode.classList.contains("s1p-light-bg-content") ||
              lightBgResidueNode.hasAttribute("data-s1p-light-bg-removed"))
            ? [lightBgResidueNode]
            : [];
        }
        if (normalized === ".s1p-nux-dark-text-fixed") {
          return darkTextResidueNode?.classList.contains(
            "s1p-nux-dark-text-fixed"
          )
            ? [darkTextResidueNode]
            : [];
        }
        return [];
      },
      getElementById: () => null,
      createElement: themeRuntimeEnabled
        ? (tagName) => new ThemeHTMLElement(tagName)
        : createElementStub,
    },
    Node: {
      ELEMENT_NODE: 1,
      COMMENT_NODE: 8,
    },
    Element: themeRuntimeEnabled ? ThemeHTMLElement : function Element() {},
    HTMLElement: themeRuntimeEnabled
      ? ThemeHTMLElement
      : function HTMLElement() {},
    HTMLAnchorElement: themeRuntimeEnabled
      ? ThemeHTMLElement
      : function HTMLAnchorElement() {},
    HTMLInputElement: themeRuntimeEnabled
      ? ThemeHTMLElement
      : function HTMLInputElement() {},
    HTMLImageElement: themeRuntimeEnabled
      ? ThemeHTMLElement
      : function HTMLImageElement() {},
    MutationObserver: themeRuntimeEnabled
      ? ThemeMutationObserver
      : class MutationObserver {
          observe() {}
          disconnect() {}
          takeRecords() {
            return [];
          }
        },
    GM_getValue: (key, defaultValue) =>
      store.has(key) ? store.get(key) : defaultValue,
    GM_setValue: (key, value) => {
      store.set(key, value);
    },
    GM_getResourceText: (name) => effectiveResourceTexts[name] || "",
    GM_addStyle: (cssText) => {
      if (Array.isArray(addedStyles)) {
        addedStyles.push(String(cssText));
      }
    },
    GM_deleteValue: (key) => {
      store.delete(key);
    },
    GM_xmlhttpRequest: noop,
    GM_openInTab: noop,
    GM_download: noop,
    GM_addValueChangeListener: noop,
    GM_removeValueChangeListener: noop,
  };

  if (includeGmListValues) {
    sandbox.GM_listValues = () => Array.from(store.keys());
  }

  if (themeRuntimeEnabled) {
    sandbox.window.matchMedia = (query) =>
      String(query).includes("prefers-color-scheme")
        ? darkMediaQuery
        : {
            matches: false,
            addEventListener: noop,
            removeEventListener: noop,
            addListener: noop,
            removeListener: noop,
          };
    sandbox.window.getComputedStyle = (element, pseudo) => {
      if (element === documentElement) {
        return {
          getPropertyValue: (name) =>
            rootCssVariables.get(String(name)) || "",
          backgroundColor:
            rootCssVariables.get("--bg") || "rgba(0, 0, 0, 0)",
          color: rootCssVariables.get("--t") || "",
        };
      }
      if (element === markerElement && pseudo === "::before") {
        return {
          content: nuxMarkerPresent ? '"NUXISENABLED"' : "none",
          getPropertyValue: () => "",
        };
      }
      return {
        content: "none",
        getPropertyValue: () => "",
        backgroundColor: "rgba(0, 0, 0, 0)",
        color: "",
      };
    };
  }

  sandbox.window.document = sandbox.document;
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.setTimeout = sandbox.setTimeout;
  sandbox.window.clearTimeout = sandbox.clearTimeout;
  sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
  sandbox.window.cancelAnimationFrame = sandbox.cancelAnimationFrame;
  sandbox.window.performance = sandbox.performance;

  if (includeSessionStorage) {
    sandbox.window.sessionStorage = sessionStorage;
  }

  sandbox.globalThis = sandbox;
  sandbox.self = sandbox.window;
  sandbox.global = sandbox;
  sandbox.unsafeWindow = sandbox.window;

  const themeRuntimeControls = themeRuntimeEnabled
    ? {
        setSystemPrefersDark(value, { emit = true } = {}) {
          systemPrefersDark = value === true;
          if (emit) {
            const event = { matches: systemPrefersDark };
            Array.from(mediaListeners).forEach((listener) =>
              listener.call(darkMediaQuery, event)
            );
          }
        },
        setRootCssVariable(name, value) {
          rootCssVariables.set(String(name), String(value));
        },
        deleteRootCssVariable(name) {
          rootCssVariables.delete(String(name));
        },
        setNuxMarkerPresent(value) {
          nuxMarkerPresent = value === true;
        },
        triggerStyleMutation() {
          const records = [
            {
              type: "childList",
              target: documentElement,
              addedNodes: [styleMutationNode],
              removedNodes: [],
            },
          ];
          Array.from(mutationObservers).forEach((observer) => {
            if (observer.connected) observer.callback(records, observer);
          });
        },
        triggerMarkerMutation() {
          const records = [
            {
              type: "childList",
              target: documentElement,
              addedNodes: nuxMarkerPresent ? [markerElement] : [],
              removedNodes: nuxMarkerPresent ? [] : [markerElement],
            },
          ];
          Array.from(mutationObservers).forEach((observer) => {
            if (observer.connected) observer.callback(records, observer);
          });
        },
        triggerOrdinaryMutation() {
          const ordinaryNode = new ThemeHTMLElement("DIV");
          const records = [
            {
              type: "childList",
              target: bodyElement,
              addedNodes: [ordinaryNode],
              removedNodes: [],
            },
          ];
          Array.from(mutationObservers).forEach((observer) => {
            if (observer.connected) observer.callback(records, observer);
          });
        },
        seedNuxCompatibilityResidue() {
          darkTextResidueNode.classList.add("s1p-nux-dark-text-fixed");
          lightBgResidueNode.classList.add("s1p-light-bg-content");
          lightBgResidueNode.setAttribute(
            "data-s1p-light-bg-removed",
            "true"
          );
          lightBgResidueNode.setAttribute(
            "data-s1p-light-bg-original-style",
            ""
          );
          lightBgResidueNode.setAttribute(
            "data-s1p-light-bg-original-bgcolor",
            ""
          );
          lightBgResidueNode.setAttribute(
            "data-s1p-light-bg-original-color",
            "rgb(255, 255, 255)"
          );
        },
        getRootClasses: () => documentElement.classList.toArray(),
        getRootAttribute: (name) =>
          rootAttributes.get(String(name)) || "",
        getMediaListenerCount: () => mediaListeners.size,
        getMutationObserverCount: () => mutationObservers.size,
        settingsModal,
        settingsModalContent,
        darkTextResidueNode,
        lightBgResidueNode,
      }
    : null;

  return {
    sandbox,
    store,
    sessionStore,
    sessionStorage,
    themeRuntimeControls,
  };
};

const createHarness = ({
  hookErrorMessage = "未能从 S1Plus.js 暴露测试钩子。",
  ...sandboxOptions
} = {}) => {
  const runtime = createSandbox(sandboxOptions);
  vm.createContext(runtime.sandbox);
  vm.runInContext(sourceCode, runtime.sandbox, {
    filename: "S1Plus.js",
    timeout: 20000,
  });

  const hooks = runtime.sandbox.__S1P_TEST_HOOKS__;
  if (!hooks) {
    throw new Error(hookErrorMessage);
  }

  return {
    ...runtime,
    hooks,
    sourceCode,
  };
};

const toPlainObject = (value) => JSON.parse(JSON.stringify(value));

module.exports = {
  sourceCode,
  cssSource,
  staticDataSource,
  sourceCodeWithCss,
  createHarness,
  toPlainObject,
};
