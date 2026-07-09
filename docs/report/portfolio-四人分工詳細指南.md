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
| 遊戲路徑併發限流(T-090 C1) | `GameConcurrencyLimitGlobalFilter`, 429 shed | `backend/gateway-service/.../filter/GameConcurrencyLimitGlobalFilter.java` |
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
