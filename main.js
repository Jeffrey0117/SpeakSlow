// 修復 VSCode/Claude Code 內開發 Electron 應用的問題
// 這些環境基於 Electron，會繼承 ELECTRON_RUN_AS_NODE=1，導致 Electron API 無法使用
delete process.env.ELECTRON_RUN_AS_NODE;

// 載入環境變數
require("dotenv").config();

const { app, globalShortcut, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

// 导入日志管理器
const LogManager = require("./src/helpers/logManager");

// 初始化日志管理器
const logger = new LogManager();

// 添加全局错误处理
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  if (error.code === "EPIPE") {
    return;
  }
  logger.error("Error stack:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", { promise, reason });
});

// 导入助手模块
const EnvironmentManager = require("./src/helpers/environment");
const WindowManager = require("./src/helpers/windowManager");
const DatabaseManager = require("./src/helpers/database");
const ClipboardManager = require("./src/helpers/clipboard");
const SherpaManager = require("./src/helpers/sherpaManager");
const TrayManager = require("./src/helpers/tray");
const HotkeyManager = require("./src/helpers/hotkeyManager");
const IPCHandlers = require("./src/helpers/ipcHandlers");
const { TypelessManager } = require("./src/helpers/typelessManager");

// 设置生产环境PATH
function setupProductionPath() {
  logger.info('设置生产环境PATH', {
    platform: process.platform,
    nodeEnv: process.env.NODE_ENV,
    currentPath: process.env.PATH
  });

  if (process.platform === 'darwin' && process.env.NODE_ENV !== 'development') {
    const commonPaths = [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      '/Library/Frameworks/Python.framework/Versions/3.12/bin',
      '/Library/Frameworks/Python.framework/Versions/3.11/bin',
      '/Library/Frameworks/Python.framework/Versions/3.10/bin',
      '/Library/Frameworks/Python.framework/Versions/3.9/bin',
      '/Library/Frameworks/Python.framework/Versions/3.8/bin',
      // 添加更多可能的Python路径
      '/opt/homebrew/opt/python@3.11/bin',
      '/opt/homebrew/opt/python@3.10/bin',
      '/opt/homebrew/opt/python@3.9/bin',
      '/usr/local/opt/python@3.11/bin',
      '/usr/local/opt/python@3.10/bin',
      '/usr/local/opt/python@3.9/bin'
    ];
    
    const currentPath = process.env.PATH || '';
    const pathsToAdd = commonPaths.filter(p => !currentPath.includes(p));
    
    if (pathsToAdd.length > 0) {
      const newPath = `${currentPath}:${pathsToAdd.join(':')}`;
      process.env.PATH = newPath;
      logger.info('PATH已更新', {
        添加的路径: pathsToAdd,
        新PATH: newPath
      });
    } else {
      logger.info('PATH无需更新，所有路径已存在');
    }
  } else if (process.platform === 'win32' && process.env.NODE_ENV !== 'development') {
    // Windows平台的Python路径设置
    const commonPaths = [
      'C:\\Python311\\Scripts',
      'C:\\Python311',
      'C:\\Python310\\Scripts',
      'C:\\Python310',
      'C:\\Python39\\Scripts',
      'C:\\Python39',
      'C:\\Users\\' + require('os').userInfo().username + '\\AppData\\Local\\Programs\\Python\\Python311\\Scripts',
      'C:\\Users\\' + require('os').userInfo().username + '\\AppData\\Local\\Programs\\Python\\Python311',
      'C:\\Users\\' + require('os').userInfo().username + '\\AppData\\Local\\Programs\\Python\\Python310\\Scripts',
      'C:\\Users\\' + require('os').userInfo().username + '\\AppData\\Local\\Programs\\Python\\Python310'
    ];
    
    const currentPath = process.env.PATH || '';
    const pathsToAdd = commonPaths.filter(p => !currentPath.includes(p));
    
    if (pathsToAdd.length > 0) {
      const newPath = `${currentPath};${pathsToAdd.join(';')}`;
      process.env.PATH = newPath;
      logger.info('Windows PATH已更新', {
        添加的路径: pathsToAdd,
        新PATH: newPath
      });
    }
  }
}

// 在初始化管理器之前设置PATH
setupProductionPath();

// 計算 BUILD 版本標記（git short hash + 啟動時間），方便確認「現在跑哪一版」
function getBuildInfo() {
  let commit = "unknown";
  try {
    commit = require("child_process")
      .execSync("git rev-parse --short HEAD", {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "ignore"],
      })
      .toString()
      .trim();
  } catch (e) {
    commit = "n/a";
  }
  return { commit, version: app.getVersion(), startedAt: new Date().toISOString() };
}
const BUILD_INFO = getBuildInfo();
logger.info(
  `🏷️ BUILD ququ v${BUILD_INFO.version} commit=${BUILD_INFO.commit} started=${BUILD_INFO.startedAt}`
);

// 用户数据目录环境变量将在 app ready 后设置

// 初始化管理器
const environmentManager = new EnvironmentManager();
const databaseManager = new DatabaseManager();
const clipboardManager = new ClipboardManager(logger); // 传递logger实例
const sherpaManager = new SherpaManager(logger); // 传递logger实例
const hotkeyManager = new HotkeyManager();
const typelessManager = new TypelessManager(logger);

