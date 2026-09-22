#!/usr/bin/env node
"use strict";

/**
 * 导航栏响应式布局模型测试。
 *
 * 覆盖目标：
 *   - devicePixelRatio 1 / 1.25 / 1.5 / 1.875 / 2
 *   - Chrome zoom 80% / 100% / 125% / 150% / 175% / 200%
 *   - viewport 900 / 950 / 985 / 1024 / 1280 / 1440
 *   - 首次加载、刷新、resize、DevTools 打开/关闭、字体延迟、重复 reconcile
 *
 * 布局决策是纯函数：同样的测量输入必然得到同样的投影。
 * devicePixelRatio / zoom 通过“设备像素量化后的亚像素宽度”进入模型，
 * 因此这里用确定性量化模型构造测量输入，再验证模型的不变量。
 */

const assert = require("assert/strict");
const { createHarness } = require("./s1plus-test-helpers");

const runtime = createHarness();
const computeProjection = runtime.hooks.computeNavbarLayoutProjection;
assert.equal(
  typeof computeProjection,
  "function",
  "S1Plus.js 必须暴露纯布局决策函数 computeNavbarLayoutProjection。"
);

// --- 现场数据 ---------------------------------------------------------------
// Windows 10 / 32" 2K / Chrome 150% / devicePixelRatio 1.875 / viewport 985。
const REPORTED_HEADER_WIDTH = 985.6;
const REPORTED_SEARCH_WIDTH = 334.47;
const REPORTED_USER_AREA_WIDTH = 153.78;
const REPORTED_QUICK_MENU_WIDTH = 96;
const REPORTED_CUSTOM_ITEM_WIDTHS = [45, 45, 45, 45, 63.63, 59];
const REPORTED_MANAGER_WIDTH = 99.73;
const REPORTED_OVERFLOW_TOGGLE_WIDTH = 46;
const REPORTED_SEARCH_TOGGLE_WIDTH = 46;

const DPR_MATRIX = [1, 1.25, 1.5, 1.875, 2];
const ZOOM_MATRIX = [0.8, 1, 1.25, 1.5, 1.75, 2];
const VIEWPORT_MATRIX = [900, 950, 985, 1024, 1280, 1440];

// 浏览器把盒子量化到整数设备像素；量化网格 = devicePixelRatio（已包含 zoom）。
const quantize = (cssWidth, deviceScale) => {
  const scale = Number(deviceScale) > 0 ? Number(deviceScale) : 1;
  return Math.round(cssWidth * scale) / scale;
};

// zoom 会改变文本在设备像素网格上的落点，因此每个链接的小数部分随 zoom 变化。
// 这是确定性的亚像素模型，用于覆盖“不同缩放得到不同小数宽度”这一现象。
const zoomFractionalJitter = (index, zoom) =>
  1 + (zoom - 1) * (((index * 7) % 5) - 2) * 0.0009;

const buildMetrics = ({
  viewport = REPORTED_HEADER_WIDTH,
  deviceScale = 1.875,
  zoom = 1,
  itemWidths = REPORTED_CUSTOM_ITEM_WIDTHS,
  searchWidth = REPORTED_SEARCH_WIDTH,
} = {}) => {
  const quantizedItems = itemWidths.map((width, index) =>
    quantize(width * zoomFractionalJitter(index, zoom), deviceScale)
  );
  const quantizedSearch = quantize(searchWidth, deviceScale);
  const quantizedUserArea = quantize(REPORTED_USER_AREA_WIDTH, deviceScale);
  const quantizedQuickMenu = quantize(REPORTED_QUICK_MENU_WIDTH, deviceScale);
  const availableWidth = Math.max(
    0,
    quantize(viewport, deviceScale) -
      quantizedSearch -
      quantizedUserArea -
      quantizedQuickMenu
  );

  return {
    itemWidths: quantizedItems,
    chromeWidth: quantize(REPORTED_MANAGER_WIDTH, deviceScale),
    overflowToggleWidth: quantize(REPORTED_OVERFLOW_TOGGLE_WIDTH, deviceScale),
    availableWidth,
    searchWidth: quantizedSearch,
    searchToggleWidth: quantize(REPORTED_SEARCH_TOGGLE_WIDTH, deviceScale),
  };
};

const EPSILON_PX = 2;

