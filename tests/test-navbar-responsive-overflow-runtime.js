#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness } = require("./s1plus-test-helpers");

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (typeof listener !== "function") return;
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    const nextEvent = event || {};
    if (!nextEvent.target) nextEvent.target = this;
    for (const listener of this.listeners.get(nextEvent.type) || []) {
      listener(nextEvent);
    }
    return !nextEvent.defaultPrevented;
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this.tokens.add(String(token)));
  }

  remove(...tokens) {
    tokens.forEach((token) => this.tokens.delete(String(token)));
  }

  contains(token) {
    return this.tokens.has(String(token));
  }

  toggle(token, force) {
    const normalized = String(token);
    const shouldAdd =
      typeof force === "boolean" ? force : !this.tokens.has(normalized);
    if (shouldAdd) this.tokens.add(normalized);
    else this.tokens.delete(normalized);
    return shouldAdd;
  }

  toString() {
    return Array.from(this.tokens).join(" ");
  }
}

const splitSelectorList = (selector) =>
  String(selector)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const matchesSimpleSelector = (node, selector) => {
  let remaining = String(selector).trim();
  if (!remaining || remaining === "*") return true;

  const attributeMatches = remaining.match(/\[([^\]]+)\]/g) || [];
  for (const attributeMatch of attributeMatches) {
    const expression = attributeMatch.slice(1, -1).trim();
    const prefixMatch = expression.match(/^([^\^=]+)\^=\s*["']([^"']*)["']$/);
    const equalsMatch = expression.match(/^([^=]+)=\s*["']([^"']*)["']$/);
    const attributeName = (prefixMatch || equalsMatch)?.[1]?.trim() || expression;
    const attributeValue = node.getAttribute(attributeName);
    if (attributeValue === null) return false;
    if (prefixMatch && !attributeValue.startsWith(prefixMatch[2])) return false;
    if (equalsMatch && attributeValue !== equalsMatch[2]) return false;
    remaining = remaining.replace(attributeMatch, "");
  }

  const idMatch = remaining.match(/#([\w-]+)/);
  if (idMatch && node.id !== idMatch[1]) return false;
  remaining = remaining.replace(/#[\w-]+/g, "");

  const classMatches = remaining.match(/\.([\w-]+)/g) || [];
  if (classMatches.some((className) => !node.classList.contains(className.slice(1)))) {
    return false;
  }
  remaining = remaining.replace(/\.[\w-]+/g, "").trim();

  if (remaining && remaining !== node.tagName.toLowerCase()) return false;
  return true;
};

const matchesSelector = (node, selector) => {
  const normalizedSelector = String(selector).trim();
  if (!normalizedSelector) return false;

  if (normalizedSelector.includes(">")) {
    const parts = normalizedSelector.split(/\s*>\s*/).map((part) => part.trim());
    let current = node;
    const lastPart = parts[parts.length - 1];
    if (!matchesSimpleSelector(current, lastPart)) return false;
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      current = current.parentNode;
      if (!current || !matchesSimpleSelector(current, parts[index])) return false;
    }
    return true;
  }

  const parts = normalizedSelector.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return matchesSimpleSelector(node, parts[0]);
  if (!matchesSimpleSelector(node, parts[parts.length - 1])) return false;

  let current = node.parentNode;
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    while (current && !matchesSimpleSelector(current, parts[index])) {
      current = current.parentNode;
    }
    if (!current) return false;
    current = current.parentNode;
  }
  return true;
};

class FakeElement extends FakeEventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.value = "";
    this.focused = false;
    this.scrollIntoViewCalls = [];
    this._textContent = "";
    this._href = "";
    this._rectWidth = this.tagName === "LI" ? 40 : this.tagName === "A" ? 46 : 0;
    this._rectHeight = ["DIV", "LI", "A", "UL"].includes(this.tagName) ? 24 : 0;
  }

  get id() {
    return this.getAttribute("id") || "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get className() {
    return this.classList.toString();
  }

  set className(value) {
    this.classList = new FakeClassList();
    String(value || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((token) => this.classList.add(token));
  }

  get href() {
    return this._href;
  }

  set href(value) {
    this._href = String(value ?? "");
    this.setAttribute("href", this._href);
  }

  get parentElement() {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current === this.ownerDocument?.body) return true;
      current = current.parentNode;
    }
    return false;
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    const activeElement = this.ownerDocument?.activeElement;
    if (activeElement && this.contains(activeElement)) {
      activeElement.focused = false;
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    this._textContent = String(value ?? "");
  }

  appendChild(child) {
    if (child.parentNode) {
      const currentIndex = child.parentNode.children.indexOf(child);
      if (currentIndex !== -1) {
        child.parentNode.children.splice(currentIndex, 1);
      }
      child.parentNode = null;
    }
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  insertBefore(child, referenceChild) {
    if (child.parentNode) {
      const currentIndex = child.parentNode.children.indexOf(child);
      if (currentIndex !== -1) {
        child.parentNode.children.splice(currentIndex, 1);
      }
      child.parentNode = null;
    }
    const referenceIndex = this.children.indexOf(referenceChild);
    if (referenceIndex === -1) return this.appendChild(child);
    this.children.splice(referenceIndex, 0, child);
    child.parentNode = this;
    return child;
  }

  replaceChild(nextChild, currentChild) {
    const currentIndex = this.children.indexOf(currentChild);
    if (currentIndex === -1) throw new Error("replaceChild target missing");
    if (nextChild.parentNode) nextChild.parentNode.removeChild(nextChild);
    this.children[currentIndex] = nextChild;
    nextChild.parentNode = this;
    currentChild.parentNode = null;
    return currentChild;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      const activeElement = this.ownerDocument?.activeElement;
      if (activeElement && child.contains(activeElement)) {
        activeElement.focused = false;
        this.ownerDocument.activeElement = this.ownerDocument.body;
      }
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    const normalizedName = String(name);
    return this.attributes.has(normalizedName)
      ? this.attributes.get(normalizedName)
      : null;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  focus() {
    const currentActiveElement = this.ownerDocument?.activeElement;
    if (currentActiveElement instanceof FakeElement && currentActiveElement !== this) {
      currentActiveElement.focused = false;
    }
    this.focused = true;
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  blur() {
    this.focused = false;
    if (this.ownerDocument?.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }

  scrollIntoView(options) {
    this.scrollIntoViewCalls.push(options);
  }

  getBoundingClientRect() {
    const width = Number(this._rectWidth) || 0;
    const height = Number(this._rectHeight) || 0;
    return {
      left: 20,
      top: 20,
      right: 20 + width,
      bottom: 20 + height,
      width,
      height,
    };
  }

  cloneNode(deep = false) {
    const clone = new this.constructor(this.tagName.toLowerCase(), this.ownerDocument);
    clone.className = this.className;
    clone.hidden = this.hidden;
    clone._rectWidth = this._rectWidth;
    clone._rectHeight = this._rectHeight;
    this.attributes.forEach((value, key) => clone.setAttribute(key, value));
    clone._textContent = this._textContent;
    clone._href = this._href;
    if (deep) this.children.forEach((child) => clone.appendChild(child.cloneNode(true)));
    return clone;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (splitSelectorList(selector).some((part) => matchesSelector(current, part))) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = splitSelectorList(selector);
    if (selectors.some((part) => part.startsWith(":scope > "))) {
      return this.children.filter((child) =>
        selectors.some((part) => {
          const simpleSelector = part.replace(/^:scope\s*>\s*/, "");
          return matchesSimpleSelector(child, simpleSelector);
        })
      );
    }

    const matches = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (selectors.some((part) => matchesSelector(child, part))) {
          matches.push(child);
        }
        visit(child);
      });
    };
    visit(this);
    return matches;
  }
}

