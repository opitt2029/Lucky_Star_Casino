# T-090 JMeter High-Concurrency Slot Load Test Report

## Status

**CLOSED — T-090 第二輪於 2026-07-18 E3 結案輪正式驗收通過**（結案後選配 B2 亦於同日完成並驗證，見最上方 B2 節）（D1-c 語意：150 併發全綠＝驗收 PASS（P99 377 ms）、1,000 併發韌性驗證 PASS（成功率 99.2%、帳務 0 違規）、T-091 乾淨，見最上方 E3 節；first executed 2026-06-16）. The full topology (Docker infra + all 7 backend services) was brought up, 1,000+ distinct funded players were provisioned, and the JMeter plan was run against the real contract. All numbers below are measured; nothing is fabricated.

**Headline result (2026-07-08):** the **performance gates FAIL** at both 150 and 1,000 concurrent on this single-host environment (1000-concurrent P99 ≈ 5.1 s, ≈89% failed), but the **accounting-integrity gates PASS** in every run (0 overdraft, 0 double-debit) and the T-091 ledger reconciliation is clean for every player touched by the test. The system **sheds load safely** under saturation rather than corrupting money. Root cause is now pinpointed to a specific, fixable config gap — see below — rather than generic host resource exhaustion.

> ⚠️ The P99 < 500 ms / 5xx = 0 gates were defined for a properly resourced multi-host deployment. On this single host, the dominant factor is that Spring Cloud Gateway's CircuitBreaker has no explicit `timelimiter` configured, so Resilience4j defaults to a **1-second** call timeout — well below the ~0.9–3.6 s latencies seen under concurrent load once risk-control and bet-audit logic were added to the spin path (2026-06-22/24). See "2026-07-08 完整重跑最終結果" for the full Prometheus-backed evidence chain.

## 2026-07-22 open-model 首測（User 機器）——#244 harness 修正後第一次實跑

> ⚠️ **這是 #244（P0~P6 harness 修正）合併後、換上 open-model（`PreciseThroughputTimer`，P1）的
> 第一次實測**，且在**全新的 User 機器**（≠ weiyu/Alex），故絕對延遲**與歷輪 377/390 ms 完全不可比**。
> 換 open-model 的意義正是：舊 closed-loop（`ConstantTimer`）會被後端回應時間自我節流、低估尾延遲；
> open-model 以排程無條件送出 offered load，才是誠實的施壓。**本輪即為該修正首次揭露的真相。**

環境快照：develop `938cd5c`（#244）、HikariCP postgres 寫池 **32**／MySQL 讀池 10（actuator 實測，已確認新 build）、
Postgres migration 補到 V17（`wallet_outbox` 等）、7 服務 health 200、Prometheus targets 7/7、
`prac-*` 偷資源容器已停。1,000 名已入金玩家（GM 發幣），正式輪前 `refresh-player-tokens` 臨發 token。

| 輪 | run-id | 模式 | 樣本（accepted/shed） | Accepted P99 | 成功率 | 5xx | 帳務(冪等/超扣) | 判定 |
|---|---|---|---|---:|---:|---:|---|---|
| 暖機（棄置） | `20260722-134459` | — | — | — | — | — | — | 丟棄 |
| **150 驗收** | `20260722-134638` | 驗收 | 18,210（5,582 / 12,628） | **1,427 ms** | 100% | 0 | 0 / 0 | ❌ **FAIL** |
| **1,000 韌性** | `20260722-134938` | 韌性 | 52,736（3,393 / 49,343） | 3,583 ms | 100% | 1 | 0 / 0 | ✅ **PASS** |

- **150 驗收輪 FAIL**：Accepted P99 1,427 ms（門檻 <500）＋ **429 卸載 69.3%**（宣告容量內不准卸載）兩道 gate 皆破。
  穩態 accepted 吞吐 ≈ 93 spin/s，遠低於「150/s offered」。→ **在誠實 open-model 下，先前宣告的「150 併發」
  不成立**。這與 #244 P1 的預期一致（closed-loop 低估尾延遲）。
- **1,000 韌性輪 PASS**：卸載 93.6% 之下，穿透請求 **accepted 成功率 100%、帳務 0 違規**——超載時 gateway 以 429
  快速卸載、不傷後端（優雅降級有效）。
- **1 個 5xx（502 Bad Gateway，UTC 05:50:01，1/3393＝0.03%）**：經查為**傳輸層瞬斷**，非 game-service 應用錯誤——
  game-service resilience4j circuit breaker `failed=0`、狀態 closed，gateway/game 該窗均無 ERROR log，且 T-091 對帳
  全乾淨（該筆未半途落庫）。研判為 gateway(Netty)↔game-service keep-alive 連線在高併發下被中途關閉／連線池重用競態。
  比例屬超載輪雜訊等級；若日後要壓，方向為調 gateway HttpClient 連線池（`maxIdleTime`／背景驅逐）。
- **T-091 九項對帳**：8 項全 0；唯一非零 `wallet_balance_matches_transaction_sum=3` 經查為 player **1001/1002/1003**
  （零交易種子錢包，§準備清單 §5 已知結構性誤報），**非本輪壓測新違規**。壓測玩家全部完美對平 → **實質 0 違規**。

