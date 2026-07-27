#!/usr/bin/env node
/**
 * 用 Playwright（Chromium headless）把 Grafana 面板截成 PNG，供壓測報告 / 簡報使用。
 *
 * 為什麼要這支腳本：
 *   Grafana 官方的「Share → Direct link rendered image」需要 grafana-image-renderer 外掛，
 *   本專案的 compose 沒裝。既然 repo 已經有 Playwright（tests/e2e），直接開一顆 headless
 *   Chromium 去「看」dashboard 再截圖，是零額外相依的作法。
 *
 * 用法：
 *   node tools/observability/capture-grafana.mjs --uid lucky-star-loadtest \
 *        --from 1721540000000 --to 1721541000000 --out docs/performance/results/xxx/grafana
 *
 * 參數（皆可用環境變數覆蓋）：
 *   --grafana  Grafana 位址，預設 http://localhost:3000
 *   --uid      dashboard uid（必填）
 *   --from/--to  時間範圍（epoch 毫秒，或 Grafana 相對語法如 now-15m）
 *   --out      輸出資料夾（必填）
 *   --width/--height  單一面板截圖尺寸，預設 1400x600（PPT 16:9 友善）
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
// 本專案裝的是 @playwright/test（tests/e2e 用），它同樣 re-export chromium，
// 不必另外安裝 playwright 套件。
import { chromium } from '@playwright/test'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1]
  return process.env[name.toUpperCase()] ?? fallback
}

const GRAFANA = arg('grafana', 'http://localhost:3000')
const UID = arg('uid')
const FROM = arg('from', 'now-30m')
const TO = arg('to', 'now')
const OUT = arg('out')
const WIDTH = Number(arg('width', 1400))
const HEIGHT = Number(arg('height', 600))
// 簡報底色若是白的，用 --theme light 出淺色圖比較不會整頁黑到刺眼
const THEME = arg('theme', 'dark')

if (!UID || !OUT) {
  console.error('Usage: node capture-grafana.mjs --uid <dashboardUid> --out <dir> [--from ..] [--to ..]')
  process.exit(2)
}

const outDir = resolve(OUT)
mkdirSync(outDir, { recursive: true })

/**
 * 檔名安全化：中文保留（PPT 直接看得懂圖是什麼），但把路徑非法字元、破折號、
 * 全形括號等會讓某些工具吃癟的符號收斂成 '-'，並用 panel-NN 前綴保持排序。
 */
function slugify(title, id) {
  const safe = title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[—–\-—／（）()[\]{}、,，.。]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `panel-${String(id).padStart(2, '0')}-${safe}`
}

/**
 * 等面板真的畫完再截圖。
 * Grafana 11 的面板載入中會有 loading bar，畫完後 canvas/svg 才出現；
 * 這裡採「等 svg/canvas 出現 + 額外緩衝」的保守作法，避免截到半張空圖。
 */
async function waitForPanelRender(page) {
  await page.waitForSelector('[data-testid="data-testid panel content"]', { timeout: 30_000 }).catch(() => {})
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="data-testid panel content"]')
      if (!el) return false
      // 有畫布（timeseries）或有 stat 文字（stat panel）就算畫完
      return !!el.querySelector('canvas, svg') || (el.textContent ?? '').trim().length > 0
    },
    { timeout: 30_000 },
  ).catch(() => {})
  await page.waitForTimeout(2500)
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2, // 2x 解析度，投影/列印不糊
})
const page = await context.newPage()

// 1) 先抓 dashboard 定義，才知道有哪些面板（免得硬編 panel id）
const metaRes = await page.request.get(`${GRAFANA}/api/dashboards/uid/${UID}`)
if (!metaRes.ok()) {
  console.error(`Cannot read dashboard ${UID}: HTTP ${metaRes.status()}`)
  await browser.close()
  process.exit(1)
}
const meta = await metaRes.json()
const dashboard = meta.dashboard
const panels = (dashboard.panels ?? []).filter((p) => p.type !== 'row')

const timeRange = `from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&theme=${THEME}`
const captured = []

// 2) 整張 dashboard 一張（kiosk 模式隱藏側邊欄/頂欄）
await page.setViewportSize({ width: 1600, height: 2200 })
await page.goto(`${GRAFANA}/d/${UID}?orgId=1&${timeRange}&kiosk&refresh=`, { waitUntil: 'networkidle' })
await page.waitForTimeout(6000)
const overviewPath = resolve(outDir, '00-dashboard-overview.png')
await page.screenshot({ path: overviewPath, fullPage: true })
captured.push({ file: '00-dashboard-overview.png', title: dashboard.title })
console.log(`captured overview -> ${overviewPath}`)

// 3) 每個面板各一張（PPT 一頁一圖用）
await page.setViewportSize({ width: WIDTH, height: HEIGHT })
for (const panel of panels) {
  const name = slugify(panel.title ?? `panel${panel.id}`, panel.id)
  const url = `${GRAFANA}/d/${UID}?orgId=1&${timeRange}&viewPanel=${panel.id}&kiosk&refresh=`
  await page.goto(url, { waitUntil: 'networkidle' })
  await waitForPanelRender(page)
  const file = `${name}.png`
  await page.screenshot({ path: resolve(outDir, file) })
  captured.push({ file, title: panel.title, id: panel.id })
  console.log(`captured ${panel.id} ${panel.title} -> ${file}`)
}

writeFileSync(
  resolve(outDir, 'captured.json'),
  JSON.stringify({ dashboard: dashboard.title, uid: UID, from: FROM, to: TO, captured }, null, 2),
)

await browser.close()
console.log(`\nDone. ${captured.length} images in ${outDir}`)
