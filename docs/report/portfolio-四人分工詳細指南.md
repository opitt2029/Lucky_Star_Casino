# Lucky Star Casino — 上台報告四人分工詳細指南

> 用法：每組先讀「必讀文件」，再依「關鍵字→檔案路徑」對照表去專案裡挖細節、截圖、跑 demo。
> 全專案共用背景文件（四組都該先掃過）：`README.md`、`docs/architecture.md`、`AUDIT_REPORT.md`、`AGENTS.md`（雷區清單）。

---

## A組：核心帳務（gateway + member + wallet）

### 負責範圍
登入認證與 JWT、Gateway 路由/限流/併發控制、會員系統（好友/簽到）、雙資料源錢包、冪等與樂觀鎖帳務機制。

### 必讀文件
- `docs/adr/ADR-001.md`（wallet 雙資料源 CQRS 決策）
- `docs/adr/ADR-002.md`（wallet.credit 事件/指令分離）
- `docs/adr/ADR-009.md`（credit 失敗補償機制）
- `docs/performance/T-090-load-test-report.md`（壓測報告，C1/C2 併發限流成果）
- AGENTS.md 雷區 2、4、5、6、8、18、19、21、22

### 關鍵字 → 檔案位置

| 主題 | 關鍵字 | 檔案路徑 |
|---|---|---|
| JWT 驗證/黑名單撤銷 | `JwtAuthenticationGlobalFilter` | `backend/gateway-service/.../filter/JwtAuthenticationGlobalFilter.java` |
| 遊戲路徑併發限流(T-090 C1) | `PlayerRateLimitGlobalFilter`, `GAME_PATH_PREFIX`, `rate:game:{userId}`, 429 shed | `backend/gateway-service/.../filter/PlayerRateLimitGlobalFilter.java`（同一 filter 依路徑套不同 burst，非獨立檔案） |
| 玩家級流量限制 | `PlayerRateLimitGlobalFilter` | `backend/gateway-service/.../filter/PlayerRateLimitGlobalFilter.java` |
| 路由設定/白名單 | `jwt.whitelist`, `member-checkin` 路由 | `backend/gateway-service/src/main/resources/application.yml` |
| 登入/註冊/token | `AuthController`, `AuthService` | `backend/member-service/.../controller/AuthController.java`, `.../service/AuthService.java` |
| 好友系統 | `FriendshipService`, `friend.relationship.updated` | `backend/member-service/.../service/FriendshipService.java` |
| 每日簽到/月獎勵 | `CheckinService`, `MonthlyRewardService` | `backend/member-service/.../service/` |
| Redis token 管理 | `TokenRedisService` | `backend/member-service/.../service/TokenRedisService.java` |
| 內部服務間呼叫(封鎖/停用) | `InternalMemberController`, `INTERNAL_SECRET` | `backend/member-service/.../controller/InternalMemberController.java` |
| 雙資料源設定 | `DataSourceConfig`, `MysqlJpaConfig` | `backend/wallet-service/.../config/DataSourceConfig.java` |
| 入帳/扣款核心(冪等+樂觀鎖) | `WalletService.credit()/debit()`, `idempotency_key`, `@Version` | `backend/wallet-service/.../service/WalletService.java` |
| 讀庫同步(CQRS) | `WalletReadSyncListener` | `backend/wallet-service/.../kafka/WalletReadSyncListener.java` |
| 派彩指令消費 | `WalletCreditRequestListener` | `backend/wallet-service/.../kafka/WalletCreditRequestListener.java` |
| 補償重試(ADR-009) | `pending_wallet_credits`, `WalletCompensationRetryJob` | `backend/game-service/.../compensation/WalletCompensationService.java` |
| 儲值 | `TopupController/Service` | `backend/wallet-service/.../controller/TopupController.java` |
| 死信佇列 | `DeadLetterListener/Service` | `backend/wallet-service/.../kafka/DeadLetterListener.java` |
| 鑽石系統(T-100~107) | `DiamondWalletService`, `DiamondExchangeService`, `DiamondRedeemService` | `backend/wallet-service/.../service/Diamond*.java` |
| 禮品商城(ADR-006) | `ShopCatalogService`, `ShopRedemptionService`, `SHOP_PURCHASE` | `backend/wallet-service/.../service/Shop*.java` |
| 破產救濟 | `BankruptcyAidService` | `backend/wallet-service/.../service/BankruptcyAidService.java` |