### ⚠️ 必須誠實標註的方法學限制
1. **JMeter 與 SUT 同機（P3 未隔離）**：單機 12 核同時扛 JMeter（本輪 offered ~300–880 req/s）＋7 服務，JMeter 偷走的
   CPU 會**同時推高 P99、壓低 accepted 吞吐**。上表絕對數字是**同機悲觀下界，非乾淨容量**。本輪未跑 `sample-host-java-cpu.ps1`，
   無法量化 JMeter 這次偷了多少 CPU。要可對外引用的容量數字，須把 JMeter 移到獨立機器（或套 #244 §P3 cpuset 隔離）重測。
2. **open-model 每 iteration 兩支 spin sampler**：`target_rps=150` 實際 offered ≈ 300 req/s（總樣本 18,210/60s≈303/s），
   與舊 closed-loop「150 threads 自我節流」語意不同——這也是同一「150」在兩種方法學下水位落差的一部分。

**結論**：管線／帳務健康、韌性與降級機制有效；但「150 併發」在誠實 open-model＋同機條件下**未通過驗收**，
需在乾淨分機環境重測才能宣告可對外引用的容量。歷史 E3（closed-loop）377/390 ms 結論不受本節推翻，但
**本節重新開啟了容量宣告的問題**：兩種方法學的數字不可混用。

## 2026-07-18 B2 對照重跑（Alex 機器）——debit 往返 4→2 落地驗證

E3 結案後的選配收尾：B2（wallet debit 交易 DB 往返 4→2，條件 UPDATE RETURNING＋
ON CONFLICT 冪等寫入，commit `408261f`、PR #220 已併 develop）落地後的完整驗證輪。
設計與語意等價論證見 `T-090-B2-debit-roundtrip-design.md`，帳務新約定見 AGENTS.md 雷區 8。

> ⚠️ **跨機聲明**：本節全部輪次在 **Alex 機器**執行（≠ E3/凌晨輪的 weiyu 機器），絕對
> 延遲數字與歷輪 377/393 ms 不可比。本機自建 pre-B2 基線（develop `d8e576b`）＝494 ms，
> A/B 比較僅在本機內成立。服務全容器化（docker compose，PR #172 拓樸）。本機 debit
> 負載 ~240 筆/s 遠低於單機 Postgres 容量 550–600/s（DB 未飽和），故 debit 絕對值
> （~10 ms）遠小於歷輪飽和時的 194 ms；B2 差距在未飽和下仍成立但幅度較溫和。

### 150 併發同機 A/B（中午輪）——B2 P99 −21.7%

| 輪 | run-id | 版本 | Accepted P99 | 樣本 | 5xx/失敗/429 | debit 平均（Prometheus） |
|---|---|---|---:|---:|---|---:|
| 暖機（棄置） | `20260718-115442` | B2 | 1,300 ms | 17,138 | 0/0/0 | — |
| 過渡（棄置） | `20260718-115800` | B2 | 575 ms | 21,233 | 0/0/0 | 8.6 ms |
| **B2 正式** | `20260718-120058` | B2 | **387 ms（驗收模式全綠 PASS）** | 22,235 | 0/0/0 | **8.57 ms** |
| 暖機（棄置） | （FAIL 輪） | pre-B2 | 836 ms | — | — | — |
| **pre-B2 對照** | `20260718-120541` | develop `d8e576b` | **494 ms（PASS）** | 21,692 | 0/0/0 | **10.86 ms** |

**同機 A/B 結論：B2 讓 150 併發 P99 −21.7%（494→387 ms）、debit 平均 −21%、吞吐 +2.5%。**
帳務 gate（冪等/超扣）每輪全 0。外推（僅供參考、不作驗收依據）：以本機 A/B 比例外推
weiyu 機器 393 ms 基線 → 393×0.783 ≈ 308 ms，落在 250–350 目標帶內；需原機實測才能宣告。

### 晚間續跑（Docker 全重啟後）——150 確認輪全綠、水位可重現

服務拓樸整組冷啟（Docker Desktop 重啟、15 容器重拉），照 SOP 暖機棄置後回穩：

| 輪 | run-id | Accepted P99 | 判定 |
|---|---|---:|---|
| 暖機 1（棄置） | `20260718-191310` | 2,176 ms | 冷啟觸發 gateway CB（E1 時間窗版）快速拒絕 503×2,361，末 17 秒歸零自癒 |
| 暖機 2（棄置） | `20260718-191741` | 601 ms | 0 5xx、成功率 100%，僅頭 12 秒殘餘 429×4（過渡樣態） |
| **150 確認輪** | `20260718-192139` | **390 ms** | **驗收模式全綠 PASS**（22,701 樣本、0/0/0、帳務 0 違規）——與中午正式輪 387 ms 一致，**B2 水位可重現** |

> 註：整組冷啟後需 2 輪暖機才回穩（中午輪僅重建 wallet 容器、1 輪即穩）；冷啟期 503
> ＝CB 時間窗對慢啟動後端的正常快速失敗，自癒後不復現，非機制退化。

### 1,000 併發韌性輪（`20260718-192559`）——韌性模式 PASS

