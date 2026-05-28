# Changelog — Lucky Star Casino

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [security] — 2026-05-28 — Gateway 身份 Header 防偽造與 /admin 權限強制（FIX-3 / FIX-4）

### Fixed

- `backend/gateway-service/src/main/java/com/luckystar/gateway/filter/JwtAuthenticationGlobalFilter.java`
  - **FIX-3（IDOR 修補）**：原本 Gateway 不會移除用戶端傳入的 `X-User-Id` / `X-User-Role`，且用 `.header(...)` 是「附加」而非「覆蓋」，導致偽造的同名 header 會以重複值殘留、被下游 `getFirst()` 讀到。下游（如 wallet-service）完全信任此 header → 任何登入者可越權查他人錢包。
    - 已驗證路徑：改用 `headers(Consumer)` **先 remove 再 set**，確保身份 header 只可能來自 Gateway 的 JWT 驗證結果。
    - 白名單路徑（登入/註冊/健康檢查）：放行前也**剝除**這兩個 header，避免未驗證請求注入身份。
  - **FIX-4（權限強制）**：原本 `/admin/**` 只需有效 JWT、未檢查角色。新增：路徑以 `/admin/` 開頭且 role 非 `ADMIN` 時回 **403**（`X-Auth-Error: admin role required`），採 default-deny（role 為 null/空一律拒絕）。檢查置於黑名單檢查之後，確保撤銷/無效 token 仍回 401 而非 403。

### Added

- `backend/gateway-service/src/test/java/com/luckystar/gateway/filter/JwtAuthenticationGlobalFilterTest.java`（新增）
  - 12 個 filter 單元測試（先前 Gateway 僅有 `contextLoads`）：
    - FIX-3：偽造 `X-User-Id`/`X-User-Role` 被 claim 覆蓋、白名單剝除、缺 token 401、無效 token 401、黑名單 401、Redis 故障 fail-closed 401、正常轉發。
    - FIX-4：`/admin` + ADMIN 放行、`/admin` + 非 ADMIN 403、`/admin` 無 role claim 403、非 admin 路徑不受影響。

### Verified

- `mvn -Dtest=JwtAuthenticationGlobalFilterTest test` → `Tests run: 12, Failures: 0, Errors: 0`。

### Note

- FIX-4 的角色檢查仰賴 JWT 的 `role` claim 不可被偽造，而這正由 FIX-3 保證，故兩者一併提交。
- `admin-service` 目前仍為空骨架；本次僅在 Gateway 層補上權限關卡，admin-service 實作其端點時仍應自行做縱深防禦（驗 `X-User-Role` 或內部 secret）。

---

## [fix] — 2026-05-28 — Wallet Kafka 事件失敗不再靜默丟失（FIX-2）

### Fixed

- `backend/wallet-service/src/main/java/com/luckystar/wallet/kafka/MemberEventListener.java`
  - 移除「無論成功或失敗都 `ack.acknowledge()`」的邏輯，改為**僅在成功時 ack**。
  - 原因：原本建立錢包失敗時只 log 卻仍 ack，導致該筆 `member.registered` 事件被吃掉、永不重試，會員因而沒有錢包（資料遺失）。
  - 格式錯誤（`NumberFormatException`）視為不可重試的 poison message，直接拋出交由 error handler 送 DLT。
  - 暫時性錯誤（如 DB 斷線）讓例外往外拋、不 ack，由 error handler 重試後仍失敗才送 DLT。

### Added

- `backend/wallet-service/src/main/java/com/luckystar/wallet/config/KafkaConsumerConfig.java`
  - 新增 `DeadLetterPublishingRecoverer`：失敗訊息送往 `<topic>.DLT`（即 `member.registered.DLT`）。
  - 新增 `DefaultErrorHandler`：暫時性錯誤重試 3 次（間隔 1 秒），仍失敗才送 DLT；`NumberFormatException` 列為不可重試。
  - 將 error handler 透過 `factory.setCommonErrorHandler(...)` 掛上既有的 listener container factory（保留 `MANUAL_IMMEDIATE` ack 模式）。

### Modified

- `backend/wallet-service/src/test/java/com/luckystar/wallet/kafka/MemberEventListenerTest.java`
  - 更新測試：poison message 應拋例外且**不** ack；暫時性失敗應傳播例外且**不** ack；新增 trim 空白測試。

### Verified

