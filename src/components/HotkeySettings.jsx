import React, { useState, useEffect, useCallback } from "react";
import { Keyboard, RotateCcw, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "../i18n";

// 快捷鍵操作定義（文案放在語系檔 settings.hotkeysTab.actions）
const HOTKEY_ACTIONS = {
  'typeless-recording': {
    nameKey: 'settings.hotkeysTab.actions.typelessRecording.name',
    descriptionKey: 'settings.hotkeysTab.actions.typelessRecording.description',
  },
  'show-window': {
    nameKey: 'settings.hotkeysTab.actions.showWindow.name',
    descriptionKey: 'settings.hotkeysTab.actions.showWindow.description',
  },
  'copy-last': {
    nameKey: 'settings.hotkeysTab.actions.copyLast.name',
    descriptionKey: 'settings.hotkeysTab.actions.copyLast.description',
  },
  'toggle-command-mode': {
    nameKey: 'settings.hotkeysTab.actions.toggleCommandMode.name',
    descriptionKey: 'settings.hotkeysTab.actions.toggleCommandMode.description',
  },
  'clipboard-to-traditional': {
    nameKey: 'settings.hotkeysTab.actions.clipboardToTraditional.name',
    descriptionKey: 'settings.hotkeysTab.actions.clipboardToTraditional.description',
  },
  'clipboard-to-simplified': {
    nameKey: 'settings.hotkeysTab.actions.clipboardToSimplified.name',
    descriptionKey: 'settings.hotkeysTab.actions.clipboardToSimplified.description',
  },
};

// 格式化快捷鍵顯示
const formatHotkey = (accelerator, spaceLabel = 'Space') => {
  if (!accelerator) return '';

  const isMac = navigator.platform.includes('Mac');

  return accelerator
    .replace(/CommandOrControl/g, isMac ? '⌘' : 'Ctrl')
    .replace(/CmdOrCtrl/g, isMac ? '⌘' : 'Ctrl')
    .replace(/Command/g, '⌘')
    .replace(/Control/g, 'Ctrl')
    .replace(/Shift/g, isMac ? '⇧' : 'Shift')
    .replace(/Alt/g, isMac ? '⌥' : 'Alt')
    .replace(/Option/g, '⌥')
    .replace(/Meta/g, isMac ? '⌘' : 'Win')
    .replace(/Space/g, spaceLabel)
    .replace(/\+/g, ' + ');
};

// 將按鍵事件轉換為 Electron accelerator 格式
const keyEventToAccelerator = (e) => {
  const parts = [];

  if (e.ctrlKey || e.metaKey) {
    parts.push('CommandOrControl');
  }
  if (e.altKey) {
    parts.push('Alt');
  }
  if (e.shiftKey) {
    parts.push('Shift');
  }

  // 獲取按鍵
  let key = e.key;

  // 特殊鍵映射
  const specialKeys = {
    ' ': 'Space',
    'Escape': 'Escape',
    'Enter': 'Enter',
    'Tab': 'Tab',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PageUp',
    'PageDown': 'PageDown',
  };

  if (specialKeys[key]) {
    key = specialKeys[key];
  } else if (key.startsWith('F') && key.length <= 3) {
    // F1-F12
    key = key.toUpperCase();
  } else if (key.length === 1) {
    key = key.toUpperCase();
  } else if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    // 僅修飾鍵，不添加
    return null;
  }

  parts.push(key);

  return parts.join('+');
};

