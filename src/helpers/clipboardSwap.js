// 剪貼簿雙向切換。
//
// 背景：聽寫貼上時，clipboard.js 會先存下使用者原本複製的東西、寫入聽寫文字、
// 按 Ctrl+V，然後把原本的內容還原回去，所以使用者複製的東西不會被吃掉。
// （注意：這個還原在 2026-11-07 之前其實是壞的——Electron 45 把剪貼簿 API 改成
// 非同步，舊的同步寫法讓還原整段靜默不執行；詳見 clipboardText.js。）
// 代價是「剛講的那段話」貼完就從剪貼簿消失，想再貼到第二個地方就沒了。
//
// 這支模組記住那兩份內容，讓使用者連按兩下觸發鍵就能在兩者之間來回切換。
// 不做成設定：九成的情況講完就貼完沒事了，每次跳選擇只是在收過路費；
// 這是一個事後補救的手勢，不用的時候完全不存在。

const STATE_USER = "user";
const STATE_DICTATION = "dictation";

class ClipboardSwap {
  /**
   * @param {object} io 注入剪貼簿讀寫，方便測試（預設用 electron 的 clipboard）
   */
  constructor(io = null, logger = null) {
    this.io = io || null;
    this.logger = logger;
    this.dictation = null; // 最近一次聽寫貼上的文字
    this.userText = null; // 聽寫前使用者剪貼簿裡的內容
    this.state = STATE_USER; // 目前剪貼簿上放的是哪一份
  }

  _clipboard() {
    if (this.io) return this.io;
    // clipboardText 會處理「Electron 45 的剪貼簿是非同步」這件事，
    // 兩種 API 都吃得下（延遲 require，測試環境不需要 electron）
    return require("./clipboardText");
  }

  _log(msg) {
    try {
      this.logger && this.logger.info && this.logger.info(msg);
    } catch (e) {
      /* 記 log 不該弄壞功能 */
    }
  }

  /**
   * 一次聽寫貼上完成後呼叫。
   * @param {string} dictation 貼出去的聽寫文字
   * @param {string} previous  聽寫前使用者剪貼簿的內容
   * @param {string} startingState 貼完後剪貼簿實際上放的是哪一份
   *   （"dictation"＝留聽寫文字沒還原；"user"＝已還原成使用者原本的內容）
   *   這個一定要跟貼上流程的實際行為一致，否則第一次連按兩下會切錯方向。
   */
  remember(dictation, previous, startingState = STATE_USER) {
    if (typeof dictation !== "string" || !dictation.trim()) return;
    this.dictation = dictation;
    this.userText = typeof previous === "string" ? previous : "";
    this.state = startingState === STATE_DICTATION ? STATE_DICTATION : STATE_USER;
  }

  /** 有沒有東西可以切（還沒聽寫過就沒有） */
  canSwap() {
    return typeof this.dictation === "string" && this.dictation.length > 0;
  }

  /**
   * 在「剛講的話」與「原本複製的東西」之間切換。
   * @returns {{ok: boolean, state?: string, reason?: string}}
   */
  async swap() {
    if (!this.canSwap()) return { ok: false, reason: "no-dictation" };

    const cb = this._clipboard();
    let current;
    try {
      current = await cb.readText();
    } catch (e) {
      return { ok: false, reason: "read-failed" };
    }
    if (typeof current !== "string") current = "";

    try {
      let wrote;
      if (current === this.dictation) {
        // 目前是聽寫文字 → 換回使用者原本的
        wrote = await cb.writeText(this.userText || "");
        if (wrote === false) return { ok: false, reason: "write-failed" };
        this.state = STATE_USER;
      } else {
        // 關鍵安全點：使用者可能在聽寫之後又複製了別的東西。
        // 那份比我們記的 userText 更新，直接蓋掉就是在毀掉他剛複製的內容——
        // 所以先把它收進 userText，切回來時才還得出去。
        const previousUserText = this.userText;
        if (current !== this.userText) {
          this.userText = current;
          this._log("剪貼簿切換：偵測到聽寫後有新的複製內容，已改記這一份");
        }
        wrote = await cb.writeText(this.dictation);
        if (wrote === false) {
          // 寫失敗就把記錄還原，不要留下「記了新的但剪貼簿沒變」的錯位狀態
          this.userText = previousUserText;
          return { ok: false, reason: "write-failed" };
        }
        this.state = STATE_DICTATION;
      }
    } catch (e) {
      return { ok: false, reason: "write-failed" };
    }

    this._log(
      this.state === STATE_DICTATION
        ? "剪貼簿切換：現在是剛講的話"
        : "剪貼簿切換：現在是原本複製的內容"
    );
    return { ok: true, state: this.state };
  }

  /** 忘掉記住的內容（例如清空歷史時） */
  reset() {
    this.dictation = null;
    this.userText = null;
    this.state = STATE_USER;
  }
}

// 全程序共用一份：貼上流程（clipboard.js）負責記，手勢（ipc/hotkeys.js）負責切
let shared = null;
function getShared(logger = null) {
  if (!shared) shared = new ClipboardSwap(null, logger);
  else if (logger && !shared.logger) shared.logger = logger;
  return shared;
}

module.exports = { ClipboardSwap, getShared, STATE_USER, STATE_DICTATION };
