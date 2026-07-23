# T-090 wallet outbox 修正驗證（SUT 自壓 A/B，2026-07-23）

> 對應：[`T-090-遠端施壓機壓測報告-20260723`] §3~§5 診斷與 CHANGELOG `[perf] 2026-07-23`。
> 修正檔：`WalletOutboxPoller.java`（逐筆同步 `.get()` → 整批平行 ack）、
> `WalletOutboxRepository.java`（批次可調）、`application.yml`（batch-size=500、poll-interval 1000→200ms）。

## 這份驗證的定位（先講清楚，避免誤用）

- **在 SUT 本機自壓（co-located）**：施壓器與 7 個服務同機競爭 CPU，**容量/spins-per-sec 數字不可對外引用**。
  這正是原報告分機壓測想避開的干擾；本輪目的**不是**量容量天花板。
- **驗證標的＝修正的「機制主張」**：舊 code 的 `wallet_outbox_pending_events` 會在寫入負載下無限累積、
  排空遠慢於需求；新 code 應維持接近 0、且快速排空。用**同一支施壓器**對舊/新 code 各跑一輪做 A/B，
  比較才乾淨。
- **施壓器**：`scratchpad/outbox-smoke.mjs`（node 併發打 `POST /api/v1/game/slot/spin`，
  每秒讀 `/actuator/prometheus` 取 `wallet_outbox_pending_events`；負載結束後續量到歸零測排空時間）。
  玩家：`players-smoke100.csv`（100 名，臨壓前刷新 token）。
- **注意 gauge 粒度**：`WalletOutboxMetrics` 每 **15s** 才把 `countByStatus(PENDING)` 寫進 gauge
  （AGENTS.md 雷區 25），故 PENDING 時序是 15s 級快照、排空時間精度到 ~15s，不是連續值。

## A/B 結果

參數：兩輪皆 `60s 負載 × 80 併發`，`bet=100`。

| 指標 | A（舊 code，修正前 image） | B（新 code，修正後 image） |
|---|---:|---:|
| spins（ok / err） | 25,059（24,438 / 621） | 20,722（20,197 / 525） |
| 約略 spins/s | 418 | 345 |
| **outbox PENDING 峰值** | **26,285** | **189** |
| PENDING 負載結束當下 | 21,122 | 90 |
| **排空歸零耗時** | **never（>120s 觀察窗未歸零，實測排空率 ~80/s）** | **9s** |

**額外佐證**：部署新 image 的瞬間，DB 還積著舊 code 遺留的 **10,635 筆 PENDING**；新 code 在
**一個 gauge 刷新週期內（≤12s）** 全部清空——同量級積壓舊 code 排 130s 都排不完。

### PENDING 時序（節錄）

- A（舊）：`0 → 912 → 7,271 → 13,868 → 21,122（負載結束）→ 峰值 26,285`，之後以 ~80/s 緩降，
  t=181s 仍有 16,935。**單調累積、排不動**。
- B（新）：全程在 `0 → 189 → 149 → 98 → 90` 低檔徘徊（poller 追平產生速率、淨累積 ≈ 0），
  負載一停 **9s 歸零**。

## 帳務一致性（T-091）

負載前、後各跑一次 `run-accounting-reconciliation.ps1`，**兩次皆 9/9 PASS**：冪等鍵唯一、無負餘額、
無超凍結、餘額鏈連續、delta 正確、餘額＝最新流水/流水總和。**outbox 積壓與本次修正未造成任何帳務不一致。**
（報告：`tests/performance/results/accounting-20260723-141653`、`accounting-20260723-143228`）

## 資源（co-located，僅供旁證、不對外引用）

docker stats（% 以 100%=1 核）：A 輪 game 峰值 ~398%、wallet ~216%；B 輪 wallet ~474%、game ~243%；
postgres/gateway 皆 ~100–120%。多核皆在動，但**瓶頸是 poller 的結構吞吐（~100/s）非 CPU 飽和**，
與原報告「真實遠端輪 SUT CPU 有餘裕」一致。
CSV：`docs/performance/assets/sut-docker-stats-A-oldcode-*.csv`、`...-B-newcode-*.csv`。

## 結論與後續

- **修正機制成立**：outbox PENDING 不再累積（峰值降 ~140×）、排空從「排不完」變 9s。對應原報告 §5
  驗收的「`[quiesce]` 不再逾時、PENDING 不再跨階累積」。
- **仍需分機正式驗容量**：本輪 co-located 無法給出可對外引用的容量天花板；`502` 錯誤兩輪一致
  （~490，與 outbox 無關，係自壓搶 CPU 下 game→wallet/gateway 產物）。真正的容量天花板與
  「請求路徑延遲 vs outbox」因果，仍須照原報告 §5 由 LG（`10.0.102.42`）分機重跑階梯確認。
- **表基線 row count（起點，補原報告 §2.1 缺口）**：`wallets=6,544`、`wallet_transactions=447,451`、
  `wallet_outbox=446,487`、`game_rounds=333,027`、`PENDING=0`（壓測前量測）。
