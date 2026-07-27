# T-090 新環境容量階梯壓測（PR #264 合併後）— 2026-07-24

> 對應使用者需求：**「依照新環境壓測一次」**。新環境＝PR #264（已 merge）的三項變更：
> ① 六個 Tomcat 服務加 `server.tomcat.mbeanregistry.enabled=true`（解鎖 `tomcat_threads_busy`）
> ② 七服務加 `JAVA_TOOL_OPTIONS: -Xmx1g` ＋ `mem_limit: 1280m`（防 JVM 預設堆超賣主機）
> ③ ER 圖註解（與效能無關）。
>
> **一句話結論**：新環境在**同機自壓（co-located）**下重跑容量階梯，帳務 **T-091 九項對帳 0 違規**；
> 相較 PR #264 併入前的 baseline，**低負載延遲明顯下降、150 併發首次零卸載撐住**，但 knee 仍落在
> 100→150 併發之間、真瓶頸仍是 co-located CPU 爭搶。**絕對數字為悲觀下界、不可對外引用**。

---

## 1. 環境（可重現）

- **git**：`land-develop` @ `312b1f2`（PR #264 tip）。
- **主機**：12 邏輯核 Windows 筆電；JMeter + 7 服務 + MySQL/PG/Redis/Kafka **全同機**（co-located）。
- **新環境確認**（實測，非臆測）：
  - `tomcat_threads_busy` 指標**現身**（wallet/game `/actuator/prometheus` 各 3 條）→ PR #264 mbean 已進 image。
  - 容器 `JAVA_TOOL_OPTIONS=-Xmx1g -XX:MaxMetaspaceSize=256m`；docker stats 每服務 `mem=… / 1.25GiB`（＝`mem_limit 1280m`）→ 堆/記憶體衛生生效。
- **表基線**（壓測會讓表長大、劣化 debit 延遲，跨輪對照須記）：`wallets=6985`、`wallet_transactions=520790`、`game_rounds=388141`。
- **施壓模型**：open-model（PreciseThroughputTimer），每階 180s、切掉前 30s 暖機再算 percentile。
- **玩家**：383 名已入金（provision 目標 400，部分 register 撞 gateway 5/s 限流 429；≥ 最高階 300 併發需求）。

## 2. 容量階梯結果（本輪，co-located）

| 目標offered | 併發 | 樣本 | 實際offered | accepted吞吐 | P50 | P95 | P99 | 卸載429 | 卸載率 | 5xx | 冪等違規 | 超扣違規 | JMeter CPU |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 25 | 7427 | 50/s | 50/s | 20 | 40 | **58** | 0 | 0% | 0 | 0 | 0 | 1.7% |
| 100 | 50 | 14921 | 100.4/s | 100.4/s | 28 | 67 | **117** | 0 | 0% | 0 | 0 | 0 | 4.3% |
| 200 | 100 | 29415 | 198.5/s | 198.5/s | 104 | 614 | 912 | 0 | 0% | 0 | 0 | 0 | 18.6% |
| 300 | 150 | 31905 | 219.4/s | **219.4/s** | 574 | 1294 | 1731 | 0 | **0%** | 0 | 0 | 0 | 24.5% |
| 600 | 300 | 87521 | 601.9/s | 154.5/s | 467 | 1070 | 1488 | 65055 | 74.3% | 38 | 0 | 0 | 35% |

- **knee 仍在 100→150 併發**：≤100 併發乾淨（0 卸載），150 併發起延遲爬高，300 併發 gateway AIMD 大量卸載（74.3% 429＝設計保護行為，非故障）。
- **JMeter 自身 CPU**：150 併發 24.5%（貼 25% 打折線）、300 併發 35%（>25%，該階數字打折）。與 PR #264 同型態——knee 正好落在施壓機開始搶 CPU 之處。

## 3. 與 PR #264 併入前 baseline 對照（同為 co-located）

| 併發 | 指標 | baseline（`fcaa14b`） | 新環境（`312b1f2`） | 變化 |
|---:|---|---:|---:|---|
| 25 | P99 | 534ms | **58ms** | ⬇ 大幅改善 |
| 50 | P99 | 246ms | **117ms** | ⬇ 改善 |
| 100 | P99 | 1032ms | 912ms | ⬇ 略改善 |
| 150 | accepted吞吐 | 124–137/s | **219/s** | ⬆ 明顯 |
| 150 | 卸載率 | 46% | **0%** | ⬇ 首次零卸載撐住 |
| 150 | P99 | 1840–2426ms | 1731ms | ⬇ 改善 |
| 300 | accepted吞吐 | 131–135/s | 154/s | ⬆ 略升 |
| 300 | 卸載率 | 79% | 74.3% | ⬇ 略降 |

**解讀（謹慎）**：改善方向一致且明顯，但 co-located 絕對數字受主機背景負載影響大——本輪主機較乾淨亦是一因，**不宜全歸功於堆/記憶體衛生**。可確定的是**新環境沒有讓任何一階變差**，且 150 併發從「破線卸載」轉為「零卸載撐住」是本輪最實在的正向訊號。堆限到 1g／`mem_limit 1280m` 後七服務 mem 皆 <900MiB、無 OOM、無服務重啟。

## 4. 帳務正確性（權威口徑）

**T-091 SQL 對帳（`accounting-reconciliation.sql`）：9 項全 0 違規。**

| 檢查 | 違規數 |
|---|---:|
| duplicate_idempotency_keys | 0 |
| frozen_amount_exceeds_balance | 0 |
| negative_wallet_balances | 0 |
| nonzero_frozen_amounts | 0 |
| transaction_chain_breaks | 0 |
| transaction_delta_mismatches | 0 |
| transactions_without_wallet | 0 |
| wallet_balance_matches_latest_transaction | 0 |
| wallet_balance_matches_transaction_sum | 0 |

高卸載（300 併發 74%）下仍零帳務違規：debit 條件 UPDATE＋行鎖（B2）、`idempotency_key` UNIQUE、樂觀鎖三道防線在壓力下守住。

## 5. 觀察與後續（caveat）

1. **⚠️ 連線池 config 與 runtime 不符（值得追）**：`application.yml` 宣告 game pg／wallet pg 皆
   `maximum-pool-size: 40`，但本輪 runtime 實測 `hikaricp_connections_max`＝**game 10、wallet pg 15、wallet mysql 10**。
   代表運行 image 的有效池上限低於原始碼宣告（可能 image 建於池調大之前，或有未追到的覆寫來源）。
   **對本輪結論無害、反而強化「池非瓶頸」**：即便池僅 10–15，150 併發仍零 timeout／零卸載／零帳務違規。
   但下輪正式壓測前應查清並重建 image，讓 runtime＝宣告值。
2. **co-located 仍測不出真實容量天花板**：JMeter 同機吃 24–35% CPU，knee 被施壓機污染。要拿可對外
   引用的容量曲線與乾淨瓶頸歸因，須**分機重測**（JMeter 移出 SUT），此點與 PR #264 結論一致、未變。
3. **300 併發 5xx=38**：高卸載階少量 5xx（0.04% of samples），非帳務問題（對帳 0 違規），屬過載邊界
   的偶發錯誤，分機乾淨環境再確認是否消失。

## 6. 產出物

- 階梯原始資料：`tests/performance/results/ladder-20260724-142712/`（含 `ladder-summary.json`／`.md`、各階 JTL）。
- Grafana 時間窗（UTC ms）：`from=1784874435704 to=1784875672111`。
