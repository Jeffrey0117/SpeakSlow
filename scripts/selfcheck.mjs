#!/usr/bin/env node
/**
 * 自我稽核：抓「不會報錯、但其實壞掉」的那種 bug。
 *
 * 由來（2026-11-07 一天之內踩到四個，全部是同一個形狀）：
 *
 *   剪貼簿還原從沒執行    log 乾淨      ← 數次數：122 次貼上 / 0 次還原
 *   lite 版 tar 解壓失敗  下載完就卡    ← 斷言：tar 參數不准有冒號
 *   CI 把安裝檔掛錯版本   三個建置全綠  ← 數資產：該 tag 0 個檔案
 *   錄音錄到兩倍長度      只有疊字      ← 比長度：檔案 14.9s / 實際 7.5s
 *
 * 共同點：每一個都有一條「本來就該恆成立」的簡單關係，而且沒人在檢查。
 * 這不是測試不夠多的問題——沒想到的 bug 寫不出測試；是**不變量**沒被盯著。
 *
 * 所以這支工具不驗「功能對不對」，它驗「關係還成不成立」，並且每一條都註明
 * 它是從哪個真實事故來的，這樣下次有人想刪掉某條檢查時知道代價。
 *
 * 用法：npm run selfcheck            （看最近 7 天）
 *       npm run selfcheck -- --all   （看全部歷史）
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ALL = process.argv.includes("--all");
const DAYS = ALL ? 36500 : 7;

const APPDATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const LOG = path.join(APPDATA, "speakslow", "logs", "app.log");
const DB = path.join(APPDATA, "聲聲慢", "transcriptions.db");

const results = [];
let dbError = null;
const pass = (name, detail) => results.push({ ok: true, name, detail });
const fail = (name, detail, origin) => results.push({ ok: false, name, detail, origin });
const skip = (name, why) => results.push({ skip: true, name, detail: why });

// ───────────────────────── 讀取資料 ─────────────────────────

function readLog() {
  if (!fs.existsSync(LOG)) return null;
  const cutoff = Date.now() - DAYS * 86400_000;
  const out = [];
  for (const line of fs.readFileSync(LOG, "utf8").split("\n")) {
    if (!line.startsWith("{")) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const t = Date.parse(d.timestamp || "");
    if (!Number.isFinite(t) || t < cutoff) continue;
    out.push({ t, level: d.level, msg: String(d.message || ""), data: String(d.data ?? ""), pid: d.pid });
  }
  return out;
}

function readDb() {
  if (!fs.existsSync(DB)) return null;
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 19).replace("T", " ");
  // 用專案本來就有的 better-sqlite3。這兩條 DB 檢查就是今天抓到「錄音兩倍長」
  // 的那兩條，第一版寫成「靠 sqlite3 CLI，沒有就跳過」，結果這台機器沒裝 CLI，
  // 最有價值的檢查全部顯示「沒有辨識紀錄」——等於白做。
  try {
    const Database = createRequire(import.meta.url)("better-sqlite3");
    const db = new Database(DB, { readonly: true, fileMustExist: true });
    try {
      return db
        .prepare("SELECT id, created_at, duration, text FROM transcriptions WHERE created_at >= ? ORDER BY id")
        .all(since);
    } finally {
      db.close();
    }
  } catch (e) {
    dbError = e.message;
    return undefined; // undefined = 讀不到，與「讀到空」區分開
  }
}
const count = (log, needle) => log.filter((e) => e.msg.includes(needle) || e.data.includes(needle)).length;

// ───────────────────────── 檢查 ─────────────────────────

/** 1) 錄音長度 vs 牆上時鐘。來源：孤兒音訊節點害音訊變兩倍長（2026-11-07） */
function checkRecordingDuration(log, rows) {
  const name = "錄音長度 ≈ 實際講話時間";
  if (!rows || !rows.length) return skip(name, "沒有辨識紀錄");

  // 停止/取消會被多個模組各記一次 → 先把 1.5 秒內的重複事件收斂掉，
  // 否則配對會把錄音對到錯誤的起點（實測看到 0.09x 這種離譜比值全是配錯）
  const dedupe = (arr) => arr.filter((t, k) => k === 0 || t - arr[k - 1] > 1500);
  const starts = dedupe(log.filter((e) => e.msg.includes("開始錄音")).map((e) => e.t));
  const stops = dedupe(log.filter((e) => e.msg.includes("停止錄音")).map((e) => e.t));

  const samples = [];
  for (const r of rows) {
    // 短錄音的起停邊界、第一個 buffer 的延遲會造成很大的比例偏差 → 不納入判斷
    if (!(r.duration >= 4)) continue;
    const created = Date.parse(r.created_at.replace(" ", "T") + "Z");
    const stop = stops.filter((t) => Math.abs(t - created) < 8000).sort(
      (a, b) => Math.abs(a - created) - Math.abs(b - created))[0];
    if (!stop) continue;
    const start = starts.filter((t) => t < stop).pop();
    if (!start) continue;
    const wall = (stop - start) / 1000;
    if (wall < 4) continue;
    samples.push({ id: r.id, ratio: r.duration / wall, dur: r.duration, wall });
  }
  if (samples.length < 3) return skip(name, `可配對的錄音太少（${samples.length} 筆）`);

  const sorted = [...samples].map((x) => x.ratio).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // 單筆離群是雜訊（配對誤差、系統排程）；真正的 bug 會讓**一整串**同向偏掉
  // ——今天那次是連續 9 筆都落在 1.97~2.00x。所以看中位數 + 連續同向偏移。
  let cur = [], worst = [];
  for (const x of samples) {
    if (x.ratio > 1.25 || x.ratio < 0.75) {
      cur.push(x);
      if (cur.length > worst.length) worst = [...cur]; // 要留最長那一段，不是當下那段
    } else {
      cur = [];
    }
  }
  const worstRun = worst.length;
  const runIds = worst.map((x) => `#${x.id} ${x.ratio.toFixed(2)}x（${x.dur.toFixed(1)}s / ${x.wall.toFixed(1)}s）`);
  const medianOff = median > 1.15 || median < 0.85;

  if (medianOff || worstRun >= 3) {
    const why = medianOff
      ? `中位數 ${median.toFixed(2)}x（${samples.length} 筆）`
      : `連續 ${worstRun} 筆同向偏離：` + runIds.slice(0, 5).map((x) => "\n      " + x).join("");
    return fail(name, why,
      "孤兒音訊節點（兩組同時收音）會讓音訊變兩倍長 → 辨識聽成疊字。重開 app 可立即止血");
  }
  const outliers = samples.filter((x) => x.ratio > 1.25 || x.ratio < 0.75).length;
  pass(name, `${samples.length} 筆，中位數 ${median.toFixed(2)}x`
    + (outliers ? `（${outliers} 筆單點離群，未達連續 3 筆，視為雜訊）` : ""));
}

