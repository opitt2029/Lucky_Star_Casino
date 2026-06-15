import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')
const sql = readFileSync(resolve(root, 'tests/performance/accounting-reconciliation.sql'), 'utf8')
const runner = readFileSync(resolve(root, 'tests/performance/run-accounting-reconciliation.ps1'), 'utf8')

describe('T-091 accounting reconciliation contract', () => {
  test('compares wallets.balance with signed wallet_transactions totals', () => {
    assert.match(sql, /wallet_balance_matches_transaction_sum/)
    assert.match(sql, /FROM wallets w/)
    assert.match(sql, /FULL OUTER JOIN transaction_rollup/)
    assert.match(sql, /WHEN type = 'DEBIT' THEN -amount/)
    assert.match(sql, /WHEN type IN \('CREDIT', 'BONUS'\) THEN amount/)
  })

  test('checks latest balance, negative balances, and frozen balances', () => {
    assert.match(sql, /wallet_balance_matches_latest_transaction/)
    assert.match(sql, /negative_wallet_balances/)
    assert.match(sql, /nonzero_frozen_amounts/)
    assert.match(sql, /frozen_amount <> 0/)
    assert.match(sql, /frozen_amount_exceeds_balance/)
  })

  test('detects transaction-chain and idempotency anomalies', () => {
    assert.match(sql, /transaction_delta_mismatches/)
    assert.match(sql, /transaction_chain_breaks/)
    assert.match(sql, /duplicate_idempotency_keys/)
    assert.match(sql, /GROUP BY idempotency_key/)
  })

  test('runner executes psql in CSV mode and writes reports', () => {
    assert.match(runner, /--csv/)
    assert.match(runner, /ON_ERROR_STOP=1/)
    assert.match(runner, /footer=off/)
    assert.match(runner, /accounting-reconciliation\.csv/)
    assert.match(runner, /accounting-reconciliation-report\.md/)
  })

  test('runner fails when any violation count is non-zero', () => {
    assert.match(runner, /violation_count/)
    assert.match(runner, /\[int64\]\$_\.violation_count -ne 0/)
    assert.match(runner, /T-091 accounting reconciliation failed/)
  })
})
