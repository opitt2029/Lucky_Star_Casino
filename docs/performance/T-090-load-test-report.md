# T-090 JMeter High-Concurrency Slot Load Test Report

## Status

**NOT EXECUTED as of 2026-06-05.**

The pressure-test plan and automated acceptance report tooling are complete. T-032 is now implemented (`backend/game-service`: `SlotController` / `SlotService`), so it is no longer a blocker. Producing real performance measurements is still blocked by:

- Apache JMeter is not installed in the current environment.
- Docker Desktop daemon is not running, so the complete local service topology cannot be started.
- A funded credential file containing 1,000 distinct players is not available.

**Contract drift to reconcile before execution:** the implemented endpoint differs from the contract this report originally assumed. The real endpoint is `POST /api/v1/game/slot/spin`; the request body is `{ "bet": <100..5000>, "clientSeed": "..." }`; and the idempotency key is derived server-side (`slot-bet-<roundId>` / `slot-win-<roundId>`) rather than supplied by the client. The JMX plan (`tests/performance/slot-1000-players.jmx`) and the "Assumed T-032 Contract" section below must be aligned to this real contract before the load test is run.

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

> ⚠️ Outdated: this is the contract the JMX was originally drafted against. T-032 is now implemented with a different shape (see the "Contract drift" note under Status). Update this section and the JMX before execution.

The JMX currently uses the following planned contract:

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

After the run, execute the T-091 PostgreSQL reconciliation in addition to JMeter assertions:

```powershell
.\tests\performance\run-accounting-reconciliation.ps1
```

The runner executes `tests/performance/accounting-reconciliation.sql` and fails the run if any check reports violations. It verifies that `wallets.balance` matches the signed `wallet_transactions` ledger, no wallet is negative, all `frozen_amount` values are zero, transaction chains are contiguous, and non-null idempotency keys remain unique.

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
