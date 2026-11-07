const assert = require("node:assert/strict");
const test = require("node:test");

const { readText, writeText, isThenable, _setClipboardForTests } =
  require("../src/helpers/clipboardText");

// Electron 45 的非同步剪貼簿（readText 回 Promise）
function asyncClipboard(initial = "") {
  const box = { value: initial, reads: 0, writes: 0 };
  return {
    box,
    api: {
      readText: () => { box.reads++; return Promise.resolve(box.value); },
      writeText: (t) => { box.writes++; box.value = t; return Promise.resolve(); },
    },
  };
}

// 舊版 Electron 的同步剪貼簿（readText 直接回字串）
function syncClipboard(initial = "") {
  const box = { value: initial, reads: 0, writes: 0 };
  return {
    box,
    api: {
      readText: () => { box.reads++; return box.value; },
      writeText: (t) => { box.writes++; box.value = t; },
    },
  };
}

test("非同步 API：讀得到字串而不是 Promise", async () => {
  const { api } = asyncClipboard("使用者複製的網址");
  _setClipboardForTests(api);

  const v = await readText();
  assert.equal(typeof v, "string", "拿到 Promise 的話後面所有比對都會失效");
  assert.equal(v, "使用者複製的網址");
});

test("同步 API（舊版 Electron）也要能用", async () => {
  const { api } = syncClipboard("使用者複製的網址");
  _setClipboardForTests(api);

  assert.equal(await readText(), "使用者複製的網址");
  assert.equal(await writeText("新內容"), true);
  assert.equal(await readText(), "新內容");
});

test("寫入後讀回來要是寫進去的那份（非同步）", async () => {
  const { api } = asyncClipboard("舊的");
  _setClipboardForTests(api);

  assert.equal(await writeText("新的"), true);
  assert.equal(await readText(), "新的");
});

test("⛔ 回歸：直接拿 readText() 的回傳值跟字串比對會永遠不相等", async () => {
  // 這就是害「貼上後還原剪貼簿」整段不執行的原因。
  // 留著這個測試，是為了把那個錯誤寫法的後果釘在檔案裡。
  const { api } = asyncClipboard("某段文字");
  const raw = api.readText();

  assert.equal(isThenable(raw), true, "Electron 45 回的是 thenable");
  assert.notEqual(raw, "某段文字", "Promise 不等於字串——舊寫法就是這樣靜默失效的");

  // 正確做法
  _setClipboardForTests(api);
  assert.equal(await readText(), "某段文字");
});

test("剪貼簿丟錯時回安全值，不會把呼叫端炸掉", async () => {
  _setClipboardForTests({
    readText: () => { throw new Error("剪貼簿被佔用"); },
    writeText: () => { throw new Error("剪貼簿被佔用"); },
  });

  assert.equal(await readText(), "", "讀失敗回空字串");
  assert.equal(await writeText("x"), false, "寫失敗回 false 讓呼叫端知道");
});

test("非同步 API 的 rejected promise 也要接住", async () => {
  _setClipboardForTests({
    readText: () => Promise.reject(new Error("被佔用")),
    writeText: () => Promise.reject(new Error("被佔用")),
  });

  assert.equal(await readText(), "");
  assert.equal(await writeText("x"), false);
});

test("非字串輸入不會寫出 undefined / [object Object]", async () => {
  const { box, api } = asyncClipboard("原本");
  _setClipboardForTests(api);

  await writeText(undefined);
  assert.equal(box.value, "");
  await writeText({ a: 1 });
  assert.equal(box.value, "", "物件要被擋成空字串，不能寫出 [object Object]");
});

test("讀到非字串（API 行為改變）也回空字串", async () => {
  _setClipboardForTests({
    readText: () => Promise.resolve(12345),
    writeText: () => Promise.resolve(),
  });
  assert.equal(await readText(), "");
});
