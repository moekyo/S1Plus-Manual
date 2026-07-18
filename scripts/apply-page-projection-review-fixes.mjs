import { readFile, writeFile } from "node:fs/promises";

const legacySourcePath = new URL("../src/legacy/main.js", import.meta.url);
const releaseSourcePath = new URL("../S1Plus.js", import.meta.url);
const testPath = new URL("../tests/test-page-enhancement-projection.js", import.meta.url);
const resultPath = new URL("../page-projection-fix-result.txt", import.meta.url);

const fail = (message) => {
  throw new Error(`[page-projection-review-fixes] ${message}`);
};

const lineIndentAt = (text, index) => {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const prefix = text.slice(lineStart, index);
  if (!/^[\t ]*$/.test(prefix)) fail("Expected marker to begin after indentation only.");
  return prefix;
};

const findUnique = (text, marker, label, fromIndex = 0) => {
  const first = text.indexOf(marker, fromIndex);
  if (first < 0) fail(`Missing ${label} marker.`);
  if (text.indexOf(marker, first + marker.length) >= 0) {
    fail(`Expected one ${label} marker.`);
  }
  return first;
};

const replaceOnce = (text, before, after, label) => {
  const index = findUnique(text, before, label);
  return `${text.slice(0, index)}${after}${text.slice(index + before.length)}`;
};

const replaceCase = (section, caseName, nextCaseName, buildReplacement) => {
  const startMarker = `case "${caseName}":`;
  const endMarker = `case "${nextCaseName}":`;
  const start = section.indexOf(startMarker);
  const end = section.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    fail(`Unable to locate ${caseName} -> ${nextCaseName} settings cases.`);
  }
  const caseIndent = lineIndentAt(section, start);
  const replacement = buildReplacement(caseIndent);
  return `${section.slice(0, start - caseIndent.length)}${replacement}${section.slice(
    end - lineIndentAt(section, end).length
  )}`;
};

const patchProjectionSourceText = (input, label) => {
  let source = input;
  const settingsMarker =
    "const projectSettingsFeature = (changedPaths, settings) => {";
  const settingsStart = source.indexOf(settingsMarker);
  if (settingsStart < 0) fail(`${label}: missing projectSettingsFeature().`);
  const endMarkers = [
    "const projectSettings = ",
    "const projectCoreData = ",
    "const project = ",
  ];
  const settingsEndCandidates = endMarkers
    .map((marker) => source.indexOf(marker, settingsStart + settingsMarker.length))
    .filter((index) => index > settingsStart);
  if (settingsEndCandidates.length === 0) {
    fail(`${label}: unable to locate the end of projectSettingsFeature().`);
  }
  const settingsEnd = Math.min(...settingsEndCandidates);
  let settingsSection = source.slice(settingsStart, settingsEnd);

  settingsSection = replaceCase(
    settingsSection,
    "enableGeneralSettings",
    "enablePostBlocking",
    (indent) => {
      const inner = `${indent}  `;
      return `${indent}case "enableGeneralSettings":
${inner}call("applyInterfaceCustomizations");
${inner}call("applyGlobalLinkBehavior");
${inner}call("applyImageHiding");
${inner}call("manageImageToggleAllButtons");
${inner}call("applyImageSizeLimits");
${inner}call("applyImageViewerBehavior");
${inner}if (shouldEnableReadProgress(settings)) {
${inner}  call("addProgressJumpButtons");
${inner}} else {
${inner}  call("removeProgressJumpButtons");
${inner}  call("clearReadIndicator");
${inner}}
${inner}return true;
`;
    }
  );

  settingsSection = replaceCase(
    settingsSection,
    "enablePostBlocking",
    "enableUserBlocking",
    (indent) => {
      const inner = `${indent}  `;
      return `${indent}case "enablePostBlocking":
${inner}if (enabled) {
${inner}  call("hideBlockedThreads");
${inner}  call("hideThreadsByTitleKeyword");
${inner}  call("addBlockButtonsToThreads");
${inner}  call("applyUserThreadBlocklist");
${inner}  call("hideBlockedPosts");
${inner}} else {
${inner}  call("restoreManagedVisibility", settings);
${inner}  call("removeBlockButtonsFromThreads");
${inner}  clearKeywordHiddenThreads();
${inner}  call("showBlockedPosts");
${inner}}
${inner}call("refreshPostActions");
${inner}return true;
`;
    }
  );

  source = `${source.slice(0, settingsStart)}${settingsSection}${source.slice(
    settingsEnd
  )}`;

  if (!source.includes("const hasAuxiliaryPostRefresh =")) {
    const mutationMarker = "const projectMutation = (event, settings) => {";
    const mutationStart = source.indexOf(mutationMarker);
    if (mutationStart < 0) fail(`${label}: missing projectMutation().`);
    const declarationMarker = "let usedScopedFallback = false;";
    const declarationStart = source.indexOf(declarationMarker, mutationStart);
    if (declarationStart < 0) {
      fail(`${label}: missing projectMutation() fallback declarations.`);
    }
    const indent = lineIndentAt(source, declarationStart);
    const declarations = `${indent}let usedScopedFallback = false;
${indent}let usedFullFallback = false;
${indent}let shouldRefreshGlobalLinkBehavior = false;
`;
    if (!source.startsWith(declarations, declarationStart - indent.length)) {
      fail(`${label}: projectMutation() fallback declarations changed shape.`);
    }
    const replacementStart = declarationStart - indent.length;
    const auxiliaryHandling = `${indent}let usedScopedFallback = false;
${indent}let usedFullFallback = false;
${indent}let shouldRefreshGlobalLinkBehavior = false;
${indent}const hasAuxiliaryPostRefresh =
${indent}  refresh.quotes === true ||
${indent}  refresh.ratings === true ||
${indent}  refresh.notifications === true;
${indent}if (
${indent}  refresh.posts !== true &&
${indent}  hasAuxiliaryPostRefresh &&
${indent}  isEnabled(settings, "enableUserBlocking")
${indent}) {
${indent}  if (refresh.quotes === true) {
${indent}    const quoteRoots = canUseQuoteScope
${indent}      ? quoteScopes
${indent}      : canUsePostScope
${indent}        ? postTables
${indent}        : null;
${indent}    if (!canUseQuoteScope) {
${indent}      if (canUsePostScope) {
${indent}        usedScopedFallback = true;
${indent}      } else {
${indent}        usedFullFallback = true;
${indent}      }
${indent}    }
${indent}    call("hideBlockedUserQuotes", quoteRoots);
${indent}  }
${indent}  if (refresh.ratings === true) {
${indent}    const ratingsRoots = canUseRatingsScope
${indent}      ? ratingsScopes
${indent}      : canUsePostScope
${indent}        ? postTables
${indent}        : null;
${indent}    if (!canUseRatingsScope) {
${indent}      if (canUsePostScope) {
${indent}        usedScopedFallback = true;
${indent}      } else {
${indent}        usedFullFallback = true;
${indent}      }
${indent}    }
${indent}    call("hideBlockedUserRatings", ratingsRoots);
${indent}  }
${indent}  if (refresh.notifications === true) {
${indent}    const notificationRoots = canUseNotificationScope
${indent}      ? notificationScopes
${indent}      : null;
${indent}    if (!canUseNotificationScope) {
${indent}      usedFullFallback = true;
${indent}    }
${indent}    call("hideBlockedUserNotifications", notificationRoots);
${indent}  }
${indent}}
`;
    source = `${source.slice(0, replacementStart)}${auxiliaryHandling}${source.slice(
      replacementStart + declarations.length
    )}`;
  }

  return source;
};