class FakeHTMLUListElement extends FakeElement {}
class FakeHTMLLIElement extends FakeElement {}
class FakeHTMLAnchorElement extends FakeElement {}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.body = new FakeElement("body", this);
    this.documentElement = new FakeElement("html", this);
    this.activeElement = this.body;
    this.title = "";
    this.visibilityState = "visible";
  }

  createElement(tagName) {
    const normalizedTagName = String(tagName).toLowerCase();
    if (normalizedTagName === "ul") {
      return new FakeHTMLUListElement(normalizedTagName, this);
    }
    if (normalizedTagName === "li") {
      return new FakeHTMLLIElement(normalizedTagName, this);
    }
    if (normalizedTagName === "a") {
      return new FakeHTMLAnchorElement(normalizedTagName, this);
    }
    return new FakeElement(normalizedTagName, this);
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
}

class FakeResizeObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    this.observed = [];
    FakeResizeObserver.instances.push(this);
  }

  observe(target) {
    this.observed.push(target);
  }

  disconnect() {
    this.disconnected = true;
    this.observed = [];
  }

  static activeCount() {
    return FakeResizeObserver.instances.filter((observer) => !observer.disconnected).length;
  }
}

const createEvent = (type, target, fields = {}) => ({
  type,
  target,
  key: fields.key,
  shiftKey: Boolean(fields.shiftKey),
  ...fields,
  preventDefault() {
    this.defaultPrevented = true;
  },
  stopPropagation() {
    this.propagationStopped = true;
  },
});

const installForumDom = (runtime) => {
  const document = new FakeDocument();
  const layout = { navWidth: 400, searchWidth: 300 };
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    get: () => layout.navWidth,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: 900,
  });

  const header = document.createElement("div");
  header.id = "hd";
  const headerRoot = document.createElement("div");
  headerRoot.className = "wp";
  // The header row is the flex container: its content width is the sum of the
  // nav row and the fixed siblings that are not part of the nav row.
  Object.defineProperty(headerRoot, "_rectWidth", {
    configurable: true,
    get: () => layout.navWidth + layout.searchWidth,
  });
  const navRoot = document.createElement("div");
  navRoot.id = "nv";
  const navUl = document.createElement("ul");
  Object.defineProperty(navUl, "_rectWidth", {
    configurable: true,
    get: () => layout.navWidth,
  });
  Object.defineProperty(navUl, "clientWidth", {
    configurable: true,
    get: () => layout.navWidth,
  });
  Object.defineProperty(navUl, "scrollWidth", {
    configurable: true,
    get: () =>
      navUl.children
        .filter((child) => !child.hidden)
        .reduce((total, child) => total + (Number(child._rectWidth) || 0), 0),
  });
  navRoot.appendChild(navUl);

  const searchParent = document.createElement("div");
  searchParent.className = "hdc";
  Object.defineProperty(searchParent, "_rectWidth", {
    configurable: true,
    get: () => layout.searchWidth,
  });
  const searchBar = document.createElement("div");
  searchBar.id = "scbar";
  searchBar._rectWidth = layout.searchWidth;
  searchBar._rectHeight = 24;
  const searchInput = document.createElement("input");
  searchInput.id = "scbar_txt";
  searchInput.value = "query survives";
  searchBar.appendChild(searchInput);
  searchParent.appendChild(searchBar);

  headerRoot.appendChild(navRoot);
  headerRoot.appendChild(searchParent);
  header.appendChild(headerRoot);
  document.body.appendChild(header);

  const eventWindow = runtime.sandbox.window;
  eventWindow.document = document;
  eventWindow.innerWidth = layout.navWidth;
  eventWindow.innerHeight = 900;
  eventWindow.pageXOffset = 0;
  eventWindow.pageYOffset = 0;

  runtime.sandbox.document = document;
  runtime.sandbox.Element = FakeElement;
  runtime.sandbox.HTMLUListElement = FakeHTMLUListElement;
  runtime.sandbox.HTMLLIElement = FakeHTMLLIElement;
  runtime.sandbox.HTMLAnchorElement = FakeHTMLAnchorElement;
  runtime.sandbox.ResizeObserver = FakeResizeObserver;
  // 与浏览器一致：允许 fixture 为元素提供 computed style（默认空对象，
  // 未声明的 margin / padding / border / position 一律按 0 / static 处理）。
  document.defaultView = {
    getComputedStyle: (element) => (element && element._computed) || {},
  };

  let nextAnimationFrameId = 1;
  const animationFrames = new Map();
  const requestAnimationFrame = (callback) => {
    const id = nextAnimationFrameId++;
    animationFrames.set(id, callback);
    return id;
  };
  const cancelAnimationFrame = (id) => animationFrames.delete(id);
  const flushAnimationFrames = () => {
    let guard = 0;
    while (animationFrames.size > 0) {
      if (guard++ > 100) throw new Error("animation frame loop did not converge");
      const pendingFrames = Array.from(animationFrames.entries());
      animationFrames.clear();
      pendingFrames.forEach(([, callback]) => callback(Date.now()));
    }
  };
  const pendingAnimationFrameCount = () => animationFrames.size;
  runtime.sandbox.requestAnimationFrame = requestAnimationFrame;
  runtime.sandbox.cancelAnimationFrame = cancelAnimationFrame;
  eventWindow.requestAnimationFrame = requestAnimationFrame;
  eventWindow.cancelAnimationFrame = cancelAnimationFrame;

  const windowEvents = new FakeEventTarget();
  eventWindow.addEventListener = windowEvents.addEventListener.bind(windowEvents);
  eventWindow.removeEventListener = windowEvents.removeEventListener.bind(windowEvents);
  eventWindow.dispatchEvent = windowEvents.dispatchEvent.bind(windowEvents);
  eventWindow.listenerCount = windowEvents.listenerCount.bind(windowEvents);

  return {
    document,
    eventWindow,
    layout,
    navRoot,
    headerRoot,
    navUl,
    searchParent,
    searchBar,
    searchInput,
    flushAnimationFrames,
    pendingAnimationFrameCount,
  };
};

/**
 * 把基础 fixture 扩展成真实的顶栏结构：
 *
 *   header(.wp)
 *    ├ .hdc       (logo)
 *    ├ #nv        (qmenu + ul)        ← 可选包一层 #nv_ph
 *    ├ .hdc       (搜索区)
 *    └ #um        (用户区)
 *
 * geometry 同时决定每个固定区域的宽度与 header 的容器宽度，因此测试可以
 * 独立算出“导航行应得的预算”，再与 production measurement 对照。
 */
const installRealisticHeaderRegions = (forum, geometry, options = {}) => {
  const { document, headerRoot, navRoot, navUl, searchParent } = forum;
  const nested = options.nested === true;
  const wrapperPadding = nested ? Number(options.wrapperPadding) || 0 : 0;

  const logo = document.createElement("div");
  logo.className = "hdc cl";
  Object.defineProperty(logo, "_rectWidth", {
    configurable: true,
    get: () => geometry.logo,
  });
  const userArea = document.createElement("div");
  userArea.id = "um";
  Object.defineProperty(userArea, "_rectWidth", {
    configurable: true,
    get: () => geometry.user,
  });
  const quickMenu = document.createElement("a");
  quickMenu.id = "qmenu";
  Object.defineProperty(quickMenu, "_rectWidth", {
    configurable: true,
    get: () => geometry.quickMenu,
  });

  let wrapper = null;
  if (nested) {
    wrapper = document.createElement("div");
    wrapper.id = "nv_ph";
    wrapper._computed = {
      display: "flex",
      paddingLeft: `${wrapperPadding}px`,
      paddingRight: `${wrapperPadding}px`,
    };
    Object.defineProperty(wrapper, "_rectWidth", {
      configurable: true,
      get: () =>
        geometry.quickMenu + geometry.navRow + wrapperPadding * 2,
    });
    headerRoot.insertBefore(wrapper, navRoot);
    wrapper.appendChild(navRoot);
  }

  headerRoot.insertBefore(logo, nested ? wrapper : navRoot);
  headerRoot.appendChild(userArea);
  navRoot.insertBefore(quickMenu, navUl);

  const gapCount = 3;
  Object.defineProperty(headerRoot, "_rectWidth", {
    configurable: true,
    get: () =>
      geometry.logo +
      geometry.quickMenu +
      geometry.navRow +
      geometry.search +
      geometry.user +
      (Number(geometry.gap) || 0) * gapCount +
      wrapperPadding * 2,
  });

  return { logo, userArea, quickMenu, wrapper };
};

