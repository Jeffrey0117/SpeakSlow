import Nav from '../components/Nav'
import SiteFooter from '../components/SiteFooter'

const ROWS = [
  { k: '辨識在哪裡跑', us: '你自己的電腦（本地）', sayit: '雲端（Groq / Gemini 等）', zerotype: '雲端（OpenAI / Gemini）', win: '雲端（微軟伺服器）' },
  { k: '需要 API key', us: '不用', sayit: '要（自備）', zerotype: '要（自備）', win: '不用' },
  { k: '費用', us: '免費、無限量', sayit: '依 API 用量計費', zerotype: '依 API 用量計費', win: '免費' },
  { k: '聲音會不會上傳', us: '不會（離線可用）', sayit: '會', zerotype: '會', win: '會' },
  { k: '繁體中文（台灣用字）', us: '◎ 台灣標準字、語助詞標點', zerotype: '◎ 針對台灣優化', sayit: '○ 繁中優化', win: '△' },
  { k: '講完到貼上', us: '短句 ~0.3 秒；長講邊錄邊算', sayit: '約 1~3 秒（網路）', zerotype: '依網路與 API', win: '即時（串流）' },
  { k: '開源', us: '◎ Apache 2.0', sayit: '◎ MIT', zerotype: '◎', win: '✕' },
]

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Nav />
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
          跟其他工具誠實比一比
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-10 max-w-3xl">
          這些都是很棒的工具（有幾個我們也很佩服），差別主要在<strong>架構選擇</strong>：辨識放雲端還是放本地。
          放雲端可以用最大的模型；放本地則換來免費、隱私跟斷網可用。看你在意什麼。
        </p>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto mb-8">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-left">
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200"></th>
                <th className="px-4 py-3 font-semibold text-emerald-700 dark:text-emerald-300">聲聲慢</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">SayIt（言）</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">ZeroType</th>
                <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">Windows 內建</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {ROWS.map((r) => (
                <tr key={r.k}>
                  <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">{r.k}</td>
                  <td className="px-4 py-3 text-emerald-700 dark:text-emerald-300 font-medium">{r.us}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.sayit ?? '·'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.zerotype ?? '·'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.win ?? '·'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-10">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-200 dark:border-gray-700">
            <h3 className="font-bold text-gray-900 dark:text-white mb-2">😊 別人比我們強的地方（誠實說）</h3>
            <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-2 leading-relaxed">
              <li>• <strong>雲端大模型的辨識上限更高</strong>：極端口音、嘈雜環境、罕見術語，GPT-4o / Gemini 級的模型還是比較會猜。</li>
              <li>• <strong>SayIt 的瀏海式錄音指示</strong>很漂亮；<strong>ZeroType 的自訂 prompt 系統</strong>彈性十足。都值得學。</li>
              <li>• <strong>Windows 內建是串流</strong>：字邊講邊出現，這個體感我們還在路上（規劃中）。</li>
              <li>• 我們目前 <strong>只支援 Windows</strong>，安裝檔較大（模型內建 ~600MB）。</li>
            </ul>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl p-5 border border-emerald-200 dark:border-emerald-800">
            <h3 className="font-bold text-gray-900 dark:text-white mb-2">💪 我們的不可替代</h3>
            <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-2 leading-relaxed">
              <li>• <strong>唯一全本地</strong>：上面這排工具裡，只有我們的聲音不離開你的電腦。</li>
              <li>• <strong>唯一真免費無限量</strong>：沒有 API 帳單，因為根本沒有 API。</li>
              <li>• <strong>免 AI 的乾淨輸出</strong>：標點、去口吃、列點、停頓斷行全是本地規則，別人這些要靠雲端 LLM。</li>
              <li>• <strong>長講邊錄邊算</strong>：講一分鐘，停止後 ~0.2 秒出字（實測快 8 倍）。</li>
            </ul>
          </div>
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500 mb-8">
          ＊以上比較基於各工具 2026 年中的公開資訊，若有出入歡迎開 issue 指正，我們樂意更新（包含把別人寫得更好）。
        </p>

        <div className="text-center">
          <a
            href="https://github.com/Jeffrey0117/SpeakSlow/releases/latest/download/SpeakSlow-Setup.exe"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors shadow-lg"
          >
            下載聲聲慢（免費）
          </a>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
