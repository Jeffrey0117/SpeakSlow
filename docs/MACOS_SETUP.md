# macOS 設定指南

SpeakSlow 在 macOS（Apple Silicon / Intel）上可完整執行。以下是指南。

## 系統需求

- macOS 13+（Ventura 或更新版本）
- Python 3.10–3.12（[官網下載](https://www.python.org/downloads/) 或 `brew install python@3.11`）
- Node.js 18+ 與 npm（[官方安裝](https://nodejs.org/) 或 `brew install node`）
- **輔助使用權限**（Accessibility）：讓系統熱鍵（右 Alt）與自動貼上（Cmd+V）正常運作

## 快速開始（開發模式）

```bash
# 1. Clone 專案
git clone https://github.com/Jeffrey0117/SpeakSlow.git
cd SpeakSlow

# 2. Python 虛擬環境 + 相依套件
python3 -m venv .venv
source .venv/bin/activate
pip install sherpa-onnx numpy opencc edge-tts

# 3. 下載語音模型（約 540MB）
python download_all_models.py

# 4. Node.js 相依套件
npm install

# 5. 啟動開發伺服器
npm run dev
```

啟動後會同時啟動 Vite 開發伺服器（:5173）與 Electron 視窗。

## 輔助使用權限設定

首次使用時，macOS 會要求授予輔助使用權限：

1. 打開 **系統設定 → 隱私與安全性 → 輔助功能**
2. 點擊 **+** 按鈕
3. 選取 **SpeakSlow.app**（或開發模式下的 **Electron.app**）
4. 勾啟該應用程式
5. 重新啟動 SpeakSlow

沒有此權限時，系統熱鍵（右 Alt）無法觸發錄音，文字也無法自動貼上（但仍會複製到剪貼簿，可手動 Cmd+V）。

## 開發指令

```bash
npm run dev           # 開發模式（Vite hot-reload + Electron）
npm run build:renderer  # 僅編譯前端
npm run dist:mac      # 編譯前端 + 產出 DMG 安裝檔
```

## macOS 差異說明

| 功能 | Windows 實作 | macOS 實作 |
|------|-------------|-----------|
| 熱鍵（右 Alt 切換錄音） | `uiohook-napi` | `uiohook-napi`（需輔助使用權限） |
| 自動貼上 | PowerShell SendKeys | `osascript` Cmd+V 模擬 |
| 還原前景視窗 | user32.dll `SetForegroundWindow` | AppleScript `activate` |
| 文字朗讀 | Windows SAPI | `say` 指令（內建 Ting-Ting 中文語音） |
| 資料目錄 | `%APPDATA%\聲聲慢` | `~/Library/Application Support/聲聲慢` |

## 常見問題

**Q: 啟動後熱鍵沒反應？**

→ 確認已在 **系統設定 → 隱私與安全性 → 輔助功能** 中授予 Electron/SpeakSlow 權限。

**Q: 錄音完文字沒自動貼上？**

→ 檢查輔助使用權限。文字仍會複製到剪貼簿，可手動 Cmd+V。

**Q: `npm run dev` 啟動後一片空白？**

→ 確認 Vite 開發伺服器已啟動（http://localhost:5173）。可先獨立執行 `cd src && npx vite` 檢查。

**Q: 語音模型載入失敗？**

→ 確認 `.venv` 已啟用且 `pip install sherpa-onnx` 成功。執行 `python download_all_models.py` 檢查模型是否完整。

## 打包發佈

```bash
npm run dist:mac
```

會在 `dist/` 目錄產出 `SpeakSlow-{arch}.dmg`。支援 arm64（Apple Silicon）與 x64（Intel）。

> **注意**：目前 macOS 版使用直接執行 Python 腳本模式（非 PyInstaller 打包的獨立 binary）。
> 使用者需先安裝 Python 與 sherpa-onnx 相依套件。未來可選用 PyInstaller 打包為獨立應用。