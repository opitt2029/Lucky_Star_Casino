# Changelog — Lucky Star Casino

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [feat] — 2026-06-01 — 查詢鑽石餘額 API（T-104）

### Added
- `DiamondBalanceResponse` DTO：`{ balance, exchangeRate: 20 }`
- `DiamondWalletService.getBalance()`：唯讀查詢 `diamond_wallets`，錢包不存在拋 `DiamondWalletNotFoundException`
- `DiamondController.balance()`：`GET /api/v1/wallet/diamond/balance`，以 `X-User-Id` header 定位玩家
- `DiamondControllerBalanceTest`：5 個 controller 層測試（成功、零餘額、缺 header、非數字 header、404）
- `DiamondWalletServiceTest` 新增 2 個 getBalance 測試

### Changed
- `DiamondController` 建構子注入 `DiamondWalletService`
- `DiamondControllerTest` / `DiamondControllerExchangeTest` 補 `@Mock DiamondWalletService` 以配合新建構子

### Verified
- `mvn -pl backend/wallet-service test` → 142 tests, 0 failures

---

## [feat] — 2026-06-01 — 鑽石兌換星幣 API（T-103）

### Added
- `DiamondExchangeRequest` / `DiamondExchangeResponse` DTO（`diamondAmount`、`idempotencyKey`）
- `InsufficientDiamondException` → HTTP 422，整合至 `GlobalExceptionHandler`
- `DiamondWalletService.debitDiamond()`：驗證餘額、樂觀鎖扣款、不足則拋 `InsufficientDiamondException`
- `DiamondExchangeService.exchange()`：單一 PostgreSQL 交易內完成鑽石扣款 + 星幣入帳（1:20），含冪等預檢
- `DiamondController.exchange()`：`POST /api/v1/wallet/diamond/exchange`，以 `X-User-Id` header 定位玩家

### Changed
- `CreditRequest.subType` 允許值新增 `DIAMOND_EXCHANGE`
- `DiamondController` 建構子注入 `DiamondExchangeService`

### Added（Schema）
- `database/postgres/migration/V4__add_diamond_exchange_subtype.sql`：擴充 `wallet_transactions.sub_type` CHECK 約束

**為什麼**：鑽石為玩家以點數卡兌換的硬通貨，本任務提供將鑽石換回星幣的流程。兩步驟（扣鑽石、入星幣）共用同一 PostgreSQL 交易，天然原子，無需跨資料源補償邏輯（對比 T-102）。

**如何驗證**：`mvn -pl backend/wallet-service test`，135 tests passed。

---

## [feat] — 2026-06-01 — 點數卡序號兌換鑽石 API（T-102）

### Added
- `backend/wallet-service/.../mysql/entity/DiamondCard.java`（新增）：`diamond_cards`（MySQL 讀端）對應 entity（`cardCode` UNIQUE、`faceValue`、`isRedeemed`、`redeemedBy`、`redeemedAt`）。由 `mysqlEntityManagerFactory` 掃描。
- `mysql/repository/DiamondCardRepository.java`（新增）：`findByCardCode`；防重複兌換核心 `markRedeemed`（條件式 `@Modifying` UPDATE，CAS：`WHERE card_code=? AND is_redeemed=false`，回傳 1=成功 / 0=不存在或已兌換）；補償用 `revertRedemption`。
- `service/DiamondCardService.java`（新增，`@Transactional(mysqlTransactionManager)`）：`redeemCard`（SELECT 區分 404/422 後 CAS 標記、回面額）、`revertRedemption`（best-effort 補償，吞例外不外拋）。獨立成 bean 讓交易 proxy 生效。
- `service/DiamondRedeemService.java`（新增）：跨資料源協調器。先 MySQL CAS 標記序號（防重複兌換關卡）、再 PostgreSQL 入帳鑽石；入帳失敗則補償回滾序號標記後原樣拋例外。**不引入 XA**（比照 `GiftService`）。
- `controller/DiamondController.java`（新增）：`POST /api/v1/wallet/diamond/redeem`，playerId 取自 gateway 注入的 `X-User-Id`、序號走 body。與星幣 `WalletController` 分開讓鑽石邏輯獨立演進。
- `dto/DiamondRedeemRequest.java`、`dto/DiamondRedeemResponse.java`（新增）：請求只帶 `cardCode`（`@NotBlank`/`@Size(max=50)`）；回應含 `redeemedDiamonds`（面額）與 `diamondBalance`（兌換後餘額）。
- `exception/CardNotFoundException`(404)、`CardAlreadyRedeemedException`(422)、`DiamondWalletNotFoundException`(404)（新增），並在 `GlobalExceptionHandler` 加對應對映。
- 測試（新增）：`DiamondCardServiceTest`(5)、`DiamondRedeemServiceTest`(3)、`DiamondControllerTest`(7)；`DiamondWalletServiceTest` 補 `creditDiamond` 2 案。

### Changed
- `service/DiamondWalletService.java`：新增 `creditDiamond(playerId, amount)`（`@Transactional(postgresTransactionManager)`），鑽石入帳、`@Version` 樂觀鎖防並發超帳，錢包不存在丟 `DiamondWalletNotFoundException`。

### Why
- 鑽石餘額在 PostgreSQL 寫端、序號在 MySQL 讀端（ADR-001），兌換天生跨資料源。沿用 `GiftService` 的取捨刻意不引入 XA，改以「先 CAS 標記序號（不可重複的關卡）→ 再入帳 → 失敗補償回滾」串接兩個獨立交易，永遠偏向「不重複入帳」的安全側。
- 防重複兌換的真正關卡是 `is_redeemed` 上的條件式 UPDATE（CAS）而非 `card_code` UNIQUE（後者只防序號重複建立）：並發雙擊時 DB 列鎖 + 條件保證僅一方回傳列數為 1。
- `CardAlreadyRedeemedException` 用 422 而非 409：「已兌換」是不可重試的業務狀態，與 409「並發衝突請重試」（樂觀鎖）語意不同。

### How（驗證）
- `mvn -pl backend/wallet-service test` → BUILD SUCCESS，Tests run: 105, Failures: 0, Errors: 0（H2，含 `contextLoads` 驗證新 entity/repository/CAS query 正確 wire-up）。

## [feat] — 2026-06-01 — 鑽石錢包初始化（開戶）（T-101）

### Added
- `backend/wallet-service/.../postgres/entity/DiamondWallet.java`（新增）：`diamond_wallets` 對應 entity。結構比照 `Wallet`（`@Id playerId`、`balance` 預設 0、`@Version version`、`@PrePersist`/`@PreUpdate` 時間戳），但**不設 `frozenAmount`**（鑽石無凍結/下注概念）。放在 `postgres.entity` 套件，確保由 `postgresEntityManagerFactory` 掃描（ADR-001 雙資料源）。
- `postgres/repository/DiamondWalletRepository.java`（新增）：`extends JpaRepository<DiamondWallet, Long>`。
- `service/DiamondWalletService.java`（新增）：`createDiamondWallet(Long playerId)`，與 `WalletService.createWallet`（T-020）平行。冪等兩層保證：`existsById` 預檢 + 並發時 PostgreSQL 主鍵唯一約束擋下後到者（`DataIntegrityViolationException` 吞掉成 no-op）。走 `@Transactional(postgresTransactionManager)`。
- 測試（新增）：`service/DiamondWalletServiceTest.java`（3 案：新玩家建戶 balance/version=0、既有玩家略過不存、並發 UNIQUE 衝突靜默處理）。

### Changed
- `kafka/MemberEventListener.java`：在既有星幣開戶後、`ack` 前**加掛**鑽石開戶 `diamondWalletService.createDiamondWallet(playerId)`。**未**另開 `@KafkaListener`（避免同 consumer group 雙 listener 分裂 partition，破壞「兩錢包一起建立」保證）。兩開戶皆冪等，任一失敗皆不 ack、由 error handler 重試/送 DLT。
- 測試：`kafka/MemberEventListenerTest.java` 注入 `DiamondWalletService` mock；既有 3 案更新為驗證雙開戶 + 新增 1 案（鑽石開戶失敗同樣不 ack）。

### Why
- 完成 T-101（工作分配表規格）：消費 `member.registered` 為新玩家建立 `diamond_wallets`（balance=0、version=0）、確保冪等，與 T-020 星幣開戶邏輯平行。
- 依賴 T-100 的 `diamond_wallets` schema（本次同日落地）。沿用既有冪等（DB UNIQUE 防重）模式（AGENTS.md §2.8）。

### 如何驗證
- `mvn -pl backend/wallet-service test` → **BUILD SUCCESS，Tests run: 78, Failures: 0, Errors: 0**（H2，surefire `jpa.ddl-auto=create` 自動建 `diamond_wallets` 表；`WalletServiceApplicationTests` contextLoads 確認新 entity/bean 正常裝配）。

---

## [feat] — 2026-06-01 — 鑽石系統資料表 schema（T-100）

### Added
- `database/postgres/init.sql`：新增 `diamond_wallets` 表（鑽石錢包寫端，PostgreSQL）。欄位 `player_id`(PK)、`balance`(預設 0)、`version`(樂觀鎖)、`created_at`/`updated_at`，`CHECK (balance >= 0)`。與 `wallets`（星幣）平行、同庫；刻意**不**設 `frozen_amount`（鑽石無凍結/下注概念）。
- `database/mysql/init.sql`：新增 `diamond_cards` 表（點數卡序號，MySQL 讀庫）。欄位 `id`(PK)、`card_code`(`UNIQUE`，格式 `XXXX-XXXX-XXXX-XXXX`)、`face_value`(`CHECK > 0`)、`is_redeemed`(預設 0)、`redeemed_by`、`redeemed_at`、`created_at`；另建 `is_redeemed`、`redeemed_by` 索引供後台列表查詢（T-106）。
- `database/postgres/migration/V2__add_diamond_wallets.sql`、`database/mysql/migration/V5__add_diamond_cards.sql`（新增）：與上述 init.sql 同步的 Flyway 遷移檔，維持 `schema.sql` 清單所指的遷移歷史一致（目前 Flyway 未接入 runtime，遷移檔為平行文件）。

