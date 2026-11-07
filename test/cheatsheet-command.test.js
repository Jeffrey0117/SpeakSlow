const assert = require("node:assert/strict");
const test = require("node:test");

// commandMode 需要 electron；這裡只抽出比對規則重跑，不載入整個模組。
// 規則本體與 commandMode.matchCommand 的速查表分支保持一致。
function normalize(text) {
  return (text || "")
    .replace(/[\s。，、！？；：．,.!?;:]/g, "")
    .toLowerCase()
    .trim();
}

function isCheatSheetPhrase(text) {
  const norm = normalize(text);
  if (!norm) return false;
  return (
    norm.includes("快捷鍵") || norm.includes("快速鍵") ||
    norm.includes("操作表") || norm.includes("指令表") || norm.includes("規則表") ||
    norm.includes("有哪些指令") || norm.includes("有什麼指令") ||
    norm === "說明" || norm === "幫助" || norm === "求救" || norm === "help"
  );
}

test("求助說法會叫出速查表", () => {
  for (const phrase of [
    "操作表", "快捷鍵表", "規則表", "指令表",
    "有哪些指令", "有什麼指令", "幫助", "說明", "求救",
    "快捷鍵是什麼", "快速鍵有哪些",
  ]) {
    assert.ok(isCheatSheetPhrase(phrase), `應匹配：${phrase}`);
  }
});

test("一般講話不會誤觸——「說明/幫助」只在單獨講時才算求助", () => {
  for (const phrase of [
    "今天天氣很好",
    "我想說明一下這個專案的狀況",
    "幫助我完成這份報告",
    "記下來",
    "翻譯成英文",
  ]) {
    assert.ok(!isCheatSheetPhrase(phrase), `不該匹配：${phrase}`);
  }
});

test("標點與空白不影響辨識（語音結果常帶句號）", () => {
  assert.ok(isCheatSheetPhrase("操作表。"));
  assert.ok(isCheatSheetPhrase("幫助！"));
  assert.ok(isCheatSheetPhrase(" 指令表 "));
});
