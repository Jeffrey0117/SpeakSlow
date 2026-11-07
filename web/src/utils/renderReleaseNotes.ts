// 把 GitHub release notes（Markdown 子集）轉成 HTML。
//
// 刻意不引入完整 Markdown 套件：release notes 只用到固定幾種語法，
// 自己處理可以控制輸出標籤、順便避免多一個 18KB 的相依。
// 安全性：先把整段內容轉義，之後才套語法 —— 任何來源的 HTML 都不會被執行。

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 行內語法：**粗體**、`程式碼`、[文字](連結)
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    )
}

export function renderReleaseNotes(markdown: string): string {
  const lines = escapeHtml(markdown).split('\n')
  const out: string[] = []
  let inList = false
  let inQuote = false

  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false }
  }
  const closeQuote = () => {
    if (inQuote) { out.push('</blockquote>'); inQuote = false }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (!line.trim()) { closeList(); closeQuote(); continue }

    // 引言（macOS 注意事項那種）
    if (line.startsWith('&gt;')) {
      const body = line.replace(/^&gt;\s?/, '')
      if (!inQuote) { closeList(); out.push('<blockquote>'); inQuote = true }
      // 引言內的 ### 標題只當粗體，避免版面出現巨大標題
      out.push(`<p>${inline(body.replace(/^#{1,6}\s*/, ''))}</p>`)
      continue
    }
    closeQuote()

    // 標題：release notes 的 ## / ### 在頁面上降一級，才不會比版本號還大
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      closeList()
      const level = Math.min(6, h[1].length + 2)
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }

    // 項目符號
    const li = line.match(/^\s*[-*]\s+(.*)$/)
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(li[1])}</li>`)
      continue
    }

    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }

  closeList()
  closeQuote()
  return out.join('\n')
}
