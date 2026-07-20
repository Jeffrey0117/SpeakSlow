# 代理 Agent v1 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(建議)或 superpowers:executing-plans 逐任務實作。步驟用 `- [ ]` 追蹤。
> 對應規格:`docs/superpowers/specs/2026-06-22-agent-feature-design.md`

**Goal:** 開啟「Agent 模式」後,右 Alt 講的話交給 Claude Code 在工作目錄執行任務,串流顯示於「代理 Agent」分頁,可停止;含後端偵測/一鍵動作與模型選擇。

**Architecture:** Electron 主程序新增 `agentManager`(spawn `claude`、解析 stream-json、佇列、停止)+ `ipc/agent`;`App.jsx` 在辨識完成處加 agent 分流;`settings.jsx` 把佔位面板換成 dashboard。純邏輯(spawn 參數、stream-json 解析、佇列狀態機)用 `node --test` TDD。

**Tech Stack:** Electron 31 / React 19 / Node child_process / better-sqlite3 / Claude Code CLI。spawn 機制照抄 app-free-cowork(`launcher/src-tauri/src/launcher.rs`)。

---

## 檔案結構

- **建立** `src/helpers/agentSpawn.js` — 純函式:`buildAgentSpawn()`(組 spawn 參數)、`parseStreamJsonLine()`(解析 JSONL 一行)。無副作用、可測。
- **建立** `test/agent.test.mjs` — 上述純函式的 `node --test` 測試。
- **建立** `src/helpers/agentManager.js` — 類別:偵測後端、spawn Claude Code、串流 emit、佇列、停止。
- **建立** `src/helpers/ipc/agent.js` — agent 領域 IPC handler。
- **建立** `src/components/AgentPanel.jsx` — 「代理 Agent」分頁內容(env 狀態、模型、模式開關、工作目錄、任務列表)。
- **修改** `src/helpers/ipcHandlers.js` — 註冊 `ipc/agent`。
- **修改** `preload.js` — 暴露 agent API + 任務事件。
- **修改** `src/App.jsx` — `agentMode` 狀態/ref、`safePaste` 分流、任務事件監聽。
- **修改** `src/settings.jsx` — 用 `<AgentPanel/>` 取代佔位。
- **修改** `src/helpers/database.js` — agent 任務歷史表 + getter(若 DB 用 KV 設定,沿用)。
- **修改** `src/i18n/{zh-TW,zh-CN,en}.js` — agent 字串。

---

## Task 1:spawn 參數(純函式,TDD)

**Files:** Create `src/helpers/agentSpawn.js`、`test/agent.test.mjs`

- [ ] **Step 1:寫失敗測試** — `test/agent.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentSpawn } from "../src/helpers/agentSpawn.js";

test("anthropic: 跑 claude、不帶 --model、不經 ollama", () => {
  const s = buildAgentSpawn({ prompt: "整理桌面", model: "anthropic", cwd: "C:\\w", systemPrompt: "SYS" });
  assert.equal(s.program, "claude");
  assert.deepEqual(s.args, [
    "--append-system-prompt", "SYS", "--dangerously-skip-permissions",
    "-p", "--output-format", "stream-json", "--verbose", "整理桌面",
  ]);
  assert.equal(s.cwd, "C:\\w");
  assert.equal(s.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, undefined);
});

test("ollama: 經 ollama launch claude、帶 --model、設輸出上限", () => {
  const s = buildAgentSpawn({ prompt: "hi", model: "qwen2.5:cloud", cwd: "C:\\g", systemPrompt: "SYS" });
  assert.equal(s.program, "ollama");
  assert.deepEqual(s.args, [
    "launch", "claude", "--", "claude", "--model", "qwen2.5:cloud",
    "--append-system-prompt", "SYS", "--dangerously-skip-permissions",
    "-p", "--output-format", "stream-json", "--verbose", "hi",
  ]);
  assert.equal(s.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "16384");
});
```

