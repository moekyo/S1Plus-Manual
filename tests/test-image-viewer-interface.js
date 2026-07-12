#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness,
  sourceCode,
  toPlainObject,
} = require("./s1plus-test-helpers");

const { hooks } = createHarness({
  hookErrorMessage: "未能从 S1Plus.js 暴露图片查看器 interface。",
});

assert.equal(
  typeof hooks.s1pCreateImageViewerInterface,
  "function",
  "测试模式应暴露与生产单例相同的图片查看器 interface 构造入口。"
);
assert.deepEqual(
  toPlainObject(hooks.imageViewer.readState()),
  { phase: "closed" },
  "生产图片查看器单例应通过同一 interface 暴露初始关闭状态。"
);
assert.equal(
  Object.isFrozen(hooks.imageViewer),
  true,
  "生产图片查看器 interface 本身应保持不可变。"
);

const internalState = { isOpen: false, isClosing: false };
const calls = [];
const imageViewer = hooks.s1pCreateImageViewerInterface({
  readInternalState: () => internalState,
  applyDefaultTransform: () => calls.push("refresh-default-transform"),
  close: () => {},
  finalizeClose: () => true,
});

const closedSnapshot = imageViewer.readState();
assert.deepEqual(
  toPlainObject(closedSnapshot),
  { phase: "closed" },
  "关闭状态应投影为单一 closed phase，而不是泄漏内部布尔字段。"
);
assert.equal(
  Object.isFrozen(closedSnapshot),
  true,
  "状态投影应是不可变快照。"
);
assert.equal(
  imageViewer.refreshDefaultTransform(),
  false,
  "查看器关闭时不应执行默认变换。"
);
assert.deepEqual(calls, [], "关闭状态下不应穿透 seam 调用内部动作。");

internalState.isOpen = true;
assert.equal(
  closedSnapshot.phase,
  "closed",
  "旧投影不应随内部可变状态变化。"
);
assert.deepEqual(
  toPlainObject(imageViewer.readState()),
  { phase: "open" },
  "新投影应反映当前打开状态。"
);
assert.equal(
  imageViewer.refreshDefaultTransform(),
  true,
  "查看器打开时应执行默认变换。"
);
assert.deepEqual(
  calls,
  ["refresh-default-transform"],
  "默认变换应只执行一次。"
);

internalState.isOpen = false;
internalState.isClosing = true;
assert.deepEqual(
  toPlainObject(imageViewer.readState()),
  { phase: "closing" },
  "关闭动画期间应投影为 closing phase。"
);
assert.equal(
  imageViewer.refreshDefaultTransform(),
  false,
  "关闭动画期间不应重算默认变换。"
);

const closeState = { isOpen: false, isClosing: false };
const closeCalls = [];
const closableImageViewer = hooks.s1pCreateImageViewerInterface({
  readInternalState: () => closeState,
  applyDefaultTransform: () => {},
  close: () => {
    closeCalls.push("close");
    closeState.isOpen = false;
    closeState.isClosing = true;
  },
  finalizeClose: () => {
    closeCalls.push("finalize");
    closeState.isClosing = false;
    return true;
  },
});

assert.equal(
  closableImageViewer.closeImmediately(),
  false,
  "已关闭的查看器不应重复执行关闭动作。"
);
assert.deepEqual(closeCalls, [], "关闭状态不应调用内部关闭动作。");

closeState.isOpen = true;
assert.equal(
  closableImageViewer.closeImmediately(),
  true,
  "打开状态应同步完成关闭收束。"
);
assert.deepEqual(
  closeCalls,
  ["close", "finalize"],
  "立即关闭应先进入现有关闭流程，再收束关闭状态。"
);
assert.equal(
  closableImageViewer.readState().phase,
  "closed",
  "立即关闭完成后应投影为 closed。"
);

closeCalls.length = 0;
closeState.isClosing = true;
assert.equal(
  closableImageViewer.closeImmediately(),
  true,
  "正在关闭时应直接收束剩余状态。"
);
assert.deepEqual(
  closeCalls,
  ["finalize"],
  "正在关闭时不应重新启动关闭动画。"
);

const viewerClusterStart = sourceCode.indexOf("const s1pImageViewerState = {");
const viewerClusterEnd = sourceCode.indexOf("const renameAuthorLinks =");
assert.ok(
  viewerClusterStart >= 0 && viewerClusterEnd > viewerClusterStart,
  "应能定位图片查看器实现簇以检查 seam。"
);
const sourceOutsideViewerCluster =
  sourceCode.slice(0, viewerClusterStart) + sourceCode.slice(viewerClusterEnd);
assert.doesNotMatch(
  sourceOutsideViewerCluster,
  /\bs1pImageViewerState\b/,
  "设置、调试和弹窗调用者不得越过 interface 读取可变 viewer state。"
);

console.log("[image-viewer-interface] Viewer projection and actions verified.");