| 指標 | 實測 | 判定 |
|---|---:|---|
| 樣本數 | 38,927（accepted 27,848 / shed 11,079） | — |
| Accepted 成功率 | **99.7%** | **PASS（gate ≥95%）** |
| idempotency / overdraw | **0 / 0** | **PASS** |
| Accepted P99 | 1,554 ms | 趨勢，不設 gate |
| HTTP 5xx | 2（502） | 趨勢 |
| 429 shed 佔比 | 28.5% | 趨勢 |

殘餘 84 筆 accepted 失敗＝82 筆 `HttpHostConnectException`（1 秒 ramp-up 起跑連線風暴、
壓測機端工件，與 E3 輪同型態）＋2 筆 502。429 佔比高於 E3 輪的 11.6% 屬跨機容量差異
（本機吞吐 ~635/s vs weiyu 機 ~872/s，卸載更多是容量問題非機制問題），韌性模式不設 gate。

### T-091 對帳（`accounting-20260718-192939`）——0 新違規

9 項檢查 8 項 0；`wallet_balance_matches_transaction_sum` 的 3 筆＝player 1001–1003，
逐筆徹查確認為 **`database/postgres/seed_test_data.sql` 種子錢包**（開帳 10,000、交易數
0、`created_at=2026-07-07`）：檢查口徑對零交易錢包期望餘額 0，種子錢包必然報違規＝
**結構性誤報**，與歷輪「孤兒錢包」同源，非本輪產生。**0 筆新違規，PASS。**

> 環境更正 ×2：①交接紀錄稱本機 volume「當日新建」不準確——實查資料自 2026-07-07 起
> 即存在；②host `localhost:5433` 已被本機原生 `postgresql-x64-17` Windows 服務佔用
> （PG17 安裝時 5432 被 PG16 佔、預設選 5433，兩服務皆開機自啟），host psql 直連會打到
> 本機 PG 而非容器 → 對帳改以 `docker exec` 容器內 psql 執行（結果等價）。

### 結論——B2 選配收尾完成

1. **B2 驗證閉環**：150 同機 A/B −21.7% ＋ 重啟後全綠可重現（387/390 ms）＋ 1,000
   韌性 PASS（99.7%、帳務 0 違規）＋ T-091 乾淨。藍圖 03 B2 列 ✅。
2. debit 條件 UPDATE 新語意（不再拋 409 樂觀鎖）在兩種負載形態下均無帳務違規，
   雷區 8 新約定成立。
3. E3 結案結論不變；D1-b（DB 隔離）與 advisory① 仍為選配遺留。

## 2026-07-18 E3 最終驗收重跑（第二輪結案）

第二輪收殘局的結案輪，**首輪套用 D1-final 拍板語意**（2026-07-18 選 c，藍圖 03）：
宣告容量＝150 併發，150 輪走**驗收模式**（P99<500/5xx=0/失敗=0/429=0）、1,000 輪走
**韌性模式**（accepted 成功率 ≥95%＋帳務 0 違規；429/P99 只記趨勢）。gate 由改版
`analyze-jtl.mjs` 依 `THREADS` vs `DECLARED_CAPACITY` 自動判定（D2 落地）。

SOP 全程照準備清單：7 服務健檢 200 → provision（947/1,000 因 auth 限流 429 缺 53 名，
補量 provision 60 名合併為 1,007 列）→ **`refresh-player-tokens.mjs` 臨發 token**（1,007
名 6.4 秒，首次實戰）→ 暖機輪棄置（`20260718-103855`，P99 444 ms）→ 輪距 2.5 分
→ 150 正式輪 → 輪距 2.5 分＋再 refresh → 1,000 輪 → T-091。全程單機（同 07-18 凌晨輪
機器，與凌晨輪同機可比）。

### 150 併發正式輪（`20260718-104301`）——全綠（驗收模式 PASS）

| Gate | 門檻 | 實測 | 判定 |
|---|---:|---:|---|
| Accepted P99 | < 500 ms | **377 ms** | ✅ |
| HTTP 5xx / 失敗 / 429 | 0 / 0 / 0 | **0 / 0 / 0**（23,968 樣本，100% 成功） | ✅ |
| idempotency / overdraw | 0 / 0 | 0 / 0 | ✅ |

與凌晨輪（`031827`：P99 393 ms、23,927 樣本）同機對照：全綠**可重現**且 P99 再 −4%。
**D1-c 語意下，此輪＝T-090 正式驗收 PASS。**

### 1,000 併發（`20260718-104705`）——韌性驗證（韌性模式 PASS）

| 指標 | E1+E2 輪（`033439`，07-18 凌晨） | **E3 輪（`104705`）** |
|---|---:|---:|
| 樣本數 | 55,897 | 52,327（≈872/s） |
| 429 shed | 7,364（13.2%） | 6,061（**11.6%**，趨勢） |
| HTTP 5xx | 1（502） | **1（502）** |
| HTTP 401 | 1,113（JWT 到期工件） | **0（token 臨發生效，工件消滅）** |
| 失敗樣本（accepted） | 1,114 | 376（375 connect 例外＋1 502，見下） |
| Accepted 成功率 | 97.7% | **99.2%**（gate ≥95% PASS） |
| Accepted P99 | 976 ms | 894 ms（趨勢，不設 gate） |
| idempotency / overdraw | 0 / 0 | **0 / 0** |

