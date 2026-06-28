import { useState, useRef, useCallback, useEffect } from 'react';
import { convertText, useTranslation } from '../i18n';

/**
 * 录音功能Hook
 * 提供录音、停止录音、音频处理等功能
 * @param modelStatus 由呼叫端（App）傳入共用的 useModelStatus 實例 —
 *   不在這裡自建，避免兩套 3 秒輪詢與重複事件訂閱同時跑。
 */
export const useRecording = (modelStatus) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState(null);
  const [audioData, setAudioData] = useState(null);

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);

  // PCM 音頻數據緩衝區（直接錄製 PCM，不需要解碼 webm）
  const pcmBufferRef = useRef([]);

  // 添加防重复处理机制
  const processingRef = useRef({ isProcessingAudio: false, lastProcessTime: 0 });

  // 邊錄邊算（precog）：長講時錄音中先解碼已講完的段落，停止只剩尾段。
  // 錄音超過 PRECOG_START_SEC 才啟動 — 短句維持單次解碼路徑（保留停頓斷行）。
  const PRECOG_START_SEC = 12;
  const precogRef = useRef({ active: false, fedChunks: 0, timer: null });

  const stopPrecogTimer = useCallback(() => {
    if (precogRef.current.timer) {
      clearInterval(precogRef.current.timer);
      precogRef.current.timer = null;
    }
  }, []);

  // Float32 (sourceRate) → Int16 16kHz → base64
  const chunksToPcm16Base64 = (chunks, sourceRate) => {
    const total = chunks.reduce((s, a) => s + a.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    const ratio = sourceRate / 16000;
    const outLen = Math.floor(merged.length / ratio);
    const int16 = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = i * ratio;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, merged.length - 1);
      const frac = idx - lo;
      const s = merged[lo] * (1 - frac) + merged[hi] * frac;
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
    const bytes = new Uint8Array(int16.buffer);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  };

  // 麥克風權限狀態快取
  const micPermissionRef = useRef('unknown');

  // 預查詢麥克風權限狀態
  useEffect(() => {
    const checkMicPermission = async () => {
      if (navigator.permissions) {
        try {
          const result = await navigator.permissions.query({ name: 'microphone' });
          micPermissionRef.current = result.state;
          result.onchange = () => {
            micPermissionRef.current = result.state;
          };
        } catch (e) {
          // 某些瀏覽器不支援 permissions API
        }
      }
    };
    checkMicPermission();
  }, []);

  // 清理資源
  const cleanup = useCallback(() => {
    stopPrecogTimer(); // 停止邊錄邊算的餵入（不 abort：成功路徑還要取用結果）
    // 錄音正常結束/取消 → 收掉崩潰救援暫存檔（這段已正常處理，不是孤兒）
    try { window.electronAPI?.recoveryEnd?.(); } catch (e) { /* ignore */ }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    pcmBufferRef.current = [];
  }, [stopPrecogTimer]);

  // 开始录音（使用 ScriptProcessor 直接錄製 PCM，避免 webm 解碼問題）
  const startRecording = useCallback(async () => {
    try {
      setError(null);

      // 检查 Sherpa 是否就绪
      if (!modelStatus.isReady) {
        if (modelStatus.isLoading) {
          throw new Error(t('errors.asrStarting'));
        } else if (modelStatus.error) {
          throw new Error(t('errors.asrNotReady'));
        } else {
          throw new Error(t('errors.asrPreparing'));
        }
      }

      // 检查浏览器支持
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(t('errors.browserNoRecording'));
      }

      // ⚡ 立即設定錄音狀態，讓 UI 馬上反應
      if (micPermissionRef.current === 'granted') {
        setIsRecording(true);
      }

      // 请求麦克风权限
      // 讀取使用者指定的麥克風 + 自動增益設定（沒指定就用系統預設）
      let savedMicId = '';
      let agcOn = true;
      try {
        savedMicId = (await window.electronAPI?.getSetting?.('mic_device_id', '')) || '';
        agcOn = (await window.electronAPI?.getSetting?.('mic_auto_gain', true)) !== false;
      } catch (e) { /* 讀不到就用預設 */ }

      const audioConstraints = {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: agcOn
      };
      if (savedMicId) audioConstraints.deviceId = { exact: savedMicId };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (err) {
        // 指定的麥克風不在了（拔掉 / 換 USB 孔）→ 退回系統預設，別讓錄音直接掛掉
        if (savedMicId) {
          if (window.electronAPI?.log) window.electronAPI.log('warn', `指定的麥克風不可用，改用預設: ${err.message}`);
          delete audioConstraints.deviceId;
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        } else {
          throw err;
        }
      }

      // 更新狀態
      if (micPermissionRef.current !== 'granted') {
        micPermissionRef.current = 'granted';
        setIsRecording(true);
      }

      streamRef.current = stream;
      pcmBufferRef.current = [];

      // 記錄實際使用的麥克風裝置（協助確認收音來源）
      try {
        const micTrack = stream.getAudioTracks()[0];
        const micSettings = micTrack?.getSettings?.() || {};
        let label = micTrack?.label || '';
        // label 為空時，用 enumerateDevices 透過 deviceId 反查名稱
        if (!label && micSettings.deviceId && navigator.mediaDevices?.enumerateDevices) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const dev = devices.find(
              (d) => d.kind === 'audioinput' && d.deviceId === micSettings.deviceId
            );
            label = dev?.label || '';
          } catch (e) { /* ignore */ }
        }
        const msg =
          `🎤 使用麥克風: label="${label || '(未知)'}" ` +
          `sampleRate=${micSettings.sampleRate} NS=${micSettings.noiseSuppression} ` +
          `AGC=${micSettings.autoGainControl} EC=${micSettings.echoCancellation}`;
        if (window.electronAPI?.log) window.electronAPI.log('info', msg);
        console.log(msg);
      } catch (logErr) {
        // 記錄失敗不影響錄音
      }

      // 創建 AudioContext（使用預設採樣率，讓瀏覽器自動處理）
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;

      // 確保 AudioContext 是活躍的
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // 創建音源節點
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // 創建 ScriptProcessor 來獲取原始 PCM 數據
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // 複製數據到緩衝區
        pcmBufferRef.current.push(new Float32Array(inputData));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // 邊錄邊算：每秒檢查，超過門檻就啟動 precog 並持續餵新音訊
      // 效能模式（asr_profile: standard | fast）跟正式辨識用同一顆模型
      let asrProfile = 'standard';
      try {
        asrProfile = await window.electronAPI?.getSetting?.('asr_profile', 'standard') || 'standard';
      } catch (e) { /* 預設 standard */ }
      precogRef.current = { active: false, fedChunks: 0, recoveryFed: 0, timer: null, profile: asrProfile };
      const srcRate = audioContext.sampleRate;
      // 崩潰救援：開一條暫存檔，錄音中持續寫入；正常/取消停止時會刪掉
      try { window.electronAPI?.recoveryBegin?.(); } catch (e) { /* ignore */ }
      precogRef.current.timer = setInterval(async () => {
        try {
          const p = precogRef.current;
          const chunks = pcmBufferRef.current;
          const totalSamples = chunks.reduce((s, a) => s + a.length, 0);
          // 崩潰救援：每秒把新音訊 append 到暫存檔（不管 precog 有沒有啟動）
          if (chunks.length > (p.recoveryFed || 0)) {
            const recNew = chunks.slice(p.recoveryFed || 0);
            p.recoveryFed = chunks.length;
            try {
              const rb64 = chunksToPcm16Base64(recNew, srcRate);
              window.electronAPI?.recoveryAppend?.(rb64);
            } catch (e) { /* 救援失敗不影響錄音 */ }
          }
          if (!p.active) {
            if (totalSamples / srcRate < PRECOG_START_SEC) return;
            const r = await window.electronAPI?.precogStart?.(p.profile);
            if (!r?.success) { stopPrecogTimer(); return; } // 後端不支援就放棄
            p.active = true;
          }
          const newChunks = chunks.slice(p.fedChunks);
          if (newChunks.length === 0) return;
          p.fedChunks = chunks.length;
          const b64 = chunksToPcm16Base64(newChunks, srcRate);
          window.electronAPI?.precogFeed?.(b64);
        } catch (err) {
          stopPrecogTimer(); // 任何錯誤 → 停止餵，回退一般路徑
        }
      }, 1000);

    } catch (err) {
      setError(t('errors.cannotStartRecording', { error: err.message }));
      setIsRecording(false);
      cleanup();
    }
  }, [modelStatus.isReady, modelStatus.isLoading, modelStatus.error, cleanup, t]);

  // 停止录音
  const stopRecording = useCallback(async () => {
    if (!isRecording) return;

    setIsRecording(false);
    setIsProcessing(true);

    try {
      // 檢查是否有錄音數據
      if (pcmBufferRef.current.length === 0) {
        throw new Error(t('errors.emptyRecording'));
      }

      // 獲取原始採樣率
      const sourceSampleRate = audioContextRef.current?.sampleRate || 48000;

      // 合併所有 PCM 數據
      const totalLength = pcmBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);

      if (totalLength < 1600) { // 小於 0.1 秒的錄音
        throw new Error(t('errors.recordingTooShort'));
      }

      const mergedBuffer = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of pcmBufferRef.current) {
        mergedBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      // 邊錄邊算：停止餵入；若已啟動，餵完最後一批再帶 flag 取結果
      stopPrecogTimer();
      const precogActive = precogRef.current.active;
      if (precogActive) {
        try {
          const lastChunks = pcmBufferRef.current.slice(precogRef.current.fedChunks);
          if (lastChunks.length > 0) {
            const b64 = chunksToPcm16Base64(lastChunks, sourceSampleRate);
            await window.electronAPI?.precogFeed?.(b64);
          }
        } catch (e) {
          /* 餵尾失敗 → 後端 finalize 拿不到完整 precog，會自動回退一般路徑 */
        }
      }

      // 清理資源
      cleanup();

      // 直接轉換為 WAV（重採樣到 16kHz）
      const wavBuffer = pcmToWav(mergedBuffer, sourceSampleRate, 16000);
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

      setAudioData(wavBlob);

      // 處理音頻
      const autoFormatLists = await window.electronAPI?.getSetting?.('auto_format_lists', false);
      const autoLineBreak = await window.electronAPI?.getSetting?.('auto_line_break', false);
      await processAudio(wavBlob, {
        use_precog: precogActive,
        profile: precogRef.current.profile || 'standard',
        auto_format_lists: autoFormatLists === true,
        auto_line_break: autoLineBreak === true,
      });
    } catch (err) {
      setError(t('errors.audioProcessingFailed', { error: err.message }));
      cleanup();
    } finally {
      setIsProcessing(false);
    }
  }, [isRecording, cleanup, t]);

  // 处理音频（接收已經是 WAV 格式的 blob）
  const processAudio = useCallback(async (wavBlob, transcribeOptions = {}) => {
    processingRef.current.isProcessingAudio = true;

    try {
      if (window.electronAPI) {
        const arrayBuffer = await wavBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const transcriptionResult = await window.electronAPI.transcribeAudio(uint8Array, transcribeOptions);

        if (transcriptionResult.success) {
          let raw_text = transcriptionResult.text;

          // 防幻聽第二道防線：空結果（純靜音/噪音）不貼上、不存檔、不跑 AI
          if (!raw_text || !raw_text.trim()) {
            console.log('未偵測到語音，跳過貼上與儲存');
            processingRef.current.isProcessingAudio = false;
            return;
          }

          // 检查是否需要转换为繁体中文
          const targetLang = await window.electronAPI.getSetting('language', 'zh-TW');
          const shouldConvert = await window.electronAPI.getSetting('convert_transcription', true);

          if (shouldConvert && targetLang === 'zh-TW') {
            raw_text = convertText(raw_text, 'zh-TW');
          }

          // 套用字典替換（校正專有名詞）
          try {
            const dictResult = await window.electronAPI.applyDictionary(raw_text);
            if (dictResult && dictResult !== raw_text) {
              raw_text = dictResult;
            }
          } catch (dictErr) {
            // 字典替換失敗不影響主流程
            console.warn('字典替換失敗:', dictErr);
          }

          // 准备转录数据
          const transcriptionData = {
            raw_text: raw_text,
            text: raw_text, // 初始文本设为原始文本
            confidence: transcriptionResult.confidence || 0,
            language: targetLang,
            duration: transcriptionResult.duration || 0,
            file_size: uint8Array.length,
            audio_path: transcriptionResult.audio_path || null, // 音訊檔案路徑
          };

          // 立即显示初步结果（已转换）
          if (window.onTranscriptionComplete) {
            window.onTranscriptionComplete({ ...transcriptionResult, text: raw_text, enhanced_by_ai: false });
          }

          // 异步处理AI优化和保存（只保存一次）
          setIsOptimizing(true);
          setTimeout(async () => {
            try {
              // 从设置中读取是否启用AI优化（默认关闭）
              const useAI = await window.electronAPI.getSetting('enable_ai_optimization', false);

              let finalData = { ...transcriptionData };

              if (useAI) {
                try {
                  if (window.electronAPI && window.electronAPI.log) {
                    window.electronAPI.log('info', '开始AI文本优化:', raw_text.substring(0, 50) + '...');
                  }
                  
                  const result = await window.electronAPI.processText(raw_text, 'optimize');

                  if (result && result.success) {
                    let processed_text = result.text;

                    // AI 輸出也需要繁簡轉換
                    if (shouldConvert && targetLang === 'zh-TW') {
                      processed_text = convertText(processed_text, 'zh-TW');
                    }

                    finalData.processed_text = processed_text;
                    // 如果AI优化后的文本与原始文本不同，则将优化后的文本作为主文本
                    if (processed_text && processed_text.trim() !== raw_text.trim()) {
                      finalData.text = processed_text;
                    }
                    if (window.electronAPI && window.electronAPI.log) {
                      window.electronAPI.log('info', 'AI文本优化成功', processed_text.substring(0, 50) + '...');
                    }
                  } else {
                    if (window.electronAPI && window.electronAPI.log) {
                      window.electronAPI.log('error', 'AI文本优化失败:', result);
                    }
                  }
                } catch (err) {
                  if (window.electronAPI && window.electronAPI.log) {
                    window.electronAPI.log('error', 'AI文本优化捕获到错误:', err);
                  }
                }
              }

              // 保存转录数据（只保存一次）
              if (window.electronAPI) {
                if (window.electronAPI && window.electronAPI.log) {
                  window.electronAPI.log('info', '准备保存转录数据:', finalData);
                }
                const savedResult = await window.electronAPI.saveTranscription(finalData);
                if (window.electronAPI && window.electronAPI.log) {
                  window.electronAPI.log('info', '转录数据保存成功:', savedResult);
                }

                // 通知UI更新并触发复制操作
                if (useAI && finalData.processed_text && finalData.processed_text !== raw_text) {
                  // 有AI优化结果时
                  const enhancedResult = {
                    ...transcriptionResult,
                    text: finalData.processed_text,
                    processed_text: finalData.processed_text,
                    enhanced_by_ai: true,
                  };
                  if (window.onAIOptimizationComplete) {
                    window.onAIOptimizationComplete(enhancedResult);
                  }
                } else {
                  // 没有AI优化或AI优化失败时，使用原始文本
                  const finalResult = {
                    ...transcriptionResult,
                    text: raw_text,
                    enhanced_by_ai: false,
                  };
                  if (window.onAIOptimizationComplete) {
                    window.onAIOptimizationComplete(finalResult);
                  }
                }
              }
            } catch (err) {
              if (window.electronAPI && window.electronAPI.log) {
                window.electronAPI.log('error', '处理和保存转录时出错:', err);
              }
            } finally {
              setIsOptimizing(false);
            }
          }, 100);

          return { ...transcriptionResult, enhanced_by_ai: false };
        } else {
          throw new Error(transcriptionResult.error || t('errors.transcriptionFailed'));
        }
      } else {
        // Web环境模拟
        const mockResult = { success: true, text: '模拟识别结果。', confidence: 0.95, duration: 3.5 };
        if (window.onTranscriptionComplete) window.onTranscriptionComplete(mockResult);
        return mockResult;
      }
    } catch (err) {
      throw new Error(t('errors.audioProcessingFailed', { error: err.message }));
    } finally {
      processingRef.current.isProcessingAudio = false;
    }
  }, [t]);

  // PCM 數據直接轉 WAV（帶重採樣）- 不需要 decodeAudioData
  const pcmToWav = (pcmData, sourceSampleRate, targetSampleRate) => {
    const sourceLength = pcmData.length;

    // 計算重採樣後的長度
    const resampleRatio = targetSampleRate / sourceSampleRate;
    const targetLength = Math.round(sourceLength * resampleRatio);

    // 線性插值重採樣
    const resampledData = new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i++) {
      const sourceIndex = i / resampleRatio;
      const index0 = Math.floor(sourceIndex);
      const index1 = Math.min(index0 + 1, sourceLength - 1);
      const fraction = sourceIndex - index0;
      resampledData[i] = pcmData[index0] * (1 - fraction) + pcmData[index1] * fraction;
    }

    const bytesPerSample = 2;
    const numberOfChannels = 1;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = targetSampleRate * blockAlign;
    const dataSize = targetLength * blockAlign;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // WAV 文件頭
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, targetSampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // 音頻數據
    let offset = 44;
    for (let i = 0; i < targetLength; i++) {
      const sample = Math.max(-1, Math.min(1, resampledData[i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }

    return buffer;
  };

  // 取消录音
  const cancelRecording = useCallback(() => {
    stopPrecogTimer();
    if (precogRef.current.active) {
      precogRef.current.active = false;
      window.electronAPI?.precogAbort?.();
    }
    cleanup();
    setIsRecording(false);
    setIsProcessing(false);
    setError(null);
  }, [cleanup, stopPrecogTimer]);

  // 获取录音权限状态
  const checkPermissions = useCallback(async () => {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' });
      return result.state; // 'granted', 'denied', 'prompt'
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('warn', '无法检查麦克风权限:', err);
      }
      return 'unknown';
    }
  }, []);


  return {
    isRecording,
    isProcessing,
    isOptimizing,
    error,
    audioData,
    startRecording,
    stopRecording,
    cancelRecording,
    checkPermissions
  };
};