/** 2) 疊字率。來源：同上，這是它在文字端留下的指紋 */
function checkStutter(rows) {
  const name = "辨識結果沒有異常疊字";
  if (!rows || !rows.length) return skip(name, "沒有辨識紀錄");
  const bad = [];
  let checked = 0;
  for (const r of rows) {
    const cjk = (r.text || "").match(/[一-鿿]/g) || [];
    if (cjk.length < 12) continue;
    checked++;
    let dup = 0;
    for (let i = 0; i < cjk.length - 1; i++) if (cjk[i] === cjk[i + 1]) dup++;
    const ratio = dup / (cjk.length - 1);
    if (ratio >= 0.12) bad.push(`#${r.id} ${(ratio * 100).toFixed(0)}%  ${(r.text || "").slice(0, 28)}`);
  }
  if (!checked) return skip(name, "沒有足夠長的辨識結果");
  if (bad.length) {
    return fail(name, `${bad.length}/${checked} 筆相鄰重複字 ≥12%：\n      ` + bad.slice(0, 6).join("\n      "),
      "正常中文幾乎不會這樣；通常是音訊被拉長或重複餵入");
  }
  pass(name, `${checked} 筆都正常`);
}

/** 3) 每次貼上都要有明確的剪貼簿處置。來源：Electron 45 改非同步，還原整段靜默不執行 */
function checkClipboardAccounting(fullLog) {
  const name = "每次貼上都有明確的剪貼簿處置";
  const DISPOSE = ["已還原使用者原本的剪貼簿", "聽寫文字留在剪貼簿", "剪貼簿還原多次失敗"];
  const pastes = fullLog.filter((e) => e.msg.includes("pasteText")).map((e) => e.t);
  const disposals = fullLog.filter((e) => DISPOSE.some((d) => e.msg.includes(d))).map((e) => e.t);
  if (!pastes.length) return skip(name, "期間沒有貼上");

  // 逐筆配對：每次貼上之後 5 秒內該出現一筆處置紀錄。
  // 第一版是比總量（165 次貼上 vs 40 次處置），但那個數字會橫跨修復前後，
  // 靠門檻才勉強不報警——等於這條檢查其實失去了判斷力。
  const recent = pastes.slice(-40); // 只看最近 40 次，驗「現在的行為」
  const orphan = recent.filter((t) => !disposals.some((d) => d >= t - 500 && d <= t + 5000));
  if (orphan.length > recent.length * 0.2) {
    const when = new Date(orphan[orphan.length - 1]).toISOString().slice(11, 19);
    return fail(name, `最近 ${recent.length} 次貼上裡，${orphan.length} 次之後沒有任何剪貼簿處置紀錄（最後一次 ${when}）`,
      "Electron 45 把剪貼簿 API 改成非同步，舊的同步寫法會讓整段靜默跳過（曾經 122 次貼上 / 0 次還原）");
  }
  pass(name, `最近 ${recent.length} 次貼上，${recent.length - orphan.length} 次有處置紀錄`);
}

