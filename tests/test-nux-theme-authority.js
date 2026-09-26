#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness,
  cssSource,
  sourceCode,
  toPlainObject,
} = require("./s1plus-test-helpers");

const flushThemeReconcile = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const assertProjectedTheme = (
  controls,
  hooks,
  {
    isDark,
    source,
    message,
  }
) => {
  const state = toPlainObject(hooks.getCurrentS1pThemeState());
  assert.equal(state.isDark, isDark, `${message}: canonical isDark`);
  assert.equal(state.source, source, `${message}: source`);
  const classes = new Set(controls.getRootClasses());
  assert.equal(
    classes.has("s1p-theme-dark"),
    isDark,
    `${message}: root dark projection`
  );
  assert.equal(
    classes.has("s1p-theme-light"),
    !isDark,
    `${message}: root light projection`
  );
  assert.equal(
    controls.getRootAttribute("data-s1p-theme-source"),
    source,
    `${message}: diagnostic source projection`
  );
};

(async () => {
  const { hooks: pureHooks } = createHarness();
  const {
    resolveNuxRenderedThemeEvidence,
    resolveS1pThemeState,
  } = pureHooks;

  assert.equal(
    typeof resolveNuxRenderedThemeEvidence,
    "function",
    "应暴露 rendered palette 纯解析器。"
  );
  assert.equal(
    typeof resolveS1pThemeState,
    "function",
    "主题 authority 应暴露纯 canonical resolver。"
  );

  assert.deepEqual(
    toPlainObject(
      resolveNuxRenderedThemeEvidence({
        backgroundRaw: "#ecedeb",
        textRaw: "#022c80",
      })
    ).theme,
    "light",
    "NUX custom light 默认 palette 应识别为 light。"
  );
  assert.deepEqual(
    toPlainObject(
      resolveNuxRenderedThemeEvidence({
        backgroundRaw: "#161616",
        textRaw: "#a2aaaf",
      })
    ).theme,
    "dark",
    "NUX custom dark 默认 palette 应识别为 dark。"
  );
  assert.equal(
    toPlainObject(
      resolveNuxRenderedThemeEvidence({
        backgroundRaw: "#b0b0b0",
        textRaw: "#aaaaaa",
      })
    ).theme,
    "unknown",
    "模糊低对比 palette 必须保守返回 unknown。"
  );
  assert.deepEqual(
    toPlainObject(
      resolveNuxRenderedThemeEvidence({
        backgroundRaw: "rgba(0, 0, 0, 0.2)",
        textRaw: "#ffffff",
      })
    ),
    { theme: "unknown", evidence: "translucent-background" },
    "半透明 custom background 不能按未合成 RGB 亮度强行判断深浅。"
  );

  assert.equal(
    toPlainObject(
      resolveS1pThemeState({
        nuxEnabled: false,
        nuxDarkThemeRaw: "1",
        nuxRenderedTheme: "dark",
        systemPrefersDark: true,
      })
    ).source,
    "default-light",
    "NUX disabled 时不能消费 NUX/system dark。"
  );
  assert.deepEqual(
    {
      isDark: toPlainObject(
        resolveS1pThemeState({
          nuxEnabled: true,
          nuxDarkThemeRaw: "",
          nuxRenderedTheme: "unknown",
          systemPrefersDark: true,
          allowSystemFallback: false,
        })
      ).isDark,
      source: toPlainObject(
        resolveS1pThemeState({
          nuxEnabled: true,
          nuxDarkThemeRaw: "",
          nuxRenderedTheme: "unknown",
          systemPrefersDark: true,
          allowSystemFallback: false,
        })
      ).source,
    },
    { isDark: false, source: "nux-rendered-unknown" },
    "没有可靠 rendered evidence 时不得偷偷回退 system dark。"
  );
  assert.deepEqual(
    {
      isDark: toPlainObject(
        resolveS1pThemeState({
          nuxEnabled: true,
          nuxDarkThemeRaw: "",
          nuxRenderedTheme: "unknown",
          systemPrefersDark: true,
          allowSystemFallback: true,
        })
      ).isDark,
      source: toPlainObject(
        resolveS1pThemeState({
          nuxEnabled: true,
          nuxDarkThemeRaw: "",
          nuxRenderedTheme: "unknown",
          systemPrefersDark: true,
          allowSystemFallback: true,
        })
      ).source,
    },
    { isDark: true, source: "nux-system-fallback" },
    "只有显式提供独立 auto/system-follow 证据时 resolver 才允许 system fallback。"
  );

  const runtime = createHarness({
    themeRuntime: {
      systemPrefersDark: false,
      nuxMarkerPresent: false,
      rootCssVariables: {},
    },
  });
  const { hooks, themeRuntimeControls: controls } = runtime;
  hooks.initializeS1pThemeSynchronization();

  assertProjectedTheme(controls, hooks, {
    isDark: false,
    source: "default-light",
    message: "A. NUX disabled + system light",
  });
  assert.equal(controls.getMutationObserverCount(), 1);
  assert.equal(controls.getMediaListenerCount(), 1);

  // Idempotent initialize: no duplicate observer/listener.
  hooks.initializeS1pThemeSynchronization();
  assert.equal(controls.getMutationObserverCount(), 1);
  assert.equal(controls.getMediaListenerCount(), 1);

  controls.setSystemPrefersDark(true);
  await flushThemeReconcile();
  assertProjectedTheme(controls, hooks, {
    isDark: false,
    source: "default-light",
    message: "B. NUX disabled + system dark",
  });

  controls.setNuxMarkerPresent(true);
  controls.setRootCssVariable("--darktheme", "0");
  controls.setRootCssVariable("--bg", "#ecedeb");
  controls.setRootCssVariable("--t", "#022c80");
  controls.setRootCssVariable("--sec", "#0095ff");
  controls.setRootCssVariable("--prid", "#cc9");
  controls.setRootCssVariable("--pridb", "#999");
  controls.setRootCssVariable("--icl", "#fff");
  controls.triggerMarkerMutation();
  await flushThemeReconcile();
  assertProjectedTheme(controls, hooks, {
    isDark: false,
    source: "nux-darktheme",
    message: "C. NUX --darktheme 0 + system dark",
  });

  controls.setSystemPrefersDark(false);
  controls.setRootCssVariable("--darktheme", "1");
  controls.setRootCssVariable("--bg", "#161616");
  controls.setRootCssVariable("--t", "#a2aaaf");
  controls.triggerStyleMutation();
  await flushThemeReconcile();
  assertProjectedTheme(controls, hooks, {
    isDark: true,
    source: "nux-darktheme",
    message: "D/E. NUX 0 -> 1 without settings modal",
  });

  controls.setRootCssVariable("--darktheme", "0");
  controls.setRootCssVariable("--bg", "#ecedeb");
  controls.setRootCssVariable("--t", "#022c80");
  controls.triggerStyleMutation();
  await flushThemeReconcile();
  assertProjectedTheme(controls, hooks, {
    isDark: false,
    source: "nux-darktheme",
    message: "F. NUX 1 -> 0 without system change",
  });

  controls.setSystemPrefersDark(true);
  controls.setNuxMarkerPresent(false);
  controls.triggerMarkerMutation();
  await flushThemeReconcile();
  assertProjectedTheme(controls, hooks, {
    isDark: false,
    source: "default-light",
    message: "G. NUX enabled -> disabled + system dark",
  });

  controls.setNuxMarkerPresent(true);
  controls.deleteRootCssVariable("--darktheme");
  controls.setRootCssVariable("--bg", "#ecedeb");
  controls.setRootCssVariable("--t", "#022c80");
  controls.triggerMarkerMutation();
  await flushThemeReconcile();
  assertProjectedTheme(controls, hooks, {
    isDark: false,
    source: "nux-rendered-theme",
    message: "H. custom light without --darktheme + system dark",
  });

  controls.setSystemPrefersDark(false);
  controls.setRootCssVariable("--bg", "#161616");
  controls.setRootCssVariable("--t", "#a2aaaf");
  controls.triggerStyleMutation();
  await flushThemeReconcile();
  assertProjectedTheme(controls, hooks, {
    isDark: true,
    source: "nux-rendered-theme",
    message: "I. custom dark without --darktheme + system light",
  });

  controls.setSystemPrefersDark(true);
  controls.setRootCssVariable("--bg", "#b0b0b0");
  controls.setRootCssVariable("--t", "#aaaaaa");
  controls.triggerStyleMutation();
  await flushThemeReconcile();
  assertProjectedTheme(controls, hooks, {
    isDark: false,
    source: "nux-rendered-unknown",
    message: "J. ambiguous rendered palette remains conservative",
  });

  const compatibilityCountBeforeNoop =
    hooks.getS1pThemeCompatibilityReconcileCountForTest();
  controls.triggerStyleMutation();
  await flushThemeReconcile();
  assert.equal(
    hooks.getS1pThemeCompatibilityReconcileCountForTest(),
    compatibilityCountBeforeNoop,
    "K. 相同 canonical state 的 stylesheet 触发必须是 no-op。"
  );
  controls.triggerOrdinaryMutation();
  await flushThemeReconcile();
  assert.equal(
    hooks.getS1pThemeCompatibilityReconcileCountForTest(),
    compatibilityCountBeforeNoop,
    "K. 普通页面 DOM mutation 不得触发昂贵 theme reconciliation。"
  );

  hooks.disposeS1pThemeSynchronization();
  assert.equal(controls.getMutationObserverCount(), 0);
  assert.equal(controls.getMediaListenerCount(), 0);

  const residueRuntime = createHarness({
    themeRuntime: {
      systemPrefersDark: false,
      nuxMarkerPresent: true,
      includeSettingsModal: true,
      rootCssVariables: {
        "--darktheme": "1",
        "--bg": "#413439",
        "--t": "#ffe6f5",
        "--sec": "#36ff72",
        "--prid": "#b54467",
        "--pridb": "#8f314d",
        "--icl": "#000",
      },
    },
  });
  const {
    hooks: residueHooks,
    themeRuntimeControls: residueControls,
  } = residueRuntime;
  residueHooks.initializeS1pThemeSynchronization();

  assert.equal(
    residueControls.settingsModal.classList.contains(
      "s1p-nux-transition-isolation"
    ),
    true,
    "L. NUX enabled 时 transition isolation 应收敛。"
  );
  assert.equal(
    residueControls.settingsModal.classList.contains(
      "s1p-nux-segmented-contrast-fix"
    ),
    true,
    "L. Vine low-contrast segmented fix 应收敛。"
  );
  assert.equal(
    residueControls.settingsModal.classList.contains(
      "s1p-nux-vine-tab-tone"
    ),
    true,
    "L. Vine tab tone fix 应收敛。"
  );
  assert.ok(
    residueControls.settingsModalContent.style
      .getPropertyValue("--s1p-settings-scrollbar-thumb")
      .includes("--prid"),
    "L. NUX enabled 时 settings scrollbar 应消费 NUX palette。"
  );

  residueControls.seedNuxCompatibilityResidue();
  residueControls.setSystemPrefersDark(true);
  residueControls.setNuxMarkerPresent(false);
  residueControls.triggerMarkerMutation();
  await flushThemeReconcile();

  assertProjectedTheme(residueControls, residueHooks, {
    isDark: false,
    source: "default-light",
    message: "L. disable cleanup projection",
  });
  assert.equal(
    residueControls.settingsModal.classList.contains(
      "s1p-nux-transition-isolation"
    ),
    false,
    "L. disabled 后 transition residue 必须清理。"
  );
  assert.equal(
    residueControls.settingsModal.classList.contains(
      "s1p-nux-segmented-contrast-fix"
    ),
    false,
    "L. disabled 后 segmented residue 必须清理。"
  );
  assert.equal(
    residueControls.settingsModal.classList.contains(
      "s1p-nux-vine-tab-tone"
    ),
    false,
    "L. disabled 后 Vine residue 必须清理。"
  );
  assert.equal(
    residueControls.settingsModalContent.style.getPropertyValue(
      "--s1p-settings-scrollbar-thumb"
    ),
    "",
    "L. disabled 后 NUX scrollbar override 必须移除。"
  );
  assert.equal(
    residueControls.darkTextResidueNode.classList.contains(
      "s1p-nux-dark-text-fixed"
    ),
    false,
    "L. disabled 后 dark text compatibility class 必须恢复。"
  );
  assert.equal(
    residueControls.lightBgResidueNode.classList.contains(
      "s1p-light-bg-content"
    ),
    false,
    "L. disabled 后 light-background compatibility class 必须恢复。"
  );
  assert.equal(
    residueControls.lightBgResidueNode.hasAttribute(
      "data-s1p-light-bg-removed"
    ),
    false,
    "L. disabled 后 light-background removal marker 必须恢复。"
  );
  residueHooks.disposeS1pThemeSynchronization();

  assert.ok(
    sourceCode.includes(
      "const S1P_NUX_MARKER_SELECTOR = '#flk a[href=\"archiver/\"]';"
    ),
    "NUX availability 必须绑定 S1 NUX 实际输出 marker，而不是泛化 archiver 链接。"
  );
  assert.ok(
    sourceCode.includes(
      "const S1P_NUX_MARKER_NODE_SELECTOR = 'a[href=\"archiver/\"]';"
    ),
    "theme change trigger 可识别已脱离 #flk 的 removed marker，但它不能成为 availability authority。"
  );
  assert.equal(
    cssSource.includes("@media (prefers-color-scheme: dark)"),
    false,
    "S1Plus.css 不得重新直接使用 system dark 作为 theme authority。"
  );
  assert.equal(
    sourceCode.includes("@media (prefers-color-scheme: dark)"),
    false,
    "runtime injected S1 Plus UI CSS 不得重新引入 system-dark selector。"
  );
  assert.equal(
    (sourceCode.match(/matchMedia\(\s*"\(prefers-color-scheme: dark\)"\s*\)/g) || [])
      .length,
    1,
    "system dark media query 只能存在于统一 theme synchronization seam。"
  );
  assert.ok(
    sourceCode.includes(
      "const isNuxDarkThemeActive = () =>\n    currentS1pThemeState.nuxEnabled === true"
    ),
    "JS compatibility 消费 canonical current theme state，不能重新读取 computed style 建立第二 authority。"
  );
  assert.ok(
    sourceCode.includes("syncS1pThemeProjection(nextThemeState);"),
    "html theme class 必须是 canonical state 的统一 projection。"
  );
  assert.equal(
    sourceCode.includes("modalThemeSyncTimer"),
    false,
    "settings modal 350ms timer 不得继续承担全局 theme authority。"
  );
  assert.ok(
    sourceCode.includes("initializeS1pThemeSynchronization"),
    "全局 theme synchronization 必须独立于 settings modal 生命周期。"
  );

  console.log(
    "[nux-theme-authority] canonical resolver, lifecycle synchronization, runtime transitions and cleanup verified."
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
