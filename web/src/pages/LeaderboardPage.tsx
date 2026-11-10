import { useEffect, useState } from 'react'
import { Trophy, CalendarDays, Type, RefreshCw, ShieldCheck } from 'lucide-react'
import Nav from '../components/Nav'
import SiteFooter from '../components/SiteFooter'

// 統計服務（只存計數，不存逐字稿內容）。尚未部署時整頁會顯示「即將推出」而不是報錯。
const API = 'https://speakslow-stats.isnowfriend.com'

type Entry = {
  rank: number
  name: string
  totalChars: number
  totalSessions: number
  totalSeconds: number
  activeDays: number
}

const BOARDS = [
  { key: 'totalChars', label: '總字數', icon: Type, unit: '字' },
  { key: 'activeDays', label: '使用天數', icon: CalendarDays, unit: '天' },
] as const

function fmt(n: number) {
  return (n ?? 0).toLocaleString('zh-TW')
}

function medal(rank: number) {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return null
}

export default function LeaderboardPage() {
  const [by, setBy] = useState<(typeof BOARDS)[number]['key']>('totalChars')
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [summary, setSummary] = useState<{ users: number; totalChars: number } | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    setEntries(null)
    fetch(`${API}/api/leaderboard?by=${by}&limit=50`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setEntries(d.entries || []))
      .catch(() => setUnavailable(true))
  }, [by])

  useEffect(() => {
    fetch(`${API}/api/summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setSummary(d) })
      .catch(() => {})
  }, [])

  const active = BOARDS.find((b) => b.key === by)!

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Nav />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Trophy className="w-8 h-8 text-amber-500" /> 排行榜
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          看看大家用嘴巴打了多少字。
        </p>

        {/* 總量 */}
        {summary && (
          <div className="grid grid-cols-2 gap-3 mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 text-center">
              <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{fmt(summary.users)}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">位使用者</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 text-center">
              <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{fmt(summary.totalChars)}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">累計聽寫字數</div>
            </div>
          </div>
        )}

        {/* 服務還沒上線時的說明，不要變成一片空白或錯誤 */}
        {unavailable ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center">
            <Trophy className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <h2 className="font-bold text-gray-900 dark:text-white mb-2">排行榜即將推出</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              統計功能還在部署中。上線後，在聲聲慢裡登入並開啟統計就會出現在這裡。
            </p>
          </div>
        ) : (
          <>
            {/* 切換榜別 */}
            <div className="flex gap-2 mb-5">
              {BOARDS.map((b) => (
                <button
                  key={b.key}
                  onClick={() => setBy(b.key)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                    by === b.key
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <b.icon className="w-4 h-4" /> {b.label}
                </button>
              ))}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {!entries ? (
                <div className="p-8 flex items-center justify-center gap-2 text-gray-400">
                  <RefreshCw className="w-4 h-4 animate-spin" /> 載入中…
                </div>
              ) : entries.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                  還沒有人上榜——你可以是第一個。
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {entries.map((e) => (
                    <li key={`${e.rank}-${e.name}`} className="flex items-center gap-4 px-5 py-3">
                      <span className={`w-8 shrink-0 text-center font-bold ${
                        e.rank <= 3 ? 'text-lg' : 'text-sm text-gray-400'
                      }`}>
                        {medal(e.rank) || e.rank}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-gray-900 dark:text-white">{e.name}</span>
                      <span className="shrink-0 font-semibold text-emerald-600 dark:text-emerald-400">
                        {fmt(by === 'totalChars' ? e.totalChars : e.activeDays)}
                        <span className="ml-1 text-xs font-normal text-gray-400">{active.unit}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {/* 隱私說明：這頁最容易讓人誤會「你們是不是在收我講的話」 */}
        <div className="mt-8 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl p-5 border border-emerald-200 dark:border-emerald-800">
          <h2 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-2 text-sm">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> 上傳的只有數字
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            排行榜只收<strong>計數</strong>——字數、次數、時長、使用天數。
            你講的內容從來不會離開你的電腦，辨識也依然 100% 在本機完成。
            統計功能<strong>預設關閉</strong>，要在設定裡登入並明確開啟才會上傳；
            也可以選擇只計入總量、不出現在榜上。
          </p>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