### Why
- 完成 T-100（工作分配表規格）：`diamond_cards` 存 MySQL、`diamond_wallets` 存 PostgreSQL 與 `wallets` 同庫，作為鑽石點數卡系統（T-101~T-107）的資料地基。
- `card_code UNIQUE` + `is_redeemed` 旗標：在 DB 層為 T-102「序號兌換」提供防重複兌換的唯一約束；`diamond_wallets.version` 為 T-103「鑽石換星幣」提供樂觀鎖防超扣（沿用 AGENTS.md §2.8 帳務模式）。
- 下游依賴：T-101 將在 wallet-service 的 `com.luckystar.wallet.postgres.entity` 下新增 `DiamondWallet` entity 對應本表（測試以 H2 `jpa.ddl-auto=create` 自動建表）。

### 如何驗證
- 純 DDL 變更、無 Java 程式碼動到，既有測試不受影響。本機可比照 DEPLOY.md 以 `docker compose` 重建 `mysql`/`postgres`（init.sql 走 docker-entrypoint-initdb.d），確認兩表建立成功。
- T-101 落地後將由 `mvn -pl backend/wallet-service test`（H2）覆蓋 `diamond_wallets` 對應 entity。

---

## [feat] — 2026-06-01 — Kafka 消費失敗 Dead Letter Queue 處理（T-028）

### Added
- `database/postgres/migration/V3__create_dead_letter_messages.sql`（新增，原 V2 已被 T-100 佔用故改 V3）：`dead_letter_messages` 表（寫於 PostgreSQL 寫庫），欄位含 `dlt_topic`/`original_topic`/`message_key`/`payload`/`exception_class`/`failure_reason`/`stack_trace`/`status`/`retry_count`/`created_at`/`last_retried_at`，`chk_dlm_status` 限 FAILED/RETRIED/RESOLVED，並建 status/dlt_topic/created_at 索引。
- `database/postgres/init.sql`（新增 dead_letter_messages 定義）：補齊一鍵建表所需的 schema 定義，與 V3 migration 保持一致。
- `postgres/entity/DeadLetterMessage.java` + `postgres/repository/DeadLetterMessageRepository.java`（新增）：DLT 失敗訊息實體與查詢（`findByStatus`/`findByDltTopic`/`findByStatusAndDltTopic` 分頁）。
- `kafka/DeadLetterListener.java`（新增）：消費 `wallet.credit.DLT`、`wallet.debit.DLT` 與 `wallet.credit.request.DLT`（入帳指令失敗），自 DLT header（`DLT_ORIGINAL_TOPIC`/`DLT_EXCEPTION_FQCN`/`DLT_EXCEPTION_MESSAGE`/`DLT_EXCEPTION_STACKTRACE`）取出原始 topic 與失敗原因落庫。**try/finally 保證永遠 ack、永不重拋**（避免 `.DLT.DLT` 連鎖或卡 partition），使用獨立 groupId `wallet-service-dlt-group`。
- `config/KafkaConsumerConfig.java`（修改，append）：新增 `dltListenerContainerFactory` @Bean，**刻意不掛 `kafkaErrorHandler`**（DLT 是最後一站，不可再路由）。方法名唯一以符 Spring Boot 3.2+ `enforceUniqueMethods`。
- `service/DeadLetterService.java`（新增）：`record`（落庫，內部吞例外不外拋、堆疊截斷 4000 字）、`query`（依 status/dltTopic 過濾分頁）、`retry`（把原 payload 重發回 `original_topic`，標記 RETRIED、累加 retry_count；下游 listener 冪等故重送安全）。
- `controller/AdminDeadLetterController.java`（新增）：`GET /internal/wallet/dlt`（狀態/topic 過濾分頁查詢）、`POST /internal/wallet/dlt/{id}/retry`（手動重試）。掛在 `/internal/wallet/**` 沿用既有 `InternalSecretFilter`。
- `dto/DeadLetterMessageResponse.java`、`dto/DeadLetterRetryResponse.java`（新增）。
- `exception/DeadLetterNotFoundException.java`（→404）、`exception/IllegalDltStateException.java`（→409，已 RESOLVED 不可重試），並在 `GlobalExceptionHandler` 註冊。
- 測試（新增）：`service/DeadLetterServiceTest.java`（9 案）、`kafka/DeadLetterListenerTest.java`（4 案，含 credit.request.DLT）。

### Why
- 完成 T-028（工作分配表規格：設定 `wallet.credit.DLT`/`wallet.debit.DLT`、消費失敗超過 3 次轉入 DLT、Admin 可查詢並手動重試、記錄失敗原因至 DB）。額外納入既有的 `wallet.credit.request.DLT`（入帳指令失敗）一併監控，避免指令類失敗無人看管。
- DLT「重試 3 次後路由」基建在前置任務的 `KafkaConsumerConfig`（`DefaultErrorHandler` + `DeadLetterPublishingRecoverer`）已存在，且 DLT topic 已於 `kafka/kafka-init.sh` 建立；本任務只補「DLT consumer 落庫 + Admin 查詢/重試 API」，**未增刪 Kafka topic，故 `tests/infra/kafka.test.js` 無需更動**（AGENTS.md §2.7）。
- 手動重試靠下游冪等保安全：`WalletReadSyncListener` 以 `existsById` 去重、`WalletService.credit/debit` 以 `idempotency_key` UNIQUE 去重（AGENTS.md §2.8），重發原 payload 不會重複入帳。

### 如何驗證
- `mvn -pl backend/wallet-service test`：**97 passed / 0 failed**（含 13 個新案；`contextLoads` 確認 H2 建表與三個 DLT consumer 掛載成功）。

---

## [feat] — 2026-06-01 — 破產補助機制 API（T-027）

### Added
- `backend/wallet-service/.../controller/WalletController.java`：新增 `POST /api/v1/wallet/bankruptcy-aid`。領取者取自 gateway 注入的 `X-User-Id` header（只能領自己的），**無 request body**。
- `dto/BankruptcyAidResponse.java`（新增）：回應 DTO（`playerId`/`amount`/`transactionId`/`balanceBefore`/`balanceAfter`）。
- `service/BankruptcyAidService.java`（新增，協調器）：
  - **資格檢查**：以 `WalletService.getBalance` 取餘額，**總餘額**（非可用餘額）須 **< 100** 星幣才符資格，否則拋 `BankruptcyAidNotEligibleException` → 422；錢包不存在 → 404（沿用 `WalletNotFoundException`）。**用總餘額是刻意決策**：防止玩家把錢凍結在未結算下注上壓低可用餘額來套利，且「總身家枯竭」才是真破產（與規格字面一致）。
  - **Redis 當日鎖（原子 SETNX+TTL）**：`SET wallet:bankruptcy-aid:{playerId}:{date} 1 NX PX(到午夜)` 單一指令搶當日領取權並一併設 TTL（到當地 Asia/Taipei 下一個午夜），搶不到代表今天已領過 → 422。SETNX 與 TTL 一次完成，避免兩步之間程序被硬殺導致鎖殘留卻無 TTL（玩家當天再也領不了）。
  - **入帳**：委派 `WalletService.credit` 加 **1,000** 星幣，subType=`BANKRUPTCY_AID`，冪等鍵 `bankruptcy-aid:{playerId}:{date}`（DB UNIQUE 為第二道防線：Redis 即使被清空，同日仍不會重複入帳）。入帳失敗會 `DELETE` Redis 鎖讓玩家可重試。
  - **冪等命中保護**：若 `credit` 回 `idempotent=true`（Redis 曾被清空、DB 已有當日紀錄），視為今天已領過 → 422，不重複加錢、保留鎖。
- `exception/BankruptcyAidNotEligibleException.java`（→422，新增），並在 `GlobalExceptionHandler` 註冊。
- 測試（新增）：`service/BankruptcyAidServiceTest.java`（6 案：符資格發放+設 TTL、餘額達門檻不符、當日已領 SETNX 失敗、入帳失敗釋放鎖、冪等命中視為已領且保留鎖、錢包不存在傳遞）；`controller/WalletControllerTest.java` 新增 4 案（發放 200、缺 header 400、不符資格 422、錢包不存在 404）。

### Why
- 完成 T-027（工作分配表規格：`POST /api/v1/wallet/bankruptcy-aid`、餘額 < 100 且當日未領過、發放 1,000 星幣、用 Redis 記當日已領狀態、TTL 到午夜）。
- 沿用既有帳務模式：複用 `WalletService.credit`（冪等鍵 DB UNIQUE 防重、`@Version` 樂觀鎖防超扣，AGENTS.md §2.8）；schema 既有的 `chk_wt_sub_type` 已包含 `BANKRUPTCY_AID`，無需改 DB。
- Redis SETNX 提供「每日一次」的快路徑保護，`credit` 的 idempotencyKey 為 Redis 失效時的第二道防線（即使 Redis 被清空也不會重複發放）。

### 如何驗證
- `mvn -pl backend/wallet-service test`：**84 passed / 0 failed**（含 6 個新 service 案、4 個新 controller 案，`contextLoads` 仍綠）。

