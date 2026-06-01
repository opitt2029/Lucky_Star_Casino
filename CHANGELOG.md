# Changelog — Lucky Star Casino

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
