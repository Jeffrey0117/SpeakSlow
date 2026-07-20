const { ipcMain } = require("electron");
const { spawnSync, spawn, execFile } = require("child_process");
const { promisify } = require("util");
const catalog = require("../agentCatalog.js");
const { computeNextRun, processDue } = require("../agentSchedule.js");

const pExecFile = promisify(execFile);
// 非阻塞偵測。win32 用 shell:true 才能跑 .cmd/.bat shim(如 codex.cmd / npm.cmd)。
async function probeAsync(cmd, args) {
  try { await pExecFile(cmd, args, { windowsHide: true, timeout: 8000, shell: process.platform === "win32" }); return true; }
  catch { return false; }
}
// 即時、非互動執行(登出);忽略結果。同樣需要 shell 解 shim。
function runSync(cmd, args) {
  try { spawnSync(cmd, args, { windowsHide: true, timeout: 15000, shell: process.platform === "win32" }); } catch (e) {}
}

// Anthropic 登入的被動退路(claude 未裝/查不到時):env / ~/.claude.json oauthAccount / 認證檔。
function anthropicFileLogin() {
  try {
    if (process.env.ANTHROPIC_API_KEY) return true;
    const os = require("os"), fs = require("fs"), path = require("path");
    try { const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")); if (j && j.oauthAccount) return true; } catch {}
    return fs.existsSync(path.join(os.homedir(), ".claude", ".credentials.json"));
  } catch { return false; }
}
// Ollama 登入偵測:本機 daemon 的 /api/me(POST)會回帳號/方案(free-cowork 同源)。
async function ollamaMe() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/me", { method: "POST", signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const j = await res.json();
    return !!(j && (j.email || j.name));
  } catch { return false; }
}

// 開一個可見的終端機視窗跑指令(登入/安裝需互動或看進度)。cmd /k 內會做 PATHEXT 解析。
function openTerminal(args) {
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", "cmd", "/k", ...args], { detached: true, windowsHide: false });
    else spawn("sh", ["-c", args.join(" ")], { detached: true });
  } catch (e) {}
}