const demandFor = (metrics, count, withOverflowToggle) => {
  const items = metrics.itemWidths.slice(0, count);
  const itemTotal = items.reduce((total, width) => total + width, 0);
  return (
    itemTotal +
    metrics.chromeWidth +
    (withOverflowToggle ? metrics.overflowToggleWidth : 0)
  );
};

const rowBudgetFor = (metrics, projection) => {
  const released = projection.searchCollapsed
    ? Math.max(0, metrics.searchWidth - metrics.searchToggleWidth)
    : 0;
  return metrics.availableWidth + released;
};

const assertProjectionShape = (projection, metrics, label) => {
  assert.equal(projection.mode, "responsive", `${label}: mode`);
  assert.ok(
    Number.isInteger(projection.primaryCount),
    `${label}: primaryCount must be an integer`
  );
  assert.ok(
    projection.primaryCount >= 0 &&
      projection.primaryCount <= metrics.itemWidths.length,
    `${label}: primaryCount must stay inside the canonical record range`
  );
  assert.equal(
    projection.showOverflow,
    projection.primaryCount < metrics.itemWidths.length,
    `${label}: overflow owner must exactly mirror the hidden records`
  );

  const budget = rowBudgetFor(metrics, projection);
  const projectedDemand = demandFor(
    metrics,
    projection.primaryCount,
    projection.showOverflow
  );
  const minimalDemand = demandFor(metrics, 0, projection.showOverflow);
  // 只有“连固定保留区域都放不下”的极端行宽才允许裁剪；
  // 其余情况下投影必须正好落在预算内且是最小收缩。
  if (minimalDemand <= budget + EPSILON_PX + 1e-9) {
    assert.ok(
      projectedDemand <= budget + EPSILON_PX + 1e-9,
      `${label}: projected primary demand must fit inside the budget`
    );

    if (projection.primaryCount < metrics.itemWidths.length) {
      const nextDemand = demandFor(
        metrics,
        projection.primaryCount + 1,
        projection.primaryCount + 1 < metrics.itemWidths.length
      );
      assert.ok(
        nextDemand > budget + EPSILON_PX + 1e-9,
        `${label}: overflow must be minimal`
      );
    }
  }
};

// --- 1. 现场数据：不得因为亚像素误差进入“更多” ------------------------------
{
  const metrics = buildMetrics({
    viewport: REPORTED_HEADER_WIDTH,
    deviceScale: 1.875,
    zoom: 1.5,
  });
  const projection = computeProjection(metrics);
  assertProjectionShape(projection, metrics, "reported environment");
  assert.equal(
    projection.primaryCount,
    REPORTED_CUSTOM_ITEM_WIDTHS.length,
    "现场数据下所有自定义链接必须留在 primary，缺失的宽度由布局量化容差吸收"
  );
  assert.equal(projection.showOverflow, false);
  assert.equal(projection.searchCollapsed, false);
}

// --- 2. 幂等性：同样的输入重复决策结果完全一致 -----------------------------
{
  const cases = [];
  for (const dpr of DPR_MATRIX) {
    for (const zoom of ZOOM_MATRIX) {
      for (const viewport of VIEWPORT_MATRIX) {
        cases.push({ dpr, zoom, viewport });
      }
    }
  }

  for (const { dpr, zoom, viewport } of cases) {
    const metrics = buildMetrics({ viewport, deviceScale: dpr, zoom });
    const first = computeProjection(metrics);
    const second = computeProjection(metrics);
    const third = computeProjection({ ...metrics });
    assert.deepStrictEqual(
      first,
      second,
      `dpr=${dpr} zoom=${zoom} viewport=${viewport}: reconcile 必须幂等`
    );
    assert.deepStrictEqual(
      first,
      third,
      `dpr=${dpr} zoom=${zoom} viewport=${viewport}: 复制的测量输入必须得到同一投影`
    );
    assertProjectionShape(first, metrics, `dpr=${dpr} zoom=${zoom} viewport=${viewport}`);
  }

  assert.equal(cases.length, DPR_MATRIX.length * ZOOM_MATRIX.length * VIEWPORT_MATRIX.length);
}

