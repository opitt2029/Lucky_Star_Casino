import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , jtlArg, reportArg] = process.argv
if (!jtlArg || !reportArg) {
  console.error('Usage: node analyze-jtl.mjs <results.jtl> <report.md>')
  process.exit(2)
}

// T-090 C1/D1 拍板語意（2026-07-08）：429 = gateway 明確卸載（load shedding），不是失敗——
// gate 檢驗「被接受的請求必須快而正確」，P99 / 5xx / 失敗樣本只算非 429 樣本。
// 防「全拒絕也算過」的漏洞：429 佔比另設上限 gate（預設 40%，可用 MAX_429_RATIO 覆寫；
// 容量內的迴歸基準（150 併發）期望 429 = 0，跑 150 時建議設 MAX_429_RATIO=0）。
const max429Ratio = process.env.MAX_429_RATIO !== undefined
  ? Number(process.env.MAX_429_RATIO)
  : 0.40
if (!Number.isFinite(max429Ratio) || max429Ratio < 0 || max429Ratio > 1) {
  console.error(`Invalid MAX_429_RATIO: ${process.env.MAX_429_RATIO} (expected 0..1)`)
  process.exit(2)
}

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
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

function percentile(values, ratio) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
}

const jtlPath = resolve(jtlArg)
const reportPath = resolve(reportArg)
const lines = readFileSync(jtlPath, 'utf8').trim().split(/\r?\n/)
if (lines.length < 2) {
  throw new Error(`JTL contains no samples: ${jtlPath}`)
}

const headers = parseCsvLine(lines[0])
const samples = lines.slice(1).filter(Boolean).map((line) => {
  const values = parseCsvLine(line)
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
})

const shed = samples.filter((sample) => sample.responseCode === '429')
const accepted = samples.filter((sample) => sample.responseCode !== '429')
const shedRatio = samples.length > 0 ? shed.length / samples.length : 0

const elapsed = accepted.map((sample) => Number(sample.elapsed)).filter(Number.isFinite)
const p99 = percentile(elapsed, 0.99)
const failures = accepted.filter((sample) => sample.success !== 'true')
const fiveXx = accepted.filter((sample) => /^5\d\d$/.test(sample.responseCode))
const idempotencyFailures = failures.filter((sample) => sample.failureMessage?.includes('Idempotency verification failed'))
const overdrawFailures = failures.filter((sample) => /Negative balance|Overdraw detected/.test(sample.failureMessage ?? ''))
const shedPassed = shedRatio <= max429Ratio
const passed = samples.length > 0 && accepted.length > 0
  && p99 < 500 && fiveXx.length === 0 && failures.length === 0 && shedPassed

const labels = [...new Set(samples.map((sample) => sample.label))].sort()
const labelRows = labels.map((label) => {
  const rows = accepted.filter((sample) => sample.label === label)
  const labelShed = shed.filter((sample) => sample.label === label).length
  const labelP99 = percentile(rows.map((sample) => Number(sample.elapsed)).filter(Number.isFinite), 0.99)
  const labelFailures = rows.filter((sample) => sample.success !== 'true').length
  return `| ${label} | ${rows.length} | ${labelP99} ms | ${labelFailures} | ${labelShed} |`
}).join('\n')

const pct = (ratio) => `${(ratio * 100).toFixed(1)}%`

const report = `# T-090 Slot Load Test Acceptance Report

- Generated: ${new Date().toISOString()}
- Samples: ${samples.length}（accepted ${accepted.length} / shed-429 ${shed.length}）
- Accepted P99: ${p99} ms
- Failed samples (accepted): ${failures.length}
- HTTP 5xx responses: ${fiveXx.length}
- 429 shed ratio: ${pct(shedRatio)}（上限 ${pct(max429Ratio)}）
- Idempotency assertion failures: ${idempotencyFailures.length}
- Overdraw assertion failures: ${overdrawFailures.length}
- Result: **${passed ? 'PASS' : 'FAIL'}**

> Gate 語意（2026-07-08 拍板）：429 = gateway 併發上限的明確卸載（快速拒絕 + Retry-After、
> 不佔後端資源、無帳務風險），不計入失敗；P99 / 5xx / 失敗樣本以「被接受的請求」為母體。
> 429 佔比上限防止「全拒絕也算過」。容量內（150 併發迴歸基準）期望 429 = 0（MAX_429_RATIO=0）。

## Acceptance Gates

| Gate | Expected | Actual | Result |
|---|---:|---:|---|
| Accepted P99 | < 500 ms | ${p99} ms | ${p99 < 500 ? 'PASS' : 'FAIL'} |
| HTTP 5xx | 0 | ${fiveXx.length} | ${fiveXx.length === 0 ? 'PASS' : 'FAIL'} |
| 429 shed ratio | <= ${pct(max429Ratio)} | ${pct(shedRatio)} | ${shedPassed ? 'PASS' : 'FAIL'} |
| Idempotency failures | 0 | ${idempotencyFailures.length} | ${idempotencyFailures.length === 0 ? 'PASS' : 'FAIL'} |
| Overdraw failures | 0 | ${overdrawFailures.length} | ${overdrawFailures.length === 0 ? 'PASS' : 'FAIL'} |
| All assertions / accepted requests | PASS | ${failures.length} failed | ${failures.length === 0 ? 'PASS' : 'FAIL'} |

## Per-Sampler Results

| Sampler | Accepted | P99 | Failures | Shed (429) |
|---|---:|---:|---:|---:|
${labelRows}
`

writeFileSync(reportPath, report, 'utf8')
console.log(report)
process.exit(passed ? 0 : 1)
