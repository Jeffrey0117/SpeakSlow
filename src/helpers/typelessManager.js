/**
 * TypeLess 模式管理器
 * 實現「按住說話」功能：按住快捷鍵開始錄音，放開停止錄音
 */

const { uIOhook, UiohookKey } = require('uiohook-napi');

// 可選的「單擊切換」觸發鍵(issue #12:右 Alt/右 Ctrl 會跟其他軟體衝突,讓使用者換)。
// 只收「不會在正常打字時誤觸」的鍵:右側修飾鍵 + 功能鍵。刻意不放左 Ctrl/Alt/Shift,
// 那些單擊也會在日常快捷鍵/打大寫時觸發。
const TYPELESS_TRIGGER_PRESETS = {
  default: [UiohookKey.AltRight, UiohookKey.CtrlRight],
  ctrlRight: [UiohookKey.CtrlRight],
  altRight: [UiohookKey.AltRight],
  f8: [UiohookKey.F8],
  f9: [UiohookKey.F9],
  f10: [UiohookKey.F10],
};

class TypelessManager {
  constructor(logger = null) {
    this.logger = logger;
    this.isEnabled = false;
    this.isKeyDown = false;
    // 觸發鍵（單擊切換）：右 Alt + 右 Ctrl 都可。
    // 在瀏覽器裡用右 Ctrl 可避開「右 Alt 放開觸發選單列」的衝突。
    this.triggerKeys = [UiohookKey.AltRight, UiohookKey.CtrlRight];
    this.modifiers = {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false
    };
    // 操作模式：'toggle' 單擊切換（按一下開始、再按一下停止）| 'hold' 按住說話
    this.mode = 'toggle';
    this.isActive = false;   // toggle 模式：目前是否正在錄音
    this.triggerHeld = false; // 防止長按時的自動重複觸發
    this.lastKeyDownTime = 0; // 上次觸發鍵 keydown 的時間（解「漏接 keyup」卡死用）
    this._macAxTimer = null;  // Mac：等「輔助使用」授權的輪詢 timer

    // 連按兩下觸發鍵 = 切換剪貼簿（剛講的話 ⇄ 原本複製的東西）。
    // 兩個門檻刻意分開：doubleTapWindow 是「兩下之間」的間隔，
    // tapMaxHoldMs 是「一下按多久還算點按」——單一音節大約 200~300ms，
    // 所以設 200ms 以下才當成「不可能有語音」。
    this.doubleTapWindow = 450;
    this.tapMaxHoldMs = 200;
    this.activeSince = 0;      // 切換模式：這次錄音是什麼時候開始的
    this.keyDownAt = 0;        // 按住模式：這次按下的時間
    this.lastShortTapAt = 0;   // 按住模式：上一次「過短點按」的時間

    // 回調函數
    this.onStartRecording = null;
    this.onStopRecording = null;
    this.onCancelRecording = null;
    this.onToggleClipboard = null;

    // 綁定事件處理器
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
  }

  /**
   * 設置回調函數
   */
  setCallbacks({ onStartRecording, onStopRecording, onCancelRecording, onToggleClipboard }) {
    this.onStartRecording = onStartRecording;
    this.onStopRecording = onStopRecording;
    this.onCancelRecording = onCancelRecording;
    if (onToggleClipboard) this.onToggleClipboard = onToggleClipboard;
    this.safeLog('info', 'TypeLess 回調函數已設置');
  }

  /**
   * 檢查修飾鍵是否匹配
   */
  checkModifiers(event) {
    const ctrlMatch = this.modifiers.ctrl === (event.ctrlKey || false);
    const shiftMatch = this.modifiers.shift === (event.shiftKey || false);
    const altMatch = this.modifiers.alt === (event.altKey || false);
    const metaMatch = this.modifiers.meta === (event.metaKey || false);

    return ctrlMatch && shiftMatch && altMatch && metaMatch;
  }

