import React, { useState, useEffect, useRef, useCallback } from "react";
import "./index.css";
import { toast } from "sonner";
import { getLevelIndex, LEVELS } from "./utils/levels";
import { LoadingDots } from "./components/ui/loading-dots";
import { useHotkey } from "./hooks/useHotkey";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { useRecording } from "./hooks/useRecording";
import { useStreamingRecording } from "./hooks/useStreamingRecording";
import { useTextProcessing } from "./hooks/useTextProcessing";
import { useModelStatus } from "./hooks/useModelStatus";
import { usePermissions } from "./hooks/usePermissions";
import { useTranslation } from "./i18n";
import { Mic, MicOff, Settings, Copy, Download, X, Pin, Minus, Sparkles, Minimize2, Maximize2, FileText } from "lucide-react";
import SettingsPanel from "./components/SettingsPanel";
import { ModelDownloadProgress } from "./components/ui/model-status-indicator";
import { resolveStreamingModeAvailability } from "./utils/streamingModeSupport.mjs";

// 动态导入设置页面组件
const SettingsPage = React.lazy(() => import('./settings.jsx').then(module => ({ default: module.SettingsPage })));

// 动态导入 TypeLess 指示器组件
const TypelessIndicator = React.lazy(() => import('./components/TypelessIndicator'));

// 逐字稿（上傳音檔轉文字）
const TranscribeModal = React.lazy(() => import('./components/TranscribeModal'));


// 声波图标组件（空闲/悬停状态）- 使用 React.memo 優化
const SoundWaveIcon = React.memo(({ size = 16, isActive = false }) => {
  return (
    <div className="flex items-center justify-center gap-1">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className={`bg-slate-600 dark:bg-gray-300 rounded-full transition-all duration-150 shadow-sm ${
            isActive ? "wave-bar" : ""
          }`}
          style={{
            width: size * 0.15,
            height: isActive ? size * 0.8 : size * 0.4,
            animationDelay: isActive ? `${i * 0.1}s` : "0s",
          }}
        />
      ))}
    </div>
  );
});

// 加载指示器组件（Sherpa 启动中）- 使用 React.memo 優化
const LoadingIndicator = React.memo(({ size = 20 }) => {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="w-1 bg-gray-500 rounded-full"
          style={{
            height: size * 0.6,
            animation: `loading-dots 1.4s ease-in-out infinite`,
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
});

// 语音波形指示器组件（处理状态）- 使用 React.memo 優化
const VoiceWaveIndicator = React.memo(({ isListening }) => {
  return (
    <div className="flex items-center justify-center gap-0.5">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className={`w-0.5 bg-white rounded-full transition-all duration-150 drop-shadow-sm ${
            isListening ? "animate-pulse h-5" : "h-2"
          }`}
          style={{
            animationDelay: isListening ? `${i * 0.1}s` : "0s",
            animationDuration: isListening ? `${0.6 + i * 0.1}s` : "0s",
          }}
        />
      ))}
    </div>
  );
});

// 處理中小進度條 - 簡單一條放在文字下面（統一藍色，不變色）
const ProcessingProgressBar = React.memo(() => {
  return (
    <div className="w-32 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mx-auto mt-2">
      <div className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full processing-progress-bar" />
    </div>
  );
});

// 有趣的處理中訊息列表（幽默版）— 內容放在語系檔 panel.processingMessages

// Fisher-Yates shuffle 演算法
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// 隨機訊息 Hook - Shuffle 輪播版本（像隨機播放音樂一樣）
// 每個訊息都會出現一次，播完一輪再重新打亂
const useRandomMessage = (isActive, messages) => {
  const [message, setMessage] = useState('');
  const prevActiveRef = useRef(false);
  const shuffledQueueRef = useRef([]);
  const lastMessageRef = useRef('');

  useEffect(() => {
    // 只在狀態從 false 變成 true 時選擇新訊息
    if (isActive && !prevActiveRef.current) {
      // 如果隊列空了，重新 shuffle
      if (shuffledQueueRef.current.length === 0) {
        let newQueue = shuffleArray(messages);
        // 避免新一輪的第一個跟上一輪最後一個重複
        if (newQueue[0] === lastMessageRef.current && newQueue.length > 1) {
          // 把第一個移到後面去
          newQueue = [...newQueue.slice(1), newQueue[0]];
        }
        shuffledQueueRef.current = newQueue;
      }

      // 從隊列取出下一個訊息
      const nextMessage = shuffledQueueRef.current.shift();
      lastMessageRef.current = nextMessage;
      setMessage(nextMessage);
    }
    prevActiveRef.current = isActive;
  }, [isActive, messages]);

  return message;
};

// 增强的工具提示组件
const Tooltip = ({ children, content, position = "top" }) => {
  const [isVisible, setIsVisible] = useState(false);

  const getPositionClasses = () => {
    if (position === "bottom") {
      return {
        tooltip: "absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-2 py-1 text-white bg-gradient-to-r from-neutral-800 to-neutral-700 rounded-md whitespace-nowrap z-50 transition-opacity duration-150",
        arrow: "absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-b-2 border-transparent border-b-neutral-800"
      };
    }
    // 默认为顶部
    return {
      tooltip: "absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 text-white bg-gradient-to-r from-neutral-800 to-neutral-700 rounded-md whitespace-nowrap z-50 transition-opacity duration-150",
      arrow: "absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-2 border-r-2 border-t-2 border-transparent border-t-neutral-800"
    };
  };

  const { tooltip, arrow } = getPositionClasses();

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children}
      </div>
      {isVisible && (
        <div
          className={tooltip}
          style={{ fontSize: "10px" }}
        >
          {content}
          <div className={arrow}></div>
        </div>
      )}
    </div>
  );
};

