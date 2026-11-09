const assert = require("node:assert/strict");
const test = require("node:test");

const { convertText, convertClipboard } = require("../src/helpers/clipboardConvert");

function fakeClipboard(initial = "") {
  const box = { value: initial, failRead: false, failWrite: false, writes: 0 };
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
        box.writes++;
        return true;
      },
    },
  };
}

// ───────── 轉換品質 ─────────
// 用 twp 而不是 tw 的理由就在這幾個詞上。tw 只做字級轉換，
// 「软件」會變成「軟件」而不是「軟體」——台灣使用者看了會皺眉。

test("簡體 → 繁體：連台灣用語一起換", () => {
  const r = convertText("这个软件用鼠标和硬盘，打印机和视频都正常", "traditional");
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  for (const word of ["軟體", "滑鼠", "硬碟", "印表機", "影片"]) {
    assert.ok(r.text.includes(word), `應該要轉出「${word}」，實際是：${r.text}`);
  }
  assert.ok(!r.text.includes("軟件"), "不該停在字級轉換的「軟件」");
});

test("繁體 → 簡體：台灣用語要換成對岸用語", () => {
  const r = convertText("這個軟體用滑鼠和硬碟，印表機和影片都正常", "simplified");
  assert.equal(r.ok, true);
  for (const word of ["软件", "鼠标", "硬盘", "打印机", "视频"]) {
    assert.ok(r.text.includes(word), `應該要轉出「${word}」，實際是：${r.text}`);
  }
  assert.ok(!r.text.includes("滑鼠"), "不該把「滑鼠」原封不動留給對岸讀者");
});

test("幂等：已經是繁體再按一次不會變成簡體", () => {
  const once = convertText("這個軟體的品質很好", "traditional");
  assert.equal(once.ok, true);
  const twice = convertText(once.text, "traditional");
  assert.equal(twice.text, once.text, "按兩次要跟按一次一樣");
  assert.equal(twice.changed, false, "沒變就該回報沒變");
});

// ───────── 邊界 ─────────

test("剪貼簿是空的 → 回報 empty，不做事", () => {
  assert.equal(convertText("", "traditional").reason, "empty");
  assert.equal(convertText(null, "traditional").reason, "empty");
});

test("沒有中文（純英文／程式碼）→ 明確回報，不要讓使用者以為壞掉", () => {
  const r = convertText("const x = fooBar(42); // hello world", "traditional");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-chinese");
});

test("中英混排只轉中文部分，英文原樣保留", () => {
  const r = convertText("用 VS Code 打开这个软件的项目", "traditional");
  assert.equal(r.ok, true);
  assert.ok(r.text.includes("VS Code"), "英文不該被動到");
  assert.ok(r.text.includes("軟體"));
});

test("emoji 與標點不會被吃掉", () => {
  const r = convertText("这个软件真棒！🎉（真的）", "traditional");
  assert.equal(r.ok, true);
  assert.ok(r.text.includes("🎉"));
  assert.ok(r.text.includes("！"));
  assert.ok(r.text.includes("（真的）"));
});

// ───────── 剪貼簿流程 ─────────

test("完整流程：讀 → 轉 → 寫回剪貼簿", async () => {
  const { box, io } = fakeClipboard("这个软件的质量很好");
  const r = await convertClipboard("traditional", io);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.ok(box.value.includes("軟體"));
  assert.equal(box.writes, 1);
});

test("已經是目標字體就不寫剪貼簿（不假裝有做事）", async () => {
  const { box, io } = fakeClipboard("這個軟體的品質很好");
  const r = await convertClipboard("traditional", io);
  assert.equal(r.ok, true);
  assert.equal(r.changed, false);
  assert.equal(box.writes, 0, "沒變就不要寫，免得蓋掉剪貼簿的其他格式");
});

