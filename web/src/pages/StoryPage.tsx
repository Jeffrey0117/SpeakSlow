import Nav from '../components/Nav'
import SiteFooter from '../components/SiteFooter'

export default function StoryPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Nav />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">開發故事</h1>
        <p className="text-gray-600 dark:text-gray-300 mb-10">
          一個「打字太慢、講話很快」的人，把語音輸入磨到順手的過程。
        </p>

        {/* Demo 影片（30 秒實測） */}
        <div className="mb-12">
          <video
            src="/SpeakSlow/demo.mp4"
            autoPlay
            muted
            loop
            playsInline
            controls
            className="mx-auto rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 max-h-[480px]"
          />
        </div>

        {/* 作者實際使用數據 */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 text-center">我自己天天在用</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <img src="/SpeakSlow/usage-1.jpg" alt="累計 36,707 字、省下 17 小時 22 分" className="rounded-xl border border-gray-200 dark:border-gray-700 shadow" />
            <img src="/SpeakSlow/usage-2.jpg" alt="單日口述一萬八千字" className="rounded-xl border border-gray-200 dark:border-gray-700 shadow" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center mt-3">
            口述 3 小時，省下 17 小時打字。有一天講了一萬八千字，可以出書了，書名就叫《我說的》。
          </p>
        </div>

        <div className="space-y-10 text-gray-700 dark:text-gray-200 leading-relaxed">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">起點：站在開源的肩膀上</h2>
            <p>
              聲聲慢改自 <a className="text-emerald-600 hover:underline" href="https://github.com/yan5xu/ququ" target="_blank" rel="noreferrer">ququ</a>（蛐蛐）這個開源專案。
              原版用 FunASR + PyTorch，又大又吃資源；我們把引擎整個換成
              <a className="text-emerald-600 hover:underline" href="https://github.com/k2-fsa/sherpa-onnx" target="_blank" rel="noreferrer"> sherpa-onnx</a>，快 10 倍以上、記憶體省 75%，普通筆電也跑得動。然後為台灣使用情境重做了輸出：台灣標準字（「吃」不是「喫」）、語助詞標點（嗎→？啊→！）、去口吃贅字。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">一個意外的發現：停頓會說話</h2>
            <p className="mb-3">
              做著做著發現，辨識引擎會回傳<strong>每個字的時間戳</strong>。連續講話時字距約 0.18 秒，
              而你換氣、思考的停頓是 0.5～2.7 秒，差了一個數量級，清清楚楚。
            </p>
            <p>
              於是「停頓自動斷行」誕生了：你講話自然停頓的地方，文字就自動換行。
              不用 AI、不用雲端，純粹是把人類本來就有的韻律翻譯成排版。
              這個功能雲端工具做不到，因為時間戳在你的電腦裡，不在他們的伺服器上。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">速度的執念：邊錄邊算</h2>
            <p className="mb-3">
              短句講完 0.3 秒出字，但長講一分鐘要等快 2 秒，不能忍。
              解法是<strong>邊錄邊算</strong>：你還在講的時候，已經講完的句子就在背景先辨識掉了，
              按停止時只剩最後一兩秒要算。
            </p>
            <p>
              實測 101 秒的長講：停止後等待從 <strong>1934ms 降到 236ms，快 8.2 倍</strong>，
              而且文字一字不差（同一顆模型、同一套切段，精度零損失）。
              現在不管講多長，停止後都幾乎秒出。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">為什麼堅持全本地</h2>
            <p>
              市面上的語音輸入幾乎都把你的聲音送上雲端，因為雲端模型大、效果好管理也容易。
              但我們想要的是：<strong>跟 AI 對話前的最後一哩路，不應該再經過另一朵雲</strong>。
              你跟 ChatGPT 講的話、你的工作筆記、你罵老闆的草稿，憑什麼先給語音服務商聽一遍？
              全本地的代價是模型小一點、安裝檔大一點，我們認為值得。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">接下來</h2>
            <ul className="space-y-2">
              <li>• 串流模式：字邊講邊出現（評估中，精度不能妥協）</li>
              <li>• 韻律標點：用音量/音高判斷「？」和「！」</li>
              <li>• 你的想法：<a className="text-emerald-600 hover:underline" href="https://github.com/Jeffrey0117/SpeakSlow/issues" target="_blank" rel="noreferrer">開個 issue 聊聊</a></li>
            </ul>
          </section>
        </div>

        <div className="text-center mt-12">
          <a
            href="https://github.com/Jeffrey0117/SpeakSlow/releases/latest/download/SpeakSlow-Setup.exe"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors shadow-lg"
          >
            下載試試（免費）
          </a>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