### 已知限制
- Redis 鎖在「JVM 於 SETNX 成功後、入帳 commit 前被硬殺」時可能殘留（玩家當日無法重領）；但鎖建立時已原子帶上午夜 TTL（必定會自動歸零），且 `credit` 冪等鍵保證不會重複發放。

---

## [feat] — 2026-06-01 — 好友星幣贈送 API（T-026）

### Added
- `backend/wallet-service/.../controller/WalletController.java`：新增 `POST /api/v1/wallet/gift`。贈送方取自 gateway 注入的 `X-User-Id` header（**不**由 body 指定，避免冒名贈送他人的錢）；body 帶 `receiverId`/`amount`/`idempotencyKey`。
- `dto/GiftRequest.java`、`dto/GiftResponse.java`（新增）：請求/回應 DTO（`idempotencyKey` 上限 80 字，預留衍生後綴空間）。
- `service/GiftService.java`（新增，協調器）：
  - **基本驗證**：不可贈送給自己（`InvalidGiftException` → 400）。
  - **冪等預檢**：以贈送方分錄 key（`<key>:gift:debit`）查流水，已存在即直接回原結果、**完全不碰 Redis**（重送不會灌爆當日額度）。
  - **Redis 當日額度預扣**：贈出上限 **5,000**、收受上限 **10,000**（`wallet:gift:sent:{senderId}:{date}` / `wallet:gift:recv:{receiverId}:{date}`，`INCRBY` 後檢查，超限 `DECRBY` 回補並拋 `GiftLimitExceededException` → 422）；鍵 TTL 設到當地（Asia/Taipei）下一個午夜。
  - **best-effort 下游**：轉帳 commit 後寫 `gift_logs`、發 `wallet.debit`/`wallet.credit` 事件；失敗只記 WARN，不回滾金流。
- `service/GiftTransferService.java`（新增）：PostgreSQL **單一交易**內的雙向分錄（DEBIT/GIFT + CREDIT/GIFT），餘額守衛、樂觀鎖（`@Version`）、雙冪等鍵。獨立成 bean 以讓 `@Transactional(postgresTransactionManager)` proxy 生效。
- `service/GiftLogService.java`（新增）：`gift_logs` 稽核寫入，走 `@Transactional(mysqlTransactionManager)`。
- `mysql/entity/GiftLog.java`、`mysql/repository/GiftLogRepository.java`（新增）：對應既有 `gift_logs` 讀庫表。
- `exception/GiftLimitExceededException.java`（→422）、`exception/InvalidGiftException.java`（→400）（新增），並在 `GlobalExceptionHandler` 註冊。
- 測試（新增）：`service/GiftServiceTest.java`（10 案：成功、贈己、冪等重送、贈出/收受超限回補、餘額不足/錢包不存在回補、並發 UNIQUE 衝突回補+冪等、gift_logs 失敗不影響、Kafka 失敗不影響）、`service/GiftTransferServiceTest.java`（4 案：雙向異動與兩筆分錄、餘額不足、雙方錢包不存在）。

### Changed
- `kafka/WalletDebitEvent.java`：**新增 `subType` 欄位**（Kafka 契約變更）。先前 `wallet.debit` 事件無 subType、`WalletReadSyncListener.onDebit` 一律寫死 `BET`，會把贈送出帳誤標為下注。現由事件帶 `subType`（下注=`BET`、贈送出帳=`GIFT`）。
- `kafka/WalletReadSyncListener.java`：`onDebit` 改用 `event.subType()`，**null 回退為 `BET`**（相容仍在 topic 中的舊訊息）。
- `service/WalletService.java`：`debit()` 發布事件時帶上 `tx.getSubType()`。
- 測試：`kafka/WalletReadSyncListenerTest.java` 更新既有 debit 事件建構子（補 subType=`BET`），並新增兩案（GIFT 如實保留、null 回退 BET）。
- **Topic 清單未變**（仍是 `wallet.debit`/`wallet.credit`），故 `kafka/kafka-init.sh` 與 `tests/infra/kafka.test.js` 無需變更。

### Why
- 完成 T-026（工作分配表規格：`POST /api/v1/wallet/gift`、贈出 5,000／收受 10,000 當日上限、Redis TTL 到午夜、寫 `gift_logs`、觸發雙向帳務異動）。
- 沿用既有帳務模式：冪等鍵（DB UNIQUE）防重、樂觀鎖（`@Version`）防超扣（AGENTS.md §2.8）。
- `WalletDebitEvent` 加 `subType` 是為讀端流水正確標示贈送 vs 下注；改動向後相容（舊訊息回退 BET），且不新增 topic。

### 已知限制（刻意放棄跨資料源原子性，**不**引入 XA/JTA；見程式內 `TODO(T-026)`）
- PostgreSQL 雙分錄是唯一金流真相；commit 之後的 `gift_logs` 寫入與 Kafka 事件皆 best-effort。
  1. **`gift_logs` 可能少列**：轉帳已 commit 但 MySQL 寫入失敗時，餘額仍正確，僅稽核列遺失（贈送歷史查詢會少報、`gift_logs` 與 `sub_type='GIFT'` 對不齊）。屬「稽核缺口」非「餘額錯誤」，失敗記 WARN 可事後補。
  2. **Kafka 事件可能掉**：發布失敗則 rank-service 落後到下次帳務事件/重算（既有服務級限制，非 T-026 新增）。
  3. **Redis 預扣僅在硬性程序死亡時可能與轉帳分歧**：try/catch 在任何拋出例外時 `DECRBY` 回補；但 JVM 在 `INCRBY` 後、commit 前被 OOM/SIGKILL 無法回補 → 當日計數略為多計（fail-safe：只會讓額度更嚴格、不會讓玩家超額），當地午夜 TTL 到期自動歸零。
- **後續強化（本任務不做）**：優先走 **Outbox Pattern**（repo 已有 `database/mysql/migration/V3__create_outbox_events.sql`），把 `gift_logs` 意圖 + Kafka 事件與轉帳寫進同一筆 PostgreSQL 交易再非同步轉送，達成最終一致且保證投遞；或較簡單的對帳 job 從 PostgreSQL `sub_type='GIFT'` 回填 MySQL `gift_logs`。

### How（如何驗證）
- `mvn -pl backend/gateway-service,backend/member-service,backend/wallet-service test` → BUILD SUCCESS（wallet-service 74 案全綠，含 GiftServiceTest 10、GiftTransferServiceTest 4、WalletReadSyncListenerTest 9；`@SpringBootTest` contextLoads 通過，含新 bean 與 Redis 自動配置）。

---

## [changed] — 2026-05-31 — 調整百家樂側欄結算摘要

### Changed
- `frontend/src/pages/Baccarat.jsx`：移除 `/game/baccarat` 側邊欄的「目前玩家」區塊。
- `frontend/src/pages/Baccarat.jsx`：在「本局選項」下方新增「本局獲利」區塊；命中時顯示正獲利，未命中時顯示負的下注面額。

### Why
- 百家樂側欄應優先呈現本局下注與結算資訊，減少與登入狀態重複的玩家資料。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 權限失敗，升權重跑後成功）。

---

## [added] — 2026-05-31 — 遊戲頁側欄新增規則說明彈窗

### Added
- `frontend/src/components/GameRuleCard.jsx`：新增共用遊戲規則卡片，點擊後以紅金主題小視窗顯示規則與賠率，支援背景點擊與 Escape 關閉。
- `frontend/src/pages/SlotGame.jsx`：在 `/game/slot` 側邊欄最上方加入星幣老虎機規則說明。
- `frontend/src/pages/Baccarat.jsx`：在 `/game/baccarat` 側邊欄最上方加入百家樂規則說明。

### Why
- 遊戲頁需要在操作區旁提供可隨時查看的規則說明，避免玩家離開當前局面查詢下注、命中與賠率規則。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 權限失敗，升權重跑後成功）。
- `http://127.0.0.1:5175/game/slot`、`http://127.0.0.1:5175/game/baccarat` → dev server 回應 200；Browser 外掛在目前 Windows sandbox 初始化失敗，未能完成互動截圖驗證。

---

## [changed] — 2026-05-31 — 面額選單箭頭改為 CSS 圖示

### Changed
- `frontend/src/pages/Baccarat.jsx`：移除百家樂面額按鈕中的文字箭頭。
- `frontend/src/index.css`：改用 `baccarat-amount-toggle::after` 繪製 chevron 圖示，並在展開時旋轉。

### Why
- 面額按鈕上的文字箭頭看起來像 `v` 字元；改為 CSS 圖示可維持一致的紅金 UI 質感。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 權限失敗，升權重跑後成功）。

---

## [changed] — 2026-05-31 — 百家樂下注金額改為自製面額選單

### Changed
- `frontend/src/pages/Baccarat.jsx`：下注金額保留自訂輸入，新增非原生 select 的面額選單，提供 100、200、500、1000、3000、5000、7000、10000 快速選擇。
- `frontend/src/index.css`：新增 `baccarat-amount-*` 樣式，讓面額選單、切換按鈕與選中狀態符合紅金 VIP 牌桌風格。

### Why
- 原本純輸入框操作較慢；改為自訂金額搭配常用面額按鈕，可保留樣式掌控並提升下注效率。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 權限失敗，升權重跑後成功）。

---

## [changed] — 2026-05-31 — 放大百家樂下注與結算區

### Changed
- `frontend/src/index.css`：將 `/game/baccarat` 牌桌內的下注區與本局結算改為上下獨立橫列，放大面板、選項按鈕與內距。
- `frontend/src/index.css`：移除百家樂結算欄位文字的 ellipsis 截斷，改為自然換行，避免長文字顯示成 `...`。

