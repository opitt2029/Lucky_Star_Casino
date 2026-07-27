import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')
const jmx = readFileSync(resolve(root, 'tests/performance/slot-1000-players.jmx'), 'utf8')
const runner = readFileSync(resolve(root, 'tests/performance/run-slot-load-test.ps1'), 'utf8')
const analyzer = readFileSync(resolve(root, 'tests/performance/analyze-jtl.mjs'), 'utf8')
const report = readFileSync(resolve(root, 'docs/performance/T-090-load-test-report.md'), 'utf8')

describe('T-090 JMeter pressure test contract', () => {
  test('uses 1000 concurrent players for 60 seconds by default', () => {
    assert.match(jmx, /__P\(threads,1000\)/)
    assert.match(jmx, /__P\(duration_seconds,60\)/)
  })

  test('targets the real slot spin endpoint', () => {
    assert.match(jmx, /__P\(spin_path,\/api\/v1\/game\/slot\/spin\)/)
  })

  test('sends the real spin body and never a client idempotency key', () => {
    // 真實契約 body 為 {bet, clientSeed}；冪等鍵由伺服器端生成，client 不得傳入。
    assert.match(jmx, /"bet":\$\{__P\(bet,100\)\}/)
    assert.match(jmx, /"clientSeed":"\$\{clientSeed\}"/)
    assert.doesNotMatch(jmx, /idempotencyKey/)
  })

  test('loads 1000 funded player credentials and recycles for sustained load', () => {
    // 1000 名玩家經 CSV 餵入；recycle=true + stopThread=false 讓 60 秒內持續施壓，
    // 而非每執行緒只跑一次（recycle=false 會在第二輪耗盡 CSV 後停掉所有執行緒）。
    assert.match(jmx, /playerId,accessToken/)
    assert.match(jmx, /<boolProp name="recycle">true<\/boolProp>/)
    assert.match(jmx, /<boolProp name="stopThread">false<\/boolProp>/)
  })

  test('fires two distinct spins per iteration', () => {
    assert.match(jmx, /01 Primary Slot Spin/)
    assert.match(jmx, /02 Secondary Slot Spin/)
    // 伺服器端冪等：client 無法重送同鍵，故第二次為獨立轉動而非重複請求。
    assert.match(jmx, /Reject Negative Balance On Secondary Spin/)
  })

  test('checks wallet balances for overdraw', () => {
    assert.match(jmx, /Capture Round Identity And Reject Negative Balance/)
    assert.match(jmx, /Reject Negative Balance On Secondary Spin/)
    assert.match(jmx, /root\?\.wallet\?\.balance/)
    assert.match(jmx, /Negative balance returned by primary spin/)
    assert.match(jmx, /Negative balance returned by secondary spin/)
  })

  test('sets finite HTTP timeouts and rejects non-2xx responses', () => {
    assert.match(jmx, /__P\(connect_timeout_ms,2000\)/)
    assert.match(jmx, /__P\(response_timeout_ms,5000\)/)
    assert.match(jmx, /Primary Spin Must Return 2xx/)
  })

  test('runner generates JTL and optionally generates JMeter HTML dashboard', () => {
    assert.match(runner, /"-l", \$jtl/)
    assert.match(runner, /\[switch\]\$NoHtmlReport/)
    assert.match(runner, /if \(\-not \$NoHtmlReport\)/)
    assert.match(runner, /\$jmeterArgs \+= @\("-e", "-o", \$htmlDir\)/)
  })

  test('analyzer enforces P99 under 500ms and zero 5xx', () => {
    assert.match(analyzer, /p99 < 500/)
    assert.match(analyzer, /fiveXx\.length === 0/)
  })

  test('gate mode binds to declared capacity (D1-final, 2026-07-18)', () => {
    assert.match(analyzer, /DECLARED_CAPACITY/)
    assert.match(analyzer, /resilienceMode/)
    assert.match(analyzer, /successRate >= minAcceptedSuccess/)
    assert.match(analyzer, /shed\.length === 0/)
    assert.doesNotMatch(analyzer, /MAX_429_RATIO/)
    assert.match(runner, /\[int\]\$TargetRps = 0/)
    assert.match(runner, /\$effectiveTargetRps = if \(\$TargetRps -gt 0\) { \$TargetRps } else { \$Threads }/)
    assert.match(runner, /"-Jtarget_rps=\$effectiveTargetRps"/)
    // runner passes the offered load level to analyzer, decoupled from generator thread count.
    assert.match(runner, /\$env:DECLARED_CAPACITY = \$DeclaredCapacity/)
    assert.match(runner, /\$env:THREADS = \$effectiveTargetRps/)
  })

  test('report documents the real contract and records measured results honestly', () => {
    // 報告須對齊真實契約，並以實測數據記錄結果（AGENTS.md §12：不得捏造 P99）。
    assert.match(report, /POST \/api\/v1\/game\/slot\/spin/)
    assert.match(report, /冪等鍵由伺服器端生成/)
    assert.match(report, /Measured Results/)
    // 帳務不變量（overdraw / 冪等）在實測中為 PASS。
    assert.match(report, /Wallet overdraw \| 0 \| 0 \| \*\*PASS\*\*/)
  })
})
