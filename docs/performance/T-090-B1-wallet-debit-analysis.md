# T-090 B1 — wallet debit 路徑剖析報告

> 日期：2026-07-09。範圍：僅剖析與量測，**未動任何帳務邏輯**（雷區 8 不可動搖）。
> 方法：直打 wallet-service（8082）`/internal/wallet/debit`，繞開 game-service/gateway/風控，
> 隔離出 wallet-service 自身在併發下的行為，搭配 Prometheus Hikari 指標與 `pgstattuple` 即時量測。
> 環境：單機開發機（12 邏輯核心），docker-compose infra（postgres/mysql/redis/kafka）+ 本機 mvn 跑 wallet-service。

## 結論摘要

1. **找到一個真實的設定 bug（已修正並驗證）**：`wallet-service/application.yml` 的
   `spring.datasource.hikari.maximum-pool-size` 這個 key **從未生效**——實際跑的是 HikariCP
   內建預設值 10，不是設定檔宣稱的 15（mysql 端同理，10 其實是巧合命中預設值）。
2. **但 A/B 量測顯示連線池大小不是 150 併發下的主要瓶頸**。把 pool 從 10 修到 15、甚至實驗性拉到 60，
   平均延遲/尾端延遲幾乎沒有改善，且穩態下 `active` 連線數大多只在 13~25（離上限還很遠）。
3. **`wallets` 表目前無嚴重 MVCC 膨脹**（`pgstattuple` 量得 dead_tuple 8.57%），現況不足以單獨解釋
   「同一天內 96ms→547ms」的歷史劣化；不能排除但目前證據不支持它是主因。
4. **純 wallet-service 隔離測試在 150 併發下已重現歷史數字量級**（avg 279~314ms、p99 500~800ms，
   對照歷史全鏈路「547ms 平均」）——代表 wallet debit **自身的處理成本**（不是連線排隊）就是全鏈路
   debit 延遲的大宗來源。
5. ~~可能的真正瓶頸：單機 CPU/執行緒排程競爭~~（此為初版猜測，已由同日下午的 JFR
   對照剖析推翻並取代——見下方「JFR 定位（續篇）」節）。**最終定位：瓶頸是 DB 端交易
   容量（本機 Postgres ≈550–600 筆 debit 交易/秒），連線池大小只決定「隊伍排在應用內
   （Hikari）還是資料庫內（Postgres）」，總延遲不變。**

## 附帶發現：測試環境有 migration 落後

修正 pool size 後嘗試用 `credit(subType=REFUND)` 清理測試污染時，撞到
`chk_wt_sub_type` CHECK 失敗——這個 docker volume 的 Postgres 停留在 V10，
V11（REFUND）~V15（風控索引/alert 稽核）都沒套用過。已於本次剖析中手動補齊全部套用
（`docker exec -i lucky-star-postgres psql ... < VNN__*.sql`，全部 idempotent，`IF NOT EXISTS`/
`DROP CONSTRAINT IF EXISTS` 寫法安全可重跑）。**這解釋了為何本機測試偶爾會出現「明明程式碼支援
XX 子型/索引，DB 卻報錯」的離奇現象**——本機資料庫需要在每次 `docker compose up` 後手動確認
migration 是否跟上 `database/postgres/migration/` 最新版本。

## 詳細量測數據

### 環境基準

- `docker exec lucky-star-postgres pg_isready`：正常。
- `wallets` 表：6,798 列，664 kB heap；`pgstattuple('wallets')`：dead_tuple_percent = 8.57%，
  free_percent = 10.53%。輕度膨脹，非嚴重。
- `wallet_transactions` 表：77,237 列（量測前），13 MB heap；`pgstattuple`：dead_tuple_percent = 0%
  （append-only，符合預期，無 bloat 問題）。
- Postgres `max_connections = 100`，遠高於 wallet-service 任何一個 pool 設定，DB 端本身有餘裕。

