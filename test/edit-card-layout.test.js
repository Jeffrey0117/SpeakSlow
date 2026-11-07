const assert = require("node:assert/strict");
const test = require("node:test");

const layoutModule = import("../src/utils/editCardLayout.mjs");

test("字越少字級越大", async () => {
  const { pickFontSize } = await layoutModule;
  assert.ok(pickFontSize(5) > pickFontSize(20));
  assert.ok(pickFontSize(20) > pickFontSize(100));
  assert.ok(pickFontSize(5) >= 40, "短句應該是超大字");
});

test("短句用小卡，不會留一大片空白", async () => {
  const { computeEditCardLayout } = await layoutModule;
  // 使用者實際遇到的例子：15 字的句子配上 480 高的大框，空白佔了大半
  const short = computeEditCardLayout("沒有了，他就是一個快煩的人啊！");
  assert.ok(short.height < 300, `短句卡片應該矮，實際 ${short.height}`);
  assert.ok(short.fontSize >= 31, `短句字級應該大，實際 ${short.fontSize}`);
});

test("長文自動長高並降字級", async () => {
  const { computeEditCardLayout } = await layoutModule;
  const short = computeEditCardLayout("短短一句");
  const long = computeEditCardLayout("長".repeat(300));
  assert.ok(long.height > short.height);
  assert.ok(long.fontSize < short.fontSize);
  assert.ok(long.lines > short.lines);
});

test("尺寸不超過可用空間上限", async () => {
  const { computeEditCardLayout } = await layoutModule;
  const r = computeEditCardLayout("字".repeat(2000), { maxWidth: 800, maxHeight: 600 });
  assert.ok(r.width <= 800);
  assert.ok(r.height <= 600);
});

test("使用者自己的換行也算行數", async () => {
  const { computeEditCardLayout } = await layoutModule;
  const oneLine = computeEditCardLayout("一二三");
  const threeLines = computeEditCardLayout("一\n二\n三");
  assert.equal(threeLines.lines, 3);
  assert.ok(threeLines.height > oneLine.height);
});

test("空字串仍回傳可用尺寸", async () => {
  const { computeEditCardLayout } = await layoutModule;
  const r = computeEditCardLayout("");
  assert.ok(r.width >= 460 && r.height >= 180);
  assert.ok(Number.isFinite(r.fontSize));
});
