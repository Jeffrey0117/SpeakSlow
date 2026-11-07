const assert = require("node:assert/strict");
const test = require("node:test");

const parserModule = import("../src/utils/spellOutParser.mjs");

test("多段拆字描述還原成詞", async () => {
  const { parseSpellOut } = await parserModule;
  assert.equal(parseSpellOut("北方的北，爛掉的爛"), "北爛");
  assert.equal(parseSpellOut("弓長張的張，三聲的三"), "張三");
});

// 辨識結果不保證有斷句——以下三句是實際使用時的原始輸出（含尾端句號、中間無逗號）
test("沒有標點也要能拆（真實辨識輸出）", async () => {
  const { parseSpellOut } = await parserModule;
  assert.equal(parseSpellOut("北方的北爛掉的爛。"), "北爛");
  assert.equal(parseSpellOut("風中的風口袋的口。"), "風口");
  assert.equal(parseSpellOut("他很腦殘腦袋的腦殘掉的殘。"), "腦殘");
});

test("單段也支援", async () => {
  const { parseSpellOut } = await parserModule;
  assert.equal(parseSpellOut("爛掉的爛"), "爛");
});

test("各種分隔符號都能切", async () => {
  const { parseSpellOut } = await parserModule;
  assert.equal(parseSpellOut("北方的北、爛掉的爛"), "北爛");
  assert.equal(parseSpellOut("北方的北 爛掉的爛"), "北爛");
  assert.equal(parseSpellOut("北方的北。爛掉的爛"), "北爛");
});

test("正常說話不會被誤拆", async () => {
  const { parseSpellOut } = await parserModule;
  // 「家」沒出現在「我」裡 → 不是拆字描述
  assert.equal(parseSpellOut("我的家"), null);
  // 真實情境：這句若被誤判成「台北」會很糟
  assert.equal(parseSpellOut("我去台灣的台北"), null);
  // 有一段不像就整句不算
  assert.equal(parseSpellOut("北方的北，然後我們去吃飯"), null);
});

test("格式不符一律放棄", async () => {
  const { parseSpellOut } = await parserModule;
  assert.equal(parseSpellOut("北方北"), null);      // 沒有「的」
  assert.equal(parseSpellOut("的北"), null);        // 沒有提示詞
  assert.equal(parseSpellOut("北方的北爛"), null);  // 「的」後面超過一個字
  assert.equal(parseSpellOut(""), null);
  assert.equal(parseSpellOut("   "), null);
  assert.equal(parseSpellOut(null), null);
  assert.equal(parseSpellOut(123), null);
});

test("提示詞過長視為普通句子", async () => {
  const { parseSpellOut } = await parserModule;
  // 7 字提示詞：比較像在講話而不是拆字
  assert.equal(parseSpellOut("一二三四五六七的七"), null);
});
