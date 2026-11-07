const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPayload } = require("../src/helpers/statsReporter");

// 這組測試的重點只有一個：確認上傳內容「只有數字」。
// 聲聲慢對外承諾聲音與逐字稿不離開本機，這裡是那個承諾的程式碼護欄。

test("🔒 上傳內容只含計數，不含任何辨識文字", () => {
  const payload = buildPayload({
    stats: {
      totalChars: 12345,
      total: 300,
      totalDuration: 7200,
      // 就算本機統計物件裡夾帶了文字，也不該被送出去
      lastText: "我剛剛講的秘密",
      recentTranscripts: ["機密一", "機密二"],
    },
    activeDays: 42,
    version: "1.0.30",
    platform: "win32",
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    "activeDays", "leaderboardOptIn", "platform",
    "totalChars", "totalSeconds", "totalSessions", "version",
  ]);
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes("秘密"), "上傳內容不可含辨識文字");
  assert.ok(!serialized.includes("機密"), "上傳內容不可含辨識文字");
});

test("數值正確對應本機統計欄位", () => {
  const p = buildPayload({
    stats: { totalChars: 100, total: 7, totalDuration: 58.9 },
    activeDays: 3,
  });
  assert.equal(p.totalChars, 100);
  assert.equal(p.totalSessions, 7);
  assert.equal(p.totalSeconds, 58, "秒數取整數");
  assert.equal(p.activeDays, 3);
});

test("缺資料或壞資料一律歸零，不會送出 NaN", () => {
  const p = buildPayload({});
  assert.equal(p.totalChars, 0);
  assert.equal(p.totalSessions, 0);
  assert.equal(p.totalSeconds, 0);
  assert.equal(p.activeDays, 0);
  for (const v of Object.values(p)) {
    assert.ok(typeof v !== "number" || Number.isFinite(v));
  }
});

test("負數不會被送出去", () => {
  const p = buildPayload({ stats: { totalChars: -999, total: -1, totalDuration: -5 }, activeDays: -3 });
  assert.equal(p.totalChars, 0);
  assert.equal(p.totalSessions, 0);
  assert.equal(p.totalSeconds, 0);
  assert.equal(p.activeDays, 0);
});

test("版本與平台字串會截斷，不會變成夾帶欄位", () => {
  const p = buildPayload({ stats: {}, version: "x".repeat(100), platform: "y".repeat(100) });
  assert.equal(p.version.length, 20);
  assert.equal(p.platform.length, 20);
});

test("可以選擇不上排行榜", () => {
  assert.equal(buildPayload({ stats: {} }).leaderboardOptIn, true);
  assert.equal(buildPayload({ stats: {}, leaderboardOptIn: false }).leaderboardOptIn, false);
});
