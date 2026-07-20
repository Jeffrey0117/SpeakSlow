# 代理 Agent v2:佇列 + 雙引擎 + 雙帳號管理 — 設計

**Goal:** 在已完成的 v1(語音→Claude Code 執行)上,加(1)任務佇列「排隊中」、(2)第二執行引擎 Codex、(3)Anthropic / ChatGPT 各自的登入/登出/切換帳號。

**Architecture:** 沿用 v1 的 CommonJS 主程序 + React 渲染器 + IPC 模式。新增一層「執行引擎」抽象:`AgentManager` 依 `cli` 決定 spawn 哪個 CLI 與用哪個 parser。模型目錄與帳號偵測都對齊 app-free-cowork 的既有模式。

**Tech Stack:** Electron 31 (Node 20) + React 19 + Tailwind + `node --test`。外部 CLI:`claude`(2.1.174,已裝)、`codex`(`@openai/codex`,本次安裝)。

---

## 調查確認的事實(2026-06-22)

### Claude Code 認證(已在本機驗證,claude 2.1.174)
- `claude auth status --json`(預設 JSON;或 `--text`)→ **權威**登入偵測。
- `claude auth login`(`--email <e>` / `--console` / `--sso`)→ 瀏覽器 OAuth 登入。
- `claude auth logout` → 即時、非互動登出(**用這個,不要刪檔**;可能有 keychain)。
- 切換帳號 = `claude auth logout` 後 `claude auth login`(無單一 switch 子指令)。
- 認證檔:`%USERPROFILE%\.claude\.credentials.json`;另 `~/.claude.json` 的 `oauthAccount` 為 free-cowork 用的被動判斷依據。

### Codex 認證/執行(✅ 已在本機驗證,codex-cli 0.141.0)
- 套件 `@openai/codex`,bin `codex`,`npm i -g @openai/codex`,node ≥16。已裝於 `~/AppData/Roaming/npm/codex`。
- 安裝偵測:`codex --version`(ENOENT/非 0 = 未裝)。
- 登入偵測:**`codex login status`**(exit 0 + "Logged in using ChatGPT" = 已登入),gate 在 codex 已裝。
  **⚠️ 本機**:因別工具殘留的 `~/.codex/auth.json`,`codex login status` 目前回報已登入;使用者自己 `codex login` 會覆蓋成本人帳號。
- `codex login`(瀏覽器,互動)/ `codex login --with-api-key`(讀 stdin)/ `codex logout`(即時)。切換 = logout→login。
- 全自動非互動執行(✅ 旗標已確認):
  `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -m <model> -C <dir> "<prompt>"`
  - `--dangerously-bypass-approvals-and-sandbox`(無核准、無沙箱)= Claude `--dangerously-skip-permissions` 對等(**使用者已選此等級**)。
  - `--json` = "Print events to stdout as JSONL";`-C/--cd <DIR>` 工作根目錄;`--output-last-message <FILE>` 可選(最終訊息寫檔)。
  - 無 `--append-system-prompt` → v1 把系統提示**前綴**進 prompt(`AGENTS.md` 為備案)。
- JSON 事件(✅ 實測 0.141.0,一行一物件,`type` 鑑別):
  `thread.started` → `turn.started` → `item.completed{item:{type:"agent_message",text:"…"}}`(助理訊息,**本版直接給全文,非增量**)→ `turn.completed{usage}`(**終點**)。
  `item.completed{item:{type:"error",message}}` = 項目級錯誤(如外掛警告,**非致命、不終止**);頂層 `{type:"error"}` 才是硬錯。
  → 解析:`type ?? msg.type`;助理文字取 `item.text ?? item.message`;相容增量 `item.delta`/`agent_message_delta`(`delta.text ?? delta`)。

### free-cowork 模式(對齊用)
- 登入偵測被動、不 spawn;安裝與登入狀態**解耦**;未登入是**軟提示**不擋送出。
- 模型 tier 優先序:anthropic > incompatible > broken > subscription > free > unknown。
- 本身**無**登出/切換(靠切模型 + Claude 自己 /login)——本次新增的帳號管理是 v1 沒有的,靠 `claude auth` / `codex` 子指令撐。

---

## 元件設計

### 1. 後端狀態列(`AgentPanel` + `ipc/agent.js` 的 `agent-detect-backends`)
五列,各依狀態給按鈕:

| 列 | 偵測 | 已就緒按鈕 | 未就緒按鈕 |
|---|---|---|---|
| Claude Code 已安裝 | `claude --version` 成功 | — | 安裝(開文件) |
| Ollama 已安裝 | `ollama --version` 成功 | — | 安裝(開下載頁) |
| Anthropic 已登入 | `claude auth status` 成功 / 退回 `.claude.json` oauthAccount | 登出、切換帳號 | 登入 |
| Codex 已安裝 | `codex --version` 成功 | — | 安裝(終端 `npm i -g @openai/codex`) |
| ChatGPT 已登入 | codex 已裝 **且** `codex login status` exit 0 | 登出、切換帳號 | 登入 |

新 IPC:`agent-logout-anthropic`(`claude auth logout`)、`agent-switch-anthropic`(logout→開終端 login)、`agent-install-codex`、`agent-login-codex`、`agent-logout-codex`、`agent-switch-codex`。
- 登入/切換:開終端跑(瀏覽器 OAuth);登出:`spawnSync` 即時 + 回傳後前端重新 detect。

