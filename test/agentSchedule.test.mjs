import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNextRun, processDue } from "../src/helpers/agentSchedule.js";

const FROM = new Date(2026, 5, 23, 10, 0, 0, 0).getTime(); // 2026-06-23 10:00 本地(週二)

test("once: nextRun is the given absolute time", () => {
  assert.equal(computeNextRun({ type: "once", at: FROM + 3600000 }, FROM), FROM + 3600000);
});

test("daily: picks today's HH:MM if still future, else tomorrow", () => {
  const future = computeNextRun({ type: "daily", time: "18:30" }, FROM); // 今天 18:30 > 10:00
  let d = new Date(future);
  assert.ok(future > FROM);
  assert.equal(d.getHours(), 18); assert.equal(d.getMinutes(), 30);
  assert.equal(d.getDate(), 23); // 還是今天

  const past = computeNextRun({ type: "daily", time: "08:00" }, FROM); // 今天 08:00 < 10:00 → 明天
  d = new Date(past);
  assert.equal(d.getHours(), 8); assert.equal(d.getDate(), 24);
});

test("weekly: next occurrence of the target weekday + time", () => {
  // FROM 是週二(getDay()=2)。排週五(5) 09:00 → 同週週五
  const fri = computeNextRun({ type: "weekly", time: "09:00", dow: 5 }, FROM);
  const d = new Date(fri);
  assert.equal(d.getDay(), 5);
  assert.ok(fri > FROM);
  assert.equal(d.getHours(), 9);
});

test("weekly: same weekday but time already passed → next week", () => {
  // FROM 週二 10:00,排週二(2) 08:00 → 下週二
  const next = computeNextRun({ type: "weekly", time: "08:00", dow: 2 }, FROM);
  const d = new Date(next);
  assert.equal(d.getDay(), 2);
  assert.ok(next - FROM > 6 * 86400000); // 約一週後
});

test("processDue: once fires and is removed; future stays", () => {
  const schedules = [
    { id: 1, type: "once", nextRun: FROM - 1000, prompt: "due" },
    { id: 2, type: "once", nextRun: FROM + 60000, prompt: "later" },
  ];
  const { due, kept } = processDue(schedules, FROM);
  assert.deepEqual(due.map((s) => s.id), [1]);
  assert.deepEqual(kept.map((s) => s.id), [2]); // due once removed, future kept
});

test("processDue: recurring fires and is kept with advanced nextRun", () => {
  const schedules = [{ id: 3, type: "daily", time: "08:00", nextRun: FROM - 1000, prompt: "daily" }];
  const { due, kept } = processDue(schedules, FROM);
  assert.deepEqual(due.map((s) => s.id), [3]);
  assert.equal(kept.length, 1);
  assert.ok(kept[0].nextRun > FROM); // 推到下一次
});
