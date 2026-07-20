# 設計規格:代理 Agent(語音 → Claude Code 執行任務)

狀態:設計定稿(使用者已口頭核可)、**尚未實作**。
日期:2026-06-22
專案:SpeakSlowAgent(fork 自 Jeffrey0117/SpeakSlow;Electron + React + Python sherpa 後端)

## 目標

在 SpeakSlow 既有的「快速本地中文語音輸入」上,新增一個「**代理 Agent**」模式:
開啟 Agent 模式後,按右 Alt 講的每一句話,不再貼到游標,而是當成**指令交給 Claude Code 在一個工作目錄裡執行任務**(改檔、跑命令…),結果以任務佇列(執行中/已完成)的方式串流顯示。本質上是把使用者另一個專案 app-free-cowork 的「語音 → Claude Code → 佇列」引擎,用 SpeakSlow 的快速語音重做一套。

## 核心決策(使用者已確認)

| 項目 | 決定 |
|---|---|
| Agent 本質 | 會**執行動作**、**全自動**(Claude Code 跑到底不問);必備「停止」鍵當安全網 |
| 後端引擎 | **Claude Code CLI**(`claude`),以 stream-json 串流輸出 |
| 模型 | 可選 **Ollama Cloud** 或 **Anthropic(Claude)**;兩者都透過 Claude Code 跑 |
| 用途 | **專案模式** + **通用模式**(可切) |
| 工作目錄 | 通用模式 → `Downloads\SpeakSlowAgent\` 沙盒(首次自動建、可改);專案模式 → 資料夾對話框挑 repo,記最近用過的 |
| 觸發 | **明確的「Agent 模式」開關**:開 → 右 Alt 每句都送 agent;關 → 維持原本貼字。面板有「Agent 模式 ON」指示。**不做自動判斷**(全自動下誤判代價太高) |
| 頁面 | 全部集中在「代理 Agent」設定分頁(dashboard) |
| 結果 | 任務佇列(執行中 + 串流 / 已完成),風格參考 app-free-cowork 面板 |

## 架構(三層)

- **React 渲染層**:`代理 Agent` 設定分頁(`settings.jsx` 內,已有佔位)。env 狀態、模型選擇、Agent 模式開關、工作目錄/模式、任務列表。
- **Electron 主程序**:新 `helpers/agentManager.js` —— spawn `claude`、管理任務佇列、解析 stream-json、emit 進度;`helpers/ipc/agent.js` —— IPC 命令;歷史存既有 `better-sqlite3`(`helpers/database.js`)。
- **Claude Code(外部 CLI)**:實際執行者。`agentManager` 用 `child_process.spawn` 啟動,設工作目錄、依模型注入設定、`--output-format stream-json`、全自動(`--dangerously-skip-permissions` 或對應旗標),逐行解析。

**不接 app-free-cowork**(跨棧:Tauri/Rust vs Electron/Node,耦合醜);只照抄其設計與 stream-json 解析邏輯。

## 辨識文字的分流(關鍵整合點)

目前 `App.jsx`(約 671 行)的辨識完成處理:
```
if (commandModeRef.current) { runVoiceCommand(text); return; }  // 操作模式
// 否則:貼到游標
```
新增**平行的 agent 分支**(放在最前面):
```
if (agentModeRef.current) { window.electronAPI.runAgentTask(text); return; }  // 不貼字,送 agent
if (commandModeRef.current) { runVoiceCommand(text); return; }
// 否則:貼到游標
```
- `agentMode` 是**獨立的新狀態**(`App.jsx` 加 `agentMode` + `agentModeRef`),與既有 `commandMode`(操作模式)互斥、並列。
- 開關由「代理 Agent」分頁的 switch 控制(可加面板指示燈,比照 commandMode 的藍色脈動)。

## 後端/環境管理(Agent 分頁上半)

三個後端狀態檢查,各帶一鍵動作:

| 檢查 | 偵測方式 | 一鍵動作 |
|---|---|---|
| Claude Code 安裝 | 探 `claude --version` | 安裝/更新(官方安裝指令或 `npm i -g @anthropic-ai/claude-code`)|
| Ollama 安裝 | 探 `ollama --version` | 一鍵安裝(官方安裝程式) |
| Anthropic 登入 | 探 Claude Code 認證狀態 | 一鍵登入(spawn Claude Code `/login` 流程) |

- **模型選擇**:`Ollama Cloud` / `Anthropic`。存設定。
  - `anthropic` → Claude Code 用 Anthropic 帳號(需登入)。
  - `ollama` → Claude Code 指向 Ollama(沿用 app-free-cowork 的機制:以環境變數/設定把 Claude Code 的端點指到 Ollama;實作時對照 launcher 的做法確認確切旗標/env)。
- 偵測結果即時顯示 ✓/✗;動作執行中顯示進度,完成後重新偵測。

## 任務執行(agentManager)

1. `runAgentTask(text)`:把文字當 prompt 建立一個任務,進佇列。
2. spawn `claude`:`cwd` = 當前工作目錄(依模式);旗標含 stream-json + 全自動;依模型注入 Ollama/Anthropic 設定。
3. 逐行解析 stream-json(assistant / tool_use / result 等;對照 app-free-cowork 既有解析),emit 進度事件給渲染層。
4. 完成 → 標記完成、存歷史(prompt、結果摘要、exit、耗時)。
5. **停止**:能中止執行中的任務(kill 子行程)。

## 「代理 Agent」分頁版面

1. **後端狀態列**:Claude Code / Ollama / Anthropic 狀態 + 一鍵動作;模型下拉。
2. **模式區**:`Agent 模式` 開關 + ON 指示;工作模式(專案/通用)+ 工作目錄(顯示/挑選/開啟)。
3. **任務區**(app-free-cowork 風格):
   - 執行中:任務文字 + 串流狀態 + 「停止」。
   - 已完成:成功/失敗 + 可展開看結果。
   - 代辦/排程(v2):定時任務清單 + 管理。

## 資料模型

- 沿用 `better-sqlite3`(`database.js`):新增 agent 任務歷史(prompt、模式、工作目錄、模型、結果摘要、狀態、時間)。
- 設定鍵:`agent_mode_enabled`、`agent_work_mode`(project/general)、`agent_project_dir`、`agent_general_dir`、`agent_model`(ollama/anthropic)、`agent_recent_dirs`。
- 排程(v2):任務 + recurrence(照抄 app-free-cowork 的排程資料模型)。

## 錯誤處理

- Claude Code / Ollama 未裝、Anthropic 未登入 → 狀態列顯示 ✗ + 引導一鍵動作;Agent 模式下若後端未就緒 → 任務標記失敗並提示,不靜默吞掉。
- spawn 失敗 / 子行程崩潰 → 任務標記失敗 + 錯誤訊息。
- 工作目錄不存在 → 通用模式自動建立;專案模式提示重選。

## 測試

- **純函式單元測試**:stream-json 行解析、模型→spawn 旗標/env 對應、工作目錄解析、任務狀態機(排隊→執行中→完成/失敗/停止)。
- **手動驗證**:開 Agent 模式 → 講一句任務 → 確認 Claude Code 在正確工作目錄執行、串流顯示、可停止、完成寫歷史;關 Agent 模式 → 維持原本貼字。

## 分階段

- **v1**(本輪計畫目標):後端狀態檢查 + 一鍵動作、模型選擇、Agent 模式開關 + App.jsx 分流、**單一任務執行**(spawn Claude Code、stream-json 串流、停止)、執行中/已完成列表、歷史。
- **v2**:代辦/排程(定時任務)、專案/通用模式切換 + 工作目錄管理 UI、多任務佇列。
- **v3**:喚醒詞觸發、朗讀完成摘要、進階佇列控制。

## 範圍外(YAGNI)

- 自動判斷「文字是不是動作」(已決定不做)。
- 接 app-free-cowork 本體(只抄設計)。
- 動作前逐項確認(已選全自動)。
- 多輪對話式 agent(先做單任務;每次任務 = 一次 Claude Code 執行)。

## 可借鏡 app-free-cowork(設計藍圖)

- Claude Code spawn + stream-json 解析(`result`/`assistant` 事件)。
- 佇列狀態機(排隊/執行中/已完成 + 接續)。
- 排程(recurrence + next_run + 30s tick),v2 用。
- 模型「Ollama vs Anthropic」如何注入 Claude Code 的確切機制(實作時對照)。
