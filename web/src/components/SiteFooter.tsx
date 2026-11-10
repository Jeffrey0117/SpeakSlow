import { Link } from 'react-router-dom'

const REPO = 'https://github.com/Jeffrey0117/SpeakSlow'

// 全站共用頁尾：頂部導覽只留 GitHub + 下載，各頁面入口統一放這裡
const LINKS = [
  { to: '/guide', label: '使用教學' },
  { to: '/compare', label: '工具比較' },
  { to: '/changelog', label: '更新紀錄' },
  { to: '/leaderboard', label: '排行榜' },
  { to: '/why', label: '為什麼免費' },
  { to: '/story', label: '開發故事' },
]

export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-700 py-8">
      <div className="container mx-auto px-4">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500 dark:text-gray-400 mb-3">
          <Link to="/" className="hover:text-emerald-600 dark:hover:text-emerald-400">首頁</Link>
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="hover:text-emerald-600 dark:hover:text-emerald-400">
              {l.label}
            </Link>
          ))}
          <a href={`${REPO}/issues`} target="_blank" rel="noreferrer" className="hover:text-emerald-600 dark:hover:text-emerald-400">
            回報問題
          </a>
        </div>
        <p className="text-center text-sm text-gray-400 dark:text-gray-500">
          聲聲慢 SpeakSlow · Apache 2.0 ·{' '}
          <a href={REPO} target="_blank" rel="noreferrer" className="hover:underline">GitHub</a>
        </p>
      </div>
    </footer>
  )
}
