# T-090 JMeter High-Concurrency Slot Load Test Report

## Status

**NOT EXECUTED as of 2026-06-04.**

The pressure-test plan and automated acceptance report tooling are complete, but producing real performance measurements is currently blocked by:

- T-032 `POST /api/v1/game/spin` is not implemented; Game Service still contains only its application bootstrap.
- Apache JMeter is not installed in the current environment.
- Docker Desktop daemon is not running, so the complete local service topology cannot be started.
- A funded credential file containing 1,000 distinct players is not available.

No P99, throughput, or error-rate values are fabricated in this report.

## Test Objective

Simulate 1,000 authenticated players betting on the slot game concurrently for 60 seconds and verify:

| Acceptance Gate | Required Result |
|---|---:|
| Wallet overdraw | 0 occurrences |
| Duplicate idempotency key | No duplicate debit; duplicate response identifies the original result |
| Response Time P99 | < 500 ms |
| HTTP 5xx | 0 |

## Scenario Design

Test plan: `tests/performance/slot-1000-players.jmx`

- Standard Apache JMeter 5.6.3 components only; no third-party plugins.
- 1,000 threads, one distinct funded player and JWT per thread.
- Ramp-up: 1 second.
- Duration: 60 seconds.
- Pace: one bet pair per player per second.
- Target: Gateway `POST /api/v1/game/spin`.
- Expected steady load: about 1,000 primary bets/sec, 1,000 duplicate-verification spins/sec, and 1,000 wallet balance checks/sec.
- Each iteration sends:
  1. A primary slot spin with a unique `idempotencyKey`.
  2. The same request again with the same `idempotencyKey`.
  3. `GET /api/v1/wallet/balance` and asserts `balance >= 0` and `availableBalance >= 0`.

The duplicate request must either return `idempotent=true` or return the same `roundId`, `transactionId`, or `id` as the primary request. All requests must return 2xx; any assertion failure is included in the final failed-sample count.

## Assumed T-032 Contract

Until T-032 is implemented, the JMX uses the following planned contract:

```http
POST /api/v1/game/spin
Authorization: Bearer <player JWT>
Content-Type: application/json

{
  "betAmount": 10,
  "clientSeed": "t090-...",
  "idempotencyKey": "t090-slot-..."
}
```

The response must expose an identity field (`roundId`, `transactionId`, or `id`) and should expose `idempotent=true` on duplicate requests. T-032 must propagate the client idempotency key to Wallet Service for the database UNIQUE constraint to protect the debit.

## Execution

1. Install Apache JMeter 5.6.3 and start the full Gateway, Game, Wallet, PostgreSQL, Redis, and Kafka topology.
2. Create `tests/performance/players.csv` from `players.csv.example` with at least 1,000 funded players and valid JWTs.
3. Run:

```powershell
.\tests\performance\run-slot-load-test.ps1
```

Optional target overrides:

```powershell
.\tests\performance\run-slot-load-test.ps1 `
  -HostName localhost `
  -Port 8080 `
  -Threads 1000 `
  -DurationSeconds 60 `
  -BetAmount 10
```

The runner produces:

- Raw JTL: `tests/performance/results/<run-id>/results.jtl`
- JMeter HTML dashboard: `tests/performance/results/<run-id>/html/`
- Automated gate report: `tests/performance/results/<run-id>/acceptance-report.md`

## Database Reconciliation

After the run, execute these PostgreSQL checks in addition to JMeter assertions:

```sql
SELECT COUNT(*) AS overdrawn_wallets
FROM wallets
WHERE balance < 0 OR frozen_amount < 0 OR frozen_amount > balance;

SELECT idempotency_key, COUNT(*) AS duplicate_count
FROM wallet_transactions
WHERE idempotency_key LIKE 't090-slot-%'
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
```

Both queries must return zero violations. If the Game Service transforms the client idempotency key, the reconciliation query must be adjusted to the final T-032 key format.

## Current Acceptance Result

| Gate | Actual | Result |
|---|---:|---|
| Wallet overdraw | Not measured | BLOCKED |
| Idempotency duplicate debit | Not measured | BLOCKED |
| Response Time P99 < 500 ms | Not measured | BLOCKED |
| HTTP 5xx = 0 | Not measured | BLOCKED |

## Static Verification

- The JMX is validated by `tests/infra/jmeter.test.js`.
- The result analyzer fails the run when P99 is at least 500 ms, any 5xx occurs, any request/assertion fails, idempotency verification fails, or an overdraw assertion fails.
- Synthetic JTL verification confirmed the analyzer returns PASS for compliant samples and a non-zero FAIL result for P99/5xx violations.
