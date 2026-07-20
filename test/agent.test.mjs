import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentSpawn, parseStreamJsonLine, parseCodexJsonLine } from "../src/helpers/agentSpawn.js";

test("anthropic source: claude direct WITH --model (headless requires it)", () => {
  const s = buildAgentSpawn({ prompt: "整理桌面", model: "sonnet", cwd: "C:\\w", systemPrompt: "SYS", cli: "claude-code", source: "anthropic" });
  assert.equal(s.program, "claude");
  assert.deepEqual(s.args, [
    "--model", "sonnet",
    "--append-system-prompt", "SYS", "--dangerously-skip-permissions",
    "-p", "--output-format", "stream-json", "--verbose", "整理桌面",
  ]);
  assert.equal(s.cwd, "C:\\w");
  assert.equal(s.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, undefined);
});

test("claude-code + ollama source: via `ollama launch claude`, --model + output cap", () => {
  const s = buildAgentSpawn({ prompt: "hi", model: "gemma3:12b-cloud", cwd: "C:\\g", systemPrompt: "SYS", cli: "claude-code", source: "ollama" });
  assert.equal(s.program, "ollama");
  assert.deepEqual(s.args, [
    "launch", "claude", "--model", "gemma3:12b-cloud", "--",
    "--append-system-prompt", "SYS", "--dangerously-skip-permissions",
    "-p", "--output-format", "stream-json", "--verbose", "hi",
  ]);
  assert.equal(s.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "16384");
});

test("codex + chatgpt: full bypass, NO -m (ChatGPT account rejects model selection)", () => {
  const s = buildAgentSpawn({ prompt: "整理桌面", model: "default", cwd: "C:\\w", systemPrompt: "SYS", cli: "codex", source: "chatgpt" });
  assert.equal(s.program, "codex");
  assert.deepEqual(s.args, [
    "exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox",
    "-C", "C:\\w", "SYS\n\n整理桌面",
  ]);
  assert.ok(!s.args.includes("-m"), "ChatGPT account must not get -m (400)");
  assert.ok(!s.args.includes("--oss"));
});

test("codex + ollama source: adds --oss --local-provider ollama -m <model>", () => {
  const s = buildAgentSpawn({ prompt: "hi", model: "gpt-oss:20b-cloud", cwd: "C:\\w", systemPrompt: "SYS", cli: "codex", source: "ollama" });
  assert.equal(s.program, "codex");
  assert.deepEqual(s.args, [
    "exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox",
    "--oss", "--local-provider", "ollama",
    "-m", "gpt-oss:20b-cloud", "-C", "C:\\w", "SYS\n\nhi",
  ]);
});

test("defaults to claude-code anthropic when cli/source omitted", () => {
  const s = buildAgentSpawn({ prompt: "hi", model: "sonnet", cwd: "C:\\w", systemPrompt: "SYS" });
  assert.equal(s.program, "claude");
  assert.ok(s.args.includes("--model") && s.args.includes("sonnet"));
});

test("parseCodexJsonLine: agent_message item.completed → message (full, not delta)", () => {
  const line = JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "hi" } });
  assert.deepEqual(parseCodexJsonLine(line), { kind: "message", text: "hi" });
});
test("parseCodexJsonLine: item-level error → itemError (non-fatal diagnostic)", () => {
  const line = JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "error", message: "plugin warning" } });
  assert.deepEqual(parseCodexJsonLine(line), { kind: "itemError", text: "plugin warning" });
});
test("parseCodexJsonLine: streamed delta variant → text", () => {
  assert.deepEqual(parseCodexJsonLine(JSON.stringify({ type: "item.delta", delta: { text: "par" } })), { kind: "text", text: "par" });
  assert.deepEqual(parseCodexJsonLine(JSON.stringify({ msg: { type: "agent_message_delta", delta: "tial" } })), { kind: "text", text: "tial" });
});
test("parseCodexJsonLine: turn.completed → result (terminal)", () => {
  assert.deepEqual(parseCodexJsonLine(JSON.stringify({ type: "turn.completed", usage: {} })), { kind: "result", text: "" });
});
test("parseCodexJsonLine: top-level error → isError result", () => {
  assert.deepEqual(parseCodexJsonLine(JSON.stringify({ type: "error", message: "boom" })), { kind: "result", text: "boom", isError: true });
});
test("parseCodexJsonLine: noise / thread.started → null", () => {
  assert.equal(parseCodexJsonLine("not json"), null);
  assert.equal(parseCodexJsonLine(JSON.stringify({ type: "thread.started", thread_id: "x" })), null);
});

test("parse assistant text event → extract text", () => {
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "好的,我來整理。" }] } });
  assert.deepEqual(parseStreamJsonLine(line), { kind: "text", text: "好的,我來整理。" });
});
test("parse assistant tool_use → tool event (name: command)", () => {
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }] } });
  assert.deepEqual(parseStreamJsonLine(line), { kind: "tool", text: "Bash: ls -la" });
});
test("parseCodexJsonLine: command_execution → tool event", () => {
  const line = JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "Invoke-RestMethod -Uri http://x" } });
  assert.deepEqual(parseCodexJsonLine(line), { kind: "tool", text: "Invoke-RestMethod -Uri http://x" });
});

test("parse result event → final text + isError", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", result: "完成", is_error: false });
  assert.deepEqual(parseStreamJsonLine(line), { kind: "result", text: "完成", isError: false });
});
test("non-JSON / unrelated line → null (skip)", () => {
  assert.equal(parseStreamJsonLine("not json"), null);
  assert.equal(parseStreamJsonLine(JSON.stringify({ type: "system" })), null);
});
