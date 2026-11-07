const clipboardText = require("./clipboardText");
const { getShared } = require("./clipboardSwap");
const { spawn, execSync, execFileSync } = require("child_process");

class ClipboardManager {
  constructor(logger) {
    // 初始化剪贴板管理器
    this.logger = logger;

    // Windows: 儲存之前的前景視窗 handle
    this.previousForegroundWindow = null;

    // macOS：熱鍵觸發前的前景 app（貼上前用來還原焦點，避免貼到本程式）
    this.previousMacForegroundApp = null;

    // Windows: 常駐 PowerShell（避免每次 spawn + Add-Type 的數秒延遲）
    this._psShell = null;
    this._psReady = false;
    this._psStdoutBuf = "";
    this._psPending = [];      // 等待回應的請求佇列 [{marker, resolve}]
    this._psReqSeq = 0;
    if (process.platform === "win32") {
      // 啟動時就預熱，第一次貼上即為快速
      try { this._ensurePsShell(); } catch (e) { /* 失敗則回退舊方法 */ }
    }

    // 尝试加载 osascript 模块（仅在 macOS 上）
    this.osascript = null;
    if (process.platform === "darwin") {
      try {
        this.osascript = require("osascript");
        this.safeLog("✅ osascript 模块加载成功");
      } catch (error) {
        this.safeLog("⚠️ osascript 模块加载失败，将使用备用方法", error.message);
      }
    }
  }

  // 安全日志方法 - 使用logManager记录
  safeLog(message, data = null) {
    if (this.logger) {
      try {
        this.logger.info(message, data);
      } catch (error) {
        // 静默忽略 EPIPE 错误
        if (error.code !== "EPIPE") {
          process.stderr.write(`日志错误: ${error.message}\n`);
        }
      }
    }
  }

