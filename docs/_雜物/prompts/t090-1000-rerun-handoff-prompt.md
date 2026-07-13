# Handoff Prompt: T-090 1,000-Concurrent Full Rerun (Post TimeLimiter Fix)

Target repo: `D:\Lucky_Star_Casino\Lucky_Star_Casino\Lucky_Star_Casino`
Branch: `feature/huang-gateway-timelimiter` (includes 2026-07-08 gateway TimeLimiter fix, commit `49f1046`)

## Task

Run the **T-090 high-concurrency load test at 1,000 threads, full rerun**, to validate the gateway TimeLimiter fix at real spec-level concurrency (1,000), and honestly append the results to the report.

## Background (trust this, do not re-investigate)

- T-090 previously measured, at 1,000 concurrent, P99 ≈ 2.5s and ~80% HTTP 503. Root cause: Spring Cloud Gateway's Resilience4j CircuitBreaker had **no TimeLimiter configured, defaulting to a 1-second timeout** — far below `slow-call-duration-threshold: 3s`. Under high-concurrency queueing, normal slow calls got cut off as "failed" before they could actually finish, tripping the circuit breaker open → half-open lets a few through → the moment it closes, a thundering herd re-spikes latency → self-sustaining flapping.
- Fix already merged: `backend/gateway-service/src/main/resources/application.yml` now has `resilience4j.timelimiter.instances.<service>.timeout-duration: 6s`.
- Verified effective **at 150 concurrent**: 5xx dropped from 78% (13,563 samples) to **0**; failed samples dropped from 13,563 to 4 (0.05%). P99 is still 2,667 ms (gate: 500 ms), but that's queueing latency itself (risk-control Redis concurrency gate + DB aggregation, bet-slip audit getting heavier under load) — not circuit-breaker misfire. **You do not need to fix this in this run**, just record it honestly.
- **The 1,000-concurrent full rerun with this fix applied has not been executed yet** — that's exactly what you're doing now.
- Acceptance gates (from `docs/performance/T-090-load-test-report.md`):

  | Gate | Requirement |
  |---|---|
  | Wallet overdraw | 0 |
  | P99 | < 500 ms |
  | HTTP 5xx | 0 |
  | Failed samples/assertions | 0 |

  **The accounting-integrity gates (overdraw, double-debit) have been 0 in every historical run — this is the hard floor that must not regress.** The performance gates (P99, 5xx) are known to currently FAIL or partially FAIL — record honestly, do not adjust test conditions just to make the numbers look better.

## Known environment pitfalls (copy these, don't rediscover them)