// 文本显示区域组件 - 簡化版，只顯示一個結果
// 選取一段文字 → 跳候選詞 → 點一下換掉（點字改錯）
const TextDisplay = React.memo(({ originalText, processedText, scrollRef, t, onApplyCorrection }) => {
  // 顯示的文字：優先顯示 AI 優化後的，沒有就顯示原始的
  const displayText = processedText || originalText;
  const pRef = React.useRef(null);
  const [fix, setFix] = React.useState(null); // {target,start,end,x,y,loading,suggestions}

  const closeFix = React.useCallback(() => setFix(null), []);

  const handleMouseUp = React.useCallback(async () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !pRef.current) return;
    const range = sel.getRangeAt(0);
    // 選取必須落在這個 <p> 的單一文字節點內，offset 才等於字元位置
    if (range.startContainer !== range.endContainer || range.startContainer.parentNode !== pRef.current) return;
    const target = sel.toString();
    if (!target.trim() || target.length > 20) return; // 太長就不是改錯字了
    const rect = range.getBoundingClientRect();
    const start = range.startOffset, end = range.endOffset;
    setFix({ target, start, end, x: rect.left, y: rect.bottom, loading: true, suggestions: [] });
    try {
      const res = await window.electronAPI?.suggestCorrections?.(displayText, target);
      setFix((f) => (f && f.target === target ? { ...f, loading: false, suggestions: res?.suggestions || [] } : f));
    } catch (e) {
      setFix((f) => (f ? { ...f, loading: false, suggestions: [] } : f));
    }
  }, [displayText]);

  const [custom, setCustom] = React.useState("");
  const pick = React.useCallback((word) => {
    if (!fix || !word || !word.trim()) return;
    const w = word.trim();
    const next = displayText.slice(0, fix.start) + w + displayText.slice(fix.end);
    onApplyCorrection?.(next, fix.target, w); // 帶上 (原, 改) → App 可記進字典
    setFix(null);
    setCustom("");
    try { window.getSelection()?.removeAllRanges(); } catch (e) {}
  }, [fix, displayText, onApplyCorrection]);

  // 沒有文字就不顯示這個區塊
  if (!displayText) return null;

  return (
    <div className="fade-in pb-3 h-full flex flex-col min-h-0">
      {/* 卡片填滿可用高度（貼近底下統計、不留大空隙），文字超過才在卡片內捲動 */}
      <div className="bg-white/90 dark:bg-gray-800/90 rounded-xl shadow-md border border-gray-200/70 dark:border-gray-700/60 overflow-hidden flex-1 flex flex-col min-h-0">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 panel-scroll">
          <p
            ref={pRef}
            onMouseUp={handleMouseUp}
            className="chinese-content text-gray-800 dark:text-gray-200"
            style={{ fontSize: '14px', lineHeight: 1.7, letterSpacing: '0.02em', whiteSpace: 'pre-wrap' }}
          >
            {displayText}
          </p>
        </div>
      </div>

      {/* 改錯候選浮窗 */}
      {fix && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={closeFix} style={{ WebkitAppRegion: 'no-drag' }} />
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 py-1.5 min-w-[140px] max-w-[240px]"
            style={{ left: Math.min(fix.x, window.innerWidth - 250), top: fix.y + 6, WebkitAppRegion: 'no-drag' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 text-[11px] text-gray-400 border-b border-gray-100 dark:border-gray-700 mb-1">
              {t('panel.correctFor', { word: fix.target })}
            </div>
            {fix.loading ? (
              <div className="px-3 py-2 text-xs text-gray-400">{t('panel.correctLoading')}</div>
            ) : (
              fix.suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => pick(s)}
                  className="block w-full text-left px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 hover:bg-sky-50 dark:hover:bg-sky-900/30"
                >
                  {s}
                </button>
              ))
            )}
            {/* 自己輸入：成為記憶字典，下次自動修 */}
            <div className="px-2 pt-1 mt-1 border-t border-gray-100 dark:border-gray-700">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') pick(custom); }}
                placeholder={t('panel.correctCustom')}
                className="w-full px-2 py-1.5 text-sm rounded-md bg-gray-50 dark:bg-gray-700/60 text-gray-800 dark:text-gray-200 outline-none placeholder:text-gray-400"
                style={{ WebkitAppRegion: 'no-drag' }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
});

// 空閒/錄音時的趣味輪播文字：重用使用者手寫的白爛句 + 幾句操作提示
// 內容放在語系檔 panel.processingMessages + panel.idleMessages

const IdlePlaceholder = React.memo(() => {
  const { t } = useTranslation();
  const idleMessages = [...t('panel.processingMessages'), ...t('panel.idleMessages')];
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(true);
  useEffect(() => {
    const iv = setInterval(() => {
      setShow(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % idleMessages.length);
        setShow(true);
      }, 300);
    }, 3500);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="h-full flex items-center justify-center text-center select-none">
      <p
        className={`text-sm text-gray-400 dark:text-gray-500 px-6 transition-opacity duration-300 ${
          show ? "opacity-100" : "opacity-0"
        }`}
      >
        {idleMessages[idx]}
      </p>
    </div>
  );
});

const SettingsPageWrapper = () => {
  const { t } = useTranslation();
  return (
    <React.Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <LoadingDots />
          <span className="text-gray-700 dark:text-gray-300">{t('app.loadingSettings')}</span>
        </div>
      </div>
    }>
      <SettingsPage />
    </React.Suspense>
  );
};