// --- 3. 无滞后：读取顺序不影响最终结果（刷新 / resize / DevTools 往返） ----
{
  const wide = buildMetrics({ viewport: 985.6, deviceScale: 1.875, zoom: 1.5 });
  const narrow = buildMetrics({ viewport: 640, deviceScale: 1.875, zoom: 1.5 });

  const wideFirst = computeProjection(wide);
  const narrowProjection = computeProjection(narrow);
  assert.equal(
    narrowProjection.showOverflow,
    true,
    "真正空间不足时必须仍然进入“更多”"
  );
  const wideAgain = computeProjection(buildMetrics({ viewport: 985.6, deviceScale: 1.875, zoom: 1.5 }));
  assert.deepStrictEqual(
    wideAgain,
    wideFirst,
    "宽度恢复后必须回到与最初完全一致的投影（无滞后）"
  );

  const postNarrowWide = computeProjection({ ...wide });
  assert.deepStrictEqual(postNarrowWide, wideFirst);
}

// --- 4. 真正空间不足：进入“更多”且投影仍然自洽 ----------------------------
{
  const metrics = buildMetrics({ viewport: 640, deviceScale: 1.875, zoom: 1.5 });
  const projection = computeProjection(metrics);
  assertProjectionShape(projection, metrics, "genuine shortage");
  assert.ok(
    projection.primaryCount < metrics.itemWidths.length,
    "空间不足时必须有链接进入“更多”"
  );

  const tiny = computeProjection({ ...metrics, availableWidth: 90 });
  assert.equal(tiny.primaryCount, 0, "完全放不下时所有链接都应进入“更多”");
  assert.equal(tiny.showOverflow, true);
}

// --- 5. primaryCount 对可用宽度单调：不会出现“越宽越少” --------------------
{
  const samples = [];
  for (let available = 0; available <= 700; available += 0.25) {
    const metrics = {
      itemWidths: REPORTED_CUSTOM_ITEM_WIDTHS,
      chromeWidth: REPORTED_MANAGER_WIDTH,
      overflowToggleWidth: REPORTED_OVERFLOW_TOGGLE_WIDTH,
      availableWidth: available,
      searchWidth: REPORTED_SEARCH_WIDTH,
      searchToggleWidth: REPORTED_SEARCH_TOGGLE_WIDTH,
    };
    samples.push({
      available,
      primaryCount: computeProjection(metrics).primaryCount,
    });
  }
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(
      samples[index].primaryCount >= samples[index - 1].primaryCount,
      `availableWidth ${samples[index - 1].available} -> ${samples[index].available} 时 primaryCount 不得回退`
    );
  }
}

// --- 6. 亚像素扰动：容差必须吸收舍入误差，而不是被舍入误差触发 ------------
{
  const base = buildMetrics({ viewport: 985.6, deviceScale: 1.875, zoom: 1.5 });
  for (const delta of [-0.5, -0.25, 0, 0.25, 0.5]) {
    const metrics = {
      ...base,
      itemWidths: base.itemWidths.map((width, index) =>
        width + delta * (index % 2 === 0 ? 1 : -1)
      ),
    };
    const projection = computeProjection(metrics);
    assert.equal(
      projection.primaryCount,
      base.itemWidths.length,
      `±${delta}px 的亚像素扰动不得把链接错误推进“更多”`
    );
  }

  // 明显超过量化容差的缺口必须被识别。
  const clearlyShort = { ...base, availableWidth: base.availableWidth - 20 };
  assert.equal(computeProjection(clearlyShort).showOverflow, true);
}

// --- 7. 字体延迟：宽度变化后重新决策，且可回到初始投影 --------------------
{
  const defaultFont = buildMetrics({
    viewport: 985.6,
    deviceScale: 1.875,
    zoom: 1.5,
    itemWidths: REPORTED_CUSTOM_ITEM_WIDTHS,
  });
  const fallbackFont = buildMetrics({
    viewport: 985.6,
    deviceScale: 1.875,
    zoom: 1.5,
    itemWidths: REPORTED_CUSTOM_ITEM_WIDTHS.map((width) => width * 1.12),
  });

  const before = computeProjection(defaultFont);
  const duringFallback = computeProjection(fallbackFont);
  assert.equal(
    duringFallback.showOverflow,
    true,
    "字体回退导致宽度明显变大时必须重新决策"
  );
  const after = computeProjection(buildMetrics({
    viewport: 985.6,
    deviceScale: 1.875,
    zoom: 1.5,
    itemWidths: REPORTED_CUSTOM_ITEM_WIDTHS,
  }));
  assert.deepStrictEqual(
    after,
    before,
    "字体加载完成后必须回到与初始一致的投影"
  );
}

