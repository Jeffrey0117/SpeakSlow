const assert = require("node:assert/strict");
const test = require("node:test");

const { TypelessManager } = require("../src/helpers/typelessManager");
const { UiohookKey } = require("uiohook-napi");

const TRIGGER = UiohookKey.CtrlRight;

// 把回調都換成記錄器，直接驅動 handleKeyDown / handleKeyUp
function harness(mode) {
  const calls = [];
  const m = new TypelessManager(null);
  m.isEnabled = true;
  m.mode = mode;
  m.triggerKeys = [TRIGGER];
  m.setCallbacks({
    onStartRecording: () => calls.push("start"),
    onStopRecording: () => calls.push("stop"),
    onCancelRecording: () => calls.push("cancel"),
    onToggleClipboard: () => calls.push("swap"),
  });
  const down = () => m.handleKeyDown({ keycode: TRIGGER });
  const up = () => m.handleKeyUp({ keycode: TRIGGER });
  return { m, calls, down, up };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────── 切換模式（按一下開始、再按一下停止）─────────

test("切換模式：連按兩下 → 取消空錄音並切換剪貼簿", async () => {
  const { calls, down, up } = harness("toggle");

  down(); // 開始錄音
  up();
  await sleep(60); // 很快就再按一下
  down();

  assert.deepEqual(calls, ["start", "cancel", "swap"],
    "第二下要取消那段不可能有語音的錄音，而不是送去轉錄");
});

test("切換模式：正常講完一段（有間隔）不會被誤判成手勢", async () => {
  const { m, calls, down, up } = harness("toggle");

  down(); // 開始
  up();
  // 模擬講了一段話：把開始時間往前挪，省得真的等
  m.activeSince -= 3000;
  m.lastKeyDownTime -= 3000;
  down(); // 停止

  assert.deepEqual(calls, ["start", "stop"], "該是正常的開始→停止");
});

test("切換模式：講完停止後立刻再開一段，不可以被當成手勢", async () => {
  const { m, calls, down, up } = harness("toggle");

  down();
  up();
  m.activeSince -= 3000;
  m.lastKeyDownTime -= 3000;
  down(); // 停止
  up();
  await sleep(60); // 馬上又想講新的一段
  down();

  assert.deepEqual(calls, ["start", "stop", "start"],
    "這是『停止後立刻重開』，不是連按兩下——誤判會搶走使用者要錄的話");
});

test("切換模式：長按的自動重複不會觸發手勢", () => {
  const { m, calls, down } = harness("toggle");

  down(); // 開始錄音
  // 自動重複：keydown 連發、中間沒有 keyup（triggerHeld 維持 true）
  for (let i = 0; i < 5; i++) {
    m.lastKeyDownTime = Date.now() - 30;
    down();
  }

  assert.deepEqual(calls, ["start"], "自動重複要被忽略，不能切剪貼簿也不能停錄音");
});

test("切換模式：沒在錄音時連按兩下不會切（第一下是開始錄音）", async () => {
  const { calls, down, up } = harness("toggle");

  down();
  up();
  assert.deepEqual(calls, ["start"], "第一下永遠是開始錄音");
});

// ───────── 按住模式（按住說話）─────────

test("按住模式：兩次極短點按 → 切換剪貼簿", async () => {
  const { calls, down, up } = harness("hold");

  down();
  up(); // 立刻放開 → 過短，取消
  await sleep(60);
  down(); // 第二下 → 手勢

  assert.deepEqual(calls, ["start", "cancel", "swap"]);
});

test("按住模式：過短的點按不會送去轉錄（原本會跳「錄音太短」）", () => {
  const { calls, down, up } = harness("hold");

  down();
  up();

  assert.deepEqual(calls, ["start", "cancel"], "過短就丟掉，不要 stop");
});

test("按住模式：真的按住講話 → 正常停止", () => {
  const { m, calls, down, up } = harness("hold");

  down();
  m.keyDownAt -= 2000; // 模擬按住 2 秒
  up();

  assert.deepEqual(calls, ["start", "stop"]);
});

test("按住模式：按住講完後再按一下，不會被當成手勢", async () => {
  const { m, calls, down, up } = harness("hold");

  down();
  m.keyDownAt -= 2000;
  up(); // 正常停止
  await sleep(60);
  down(); // 想講新的一段

  assert.deepEqual(calls, ["start", "stop", "start"],
    "正常停止要清掉點按記錄，否則下一次按住會被吃掉變成切剪貼簿");
});

test("按住模式：兩次點按間隔太久就不算連按", async () => {
  const { m, calls, down, up } = harness("hold");

  down();
  up(); // 過短 → cancel
  m.lastShortTapAt -= 2000; // 隔很久才按第二下
  down();

  assert.deepEqual(calls, ["start", "cancel", "start"], "間隔太久應該是新的一次錄音");
});

// ───────── 共通 ─────────

test("沒有接 onToggleClipboard 時手勢是無害的 no-op", async () => {
  const calls = [];
  const m = new TypelessManager(null);
  m.isEnabled = true;
  m.mode = "toggle";
  m.triggerKeys = [TRIGGER];
  m.setCallbacks({
    onStartRecording: () => calls.push("start"),
    onStopRecording: () => calls.push("stop"),
    onCancelRecording: () => calls.push("cancel"),
  });

  m.handleKeyDown({ keycode: TRIGGER });
  m.handleKeyUp({ keycode: TRIGGER });
  await sleep(60);
  assert.doesNotThrow(() => m.handleKeyDown({ keycode: TRIGGER }));
  assert.deepEqual(calls, ["start", "cancel"]);
});

test("Esc 取消後不會留下殘留狀態讓下一次按鍵變成手勢", async () => {
  const { m, calls, down, up } = harness("toggle");

  down(); // 開始錄音
  m.handleKeyDown({ keycode: UiohookKey.Escape }); // Esc 取消
  await sleep(60);
  down(); // 再按一次

  assert.deepEqual(calls, ["start", "cancel", "start"],
    "Esc 之後下一次按下應該是開始新錄音，不是切剪貼簿");
});
