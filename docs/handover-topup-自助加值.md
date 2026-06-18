# 交接紀錄 — 玩家自助加值（模擬支付儲值訂單）

> 建立日期：2026-06-17
> 狀態：**設計已對齊、尚未動工**。功能程式碼一行都還沒寫。
> ⚠️ 建議在「乾淨的新 session」接手實作，原因見最後一節。

---

## 0. 一句話

要做一個「玩家在前端自助加值」的功能：選方案 → 建立儲值訂單 → 點「付款」（**模擬支付，無真實金流**）→ 真實入帳星幣 → 看得到訂單記錄。後端放 **wallet-service**，前端後端都要做。

---

## 1. 目前本機環境狀態（這次 session 跑起來的）

全部服務 + infra + 前端都在運行中（背景進程，綁在當時的 session，可能已隨 session 結束而停，接手時請重新確認）。

| 類別 | 服務 / Port | 啟動方式 |
|---|---|---|
| Infra | MySQL 3307 / PostgreSQL 5433 / Redis 6379 / Kafka 9092 / Kafka UI 8085 | `docker compose up -d` |
| 後端 | gateway 8080 / member 8081 / wallet 8082 / game 8083 / rank 8084 / admin 8086 / notification 8087 | 各服務 `mvn -q -pl backend/xxx-service spring-boot:run`（背景），**啟動前先載入 `.env` 到環境變數**（`.Trim()` 去 CRLF） |
| 前端 | Vite 5173（綁 `localhost`/IPv6，用 `http://localhost:5173` 測，不是 127.0.0.1） | `cd frontend && npm run dev` |

- 各服務背景 log 在專案根目錄 `.run-*.log`（member/wallet/game/gateway/rank/admin/notification/frontend）。
- 雷：一開始有個**舊 gateway 殼**占住 8080（下游沒起時回 503）；新 gateway 啟動會撞「Port 8080 already in use」。解法是先殺占 8080 的 java 進程再起。
- 雷：`docker ps` 可能看到 orphan 容器 `lucky-star-zookeeper`（舊 compose 殘留），不影響，可忽略。

---

## 2. 這次 session 已完成 / 已驗證的事（可靠）

1. ✅ 七個後端服務 + infra + 前端全部成功啟動，主線冒煙測試通過（透過 gateway 註冊回 201）。
2. ✅ **已刪除所有測試玩家帳號**，DB 現在乾淨：
   - MySQL `members` = 0 筆
   - PostgreSQL `wallets` / `diamond_wallets` / `wallet_transactions` 全清空
   - **保留** `admin_users` 的 `superadmin`（SUPER_ADMIN）
   - 刪除是手動 SQL：PostgreSQL 各玩家表 `DELETE`、MySQL `DELETE FROM members`。
3. ✅ 已實測過的加值 / 鑽石管道（接手可直接用來測）：
   - **星幣 GM 入帳**：`POST http://localhost:8082/internal/wallet/credit`，header `X-Internal-Secret: <INTERNAL_SECRET>`，body `{playerId, amount, subType:"GM_REWARD", idempotencyKey}`。受 `InternalSecretFilter` 保護（只擋 `/internal/**`）。
   - **生成鑽石點數卡**：admin 登入（`superadmin` / 預設密碼 `ChangeMe!SuperAdmin123`，可被 `ADMIN_SEED_PASSWORD` 覆寫，本機 `.env` 未覆寫）→ `POST http://localhost:8086/admin/diamond/cards`，body `{count, faceValue}`，需 `Authorization: Bearer <adminToken>`。
   - **兌換點數卡加鑽石**：`POST http://localhost:8082/api/v1/wallet/diamond/redeem`，header `X-User-Id: <playerId>`，body `{cardCode}`。前端「兌換鑽石」就是走這支。
   - **鑽石換星幣**：`POST /api/v1/wallet/diamond/exchange`，固定 1 鑽 = 20 星幣。

