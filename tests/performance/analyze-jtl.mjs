import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , jtlArg, reportArg] = process.argv
if (!jtlArg || !reportArg) {
  console.error('Usage: node analyze-jtl.mjs <results.jtl> <report.md>')
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

const elapsed = samples.map((sample) => Number(sample.elapsed)).filter(Number.isFinite)
const p99 = percentile(elapsed, 0.99)
const failures = samples.filter((sample) => sample.success !== 'true')
const fiveXx = samples.filter((sample) => /^5\d\d$/.test(sample.responseCode))
const idempotencyFailures = failures.filter((sample) => sample.failureMessage?.includes('Idempotency verification failed'))
const overdrawFailures = failures.filter((sample) => /Negative balance|Overdraw detected/.test(sample.failureMessage ?? ''))
const passed = samples.length > 0 && p99 < 500 && fiveXx.length === 0 && failures.length === 0

const labels = [...new Set(samples.map((sample) => sample.label))].sort()
const labelRows = labels.map((label) => {
  const rows = samples.filter((sample) => sample.label === label)
  const labelP99 = percentile(rows.map((sample) => Number(sample.elapsed)).filter(Number.isFinite), 0.99)
  const labelFailures = rows.filter((sample) => sample.success !== 'true').length
  return `| ${label} | ${rows.length} | ${labelP99} ms | ${labelFailures} |`
}).join('\n')

const report = `# T-090 Slot Load Test Acceptance Report

- Generated: ${new Date().toISOString()}
- Samples: ${samples.length}
- Overall P99: ${p99} ms
- Failed samples: ${failures.length}
- HTTP 5xx responses: ${fiveXx.length}
- Idempotency assertion failures: ${idempotencyFailures.length}
- Overdraw assertion failures: ${overdrawFailures.length}
- Result: **${passed ? 'PASS' : 'FAIL'}**

## Acceptance Gates

| Gate | Expected | Actual | Result |
|---|---:|---:|---|
| Response Time P99 | < 500 ms | ${p99} ms | ${p99 < 500 ? 'PASS' : 'FAIL'} |
| HTTP 5xx | 0 | ${fiveXx.length} | ${fiveXx.length === 0 ? 'PASS' : 'FAIL'} |
| Idempotency failures | 0 | ${idempotencyFailures.length} | ${idempotencyFailures.length === 0 ? 'PASS' : 'FAIL'} |
| Overdraw failures | 0 | ${overdrawFailures.length} | ${overdrawFailures.length === 0 ? 'PASS' : 'FAIL'} |
| All assertions / requests | PASS | ${failures.length} failed | ${failures.length === 0 ? 'PASS' : 'FAIL'} |

## Per-Sampler Results

| Sampler | Samples | P99 | Failures |
|---|---:|---:|---:|
${labelRows}
`

writeFileSync(reportPath, report, 'utf8')
console.log(report)
process.exit(passed ? 0 : 1)
