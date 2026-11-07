const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

// recovery.js 需要 electron 的 app.getPath。與其複製一份邏輯重跑（會跟本體飄移），
// 直接在 require.cache 塞一個假的 electron，測真正的模組。
const dataDir = path.join(os.tmpdir(), `speakslow-recovery-test-${crypto.randomUUID()}`);
fs.mkdirSync(dataDir, { recursive: true });

const electronId = require.resolve("electron");
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: { app: { getPath: () => dataDir } },
};

const recovery = require("../src/helpers/recovery");

const pcmFile = path.join(dataDir, ".recovery.pcm");

// N 秒的 16kHz mono PCM16
function makePcm(seconds) {
  return Buffer.alloc(Math.round(16000 * seconds) * 2, 1);
}

// 只記下 saveTranscription 收到什麼，不碰真的 sqlite
function fakeDb() {
  const saved = [];
  return { saved, saveTranscription: (row) => saved.push(row) };
}

function reset() {
  recovery.end(); // 關串流 + 刪暫存
  try { fs.rmSync(path.join(dataDir, "audio"), { recursive: true, force: true }); } catch (e) {}
}

test.afterEach(reset);

test("正常關閉（沒有遺留檔）不會寫出垃圾歷史", () => {
  const db = fakeDb();
  recovery.recoverOnStartup(db, null);
  assert.equal(db.saved.length, 0);
});

test("太短的遺留錄音不入歷史，但暫存檔要清掉", () => {
  fs.writeFileSync(pcmFile, makePcm(0.5)); // 低於 1.5 秒門檻
  const db = fakeDb();
  recovery.recoverOnStartup(db, null);
  assert.equal(db.saved.length, 0);
  assert.equal(fs.existsSync(pcmFile), false, "太短也要刪，否則永遠卡在那裡");
});

test("被砍掉的錄音會救回一筆未轉錄歷史", () => {
  fs.writeFileSync(pcmFile, makePcm(7));
  const db = fakeDb();
  recovery.recoverOnStartup(db, null);

  assert.equal(db.saved.length, 1);
  const row = db.saved[0];
  assert.match(row.text, /重新辨識/, "文字要讓使用者知道下一步按什麼");
  assert.equal(row.duration, 7);
  assert.ok(row.audio_path, "沒有 audio_path 的話重新辨識無從下手");
  assert.equal(
    path.dirname(row.audio_path),
    path.join(dataDir, "audio"),
    "要和正常錄音同一個資料夾，否則保留期清理掃不到"
  );
  assert.equal(fs.existsSync(row.audio_path), true);
});

test("救回的 WAV 是辨識器吃得下的格式（16kHz mono 16bit，長度欄位正確）", () => {
  fs.writeFileSync(pcmFile, makePcm(3));
  const db = fakeDb();
  recovery.recoverOnStartup(db, null);

  const wav = fs.readFileSync(db.saved[0].audio_path);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1, "聲道數");
  assert.equal(wav.readUInt32LE(24), 16000, "取樣率要與辨識用的一致");
  assert.equal(wav.readUInt16LE(34), 16, "位元深度");
  // 長度欄位算錯的話播放器會爆或讀到雜訊
  assert.equal(wav.readUInt32LE(40), wav.length - 44, "data chunk 長度");
  assert.equal(wav.readUInt32LE(4), wav.length - 8, "RIFF 長度");
});

test("救回後再開機不會重複救同一段", () => {
  fs.writeFileSync(pcmFile, makePcm(5));
  const first = fakeDb();
  recovery.recoverOnStartup(first, null);
  assert.equal(first.saved.length, 1);

  const second = fakeDb();
  recovery.recoverOnStartup(second, null);
  assert.equal(second.saved.length, 0, "暫存檔沒刪乾淨會每次開機都多一筆");
});

test("錄音中會持續寫入暫存檔", async () => {
  recovery.begin();
  recovery.append(makePcm(2).toString("base64"));
  await new Promise((r) => setTimeout(r, 200)); // 等串流落地

  assert.equal(fs.existsSync(pcmFile), true);
  assert.ok(fs.statSync(pcmFile).size >= 64000, "寫進去的量要對得上 append 的內容");
});

test("正常停止錄音後不會被誤認成崩潰", async () => {
  recovery.begin();
  recovery.append(makePcm(4).toString("base64"));
  await new Promise((r) => setTimeout(r, 200));
  recovery.end();

  const db = fakeDb();
  recovery.recoverOnStartup(db, null);
  assert.equal(db.saved.length, 0, "正常講完的話已經存過了，再救一次就是重複歷史");
});

test("begin() 會丟掉上一輪的殘留，不把兩次錄音接在一起", async () => {
  fs.writeFileSync(pcmFile, makePcm(10));
  recovery.begin();
  recovery.append(makePcm(2).toString("base64"));
  await new Promise((r) => setTimeout(r, 200));

  const size = fs.statSync(pcmFile).size;
  assert.ok(size < 16000 * 2 * 5, `殘留沒清掉會黏成一段，實際 ${size} bytes`);
});

test("沒有資料庫也不該丟例外（救援失敗不能擋開機）", () => {
  fs.writeFileSync(pcmFile, makePcm(5));
  assert.doesNotThrow(() => recovery.recoverOnStartup(null, null));
  assert.equal(fs.existsSync(pcmFile), false);
});
