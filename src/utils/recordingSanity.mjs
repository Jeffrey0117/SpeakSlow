// 錄音長度自我檢查。
//
// ⛔ 為什麼需要：2026-11-07 出現過「音訊被拉長成兩倍」的 bug——使用者存的
// 麥克風 deviceId 失效時，getUserMedia 的退回路徑會在「按下停止之後」才完成，
// 留下一組沒人斷開的孤兒音訊節點；之後每次錄音都有兩組 onaudioprocess 往同一
// 個緩衝區推資料，樣本數剛好兩倍。
//
// 它最惡劣的地方是**完全無聲**：不報錯、log 乾淨、波形也沒有位元級重複
// （重採樣用線性內插，複製的區塊不再相同），使用者只看到辨識把每個字都聽成
// 疊字（「我我在在測測試」）而不知道為什麼。前後花了六分鐘的口述才被發現。
//
// 所以留這道檢查：錄到的音訊長度本來就該等於牆上時鐘走過的時間，差太多就是
// 緩衝區被重複餵了（或漏了）。寧可在 log 裡大聲叫，也不要再安靜地壞一次。

/** 超過這個倍率就視為異常（±25% 留給排程抖動與起停邊界） */
export const SANITY_MIN_RATIO = 0.75;
export const SANITY_MAX_RATIO = 1.25;

/**
 * @param {number} totalSamples 緩衝區裡的總樣本數
 * @param {number} sampleRate   取樣率（AudioContext 的）
 * @param {number} elapsedMs    從開始錄音到現在的牆上時鐘毫秒
 * @returns {{ok: boolean, ratio: number, audioSec: number, elapsedSec: number, reason?: string, message?: string}}
 */
export function checkRecordingSanity(totalSamples, sampleRate, elapsedMs) {
  const audioSec = sampleRate > 0 ? totalSamples / sampleRate : 0;
  const elapsedSec = elapsedMs / 1000;

  // 太短的錄音沒有判斷意義：起停邊界、第一個 buffer 的延遲都會造成大比例偏差
  if (elapsedSec < 1.5) {
    return { ok: true, ratio: 1, audioSec, elapsedSec, reason: "too-short" };
  }
  if (!(sampleRate > 0) || !Number.isFinite(audioSec)) {
    return { ok: false, ratio: 0, audioSec, elapsedSec, reason: "bad-rate",
      message: `取樣率異常（${sampleRate}）` };
  }

  const ratio = audioSec / elapsedSec;
  if (ratio > SANITY_MAX_RATIO) {
    return {
      ok: false, ratio, audioSec, elapsedSec, reason: "too-long",
      message:
        `錄到的音訊比實際時間長 ${ratio.toFixed(2)} 倍` +
        `（音訊 ${audioSec.toFixed(1)}s / 實際 ${elapsedSec.toFixed(1)}s）` +
        `——緩衝區可能被重複餵入（孤兒音訊節點），辨識會聽成疊字`,
    };
  }
  if (ratio < SANITY_MIN_RATIO) {
    return {
      ok: false, ratio, audioSec, elapsedSec, reason: "too-short-audio",
      message:
        `錄到的音訊只有實際時間的 ${(ratio * 100).toFixed(0)}%` +
        `（音訊 ${audioSec.toFixed(1)}s / 實際 ${elapsedSec.toFixed(1)}s）` +
        `——可能掉了音訊區塊`,
    };
  }
  return { ok: true, ratio, audioSec, elapsedSec };
}
