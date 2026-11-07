// 拆字描述解析：把「北方的北，爛掉的爛」還原成「北爛」。
//
// 同音字是辨識最常出錯的地方，而出錯時使用者沒辦法「用講的」講清楚要哪個字，
// 只能唸出習慣的拆字說法。這支程式把那種說法還原成實際字串。
//
// 規則：依標點切段，每段取 `X的Y` 的 Y（單一字元），並要求 Y 必須出現在 X 裡
// （「北方的北」✓、「我的家」✗）。**所有**段落都通過才視為拆字描述；
// 只要有一段不像，就整句當普通文字，避免把正常說話誤拆
// （「我去台灣的台北」不該變成「台北」）。

const SEGMENT_SPLIT = /[，,、。．.；;\s]+/;

// 一段拆字描述：前面是提示詞、後面是要的那個字。
// 允許「的」前面 1-6 字（北方／爛掉／一二三／ABC 都可能），後面剛好 1 個字。
// 用 Array.from 計算長度，避免 emoji/罕用字（代理對）被當成兩個字。
function extractChar(segment) {
  const idx = segment.lastIndexOf("的");
  if (idx <= 0) return null; // 沒有「的」，或「的」開頭（沒有提示詞）
  const hint = segment.slice(0, idx);
  const target = segment.slice(idx + 1);
  const targetChars = Array.from(target);
  if (targetChars.length !== 1) return null; // 「的」後面不是剛好一個字
  const hintChars = Array.from(hint);
  if (hintChars.length < 1 || hintChars.length > 6) return null;
  // 關鍵驗證：要的那個字必須真的出現在提示詞裡，否則就是普通句子
  if (!hint.includes(target)) return null;
  return target;
}

/**
 * 嘗試把一段話當成拆字描述解析。
 * @param {string} text 辨識結果，例如「北方的北，爛掉的爛」
 * @returns {string|null} 解析出的字串（「北爛」），不像拆字描述則回傳 null
 */
export function parseSpellOut(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const segments = trimmed.split(SEGMENT_SPLIT).filter(Boolean);
  // 至少要有一段；單段也支援（「爛掉的爛」→「爛」）
  if (segments.length === 0) return null;

  const chars = [];
  for (const seg of segments) {
    const ch = extractChar(seg);
    if (ch === null) return null; // 有一段不像 → 整句不是拆字描述
    chars.push(ch);
  }
  return chars.join("");
}
