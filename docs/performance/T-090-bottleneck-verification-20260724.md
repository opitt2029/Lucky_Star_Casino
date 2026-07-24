# T-090 架構瓶頸驗證報告（HikariCP / GC / 同步耦合）— 2026-07-24

> 對應使用者提問：驗證「加大 HikariCP（方向 3）／優化 GC（方向 4）／改非同步（方向 5）」
> 是不是本站容量瓶頸。方法＝**負載期實測內部指標**，非臆測。
>
> **一句話結論**：在本輪（co-located 自壓）三個方向**都不是瓶頸**——連線池 45% 閒置、
> GC 僅佔 ~1.2% 時間、同步 wallet 呼叫僅 ~130ms/spin。真瓶頸是 **CPU/排程爭搶**
> （12 核同機硬扛 7 JVM + MySQL + PG + Kafka + JMeter 24–35% CPU）。**要判定架構真實
> 天花板，必須先分機重測**（把 JMeter 移出 SUT）。

---

## 1. 測試方法（先講清楚，避免誤用）

- **環境**：develop @ `fcaa14b`｜12 邏輯核 Windows 筆電｜JMeter + 7 服務 + MySQL/PG/Redis/Kafka **全同機**。
- **co-located = 悲觀下界**：施壓機與 SUT 同機競爭 CPU，**絕對吞吐/延遲不可對外引用**
  （壓測腳本自身規則：`jmeterHostJavaCpuPct > 25%` 該階數字打折）。本報告驗的是
  **「三個方向是不是瓶頸」的機制問題**，不是量容量天花板。
- **內部指標 sampler**：每 2s 抓 wallet(8082)+game(8083) 的 `/actuator/prometheus`，
  取 HikariCP（active/pending/timeout/acquire）、`jvm_gc_pause`（count/sum delta）、
  `http_server_requests`（`/internal/wallet/debit`、`/internal/wallet/credit` 的 count/sum
  → 負載期平均延遲）。

## 2. 容量曲線（兩輪 co-located 階梯，一致）

| 目標 offered | 併發 | accepted 吞吐 | P95 | P99 | 卸載 429 | JMeter 自身 CPU |
|---:|---:|---:|---:|---:|---:|---:|
| 50 | 25 | 53.5/s | 352ms | 534ms | 0% | 3.5% |
| 100 | 50 | 101/s | 160ms | 246ms | 0% | 5.8% |
| 200 | 100 | **208.6/s** | 744ms | 1032ms | **0%** | 20.6% |
| 300 | 150 | 124–137/s | 1627ms | 1840–2426ms | 46% | **24.1%** |
| 600 | 300 | 131–135/s | 1261ms | 1606–1626ms | 79% | **35.5%** |

- **knee 在 100→150 併發之間**：≤100 併發乾淨扛住（0 卸載），150 併發起延遲破線、gateway 開始卸載。
- **429 是設計行為，不是故障**：gateway 的 AIMD 併發限流器（`/api/v1/game/` route，
  `latency-target-ms=1500`）在窗內 P95 破 1500ms 時 ×0.8 收緊在途上限（`WalletConcurrencyLimit`/
  `GameConcurrencyLimit`）。150 併發 P95=1627ms 破線 → 主動吐 429 保護延遲。
- **≤100 併發已達 208 req/s、0 卸載**，已超過先前遠端分機的 160 req/s 觀測。

## 3. 三個方向逐項驗證（負載期實測）

### 方向 3 — HikariCP 連線池（池上限 pg=40 / mysql=10）

| 池 | active 峰值 | pending 峰值 | timeout | acquire 峰值 |
|---|---:|---:|---:|---:|
| wallet postgres | **22 / 40** | 0 | **0** | 0.251s |
| wallet mysql | 2 / 10 | 0 | 0 | — |
| game postgres | **22 / 40** | 1 | **0** | **1.177s** |

**判定：❌ 不是瓶頸。** 40 條的池峰值只用到 22（45% 閒置）、pending≈0、**零 timeout**。
加大池對此負載**零效果**。

> **冒煙證據（反而指向真因）**：game 池 `acquire_max=1.18s`——但當下 active 才 22/40，
> **池根本沒滿**。連線取不到 1.18s，不是「沒有空閒連線」，而是**取連線的執行緒排不到 CPU 執行**。
> 這正是 CPU 飽和、不是池飽和的鐵證。

### 方向 4 — GC（負載期 delta，約 120s×2 階）

| 服務 | GC 次數 | 總暫停 | 平均暫停 | 佔時間比 |
|---|---:|---:|---:|---:|
| wallet | 68 | 1.287s | 18.9ms | ~1.1% |
| game | 48 | 1.465s | 30.5ms | ~1.2% |

