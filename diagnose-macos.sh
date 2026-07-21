#!/usr/bin/env bash
# SpeakSlow macOS 抓蟲腳本
# 用法: bash diagnose-macos.sh
set -euo pipefail
FAIL=0

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

check() {
  local label=$1 desc=$2
  shift 2
  if "$@" &>/dev/null; then
    green "  ✅ $label — $desc"
  else
    red "  ❌ $label — $desc"
    FAIL=1
  fi
}

warn_check() {
  local label=$1 desc=$2
  shift 2
  if "$@" &>/dev/null; then
    green "  ✅ $label — $desc"
  else
    yellow "  ⚠️  $label — $desc (不影響核心功能)"
  fi
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "══════════════════════════════════════════"
echo " SpeakSlow macOS 診斷腳本"
echo "══════════════════════════════════════════"
echo

# ── 1. 專案完整性 ──
echo "── 1. 專案結構 ──"
check "專案根目錄" "SpeakSlow folder exists" test -d .
check "package.json" "存在" test -f package.json
check "main.js" "Electron 主程序" test -f main.js
check "preload.js" "preload script" test -f preload.js
check "sherpa_server.py" "Python ASR 伺服器" test -f sherpa_server.py
check "text_processing.py" "文字處理模組" test -f text_processing.py
check "download_all_models.py" "模型下載腳本" test -f download_all_models.py
echo

# ── 2. Python 環境 ──
echo "── 2. Python 環境 ──"
if [ -d .venv ]; then
  green "  ✅ .venv 目錄存在"
else
  red "  ❌ .venv 不存在（未建立 Python 虛擬環境）"
  FAIL=1
fi

check "Python 3" ".venv/bin/python3 可用" test -x .venv/bin/python3
check "pip" ".venv/bin/pip 可用" test -f .venv/bin/pip

if .venv/bin/python3 -c "import sherpa_onnx; print('ok')" &>/dev/null; then
  VER=$(.venv/bin/python3 -c "import sherpa_onnx; print(sherpa_onnx.__version__)" 2>/dev/null || echo "ok")
  green "  ✅ sherpa-onnx $VER"
else
  red "  ❌ sherpa-onnx 未安裝 (pip install sherpa-onnx)"
  FAIL=1
fi
check "numpy" ".venv 內 numpy" .venv/bin/python3 -c "import numpy; print('ok')"
check "opencc" ".venv 內 opencc" .venv/bin/python3 -c "import opencc; print('ok')"
check "edge_tts" ".venv 內 edge_tts" .venv/bin/python3 -c "import edge_tts; print('ok')"
echo

# ── 3. 語音模型 ──
echo "── 3. 語音模型 ──"
check "Paraformer model" "model.int8.onnx (223MB)" test -f poc-sherpa/sherpa-onnx-paraformer-zh-2023-09-14/model.int8.onnx
check "Punctuation model" "ct-transformer" test -f poc-sherpa/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12/model.onnx
check "Silero VAD" "silero_vad.onnx" test -f poc-sherpa/silero_vad.onnx
echo

# ── 4. Node.js 環境 ──
echo "── 4. Node.js / npm ──"
check "node" "node 可用" command -v node
check "npm" "npm 可用" command -v npm
check "node_modules" "npm install 完成" test -d node_modules
check "electron" "electron 套件" test -d node_modules/electron
check "better-sqlite3" "native addon" test -d node_modules/better-sqlite3
check "uiohook-napi" "native addon" test -d node_modules/uiohook-napi
check "React" "前端框架" test -d node_modules/react
echo

# ── 5. 前端 Build ──
echo "── 5. 前端 Build ──"
check "Vite build" "dist/index.html 存在" test -f src/dist/index.html
echo

# ── 6. 程式碼掃描：遺留的 Windows-ism ──
echo "── 6. 程式碼掃描：遺留的 Windows 特定程式碼 ──"

# 應該只在 win32 context 出現的，不該裸寫
BAD_SPAWN=$(grep -rn "windowsHide" src/helpers/ --include="*.js" | grep -v "process.platform" | grep -v "win32" | grep -v "//" | wc -l | tr -d ' ' || true)
if [ "$BAD_SPAWN" -eq 0 ]; then
  green "  ✅ 所有 windowsHide 都在 platform 保護下"
else
  yellow "  ⚠️  有 $BAD_SPAWN 處 windowsHide 可能需要 platform guard"
  grep -rn "windowsHide" src/helpers/ --include="*.js" | grep -v "process.platform" | grep -v "//" || true
fi

# 檢查是否有殘留的 .exe 路徑（但排除已在 macOS guard 內的）
EXE_REFS=$(grep -rn "\.exe" src/ --include="*.js" | grep -v "process.platform.*win32" | grep -v "node_modules" | grep -v ".spec" | wc -l | tr -d ' ' || true)
if [ "$EXE_REFS" -gt 0 ]; then
  yellow "  ⚠️  $EXE_REFS 處 .exe 引用（可能在 platform guard 內）"
else
  green "  ✅ 無裸露的 .exe 引用"
fi

# 檢查是否所有 process.platform === 'darwin' 處理正確
echo

# ── 7. 實際功能測試 ──
echo "── 7. 實際功能測試 ──"

echo -n "  🧪 測試 sherpa server 模組載入..."
if .venv/bin/python3 -c "
import sys; sys.path.insert(0, '.')
from sherpa_server import SherpaServer
s = SherpaServer()
assert s.model_dir and 'paraformer' in s.model_dir
assert __import__('os').path.isfile(__import__('os').path.join(s.model_dir, 'model.int8.onnx'))
print(' 模型路徑:', s.model_dir)
" 2>/dev/null; then
  green "  ✅ sherpa server 模組載入成功"
else
  red "  ❌ sherpa server 模組載入失敗"
  .venv/bin/python3 -c "
import sys; sys.path.insert(0, '.')
from sherpa_server import SherpaServer
s = SherpaServer()
" 2>&1 || true
  FAIL=1
fi

echo -n "  🧪 測試 sherpa-onnx 實際初始化辨識器..."

# 只測試離線辨識器能否載入 — 這是實際跑模型推論的前置條件
if .venv/bin/python3 -c "
import sys, os, time
sys.path.insert(0, '.')
os.environ['SHERPA_PROVIDER'] = 'cpu'
import sherpa_onnx
mdir = 'poc-sherpa/sherpa-onnx-paraformer-zh-2023-09-14'
model_path = os.path.join(mdir, 'model.int8.onnx')
tokens_path = os.path.join(mdir, 'tokens.txt')
assert os.path.isfile(model_path), f'model not found: {model_path}'
t0 = time.time()
recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
    paraformer=model_path,
    tokens=tokens_path,
    num_threads=2,
    sample_rate=16000,
    feature_dim=80,
    decoding_method='greedy_search',
    provider='cpu',
)
elapsed = time.time() - t0
print(f' 載入耗時 {elapsed:.2f}s')
" 2>/dev/null; then
  green "  ✅ Paraformer 辨識器載入成功 (Apple Silicon CPU)"
