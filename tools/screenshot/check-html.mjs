// 開啟產出的 HTML 報告，驗證 Mermaid 全部渲染成功、圖片無破圖。
import { chromium } from 'playwright-core'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../../docs/report')
const files = [
  'Lucky-Star-Casino-總體檢報告',
  'Lucky-Star-Casino-開發與流程報告',
  'Lucky-Star-Casino-前端功能導覽',
]

const b = await chromium.launch({ channel: 'msedge' })
const p = await b.newPage({ viewport: { width: 1100, height: 1400 } })
for (const f of files) {
  const errs = []
  const onErr = (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)) }
  p.on('console', onErr)
  await p.goto('file:///' + `${dir}/${f}.html`.replaceAll('\\', '/'))
  await p.waitForTimeout(5000)
  const svgs = await p.locator('.mermaid svg').count()
  const failed = await p.locator('.mermaid:not(:has(svg))').count()
  const broken = await p.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length)
  console.log(`${f} → mermaid: ${svgs} ok / ${failed} failed, broken imgs: ${broken}${errs.length ? ', console errors: ' + errs[0] : ''}`)
  p.off('console', onErr)
}
await b.close()