  /**
   * 處理按鍵按下事件
   */
  handleKeyDown(event) {
    if (!this.isEnabled) return;

    // 按 Esc → 取消錄音 + 強制收掉指示器藥丸。切換 / 按住兩種模式都支援，
    // 讓你「按住講到一半發現講錯」也能鬼切。且就算錄音狀態已脫鉤（藥丸卡成孤兒），
    // Esc 也一律呼叫 onCancelRecording 把藥丸關掉（渲染端沒在錄音則為無害 no-op）。
    if (event.keycode === UiohookKey.Escape) {
      const wasRecording = this.isActive || this.isKeyDown;
      this.isActive = false;
      this.isKeyDown = false;
      this.triggerHeld = false;
      if (wasRecording) this.safeLog('info', 'TypeLess: 取消錄音 (Esc)');
      if (this.onCancelRecording) this.onCancelRecording();
      return;
    }

    if (!this.triggerKeys.includes(event.keycode)) return;

    const now = Date.now();

    if (this.mode === 'toggle') {
      // 單擊切換：忽略長按造成的自動重複（keydown 會連續觸發）。
      // 但「靠 keyup 清 triggerHeld」在高負載/錄影時 keyup 會被吞掉，
      // 導致 triggerHeld 永遠卡 true、之後按右 Ctrl 全無反應（真實踩過的雷）。
      // 解法：自動重複的 keydown 間隔極短（~30ms）；若距離上次 keydown 已超過
      // 門檻，代表上一次的 keyup 漏接了 → 視為新的一次按下，強制解卡。
      const gap = now - this.lastKeyDownTime;
      this.lastKeyDownTime = now;
      if (this.triggerHeld && gap < 600) return; // 真的是長按自動重複，忽略
      this.triggerHeld = true;

      // 連按兩下 = 切換剪貼簿。這個手勢不會搶走任何有用的操作：在切換模式下
      // 「按一下開始、馬上再按一下停止」產出的是一段不可能有語音的空錄音，
      // 原本只會跳「錄音太短」，所以順手把它取消掉反而是改善。
      // 條件綁在 activeSince 上（而不是只看兩下的間隔），這樣「講完停止、
      // 立刻再按一下開始新的一段」不會被誤判成手勢。
      if (this.isActive && now - this.activeSince <= this.doubleTapWindow) {
        this.isActive = false;
        this.triggerHeld = false;
        this.safeLog('info', 'TypeLess(切換): 連按兩下 → 切換剪貼簿');
        if (this.onCancelRecording) this.onCancelRecording();
        if (this.onToggleClipboard) this.onToggleClipboard();
        return;
      }

      this.isActive = !this.isActive;
      if (this.isActive) {
        this.activeSince = now;
        this.safeLog('info', 'TypeLess(切換): 開始錄音');
        if (this.onStartRecording) this.onStartRecording();
      } else {
        this.safeLog('info', 'TypeLess(切換): 停止錄音');
        if (this.onStopRecording) this.onStopRecording();
      }
      return;
    }

    // hold 模式：按住說話（需檢查修飾鍵）
    if (this.checkModifiers(event)) {
      // 連按兩下（兩次都是極短的點按）= 切換剪貼簿
      if (this.lastShortTapAt && now - this.lastShortTapAt <= this.doubleTapWindow) {
        this.lastShortTapAt = 0;
        this.safeLog('info', 'TypeLess(按住): 連按兩下 → 切換剪貼簿');
        if (this.onToggleClipboard) this.onToggleClipboard();
        return;
      }
      if (!this.isKeyDown) {
        this.isKeyDown = true;
        this.keyDownAt = now;
        this.safeLog('info', 'TypeLess: 開始錄音 (keydown)');
        if (this.onStartRecording) this.onStartRecording();
      }
    }
  }