### Why
- 百家樂下注區與本局結算同列時資訊較擁擠，部分文字會被截斷；改成獨立列後更適合掃讀與操作。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 權限失敗，升權重跑後成功）。

---

## [changed] — 2026-05-31 — 百家樂頁面改為 VIP 賭桌視覺

### Changed
- `frontend/src/pages/Baccarat.jsx`：將 `/game/baccarat` 版面重整為 `baccarat-*` 語意區塊，包含遊戲標題、Player / Banker 對戰牌桌、下注面板、結算面板與右側狀態欄。
- `frontend/src/index.css`：新增百家樂專屬樣式，包含暗紅絨布桌面、深色玻璃牌區、象牙白撲克牌、金色選中 / hover / winner glow、結算面板狀態色與 RWD 斷點。

### Why
- 百家樂頁面需要更貼近 Lucky Star Casino 既有紅金暗色主題，並呈現高級賭城內百家樂桌面的視覺層級。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 權限失敗，升權重跑後成功）。
- `http://127.0.0.1:5173/game/baccarat` → dev server 回應 200；Browser 外掛在目前 Windows sandbox 初始化失敗，未能完成互動截圖驗證。

---

## [feat] — 2026-05-31 — 新增前端百家樂遊戲頁互動流程

### Added
- `frontend/src/utils/baccaratGame.js`：新增百家樂前端模擬 helper，包含 `createDeck()`、`drawCard()`、`calculateBaccaratScore()`、`determineWinner()`、`calculatePayout()` 與下注倍率設定。

### Changed
- `frontend/src/pages/Baccarat.jsx`：重做 `/game/baccarat` 頁面，加入 Player / Banker / Tie 下注選擇、下注金額輸入、兩張牌簡化發牌、點數與勝方計算、命中派彩 / 未命中損失顯示。
- `frontend/src/pages/Baccarat.jsx`：沿用既有 `AppShell`、`MetricCard`、紅金暗色系樣式與 PrivateRoute；保留未來 `POST /api/game/baccarat/play` 與 wallet-service 扣款 / 派彩 TODO。

### Why
- 既有百家樂頁面只有點下注區即開局的簡化桌面互動，缺少本次需求指定的下注驗證、發牌按鈕、結果明細與後端串接預留契約。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 權限失敗，升權重跑後成功）。
- `http://127.0.0.1:5173/game/baccarat` → dev server 回應 200；Browser 外掛在目前 Windows sandbox 初始化失敗，未能完成互動截圖驗證。

---

## [changed] — 2026-05-31 — Slot 轉輪改為 requestAnimationFrame 精準停輪

### Changed
- `frontend/src/components/SlotMachinePreview.jsx`：重構為 reusable `Reel` component，新增 `animateReel`、`easeOutCubic`、圖片預載與固定 track 建立流程；動畫開始前即把結果 symbol 放進最終停止位置。
- `frontend/src/components/SlotMachinePreview.jsx`：每軸使用 5/6/7 圈與 1800/2200/2600ms 錯開停輪，動畫期間只更新 reel track 的 `transform: translate3d(...)`，結束時修正到精準 `targetY`。
- `frontend/src/index.css`：移除 slot reel 的 CSS keyframe strip 切換，改用固定 symbol 高度與 `will-change: transform` 的 composited track。
- `frontend/src/pages/SlotGame.jsx`：直接改用新版 `SlotMachine` 元件，讓 `/game/slot` 實際接上 requestAnimationFrame 轉輪動畫；spin handler 會回傳本局結果給 slot 元件，確保可視動畫開跑前已取得並預排結果 grid。
- `frontend/src/components/SlotMachine.jsx`、`frontend/src/components/Reel.jsx`、`frontend/src/components/slotMachine.css`：抽出現行 slot 機台正在使用的 reusable reel 元件與動畫工具，避免專案同時維護 demo 版與實際版兩套轉輪邏輯。
- `frontend/src/components/SlotMachinePreview.jsx`：改為相容轉出口，舊 import 會導向新版 `SlotMachine`。
- `frontend/src/services/mockApi.js`、`frontend/src/store/slices/gameSlice.js`：將現行 `/game/slot` 使用的 mock symbols 與初始 grid 改為 `['🍒', '🍋', '🔔', '⭐', '7️⃣']`，讓新版轉輪在頁面上直接可見。
- `frontend/src/components/SlotMachine.jsx`、`frontend/src/components/Reel.jsx`、`frontend/src/index.css`：將 slot reel 非 compact symbol 高度調整為 170px，讓三列 symbol 填滿目前 reel window；symbol 內容改為 `.slot-symbol-art` 顯示，避免 emoji / 圖片因文字行高被裁切。
- `frontend/src/pages/SlotGame.jsx`：移除 Bet Control 面板中「三轉輪 / 中線獎 / 停輪回彈」這排使用者不需要的說明標籤。
- `frontend/src/index.css`：重繪 slot lever 視覺，新增金屬底座、桿身、球形握把與下拉回彈 `slot-lever-pull` 動畫，讓 spin 時拉桿更接近實體機台。
- `frontend/src/index.css`：調整 slot lever 動畫為垂直由上至下拉動，移除大角度旋轉，讓拉桿動作更協調。
- `frontend/src/index.css`：收斂 slot lever 的握把、桿身與下拉行程到外殼內，避免動畫時看起來脫離 parent container。
- `frontend/src/index.css`：徹底重構 slot lever 的動件模型，保留原外觀材質但改為透明 `span` 容器承載球頭與桿身一起垂直滑動，讓拉桿不再有部件分離感。
- `frontend/src/index.css`：讓 slot lever 的 parent 外殼、底座與導槽在 active 狀態同步下壓與改變光影，避免背景靜止造成拉桿與容器不協調。
- `frontend/src/index.css`：依俯視視角重做 slot lever，移除側視金屬桿與底座表現，改為凹槽中的握把上下滑動。
- `frontend/src/index.css`：將俯視 slot lever 的滑動握把改成球形，使用圓形高光與內陰影強化球體感。

### Why
- Slot reel 原本會在 spinning / settling / result 三種 DOM 之間切換，容易出現頓感與結果替換感；改為單一 track + rAF 可降低 layout/repaint，並讓停輪位置可精準計算。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 權限失敗，升權重跑後成功）。
- `http://127.0.0.1:5173/game/slot` → dev server 回應 200；Browser 外掛在目前 Windows sandbox 初始化失敗，未能完成互動截圖驗證。

---

## [changed] — 2026-05-30 — Slot 遊戲畫面與 spin 動畫精修

### Changed
- `frontend/src/components/SlotMachinePreview.jsx`：將原本 3x3 靜態格子改為三欄式轉輪機台，新增跑馬燈、玻璃反光、中線 payline、逐欄滾動與停輪回彈狀態。
- `frontend/src/index.css`：新增 slot machine 專用樣式、轉輪滾動、燈泡追光、停輪落點、命中高亮與 reduced-motion fallback。
- `frontend/src/index.css`：固定 slot 轉輪視窗高度並將 spin 用長轉輪 strip 改為絕對定位，避免 spin 時撐高畫面；平常狀態即使用加高後高度。
- `frontend/src/components/SlotMachinePreview.jsx`、`frontend/src/index.css`：調整 spin 轉輪週期、blur、抖動幅度與停輪 easing，讓轉動和煞停更絲滑。
- `frontend/src/components/SlotMachinePreview.jsx`、`frontend/src/index.css`：新增左到右逐欄煞停狀態，最終 symbol 會在同一條煞停 strip 中滑入定位，避免轉到一半直接彈出結果。
- `frontend/src/components/SlotMachinePreview.jsx`、`frontend/src/index.css`：移除移動中轉輪的 filter/blur 動畫與抖動，改用純 `transform` 合成層動畫，降低掉幀感並提升 spin smoothness。
- `frontend/src/components/SlotMachinePreview.jsx`、`frontend/src/index.css`：放大 slot 主機台，新增實體老虎機常見的 jackpot 燈箱、厚框轉輪窗、下方控制台、大型 SPIN 按鈕與拉桿造型。
- `frontend/src/pages/SlotGame.jsx`：重整 slot 頁面資訊層級，新增上方狀態指標與右側下注/回合面板，spin 按鈕會顯示本局下注金額與餘額不足狀態。
- `frontend/src/pages/SlotGame.jsx`：將遊戲資訊卡移到右側欄，讓主 slot 機台在第一視覺佔更大比例。
- `frontend/src/pages/SlotGame.jsx`：移除側邊欄 SPIN 按鈕，slot 遊戲只保留機台控制台內的主要 SPIN 按鈕。
- `frontend/src/pages/SlotGame.jsx`：調整側邊欄「最近派彩」說明文字，不再顯示 `5x / SLOT-...` 這類 round id 技術字串，改顯示中獎倍率或未中獎狀態。
- `frontend/src/pages/SlotGame.jsx`、`frontend/src/index.css`：將 Round 面板中的狀態值改為燈號樣式，依 spinning/result/win/idle 顯示不同亮度與顏色。
- `frontend/src/pages/SlotGame.jsx`：spin 視覺煞停期間維持按鈕鎖定，避免 API 回應後動畫尚未結束時重複觸發。
- `frontend/src/services/mockApi.js`：降低前端 mock slot 強制中線命中率，由原本約 48% 調整為 18%，加上自然湊線後約落在兩成上下。

