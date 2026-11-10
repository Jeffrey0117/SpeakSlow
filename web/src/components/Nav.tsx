import { Link } from 'react-router-dom'

const REPO = 'https://github.com/Jeffrey0117/SpeakSlow'

// 一鍵直接下載最新版 exe（不丟到 Releases 頁讓人猜要點哪個檔）
const RELEASES = 'https://github.com/Jeffrey0117/SpeakSlow/releases/latest/download/SpeakSlow-Setup.exe'

// 頂部只放兩件真正有用的事：GitHub、下載。各頁面入口在 SiteFooter。
export default function Nav() {
  return (
    <nav className="sticky top-0 z-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-700">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-gray-900 dark:text-white whitespace-nowrap">
          <img src="/SpeakSlow/favicon.png" alt="" className="w-7 h-7 rounded-lg" />
          聲聲慢
        </Link>

        <div className="flex items-center gap-2 text-sm">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium whitespace-nowrap transition-colors"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
            </svg>
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <a
            href={RELEASES}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium whitespace-nowrap transition-colors"
          >
            下載
          </a>
        </div>
      </div>
    </nav>
  )
}