const getOverflowMenuLinks = (document) =>
  document.querySelector(".s1p-nav-overflow-menu")?.children || [];
const menuLinkRecords = (document) =>
  Array.from(getOverflowMenuLinks(document)).map((link) => ({
    name: link.textContent,
    href: link.getAttribute("href"),
  }));

const visibleMenuLinkRecords = (document) =>
  Array.from(getOverflowMenuLinks(document))
    .filter((link) => !link.hidden)
    .map((link) => ({ name: link.textContent, href: link.getAttribute("href") }));

const primaryLinkRecords = (navUl) =>
  navUl.children
    .filter((item) => item.classList.contains("s1p-nav-custom-item"))
    .map((item) => {
      const link = item.querySelector(":scope > a");
      return {
        item,
        name: link?.textContent,
        href: link?.getAttribute("href"),
      };
    });

const getOverflowControls = (document) => {
  const owner = document.querySelector("#s1p-nav-overflow");
  return {
    owner,
    toggle: owner?.querySelector(":scope > a"),
    menu: document.querySelector("#s1p-nav-overflow-menu"),
  };
};

const dispatchKey = (target, key, fields = {}) => {
  target.dispatchEvent(createEvent("keydown", target, { key, ...fields }));
};

const setSettings = (runtime, hooks, settings) => {
  runtime.store.set("s1p_settings", settings);
  hooks.invalidateSettingsCache();
};

const createSettings = (customNavLinks, enableNavCustomization = true) => ({
  enableNavCustomization,
  customNavLinks,
  syncRemoteEnabled: false,
});