---

## 3. 儲值功能設計結論（已對齊的真實事實）

接手實作前，以下是已從**真實程式碼**確認、可直接採用的事實：

### 後端（wallet-service，雙資料源 ADR-001）
- 訂單放 wallet-service。付款成功後**直接呼叫 `WalletService.credit(CreditRequest)`** 真實入帳（冪等 + 樂觀鎖已內建，見 `service/WalletService.java` 的 `credit()`）。
- **entity 套件**：`com.luckystar.wallet.postgres.entity`（`DataSourceConfig` 的 `postgresEntityManagerFactory` 只掃這個 package）。
- **repository 套件**：`com.luckystar.wallet.postgres.repository`（`@EnableJpaRepositories` basePackages）。
- **交易管理器**：`@Transactional(transactionManager = "postgresTransactionManager")`。
- **`JPA_DDL_AUTO` 預設 `validate`**：→ **新表 `topup_orders` 必須先用 SQL 在運行中的 PostgreSQL 建好，且 entity 欄位/型別要完全對齊**，否則 wallet-service 啟動就 validate 失敗、連現有功能一起掛。
- **subType 用 `TOPUP`**：運行中的 DB 目前 `wallet_transactions` **沒有 sub_type CHECK 約束**（查 `pg_constraint` 回 0 rows），所以 `TOPUP` 入帳不會被 DB 擋，現狀可直接跑。但為版控一致仍要：
  - 更新 `database/postgres/init.sql` 的 CHECK 清單加入 `TOPUP`
  - 新增 `database/postgres/migration/V7__add_topup_subtype.sql`（範本：`V4__add_diamond_exchange_subtype.sql`）
  - `dto/CreditRequest.java` 的 `@Pattern` 允許清單加 `TOPUP`（注意：從 service 內部 new CreditRequest 直接呼叫 `credit()` 不會觸發 @Pattern，但經 API 傳入會，故仍要補）
- **Controller 慣例**：`@RequestMapping("/api/v1/wallet")`、`@RequestHeader("X-User-Id") Long playerId`、回 `ApiResponse.ok(...)`。
- `WalletTransaction` 欄位參考：`id`(IDENTITY)、`player_id`、`type`、`sub_type`、`amount`、`balance_before`、`balance_after`、`idempotency_key`(UNIQUE)、`reference_id`。

### 前端（已有現成結構可照抄）
- axios 實例 `src/services/api.js`：`apiClient`，自動帶 `Authorization` token、401 自動 refresh，baseURL 來自 `VITE_API_BASE_URL`（gateway）。
- `src/services/walletApi.js`：用 `apiClient` + `toData = res => res?.data?.data ?? res?.data` 解包。儲值 API 加在這裡。
- `src/store/slices/walletSlice.js`：RTK slice，有 `fetchBalance` / `setBalance`。入帳成功後 dispatch `fetchBalance` 刷新餘額。
- **`src/pages/CasinoShop.jsx`** 是現成的「商城」頁，儲值入口最適合放這（或新增 `pages/Topup.jsx` 並在 `App.jsx` 加路由）。
- 其他可參考：`diamondApi.js` / `diamondSlice.js` / `pages/Diamond.jsx`（鑽石流程跟儲值很像，是最佳抄寫範本）。

---

## 4. 待辦清單（接手要做的事）

