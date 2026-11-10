import { useEffect, useState } from 'react'
import { Download, RefreshCw, ExternalLink } from 'lucide-react'
import Nav from '../components/Nav'
import SiteFooter from '../components/SiteFooter'
import { renderReleaseNotes } from '../utils/renderReleaseNotes'

const REPO = 'https://github.com/Jeffrey0117/SpeakSlow'
const API = 'https://api.github.com/repos/Jeffrey0117/SpeakSlow/releases?per_page=20'

type Release = {
  tag_name: string
  name: string
  body: string
  published_at: string
  html_url: string
  prerelease: boolean
  draft: boolean
}

function formatDate(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

export default function ChangelogPage() {
  const [releases, setReleases] = useState<Release[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch(API)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Release[]) => setReleases(data.filter((r) => !r.draft)))
      .catch(() => setError(true))
  }, [])

  const latest = releases?.[0]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Nav />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
          更新紀錄
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-8">
          每次改了什麼都寫在這裡。
          <strong className="text-gray-900 dark:text-white">Windows 版從 v1.0.24 起會自動更新</strong>
          ，裝過一次之後就不用再回來下載了。
        </p>

        {/* 目前最新版 + 下載 */}
        {latest && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-emerald-200 dark:border-emerald-800 p-5 mb-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400">目前最新版</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {latest.tag_name}
                  <span className="ml-2 text-sm font-normal text-gray-400 dark:text-gray-500">
                    {formatDate(latest.published_at)}
                  </span>
                </div>
              </div>
              <a
                href={`${REPO}/releases/latest/download/SpeakSlow-Setup.exe`}
                className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors"
              >
                <Download className="w-4 h-4" /> 下載 Windows 版
              </a>
            </div>
          </div>
        )}

        {/* 載入中 */}
        {!releases && !error && (
          <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
            <RefreshCw className="w-4 h-4 animate-spin" /> 載入更新紀錄中…
          </div>
        )}

        {/* 失敗退路：GitHub API 有流量限制，擋住時直接給連結 */}
        {error && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
            <p className="text-gray-600 dark:text-gray-300 mb-3">
              載入不到更新紀錄（GitHub API 可能暫時限流）。
            </p>
            <a
              href={`${REPO}/releases`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium hover:underline"
            >
              直接到 GitHub 看 <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        )}

        {/* 版本列表 */}
        <div className="space-y-8">
          {releases?.map((r) => (
            <article
              key={r.tag_name}
              className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6"
            >
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{r.tag_name}</h2>
                <span className="text-sm text-gray-400 dark:text-gray-500">
                  {formatDate(r.published_at)}
                </span>
                {r.prerelease && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                    預覽版
                  </span>
                )}
                <a
                  href={r.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-sm text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400"
                >
                  在 GitHub 開啟
                </a>
              </header>
              <div
                className="release-notes text-sm text-gray-700 dark:text-gray-200 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderReleaseNotes(r.body || '') }}
              />
            </article>
          ))}
        </div>

        <p className="mt-10 text-sm text-gray-400 dark:text-gray-500">
          更久以前的版本請看{' '}
          <a href={`${REPO}/releases`} target="_blank" rel="noreferrer" className="hover:underline">
            GitHub Releases
          </a>
          。
        </p>
      </div>
      <SiteFooter />
    </div>
  )
}
