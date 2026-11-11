#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const {
  createHarness,
  toPlainObject,
  sourceCode,
} = require("./s1plus-test-helpers");

const { hooks } = createHarness({
  hookErrorMessage: "未能从 S1Plus.js 暴露设置列表搜索测试 seam。",
});

const {
  getSettingsModalSearchKeywords,
  buildSettingsModalSearchTextFromParts,
  matchesSettingsModalSearchKeywords,
  buildSettingsModalSearchHighlightRegex,
  filterSettingsModalBookmarkItemsByKeywords,
  filterSettingsModalBlockedUserIds,
  filterSettingsModalTagItems,
  filterSettingsModalManualThreadIds,
  filterSettingsModalBlockedPostThreadGroups,
} = hooks;

[
  ["getSettingsModalSearchKeywords", getSettingsModalSearchKeywords],
  ["buildSettingsModalSearchTextFromParts", buildSettingsModalSearchTextFromParts],
  ["matchesSettingsModalSearchKeywords", matchesSettingsModalSearchKeywords],
  ["buildSettingsModalSearchHighlightRegex", buildSettingsModalSearchHighlightRegex],
  ["filterSettingsModalBookmarkItemsByKeywords", filterSettingsModalBookmarkItemsByKeywords],
  ["filterSettingsModalBlockedUserIds", filterSettingsModalBlockedUserIds],
  ["filterSettingsModalTagItems", filterSettingsModalTagItems],
  ["filterSettingsModalManualThreadIds", filterSettingsModalManualThreadIds],
  ["filterSettingsModalBlockedPostThreadGroups", filterSettingsModalBlockedPostThreadGroups],
].forEach(([name, fn]) => {
  assert.equal(typeof fn, "function", `缺少 ${name} 搜索辅助函数。`);
});

const testKeywordParsing = () => {
  assert.deepEqual(toPlainObject(getSettingsModalSearchKeywords("")), []);
  assert.deepEqual(toPlainObject(getSettingsModalSearchKeywords("   ")), []);
  assert.deepEqual(toPlainObject(getSettingsModalSearchKeywords(" 飞侠   小黑 ")), [
    "飞侠",
    "小黑",
  ]);
  assert.deepEqual(toPlainObject(getSettingsModalSearchKeywords("ABC")), ["abc"]);
};

const testSharedSearchPrimitives = () => {
  assert.equal(
    buildSettingsModalSearchTextFromParts(["ABC", "dEF", null]),
    "abc def ",
    "搜索文本应统一拼接并转为小写。"
  );
  assert.equal(
    matchesSettingsModalSearchKeywords(
      "abc def",
      getSettingsModalSearchKeywords("ABC")
    ),
    true,
    "关键词匹配应忽略大小写。"
  );
  assert.equal(
    matchesSettingsModalSearchKeywords("abc def", ["abc", "def"]),
    true
  );
  assert.equal(
    matchesSettingsModalSearchKeywords("abc def", ["abc", "xyz"]),
    false,
    "多个关键词必须全部命中。"
  );
  assert.equal(
    matchesSettingsModalSearchKeywords("任意文本", []),
    true,
    "没有关键词时不应过滤。"
  );
  const highlightRegex = buildSettingsModalSearchHighlightRegex(["A.C", "b"]);
  assert.ok(highlightRegex, "有关键词时应返回高亮正则。");
  assert.equal(highlightRegex.test("包含 a.c 的文本"), true);
  assert.equal(
    highlightRegex.test("AXC 不应命中"),
    false,
    "高亮正则必须转义关键词中的正则元字符。"
  );
  assert.equal(
    buildSettingsModalSearchHighlightRegex([]),
    null,
    "没有关键词时不应生成高亮正则。"
  );
};

