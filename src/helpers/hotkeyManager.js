const { globalShortcut } = require('electron');

class HotkeyManager {
  constructor(logger = null) {
    this.registeredHotkeys = new Map();
    this.f2ClickTimes = [];
    this.f2DoubleClickTimeout = 500; // 500ms内的两次点击算作双击
    this.onF2DoubleClick = null;
    this.isRecording = false;
    this.logger = logger;

    // 简化的热键防抖机制
    this.lastHotkeyTrigger = new Map();
    this.hotkeyDebounceTime = 200; // 200ms防抖时间，防止意外双击

    // 快捷鍵操作定義 (actionId -> callback)
    this.hotkeyActions = new Map();

    // 快捷鍵映射 (actionId -> accelerator)
    this.hotkeyBindings = new Map();

    // 預設快捷鍵配置
    // 註：錄音已統一為 TypeLess「右 Alt」（由 TypelessManager 處理，非 globalShortcut），
    //     故不再註冊 toggle-recording（Ctrl+Shift+Space）。
    // 註：取消錄音改由 TypeLess（uiohook）在「錄音中」偵測 Esc 處理，
    //     不再註冊全域 Escape（避免劫持所有程式的 Esc）。
    this.defaultHotkeys = {
      'show-window': 'CommandOrControl+Shift+Q',
      'copy-last': 'CommandOrControl+Shift+C',
      'toggle-command-mode': 'CommandOrControl+Shift+K',
      'quick-edit-last': 'CommandOrControl+Shift+E',
      'show-cheat-sheet': 'CommandOrControl+Shift+H',
    };

    // 系統保留快捷鍵（不允許使用）
    this.reservedHotkeys = [
      'CommandOrControl+C',
      'CommandOrControl+V',
      'CommandOrControl+X',
      'CommandOrControl+A',
      'CommandOrControl+Z',
      'CommandOrControl+Y',
      'CommandOrControl+S',
      'CommandOrControl+W',
      'CommandOrControl+Q',
      'Alt+F4',
    ];
  }

  /**
   * 獲取預設快捷鍵配置
   */
  getDefaultHotkeys() {
    return { ...this.defaultHotkeys };
  }

  /**
   * 獲取所有快捷鍵綁定
   */
  getHotkeyBindings() {
    const bindings = {};
    for (const [actionId, accelerator] of this.hotkeyBindings) {
      bindings[actionId] = accelerator;
    }
    return bindings;
  }

  /**
   * 驗證快捷鍵是否可用
   * @param {string} accelerator - 快捷鍵字串
   * @param {string} excludeActionId - 排除的操作ID（用於更新時）
   * @returns {{ valid: boolean, error?: string }}
   */
  validateHotkey(accelerator, excludeActionId = null) {
    // 檢查格式
    if (!accelerator || typeof accelerator !== 'string') {
      return { valid: false, error: '快捷鍵不能為空' };
    }

    // 檢查是否為保留鍵
    const normalizedAccelerator = accelerator.replace(/Ctrl/g, 'CommandOrControl').replace(/Cmd/g, 'CommandOrControl');
    if (this.reservedHotkeys.includes(normalizedAccelerator)) {
      return { valid: false, error: '此快捷鍵為系統保留，無法使用' };
    }

    // 檢查是否與現有快捷鍵衝突
    for (const [actionId, existingAccelerator] of this.hotkeyBindings) {
      if (actionId !== excludeActionId && existingAccelerator === accelerator) {
        return { valid: false, error: `此快捷鍵已被「${this.getActionName(actionId)}」使用` };
      }
    }

    return { valid: true };
  }

  /**
   * 獲取操作的顯示名稱
   */
  getActionName(actionId) {
    const names = {
      'toggle-recording': '開始/停止錄音',
      'typeless-recording': 'TypeLess 按住錄音',
      'cancel-recording': '取消錄音',
      'show-window': '顯示主視窗',
      'copy-last': '複製上次結果',
      'toggle-command-mode': '切換操作模式',
      'quick-edit-last': '修改上一句（快速修改）',
      'show-cheat-sheet': '快捷鍵速查表',
    };
    return names[actionId] || actionId;
  }

