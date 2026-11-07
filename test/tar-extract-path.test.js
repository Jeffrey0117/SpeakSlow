const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SherpaManager = require("../src/helpers/sherpaManager");

// v1.0.30／v1.0.31 的 lite 版整個裝不起來，就是因為這裡：
// 指令是 `tar -xjf C:\...\model.tar.bz2 -C C:\...`，GNU tar（Git/MSYS 帶的那個，
// 在 PATH 上會被優先選到）把 "C:" 當成遠端主機名，報
// "tar (child): Cannot connect to C: resolve failed" 然後解壓失敗。
// 使用者看到的是：模型下載了 225MB，卻永遠停在「準備中」。
// 這組測試鎖住的規則很單純：tar 的參數裡不准出現冒號。

function fakeSpawn(calls) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit("close", 0));
    return child;
  };
}

function managerWith(calls) {
  return new SherpaManager(null, { spawnFn: fakeSpawn(calls) });
}

test("tar 參數不含冒號（壓縮檔與目標同層）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "speakslow-tar-"));
  const tarPath = path.join(root, "model.tar.bz2");
  const calls = [];

  await managerWith(calls).extractTarBz2(tarPath, root);

  assert.equal(calls.length, 1);
  const { cmd, args, opts } = calls[0];
  assert.equal(cmd, "tar");
  for (const arg of args) {
    assert.ok(!arg.includes(":"), `參數帶冒號會讓 GNU tar 當成遠端主機：${arg}`);
  }
  // 唯一安全的作法：cwd 指到目標，只傳檔名
  assert.equal(opts.cwd, root);
  assert.deepEqual(args, ["-xjf", "model.tar.bz2"]);
});

test("壓縮檔在子資料夾時仍然不帶冒號", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "speakslow-tar-sub-"));
  const sub = path.join(root, "dl");
  fs.mkdirSync(sub, { recursive: true });
  const calls = [];

  await managerWith(calls).extractTarBz2(path.join(sub, "model.tar.bz2"), root);

  for (const arg of calls[0].args) {
    assert.ok(!arg.includes(":"), `參數帶冒號：${arg}`);
  }
  assert.equal(calls[0].opts.cwd, root);
  // 相對路徑一律用正斜線，Windows 的 tar 兩種都吃，但混用反斜線容易被當跳脫
  assert.equal(calls[0].args[1], "dl/model.tar.bz2");
});

test("不再傳 -C（舊寫法就是靠它才會把絕對路徑塞進參數）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "speakslow-tar-nc-"));
  const calls = [];

  await managerWith(calls).extractTarBz2(path.join(root, "m.tar.bz2"), root);

  assert.ok(!calls[0].args.includes("-C"), "改用 cwd，不該再出現 -C");
});

test("tar 失敗會丟出錯誤，不會假裝成功", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "speakslow-tar-fail-"));
  const manager = new SherpaManager(null, {
    spawnFn: () => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        child.stderr.emit("data", Buffer.from("tar: unexpected end of file"));
        child.emit("close", 2);
      });
      return child;
    },
  });

  // 靜悄悄成功最可怕：使用者會卡在「準備中」卻看不到任何錯誤
  await assert.rejects(() => manager.extractTarBz2(path.join(root, "m.tar.bz2"), root));
});

test("下載的壓縮檔放在模型目錄底下，不放 tmpdir（跨磁碟會算出帶冒號的相對路徑）", () => {
  // 下載目的地與解壓目標必須同一顆磁碟，否則 path.relative 會算出 "D:/..."
  // 這種帶磁碟代號的字串，又踩回同一個 tar 地雷。
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "helpers", "sherpaManager.js"),
    "utf8"
  );
  const tarPathAssignments = source
    .split("\n")
    .filter((line) => /const tarPath\s*=/.test(line));

  assert.ok(tarPathAssignments.length >= 2, "找不到 tarPath 的賦值，測試需要更新");
  for (const line of tarPathAssignments) {
    assert.ok(
      !line.includes("os.tmpdir()"),
      `壓縮檔不能放 tmpdir（可能與 userData 不同磁碟）：${line.trim()}`
    );
  }
});