const run = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  const unsafeLink = { name: "A rejected", href: "javascript:alert(1)" };
  const validLinkB = { name: "B valid", href: "forum.php?fid=2" };
  const validLinkC = { name: "C valid", href: "/forum-6-1.html" };

  setSettings(
    runtime,
    hooks,
    createSettings([unsafeLink, validLinkB, validLinkC])
  );
  forum.layout.navWidth = 80;
  hooks.initializeNavbar();

  const firstPaintCustomItems = forum.navUl.children.filter((item) =>
    item.classList.contains("s1p-nav-custom-item")
  );
  const firstPaintOverflowOwner = forum.document.querySelector(
    "#s1p-nav-overflow"
  );
  assert.equal(
    firstPaintOverflowOwner.hidden,
    false,
    "initial navbar layout must publish overflow ownership before the first paint"
  );
  assert.equal(
    firstPaintCustomItems.every((item) => item.hidden),
    true,
    "initial navbar layout must not leave all custom links widening the search gap"
  );
  forum.layout.navWidth = 400;
  forum.flushAnimationFrames();

  let customItems = forum.navUl.children.filter((item) =>
    item.classList.contains("s1p-nav-custom-item")
  );
  assert.deepStrictEqual(
    customItems.map((item) => item.textContent),
    ["B valid", "C valid"],
    "rejected links must never enter the primary navbar"
  );
  assert.deepStrictEqual(
    primaryLinkRecords(forum.navUl).map(({ name, href }) => ({ name, href })),
    [
      { name: "B valid", href: "forum.php?fid=2" },
      { name: "C valid", href: "/forum-6-1.html" },
    ],
    "production initializeNavbar must retain only canonical safe primary records"
  );
  assert.equal(
    visibleMenuLinkRecords(forum.document).length,
    0,
    "wide layout must keep the overflow menu items hidden"
  );
  assert.deepStrictEqual(menuLinkRecords(forum.document), [
    { name: "B valid", href: "forum.php?fid=2" },
    { name: "C valid", href: "/forum-6-1.html" },
  ], "the production overflow owner must contain only canonical safe records");
  assert.equal(
    forum.document.querySelectorAll("#s1p-nav-overflow").length,
    1,
    "initializeNavbar must create one responsive overflow owner"
  );

  const initialPrimaryRecords = primaryLinkRecords(forum.navUl);
  const initialOverflowRecords = Array.from(getOverflowMenuLinks(forum.document)).map(
    (link) => ({ name: link.textContent, href: link.getAttribute("href") })
  );
  assert.deepStrictEqual(
    initialOverflowRecords,
    initialPrimaryRecords.map(({ name, href }) => ({ name, href })),
    "primary and overflow records must preserve one-to-one identity"
  );
  Array.from(getOverflowMenuLinks(forum.document)).forEach((menuLink, index) => {
    assert.equal(menuLink.getAttribute("role"), "menuitem");
    assert.equal(menuLink.getAttribute("tabindex"), "-1");
    assert.equal(
      menuLink.getAttribute("href"),
      initialPrimaryRecords[index].href,
      "overflow href must reuse the matching canonical primary href"
    );
  });

  forum.navUl.children.find((item) => item.id === "s1p-nav-link")._rectWidth = 20;
  forum.document.querySelector("#s1p-nav-overflow")._rectWidth = 20;
  forum.layout.navWidth = 80;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  assert.equal(customItems[0].hidden, false, "B must remain in primary at medium width");
  assert.equal(customItems[1].hidden, true, "rightmost C must enter overflow first");
  assert.deepStrictEqual(visibleMenuLinkRecords(forum.document), [
    { name: "C valid", href: "/forum-6-1.html" },
  ]);

  forum.layout.navWidth = 40;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  assert.equal(customItems.every((item) => item.hidden), true);
  assert.deepStrictEqual(visibleMenuLinkRecords(forum.document), [
    { name: "B valid", href: "forum.php?fid=2" },
    { name: "C valid", href: "/forum-6-1.html" },
  ], "overflow links must preserve canonical primary identity and href");

  const { owner: overflowOwner, toggle: overflowToggle, menu: overflowMenu } =
    getOverflowControls(forum.document);
  assert.equal(overflowOwner.id, "s1p-nav-overflow");
  assert.equal(overflowToggle.id, "s1p-nav-overflow-toggle");
  assert.equal(overflowMenu.id, "s1p-nav-overflow-menu");
  assert.equal(overflowToggle.getAttribute("role"), "button");
  assert.equal(overflowToggle.getAttribute("aria-haspopup"), "menu");
  assert.equal(overflowToggle.getAttribute("aria-controls"), overflowMenu.id);
  assert.equal(
    overflowMenu.getAttribute("aria-labelledby"),
    overflowToggle.id,
    "overflow menu must be named by its controlling trigger"
  );

  const openMenuWithKey = (key) => {
    overflowToggle.focus();
    dispatchKey(overflowToggle, key);
    forum.flushAnimationFrames();
    assert.equal(overflowMenu.hidden, false, `${key} must open the More menu`);
  };
  const visibleMenuLinks = () =>
    Array.from(getOverflowMenuLinks(forum.document)).filter((link) => !link.hidden);
  const dispatchMenuKey = (key, fields = {}) => {
    const event = createEvent("keydown", overflowMenu, { key, ...fields });
    overflowMenu.dispatchEvent(event);
    forum.flushAnimationFrames();
    return event;
  };

  openMenuWithKey("Enter");
  assert.equal(forum.document.activeElement, visibleMenuLinks()[0]);
  assert.equal(overflowToggle.getAttribute("aria-expanded"), "true");
  assert.ok(visibleMenuLinks()[0].scrollIntoViewCalls.length > 0);
  dispatchMenuKey("Escape");
  assert.equal(overflowMenu.hidden, true);
  assert.equal(overflowToggle.getAttribute("aria-expanded"), "false");
  assert.equal(forum.document.activeElement, overflowToggle);

  openMenuWithKey(" ");
  assert.equal(forum.document.activeElement, visibleMenuLinks()[0]);
  dispatchMenuKey("Escape");
  openMenuWithKey("ArrowDown");
  assert.equal(forum.document.activeElement, visibleMenuLinks()[0]);
  dispatchMenuKey("Escape");
  openMenuWithKey("ArrowUp");
  assert.equal(
    forum.document.activeElement,
    visibleMenuLinks()[visibleMenuLinks().length - 1]
  );

  dispatchMenuKey("ArrowDown");
  assert.equal(forum.document.activeElement, visibleMenuLinks()[0]);
  dispatchMenuKey("ArrowDown");
  assert.equal(forum.document.activeElement, visibleMenuLinks()[1]);
  dispatchMenuKey("ArrowDown");
  assert.equal(forum.document.activeElement, visibleMenuLinks()[0]);
  dispatchMenuKey("ArrowUp");
  assert.equal(forum.document.activeElement, visibleMenuLinks()[1]);
  dispatchMenuKey("Home");
  assert.equal(forum.document.activeElement, visibleMenuLinks()[0]);
  dispatchMenuKey("End");
  assert.equal(
    forum.document.activeElement,
    visibleMenuLinks()[visibleMenuLinks().length - 1]
  );
  dispatchMenuKey("Escape");
  assert.equal(forum.document.activeElement, overflowToggle);

  overflowToggle.focus();
  overflowToggle.dispatchEvent(createEvent("click", overflowToggle));
  forum.flushAnimationFrames();
  assert.equal(overflowMenu.hidden, false);
  assert.equal(
    forum.document.activeElement,
    overflowToggle,
    "pointer opening must keep focus on the More trigger"
  );
  overflowToggle.dispatchEvent(createEvent("click", overflowToggle));
  assert.equal(overflowMenu.hidden, true);

  openMenuWithKey("Enter");
  const forwardTabEvent = dispatchMenuKey("Tab");
  assert.equal(overflowMenu.hidden, true);
  assert.equal(
    Boolean(forwardTabEvent.defaultPrevented),
    false,
    "Tab traversal must remain owned by the browser"
  );
  assert.notEqual(forum.document.activeElement, overflowToggle);
  openMenuWithKey("Enter");
  const backwardTabEvent = dispatchMenuKey("Tab", { shiftKey: true });
  assert.equal(overflowMenu.hidden, true);
  assert.equal(
    Boolean(backwardTabEvent.defaultPrevented),
    false,
    "Shift+Tab traversal must remain owned by the browser"
  );
  assert.notEqual(forum.document.activeElement, overflowToggle);

  openMenuWithKey("Enter");
  const outsideControl = forum.document.createElement("button");
  forum.document.body.appendChild(outsideControl);
  outsideControl.focus();
  forum.document.dispatchEvent(createEvent("click", outsideControl));
  assert.equal(overflowMenu.hidden, true, "outside click must close More");
  assert.equal(
    forum.document.activeElement,
    outsideControl,
    "outside pointer close must not steal the new control focus"
  );

  openMenuWithKey("Enter");
  const focusedMenuLinkBeforeReconcile = forum.document.activeElement;
  forum.layout.navWidth = 400;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  assert.equal(overflowMenu.hidden, true);
  assert.equal(overflowOwner.hidden, true);
  assert.notEqual(
    forum.document.activeElement,
    focusedMenuLinkBeforeReconcile,
    "responsive reconcile must not leave focus on a hidden menuitem"
  );
  assert.equal(
    focusedMenuLinkBeforeReconcile.hidden,
    true,
    "reconciled menuitem should be hidden with its overflow owner"
  );

  forum.layout.searchWidth = 100;
  forum.searchBar._rectWidth = forum.layout.searchWidth;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  const searchToggle = forum.searchParent.querySelector("#s1p-nav-search-toggle");
  const searchPopover = forum.document.querySelector("#s1p-nav-search-popover");
  assert.equal(forum.searchBar.parentNode, searchPopover, "compact mode must move the original search node");
  assert.equal(forum.searchBar.querySelector("#scbar_txt"), forum.searchInput);
  assert.equal(forum.searchInput.value, "query survives");
  assert.equal(searchToggle.hidden, false);
  searchToggle.focus();
  dispatchKey(searchToggle, "Enter");
  forum.flushAnimationFrames();
  assert.equal(searchPopover.hidden, false);
  assert.equal(forum.searchBar.querySelector("#scbar_txt"), forum.searchInput);
  assert.equal(forum.searchInput.focused, true, "opening search must retain and focus the original input");
  assert.equal(forum.document.activeElement, forum.searchInput);
  forum.document.dispatchEvent(
    createEvent("keydown", forum.document, { key: "Escape" })
  );
  assert.equal(searchPopover.hidden, true, "Escape must close the search popover");
  assert.equal(forum.document.activeElement, searchToggle);

  forum.layout.navWidth = 40;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  assert.equal(overflowOwner.hidden, false);

  overflowToggle.focus();
  overflowToggle.dispatchEvent(createEvent("click", overflowToggle));
  forum.flushAnimationFrames();
  assert.equal(overflowMenu.hidden, false);
  searchToggle.focus();
  searchToggle.dispatchEvent(createEvent("click", searchToggle));
  forum.flushAnimationFrames();
  assert.equal(searchPopover.hidden, false);
  assert.equal(searchToggle.getAttribute("aria-expanded"), "true");
  assert.equal(overflowMenu.hidden, true, "opening Search must close More");
  assert.equal(overflowToggle.getAttribute("aria-expanded"), "false");

  overflowToggle.focus();
  overflowToggle.dispatchEvent(createEvent("click", overflowToggle));
  forum.flushAnimationFrames();
  assert.equal(overflowMenu.hidden, false);
  assert.equal(overflowToggle.getAttribute("aria-expanded"), "true");
  assert.equal(searchPopover.hidden, true, "opening More must close Search");
  assert.equal(searchToggle.getAttribute("aria-expanded"), "false");
  overflowToggle.dispatchEvent(createEvent("click", overflowToggle));
  assert.equal(overflowMenu.hidden, true);

  dispatchKey(searchToggle, " ");
  forum.flushAnimationFrames();
  assert.equal(forum.document.activeElement, forum.searchInput);
  outsideControl.focus();
  forum.document.dispatchEvent(createEvent("click", outsideControl));
  assert.equal(searchPopover.hidden, true);
  assert.equal(
    forum.document.activeElement,
    outsideControl,
    "search outside pointer close must not steal the new control focus"
  );

  forum.layout.navWidth = 400;
  forum.layout.searchWidth = 300;
  forum.searchBar._rectWidth = forum.layout.searchWidth;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  assert.equal(forum.searchBar.parentNode, forum.searchParent, "wide mode must restore the original search parent");
  assert.equal(searchToggle.hidden, true);
  assert.equal(
    customItems.every(
      (item) => !item.hidden && item.getAttribute("aria-hidden") === null
    ),
    true,
    "wide reconciliation must restore primary custom item visibility and aria state"
  );

  const focusedPrimaryBeforeReinitialize = customItems[0].querySelector(":scope > a");
  focusedPrimaryBeforeReinitialize.focus();
  hooks.initializeNavbar();
  forum.flushAnimationFrames();
  customItems = forum.navUl.children.filter((item) =>
    item.classList.contains("s1p-nav-custom-item")
  );
  assert.equal(focusedPrimaryBeforeReinitialize.isConnected, false);
  assert.notEqual(
    forum.document.activeElement,
    focusedPrimaryBeforeReinitialize,
    "re-initialize must not leave focus on a deleted primary link"
  );
  assert.equal(forum.document.querySelectorAll("#s1p-nav-overflow").length, 1);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-search-toggle").length, 1);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-search-popover").length, 1);
  assert.equal(forum.document.querySelectorAll(".s1p-nav-overflow-menu").length, 1);
  assert.equal(FakeResizeObserver.activeCount(), 1, "re-initialize must retain one ResizeObserver owner");
  assert.equal(forum.eventWindow.listenerCount("resize"), 1);
  assert.equal(forum.document.listenerCount("click"), 1);
  assert.equal(forum.document.listenerCount("keydown"), 1);

  forum.layout.navWidth = 40;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  const repeatedOwner = getOverflowControls(forum.document);
  repeatedOwner.toggle.focus();
  dispatchKey(repeatedOwner.toggle, "Enter");
  assert.ok(
    forum.pendingAnimationFrameCount() > 0,
    "opening More must register a cancellable focus frame"
  );
  const focusedOldMenuLink = Array.from(getOverflowMenuLinks(forum.document)).find(
    (link) => !link.hidden
  );
  assert.equal(focusedOldMenuLink.getAttribute("role"), "menuitem");
  hooks.teardownNavbarCustomOverflow();
  assert.equal(
    forum.pendingAnimationFrameCount(),
    0,
    "teardown must cancel pending menu focus callbacks"
  );
  forum.flushAnimationFrames();
  assert.equal(focusedOldMenuLink.isConnected, false);
  assert.notEqual(
    forum.document.activeElement,
    focusedOldMenuLink,
    "teardown must not leave focus on a deleted menuitem"
  );
  assert.equal(forum.document.querySelectorAll("#s1p-nav-overflow").length, 0);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-search-toggle").length, 0);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-search-popover").length, 0);
  assert.equal(FakeResizeObserver.activeCount(), 0);
  assert.equal(forum.eventWindow.listenerCount("resize"), 0);
  assert.equal(forum.document.listenerCount("click"), 0);
  assert.equal(forum.document.listenerCount("keydown"), 0);
  assert.equal(forum.searchBar.parentNode, forum.searchParent);
  assert.equal(
    customItems.every(
      (item) => !item.hidden && item.getAttribute("aria-hidden") === null
    ),
    true,
    "teardown must restore custom primary item visibility"
  );

  forum.searchBar._rectWidth = 100;
  hooks.initializeNavbar();
  forum.flushAnimationFrames();
  const pendingSearchToggle = forum.document.querySelector("#s1p-nav-search-toggle");
  pendingSearchToggle.focus();
  dispatchKey(pendingSearchToggle, "Enter");
  assert.ok(
    forum.pendingAnimationFrameCount() > 0,
    "opening search must register a cancellable focus frame"
  );
  hooks.teardownNavbarCustomOverflow();
  assert.equal(
    forum.pendingAnimationFrameCount(),
    0,
    "teardown must cancel pending search focus callbacks"
  );
  forum.flushAnimationFrames();
  assert.equal(forum.searchBar.parentNode, forum.searchParent);

  setSettings(runtime, hooks, createSettings([unsafeLink, validLinkB, validLinkC], false));
  hooks.initializeNavbar();
  forum.flushAnimationFrames();
  assert.equal(forum.document.querySelectorAll(".s1p-nav-overflow-menu").length, 0);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-search-toggle").length, 0);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-search-popover").length, 0);
  assert.equal(forum.document.querySelectorAll(".s1p-nav-search-placeholder").length, 0);
  assert.equal(FakeResizeObserver.activeCount(), 0, "disabled customization must teardown responsive ownership");
  assert.equal(forum.eventWindow.listenerCount("resize"), 0);
  assert.equal(forum.document.listenerCount("click"), 0);
  assert.equal(forum.document.listenerCount("keydown"), 0);
  assert.equal(forum.searchBar.parentNode, forum.searchParent);

  setSettings(runtime, hooks, createSettings([unsafeLink, validLinkB, validLinkC]));
  hooks.initializeNavbar();
  forum.flushAnimationFrames();
  customItems = forum.navUl.children.filter((item) =>
    item.classList.contains("s1p-nav-custom-item")
  );
  assert.deepStrictEqual(customItems.map((item) => item.textContent), ["B valid", "C valid"]);
  assert.equal(FakeResizeObserver.activeCount(), 1);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-overflow").length, 1);

  setSettings(runtime, hooks, createSettings([unsafeLink]));
  hooks.initializeNavbar();
  forum.flushAnimationFrames();
  assert.equal(
    forum.navUl.children.some((item) => item.classList.contains("s1p-nav-custom-item")),
    false,
    "all rejected links must leave no primary custom item"
  );
  assert.equal(
    forum.navUl.children.some((item) => item.id === "s1p-nav-link"),
    true,
    "all rejected links must retain the normal manager owner"
  );
  assert.equal(forum.document.querySelectorAll(".s1p-nav-overflow-menu").length, 0);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-overflow").length, 0);

  runStabilityScenarios();
  runUnmeasuredFallbackScenario();
  runSearchCompactReleaseScenario();
  runFontsLifecycleScenario();
  runRealGeometryFixtureScenario();
  runNestedGeometryFixtureScenario();
  runNonFlexContainerFallbackScenario();
  runMeasurementIsolationScenario();
  runSchedulerNotificationScenario();
  runUserAreaMutationScenario();

  console.log(
    "[navbar-responsive-overflow-runtime] canonical link ownership, DOM lifecycle, layout-authority stability and measurement contract verified."
  );
};