export default function App() {
  // 检查URL参数来决定渲染哪个页面
  const urlParams = new URLSearchParams(window.location.search);
  const page = urlParams.get('page');

  // 如果是设置页面，直接渲染设置组件（使用单独组件避免hooks规则问题）
  if (page === 'settings') {
    return <SettingsPageWrapper />;
  }

  // TypeLess 錄音指示器頁面
  if (page === 'typeless-indicator') {
    return (
      <React.Suspense fallback={<div className="w-full h-full" />}>
        <TypelessIndicator />
      </React.Suspense>
    );
  }

  const [isHovered, setIsHovered] = useState(false);
  const [originalText, setOriginalText] = useState("");
  const [processedText, setProcessedText] = useState("");
  const [showTextArea, setShowTextArea] = useState(false);
  const [stats, setStats] = useState(null); // 累計統計（次數 / 字數）
  const [showSettings, setShowSettings] = useState(false);
  const [showTranscribe, setShowTranscribe] = useState(false); // 逐字稿視窗
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true); // 視窗置頂狀態
  const [miniMode, setMiniMode] = useState(false); // 迷你模式（原地變身扁平浮窗）
  const [miniCopied, setMiniCopied] = useState(false); // 迷你條複製回饋
  const [commandMode, setCommandMode] = useState(false); // 操作模式（語音指令，預設關閉）
  const [commandRunning, setCommandRunning] = useState(false); // 指令執行中（底部跑馬燈進度條用）
  const commandModeRef = useRef(false); // 給 safePaste 閉包讀最新值，避免 stale
  const miniModeRef = useRef(false); // 給 showNotification 閉包讀目前是否迷你模式
  const isRecordingRef = useRef(false); // 給快捷鍵閉包讀「目前是否正在錄音」
  const recordingStartRef = useRef(0); // 本次錄音開始時間（分辨「真聽寫」vs「撞鍵空錄音」）
  const [miniFlash, setMiniFlash] = useState(null); // 迷你模式：在小條上閃一下的訊息（取代浮動 toast）
  const miniFlashTimer = useRef(null);
  const [aiOptimizationEnabled, setAiOptimizationEnabled] = useState(false); // AI 優化狀態

  // 錄音完成後動作設定
  const [pasteAfterTranscription, setPasteAfterTranscription] = useState(true);
  const [autoEnterAfterPaste, setAutoEnterAfterPaste] = useState(false);

  // 點擊錄音流程：等待使用者點擊目標位置
  const [waitingForTarget, setWaitingForTarget] = useState(false);

  // i18n
  const { t, language, convert } = useTranslation();

  // 加载通知设置和貼上相關設定
  useEffect(() => {
    const loadSettings = async () => {
      if (window.electronAPI) {
        const enabled = await window.electronAPI.getSetting('enable_notifications', true);
        setNotificationsEnabled(enabled !== false);

        // 載入貼上相關設定
        const paste = await window.electronAPI.getSetting('paste_after_transcription', true);
        setPasteAfterTranscription(paste !== false);

        const autoEnter = await window.electronAPI.getSetting('auto_enter_after_paste', false);
        setAutoEnterAfterPaste(autoEnter === true);

        // 載入置頂狀態
        const alwaysOnTop = await window.electronAPI.getSetting('window_always_on_top', true);
        setIsAlwaysOnTop(alwaysOnTop !== false);

        // 載入 AI 優化狀態
        const aiEnabled = await window.electronAPI.getSetting('enable_ai_optimization', false);
        setAiOptimizationEnabled(aiEnabled === true);
      }
    };
    loadSettings();

    // 监听设置变化（跨視窗同步）
    if (window.electronAPI?.onSettingChanged) {
      const unsubscribe = window.electronAPI.onSettingChanged((data) => {
        if (data.key === 'enable_notifications') {
          setNotificationsEnabled(data.value !== false);
        } else if (data.key === 'paste_after_transcription') {
          setPasteAfterTranscription(data.value !== false);
        } else if (data.key === 'auto_enter_after_paste') {
          setAutoEnterAfterPaste(data.value === true);
        } else if (data.key === 'window_always_on_top') {
          setIsAlwaysOnTop(data.value !== false);
        } else if (data.key === 'enable_ai_optimization') {
          setAiOptimizationEnabled(data.value === true);
        }
      });
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, []);

  // 条件性显示通知的辅助函数
  const showNotification = useCallback((type, message, options) => {
    if (!notificationsEnabled && type !== 'error') return;
    // 迷你模式：浮動 toast 會蓋住小條、比例全錯 → 改在小條身上閃一下字
    if (miniModeRef.current) {
      setMiniFlash({ type, message });
      if (miniFlashTimer.current) clearTimeout(miniFlashTimer.current);
      miniFlashTimer.current = setTimeout(() => setMiniFlash(null), 1000);
      return;
    }
    // 'command' 不是 sonner 內建型別，正常面板退回中性 toast，避免 toast.command 崩潰
    const toastFn = typeof toast[type] === 'function' ? toast[type] : toast;
    toastFn(message, options);
  }, [notificationsEnabled]);

  // 同步 miniMode 到 ref（showNotification 閉包要讀最新值）
  useEffect(() => { miniModeRef.current = miniMode; }, [miniMode]);

  // 主行程廣播迷你狀態 → React 跟著走（任何 main 端改視窗大小都不會錯位）
  useEffect(() => {
    const off = window.electronAPI?.onMiniModeChanged?.((enabled) => {
      miniModeRef.current = !!enabled;
      setMiniMode(!!enabled);
    });
    return () => { if (typeof off === 'function') off(); };
  }, []);

  // 「念出來」：播放 / 停止 主行程送來的 Edge TTS MP3
  const ttsAudioRef = useRef(null);
  useEffect(() => {
    const stopTts = () => {
      try { ttsAudioRef.current?.pause(); } catch (e) { /* ignore */ }
      ttsAudioRef.current = null;
    };
    const offPlay = window.electronAPI?.onTtsPlay?.((b64) => {
      try {
        stopTts(); // 先停掉上一段
        const a = new Audio('data:audio/mpeg;base64,' + b64);
        ttsAudioRef.current = a;
        a.play().catch(() => {});
      } catch (e) { /* ignore */ }
    });
    const offStop = window.electronAPI?.onTtsStop?.(stopTts);
    return () => { if (offPlay) offPlay(); if (offStop) offStop(); stopTts(); };
  }, []);

  // 掛載時跟主行程對齊迷你狀態：HMR 熱重載 / 任何重載會把 React state 歸零，
  // 但視窗尺寸由主行程管、不會跟著重置 → 會出現「視窗是迷你、版面卻是正常面板」
  // 的錯位。一掛載就問「現在到底是不是迷你」並校正，兩邊永遠一致。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mini = await window.electronAPI?.getMiniMode?.();
        if (!cancelled && typeof mini === 'boolean') {
          miniModeRef.current = mini;
          setMiniMode(mini);
        }
      } catch (e) { /* ignore */ }
      try {
        // 同理校正操作模式：主行程是真實來源（HMR/重載後膠囊與藥丸才不會一藍一紅）
        const cmd = await window.electronAPI?.getCommandMode?.();
        if (!cancelled && typeof cmd === 'boolean') {
          commandModeRef.current = cmd;
          setCommandMode(cmd);
        }
      } catch (e) { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // 好看的「已取消」提示（取代陽春的 info toast）
  const notifyCancel = useCallback(() => {
    toast.custom(() => (
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-900/92 backdrop-blur-sm text-gray-100 rounded-2xl shadow-xl border border-white/10">
        <X className="w-4 h-4 text-red-400" />
        <span className="text-sm font-medium">{t('panel.cancelledRecording')}</span>
      </div>
    ), { duration: 1400 });
  }, [t]);

  // 字數成就：突破新等級時慶祝一下（不干擾使用）
  const checkLevelUp = useCallback(async () => {
    try {
      if (!window.electronAPI?.getTranscriptionStats) return;
      const stats = await window.electronAPI.getTranscriptionStats();
      setStats(stats); // 更新角落顯示
      const newIdx = getLevelIndex(stats?.totalChars || 0);
      const prevIdx = parseInt(localStorage.getItem('level_idx') || '0', 10);
      if (newIdx > prevIdx) {
        const lv = LEVELS[newIdx];
        if (miniModeRef.current) {
          // 迷你模式：大卡片會爆版 → 在膠囊閃一下精簡版（emoji + 頭銜）
          showNotification('warning', `${lv.emoji} 解鎖 ${lv.title}`);
        } else {
          toast.custom(() => (
            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/40 dark:to-orange-900/40 rounded-2xl shadow-xl border border-amber-200 dark:border-amber-700/50">
              <span className="text-2xl">{lv.emoji}</span>
              <div>
                <div className="text-sm font-bold text-amber-700 dark:text-amber-300">{t('panel.levelUnlocked', { title: lv.title })}</div>
                <div className="text-xs text-amber-600/90 dark:text-amber-400/90">{lv.message}</div>
              </div>
            </div>
          ), { duration: 4000 });
        }
      }
      localStorage.setItem('level_idx', String(Math.max(newIdx, prevIdx)));
    } catch (e) {
      /* 統計失敗不影響主流程 */
    }
  }, [t, showNotification]);
  
  const { isDragging, handleMouseDown, handleMouseMove, handleMouseUp, handleClick } = useWindowDrag();
  const modelStatus = useModelStatus();
  
  // 傳統錄音模式
  const {
    isRecording: isRecordingNormal,
    isProcessing: isRecordingProcessingNormal,
    isOptimizing,
    startRecording: startRecordingNormal,
    stopRecording: stopRecordingNormal,
    cancelRecording: cancelRecordingNormal,
    error: recordingErrorNormal
  } = useRecording(modelStatus); // 共用 App 的 modelStatus 實例（避免雙重輪詢）

  // 串流錄音模式
  const {
    isRecording: isRecordingStreaming,
    isProcessing: isProcessingStreaming,
    isInitializing: isInitializingStreaming,
    error: streamingError,
    partialText,
    fullText,
    startStreaming,
    stopStreaming,
    cancelStreaming
  } = useStreamingRecording();

  // 串流模式設定
  const [streamingMode, setStreamingMode] = useState(false);

  // TypeLess 模式（按住錄音）
  const [typelessMode, setTypelessMode] = useState(false);

  // 載入串流模式設定
  useEffect(() => {
    const resolveStreamingMode = async (enabled) => {
      const info = window.electronAPI?.getRuntimeInfo?.();
      return await resolveStreamingModeAvailability(enabled, info, window.electronAPI);
    };

    const loadStreamingMode = async () => {
      if (window.electronAPI) {
        const enabled = await window.electronAPI.getSetting('enable_streaming_mode', false);
        const streamingAvailability = await resolveStreamingMode(enabled);
        setStreamingMode(streamingAvailability.enabled);
        if (enabled && streamingAvailability.unsupported) {
          await window.electronAPI.setSetting?.('enable_streaming_mode', false);
        }
      }
    };
    loadStreamingMode();

    // 監聽設定變更事件（跨視窗同步）
    if (window.electronAPI?.onSettingChanged) {
      const unsubscribe = window.electronAPI.onSettingChanged(async (data) => {
        if (data.key === 'enable_streaming_mode') {
          const streamingAvailability = await resolveStreamingMode(data.value);
          setStreamingMode(streamingAvailability.enabled);
          if (data.value && streamingAvailability.unsupported) {
            await window.electronAPI.setSetting?.('enable_streaming_mode', false);
          }
          console.log('串流模式已更新:', streamingAvailability.enabled);
        }
      });
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, []);

  // 啟用 TypeLess 模式（右 Alt 已是唯一錄音方式，固定一律啟用，不再受設定開關控制）
  useEffect(() => {
    const enableTypeless = async () => {
      if (window.electronAPI) {
        setTypelessMode(true);
        // 觸發鍵由主進程固定為右 Alt（setRightAltToggle），這裡傳入值會被忽略
        await window.electronAPI.enableTypelessMode('AltRight');
      }
    };
    enableTypeless();
  }, []);

  // 統一的錄音狀態（根據模式選擇）
  const isRecording = streamingMode ? isRecordingStreaming : isRecordingNormal;
  const isRecordingProcessing = streamingMode ? isProcessingStreaming : isRecordingProcessingNormal;
  const recordingError = streamingMode ? streamingError : recordingErrorNormal;
  // 同步錄音狀態到 ref（切換操作模式的「鬼切」判斷要讀最新值）
  useEffect(() => {
    isRecordingRef.current = isRecording;
    if (isRecording) recordingStartRef.current = Date.now();
  }, [isRecording]);

  // 統一的錄音函數
  const startRecording = useCallback(() => {
    if (streamingMode) {
      startStreaming();
    } else {
      startRecordingNormal();
    }
  }, [streamingMode, startStreaming, startRecordingNormal]);

  const stopRecording = useCallback(() => {
    if (streamingMode) {
      stopStreaming();
    } else {
      stopRecordingNormal();
    }
  }, [streamingMode, stopStreaming, stopRecordingNormal]);

  const {
    processText,
    isProcessing: isTextProcessing,
    error: textProcessingError
  } = useTextProcessing();

  // 防重复粘贴的引用
  const lastPasteRef = useRef({ text: '', timestamp: 0 });
  // 文字捲動容器：有新辨識結果時自動捲到底
  const textScrollRef = useRef(null);
  useEffect(() => {
    if (textScrollRef.current) {
      textScrollRef.current.scrollTop = textScrollRef.current.scrollHeight;
    }
  }, [originalText, processedText]);

  // 重新開始錄音時，先清空上一次的結果（面板淨空）
  useEffect(() => {
    if (isRecordingNormal) {
      setOriginalText("");
      setProcessedText("");
      setShowTextArea(false);
    }
  }, [isRecordingNormal]);

  // 開機時抓一次累計統計（角落顯示用）
  useEffect(() => {
    if (window.electronAPI?.getTranscriptionStats) {
      window.electronAPI.getTranscriptionStats().then(setStats).catch(() => {});
    }
  }, []);
  const PASTE_DEBOUNCE_TIME = 1000; // 1秒内相同文本不重复粘贴

  // 安全粘贴函数（根據設定決定是否貼上和送出 Enter）
  const safePaste = useCallback(async (text) => {
    // 操作模式：辨識結果不貼字，改當語音指令派發（攔在最前面）
    if (commandModeRef.current) {
      setCommandRunning(true); // 底部進度條：告訴使用者「指令在跑」（AI 等待時尤其有感）
      try {
        const res = await window.electronAPI?.runVoiceCommand?.(text);
        if (res?.matched) {
          if (res.success) {
            // 有 resultText 代表是轉換/翻譯/AI（結果已在剪貼簿）→ 提示已複製，
            // 這樣唯讀來源貼不回去時，使用者也知道可以自己 Ctrl+V
            showNotification('success',
              res.resultText
                ? t('panel.commandDoneCopied', { label: res.label })
                : t('panel.commandDone', { label: res.label }));
          } else {
            showNotification('warning', t('panel.commandFailed', { label: res.label, error: res.error || '' }));
          }
        } else {
          showNotification('info', t('panel.commandUnknown', { text }));
        }
      } catch (e) {
        showNotification('error', t('panel.commandError'));
      } finally {
        setCommandRunning(false);
      }
      return; // 操作模式不貼字
    }

    const now = Date.now();
    const lastPaste = lastPasteRef.current;

    // 防重复粘贴：如果是相同文本且在防抖时间内，则跳过
    if (lastPaste.text === text && (now - lastPaste.timestamp) < PASTE_DEBOUNCE_TIME) {
      return;
    }

    // 更新最后粘贴记录
    lastPasteRef.current = { text, timestamp: now };

    try {
      if (window.electronAPI) {
        // 永遠自動貼上：交由主進程處理剪貼簿（保存原本 → 寫入辨識文字 → 貼上 → 還原原本）
        // 不在前端先寫剪貼簿，否則主進程會把「辨識文字」誤當成原本內容
        await window.electronAPI.pasteText(text);

        // 如果啟用完全信任模式，貼上後自動發送 Enter
        if (autoEnterAfterPaste) {
          await new Promise(resolve => setTimeout(resolve, 100));
          await window.electronAPI.sendEnter();
        }
      } else {
        // 沒有 electronAPI（理論上不會發生）：退而求其次寫入剪貼簿
        try {
          await navigator.clipboard.writeText(text);
        } catch (clipErr) {
          /* ignore */
        }
      }

      // 不需要成功通知，文字已經貼上了使用者自然知道
    } catch (error) {
      // 失敗時才需要通知
      showNotification('error', t('notifications.pasteFailed'), {
        description: t('notifications.pasteFailedDesc')
      });
    }
  }, [showNotification, t, pasteAfterTranscription, autoEnterAfterPaste]);

  // 处理录音完成（Sherpa 识别完成）
  const handleRecordingComplete = useCallback(async (transcriptionResult) => {
    const text = transcriptionResult?.text;
    if (text) {
      // 立即显示 Sherpa 识别的原始文本
      setOriginalText(text);
      setShowTextArea(true);

      // 清空之前的处理结果，等待AI优化
      setProcessedText("");

      // 如果是串流模式，直接貼上（不經過 AI 優化）
      if (transcriptionResult?.streaming) {
        await safePaste(text);
      }

      // 不需要成功通知，文字出來就知道成功了
    }
  }, [safePaste]);

  // 处理AI优化完成
  const handleAIOptimizationComplete = useCallback(async (optimizedResult) => {
    if (optimizedResult.success && optimizedResult.enhanced_by_ai && optimizedResult.text) {
      // 显示AI优化后的文本
      setProcessedText(optimizedResult.text);

      // 自动粘贴AI优化后的文本
      await safePaste(optimizedResult.text);

      // 不需要成功通知，文字出來就知道成功了
    } else {
      // AI优化未启用或失败，使用 optimizedResult.text（即原始文本）
      const textToPaste = optimizedResult.text;
      if (textToPaste) {
        await safePaste(textToPaste);
      }
    }
    // 轉錄完成、字數已寫入資料庫後，檢查是否突破新等級
    setTimeout(() => checkLevelUp(), 400);
  }, [safePaste, checkLevelUp]);

  // 设置转录完成回调
  useEffect(() => {
    window.onTranscriptionComplete = handleRecordingComplete;
    window.onAIOptimizationComplete = handleAIOptimizationComplete;

    return () => {
      window.onTranscriptionComplete = null;
      window.onAIOptimizationComplete = null;
    };
  }, [handleRecordingComplete, handleAIOptimizationComplete]);

  // 點字改錯：把面板裡的文字換成選好的候選，並同步到剪貼簿（方便重新貼上）。
  // 改的若是「詞」（≥2 字），就記進字典 → 下次辨識自動修正（會學習的輸入法）。
  const handleApplyCorrection = useCallback((newText, target, replacement) => {
    if (processedText) setProcessedText(newText);
    else setOriginalText(newText);
    try { window.electronAPI?.copyText?.(newText); } catch (e) { /* ignore */ }
    const remember =
      target && replacement && target !== replacement &&
      [...target].length >= 2; // 單字（在/再）太危險不自動記，避免全文誤換
    if (remember) {
      try { window.electronAPI?.addDictionaryEntry?.(target, replacement, '改錯記憶'); } catch (e) { /* ignore */ }
      showNotification('success', t('panel.correctRemembered', { from: target, to: replacement }));
    } else {
      showNotification('success', t('panel.correctApplied'));
    }
  }, [processedText, showNotification, t]);

  // 处理复制文本
  const handleCopyText = useCallback(async (text) => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.copyText(text);
        if (result.success) {
          showNotification('success', t('notifications.copied'));
        } else {
          throw new Error(result.error || t('common.error'));
        }
      } else {
        await navigator.clipboard.writeText(text);
        showNotification('success', t('notifications.copied'));
      }
    } catch (error) {
      console.error("复制文本失败:", error);
      showNotification('error', t('notifications.copyFailed', { error: error.message }));
    }
  }, [showNotification, t]);


  // 处理导出文本
  const handleExportText = useCallback(async (text) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.exportTranscriptions('txt');
        showNotification('success', t('notifications.exported'));
      } else {
        // Web环境下载文件
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${t('appName')}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      showNotification('error', t('notifications.exportFailed'));
    }
  }, [showNotification, t]);

  // 处理模型下载
  const handleDownloadModels = useCallback(async () => {
    try {
      // 显示开始下载的提示
      showNotification('info', t('notifications.downloadStarted'));

      const result = await modelStatus.downloadModels();
      if (result.success) {
        showNotification('success', t('notifications.downloadComplete'));
      } else {
        showNotification('error', t('notifications.downloadFailed', { error: result.error }));
      }
    } catch (error) {
      console.error('下载模型失败:', error);
      showNotification('error', t('notifications.downloadFailed', { error: error.message }));
    }
  }, [modelStatus, showNotification, t]);

  // 檢查模型狀態的輔助函數
  const checkModelReady = useCallback(() => {
    if (modelStatus.stage === 'need_download') {
      showNotification('warning', t('notifications.pleaseDownload'));
      return false;
    }
    if (modelStatus.stage === 'downloading') {
      showNotification('warning', t('notifications.modelDownloading'));
      return false;
    }
    if (modelStatus.stage === 'loading') {
      showNotification('warning', t('notifications.modelLoading'));
      return false;
    }
    if (modelStatus.stage === 'error') {
      showNotification('error', `${t('app.modelError')}: ${modelStatus.error}`);
      return false;
    }
    if (!modelStatus.isReady) {
      showNotification('warning', t('notifications.modelNotReady'));
      return false;
    }
    return true;
  }, [modelStatus, showNotification, t]);

  // 熱鍵觸發的錄音切換（前景視窗已由主進程儲存）
  const toggleRecordingByHotkey = useCallback(async () => {
    if (!checkModelReady()) return;

    if (!isRecording && !isRecordingProcessing) {
      // 熱鍵觸發：前景視窗已在主進程儲存，直接開始錄音
      startRecording();
    } else if (isRecording) {
      stopRecording();
    }
  }, [checkModelReady, isRecording, isRecordingProcessing, startRecording, stopRecording]);

  // 點擊按鈕觸發的錄音 - 簡單版：直接開始錄音
  const handleClickRecording = useCallback(async () => {
    if (!checkModelReady()) return;

    if (isRecording) {
      // 如果正在錄音，停止錄音
      stopRecording();
      return;
    }

    if (isRecordingProcessing) {
      // 正在處理中，忽略
      return;
    }

    // 直接開始錄音
    startRecording();
  }, [checkModelReady, isRecording, isRecordingProcessing, stopRecording, startRecording]);

  // 當熱鍵觸發且在等待模式時，儲存視窗並開始錄音
  const handleHotkeyWhileWaiting = useCallback(async () => {
    if (waitingForTarget) {
      setWaitingForTarget(false);
      // 前景視窗已由主進程在熱鍵觸發時儲存
      startRecording();
      // 顯示聲聲慢視窗
      if (window.electronAPI) {
        window.electronAPI.showWindow();
      }
    }
  }, [waitingForTarget, startRecording]);

  // 統一的錄音切換（供熱鍵使用）
  const toggleRecording = useCallback(async () => {
    if (waitingForTarget) {
      // 在等待模式中按熱鍵，開始錄音
      await handleHotkeyWhileWaiting();
    } else {
      // 正常熱鍵觸發
      await toggleRecordingByHotkey();
    }
  }, [waitingForTarget, handleHotkeyWhileWaiting, toggleRecordingByHotkey]);

  // 使用热键Hook，不再使用F2双击功能
  const { hotkey, syncRecordingState, registerHotkey } = useHotkey();

  // 注册传统热键监听 - 只在主窗口注册，避免重复
  useEffect(() => {
    // 检查是否为控制面板窗口
    const urlParams = new URLSearchParams(window.location.search);
    const isControlPanel = urlParams.get('panel') === 'control';

    // 只有主窗口才注册热键
    if (isControlPanel) {
      return;
    }

    const initializeHotkey = async () => {
      try {
        // 初始化自定義快捷鍵系統
        if (window.electronAPI?.initCustomHotkeys) {
          const result = await window.electronAPI.initCustomHotkeys();
          if (result.success) {
            console.log('自定義快捷鍵初始化成功:', result.hotkeys);
          }
        } else {
          // 後備：使用舊的單一熱鍵註冊
          await registerHotkey('CommandOrControl+Shift+Space');
        }
      } catch (error) {
        // 热键注册失败时静默处理
        console.warn('快捷鍵初始化失敗:', error);
      }
    };

    initializeHotkey();
  }, [registerHotkey]);

  // 处理关闭窗口
  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.hideWindow();
    }
  };

  // 切換視窗置頂狀態
  const handleToggleAlwaysOnTop = async () => {
    if (window.electronAPI) {
      const newValue = !isAlwaysOnTop;
      setIsAlwaysOnTop(newValue);
      await window.electronAPI.setAlwaysOnTop(newValue);
      toast.success(newValue ? t('settings.alwaysOnTopEnabled') : t('settings.alwaysOnTopDisabled'));
    }
  };

  // 縮小視窗
  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.minimizeWindow();
    }
  };

  // 面板上快速切換 AI 潤飾（暫時關掉省 API）
  const toggleAiOptimization = useCallback(async () => {
    const next = !aiOptimizationEnabled;
    setAiOptimizationEnabled(next);
    try {
      if (window.electronAPI?.setSetting) {
        await window.electronAPI.setSetting('enable_ai_optimization', next);
      }
    } catch (e) {
      /* 設定寫入失敗不影響 */
    }
  }, [aiOptimizationEnabled]);

  // 处理打开设置
  const handleOpenSettings = () => {
    if (window.electronAPI) {
      window.electronAPI.openSettingsWindow();
    } else {
      // Web环境下仍然使用模态框
      setShowSettings(true);
    }
  };

  // 處理取消錄音：丟棄音訊，不轉錄、不貼上（而非 stopRecording 會處理結果）
  const handleCancelRecording = useCallback(() => {
    if (isRecordingNormal) {
      cancelRecordingNormal();
      notifyCancel();
    } else if (streamingMode) {
      cancelStreaming();
      notifyCancel();
    }
  }, [isRecordingNormal, cancelRecordingNormal, streamingMode, cancelStreaming, showNotification]);

  // 處理複製上次結果
  const handleCopyLastResult = useCallback(async () => {
    if (processedText) {
      try {
        await navigator.clipboard.writeText(processedText);
        showNotification('success', t('panel.copiedLastResult'));
      } catch (err) {
        if (window.electronAPI) {
          await window.electronAPI.copyText(processedText);
          showNotification('success', t('panel.copiedLastResult'));
        }
      }
    } else if (originalText) {
      try {
        await navigator.clipboard.writeText(originalText);
        showNotification('success', t('panel.copiedOriginal'));
      } catch (err) {
        if (window.electronAPI) {
          await window.electronAPI.copyText(originalText);
          showNotification('success', t('panel.copiedOriginal'));
        }
      }
    } else {
      showNotification('warning', t('panel.nothingToCopy'));
    }
  }, [processedText, originalText, showNotification, t]);

  // 监听全局热键触发事件
  useEffect(() => {
    if (window.electronAPI) {
      // 監聽新的快捷鍵操作事件
      const unsubscribeAction = window.electronAPI.onHotkeyAction?.((event, data) => {
        const { actionId } = data;
        switch (actionId) {
          case 'toggle-recording':
            toggleRecording();
            break;
          case 'cancel-recording':
            handleCancelRecording();
            break;
          case 'copy-last':
            handleCopyLastResult();
            break;
          case 'toggle-command-mode': {
            const next = !commandModeRef.current;
            const recording = isRecordingRef.current;
            const elapsed = recording ? Date.now() - (recordingStartRef.current || 0) : 0;
            // 聽寫到一半（已錄超過 0.5 秒）想切「去」指令模式 → 不准切，保護這段聽寫
            //（沒人會念一念突然要下指令；這多半是誤按）
            if (recording && next && elapsed >= 500) {
              showNotification('info', t('panel.commandToggleIgnored'));
              break;
            }
            let rescued = false;
            if (recording && next) {
              // 仍在錄音卻要「開」、而且是極短錄音（<0.5s）→ 右 Ctrl 撞鍵的空錄音 → 取消
              handleCancelRecording();
            } else if (recording && !next) {
              // 鬼切：指令模式錄音中要「關」→ 不取消，讓這段直接變聽寫照打出來
              rescued = true;
            }
            commandModeRef.current = next;
            setCommandMode(next);
            // 鏡像到主行程 → 廣播給錄音指示器藥丸（讓它變藍/紅）
            try { window.electronAPI?.setCommandMode?.(next); } catch (e) { /* ignore */ }
            showNotification('info',
              rescued ? t('panel.commandRescued')
                : next ? t('panel.commandModeOn')
                : t('panel.commandModeOff'));
            break;
          }
          default:
            console.warn('未知的快捷鍵操作:', actionId);
        }
      });

      // 监听传统热键触发（兼容舊系統）
      const unsubscribeHotkey = window.electronAPI.onHotkeyTriggered(() => {
        toggleRecording();
      });

      // 监听旧的toggle事件（保持兼容性）
      const unsubscribeToggle = window.electronAPI.onToggleDictation(() => {
        toggleRecording();
      });

      return () => {
        if (unsubscribeAction) unsubscribeAction();
        if (unsubscribeHotkey) unsubscribeHotkey();
        if (unsubscribeToggle) unsubscribeToggle();
      };
    }
  }, [toggleRecording, handleCancelRecording, handleCopyLastResult]);

  // TypeLess 模式事件監聽（按住錄音）
  useEffect(() => {
    if (!window.electronAPI || !typelessMode) return;

    // 監聽 TypeLess 開始錄音事件
    // Typeless 一律使用離線辨識路徑（startRecordingNormal），不受串流模式影響，
    // 因此即使串流模型未下載/串流模式開啟，按住說話依然可用。
    const unsubscribeStart = window.electronAPI.onTypelessStartRecording?.(() => {
      console.log('TypeLess: 收到開始錄音事件');
      if (!isRecordingNormal && !isRecordingProcessingNormal && modelStatus.isReady) {
        startRecordingNormal();
      }
    });

    // 監聽 TypeLess 停止錄音事件
    const unsubscribeStop = window.electronAPI.onTypelessStopRecording?.(() => {
      console.log('TypeLess: 收到停止錄音事件');
      if (isRecordingNormal) {
        stopRecordingNormal();
      }
    });

    // 監聽 TypeLess 取消錄音事件（錄音中按 Esc）：丟棄音訊，不轉錄、不貼上
    const unsubscribeCancel = window.electronAPI.onTypelessCancelRecording?.(() => {
      console.log('TypeLess: 收到取消錄音事件 (Esc)');
      if (isRecordingNormal) {
        cancelRecordingNormal();
        notifyCancel();
      }
    });

    return () => {
      if (unsubscribeStart) unsubscribeStart();
      if (unsubscribeStop) unsubscribeStop();
      if (unsubscribeCancel) unsubscribeCancel();
    };
  }, [typelessMode, isRecordingNormal, isRecordingProcessingNormal, modelStatus.isReady, startRecordingNormal, stopRecordingNormal, cancelRecordingNormal, showNotification]);

  // 載入時把 TypeLess 切換狀態強制重置為「未錄音」，
  // 避免重載/HMR/崩潰後主進程 isActive 與前端脫鉤（按鍵 off-by-one）。
  useEffect(() => {
    if (window.electronAPI?.syncTypelessState) {
      window.electronAPI.syncTypelessState(false);
    }
  }, []);

  // 同步录音状态到热键管理器
  useEffect(() => {
    if (syncRecordingState) {
      syncRecordingState(isRecording);
    }
    // 同步真實錄音狀態給 TypeLess，避免「右 Alt 切換」與「滑鼠點麥克風」打架
    if (window.electronAPI?.syncTypelessState) {
      window.electronAPI.syncTypelessState(isRecording);
    }
  }, [isRecording, syncRecordingState]);

  // 监听键盘事件
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, []);

  // 错误处理：走 showNotification → 迷你模式用膠囊閃字，不會冒出比例錯亂的大 toast
  useEffect(() => {
    if (recordingError) {
      showNotification('error', recordingError);
    }
  }, [recordingError]);

  useEffect(() => {
    if (textProcessingError) {
      showNotification('error', textProcessingError);
    }
  }, [textProcessingError]);

  // 确定当前麦克风状态
  const getMicState = () => {
    // 串流模式初始化中
    if (streamingMode && isInitializingStreaming) return "initializing";
    if (isRecording) return "recording";
    if (isRecordingProcessing) return "processing";
    if (isOptimizing) return "optimizing";
    if (isHovered && !isRecording && !isRecordingProcessing && !isOptimizing && !isInitializingStreaming) return "hover";
    return "idle";
  };

  const micState = getMicState();
  const isListening = isRecording || isRecordingProcessing;

  // 隨機處理中訊息（processing 和 optimizing 都用同一組）
  const processingMessage = useRandomMessage(
    micState === "processing" || micState === "optimizing",
    t('panel.processingMessages')
  );

  // 获取麦克风按钮属性
  const getMicButtonProps = () => {
    const baseClasses =
      "rounded-full w-16 h-16 flex items-center justify-center relative overflow-hidden border-2 mic-button-transition shadow-xl mic-button-ripple";

    // 串流模式用琥珀色邊框，一般模式用白色邊框
    const borderColor = streamingMode ? "border-amber-400" : "border-white/80";

    // 统一的按钮样式
    const buttonStyle = `${baseClasses} ${borderColor} bg-gradient-to-br from-slate-100 to-slate-200 dark:from-gray-700 dark:to-gray-600 hover:from-slate-200 hover:to-slate-300 dark:hover:from-gray-600 dark:hover:to-gray-500 hover:shadow-2xl transform hover:scale-105`;

    // 如果模型未就绪，显示禁用状态（统一的灰色）
    if (!modelStatus.isReady) {
      return {
        className: `${baseClasses} bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-700 cursor-not-allowed opacity-70`,
        tooltip: modelStatus.stage === 'need_download' ? t('notifications.pleaseDownload') :
                 modelStatus.stage === 'downloading' ? `${t('app.downloading')} ${modelStatus.downloadProgress || 0}%` :
                 modelStatus.stage === 'loading' ? t('app.loading') :
                 modelStatus.stage === 'error' ? `${t('app.modelError')}: ${modelStatus.error}` :
                 t('app.modelNotReady'),
        disabled: true
      };
    }

    switch (micState) {
      case "idle":
        return {
          className: `${buttonStyle} cursor-pointer`,
          tooltip: streamingMode ? t('panel.streamingStart', { hotkey }) : t('app.startRecording', { hotkey }),
          disabled: false
        };
      case "hover":
        return {
          className: `${buttonStyle} scale-105 shadow-2xl cursor-pointer`,
          tooltip: streamingMode ? t('panel.streamingStart', { hotkey }) : t('app.startRecording', { hotkey }),
          disabled: false
        };
      case "initializing":
        return {
          className: `${buttonStyle} processing-shimmer cursor-not-allowed opacity-80`,
          tooltip: t('panel.streamingInitializing'),
          disabled: true
        };
      case "recording":
        return {
          className: `${buttonStyle} recording-pulse recording-glow cursor-pointer ${streamingMode ? 'streaming-ring' : ''}`,
          tooltip: t('app.recording'),
          disabled: false
        };
      case "processing":
        return {
          className: `${buttonStyle} processing-shimmer cursor-not-allowed opacity-80`,
          tooltip: t('app.processing'),
          disabled: true
        };
      case "optimizing":
        return {
          className: `${buttonStyle} processing-shimmer cursor-not-allowed opacity-80`,
          tooltip: t('app.optimizing'),
          disabled: true
        };
      default:
        return {
          className: `${buttonStyle} cursor-pointer`,
          tooltip: streamingMode ? t('panel.streamingStart', { hotkey }) : t('app.clickToRecord', { hotkey }),
          disabled: false
        };
    }
  };

  const micProps = getMicButtonProps();

  const toggleMiniMode = async (enabled) => {
    if (enabled) {
      // 縮小：先把正在浮動的 toast 收掉，否則大尺寸 toast 會留在小膠囊旁，比例全錯很醜
      try { toast.dismiss(); } catch (e) { /* ignore */ }
      // 先切成扁條版面、等一幀渲染完，再縮視窗（避免大版面被擠壓閃現）
      setMiniMode(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try { await window.electronAPI?.setMiniMode?.(true); } catch (e) { /* ignore */ }
    } else {
      // 展開：先放大視窗，再切回主面板版面
      try { await window.electronAPI?.setMiniMode?.(false); } catch (e) { /* ignore */ }
      setMiniMode(false);
    }
  };

  // 迷你模式：扁平媒體浮窗版面（與主面板同一視窗，原地變身）
  if (miniMode) {
    const lastText = processedText || originalText;
    const miniText = lastText || t('appName');
    const shouldMarquee = miniText.length > 16; // 短文字不跑，長文字跑馬燈
    const flashColor = miniFlash ? ({
      success: 'text-emerald-500 dark:text-emerald-400',
      error: 'text-red-500 dark:text-red-400',
      warning: 'text-amber-500 dark:text-amber-400',
      info: 'text-gray-700 dark:text-gray-200',
      command: 'text-sky-500 dark:text-sky-300',
    }[miniFlash.type] || 'text-gray-900 dark:text-white') : '';
    return (
      <div
        className={`relative h-screen w-screen flex items-center gap-3 px-3 bg-white/95 dark:bg-gray-900/95 rounded-xl shadow-2xl overflow-hidden select-none ${
          commandMode
            ? 'border-2 border-dashed border-sky-400'
            : 'border border-gray-200 dark:border-gray-700/70'
        }`}
        style={{ WebkitAppRegion: 'drag' }}
      >
        <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
          isRecording ? (commandMode ? 'bg-sky-400 animate-pulse' : 'bg-red-500 animate-pulse') : commandMode ? 'bg-sky-100 dark:bg-sky-900/40' : 'bg-gray-100 dark:bg-gray-800'
        }`}>
          <img src="./icon.png" alt="" className="w-7 h-7 rounded-md" draggable="false" />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-semibold leading-tight ${
            miniFlash ? flashColor
              : isRecording ? (commandMode ? 'text-sky-500 dark:text-sky-300' : 'text-red-500 dark:text-red-400')
              : commandMode ? 'text-sky-500 dark:text-sky-300'
              : 'text-gray-900 dark:text-white'
          }`}>
            {miniFlash ? miniFlash.message
              : isRecording ? (commandMode ? t('panel.commandListening') : t('panel.recordingIndicator'))
              : (isRecordingProcessing || isOptimizing) ? t('app.processing')
              : commandMode ? t('panel.commandModeBadge')
              : t('panel.miniIdle')}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight mt-0.5 overflow-hidden">
            {shouldMarquee ? (
              <div
                className="mini-marquee"
                style={{ animationDuration: `${Math.max(8, miniText.length * 0.45)}s` }}
              >
                <span>{miniText}</span>
                <span>{miniText}</span>
              </div>
            ) : (
              <span className="truncate block">{miniText}</span>
            )}
          </div>
        </div>
        {lastText && (
          <button
            onClick={() => { window.electronAPI?.copyText?.(lastText); setMiniCopied(true); setTimeout(() => setMiniCopied(false), 1200); }}
            title={t('app.copy')}
            style={{ WebkitAppRegion: 'no-drag' }}
            className={`shrink-0 p-1.5 rounded-lg transition-colors ${
              miniCopied
                ? 'text-emerald-500'
                : 'text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700/80'
            }`}
          >
            <Copy className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => toggleMiniMode(false)}
          title={t('panel.miniExpand')}
          style={{ WebkitAppRegion: 'no-drag' }}
          className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700/80 transition-colors"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        {commandRunning && (
          <div className="cmd-progress-track"><div className="cmd-progress-bar" /></div>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen w-screen p-8">
      {/* 卡片：透明外層留足夠邊距，讓柔和陰影完整顯示、不被視窗裁成硬邊方塊 */}
      <div className={`relative h-full bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 px-4 pt-4 pb-2 rounded-3xl overflow-hidden flex flex-col shadow-[0_10px_30px_rgba(0,0,0,0.16)] ${
        commandMode ? 'ring-2 ring-sky-300 ring-inset' : ''
      }`}>
      {commandRunning && (
        <div className="cmd-progress-track"><div className="cmd-progress-bar" /></div>
      )}
      {/* 主界面 */}
      <div className="w-full max-w-2xl mx-auto flex-1 min-h-0 flex flex-col">
        {/* 标题栏 */}
        <div
          className="flex flex-col mb-5 draggable"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="./icon.png" alt="" className="w-5 h-5 rounded-md shrink-0" draggable="false" />
              <h1 className="brand-title text-base font-bold text-gray-900 dark:text-gray-100 whitespace-nowrap shrink-0">
                {t('appName')}
              </h1>
            </div>
          <div className="flex items-center space-x-1 non-draggable">
            {commandMode && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 mr-1 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0 bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300 border border-sky-300 dark:border-sky-700">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                {t('panel.commandModeBadge')}
              </span>
            )}
            {(originalText || processedText) && (
              <Tooltip content={t('app.copy')} position="bottom">
                <button
                  onClick={() => handleCopyText(processedText || originalText)}
                  className="p-1.5 hover:bg-white/70 dark:hover:bg-gray-700/70 rounded-lg transition-colors"
                >
                  <Copy className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
              </Tooltip>
            )}
            <Tooltip content={aiOptimizationEnabled ? t('panel.aiTooltipOn') : t('panel.aiTooltipOff')} position="bottom">
              <button
                onClick={toggleAiOptimization}
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors non-draggable ${
                  aiOptimizationEnabled
                    ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300'
                    : 'text-gray-400 dark:text-gray-500 hover:bg-white/70 dark:hover:bg-gray-700/70'
                }`}
              >
                ✨AI
              </button>
            </Tooltip>
            <Tooltip content={t('transcribe.title')} position="bottom">
              <button
                onClick={() => setShowTranscribe(true)}
                className="p-1.5 hover:bg-white/70 dark:hover:bg-gray-700/70 rounded-lg transition-colors"
              >
                <FileText className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            </Tooltip>
            <Tooltip content={t('app.settings')} position="bottom">
              <button
                onClick={handleOpenSettings}
                className="p-1.5 hover:bg-white/70 dark:hover:bg-gray-700/70 rounded-lg transition-colors"
              >
                <Settings className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            </Tooltip>
            <Tooltip content={isAlwaysOnTop ? t('panel.pinOff') : t('panel.pinOn')} position="bottom">
              <button
                onClick={handleToggleAlwaysOnTop}
                className={`p-1.5 rounded-lg transition-colors ${
                  isAlwaysOnTop
                    ? 'bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-800/50'
                    : 'hover:bg-white/70 dark:hover:bg-gray-700/70'
                }`}
              >
                <Pin className={`w-4 h-4 ${
                  isAlwaysOnTop
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400'
                }`} />
              </button>
            </Tooltip>
            <Tooltip content={t('panel.miniMode')} position="bottom">
              <button
                onClick={() => toggleMiniMode(true)}
                className="p-1.5 hover:bg-white/70 dark:hover:bg-gray-700/70 rounded-lg transition-colors"
              >
                <Minus className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            </Tooltip>
            <Tooltip content={t('panel.closeToTray')} position="bottom">
              <button
                onClick={handleClose}
                className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-red-500" />
              </button>
            </Tooltip>
          </div>
          </div>
          {/* AI 優化狀態指示器 - 標題下方 */}
          {aiOptimizationEnabled && (
            <div className="mt-2">
              <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 rounded-full">
                <Sparkles className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" />
                <span className="text-xs font-medium text-purple-600 dark:text-purple-300">{t('panel.aiEnabledBadge')}</span>
              </div>
            </div>
          )}
        </div>

        {/* 录音控制区域 */}
        <div className="text-center mb-5 flex-shrink-0">
          <Tooltip content={micProps.tooltip}>
            <button
              onClick={(e) => {
                if (handleClick(e) && !micProps.disabled) {
                  handleClickRecording();
                }
              }}
              onMouseEnter={() => {
                if (!micProps.disabled) {
                  setIsHovered(true);
                }
              }}
              onMouseLeave={() => setIsHovered(false)}
              className={`${micProps.className} non-draggable shadow-lg ${
                streamingMode && isRecording ? 'streaming-recording-pulse' : ''
              }`}
              disabled={micProps.disabled}
            >
              {/* 动态内容基于状态 */}
              {modelStatus.stage === 'downloading' ? (
                <LoadingIndicator size={20} />
              ) : modelStatus.stage === 'loading' || !modelStatus.isReady ? (
                <LoadingIndicator size={20} />
              ) : micState === "idle" ? (
                <SoundWaveIcon size={20} isActive={false} />
              ) : micState === "hover" ? (
                <SoundWaveIcon size={20} isActive={false} />
              ) : micState === "initializing" ? (
                <LoadingIndicator size={20} />
              ) : micState === "recording" ? (
                <SoundWaveIcon size={20} isActive={true} />
              ) : micState === "processing" ? (
                <VoiceWaveIndicator isListening={true} />
              ) : micState === "optimizing" ? (
                <LoadingIndicator size={20} />
              ) : null}

              {/* 移除所有状态指示环，保持简洁 */}
            </button>
          </Tooltip>
          
          <p className="mt-4 status-text text-gray-700 dark:text-gray-300">
            {modelStatus.stage === 'need_download' ? (
              t('app.needDownload')
            ) : modelStatus.stage === 'downloading' ? (
              `${t('app.downloading')} ${modelStatus.downloadProgress || 0}%`
            ) : modelStatus.stage === 'loading' ? (
              t('app.loading')
            ) : modelStatus.stage === 'error' ? (
              `${t('app.modelError')}: ${modelStatus.error}`
            ) : !modelStatus.isReady ? (
              t('app.modelNotReady')
            ) : waitingForTarget ? (
              t('app.waitingForTarget')
            ) : micState === "initializing" ? (
              t('panel.streamingInitializing')
            ) : micState === "recording" ? (
              streamingMode ? t('panel.streamingRecognizing') : t('app.recording')
            ) : (micState === "processing" || micState === "optimizing") ? (
              processingMessage || t('app.processing')
            ) : streamingMode ? (
              t('panel.streamingClickToStart', { hotkey })
            ) : (
              t('app.clickToRecord', { hotkey })
            )}
          </p>

          {/* 處理中/優化中/初始化中的小進度條 */}
          {(micState === "processing" || micState === "optimizing" || micState === "initializing") && (
            <ProcessingProgressBar />
          )}

          {/* 串流辨識即時文字顯示 */}
          {streamingMode && isRecording && (partialText || fullText) && (
            <div className="mt-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg max-h-32 overflow-y-auto">
              <p className="text-sm text-blue-800 dark:text-blue-200 whitespace-pre-wrap">
                {fullText}
                {partialText && (
                  <span className="text-blue-500 dark:text-blue-400 opacity-70">
                    {partialText}
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* 模型下载进度显示 */}
        {(modelStatus.stage === 'need_download' || modelStatus.stage === 'downloading') && (
          <div className="mb-6">
            <ModelDownloadProgress
              modelStatus={modelStatus}
              onDownload={handleDownloadModels}
            />
          </div>
        )}

        {/* 文本显示区域（卡片內部捲動，新文字自動捲到底）*/}
        <div className="flex-1 min-h-0">
          {(originalText || processedText) ? (
            <TextDisplay
              originalText={originalText}
              processedText={processedText}
              scrollRef={textScrollRef}
              t={t}
              onApplyCorrection={handleApplyCorrection}
            />
          ) : (
            <IdlePlaceholder />
          )}
        </div>

        {/* 底部列：左=次數、中=署名、右=字數（mt-auto 推到最底）*/}
        <div className="mt-auto flex-shrink-0 flex items-center justify-between gap-2 px-1 pt-1.5 text-[11px] select-none">
          <span className="tabular-nums text-sky-500/80 dark:text-sky-400/70">{t('panel.statsUses', { n: stats?.total || 0 })}</span>
          <span className="tabular-nums text-sky-500/80 dark:text-sky-400/70">{t('panel.statsChars', { n: (stats?.totalChars || 0).toLocaleString() })}</span>
        </div>
      </div>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
      {showTranscribe && (
        <React.Suspense fallback={null}>
          <TranscribeModal onClose={() => setShowTranscribe(false)} />
        </React.Suspense>
      )}
    </div>
  );
}