  // =====================================================
  // Windows 常駐 PowerShell（避免每次 spawn + Add-Type 的數秒延遲）
  // handle 直接存在 PS 變數 $savedHwnd，Node 不需解析 stdout
  // =====================================================
  _ensurePsShell() {
    if (process.platform !== "win32") return null;
    if (this._psShell && this._psReady) return this._psShell;
    if (this._psShell) return this._psShell; // 啟動中

    try {
      const ps = spawn("powershell", ["-NoProfile", "-NoLogo"], {
        ...(process.platform === "win32" ? { windowsHide: true } : {}),
        stdio: ["pipe", "pipe", "pipe"],
      });
      this._psShell = ps;
      this._psReady = false;

      // 讀取常駐 PS 的 stdout，解析「打字完成」回報標記 <<TU:token:OK|ERR>>，
      // 讓 focusAndSmartInput 能等到「確認全部字元送出/貼上」才回報成功。
      this._psWaiters = this._psWaiters || new Map();
      let psBuf = "";
      ps.stdout.on("data", (chunk) => {
        psBuf += chunk.toString();
        let idx;
        while ((idx = psBuf.indexOf("\n")) >= 0) {
          const line = psBuf.slice(0, idx).trim();
          psBuf = psBuf.slice(idx + 1);
          const m = line.match(/<<TU:([0-9a-z]+):(OK|ERR)>>/);
          if (m) {
            const w = this._psWaiters.get(m[1]);
            if (w) {
              this._psWaiters.delete(m[1]);
              clearTimeout(w.timer);
              // 回傳狀態字串："ok"=確認完成；"err"=已嘗試但可能只完成一半（上層不可再貼上）
              w.resolve(m[2] === "OK" ? "ok" : "err");
            }
          }
        }
      });
      ps.stderr.on("data", (d) => {
        this.safeLog(`⚠️ PS 常駐錯誤: ${d.toString().slice(0, 200)}`);
      });
      const cleanup = () => {
        // 清掉所有還在等回報的 waiter（清 timer + resolve + 清空 map），
        // 避免 PS 結束/出錯時有 Promise 卡到各自的 timeout。
        // 用 "failed"（而非 "not-sent"）：指令已送出、PS 中途死掉，可能已打了一半 →
        // 上層不可再自動 Ctrl+V，以免與已輸入的字重複。
        if (this._psWaiters) {
          for (const w of this._psWaiters.values()) {
            clearTimeout(w.timer);
            w.resolve("failed");
          }
          this._psWaiters.clear();
        }
        this._psShell = null;
        this._psReady = false;
      };
      ps.on("exit", cleanup);
      ps.on("error", (e) => {
        this.safeLog(`❌ PS 常駐程序錯誤: ${e.message}`);
        cleanup();
      });
      // stdin 錯誤（如 EPIPE）需自行處理，否則未捕捉的 error 事件可能導致程式崩潰。
      ps.stdin.on("error", (e) => {
        this.safeLog(`⚠️ PS stdin 錯誤: ${e.message}`);
        cleanup();
      });

      // 一次性初始化：載入 Win32 API + WScript.Shell COM + 還原焦點函式
      const init = [
        // IsConsoleWindow：用視窗類別判斷目標是不是主控台（cmd/PowerShell=ConsoleWindowClass、
        // 決定用「逐字打字」還是「快速貼上」。只有傳統 conhost（ConsoleWindowClass）
        // 走逐字打字；Windows Terminal（CASCADIA_HOSTING_WINDOW_CLASS）的 Ctrl+V 貼上
        // 本來就正常，而且 unicode 逐字注入在 WT/某些 IME 狀態下會把含標點的文字
        // 打到損毀或整行消失（issue #33）→ WT 一律走貼上。
        `Add-Type -Namespace Native -Name Fg -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")][return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool c); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p); [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId(); [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount); public static bool IsConsoleWindow(IntPtr h) { if (h == IntPtr.Zero) return false; System.Text.StringBuilder sb = new System.Text.StringBuilder(256); GetClassName(h, sb, 256); string c = sb.ToString(); return c == "ConsoleWindowClass"; }'`,
        `$ws = New-Object -ComObject WScript.Shell`,
        `function Restore-Fg { param($hwnd) $ft=[Native.Fg]::GetWindowThreadProcessId($hwnd,[IntPtr]::Zero); $ct=[Native.Fg]::GetCurrentThreadId(); if($ft -ne $ct){[Native.Fg]::AttachThreadInput($ct,$ft,$true)|Out-Null}; [Native.Fg]::SetForegroundWindow($hwnd)|Out-Null; if($ft -ne $ct){[Native.Fg]::AttachThreadInput($ct,$ft,$false)|Out-Null} }`,
        // SendInput + KEYEVENTF_UNICODE 逐字打字：主控台（cmd / PowerShell）等
        // 不接受 SendKeys 貼上的視窗也能正確輸入文字。
        `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Uni { [StructLayout(LayoutKind.Sequential)] public struct INPUT { public int type; public InputUnion u; } [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public MOUSEINPUT mi; } [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; } [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; } [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int size); public static uint TypeString(string s) { uint total = 0; foreach (char c in s) { INPUT[] a = new INPUT[2]; a[0].type = 1; a[0].u.ki.wScan = (ushort)c; a[0].u.ki.dwFlags = 4; a[1].type = 1; a[1].u.ki.wScan = (ushort)c; a[1].u.ki.dwFlags = 6; total += SendInput(2, a, Marshal.SizeOf(typeof(INPUT))); } return total; } }'`,
        // 逐字打字並「確認全部字元都送出」：SendInput 回傳實際插入的事件數，
        // 與預期（字元數 x 2）比對；相符才回報 OK，否則 ERR（讓上層回退 Ctrl+V）。
        `function Type-Uni { param($b64,$tok) try { $t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)); $exp=[uint32]($t.Length*2); $got=[Uni]::TypeString($t); if($got -eq $exp -and $exp -gt 0){ Write-Output ('<<TU:'+$tok+':OK>>') } else { Write-Output ('<<TU:'+$tok+':ERR>>') } } catch { Write-Output ('<<TU:'+$tok+':ERR>>') } }`,
        // 依「主控台輸入方式」設定 $mode 選擇輸入法（還原焦點後）：
        //   'type'  → 一律逐字打字（SendInput Unicode，什麼視窗都能進，含 cmd）
        //   'paste' → 一律 Ctrl+V 貼上（原版行為，長文最快）
        //   其他/'auto' → 偵測目標視窗：主控台逐字打字、一般視窗貼上（預設）
        // 三條路都回報同一個 <<TU:token:OK|ERR>> 標記，上層等同確認。
        `function Smart-Input { param($b64,$tok,$mode) try { if ($savedHwnd -ne [IntPtr]::Zero) { Restore-Fg $savedHwnd; Start-Sleep -Milliseconds 25 }; if ($mode -eq 'type') { $useType = $true } elseif ($mode -eq 'paste') { $useType = $false } else { $useType = [Native.Fg]::IsConsoleWindow($savedHwnd) }; if ($useType) { Type-Uni $b64 $tok } else { $ws.SendKeys('^v'); Write-Output ('<<TU:'+$tok+':OK>>') } } catch { Write-Output ('<<TU:'+$tok+':ERR>>') } }`,
        // 撤銷目標視窗裡剛貼上的文字。**終端機不能送 Ctrl+Z**：
        //   cmd.exe  → ^Z 是 EOF 字元，會被當成輸入打進去
        //   bash/WSL → Ctrl+Z 是 SIGTSTP，會把使用者正在跑的程式丟到背景
        //   PowerShell(PSReadLine) → 這個才真的是 undo，但同一個視窗類別分不出是哪個 shell
        // 所以主控台一律改送對應字數的倒退鍵，那在任何 shell 的行編輯器都安全。
        // 跨行的文字在終端機已經被 Enter 送出去了，倒退鍵退不過換行 → 回報 ERR，
        // 讓上層不要再貼一次（不然舊文字＋新文字會黏在一起，這就是原本的症狀）。
        `function Undo-In-Target { param($n,$multi,$tok) try { if ($savedHwnd -ne [IntPtr]::Zero) { Restore-Fg $savedHwnd; Start-Sleep -Milliseconds 25 }; if ([Native.Fg]::IsConsoleWindow($savedHwnd)) { if ($multi -eq '1') { Write-Output ('<<TU:'+$tok+':ERR>>'); return }; if ($n -gt 0) { $ws.SendKeys('{BS ' + $n + '}') }; Write-Output ('<<TU:'+$tok+':OK>>') } else { $ws.SendKeys('^z'); Write-Output ('<<TU:'+$tok+':OK>>') } } catch { Write-Output ('<<TU:'+$tok+':ERR>>') } }`,
        `$savedHwnd = [IntPtr]::Zero`,
      ];
      for (const line of init) ps.stdin.write(line + "\r\n");
      this._psReady = true; // stdin 有序，後續指令會排在 init 之後執行
      this.safeLog("✅ 常駐 PowerShell 已就緒（快速貼上）");
      return ps;
    } catch (e) {
      this.safeLog(`⚠️ 無法啟動常駐 PowerShell，將回退舊方法: ${e.message}`);
      this._psShell = null;
      this._psReady = false;
      return null;
    }
  }

  _psSend(line) {
    if (!this._psShell || !this._psReady) return false;
    try {
      this._psShell.stdin.write(line + "\r\n");
      return true;
    } catch (e) {
      this.safeLog(`⚠️ 寫入常駐 PS 失敗: ${e.message}`);
      this._psReady = false;
      return false;
    }
  }

  // 送出指令並等待常駐 PS 回報 <<TU:token:OK|ERR>>。回傳狀態字串：
  //   "ok"       → 確認完成（全部字元送出，或已貼上）
  //   "err"      → 已嘗試但可能只完成一半（上層不可再 Ctrl+V，避免重複輸入）
  //   "timeout"  → 逾時未回報；指令可能仍在 PS 端跑（同樣不可再 Ctrl+V）
  //   "not-sent" → 指令根本沒送出（PS 未就緒/寫入失敗）→ 什麼都沒發生，上層可安全回退
  _psSendAndWait(line, token, timeoutMs) {
    return new Promise((resolve) => {
      if (!this._psShell || !this._psReady) return resolve("not-sent");
      this._psWaiters = this._psWaiters || new Map();
      const timer = setTimeout(() => {
        this._psWaiters.delete(token);
        resolve("timeout");
      }, timeoutMs);
      this._psWaiters.set(token, { resolve, timer });
      try {
        this._psShell.stdin.write(line + "\r\n");
      } catch (e) {
        clearTimeout(timer);
        this._psWaiters.delete(token);
        this.safeLog(`⚠️ 寫入常駐 PS 失敗: ${e.message}`);
        this._psReady = false;
        resolve("not-sent");
      }
    });
  }

