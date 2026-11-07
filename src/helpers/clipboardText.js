// 剪貼簿文字讀寫（同時吃得下同步與非同步兩種 Electron API）。
//
// ⛔ 為什麼需要這一層：Electron 45 的主行程剪貼簿改成**非同步**了，
// `clipboard.readText()` 回傳的是 Promise 而不是字串。舊的同步寫法不會報錯，
// 只會靜默失效——而且失效的方式特別陰險：
//
//   if (clipboard.readText() !== text) return;   // Promise 永遠 !== 字串 → 直接 return
//
// 這一行讓「貼上後還原使用者原本的剪貼簿」整段永遠不執行。實測（2026-11-07）：
// app log 裡有 122 次貼上、**0 次還原**，連還原失敗的警告都沒有一筆，而當下
// 剪貼簿的內容長度正好等於最後一次聽寫的字數。使用者複製的網址／帳號會被
// 聽寫文字無聲吃掉，而且沒有任何線索。
//
// 同理 commandMode 用剪貼簿當管道抓選取文字時，`selection.trim()` 會對 Promise
// 丟 TypeError。
//
// 所以一律走這兩支，不要直接呼叫 electron 的 clipboard：
// 偵測回傳值是不是 thenable，兩種 API 都正確處理，這樣不管使用者裝的是哪一版
// Electron（或之後又改回去）都不會再踩。
let _clipboard = null;
function cb() {
  if (!_clipboard) _clipboard = require("electron").clipboard;
  return _clipboard;
}

const isThenable = (v) => !!v && typeof v.then === "function";

/** @returns {Promise<string>} 剪貼簿目前的文字（讀不到時回空字串，不丟錯） */
async function readText() {
  try {
    const v = cb().readText();
    const text = isThenable(v) ? await v : v;
    return typeof text === "string" ? text : "";
  } catch (e) {
    return "";
  }
}

/** @returns {Promise<boolean>} 是否寫入成功 */
async function writeText(text) {
  try {
    const v = cb().writeText(typeof text === "string" ? text : "");
    if (isThenable(v)) await v;
    return true;
  } catch (e) {
    return false;
  }
}

// 測試用：注入假的 clipboard
function _setClipboardForTests(fake) {
  _clipboard = fake;
}

module.exports = { readText, writeText, isThenable, _setClipboardForTests };