  /**
   * 處理按鍵放開事件
   */
  handleKeyUp(event) {
    if (!this.isEnabled) return;
    if (!this.triggerKeys.includes(event.keycode)) return;

    // 放開觸發鍵：解除長按鎖定
    this.triggerHeld = false;

    // hold 模式才在放開時停止錄音；toggle 模式由再次按下控制
    if (this.mode === 'hold' && this.isKeyDown) {
      this.isKeyDown = false;
      const held = Date.now() - this.keyDownAt;

      // 極短的點按不可能含語音（單一音節都要 200ms 以上）。原本會送去轉錄、
      // 換來一個「錄音太短」的錯誤；現在直接丟掉，並記下時間——緊接著再點
      // 一下就是「切換剪貼簿」的手勢。
      if (this.keyDownAt && held <= this.tapMaxHoldMs) {
        this.lastShortTapAt = Date.now();
        this.safeLog('info', `TypeLess(按住): 點按 ${held}ms 過短，不轉錄`);
        if (this.onCancelRecording) this.onCancelRecording();
        return;
      }

      this.lastShortTapAt = 0;
      this.safeLog('info', 'TypeLess: 停止錄音 (keyup)');
      if (this.onStopRecording) this.onStopRecording();
    }
  }

  /**
   * 啟用 TypeLess 模式
   */
  enable() {
    if (this.isEnabled) {
      this.safeLog('warn', 'TypeLess 模式已經啟用');
      return;
    }

    // Mac：沒有「輔助使用」(Accessibility) 權限就呼叫 uIOhook.start() 會「原生崩潰」
    // （segfault，try/catch 攔不住）→ 一啟動就掛、自動重開又掛 → crash-loop。
    // 先檢查；沒權限就提示 + 輪詢，等使用者授權後再真的啟動全域熱鍵。
    if (process.platform === 'darwin' && !this._hasMacAccessibility()) {
      this.safeLog('warn', 'Mac 尚未授權「輔助使用」，待授權後再啟動全域熱鍵（避免崩潰）');
      this._promptMacAccessibility();
      this._waitMacAccessibilityThenEnable();
      return;
    }

    try {
      // 註冊事件監聽器
      uIOhook.on('keydown', this.handleKeyDown);
      uIOhook.on('keyup', this.handleKeyUp);

      // 啟動監聽
      uIOhook.start();

      this.isEnabled = true;
      this.safeLog('info', 'TypeLess 模式已啟用');
    } catch (error) {
      // 不再 throw：啟用全域熱鍵失敗不該讓整個 app 崩潰
      this.safeLog('error', 'TypeLess 模式啟用失敗', error);
    }
  }

  // Mac：是否已取得「輔助使用」權限。非 Mac / API 不存在 → 視為 OK（照舊行為）。
  _hasMacAccessibility() {
    try {
      const { systemPreferences } = require('electron');
      if (typeof systemPreferences.isTrustedAccessibilityClient !== 'function') return true;
      return systemPreferences.isTrustedAccessibilityClient(false);
    } catch (e) {
      return true;
    }
  }
  _promptMacAccessibility() {
    try {
      const { systemPreferences } = require('electron');
      systemPreferences.isTrustedAccessibilityClient(true); // 跳系統授權對話框
    } catch (e) { /* ignore */ }
  }
  _waitMacAccessibilityThenEnable() {
    if (this._macAxTimer) return;
    this._macAxTimer = setInterval(() => {
      if (this._hasMacAccessibility()) {
        clearInterval(this._macAxTimer);
        this._macAxTimer = null;
        this.enable(); // 拿到權限 → 正式啟動
      }
    }, 1500);
  }

  /**
   * 停用 TypeLess 模式
   */
  disable() {
    if (this._macAxTimer) {
      clearInterval(this._macAxTimer);
      this._macAxTimer = null;
    }
    if (!this.isEnabled) {
      return;
    }

    try {
      // 移除事件監聽器
      uIOhook.off('keydown', this.handleKeyDown);
      uIOhook.off('keyup', this.handleKeyUp);

      // 停止監聽
      uIOhook.stop();

      this.isEnabled = false;
      this.isKeyDown = false;
      this.isActive = false;
      this.triggerHeld = false;
      this.safeLog('info', 'TypeLess 模式已停用');
    } catch (error) {
      this.safeLog('error', 'TypeLess 模式停用失敗', error);
    }
  }

  /**
   * 由渲染層同步「真實錄音狀態」。
   * 因為錄音可由右 Alt 或滑鼠點擊麥克風按鈕觸發/停止，
   * 若 isActive 與實際狀態脫鉤，下次按右 Alt 會 off-by-one（切換方向相反）。
   * 每當渲染層錄音狀態改變就呼叫此方法，保持一致。
   */
  syncActiveState(isRecording) {
    this.isActive = !!isRecording;
  }

