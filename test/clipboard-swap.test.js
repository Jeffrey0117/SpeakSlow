const assert = require("node:assert/strict");
const test = require("node:test");

const { ClipboardSwap, STATE_USER, STATE_DICTATION } = require("../src/helpers/clipboardSwap");

// 假剪貼簿：記住現在放什麼，可以模擬讀寫失敗
// 形狀與 clipboardText 一致：非同步，寫入失敗回 false 而不是丟錯
function fakeClipboard(initial = "") {
  const box = { value: initial, failRead: false, failWrite: false };
  return {
    box,
    io: {
      readText: async () => {
        if (box.failRead) throw new Error("剪貼簿被佔用");
        return box.value;
      },
      writeText: async (t) => {
        if (box.failWrite) return false;
        box.value = t;
        return true;
      },
    },
  };
}

test("還沒聽寫過就切不動（不會把剪貼簿清空）", async () => {
  const { box, io } = fakeClipboard("使用者本來複製的網址");
  const swap = new ClipboardSwap(io);

  const r = await swap.swap();
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-dictation");
  assert.equal(box.value, "使用者本來複製的網址", "切不動就該原封不動");
});

test("連按兩下 → 剛講的話；再連按兩下 → 原本複製的東西", async () => {
  const { box, io } = fakeClipboard("使用者本來複製的網址");
  const swap = new ClipboardSwap(io);

  // 一次聽寫：貼上後 clipboard.js 已把原本的內容還原
  swap.remember("今天天氣真好", "使用者本來複製的網址");
  assert.equal(swap.state, STATE_USER);

  let r = await swap.swap();
  assert.equal(r.state, STATE_DICTATION);
  assert.equal(box.value, "今天天氣真好");

  r = await swap.swap();
  assert.equal(r.state, STATE_USER);
  assert.equal(box.value, "使用者本來複製的網址");

  // 可以一直來回，不會卡在某一邊
  assert.equal((await swap.swap()).state, STATE_DICTATION);
  assert.equal(box.value, "今天天氣真好");
});

test("⚠ 聽寫後又複製了新東西 → 切換不可以把那份弄丟", async () => {
  const { box, io } = fakeClipboard("舊網址");
  const swap = new ClipboardSwap(io);
  swap.remember("今天天氣真好", "舊網址");

  // 使用者聽寫完之後又複製了一段重要的東西
  box.value = "剛複製的重要帳號";

  // 切去聽寫文字
  let r = await swap.swap();
  assert.equal(r.state, STATE_DICTATION);
  assert.equal(box.value, "今天天氣真好");

  // 再切回來：要拿回「剛複製的重要帳號」，不是那個過期的舊網址
  r = await swap.swap();
  assert.equal(r.state, STATE_USER);
  assert.equal(box.value, "剛複製的重要帳號", "不能還原成過期的內容，那等於毀掉他剛複製的東西");
});

test("新的一次聽寫會重設成「原本內容」那一邊", async () => {
  const { box, io } = fakeClipboard("第一次的剪貼簿");
  const swap = new ClipboardSwap(io);

  swap.remember("第一段話", "第一次的剪貼簿");
  await swap.swap();
  assert.equal(swap.state, STATE_DICTATION);

  // 第二次聽寫（貼上流程結束時剪貼簿已是使用者原本的內容）
  swap.remember("第二段話", "第二次的剪貼簿");
  assert.equal(swap.state, STATE_USER, "剛貼完站在 user 這邊，第一下連按才會切到聽寫文字");

  box.value = "第二次的剪貼簿";
  assert.equal((await swap.swap()).state, STATE_DICTATION);
  assert.equal(box.value, "第二段話");
});

test("空白或無效的聽寫結果不記（避免切出一片空白）", async () => {
  const { io } = fakeClipboard("原本的");
  const swap = new ClipboardSwap(io);

  swap.remember("", "原本的");
  assert.equal(swap.canSwap(), false);
  swap.remember("   \n ", "原本的");
  assert.equal(swap.canSwap(), false);
  swap.remember(null, "原本的");
  assert.equal(swap.canSwap(), false);
});

test("聽寫前剪貼簿是空的 → 切回去就是空的，不會丟錯", async () => {
  const { box, io } = fakeClipboard("");
  const swap = new ClipboardSwap(io);
  swap.remember("講的話", "");

  assert.equal((await swap.swap()).state, STATE_DICTATION);
  assert.equal(box.value, "講的話");
  assert.equal((await swap.swap()).state, STATE_USER);
  assert.equal(box.value, "");
});

