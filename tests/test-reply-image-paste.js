#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const { createHarness, toPlainObject } = require("./s1plus-test-helpers");

const { hooks } = createHarness({
  hookErrorMessage: "未能从 S1Plus.js 暴露回复弹窗图片粘贴测试 seam。",
});
const api = hooks.s1pReplyImagePasteTest;
assert.ok(api, "缺少 s1pReplyImagePasteTest 测试 seam。");

const fastpostConfigText = `var upload = new SWFUpload({
  upload_url: "https://stage1st.com/2b/misc.php?mod=swfupload&action=swfupload&operation=upload&fid=157",
  post_params: {"uid" : "425635", "hash":"09d6fd99560fa3e01f7d29d2877758e8"},
  file_size_limit : "2048",
  custom_settings : { uploadSource: 'forum', uploadType: 'attach', uploadFrom: 'fastpost' }
});`;

const parsedConfig = api.parseUploadConfig(fastpostConfigText);
assert.deepEqual(toPlainObject(parsedConfig), {
  uploadUrl:
    "https://stage1st.com/2b/misc.php?mod=swfupload&action=swfupload&operation=upload&fid=157",
  uid: "425635",
  hash: "09d6fd99560fa3e01f7d29d2877758e8",
  maxSizeKb: 2048,
  isFastpost: true,
});

const advancedConfigText = `var upload = new SWFUpload({
  upload_url: "https://stage1st.com/2b/misc.php?mod=swfupload&action=swfupload&operation=upload&fid=157",
  post_params: {"uid":"425635", "hash":"09d6fd99560fa3e01f7d29d2877758e8"},
  file_size_limit : "2048",
  custom_settings : { uploadSource: 'forum', uploadType: 'attach' }
});`;
const advancedConfig = api.parseUploadConfig(advancedConfigText);
assert.equal(advancedConfig.isFastpost, false, "高级编辑器配置不标记 fastpost。");
assert.equal(advancedConfig.uid, "425635");
assert.equal(advancedConfig.hash, "09d6fd99560fa3e01f7d29d2877758e8");
assert.equal(advancedConfig.maxSizeKb, 2048);
assert.equal(
  api.parseUploadConfig(
    fastpostConfigText.replace("09d6fd99560fa3e01f7d29d2877758e8", "abc")
  ),
  null,
  "过短或非法的 hash 不应被采用。"
);
assert.equal(api.parseUploadConfig(""), null);
assert.equal(api.parseUploadConfig(null), null);

assert.equal(
  api.resolveUploadUrl(
    "https://stage1st.com/2b/misc.php?mod=swfupload&action=swfupload&operation=upload&fid=157",
    "https://stage1st.com/2b/forum.php?mod=viewthread&tid=1"
  ),
  "https://stage1st.com/2b/misc.php?mod=swfupload&action=swfupload&operation=upload&fid=157",
  "同源 swfupload 地址应被接受。"
);
assert.equal(
  api.resolveUploadUrl(
    "https://evil.example/2b/misc.php?mod=swfupload",
    "https://stage1st.com/2b/forum.php"
  ),
  "",
  "跨域地址必须拒绝。"
);
assert.equal(
  api.resolveUploadUrl(
    "https://stage1st.com/2b/forum.php",
    "https://stage1st.com/2b/forum.php"
  ),
  "",
  "非 misc.php 地址必须拒绝。"
);
assert.equal(
  api.resolveUploadUrl(
    "https://stage1st.com/2b/misc.php?mod=attach&action=upload",
    "https://stage1st.com/2b/forum.php"
  ),
  "",
  "非 swfupload 操作必须拒绝。"
);
assert.equal(
  api.resolveUploadUrl("::not-a-url::", "https://stage1st.com/2b/forum.php"),
  "",
  "非法 URL 必须拒绝。"
);

assert.equal(
  api.deriveImageExtension({ type: "image/png", name: "image.png" }),
  "png"
);
assert.equal(
  api.deriveImageExtension({ type: "image/jpeg", name: "image.jpeg" }),
  "jpg"
);
assert.equal(
  api.deriveImageExtension({ type: "image/jpg", name: "image.jpg" }),
  "jpg"
);
assert.equal(
  api.deriveImageExtension({ type: "image/webp", name: "" }),
  "webp"
);
assert.equal(
  api.deriveImageExtension({ type: "", name: "screenshot.PNG" }),
  "png",
  "无 MIME 时应回退到安全扩展名。"
);
assert.equal(api.deriveImageExtension({ type: "image/gif" }), "gif");
assert.equal(
  api.deriveImageExtension({ type: "application/pdf", name: "a.pdf" }),
  "",
  "非图片扩展名不应被接受。"
);

