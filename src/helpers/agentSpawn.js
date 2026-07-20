// 純函式:依執行引擎(cli)與模型組出 spawn 的 {program, args, cwd, env}。
// cli="claude-code"(預設,機制照抄 app-free-cowork/launcher.rs):
//   model "claude" → 直接跑 claude(走 Anthropic 帳號);其餘視為 ollama 模型(如
//   "gemma3:12b-cloud")→ ollama launch claude -- claude --model <m>
// cli="codex":走 OpenAI Codex CLI(走 ChatGPT 帳號)→ codex exec --json …(實測 0.141.0)。
// 路徑由 (cli, source) 決定;model 為各來源的模型名(anthropic=sonnet/opus、ollama=雲端名、codex=gpt-5-codex)。
const CLAUDE_FLAGS = (systemPrompt, prompt) => [
  "--append-system-prompt", systemPrompt,
  "--dangerously-skip-permissions",
  "-p", "--output-format", "stream-json", "--verbose",
  prompt,
];

function buildAgentSpawn({ prompt, model, cwd, systemPrompt, cli = "claude-code", source }) {
  if (cli === "codex") {
    // Codex 無 --append-system-prompt → 系統提示前綴進 prompt。
    // --dangerously-bypass-approvals-and-sandbox = Claude 的 --dangerously-skip-permissions 對等。
    // source="ollama" → 本地 OSS 供應商(ollama)+ 指定模型;
    // source="chatgpt" → 用 ChatGPT 帳號的伺服器固定模型,**不可帶 -m**
    //   (帶 gpt-5-codex 等會被 400「not supported when using Codex with a ChatGPT account」拒絕)。
    const modelArgs = source === "ollama" ? ["--oss", "--local-provider", "ollama", "-m", model] : [];
    return {
      program: "codex",
      args: [
        "exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox",
        ...modelArgs, "-C", cwd, `${systemPrompt}\n\n${prompt}`,
      ],
      cwd,
      env: {},
    };
  }
  // claude-code + Ollama:`ollama launch claude --model <m> -- <claude 旗標>`。
  // 重點:--model 是 `ollama launch` 的旗標(在 -- 之前);-- 後面才是傳給 claude 的旗標,
  // 不可再寫一次 claude、也不可把 --model 放到 -- 後面(否則 ollama launch 拿不到 model,
  // 內層 claude 進互動式選模型 → headless 直接失敗)。對齊 app-free-cowork/launcher.rs:103-116。
  if (source === "ollama") {
    return {
      program: "ollama",
      args: ["launch", "claude", "--model", model, "--", ...CLAUDE_FLAGS(systemPrompt, prompt)],
      cwd,
      env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "16384" },
    };
  }
  // claude-code + Anthropic:claude headless 必須帶 --model(否則報
  // "model selection requires an interactive terminal" 直接失敗)。model = sonnet/opus/haiku 別名。
  return {
    program: "claude",
    args: ["--model", model, ...CLAUDE_FLAGS(systemPrompt, prompt)],
    cwd,
    env: {},
  };
}

// 解析 claude stream-json 的一行 JSONL。回傳 {kind:'text'|'result', text, isError?} 或 null(略過)。
function parseStreamJsonLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  if (obj.type === "assistant" && obj.message?.content) {
    const content = obj.message.content;
    const text = content.filter((c) => c.type === "text").map((c) => c.text).join("");
    if (text) return { kind: "text", text };
    const tool = content.find((c) => c.type === "tool_use"); // 工具呼叫(Bash/Read…)→ 顯示 name: 指令
    if (tool) {
      const inp = tool.input || {};
      const detail = inp.command || inp.file_path || inp.path || inp.pattern || "";
      return { kind: "tool", text: detail ? `${tool.name}: ${detail}` : (tool.name || "tool") };
    }
    return null;
  }
  if (obj.type === "result") {
    return { kind: "result", text: typeof obj.result === "string" ? obj.result : "", isError: obj.is_error === true };
  }
  return null;
}

// 解析 codex exec --json 的一行 JSONL(實測 codex-cli 0.141.0)。
// 回傳 {kind:'text'|'message'|'itemError'|'result', text, isError?} 或 null(略過)。
//  text=增量;message=整則(本版用);itemError=項目級錯誤(非致命診斷);result=終點。
function parseCodexJsonLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const type = obj.type || (obj.msg && obj.msg.type);

  if (type === "item.completed" && obj.item) {
    const it = obj.item;
    if (it.type === "agent_message") {
      const text = typeof it.text === "string" ? it.text : (typeof it.message === "string" ? it.message : "");
      return text ? { kind: "message", text } : null; // 整則訊息(非增量)→ manager 以分隔線串接
    }
    if (it.type === "command_execution") { // 工具呼叫:顯示執行的指令
      return { kind: "tool", text: typeof it.command === "string" ? it.command : "command" };
    }
    if (it.type === "error") { // 項目級錯誤(如外掛警告)非致命:留著當非零退出時的診斷訊息
      return { kind: "itemError", text: typeof it.message === "string" ? it.message : "" };
    }
    return null;
  }
  // 增量串流版本相容(本版直接給全文,但其他版本可能是 delta)
  if (type === "item.delta" || type === "agent_message_delta") {
    const d = obj.delta != null ? obj.delta : (obj.msg && obj.msg.delta); // delta 可能在頂層或 msg 內
    const text = typeof d === "string" ? d : (d && (d.text || d.message)) || "";
    return text ? { kind: "text", text } : null;
  }
  if (type === "agent_message" && (obj.text || obj.message)) {
    return { kind: "message", text: obj.text || obj.message };
  }
  if (type === "turn.completed") return { kind: "result", text: "" }; // 終點(最終文字已由 agent_message 累積)
  if (type === "error") return { kind: "result", text: typeof obj.message === "string" ? obj.message : "", isError: true };
  return null;
}

module.exports = { buildAgentSpawn, parseStreamJsonLine, parseCodexJsonLine };
