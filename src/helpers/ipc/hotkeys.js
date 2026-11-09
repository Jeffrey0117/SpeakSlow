const { ipcMain } = require("electron");
const { stopSpeaking } = require("../tts");
const { getShared: getClipboardSwap } = require("../clipboardSwap");
const { convertClipboard } = require("../clipboardConvert");

module.exports = function register(ctx) {
  // 热键管理 - 添加发送者跟踪机制
  ctx.hotkeyRegisteredSenders = new Set(); // 跟踪已注册热键的发送者

  ipcMain.handle("register-hotkey", (event, hotkey) => {
    try {
      if (ctx.hotkeyManager) {
        const senderId = event.sender.id;

        // 检查是否已经为这个发送者注册过热键
        if (ctx.hotkeyRegisteredSenders.has(senderId)) {
          ctx.logger.info(`发送者 ${senderId} 已注册过热键，跳过重复注册`);
          return { success: true };
        }

        const success = ctx.hotkeyManager.registerHotkey(hotkey, () => {
          // 熱鍵觸發時同步儲存當前前景視窗（在主進程）
          // 使用 execSync 確保在發送事件前完成
          ctx.logger.info(`热键 ${hotkey} 被触发，同步儲存前景視窗`);
          try {
            const result = ctx.clipboardManager.saveForegroundWindow();
            ctx.logger.info('儲存前景視窗結果:', result);
          } catch (err) {
            ctx.logger.warn('儲存前景視窗失敗:', err.message);
          }

          // 發送热键触发事件到主窗口（在儲存視窗 handle 後）
          if (ctx.windowManager && ctx.windowManager.mainWindow && !ctx.windowManager.mainWindow.isDestroyed()) {
            ctx.windowManager.mainWindow.webContents.send("hotkey-triggered", { hotkey });
          }
        });

        if (success) {
          // 添加发送者到跟踪列表
          ctx.hotkeyRegisteredSenders.add(senderId);

          // 监听窗口关闭事件，清理注册记录
          event.sender.on('destroyed', () => {
            ctx.hotkeyRegisteredSenders.delete(senderId);
            ctx.logger.info(`清理发送者 ${senderId} 的热键注册记录`);
          });

          ctx.logger.info(`热键 ${hotkey} 注册成功，发送者: ${senderId}`);
        } else {
          ctx.logger.error(`热键 ${hotkey} 注册失败`);
        }

        return { success };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      ctx.logger.error("注册热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("unregister-hotkey", (event, hotkey) => {
    try {
      if (ctx.hotkeyManager) {
        const success = ctx.hotkeyManager.unregisterHotkey(hotkey);
        return { success };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      ctx.logger.error("注销热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-current-hotkey", () => {
    try {
      if (ctx.hotkeyManager) {
        const hotkeys = ctx.hotkeyManager.getRegisteredHotkeys();
        // 返回第一个非F2的热键，或默认热键
        const mainHotkey = hotkeys.find(key => key !== 'F2') || "CommandOrControl+Shift+Space";
        return mainHotkey;
      }
      return "CommandOrControl+Shift+Space";
    } catch (error) {
      ctx.logger.error("获取当前热键失败:", error);
      return "CommandOrControl+Shift+Space";
    }
  });

  // F2热键管理
  ipcMain.handle("register-f2-hotkey", (event) => {
    try {
      const senderId = event.sender.id;

      // 检查是否已经为这个发送者注册过F2热键
      if (ctx.f2RegisteredSenders.has(senderId)) {
        ctx.logger.info(`F2热键已为发送者 ${senderId} 注册过，跳过重复注册`);
        return { success: true };
      }

      if (ctx.hotkeyManager) {
        // 只有在没有任何发送者注册时才注册热键
        const isFirstRegistration = ctx.f2RegisteredSenders.size === 0;

        if (isFirstRegistration) {
          const success = ctx.hotkeyManager.registerF2DoubleClick((data) => {
            // 发送F2双击事件到所有注册的渲染进程
            ctx.logger.info("发送F2双击事件到渲染进程:", data);
            ctx.f2RegisteredSenders.forEach(id => {
              const window = require("electron").BrowserWindow.getAllWindows().find(w => w.webContents.id === id);
              if (window && !window.isDestroyed()) {
                window.webContents.send("f2-double-click", data);
              }
            });
          });

          if (!success) {
            return { success: false, error: "F2热键注册失败" };
          }
        }

        // 添加发送者到跟踪列表
        ctx.f2RegisteredSenders.add(senderId);

        // 监听窗口关闭事件，清理注册记录
        event.sender.on('destroyed', () => {
          ctx.f2RegisteredSenders.delete(senderId);
          ctx.logger.info(`清理发送者 ${senderId} 的F2热键注册记录`);

          // 如果没有发送者了，注销热键
          if (ctx.f2RegisteredSenders.size === 0) {
            ctx.hotkeyManager.unregisterHotkey('F2');
            ctx.logger.info('所有发送者都已注销，注销F2热键');
          }
        });

        return { success: true };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      ctx.logger.error("注册F2热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("unregister-f2-hotkey", (event) => {
    try {
      const senderId = event.sender.id;

      if (ctx.hotkeyManager && ctx.f2RegisteredSenders.has(senderId)) {
        ctx.f2RegisteredSenders.delete(senderId);

        // 如果没有其他发送者注册F2热键，则注销热键
        if (ctx.f2RegisteredSenders.size === 0) {
          const success = ctx.hotkeyManager.unregisterHotkey('F2');
          ctx.logger.info('所有发送者都已注销，注销F2热键');
          return { success };
        } else {
          ctx.logger.info(`发送者 ${senderId} 已注销，但还有其他发送者注册了F2热键`);
          return { success: true };
        }
      }
      return { success: false, error: "热键管理器未初始化或未注册" };
    } catch (error) {
      ctx.logger.error("注销F2热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("set-recording-state", (event, isRecording) => {
    try {
      if (ctx.hotkeyManager) {
        ctx.hotkeyManager.setRecordingState(isRecording);
        return { success: true };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      ctx.logger.error("设置录音状态失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-recording-state", () => {
    try {
      if (ctx.hotkeyManager) {
        const isRecording = ctx.hotkeyManager.getRecordingState();
        return { success: true, isRecording };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      ctx.logger.error("获取录音状态失败:", error);
      return { success: false, error: error.message };
    }
  });

  // =====================================================
  // TypeLess 模式（按住錄音）API
  // =====================================================

  // 啟用 TypeLess 模式
  ipcMain.handle("enable-typeless-mode", async (event, hotkey) => {
    try {
      if (!ctx.typelessManager) {
        return { success: false, error: "TypeLess 管理器未初始化" };
      }

      // TypeLess 使用「單擊切換」。觸發鍵預設右 Alt + 右 Ctrl,使用者可在設定頁更換
      //（issue #12:右 Alt/右 Ctrl 會跟其他軟體衝突)。從 DB 讀目前選擇,未設定則用預設。
      const triggerId = await ctx.databaseManager.getSetting('typeless_trigger', 'default');
      ctx.typelessManager.setTriggerById(triggerId);

      // 設置回調函數
      ctx.typelessManager.setCallbacks({
        onStartRecording: () => {
          // 新手教學進行中：只回報按鍵，不真的錄音（避免教學時跳出膠囊與辨識流程）
          if (ctx.windowManager?.sendToOnboarding('onboarding-key', { actionId: 'typeless-recording' })) return;
          ctx.logger.info('TypeLess: 觸發開始錄音');
          // 先儲存當前前景視窗
          try {
            const result = ctx.clipboardManager.saveForegroundWindow();
            ctx.logger.info('TypeLess: 儲存前景視窗結果:', result);
          } catch (err) {
            ctx.logger.warn('TypeLess: 儲存前景視窗失敗:', err.message);
          }
          // 顯示錄音指示器視窗
          if (ctx.windowManager) {
            ctx.windowManager.showTypelessIndicator();
          }
          // 發送開始錄音事件到渲染進程
          require("electron").BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send("typeless-start-recording");
          });
        },
        onStopRecording: () => {
          ctx.logger.info('TypeLess: 觸發停止錄音');
          // 隱藏錄音指示器視窗
          if (ctx.windowManager) {
            ctx.windowManager.hideTypelessIndicator();
          }
          // 發送停止錄音事件到渲染進程
          require("electron").BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send("typeless-stop-recording");
          });
        },
        onCancelRecording: () => {
          ctx.logger.info('TypeLess: 觸發取消錄音 (Esc)');
          // Esc 也順手停掉正在朗讀的語音（念到一半想停）：SAPI 後備殺程序 + 通知渲染端停 Edge MP3
          try { stopSpeaking(); } catch (e) { /* ignore */ }
          require("electron").BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send("tts-stop");
          });
          // 隱藏錄音指示器視窗
          if (ctx.windowManager) {
            ctx.windowManager.hideTypelessIndicator();
          }
          // 發送取消錄音事件到渲染進程（丟棄音訊、不轉錄、不貼上）
          require("electron").BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send("typeless-cancel-recording");
          });
        },
        // 連按兩下觸發鍵：在「剛講的話」與「原本複製的東西」之間切換剪貼簿。
        // 貼上流程會把使用者原本的剪貼簿還原回去，所以聽寫文字本來是拿不回來的；
        // 這個手勢就是那個補救。刻意不做成設定（九成的情況講完就沒事了）。
        onToggleClipboard: async () => {
          const swap = getClipboardSwap(ctx.logger);
          const r = await swap.swap();
          if (!r.ok) {
            // 還沒聽寫過就沒東西可切，靜靜不做事（不要彈錯誤嚇人）
            if (r.reason !== "no-dictation") {
              ctx.logger.warn('剪貼簿切換失敗:', r.reason);
              ctx.windowManager && ctx.windowManager.flashTypelessIndicator("剪貼簿被佔用，請再試一次");
            }
            return;
          }
          const msg = r.state === "dictation" ? "📋 已複製剛才的話" : "↩️ 已還原原本的內容";
          ctx.windowManager && ctx.windowManager.flashTypelessIndicator(msg);
        }
      });

      // 啟用 TypeLess 模式
      ctx.typelessManager.enable();

      return { success: true };
    } catch (error) {
      ctx.logger.error("啟用 TypeLess 模式失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 停用 TypeLess 模式
  ipcMain.handle("disable-typeless-mode", async () => {
    try {
      if (!ctx.typelessManager) {
        return { success: false, error: "TypeLess 管理器未初始化" };
      }

      ctx.typelessManager.disable();
      return { success: true };
    } catch (error) {
      ctx.logger.error("停用 TypeLess 模式失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 獲取 TypeLess 模式狀態
  ipcMain.handle("get-typeless-status", () => {
    try {
      if (!ctx.typelessManager) {
        return { success: false, error: "TypeLess 管理器未初始化" };
      }

      return {
        success: true,
        enabled: ctx.typelessManager.isEnabled,
        isKeyDown: ctx.typelessManager.isKeyDown
      };
    } catch (error) {
      ctx.logger.error("獲取 TypeLess 狀態失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 同步真實錄音狀態給 TypeLess（避免快捷鍵切換與滑鼠點擊狀態打架）
  ipcMain.handle("sync-typeless-state", (event, isRecording) => {
    try {
      if (ctx.typelessManager) {
        ctx.typelessManager.syncActiveState(isRecording);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 設定 TypeLess 觸發鍵(issue #12:可自訂,避開與其他軟體衝突)。即時生效 + 存 DB。
  ipcMain.handle("set-typeless-trigger", async (event, triggerId) => {
    try {
      if (!ctx.typelessManager) {
        return { success: false, error: "TypeLess 管理器未初始化" };
      }
      ctx.typelessManager.setTriggerById(triggerId);
      await ctx.databaseManager.setSetting('typeless_trigger', triggerId);
      return { success: true };
    } catch (error) {
      ctx.logger.error("設定 TypeLess 觸發鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 更新 TypeLess 快捷鍵
  ipcMain.handle("set-typeless-hotkey", async (event, hotkey) => {
    try {
      if (!ctx.typelessManager) {
        return { success: false, error: "TypeLess 管理器未初始化" };
      }

      ctx.typelessManager.setHotkey(hotkey);
      return { success: true };
    } catch (error) {
      ctx.logger.error("設置 TypeLess 快捷鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // =====================================================
  // 自定義快捷鍵設定 API
  // =====================================================

  // 獲取所有快捷鍵設定
  ipcMain.handle("get-hotkey-settings", async () => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }

      // 從資料庫讀取已保存的快捷鍵設定
      const savedHotkeys = await ctx.databaseManager.getSetting('custom_hotkeys', null);
      const defaultHotkeys = ctx.hotkeyManager.getDefaultHotkeys();
      const currentBindings = ctx.hotkeyManager.getHotkeyBindings();

      // 合併：預設值為基礎，已保存的設定覆蓋（確保新增的快捷鍵也會顯示）
      const mergedHotkeys = { ...defaultHotkeys, ...(savedHotkeys || {}), ...currentBindings };

      return {
        success: true,
        hotkeys: mergedHotkeys,
        defaults: defaultHotkeys,
      };
    } catch (error) {
      ctx.logger.error("獲取快捷鍵設定失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 獲取預設快捷鍵
  ipcMain.handle("get-hotkey-defaults", () => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }
      return {
        success: true,
        defaults: ctx.hotkeyManager.getDefaultHotkeys(),
      };
    } catch (error) {
      ctx.logger.error("獲取預設快捷鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 驗證快捷鍵
  ipcMain.handle("validate-hotkey", (event, accelerator, excludeActionId = null) => {
    try {
      if (!ctx.hotkeyManager) {
        return { valid: false, error: "快捷鍵管理器未初始化" };
      }
      return ctx.hotkeyManager.validateHotkey(accelerator, excludeActionId);
    } catch (error) {
      ctx.logger.error("驗證快捷鍵失敗:", error);
      return { valid: false, error: error.message };
    }
  });

  // 設置單個快捷鍵
  ipcMain.handle("set-action-hotkey", async (event, actionId, accelerator) => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }

      // 註冊新快捷鍵
      const result = ctx.hotkeyManager.registerActionHotkey(actionId, accelerator);

      if (result.success) {
        // 保存到資料庫
        const currentHotkeys = await ctx.databaseManager.getSetting('custom_hotkeys', {});
        currentHotkeys[actionId] = accelerator;
        await ctx.databaseManager.setSetting('custom_hotkeys', currentHotkeys);
        ctx.logger.info(`快捷鍵已更新: ${actionId} -> ${accelerator}`);

        // 廣播快捷鍵變更到所有視窗
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('hotkey-changed', { actionId, accelerator });
        });
      }

      return result;
    } catch (error) {
      ctx.logger.error("設置快捷鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 重設快捷鍵
  ipcMain.handle("reset-hotkeys", async (event, actionId = null) => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }

      const result = ctx.hotkeyManager.resetToDefault(actionId);

      if (result.success) {
        if (actionId) {
          // 更新資料庫中的單個快捷鍵
          const currentHotkeys = await ctx.databaseManager.getSetting('custom_hotkeys', {});
          const defaults = ctx.hotkeyManager.getDefaultHotkeys();
          currentHotkeys[actionId] = defaults[actionId];
          await ctx.databaseManager.setSetting('custom_hotkeys', currentHotkeys);
        } else {
          // 重設所有：清除自定義設定
          await ctx.databaseManager.setSetting('custom_hotkeys', null);
        }
        ctx.logger.info(`快捷鍵已重設: ${actionId || '全部'}`);
      }

      return {
        success: result.success,
        hotkeys: ctx.hotkeyManager.getDefaultHotkeys(),
      };
    } catch (error) {
      ctx.logger.error("重設快捷鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 初始化快捷鍵（從資料庫載入並註冊）
  ipcMain.handle("init-custom-hotkeys", async () => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }

      // 設置操作回調函數
      const self = ctx;

      // 開始/停止錄音
      ctx.hotkeyManager.setActionCallback('toggle-recording', (info) => {
        self.logger.info(`快捷鍵觸發: toggle-recording (${info.accelerator})`);
        // 儲存前景視窗
        try {
          self.clipboardManager.saveForegroundWindow();
        } catch (err) {
          self.logger.warn('儲存前景視窗失敗:', err.message);
        }
        // 發送事件到主視窗
        if (self.windowManager?.mainWindow && !self.windowManager.mainWindow.isDestroyed()) {
          self.windowManager.mainWindow.webContents.send("hotkey-action", { actionId: 'toggle-recording' });
          // 也發送舊的事件以保持兼容性
          self.windowManager.mainWindow.webContents.send("hotkey-triggered", { hotkey: info.accelerator });
        }
      });

      // 取消錄音
      ctx.hotkeyManager.setActionCallback('cancel-recording', (info) => {
        self.logger.info(`快捷鍵觸發: cancel-recording (${info.accelerator})`);
        if (self.windowManager?.mainWindow && !self.windowManager.mainWindow.isDestroyed()) {
          self.windowManager.mainWindow.webContents.send("hotkey-action", { actionId: 'cancel-recording' });
        }
      });

      // 顯示主視窗
      ctx.hotkeyManager.setActionCallback('show-window', (info) => {
        // 新手教學進行中：只回報「按對了」，不執行實際動作
        if (self.windowManager?.sendToOnboarding('onboarding-key', { actionId: 'show-window' })) return;
        self.logger.info(`快捷鍵觸發: show-window (${info.accelerator})`);
        if (self.windowManager?.mainWindow) {
          if (self.windowManager.mainWindow.isMinimized()) {
            self.windowManager.mainWindow.restore();
          }
          self.windowManager.mainWindow.show();
          self.windowManager.mainWindow.focus();
        }
      });

      // 複製上次結果
      // 剪貼簿繁簡轉換：不碰前景視窗，純粹讀剪貼簿 → 轉 → 寫回去。
      // 所以唯讀來源（PDF、網頁、別人的訊息）也能用，而且轉完想貼幾次貼幾次。
      for (const [actionId, target, okLabel] of [
        ['clipboard-to-traditional', 'traditional', '繁體'],
        ['clipboard-to-simplified', 'simplified', '簡體'],
      ]) {
        ctx.hotkeyManager.setActionCallback(actionId, async (info) => {
          if (self.windowManager?.sendToOnboarding('onboarding-key', { actionId })) return;
          self.logger.info(`快捷鍵觸發: ${actionId} (${info.accelerator})`);
          const flash = (msg) => self.windowManager && self.windowManager.flashTypelessIndicator(msg);
          try {
            // 轉繁體時順便套使用者的自訂字典：opencc 的 twp 覆蓋約 88% 的常見
            // IT 用語，剩下那一小撮（指令碼→腳本、程序→行程…）靠字典補，而且
            // 同一份字典聽寫時本來就在用，加一次兩邊都生效。
            const dict = (txt) => ctx.databaseManager?.applyDictionary?.(txt) ?? txt;
            const r = await convertClipboard(target, null, dict);
            if (r.ok && r.changed) {
              // 字典改了幾處一定要說出來，不然短詞條把整篇文章改到處都是會嚇到人
              return flash(`✅ 已轉成${okLabel}（${r.chars} 字${r.dictChanged ? "・含字典" : ""}）`);
            }
            if (r.ok && !r.changed) return flash(`已經是${okLabel}了`);
            if (r.reason === 'empty') return flash('剪貼簿是空的');
            if (r.reason === 'no-chinese') return flash('剪貼簿裡沒有中文');
            self.logger.warn(`剪貼簿轉換失敗: ${r.reason}`);
            flash('剪貼簿被佔用，請再試一次');
          } catch (e) {
            self.logger.error('剪貼簿轉換出錯:', e);
            flash('轉換失敗');
          }
        });
      }

      ctx.hotkeyManager.setActionCallback('copy-last', (info) => {
        // 新手教學進行中：只回報「按對了」，不執行實際動作
        if (self.windowManager?.sendToOnboarding('onboarding-key', { actionId: 'copy-last' })) return;
        self.logger.info(`快捷鍵觸發: copy-last (${info.accelerator})`);
        if (self.windowManager?.mainWindow && !self.windowManager.mainWindow.isDestroyed()) {
          self.windowManager.mainWindow.webContents.send("hotkey-action", { actionId: 'copy-last' });
        }
      });

      // 切換操作模式（語音指令）
      ctx.hotkeyManager.setActionCallback('toggle-command-mode', (info) => {
        // 新手教學進行中：只回報「按對了」，不執行實際動作
        if (self.windowManager?.sendToOnboarding('onboarding-key', { actionId: 'toggle-command-mode' })) return;
        self.logger.info(`快捷鍵觸發: toggle-command-mode (${info.accelerator})`);
        if (self.windowManager?.mainWindow && !self.windowManager.mainWindow.isDestroyed()) {
          self.windowManager.mainWindow.webContents.send("hotkey-action", { actionId: 'toggle-command-mode' });
        }
      });

      // 修改上一句：叫出大字編輯卡修正剛貼出去的那句（隨機出錯才按，不必預先開模式）
      ctx.hotkeyManager.setActionCallback('quick-edit-last', (info) => {
        // 新手教學進行中：只回報「按對了」，不執行實際動作
        if (self.windowManager?.sendToOnboarding('onboarding-key', { actionId: 'quick-edit-last' })) return;
        self.logger.info(`快捷鍵觸發: quick-edit-last (${info.accelerator})`);
        if (self.windowManager?.mainWindow && !self.windowManager.mainWindow.isDestroyed()) {
          self.windowManager.mainWindow.webContents.send("hotkey-action", { actionId: 'quick-edit-last' });
        }
      });

      // 快捷鍵速查表：主行程直接開視窗（不需要經過 renderer）
      ctx.hotkeyManager.setActionCallback('show-cheat-sheet', (info) => {
        self.logger.info(`快捷鍵觸發: show-cheat-sheet (${info.accelerator})`);
        if (self.windowManager?.sendToOnboarding('onboarding-key', { actionId: 'show-cheat-sheet' })) return;
        self.windowManager?.createCheatSheetWindow?.().catch(() => {});
      });

      // 從資料庫讀取設定，並與預設值合併（確保新增的快捷鍵也會被註冊）
      const savedHotkeys = await ctx.databaseManager.getSetting('custom_hotkeys', null);
      const defaults = ctx.hotkeyManager.getDefaultHotkeys();
      // 合併：預設值為基礎，已保存的設定覆蓋
      const hotkeyConfig = { ...defaults, ...(savedHotkeys || {}) };

      // 註冊所有快捷鍵
      // 略過已停用的錄音熱鍵：toggle-recording（已統一為 TypeLess 右 Alt）
      // 與 typeless-recording（由 TypelessManager 以 uiohook 處理，非 globalShortcut）
      const SKIP_ACTIONS = new Set(['toggle-recording', 'typeless-recording', 'cancel-recording']);
      const results = {};
      for (const [actionId, accelerator] of Object.entries(hotkeyConfig)) {
        if (SKIP_ACTIONS.has(actionId)) continue;
        results[actionId] = ctx.hotkeyManager.registerActionHotkey(actionId, accelerator);
      }

      return {
        success: true,
        hotkeys: hotkeyConfig,
        results,
      };
    } catch (error) {
      ctx.logger.error("初始化快捷鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });
};