const testBlockedUserFilter = () => {
  const blockedUsers = {
    "101": { name: "飞侠小黑", remark: "傻逼渲染人", timestamp: 1 },
    "202": { name: "这次是十块钱", remark: "", timestamp: 2 },
    "303": { name: "OtherUser", remark: "技术区", timestamp: 3 },
  };
  const userIds = ["101", "202", "303"];
  const filter = (keywords) =>
    toPlainObject(
      filterSettingsModalBlockedUserIds(blockedUsers, userIds, keywords)
    );

  assert.deepEqual(filter([]), userIds, "没有关键词时应返回完整 UID 列表。");
  assert.deepEqual(filter(getSettingsModalSearchKeywords("飞侠")), ["101"]);
  assert.deepEqual(filter(getSettingsModalSearchKeywords("OTHER")), ["303"]);
  assert.deepEqual(
    filter(getSettingsModalSearchKeywords("渲染")),
    ["101"],
    "备注也应参与用户搜索。"
  );
  assert.deepEqual(
    filter(getSettingsModalSearchKeywords("202")),
    ["202"],
    "UID 也应参与用户搜索。"
  );
  assert.deepEqual(
    filter(getSettingsModalSearchKeywords("技术 303")),
    ["303"],
    "多个关键词应在同一用户的组合文本中全部命中。"
  );
  assert.deepEqual(filter(getSettingsModalSearchKeywords("技术 101")), []);
  assert.deepEqual(filter(getSettingsModalSearchKeywords("不存在的用户")), []);
};

const testTagFilter = () => {
  const tagItems = [
    ["101", { name: "飞侠小黑", tag: "技术大佬" }],
    ["202", { name: "这次是十块钱", tag: "乐子人" }],
  ];
  const filter = (keywords) =>
    toPlainObject(filterSettingsModalTagItems(tagItems, keywords));

  assert.deepEqual(filter([]), [
    ["101", { name: "飞侠小黑", tag: "技术大佬" }],
    ["202", { name: "这次是十块钱", tag: "乐子人" }],
  ]);
  assert.deepEqual(filter(getSettingsModalSearchKeywords("大佬")), [
    ["101", { name: "飞侠小黑", tag: "技术大佬" }],
  ]);
  assert.deepEqual(filter(getSettingsModalSearchKeywords("十块")), [
    ["202", { name: "这次是十块钱", tag: "乐子人" }],
  ]);
  assert.deepEqual(filter(getSettingsModalSearchKeywords("乐子 202")), [
    ["202", { name: "这次是十块钱", tag: "乐子人" }],
  ]);
  assert.deepEqual(filter(getSettingsModalSearchKeywords("乐子 101")), []);
  assert.deepEqual(filter(getSettingsModalSearchKeywords("没有")), []);
};

const testManualThreadFilter = () => {
  const blockedThreads = {
    "111": { title: "周用ds的经验", timestamp: 1, reason: "manual" },
    "222": { title: "pi的codemode真不错", timestamp: 2, reason: "user_777" },
    "333": { title: "无关帖子", timestamp: 3, reason: "manual" },
  };
  const threadIds = ["111", "222", "333"];
  const filter = (keywords) =>
    toPlainObject(
      filterSettingsModalManualThreadIds(blockedThreads, threadIds, keywords)
    );

  assert.deepEqual(filter([]), threadIds);
  assert.deepEqual(filter(getSettingsModalSearchKeywords("codemode")), ["222"]);
  assert.deepEqual(
    filter(getSettingsModalSearchKeywords("777")),
    ["222"],
    "联动屏蔽用户时应支持按 UID 搜索。"
  );
  assert.deepEqual(filter(getSettingsModalSearchKeywords("周用 经验")), ["111"]);
  assert.deepEqual(filter(getSettingsModalSearchKeywords("周用 codemode")), []);
};