const REPORTED_ITEM_WIDTHS = [45, 45, 45, 45, 63.63, 59];
const REPORTED_MANAGER_WIDTH = 99.73;
const REPORTED_OVERFLOW_TOGGLE_WIDTH = 46;

/**
 * 真实顶栏结构下的 measurement 契约：
 * 容器宽度 − 固定区域宽度 = 分区预算；真实渲染宽度是预算的上界；
 * measurement 与 computeS1pNavbarLayoutProjection() 必须给出同一结果。
 */
const runRealGeometryFixtureScenario = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  const geometry = {
    logo: 96,
    quickMenu: 95.99,
    navRow: 401.36,
    search: 334.47,
    user: 153.78,
    // 主题若引入未建模的 gap，分区预算会偏高，必须由真实渲染宽度钳制。
    gap: 12,
  };
  installRealisticHeaderRegions(forum, geometry);
  forum.headerRoot._computed = { display: "flex" };
  forum.layout.searchWidth = geometry.search;
  forum.searchBar._rectWidth = geometry.search;
  forum.layout.navWidth = geometry.navRow;

  setSettings(
    runtime,
    hooks,
    createSettings(
      REPORTED_ITEM_WIDTHS.map((_, index) => ({
        name: `L${index}`,
        href: `forum-${index + 100}-1.html`,
      }))
    )
  );
  hooks.initializeNavbar();
  forum.flushAnimationFrames();

  const customItems = () =>
    forum.navUl.children.filter((item) =>
      item.classList.contains("s1p-nav-custom-item")
    );
  const applyReportedWidths = () => {
    customItems().forEach((item, index) => {
      item._rectWidth = REPORTED_ITEM_WIDTHS[index];
    });
    forum.document.querySelector("#s1p-nav-link")._rectWidth = REPORTED_MANAGER_WIDTH;
    forum.document.querySelector("#s1p-nav-overflow")._rectWidth =
      REPORTED_OVERFLOW_TOGGLE_WIDTH;
  };
  const reconcileNow = () => {
    forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
    forum.flushAnimationFrames();
  };

  applyReportedWidths();
  reconcileNow();

  const snapshot = hooks.getNavbarLayoutSnapshot();
  assert.ok(snapshot, "测量必须发布诊断契约快照");
  const expectedContainer =
    geometry.logo +
    geometry.quickMenu +
    geometry.navRow +
    geometry.search +
    geometry.user +
    geometry.gap * 3;
  assert.equal(
    snapshot.containerWidth,
    expectedContainer,
    "契约中的容器宽度必须是 header 行的真实内容宽度"
  );
  assert.equal(
    snapshot.renderedNavbarWidth,
    geometry.navRow,
    "契约必须暴露导航行真实渲染宽度"
  );
  assert.equal(
    snapshot.availableWidth,
    geometry.navRow,
    "存在未建模 gap 时，可用宽度必须以真实渲染宽度为准"
  );
  assert.ok(
    snapshot.containerWidth - snapshot.fixedRegionWidth >
      snapshot.availableWidth,
    "分区预算与真实宽度的差异必须在契约里可见，而不是被静默吞掉"
  );
  assert.deepStrictEqual(
    Array.from(snapshot.itemWidths),
    REPORTED_ITEM_WIDTHS,
    "需求宽度必须在测量态下读到 intrinsic 宽度"
  );

  // measurement 与纯函数决策必须完全一致。
  const expected = hooks.computeNavbarLayoutProjection(snapshot);
  assert.equal(
    customItems().filter((item) => item.hidden).length,
    REPORTED_ITEM_WIDTHS.length - expected.primaryCount,
    "DOM 投影必须与 computeS1pNavbarLayoutProjection(measurement) 一致"
  );
  assert.equal(
    forum.document.querySelector("#s1p-nav-overflow").hidden,
    !expected.showOverflow
  );
  assert.equal(expected.showOverflow, false, "现场数据不得把链接推进“更多”");

  // 真实空间不足时必须进入“更多”，且数量与纯函数一致。
  geometry.navRow = 300;
  forum.layout.navWidth = geometry.navRow;
  reconcileNow();
  const narrowSnapshot = hooks.getNavbarLayoutSnapshot();
  const narrowExpected = hooks.computeNavbarLayoutProjection(narrowSnapshot);
  assert.ok(narrowExpected.showOverflow, "真实空间不足时必须进入“更多”");
  assert.equal(
    customItems().filter((item) => item.hidden).length,
    REPORTED_ITEM_WIDTHS.length - narrowExpected.primaryCount
  );
  assert.ok(
    narrowSnapshot.availableWidth <= 300 + 1e-9,
    "可用宽度必须跟随真实渲染宽度收紧"
  );

  hooks.teardownNavbarCustomOverflow();
  assert.equal(FakeResizeObserver.activeCount(), 0);
};