### Demo 建議
登入 → 查餘額 → 下注扣款（展示併發不超扣）→ Gateway 429 限流演示（引用 T-090 壓測數據：+126%、401 -63%）。

### 可能被問的問題
- 為何 wallet 要雙資料源？CQRS 讀寫分離的好處/代價？
- 冪等鍵怎麼防止重複入帳？樂觀鎖 `@Version` 怎麼防超扣？
- JWT 撤銷檢查為什麼要做成 fail-closed？Redis 掛掉會怎樣？
- Gateway 併發限流為什麼放在 JWT 驗證之前？

---

## B組：遊戲引擎（game-service + 捕魚 PixiJS）

### 負責範圍
Provably Fair RNG、老虎機/百家樂規則、RTP 統計、捕魚血量傷害模型、風控 RTP 門檻、PixiJS 渲染引擎。

### 必讀文件
- `docs/adr/ADR-003.md`（捕魚 PixiJS + 血量模型決策）
- `docs/adr/ADR-004.md`（捕魚經濟再平衡：RTP/砲台/回收率）
- `contracts/slot-paytable.json`、`contracts/baccarat-rules.json`、`contracts/fishing-combat.json`、`contracts/fishing-species.json`
- AGENTS.md 雷區 12、14、15、16、17

### 關鍵字 → 檔案位置

| 主題 | 關鍵字 | 檔案路徑 |
|---|---|---|
| 老虎機規則/賠付表 | `SlotSymbol`, `SlotMachineTest.spin_rtpWithinExpectedBand` | `backend/game-service/.../service/SlotService.java`（symbol 定義找 `SlotSymbol` class） |
| 老虎機 API | `POST /api/v1/game/slot/spin` | `backend/game-service/.../controller/SlotController.java` |
| 百家樂補牌邏輯 | `BaccaratGameService.bankerDraws` | `backend/game-service/.../baccarat/BaccaratGameService.java` |
| 百家樂 API | `BaccaratController` | `backend/game-service/.../controller/BaccaratController.java` |
| Provably Fair 驗證 | `VerificationService/Controller` | `backend/game-service/.../service/VerificationService.java` |
| RTP 統計 | `RtpStatsService`, `RtpController` | `backend/game-service/.../service/RtpStatsService.java` |
| 風控/RTP 門檻(雷區17) | `RiskControlService`, `risk.global-rtp-limit` | `backend/game-service/.../service/RiskControlService.java`；設定在 `application.yml` |
| 捕魚戰鬥核心(血量/傷害/暴擊/捕獲) | `FishingCombat`, `pCapture`, `CRIT_CHANCE`, `RECOVERY_RATE` | `backend/game-service/.../` 找 `FishingCombat` class |
| 捕魚 session/跨批狀態 | `FishingSession`, `FishingSessionStore.toHash/fromHash` | `backend/game-service/.../session/GameSessionService.java` 及 FishingSessionStore |
| 捕魚 API(開火/加值/結算) | `FishingController`, `POST /{sessionId}/top-up` | `backend/game-service/.../controller/FishingController.java`, `.../service/FishingService.java` |
| 遊戲局歷史 | `GameHistoryService/Controller` | `backend/game-service/.../service/GameHistoryService.java` |
| 損失回饋 | `CashbackService` | `backend/game-service/.../service/CashbackService.java` |
| Kafka credit 失敗補償 | `WalletCompensationService` | `backend/game-service/.../compensation/WalletCompensationService.java` |
| Pixi 渲染引擎(前端) | `fishingEngine.js`, `ticker` | `frontend/src/components/fishingEngine.js` |
| 捕魚 React 殼 | `FishingCanvas.jsx`, `React.lazy` | `frontend/src/components/FishingCanvas.jsx` |
| 捕魚戰鬥 UI 面板 | `FishingFishInfoPanel`, `FishingSettlementPanel`, `FishingControlDock` | `frontend/src/components/Fishing*.jsx` |
| 捕魚 hook(節流/鎖) | `useFishingSession`, `topUpLockRef`, token bucket | `frontend/src/` 搜 `useFishingSession` |
| mock 玩法(單一真相=後端鏡像) | `mockApi.js`, `SLOT_PAYTABLE`, `fishingShots` | `frontend/src/services/mockApi.js` |
| 契約比對測試 | `ContractParityTest` | `backend/game-service/src/test/.../ContractParityTest.java` |