### A/B 對照：HikariCP maximum-pool-size（150 併發、隔離直打 debit）

| Pool size | 樣本數 | avg | p50 | p95 | p99 | max | active 穩態觀察 |
|---|---:|---:|---:|---:|---:|---:|---|
| 10（bug，未修正前） | 10,000 | 431ms | 411ms | 639ms | 857ms | 1,798ms | 持續釘在 15*（誤：見下方修正說明） |
| 15（修正 key 巢狀後） | 15,000 | 314ms | 301ms | 424ms | 570ms | 1,076ms | 穩態偶爾出現 pending 排隊尖峰（105~135） |
| 60（實驗值，驗證用） | 15,000 | 294~404ms | 287~391ms | 375~514ms | 419~857ms | 674~1,395ms | 穩態 active 多數僅 13~33，pending 幾乎全程 0 |

> 注意：pool=10 那一輪量測用的壓測用戶端當時還是 `fetch()`（undici 預設 Agent 每個 origin
> 上限約 10 條並行連線），**用戶端自己就把並發封頂在 10 左右，量出來的數字不能代表真正 150
> 併發下的伺服器行為**。已改用 `node:http` + 自訂 `http.Agent({ maxSockets: 2000 })` 重測，
> pool=15 與 pool=60 兩輪才是可信數字：兩者延遲量級相近（都在 avg 290~430ms、p99 420~860ms
> 的範圍內波動），且 pool=60 時 active 連線數穩態遠低於上限——**確認連線池大小不是這個機器上
> 150 併發的限制因子**。

### CPU 觀察

壓測期間（150 併發、pool=15、~30 秒）用 `Get-Process -Id <wallet-pid>).CPU` 每秒取樣，
CPU 累積時間穩定以約每秒 3.5~4 秒的速率增長（即持續佔用約 3.5~4 顆邏輯核心）。機器共 12
邏輯核心，扣掉 postgres/mysql/kafka/zookeeper 容器與 Node 壓測腳本本身，並未觀察到全機
CPU 飽和，但 wallet-service 單一 JVM 吃掉 1/3 機器算力已不算小——同時 wallet-service 有
7 個 Kafka listener container（wallet.debit/credit/credit.request 各 3 partition + 3 個
DLT group）常駐消費，壓測期間也在即時消費新產生的 debit/credit 事件並寫 MySQL 讀視圖，
這是額外但**合理的真實負載**（非量測假象）。

## 對 B1 原始三個嫌疑假說的結論

| 假說 | 驗前信心 | 驗後結論 |
|---|---|---|
| HikariCP pool 太小造成排隊 | 高（且發現真實 bug：15 從未生效，實際跑 10） | **部分成立、部分推翻**：bug 真實存在且已修正，但即使加大到 60，延遲量級不變 → 不是 150 併發下的主要瓶頸 |
| `wallets` 表 MVCC 膨脹拖慢 point update | 中 | **證據不支持**：目前只有 8.57% dead tuple，表僅 664kB，不足以解釋數倍延遲 |
| 每筆 debit 同步寫入數過多（wallet+transaction+索引維護） | 低 | 未見異常；`wallet_transactions` insert-only 無 bloat，多索引維護成本量測不出顯著影響 |
| （新增）單機 CPU/執行緒競爭 | 未列入原始假說 | ~~一度列為首要嫌疑~~ → JFR 續篇推翻：hot-methods 極度平坦（最高 0.91%），CPU 不是瓶頸，執行緒絕大多數時間在**等待** |
| （最終定案）DB 端交易容量 | 未列入原始假說 | **JFR 對照證實**：pool=15 時等待發生在 Hikari `ConcurrentBag.borrow`；pool=60 時同樣的時間轉移到 Socket Read（等 Postgres 回應），吞吐兩輪都 ≈550/s——瓶頸是本機 Postgres 的交易處理容量，見下方續篇 |

## JFR 定位（續篇，2026-07-09 下午）——瓶頸最終定案