// --- 8. 搜索 compact：折叠释放的宽度计入同一预算 --------------------------
{
  const narrowSearch = {
    itemWidths: REPORTED_CUSTOM_ITEM_WIDTHS,
    chromeWidth: REPORTED_MANAGER_WIDTH,
    overflowToggleWidth: REPORTED_OVERFLOW_TOGGLE_WIDTH,
    availableWidth: 300,
    searchWidth: 100,
    searchToggleWidth: 46,
  };
  const collapsed = computeProjection(narrowSearch);
  assert.equal(collapsed.searchCollapsed, true, "搜索栏低于下限时必须收缩为文字入口");
  assert.equal(
    collapsed.rowBudget,
    300 + 100 - 46,
    "折叠搜索释放的宽度必须计入同一份预算"
  );

  const expanded = computeProjection({ ...narrowSearch, searchWidth: 260 });
  assert.equal(expanded.searchCollapsed, false, "搜索栏宽度足够时不得收缩");
  assert.equal(expanded.rowBudget, 300);

  // 无法取得入口宽度时不得高估释放宽度。
  const unknownToggle = computeProjection({
    ...narrowSearch,
    searchToggleWidth: null,
  });
  assert.equal(unknownToggle.rowBudget, 300);
}

// --- 9. 空记录 / 单链接边界 -------------------------------------------------
{
  const empty = computeProjection({
    itemWidths: [],
    chromeWidth: 20,
    overflowToggleWidth: 20,
    availableWidth: 10,
    searchWidth: 200,
    searchToggleWidth: 46,
  });
  assert.equal(empty.primaryCount, 0);
  assert.equal(empty.showOverflow, false, "没有自定义链接时不得显示“更多”");

  const single = computeProjection({
    itemWidths: [45],
    chromeWidth: 100,
    overflowToggleWidth: 46,
    availableWidth: 120,
    searchWidth: 200,
    searchToggleWidth: 46,
  });
  assert.equal(single.primaryCount, 0, "单个链接放不下时必须进入“更多”");
  assert.equal(single.showOverflow, true);
}

// --- 10. 布局策略选择（纯函数） --------------------------------------------
{
  const { resolveNavbarLayoutMode } = runtime.hooks;
  assert.equal(typeof resolveNavbarLayoutMode, "function");
  assert.equal(
    resolveNavbarLayoutMode({ nuxCompact: true, measurable: true }),
    "nux-compact",
    "NUX 窄屏接管优先于常规响应式"
  );
  assert.equal(
    resolveNavbarLayoutMode({ nuxCompact: true, measurable: false }),
    "nux-compact",
    "NUX 窄屏接管优先于未稳定测量"
  );
  assert.equal(
    resolveNavbarLayoutMode({ nuxCompact: false, measurable: true }),
    "responsive"
  );
  assert.equal(
    resolveNavbarLayoutMode({ nuxCompact: false, measurable: false }),
    "unmeasured"
  );
  assert.equal(resolveNavbarLayoutMode({}), "unmeasured");
  assert.equal(resolveNavbarLayoutMode(), "unmeasured");
  assert.equal(
    resolveNavbarLayoutMode({ nuxCompact: false, measurable: undefined }),
    "unmeasured"
  );
}