/**
 * 导航被包在中间层（例如固定顶栏的 #nv_ph）时：
 * 祖先内边距必须被扣除，且 additivity 与真实渲染宽度精确一致（无需钳制）。
 */
const runNestedGeometryFixtureScenario = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  const wrapperPadding = 6;
  const geometry = {
    logo: 96,
    quickMenu: 95.99,
    navRow: 512.4,
    search: 334.47,
    user: 153.78,
    gap: 0,
  };
  installRealisticHeaderRegions(forum, geometry, {
    nested: true,
    wrapperPadding,
  });
  forum.headerRoot._computed = { display: "flex" };
  forum.layout.searchWidth = geometry.search;
  forum.searchBar._rectWidth = geometry.search;
  forum.layout.navWidth = geometry.navRow;

  setSettings(
    runtime,
    hooks,
    createSettings([
      { name: "A", href: "forum-100-1.html" },
      { name: "B", href: "forum-101-1.html" },
    ])
  );
  hooks.initializeNavbar();
  forum.flushAnimationFrames();

  const customItems = () =>
    forum.navUl.children.filter((item) =>
      item.classList.contains("s1p-nav-custom-item")
    );
  customItems().forEach((item) => {
    item._rectWidth = 45;
  });
  forum.document.querySelector("#s1p-nav-link")._rectWidth = 99.73;
  forum.document.querySelector("#s1p-nav-overflow")._rectWidth = 46;

  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();

  const snapshot = hooks.getNavbarLayoutSnapshot();
  assert.equal(
    snapshot.availableWidth,
    geometry.navRow,
    "嵌套包裹层的场景下可用宽度必须等于真实渲染宽度"
  );
  assert.ok(
    Math.abs(
      snapshot.containerWidth - snapshot.fixedRegionWidth - geometry.navRow
    ) < 1e-6,
    "祖先内边距必须被显式扣除，而不是靠钳制掩盖"
  );
  assert.equal(snapshot.renderedNavbarWidth, geometry.navRow);
  const expected = hooks.computeNavbarLayoutProjection(snapshot);
  assert.equal(
    customItems().filter((item) => item.hidden).length,
    2 - expected.primaryCount
  );

  hooks.teardownNavbarCustomOverflow();
};

/**
 * header 行不是 flex / grid 容器时，兄弟盒子不共享同一行内预算：
 * 必须退回真实渲染宽度，而不是硬套分区模型。
 */
const runNonFlexContainerFallbackScenario = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  const geometry = {
    logo: 96,
    quickMenu: 95.99,
    navRow: 401.36,
    search: 334.47,
    user: 153.78,
    gap: 12,
  };
  installRealisticHeaderRegions(forum, geometry);
  forum.headerRoot._computed = { display: "block" };
  forum.layout.searchWidth = geometry.search;
  forum.searchBar._rectWidth = geometry.search;
  forum.layout.navWidth = geometry.navRow;

  setSettings(
    runtime,
    hooks,
    createSettings([{ name: "A", href: "forum-100-1.html" }])
  );
  hooks.initializeNavbar();
  forum.flushAnimationFrames();
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();

  const snapshot = hooks.getNavbarLayoutSnapshot();
  assert.equal(
    snapshot.partitionApplies,
    false,
    "非 flex 容器必须标记分区模型不适用"
  );
  assert.equal(
    snapshot.availableWidth,
    geometry.navRow,
    "非 flex 容器必须退回真实渲染宽度"
  );

  hooks.teardownNavbarCustomOverflow();
};

/**
 * 测量态必须真正隔离 intrinsic 宽度：即使导航项在当前 flex 分配下被压缩，
 * 读到的也必须是自身内容宽度，而不是上一轮的分配结果。
 */
const runMeasurementIsolationScenario = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  setSettings(
    runtime,
    hooks,
    createSettings([
      { name: "A", href: "forum-100-1.html" },
      { name: "B", href: "forum-101-1.html" },
      { name: "C", href: "forum-102-1.html" },
    ])
  );
  forum.layout.navWidth = 100;
  forum.layout.searchWidth = 300;
  forum.searchBar._rectWidth = 300;
  hooks.initializeNavbar();
  forum.flushAnimationFrames();

  const customItems = () =>
    forum.navUl.children.filter((item) =>
      item.classList.contains("s1p-nav-custom-item")
    );
  const intrinsicWidths = [60, 60, 60];
  // 模拟 flex 压缩：不在测量态时导航项只能拿到被压缩后的宽度。
  customItems().forEach((item, index) => {
    Object.defineProperty(item, "_rectWidth", {
      configurable: true,
      get: () => {
        const isMeasuring = forum.navRoot.classList.contains(
          "s1p-nav-measuring"
        );
        return isMeasuring ? intrinsicWidths[index] : intrinsicWidths[index] / 2;
      },
    });
  });
  forum.document.querySelector("#s1p-nav-link")._rectWidth = 0;
  forum.document.querySelector("#s1p-nav-overflow")._rectWidth = 0;

  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();

  const snapshot = hooks.getNavbarLayoutSnapshot();
  assert.deepStrictEqual(
    Array.from(snapshot.itemWidths),
    intrinsicWidths,
    "测量必须读到 intrinsic 宽度，而不是被 flex 压缩后的分配宽度"
  );
  assert.equal(snapshot.renderedNavbarWidth, 100);
  assert.equal(snapshot.availableWidth, 100);
  assert.equal(
    customItems().filter((item) => item.hidden).length,
    2,
    "按 intrinsic 需求判断时只有第一个链接放得下"
  );
  assert.equal(
    forum.document.querySelector("#s1p-nav-overflow").hidden,
    false
  );

  hooks.teardownNavbarCustomOverflow();
};