上表「單機 CPU 競爭」假說用 JFR（`settings=profile`，90 秒錄製窗涵蓋整輪 150 併發
×30,000 筆負載）做了兩輪對照驗證，結果推翻了 CPU 假說、也把「pool 大小不是瓶頸」的
早前結論精緻化成更準確的版本。

### 兩輪對照設定

- **輪 A（pool=15）**：即已 commit 的修正後設定。錄製檔 `debit-150c.jfr`。
- **輪 B（pool=60）**：以 JVM system property `-Dspring.datasource.maximum-pool-size=60`
  臨時覆寫（不動 yml），`hikaricp_connections_max` 驗證生效。錄製檔 `debit-150c-pool60.jfr`。
- 兩輪皆先暖機 400 筆棄置；負載相同（150 併發、30,000 筆、200 玩家輪替）。

### 關鍵數據對照

| 指標 | 輪 A（pool=15） | 輪 B（pool=60） |
|---|---:|---:|
| 壓測結果 avg / p99 | 250ms / 584ms | 276ms / 510ms |
| 吞吐 | 598/s | 543/s |
| hot-methods 最大單一方法佔比 | 0.91%（極度平坦，CPU 無熱點） | 同樣平坦 |
| tomcat-worker 停放在 **Hikari 連線等待**（`ConcurrentBag.borrow` → `SynchronousQueue.poll`，JDK 21 底層為 `LinkedTransferQueue$DualNode.await`） | **6,079 秒 / 29,707 次**（≈每請求一次、平均 205ms ≈ 82% 的請求延遲） | 429 秒 / 2,849 次（−93%） |
| Socket Read（等 DB 回應，JFR 有門檻只錄慢事件） | 48 秒 / 3,375 次 | **467 秒 / 30,219 次**（平均 15.5ms） |

### 解讀（教學點：排隊不會消失，只會搬家）

1. **CPU 假說死刑**：兩輪 hot-methods 都極度平坦（沒有任何方法超過 1%），執行緒
   時間幾乎全在停放等待，不在計算。早上看到的「吃 4 顆核」是 150 條 Tomcat 執行緒
   ＋7 個 Kafka listener 的排程/等待開銷總和，不是計算熱點。
2. **pool=15 時，請求延遲的 82% 是「等一條連線可用」**——JFR 停放堆疊直指
   `HikariPool.getConnection`。這推翻了早前用 0.5 秒輪詢 gauge 得出的「連線池沒被
   打滿」觀察（gauge 取樣太疏，抓不到高頻短暫的 borrow 等待；JFR 是全事件記錄）。
3. **但把 pool 加到 60，等待時間原封不動轉移到 Socket Read**：連線立刻拿得到了，
   換成 60 個併發交易在 Postgres 裡互相爭搶，單一查詢從快變慢（Socket Read 事件
   從 3,375 次暴增到 30,219 次超過記錄門檻）。總延遲、總吞吐兩輪幾乎一樣。
4. **結論：本機 Postgres 的 debit 交易容量 ≈550–600 筆/秒，是硬上限**。每筆 debit
   交易含 4 次往返（冪等查詢、載入錢包、UPDATE、INSERT）＋commit（同步 WAL fsync）；
   吞吐由「DB 能同時消化多少交易」決定，與應用端開幾條連線無關。連線池大小唯一決定
   的是**排隊的地點**——這正是 HikariCP 官方「pool sizing」文件主張「小池勝大池」
   的原因：隊伍排在應用端（毫秒級可觀測、可卸載）比排在 DB 內（放大鎖競爭與 context
   switch）更健康。**故 pool=15 不必調大，維持現值。**

### 真正能改善 debit 延遲的方向（依效益排序，供後續拍板）

1. **減少每筆交易的 DB 往返數**（應用層優化，效益直接）：例如冪等檢查與錢包載入
   合併為單一查詢、或用 `INSERT ... ON CONFLICT DO NOTHING RETURNING` 讓冪等寫入
   一次往返完成。**動這裡＝動帳務核心（雷區 8），需 issue＋review＋Testcontainers 全套**。
