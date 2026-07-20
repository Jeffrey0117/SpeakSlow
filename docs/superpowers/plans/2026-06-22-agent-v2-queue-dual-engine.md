# 代理 Agent v2 實作計畫:佇列 + 雙引擎 + 雙帳號

> 依 `docs/superpowers/specs/2026-06-22-agent-v2-queue-dual-engine-design.md`。TDD:純函式先寫測試。分支 `feat/agent-v1`(延續)。每完成一塊 commit。

**Goal:** v1 之上加任務佇列、Codex 第二引擎、Anthropic/ChatGPT 登入/登出/切換。

---

### Task 1:`agentCatalog.js` 加 Codex 模型(TDD)
- 加 `CODEX_MODELS = ["gpt-5-codex", "gpt-5"]`、`CODEX_DEFAULT_MODEL = "gpt-5-codex"`,export。
- 測試 `test/agentCatalog.test.mjs`:斷言兩者存在、default 在清單內。
- Run:`node --test test/agentCatalog.test.mjs`。Commit。

### Task 2:`agentSpawn.js` — `cli` 分支 + `parseCodexJsonLine`(TDD)
- `buildAgentSpawn({prompt, model, cwd, systemPrompt, cli})`:
  - `cli === "codex"` → `{program:"codex", args:["exec","--json","--skip-git-repo-check","--dangerously-bypass-approvals-and-sandbox","-m",model,"-C",cwd, systemPrompt+"\n\n"+prompt], cwd, env:{}}`。
  - 否則(預設)走現有 claude/ollama 邏輯(cli 預設 `"claude-code"`)。
- `parseCodexJsonLine(line)`(實測 0.141.0 shape):
  - `type = obj.type ?? obj.msg?.type`。
  - `item.completed` 且 `item.type==="agent_message"` → `{kind:"text", text: item.text ?? item.message}`。
  - `item.completed` 且 `item.type==="error"` → null(項目級非致命)。
  - `item.delta` / `agent_message_delta` → text 取 `delta.text ?? delta`(相容增量版本)。
  - `turn.completed` → `{kind:"result", text:""}`。
  - 頂層 `error` → `{kind:"result", text: obj.message||"", isError:true}`。
  - 其餘 / 非 JSON → null。
- 測試:codex spawn args、claude/ollama 仍正確(回歸)、parseCodexJsonLine 各事件(agent_message/item-error/turn.completed/雜訊)。Run。Commit。

### Task 3:`agentManager.js` — 佇列 + 引擎/parser 選擇 + 可注入 spawn(TDD)
- 建構子 `(logger, windowManager, deps={})`:`this._spawn = deps.spawn || require("child_process").spawn`。
- `this.queue = []`。`runTask({prompt, model, cwd, cli})`:配 id;忙→`queue.push({id,prompt,model,cwd,cli})` + emit `queued`;否則 `_start(item)`;最後不需 return reject(回 `{success:true,id}`)。
- `_start(item)`:用 `buildAgentSpawn`(帶 cli)+ 依 cli 選 parser(`cli==="codex"?parseCodexJsonLine:parseStreamJsonLine`);spawn 用 `this._spawn`;`close`/`error` → `this.current=null` 後 `_next()`。
- `_next()`:不忙且 `queue.length` → shift + `_start`。
- `cancel(id)`:在 queue → 移除 + emit `cancelled`;== current → `stop()`。
- `stop()`:殺 current + emit `stopped`、`current=null`、`_next()`(保留並排空佇列)。
- 測試 `test/agentQueue.test.mjs`:注入假 spawn(回 EventEmitter + stdout EventEmitter + kill),假 `_emit`(覆寫或經 deps):FIFO 兩任務(第二個先 queued 後 running)、cancel 排隊項、stop 後跑下一個、spawn 同步丟錯仍排空。Run。Commit。

