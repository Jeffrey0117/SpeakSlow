import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { toast, Toaster } from "sonner";
import { Settings, Save, Eye, EyeOff, X, Loader2, TestTube, CheckCircle, XCircle, Mic, Shield, Globe, Keyboard, Sparkles, BookText, Tag, History, Info, Heart, Smile } from "lucide-react";
import { usePermissions } from "./hooks/usePermissions";
import PermissionCard from "./components/ui/permission-card";
import HotkeySettings from "./components/HotkeySettings";
import HotwordsManager from "./components/HotwordsManager";
import DictionaryManager from "./components/DictionaryManager";
import EmojiManager from "./components/EmojiManager";
import HistoryView from "./components/HistoryView";
import { useTranslation, LanguageProvider } from "./i18n";

// 設定面板左側分頁（依重要性排序）
const SETTINGS_TABS = [
  { id: 'general', labelKey: 'settings.tabs.general', icon: Settings },
  { id: 'history', labelKey: 'settings.tabs.history', icon: History },
  { id: 'ai', labelKey: 'settings.tabs.ai', icon: Sparkles },
  { id: 'hotkeys', labelKey: 'settings.tabs.hotkeys', icon: Keyboard },
  { id: 'hotwords', labelKey: 'settings.tabs.hotwords', icon: Tag },
  { id: 'dictionary', labelKey: 'settings.tabs.dictionary', icon: BookText },
  { id: 'emoji', labelKey: 'settings.tabs.emoji', icon: Smile },
  { id: 'permissions', labelKey: 'settings.tabs.permissions', icon: Shield },
  { id: 'about', labelKey: 'settings.tabs.about', icon: Info },
];