### Demo 建議
老虎機 spin 展示中獎判定 → 秀 Provably Fair 驗證（seed 公開可驗）→ 捕魚展示血量條/暴擊/大魚捕獲 → 說明 RTP 理論值 vs 風控門檻。

### 可能被問的問題
- RTP 怎麼算？含本金 vs 不含本金差在哪？
- Provably Fair 怎麼保證莊家沒作弊？
- 捕魚為何要把累傷存 Redis 而不是每次重算？
- 前端 mock 資料為何要跟後端「鏡像」，不對齊會怎樣？
- 砲台傷害/子彈面額為何進場後鎖定不能中途切換？

---

## C組：排行/通知/後台（rank + notification + admin）

### 負責範圍
排行榜計算與週期重置、WebSocket 即時推播、後台管理（玩家/RTP監控/異常偵測/GM發幣/商城管理）。

### 必讀文件
- AGENTS.md 雷區 6、11、21（Kafka 事件語意、好友清單事件、admin JWT 白名單）
- `docs/adr/ADR-002.md`（wallet.credit 事件，rank 消費來源）

### 關鍵字 → 檔案位置

| 主題 | 關鍵字 | 檔案路徑 |
|---|---|---|
| 排行榜核心邏輯 | `RankService`, `rank:friend:{playerId}` | `backend/rank-service/.../service/RankService.java` |
| 週排行重置 | `WeeklyRankResetService` | `backend/rank-service/.../service/WeeklyRankResetService.java` |
| 每日快照 | `DailyRankSnapshotService` | `backend/rank-service/.../service/DailyRankSnapshotService.java` |
| 排行 API | `RankController` | `backend/rank-service/.../controller/RankController.java` |
| Kafka 消費設定 | `KafkaConsumerConfig`（消費 wallet.credit/debit） | `backend/rank-service/.../config/KafkaConsumerConfig.java` |
| WebSocket 認證 | `StompAuthChannelInterceptor`, `PlayerJwtVerifier` | `backend/notification-service/.../security/` |
| WebSocket 設定 | `WebSocketConfig`, `/ws` | `backend/notification-service/.../config/WebSocketConfig.java` |
| 推播消費(遊戲結果) | `GameResultConsumer`, `game.result` | `backend/notification-service/.../kafka/GameResultConsumer.java` |
| 推播消費(排行更新) | `RankUpdateConsumer`, `rank.update` | `backend/notification-service/.../kafka/RankUpdateConsumer.java` |
| 推播消費(一般通知) | `NotificationConsumer`, `notification.push` | `backend/notification-service/.../kafka/NotificationConsumer.java` |
| 前端即時橋接 | `RealtimeBridge.jsx` | `frontend/src/components/RealtimeBridge.jsx` |
| 後台登入(獨立JWT) | `AdminAuthController/Service`, `ADMIN_JWT_SECRET` | `backend/admin-service/.../controller/AdminAuthController.java` |
| 後台玩家管理/封鎖 | `AdminPlayerController/Service`, `PlayerBanService` | `backend/admin-service/.../service/AdminPlayerService.java`, `PlayerBanService.java` |
| 異常偵測/告警 | `AdminAlertController/Service`, `GET /admin/alerts` | `backend/admin-service/.../service/AdminAlertService.java` |
| RTP 監控報表 | `RtpReportService` | `backend/admin-service/.../service/RtpReportService.java` |
| 流通量報表 | `CoinFlowReportService` | `backend/admin-service/.../service/CoinFlowReportService.java` |
| GM 發幣 | `GmController`, `GmRewardService` | `backend/admin-service/.../controller/GmController.java` |
| 鑽石點數卡後台 | `AdminDiamondController`, `DiamondCardService` | `backend/admin-service/.../controller/AdminDiamondController.java` |
| 商城後台管理 | `AdminShopController/Service` | `backend/admin-service/.../service/AdminShopService.java` |
| Gateway admin 白名單 | `jwt.whitelist` 含 `/admin/` | `backend/gateway-service/src/main/resources/application.yml` |