殘餘 376 筆失敗的分桶與時間分佈：375 筆 `HttpHostConnectException` **全部集中在起跑
0–5 秒**（1 秒 ramp-up 拉起 1,000 執行緒的 TCP 連線風暴，單機 accept 佇列瞬時飽和），
之後整輪 0 連線失敗；另 1 筆 502。此為單機壓測環境工件（JMeter 與全部服務同機），
非服務端機制問題——與 D1-c「不在單機驗絕對容量」的定位一致，照韌性模式判成功率
（99.2% ≥ 95%）即可。

### T-091 對帳（本輪）

9 項檢查 **0 筆新違規**（`accounting-20260718-104929`；本機無 psql，照凌晨輪 SOP 以
`docker exec` 容器內 psql 執行）。`wallet_balance_matches_transaction_sum` 的 3 筆＝
已知 player 1001–1003 歷史孤兒錢包（balance=10000、0 交易、`updated_at=2026-07-13`），
逐筆查證與凌晨輪（`accounting-20260718-033833`）完全同批，非本輪產生。

### 結論——第二輪結案

1. **T-090 驗收閉環完成**：D1-c 語意下 150 全綠（正式驗收 PASS）＋ 1,000 韌性 PASS
   （成功率 99.2%、帳務 0 違規、卸載有序）＋ T-091 乾淨。第二輪藍圖 E1/E2/D1/D2/E3
   全部 ✅，**T-090 結案**。
2. 401 JWT 到期工件由 `refresh-player-tokens.mjs` 實戰驗證解決（1,113 → 0）。
3. 選配遺留（不阻塞結案）：B2（debit 往返 4→2，150 P99 已達標故降選配）、
   D1-b（DB 隔離實驗，需第二台機器）、advisory①（401/403 進 AIMD 窗，影響輕微）。
4. provisioning 的 auth 限流 429 缺額（947/1,000）以補量 provision 解決；如後續常跑
   可考慮在腳本內建「缺額自動補提」，暫不動（一次補量指令即可）。

## 2026-07-18 E1+E2（CB 時間窗＋AIMD 樣本排除）效果對照重跑

E1+E2 落地（PR #217）後的對照重跑：game/wallet CB 改 `TIME_BASED/10s/min-calls 20/slow-call 4s/90%`、game AIMD 延遲目標 2000→1500 ms（E1）；`doFinally` 只把「HTTP < 500 且非 429」樣本計入 AIMD 延遲窗（E2）。照 SOP：暖機輪棄置（`20260718-031423`，P99 1,599 ms 冷啟動樣態、0 失敗）→ 輪距 2.5 分鐘 → 150 正式輪 → 重新 provision 1,000 名（GM 發幣 1,000,000/人）→ 1,000 輪 → T-091 對帳。壓測前基線：wallets 2,656 / wallet_tx 36,454 / game_rounds 23,914。

> ⚠️ **歸因誠實聲明**：①本輪在**與 07-09 對照輪不同的機器**上執行（07-09 前的歷輪皆在隊友機器；本輪為本機首次完整實跑），絕對延遲數字跨機不可比，**機制性指標（503 歸零、CB 是否開路、卸載形態、成功率）才是本輪的有效讀數**；②E1+E2 同 PR 落地，效果不可拆分歸因；③本輪玩家由修正後的 provision 腳本正確入金 1,000,000/人（2026-07-17 夜的兩輪因發幣靜默失敗、玩家僅 1,000 元而全場 422 作廢，不列入對照）。

### 150 併發正式輪（`20260718-031827`）——**首次全綠**

| Gate | 門檻 | 實測 | 判定 |
|---|---:|---:|---|
| Accepted P99 | < 500 ms | **393 ms** | ✅ |
| HTTP 5xx | 0 | **0** | ✅ |
| 429 佔比（容量內要求 0） | 0% | **0%** | ✅ |
| 失敗樣本 | 0 | **0**（23,927 樣本） | ✅ |
| idempotency / overdraw | 0 / 0 | 0 / 0 | ✅ |

**T-090 中繼目標（150 併發全綠）首次達成**。與 07-09 輪（`20260709-161414`：P99 1,423 ms、10,258 樣本）對照：P99 −72%、吞吐 +133%——但跨機不可比（見聲明），僅記錄趨勢；全綠判定本身不受跨機影響（0 失敗/0 卸載/0 5xx 是機制性結果）。

### 1,000 併發（`20260718-033439`）——與 C3+B1 輪對照

| 指標 | C3+B1 後（`162358`，07-09） | **E1+E2 後（`033439`，07-18）** |
|---|---:|---:|
| 樣本數 | 28,759（464.6/s） | **55,897（≈973/s）** |
| 429 shed | 18,767（65.3%） | **7,364（13.2%）** |
| HTTP 5xx | 2,027（503×2,024＋502×3） | **1（502×1，503 歸零）** |
| gateway CB `not_permitted`（game） | ≈2,079 | **0（整輪未開路）** |
| client SocketTimeout | 136 | **0** |
| HTTP 401 | 0 | 1,113（**壓測工件**，見下） |
| Accepted P99 | 5,317 ms | 976 ms（跨機不可比，僅記錄） |
| Accepted 成功率 | 78.4% | **97.7%**（扣除 401 工件後 ≈100%：真實系統失敗僅 1 筆 502） |
| idempotency / overdraw | 0 / 0 | **0 / 0** |

