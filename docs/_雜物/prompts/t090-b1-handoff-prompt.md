# Handoff Prompt: T-090 B1 — wallet debit 路徑剖析＋gateway 動態令牌桶評估

目標 repo：`D:\Lucky_Star_Casino\Lucky_Star_Casino\Lucky_Star_Casino`
開工前必讀：`AGENTS.md`（雷區全表）、`docs/plans/02-T-090-效能調校藍圖.md`（B1 節與進度表）、`docs/performance/T-090-load-test-report.md` 的「Phase A 效果對照重跑」與「C1+C2 效果對照重跑」兩節。

## 任務（兩件，B1 為主）

### 任務 1：B1 — wallet debit 路徑剖析（先量測、再動刀、動刀前先開 issue）

wallet debit 是目前實證的最大瓶頸，證據鏈（2026-07-08 實測，全部有 Prometheus/JTL 佐證）：

| 時點 | debit 平均（150 併發） | debit 平均（1,000 併發） |
|---|---:|---:|
| Phase A 前（當日上午） | 96 ms | 372 ms |
| Phase A 後（當日下午） | 547 ms | 1,070 ms |
| C1+C2 後（承壓封頂 200 在途） | — | 581 ms |

- **同一天內從 96 ms 劣化到 547 ms**（@150 併發）——高度懷疑與 `wallet_transactions`/`game_rounds` 隨當日多輪壓測持續增長有關（表大→索引深度/頁分裂/autovacuum 壓力），但未定位到具體環節。
- 150 併發時 debit 佔成功 spin 延遲的 65%（547/842 ms）；game 端自身成本 Phase A 後只剩 ~300 ms。
- 1,000 併發殘餘失敗六成六在**未受 C1 保護的 `/api/v1/wallet/**` 路徑**（1,305 筆 401＋1,079 筆 SocketTimeout 集中在 balance 查詢）。

剖析步驟（照藍圖 B1，不預設答案）：
1. 用既有 Prometheus 指標拆 wallet-service 內 handler/DB 時間；必要時對 `WalletService.debit` 加 `@Timed`（micrometer 已在）。
2. 檢查點依嫌疑排序：HikariCP `maximum-pool-size` 是否成為排隊點（拿 hikari 指標對照 debit 延遲時間序列）、樂觀鎖重試次數分佈（`wallets.version` 衝突率）、每筆 debit 的同步寫入數（wallets + wallet_transactions + 6/24 注單稽核加了什麼）、game→wallet `WalletClient` HTTP 連線池上限、**表增長 vs 延遲的相關性**（`pg_stat_user_tables`、索引大小、把表 TRUNCATE 回小表重測對照——測試環境可以這麼做，記得先跑完對帳）。
3. 剖析結論寫成文件（issue 或 `docs/` 下的剖析報告）**再動刀**——這是帳務核心（雷區 8：冪等鍵＋樂觀鎖不可動搖），任何改動要 code-reviewer 審＋wallet 的 Testcontainers 真 DB 測試（ADR-007：`mvn -pl backend/wallet-service test -Pcontainers-test`，Windows 需 `$env:DOCKER_HOST='npipe:////./pipe/dockerDesktopLinuxEngine'`）。
4. 順帶評估：`/api/v1/wallet/**` 是否納入 gateway 併發上限（比照 C1 的 `GameConcurrencyLimitGlobalFilter`，或做成 per-route 上限）——與任務 2 一起設計。

### 任務 2：評估 gateway 卸載改「動態令牌桶（Token Bucket）」（使用者指定，先設計評估、與使用者確認後再實作）

現況：C1 用**固定在途上限**（`GameConcurrencyLimitGlobalFilter`，AtomicInteger 200，order -150 在 JWT 前，超限 429+`Retry-After`）。使用者想看動態令牌桶能不能做得更好。評估時要講清楚概念差異（使用者是學習中的 junior，教學模式）：

- 固定在途上限＝**併發**控制（Little's law：在途 = 速率 × 延遲；封頂在途等於間接封頂「速率×延遲」乘積）；令牌桶＝**速率**控制（每秒補 N 個令牌、桶深 B 吸收突刺）。
- 「動態」的意義：refill 速率不寫死，隨後端健康訊號自動調（例如以 admitted 請求的 P95 延遲或 CB 半開狀態作回饋——延遲升→收緊、延遲降→放寬，即 adaptive load shedding / AIMD 思路）。
- 評估要回答：動態令牌桶相對固定在途上限，在「後端延遲波動大」（本案：debit 隨表增長劣化）的場景是否更穩？複雜度/可測試性代價值不值？兩者疊加（桶管速率、在途管排隊深度）是否更好？
- **不可回歸的約束**：150 併發迴歸基準 429 必須 = 0（容量內不准卸載）；拒絕路徑保持 per-instance 零 I/O（不進 Redis）；與 `PlayerRateLimitGlobalFilter`（每玩家公平性，Redis 計數）分工不重疊；語意用測試鎖住（比照 `GameConcurrencyLimitGlobalFilterTest` 的滿載/釋放/cancel/不漏名額 7 個測試）。
- 產出：設計文件（選項對比＋建議），**先給使用者拍板再寫程式**。

