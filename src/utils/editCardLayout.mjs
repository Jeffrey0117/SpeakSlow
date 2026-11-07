// 快速修改卡的版面計算：字少就放超大字、卡片跟著縮；字多才縮小字級、卡片長高。
//
// 固定大框配小字會有兩個問題：一是短句時一大片空白很醜，二是看起來像多行輸入框，
// 讓人以為 Enter 是換行——但這張卡的 Enter 是「確認取代」。

const HEADER_H = 56;   // 標題列
const FOOTER_H = 68;   // 按鈕列
const PAD_V = 28;      // 文字區上下留白合計
const PAD_H = 72;      // 文字區左右留白合計
const LINE_RATIO = 1.5; // 行高倍率

// 字數 → 字級。短句給到超大，長段落才降下來。
const TIERS = [
  { max: 8, size: 46 },
  { max: 18, size: 38 },
  { max: 36, size: 31 },
  { max: 70, size: 26 },
  { max: 140, size: 22 },
  { max: Infinity, size: 19 },
];

export function pickFontSize(charCount) {
  return TIERS.find((t) => charCount <= t.max).size;
}

/**
 * 依文字內容算出卡片應有的字級與視窗尺寸。
 * @param {string} text 卡片內目前的文字
 * @param {{maxWidth?: number, maxHeight?: number}} [limits] 可用空間上限
 * @returns {{fontSize: number, width: number, height: number, lines: number}}
 */
export function computeEditCardLayout(text, limits = {}) {
  const maxWidth = limits.maxWidth ?? 900;
  const maxHeight = limits.maxHeight ?? 700;

  const raw = typeof text === "string" ? text : "";
  const chars = Array.from(raw);
  const fontSize = pickFontSize(chars.length);

  // 寬度：讓短句不要被拉成一條細長線，也不要超過上限。
  // 估算一行約 fontSize 寬（中文全形），加上左右留白。
  const idealWidth = chars.length * fontSize + PAD_H;
  const width = Math.round(Math.min(maxWidth, Math.max(520, idealWidth)));

  // 依實際寬度回推每行可容納字數，再算總行數（含使用者自己按的換行）
  const perLine = Math.max(6, Math.floor((width - PAD_H) / fontSize));
  const lines = raw.split("\n").reduce((sum, line) => {
    const n = Array.from(line).length;
    return sum + Math.max(1, Math.ceil(n / perLine));
  }, 0);

  const textHeight = Math.round(lines * fontSize * LINE_RATIO);
  const height = Math.round(
    Math.min(maxHeight, Math.max(180, HEADER_H + PAD_V + textHeight + FOOTER_H))
  );

  return { fontSize, width, height, lines };
}