  /**
   * 設置操作的回調函數
   * @param {string} actionId - 操作ID
   * @param {Function} callback - 回調函數
   */
  setActionCallback(actionId, callback) {
    this.hotkeyActions.set(actionId, callback);
    this.safeLog('info', `設置操作回調: ${actionId}`);
  }

  /**
   * 為指定操作註冊快捷鍵
   * @param {string} actionId - 操作ID
   * @param {string} accelerator - 快捷鍵
   * @returns {{ success: boolean, error?: string }}
   */
  registerActionHotkey(actionId, accelerator) {
    // 驗證快捷鍵
    const validation = this.validateHotkey(accelerator, actionId);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // 先取消舊的綁定
    const oldAccelerator = this.hotkeyBindings.get(actionId);
    if (oldAccelerator) {
      this.unregisterHotkey(oldAccelerator);
    }

    // 獲取回調函數
    const callback = this.hotkeyActions.get(actionId);
    if (!callback) {
      return { success: false, error: `操作 ${actionId} 未設置回調函數` };
    }

    // 創建帶防抖的回調
    const debouncedCallback = () => {
      const now = Date.now();
      const lastTrigger = this.lastHotkeyTrigger.get(actionId) || 0;

      if (now - lastTrigger < this.hotkeyDebounceTime) {
        return;
      }

      this.lastHotkeyTrigger.set(actionId, now);
      callback({ actionId, accelerator });
    };

    // 註冊新快捷鍵
    const success = globalShortcut.register(accelerator, debouncedCallback);

    if (success) {
      this.hotkeyBindings.set(actionId, accelerator);
      this.registeredHotkeys.set(accelerator, debouncedCallback);
      this.safeLog('info', `快捷鍵 ${accelerator} 已綁定到操作 ${actionId}`);
      return { success: true };
    } else {
      this.safeLog('error', `快捷鍵 ${accelerator} 註冊失敗`);
      return { success: false, error: `快捷鍵 ${accelerator} 註冊失敗，可能已被其他應用佔用` };
    }
  }

  /**
   * 取消指定操作的快捷鍵
   * @param {string} actionId - 操作ID
   */
  unregisterActionHotkey(actionId) {
    const accelerator = this.hotkeyBindings.get(actionId);
    if (accelerator) {
      this.unregisterHotkey(accelerator);
      this.hotkeyBindings.delete(actionId);
      this.safeLog('info', `操作 ${actionId} 的快捷鍵已取消`);
    }
  }

  /**
   * 重設指定操作的快捷鍵為預設值
   * @param {string} actionId - 操作ID（可選，不傳則重設全部）
   */
  resetToDefault(actionId = null) {
    if (actionId) {
      const defaultAccelerator = this.defaultHotkeys[actionId];
      if (defaultAccelerator) {
        return this.registerActionHotkey(actionId, defaultAccelerator);
      }
      return { success: false, error: `未找到操作 ${actionId} 的預設快捷鍵` };
    } else {
      // 重設所有
      const results = {};
      for (const [id, accelerator] of Object.entries(this.defaultHotkeys)) {
        results[id] = this.registerActionHotkey(id, accelerator);
      }
      return { success: true, results };
    }
  }

  /**
   * 安全記錄日誌
   */
  safeLog(level, message, data = null) {
    if (this.logger && this.logger[level]) {
      if (data) {
        this.logger[level](message, data);
      } else {
        this.logger[level](message);
      }
    }
  }

  /**
   * 注册F2双击热键
   * @param {Function} callback - 双击回调函数
   */
  registerF2DoubleClick(callback) {
    // 如果已经注册了F2，只更新回调函数，不重新注册
    if (this.registeredHotkeys.has('F2')) {
      if (this.logger && this.logger.info) {
        this.logger.info('F2热键已注册，更新回调函数');
      }
      this.onF2DoubleClick = callback;
      return true;
    }
    
    this.onF2DoubleClick = callback;
    
    // 注册F2单击监听
    const success = globalShortcut.register('F2', () => {
      this.handleF2Click();
    });

    if (success) {
      if (this.logger && this.logger.info) {
        this.logger.info('F2热键首次注册成功');
      }
      this.registeredHotkeys.set('F2', callback);
      return true;
    } else {
      if (this.logger && this.logger.error) {
        this.logger.error('F2热键注册失败');
      }
      return false;
    }
  }

