// SpeakSlow 代理 Agent 的模型目錄 —— 移植自 app-free-cowork/launcher/src-tauri/src/catalog.rs。
// 單一事實來源:挑選器(經 IPC agent-list-models)與 spawn(agentSpawn.js)共用同一份,
// 避免清單漂移。免費/需訂閱分級是 2026-06-13 對 ollama 雲端全目錄實測分類的結果。

// 哨符:用使用者自己的 Anthropic 帳號直接跑真正的 Claude(不經 Ollama)。
const CLAUDE_MODEL = "claude";
// 預設模型(catalog.rs FALLBACKS[0]):輕量、省 GPU-time 免費額度。
const DEFAULT_MODEL = "minimax-m2.5:cloud";
const CATALOG_URL = "https://ollama.com/api/tags";

// Codex 引擎(走 ChatGPT 帳號)的模型 —— ChatGPT 方案的模型集是伺服器鎖定的,給固定小清單。
const CODEX_MODELS = ["gpt-5-codex", "gpt-5"];
const CODEX_DEFAULT_MODEL = "gpt-5-codex";

// Anthropic 來源(claude headless --model)的別名。claude -p 需要明確 --model,否則報互動式選模型錯誤。
const CLAUDE_MODELS = ["sonnet", "opus", "haiku"];
const CLAUDE_DEFAULT_MODEL = "sonnet";

// 實測免費可連、且能跑 Claude Code 的雲端模型(皆帶 -cloud / :cloud 後綴)。
const VERIFIED_FREE = [
  "qwen3-vl:235b-cloud", "qwen3-vl:235b-instruct-cloud", "qwen3-coder-next:cloud",
  "qwen3-next:80b-cloud", "qwen3-coder:480b-cloud", "minimax-m2.5:cloud", "glm-4.7:cloud",
  "gpt-oss:120b-cloud", "gpt-oss:20b-cloud", "gemma3:4b-cloud", "gemma3:12b-cloud",
  "gemma3:27b-cloud", "gemma4:31b-cloud", "ministral-3:3b-cloud", "ministral-3:8b-cloud",
  "ministral-3:14b-cloud", "devstral-2:123b-cloud", "devstral-small-2:24b-cloud",
  "cogito-2.1:671b-cloud", "nemotron-3-nano:30b-cloud",
  "glm-4.6:cloud", "minimax-m2:cloud", "minimax-m2.1:cloud", "minimax-m3:cloud",
  "nemotron-3-super:cloud", "nemotron-3-ultra:cloud",
];
// 實測需訂閱(HTTP 403 "requires a subscription");預設過濾隱藏,「顯示全部」才出現。
const VERIFIED_SUBSCRIPTION = [
  "minimax-m2.7:cloud", "qwen3.5:397b-cloud", "deepseek-v3.1:671b-cloud",
  "deepseek-v3.2:cloud", "glm-5:cloud", "kimi-k2:1t-cloud", "mistral-large-3:675b-cloud",
  "deepseek-v4-flash:cloud", "deepseek-v4-pro:cloud", "gemini-3-flash-preview:cloud",
  "glm-5.1:cloud", "kimi-k2-thinking:cloud", "kimi-k2.5:cloud", "kimi-k2.6:cloud",
  "kimi-k2.7-code:cloud",
];
// 免費可連、但實測跑不動 Claude Code(回 400);永遠隱藏。
const VERIFIED_INCOMPATIBLE = ["rnj-1:8b-cloud"];

const FREE = new Set(VERIFIED_FREE);
const SUB = new Set(VERIFIED_SUBSCRIPTION);
const INCOMPAT = new Set(VERIFIED_INCOMPATIBLE);

function tierOf(name) {
  if (FREE.has(name)) return "free";
  if (SUB.has(name)) return "subscription";
  if (INCOMPAT.has(name)) return "incompatible";
  return "unknown";
}

// ollama.com/api/tags 的 name 不含 cloud 後綴:無 ':' → name:cloud;有 ':' → name-cloud。
function toLocalName(name) {
  return name.includes(":") ? `${name}-cloud` : `${name}:cloud`;
}

function parseCloudModels(json) {
  let v;
  try { v = JSON.parse(json); } catch { return null; }
  if (!v || !Array.isArray(v.models)) return null;
  return v.models
    .map((m) => (m && typeof m.name === "string" ? toLocalName(m.name) : null))
    .filter(Boolean);
}

// 挑選器要顯示的清單 [{name, tier}]。incompatible 永遠隱藏。
// showAll=false → 只留 free;true → free + unknown + subscription。
// available 提供時(live 掃描結果)以它為來源並用 tierOf 標級,否則用靜態 catalog。
function listModels({ showAll = false, available = null } = {}) {
  const source = Array.isArray(available)
    ? available
    : [...VERIFIED_FREE, ...VERIFIED_SUBSCRIPTION];
  const seen = new Set();
  const out = [];
  for (const name of source) {
    if (seen.has(name)) continue;
    seen.add(name);
    const tier = tierOf(name);
    if (tier === "incompatible") continue;
    if (!showAll && tier !== "free") continue;
    out.push({ name, tier });
  }
  const rank = { free: 0, unknown: 1, subscription: 2 };
  // 免費在前、需訂閱在後;同組內依模型名稱字母排序(combobox 好找)。
  return out.sort((a, b) => (rank[a.tier] ?? 9) - (rank[b.tier] ?? 9) || a.name.localeCompare(b.name));
}

module.exports = {
  CLAUDE_MODEL, DEFAULT_MODEL, CATALOG_URL,
  CODEX_MODELS, CODEX_DEFAULT_MODEL,
  CLAUDE_MODELS, CLAUDE_DEFAULT_MODEL,
  VERIFIED_FREE, VERIFIED_SUBSCRIPTION, VERIFIED_INCOMPATIBLE,
  tierOf, toLocalName, parseCloudModels, listModels,
};