### Demo 建議
玩家下注贏錢 → 秀排行榜即時更新 → 秀 WebSocket 推播通知彈出 → 切到後台展示玩家管理/RTP 監控/GM 發幣。

### 可能被問的問題
- 排行榜為什麼要分週重置+每日快照？
- WebSocket 推播是 best-effort，掉了會怎樣（無 DLT 的取捨）？
- 後台 JWT 為何跟玩家 JWT 分開兩套 secret？
- 好友清單事件為何每次送「完整清單」而非增量？

---

## D組：前端（玩家端 + 管理後台）

### 負責範圍
React+Redux 玩家端 UI、下注三鐵則（餘額守門/視覺鎖/音效）、mock API 機制、UI/UX 流程、管理後台前端。

### 必讀文件
- AGENTS.md 雷區 13、14（下注三鐵則、mock 鏡像後端）
- `docs/adr/ADR-003.md`（捕魚 UI 相關背景，可搭配 B 組）

### 關鍵字 → 檔案位置

| 主題 | 關鍵字 | 檔案路徑 |
|---|---|---|
| App 殼層/路由 | `AppShell.jsx` | `frontend/src/components/AppShell.jsx` |
| 老虎機 UI | `SlotMachine.jsx`, `canAfford`, `Reel.jsx` | `frontend/src/components/SlotMachine.jsx`, `Reel.jsx` |
| 百家樂 UI | `Baccarat.jsx`, `notEnoughBalance`, `BaccaratTable.jsx`, `BaccaratRoadmap.jsx` | `frontend/src/components/Baccarat*.jsx` |
| 捕魚 UI(與B組共用) | `Fishing.jsx`, `insufficient` | `frontend/src/components/Fishing.jsx` |
| API 切換開關(mock/真後端) | `VITE_USE_MOCK_API` | `frontend/src/services/gameApi.js` |
| mock 資料/邏輯 | `mockApi.js` | `frontend/src/services/mockApi.js` |
| 契約檔案(表格數值來源) | `contracts/*.json` import | `frontend/vite.config.js`（`server.fs.allow`）+ `contracts/` |
| 音效引擎(節流) | `soundEngine.play()`, `useSound()` | `frontend/src/` 搜 `SoundEngine.js` |
| 好友面板 | `FriendFloatingPanel.jsx` | `frontend/src/components/FriendFloatingPanel.jsx` |
| 排行榜面板 | `LeaderboardPanel.jsx` | `frontend/src/components/LeaderboardPanel.jsx` |
| 遊戲規則卡 | `GameRuleCard.jsx` | `frontend/src/components/GameRuleCard.jsx` |
| 站台設定 | `SiteSettings.jsx` | `frontend/src/components/SiteSettings.jsx` |
| 支援/客服彈窗 | `SupportModal.jsx` | `frontend/src/components/SupportModal.jsx` |
| 離開遊戲確認 | `LeaveGameModal.jsx` | `frontend/src/components/LeaveGameModal.jsx` |
| 頁面轉場 | `PageTransition.jsx` | `frontend/src/components/PageTransition.jsx` |
| 錯誤邊界 | `ErrorBoundary.jsx` | `frontend/src/components/ErrorBoundary.jsx` |
| 快速工具列 | `QuickToolbar.jsx` | `frontend/src/components/QuickToolbar.jsx` |
| API 客戶端(各服務) | `walletApi.js`, `memberApi.js`, `rankApi.js`, `shopApi.js`, `diamondApi.js` | `frontend/src/services/` |
| 管理後台前端 | 獨立專案, port 5174, `/admin` proxy | `frontend-admin/`（vite proxy 設定看 `frontend-admin/vite.config.js`） |

