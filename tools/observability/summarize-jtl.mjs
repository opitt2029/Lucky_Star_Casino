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
 * T-090 P2（暖機/穩態切乾淨）：
 *   JIT 編譯、連線池爬升、快取冷啟在每一階的「前幾秒」製造尖刺，混進 percentile 會讓 P99
 *   不穩、失真。故支援「暖機窗」：丟掉每一階前 <warmupSeconds> 秒的樣本，只用穩態窗算統計。
 *   暖機窗依「該階第一筆樣本的送出時間」起算（每個 step 各自一個 results.jtl，min 即該階起點）。
 *   若暖機窗把樣本清空（step 太短），退回用全部樣本並標記 warmupApplied=false（不假裝有穩態）。
 *
 * 用法：node summarize-jtl.mjs <results.jtl> [warmupSeconds]
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const jtlArg = process.argv[2]
if (!jtlArg) {
  console.error('Usage: node summarize-jtl.mjs <results.jtl> [warmupSeconds]')
  process.exit(2)
}
// P2：暖機窗秒數（第二個參數，預設 0＝不丟、行為與舊版相容）
const warmupSeconds = Math.max(0, Number(process.argv[3] ?? 0) || 0)

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
const allSamples = lines.slice(1).filter(Boolean).map((line) => {
  const values = parseCsvLine(line)
  return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
})

// 2026-07-22：min/max 一律用迴圈，不用 Math.min(...arr) 展開。
// 展開會把每個元素當成一個函式引數，樣本數上看數十萬時直接
// RangeError: Maximum call stack size exceeded——而且這支腳本的輸出是被階梯腳本
// 當 JSON 吃的，崩掉的那一階會安靜地變成整列空白（5,000 req/s 階實際踩到過）。
function minOf(numbers) {
  let result = Infinity
  for (const n of numbers) if (n < result) result = n
  return Number.isFinite(result) ? result : 0
}
function maxOf(numbers) {
  let result = -Infinity
  for (const n of numbers) if (n > result) result = n
  return Number.isFinite(result) ? result : 0
}

// P2：以「該階第一筆樣本送出時間」為零點，切掉前 warmupSeconds 秒，只留穩態窗。
const allStartTimestamps = allSamples.map((s) => Number(s.timeStamp)).filter(Number.isFinite)
const stepStartMs = allStartTimestamps.length ? minOf(allStartTimestamps) : 0
const warmupCutoffMs = stepStartMs + warmupSeconds * 1000
let samples = warmupSeconds > 0
  ? allSamples.filter((s) => Number(s.timeStamp) >= warmupCutoffMs)
  : allSamples
let warmupDroppedSamples = allSamples.length - samples.length
let warmupApplied = warmupSeconds > 0
// 保護：暖機窗把樣本清空（step 太短）→ 退回全部並標記，別回傳 0 樣本的假統計
if (samples.length === 0) {
  samples = allSamples
  warmupDroppedSamples = 0
  warmupApplied = false
}

const timestamps = samples.map((s) => Number(s.timeStamp)).filter(Number.isFinite)
// 牆鐘時間用穩態窗重算（切掉暖機後，吞吐＝穩態樣本數 / 穩態牆鐘）
const wallSeconds = Math.max(1, (maxOf(timestamps) - minOf(timestamps)) / 1000)

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
  // P2：暖機窗透明度——回報丟了幾筆、是否真的套用，讓報告能標「這是穩態值」
  warmupSeconds,
  warmupApplied,
  warmupDroppedSamples,
  totalSamples: allSamples.length,
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
