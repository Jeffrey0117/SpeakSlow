import type { ReactNode } from 'react'
import Nav from '../components/Nav'
import { KeyCombo, MockFrame, EditCardMock } from '../components/UiMock'

// 鍵帽
function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block px-2 py-0.5 mx-0.5 text-xs font-semibold rounded-md border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 align-middle">
      {children}
    </kbd>
  )
}

// 截圖預留位：之後把 src 換成真圖即可
function Shot({ label }: { label: string }) {
  return (
    <div className="my-4 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 px-4 py-8 text-center">
      <div className="text-2xl mb-1">📸</div>
      <div className="text-sm text-gray-500 dark:text-gray-400">截圖：{label}</div>
    </div>
  )
}

function Section({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 mb-12">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 flex items-baseline gap-2">
        <span className="text-emerald-500 text-lg">{n}</span>
        {title}
      </h2>
      <div className="text-gray-600 dark:text-gray-300 leading-relaxed space-y-3">{children}</div>
    </section>
  )
}

const TH = 'px-4 py-3 font-semibold text-gray-700 dark:text-gray-200 text-left'
const TD = 'px-4 py-3 text-gray-700 dark:text-gray-200 align-top'

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Nav />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-3">
          完整使用教學
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          從安裝到每一個進階功能，從頭到尾講一遍。所有辨識都跑在你自己的電腦上，免費、離線、不限量。
        </p>

        {/* 教學影片 */}
        <div className="aspect-video w-full rounded-2xl overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700 mb-10">
          <iframe
            className="w-full h-full"
            src="https://www.youtube.com/embed/06Hg55D-hfY"
            title="聲聲慢 SpeakSlow 使用教學"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>

        {/* 目錄 */}
        <nav className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 mb-12">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">目錄</div>
          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            {[
              ['install', '1. 安裝與系統需求'],
              ['record', '2. 開始錄音（兩個錄音鍵）'],
              ['shortcuts', '3. 全域快捷鍵總表'],
              ['clipboard', '3.6 取回剛講的話'],
              ['command', '4. 操作模式（語音下指令）'],
              ['emoji', '5. 語音表情符號'],
              ['correct', '6. 點字改錯（會學習的字典）'],
              ['transcribe', '7. 逐字稿 / 字幕 SRT'],
              ['ai', '8. AI 優化與你自己的 API'],
              ['settings', '9. 設定詳解'],
              ['mini', '10. 迷你模式'],
              ['history', '11. 歷史記錄與救回'],
              ['privacy', '12. 隱私'],
            ].map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="hover:underline">{label}</a>
              </li>
            ))}
          </ol>
        </nav>

        {/* 1 安裝 */}
        <Section id="install" n="01" title="安裝與系統需求">
          <p>
            到 <a className="text-emerald-600 hover:underline" href="https://github.com/Jeffrey0117/SpeakSlow/releases" target="_blank" rel="noreferrer">GitHub Releases</a> 下載最新的
            <strong> SpeakSlow-Setup.exe</strong>，執行後一路下一步即可。辨識模型已內建在安裝檔裡（約 600MB），裝完就能離線使用，不用另外下載。
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>系統：Windows 10 / 11（64 位元）</li>
            <li>硬體：一般文書筆電就夠，跑 CPU、不需要顯卡</li>
            <li>網路：辨識完全離線；只有「AI 優化」和「翻譯」這兩個選用功能才會連網</li>
          </ul>
          <Shot label="安裝完成後第一次打開的主面板樣子" />
        </Section>

        {/* 2 錄音 */}
        <Section id="record" n="02" title="開始錄音（為什麼有兩個錄音鍵）">
          <p>
            按一下 <Kbd>右 Alt</Kbd> 或 <Kbd>右 Ctrl</Kbd> 開始錄音，<strong>再按一下</strong>停止（單擊切換，不用一直按住）。
            停止後文字會自動辨識並<strong>貼到你游標所在的地方</strong>。
          </p>
          <p>
            為什麼有兩個鍵？因為在<strong>瀏覽器裡</strong>，放開右 Alt 有時會觸發瀏覽器的選單列，這時改用 <Kbd>右 Ctrl</Kbd> 比較順。
            其他軟體（Word、聊天視窗…）兩個都好用，挑順手的。
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>錄到一半講錯、想直接放棄：按 <Kbd>Esc</Kbd> 取消，這段不會被打出來</li>
            <li>也可以<strong>雙擊 <Kbd>F2</Kbd></strong> 開始 / 停止錄音</li>
            <li>講長一點沒關係，它會邊錄邊算，停下來幾乎馬上就出字</li>
          </ul>
          <Shot label="錄音中的指示器藥丸（紅點 + 聽寫中）" />
        </Section>

        {/* 3 快捷鍵 */}
        <Section id="shortcuts" n="03" title="全域快捷鍵總表">
          <p>這些在任何視窗都有效（全域）。除了錄音鍵固定之外，其餘可在「設定 → 快捷鍵」自己改。</p>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-gray-700/50"><th className={TH}>快捷鍵</th><th className={TH}>作用</th><th className={TH}>可改</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                <tr><td className={TD}><Kbd>右 Alt</Kbd> / <Kbd>右 Ctrl</Kbd></td><td className={TD}>開始 / 停止錄音（單擊切換）</td><td className={TD}>固定</td></tr>
                <tr><td className={TD}><Kbd>Esc</Kbd></td><td className={TD}>取消當次錄音（不打出來）</td><td className={TD}>固定</td></tr>
                <tr><td className={TD}>雙擊 <Kbd>F2</Kbd></td><td className={TD}>開始 / 停止錄音</td><td className={TD}>固定</td></tr>
                <tr><td className={TD}><Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>K</Kbd></td><td className={TD}>切換<strong>操作模式</strong>（語音下指令）</td><td className={TD}>可改</td></tr>
                <tr><td className={TD}><Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>C</Kbd></td><td className={TD}>複製上一次的辨識結果</td><td className={TD}>可改</td></tr>
                <tr><td className={TD}>連按兩下觸發鍵</td><td className={TD}><strong>取回剛講的那段話</strong>（再連按兩下換回你原本複製的東西）</td><td className={TD}>固定</td></tr>
                <tr><td className={TD}><Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>E</Kbd></td><td className={TD}><strong>修改上一句</strong>（講錯時叫出大字編輯卡）</td><td className={TD}>可改</td></tr>
                <tr><td className={TD}><Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Q</Kbd></td><td className={TD}>顯示 / 隱藏主視窗</td><td className={TD}>可改</td></tr>
                <tr><td className={TD}><Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>H</Kbd></td><td className={TD}>叫出<strong>快捷鍵速查表</strong>（忘記時按這個）</td><td className={TD}>可改</td></tr>
              </tbody>
            </table>
          </div>
          <Shot label="設定 → 快捷鍵 分頁（顯示哪些可改、哪些固定）" />
        </Section>

        {/* 3.5 快速修改 */}
        <Section id="quickedit" n="03.5" title="講錯了？一鍵修正上一句">
          <p>
            辨識偶爾會聽錯，尤其是同音字。以前只能貼出去之後再用鍵盤改，現在按
            <KeyCombo keys={['Ctrl', 'Shift', 'E']} /> 就會跳出一張<strong>大字編輯卡</strong>，裡面是你剛講的那句。
          </p>
          <MockFrame caption="按 Ctrl+Shift+E 後跳出的編輯卡（字級會依字數自動放大）">
            <EditCardMock text="幫我修一下這個貨單" selected="貨單" />
          </MockFrame>
          <p>選起要改的字之後，有三條路：</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>用講的覆蓋</strong>：選取後按錄音鍵重講那幾個字，直接取代（不用碰鍵盤）</li>
            <li><strong>用打的改</strong>：卡片本身就是輸入框</li>
            <li><strong>補內容</strong>：不選取，把游標點到想插入的位置再講</li>
          </ul>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden mt-3">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-gray-700/50"><th className={TH}>按鍵</th><th className={TH}>作用</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                <tr><td className={TD}><Kbd>Enter</Kbd></td><td className={TD}>取代原文——自動撤銷剛才貼出去的，再貼修正版</td></tr>
                <tr><td className={TD}><Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd></td><td className={TD}>只貼上、不撤銷（原文已經送出時用這個）</td></tr>
                <tr><td className={TD}><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd></td><td className={TD}>卡片內換行</td></tr>
                <tr><td className={TD}><Kbd>Esc</Kbd></td><td className={TD}>放棄，什麼都不貼</td></tr>
              </tbody>
            </table>
          </div>

          <h3 className="font-bold text-gray-800 dark:text-gray-100 pt-4">同音字講不清楚？用拆字的</h3>
          <p>
            「ㄅㄟˇㄌㄢˋ」到底是哪兩個字，用講的講不明白。在編輯卡裡選取之後，可以用大家習慣的拆字說法指定：
          </p>
          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800 text-sm">
            <p className="text-gray-700 dark:text-gray-200">
              說「<strong>北方的北，爛掉的爛</strong>」 → 填入 <strong>北爛</strong>
            </p>
            <p className="text-gray-500 dark:text-gray-400 mt-1.5 text-xs">
              也支援單字（「爛掉的爛」→ 爛）。只在編輯卡內生效，平常講話完全不受影響——
              規則要求指定的字必須出現在提示詞裡，所以「我去台灣的台北」不會被誤拆。
            </p>
          </div>

          <h3 className="font-bold text-gray-800 dark:text-gray-100 pt-4">想每句都先檢查？</h3>
          <p>
            設定 → 錄音完成後動作 → 開啟<strong>「貼上前先確認」</strong>，之後每句講完都會先經過這張卡片，
            按 Enter 才貼出去。適合寫正式文件時整篇逐句校對；平常建議關著，用熱鍵隨機應變就好。
          </p>
        </Section>

        {/* 3.6 剪貼簿切換 */}
        <Section id="clipboard" n="03.6" title="想再貼一次剛講的話？連按兩下">
          <p>
            聽寫貼上的時候，聲聲慢會<strong>先把你原本複製的東西存起來</strong>，貼完再還原回去——
            所以你複製的網址、帳號不會被聽寫的文字吃掉。
          </p>
          <p>
            代價是剛講的那段話貼完就從剪貼簿消失了。要是你想把它再貼到第二個地方，
            <strong>連按兩下觸發鍵</strong>（預設右 Ctrl / 右 Alt）就能把它叫回剪貼簿；
            <strong>再連按兩下</strong>就換回你原本複製的東西。來回切換，按錯也切得回來。
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>不用進設定，也不會多一個視窗或按鈕——不用的時候完全不存在</li>
            <li>切換時錄音膠囊的位置會閃一下告訴你現在是哪一份，1.5 秒後自己消失</li>
            <li>如果你在聽寫之後又複製了別的東西，切換<strong>不會</strong>把那份弄丟</li>
          </ul>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            另外還有 <KeyCombo keys={['Ctrl', 'Shift', 'C']} /> 可以直接複製上次結果；
            按完若想拿回原本的剪貼簿，同樣連按兩下觸發鍵就行。
          </p>
        </Section>

        {/* 3.8 速查表 */}
        <Section id="cheatsheet" n="03.8" title="忘記快捷鍵？叫出速查表">
          <p>
            快捷鍵本來就是會忘的東西。按 <KeyCombo keys={['Ctrl', 'Shift', 'H']} /> 隨時叫出速查表，
            上面顯示的是<strong>你自己設定的按鍵</strong>，不是寫死的預設值。
          </p>
          <p>三個入口都可以：</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>按 <KeyCombo keys={['Ctrl', 'Shift', 'H']} />（再按一次關閉）</li>
            <li>右下角托盤圖示 → 快捷鍵速查</li>
            <li><strong>用講的</strong>：在操作模式下說「操作表」「指令表」「有哪些指令」「幫助」</li>
          </ul>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            另外，第一次開啟聲聲慢會跑一段新手教學，帶你實際按過每個快捷鍵。
            想重看：設定 → 視窗控制 → 重看新手教學。
          </p>
        </Section>

        {/* 4 操作模式 */}
        <Section id="command" n="04" title="操作模式：選取文字，用講的下指令">
          <p>
            這是聲聲慢最強的功能。按 <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>K</Kbd> 開啟操作模式（面板會出現淺藍色「操作模式」標籤）。
            開啟後，你講的話<strong>不會被打出來</strong>，而是被當成「指令」去處理你<strong>選取（反白）的文字</strong>。
          </p>
          <p className="text-sm bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3">
            用法：<strong>先反白一段文字 → 按 Ctrl+Shift+K 進操作模式 → 按右 Ctrl 講指令</strong>。做完記得再按 Ctrl+Shift+K 關掉，回到正常聽寫。
          </p>

          <h3 className="font-bold text-gray-800 dark:text-gray-100 pt-2">文字轉換</h3>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-gray-700/50"><th className={TH}>你說</th><th className={TH}>它做什麼</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                <tr><td className={TD}>轉成繁體 / 轉成簡體</td><td className={TD}>簡繁互轉（本地 opencc，免費、瞬間）</td></tr>
                <tr><td className={TD}>翻成英文 / 翻成日文</td><td className={TD}>翻譯（免費 Google 翻譯，不燒你的 AI 額度）</td></tr>
                <tr><td className={TD}>翻譯成繁體中文 / 簡體中文</td><td className={TD}>翻成中文（繁或簡）</td></tr>
                <tr><td className={TD}>翻譯（不指定語言）</td><td className={TD}>自動判斷選取是中還是英，翻成另一個</td></tr>
              </tbody>
            </table>
          </div>

          <h3 className="font-bold text-gray-800 dark:text-gray-100 pt-2">AI 動作（用你自己的 AI）</h3>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-gray-700/50"><th className={TH}>你說</th><th className={TH}>它做什麼</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                <tr><td className={TD}>潤稿（潤飾 / 修順 / 校對）</td><td className={TD}>把選取的文字潤飾通順</td></tr>
                <tr><td className={TD}>總結（摘要 / 重點整理）</td><td className={TD}>整理成重點</td></tr>
                <tr><td className={TD}>寫成文案（社群貼文 / 行銷文）</td><td className={TD}>改寫成文案</td></tr>
                <tr><td className={TD}><strong>任意一句話</strong></td><td className={TD}>沒對到固定指令時，你整句話就是給 AI 的指示（例如「幫我把這段改得更正式」）</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            AI 輸出一律自動轉成繁體。這部分會用到你在設定填的 AI（見第 8 段），用本地 Ollama 就完全免費。
          </p>

          <h3 className="font-bold text-gray-800 dark:text-gray-100 pt-2">朗讀 / 筆記</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>念出來</strong>（唸出來 / 讀出來 / 朗讀）：把選取的文字念給你聽</li>
            <li><strong>記下來</strong>（記一下 / 存筆記 / 做筆記）：把選取的文字附加到筆記檔（speakslow-notes.md）</li>
          </ul>

          <h3 className="font-bold text-gray-800 dark:text-gray-100 pt-2">鍵盤指令（免費、瞬間）</h3>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-gray-700/50"><th className={TH}>你說</th><th className={TH}>等於按</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                <tr><td className={TD}>全選（全部選取 / 選全部）</td><td className={TD}><Kbd>Ctrl</Kbd>+<Kbd>A</Kbd></td></tr>
                <tr><td className={TD}>複製（拷貝）</td><td className={TD}><Kbd>Ctrl</Kbd>+<Kbd>C</Kbd></td></tr>
                <tr><td className={TD}>貼上</td><td className={TD}><Kbd>Ctrl</Kbd>+<Kbd>V</Kbd></td></tr>
                <tr><td className={TD}>送出（傳送 / 換行）</td><td className={TD}><Kbd>Enter</Kbd></td></tr>
                <tr><td className={TD}>全部清除（全部刪除 / 清空）</td><td className={TD}><Kbd>Ctrl</Kbd>+<Kbd>A</Kbd> 再刪除</td></tr>
              </tbody>
            </table>
          </div>

          <h3 className="font-bold text-gray-800 dark:text-gray-100 pt-2">把指令串起來</h3>
          <p>
            一句話可以串好幾個動作，用「<strong>然後 / 接著 / 再來 / 之後</strong>」連起來，它會照順序做。例如：
          </p>
          <p className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3 font-mono text-sm">「全選，翻成英文，然後複製」</p>
          <p>→ 它會幫你全選、翻成英文、再複製到剪貼簿。</p>

          <h3 className="font-bold text-gray-800 dark:text-gray-100 pt-2">兩個保命設計</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>鬼切</strong>：在操作模式錄音中途想「關掉操作模式」，這段不會被丟掉，會直接當成正常聽寫打出來</li>
            <li><strong>Esc</strong>：操作模式下講到一半發現講錯，按 Esc 取消這次指令</li>
          </ul>
          <Shot label="操作模式：反白一段英文 → 講「翻譯成繁體中文」→ 變成中文的前後對照" />
        </Section>

        {/* 5 emoji */}
        <Section id="emoji" n="05" title="語音表情符號">
          <p>
            正常聽寫時，講「<strong>名稱 + 表情 / 符號</strong>」就會插入對應的 emoji。一定要帶「表情」或「符號」後綴，這樣才不會把「火焰」這種正常詞也換掉。
          </p>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-gray-700/50"><th className={TH}>你說</th><th className={TH}>會變成</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                <tr><td className={TD}>火焰表情</td><td className={TD}>🔥</td></tr>
                <tr><td className={TD}>大笑表情 / 笑死表情</td><td className={TD}>🤣</td></tr>
                <tr><td className={TD}>愛心符號</td><td className={TD}>❤️</td></tr>
                <tr><td className={TD}>讚表情</td><td className={TD}>👍</td></tr>
                <tr><td className={TD}>派對表情 / 灑花</td><td className={TD}>🎉</td></tr>
                <tr><td className={TD}>一百分表情</td><td className={TD}>💯</td></tr>
                <tr><td className={TD}>火箭表情</td><td className={TD}>🚀</td></tr>
                <tr><td className={TD}>拜託 / 祈禱符號</td><td className={TD}>🙏</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            內建約 150 個。就算標點模型在中間加了句號（例如「派對。表情。」）或把「表」聽成「錶」，也都吃得下。
          </p>
        </Section>

        {/* 6 改錯 */}
        <Section id="correct" n="06" title="點字改錯：會學習的輸入法">
          <p>
            辨識結果出現錯字時，在結果面板裡<strong>反白那個字</strong>，會跳出一個小選單：
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>幾個 <strong>AI 候選字</strong>讓你直接點選替換</li>
            <li>或自己打正確的字（下方輸入框，按 Enter 套用）</li>
          </ul>
          <p>
            重點是它<strong>會記住</strong>：只要你改的是 2 個字以上的詞，就會存進你的字典，<strong>下次辨識自動幫你修</strong>，越用越準。
            （單一個字像「在 / 再」太容易誤判，只換不記。）
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            字典可以在「設定 → 字典管理」手動增減。另外還有「熱詞」功能，是在辨識前就把專有名詞餵給模型，兩者可搭配用。
          </p>
          <Shot label="反白一個錯字 → 跳出 AI 候選 + 自己輸入的小選單" />
        </Section>

        {/* 7 逐字稿 */}
        <Section id="transcribe" n="07" title="逐字稿 / 字幕 SRT（音檔・影片轉文字）">
          <p>
            點面板標題列的 <strong>文件圖示</strong>，開啟逐字稿視窗。把<strong>音檔或影片</strong>拖進去，它會自動轉成文字。
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>支援：影片 mp4 / mov / webm，音檔 mp3 / wav / m4a / ogg / flac（影片會自動抽音軌）</li>
            <li>兩種輸出：<strong>逐字稿</strong>（純文字，匯出 .txt）或 <strong>字幕 SRT</strong>（含時間軸，匯出 .srt，丟進剪輯軟體或 YouTube 直接用）</li>
            <li>出來的逐字稿可以直接在視窗裡編輯，再複製或匯出</li>
          </ul>
          <Shot label="逐字稿視窗：上方「逐字稿 / 字幕 SRT」切換 + 拖檔區 + 轉好的字幕" />
        </Section>

        {/* 8 AI */}
        <Section id="ai" n="08" title="AI 優化與你自己的 API">
          <p>
            聲聲慢的辨識本身完全免費、離線。AI 只是<strong>選用</strong>的加分功能（預設關閉），用來把辨識結果潤飾得更通順、或在操作模式裡做潤稿 / 總結 / 自由指令。
          </p>
          <p>面板上的 <strong>✨AI</strong> 按鈕可以隨時開關 AI 優化。要用 AI 需要在設定填一組金鑰，支援這幾種：</p>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-gray-700/50"><th className={TH}>供應商</th><th className={TH}>說明</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                <tr><td className={TD}><strong>Ollama（本地）</strong></td><td className={TD}>完全免費、離線、不用金鑰。裝好 Ollama 跑 qwen2.5 即可，隱私最佳</td></tr>
                <tr><td className={TD}>DeepSeek</td><td className={TD}>便宜（一個月約一杯飲料錢），中文表現好</td></tr>
                <tr><td className={TD}>Gemini</td><td className={TD}>Google，有免費額度</td></tr>
                <tr><td className={TD}>OpenAI</td><td className={TD}>gpt 系列，預設範本</td></tr>
              </tbody>
            </table>
          </div>
          <h3 className="font-bold text-gray-800 dark:text-gray-100 pt-2">怎麼設定（最快的兩條路）</h3>
          <p className="font-medium">路線 A：完全免費、本地（最在意隱私就選這條）</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>到 <a className="text-emerald-600 hover:underline" href="https://ollama.com" target="_blank" rel="noreferrer">ollama.com</a> 下載並安裝 Ollama</li>
            <li>開命令列（cmd / PowerShell）執行 <code className="px-1 bg-gray-100 dark:bg-gray-700 rounded">ollama pull qwen2.5</code> 把模型抓下來</li>
            <li>聲聲慢 → 設定 → AI → 點 <strong>Ollama</strong> 範本 → 打開 AI 優化。免金鑰、免費、離線。</li>
          </ol>
          <p className="font-medium pt-2">路線 B：用雲端 AI（需要一把金鑰，品質更高）</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>挑一家去拿金鑰：
              <a className="text-emerald-600 hover:underline" href="https://platform.deepseek.com" target="_blank" rel="noreferrer">DeepSeek</a>（最便宜、中文好）、
              <a className="text-emerald-600 hover:underline" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>（Gemini，有免費額度）、
              或 <a className="text-emerald-600 hover:underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI</a></li>
            <li>設定 → AI → 點<strong>那一家的範本</strong>（會自動幫你填好網址跟模型）</li>
            <li>把金鑰貼進「API 金鑰」欄 → 按「<strong>測試設定</strong>」確認連得上 → 打開 AI 優化</li>
          </ol>
          <p className="text-sm bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
            常見雷：金鑰一定要從上面那些<strong>官方頁面</strong>拿；<strong>Gemini 的金鑰要去 Google AI Studio 申請</strong>（不是直接用 Google 帳號）。如果一直失敗，按「測試設定」，它會直接告訴你是金鑰錯、模型錯、還是額度爆了。
          </p>
          <Shot label="設定 → AI：供應商範本按鈕 + 金鑰欄位 + 測試設定" />
        </Section>

        {/* 9 設定 */}
        <Section id="settings" n="09" title="設定詳解">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-gray-700/50"><th className={TH}>設定</th><th className={TH}>說明（預設）</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                <tr><td className={TD}>AI 優化</td><td className={TD}>辨識後用 AI 潤飾（預設關）</td></tr>
                <tr><td className={TD}>效能模式</td><td className={TD}><strong>標準</strong>（最準，預設）或 <strong>快速</strong>（弱電腦用，快 2~3 倍、精度小降）</td></tr>
                <tr><td className={TD}>視窗透明度</td><td className={TD}>30% ~ 100% 滑桿（預設 100%）；迷你和一般面板共用</td></tr>
                <tr><td className={TD}>辨識後自動送出</td><td className={TD}>貼上後自動按 Enter，給聊天軟體用（預設關）</td></tr>
                <tr><td className={TD}>自動貼上</td><td className={TD}>辨識完直接貼到游標處（永遠開啟）</td></tr>
                <tr><td className={TD}>視窗置頂 / 縮到托盤</td><td className={TD}>預設都開</td></tr>
                <tr><td className={TD}>朗讀聲音 / 語速</td><td className={TD}>念出來用的聲音（曉臻 / 曉雨 / 雲哲）與語速</td></tr>
                <tr><td className={TD}>介面語言</td><td className={TD}>繁體中文 / 简体中文 / English</td></tr>
                <tr><td className={TD}>簡繁轉換</td><td className={TD}>把辨識結果轉成介面語言（預設開，例如簡轉繁）</td></tr>
                <tr><td className={TD}>熱詞 / 字典管理</td><td className={TD}>專有名詞（辨識前）與改錯記憶（辨識後）</td></tr>
              </tbody>
            </table>
          </div>
          <Shot label="設定面板總覽（一般 / AI / 快捷鍵 / 進階 等分頁）" />
        </Section>

        {/* 10 mini */}
        <Section id="mini" n="10" title="迷你模式（縮到角落）">
          <p>
            點標題列的 <strong>減號（−）</strong>，面板會縮成一條小膠囊，黏在桌面角落不擋路。膠囊上會顯示狀態（待命 / 聽寫中 / 聽指令）和上一句辨識結果，也有複製鈕。
          </p>
          <p>要展開回完整面板，點膠囊上的<strong>展開圖示</strong>即可。透明度設定對迷你膠囊一樣有效。</p>
          <Shot label="迷你膠囊黏在桌面角落的樣子" />
        </Section>

        {/* 11 history */}
        <Section id="history" n="11" title="歷史記錄與救回">
          <p>每一次辨識都會存進歷史，可以搜尋、複製。只要當時有存到錄音檔，每筆還能：</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>播放</strong>原始錄音、<strong>下載</strong>成 wav</li>
            <li><strong>重新辨識</strong>：快速重辨（Paraformer）或<strong>精準重辨（Whisper）</strong>。Whisper 較慢，但對英文 / 難句更準，可當救援</li>
          </ul>
          <p>
            <strong>當機救回</strong>：如果錄音中途程式被關掉（當機、或被你誤關），下次開啟時那段錄音會以「上次中斷的錄音・尚未轉錄」出現在歷史，按「重新辨識」就能把它救回來，不會白錄。
          </p>
          <Shot label="歷史記錄一筆：播放 / 下載 / 快速重辨 / 精準重辨 按鈕" />
        </Section>

        {/* 12 privacy */}
        <Section id="privacy" n="12" title="隱私">
          <p>
            語音辨識 100% 在你的電腦上跑，<strong>聲音一個 byte 都不出門</strong>。唯一會連網的是你主動選用的「AI 優化」和「翻譯」；想完全離線，AI 用本地 Ollama、不使用翻譯即可，整套零外傳。
          </p>
        </Section>

        {/* CTA */}
        <div className="text-center mt-12">
          <a
            href="https://github.com/Jeffrey0117/SpeakSlow/releases/latest/download/SpeakSlow-Setup.exe"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors shadow-lg"
          >
            免費下載，跟著教學玩一遍
          </a>
        </div>
      </div>
    </div>
  )
}