// 單個快捷鍵設定項
const HotkeyItem = ({ actionId, actionInfo, currentHotkey, defaultHotkey, onUpdate, onReset }) => {
  const { t } = useTranslation();
  const spaceLabel = t('settings.hotkeysTab.spaceKey');
  const [isRecording, setIsRecording] = useState(false);
  const [tempHotkey, setTempHotkey] = useState('');
  const [error, setError] = useState(null);

  const handleKeyDown = useCallback((e) => {
    if (!isRecording) return;

    e.preventDefault();
    e.stopPropagation();

    const accelerator = keyEventToAccelerator(e);
    if (accelerator) {
      setTempHotkey(accelerator);
      setError(null);
    }
  }, [isRecording]);

  const handleStartRecording = () => {
    setIsRecording(true);
    setTempHotkey('');
    setError(null);
  };

  const handleCancelRecording = () => {
    setIsRecording(false);
    setTempHotkey('');
    setError(null);
  };

  const handleSaveHotkey = async () => {
    if (!tempHotkey) {
      setError(t('settings.hotkeysTab.pressHotkeyFirst'));
      return;
    }

    try {
      // 驗證快捷鍵
      if (window.electronAPI) {
        const validation = await window.electronAPI.validateHotkey(tempHotkey, actionId);
        if (!validation.valid) {
          setError(validation.error);
          return;
        }

        // 設置快捷鍵
        const result = await window.electronAPI.setActionHotkey(actionId, tempHotkey);
        if (result.success) {
          onUpdate(actionId, tempHotkey);
          setIsRecording(false);
          setTempHotkey('');
          toast.success(t('settings.hotkeysTab.updated', { hotkey: formatHotkey(tempHotkey, spaceLabel) }));

          // 通知其他組件快捷鍵已變更
          if (actionId === 'toggle-recording' || actionId === 'typeless-recording') {
            window.dispatchEvent(new CustomEvent('hotkey-changed', {
              detail: { hotkey: tempHotkey, actionId }
            }));
          }
        } else {
          setError(result.error || t('settings.hotkeysTab.setFailed'));
        }
      }
    } catch (err) {
      setError(err.message || t('settings.hotkeysTab.setFailed'));
    }
  };

  const handleReset = async () => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.resetHotkeys(actionId);
        if (result.success) {
          onReset(actionId, defaultHotkey);
          toast.success(t('settings.hotkeysTab.resetDone'));
        }
      }
    } catch (err) {
      toast.error(t('settings.hotkeysTab.resetFailed'));
    }
  };

  const isDefault = currentHotkey === defaultHotkey;
  // TypeLess 固定為「右 Alt 單擊切換」，不可自訂（accelerator 無法表達單獨右 Alt）
  const isTypeless = actionId === 'typeless-recording';

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="font-medium text-gray-900 dark:text-gray-100">{t(actionInfo.nameKey)}</h4>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t(actionInfo.descriptionKey)}</p>
        </div>
        {!isDefault && (
          <button
            onClick={handleReset}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            title={t('settings.hotkeysTab.resetToDefault')}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isTypeless ? (
          <div className="flex-1 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-center font-mono text-gray-700 dark:text-gray-300">
            {t('settings.hotkeysTab.typelessFixed')}
          </div>
        ) : isRecording ? (
          <>
            <div
              className="flex-1 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-400 dark:border-blue-500 rounded-lg text-center font-mono text-blue-700 dark:text-blue-300 animate-pulse"
              tabIndex={0}
              onKeyDown={handleKeyDown}
              autoFocus
            >
              {tempHotkey ? formatHotkey(tempHotkey, spaceLabel) : t('settings.hotkeysTab.pressHotkey')}
            </div>
            <button
              onClick={handleSaveHotkey}
              disabled={!tempHotkey}
              className="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={handleCancelRecording}
              className="px-3 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
            >
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <>
            <div className="flex-1 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-center font-mono text-gray-700 dark:text-gray-300">
              {formatHotkey(currentHotkey, spaceLabel) || t('settings.hotkeysTab.notSet')}
            </div>
            <button
              onClick={handleStartRecording}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              {t('settings.hotkeysTab.record')}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mt-2 flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
    </div>
  );
};

// 快捷鍵設定主組件
const HotkeySettings = () => {
  const { t } = useTranslation();
  const [hotkeys, setHotkeys] = useState({});
  const [defaults, setDefaults] = useState({});
  const [loading, setLoading] = useState(true);

  // 載入快捷鍵設定
  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.getHotkeySettings();
          if (result.success) {
            setHotkeys(result.hotkeys || {});
            setDefaults(result.defaults || {});
          }
        }
      } catch (err) {
        console.error('載入快捷鍵設定失敗:', err);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleUpdate = (actionId, newHotkey) => {
    setHotkeys(prev => ({ ...prev, [actionId]: newHotkey }));
  };

  const handleReset = (actionId, defaultHotkey) => {
    setHotkeys(prev => ({ ...prev, [actionId]: defaultHotkey }));
  };

  const handleResetAll = async () => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.resetHotkeys();
        if (result.success) {
          setHotkeys(result.hotkeys || defaults);
          toast.success(t('settings.hotkeysTab.resetAllDone'));
        }
      }
    } catch (err) {
      toast.error(t('settings.hotkeysTab.resetFailed'));
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Keyboard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('settings.hotkeysTab.title')}</h3>
        </div>
        <button
          onClick={handleResetAll}
          className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center gap-1"
        >
          <RotateCcw className="w-4 h-4" />
          {t('settings.hotkeysTab.resetAll')}
        </button>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {t('settings.hotkeysTab.description')}
      </p>

      <div className="space-y-3">
        {Object.entries(HOTKEY_ACTIONS).map(([actionId, actionInfo]) => (
          <HotkeyItem
            key={actionId}
            actionId={actionId}
            actionInfo={actionInfo}
            currentHotkey={hotkeys[actionId] || defaults[actionId]}
            defaultHotkey={defaults[actionId]}
            onUpdate={handleUpdate}
            onReset={handleReset}
          />
        ))}
      </div>

      <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          <strong>{t('settings.hotkeysTab.tipLabel')}</strong>{t('settings.hotkeysTab.tipContent')}
        </p>
      </div>
    </div>
  );
};

export default HotkeySettings;