- [ ] **Step 2:跑測試確認失敗** — Run: `node --test test/agent.test.mjs` — Expected: FAIL(`buildAgentSpawn` is not a function / 模組不存在)。

- [ ] **Step 3:實作** — `src/helpers/agentSpawn.js`:
```js
// 純函式:依模型組出 spawn Claude Code 的 {program, args, cwd, env}。
// 機制照抄 app-free-cowork/launcher/src-tauri/src/launcher.rs:
//  anthropic("anthropic") → 直接跑 claude;其餘視為 ollama 模型 → ollama launch claude -- claude --model <m>
const CLAUDE_FLAGS = (systemPrompt, prompt) => [
  "--append-system-prompt", systemPrompt,
  "--dangerously-skip-permissions",
  "-p", "--output-format", "stream-json", "--verbose",
  prompt,
];

function buildAgentSpawn({ prompt, model, cwd, systemPrompt }) {
  if (model === "anthropic") {
    return { program: "claude", args: CLAUDE_FLAGS(systemPrompt, prompt), cwd, env: {} };
  }
  // ollama 透傳路徑(model = ollama 模型名,如 "qwen2.5:cloud")
  return {
    program: "ollama",
    args: ["launch", "claude", "--", "claude", "--model", model, ...CLAUDE_FLAGS(systemPrompt, prompt)],
    cwd,
    env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "16384" },
  };
}

module.exports = { buildAgentSpawn };
```
> **模組系統**:`agentSpawn.js` 用 **CommonJS**(`module.exports`),因為 `agentManager.js` 會 `require()` 它,而 Electron 31 = Node 20 不支援 `require(ESM)`。`.mjs` 測試用 `import { buildAgentSpawn } from "..."` 仍可(Node 的 CJS 具名匯入互通)。Task 2 會把 `module.exports` 更新為 `{ buildAgentSpawn, parseStreamJsonLine }`。

- [ ] **Step 4:跑測試確認通過** — Run: `node --test test/agent.test.mjs` — Expected: PASS(2 tests)。

- [ ] **Step 5:Commit**
```bash
git add src/helpers/agentSpawn.js test/agent.test.mjs
git commit -m "feat(agent): buildAgentSpawn — claude/ollama spawn args (TDD)"
```

## Task 2:stream-json 行解析(純函式,TDD)

**Files:** Modify `src/helpers/agentSpawn.js`、`test/agent.test.mjs`

- [ ] **Step 1:加失敗測試**(append 到 `test/agent.test.mjs`):
```js
import { parseStreamJsonLine } from "../src/helpers/agentSpawn.js";

test("解析 assistant 文字事件 → 取出文字", () => {
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "好的,我來整理。" }] } });
  assert.deepEqual(parseStreamJsonLine(line), { kind: "text", text: "好的,我來整理。" });
});
test("解析 result 事件 → 最終結果 + 是否錯誤", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", result: "完成", is_error: false });
  assert.deepEqual(parseStreamJsonLine(line), { kind: "result", text: "完成", isError: false });
});
test("非 JSON / 無關行 → null(略過)", () => {
  assert.equal(parseStreamJsonLine("not json"), null);
  assert.equal(parseStreamJsonLine(JSON.stringify({ type: "system" })), null);
});
```

- [ ] **Step 2:跑測試確認失敗** — Run: `node --test test/agent.test.mjs` — Expected: FAIL(`parseStreamJsonLine` 未定義)。

- [ ] **Step 3:實作**(append 到 `src/helpers/agentSpawn.js`):
```js
// 解析 claude stream-json 的一行 JSONL。回傳 {kind:'text'|'result', text, isError?} 或 null(略過)。
function parseStreamJsonLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  if (obj.type === "assistant" && obj.message?.content) {
    const text = obj.message.content.filter((c) => c.type === "text").map((c) => c.text).join("");
    return text ? { kind: "text", text } : null;
  }
  if (obj.type === "result") {
    return { kind: "result", text: typeof obj.result === "string" ? obj.result : "", isError: obj.is_error === true };
  }
  return null;
}
```
並把檔尾的 `module.exports` 從 `{ buildAgentSpawn }` 改為:
```js
module.exports = { buildAgentSpawn, parseStreamJsonLine };
```

