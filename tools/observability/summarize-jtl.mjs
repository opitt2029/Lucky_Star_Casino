#!/usr/bin/env node
/**
 * 讀 JMeter 的 .jtl（CSV 格式）→ 吐一包 JSON 統計，給階梯腳本／報告使用。
 *
 * 與 tests/performance/analyze-jtl.mjs 的分工：
 *   analyze-jtl.mjs 負責「判 gate 過不過」並產人看的 markdown；本檔只負責「算數字」，
 *   輸出機器可讀的 JSON，讓階梯腳本能把多輪結果組成一張表。刻意不重用前者，因為
 *   解析 markdown 很脆（格式一改就爆），直接從原始 JTL 重算才穩。
 *
 * 口徑沿用 T-090 D1 拍板：
 *   429 = gateway 明確卸載（快速拒絕、不佔後端資源、無帳務風險），不計入失敗；
 *   延遲統計以「被接受的請求」為母體，才不會被大量快速 429 拉低而失真。
 *
 * 用法：node summarize-jtl.mjs <results.jtl>
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const jtlArg = process.argv[2]
if (!jtlArg) {
  console.error('Usage: node summarize-jtl.mjs <results.jtl>')
  process.exit(2)
}

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += char
    }
  }
  values.push(value)
  return values
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) return 0
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * ratio) - 1)]
}

const lines = readFileSync(resolve(jtlArg), 'utf8').trim().split(/\r?\n/)
if (lines.length < 2) {
  console.error(`JTL 沒有任何樣本：${jtlArg}`)
  process.exit(1)
}

const headers = parseCsvLine(lines[0])
const samples = lines.slice(1).filter(Boolean).map((line) => {
  const values = parseCsvLine(line)
  return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
})

const timestamps = samples.map((s) => Number(s.timeStamp)).filter(Number.isFinite)
// 牆鐘時間用「最後一筆的送出時間 - 第一筆」，再加最後一筆的 elapsed 才是真正跑完的時間
const wallSeconds = Math.max(1, (Math.max(...timestamps) - Math.min(...timestamps)) / 1000)

const shed = samples.filter((s) => s.responseCode === '429')
const accepted = samples.filter((s) => s.responseCode !== '429')
const acceptedElapsed = accepted.map((s) => Number(s.elapsed)).filter(Number.isFinite).sort((a, b) => a - b)

// 只看下注請求（sampler 01/02）的子集：這才是「每秒能處理幾次拉霸」的分母
const spin = accepted.filter((s) => /^0[12] /.test(s.label ?? ''))
const spinElapsed = spin.map((s) => Number(s.elapsed)).filter(Number.isFinite).sort((a, b) => a - b)

const failures = accepted.filter((s) => s.success !== 'true')
const errors5xx = accepted.filter((s) => /^5\d\d$/.test(s.responseCode))
const idempotencyFailures = failures.filter((s) => (s.failureMessage ?? '').includes('Idempotency verification failed'))
const overdrawFailures = failures.filter((s) => (s.failureMessage ?? '').includes('Balance went negative'))

const round = (n, digits = 1) => Number(n.toFixed(digits))

console.log(JSON.stringify({
  jtl: resolve(jtlArg),
  wallSeconds: round(wallSeconds),
  samples: samples.length,
  accepted: accepted.length,
  shed429: shed.length,
  shedRatio: samples.length ? round(shed.length / samples.length, 4) : 0,
  throughputPerSec: round(samples.length / wallSeconds),
  acceptedThroughputPerSec: round(accepted.length / wallSeconds),
  spinSamples: spin.length,
  spinThroughputPerSec: round(spin.length / wallSeconds),
  spinP99: percentile(spinElapsed, 0.99),
  p50: percentile(acceptedElapsed, 0.5),
  p95: percentile(acceptedElapsed, 0.95),
  p99: percentile(acceptedElapsed, 0.99),
  max: acceptedElapsed.length ? acceptedElapsed[acceptedElapsed.length - 1] : 0,
  failures: failures.length,
  errors5xx: errors5xx.length,
  idempotencyFailures: idempotencyFailures.length,
  overdrawFailures: overdrawFailures.length,
}, null, 2))