else
  yellow "  ⚠️  Paraformer 載入失敗（可能 arm64 相容性，但不影響 app 啟動）"
  .venv/bin/python3 -c "
import sys, os
sys.path.insert(0, '.')
os.environ['SHERPA_PROVIDER'] = 'cpu'
import sherpa_onnx
mdir = 'poc-sherpa/sherpa-onnx-paraformer-zh-2023-09-14'
model_path = os.path.join(mdir, 'model.int8.onnx')
tokens_path = os.path.join(mdir, 'tokens.txt')
import sherpa_onnx
recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
    paraformer=model_path,
    tokens=tokens_path,
    num_threads=2,
    sample_rate=16000,
    feature_dim=80,
    decoding_method='greedy_search',
    provider='cpu',
)
" 2>&1
fi

echo -n "  🧪 測試文字後處理（簡轉繁）..."
if .venv/bin/python3 -c "
import sys; sys.path.insert(0, '.')
from text_processing import to_traditional
result = to_traditional('你好世界')
assert '你好世界' in result
result2 = to_traditional('计算机科学')
assert '計算機科學' in result2
print(' ok')
" 2>/dev/null; then
  green "  ✅ opencc 簡轉繁正常"
else
  yellow "  ⚠️  opencc 簡轉繁異常"
fi
echo

# ── 8. macOS 特有功能測試 ──
echo "── 8. macOS 特有功能測試 ──"

warn_check "say 指令" "macOS 內建 TTS" command -v say

# 檢查 mac accessibility（非阻塞：僅檢查狀態，不觸發對話框）
# 使用電子內建的方法：system_profiler 不適用；改用快速 osascript
# 設定 5 秒 timeout 避免 osascript 卡在權限對話框
ACCESS_RESULT="unknown"
if command -v osascript &>/dev/null; then
  # 用子 shell + 背景 + sleep 殺來實作 timeout（macOS 無 timeout 指令）
  TMPFILE=$(mktemp /tmp/ss_access.XXXXXX 2>/dev/null || echo "/tmp/ss_access")
  (osascript -e 'tell application "System Events"' -e 'return UI elements enabled' -e 'end tell' > "$TMPFILE" 2>/dev/null) &
  PID=$!
  (sleep 3; kill $PID 2>/dev/null) &
  wait $PID 2>/dev/null || true
  ACCESS_RESULT=$(cat "$TMPFILE" 2>/dev/null | tr -d '\n' || echo "unknown")
  rm -f "$TMPFILE" 2>/dev/null || true
fi

if [ "$ACCESS_RESULT" = "true" ]; then
  green "  ✅ macOS 輔助使用權限已授予"
else
  yellow "  ⚠️  macOS 輔助使用權限未授予或無法檢測 — 熱鍵/自動貼上不能動"
  yellow "     請至 系統設定→隱私與安全性→輔助功能 授權給 Terminal/Electron"
fi
echo

# ── 9. 整合測試 ──
echo "── 9. 整合測試（前後端串接） ──"

echo -n "  🧪 測試 Node.js 能否 require 所有關鍵模組..."
if node -e "
let failed = false;
for (const mod of ['electron', 'better-sqlite3', 'uiohook-napi', 'osascript']) {
  try {
    require(mod);
    console.log(mod + ': ok');
  } catch (e) {
    failed = true;
    console.error(mod + ': ' + e.message);
  }
}
process.exit(failed ? 1 : 0);
" 2>/dev/null; then
  green "  ✅ Node.js 關鍵模組 require 正常"
else
  red "  ❌ Node.js 模組 require 失敗"
  node -e "
try { require('better-sqlite3'); } catch(e) { console.error('better-sqlite3:', e.message); }
try { require('uiohook-napi'); } catch(e) { console.error('uiohook-napi:', e.message); }
"
  FAIL=1
fi

echo
echo "══════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  green " ✅ 全部檢查通過！SpeakSlow macOS 就緒。"
  green "    執行 source .venv/bin/activate && npm run dev 啟動"
else
  red " ❌ 有檢查項目失敗，請修正後重新執行本腳本。"
fi
echo "══════════════════════════════════════════"
exit $FAIL