const pngFile = { name: "image.png", type: "image/png", size: 981 };
const jpegFile = { name: "image.jpg", type: "image/jpeg", size: 1200 };
const textFile = { name: "note.txt", type: "text/plain", size: 10 };
const tiffFile = { name: "scan.tiff", type: "image/tiff", size: 20 };
const collected = api.collectClipboardImageFiles({
  items: [
    { kind: "string", type: "text/plain", getAsFile: () => null },
    { kind: "file", type: "image/png", getAsFile: () => pngFile },
    { kind: "file", type: "image/jpeg", getAsFile: () => jpegFile },
    { kind: "file", type: "text/plain", getAsFile: () => textFile },
    { kind: "file", type: "image/tiff", getAsFile: () => tiffFile },
    { kind: "file", type: "image/png", getAsFile: () => null },
  ],
});
assert.deepEqual(
  toPlainObject(collected.map((entry) => [entry.file.name, entry.extension])),
  [
    ["image.png", "png"],
    ["image.jpg", "jpg"],
    ["scan.tiff", ""],
  ],
  "应只收集图片文件，无法识别扩展名的图片保留空扩展名交给后续提示。"
);
assert.deepEqual(toPlainObject(api.collectClipboardImageFiles(null)), []);
assert.deepEqual(toPlainObject(api.collectClipboardImageFiles({ items: [] })), []);

assert.deepEqual(toPlainObject(api.buildUploadFields(parsedConfig, "png")), {
  uid: "425635",
  hash: "09d6fd99560fa3e01f7d29d2877758e8",
  filetype: "png",
}, "上传字段应与快速回复附件上传器一致，不携带 type=image。");

assert.equal(
  api.describeUploadFailure("-1", 200),
  "内部服务器错误"
);
assert.equal(
  api.describeUploadFailure("-2", 200),
  "服务器限制无法上传那么大的附件"
);
assert.equal(
  api.describeUploadFailure("-11", 200),
  "今日您已无法上传那么大的附件"
);
assert.equal(
  api.describeUploadFailure("-13", 200),
  "服务器限制无法上传分辨率过高的附件"
);
assert.equal(
  api.describeUploadFailure("-9", 200),
  "没有合法的文件被上传"
);
assert.match(api.describeUploadFailure("-99", 200), /错误码 99/);
assert.equal(api.describeUploadFailure("oops", 502), "上传请求失败（HTTP 502）");
assert.equal(api.describeUploadFailure("oops", 200), "图片上传失败，请稍后重试");

const createTextarea = (value, start, end) => ({
  value,
  selectionStart: start,
  selectionEnd: end,
  setRangeText(text, rangeStart, rangeEnd) {
    this.value =
      this.value.slice(0, rangeStart) + text + this.value.slice(rangeEnd);
    this.selectionStart = this.selectionEnd = rangeStart + text.length;
  },
  dispatchEvent() {},
});

const tag = "[attachimg]123[/attachimg]";
const textarea = createTextarea("AB", 1, 1);
assert.equal(api.insertAttachTag(textarea, 123, { start: 1, end: 1 }), tag);
assert.equal(textarea.value, `A${tag}B`);
assert.equal(textarea.selectionStart, 1 + tag.length);
assert.equal(textarea.selectionEnd, 1 + tag.length);

const selectedTextarea = createTextarea("hello world", 0, 5);
api.insertAttachTag(selectedTextarea, 456, { start: 0, end: 5 });
assert.equal(selectedTextarea.value, `[attachimg]456[/attachimg] world`);

const fallbackTextarea = createTextarea("XY", 2, 2);
fallbackTextarea.setRangeText = undefined;
fallbackTextarea.setSelectionRange = function (start, end) {
  this.selectionStart = start;
  this.selectionEnd = end;
};
api.insertAttachTag(fallbackTextarea, 789, { start: 2, end: 2 });
assert.equal(fallbackTextarea.value, `XY[attachimg]789[/attachimg]`);
assert.equal(fallbackTextarea.selectionStart, fallbackTextarea.value.length);