// --- 11. 盒子测量（readNavbarBoxWidth） ------------------------------------
{
  const { readNavbarBoxWidth } = runtime.hooks;
  assert.equal(typeof readNavbarBoxWidth, "function");

  class UnitBox {
    constructor({
      width = 0,
      height = 0,
      margin = 0,
      padding = 0,
      border = 0,
      position = "static",
      connected = true,
      withComputedStyle = true,
    } = {}) {
      this.children = [];
      this.parentElement = null;
      this.hidden = false;
      this.isConnected = connected;
      this._width = width;
      this._height = height;
      this._computed = withComputedStyle
        ? {
            marginLeft: `${margin}px`,
            marginRight: `${margin}px`,
            paddingLeft: `${padding}px`,
            paddingRight: `${padding}px`,
            borderLeftWidth: `${border}px`,
            borderRightWidth: `${border}px`,
            position,
          }
        : null;
      this.ownerDocument = {
        defaultView: { getComputedStyle: (element) => element._computed },
      };
    }

    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    getBoundingClientRect() {
      return {
        width: this._width,
        height: this._height,
        left: 0,
        top: 0,
        right: this._width,
        bottom: this._height,
      };
    }
  }
  runtime.sandbox.Element = UnitBox;

  const measured = readNavbarBoxWidth(
    new UnitBox({ width: 100, height: 20, margin: 4, padding: 6, border: 2 })
  );
  assert.equal(measured.inlineWidth, 108, "外框宽度必须计入左右外边距");
  assert.equal(
    measured.contentWidth,
    84,
    "内容宽度必须扣除左右内边距与边框"
  );
  assert.equal(measured.paddingInline, 12);
  assert.equal(measured.borderInline, 4);

  assert.equal(
    readNavbarBoxWidth(new UnitBox({ width: 100, height: 0 })),
    null,
    "没有高度（未参与布局）必须返回 null 而不是 0"
  );
  assert.equal(
    readNavbarBoxWidth(new UnitBox({ width: 0, height: 20 })),
    null,
    "没有宽度必须返回 null"
  );
  assert.equal(
    readNavbarBoxWidth(new UnitBox({ width: 100, height: 20, connected: false })),
    null,
    "未附加到文档的盒子必须返回 null"
  );
  assert.equal(readNavbarBoxWidth(null), null);
  assert.equal(readNavbarBoxWidth({}), null, "非 Element 必须返回 null");

  const withoutComputed = readNavbarBoxWidth(
    new UnitBox({
      width: 100,
      height: 20,
      margin: 10,
      padding: 10,
      withComputedStyle: false,
    })
  );
  assert.equal(
    withoutComputed.inlineWidth,
    100,
    "取不到 computed style 时不得臆造外边距"
  );
  assert.equal(withoutComputed.contentWidth, 100);

  const absolute = new UnitBox({ width: 100, height: 20, position: "absolute" });
  assert.equal(readNavbarBoxWidth(absolute, { inFlow: true }), null);
  assert.ok(readNavbarBoxWidth(absolute), "非 inFlow 场景仍可正常测量");

  // 11b. 可用宽度测量（measureNavbarAvailableWidth）
  const { measureNavbarAvailableWidth } = runtime.hooks;
  assert.equal(typeof measureNavbarAvailableWidth, "function");

  const container = new UnitBox({
    width: 1000,
    height: 40,
    padding: 10,
  });
  const navRow = new UnitBox({ width: 0, height: 40 });
  const fixedA = new UnitBox({ width: 300, height: 40 });
  const fixedB = new UnitBox({ width: 200, height: 40 });
  const hiddenSibling = new UnitBox({ width: 50, height: 40 });
  hiddenSibling.hidden = true;
  const absoluteSibling = new UnitBox({
    width: 500,
    height: 40,
    position: "absolute",
  });
  const collapsedSibling = new UnitBox({ width: 0, height: 0 });
  container.appendChild(navRow);
  container.appendChild(fixedA);
  container.appendChild(fixedB);
  container.appendChild(hiddenSibling);
  container.appendChild(absoluteSibling);
  container.appendChild(collapsedSibling);

  const firstPartition = measureNavbarAvailableWidth({
    element: navRow,
    container,
  });
  assert.equal(
    firstPartition.availableWidth,
    480,
    "可用宽度 = 容器内容宽 − 固定兄弟盒子（跳过 hidden / 绝对定位 / 无高度）"
  );
  assert.equal(
    firstPartition.containerWidth,
    980,
    "契约必须暴露容器内容宽度（1000 − 左右各 10 padding）"
  );
  assert.equal(
    firstPartition.fixedRegionWidth,
    500,
    "契约必须暴露固定保留区域宽度（仅统计真正参与布局的兄弟）"
  );

  const outer = new UnitBox({ width: 800, height: 40 });
  const mid = new UnitBox({ width: 400, height: 40, padding: 8 });
  const outerSibling = new UnitBox({ width: 100, height: 40 });
  const nestedRow = new UnitBox({ width: 0, height: 40 });
  outer.appendChild(mid);
  outer.appendChild(outerSibling);
  mid.appendChild(nestedRow);
  const nestedPartition = measureNavbarAvailableWidth({
    element: nestedRow,
    container: outer,
  });
  assert.equal(
    nestedPartition.availableWidth,
    800 - 16 - 100,
    "沿途祖先的内边距必须从可用宽度中扣除"
  );
  assert.equal(
    nestedPartition.fixedRegionWidth,
    116,
    "契约中的固定区域必须包含祖先内边距"
  );

  const stranger = new UnitBox({ width: 0, height: 40 });
  assert.equal(
    measureNavbarAvailableWidth({ element: stranger, container }),
    null,
    "container 不是祖先时必须返回 null（未知），而不是猜一个宽度"
  );

  const tiny = new UnitBox({ width: 10, height: 40 });
  const tinyRow = new UnitBox({ width: 0, height: 40 });
  const hugeSibling = new UnitBox({ width: 900, height: 40 });
  tiny.appendChild(tinyRow);
  tiny.appendChild(hugeSibling);
  assert.equal(
    measureNavbarAvailableWidth({ element: tinyRow, container: tiny })
      .availableWidth,
    0,
    "过度占用时可用宽度必须夹到 0"
  );

  // 恢复沙箱 Element，避免影响后续断言。
  runtime.sandbox.Element = function Element() {};
}