- [ ] **Step 4:跑測試確認通過** — Run: `node --test test/agent.test.mjs` — Expected: PASS(5 tests)。

- [ ] **Step 5:Commit**
```bash
git add src/helpers/agentSpawn.js test/agent.test.mjs
git commit -m "feat(agent): parseStreamJsonLine — stream-json line parser (TDD)"
```

## Task 3:agentManager(spawn + 佇列 + 停止)

**Files:** Create `src/helpers/agentManager.js`

- [ ] **Step 1:實作**(無單元測試 —— 直接 spawn,屬整合層,於 Task 9 手動驗證;邏輯刻意薄,複用 Task 1/2 純函式)。`src/helpers/agentManager.js`:
```js
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const { buildAgentSpawn, parseStreamJsonLine } = require("./agentSpawn.js");

// 預設 agent 系統提示:要它「直接動手做」而非只解釋(照抄 app-free-cowork 的精神)。
const AGENT_SYSTEM_PROMPT =
  "你是使用者電腦上的執行型助理。使用者用語音下達指令,請直接動手完成(建立/修改檔案、執行命令)," +
  "不要只解釋步驟。完成後用一句繁體中文回報結果。";

// claude 執行檔:優先 ~/.local/bin/claude.exe,否則靠 PATH(同 app-free-cowork)。
function claudeProgram() {
  const p = path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  try { require("fs").accessSync(p); return p; } catch { return "claude"; }
}

class AgentManager {
  constructor(logger, windowManager) {
    this.logger = logger || console;
    this.windowManager = windowManager;
    this.current = null; // { id, child, status }
    this.nextId = 1;
  }

  isBusy() { return !!this.current && this.current.status === "running"; }

  // 送任務:spawn Claude Code,逐行解析 stream-json,emit 進度給渲染層。
  runTask({ prompt, model, cwd }) {
    if (this.isBusy()) return { success: false, error: "已有任務執行中" };
    const id = this.nextId++;
    let spec = buildAgentSpawn({ prompt, model, cwd, systemPrompt: AGENT_SYSTEM_PROMPT });
    if (spec.program === "claude") spec.program = claudeProgram();
    const child = spawn(spec.program, spec.args, {
      cwd,
      env: { ...process.env, ...spec.env },
      windowsHide: true,
    });
    this.current = { id, child, status: "running", prompt };
    this._emit({ id, status: "running", prompt, text: "" });

    let buf = "";
    let lastText = "";
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        const ev = parseStreamJsonLine(line.trim());
        if (!ev) continue;
        if (ev.kind === "text") { lastText += ev.text; this._emit({ id, status: "running", prompt, text: lastText }); }
        if (ev.kind === "result") lastText = ev.text || lastText;
      }
    });
    child.stderr.on("data", (d) => this.logger.info && this.logger.info("[agent stderr] " + d.toString().slice(0, 200)));
    child.on("error", (e) => { this.current = null; this._emit({ id, status: "error", prompt, text: "啟動失敗: " + e.message }); });
    child.on("close", (code) => {
      const status = code === 0 ? "done" : "error";
      this.current = null;
      this._emit({ id, status, prompt, text: lastText });
    });
    return { success: true, id };
  }

  stop() {
    if (this.current?.child) { try { this.current.child.kill(); } catch (e) {} }
    if (this.current) { this._emit({ id: this.current.id, status: "stopped", prompt: this.current.prompt, text: "已停止" }); this.current = null; }
    return { success: true };
  }

  _emit(payload) {
    const win = this.windowManager?.mainWindow;
    if (win && !win.isDestroyed()) win.webContents.send("agent-task-update", payload);
    // 設定視窗也要收到(任務列表顯示在設定分頁)
    const sw = this.windowManager?.settingsWindow;
    if (sw && !sw.isDestroyed()) sw.webContents.send("agent-task-update", payload);
  }
}

module.exports = AgentManager;
```

