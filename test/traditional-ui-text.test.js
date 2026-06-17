const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const uiTextFiles = [
  "src/i18n/zh-CN.js",
  "src/i18n/zh-TW.js",
  "src/i18n/en.js",
  "src/settings.jsx",
];

const simplifiedOnlyChars = /[简声频进视会辑败换复导应页设显语麦风认动识结权辅粘请输钥务预义测错载历录实处隐项内触词还启闭顶缩标软专职维护击冲热汇强删类数总节键检办]/;

test("Chinese UI text uses Traditional Chinese glyphs", () => {
  const offenders = [];

  for (const file of uiTextFiles) {
    const absolutePath = path.join(__dirname, "..", file);
    const content = fs.readFileSync(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("{/*") ||
        trimmed.startsWith("*") ||
        trimmed.includes("console.")
      ) {
        return;
      }

      if (simplifiedOnlyChars.test(line)) {
        offenders.push(`${file}:${index + 1}: ${trimmed}`);
      }
    });
  }

  assert.deepEqual(offenders, []);
});