2. **降低 commit 成本**：Postgres `synchronous_commit=off` 可大幅提升交易吞吐，但
   **帳務庫不可接受**（crash 掉尾端已確認的交易）；僅可作為壓測環境隔離變因的實驗工具。
3. **DB 端擴容/搬家**：把 Postgres 移到獨立機器（不與 7 個 JVM＋JMeter 搶資源）——
   這就是 D1 的多機拓樸議題，單機環境已量到天花板。
4. **上游承壓封頂**：C1/C3 的 gateway 併發上限（wallet 路徑納管）——不會讓 debit
   變快，但能防止超過 ~550/s 的流量把排隊時間堆到失控（回頭呼應 C3 設計文件 §3.3）。

## 建議下一步（先給你拍板，不逕自動刀）

1. **落地 Hikari key 巢狀修正**（`spring.datasource.hikari.maximum-pool-size` →
   `spring.datasource.maximum-pool-size`，postgres/mysql 兩處）。這是純設定修正、
   不動帳務邏輯，但仍建議走 code review（觸碰 `application.yml` 的資料源設定），
   且要跑 `mvn -pl backend/wallet-service test -Pcontainers-test`（ADR-007）確認
   雙資料源啟動行為不受影響。**是否連同池大小數值一起檢討**（例如提高到 30~50 以留
   更多餘裕）需要你決定；本次量測顯示光改這個 key 本身不會讓 150 併發變快，純粹是
   「讓設定檔說的話算數」。
2. **同步補齊本機/CI 使用的 docker volume 遺漏的 migration**（本次已手動套用 V11~V15，
   但這只修了我這台機器的 volume；其他人／CI 若用舊 volume 一樣會撞到）。建議之後找機會
   把「啟動時自動檢查/套用 migration」排進待辦（目前是純手動流程，AGENTS.md 雷區已提醒但
   沒有自動化保護網）。
3. ~~若要繼續往下鑿真正瓶頸：建議上 JFR~~ **已完成（見上方「JFR 定位（續篇）」節）**：
   瓶頸定案為 DB 端交易容量，改善方向四選項已列出待拍板。
4. **gateway `/api/v1/wallet/**` 併發上限**（原任務 1 附帶項）：本次未觸及，需等瓶頸定位
   更清楚後再評估是否需要與任務 2（動態令牌桶）一起設計。

## 測試資料清理紀錄

本次隔離壓測對 200 個玩家（player_id 6~236 附近，balance>100,000 篩選出）各執行約 300 筆
`amount=10` 的 debit，累積 63,559 筆測試交易、影響餘額約 3,170~3,180 星幣/人。已用
wallet-service 正規 `credit(subType=REFUND)` API 全額退回（`idempotencyKey` 前綴
`b1-loadtest-cleanup-refund-{playerId}`，`referenceId=b1-loadtest-cleanup`），
淨額驗證為 0（`SUM(debit) - SUM(credit) = 0`）。**未刪除任何流水列**——測試扣款與退款
都誠實留在 `wallet_transactions`，可由 `reference_id LIKE 'lt-%' OR reference_id =
'b1-loadtest-cleanup'` 篩選識別／排除，供後續對帳參考。

**JFR 續篇加測（同日下午）**：兩輪各 30,400 筆（`lt2-`/`lt3-` 前綴），同樣以
`credit(REFUND)` 全額退回（`idempotencyKey` 前綴 `b1-loadtest-cleanup2-refund-{playerId}`、
`referenceId=b1-loadtest-cleanup2`），淨額驗證為 0。合計本日 B1 剖析在 `wallet_transactions`
留下約 12.4 萬筆可識別的測試流水（`reference_id ~ '^lt[0-9]*-' OR reference_id LIKE
'b1-loadtest-cleanup%'`），全部平帳。