const SettingsPage = () => {
  const { t, language, setLanguage, languages } = useTranslation();
  const [activeTab, setActiveTab] = useState('general');

  const [settings, setSettings] = useState({
    ai_api_key: "",
    ai_base_url: "https://api.openai.com/v1",
    ai_model: "gpt-4o-mini",
    enable_ai_optimization: false,
    enable_notifications: true,
    enable_streaming_mode: false,
    language: "zh-TW",
    convert_transcription: true,
    asr_profile: "standard",          // 效能模式：standard（最準）/ fast（弱 CPU）
    mic_device_id: "",                // 指定麥克風（空=系統預設）
    mic_auto_gain: true,              // 自動增益（AGC）
    typeless_trigger: "default",      // 錄音觸發鍵（issue #12：可自訂避開衝突）
    auto_format_lists: false,         // 自動列點（第一二三→1.2.3），預設關
    auto_line_break: false,           // 依停頓自動分行（issue #17），預設關
    // 錄音完成後動作設定（自動貼上已固定開啟，僅保留「自動送出 Enter」）
    auto_enter_after_paste: false,    // 貼上後自動送出（完全信任模式）
    // 視窗控制設定
    window_always_on_top: true,       // 視窗置頂
    minimize_to_tray: true,           // 縮小到系統托盤
    close_to_tray: true               // 關閉到系統托盤
  });
  
  const [customModel, setCustomModel] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [streamingModelStatus, setStreamingModelStatus] = useState(null);
  const [streamingModelDownloading, setStreamingModelDownloading] = useState(false);
  const [streamingModelProgress, setStreamingModelProgress] = useState(0);
  const [streamingModelPhase, setStreamingModelPhase] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [micDevices, setMicDevices] = useState([]); // 可選的麥克風清單
  const [runtimeInfo, setRuntimeInfo] = useState(null);
  const [appVersion, setAppVersion] = useState(''); // 真實版本號（issue #15：別再寫死 v1.0.1）
  const [micMonitorLevel, setMicMonitorLevel] = useState(0);
  const [micMonitorError, setMicMonitorError] = useState("");
  const [micMonitorActive, setMicMonitorActive] = useState(false);
  const micMonitorRef = useRef({ raf: 0, context: null, stream: null });

  // 权限管理
  const showAlert = (alert) => {
    toast(alert.title, {
      description: alert.description,
      duration: 4000,
    });
  };

  const {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
  } = usePermissions(showAlert);

  // 加载设置
  useEffect(() => {
    loadSettings();
    // 取真實版本號顯示在「關於」（issue #15）
    window.electronAPI?.getAppVersion?.().then((v) => { if (v) setAppVersion(v); }).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const info = window.electronAPI?.getRuntimeInfo?.();
      if (info) setRuntimeInfo(info);
    } catch (e) {
      setRuntimeInfo(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadStreamingModelStatus = async () => {
      try {
        if (!window.electronAPI?.checkStreamingModelFiles) return;
        const status = await window.electronAPI.checkStreamingModelFiles();
        if (!cancelled) setStreamingModelStatus(status);
      } catch (e) {
        if (!cancelled) setStreamingModelStatus(null);
      }
    };
    loadStreamingModelStatus();
    const cleanup = window.electronAPI?.onStreamingModelDownloadProgress?.((progress) => {
      if (progress?.stage) {
        setStreamingModelPhase(progress.stage);
      }
      if (progress?.progress != null) {
        setStreamingModelProgress(progress.progress);
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // 列出可選的麥克風（已授權的話會有名稱；沒授權則只有編號）
  useEffect(() => {
    const loadMics = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicDevices(devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications'));
      } catch (e) { /* ignore */ }
    };
    loadMics();
    navigator.mediaDevices?.addEventListener?.('devicechange', loadMics);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', loadMics);
  }, []);

  useEffect(() => {
    const stopMicMonitor = () => {
      if (micMonitorRef.current.raf) cancelAnimationFrame(micMonitorRef.current.raf);
      micMonitorRef.current.raf = 0;
      if (micMonitorRef.current.stream) {
        micMonitorRef.current.stream.getTracks().forEach((track) => track.stop());
      }
      micMonitorRef.current.stream = null;
      if (micMonitorRef.current.context) {
        micMonitorRef.current.context.close().catch(() => {});
      }
      micMonitorRef.current.context = null;
      setMicMonitorActive(false);
      setMicMonitorLevel(0);
    };

    if (activeTab !== 'general') {
      stopMicMonitor();
      return stopMicMonitor;
    }

    let cancelled = false;

    const startMicMonitor = async () => {
      stopMicMonitor();
      setMicMonitorError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        setMicMonitorError(t('settings.micLevelUnsupported'));
        return;
      }

      const audioConstraints = {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: settings.mic_auto_gain !== false,
      };
      if (settings.mic_device_id) {
        audioConstraints.deviceId = { exact: settings.mic_device_id };
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextClass();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);

        const samples = new Uint8Array(analyser.fftSize);
        micMonitorRef.current = { ...micMonitorRef.current, context: audioContext, stream };
        setMicMonitorActive(true);

        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) {
            const centered = (sample - 128) / 128;
            sum += centered * centered;
          }
          const rms = Math.sqrt(sum / samples.length);
          setMicMonitorLevel(Math.min(1, rms * 8));
          micMonitorRef.current.raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        if (!cancelled) {
          setMicMonitorError(t('settings.micLevelUnavailable'));
        }
      }
    };

    startMicMonitor();

    return () => {
      cancelled = true;
      stopMicMonitor();
    };
  }, [activeTab, settings.mic_device_id, settings.mic_auto_gain, t]);

  const selectedMic = micDevices.find((device) => device.deviceId === settings.mic_device_id);
  const selectedMicLabel = settings.mic_device_id
    ? selectedMic?.label || t('settings.micDeviceUnknown')
    : t('settings.micDeviceDefault');

  const loadSettings = async () => {
    try {
      setLoading(true);
      if (window.electronAPI) {
        const allSettings = await window.electronAPI.getAllSettings();
        const loadedSettings = {
          ai_api_key: allSettings.ai_api_key || "",
          ai_base_url: allSettings.ai_base_url || "https://api.openai.com/v1",
          ai_model: allSettings.ai_model || "gpt-4o-mini",
          enable_ai_optimization: allSettings.enable_ai_optimization === true, // 默认为false
          enable_notifications: allSettings.enable_notifications !== false, // 默认为true
          enable_streaming_mode: allSettings.enable_streaming_mode === true, // 默認關閉
          language: allSettings.language || "zh-TW", // 默认繁体中文
          convert_transcription: allSettings.convert_transcription !== false, // 默认转换
          asr_profile: allSettings.asr_profile || "standard",
          mic_device_id: allSettings.mic_device_id || "",
          mic_auto_gain: allSettings.mic_auto_gain !== false,
          typeless_trigger: allSettings.typeless_trigger || "default",
          auto_format_lists: allSettings.auto_format_lists === true,
          auto_line_break: allSettings.auto_line_break === true,
          // 錄音完成後動作設定
          auto_enter_after_paste: allSettings.auto_enter_after_paste === true, // 默認不自動送出
          // 視窗控制設定
          window_always_on_top: allSettings.window_always_on_top !== false, // 默認置頂
          minimize_to_tray: allSettings.minimize_to_tray !== false, // 默認縮小到托盤
          close_to_tray: allSettings.close_to_tray !== false, // 默認關閉到托盤
          // 視窗透明度（0.3~1）：之前漏在白名單外 → 開設定永遠顯示 100%（與實際脫鉤）
          window_opacity: (() => {
            const v = Number(allSettings.window_opacity);
            return Number.isFinite(v) && v > 0 ? Math.max(0.3, Math.min(1, v)) : 1;
          })()
        };
        setSettings(prev => ({ ...prev, ...loadedSettings }));
        
        // 检查是否使用自定义模型
        const predefinedModels = ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner", "gpt-4o", "gpt-4o-mini", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-3.5-flash", "qwen2.5", "qwen2.5:3b", "llama3.2"];
        setCustomModel(!predefinedModels.includes(loadedSettings.ai_model));
      }
    } catch (error) {
      console.error("加载设置失败:", error);
      toast.error(t('settings.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 保存设置
  const saveSettings = async () => {
    try {
      setSaving(true);
      if (window.electronAPI) {
        // 保存每个设置项
        await window.electronAPI.setSetting('ai_api_key', settings.ai_api_key);
        await window.electronAPI.setSetting('ai_base_url', settings.ai_base_url);
        await window.electronAPI.setSetting('ai_model', settings.ai_model);
        await window.electronAPI.setSetting('enable_ai_optimization', settings.enable_ai_optimization);
        
        toast.success(t('settings.saveSuccess'));
      }
    } catch (error) {
      console.error("保存设置失败:", error);
      toast.error(t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // 处理输入变化
  const handleInputChange = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // 視窗透明度：即時套用 + 持久化（IPC 端會存設定）
  const handleOpacityChange = async (value) => {
    setSettings(prev => ({ ...prev, window_opacity: value }));
    try { await window.electronAPI?.setWindowOpacity?.(value); } catch (e) { /* ignore */ }
  };

  // 通用：改一個設定值並即時存檔（給下拉選單等用）
  const handleSettingChange = async (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    try { await window.electronAPI?.setSetting?.(key, value); } catch (e) { /* ignore */ }
  };

  const prepareStreamingModel = async () => {
    const status = await window.electronAPI?.checkStreamingModelFiles?.();
    setStreamingModelStatus(status || null);

    if (!status?.models_downloaded) {
      setStreamingModelDownloading(true);
      setStreamingModelProgress(0);
      setStreamingModelPhase('downloading');
      toast.info(t('settings.streamingModelDownloading'));
      const downloadResult = await window.electronAPI?.downloadStreamingModel?.();
      if (!downloadResult?.success) {
        toast.error(t('settings.streamingModelDownloadFailed', { error: downloadResult?.error || t('settings.testFailedDesc') }));
        return downloadResult || { success: false, error: t('settings.testFailedDesc') };
      }
      const nextStatus = await window.electronAPI?.checkStreamingModelFiles?.();
      setStreamingModelStatus(nextStatus || null);
      toast.success(t('settings.streamingModelDownloaded'));
    }

    setStreamingModelPhase('preloading');
    toast.info(t('settings.streamingPreloading'));
    return await window.electronAPI.preloadStreamingModel();
  };

  // 处理开关切换并自动保存
  const handleToggleChange = async (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));

    // 立即保存开关状态
    try {
      if (window.electronAPI) {
        await window.electronAPI.setSetting(key, value);
        // 根据不同的设置项显示不同的提示
        if (key === 'enable_ai_optimization') {
          toast.success(value ? t('notifications.aiEnabled') : t('notifications.aiDisabled'));
        } else if (key === 'enable_notifications') {
          toast.success(value ? t('notifications.enabled') : t('notifications.disabled'));
        } else if (key === 'enable_streaming_mode') {
          toast.success(value ? t('settings.streamingEnabled') : t('settings.streamingDisabled'));
          // 當啟用串流模式時，預載串流模型以減少首次錄音延遲
          if (value) {
            prepareStreamingModel()
              .then(result => {
                if (result.success) {
                  if (result.already_loaded) {
                    toast.success(t('settings.streamingModelReady'));
                  } else {
                    toast.success(t('settings.streamingPreloadComplete'));
                  }
                } else {
                  toast.error(t('settings.streamingPreloadFailed', { error: result.error || t('settings.testFailedDesc') }));
                }
              })
              .catch(err => {
                console.error('預載串流模型失敗:', err);
                toast.error(t('settings.streamingPreloadFailedSlow'));
              })
              .finally(() => {
                setStreamingModelDownloading(false);
                setStreamingModelProgress(0);
                setStreamingModelPhase(null);
              });
          }
        } else if (key === 'window_always_on_top') {
          // 視窗置頂需要即時應用
          await window.electronAPI.setAlwaysOnTop(value);
          toast.success(value ? t('settings.alwaysOnTopEnabled') : t('settings.alwaysOnTopDisabled'));
        } else if (key === 'minimize_to_tray') {
          toast.success(value ? t('settings.minimizeToTrayEnabled') : t('settings.minimizeToTrayDisabled'));
        } else if (key === 'close_to_tray') {
          toast.success(value ? t('settings.closeToTrayEnabled') : t('settings.closeToTrayDisabled'));
        }
        // 設定變更會透過 IPC 自動廣播到所有視窗
      }
    } catch (error) {
      console.error("保存设置失败:", error);
      toast.error(t('settings.saveFailed'));
    }
  };

  // Gemini（OpenAI 相容端點）
  const applyGeminiConfig = () => {
    setSettings(prev => ({
      ...prev,
      ai_base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
      ai_model: "gemini-2.5-flash",
      // 換到不同供應商就清空 key（別帶著別家的 key 打 Gemini → 一定失敗）
      ai_api_key: prev.ai_base_url === "https://generativelanguage.googleapis.com/v1beta/openai" ? prev.ai_api_key : ""
    }));
    setCustomModel(true);
    toast.info(t('settings.configApplied', { provider: 'Gemini' }));
  };

  // Ollama（本地 LLM，免 API key、全離線）
  const applyOllamaConfig = () => {
    setSettings(prev => ({
      ...prev,
      ai_base_url: "http://localhost:11434/v1",
      ai_api_key: prev.ai_api_key || "ollama",
      ai_model: "qwen2.5"
    }));
    setCustomModel(true);
    toast.info(t('settings.configApplied', { provider: t('settings.ollamaLocal') }));
  };

  // 重置为OpenAI配置
  const resetToOpenAI = () => {
    setSettings(prev => ({
      ...prev,
      ai_base_url: "https://api.openai.com/v1",
      ai_model: "gpt-4o-mini",
      ai_api_key: prev.ai_base_url === "https://api.openai.com/v1" ? prev.ai_api_key : ""
    }));
    setCustomModel(false);
    toast.info(t('settings.configApplied', { provider: t('settings.openaiConfig') }));
  };

  // 应用DeepSeek配置
  const applyDeepSeekConfig = () => {
    setSettings(prev => ({
      ...prev,
      ai_base_url: "https://api.deepseek.com",
      ai_model: "deepseek-v4-flash",
      ai_api_key: prev.ai_base_url === "https://api.deepseek.com" ? prev.ai_api_key : ""
    }));
    setCustomModel(false);
    toast.info(t('settings.configApplied', { provider: 'DeepSeek' }));
  };

  // 测试AI配置
  const testAIConfiguration = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      
      // 验证当前输入的配置
      if (!settings.ai_api_key.trim()) {
        setTestResult({
          available: false,
          error: t('settings.configIncompleteDesc'),
          details: t('settings.configIncompleteDesc')
        });
        toast.error(t('settings.configIncomplete'), {
          description: t('settings.configIncompleteDesc')
        });
        return;
      }
      
      if (window.electronAPI) {
        // 使用当前页面的配置进行测试，而不是已保存的配置
        const testConfig = {
          ai_api_key: settings.ai_api_key.trim(),
          ai_base_url: settings.ai_base_url.trim() || 'https://api.openai.com/v1',
          ai_model: settings.ai_model.trim() || 'gpt-4o-mini'
        };
        
        const result = await window.electronAPI.checkAIStatus(testConfig);
        setTestResult(result);
        
        if (result.available) {
          toast.success(t('settings.testSuccess'), {
            description: t('settings.testSuccessDesc', { model: result.model || '?' })
          });
        } else {
          toast.error(t('settings.testFailed'), {
            description: result.error || t('settings.testFailedDesc')
          });
        }
      }
    } catch (error) {
      console.error("测试AI配置失败:", error);
      setTestResult({
        available: false,
        error: error.message || t('settings.testFailed')
      });
      toast.error(t('settings.testFailed'), {
        description: error.message || t('settings.testFailedDesc')
      });
    } finally {
      setTesting(false);
    }
  };

  // 关闭窗口
  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.hideSettingsWindow();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-gray-700 dark:text-gray-300">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex flex-col">
      {/* 标题栏 - 固定（可拖曳，取代原生標題列）*/}
      <div className="draggable bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Settings className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 chinese-title">{t('settings.title')}</h1>
          </div>
          <button
            onClick={handleClose}
            className="non-draggable p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>
      </div>

      {/* 主要內容：左側分頁 + 右側內容 */}
      <div className="flex-1 flex min-h-0">
        {/* 側邊欄分頁 */}
        <nav className="w-44 flex-shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-white/40 dark:bg-gray-800/40 py-3">
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-r-2 border-blue-500 font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </nav>

        {/* 內容區 - 可滾動 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-2xl mx-auto p-6 pb-8">
            {activeTab === 'permissions' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.permissions')}
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('settings.permissionsDesc')}
                </p>
              </div>

              <div className="space-y-2">
                <PermissionCard
                  icon={Mic}
                  title={t('settings.micPermission')}
                  description={t('settings.micPermissionDesc')}
                  granted={micPermissionGranted}
                  onRequest={requestMicPermission}
                  buttonText={t('settings.testMic')}
                />

                <PermissionCard
                  icon={Shield}
                  title={t('settings.accessibilityPermission')}
                  description={t('settings.accessibilityPermissionDesc')}
                  granted={accessibilityPermissionGranted}
                  onRequest={testAccessibilityPermission}
                  buttonText={t('settings.testPermission')}
                />
              </div>
            </div>
          </div>

            )}

            {activeTab === 'general' && (<>
          {/* 一般设置部分 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.generalSettings')}
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('settings.generalDescription')}
                </p>
              </div>

              <div className="space-y-4">
                {/* 语言选择 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
                      <Globe className="w-4 h-4" />
                      {t('settings.language')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.languageDesc')}
                    </p>
                  </div>
                  <select
                    value={settings.language}
                    onChange={async (e) => {
                      const newLang = e.target.value;
                      handleInputChange('language', newLang);
                      await setLanguage(newLang);
                      if (window.electronAPI) {
                        await window.electronAPI.setSetting('language', newLang);
                      }
                      window.dispatchEvent(new Event('language-changed'));
                      // 使用新語言顯示通知，避免異步狀態更新導致顯示舊語言
                      const message =
                        newLang === 'zh-TW' ? '語言已切換' :
                        newLang === 'zh-CN' ? '语言已切换' :
                        'Language changed';
                      toast.success(message);
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="zh-TW">繁體中文</option>
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </div>

                {/* 麥克風選擇（空=系統預設） */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.micDevice')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.micDeviceDesc')}
                    </p>
                  </div>
                  <select
                    value={settings.mic_device_id || ''}
                    onChange={async (e) => {
                      const v = e.target.value;
                      handleInputChange('mic_device_id', v);
                      if (window.electronAPI) await window.electronAPI.setSetting('mic_device_id', v);
                      toast.success(t('settings.micDeviceChanged'));
                    }}
                    className="max-w-[55%] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 truncate"
                  >
                    <option value="">{t('settings.micDeviceDefault')}</option>
                    {micDevices.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `${t('settings.micDevice')} ${i + 1}`}</option>
                    ))}
                  </select>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Mic className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                        <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
                          {t('settings.micLevelTitle')}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                        {t('settings.micLevelSource', { device: selectedMicLabel })}
                      </p>
                    </div>
                    <span className={`shrink-0 text-xs font-medium ${
                      micMonitorError
                        ? 'text-amber-700 dark:text-amber-300'
                        : micMonitorActive
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {micMonitorError || (micMonitorActive ? t('settings.micLevelListening') : t('settings.micLevelStarting'))}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className={`h-full rounded-full transition-[width,background-color] duration-100 ${
                        micMonitorLevel > 0.08
                          ? 'bg-emerald-500'
                          : 'bg-amber-400'
                      }`}
                      style={{ width: `${Math.max(4, Math.round(micMonitorLevel * 100))}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {t('settings.micLevelHint')}
                  </p>
                </div>

                {/* 自動增益（AGC）：好麥克風可關掉，避免靜音時放大噪音導致幻聽 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.micAgc')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.micAgcDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.mic_auto_gain !== false}
                    onClick={() => handleToggleChange('mic_auto_gain', !(settings.mic_auto_gain !== false))}
                    className={`${
                      settings.mic_auto_gain !== false ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.mic_auto_gain !== false ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 錄音觸發鍵（issue #12：右 Alt/右 Ctrl 會跟其他軟體衝突，可換成不衝突的鍵） */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.typelessTrigger')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.typelessTriggerDesc')}
                    </p>
                  </div>
                  <select
                    value={settings.typeless_trigger || 'default'}
                    onChange={async (e) => {
                      const v = e.target.value;
                      handleInputChange('typeless_trigger', v);
                      if (window.electronAPI?.setTypelessTrigger) await window.electronAPI.setTypelessTrigger(v);
                      toast.success(t('settings.typelessTriggerChanged'));
                    }}
                    className="max-w-[55%] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="default">{t('settings.typelessTriggerDefault')}</option>
                    <option value="ctrlRight">{t('settings.typelessTriggerCtrlRight')}</option>
                    <option value="altRight">{t('settings.typelessTriggerAltRight')}</option>
                    <option value="f8">F8</option>
                    <option value="f9">F9</option>
                    <option value="f10">F10</option>
                  </select>
                </div>

                {/* 自動列點：把「第一…第二…第三…」轉成 1. 2. 3.（預設關，誤觸率偏高） */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.autoFormatLists')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.autoFormatListsDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.auto_format_lists === true}
                    onClick={() => handleToggleChange('auto_format_lists', !(settings.auto_format_lists === true))}
                    className={`${
                      settings.auto_format_lists === true ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.auto_format_lists === true ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 依停頓自動分行（issue #17）：講話頓一下思考不自動斷行，預設關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.autoLineBreak')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.autoLineBreakDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.auto_line_break === true}
                    onClick={() => handleToggleChange('auto_line_break', !(settings.auto_line_break === true))}
                    className={`${
                      settings.auto_line_break === true ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.auto_line_break === true ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 效能模式：標準（最準）/ 快速（弱 CPU 機器） */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.asrProfile')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.asrProfileDesc')}
                    </p>
                  </div>
                  <select
                    value={settings.asr_profile || 'standard'}
                    onChange={async (e) => {
                      const v = e.target.value;
                      handleInputChange('asr_profile', v);
                      if (window.electronAPI) {
                        await window.electronAPI.setSetting('asr_profile', v);
                      }
                      toast.success(t('settings.asrProfileChanged'));
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="standard">{t('settings.asrProfileStandard')}</option>
                    <option value="fast">{t('settings.asrProfileFast')}</option>
                  </select>
                </div>

                {/* 转换识别结果 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.convertTranscription')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.convertTranscriptionDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.convert_transcription}
                    onClick={() => handleToggleChange('convert_transcription', !settings.convert_transcription)}
                    className={`${
                      settings.convert_transcription ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.convert_transcription ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 通知开关 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label htmlFor="notifications-toggle" className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.notifications')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.notificationsDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.enable_notifications}
                    onClick={() => handleToggleChange('enable_notifications', !settings.enable_notifications)}
                    className={`${
                      settings.enable_notifications ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.enable_notifications ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 串流辨識模式開關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label htmlFor="streaming-toggle" className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.streamingMode')}
                    </label>
                    <p className="text-xs text-orange-500 dark:text-orange-400 mt-0.5">
                      {t('settings.streamingModeDesc')}
                    </p>
                    {streamingModelStatus && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {streamingModelPhase === 'extracting'
                          ? t('settings.streamingModelExtracting')
                          : streamingModelPhase === 'verifying'
                            ? t('settings.streamingModelVerifying')
                            : streamingModelPhase === 'preloading'
                              ? t('settings.streamingModelPreloadingStatus')
                              : streamingModelDownloading
                                ? t('settings.streamingModelDownloadingProgress', { progress: Math.round(streamingModelProgress) })
                                : streamingModelStatus.models_downloaded
                                  ? t('settings.streamingModelPresent')
                                  : t('settings.streamingModelMissing')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.enable_streaming_mode}
                    onClick={() => handleToggleChange('enable_streaming_mode', !settings.enable_streaming_mode)}
                    className={`${
                      settings.enable_streaming_mode ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.enable_streaming_mode ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

              </div>
            </div>
          </div>

          {/* 視窗控制設定 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.windowControl')}
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('settings.windowControlDesc')}
                </p>
              </div>

              <div className="space-y-4">
                {/* 視窗置頂開關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.alwaysOnTop')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.alwaysOnTopDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.window_always_on_top}
                    onClick={() => handleToggleChange('window_always_on_top', !settings.window_always_on_top)}
                    className={`${
                      settings.window_always_on_top ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.window_always_on_top ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 視窗透明度滑桿（迷你 / 一般面板共用） */}
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.windowOpacity')}
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                      {Math.round((settings.window_opacity ?? 1) * 100)}%
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    {t('settings.windowOpacityDesc')}
                  </p>
                  <input
                    type="range"
                    min="30"
                    max="100"
                    step="5"
                    value={Math.round((settings.window_opacity ?? 1) * 100)}
                    onChange={(e) => handleOpacityChange(Number(e.target.value) / 100)}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>

                {/* 縮小到托盤開關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.minimizeToTray')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.minimizeToTrayDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.minimize_to_tray}
                    onClick={() => handleToggleChange('minimize_to_tray', !settings.minimize_to_tray)}
                    className={`${
                      settings.minimize_to_tray ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.minimize_to_tray ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>

                {/* 關閉到托盤開關 */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.closeToTray')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.closeToTrayDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.close_to_tray}
                    onClick={() => handleToggleChange('close_to_tray', !settings.close_to_tray)}
                    className={`${
                      settings.close_to_tray ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.close_to_tray ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 錄音完成後動作設定 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.afterRecording')}
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {t('settings.afterRecordingDesc')}
                </p>
              </div>

              <div className="space-y-4">
                {/* 自動貼上：已固定開啟（不再提供開關，避免關掉後 TypeLess 失效） */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.autoPaste')}
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('settings.autoPasteDesc')}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-green-600 dark:text-green-400 whitespace-nowrap">{t('settings.alwaysOn')}</span>
                </div>

                {/* 貼上後自動送出開關（完全信任模式） */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {t('settings.autoEnter')}
                    </label>
                    <p className="text-xs text-orange-500 dark:text-orange-400 mt-0.5">
                      {t('settings.autoEnterDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.auto_enter_after_paste}
                    onClick={() => handleToggleChange('auto_enter_after_paste', !settings.auto_enter_after_paste)}
                    className={`${
                      settings.auto_enter_after_paste ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'
                    } cursor-pointer relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2`}
                  >
                    <span
                      aria-hidden="true"
                      className={`${
                        settings.auto_enter_after_paste ? 'translate-x-4' : 'translate-x-0'
                      } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 操作模式 / 朗讀設定 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                    {t('settings.commandSection')}
                  </h2>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {t('settings.commandSectionDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => window.electronAPI?.openNotes?.()}
                  className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {t('settings.openNotes')}
                </button>
              </div>

              {/* 朗讀語音 */}
              <div>
                <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {t('settings.ttsVoice')}
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-1.5">
                  {t('settings.ttsVoiceDesc')}
                </p>
                <select
                  value={settings.tts_voice || 'zh-TW-HsiaoChenNeural'}
                  onChange={(e) => handleSettingChange('tts_voice', e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="zh-TW-HsiaoChenNeural">{t('settings.ttsVoiceHsiaoChen')}</option>
                  <option value="zh-TW-HsiaoYuNeural">{t('settings.ttsVoiceHsiaoYu')}</option>
                  <option value="zh-TW-YunJheNeural">{t('settings.ttsVoiceYunJhe')}</option>
                </select>
              </div>

              {/* 朗讀語速 */}
              <div>
                <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {t('settings.ttsRate')}
                </label>
                <select
                  value={settings.tts_rate || '+0%'}
                  onChange={(e) => handleSettingChange('tts_rate', e.target.value)}
                  className="mt-1.5 w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="-25%">{t('settings.ttsRateSlow')}</option>
                  <option value="+0%">{t('settings.ttsRateNormal')}</option>
                  <option value="+25%">{t('settings.ttsRateFast')}</option>
                </select>
              </div>

              {/* 自由指令開關 */}
              <div className="flex items-center justify-between">
                <div className="pr-3">
                  <label className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {t('settings.freeformCommand')}
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {t('settings.freeformCommandDesc')}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.command_freeform_enabled !== false}
                  onClick={() => handleToggleChange('command_freeform_enabled', settings.command_freeform_enabled === false)}
                  className={`${
                    settings.command_freeform_enabled !== false ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'
                  } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
                >
                  <span
                    aria-hidden="true"
                    className={`${
                      settings.command_freeform_enabled !== false ? 'translate-x-4' : 'translate-x-0'
                    } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                  />
                </button>
              </div>
            </div>
          </div>

            </>)}

            {activeTab === 'history' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="p-5 h-[calc(100vh-7rem)]">
              <HistoryView />
            </div>
          </div>
            )}

            {activeTab === 'hotkeys' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="p-6">
              <HotkeySettings />
            </div>
          </div>

            )}

            {activeTab === 'hotwords' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="p-6">
              <HotwordsManager t={t} />
            </div>
          </div>

            )}

            {activeTab === 'dictionary' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="p-6">
              <DictionaryManager t={t} />
            </div>
          </div>

            )}

            {activeTab === 'emoji' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="p-6">
              <EmojiManager t={t} />
            </div>
          </div>

            )}

            {activeTab === 'ai' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  {t('settings.aiConfig')}
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                 {t('settings.aiConfigDesc')}
               </p>
              </div>

             <div className="space-y-4">
               {/* AI优化开关 */}
               <div className="flex items-center justify-between pt-4">
                 <label htmlFor="ai-optimization-toggle" className="text-sm font-medium text-gray-800 dark:text-gray-200">
                   {t('settings.enableAI')}
                 </label>
                 <button
                   type="button"
                   role="switch"
                   aria-checked={settings.enable_ai_optimization}
                   onClick={() => handleToggleChange('enable_ai_optimization', !settings.enable_ai_optimization)}
                   className={`${
                     settings.enable_ai_optimization ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                   } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                 >
                   <span
                     aria-hidden="true"
                     className={`${
                       settings.enable_ai_optimization ? 'translate-x-4' : 'translate-x-0'
                     } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                   />
                 </button>
               </div>

               {/* API Key */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('settings.apiKey')} *
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={settings.ai_api_key}
                      onChange={(e) => handleInputChange('ai_api_key', e.target.value)}
                      placeholder={t('settings.apiKeyPlaceholder')}
                      className="w-full px-3 py-2 pr-10 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('settings.apiKeyDesc')}
                  </p>
                  <button
                    type="button"
                    onClick={() => window.electronAPI?.openExternal?.('https://jeffrey0117.github.io/SpeakSlow/#/guide')}
                    className="mt-1 text-xs text-blue-500 hover:underline"
                  >
                    {t('settings.aiSetupHelp')} →
                  </button>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('settings.baseUrl')}
                  </label>
                  <input
                    type="url"
                    value={settings.ai_base_url}
                    onChange={(e) => handleInputChange('ai_base_url', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('settings.baseUrlDesc')}
                  </p>
                </div>

                {/* Model */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                      {t('settings.aiModel')}
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={applyDeepSeekConfig}
                        className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
                      >
                        DeepSeek
                      </button>
                      <button
                        type="button"
                        onClick={applyGeminiConfig}
                        className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                      >
                        Gemini
                      </button>
                      <button
                        type="button"
                        onClick={resetToOpenAI}
                        className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                      >
                        OpenAI
                      </button>
                      <button
                        type="button"
                        onClick={applyOllamaConfig}
                        className="text-xs px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                      >
                        {t('settings.ollamaLocal')}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="predefined-model"
                        name="model-type"
                        checked={!customModel}
                        onChange={() => setCustomModel(false)}
                        className="w-3 h-3 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <label htmlFor="predefined-model" className="text-xs text-gray-700 dark:text-gray-300">
                        {t('settings.predefinedModel')}
                      </label>
                    </div>
                    
                    {!customModel && (
                      <select
                        value={settings.ai_model}
                        onChange={(e) => {
                          const model = e.target.value;
                          // 根據模型自動設定對應的 base URL
                          let baseUrl = settings.ai_base_url;
                          let providerName = '';

                          if (model.startsWith('deepseek')) {
                            baseUrl = 'https://api.deepseek.com';
                            providerName = 'DeepSeek';
                          } else if (model.startsWith('gpt')) {
                            baseUrl = 'https://api.openai.com/v1';
                            providerName = 'OpenAI';
                          } else if (model.startsWith('gemini')) {
                            baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
                            providerName = 'Gemini';
                          } else if (model.startsWith('qwen') || model.startsWith('llama') || model.startsWith('gemma')) {
                            baseUrl = 'http://localhost:11434/v1';
                            providerName = t('settings.ollamaLocal');
                          }

                          // 換到「不同供應商」就清空 key（Ollama 用 dummy），
                          // 避免帶著別家的 key（那串星號）去打新供應商 → 失敗。
                          const providerChanged = baseUrl !== settings.ai_base_url;
                          const isOllama = baseUrl.includes('localhost:11434');
                          setSettings(prev => ({
                            ...prev,
                            ai_model: model,
                            ai_base_url: baseUrl,
                            ...(providerChanged ? { ai_api_key: isOllama ? (prev.ai_api_key || 'ollama') : '' } : {})
                          }));

                          if (providerName) {
                            toast.info(t('settings.providerEndpointSet', { provider: providerName }));
                          }
                        }}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      >
                        <optgroup label={t('settings.modelGroups.deepseek')}>
                          <option value="deepseek-v4-flash">{t('settings.modelOptions.deepseekChat')}</option>
                          <option value="deepseek-v4-pro">DeepSeek V4 Pro (推理)</option>
                        </optgroup>
                        <optgroup label="OpenAI">
                          <option value="gpt-4o-mini">GPT-4o Mini</option>
                          <option value="gpt-4o">GPT-4o</option>
                        </optgroup>
                        <optgroup label="Gemini">
                          <option value="gemini-2.5-flash">{t('settings.modelOptions.geminiFlash')}</option>
                          <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite</option>
                          <option value="gemini-2.5-pro">{t('settings.modelOptions.geminiPro')}</option>
                          <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                        </optgroup>
                        <optgroup label={t('settings.modelGroups.ollama')}>
                          <option value="qwen2.5">{t('settings.modelOptions.qwen')}</option>
                          <option value="qwen2.5:3b">{t('settings.modelOptions.qwenFast')}</option>
                          <option value="llama3.2">Llama 3.2</option>
                        </optgroup>
                      </select>
                    )}
                    
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="custom-model"
                        name="model-type"
                        checked={customModel}
                        onChange={() => setCustomModel(true)}
                        className="w-3 h-3 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <label htmlFor="custom-model" className="text-xs text-gray-700 dark:text-gray-300">
                        {t('settings.customModel')}
                      </label>
                    </div>

                    {customModel && (
                      <input
                        type="text"
                        value={settings.ai_model}
                        onChange={(e) => handleInputChange('ai_model', e.target.value)}
                        placeholder={t('settings.customModelPlaceholder')}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      />
                    )}
                  </div>

                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('settings.aiModelDesc')}
                  </p>
                </div>
              </div>

              {/* 测试结果显示 */}
              {testResult && (
                <div className={`mt-4 p-3 rounded-lg border ${
                  testResult.available
                    ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                    : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                }`}>
                  <div className="flex items-center space-x-2">
                    {testResult.available ? (
                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                    )}
                    <span className={`font-medium ${
                      testResult.available
                        ? 'text-green-800 dark:text-green-200'
                        : 'text-red-800 dark:text-red-200'
                    }`}>
                      {testResult.available ? t('settings.testSuccess') : t('settings.testFailed')}
                    </span>
                  </div>

                  {testResult.available && (
                    <div className="mt-2 space-y-1">
                      {testResult.model && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          {t('settings.testSuccessDesc', { model: testResult.model })}
                        </p>
                      )}
                      {testResult.details && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          {testResult.details}
                        </p>
                      )}
                      {testResult.response && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          AI: {testResult.response}
                        </p>
                      )}
                      {testResult.usage && (
                        <p className="text-xs text-green-600 dark:text-green-400">
                          Token: {testResult.usage.total_tokens || 'N/A'}
                        </p>
                      )}
                    </div>
                  )}

                  {!testResult.available && (
                    <div className="mt-2 space-y-1">
                      {testResult.error && (
                        <p className="text-xs text-red-700 dark:text-red-300">
                          {t('common.error')}: {testResult.error}
                        </p>
                      )}
                      {testResult.details && (
                        <p className="text-xs text-red-600 dark:text-red-400">
                          {testResult.details}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex flex-col">
                  <button
                    onClick={testAIConfiguration}
                    disabled={testing}
                    className="flex items-center space-x-2 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <TestTube className="w-3 h-3" />
                    )}
                    <span>{testing ? t('settings.testing') : t('settings.testConfig')}</span>
                  </button>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t('settings.testConfigDesc')}
                  </p>
                </div>

                <button
                  onClick={saveSettings}
                  disabled={saving || !settings.ai_api_key}
                  className="flex items-center space-x-2 px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  <span>{saving ? t('settings.saving') : t('settings.saveSettings')}</span>
                </button>
              </div>
            </div>
          </div>

            )}

            {activeTab === 'about' && (
            <div className="space-y-4 max-w-xl">
              {/* 專案 */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-5 text-center">
                <img
                  src="./icon.png"
                  alt={t('settings.aboutTab.logoAlt')}
                  className="w-20 h-20 mx-auto mb-3 rounded-2xl shadow-md"
                  draggable="false"
                />
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 brand-title">
                  {t('appName')} <span className="text-base font-normal text-gray-400">{t('settings.aboutTab.brandSub')}</span>
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('settings.aboutTab.tagline')}</p>
                <p className="text-[11px] text-gray-400 mt-2">{appVersion ? `v${appVersion} · ` : ''}Apache License 2.0</p>
              </div>

              {/* 作者 */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{t('settings.aboutTab.authorTitle')}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">{t('settings.aboutTab.authorPrefix')}<strong>{t('settings.aboutTab.authorName')}</strong>{t('settings.aboutTab.authorSuffix')}</p>
                <a href="https://github.com/Jeffrey0117/SpeakSlow" target="_blank" rel="noreferrer"
                   className="inline-block text-xs text-blue-500 hover:underline mt-2">
                  GitHub · Jeffrey0117/speakslow
                </a>
              </div>

              {/* 致謝 */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
                  <Heart className="w-4 h-4 text-red-400" /> {t('settings.aboutTab.acknowledgements')}
                </h3>
                <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-2 leading-relaxed">
                  <li>• <a href="https://github.com/yan5xu/ququ" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">ququ (yan5xu)</a> — {t('settings.aboutTab.ackQuqu')}</li>
                  <li>• <a href="https://github.com/k2-fsa/sherpa-onnx" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">sherpa-onnx (k2-fsa)</a> — {t('settings.aboutTab.ackSherpa')}</li>
                  <li>• <a href="https://wisprflow.ai/" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">Wispr Flow</a> — {t('settings.aboutTab.ackWispr')}</li>
                </ul>
              </div>
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// 导出组件供App.jsx使用
export { SettingsPage };

// 如果是直接访问settings.html，则渲染应用
if (document.getElementById("settings-root")) {
  const root = ReactDOM.createRoot(document.getElementById("settings-root"));
  root.render(
    <LanguageProvider>
      <SettingsPage />
      <Toaster />
    </LanguageProvider>
  );
}