1. **No `mvnw`** — use the system `mvn`.
2. **`.env` has CRLF line endings**: if you load env vars line-by-line via a Bash tool, values get a trailing `\r`, poisoning JDBC/Redis URLs (symptoms: Postgres driver rejects the URL, Redis `NXDOMAIN`). Always strip it when loading: `v="${v%$'\r'}"`.
3. **`start-all.bat` cannot open windows from a non-interactive agent shell** (it uses `start cmd /k`, which the agent shell can't spawn, though it still returns exit 0). To start services from an agent, use `run_in_background` to run each service's `mvn -pl backend/<svc> spring-boot:run` directly — or ask the user to start services via `start-all.bat` themselves and you just run the load test (if the user already started services manually, verify all 7 are listening via `Get-NetTCPConnection -LocalPort <port> -State Listen` before proceeding — don't restart and fight over ports).
4. **JMeter 5.6.3**: previously at `%TEMP%\apache-jmeter-5.6.3\bin\jmeter.bat`, but Temp gets cleaned by the system. Verify with `jmeter.bat --version` before running; if missing, re-download from `https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-5.6.3.zip` (~87MB) and unzip.
5. **`players.csv` JWTs expire**, and this is a fresh rerun — **re-run provisioning, do not reuse the old file**:
   ```bash
   node tests/performance/provision-players.mjs   # 1000 players, takes a few minutes
   ```
   This registers + logs in via the gateway, then funds each player via T-055 GM grant (1,000,000 coins each), falling back to `bankruptcy-aid` on failure.
6. **Background PowerShell sessions can lose cwd**: when invoking the load test script, use an **absolute path** for `-JMeter`, don't rely on relative paths.
7. The gateway has a per-player 1-second rate limit window on `/api/v1/game/**`, but the JMeter script pacing is already aligned to it — no extra handling needed; the provisioning script backs off automatically on 429s.

## Execution steps

1. **Confirm/start the full topology** (gateway 8080 / member 8081 / wallet 8082 / game 8083 / rank 8084 / admin 8086 / notification 8087 + Docker infra: Postgres 5433 / MySQL 3307 / Redis 6379 / Kafka 9092). Bring up Docker infra with `docker compose up -d` if needed. Start services per pitfall #3 if needed. Proceed only once all `/actuator/health` return UP.
2. **Re-provision 1,000 funded players** (pitfall #5).
3. **Run the 1,000-concurrent main test**:
   ```powershell
   .\tests\performance\run-slot-load-test.ps1 -Threads 1000 -JMeter <absolute-path-to-jmeter.bat>
   ```
   (Default ramp-up 1s, duration 60s per the existing JMX design — don't loosen ramp-up/threads just to pass gates.)
4. **Run accounting reconciliation**:
   ```powershell
   .\tests\performance\run-accounting-reconciliation.ps1
   ```
   Confirm all 9 T-091 reconciliation checks still PASS (0 overdraw, 0 double-debit idempotency, `wallets.balance` matches the ledger, no negative balances, `frozen_amount` all 0).
5. **If Prometheus is available** (a prior rerun had an observability stack attached), also capture, over the test time window:
   - `resilience4j_circuitbreaker_not_permitted_calls_total{name="game-service"}` (confirms whether circuit-breaker flapping is truly gone, not just masked)
   - `http_server_requests_seconds_{sum,count}` (per-service latency distribution, especially wallet debit and game spin)
   Skip this if no monitoring stack is running — don't stand one up just for this.
6. **Analyze results**: `results/<run-id>/acceptance-report.md` auto-generates a gate verdict; check the actual numbers against all four gates (overdraw / P99 / 5xx / failed samples).

## Deliverables (record honestly, never fabricate — this is explicit in AGENTS.md)

Add a new section to `docs/performance/T-090-load-test-report.md`, formatted like the existing "2026-07-08 gateway TimeLimiter 修正驗證" section, titled something like "## 2026-07-08 gateway TimeLimiter 修正驗證（1,000 併發完整重跑）", including:
- This run's sample count, HTTP 5xx, failed samples, P99, overdraw/idempotency-failure counts, listed individually, with a comparison table against the 150-concurrent run and the historical (pre-fix) 1,000-concurrent run.
- Verdict: whether circuit-breaker flapping is fully gone (5xx zeroed or drastically reduced), whether accounting gates still fully PASS, and how far P99 is from the 500ms gate and why (reuse the existing framing: risk-control Redis concurrency gate + DB aggregation, bet-slip audit getting heavier under load — categorize as out of scope for this fix, belongs to the next performance-tuning round).
- If there's still a meaningful failure rate, break down "5xx share" vs. "other assertion failures" separately — don't lump them into one number.

Also:
- Add an entry at the top of the root `./CHANGELOG.md` (`## [test] — 2026-07-08 — T-090 1,000-concurrent full rerun (post TimeLimiter fix)`), with Added/Changed sections, the rationale, and how it was verified.
- If `docs/plans/` has a T-090-related progress checklist (e.g. the 8-item architecture improvement roadmap), update its status marker (✅/⬜/🔶) per CLAUDE.md §4.
- After finishing, run `mvn -pl backend/gateway-service test` (if gateway config was touched) and the existing `node --test tests/infra/*.test.js` to confirm nothing else broke.
- **Do not push or open a PR** — finish locally and draft a commit message; leave push/PR to the user to review and run themselves (unless the user explicitly instructs otherwise in the moment).