/**
 * 布局调度必须只有一个对外入口：就地改动导航 DOM 的代码通过它请求重算。
 */
const runSchedulerNotificationScenario = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  setSettings(
    runtime,
    hooks,
    createSettings([{ name: "A", href: "forum-100-1.html" }])
  );
  forum.layout.navWidth = 600;
  hooks.initializeNavbar();
  forum.flushAnimationFrames();

  assert.ok(
    hooks.getNavbarLayoutSnapshot(),
    "setup 之后必须存在可验证的测量契约快照"
  );
  assert.equal(forum.pendingAnimationFrameCount(), 0);

  hooks.requestNavbarLayoutReconcile();
  assert.equal(
    forum.pendingAnimationFrameCount(),
    1,
    "通知入口必须汇聚到同一个调度器"
  );
  forum.flushAnimationFrames();

  hooks.requestNavbarLayoutReconcile();
  hooks.requestNavbarLayoutReconcile();
  assert.equal(
    forum.pendingAnimationFrameCount(),
    1,
    "同一帧内的多次通知必须合并成一次重算"
  );
  forum.flushAnimationFrames();

  hooks.teardownNavbarCustomOverflow();
  assert.equal(
    hooks.getNavbarLayoutSnapshot(),
    null,
    "teardown 必须清理诊断契约快照"
  );
  hooks.requestNavbarLayoutReconcile();
  assert.equal(
    forum.pendingAnimationFrameCount(),
    0,
    "teardown 之后通知入口不得再调度布局"
  );
  assert.equal(FakeResizeObserver.activeCount(), 0);
};

/**
 * #um（用户区）是导航行测量里的固定保留区域：
 * 它的内容变化必须请求重新测量，但重复调用且 DOM 未变时不得反复重算。
 */
const runUserAreaMutationScenario = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  const geometry = {
    logo: 96,
    quickMenu: 95.99,
    navRow: 401.36,
    search: 334.47,
    user: 153.78,
    gap: 0,
  };
  installRealisticHeaderRegions(forum, geometry);
  forum.headerRoot._computed = { display: "flex" };
  forum.layout.searchWidth = geometry.search;
  forum.searchBar._rectWidth = geometry.search;
  forum.layout.navWidth = geometry.navRow;

  const userArea = forum.document.querySelector("#um");
  const loginMarker = forum.document.createElement("strong");
  loginMarker.className = "vwmy";
  const markerLink = forum.document.createElement("a");
  markerLink.href = "home.php?mod=space&uid=1";
  loginMarker.appendChild(markerLink);
  userArea.appendChild(loginMarker);

  setSettings(
    runtime,
    hooks,
    createSettings([{ name: "A", href: "forum-100-1.html" }])
  );
  hooks.initializeNavbar();
  forum.flushAnimationFrames();
  assert.equal(forum.pendingAnimationFrameCount(), 0);

  hooks.ensureMyThreadsQuickLink();
  assert.ok(
    forum.document.querySelector("#s1p-my-threads-link"),
    "登录态下必须插入「帖子」快捷入口"
  );
  assert.equal(
    forum.pendingAnimationFrameCount(),
    1,
    "改动 #um（固定保留区域）必须请求重新测量"
  );
  forum.flushAnimationFrames();

  hooks.ensureMyThreadsQuickLink();
  assert.equal(
    forum.pendingAnimationFrameCount(),
    0,
    "重复调用且 DOM 未变化时不得反复请求重算"
  );

  hooks.teardownNavbarCustomOverflow();
  assert.equal(FakeResizeObserver.activeCount(), 0);
};

/**
 * 稳定性场景：同一组布局输入必须得到同一份投影。
 * 覆盖 report 中的现场数据（dpr 1.875 / zoom 150% / viewport 985）、
 * resize、DevTools 打开关闭、字体延迟、亚像素临界值。
 */
const runStabilityScenarios = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  const links = ["论坛", "归墟", "游戏", "影视", "PC数码", "黑名单"].map(
    (name, index) => ({ name, href: `forum-${index + 100}-1.html` })
  );
  // 报告现场的 CSS 像素宽度。
  const intrinsicWidths = [45, 45, 45, 45, 63.63, 59];
  const managerWidth = 99.73;
  const overflowWidth = 46;

  setSettings(runtime, hooks, createSettings(links));
  forum.layout.navWidth = 401.36;
  forum.layout.searchWidth = 334.47;
  forum.searchBar._rectWidth = forum.layout.searchWidth;
  hooks.initializeNavbar();
  forum.flushAnimationFrames();

  const customItems = () =>
    forum.navUl.children.filter((item) =>
      item.classList.contains("s1p-nav-custom-item")
    );
  const setIntrinsicWidths = (scale = 1) => {
    customItems().forEach((item, index) => {
      item._rectWidth = intrinsicWidths[index] * scale;
    });
    const manager = forum.document.querySelector("#s1p-nav-link");
    if (manager) manager._rectWidth = managerWidth;
    const overflow = forum.document.querySelector("#s1p-nav-overflow");
    if (overflow) overflow._rectWidth = overflowWidth;
  };
  const snapshot = () => ({
    hidden: customItems().map((item) => item.hidden),
    overflowHidden: Boolean(
      forum.document.querySelector("#s1p-nav-overflow")?.hidden
    ),
  });
  const resizeTo = (navWidth) => {
    forum.layout.navWidth = navWidth;
    forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
    forum.flushAnimationFrames();
  };

  setIntrinsicWidths(1);

  // 记录测量态 class 的进出，确认测量态真的被使用而不是事后恰好缺失。
  const measuringClass = "s1p-nav-measuring";
  const classMutations = [];
  const navClassList = forum.navRoot.classList;
  const originalAdd = navClassList.add.bind(navClassList);
  const originalRemove = navClassList.remove.bind(navClassList);
  navClassList.add = (...tokens) => {
    tokens.forEach((token) => classMutations.push(`+${token}`));
    return originalAdd(...tokens);
  };
  navClassList.remove = (...tokens) => {
    tokens.forEach((token) => classMutations.push(`-${token}`));
    return originalRemove(...tokens);
  };

  // 1) 现场数据：1px 级别的布局量化缺口不得把链接推进“更多”。
  resizeTo(401.36);
  assert.ok(
    classMutations.includes(`+${measuringClass}`),
    "需求宽度测量必须进入测量态"
  );
  assert.ok(
    classMutations.includes(`-${measuringClass}`),
    "测量结束后必须退出测量态"
  );
  assert.equal(
    forum.navRoot.classList.contains(measuringClass),
    false,
    "测量态不得泄漏到 reconcile 之后"
  );
  const reported = snapshot();
  assert.deepStrictEqual(
    reported.hidden,
    [false, false, false, false, false, false],
    "现场数据下所有链接必须留在 primary"
  );
  assert.equal(reported.overflowHidden, true);

  // 2) 幂等：同一布局重复 reconcile 结果完全一致。
  resizeTo(401.36);
  resizeTo(401.36);
  assert.deepStrictEqual(snapshot(), reported, "重复 reconcile 必须幂等");

  // 3) DevTools 打开 / 关闭：可用宽度变化再恢复，结果必须回到原投影。
  resizeTo(320);
  assert.ok(
    snapshot().hidden.some((hidden) => hidden),
    "可用宽度变窄后必须有链接进入“更多”"
  );
  resizeTo(401.36);
  assert.deepStrictEqual(
    snapshot(),
    reported,
    "可用宽度恢复后必须回到与最初一致的投影（DevTools 往返无滞后）"
  );

  // 4) 字体延迟加载：宽度变化触发重新决策，字体恢复后回到原投影。
  setIntrinsicWidths(1.12);
  resizeTo(401.36);
  assert.ok(
    snapshot().hidden.some((hidden) => hidden),
    "字体回退导致宽度明显变大时必须重新决策"
  );
  setIntrinsicWidths(1);
  resizeTo(401.36);
  assert.deepStrictEqual(
    snapshot(),
    reported,
    "字体加载完成后必须回到与初始一致的投影"
  );

  // 5) 亚像素临界：2px 以内由布局量化容差吸收，超出才进入“更多”。
  resizeTo(400.36);
  assert.deepStrictEqual(
    snapshot().hidden,
    [false, false, false, false, false, false],
    "2px 量化缺口必须被容差吸收"
  );
  resizeTo(399);
  const shortSnapshot = snapshot();
  assert.equal(
    shortSnapshot.hidden.filter((hidden) => hidden).length,
    1,
    "超过量化容差时只收进最少必要链接"
  );
  assert.equal(shortSnapshot.hidden[shortSnapshot.hidden.length - 1], true);
  assert.equal(shortSnapshot.overflowHidden, false);

  // 6) 真正空间不足：进入“更多”，并且投影稳定。
  resizeTo(200);
  const narrow = snapshot();
  assert.ok(narrow.hidden.some((hidden) => hidden));
  resizeTo(200);
  assert.deepStrictEqual(snapshot(), narrow, "窄屏下的投影同样必须幂等");

  hooks.teardownNavbarCustomOverflow();
  assert.equal(FakeResizeObserver.activeCount(), 0);
};