test("剪貼簿被別的程式佔住時回報失敗，不會當掉", async () => {
  const { box, io } = fakeClipboard("原本的");
  const swap = new ClipboardSwap(io);
  swap.remember("講的話", "原本的");

  box.failRead = true;
  let r = await swap.swap();
  assert.equal(r.ok, false);
  assert.equal(r.reason, "read-failed");

  box.failRead = false;
  box.failWrite = true;
  r = await swap.swap();
  assert.equal(r.ok, false);
  assert.equal(r.reason, "write-failed");
  assert.equal(box.value, "原本的", "寫不進去就該維持原樣");

  // 恢復後還是能正常切
  box.failWrite = false;
  assert.equal((await swap.swap()).ok, true);
});

test("reset 之後就切不動了", async () => {
  const { io } = fakeClipboard("原本的");
  const swap = new ClipboardSwap(io);
  swap.remember("講的話", "原本的");
  assert.equal(swap.canSwap(), true);

  swap.reset();
  assert.equal(swap.canSwap(), false);
  assert.equal((await swap.swap()).ok, false);
});

// ───────── 貼完之後留哪一份（clipboard_after_paste）─────────
//
// 起始狀態必須跟貼上流程的實際行為一致。不一致的話第一次連按兩下會切錯方向：
// 使用者想拿回原本複製的東西，卻又寫了一次聽寫文字上去（看起來「沒反應」）。

test("留聽寫文字模式：第一次連按兩下要換回原本複製的東西", async () => {
  const { box, io } = fakeClipboard("使用者本來複製的網址");
  const swap = new ClipboardSwap(io);

  // 貼上流程沒有還原 → 剪貼簿上是聽寫文字
  box.value = "今天天氣真好";
  swap.remember("今天天氣真好", "使用者本來複製的網址", STATE_DICTATION);
  assert.equal(swap.state, STATE_DICTATION);

  let r = await swap.swap();
  assert.equal(r.state, STATE_USER, "第一下就該換回原本的，不是再寫一次聽寫文字");
  assert.equal(box.value, "使用者本來複製的網址");

  r = await swap.swap();
  assert.equal(r.state, STATE_DICTATION);
  assert.equal(box.value, "今天天氣真好");
});

test("還原模式：第一次連按兩下要拿到聽寫文字", async () => {
  const { box, io } = fakeClipboard("使用者本來複製的網址");
  const swap = new ClipboardSwap(io);

  // 貼上流程還原了 → 剪貼簿上是使用者原本的內容
  swap.remember("今天天氣真好", "使用者本來複製的網址", STATE_USER);

  const r = await swap.swap();
  assert.equal(r.state, STATE_DICTATION);
  assert.equal(box.value, "今天天氣真好");
});

test("沒帶起始狀態時維持舊行為（還原模式）", async () => {
  const { io } = fakeClipboard("原本的");
  const swap = new ClipboardSwap(io);
  swap.remember("講的話", "原本的");
  assert.equal(swap.state, STATE_USER);
});

test("起始狀態只收兩個合法值，亂給一律當還原模式", async () => {
  const { io } = fakeClipboard("原本的");
  const swap = new ClipboardSwap(io);

  swap.remember("講的話", "原本的", "亂寫的值");
  assert.equal(swap.state, STATE_USER, "非法值要退回安全的那一邊");
  swap.remember("講的話", "原本的", undefined);
  assert.equal(swap.state, STATE_USER);
});

test("留聽寫文字模式下，聽寫後又複製新東西也不會弄丟那份", async () => {
  const { box, io } = fakeClipboard("舊網址");
  const swap = new ClipboardSwap(io);
  box.value = "第一段話";
  swap.remember("第一段話", "舊網址", STATE_DICTATION);

  // 使用者複製了一段重要的東西（蓋掉了剪貼簿上的聽寫文字）
  box.value = "剛複製的重要帳號";

  // 連按兩下：目前不是聽寫文字 → 要先把這份收起來，再放聽寫文字
  let r = await swap.swap();
  assert.equal(r.state, STATE_DICTATION);
  assert.equal(box.value, "第一段話");

  // 再連按兩下要拿回「剛複製的重要帳號」，不是過期的舊網址
  r = await swap.swap();
  assert.equal(box.value, "剛複製的重要帳號");
});