const testBlockedPostThreadGroupFilter = () => {
  const threadGroups = [
    {
      threadId: "11",
      threadTitle: "这是帖子A",
      posts: [
        {
          postId: "91",
          floor: "3",
          authorName: "飞侠小黑",
          authorId: "101",
          timestamp: 1,
        },
        {
          postId: "92",
          floor: "5",
          authorName: "这次是十块钱",
          authorId: "202",
          timestamp: 2,
        },
      ],
    },
    {
      threadId: "22",
      threadTitle: "帖子B",
      posts: [
        {
          postId: "93",
          floor: "2",
          authorName: "Other",
          authorId: "303",
          timestamp: 3,
        },
      ],
    },
  ];
  const filter = (keywords) =>
    toPlainObject(
      filterSettingsModalBlockedPostThreadGroups(threadGroups, keywords)
    );

  assert.deepEqual(filter([]), threadGroups, "没有关键词时应返回原始分组。");
  assert.deepEqual(
    filter(getSettingsModalSearchKeywords("帖子A")).map((group) => [
      group.threadId,
      group.posts.map((post) => post.postId),
    ]),
    [["11", ["91", "92"]]],
    "命中帖子标题时应保留该帖的全部屏蔽楼层。"
  );
  assert.deepEqual(
    filter(getSettingsModalSearchKeywords("飞侠")).map((group) => [
      group.threadId,
      group.posts.map((post) => post.postId),
    ]),
    [["11", ["91"]]],
    "命中楼层作者时应只保留命中的楼层。"
  );
  assert.deepEqual(
    filter(getSettingsModalSearchKeywords("5")).map((group) => [
      group.threadId,
      group.posts.map((post) => post.postId),
    ]),
    [["11", ["92"]]],
    "楼层号也应参与搜索。"
  );
  assert.deepEqual(
    filter(getSettingsModalSearchKeywords("帖子B Other")).map((group) => [
      group.threadId,
      group.posts.map((post) => post.postId),
    ]),
    [["22", ["93"]]]
  );
  assert.deepEqual(filter(getSettingsModalSearchKeywords("不存在")), []);
  assert.equal(
    threadGroups[0].posts.length,
    2,
    "过滤不应修改原始楼层分组。"
  );
};

const testBookmarkFilter = () => {
  const bookmarkItems = [
    {
      postId: "1",
      authorName: "爱诺琳",
      threadTitle: "deepseek v4 讨论",
      postContent: "这几天用 ds 的经验",
    },
    {
      postId: "2",
      authorName: "别的作者",
      threadTitle: "无关帖子",
      contentPreview: "只有预览内容的收藏",
    },
  ];
  const filter = (keywords) =>
    toPlainObject(
      filterSettingsModalBookmarkItemsByKeywords(bookmarkItems, keywords)
    );

  assert.deepEqual(filter([]), bookmarkItems);
  assert.deepEqual(
    filter(getSettingsModalSearchKeywords("经验")).map((item) => item.postId),
    ["1"]
  );
  assert.deepEqual(
    filter(getSettingsModalSearchKeywords("预览")).map((item) => item.postId),
    ["2"],
    "缺少完整正文时应回退到预览文本。"
  );
  assert.deepEqual(filter(getSettingsModalSearchKeywords("爱诺琳 无关")), []);
};