/** 4) 錄音事件要配對得起來 */
function checkRecordingPairing(log) {
  const name = "錄音開始/結束配對";
  const starts = count(log, "開始錄音");
  if (!starts) return skip(name, "期間沒有錄音");
  const stops = count(log, "停止錄音");
  const cancels = count(log, "取消錄音");
  const ends = stops + cancels;
  // 停止/取消會被多個模組各記一次，所以只抓「結束明顯少於開始」這種真問題
  if (ends < starts * 0.8) {
    return fail(name, `開始 ${starts} 次，結束只有 ${ends} 次（停止 ${stops} / 取消 ${cancels}）`,
      "有錄音沒有走到結束流程，可能卡在錄音狀態");
  }
  pass(name, `開始 ${starts} / 停止 ${stops} / 取消 ${cancels}`);
}

/** 5) 麥克風退回路徑的頻率。來源：失效的 deviceId 是孤兒節點那個 bug 的觸發條件 */
function checkMicFallback(log) {
  const name = "麥克風設定仍然有效";
  const starts = count(log, "開始錄音");
  const fb = count(log, "指定的麥克風不可用");
  if (!starts) return skip(name, "期間沒有錄音");
  if (fb === 0) return pass(name, "沒有走過退回路徑");
  const rate = fb / starts;
  if (rate > 0.3) {
    return fail(name, `${starts} 次錄音裡有 ${fb} 次走退回路徑（${(rate * 100).toFixed(0)}%）`,
      "設定裡存的麥克風 deviceId 已失效。那條路徑很慢（實測 3.7 秒），是競態的溫床；請到設定重新選一次麥克風");
  }
  pass(name, `${fb}/${starts} 次退回（偶發，可接受）`);
}

/** 6) 執行期自我檢查有沒有叫過 */
function checkRuntimeAlarms(log) {
  const name = "執行期沒有長度異常警報";
  const n = count(log, "錄音長度異常");
  if (n) {
    return fail(name, `記錄檔裡有 ${n} 筆「錄音長度異常」`,
      "這是 recordingSanity 的執行期警報，代表當時真的錄到不對的長度");
  }
  pass(name, "無");
}

/** 7) 最新 release 的資產完整性。來源：CI 把安裝檔掛到舊版的 release 上（2026-11-07） */
function checkRelease() {
  const name = "最新 release 的安裝檔齊全";
  const EXPECT = ["SpeakSlow-Setup.exe", "SpeakSlow-Setup-lite.exe", "SpeakSlow-arm64.dmg",
                  "SpeakSlow-x64.dmg", "SpeakSlow.AppImage", "latest.yml"];
  let json;
  try {
    json = JSON.parse(execFileSync("gh", ["release", "view", "--json", "tagName,assets"],
      { encoding: "utf8", windowsHide: true }));
  } catch {
    return skip(name, "gh 不可用或未登入");
  }
  const names = (json.assets || []).map((a) => a.name);
  const missing = EXPECT.filter((e) => !names.includes(e));
  const pkgVer = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  const tagVer = String(json.tagName || "").replace(/^v/, "");

  const problems = [];
  if (missing.length) problems.push(`缺少：${missing.join("、")}`);
  if (tagVer !== pkgVer) problems.push(`最新 release 是 ${json.tagName}，但 package.json 是 ${pkgVer}（版本沒發或沒掛對）`);
  if (problems.length) {
    return fail(name, problems.join("；"),
      "CI 的上傳步驟曾經取「最新的 release」而不是觸發建置的 tag，導致新版沒有檔案、舊版被覆蓋");
  }
  pass(name, `${json.tagName} 七個檔案齊全`);
}

// ───────────────────────── 執行 ─────────────────────────

const log = readLog();
if (!log) {
  console.error(`讀不到記錄檔：${LOG}`);
  process.exit(2);
}
const rows = readDb();

checkRecordingDuration(log, rows);
checkStutter(rows);
checkClipboardAccounting(log);
checkRecordingPairing(log);
checkMicFallback(log);
checkRuntimeAlarms(log);
checkRelease();

const span = ALL ? "全部歷史" : "最近 7 天";
console.log(`\n聲聲慢自我稽核（${span}，${log.length} 筆記錄${rows === undefined ? `，DB 讀取失敗：${dbError}` : rows ? `、${rows.length} 筆辨識` : ""}）\n`);
let bad = 0;
for (const r of results) {
  if (r.skip) { console.log(`  －  ${r.name}：${r.detail}`); continue; }
  if (r.ok) { console.log(`  ✓  ${r.name}：${r.detail}`); continue; }
  bad++;
  console.log(`  ✗  ${r.name}`);
  console.log(`     ${r.detail}`);
  if (r.origin) console.log(`     ↳ ${r.origin}`);
}
console.log(bad ? `\n${bad} 項不通過。\n` : "\n全部通過。\n");
process.exit(bad ? 1 : 0);