test("剪貼簿裡沒中文時不寫入", async () => {
  const { box, io } = fakeClipboard("hello world");
  const r = await convertClipboard("traditional", io);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-chinese");
  assert.equal(box.writes, 0);
  assert.equal(box.value, "hello world", "原樣不動");
});

test("讀失敗 / 寫失敗都回報，不會把剪貼簿弄壞", async () => {
  const a = fakeClipboard("这个软件");
  a.box.failRead = true;
  assert.equal((await convertClipboard("traditional", a.io)).reason, "read-failed");

  const b = fakeClipboard("这个软件");
  b.box.failWrite = true;
  const r = await convertClipboard("traditional", b.io);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "write-failed");
  assert.equal(b.box.value, "这个软件", "寫不進去就該維持原樣");
});

test("長文不會爆（轉換器重複使用）", () => {
  const long = "这个软件的质量很好。".repeat(2000);
  const r = convertText(long, "traditional");
  assert.equal(r.ok, true);
  assert.equal([...r.text].length > 10000, true);
  assert.ok(r.text.includes("軟體"));
});

// ───────── 自訂字典 ─────────
// opencc 的 twp 覆蓋約 88% 的常見 IT 用語，剩下那一小撮靠使用者自己的字典補。
// 其中兩個是 opencc 判斷可議：脚本→指令碼（台灣說「腳本」）、进程→程序
//（「程序」在台灣是 program，應該是「行程」）。

test("轉繁體時會套用自訂字典（補 opencc 沒換到位的用語）", async () => {
  const { box, io } = fakeClipboard("这个脚本的进程挂了");
  // 使用者在設定頁加的兩條：對著 opencc 的輸出改
  const dict = (t) => t.replace(/指令碼/g, "腳本").replace(/程序/g, "行程");

  const r = await convertClipboard("traditional", io, dict);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.dictChanged, true, "字典有動到就要回報，膠囊才說得出「含字典」");
  assert.ok(box.value.includes("腳本"), `實際是：${box.value}`);
  assert.ok(box.value.includes("行程"), `實際是：${box.value}`);
});

test("字典沒動到時 dictChanged 為 false（膠囊不該亂講）", async () => {
  const { io } = fakeClipboard("这个软件很好用");
  const dict = (t) => t.replace(/完全不會出現的詞/g, "x");
  const r = await convertClipboard("traditional", io, dict);
  assert.equal(r.changed, true);
  assert.equal(r.dictChanged, false);
});

test("轉簡體刻意不套字典（否則剛簡化的詞又被改回台灣說法）", async () => {
  const { box, io } = fakeClipboard("這個軟體很好用");
  let called = false;
  const dict = (t) => { called = true; return t; };
  await convertClipboard("simplified", io, dict);
  assert.equal(called, false, "簡體方向不該呼叫字典");
  assert.ok(box.value.includes("软件"));
});

test("字典丟錯不會讓整個轉換失敗（至少給 opencc 的結果）", async () => {
  const { box, io } = fakeClipboard("这个软件很好用");
  const dict = () => { throw new Error("字典壞了"); };
  const r = await convertClipboard("traditional", io, dict);
  assert.equal(r.ok, true, "字典壞掉不該連帶讓轉換失敗");
  assert.ok(box.value.includes("軟體"));
});

test("字典回傳非字串時忽略它", async () => {
  const { box, io } = fakeClipboard("这个软件很好用");
  const r = await convertClipboard("traditional", io, () => ({ bad: true }));
  assert.equal(r.ok, true);
  assert.ok(box.value.includes("軟體"), "不該把物件寫進剪貼簿");
});

test("已經是繁體、但字典有動到 → 仍要寫回剪貼簿", async () => {
  const { box, io } = fakeClipboard("這個指令碼很好用");
  const dict = (t) => t.replace(/指令碼/g, "腳本");
  const r = await convertClipboard("traditional", io, dict);
  assert.equal(r.changed, true, "opencc 沒動但字典動了，也算有改");
  assert.ok(box.value.includes("腳本"));
});
