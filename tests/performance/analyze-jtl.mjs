import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , jtlArg, reportArg] = process.argv
if (!jtlArg || !reportArg) {
  console.error('Usage: node analyze-jtl.mjs <results.jtl> <report.md>')
  process.exit(2)
}

// T-090 C1/D1 拍板語意（2026-07-08）：429 = gateway 明確卸載（load shedding），不是失敗——
// gate 檢驗「被接受的請求必須快而正確」，P99 / 5xx / 失敗樣本只算非 429 樣本。
//
// D1-final 拍板（2026-07-18，藍圖 03）：gate 與拓樸宣告綁定，取代舊的標量 429 佔比上限——
// - 驗收模式（THREADS ≤ DECLARED_CAPACITY）：宣告容量內不准卸載。
//   gate＝P99 < 500 ms、5xx = 0、失敗 = 0、429 = 0。
// - 韌性模式（THREADS > DECLARED_CAPACITY）：超出宣告容量，「卸載多少」是容量問題不設 gate、
//   只記趨勢；判「卸載得乾不乾淨」＝accepted 成功率 ≥ MIN_ACCEPTED_SUCCESS（預設 0.95）。
// - 帳務（冪等/超扣）兩模式都是硬 gate＝0（T-091 硬底線的 JTL 端投影）。
const declaredCapacity = Number(process.env.DECLARED_CAPACITY ?? 150)
const threads = Number(process.env.THREADS ?? declaredCapacity)
const minAcceptedSuccess = Number(process.env.MIN_ACCEPTED_SUCCESS ?? 0.95)
if (![declaredCapacity, threads].every((n) => Number.isInteger(n) && n > 0)
  || !Number.isFinite(minAcceptedSuccess) || minAcceptedSuccess < 0 || minAcceptedSuccess > 1) {
  console.error(`Invalid gate params: DECLARED_CAPACITY=${process.env.DECLARED_CAPACITY} THREADS=${process.env.THREADS} MIN_ACCEPTED_SUCCESS=${process.env.MIN_ACCEPTED_SUCCESS}`)
  process.exit(2)
}
const resilienceMode = threads > declaredCapacity

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
const successRate = accepted.length > 0 ? (accepted.length - failures.length) / accepted.length : 0
const accountingPassed = idempotencyFailures.length === 0 && overdrawFailures.length === 0
const passed = samples.length > 0 && accepted.length > 0 && accountingPassed
  && (resilienceMode
    ? successRate >= minAcceptedSuccess
    : (p99 < 500 && fiveXx.length === 0 && failures.length === 0 && shed.length === 0))

const labels = [...new Set(samples.map((sample) => sample.label))].sort()
const labelRows = labels.map((label) => {
  const rows = accepted.filter((sample) => sample.label === label)
  const labelShed = shed.filter((sample) => sample.label === label).length
  const labelP99 = percentile(rows.map((sample) => Number(sample.elapsed)).filter(Number.isFinite), 0.99)
  const labelFailures = rows.filter((sample) => sample.success !== 'true').length
  return `| ${label} | ${rows.length} | ${labelP99} ms | ${labelFailures} | ${labelShed} |`
}).join('\n')

const pct = (ratio) => `${(ratio * 100).toFixed(1)}%`

const modeLabel = resilienceMode ? 'resilience（超容量韌性驗證）' : 'acceptance（容量內驗收）'

const gateRows = resilienceMode
  ? `| Accepted success rate | >= ${pct(minAcceptedSuccess)} | ${pct(successRate)} | ${successRate >= minAcceptedSuccess ? 'PASS' : 'FAIL'} |
| Idempotency failures | 0 | ${idempotencyFailures.length} | ${idempotencyFailures.length === 0 ? 'PASS' : 'FAIL'} |
| Overdraw failures | 0 | ${overdrawFailures.length} | ${overdrawFailures.length === 0 ? 'PASS' : 'FAIL'} |
| Accepted P99（趨勢，不設 gate） | — | ${p99} ms | TREND |
| HTTP 5xx（趨勢，不設 gate） | — | ${fiveXx.length} | TREND |
| 429 shed ratio（趨勢，不設 gate） | — | ${pct(shedRatio)} | TREND |`
  : `| Accepted P99 | < 500 ms | ${p99} ms | ${p99 < 500 ? 'PASS' : 'FAIL'} |
| HTTP 5xx | 0 | ${fiveXx.length} | ${fiveXx.length === 0 ? 'PASS' : 'FAIL'} |
| Shed (429) | 0（宣告容量內不准卸載） | ${shed.length} | ${shed.length === 0 ? 'PASS' : 'FAIL'} |
| Idempotency failures | 0 | ${idempotencyFailures.length} | ${idempotencyFailures.length === 0 ? 'PASS' : 'FAIL'} |
| Overdraw failures | 0 | ${overdrawFailures.length} | ${overdrawFailures.length === 0 ? 'PASS' : 'FAIL'} |
| All assertions / accepted requests | PASS | ${failures.length} failed | ${failures.length === 0 ? 'PASS' : 'FAIL'} |`

const report = `# T-090 Slot Load Test Acceptance Report

- Generated: ${new Date().toISOString()}
- Declared capacity: ${declaredCapacity} 併發（單機拓樸，D1-final 2026-07-18 拍板）
- Round threads: ${threads}
- Gate mode: ${modeLabel}
- Samples: ${samples.length}（accepted ${accepted.length} / shed-429 ${shed.length}）
- Accepted P99: ${p99} ms
- Accepted success rate: ${pct(successRate)}
- Failed samples (accepted): ${failures.length}
- HTTP 5xx responses: ${fiveXx.length}
- 429 shed ratio: ${pct(shedRatio)}
- Idempotency assertion failures: ${idempotencyFailures.length}
- Overdraw assertion failures: ${overdrawFailures.length}
- Result: **${passed ? 'PASS' : 'FAIL'}**

> Gate 語意（2026-07-08 拍板；D1-final 2026-07-18 定案）：429 = gateway 併發上限的明確卸載
>（快速拒絕 + Retry-After、不佔後端資源、無帳務風險），不計入失敗；P99 / 5xx / 失敗樣本以
>「被接受的請求」為母體。429 gate 與拓樸宣告綁定：宣告容量內 429 = 0；超出宣告容量的輪次
> 卸載量不設 gate（容量問題），改判 accepted 成功率（機制問題）＋帳務 0 違規。

## Acceptance Gates

| Gate | Expected | Actual | Result |
|---|---:|---:|---|
${gateRows}

## Per-Sampler Results

| Sampler | Accepted | P99 | Failures | Shed (429) |
|---|---:|---:|---:|---:|
${labelRows}
`

writeFileSync(reportPath, report, 'utf8')
console.log(report)
process.exit(passed ? 0 : 1)
