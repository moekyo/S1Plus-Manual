#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness: createBaseHarness } = require("./s1plus-test-helpers");

const createHarness = () =>
  createBaseHarness({
    href: "https://stage1st.com/2b/thread-123456-1-1.html",
    search: "",
    visibilityState: "visible",
    hookErrorMessage: "未能从 S1Plus.js 暴露后台开帖被动会话测试钩子。",
  });

const testBackgroundOpenHintLifecycle = () => {
  const { hooks } = createHarness();
  const hint = hooks.registerBackgroundOpenThreadHintForUrl(
    "https://stage1st.com/2b/thread-123456-2-1.html"
  );

  assert.ok(hint, "后台开帖应写入短寿命提示。");
  assert.equal(hint.threadId, "123456");
  assert.equal(hint.page, "2");
  assert.equal(hooks.getBackgroundOpenThreadHints().length, 1);

  const consumedHint = hooks.consumeBackgroundOpenThreadHint({
    threadId: "123456",
    page: "2",
  });
  assert.ok(consumedHint, "线程页启动时应能消费对应的后台开帖提示。");
  assert.equal(consumedHint.sessionId, hint.sessionId);
  assert.equal(hooks.getBackgroundOpenThreadHints().length, 0);
};

const testPassiveBackgroundOpenRequiresInteraction = () => {
  const { hooks } = createHarness();
  hooks.setReadProgressTrackingStateForTest(
    {
      hasConfirmedVisiblePost: true,
      visibleSince: Date.now() - 2500,
      initiatedWhileHidden: false,
      passiveBackgroundOpened: true,
      lastInteractionAt: 0,
      lastInteractionType: "",
    },
    { replace: true }
  );

  assert.equal(
    hooks.requiresExplicitInteractionForReadProgressConfirmation(),
    true
  );
  assert.equal(
    hooks.resolveReadProgressConfirmationReason("visible_stable"),
    "",
    "后台打开页在没有真实交互前，不应仅靠 visible_stable 完成首次确认。"
  );

  hooks.setReadProgressTrackingStateForTest({
    lastInteractionAt: Date.now() - 120,
    lastInteractionType: "wheel",
  });
  assert.equal(
    hooks.resolveReadProgressConfirmationReason("user_interaction"),
    "user_interaction"
  );
};

const testHiddenStartRequiresInteraction = () => {
  const { hooks } = createHarness();
  hooks.setReadProgressTrackingStateForTest(
    {
      hasConfirmedVisiblePost: true,
      visibleSince: Date.now() - 2500,
      initiatedWhileHidden: true,
      passiveBackgroundOpened: false,
      lastInteractionAt: 0,
      lastInteractionType: "",
    },
    { replace: true }
  );

  assert.equal(
    hooks.resolveReadProgressConfirmationReason("visible_stable"),
    "",
    "隐藏启动页在没有交互前，不应仅靠 visible_stable 完成首次确认。"
  );

  hooks.setReadProgressTrackingStateForTest({
    lastInteractionAt: Date.now() - 120,
    lastInteractionType: "keydown",
  });
  assert.equal(
    hooks.resolveReadProgressConfirmationReason("user_interaction"),
    "user_interaction"
  );
};

const main = async () => {
  testBackgroundOpenHintLifecycle();
  testPassiveBackgroundOpenRequiresInteraction();
  testHiddenStartRequiresInteraction();
  console.log("[background-open-passive-session] checks passed.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
