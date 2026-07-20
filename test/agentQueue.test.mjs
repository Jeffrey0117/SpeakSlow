import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AgentManager = require("../src/helpers/agentManager.js");

// 注入假 spawn(回 EventEmitter 假 child)與假 emit(收集事件),不起真 CLI。
function makeHarness(opts = {}) {
  const children = [];
  const events = [];
  const throwOn = new Set(opts.throwOn || []);
  let callIdx = -1;
  const spawn = (program, args) => {
    callIdx++;
    if (throwOn.has(callIdx)) throw new Error("spawn ENOENT");
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    child.program = program; child.args = args;
    children.push(child);
    return child;
  };
  const emit = (p) => events.push(p);
  const mgr = new AgentManager(console, null, { spawn, emit, db: opts.db });
  return { mgr, children, events };
}
const last = (events, id) => [...events].reverse().find((e) => e.id === id);

test("FIFO: second task queues while first runs, then starts on close", () => {
  const { mgr, children, events } = makeHarness();
  const a = mgr.runTask({ prompt: "A", model: "claude", cwd: "C:\\w", cli: "claude-code" });
  const b = mgr.runTask({ prompt: "B", model: "claude", cwd: "C:\\w", cli: "claude-code" });
  assert.equal(last(events, a.id).status, "running");
  assert.equal(last(events, b.id).status, "queued");
  assert.equal(children.length, 1); // 只 spawn 了 A
  children[0].emit("close", 0); // A 完成 → 排空 → 起 B
  assert.equal(last(events, a.id).status, "done");
  assert.equal(last(events, b.id).status, "running");
  assert.equal(children.length, 2);
});

test("cancel a queued task removes it without touching the running one", () => {
  const { mgr, events } = makeHarness();
  const a = mgr.runTask({ prompt: "A", model: "claude", cwd: "C:\\w" });
  const b = mgr.runTask({ prompt: "B", model: "claude", cwd: "C:\\w" });
  mgr.cancel(b.id);
  assert.equal(last(events, b.id).status, "cancelled");
  assert.equal(mgr.isBusy(), true);
  assert.equal(last(events, a.id).status, "running");
});

test("stop kills the current and drains the queue (next starts); stale close ignored", () => {
  const { mgr, children, events } = makeHarness();
  const a = mgr.runTask({ prompt: "A", model: "claude", cwd: "C:\\w" });
  const b = mgr.runTask({ prompt: "B", model: "claude", cwd: "C:\\w" });
  mgr.stop();
  assert.equal(children[0].killed, true);
  assert.equal(last(events, a.id).status, "stopped");
  assert.equal(last(events, b.id).status, "running");
  children[0].emit("close", null); // 被殺的 A 過時 close 不可蓋掉 B
  assert.equal(last(events, b.id).status, "running");
  assert.equal(mgr.isBusy(), true);
});

test("spawn throwing during drain still recovers (not stuck)", () => {
  const { mgr, children, events } = makeHarness({ throwOn: [1] }); // 第 2 次 spawn(B)丟錯
  const a = mgr.runTask({ prompt: "A", model: "claude", cwd: "C:\\w" });
  const b = mgr.runTask({ prompt: "B", model: "claude", cwd: "C:\\w" });
  children[0].emit("close", 0); // A done → _next → B spawn 丟錯
  assert.equal(last(events, a.id).status, "done");
  assert.equal(last(events, b.id).status, "error");
  assert.equal(mgr.isBusy(), false);
  assert.equal(mgr.current, null);
});

test("completed task is persisted to db history (survives restart)", () => {
  const store = {};
  const db = { getSetting: (k, d) => (k in store ? store[k] : d), setSetting: (k, v) => { store[k] = v; } };
  const { mgr, children } = makeHarness({ db });
  const a = mgr.runTask({ prompt: "做事", model: "sonnet", cwd: "C:\\w", source: "anthropic" });
  children[0].emit("close", 0);
  const hist = store["agent_history"];
  assert.ok(Array.isArray(hist) && hist.length === 1);
  assert.equal(hist[0].id, a.id);
  assert.equal(hist[0].status, "done");
});

test("codex task uses the codex parser (agent_message → text)", () => {
  const { mgr, children, events } = makeHarness();
  const a = mgr.runTask({ prompt: "做事", model: "gpt-5-codex", cwd: "C:\\w", cli: "codex" });
  children[0].stdout.emit("data",
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "完成了" } }) + "\n");
  assert.equal(last(events, a.id).text, "完成了");
  children[0].emit("close", 0);
  assert.equal(last(events, a.id).status, "done");
});

test("codex: two agent_message in one turn are joined with a newline (not glued)", () => {
  const { mgr, children, events } = makeHarness();
  const a = mgr.runTask({ prompt: "做事", model: "gpt-5-codex", cwd: "C:\\w", cli: "codex" });
  children[0].stdout.emit("data", JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "先處理檔案" } }) + "\n");
  children[0].stdout.emit("data", JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "完成了" } }) + "\n");
  children[0].emit("close", 0);
  assert.equal(last(events, a.id).text, "先處理檔案\n完成了");
});

test("codex: non-zero exit with only an item-error surfaces the error message (not empty)", () => {
  const { mgr, children, events } = makeHarness();
  const a = mgr.runTask({ prompt: "做事", model: "gpt-5-codex", cwd: "C:\\w", cli: "codex" });
  children[0].stdout.emit("data", JSON.stringify({ type: "item.completed", item: { type: "error", message: "auth failed" } }) + "\n");
  children[0].emit("close", 1);
  const e = last(events, a.id);
  assert.equal(e.status, "error");
  assert.equal(e.text, "auth failed");
});

test("stale stdout from a killed/replaced child cannot resurrect a stopped task", () => {
  const { mgr, children, events } = makeHarness();
  const a = mgr.runTask({ prompt: "A", model: "claude", cwd: "C:\\w" });
  const b = mgr.runTask({ prompt: "B", model: "claude", cwd: "C:\\w" });
  mgr.stop(); // 殺 A、起 B
  // 被殺的 A 緩衝區 stdout 晚一拍才沖出來:不可把 A 變回 running、也不可動到 B
  children[0].stdout.emit("data", JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "殘留" }] } }) + "\n");
  assert.equal(last(events, a.id).status, "stopped");
  assert.equal(last(events, b.id).status, "running");
  assert.equal(mgr.isBusy(), true);
});
