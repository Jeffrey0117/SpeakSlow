// 導航防護：app 裡的視窗只准載入自己的頁面，外部連結交給系統瀏覽器。
//
// 為什麼需要：`window.open` / `<a target="_blank">` 開出來的 Electron 視窗會
// 繼承同一份 webPreferences（含 preload），所以那個遠端網頁拿得到完整的
// `window.electronAPI` —— 讀聽寫歷史、讀寫剪貼簿、模擬按鍵都在裡面。
// 設定頁的「GitHub / 致謝」連結就是這種 target="_blank"，點下去等於把 API
// 交給外站（再從那裡點兩下就可能到任何網域）。
// 一律 deny 新視窗 + 只把 https 丟給 shell.openExternal，才不會有這條路。

const LOCAL_DEV_ORIGIN = "http://localhost:5173";

// 自家內容：打包後是本機 file://、開發時是 Vite dev server。
// 用 origin 比對而不是字串開頭 —— `http://localhost:5173.evil.test` 這種
// 前綴相同的網域會騙過 startsWith；file: 也要求沒有主機，否則
// `file://attacker/share/x.html`（Windows SMB）等於載入遠端內容。
function isLocalContent(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return u.host === "";
    return u.origin === LOCAL_DEV_ORIGIN;
  } catch (e) {
    return false;
  }
}

function defaultOpenExternal(url) {
  require("electron").shell.openExternal(url);
}

/**
 * 套到單一 webContents 上。從 `app.on("web-contents-created")` 呼叫，
 * 新增視窗時不需要記得再掛一次。
 * @param contents webContents
 * @param {{openExternal?: function}} [deps] 測試用注入點
 */
function hardenNavigation(contents, deps = {}) {
  if (!contents) return;
  const openExternal = deps.openExternal || defaultOpenExternal;

  // 只有 https 交給系統瀏覽器。javascript: / file: / Windows 的 .exe 路徑
  // 進到 openExternal 等於任意程式執行，一律丟掉。
  const openIfHttps = (url) => {
    try {
      if (new URL(url).protocol === "https:") openExternal(url);
    } catch (e) {
      // 不是合法 URL → 什麼都不做
    }
  };

  contents.setWindowOpenHandler(({ url }) => {
    openIfHttps(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isLocalContent(url)) return; // 重載 / HMR / ?page= 切頁照常
    event.preventDefault();
    openIfHttps(url);
  });
}

module.exports = { hardenNavigation, isLocalContent };