// 初始化数据库
const dataDirectory = environmentManager.ensureDataDirectory();
databaseManager.initialize(dataDirectory);

// 崩潰救援：若上次錄音中途被砍，把遺留的音訊救回歷史（標「未轉錄」）
try {
  require("./src/helpers/recovery").recoverOnStartup(databaseManager, logger);
} catch (e) {
  logger && logger.warn && logger.warn("崩潰救援啟動檢查失敗:", e?.message || e);
}

// 初始化 windowManager，傳入 databaseManager 以支援設定讀取
const windowManager = new WindowManager(databaseManager);
const trayManager = new TrayManager();

// IPC处理器将在 app ready 后初始化
let ipcHandlers = null;

// 主应用启动函数
async function startApp() {
  // 在 app ready 后初始化 IPC 处理器
  if (!ipcHandlers) {
    ipcHandlers = new IPCHandlers({
      environmentManager,
      databaseManager,
      clipboardManager,
      sherpaManager,
      windowManager,
      hotkeyManager,
      typelessManager,
      logger,
    });
  }

  logger.info('应用启动开始', {
    nodeEnv: process.env.NODE_ENV,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    appVersion: app.getVersion()
  });

  // 注释掉 accessibility 支持 - 可能干扰文本插入
  // try {
  //   app.setAccessibilitySupportEnabled(true);
  //   logger.info('✅ 已启用 Electron accessibility 支持');
  // } catch (error) {
  //   logger.warn('⚠️ 启用 accessibility 支持失败:', error.message);
  // }

  // 记录系统信息
  logger.info('系统信息', logger.getSystemInfo());

  // 开发模式下添加小延迟让Vite正确启动
  if (process.env.NODE_ENV === "development") {
    logger.info('开发模式，等待Vite启动...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // 确保macOS上dock可见
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
    logger.info('macOS Dock已显示');
  }

  // 移除預設應用選單列（Win/Linux）：按 Alt 會啟動選單列、把右 Alt 的 keyup 吃掉，
  // 導致錄音 toggle 卡在「錄音中」停不下來（採自 PR #14 jaylooloomi 的觀察）。
  // 跟我們既有的 gap<600 解鎖是不同根因、互補。Mac 保留全域選單（Cmd 系快捷鍵需要）。
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  // 在启动时初始化 Sherpa 管理器（不等待以避免阻塞）
  logger.info('开始初始化 Sherpa 管理器...');
  sherpaManager.initializeAtStartup().catch((err) => {
    logger.warn("Sherpa 在启动时不可用，这不是关键问题", err);
  });

  // 创建主窗口
  try {
    logger.info('创建主窗口...');
    await windowManager.createMainWindow();
    logger.info('主窗口创建成功');
  } catch (error) {
    logger.error("创建主窗口时出错:", error);
  }

  // 创建控制面板窗口
  try {
    logger.info('创建控制面板窗口...');
    await windowManager.createControlPanelWindow();
    logger.info('控制面板窗口创建成功');
  } catch (error) {
    logger.error("创建控制面板窗口时出错:", error);
  }

  // 设置托盘
  logger.info('设置系统托盘...');
  trayManager.setWindows(
    windowManager.mainWindow,
    windowManager.controlPanelWindow
  );
  trayManager.setWindowManager(windowManager);
  trayManager.setCreateControlPanelCallback(() =>
    windowManager.createControlPanelWindow()
  );
  await trayManager.createTray();
  logger.info('系统托盘设置完成');

  logger.info('应用启动完成');
}

// 單一實例鎖定 - 防止多開
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 已有實例在運行，直接退出
  logger.info('偵測到另一個實例正在運行，退出');
  app.quit();
} else {
  // 收到第二個實例的請求時，聚焦現有視窗
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    logger.info('收到第二個實例請求，聚焦現有視窗');
    const mainWindow = windowManager.mainWindow;
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 应用事件处理器
  app.whenReady().then(() => {
    // 设置用户数据目录环境变量，供Python脚本使用
    process.env.ELECTRON_USER_DATA = app.getPath('userData');
    logger.info('设置用户数据目录环境变量', {
      ELECTRON_USER_DATA: process.env.ELECTRON_USER_DATA
    });
    startApp();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // close-to-tray 是「隱藏」主視窗不是「銷毀」，視窗物件還在 → getAllWindows 不為 0。
  // 舊邏輯只在「全部視窗被銷毀(=== 0)」才重建，導致 Mac 點 dock 圖示叫不回隱藏的主視窗
  // （issue #16）。改成：主視窗還在就 show + focus，真的沒了才重建。
  const win = windowManager.mainWindow;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    windowManager.createMainWindow();
  }
});

app.on("before-quit", () => {
  // 從 dock 右鍵「結束」或 Cmd+Q 退出時，標記為「真正退出」，否則 close handler 會把它
  // 當成一般關閉 → preventDefault + hide → Mac 上「關不掉、結束沒反應」（issue #16）。
  windowManager.isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  typelessManager.cleanup();
});

// 导出管理器供其他模块使用
module.exports = {
  environmentManager,
  windowManager,
  databaseManager,
  clipboardManager,
  sherpaManager,
  trayManager,
  hotkeyManager,
  typelessManager,
  logger
};