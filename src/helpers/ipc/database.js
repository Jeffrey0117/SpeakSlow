const { ipcMain } = require("electron");

module.exports = function register(ctx) {
  // 数据库相关
  ipcMain.handle("save-transcription", (event, data) => {
    return ctx.databaseManager.saveTranscription(data);
  });

  ipcMain.handle("get-transcriptions", (event, limit, offset) => {
    return ctx.databaseManager.getTranscriptions(limit, offset);
  });

  ipcMain.handle("get-transcription", (event, id) => {
    return ctx.databaseManager.getTranscriptionById(id);
  });

  ipcMain.handle("delete-transcription", (event, id) => {
    return ctx.databaseManager.deleteTranscription(id);
  });

  ipcMain.handle("search-transcriptions", (event, query, limit) => {
    return ctx.databaseManager.searchTranscriptions(query, limit);
  });

  ipcMain.handle("get-transcription-stats", () => {
    return ctx.databaseManager.getTranscriptionStats();
  });

  ipcMain.handle("get-daily-stats", (event, days) => {
    return ctx.databaseManager.getDailyStats(days || 14);
  });

  ipcMain.handle("clear-all-transcriptions", () => {
    return ctx.databaseManager.clearAllTranscriptions();
  });

  // 设置相关
  ipcMain.handle("get-setting", (event, key, defaultValue) => {
    return ctx.databaseManager.getSetting(key, defaultValue);
  });

  ipcMain.handle("set-setting", (event, key, value) => {
    const result = ctx.databaseManager.setSetting(key, value);

    // 開機自動啟動：改了就即時套用到系統（登錄 Run 項）
    if (key === "launch_at_login" && process.platform === "win32") {
      try {
        const { app } = require("electron");
        if (app.isPackaged) {
          app.setLoginItemSettings({ openAtLogin: value !== false, args: ["--autostart"] });
        }
      } catch (e) { /* 設定值仍已存檔，下次啟動會再套用 */ }
    }

    // 廣播設定變更到所有視窗（用於跨視窗同步）
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('setting-changed', { key, value });
      }
    });

    return result;
  });

  ipcMain.handle("get-all-settings", () => {
    return ctx.databaseManager.getAllSettings();
  });

  ipcMain.handle("get-settings", () => {
    return ctx.databaseManager.getAllSettings();
  });

  ipcMain.handle("save-setting", (event, key, value) => {
    return ctx.databaseManager.setSetting(key, value);
  });

  ipcMain.handle("reset-settings", () => {
    // TODO: 实现重置设置功能
    return ctx.databaseManager.resetSettings();
  });

  // =====================================================
  // 文件操作
  ipcMain.handle("export-transcriptions", (event, format) => {
    // TODO: 实现导出转录功能
    return { success: true, path: "" };
  });

  ipcMain.handle("import-settings", () => {
    // TODO: 实现导入设置功能
    return { success: true };
  });

  ipcMain.handle("export-settings", () => {
    // TODO: 实现导出设置功能
    return { success: true, path: "" };
  });
};