- [ ] **Step 2:接進主程序** — `main.js`:在管理器初始化區加 `const agentManager = new AgentManager(logger, windowManager);`(在 `windowManager` 之後),並加入傳給 `IPCHandlers({...})` 的物件、以及 `module.exports`。`src/helpers/ipcHandlers.js` 的 constructor 加 `this.agentManager = managers.agentManager;`。
- [ ] **Step 3:`cargo`/編譯不適用;改跑** `npm run build:renderer` 不需要 —— 這步只動主程序 JS,於 Task 9 一起驗證。先 **Commit**:
```bash
git add src/helpers/agentManager.js src/helpers/ipcHandlers.js main.js
git commit -m "feat(agent): AgentManager — spawn Claude Code, stream, queue, stop"
```

## Task 4:後端偵測 + ipc/agent + preload

**Files:** Create `src/helpers/ipc/agent.js`;Modify `src/helpers/ipcHandlers.js`、`preload.js`

- [ ] **Step 1:`ipc/agent.js`**:
```js
const { ipcMain } = require("electron");
const { spawnSync } = require("child_process");

function probe(cmd, args) {
  try { const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true }); return r.status === 0; }
  catch { return false; }
}

module.exports = function register(ctx) {
  ipcMain.handle("agent-detect-backends", () => ({
    claudeCode: probe("claude", ["--version"]),
    ollama: probe("ollama", ["--version"]),
    anthropic: probe("claude", ["--version"]) && probe("claude", ["auth", "status"]), // 已裝且已登入
  }));

  ipcMain.handle("agent-get-config", () => ({
    model: ctx.databaseManager.getSetting("agent_model", "anthropic"),
    workMode: ctx.databaseManager.getSetting("agent_work_mode", "general"),
    enabled: ctx.databaseManager.getSetting("agent_mode_enabled", false) === true,
    projectDir: ctx.databaseManager.getSetting("agent_project_dir", ""),
  }));

  ipcMain.handle("agent-set-config", (e, patch) => {
    for (const [k, v] of Object.entries(patch || {})) {
      const key = { model: "agent_model", workMode: "agent_work_mode", enabled: "agent_mode_enabled", projectDir: "agent_project_dir" }[k];
      if (key) ctx.databaseManager.setSetting(key, v);
    }
    return { success: true };
  });

  // 工作目錄:通用→ Downloads\SpeakSlowAgent(自動建);專案→ 設定的 projectDir
  function resolveCwd() {
    const cfg = { workMode: ctx.databaseManager.getSetting("agent_work_mode", "general"), projectDir: ctx.databaseManager.getSetting("agent_project_dir", "") };
    if (cfg.workMode === "project" && cfg.projectDir) return cfg.projectDir;
    const dir = require("path").join(require("electron").app.getPath("downloads"), "SpeakSlowAgent");
    require("fs").mkdirSync(dir, { recursive: true });
    return dir;
  }

  ipcMain.handle("agent-run-task", (e, text) => {
    const model = ctx.databaseManager.getSetting("agent_model", "anthropic");
    return ctx.agentManager.runTask({ prompt: text, model, cwd: resolveCwd() });
  });
  ipcMain.handle("agent-stop-task", () => ctx.agentManager.stop());

  // 一鍵動作:開官方安裝/登入指引(v1 先用 shell 開外部連結 / 終端;完整自動安裝列 v2)
  ipcMain.handle("agent-install-claude", () => { require("electron").shell.openExternal("https://docs.anthropic.com/claude-code"); return { success: true }; });
  ipcMain.handle("agent-install-ollama", () => { require("electron").shell.openExternal("https://ollama.com/download"); return { success: true }; });
  ipcMain.handle("agent-login-anthropic", () => {
    // 開一個終端跑 claude /login(互動式登入)
    const { spawn } = require("child_process");
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "cmd", "/k", "claude"], { windowsHide: false, detached: true });
    return { success: true };
  });
};
```

