// 拆字描述解析：把「北方的北，爛掉的爛」還原成「北爛」。
//
// 同音字是辨識最常出錯的地方，而出錯時使用者沒辦法「用講的」講清楚要哪個字，
// 只能唸出習慣的拆字說法。這支程式把那種說法還原成實際字串。
//
// 規則：依標點切段，每段取 `X的Y` 的 Y（單一字元），並要求 Y 必須出現在 X 裡
// （「北方的北」✓、「我的家」✗）。**所有**段落都通過才視為拆字描述；
// 只要有一段不像，就整句當普通文字，避免把正常說話誤拆
// （「我去台灣的台北」不該變成「台北」）。

// 標點一律先去掉再解析：辨識結果不保證有斷句，
// 實測「北方的北，爛掉的爛」出來常是「北方的北爛掉的爛。」（無逗號、尾端帶句號）。
const PUNCT = /[，,、。．.；;：:！!？?\s]+/g;

const MAX_HINT = 6; // 提示詞超過 6 字比較像在講話，不像拆字

/**
 * 嘗試把一段話當成拆字描述解析。
 *
 * 逐一掃描字串裡每個「提示詞 + 的 + 目標字」，而不是只看最後一個「的」——
 * 沒有標點時整串是連著的（北方的北爛掉的爛），只取最後一組會只拿到「爛」。
 * 掃完必須剛好用完整個字串：有剩字代表那是普通句子（「我去台灣的台北」→ 不解析）。
 *
 * @param {string} text 辨識結果，例如「北方的北爛掉的爛。」
 * @returns {string|null} 解析出的字串（「北爛」），不像拆字描述則回傳 null
 */
export function parseSpellOut(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(PUNCT, "");
  if (!cleaned) return null;

  // 用碼位陣列處理，避免罕用字（代理對）被當成兩個字元
  const chars = Array.from(cleaned);
  const out = [];
  let i = 0;

  while (i < chars.length) {
    const deIdx = chars.indexOf("的", i);
    if (deIdx === -1) return null; // 還有字卻沒有「的」→ 不是拆字描述
    const hint = chars.slice(i, deIdx);
    const target = chars[deIdx + 1];
    if (!target) return null; // 「的」結尾，沒有目標字
    if (hint.length < 1 || hint.length > MAX_HINT) return null;
    // 關鍵驗證：要的那個字必須真的出現在提示詞裡，否則就是普通句子
    if (!hint.includes(target)) return null;
    out.push(target);
    i = deIdx + 2;
  }

  return out.length ? out.join("") : null;
}
