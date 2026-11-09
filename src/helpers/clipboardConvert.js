// 剪貼簿繁簡轉換：複製 → 按快捷鍵 → 貼上就是轉好的。
//
// 為什麼做在剪貼簿而不是「選取文字就地取代」：
// 就地取代那條路要「還原焦點 → 送 Ctrl+C → 等 → 讀 → 寫 → 送 Ctrl+V → 等」，
// 整套都在跟目標視窗搏鬥（操作模式的哨兵 bug 就住在那裡），而且唯讀來源
// （PDF、網頁、別人的訊息）貼不回去就直接失敗。
// 剪貼簿轉換完全不碰前景視窗：讀 → 轉 → 寫回去。轉完想貼幾次貼幾次。
//
// 用 twp / cn 這組 locale 而不是 tw：tw 只做字級轉換，「软件」會變成「軟件」
// 而不是「軟體」。實測對照（2026-11-09）：
//   cn→tw   這個軟件的質量很好，我在臺灣用鼠標和硬盤，打印機也不錯
//   cn→twp  這個軟體的質量很好，我在臺灣用滑鼠和硬碟，印表機也不錯  ← 要這個
// 反方向同理：tw→cn 會把「滑鼠／硬碟／印表機」原封不動留給對岸讀者看。

const OpenCC = require("opencc-js");

// 轉換器建立一次就重複用（每次 Converter() 都要載字典，不便宜）
let _toTrad = null;
let _toSimp = null;
function converter(target) {
  if (target === "simplified") {
    if (!_toSimp) _toSimp = OpenCC.Converter({ from: "twp", to: "cn" });
    return _toSimp;
  }
  if (!_toTrad) _toTrad = OpenCC.Converter({ from: "cn", to: "twp" });
  return _toTrad;
}

const CJK = /[㐀-䶿一-鿿豈-﫿]/;

/**
 * 純轉換：不碰剪貼簿，方便測試。
 * @param {string} text
 * @param {"traditional"|"simplified"} target
 * @returns {{ok: boolean, text?: string, changed?: boolean, reason?: string}}
 */
function convertText(text, target) {
  if (typeof text !== "string" || text === "") {
    return { ok: false, reason: "empty" };
  }
  if (!CJK.test(text)) {
    // 純英文／數字／程式碼：轉了也不會變，但要明確告訴使用者「不是壞掉，是沒中文」
    return { ok: false, reason: "no-chinese" };
  }
  let out;
  try {
    out = converter(target)(text);
  } catch (e) {
    return { ok: false, reason: "convert-failed" };
  }
  return { ok: true, text: out, changed: out !== text };
}

/**
 * 讀剪貼簿 → 轉換 → 套自訂字典 → 寫回剪貼簿。
 *
 * 字典只在「轉繁體」時套用。opencc 的 twp 字典覆蓋約 88% 的常見 IT 用語
 * （實測 2026-11-09：U盘→隨身碟、内存→記憶體、数组→陣列… 46/52），
 * 剩下那一小撮要靠使用者自己補，而且有兩個是 opencc 判斷可議：
 *   脚本 → 指令碼（台灣開發者說「腳本」）
 *   进程 → 程序  （「程序」在台灣是 program，應該是「行程」）
 * 使用者在設定頁的字典加一條「指令碼→腳本」，聽寫跟這裡就都會生效。
 *
 * 轉簡體刻意不套字典：那份字典是為了得到台灣用語而存在的，往反方向套會自己
 * 打自己（剛簡化完的詞又被改回台灣說法）。
 *
 * @param {"traditional"|"simplified"} target
 * @param {{readText: function, writeText: function}} io 預設用 clipboardText
 * @param {function(string): string} [dict] 自訂字典替換（只用於 traditional）
 * @returns {Promise<{ok, changed?, reason?, chars?, dictChanged?}>}
 */
async function convertClipboard(target, io = null, dict = null) {
  const cb = io || require("./clipboardText");
  let current;
  try {
    current = await cb.readText();
  } catch (e) {
    return { ok: false, reason: "read-failed" };
  }
  const r = convertText(current, target);
  if (!r.ok) return r;

  let out = r.text;
  let dictChanged = false;
  if (target === "traditional" && typeof dict === "function") {
    try {
      const afterDict = dict(out);
      if (typeof afterDict === "string" && afterDict !== out) {
        dictChanged = true;
        out = afterDict;
      }
    } catch (e) {
      // 字典壞掉不該讓轉換整個失敗——至少把 opencc 的結果給使用者
    }
  }

  if (out === current) {
    // 已經是目標字體、字典也沒動到：不用寫，也別假裝有做事
    return { ok: true, changed: false, chars: [...current].length };
  }
  const wrote = await cb.writeText(out);
  if (!wrote) return { ok: false, reason: "write-failed" };
  return { ok: true, changed: true, chars: [...out].length, dictChanged };
}

module.exports = { convertText, convertClipboard };