### Why
- 使用者希望 slot 遊戲畫面更精緻，且 spin 時動畫更接近真實老虎機轉輪，而不是單純格子跳動。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS（無 ESLint warnings）。
- `npm run build`（frontend）→ PASS。
- 已啟動本機 Vite dev server 並確認 `http://127.0.0.1:5173` 回應 200；Browser 外掛在目前 Windows sandbox 連線失敗，未能完成瀏覽器截圖驗證。

---

## [added] — 2026-05-30 — 全站新增金幣雨背景特效

### Added
- `frontend/src/components/CoinRain.jsx`：新增全域金幣雨背景元件，使用固定數量的 CSS 金幣粒子產生落下效果。
- `frontend/src/index.css`：新增 `coin-rain` 樣式與 `coin-fall` 動畫，並支援 `prefers-reduced-motion` 降低動態。

### Changed
- `frontend/src/App.jsx`：在全站路由外層掛載 `CoinRain`，讓首頁、登入/註冊、Lobby、遊戲、商城、排行榜、Profile、交易紀錄等頁面都顯示金幣雨。
- `frontend/src/index.css`：調整金幣雨堆疊順序為背景之上、頁面內容之下；移除 page stage 整層 z-index，改由背景容器內容層高於金幣雨，避免金幣覆蓋卡片、按鈕與表單。
- `frontend/src/App.jsx`：將 `CoinRain` 移入 `PageTransition` 內，讓金幣雨與頁面內容共用同一個堆疊環境，避免在 Router 外層壓過整個頁面。
- `frontend/src/components/CoinRain.jsx`、`frontend/src/index.css`：加大金幣尺寸差異與單顆透明度差異，讓落下效果更有前後層次。
- `frontend/src/App.jsx`、`frontend/src/components/AppShell.jsx`、`frontend/src/pages/Home.jsx`、`frontend/src/pages/Member.jsx`、`frontend/src/pages/Login.jsx`、`frontend/src/pages/Register.jsx`：移除 Router 外層金幣雨，改掛在各頁實際背景容器內，修正首頁因 `scroll-shell` stacking context 造成金幣覆蓋內容的問題。

### Why
- 使用者希望所有頁面都有金幣雨落下的背景特效，提升 Lucky Star Casino 的賭場氛圍。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS（無 ESLint warnings）。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 會遇到 Windows `Access is denied`，升權重跑後成功）。

---

## [changed] — 2026-05-30 — Profile 新增簽到彈出獎勵面板

### Added
- `frontend/src/pages/Profile.jsx`：Check-in 卡片可展開彈出 section，顯示本月簽到天數、當月日曆、今日可領獎勵與 7/14/21/30 天連續簽到追加獎勵。
- 彈出面板新增「立即簽到」操作，會呼叫既有 `dailyCheckIn` thunk；簽到成功後更新本地本月簽到日期紀錄並同步刷新 profile。
- `frontend/src/components/AppShell.jsx`：登入狀態下每日第一次進入任一登入後頁面時，若今日尚未簽到，會在畫面正中央自動彈出簽到確認 modal。

### Changed
- `backend/member-service/src/main/java/com/luckystar/member/service/CheckinService.java`：簽到獎勵改為每日 100 星幣，連續第 7/14/21/30 天分別追加 1000/2000/3000/5000。
- `backend/member-service/src/test/java/com/luckystar/member/service/CheckinServiceTest.java`：更新每日簽到獎勵斷言，新增第 7 天里程碑追加獎勵測試。
- `frontend/src/services/mockApi.js`：mock 簽到獎勵公式同步改為每日 100 + 里程碑追加獎勵。
- `frontend/src/pages/Profile.jsx`：移除舊的 Profile 內自動展開右側簽到浮層邏輯，保留手動查看用簽到面板。
- `frontend/src/components/AppShell.jsx`：中央簽到 modal 的 dismiss 按鈕在尚未簽到時顯示「稍後」，簽到完成或今日已簽到後改顯示「關閉」。

### Why
- 使用者希望 Profile 的 check-in 功能以彈出 section 呈現，並依月份顯示目前簽到天數與新的連續簽到獎勵規則。
- 使用者希望每日第一次以登入狀態進入網站任一登入後頁面時，能在畫面正中間主動提醒簽到；以玩家 ID + 日期記錄每日自動彈出狀態，避免同一天重複打擾。
- 真實 API 與 mock API 同步更新獎勵公式，避免前端顯示與實際入帳不一致。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS（無 ESLint warnings）。
- `npm run build`（frontend）→ PASS。
- `mvn -pl backend/member-service test` → PASS（70 tests）。

---

## [changed] — 2026-05-30 — Header 玩家資訊改為頭像與姓名

### Changed
- `frontend/src/components/AppShell.jsx`：將 header 原本「玩家 / 姓名」文字卡改為玩家頭像 + 姓名資訊欄。
- 頭像優先使用 `player.avatarUrl`；圖片載入失敗或未設定時，顯示玩家名稱首字作為 fallback。

### Why
- 使用者希望 header 玩家資訊更直覺顯示目前登入者，改成頭像搭配姓名的視覺資訊欄。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS（無 ESLint warnings）。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 會遇到 Windows `Access is denied`，升權重跑後成功）。

---

## [changed] — 2026-05-30 — Profile 快速頭像改為六個賭場角色

### Added
- `frontend/src/assets/avatars/*.webp`：新增 6 張 AI 生成的賭場角色頭像（三男三女），供會員中心快速頭像使用。

### Changed
- `frontend/src/pages/Profile.jsx`：快速頭像由 3 個外部 DiceBear URL 改為 6 個本地賭場角色資產，並將頭像按鈕縮小為固定小尺寸。
- `frontend/src/utils/memberPreferences.js`：移除已不再使用的 DiceBear 快速頭像 URL helper。
- 選擇快速頭像時會把本地 WebP 資產轉成 `data:image/webp;base64,...` 再寫入表單，符合 member-service 既有頭像 validator 支援的格式。

### Why
- 使用者希望 `/profile` 頁面的快速頭像縮小一點、增加到六個，且頭像圖片改成三男三女的賭場角色。
- 本地資產可避免外部頭像服務變動；小型 WebP data URI 可維持後端 profile 欄位相容性。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 會遇到 Windows `Access is denied`，升權重跑後成功）。

---

## [changed] — 2026-05-30 — 遊戲大全入口卡片放大

### Changed
- `frontend/src/pages/Lobby.jsx`：移除 `/games` 頁面遊戲列表左側的 `gamesGallery` 裝飾視覺區塊，讓遊戲入口卡片直接佔滿 main 內容寬度。
- 放大遊戲入口 `Link` 卡片尺寸，改為更寬的主入口版型，並加入 hover 位移、縮放、光線、陰影、圖片飽和度與 CTA 箭頭互動效果；不同卡片使用不同 hover 動態。

### Why
- 使用者指定刪除「遊戲大全視覺」裝飾 div，並希望遊戲入口 a tag 更大、更符合 main 區塊尺度，互動時有更明顯的 hover 回饋。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 會遇到 Windows `Access is denied`，升權重跑後成功）。

---

## [changed] — 2026-05-30 — 排行榜預設顯示 20 名

### Changed
- `frontend/src/pages/Rank.jsx`：排行榜預設只顯示前 20 名，列表下方新增「顯示更多」按鈕；點擊後展開至完整 100 名玩家。
- 切換全服/好友榜或變更搜尋關鍵字時，排行榜顯示數量會重置為前 20 名，避免篩選後仍維持展開狀態。

### Why
- 排行榜初始顯示 100 名資訊量過大；預設顯示 20 名更容易掃讀，需要時再展開完整 TOP100。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 會遇到 Windows `Access is denied`，升權重跑後成功）。

---

## [changed] — 2026-05-30 — 移除登入後頁面 Header 技術狀態

### Changed
- `frontend/src/components/AppShell.jsx`：移除 header 內「狀態」與「WS」兩個技術資訊區塊，保留玩家、籌碼、通知中心與登出。
- 同步移除 `state.game.status`、`connectionStatus`、`reconnectAttempt` 的 header selector，避免 UI 仍依賴這些除錯用欄位。

### Why
- 一般使用者不需要看到遊戲狀態字串或 WebSocket 連線狀態；移除後登入後頁面的 header 更簡潔，聚焦在玩家資訊與操作入口。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 會遇到 Windows `Access is denied`，升權重跑後成功）。

---

## [changed] — 2026-05-30 — 首頁登入狀態顯示頭像與暱稱

### Changed
- `frontend/src/pages/Home.jsx`：首頁右上角保留原本 CTA（登入後仍顯示「進入遊戲大全」並導向 `/games`；未登入顯示「會員登入」並導向 `/member`），登入狀態時在按鈕旁新增頭像 + 暱稱的會員入口，點擊導向 `/profile`。
- 未登入狀態時，頭像/暱稱位置顯示「未登入」chip；點擊後在旁邊/選單內顯示紅字「請先登入」，不自動跳頁。
- 手機首頁選單同步顯示登入頭像 + 暱稱或未登入 chip，並保留原本「會員中心」/「會員登入 / 註冊」入口。

### Why
- 使用者希望保留首頁原本按鈕配置，同時在按鈕旁顯示目前會員狀態：登入時顯示設定頭像與暱稱並可直達會員中心，未登入時顯示「未登入」並以紅字提示需先登入。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 會遇到 Windows `Access is denied`，升權重跑後成功）。

---

## [feat] — 2026-05-30 — 前端站內連結過場動畫

### Added
- `frontend/src/components/PageTransition.jsx`（新增）：監聽站內 `<a>` 點擊與 React Router `pathname` 變化，對 `Link`、`NavLink`、錨點連結與程式導頁觸發 720ms 以內的全域過場。
- `frontend/src/index.css`：新增 `page-enter` 與 `link-sheen` 動畫，讓頁面切換淡入上移、連結點擊時有金紅掃光效果；支援 `prefers-reduced-motion: reduce` 關閉動畫。