- [ ] **Step 2:註冊** — `src/helpers/ipcHandlers.js` 的 `setupHandlers()` 加一行:`require("./ipc/agent")(this);`
- [ ] **Step 3:preload 暴露** — `preload.js` 的 `electronAPI` 物件加:
```js
agentDetectBackends: () => ipcRenderer.invoke("agent-detect-backends"),
agentGetConfig: () => ipcRenderer.invoke("agent-get-config"),
agentSetConfig: (patch) => ipcRenderer.invoke("agent-set-config", patch),
agentRunTask: (text) => ipcRenderer.invoke("agent-run-task", text),
agentStopTask: () => ipcRenderer.invoke("agent-stop-task"),
agentInstallClaude: () => ipcRenderer.invoke("agent-install-claude"),
agentInstallOllama: () => ipcRenderer.invoke("agent-install-ollama"),
agentLoginAnthropic: () => ipcRenderer.invoke("agent-login-anthropic"),
onAgentTaskUpdate: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on("agent-task-update", h); return () => ipcRenderer.removeListener("agent-task-update", h); },
```
(若 `preload.js` 用 `contextBridge.exposeInMainWorld("electronAPI", {...})`,加在同一物件;事件監聽比照既有 `tts-play`/`agent-task-update` 寫法。)
- [ ] **Step 4:Commit**
```bash
git add src/helpers/ipc/agent.js src/helpers/ipcHandlers.js preload.js
git commit -m "feat(agent): ipc/agent (detect, config, run/stop, install/login) + preload"
```

## Task 5:App.jsx — agent 模式分流 + 任務事件

**Files:** Modify `src/App.jsx`

- [ ] **Step 1:加狀態**(在 `commandMode` 宣告附近,約 362 行):
```jsx
const [agentMode, setAgentMode] = useState(false);
const agentModeRef = useRef(false);
```
- [ ] **Step 2:分流**(`safePaste` 內,**在 `commandModeRef` 判斷之前**,約 671 行):
```jsx
// Agent 模式:辨識結果不貼字,交給 Claude Code 執行(攔在最前面)
if (agentModeRef.current) {
  try { await window.electronAPI?.agentRunTask?.(text); }
  catch (e) { showNotification('error', t('panel.agentError') || 'Agent 執行失敗'); }
  return; // 不貼字
}
```
- [ ] **Step 3:同步 ref + 監聽任務事件**(在既有 effect 區加一個):
```jsx
useEffect(() => { agentModeRef.current = agentMode; }, [agentMode]);
useEffect(() => {
  if (!window.electronAPI?.onAgentTaskUpdate) return;
  return window.electronAPI.onAgentTaskUpdate((p) => {
    // 用既有通知顯示完成/錯誤;完整任務列表在設定分頁(Task 7)
    if (p.status === 'done') showNotification('success', '✅ ' + (p.text || '完成').slice(0, 60));
    else if (p.status === 'error') showNotification('error', '❌ ' + (p.text || 'Agent 失敗').slice(0, 60));
  });
}, []);
```
- [ ] **Step 4:Commit**
```bash
git add src/App.jsx
git commit -m "feat(agent): route transcript to agent when agent mode on (App.jsx)"
```

## Task 6:設定鍵預設值(database/settings)

**Files:** Modify `src/settings.jsx`(loadSettings 白名單)— DB 用 KV `getSetting`/`setSetting`,無需改 schema。

- [ ] **Step 1:** 確認 `database.js` 的 `getSetting(key, default)` / `setSetting(key, value)` 存在(`ipc/agent.js` 已用)。若 `settings.jsx` 的 `loadSettings` 有欄位白名單,把 `agent_model`/`agent_work_mode`/`agent_mode_enabled`/`agent_project_dir` 加入(否則前端讀不到)。預設值見 `ipc/agent.js` 的 `agent-get-config`。
- [ ] **Step 2:Commit**(若有改)
```bash
git add src/settings.jsx
git commit -m "feat(agent): expose agent_* settings keys"
```

