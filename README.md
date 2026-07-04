<div align="center">

<br/>

<img src="assets/icon.png" width="110" alt="聲聲慢 logo">

# 聲聲慢 (SpeakSlow)

### 用講的，比打字快好幾倍

**專為中文打造、最快的本地語音輸入。開口說，文字直接落在你游標的位置。全程在你電腦本地跑，一個字都不上雲。免費、開源。**

<img src="https://img.shields.io/github/stars/Jeffrey0117/SpeakSlow?style=social" alt="Stars">
<img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg" alt="License">
<img src="https://img.shields.io/badge/platform-Windows_｜_macOS_｜_Linux-0078D6" alt="Platform">
<img src="https://img.shields.io/badge/ASR-sherpa--onnx-orange" alt="ASR">
<img src="https://img.shields.io/badge/100%25-local-success" alt="Local">

🌐 **[官方網站](https://jeffrey0117.github.io/SpeakSlow/)** ・ 📖 **[使用教學](https://jeffrey0117.github.io/SpeakSlow/#/guide)** ・ ⬇️ **[直接下載](#-下載windows--macos--linux)**

</div>

<br/>

> 按一下 **右 Alt / 右 Ctrl** → 講中文 → 文字**自動貼到你游標所在的位置**。
> 語音辨識**完全在你電腦本地運行**，一個字都不上雲。

<div align="center">

<img src="assets/demo.gif" width="300" alt="30 秒實測：講完即貼，全程本機">

🎬 <a href="https://jeffrey0117.github.io/SpeakSlow/demo.mp4">高畫質影片版</a>（講完即貼，全程本機）

</div>

<br/>

## 為什麼有人一天用它講了一萬八千字？

因為**講話本來就比打字快**，尤其中文。你只是需要一個「講完馬上變乾淨文字、直接落在游標處」的工具，而且不想把聲音上傳到任何地方。

> 「與同為本地端的 WhisperDesktop 相比，聲聲慢的轉譯速度**極快**，中文辨識表現不錯……本身也支援擴充 API KEY，可以再提升精準度。」
> <br/>出自「電腦王阿達」使用心得

- 🚀 **極快**：講完約 **0.3 秒**貼上。長講邊錄邊算，101 秒的長講實測快 8 倍。
- 💬 **為 AI 對話而生**：跟 ChatGPT / Claude / Cursor 講很多話時，用講的比打字快太多，講完直接送出。
- 🔒 **100% 本地**：聲音不上傳任何伺服器，比雲端服務更私密。
- 🆓 **免費開源**：不用訂閱、不用註冊。

<br/>

## ⬇️ 下載（Windows / macOS / Linux）

<div align="center">

| 🪟 Windows | 🍎 macOS (Apple Silicon) | 🐧 Linux |
|:---:|:---:|:---:|
| **[下載 .exe](https://github.com/Jeffrey0117/SpeakSlow/releases/latest/download/SpeakSlow-Setup.exe)** | **[下載 .dmg](https://github.com/Jeffrey0117/SpeakSlow/releases/latest/download/SpeakSlow-arm64.dmg)** | **[下載 .AppImage](https://github.com/Jeffrey0117/SpeakSlow/releases/latest/download/SpeakSlow.AppImage)** |
| 雙擊安裝，AI 模型已內建 | 見下方權限說明 | 直接執行 |

</div>

> 🍎 **macOS 首次開啟**若顯示「已毀損」，不是檔案壞掉，是未簽章被系統擋。拖進「應用程式」後執行一次：`xattr -cr /Applications/SpeakSlow.app`。全域熱鍵與自動貼上需到「系統設定 → 隱私權與安全性 → 輔助使用」勾選 SpeakSlow。Mac 沒有右 Ctrl，可在設定頁把觸發鍵改成 F8～F10。

<br/>

## ✨ 它能做什麼

### 🎙️ 又快又準的本地辨識
- **本地** sherpa-onnx **Paraformer（int8、非自回歸）**：講完約 **0.3 秒**貼上
- **為中文 / 台灣優化**：簡轉繁用台灣標準字（「吃」不是「喫」）；中英混用（晶晶體）英文保留原文、不亂翻
- **長講邊錄邊算**：錄音中先解碼講完的段落，停止後不論講多長都約 0.2 秒出字
- **防幻聽**：不講話絕不會冒出文字，靜音與環境噪音直接拒絕解碼；長音訊自動 VAD 分段
- **熱詞 / 自訂字典**：提升人名、產品、術語等專有名詞的準確度

### 🧹 乾淨的輸出（以下全部**不需要 AI**、純本地規則）
- **自動標點**：依語意 + 句末語助詞（嗎 → ？、啊 → ！）
- **去口吃贅字**：刪掉「呃、嗯、那個、然後…」，但保留正常疊字（慢慢、謝謝）
- **阿拉伯數字還原**：逐字唸的號碼 / 年份自動變回阿拉伯數字（一二三 → 123、二〇二四 → 2024）
- **全形英文 → 半形**：`ｈｅｌｌｏ` → `hello`

### ⌨️ 順手的互動
- **一鍵切換觸發鍵**：按一下開始、再按一下停止並貼上；錄音中 `Esc` 取消。觸發鍵可自訂（右 Alt / 右 Ctrl / F8～F10）
- **貼到游標處、不污染剪貼簿**：貼上後自動還原你原本的剪貼簿內容
- **面板一鍵 AI 開關**：不需要潤飾時直接關掉，省 API、要時再開

### 🤖 AI 文字優化（可選：要更強再開）
- 接任何**相容 OpenAI** 的服務：DeepSeek / Gemini / OpenAI，或**本地 Ollama（全離線、免 API key）**
- 內建為**台灣口語**調校的 prompt：潤飾、糾錯、整理排版

### 📊 數據與歷史
- **可分享的數據儀表板**：總口述時間、字數、節省時間、平均速度
- **完整歷史**：搜尋、統計、匯出、一鍵清空
- **錄音永久保存**：辨識不滿意可**一鍵重新辨識**，甚至用 **Whisper** 換更強的模型重辨

## 📊 作者本人天天在用（不是做好看的）

<div align="center">
<img src="assets/usage-dashboard.jpg" width="46%" alt="累計 36,707 字、省下 17 小時 22 分">
<img src="assets/usage-history.jpg" width="46%" alt="單日口述一萬八千字的歷史紀錄">

<em>口述 3 小時 = 省下 17 小時打字。有一天講了一萬八千字，可以出書了，書名就叫《我說的》。</em>
</div>

## 🔒 隱私：100% 本地，聲音不外流

語音辨識在**你自己的電腦**跑，**聲音不上傳任何伺服器**。
更進一步：AI 潤飾也能接**本機的 Ollama / LM Studio**（跑在你自己的顯卡上），整條「講話 → 辨識 → 潤稿」都在本地，什麼都不離開你電腦。
你的歷史與錄音存在本機資料庫，跟程式碼分開，**不會被開源出去**。

## ⚖️ 跟其他工具比

| | **聲聲慢** | 雲端語音服務 | 其他本地工具 |
|---|:---:|:---:|:---:|
| 速度 | **極快（約 0.3 秒）** | 中（要上傳） | 慢～中 |
| 中文 / 台灣用字 | **專門優化** | 一般 | 一般 |
| 隱私 | **100% 本地** | ⚠️ 聲音上雲 | 本地 |
| 自動貼到游標處 | **✅** | 多半沒有 | 多半沒有 |
| 價格 | **免費開源** | 多為付費 / 訂閱 | 不一定 |

## 🚀 開發者：從原始碼執行

需 **Node.js 18+**、**Python 3.x**：

```bash
git clone https://github.com/Jeffrey0117/SpeakSlow.git
cd SpeakSlow

# Node 依賴
npm install
npx electron-builder install-app-deps

# Python 環境 + sherpa-onnx
python -m venv .venv
.venv/Scripts/python.exe -m pip install sherpa-onnx numpy opencc

# 下載模型（離線辨識 + 標點 + 串流 + VAD）
.venv/Scripts/python.exe download_all_models.py

# 啟動
npm run dev
```

> 模型檔較大（約 250MB～），已在 `.gitignore` 排除，需執行 `download_all_models.py` 下載。

## 🛠️ 技術棧

- **前端**：React 19、Tailwind CSS、Vite ｜ **桌面端**：Electron（Windows / macOS / Linux）
- **語音辨識（本地）**：[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)：Paraformer（離線）、Whisper（精準）、Silero VAD、ct-transformer（標點）、Zipformer（串流）
- **資料庫**：better-sqlite3 ｜ **全域熱鍵**：uiohook-napi

## 🗺️ Roadmap

- [x] Windows / macOS / Linux 三平台安裝檔
- [x] 可自訂觸發鍵、阿拉伯數字還原
- [ ] 內建本地 LLM 一鍵設定
- [ ] 用音量 / 音高判斷問號、驚嘆號（韻律標點）

## 🤝 貢獻

歡迎 issue / PR！這是給中文使用者的工具，你的回饋就是方向。

### 程式碼貢獻者

[![Contributors](https://contrib.rocks/image?repo=Jeffrey0117/SpeakSlow)](https://github.com/Jeffrey0117/SpeakSlow/graphs/contributors)

### 社群回饋 🙌

感謝這些朋友的回報、建議與實測，把產品一點一點推得更好：

[@webeasyplay](https://github.com/webeasyplay) · [@MeteorVE](https://github.com/MeteorVE) · [@adamjwchen](https://github.com/adamjwchen) · [@Drava008](https://github.com/Drava008) · [@NaotoSama](https://github.com/NaotoSama) · [@m45801ch](https://github.com/m45801ch) · [@jaylooloomi](https://github.com/jaylooloomi) · [@artexwear](https://github.com/artexwear) · [@RYN6666999](https://github.com/RYN6666999) · [@Skywalker95241](https://github.com/Skywalker95241) · [@dick922](https://github.com/dick922) · [@GenKoKo](https://github.com/GenKoKo)

## 🙏 致謝

- [ququ (yan5xu/ququ)](https://github.com/yan5xu/ququ)：原始專案，本專案在其基礎上改用 sherpa-onnx 引擎並重做 UI 與互動。
- [sherpa-onnx (k2-fsa)](https://github.com/k2-fsa/sherpa-onnx)：本地語音辨識引擎。
- [Wispr Flow](https://wisprflow.ai/)：產品概念的啟發。

## ⭐ Star History

如果聲聲慢對你有幫助，給顆星支持一下，這是最實際的鼓勵 🌟

<a href="https://www.star-history.com/#Jeffrey0117/SpeakSlow&Date">
  <img alt="Star History Chart" src="assets/star-history.png" width="620" />
</a>

<sub>點圖看即時曲線</sub>

## 📄 授權

本專案採用 [Apache License 2.0](LICENSE)。
