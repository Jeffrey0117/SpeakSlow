// 純函式:代理 Agent 排程的時間計算。type: "once" | "daily" | "weekly"。
//  once  : at = 絕對 epoch ms。
//  daily : time = "HH:MM"(每天該時刻)。
//  weekly: time = "HH:MM" + dow = 0(日)~6(六)。
// 全部用本地時間;fromMs 為計算基準(通常 Date.now()),方便單元測試帶固定時間。

function computeNextRun(spec, fromMs) {
  const { type, at, time, dow } = spec || {};
  if (type === "once") return typeof at === "number" ? at : fromMs;

  const [h, m] = String(time || "00:00").split(":").map((x) => parseInt(x, 10) || 0);
  const base = new Date(fromMs);
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0);

  if (type === "weekly") {
    const target = ((parseInt(dow, 10) || 0) % 7 + 7) % 7;
    let delta = (target - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + delta);
    if (next.getTime() <= fromMs) next.setDate(next.getDate() + 7);
    return next.getTime();
  }
  // daily
  if (next.getTime() <= fromMs) next.setDate(next.getDate() + 1);
  return next.getTime();
}

// 回傳 { due: 到期要執行的排程[], kept: 更新後要保留的排程[] }。
//  once 到期 → 不留(執行一次)。daily/weekly 到期 → 保留並把 nextRun 推到下一次。
function processDue(schedules, nowMs) {
  const due = [];
  const kept = [];
  for (const s of schedules || []) {
    if (typeof s.nextRun === "number" && nowMs >= s.nextRun) {
      due.push(s);
      if (s.type === "once") continue; // 一次性:執行後移除
      kept.push({ ...s, nextRun: computeNextRun(s, nowMs + 1000) }); // 週期:算下一次
    } else {
      kept.push(s);
    }
  }
  return { due, kept };
}

module.exports = { computeNextRun, processDue };
