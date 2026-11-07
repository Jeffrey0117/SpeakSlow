import type { ReactNode } from 'react'

// 教學頁用的 UI 示意圖：用 HTML/CSS 重現 app 的畫面，而不是放截圖。
// 截圖會連同桌面上的其他視窗一起入鏡（隱私風險），而且螢幕解析度一換就糊、
// 介面一改就過時。重現版永遠清晰、跟著深色模式走、也不會洩漏任何東西。

/** 鍵帽 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-2 py-1 rounded-md bg-white dark:bg-gray-200 text-gray-800 text-xs font-semibold border-b-2 border-gray-300 dark:border-gray-400 whitespace-nowrap">
      {children}
    </kbd>
  )
}

/** 一組按鍵：Ctrl + Shift + E */
export function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-gray-400 text-xs">+</span>}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  )
}

/** 示意圖外框：深色底 + 說明標籤，一眼看出這是 app 畫面而不是網頁本身 */
export function MockFrame({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="my-5">
      <div className="rounded-2xl bg-gray-900 dark:bg-gray-950 border border-gray-700 p-6 flex items-center justify-center overflow-x-auto">
        {children}
      </div>
      <figcaption className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
        {caption}
      </figcaption>
    </figure>
  )
}

/** 錄音膠囊（含音量條） */
export function PillMock({ level = 0.6, recording = true }: { level?: number; recording?: boolean }) {
  const shape = [0.55, 0.8, 1, 0.8, 0.55]
  return (
    <div
      className={`rounded-full px-5 py-2 flex items-center gap-2.5 ${
        recording ? 'bg-red-500 border border-red-400/60' : 'bg-sky-400 border border-sky-300/60'
      }`}
    >
      <div className="w-3 h-3 bg-white rounded-full" />
      <span className="text-white font-semibold text-[15px] whitespace-nowrap">
        {recording ? '錄音中...' : '聽指令'}
      </span>
      <div className="flex items-center gap-0.5 h-5">
        {shape.map((s, i) => (
          <div
            key={i}
            className="w-1 rounded-full bg-white/85"
            style={{ height: `${4 + 16 * level * s}px` }}
          />
        ))}
      </div>
    </div>
  )
}

/** 快速修改卡 */
export function EditCardMock({ text, selected }: { text: string; selected?: string }) {
  const parts = selected && text.includes(selected) ? text.split(selected) : null
  return (
    <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">修改上一句</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
          選取後重講即覆蓋
        </span>
      </div>
      <div className="mx-4 my-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-xl text-gray-900 dark:text-white leading-relaxed">
        {parts ? (
          <>
            {parts[0]}
            <span className="bg-blue-500/30 rounded px-0.5">{selected}</span>
            {parts[1]}
          </>
        ) : (
          text
        )}
      </div>
      <div className="flex items-center justify-between px-4 pb-3 pt-1">
        <span className="text-[10px] text-gray-400">Enter 取代原文 · Esc 取消</span>
        <span className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white">
          取代原文 (Enter)
        </span>
      </div>
    </div>
  )
}

/** 迷你浮窗 */
export function MiniPillMock({ status, sub }: { status: string; sub: string }) {
  return (
    <div className="w-[300px] rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-lg">🎙</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-gray-900 dark:text-white leading-tight">{status}</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight mt-0.5 truncate">{sub}</div>
      </div>
      <div className="flex items-center gap-1 text-gray-400 text-xs shrink-0">
        <span>📋</span><span>⚙️</span><span>⤢</span>
      </div>
    </div>
  )
}
