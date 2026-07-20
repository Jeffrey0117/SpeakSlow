import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAUDE_MODEL, DEFAULT_MODEL, tierOf, parseCloudModels, listModels,
  CODEX_MODELS, CODEX_DEFAULT_MODEL,
} from "../src/helpers/agentCatalog.js";

test("CLAUDE_MODEL sentinel matches free-cowork ('claude')", () => {
  assert.equal(CLAUDE_MODEL, "claude");
});

test("DEFAULT_MODEL is the free-tier default (FALLBACKS[0])", () => {
  assert.equal(DEFAULT_MODEL, "minimax-m2.5:cloud");
});

test("tierOf classifies free / subscription / incompatible / unknown", () => {
  assert.equal(tierOf("gemma3:12b-cloud"), "free");
  assert.equal(tierOf("minimax-m2.5:cloud"), "free");
  assert.equal(tierOf("glm-5:cloud"), "subscription");
  assert.equal(tierOf("rnj-1:8b-cloud"), "incompatible");
  assert.equal(tierOf("totally-made-up:cloud"), "unknown");
});

test("parseCloudModels maps api/tags names to local -cloud/:cloud names", () => {
  const json = JSON.stringify({ models: [
    { name: "minimax-m2.7" },   // no ':' → :cloud
    { name: "gpt-oss:120b" },    // has ':' → -cloud
    { name: "qwen3-coder-next" },
  ] });
  assert.deepEqual(parseCloudModels(json), [
    "minimax-m2.7:cloud", "gpt-oss:120b-cloud", "qwen3-coder-next:cloud",
  ]);
  assert.equal(parseCloudModels("not json"), null);
});

test("listModels default = free only; showAll adds subscription; incompatible always hidden", () => {
  const free = listModels({ showAll: false });
  assert.ok(free.every((m) => m.tier === "free"));
  assert.ok(free.some((m) => m.name === "gemma3:12b-cloud"));
  assert.ok(!free.some((m) => m.name === "rnj-1:8b-cloud"));   // incompatible hidden
  assert.ok(!free.some((m) => m.tier === "subscription"));

  const all = listModels({ showAll: true });
  assert.ok(all.some((m) => m.name === "glm-5:cloud" && m.tier === "subscription"));
  assert.ok(!all.some((m) => m.name === "rnj-1:8b-cloud"));    // still hidden
});

test("listModels sorts alphabetically by name within a tier", () => {
  const free = listModels({ showAll: false });
  const names = free.map((m) => m.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, sorted); // 全免費(同 tier)→ 應為純字母序
  // 跨 tier:免費全部排在需訂閱之前
  const all = listModels({ showAll: true });
  const lastFree = all.map((m) => m.tier).lastIndexOf("free");
  const firstSub = all.map((m) => m.tier).indexOf("subscription");
  assert.ok(lastFree < firstSub);
});

test("CODEX_MODELS for the Codex engine + default is in the list", () => {
  assert.ok(Array.isArray(CODEX_MODELS) && CODEX_MODELS.includes("gpt-5-codex"));
  assert.equal(CODEX_DEFAULT_MODEL, "gpt-5-codex");
  assert.ok(CODEX_MODELS.includes(CODEX_DEFAULT_MODEL));
});

test("listModels with live `available` labels via tierOf and respects showAll", () => {
  const available = ["gemma3:12b-cloud", "glm-5:cloud", "brand-new:cloud", "rnj-1:8b-cloud"];
  const free = listModels({ showAll: false, available });
  assert.deepEqual(free.map((m) => m.name), ["gemma3:12b-cloud"]); // only free tier kept

  const all = listModels({ showAll: true, available });
  const names = all.map((m) => m.name);
  assert.ok(names.includes("gemma3:12b-cloud"));
  assert.ok(names.includes("glm-5:cloud"));
  assert.ok(names.includes("brand-new:cloud"));   // unknown shown when showAll
  assert.ok(!names.includes("rnj-1:8b-cloud"));    // incompatible always hidden
  assert.equal(all.find((m) => m.name === "brand-new:cloud").tier, "unknown");
});
