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
5. **可能的真正瓶頸：單機 CPU/執行緒排程競爭**。壓測期間 wallet-service 進程持續消耗約 4 顆核心
   （機器共 12 邏輯核心，còn要跟 postgres/mysql/kafka/zookeeper/load generator 搶）。這與
   D1 拍板紀錄已知的「單機拓樸無法乾淨隔離瓶頸」問題一致，需要更細的 profiling（JFR/async-profiler）
   或多機拓樸才能繼續往下鑿。

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
| （新增）單機 CPU/執行緒競爭 | 未列入原始假說 | **最新首要嫌疑**：壓測期間穩定消耗 ~1/3 機器算力，且與 D1 已知「單機拓樸無法乾淨量測」的結構性問題吻合 |

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
3. **若要繼續往下鑿真正瓶頸**：建議上 JFR（Java Flight Recorder）或 async-profiler 對
   wallet-service 在 150 併發下抓 CPU 火焰圖，直接看時間花在哪一段程式碼／哪個框架層
   （Jackson 序列化？Hibernate flush？Tomcat NIO？GC？），比繼續猜測更有效率。這需要
   額外一輪量測，尚未執行。
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