### Task 4:`ipc/agent.js` — 5 列偵測 + per-engine 模型 + auth/install/cancel handlers
- `agent-detect-backends` 回 `{claudeCode, ollama, anthropic, codex, chatgpt}`:
  - `claudeCode/ollama` 同舊;`codex` = probe `codex --version`;
  - `anthropic` = probe `claude auth status`(成功)|| 舊 `.credentials.json` 退回;
  - `chatgpt` = codex 已裝 **且** probe `codex login status`(exit 0)。
- `agent-list-models`:加 `engine` 參數;`engine==="codex"` → `{models: CODEX_MODELS.map(name=>({name,tier:"chatgpt"})), default: CODEX_DEFAULT_MODEL, codex:true}`;否則現有 catalog。
- `agent-get-config`/`set-config`:加 `cli`(`agent_cli`,預設 `claude-code`)、`codexModel`(`agent_codex_model`,預設 `gpt-5-codex`)。
- `agent-run-task`:依 `agent_cli` 取 model(claude-code→`agent_model`;codex→`agent_codex_model`),`runTask({prompt,model,cwd,cli})`。
- 新 handlers:`agent-cancel-task`(id→`agentManager.cancel`)、`agent-logout-anthropic`(`spawnSync claude auth logout`)、`agent-switch-anthropic`(logout 後開終端 `claude auth login`)、`agent-install-codex`(開終端 `npm i -g @openai/codex`)、`agent-login-codex`(開終端 `codex login`)、`agent-logout-codex`(`spawnSync codex logout`)、`agent-switch-codex`(logout→開終端 login)。
- 終端開法沿用現有 `cmd /c start cmd /k <...>`。

### Task 5:`preload.js` — 新方法
- 加 `agentCancelTask(id)`、`agentLogoutAnthropic`、`agentSwitchAnthropic`、`agentInstallCodex`、`agentLoginCodex`、`agentLogoutCodex`、`agentSwitchCodex`;`agentListModels({engine,showAll,live})`、`agentRunTask` 不變。

### Task 6:`AgentPanel.jsx` — 5 列 + 引擎選擇 + 條件模型 + 排隊中
- `Row` 擴充:`ok` 時也可帶次要按鈕(登出/切換);未 ok 帶主按鈕。
- 五列:Claude Code、Ollama、Anthropic(✓→登出/切換;✗→登入)、Codex(✗→安裝)、ChatGPT(✓→登出/切換;✗→登入)。
- 引擎下拉(模型上方):claude-code / codex → `set({cli})` + 重載模型清單(`agentListModels({engine:cli})`)。
- 模型區依 cli:codex → 固定 `CODEX_MODELS`(隱藏檢查可用性/顯示全部),值存 codexModel;claude-code → 現有。`set` 寫對應鍵。
- 任務三區:執行中 → **排隊中**(每項「取消」→`agentCancelTask(t.id)`)→ 已完成(納 `cancelled`)。filter:`queued`/`running`/`['done','error','stopped','cancelled']`。
- detect 後操作(登入/登出/切換/安裝)完成 → 重新 `refresh()`。

### Task 7:`App.jsx` — 觸發帶 cli(多半已可)
- `safePaste`:Agent 模式開 → `agentGetConfig()` 已含 cli/model;`agentRunTask(text)` 不變(主程序依設定組)。確認無需改動;若 config 形狀變動則同步。

### Task 8:建置 + 安裝 + 驗證
- `node --test`(全綠)→ `npm run build:renderer` → `npx electron-builder --win --dir` → swap `app.asar` 重啟。
- 手動 E2E:5 列狀態、引擎切換改模型清單、Claude Code 跑一任務 + 排第二個看「排隊中」+ 取消、(`codex login` 後)Codex 跑一任務驗 parser、各列登入/登出/切換。

### 收尾
- 全綠 + 安裝 → final code-review(adversarial workflow)→ `superpowers:finishing-a-development-branch` 合併 `feat/agent-v1` + push fork。