  /**
   * 設定為「右 Alt 單擊切換」模式（TypeLess 預設）
   */
  setRightAltToggle() {
    this.triggerKeys = [UiohookKey.AltRight, UiohookKey.CtrlRight];
    this.modifiers = { ctrl: false, shift: false, alt: false, meta: false };
    this.mode = 'toggle';
    this.isActive = false;
    this.triggerHeld = false;
    this.safeLog('info', 'TypeLess 設定為「右 Alt / 右 Ctrl 單擊切換」', {
      triggerKeys: this.triggerKeys,
    });
  }

  /**
   * 依預設 id 設定「單擊切換」觸發鍵(issue #12:可自訂,避開與其他軟體衝突）。
   * 未知 id 退回預設(右 Alt + 右 Ctrl)。即時生效,不需重新 enable。
   */
  setTriggerById(id) {
    const keys = TYPELESS_TRIGGER_PRESETS[id] || TYPELESS_TRIGGER_PRESETS.default;
    this.triggerKeys = keys;
    this.modifiers = { ctrl: false, shift: false, alt: false, meta: false };
    this.mode = 'toggle';
    this.isActive = false;
    this.triggerHeld = false;
    this.safeLog('info', `TypeLess 觸發鍵設為「${id}」`, { triggerKeys: keys });
  }

  /**
   * 設置觸發快捷鍵
   * @param {string} accelerator - Electron 格式的快捷鍵，如 "CommandOrControl+Shift+Space"
   */
  setHotkey(accelerator) {
    const keyMap = {
      'Space': UiohookKey.Space,
      'Enter': UiohookKey.Enter,
      'Tab': UiohookKey.Tab,
      'Backspace': UiohookKey.Backspace,
      'F1': UiohookKey.F1,
      'F2': UiohookKey.F2,
      'F3': UiohookKey.F3,
      'F4': UiohookKey.F4,
      'F5': UiohookKey.F5,
      'F6': UiohookKey.F6,
      'F7': UiohookKey.F7,
      'F8': UiohookKey.F8,
      'F9': UiohookKey.F9,
      'F10': UiohookKey.F10,
      'F11': UiohookKey.F11,
      'F12': UiohookKey.F12,
    };

    // 解析快捷鍵
    const parts = accelerator.split('+');
    const modifiers = {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false
    };

    let triggerKey = null;

    for (const part of parts) {
      const normalizedPart = part.trim();

      if (normalizedPart === 'CommandOrControl' || normalizedPart === 'Ctrl' || normalizedPart === 'Control') {
        modifiers.ctrl = true;
      } else if (normalizedPart === 'Shift') {
        modifiers.shift = true;
      } else if (normalizedPart === 'Alt') {
        modifiers.alt = true;
      } else if (normalizedPart === 'Meta' || normalizedPart === 'Command' || normalizedPart === 'Cmd') {
        modifiers.meta = true;
      } else {
        // 這是觸發鍵
        triggerKey = keyMap[normalizedPart];
        if (!triggerKey && normalizedPart.length === 1) {
          // 單個字母
          triggerKey = normalizedPart.toUpperCase().charCodeAt(0);
        }
      }
    }

    if (triggerKey) {
      this.triggerKeys = [triggerKey];
      this.modifiers = modifiers;
      this.safeLog('info', `TypeLess 快捷鍵已設置: ${accelerator}`, { triggerKey, modifiers });
    } else {
      this.safeLog('warn', `無法解析快捷鍵: ${accelerator}`);
    }
  }

  /**
   * 安全日誌記錄
   */
  safeLog(level, message, data = null) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](message, data);
    } else {
      console[level](`[TypelessManager] ${message}`, data || '');
    }
  }

  /**
   * 清理資源
   */
  cleanup() {
    this.disable();
    this.onStartRecording = null;
    this.onStopRecording = null;
    this.onCancelRecording = null;
  }
}

module.exports = { TypelessManager };