### Demo 建議
展示下注按鈕在餘額不足時 disabled + 提示「星幣不足」→ 展示連續下注時視覺鎖正確跟著請求生命週期釋放（非固定 timeout）→ 秀 mock/真後端切換 → 展示管理後台頁面。

### 可能被問的問題
- 為何前端要先做餘額守門，後端不是已經會擋嗎？（雙保險原因）
- mock API 存在的目的？正式上線會怎麼切換？
- 為什麼視覺鎖不能用固定 `setTimeout`？
- 音效為何要統一走 `soundEngine` 而不是各元件自己播？

---

## E組專項（A組加報）：API / Docker / Kafka / Redis 跨服務架構總覽

> A組除了自己的 gateway+member+wallet，額外總覽「串接怎麼打通」這塊，因為 gateway 是唯一同時知道全部路由的角色。以下四塊都附**實際檔案內容**，可直接拿去畫圖/貼投影片。

### E1. API 串接架構（前端 → Gateway → 各服務）

**流程**：前端 `frontend/src/services/*.js` 呼叫 `http://localhost:8080`（Gateway）→ Gateway 依 `Path` predicate 轉發到對應服務容器 → 服務內 Controller 處理。

**Gateway 路由表**（`backend/gateway-service/src/main/resources/application.yml`）：

| Route ID | Path | 轉發到 | 備註 |
|---|---|---|---|
| `openapi-*` | `/v3/api-docs/{service}` | 各服務 8081~8087 | Swagger 文件聚合(T-092)，`RewritePath` 改路徑，免 JWT |
| `member-auth` | `/api/v1/auth/**` | member:8081 | 免 JWT，但套 `RequestRateLimiter`(IP-based, 5 req/s burst 10)防暴力破解 + CircuitBreaker |
| `member-player` | `/api/v1/player/**` | member:8081 | 需 JWT |
| `member-friends` | `/api/v1/friends/**` | member:8081 | 需 JWT |
| `member-checkin` | `/api/v1/wallet/daily-checkin`, `/api/v1/wallet/checkin/**` | member:8081 | **必須排在 `wallet` route 之前**，否則被 catch-all 吃掉轉去 wallet-service 404（雷區19） |
| `wallet` | `/api/v1/wallet/**` | wallet:8082 | catch-all，含禮品商城 `/shop/**`（雷區20，免另立路由） |
| `game` | `/api/v1/game/**` | game:8083 | |
| `rank` | `/api/v1/rank/**` | rank:8084 | |
| `admin` | `/admin/**` | admin:8086 | ADMIN JWT 白名單直接放行（雷區21，認證由 admin-service 自己做） |
| `notification-ws` | `/ws`, `/ws/**` | notification:8087 | STOMP over SockJS，Upgrade header 會被自動轉 `ws://`；JWT 驗證延後到 STOMP CONNECT 帧 |

**每條業務路由都掛 `CircuitBreaker`**（Resilience4j），對應服務不可用時走 `forward:/fallback/{service}`（`FallbackController.java`）回傳統一格式錯誤，不讓前端收到裸連線逾時。

