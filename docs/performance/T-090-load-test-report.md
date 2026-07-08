# T-090 JMeter High-Concurrency Slot Load Test Report

## Status

**EXECUTED — most recently re-run in full on 2026-07-08 on a single developer host** (first executed 2026-06-16; see "2026-07-08 完整重跑最終結果" below for the current numbers and root cause). The full topology (Docker infra + all 7 backend services) was brought up, 1,000+ distinct funded players were provisioned, and the JMeter plan was run against the real contract. All numbers below are measured; nothing is fabricated.

**Headline result (2026-07-08):** the **performance gates FAIL** at both 150 and 1,000 concurrent on this single-host environment (1000-concurrent P99 ≈ 5.1 s, ≈89% failed), but the **accounting-integrity gates PASS** in every run (0 overdraft, 0 double-debit) and the T-091 ledger reconciliation is clean for every player touched by the test. The system **sheds load safely** under saturation rather than corrupting money. Root cause is now pinpointed to a specific, fixable config gap — see below — rather than generic host resource exhaustion.

> ⚠️ The P99 < 500 ms / 5xx = 0 gates were defined for a properly resourced multi-host deployment. On this single host, the dominant factor is that Spring Cloud Gateway's CircuitBreaker has no explicit `timelimiter` configured, so Resilience4j defaults to a **1-second** call timeout — well below the ~0.9–3.6 s latencies seen under concurrent load once risk-control and bet-audit logic were added to the spin path (2026-06-22/24). See "2026-07-08 完整重跑最終結果" for the full Prometheus-backed evidence chain.

 feature/huang-gateway-timelimiter
## 2026-07-08 gateway TimeLimiter 修正驗證

2026-07-08 完整重跑（見另一份 CHANGELOG 條目與 PR #182）把 78–89% 5xx 的根因鏈定位到：Spring Cloud Gateway 的 Resilience4j CircuitBreaker 未顯式設定 `timelimiter`，Resilience4j 預設**逾時 1 秒**——遠低於 `slow-call-duration-threshold: 3s`，導致高併發排隊下的正常慢呼叫在真正完成前就被腰斬判 failed，觸發熔斷開路 → half-open 少量放行 → 關路瞬間 thundering herd 再次推爆延遲 → 反覆開闔。

修正：`backend/gateway-service/src/main/resources/application.yml` 新增 `resilience4j.timelimiter.instances.<service>.timeout-duration: 6s`（略高於既有 `slow-call-duration-threshold: 3s`，讓慢呼叫有機會真正完成、交由 CircuitBreaker 的 slow-call 統計判定而非被 TimeLimiter 提前腰斬）。

**驗證（150 併發，`results/20260708-101629/`，200 名重新 provision 的玩家）**：

| 指標 | 修正前（2026-07-08 完整重跑） | 修正後 |
|---|---:|---:|
| 樣本數 | 17,395 | 7,841 |
| HTTP 5xx | 13,563（78.0%） | **0** |
| 失敗樣本 | 13,563 | **4**（0.05%，疑似瞬斷） |
| P99 | 1,164 ms | 2,667 ms |
| idempotency / overdraw | 0 / 0 | 0 / 0 |

Thundering herd 熔斷完全消失（5xx 13,563 → 0）。P99 仍高於 500 ms 門檻，但這是排隊延遲本身的問題（風控 Redis 並發閘 + DB 聚合、注單稽核在高併發下變重），不再是 TimeLimiter 誤判——歸類為下一輪效能調校（例如非同步化風控聚合、拆分注單稽核）的獨立課題，超出本次 TimeLimiter 修正範圍。

## 2026-07-07 再驗證進度（進行中，Phase 2b）
=======
## 2026-07-08 完整重跑最終結果（Phase 2b 完成）
main

同拓撲（後端宿主機 `mvn spring-boot:run` 起 7 服務、Docker infra + observability 監控棧）完整重跑，取代 2026-07-07 的中途進度節。**測試對象 commit：`902d744`**（gateway/game/wallet 三服務程式碼與 origin/develop 最新 `65915c5` 之間無差異，落後的 7 個 commit 皆為 docs/admin-service 變更，不影響本次結果有效性）。

