const { ipcMain } = require("electron");

module.exports = function register(ctx) {
  // 剪贴板相关
  ipcMain.handle("copy-text", async (event, text) => {
    try {
      return await ctx.clipboardManager.copyText(text);
    } catch (error) {
      ctx.logger.error("复制文本失败:", error);
      return { success: false, error: error.message };
    }
  });

  // 「主控台輸入方式」的唯一合法值白名單：auto（偵測自動切換）/ type（一律逐字打字）/ paste（一律貼上）
  const CONSOLE_INPUT_MODES = ["auto", "type", "paste"];
  ipcMain.handle("paste-text", async (event, text) => {
    // 讀設定並以白名單收斂：非合法值一律當 auto，避免把任意值往下傳
    let consoleInputMode = "auto";
    try {
      const v = ctx.databaseManager?.getSetting?.("console_input_method", "auto");
      consoleInputMode = CONSOLE_INPUT_MODES.includes(v) ? v : "auto";
    } catch (e) { /* 讀取失敗就用預設 auto */ }
    return ctx.clipboardManager.pasteText(text, { consoleInputMode });
  });

  // 發送 Enter 鍵（完全信任模式）
  ipcMain.handle("send-enter", async () => {
    return ctx.clipboardManager.sendEnter();
  });

  ipcMain.handle("insert-text-directly", async (event, text) => {
    try {
      return await ctx.clipboardManager.insertTextDirectly(text);
    } catch (error) {
      ctx.logger.error("直接插入文本失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("enable-macos-accessibility", async () => {
    try {
      if (process.platform === "darwin") {
        const result = await ctx.clipboardManager.enableMacOSAccessibility();
        return { success: result };
      }
      return { success: true, message: "非 macOS 平台，无需设置" };
    } catch (error) {
      ctx.logger.error("启用 macOS accessibility 失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("read-clipboard", async () => {
    try {
      const text = await ctx.clipboardManager.readClipboard();
      return { success: true, text };
    } catch (error) {
      ctx.logger.error("读取剪贴板失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("write-clipboard", async (event, text) => {
    try {
      return await ctx.clipboardManager.writeClipboard(text);
    } catch (error) {
      ctx.logger.error("写入剪贴板失败:", error);
      return { success: false, error: error.message };
    }
  });

  // 焦點管理 - 儲存和恢復前景視窗
  ipcMain.handle("save-foreground-window", () => {
    try {
      return ctx.clipboardManager.saveForegroundWindow();
    } catch (error) {
      ctx.logger.error("儲存前景視窗失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("restore-foreground-window", async () => {
    try {
      return await ctx.clipboardManager.restoreForegroundWindow();
    } catch (error) {
      ctx.logger.error("恢復前景視窗失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-clipboard-history", () => {
    // TODO: 实现剪贴板历史功能
    return [];
  });

  ipcMain.handle("clear-clipboard-history", () => {
    // TODO: 实现清除剪贴板历史功能
    return true;
  });

  // 窗口管理相关
  ipcMain.handle("hide-window", () => {
    if (ctx.windowManager.mainWindow) {
      ctx.windowManager.mainWindow.hide();
    }
    return true;
  });

  ipcMain.handle("show-window", () => {
    if (ctx.windowManager.mainWindow) {
      ctx.windowManager.mainWindow.show();
    }
    return true;
  });

  ipcMain.handle("minimize-window", () => {
    if (ctx.windowManager.mainWindow) {
      ctx.windowManager.mainWindow.minimize();
    }
    return true;
  });

  ipcMain.handle("close-window", () => {
    if (ctx.windowManager.mainWindow) {
      ctx.windowManager.mainWindow.close();
    }
    return true;
  });

  ipcMain.handle("show-control-panel", () => {
    ctx.windowManager.showControlPanel();
    return true;
  });

  ipcMain.handle("hide-control-panel", () => {
    ctx.windowManager.hideControlPanel();
    return true;
  });

  ipcMain.handle("open-control-panel", () => {
    ctx.windowManager.showControlPanel();
    return true;
  });

  ipcMain.handle("close-control-panel", () => {
    ctx.windowManager.hideControlPanel();
    return true;
  });

  ipcMain.handle("open-history-window", () => {
    ctx.windowManager.showHistoryWindow();
    return true;
  });

  ipcMain.handle("close-history-window", () => {
    ctx.windowManager.closeHistoryWindow();
    return true;
  });

  ipcMain.handle("hide-history-window", () => {
    ctx.windowManager.hideHistoryWindow();
    return true;
  });

  ipcMain.handle("open-settings-window", () => {
    ctx.windowManager.showSettingsWindow();
    return true;
  });

  ipcMain.handle("close-settings-window", () => {
    ctx.windowManager.closeSettingsWindow();
    return true;
  });

  ipcMain.handle("hide-settings-window", () => {
    ctx.windowManager.hideSettingsWindow();
    return true;
  });

  ipcMain.handle("close-app", () => {
    require("electron").app.quit();
  });

  // =====================================================
  // 視窗控制設定 API
  // =====================================================

  // 設置主視窗置頂狀態
  ipcMain.handle("set-mini-mode", async (event, enabled) => {
    try { return ctx.windowManager.setMiniMode(enabled); }
    catch (error) { return { success: false, error: error.message }; }
  });

  // 渲染端重載後查詢目前是否迷你（同步狀態，避免視窗尺寸與版面錯位）
  ipcMain.handle("get-mini-mode", async () => {
    try { return ctx.windowManager.getMiniState(); }
    catch (error) { return false; }
  });

  // 操作模式狀態：主視窗 toggle 時鏡像到主行程 → 廣播給錄音指示器藥丸
  ipcMain.handle("set-command-mode", async (event, enabled) => {
    try { return ctx.windowManager.setCommandMode(enabled); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle("get-command-mode", async () => {
    try { return ctx.windowManager.getCommandMode(); }
    catch (error) { return false; }
  });

  // 視窗透明度（迷你 / 一般共用）：套用 + 存設定
  ipcMain.handle("set-window-opacity", async (event, value) => {
    try {
      const res = ctx.windowManager.setWindowOpacity(value);
      try { ctx.databaseManager?.setSetting?.('window_opacity', res.opacity); } catch (e) { /* ignore */ }
      return res;
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle("set-always-on-top", async (event, value) => {
    try {
      ctx.windowManager.setMainWindowAlwaysOnTop(value);
      // 同時保存到設定
      await ctx.databaseManager.setSetting('window_always_on_top', value);
      return { success: true };
    } catch (error) {
      ctx.logger.error("設置置頂狀態失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 獲取主視窗置頂狀態
  ipcMain.handle("get-always-on-top", () => {
    try {
      if (ctx.windowManager.mainWindow && !ctx.windowManager.mainWindow.isDestroyed()) {
        return { success: true, value: ctx.windowManager.mainWindow.isAlwaysOnTop() };
      }
      return { success: false, error: "主視窗不存在" };
    } catch (error) {
      ctx.logger.error("獲取置頂狀態失敗:", error);
      return { success: false, error: error.message };
    }
  });
};