## Task 7:AgentPanel.jsx(dashboard)+ 接進設定頁

**Files:** Create `src/components/AgentPanel.jsx`;Modify `src/settings.jsx`

- [ ] **Step 1:`AgentPanel.jsx`**(env 狀態 + 模型 + Agent 模式開關 + 工作模式 + 任務列表;比照 `HotkeySettings.jsx` 的 React 風格與 Tailwind class):
```jsx
import React, { useState, useEffect } from "react";
import { Bot, Check, X, RefreshCw, Square } from "lucide-react";

export default function AgentPanel() {
  const [backends, setBackends] = useState(null);
  const [cfg, setCfg] = useState({ model: "anthropic", workMode: "general", enabled: false, projectDir: "" });
  const [tasks, setTasks] = useState([]); // {id, status, prompt, text}

  const refresh = () => window.electronAPI?.agentDetectBackends?.().then(setBackends).catch(() => {});
  useEffect(() => { refresh(); window.electronAPI?.agentGetConfig?.().then(setCfg).catch(() => {}); }, []);
  useEffect(() => {
    if (!window.electronAPI?.onAgentTaskUpdate) return;
    return window.electronAPI.onAgentTaskUpdate((p) => setTasks((prev) => {
      const i = prev.findIndex((t) => t.id === p.id);
      if (i >= 0) { const n = [...prev]; n[i] = p; return n; }
      return [p, ...prev].slice(0, 20);
    }));
  }, []);
  const set = (patch) => { const n = { ...cfg, ...patch }; setCfg(n); window.electronAPI?.agentSetConfig?.(patch); };

  const Row = ({ ok, label, action, actionLabel }) => (
    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
      <span className="flex items-center gap-2 text-sm">
        {ok ? <Check className="w-4 h-4 text-green-500" /> : <X className="w-4 h-4 text-red-500" />}{label}
      </span>
      {!ok && <button onClick={action} className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg">{actionLabel}</button>}
    </div>
  );

  const running = tasks.filter((t) => t.status === "running");
  const done = tasks.filter((t) => ["done", "error", "stopped"].includes(t.status));

  return (
    <div>
      <div className="flex items-center gap-2 mb-1"><Bot className="w-5 h-5 text-blue-600" /><h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">代理 Agent</h3>
        <button onClick={refresh} className="ml-auto p-1 text-gray-400 hover:text-gray-600"><RefreshCw className="w-4 h-4" /></button></div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">把辨識出來的語音,交給 Claude Code 在工作目錄執行任務。</p>

      <div className="space-y-2 mb-5">
        <Row ok={!!backends?.claudeCode} label="Claude Code 已安裝" action={() => window.electronAPI?.agentInstallClaude?.()} actionLabel="安裝" />
        <Row ok={!!backends?.ollama} label="Ollama 已安裝" action={() => window.electronAPI?.agentInstallOllama?.()} actionLabel="安裝" />
        <Row ok={!!backends?.anthropic} label="Anthropic 已登入" action={() => window.electronAPI?.agentLoginAnthropic?.()} actionLabel="登入" />
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">模型</span>
        <select value={cfg.model} onChange={(e) => set({ model: e.target.value })}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700">
          <option value="anthropic">Anthropic(Claude)</option>
          <option value="qwen2.5:cloud">Ollama Cloud</option>
        </select>
      </div>

      <label className="flex items-center justify-between p-3 bg-sky-50 dark:bg-sky-900/20 rounded-lg mb-5">
        <span className="text-sm font-medium">Agent 模式{cfg.enabled && <span className="ml-2 text-xs text-sky-600">● ON</span>}</span>
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="w-4 h-4" />
      </label>

      <h4 className="text-sm font-semibold mb-2">執行中</h4>
      {running.length === 0 ? <p className="text-xs text-gray-400 mb-3">無</p> : running.map((t) => (
        <div key={t.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-2">
          <span className="text-sm truncate">{t.prompt}</span>
          <button onClick={() => window.electronAPI?.agentStopTask?.()} className="flex items-center gap-1 px-2 py-1 text-xs text-red-600"><Square className="w-3 h-3" />停止</button>
        </div>
      ))}
      <h4 className="text-sm font-semibold mb-2 mt-3">已完成</h4>
      {done.length === 0 ? <p className="text-xs text-gray-400">無</p> : done.map((t) => (
        <div key={t.id} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-2">
          <div className="text-sm truncate">{t.status === "error" ? "❌" : t.status === "stopped" ? "⏹" : "✅"} {t.prompt}</div>
          {t.text && <div className="text-xs text-gray-500 mt-1 line-clamp-3">{t.text}</div>}
        </div>
      ))}
    </div>
  );
}
```
- [ ] **Step 2:接進設定頁** — `src/settings.jsx`:`import AgentPanel from "./components/AgentPanel";`,把 `{activeTab === 'agent' && (...)}` 內的佔位 div 內容換成 `<AgentPanel />`(外層卡片保留)。
- [ ] **Step 3:Commit**
```bash
git add src/components/AgentPanel.jsx src/settings.jsx
git commit -m "feat(agent): AgentPanel dashboard (backends, model, mode, tasks)"
```

