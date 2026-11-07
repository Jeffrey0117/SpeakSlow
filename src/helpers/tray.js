const { Tray, Menu, nativeImage } = require("electron");
const path = require("path");

class TrayManager {
  constructor(logger = null) {
    this.tray = null;
    this.mainWindow = null;
    this.controlPanelWindow = null;
    this.createControlPanelCallback = null;
    this.windowManager = null;
    this.logger = logger;
  }

  setWindows(mainWindow, controlPanelWindow) {
    this.mainWindow = mainWindow;
    this.controlPanelWindow = controlPanelWindow;
  }

  setWindowManager(windowManager) {
    this.windowManager = windowManager;
  }

  setCreateControlPanelCallback(callback) {
    this.createControlPanelCallback = callback;
  }

  async createTray() {
    try {
      // 创建托盘图标
      const iconPath = this.getTrayIconPath();
      let trayIcon;
      
      if (iconPath && require("fs").existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
        if (process.platform === "darwin") {
          trayIcon = trayIcon.resize({ width: 16, height: 16 });
          trayIcon.setTemplateImage(true);
        }
      } else {
        // 如果图标文件不存在，创建一个简单的图标
        trayIcon = nativeImage.createEmpty();
      }

      this.tray = new Tray(trayIcon);
      this.tray.setToolTip("聲聲慢 - 中文語音轉文字");

      // 创建上下文菜单
      this.updateContextMenu();

      // 设置点击事件
      this.tray.on("click", () => {
        if (this.mainWindow) {
          if (this.mainWindow.isVisible()) {
            this.mainWindow.hide();
          } else {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        }
      });

      this.tray.on("right-click", () => {
        this.tray.popUpContextMenu();
      });

    } catch (error) {
      if (this.logger && this.logger.error) {
        this.logger.error("创建托盘失败:", error);
      }
    }
  }

  getTrayIconPath() {
    // assets 打包在 app.asar 內，fs/nativeImage 可透明讀取 asar 路徑，
    // 因此 dev 與打包都用 __dirname 相對路徑（舊版指向 resources/assets
    // 在打包後不存在 → 托盤變成空白圖示）。Windows 用 .ico（各 DPI 清晰）。
    const file = process.platform === "win32" ? "icon.ico" : "icon.png";
    return path.join(__dirname, "..", "..", "assets", file);
  }

  updateContextMenu() {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "顯示主視窗",
        click: () => {
          // 若卡在迷你尺寸，先還原大小再顯示（救援）
          try { this.windowManager?.setMiniMode?.(false); } catch (e) { /* ignore */ }
          if (this.mainWindow) {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        }
      },
      {
        label: "快捷鍵速查",
        click: () => {
          try { this.windowManager?.createCheatSheetWindow?.(); } catch (e) { /* ignore */ }
        },
      },
      {
        label: "設定",
        click: () => {
          if (this.windowManager) {
            this.windowManager.showSettingsWindow();
          }
        }
      },
      { type: "separator" },
      {
        label: "關於",
        click: () => {
          // TODO: 显示关于对话框
        }
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          // 設置退出標記，讓 windowManager 不攔截關閉事件
          if (this.windowManager) {
            this.windowManager.isQuitting = true;
          }
          require("electron").app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  setStatus(status) {
    if (!this.tray) return;

    switch (status) {
      case "recording":
        this.tray.setToolTip("聲聲慢 - 正在錄音...");
        break;
      case "processing":
        this.tray.setToolTip("聲聲慢 - 正在處理...");
        break;
      case "ready":
      default:
        this.tray.setToolTip("聲聲慢 - 中文語音轉文字");
        break;
    }
  }
}

module.exports = TrayManager;