  /**
   * 处理F2按键点击
   */
  handleF2Click() {
    const now = Date.now();
    this.f2ClickTimes.push(now);

    // 清理超过双击时间窗口的点击记录
    this.f2ClickTimes = this.f2ClickTimes.filter(
      time => now - time <= this.f2DoubleClickTimeout
    );

    // 检查是否为双击
    if (this.f2ClickTimes.length >= 2) {
      if (this.logger && this.logger.info) {
        this.logger.info('检测到F2双击');
      }
      this.handleF2DoubleClick();
      this.f2ClickTimes = []; // 清空点击记录
    }
  }

  /**
   * 处理F2双击事件
   */
  handleF2DoubleClick() {
    if (this.onF2DoubleClick) {
      // 根据当前状态决定动作
      const action = this.isRecording ? 'stop' : 'start';
      if (this.logger && this.logger.info) {
        this.logger.info(`F2双击 - ${action === 'start' ? '开始' : '停止'}录音，当前状态: ${this.isRecording}`);
      }
      
      this.onF2DoubleClick({
        action: action,
        currentState: this.isRecording
      });
      
      // 不在这里更新状态，让渲染进程来更新
    }
  }

  /**
   * 注册传统热键（如Cmd+Shift+Space）
   * @param {string} hotkey - 热键组合
   * @param {Function} callback - 回调函数
   */
  registerHotkey(hotkey, callback) {
    // 检查是否已经注册了相同的热键
    if (this.registeredHotkeys.has(hotkey)) {
      if (this.logger && this.logger.info) {
        this.logger.info(`热键 ${hotkey} 已注册，跳过重复注册`);
      }
      return true; // 返回成功，因为热键已经注册
    }

    // 创建带简单防抖的回调函数
    const debouncedCallback = () => {
      const now = Date.now();
      const lastTrigger = this.lastHotkeyTrigger.get(hotkey) || 0;
      
      // 简单防抖：防止意外的快速重复触发
      if (now - lastTrigger < this.hotkeyDebounceTime) {
        return;
      }
      
      this.lastHotkeyTrigger.set(hotkey, now);
      callback();
    };

    const success = globalShortcut.register(hotkey, debouncedCallback);
    
    if (success) {
      if (this.logger && this.logger.info) {
        this.logger.info(`热键 ${hotkey} 注册成功`);
      }
      this.registeredHotkeys.set(hotkey, debouncedCallback);
      return true;
    } else {
      if (this.logger && this.logger.error) {
        this.logger.error(`热键 ${hotkey} 注册失败`);
      }
      return false;
    }
  }

  /**
   * 注销热键
   * @param {string} hotkey - 热键组合
   */
  unregisterHotkey(hotkey) {
    if (this.registeredHotkeys.has(hotkey)) {
      globalShortcut.unregister(hotkey);
      this.registeredHotkeys.delete(hotkey);
      if (this.logger && this.logger.info) {
        this.logger.info(`热键 ${hotkey} 已注销`);
      }
      return true;
    }
    return false;
  }

  /**
   * 注销所有热键
   */
  unregisterAllHotkeys() {
    globalShortcut.unregisterAll();
    this.registeredHotkeys.clear();
    this.f2ClickTimes = [];
    if (this.logger && this.logger.info) {
      this.logger.info('所有热键已注销');
    }
  }

  /**
   * 获取已注册的热键列表
   */
  getRegisteredHotkeys() {
    return Array.from(this.registeredHotkeys.keys());
  }

  /**
   * 检查热键是否已注册
   * @param {string} hotkey - 热键组合
   */
  isHotkeyRegistered(hotkey) {
    return this.registeredHotkeys.has(hotkey);
  }

  /**
   * 设置录音状态（用于外部同步状态）
   * @param {boolean} isRecording - 录音状态
   */
  setRecordingState(isRecording) {
    this.isRecording = isRecording;
  }

  /**
   * 获取当前录音状态
   */
  getRecordingState() {
    return this.isRecording;
  }
}

module.exports = HotkeyManager;