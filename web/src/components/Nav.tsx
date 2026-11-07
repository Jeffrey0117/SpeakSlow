import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const LINKS = [
  { to: '/', label: '首頁' },
  { to: '/guide', label: '使用教學' },
  { to: '/why', label: '為什麼免費' },
  { to: '/compare', label: '工具比較' },
  { to: '/story', label: '開發故事' },
  { to: '/changelog', label: '更新紀錄' },
  { to: '/leaderboard', label: '排行榜' },
]

// 一鍵直接下載最新版 exe（不丟到 Releases 頁讓人猜要點哪個檔）
const RELEASES = 'https://github.com/Jeffrey0117/SpeakSlow/releases/latest/download/SpeakSlow-Setup.exe'

export default function Nav() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  const linkClass = (to: string) =>
    `px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
      pathname === to
        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-medium'
        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
    }`

  return (
    <nav className="sticky top-0 z-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-700">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          to="/"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 font-bold text-gray-900 dark:text-white whitespace-nowrap"
        >
          <img src="/SpeakSlow/favicon.png" alt="" className="w-7 h-7 rounded-lg" />
          聲聲慢
        </Link>

        {/* 桌面：橫排連結 */}
        <div className="hidden md:flex items-center gap-1 text-sm">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className={linkClass(l.to)}>
              {l.label}
            </Link>
          ))}
          <a
            href={RELEASES}
            target="_blank"
            rel="noreferrer"
            className="ml-2 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium whitespace-nowrap transition-colors"
          >
            開始下載
          </a>
        </div>

        {/* 手機：下載鈕 + 漢堡 */}
        <div className="flex md:hidden items-center gap-2">
          <a
            href={RELEASES}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium whitespace-nowrap transition-colors"
          >
            下載
          </a>
          <button
            type="button"
            aria-label="選單"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="p-2 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {open ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* 手機：下拉選單 */}
      {open && (
        <div className="md:hidden border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <div className="container mx-auto px-4 py-2 flex flex-col gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={
                  `px-3 py-2.5 rounded-lg text-base ${
                    pathname === l.to
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-medium'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`
                }
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  )
}
