const { BrowserWindow } = require("electron");
const path = require("path");

class WindowManager {
  constructor(databaseManager = null) {
    this.databaseManager = databaseManager;
    this.mainWindow = null;
    this.controlPanelWindow = null;
    this.historyWindow = null;
    this.settingsWindow = null;
    this.typelessIndicatorWindow = null; // TypeLess 錄音指示器視窗
    this.isQuitting = false; // 用於判斷是否真正退出
    this._miniRepaintTimer = null; // 迷你模式期間的低頻重繪心跳（防閒置鬼影）
    this.isMini = false; // 視窗目前是否為迷你尺寸（渲染端重載後用來重新同步）
    this.commandMode = false; // 操作模式（主行程鏡像，給錄音指示器藥丸用）
    this._userOpacity = 1; // 使用者設定的視窗透明度（迷你變形時要還原成這個，而非寫死 1）
  }

  // 設定視窗透明度（0.3~1）；迷你 / 一般面板共用
  setWindowOpacity(value) {
    const v = Math.max(0.3, Math.min(1, Number(value) || 1));
    this._userOpacity = v;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try { this.mainWindow.setOpacity(v); } catch (e) { /* ignore */ }
    }
    return { success: true, opacity: v };
  }

  // 操作模式狀態（渲染端 toggle 時鏡像到主行程，並廣播給錄音指示器小窗）
  setCommandMode(enabled) {
    this.commandMode = !!enabled;
    if (this.typelessIndicatorWindow && !this.typelessIndicatorWindow.isDestroyed()) {
      try { this.typelessIndicatorWindow.webContents.send("command-mode-changed", this.commandMode); } catch (e) { /* ignore */ }
    }
    return { success: true, commandMode: this.commandMode };
  }

  getCommandMode() {
    return !!this.commandMode;
  }

  // 渲染端（HMR 熱重載 / 任何重載）掛載時查詢：視窗目前到底是不是迷你？
  // 避免「視窗是迷你尺寸、但 React 畫成正常面板」的狀態錯位。
  getMiniState() {
    return !!this.isMini;
  }

  // 設置 databaseManager（用於延遲初始化）
  setDatabaseManager(databaseManager) {
    this.databaseManager = databaseManager;
  }

  // 設置主視窗置頂狀態
  setMainWindowAlwaysOnTop(value) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setAlwaysOnTop(value);
    }
  }

  async createMainWindow() {
    if (this.mainWindow) {
      this.mainWindow.focus();
      return this.mainWindow;
    }

    // 從設定讀取置頂狀態，預設為 true
    let alwaysOnTop = true;
    if (this.databaseManager) {
      try {
        const savedValue = this.databaseManager.getSetting('window_always_on_top', true);
        alwaysOnTop = savedValue !== false; // 確保預設為 true
      } catch (e) {
        console.warn('讀取置頂設定失敗，使用預設值:', e);
      }
    }

    this.mainWindow = new BrowserWindow({
      width: 472,
      height: 470,
      frame: false,
      transparent: true,
      alwaysOnTop: alwaysOnTop,
      resizable: false,
      skipTaskbar: process.platform === "win32",
      movable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "..", "..", "preload.js"),
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.mainWindow.loadURL("http://localhost:5173");
    } else {
      await this.mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    }

    // 監聽縮小事件
    this.mainWindow.on("minimize", (event) => {
      if (this.databaseManager) {
        try {
          const minimizeToTray = this.databaseManager.getSetting('minimize_to_tray', true);
          if (minimizeToTray) {
            event.preventDefault();
            this.mainWindow.hide();
          }
        } catch (e) {
          console.warn('讀取縮小設定失敗:', e);
        }
      }
    });

    // 監聯關閉事件
    this.mainWindow.on("close", (event) => {
      if (this.isQuitting) return; // 真正退出時不攔截

      if (this.databaseManager) {
        try {
          const closeToTray = this.databaseManager.getSetting('close_to_tray', true);
          if (closeToTray) {
            event.preventDefault();
            this.mainWindow.hide();
          }
        } catch (e) {
          console.warn('讀取關閉設定失敗:', e);
        }
      }
    });

    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });

    // 套用使用者設定的視窗透明度（迷你 / 一般面板共用同一個值）
    try {
      const savedOpacity = this.databaseManager
        ? this.databaseManager.getSetting('window_opacity', 1)
        : 1;
      this._userOpacity = Math.max(0.3, Math.min(1, Number(savedOpacity) || 1));
      this.mainWindow.setOpacity(this._userOpacity);
    } catch (e) {
      this._userOpacity = 1;
    }

    return this.mainWindow;
  }

  async createControlPanelWindow() {
    if (this.controlPanelWindow) {
      this.controlPanelWindow.focus();
      return this.controlPanelWindow;
    }

    this.controlPanelWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      title: "聲聲慢 - 極速語音轉錄",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "..", "..", "preload.js"),
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.controlPanelWindow.loadURL("http://localhost:5173?panel=control");
    } else {
      await this.controlPanelWindow.loadFile(
        path.join(__dirname, "..", "dist", "index.html"),
        { query: { panel: "control" } }
      );
    }

    this.controlPanelWindow.on("closed", () => {
      this.controlPanelWindow = null;
    });

    return this.controlPanelWindow;
  }

  async createHistoryWindow() {
    if (this.historyWindow) {
      this.historyWindow.focus();
      return this.historyWindow;
    }

    this.historyWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      show: false,
      title: "轉錄歷史 - 聲聲慢",
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "..", "..", "preload.js"),
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.historyWindow.loadURL("http://localhost:5173/history.html");
    } else {
      await this.historyWindow.loadFile(
        path.join(__dirname, "..", "dist", "history.html")
      );
    }

    this.historyWindow.on("closed", () => {
      this.historyWindow = null;
    });

    return this.historyWindow;
  }

  async createSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.focus();
      return this.settingsWindow;
    }

    this.settingsWindow = new BrowserWindow({
      width: 920,
      height: 780,
      minWidth: 820,
      minHeight: 640,
      show: false,
      title: "設定 - 聲聲慢",
      frame: false,          // 移除原生標題列（改用 settings.jsx 內的自訂標題列）
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "..", "..", "preload.js"),
      },
    });

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.settingsWindow.loadURL("http://localhost:5173?page=settings");
    } else {
      await this.settingsWindow.loadFile(
        path.join(__dirname, "..", "dist", "settings.html")
      );
    }

    this.settingsWindow.on("closed", () => {
      this.settingsWindow = null;
    });

    return this.settingsWindow;
  }

  showControlPanel() {
    if (this.controlPanelWindow) {
      this.controlPanelWindow.show();
      this.controlPanelWindow.focus();
    } else {
      this.createControlPanelWindow().then(() => {
        this.controlPanelWindow.show();
      });
    }
  }

  hideControlPanel() {
    if (this.controlPanelWindow) {
      this.controlPanelWindow.hide();
    }
  }

  showHistoryWindow() {
    if (this.historyWindow) {
      this.historyWindow.show();
      this.historyWindow.focus();
      this.historyWindow.setAlwaysOnTop(true);
    } else {
      this.createHistoryWindow().then(() => {
        this.historyWindow.show();
        this.historyWindow.focus();
        this.historyWindow.setAlwaysOnTop(true);
      });
    }
  }

  hideHistoryWindow() {
    if (this.historyWindow) {
      this.historyWindow.hide();
    }
  }

  closeHistoryWindow() {
    if (this.historyWindow) {
      this.historyWindow.close();
    }
  }

  showSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      this.settingsWindow.setAlwaysOnTop(true);
    } else {
      this.createSettingsWindow().then(() => {
        this.settingsWindow.show();
        this.settingsWindow.focus();
        this.settingsWindow.setAlwaysOnTop(true);
      });
    }
  }

  hideSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.hide();
    }
  }

  closeSettingsWindow() {
    if (this.settingsWindow) {
      this.settingsWindow.close();
    }
  }

  // TypeLess 錄音指示器視窗
  async createTypelessIndicatorWindow() {
    if (this.typelessIndicatorWindow && !this.typelessIndicatorWindow.isDestroyed()) {
      return this.typelessIndicatorWindow;
    }

    const { screen } = require("electron");
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // 視窗尺寸
    const windowWidth = 240;
    const windowHeight = 72;

    this.typelessIndicatorWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: Math.round((screenWidth - windowWidth) / 2), // 螢幕正中間
      y: screenHeight - windowHeight - 24, // 更貼近螢幕底部
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "..", "..", "preload.js"),
      },
    });

    // 錄音藥丸永遠最高：用最高層級 'screen-saver' 壓過全螢幕影片播放器等，
    // 並設為跨全螢幕 / 所有桌面都可見，確保錄音時不被任何東西蓋住。
    try {
      this.typelessIndicatorWindow.setAlwaysOnTop(true, "screen-saver");
      this.typelessIndicatorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch (e) { /* ignore */ }

    const isDev = process.env.NODE_ENV === "development";

    if (isDev) {
      await this.typelessIndicatorWindow.loadURL("http://localhost:5173?page=typeless-indicator");
    } else {
      await this.typelessIndicatorWindow.loadFile(
        path.join(__dirname, "..", "dist", "index.html"),
        { query: { page: "typeless-indicator" } }
      );
    }

    // 指示器視窗 console 轉發到主程序 log（除錯透明視窗「沒出現」問題）
    this.typelessIndicatorWindow.webContents.on("console-message", (e, level, message) => {
      if (level >= 2) console.log('[typeless-indicator] ' + message);
    });
    this.typelessIndicatorWindow.webContents.on("did-fail-load", (e, code, desc) => {
      console.log('[typeless-indicator] did-fail-load ' + code + ' ' + desc);
      // 自癒：載入失敗的視窗會被快取重用成「隱形膠囊」，直接銷毀讓下次重建
      try { this.typelessIndicatorWindow.destroy(); } catch (err) { /* ignore */ }
      this.typelessIndicatorWindow = null;
    });

    this.typelessIndicatorWindow.on("closed", () => {
      this.typelessIndicatorWindow = null;
    });

    return this.typelessIndicatorWindow;
  }

  // 迷你模式：主面板「原地變身」成扁平媒體浮窗（同一個視窗，只改大小位置）。
  // 重要：主視窗是 resizable:false，Windows 會忽略 setBounds 的尺寸但照樣移動位置
  // （v1 因此把視窗移出螢幕外「消失」）。必須先暫時開啟 resizable 再改 bounds。
  setMiniMode(enabled) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return { success: false };
    const { screen } = require("electron");
    const win = this.mainWindow;
    this.isMini = enabled; // 真實來源：渲染端重載後靠這個重新同步，避免狀態錯位
    // 廣播給 React：不管是誰改的（托盤、main 端救援…），版面都跟著視窗大小走，
    // 避免「大視窗畫迷你版面」這種錯位。
    try { win.webContents.send("mini-mode-changed", enabled); } catch (e) { /* ignore */ }
    // 縮小時記住「縮之前」的尺寸當還原目標。但若這次呼叫時視窗其實已經是迷你
    // （狀態重複觸發 / desync），別把 300 寬的迷你尺寸存進去，否則下次展開會把
    // 大面板還原成 300 窄視窗 → 標題被擠爛、徽章蓋住名字（真實踩過的雷）。
    if (enabled && win.getBounds().width > 320) this._preMiniBounds = win.getBounds();

    // 透明視窗改 bounds 會在「離開的舊位置」留殘影（DWM 不清、底下的 app
    // 不重繪就一直掛著）。hide/show 在某些機器上仍清不乾淨。
    // 改用 opacity 流程：先把整個圖層 alpha 壓成 0 —— 此時視窗還在舊位置，
    // DWM 被迫把舊區域後面的桌面重繪一次（殘影源頭就此清掉）；接著才移動 /
    // 變形，最後 alpha 拉回。舊像素無法在一次 opacity flush 後存活。
    win.setOpacity(0);
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.setResizable(true);
      if (enabled) {
        const wa = screen.getPrimaryDisplay().workArea;
        const w = 300;
        const h = 64;
        win.setMinimumSize(w, h);
        win.setBounds({
          x: wa.x + wa.width - w - 16,
          y: wa.y + wa.height - h - 16,
          width: w,
          height: h,
        });
      } else {
        // 展開：還原成縮之前的尺寸；若還原目標遺失或寬度不合理（曾被存成迷你尺寸），
        // 退回正常面板寬度，保證大面板一定有足夠寬度，不會擠爛標題。
        win.setMinimumSize(472, 470);
        const cur = win.getBounds();
        const ok = this._preMiniBounds && this._preMiniBounds.width > 320;
        win.setBounds(ok ? this._preMiniBounds : { x: cur.x, y: cur.y, width: 472, height: 470 });
      }
      win.setResizable(false);
      try { win.webContents.invalidate(); } catch (e) { /* ignore */ }
      // 再給一個合成幀，確認新位置已畫好才淡回（還原成使用者設定的透明度，非寫死 1）。
      setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        win.setOpacity(this._userOpacity != null ? this._userOpacity : 1);
      }, 50);
    }, 110);

    // 鬼影 B：透明 + 置頂視窗閒置時 Chromium 會節流不重畫，背後桌面（工作列
    // 時鐘等）一變，DWM 就疊出半舊半新的撕裂畫面。進迷你模式時掛一個低頻
    // 重繪心跳強制它重疊新幀；離開時關掉，避免大面板也跟著一直醒著（省電）。
    if (this._miniRepaintTimer) {
      clearInterval(this._miniRepaintTimer);
      this._miniRepaintTimer = null;
    }
    if (enabled) {
      this._miniRepaintTimer = setInterval(() => {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
          clearInterval(this._miniRepaintTimer);
          this._miniRepaintTimer = null;
          return;
        }
        try { this.mainWindow.webContents.invalidate(); } catch (e) { /* ignore */ }
      }, 1500);
    }
    return { success: true, mini: enabled };
  }

  showTypelessIndicator() {
    // 顯示時把目前操作模式狀態推給藥丸（讓它一出現就是正確的紅/藍樣式）
    const pushState = () => {
      if (this.typelessIndicatorWindow && !this.typelessIndicatorWindow.isDestroyed()) {
        try { this.typelessIndicatorWindow.webContents.send("command-mode-changed", this.commandMode); } catch (e) { /* ignore */ }
      }
    };
    if (this.typelessIndicatorWindow && !this.typelessIndicatorWindow.isDestroyed()) {
      pushState();
      this.typelessIndicatorWindow.show();
    } else {
      this.createTypelessIndicatorWindow().then(() => {
        if (this.typelessIndicatorWindow) {
          // 等內容載入完再推狀態，避免訊息早於監聽器
          this.typelessIndicatorWindow.webContents.once("did-finish-load", pushState);
          pushState();
          this.typelessIndicatorWindow.show();
        }
      });
    }
  }

  hideTypelessIndicator() {
    if (this.typelessIndicatorWindow && !this.typelessIndicatorWindow.isDestroyed()) {
      this.typelessIndicatorWindow.hide();
    }
  }

  closeTypelessIndicator() {
    if (this.typelessIndicatorWindow && !this.typelessIndicatorWindow.isDestroyed()) {
      this.typelessIndicatorWindow.close();
      this.typelessIndicatorWindow = null;
    }
  }

  closeAllWindows() {
    if (this.mainWindow) {
      this.mainWindow.close();
    }
    if (this.controlPanelWindow) {
      this.controlPanelWindow.close();
    }
    if (this.historyWindow) {
      this.historyWindow.close();
    }
    if (this.settingsWindow) {
      this.settingsWindow.close();
    }
    if (this.typelessIndicatorWindow) {
      this.typelessIndicatorWindow.close();
    }
  }
}

module.exports = WindowManager;