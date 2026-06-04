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

  test('targets the planned slot spin endpoint', () => {
    assert.match(jmx, /__P\(spin_path,\/api\/v1\/game\/spin\)/)
  })

  test('loads distinct player credentials without recycling', () => {
    assert.match(jmx, /playerId,accessToken/)
    assert.match(jmx, /<boolProp name="recycle">false<\/boolProp>/)
    assert.match(jmx, /<boolProp name="stopThread">true<\/boolProp>/)
  })

  test('replays the same idempotency key and verifies the duplicate', () => {
    assert.match(jmx, /01 Primary Slot Spin/)
    assert.match(jmx, /02 Duplicate Slot Spin Same Idempotency Key/)
    assert.match(jmx, /Idempotency verification failed/)
  })

  test('checks wallet balances for overdraw', () => {
    assert.match(jmx, /03 Wallet Balance Must Stay Non-Negative/)
    assert.match(jmx, /Overdraw detected/)
  })

  test('sets finite HTTP timeouts and rejects non-2xx responses', () => {
    assert.match(jmx, /__P\(connect_timeout_ms,2000\)/)
    assert.match(jmx, /__P\(response_timeout_ms,5000\)/)
    assert.match(jmx, /Primary Spin Must Return 2xx/)
  })

  test('runner generates JTL and JMeter HTML dashboard', () => {
    assert.match(runner, /-l \$jtl/)
    assert.match(runner, /-e/)
    assert.match(runner, /-o \$htmlDir/)
  })

  test('analyzer enforces P99 under 500ms and zero 5xx', () => {
    assert.match(analyzer, /p99 < 500/)
    assert.match(analyzer, /fiveXx\.length === 0/)
  })

  test('report honestly records current execution blockers', () => {
    assert.match(report, /NOT EXECUTED/)
    assert.match(report, /T-032/)
  })
})
