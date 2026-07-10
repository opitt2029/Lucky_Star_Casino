# 組員A（組長）— 五天衝刺完整詳答 × Docker 七服務實作教學

> **這份給誰**：跟 `portfolio-組員A-五天衝刺與面試準備.md` 同一個人（組長本人）。
> **跟五天衝刺檔的分工**：衝刺檔是「排程＋檢核清單」（列出每天要能講出什麼）；**本檔就是那些檢核項的完整答案**——每一條「要能講出來」都展開成可以直接背、直接講的逐字稿。面試前拿衝刺檔自測，卡住的題目翻本檔對應段落。
> **另附**：第 6 章是「7 個微服務怎麼放進 Docker」的實作教學——不只講架構，而是從 Dockerfile 逐行解剖到一鍵啟動 SOP，讓你能自己重做一遍、也能在面試被問細節時答得出來。
> 所有內容都對得上專案真實檔案（`docker-compose.yml`、`backend/*/Dockerfile`、`docs/interview-prep/00~13`、`docs/adr/`、`docs/performance/T-090-*.md`），沒有一句是編的。

---

## 目錄

- [Day 1 詳答：全貌、電梯稿、Docker 依賴鏈](#day-1-詳答)
- [Day 2 詳答：帳務主戰場（冪等＋樂觀鎖＋CQRS）](#day-2-詳答)
- [Day 3 詳答：Gateway 與 Redis 全景](#day-3-詳答)
- [Day 4 詳答：T-090 壓測戰役](#day-4-詳答)
- [Day 5 詳答：開發流程、行為題、OOP](#day-5-詳答)
- [第 6 章：Docker 七服務實作教學（從零看懂到自己會做）](#第-6-章docker-七服務實作教學)

---

## Day 1 詳答

### 1.1 三十秒電梯稿（逐字背）

> 「我做過一個叫 Lucky Star Casino 的線上賭場後端，是用 **Java 21 + Spring Boot 3.3.5** 寫的 **Maven 多模組 monorepo**，拆成 **7 個微服務**（gateway、member、wallet、game、rank、admin、notification），前面用 **Spring Cloud Gateway** 做統一入口與 JWT 鑑權。比較有挑戰的是**錢包帳務服務**：我用**樂觀鎖 + 冪等鍵**防止超扣和重複扣款，並且做了 **CQRS 讀寫分離**（PostgreSQL 寫、MySQL 讀），服務之間用 **Kafka** 做事件驅動解耦。」

### 1.2 兩分鐘技術版（面試官說「多講一點」時）

逐點展開，順序固定，講完剛好兩分鐘：

1. **架構**：7 個 Spring Boot 服務，根 `pom.xml` 統一管 Spring Cloud 2023.0.3、JJWT 0.12.6 版本。對外只開 gateway（8080），其餘服務只接受 gateway 轉發或內部呼叫。
2. **認證**：member 用 JJWT 簽 access/refresh token；gateway 一個全域 filter 驗簽 + 查 Redis 黑名單/停用名單做即時撤銷，驗過才注入 `X-User-Id`、`X-User-Role` 給下游。
3. **帳務（最熟的部分）**：JPA `@Version` 樂觀鎖防超扣、`wallet_transactions.idempotency_key` UNIQUE 防重複入帳，固定流程「先查冪等 → 餘額守衛 → 樂觀鎖存檔 → UNIQUE 兜底」。
4. **資料庫**：CQRS——帳務寫 PostgreSQL、高頻查詢走 MySQL 讀庫；wallet/admin 是手動配置雙 DataSource。
5. **事件驅動**：Kafka 解耦；把「指令」（`wallet.credit.request`）和「事件」（`wallet.credit`）分開，避免服務自己消費自己造成無限迴圈；失敗訊息進 DLT 由後台手動重試。
6. **遊戲**：Provably Fair（SHA-256 對 serverSeed+clientSeed+nonce）讓結果可事後驗證，加 per-game RTP 風控門檻。
7. **壓測**：JMeter 1,000 併發實測，用 Prometheus 證據鏈修掉 gateway TimeLimiter 誤判（5xx 78%→0）、JFR 定位單機 Postgres 交易容量 ≈550–600 筆/秒，最後在 gateway 做 AIMD 自適應在途上限卸載；全程帳務不變量 0 違規。

### 1.3 白板架構圖（畫這條）

```text
Frontend (React :5173)
   │
   ▼
Gateway :8080  ── IP限流(-200) → JWT驗證(-100) → 玩家限流(-50)
   │
   ▼
game-service :8083 ──(同步 REST + INTERNAL_SECRET)──▶ wallet-service :8082
   │                                                    │  PostgreSQL(寫) / MySQL(讀)
   │                                                    │
   │◀─────────── HTTP response（下注結果+餘額）──────────┘
   │
   └─▶ Kafka ──▶ rank-service :8084（排行 Redis ZSet）
             └─▶ notification-service :8087（WebSocket/STOMP 推播）
```

講圖時三個強調點：
- **資金正確性走同步 REST**（下注成不成立取決於扣款成功與否，不能事後才知道）。
- **排行/通知走 Kafka 非同步**（不阻塞下注主流程，各服務可獨立擴容）。
- **對外只開 gateway 一個口**，服務間內部呼叫走 `/internal/**` + `INTERNAL_SECRET`，不經 gateway。

### 1.4 Docker 啟動依賴鏈（背這條）

```text
mysql / postgres / redis（healthy）
  → kafka（healthy）
    → kafka-init（completed，one-shot 建 topic 後退出）
      → member-service（healthy）
        → wallet-service / rank-service（healthy）
          → game-service（healthy，額外等 wallet，因為派彩要呼叫它）
          → admin-service（healthy，額外等 member，因為停權要同步）
          → notification-service（healthy，只等 kafka-init）
            → gateway-service（最後）
```

### 1.5 Day 1 三個必答題（完整答案）

**Q：為什麼 gateway 容器最後啟動？**
> 「gateway 的工作是把流量轉發給全部下游服務，它自己沒有業務邏輯。如果它先起來、下游還沒 ready，前端打進來只會收到一堆連線錯誤或 fallback。所以 compose 裡 gateway 的 `depends_on` 列了全部六個業務服務都要 `service_healthy` 才啟動——等大家都能接客了，才開大門。」

**Q：kafka-init 為什麼是 one-shot 容器？**
> 「建 topic 是『做一次就完成』的初始化動作，不是常駐服務。kafka-init 用跟 kafka broker 同一個 image，掛載 `kafka/kafka-init.sh` 進去執行、建完 8 個業務 topic + 5 個 DLT 就正常退出。其他服務用 `depends_on: kafka-init: condition: service_completed_successfully` 等它跑完——這保證服務啟動時 topic 一定已存在，不會出現 consumer 訂閱不存在 topic 的競態。如果做成常駐服務，healthcheck 語意會很彆扭（它沒有『健康』狀態，只有『做完了沒』）。」

**Q：`JWT_SECRET` 缺了會怎樣？**
> 「服務直接啟動失敗——這是刻意設計的 **fail-fast**（`02` 決策 8）。`JWT_SECRET`、`INTERNAL_SECRET`、`CORS_ALLOWED_ORIGINS` 都沒有預設值，因為一個空的或寫死的密鑰若默默帶上線，等於任何人都能偽造 token。與其給『安全的預設值』然後被忘掉，不如讓錯誤在啟動這個最早、最明顯的時間點爆出來，逼你正確配置。」

---

## Day 2 詳答

### 2.1 `debit()` 四步流程（默寫版＋每步的為什麼）

程式位置：`wallet-service/.../service/WalletService.java`。

```text
① 冪等檢查      用 idempotencyKey 查 wallet_transactions，
                已存在 → 直接回傳舊結果，完全不再扣錢（快路徑）
② 餘額守衛      可用餘額 = balance − frozenAmount，
                不足丟 InsufficientBalanceException → HTTP 422
③ 樂觀鎖存檔    walletRepository.save(wallet)，@Version 不符時
                Hibernate 丟 ObjectOptimisticLockingFailureException → HTTP 409
④ UNIQUE 兜底   兩個併發請求都通過①時，DB 的 idempotency_key UNIQUE
                擋下第二筆 INSERT（DataIntegrityViolationException），
                回查並回傳「贏家」的紀錄
```

每步的為什麼：
- **①是效能優化不是防線**：讓重試的請求快速拿到舊結果，省一次寫入嘗試。
- **②用「可用餘額」**：凍結中的金額（下注未結算）不能再拿去下注，所以是 `balance − frozenAmount` 而非裸 balance。
- **③防的是「不同請求」併發改壞餘額**（超扣）。
- **④防的是「同一請求」重試造成重複扣款**——而且是**真正的防線**（見下一題）。

### 2.2 「為什麼光查一次冪等鍵不夠？」（面試官最愛追問）

> 「因為『先 SELECT 沒有、再 INSERT』在併發下有 **check-then-act（TOCTOU）競態**——兩個帶同一個冪等鍵的請求同時進來，都 SELECT 不到、都認為自己是第一筆、都去 INSERT。應用層的檢查無法原子化這兩步。所以真正的防線是 **DB 的 UNIQUE 約束**：資料庫保證同一個鍵只有一筆 INSERT 會成功，第二筆吃 `DataIntegrityViolationException`，我們接住它、回查第一筆的結果回傳。應用層那次查詢只是省事的快路徑。」

### 2.3 「為什麼用樂觀鎖不用悲觀鎖？」

> 「看**衝突率**。賭場下注整體高併發，但『同一個玩家同時多筆下注』其實罕見——衝突率低。樂觀鎖不鎖資料列、不佔住 DB 連線，吞吐高；真的撞版本就讓那筆 409 重試。悲觀鎖 `SELECT ... FOR UPDATE` 會把列鎖住，高併發下容易連線堆積、拖垮吞吐。反過來說，如果是『獎池』這種所有人打同一列的熱點帳戶，樂觀鎖會狂衝突狂重試，悲觀鎖排隊反而更好——**視衝突率選鎖**，這句是關鍵。」

追問「樂觀鎖衝突之後呢？」：
> 「回 409 給呼叫方，由呼叫方決定重試；不在 service 內無限自旋。若要自動重試也要設上限、重讀最新版本再試。」

### 2.4 「為什麼 wallet 絕不消費 `wallet.credit`？」

> 「因為 `wallet.credit` 是 wallet **自己發的事件**。如果它又去消費這個 topic、在 listener 裡呼叫 `credit()`，就是自己收自己發的訊息 → 再入帳 → 再發事件 → **無限迴圈，帳務爆炸**。所以 ADR-002 把 topic 拆成兩個語意：`wallet.credit.request` 是**指令**（『請幫我入帳』，member/admin 發、wallet 消費），`wallet.credit` 是**事件**（『已經入帳了』，wallet 發、rank 消費）。wallet 只消費指令、只發事件，迴圈從結構上斷掉。
> 專案裡有一個唯一安全例外：`WalletReadSyncListener` 確實消費 `wallet.credit`/`wallet.debit`，但它只把資料**同步進 MySQL 讀視圖**（CQRS read-sync），做 `existsById` 冪等檢查、絕不呼叫 `credit()`/`debit()`，所以不會迴圈。」

### 2.5 「讀庫有延遲怎麼辦？」

> 「CQRS 的代價就是最終一致性——寫進 PostgreSQL 之後 MySQL 讀庫有毫秒級同步延遲。我們的處理原則是**按一致性需求分流**：查餘額這種要強一致的直接打 PostgreSQL 寫庫；只有交易歷史列表這種容忍延遲的才走 MySQL。不是所有讀都走讀庫，是『能容忍延遲的讀』才走。」

補充（雙資料源程式怎麼接，常一起被問）：
> 「一旦有兩個 DataSource，Spring Boot 的 `spring.jpa.*` 自動配置就失效了，必須在 `DataSourceConfig` 手動建兩組 EntityManagerFactory / TransactionManager，PostgreSQL 那組標 `@Primary`、掃 `postgres.entity` 套件，MySQL 那組掃 `mysql.entity`。每個 `@Transactional` 都明確指定 `transactionManager`，避免『以為走 A 其實走 B』。」

### 2.6 白板題：下注請求流全程（含失敗模式）

```text
Frontend ── POST /api/v1/game/slot/spin ──▶ Gateway
   Gateway：IP限流 → JWT驗證(注入 X-User-Id) → 玩家/遊戲限流
   ▼
game-service SlotController → SlotService
   產生 roundId / serverSeed / clientSeed
   ▼
walletClient.debit(playerId, bet, "slot-bet-"+roundId)   ← 同步 REST
   wallet：冪等檢查 → 餘額守衛 → @Version 樂觀鎖 → 寫流水 → 發 wallet.debit
   ▼
game-service RNG 結算 → 若中獎：
walletClient.credit(playerId, payout, "slot-win-"+roundId) ← 同步 REST
   wallet：同上四步 → 發 wallet.credit
   ▼
game-service 寫 game_rounds = SETTLED → 發 game.result
   ▼
HTTP response 回前端（下注結果 + 最新餘額）

非同步分支：
wallet.credit/debit → rank-service → Redis ZSet → rank.update → notification → /topic/rank
game.result → notification-service → /user/queue/notifications
```

**冪等鍵命名有規律**（重試安全的根基）：`slot-bet-<roundId>`、`slot-win-<roundId>`、`fishing-buyin-<sessionId>`——由業務 ID 決定、不是隨機值，所以同一筆操作不管重試幾次都是同一個鍵。

**追問「debit 成功、credit 失敗怎麼辦？」（接 ADR-009）**：
> 「這是玩家已扣款、已贏、錢卻沒進帳的資金缺口，不能只留 error log。我們做了**最小 Saga 補償**：credit 失敗的 catch 裡落一筆 `pending_wallet_credits` 補償單，背景排程每 30 秒重試，**帶與原始呼叫完全相同的冪等鍵**。鍵絕不可換——因為原始呼叫可能其實成功了、只是回應在網路上丟了，同鍵重試會被 wallet 的 UNIQUE 冪等擋下，不會重複派彩；換了鍵就是雙倍入帳。語意上這是『重試同一筆 WIN 派彩』，不是退款。另外有對帳腳本 `reconcile-game-wallet.mjs` 掃差異，重試耗盡的 FAILED 單轉人工。
> 為什麼不用 Seata/Temporal 這種完整 Saga 框架？因為參與者只有 wallet 一個、失敗型態只有一種，一張補償單表加一個排程就夠了——用框架是殺雞用牛刀。」

---

## Day 3 詳答

### 3.1 Filter 順序及為什麼（`FilterOrder.java`）

```text
RATE_LIMIT (-200)          IP/全站限流
  ↓
JWT_AUTHENTICATION (-100)  驗簽 + Redis 撤銷檢查 → 注入 X-User-Id / X-User-Role
  ↓
PLAYER_RATE_LIMIT (-50)    依 X-User-Id 的玩家級限流
  ↓
路由轉發 (order ≥ 0)
```

> 「順序是成本與依賴決定的：**IP 限流最先**，因為它最便宜——被它擋掉的請求連 JWT 驗簽、Redis 查詢的成本都省了，這是保護 gateway 自己。**JWT 第二**，因為它產出 `X-User-Id`。**玩家限流最後**，因為它的限流 key 就是上一步注入的 `X-User-Id`——依賴關係決定它必須排在 JWT 之後。」

### 3.2 JWT 三層 Redis 撤銷 + fail-closed

> 「JWT 是無狀態的，簽出去到過期前都有效，所以『登出』『停權』沒辦法直接撤銷 token 本身。我在 gateway 驗簽之後加三層 Redis 檢查：
> ① `jwt:blacklist:{jti}`——登出時 member 把這顆 token 的 jti 丟進黑名單，TTL 設到原始過期時間；
> ② `disabled:player:{sub}`——後台停權時 admin 寫入，即時封鎖該玩家全部 token；
> ③ `token:min-iat:{sub}`——記『簽發時間下限』，改密碼/強制登出時把它設成現在，之前簽的舊 token 全部作廢。
> **Redis 掛掉時選 fail-closed**：`onErrorResume` 一律視為封鎖、回 401。寧可誤擋合法請求，也不能讓已撤銷的 token 復活——安全系統預設要 deny。」

### 3.3 「怎麼防前端偽造 `X-User-Id`？」

> 「兩個動作：**白名單路徑先剝除**——不需要 JWT 的路徑（如 `/api/v1/auth/**`）在放行前先把請求裡可能被用戶端塞進來的 `X-User-Id`/`X-User-Role` header 移掉；**驗證後先 remove 再 set**——通過驗簽的請求，注入身份前也先移除同名 header，再寫入 gateway 自己從 token 算出來的值。原則是：這兩個 header 只信 gateway 產出的，用戶端傳什麼都當垃圾。」

### 3.4 「服務間為什麼用 `INTERNAL_SECRET` 不用 JWT？」

> 「語意不同：JWT 代表**某個玩家**，服務間呼叫（例如 game 呼叫 wallet 扣款）代表的是**可信服務**，不是任何玩家的行為。game 手上也不該有玩家的 token。所以內部 API 走 `/internal/**` 路徑、帶共享密鑰 `X-Internal-Secret` header，由各服務的 `InternalSecretFilter` 驗證（用 `MessageDigest.isEqual` 比對防 timing attack）。這些路徑不經 gateway、不對外開放。」

### 3.5 路由順序陷阱故事（雷區 19，講成故事）

> 「Spring Cloud Gateway 的路由是**按宣告順序**比對的。我們踩過一次：member-service 提供簽到端點 `/api/v1/wallet/daily-checkin`——路徑在 `/api/v1/wallet/**` 底下，但服務在 member。當時 wallet 的 catch-all 路由 `Path=/api/v1/wallet/**` 排在前面，簽到請求被它吃掉、轉發到 wallet-service，而 wallet 根本沒這個端點 → 404。修法是把 `member-checkin` 這條**具體路徑路由排在 catch-all 之前**。沉澱下來的規則：具體路徑永遠排在萬用路徑前面，而且這條寫進了 AGENTS.md 地雷清單。」

### 3.6 「限流 fail-open、JWT 撤銷 fail-closed——為什麼相反？」

> 「看**故障時放行的後果**。限流元件壞了放行，後果是多扛一點流量，系統可能慢但不會錯——所以 fail-open，別讓限流元件的故障拖垮整體可用性。JWT 撤銷檢查壞了放行，後果是**已登出、已停權的 token 復活**，這是安全漏洞——所以 fail-closed，寧可誤擋。同一個 Redis、兩種相反的降級策略，取捨標準是『放行的最壞後果是什麼』。補充：捕魚 session 是第三種——Redis 是唯一真相來源、無 fallback，掛了當批直接失敗，因為戰鬥狀態沒有任何替代來源。」

### 3.7 前端 401 靜默續期 single-flight（E 專項加分題）

> 「access token 過期時前端會收到 401，axios 回應攔截器會**自動用 refresh token 換新的、再重送原請求**，使用者無感。關鍵是 **single-flight**：後端 refresh 會輪替 refresh token（用一次就作廢），如果 10 個請求同時 401、各自去 refresh，只有第一個成功、其餘拿著已作廢的舊 token 續期全部失敗、互相把對方登出。所以用一個共享的 `refreshPromise` 把續期序列化，10 個請求共用同一次續期結果。另外兩個細節：refresh 請求用『乾淨的』原生 axios 而非同一個 api 實例，避免被自己的攔截器遞迴攔截；auth 端點的 401（帳密錯誤）走白名單不觸發整頁登出。」

---

## Day 4 詳答

### 4.1 三十秒版（逐字背，`13` §0）

> 「我們用 JMeter 對老虎機下注 API 做了 150 和 1,000 併發的壓測，全部真實執行、沒實測的數字絕不捏造。第一輪 1,000 併發失敗率接近九成，我們用 Prometheus 指標把根因鏈定位到 **gateway 的 Resilience4j CircuitBreaker 沒設 TimeLimiter、預設 1 秒逾時**，把正常慢呼叫腰斬誤判成失敗、觸發熔斷反覆開闔。修掉之後 150 併發 5xx 從 78% 歸零。之後瓶頸換位到 wallet 扣款，我用 **JFR 剖析**證明真正的天花板是**單機 PostgreSQL 的交易容量約每秒 550–600 筆**——連線池調大只是把隊伍從應用內搬到資料庫內，總延遲不變。所以最後一步不是再壓榨延遲，而是在 gateway 做 **AIMD 自適應在途上限**把超額流量禮貌卸載。最重要的是：**每一輪不管效能多慘，帳務不變量都是 0 違規**——超扣 0、重複扣款 0、對帳全過。效能撐不住，但一毛錢都沒算錯。」

### 4.2 根因鏈（白板默畫）

```text
gateway 的 CircuitBreaker 沒顯式設定 TimeLimiter
  → Resilience4j 預設呼叫逾時 1 秒
  → 高併發排隊下的「正常慢呼叫」(0.9~3.6s) 在完成前被腰斬、判 failed
  → 失敗率灌爆 CB 統計 → 熔斷開路 (503)
  → half-open 少量放行 → 關路瞬間 thundering herd 又推爆延遲
  → 再開路……反覆開闔 (flapping)
```

**關鍵矛盾點**（面試官若懂 Resilience4j 會考這個）：設定檔明明寫了 `slow-call-duration-threshold: 3s`，但預設 TimeLimiter 1 秒就把呼叫砍了——**慢呼叫根本活不到被 slow-call 統計的那一刻**。修正是一行：`timeout-duration: 6s`（略高於 3s 門檻，讓慢呼叫走完、交給 CB 的 slow-call 統計判定）。

### 4.3 證據鏈（「你怎麼確定是這個原因？」）

> 「我不是猜的。修正前 Prometheus 的 `resilience4j_circuitbreaker_calls_seconds_count{kind="failed"}` 是 game ≈1,172、wallet ≈424；修正後**全服務歸零**——『1 秒誤判』這個環節被證明消失了。剩下的 CB 開路全由 slow-call rate 觸發，那是**設計內的合法飽和卸載**，性質完全不同。分清楚『誤判的失敗』和『設計內的卸載』，後續調校才不會打錯靶。」

### 4.4 數字精確版（別背混）

| 指標 | 修正前 | 修正後 |
|---|---:|---:|
| 150 併發 HTTP 5xx | 13,563（78.0%） | **0** |
| 150 併發失敗樣本 | 13,563 | **4（0.05%）** |
| 1,000 併發 5xx | 13,709（86.1%） | 3,870（30.9%，−72%） |
| CB failed calls（Prometheus） | game ≈1,172 / wallet ≈424 | **全服務 = 0** |

注意：「5xx 歸零」和「失敗樣本 4」是**兩個指標**——那 4 筆是疑似瞬斷、非 5xx。履歷/口頭都不要混成一句「13,563→4 次失敗所以 5xx 歸零」。

### 4.5 瓶頸換位故事（修一處、擠到另一處）

> 「TimeLimiter 修掉後每一輪都觀察到同一件事：**瓶頸不會消失，只會搬家**。修了 game 端，壓力擠到 wallet debit（平均 96→547ms 劣化）；C1 在 gateway 對遊戲路徑設在途上限 200、超限回 429，1,000 併發成功 +126%、401 −63%——但 429 是毫秒級回覆，**被拒的執行緒循環變快，反而把沒設上限的 wallet 路徑打得更兇**。教訓：卸載要覆蓋所有路徑，不設防的路徑會變成新瓶頸。」

三個配套觀念：
1. **401 雪崩的本質是 fail-closed 的代價**：起跑瞬間 Redis 過載，JWT 撤銷檢查 fail-closed 全判拒絕。解法不是放棄 fail-closed（安全優先），是加一次 `50ms backoff` 短重試（C2），把「瞬時抖動」和「真故障」分開。
2. **卸載要早**：C1 把在途上限放在 JWT 驗證**之前**，被拒的請求連驗簽和 Redis 查詢都省了——保護的不只是下游，還有 gateway 自己。
3. **排隊理論鐵律**：需求速率遠超單機容量（~180 req/s 全鏈路）時，「需求 − 容量」的差額必然變成 429 或逾時。429 佔比超過 40% 上限我們照實判 FAIL——這是容量問題該由部署拓樸解決，不是調數字能解決的。

### 4.6 B1 排除法（DBA 向金礦）

> 「wallet debit 同一天內從 96ms 劣化到 547ms，我用排除法查：
> ① **連線池太小？** 先真的抓到一個 bug——Hikari `maximum-pool-size` 用了巢狀 key 寫法**從未生效**，一直跑預設 10。修正後 A/B 對照：pool 10→15→60，**延遲幾乎不變**，穩態 active 連線只有 13~25。→ 有 bug，但不是主因。
> ② **MVCC 膨脹？** `pgstattuple('wallets')` 量得 dead tuple 8.57%，解釋不了 5 倍劣化。→ 排除。
> ③ **最終用 JFR 定位**：瓶頸是 **DB 端交易容量**——單機 PostgreSQL 約每秒 550–600 筆 debit 交易。每筆 debit 是『冪等查詢 + 樂觀鎖 UPDATE + 流水 INSERT』的同步交易，單機 Postgres 就是吞不下更多。」

**金句（背熟）**：
> 「連線池大小只決定隊伍排在應用內（Hikari）還是資料庫內（Postgres），總延遲不變。」

後續選項（展現視野）：
> 「這個結論宣告『應用層再怎麼調都沒用了』，只剩三條路：擴 DB、改帳務模型（批次/非同步化）、或在入口卸載超額流量。我們選第三條，因為前兩條動的是帳務正確性的地基，風險不成比例。」

### 4.7 C3 選型：為什麼是「動態在途上限」不是「動態令牌桶」

| | 在途上限（併發控制） | 令牌桶（速率控制） |
|---|---|---|
| 控制的量 | **同時**在系統內的請求數 | **每秒**放進去的請求數 |
| 對後端延遲的感知 | **天然有**——後端變慢→請求滯留→在途數頂到上限→自動收緊（Little's Law：L = λ×W） | **完全沒有**——後端慢到跪了，令牌照發 |

> 「限流設計我會先問：你要控制的是速率還是併發？後端延遲波動大（debit 同日 96→547ms）的場景要選**併發控制**，因為在途上限透過 Little's Law 天然感知後端變慢。上限值用 **AIMD** 動態調——跟 TCP 壅塞控制同一個思想：健康就加法遞增慢慢探容量，惡化就乘法削減快速讓路。並把 wallet 路徑一起納管（第二幕的教訓）。程式在 gateway 的 `RouteConcurrencyLimitGlobalFilter` + `AdaptiveInFlightLimiter`。」

### 4.8 C3+B1 對照重跑（07-09，含歸因誠實聲明）

| 場景 | 指標 | C1（07-08） | C3+B1（07-09） |
|---|---|---:|---:|
| 150 併發 | P99 | 2,753 ms | **1,423 ms（−48%）** |
| 150 併發 | 吞吐 | 86.8/s | 169.7/s |
| 1,000 併發 | 成功（HTTP 200） | 1,477 | **7,829（+430%）** |
| 1,000 併發 | HTTP 401 | 1,988 | **0** |
| 1,000 併發 | SocketTimeout | 2,124 | 136（−94%） |
| 1,000 併發 | 429 佔比 | 46.2% | 65.3%（>40% 誠實判 FAIL） |
| 1,000 併發 | 被接受請求成功率 | 23.9% | **78.4%** |

> 「但我會主動講清楚：這輪 wallet 同時帶著 B1 的連線池修正，**延遲改善是兩個改動疊加、不能全記在 C3 頭上**——debit 平均 581→492ms 主要歸 B1；C3 的貢獻是 wallet 路徑首次被在途上限保護，401 和連線層失敗這類『未設防路徑被打爆』的失敗模式被根治。殘餘課題也收斂成單一形態：2,024 筆 game spin 的 503（CB not_permitted），下一步是協調 AIMD 延遲目標與 CB 慢呼叫閾值，別讓兩層保護互踩。」

### 4.9 底線句 + 追問鏈七題（逐字）

**底線句**：
> 「效能 gate 我們 FAIL 過很多輪，帳務 gate 一輪都沒 FAIL 過——系統過載時它選擇拒絕服務，而不是算錯錢。」

**Q1：P99 還是不達標，這個壓測算成功嗎？**
> 「算。壓測的目的是知道系統的真實邊界在哪、超過邊界時的行為是什麼。我們拿到了：單機容量 ~180/s 全鏈路、DB 交易容量 ~550–600/s、過載時安全卸載不壞帳。P99 500ms 的 gate 本來是為多機部署訂的，單機達不到是容量問題不是程式缺陷——這個結論本身就是壓測最值錢的產出。」

**Q2：為什麼不 mock 掉 DB 來壓？**
> 「因為我們要測的就是含 DB 交易的真實帳務路徑；mock 掉 DB 的壓測數字對容量規劃毫無意義。」

**Q3：thundering herd 是什麼？你們怎麼遇到的？**
> 「熔斷 half-open 放行成功、關路瞬間堆積的流量一起灌進來、又把後端推爆再開路。我們的 flapping 是 TimeLimiter 1 秒誤判餵出來的，解法不是調熔斷參數，是先消滅誤判來源。」

**Q4：卸載回 429 不會傷害用戶體驗嗎？**
> 「比較對象不是『429 vs 成功』，是『毫秒級 429+Retry-After vs 5 秒逾時後失敗』。快速失敗讓客戶端能立刻退避重試，被接受的請求延遲反而腰斬（實測成功 spin 平均 5.21s→2.65s）。」

**Q5：接下來要真的過 1,000 併發，你會怎麼做？**
> 「順序：① 多機拓樸讓 DB 獨占資源（先驗證單機結論是否環境限制）② DB 垂直擴容/讀寫再分離 ③ 帳務層批次合併寫入（犧牲即時性換吞吐，要重新評估正確性）④ 熱點帳戶分片。每一步都先量測再動手，不跳步。」

**Q6：JFR 跟一般 profiler 差在哪？**
> 「JVM 內建、常駐開銷極低（<1%）、能看到 safepoint、鎖競爭、IO 等待這些 APM 看不到的層次，適合在壓測當下直接掛在生產級負載上。」

**Q7：C3 上線後有實際重跑驗證嗎？**
> 「有，隔天帶著 B1 的連線池修正一起重跑：150 併發 P99 打對折、1,000 併發成功 +430%、401 歸零、被接受請求成功率 23.9%→78.4%。但兩個改動疊加、功勞不能全記給限流機制——debit 延遲的絕對改善主要是連線池修正的貢獻。429 佔比升到 65.3% 我們照實判 FAIL 不調數字，因為那是需求超過容量的算術必然，不是機制缺陷。」

---

## Day 5 詳答

### 5.1 開發流程三十秒版（逐字背，`09` §0）

> 「我們是 **monorepo + fork/PR 工作流**。任務來自工作分配表（T-000~T-114）。動工前一定先讀 `AGENTS.md` 的已知地雷，避免重踩。開發走 **feature 分支 → PR 回 develop → 至少 1 人 review → CI 綠燈才 merge**，`main` 受保護不能直接 commit。我們有四個很硬的紀律：**(1) 每個變更都要在 CHANGELOG 寫清楚『為什麼』跟『如何驗證』；(2) 架構級決策要寫 ADR 留軌跡；(3) 改完一定本機先把測試跑綠；(4) 沒實測的數字絕不捏造**。帳務這種敏感邏輯還有額外鐵則：所有扣款入帳都要『冪等鍵 + 樂觀鎖』。」

### 5.2 任務生命週期九關（提詞卡）

| 關卡 | 一句話 |
|---|---|
| ① 動工前 | 先讀 AGENTS.md 地雷、拿 git log/程式碼交叉驗證進度（文件會過時，程式碼不說謊） |
| ② 分支 | 從 develop 切 `feature/名字-功能`，同步用 rebase 不用 merge |
| ③ 調查 | 先復現、定位根因，不修表面 |
| ④ 決策 | 架構級寫 ADR，一般決策寫進 CHANGELOG 的「為什麼」 |
| ⑤ 實作 | surgical change + 單一真相 + 帳務鐵則 + 四同步 |
| ⑥ 驗證 | H2 測試綠 + lint/build 綠 + 沒測到的不謊報 |
| ⑦ 文件 | CHANGELOG 寫「為什麼／如何驗證」 |
| ⑧ 合併 | PR 回 develop、至少 1 review、CI 綠、Squash merge |
| ⑨ 收尾 | 踩到新雷沉澱回 AGENTS.md |

被問「怎麼測試、沒有 DB 怎麼跑」：
> 「測試一律用 H2 記憶體資料庫，CI 不用起真 DB；雙資料源的 wallet 用兩個 H2 模擬 CQRS。分層：純邏輯 Mockito 單元測試、跨資料源交易用真實雙 H2 整合測試（驗『餘額不足整批回滾』『同鍵重放只扣一次』這種 mock 驗不出來的）、再上面有 smoke test 經 gateway 打全鏈路。另外 wallet 有 Testcontainers 真 DB 測試（ADR-007）攔 entity↔schema 漂移，`@Tag("containers")` 隔離、日常 `mvn test` 仍零依賴。」

### 5.3 行為題故事 A：主動移除自己做過的設計（幸運值保底）

> 「我們一度做了『幸運值集滿就保底必中』的機制，玩家體感很好。但後來意識到它**違反 Provably Fair 精神**——等於伺服器偷偷讓玩家必中，而我們同時提供結果驗證端點，玩家可以截圖舉證『結果被竄改』，這是信任甚至法律層面的漏洞。於是我們把這套機制**前後端、視覺、死碼、測試、mock 全部移除**，百家樂改成業界標準的『反水』（無論輸贏返還 0.5%，透明公平）。我學到：**正確性和透明度比『讓玩家爽』重要**——一個短期討喜但破壞系統可信度的設計，再可愛也要拿掉。」

### 5.4 行為題故事 B：最難的 bug——大魚永遠打不死

> 「捕魚機玩家回報『大魚怎麼打都打不死』，表面像數值問題，挖下去發現是**狀態持久化的接縫**：魚的累積傷害存在 Redis Hash，但 `FishingSessionStore` 的序列化**漏存了 `fishDamage` 欄位**——每批射擊重讀 session 時這個 Map 被重置成空，累傷永遠歸零、大魚 HP 每批『回滿』。小魚單批內打得死所以沒暴露，大魚要跨批才會現形。更關鍵的是它為什麼漏網：原本的測試**把整個 store mock 掉了**，序列化根本沒被測到。我學到兩件事：一是狀態持久化要連『序列化有沒有真的存進去』一起測，不能整個 mock 掉；二是 bug 躲在單元測試覆蓋不到的接縫，所以後來補了真 store 的 round-trip 測試和跨批整合測試專門守它。」

### 5.5 OOP 四支柱（各一個專案實例，一句話版）

| 支柱 | 專案實例 | 一句話 |
|---|---|---|
| 封裝 | `Wallet` entity + `WalletService` | 餘額不讓外面直接 set，所有變更走 debit/credit 收斂進四步流程，不變量（不為負、有流水）在一處守住 |
| 繼承 | 例外體系（`InsufficientBalanceException` 等繼承共同基底） | 共同行為寫一次，`GlobalExceptionHandler` 按型別統一轉 HTTP 狀態碼 |
| 多型 | `GlobalExceptionHandler` 分派 / `JpaRepository` 動態代理 | 呼叫方只認介面，執行期依實際型別走不同行為 |
| 抽象 | `SlotSymbol.fromWeightedIndex()`、分層架構本身 | 把「加權抽獎」的細節藏在 enum 後面，呼叫方只管「給我一個符號」；Controller/Service/Repository 分層每層只暴露必要介面 |

設計模式被問到：
> 「有，但都是『需要才用』：Builder（entity/DTO）、Strategy（多遊戲各自的結算邏輯）、Template Method（測試基底類）、Proxy（Spring AOP/`@Transactional`）、Observer（Kafka 事件驅動本身就是）。我們不為用而用——ADR-009 就特別記了『為什麼不用完整 Saga 框架』。」

### 5.6 Demo 演練腳本（報告日照這個跑）

1. `docker compose up -d` → 開 `docker compose ps` 秀依賴鏈啟動順序（infra healthy → kafka-init 退出 → 服務逐個 healthy → gateway 最後）——履歷第三句的現場證明。
2. 登入 → 查餘額 → 下注扣款：邊做邊講「這一筆過了 gateway 三層 filter、wallet 四步防線」。
3. 快速連打觸發 429 → 講限流層次與 Retry-After。
4. 收尾引壓測數據：TimeLimiter 修正 5xx 78%→0、C3+B1 重跑 1,000 併發成功 +430%、401 歸零、帳務全程 0 違規。
5. E 專項投影片素材：E1 路由表、E2 容器依賴鏈、E3 topic 表、E4 Redis key 表（分工指南現成表格直接貼）。

---

## 第 6 章：Docker 七服務實作教學

> 這章回答「7 個微服務怎麼放進 Docker、怎麼架起來」。專案的容器化**已經做完**（根目錄 `docker-compose.yml` + 各服務 `backend/*/Dockerfile`），所以這章不是叫你重做，而是**帶你看懂每一行為什麼這樣寫**——看懂之後你就會做了，面試被問任何細節也答得出來。

### 6.1 先建立三個概念

| 概念 | 是什麼 | 對應本專案 |
|---|---|---|
| **Image（映像檔）** | 打包好的「程式 + 執行環境」唯讀模板 | 每個服務用自己的 Dockerfile build 出一個 image |
| **Container（容器）** | image 跑起來的實例，隔離的行程 | `lucky-star-wallet-service` 等 16 個容器 |
| **Compose（編排）** | 一個 YAML 宣告「要跑哪些容器、誰依賴誰、怎麼連網」 | 根目錄 `docker-compose.yml`，`docker compose up -d` 一鍵全起 |

心智模型：**Dockerfile 解決「一個服務怎麼變成 image」，compose 解決「16 個容器怎麼一起活」**。

### 6.2 Dockerfile 逐行解剖（以 wallet-service 為例）

`backend/wallet-service/Dockerfile`（七個服務的 Dockerfile 結構完全相同，只差模組名和 port）：

```dockerfile
# ---- Stage 1: build ----
FROM maven:3.9-eclipse-temurin-21 AS build     # 帶 Maven + JDK 21 的建置環境
WORKDIR /workspace

COPY pom.xml .                                  # 先只複製 pom（root + 全部模組）
COPY backend/gateway-service/pom.xml backend/gateway-service/pom.xml
COPY backend/member-service/pom.xml backend/member-service/pom.xml
COPY backend/wallet-service/pom.xml backend/wallet-service/pom.xml
# ...（其餘模組 pom 同理）

RUN --mount=type=cache,target=/root/.m2 \
    mvn -q -pl backend/wallet-service -am dependency:go-offline   # 先抓依賴

COPY backend backend                            # 這時才複製原始碼
RUN --mount=type=cache,target=/root/.m2 \
    mvn -q -pl backend/wallet-service -am -DskipTests package     # 打 jar

# ---- Stage 2: runtime ----
FROM eclipse-temurin:21-jre-jammy AS runtime    # 只帶 JRE 的輕量執行環境
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /usr/sbin/nologin appuser
COPY --from=build /workspace/backend/wallet-service/target/wallet-service-0.0.1-SNAPSHOT.jar app.jar
USER appuser
EXPOSE 8082
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

四個設計重點（面試題就藏在這裡）：

1. **Multi-stage build（兩階段建置）**：Stage 1 用「Maven + JDK」的胖 image 編譯，Stage 2 只把編好的 jar 複製進「純 JRE」的瘦 image。最終 image 不含 Maven、原始碼、建置快取——**體積小、攻擊面小**。這是「為什麼你的 image 不會幾 GB」的答案。
2. **先 COPY pom、再 COPY 原始碼**：Docker 建置有**層快取（layer cache）**——某一層的輸入沒變就直接用快取。依賴清單（pom）很少變、原始碼天天變，把「抓依賴」放在「複製原始碼」之前，改一行 code 重 build 時依賴層全部命中快取，只重跑打包。順序反過來的話每次改 code 都要重新下載全部依賴。`--mount=type=cache,target=/root/.m2` 再把本機 Maven 快取掛進去，double 保險。
3. **monorepo 的 build context 是專案根目錄**：`docker-compose.yml` 裡 `build.context: .`、`dockerfile: backend/wallet-service/Dockerfile`——因為子模組編譯需要根 pom 和兄弟模組的 pom（`-am` 會連同依賴模組一起建）。這是多模組專案容器化跟單體最不一樣的地方。
4. **非 root 執行**：`useradd appuser` + `USER appuser`——容器被打穿時攻擊者拿到的不是 root。`curl` 裝進去是給 healthcheck 用的（`curl -f http://localhost:8082/actuator/health`）。

### 6.3 docker-compose.yml 解剖（16 個容器怎麼一起活）

容器清單：**4 個 infra**（mysql 8.4、postgres 16、redis 7、kafka KRaft 單節點）+ **1 個 one-shot**（kafka-init）+ **1 個工具**（kafka-ui）+ **7 個業務服務** + **2 個選配**（prometheus/grafana，`--profile observability` 才起）。

逐塊看關鍵機制：

**(a) 網路——容器名就是主機名**
```yaml
networks:
  lucky-network:
    driver: bridge
```
所有容器掛同一個 bridge 網路，**容器名直接當 DNS 名互連**：wallet 連 `postgres:5432`、game 呼叫 `http://wallet-service:8082`。注意兩套位址的差別：**容器對容器**用容器名 + 容器內 port（`postgres:5432`）；**宿主機對容器**用 `localhost` + 映射出來的 port（`localhost:5433`）。Kafka 為此開兩個 listener：容器內用 `lucky-star-kafka:29092`、宿主機用 `localhost:9092`——這是新手最常撞牆的點。

**(b) 環境變數——`.env` 單一來源**
```yaml
    environment:
      POSTGRES_HOST: postgres        # 寫死：容器內永遠這樣連
      JWT_SECRET: ${JWT_SECRET}      # 從根目錄 .env 注入：秘密不進 git
```
連線位址（服務名）直接寫死在 compose；秘密和可調參數放 `.env`（不進版控），compose 用 `${VAR}` 引用。`JWT_SECRET`/`INTERNAL_SECRET`/`ADMIN_JWT_SECRET` 缺了服務直接啟動失敗（fail-fast，`02` 決策 8）。

**(c) healthcheck——「活著」跟「能接客」是兩回事**
```yaml
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8082/actuator/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
```
容器行程起來 ≠ Spring 應用 ready（連 DB、建連線池、跑 migration 都要時間）。healthcheck 每 10 秒 curl 一次 actuator，連續成功才標 `healthy`。`start_period: 30s` 給 JVM 暖機期，這段時間內失敗不計入 retries。infra 也各有各的探針：postgres 用 `pg_isready`、mysql 用 `mysqladmin ping`、redis 用 `redis-cli ping`、kafka 用 `kafka-topics --list`。

**(d) depends_on 三種 condition——依賴鏈的語法基礎**
```yaml
    depends_on:
      postgres:
        condition: service_healthy                  # 等它 healthcheck 過
      kafka-init:
        condition: service_completed_successfully   # 等它跑完且 exit 0
```
- `service_started`：只等容器起來（最弱，本專案不用）
- `service_healthy`：等 healthcheck 通過——**服務間依賴都用這個**
- `service_completed_successfully`：等 one-shot 容器正常退出——**專門給 kafka-init**

沒有 condition 的裸 `depends_on` 只保證啟動順序、不保證 ready，是新手地雷。

**(e) one-shot 初始化容器**
```yaml
  kafka-init:
    image: confluentinc/cp-kafka:7.6.1      # 跟 broker 同 image，有 kafka-topics CLI
    depends_on:
      kafka: { condition: service_healthy }
    volumes:
      - ./kafka/kafka-init.sh:/kafka-init.sh:ro
    command: ["bash", "/kafka-init.sh"]      # 建完 topic 就退出
```
把「初始化」跟「常駐服務」分開的標準模式。改 topic 清單只改 `kafka-init.sh`（記得同步 `tests/infra/kafka.test.js` 的斷言，雷區 7）。

**(f) volume 持久化 + Kafka CLUSTER_ID 陷阱**
```yaml
volumes:
  lucky_mysql80_data:      # 容器刪了資料還在
  lucky_postgres_data:
  lucky_kafka_data:
```
具名 volume 讓 `docker compose down` 後資料不丟。DB 容器另外掛 `./database/*/init.sql` 進 `/docker-entrypoint-initdb.d/`——**只在 volume 第一次建立時執行**（改了 init.sql 要 `down -v` 重建才生效，或跑 migration）。
Kafka 的 `CLUSTER_ID` 固定寫死在 `.env`：KRaft 模式下 cluster id 存在 volume 裡，若每次隨機生成，重建 volume 後 id 對不上、broker 直接拒絕啟動——這是專案踩過的雷。

**(g) 依賴鏈全景（把 (c)(d) 組合起來就是它）**

```text
mysql/postgres/redis (healthy) → kafka (healthy) → kafka-init (completed)
  → member → wallet/rank → game(等wallet) / admin(等member) / notification
  → gateway (最後，等全部 healthy)
```

為什麼這樣排：**每個箭頭都是一個真實的執行期依賴**。member 要 MySQL+Redis+Kafka；game 派彩要同步呼叫 wallet，wallet 沒 ready 前 game 起來也只會狂噴錯；gateway 要轉發流量給所有人，所以最後。依賴鏈不是美學，是把「服務 A 啟動時需要 B 已經能服務」這件事宣告出來，讓 `docker compose up -d` 一個指令就能從全黑起到全綠。

### 6.4 動手 SOP（自己從零跑一遍）

```bash
# 0. 前置：裝 Docker Desktop（Windows 記得開 WSL2 backend）

# 1. 準備 .env（參考 DEPLOY.md；JWT_SECRET/INTERNAL_SECRET/ADMIN_JWT_SECRET 必填）
cp .env.example .env   # 若無 example 檔則按 DEPLOY.md 手動建

# 2. 建 image（7 個服務，第一次最久：抓依賴 + 編譯；之後有層快取就快了）
docker compose build

# 3. 一鍵啟動
docker compose up -d

# 4. 看啟動順序與健康狀態（會看到 infra 先 healthy、kafka-init Exited(0)、
#    服務逐個從 health: starting 變 healthy、gateway 最後）
docker compose ps
docker compose logs -f gateway-service    # 追個別服務日誌

# 5. 驗證
curl http://localhost:8080/actuator/health          # gateway 活著
curl http://localhost:8080/api/v1/rank/global       # 經 gateway 打一條真路由

# 6. 收工
docker compose down          # 停容器、保留 volume（資料還在）
docker compose down -v       # 連 volume 一起刪（DB 歸零重來，init.sql 會重跑）
```

**常見錯誤對照**：

| 症狀 | 原因 | 解法 |
|---|---|---|
| 服務起了又掛、log 說缺變數 | `.env` 沒建或漏必填 | 補 `JWT_SECRET` 等，fail-fast 是故意的 |
| 服務連不上 DB：`Connection refused to localhost:5433` | 容器內用了宿主機位址 | 容器內要用 `postgres:5432`（服務名+容器內 port） |
| consumer 報 topic 不存在 | 沒等 kafka-init | 檢查 `depends_on` 是否 `service_completed_successfully` |
| Kafka 重建後起不來、cluster id mismatch | `CLUSTER_ID` 沒固定 | `.env` 寫死 CLUSTER_ID；或 `down -v` 清 volume |
| 改了 init.sql 沒生效 | init.sql 只在 volume 初建時跑 | `docker compose down -v` 重建，或走 migration |
| build 很慢 | 沒吃到層快取 | 確認 Dockerfile 是「先 pom 後原始碼」的順序沒被打亂 |

### 6.5 面試怎麼講（把 6.2~6.4 濃縮成一段）

> 「7 個服務各自一個 multi-stage Dockerfile：第一階段用 Maven+JDK21 編譯、第二階段只把 jar 放進純 JRE image，並用『先 COPY pom 再 COPY 原始碼』讓依賴層吃到 Docker 層快取。編排用單一 docker-compose：所有容器掛同一個 bridge 網路、容器名互相解析；啟動順序用 `depends_on` + `condition: service_healthy` 宣告——infra 先健康、一個 one-shot 的 kafka-init 容器建完 topic 正常退出、業務服務按依賴逐個起、gateway 因為要轉發給全部服務所以最後。每個服務都有 actuator healthcheck，秘密全部走 `.env` 注入、缺了就 fail-fast。資料用具名 volume 持久化，Kafka 的 CLUSTER_ID 固定寫死避免重建 volume 後起不來。整套 `docker compose up -d` 一鍵從全黑起到全綠。」

---

## 附：本檔與其他文件的關係

| 需求 | 看哪份 |
|---|---|
| 每天讀什麼、自我檢核 | `portfolio-組員A-五天衝刺與面試準備.md` |
| 檢核項的完整答案（本檔） | 本檔 Day 1~5 詳答 |
| Docker 實作與原理 | 本檔第 6 章 + `docker-compose.yml` + `DEPLOY.md` |
| 壓測原始數據 | `docs/performance/T-090-*.md` |
| 400 題題庫 | `docs/interview-prep/05~08` |