### 後端
- [ ] `database/postgres/init.sql`：`wallet_transactions` 的 sub_type CHECK 加 `TOPUP`；新增 `topup_orders` 建表 DDL
- [ ] `database/postgres/migration/V7__add_topup_subtype.sql`（+ topup_orders 表，或拆兩支 migration）
- [ ] **手動對運行中的 PostgreSQL 套用** topup_orders 建表 + CHECK 變更（因為沒有 Flyway 自動跑，ddl=validate 需表先存在）
- [ ] entity `postgres/entity/TopupOrder.java`：欄位含 id、playerId、packageId/方案代號、amount(星幣)、priceLabel(顯示用，如 "NT$100")、status(CREATED/PAID/CREDITED/FAILED)、orderNo(唯一)、createdAt、paidAt、creditTxId(入帳流水 id)
- [ ] repository `postgres/repository/TopupOrderRepository.java`
- [ ] DTO：方案列表 resp、建單 req/resp、付款 resp、訂單列表 resp
- [ ] service `TopupService.java`：
  - 方案清單（先寫死幾檔，如 100→100k、500→600k、1000→1.3M 星幣）
  - 建單 → status=CREATED
  - 付款（模擬）：status CREATED→PAID → 呼叫 `walletService.credit(playerId, amount, subType="TOPUP", idempotencyKey="topup-"+orderNo)` → status=CREDITED，記 creditTxId。**用 orderNo 當冪等鍵防重複入帳**
  - 訂單列表查詢
- [ ] controller `TopupController.java`（`/api/v1/wallet/topup/...`）：
  - `GET /packages` 方案
  - `POST /orders` 建單
  - `POST /orders/{id}/pay` 模擬付款
  - `GET /orders` 訂單記錄
- [ ] 確認 gateway 已轉發 `/api/v1/wallet/**`（balance 已通，理論上 topup 同前綴自動涵蓋，仍要驗證）
- [ ] 測試：比照 member/wallet 用 H2（test scope），`@SpringBootTest` contextLoads 不連外部 DB

### 前端
- [ ] `src/services/walletApi.js` 加 `getPackages` / `createTopupOrder` / `payTopupOrder` / `getTopupOrders`
- [ ] 儲值頁（`CasinoShop.jsx` 內加區塊，或新 `pages/Topup.jsx` + `App.jsx` 路由）：列方案 → 建單 → 「確認付款」→ 成功後 dispatch `fetchBalance` 刷新 + 顯示訂單
- [ ] （選）訂單記錄列表

### 收尾（專案規定）
- [ ] 根目錄 `./CHANGELOG.md` 最上方加一筆（type/日期/一句話 + Added/Changed + 為什麼 + 如何驗證），見 AGENTS.md §3
- [ ] 走 feature 分支 → PR → develop，**不直接 commit develop/main**（CONTRIBUTING.md）
- [ ] 提交前驗證：`mvn -pl backend/gateway-service,backend/member-service,backend/wallet-service test` + `node --test tests/infra/*.test.js`

---

## 5. ⚠️ 為什麼建議開新 session 接手

這次 session 進行到後段，多次工具讀檔出現「截斷 + 內容異常」（行號跳號、出現 `placeholder shown truncated`、controller 方法被簡化成回傳 null 等與真實檔案不符的回傳）。代表後段拿到的程式碼內容**不完全可信**。本交接紀錄第 3 節的事實是在出現異常**之前**、或用 Grep 精準抓行確認過的，可靠；但若接手時對任一事實有疑慮，**請以實際 `Read` 真實檔案為準**，尤其是：
- `DataSourceConfig.java` 的 `postgresEntityManagerFactory`（packagesToScan、ddl-auto 注入）
- `WalletController.java` 完整內容（`/gift`、`/bankruptcy-aid` 等實際 mapping）
- `walletSlice.js` 的 `export default`（reducer）

在乾淨 context 下實作，能避免把多檔功能建立在失真假設上、導致編譯失敗或 `ddl validate` 啟動失敗。

---

## 6. 接手第一步建議

1. 確認服務是否還在跑（`docker compose ps` + 測各 port）；沒跑就照第 1 節重啟。
2. 真實 `Read` 一遍第 3 節列的關鍵檔，核對事實。
3. 先做後端（建表 → entity → repo → dto → service → controller），用 curl 驗證三支 API（建單 / 付款 / 查單）餘額真的增加，再串前端。
