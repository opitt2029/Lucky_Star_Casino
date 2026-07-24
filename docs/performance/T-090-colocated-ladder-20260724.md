# T-090 co-located 容量階梯 + game→wallet 儀表驗證（2026-07-24）

> **定位（先講清楚，避免誤用）**：本輪在 **SUT 本機自壓（co-located）**——JMeter 與 7 個服務同機
> 競爭 12 核 CPU，**容量/吞吐/P99 絕對數字不可對外引用**。目的有二：
> ① 驗證本輪新增的 **game→wallet HTTP client 儀表**（`http.client.requests`）在真實負載下能產出可查的
> 分層 P99；② 拿一條方向性曲線看膝點位置。**可對外引用的容量天花板仍須照
> [`T-090-遠端施壓機壓測計畫-20260723.md`](./T-090-遠端施壓機壓測計畫-20260723.md) 用分機 LG 重跑。**

## 0. 環境（釘死並記錄，否則跨輪不可比）

| 項 | 值 |
|---|---|
| git SHA | `3206979`（HEAD，寫進 `ladder-summary.json`） |
| 機器 | 12 邏輯核 / 16GB RAM；Docker Desktop（WSL2） |
| 施壓 | JMeter 5.6.3，**與 SUT 同機**（co-located） |
| 玩家 | 3,100 名已入金（perf12345），本輪重新 provision |
| 表基線（起跑前） | wallets=6,544、wallet_transactions=503,833、wallet_outbox=502,869（PENDING=0）、game_rounds=377,663 |
| ladder 目錄 | `tests/performance/results/ladder-20260724-104753` |

**開跑前修掉的兩個陷阱**：
1. **Redis 網路脫鉤**（`lucky-star-redis` 舊容器 Exited 128、被別專案占 6379）→ 停占用者 + `--force-recreate` 讓 redis 重掛 compose 網路，7 服務才由 503→200。
2. **stale image**：running `wallet-service` image（建於 07-23 06:29Z）比 outbox 平行 ack 修正 commit（`2c5ff7e`，06:47Z）**早 18 分鐘**——首次起跑 100 req/s 就排空逾時（跑的是舊慢 poller）。重建 wallet+member 對齊 HEAD 後重跑，`wallet_outbox` 全程 PENDING=0。

## 1. 容量階梯（9 階，每階 90s + 25s 暖機丟棄）

執行緒數為同機 16GB 保守設定（最高 1500，**非**計畫的 3000，避免 OOM/thrash）。

| offered 目標 | 實際 offered | accepted 吞吐 | P99 | 卸載 | 5xx | 帳務違規 | JMeter CPU |
|--:|--:|--:|--:|--:|--:|--:|--:|
| 50 | 49.4 | 49.4 | 98ms | 0% | 0 | 0 | 9.6% |
| 100 | 99.1 | 99.1 | 142ms | 0% | 0 | 0 | 15.6% |
| **150** | 153.3 | 147.8 | **1285ms** | 3.5% | 0 | 0 | 25.3% |
| 250 | 288.9 | 169.5 | 1519ms | 41.3% | 0 | 0 | 33.8% |
| 500 | 484.5 | **184.0** | 1173ms | 62.0% | 0 | 0 | 37.7% |
| 1000 | 906.1 | 112.8 | 1852ms | 87.6% | 1 | 0 | 36.2% |
| 2000 | 1113.0 | 84.8 | 1823ms | 92.4% | 1 | 0 | 40.8% |
| 3500 | 916.8 | 102.0 | 1909ms | 88.9% | 0 | 0 | 41.3% |
| 5000 | 1171.4 | 135.6 | 1476ms | 88.4% | 1 | 0 | 42.7% |

**讀法**：
- **膝點在 100→150 req/s 之間**：P99 由 142ms 暴衝到 1285ms（9×），並開始卸載。
- **accepted 吞吐峰值 ~184/s（500 階）**，過載更深時反而下滑（擁塞崩潰）。
- offered 在 8/9 階卡在 ~900–1170（**JMeter 同機上限**，印證文件 ~1330 req/s 天花板；第 8、9 階 1500 執行緒反被 JMeter 自身 GC/排程吃掉，offered 比第 7 階更低）——**這些階「打不到目標」是施壓機受限，不是 SUT 容量**。
- 全程 **5xx 極少（單發）、帳務違規 0**：卸載（429）乾淨保護系統。

## 2. game→wallet 分層 P99（本輪新儀表，高負載窗）★

以前 game 對 wallet 的 outbound 呼叫沒有儀表（`http_client_requests` = 0），延遲分層只能相減推論。
接上後第一次可直接查詢：

| 層 | P99 | 來源 |
|---|--:|---|
| gateway 端到端 spin | ~900ms | `http_server_requests`（gateway） |
| **game→wallet DEBIT（新）** | **405ms** | `http_client_requests{client_name="wallet-service",uri="/internal/wallet/debit"}` |
| wallet 伺服器端 DEBIT | 319ms | `http_server_requests{uri="/internal/wallet/debit"}` |
| **game→wallet CREDIT（新）** | **415ms** | `http_client_requests{...uri="/internal/wallet/credit"}` |
| wallet 伺服器端 CREDIT | 334ms | `http_server_requests{uri="/internal/wallet/credit"}` |

**結論（方向性，待分機複驗）**：game→wallet DEBIT 往返 405ms 中，wallet 伺服器端占 319ms，
**client/網路/連線池開銷只有 ~86ms**。→ **推翻**計畫 §5.2「延遲卡在未調校的 game→wallet HTTP client」
的假設方向：真正的大頭是 **wallet 伺服器端自身處理**（在負載下由 idle 的 ~30ms 升到 ~320ms）。
若要優化，該往 wallet 伺服器端處理 / 減少每局往返（B 案）看，而非只調 client。

## 3. SUT CPU（docker stats 取樣，`assets/sut-docker-stats-20260724.csv`）

各服務 CPU 峰值（100%=1 核，共 12 核）：member **1177%**、wallet 581%、gateway 488%、rank 484%、
game 384%、kafka 311%、postgres 235%。

- member 峰值 1177% ≈ 吃滿整台——是**每 2 階 token 刷新的 BCrypt 密碼雜湊**（3,100 名重登入），非 spin 熱路徑。
- 加上 **JMeter 也在本機**，高階時 12 核被壓測工具＋BCrypt＋服務一起綁死。
- 故本輪 ~180/s 天花板**部分是機器算力被壓測工具吃掉**，不是 SUT 的架構極限——再次說明可引用容量必須分機。

## 4. 帳務一致性（T-091）

負載後跑 `run-accounting-reconciliation.ps1`：**9 項全 PASS、0 違規**
（`tests/performance/results/accounting-20260724-112053`）。即使整輪 88% 卸載、擁塞崩潰，
Postgres 帳本完全一致（無重複冪等鍵/負餘額/鏈斷裂/delta 錯，凍結全歸零）。

## 5. 結論與後續

- ✅ **新儀表可用**：game→wallet 分層 P99 現為 Prometheus 一級指標，下一輪不用再相減推論。
- ✅ **方向性發現**：client 開銷小、wallet 伺服器端才是 game→wallet 延遲主體——**推翻舊假設**，
  但屬 co-located 結果，須分機複驗。
- ✅ **帳務安全**：卸載機制在極端過載下仍保住帳本一致。
- ⏭ **仍缺可引用容量**：照 `T-090-遠端施壓機壓測計畫-20260723.md` 用第二台筆電當 LG 分機重跑，
  才能拿到不被施壓機污染的容量天花板，並在乾淨機器上複驗第 2 節的分層結論。
