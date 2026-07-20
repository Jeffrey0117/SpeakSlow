const AITextProcessor = require("./aiTextProcessor");

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.sherpaManager = managers.sherpaManager;
    this.windowManager = managers.windowManager;
    this.hotkeyManager = managers.hotkeyManager;
    this.typelessManager = managers.typelessManager;
    this.agentManager = managers.agentManager;
    this.logger = managers.logger; // 添加logger引用
    this.aiProcessor = new AITextProcessor(this.databaseManager, this.logger);

    // 跟踪F2热键注册状态
    this.f2RegisteredSenders = new Set();

    this.setupHandlers();
  }

  setupHandlers() {
    // 各領域 IPC handler 註冊模組（行為與原單一檔案完全相同，僅搬移位置）
    require("./ipc/transcription")(this);
    require("./ipc/database")(this);
    require("./ipc/dictionary")(this);
    require("./ipc/ai")(this);
    require("./ipc/window")(this);
    require("./ipc/hotkeys")(this);
    require("./ipc/system")(this);
    require("./ipc/emoji")(this);
    require("./ipc/agent")(this);
  }


}

module.exports = IPCHandlers;
