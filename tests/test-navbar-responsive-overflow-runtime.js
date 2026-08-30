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
    this.hidden = false;
    this.value = "";
    this.focused = false;
    this.scrollIntoViewCalls = [];
    this._textContent = "";
    this._href = "";
    this._rectWidth = this.tagName === "LI" ? 40 : 0;
    this._rectHeight = this.tagName === "DIV" ? 24 : 0;
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
  const navRoot = document.createElement("div");
  navRoot.id = "nv";
  const navUl = document.createElement("ul");
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
  hooks.initializeNavbar();
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

  console.log(
    "[navbar-responsive-overflow-runtime] canonical link ownership and DOM lifecycle verified."
  );
};

run();
