const assert = require("node:assert/strict");
const test = require("node:test");
const { hardenNavigation, isLocalContent } = require("../src/helpers/navigationGuard");

// 這組測試守的是一件事：外部網頁不可以在 app 的視窗裡被載入。
// 那種視窗會繼承同一份 preload，遠端頁面因此拿得到整個 electronAPI
//（聽寫歷史、剪貼簿、模擬按鍵）。設定頁的 target="_blank" 連結就是入口。

function fakeContents() {
  const c = {
    openHandler: null,
    listeners: {},
    setWindowOpenHandler(fn) { c.openHandler = fn; },
    on(name, fn) { (c.listeners[name] = c.listeners[name] || []).push(fn); },
    navigate(url) {
      let prevented = false;
      const event = { preventDefault: () => { prevented = true; } };
      for (const fn of c.listeners["will-navigate"] || []) fn(event, url);
      return prevented;
    },
  };
  return c;
}

function setup() {
  const opened = [];
  const c = fakeContents();
  hardenNavigation(c, { openExternal: (u) => opened.push(u) });
  return { c, opened };
}

test("target=\"_blank\" / window.open 一律不在 app 裡開新視窗", () => {
  const { c, opened } = setup();
  assert.equal(c.openHandler({ url: "https://github.com/Jeffrey0117/SpeakSlow" }).action, "deny");
  assert.deepEqual(opened, ["https://github.com/Jeffrey0117/SpeakSlow"], "https 要改用系統瀏覽器開");
});

test("非 https 的新視窗請求：擋掉且不交給系統開", () => {
  const { c, opened } = setup();
  for (const url of ["javascript:alert(1)", "file:///C:/Windows/System32/calc.exe", "C:\\evil.exe", ""]) {
    assert.equal(c.openHandler({ url }).action, "deny", url);
  }
  assert.deepEqual(opened, [], "javascript: / file: / 執行檔路徑都不可進 openExternal");
});

test("導航到外部網站會被取消，改用系統瀏覽器", () => {
  const { c, opened } = setup();
  assert.equal(c.navigate("https://evil.example/page"), true, "外部網址必須 preventDefault");
  assert.deepEqual(opened, ["https://evil.example/page"]);
});

test("自家頁面的導航照常（打包後的 file:// 與開發時的 Vite）", () => {
  const { c, opened } = setup();
  assert.equal(c.navigate("file:///C:/app/src/dist/index.html"), false);
  assert.equal(c.navigate("http://localhost:5173?page=settings"), false);
  assert.deepEqual(opened, [], "自家頁面不該被丟到瀏覽器");
});

test("isLocalContent 不會把看起來像本機的網域當成自己", () => {
  assert.equal(isLocalContent("http://localhost:5173.evil.test/"), false);
  assert.equal(isLocalContent("https://file.evil.test/"), false);
  assert.equal(isLocalContent(undefined), false);
});
