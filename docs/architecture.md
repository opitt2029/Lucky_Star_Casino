# 幸運星幣城 — 系統架構文件

> 版本：v1.1  
> 建立日期：2026-05-26｜最後校對：2026-07-13（依實際程式碼盤點修訂）  
> 負責人：組長 A
>
> 本檔描述**已實作**的架構。與程式碼衝突時以程式碼為準，並請順手回頭修本檔（AGENTS.md §5）。

---

## 目錄

1. [系統概覽](#1-系統概覽)
2. [服務邊界定義](#2-服務邊界定義)
3. [服務間通信策略](#3-服務間通信策略)
4. [資料庫分配（PostgreSQL vs MySQL）](#4-資料庫分配postgresql-vs-mysql)
5. [Redis 用途分配](#5-redis-用途分配)
6. [Kafka Topic 命名與規格](#6-kafka-topic-命名與規格)
7. [Port 分配表](#7-port-分配表)
8. [關鍵請求流程](#8-關鍵請求流程)
9. [相關 ADR 文件](#9-相關-adr-文件)

---

## 1. 系統概覽

幸運星幣城為**微服務架構**的模擬幣線上娛樂平台，使用者透過 React 前端與後端互動，所有外部請求均經 API Gateway 統一入口，再路由到對應的業務 Service。

```
使用者瀏覽器
     │
     │  HTTP / WebSocket
     ▼
┌──────────────────────────────────────────────┐
│             API Gateway（Port 8080）          │
│  ● 自適應在途上限卸載（AIMD，429）— T-090 C3  │
│  ● JWT 驗證（黑名單／停用／min-iat 撤銷）      │
│  ● 玩家限流（Rate Limiter）                   │
│  ● 路由轉發                                   │
│  ● 熔斷（Resilience4j + TimeLimiter 6s）      │
└───┬──────┬──────┬──────┬──────┬──────────────┘
    │      │      │      │      │
    ▼      ▼      ▼      ▼      ▼
 Member  Wallet  Game   Rank   Admin   Notification
 8081    8082    8083   8084   8086    8087（/ws）

       Kafka（非同步事件，8 業務 topic + 5 DLT）
  ┌──────────────────────────────────────┐
  │  member.registered                   │
  │  friend.relationship.updated         │
  │  wallet.credit.request（入帳「指令」）│
  │  wallet.debit / wallet.credit（事件） │
  │  game.result                         │
  │  rank.update                         │
  │  notification.push                   │
  └──────────────────────────────────────┘
       ▲      ▲      ▲      ▲      ▲
       │      │      │      │      │
  Member  Wallet  Game   Rank   Notification
```

> ⚠️ `wallet.credit` 是**事件**、`wallet.credit.request` 才是**指令**（ADR-002）。
> 消費 `wallet.credit`/`wallet.debit` 的 listener 一律不可回頭呼叫 `credit()`/`debit()`（會無限迴圈，AGENTS.md 雷區 6）。

**系統邊界說明：**
- 前端只與 Gateway 溝通，**不直接呼叫任何業務 Service**
- Service 之間的同步呼叫使用 `/internal/**` 路徑（需帶 `X-Internal-Secret` Header 驗證）
- Service 之間的非同步通信透過 Kafka 事件

---

## 2. 服務邊界定義

### 2.1 Gateway Service

| 項目 | 說明 |
|------|------|
| **職責** | 統一入口、JWT 驗證、路由轉發、限流、併發卸載、熔斷 |
| **不負責** | 業務邏輯、資料存取 |
| **路由規則**（宣告順序即比對順序） | `/api/v1/auth/**` → Member（白名單，免 JWT） |
| | `/api/v1/player/**`、`/api/v1/friends/**` → Member |
| | `/api/v1/wallet/daily-checkin`、`/api/v1/wallet/checkin/**` → **Member**（簽到；必須排在下方 wallet catch-all 之前，雷區 19） |
| | `/api/v1/wallet/**` → Wallet（含鑽石 `/diamond/**`、商城 `/shop/**`、儲值 `/topup/**`） |
| | `/api/v1/game/**` → Game |
| | `/api/v1/rank/**` → Rank |
| | `/admin/**` → Admin（**列在 `jwt.whitelist`，gateway 純轉發**；認證/授權由 admin-service 自身 Spring Security 負責，因 ADMIN token 用另一組 secret，雷區 21） |
| | `/ws`、`/ws/**` → Notification（STOMP over SockJS；白名單，JWT 在 CONNECT 帧驗） |
| | `/v3/api-docs/{service}` → 各服務（Swagger 聚合，T-092） |
| **Filter 鏈**（`FilterOrder`） | 併發卸載（`RouteConcurrencyLimitGlobalFilter` + `AdaptiveInFlightLimiter`）→ 玩家限流 → JWT 驗證 |
| **Token 注入** | 驗證通過後注入 `X-User-Id` / `X-User-Role` 給下游（白名單路徑會**剝除**這兩個 header） |

### 2.2 Member Service

| 項目 | 說明 |
|------|------|
| **職責** | 會員註冊/登入/登出、Google／LINE／Apple OAuth 登入與綁定（ADR-011）、JWT 簽發與輪替、個人資料 CRUD、好友系統、每日簽到、月度累計簽到獎勵（ADR-005） |
| **資料庫** | MySQL（`members`、`member_social_accounts`、`friendships`、`daily_checkins`、`task_definitions`、`player_tasks`、`monthly_reward_claims`、`outbox_events`） |
| **Redis** | Refresh Token（`refresh:{memberId}`，一人一把）、JWT 黑名單（`jwt:blacklist:{jti}`）、停用旗標（`disabled:player:{id}`）、OAuth 綁定／登入一次性 ticket |
| **Kafka 發布** | `member.registered`、`friend.relationship.updated`（**完整好友清單**，非增量，雷區 11）、`wallet.credit.request`（簽到/月度獎勵的入帳**指令**） |
| **Kafka 消費** | `member.registered`（新手禮包） |
| **對外 API 前綴** | `/api/v1/auth/**`（含 `/social/**` OAuth）、`/api/v1/player/**`、`/api/v1/friends/**`、`/api/v1/wallet/daily-checkin`＋`/api/v1/wallet/checkin/**`（**路徑在 wallet 前綴下但服務在 member**，故 gateway 需獨立路由，雷區 19） |
| **對內 API** | `PATCH /internal/members/{id}/status`（admin 停用玩家時持久化 `members.status`，T-051） |

### 2.3 Wallet Service

| 項目 | 說明 |
|------|------|
| **職責** | 星幣餘額、下注扣款、派彩入帳、帳務流水、好友贈幣、破產補助、**鑽石錢包／點數卡兌換**（T-100~T-107）、**禮品商城兌換／背包**（ADR-006）、**玩家自助加值**（模擬支付儲值訂單） |
| **資料庫** | PostgreSQL（`wallets`、`wallet_transactions`、`shop_redemptions`、`topup_orders`、`diamond_wallets` — 帳務核心，需 ACID） |
| | MySQL（`wallet_transactions` 讀視圖、`gift_logs`、`diamond_cards`、`shop_items` 目錄 — CQRS 讀端） |
| **雙資料源** | ADR-001；`spring.jpa.*` **無效**，兩個 `EntityManagerFactory` 在 `config/DataSourceConfig` 手動建立（雷區 5），跨庫讀取要拆到用 `mysqlTransactionManager` 的獨立 Bean |
| **Redis** | 好友贈幣當日累計、破產補助當日狀態（TTL 到午夜） |
| **Kafka 發布** | `wallet.debit`、`wallet.credit`（皆為**事件**） |
| **Kafka 消費** | `member.registered`（開戶）、`wallet.credit.request`（入帳**指令**）、`wallet.credit`／`wallet.debit`（僅 `WalletReadSyncListener` 同步 MySQL 讀視圖，**唯一安全的自我消費例外**，雷區 6） |
| **對外 API 前綴** | `/api/v1/wallet/**`（含 `/diamond/**`、`/shop/**`、`/topup/**`） |
| **對內 API 前綴** | `/internal/wallet/**`（Game/Admin 呼叫扣款/派彩，`X-Internal-Secret` 保護） |
| **關鍵設計** | 樂觀鎖（`wallets.version` `@Version`）防超扣、冪等鍵（`wallet_transactions.idempotency_key` UNIQUE）防重複入帳 |
| **`sub_type` 白名單** | 字串非 enum；新增子型要四同步（DTO `@Pattern` + 兩套 init.sql 的 CHECK + migration），雷區 18 |

### 2.4 Game Service（RNG）

| 項目 | 說明 |
|------|------|
| **職責** | Provably Fair RNG、**老虎機**（T-032）、**百家樂**（T-034/035）、**捕魚機**（ADR-003/004，血量傷害模型）、RNG 驗證、RTP 統計、風控、每日/每週回饋（cashback） |
| **資料庫** | PostgreSQL（`game_rounds`、`game_rtp_stats`、`cashback_records`、`pending_wallet_credits`） |
| **Redis** | 遊戲 Session（`GameSessionService`）、**捕魚 Session**（`FishingSessionStore`：跨批累傷 `fishDamage`、`kills`、`betPerShot`、`topUpRequestIds`——動欄位必須同步 `toHash()/fromHash()`，雷區 16）、風控全局 RTP 快取與 Lua 並發閘 |
| **Kafka 發布** | `game.result`、`wallet.credit.request`（cashback 派發） |
| **同步呼叫** | `POST /internal/wallet/debit`（下注扣款）、`POST /internal/wallet/credit`（派彩／退款） |
| **韌性（ADR-009）** | credit 失敗 → `WalletCompensationService` 落補償單 `pending_wallet_credits`，`WalletCompensationRetryJob` 每 30 秒**以完全相同的冪等鍵**重試（換鍵＝重複入帳，雷區 22） |
| **對外 API 前綴** | `/api/v1/game/**`（`/slot/spin`、`/baccarat/**`、`/fishing/**`、`/verify`、`/rtp`、`/history`） |
| **關鍵設計** | `SHA-256(serverSeed:clientSeed:nonce)` 可驗證公平；玩法數值單一來源＝`contracts/*.json`，由 `ContractParityTest` 對後端 enum 逐欄斷言（漂移＝CI 紅燈，雷區 14） |
| **風控** | `risk.global-rtp-limit` 是 **per-game map、含本金口徑**（老虎機 ≈0.94／百家樂 ≈0.99／捕魚 1.10）；門檻訂在結構性 RTP 之下會導致每局誤判改判（雷區 17） |

### 2.5 Rank Service

| 項目 | 說明 |
|------|------|
| **職責** | 全服排行榜、好友排行榜、每週排行榜重置、歷史快照 |
| **資料庫** | PostgreSQL（rank_history、rank_daily_snapshots） |
| **Redis** | `rank:global:coins` ZSet（全服排行）、`rank:friend:{playerId}` ZSet（好友榜）、`rank:player:usernames` Hash（排行榜 username read model）、`rank:daily:winnings` ZSet（今日贏幣王） |
| **Kafka 消費** | `member.registered`（快取 username）、`wallet.credit`、`wallet.debit`（觸發全服排行更新）、`friend.relationship.updated`（重建好友排行） |
| **Kafka 發布** | `rank.update`（TOP10 變動時廣播）、`notification.push`（週榜重置通知 TOP3） |
| **對外 API 前綴** | `/api/v1/rank/**`；`GET /global`（全服前 100）、`GET /friends`（登入玩家好友榜前 20） |
| **計分口徑** | 今日贏幣王只認 `sub_type=WIN` 的 credit；`MONTHLY_REWARD`／`CHECKIN`／`REFUND`／`SHOP_PURCHASE`／`GM_REWARD`／`TOPUP`／`CASHBACK` 皆**不**計入排行（雷區 18） |

### 2.6 Admin Service

| 項目 | 說明 |
|------|------|
| **職責** | 後台登入（T-050）、玩家帳號管理（T-051）、星幣流通報表（T-052）、RTP 監控（T-053）、異常偵測＋`GET /admin/alerts`（T-054）、GM 發幣（T-055）、鑽石點數卡後台（T-105/106）、商城目錄 CRUD（ADR-006） |
| **資料庫** | MySQL（**`@Primary` 主源**：`members`、`diamond_cards`、`shop_items`）、PostgreSQL（次源：`admin_users`、`admin_alerts`、`admin_action_logs`、讀 `wallet_transactions`/`game_rounds` 做報表） |
| **Redis** | 停用玩家即時封鎖旗標（配合 member 內部 API 持久化 `members.status`） |
| **Kafka 發布** | `notification.push`（異常告警）、`wallet.credit.request`（GM 發幣走**指令**、`subType=GM_REWARD`，絕不直接寫 wallet——`GmRewardService`） |
| **Kafka 消費** | `game.result`、`wallet.debit`/`wallet.credit`（異常偵測與流通量報表） |
| **對外 API 前綴** | `/admin/**` |
| **認證** | **獨立 `ADMIN_JWT_SECRET`**，與玩家 JWT 是兩套 secret；gateway 驗不了 admin token，故 `/admin/` 必須留在 `jwt.whitelist`（移出＝整條後台被 401 擋死，雷區 21） |
| **稽核** | 所有後台寫入動作寫 `admin_action_logs` |

### 2.7 Notification Service

| 項目 | 說明 |
|------|------|
| **職責** | WebSocket STOMP Server（`/ws`，port 8087）、Kafka → WebSocket 事件橋接推播（T-070~T-073） |
| **資料庫** | 無（純推播，不持久化） |
| **WebSocket 頻道** | `/user/queue/notifications`（私人：遊戲結果、個人通知）、`/topic/rank`（公共：排行變動）、`/topic/notifications`（公共廣播） |
| **Kafka 消費** | `notification.push`、`game.result`、`rank.update` |
| **可靠度** | best-effort，**不設 DLT**；listener 內 try/catch + `MANUAL_IMMEDIATE` ack 丟棄壞訊息，避免卡住 consumer |
| **鑑權** | SockJS HTTP 交握不帶 `Authorization` header → JWT 改在 **STOMP CONNECT 帧**由 `StompAuthChannelInterceptor` 驗；故 gateway 的 `jwt.whitelist` 含 `/ws` |

> 前端訂閱端點必須與上表一致：`/topic/wallet`、`/topic/game/result` **後端從未發布**（曾為 BUG-003，已於 `RealtimeBridge.jsx` 移除）。餘額更新走各操作的 REST 回應，遊戲結果走私人佇列。

---

## 3. 服務間通信策略

### 3.1 同步通信（REST）— 需要立即結果時使用

```
Game Service  ──POST /internal/wallet/debit──► Wallet Service
Game Service  ──POST /internal/wallet/credit─► Wallet Service（失敗→補償單重試，ADR-009）
Gateway       ──驗證 JWT──────────────────────► Redis（黑名單 / 停用 / min-iat）
Admin Service ──PATCH /internal/members/{id}/status──► Member Service（停用玩家）
```

**安全機制：** `/internal/**` 路徑需帶 `X-Internal-Secret` Header（`InternalSecretFilter`），Gateway 不對外暴露此前綴。

### 3.2 非同步通信（Kafka）— 不需要立即結果時使用

```
Member Service ──publish member.registered──► Wallet Service（開戶）
                                           ──► Member Service（新手禮）
                                           ──► Rank Service（快取 username）
Member Service ──publish friend.relationship.updated──► Rank Service（重建好友排行）

「入帳指令」（ADR-002）——發指令的一律不自己寫 wallet：
Member Service（簽到/月度獎勵/新手禮）─┐
Admin Service（GM 發幣）             ─┼─ publish wallet.credit.request ──► Wallet Service（冪等入帳）
Game Service（cashback 回饋）        ─┘

「帳務事件」——wallet 入帳/扣款後才發：
Wallet Service ──publish wallet.debit / wallet.credit ──► Rank Service（更新排行）
                                                      ──► Admin Service（流通量報表／異常偵測）
                                                      ──► Wallet Service 自身 WalletReadSyncListener（同步 MySQL 讀視圖，唯一安全例外）

Game Service   ──publish game.result     ──► Notification Service（推播結果）、Admin Service（RTP/異常）

Rank Service   ──publish rank.update     ──► Notification Service（廣播排行）
               ──publish notification.push─► Notification Service（週榜重置 TOP3 通知）
```

**原則：** 能非同步就非同步，降低服務耦合度；只有需要等待回應結果（如扣款）才用同步呼叫。

---

## 4. 資料庫分配（PostgreSQL vs MySQL）

> 詳細決策過程請參閱 [ADR-001 資料庫分配決策](adr/ADR-001.md)

### PostgreSQL（帳務核心 — 寫入主庫）

| Table | 所屬 Service | 說明 |
|-------|-------------|------|
| `wallets` | Wallet | 玩家錢包（balance、frozen_amount、**version** 樂觀鎖） |
| `wallet_transactions` | Wallet | 帳務流水（write 端；`idempotency_key` UNIQUE、`chk_wt_sub_type` CHECK） |
| `diamond_wallets` | Wallet | 鑽石錢包（T-101） |
| `shop_redemptions` | Wallet | 商城兌換紀錄（ADR-006，與 `debit(SHOP_PURCHASE)` 同一交易內原子完成） |
| `topup_orders` | Wallet | 自助加值訂單（模擬支付；orderNo 當冪等鍵） |
| `game_rounds` | Game | 遊戲對局紀錄（`win_amount` 為**含本金**派彩，影響 RTP 口徑，雷區 17） |
| `game_rtp_stats` | Game | RTP 統計（排程預算，熱路徑只讀 Redis 快取——T-090 Phase A） |
| `cashback_records` | Game | 每日/每週回饋紀錄 |
| `pending_wallet_credits` | Game | **credit 失敗補償單**（ADR-009） |
| `rank_history` | Rank | 每週排行榜快照 |
| `rank_daily_snapshots` | Rank | 每日持幣快照 |
| `admin_users` | Admin | 後台帳號（獨立於玩家 `members`） |
| `admin_alerts` | Admin | 異常告警紀錄 |
| `admin_action_logs` | Admin | 後台操作稽核 |
| `dead_letter_messages` | 共用 | DLT 訊息落地（供後台查詢/重試） |

**選擇理由：** 強 ACID 保證、Row-Level Locking 精準、樂觀鎖支援好，適合帳務不能出錯的場景。

### MySQL（查詢讀庫 — CQRS 讀端）

| Table | 所屬 Service | 說明 |
|-------|-------------|------|
| `members` | Member | 玩家帳號資料（`status` 停權欄位由 admin 經內部 API 更新） |
| `member_social_accounts` | Member | Google／LINE／Apple 綁定；以 `(provider, provider_subject)` 唯一識別（ADR-011） |
| `friendships` | Member | 好友關係 |
| `daily_checkins` | Member | 每日簽到紀錄 |
| `monthly_reward_claims` | Member | 月度累計簽到獎勵領取紀錄（ADR-005） |
| `task_definitions` / `player_tasks` | Member | 任務定義／玩家進度 |
| `outbox_events` | Member | Outbox 事件表 |
| `gift_logs` | Wallet | 好友贈幣紀錄 |
| `wallet_transactions` | Wallet | 帳務流水（read 端；由 `WalletReadSyncListener` 消費事件同步，`existsById` 冪等） |
| `diamond_cards` | Admin（寫）／Wallet（讀） | 鑽石點數卡（T-105/106 後台生成，玩家端兌換） |
| `shop_items` | Admin（CRUD）／Wallet（讀） | 商城目錄（**正式目錄的單一真相**；`contracts/shop-catalog.json` 僅供前端 mock，雷區 20） |
| `system_health_check` | 基礎建設 | 初始化健康檢查 |

**選擇理由：** 讀取效能好、生態熟悉（多數組員較熟悉）、適合高頻查詢的 CQRS 讀端。

---

## 5. Redis 用途分配

| Key 命名 | 資料類型 | 用途 | TTL | 維護者 |
|---------|---------|------|-----|--------|
| `refresh:{memberId}` | String | Refresh Token（一人一把 → 新登入踢掉舊裝置）；`refreshToken()` 每次換發時 rotate + 重設 TTL，**非固定倒數** | `jwt.refresh-token-expiry-ms`（現行 7 天） | Member Service |
| `jwt:blacklist:{jti}` | String | JWT 黑名單（已登出 access token）；key prefix 須與 gateway `JwtAuthenticationGlobalFilter` 一致 | Token 剩餘有效期 | Member Service（gateway 查詢） |
| `disabled:player:{id}` | String | 玩家停用即時封鎖旗標 | 停用期間 | Member / Admin |
| `oauth:binding-ticket:{ticket}` | String | 已登入玩家啟動社群綁定的一次性票據 | 5 分鐘 | Member Service |
| `oauth:login-ticket:{ticket}` | String | OAuth 成功後交換 Lucky Star JWT 的一次性票據 | 2 分鐘 | Member Service |
| `token:min-iat:{playerId}` | String | 簽發時間下限；`iat` 早於此值的 token 一律 401（撤銷舊 token） | — | Gateway 驗、Member 寫 |
| `game:session:{playerId}:{roundId}` | Hash | 遊戲 Session（serverSeed、下注額、狀態） | 30 分鐘 | Game Service |
| **`game:fishing:session:{sessionId}`** | Hash | **捕魚 Session：跨批累傷 `fishDamage`、`kills`、`betPerShot`、`cannonLevel`、`topUpRequestIds`**——漏存欄位＝大魚永遠打不死（雷區 16） | 場次期間 | Game Service |
| `risk:rtp:{gameType}` | String | 全局 RTP 快取（排程預算，熱路徑只讀——T-090 A1） | 短 | Game Service |
| `risk:inflight:{playerId}` | 計數器 | 風控並發閘（取號/釋放各一支 Lua，防負值漂移——T-090 A4） | 短 | Game Service |
| `risk:player-day:{playerId}:{date}:{gameType}` | 計數器 | 玩家當日淨贏水位（原 DB 聚合改 Redis——T-090 A2） | 到午夜 | Game Service |
| `rate:player:{playerId}` | 計數器 | 玩家 API 請求限流 | 滑動視窗 | Gateway |
| gateway 在途計數 | 記憶體（非 Redis） | per-route 在途上限（AIMD 自適應，超限 429，T-090 C3） | — | Gateway |
| `rank:global:coins` | ZSet | 全服排行榜（score = 持幣量） | 無（永久） | Rank Service |
| `rank:player:usernames` | Hash | 排行榜 playerId → username read model | 無（永久） | Rank Service |
| `rank:friend:{playerId}` | ZSet | 好友排行榜 | 24 小時 | Rank Service |
| `rank:daily:winnings` | ZSet | 今日贏幣王排行 | 到午夜 | Rank Service |
| `wallet:gift:sent:{playerId}:{date}` | String | 今日已贈幣累計量 | 到午夜 | Wallet Service |
| `wallet:gift:recv:{playerId}:{date}` | String | 今日已收幣累計量 | 到午夜 | Wallet Service |
| `wallet:bankruptcy:{playerId}:{date}` | String | 今日是否已領破產補助 | 到午夜 | Wallet Service |

---

## 6. Kafka Topic 命名與規格

### 本機開發規格

實際清單以 `kafka/kafka-init.sh` 為準：**8 個業務 topic（partitions 3）+ 5 個 DLT（partitions 1）**，replication 皆為 1（本機單 broker）。

| Topic | 發布者 | 消費者 |
|-------|--------|--------|
| `member.registered` | Member | Wallet（開戶）、Member（新手禮）、Rank（快取 username） |
| **`wallet.credit.request`**（**指令**） | Member（簽到/月獎/新手禮）、Admin（GM 發幣）、Game（cashback） | Wallet（冪等入帳） |
| `wallet.debit`（事件） | Wallet | Rank、Admin、Wallet 自身讀視圖同步 |
| `wallet.credit`（事件） | Wallet | Rank、Admin、Wallet 自身讀視圖同步 |
| `friend.relationship.updated` | Member | Rank（依**完整好友清單**重建，雷區 11） |
| `game.result` | Game | Notification、Admin |
| `rank.update` | Rank | Notification |
| `notification.push` | Rank、Admin | Notification |

**DLT（5 個）**：`member.registered.DLT`、`wallet.debit.DLT`、`wallet.credit.DLT`、`wallet.credit.request.DLT`、`friend.relationship.updated.DLT`。Consumer 重試耗盡後轉入，落地 `dead_letter_messages` 供後台查詢/重試。
Notification 為 best-effort 推播，**刻意不設 DLT**。

> ⚠️ 增刪 topic 必須同步更新 `tests/infra/kafka.test.js` 的清單與數量斷言，否則 CI 紅（雷區 7）。

### 命名規範

- 格式：`{領域}.{事件動詞/名詞}`，全小寫，以 `.` 分隔
- Dead Letter Topic：在原 topic 後加 `.DLT`
- 禁止使用底線或駝峰命名（例如 ❌ `walletDebit`、❌ `wallet_debit`）

---

## 7. Port 分配表

| 服務 | 本機 Port | Container 內部 Port | 說明 |
|------|----------|---------------------|------|
| Frontend 玩家端 | 5173 | 5173 | Vite 開發伺服器（`frontend/`） |
| Frontend 管理後台 | 5174 | 5174 | 獨立專案 `frontend-admin/`；dev 走 vite proxy `/admin`→8080 |
| Gateway Service | 8080 | 8080 | 唯一對外入口 |
| Member Service | 8081 | 8081 | 僅 Gateway 可路由 |
| Wallet Service | 8082 | 8082 | 僅 Gateway / 內部呼叫 |
| Game Service | 8083 | 8083 | 僅 Gateway / 內部呼叫 |
| Rank Service | 8084 | 8084 | 僅 Gateway 可路由 |
| Admin Service | 8086 | 8086 | Gateway 純轉發，認證在 admin 自身 |
| **Notification Service** | **8087** | 8087 | WebSocket `/ws`（STOMP over SockJS） |
| MySQL | 3307 | 3306 | 使用 3307 避免與本機衝突 |
| PostgreSQL | 5433 | 5432 | 使用 5433 避免與本機衝突 |
| Redis | 6379 | 6379 | 標準 Port |
| Kafka | 9092 | 9092 | KRaft 模式（broker+controller 合一，無 Zookeeper） |
| Kafka UI | 8085 | 8080 | 瀏覽器管理介面 |
| Prometheus | 9090 | 9090 | `observability` profile（選配） |
| Grafana | 3000 | 3000 | `observability` profile（選配） |

> ⚠️ **容器內走原生 port**（`postgres:5432`、`mysql:3306`），不是宿主機的 5433/3307；`docker compose` 的 environment 區塊已覆寫。

---

## 8. 關鍵請求流程

### 8.1 玩家登入流程

```
前端                Gateway           Member Service        Redis
 │                    │                    │                  │
 │──POST /auth/login──►│                    │                  │
 │                    │──（免驗證白名單）──►│                  │
 │                    │                    │──驗證帳密────────►│
 │                    │                    │◄──OK──────────────│
 │                    │                    │──寫 Refresh Token─►│
 │◄────200 + JWT Token──────────────────────│                  │
```

第三方登入（ADR-011）：

```
前端        Gateway       Member        Google/LINE/Apple       Redis
 │─start────►│────────────►│                    │                 │
 │◄──authorizationUrl──────│                    │                 │
 │────────────導向供應商───────────────────────►│                 │
 │◄────────────callback authorization code─────│                 │
 │            │────────────►│─交換 code/驗證 sub►│                 │
 │            │             │─暫存 JWT ticket────────────────────►│
 │◄──/auth/callback?ticket──│                    │                 │
 │─POST exchange───────────►│─GETDEL ticket───────────────────────►│
 │◄────────JWT──────────────│                    │                 │
```

### 8.2 老虎機下注完整流程

```
前端         Gateway              Game Service         Wallet Service   Kafka
 │             │                       │                    │            │
 │─POST /spin─►│                       │                    │            │
 │             │─① 在途上限（AIMD）────│                    │            │
 │             │   超限→429 立即卸載   │                    │            │
 │             │─② 玩家限流            │                    │            │
 │             │─③ JWT 驗證（黑名單/停用/min-iat）           │            │
 │             │──────────────────────►│                    │            │
 │             │                       │─風控：取號（Lua）＋讀 RTP 快取  │
 │             │                       │─POST /internal/wallet/debit────►│
 │             │                       │                    │─樂觀鎖扣款 │
 │             │                       │◄──扣款成功─────────│            │
 │             │                       │──Provably Fair RNG 計算         │
 │             │                       │─POST /internal/wallet/credit───►│（命中才呼叫）
 │             │                       │   ✗失敗 → 落 pending_wallet_credits
 │             │                       │           排程 30s 用「同一冪等鍵」重試（ADR-009）
 │             │                       │─存 game_rounds、風控釋放（Lua）│
 │             │                       │──publish game.result───────────►│
 │◄──200 遊戲結果────────────────────── │                    │            │
```

> 熱路徑**不做** DB 聚合：全局 RTP 與玩家當日水位都改由排程/事件維護、請求內只讀 Redis（T-090 Phase A）。

### 8.3 排行榜即時更新流程

```
Wallet Service  Kafka          Rank Service    Notification   前端 WS
     │            │                │               │            │
     │─publish────►│               │               │            │
     │ wallet.credit│─消費─────────►│               │            │
     │            │                │─ZADD ZSet─────│            │
     │            │                │─publish────────►│           │
     │            │                │ rank.update    │─SimpMsg────►│
     │            │                │               │ 廣播/topic/rank
```

---

## 9. 相關 ADR 文件

| ADR | 決策主題 | 狀態 |
|-----|---------|------|
| [ADR-000](adr/ADR-000.md) | 後端語言選型：Java（Spring Boot）而非 Go | ✅ 已接受 |
| [ADR-001](adr/ADR-001.md) | 資料庫分配：PostgreSQL（寫）+ MySQL（讀）CQRS | ✅ 已接受 |
| [ADR-002](adr/ADR-002.md) | `wallet.credit` 事件契約：分離「入帳指令」與「入帳事件」 | ✅ 已接受 |
| [ADR-003](adr/ADR-003.md) | 捕魚機血量/傷害模型（HP + 致命一擊捕獲機率） | ✅ 已接受 |
| [ADR-004](adr/ADR-004.md) | 捕魚機經濟再平衡（殘血回收 + 子彈面額玩家自選） | ✅ 已接受 |
| [ADR-005](adr/ADR-005.md) | 月度累計簽到獎勵 + 簽到狀態改後端權威 | ✅ 已接受 |
| [ADR-006](adr/ADR-006.md) | 禮品商城後端化（併入 wallet/admin、`SHOP_PURCHASE` 子型） | ✅ 已接受 |
| [ADR-007](adr/ADR-007.md) | 以 Testcontainers 補真實資料庫整合測試（只新增、不取代 H2） | ✅ 已接受 |
| ADR-008 | 捕魚 Redis session 原子化（Lua CAS） | 🅿️ 編號保留，**尚未動工**（見 `plans/01` Phase 3） |
| [ADR-009](adr/ADR-009.md) | game→wallet 最小 Saga 補償（`pending_wallet_credits` + 冪等重試） | ✅ 已接受 |

> 原 v1.0 此表把 ADR-002~005 標成「RNG 演算法／樂觀鎖／Kafka 邊界／JWT 雙 Token」，**與實際產出的 ADR 主題完全不同**，已於 2026-07-13 依 `docs/adr/` 實際檔案更正。