- `mvn -Dtest=MemberEventListenerTest test` → `Tests run: 4, Failures: 0, Errors: 0`。
- 既有的 `WalletServiceApplicationTests.contextLoads` 在本機因未啟動 PostgreSQL（`Schema-validation: missing table [wallets]`）而失敗，此為**既有環境問題**，已用 git stash 比對確認與本次變更無關。

---

## [fix] — 2026-05-28 — Wallet 餘額 API Header 名稱對齊 Gateway（FIX-1）

### Fixed

- `backend/wallet-service/src/main/java/com/luckystar/wallet/controller/WalletController.java`
  - 將讀取的 header 從 `X-Player-Id` 改為 `X-User-Id`，並同步更新錯誤訊息字串。
  - 原因：Gateway 的 `JwtAuthenticationGlobalFilter` 對下游一律轉發 `X-User-Id`，但 wallet 卻讀 `X-Player-Id`，導致透過 Gateway 呼叫 `GET /api/v1/wallet/balance` 永遠回 `400 Missing X-Player-Id header`，錢包餘額 API 對外完全不可用。
  - 修正後全服務統一使用單一標準 header 名稱 `X-User-Id`，避免日後再次漂移。

### Modified

- `backend/wallet-service/src/test/java/com/luckystar/wallet/controller/WalletControllerTest.java`
  - 3 處測試 header 名稱由 `X-Player-Id` 同步更新為 `X-User-Id`。

### Verified

- `mvn -Dtest=WalletControllerTest test` → `Tests run: 4, Failures: 0, Errors: 0`。

### Note

- FIX-1 僅解決「名稱不一致導致 400」的功能性問題；`X-User-Id` 目前**仍可被用戶端偽造**（Gateway 尚未剝除外部傳入的身份 header），越權風險待 FIX-3 處理。

### 待辦事項（後續整理）

- **FIX-2（P0）** — Kafka `member.registered` 失敗不再靜默丟失（成功才 ack、暫時性錯誤 rethrow + DLT）。
- **FIX-3（P1）** — Gateway 剝除用戶端偽造的 `X-User-Id`/`X-User-Role`（IDOR 修補）。
- **FIX-4（P1）** — Gateway 對 `/admin/**` 強制 `ADMIN` role（依賴 FIX-3）。
- 前端 `walletSlice` 串接真實 wallet API（取代 mockApi）。
- 前端 `gameSlice` / `rankSlice` 待 game-service / rank-service 實作後串接。
- 前端簽到欄位對接 member-service `CheckinController`（目前 `mapProfile` 寫死預設值）。

---

## [docs] - 2026-05-28 - 新增本機前後端串接測試指南

### Added

- `docs/LOCAL_API_INTEGRATION_GUIDE.md`
  - 新增一份給同學與 AI 都能快速理解的本機串接指南。
  - 說明本機架構：Frontend 透過 Gateway `http://localhost:8080` 呼叫後端，不直接打 `member-service:8081`。
  - 補上完整啟動順序：Docker 基礎服務、Member Service、Gateway Service、Frontend。
  - 補上會員 API 測試流程：`register -> login -> GET /api/v1/player/profile`。
  - 補上 PowerShell 測試指令，方便不用開前端也能確認 Gateway 與會員 API 是否正常。
  - 補上常見問題排查：CORS、401 Unauthorized、資料庫 schema validation、Vite port `5173/5174`。
  - 加入「給 AI 的快速上下文」段落，讓同學之後把這段貼給其他電腦上的 AI，也能快速知道怎麼協助串接與 debug。

### Modified

- `.env.example`
  - 補上 `INTERNAL_SECRET`，並保留 `INTERNAL_SERVICE_SECRET`。
  - 原因是目前不同 service 讀取的環境變數名稱不完全一致：`member-service` 讀 `INTERNAL_SECRET`，部分服務仍使用 `INTERNAL_SERVICE_SECRET`。
  - 本機開發先讓兩個 secret 都存在且值一致，避免同學啟動不同 service 時遇到缺少環境變數的錯誤。

### Why

- 這份文件的目的不是取代 README，而是提供「本機前後端串接」的最短路徑。
- 對新同學來說，可以照步驟完成本機環境設定與會員系統測試。
- 對 AI 來說，可以快速取得專案 port、API 入口、重要檔案與常見錯誤背景，減少每次 debug 都要重新探索專案結構的時間。

---

## [fix] - 2026-05-28 - Gateway CORS 支援 Vite 備用 Port

### Fixed