### 2. 執行引擎 + 模型(`AgentPanel`)
- **執行引擎**下拉:`Claude Code`(值 `claude-code`)/ `Codex`(值 `codex`)。存設定 `agent_cli`,預設 `claude-code`。
- 模型區依引擎切換內容:
  - `claude-code` → 現有 `agent-list-models` catalog(Claude 哨符 + Ollama 免費/需訂閱;檢查可用性 / 顯示全部)。存 `agent_model`。
  - `codex` → 固定清單 `gpt-5-codex`(預設)、`gpt-5`(隱藏檢查可用性/顯示全部)。存 `agent_codex_model`。
- `agentCatalog.js` 加 `CODEX_MODELS = ["gpt-5-codex", "gpt-5"]` 與 `CODEX_DEFAULT_MODEL = "gpt-5-codex"`。

### 3. spawn 分支(`agentSpawn.js` 的 `buildAgentSpawn` 加 `cli`)
```
cli="claude-code":
  model="claude"        → claude --append-system-prompt <sys> --dangerously-skip-permissions -p --output-format stream-json --verbose "<prompt>"
  model=<ollama 名>     → ollama launch claude -- claude --model <m> ...同上... (env CLAUDE_CODE_MAX_OUTPUT_TOKENS=16384)
cli="codex":
  → codex exec --json --cd <cwd> --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -m <model> "<sys>\n\n<prompt>"
```
(Codex 把 `<sys>` 前綴進 prompt;`--cd` 已是 cwd,spawn 的 cwd 也設同值。)

### 4. 結果解析(`agentSpawn.js`)
- 既有 `parseStreamJsonLine`(Claude)不動。
- 新增 `parseCodexJsonLine(line)` 防禦式 → `{kind:'text'|'result', text, isError?}` 或 null。
- `AgentManager` 依 `cli` 選 parser。

### 5. 佇列「排隊中」(`AgentManager`)
- 加 `this.queue = []`;`runTask({prompt, cli, model, cwd})` **不再拒絕**:配 id,忙碌→入列 emit `queued`,否則直接起;最後呼 `_next()`。
- `_next()`:不忙且佇列非空 → 取首個 spawn(一次一個);child `close`/`error` → `this.current=null` 後再 `_next()` 排空。
- `cancel(id)`:排隊項 → 移除 + emit `cancelled`;若 id = 當前 → 等同 `stop()`。
- `stop()`:殺當前 + emit `stopped`,**保留佇列**,接著 `_next()` 跑下一個。
- 狀態:`queued → running → done/error/stopped/cancelled`;`cli`+`model` 於**入列當下**鎖定(IPC 讀設定後傳入)。
- 可測性:建構子接受 `deps.spawn`(預設 `child_process.spawn`)注入 → `node --test` 用假 child(EventEmitter + stdout/kill)測順序/取消/丟錯排空,不起真 CLI。

### 6. 面板任務區(`AgentPanel`)
- 順序:執行中 → **排隊中**(新,每項「取消」鈕呼 `agentCancelTask(id)`)→ 已完成(納入 `cancelled`,圖示 ⏹/🚫)。
- 訂閱 `onAgentTaskUpdate`:依 status 分流三區。

### 7. App.jsx 觸發(不變的分流)
- `safePaste`:Agent 模式開 → 讀 `agentGetConfig()`(含 cli/model)→ `agentRunTask(text)`,不貼字。佇列在主程序端處理,前端只送。

---

## 設定鍵
`agent_cli`('claude-code'|'codex',預設 claude-code)、`agent_model`(claude-code 用)、`agent_codex_model`(codex 用,預設 gpt-5-codex)、既有 `agent_work_mode`/`agent_mode_enabled`/`agent_project_dir`。

## 錯誤處理
- 偵測全 best-effort,失敗 → 顯示未就緒 + 對應按鈕,不擋。
- 選 Codex 但未裝/未登入 → 任務會以 `error` 結束(spawn ENOENT / codex 報錯),面板「已完成」顯示 ❌ + 錯誤文字。
- ChatGPT 偵測務必先 gate 在 codex 已裝(避開本機 `~/.codex` 衝突)。

## 測試
- `node --test`:`buildAgentSpawn`(claude / ollama / **codex** 三路)、`parseCodexJsonLine`(delta/completed/turn.completed/error/雜訊)、`AgentManager` 佇列(FIFO 順序、cancel 排隊項、stop 後排空、spawn 丟錯排空)、`agentCatalog` codex 模型。
- 建置:`build:renderer` + `electron-builder --dir`,swap `app.asar` 重裝。
- 手動 E2E:Claude Code 引擎跑一任務 + 同時排第二個看「排隊中」;Codex 引擎(待 `codex login` 後)跑一任務驗證 parser;各帳號列的登入/登出/切換。

## 風險 / 已知未決
- Codex 旗標與 JSON 欄位為**依知識**,需在已裝 codex 上以 `codex exec --help` + 一次 `codex exec --json` 鎖定(本次安裝後處理)。
- ChatGPT-方案模型集是伺服器鎖定,固定清單可能需依實機調整。
- Codex 登入需瀏覽器互動 → 由使用者在終端完成,App 只開終端 + 之後重新偵測。