**E1+E2 驗證通過的證據鏈**：

1. **503 桶 2,024 → 0，判準達成**：CB 整輪未開路（`not_permitted` = 0），卸載全部由 AIMD 以 429 有序完成。「CB 開路 → 毫秒級 503 污染 AIMD 窗 → 放寬 → 再推爆」的正回饋循環不復存在。
2. **AIMD 行為健康**：gateway log 整輪 364 次調整；壓測窗內 window p95 94–406 ms（遠低於 1500 ms 目標）、上限以加法穩定爬升（178→188）、每 5 秒窗 2,400–3,300 筆有效樣本（E2 排除生效：429/5xx 不再進窗）。
3. **429 佔比 65.3% → 13.2%**：CB 不再攔胸口一刀後，AIMD 上限爬到實際容量附近，需求−容量差額縮小。13.2% < 40% 暫定上限，本輪 429 gate PASS。
4. **401×1,113 是壓測工件，不是 C2 迴歸**：1,000 名 provisioning 受 auth 限流（5/s）需 ~8 分鐘，JWT 效期 15 分鐘——最早入列玩家的 token 在輪中跨過效期線（401 自輪開始 25.5 秒起出現、集中在輪尾，與逐批到期的時間結構吻合）。gateway 正確拒絕過期 token 是預期行為。**已解（2026-07-18，分批臨發 token 方案）**：新增 `tests/performance/refresh-player-tokens.mjs`——provision 完成後、jmeter 起跑前，直連 member-service（8081，繞過 gateway auth 5/s 限流、不污染限流桶/AIMD 窗）把 `players.csv` 全部玩家重登入一輪、原地換新 token（1,000 名預估 <1 分鐘，token 年齡歸零 → 60 秒壓測輪有 13+ 分鐘裕度）。`provision-players.mjs` 的 CSV 同步加第三欄 `username` 供重登入（jmx CSVDataSet 只映射前兩欄，不受影響）。E3 SOP：provision → refresh → 立即起跑。

### T-091 對帳（本輪）

9 項檢查 0 筆新違規（`accounting-20260718-033833`）；`wallet_balance_matches_transaction_sum` 的 3 筆＝已知 player 1001–1003 歷史髒資料（固定排除，已逐筆查證非本輪產生）。本輪觸及帳務全數乾淨：0 超扣、0 重複扣款、0 冪等鍵重複、交易鏈完整。

### 結論與下一步

1. **E1+E2 機制驗證有效，兩項判準（503 歸零、accepted 成功率 ≥90%）皆達成**；150 全綠中繼目標首次達成。
2. 殘局只剩決策與工件：**D1-final 拍板**（建議 c：150 全綠＝驗收、1,000 改韌性驗證）→ D2（gate 參數落地）→ **E3 結案輪**（401 token 工件已解，見上方結果 4）；B2（debit 往返 4→2）在本輪 P99 已達標下改為選配。
3. review 遺留兩個 advisory 用本輪數據判：①gateway 自產 401/403 進 AIMD 窗——本輪 401×1,113 未觸發 AIMD 異常收緊（上限穩定爬升），影響輕微，可降級為 E3 後待辦；②AIMD floor 是否 ≥100——本輪上限運行區間 178–188 遠高於 floor 50，未觸 floor，維持現值。

## 2026-07-09 C3（自適應在途上限）+ B1（Hikari 修正）效果對照重跑

C3 落地後的對照重跑：`RouteConcurrencyLimitGlobalFilter` + `AdaptiveInFlightLimiter`（AIMD：延遲視窗 P95 超標 ×0.8、達標 +2，floor 50 / ceiling 400 / 初始 200 / 延遲目標 2s / 每 5 秒調整），**per-route 各持獨立 limiter，`/api/v1/wallet/**` 首次納入保護**（即 C1 輪殘餘課題①）。gateway 測試 41/41 綠、code-reviewer gate PASS。照 C1 SOP：暖機輪棄置（`20260709-160905`，冷啟動樣態：前 23 秒集中 62.9% 錯誤後歸零）→ 輪距 2.5 分鐘 → 150 正式輪 → 重新 provision 1,000 名（約 7 分鐘，兼輪距）→ 1,000 輪 → T-091 對帳。

> ⚠️ **歸因誠實聲明**：本輪 wallet-service 同時帶著 B1 的 HikariCP `maximum-pool-size` 巢狀 key 修正（`8e8d753`，實跑 pool 10→15），且與 C1 輪隔日（跨日環境變異、`wallet_transactions` 表又增長）。**延遲改善是 C3+B1 疊加效果，不可全記在 C3 頭上**；debit 平均 581→492 ms（@1,000）主要應歸 B1。

### 150 併發正式輪（`20260709-161414`）

| Gate | 門檻 | 實測 | 判定 |
|---|---:|---:|---|
| Accepted P99 | < 500 ms | 1,423 ms | ❌ |
| HTTP 5xx | 0 | **0** | ✅ |
| 429 佔比（容量內要求 0） | 0% | **0%** | ✅ |
| 失敗樣本 | 0 | **0**（10,258 樣本） | ✅ |
| idempotency / overdraw | 0 / 0 | 0 / 0 | ✅ |

