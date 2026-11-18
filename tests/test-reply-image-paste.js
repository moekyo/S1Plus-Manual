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

// 快速回复框：只有超过论坛限制的粘贴才由脚本接管，正常大小继续走论坛原生上传器。
assert.equal(
  api.shouldTakeOverQuickReply([{ file: { size: 100 } }], parsedConfig),
  false,
  "未超过论坛限制的图片不应被接管。"
);
assert.equal(
  api.shouldTakeOverQuickReply(
    [{ file: { size: 2048 * 1024 } }],
    parsedConfig
  ),
  false,
  "刚好等于限制的图片不应被接管。"
);
assert.equal(
  api.shouldTakeOverQuickReply(
    [{ file: { size: 2048 * 1024 + 1 } }],
    parsedConfig
  ),
  true,
  "超过论坛限制的图片应被接管（压缩后再上传）。"
);
assert.equal(
  api.shouldTakeOverQuickReply(
    [{ file: { size: 100 } }, { file: { size: 2048 * 1024 + 1 } }],
    parsedConfig
  ),
  true,
  "多图粘贴只要有一张超限，整次粘贴都应走脚本上传队列。"
);
assert.equal(
  api.shouldTakeOverQuickReply(
    [{ file: { size: 2048 * 1024 + 1 } }],
    null
  ),
  false,
  "读不到论坛上传配置时不应接管。"
);
assert.equal(api.shouldTakeOverQuickReply([], parsedConfig), false);
assert.equal(
  api.shouldTakeOverQuickReply(
    [{ file: { size: 2048 * 1024 + 1 } }],
    { maxSizeKb: 0 }
  ),
  false,
  "论坛限制未知（maxSizeKb<=0）时不应接管，避免用默认 2048 KB 误判。"
);
assert.equal(
  api.shouldTakeOverQuickReply([{ file: { size: 2048 * 1024 + 1 } }], {}),
  false
);

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
  recycleApi.buildDeleteUrl("123", "45", "678", "abcd1234"),
  "forum.php?mod=ajax&action=deleteattach&inajax=yes&formhash=abcd1234&tid=45&pid=678&aids[]=123",
  "带 formhash 时应与论坛 appendAttachDel 的请求形态一致。"
);
assert.equal(
  recycleApi.buildDeleteUrl("123", "45", "678", "bad hash!"),
  "forum.php?mod=ajax&action=deleteattach&inajax=yes&tid=45&pid=678&aids[]=123",
  "非法 formhash 不应拼进删除请求。"
);
assert.match(
  recycleApi.buildDeleteUrl("123", "45", "678", "abcd"),
  /&formhash=abcd&/,
  "4 位 formhash（最小长度）应被接受。"
);
assert.equal(
  recycleApi.buildDeleteUrl("123", "45", "678", "abc"),
  "forum.php?mod=ajax&action=deleteattach&inajax=yes&tid=45&pid=678&aids[]=123",
  "3 位 formhash（低于最小长度）不应拼进删除请求。"
);
assert.equal(
  recycleApi.buildDeleteUrl("123", "45", "678", "abcdefghijklmnopq"),
  "forum.php?mod=ajax&action=deleteattach&inajax=yes&tid=45&pid=678&aids[]=123",
  "17 位 formhash（超过最大长度）不应拼进删除请求。"
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
    if (selector === 'input[name="formhash"]') return { value: "ab12cd34" };
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
    "forum.php?mod=ajax&action=deleteattach&inajax=yes&formhash=ab12cd34&tid=45&pid=0&aids[]=555",
    "删除请求应带上表单 formhash、tid/pid 与 aid。"
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

  // 快速回复框：目标识别 + 附件回收 scope（不能回收弹窗里的附件）。
  const { sandbox: quickReplySandbox } = createHarness();
  const quickReplyTextarea = {
    id: "fastpostmessage",
    isConnected: true,
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
  };
  const quickReplyForm = {
    id: "fastpostform",
    contains: (node) => node === quickReplyTextarea,
    querySelector(selector) {
      if (selector === 'input[name="formhash"]') return { value: "9f8e7d6c" };
      return null;
    },
    appendChild(node) {
      this.appended = this.appended || [];
      this.appended.push(node);
    },
  };
  quickReplyTextarea.form = quickReplyForm;
  const quickReplyDocument = quickReplySandbox.document;
  const quickReplyGetElementById = quickReplyDocument.getElementById;
  quickReplyDocument.getElementById = (id) => {
    if (id === "fastpostmessage") return quickReplyTextarea;
    if (id === "fastpostform") return quickReplyForm;
    return quickReplyGetElementById(id);
  };
  const quickReplyApi =
    quickReplySandbox.__S1P_TEST_HOOKS__.s1pReplyImagePasteTest;
  assert.equal(
    quickReplyApi.findQuickReplyTextarea({
      closest: (selector) =>
        selector === "textarea" ? quickReplyTextarea : null,
    }),
    quickReplyTextarea,
    "应能识别 #fastpostmessage 粘贴目标。"
  );
  assert.equal(
    quickReplyApi.findQuickReplyTextarea({
      closest: () => ({ id: "postmessage" }),
    }),
    null,
    "非快速回复框的 textarea 不应被识别。"
  );
  assert.equal(
    quickReplyApi.isQuickReplyAlive(quickReplyTextarea),
    true,
    "可见的快速回复框应视为存活。"
  );
  quickReplyTextarea.isConnected = false;
  assert.equal(
    quickReplyApi.isQuickReplyAlive(quickReplyTextarea),
    false,
    "断开的目标不应视为存活。"
  );
  quickReplyTextarea.isConnected = true;
  assert.equal(
    quickReplyApi.isQuickReplyAlive({
      id: "fastpostmessage",
      isConnected: true,
      form: { contains: () => true },
      getClientRects: () => [],
    }),
    false,
    "不可见的快速回复框不应视为存活。"
  );
  assert.equal(
    quickReplyApi.isQuickReplyAlive({
      id: "fastpostmessage",
      isConnected: true,
      form: { contains: () => false },
    }),
    false,
    "不在快速回复表单内的 textarea 不应视为存活。"
  );

  // 抓取真实注册的事件监听：只直调 handler 的测试无法发现接线被删
  // （paste/click/submit/keydown/input 都必须在初始化时注册）。
  const capturedListeners = {
    paste: [],
    click: [],
    submit: [],
    keydown: [],
    input: [],
  };
  quickReplyDocument.addEventListener = (type, listener) => {
    if (capturedListeners[type]) capturedListeners[type].push(listener);
  };
  assert.equal(
    quickReplyApi.initialize(),
    true,
    "快速回复框所在页面应能初始化粘贴补丁。"
  );
  for (const type of ["paste", "click", "submit", "keydown", "input"]) {
    assert.ok(
      capturedListeners[type].length >= 1,
      `初始化应注册 document 的 ${type} 监听。`
    );
  }
  const getEventListener = (type) =>
    capturedListeners[type][capturedListeners[type].length - 1];

  // 上传提示的 toast 退场计时器不应拖住测试进程。
  quickReplySandbox.setTimeout = () => 0;

  const quickReplyRecycleApi =
    quickReplySandbox.__S1P_TEST_HOOKS__.s1pPasteAttachRecycleTest;
  const quickReplyLoadingApi =
    quickReplySandbox.__S1P_TEST_HOOKS__.s1pImagePasteLoadingTest;

  const quickReplySubmitEvent = (type = "submit", target = quickReplyForm) => ({
    type,
    target,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
  });
  const quickReplySubmitButton = {};
  const quickReplyClickTarget = {
    closest(selector) {
      if (selector === "#postsubmit, #fastpostsubmit") {
        return quickReplySubmitButton;
      }
      if (selector === "form") return quickReplyForm;
      return null;
    },
  };
  const quickReplyShortcutEvent = () => ({
    ctrlKey: true,
    key: "Enter",
    target: {
      closest: (selector) =>
        selector === "textarea" ? quickReplyTextarea : null,
    },
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
  });

  // 上传中：真实的 submit / click / keydown 监听都应拦下。
  quickReplyLoadingApi.getQuickReplyQueue().enqueue({
    file: { size: 2048 * 1024 + 1, type: "image/png" },
    extension: "png",
    textarea: quickReplyTextarea,
    caret: { start: 0, end: 0 },
  });
  assert.equal(quickReplyLoadingApi.getPendingCount(), 1);
  const blockedQuickReplySubmit = quickReplySubmitEvent();
  getEventListener("submit")(blockedQuickReplySubmit);
  assert.equal(
    blockedQuickReplySubmit.prevented,
    true,
    "快速回复框图片上传中提交应被拦截。"
  );
  assert.equal(blockedQuickReplySubmit.stopped, true);
  // 其他输入区（弹窗）没有在途上传时，不应被快速回复队列误拦。
  const popupSubmitWhileQuickUploading = quickReplySubmitEvent("submit", {
    id: "postform",
  });
  getEventListener("submit")(popupSubmitWhileQuickUploading);
  assert.equal(
    popupSubmitWhileQuickUploading.prevented,
    false,
    "弹窗 scope 无在途上传时不应被快速回复的队列拦截。"
  );
  const blockedQuickReplyClick = quickReplySubmitEvent(
    "click",
    quickReplyClickTarget
  );
  getEventListener("click")(blockedQuickReplyClick);
  assert.equal(
    blockedQuickReplyClick.prevented,
    true,
    "上传中点击「发表回复」应被拦截。"
  );
  const blockedQuickReplyShortcut = quickReplyShortcutEvent();
  getEventListener("keydown")(blockedQuickReplyShortcut);
  assert.equal(
    blockedQuickReplyShortcut.prevented,
    true,
    "上传中 Ctrl+Enter 应在按键阶段被拦截（不依赖 submit 事件）。"
  );
  assert.equal(blockedQuickReplyShortcut.stopped, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(quickReplyLoadingApi.getPendingCount(), 0);

  // 空闲：不拦截提交，但提交前要按引用清理未引用的 attachnew 字段。
  const unreferencedAttachInput = {
    removed: false,
    getAttribute: () => "999",
    remove() {
      this.removed = true;
    },
  };
  quickReplyForm.querySelectorAll = (selector) => {
    assert.equal(selector, "input[data-s1p-reply-paste-attachnew]");
    return [unreferencedAttachInput];
  };
  quickReplyTextarea.value = "";
  const idleQuickReplySubmit = quickReplySubmitEvent();
  getEventListener("submit")(idleQuickReplySubmit);
  assert.equal(
    idleQuickReplySubmit.prevented,
    false,
    "空闲时不应拦截快速回复框提交。"
  );
  assert.equal(
    unreferencedAttachInput.removed,
    true,
    "提交前应清理消息里不再引用的 attachnew 字段。"
  );
  const idleQuickReplyClick = quickReplySubmitEvent(
    "click",
    quickReplyClickTarget
  );
  getEventListener("click")(idleQuickReplyClick);
  assert.equal(idleQuickReplyClick.prevented, false);
  const idleQuickReplyShortcut = quickReplyShortcutEvent();
  getEventListener("keydown")(idleQuickReplyShortcut);
  assert.equal(
    idleQuickReplyShortcut.prevented,
    false,
    "空闲时 Ctrl+Enter 应放行给论坛编辑器处理。"
  );

  // 真实粘贴路由：小图不拦截（继续交给论坛原生上传器），非图片粘贴不受影响。
  quickReplySandbox.document.scripts = [
    {
      textContent:
        'var upload = new SWFUpload({upload_url: "https://stage1st.com/2b/misc.php?mod=swfupload&action=swfupload&operation=upload&fid=6", post_params: {"uid":"1","hash":"0123456789abcdef"}, file_size_limit: "2048", custom_settings: { uploadSource: "forum", uploadType: "attach", uploadFrom: "fastpost" }});',
    },
  ];
  const createPasteEvent = (files, closestTarget) => ({
    target: {
      closest: (selector) =>
        selector === "textarea" ? closestTarget : null,
    },
    clipboardData: {
      items: files.map((file) => ({
        kind: "file",
        getAsFile: () => file,
      })),
    },
    defaultPrevented: false,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
  });
  const smallImagePaste = createPasteEvent(
    [{ type: "image/png", name: "a.png", size: 1024 }],
    quickReplyTextarea
  );
  getEventListener("paste")(smallImagePaste);
  assert.equal(
    smallImagePaste.prevented,
    false,
    "未超限的快速回复粘贴不应被拦截，继续交给论坛原生上传器。"
  );
  assert.equal(smallImagePaste.stopped, false);
  const textPaste = createPasteEvent(
    [{ type: "text/plain", name: "a.txt", size: 10 }],
    quickReplyTextarea
  );
  getEventListener("paste")(textPaste);
  assert.equal(textPaste.prevented, false, "普通文本粘贴不应被拦截。");
  const otherTextareaPaste = createPasteEvent(
    [{ type: "image/png", name: "a.png", size: 1024 }],
    { id: "postmessage" }
  );
  getEventListener("paste")(otherTextareaPaste);
  assert.equal(
    otherTextareaPaste.prevented,
    false,
    "非快速回复框的粘贴不应被拦截。"
  );

  // 超限粘贴：整次粘贴被接管，多图全部入队。
  const oversizedPaste = createPasteEvent(
    [
      { type: "image/png", name: "big1.png", size: 2048 * 1024 + 1 },
      { type: "image/png", name: "big2.png", size: 2048 * 1024 + 2 },
    ],
    quickReplyTextarea
  );
  getEventListener("paste")(oversizedPaste);
  assert.equal(
    oversizedPaste.prevented,
    true,
    "超过论坛限制的快速回复粘贴应被接管。"
  );
  assert.equal(oversizedPaste.stopped, true, "接管时应阻止论坛原生上传器。");
  const quickReplyQueueAfterPaste = quickReplyLoadingApi.getQuickReplyQueue();
  assert.equal(
    quickReplyQueueAfterPaste.pending(),
    2,
    "同一次粘贴的多张超限图片都应进入快速回复上传队列。"
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    quickReplyQueueAfterPaste.pending(),
    0,
    "压缩失败（测试环境无 Canvas）后队列应收尾。"
  );

  const quickReplyDeleteCalls = [];
  quickReplySandbox.fetch = async (url) => {
    quickReplyDeleteCalls.push(String(url));
    return {
      ok: true,
      status: 200,
      text: async () => '<root><![CDATA[1]]></root>',
    };
  };
  quickReplyRecycleApi.markOwnedAid(901, "quick-reply");
  quickReplyRecycleApi.markOwnedAid(902, "reply-popup");
  quickReplyRecycleApi.reconcile("quick-reply", { confirmed: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    quickReplyDeleteCalls.length,
    1,
    "快速回复框只应回收自己 scope 的未引用附件。"
  );
  assert.equal(
    quickReplyDeleteCalls[0],
    "forum.php?mod=ajax&action=deleteattach&inajax=yes&formhash=9f8e7d6c&tid=0&pid=0&aids[]=901"
  );
  assert.deepEqual(
    toPlainObject(quickReplyRecycleApi.getOwnedAids()),
    ["902"],
    "其他 scope 的附件不能被快速回复框回收。"
  );
  assert.deepEqual(
    toPlainObject(quickReplyRecycleApi.getOwnedAidScopes()),
    [["902", "reply-popup"]]
  );
  quickReplyRecycleApi.settle();
  assert.deepEqual(toPlainObject(quickReplyRecycleApi.getOwnedAids()), []);
  assert.deepEqual(
    toPlainObject(quickReplyRecycleApi.getOwnedAidScopes()),
    [],
    "结算后应清空附件归属 scope。"
  );

  // 输入事件 → 快速回复 scope 回收接线（M16）：删掉快速回复框里的引用后
  // 应通过真实 input 监听触发两轮确认并删除该附件。
  const originalWindowSetTimeout = quickReplySandbox.window.setTimeout;
  const originalWindowClearTimeout = quickReplySandbox.window.clearTimeout;
  const pendingTimerCallbacks = [];
  quickReplySandbox.window.setTimeout = (callback) => {
    pendingTimerCallbacks.push(callback);
    return pendingTimerCallbacks.length;
  };
  quickReplySandbox.window.clearTimeout = () => { };
  quickReplyTextarea.value = "";
  quickReplyRecycleApi.markOwnedAid(905, "quick-reply");
  getEventListener("input")({
    target: {
      closest: (selector) =>
        selector === "textarea" ? quickReplyTextarea : null,
    },
  });
  assert.ok(
    pendingTimerCallbacks.length >= 1,
    "快速回复框输入后应安排回收确认。"
  );
  while (pendingTimerCallbacks.length > 0) {
    pendingTimerCallbacks.shift()();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(
    quickReplyDeleteCalls.some((url) => url.includes("aids[]=905")),
    "输入事件应触发快速回复框自己的附件回收请求。"
  );
  assert.ok(
    !quickReplyDeleteCalls.some((url) => url.includes("aids[]=902")),
    "快速回复框的回收不应删除弹窗 scope 的附件。"
  );
  quickReplySandbox.window.setTimeout = originalWindowSetTimeout;
  quickReplySandbox.window.clearTimeout = originalWindowClearTimeout;

  // 提交只结算当前输入区：弹窗提交不应跳过快速回复框的附件回收。
  quickReplyRecycleApi.markOwnedAid(903, "quick-reply");
  quickReplyRecycleApi.markOwnedAid(904, "reply-popup");
  quickReplyRecycleApi.settle("reply-popup");
  assert.deepEqual(
    toPlainObject(quickReplyRecycleApi.getSettledAids()).sort(),
    ["902", "904"],
    "提交应结算当前输入区的附件。"
  );
  assert.deepEqual(
    toPlainObject(quickReplyRecycleApi.getOwnedAids()),
    ["903"],
    "其他输入区的附件应保持可回收。"
  );
  assert.deepEqual(
    toPlainObject(quickReplyRecycleApi.getOwnedAidScopes()),
    [["903", "quick-reply"]]
  );

  // 结算 scope 接线：快速回复提交/快捷键只结算 quick-reply，弹窗提交只结算 reply-popup。
  const settledAids = () =>
    toPlainObject(quickReplyRecycleApi.getSettledAids());
  const ownedAids = () => toPlainObject(quickReplyRecycleApi.getOwnedAids());
  quickReplyRecycleApi.markOwnedAid(906, "quick-reply");
  quickReplyRecycleApi.markOwnedAid(907, "reply-popup");
  getEventListener("submit")(quickReplySubmitEvent());
  assert.ok(
    settledAids().includes("906"),
    "快速回复提交应结算 quick-reply scope 的附件。"
  );
  assert.ok(
    !settledAids().includes("907"),
    "快速回复提交不应结算弹窗 scope 的附件。"
  );
  assert.ok(ownedAids().includes("907"), "弹窗附件应保持可回收。");
  quickReplyRecycleApi.markOwnedAid(908, "quick-reply");
  getEventListener("keydown")(quickReplyShortcutEvent());
  assert.ok(
    settledAids().includes("908"),
    "快速回复快捷键提交应结算 quick-reply scope 的附件。"
  );
  quickReplyRecycleApi.markOwnedAid(909, "reply-popup");
  quickReplyRecycleApi.markOwnedAid(910, "quick-reply");
  getEventListener("submit")({
    type: "submit",
    target: { id: "postform" },
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
  });
  assert.ok(
    settledAids().includes("909"),
    "弹窗提交应结算 reply-popup scope 的附件。"
  );
  assert.ok(
    !settledAids().includes("910"),
    "弹窗提交不应结算快速回复 scope 的附件。"
  );
  assert.ok(ownedAids().includes("910"), "快速回复附件应保持可回收。");
  quickReplyRecycleApi.settle();

  // settle(scope) 只清理当前输入区的待执行计时器（M26）。
  const timerWindowSetTimeout = quickReplySandbox.window.setTimeout;
  const timerWindowClearTimeout = quickReplySandbox.window.clearTimeout;
  const scheduledTimerIds = [];
  const clearedTimerIds = [];
  quickReplySandbox.window.setTimeout = (callback) => {
    scheduledTimerIds.push(callback);
    return scheduledTimerIds.length;
  };
  quickReplySandbox.window.clearTimeout = (id) => {
    clearedTimerIds.push(id);
  };
  quickReplyRecycleApi.scheduleReconcile("quick-reply");
  quickReplyRecycleApi.scheduleReconcile("reply-popup");
  assert.equal(scheduledTimerIds.length, 2, "应安排两个输入区的回收计时。");
  quickReplyRecycleApi.settle("quick-reply");
  assert.equal(
    clearedTimerIds.length,
    1,
    "结算快速回复 scope 只应清理它自己的回收计时器。"
  );
  assert.equal(clearedTimerIds[0], 1, "清理的应是快速回复 scope 的计时器。");
  quickReplySandbox.window.setTimeout = timerWindowSetTimeout;
  quickReplySandbox.window.clearTimeout = timerWindowClearTimeout;

  // 插入路径：附件代码落在光标处，并把 aid 登记到 quick-reply scope。
  quickReplyTextarea.value = "AB";
  quickReplyTextarea.selectionStart = 0;
  quickReplyTextarea.selectionEnd = 0;
  const insertedQuickReply = await quickReplyApi.insertQuickReplyJob(
    { textarea: quickReplyTextarea, caret: { start: 1, end: 1 } },
    123
  );
  assert.equal(insertedQuickReply, true, "存活目标应插入附件代码。");
  assert.equal(
    quickReplyTextarea.value,
    "A[attachimg]123[/attachimg]B",
    "附件代码应插入粘贴时的光标处。"
  );
  assert.deepEqual(
    toPlainObject(quickReplyRecycleApi.getOwnedAidScopes()).filter(
      ([aid]) => aid === "123"
    ),
    [["123", "quick-reply"]],
    "插入后的附件应登记为快速回复 scope。"
  );
  assert.deepEqual(
    quickReplyForm.appended.map((input) => input.name),
    [
      "attachnew[123][description]",
      "attachnew[123][readperm]",
      "attachnew[123][price]",
    ],
    "应为快速回复表单补上 attachnew 隐藏字段。"
  );

  // 弹窗插入路径的 scope 标记（M17）：必须登记为 reply-popup。
  const popupTextarea = {
    id: "postmessage",
    isConnected: true,
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
  };
  const popupForm = {
    id: "postform",
    contains: (node) => node === popupTextarea,
    querySelector: () => null,
    appendChild(node) {
      this.appended = this.appended || [];
      this.appended.push(node);
    },
  };
  popupTextarea.form = popupForm;
  const popupElement = {
    contains: (node) => node === popupTextarea,
    querySelector: (selector) => {
      if (selector === "#postmessage") return popupTextarea;
      if (selector === "#postform") return popupForm;
      return null;
    },
  };
  const baseGetElementById = quickReplyDocument.getElementById;
  quickReplyDocument.getElementById = (id) => {
    if (id === "fwin_content_reply") return popupElement;
    return baseGetElementById(id);
  };
  const insertedPopup = await quickReplyApi.insertReplyJob(
    { textarea: popupTextarea, caret: { start: 0, end: 0 } },
    456
  );
  assert.equal(insertedPopup, true, "弹窗目标存活时应插入附件代码。");
  assert.equal(popupTextarea.value, "[attachimg]456[/attachimg]");
  assert.deepEqual(
    toPlainObject(quickReplyRecycleApi.getOwnedAidScopes()).filter(
      ([aid]) => aid === "456"
    ),
    [["456", "reply-popup"]],
    "弹窗插入的附件应登记为 reply-popup scope。"
  );
  assert.deepEqual(
    popupForm.appended.map((input) => input.name),
    [
      "attachnew[456][description]",
      "attachnew[456][readperm]",
      "attachnew[456][price]",
    ],
    "应为弹窗表单补上 attachnew 隐藏字段。"
  );

  liveApi.settle();
  console.log("test-reply-image-paste: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