**Gateway 內部 Filter 執行順序**（`FilterOrder.java`，數字越小越早跑）：
```
RATE_LIMIT (-200)          全站/IP 級限流，防暴力破解
  ↓
JWT_AUTHENTICATION (-100)  驗簽 + 查 Redis 黑名單 + 停用檢查，注入 X-User-Id/X-User-Role header
  ↓
PLAYER_RATE_LIMIT (-50)    依 X-User-Id 滑動視窗限流，遊戲路徑(/api/v1/game/**)套更嚴格 burst
  ↓
(Gateway 內建路由轉發，order ≥ 0)
```
關鍵字找檔案：`FilterOrder.java`、`JwtAuthenticationGlobalFilter.java`、`PlayerRateLimitGlobalFilter.java`、`RateLimitConfig.java`（IP KeyResolver）。

**服務間內部呼叫**（不經 Gateway，直連容器名）：`game-service` → `wallet-service`（`WALLET_SERVICE_URL=http://wallet-service:8082`，派彩/扣款走 `WalletClient` + `INTERNAL_SECRET` 驗證）、`admin-service` → `member-service`（`MEMBER_SERVICE_URL`，玩家停用同步）。這類內部 API 帶 `INTERNAL_SECRET` header，由各服務的 `InternalSecretFilter` 驗證，不走玩家 JWT。

---

### E2. Docker 部署架構

**編排檔**：根目錄 `docker-compose.yml`，單一 `lucky-network`(bridge) 讓所有容器互通，容器名即可互 resolve（如 `wallet-service` 內連 `postgres:5432`）。

**容器清單**：

| 容器 | Image | Port(host) | 角色 |
|---|---|---|---|
| `lucky-star-mysql` | mysql:8.4 | `${MYSQL_PORT}`→3306 | 讀庫(CQRS)，`database/mysql/init.sql` 建 schema |
| `lucky-star-postgres` | postgres:16 | `${POSTGRES_PORT}`→5432 | 寫庫(帳務)，`database/postgres/init.sql` 建 schema |
| `lucky-star-redis` | redis:7 | `${REDIS_PORT}`→6379 | token/限流/排行/session（見 E4） |
| `lucky-star-kafka` | confluentinc/cp-kafka:7.6.1 | `${KAFKA_PORT}`→9092 | **KRaft 模式**（無 Zookeeper），broker+controller 合一單節點 |
| `lucky-star-kafka-init` | 同上 image | — | one-shot 容器，跑 `kafka/kafka-init.sh` 建 topic 後結束，其他服務 `depends_on: kafka-init: condition: service_completed_successfully` |
| `lucky-star-kafka-ui` | provectuslabs/kafka-ui | `${KAFKA_UI_PORT}`→8080(容器內) | 圖形化看 topic/訊息 |
| `lucky-star-{service}` ×7 | 各自 `backend/{service}/Dockerfile` | 見下表 | 業務服務，全部 `restart: always` + `/actuator/health` healthcheck |
| `prometheus` / `grafana` | — | 9090 / 3000 | **選配**，`--profile observability` 才啟動 |

**7 個服務對外 Port**：gateway 8080 / member 8081 / wallet 8082 / game 8083 / rank 8084 / admin 8086 / notification 8087（**無 8085**，那是 kafka-ui 內部）。

**啟動依賴鏈**（`depends_on` + `condition`）：
```
mysql/postgres/redis (healthy) → kafka (healthy) → kafka-init (completed)
  → member-service (healthy) → wallet-service/rank-service (healthy，都依賴 redis+kafka-init)
  → game-service (healthy，額外依賴 wallet-service healthy，因派彩要呼叫 wallet)
  → admin-service (healthy，依賴 member-service healthy，內部封鎖同步)
  → notification-service (healthy，只依賴 kafka-init)
  → gateway-service (最後，依賴以上全部 healthy，因為要轉發流量給它們)
```
每個服務容器內用**環境變數**注入連線資訊（`MYSQL_HOST=mysql`、`REDIS_HOST=redis`、`KAFKA_BOOTSTRAP_SERVERS=lucky-star-kafka:29092` 等），值來自根目錄 `.env`（本機需先準備，見 DEPLOY.md，`JWT_SECRET`/`INTERNAL_SECRET`/`ADMIN_JWT_SECRET` 缺了會啟動失敗，雷區2）。