與 C1 輪（`20260708-153718`）對照：**P99 2,753→1,423 ms（−48%）、吞吐 86.8→169.7/s（近翻倍）**，0 失敗/0 誤傷持穩（AIMD 在容量內完全不卸載，與固定上限行為一致）。Prometheus 佐證（80s 窗）：成功 spin 平均 625 ms、**wallet debit 平均 194 ms**（C1 輪同日量測 547–581 ms）——debit 大改善主因是 B1 pool 修正（見上方聲明）。距 150 全綠只剩 P99 一項，且已從 5.5 倍超標縮到 2.8 倍。

### 1,000 併發（`20260709-162358`）——與 C1 輪對照

| 指標 | C1+C2 後（`154603`，07-08） | **C3+B1 後（`162358`，07-09）** |
|---|---:|---:|
| 樣本數 | 11,474（177.5/s） | **28,759（464.6/s）** |
| 429 shed | 5,300（46.2%） | **18,767（65.3%）**（game 16,162＋wallet 2,605） |
| HTTP 200（成功） | 1,477 | **7,829（+430%）** |
| HTTP 401 | 1,988 | **0（歸零）** |
| HTTP 5xx | 227 | **2,027**（503×2,024＋502×3，全在 game spin） |
| client SocketTimeout | 2,124 | **136（−94%）** |
| HttpHostConnectException | 358 | **0** |
| Accepted P99 | 5,625 ms | 5,317 ms |
| idempotency / overdraw | 0 / 0 | **0 / 0** |

**Prometheus 佐證（80s 窗，迄 16:25:02）**：成功 spin 平均 **2.65 → 1.89 s**、wallet debit 平均 **581 → 492 ms**；gateway CB `not_permitted`：game-service ≈ 2,079、**wallet-service = 0**。

**三個機制性結論**：

1. **wallet 路徑收編生效，C1 殘餘課題①關閉**：balance 檢查 sampler 從 C1 輪的 2,384 筆失敗（401×1,305＋SocketTimeout×1,079）變成 **0 失敗**（6,576 accepted＋2,605 有序卸載）。401 雪崩整體歸零、連線層失敗（SocketTimeout/HHCE）幾乎消失——「未受保護路徑打爆 Redis/連線池」的失敗模式被 per-route 上限根治。
2. **殘餘失敗高度集中為單一形態：game spin 的 503**（2,024 筆 ≈ CB not_permitted 2,079）。機制：AIMD 放行的 spin 流量仍超過 game-service 慢呼叫閾值，CB 開路期間 gateway 快速回 503。這不是新增問題——C1 輪同類壓力表現為 2,124 筆 client SocketTimeout（JMX 5s 先斷線），本輪後端變快、失敗「顯形」為快速 503；**總失敗 4,697→2,163（−54%）**。下一步課題：CB 與 AIMD 的目標協調（讓 AIMD 的延遲目標先於 CB 慢呼叫閾值收斂，避免雙保護互踩）。
3. **429 佔比 65.3% > 40% 上限——照舊誠實判 FAIL，不調數字**。佔比上升是算術必然：卸載回覆是毫秒級，1,000 執行緒循環變快（總樣本 11,474→28,759，+150%），需求−容量差額全變成 429；且分母裡 wallet 路徑現在也會卸載。**被接受請求的成功率 23.9%→78.4%** 才是機制效果的正確讀數。40% 上限與驗收拓樸仍待 D1 拍板。

### T-091 對帳（本輪）

9 項檢查中 7 項 0 違規；`wallet_balance_matches_*` 的 3 筆＝已知 2026-06-16 歷史髒資料（player 1001–1003，固定排除），**本輪觸及帳務全數乾淨：0 超扣、0 重複扣款、交易鏈完整**。

### 結論與下一步

1. **C3 機制驗證有效**：150 併發容量內零卸載零誤傷；1,000 併發下成功 +430%、401 歸零、連線層失敗 −94%、帳務 gate 全 PASS。B1 的 pool 修正貢獻了 debit 路徑的絕對延遲改善（歸因見上方聲明）。
2. **殘餘課題收斂為兩項**：① game-service CB 與 AIMD 的閾值協調（503×2,024 的唯一來源）；② D1 拍板（429 上限、最終驗收拓樸）——單機容量 ≈550–600 筆/秒 Postgres 交易（B1 定案）決定了 1,000 併發在單機上永遠要靠卸載消化。
3. 150 併發 P99 已收斂到 1,423 ms；如需繼續壓，方向是 B1 拍板的「減少交易往返/commit 成本」或 DB 搬家，不在 gateway。

## 2026-07-08 C1+C2（gateway 併發上限卸載＋JWT Redis 短重試）效果對照重跑

C1（`GameConcurrencyLimitGlobalFilter`：`/api/v1/game/**` 在途上限 200、JWT 之前卸載、超限 429+`Retry-After`）與 C2（JWT filter Redis 撤銷檢查 `retryWhen(Retry.backoff(1, 50ms))`，fail-closed 不變）疊加落地後重跑。**本輪起適用 D1 拍板的新 gate 語意**（429=卸載不計失敗、P99/5xx/失敗以被接受樣本為母體、429 佔比上限 40% 暫定、150 併發要求 429=0）——這是語意修正非放寬條件，`analyze-jtl.mjs` 同步改判。gateway 以 C1+C2 程式碼重啟；依 Phase A 輪學到的 SOP：先跑一輪暖機棄置（`20260708-153345`）、間隔 2 分鐘再跑正式輪。

