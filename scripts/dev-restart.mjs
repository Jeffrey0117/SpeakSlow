// 開發迴圈用：重建 renderer + 用原始碼重啟聲聲慢（約 10 秒），
// 不必跑 CI 打包 1.2GB 安裝檔（那一輪要 10 分鐘以上）。
//
// 安裝版與開發版共用同一個資料目錄（AppData\Roaming\聲聲慢），
// 設定、歷史、字典都不會因為切換而遺失。
//
// 用法：
//   node scripts/dev-restart.mjs            重建 renderer 後重啟
//   node scripts/dev-restart.mjs --no-build  只重啟（只改主行程時更快）
//   node scripts/dev-restart.mjs --stop      停掉開發版（之後可改開安裝版）

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pidFile = path.join(root, ".dev-app.pid");
const args = process.argv.slice(2);
const noBuild = args.includes("--no-build");
const stopOnly = args.includes("--stop");

const isWin = process.platform === "win32";

function killPidTree(pid) {
  if (!pid) return;
  try {
    if (isWin) execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
    else process.kill(pid, "SIGKILL");
  } catch (e) { /* 已經不在了 */ }
}

// 只殺「我們自己啟動的開發版」（靠 pid 檔）與安裝版（SpeakSlow.exe 是本專案獨有的名字）。
// 絕不用 /IM electron.exe —— 那會波及其他 Electron 程式（含 Claude Code）。
function stopRunning() {
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0) killPidTree(pid);
    try { unlinkSync(pidFile); } catch (e) { /* ignore */ }
  }
  if (isWin) {
    for (const name of ["SpeakSlow.exe", "sherpa_server.exe"]) {
      try { execFileSync("taskkill", ["/F", "/T", "/IM", name], { stdio: "ignore" }); } catch (e) { /* 沒在跑 */ }
    }
  }
}

stopRunning();
if (stopOnly) {
  console.log("[dev] 已停止開發版（安裝版可照常從開始選單開啟）");
  process.exit(0);
}

if (!noBuild) {
  console.log("[dev] 重建 renderer…");
  const r = spawnSync("npm", ["run", "build:renderer"], { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error("[dev] renderer 建置失敗，不重啟（避免你拿到壞掉的版本）");
    process.exit(1);
  }
}

const electronBin = path.join(
  root, "node_modules", "electron", "dist",
  isWin ? "electron.exe" : "electron"
);
if (!existsSync(electronBin)) {
  console.error(`[dev] 找不到 Electron：${electronBin}`);
  process.exit(1);
}

// detached + stdio ignore：不繼承呼叫端的終端機，
// 否則 app 的 log 會把使用者的終端機洗版（踩過）。
const child = spawn(electronBin, ["."], {
  cwd: root,
  detached: true,
  stdio: "ignore",
  windowsHide: false,
});
child.unref();
writeFileSync(pidFile, String(child.pid), "utf8");
console.log(`[dev] 已啟動開發版（pid ${child.pid}）——改完再跑一次這個指令即可`);