const testSearchWiringContract = () => {
  const searchBindings = [
    {
      inputId: "s1p-blocked-user-search-input",
      tabKey: "users",
      renderName: "const renderUserTab",
      listKey: "SETTINGS_MODAL_LIST_KEY.BLOCKED_USERS",
      filterName: "filterSettingsModalBlockedUserIds",
    },
    {
      inputId: "s1p-tags-search-input",
      tabKey: "tags",
      renderName: "const renderTagsTab",
      listKey: "SETTINGS_MODAL_LIST_KEY.TAGS",
      filterName: "filterSettingsModalTagItems",
    },
    {
      inputId: "s1p-threads-search-input",
      tabKey: "threads",
      renderName: "const renderThreadTab",
      listKey: "SETTINGS_MODAL_LIST_KEY.MANUAL_THREADS",
      filterName: "filterSettingsModalManualThreadIds",
      extraFilterChecks: [
        [
          "filterSettingsModalBlockedPostThreadGroups",
          "SETTINGS_MODAL_LIST_KEY.BLOCKED_POST_THREAD_GROUPS",
        ],
      ],
    },
  ];

  searchBindings.forEach((binding) => {
    assert.ok(
      sourceCode.includes(`inputId: "${binding.inputId}"`),
      `缺少 ${binding.tabKey} tab 的搜索框渲染。`
    );
    assert.ok(
      sourceCode.includes(`inputSelector: "#${binding.inputId}"`),
      `缺少 ${binding.tabKey} tab 的搜索框事件绑定。`
    );
    const renderStart = sourceCode.indexOf(binding.renderName);
    assert.notEqual(renderStart, -1, `找不到 ${binding.tabKey} tab 渲染函数。`);
    const renderEnd = sourceCode.indexOf("\n    const render", renderStart);
    const renderSource = sourceCode.slice(
      renderStart,
      renderEnd === -1 ? undefined : renderEnd
    );
    assert.ok(
      renderSource.includes(binding.filterName),
      `${binding.tabKey} tab 未使用列表过滤辅助函数。`
    );
    assert.ok(
      renderSource.indexOf(binding.filterName) <
        renderSource.indexOf(binding.listKey),
      `${binding.tabKey} tab 必须先过滤列表再分页。`
    );
    (binding.extraFilterChecks || []).forEach(([filterName, listKey]) => {
      assert.ok(
        renderSource.includes(filterName),
        `${binding.tabKey} tab 未对 ${listKey} 使用过滤辅助函数 ${filterName}。`
      );
      assert.ok(
        renderSource.indexOf(filterName) < renderSource.indexOf(listKey),
        `${binding.tabKey} tab 必须先过滤 ${listKey} 再分页。`
      );
    });
  });

  const threadsBindStart = sourceCode.indexOf('searchKey: "threads"');
  assert.notEqual(threadsBindStart, -1, "找不到帖子屏蔽 tab 的搜索绑定。");
  const threadsBindSource = sourceCode.slice(threadsBindStart, threadsBindStart + 600);
  assert.ok(
    threadsBindSource.includes("SETTINGS_MODAL_LIST_KEY.MANUAL_THREADS") &&
      threadsBindSource.includes(
        "SETTINGS_MODAL_LIST_KEY.BLOCKED_POST_THREAD_GROUPS"
      ),
    "帖子屏蔽 tab 的搜索绑定必须同时重置手动屏蔽帖子与已屏蔽楼层两个列表的分页。"
  );

  assert.ok(
    sourceCode.includes('searchKey: "bookmarks"') &&
      sourceCode.includes("bindSettingsModalListSearch"),
    "回复收藏搜索应复用统一搜索绑定实现。"
  );
  assert.ok(
    sourceCode.includes('value="${escapeAttr(safeQuery)}"') &&
      sourceCode.includes('placeholder="${escapeAttr('),
    "搜索框回填的查询词与占位符必须经过 escapeAttr 转义。"
  );

  const binderStart = sourceCode.indexOf("const bindSettingsModalListSearch =");
  const binderEnd = sourceCode.indexOf(
    "const resolveInputCursorPosition",
    binderStart
  );
  assert.notEqual(binderStart, -1, "缺少统一搜索绑定实现。");
  assert.notEqual(binderEnd, -1, "找不到统一搜索绑定实现的结束位置。");
  const binderSource = sourceCode.slice(binderStart, binderEnd);
  [
    "compositionstart",
    "compositionend",
    "settingsModalListPageState.set",
    "setSelectionRange",
    "SETTINGS_MODAL_SEARCH_DEBOUNCE_MS",
  ].forEach((token) => {
    assert.ok(
      binderSource.includes(token),
      `统一搜索绑定缺少 ${token} 处理。`
    );
  });

  ["tags", "users", "threads", "bookmarks"].forEach((searchKey) => {
    assert.ok(
      sourceCode.includes(`clearSettingsModalSearchTimer("${searchKey}")`),
      `${searchKey} tab 渲染前应清理待执行搜索定时器。`
    );
  });
  assert.ok(
    sourceCode.includes("clearAllSettingsModalSearchTimers();"),
    "设置面板关闭时必须清理全部搜索定时器。"
  );
};

testKeywordParsing();
testSharedSearchPrimitives();
testBlockedUserFilter();
testTagFilter();
testManualThreadFilter();
testBlockedPostThreadGroupFilter();
testBookmarkFilter();
testSearchWiringContract();

console.log(
  "[settings-list-search] keyword matching, list filters and search wiring verified."
);