**資料持久化**：4 個具名 volume（`lucky_mysql80_data`、`lucky_postgres_data`、`lucky_kafka_data`、`lucky_prometheus_data`/`lucky_grafana_data`），容器重建資料不丟；但 Kafka `CLUSTER_ID` 固定值寫死在 `.env`，避免重建 volume 後 cluster id 不一致啟動失敗。

**一鍵啟動**：`docker compose up -d` 取代過去各服務各開視窗跑 `mvn spring-boot:run`。

---

### E3. Kafka 架構設計

**Broker**：單節點 KRaft 模式（無 Zookeeper），`kafka/kafka-init.sh` 在服務啟動前建好全部 topic（3 partitions、replication-factor 1，本機開發用，非高可用配置）。

**Topic 清單與語意**（來自 `kafka/kafka-init.sh` 註解 + ADR-002）：

| Topic | 語意 | Producer | Consumer |
|---|---|---|---|
| `member.registered` | 事件：新會員完成註冊 | member-service | （視需求） |
| `wallet.credit.request` | **指令**：請求入帳(尚未執行) | member-service(簽到/新手禮), game-service(派彩失敗補償走 HTTP 非此) | wallet-service `WalletCreditRequestListener` |
| `wallet.credit` | **事件**：已完成入帳 | wallet-service | rank-service(計分)、`WalletReadSyncListener`(寫 MySQL 讀視圖) |
| `wallet.debit` | **事件**：已完成扣款 | wallet-service | rank-service、`WalletReadSyncListener` |
| `friend.relationship.updated` | 事件：好友關係變動後，雙方各發一則**完整好友清單**（非增量，雷區11） | member-service | rank-service(重建 `rank:friend:{playerId}`) |
| `game.result` | 事件：一局遊戲結束含結果 | game-service | notification-service `GameResultConsumer` |
| `rank.update` | 事件：玩家排名變動 | rank-service | notification-service `RankUpdateConsumer` |
| `notification.push` | 事件：觸發一般推播 | 各服務 | notification-service `NotificationConsumer` |

**DLT（死信佇列）**：`member.registered.DLT`、`wallet.debit.DLT`、`wallet.credit.DLT`、`wallet.credit.request.DLT`、`friend.relationship.updated.DLT`（重試耗盡的訊息落此，`AdminDeadLetterController`/`DeadLetterService` 後台查看，`DeadLetterListener` 消費）。**`game.result`/`rank.update`/`notification.push` 無 DLT**——推播是 best-effort 設計，掉了不重試（雷區16後台背景）。

**指令/事件分離為何重要（ADR-002，雷區6）**：`wallet.credit.request`(指令) 與 `wallet.credit`(事件) 分開，避免 wallet-service 自己發 `wallet.credit` 又自己消費、無限迴圈入帳。**規則：wallet-service 內任何消費 `wallet.credit`/`wallet.debit` 事件的 listener 絕不可再呼叫 `WalletService.credit()/debit()`**，唯一安全例外是 `WalletReadSyncListener`（只寫讀視圖，`existsById` 冪等，不觸發入帳）。

**改 topic 要同步**：`kafka/kafka-init.sh` 增刪 topic → 同步 `tests/infra/kafka.test.js` 的 topic 清單/數量斷言，否則 CI 紅（雷區7）。

---

### E4. Redis 架構設計（跨服務用途總覽）

Redis 是**唯一單容器多服務共用**的元件（`lucky-star-redis`，member/wallet/game/rank/admin/gateway 都連同一個 Redis instance，靠 key prefix 分隔命名空間，無 DB index 分庫）。

