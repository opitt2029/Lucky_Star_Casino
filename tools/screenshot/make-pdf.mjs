// 將提案書 HTML 以 headless 瀏覽器輸出 PDF（驗證 @page 邊界 1cm 與頁尾頁碼，
// 也可直接把產出的 PDF 拿去交件）。
import { chromium } from 'playwright-core'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../../docs/report')
const name = process.argv[2] || 'Lucky-Star-Casino-專題提案書'
const b = await chromium.launch({ channel: 'msedge' })
const p = await b.newPage()
await p.goto('file:///' + `${dir}/${name}.html`.replaceAll('\\', '/'))
await p.waitForTimeout(6000) // 等 Mermaid 渲染
await p.pdf({ path: `${dir}/${name}.pdf`, preferCSSPageSize: true, printBackground: true })
await b.close()
console.log('✓ PDF →', `${dir}/${name}.pdf`)