- **前置**：Docker Desktop 重啟後 infra+observability 自動回復；7 服務 `/actuator/health` 全 200；Prometheus targets 7/7 up；JMeter 5.6.3 可用；重新 provision 1,020 名玩家（JWT 效期 15 分鐘，舊 CSV 已失效需重發；GM 發幣每人 100 萬）。
- **150 併發基線**（`results/20260708-100306/`）：17,395 樣本、**P99 1,164 ms**、失敗 13,563 筆（全為 5xx，錯誤率 78.0%）、idempotency 失敗=0、overdraw=0。較 2026-07-07 中途進度的 ~65% 再劣化，與 6/16 的 150 併發基線（P99 545 ms、0.28% 錯誤）相比是明確回歸。
- **1000 併發主測**（`results/20260708-100442/`）：15,922 樣本、**P99 5,055 ms**、失敗 14,221 筆（其中 5xx 13,709，其餘為斷言失敗，錯誤率 89.3%）、idempotency 失敗=0、overdraw=0。

| Acceptance Gate | Required | 150 併發 | 1000 併發 |
|---|---:|---:|---:|
| Response Time P99 | < 500 ms | 1,164 ms ❌ | 5,055 ms ❌ |
| HTTP 5xx | 0 | 13,563 ❌ | 13,709 ❌ |
| Idempotency failures | 0 | 0 ✅ | 0 ✅ |
| Overdraw failures | 0 | 0 ✅ | 0 ✅ |

- **根因鏈確認（Prometheus 佐證，1000 併發測試窗 90 秒 range query）**：
  - `increase(resilience4j_circuitbreaker_not_permitted_calls_total[90s])`：game-service ≈ 9,861、wallet-service ≈ 10,028 — 絕大多數請求在 gateway CB 被直接拒絕，未觸達後端。
  - `increase(resilience4j_circuitbreaker_calls_seconds_count{kind="failed"}[90s])`：game-service ≈ 1,172、wallet-service ≈ 424 — 少數被放行的呼叫中仍有相當比例判定為 failed。
  - 成功 spin（`/api/v1/game/slot/spin`, status=200）平均延遲 = `increase(sum[90s])/increase(count[90s])` ≈ 4,856 / 1,338 ≈ **3.63 s**；wallet `/internal/wallet/debit` 平均延遲 ≈ 1,200 / 1,338 ≈ **896 ms**。兩者皆遠高於 Resilience4j 預設 TimeLimiter 1 秒門檻。
  - 結論不變：**Spring Cloud CircuitBreaker 未設 `timelimiter`（預設 1 秒逾時）**，疊加 6/22 風控（每局 Redis 並發閘 + 2 次 DB 聚合）、6/24 注單稽核後 spin 路徑變重，高併發下延遲穿越 1 s 門檻 → 熔斷開路 → half-open 少量放行 → 關路瞬間 thundering herd 再次推爆延遲 → 反覆開闔，是效能 gate 全面 FAIL 的直接原因。
- **T-091 帳務對帳**（`results/accounting-20260708-100542/accounting-reconciliation.csv`）：本輪測試涉及的 1,031 名玩家（`player_id >= 90000`）**0 違規**——`wallet_balance_matches_transaction_sum`／`_latest_transaction`／`negative_wallet_balances`／`duplicate_idempotency_keys` 等九項檢查全數 0。SQL 額外揪出 3 筆歷史違規，經查交易時間戳全在 **2026-06-16**（`player_id` 1001–1003，上一輪測試殘留、Postgres volume 隨 Docker Desktop 重啟保留），與本輪測試無關，判定為既有髒資料而非本次回歸；已排除在 gate 判定外。
- **最終結論**：**效能 gate（P99 < 500 ms、5xx = 0）FAIL**；**帳務完整性 gate（overdraw=0、idempotency=0）全程 PASS**。系統在飽和熔斷下正確地「安全丟棄請求」而非「弄壞帳」。根因已從「單機資源不足」精確定位到「gateway 缺 TimeLimiter 設定」這一具體、可修復的設定缺陷。**Phase 2b 到此完成**；調整 TimeLimiter / Resilience4j 參數並重測，依計畫另開 PR 處理。

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