- `.env.example`
  - 將 `CORS_ALLOWED_ORIGINS` 從只允許 `http://localhost:5173`，更新為同時允許 `http://localhost:5173,http://localhost:5174`。
  - 修正前端因 Vite 預設 port 被佔用而改跑 `5174` 時，瀏覽器呼叫 Gateway `8080` 會被 CORS 擋下的問題。

### Verified

- 已重啟 Gateway，確認 `http://localhost:5173` 與 `http://localhost:5174` 的 CORS preflight 都能通過。
- 已透過 Gateway 測試會員流程：`register -> login -> GET /api/v1/player/profile` 成功。
- `frontend` 執行 `npm run build` 成功。

---

## [feat] — 2026-05-28 — 前端會員系統 API 串接

### Added

- `frontend/src/services/memberApi.js`（新增）
  - 封裝對後端真實 API 的呼叫，取代原本的 `mockApi`
  - `login()` — 呼叫 `POST /api/v1/auth/login` 取得 token 後，再呼叫 `GET /api/v1/player/profile` 補回玩家資料，組合成前端所需格式
  - `register()` — 呼叫 `POST /api/v1/auth/register`，成功後自動執行登入流程取得 token
  - `logout()` — 呼叫 `POST /api/v1/auth/logout`，並清除 localStorage 中的 token
  - `getProfile()` — 呼叫 `GET /api/v1/player/profile`
  - `updateProfile()` — 呼叫 `PUT /api/v1/player/profile`，自動將前端的 `avatarUrl` 欄位對應後端的 `avatar`
  - `mapProfile()` — 統一轉換後端回傳的 `playerId`/`avatar` 為前端慣用的 `id`/`avatarUrl`
  - `extractError()` — 從 axios 錯誤物件中取出 `error.response.data.message`，使錯誤訊息顯示後端的說明而非泛用訊息

### Modified

- `frontend/src/store/slices/authSlice.js`
  - 移除對 `mockApi` 與 `readStoredSession` 的依賴，改用 `memberApi`
  - `initialState` 不再從 localStorage 還原 player 物件（需重新 fetch），token 仍從 localStorage 還原
  - `loginMember`、`registerMember`、`fetchProfile`、`updateProfile`、`logoutMember` 的 thunk 均換用真實 API
  - `applySession` 同步將 token 寫入 localStorage
  - 所有 `rejectWithValue` 改用 `extractError()` 取得後端錯誤訊息

- `frontend/src/App.jsx`
  - 新增 `useEffect`：頁面重整後若 localStorage 有 token 但 Redux store 中 player 為 null，自動 dispatch `fetchProfile` 補回玩家資料

---

## [fix] — 2026-05-28 — 後端 Schema 與 Security 修復

### Fixed

- `database/mysql/init.sql`
  - `members` 表新增 `is_new_gift_claimed TINYINT(1) NOT NULL DEFAULT 0` 欄位（與 `Member` entity 同步）
  - `members` 表的 `role` 與 `status` 欄位型別從 `ENUM` 改為 `VARCHAR(20)`（對應 entity 的 `String` 型別，避免 Hibernate schema validation 失敗）
  - 新增 `outbox_events` 資料表（Transactional Outbox Pattern，對應 `OutboxEvent` entity）

- `backend/member-service/src/main/java/com/luckystar/member/config/SecurityConfig.java`
  - 修正 `addFilterBefore(internalSecretFilter, JwtAuthenticationFilter.class)` 導致的啟動錯誤
  - 原因：Spring Security 的 `addFilterBefore` 第二個參數須為 Spring Security 內建 filter，自訂 filter class 未在 order registry 登記
  - 改為兩個 filter 皆以 `UsernamePasswordAuthenticationFilter.class` 為錨點

### Modified

- `.env`
  - 補上開發環境必填變數：`JWT_SECRET`、`INTERNAL_SECRET`、`CORS_ALLOWED_ORIGINS`
  - 補上服務間呼叫 URL：`MEMBER_SERVICE_URL`、`WALLET_SERVICE_URL` 等
  - 補上 `ZOOKEEPER_PORT`、`KAFKA_BOOTSTRAP_SERVERS`

---

## [chore] — 2026-05-27 — 基礎設施測試與 GitHub Actions CI

### Added