const createdInputs = [];
const fakeDocument = {
  createElement(tagName) {
    return {
      tagName,
      type: "",
      name: "",
      value: "",
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
  },
};
const fakeForm = {
  _inputs: [],
  querySelector(selector) {
    const match = /name="([^"]+)"/.exec(selector);
    if (!match) return null;
    return this._inputs.find((input) => input.name === match[1]) || null;
  },
  appendChild(input) {
    const name = input.name;
    this._inputs.push(input);
    createdInputs.push(name);
  },
};
assert.equal(
  api.ensureAttachFields(fakeForm, 77, fakeDocument),
  true,
  "首次应创建 attachnew 字段。"
);
assert.deepEqual(fakeForm._inputs.map((input) => input.name), [
  "attachnew[77][description]",
  "attachnew[77][readperm]",
  "attachnew[77][price]",
]);
assert.equal(
  fakeForm._inputs[0].attributes["data-s1p-reply-paste-attachnew"],
  "77"
);
assert.equal(
  api.ensureAttachFields(fakeForm, 77, fakeDocument),
  false,
  "重复调用不应重复创建字段。"
);
assert.equal(fakeForm._inputs.length, 3);
assert.equal(api.ensureAttachFields(fakeForm, 0, fakeDocument), false);
assert.equal(api.ensureAttachFields(null, 88, fakeDocument), false);

assert.equal(api.initialize(), true, "首次初始化应返回 true。");
assert.equal(api.initialize(), false, "重复初始化应保持幂等。");

const advancedApi = hooks.s1pAdvancedEditorImagePasteTest;
assert.ok(advancedApi, "缺少高级编辑器图片粘贴测试 seam。");
assert.equal(
  advancedApi.extractPreviewSrc(
    '<div><img src="forum.php?mod=image&amp;aid=1&amp;size=300x300" id="image_2164002" /></div>',
    2164002
  ),
  "forum.php?mod=image&aid=1&size=300x300",
  "应能从附件列表 HTML 中提取图片预览地址并还原实体。"
);
assert.equal(
  advancedApi.extractPreviewSrc(
    '<img id="image_7" src="/2b/forum.php?mod=image&amp;aid=7" />',
    7
  ),
  "/2b/forum.php?mod=image&aid=7"
);
assert.equal(
  advancedApi.extractPreviewSrc('<img id="image_8" />', 8),
  "",
  "没有预览图时应返回空字符串。"
);
assert.equal(
  advancedApi.initialize(),
  false,
  "非高级编辑器页面不应初始化该补丁。"
);

const referenced = api.collectReferencedAidsFromText(
  "A[attachimg]11[/attachimg] B [attachimg]22[/attachimg]"
);
assert.deepEqual([...referenced].sort(), ["11", "22"]);

assert.equal(api.needsCompression({ size: 100 }, { maxSizeKb: 2048 }), false);
assert.equal(
  api.needsCompression({ size: 2048 * 1024 + 1 }, { maxSizeKb: 2048 }),
  true
);
assert.equal(api.getMaxSizeBytes({}), 2048 * 1024);
assert.equal(api.getMaxSizeBytes({ maxSizeKb: 1024 }), 1024 * 1024);

const markedInput = (aid, removed) => ({
  _removed: removed,
  getAttribute(name) {
    return name === "data-s1p-reply-paste-attachnew" ? String(aid) : null;
  },
  remove() {
    this._removed = true;
  },
});
const keptInput = markedInput(11, false);
const removedInput = markedInput(22, false);
const foreignInput = {
  getAttribute() {
    return null;
  },
  remove() {
    throw new Error("不应删除非 S1Plus 字段");
  },
};
const fakeReconcileForm = {
  querySelectorAll(selector) {
    assert.equal(selector, "input[data-s1p-reply-paste-attachnew]");
    return [keptInput, removedInput, foreignInput];
  },
};
api.reconcileMarkedAttachFields(
  fakeReconcileForm,
  api.collectReferencedAidsFromText("[attachimg]11[/attachimg]")
);
assert.equal(keptInput._removed, false, "被引用 aid 的字段应保留。");
assert.equal(removedInput._removed, true, "未引用 aid 的字段应删除。");

const recycleApi = hooks.s1pPasteAttachRecycleTest;
assert.ok(recycleApi, "缺少粘贴附件回收测试 seam。");

assert.equal(
  recycleApi.stripTagFromText(
    "A[attachimg]11[/attachimg]B[attachimg]11[/attachimg]C",
    "11"
  ),
  "ABC",
  "应删除文本中所有指向同一 aid 的附件标记。"
);
assert.equal(
  recycleApi.stripTagFromText("[attachimg]22[/attachimg]", "11"),
  "[attachimg]22[/attachimg]",
  "不应影响其他 aid 的标记。"
);

assert.equal(
  recycleApi.buildDeleteUrl("123", "45", "678"),
  "forum.php?mod=ajax&action=deleteattach&inajax=yes&tid=45&pid=678&aids[]=123"
);
assert.equal(
  recycleApi.buildDeleteUrl(7, "x", undefined),
  "forum.php?mod=ajax&action=deleteattach&inajax=yes&tid=0&pid=0&aids[]=7",
  "非法 tid/pid 应回退到 0，aid 应归一化为数字。"
);