  // ===== Linux：用 xdotool 做等效的「擷取前景視窗 / 還原焦點 / 送鍵」 =====
  // 操作模式在 Linux 靠 xdotool（X11 可用；Wayland 需切到 Xorg session）。
  _xdoSpawn(args) {
    try {
      const { spawn } = require("child_process");
      const p = spawn("xdotool", args, { stdio: "ignore" });
      p.on("error", (e) =>
        this.safeLog(`⚠️ xdotool 執行失敗（請安裝 xdotool）: ${e.message}`)
      );
      return true;
    } catch (e) {
      return false;
    }
  }
  _xdoCapture() {
    try {
      const { execFileSync } = require("child_process");
      const out = execFileSync("xdotool", ["getactivewindow"], { timeout: 1000 })
        .toString()
        .trim();
      this._savedWindowId = out || null;
      return true;
    } catch (e) {
      this.safeLog(`⚠️ xdotool getactivewindow 失敗（請安裝 xdotool）: ${e.message}`);
      this._savedWindowId = null;
      return false;
    }
  }
  _xdoKeys(keyArr) {
    if (!keyArr || !keyArr.length) return false;
    const id = this._savedWindowId;
    return id
      ? this._xdoSpawn(["windowactivate", "--sync", id, "key", ...keyArr])
      : this._xdoSpawn(["key", ...keyArr]);
  }
  // SendKeys 語法（^a / ^c / ^v / {ENTER} / {DEL}）→ xdotool key 規格陣列
  _sendKeysToXdo(keys) {
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      const ch = keys[i];
      if (ch === "^") {
        const next = keys[++i];
        if (next) out.push("ctrl+" + next.toLowerCase());
      } else if (ch === "{") {
        const end = keys.indexOf("}", i);
        const stop = end < 0 ? keys.length : end;
        const name = keys.slice(i + 1, stop).toUpperCase();
        i = stop;
        out.push(name === "ENTER" ? "Return" : name === "DEL" || name === "DELETE" ? "Delete" : name);
      }
    }
    return out;
  }

  // 快速擷取目前前景視窗（Windows 存進 PS 變數；Linux 存進 this._savedWindowId）
  captureForegroundFast() {
    if (process.platform === "linux") return this._xdoCapture();
    const ps = this._ensurePsShell();
    if (!ps) return false;
    return this._psSend(`$savedHwnd = [Native.Fg]::GetForegroundWindow()`);
  }

  // macOS：把焦點還原到熱鍵觸發前的 app，再送一串 System Events 按鍵（同步，配合 Fast 方法簽名）。
  // 用 execFileSync 一次跑完 activate + 按鍵，跟 sendMacOSPaste 同一套 osascript 機制。
  // 一樣受「輔助使用」權限約束；沒權限會丟例外 → 回 false（呼叫端會顯示提示）。
  _macFocusKeystroke(osaLines) {
    if (!osaLines || osaLines.length === 0) return false;
    try {
      const activate = this.previousMacForegroundApp
        ? this.buildMacOSActivateScript(this.previousMacForegroundApp)
        : "";
      const body = osaLines
        .map((l) => `tell application "System Events" to ${l}`)
        .join("\ndelay 0.03\n");
      const script = `${activate}\ndelay 0.06\n${body}`;
      execFileSync("osascript", ["-e", script], { timeout: 3000 });
      return true;
    } catch (e) {
      this.safeLog("⚠️ macOS Fast 按鍵失敗（可能缺輔助使用權限）", e.message);
      return false;
    }
  }

  // 把 Windows SendKeys 語法轉成 macOS System Events 指令序列（^字母 → Cmd+字母）
  _sendKeysToOsascript(keys) {
    const lines = [];
    const special = {
      ENTER: "keystroke return",
      DEL: "key code 51",
      DELETE: "key code 51",
      BACKSPACE: "key code 51",
      TAB: "keystroke tab",
      ESC: "key code 53",
    };
    const re = /\^([a-zA-Z])|\{([A-Z]+)\}/g;
    let m;
    while ((m = re.exec(keys)) !== null) {
      if (m[1]) lines.push(`keystroke "${m[1].toLowerCase()}" using command down`);
      else if (m[2] && special[m[2]]) lines.push(special[m[2]]);
    }
    return lines;
  }

  // 快速：還原焦點到先前視窗並貼上（Ctrl+V）
  focusAndPasteFast() {
    if (process.platform === "linux") return this._xdoKeys(["ctrl+v"]);
    if (process.platform === "darwin") return this._macFocusKeystroke(['keystroke "v" using command down']);
    const ps = this._ensurePsShell();
    if (!ps) return false;
    return this._psSend(
      `if ($savedHwnd -ne [IntPtr]::Zero) { Restore-Fg $savedHwnd; Start-Sleep -Milliseconds 25 }; $ws.SendKeys('^v')`
    );
  }

  // 快速：還原焦點到先前視窗，並依「目標是不是主控台」自動選擇輸入方式：
  //   主控台（cmd/PowerShell/Terminal）→ SendInput + KEYEVENTF_UNICODE 逐字打字
  //     （這類視窗不接受 SendKeys 貼上，逐字打字是唯一能輸入的方式）
  //   一般視窗 → 維持原本的 SendKeys('^v') 快速貼上（長文比逐字打字快，保留作者原設計）
  // 回傳 _psSendAndWait 的狀態字串："ok"/"err"/"timeout"/"not-sent"（語意見該函式）。
  async focusAndSmartInput(text, mode = "auto") {
    if (process.platform !== "win32") return "not-sent";
    const ps = this._ensurePsShell();
    if (!ps) return "not-sent";
    const b64 = Buffer.from(String(text), "utf8").toString("base64");
    const token = "t" + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
    // mode 只可能是 auto/type/paste（來自設定白名單，非使用者自由輸入），可安全內嵌
    const m = mode === "type" || mode === "paste" ? mode : "auto";
    // 逐字打字這條路較久，逾時時間隨長度放寬；貼上那條會很快回報。
    const timeoutMs = Math.min(8000, 800 + String(text).length * 20);
    return this._psSendAndWait(`Smart-Input '${b64}' '${token}' '${m}'`, token, timeoutMs);
  }

  // 快速：還原焦點到先前視窗並複製選取（Ctrl+C）—— 操作模式抓選取用
  focusAndCopyFast() {
    if (process.platform === "linux") return this._xdoKeys(["ctrl+c"]);
    if (process.platform === "darwin") return this._macFocusKeystroke(['keystroke "c" using command down']);
    const ps = this._ensurePsShell();
    if (!ps) return false;
    return this._psSend(
      `if ($savedHwnd -ne [IntPtr]::Zero) { Restore-Fg $savedHwnd; Start-Sleep -Milliseconds 25 }; $ws.SendKeys('^c')`
    );
  }

  // 快速：還原焦點到前景視窗並送出任意按鍵（操作模式的按鍵指令用）
  // keys 為 SendKeys 語法字串（^a=Ctrl+A、^c、^v、{ENTER}、{DELETE} 等）
  /**
   * 撤銷目標視窗裡剛剛貼上的文字。
   * 一般視窗送 Ctrl+Z；主控台改送對應字數的倒退鍵（見上方 Undo-In-Target 的註解）。
   * @param {string} oldText 剛剛貼出去的那段文字（決定主控台要退幾格）
   */
  async undoInTargetFast(oldText = "") {
    const text = typeof oldText === "string" ? oldText : "";
    if (process.platform === "linux") {
      return { ok: this._xdoKeys(this._sendKeysToXdo("^z")), method: "undo" };
    }
    if (process.platform === "darwin") {
      return { ok: this._macFocusKeystroke(this._sendKeysToOsascript("^z")), method: "undo" };
    }
    if (!this._ensurePsShell()) return { ok: false, reason: "no-powershell" };

    // 以碼點數算退格數：CJK 一字一格。emoji 在主控台少見，退不乾淨不致命。
    const n = [...text].length;
    // 跨行：倒退鍵退不過換行，而且在終端機裡那幾行早就被 Enter 送出去了
    const multi = text.includes("\n") || text.includes("\r") ? "1" : "0";
    const tok = `u${Date.now().toString(36)}`;
    // 要真的等結果：撤銷失敗時上層必須「不要再貼」，否則舊文字＋新文字會黏在
    // 一起（這就是在終端機裡用快速修改看到的症狀）。
    const status = await this._psSendAndWait(`Undo-In-Target ${n} '${multi}' '${tok}'`, tok, 2500);
    if (status === "ok") return { ok: true, chars: n };
    this.safeLog(`⚠️ 撤銷目標視窗文字未成功（${status}，${n} 字${multi === "1" ? "、跨行" : ""}）`);
    return { ok: false, reason: status, chars: n, multiline: multi === "1" };
  }

  focusAndSendKeysFast(keys) {
    if (process.platform === "linux") return this._xdoKeys(this._sendKeysToXdo(keys));
    if (process.platform === "darwin") return this._macFocusKeystroke(this._sendKeysToOsascript(keys));
    const ps = this._ensurePsShell();
    if (!ps) return false;
    // keys 為內建常數（非使用者輸入），不含單引號，可安全內嵌
    return this._psSend(
      `if ($savedHwnd -ne [IntPtr]::Zero) { Restore-Fg $savedHwnd; Start-Sleep -Milliseconds 25 }; $ws.SendKeys('${keys}')`
    );
  }

  // 快速：送出 Enter
  sendEnterFast() {
    if (process.platform === "linux") return this._xdoKeys(["Return"]);
    const ps = this._ensurePsShell();
    if (!ps) return false;
    return this._psSend(`Start-Sleep -Milliseconds 20; $ws.SendKeys('{ENTER}')`);
  }

  // 简化的 macOS accessibility 检查
  async enableMacOSAccessibility() {
    if (process.platform !== "darwin") return true;
    
    try {
      this.safeLog("🔧 检查 macOS accessibility 权限");
      
      // 简化为基本的权限检查，不设置复杂的AXManualAccessibility
      const script = `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
          return frontApp
        end tell
      `;
      
      const testProcess = spawn("osascript", ["-e", script]);
      
      return new Promise((resolve) => {
        testProcess.on("close", (code) => {
          if (code === 0) {
            this.safeLog("✅ macOS accessibility 权限正常");
            resolve(true);
          } else {
            this.safeLog("⚠️ macOS accessibility 权限不足");
            resolve(false);
          }
        });
        
        testProcess.on("error", () => {
          this.safeLog("❌ accessibility 权限检查失败");
          resolve(false);
        });
      });
    } catch (error) {
      this.safeLog("❌ 检查 macOS accessibility 时出错:", error.message);
      return false;
    }
  }

  // 简化的文本插入方法 - 直接使用标准粘贴方式
  async insertTextDirectly(text) {
    // 简化实现，直接使用标准的粘贴方法
    this.safeLog("🎯 使用标准粘贴方式插入文本");
    return await this.pasteText(text);
  }

  async pasteText(text, opts = {}) {
    try {
      // 只記長度，不記內容（辨識文字可能含隱私）
      this.safeLog("🎯 pasteText:", text ? `${text.length} 字` : "(空)");
      // 主控台輸入方式（來自設定）：auto（偵測主控台自動切換）/ type（一律逐字打字）/ paste（一律貼上）
      const consoleInputMode = opts.consoleInputMode || "auto";
      // 貼完之後剪貼簿要留哪一份：
      //   "dictation"（預設）＝留剛講的話，想拿回原本複製的東西就連按兩下觸發鍵
      //   "restore"        ＝還原使用者原本複製的東西（連按兩下才拿回聽寫文字）
      // 預設選 dictation 的理由：剪貼簿還原在 2026-11-07 之前其實是壞的，
      // 所有使用者長期體驗的就是「聽寫文字留著」，改掉反而是破壞既有習慣。
      // 兩個方向都有手勢可以切回來，所以這只是「哪一邊當起點」的差別。
      const keepDictation = opts.clipboardAfterPaste !== "restore";

      if (process.platform === "win32") {
        // 先保存使用者原本的剪貼簿，貼上後再還原，避免覆蓋掉他複製的東西。
        // ⚠ 一定要 await：Electron 45 的剪貼簿 API 是非同步的，少了 await 拿到的
        // 是 Promise，後面所有比對都會失效（見 clipboardText.js 的說明）。
        const originalClipboard = await clipboardText.readText();
        await clipboardText.writeText(text);
        // 記下這兩份，手勢才切得動；起始狀態要跟下面實際有沒有還原一致
        getShared(this.logger).remember(
          text,
          originalClipboard,
          keepDictation ? "dictation" : "user"
        );

        // 常駐 PowerShell 還原焦點 + 依設定選擇輸入方式（type/paste/auto）。
        const status = await this.focusAndSmartInput(text, consoleInputMode);
        if (status === "ok") {
          this.safeLog(`⚡ 快速輸入完成 (模式=${consoleInputMode})`);
        } else if (status === "not-sent") {
          // 指令根本沒送出（常駐 PS 未就緒）→ 什麼都沒發生，安全回退 Ctrl+V。
          if (this.focusAndPasteFast()) {
            this.safeLog("⚡ 快速貼上 (回退 Ctrl+V)");
          } else {
            // 回退：舊的 spawn 方式（每次 Add-Type，較慢）
            this.safeLog("⌨️ 嘗試自動貼上 (SendKeys 回退)");
            await this.pasteWindows();
          }
        } else {
          // "err"/"timeout"/"failed"：逐字打字已送出但未確認成功，可能已打了一半 →
          // 不再自動 Ctrl+V（避免和已輸入的字重複）；文字已在剪貼簿，可手動貼上。
          this.safeLog(`⚠️ 輸入未確認完成（${status}），文字已在剪貼簿，可手動 Ctrl+V`);
        }

        // 等貼上完成後還原原本的剪貼簿內容（給足 Ctrl+V 讀取的時間）。
        // 剪貼簿管理工具／輸入法（如手心輸入法）常在內容變動後立刻開啟剪貼簿讀取，
        // 撞上時 Windows 會拒絕寫入且 Electron 不丟錯——「還原」看起來成功實際沒寫進去
        // （issue #31）。所以寫完要讀回驗證，不符就退避重試。
        const restoreClipboard = async (attempt = 0) => {
          try {
            // 使用者若已自己複製了新內容，就不要蓋掉
            if ((await clipboardText.readText()) !== text) return;
            await clipboardText.writeText(originalClipboard);
            if ((await clipboardText.readText()) === originalClipboard) {
              this.safeLog("↩️ 已還原使用者原本的剪貼簿");
              return;
            }
          } catch (e) { /* 走下方重試 */ }
          if (attempt < 4) {
            setTimeout(() => { restoreClipboard(attempt + 1); }, 300 * (attempt + 1));
          } else {
            this.safeLog("⚠️ 剪貼簿還原多次失敗（可能被其他程式長時間佔用）");
          }
        };
        // keepDictation 時刻意不還原：聽寫文字留在剪貼簿，等使用者要才用手勢換回去
        if (keepDictation) {
          this.safeLog("📋 聽寫文字留在剪貼簿（連按兩下觸發鍵可換回原本的內容）");
        } else {
          setTimeout(() => restoreClipboard(), 400);
        }
        return;
      }

      // macOS/Linux: 使用 Electron clipboard（同樣要 await，見上方說明）
      const originalClipboard = await clipboardText.readText();
      await clipboardText.writeText(text);
      getShared(this.logger).remember(
        text,
        originalClipboard,
        keepDictation ? "dictation" : "user"
      );

      if (process.platform === "darwin") {
        // 简化权限检查，直接尝试粘贴
        this.safeLog("🔍 检查粘贴操作的辅助功能权限");
        const hasPermissions = await this.checkAccessibilityPermissions();

        if (!hasPermissions) {
          this.safeLog("⚠️ 没有辅助功能权限 - 文本仅复制到剪贴板");
          const errorMsg =
            "需要辅助功能权限才能自动粘贴。文本已复制到剪贴板 - 请手动使用 Cmd+V 粘贴。";
          throw new Error(errorMsg);
        }

        this.safeLog("✅ 权限已授予，尝试粘贴");
        return await this.pasteMacOS(originalClipboard);
      } else {
        // Linux
        return await this.pasteLinux(originalClipboard);
      }
    } catch (error) {
      throw error;
    }
  }

  async pasteMacOS(originalClipboard) {
    // 貼上前先把焦點還原到熱鍵觸發前的 app（否則會貼到本程式視窗）by webeasyplay PR #3
    if (this.previousMacForegroundApp) {
      const restoreResult = await this.restoreMacOSForegroundApp();
      if (restoreResult.success) {
        this.safeLog("🔄 macOS 貼上前已還原原本焦點 app");
      } else {
        this.safeLog(`⚠️ macOS 還原焦點失敗，仍會嘗試貼上: ${restoreResult.error || "unknown"}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
    return await this.sendMacOSPaste(originalClipboard);
  }

  async sendMacOSPaste(originalClipboard) {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ]);

      let hasTimedOut = false;

      pasteProcess.stderr.on("data", () => {});

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();

        if (code === 0) {
          this.safeLog("✅ 通过 Cmd+V 模拟成功粘贴文本");
          if (!keepDictation) {
            setTimeout(() => {
              clipboardText.writeText(originalClipboard).then(() => {
                this.safeLog("🔄 原始剪贴板内容已恢复");
              });
            }, 100);
          }
          resolve();
        } else {
          const errorMsg = `粘贴失败 (代码 ${code})。文本已复制到剪贴板 - 请手动使用 Cmd+V 粘贴。`;
          reject(new Error(errorMsg));
        }
      });

      pasteProcess.on("error", (error) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();
        const errorMsg = `粘贴命令失败: ${error.message}。文本已复制到剪贴板 - 请手动使用 Cmd+V 粘贴。`;
        reject(new Error(errorMsg));
      });

      const timeoutId = setTimeout(() => {
        hasTimedOut = true;
        pasteProcess.kill("SIGKILL");
        pasteProcess.removeAllListeners();
        const errorMsg =
          "粘贴操作超时。文本已复制到剪贴板 - 请手动使用 Cmd+V 粘贴。";
        reject(new Error(errorMsg));
      }, 3000);
    });
  }

  async pasteWindows() {
    // 先恢復焦點到之前的視窗，再貼上
    if (this.previousForegroundWindow) {
      this.safeLog("🔄 貼上前先恢復焦點到之前的視窗...");
      await this.restoreForegroundWindow();
      // 等待視窗切換完成
      await new Promise(r => setTimeout(r, 100));
    }

    return new Promise((resolve) => {
      const pasteProcess = spawn("powershell", [
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ], process.platform === "win32" ? { windowsHide: true } : {});

      pasteProcess.on("close", (code) => {
        if (code === 0) {
          this.safeLog("✅ SendKeys 貼上成功");
        } else {
          this.safeLog(`⚠️ SendKeys 返回代碼 ${code}，文字仍在剪貼簿，可手動 Ctrl+V`);
        }
        resolve();
      });

      pasteProcess.on("error", (error) => {
        this.safeLog(`⚠️ SendKeys 失敗: ${error.message}，文字仍在剪貼簿`);
        resolve();
      });
    });
  }

  async pasteLinux(originalClipboard) {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("xdotool", ["key", "ctrl+v"]);

      pasteProcess.on("close", (code) => {
        if (code === 0) {
          // 文本粘贴成功
          if (!keepDictation) {
            setTimeout(() => {
              clipboardText.writeText(originalClipboard);
            }, 100);
          }
          resolve();
        } else {
          reject(
            new Error(
              `Linux 粘贴失败，代码 ${code}。文本已复制到剪贴板。`
            )
          );
        }
      });

      pasteProcess.on("error", (error) => {
        reject(
          new Error(
            `Linux 粘贴失败: ${error.message}。文本已复制到剪贴板。`
          )
        );
      });
    });
  }

  async checkAccessibilityPermissions() {
    if (process.platform !== "darwin") return true;

    return new Promise((resolve) => {
      // 检查辅助功能权限
      const testProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to get name of first process',
      ]);

      let testOutput = "";
      let testError = "";

      testProcess.stdout.on("data", (data) => {
        testOutput += data.toString();
      });

      testProcess.stderr.on("data", (data) => {
        testError += data.toString();
      });

      testProcess.on("close", (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          this.showAccessibilityDialog(testError);
          resolve(false);
        }
      });

      testProcess.on("error", (error) => {
        resolve(false);
      });
    });
  }

  showAccessibilityDialog(testError) {
    const isStuckPermission =
      testError.includes("not allowed assistive access") ||
      testError.includes("(-1719)") ||
      testError.includes("(-25006)");

    let dialogMessage;
    if (isStuckPermission) {
      dialogMessage = `🔒 聲聲慢需要輔助功能權限，但看起來您可能有來自先前版本的舊權限。

❗ 常見問題：如果您重新構建/重新安裝了聲聲慢，舊權限可能"卡住"並阻止新權限。

🔧 解決方法：
1. 打開系統設置 → 隱私與安全性 → 輔助功能
2. 查找任何舊的"聲聲慢"條目並刪除它們（點擊 - 按鈕）
3. 同時刪除任何顯示"Electron"或名稱不明確的條目
4. 點擊 + 按鈕並手動添加新的聲聲慢應用
5. 確保複選框已啟用
6. 重啟聲聲慢

⚠️ 這在開發期間重新構建應用時特別常見。

📝 沒有此權限，文字將只複製到剪貼簿（無自動貼上）。

您想現在打開系統設置嗎？`;
    } else {
      dialogMessage = `🔒 聲聲慢需要輔助功能權限才能將文字貼上到其他應用程式中。

📋 當前狀態：剪貼簿複製有效，但貼上（Cmd+V 模擬）失敗。

🔧 解決方法：
1. 打開系統設置（或較舊 macOS 上的系統偏好設置）
2. 轉到隱私與安全性 → 輔助功能
3. 點擊鎖圖標並輸入您的密碼
4. 將聲聲慢添加到列表中並勾選複選框
5. 重啟聲聲慢

⚠️ 沒有此權限，聽寫文字將只複製到剪貼簿但不會自動貼上。

💡 在生產版本中，此權限是完整功能所必需的。

您想現在打開系統設置嗎？`;
    }

    const permissionDialog = spawn("osascript", [
      "-e",
      `display dialog "${dialogMessage}" buttons {"取消", "打开系统设置"} default button "打开系统设置"`,
    ]);

    permissionDialog.on("close", (dialogCode) => {
      if (dialogCode === 0) {
        this.openSystemSettings();
      }
    });

    permissionDialog.on("error", (error) => {
      // 权限对话框错误 - 用户需要手动授予权限
    });
  }

  openSystemSettings() {
    const settingsCommands = [
      [
        "open",
        [
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        ],
      ],
      ["open", ["-b", "com.apple.systempreferences"]],
      ["open", ["/System/Library/PreferencePanes/Security.prefPane"]],
    ];

    let commandIndex = 0;
    const tryNextCommand = () => {
      if (commandIndex < settingsCommands.length) {
        const [cmd, args] = settingsCommands[commandIndex];
        const settingsProcess = spawn(cmd, args);

        settingsProcess.on("error", (error) => {
          commandIndex++;
          tryNextCommand();
        });

        settingsProcess.on("close", (settingsCode) => {
          if (settingsCode !== 0) {
            commandIndex++;
            tryNextCommand();
          }
        });
      } else {
        // 所有设置命令都失败，尝试后备方案
        spawn("open", ["-a", "System Preferences"]).on("error", () => {
          spawn("open", ["-a", "System Settings"]).on("error", () => {
            // 无法打开设置应用
          });
        });
      }
    };

    tryNextCommand();
  }

  /**
   * Windows: 儲存當前前景視窗 (在錄音開始前呼叫)
   * 使用同步方式確保在熱鍵觸發時立即獲取
   * @returns {{success: boolean, handle?: string}}
   */
  // 鎖住「目標視窗」記憶：快速修改卡開著時，使用者在卡片裡按觸發鍵重講，
  // 當下的前景視窗是聲聲慢自己——若讓它覆蓋 $savedHwnd，修正完的撤銷與貼上
  // 會全部送給聲聲慢而不是原本的目標視窗（記事本改不到字的真正原因）。
  setForegroundLock(locked) {
    this._fgLocked = !!locked;
    return { success: true, locked: this._fgLocked };
  }

  saveForegroundWindow() {
    if (this._fgLocked) {
      return { success: true, message: "目標視窗已鎖定（快速修改中），保留原目標" };
    }

    if (process.platform === "darwin") {
      return this.saveMacOSForegroundApp();
    }

    if (process.platform !== "win32") {
      return { success: true, message: "非 Windows 平台" };
    }

    // 優先：用常駐 PowerShell 快速擷取（非阻塞，handle 存在 PS 端 $savedHwnd）
    if (this.captureForegroundFast()) {
      this.previousForegroundWindow = "ps"; // 旗標：已在 PS 端擷取焦點
      this.safeLog("✅ 已快速擷取前景視窗 (常駐 PS)");
      return { success: true, handle: "ps" };
    }

    // 常駐 PS 沒就緒時的後備。**一定要非同步**：
    // 這支函式跑在全域熱鍵（uiohook 低階鍵盤鉤子）的回呼鏈上，而低階鉤子的
    // callback 就在主程序執行。舊版在這裡用 execSync 開一個完整 PowerShell 並
    // Add-Type 編譯 C#（數百毫秒到數秒），期間主程序完全卡住 → Windows 來不及
    // 處理鉤子回呼 → 全系統滑鼠鍵盤跟著延遲（issue #28「滑鼠卡卡的」）。
    // 改成背景取得、取到再補寫；錄音本來就要講好幾秒，來得及。
    try {
      this.safeLog("🔍 背景取得前景視窗 handle…");
      const child = spawn(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          'Add-Type -MemberDefinition \'[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\' -Name Win32 -Namespace Native; [Native.Win32]::GetForegroundWindow().ToInt64()',
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
      );
      let out = "";
      child.stdout.on("data", (d) => { out += d.toString(); });
      child.on("error", () => { /* 取不到就維持剪貼簿模式，不影響基本功能 */ });
      child.on("close", () => {
        const handle = out.trim();
        if (handle && handle !== "0") {
          this.previousForegroundWindow = handle;
          this.safeLog(`✅ 已儲存前景視窗 handle: ${handle}`);
        } else {
          this.safeLog("⚠️ 無法取得前景視窗 handle，改用剪貼簿模式");
        }
      });
      // 幾秒拿不到就放棄，別留一個殭屍 PowerShell
      setTimeout(() => { try { child.kill(); } catch (e) { /* ignore */ } }, 3000);
      return { success: true, handle: null, pending: true };
    } catch (error) {
      this.safeLog(`⚠️ 取得前景視窗失敗（不影響基本功能）: ${error.message}`);
      return { success: true, handle: null };
    }
  }

  /**
   * Windows: 恢復焦點到之前儲存的視窗
   * @returns {Promise<{success: boolean}>}
   */
  async restoreForegroundWindow() {
    if (process.platform === "darwin") {
      return await this.restoreMacOSForegroundApp();
    }

    if (process.platform !== "win32") {
      return { success: true, message: "非 Windows 平台" };
    }

    if (!this.previousForegroundWindow) {
      this.safeLog("⚠️ 沒有儲存的前景視窗 handle");
      return { success: false, error: "沒有儲存的前景視窗" };
    }

    return new Promise((resolve) => {
      const handle = this.previousForegroundWindow;
      this.safeLog(`🔄 嘗試恢復焦點到視窗 handle: ${handle}`);

      // 使用 PowerShell 設定前景視窗（簡化版，不改變視窗狀態）
      const psCommand = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            [return: MarshalAs(UnmanagedType.Bool)]
            public static extern bool SetForegroundWindow(IntPtr hWnd);
            [DllImport("user32.dll")]
            public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ProcessId);
            [DllImport("kernel32.dll")]
            public static extern uint GetCurrentThreadId();
          }
"@
        $hwnd = [IntPtr]::new(${handle})

        # 嘗試 AttachThreadInput 讓 SetForegroundWindow 更可靠
        $foregroundThread = [Win32]::GetWindowThreadProcessId($hwnd, [IntPtr]::Zero)
        $currentThread = [Win32]::GetCurrentThreadId()

        if ($foregroundThread -ne $currentThread) {
          [Win32]::AttachThreadInput($currentThread, $foregroundThread, $true) | Out-Null
        }

        $result = [Win32]::SetForegroundWindow($hwnd)

        if ($foregroundThread -ne $currentThread) {
          [Win32]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null
        }

        $result
      `;

      const setWindowProcess = spawn("powershell", ["-Command", psCommand]);

      let output = "";
      let errorOutput = "";

      setWindowProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      setWindowProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      setWindowProcess.on("close", (code) => {
        if (code === 0) {
          const success = output.trim().toLowerCase() === "true";
          if (success) {
            this.safeLog(`✅ 已恢復焦點到視窗 handle: ${handle}`);
          } else {
            this.safeLog(`⚠️ SetForegroundWindow 返回 false，可能需要手動點擊`);
          }
          resolve({ success });
        } else {
          this.safeLog(`⚠️ 恢復焦點失敗: ${errorOutput}`);
          resolve({ success: false, error: errorOutput });
        }
      });

      setWindowProcess.on("error", (error) => {
        this.safeLog(`❌ 恢復焦點失敗: ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * 复制文本到剪贴板
   * @param {string} text - 要复制的文本
   * @returns {Promise<{success: boolean}>}
   */
  async copyText(text) {
    try {
      await clipboardText.writeText(text);
      return { success: true };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 从剪贴板读取文本
   * @returns {Promise<string>}
   */
  async readClipboard() {
    try {
      const text = await clipboardText.readText();
      return text;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 将文本写入剪贴板
   * @param {string} text - 要写入的文本
   * @returns {Promise<{success: boolean}>}
   */
  async writeClipboard(text) {
    try {
      await clipboardText.writeText(text);
      return { success: true };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 發送 Enter 鍵（完全信任模式：貼上後自動送出）
   * @returns {Promise<{success: boolean}>}
   */
  async sendEnter() {
    try {
      this.safeLog("⏎ 發送 Enter 鍵（完全信任模式）");

      if (process.platform === "win32") {
        // 優先用常駐 PowerShell（快速）
        if (this.sendEnterFast()) {
          this.safeLog("⚡ 快速送出 Enter (常駐 PS)");
          return { success: true };
        }
        return await this.sendEnterWindows();
      } else if (process.platform === "darwin") {
        return await this.sendEnterMacOS();
      } else {
        return await this.sendEnterLinux();
      }
    } catch (error) {
      this.safeLog(`❌ 發送 Enter 失敗: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async sendEnterWindows() {
    return new Promise((resolve) => {
      const enterProcess = spawn("powershell", [
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
      ]);

      enterProcess.on("close", (code) => {
        if (code === 0) {
          this.safeLog("✅ Enter 鍵發送成功");
          resolve({ success: true });
        } else {
          this.safeLog(`⚠️ Enter 鍵發送失敗，代碼 ${code}`);
          resolve({ success: false, error: `Exit code ${code}` });
        }
      });

      enterProcess.on("error", (error) => {
        this.safeLog(`❌ Enter 鍵發送錯誤: ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  }

  async sendEnterMacOS() {
    return new Promise((resolve) => {
      const enterProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to keystroke return',
      ]);

      enterProcess.on("close", (code) => {
        if (code === 0) {
          this.safeLog("✅ Enter 鍵發送成功 (macOS)");
          resolve({ success: true });
        } else {
          this.safeLog(`⚠️ Enter 鍵發送失敗 (macOS)，代碼 ${code}`);
          resolve({ success: false, error: `Exit code ${code}` });
        }
      });

      enterProcess.on("error", (error) => {
        this.safeLog(`❌ Enter 鍵發送錯誤 (macOS): ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  }

  async sendEnterLinux() {
    return new Promise((resolve) => {
      const enterProcess = spawn("xdotool", ["key", "Return"]);

      enterProcess.on("close", (code) => {
        if (code === 0) {
          this.safeLog("✅ Enter 鍵發送成功 (Linux)");
          resolve({ success: true });
        } else {
          this.safeLog(`⚠️ Enter 鍵發送失敗 (Linux)，代碼 ${code}`);
          resolve({ success: false, error: `Exit code ${code}` });
        }
      });

      enterProcess.on("error", (error) => {
        this.safeLog(`❌ Enter 鍵發送錯誤 (Linux): ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  }

  // ===== macOS：存/還原前景 app（讓熱鍵錄音後貼回原本視窗）by webeasyplay PR #3 =====
  saveMacOSForegroundApp() {
    try {
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp
          set appPid to unix id of frontApp
          return "" & linefeed & appName & linefeed & (appPid as text)
        end tell
      `;

      const output = execFileSync("osascript", ["-e", script], {
        encoding: "utf8",
        timeout: 1000,
      }).replace(/\r?\n$/, "");

      const [bundleId = "", name = "", pid = ""] = output.split(/\r?\n/).map((line) => line.trim());
      if (!bundleId && !name && !pid) {
        this.safeLog("⚠️ 無法取得 macOS 前景 app");
        return { success: true, platform: "darwin", target: null, message: "無法取得前景 app" };
      }

      this.previousMacForegroundApp = { bundleId, name, pid };
      this.safeLog(`💾 已儲存 macOS 前景 app: ${name || bundleId || pid}`);
      return { success: true, platform: "darwin", target: this.previousMacForegroundApp };
    } catch (error) {
      this.safeLog(`⚠️ 儲存 macOS 前景 app 失敗: ${error.message}`);
      return { success: true, platform: "darwin", target: null, message: "無法取得前景 app" };
    }
  }

  async restoreMacOSForegroundApp() {
    const target = this.previousMacForegroundApp;
    if (!target || (!target.bundleId && !target.name && !target.pid)) {
      this.safeLog("⚠️ 沒有儲存的 macOS 前景 app");
      return { success: false, error: "沒有儲存的 macOS 前景 app" };
    }

    const script = this.buildMacOSActivateScript(target);

    return new Promise((resolve) => {
      const restoreProcess = spawn("osascript", ["-e", script]);
      let errorOutput = "";

      restoreProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      restoreProcess.on("close", (code) => {
        if (code === 0) {
          this.safeLog(`🔄 已還原 macOS 前景 app: ${target.name || target.bundleId || target.pid}`);
          resolve({ success: true });
        } else {
          const error = errorOutput.trim() || `Exit code ${code}`;
          this.safeLog(`⚠️ 還原 macOS 前景 app 失敗: ${error}`);
          resolve({ success: false, error });
        }
      });

      restoreProcess.on("error", (error) => {
        this.safeLog(`⚠️ 還原 macOS 前景 app 失敗: ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  }

  buildMacOSActivateScript(target) {
    const bundleId = this.escapeAppleScriptString(target.bundleId || "");
    const appName = this.escapeAppleScriptString(target.name || "");
    const pid = String(target.pid || "").replace(/\D/g, "");

    if (pid) {
      return `
        tell application "System Events"
          set frontmost of first application process whose unix id is ${pid} to true
        end tell
      `;
    }

    if (bundleId) {
      return `tell application id "${bundleId}" to activate`;
    }

    return `tell application "${appName}" to activate`;
  }

  escapeAppleScriptString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
}

module.exports = ClipboardManager;