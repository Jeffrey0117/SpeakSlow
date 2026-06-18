const { ipcMain } = require("electron");
const { runVoiceCommand } = require("../commandMode");
const recovery = require("../recovery");

module.exports = function register(ctx) {
  // 打開「記下來」的筆記檔（用系統預設程式）
  ipcMain.handle("open-notes", async () => {
    try {
      const { app, shell } = require("electron");
      const fs = require("fs");
      const p = require("path").join(app.getPath("userData"), "speakslow-notes.md");
      if (!fs.existsSync(p)) fs.writeFileSync(p, "# 聲聲慢筆記\n", "utf8");
      await shell.openPath(p);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 崩潰救援：錄音中持續把音訊寫到暫存檔，中斷時下次開機可救回
  ipcMain.handle("recovery-begin", async () => recovery.begin());
  ipcMain.handle("recovery-append", async (_e, b64) => recovery.append(b64));
  ipcMain.handle("recovery-end", async () => recovery.end());

  // 點字改錯：給「選取的那段」3~5 個依上下文的正確候選（走 AI，本地 Ollama 免費）
  ipcMain.handle("suggest-corrections", async (_event, sentence, target) => {
    try {
      if (!ctx.aiProcessor) return { success: false, error: "AI 未設定" };
      const t = (target || "").trim();
      if (!t) return { success: false, error: "沒有選取文字" };
      const prompt =
        "這是一段語音辨識結果，可能有同音字或聽錯的詞。\n" +
        "句子：「" + (sentence || t) + "」\n" +
        "其中「" + t + "」這部分使用者覺得可能辨識錯了。\n" +
        "請依上下文，給 3~5 個最可能的「正確」候選（可含原樣），用 JSON 字串陣列輸出，" +
        "例如 [\"申請\",\"深圳\"]。只輸出 JSON 陣列，不要任何其他文字。";
      const res = await ctx.aiProcessor.processTextWithAI(t, "correct", prompt);
      if (!res || !res.success || typeof res.text !== "string") {
        return { success: false, error: (res && res.error) || "取得候選失敗" };
      }
      let arr = [];
      try {
        const m = res.text.match(/\[[\s\S]*\]/);
        arr = m ? JSON.parse(m[0]) : [];
      } catch (e) { arr = []; }
      arr = (Array.isArray(arr) ? arr : [])
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim())
        .slice(0, 6);
      // 本地 qwen 常吐簡體 → 統一轉繁體（與操作模式 AI 一致；text_transform 是純 opencc）
      if (arr.length && ctx.sherpaManager?.transformText) {
        try {
          const conv = await ctx.sherpaManager.transformText(arr.join("\n"), "to_traditional");
          if (conv && conv.success && typeof conv.text === "string") {
            const lines = conv.text.split("\n").map((s) => s.trim()).filter(Boolean);
            if (lines.length === arr.length) arr = lines;
          }
        } catch (e) { /* 轉換失敗就用原文 */ }
      }
      return { success: true, suggestions: arr };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 操作模式：把一段辨識文字當指令派發（比對到才執行，否則回 matched:false）
  ipcMain.handle("run-voice-command", async (_event, text) => {
    try {
      return await runVoiceCommand(ctx, text);
    } catch (error) {
      return { matched: false, success: false, error: error.message };
    }
  });

  // 录音相关
  ipcMain.handle("start-recording", async () => {
    // TODO: 实现录音开始功能
    return { success: true };
  });

  ipcMain.handle("stop-recording", async () => {
    // TODO: 实现录音停止功能
    return { success: true };
  });

  // Sherpa ASR 相关
  ipcMain.handle("check-sherpa-status", async () => {
    console.log("[IPC] check-sherpa-status 被調用, serverReady:", ctx.sherpaManager.serverReady);
    const status = await ctx.sherpaManager.checkStatus();
    console.log("[IPC] check-sherpa-status 返回:", JSON.stringify(status));
    return {
      ...status,
      server_ready: ctx.sherpaManager.serverReady
    };
  });

  ipcMain.handle("sherpa-status", async () => {
    return await ctx.sherpaManager.checkStatus();
  });

  // 模型文件管理
  ipcMain.handle("check-model-files", async () => {
    console.log("[IPC] check-model-files 被調用");
    const result = await ctx.sherpaManager.checkModelFiles();
    // 同時返回服務器狀態，避免前端需要額外調用
    const serverStatus = {
      server_ready: ctx.sherpaManager.serverReady,
      models_initialized: ctx.sherpaManager.modelsInitialized
    };
    console.log("[IPC] check-model-files 返回:", JSON.stringify({...result, ...serverStatus}));
    return { ...result, ...serverStatus };
  });

  ipcMain.handle("get-download-progress", async () => {
    return await ctx.sherpaManager.getDownloadProgress();
  });

  ipcMain.handle("download-models", async (event) => {
    return await ctx.sherpaManager.downloadModels((progress) => {
      event.sender.send("model-download-progress", progress);
    });
  });

  // 音频转录相关
  ipcMain.handle("transcribe-audio", async (event, audioData, options) => {
    // 錄音的持久化由 sherpaManager.transcribeAudio 負責（persistAudioFile，
    // 回傳 audio_path）。這裡不再另存一份 — 之前重複存檔導致每段錄音
    // 落地兩份 WAV，且此處覆蓋 audio_path 讓另一份變成孤兒檔。
    return await ctx.sherpaManager.transcribeAudio(audioData, options);
  });

  // 邊錄邊算（precog）：錄音中把已閉合語音段先解碼，停止時只剩尾段
  ipcMain.handle("precog-start", async (event, profile) => {
    try {
      return await ctx.sherpaManager.precogStart(profile);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("precog-feed", async (event, audioB64) => {
    try {
      return await ctx.sherpaManager.precogFeed(audioB64);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("precog-abort", async () => {
    try {
      return await ctx.sherpaManager.precogAbort();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 串流辨識 API (Zipformer Transducer)
  ipcMain.handle("streaming-start", async (event, options = {}) => {
    try {
      return await ctx.sherpaManager.streamingStart(options);
    } catch (error) {
      ctx.logger.error("串流辨識啟動失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("streaming-feed", async (event, audioChunk, isFinal = false) => {
    try {
      return await ctx.sherpaManager.streamingFeed(audioChunk, isFinal);
    } catch (error) {
      ctx.logger.error("串流辨識送入音訊失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("streaming-end", async () => {
    try {
      return await ctx.sherpaManager.streamingEnd();
    } catch (error) {
      ctx.logger.error("串流辨識結束失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("preload-streaming-model", async () => {
    try {
      return await ctx.sherpaManager.preloadStreamingModel();
    } catch (error) {
      ctx.logger.error("預載串流模型失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("check-streaming-model-files", async () => {
    try {
      return await ctx.sherpaManager.checkStreamingModelFiles();
    } catch (error) {
      ctx.logger.error("檢查串流模型失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("download-streaming-model", async (event) => {
    try {
      return await ctx.sherpaManager.downloadStreamingModel((progress) => {
        event.sender.send("streaming-model-download-progress", progress);
      });
    } catch (error) {
      ctx.logger.error("下載串流模型失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 重新辨識：用保存的原始錄音重跑，更新該筆文字
  ipcMain.handle("retranscribe-transcription", async (event, id, options = {}) => {
    try {
      const record = ctx.databaseManager.getTranscriptionById(id);
      if (!record) return { success: false, error: "找不到該筆紀錄" };
      if (!record.audio_path) {
        return { success: false, error: "這筆沒有保存錄音檔（舊資料無法重辨）" };
      }
      const fs = require("fs");
      if (!fs.existsSync(record.audio_path)) {
        return { success: false, error: "錄音檔已不存在" };
      }
      const result = await ctx.sherpaManager.transcribeFilePath(record.audio_path, options);
      if (!result || !result.success) {
        return { success: false, error: result?.error || "辨識失敗" };
      }
      ctx.databaseManager.updateTranscriptionText(id, result.text, null);
      return { success: true, text: result.text };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ===== 熱詞功能 =====
  ipcMain.handle("get-hotwords", async () => {
    try {
      return await ctx.sherpaManager.getHotwords();
    } catch (error) {
      ctx.logger.error("取得熱詞設定失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("set-hotwords", async (event, config) => {
    try {
      // config: { enabled: boolean, score: number, words: string[] }
      return await ctx.sherpaManager.setHotwords(config);
    } catch (error) {
      ctx.logger.error("設定熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("add-hotword", async (event, word) => {
    try {
      return await ctx.sherpaManager.addHotword(word);
    } catch (error) {
      ctx.logger.error("新增熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("remove-hotword", async (event, word) => {
    try {
      return await ctx.sherpaManager.removeHotword(word);
    } catch (error) {
      ctx.logger.error("刪除熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 模型管理 - 更新为实际功能
  ipcMain.handle("download-model", async (event, modelName) => {
    // 使用统一的模型下载功能
    return await ctx.sherpaManager.downloadModels((progress) => {
      event.sender.send("model-download-progress", progress);
    });
  });

  ipcMain.handle("get-available-models", () => {
    // 返回 Sherpa 支持的模型列表
    return {
      models: [
        {
          name: "sherpa-onnx-paraformer-zh",
          displayName: "Sherpa Paraformer (中文)",
          type: "asr",
          size: "約 220MB",
          description: "Sherpa-ONNX 中文語音識別模型"
        }
      ]
    };
  });

  ipcMain.handle("get-current-model", async () => {
    const status = await ctx.sherpaManager.checkStatus();
    return {
      model: "sherpa-onnx-paraformer-zh",
      status: status.models_downloaded ? "ready" : "not_downloaded",
      details: status
    };
  });

  ipcMain.handle("switch-model", (event, modelName) => {
    // Sherpa 目前使用固定模型，暂不支持切换
    return {
      success: false,
      error: "Sherpa 目前使用固定模型，暂不支持切换"
    };
  });

  ipcMain.handle("test-sherpa-environment", async () => {
    try {
      ctx.logger && ctx.logger.info && ctx.logger.info('开始测试Sherpa环境');

      const sherpaStatus = await ctx.sherpaManager.checkStatus();

      const testResult = {
        success: true,
        sherpaStatus,
        timestamp: new Date().toISOString()
      };

      ctx.logger && ctx.logger.info && ctx.logger.info('Sherpa环境测试完成', testResult);

      return testResult;
    } catch (error) {
      const errorResult = {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };

      ctx.logger && ctx.logger.error && ctx.logger.error('Sherpa环境测试失败', errorResult);

      return errorResult;
    }
  });

  ipcMain.handle("restart-sherpa-server", async () => {
    try {
      ctx.logger && ctx.logger.info && ctx.logger.info('手动重启Sherpa服务器');

      // 使用新的restartServer方法
      const result = await ctx.sherpaManager.restartServer();

      return result;
    } catch (error) {
      ctx.logger && ctx.logger.error && ctx.logger.error('重启Sherpa服务器失败', error);
      return {
        success: false,
        error: error.message
      };
    }
  });
};
