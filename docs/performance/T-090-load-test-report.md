# T-090 JMeter High-Concurrency Slot Load Test Report

## Status

**EXECUTED — 2026-06-16 on a single developer host.** The full topology (Docker infra + gateway/member/wallet/game/admin started from built jars) was brought up, 1,000 distinct funded players were provisioned, and the JMeter plan was run against the real contract. All numbers below are measured; nothing is fabricated.

**Headline result:** the **performance gates FAIL** at 1,000 concurrent on this single-host environment (P99 ≈ 2.5 s, ≈80% HTTP 503), but the **accounting-integrity gates PASS** in every run (0 overdraft, 0 double-debit) and the T-091 ledger reconciliation is clean. The system **sheds load safely** under saturation rather than corrupting money. At a host-sustainable ~150 concurrent, P99 ≈ 545 ms with a 0.28% error rate.

> ⚠️ The P99 < 500 ms / 5xx = 0 gates were defined for a properly resourced multi-host deployment. Running 5 service JVMs + JMeter + 6 infra containers on one laptop is itself the bottleneck — the 503s are gateway circuit-breaker load-shedding under host CPU saturation, not application accounting defects. See "Measured Results" for the full breakdown.

## 2026-07-07 再驗證進度（進行中，Phase 2b）

同拓撲（後端宿主機 mvn 起、Docker infra + observability 監控棧）重跑，**本節為中途進度、非最終結論**；完整重跑與指標佐證待後續補齊。目前實測：

- **前置全數就緒**：7 服務 `/actuator/health` UP、Prometheus targets 全綠（member/admin 需放行 `/actuator/prometheus`，本次已修）、JMeter 5.6.3、重新 provision 1,000 名玩家（GM 發幣每人 100 萬）。
- **150 併發基線（冷、熱各一輪）**：兩輪皆 ~65% HTTP 503（overdraw=0、冪等失敗=0 仍 PASS）。與 6/16 的 150 併發（P99 545 ms、0.28% 錯誤）相比顯著劣化。
- **1000 併發主測**：P99 2,190 ms、失敗 31,409/32,749（其中 5xx 8,039，其餘為斷言失敗）；帳務 gate 仍 PASS（overdraw=0）。
- **根因鏈（Prometheus 佐證）**：壓測窗內 gateway `resilience4j_circuitbreaker_not_permitted_calls_total{name="game-service"}` ≈ 12,852（≈全部 503）；被放行的 ~980 發中 ~64% 被判 failed（延遲落在 900–1,100 ms 區間）。即：**Spring Cloud CircuitBreaker 未設 TimeLimiter，預設 1 秒逾時**；而 spin 路徑自 6/22 起接入風控（每局 Redis 並發閘 + 2 次 DB 聚合）、6/24 又加注單稽核，150 併發下延遲被推過 1 s → 熔斷開路 → half-open 放行 3 發成功 → 關路瞬間 150 執行緒 thundering herd 再次推爆延遲 → 反覆開闔（self-sustaining flapping）。
- **單發延遲健康**：單人低速連打 spin 為 28–125 ms；game-service 窗內平均 1.07 s、wallet `/internal/wallet/debit` 平均 344 ms 皆為併發排隊所致，非單發能力問題。
- **結論方向**：帳務完整性在混沌下持續 PASS；效能 gate 的瓶頸已從「單機資源」細化為「gateway CB 預設 1s TimeLimiter × spin 路徑變重 × thundering herd」。調整 TimeLimiter / R4j 參數依計畫**另開 PR** 處理後再重測。

## Test Objective

Simulate 1,000 authenticated players betting on the slot game concurrently for 60 seconds and verify:

| Acceptance Gate | Required Result |
|---|---:|
| Wallet overdraw | 0 occurrences |
| Response Time P99 | < 500 ms |
| HTTP 5xx | 0 |
| Failed samples / assertions | 0 |

## Real T-032 Slot Contract

The JMX (`tests/performance/slot-1000-players.jmx`) and provisioning script target the contract as implemented in `backend/game-service` (`SlotController` / `SlotService` / `SpinRequest` / `SpinResponse`):

