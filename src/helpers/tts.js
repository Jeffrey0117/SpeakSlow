const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

let _current = null;

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
    return { success: false, error: "目前只支援 macOS 朗讀" };
  }
  if (!text || !text.trim()) {
    return { success: false, error: "沒有文字可朗讀" };
  }
  try {
    if (_current && !_current.killed) {
      try { _current.kill(); } catch (e) { /* ignore */ }
    }
    // macOS 內建中文語音：Ting-Ting（台灣華語），Mei-Jia（中國普通話）
    // 先檢查 ting-ting 是否存在，否則用預設語音
    const say = spawn("say", ["-v", "Ting-Ting", text]);
    let fallbackStarted = false;
    const startFallback = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      // Ting-Ting 不存在或無法使用，嘗試用預設語音
      const fallback = spawn("say", [text]);
      fallback.on("error", () => { /* ignore */ });
      _current = fallback;
    };
    say.on("error", startFallback);
    say.on("close", (code) => {
      if (code !== 0) startFallback();
    });
    _current = say;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function stopSpeaking() {
  if (_current && !_current.killed) {
    try { _current.kill(); } catch (e) { /* ignore */ }
  }
  _current = null;
}

module.exports = { speakSapi, speakMacOs, stopSpeaking };