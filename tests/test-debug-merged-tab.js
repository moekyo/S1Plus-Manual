#!/usr/bin/env node
"use strict";

// 调试面板整合后的结构约束：日志与同步诊断必须同处一个 tab，
// 快照区可折叠、有最小可读高度，复制入口必须同时保留“全部 / 仅日志 / 仅快照”。

const assert = require("assert/strict");
const {
  createHarness: createBaseHarness,
  sourceCode,
  sourceCodeWithCss,
} = require("./s1plus-test-helpers");

const createHarness = () =>
  createBaseHarness({
    includeSessionStorage: true,
    hookErrorMessage: "未能从 S1Plus.js 暴露调试面板整合测试钩子。",
  });

const getSlice = (startMarker, endMarker) => {
  const start = sourceCode.indexOf(startMarker);
  assert.ok(start >= 0, `S1Plus.js 中找不到：${startMarker}`);
  const end = sourceCode.indexOf(endMarker, start);
  assert.ok(end > start, `S1Plus.js 中找不到切片终点：${endMarker}`);
  return sourceCode.slice(start, end);
};

const testTabDefinition = () => {
  const tabsBlock = getSlice(
    "const DEBUG_UNIFIED_TABS = Object.freeze([",
    "]);"
  );
  assert.equal(
    (tabsBlock.match(/\{ key:/g) || []).length,
    3,
    "调试面板应只保留 3 个 tab。"
  );
  assert.match(tabsBlock, /\{ key: "log", label: "日志与诊断" \}/);
  assert.doesNotMatch(tabsBlock, /"diagnostics"/, "诊断信息 tab 应已并入日志 tab。");
  assert.doesNotMatch(
    tabsBlock,
    /key: "diagnostics"/,
    "旧 diagnostics tab key 不应保留。"
  );
};

const testLogTabContainsSnapshot = () => {
  const logTabBlock = getSlice(
    "const createDebugConsoleLogTabContent = () => {",
    "const setDebugDiagnosticsResetConfirmationVisible"
  );
  assert.match(
    logTabBlock,
    /panel\.appendChild\(createDebugSyncDiagnosticsEmbed\(\)\);/,
    "日志 tab 必须在顶部挂载同步状态快照区块。"
  );
  assert.match(
    logTabBlock,
    /createS1pDebugButton\(\{\s*label: "复制全部",\s*action: "copy-all"/,
    "日志 tab 必须提供“复制全部”入口。"
  );
  assert.match(
    logTabBlock,
    /label: "复制日志",\s*action: "copy-logs"/,
    "日志 tab 的复制按钮应明确标注为“复制日志”。"
  );
  assert.match(
    logTabBlock,
    /label: "复制快照",\s*action: "copy-diagnostics"/,
    "快照区块必须提供“复制快照”入口。"
  );
  assert.match(
    logTabBlock,
    /className = "s1p-debug-section s1p-debug-diagnostics-embed"/,
    "快照区块应复用 s1p-debug-section 统一容器。"
  );
  assert.match(
    logTabBlock,
    /setDebugDiagnosticsEmbedCollapsed\(embed, true\);/,
    "快照区块默认应折叠，避免挤压日志区。"
  );
  assert.doesNotMatch(sourceCode, /createDebugSyncDiagnosticsTabContent/);
};

const testLogTabRefreshesSnapshot = () => {
  const switchBlock = getSlice(
    'const switchDebugUnifiedPanelTab = (tabKey = "log") => {',
    "const positionDebugUnifiedPanelTabSlider"
  );
  assert.match(
    switchBlock,
    /if \(activeTab === "log"\) \{[\s\S]*?renderLogPanel\(\);[\s\S]*?updateSyncDiagnosticsPanel\(\);[\s\S]*?\} else if \(activeTab === "indicator"\)/,
    "切到日志与诊断 tab 时必须在同一分支内刷新日志与快照。"
  );
  assert.doesNotMatch(switchBlock, /activeTab === "diagnostics"/);
};

const testCombinedReportBuilder = () => {
  const builderBlock = getSlice(
    "const getFilteredLogCopyLines = () => {",
    "const handleDebugUnifiedPanelAction"
  );
  assert.match(builderBlock, /applyLogFilters\(logBuffer\)/);
  assert.match(builderBlock, /formatLogEntryForCopy/);
  const combinedBlock = builderBlock.slice(
    builderBlock.indexOf("const buildDebugCombinedCopyText")
  );
  assert.match(combinedBlock, /getFilteredLogCopyLines\(\)/);
  assert.match(combinedBlock, /buildSyncDiagnosticsSummary\(\)/);
  assert.match(combinedBlock, /===== 同步状态快照 =====/);
  assert.match(combinedBlock, /===== 当前标签页筛选日志/);
  assert.match(combinedBlock, /（当前筛选下没有日志）/);
  const handlerBlock = getSlice(
    "const handleDebugUnifiedPanelAction = (action, button) => {",
    "const initializeDebugUnifiedPanel = ("
  );
  assert.match(handlerBlock, /action === "copy-all"/);
  assert.match(handlerBlock, /buildDebugCombinedCopyText\(\)/);
  assert.match(handlerBlock, /action === "copy-diagnostics"/);
  assert.match(handlerBlock, /action === "toggle-debug-diagnostics-embed"/);
  assert.match(handlerBlock, /setDebugDiagnosticsEmbedCollapsed\(embed, /);
  assert.match(
    handlerBlock,
    /if \(action === "copy-logs"\) \{[\s\S]*?getFilteredLogCopyLines\(\)/,
    "复制日志与复制全部必须共用筛选日志段构造器。"
  );
};

const testCss = () => {
  assert.match(
    sourceCodeWithCss,
    /#s1p-debug-unified-panel \.s1p-debug-diagnostics-embed \{[\s\S]*?flex: 0 0 auto;[\s\S]*?max-height: max\(170px, 42%\);/,
    "快照区块必须有可读下限且不收缩，最小面板高度下交给 pane 滚动。"
  );
  assert.match(
    sourceCodeWithCss,
    /\.s1p-debug-diagnostics-embed\.is-collapsed \.s1p-debug-diagnostics-embed-body \{\s*display: none;/,
    "折叠态必须隐藏快照正文。"
  );
  assert.match(
    sourceCodeWithCss,
    /\.s1p-debug-diagnostics-embed \.s1p-debug-diagnostics-panel \{[\s\S]*?overflow: hidden auto;/,
    "快照正文必须在区块内滚动。"
  );
  const embedRuleStart = sourceCodeWithCss.indexOf(
    "#s1p-debug-unified-panel .s1p-debug-diagnostics-embed {"
  );
  assert.ok(embedRuleStart >= 0);
  const embedRule = sourceCodeWithCss.slice(
    embedRuleStart,
    sourceCodeWithCss.indexOf("}", embedRuleStart)
  );
  assert.doesNotMatch(
    embedRule,
    /background|border-radius/,
    "快照区块应复用 s1p-debug-section 的圆角与背景，不重复声明。"
  );
};

const testCombinedCopyRuntime = () => {
  const { hooks } = createHarness();
  assert.equal(
    typeof hooks.buildDebugCombinedCopyText,
    "function",
    "缺少 buildDebugCombinedCopyText 测试钩子。"
  );
  hooks.setDebugLogCollectorStateForTest({
    entries: [
      {
        id: 1,
        ts: 1760000000000,
        level: "log",
        module: "settings",
        message: "merged tab marker entry",
      },
      {
        id: 2,
        ts: 1760000001000,
        level: "error",
        module: "sync",
        message: "merged tab second entry",
      },
    ],
    nextId: 3,
  });
  const text = hooks.buildDebugCombinedCopyText();
  assert.match(text, /^S1 Plus \d+\.\d+\.\d+ · 调试报告 · /);
  assert.match(text, /===== 同步状态快照 =====/);
  assert.match(text, /最近动作:/, "快照区必须包含同步诊断字段。");
  assert.match(text, /===== 当前标签页筛选日志 · 2 条 =====/);
  assert.match(text, /merged tab marker entry/, "复制全部必须包含日志条目。");
  assert.match(text, /merged tab second entry/, "复制全部必须包含全部条目。");

  const emptyHarness = createHarness();
  emptyHarness.hooks.setDebugLogCollectorStateForTest({
    entries: [],
    nextId: 1,
  });
  const emptyText = emptyHarness.hooks.buildDebugCombinedCopyText();
  assert.match(emptyText, /===== 当前标签页筛选日志 · 0 条 =====/);
  assert.match(emptyText, /（当前筛选下没有日志）/, "空日志必须给出占位说明。");
};

testTabDefinition();
testLogTabContainsSnapshot();
testLogTabRefreshesSnapshot();
testCombinedReportBuilder();
testCss();
testCombinedCopyRuntime();

console.log("[debug-merged-tab] 日志与诊断整合结构、折叠标记及复制入口已验证。");