assert.equal(
  recycleApi.parseDeleteCount(
    '<?xml version="1.0" encoding="utf-8"?>\n<root><![CDATA[1]]></root>'
  ),
  1,
  "应能从 ajax 包裹里解析删除数量。"
);
assert.equal(recycleApi.parseDeleteCount("0"), 0);
assert.ok(
  Number.isNaN(recycleApi.parseDeleteCount("<root><![CDATA[]]></root>")),
  "非数字响应应返回 NaN 而不是 0。"
);

assert.equal(recycleApi.markOwnedAid(0), false, "非法 aid 不应登记。");
assert.equal(recycleApi.markOwnedAid("abc"), false);
assert.equal(recycleApi.markOwnedAid(42), true);
assert.deepEqual(toPlainObject(recycleApi.getOwnedAids()), ["42"]);
recycleApi.settle();
assert.deepEqual(
  toPlainObject(recycleApi.getOwnedAids()),
  [],
  "提交后应清空待回收集合。"
);
assert.deepEqual(
  toPlainObject(recycleApi.getSettledAids()),
  ["42"],
  "提交后应转入已结算集合。"
);
assert.equal(
  recycleApi.markOwnedAid(42),
  false,
  "已结算的 aid 不应重新进入待回收集合。"
);

assert.equal(
  recycleApi.initialize(),
  false,
  "回复弹窗补丁已注册回收监听，重复初始化不应再注册。"
);
assert.equal(recycleApi.initialize(), false, "重复初始化应保持幂等。");
assert.equal(recycleApi.getRecycleDelayMs(), 1200);
recycleApi.reconcile("reply-popup");
recycleApi.reconcile("advanced-editor");

// 回收链路的集成校验：只用一个假的弹窗 DOM + 假 fetch，验证解绑、确认两轮与请求形态。
const { sandbox } = createHarness();
const liveApi = sandbox.__S1P_TEST_HOOKS__.s1pPasteAttachRecycleTest;
const fetchCalls = [];
const removedFieldAids = [];
const liveTextarea = { value: "", selectionStart: 0, selectionEnd: 0 };
const liveForm = {
  querySelector(selector) {
    if (selector === 'input[name="tid"]') return { value: "45" };
    if (selector === 'input[name="pid"]') return { value: "" };
    return null;
  },
  querySelectorAll() {
    return removedFieldAids.map((aid) => ({
      getAttribute: () => String(aid),
      remove: () => {},
    }));
  },
};
liveTextarea.form = liveForm;
const livePopup = {
  contains: (node) => node === liveTextarea,
  querySelector: (selector) =>
    selector === "#postmessage" || selector === "#postform" ? liveTextarea : null,
};
sandbox.document.getElementById = (id) =>
  id === "fwin_content_reply" ? livePopup : null;
sandbox.fetch = async (url) => {
  fetchCalls.push(String(url));
  return {
    ok: true,
    status: 200,
    text: async () => '<?xml version="1.0" encoding="utf-8"?>\n<root><![CDATA[1]]></root>',
  };
};

(async () => {
  removedFieldAids.push("555");
  liveApi.markOwnedAid(555);
  liveApi.reconcile("reply-popup");
  assert.equal(
    fetchCalls.length,
    0,
    "第一轮只记录未引用状态，不应立即删除附件。"
  );

  liveApi.reconcile("reply-popup", { confirmed: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls.length, 1, "确认轮应发出一次删除请求。");
  assert.equal(
    fetchCalls[0],
    "forum.php?mod=ajax&action=deleteattach&inajax=yes&tid=45&pid=0&aids[]=555",
    "删除请求应带上表单 tid/pid 与 aid。"
  );
  assert.deepEqual(toPlainObject(liveApi.getDeletedAids()), ["555"]);
  assert.deepEqual(toPlainObject(liveApi.getOwnedAids()), []);

  liveTextarea.value = "A[attachimg]555[/attachimg]B";
  liveApi.reconcile("reply-popup");
  assert.equal(
    liveTextarea.value,
    "AB",
    "已删除附件若重新出现在文本里，应清掉失效标记。"
  );

  liveApi.markOwnedAid(666);
  liveTextarea.value = "[attachimg]666[/attachimg]";
  liveApi.reconcile("reply-popup", { confirmed: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls.length, 1, "仍被引用的附件不应被删除。");

  liveApi.settle();
  console.log("test-reply-image-paste: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
