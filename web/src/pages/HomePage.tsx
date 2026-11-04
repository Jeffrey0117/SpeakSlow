import { useEffect, useState } from 'react'
import {
  Github, Download, BookOpen, Zap, ShieldCheck, Sparkles, Brain,
  MessageSquare, FileText, Terminal, Star, ArrowRight, Apple, Laptop,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav'

const REPO = 'https://github.com/Jeffrey0117/SpeakSlow'
// 永久連結：永遠指向最新 release 的固定檔名，發版後不用再改官網
const DOWNLOAD = `${REPO}/releases/latest/download/SpeakSlow-Setup.exe`
const DOWNLOAD_MAC = `${REPO}/releases/latest/download/SpeakSlow-arm64.dmg`
const DOWNLOAD_MAC_INTEL = `${REPO}/releases/latest/download/SpeakSlow-x64.dmg`
const DOWNLOAD_LINUX = `${REPO}/releases/latest/download/SpeakSlow.AppImage`

// 功能四支柱：聲聲慢真正的差異化，不吹牛
const FEATURES = [
  {
    icon: Zap,
    title: '快到沒有感覺',
    desc: '模型常駐記憶體、零暖機。短句講完 ~0.3 秒貼上；長講邊錄邊算，一分鐘的話停止後 ~0.2 秒出字。',
  },
  {
    icon: ShieldCheck,
    title: '100% 本地，不上雲',
    desc: '辨識全程在你的電腦上跑，聲音不離開機器、斷網照用。沒有帳號、沒有 API key、沒有用量帳單。',
  },
  {
    icon: Sparkles,
    title: '輸出乾淨，免靠雲端 AI',
    desc: '標點、去口吃、自動列點、停頓斷行全是本地規則。台灣用字、簡繁自動轉換，講完就是能直接用的文字。',
  },
  {
    icon: Brain,
    title: '愈用愈懂你',
    desc: '點字改錯會記進個人字典，下次自動修正。自訂觸發鍵、串流模式、AI 優化（可選）都在設定裡。',
  },
]

// 場景化展示：讓訪客對號入座
const SCENARIOS = [
  {
    icon: MessageSquare,
    title: '跟 AI 對話',
    desc: '對 ChatGPT / Claude / Cursor 講很多話？用講的比打字快太多，講完馬上送出，小錯字 AI 也讀得懂。',
    tag: '最多人的用法',
  },
  {
    icon: FileText,
    title: '寫文件、回訊息',
    desc: 'Word、LINE、Email、瀏覽器⋯⋯游標在哪就貼到哪。貼上後自動還原你原本的剪貼簿，不打斷工作流。',
    tag: '日常輸入',
  },
  {
    icon: Terminal,
    title: '終端機也能講',
    desc: 'cmd / PowerShell / Windows Terminal 一樣能進字——自動偵測主控台改用逐字輸入，別的工具貼不進去的地方我們可以。',
    tag: '工程師專屬',
  },
]

// 比較表精華版（完整版在 /compare）
const COMPARE_ROWS = [
  { k: '辨識在哪裡跑', us: '你自己的電腦', cloud: '雲端伺服器', win: '雲端（微軟）' },
  { k: '聲音會不會上傳', us: '不會，斷網可用', cloud: '會', win: '會' },
  { k: '費用', us: '免費、無限量', cloud: '依 API 用量計費', win: '免費' },
  { k: '台灣用字', us: '◎ 標準字＋語助詞標點', cloud: '○ 看模型', win: '△' },
]

export default function HomePage() {
  const [stars, setStars] = useState<number | null>(null)

  useEffect(() => {
    // GitHub stars 當社會證明；拿不到就不顯示，不擋頁面
    fetch('https://api.github.com/repos/Jeffrey0117/SpeakSlow')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.stargazers_count != null) setStars(d.stargazers_count) })
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Nav />

      {/* ===== Hero ===== */}
      <section className="container mx-auto px-4 pt-14 pb-10">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="font-title text-5xl md:text-6xl font-bold text-gray-900 dark:text-white mb-2">
            聲聲慢
          </h1>
          <p className="text-lg text-gray-400 dark:text-gray-500 mb-5">SpeakSlow</p>

          <p className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-3">
            讓每一個字，都被聽見
          </p>
          <p className="text-lg md:text-xl text-gray-700 dark:text-gray-200 mb-8">
            專為中文打造、<strong>最快</strong>的本地語音輸入——用講的取代打字，超快、超準、不上雲。
          </p>

          {/* 三平台下載按鈕並排 */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-3">
            <a
              href={DOWNLOAD}
              className="inline-flex items-center justify-center gap-2 px-7 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors shadow-lg"
            >
              <Download className="w-5 h-5" /> Windows 版（免費）
            </a>
            <a
              href={DOWNLOAD_MAC}
              className="inline-flex items-center justify-center gap-2 px-7 py-4 bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded-xl transition-colors shadow-lg border border-gray-200 dark:border-gray-600"
            >
              <Apple className="w-5 h-5" /> macOS
              <span className="text-xs text-gray-400 dark:text-gray-500">Apple Silicon</span>
            </a>
            <a
              href={DOWNLOAD_LINUX}
              className="inline-flex items-center justify-center gap-2 px-7 py-4 bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded-xl transition-colors shadow-lg border border-gray-200 dark:border-gray-600"
            >
              <Laptop className="w-5 h-5" /> Linux
              <span className="text-xs text-gray-400 dark:text-gray-500">AppImage</span>
            </a>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
            Intel Mac？下載{' '}
            <a href={DOWNLOAD_MAC_INTEL} className="text-emerald-600 dark:text-emerald-400 hover:underline">x64 版（SpeakSlow-x64.dmg）</a>
          </p>

          {/* 信任徽章列 */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400 mb-8">
            <span>🔒 100% 本地辨識</span>
            <span>·</span>
            <span>免費無限量</span>
            <span>·</span>
            <span>Apache 2.0 開源</span>
            <span>·</span>
            <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
              <Star className="w-3.5 h-3.5" />
              {stars != null ? `${stars.toLocaleString()} stars` : 'GitHub'}
            </a>
          </div>

          {/* Demo 影片：看它動起來 */}
          <div className="mb-4">
            <video
              src="demo.mp4"
              autoPlay
              muted
              loop
              playsInline
              controls
              className="mx-auto rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl"
            />
          </div>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-2">
            ↑ 30 秒實測：講完即貼，全程本機
          </p>
        </div>
      </section>

      {/* ===== 場景 ===== */}
      <section className="container mx-auto px-4 py-10">
        <h2 className="text-2xl md:text-3xl font-bold text-center text-gray-900 dark:text-white mb-8">
          你會在哪裡用它？
        </h2>
        <div className="grid md:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {SCENARIOS.map((s) => (
            <div key={s.title} className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <s.icon className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">{s.tag}</span>
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-2">{s.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== 功能四支柱 ===== */}
      <section className="container mx-auto px-4 py-10">
        <h2 className="text-2xl md:text-3xl font-bold text-center text-gray-900 dark:text-white mb-2">
          為什麼選聲聲慢？
        </h2>
        <p className="text-center text-gray-500 dark:text-gray-400 mb-8">
          寧願少，但要好。每一項都是實測，不是行銷話術。
        </p>
        <div className="grid sm:grid-cols-2 gap-4 max-w-4xl mx-auto">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
              <f.icon className="w-7 h-7 text-emerald-600 dark:text-emerald-400 mb-3" />
              <h3 className="font-bold text-gray-900 dark:text-white mb-2">{f.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== 比較表 teaser ===== */}
      <section className="container mx-auto px-4 py-10">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-center text-gray-900 dark:text-white mb-8">
            跟其他工具差在哪？
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto mb-4">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 text-left">
                  <th className="px-4 py-3"></th>
                  <th className="px-4 py-3 font-semibold text-emerald-700 dark:text-emerald-300">聲聲慢</th>
                  <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">雲端語音工具</th>
                  <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">Windows 內建</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {COMPARE_ROWS.map((r) => (
                  <tr key={r.k}>
                    <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">{r.k}</td>
                    <td className="px-4 py-3 text-emerald-700 dark:text-emerald-300 font-medium">{r.us}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.cloud}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.win}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-center">
            <Link to="/compare" className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium hover:underline">
              看完整誠實比較（含別人贏我們的地方）<ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ===== 底部 CTA ===== */}
      <section className="container mx-auto px-4 py-14">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-4">
            下載即用，模型內建
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            不用註冊、不用 API key、不用網路。裝完按右 Ctrl 就能講。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
            <a
              href={DOWNLOAD}
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors shadow-lg"
            >
              <Download className="w-5 h-5" /> 下載 Windows 版（免費）
            </a>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-gray-900 hover:bg-black text-white font-medium rounded-xl transition-colors shadow-lg"
            >
              <Github className="w-5 h-5" /> 在 GitHub 上 Star ⭐
            </a>
          </div>
          <div className="mb-4">
            <Link to="/guide" className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium hover:underline">
              <BookOpen className="w-4 h-4" /> 看完整使用教學
            </Link>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xl mx-auto leading-relaxed">
            🍎 Mac 第一次打開若顯示「已毀損」，<strong className="text-gray-500 dark:text-gray-400">不是檔案壞掉</strong>，
            是未簽章被系統擋。把 App 拖進「應用程式」後，終端機執行{' '}
            <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">xattr -cr /Applications/SpeakSlow.app</code>{' '}
            即可開啟。macOS / Linux 版為 beta，基本功能可用。
          </p>
        </div>
      </section>

      <footer className="border-t border-gray-200 dark:border-gray-700 py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500 dark:text-gray-400 mb-3">
            <Link to="/guide" className="hover:text-emerald-600 dark:hover:text-emerald-400">使用教學</Link>
            <Link to="/compare" className="hover:text-emerald-600 dark:hover:text-emerald-400">工具比較</Link>
            <Link to="/why" className="hover:text-emerald-600 dark:hover:text-emerald-400">為什麼免費</Link>
            <Link to="/story" className="hover:text-emerald-600 dark:hover:text-emerald-400">開發故事</Link>
            <a href={`${REPO}/issues`} target="_blank" rel="noreferrer" className="hover:text-emerald-600 dark:hover:text-emerald-400">回報問題</a>
          </div>
          <p className="text-center text-sm text-gray-400 dark:text-gray-500">
            聲聲慢 SpeakSlow · Apache 2.0 ·{' '}
            <a href={REPO} target="_blank" rel="noreferrer" className="hover:underline">GitHub</a>
          </p>
        </div>
      </footer>
    </div>
  )
}
