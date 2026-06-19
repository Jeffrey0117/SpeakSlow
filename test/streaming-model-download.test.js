const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const SherpaManager = require("../src/helpers/sherpaManager");

test("streaming model files are checked in userData on macOS", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "speakslow-streaming-"));
  const manager = new SherpaManager(null, {
    platform: "darwin",
    userDataPath: tmp,
    projectRoot: path.join(tmp, "project"),
  });

  const result = await manager.checkStreamingModelFiles();

  assert.equal(result.success, true);
  assert.equal(result.models_downloaded, false);
  assert.equal(result.unsupported, false);
  assert.equal(
    result.details.model_path,
    path.join(tmp, "models", "poc-sherpa", "sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20")
  );
  assert.deepEqual(result.details.missing_files, [
    "encoder-epoch-99-avg-1.onnx",
    "decoder-epoch-99-avg-1.onnx",
    "joiner-epoch-99-avg-1.onnx",
    "tokens.txt",
  ]);
});

test("streaming model files are checked in userData on Windows too", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "speakslow-streaming-win-"));
  const manager = new SherpaManager(null, {
    platform: "win32",
    userDataPath: tmp,
    projectRoot: path.join(tmp, "project"),
  });

  const checkResult = await manager.checkStreamingModelFiles();

  assert.equal(checkResult.success, true);
  assert.equal(checkResult.unsupported, false);
  assert.equal(checkResult.models_downloaded, false);
});

test("preloading streaming model downloads missing macOS model before initializing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "speakslow-streaming-preload-"));
  const calls = [];
  const manager = new SherpaManager(null, {
    platform: "darwin",
    userDataPath: tmp,
    projectRoot: path.join(tmp, "project"),
  });
  manager.serverReady = true;
  manager.downloadStreamingModel = async () => {
    calls.push("download");
    const modelDir = manager.getStreamingModelTargetPath();
    await fs.promises.mkdir(modelDir, { recursive: true });
    await Promise.all(manager.streamingModelConfig.required_files.map((file) =>
      fs.promises.writeFile(path.join(modelDir, file), "model")
    ));
    return { success: true, model_path: modelDir };
  };
  manager._sendServerCommand = async (command) => {
    calls.push(command.action);
    return { success: true };
  };

  const result = await manager.preloadStreamingModel();

  assert.equal(result.success, true);
  assert.deepEqual(calls, ["download", "init_streaming"]);
});

test("streaming model download reports extracting and verifying after file download reaches 100 percent", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "speakslow-streaming-progress-"));
  const progressEvents = [];
  const manager = new SherpaManager(null, {
    platform: "darwin",
    userDataPath: tmp,
    projectRoot: path.join(tmp, "project"),
  });

  manager.downloadFile = async (_url, _destPath, progressCallback) => {
    progressCallback?.({ stage: "downloading", model: "streaming", progress: 100 });
  };
  manager.extractTarBz2 = async () => {
    const modelDir = manager.getStreamingModelTargetPath();
    await fs.promises.mkdir(modelDir, { recursive: true });
    await Promise.all(manager.streamingModelConfig.required_files.map((file) =>
      fs.promises.writeFile(path.join(modelDir, file), "model")
    ));
  };

  const result = await manager.downloadStreamingModel((event) => progressEvents.push(event));

  assert.equal(result.success, true);
  assert.deepEqual(progressEvents.map((event) => event.stage), [
    "downloading",
    "extracting",
    "verifying",
  ]);
});
