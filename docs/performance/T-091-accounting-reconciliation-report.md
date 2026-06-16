# T-091 Accounting Reconciliation Report

## Status

**EXECUTED — 2026-06-16.** Reconciliation ran against the live PostgreSQL write store **after** the T-090 1,000-player load test (~25k slot spins). All checks passed with **zero violations**.

## How it ran

```bash
# 對齊 runner 的查詢（psql -X --csv -P footer=off）；本機以容器內 psql 直跑：
docker exec -i lucky-star-postgres psql -X -v ON_ERROR_STOP=1 --csv -P footer=off \
  -U lucky_user -d lucky_star_casino -f - < tests/performance/accounting-reconciliation.sql
```

正式路徑為 `./tests/performance/run-accounting-reconciliation.ps1`（需本機安裝 psql client）；
本機改以容器內 psql 執行同一份 `tests/performance/accounting-reconciliation.sql`，結果等價。

## Result: **PASS**

| Check | Violations | Result | Description |
|---|---:|---|---|
| duplicate_idempotency_keys | 0 | PASS | nonnull `wallet_transactions.idempotency_key` values must be unique |
| frozen_amount_exceeds_balance | 0 | PASS | `wallets.frozen_amount` must never exceed `wallets.balance` |
| negative_wallet_balances | 0 | PASS | `wallets.balance` must never be negative |
| nonzero_frozen_amounts | 0 | PASS | all `wallets.frozen_amount` must be zero after the pressure test |
| transaction_chain_breaks | 0 | PASS | each player transaction `balance_before` must continue from the previous `balance_after` |
| transaction_delta_mismatches | 0 | PASS | each transaction `balance_after` = `balance_before` ± `amount` by type |
| transactions_without_wallet | 0 | PASS | every transaction `player_id` must have a `wallets` row |
| wallet_balance_matches_latest_transaction | 0 | PASS | `wallets.balance` = latest `wallet_transactions.balance_after` when transactions exist |
| wallet_balance_matches_transaction_sum | 0 | PASS | `wallets.balance` = first `balance_before` + signed transaction amounts |

## Interpretation

The T-090 run drove the gateway into heavy overload (≈80% of requests at 1,000 concurrent were shed as HTTP 503 by the circuit breakers — see the T-090 report). The decisive finding is that **this overload never corrupted money**:

- **No overdraft** — `wallets.balance` never went negative despite concurrent debits on the same players (CSV recycling means multiple JMeter threads hit the same player). The `@Version` optimistic lock rejected conflicting writes rather than allowing a double-spend.
- **No double-debit** — every non-null `idempotency_key` is unique; the server-side idempotency key (`slot-bet-<roundId>` / `slot-win-<roundId>`) plus the `wallet_transactions.idempotency_key` UNIQUE constraint held.
- **Ledger reconciles exactly** — `wallets.balance` equals both the latest transaction's `balance_after` and the running signed sum from the first `balance_before`; the per-player chain is contiguous with no gaps.

In other words, under saturation the system **degrades safely** (load-shed via circuit breaker / rate limit) instead of producing inconsistent balances. This is the property T-091 is meant to guarantee, and it holds.

## Reproduce

```powershell
# 1) 跑 T-090 產生帳務流量（見 docs/performance/T-090-load-test-report.md）
# 2) 對帳：
.\tests\performance\run-accounting-reconciliation.ps1
# 任一 check 的 violation_count != 0 → runner 以非零碼結束並標記 FAIL。
```
