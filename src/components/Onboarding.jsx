import React, { useEffect, useRef, useState } from "react";
import { Check, SkipForward, Sparkles } from "lucide-react";
import { useTranslation } from "../i18n";

/**
 * 新手教學：全螢幕沉浸式導覽，一步教一個快捷鍵。
 *
 * 關鍵設計：**要真的按下去才過關**。只用看的記不住——這個 app 的快捷鍵不少
 * （錄音、取消、操作模式、快速修改、複製上次），寫在文件裡等於沒寫。
 * 教學期間主行程會攔下這些快捷鍵（不執行實際動作），只回報「按對了」。
 */

// 把 Electron accelerator 轉成好讀的按鍵塊："CommandOrControl+Shift+E" → ["Ctrl","Shift","E"]
function splitKeys(accelerator) {
  if (!accelerator) return [];
  return accelerator
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/CmdOrCtrl/gi, "Ctrl")
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);
}

const Kbd = ({ children, lit }) => (
  <kbd
    className={`inline-flex items-center justify-center min-w-[64px] px-5 py-3 rounded-xl text-2xl font-semibold border-b-4 transition-all duration-200 ${
      lit
        ? "bg-emerald-500 border-emerald-700 text-white scale-105 shadow-lg shadow-emerald-500/40"
        : "bg-white/95 border-gray-300 text-gray-800"
    }`}
  >
    {children}
  </kbd>
);