### 150 併發正式輪（`20260708-153718`）——當日最乾淨的一輪

| Gate | 門檻 | 實測 | 判定 |
|---|---:|---:|---|
| Accepted P99 | < 500 ms | 2,753 ms | ❌ |
| HTTP 5xx | 0 | **0** | ✅ |
| 429 佔比（容量內要求 0） | 0% | **0%** | ✅ |
| 失敗樣本 | 0 | **0**（5,208 樣本） | ✅ |
| idempotency / overdraw | 0 / 0 | 0 / 0 | ✅ |

**5,208 樣本全程 0 失敗**（含起跑段）——上限 200 在容量內完全不誤傷（429=0），Phase A 輪 2 還有 1 筆瞬斷、本輪連這個都沒有。距中繼目標（150 併發全綠）只剩 P99 一項，且其主體是 wallet debit（B1）＋單機資源競爭（D1）。

### 1,000 併發（`20260708-154603`）——與前兩輪同日對照

| 指標 | Phase A 前（`103916`） | Phase A 後（`150649`） | **C1+C2 後（`154603`）** |
|---|---:|---:|---:|
| 樣本數 | 12,530 | 9,587 | 11,474（吞吐 177.5/s，最高） |
| **429 shed（新增桶）** | — | — | **5,300（46.2%）** |
| HTTP 200（成功） | 3,948 | 653 | **1,477（+126% vs 前輪）** |
| HTTP 401 | 343 | 5,315 | **1,988（−63%）** |
| HTTP 5xx | 3,870 | 362 | **227** |
| client SocketTimeout | 4,369 | 2,934 | 2,124 |
| HttpHostConnectException | 0 | 323 | 358 |
| Accepted P99 | 5,291 ms | 5,604 ms | 5,625 ms |
| idempotency / overdraw | 0 / 0 | 0 / 0 | **0 / 0** |

**Prometheus 佐證（80s range query，窗口迄 15:47:09）**：成功 spin 平均 **5.21 s → 2.65 s（腰斬）**、wallet debit 平均 **1,070 → 581 ms**——後端承壓被封頂在 ~200 在途後，被接受請求的實際處理速度確實顯著回升；`not_permitted`（game CB）≈ 242，繼續縮小。

**殘餘失敗的組成已再次換位置——集中到「未受 C1 保護的 wallet 路徑」**：1,988 筆 401 中 1,305 筆、2,124 筆 SocketTimeout 中 1,079 筆都在 balance 檢查 sampler（`/api/v1/wallet/**`，無併發上限）。機制：429 卸載是毫秒級回覆，1,000 個執行緒循環變快、對錢包路徑的打擊頻率反而升高（總樣本 9,587→11,474），wallet＋JWT Redis 檢查在該路徑上照樣飽和。**C1 只保護了遊戲路徑；瓶頸沒有消失，是被擠到沒設上限的地方**。

**429 佔比 46.2% > 暫定上限 40%——誠實判 FAIL，不調數字**。本質：1,000 執行緒 × 1s pacing 的需求速率遠超單機實測容量（~180/s），無論上限設多少，「需求−容量」的差額都得變成 429。這不是 C1 的缺陷，是 D1 未拍板的容量問題（多機拓樸或降低驗收併發）。上限要不要修訂，等 D1 一併決定。

### 結論與下一步

1. **C1+C2 機制驗證有效**：成功數 +126%、401 −63%、5xx −37%、成功 spin 延遲腰斬、帳務 gate 照舊全 PASS；150 併發達成 0 失敗/0 5xx/0 誤傷。
2. **三個明確的殘餘課題**：① wallet 路徑無上限保護（是否把 `/api/v1/wallet/**` 納入 C1 或做 per-route 上限——建議與 B1 一起處理，先剖析再決定）；② accepted P99 仍高（在途 200 的排隊深度＋單機飽和，B1/D1）；③ 429 佔比上限與最終驗收拓樸（D1，待拍板）。
3. 中繼目標（150 併發全綠）只差 P99 一項——**下一步就是 B1**（wallet debit 剖析，實證數據已備：96→547→581 ms 隨表增長與負載劣化）。

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

## 2026-07-08 gateway TimeLimiter 修正驗證（1,000 併發完整重跑）

同拓撲（宿主機 `mvn spring-boot:run` 起 7 服務 + Docker infra/observability）以規格級 1,000 併發完整重跑（`results/20260708-103916/`，ramp-up 1s、60s、pacing 1s，皆為 JMX 預設，未放寬）。前置：重新 provision 1,007 名玩家（977 名一次到位 + 23 名因 gateway 429 限流退避耗盡失敗、補跑 30 名合併；JWT 效期 15 分鐘，測試緊接 provisioning 完成後起跑）。

**實測數字（對照 150 併發驗證與修正前 1,000 併發）**：

