const { contextBridge, ipcRenderer } = require("electron");

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld("electronAPI", {
  // 窗口控制
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  closeWindow: () => ipcRenderer.invoke("close-window"),

  // 視窗控制設定
  setAlwaysOnTop: (value) => ipcRenderer.invoke("set-always-on-top", value),
  setMiniMode: (enabled) => ipcRenderer.invoke("set-mini-mode", enabled),
  getMiniMode: () => ipcRenderer.invoke("get-mini-mode"),
  setWindowOpacity: (value) => ipcRenderer.invoke("set-window-opacity", value),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onMiniModeChanged: (callback) => {
    const handler = (_event, enabled) => callback(enabled);
    ipcRenderer.on("mini-mode-changed", handler);
    return () => ipcRenderer.removeListener("mini-mode-changed", handler);
  },
  setCommandMode: (enabled) => ipcRenderer.invoke("set-command-mode", enabled),
  getCommandMode: () => ipcRenderer.invoke("get-command-mode"),
  onCommandModeChanged: (callback) => {
    const handler = (_event, enabled) => callback(enabled);
    ipcRenderer.on("command-mode-changed", handler);
    return () => ipcRenderer.removeListener("command-mode-changed", handler);
  },
  getAlwaysOnTop: () => ipcRenderer.invoke("get-always-on-top"),

  // 录音相关
  startRecording: () => ipcRenderer.invoke("start-recording"),
  stopRecording: () => ipcRenderer.invoke("stop-recording"),
  onToggleDictation: (callback) => {
    ipcRenderer.on("toggle-dictation", callback);
    return () => ipcRenderer.removeListener("toggle-dictation", callback);
  },

  // Sherpa 语音识别
  transcribeAudio: (audioData, options) => ipcRenderer.invoke("transcribe-audio", audioData, options),
  checkSherpaStatus: () => ipcRenderer.invoke("check-sherpa-status"),
  restartSherpaServer: () => ipcRenderer.invoke("restart-sherpa-server"),

  // 邊錄邊算（precog）：錄音中先解碼已講完的段落，停止時只剩尾段
  precogStart: (profile) => ipcRenderer.invoke("precog-start", profile),
  precogFeed: (audioB64) => ipcRenderer.invoke("precog-feed", audioB64),
  precogAbort: () => ipcRenderer.invoke("precog-abort"),

  // 串流辨識 API (Zipformer Transducer)
  streamingStart: (options) => ipcRenderer.invoke("streaming-start", options),
  streamingFeed: (audioChunk, isFinal) => ipcRenderer.invoke("streaming-feed", audioChunk, isFinal),
  streamingEnd: () => ipcRenderer.invoke("streaming-end"),
  preloadStreamingModel: () => ipcRenderer.invoke("preload-streaming-model"),
  checkStreamingModelFiles: () => ipcRenderer.invoke("check-streaming-model-files"),
  downloadStreamingModel: () => ipcRenderer.invoke("download-streaming-model"),
  onStreamingModelDownloadProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on("streaming-model-download-progress", handler);
    return () => ipcRenderer.removeListener("streaming-model-download-progress", handler);
  },

  // 模型文件管理
  checkModelFiles: () => ipcRenderer.invoke("check-model-files"),
  getDownloadProgress: () => ipcRenderer.invoke("get-download-progress"),
  downloadModels: () => ipcRenderer.invoke("download-models"),

  // AI文本处理
  processText: (text, mode) => ipcRenderer.invoke("process-text", text, mode),
  checkAIStatus: (testConfig) => ipcRenderer.invoke("check-ai-status", testConfig),

  // 剪贴板操作
  pasteText: (text) => ipcRenderer.invoke("paste-text", text),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  readClipboard: () => ipcRenderer.invoke("read-clipboard"),
  writeClipboard: (text) => ipcRenderer.invoke("write-clipboard", text),
  sendEnter: () => ipcRenderer.invoke("send-enter"),

  // 操作模式：把辨識文字當語音指令派發
  runVoiceCommand: (text) => ipcRenderer.invoke("run-voice-command", text),

  // 點字改錯：取得選取那段的候選詞
  suggestCorrections: (sentence, target) => ipcRenderer.invoke("suggest-corrections", sentence, target),

  // 打開「記下來」筆記檔
  openNotes: () => ipcRenderer.invoke("open-notes"),

  // 崩潰救援：錄音中持續把音訊寫到暫存檔
  recoveryBegin: () => ipcRenderer.invoke("recovery-begin"),
  recoveryAppend: (b64) => ipcRenderer.invoke("recovery-append", b64),
  recoveryEnd: () => ipcRenderer.invoke("recovery-end"),

  // 「念出來」：主行程把 Edge TTS 的 MP3（base64）丟過來播 / 停
  onTtsPlay: (callback) => {
    const handler = (_event, b64) => callback(b64);
    ipcRenderer.on("tts-play", handler);
    return () => ipcRenderer.removeListener("tts-play", handler);
  },
  onTtsStop: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("tts-stop", handler);
    return () => ipcRenderer.removeListener("tts-stop", handler);
  },

  // 焦點管理 (Windows: 儲存和恢復前景視窗)
  saveForegroundWindow: () => ipcRenderer.invoke("save-foreground-window"),
  restoreForegroundWindow: () => ipcRenderer.invoke("restore-foreground-window"),

  // 数据库操作
  saveTranscription: (data) =>
    ipcRenderer.invoke("save-transcription", data),
  getTranscriptions: (limit, offset) =>
    ipcRenderer.invoke("get-transcriptions", limit, offset),
  getTranscriptionStats: () =>
    ipcRenderer.invoke("get-transcription-stats"),
  getDailyStats: (days) =>
    ipcRenderer.invoke("get-daily-stats", days),
  deleteTranscription: (id) =>
    ipcRenderer.invoke("delete-transcription", id),
  retranscribeTranscription: (id, options) =>
    ipcRenderer.invoke("retranscribe-transcription", id, options),
  clearAllTranscriptions: () =>
    ipcRenderer.invoke("clear-all-transcriptions"),

  // 語音符號（內建 + 自訂）
  getBuiltinEmojis: () => ipcRenderer.invoke("get-builtin-emojis"),
  getCustomEmojis: () => ipcRenderer.invoke("get-custom-emojis"),
  setCustomEmojis: (emojis) => ipcRenderer.invoke("set-custom-emojis", emojis),

  // 字典功能
  getDictionaryEntries: (limit, offset) =>
    ipcRenderer.invoke("get-dictionary-entries", limit, offset),
  addDictionaryEntry: (original, replacement, category) =>
    ipcRenderer.invoke("add-dictionary-entry", original, replacement, category),
  updateDictionaryEntry: (id, data) =>
    ipcRenderer.invoke("update-dictionary-entry", id, data),
  deleteDictionaryEntry: (id) =>
    ipcRenderer.invoke("delete-dictionary-entry", id),
  searchDictionary: (query) =>
    ipcRenderer.invoke("search-dictionary", query),
  getDictionaryCategories: () =>
    ipcRenderer.invoke("get-dictionary-categories"),
  applyDictionary: (text) =>
    ipcRenderer.invoke("apply-dictionary", text),
  toggleDictionaryEntry: (id) =>
    ipcRenderer.invoke("toggle-dictionary-entry", id),
  exportDictionary: () =>
    ipcRenderer.invoke("export-dictionary"),
  importDictionary: (mode) =>
    ipcRenderer.invoke("import-dictionary", mode),
  clearDictionary: () =>
    ipcRenderer.invoke("clear-dictionary"),

  // 熱詞功能
  getHotwords: () => ipcRenderer.invoke("get-hotwords"),
  setHotwords: (config) => ipcRenderer.invoke("set-hotwords", config),
  addHotword: (word) => ipcRenderer.invoke("add-hotword", word),
  removeHotword: (word) => ipcRenderer.invoke("remove-hotword", word),

  // 设置管理
  getSettings: () => ipcRenderer.invoke("get-settings"),
  getAllSettings: () => ipcRenderer.invoke("get-all-settings"),
  getSetting: (key, defaultValue) => ipcRenderer.invoke("get-setting", key, defaultValue),
  setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),
  saveSetting: (key, value) => ipcRenderer.invoke("save-setting", key, value),
  resetSettings: () => ipcRenderer.invoke("reset-settings"),

  // 热键管理
  registerHotkey: (hotkey) => ipcRenderer.invoke("register-hotkey", hotkey),
  unregisterHotkey: (hotkey) => ipcRenderer.invoke("unregister-hotkey", hotkey),
  getCurrentHotkey: () => ipcRenderer.invoke("get-current-hotkey"),
  
  // F2热键管理
  registerF2Hotkey: () => ipcRenderer.invoke("register-f2-hotkey"),
  unregisterF2Hotkey: () => ipcRenderer.invoke("unregister-f2-hotkey"),
  setRecordingState: (isRecording) => ipcRenderer.invoke("set-recording-state", isRecording),
  getRecordingState: () => ipcRenderer.invoke("get-recording-state"),
  
  // F2双击事件监听
  onF2DoubleClick: (callback) => {
    ipcRenderer.on("f2-double-click", callback);
    return () => ipcRenderer.removeListener("f2-double-click", callback);
  },
  
  // 热键触发事件监听
  onHotkeyTriggered: (callback) => {
    ipcRenderer.on("hotkey-triggered", callback);
    return () => ipcRenderer.removeListener("hotkey-triggered", callback);
  },

  // =====================================================
  // TypeLess 模式（按住錄音）API
  // =====================================================
  enableTypelessMode: (hotkey) => ipcRenderer.invoke("enable-typeless-mode", hotkey),
  disableTypelessMode: () => ipcRenderer.invoke("disable-typeless-mode"),
  getTypelessStatus: () => ipcRenderer.invoke("get-typeless-status"),
  syncTypelessState: (isRecording) => ipcRenderer.invoke("sync-typeless-state", isRecording),
  setTypelessHotkey: (hotkey) => ipcRenderer.invoke("set-typeless-hotkey", hotkey),
  setTypelessTrigger: (triggerId) => ipcRenderer.invoke("set-typeless-trigger", triggerId),

  // TypeLess 事件監聽
  onTypelessStartRecording: (callback) => {
    ipcRenderer.on("typeless-start-recording", callback);
    return () => ipcRenderer.removeListener("typeless-start-recording", callback);
  },
  onTypelessStopRecording: (callback) => {
    ipcRenderer.on("typeless-stop-recording", callback);
    return () => ipcRenderer.removeListener("typeless-stop-recording", callback);
  },
  onTypelessCancelRecording: (callback) => {
    ipcRenderer.on("typeless-cancel-recording", callback);
    return () => ipcRenderer.removeListener("typeless-cancel-recording", callback);
  },

  // =====================================================
  // 自定義快捷鍵設定 API
  // =====================================================
  getHotkeySettings: () => ipcRenderer.invoke("get-hotkey-settings"),
  getHotkeyDefaults: () => ipcRenderer.invoke("get-hotkey-defaults"),
  validateHotkey: (accelerator, excludeActionId) =>
    ipcRenderer.invoke("validate-hotkey", accelerator, excludeActionId),
  setActionHotkey: (actionId, accelerator) =>
    ipcRenderer.invoke("set-action-hotkey", actionId, accelerator),
  resetHotkeys: (actionId) => ipcRenderer.invoke("reset-hotkeys", actionId),
  initCustomHotkeys: () => ipcRenderer.invoke("init-custom-hotkeys"),

  // 快捷鍵操作事件監聽
  onHotkeyAction: (callback) => {
    ipcRenderer.on("hotkey-action", callback);
    return () => ipcRenderer.removeListener("hotkey-action", callback);
  },

  // 監聽快捷鍵變更事件（跨視窗通知）
  onHotkeyChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on("hotkey-changed", handler);
    return () => ipcRenderer.removeListener("hotkey-changed", handler);
  },

  // 監聽設定變更事件（跨視窗通知）
  onSettingChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on("setting-changed", handler);
    return () => ipcRenderer.removeListener("setting-changed", handler);
  },

  // 文件操作
  exportTranscriptions: (format) => ipcRenderer.invoke("export-transcriptions", format),
  importSettings: () => ipcRenderer.invoke("import-settings"),
  exportSettings: () => ipcRenderer.invoke("export-settings"),

  // 音訊檔案操作
  getAudioFile: (audioPath) => ipcRenderer.invoke("get-audio-file", audioPath),
  saveAudioFile: (audioPath, savePath) => ipcRenderer.invoke("save-audio-file", audioPath, savePath),
  showSaveDialog: (options) => ipcRenderer.invoke("show-save-dialog", options),

  // 系统信息
  getSystemInfo: () => ipcRenderer.invoke("get-system-info"),
  checkPermissions: () => ipcRenderer.invoke("check-permissions"),
  requestPermissions: () => ipcRenderer.invoke("request-permissions"),
  testAccessibilityPermission: () => ipcRenderer.invoke("test-accessibility-permission"),
  openSystemPermissions: () => ipcRenderer.invoke("open-system-permissions"),

  // 应用信息
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),

  // 调试和日志
  log: (level, message) => ipcRenderer.invoke("log", level, message),
  getDebugInfo: () => ipcRenderer.invoke("get-debug-info"),

  // 事件监听
  onTranscriptionUpdate: (callback) => {
    ipcRenderer.on("transcription-update", callback);
    return () => ipcRenderer.removeListener("transcription-update", callback);
  },
  onProcessingUpdate: (callback) => {
    ipcRenderer.on("processing-update", callback);
    return () => ipcRenderer.removeListener("processing-update", callback);
  },
  onError: (callback) => {
    ipcRenderer.on("error", callback);
    return () => ipcRenderer.removeListener("error", callback);
  },
  onSettingsUpdate: (callback) => {
    ipcRenderer.on("settings-update", callback);
    return () => ipcRenderer.removeListener("settings-update", callback);
  },

  // 控制面板相关
  openControlPanel: () => ipcRenderer.invoke("open-control-panel"),
  closeControlPanel: () => ipcRenderer.invoke("close-control-panel"),

  // 历史记录窗口相关
  openHistoryWindow: () => ipcRenderer.invoke("open-history-window"),
  closeHistoryWindow: () => ipcRenderer.invoke("close-history-window"),
  hideHistoryWindow: () => ipcRenderer.invoke("hide-history-window"),

  // 设置窗口相关
  openSettingsWindow: () => ipcRenderer.invoke("open-settings-window"),
  closeSettingsWindow: () => ipcRenderer.invoke("close-settings-window"),
  hideSettingsWindow: () => ipcRenderer.invoke("hide-settings-window"),

  // 中文特定功能
  detectLanguage: (text) => ipcRenderer.invoke("detect-language", text),
  segmentChinese: (text) => ipcRenderer.invoke("segment-chinese", text),
  addPunctuation: (text) => ipcRenderer.invoke("add-punctuation", text),

  // 音频处理
  convertAudioFormat: (audioData, targetFormat) => 
    ipcRenderer.invoke("convert-audio-format", audioData, targetFormat),
  enhanceAudio: (audioData) => ipcRenderer.invoke("enhance-audio", audioData),

  // 模型管理
  downloadModel: (modelName) => ipcRenderer.invoke("download-model", modelName),
  getAvailableModels: () => ipcRenderer.invoke("get-available-models"),
  getCurrentModel: () => ipcRenderer.invoke("get-current-model"),
  switchModel: (modelName) => ipcRenderer.invoke("switch-model", modelName),

  // 模型下载进度监听
  onModelDownloadProgress: (callback) => {
    ipcRenderer.on("model-download-progress", callback);
    return () => ipcRenderer.removeListener("model-download-progress", callback);
  },

  // 性能监控
  getPerformanceStats: () => ipcRenderer.invoke("get-performance-stats"),
  clearPerformanceStats: () => ipcRenderer.invoke("clear-performance-stats")
});

// 添加一些实用的常量
contextBridge.exposeInMainWorld("constants", {
  APP_NAME: "聲聲慢 (SpeakSlow)",
  VERSION: "1.0.0",
  SUPPORTED_AUDIO_FORMATS: ["wav", "mp3", "m4a", "flac"],
  SUPPORTED_EXPORT_FORMATS: ["txt", "docx", "pdf", "json"],
  DEFAULT_HOTKEY: "CommandOrControl+Shift+Space",
  MAX_RECORDING_DURATION: 300000, // 5分钟
  MAX_TEXT_LENGTH: 10000,
  CHINESE_LANGUAGE_CODES: ["zh", "zh-CN", "zh-TW", "zh-HK"]
});

// 添加调试信息（仅在开发模式下）
if (process.env.NODE_ENV === "development") {
  contextBridge.exposeInMainWorld("debug", {
    getElectronVersion: () => process.versions.electron,
    getNodeVersion: () => process.versions.node,
    getChromeVersion: () => process.versions.chrome,
    getPlatform: () => process.platform,
    getArch: () => process.arch
  });
}