- `package.json`
  - 新增專案根目錄的 npm 設定，定義以下測試指令：
    - `npm test` — 執行所有基礎設施測試
    - `npm run test:docker` — 只跑 docker-compose 相關測試
    - `npm run test:database` — 只跑資料庫 SQL 相關測試
    - `npm run test:kafka` — 只跑 Kafka 相關測試
    - `npm run test:env` — 只跑環境變數相關測試

- `.github/workflows/ci.yml`
  - 新增 GitHub Actions CI workflow
  - 觸發條件：push 或 PR 到 `main` / `develop` 分支
  - 執行環境：ubuntu-latest、Node.js 22
  - 自動執行 `tests/infra/` 下的所有測試

- `tests/infra/docker-compose.test.js`
  - 驗證 `docker-compose.yml` 設定完整性
  - 測試項目：7 個服務存在（mysql、postgres、redis、zookeeper、kafka、kafka-init、kafka-ui）
  - 測試項目：healthcheck 設定（mysqladmin ping、pg_isready、redis-cli）
  - 測試項目：網路（lucky-network）與 volume（lucky_mysql80_data、lucky_postgres_data）
  - 測試項目：port 使用環境變數而非寫死數字

- `tests/infra/database.test.js`
  - 驗證 MySQL 與 PostgreSQL 初始化 SQL 檔案
  - MySQL 測試項目：資料庫建立（utf8mb4）、members、friendships、daily_checkins、task_definitions、player_tasks、gift_logs、wallet_transactions（讀庫）
  - PostgreSQL 測試項目：wallets（含樂觀鎖 version 欄位）、wallet_transactions（idempotency_key 冪等設計）、game_rounds（Provably Fair 欄位）、rank_history、rank_daily_snapshots、game_rtp_stats、admin_alerts

- `tests/infra/kafka.test.js`
  - 驗證 `kafka/kafka-init.sh` 設定
  - 測試項目：6 個一般 topics（member.registered、wallet.debit、wallet.credit、game.result、rank.update、notification.push）
  - 測試項目：2 個 DLT topics（wallet.debit.DLT、wallet.credit.DLT）
  - 測試項目：腳本安全性（set -euo pipefail、#!/bin/bash）
  - 測試項目：連線設定（--if-not-exists、--replication-factor、--partitions）

- `tests/infra/env.test.js`
  - 驗證 `.env.example` 環境變數完整性
  - 測試項目：MySQL、PostgreSQL、Redis、Kafka、所有後端服務 port 都存在且為數字
  - 測試項目：所有 port 不互相衝突

### Test Summary

```
ℹ tests 102
ℹ pass  102
ℹ fail  0
```

---

## [chore] — 2026-05-26 — S0-W1 可驗收版本基礎建設統整

### Modified

- `docker-compose.yml`
  - MySQL image 升級至 8.0，volume 更名為 `lucky_mysql80_data`
  - Zookeeper 新增 healthcheck、port 改用環境變數 `${ZOOKEEPER_PORT}`
  - Kafka 新增 `KAFKA_TRANSACTION_STATE_LOG_*` 設定，新增 volume 持久化

- `database/mysql/init.sql`
  - 移除暫用的 `system_health_check` 表
  - 新增完整業務 schema：members、friendships、daily_checkins、task_definitions、player_tasks、gift_logs、wallet_transactions（CQRS 讀端）

- `database/postgres/init.sql`
  - 移除暫用的 `system_health_check` 表
  - 新增完整業務 schema：wallets、wallet_transactions、game_rounds、rank_history、rank_daily_snapshots、game_rtp_stats、admin_alerts（CQRS 寫端）

- `.env.example`
  - 新增 `MYSQL_HOST`、`POSTGRES_HOST`、`REDIS_HOST`、`ZOOKEEPER_PORT`、`KAFKA_BOOTSTRAP_SERVERS`
  - 新增後端 Secrets 設定：`JWT_SECRET`、`JWT_ACCESS_TOKEN_EXPIRY_MS`、`JWT_REFRESH_TOKEN_EXPIRY_MS`、`INTERNAL_SERVICE_SECRET`
  - 新增服務間呼叫 URL：`MEMBER_SERVICE_URL` 等

---

## [feat] — 2026-05-26 — Kafka Dead Letter Topics

### Added

- `kafka/kafka-init.sh`
  - 新增 Dead Letter Topics（DLT）群組，使用獨立迴圈與較少 partition（1 個）
  - `wallet.debit.DLT` — 扣款事件處理失敗後的備援 topic
  - `wallet.credit.DLT` — 加款事件處理失敗後的備援 topic