**判定：❌ 不是主瓶頸。** GC 僅佔 ~1.2% 時間、無 OOM、無長暫停（記憶體每服務才 ~500–670MB）。
Java 21 預設 G1GC 已足夠。**盲調 `-XX` 無據。** game 平均暫停 30ms 略高，可列入次要觀察，
但非本輪容量的限制因素。

### 方向 5 — game→wallet 同步 HTTP 耦合

| 呼叫 | 負載期次數 | 平均延遲 | idle 基準 |
|---|---:|---:|---:|
| `/internal/wallet/debit` | 30,190 | **63.6ms** | 41ms |
| `/internal/wallet/credit` | 9,308 | **68.4ms** | 45ms |

**判定：⚠️ 真實但非主因。** 每次 slot spin 同步等 wallet：一次 debit（下注）＋（贏才）一次 credit
（派彩），合計約 **130ms** 的同步等待，負載下比 idle 增約 50%。**但 130ms 遠小於 P99 1600ms**——
改非同步最多省 ~100ms，**改不動根本的容量天花板**。

## 4. 真瓶頸判定：CPU / 排程爭搶

把可量到的服務時間加起來：debit 64ms ＋ credit 68ms ＋ GC 分攤 ~20ms ≈ **~200ms**。
但實測 P99 是 **1600–1840ms**。**中間 ~1.4s 的落差＝請求在排隊等 CPU/執行緒排程**，
不是花在任何一個 app 旋鈕上。佐證：

- game 連線 `acquire` 花到 1.18s，但池只用 22/40（§3 冒煙證據）＝執行緒沒被排到。
- 12 核同機硬扛 7 個 Spring JVM ＋ MySQL ＋ Postgres ＋ Kafka ＋ Prometheus/Grafana ＋
  **JMeter 自身 24–35% CPU**。knee（150 併發）正好落在 JMeter CPU 破 25% 打折線之後。

**結論：本輪的容量天花板是「這台筆電 ＋ 同機 JMeter」的 CPU，不是連線池/GC/同步耦合。**
使用者原假設的三個方向，經直接量測**均被否證或降為次要**。

## 5. 真正該修的痛點（依優先序）

> 注意：以下**不含**「加大池/調 GC/改非同步」——因為 §3 已用數據證明它們不是本輪瓶頸。
> 在沒有分機乾淨數據前動它們＝拜拜式優化。

**P0 — 觀測盲點（擋住所有後續判定）**
1. **Tomcat 執行緒池指標沒暴露**：`/actuator/prometheus` 只有 `tomcat_sessions_*`，**沒有
   `tomcat_threads_busy`**（需 `server.tomcat.mbeanregistry.enabled=true`）。無法看執行緒池是否飽和，
   等於方向 1/2（acceptCount/執行緒池）**根本無從驗證**。
2. **無 GC log**：要證實/排除 GC，得開 `-Xlog:gc*` 量真實暫停分布，而非只看聚合 gauge。
3. **game→wallet client 端 timer 為 0**：`WalletClientConfig` 宣稱用 `ObservationRegistry` 產
   `http.client.requests`，但實測 count=0——client 端觀測沒生效（目前只能靠 wallet server 端回推）。

**P1 — 方法學**
4. **co-located 測不出真實容量**：必須分機（LG `10.0.102.42`）對 SUT 施壓、且**負載期 scrape
   本報告的內部指標**，才能拿到可對外引用的容量曲線與乾淨的瓶頸歸因。

**P2 — 設定衛生（與量測無關，現在就能修、低風險）**
5. **無 `-Xmx`＋無容器 mem/cpu 限制**：7 個 JVM 各自預設堆為容器可見 RAM 的 25%（≈3.8GB）→
   理論可超賣 15GB 主機。真實負載下有 OOM/互相爭搶風險。應每服務設 `-Xmx` ＋ compose `mem_limit`/`cpus`。

**P3 — 架構（真實上線前）**
6. **gateway 單一 reactive 實例＝SPOF ＋ 無水平擴展**；全系統單副本（poller 註解自承「單實例假設」）。
   上線前需多副本，並解 outbox 多副本互斥（`FOR UPDATE SKIP LOCKED` / ShedLock）。

## 6. 建議行動

1. **補觀測（P0）**：開 Tomcat MBean 執行緒指標 ＋ GC log ＋ 修 client timer。這是驗證任何調校的前提。
2. **設定衛生（P2）**：`-Xmx` ＋ compose 資源限制。低風險、與量測無關，可先做。
3. **分機重測（P1）**：JMeter 移出 SUT ＋ 負載期 scrape 內部指標 → 拿乾淨容量曲線與瓶頸歸因。
4. **依乾淨數據**才決定要不要動池/GC/非同步——目前數據**不支持**這三項。
