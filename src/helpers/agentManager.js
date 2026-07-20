const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const { buildAgentSpawn, parseStreamJsonLine, parseCodexJsonLine } = require("./agentSpawn.js");

// 預設 agent 系統提示:要它「直接動手做」而非只解釋。
const AGENT_SYSTEM_PROMPT =
  "你是使用者電腦上的執行型助理。使用者用語音下達指令,請直接動手完成(建立/修改檔案、執行命令)," +
  "不要只解釋步驟。完成後用一句繁體中文回報結果。";

// claude 執行檔:優先 ~/.local/bin/claude(.exe),否則靠 PATH。
function claudeProgram() {
  const p = path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  try { require("fs").accessSync(p); return p; } catch { return "claude"; }
}

// codex 在 Windows 由 npm 裝成 .cmd shim(PATH 上沒有 codex.exe)→ Node 無 shell 的 spawn 會 ENOENT。
// 解析 shim 背後的 codex.js,改用 `node <codex.js>`(node 是真 .exe;參數走 argv 陣列、無 shell,
// 故 prompt 含換行/特殊字元也安全,沒有命令注入)。回傳要前置的 {program, args};null = 維持原樣。
function codexProgram() {
  if (process.platform !== "win32") return null; // mac/linux 的 codex 多為真執行檔,原樣 spawn 即可
  try {
    const { execFileSync } = require("child_process");
    const fs = require("fs");
    const out = execFileSync("where", ["codex"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim();
      if (!p) continue;
      const js = path.join(path.dirname(p), "node_modules", "@openai", "codex", "bin", "codex.js");
      if (fs.existsSync(js)) return { program: "node", args: [js] };
    }
  } catch (e) { /* 找不到 → 退回原樣 */ }
  return null;
}

class AgentManager {
  // deps:{ spawn, emit } 供測試注入(預設用真 child_process.spawn 與廣播到所有視窗)。
  constructor(logger, windowManager, deps = {}) {
    this.logger = logger || console;
    this.windowManager = windowManager;
    this._spawn = deps.spawn || spawn;
    this._emitFn = deps.emit || null;
    this._db = deps.db || null; // 持久化歷史用(可選)
    this.current = null; // { id, child, status, prompt }
    this.queue = [];      // [{ id, prompt, model, cwd, cli }]
    this.nextId = Date.now(); // 時間戳起始 → 重啟後不會與持久化歷史的舊 id 撞號
  }

  // 持久化已完成任務(done/error/stopped/cancelled)到 DB,重啟後仍可在「已完成」看到。
  _persistDone(task) {
    if (!this._db) return;
    try {
      const hist = this._db.getSetting("agent_history", []) || [];
      hist.unshift({ id: task.id, prompt: task.prompt, status: task.status, text: task.text || "", tools: task.tools || [], ts: Date.now() });
      this._db.setSetting("agent_history", hist.slice(0, 50));
    } catch (e) { /* 持久化失敗不影響執行 */ }
  }

  isBusy() { return !!this.current && this.current.status === "running"; }

  // 不再拒絕:忙碌則排隊(status "queued"),否則直接起。一次只跑一個。
  runTask({ prompt, model, cwd, cli, source }) {
    if (!prompt || !prompt.trim()) return { success: false, error: "空白指令" };
    const id = this.nextId++;
    const item = { id, prompt, model, cwd, cli: cli || "claude-code", source };
    if (this.isBusy()) {
      this.queue.push(item);
      this._emit({ id, status: "queued", prompt, text: "" });
    } else {
      this._start(item);
    }
    return { success: true, id };
  }

  _start(item) {
    const { id, prompt, model, cwd, cli, source } = item;
    const spec = buildAgentSpawn({ prompt, model, cwd, systemPrompt: AGENT_SYSTEM_PROMPT, cli, source });
    if (spec.program === "claude") spec.program = claudeProgram();
    else if (spec.program === "codex") {
      const c = codexProgram(); // Windows:codex.cmd → `node codex.js`
      if (c) { spec.program = c.program; spec.args = [...c.args, ...spec.args]; }
    }

    let child;
    try {
      // stdin: "ignore" → CLI 立即拿到 EOF,不會卡在等 stdin。
      // (codex exec 給了 prompt 又看到開著的 stdin pipe 會一直讀到 EOF → 永久卡住;claude 也會等 3 秒。)
      child = this._spawn(spec.program, spec.args, { cwd, env: { ...process.env, ...spec.env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      this.current = null;
      this._emit({ id, status: "error", prompt, text: "啟動失敗: " + e.message });
      this._next();
      return;
    }
    this.current = { id, child, status: "running", prompt };
    this._emit({ id, status: "running", prompt, text: "" });

    const parse = cli === "codex" ? parseCodexJsonLine : parseStreamJsonLine;
    let buf = "";
    let lastText = "";
    let lastItemError = "";
    const tools = []; // 工具呼叫清單(🔧),隨任務累積
    child.stdout.on("data", (chunk) => {
      if (!this.current || this.current.child !== child) return; // 過時 child(被 stop/取代)不可再發事件
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        const ev = parse(line.trim());
        if (!ev) continue;
        if (ev.kind === "text") { lastText += ev.text; this._emit({ id, status: "running", prompt, text: lastText, tools: [...tools] }); }
        else if (ev.kind === "message") { lastText += (lastText ? "\n" : "") + ev.text; this._emit({ id, status: "running", prompt, text: lastText, tools: [...tools] }); }
        else if (ev.kind === "tool") { tools.push(ev.text); if (tools.length > 50) tools.shift(); this._emit({ id, status: "running", prompt, text: lastText, tools: [...tools] }); }
        else if (ev.kind === "itemError") { lastItemError = ev.text || lastItemError; } // 非致命,僅留診斷
        else if (ev.kind === "result") lastText = ev.text || lastText;
      }
    });
    child.stderr.on("data", (d) => this.logger.info && this.logger.info("[agent stderr] " + d.toString().slice(0, 200)));
    // 過時事件守衛:被 stop()/取代後,舊 child 的 close/error 不可動到 this.current 或再排空。
    child.on("error", (e) => {
      if (!this.current || this.current.child !== child) return;
      this.current = null;
      this._emit({ id, status: "error", prompt, text: "啟動失敗: " + e.message });
      this._next();
    });
    child.on("close", (code) => {
      if (!this.current || this.current.child !== child) return;
      this.current = null;
      // 非零退出且沒有任何輸出時,退而用項目級錯誤訊息當診斷(否則面板只看到 ❌ 沒原因)。
      const text = code === 0 ? lastText : (lastText || lastItemError || "");
      const payload = { id, status: code === 0 ? "done" : "error", prompt, text, tools: [...tools] };
      this._emit(payload);
      this._persistDone(payload);
      this._next();
    });
  }

  _next() {
    if (this.current || this.queue.length === 0) return;
    this._start(this.queue.shift());
  }

  // 取消:排隊項 → 移除;當前項 → 等同 stop。
  cancel(id) {
    const i = this.queue.findIndex((t) => t.id === id);
    if (i >= 0) {
      const [item] = this.queue.splice(i, 1);
      const payload = { id, status: "cancelled", prompt: item.prompt, text: "已取消" };
      this._emit(payload);
      this._persistDone(payload);
      return { success: true };
    }
    if (this.current && this.current.id === id) return this.stop();
    return { success: false, error: "找不到任務" };
  }

  stop() {
    if (this.current && this.current.child) { try { this.current.child.kill(); } catch (e) {} }
    if (this.current) {
      const payload = { id: this.current.id, status: "stopped", prompt: this.current.prompt, text: "已停止" };
      this._emit(payload);
      this._persistDone(payload);
      this.current = null;
    }
    this._next(); // 停掉當前後,接著跑佇列下一個
    return { success: true };
  }

  _emit(payload) {
    if (this._emitFn) { this._emitFn(payload); return; } // 測試注入
    // 廣播到所有視窗:主視窗(App.jsx 通知)與設定視窗(AgentPanel 任務列表)都要收到。
    try {
      const { BrowserWindow } = require("electron");
      for (const w of BrowserWindow.getAllWindows()) {
        if (w && !w.isDestroyed()) w.webContents.send("agent-task-update", payload);
      }
    } catch (e) { /* 視窗尚未就緒 / 無視窗 */ }
  }
}

module.exports = AgentManager;
