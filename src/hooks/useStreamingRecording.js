import { useState, useRef, useCallback, useEffect } from 'react';
import { useModelStatus } from './useModelStatus';
import { convertText, useTranslation } from '../i18n';

/**
 * 串流錄音功能 Hook
 * 提供邊錄音邊辨識、即時顯示文字的功能
 */
export const useStreamingRecording = () => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState(null);

  // 即時辨識文字
  const [partialText, setPartialText] = useState('');
  const [fullText, setFullText] = useState('');

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);

  // 串流辨識狀態
  const streamingActiveRef = useRef(false);

  // 音頻緩衝區（用於累積足夠的音頻數據）
  const audioBufferRef = useRef([]);
  const sendIntervalRef = useRef(null);

  // VAD 停頓偵測 - 平衡設定（穩定性優先）
  const silenceStartRef = useRef(null);  // 靜音開始時間
  const lastVoiceTimeRef = useRef(null); // 最後有聲音的時間
  const segmentTextRef = useRef('');     // 當前段落累積的文字
  const SILENCE_THRESHOLD = 0.01;        // 靜音門檻
  const SILENCE_DURATION = 500;          // 靜音持續多久觸發分段（ms）

  // 麥克風權限狀態快取
  const micPermissionRef = useRef('unknown');

  // 使用模型狀態 Hook
  const modelStatus = useModelStatus();

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
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }

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

    audioBufferRef.current = [];
    streamingActiveRef.current = false;
    silenceStartRef.current = null;
    lastVoiceTimeRef.current = null;
    segmentTextRef.current = '';
  }, []);

  // 開始串流錄音
  const startStreaming = useCallback(async () => {
    try {
      setError(null);
      setPartialText('');
      setFullText('');
      setIsInitializing(true);

      // 檢查 Sherpa 是否就緒
      if (!modelStatus.isReady) {
        if (modelStatus.isLoading) {
          throw new Error(t('errors.asrStarting'));
        } else {
          throw new Error(t('errors.asrNotReady'));
        }
      }

      // 檢查瀏覽器支援
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(t('errors.browserNoRecording'));
      }

      // ⚡ 立即設定錄音狀態，讓 UI 馬上反應
      // 如果麥克風權限已授權，可以安全地先顯示錄音中
      if (micPermissionRef.current === 'granted') {
        setIsRecording(true);
      }

      // 請求麥克風權限（這是最慢的步驟）
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // 如果之前沒有權限，現在有了，更新狀態
      if (micPermissionRef.current !== 'granted') {
        micPermissionRef.current = 'granted';
        setIsRecording(true);
      }

      streamRef.current = stream;

      // 創建 AudioContext
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });
      audioContextRef.current = audioContext;

      // 創建音源節點
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // 創建 ScriptProcessor 來獲取原始音頻數據
      // 注意：ScriptProcessor 已被標記為 deprecated，但 AudioWorklet 較複雜
      const bufferSize = 4096;  // 標準 buffer size，確保音頻穩定
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!streamingActiveRef.current) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // 計算 RMS 音量（用於 VAD 偵測）
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);

        // 轉換為 16-bit PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }

        // VAD 偵測：檢查是否有聲音
        const now = Date.now();
        if (rms > SILENCE_THRESHOLD) {
          // 有聲音
          lastVoiceTimeRef.current = now;
          silenceStartRef.current = null;
        } else {
          // 靜音
          if (lastVoiceTimeRef.current && !silenceStartRef.current) {
            silenceStartRef.current = now;
          }
        }

        // 累積到緩衝區
        audioBufferRef.current.push(pcmData);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // 開始串流辨識會話
      if (window.electronAPI) {
        const startResult = await window.electronAPI.streamingStart();
        if (!startResult.success) {
          throw new Error(startResult.error || t('errors.cannotStartStreamingSession'));
        }
      }

      streamingActiveRef.current = true;
      setIsInitializing(false);

      // 定期發送音頻數據（平衡模式：每 250ms）
      sendIntervalRef.current = setInterval(async () => {
        if (!streamingActiveRef.current || audioBufferRef.current.length === 0) return;

        // 檢查是否偵測到停頓（靜音超過 SILENCE_DURATION）
        const now = Date.now();
        const isSilencePause = silenceStartRef.current &&
                               (now - silenceStartRef.current) > SILENCE_DURATION &&
                               lastVoiceTimeRef.current;

        // 合併緩衝區中的所有數據
        const totalLength = audioBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);
        const mergedBuffer = new Int16Array(totalLength);
        let offset = 0;
        for (const chunk of audioBufferRef.current) {
          mergedBuffer.set(chunk, offset);
          offset += chunk.length;
        }
        audioBufferRef.current = [];

        // 發送到後端進行辨識
        if (window.electronAPI && mergedBuffer.length > 0) {
          try {
            // 使用瀏覽器原生方式轉換為 base64
            const uint8Array = new Uint8Array(mergedBuffer.buffer);
            const base64 = btoa(String.fromCharCode(...uint8Array));

            // 如果偵測到停頓，發送 is_final=true 來觸發分段
            const result = await window.electronAPI.streamingFeed(
              base64,
              isSilencePause  // 停頓時標記為 final，觸發分段處理
            );

            if (result.success) {
              // 更新即時文字
              if (result.partial_text) {
                setPartialText(result.partial_text);
              }
              if (result.full_text) {
                // 如果是分段結束，累積文字
                if (isSilencePause && result.full_text) {
                  segmentTextRef.current += result.full_text;
                  setFullText(segmentTextRef.current);

                  // 重置 VAD 狀態，開始新段落
                  silenceStartRef.current = null;
                  lastVoiceTimeRef.current = null;

                  // 重新開始串流會話
                  await window.electronAPI.streamingStart();
                } else {
                  setFullText(segmentTextRef.current + result.full_text);
                }
              }
            }
          } catch (err) {
            console.error('串流辨識錯誤:', err);
          }
        }
      }, 250);  // 平衡模式：250ms 間隔

    } catch (err) {
      setError(t('errors.cannotStartStreaming', { error: err.message }));
      setIsRecording(false);
      setIsInitializing(false);
      cleanup();
    }
  }, [modelStatus.isReady, modelStatus.isLoading, cleanup, t]);

  // 停止串流錄音
  const stopStreaming = useCallback(async () => {
    if (!streamingActiveRef.current) return;

    streamingActiveRef.current = false;
    setIsProcessing(true);

    try {
      // 發送最後一批數據
      if (audioBufferRef.current.length > 0 && window.electronAPI) {
        const totalLength = audioBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);
        const mergedBuffer = new Int16Array(totalLength);
        let offset = 0;
        for (const chunk of audioBufferRef.current) {
          mergedBuffer.set(chunk, offset);
          offset += chunk.length;
        }
        audioBufferRef.current = [];

        // 標記為最後一個 chunk - 使用瀏覽器原生方式轉換為 base64
        const uint8Array = new Uint8Array(mergedBuffer.buffer);
        const base64 = btoa(String.fromCharCode(...uint8Array));
        await window.electronAPI.streamingFeed(
          base64,
          true
        );
      }

      // 結束串流會話並獲取最終結果
      if (window.electronAPI) {
        const endResult = await window.electronAPI.streamingEnd();

        if (endResult.success && endResult.final_text) {
          let finalText = endResult.final_text;

          // 依介面語言做簡繁轉換（zh-CN → 簡體，zh-TW → 繁體）
          const targetLang = await window.electronAPI.getSetting('language', 'zh-TW');
          const shouldConvert = await window.electronAPI.getSetting('convert_transcription', true);

          if (shouldConvert && (targetLang === 'zh-TW' || targetLang === 'zh-CN')) {
            finalText = convertText(finalText, targetLang);
          }

          setFullText(finalText);

          // 觸發完成回調
          if (window.onTranscriptionComplete) {
            window.onTranscriptionComplete({
              success: true,
              text: finalText,
              streaming: true
            });
          }

          // 保存轉錄記錄
          const transcriptionData = {
            raw_text: finalText,
            text: finalText,
            confidence: 0,
            language: targetLang,
            duration: 0,
            file_size: 0,
          };

          await window.electronAPI.saveTranscription(transcriptionData);
        }
      }
    } catch (err) {
      setError(t('errors.stopStreamingFailed', { error: err.message }));
    } finally {
      cleanup();
      setIsRecording(false);
      setIsProcessing(false);
    }
  }, [cleanup, t]);

  // 取消串流錄音
  const cancelStreaming = useCallback(() => {
    streamingActiveRef.current = false;
    cleanup();
    setIsRecording(false);
    setIsProcessing(false);
    setPartialText('');
    setFullText('');
    setError(null);
  }, [cleanup]);

  // 組件卸載時清理
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isRecording,
    isProcessing,
    isInitializing,
    error,
    partialText,
    fullText,
    startStreaming,
    stopStreaming,
    cancelStreaming
  };
};
