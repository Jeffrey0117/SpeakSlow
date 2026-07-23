const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

let _current = null;
let _speechGeneration = 0;

/**
 * 用 Windows 內建 SAPI 朗讀文字（免費、免相依、免網路）。
 * CJK 安全：文字寫成 UTF-8 暫存檔，PowerShell 以 UTF-8 讀回，避免編碼亂碼。
 * 偏好繁體中文語音（系統有的話），抓不到就用預設。
 */
function speakSapi(text) {
  if (process.platform !== "win32") {
    return { success: false, error: "目前只支援 Windows 朗讀" };
  }
  if (!text || !text.trim()) {
    return { success: false, error: "沒有文字可朗讀" };
  }
  try {
    // 先停掉上一段，避免兩段疊著念
    if (_current && !_current.killed) {
      try { _current.kill(); } catch (e) { /* ignore */ }
    }
    const tmp = path.join(os.tmpdir(), "speakslow_tts.txt");
    fs.writeFileSync(tmp, text, "utf8");
    const tmpEsc = tmp.replace(/\\/g, "\\\\");
    const script =
      "$t=[System.IO.File]::ReadAllText('" + tmpEsc + "',[System.Text.Encoding]::UTF8);" +
      "Add-Type -AssemblyName System.Speech;" +
      "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
      "try{$s.SelectVoiceByHints('NotSet','NotSet',0,(New-Object System.Globalization.CultureInfo('zh-TW')))}catch{};" +
      "$s.Speak($t)";
    const ps = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      ...(process.platform === "win32" ? { windowsHide: true } : {}),
    });
    ps.on("error", () => { /* ignore */ });
    _current = ps;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 用 macOS 內建 say 指令朗讀中文。
 * 使用 Ting-Ting 語音（macOS 內建繁體中文）。
 */
function speakMacOs(text) {
  if (process.platform !== "darwin") {
    return Promise.resolve({ success: false, error: "目前只支援 macOS 朗讀" });
  }
  if (!text || !text.trim()) {
    return Promise.resolve({ success: false, error: "沒有文字可朗讀" });
  }

  if (_current && !_current.killed) {
    try { _current.kill(); } catch (e) { /* ignore */ }
  }
  const generation = ++_speechGeneration;

  const runSay = (args) => new Promise((resolve) => {
    let settled = false;
    let child;
    try {
      child = spawn("say", args);
      _current = child;
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({
          success: false,
          cancelled: generation !== _speechGeneration,
          error: error.message,
        });
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        if (generation !== _speechGeneration) {
          resolve({ success: false, cancelled: true, error: "語音朗讀已被新的請求取代" });
          return;
        }
        resolve(code === 0
          ? { success: true }
          : { success: false, error: `say 結束代碼 ${code}${signal ? `（${signal}）` : ""}` });
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });

  return runSay(["-v", "Ting-Ting", text]).then((result) => {
    // 被 stopSpeaking() 或新的朗讀請求取消時，不可再啟動 fallback，
    // 否則會重新開始播放，並覆蓋 _current 的新程序。
    if (result.success || result.cancelled) return result;
    return runSay([text]);
  });
}

function stopSpeaking() {
  _speechGeneration += 1;
  if (_current && !_current.killed) {
    try { _current.kill(); } catch (e) { /* ignore */ }
  }
  _current = null;
}

module.exports = { speakSapi, speakMacOs, stopSpeaking };