### Changed
- `frontend/src/App.jsx`：在 `BrowserRouter` 內包覆 `PageTransition`，集中處理所有 route 頁面切換，不需逐一修改既有頁面連結。

### Why
- 使用者要求每個 link 點擊後都能在 1 秒內有過場動畫，提升 React 前端頁面切換的絲滑感。
- 採全域元件攔截站內連結與 route 變化，可以涵蓋首頁錨點、導覽列、卡片連結與登入後 `navigate()`，同時避免散落在每個頁面重複實作。

### How（如何驗證）
- `npm run lint`（frontend）→ PASS。
- `npm run build`（frontend）→ PASS（sandbox 內 esbuild 讀取 `vite.config.js` 遇到 Windows `Access is denied`，升權重跑後成功）。

---

## [feat] — 2026-05-29 — Kafka→MySQL 讀端同步（補 T-025 流水查詢資料來源）

### Added
- `backend/wallet-service/.../kafka/WalletReadSyncListener.java`（新增）：消費 `wallet.debit`/`wallet.credit` 事件，把每筆交易寫入 MySQL 讀庫 `wallet_transactions`（經 `WalletTransactionViewRepository`），讓 `GET /api/v1/wallet/transactions`（T-025）回傳真實流水。
  - `onDebit`：寫入 `type=DEBIT`、`subType=BET`；`onCredit`：寫入 `type=CREDIT`、`subType=event.subType()`（WIN/CHECKIN/TASK/GIFT/GM_REWARD/BANKRUPTCY_AID）。
  - 冪等：以讀庫主鍵 `existsById(transactionId)` 檢查，重送即略過寫入仍 ack（Kafka at-least-once 安全）。
  - 每個 handler 個別標註 `@Transactional(transactionManager = "mysqlTransactionManager")`（不在類別層級，避免干擾 Kafka listener proxy）；成功 `save` 後才 `ack.acknowledge()`。
- 測試（新增）：`kafka/WalletReadSyncListenerTest.java`（7 案，`@ExtendWith(MockitoExtension.class)`、真實 `ObjectMapper`）：debit/credit 正常同步、冪等跳過重送、JSON 格式錯誤往外拋不 ack、`DataAccessException` 往外拋不 ack。

### Why
- T-025 查詢 API 先前讀的是空的 MySQL 讀庫；需要事件驅動的同步管線把 PostgreSQL 寫端結果投影到讀端（ADR-001 CQRS、最終一致）。
- ⚠️ ADR-002 地雷：本 listener **只消費事件 `wallet.debit`/`wallet.credit`，絕不消費指令 `wallet.credit.request`**——在 wallet-service 內消費指令會形成「再入帳→再發指令」的無限迴圈。
- 錯誤處理沿用既有 `KafkaConsumerConfig`：`JsonProcessingException` 不可重試直送 `<topic>.DLT`；暫時性失敗往外拋、不 ack，重試 3 次耗盡後送 DLT。

### How（如何驗證）
- `mvn -pl backend/wallet-service test`（單元測試以 Mockito 驗證 save/ack 行為與冪等、不可重試/可重試例外路徑；listener 不需外部 Kafka）。

---

## [feat] — 2026-05-29 — 帳務流水查詢 API（T-025，CQRS MySQL 讀端）

### Added
- `backend/wallet-service/.../mysql/entity/WalletTransactionView.java`（新增）：MySQL 讀庫 `wallet_transactions` 唯讀視圖，由 `mysqlEntityManagerFactory` 管理（ADR-001 CQRS 讀端）。
- `backend/wallet-service/.../mysql/repository/WalletTransactionViewRepository.java`（新增）：`search(...)` JPQL 查詢，支援 playerId + 可選類型 + 可選日期區間 + 分頁（null 即略過該條件）。
- `backend/wallet-service/.../service/WalletQueryService.java`（新增）：讀端查詢服務，固定 `@Transactional(readOnly=true, transactionManager="mysqlTransactionManager")`，排序 createdAt DESC, id DESC。
- `backend/wallet-service/.../dto/WalletTransactionResponse.java`、`common/PagedResponse.java`（新增）：對外回傳 DTO 與穩定分頁格式（不直接序列化 Spring `Page`）。
- 測試（新增）：`controller/WalletTransactionsControllerTest.java`（10 案）、`service/WalletQueryServiceTest.java`（3 案）。

### Changed
- `backend/wallet-service/.../controller/WalletController.java`：新增 `GET /api/v1/wallet/transactions`，支援 `page/size`（size 上限 100）、`type`（DEBIT/CREDIT/BONUS，大小寫不敏感）、`from/to`（ISO yyyy-MM-dd，涵蓋整個 to 當日）；玩家身分取自 `X-User-Id` header；參數錯誤回 400。
- `backend/wallet-service/.../config/DataSourceConfig.java`：MySQL EMF 的 `hibernate.hbm2ddl.auto` 由硬編 `validate` 改為與寫端共用組態來源（system property `jpa.ddl-auto` → env `JPA_DDL_AUTO` → 預設 `validate`），讓測試（surefire `jpa.ddl-auto=create`）能在 H2 自動建讀庫表；正式環境仍 `validate`。
- `backend/wallet-service/.../exception/GlobalExceptionHandler.java`：新增 `MethodArgumentTypeMismatchException` → 400 處理（例如 `from/to` 日期格式錯誤、`page/size` 非數字）。

### Why
- T-025 要求帳務流水查詢走 MySQL 讀庫（ADR-001 CQRS 讀寫分離），與扣款/入帳（PostgreSQL 寫端）解耦，避免查詢與寫入鎖競爭。
- 讀端視圖不含 `idempotency_key` 等冪等控制欄位，僅暴露查詢所需欄位；分頁採固定 schema 避免前端依賴 Spring `Page` 不穩定結構。

### How（如何驗證）
- `mvn -pl backend/wallet-service test` → **BUILD SUCCESS，Tests run: 51, Failures: 0, Errors: 0**（含本次新增 13 個單元測試，及 `contextLoads` 驗證新增 MySQL 實體後雙 EMF 仍正常啟動）。

---

## [docs] — 2026-05-29 — AI 開發前必讀（AGENTS.md/CLAUDE.md）+ CHANGELOG 單一來源約定

### Added
- `AGENTS.md`（新增）：AI / 自動化代理開發前必讀的 primer —— 必讀文件清單、10 條已知地雷、約定速查、CHANGELOG 規則、驗證指令。跨工具通用。
- `CLAUDE.md`（新增）：精簡指標，以 `@AGENTS.md` 帶入完整內容 + Claude Code 專屬補充（內容只維護 AGENTS.md 一份，避免漂移）。

### Changed
- `CONTRIBUTING.md`：新增 §6「CHANGELOG 更新規則」—— 確立**根目錄 `./CHANGELOG.md` 為單一真相來源**、何時更新、條目格式。
- `backend/member-service/CHANGELOG.md`：頂部加凍結註記，標明已凍結為歷史、新條目改寫根目錄。

### Why
- 新 AI / 新組員缺乏一致的上下文起點，重複踩同樣的雷（如 `./mvnw` 不存在、必填環境變數、雙資料源、ADR-002 迴圈）。
- 原本同時存在根目錄與 member-service 兩份 CHANGELOG 且只有 member 被維護，造成「該更新哪份」的模糊；統一為根目錄一份降低維護成本與脫節風險。

---

## [feat] — 2026-05-29 — ADR-002 wallet.credit 指令/事件分離，串通簽到入帳（T-017/T-018）

### Decision

- `docs/adr/ADR-002.md`（新增）：拍板 `wallet.credit` 事件契約，**分離「入帳指令」與「入帳事件」**：
  - `wallet.credit.request`（指令）：member 等發出「請入帳」，wallet 消費後真正加餘額。
  - `wallet.credit`（事件）：wallet 入帳後發出「已入帳」，供 rank/notification 消費。
  - wallet-service **永不消費** `wallet.credit`（避免自我迴圈）。

### Added

- `backend/wallet-service/.../kafka/WalletCreditRequestEvent.java`、`WalletCreditRequestListener.java`（新增）
  - 消費 `wallet.credit.request` → 組 `CreditRequest` → 呼叫既有 `WalletService.credit()`（重用 T-023）→ 成功才 ack。手動 ack、失敗進 DLT。
- `backend/wallet-service/.../kafka/WalletCreditRequestListenerTest.java`（新增）：3 個單元測試（正常入帳 / 格式錯誤不 ack / credit 失敗不 ack）。

### Changed

- `kafka/kafka-init.sh`：新增 topic `wallet.credit.request` 與 `wallet.credit.request.DLT`，並補上指令/事件語意註解。
- `backend/member-service/.../service/CheckinService.java`、`NewGiftService.java`：outbox 發布 topic 由 `wallet.credit` 改為 `wallet.credit.request`（payload 不變）。
- 對應更新 `CheckinServiceTest`、`NewGiftServiceTest` 的 topic 斷言。
- `backend/wallet-service/.../kafka/WalletCreditEvent.java`：更新架構備註對齊 ADR-002。

### Result

- ✅ **T-017 簽到入帳 / T-018 新手禮入帳鏈路接通**：member 發指令 → wallet 消費入帳 → 發事件。先前因「無 consumer」而斷裂的問題解除。

### Verified

- `mvn -pl backend/member-service,backend/wallet-service test` → **member 69 + wallet 32 全綠，BUILD SUCCESS**（含新 consumer 測試與 wallet contextLoads 載入該 bean）。