const patchProjectionTests = (input) => {
  let tests = input;

  if (!tests.includes("const testMutationProjectionHandlesIndependentAuxiliaryScopes")) {
    const settingsTestMarker =
      "const testSettingsProjectionReusesSettingsSemantics = () => {";
    const auxiliaryTests = `const testMutationProjectionHandlesIndependentAuxiliaryScopes = () => {
  const quoteScope = { id: "quote-only", isConnected: true };
  const quoteHarness = createProjectionHarness();
  const quoteOutcome = quoteHarness.projection.project({
    type: "mutation",
    settings: settingsWith(),
    refresh: { quotes: true },
    scopes: { quoteScopes: [quoteScope] },
  });
  assert.deepStrictEqual(toPlainObject(quoteOutcome), {
    type: "mutation",
    mode: "scoped",
  });
  assert.deepStrictEqual(names(quoteHarness.calls), [
    "hideBlockedUserQuotes",
    "ensureMyThreadsQuickLink",
  ]);
  assert.strictEqual(quoteHarness.calls[0][1][0], quoteScope);

  const ratingsScope = { id: "ratings-only", isConnected: true };
  const ratingsHarness = createProjectionHarness();
  const ratingsOutcome = ratingsHarness.projection.project({
    type: "mutation",
    settings: settingsWith(),
    refresh: { ratings: true },
    scopes: { ratingsScopes: [ratingsScope] },
  });
  assert.deepStrictEqual(toPlainObject(ratingsOutcome), {
    type: "mutation",
    mode: "scoped",
  });
  assert.deepStrictEqual(names(ratingsHarness.calls), [
    "hideBlockedUserRatings",
    "ensureMyThreadsQuickLink",
  ]);
  assert.strictEqual(ratingsHarness.calls[0][1][0], ratingsScope);

  const notificationScope = { id: "notification-only", isConnected: true };
  const notificationHarness = createProjectionHarness();
  const notificationOutcome = notificationHarness.projection.project({
    type: "mutation",
    settings: settingsWith(),
    refresh: { notifications: true },
    scopes: { notificationScopes: [notificationScope] },
  });
  assert.deepStrictEqual(toPlainObject(notificationOutcome), {
    type: "mutation",
    mode: "scoped",
  });
  assert.deepStrictEqual(names(notificationHarness.calls), [
    "hideBlockedUserNotifications",
    "ensureMyThreadsQuickLink",
  ]);
  assert.strictEqual(notificationHarness.calls[0][1][0], notificationScope);

  const unsafeQuoteHarness = createProjectionHarness();
  const unsafeQuoteOutcome = unsafeQuoteHarness.projection.project({
    type: "mutation",
    settings: settingsWith(),
    refresh: { quotes: true },
    scopes: { quoteScopes: [quoteScope] },
    scopeSafety: { quoteOverflow: true },
  });
  assert.deepStrictEqual(toPlainObject(unsafeQuoteOutcome), {
    type: "mutation",
    mode: "fallback-full",
  });
  assert.strictEqual(unsafeQuoteHarness.calls[0][1], null);
};

`;
    tests = replaceOnce(
      tests,
      settingsTestMarker,
      `${auxiliaryTests}${settingsTestMarker}`,
      "settings projection test"
    );
  }

  const modalStartMarker = `  calls.length = 0;
  const modalFeature = projection.project({`;
  const disabledProgressMarker = `  calls.length = 0;
  const disabledReadProgress = projection.project({`;
  const modalStart = tests.indexOf(modalStartMarker);
  const disabledStart = tests.indexOf(disabledProgressMarker, modalStart + 1);
  if (modalStart < 0 || disabledStart < 0) {
    fail("Unable to locate targeted settings projection tests.");
  }
  const replacementSettingsTests = `  calls.length = 0;
  const modalFeature = projection.project({
    type: "settings",
    changedPaths: ["enablePostBlocking"],
    settings: settingsWith({ enablePostBlocking: false }),
    origin: "settings_modal",
  });
  assert.deepStrictEqual(toPlainObject(modalFeature), {
    type: "settings",
    mode: "targeted-feature",
  });
  assert.deepStrictEqual(names(calls), [
    "restoreManagedVisibility",
    "removeBlockButtonsFromThreads",
    "clearKeywordHiddenThreads",
    "showBlockedPosts",
    "refreshPostActions",
    "markRuntimeSnapshot",
  ]);

  calls.length = 0;
  const enabledPostBlocking = projection.project({
    type: "settings",
    changedPaths: ["enablePostBlocking"],
    settings: settingsWith({ enablePostBlocking: true }),
    origin: "settings_modal",
  });
  assert.deepStrictEqual(toPlainObject(enabledPostBlocking), {
    type: "settings",
    mode: "targeted-feature",
  });
  assert.deepStrictEqual(names(calls), [
    "hideBlockedThreads",
    "hideThreadsByTitleKeyword",
    "addBlockButtonsToThreads",
    "applyUserThreadBlocklist",
    "hideBlockedPosts",
    "refreshPostActions",
    "markRuntimeSnapshot",
  ]);

  calls.length = 0;
  const generalWithoutReadProgress = projection.project({
    type: "settings",
    changedPaths: ["enableGeneralSettings"],
    settings: settingsWith({
      enableGeneralSettings: true,
      enableReadProgress: false,
    }),
    origin: "settings_modal",
  });
  assert.deepStrictEqual(toPlainObject(generalWithoutReadProgress), {
    type: "settings",
    mode: "targeted-feature",
  });
  assert.deepStrictEqual(names(calls), [
    "applyInterfaceCustomizations",
    "applyGlobalLinkBehavior",
    "applyImageHiding",
    "manageImageToggleAllButtons",
    "applyImageSizeLimits",
    "applyImageViewerBehavior",
    "removeProgressJumpButtons",
    "clearReadIndicator",
    "markRuntimeSnapshot",
  ]);

`;
  tests = `${tests.slice(0, modalStart)}${replacementSettingsTests}${tests.slice(
    disabledStart
  )}`;

  const mutationCall = "testMutationProjectionChoosesScopedOrFullFallback();\n";
  const auxiliaryCall =
    "testMutationProjectionHandlesIndependentAuxiliaryScopes();\n";
  if (!tests.includes(auxiliaryCall)) {
    tests = replaceOnce(
      tests,
      mutationCall,
      `${mutationCall}${auxiliaryCall}`,
      "mutation projection test invocation"
    );
  }

  return tests;
};

const legacySource = await readFile(legacySourcePath, "utf8");
const releaseSource = await readFile(releaseSourcePath, "utf8");
const tests = await readFile(testPath, "utf8");

await writeFile(
  legacySourcePath,
  patchProjectionSourceText(legacySource, "src/legacy/main.js"),
  "utf8"
);
await writeFile(
  releaseSourcePath,
  patchProjectionSourceText(releaseSource, "S1Plus.js"),
  "utf8"
);
await writeFile(testPath, patchProjectionTests(tests), "utf8");
await writeFile(
  resultPath,
  "Applied source, release artifact, and Page Enhancement Projection regression-test fixes.\n",
  "utf8"
);

console.log("Applied Page Enhancement Projection review fixes.");