/**
 * 布局未稳定（首帧 / 无几何信息）时必须给出保守投影，
 * 稳定后必须回到与常规测量完全一致的最终投影。
 */
const runUnmeasuredFallbackScenario = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  setSettings(
    runtime,
    hooks,
    createSettings([
      { name: "A", href: "forum-100-1.html" },
      { name: "B", href: "forum-101-1.html" },
    ])
  );
  forum.layout.navWidth = 600;
  forum.layout.searchWidth = 300;
  forum.searchBar._rectWidth = 300;
  hooks.initializeNavbar();
  forum.flushAnimationFrames();

  const customItems = () =>
    forum.navUl.children.filter((item) =>
      item.classList.contains("s1p-nav-custom-item")
    );
  const overflowOwner = () =>
    forum.document.querySelector("#s1p-nav-overflow");
  const searchToggle = () =>
    forum.document.querySelector("#s1p-nav-search-toggle");
  const assertMeasuredStateClean = (label) =>
    assert.equal(
      forum.navRoot.classList.contains("s1p-nav-measuring"),
      false,
      `${label}: reconcile 结束后不得残留测量态 class`
    );

  assert.deepStrictEqual(
    customItems().map((item) => item.hidden),
    [false, false],
    "正常布局下链接应留在 primary"
  );
  assert.equal(overflowOwner().hidden, true);
  assertMeasuredStateClean("measured");

  // 首帧 / 未附加：容器与导航行都没有可用几何信息。
  forum.headerRoot._rectHeight = 0;
  forum.navUl._rectHeight = 0;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  assert.deepStrictEqual(
    customItems().map((item) => item.hidden),
    [true, true],
    "布局未稳定时不得让未展开的链接把搜索栏挤出可视区域"
  );
  assert.equal(
    overflowOwner().hidden,
    false,
    "布局未稳定时必须给出保守的“更多”入口"
  );
  assert.equal(
    searchToggle().classList.contains("s1p-nav-search-toggle-visible"),
    false,
    "布局未稳定时不得据此折叠搜索栏"
  );
  assert.equal(
    forum.searchBar.parentNode,
    forum.searchParent,
    "布局未稳定时搜索栏必须留在原位"
  );
  assertMeasuredStateClean("unmeasured");

  // 几何恢复后必须回到确定性结果，而不是停留在保守态。
  forum.headerRoot._rectHeight = 24;
  forum.navUl._rectHeight = 24;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  assert.deepStrictEqual(
    customItems().map((item) => item.hidden),
    [false, false],
    "布局稳定后必须回到最终投影"
  );
  assert.equal(overflowOwner().hidden, true);
  assertMeasuredStateClean("recovered");

  hooks.teardownNavbarCustomOverflow();
};

/**
 * 搜索折叠释放的宽度必须计入同一预算：否则会把本可放下的链接错误收进“更多”。
 */
const runSearchCompactReleaseScenario = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  setSettings(
    runtime,
    hooks,
    createSettings([
      { name: "A", href: "forum-100-1.html" },
      { name: "B", href: "forum-101-1.html" },
    ])
  );
  forum.layout.navWidth = 40;
  forum.layout.searchWidth = 100;
  forum.searchBar._rectWidth = 100;
  hooks.initializeNavbar();
  forum.flushAnimationFrames();

  const customItems = () =>
    forum.navUl.children.filter((item) =>
      item.classList.contains("s1p-nav-custom-item")
    );
  customItems().forEach((item) => {
    item._rectWidth = 40;
  });
  forum.document.querySelector("#s1p-nav-link")._rectWidth = 20;
  forum.document.querySelector("#s1p-nav-overflow")._rectWidth = 20;

  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();

  assert.equal(
    forum.document.querySelector("#s1p-nav-search-toggle").hidden,
    false,
    "搜索栏低于下限时必须收缩为文字入口"
  );
  const hidden = customItems().map((item) => item.hidden);
  assert.equal(
    hidden.filter(Boolean).length,
    1,
    "折叠搜索释放的宽度必须计入预算，只收进最少必要链接"
  );
  assert.deepStrictEqual(hidden, [false, true]);

  hooks.teardownNavbarCustomOverflow();
};

/**
 * 字体加载必须接入同一个调度入口，并且在 teardown 时注销。
 */
const runFontsLifecycleScenario = () => {
  const runtime = createHarness();
  const { hooks } = runtime;
  const forum = installForumDom(runtime);
  const fonts = new FakeEventTarget();
  let fontsReadyInvocations = 0;
  fonts.ready = {
    then: (onFulfilled, onRejected) => {
      fontsReadyInvocations += 1;
      (onFulfilled || onRejected)();
    },
  };
  forum.document.fonts = fonts;

  setSettings(
    runtime,
    hooks,
    createSettings([{ name: "A", href: "forum-100-1.html" }])
  );
  forum.layout.navWidth = 600;
  hooks.initializeNavbar();
  forum.flushAnimationFrames();

  assert.equal(
    fontsReadyInvocations,
    1,
    "document.fonts.ready 必须接入同一个布局调度入口"
  );
  assert.equal(
    fonts.listenerCount("loadingdone"),
    1,
    "字体加载完成必须注册重新测量监听"
  );
  assert.equal(forum.navRoot.classList.contains("s1p-nav-measuring"), false);

  fonts.dispatchEvent(createEvent("loadingdone", fonts));
  assert.ok(
    forum.pendingAnimationFrameCount() > 0,
    "字体加载完成必须调度重新测量，而不是依赖固定等待"
  );
  forum.flushAnimationFrames();

  hooks.teardownNavbarCustomOverflow();
  assert.equal(
    fonts.listenerCount("loadingdone"),
    0,
    "teardown 必须注销字体监听"
  );
  fonts.dispatchEvent(createEvent("loadingdone", fonts));
  assert.equal(
    forum.pendingAnimationFrameCount(),
    0,
    "teardown 之后字体事件不得再调度布局"
  );
  assert.equal(FakeResizeObserver.activeCount(), 0);
};


run();
