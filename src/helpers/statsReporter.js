// 使用統計上傳（預設關閉，要使用者在設定裡登入並明確開啟）。
//
// 只送計數：總字數、次數、總秒數、使用天數，外加版本與平台。
// **絕不送任何辨識內容**——這是聲聲慢「聲音不離開你的電腦」承諾的一部分，
// 送什麼就寫在 buildPayload 裡，一眼看得完。

const https = require("node:https");
const http = require("node:http");
const { URL } = require("node:url");

const DEFAULT_ENDPOINT = "https://speakslow-stats.isnowfriend.com";
const UPLOAD_INTERVAL = 6 * 60 * 60 * 1000; // 每 6 小時一次就夠，這不是即時資料
const FIRST_DELAY = 60 * 1000; // 啟動一分鐘後再送，別跟模型載入搶資源

/**
 * 從本機統計組出要上傳的內容。獨立成純函式，方便驗證「到底送了什麼」。
 */
function buildPayload({ stats, activeDays, version, platform, leaderboardOptIn }) {
  return {
    totalChars: Math.max(0, Math.floor(Number(stats?.totalChars) || 0)),
    totalSessions: Math.max(0, Math.floor(Number(stats?.total) || 0)),
    totalSeconds: Math.max(0, Math.floor(Number(stats?.totalDuration) || 0)),
    activeDays: Math.max(0, Math.floor(Number(activeDays) || 0)),
    version: String(version || "").slice(0, 20),
    platform: String(platform || "").slice(0, 20),
    leaderboardOptIn: leaderboardOptIn !== false,
  };
}

function postJson(endpoint, path, body, token, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, endpoint);
    const lib = url.protocol === "http:" ? http : https;
    const data = Buffer.from(JSON.stringify(body), "utf8");
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length,
          Authorization: `Bearer ${token}`,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(text)); } catch (e) { resolve({}); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    req.end(data);
  });
}

class StatsReporter {
  constructor({ databaseManager, logger, app }) {
    this.db = databaseManager;
    this.logger = logger;
    this.app = app;
    this.timer = null;
  }

  isEnabled() {
    try {
      return this.db?.getSetting?.("stats_upload_enabled", false) === true;
    } catch (e) {
      return false;
    }
  }

  getToken() {
    try {
      const t = this.db?.getSetting?.("letmeuse_token", null);
      return typeof t === "string" && t ? t : null;
    } catch (e) {
      return null;
    }
  }

  async uploadOnce() {
    if (!this.isEnabled()) return { skipped: "disabled" };
    const token = this.getToken();
    if (!token) return { skipped: "not-logged-in" };

    const endpoint = this.db?.getSetting?.("stats_endpoint", DEFAULT_ENDPOINT) || DEFAULT_ENDPOINT;
    const payload = buildPayload({
      stats: this.db.getTranscriptionStats(),
      activeDays: this.db.getActiveDays(),
      version: this.app?.getVersion?.(),
      platform: process.platform,
      leaderboardOptIn: this.db?.getSetting?.("stats_leaderboard_optin", true) !== false,
    });

    try {
      const res = await postJson(endpoint, "/api/stats", payload, token);
      this.logger?.info?.("使用統計已上傳", { totalChars: payload.totalChars });
      return { ok: true, res };
    } catch (e) {
      // 上傳失敗完全不影響使用，下一輪再試即可
      this.logger?.warn?.("使用統計上傳失敗（不影響使用）", { message: e.message });
      return { ok: false, error: e.message };
    }
  }

  start() {
    this.stop();
    // 啟動後延遲一分鐘，再每 6 小時一次
    this.timer = setTimeout(() => {
      this.uploadOnce().catch(() => {});
      this.timer = setInterval(() => this.uploadOnce().catch(() => {}), UPLOAD_INTERVAL);
    }, FIRST_DELAY);
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

module.exports = { StatsReporter, buildPayload, DEFAULT_ENDPOINT };