| 指標 | 修正前 1,000 併發（`20260708-100442`） | 修正後 150 併發（`20260708-101629`） | **修正後 1,000 併發（`20260708-103916`）** |
|---|---:|---:|---:|
| 樣本數 | 15,922 | 7,841 | 12,530 |
| HTTP 5xx | 13,709（86.1%） | 0 | **3,870（30.9%）** |
| 失敗樣本合計 | 14,221（89.3%） | 4（0.05%） | **8,582（68.5%）** |
| P99 | 5,055 ms | 2,667 ms | 5,291 ms |
| idempotency / overdraw | 0 / 0 | 0 / 0 | **0 / 0** |

**失敗樣本組成拆解**（依 JTL `responseCode` 分組，不混為一數）：

| 組成 | 筆數 | 佔全樣本 | 說明 |
|---|---:|---:|---|
| HTTP 503（gateway CB open） | 3,870 | 30.9% | 較修正前 13,709 減少 72%；性質已改變，見下 |
| client 端 SocketTimeout（5s） | 4,369 | 34.9% | JMX `response_timeout_ms=5000` < TimeLimiter 6s：修正前這批請求在 1 秒被 gateway 腰斬成 503，現在被放行執行、但後端真實延遲 >5s，換成 JMeter 先斷線。同一個「spin 路徑延遲」問題換了呈現形式 |
| HTTP 401 | 343 | 2.7% | 全部集中在起跑尖峰 10:39:24–36 的 12 秒內（跨 273 執行緒）。根因＝JWT filter 的 Redis 撤銷檢查為**設計上的 fail-closed**（`JwtAuthenticationGlobalFilter`：Redis 故障時拒絕而非放行，避免已撤銷 token 復活），起跑瞬間 Redis 過載觸發。非 token 過期（全部 JWT 效期至 10:46+，測試 10:40:24 結束） |
| HTTP 200（成功） | 3,948 | 31.5% | — |

**Prometheus 佐證（90 秒 range query，窗口迄 10:40:24）**：

- `increase(resilience4j_circuitbreaker_not_permitted_calls_total[90s])`：game-service ≈ 4,047（修正前 ≈ 9,861）、**wallet-service = 0（修正前 ≈ 10,028）**。
- `increase(resilience4j_circuitbreaker_calls_seconds_count{kind="failed"}[90s])`：**全服務 = 0**（修正前 game ≈ 1,172、wallet ≈ 424）——這是「TimeLimiter 1 秒誤判」環節消失的直接證據：沒有任何呼叫再被判 failed，本輪 CB 開路完全由 **slow-call rate** 統計觸發（成功 spin 平均延遲 4.42 s > `slow-call-duration-threshold: 3s`），屬設計內的合法卸載訊號，不再是誤判→flapping。
- 成功 spin（status=200）平均延遲 ≈ **4.42 s**（修正前 ≈ 3.63 s；被放行走完的呼叫更多、排隊更深）；wallet `/internal/wallet/debit` 平均延遲 ≈ **372 ms**（修正前 ≈ 896 ms，已脫離熔斷連鎖）。
- 計量注意：`resilience4j_timelimiter_calls_total` 全程為 0——Spring Cloud Gateway 把逾時內嵌在 CircuitBreaker 裝飾內（`Mono.timeout`），不經 TimeLimiter registry 計量；「無誤判」的證據以上述 CB failed-calls = 0 為準。

**T-091 帳務對帳**（`results/accounting-20260708-104156/`，因本機無 `psql`，改以 `docker exec lucky-star-postgres psql` 執行同一份 `accounting-reconciliation.sql`）：九項檢查中本輪測試玩家 **0 違規**（overdraw、負餘額、冪等鍵重複、交易鏈斷裂、frozen_amount 皆 0）；`wallet_balance_matches_*` 兩項各報 3 筆，經查全為 player_id 1001–1003、交易時間戳 2026-06-16 的既有歷史髒資料（與上一輪完整重跑判定相同），與本輪無關，排除於 gate 判定外。

**結論**：

1. **熔斷 flapping 的「誤判環節」在 1,000 併發下確認消除**：CB failed-calls 歸零、wallet CB 完全不再開路、5xx 減少 72%（150 併發下為 0）。殘餘 3,870 筆 503 是 slow-call rate 觸發的**合法**飽和卸載，不是 TimeLimiter 誤判。
2. **帳務完整性 gate 全程 PASS**（overdraw = 0、idempotency = 0、T-091 九項 0 違規）——歷史各輪不敗紀錄維持。
3. **效能 gate（P99 < 500 ms、5xx = 0、失敗樣本 = 0）在 1,000 併發仍 FAIL**：P99 5,291 ms 超標逾 10 倍。瓶頸已從「gateway 設定缺陷」移轉到 **spin 路徑本身的延遲**（風控 Redis 並發閘 + 每局 2 次 DB 聚合、注單稽核在高併發下變重；成功呼叫平均 4.42 s），5s client timeout（34.9%）與 503（30.9%）都是同一瓶頸的兩種呈現。此屬下一輪效能調校（非同步化風控聚合、拆分注單稽核）的獨立課題，超出本次 TimeLimiter 修正範圍，依計畫另開工作項處理。

## 2026-07-08 完整重跑最終結果（Phase 2b 完成）

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
