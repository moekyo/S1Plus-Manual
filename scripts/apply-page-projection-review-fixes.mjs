import { readFile, writeFile } from "node:fs/promises";

const sourcePath = new URL("../src/legacy/main.js", import.meta.url);
const testPath = new URL("../tests/test-page-enhancement-projection.js", import.meta.url);

const fail = (message) => {
  throw new Error(`[page-projection-review-fixes] ${message}`);
};

const findUnique = (text, marker, label) => {
  const first = text.indexOf(marker);
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

const replaceCase = (section, caseName, nextCaseName, replacement) => {
  const startMarker = `        case "${caseName}":`;
  const endMarker = `        case "${nextCaseName}":`;
  const start = section.indexOf(startMarker);
  const end = section.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    fail(`Unable to locate ${caseName} -> ${nextCaseName} settings cases.`);
  }
  return `${section.slice(0, start)}${replacement}${section.slice(end)}`;
};

const patchLegacySource = async () => {
  let source = await readFile(sourcePath, "utf8");

  const settingsStartMarker =
    "    const projectSettingsFeature = (changedPaths, settings) => {";
  const settingsStart = source.indexOf(settingsStartMarker);
  if (settingsStart < 0) fail("Missing projectSettingsFeature().");
  const settingsEndCandidates = [
    "\n    const projectSettings = ",
    "\n    const projectCoreData = ",
    "\n    const project = ",
  ]
    .map((marker) => source.indexOf(marker, settingsStart + settingsStartMarker.length))
    .filter((index) => index > settingsStart);
  if (settingsEndCandidates.length === 0) {
    fail("Unable to locate the end of projectSettingsFeature().");
  }
  const settingsEnd = Math.min(...settingsEndCandidates);
  let settingsSection = source.slice(settingsStart, settingsEnd);

  const generalCase = `        case "enableGeneralSettings":
          call("applyInterfaceCustomizations");
          call("applyGlobalLinkBehavior");
          call("applyImageHiding");
          call("manageImageToggleAllButtons");
          call("applyImageSizeLimits");
          call("applyImageViewerBehavior");
          if (shouldEnableReadProgress(settings)) {
            call("addProgressJumpButtons");
          } else {
            call("removeProgressJumpButtons");
            call("clearReadIndicator");
          }
          return true;
`;
  settingsSection = replaceCase(
    settingsSection,
    "enableGeneralSettings",
    "enablePostBlocking",
    generalCase
  );

  const postBlockingCase = `        case "enablePostBlocking":
          if (enabled) {
            call("hideBlockedThreads");
            call("hideThreadsByTitleKeyword");
            call("addBlockButtonsToThreads");
            call("applyUserThreadBlocklist");
            call("hideBlockedPosts");
          } else {
            call("restoreManagedVisibility", settings);
            call("removeBlockButtonsFromThreads");
            clearKeywordHiddenThreads();
            call("showBlockedPosts");
          }
          call("refreshPostActions");
          return true;
`;
  settingsSection = replaceCase(
    settingsSection,
    "enablePostBlocking",
    "enableUserBlocking",
    postBlockingCase
  );

  source = `${source.slice(0, settingsStart)}${settingsSection}${source.slice(settingsEnd)}`;

  const auxiliaryMarker = "      const hasAuxiliaryPostRefresh =";
  if (!source.includes(auxiliaryMarker)) {
    const mutationStart = source.indexOf("    const projectMutation = (event, settings) => {");
    if (mutationStart < 0) fail("Missing projectMutation().");
    const declarations = `      let usedScopedFallback = false;
      let usedFullFallback = false;
      let shouldRefreshGlobalLinkBehavior = false;
`;
    const declarationIndex = source.indexOf(declarations, mutationStart);
    if (declarationIndex < 0) {
      fail("Unable to locate projectMutation() fallback declarations.");
    }
    const auxiliaryHandling = `      let usedScopedFallback = false;
      let usedFullFallback = false;
      let shouldRefreshGlobalLinkBehavior = false;
      const hasAuxiliaryPostRefresh =
        refresh.quotes === true ||
        refresh.ratings === true ||
        refresh.notifications === true;
      if (
        refresh.posts !== true &&
        hasAuxiliaryPostRefresh &&
        isEnabled(settings, "enableUserBlocking")
      ) {
        if (refresh.quotes === true) {
          const quoteRoots = canUseQuoteScope
            ? quoteScopes
            : canUsePostScope
              ? postTables
              : null;
          if (!canUseQuoteScope) {
            if (canUsePostScope) {
              usedScopedFallback = true;
            } else {
              usedFullFallback = true;
            }
          }
          call("hideBlockedUserQuotes", quoteRoots);
        }
        if (refresh.ratings === true) {
          const ratingsRoots = canUseRatingsScope
            ? ratingsScopes
            : canUsePostScope
              ? postTables
              : null;
          if (!canUseRatingsScope) {
            if (canUsePostScope) {
              usedScopedFallback = true;
            } else {
              usedFullFallback = true;
            }
          }
          call("hideBlockedUserRatings", ratingsRoots);
        }
        if (refresh.notifications === true) {
          const notificationRoots = canUseNotificationScope
            ? notificationScopes
            : null;
          if (!canUseNotificationScope) {
            usedFullFallback = true;
          }
          call("hideBlockedUserNotifications", notificationRoots);
        }
      }
`;
    source = `${source.slice(0, declarationIndex)}${auxiliaryHandling}${source.slice(
      declarationIndex + declarations.length
    )}`;
  }

  await writeFile(sourcePath, source, "utf8");
};

const patchProjectionTests = async () => {
  let tests = await readFile(testPath, "utf8");

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

  await writeFile(testPath, tests, "utf8");
};

await patchLegacySource();
await patchProjectionTests();
console.log("Applied Page Enhancement Projection review fixes.");
