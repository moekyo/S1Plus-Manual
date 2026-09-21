"use strict";

const assert = require("assert/strict");
const { createHarness } = require("./s1plus-test-helpers");

const helperErrorMessage = "未能从 S1Plus.js 暴露自动签到测试钩子。";

const createAnchor = (href) => ({
  href,
  style: {},
});

const createInput = (runtime, value) => {
  const input = Object.create(runtime.sandbox.HTMLInputElement.prototype);
  input.value = value;
  return input;
};

const createAutoSignRuntime = ({
  includeCheckinLink = true,
  checkinHref = "https://stage1st.com/2b/study_daily_attendance-daily_attendance.html?formhash=formhash123",
  formhash = "formhash123",
  signedDate = null,
} = {}) => {
  const runtime = createHarness({ hookErrorMessage: helperErrorMessage });
  const { hooks, sandbox, store } = runtime;
  const loginLink = createAnchor("https://stage1st.com/2b/space-uid-123.html");
  const checkinLink = includeCheckinLink ? createAnchor(checkinHref) : null;
  const formhashInput = formhash ? createInput(runtime, formhash) : null;

  sandbox.document.querySelector = (selector) => {
    const normalizedSelector = String(selector);
    if (normalizedSelector.includes("space-uid-")) {
      return loginLink;
    }
    if (
      normalizedSelector.includes(
        "study_daily_attendance-daily_attendance.html"
      )
    ) {
      return checkinLink;
    }
    if (normalizedSelector === 'input[name="formhash"]') {
      return formhashInput;
    }
    return null;
  };

  if (signedDate !== null) {
    store.set("signedDate_123", signedDate);
  }

  const requests = [];
  sandbox.GM_xmlhttpRequest = (options) => {
    requests.push(options);
  };

  const timers = [];
  sandbox.window.setTimeout = (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  };
  sandbox.window.clearTimeout = () => {};

  return {
    runtime,
    hooks,
    sandbox,
    store,
    requests,
    timers,
    checkinLink,
  };
};

const withHarness = (options, run) => {
  const runtime = createAutoSignRuntime(options);
  run(runtime);
};

const tests = [];
const test = (name, run) => {
  tests.push({ name, run });
};

test("自动签到的日期按论坛 GMT+8 日切", () => {
  const runtime = createHarness({ hookErrorMessage: helperErrorMessage });
  assert.equal(
    runtime.hooks.getS1pForumDateKey(Date.UTC(2026, 0, 1, 17, 30)),
    "2026-1-2"
  );
});

test("签到尝试状态兼容旧字符串格式", () => {
  const runtime = createHarness({ hookErrorMessage: helperErrorMessage });
  const legacyState = runtime.hooks.normalizeS1pSignAttemptState("2026-1-2");
  assert.equal(legacyState.date, "2026-1-2");
  assert.equal(legacyState.nextRetryAt, 0);
  assert.equal(legacyState.failCount, 1);
  assert.equal(runtime.hooks.normalizeS1pSignAttemptState(null), null);
});

test("签到成功判定不会把错误页当成成功", () => {
  const runtime = createHarness({ hookErrorMessage: helperErrorMessage });
  const isSuccess = runtime.hooks.isS1pAutoSignSuccessResponse;
  assert.equal(
    isSuccess({ status: 200, responseText: "签到成功，奖励20金钱" }),
    true
  );
  assert.equal(
    isSuccess({ status: 200, responseText: "您今天已经签到过了" }),
    true
  );
  assert.equal(
    isSuccess({ status: 200, responseText: "抱歉，您没有权限" }),
    false
  );
  assert.equal(isSuccess({ status: 500, responseText: "签到成功" }), false);
});

test("链接存在时解析服务端结果并标记已签到", () => {
  withHarness({}, ({ hooks, sandbox, store, requests, checkinLink }) => {
    sandbox.GM_xmlhttpRequest = (options) => {
      requests.push(options);
      options.onload({
        status: 200,
        responseText: "签到成功，奖励20金钱，连续签到7天",
      });
    };

    hooks.autoSign();

    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /formhash=formhash123/);
    assert.match(requests[0].url, /inajax=1/);
    assert.equal(checkinLink.style.display, "none");
    assert.equal(store.get("signedDate_123"), hooks.getS1pForumDateKey());
    assert.equal(store.has("signedAttemptDate_123"), false);
  });
});

test("链接存在时 2xx 错误页不会标记已签到并进入退避", () => {
  withHarness({}, ({ hooks, sandbox, store, requests, timers }) => {
    sandbox.GM_xmlhttpRequest = (options) => {
      requests.push(options);
      options.onload({
        status: 200,
        responseText: "抱歉，您没有权限进行签到",
      });
    };

    hooks.autoSign();

    assert.equal(requests.length, 1);
    assert.equal(store.has("signedDate_123"), false);
    const attemptState = store.get("signedAttemptDate_123");
    assert.ok(attemptState);
    assert.equal(attemptState.failCount, 1);
    assert.ok(attemptState.nextRetryAt > Date.now());
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 3 * 60 * 1000 + 250);
  });
});

test("本地已记录当天签到时不发请求并隐藏链接", () => {
  withHarness({}, (runtime) => {
    const { hooks, store, requests, checkinLink } = runtime;
    store.set("signedDate_123", hooks.getS1pForumDateKey());

    hooks.autoSign();

    assert.equal(requests.length, 0);
    assert.equal(checkinLink.style.display, "none");
  });
});

test("签到链接缺失时按 formhash 构造请求地址", () => {
  withHarness(
    { includeCheckinLink: false },
    ({ hooks, sandbox, store, requests }) => {
      sandbox.GM_xmlhttpRequest = (options) => {
        requests.push(options);
        options.onload({
          status: 200,
          responseText: "已签到",
        });
      };

      hooks.autoSign();

      assert.equal(requests.length, 1);
      assert.match(
        requests[0].url,
        /\/2b\/study_daily_attendance-daily_attendance\.html/
      );
      assert.match(requests[0].url, /formhash=formhash123/);
      assert.match(requests[0].url, /inajax=1/);
      assert.equal(store.get("signedDate_123"), hooks.getS1pForumDateKey());
    }
  );
});

let failed = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log("PASS:", name);
  } catch (error) {
    failed += 1;
    console.error("FAIL:", name);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log("Auto sign behavior tests passed.");
}
