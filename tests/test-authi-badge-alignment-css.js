#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { cssSource } = require("./s1plus-test-helpers");

// S1 Plus 接管楼层头部后 .authi 带 overflow:hidden；S1 NUX 的徽章
// ::before 自带 margin-top:-6px，会把 28px 的徽章顶部裁掉 6px。
assert.match(
  cssSource,
  /#postlist \.plc \.pi\.s1p-authi-layout \.authi\.s1p-authi-layout::before \{[^}]*margin-top:\s*0/,
  "脚本接管布局时应取消 NUX 徽章的 -6px 负边距。"
);
assert.match(
  cssSource,
  /#postlist \.plc \.authi\.s1p-authi-layout \{[\s\S]*?overflow:\s*hidden/,
  "该覆盖的前提仍是 .authi 的 overflow:hidden 裁切布局。"
);
assert.ok(
  !/(?:^|\n)\s*\.authi::before\s*\{[^}]*margin-top:\s*0/.test(cssSource),
  "覆盖必须限定在 .s1p-authi-layout 内，不能影响未接管布局的楼层。"
);

console.log("[authi-badge-alignment-css] NUX badge offset override verified.");