### Note

- ⚠️ 本次在 wallet-service 的實作與 Wei Yu 上傳的 T-023 可能重疊，**需與 Wei Yu 協調合併**（擇一為準或將 consumer 疊加到其分支）。
- rank-service（T-040）實作時請消費 `wallet.credit`/`wallet.debit`（事件），勿消費 `wallet.credit.request`（指令）。

---

## [feat] — 2026-05-29 — Wallet 派彩入帳 API（T-023）+ 啟動修復 + 後端 CI 擋關

### Added

- `backend/wallet-service/.../dto/CreditRequest.java`、`CreditResponse.java`（新增）
  - 入帳請求 / 回應 DTO，與 debit 對稱。`CreditRequest` 含 `subType`（限 WIN/CHECKIN/TASK/GIFT/GM_REWARD/BANKRUPTCY_AID）、`idempotencyKey`、選填 `unfreezeAmount`（解凍）。
- `backend/wallet-service/.../kafka/WalletCreditEvent.java`（新增）
  - 入帳完成事件（發布到 `wallet.credit`），含架構備註：禁止在 wallet-service 內新增 `wallet.credit` consumer，否則與本事件形成無限迴圈（詳見 `docs/_TMP_wallet-credit-架構決策筆記.md`）。
- `backend/wallet-service/.../service/WalletService#credit()`（新增方法）
  - 冪等檢查 → 載入錢包 → 加餘額 +（選填）解凍 → 樂觀鎖存檔 → 寫 `wallet_transactions`（type=CREDIT）→ 發 `wallet.credit` 事件。結構對稱於 `debit()`，含並發 UNIQUE 衝突回查與樂觀鎖 409 處理。
- `backend/wallet-service/.../controller/InternalWalletController`：新增 `POST /internal/wallet/credit`。
- `backend/wallet-service/.../service/WalletServiceCreditTest.java`（新增）：7 個單元測試（含解凍、解凍守衛、冪等、並發、樂觀鎖、查無錢包）。

### Fixed

- `backend/wallet-service/.../config/KafkaConsumerConfig.java`
  - **修復 wallet-service 無法啟動的 bug**：移除重複的 `kafkaErrorHandler` @Bean（Spring Boot 3.2+ 同名 @Bean 會丟 `BeanDefinitionParsingException` 導致 context 無法載入）。等同套用未合併分支 `fix/wallet-service-t020-t021-review` 的 `2b074dd`。
  - 驗證：`WalletServiceApplicationTests.contextLoads` 由「啟動失敗」轉為通過。

### Changed

- `backend/wallet-service/pom.xml`：新增 H2（test scope）與 surefire `jpa.ddl-auto=create`，讓 `@SpringBootTest` 用記憶體資料庫啟動（比照 member-service）。
- `backend/wallet-service/src/test/resources/application.yml`：雙資料源改指向 H2（PostgreSQL / MySQL 相容模式），使 contextLoads 不需外部 DB。
- `.github/workflows/ci.yml`：**新增 `backend-test` job**，PR 到 main/develop 時對 gateway/member/wallet 跑 `mvn clean test`（用 H2，無需外部基礎設施）。這正是先前漏掉、導致 wallet 啟動 bug 溜進 develop 的擋關規則。

### Verified

- `mvn -pl backend/gateway-service,backend/member-service,backend/wallet-service test` → 三服務皆 **BUILD SUCCESS**（member 69、wallet 29 含 contextLoads、gateway 通過）。

### Note

- ⚠️ **T-017 簽到入帳仍未串通**：member 發 `wallet.credit` 作為「請入帳」指令，但 wallet 端尚未消費（避免與本次新增的事件發布形成迴圈）。需先拍板 `wallet.credit` topic 語意（見決策筆記）才能補上 consumer。本次 T-023 僅交付 HTTP 入帳端點，未處理該架構決策。
- ⚠️ 需在 GitHub 設定 **branch protection**，將 `backend-test` 設為必過檢查，CI 才真正能「擋」住合併（workflow 本身只負責執行）。

---

## [progress] — 2026-05-29 — 全專案進度盤點與未完成事項標記

> 依據 `docs/幸運星幣城_工作分配表.xlsx`（T-000~T-107，共 78 項）逐一比對實際程式碼。
> 完整逐項狀態與盤點依據見 `AUDIT_REPORT.md` 附錄 A。
> 統計：✅ 已完成 24 項（~31%）、⚠️ 部分完成 11 項（~14%）、❌ 未開始 42 項（~54%）、❓ 待確認 1 項。

### Done（已完成主線）

- **全域基礎建設**：T-000 Repo/分支、T-001 架構/ADR-001、T-003 服務初始化、T-004 前端初始化、T-005 Kafka Topic、T-006 DB Schema。
- **Member Service**：T-010 註冊、T-011 登入/登出、T-012 Token 刷新、T-013 Security、T-014 個人資料、T-015 好友、T-016 任務結構、T-018 新手禮包。
- **Gateway**：T-060 路由、T-061 JWT 過濾器、T-062 速率限制、T-063 熔斷。
- **前端骨架**：T-080 登入/註冊、T-081 Redux、T-082 大廳。

### TODO — 未完成事項（依優先級）

#### 🔴 P0 — 核心功能缺口（阻擋產品成形）

- [x] **T-023 派彩入帳 API（wallet credit）**（2026-05-29 完成）— `POST /internal/wallet/credit` 已實作（冪等/樂觀鎖/解凍/發 wallet.credit）。⚠️ 但 **T-017 簽到入帳仍未串通**：wallet 尚未消費 member 發的 wallet.credit 指令（待 topic 語意拍板，見 `docs/_TMP_wallet-credit-架構決策筆記.md`）。
- [ ] **T-030~T-033 老虎機核心**（組員B）— RNG 引擎、遊戲邏輯、Spin API、Redis Session：game-service 僅有啟動類，**整個服務未開始**。
- [ ] **T-040~T-042 排行榜核心**（組員D）— ZSet 全服榜、好友榜、查詢 API：rank-service 僅有啟動類。
- [ ] **T-025 帳務流水查詢 API**（組員C）。
- [ ] **T-090 JMeter 壓測腳本、T-091 帳務一致性對帳腳本、T-093 E2E 整合測試**（組員D / 全員）。
- [ ] **T-100~T-104 鑽石系統 P0**（資料表 / 開戶 / 序號兌換 / 鑽石換星幣 / 查餘額）— 全數未實作。

#### 🟠 P1 — 重要功能

- [x] **T-026 好友星幣贈送**（組員C）— 2026-06-01 完成（`POST /api/v1/wallet/gift`）。
- [ ] **T-027 破產補助**（組員C）。
- [ ] **T-034~T-036 百家樂邏輯/API、RNG 公平性驗證**（組員B）。
- [ ] **T-043 每週排行榜重置、T-044 每日持幣快照**（組員D）。
- [ ] **T-050~T-053 Admin 後台**（JWT 角色、玩家管理、流通量報表、RTP 儀表板）— admin-service 僅有 datasource 骨架。
- [ ] **T-070~T-073 Notification Service**（組員D）— **backend 無 notification-service 模組**，WebSocket 推播整段缺失。
- [ ] **T-085~T-088 前端**（排行榜/帳務/百家樂/個人資料）UI 存在但**多依賴未實作後端 API**，真實串接未完成。
- [ ] **T-092 Swagger UI**（各服務無 springdoc 依賴）。
- [ ] **T-105~T-107 鑽石系統 P1**（後台序號生成/查詢、前端鑽石頁面）。

#### ⚪ P2 / 收尾

- [ ] **T-028 Wallet DLT Admin 查詢/重試 API**（DLT topic 已建，管理端未做）。
- [ ] **T-037 遊戲 RTP 統計、T-045 今日贏幣王榜、T-054 異常玩家偵測、T-055 GM 發幣工具**。
- [ ] **T-089 RWD 響應式優化**（待實機驗證三斷點）。
- [x] **T-094 DEPLOY.md**（2026-05-29 完成本機部署 SOP）。剩 **T-095 ADR-002~005、T-096 結業簡報/Demo 影片**。

### 已知偏離 / 風險標記

- ⚠️ **T-002 偏離規格**：docker-compose 使用 **Zookeeper** 模式，規格表要求 **KRaft（無 Zookeeper）**，需確認是否為刻意決策。
- ⚠️ **範圍膨脹**：鑽石系統 T-100~T-107 已寫入任務表（git 有 `docs/diamond-system-tasks`）但**零程式碼產出**。
- ⚠️ **未完成的後端服務佔 4 個**：game / rank / admin / notification，等同賭場營利核心尚未起步。
- ✅ 測試狀態（2026-05-29 驗證）：member-service 全套件 `mvn test` → **69 個測試全綠**；AUDIT 先前記載的「測試引用不存在方法、編譯失敗」已不成立（測試早已對齊 source）。

---

## [feat] — 2026-05-29 — Gateway Circuit Breaker 熔斷降級（T-063）

### Added

- `backend/gateway-service/src/main/java/com/luckystar/gateway/dto/ApiResponse.java`（新增）
  - Gateway 本地統一 API 回應格式 record：`boolean success`、`Object data`、`String message`。
  - 僅供 gateway-service 內部使用，不與下游服務共用。

