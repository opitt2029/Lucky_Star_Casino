#!/usr/bin/env node
/**
 * 把 dashboard JSON 匯入到跑著的 Grafana（走 HTTP API，不必重啟容器）。
 *
 * 為什麼不是「丟進 provisioning 資料夾就好」：
 *   compose 把 observability/grafana/provisioning 唯讀掛進容器，改檔案要能被 Grafana
 *   看到才生效；在多 worktree / 臨時實驗的情境下，直接呼叫 API 匯入比較快也不動到
 *   別人的工作目錄。檔案本身仍留在 provisioning 資料夾，正式環境照舊由 provisioning 載入。
 *
 * 另外會自動把面板裡的 datasource uid 換成這台 Grafana 上「實際的」Prometheus uid
 * ——provisioning 產生的 uid 每台機器不同，硬編會變成空面板。
 *
 * 用法：
 *   node tools/observability/import-dashboard.mjs observability/grafana/provisioning/dashboards/lucky-star-loadtest.json
 *
 * 環境變數：
 *   GRAFANA_URL   預設 http://localhost:3000
 *   GRAFANA_USER  預設 admin
 *   GRAFANA_PASS  預設 admin
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const GRAFANA = process.env.GRAFANA_URL || 'http://localhost:3000'
const USER = process.env.GRAFANA_USER || 'admin'
const PASS = process.env.GRAFANA_PASS || 'admin'
const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')

const file = process.argv[2]
if (!file) {
  console.error('Usage: node import-dashboard.mjs <dashboard.json>')
  process.exit(2)
}

const dashboard = JSON.parse(readFileSync(resolve(file), 'utf8'))

// 1) 找出這台 Grafana 上真正的 Prometheus datasource uid
const dsRes = await fetch(`${GRAFANA}/api/datasources`, { headers: { Authorization: auth } })
if (!dsRes.ok) {
  console.error(`列出 datasource 失敗：HTTP ${dsRes.status} ${await dsRes.text()}`)
  process.exit(1)
}
const prom = (await dsRes.json()).find((d) => d.type === 'prometheus')
if (!prom) {
  console.error('這台 Grafana 沒有 Prometheus datasource')
  process.exit(1)
}
console.log(`Prometheus datasource uid = ${prom.uid}`)

// 2) 遞迴把所有 datasource 參照換成實際 uid
function rewriteDatasource(node) {
  if (Array.isArray(node)) return node.forEach(rewriteDatasource)
  if (!node || typeof node !== 'object') return
  if (node.datasource && typeof node.datasource === 'object' && node.datasource.type === 'prometheus') {
    node.datasource.uid = prom.uid
  }
  Object.values(node).forEach(rewriteDatasource)
}
rewriteDatasource(dashboard)

// 3) 匯入（overwrite=true 讓重跑此腳本等於更新同一張 dashboard，不會長出一堆副本）
delete dashboard.id
const res = await fetch(`${GRAFANA}/api/dashboards/db`, {
  method: 'POST',
  headers: { Authorization: auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ dashboard, folderUid: '', overwrite: true, message: 'imported by import-dashboard.mjs' }),
})
const body = await res.json()
if (!res.ok) {
  console.error(`匯入失敗：HTTP ${res.status}`, body)
  process.exit(1)
}
console.log(`匯入成功：${GRAFANA}${body.url}（version ${body.version}）`)