// --- 12. epsilon 边界：只吸收 rounding noise，不隐藏真实缺口 -----------------
{
  const { navbarLayoutEpsilonPx } = runtime.hooks;
  assert.equal(
    navbarLayoutEpsilonPx,
    2,
    "epsilon 是固定的布局量化单位，不得被悄悄放大"
  );

  const baseMetrics = {
    itemWidths: [100],
    chromeWidth: 0,
    overflowToggleWidth: 0,
    searchWidth: 200,
    searchToggleWidth: 46,
  };
  const cases = [
    { deficit: 0, expectOverflow: false },
    { deficit: 0.5, expectOverflow: false },
    { deficit: 1, expectOverflow: false },
    { deficit: 2, expectOverflow: false },
    { deficit: 2.1, expectOverflow: true },
    { deficit: 3, expectOverflow: true },
    { deficit: 5, expectOverflow: true },
  ];
  for (const { deficit, expectOverflow } of cases) {
    const projection = computeProjection({
      ...baseMetrics,
      availableWidth: 100 - deficit,
    });
    assert.equal(
      projection.showOverflow,
      expectOverflow,
      `required - available = ${deficit} 时 showOverflow 必须为 ${expectOverflow}`
    );
    assert.equal(
      projection.primaryCount,
      expectOverflow ? 0 : 1,
      `required - available = ${deficit} 时 primaryCount 必须为 ${expectOverflow ? 0 : 1}`
    );
  }
}

// --- 13. 单次 decision 同时决定 search compact 与 overflow -------------------
{
  const collapsedInput = {
    itemWidths: [40, 40],
    chromeWidth: 20,
    overflowToggleWidth: 20,
    availableWidth: 40,
    searchWidth: 100,
    searchToggleWidth: 46,
  };
  const collapsedOnce = computeProjection(collapsedInput);
  assert.equal(collapsedOnce.searchCollapsed, true);
  assert.equal(
    collapsedOnce.primaryCount,
    1,
    "折叠搜索释放的宽度必须在同一次 projection 内就参与 overflow 计算"
  );

  const expandedInput = { ...collapsedInput, searchWidth: 300 };
  const expanded = computeProjection(expandedInput);
  assert.equal(expanded.searchCollapsed, false);
  assert.equal(
    expanded.primaryCount,
    0,
    "搜索重新展开后必须在同一次 projection 内重新收缩导航"
  );

  // 交替输入不得产生振荡记忆：结果只取决于当前 metrics，与执行历史无关。
  for (let index = 0; index < 20; index += 1) {
    const searchWidth = index % 2 === 0 ? 100 : 300;
    const projection = computeProjection({ ...collapsedInput, searchWidth });
    assert.deepStrictEqual(
      projection,
      searchWidth === 100 ? collapsedOnce : expanded,
      `第 ${index} 轮交替输入必须与同输入首次计算完全一致`
    );
  }

  // 反向顺序同样必须一致（先展开再折叠）。
  for (let index = 0; index < 20; index += 1) {
    const searchWidth = index % 2 === 0 ? 300 : 100;
    const projection = computeProjection({ ...collapsedInput, searchWidth });
    assert.deepStrictEqual(
      projection,
      searchWidth === 100 ? collapsedOnce : expanded,
      `反向第 ${index} 轮交替输入必须与同输入首次计算完全一致`
    );
  }
}

console.log(
  "[navbar-responsive-layout-model] DPI / zoom / viewport matrix, idempotency, hysteresis-free and search-compact contracts verified."
);
