// 把 docs/report 下的報告 .md 內嵌進自帶渲染器的 HTML（marked + mermaid CDN），
// 開啟後可直接「列印 → 另存 PDF」。重跑本腳本即可同步 MD 的最新內容。
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../../docs/report')
const docs = [
  { file: 'Lucky-Star-Casino-總體檢報告', title: '幸運星幣城 — 系統總體檢報告' },
  { file: 'Lucky-Star-Casino-開發與流程報告', title: '幸運星幣城 — 開發與流程報告' },
  { file: 'Lucky-Star-Casino-前端功能導覽', title: '幸運星幣城 — 前端功能導覽' },
  { file: 'Lucky-Star-Casino-補充說明', title: '幸運星幣城 — 補充說明' },
  // 提案書：白底無主題樣式、A4 邊界 1cm、頁尾頁碼（plain 模板）
  { file: 'Lucky-Star-Casino-專題提案書', title: '幸運星幣城 — 專題提案書', plain: true },
]

// 提案書要求：白色底、不加額外樣式，僅保留可讀性必需的表格框線與標題層級
const plainCss = `
  * { box-sizing: border-box; }
  body { font-family: 'Microsoft JhengHei','Noto Sans TC',system-ui,sans-serif;
         margin: 0; color: #000; background: #fff; line-height: 1.7; }
  #doc { max-width: 860px; margin: 0 auto; padding: 24px; background: #fff; }
  h1 { font-size: 1.7em; border-bottom: 2px solid #000; padding-bottom: .3em; }
  h2 { font-size: 1.3em; border-bottom: 1px solid #999; padding-bottom: .2em; margin-top: 2em; }
  h3 { font-size: 1.1em; margin-top: 1.6em; }
  a { color: #000; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .92em; }
  th, td { border: 1px solid #666; padding: 5px 9px; text-align: left; vertical-align: top; }
  img { max-width: 100%; border: 1px solid #999; margin: .4em 0; }
  svg { display: block; margin: .4em 0; }
  code { font-family: Consolas, monospace; font-size: .92em; }
  blockquote { border-left: 3px solid #999; margin: 1em 0; padding: .2em 1em; color: #333; }
  .mermaid { background: #fff; text-align: center; margin: 1em 0; }
  hr { border: none; border-top: 1px solid #999; margin: 2em 0; }
  @page { size: A4; margin: 1cm; @bottom-center { content: counter(page); font-size: 10pt; } }
  @media print {
    #doc { max-width: 100%; padding: 0; }
    h2 { page-break-before: always; }
    #doc > h2:first-of-type { page-break-before: avoid; }
    table, img, svg, .mermaid, blockquote { page-break-inside: avoid; }
    a { text-decoration: none; }
  }
`

const themedCss = `
  :root { --accent:#b91c1c; --gold:#a16207; }
  * { box-sizing: border-box; }
  body { font-family: 'Microsoft JhengHei','Noto Sans TC',system-ui,sans-serif;
         margin:0; color:#1f2937; background:#f6f4ef; line-height:1.75; }
  #doc { max-width: 960px; margin: 0 auto; padding: 40px 32px; background:#fff;
         box-shadow: 0 0 24px rgba(0,0,0,.08); }
  h1 { color: var(--accent); border-bottom: 4px solid var(--gold); padding-bottom:.4em; }
  h2 { color: var(--accent); border-bottom: 2px solid #e5e7eb; padding-bottom:.3em; margin-top:2.2em; }
  h3 { color: var(--gold); margin-top:1.8em; }
  a { color: var(--accent); }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .92em; }
  th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #fdf3f3; }
  tr:nth-child(even) td { background: #fafaf8; }
  img { max-width: 100%; border: 1px solid #d1d5db; border-radius: 8px; margin: .5em 0; }
  code { background:#f3f0e8; padding:1px 5px; border-radius:4px; font-size:.9em; }
  pre code { display:block; padding:12px; overflow-x:auto; }
  blockquote { border-left: 4px solid var(--gold); margin: 1em 0; padding: .3em 1em;
               background:#fdfaf2; color:#57534e; }
  .mermaid { background:#fff; text-align:center; margin: 1em 0; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 2.5em 0; }
  @media print {
    body { background:#fff; }
    #doc { box-shadow:none; max-width:100%; padding: 0; }
    h2 { page-break-before: always; }
    h1 + p + hr + h2, #doc > h2:first-of-type { page-break-before: avoid; }
    table, img, .mermaid, blockquote { page-break-inside: avoid; }
    a { color:#1f2937; text-decoration: none; }
  }
`

const template = (title, md, css) => `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}</style>
</head>
<body>
<div id="doc">渲染中…（需要網路載入 Mermaid / Marked）</div>
<script type="text/template" id="md-src">
${md}
</script>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'

  const raw = document.getElementById('md-src').textContent
  const doc = document.getElementById('doc')
  doc.innerHTML = marked.parse(raw, { mangle: false, headerIds: false })

  // GitHub 風格 heading id，讓目錄錨點可用
  const slug = (t) => t.trim().toLowerCase()
    .replace(/[^\\p{L}\\p{N} -]/gu, '')
    .replace(/ /g, '-')
  doc.querySelectorAll('h1,h2,h3,h4').forEach((h) => { h.id = slug(h.textContent) })

  // 把 mermaid code block 轉成可渲染節點
  doc.querySelectorAll('pre > code.language-mermaid').forEach((code) => {
    const div = document.createElement('div')
    div.className = 'mermaid'
    div.textContent = code.textContent
    code.parentElement.replaceWith(div)
  })
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' })
  await mermaid.run({ querySelector: '.mermaid' })
</script>
</body>
</html>
`

for (const { file, title, plain } of docs) {
  const md = readFileSync(`${dir}/${file}.md`, 'utf8')
  if (md.includes('</script>')) throw new Error(`${file}.md 內含 </script>，需先跳脫`)
  writeFileSync(`${dir}/${file}.html`, template(title, md, plain ? plainCss : themedCss))
  console.log('✓', `${file}.html`)
}
