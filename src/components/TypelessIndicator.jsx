import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";

// 波形條的相對高度：中間高、兩側低，看起來像音量計而不是一排等高方塊
const BAR_SHAPE = [0.55, 0.8, 1, 0.8, 0.55];
const BAR_MIN_H = 4;
const BAR_MAX_H = 20;

/**
 * TypeLess 錄音指示器組件（講話時跳出來的「藥丸」）
 * 一般聽寫：紅色「錄音中」。
 * 操作模式：淺藍 + 虛線框 +「聽指令」，一眼分辨你是在下指令而非聽寫。
 * 右側波形條顯示「實際收到的音量」——不必再猜要離麥克風多近、要講多大聲；
 * 音量過大（削波）時轉為琥珀色提醒。
 */
const TypelessIndicator = () => {
  const { t } = useTranslation();
  const [commandMode, setCommandMode] = useState(false);
  const [level, setLevel] = useState(0);
  const [clipping, setClipping] = useState(false);
  const clipTimerRef = useRef(null);

  // 操作模式狀態由主行程廣播（主視窗 toggle / 指示器顯示時推送）
  useEffect(() => {
    let unsub = null;
    window.electronAPI
      ?.getCommandMode?.()
      .then((v) => { if (typeof v === "boolean") setCommandMode(v); })
      .catch(() => {});
    unsub = window.electronAPI?.onCommandModeChanged?.((v) => setCommandMode(!!v));
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);

  // 即時音量（主面板每 ~80ms 推一次；CSS transition 補成連續動畫）
  useEffect(() => {
    const unsub = window.electronAPI?.onMicLevel?.((data) => {
      setLevel(Math.max(0, Math.min(1, Number(data?.level) || 0)));
      if (data?.clipping) {
        setClipping(true);
        // 削波提示停留一下再消失，避免瞬間爆音閃一下看不到
        if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
        clipTimerRef.current = setTimeout(() => setClipping(false), 600);
      }
    });
    return () => {
      if (typeof unsub === "function") unsub();
      if (clipTimerRef.current) clearTimeout(clipTimerRef.current);
    };
  }, []);

  const barColor = clipping ? "bg-amber-300" : "bg-white/85";

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div
        className={`pill-bounce backdrop-blur-sm rounded-full px-5 py-2 flex items-center gap-2.5 ${
          commandMode
            ? "bg-sky-400 border border-sky-300/60"
            : "bg-red-500 border border-red-400/60"
        }`}
      >
        {/* 靜止白點（不跳動）*/}
        <div className="w-3 h-3 bg-white rounded-full" />

        {/* 文字 */}
        <span className="text-white font-semibold text-[15px] whitespace-nowrap tracking-wide">
          {commandMode ? t("panel.commandListening") : t("panel.recordingIndicator")}
        </span>

        {/* 音量波形：高度由實際收音大小決定（不是裝飾動畫）*/}
        <div className="flex items-center gap-0.5 h-5">
          {BAR_SHAPE.map((shape, i) => (
            <div
              key={i}
              className={`w-1 rounded-full ${barColor}`}
              style={{
                height: `${BAR_MIN_H + (BAR_MAX_H - BAR_MIN_H) * level * shape}px`,
                transition: "height 80ms linear, background-color 120ms linear",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default TypelessIndicator;
