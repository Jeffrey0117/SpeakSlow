const { spawn } = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const PythonResolver = require("./pythonResolver");

// 簡單的全局緩存，避免頻繁檢查
let globalModelCheckCache = null;
let globalModelCheckTime = 0;
const GLOBAL_CACHE_TIME = 2000; // 2秒緩存

const STREAMING_MODEL_CONFIG = {
  name: "sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2",
  required_files: [
    "encoder-epoch-99-avg-1.onnx",
    "decoder-epoch-99-avg-1.onnx",
    "joiner-epoch-99-avg-1.onnx",
    "tokens.txt",
  ],
};

class SherpaManager {
  constructor(logger = null, options = {}) {
    this.logger = logger || console;
    this.pythonResolver = new PythonResolver(this.logger);
    this.platform = options.platform || process.platform;
    this.userDataPath = options.userDataPath || null;
    this.projectRoot = options.projectRoot || path.join(__dirname, "..", "..");
    this.spawnFn = options.spawnFn || spawn;
    this.httpsGet = options.httpsGet || https.get;
    this.sherpaInstalled = null;
    this.isInitialized = false;
    this.modelsInitialized = false;
    this.initializationPromise = null;
    this.serverProcess = null;
    this.serverReady = false;
    this.modelsDownloaded = null;

    // Sherpa-ONNX 模型配置（比 FunASR 簡單得多）
    this.modelConfig = {
      name: "sherpa-onnx-paraformer-zh-2023-09-14",
      expected_size: 223 * 1024 * 1024, // 約 223MB
      required_files: ["model.int8.onnx", "tokens.txt"],
    };
    this.streamingModelConfig = STREAMING_MODEL_CONFIG;
  }

