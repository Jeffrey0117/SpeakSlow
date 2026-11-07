const assert = require("node:assert/strict");
const test = require("node:test");

let mod;
test.before(async () => {
  mod = await import("../src/utils/recordingSanity.mjs");
});

// 2026-11-07 的真實數據：孤兒音訊節點害每次錄音都錄到兩倍長度的音訊，
// 使用者看到的只是辨識把每個字聽成疊字，log 完全乾淨。這組測試守著那道檢查。

test("正常錄音：音訊長度約等於實際時間", () => {
  const { checkRecordingSanity } = mod;
  // 48kHz 錄 10 秒
  const r = checkRecordingSanity(48000 * 10, 48000, 10_000);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.ratio - 1) < 0.01, `ratio=${r.ratio}`);
});

test("⛔ 兩倍長度（實際發生過的那個 bug）要被抓到", () => {
  const { checkRecordingSanity } = mod;
  // 真實案例 id=2118：檔案 14.9s、實際只講了 7.5s
  const r = checkRecordingSanity(48000 * 14.9, 48000, 7_500);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too-long");
  assert.ok(Math.abs(r.ratio - 2) < 0.02, `ratio=${r.ratio}`);
  assert.match(r.message, /重複餵入|疊字/, "訊息要講出可能原因，不然看到也不知道要查什麼");
});

test("⛔ 三倍長度也要抓到（取樣率算錯時會是 48k/16k=3）", () => {
  const { checkRecordingSanity } = mod;
  const r = checkRecordingSanity(48000 * 30, 48000, 10_000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too-long");
});

test("掉音訊（只錄到一半）也要抓到", () => {
  const { checkRecordingSanity } = mod;
  const r = checkRecordingSanity(48000 * 5, 48000, 10_000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too-short-audio");
  assert.match(r.message, /掉了音訊/);
});

test("±25% 以內不報警（排程抖動、起停邊界是正常的）", () => {
  const { checkRecordingSanity } = mod;
  for (const ratio of [0.8, 0.9, 1.0, 1.1, 1.2]) {
    const r = checkRecordingSanity(48000 * 10 * ratio, 48000, 10_000);
    assert.equal(r.ok, true, `ratio ${ratio} 不該報警`);
  }
});

test("太短的錄音不判斷（第一個 buffer 的延遲會造成大比例偏差）", () => {
  const { checkRecordingSanity } = mod;
  const r = checkRecordingSanity(48000 * 0.2, 48000, 800);
  assert.equal(r.ok, true);
  assert.equal(r.reason, "too-short");
});

test("取樣率為 0 / 異常時回報 bad-rate，不會算出 Infinity", () => {
  const { checkRecordingSanity } = mod;
  const r = checkRecordingSanity(1000, 0, 5_000);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-rate");
  assert.ok(Number.isFinite(r.ratio));
});

test("邊界剛好在門檻上不會誤判", () => {
  const { checkRecordingSanity, SANITY_MAX_RATIO, SANITY_MIN_RATIO } = mod;
  const just_ok = checkRecordingSanity(48000 * 10 * SANITY_MAX_RATIO, 48000, 10_000);
  assert.equal(just_ok.ok, true, "剛好等於上限視為正常");
  const over = checkRecordingSanity(48000 * 10 * (SANITY_MAX_RATIO + 0.05), 48000, 10_000);
  assert.equal(over.ok, false);
  const just_ok2 = checkRecordingSanity(48000 * 10 * SANITY_MIN_RATIO, 48000, 10_000);
  assert.equal(just_ok2.ok, true);
});