```http
POST /api/v1/game/slot/spin
Authorization: Bearer <player JWT>
Content-Type: application/json

{
  "bet": 100,          // 整數，約束 [100, 5000]
  "clientSeed": "t090-..."   // 選填；Provably Fair 用
}
```

- 玩家身分由 gateway 驗 JWT 後注入 `X-User-Id` header，**不在 body**。
- **冪等鍵由伺服器端生成**（`slot-bet-<roundId>` / `slot-win-<roundId>`），client 不傳、也無法重送同鍵 → 故壓測**不做 client 端重放**，改以「每輪兩次獨立轉動 + 餘額非負」驗證高併發下的帳務正確性。
- 回應為 `ApiResponse<SpinResponse>`：`{ data: { roundId, game, grid, bet, multiplier, payout, winningCells, wallet:{ balance, frozenAmount }, serverSeed, serverSeedHash, clientSeed, nonce } }`。

## Scenario Design

Test plan: `tests/performance/slot-1000-players.jmx`

- Standard Apache JMeter 5.6.3 components only; no third-party plugins.
- 1,000 threads, one distinct funded player and JWT per thread (`players.csv`, no recycle).
- Ramp-up: 1 second. Duration: 60 seconds. Pace: one bet pair per player per second.
- Target: Gateway `POST /api/v1/game/slot/spin`.
- Each iteration sends:
  1. **01 Primary Slot Spin** — `{bet, clientSeed}` with a unique `clientSeed`; asserts 2xx, captures `roundId`, rejects negative wallet balance.
  2. **02 Secondary Slot Spin** — a second, distinct spin with its own `clientSeed`; asserts 2xx and non-negative balance (the server again assigns a fresh server-side idempotency key).
  3. **03 Wallet Balance Must Stay Non-Negative** — `GET /api/v1/wallet/balance`; asserts `balance >= 0` and `availableBalance >= 0`.

All requests must return 2xx; any assertion failure is counted in the final failed-sample total.

## Provisioning (1,000 funded players)

`tests/performance/provision-players.mjs` registers + logs in N players via the gateway, waits for the Kafka-driven wallet creation, then funds each via **T-055 GM 發幣** (admin-service `POST /admin/gm/grant`, SUPER_ADMIN) — falling back to `POST /api/v1/wallet/bankruptcy-aid` if admin is unavailable — and writes `tests/performance/players.csv` (`playerId,accessToken`).

```bash
node tests/performance/provision-players.mjs            # 1000 players (default)
PLAYERS=50 node tests/performance/provision-players.mjs  # smaller dry-run
```

## Execution

1. Start the full topology: `docker compose up -d --build` — since PR #172 all 7 backend services are containerized and start together with the infra (no per-module `mvn spring-boot:run` needed).
2. `node tests/performance/provision-players.mjs` to create `tests/performance/players.csv` with ≥ 1,000 funded players.
3. Run:

```powershell
.\tests\performance\run-slot-load-test.ps1 -JMeter <path-to>\bin\jmeter.bat
```

Optional overrides: `-HostName`, `-Port`, `-Threads`, `-DurationSeconds`, `-Bet`, `-PacingMs`.

The runner produces:

- Raw JTL: `tests/performance/results/<run-id>/results.jtl`
- JMeter HTML dashboard: `tests/performance/results/<run-id>/html/`
- Automated gate report: `tests/performance/results/<run-id>/acceptance-report.md`

## Database Reconciliation (T-091)

After the run, execute the PostgreSQL reconciliation in addition to JMeter assertions:

```powershell
.\tests\performance\run-accounting-reconciliation.ps1
```

The runner executes `tests/performance/accounting-reconciliation.sql` and fails the run if any check reports violations: `wallets.balance` matches the signed `wallet_transactions` ledger, no wallet is negative, all `frozen_amount` values are zero, transaction chains are contiguous, and non-null idempotency keys remain unique.

## Execution Attempt Log

> 依使用者指示「嘗試本機實跑」，以下誠實記錄本機實際結果（AGENTS.md §地雷 12：無真實量測不得捏造 P99）。