- `backend/gateway-service/src/main/java/com/luckystar/gateway/controller/FallbackController.java`（新增）
  - `@RestController`，處理 `GET|POST /fallback/{service}`。
  - 從 exchange attribute `CIRCUITBREAKER_EXECUTION_EXCEPTION_ATTR` 讀取觸發熔斷的例外：
    - `CallNotPermittedException`（熔斷開路）→ 回傳「請稍後再試」友善訊息。
    - 其他例外（連線逾時等）→ 回傳通用服務不可用訊息。
  - 固定回傳 HTTP 503，Content-Type: application/json，不暴露熔斷狀態（OPEN/HALF_OPEN/CLOSED）。

### Modified

- `backend/gateway-service/pom.xml`
  - 新增 `spring-cloud-starter-circuitbreaker-reactor-resilience4j`（BOM 管理，無需指定版本）。
  - 說明：Spring Cloud Gateway 是 reactive 應用，需 `reactor-resilience4j` 而非普通版；後者缺少 `resilience4j-reactor` 傳遞依賴，`ReactiveResilience4JAutoConfiguration` 的 `@ConditionalOnClass(CircuitBreakerOperator.class)` 不成立，導致 `CircuitBreaker` filter factory 無法被 Gateway 發現。

- `backend/gateway-service/src/main/resources/application.yml`
  - **所有 7 條路由**新增 `CircuitBreaker` filter（instance 對應關係如下）：

    | 路由 | instance name | fallbackUri |
    |------|--------------|-------------|
    | member-auth、member-player、member-checkin | `member-service` | `forward:/fallback/member` |
    | wallet | `wallet-service` | `forward:/fallback/wallet` |
    | game | `game-service` | `forward:/fallback/game` |
    | rank | `rank-service` | `forward:/fallback/rank` |
    | admin | `admin-service` | `forward:/fallback/admin` |

  - 新增 `resilience4j.circuitbreaker.instances` 區塊，5 個服務共用相同參數：
    - `failure-rate-threshold: 50`（失敗率 > 50% 觸發熔斷）
    - `slow-call-rate-threshold: 80 / slow-call-duration-threshold: 3s`
    - `sliding-window-type: COUNT_BASED / sliding-window-size: 10 / minimum-number-of-calls: 5`
    - `wait-duration-in-open-state: 10s / permitted-number-of-calls-in-half-open-state: 3`
    - `automatic-transition-from-open-to-half-open-enabled: true`
  - `jwt.whitelist` 新增 `/fallback/`，讓 JWT filter 不攔截 Gateway 內部熔斷降級端點。

### Verified

- `mvn test` → `Tests run: 21, Failures: 0, Errors: 0, Skipped: 0`（含 `GatewayServiceApplicationTests.contextLoads` 整合測試）。

### Note

- 降級回應刻意不揭露熔斷狀態，符合安全要求（不讓外部探測服務拓撲）。
- `/fallback/**` 是 Gateway 自身端點，不對外路由到任何下游服務；JWT 白名單必須包含此路徑，否則熔斷後的 forward 請求本身也會被攔截回 401。

---

## [feat] — 2026-05-29 — Gateway 每玩家速率限制（T-062）

### Added

- `backend/gateway-service/src/main/java/com/luckystar/gateway/config/RateLimitProperties.java`（新增）
  - `@ConfigurationProperties(prefix = "rate-limit")` record，含內嵌 `Player(replenishRate, burstCapacity)` 與 `Game(replenishRate, burstCapacity)` record。
  - 對應 application.yml 新增的 `rate-limit.player` / `rate-limit.game` 設定區塊。

- `backend/gateway-service/src/main/java/com/luckystar/gateway/filter/PlayerRateLimitGlobalFilter.java`（新增）
  - `GlobalFilter, Ordered`，order = `-50`（在 JWT filter `-100` 之後、Gateway 路由轉發 `≥0` 之前）。
  - 讀取 JWT filter 注入的 `X-User-Id` header 作為計數金鑰，確保一個玩家超限不影響其他人。
  - 路徑識別：
    - `/api/v1/game/**` → 套用較嚴格的 `game` 設定（預設 burst 10）
    - 其他已驗證路徑 → 套用 `player` 設定（預設 burst 20）
  - Redis 實作（滑動視窗 token bucket）：
    - `INCR key` → 若計數 = 1 則 `EXPIRE key 1s`（開啟新視窗）
    - 計數 > burstCapacity → 回傳 HTTP 429，Header `Retry-After: 1`，JSON body `{"success":false,"data":null,"message":"Too many requests"}`
    - 計數 ≤ burstCapacity → 繼續轉發
  - Redis 故障採 **fail-open**（記錄 WARN 後放行），與 JWT 黑名單的 fail-closed 策略相反，優先保障可用性。
  - 白名單路徑（`/api/v1/auth/`、`/actuator/health` 等）與缺少 `X-User-Id` 的請求直接跳過，不查 Redis。

- `backend/gateway-service/src/test/java/com/luckystar/gateway/filter/PlayerRateLimitGlobalFilterTest.java`（新增）
  - 8 個純單元測試，無 Spring context、直接 mock `ReactiveStringRedisTemplate`：

    | 測試 | 情境 | 預期 |
    |------|------|------|
    | whitelistedPath_skipsRateLimit | POST /api/v1/auth/login | redis 不呼叫，chain 放行 |
    | normalPath_firstRequest_allows | 計數 = 1 | chain 放行，expire(1s) 被呼叫 |
    | normalPath_withinBurst_allows | 計數 = 20（= burstCapacity） | chain 放行 |
    | normalPath_exceedsBurst_returns429 | 計數 = 21（> burstCapacity） | HTTP 429，chain 不呼叫 |
    | gamePath_stricterLimit_exceedsBurst_returns429 | /game/bet，計數 = 11（> 10） | HTTP 429 |
    | gamePath_withinStrictLimit_allows | /game/bet，計數 = 5（≤ 10） | chain 放行 |
    | redisError_failOpen_allowsRequest | increment 拋 RuntimeException | chain 放行（fail-open） |
    | missingUserId_skipsRateLimit | 無 X-User-Id header | redis 不呼叫，chain 放行 |

### Modified

- `backend/gateway-service/src/main/java/com/luckystar/gateway/filter/FilterOrder.java`
  - 新增常數 `PLAYER_RATE_LIMIT = -50`，更新類別 Javadoc 的執行鏈說明。

- `backend/gateway-service/src/main/java/com/luckystar/gateway/GatewayServiceApplication.java`
  - `@EnableConfigurationProperties` 陣列加入 `RateLimitProperties.class`。

- `backend/gateway-service/src/main/resources/application.yml`
  - 根層新增 `rate-limit.player`（replenish 10，burst 20）與 `rate-limit.game`（replenish 5，burst 10）設定區塊，支援環境變數覆寫（`PLAYER_RATE_LIMIT_REPLENISH` 等）。

### Verified

- `mvn -Dtest=PlayerRateLimitGlobalFilterTest test` → `Tests run: 8, Failures: 0, Errors: 0`。

### Note

- Filter 執行順序：`RATE_LIMIT(-200，IP 限流)` → `JWT_AUTHENTICATION(-100)` → **`PLAYER_RATE_LIMIT(-50，本任務)`** → 路由轉發。
- order = -50 是設計必要條件：order -200 執行時 JWT filter 尚未注入 `X-User-Id`，若放在 -200 永遠讀不到 userId。

---

## [feat] — 2026-05-28 — 錢包餘額/簽到前後端串接 + Gateway 簽到路由修復（FIX-5）

### Fixed

- `backend/gateway-service/src/main/resources/application.yml`
  - **FIX-5（路由衝突）**：新增 `member-checkin` 路由，將 `POST /api/v1/wallet/daily-checkin` 指向 member-service（8081），並排在 `wallet` 路由**之前**。
  - 原因：簽到端點實作在 member-service，但路徑落在 `/api/v1/wallet/` 底下，原本會被 `wallet` 路由（`/api/v1/wallet/**` → wallet-service）整段攔截，導致透過 Gateway 簽到永遠打到 wallet-service 而回 404。
  - Spring Cloud Gateway 依設定順序「先匹配先贏」，故將精確路徑 `daily-checkin` 排在前面即可正確分流。

### Added

- `frontend/src/services/walletApi.js`（新增）
  - `getBalance()` — 呼叫 `GET /api/v1/wallet/balance`，回傳 `{ balance, frozenAmount, availableBalance }`。
  - `dailyCheckIn()` — 呼叫 `POST /api/v1/wallet/daily-checkin`；因後端回應只含 `rewardAmount`/`consecutiveDays` 不含最新餘額，故簽到後再查一次餘額，組成 `{ reward, consecutiveDays, wallet }`。

### Modified

- `frontend/src/store/slices/walletSlice.js`
  - `fetchWallet`、`dailyCheckIn` 兩個 thunk 由 `mockApi` 改用 `walletApi` 真實 API；錯誤訊息改用 `extractError()` 取後端訊息。
  - `checkIn` state 新增 `consecutiveDays`，簽到成功訊息改為「連續 N 天，獲得 X 星幣」。
  - `fetchTransactions`、`giftCoins` **暫留 mockApi**（後端對應 API 尚未實作）。

### Verified

- `frontend` 執行 `npm run build` 成功。

### Note

- 餘額串接的端到端正確性依賴 **FIX-1** 合併後 wallet-service 正確讀取 `X-User-Id`（已於 develop 合併）；前端本身不受影響。
- Profile 頁的「連續簽到天數」仍來自 `mapProfile` 的預設值——member-service 目前**沒有 GET 連續天數的端點**（`CheckinController` 只有 POST），需後端補 query API 才能在載入時顯示正確天數。
- 另外發現 `FriendshipController`（`/api/v1/friends/**`）Gateway **完全沒有路由**，好友功能透過 Gateway 不可達，待後續補路由。

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
