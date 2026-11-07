import React, { useEffect, useState } from "react";
import { Keyboard, Mic, X } from "lucide-react";
import { useTranslation } from "../i18n";

/**
 * 快捷鍵速查表：忘記的時候隨時叫出來看。
 *
 * 新手教學只在第一次跑（結尾那張表看過就沒了），但快捷鍵本來就是會忘的東西。
 * 這張表用全域熱鍵隨叫隨到，顯示使用者**實際設定**的按鍵而不是寫死的預設值。
 */

function splitKeys(accelerator) {
  if (!accelerator) return [];
  return accelerator
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/CmdOrCtrl/gi, "Ctrl")
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);
}

const Keys = ({ keys }) => (
  <span className="flex items-center gap-1 shrink-0">
    {keys.map((k, i) => (
      <React.Fragment key={`${k}-${i}`}>
        {i > 0 && <span className="text-white/35 text-xs">+</span>}
        <kbd className="px-2 py-1 rounded-md bg-white/90 text-gray-800 text-xs font-semibold whitespace-nowrap">
          {k}
        </kbd>
      </React.Fragment>
    ))}
  </span>
);

const Row = ({ label, keys, desc }) => (
  <div className="flex items-start justify-between gap-4 py-2">
    <div className="min-w-0">
      <div className="text-gray-100 text-sm">{label}</div>
      {desc && <div className="text-white/45 text-xs mt-0.5">{desc}</div>}
    </div>
    <Keys keys={keys} />
  </div>
);

const CheatSheet = () => {
  const { t } = useTranslation();
  const [hotkeys, setHotkeys] = useState({});
  const [trigger, setTrigger] = useState("右 Ctrl");

  useEffect(() => {
    (async () => {
      try {
        const saved = await window.electronAPI?.getSetting?.("custom_hotkeys", null);
        setHotkeys(saved && typeof saved === "object" ? saved : {});
      } catch (e) { /* 用預設顯示 */ }
      try {
        const trg = await window.electronAPI?.getSetting?.("typeless_trigger", "default");
        if (trg && trg !== "default") setTrigger(String(trg).toUpperCase());
      } catch (e) { /* ignore */ }
    })();
  }, []);

  const close = () => {
    try { window.electronAPI?.closeCheatSheet?.(); } catch (e) { /* ignore */ }
  };

  // Esc 或點背景都能關掉——查完就該消失，不該擋路
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hk = (id, fallback) => splitKeys(hotkeys[id] || fallback);

  return (
    <div
      className="w-screen h-screen flex items-center justify-center bg-gray-900/85 backdrop-blur-sm select-none p-6"
      onClick={close}
    >
      <div
        className="w-full max-w-lg bg-gray-800/90 rounded-2xl border border-white/10 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-white text-lg font-bold inline-flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-emerald-400" /> {t("cheatSheet.title")}
          </h1>
          <button
            onClick={close}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="divide-y divide-white/10">
          <Row label={t("onboarding.recordTitle")} keys={[trigger]} desc={t("cheatSheet.recordDesc")} />
          <Row label={t("cheatSheet.cancel")} keys={["Esc"]} desc={t("cheatSheet.cancelDesc")} />
          <Row label={t("onboarding.editTitle")} keys={hk("quick-edit-last", "CommandOrControl+Shift+E")} />
          <Row label={t("onboarding.commandTitle")} keys={hk("toggle-command-mode", "CommandOrControl+Shift+K")} />
          <Row label={t("onboarding.copyTitle")} keys={hk("copy-last", "CommandOrControl+Shift+C")} />
          {/* 這列是手勢不是鍵盤組合：用觸發鍵自己的名字 ×2 表示「連按兩下」 */}
          <Row
            label={t("cheatSheet.swapClipboard")}
            keys={[trigger, trigger]}
            desc={t("cheatSheet.swapClipboardDesc")}
          />
          <Row label={t("cheatSheet.showWindow")} keys={hk("show-window", "CommandOrControl+Shift+Q")} />
          <Row label={t("cheatSheet.cheatSheet")} keys={hk("show-cheat-sheet", "CommandOrControl+Shift+H")} />
        </div>

        {/* 語音指令：操作模式下可以講的話，這些也常忘 */}
        <div className="mt-5 pt-4 border-t border-white/10">
          <h2 className="text-white/70 text-xs font-semibold mb-2 inline-flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5" /> {t("cheatSheet.voiceTitle")}
          </h2>
          <p className="text-white/50 text-xs leading-relaxed">{t("cheatSheet.voiceList")}</p>
          <p className="text-white/40 text-xs mt-2 leading-relaxed">{t("cheatSheet.spellOut")}</p>
        </div>

        <p className="mt-5 text-center text-white/30 text-xs">{t("cheatSheet.dismiss")}</p>
      </div>
    </div>
  );
};

export default CheatSheet;
