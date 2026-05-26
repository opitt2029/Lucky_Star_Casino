# 幸運星幣城 — 系統架構文件

> 版本：v1.0  
> 建立日期：2026-05-26  
> 負責人：組長 A

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
┌─────────────────────────────────────┐
│          API Gateway（Port 8080）    │
│  ● JWT 驗證                         │
│  ● 限流（Rate Limiter）              │
│  ● 路由轉發                          │
│  ● 熔斷（Circuit Breaker）           │
└──────┬──────┬──────┬──────┬─────────┘
       │      │      │      │
       ▼      ▼      ▼      ▼
  Member  Wallet  Game   Rank   Admin
  8081    8082    8083   8084   8086

       Kafka（非同步事件）
  ┌────────────────────────────────┐
  │  member.registered             │
  │  wallet.debit / wallet.credit  │
  │  game.result                   │
  │  rank.update                   │
  │  notification.push             │
  └────────────────────────────────┘
       ▲      ▲      ▲      ▲
       │      │      │      │
  Member  Wallet  Game   Rank   Notification
```

**系統邊界說明：**
- 前端只與 Gateway 溝通，**不直接呼叫任何業務 Service**
- Service 之間的同步呼叫使用 `/internal/**` 路徑（需帶 `X-Internal-Secret` Header 驗證）
- Service 之間的非同步通信透過 Kafka 事件

---

## 2. 服務邊界定義

### 2.1 Gateway Service

| 項目 | 說明 |
|------|------|
| **職責** | 統一入口、JWT 驗證、路由轉發、限流、熔斷 |
| **不負責** | 業務邏輯、資料存取 |
| **路由規則** | `/api/v1/auth/**` → Member Service（白名單，免驗證） |
| | `/api/v1/wallet/**` → Wallet Service |
| | `/api/v1/game/**` → Game Service |
| | `/api/v1/rank/**` → Rank Service |
| | `/admin/**` → Admin Service（需 ADMIN role） |
| | `/ws` → Notification Service（WebSocket） |
| **Token 注入** | 驗證通過後，解析 playerId 注入 `X-Player-Id` Header 傳給下游 |

### 2.2 Member Service

| 項目 | 說明 |
|------|------|
| **職責** | 會員註冊/登入/登出、JWT 簽發、個人資料 CRUD、好友系統、簽到、任務系統 |
| **資料庫** | MySQL（members、friendships、daily_checkins、task_definitions、player_tasks） |
| **Redis** | JWT Refresh Token 儲存、JWT 黑名單 |
| **Kafka 發布** | `member.registered`（註冊完成） |
| **Kafka 消費** | `member.registered`（新手禮包邏輯） |
| **對外 API 前綴** | `/api/v1/auth/**`、`/api/v1/player/**` |
| **對內 API 前綴** | `/internal/member/**` |

### 2.3 Wallet Service

| 項目 | 說明 |
|------|------|
| **職責** | 星幣餘額管理、下注扣款、派彩入帳、帳務流水、好友贈幣、破產補助 |
| **資料庫** | PostgreSQL（wallets、wallet_transactions — 帳務核心，需 ACID） |
| | MySQL（wallet_transactions 讀庫 — 查詢用，CQRS 讀寫分離） |
| **Redis** | 好友贈幣當日累計量、破產補助當日狀態（TTL 到午夜重置） |
| **Kafka 發布** | `wallet.debit`、`wallet.credit` |
| **Kafka 消費** | `member.registered`（新玩家開戶） |
| **對外 API 前綴** | `/api/v1/wallet/**` |
| **對內 API 前綴** | `/internal/wallet/**`（供 Game Service 呼叫扣款/派彩） |
| **關鍵設計** | 樂觀鎖（version 欄位）防超扣、冪等鍵（idempotency_key）防重複 |

### 2.4 Game Service（RNG）

| 項目 | 說明 |
|------|------|
| **職責** | Provably Fair RNG 引擎、老虎機遊戲、百家樂遊戲、遊戲 Session 管理、RTP 統計 |
| **資料庫** | PostgreSQL（game_rounds — 遊戲紀錄） |
| **Redis** | 遊戲 Session（Key: `game:session:{playerId}:{roundId}`，TTL 30 分鐘） |
| **Kafka 發布** | `game.result` |
| **同步呼叫** | `POST /internal/wallet/debit`（下注扣款）、`POST /internal/wallet/credit`（派彩） |
| **對外 API 前綴** | `/api/v1/game/**` |
| **關鍵設計** | SHA-256(serverSeed + clientSeed + nonce) 演算法確保公平可驗證 |

### 2.5 Rank Service

| 項目 | 說明 |
|------|------|
| **職責** | 全服排行榜、好友排行榜、每週排行榜重置、歷史快照 |
| **資料庫** | PostgreSQL（rank_history、rank_daily_snapshots） |
| **Redis** | `rank:global:coins` ZSet（全服排行）、`rank:friend:{playerId}` ZSet（好友榜）、`rank:daily:winnings` ZSet（今日贏幣王） |
| **Kafka 消費** | `wallet.credit`、`wallet.debit`（觸發排行更新） |
| **Kafka 發布** | `rank.update`（TOP10 變動時廣播）、`notification.push`（週榜重置通知 TOP3） |
| **對外 API 前綴** | `/api/v1/rank/**` |

### 2.6 Admin Service

| 項目 | 說明 |
|------|------|
| **職責** | 玩家帳號管理、星幣流通報表、RTP 監控、異常玩家偵測、GM 工具 |
| **資料庫** | MySQL（讀取各服務資料用）、PostgreSQL（admin_alerts） |
| **Redis** | 無（Admin 不走快取，確保數據即時） |
| **Kafka 發布** | `notification.push`（異常告警通知管理員） |
| **對外 API 前綴** | `/admin/**`（需 ADMIN role） |
| **角色** | `SUPER_ADMIN`（全權）、`OPERATOR`（查詢+部分操作） |

### 2.7 Notification Service

| 項目 | 說明 |
|------|------|
| **職責** | WebSocket STOMP Server、Kafka 事件橋接推播 |
| **資料庫** | 無（純推播，不持久化） |
| **WebSocket 頻道** | `/user/queue/notifications`（私人）、`/topic/rank`（公共廣播） |
| **Kafka 消費** | `notification.push`、`game.result`、`rank.update` |
| **備注** | 此服務未在 docker-compose 獨立列出，可整合至 Admin Service 或獨立 Port |

---

## 3. 服務間通信策略

### 3.1 同步通信（REST）— 需要立即結果時使用

```
Game Service ──POST /internal/wallet/debit──► Wallet Service
Game Service ──POST /internal/wallet/credit─► Wallet Service
Gateway      ──驗證 JWT──────────────────────► Redis（黑名單查詢）
Admin Service ──查詢玩家詳情────────────────► Member Service
```

**安全機制：** `/internal/**` 路徑需帶 `X-Internal-Secret` Header，Gateway 設白名單不對外暴露。

### 3.2 非同步通信（Kafka）— 不需要立即結果時使用

```
Member Service ──publish member.registered──► Wallet Service（開戶）
                                           ──► Member Service（新手禮）

Wallet Service ──publish wallet.debit    ──► Rank Service（更新排行）
               ──publish wallet.credit   ──► Rank Service（更新排行）

Game Service   ──publish game.result     ──► Notification Service（推播結果）

Rank Service   ──publish rank.update     ──► Notification Service（廣播排行）
               ──publish notification.push─► Notification Service（TOP3 通知）
```

**原則：** 能非同步就非同步，降低服務耦合度；只有需要等待回應結果（如扣款）才用同步呼叫。

---

## 4. 資料庫分配（PostgreSQL vs MySQL）

> 詳細決策過程請參閱 [ADR-001 資料庫分配決策](adr/ADR-001.md)

### PostgreSQL（帳務核心 — 寫入主庫）

| Table | 所屬 Service | 說明 |
|-------|-------------|------|
| `wallets` | Wallet | 玩家錢包（balance、frozen_amount、version） |
| `wallet_transactions` | Wallet | 帳務流水（write 端） |
| `game_rounds` | Game | 遊戲對局紀錄 |
| `rank_history` | Rank | 每週排行榜快照 |
| `rank_daily_snapshots` | Rank | 每日持幣快照 |
| `game_rtp_stats` | Game | RTP 統計資料 |
| `admin_alerts` | Admin | 異常告警紀錄 |

**選擇理由：** 強 ACID 保證、Row-Level Locking 精準、樂觀鎖支援好，適合帳務不能出錯的場景。

### MySQL（查詢讀庫 — CQRS 讀端）

| Table | 所屬 Service | 說明 |
|-------|-------------|------|
| `members` | Member | 玩家帳號資料 |
| `friendships` | Member | 好友關係 |
| `daily_checkins` | Member | 每日簽到紀錄 |
| `task_definitions` | Member | 任務定義表 |
| `player_tasks` | Member | 玩家任務進度 |
| `gift_logs` | Wallet | 好友贈幣紀錄 |
| `wallet_transactions` | Wallet | 帳務流水（read 端，供查詢分頁用） |

**選擇理由：** 讀取效能好、生態熟悉（多數組員較熟悉）、適合高頻查詢的 CQRS 讀端。

---

## 5. Redis 用途分配

| Key 命名 | 資料類型 | 用途 | TTL | 維護者 |
|---------|---------|------|-----|--------|
| `auth:refresh:{playerId}` | String | Refresh Token 儲存 | 7 天 | Member Service |
| `auth:blacklist:{jti}` | String | JWT 黑名單（已登出 Token） | Token 剩餘有效期 | Member Service |
| `game:session:{playerId}:{roundId}` | Hash | 遊戲 Session（serverSeed、下注額、狀態） | 30 分鐘 | Game Service |
| `rate:player:{playerId}` | 計數器 | API 請求限流（每秒上限 10 次） | 1 秒滑動視窗 | Gateway |
| `rank:global:coins` | ZSet | 全服排行榜（score = 持幣量） | 無（永久） | Rank Service |
| `rank:friend:{playerId}` | ZSet | 好友排行榜 | 24 小時 | Rank Service |
| `rank:daily:winnings` | ZSet | 今日贏幣王排行 | 到午夜 | Rank Service |
| `wallet:gift:sent:{playerId}:{date}` | String | 今日已贈幣累計量 | 到午夜 | Wallet Service |
| `wallet:gift:recv:{playerId}:{date}` | String | 今日已收幣累計量 | 到午夜 | Wallet Service |
| `wallet:bankruptcy:{playerId}:{date}` | String | 今日是否已領破產補助 | 到午夜 | Wallet Service |

---

## 6. Kafka Topic 命名與規格

### 本機開發規格

| Topic | Partitions | Replication | 發布者 | 消費者 |
|-------|-----------|-------------|--------|--------|
| `member.registered` | 1 | 1 | Member Service | Wallet Service、Member Service |
| `wallet.debit` | 1 | 1 | Wallet Service | Rank Service |
| `wallet.credit` | 1 | 1 | Wallet Service | Rank Service |
| `game.result` | 1 | 1 | Game Service | Notification Service |
| `rank.update` | 1 | 1 | Rank Service | Notification Service |
| `notification.push` | 1 | 1 | 多個 Service | Notification Service |
| `wallet.debit.DLT` | 1 | 1 | Kafka（自動） | Admin Service（手動重試） |
| `wallet.credit.DLT` | 1 | 1 | Kafka（自動） | Admin Service（手動重試） |

> **DLT（Dead Letter Topic）**：Wallet Service 消費失敗超過 3 次的訊息自動轉入，管理員可查詢並手動重試。

### 命名規範

- 格式：`{領域}.{事件動詞/名詞}`，全小寫，以 `.` 分隔
- Dead Letter Topic：在原 topic 後加 `.DLT`
- 禁止使用底線或駝峰命名（例如 ❌ `walletDebit`、❌ `wallet_debit`）

---

## 7. Port 分配表

| 服務 | 本機 Port | Container 內部 Port | 說明 |
|------|----------|---------------------|------|
| Frontend (React) | 5173 | 5173 | Vite 開發伺服器 |
| Gateway Service | 8080 | 8080 | 唯一對外入口 |
| Member Service | 8081 | 8081 | 僅 Gateway 可路由 |
| Wallet Service | 8082 | 8082 | 僅 Gateway / 內部呼叫 |
| Game Service | 8083 | 8083 | 僅 Gateway / 內部呼叫 |
| Rank Service | 8084 | 8084 | 僅 Gateway 可路由 |
| Admin Service | 8086 | 8086 | 僅 Gateway（ADMIN role）|
| MySQL | 3307 | 3306 | 使用 3307 避免與本機衝突 |
| PostgreSQL | 5433 | 5432 | 使用 5433 避免與本機衝突 |
| Redis | 6379 | 6379 | 標準 Port |
| Zookeeper | 2181 | 2181 | Kafka broker 協調 |
| Kafka | 9092 | 9092 | 標準 Port |
| Kafka UI | 8085 | 8080 | 瀏覽器管理介面 |

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

### 8.2 老虎機下注完整流程

```
前端         Gateway      Game Service    Wallet Service   Kafka
 │             │               │               │             │
 │─POST /spin─►│               │               │             │
 │             │─JWT驗證─────►│               │             │
 │             │               │─POST /internal/wallet/debit─►│
 │             │               │               │─樂觀鎖扣款──│
 │             │               │               │─write TX────│
 │             │               │◄──扣款成功────│             │
 │             │               │──執行 RNG 計算│             │
 │             │               │─POST /internal/wallet/credit►│
 │             │               │               │─入帳────────│
 │             │               │──publish game.result─────────►│
 │◄──200 遊戲結果──────────────│               │             │
```

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
| [ADR-001](adr/ADR-001.md) | PostgreSQL（寫）+ MySQL（讀）CQRS 分離 | ✅ 已確認 |
| ADR-002 | Provably Fair RNG 演算法選用 | 待 T-030 產出 |
| ADR-003 | 樂觀鎖防超扣設計 | 待 T-022 產出 |
| ADR-004 | Kafka 非同步通信邊界定義 | 待 T-005 完工後補充 |
| ADR-005 | JWT 雙 Token（Access + Refresh）策略 | 待 T-011 產出 |