## Task 8:i18n(可選字串)

**Files:** Modify `src/i18n/{zh-TW,zh-CN,en}.js`

- [ ] **Step 1:** AgentPanel 多用中文字面值(v1 求快);若要過 `check-i18n-keys`,把新增的 `panel.agentError` 等 key 三語系補齊(沿用 Task 8 of 早期 i18n 模式)。Run: `node scripts/check-i18n-keys.mjs` — Expected: `OK: all 3 locales ... identical`。
- [ ] **Step 2:Commit**
```bash
git add src/i18n
git commit -m "feat(agent): i18n keys for agent panel"
```

## Task 9:建置、安裝、手動驗證

- [ ] **Step 1:** 跑純函式測試:`node --test test/agent.test.mjs` — Expected: 全 PASS。
- [ ] **Step 2:** 重新 build(照本機既有流程,VS dev env + node-gyp 13;`win-unpacked` 即可):
```
powershell -File C:\Users\user\AppData\Local\Temp\fcc-prodbuild4.ps1   # 或 npm run dist:win
```
覆蓋安裝到 `D:\Users\user\AppData\Local\SpeakSlowAgent`(殺行程→複製→explorer 重啟,流程同先前)。
- [ ] **Step 3:手動驗證**:
  - 開設定 → 代理 Agent → 確認三個後端狀態正確顯示;未裝/未登入會出現一鍵按鈕。
  - 選模型;開「Agent 模式」。
  - 按右 Alt 講一句任務(例:「在工作資料夾建立一個 hello.txt 寫入今天日期」)→ 確認**不貼字**、任務進「執行中」、Claude Code 在 `Downloads\SpeakSlowAgent` 真的建檔、完成後進「已完成」、可「停止」。
  - 關「Agent 模式」→ 講話恢復正常貼字。

---

## 自我檢查(對照規格)

- 後端偵測 + 一鍵動作 ✓(T4 ipc/agent + T7 UI)
- 模型選擇 Ollama/Anthropic ✓(T1 spawn + T4/T7)
- Agent 模式開關 + 分流 ✓(T5 App.jsx + T7 開關)
- 單一任務執行(spawn + stream-json + 停止)✓(T1/T2/T3)
- 執行中 / 已完成列表 ✓(T7)
- 工作目錄(通用沙盒 / 專案)✓(T4 resolveCwd;專案模式挑資料夾 UI 屬 v2)
- 全自動 ✓(`--dangerously-skip-permissions`)+ 停止鍵 ✓(T3 stop / T7)

實作時需現場對齊(規格已標明):`claude auth status` 的實際偵測登入指令、Ollama 模型清單的確切名稱、preload 既有的 contextBridge 寫法。v2:排程、專案/通用切換 UI、一鍵自動安裝。
