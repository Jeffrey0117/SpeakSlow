const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const test = require("node:test");

function loadClipboardManager({ execFileSyncOutput = "", spawnCloseDelay = 0 } = {}) {
  const modulePath = require.resolve("../src/helpers/clipboard.js");
  delete require.cache[modulePath];

  const spawnCalls = [];
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") {
      return {
        clipboard: {
          readText: () => "",
          writeText: () => {},
        },
      };
    }

    if (request === "osascript") {
      return {};
    }

    if (request === "child_process") {
      return {
        execSync: () => "",
        execFileSync: () => execFileSyncOutput,
        spawn: (command, args = []) => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = () => {};
          child.removeAllListeners = EventEmitter.prototype.removeAllListeners.bind(child);
          spawnCalls.push({ command, args });
          setTimeout(() => child.emit("close", 0), spawnCloseDelay);
          return child;
        },
      };
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    return {
      ClipboardManager: require(modulePath),
      spawnCalls,
      restoreLoad: () => {
        Module._load = originalLoad;
        delete require.cache[modulePath];
      },
    };
  } catch (error) {
    Module._load = originalLoad;
    delete require.cache[modulePath];
    throw error;
  }
}

test("macOS saveForegroundWindow stores the current frontmost app", (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS-only behavior");
    return;
  }

  const { ClipboardManager, restoreLoad } = loadClipboardManager({
    execFileSyncOutput: "\nTextEdit\n1234\n",
  });
  t.after(restoreLoad);

  const manager = new ClipboardManager({ info: () => {} });
  const result = manager.saveForegroundWindow();

  assert.equal(result.success, true);
  assert.equal(result.platform, "darwin");
  assert.deepEqual(manager.previousMacForegroundApp, {
    bundleId: "",
    name: "TextEdit",
    pid: "1234",
  });
});

test("macOS restoreForegroundWindow activates the saved process id", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS-only behavior");
    return;
  }

  const { ClipboardManager, spawnCalls, restoreLoad } = loadClipboardManager();
  t.after(restoreLoad);

  const manager = new ClipboardManager({ info: () => {} });
  manager.previousMacForegroundApp = {
    bundleId: "",
    name: "TextEdit",
    pid: "1234",
  };

  const result = await manager.restoreForegroundWindow();

  assert.equal(result.success, true);
  assert.equal(spawnCalls[0].command, "osascript");
  assert.match(spawnCalls[0].args.join("\n"), /unix id is 1234/);
});

test("pasteMacOS restores focus before sending Cmd+V", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS-only behavior");
    return;
  }

  const { ClipboardManager, spawnCalls, restoreLoad } = loadClipboardManager();
  t.after(restoreLoad);

  const manager = new ClipboardManager({ info: () => {} });
  manager.previousMacForegroundApp = {
    bundleId: "com.apple.TextEdit",
    name: "TextEdit",
    pid: "1234",
  };

  await manager.pasteMacOS("original");

  assert.equal(spawnCalls.length, 2);
  assert.match(spawnCalls[0].args.join("\n"), /unix id is 1234/);
  assert.match(spawnCalls[1].args.join("\n"), /keystroke "v" using command down/);
});