| Key Prefix | 用途 | 讀寫服務 | 資料結構 | TTL |
|---|---|---|---|---|
| `jwt:blacklist:{jti}` | JWT 登出黑名單 | member(寫,登出時) / gateway(讀,每請求查) | String | 到 token 原始效期 |
| `token:min-iat:{userId}` | 強制某使用者之前所有 token 失效的時間戳(如改密碼) | member(寫) / gateway(讀) | String | — |
| `refresh:{memberId}` | Refresh token 儲存 | member-service `TokenRedisService` | String | `JWT_REFRESH_TOKEN_EXPIRY_MS` |
| `disabled:player:{memberId}` | 後台停用玩家即時封鎖標記 | admin(寫, `PlayerBanService`) / member+gateway(讀) | String | — |
| `rate:player:{userId}` | 每玩家一般路徑限流計數 | gateway `PlayerRateLimitGlobalFilter` | String(counter) | 1 秒滑動窗 |
| `rate:game:{userId}` | 遊戲路徑限流計數(更嚴格 burst，即 T-090 併發防護) | gateway `PlayerRateLimitGlobalFilter` | String(counter) | 1 秒滑動窗 |
| `rank:global:coins` | 全域星幣排行榜 | rank-service `RankService` | **Sorted Set**(ZSET) | 永久 |
| `rank:daily:winnings` | 今日贏幣王排行 | rank-service | ZSET | 48h(首次寫入設) |
| `rank:friend:{playerId}` | 好友排行榜(依 `friend.relationship.updated` 重建) | rank-service | ZSET | 永久 |
| `rank:player:usernames` | player 名稱快取(排行榜顯示用) | rank-service | Hash/String | — |
| `game:fishing:session:{playerId}` | 捕魚跨批戰鬥狀態(累傷/kills/betPerShot/cannonLevel) | game-service `FishingSessionStore` | Hash(序列化 JSON 欄位) | **24 小時** |

**共用 key 三方對齊要求（易踩雷）**：
- `jwt:blacklist:{jti}`：member 寫、gateway 讀，字串**必須完全一致**，否則登出撤銷在 gateway 端查不到（見 `TokenRedisService.java` 註解）。
- `disabled:player:{memberId}`：admin 寫、member+gateway 都讀，同上三方共用同一 key 格式不可改動。

**Redis 故障容錯策略不同服務不同取捨**：
- Gateway 限流（`rate:player:*`/`rate:game:*`）：**fail-open**（Redis 掛掉直接放行），理由是限流元件故障不該拖垮整體服務可用性。
- JWT 黑名單查詢：**fail-closed**（Redis 錯誤時拒絕請求，寧可誤擋也不讓已撤銷 token 通過），T-090 C2 加了短重試（retryWhen backoff 1次/50ms）降低誤判率但語意不變（見 CHANGELOG `fix(gateway)` 條目）。
- 捕魚 session：無 fallback，Redis 是**唯一真相來源**（`FishingSessionStore`），掛掉當批直接失敗。

**設計取捨（可能被問）**：
- 為何不用 Redis DB index (0~15) 分服務，而用 key prefix？→ 單一連線池/單一容器管理較簡單，本機開發規模夠用；正式環境要拆會改成獨立 Redis instance 而非 DB index（DB index 本身也不是強隔離）。
- 為何限流用 Redis 而非本地記憶體？→ Gateway 若水平擴展多實例，本地計數器各自為政會失真，Redis 全域計數才準。

---

## 共用備查

| 主題 | 位置 |
|---|---|
| 全部 ADR 決策 | `docs/adr/ADR-000.md` ~ `ADR-009.md` |
| 任務進度真相(逐項) | `AUDIT_REPORT.md` 附錄 A |
| 架構圖/服務邊界/DB分配/Kafka topics | `docs/architecture.md` |
| 分支/commit/PR 規範 | `CONTRIBUTING.md` |
| 本機環境啟動 SOP | `DEPLOY.md` |
| 最近改動記錄 | `CHANGELOG.md`（根目錄，單一真相來源） |
| 壓測報告 | `docs/performance/T-090-load-test-report.md` |