  getSherpaServerPath() {
    // 獲取 Sherpa 服務器腳本路徑
    const isDevelopment =
      process.env.NODE_ENV === "development" ||
      !require("electron").app?.isPackaged;

    if (isDevelopment) {
      return path.join(__dirname, "..", "..", "sherpa_server.py");
    } else {
      return path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "sherpa_server.py"
      );
    }
  }

  getBundledServerExe() {
    // 打包後的 PyInstaller 後端（resources/sherpa-backend/sherpa_server[.exe]）。
    // 開發時這個路徑不存在 → 自動退回用 Python 跑 sherpa_server.py。
    // （Windows = sherpa_server.exe；macOS / Linux = sherpa_server。舊版在非 win32
    //  直接回 null，導致 Mac/Linux 打包版永不使用 bundled 後端 → 卡在「模型載入中」。
    //  by webeasyplay PR #3）
    if (!process.resourcesPath) return null;
    const executableName = process.platform === "win32" ? "sherpa_server.exe" : "sherpa_server";
    return path.join(
      process.resourcesPath,
      "sherpa-backend",
      executableName
    );
  }

  // Python 解析（嵌入式/系統 Python 尋找、環境變數）抽至 pythonResolver.js；
  // 保留同名委派讓內部呼叫點不變。
  getEmbeddedPythonPath() { return this.pythonResolver.getEmbeddedPythonPath(); }
  setupIsolatedEnvironment() { return this.pythonResolver.setupIsolatedEnvironment(); }
  buildPythonEnvironment() { return this.pythonResolver.buildPythonEnvironment(); }
  findPythonExecutable() { return this.pythonResolver.findPythonExecutable(); }

  getModelCachePath() {
    // Sherpa-ONNX 模型路徑（依優先序）
    const name = this.modelConfig.name;
    const candidates = [];
    // 打包版：模型隨安裝檔放在 resources/sherpa-backend/poc-sherpa
    if (process.resourcesPath) {
      candidates.push(
        path.join(process.resourcesPath, "sherpa-backend", "poc-sherpa", name)
      );
    }
    // 首次下載的位置：userData/models/poc-sherpa
    try {
      const userData = require("electron").app.getPath("userData");
      candidates.push(path.join(userData, "models", "poc-sherpa", name));
    } catch (e) {
      /* 非 Electron 環境忽略 */
    }
    // 開發 / 後備：項目內 poc-sherpa、使用者快取
    candidates.push(path.join(__dirname, "..", "..", "poc-sherpa", name));
    candidates.push(path.join(os.homedir(), ".cache", "sherpa-onnx", name));

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        // 每 3 秒的輪詢都會走到這裡；路徑沒變就不重複寫 log
        if (candidate !== this._lastLoggedModelCachePath) {
          this._lastLoggedModelCachePath = candidate;
          this.logger.info && this.logger.info("找到模型緩存路徑:", candidate);
        }
        return candidate;
      }
    }

    // 默認返回 poc-sherpa 路徑（可能需要下載）
    return path.join(__dirname, "..", "..", "poc-sherpa", name);
  }

  getUserDataPath() {
    if (this.userDataPath) return this.userDataPath;
    return require("electron").app.getPath("userData");
  }

  isStreamingSupportedPlatform() {
    // 串流模型用 tar -xjf 解壓:macOS / Linux 原生支援,Windows 10/11 內建的
    // System32 bsdtar 也帶 bz2lib(實測可解)。三平台皆可,不再限定 macOS。
    return ["darwin", "win32", "linux"].includes(this.platform);
  }

  getStreamingModelTargetPath() {
    const userData = this.getUserDataPath();
    return path.join(userData, "models", "poc-sherpa", this.streamingModelConfig.name);
  }

  getStreamingModelSearchPaths() {
    const name = this.streamingModelConfig.name;
    const candidates = [];
    // 打包版：串流模型隨安裝檔放在 resources/sherpa-backend/poc-sherpa。
    if (process.resourcesPath) {
      candidates.push(
        path.join(process.resourcesPath, "sherpa-backend", "poc-sherpa", name)
      );
    }
    try {
      candidates.push(this.getStreamingModelTargetPath());
    } catch (error) {
      // Non-Electron tests or early startup can still use project fallback.
    }
    candidates.push(path.join(this.projectRoot, "poc-sherpa", name));
    return candidates;
  }

  findStreamingModelPath() {
    for (const candidate of this.getStreamingModelSearchPaths()) {
      const hasAllFiles = this.streamingModelConfig.required_files.every((file) =>
        fs.existsSync(path.join(candidate, file))
      );
      if (hasAllFiles) return candidate;
    }
    try {
      return this.getStreamingModelTargetPath();
    } catch (error) {
      return path.join(this.projectRoot, "poc-sherpa", this.streamingModelConfig.name);
    }
  }

  async checkStreamingModelFiles() {
    if (!this.isStreamingSupportedPlatform()) {
      return {
        success: false,
        unsupported: true,
        models_downloaded: false,
        error: "Streaming Zipformer is currently available on macOS only",
      };
    }

    const modelPath = this.findStreamingModelPath();
    const missingFiles = this.streamingModelConfig.required_files.filter((file) =>
      !fs.existsSync(path.join(modelPath, file))
    );

    return {
      success: true,
      unsupported: false,
      models_downloaded: missingFiles.length === 0,
      missing_models: missingFiles.length > 0 ? ["streaming"] : [],
      details: {
        model_path: modelPath,
        missing_files: missingFiles,
        download_url: this.streamingModelConfig.url,
      },
    };
  }

  async downloadStreamingModel(progressCallback = null) {
    if (!this.isStreamingSupportedPlatform()) {
      return {
        success: false,
        unsupported: true,
        error: "Streaming Zipformer is currently available on macOS only",
      };
    }

    const existing = await this.checkStreamingModelFiles();
    if (existing.models_downloaded) {
      return { success: true, already_downloaded: true, model_path: existing.details.model_path };
    }

    const targetRoot = path.dirname(this.getStreamingModelTargetPath());
    await fs.promises.mkdir(targetRoot, { recursive: true });
    const tarPath = path.join(os.tmpdir(), `${this.streamingModelConfig.name}-${crypto.randomUUID()}.tar.bz2`);

    try {
      await this.downloadFile(this.streamingModelConfig.url, tarPath, progressCallback);
      progressCallback?.({ stage: "extracting", model: "streaming", progress: 100 });
      await this.extractTarBz2(tarPath, targetRoot);
      progressCallback?.({ stage: "verifying", model: "streaming", progress: 100 });
      const checkResult = await this.checkStreamingModelFiles();
      if (!checkResult.models_downloaded) {
        return {
          success: false,
          error: `Streaming model download incomplete: ${checkResult.details.missing_files.join(", ")}`,
          ...checkResult,
        };
      }
      return { success: true, model_path: checkResult.details.model_path };
    } finally {
      fs.promises.unlink(tarPath).catch(() => {});
    }
  }

  async ensureStreamingModelAvailable(progressCallback = null) {
    const status = await this.checkStreamingModelFiles();
    if (status.models_downloaded) {
      return { success: true, already_downloaded: true, model_path: status.details.model_path };
    }
    if (status.unsupported) {
      return status;
    }
    return await this.downloadStreamingModel(progressCallback);
  }

  downloadFile(url, destPath, progressCallback = null) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const request = this.httpsGet(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.promises.unlink(destPath).catch(() => {});
          this.downloadFile(response.headers.location, destPath, progressCallback).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          file.close();
          reject(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }

        const total = Number(response.headers["content-length"] || 0);
        let downloaded = 0;
        response.on("data", (chunk) => {
          downloaded += chunk.length;
          if (progressCallback && total > 0) {
            progressCallback({
              stage: "downloading",
              model: "streaming",
              downloaded,
              total,
              progress: Math.round((downloaded / total) * 1000) / 10,
            });
          }
        });
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      });
      request.on("error", (error) => {
        file.close();
        fs.promises.unlink(destPath).catch(() => {});
        reject(error);
      });
      file.on("error", (error) => {
        request.destroy();
        reject(error);
      });
    });
  }

  extractTarBz2(tarPath, targetRoot) {
    return new Promise((resolve, reject) => {
      // Windows 地雷：GNU tar 會把 "C:\\..." 的冒號當成「遠端主機:路徑」，
      // 報 "Cannot connect to C: resolve failed" 然後解壓失敗（lite 版實測踩到，
      // 使用者會下載完卻裝不起來）。Windows 自帶的是 bsdtar 沒這問題，但 PATH 上
      // 若有 Git/MSYS 的 GNU tar 就會被選到。
      // 解法：把工作目錄設成目標資料夾、只傳檔名，指令裡完全不出現冒號——
      // bsdtar 與 GNU tar 都吃得下。
      const path = require("path");
      const archiveDir = path.dirname(tarPath);
      const archiveName = path.basename(tarPath);
      const relFromTarget = path.relative(targetRoot, archiveDir);
      // 壓縮檔與目標同一層時直接用檔名；否則用相對路徑（仍然不含冒號）
      const archiveArg = relFromTarget
        ? path.join(relFromTarget, archiveName).split(path.sep).join("/")
        : archiveName;

      const child = this.spawnFn("tar", ["-xjf", archiveArg], {
        cwd: targetRoot,
        stdio: ["ignore", "ignore", "pipe"],
        ...(process.platform === "win32" ? { windowsHide: true } : {}),
      });
      let stderr = "";
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr.trim() || `tar exited with code ${code}`));
        }
      });
    });
  }

  async checkModelFiles() {
    /**
     * 檢查模型文件是否存在
     */
    const now = Date.now();

    if (
      globalModelCheckCache &&
      now - globalModelCheckTime < GLOBAL_CACHE_TIME &&
      !this.serverReady
    ) {
      return globalModelCheckCache;
    }

    try {
      const modelPath = this.getModelCachePath();

      if (!fs.existsSync(modelPath)) {
        this.logger.info && this.logger.info("模型目錄不存在");
        this.modelsDownloaded = false;
        const result = {
          success: true,
          models_downloaded: false,
          missing_models: ["asr"],
          details: {
            model_path: modelPath,
            exists: false,
          },
        };

        globalModelCheckCache = result;
        globalModelCheckTime = now;
        return result;
      }

      // 檢查必要的文件
      const missingFiles = [];
      for (const file of this.modelConfig.required_files) {
        const filePath = path.join(modelPath, file);
        if (!fs.existsSync(filePath)) {
          missingFiles.push(file);
        }
      }

      const allDownloaded = missingFiles.length === 0;
      this.modelsDownloaded = allDownloaded;

      // 這個方法被前端每 3 秒輪詢；結果沒變就不重複寫 log
      //（曾把 app.log 灌到 28MB、也會洗版啟動它的終端機）
      const summary = JSON.stringify({ allDownloaded, missingFiles, modelPath });
      if (summary !== this._lastModelCheckSummary) {
        this._lastModelCheckSummary = summary;
        this.logger.info &&
          this.logger.info("模型檢查完成:", {
            allDownloaded,
            missingFiles,
            modelPath,
          });
      }

      const result = {
        success: true,
        models_downloaded: allDownloaded,
        missing_models: missingFiles.length > 0 ? ["asr"] : [],
        details: {
          model_path: modelPath,
          missing_files: missingFiles,
        },
      };

      globalModelCheckCache = result;
      globalModelCheckTime = now;
      return result;
    } catch (error) {
      this.logger.error && this.logger.error("檢查模型文件失敗:", error);
      this.modelsDownloaded = false;
      return {
        success: false,
        error: error.message,
        models_downloaded: false,
        missing_models: ["asr"],
        details: {},
      };
    }
  }

  async getDownloadProgress() {
    /**
     * 獲取模型下載進度
     * Sherpa-ONNX 模型較小，通常一次性下載，這裡簡化處理
     */
    try {
      const modelPath = this.getModelCachePath();

      if (!fs.existsSync(modelPath)) {
        return {
          success: true,
          overall_progress: 0,
          models: {
            asr: {
              progress: 0,
              downloaded: 0,
              total: this.modelConfig.expected_size,
            },
          },
        };
      }

      // 檢查模型文件大小
      const modelFile = path.join(modelPath, "model.int8.onnx");
      let fileSize = 0;
      if (fs.existsSync(modelFile)) {
        const stats = fs.statSync(modelFile);
        fileSize = stats.size;
      }

      const progress = Math.min(
        100,
        (fileSize / this.modelConfig.expected_size) * 100
      );

      return {
        success: true,
        overall_progress: Math.round(progress * 10) / 10,
        models: {
          asr: {
            progress: Math.round(progress * 10) / 10,
            downloaded: fileSize,
            total: this.modelConfig.expected_size,
          },
        },
      };
    } catch (error) {
      this.logger.error && this.logger.error("獲取下載進度失敗:", error);
      return {
        success: false,
        error: error.message,
        overall_progress: 0,
        models: {},
      };
    }
  }

  // 首次啟動要下載的核心模型（lite 版安裝檔不內建模型，靠這裡補齊）。
  // 來源與 download_all_models.py 相同，都是 sherpa-onnx 官方 release。
  getCoreModelSpecs() {
    const BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
    return [
      // required：沒有就不能用，首次啟動必須等它下載完（約 225MB）
      {
        id: "asr",
        label: "離線辨識 Paraformer",
        url: `${BASE}/asr-models/sherpa-onnx-paraformer-zh-2023-09-14.tar.bz2`,
        folder: "sherpa-onnx-paraformer-zh-2023-09-14",
        keyFile: "model.int8.onnx",
        required: true,
      },
      {
        id: "vad",
        label: "語音偵測 Silero VAD",
        url: `${BASE}/asr-models/silero_vad.onnx`,
        plainFile: "silero_vad.onnx", // 單檔，不是壓縮包
        required: true,
      },
      // 以下在背景補：缺了仍可正常聽寫，只是少了對應的加強功能，
      // 不該讓使用者在首次啟動時多等 340MB。
      {
        id: "punct",
        label: "標點 ct-transformer",
        url: `${BASE}/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12.tar.bz2`,
        folder: "sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12",
        keyFile: "model.onnx",
        required: false, // 缺少時後端自動退回規則式標點
      },
      {
        id: "asr-small",
        label: "快速辨識 Paraformer-small",
        url: `${BASE}/asr-models/sherpa-onnx-paraformer-zh-small-2024-03-09.tar.bz2`,
        folder: "sherpa-onnx-paraformer-zh-small-2024-03-09",
        keyFile: "model.int8.onnx",
        required: false, // 只有「效能模式＝fast」才會用到
      },
    ];
  }

  // 背景補下載「非必要」模型（標點、快速模式）。失敗只記 log，
  // 因為缺了仍可正常聽寫；下次啟動 downloadModels 會再補一次。
  async _downloadOptionalModels(specs, root) {
    for (const spec of specs) {
      try {
        const folderPath = path.join(root, spec.folder);
        if (fs.existsSync(path.join(folderPath, spec.keyFile))) continue;
        const tarPath = path.join(root, `${spec.folder}-${crypto.randomUUID()}.tar.bz2`);
        try {
          this.logger.info && this.logger.info(`背景下載補充模型：${spec.label}`);
          await this.downloadFile(spec.url, tarPath, null);
          await this.extractTarBz2(tarPath, root);
          this.logger.info && this.logger.info(`補充模型完成：${spec.label}`);
        } finally {
          fs.promises.unlink(tarPath).catch(() => {});
        }
      } catch (e) {
        this.logger.warn && this.logger.warn(`補充模型下載失敗：${spec.label}`, { message: e.message });
      }
    }
  }

  // 模型下載的落點：userData/models/poc-sherpa（本來就是 getModelCachePath 的搜尋路徑之一）
  getDownloadedModelsRoot() {
    const userData = require("electron").app.getPath("userData");
    return path.join(userData, "models", "poc-sherpa");
  }

  async downloadModels(progressCallback = null) {
    /**
     * 下載核心模型（約 250MB）。lite 安裝檔不內建模型，首次啟動時呼叫這裡補齊；
     * 完整安裝檔則因為模型已在 resources 內而直接跳過。
     */
    try {
      const checkResult = await this.checkModelFiles();
      if (checkResult.models_downloaded) {
        this.logger.info && this.logger.info("模型已存在，無需下載");
        return { success: true, message: "模型已存在，無需下載" };
      }

      this.logger.info && this.logger.info("開始下載 Sherpa-ONNX 核心模型…");
      const root = this.getDownloadedModelsRoot();
      await fs.promises.mkdir(root, { recursive: true });

      const all = this.getCoreModelSpecs();
      const specs = all.filter((s) => s.required);
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        // 單一模型的進度換算成整體進度，前端進度條才不會每個模型都從 0 重跑
        const report = (stage, progress) => {
          progressCallback?.({
            stage,
            model: spec.id,
            label: spec.label,
            progress,
            overall_progress: Math.round(((i + progress / 100) / specs.length) * 100),
          });
        };

        if (spec.plainFile) {
          const dest = path.join(root, spec.plainFile);
          if (fs.existsSync(dest)) { report("verifying", 100); continue; }
          report("downloading", 0);
          await this.downloadFile(spec.url, dest, (p) => report("downloading", p?.progress ?? 0));
          report("verifying", 100);
          continue;
        }

        const folderPath = path.join(root, spec.folder);
        if (fs.existsSync(path.join(folderPath, spec.keyFile))) { report("verifying", 100); continue; }

        // 壓縮檔放在目標資料夾裡：跨磁碟時 path.relative 會算出帶冒號的路徑，
        // 又會踩到上面那個 tar 的地雷。放同一層最穩，解壓完就刪掉。
        const tarPath = path.join(root, `${spec.folder}-${crypto.randomUUID()}.tar.bz2`);
        try {
          report("downloading", 0);
          await this.downloadFile(spec.url, tarPath, (p) => report("downloading", p?.progress ?? 0));
          report("extracting", 100);
          await this.extractTarBz2(tarPath, root);
          if (!fs.existsSync(path.join(folderPath, spec.keyFile))) {
            throw new Error(`解壓後缺少關鍵檔案：${spec.folder}/${spec.keyFile}`);
          }
          report("verifying", 100);
        } finally {
          fs.promises.unlink(tarPath).catch(() => {});
        }
      }

      this._clearModelCache(); // 下載完要重查，否則會讀到「尚未下載」的舊快取
      const after = await this.checkModelFiles();
      if (!after.models_downloaded) {
        return {
          success: false,
          error: `模型下載後仍不完整：${(after.details?.missing_files || []).join(", ")}`,
        };
      }
      this.logger.info && this.logger.info("核心模型下載完成", { root });

      // 必要模型就緒＝已經可以開始用；其餘（標點、快速模式）在背景補，不擋使用者
      const optional = all.filter((s) => !s.required);
      if (optional.length) {
        this._downloadOptionalModels(optional, root).catch((e) => {
          this.logger.warn && this.logger.warn("補充模型下載失敗（不影響基本使用）", { message: e.message });
        });
      }
      return { success: true, model_path: after.details?.model_path };
    } catch (error) {
      this.logger.error && this.logger.error("模型下載失敗:", error);
      return { success: false, error: error.message };
    }
  }

  async restartServer() {
    /**
     * 重啟 Sherpa 服務器
     */
    try {
      this.logger.info && this.logger.info("重啟 Sherpa 服務器...");

      if (this.serverProcess) {
        await this._stopSherpaServer();
        this.logger.info && this.logger.info("已停止現有 Sherpa 服務器");
      }

      this.serverReady = false;
      this.modelsInitialized = false;
      this.initializationPromise = null;
      this.startupFailed = false; // 手動重啟 = 重新計算啟動失敗狀態
      this._clearModelCache();

      const modelStatus = await this.checkModelFiles();
      if (!modelStatus.models_downloaded) {
        throw new Error("模型文件未下載，無法啟動服務器");
      }

      this.initializationPromise = this._startSherpaServer();
      await this.initializationPromise;

      this.logger.info && this.logger.info("Sherpa 服務器重啟完成");
      return { success: true, message: "Sherpa 服務器重啟成功" };
    } catch (error) {
      this.logger.error && this.logger.error("重啟 Sherpa 服務器失敗:", error);
      return { success: false, error: error.message };
    }
  }

  _clearModelCache() {
    globalModelCheckCache = null;
    globalModelCheckTime = 0;
  }

  async initializeAtStartup() {
    try {
      this.logger.info && this.logger.info("Sherpa 管理器啟動初始化開始");

      // 打包版有自帶的 sherpa_server.exe → 跳過所有系統/嵌入式 Python 檢查
      const bundledExe = this.getBundledServerExe();
      if (bundledExe && fs.existsSync(bundledExe)) {
        this.logger.info &&
          this.logger.info("使用打包的 sherpa_server.exe", { bundledExe });
      } else {
        const pythonCmd = await this.findPythonExecutable();
        this.logger.info &&
          this.logger.info("Python 可執行文件找到", { pythonCmd });

        const sherpaStatus = await this.checkSherpaInstallation();
        this.logger.info &&
          this.logger.info("Sherpa-ONNX 安裝狀態檢查完成", sherpaStatus);
      }

      this.isInitialized = true;

      // 預初始化模型
      this.preInitializeModels();
      this.logger.info && this.logger.info("Sherpa 管理器啟動初始化完成");
    } catch (error) {
      this.logger.warn &&
        this.logger.warn("Sherpa 啟動初始化失敗，但不影響應用啟動", error);
      this.isInitialized = true;
    }
  }

  async preInitializeModels() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // 啟動未就緒（超時/早退）自動重試一次：冷開機、防毒掃描會拖慢第一次
    // 模型載入，第二次因檔案已進系統快取通常數秒內完成。兩次都失敗才標記
    // startupFailed，讓前端能顯示錯誤並提供重試，而不是永遠轉圈。
    this.initializationPromise = (async () => {
      this.startupFailed = false;
      await this._startSherpaServer();
      if (!this.serverReady) {
        this.logger.warn &&
          this.logger.warn("Sherpa 首次啟動未就緒，自動重試一次");
        if (this.serverProcess) {
          try { await this._stopSherpaServer(); } catch (e) { /* 盡力而為 */ }
        }
        // 等舊進程的 close 事件收尾，避免它把新進程的引用清掉
        await new Promise((r) => setTimeout(r, 1000));
        await this._startSherpaServer();
      }
      if (!this.serverReady) {
        this.startupFailed = true;
        this.logger.error &&
          this.logger.error("Sherpa 服務器重試後仍未就緒，標記啟動失敗");
      }
    })();
    return this.initializationPromise;
  }

  async _startSherpaServer() {
    try {
      this.logger.info && this.logger.info("啟動 Sherpa 服務器...");

      // 打包的 sherpa_server.exe 自帶 sherpa-onnx，免檢查系統 Python。
      const _bundled = this.getBundledServerExe();
      if (!(_bundled && fs.existsSync(_bundled))) {
        const status = await this.checkSherpaInstallation();
        if (!status.installed) {
          this.logger.warn &&
            this.logger.warn("Sherpa-ONNX 未安裝，跳過服務器啟動");
          return;
        }
      }

      // 打包後優先用 PyInstaller 的 sherpa_server.exe（免 Python）；開發退回 Python 腳本。
      const bundledExe = this.getBundledServerExe();
      const useBundled = bundledExe && fs.existsSync(bundledExe);

      let command;
      let baseArgs;
      let serverPath;
      if (useBundled) {
        command = bundledExe;
        baseArgs = [];
        serverPath = bundledExe;
      } else {
        command = await this.findPythonExecutable();
        serverPath = this.getSherpaServerPath();
        baseArgs = [serverPath];
      }

      this.logger.info &&
        this.logger.info("Sherpa 服務器配置", {
          mode: useBundled ? "bundled-exe" : "python-script",
          command,
          serverPath,
          serverExists: fs.existsSync(serverPath),
        });

      if (!fs.existsSync(serverPath)) {
        this.logger.error &&
          this.logger.error("Sherpa 服務器未找到，跳過服務器啟動", {
            serverPath,
          });
        return;
      }

      this.setupIsolatedEnvironment();
      const pythonEnv = this.buildPythonEnvironment();

      return new Promise((resolve) => {
        const modelPath = this.getModelCachePath();

        this.serverProcess = spawn(
          command,
          [...baseArgs, "--model-dir", modelPath],
          {
            stdio: ["pipe", "pipe", "pipe"],
            ...(process.platform === "win32" ? { windowsHide: true } : {}),
            env: pythonEnv,
          }
        );

        let initResponseReceived = false;

        this.serverProcess.stdout.on("data", (data) => {
          const lines = data
            .toString()
            .split("\n")
            .filter((line) => line.trim());

          for (const line of lines) {
            this.logger.debug &&
              this.logger.debug("Sherpa 服務器輸出", { line });
            try {
              const result = JSON.parse(line);

              if (!initResponseReceived) {
                initResponseReceived = true;
                if (result.success) {
                  this.serverReady = true;
                  this.modelsInitialized = true;
                  this._clearModelCache();
                  this.logger.info &&
                    this.logger.info("Sherpa 服務器啟動成功，模型已初始化");
                  // 重送使用者自訂符號（啟動 / 後端重啟後都要補回）
                  if (this.customEmojis && Object.keys(this.customEmojis).length) {
                    this._sendServerCommand({ action: "set_custom_emojis", emojis: this.customEmojis }).catch(() => {});
                  }
                } else {
                  this.logger.error &&
                    this.logger.error("Sherpa 服務器初始化失敗", result);
                }
                resolve();
              }
            } catch (parseError) {
              this.logger.debug &&
                this.logger.debug("Sherpa 服務器非 JSON 輸出", { line });
            }
          }
        });

        this.serverProcess.stderr.on("data", (data) => {
          const errorOutput = data.toString();
          this.logger.error &&
            this.logger.error("Sherpa 服務器錯誤輸出", { errorOutput });
        });

        this.serverProcess.on("close", (code) => {
          this.logger.warn &&
            this.logger.warn("Sherpa 服務器進程退出", { code });
          this.serverProcess = null;
          this.serverReady = false;
          this.modelsInitialized = false;

          if (!initResponseReceived) {
            resolve();
          }
        });

        this.serverProcess.on("error", (error) => {
          this.logger.error &&
            this.logger.error("Sherpa 服務器進程錯誤", error);
          this.serverProcess = null;
          this.serverReady = false;

          if (!initResponseReceived) {
            resolve();
          }
        });

        // 啟動超時：冷開機或防毒掃描會把第一次模型載入拖到 30 秒以上
        // （實測同一台機器冷快取 14 秒＋、熱快取 1.3 秒），放寬到 90 秒；
        // 真的超時由 preInitializeModels 再自動重試一次。
        setTimeout(() => {
          if (!initResponseReceived) {
            this.logger.warn &&
              this.logger.warn("Sherpa 服務器啟動超時");
            if (this.serverProcess) {
              this.serverProcess.kill();
            }
            resolve();
          }
        }, 90000);
      });
    } catch (error) {
      this.logger.error && this.logger.error("啟動 Sherpa 服務器異常", error);
    }
  }

  async _sendServerCommand(command) {
    if (!this.serverProcess || !this.serverReady) {
      throw new Error("Sherpa 服務器未就緒");
    }

    // 序列化佇列：stdin/stdout 單一管道、回應沒有請求 id，
    // 一次只能在飛一個請求 —— 否則併發時（串流 feed + 狀態查詢）
    // A 的回應會被同時掛著 listener 的 B 搶走，造成回應錯配。
    const run = () => this._dispatchServerCommand(command);
    const result = (this._commandQueue || Promise.resolve()).then(run, run);
    this._commandQueue = result.catch(() => {}); // 佇列不因單一失敗而中斷
    return result;
  }

  _dispatchServerCommand(command) {
    return new Promise((resolve, reject) => {
      let responseReceived = false;

      const onData = (data) => {
        if (responseReceived) return;

        const lines = data
          .toString()
          .split("\n")
          .filter((line) => line.trim());

        for (const line of lines) {
          try {
            const result = JSON.parse(line);
            responseReceived = true;
            this.serverProcess.stdout.removeListener("data", onData);
            resolve(result);
            return;
          } catch (parseError) {
            // 忽略非 JSON 輸出
          }
        }
      };

      this.serverProcess.stdout.on("data", onData);
      this.serverProcess.stdin.write(JSON.stringify(command) + "\n");

      setTimeout(() => {
        if (!responseReceived) {
          responseReceived = true;
          this.serverProcess.stdout.removeListener("data", onData);
          reject(new Error("服務器響應超時"));
        }
      }, 60000);
    });
  }

  async _stopSherpaServer() {
    if (this.serverProcess) {
      try {
        await this._sendServerCommand({ action: "exit" });
      } catch (error) {
        this.serverProcess.kill();
      }

      this.serverProcess = null;
      this.serverReady = false;
      this.modelsInitialized = false;
    }
  }

  async checkSherpaInstallation() {
    // 如果有緩存結果則返回
    if (this.sherpaInstalled !== null) {
      return this.sherpaInstalled;
    }

    // 打包版自帶 sherpa_server.exe（內含 sherpa-onnx），不需要也不該檢查 Python。
    // 注意：transcribeAudio 每次都會呼叫這裡 — 漏了這個分支會讓乾淨機器
    // （沒有 Python）的每一次辨識都誤報「Sherpa-ONNX 未安裝」。
    const bundledExe = this.getBundledServerExe();
    if (bundledExe && fs.existsSync(bundledExe)) {
      this.sherpaInstalled = { installed: true, version: "bundled" };
      return this.sherpaInstalled;
    }

    try {
      const pythonCmd = await this.findPythonExecutable();

      const result = await new Promise((resolve) => {
        const pythonEnv = this.buildPythonEnvironment();

        const checkProcess = spawn(
          pythonCmd,
          ["-c", 'import sherpa_onnx; print("OK")'],
          { env: pythonEnv }
        );

        let output = "";
        let errorOutput = "";

        checkProcess.stdout.on("data", (data) => {
          output += data.toString();
        });

        checkProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        checkProcess.on("close", (code) => {
          if (code === 0 && output.includes("OK")) {
            resolve({ installed: true, working: true });
          } else {
            this.logger.error &&
              this.logger.error("Sherpa-ONNX 檢查失敗", {
                code,
                output,
                errorOutput,
              });
            resolve({
              installed: false,
              working: false,
              error: errorOutput || output,
            });
          }
        });

        checkProcess.on("error", (error) => {
          resolve({ installed: false, working: false, error: error.message });
        });
      });

      this.sherpaInstalled = result;
      return result;
    } catch (error) {
      const errorResult = {
        installed: false,
        working: false,
        error: error.message,
      };
      this.sherpaInstalled = errorResult;
      return errorResult;
    }
  }

  async transcribeAudio(audioBlob, options = {}) {
    const status = await this.checkSherpaInstallation();
    if (!status.installed) {
      throw new Error("Sherpa-ONNX 未安裝。請先安裝 Sherpa-ONNX。");
    }

    if (!this.serverReady && this.initializationPromise) {
      this.logger.info && this.logger.info("等待 Sherpa 服務器就緒...");
      await this.initializationPromise;
    }

    const tempAudioPath = await this.createTempAudioFile(audioBlob);

    try {
      if (!this.serverReady) {
        throw new Error("Sherpa 服務器未就緒，請稍後重試");
      }

      this.logger.info &&
        this.logger.info("使用 Sherpa 服務器模式進行轉錄");
      const result = await this._sendServerCommand({
        action: "transcribe",
        audio_path: tempAudioPath,
        options: options,
      });

      if (!result.success) {
        throw new Error(result.error || "轉錄失敗");
      }

      // 保存原始錄音（永不丟失），供日後「重新辨識」使用。
      // 路徑先定好、複製放背景做（不擋住結果回傳 → 貼上更快）；
      // 複製完成後才刪暫存檔。
      // 檔案轉錄（逐字稿/SRT）逐段呼叫，no_persist 時不存錄音、只清暫存檔。
      // save_audio === false：使用者關掉「保存錄音檔」→ 不寫磁碟(省 SSD、不留存)，
      // 只清暫存;這筆就沒有 audio_path(之後不能重新辨識,但那是使用者的選擇)。
      let persistedAudioPath = null;
      if (options && (options.no_persist || options.save_audio === false)) {
        this.cleanupTempFile(tempAudioPath).catch(() => {});
      } else {
        persistedAudioPath = this._persistAudioInBackground(tempAudioPath);
      }

      return {
        success: true,
        text: (result.text || "").trim(),
        segments: result.segments, // SRT 模式：逐句時間軸 [{start,end,text}]
        raw_text: result.raw_text,
        confidence: result.confidence || 0.95,
        language: result.language || "zh-CN",
        duration: result.duration || 0,
        audio_path: persistedAudioPath,
      };
    } catch (error) {
      await this.cleanupTempFile(tempAudioPath);
      throw error;
    }
  }

  // 背景持久化錄音：立刻回傳目的路徑，複製與暫存清理非同步完成。
  _persistAudioInBackground(tempAudioPath) {
    try {
      const userDataPath = require("electron").app.getPath("userData");
      const audioDir = path.join(userDataPath, "audio");
      const destPath = path.join(audioDir, `rec_${crypto.randomUUID()}.wav`);
      (async () => {
        try {
          await fs.promises.mkdir(audioDir, { recursive: true });
          await fs.promises.copyFile(tempAudioPath, destPath);
        } catch (e) {
          this.logger.warn && this.logger.warn("保存錄音檔失敗:", e?.message || e);
        } finally {
          this.cleanupTempFile(tempAudioPath).catch(() => {});
        }
      })();
      return destPath;
    } catch (e) {
      this.cleanupTempFile(tempAudioPath).catch(() => {});
      return null;
    }
  }

  // 保留策略（建議 1）：刪掉 audio/ 裡超過 retentionDays 天的錄音檔，避免無限增長。
  // retentionDays <= 0 視為「永久保留」。被刪檔的歷史紀錄仍在,只是「重新辨識」會
  // 提示檔案不存在(既有的優雅處理)。開機時呼叫一次。
  async cleanupOldAudio(retentionDays) {
    try {
      const days = Number(retentionDays);
      if (!days || days <= 0) return { removed: 0 };
      const userDataPath = require("electron").app.getPath("userData");
      const audioDir = path.join(userDataPath, "audio");
      if (!fs.existsSync(audioDir)) return { removed: 0 };
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const files = await fs.promises.readdir(audioDir);
      let removed = 0;
      for (const f of files) {
        if (!f.toLowerCase().endsWith(".wav")) continue;
        const fp = path.join(audioDir, f);
        const st = await fs.promises.stat(fp).catch(() => null);
        if (st && st.mtimeMs < cutoff) {
          await fs.promises.unlink(fp).catch(() => {});
          removed++;
        }
      }
      if (removed && this.logger?.info) this.logger.info(`保留策略：清掉 ${removed} 個超過 ${days} 天的錄音檔`);
      return { removed };
    } catch (e) {
      this.logger?.warn && this.logger.warn("清理舊錄音失敗:", e?.message || e);
      return { removed: 0, error: e?.message };
    }
  }

  async createTempAudioFile(audioBlob) {
    const tempDir = os.tmpdir();
    const filename = `sherpa_audio_${crypto.randomUUID()}.wav`;
    const tempAudioPath = path.join(tempDir, filename);

    this.logger.info && this.logger.info("創建臨時文件:", tempAudioPath);

    let buffer;
    if (audioBlob instanceof ArrayBuffer) {
      buffer = Buffer.from(audioBlob);
    } else if (audioBlob instanceof Uint8Array) {
      buffer = Buffer.from(audioBlob);
    } else if (typeof audioBlob === "string") {
      buffer = Buffer.from(audioBlob, "base64");
    } else if (audioBlob && audioBlob.buffer) {
      buffer = Buffer.from(audioBlob.buffer);
    } else {
      throw new Error(`不支持的音頻數據類型: ${typeof audioBlob}`);
    }

    this.logger.debug && this.logger.debug("緩衝區創建，大小:", buffer.length);

    await fs.promises.writeFile(tempAudioPath, buffer);

    const stats = await fs.promises.stat(tempAudioPath);
    this.logger.info &&
      this.logger.info("臨時音頻文件創建:", {
        path: tempAudioPath,
        size: stats.size,
        isFile: stats.isFile(),
      });

    if (stats.size === 0) {
      throw new Error("音頻文件為空");
    }

    return tempAudioPath;
  }

  async cleanupTempFile(tempAudioPath) {
    try {
      await fs.promises.unlink(tempAudioPath);
    } catch (cleanupError) {
      // 臨時文件清理錯誤不是關鍵問題
    }
  }

  // 直接用既有檔案路徑辨識（給「重新辨識」用，不建暫存、不重複保存）
  async transcribeFilePath(audioPath, options = {}) {
    if (!this.serverReady && this.initializationPromise) {
      await this.initializationPromise;
    }
    if (!this.serverReady) {
      throw new Error("Sherpa 服務器未就緒");
    }
    const result = await this._sendServerCommand({
      action: "transcribe",
      audio_path: audioPath,
      options: options,
    });
    if (!result.success) {
      throw new Error(result.error || "轉錄失敗");
    }
    return {
      success: true,
      text: result.text.trim(),
      raw_text: result.raw_text,
      confidence: result.confidence || 0.95,
      language: result.language || "zh-CN",
    };
  }

  // 把暫存 WAV 複製到永久目錄（userData/audio），回傳路徑；失敗回 null 不影響辨識

  async checkStatus() {
    try {
      this.logger.info && this.logger.info("checkStatus 被調用", { serverReady: this.serverReady });

      if (this.serverReady) {
        const result = await this._sendServerCommand({ action: "status" });
        this.logger.info && this.logger.info("checkStatus 服務器返回", result);
        // 將 Python 返回的 initialized 映射到前端期望的 models_initialized
        return {
          ...result,
          models_initialized: result.initialized,
          server_ready: true,
        };
      } else {
        const installStatus = await this.checkSherpaInstallation();
        const modelStatus = await this.checkModelFiles();

        let error = "Sherpa-ONNX 未安裝";
        if (installStatus.installed) {
          if (!modelStatus.models_downloaded) {
            error = "模型文件未下載，請先下載模型";
          } else {
            error = "Sherpa 服務器正在啟動中...";
          }
        }

        return {
          success: installStatus.installed && modelStatus.models_downloaded,
          error: error,
          installed: installStatus.installed,
          models_downloaded: modelStatus.models_downloaded,
          missing_models: modelStatus.missing_models || [],
          initializing: this.initializationPromise !== null,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        installed: false,
        models_downloaded: false,
      };
    }
  }

  // =====================================================
  // 串流辨識 API
  // =====================================================

  /**
   * 初始化串流辨識會話
   * @param {Object} options - 選項
   * @param {number} options.sampleRate - 採樣率，預設 16000
   * @returns {Promise<{success: boolean, sessionId: string}>}
   */
  async streamingStart(options = {}) {
    const modelStatus = await this.ensureStreamingModelAvailable();
    if (!modelStatus.success) {
      return modelStatus;
    }

    if (!this.serverReady) {
      if (this.initializationPromise) {
        await this.initializationPromise;
      }
      if (!this.serverReady) {
        return { success: false, error: "Sherpa 服務器未就緒" };
      }
    }

    try {
      const sessionId = crypto.randomUUID();
      const result = await this._sendServerCommand({
        action: "stream_init",
        session_id: sessionId,
        options: {
          sample_rate: options.sampleRate || 16000,
        },
      });

      if (result.success) {
        this.activeStreamSession = sessionId;
        this.logger.info && this.logger.info("串流會話已創建:", sessionId);
      }

      return result;
    } catch (error) {
      this.logger.error && this.logger.error("創建串流會話失敗:", error);
      return { success: false, error: error.message };
    }
  }

  // ===== 邊錄邊算（precog）=====
  // 錄音進行中先把已講完的段落解碼掉（同一顆 Paraformer，精度零損失），
  // 停止時 transcribeAudio 帶 use_precog 取用結果 → 長講停止延遲降一個數量級。
  // 操作模式：對文字做純轉換（簡繁互轉等），走 sherpa server 的 opencc
  async transformText(text, mode) {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "text_transform", mode, text });
  }

  // 操作模式「念出來」：Edge 神經網路語音，回傳 base64 MP3
  async tts(text, voice = "zh-TW-HsiaoChenNeural", rate = "+0%") {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "tts", text, voice, rate });
  }

  // 語音符號：把使用者自訂的 {觸發詞: 符號} 送進後端（即時生效）
  async setCustomEmojis(emojis) {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "set_custom_emojis", emojis: emojis || {} });
  }
  // 取得內建符號對照表（給設定頁顯示）
  async getEmojiMap() {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "get_emoji_map" });
  }

  async precogStart(profile = "standard") {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "precog_start", profile });
  }

  async precogFeed(audioB64) {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "precog_feed", audio_data: audioB64 });
  }

  async precogAbort() {
    if (!this.serverReady) return { success: true };
    try {
      return await this._sendServerCommand({ action: "precog_abort" });
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 發送音頻數據到串流會話
   * @param {string} audioData - Base64 編碼的音頻數據
   * @param {boolean} isFinal - 是否為最後一段
   * @returns {Promise<{success: boolean, partialText: string}>}
   */
  async streamingFeed(audioData, isFinal = false) {
    if (!this.activeStreamSession) {
      return { success: false, error: "沒有活動的串流會話" };
    }

    if (!this.serverReady) {
      return { success: false, error: "Sherpa 服務器未就緒" };
    }

    try {
      const result = await this._sendServerCommand({
        action: "stream_feed",
        session_id: this.activeStreamSession,
        audio_data: audioData,
        is_final: isFinal,
      });

      return result;
    } catch (error) {
      this.logger.error && this.logger.error("發送串流數據失敗:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 結束串流會話並獲取最終結果
   * @returns {Promise<{success: boolean, finalText: string, rawText: string}>}
   */
  async streamingEnd() {
    if (!this.activeStreamSession) {
      return { success: false, error: "沒有活動的串流會話" };
    }

    if (!this.serverReady) {
      return { success: false, error: "Sherpa 服務器未就緒" };
    }

    try {
      const result = await this._sendServerCommand({
        action: "stream_end",
        session_id: this.activeStreamSession,
      });

      this.activeStreamSession = null;
      this.logger.info && this.logger.info("串流會話已結束:", result);

      return result;
    } catch (error) {
      this.logger.error && this.logger.error("結束串流會話失敗:", error);
      this.activeStreamSession = null;
      return { success: false, error: error.message };
    }
  }

  /**
   * 預載串流模型以減少首次延遲
   * @returns {Promise<{success: boolean}>}
   */
  async preloadStreamingModel() {
    const modelStatus = await this.ensureStreamingModelAvailable();
    if (!modelStatus.success) {
      return modelStatus;
    }

    if (!this.serverReady) {
      if (this.initializationPromise) {
        await this.initializationPromise;
      }
      if (!this.serverReady) {
        return { success: false, error: "Sherpa 服務器未就緒" };
      }
    }

    try {
      const result = await this._sendServerCommand({
        action: "init_streaming",
      });

      this.logger.info && this.logger.info("串流模型預載結果:", result);
      return result;
    } catch (error) {
      this.logger.error && this.logger.error("預載串流模型失敗:", error);
      return { success: false, error: error.message };
    }
  }

  // =====================================================
  // 熱詞功能 API
  // =====================================================

  /**
   * 取得熱詞設定
   * @returns {Promise<{success: boolean, enabled: boolean, score: number, words: string[]}>}
   */
  async getHotwords() {
    if (!this.serverReady) {
      if (this.initializationPromise) {
        await this.initializationPromise;
      }
      if (!this.serverReady) {
        return { success: false, error: "Sherpa 服務器未就緒" };
      }
    }

    try {
      const result = await this._sendServerCommand({ action: "get_hotwords" });
      this.logger.info && this.logger.info("取得熱詞設定:", result);
      return result;
    } catch (error) {
      this.logger.error && this.logger.error("取得熱詞設定失敗:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 設定熱詞
   * @param {Object} config - 熱詞設定
   * @param {boolean} config.enabled - 是否啟用熱詞
   * @param {number} config.score - 熱詞提升分數 (1.0-3.0)
   * @param {string[]} config.words - 熱詞列表
   * @returns {Promise<{success: boolean}>}
   */
  async setHotwords(config) {
    if (!this.serverReady) {
      if (this.initializationPromise) {
        await this.initializationPromise;
      }
      if (!this.serverReady) {
        return { success: false, error: "Sherpa 服務器未就緒" };
      }
    }

    try {
      // 後端 sherpa_server.py 從巢狀的 config 讀（command.get("config")），
      // 之前送扁平欄位 → 後端永遠拿到空設定 → 熱詞從沒寫入 hotwords.txt（PR #20 yhlhenry）。
      const result = await this._sendServerCommand({
        action: "set_hotwords",
        config: {
          enabled: config.enabled,
          score: config.score,
          words: config.words,
        },
      });
      this.logger.info && this.logger.info("設定熱詞結果:", result);
      return result;
    } catch (error) {
      this.logger.error && this.logger.error("設定熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 新增單一熱詞
   * @param {string} word - 要新增的熱詞
   * @returns {Promise<{success: boolean, words: string[]}>}
   */
  async addHotword(word) {
    if (!word || typeof word !== "string" || word.trim() === "") {
      return { success: false, error: "熱詞不能為空" };
    }

    try {
      // 先取得現有熱詞設定
      const currentConfig = await this.getHotwords();
      if (!currentConfig.success) {
        return currentConfig;
      }

      const words = currentConfig.words || [];
      const trimmedWord = word.trim();

      // 檢查是否已存在
      if (words.includes(trimmedWord)) {
        return { success: false, error: "熱詞已存在" };
      }

      // 加入新熱詞
      words.push(trimmedWord);

      // 設定新的熱詞列表
      const result = await this.setHotwords({
        enabled: currentConfig.enabled !== false,
        score: currentConfig.score || 1.5,
        words: words,
      });

      if (result.success) {
        return { success: true, words: words };
      }
      return result;
    } catch (error) {
      this.logger.error && this.logger.error("新增熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 刪除單一熱詞
   * @param {string} word - 要刪除的熱詞
   * @returns {Promise<{success: boolean, words: string[]}>}
   */
  async removeHotword(word) {
    if (!word || typeof word !== "string") {
      return { success: false, error: "熱詞不能為空" };
    }

    try {
      // 先取得現有熱詞設定
      const currentConfig = await this.getHotwords();
      if (!currentConfig.success) {
        return currentConfig;
      }

      const words = currentConfig.words || [];
      const trimmedWord = word.trim();

      // 檢查是否存在
      const index = words.indexOf(trimmedWord);
      if (index === -1) {
        return { success: false, error: "熱詞不存在" };
      }

      // 移除熱詞
      words.splice(index, 1);

      // 設定新的熱詞列表
      const result = await this.setHotwords({
        enabled: currentConfig.enabled !== false,
        score: currentConfig.score || 1.5,
        words: words,
      });

      if (result.success) {
        return { success: true, words: words };
      }
      return result;
    } catch (error) {
      this.logger.error && this.logger.error("刪除熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = SherpaManager;
