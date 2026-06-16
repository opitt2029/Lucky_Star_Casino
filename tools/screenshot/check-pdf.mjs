// 用 pdf.js 將 PDF 指定頁渲染成 PNG，供人工檢查頁尾頁碼與邊界。
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../../docs/report')
const name = process.argv[2] || 'Lucky-Star-Casino-專題提案書'
const pageNum = Number(process.argv[3] || 2)
const data = readFileSync(`${dir}/${name}.pdf`).toString('base64')

const b = await chromium.launch({ channel: 'msedge' })
const p = await b.newPage({ viewport: { width: 900, height: 1280 } })
await p.goto('about:blank')
await p.setContent(`<canvas id="c"></canvas><script type="module">
  import * as pdfjs from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs'
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs'
  const bytes = Uint8Array.from(atob('${data}'), (ch) => ch.charCodeAt(0))
  const pdf = await pdfjs.getDocument({ data: bytes }).promise
  window.__pages = pdf.numPages
  const page = await pdf.getPage(${pageNum})
  const vp = page.getViewport({ scale: 1.4 })
  const c = document.getElementById('c')
  c.width = vp.width; c.height = vp.height
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
  window.__done = true
<\/script>`)
await p.waitForFunction(() => window.__done, null, { timeout: 30000 })
console.log('PDF 總頁數:', await p.evaluate(() => window.__pages))
const canvas = p.locator('#c')
await canvas.screenshot({ path: resolve(import.meta.dirname, `_pdf_page${pageNum}.png`) })
await b.close()
console.log('✓ 已輸出第', pageNum, '頁預覽')
