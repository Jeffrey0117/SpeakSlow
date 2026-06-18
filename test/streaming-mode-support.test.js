const assert = require("node:assert/strict");
const test = require("node:test");

const supportModule = import("../src/utils/streamingModeSupport.mjs");

test("streaming mode stays disabled when the model is missing", async () => {
  const { shouldEnableStreamingMode } = await supportModule;

  assert.equal(
    shouldEnableStreamingMode(true, { success: true, models_downloaded: false }, { platform: "darwin" }),
    false
  );
  assert.equal(
    shouldEnableStreamingMode(true, { success: true, models_downloaded: true }, { platform: "win32" }),
    false
  );
});

test("streaming mode can enable only on macOS with downloaded model", async () => {
  const { shouldEnableStreamingMode } = await supportModule;

  assert.equal(
    shouldEnableStreamingMode(true, { success: true, models_downloaded: true }, { platform: "darwin" }),
    true
  );
  assert.equal(shouldEnableStreamingMode(false, null, { platform: "darwin" }), false);
});

test("streaming mode auto-downloads missing macOS model when the saved setting is enabled", async () => {
  const { resolveStreamingModeAvailability } = await supportModule;
  const calls = [];
  const api = {
    checkStreamingModelFiles: async () => {
      calls.push("check");
      return calls.length === 1
        ? { success: true, unsupported: false, models_downloaded: false }
        : { success: true, unsupported: false, models_downloaded: true };
    },
    downloadStreamingModel: async () => {
      calls.push("download");
      return { success: true };
    },
  };

  const result = await resolveStreamingModeAvailability(true, { platform: "darwin" }, api);

  assert.equal(result.enabled, true);
  assert.equal(result.downloaded, true);
  assert.deepEqual(calls, ["check", "download", "check"]);
});