module.exports = function register(ctx) {
  // 偵測:CLI 工具(claudeCode/codex/ollama 已安裝)+ 模型來源(anthropic/chatgpt/ollamaSignedIn 已登入)。
  // 非同步 + 併發,避免 spawnSync 卡住主程序事件迴圈。
  ipcMain.handle("agent-detect-backends", async () => {
    const [claudeCode, codex, ollama] = await Promise.all([
      probeAsync("claude", ["--version"]),
      probeAsync("codex", ["--version"]),
      probeAsync("ollama", ["--version"]),
    ]);
    const [authStatus, chatgpt, ollamaSignedIn] = await Promise.all([
      claudeCode ? probeAsync("claude", ["auth", "status"]) : Promise.resolve(false),
      codex ? probeAsync("codex", ["login", "status"]) : Promise.resolve(false),
      ollama ? ollamaMe() : Promise.resolve(false),
    ]);
    return { claudeCode, codex, ollama, anthropic: authStatus || anthropicFileLogin(), chatgpt, ollamaSignedIn };
  });

  // 模型清單依「模型來源」:anthropic=單一 Claude;chatgpt=固定 Codex 模型;ollama=雲端 catalog。
  ipcMain.handle("agent-list-models", async (e, opts) => {
    const { source = "anthropic", showAll = false, live = false } = opts || {};
    if (source === "anthropic") {
      return { source, default: catalog.CLAUDE_DEFAULT_MODEL, models: catalog.CLAUDE_MODELS.map((name) => ({ name, tier: "anthropic" })) };
    }
    if (source === "chatgpt") {
      // ChatGPT 帳號用伺服器固定模型(不能選、帶 -m 會 400)→ 只給單一「預設」項。
      return { source, default: "default", models: [{ name: "default", tier: "chatgpt" }] };
    }
    let available = null; // ollama:可 live 掃描雲端目錄
    if (live) {
      try { const res = await fetch(catalog.CATALOG_URL, { signal: AbortSignal.timeout(8000) }); available = catalog.parseCloudModels(await res.text()); } catch { available = null; }
    }
    return { source, default: catalog.DEFAULT_MODEL, models: catalog.listModels({ showAll, available }), live: !!available };
  });

  ipcMain.handle("agent-get-config", () => ({
    cli: ctx.databaseManager.getSetting("agent_cli", "claude-code"),
    source: ctx.databaseManager.getSetting("agent_source", "anthropic"),
    anthropicModel: ctx.databaseManager.getSetting("agent_anthropic_model", catalog.CLAUDE_DEFAULT_MODEL),
    codexModel: ctx.databaseManager.getSetting("agent_codex_model", catalog.CODEX_DEFAULT_MODEL),
    ollamaModel: ctx.databaseManager.getSetting("agent_ollama_model", catalog.DEFAULT_MODEL),
    workMode: ctx.databaseManager.getSetting("agent_work_mode", "general"),
    enabled: ctx.databaseManager.getSetting("agent_mode_enabled", false) === true,
    projectDir: ctx.databaseManager.getSetting("agent_project_dir", ""),
  }));

  ipcMain.handle("agent-set-config", (e, patch) => {
    const map = {
      cli: "agent_cli", source: "agent_source",
      anthropicModel: "agent_anthropic_model", codexModel: "agent_codex_model", ollamaModel: "agent_ollama_model",
      workMode: "agent_work_mode", enabled: "agent_mode_enabled", projectDir: "agent_project_dir",
    };
    for (const [k, v] of Object.entries(patch || {})) { if (map[k]) ctx.databaseManager.setSetting(map[k], v); }
    return { success: true };
  });

  function resolveCwd() {
    const workMode = ctx.databaseManager.getSetting("agent_work_mode", "general");
    const projectDir = ctx.databaseManager.getSetting("agent_project_dir", "");
    if (workMode === "project" && projectDir) return projectDir;
    const dir = require("path").join(require("electron").app.getPath("downloads"), "SpeakSlowAgent");
    try { require("fs").mkdirSync(dir, { recursive: true }); } catch (e) {}
    return dir;
  }

  // 由「模型來源」衍生實際 cli/model:anthropic→claude-code+claude 別名;chatgpt→codex+預設(不帶 -m);
  // ollama→agent_cli(可 claude-code 或 codex)+ollama 雲端模型。run-task 與排程共用此邏輯。
  function deriveCliModel(source) {
    if (source === "chatgpt") return { cli: "codex", model: "default" };
    if (source === "ollama") return { cli: ctx.databaseManager.getSetting("agent_cli", "claude-code"), model: ctx.databaseManager.getSetting("agent_ollama_model", catalog.DEFAULT_MODEL) };
    return { cli: "claude-code", model: ctx.databaseManager.getSetting("agent_anthropic_model", catalog.CLAUDE_DEFAULT_MODEL) };
  }

  ipcMain.handle("agent-run-task", (e, text) => {
    if (!text || !text.trim()) return { success: false, error: "空白指令" };
    const source = ctx.databaseManager.getSetting("agent_source", "anthropic");
    const { cli, model } = deriveCliModel(source);
    return ctx.agentManager.runTask({ prompt: text, model, cwd: resolveCwd(), cli, source });
  });

  // 排程代辦(一次性 + 每天/每週)。存 agent_schedules;主程序每 30 秒檢查到期項目並執行。
  ipcMain.handle("agent-add-schedule", (e, p) => {
    try {
      if (!p || !p.prompt || !p.prompt.trim()) return { success: false, error: "空白指令" };
      const source = ctx.databaseManager.getSetting("agent_source", "anthropic");
      const { cli, model } = deriveCliModel(source);
      const spec = { type: p.type || "once", at: p.at, time: p.time, dow: p.dow };
      const s = { id: Date.now(), prompt: p.prompt.trim(), ...spec, source, cli, model, nextRun: computeNextRun(spec, Date.now()) };
      const list = ctx.databaseManager.getSetting("agent_schedules", []) || [];
      list.push(s);
      ctx.databaseManager.setSetting("agent_schedules", list);
      return { success: true, schedule: s };
    } catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle("agent-list-schedules", () => { try { return ctx.databaseManager.getSetting("agent_schedules", []) || []; } catch { return []; } });
  ipcMain.handle("agent-delete-schedule", (e, id) => {
    try {
      const list = (ctx.databaseManager.getSetting("agent_schedules", []) || []).filter((s) => s.id !== id);
      ctx.databaseManager.setSetting("agent_schedules", list);
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // 排程檢查迴圈:每 30 秒,到期的丟給 agent 執行(一次性執行後移除、週期推到下一次)。
  setInterval(() => {
    try {
      const list = ctx.databaseManager.getSetting("agent_schedules", []) || [];
      if (!list.length) return;
      const { due, kept } = processDue(list, Date.now());
      if (!due.length) return;
      for (const d of due) ctx.agentManager.runTask({ prompt: d.prompt, model: d.model, cwd: resolveCwd(), cli: d.cli, source: d.source });
      ctx.databaseManager.setSetting("agent_schedules", kept);
    } catch (e2) { /* 忽略單次錯誤 */ }
  }, 30000);
  ipcMain.handle("agent-stop-task", () => ctx.agentManager.stop());
  ipcMain.handle("agent-cancel-task", (e, id) => ctx.agentManager.cancel(id));
  // 已完成任務歷史(重啟後 AgentPanel 載回「已完成」)。
  ipcMain.handle("agent-history", () => { try { return ctx.databaseManager.getSetting("agent_history", []) || []; } catch { return []; } });

  // 選工作資料夾(專案模式):開原生資料夾對話框 → 存 agent_project_dir。
  ipcMain.handle("agent-pick-project-dir", async () => {
    try {
      const { dialog } = require("electron");
      const r = await dialog.showOpenDialog({ title: "選擇工作資料夾", properties: ["openDirectory"] });
      if (r.canceled || !r.filePaths.length) return { success: false };
      ctx.databaseManager.setSetting("agent_project_dir", r.filePaths[0]);
      return { success: true, dir: r.filePaths[0] };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // 安裝(CLI 工具)----------------------------------------------------------
  ipcMain.handle("agent-install-claude", () => { require("electron").shell.openExternal("https://docs.anthropic.com/en/docs/claude-code/setup"); return { success: true }; });
  ipcMain.handle("agent-install-codex", () => { openTerminal(["npm", "i", "-g", "@openai/codex"]); return { success: true }; });
  ipcMain.handle("agent-install-ollama", () => { require("electron").shell.openExternal("https://ollama.com/download"); return { success: true }; });

  // 登入 / 登出 / 切換(模型來源)-------------------------------------------
  ipcMain.handle("agent-login-anthropic", () => { openTerminal(["claude", "auth", "login"]); return { success: true }; });
  ipcMain.handle("agent-logout-anthropic", () => { runSync("claude", ["auth", "logout"]); return { success: true }; });
  ipcMain.handle("agent-switch-anthropic", () => { runSync("claude", ["auth", "logout"]); openTerminal(["claude", "auth", "login"]); return { success: true }; });

  ipcMain.handle("agent-login-codex", () => { openTerminal(["codex", "login"]); return { success: true }; });
  ipcMain.handle("agent-logout-codex", () => { runSync("codex", ["logout"]); return { success: true }; });
  ipcMain.handle("agent-switch-codex", () => { runSync("codex", ["logout"]); openTerminal(["codex", "login"]); return { success: true }; });

  ipcMain.handle("agent-login-ollama", () => { openTerminal(["ollama", "signin"]); return { success: true }; });
  ipcMain.handle("agent-logout-ollama", () => { runSync("ollama", ["signout"]); return { success: true }; });
  ipcMain.handle("agent-switch-ollama", () => { runSync("ollama", ["signout"]); openTerminal(["ollama", "signin"]); return { success: true }; });
};
