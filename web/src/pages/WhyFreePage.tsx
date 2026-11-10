import Nav from '../components/Nav'
import SiteFooter from '../components/SiteFooter'

export default function WhyFreePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Nav />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
          為什麼可以完全免費？
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-10">
          不是行銷話術，是<strong>架構事實</strong>：辨識跑在你自己的電腦上，我們沒有任何伺服器成本，所以也沒有理由跟你收錢。
        </p>

        {/* 成本表 */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden mb-10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-left">
                <th className="px-5 py-3 font-semibold text-gray-700 dark:text-gray-200">項目</th>
                <th className="px-5 py-3 font-semibold text-gray-700 dark:text-gray-200">你的成本</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              <tr>
                <td className="px-5 py-4 text-gray-700 dark:text-gray-200">語音辨識（講幾十萬字也一樣）</td>
                <td className="px-5 py-4"><strong className="text-emerald-600 dark:text-emerald-400">$0</strong>
                  <span className="text-gray-500 dark:text-gray-400">，模型跑你自己的 CPU，唯一成本是電費的零頭</span></td>
              </tr>
              <tr>
                <td className="px-5 py-4 text-gray-700 dark:text-gray-200">聲音上傳</td>
                <td className="px-5 py-4"><strong className="text-emerald-600 dark:text-emerald-400">無</strong>
                  <span className="text-gray-500 dark:text-gray-400">，一個 byte 都不出門，沒有流量費、也沒有隱私帳</span></td>
              </tr>
              <tr>
                <td className="px-5 py-4 text-gray-700 dark:text-gray-200">額度 / 訂閱</td>
                <td className="px-5 py-4"><strong className="text-emerald-600 dark:text-emerald-400">無</strong>
                  <span className="text-gray-500 dark:text-gray-400">，沒有「本月剩 X 分鐘」，講到天荒地老</span></td>
              </tr>
              <tr>
                <td className="px-5 py-4 text-gray-700 dark:text-gray-200">AI 潤飾（可選、預設關閉）</td>
                <td className="px-5 py-4"><span className="text-gray-700 dark:text-gray-200">接你自己的 DeepSeek / Gemini key（月花約一杯飲料錢），或本地 Ollama 全免費</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">雲端工具為什麼免費不起來？</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
          大部分語音輸入工具的辨識是在<strong>雲端伺服器</strong>上跑的，你講的每一個字，對它們來說都是 GPU 運算成本。所以它們只能：收訂閱費、限制額度、或要你自備 API key。
          這不是它們小氣，是架構決定的。
        </p>
        <p className="text-gray-600 dark:text-gray-300 mb-10 leading-relaxed">
          聲聲慢選了另一條路：把模型直接裝進你的電腦（安裝檔裡已內建，約 600MB）。
          裝完之後，<strong>辨識的邊際成本是零</strong>，對你是零，對我們也是零。
          所以「免費、無限量」不是促銷，是這個架構唯一合理的訂價。
        </p>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">那作者圖什麼？</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-10 leading-relaxed">
          這是開源專案（Apache 2.0），改自同樣開源的 <a className="text-emerald-600 hover:underline" href="https://github.com/yan5xu/ququ" target="_blank" rel="noreferrer">ququ</a>。
          安裝檔放 GitHub Releases、官網放 GitHub Pages，全部免費託管，使用者再多也不會有帳單。
          好用的話，到 <a className="text-emerald-600 hover:underline" href="https://github.com/Jeffrey0117/SpeakSlow" target="_blank" rel="noreferrer">GitHub 給顆星星 ⭐</a> 就是最好的回報。
        </p>

        <div className="text-center">
          <a
            href="https://github.com/Jeffrey0117/SpeakSlow/releases/latest/download/SpeakSlow-Setup.exe"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors shadow-lg"
          >
            免費下載 Windows 版
          </a>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
