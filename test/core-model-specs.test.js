const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

// 只驗規格本身（URL、必要性分層），不實際下載。
// 下載行為靠 downloadFile/extractTarBz2，那兩支已被串流模型流程長期驗證。
const SherpaManager = require("../src/helpers/sherpaManager.js");

function makeManager() {
  const logger = { info() {}, warn() {}, error() {} };
  return new SherpaManager(logger);
}

test("核心模型規格：URL 指向 sherpa-onnx 官方 release", async () => {
  const specs = makeManager().getCoreModelSpecs();
  assert.ok(specs.length >= 4, "至少要有 ASR / VAD / 標點 / 快速模式");
  for (const s of specs) {
    assert.match(s.url, /^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\//, s.id);
    assert.ok(s.plainFile || (s.folder && s.keyFile), `${s.id} 要嘛是單檔、要嘛有資料夾+關鍵檔`);
  }
});

test("必要模型只有辨識與 VAD——首次啟動不該為了標點多等 266MB", async () => {
  const specs = makeManager().getCoreModelSpecs();
  const required = specs.filter((s) => s.required).map((s) => s.id).sort();
  assert.deepEqual(required, ["asr", "vad"]);
});

test("標點與快速模式列為非必要（缺了仍能聽寫）", async () => {
  const specs = makeManager().getCoreModelSpecs();
  const optional = specs.filter((s) => !s.required).map((s) => s.id).sort();
  assert.deepEqual(optional, ["asr-small", "punct"]);
});

test("規格 id 不重複，避免下載流程互相覆蓋", async () => {
  const ids = makeManager().getCoreModelSpecs().map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});
