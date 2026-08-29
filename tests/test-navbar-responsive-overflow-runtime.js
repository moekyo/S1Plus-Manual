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
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    this._textContent = String(value ?? "");
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  insertBefore(child, referenceChild) {
    if (child.parentNode) child.parentNode.removeChild(child);
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
    this.focused = true;
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

const createEvent = (type, target) => ({
  type,
  target,
  key: type === "keydown" ? "Escape" : undefined,
  preventDefault() {
    this.defaultPrevented = true;
  },
  stopPropagation() {},
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
  assert.equal(
    visibleMenuLinkRecords(forum.document).length,
    0,
    "wide layout must keep the overflow menu items hidden"
  );
  hooks.teardownNavbarCustomOverflow();
  hooks.setupNavbarCustomOverflow({
    navUl: forum.navUl,
    navRoot: forum.navRoot,
    headerRoot: forum.headerRoot,
    customNavRecords: [
      { item: customItems[0], name: "B valid", href: "forum.php?fid=2" },
      { item: customItems[1], name: "C valid", href: "/forum-6-1.html" },
    ],
    managerLink: forum.navUl.children.find((item) => item.id === "s1p-nav-link"),
    searchBar: forum.searchBar,
  });
  forum.document.querySelector("#s1p-nav-overflow")._rectWidth = 30;
  forum.navUl.children.find((item) => item.id === "s1p-nav-link")._rectWidth = 55;
  forum.flushAnimationFrames();
  assert.ok(
    forum.document.querySelector("#s1p-nav-overflow"),
    "the responsive owner must consume canonical link records"
  );
  assert.equal(
    forum.document.querySelector("#s1p-nav-overflow").hidden,
    true,
    "wide layout must hide the More owner"
  );
  assert.deepStrictEqual(menuLinkRecords(forum.document), [
    { name: "B valid", href: "forum.php?fid=2" },
    { name: "C valid", href: "/forum-6-1.html" },
  ], "rejected A must not be present in the overflow owner");

  forum.layout.navWidth = 130;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  assert.equal(customItems[0].hidden, false, "B must remain in primary at medium width");
  assert.equal(customItems[1].hidden, true, "rightmost C must enter overflow first");
  assert.deepStrictEqual(visibleMenuLinkRecords(forum.document), [
    { name: "C valid", href: "/forum-6-1.html" },
  ]);

  forum.layout.navWidth = 80;
  forum.eventWindow.dispatchEvent(createEvent("resize", forum.eventWindow));
  forum.flushAnimationFrames();
  assert.equal(customItems.every((item) => item.hidden), true);
  assert.deepStrictEqual(visibleMenuLinkRecords(forum.document), [
    { name: "B valid", href: "forum.php?fid=2" },
    { name: "C valid", href: "/forum-6-1.html" },
  ], "overflow links must preserve canonical primary identity and href");

  const overflowOwner = forum.document.querySelector("#s1p-nav-overflow");
  const overflowToggle = overflowOwner.children[0];
  overflowToggle.dispatchEvent(createEvent("click", overflowToggle));
  forum.flushAnimationFrames();
  const overflowMenu = forum.document.querySelector(".s1p-nav-overflow-menu");
  assert.equal(overflowMenu.hidden, false, "More must open its single menu owner");
  forum.document.dispatchEvent(createEvent("click", forum.document.body));
  assert.equal(overflowMenu.hidden, true, "outside click must close More");

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
  searchToggle.dispatchEvent(createEvent("click", searchToggle));
  forum.flushAnimationFrames();
  assert.equal(searchPopover.hidden, false);
  assert.equal(forum.searchBar.querySelector("#scbar_txt"), forum.searchInput);
  assert.equal(forum.searchInput.focused, true, "opening search must retain and focus the original input");
  forum.document.dispatchEvent(createEvent("keydown", forum.document));
  assert.equal(searchPopover.hidden, true, "Escape must close the search popover");

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

  hooks.initializeNavbar();
  forum.flushAnimationFrames();
  assert.equal(forum.document.querySelectorAll("#s1p-nav-overflow").length, 1);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-search-toggle").length, 1);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-search-popover").length, 1);
  assert.equal(forum.document.querySelectorAll(".s1p-nav-overflow-menu").length, 1);
  assert.equal(FakeResizeObserver.activeCount(), 1, "re-initialize must retain one ResizeObserver owner");
  assert.equal(forum.eventWindow.listenerCount("resize"), 1);
  assert.equal(forum.document.listenerCount("click"), 1);
  assert.equal(forum.document.listenerCount("keydown"), 1);

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
  assert.equal(forum.document.querySelectorAll(".s1p-nav-overflow-menu").length, 0);
  assert.equal(forum.document.querySelectorAll("#s1p-nav-overflow").length, 0);

  console.log(
    "[navbar-responsive-overflow-runtime] canonical link ownership and DOM lifecycle verified."
  );
};

run();