## 現況與分支狀態（全部未 push，信任此節、不用重查）

- 開發分支疊層：`develop`（215d3dd）← `feature/huang-c2-gateway-jwt-redis-retry`（C2 短重試，2 commits）← `feature/huang-c1-gateway-concurrency-limit`（C1 併發上限＋語意拍板＋重跑文件＋review 修正＋429 上限 70% 定案，5 commits，HEAD `6e2813c`）。**B1 動 wallet-service 的話另開新分支**（自 develop 或視 C 系列是否已合併）。
- 另有 `feature/huang-t090-perf-phase-a`（PR #190 ＋ 重跑文件 commit `d13ab32`）——與 C1 分支都改了報告/CHANGELOG/藍圖同位置，**後合併者要手動解衝突**（內容互補不矛盾）。
- **驗收 gate 語意已拍板**（藍圖 D1 節有紀錄）：429=卸載不計失敗、P99/5xx/失敗以 accepted 為母體、429 佔比上限 **70%**（`MAX_429_RATIO` 預設 0.70）、150 併發要求 429=0（runner `-Max429Ratio 0`）。D1 未決：最終驗收拓樸（多機）。
- 帳務 gate 歷輪全 PASS，是不可回歸硬底線；Postgres 有 3 筆已知歷史髒資料（player 1001–1003，2026-06-16），對帳時固定排除。

## 環境雷（照抄，別重新踩）

1. 無 `mvnw`，用系統 `mvn`。**`start-all.bat` 已從 repo 移除**——服務啟動方式先問使用者或查現況（notification 已容器化跑在 Docker）。
2. 目前 8080（gateway，C1+C2 碼）與 8083（game-service，Phase A 碼）是上一個 session 的 agent 用 Bash `run_in_background` 起的（父鏈含 `sh`）；其餘服務是使用者自起。重啟配方：先 `Get-NetTCPConnection -LocalPort <port> -State Listen` 殺 OwningProcess，再以 Bash `run_in_background` 跑「逐行去 `\r` 載入 .env（`v="${v%$'\r'}"`，.env 是 CRLF）→ `mvn -q -pl backend/<svc> spring-boot:run`」。
3. **服務重啟後直接壓測＝冷啟動假訊號**：先跑一輪暖機棄置；連跑輪距 ≥2 分鐘（前輪尾段 slow-call 會讓 CB 殘留開路）；以 Prometheus 路徑延遲組成（`increase(sum)/increase(count)` range query，可用舊 JTL 的 max timestamp 回溯查歷史窗口）為主要對照訊號，單輪 JMeter P99 變異大（同日 150 併發 2.7–4.6 s）。
4. JMeter 5.6.3 在 `%TEMP%\apache-jmeter-5.6.3\bin\jmeter.bat`（Temp 會被清，先驗存在；重下載 `https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-5.6.3.zip`）。壓測 runner：`tests\performance\run-slot-load-test.ps1 -Threads N -JMeter <絕對路徑>`（150 時加 `-PlayersCsv <csv> -Max429Ratio 0`）。
5. 玩家 JWT TTL 15 分鐘：provisioning（`node tests/performance/provision-players.mjs`，1,000 名約 7 分鐘，429 尾差用 `PLAYERS=N OUT=<暫存>` 補跑合併 CSV）完成後**立刻**起跑。
6. 本機無 `psql`：對帳用 `Get-Content -Raw tests\performance\accounting-reconciliation.sql | docker exec -i lucky-star-postgres psql -X --cssv -U lucky_user -d lucky_star_casino`（--csv，注意拼寫）。
7. 檢查服務跑的是不是新碼：比對進程 StartTime vs commit 時間＋行為證據（如 Phase A 的 `risk:rtp:*` Redis key）。V15 之類 migration 要手動套進運行中 DB。
8. gateway `spring.data.redis.timeout: 2000ms`＋JWT filter fail-closed（**不可改 fail-open**）＝高併發 401 的來源；C2 已加 1 次 50ms 退避重試。

## 交付要求

- 誠實記錄：實測數字不可虛構、不可為了綠燈調條件（語意修正要明示並過 review）。
- 動了行為就記根目錄 `CHANGELOG.md`（格式照既有條目：標題/Added-Changed/Why/如何驗證）；藍圖進度表同步更新。
- 實作後必跑 code-reviewer（本專案慣例：實作後、commit 前的必經關卡；上兩輪它抓到 3 個真 bug）。
- 驗證指令：`mvn -pl backend/gateway-service,backend/wallet-service test`（wallet 動帳務另加 `-Pcontainers-test`）＋ `node --test tests/infra/*.test.js`。
- **不 push、不開 PR**——完成後留本地 commit 給使用者 review。
