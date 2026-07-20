import React, { useState, useEffect } from "react";
import { Bot, Check, X, RefreshCw, Square, Clock, Loader2, CheckCircle2 } from "lucide-react";
import { useTranslation } from "../i18n";

export default function AgentPanel() {
  const { t } = useTranslation();
  const T = (k, p) => t("settings.agentTab." + k, p); // 縮寫

  const [backends, setBackends] = useState(null);
  const [cfg, setCfg] = useState({ cli: "claude-code", source: "anthropic", anthropicModel: "sonnet", codexModel: "gpt-5-codex", ollamaModel: "minimax-m2.5:cloud", workMode: "general", enabled: false, projectDir: "" });
  const [tasks, setTasks] = useState([]); // {id, status, prompt, text, tools}
  const [models, setModels] = useState([]); // [{name, tier, label?}]
  const [showAll, setShowAll] = useState(false);
  const [checking, setChecking] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [dismissed, setDismissed] = useState([]);
  const [sched, setSched] = useState([]);
  const [schedForm, setSchedForm] = useState({ prompt: "", type: "once", at: "", time: "09:00", dow: 1 });

  const api = window.electronAPI || {};
  const refresh = () => api.agentDetectBackends?.().then(setBackends).catch(() => {});
  const loadModels = (opts) => api.agentListModels?.(opts).then((r) => { if (r) setModels(r.models || []); }).catch(() => {});
  const checkAvailability = () => { setChecking(true); Promise.resolve(loadModels({ source: "ollama", showAll, live: true })).finally(() => setChecking(false)); };
  const act = (fn) => { try { fn && fn(); } catch (e) {} setTimeout(refresh, 1500); };

  useEffect(() => {
    refresh();
    api.agentGetConfig?.().then((c) => { if (c) { setCfg(c); loadModels({ source: c.source || "anthropic" }); } }).catch(() => {});
    api.agentHistory?.().then((h) => { if (Array.isArray(h) && h.length) setTasks(h); }).catch(() => {}); // 載回已完成歷史
    loadSched();
  }, []);
  useEffect(() => {
    if (!api.onAgentTaskUpdate) return;
    return api.onAgentTaskUpdate((p) => setTasks((prev) => {
      const i = prev.findIndex((t2) => t2.id === p.id);
      if (i >= 0) { const n = [...prev]; n[i] = p; return n; }
      return [p, ...prev].slice(0, 30);
    }));
  }, []);
  const set = (patch) => { setCfg((c) => ({ ...c, ...patch })); api.agentSetConfig?.(patch); };

  const validSources = (cli) => (cli === "codex" ? ["chatgpt", "ollama"] : ["anthropic", "ollama"]);
  const onCli = (cli) => {
    const valid = validSources(cli);
    const source = valid.includes(cfg.source) ? cfg.source : valid[0];
    set({ cli, source });
    setShowAll(false);
    loadModels({ source });
  };
  const onSource = (source) => { set({ source }); setShowAll(false); loadModels({ source }); };
  const pickDir = () => api.agentPickProjectDir?.().then((r) => { if (r && r.success) set({ projectDir: r.dir, workMode: "project" }); }).catch(() => {});
  const loadSched = () => api.agentListSchedules?.().then((s) => setSched(Array.isArray(s) ? s : [])).catch(() => {});
  const addSched = () => {
    const f = schedForm;
    if (!f.prompt.trim()) return;
    const payload = { prompt: f.prompt, type: f.type };
    if (f.type === "once") { if (!f.at) return; payload.at = new Date(f.at).getTime(); }
    else { payload.time = f.time; if (f.type === "weekly") payload.dow = Number(f.dow); }
    api.agentAddSchedule?.(payload).then((r) => { if (r && r.success) { setSchedForm({ ...f, prompt: "" }); loadSched(); } }).catch(() => {});
  };
  const delSched = (id) => api.agentDeleteSchedule?.(id).then(loadSched).catch(() => {});
  const fmtWhen = (ms) => { try { return new Date(ms).toLocaleString(); } catch (e) { return ""; } };

  const Btn = ({ onClick, ghost, children }) => (
    <button onClick={onClick} className={"px-3 py-1 text-xs rounded-lg " + (ghost
      ? "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      : "bg-blue-500 hover:bg-blue-600 text-white")}>{children}</button>
  );
  const Section = ({ title, children }) => (
    <div className="mb-5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
  const Dot = ({ on }) => <span className={"w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 " + (on ? "border-sky-500 bg-sky-500" : "border-gray-400 dark:border-gray-500")} />;

  const CliRow = ({ k, label, installed, onInstall, selectable }) => {
    const selected = selectable && cfg.cli === k;
    return (
      <div onClick={selectable ? () => onCli(k) : undefined}
        className={"flex items-center justify-between p-3 rounded-lg border " + (selectable ? "cursor-pointer " : "") +
          (selected ? "border-sky-500 bg-sky-50 dark:bg-sky-900/20" : "border-transparent bg-gray-50 dark:bg-gray-700/50")}>
        <span className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
          {selectable && <Dot on={selected} />}
          {installed ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-red-500" />}
          {label}
        </span>
        {!installed && <Btn onClick={(e) => { e.stopPropagation && e.stopPropagation(); act(onInstall); }}>{T("install")}</Btn>}
      </div>
    );
  };
  const SourceRow = ({ k, label, loggedIn, onLogin, onLogout, onSwitch }) => {
    const selected = cfg.source === k;
    return (
      <div onClick={() => onSource(k)}
        className={"flex items-center justify-between p-3 rounded-lg cursor-pointer border " +
          (selected ? "border-sky-500 bg-sky-50 dark:bg-sky-900/20" : "border-transparent bg-gray-50 dark:bg-gray-700/50")}>
        <span className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
          <Dot on={selected} />
          {label}
          {loggedIn ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-red-500" />}
        </span>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Btn ghost onClick={() => act(loggedIn ? onSwitch : onLogin)}>{loggedIn ? T("switchAccount") : T("login")}</Btn>
          <Btn ghost onClick={() => act(onLogout)}>{T("logout")}</Btn>
        </div>
      </div>
    );
  };

  const SOURCE_META = {
    anthropic: { label: "Anthropic", loggedIn: !!backends?.anthropic, onLogin: api.agentLoginAnthropic, onLogout: api.agentLogoutAnthropic, onSwitch: api.agentSwitchAnthropic },
    chatgpt: { label: "ChatGPT", loggedIn: !!backends?.chatgpt, onLogin: api.agentLoginCodex, onLogout: api.agentLogoutCodex, onSwitch: api.agentSwitchCodex },
    ollama: { label: "Ollama", loggedIn: !!backends?.ollamaSignedIn, onLogin: api.agentLoginOllama, onLogout: api.agentLogoutOllama, onSwitch: api.agentSwitchOllama },
  };

  const isOllama = cfg.source === "ollama";
  const isAnthropic = cfg.source === "anthropic";
  const isChatgpt = cfg.source === "chatgpt";
  // ChatGPT 帳號模型由伺服器固定 → 單一「預設」項,不可選。
  const modelValue = isAnthropic ? cfg.anthropicModel : isOllama ? cfg.ollamaModel : "default";
  const setModel = (v) => { if (isAnthropic) set({ anthropicModel: v }); else if (isOllama) set({ ollamaModel: v }); };
  const hasCurrent = models.some((m) => m.name === modelValue);
  const labelFor = (m) => m.label
    || (isChatgpt && m.name === "default" ? T("codexDefault")
      : isOllama ? m.name + " — " + (m.tier === "subscription" ? T("tierSub") : m.tier === "unknown" ? T("tierUnknown") : T("tierFree"))
        : m.name);

  const running = tasks.filter((t2) => t2.status === "running");
  const queued = tasks.filter((t2) => t2.status === "queued");
  const done = tasks.filter((t2) => ["done", "error", "stopped", "cancelled"].includes(t2.status) && !dismissed.includes(t2.id));

  const cliName = cfg.cli === "codex" ? T("cliCodex") : T("cliClaudeCode");

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{T("title")}</h3>
        <button onClick={refresh} title={T("redetect")} className="ml-auto p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{T("desc")}</p>

      <Section title={T("cliSection")}>
        <CliRow k="claude-code" label={T("claudeInstalled")} installed={!!backends?.claudeCode} onInstall={api.agentInstallClaude} selectable />
        <CliRow k="codex" label={T("codexInstalled")} installed={!!backends?.codex} onInstall={api.agentInstallCodex} selectable />
        <CliRow k="ollama" label={T("ollamaInstalled")} installed={!!backends?.ollama} onInstall={api.agentInstallOllama} selectable={false} />
      </Section>

      <Section title={T("sourceSection", { cli: cliName })}>
        {validSources(cfg.cli).map((k) => {
          const m = SOURCE_META[k];
          return <SourceRow key={k} k={k} label={m.label} loggedIn={m.loggedIn} onLogin={m.onLogin} onLogout={m.onLogout} onSwitch={m.onSwitch} />;
        })}
      </Section>

      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{T("modelSection")}</h4>
          {isOllama && (
            <div className="flex items-center gap-3">
              <button onClick={checkAvailability} disabled={checking}
                className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50">
                <RefreshCw className={"w-3 h-3" + (checking ? " animate-spin" : "")} />{T("checkAvailability")}
              </button>
              <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                <input type="checkbox" checked={showAll}
                  onChange={(e) => { setShowAll(e.target.checked); loadModels({ source: "ollama", showAll: e.target.checked }); }}
                  className="w-3.5 h-3.5 accent-blue-500" />
                {T("showAll")}
              </label>
            </div>
          )}
        </div>
        <select value={modelValue} onChange={(e) => setModel(e.target.value)} disabled={isChatgpt}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-70">
          {!hasCurrent && <option value={modelValue}>{modelValue}</option>}
          {models.map((m) => <option key={m.name} value={m.name}>{labelFor(m)}</option>)}
        </select>
      </div>

      {/* 工作目錄:一般(Downloads/SpeakSlowAgent)或專案資料夾 */}
      <div className="mb-5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">{T("workdirSection")}</h4>
        <div className="space-y-2">
          <div onClick={() => set({ workMode: "general" })}
            className={"flex items-center gap-2 p-3 rounded-lg cursor-pointer border " + (cfg.workMode !== "project" ? "border-sky-500 bg-sky-50 dark:bg-sky-900/20" : "border-transparent bg-gray-50 dark:bg-gray-700/50")}>
            <Dot on={cfg.workMode !== "project"} /><span className="text-sm text-gray-800 dark:text-gray-200">{T("workdirGeneral")}</span>
          </div>
          <div onClick={() => set({ workMode: "project" })}
            className={"flex items-center justify-between gap-2 p-3 rounded-lg cursor-pointer border " + (cfg.workMode === "project" ? "border-sky-500 bg-sky-50 dark:bg-sky-900/20" : "border-transparent bg-gray-50 dark:bg-gray-700/50")}>
            <span className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 min-w-0">
              <Dot on={cfg.workMode === "project"} />
              <span className={"truncate " + (cfg.projectDir ? "font-mono text-xs" : "")}>{cfg.projectDir || T("workdirProject")}</span>
            </span>
            <button onClick={(e) => { e.stopPropagation(); pickDir(); }} className="px-3 py-1 text-xs rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex-shrink-0">{T("pickFolder")}</button>
          </div>
        </div>
      </div>

      <label className="flex items-center justify-between p-3 bg-sky-50 dark:bg-sky-900/20 rounded-lg mb-5 cursor-pointer">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{T("agentMode")}{cfg.enabled && <span className="ml-2 text-xs text-sky-600 dark:text-sky-400">● {T("on")}</span>}</span>
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="w-4 h-4 accent-sky-500" />
      </label>

      {/* 排隊中:編號 + 標籤 + 取消 */}
      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{T("queued")}</h4>
      {queued.length === 0 ? <p className="text-xs text-gray-400 mb-3">{T("none")}</p> : queued.map((t2, i) => (
        <div key={t2.id} className="flex items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-2">
          <span className="text-sm truncate text-gray-800 dark:text-gray-200">{i + 1}. {t2.prompt}</span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-400">{T("queued")}</span>
            <button onClick={() => api.agentCancelTask?.(t2.id)} className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-red-600"><X className="w-3 h-3" />{T("cancel")}</button>
          </div>
        </div>
      ))}

      {/* 執行中:進行中標籤 + 停止 + 即時串流(🔧 + 文字) */}
      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 mt-3 flex items-center gap-1"><Loader2 className={"w-3.5 h-3.5" + (running.length ? " animate-spin" : "")} />{T("running")}</h4>
      {running.length === 0 ? <p className="text-xs text-gray-400 mb-3">{T("none")}</p> : running.map((t2) => (
        <div key={t2.id} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm truncate text-gray-800 dark:text-gray-200">▶ {t2.prompt}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-sky-600 dark:text-sky-400">{T("inProgress")}</span>
              <button onClick={() => api.agentStopTask?.()} className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:text-red-700"><Square className="w-3 h-3" />{T("stop")}</button>
            </div>
          </div>
          {t2.tools?.map((tool, i) => <div key={i} className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate mt-1">🔧 {tool}</div>)}
          {t2.text && <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap line-clamp-4">{t2.text}</div>}
        </div>
      ))}

      {/* 已完成:○/✗ 打勾移除 + 展開細節 + 狀態標籤 */}
      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 mt-3 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{T("completed")}</h4>
      {done.length === 0 ? <p className="text-xs text-gray-400">{T("none")}</p> : done.map((t2) => {
        const failed = t2.status === "error";
        const hasDetail = (t2.tools && t2.tools.length) || !!t2.text;
        const expanded = expandedId === t2.id;
        return (
          <div key={t2.id} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-2">
            <div className="flex items-center gap-2 p-3">
              <button onClick={() => setDismissed((d) => [...d, t2.id])} title={T("dismissTip")}
                className="group text-sm font-bold w-4 flex-shrink-0">
                <span className={"group-hover:hidden " + (failed ? "text-red-500" : "text-green-500")}>{failed ? "✗" : "○"}</span>
                <span className="hidden group-hover:inline text-green-600">✓</span>
              </button>
              {hasDetail ? (
                <button onClick={() => setExpandedId(expanded ? null : t2.id)} className="flex-1 min-w-0 flex items-center gap-1 text-left text-sm text-gray-800 dark:text-gray-200">
                  <span className="text-gray-400 flex-shrink-0">{expanded ? "▾" : "▸"}</span><span className="truncate">{t2.prompt}</span>
                </button>
              ) : <span className="flex-1 min-w-0 text-sm truncate text-gray-800 dark:text-gray-200">{t2.prompt}</span>}
              {failed && <span className="text-xs text-red-500 flex-shrink-0">{T("failed")}</span>}
              {t2.status === "stopped" && <span className="text-xs text-gray-400 flex-shrink-0">{T("stopped")}</span>}
              {t2.status === "cancelled" && <span className="text-xs text-gray-400 flex-shrink-0">{T("cancelled")}</span>}
            </div>
            {expanded && hasDetail && (
              <div className="px-3 pb-3 -mt-1">
                {t2.tools?.map((tool, i) => <div key={i} className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">🔧 {tool}</div>)}
                {t2.text && <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap">{t2.text}</div>}
              </div>
            )}
          </div>
        );
      })}

      {/* 排程代辦:一次性 / 每天 / 每週 */}
      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 mt-4 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{T("scheduleSection")}</h4>
      <div className="space-y-2 mb-2">
        <input value={schedForm.prompt} onChange={(e) => setSchedForm({ ...schedForm, prompt: e.target.value })} placeholder={T("schedPromptPh")}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
        <div className="flex items-center gap-2 flex-wrap">
          <select value={schedForm.type} onChange={(e) => setSchedForm({ ...schedForm, type: e.target.value })}
            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
            <option value="once">{T("schedOnce")}</option>
            <option value="daily">{T("schedDaily")}</option>
            <option value="weekly">{T("schedWeekly")}</option>
          </select>
          {schedForm.type === "once" && (
            <input type="datetime-local" value={schedForm.at} onChange={(e) => setSchedForm({ ...schedForm, at: e.target.value })}
              className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          )}
          {schedForm.type === "weekly" && (
            <select value={schedForm.dow} onChange={(e) => setSchedForm({ ...schedForm, dow: e.target.value })}
              className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
              {(T("weekdays") || []).map((w, i) => <option key={i} value={i}>{w}</option>)}
            </select>
          )}
          {schedForm.type !== "once" && (
            <input type="time" value={schedForm.time} onChange={(e) => setSchedForm({ ...schedForm, time: e.target.value })}
              className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          )}
          <button onClick={addSched} className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg">{T("schedAdd")}</button>
        </div>
      </div>
      {sched.length === 0 ? <p className="text-xs text-gray-400">{T("schedNone")}</p> : sched.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-2">
          <span className="text-sm truncate text-gray-800 dark:text-gray-200 min-w-0">
            {s.prompt}
            <span className="block text-xs text-gray-400">{T("schedNext")}: {fmtWhen(s.nextRun)}{s.type !== "once" ? " · " + (s.type === "daily" ? T("schedDaily") : T("schedWeekly")) : ""}</span>
          </span>
          <button onClick={() => delSched(s.id)} className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-red-600 flex-shrink-0"><X className="w-3 h-3" /></button>
        </div>
      ))}
    </div>
  );
}
