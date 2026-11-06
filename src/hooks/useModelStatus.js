import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '../i18n';

// 检查是否为控制面板或设置页面
const isControlPanelOrSettings = () => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('panel') === 'control' || urlParams.get('page') === 'settings';
};

/**
 * 模型状态监控Hook
 * 监控 Sherpa ASR 模型的下载、加载状态
 */
export const useModelStatus = () => {
  const { t } = useTranslation();
  const [modelStatus, setModelStatus] = useState({
    isLoading: true,
    isReady: false,
    isDownloading: false,
    modelsDownloaded: false,
    error: null,
    progress: 0,
    downloadProgress: 0,
    missingModels: [],
    stage: 'checking' // checking, downloading, loading, ready, error
  });
  // 後端兩次啟動都失敗時，前端自動重啟一次自救；只試一次，避免無限重啟循環
  const autoRestartTriedRef = useRef(false);

  // 检查模型文件状态
  const checkModelFiles = useCallback(async () => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.checkModelFiles();
        return result;
      }
      return { success: false, models_downloaded: false };
    } catch (error) {
      console.error('检查模型文件失败:', error);
      return { success: false, models_downloaded: false };
    }
  }, []);

  // 检查 Sherpa 服务器状态
  const checkServerStatus = useCallback(async () => {
    console.log('[useModelStatus] checkServerStatus 開始');
    try {
      if (window.electronAPI) {
        console.log('[useModelStatus] 調用 checkSherpaStatus...');
        const status = await window.electronAPI.checkSherpaStatus();
        console.log('[useModelStatus] checkSherpaStatus 返回:', status);
        return status;
      }
      console.log('[useModelStatus] electronAPI 不存在');
      return { success: false };
    } catch (error) {
      console.error('[useModelStatus] 检查服务器状态失败:', error);
      return { success: false };
    }
  }, []);

  // 综合检查模型状态
  const checkModelStatus = useCallback(async () => {
    console.log('[useModelStatus] checkModelStatus 開始');
    try {
      if (!window.electronAPI) {
        setModelStatus(prev => ({
          ...prev,
          isLoading: false,
          error: t('errors.electronApiUnavailable'),
          stage: 'error'
        }));
        return;
      }

      // 检查模型文件（現在也包含服務器狀態）
      console.log('[useModelStatus] 調用 checkModelFiles...');
      const modelFiles = await checkModelFiles();
      console.log('[useModelStatus] checkModelFiles 返回:', modelFiles);

      // 從 checkModelFiles 結果中獲取服務器狀態
      const serverStatus = {
        success: modelFiles.server_ready || false,
        models_initialized: modelFiles.models_initialized || false
      };
      console.log('[useModelStatus] serverStatus:', serverStatus);

      if (!modelFiles.success) {
        setModelStatus(prev => ({
          ...prev,
          isLoading: false,
          error: t('errors.checkModelFilesFailed'),
          stage: 'error'
        }));
        return;
      }

      const modelsDownloaded = modelFiles.models_downloaded;
      const missingModels = modelFiles.missing_models || [];
      
      if (!modelsDownloaded) {
        // 模型未下载
        setModelStatus(prev => ({
          ...prev,
          isLoading: false,
          isReady: false,
          modelsDownloaded: false,
          missingModels,
          error: null,
          progress: 0,
          stage: 'need_download'
        }));
      } else if (serverStatus.success && serverStatus.models_initialized) {
        // 模型已下载且服务器就绪
        setModelStatus(prev => ({
          ...prev,
          isLoading: false,
          isReady: true,
          modelsDownloaded: true,
          missingModels: [],
          error: null,
          progress: 100,
          stage: 'ready'
        }));
      } else if (serverStatus.initializing) {
        // 模型已下载，正在加载
        setModelStatus(prev => ({
          ...prev,
          isLoading: true,
          isReady: false,
          modelsDownloaded: true,
          missingModels: [],
          error: null,
          progress: 50,
          stage: 'loading'
        }));
      } else if (modelFiles.startup_failed) {
        // 服務器兩次啟動嘗試都失敗：先自動重啟一次自救（冷開機/防毒拖慢常是暫時性），
        // 自救也失敗才顯示錯誤，讓使用者看得到問題而不是永遠轉圈
        if (!autoRestartTriedRef.current) {
          autoRestartTriedRef.current = true;
          console.warn('[useModelStatus] 後端啟動失敗，自動重啟一次');
          try { window.electronAPI.restartSherpaServer(); } catch (e) { /* 失敗走下輪輪詢 */ }
          setModelStatus(prev => ({
            ...prev,
            isLoading: true,
            isReady: false,
            modelsDownloaded: true,
            missingModels: [],
            error: null,
            progress: 30,
            stage: 'loading'
          }));
        } else {
          setModelStatus(prev => ({
            ...prev,
            isLoading: false,
            isReady: false,
            modelsDownloaded: true,
            missingModels: [],
            error: t('errors.sherpaStartupFailed'),
            progress: 0,
            stage: 'error'
          }));
        }
      } else {
        // 模型已下载但服务器未就绪 - 显示为 loading 状态而非 error
        // 因为服务器可能正在启动中
        setModelStatus(prev => ({
          ...prev,
          isLoading: true,
          isReady: false,
          modelsDownloaded: true,
          missingModels: [],
          error: null,
          progress: 30,
          stage: 'loading'
        }));
      }
      
    } catch (error) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '检查模型状态失败:', error);
      }
      setModelStatus(prev => ({
        ...prev,
        isLoading: false,
        isReady: false,
        error: error.message || t('errors.modelStatusCheckFailed'),
        progress: 0,
        stage: 'error'
      }));
    }
  }, [checkModelFiles, t]);

  // 下载模型
  const downloadModels = useCallback(async () => {
    try {
      if (!window.electronAPI) {
        throw new Error(t('errors.electronApiUnavailable'));
      }

      // 设置下载状态，并阻止定时器干扰
      setModelStatus(prev => ({
        ...prev,
        isDownloading: true,
        downloadProgress: 0,
        error: null,
        stage: 'downloading',
        isLoading: false // 确保不显示加载状态
      }));

      const result = await window.electronAPI.downloadModels();
      
      if (result.success) {
        // 下载成功，设置为加载状态
        setModelStatus(prev => ({
          ...prev,
          isDownloading: false,
          modelsDownloaded: true,
          downloadProgress: 100,
          stage: 'loading',
          isLoading: true
        }));
        
        // 下载完成后重启 Sherpa 服务器以加载模型
        try {
          console.log('模型下载完成，重启 Sherpa 服务器...');
          await window.electronAPI.restartSherpaServer();
          console.log('Sherpa 服务器重启完成');

          // 重启后等待一段时间再检查状态
          setTimeout(() => {
            checkModelStatus();
          }, 3000); // 增加等待时间到3秒

        } catch (restartError) {
          console.error('重启 Sherpa 服务器失败:', restartError);
          setModelStatus(prev => ({
            ...prev,
            isLoading: false,
            error: t('errors.restartServerFailed', { error: restartError.message }),
            stage: 'error'
          }));
        }
        
        return { success: true };
      } else {
        throw new Error(result.error || t('errors.downloadFailed'));
      }
      
    } catch (error) {
      console.error('下载模型失败:', error);
      setModelStatus(prev => ({
        ...prev,
        isDownloading: false,
        isLoading: false,
        error: error.message || t('errors.downloadModelsFailed'),
        stage: 'error'
      }));
      return { success: false, error: error.message };
    }
  }, [checkModelStatus, t]);

  // 获取下载进度
  const getDownloadProgress = useCallback(async () => {
    try {
      if (window.electronAPI) {
        const progress = await window.electronAPI.getDownloadProgress();
        return progress;
      }
      return { success: false };
    } catch (error) {
      console.error('获取下载进度失败:', error);
      return { success: false };
    }
  }, []);

  // 初始化时检查状态
  useEffect(() => {
    if (isControlPanelOrSettings()) {
      console.log('控制面板或设置页面，跳过模型状态检查');
      return;
    }
    
    checkModelStatus();
  }, [checkModelStatus]);

  // 设置定期检查（仅在主窗口且模型未就绪时）
  useEffect(() => {
    if (isControlPanelOrSettings() || modelStatus.isReady || modelStatus.isDownloading) {
      return;
    }

    const interval = setInterval(() => {
      if (!modelStatus.isReady && !modelStatus.isDownloading) {
        checkModelStatus();
      }
    }, 3000); // 减少间隔，确保及时检测到状态变化

    return () => clearInterval(interval);
  }, [modelStatus.isReady, modelStatus.isDownloading, checkModelStatus]);

  // 监听下载进度事件
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onModelDownloadProgress) {
      const unsubscribe = window.electronAPI.onModelDownloadProgress((event, progress) => {
        setModelStatus(prev => ({
          ...prev,
          downloadProgress: progress.overall_progress || progress.progress || 0,
          stage: 'downloading'
        }));
      });

      return unsubscribe;
    }
  }, []);

  // 监听模型初始化事件
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onProcessingUpdate) {
      const unsubscribe = window.electronAPI.onProcessingUpdate((event, data) => {
        if (data.type === 'model_initialization') {
          setModelStatus(prev => ({
            ...prev,
            isLoading: data.isLoading,
            isReady: data.isReady,
            progress: data.progress || prev.progress,
            stage: data.isReady ? 'ready' : 'loading'
          }));
        }
      });

      return unsubscribe;
    }
  }, []);

  return {
    ...modelStatus,
    checkModelStatus,
    downloadModels,
    getDownloadProgress,
    checkModelFiles
  };
};