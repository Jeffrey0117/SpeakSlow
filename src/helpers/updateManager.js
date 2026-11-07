// 自動更新（electron-updater，GitHub Releases 為更新源）。
// 僅 Windows 啟用：macOS 未簽章時 electron-updater 會拒絕更新（Squirrel.Mac 要求簽章），
// Linux AppImage 之後再開。更新流程不打擾使用者：背景下載，下載完提示一次，
// 不管選什麼，下次關閉程式時都會自動裝好。
const { app, dialog } = require("electron");

// 主進程的對話框文案（跟著介面語言走；主進程拿不到 renderer 的 i18n，自備小表）
const STRINGS = {
  "zh-TW": {
    title: "聲聲慢更新",
    message: (v) => `新版本 v${v} 已下載完成`,
    detail: "可以立即重啟完成更新，或下次關閉程式時自動安裝。",
    restart: "立即重啟更新",
    later: "之後再說",
  },
  "zh-CN": {
    title: "声声慢更新",
    message: (v) => `新版本 v${v} 已下载完成`,
    detail: "可以立即重启完成更新，或下次关闭程序时自动安装。",
    restart: "立即重启更新",
    later: "以后再说",
  },
  en: {
    title: "SpeakSlow Update",
    message: (v) => `Version v${v} has been downloaded`,
    detail: "Restart now to apply, or it will install automatically next time you quit.",
    restart: "Restart Now",
    later: "Later",
  },
};

function setupAutoUpdater({ logger, databaseManager }) {
  if (process.platform !== "win32") return;
  if (!app.isPackaged) {
    logger.info("[updater] 開發模式，略過自動更新");
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    logger.warn("[updater] electron-updater 載入失敗，略過自動更新", { message: e.message });
    return;
  }

  autoUpdater.logger = {
    info: (m) => logger.info(`[updater] ${m}`),
    warn: (m) => logger.warn(`[updater] ${m}`),
    error: (m) => logger.warn(`[updater] ${m}`), // 更新失敗不算 app 錯誤，降為 warn
    debug: () => {},
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // 沒按「立即重啟」也會在退出時自動安裝

  let notified = false; // 同一版本只提示一次
  autoUpdater.on("update-downloaded", (info) => {
    if (notified) return;
    notified = true;
    let lang = "zh-TW";
    try {
      const v = databaseManager?.getSetting?.("language", "zh-TW");
      if (STRINGS[v]) lang = v;
    } catch (e) { /* 用預設語言 */ }
    const s = STRINGS[lang];
    dialog
      .showMessageBox({
        type: "info",
        buttons: [s.restart, s.later],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: s.title,
        message: s.message(info.version),
        detail: s.detail,
      })
      .then((r) => {
        if (r.response === 0) autoUpdater.quitAndInstall();
      })
      .catch(() => {});
  });

  // 檢查失敗後的短期重試：新版 release 建立的當下，安裝檔還要數分鐘才上傳完，
  // 這段空窗期查到的是「有新版但沒有 latest.yml」→ 404。若等滿 4 小時才重試，
  // 使用者會白白晚半天才拿到更新。失敗就改成 10 分鐘後再試，最多補 3 次。
  const RETRY_DELAY = 10 * 60 * 1000;
  const MAX_RETRIES = 3;
  let retriesLeft = MAX_RETRIES;
  let retryTimer = null;

  autoUpdater.on("error", (e) => {
    // 離線/網路問題屬正常情境，安靜記錄即可
    logger.warn("[updater] 更新檢查失敗（不影響使用）", { message: String(e?.message || e).slice(0, 200) });
    if (retriesLeft > 0 && !retryTimer) {
      retriesLeft -= 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        check();
      }, RETRY_DELAY);
      logger.info(`[updater] 10 分鐘後重試（剩 ${retriesLeft} 次）`);
    }
  });

  // 成功查到結果就把重試額度補回來，供下一輪使用
  const resetRetries = () => { retriesLeft = MAX_RETRIES; };
  autoUpdater.on("update-available", resetRetries);
  autoUpdater.on("update-not-available", resetRetries);

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000); // 啟動後 15 秒再查，避開啟動期（模型載入）資源競爭
  setInterval(check, 4 * 60 * 60 * 1000); // 長開機器每 4 小時再查
  logger.info("[updater] 自動更新已啟用（啟動後 15 秒首查，每 4 小時重查，失敗則 10 分鐘後重試）");
}

module.exports = { setupAutoUpdater };
