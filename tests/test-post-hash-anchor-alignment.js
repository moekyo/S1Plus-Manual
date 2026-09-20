"use strict";

const assert = require("assert");
const {
  createHarness,
  sourceCodeWithCss: sourceCode,
} = require("./s1plus-test-helpers");

const { hooks } = createHarness({
  hookErrorMessage: "未能从 S1Plus.js 暴露帖子锚点对齐测试钩子。",
});

assert.deepStrictEqual(
  Array.from(hooks.getPostHashTargetCandidateIdsForTest("#pid69860915")),
  ["pid69860915", "post_69860915"],
  "findpost 的 #pid 锚点应优先定位到帖子 table，并保留 post_ 包裹兜底。"
);

assert.deepStrictEqual(
  Array.from(hooks.getPostHashTargetCandidateIdsForTest("#post_69860915")),
  ["pid69860915", "post_69860915"],
  "论坛 post_ 包裹锚点也应回落到对应帖子 table。"
);

const fixedNavDoc = {
  getElementById: () => ({
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 37,
      left: 0,
      right: 1200,
      width: 1200,
      height: 37,
    }),
  }),
};
const fixedNavWindow = {
  getComputedStyle: () => ({ position: "fixed" }),
};
assert.strictEqual(
  hooks.getPostAnchorScrollOffsetForTest(fixedNavDoc, fixedNavWindow),
  48,
  "37px 固定导航应至少保留默认 48px 帖子锚点偏移。"
);

const createTopBarStub = ({
  top = 0,
  bottom,
  left = 0,
  right = 1200,
  position = "fixed",
  display = "block",
  visibility = "visible",
}) => ({
  __styleForTest: { position, display, visibility },
  getBoundingClientRect: () => ({
    top,
    bottom,
    left,
    right,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }),
});

const navBar = createTopBarStub({ bottom: 37 });
const pageToolbar = createTopBarStub({ top: 37, bottom: 70 });
const narrowFloatingButton = createTopBarStub({ bottom: 120, right: 30 });
const staticHeader = createTopBarStub({
  bottom: 96,
  position: "static",
});
const stackedTopBarsDoc = {
  documentElement: { clientWidth: 1200 },
  getElementById: (id) => (id === "nv" ? navBar : null),
  querySelectorAll: () => [
    navBar,
    pageToolbar,
    narrowFloatingButton,
    staticHeader,
  ],
};
const stackedTopBarsWindow = {
  innerWidth: 1200,
  getComputedStyle: (element) => element.__styleForTest,
};
assert.strictEqual(
  hooks.getPostAnchorScrollOffsetForTest(
    stackedTopBarsDoc,
    stackedTopBarsWindow
  ),
  78,
  "多层顶部固定栏应取最底层 bottom 加安全间距，窄浮动按钮和静态内容不应参与偏移。"
);

const tallFixedNavDoc = {
  getElementById: () => ({
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 64,
      left: 0,
      right: 1200,
      width: 1200,
      height: 64,
    }),
  }),
};
assert.strictEqual(
  hooks.getPostAnchorScrollOffsetForTest(tallFixedNavDoc, fixedNavWindow),
  72,
  "更高的固定导航应按实际高度加安全间距计算帖子锚点偏移。"
);

assert.strictEqual(
  hooks.getPostHashAnchorScrollTopForTest({
    currentScrollY: 2947,
    targetTop: 0,
    offsetPx: 48,
  }),
  2899,
  "当浏览器把目标楼层对齐到视口顶部时，应向上修正一个固定导航偏移。"
);

assert.match(
  sourceCode,
  /scroll-margin-top:\s*var\(--s1p-post-anchor-scroll-margin-top,\s*48px\)/,
  "帖子锚点应声明 scroll-margin-top，让浏览器原生 fragment 跳转也避开固定导航。"
);

console.log("[post-hash-anchor-alignment] fixed-header post anchor alignment verified.");