const Onboarding = () => {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const [done, setDone] = useState(false);     // 本步驟已按對（短暫顯示打勾後進下一步）
  const [finished, setFinished] = useState(false);
  const [hotkeys, setHotkeys] = useState({});
  const [triggerLabel, setTriggerLabel] = useState("右 Ctrl / 右 Alt");
  const advanceTimer = useRef(null);

  // 讀使用者實際設定的快捷鍵（有人改過就該教改過的那組，不能教預設值）
  useEffect(() => {
    (async () => {
      try {
        const saved = await window.electronAPI?.getSetting?.("custom_hotkeys", null);
        setHotkeys(saved && typeof saved === "object" ? saved : {});
      } catch (e) { /* 用預設顯示 */ }
      try {
        const trig = await window.electronAPI?.getSetting?.("typeless_trigger", "default");
        if (trig && trig !== "default") setTriggerLabel(String(trig).toUpperCase());
      } catch (e) { /* ignore */ }
    })();
  }, []);

  // useMemo 固定 identity：steps 每次 render 重建的話，下面的訂閱 effect 會跟著
  // 不斷重掛，清理函式就會把「跳下一步」的計時器清掉 → 永遠卡在第一關（實際踩過）
  const steps = React.useMemo(() => [
    {
      actionId: "typeless-recording",
      keys: splitKeys(triggerLabel === "右 Ctrl / 右 Alt" ? null : triggerLabel),
      fallbackKeys: ["右 Ctrl"],
      title: t("onboarding.recordTitle"),
      desc: t("onboarding.recordDesc"),
    },
    {
      actionId: "quick-edit-last",
      keys: splitKeys(hotkeys["quick-edit-last"] || "CommandOrControl+Shift+E"),
      title: t("onboarding.editTitle"),
      desc: t("onboarding.editDesc"),
    },
    {
      actionId: "toggle-command-mode",
      keys: splitKeys(hotkeys["toggle-command-mode"] || "CommandOrControl+Shift+K"),
      title: t("onboarding.commandTitle"),
      desc: t("onboarding.commandDesc"),
    },
    {
      actionId: "copy-last",
      keys: splitKeys(hotkeys["copy-last"] || "CommandOrControl+Shift+C"),
      title: t("onboarding.copyTitle"),
      desc: t("onboarding.copyDesc"),
    },
  ], [t, hotkeys, triggerLabel]);

  const step = steps[stepIndex];

  // 用 ref 讀「現在是第幾步、結束了沒」，讓訂閱只掛一次。
  // 若把這些放進 effect deps，每次 setDone 造成的 re-render 都會重掛訂閱，
  // 清理函式就會清掉剛設好的計時器，導致卡在原地。
  const stepsRef = useRef(steps);
  const stepIndexRef = useRef(0);
  const finishedRef = useRef(false);
  useEffect(() => { stepsRef.current = steps; }, [steps]);
  useEffect(() => { stepIndexRef.current = stepIndex; }, [stepIndex]);
  useEffect(() => { finishedRef.current = finished; }, [finished]);

  // 主行程把「按對的鍵」送過來；對上目前這步就過關（只在掛載時訂閱一次）
  useEffect(() => {
    const unsub = window.electronAPI?.onOnboardingKey?.((data) => {
      const cur = stepsRef.current[stepIndexRef.current];
      if (!cur || finishedRef.current) return;
      if (data?.actionId !== cur.actionId) return;
      setDone(true);
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => {
        setDone(false);
        const last = stepIndexRef.current >= stepsRef.current.length - 1;
        // 記錄進度：支援時能知道使用者卡在哪一步、有沒有走完
        try {
          window.electronAPI?.log?.(
            "info",
            `新手教學：第 ${stepIndexRef.current + 1} 步完成${last ? "（全部完成）" : ""}`
          );
        } catch (e) { /* ignore */ }
        if (last) setFinished(true);
        else setStepIndex((i) => i + 1);
      }, 700); // 讓打勾動畫看得到再換頁
    });
    return () => {
      if (typeof unsub === "function") unsub();
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  // markDone=true 才記成「已看過」，之後不再自動跳出。
  // Esc 只是先收起來（很容易誤按——教學會搶走鍵盤焦點，使用者手邊正在打字時
  // 隨手一個 Esc 就永久跳過，而且再也不會出現），下次啟動仍會再問一次。
  const close = async (markDone) => {
    if (markDone) {
      try { await window.electronAPI?.setSetting?.("onboarding_done", true); } catch (e) { /* ignore */ }
    }
    try { await window.electronAPI?.closeOnboarding?.(); } catch (e) { /* ignore */ }
  };

  // Esc 隨時可離開（教學不該是牢籠），但不標記完成
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const keysToShow = step && step.keys.length ? step.keys : step?.fallbackKeys || [];

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-gray-900/80 backdrop-blur-sm select-none">
      <div className="w-full max-w-2xl mx-6 text-center">
        {!finished ? (
          <>
            {/* 進度 */}
            <div className="flex items-center justify-center gap-2 mb-10">
              {steps.map((s, i) => (
                // 每段等寬，只用顏色分辨：已完成=綠、現在=白、還沒到=淡。
                // 當前段變長會讓整排長度不一致，看起來像壞掉
                <div
                  key={s.actionId}
                  className={`h-1.5 w-12 rounded-full transition-colors duration-300 ${
                    i < stepIndex ? "bg-emerald-400"
                      : i === stepIndex ? "bg-white"
                      : "bg-white/25"
                  }`}
                />
              ))}
            </div>

            <p className="text-emerald-300 text-sm font-medium mb-3">
              {t("onboarding.stepLabel", { n: stepIndex + 1, total: steps.length })}
            </p>
            <h1 className="text-white text-3xl md:text-4xl font-bold mb-4">{step.title}</h1>
            <p className="text-gray-300 text-lg mb-12 leading-relaxed">{step.desc}</p>

            {/* 按鍵視覺 */}
            <div className="flex items-center justify-center gap-3 mb-10">
              {keysToShow.map((k, i) => (
                <React.Fragment key={`${k}-${i}`}>
                  {i > 0 && <span className="text-white/40 text-2xl">+</span>}
                  <Kbd lit={done}>{k}</Kbd>
                </React.Fragment>
              ))}
            </div>

            {/* 狀態：等你按 / 按對了 */}
            <div className="h-8">
              {done ? (
                <p className="text-emerald-400 font-semibold inline-flex items-center gap-2 text-lg">
                  <Check className="w-5 h-5" /> {t("onboarding.nice")}
                </p>
              ) : (
                <p className="text-white/60 animate-pulse">{t("onboarding.pressToContinue")}</p>
              )}
            </div>

            <button
              onClick={() => close(true)}
              className="mt-10 inline-flex items-center gap-1.5 text-white/50 hover:text-white/90 text-sm transition-colors"
            >
              <SkipForward className="w-4 h-4" /> {t("onboarding.skip")}
            </button>
          </>
        ) : (
          /* 完成：直接給一張速查表，之後忘了也能回來看 */
          <>
            <Sparkles className="w-12 h-12 text-emerald-400 mx-auto mb-5" />
            <h1 className="text-white text-3xl md:text-4xl font-bold mb-3">
              {t("onboarding.doneTitle")}
            </h1>
            <p className="text-gray-300 text-lg mb-8">{t("onboarding.doneDesc")}</p>

            <div className="bg-white/10 rounded-2xl p-6 text-left mb-8 space-y-3">
              {steps.map((s) => (
                <div key={s.actionId} className="flex items-center justify-between gap-4">
                  <span className="text-gray-200">{s.title}</span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {(s.keys.length ? s.keys : s.fallbackKeys || []).map((k, i) => (
                      <React.Fragment key={`${k}-${i}`}>
                        {i > 0 && <span className="text-white/40 text-xs">+</span>}
                        <kbd className="px-2 py-1 rounded-md bg-white/90 text-gray-800 text-xs font-semibold">{k}</kbd>
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 pt-3 border-t border-white/15">
                <span className="text-gray-200">{t("onboarding.cancelRecording")}</span>
                <kbd className="px-2 py-1 rounded-md bg-white/90 text-gray-800 text-xs font-semibold">Esc</kbd>
              </div>
            </div>

            <button
              onClick={() => close(true)}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors"
            >
              {t("onboarding.startUsing")}
            </button>
            <p className="mt-5 text-white/40 text-sm">{t("onboarding.replayHint")}</p>
          </>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