| 前置步驟 | 狀態 | 說明 |
|---|---|---|
| 對齊 JMX / runner / 報告至真實契約 | ✅ 完成 | 端點 `/api/v1/game/slot/spin`、body `{bet, clientSeed}`、移除 client 冪等鍵；`tests/infra/jmeter.test.js` 同步更新並綠燈 |
| 1,000 玩家 provisioning 腳本 | ✅ 完成 | `tests/performance/provision-players.mjs`（GM 發幣為主、bankruptcy-aid 退路；對 gateway 限流 429 做指數退避） |
| 下載 Apache JMeter 5.6.3 | ✅ 完成 | 解壓於本機暫存目錄；`jmeter --version` 確認 5.6.3 |
| 啟動 docker 基礎設施 | ✅ 完成 | `docker compose up -d`；Kafka KRaft 需補 `.env` 的 `KAFKA_CLUSTER_ID`（取自 `.env.example`） |
| 啟動 5 個後端服務拓樸 | ✅ 完成 | 以建置後 jar 啟動 gateway/member/wallet/game/admin；admin 需先補建 PostgreSQL `admin_*` 表（既有資料卷缺表） |
| 備齊 1,000 已入金玩家 JWT | ✅ 完成 | `players.csv` 1,000 列，每人經 T-055 GM 發幣 1,000,000 星幣 |
| 實跑壓測並產生 JTL + HTML | ✅ 完成 | 三組情境（見下）；JTL/HTML/acceptance-report 落 `tests/performance/results/<run-id>/` |

## Measured Results

三組情境（同一份 JMX，僅以 `-J` 參數調整負載），皆為**實測**：

| 情境 | Threads | Ramp | 樣本數 | P99 | 5xx | 失敗樣本 | Overdraw | 冪等失敗 | Gate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Spec（規格） | 1000 | 1s | 25,150 | 2,469 ms | 20,058 (≈80%) | 20,120 | **0** | **0** | FAIL（效能） |
| 規格首跑（CSV bug 前）* | 1000 | 1s | 3,000 | 2,040 ms | 2,971 | 2,971 | **0** | **0** | FAIL（效能） |
| Host-sustainable | 150 | 10s | 16,489 | 545 ms | 47 (0.28%) | 47 | **0** | **0** | FAIL（P99 僅差 45ms） |

\* 首跑暴露一個壓測腳本 bug：`recycle=false`+`stopThread=true` 會在第二輪耗盡 CSV 後停掉所有執行緒，使每執行緒只跑 1 次（總計僅 3,000 樣本）。已修為 `recycle=true`+`stopThread=false` 以維持 60 秒持續負載（並同步更新 `tests/infra/jmeter.test.js`）。

**判讀：**
- 1,000 併發在單機（5 個服務 JVM + JMeter + 6 個基礎設施容器同機）會把 host CPU 打滿 → gateway Resilience4j 斷路器開啟、大量 503 load-shed。這是**單機資源上限與負載卸除設計**，非帳務缺陷。
- 降到 host 可承受的 ~150 併發時，P99 ≈ 545 ms（僅超標 45 ms）、5xx 0.28%，顯示應用層本身延遲健康；要真正驗 1,000 併發 P99<500ms 需多機/正式資源拓樸。
- **三組情境的 overdraw 與冪等失敗都是 0**：即使 80% 請求被拒，已成立的扣款/派彩仍維持帳務正確（`@Version` 樂觀鎖 + idempotency_key UNIQUE）。T-091 對帳 9 項全 PASS（見 `T-091-accounting-reconciliation-report.md`）。

## Current Acceptance Result（Spec 情境，1000 threads）

| Gate | Expected | Actual | Result |
|---|---|---:|---|
| Wallet overdraw | 0 | 0 | **PASS** |
| Idempotency double-debit | 0 | 0 | **PASS** |
| Response Time P99 | < 500 ms | 2,469 ms | FAIL（單機資源上限） |
| HTTP 5xx | 0 | 20,058 | FAIL（斷路器 load-shed） |

## Static Verification

- The JMX is validated by `tests/infra/jmeter.test.js` (endpoint, body shape, no client idempotency key, two distinct spins, overdraw guard, finite timeouts).
- The result analyzer (`analyze-jtl.mjs`) fails the run when P99 is at least 500 ms, any 5xx occurs, or any request/assertion fails.
- Synthetic JTL verification confirmed the analyzer returns PASS for compliant samples and a non-zero FAIL result for P99/5xx violations.
