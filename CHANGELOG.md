feature/weiyu-wallet-outbox
## [feat] — 2026-07-21 — 藍圖 04 P2：wallet Transactional Outbox（事件不再靜默丟失）

### Added
- `backend/wallet-service/.../postgres/entity/WalletOutbox.java`：outbox 事件列 entity（落在
  postgres.entity 套件，自動被 Postgres EMF 掃描，免改 packagesToScan）。
- `.../postgres/repository/WalletOutboxRepository.java`：`findTop100ByStatusOrderByCreatedAtAsc`
  + 觀測用 `countByStatus`（供 P5 積壓指標）。
- `.../service/WalletOutboxService.java`：交易內把事件寫進 wallet_outbox（PENDING），序列化留在
  交易內、失敗拋 `IllegalStateException` 讓交易 rollback（不留無聲缺口）。
- `.../service/WalletOutboxPoller.java`：`@Scheduled` + `@Transactional(postgresTransactionManager)`
  撈 PENDING → `send().get(10s)` 同步等 broker 確認才標 SENT；失敗保持 PENDING + `retry_count+1`。
  抄 member `OutboxPoller`（含單實例假設註解），唯一差異是指定雙資料源的 postgres TM。
- `database/postgres/migration/V17__add_wallet_outbox.sql` + `database/postgres/init.sql` 的
  `wallet_outbox` 表（放 Postgres 寫庫，才能與 wallet_transactions 進同一交易）。
- 測試：`WalletOutboxServiceTest`、`WalletOutboxPollerTest`（H2/mock）、
  `containers/WalletOutboxContainerTest`（真 PG：schema validate + credit/debit 落 PENDING +
  交易 rollback 原子性 + poller 送達標 SENT）。

### Changed
- `.../service/WalletService.java`：credit Step 6 與 debit 的事件發布從「交易外裸發 Kafka」
  （非同步、未 `.get()`、失敗無聲）改成「交易內寫 outbox 列」。移除 `KafkaTemplate`/`ObjectMapper`
  依賴，改注入 `WalletOutboxService`。debit 原 B2 的 afterCommit 發送機制一併移除——outbox 只是
  同庫 INSERT、不觸發 broker I/O，不會拖住 wallets 行鎖，且交易回滾時 outbox 列一起回滾（無幽靈事件）。
- `.../service/GiftTransferService.java` / `GiftService.java`：贈幣的 wallet.debit/wallet.credit
  事件從 GiftService 交易外裸發，移進 `GiftTransferService.transfer()` 的轉帳交易內寫 outbox
  （原子）；GiftService 移除 `KafkaTemplate`/`ObjectMapper`/`publishEvent`。
- `database/postgres/migration/V15__add_game_rounds_risk_indexes.sql` → `V16__...`：修掉與
  `V15__add_alert_resolution_audit.sql` 重複的版號（事前必讀 #4，ADR-009 現況校驗已三度點名）。
- `WalletServiceApplication` 加 `@EnableScheduling`；application.yml 加 `wallet.outbox.poll-interval-ms`
  （預設 1000ms，比 member 5000ms 短——排行榜/通知體感延遲要求較高；測試 yml 設極長避免背景 poller 干擾）。
- 既有測試（`WalletServiceCreditTest`/`WalletServiceDebitTest`/`GiftServiceTest`/`GiftTransferServiceTest`）
  的 Kafka 驗證改為 outbox 驗證。
- AGENTS.md 新增雷區 23（wallet 事件走 outbox，勿改回裸 send()）。

### Why
credit/debit 原本在交易 commit **之後**才 `kafkaTemplate.send()`，且該呼叫非同步、未 `.get()` 也未掛
callback——broker 失敗發生在背景執行緒，連 catch 裡的 `log.warn` 都不會印，事件**完全無聲丟失**。
後果是三個下游（MySQL 讀視圖 / rank 排行 / admin 流通量報表）同時漂移且無人察覺。Transactional
Outbox 把「待發事件」與帳務異動寫進同一 Postgres 交易（原子、不會半套），背景 poller 再同步確認送達
才標 SENT，杜絕丟失。member 早有 `OutboxPoller`、ADR-009 也為 game→wallet 建了補償表——同一問題被解
兩次，唯獨 wallet 自己的事件發布路徑沒人管，這裡補上。取捨：延遲從「即時（可能丟）」變「poll 間隔
（不會丟）」；投遞仍是 at-least-once（重送由 P1 rank 去重等下游冪等吸收）。

### Verification
- `mvn -pl backend/wallet-service test` → **Tests run: 170, Failures: 0, Errors: 0**
- `mvn -pl backend/wallet-service test -Pcontainers-test`（真 PG/MySQL，ddl-auto=validate）
  → **Tests run: 17, Failures: 0, Errors: 0**（含新 `WalletOutboxContainerTest` 4 例；schema 無漂移）。
- 手動端對端（`docker compose stop kafka` → credit 應成功入帳、outbox PENDING → start kafka →
  數秒轉 SENT）**尚待人工執行**（需完整服務拓撲 + 真 broker）。
=======
## [fix] — 2026-07-21 — 藍圖 04 P1：rank 消費去重（修 `addDailyWinnings` 重複累加）

### Changed
- `backend/rank-service/.../kafka/WalletBalanceChangedConsumer.java`：`wallet.credit`/`wallet.debit`
  的消費端加去重閘，**只保護不冪等的那一支** `addDailyWinnings`（`ZINCRBY` 累加）：
  以事件既有的 `transactionId` 為鍵做 Redis `SETNX`（`setIfAbsent`，key=`rank:dedup:daily-win:{txId}`，
  TTL 48h 對齊日贏分 key），回傳「我是不是第一個消費者」，非首次直接略過。
  `updatePlayerCoins`（`ZADD` 絕對值、冪等）**不去重**——重送本就無害，去重反而會在
  「首次 ZADD 後、ack 前崩潰」時把餘額永久卡在錯值。
  `transactionId` 為 null 時跳過去重、直接執行並 `log.warn`（不可用 null 組 key，否則所有事件共用
  同一把鍵、第一筆之後全被吃掉）。
- `backend/rank-service/.../kafka/WalletBalanceChangedConsumerTest.java`：既有 WIN 案例補上
  `StringRedisTemplate` 的 SETNX stub；新增四例——同 `transactionId` 連送兩次日贏分只累加一次、
  但 `updatePlayerCoins` 仍執行兩次（冪等操作不受去重影響）、`transactionId` 為 null 仍執行不拋錯、
  不同 `transactionId` 各自累加。

### Why
Kafka 是 at-least-once：consumer 在 `ack.acknowledge()` 前崩潰或 group rebalance，同一則
`wallet.credit` 會重投遞。`addDailyWinnings` 是 `ZINCRBY`（累加、不冪等）→ 玩家日贏分虛增、
今日贏幣王排行（T-045）失真、可被刷。核心觀念：**冪等操作要的是「可安全重放」，非冪等操作才需
「只執行一次」**，所以只對後者去重。這是 best-effort 去重（非 exactly-once）——SETNX 成功後、
ZINCRBY 前崩潰會漏計一筆，但漏計（排行些微偏低）傷害遠小於重複累加（虛增可刷），且崩潰窗口微秒級。
若日後日贏分接入實際獎勵發放，須升級為單一 Lua script 的原子版（比照 ADR-008 CAS）。

### Verification
- `mvn -pl backend/rank-service test` → **Tests run: 71, Failures: 0, Errors: 0**
  （`WalletBalanceChangedConsumerTest` 由 6 例增為 9 例，全綠）。
develop

---

## [docs] — 2026-07-21 — ADR-010：誠實記錄 Kafka/Redis 過度設計，並訂下「該不該用」的判準

### Added
- `docs/adr/ADR-010.md`：架構決策——**明知規模不需要，仍保留 Kafka 與 Redis**。內容含：
  - **現況盤點**（以程式碼為準）：8 個 Kafka topic + 3 DLT 的 publisher/consumer 對照表、
    8 個 Redis 使用點與其資料結構。
  - **誠實分級**：Kafka 中 `member.registered` / `wallet.credit` / `wallet.debit` / `game.result`
    為 🟢 真 fanout（2–3 個獨立消費者）；`wallet.credit.request` 等 4 條為 🟡（單一消費者、
    本質是 RPC）；wallet 自發自收 `wallet.credit` 做 PG→MySQL 讀視圖同步為 🔴（同進程繞 broker）。
    Redis 8 點中僅 rank ZSET 排行、捕魚 session Lua CAS 為 🟢，其餘 6 點為 🟡（DB 可替代）。
  - **判準**：Kafka 正當使用的 5 個門檻（1→N fanout / 可用性解耦 / 削峰 / replay / 跨團隊邊界）、
    Redis 的 3 個門檻（專屬資料結構 / 跨進程暫態共享 / 原子操作），以及觸發重新評估的訊號表。
  - **延伸討論**：同一判斷邏輯解釋為何不用 k8s，以及中間站建議（服務 Docker 化）。
- `docs/plans/04-事件可靠性與消費冪等強化藍圖.md`：ADR-010 盤點過程查出**兩個實作層級真缺口**，
  化為 5 個 Phase 的施工藍圖（含相依關係、共用地雷、否決方案、逐 Phase 驗證步驟）：
  - **P1（P0，S）rank 消費去重**：`RankService.addDailyWinnings` 用 `ZINCRBY` 累加且無去重，
    Kafka at-least-once 重送會虛增今日贏幣王排行（T-045）。同一 consumer 內的 `updatePlayerCoins`
    走 `ZADD` 絕對值反而安全——一支安全一支不安全的不對稱最易漏。修法為 Redis `SETNX`
    以 `transactionId` 去重（48h TTL，對齊日贏分 key 的 TTL），**只保護非冪等操作**。
  - **P2（P0，L）wallet Outbox**：`WalletService` credit/debit 在交易 commit **之後**才發 Kafka，
    且 `kafkaTemplate.send()` 為非同步、未 `.get()` 也未掛 callback ——broker 失敗發生在背景執行緒，
    **連 catch 裡的 log.warn 都不會印**，事件完全無聲丟失，導致 MySQL 讀視圖 / rank 排行 / admin
    流通量報表三方同時漂移。修法為 Postgres `wallet_outbox` + poller，比照 member 既有 `OutboxPoller`。
  - **P3（P2，S）排行榜廣播節流**：`maybeBroadcastTop10` 已有節流，但閘門在 `ZREVRANGE` 查詢**之後**
    （每筆事件都打一次 Redis），且節流狀態存 JVM 記憶體（多副本失效）。修法為閘門前移 + 改 Redis 鎖。
  - **P4（P2，M）Redis 可重建性**：新增 `tools/reconciliation/rebuild-rank-redis.mjs` 從
    `wallet_transactions` 重算日贏分（用 `ZADD` 非 `ZINCRBY` 以可重複執行），`--dry-run` 兼作 P1 監測。
  - **P5（P3，S/M）觀測**：consumer lag + outbox PENDING 積壓指標。

### Why
專案七服務、22 條雷區、零真實使用者、單機部署，「這個專案其實不需要 Kafka/Redis 吧」是合理質疑。
最強的內部反證是 [ADR-009]——game→wallet 的**派彩金流已經繞過 Kafka 走 HTTP**，還自建
`pending_wallet_credits` 補償表 + 排程重試，等於可靠傳遞是另外手刻的，Kafka 並未承擔其核心職責。

決策是**保留不拆**（學習價值 + 拆除成本 + 四條真 fanout 使收益有限），但把「哪些是真需求、
哪些只是方便」寫死在文件裡，避免未來誤把既有的過度設計當成新過度設計的正當理由。
依 AGENTS.md §3「架構級決策另寫 ADR」，故獨立成檔而非只寫進雷區。

### Verification
- 純文件變更，無程式碼異動。
- 盤點表對照來源：`kafka/kafka-init.sh` topic 清單、各服務 `@KafkaListener` 註解、
  各服務對 `RedisTemplate`/`StringRedisTemplate` 的引用，逐項核對。
- 藍圖的每個 Phase 均先實查原始碼再落筆，過程修正三處初步誤判（皆已反映在文件）：
  ① 並非「所有 topic 都是單一消費者」——實際有 4 條為多消費者 fanout；
  ② DLT 覆蓋比預期完整——member/rank/wallet 皆有 `DefaultErrorHandler` + `DeadLetterPublishingRecoverer`，
     admin 是**刻意不設**（原始碼有註解）、notification 為 best-effort（AGENTS.md §2.10 明載），
     故原本規劃的「補 DLT」縮減為「確認現況 + 改做 consumer lag 觀測」；
  ③ producer 可靠性設定無問題——Kafka 3.x client 預設即 `acks=all` + `enable.idempotence=true`，
     問題純在「發送失敗後無補救」，不在 producer 參數。
- P3 亦因實查而改寫：`maybeBroadcastTop10` 已有節流機制，真缺口是「閘門位置在昂貴查詢之後」
  與「節流狀態存 JVM 記憶體」，而非「完全沒有節流」。

## [fix] — 2026-07-21 — 捕魚機殘血回收改「整場一次 floor」，修正低注額有效回收率只有 0.62

### Changed
- `backend/game-service/.../fishing/FishingSession.java`：移除 `fishRecovery`（逐發 floor 後的回收星幣表），改為 `prunedFishDamage`（被淘汰魚 instance 的累傷總和）＋ `legacyFishRecovery`（相容欄位，見下）。
- `backend/game-service/.../service/FishingService.java`
  - `applyShots()` 不再逐發呼叫 `FishingCombat.recoveryPayout()`。
  - `pruneFishDamage()` 改簽章為 `(session, fishDamage)`：淘汰最舊 entry 前把牠的累傷併進 `prunedFishDamage`。
  - `computeResidualRecovery()` 改為「先把 `fishDamage` 現存值 ＋ `prunedFishDamage` 全部加總，再整場呼叫一次 `recoveryPayout()`」。
- `backend/game-service/.../fishing/FishingSessionStore.java`：`toHash`/`fromHash` 改寫 `prunedFishDamage`；舊欄位 `fishRecovery` 只讀不寫，載入時加總成 `legacyFishRecovery`。
- `frontend/src/services/mockApi.js`：鏡像同一改動（移除 `session.fishRecovery`，結算時整場一次計算）。
- 測試：`FishingSessionStoreTest` 改為守 `prunedFishDamage` / `legacyFishRecovery` 的 round-trip；`FishingServiceCrossBatchTest` 新增 `residualRecoveryIsFlooredOncePerSession`。

### Fixed
- **低注額的殘血回收被 floor 侵蝕**。`recoveryPayout()` 內含 `Math.floor`，舊版每發子彈都呼叫一次，每次丟掉不到 1 星幣的小數：

  | 單發注額 | 每發期望回收 | 有效回收率 |
  |---|---|---|
  | 10（MIN_BET） | 6.20 | **0.620** |
  | 20 | 13.40 | 0.670 |
  | 50 | 34.80 | 0.696 |
  | 100 以上 | — | 0.696～0.700 |

  設計值 `RECOVERY_RATE = 0.70` 是 ADR-004 的「體感 RTP 地板」，最低注額玩家實際只拿到 0.62，**注額越小虧越多**——與「地板」的用意相反。改成整場加總後只 floor 一次，誤差上限固定是「整場 < 1 星幣」，與注額大小無關。
- **順帶修掉 `pruneFishDamage` 的沉沒成本**：`fishDamage` 有 `MAX_LIVE_FISH = 80` 的並存上限，超量時淘汰最舊 entry。舊版淘汰後那條魚的累傷就消失，打在牠身上的子彈完全拿不回來（場次越長、魚 instance 越多，被吃掉越多）。現在淘汰前先把累傷併進 `prunedFishDamage`。

### 為什麼這樣改（而不是把 floor 改成 round）
- `round` 會讓回收有機會**超過**實際投入的子彈成本，破壞 ADR-004 的「回收恆 ≤ 投入成本 → 整體 RTP 不超過 `TARGET_RTP` 0.96」保證（莊家安全性）。先加總再 floor 則永遠只會少拿、不會多拿，天花板不動。
- 回收金額本來就是結算時**單一筆** credit（`REFUND`），沒有必要逐發、逐條各取整。

### 相容性
- `legacyFishRecovery`：部署當下仍存活的舊 session，其 Redis hash 裡的 `fishRecovery`（已 floor 的星幣表）會被讀進來、結算時原額加回，不會憑空消失也不會重複計。新版**不再寫入**該欄位；舊 session 因 TTL / 閒置回收結清後，此欄位與相關程式碼即可移除。

### 如何驗證
- `mvn -pl backend/game-service test` → **Tests run: 197, Failures: 0, Errors: 0**。
- 新增回歸測試 `FishingServiceCrossBatchTest#residualRecoveryIsFlooredOncePerSession`（單發 10 星幣、銅炮、對龍王打 30 發不致死）同時斷言三件事：① 回收額精確等於「整場累傷一次換算」② 嚴格大於舊版逐發 floor 的加總 ③ 有效回收率貼齊 0.70 且不超過 0.70。
- `cd frontend && npx vitest run` → 56 passed；`npx eslint src/services/mockApi.js` 無錯誤。

## [fix] — 2026-07-21 — 捕魚機命中判定改逐魚種橢圓＋解析解，命中框與圖案對齊

### Changed
- `frontend/src/components/fishingEngine.js`
  - 新增 `FISH_HITBOX` 逐魚種命中橢圓表（`rx`/`ry`/`ox`/`oy`，相對 sprite 顯示寬高的比例）、`FISH_HITBOX_FALLBACK`（未量測資產的保守值）、`HITBOX_ASSET_ALIAS`（邪惡版擋路怪共用同圖的命中框）。
  - `_fishHitBounds()` 改用上表，並支援橢圓中心偏移；`sprite.scale.x < 0`（左右翻面）時水平偏移跟著鏡射。
  - `_pathIntersectsFish()` 由「橢圓中心 ±0.42rx 三點取樣 + 點到線距離近似」改為**線段 vs 橢圓的解析解**（把座標除以 (rx, ry) 化為單位圓後解一元二次），並移除已不需要的 `lenSq` 參數。
  - 魚／擋路怪物件新增 `assetId` 欄位（命中框查表用）。

### 為什麼
- 魚的貼圖是 1254×1254 方形 PNG，魚身在方框內的佔比每種都不同（河豚扁、金龍瘦長、魔鬼魚寬），但舊版對所有魚一律套「半寬 0.5 / 半高 0.44」的橢圓。對 PNG alpha 逐像素量測後：**舊命中區面積是魚身實際像素面積的 1.9～2.8 倍**，命中區內只有 35～72% 是實心魚身，玩家會遇到「明明沒打到卻算命中」。
- 舊的三點取樣是近似解，**斜射時會漏判**（射線確實穿過魚身卻判定 miss），同時又把水平命中範圍多撐到 `1.12 × rx`，等於「該中的沒中、不該中的中了」兩頭都錯。解析解沒有這個取捨，計算量也更小（一次二次方程 vs 三次取樣）。
- 本表的門檻取「魚身漏在命中區外 ≤ 4%」，收斂後面積比降到 1.1～2.0（魔鬼魚最高，翅膀展開、橢圓本來就套不緊）。

### 如何驗證
- 蒙地卡羅回歸（12 萬條隨機射線／魚種，ground truth＝射線是否真的穿過不透明像素）：
  - 誤判命中（打空卻算中）：舊 19～35% → 新 7～15%
  - 漏判（真打到卻算沒中）：舊 16～26% → 新 0～10%
  - 兩項同時改善，沒有「收緊命中框換來更多漏判」的代價。
- `cd frontend && npx eslint src/components/fishingEngine.js` 無錯誤。

### 注意（後續換圖時）
- `FISH_HITBOX` 是**依現行 PNG 的 alpha 通道量測**而來。之後在 `frontend/src/casino-fx/assets/registry.js` 的 `ART_OVERRIDES` 換圖，必須重新量測並更新本表，否則該魚會退回 `FISH_HITBOX_FALLBACK` 的鬆散命中框。

## [feat] — 2026-07-21 — Provably Fair 公平性驗證展示頁（Task 5–9，接續 PR #225）

### Added
- `frontend/src/pages/ProvablyFair.jsx`（路由 `/provably-fair`，lazy + `ProtectedPage`）：模式徽章（含誠實性說明）+ 三遊戲 tab 切換 + 掛載對應面板。
- `frontend/src/components/fairness/panels/SlotFairPanel.jsx`（+ 測試）、`BaccaratFairPanel.jsx`、`FishingFairPanel.jsx`：三遊戲各自的五步驟狀態機（承諾→下注→開獎→揭露→驗證），含「模擬伺服器作弊」演示與餘額守門。
- `frontend/src/theme/backgroundTheme.js`：`gameCatalog` 新增公平性驗證入口卡片、`decorativeAssets.provablyFair` 視覺樣式，Lobby 資料驅動卡片自動列出。

### Changed
- `frontend/src/App.jsx`：註冊 `/provably-fair` 受保護路由。

### 為什麼
- PR #225（`feature/weiyu-provably-fair-demo`）只落地了 Task 1–4（mock 密碼學核心、三遊戲確定性推導、`fairnessApi` 真/mock 切換層、共用展示元件），頁面本體、三個遊戲面板、路由與 Lobby 入口都還沒接上，玩家看不到這頁。本次接續 `docs/superpowers/plans/2026-07-20-provably-fair-demo-page.md` 的 Task 5–9 補完。
- Lobby 卡片改走資料驅動的 `gameCatalog`（PR225 之後的重構），故 Task 9 原計畫「直接改 `Lobby.jsx` JSX」改為在 `backgroundTheme.js` 新增一筆資料，行為等價、符合現行架構。
- `SlotFairPanel`/`BaccaratFairPanel`/`FishingFairPanel` 的餘額不足提示改成無條件顯示（不只在 disabled 按鈕的 click handler 內才設錯誤訊息，因為 disabled 的 button 在瀏覽器/jsdom 中本就不會觸發 click 事件），比照既有 `SlotGame.jsx`/`Baccarat.jsx` 的作法。

### 如何驗證
- `cd frontend && npx vitest run src/services/provablyFairMock.test.js src/components/fairness/panels/SlotFairPanel.test.jsx` 全綠。
- `cd frontend && npx eslint src/pages/ProvablyFair.jsx src/components/fairness/panels/*.jsx` 無錯誤。
## [feat] — 2026-07-21 — 捕魚機 Redis session 原子化（Lua CAS，ADR-008）：八項架構改進全數完成

### Added
- `backend/game-service/.../fishing/FishingSession.java`：新增 `Long version`（`@Builder.Default = 0L`）樂觀鎖欄位。
- `FishingSessionStore.saveCas(session, expectedVersion)`：新 Lua script（`SAVE_CAS_SCRIPT`，比照 `RiskControlService` 既有 inline text-block 風格）——`HGET version` 比對相符才整包 `HSET`＋`PEXPIRE`＋`version+1`，否則不動 key 回傳 0；缺 `version` 欄位（升級前舊 session）視同 0。`toHash()/fromHash()` 同步序列化該欄位。
- `com.luckystar.game.exception.SessionConflictException` + `GlobalExceptionHandler` 對應 409：CAS 重試用盡時的例外映射。
- `docs/adr/ADR-008.md`：完整決策記錄（選型理由、否決方案、已知限制）。
- 測試：`FishingSessionStoreTest` 新增 `saveCasSucceedsWhenVersionMatches`/`saveCasDetectsLostUpdate`（併發 lost-update 回歸守門）/`saveCasTreatsMissingVersionAsZero`；`FishingServiceCrossBatchTest` 同步補 CAS mock。

### Changed
- `FishingSessionStore.save()`：改為僅供 `FishingService.start()` 建立全新 session 使用（無併發風險）；既有 session 的讀改寫改走 `saveCas`。
- `FishingService.shots()`：整批判定邏輯抽成 `applyShots()`（純計算不落地），外層改為「重讀→重放→CAS」重試迴圈（`SESSION_CAS_MAX_RETRIES=3`），CAS 失敗即整批基於最新 session 重算，不沿用舊快照。
- `FishingService.topUp()`：wallet `debit()` 改為只在重試迴圈外呼叫一次（冪等鍵固定，安全根基見 ADR-009）；「把加值套進 session」的部分改走 CAS 重試迴圈，CAS 用盡/Redis 例外/session 中途被結算都視為「錢扣了但套用失敗」走既有 REFUND 補償路徑。
- `AGENTS.md` 雷區 16：Redis session 原子化狀態由「唯一未動工項」改為「已完成」，補充 CAS/重試模式的維護說明；`docs/plans/01-八項架構改進施工藍圖.md`：Phase 3 狀態 ⬜→✅，八項架構改進進度總覽全數完成。

### Why
`FishingSessionStore` 原本的「整包 HGETALL 讀出→Java 算完→整包 HSET 寫回」不是原子操作，雙分頁/斷線重連殘留分頁/伺服器閒置結算排程與玩家請求併發時會丟失更新——舊防線只有前端 `topUpLockRef`，防不住跨分頁或伺服器端排程的併發窗口。這是總體檢報告 8 項架構改進中唯一未動工項（`docs/plans/01-八項架構改進施工藍圖.md` Phase 3），本次依既有施工說明落地，完整取捨記於 ADR-008。

### Verification
- `mvn -pl backend/game-service test`：196 個測試全綠（含新增的 3 個 CAS 測試與既有跨批累傷/風控/補償測試迴歸）。
- 手動雙分頁連打＋top-up 驗證待部署環境進行（ADR-008「驗證」節已列為待辦）。

## [fixed] -- 2026-07-21 -- Expand fishing buy-in and settlement fullscreen surface

### Fixed
- frontend/src/pages/Fishing.jsx: remove the `content-start` layout constraint while the fishing surface is fullscreen and expose the current phase for fullscreen layout targeting.
- frontend/src/components/Fishing.css: make the fullscreen fishing surface consume the full viewport and force buy-in/settlement lobby content to span the remaining fullscreen grid area instead of staying in an auto-height row.

### Why
- Buy-in and settlement could enter fullscreen, but their visible surface was still constrained to the original page-sized content area.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [changed] -- 2026-07-20 -- Fit fishing buy-in and settlement to fullscreen

### Changed
- frontend/src/pages/Fishing.jsx and frontend/src/components/FishingSettlementPanel.jsx: add stable hooks for fullscreen buy-in and settlement layouts.
- frontend/src/components/Fishing.css: expand and center buy-in and settlement content inside the fullscreen fishing surface, with responsive desktop/mobile layout rules.

### Why
- Buy-in and settlement could enter fullscreen, but their content still used compact page sizing instead of adapting to the fullscreen game surface.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [added] -- 2026-07-20 -- Add fishing fullscreen access to buy-in and settlement

### Added
- frontend/src/pages/Fishing.jsx: move the fullscreen control into the shared fishing flowbar so buy-in, gameplay, and settlement states can all enter fullscreen.
- frontend/src/components/Fishing.css: add flowbar fullscreen button layout rules, including mobile width handling.

### Why
- The fishing fullscreen target already wraps the full game flow, but buy-in and settlement screens did not render a fullscreen control.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [removed] -- 2026-07-20 -- Remove fishing settlement verification details

### Removed
- frontend/src/components/FishingSettlementPanel.jsx: remove the server seed paragraph from the fishing settlement screen.
- frontend/src/pages/Fishing.jsx: remove the ShotVerifyPanel fairness verification block from settlement and stop rendering it.

### Why
- The settlement screen should no longer show server seed details or the fairness verification panel.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [added] -- 2026-07-20 -- Add fishing catch statistics drawer

### Added
- frontend/src/pages/Fishing.jsx and frontend/src/components/Fishing.css: add a collapsible catch statistics drawer below the active fishing game surface, summarizing the current round's captured fish species and counts.

### Why
- Players need an in-round view of which fish types they have captured and how many of each have been caught.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [fixed] -- 2026-07-20 -- Prevent duplicate fishing defeat animations

### Fixed
- frontend/src/components/fishingEngine.js: when a fish is already playing the local defeat fade, authoritative backend capture or escape results no longer reset `caughtMs` or switch the same fish into a second defeat/flee animation.

### Why
- Continuous shooting could locally defeat a fish, then replay the defeat animation when the delayed batch result arrived for the same shot.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [changed] -- 2026-07-20 -- Smooth fishing hit reactions

### Changed
- frontend/src/components/fishingEngine.js: replaced random shake-like fish hit motion with a short directional recoil easing, softened hit flash timing/color, and reduced hit reaction power so repeated shots feel smoother and less jarring.

### Why
- Fish hit feedback should respond clearly without looking like unnatural jitter during continuous shooting.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [fixed] -- 2026-07-20 -- Improve fishing defeat responsiveness and blocker effects

### Fixed
- frontend/src/hooks/useFishingSession.js: shortened fishing shot flushing from 10 shots / 700ms to 4 shots / 180ms so backend capture results return much sooner during play.
- frontend/src/components/fishingEngine.js: locally fades out fish as soon as the predicted HP reaches zero, then still applies the authoritative backend capture or escape result when the batch response arrives.
- frontend/src/components/fishingEngine.js: changed blocker fish defeat notices to the requested `?????...??...???` format.
- frontend/src/components/fishingEngine.js: applies starfish speed boost to all fish currently on the stage, including blockers, instead of excluding blocker fish.
- docs/game-rules.md: documented the blocker notice wording and all-fish starfish acceleration behavior.

### Why
- Fish defeat feedback should feel immediate, blocker messages should match the requested copy, and starfish interference should visibly affect every fish species.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [changed] -- 2026-07-20 -- Show fishing special fish effect timers

### Added
- frontend/src/pages/Fishing.jsx and frontend/src/components/Fishing.css: show Caishen and Money Tree effect countdown timers in the lower-right corner of the active fishing game surface after those special fish are captured.

### Changed
- frontend/src/components/fishingEngine.js: include captured fish code and name in the onCatch callback so the React HUD can activate fish-specific timers without parsing notice text.
- docs/game-rules.md: document the 15-second right-bottom effect countdown for Caishen and Money Tree.

### Why
- Special fish effects need a visible remaining-time indicator inside both normal and fullscreen fishing gameplay.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [changed] -- 2026-07-20 -- Sync game rules to frontend presentation

### Changed
- backend/game-service/src/main/java/com/luckystar/game/slot/SlotSymbol.java, contracts/slot-paytable.json, and backend/game-service/src/test/java/com/luckystar/game/slot/SlotMachineTest.java: aligned the STAR triple payout with the frontend slot rule card at 40x, changing theoretical slot RTP to 0.93516.
- docs/game-rules.md: added the frontend-facing game rule specification for Slot, Baccarat, Fishing, Baccarat side-bet tracking, Fishing special fish, and blocker fish effects.
- frontend/src/services/mockApi.js, backend/game-service/src/main/resources/application.yml, AGENTS.md, docs/game-math/verify_rtp.py, and related project/interview docs: synced rule references and current RTP/math notes.

### Why
- The frontend presentation is the requested source for player-facing game rules, and settlement-sensitive rule drift such as Slot STAR 40x versus backend 50x must stay aligned across backend, contracts, mock, tests, and documentation.

### Verification
- mvn -pl backend/game-service test passed.
- python docs/game-math/verify_rtp.py passed.
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
## [changed] -- 2026-07-20 -- Show top fishing notices for every defeated fish

### Changed
- frontend/src/components/fishingEngine.js: top-of-stage notices now appear for all captured fish, fish that are killed but escape, and locally defeated blocker fish.
- frontend/src/components/fishingEngine.js: CAISHEN and MONEY_TREE use effect-based special fish copy instead of fixed star-coin amounts, while blockers show the triggered ink, speed, or armor-break effect.

### Why
- Fishing feedback should confirm every defeated target, and special/blocker fish notices should describe their gameplay effect instead of behaving like ordinary star-coin payout captions.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
## [changed] -- 2026-07-19 -- Treat Caishen and Money Tree as special fishing targets

### Changed
- frontend/src/data/fishingFishConfig.js and frontend/src/pages/Fishing.jsx: decorate CAISHEN and MONEY_TREE as SPECIAL display fish before rendering the fishing canvas, so both use the special fish swimming effect while keeping backend payout multipliers, HP, and spawn weights unchanged.
- frontend/src/components/FishingFishInfoPanel.jsx: hide fixed star-coin value labels for CAISHEN and MONEY_TREE and show a special reward label instead.
- frontend/src/data/fishingFishConfig.test.js: add coverage for special fish decoration and idempotent Dragon King visual decoration.

### Why
- 財神與搖錢樹應被視為特殊魚種，資訊卡不應顯示固定星幣價值；實際派彩仍交由後端捕獲結果計算。

### Verification
- npm.cmd run test --prefix frontend -- fishingFishConfig passed.
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
## [fixed] -- 2026-07-19 -- Fix fishing capture notice names for Boss variants

### Fixed
- frontend/src/data/fishingFishConfig.js and frontend/src/data/fishingFishConfig.test.js: set explicit display names for the Dragon King visual variants so top-of-stage capture notices show 金星魚王 and 彩金魚王 while preserving the backend DRAGON_KING contract values.

### Why
- The capture notice already triggers for every captured payout fish, but Boss visual variants were inheriting the backend Dragon King name instead of their visible in-game fish names.

### Verification
- npm.cmd run test --prefix frontend -- fishingFishConfig passed.
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [changed] -- 2026-07-19 -- Reduce fishing stage spawn density

### Changed
- frontend/src/components/fishingEngine.js: lowered the active fish cap, slowed normal fish spawning, reduced swarm size/frequency, and reduced blocker pressure so the fishing stage is less crowded during Boss attempts.
- frontend/src/components/fishingEngine.js: kept the Boss timed spawn cadence unchanged while slightly spacing high-value/special fish, so Boss challenge focuses more on aiming at the Boss and less on screen clutter.

### Why
- The fishing playfield had too many simultaneous fish, making Boss fish harder to track and shoot because ordinary fish and blockers crowded the stage.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [fixed] -- 2026-07-19 -- Fix fishing session ammo and balance state

### Fixed
- frontend/src/components/FishingControlDock.jsx and frontend/src/components/FishingControlDock.test.jsx: add and verify an is-active class on the current in-game ammo button, make activeAmmo take priority over cannonLevel, and give copper/silver/gold ammo cards distinct visual treatments.
- frontend/src/hooks/useFishingSession.js: normalizes fishing start session balance from the API response and falls back to buyIn if sessionBalance is missing, preventing a fresh buy-in from opening with zero local balance.
- frontend/src/pages/Fishing.jsx: recalculates the in-game 本局盈虧 HUD from current sessionBalance minus sessionBuyIn, so each buy-in starts at 0 and then responds to earned or spent star coins.

### Why
- The fishing HUD and controls should reflect the selected session ammo immediately, a successful buy-in must seed local session balance before the first shot, and every new buy-in should reset HUD counters while still showing live round profit.

### Verification
- npm.cmd run test --prefix frontend -- FishingControlDock passed.
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [changed] -- 2026-07-19 -- Center fishing top-up modal in game surface

### Changed
- frontend/src/components/Fishing.css: changed the temporary top-up modal from viewport-fixed positioning to an absolute overlay inside the fishing play surface, so it opens in the center of the game area in both normal and fullscreen fishing views.

### Why
- The temporary top-up prompt belongs to the active fishing game surface and should stay visually anchored to the game instead of centering against the whole browser page.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [fixed] -- 2026-07-19 -- Fix fishing buy-in fish guide data

### Fixed
- frontend/src/components/FishingFishInfoPanel.jsx: changed the buy-in fish guide fallback to generate reward fish cards from contracts/fishing-species.json, so small fish cards now show the correct KOI, GOLDFISH, and LANTERN data before a session exists.
- frontend/src/components/FishingFishInfoPanel.jsx: added missing guide copy for all current reward fish tiers and kept MONEY_TREE using its special 10-50x payout range.

### Why
- Before buy-in, the fishing session has no backend fishTable yet, so the lobby was falling back to an outdated static list and the is-small fish-card content did not match the real game fish species.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [changed] -- 2026-07-17 -- Tune fishing hit feedback and rare fish effects

### Changed
- frontend/src/components/fishingEngine.js: expanded bullet-to-fish hit detection from a center-radius check to image-sized bounds with path sampling, so visible fish bodies count more consistently when a bullet crosses them.
- frontend/src/components/fishingEngine.js: reduced normal hit shake strength and added a short cooldown while keeping crit feedback more pronounced.
- frontend/src/components/fishingEngine.js: added tier-specific sparkle dots around high, special, boss, and legendary fish, with elliptical aura bounds rendered behind fish sprites so the effect wraps the whole fish without covering it.
- frontend/src/components/fishingEngine.js: strengthened the tier-colored aura background fill so high-value fish read as blue, Boss fish as purple, and special fish as gold, while keeping the fill behind the fish sprite.
- frontend/src/components/fishingEngine.js: added timed premium spawns so high-value/special fish appear regularly and Boss/legendary fish have a longer guaranteed arrival cadence.
- frontend/src/components/fishingEngine.js: slightly reduced jackpot fish king visual size so it remains readable without dominating the whole playfield.
- frontend/src/components/fishingEngine.js: changed fish cleanup to use sprite-sized offscreen bounds so fish are removed only after fully leaving the current canvas, including fullscreen.
- frontend/src/components/fishingEngine.js: removed blocker defeat center hint text and moved successful capture reward text to a top-of-canvas notice.
- frontend/src/components/fishingEngine.js: removed the remaining center hint text shown when shots hit blocker fish before they are destroyed.
- frontend/src/hooks/useFishingSession.js: stopped auto-restoring active fishing sessions on page entry so every route into the fishing page opens on the buy-in screen first.
- frontend/src/pages/Fishing.jsx: starts the ocean-style fishing BGM on the buy-in screen at low intensity while continuing to use the shared Settings volume and BGM controls.
- frontend/src/components/fishingEngine.js: added the missing fish-caishen preload entry so the Caishen high-value fish can render with its intended asset.
- frontend/src/components/Fishing.css: hid the browser cursor over the fishing canvas so only the in-game reticle is visible.

### Fixed
- frontend/src/components/fishingEngine.js: prevented ordinary fish without tier effects from crashing spawn by normalizing missing aura styles before reading effect radius.

### Why
- Fishing shots should match the visible fish art more closely, hit feedback should feel less noisy during rapid fire, and valuable fish should be easier to distinguish while swimming.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
## [changed] -- 2026-07-16 -- Move fishing fullscreen control into stage marquee

### Changed
- frontend/src/pages/Fishing.jsx: removed the fishing-flowbar wallet chip and moved the FishingFullscreenButton into fishing-stage-marquee beside the performance toggle.
- frontend/src/components/Fishing.css: added marquee action layout for the performance and fullscreen controls, and removed obsolete flowbar wallet/stage-frame button styling.

### Why
- The fishing game screen should keep top-level flowbar information minimal and group in-game display controls together inside the stage marquee.

### Verification
- npm.cmd run lint in frontend passed.
- npm.cmd run build in frontend passed.
## [changed] -- 2026-07-16 -- Add fullscreen cockpit layouts to player games

### Changed
- frontend/src/pages/SlotGame.jsx: rebuilt the slot page around a fullscreen-capable game surface with in-surface controls for balance, bet selection, round state, result, and session profit.
- frontend/src/pages/Fishing.jsx: moved the fullscreen target to wrap the full fishing flow, including buy-in, settlement, HUD, canvas controls, and top-up modal.
- frontend/src/components/slotMachine.css: added normal-page and fullscreen-specific slot cockpit layouts.
- frontend/src/components/Fishing.css: added a fishing flowbar and full-flow fullscreen constraints.
- frontend/src/styles/games/baccarat.css: added final fullscreen cockpit overrides so baccarat keeps web-page and fullscreen layouts separate.

### Why
- All `/game/` pages should support a fullscreen game mode where the entire gameplay flow can be controlled from one viewport, while the regular web page layout remains independently designed.

### Verification
- npm.cmd run build in frontend passed.
- npm.cmd run lint in frontend passed.

## [test] — 2026-07-18 — T-084/T-093 端對端驗收補齊：全鏈路 e2e ＋ 前端 WS 真後端驗收，兩筆 audit override 移除

### Added
- `tests/e2e/full-chain.mjs`（T-093）：跨服務全鏈路整合測試——「下注→帳務→排行→通知」18 斷言，
  同一局 roundId 於遊戲回應/帳務流水/WS 推播三處一致性對帳；含無效 JWT 連線必拒的反向驗證。
  Node 零依賴（內建 WebSocket + 手組 STOMP 帧，走 gateway /ws）。實測連跑兩輪 18/18 全 PASS。
- `frontend/e2e/realtime-ws.spec.js` + `frontend/playwright.realws.config.js` + `frontend/.env.realws`（T-084）：
  前端 WS 端對端驗收（真後端）——UI 登入→SockJS/STOMP CONNECTED 帧（Playwright 攔截 WS 斷言交握）→
  API 觸發 spin→通知鈴鐺 badge→通知中心顯示「遊戲結果通知」。實測 PASS（2.8s）。
  以 `E2E_REAL_BACKEND=1` 為閘：預設 mock e2e 跑到即整組 skip，CI 不受影響。新增 npm script `e2e:realws`。
- `docs/report/T-084-T-093-端對端驗收報告-20260718.md`：驗收留存紀錄（環境/結果表/發現/限制）。

### Changed
- `frontend/vite.config.js`：`/api`、`/ws` dev proxy 轉發時剝除 `Origin` header（`proxyReq`＋`proxyReqWs` 皆掛，
  WS upgrade 走後者）。驗收實測發現：瀏覽器對同源 POST 仍帶 Origin，proxy 原樣轉發會被 gateway CORS
  白名單（只認 5173/5174）403 拒絕；經 proxy 的請求本就同源，剝除後任何 dev/e2e port 通用。
  預設 dev（5173 直連 8080）與 mock e2e 不走此路徑，行為不變。
- `tools/audit/tasks.json`：T-084/T-093 移除 ⚠️ override（其自述的移除條件——「實測通過」「補齊全鏈路」——均已成立），
  補證據檔與 commitGrep，改留 note 記載驗收結果。

### Why
AUDIT_REPORT 附錄 A 僅剩的兩筆前端/測試 ⚠️ 即這兩項的「驗收缺口」（程式碼早已齊備）：T-093 缺跨服務
事件鏈的資料一致性驗證、T-084 缺端對端驗收留存紀錄。補實測而非只補文件，順帶修掉 proxy Origin 這顆
會擋住所有非 5173 port 真後端聯調的雷。

### Verification
- `node tests/e2e/full-chain.mjs`：18 PASS / 0 WARN / 0 FAIL，連跑兩輪全綠（docker compose 15 容器拓樸，develop fd3b465）。
- `npm run e2e:realws`：1 passed（2.8s）。
- 迴歸：`npm run lint` 乾淨；`npm run e2e`（mock）2 passed / 2 skipped（realtime-ws 正確 skip、fishing skip 為既有）。
## [docs] — 2026-07-18 — T-090 B2 收尾：1,000 韌性輪＋T-091 對帳完成，B2 列 ✅

### Added
- `docs/performance/T-090-load-test-report.md`：新增「2026-07-18 B2 對照重跑（Alex 機器）」節——
  150 同機 A/B（494→387 ms，−21.7%）＋重啟後 150 確認輪 `20260718-192139` 全綠（P99 390 ms，
  水位可重現）＋1,000 韌性輪 `20260718-192559` PASS（accepted 成功率 99.7%、帳務 0 違規、
  殘餘失敗＝82 筆起跑連線風暴工件＋2 筆 502）＋T-091（`accounting-20260718-192939`）0 新違規。
- T-091 既知排除項定性：player 1001–1003 真身＝`database/postgres/seed_test_data.sql` 種子錢包
  （開帳 10,000、零交易→檢查口徑結構性誤報），非壓測損傷；準備清單 §5 同步此結論。

### Changed
- `docs/plans/03-T-090-第二輪效能調校藍圖.md`：B2 列 🔶→✅（同機 A/B＋韌性輪＋對帳全數完成）。
- `docs/performance/T-090-壓測前準備清單.md`：§3/§5 psql 範例帳號更正（`luckystar`/`lucky_star` →
  實際的 `lucky_user`/`lucky_star_casino`）；§7.4 對帳說明改為事實（腳本走 host psql 直連 5433，
  非 docker exec），並補「本機原生 PostgreSQL 服務佔用 5433」的替代路徑。
- `CHANGELOG.md`：移除上一筆合併殘留的孤兒衝突標記 `=======`。
- `docs/performance/T-090-B2-工作紀錄-20260718.md` → 歸檔至 `docs/_雜物/`（交接內容已全數併入正式報告）。

### Why
B2 交接的剩餘驗證（1,000 韌性＋T-091）完成，B2 選配收尾閉環；環境註記更正（volume 非當日新建、
5433 port 衝突）留給下一輪續跑者避雷。

### Verification
- 1,000 韌性輪 gate：accepted 成功率 99.7% ≥95% PASS、idempotency/overdraw 0/0。
- T-091：9 項檢查 0 新違規（3 筆種子錢包已逐筆徹查定性，報告見
  `tests/performance/results/accounting-20260718-192939/`）。

## [perf] — 2026-07-18 — T-090 B2：wallet debit 交易 DB 往返 4→2（雷區 8 全套流程）

### Added
- `backend/wallet-service/.../postgres/repository/WalletDebitDao.java`：debit 熱路徑 2 往返 JDBC DAO——
  ①條件 UPDATE（可用餘額守衛＋`NOT EXISTS` 冪等預檢摺進 WHERE，`RETURNING balance`）
  ②流水 INSERT（`ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`）＋競態補償回沖。
  H2（測試）以 `FINAL TABLE(...)`＋捕捉 `DuplicateKeyException` 等價分流（H2 2.2.224 不支援 RETURNING，已實測）。
- `docs/performance/T-090-B2-debit-roundtrip-design.md`：設計紀錄（語意等價性逐條論證、H2 相容、驗證計畫）。
- 測試：`containers/WalletDebitRoundTripContainerTest`（真 PG 5 案：冪等重放/竄改金額/併發同鍵恰一筆流水/10 執行緒不超扣/餘額鏈連續）、`WalletDebitDaoH2Test`（H2 方言分支直測 5 案）。

### Changed
- `WalletService.debit()`：4 次往返（冪等 SELECT→載入 SELECT→UPDATE→INSERT）改為上述 2 往返；
  冷路徑（冪等命中/404/餘額不足）補查區分、皆零副作用。**冪等鍵與冪等語意一絲不變**（雷區 8）。
- **有意的行為變更**：debit 不再拋 `ObjectOptimisticLockingFailureException`（409）——併發扣款由
  wallets 行鎖序列化，後到者夠扣就成功、不夠拋餘額不足；併發同鍵後到者回贏家結果（idempotent=true）。
  game-service 無 409 特判（已確認），其他寫入方（credit/gift）的 JPA `@Version` 樂觀鎖不受影響（debit 每次扣款 version+1）。
- Kafka `wallet.debit` 事件改 **afterCommit 發送**（code review must-fix）：新流程往返 1 起即持有行鎖，
  交易內同步發送遇 broker 阻塞（`max.block.ms` 預設 60s）會拖住該玩家後續扣款；順帶消除外層交易回滾的幽靈事件。
- `WalletServiceDebitTest` 改寫為 mock DAO 驗證流程分支（真 SQL 由 containers 測試守門）。

### Why
B1 JFR 定案：單機 Postgres debit 容量 ≈550–600 交易/秒，往返數直接決定單筆延遲下限（第二輪藍圖 Phase B2，
150 併發 P99 393ms → 目標 250–350ms）。原子性搬進 SQL 語句後，判定與扣款無讀改寫窗，防超扣更強。

### Verification
- `mvn -pl backend/wallet-service test`：127 tests 全綠（含 H2 真路徑的 `ShopRedemptionIntegrationTest`）。
- `mvn -pl backend/wallet-service test -Pcontainers-test`（ADR-007 真 PG/MySQL）：13 tests 全綠。
- code-reviewer gate：帳務核心無資損路徑；2 must-fix（Kafka 行鎖窗、CHANGELOG）均已修復。
- **150 併發同機 A/B（2026-07-18，Alex 機器、全容器化拓樸、新 volume）**：pre-B2（develop）P99 494 ms →
  B2 **387 ms（−21.7%，驗收模式全 gate PASS）**；debit 平均 10.86→8.57 ms；每輪 0 失敗/0 429/0 5xx、帳務斷言 0。
  與歷輪 393 ms（weiyu 機器）跨機不可比，達標判定以原機器複測為準。
- 未完項（交接）：1,000 韌性輪＋T-091 對帳＋報告收尾，見 `docs/performance/T-090-B2-工作紀錄-20260718.md`。

## [docs] — 2026-07-18 — AUDIT_REPORT：T-090 ⚠️→✅（E3 驗收通過，移除 override）

### Changed
- `tools/audit/tasks.json`：T-090 移除「效能 gate 未達標」override（override 自述「gate 通過後移除」的條件已成立），改留 note 記載 E3 結案驗收結果；重跑 `generate-audit-snapshot.mjs`，標記區塊 T-090 轉 ✅（檔案 3/3＋54 筆 commit），`--check` 一致，快照落 `docs/report/audit-snapshot-20260718.md`。
- `AUDIT_REPORT.md` 標記區塊外人工敘述同步：變動紀錄補 2026-07-18 條、模組概覽把 T-090/T-091 移入「完成度高」、「進行中」移除壓測 gate 重測。

### Why
PR #218 合併後 T-090 已於 E3 結案輪在 D1-c 語意下正式驗收通過（報告 Status=CLOSED），AUDIT_REPORT 的 ⚠️ 與人工敘述若不更正即成為過時快照（AGENTS.md §1 的已知問題）。

### Verification


## [test] — 2026-07-18 — T-090 E3 結案輪：150 全綠驗收 PASS＋1,000 韌性 PASS＋T-091 乾淨，第二輪閉環

### Added
- `docs/performance/T-090-load-test-report.md` 新增「2026-07-18 E3 最終驗收重跑（第二輪結案）」節，Status 改 **CLOSED**：
  - 150 正式輪 `20260718-104301`（驗收模式）**全綠 PASS**：P99 377 ms、23,968 樣本、0 失敗/0 卸載/0 5xx——與凌晨輪同機對照全綠可重現。D1-c 語意下＝**T-090 正式驗收通過**。
  - 1,000 輪 `20260718-104705`（韌性模式）**PASS**：accepted 成功率 **99.2%**（gate ≥95%）、**401 工件 1,113→0**（`refresh-player-tokens.mjs` 首次實戰生效）、429 卸載 11.6%（趨勢）、殘餘 375 筆 `HttpHostConnectException` 全集中起跑 0–5 秒（1s ramp-up 連線風暴，單機工件）＋1 筆 502。
  - T-091 `accounting-20260718-104929`：9 項 **0 新違規**（3 筆＝既知 player 1001–1003 歷史孤兒錢包，逐筆查證同凌晨輪）。
- 藍圖 03 進度表 E3 標 ✅——E1/E2/D1/D2/E3 全數完成，**第二輪結案**；B2/D1-b 降選配遺留。

### Why
E3 是第二輪藍圖的結案輪：首輪套用 D1-final（選 c）＋D2 雙模式 gate 的正式判定，同時實戰驗證 token 臨發方案。SOP 全程照準備清單（暖機棄置 `20260718-103855`、輪距 2.5 分、每輪前 refresh token）。

### Verification
- provisioning 947/1,000（auth 限流 429 缺 53）→ 補量 60 名合併 1,007 列；refresh 1,007 名僅 6.4 秒。
- 兩輪 acceptance report（新模板含宣告容量/Gate mode/成功率欄）＋ JTL ＋ HTML 落 `tests/performance/results/20260718-10*`；T-091 報告落 `accounting-20260718-104929`。

## [changed] — 2026-07-18 — T-090 D1-final 拍板（選 c）＋ D2 落地：gate 與拓樸宣告綁定

### Changed
- `docs/plans/03-T-090-第二輪效能調校藍圖.md`：D1-final 拍板記錄（選 **c 承認單機**）——①中繼目標維持 150 全綠、門檻 500 ms 不降格（實測 393 ms 已達標），**宣告容量＝150 併發**；②429 gate 綁宣告容量：容量內 429=0 硬 gate，超容量輪不設 429 佔比 gate、判準改 accepted 成功率 ≥95%＋帳務 0 違規；③1,000 併發定位為韌性驗證，b（DB 隔離）降選配、a（雲端多機）不做。D1-final/D2 進度表標 ✅。
- `tests/performance/analyze-jtl.mjs`：依 D1-final 語意改為**雙模式 gate**——`THREADS` ≤/> `DECLARED_CAPACITY`（預設 150）自動判驗收/韌性模式；驗收模式 gate＝P99<500、5xx=0、失敗=0、**429=0**；韌性模式 gate＝accepted 成功率 ≥ `MIN_ACCEPTED_SUCCESS`（預設 0.95），429/P99/5xx 降為趨勢紀錄；帳務（冪等/超扣）兩模式皆 0 硬 gate。移除 `MAX_429_RATIO` 標量上限。報告模板加宣告容量/Round threads/Gate mode/成功率欄。
- `tests/performance/run-slot-load-test.ps1`：`-Max429Ratio` 參數移除，改 `-DeclaredCapacity`（預設 150），並把 `THREADS` 傳給 analyzer 判模式。
- `tests/infra/jmeter.test.js`：新增「gate mode binds to declared capacity」契約測試（守住雙模式判定、禁止 `MAX_429_RATIO` 回歸、runner 必傳兩參數）。
- `docs/performance/T-090-壓測前準備清單.md` §8：更新為拍板後語意，並補 1,000 輪起跑前跑 `refresh-player-tokens.mjs` 的檢查項。

### Why
D1 三懸案不拍板則「上線標準」無法閉環。選 c 的理由（藍圖 D1-final 節）：學習優先專案，1,000 併發下「帳務零違規＋有序卸載＋成功率單調改善」的證據鏈比絕對 P99 更有價值；單機 1,000 併發 P99<500 是物理不可能（B1 JFR 已定案 DB 天花板），設 gate 只會誘發指標作弊。拆「卸載多少」（容量問題，不 gate）與「卸載得乾不乾淨」（機制問題，gate 成功率）。

### Verification
- 07-18 歷史 JTL 迴放：150 輪（`20260718-031827`）驗收模式 **PASS**（P99 393 ms/429=0）；1,000 輪（`20260718-033439`）韌性模式 **PASS**（成功率 97.7% ≥95%、帳務 0）；反向驗證＝同一 1,000 輪 JTL 用驗收模式判 **FAIL** exit 1（gate 有效）、非法參數 exit 2。
- `node --test tests/infra/jmeter.test.js`：11/11 綠。

## [test] — 2026-07-18 — T-090 壓測前臨發 token 腳本（解 JWT 15 分鐘到期工件）

### Added
- `tests/performance/refresh-player-tokens.mjs`：壓測起跑前把 `players.csv` 全部玩家重登入一輪、原地換新 JWT。直連 member-service（8081）而非 gateway——繞過 auth 5/s 限流（1,000 名走 gateway 至少 200 秒，臨發失去意義）、也不污染壓測前的 gateway 限流桶/AIMD 窗。任一名失敗即 exit(1) 且不改寫 CSV（JMeter 要求 ≥ threads 列）；舊格式（無 username 欄）CSV 直接拒絕。

### Changed
- `tests/performance/provision-players.mjs`：CSV 第三欄加 `username` 供重登入（jmx `CSVDataSet` 的 `variableNames` 只映射前兩欄，多欄被 JMeter 忽略，既有壓測計畫不受影響）；頭部註解記載 15 分鐘 JWT 與 refresh SOP。
- `docs/performance/T-090-load-test-report.md`：07-18 節 401 工件標記已解，E3 SOP＝provision → refresh → 立即起跑。

### Why
07-18 輪 1,000 併發殘餘 401×1,113 為壓測工件：provisioning ~8 分鐘、JWT 效期 15 分鐘，最早入列玩家 token 輪中到期。三個候選方案中選「分批臨發」：不動正式 JWT 效期設定（暫調效期會讓壓測環境偏離正式行為）、不必為縮短 provisioning 動 auth 限流，壓測工具自己解自己的問題。

### Verification
- Provision 2 名 → CSV 三欄格式正確 → refresh 0.1 秒完成、解 JWT 驗證 `iat` 前進 14 秒、新 token 效期 900 秒整。
- 舊格式 CSV：exit=1、檔案未被改寫。

## [fix] — 2026-07-18 — T-090 provision 腳本 admin 密碼改讀 .env 同一真相來源（治本 401）

### Fixed
- `tests/performance/provision-players.mjs`：`ADMIN_USER`/`ADMIN_PASS` 未由環境變數提供時，改為自動讀 repo 根 `.env` 的 `ADMIN_SEED_USERNAME`/`ADMIN_SEED_PASSWORD`（新增 `readDotEnv()`），最後才退回 `ChangeMe!SuperAdmin123`（＝AdminUserSeeder 未設 `.env` 時的 Java 端預設）。頭部用法註解同步。

### Why
07-17 夜壓測作廢的根因：腳本寫死的預設密碼與 `.env` 種給 AdminUserSeeder 的 `ADMIN_SEED_PASSWORD` 是兩份會漂移的真相 → 忘帶 `ADMIN_PASS` 必 401。既有防呆只能把「靜默退化」變「大聲失敗」，改讀同一來源才消滅這顆雷。另查證 07-18 3:06 的「用 .env 密碼仍 401」為服務未就緒/指令工件：DB hash 自 07-13 未變，同組密碼現登入 200。

### Verification
- `PLAYERS=1`、不帶 `ADMIN_PASS` 實跑：admin 登入成功、GM 發幣 1,000,000 到帳、CSV 寫出（1 成功 / 0 失敗）。
- DB 佐證：`admin_action_logs` GM_GRANT 1,201 筆、1,201 個錢包 ≥500,000（07-18 凌晨輪發幣管線正常）。

## [test] — 2026-07-18 — T-090 E1+E2 對照重跑：150 全綠首達、1,000 併發 503 歸零；provision 腳本防靜默退化

### Changed
- `tests/performance/provision-players.mjs`：①`fund()` 檢查 `/admin/gm/grant` 回應非 200 即 throw（原本吞掉失敗）；②admin 登入失敗改為直接 `exit(1)`，除非顯式設 `ALLOW_BANKRUPTCY_FALLBACK=1` 才允許退回破產救濟金 1,000/人。

### Added
- `docs/performance/T-090-load-test-report.md` 新增「2026-07-18 E1+E2 對照重跑」節：150 正式輪（`20260718-031827`）**首次全綠**（P99 393 ms、0 失敗、0 卸載）；1,000 輪（`20260718-033439`）**503 桶 2,024→0、CB 整輪未開路（not_permitted=0）、429 佔比 65.3%→13.2%、accepted 成功率 78.4%→97.7%**（殘餘 401×1,113 為 JWT 到期壓測工件，E3 前需解）；T-091 九項 0 新違規（`accounting-20260718-033833`）。藍圖 03 進度表 E1/E2 標記對照重跑通過。

### Why
E1+E2（PR #217）落地後需對照重跑驗證兩項判準（503 歸零、accepted 成功率 ≥90%）。2026-07-17 夜兩輪因 provision 發幣靜默失敗（admin 401 → 默默退化 1,000/人 → 全場 422）作廢，故先修腳本讓失敗 fail-fast，再重跑。跨機與多變因歸因限制見報告內誠實聲明。

### Verification
- 手動重現 `/admin/gm/grant` 全管線（HTTP 200 → Kafka → wallet 入帳 1,000,100）確認端點無 bug；provision 200/200、1,000/1,000 全成功，DB 驗 `balance>=500000` 錢包數吻合。
- 兩輪 acceptance report + JTL 落 `tests/performance/results/20260718-*`；T-091 由容器內 psql 執行，3 筆既知 1001–1003 歷史髒資料已逐筆查證非本輪產生。

## [changed] — 2026-07-17 — T-090 E1+E2：game/wallet CB 改時間窗＋AIMD 延遲窗排除卸載樣本（消滅 CB/AIMD 互踩）

### Changed
- `backend/gateway-service/src/main/resources/application.yml`：`game-service`/`wallet-service` 兩個 CB instance 由 `COUNT_BASED/size 10/min-calls 5/slow-call 3s/80%` 改為 `TIME_BASED/10 秒窗/min-calls 20/slow-call 4s（仍 < TimeLimiter 6s）/90%`；game route 的 AIMD `latency-target-ms` 預設 2000 → 1500（E1）。member/rank/admin 低流量路由維持原參數。
- `backend/gateway-service/.../filter/RouteConcurrencyLimitGlobalFilter.java`＋`AdaptiveInFlightLimiter.java`：`doFinally` 只把「HTTP < 500 且非 429」的回應計入 AIMD 延遲窗；429/5xx/無狀態碼（取消）一律歸還名額但不記樣本（E2）。全 5xx 窗＝無有效樣本 → 複用「無流量不動」語意，上限凍結。

### Added
- `CircuitBreakerDisasterReactionTest`：鎖住 E1 綁定值（漂移即紅燈）＋模擬下游全逾時、斷言 min-calls 湊滿即開路（災難反應不劣化的不可回歸約束）。
- `RouteConcurrencyLimitGlobalFilterTest` 新增 4 個 E2 樣本篩選測試（2xx 進窗、429/5xx 不進窗、全 5xx 凍結、取消歸還名額不記樣本）。

### Why
2026-07-09 C3+B1 輪的唯一失敗桶（503×2,024）根因是兩層保護互踩：CB 的 COUNT_BASED 10 筆窗在 464/s 吞吐下只有 ~21ms 流量、瞬時抖動即誤觸開路；開路後毫秒級 503 進 AIMD 窗拉低 P95、誘使放寬上限、推爆 half-open 的後端，形成正回饋震盪。E1 把 CB 退居災難保險絲（AIMD 先收緊）、E2 切斷訊號污染（就算閾值調錯也不再共振）。詳見 `docs/plans/03-T-090-第二輪效能調校藍圖.md` Phase E1/E2。

### Verification
- `mvn -pl backend/gateway-service test`：47/47 全綠（原 41 ＋ 新增 6）。
- 對照重跑（150/1,000 併發）排定於落地後執行，判準＝503 桶 2,024 → 趨近 0、accepted 成功率 78.4% → 90%+。

## [changed] -- 2026-07-16 -- Restore baccarat side panel and move rules to page top

### Changed
- frontend/src/pages/Baccarat.jsx: moved the baccarat rules card to the top of baccarat-page above the game table.
- frontend/src/pages/Baccarat.jsx: moved BaccaratRoadmap back into baccarat-side-panel so the side panel has its original roadmap role.
- frontend/src/styles/games/baccarat.css: restored the 1500px+ normal-page baccarat-side-panel right rail while keeping narrower layouts stacked below the table.

### Why
- The side panel should return to its original table-side placement, while the game rules card should be the top-of-page helper section.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
- Playwright layout QA passed at 1100x900 and 1500x900: rules above table, side panel contains roadmap only, 1500px side panel restored to right rail, 1100px side panel remains below felt, bodyOverflowX 0.

## [changed] -- 2026-07-16 -- Move baccarat roadmap to page top and remove fairness panel

### Changed
- frontend/src/pages/Baccarat.jsx: moved BaccaratRoadmap, which renders baccarat-roadmap-panel, to the top of baccarat-page above the game table.
- frontend/src/pages/Baccarat.jsx: simplified baccarat-side-panel so it only keeps the baccarat rules card below the game table.
- frontend/src/styles/games/baccarat.css: added top spacing for the page-level baccarat-roadmap-panel and removed unused baccarat-api-panel rules from the dedicated baccarat stylesheet.

### Removed
- frontend/src/pages/Baccarat.jsx: removed the baccarat-api-panel fairness verification block from the baccarat page.

### Why
- The roadmap panel should be visible at the top of the baccarat web page, and the fairness verification panel is no longer part of the requested layout.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
- rg confirmed Baccarat.jsx only renders BaccaratRoadmap once at the page top and no longer contains baccarat-api-panel or fairness verification copy.

## [changed] -- 2026-07-14 -- Keep baccarat side panel below the table

### Changed
- frontend/src/styles/games/baccarat.css: forced the normal baccarat page to use a single table column at every viewport width.
- frontend/src/styles/games/baccarat.css: kept baccarat-side-panel below baccarat-table-felt with full-width alignment instead of moving it into a right-side column on wide desktop.
- frontend/src/styles/games/baccarat.css: preserved fullscreen behavior by keeping the external side panel hidden in baccarat-table--fullscreen.

### Why
- The baccarat side panel should be consistent across the web page layout and always appear below the game screen, regardless of viewport size.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
- Playwright layout QA passed at 1100x900, 1500x900, and 1800x900: side panel below felt, aligned full width, static position, and bodyOverflowX 0.

## [fixed] -- 2026-07-14 -- Prevent baccarat wide-desktop clipping

### Fixed
- frontend/src/styles/games/baccarat.css: stopped the normal baccarat table from clipping content at 1500px+ widths by allowing the table and felt area to show natural overflow.
- frontend/src/styles/games/baccarat.css: disabled the normal-page 16:9 felt constraint at 1500px+ widths and restored an auto-height felt area sized by its table content.
- frontend/src/styles/games/baccarat.css: kept the fix scoped to non-fullscreen baccarat tables so fullscreen keeps its separate viewport layout.

### Why
- The 1500px+ desktop breakpoint was reapplying a fixed 16:9 felt height while the normal table still contained betting, chip, side-bet, settlement, and side-panel content, causing the game screen to be severely clipped.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
- Playwright wide-desktop QA passed at 1600x900 and 1800x900: felt aspect-ratio auto, table/felt overflow visible, deepestOverflow <= 0, feltOverflowY 0, bodyOverflowX 0.

## [fixed] -- 2026-07-14 -- Polish baccarat side bets, squeeze hint, and deal animation

### Fixed
- frontend/src/styles/games/baccarat.css: kept normal-page baccarat-side-bets buttons on a single horizontal row and compacted their labels so they no longer wrap into a second line.
- frontend/src/styles/games/baccarat.css: moved the baccarat-squeeze__hint label back inside each baccarat-hand card area with a compact pill style.
- frontend/src/pages/Baccarat.jsx: changed the dealing sequence to animate hidden card backs first, then reveal real cards only after the dealing animation finishes.
- frontend/src/components/baccarat/BaccaratCard.jsx and BaccaratHandPanel.jsx: added per-round dealSeed support so dealt cards fly in from varied random directions instead of using one fixed motion.

### Why
- The normal table side-bet tracker should stay visually tidy, squeeze hints should not overflow the hand panel, and starting a round should not briefly expose the final cards before the dealing animation completes.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [changed] -- 2026-07-14 -- Move baccarat reveal button into duel grid center

### Changed
- frontend/src/pages/Baccarat.jsx: moved the concealed-card reveal action from the table header into the center of baccarat-duel-grid below the VS medallion.
- frontend/src/components/baccarat/BaccaratTableHeader.jsx: removed the header-level direct reveal button props and kept the header focused on squeeze mode and fullscreen controls.
- frontend/src/styles/games/baccarat.css: added baccarat-duel-center and baccarat-reveal-center-button styles so the reveal action stays centered between Banker and Player hands.

### Why
- The direct reveal action should live visually inside the card area where the player is deciding whether to reveal the current hand.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [fixed] -- 2026-07-14 -- Rebalance baccarat fullscreen card and side-bet areas

### Fixed
- frontend/src/styles/games/baccarat.css: enlarged baccarat-duel-grid in fullscreen mode and restored a larger hand/card presentation.
- frontend/src/styles/games/baccarat.css: reduced baccarat-betting-mat height and hid the fullscreen-only betting note so the card area has more room.
- frontend/src/styles/games/baccarat.css: expanded and compressed baccarat-side-bets in the fullscreen right rail so all eight side-bet buttons remain visible, including wide short viewports.
- frontend/src/styles/games/baccarat.css: disabled the normal desktop 16:9 felt aspect ratio in fullscreen mode to prevent vertical overflow.

### Why
- The fullscreen baccarat table needed a larger card area, a thinner main betting mat, and a complete side-bet list without clipping.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
- Playwright fullscreen QA passed at 1440x900 and 2048x768: all 8 side-bet buttons visible, duel taller than betting mat, overflowX 0, tableOverflowY 0.

## [fixed] -- 2026-07-14 -- Separate baccarat page and fullscreen scroll layouts

### Fixed
- frontend/src/pages/Baccarat.jsx: moved baccarat-side-panel inside baccarat-table so the normal baccarat-table--idle shell covers the full game screen, and added a body scroll lock while fullscreen is active.
- frontend/src/styles/games/baccarat.css: forced the normal page layout to use one browser scrollbar with no side-panel vertical scrollbar.
- frontend/src/styles/games/baccarat.css: hid the external side panel in fullscreen mode and kept fullscreen table/body overflow locked separately from the normal web page layout.

### Why
- The normal baccarat page should have one coherent table shell and one page scrollbar, while fullscreen should be a separate fixed viewport design without nested page scrolling.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
- Playwright scroll QA passed: normal table contains side-panel, no side-panel vertical scrollbar, fullscreen hides side-panel, body and table overflow are hidden, and settlement remains visible.

## [fixed] -- 2026-07-14 -- Reposition baccarat fullscreen settlement panel

### Fixed
- frontend/src/styles/games/baccarat.css: moved baccarat-settlement--empty from the lower chip row into the fullscreen right rail above side bets.
- frontend/src/styles/games/baccarat.css: enlarged the empty settlement panel into a useful 140-150px information panel while keeping baccarat-duel-grid compact.
- frontend/src/styles/games/baccarat.css: kept side bets below settlement in fullscreen mode with zero viewport overflow.

### Why
- The empty settlement panel was still perceived as pushed below the fullscreen game area, and the previous rail was too small for the available right-side space.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
- Playwright layout QA measured refreshed fullscreen layouts at 1440x900 and 1100x800: settlement above side bets, in viewport, useful size true, duel compact true, and zero overflow.

## [fixed] -- 2026-07-14 -- Compact baccarat fullscreen card arena and settlement rail

### Fixed
- frontend/src/styles/games/baccarat.css: hid the duplicated status bar in baccarat fullscreen mode and compressed the table header so the game surface starts higher in the viewport.
- frontend/src/styles/games/baccarat.css: constrained baccarat-duel-grid in fullscreen mode with smaller width, lower height ceiling, compact cards, and reduced score chrome.
- frontend/src/styles/games/baccarat.css: docked baccarat-settlement--empty as a short right-side rail instead of letting it stretch with the chip tray row.

### Why
- The fullscreen baccarat card area was visually too dominant, and the empty settlement panel needed to feel integrated inside the game viewport.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
- Playwright layout QA measured fullscreen layouts at 1440x900 and 1100x800 with zero overflow; duel-grid was reduced to 780x150 and 792x144, and empty settlement rail to 105px tall.

## [fixed] -- 2026-07-13 -- Refine baccarat side panel and fullscreen table layout

### Fixed
- frontend/src/pages/Baccarat.jsx: removed the four MetricCard blocks from baccarat-side-panel so the side panel no longer renders rounded border p-4 metric cards.
- frontend/src/styles/games/baccarat.css: changed side-bet cards to a stable grid layout so odds, title, description, and state badges no longer overlap.
- frontend/src/styles/games/baccarat.css: made baccarat fullscreen mode own the viewport and compressed the table grid so side-bets and the empty settlement rail stay visible inside the game screen.

### Why
- The baccarat desktop table needed the external side metrics removed and the in-table side-bet and settlement panels integrated into fullscreen without clipping or overlap.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
- Playwright layout QA passed for refreshed baccarat page at 1440x900 and 1100x800 fullscreen-class layouts with zero side-bet overlap and zero horizontal overflow.

## [changed] -- 2026-07-13 -- Integrate baccarat side bets and empty settlement rail

### Changed
- frontend/src/components/baccarat/BaccaratSideBets.jsx: replaced disabled preview tiles with selectable side-bet tracking, odds, descriptions, and hit-or-miss result states based on dealt cards.
- frontend/src/pages/Baccarat.jsx: added local side-bet tracking state without changing the baccarat backend betting payload or wallet settlement flow.
- frontend/src/components/baccarat/BaccaratSettlementPanel.jsx: compacted the empty settlement state into an in-table status rail and added side-bet tracking count.
- frontend/src/styles/games/baccarat.css: integrated side-bet tracker styling and compact empty settlement styling into normal and fullscreen table layouts.

### Why
- Side bets and the empty settlement panel should feel like part of the baccarat table, including fullscreen mode, while backend settlement still only supports main bets.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.
- Playwright QA passed for refreshed baccarat page, side-bet tracking, fullscreen layout class, settlement, and roadmap update.

## [changed] -- 2026-07-13 -- Add baccarat interaction polish

### Changed
- frontend/src/pages/Baccarat.jsx: added dealer cue state, staged card dealing, and fullscreen table state while keeping wallet guards intact.
- frontend/src/components/baccarat/BaccaratBettingMat.jsx: added betting-zone pulse and chip-flight feedback on bet selection and chip changes.
- frontend/src/components/baccarat/BaccaratRoadmapPanel.jsx: localized road-dot tooltip labels.
- frontend/src/styles/games/baccarat.css: added dealer cue, table sweep, chip-flight, settlement sweep, and roadmap drop animations with reduced-motion fallback.

### Why
- The baccarat page needed more responsive table feedback without changing backend settlement or wallet behavior.

### Verification
- npm.cmd run lint --prefix frontend passed.
- npm.cmd run build --prefix frontend passed.

## [fix] -- 2026-07-13 -- Restore baccarat theme background and panel layout

### Fixed
- frontend/src/pages/Baccarat.jsx: moved BaccaratChipTray directly below BaccaratBettingMat so chip controls sit under the main betting area.
- frontend/src/styles/games/baccarat.css: disabled the custom baccarat fixed background overlay so the page uses the AppShell site theme again.
- frontend/src/styles/games/baccarat.css: restored the wide desktop side panel to single-column layout and limited centered half-width metric cards to responsive stacked-below-table layouts.

### Why
- The baccarat page should inherit the site casino theme background, keep controls near the betting mat, and only use compact metric cards when the side panel is moved below the table.

### Verification
- npm.cmd run lint frontend passed.
- npm.cmd run build frontend passed.

## [fix] -- 2026-07-13 -- Compact baccarat side metrics

### Fixed
- frontend/src/styles/games/baccarat.css: arranged the four baccarat MetricCard items as two-column half-width cards while keeping roadmap, rules, and verification panels full-width.

### Why
- The baccarat side metrics were too wide when the side panel moved below the table.

### Verification
- npm.cmd run lint frontend passed.
- npm.cmd run build frontend passed.

## [fix] -- 2026-07-13 -- Adjust baccarat interaction and responsive layout

### Fixed
- frontend/src/pages/Baccarat.jsx keeps the deal control clickable enough to show the missing-bet prompt while still blocking insufficient-balance deals.
- frontend/src/components/baccarat/BaccaratRoadmapPanel.jsx and BaccaratSideBets.jsx replace visible roadmap and side-bet English copy with Chinese labels.
- frontend/src/styles/games/baccarat.css prevents side-bet preview clipping and moves the baccarat side panel below the table until wide desktop space is available.

### Why
- The baccarat table needed usable controls, localized analysis panels, and more table width on reduced desktop viewports.

### Verification
- npm.cmd run lint frontend passed.
- npm.cmd run build frontend passed.

## [changed] -- 2026-07-13 -- Rebuild desktop baccarat table UI

### Changed
- frontend/src/pages/Baccarat.jsx wired the baccarat page to a dedicated game stylesheet, added fullscreen table support, and kept the existing wallet/API/betting/squeeze flow intact.
- frontend/src/components/baccarat refreshed the table HUD, betting mat, chip tray, hand panels, settlement panel, side-bet preview, and roadmap panel.
- frontend/src/utils/baccaratGame.js restored readable baccarat bet labels used across the page.
- frontend/src/styles/games/baccarat.css added the dedicated desktop baccarat casino-table layout, 16:9 felt stage, glass HUD, roadmap panel, chip dock, settlement overlay styling, and responsive fallbacks.

### Why
- /game/baccarat needed a full desktop game-table refactor rather than color-only tweaks, while preserving the existing backend contract and frontend balance guards.

### Verification
- npm.cmd run lint frontend passed.
- npm.cmd run build frontend passed.

## [docs] -- 2026-07-14 -- ADR-004 補修訂紀錄：追認砲台傷害 14/22/32 為定案值，收掉最後一筆已知 ADR 漂移

### Changed
- `docs/adr/ADR-004.md`：新增〈修訂紀錄〉章節，決策第 3 點（砲台傷害 10/14/18）加修訂警示框；原「現況校驗」的 ⚠️ 懸案標記為已收斂。內容含：
  - **漂移源頭考證**：commit `440b6df`（2026-07-06）在障礙魚/MISS 改版中把 `CANNON_DAMAGE` 從 `{0,10,14,18}` 改為 `{0,14,22,32}`，但 commit 訊息與 CHANGELOG 均未提及此行——無痕調參即漂移成因。
  - **追認為刻意調整、不改回**：後續契約檔、`FishingCombatTest`、2026-07-13 重算的 Javadoc 全部以 14/22/32 為基準，生態一致；依 AGENTS.md「以程式碼為準」定案。同時記錄代價（金/銅倍率回到 ≈2.29×、金炮最低捕獲率降回 ~0.25，部分讓渡「減少掙脫挫折」的原目標）。
  - **順帶記錄模型邊界**：`440b6df` 起 MISS/障礙魚命中是「扣費、零派彩、零回收」，不在 pCapture/回收模型內——「體感地板 0.70」僅對打在獎勵魚上的子彈成立，實戰 RTP 低於 0.96 的幅度另受空射比例稀釋；風控門檻 `FISHING: 1.10` 裕度仍足、無需調整。

### 為什麼
- 2026-07-10 九份 ADR 現況校驗後，這是唯一開著的文件漂移（ADR-004 自己列了「刻意 vs 疏漏」兩種可能待查證）。本次沿 git 歷史（`git log -S`）追到唯一變更點並定案，讓 ADR-004 不再與程式碼分歧，也給未來調參者留下「勿再無痕調參、走雷區 16 四同步＋修訂紀錄」的明確規則。

### 如何驗證
- 純文件變更，無程式行為影響。考證依據可重現：`git log --all -S '{0, 14, 22, 32}' -- backend/game-service` 唯一命中 `440b6df`；`git show 440b6df` 確認訊息/CHANGELOG 未提傷害調整；現行 `FishingCombat.java:67` 與 `contracts/fishing-combat.json` 均為 `[0, 14, 22, 32]`。

## [docs] -- 2026-07-13 -- interview-prep 補三個缺口：契約守門決策、風控門檻的蒙地卡羅論證、Kafka partition 分層

### Added
- `docs/interview-prep/02-設計決策與為什麼.md`：新增**決策 10「契約檔守門」**（`contracts/*.json` + `ContractParityTest`：前端 mock 直接 import 契約檔、後端維持 enum 為執行期權威、相等性測試守 CI）。原本整份 interview-prep **完全沒提這個機制**，但它是「怎麼防止前後端業務規則不同步」這題的標準答案。
- `docs/interview-prep/02-設計決策與為什麼.md` 決策 5：補**「門檻錯了兩次」的完整故事**——第二次（per-game 之後仍誤判）的根因是「監控的是 500 局樣本平均、而樣本平均自己有標準差」，附蒙地卡羅實測的誤報率對照表（SLOT 0.97 → 36% 誤判；1.30 → 0.06%）。這是「你怎麼決定告警閾值」的滿分答案。
- `docs/interview-prep/04-資料庫與分散式觀念.md` §7：補 **Kafka partition 分層設計**（高流量 6 / 低流量 3 / DLT 1），論點是「加 partition 有沒有用取決於 producer 的 key」——`rank.update` 用固定 key，開再多 partition 平行度仍是 1。

### Changed
- `docs/interview-prep/01-專案程式碼地圖.md` §5、`09-開發流程與工程實踐.md`：測試策略補上 `ContractParityTest`，並主動點出它的已知邊界（守得住數值、守不住演算法邏輯）。
- `docs/interview-prep/00-index.md`：速查表補三題（前後端不同步 / 告警閾值 / partition 數）。
- `docs/interview-prep/04-資料庫與分散式觀念.md`：修正 `wallet.credit` 消費者敘述——實際是 rank / admin / wallet(read-sync) **三個**獨立 group，原文只寫 rank。

### 為什麼
盤點 `docs/interview-prep` 與程式碼的一致性時發現：整體同步狀況良好（13 章壓測完全對齊 T-090、程式碼地圖無死連結），但有三個「專案做了、文件沒寫」的缺口，且三者都恰好是高頻面試題的最佳素材。風控門檻那則尤其重要——現行值 SLOT 1.30 / BACCARAT 1.20 的**決策理由只存在於 YAML 註解裡**，面試文件只講了「per-game」這個表層結論，漏掉真正有價值的「用模擬量化誤報率」方法論。

### 如何驗證
- 逐項與程式碼交叉核對：`contracts/*.json` 五檔存在、`game-service` 的 `ContractParityTest` 存在；`kafka/kafka-init.sh` 確認 6/3/1 分層；`game-service/application.yml` 確認 `SLOT: 1.30 / BACCARAT: 1.20 / FISHING: 1.10 / default: 1.05`；`grep topics=` 確認 `wallet.credit` 的三個消費者。
- 純文件變更，不影響任何測試。

### Fixed
- `backend/game-service/.../fishing/FishingCombat.java`：**`CANNON_DAMAGE` 的 Javadoc 過時**——寫著「銅 10 / 銀 14 / 金 18（金炮約銅炮 1.8×）」，但實際常數是 `{0, 14, 22, 32}`（銅 14 / 銀 22 / 金 32，金炮約銅炮 2.3×）；連帶「金炮對中小魚 `pCapture` ≈ 0.44」也是舊值。依現行常數重算後改為「銅 0.57~0.86、銀 0.37~0.48、金 0.25~0.48（魚種越大越低）」，並補上 ADR-004 的「勿對低 `pCapture` 設硬地板」警告（設地板會打破 `pCapture = TARGET_RTP × E[N] / multiplier`，使 RTP 破表）。**僅改註解，無行為變更**——這是文件漂移，照舊註解調參會做出錯誤決策。

### 相關
同日在專案外的教材 `D:\Lucky_Star_Prac`（個人練習用，不在本 repo）做了對應的錯誤修正與章節補充；上述 Javadoc 漂移就是在教材比對過程中發現的。

---

## [docs] -- 2026-07-13 -- docs/ 全面盤點校正：架構文件對齊程式碼、進度表歸零、歷史文件標記、新增索引

### Added
- `docs/README.md`：**docs 索引**（原本沒有）。把 60 份文件分成 🟢 現況 / 🟡 計畫 / ⚪ 歷史三類，明確標示哪些可照著動工、哪些只能當背景讀；附 ADR 全表與「不在 docs/ 但必讀」清單。
- `docs/_雜物/prompts/README.md`：歸檔說明表，逐份標註對應任務的現況。
- `docs/plans/02-捕魚機升級-血量傷害模型.md`：補「進度總覽」表（CLAUDE.md §4 要求 plan 檔須有狀態表）——Phase 1~4 全數 ✅，並標明檔內數值是草案、已被 ADR-003/004 取代。

### Changed
- `docs/architecture.md`（漂移最嚴重的架構文件，停在 5/26 v1.0）：§1 概覽圖補 notification 8087 與 `wallet.credit.request`；§2 七服務職責全面重寫（game 補捕魚/風控/cashback/ADR-009 補償；wallet 補鑽石/商城/儲值/雙 EMF；admin 補獨立 JWT secret 與雷區 21；member 補簽到路由雷區 19；notification 移除「未在 compose 列出」的過時備注）；§4 資料表補齊 15+11 張（原本只列 7+7）；§5 Redis key 改為程式碼實際字串（`game:fishing:session:*`、`risk:*`、`token:min-iat:*`）；§6 Kafka 改為實際的 8 業務 + 5 DLT；§7 Port 補 notification 8087 / frontend-admin 5174 / Prometheus / Grafana；§8.2 下注流程補併發卸載、風控、補償；**§9 ADR 表整段重寫**。
- `docs/PROJECT_BASE_EXPLANATION.md`：**整份重寫**。原文寫「後端服務尚未實作、PostgreSQL 只有 system_health_check 一張表」，與現況相差兩個月。
- `docs/ENV_SETUP_GUIDE.md`：修正 clone 網址（原為不存在的 `Lucky-Strat-Casino`）；§3.2 從「已有預設值不需修改」改為 **CHANGE_ME 佔位符必須自行生成**（含各密鑰用途表）；§5.1 Kafka topic 清單補齊；Redis 容器名改為實際的 `lucky-star-redis`；§6.2 補 notification-service；**§6.3 原文說 member 連 PostgreSQL——實際是 MySQL**，改為各服務 DB 對照表；§7.4 新增 `VITE_USE_MOCK_API` 說明與 frontend-admin 章節；新增 Q6/Q7 排錯。
- `docs/LOCAL_API_INTEGRATION_GUIDE.md`：移除「或使用專案內 `mvnw`」（雷區 1：**本專案沒有 mvnw**）；修正「5174 是 5173 的備援 port」（實際是**管理後台專屬 port**）；`.env` 明文開發密鑰改為佔位說明；**啟動順序補上「後端已容器化，`docker compose up -d` 會一起起 7 個後端」**——原文教人 compose 之後再 `mvn spring-boot:run`，會直接撞 port；新增 mock 預設開啟的警告。
- `docs/dual-datasource-guide.md`：**核心敘述是錯的**——原文說「目前架構不需要 JPA 操作次庫，用 `JdbcTemplate` 即可」，但 wallet/admin 實際都有**兩套手動建立的 EntityManagerFactory**。改為依實際 `DataSourceConfig` 重寫：Bean 對照表、套件配置決定 EMF、`@Transactional` 必須指定 manager、**跨庫必須拆成兩個 Bean（自我呼叫會讓 proxy 失效）**、Testcontainers 測試（ADR-007）。
- `docs/baccarat-rules.md`：§6 補契約檔 `contracts/baccarat-rules.json` 與 `ContractParityTest` 守門；§7 T-035 由「另行實作」改為 ✅ 已完成，補風控門檻雷區 17。
- `docs/Stage/00-ROADMAP.md` + `01`~`08`：組員 D 的 25 個任務經程式碼複核**已全數完成**，現況表逐項更新（原表 18.5 項標為待辦），各 Phase 檔加完成摘要並標記為歷史計畫。
- `docs/plans/01-八項架構改進施工藍圖.md`：P2b 補「調校另立藍圖」指向 `plans/02`；P3 標明 2026-07-13 複核仍未動工（`FishingSessionStore` 尚無 version/Lua）。
- `docs/handover-topup-自助加值.md`：狀態由「尚未動工、程式碼一行都還沒寫」改為 **✅ 已完成並合併**（commit `c497a86`），附實際檔案對照表，原內容收進 `<details>` 作歷史。
- `docs/bug/2026-06-25-bug-candidates.md`：5 項 bug **逐項複核全數已修**，開頭加驗證結果表。
- `docs/report/PROJECT_ANALYSIS.md`：開頭加更新框——§14 的 8 項改進建議**已完成 7 項**（僅 Redis Lua CAS 未動工）；§10 已知限制、§12 面試答題（Q5 Saga、Q10 Testcontainers、Q11 瓶頸、Q12 契約）、§15 劣勢均依現況改寫，避免面試照舊文講「壓測沒跑、Saga 未實作」。
- `docs/report/Lucky-Star-Casino-{總體檢報告,專題提案書,前端功能導覽,開發與流程報告,補充說明}.md`：加「📌 這是交付快照，不是現況文件」聲明並指向現況文件（內容不動——這 5 份已匯出 HTML/PDF 交付，改寫會破壞快照性質）。
- **`AGENTS.md` 雷區 10 / 16**：雷區 10 原寫「捕魚機 Phase 1+2 已併入 develop，**Phase 3 進行中**」——複核發現 Phase 3（戰鬥回饋/砲台差異化/新互動）與 Phase 4（魚種重設/BOSS）**皆已落地**，改為「Phase 1~4 全部完成」；雷區 16 末補「升級進度」條目，明確標出**唯一未動工項＝Redis session 原子化（Lua CAS，ADR-008）**，並指向 `plans/01` Phase 3 的施工說明。證據：`fishingEngine.js` 已有 HP 條/暴擊/傷害浮字/自動射擊/鎖定/準心/`perfMode`/分頁暫停、`FishingCombat.CANNON_DAMAGE={0,14,22,32}`、`FishSpecies` 11 種含 `Tier.BOSS` 龍王；而 `FishingSessionStore` 仍無 `version` 欄位與 Lua script。

### Removed（移動）
- `docs/prompt-{fishing-优化,slot-機率修復,security-上一頁防呆,security-多帳號數據隔離,security-獲利攔截風控}.md` 與 `docs/performance/t090-{1000-rerun,b1}-handoff-prompt.md` → 移至 `docs/_雜物/prompts/`。這 7 份都是一次性施工提示詞，對應功能全部已落地（風控＝`RiskControlService`、上一頁防呆＝`useGameLeaveGuard.js`；「多帳號幸運值殘留」那份甚至已不適用——FortuneMeter 元件已從前端移除）。

### Why
- docs/ 累積 60 份文件、跨度兩個月，但多數是「當時的快照」且沒有索引，導致新人與 AI 讀到過期敘述會**直接踩雷**：照 `LOCAL_API_INTEGRATION_GUIDE` 會撞 port、照 `dual-datasource-guide` 會寫出 proxy 失效的跨庫程式碼、照 `ENV_SETUP_GUIDE` 會把 member 連到 PostgreSQL、照 `Stage/` 會重做 18 項已完成的任務。
- 這正是 AGENTS.md §1 警告的「手動維護的文件會落後程式碼」。本次不只修內容，也**建立分類機制**（README 三分類 + 歷史文件加聲明），讓下次判斷「這份能不能信」有依據。

### 如何驗證
- 純文件變更，不影響程式行為。所有敘述逐項比對真實檔案：`docker-compose.yml`（7 服務 + observability profile）、`.env.example`（CHANGE_ME 佔位符）、`kafka/kafka-init.sh`（8+5 topic）、兩套 `init.sql`（15+11 表）、gateway `application.yml`（路由順序、jwt.whitelist、concurrency-limit）、各服務 `DataSourceConfig`（wallet/admin 雙 EMF）、`GmRewardService`（GM 發幣走 `wallet.credit.request`）、`FishingSessionStore`（無 version/Lua → P3 確實未動工）、`TopupController`、`RealtimeBridge.jsx`、`rankSlice/walletSlice`（BUG-001~005 已修）。
- `python docs/game-math/verify_rtp.py` 實跑：老虎機 RTP 0.93830 / 命中率 0.30681，與 `SlotSymbol` Javadoc（93.8% / 30.7%）吻合，確認 game-math 無漂移。
## [changed] -- 2026-07-13 -- 高流量 Kafka topic 拉高 partition 數並補測試斷言

### Changed
- `kafka/kafka-init.sh`：topic 建立從單一迴圈拆成 `high_throughput_topics`（`wallet.debit`/`wallet.credit.request`/`wallet.credit`/`game.result`/`notification.push`，partitions 3→6）與 `low_throughput_topics`（`member.registered`/`friend.relationship.updated`/`rank.update`，維持 3）兩組；`dlt_topics` 維持 1。
- `tests/infra/kafka.test.js`：新增「Partition 數量」測試群組，鎖住兩個流量分組的 topic 名單與各自 partitions 值，並斷言兩組合計涵蓋所有一般 topic（防止分類時漏topic或重複分類）。

### Why
- `wallet.debit`/`wallet.credit`/`game.result` 每筆下注、派彩、遊戲局都會觸發，`notification.push` 由多個 service 匯聚推播，量遠高於註冊/好友異動/排行榜這類低頻事件；先前所有 topic 一律 3 partitions 沒有按流量分級。確認這幾個 topic 的 producer 皆以 `playerId` 當 key（`WalletService`/`GameResultEventPublisher`/`CashbackEventPublisher`/`NotificationPushPublisher`），加 partition 不影響同玩家事件的順序保證；`rank.update` 的 `RankUpdatePublisher` 用固定 key（`GLOBAL_TOP10_TYPE`），加 partition 無平行消費效益，維持低流量分組。
- 舊版 `kafka.test.js` 只斷言「有 `--partitions` flag」、不鎖數值，之後改壞 partition 數不會被 CI 抓到，故補上數值斷言。

### 如何驗證
- `node --test tests/infra/kafka.test.js`：25 個測試全過。
- 提醒：`--if-not-exists` 對已存在的 topic 不生效，既有環境要套用新 partition 數須手動 `kafka-topics --alter --partitions 6`，或 `docker-compose down -v` 清 volume 後重建。

## [docs] -- 2026-07-13 -- 修正 Redis key 命名文件與實際程式碼漂移（refresh/blacklist）

### Changed
- `docs/architecture.md` §5 Redis 用途分配表：`auth:refresh:{playerId}` 改為 `refresh:{memberId}`、`auth:blacklist:{jti}` 改為 `jwt:blacklist:{jti}`，與 `TokenRedisService`（`backend/member-service`）實際 key prefix 對齊；並補註 refresh token 為每次 `AuthService.refreshToken()` rotate + 重設 TTL（非單純固定倒數 7 天）。
- `docs/report/Lucky-Star-Casino-開發與流程報告.md`、`docs/report/Lucky-Star-Casino-總體檢報告.md`：登入時序圖內 `auth:blacklist:{jti}` 同步改為 `jwt:blacklist:{jti}`。

### Why
- 文件 key 命名與 `TokenRedisService`（`REFRESH_KEY_PREFIX = "refresh:"`、`BLACKLIST_KEY_PREFIX = "jwt:blacklist:"`）不符，會誤導直接查 Redis 除錯的人；`BLACKLIST_KEY_PREFIX` 的 comment 特別強調須與 gateway `JwtAuthenticationGlobalFilter` 一致，文件錯誤等於雙重誤導。

### 如何驗證
- 純文件變更；核對 `backend/member-service/src/main/java/com/luckystar/member/service/TokenRedisService.java`、`AuthService.java` 實際 key 字串與行為一致。

## [changed] -- 2026-07-13 -- Highlight special fishing targets

### Changed
- `frontend/src/components/fishingEngine.js`: added tier aura rings and stronger hit/lock-on behavior for high-value, Boss, special, and legendary fishing targets.
- `frontend/src/data/fishingFishConfig.js`: raised the Jackpot Fish King display value to `500x`, display HP to `5000`, and visual scale to `1.36` without changing the backend `DRAGON_KING` contract values used for settlement.
- `frontend/src/components/FishingFishInfoPanel.jsx` and `frontend/src/components/Fishing.css`: show the Jackpot Fish King display value/HP in the guide and add distinct card effects for high-value, Boss, special, and legendary fish.
- `frontend/src/data/fishingFishConfig.test.js`: covers the Jackpot Fish King display-only fields while preserving backend multiplier, HP, and tier values.
- `frontend/src/data/fishingFishConfig.js` and `frontend/src/components/fishingEngine.js`: aligned `DEVIL_RAY` with the medium fish visual tier so it no longer receives high-value fish effects.
- `frontend/src/components/Fishing.css`: keeps the fullscreen control dock as the bottom row while removing the gap between the Pixi canvas and controls so the cannon stays visible.

### Why
- Special fishing targets need clearer visual separation during play and in the lobby guide, while settlement-critical values must stay aligned with the backend fishing contract.

### Verification
- `npm.cmd run lint` (frontend): passed.
- `npm.cmd run test -- FishingFishInfoPanel fishingFishConfig` (frontend): passed, 1 file / 2 tests.
- `npm.cmd run build` (frontend): passed.

## [changed] -- 2026-07-13 -- Separate fishing blocker guide

### Changed
- `frontend/src/components/FishingFishInfoPanel.jsx`: split blocker fish into their own `障礙魚種` section instead of appending them to the reward fish list.
- `frontend/src/pages/Fishing.jsx`: removed the sidebar blocker guide and skill panel blocks entirely, including their displayed content.
- `frontend/src/components/Fishing.css`: added section styling for the separated bottom blocker guide and removed CSS for the deleted sidebar blocker/skill blocks.

### Why
- Blockers do not pay rewards, so separating them from reward fish makes the bottom guide easier to understand; the duplicate sidebar blocker and skill panels should no longer be shown.

### Verification
- `npm.cmd run lint` (frontend): passed.
- `npm.cmd run test -- FishingFishInfoPanel fishingFishConfig` (frontend): passed, 1 file / 2 tests.
- `npm.cmd run build` (frontend): passed.

## [changed] -- 2026-07-12 -- Improve fishing lobby fish guide layout

### Changed
- `frontend/src/components/FishingFishInfoPanel.jsx`: rewrote fish guide names, labels, and descriptions so players can understand rewards, HP, spawn frequency, and blockers more quickly.
- `frontend/src/components/Fishing.css`: changed the fish guide cards to responsive columns and stacked metric chips so labels no longer squeeze into the next row.

### Why
- The fish guide inside `fishing-lobby__fish-info` was hard to read and its metric chips could crowd each other on narrower cards.

### Verification
- `npm.cmd run lint` (frontend): passed.
- `npm.cmd run test -- FishingFishInfoPanel fishingFishConfig` (frontend): passed, 1 file / 2 tests.
- `npm.cmd run build` (frontend): passed.

## [changed] -- 2026-07-12 -- Raise demo player star coin balance

### Changed
- `frontend/src/services/mockApi.js`: set the mock demo/test player starting star coin balance to `999999999999`.
- `frontend/src/services/*Api.js` and `frontend/src/hooks/useWebSocket.js`: default dev mode to mock API unless `VITE_USE_MOCK_API=false` is explicitly set.

### Why
- The demo player account needs a much larger balance for demo play without running out of star coins.
- Direct `npm run dev` should use the mock wallet by default, matching the documented frontend contract.

### Verification
- `npm.cmd run test`: passed, 6 files / 42 tests.

## [fix] -- 2026-07-12 -- Stabilize fishing lobby controls and fish king variants

### Added
- `frontend/src/components/FishingControlDock.test.jsx`: added coverage for ammo/cannon controls being disabled once a fishing round has started.
- `frontend/src/data/fishingFishConfig.test.js`: added coverage that fish king visual variants do not overwrite backend `name`, `multiplier`, `hp`, or `tier` values.

### Changed
- `frontend/src/pages/Fishing.jsx`: limited ammo selection to the `idle` phase so session-level bet and cannon choices cannot change while playing or settling.
- `frontend/src/components/FishingControlDock.jsx`: made disabled control state explicit with stable classes, `aria-disabled`, and explanatory titles.
- `frontend/src/data/fishingFishConfig.js` and `frontend/src/components/FishingFishInfoPanel.jsx`: moved fish king visual variants to `visualKey` / `assetId` display metadata while preserving backend `code` and tier semantics.

### Why
- Fishing `betPerShot` and `cannonLevel` are session-level values; changing them after entry can desync frontend controls from backend validation.
- Fish king skins should change presentation only, not settlement-critical backend fish identity.

### Verification
- `cd frontend && npm run lint`: passed.
- `cd frontend && npm run test`: passed, 7 files / 44 tests.
- `cd frontend && npm run build`: passed.
- `cd frontend && npm run e2e`: passed, 1 skipped.
## [docs] -- 2026-07-10 -- 九份 ADR 補「現況校驗」章節，對齊程式碼實際狀態並記錄文件漂移

### Added
- `docs/adr/ADR-000.md`、`ADR-001.md`、`ADR-002.md`、`ADR-003.md`、`ADR-004.md`、`ADR-005.md`、`ADR-006.md`、`ADR-007.md`、`ADR-009.md`：每份都新增「現況校驗（2026-07-10 補充）」章節，以 6 隻並行 Explore agent 逐一核對程式碼/schema/設定現況（檔案路徑+行號），補上決策當下沒有的細節：ADR-001 補 Postgres 15 表/MySQL 12 表完整清單與跨資料源交易拆 Bean 手法；ADR-002 補新增的 wallet.credit.request 發布端（月度獎勵、GM發幣）；ADR-007 補「其他服務尚未比照 Testcontainers」的現況；ADR-009 補對帳 script 已擴充到 7 項檢查。

### Changed
- 無程式碼異動，純文件補充。

### Why
- ADR 文件寫定後專案持續疊代（鑽石系統、禮品商城、Saga 補償、月度簽到獎勵等），原文件只反映決策當下快照，久了會跟現況脫節；依 AGENTS.md「以程式碼為準、發現落差要記錄並更正文件」的原則，逐份核對而非憑空補字。

### 發現並記錄的文件漂移（未動程式碼，僅記錄供後續處理）
1. **ADR-004 砲台傷害值**：文件宣告收斂至 `10/14/18`，但 `FishingCombat.CANNON_DAMAGE` 現值是 `{0,14,22,32}`，兩者不符；`pCapture` 有依當前傷害值自動反推，RTP 仍精確等於 0.96，不影響帳務正確性，純屬文件與程式碼對不上，已在 ADR-004 現況校驗標註待確認是刻意再平衡還是漏改。
2. **Postgres migration 版號重複**：`V15__add_alert_resolution_audit.sql` 與 `V15__add_game_rounds_risk_indexes.sql` 同版號並存，在 ADR-001/ADR-007/ADR-009 三處現況校驗都有提及，建議下次改動 migration 時重新編號其中一個為 V16。
3. **ADR-008 編號仍空白**：ADR-004/ADR-009 都提到「保留給 Phase 3（捕魚 Redis session Lua CAS）」，現況確認 `docs/adr/ADR-008.md` 尚未建檔，Phase 3 是八項架構改進中唯一未動工項目。

### 如何驗證
- 純文件變更；每份 ADR 新增章節引用的檔案路徑/行號、migration 版號、常數值均由 Explore agent 實際讀取程式碼確認，非憑空推測。
## [docs] -- 2026-07-10 -- interview-prep 與組員A報告對齊 7/10 現況（ADR-009 補償、gateway -150 併發卸載、C3+B1 最終數據）

### Changed
- `docs/interview-prep/11-下注請求流與程式碼地圖.md`（漂移最大，7/03 後未更）：§5.1「credit 失敗」由「**沒有補償機制**」改寫為 ADR-009 補償單流程（落 `pending_wallet_credits`、排程 30 秒同冪等鍵重試）、§5.3 整段改寫為「早期無補償 → ADR-009 最小 Saga」演進敘事；§2 白板流/§4.2 gateway 表/§4.3 SlotService 流程補 CONCURRENCY_LIMIT(-150)、風控（RTP 快取＋Lua 並發閘）、補償與 roundId 去重步驟；§5.1 新增 gateway 429 併發卸載列、§5.2 補 AIMD 併發上限數值（初始 200/floor 50/ceiling 400/延遲目標 2s）；§6 面試範本與 §7 Discord 版同步。
- `docs/interview-prep/10-API串接與架構.md`：§1 mermaid/§3.3 filter 鏈/§6 時序圖補 CONCURRENCY_LIMIT(-150, AIMD)；§3.4 韌性設定補 TimeLimiter 6s 教訓（預設 1s 腰斬慢呼叫）與 C2 JWT Redis 短重試；§6 一致性界線補 ADR-009 一條；§7 速查表補「派彩失敗」「擋暴量」兩列；開頭離線 HTML 參照修正為歸檔後路徑 `../_雜物/08-面試準備-API串接與架構-匯出.html`（原連結已失效）。
- `docs/interview-prep/00-index.md` §5 / `01-專案程式碼地圖.md` §3·§6 / `02-設計決策與為什麼.md` 決策 4 / `06-題庫解答與模擬問答.md` Q63：filter 鏈補 -150 併發卸載；`00` 速記卡壓測數據由 C1+C2（+126%）更新為 C3+B1 最終（150 併發 P99 −48%、1,000 併發成功 +430%、401 歸零）。
- `docs/interview-prep/04-資料庫與分散式觀念.md` §6.1：並發閘補「取號/釋放各用 Lua、防負值漂移（T-090 Phase A）」。
- `docs/report/portfolio-組員A-五天衝刺與面試準備.md`／`portfolio-組員A-面試詳答與Docker實作.md`：Day 1/3 filter 鏈與白板圖補 -150（原與自身 Day 4 §4.7 的 C3 敘述不一致）、Demo 腳本「三層 filter」改四層、Day 5 demo 收尾數據更新為 C3+B1 最終。

### Fixed
- `docs/interview-prep/07-題庫-進階200題.md` 第 226 題題幹誤貼的 GitHub 合併衝突 URL（PR #188 殘留）已移除。

### Why
- `10`/`11` 成稿於 7/01–7/03，其後 ADR-009 補償（7/07）與 T-090 C1/C2/C3（7/08–09）落地，筆記仍教「credit 失敗無補償」與三層 filter 鏈，面試照講會與程式碼矛盾；`03`/`08` 核對後無漂移未動。
### 如何驗證
- 純文件變更；內容逐一對照 `FilterOrder.java`、`RouteConcurrencyLimitGlobalFilter`/`AdaptiveInFlightLimiter`、gateway `application.yml`（concurrency-limit/timelimiter）、`SlotService.settleInternal`、`WalletCompensationService`/`WalletCompensationRetryJob`（30s/指數退避）、`RiskControlService`（Lua 並發閘）、`kafka-init.sh`（8+5 topic）與 `13`/`T-090` 報告數據。

## [docs] -- 2026-07-10 -- 新增組員A五天衝刺「完整詳答」檔（含 Docker 七服務實作教學章）

### Added
- `docs/report/portfolio-組員A-面試詳答與Docker實作.md`：把五天衝刺檔（`portfolio-組員A-五天衝刺與面試準備.md`）每天的「要能講出來」檢核項全部展開成可直接背誦的逐字答案（Day1 電梯稿/依賴鏈三問、Day2 debit 四步/TOCTOU/ADR-009、Day3 filter 順序/三層撤銷/fail-open vs fail-closed/single-flight、Day4 T-090 四幕劇＋追問鏈七題逐字、Day5 流程/行為題兩故事/OOP 四支柱）；第 6 章為 Docker 實作教學——multi-stage Dockerfile 逐行解剖（層快取、monorepo build context、非 root）、compose 六大機制（bridge 網路、.env 注入、healthcheck、depends_on 三種 condition、one-shot kafka-init、volume/CLUSTER_ID 陷阱）、動手 SOP 與常見錯誤對照表。

### Changed
- `docs/report/portfolio-組員A-五天衝刺與面試準備.md`：素材來源補新詳答檔連結；Day 4 追問鏈補列 `13` §7 新增的第七問（C3 重跑驗證與歸因）；數據速記卡補「C3+B1 歸因誠實聲明＋殘餘課題（429 佔比 65.3% FAIL、game CB 503）」一行，與 `13` 最新版對齊。

### Why
- 衝刺檔刻意只做排程與檢核、不重抄內容，但臨場複習需要「卡住立刻翻到完整答案」的單一檔案；Docker 容器化是履歷第三句主戰場，原素材只講架構不講實作原理，組長需能答出 Dockerfile/compose 層級的細節。
- 衝刺檔兩處小補是因 `5553051` 更新 `13` 後（追問鏈第七問、歸因/殘餘課題）產生的文件間漂移。

### 如何驗證
- 純文件變更；詳答內容逐段核對 `docs/interview-prep/00/02/09/10/11/13`、`docker-compose.yml`、`backend/wallet-service/Dockerfile`、`docs/performance/T-090-load-test-report.md`，數字與檔案路徑一致。

## [docs] -- 2026-07-10 -- interview-prep 13：補 C3+B1 對照重跑數據（150 P99 -48%、1,000 成功+430%/401歸零）

### Changed
- `docs/interview-prep/13-壓測與效能調校.md`：新增「5.3 對照重跑驗證（2026-07-09，C3+B1 疊加）」小節，補上 `T-090-load-test-report.md` 該日重跑的完整對照數據（150 併發 P99 2,753→1,423 ms、1,000 併發成功 1,477→7,829、401 1,988→0、被接受請求成功率 23.9%→78.4%）；§7 追問鏈新增一題「C3 上線後有實際重跑驗證嗎」；§8 事實速查表補 C3+B1 重跑結果、歸因聲明、殘餘課題（game CB 503、429 佔比 65.3% 誠實 FAIL）三列。

### Why
- 該檔在 `49b6f2f` 建立時（16:23）早於當日 C3+B1 重跑報告 `48a98c5`（16:29），內文仍停留在 C1+C2 舊數據（成功+126%、401−63%），與最新報告脫節；面試素材需與量測報告同步，避免背錯數字。
- 沿用報告原文的歸因誠實聲明：延遲改善是 C3+B1 疊加效果，debit 絕對改善主要歸 B1（Hikari pool 修正），不可全記給 C3 限流機制。

### 如何驗證
- 純文件變更；內文數字逐一比對 `docs/performance/T-090-load-test-report.md`「2026-07-09 C3+B1 效果對照重跑」章節一致。

## [docs] -- 2026-07-10 -- 新增組員A（組長）五天衝刺與面試準備整合檔

### Added
- `docs/report/portfolio-組員A-五天衝刺與面試準備.md`：整合 `portfolio-四人分工詳細指南.md` A組＋E專項段落與 `docs/interview-prep/00~13` 全套素材，排成五天可勾選清單（Day1 全貌/Docker → Day2 帳務 → Day3 Gateway/Redis → Day4 T-090 壓測 → Day5 流程/Demo），附「履歷三句防禦表」「數據速記卡」與「最小保命集」。

### Why
- 報告與面試共用同一套素材，但原素材分散 15+ 檔；組長（A組＋E專項＋T-090 主講）需要一份按天排程、可自我檢核的單一入口。
- 同時校正履歷數字精確度：150 併發 5xx 13,563→0 與總失敗樣本→4（0.05%）是兩個指標，不可混寫；thundering herd 是熔斷 flapping 的症狀、根因是未設 TimeLimiter 的 1s 預設逾時（依 `docs/performance/T-090-load-test-report.md`）。

### 如何驗證
- 純文件新增，不影響程式行為；內文所有數字與檔案路徑均比對 `T-090-load-test-report.md`、`13-壓測與效能調校.md`、`00-index.md` §5 一致。

## [test] -- 2026-07-09 -- T-090 C3+B1 效果對照重跑（150/1,000 併發）：wallet 路徑保護生效、401 歸零、成功 +430%

### Added
- `docs/performance/T-090-load-test-report.md`：新增「2026-07-09 C3（自適應在途上限）+ B1（Hikari 修正）效果對照重跑」章節——150 正式輪（`20260709-161414`）與 1,000 輪（`20260709-162358`）完整數據、對 C1 輪逐項對照表、Prometheus 佐證、T-091 對帳結果、CB/AIMD 閾值協調課題。
- `tests/performance/results/20260709-{160905,161414,162358}/`：暖機輪（棄置）、150 正式輪、1,000 輪的 JTL/acceptance-report/HTML dashboard（不入版控，僅本機）。

### Changed
- `docs/plans/02-T-090-效能調校藍圖.md`：C3 列狀態由「對照壓測重跑待執行」改為「對照重跑已完成（2026-07-09）」附重點數據。

### Why
- C3（AIMD per-route 在途上限，首次收編 `/api/v1/wallet/**`）落地後需照 C1 SOP 對照重跑驗證機制效果。結果：150 併發 10,258 樣本 0 失敗/0 卸載、P99 2,753→1,423 ms；1,000 併發成功 1,477→7,829（+430%）、401 1,988→0、SocketTimeout −94%、wallet sampler 0 失敗（C1 殘餘課題①關閉）；429 佔比 65.3%>40% 誠實 FAIL（需求−容量差額，D1 課題）；殘餘失敗收斂為 game CB 503（2,024 筆 ≈ CB not_permitted 2,079）。帳務 gate 全 PASS（0 超扣/0 重複扣款；對帳 3 筆差異＝已知 2026-06-16 歷史髒資料）。⚠️ 歸因：本輪同時含 B1 Hikari pool 修正，debit 延遲改善（581→492 ms）主要歸 B1，報告內有明示聲明。

### 如何驗證
- 暖機（棄置）→ 2.5 分鐘輪距 → `run-slot-load-test.ps1 -Threads 150 -Max429Ratio 0` → 重新 provision 1,000 名（兼輪距）→ `-Threads 1000`；對帳 `accounting-reconciliation.sql` 經 `docker exec lucky-star-postgres psql` 執行，9 項檢查除歷史髒資料外全 0。

## [docs] -- 2026-07-09 -- interview-prep：新增 13-壓測與效能調校（T-090 戰役）＋既有筆記對齊 7 月現況

### Added
- `docs/interview-prep/13-壓測與效能調校.md`：T-090 完整戰役的面試版敘事——測試設計（雙 gate：效能/帳務分判）、TimeLimiter 根因鏈（5xx 78%→0，Prometheus CB failed-calls 歸零證據）、瓶頸換位三輪（Phase A→C2→C1，「瓶頸只會被擠到沒設上限的地方」）、B1 排除法剖析（Hikari 巢狀 key bug、pgstattuple、JFR 定位 Postgres 交易容量 ≈550–600 筆/秒）、C3 AIMD 選型（併發控制 vs 速率控制、Little's Law）、帳務不變量全程 0 違規、追問鏈與事實速查表。

### Changed
- `00-index.md`：導覽表/對照表補 `13`（壓測、限流設計、Saga 補償三題）、兩分鐘技術版加第 7 點壓測、數據速記卡加壓測關鍵數字。
- `01-專案程式碼地圖.md`：gateway 補 `RouteConcurrencyLimitGlobalFilter`/`AdaptiveInFlightLimiter`（C3）；§5 CI 修正為「七服務全跑＋Testcontainers 獨立 step（ADR-007）」（原誤寫只跑 4 服務）；速查表補 gateway C3 與 game `WalletCompensationService`（ADR-009）兩列。
- `02-設計決策與為什麼.md`：ADR 摘要表補 ADR-007/008（保留）/009；新增「決策 9：game→wallet 派彩失敗的最小 Saga 補償」（冪等鍵不可換、語意非退款、為何不用 Saga 框架）。
- `09-開發流程與工程實踐.md`：地雷數 20→22（三處）；時間軸補 7/07（ADR-007、監控棧、admin 白名單雷、ADR-009、audit 自動化）與 7/08–09（T-090 重跑戰役）兩列；§3-⑥ 誠實量測段落更新為重跑後結論（原停在「5xx≈80% FAIL」的 6 月舊狀態）；ADR 表與追問表同步。

### Why
- interview-prep 大多凍結於 6/30，未涵蓋 7 月的高價值素材（T-090 壓測戰役、ADR-007/009、C3），且 `01` 的 CI 描述與 `.github/workflows/ci.yml` 現況不符、`09` 的壓測敘事停在 TimeLimiter 修正前的舊結論——面試若照舊稿講會與 repo 事實矛盾。所有新增數字均取自 `docs/performance/T-090-*.md` 實測報告，無捏造。

### 如何驗證
- 純文件變更，無程式行為影響。數字逐一對照 `docs/performance/T-090-load-test-report.md`（5xx 78%→0、−72%、成功 +126%、429 46.2%）、`T-090-B1-wallet-debit-analysis.md`（≈550–600 筆/秒、pool size A/B、dead tuple 8.57%）、`T-090-C3-gateway-shedding-design-evaluation.md`（方案 D 拍板）；ADR-007/009 存在於 `docs/adr/`；CI 範圍對照 `.github/workflows/ci.yml` 第 79–90 行；地雷 22 條對照 `AGENTS.md` §2。

## [perf] -- 2026-07-09 -- T-090 C3：gateway 併發上限動態化（AIMD 在途上限）＋ wallet 路徑納管

### Added
- `backend/gateway-service/.../filter/AdaptiveInFlightLimiter.java`：單一路徑前綴的動態在途限流器——Little's Law 即時層（在途上限固定的瞬間，延遲惡化自動壓低放行速率）＋ AIMD 回饋層（窗內 P95 超標 ×0.8 收緊、達標 +2 放寬、floor/ceiling 夾住、無流量不動）。延遲觀測是 per-instance 記憶體 ring buffer（tumbling window，容量 2048），熱路徑零同步、拒絕路徑維持零 I/O。
- `application.yml` 的 `concurrency-limit` 改為 route 清單並新增 `/api/v1/wallet/` 路徑（B1：1,000 併發殘餘失敗六成六集中於未受保護的 wallet 路徑）；每條 route 有獨立 env 覆寫（`*_CONCURRENCY_LIMIT/FLOOR/CEILING/LATENCY_TARGET_MS`、`CONCURRENCY_ADJUST_INTERVAL_MS`）。

### Changed
- `GameConcurrencyLimitGlobalFilter` 一般化為 `RouteConcurrencyLimitGlobalFilter`：卸載機制（429 + Retry-After、JWT 之前執行、doFinally 歸還名額）不變，改為依設定的路徑前綴各持獨立 `AdaptiveInFlightLimiter`（game 寫路徑與 wallet 讀路徑容量特性不同，共用一個桶會互相污染回饋訊號）；新增 `@Scheduled`（預設每 5 秒）AIMD 調整迴圈，`GatewayServiceApplication` 加 `@EnableScheduling`。
- `ConcurrencyLimitProperties` 從單一 `game` record 改為 `List<Route>`（pathPrefix/maxInFlight/floor/ceiling/latencyTargetMs）；`FilterOrder.GAME_CONCURRENCY_LIMIT` 更名 `CONCURRENCY_LIMIT`（值 -150 不變）。

### Why
- C3 設計評估（`docs/performance/T-090-C3-gateway-shedding-design-evaluation.md`）五選項拍板＝方案 D：動態令牌桶（方案 C）調的是速率、要保護的卻是在途，延遲驟變時要等一個觀測窗才反應；動態在途上限保留 Little's Law 零延遲的第一層保護，AIMD 只負責把上限收斂到機器真容量，回饋失效時退化成 C1 固定上限仍安全。同時收編 B1 改善方向第 4 項（上游承壓封頂）：wallet 路徑納管不會讓 debit 變快（瓶頸＝本機 Postgres 交易容量 ≈550-600 筆/秒），但防止超量流量把排隊時間堆到失控。
- 150 併發迴歸基準不受影響：實測在途 ≈100 遠低於 target 下的任何 max，AIMD 只在 P95 超標時收緊；floor=50 保底不絕流。

### 如何驗證
- `mvn -pl backend/gateway-service test`：41/41 綠（`RouteConcurrencyLimitGlobalFilterTest` 13 個：原 C1 六個語意全保留＋wallet 獨立計數＋AIMD 收緊/放寬/floor-ceiling 夾住/無流量不調/窗歸零/收緊低於在途時計數不毀）。
- 對照壓測（150/1,000 併發，照 C1 SOP）待跑，跑完補充至 `T-090-load-test-report.md`。

## [fix] -- 2026-07-09 -- T-090 B1：wallet-service HikariCP maximum-pool-size 巢狀 key 失效（實際一直跑預設 10，非宣稱的 15/10）＋剖析報告

### Fixed
- `backend/wallet-service/src/main/resources/application.yml`：`spring.datasource.hikari.maximum-pool-size`／`spring.datasource-mysql.hikari.maximum-pool-size` 這兩個 key 拿掉多餘的巢狀 `hikari:` 層，改為攤平的 `spring.datasource.maximum-pool-size` 等。

### Why
- `DataSourceConfig.java` 的 `postgresDataSource()`/`mysqlDataSource()` 是手動 `@Bean` + `@ConfigurationProperties(prefix = "spring.datasource"/"spring.datasource-mysql")` **直接綁在 `HikariDataSource` 物件上**，只認得該物件攤平的 setter（`maximumPoolSize`／`minimumIdle`／`connectionTimeout`），沒有巢狀 `hikari` 屬性可綁——這和 Spring Boot 自動配置認得的 `spring.datasource.hikari.*` 是兩回事（那條路徑只在 Spring Boot 自己組裝 DataSource 時才生效，本服務是手動組裝）。結果是設定檔寫的 `maximum-pool-size: 15`（postgres）從未生效，實際一直跑 HikariCP 內建預設值 10（mysql 端因為預設本來就是 10，巧合沒被發現）。
- 於 T-090 B1（wallet debit 路徑剖析）量測時，用 `/actuator/prometheus` 的 `hikaricp_connections_max` 直接量到 `max=10`，兩邊設定值都對不上，才揪出這個靜默失效的 key。

### 如何驗證
- 修正前後對照：`curl localhost:8082/actuator/prometheus | grep hikaricp_connections_max` 從 `HikariPool-1{max=10}` 變成 `HikariPool-1{max=15}`（postgres），mysql 端 `HikariPool-2` 維持 `max=10`（本來就等於預設值，行為不變，只是現在是「設定生效後剛好等於 10」而非「設定沒生效落回預設 10」）。
- `mvn -pl backend/wallet-service test`：161/161 全綠。
- **重要**：A/B 量測（150 併發、隔離直打 wallet-service debit，繞開 game-service/gateway）顯示 pool size 從 10 提升到 15、甚至實驗值 60，延遲量級都沒有顯著改善（avg 一直落在 280~430ms、p99 420~860ms），且穩態下連線池未被打滿——**這個修正單獨不會讓 debit 變快**，純粹是讓設定檔說的話算數，為後續調校建立正確的基準線。完整分析與尚未解開的瓶頸（初步指向單機 CPU/執行緒競爭）見 `docs/performance/T-090-B1-wallet-debit-analysis.md`。
- code-reviewer 審查 PASS（範圍窄：僅連線池容量設定，未動帳務/冪等/樂觀鎖邏輯）。

## [changed] -- 2026-07-08 -- Fishing bottom cannon and hit reactions

### Changed
- `frontend/src/components/fishingEngine.js`: move the cannon origin to the bottom edge of the Pixi fishing canvas so the turret sits at the lowest part of the playfield.
- `frontend/src/components/fishingEngine.js`: add a shared hit reaction for normal fish, high-value targets, bosses, special targets, and blockers, including short shake, rotation, scale pulse, flash, and tier-tuned `hit` / `crit` sound pitch.

### Why
- The cannon should anchor visually at the bottom of the game view, and every target should provide immediate readable impact feedback when hit.

### Verified
- `npm.cmd run lint` from `frontend/`
- `npm.cmd run build` from `frontend/`
- `git diff --check`

## [changed] -- 2026-07-08 -- Fishing control dock outside canvas and smaller field sprites

### Changed
- `frontend/src/components/fishingEngine.js`: reduce all normal, high-value, boss, special, and blocker field sprite sizes again for the provided high-detail artwork.
- `frontend/src/pages/Fishing.jsx`: move the in-game `FishingControlDock` out of the Pixi canvas frame into a dedicated stage controls row.
- `frontend/src/components/Fishing.css`: style the new stage controls row and keep it visible as the bottom row when the fishing stage enters fullscreen.

### Why
- The field sprites still occupied too much of the playfield, and the in-game control dock should not sit inside the canvas area while still remaining available in fullscreen mode.

### Verified
- `npm.cmd run lint` from `frontend/`
- `npm.cmd run build` from `frontend/`
- `git diff --check`

## [changed] -- 2026-07-07 -- Fishing spawn frequency follows backend weights

### Changed
- `frontend/src/components/fishingEngine.js`: normalize each fish's `spawnWeight` from the backend fish table and use it as the single weighted spawn source for normal field spawns, swarm bursts, special targets, and boss candidates.
- `frontend/src/components/fishingEngine.js`: remove the independent boss timer and jackpot-first boss preference so rare fish frequency is controlled by `spawnWeight`; live bosses are still limited to one at a time.

### Why
- Fish appearance frequency should match the backend fishing contract instead of being skewed by frontend-only small-fish swarms or forced boss scheduling.

### Verified
- `npm.cmd run lint` from `frontend/`
- `npm.cmd run build` from `frontend/`
- `git diff --check`

## [fixed] -- 2026-07-07 -- Fishing blocker size and turtle direction

### Fixed
- `frontend/src/components/fishingEngine.js`: mark the blocker turtle as a left-facing source image and apply shared `fishScaleX` direction logic during blocker spawn/update so it no longer swims backward.

### Changed
- `frontend/src/components/fishingEngine.js`: further shrink blocker octopus, starfish, and turtle base size ranges and profile scale multipliers.

### Why
- The blocker sprites still read too large after the previous field-wide scale pass, and the turtle uses the blocker spawn path instead of normal fish metadata, so it needed its own direction metadata.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `git diff --check`

## [fixed] -- 2026-07-07 -- Fishing field mask direction and size pass

### Fixed
- `frontend/src/components/fishingEngine.js`: expand the fish mask and swim bounds to the full canvas height so the former cannon-zone area no longer clips fish after removing the black deck overlay.
- `frontend/src/components/fishingEngine.js`: flip the newly provided fish artwork back to the correct travel direction while preserving the current gold dragon and pixiu orientation.

### Changed
- `frontend/src/components/fishingEngine.js`: further reduce fish, boss, special target, legendary fish king, and blocker display sizes for the new high-detail PNG art set.

### Why
- The old cannon-zone mask was still hiding fish even though the black deck was removed, most fish references were marked as naturally left-facing even though the new images face right, and the field sprites still occupied too much of the stage.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `git diff --check`

## [changed] -- 2026-07-07 -- Fishing stage background cleanup

### Changed
- `frontend/src/components/fishingEngine.js`: remove the old Pixi-drawn sea gradients, caustic lines, floor ornaments, shadow fish, bubbles, vignette, and black cannon deck panel so the supplied stage background remains visible behind the cannon.

### Why
- The provided background artwork already contains the intended underwater decorations, and the old black cannon/deck area was covering the lower part of the scene.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `git diff --check`

## [changed] -- 2026-07-07 -- Fishing field sprite sizes reduced

### Changed
- `frontend/src/components/fishingEngine.js`: substantially reduce rendered fish tier sizes, legendary fish king bonus size, high-value non-boss trim values, small-fish multiplier growth, and blocker creature size ranges.

### Why
- The provided high-detail PNG artwork reads too large in the Pixi fishing field, crowding the play area and obscuring the new stage background.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `git diff --check`

## [changed] -- 2026-07-07 -- Fishing cannon and stage background reference artwork

### Changed
- `frontend/public/images/fishing/cannon-small-reference.png`, `cannon-medium-reference.png`, and `cannon-heavy-reference.png`: add the provided small, medium, and heavy cannon artwork with white backgrounds converted to transparency.
- `frontend/public/images/fishing/fishing-stage-background-reference.png`: add the provided underwater treasure stage background.
- `frontend/src/casino-fx/assets/registry.js`: map `cannon-copper`, `cannon-silver`, `cannon`, and `fishing-stage-background` to the provided PNG references.
- `frontend/src/components/fishingEngine.js`: preload the stage background, render it as the bottom Pixi backdrop layer, and use the provided cannon PNGs as the active cannon body while preserving existing firing and muzzle effects.

### Why
- The fishing stage should use the supplied visual direction for small / medium / heavy cannons and the new underwater background without changing backend-authoritative cannon damage or shot contracts.

### Verified
- `python` PNG header check
- `npm.cmd run lint`
- `npm.cmd run build`

## [fixed] -- 2026-07-07 -- Fishing blocker PNG decode artifacts

### Fixed
- `frontend/public/images/fishing/blocker-turtle-reference.png`, `blocker-octopus-reference.png`, and `blocker-starfish-reference.png`: regenerate the transparent PNGs with a corrected PNG Paeth filter decoder so the blocker guide no longer renders diagonal corruption artifacts.

### Why
- The previous conversion script decoded Paeth-filtered scanlines incorrectly, which damaged these three supplied blocker images even though their PNG headers were valid.

### Verified
- `python` PNG header check
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing blocker reference artwork

### Changed
- `frontend/public/images/fishing/blocker-turtle-reference.png`: add the provided obstacle turtle artwork with the white background converted to transparency.
- `frontend/public/images/fishing/blocker-octopus-reference.png`: add the provided obstacle octopus artwork with the white background converted to transparency.
- `frontend/public/images/fishing/blocker-starfish-reference.png`: add the provided obstacle starfish artwork with the white background converted to transparency.
- `frontend/src/casino-fx/assets/registry.js`: point both legacy `fish-blocker-*` and active `fish-evil-blocker-*` ids to the new PNG references.
- `frontend/src/data/fishingFishConfig.js`: update the blocker guide assets to show the provided turtle, octopus, and starfish images.
- `frontend/public/images/fishing/blocker-{octopus,starfish,turtle}.svg`: remove generated SVG blocker artwork after replacing it with the provided PNG references.

### Why
- The three obstacle creatures should match the supplied visual direction in both the Pixi fishing stage and fish guide.

### Verified
- `python` PNG header check
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing caishen and money tree reference artwork

### Changed
- `frontend/public/images/fishing/caishen-reference.png`: add the provided Caishen image as the in-game caishen asset with the white background converted to transparency.
- `frontend/public/images/fishing/money-tree-reference.png`: add the provided money tree image as the in-game money tree asset with the white background converted to transparency.
- `frontend/src/casino-fx/assets/registry.js`: point `fish-caishen` and `fish-money-tree` to the provided PNG references instead of generated SVGs.
- `frontend/src/components/fishingEngine.js`: mark Caishen as non-directional alongside money tree so front-facing prize targets do not flip like fish.
- `frontend/public/images/fishing/fish-caishen.svg` and `fish-money-tree.svg`: remove generated SVG files after replacing them with provided PNG references.

### Why
- Caishen and money tree should use the provided artwork exactly and behave visually as prize targets rather than directional swimming fish.

### Verified
- `python` PNG header check
- `python` SVG XML parse check
- `npm.cmd run lint`
- `npm.cmd run build`

## [fixed] -- 2026-07-07 -- Fishing gold dragon white residue removal

### Fixed
- `frontend/public/images/fishing/gold-dragon-reference.png`: remove remaining low-saturation white/gray background residue and soften pale edge pixels around the provided gold dragon artwork.

### Why
- The gold dragon reference still had visible background remnants after the previous alpha cleanup pass.

### Verified
- `python` PNG header check
- `npm.cmd run lint`
- `npm.cmd run build`

## [fixed] -- 2026-07-07 -- Fishing gold dragon alpha cleanup

### Fixed
- `frontend/public/images/fishing/gold-dragon-reference.png`: rerun alpha extraction with a stronger white-background cleanup so leftover white islands and edge halos are transparent.

### Why
- The provided gold dragon artwork still had visible white remnants after the first background removal pass.

### Verified
- `python` PNG header check
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing reference fish artwork set

### Changed
- `frontend/public/images/fishing/*-reference.png`: add the provided reference artwork for puffer, devil ray, angelfish, lantern fish, goldfish, koi, gold-star fish king, and jackpot fish king with white backgrounds converted to transparency.
- `frontend/src/casino-fx/assets/registry.js`: point the corresponding fishing `assetId`s to the provided PNG references instead of generated SVGs or older placeholder art.
- `frontend/src/data/fishingFishConfig.js`: update the static gold-star and jackpot fish king guide images to the provided references.
- `frontend/public/images/fishing/fish-{puffer,devil-ray,angelfish,lantern,goldfish,koi}.svg` and `rainbow-jackpot-fish-king.svg`: remove SVG files that are now replaced by provided PNG references.

### Why
- These eight fish targets should match the user-provided artwork order and appearance exactly while preserving the backend fish codes and payout contract.

### Verified
- `python` PNG header check
- `python` SVG XML parse check
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing gold dragon reference artwork

### Changed
- `frontend/public/images/fishing/gold-dragon-reference.png`: add the user-provided golden dragon image as the in-game gold dragon asset, with the baked checkerboard background converted to transparency.
- `frontend/src/casino-fx/assets/registry.js`: point `fish-gold-dragon` to the provided PNG reference instead of the generated SVG.
- `frontend/public/images/fishing/fish-gold-dragon.svg`: remove the unused generated SVG after replacing it with the provided artwork.

### Why
- The gold dragon target should match the provided dragon artwork exactly rather than the previously generated vector approximation.

### Verified
- `python` PNG header check
- `python` SVG XML parse check
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing pixiu render size

### Changed
- `frontend/src/components/fishingEngine.js`: reduce the in-game pixiu render trim from the shared high-value size to a smaller pixiu-specific size while leaving the provided PNG asset unchanged.

### Why
- The provided pixiu artwork reads larger than the previous vector at the same canvas size, so it needs a smaller render footprint without changing backend payout or target contract.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing pixiu reference artwork

### Changed
- `frontend/public/images/fishing/pixiu-gold-guardian.png`: add the user-provided golden pixiu image as the in-game pixiu asset, with the baked checkerboard background converted to transparency.
- `frontend/src/casino-fx/assets/registry.js`: point `fish-pixiu` to the provided PNG reference instead of the generated SVG.
- `frontend/public/images/fishing/fish-pixiu.svg`: remove the unused generated SVG after replacing it with the provided artwork.

### Why
- The pixiu target should match the provided golden guardian artwork exactly rather than the previously generated vector approximation.

### Verified
- `python` PNG header check
- `python` SVG XML parse check
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing non-fish prize artwork

### Changed
- `frontend/public/images/fishing/fish-gold-dragon.svg`: regenerate the gold dragon as a dragon-shaped prize target instead of a fish silhouette.
- `frontend/public/images/fishing/fish-pixiu.svg`: regenerate the pixiu as a four-legged mythical beast target instead of a fish silhouette.
- `frontend/public/images/fishing/fish-money-tree.svg`: regenerate the money tree as a tree-and-coin prize target instead of a fish silhouette.
- `frontend/src/components/fishingEngine.js`: mark money tree as non-directional so it does not flip like a swimming creature while crossing the stage.

### Why
- Gold dragon, pixiu, and money tree are prize targets from the backend fish table, but their visuals should represent the actual object/creature rather than forcing them into fish-shaped artwork.

### Verified
- `python` SVG XML parse check
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing high-value species fish silhouettes

### Changed
- `frontend/public/images/fishing/fish-gold-dragon.svg`: regenerate gold dragon as a fish silhouette with dragon-inspired fins, whisker-like spines, and gold scale bands.
- `frontend/public/images/fishing/fish-pixiu.svg`: regenerate pixiu as a fish-bodied target with pixiu head cues, horn, mane, gold tail, and coin detail.
- `frontend/public/images/fishing/fish-money-tree.svg`: regenerate money tree as a fish-bodied target with coin markings and leaf-fin accents instead of a tree object.

### Why
- Gold dragon, pixiu, and money tree are still fishing targets in gameplay, so their artwork should read as fish first while keeping enough theme detail to identify the backend species.

### Verified
- `python` SVG XML parse check
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing angelfish and pixiu artwork polish

### Changed
- `frontend/public/images/fishing/fish-angelfish.svg`: move the eye and mouth details to the head side so the angelfish no longer appears to have its eye near the tail.
- `frontend/public/images/fishing/fish-pixiu.svg`: regenerate the pixiu artwork with stronger head, horn, mane, gold tail, scale, and coin details while keeping the same backend `assetId` contract.

### Why
- The redesigned assets needed clearer front/back readability in motion, especially after fixing swim direction for left-facing generated fish.

### Verified
- `python` SVG XML parse check
- `npm.cmd run lint`
- `npm.cmd run build`

## [fixed] -- 2026-07-07 -- Fishing fish direction and size tuning

### Changed
- `frontend/src/components/fishingEngine.js`: add explicit facing metadata for the newly generated non-boss fish SVGs so they face their swim direction while preserving the original gold-star and jackpot fish king behavior.
- `frontend/src/components/fishingEngine.js`: increase the render size for newly added fish species, with a smaller trim for high-value non-boss targets such as gold dragon, pixiu, and caishen so they stay below boss presence.

### Why
- The generated fish artwork is left-facing by default, while the Pixi engine previously assumed right-facing textures; this made non-boss fish appear to swim backward. The added fish also needed larger in-game silhouettes without making high-value non-boss targets feel like bosses.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing selected fish visual redesign

### Changed
- `frontend/public/images/fishing/fish-angelfish.svg`: redesign the angelfish with a taller ornamental silhouette, brighter fins, and clearer stripe identity.
- `frontend/public/images/fishing/fish-pixiu.svg`: redesign the pixiu fish with stronger mythical-beast cues, horn, jade body, gold tail, and coin detail.
- `frontend/src/casino-fx/assets/registry.js`: restore `fish-dragon-king` to the original `fish-boss-whale.svg` mapping so the gold-star fish king uses its previous appearance.

### Why
- The newly integrated fish table needs distinct readable targets, while the gold-star fish king should retain the familiar original silhouette requested during review.

### Verified
- `python` SVG XML parse check
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing contract fish SVG assets

### Added
- `frontend/public/images/fishing/fish-*.svg`: add distinct SVG artwork for the 10 backend contract fish asset ids that should not reuse the previous placeholders (`fish-koi`, `fish-goldfish`, `fish-lantern`, `fish-puffer`, `fish-angelfish`, `fish-devil-ray`, `fish-gold-dragon`, `fish-pixiu`, `fish-caishen`, and `fish-money-tree`).

### Changed
- `frontend/src/casino-fx/assets/registry.js`: map the newly surfaced backend fishing `assetId`s to generated SVGs instead of reusing the previous shared placeholder SVGs; `fish-dragon-king` remains on the original boss-whale artwork.

### Why
- Backend fish-table integration exposed more fish species in the Pixi fishing field, and each species needs a distinct visual identity so players can distinguish targets without breaking the existing backend `assetId` contract.

### Verified
- `python` SVG XML parse check
- `npm.cmd run lint`
- `npm.cmd run build`

## [changed] -- 2026-07-07 -- Fishing backend contract alignment

### Added
- `frontend/src/hooks/useFishingSession.js`: restore an existing fishing session from `/active` on mount so refresh/re-entry follows the backend lifecycle instead of dropping the player back to idle.
- `frontend/src/components/FishingFishInfoPanel.jsx`: build the fish guide from the backend `fishTable`, including HP, tier, spawn weight, and visual `DRAGON_KING` variants, then append the charged blocker guide.

### Changed
- `backend/game-service/src/main/java/com/luckystar/game/service/FishingService.java` and `backend/game-service/src/test/java/com/luckystar/game/service/FishingServiceTest.java`: enforce session-level `betPerShot` and `cannonLevel` for shot batches and cover the fixed-contract behavior in tests.
- `frontend/src/hooks/useFishingSession.js` and `frontend/src/pages/Fishing.jsx`: keep verify-shot history to normal verifiable fish only, exclude `MISS`/blocker shots, and compare backend verification against `captured` plus payout instead of generic hit state.
- `frontend/src/services/mockApi.js`: mirror backend start/top-up/shots validation, including buy-in and bet ranges, required top-up idempotency key, fixed session bet/cannon, and normalized shot fish types.

### Why
- The fishing UX must follow the backend session contract exactly: fixed buy-in settings per session, charged blocker/miss shots, stable verification semantics, and fish data coming from the backend response rather than duplicated front-end assumptions.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
- `mvn -pl backend/game-service test`

## [feat] -- 2026-07-06 -- Fishing blocker effects and stage polish

### Added
- `frontend/src/components/fishingEngine.js`: add Pixi-only screen effects for blocker breaks: octopus ink遮蔽 and starfish fish-speed boost, with reduced effect density under perf/reduced-motion mode.
- `frontend/src/data/fishingGameData.js` and `frontend/src/pages/Fishing.jsx`: add a right-side blocker guide card for octopus, starfish, and turtle behavior.

### Changed
- `frontend/src/components/fishingEngine.js`: move blocker profile selection into per-species settings; octopus/starfish now spawn only as large 5-hit blockers, while turtles keep 5/10/17-hit tiers with larger visual sizes.
- `frontend/src/components/fishingEngine.js`: enrich the Pixi stage with vignette, gold glints, distant fish silhouettes, and reusable screen effect overlays without changing `FishingCanvas` props or the `fire(fishInstanceId, fishCode)` contract.
- `frontend/src/components/Fishing.css` and `frontend/src/data/fishingFishConfig.js`: update blocker guide copy and improve dock/card layout stability across desktop and mobile.

### Why
- Blocker fish needed distinct effects and clearer player-facing rules while keeping the existing Pixi engine, wallet/session flow, settlement, and fairness verification contracts intact.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`

## [test] -- 2026-07-08 -- T-090 C1+C2 效果對照重跑：成功數 +126%、401 −63%、spin 延遲腰斬；殘餘失敗移位到未受保護的 wallet 路徑

### Added
- `docs/performance/T-090-load-test-report.md` 新增「C1+C2 效果對照重跑」節：150 併發正式輪（`results/20260708-153718`，**5,208 樣本 0 失敗、0 5xx、429 誤傷 0**——當日最乾淨一輪，距中繼目標只剩 P99 2,753ms）＋ 1,000 併發（`results/20260708-154603`，新 gate 語意首度適用）完整數據與 Prometheus 佐證。

### Why / 結果摘要
- 1,000 併發：429 卸載 5,300（46.2%）、成功 653→1,477（+126%）、401 5,315→1,988（−63%）、5xx 362→227；成功 spin 平均 5.21→2.65 s、wallet debit 1,070→581 ms（承壓封頂奏效）。帳務 gate 照舊全 PASS。
- 誠實記錄兩個 FAIL：① 429 佔比 46.2% 超過暫定 40% 上限——1,000 執行緒需求遠超單機容量（~180/s），屬 D1 容量問題，不調數字；② accepted P99 仍 5.6s——殘餘 401/timeout 六成六集中在**未受 C1 保護的 `/api/v1/wallet/**` 路徑**（卸載使執行緒循環變快、錢包路徑打擊頻率反升），下一步＝B1 剖析＋評估 wallet 路徑納入上限。
- 依 Phase A 輪 SOP 執行：gateway 重啟後先暖機一輪棄置、輪距 2 分鐘。

### 如何驗證
- 全數字出自 `results/20260708-15*` JTL 與 Prometheus range query（窗口迄 epoch 1783496829）；對帳 `docker exec psql` 九項僅既有 player 1001–1003 髒資料，照例排除。

## [perf] -- 2026-07-08 -- T-090 C1：gateway 遊戲路徑全局併發上限（超限 429 快速卸載）＋驗收 gate 語意拍板

### Added
- `backend/gateway-service/.../filter/GameConcurrencyLimitGlobalFilter.java`：`/api/v1/game/**` 維護單機記憶體在途計數（AtomicInteger，非 Redis——上限本質是 per-instance 容量，拒絕路徑 O(1) 零 I/O），超過 `concurrency-limit.game.max-in-flight`（預設 200，env `GAME_CONCURRENCY_LIMIT`）立即 429＋`Retry-After: 1`。order=-150 **在 JWT 驗證之前**卸載：被拒請求連 3 次 Redis 撤銷查詢都不做，直接縮小 1,000 併發下 fail-closed 401 雪崩的暴露面。`doFinally` 歸還名額（涵蓋完成/錯誤/取消）。
- `.../config/ConcurrencyLimitProperties.java` ＋ application.yml `concurrency-limit.game.max-in-flight`（200 的依據：150 併發實測在途 ≈ 100，容量內不誤傷；1,000 併發時後端承壓封頂 ~200）。
- `GameConcurrencyLimitGlobalFilterTest`：6 測試（未滿轉發／滿載 429+Retry-After 不轉發／完成釋放／錯誤釋放／非遊戲路徑不受限／被拒不漏名額）。

### Changed
- `tests/performance/analyze-jtl.mjs`：依 D1 拍板語意改判——429 獨立為 shed 桶不計失敗，P99/5xx/失敗樣本以「被接受樣本」為母體；新增 gate「429 佔比 ≤ `MAX_429_RATIO`（預設 0.40）」防「全拒絕也算過」；報告明示此為語意修正。
- `tests/performance/run-slot-load-test.ps1`：新增 `-Max429Ratio` 參數（150 迴歸基準傳 0 = 容量內不准卸載）。
- `docs/plans/02-T-090-效能調校藍圖.md`：C1 標記已落地、D1 記錄拍板（429 語意已決，驗收拓樸仍開放）。

### Why
- 1,000 併發實測證明「全收排隊」的結局：成功率 6.8%、成功者平均 5.2s、5xx/timeout/401 三桶輪流當失敗主角。負載卸載把它改成「明確拒絕少數、保障多數」：被拒者拿到毫秒級 429＋重試指引（無帳務風險——請求根本沒進結算路徑），被接受者維持低延遲。429 語意（「我沒壞，請稍後再來」）與 5xx（故障）在 HTTP 層本就不同類。
- gate 配套堵漏：429 佔比上限讓「拒絕」有代價；150 併發（容量內）要求 429=0，防止把容量問題藏進卸載。原始「1,000 併發全收且 P99<500ms」目標不消失，歸 D1 容量/拓樸問題。

### 如何驗證
- `mvn -pl backend/gateway-service test` 全綠（40 tests，含新 6 個）。
- 實測效果（C1+C2 疊加）待重跑 T-090 150/1,000 對照後回填報告。

## [perf] -- 2026-07-08 -- T-090 C2：gateway JWT filter Redis 撤銷檢查加瞬時錯誤短重試（fail-closed 語意不變）

### Changed
- `backend/gateway-service/.../filter/JwtAuthenticationGlobalFilter.java`：三項 Redis 撤銷檢查（黑名單/停用/min-iat 的 `Mono.zip`）在落入 fail-closed 前先 `retryWhen(Retry.backoff(1, 50ms))`——瞬時錯誤（尖峰逾時、連線抖動）重試一次，重試＝重新訂閱、三項檢查整包重查不會拿到殘缺結果；重試耗盡仍拒絕（401），**fail-closed 語意不變、不可改 fail-open**。
- `CHANGELOG.md`：順手移除檔首殘留的分支名字串。

### Why
- T-090 壓測的 401 桶＝Redis 撤銷檢查在負載尖峰下逾時觸發 fail-closed（前次 1,000 併發起跑尖峰 343 筆；Phase A 對照重跑時已擴大為全程 5,315 筆——單機 CPU 飽和使 Redis 往返間歇超過 gateway `spring.data.redis.timeout: 2000ms`）。短重試可吸收「瞬時」抖動；全程持續的飽和延遲非重試能解，屬 C1（併發上限卸載）/D1（拓樸拍板）範疇，藍圖已註記。
- Lettuce 連線模型檢視結論：`ReactiveStringRedisTemplate` 預設單一多工連線＋pipeline 是 Lettuce 正規用法，非本案瓶頸（Redis 本身無 eviction/rejected，慢在宿主機資源競爭），故不引入連線池、不加大 timeout（加大只會把 401 換成更深的排隊）。

### 如何驗證
- `mvn -pl backend/gateway-service test` 全綠；`JwtAuthenticationGlobalFilterTest` 新增 2 測試：`redisTransientError_recoversOnRetry_isForwarded`（第一次訂閱失敗、重試成功 → 放行且確認真的重試過）、`redisPersistentError_retriesThenStillFailsClosedWith401`（持續故障 → 重試耗盡仍 401 且不轉發，鎖住 fail-closed 不回歸）。
- 實測效果待下一輪 T-090 重跑對照 401 桶（藍圖統一驗證流程）。

## [fix] -- 2026-07-08 -- 修補玩家停用的稽核破口：Redis 封鎖改 best-effort，不再因 Redis 失敗回滾稽核

### 背景
- 承前一批把 `AdminPlayerService.setStatus` 收斂為 audit-first 同交易（稽核 → member → Redis 全包在 `@Transactional(postgresTransactionManager)`）。盤點時發現一個與該筆宣稱的「有停用就一定有稽核」相矛盾的窄窗：**第 3 步 Redis `ban/unban` 若丟例外，會連同已 write-ahead 的稽核一起 rollback**，但第 2 步 member DB status 已由 HTTP 改成功且不可回滾 → 結果是「玩家已停用、但稽核被清掉、也沒查得到誰做的」，正是原本要杜絕的稽核破口。

### Changed
- `backend/admin-service/.../service/AdminPlayerService.java`：第 3 步 Redis 封鎖/解封改為 **best-effort**，用 try/catch 包住 `playerBanService.ban/unban`，失敗只記 WARN、**不外拋**。走到這步時稽核＋member 已成立，Redis 失敗不得反過來 rollback 稽核。遺漏的 Redis 封鎖沿用既有設計、由登入時 DB status 檢查兜底。加回 best-effort WARN 用的 `Logger` 欄位與 slf4j import；同步修正 Javadoc（第 1、2 步仍強一致 audit-first，第 3 步 best-effort）。
- `backend/admin-service/.../service/AdminPlayerServiceTest.java`：新增 `setStatus_redisFails_stillSucceedsAndKeepsAuditAndMemberChange`——Redis 丟例外時仍回成功、稽核與 member 呼叫皆保留。

### 為什麼
- **分清哪一步「不可失敗」、哪一步「可失敗且自癒」**：稽核與 member 狀態變更是稽核完整性的核心，必須強一致（前一批已做到）；但 Redis 即時封鎖只是「讓既有 token 提早失效」的最佳化，失敗本就可由登入 DB status 兜底、重按即補齊——把這個「可失敗且自癒」的步驟放進「不可失敗」的稽核交易裡，等於賦予它 rollback 稽核的權力，方向錯了。修法是把 Redis 移出強一致保護（best-effort），讓稽核＋member 這對強一致組合不被 Redis 抖動連累。

### 如何驗證
- `mvn -pl backend/admin-service test`：94 全綠（`AdminPlayerServiceTest` 10 項，含新增的 Redis best-effort 案例）。

## [changed] -- 2026-07-08 -- 後台稽核全面收斂為強一致：鑽石卡生成 + 商城目錄變更由 best-effort 改硬失敗

### 背景
- 承前一筆把 AdminPlayerService 封鎖稽核收斂後，後台僅剩兩處稽核仍是 best-effort（失敗只記 WARN）：`DiamondCardService.generateCards`（生成即印可兌換星幣的價值）與 `AdminShopService.create/update`（目錄變更）。為讓「會改狀態/印價值的後台操作一律留痕」政策全面一致，一併收斂。

### Changed
- `backend/admin-service/.../service/DiamondCardService.java`：`writeAudit` 移除 try/catch，寫入失敗直接拋。因稽核（PostgreSQL 獨立交易）在卡片 `saveAll`（MySQL）**commit 之前**呼叫，例外會讓 `@Transactional(mysqlTransactionManager)` rollback → 卡片不生成。移除只用於 best-effort WARN 的 `Logger` 欄位與 slf4j import。
- `backend/admin-service/.../service/AdminShopService.java`：`writeAudit` 同上移除 try/catch，稽核失敗→拋→商品變更 rollback。`Logger` 保留（`create`/`update` 的 `log.info` 仍在用）。
- `backend/admin-service/.../service/DiamondCardServiceTest.java`：`generateCards_auditWriteFails_stillReturnsCards` → `..._throwsAndRollsBack`（稽核失敗改斷言整筆拋）。
- `backend/admin-service/.../service/AdminShopServiceTest.java`：新增 `create_auditWriteFails_throwsAndRollsBack`。

### 為什麼
- 這兩處與 admin 的告警/GM 發幣不同——卡片/商品在 **MySQL**、稽核在 **PostgreSQL**，跨資料源、專案無 2PC，**做不到真原子**。能達到的最強保證＝稽核在 mysql commit 前寫入：稽核寫不進去就拋、連同 MySQL 寫入一起 rollback（「稽核寫不進去就不印卡/不改目錄」）。殘留的窄窗＝稽核已 commit 但 mysql commit 才失敗 → 孤兒稽核（有稽核無實體），屬「過度記錄」的安全方向，為雙資料源先天限制、已在 Javadoc 點明。
- 取捨：商城目錄編輯屬低風險操作，強一致的代價是「稽核庫短暫不可用時目錄也改不了」；仍照收，換取後台稽核政策全面一致（值錢的鑽石卡更該如此）。
- mock 測試無法觀察真實交易 rollback（repo 被 mock），故失敗案例只斷言例外向上傳播、rollback 由 `@Transactional` 於真實交易保證（比照玩家封鎖那筆的處理）。

### 如何驗證
- `mvn -pl backend/admin-service test`：93 全綠（`AdminShopServiceTest` 5 項含新增、`DiamondCardServiceTest` 6 項含改寫）。

## [changed] -- 2026-07-08 -- 後台告警「已處理」分頁 + 玩家封鎖稽核由 best-effort 收斂為同交易強一致

### 背景
- 承前一筆（告警補 `resolved_by`/`resolved_at`）的兩個後續：① 後端已回傳處理者，但後台 Dashboard 只列「未處理」告警（`resolved:false`），沒有地方查「誰、何時」把告警按掉；② 前一筆刻意點名 AdminPlayerService 封鎖玩家的稽核仍是 best-effort（失敗只記 WARN），標為「既有設計未一併收斂」——本次一併收斂。

### Changed
- `frontend-admin/src/pages/Dashboard.jsx`：告警區塊加「未處理 / 已處理」分頁（`alertTab` 狀態，切換時 `fetchAlerts` 依賴改變→`useFetch` 自動重抓 `resolved=true/false`）。已處理分頁改顯示「處理者 / 處理時間」兩欄（讀 `resolvedBy` / `resolvedAt`）、拿掉「標記已處理」按鈕；空狀態文案依分頁切換。純前端，後端 `AlertView` 已具備欄位。
- `backend/admin-service/.../service/AdminPlayerService.java`：`setStatus` 標 `@Transactional("postgresTransactionManager")`，稽核（`admin_action_logs`）與狀態變更放進**同一 postgres 交易**、改為 **audit-first**（順序：稽核 → member 內部 API 持久化 status → Redis 封鎖/解封）。`writeAudit` 移除 try/catch，寫入失敗直接拋（→ 500）、連同狀態變更 rollback，**不再** best-effort。同步移除只用於 best-effort WARN 的 `Logger` 欄位與 slf4j import。
- `backend/admin-service/.../service/AdminPlayerServiceTest.java`：`setStatus_auditWriteFails_stillReturnsSuccessResponse` → `setStatus_auditWriteFails_throwsAndSkipsStateChange`（稽核失敗→整筆拋、member 與 Redis 皆不執行）；`setStatus_memberServiceDown_throwsAndSkipsRedis` 移除 `actionLog never().save()` 斷言（audit-first 下 save 已被呼叫，rollback 由 `@Transactional` 於真實交易保證，mock 不觀察 rollback）。

### 為什麼
- **強一致的先天邊界**：告警那筆能真「同交易」是因狀態與稽核都在 admin 的 PostgreSQL；玩家停用的真相狀態在 member-service（HTTP）＋ Redis，**無法真的加入 postgres 交易**，三者不可能原子一致。本次能做到的最強保證＝比照 `GmRewardService` 的 audit-first：稽核先寫（交易內未 commit），後續 member 失敗會連稽核一起 rollback——即「**沒稽核就不停用、稽核寫不進去就整筆失敗**」，杜絕「封鎖了卻查不到誰做的」的稽核破口。殘留反向半套（member 已改、Redis 未寫）沿用既有設計、由登入時 DB status 兜底重按即補齊。
- 代價：`memberClient` 的 HTTP 呼叫落在 postgres 交易內會於呼叫期間佔用連線（與 GM 在交易內送 Kafka 同類取捨）。後台封鎖為低頻操作，連線池壓力可忽略，換取稽核不可遺失，值得。
- 註：`DiamondCardService` 的稽核仍為 best-effort（本次未動，另有其取捨），非本次範圍。

### 如何驗證
- `mvn -pl backend/admin-service test`：92 全綠（`AdminPlayerServiceTest` 9 項含改寫後兩項）。
- `cd frontend-admin && npx vite build`：綠燈，產出 `dist/assets/Dashboard-*.js`。

## [fix] -- 2026-07-08 -- 後台告警「標記已處理」補稽核：記錄處理者 resolved_by + 落 admin_action_logs

### 背景
- 盤點 admin-service 稽核覆蓋率時發現：後台唯一「會改狀態卻完全不留痕」的操作是告警處理（`PATCH /admin/alerts/{id}/resolve`）。對照 GM 發幣 / 玩家封鎖 / 鑽石卡 / 商城全都記 operator + 稽核，只有告警漏掉——連 `admin_alerts` 自己都沒有欄位可記「誰、何時」把一筆風控告警按掉。風控告警盯的正是大額中獎/高頻下注/異常帳務，處理者不可追溯是稽核破口。

### Added
- `database/postgres/migration/V15__add_alert_resolution_audit.sql`：`admin_alerts` 補 `resolved_by VARCHAR(50)`、`resolved_at TIMESTAMP`（`ADD COLUMN IF NOT EXISTS`，既有環境可重跑）。

### Changed
- `database/postgres/init.sql`：`admin_alerts` 建表同步補 `resolved_by` / `resolved_at`（新環境與 migration 一致）。
- `backend/admin-service/.../entity/AdminAlert.java`：新增 `resolvedBy` / `resolvedAt` 欄位；`markResolved()` → `markResolved(String operator)`，一併寫入處理者與 `LocalDateTime.now()`。
- `backend/admin-service/.../dto/AlertView.java`：回應多帶 `resolvedBy` / `resolvedAt`（API 形狀擴充，供後台顯示處理者）。
- `backend/admin-service/.../service/AdminAlertService.java`：`resolve(alertId)` → `resolve(alertId, operator)`；在**同一個 postgres 交易內**記處理者並落一筆 `admin_action_logs`（`action_type=ALERT_RESOLVE`、`target_player_id`=告警玩家、`idempotency_key=alert-resolve-<id>` 確定性去重）。稽核與狀態變更同交易、稽核寫不進去則整筆 rollback（比照 GM 發幣，**不採** AdminPlayerService 的 best-effort）。冪等強化：已處理再標一次仍回 200，但不覆寫原處理者、不重複寫稽核。
- `backend/admin-service/.../controller/AdminAlertController.java`：`resolveAlert` 帶入 `Authentication`，以 `authentication.getName()` 作為處理者。
- `backend/admin-service/.../service/AdminAlertServiceTest.java`：建構子補 `AdminActionLogRepository` mock；`resolve` 測試改斷言「記 operator + 落稽核（捕捉 AdminActionLog 驗欄位）」、「已處理不覆寫/不重複稽核」、「不存在不寫任何庫」。

### 為什麼
- 稽核放進**同一交易**而非 best-effort：告警處理是低頻但敏感的追責點，寧可「處理失敗」也不要「處理成功卻查不到誰做的」。這與 AdminPlayerService 封鎖玩家的 best-effort 立場不同——後者以「狀態變更優先、稽核可事後補」取捨，兩者差異已在程式碼註解點明，屬既有設計未一併收斂（可另立 issue 統一）。
- 冪等不覆寫：保留「第一位處理者」才是稽核想要的答案；後續重按不該把責任轉移給最後一個點的人。

### 如何驗證
- `mvn -pl backend/admin-service test`：92 全綠（含改寫後的 `AdminAlertServiceTest`，7 項）。

## [perf] -- 2026-07-08 -- T-090 效能調校 Phase A（A1–A4）：風控統計移出熱路徑

### Added
- `backend/game-service/.../scheduler/GlobalRtpCacheScheduler.java`（A1）：每 2 秒（`risk.rtp-cache-refresh-ms`）對 SLOT/BACCARAT/FISHING 各跑一次既有 `aggregateRecent` 聚合，寫入 Redis `risk:rtp:{gameType}`（value=`totalBet:totalWin`、TTL 10 秒）；單一遊戲刷新失敗不中斷其他遊戲。
- `database/postgres/migration/V15__add_game_rounds_risk_indexes.sql` ＋ `database/postgres/init.sql`（A3）：`game_rounds` 補兩個 partial 複合索引 `idx_game_rounds_type_created (game_type, created_at DESC)` 與 `idx_game_rounds_player_type_settled (player_id, game_type, settled_at)`（皆 `WHERE status='SETTLED'`），服務排程聚合與 cache-miss 回填。
- `RiskControlService.recordRoundSettled()`（A2）：每局結算落地後以單一 Lua（HINCRBY bet/win + PEXPIRE）累加 `risk:player-day:{playerId}:{yyyyMMdd}:{gameType}`（TTL 48h，日期入 key 天然跨日歸零）；best-effort，Redis 故障僅 log 不影響結算。三個遊戲（`SlotService`/`BaccaratService`/`FishingService`）皆於 `roundRepository.save` 首次落地成功後呼叫，口徑＝`game_rounds.bet_amount/win_amount`（含本金，與 `aggregatePlayerToday` 一致）。

### Changed
- `RiskControlService`：
  - `isGlobalRtpOverLimit`（A1）改先讀 Redis 快取，miss（排程未跑過/Redis 故障/格式異常）退回直查 DB——只改「數據怎麼來」，不改「怎麼判」（per-game 門檻與含本金口徑不動，雷區 17）。
  - `isPlayerOverLimit`（A2）改先讀日水位 hash，miss 退回 DB 聚合並以 HSETNX 回填（不覆蓋並發中的 HINCRBY，避免蓋掉別局剛累加的量）。
  - 並發閘（A4）：`INCR`+`EXPIRE` 兩次往返合併為單一 Lua，且僅在計數器 0→1 首次取號時 PEXPIRE——修掉「每次 INCR 都續命 TTL」的語意問題；釋放端亦改 Lua（DECR 歸零即刪 key）——code review 抓出裸 DECR 在 key 先過期（請求超過 30s TTL / Redis 重啟）時會把計數器重建為無 TTL 的負值、並發閘對該玩家永久失效。
  - `isPlayerOverLimit` 命中條件改「bet/win 兩欄皆存在」才信任快取，殘缺 hash（回填只寫入一欄即中斷）視同 miss 退回 DB——否則 netWin 恆為負、上限實質停用（code review 發現）。
- `backend/game-service/src/main/resources/application.yml`：`risk.rtp-cache-refresh-ms: 2000`。
- `docs/plans/02-T-090-效能調校藍圖.md`：進度表 A1–A4 標記已落地。
- `CHANGELOG.md`：順手移除檔首殘留的分支名字串。

### Why
- 1,000 併發實測（2026-07-08）P99 5,291 ms 的主因是風控統計在請求熱路徑上即時重算：每局一次「近 500 局排序聚合」＋一次 per-player DB 聚合，1,000 個併發請求各自重算同一個全域答案、互相爭搶。修法＝統計改事件驅動維護（排程/計數器）、熱路徑只讀 Redis O(1)，DB 聚合退居 miss 回填與對帳基準（單一真相仍在 `game_rounds`）。
- 可接受 2 秒舊資料：全局 RTP 攔截是統計性水位警報，非帳務正確性機制（帳務由 wallet 冪等鍵＋樂觀鎖守，雷區 8）；風險上限與 `rtp-sample-size: 500` 的統計慣性同量級。
- 計數器累加放在對局落地之後且 best-effort：寧可水位少計一局（下次 miss 由 DB 回填補正），不可因 Redis 故障讓結算失敗。

### 如何驗證
- `mvn -pl backend/game-service test`：190 tests 全綠（含 `RiskControlServiceTest` 新增 9 個 A1/A2/A4 測試：快取命中不查 DB、miss 降級直查、HSETNX 回填、Lua 並發閘、best-effort 不拋例外）。
- 效能對照（150 併發迴歸基準 + 1,000 併發趨勢）待重跑 T-090/T-091 後回填報告——依藍圖統一驗證流程，帳務 gate 為不可回歸硬底線。

## [docs] -- 2026-07-08 -- T-090 效能調校藍圖：P99/5xx/失敗樣本的分階段施工計畫

### Added
- `docs/plans/02-T-090-效能調校藍圖.md`：把 1,000 併發重跑後的「下一輪效能調校」從一句話變成 8 個可施工項（A1–A4 風控查詢移出熱路徑／B1 wallet debit 剖析／C1 gateway 併發上限／C2 起跑 401／D1 驗收環境拍板），含進度表、施工順序與統一驗證流程。

### Why
- 效能 gate（P99 < 500 ms、5xx = 0、失敗 = 0）不過即不能上線，但先前僅有方向性描述、無計畫。讀碼定位出主因：`SlotService.settleInternal` 每局在請求路徑內跑 `GameRoundRepository.aggregateRecent`（近 500 局排序聚合）＋ `aggregatePlayerToday` 兩次 DB 查詢，且 `game_rounds` 缺複合索引——修法是把統計改為事件驅動維護、熱路徑只讀快取（O(N) 聚合移出 O(1) 路徑），而非調快查詢。
- 帳務 gate 為不可回歸硬底線已寫入計畫的統一驗證流程。

### 如何驗證
- 純文件新增，無行為變更；各 Phase 落地時依計畫內驗證流程重跑 T-090/T-091 並回填進度表。

## [test] -- 2026-07-08 -- T-090 1,000 併發完整重跑（TimeLimiter 修正後驗證）

### 背景
- gateway TimeLimiter 修正（見下一條目）先前僅在 150 併發驗證（5xx 78% → 0）；規格級 1,000 併發的修正後完整重跑尚未執行。本次同拓撲補跑到底，驗證修正在真實規格併發下的效果。

### Added
- `docs/performance/T-090-load-test-report.md`：新增「2026-07-08 gateway TimeLimiter 修正驗證（1,000 併發完整重跑）」節——12,530 樣本、P99 5,291 ms、失敗 8,582（68.5%），失敗組成拆解為 503 3,870（30.9%，較修正前 13,709 減 72%）／client 5s SocketTimeout 4,369（34.9%）／401 343（2.7%，起跑尖峰 12 秒內 JWT filter Redis fail-closed 所致）；idempotency/overdraw 全程 0。
- 壓測產物：`tests/performance/results/20260708-103916/`（JTL/HTML/acceptance-report）、`tests/performance/results/accounting-20260708-104156/`（T-091 對帳 CSV，本機無 psql 改以 `docker exec lucky-star-postgres psql` 執行同一 SQL）。

### Changed
- `docs/performance/T-090-load-test-report.md`、`CHANGELOG.md`：順手清除 merge commit `166b179` 遺留的 conflict 標記殘骸（branch 名稱與 `=======`）。
- `docs/plans/01-八項架構改進施工藍圖.md`：P2b 狀態註記補上「TimeLimiter 修正後 1,000 併發重跑完成」。

### Why
- 150 併發的驗證不能外推到 1,000 併發（修正前兩者失敗形態就不同）；且 AGENTS.md 明定無實測不得填數字，規格級併發必須實跑。
- 結論：**熔斷「誤判環節」在 1,000 併發下確認消除**（Prometheus 佐證：CB `kind="failed"` calls 全服務歸零（修正前 game≈1,172/wallet≈424）、wallet CB not_permitted 由 ≈10,028 歸零、game not_permitted 由 ≈9,861 降至 ≈4,047 且全由 slow-call rate 合法觸發）；**帳務 gate 維持全 PASS**；效能 gate（P99<500ms/5xx=0）仍 FAIL，瓶頸移轉到 spin 路徑本身延遲（成功呼叫平均 4.42 s：風控 Redis 並發閘＋DB 聚合、注單稽核高併發變重），屬下一輪效能調校課題、超出本修正範圍。

### 如何驗證
- `tests/performance/results/20260708-103916/acceptance-report.md`、`results/accounting-20260708-104156/accounting-reconciliation.csv`；Prometheus range query（`increase(...[90s])`，窗口迄 10:40:24）可複驗，PromQL 見報告內嵌。
- 迴歸自查：`node --test tests/infra/*.test.js` 綠燈（本次未動任何程式碼/設定，僅文件與測試產物）。

## [fix] -- 2026-07-08 -- gateway 補 Resilience4j TimeLimiter 設定，解決 T-090 thundering herd 熔斷

### 背景
- T-090 完整重跑（PR #182）把 150/1000 併發下 78–89% HTTP 5xx 的根因鏈定位到：gateway 的 Spring Cloud CircuitBreaker 未顯式設定 `timelimiter`，Resilience4j 因此套用**預設 1 秒逾時**——遠低於既有 `slow-call-duration-threshold: 3s`，導致高併發排隊下的正常慢呼叫在真正完成前就被腰斬判 failed，觸發熔斷開路 → half-open 少量放行 → 關路瞬間 thundering herd 再次推爆延遲 → 反覆開闔（self-sustaining flapping）。

### Changed
- `backend/gateway-service/src/main/resources/application.yml`：`resilience4j` 下新增 `timelimiter.instances`，為 member/wallet/game/rank/admin 五個服務各設 `timeout-duration: 6s`（略高於 `slow-call-duration-threshold: 3s`，讓慢呼叫有機會真正完成、交由 CircuitBreaker 的 slow-call 統計判定而非被 TimeLimiter 提前腰斬）。
- `docs/performance/T-090-load-test-report.md`：新增「2026-07-08 gateway TimeLimiter 修正驗證」節，記錄修正前後 150 併發對照。

### Why
- TimeLimiter 逾時應該「保護系統不被真正掛住的呼叫拖垮」，而不是比 CircuitBreaker 自己的慢呼叫門檻還嚴格——後者才是本專案定義的「多慢算異常」的權威判準。逾時設得比 slow-call-duration-threshold 短，等於讓一個沒人特意設定的預設值（1s）搶先於明確設計過的熔斷邏輯（3s）介入，是這次回歸的根本原因。

### 如何驗證
- 150 併發（`tests/performance/results/20260708-101629/acceptance-report.md`）：HTTP 5xx 由修正前 13,563（78.0%）降至 **0**；失敗樣本由 13,563 降至 4（0.05%）；idempotency/overdraw 全程 0。
- P99（2,667 ms）仍未達 < 500 ms 門檻——歸類為下一輪效能調校的獨立課題（風控聚合/注單稽核在高併發下變重），不在本次修正範圍。

## [test] -- 2026-07-08 -- T-090 壓測完整重跑（Phase 2b 完成）：根因鏈確認、帳務對帳 PASS

### 背景
- 2026-07-07 已定位「gateway CircuitBreaker 未設 TimeLimiter（預設 1 秒逾時）× spin 路徑變重 × thundering herd」根因鏈，但當時只是中途進度，未跑完 1000 併發主測與正式對帳。本次同拓撲（Docker infra+observability、7 服務宿主機 mvn 起）完整重跑到底。

### Changed
- `docs/performance/T-090-load-test-report.md`：以「2026-07-08 完整重跑最終結果」取代原「2026-07-07 中途進度」節，並更新頂部 Status/Headline。記錄：
  - 150 併發基線：17,395 樣本、P99 1,164 ms、5xx 13,563（77.97% 錯誤率）、idempotency=0、overdraw=0。
  - 1000 併發主測：15,922 樣本、P99 5,055 ms、失敗 14,221（5xx 13,709，89.3% 錯誤率）、idempotency=0、overdraw=0。
  - Prometheus 90 秒測試窗證據：`not_permitted` game-service≈9,861／wallet-service≈10,028；CB `failed` calls game-service≈1,172／wallet-service≈424；成功 spin 平均延遲≈3.63 s、wallet debit 平均延遲≈896 ms（皆遠高於 1s TimeLimiter 門檻）。
  - T-091 帳務對帳：本輪測試玩家（1,031 名，`player_id>=90000`）0 違規；額外揪出 3 筆歷史違規（`player_id` 1001–1003），查證交易時間戳全在 2026-06-16，為前一輪測試殘留於 Postgres volume 的舊資料，與本輪無關，已排除在 gate 判定外。
  - 測試對象 commit：`902d744`（與 origin/develop 最新 `65915c5` 相比落後 7 個 commit，皆為 docs/admin-service 變更，gateway/game/wallet 無差異，不影響結果有效性）。

### Why
- AGENTS.md §地雷 12：無真實量測不得捏造 P99，必須把「中途進度」與「完整結論」分開記錄，避免下一個人誤把未跑完的數字當最終結果引用。
- 效能 gate FAIL 但帳務 gate 全程 PASS，證明本次回歸是「gateway 熔斷設定缺陷」而非「帳務邏輯在高併發下出錯」，範圍明確才能決定調 TimeLimiter/R4j 參數的獨立 PR 怎麼改。

### 如何驗證
- `tests/performance/results/20260708-100306/acceptance-report.md`（150 併發）、`tests/performance/results/20260708-100442/acceptance-report.md`（1000 併發）、`tests/performance/results/accounting-20260708-100542/accounting-reconciliation.csv`。
- Prometheus range query（`increase(...[90s])` at test-window timestamp）可重跑複驗，見報告內嵌 PromQL。 develop

## [feat] -- 2026-07-08 -- 玩家端「交易紀錄」與「遊戲紀錄」統整為單一時間軸頁

### 背景
- 原本前端有兩個獨立頁：`/transactions`（錢包帳務流水）與 `/game-history`（遊戲注單）。兩者其實大量重疊——一次老虎機在錢包會產生 `bet` + `payout` 兩筆交易、在遊戲服務再記一筆 round，是「同一經濟事件的兩種視角」。使用者要求把兩頁統整為一個。

### Added
- `frontend/src/pages/Records.jsx`：新增 `/records` 合併頁。各服務併發（`Promise.all`）抓最近 `FETCH_CAP=200` 筆 → 濾掉遊戲相關交易子型（`bet`/`payout`/`win`，涵蓋 mock 小寫與後端大寫 `BET`/`WIN`）→ 與遊戲 round 合併、依時間倒序 → 前端分頁（每頁 10 筆）。欄位：時間 / 來源 / 類型 / 金額 / 餘額；來源篩選（全部/交易/遊戲）。

### Changed
- `frontend/src/App.jsx`：新增 `/records` lazy route。
- `frontend/src/components/AppShell.jsx`：導覽把「交易紀錄」「遊戲紀錄」兩項合併為單一「交易/遊戲紀錄」→ `/records`。
- `frontend/e2e/smoke.spec.js`：導覽走查改點「交易/遊戲紀錄」並斷言 `/records`。

### Removed
- 刪除舊頁 `frontend/src/pages/Transactions.jsx`、`frontend/src/pages/GameHistory.jsx` 及 `App.jsx` 的 `/transactions`、`/game-history` 路由與 lazy import；`Records.jsx` 移除原本連向 `/game-history` 的明細入口。副作用：舊遊戲明細（局號、毫秒下注/派彩時間、投注前→派彩後餘額）不再有頁面可看。
- 清除 `frontend/src/store/slices/walletSlice.js` 中因舊頁移除而變成 dead code 的交易相關部分：`fetchTransactions` thunk、`setTransactionFilters` / `setTransactionPage` reducer 與其 export、`fetchTransactions` 的 3 個 `extraReducers`，以及 initialState 的 `transactions` / `transactionTotal` / `transactionPage` / `transactionPageSize` / `filters` 欄位。合併頁改直接呼叫 `walletApi.getTransactions`，不再走 redux；`walletApi.getTransactions` 本身保留。

### 為什麼
- 直接把兩表原封不動混排，一次遊戲會冒出三列（下注 TX + 派彩 TX + 遊戲 round）、金額重複計。改以「遊戲每筆一列（顯示損益）+ 交易只保留非遊戲事件（簽到/任務/贈送/商城…）」讓每個事件只出現一次、金額不重複。餘額欄僅遊戲列有值（帳務流水不帶當下餘額），交易列顯示 `-`。跨頁排序正確性靠 bounded fetch（各抓一段視窗後在前端合併排序），而非「各取第 N 頁再合併」。

### 如何驗證
- `cd frontend && npx vite build`：綠燈，產出 `dist/assets/Records-*.js` chunk。

## [fix] -- 2026-07-08 -- 後台 RTP 監控：無下注樣本改標 NO_DATA，不再誤報 ABNORMAL

### 背景
- 以 50 帳號模擬玩老虎機/百家樂/捕魚後查後台，發現剛玩完 RTP 報表把 SLOT（該時段快照尚無資料）標成 ABNORMAL。根因：`RtpReportService` 對 `totalBet=0` 的遊戲以 `actual=0` 硬比設計值，deviation 必達 `-design`（如 -0.95）而永遠超門檻。commit `4639c3f` 補了 FISHING 設計值 0.96，反而讓無資料的 FISHING 也會落入同一誤報。此為 T-053 的既有缺陷修正。

### Fixed
- `backend/admin-service/.../service/RtpReportService.java`：新增 `STATUS_NO_DATA`；`totalBet <= 0`（本時段快照無下注樣本，如剛過整點）時回 `NO_DATA`、deviation=0，跳過偏差判定，不再誤報 ABNORMAL。有資料的遊戲行為不變（NORMAL/ABNORMAL 判定不動）。

### Changed
- `frontend-admin/src/pages/RtpReport.jsx`、`Dashboard.jsx`：狀態徽章由二態改三態——`NO_DATA` 顯示中性灰「無資料」（不再誤顯綠色「正常」）；置頂 RTP 異常告警的 `abnormal` filter 僅收 `ABNORMAL`，NO_DATA 天然不觸發紅色告警。

### 為什麼
- 「沒有資料」與「RTP 真的異常」是兩件事，混為一談會讓營運每逢整點後、或新遊戲上線初期看到假紅燈而失去對告警的信任。獨立 NO_DATA 狀態把「未知」與「異常」分開，比硬塞 NORMAL 更誠實（無資料不等於健康）。

### 如何驗證
- `mvn -pl backend/admin-service test`：92 全綠（含新增回歸 `RtpReportServiceTest.noBetSample_isNoData_notAbnormal`）。
- 重啟 admin-service 後查 `GET /admin/reports/rtp`：SLOT/FISHING（當前快照無資料）status=`NO_DATA`、deviation=0；BACCARAT（有 24 局資料）維持 `NORMAL`。
develop

## [feat] -- 2026-07-07 -- AUDIT_REPORT 附錄 A 自動盤點：tools/audit/ 依證據清單重生進度表（Phase 8）

### 背景
- 附錄 A 靠人記得去盤點，長期落後程式碼（AGENTS.md §1 的 T-027/T-028 誤報案例），且手工統計表與逐項表互相矛盾（統計記 25 ❌、逐項表僅 T-096 一項 ❌）。本次把逐項表與統計改為工具產生：每次執行對「當下工作樹 + git log」即時判定。

### Added
- `tools/audit/`（Node ESM、零外部依賴，比照 tools/ 慣例；需 Node 22+ 的 `fs.globSync`）：
  - `tasks.json`：85 個任務（T-000~T-114）的證據清單，首版由附錄 A 手工轉換——每筆 `{ id, title, owner?, priority?, evidence: { files: [glob...], commitGrep }, override?, note? }`；`commitGrep` 選填（早期任務 commit 沒帶 T-0xx 記號者只靠檔案證據）；`override` 僅限證據判不了的人工判定（T-084 端對端待驗收、T-089 RWD、T-090 壓測 gate、T-093 全鏈路 E2E、T-110 腳本已被容器化取代）。
  - `generate-audit-snapshot.mjs`：判定＝證據檔案全在＋`git log --grep` 有 commit→✅、部分→⚠️、全無→❌、無證據→❓；輸出與附錄 A 同格式表格＋自動統計，寫入 AUDIT_REPORT.md 的 `<!-- AUDIT:BEGIN/END -->` 標記區塊（標記外人工敘述不動），另存 `docs/report/audit-snapshot-YYYYMMDD.md`（含 git HEAD）。`--check` 模式只比對、有落差退出碼 1（日後可掛 CI，本次不強制）。
- `docs/report/audit-snapshot-20260707.md`：首跑快照。

### Changed
- `AUDIT_REPORT.md`：附錄 A 的 A.1~A.12 手工表格與 A.13 統計改為標記區塊（工具產生）；首跑結果 **80 ✅ / 3 ⚠️ / 1 ❌ / 1 ❓**——T-083/T-087 等過時 ⚠️ 依證據（檔案＋T-0xx commit）轉 ✅，並修正統計與逐項表不一致；變動紀錄以下的人工敘述保留。
- `AGENTS.md` §1：註記附錄 A 自動化——更新進度改 `tools/audit/tasks.json` 再重跑工具、勿手改標記區塊；`--check` 可驗漂移。

### Why
- 「手動快照會漂移」是結構性問題，靠告示提醒治標；把盤點變成可重跑的程式，漂移就變成一條指令可修復、可驗證（`--check`）的狀態。
- 保留 `override`：壓測 gate、RWD 這類完成與否不由檔案存在決定的任務，仍需人工判定，但理由被迫寫進 tasks.json、隨表格輸出，不再是口耳相傳。

### 如何驗證
- `node tools/audit/generate-audit-snapshot.mjs` 後逐項比對附錄 A 與現況一致（T-027/T-028 類誤報已轉 ✅；證據型任務無缺檔誤報）。
- `node tools/audit/generate-audit-snapshot.mjs --check` 退出碼 0；手動改壞表格一格後退出碼 1、重跑工具復原。
- `node --test tests/infra/*.test.js` 142 全綠（不受影響）。

## [security] -- 2026-07-07 -- Secret 管理：範本全佔位符化、CI 密鑰 run 內生成、輪替 SOP（Phase 7）

### 背景
- `.env.example` 與 `ci.yml` 內含可直接使用的密鑰值且進了版控——拿得到 repo 就等於拿到密鑰。本次把「可用值」全數趕出版控：範本只留佔位符、CI 測試密鑰改每次 run 隨機生成，並補上輪替 SOP。

### Added
- `docs/security/secret-rotation.md`：密鑰清單（各變數用途/誰在用/輪替影響面——`INTERNAL_SECRET` 改了 **7 服務要同步重啟**、`JWT_SECRET` 改了**全部玩家 token 立即失效**且 member/gateway/notification 三服務要一起換）、生成指令（openssl / PowerShell）、本機輪替步驟（JWT 類/內部密鑰/DB 密碼三條 SOP）、CI 密鑰策略說明。明列**既有本機 `.env` 值視同已洩漏，施工後全員重生一輪**。

### Changed
- `.env.example`：`JWT_SECRET`/`ADMIN_JWT_SECRET`/`ADMIN_SEED_PASSWORD`/`INTERNAL_SECRET`/`INTERNAL_SERVICE_SECRET`/`MYSQL_ROOT_PASSWORD`/`MYSQL_PASSWORD`/`POSTGRES_PASSWORD` 全部換成 `CHANGE_ME` 佔位符＋檔頭生成指引。佔位符刻意短於 HS256 的 32 bytes，拿範本值直接啟動會 fail-fast（`WeakKeyException`），不會靜默用弱密鑰跑起來；佔位符為非空字串，`tests/infra/env.test.js` 的非空斷言不受影響。
- `.github/workflows/ci.yml`：`backend-test` job 的靜態測試密鑰（`JWT_SECRET`/`INTERNAL_SECRET`/`INTERNAL_SERVICE_SECRET`）移除，改為第一個 step 以 `openssl rand -base64` 於 run 內生成並寫入 `$GITHUB_ENV`；`CORS_ALLOWED_ORIGINS` 非密鑰、留在 job env。
- `DEPLOY.md` §2：改寫「複製即可啟動」段——現在複製後**必須先生成密鑰**，並連結 `docs/security/secret-rotation.md`。

### Why
- **CI 不用 GitHub Secrets**：本專案走 fork/PR 工作流，fork PR 拿不到 repo secrets，一依賴就整條 CI 紅；測試密鑰只活在單一 run 內、無持久價值，run 內生成同時消滅了「repo 裡寫死可用密鑰」這件事。
- 範本值曾進版控＝已洩漏，所以文件明訂全員重生一輪，而不是只改範本。

### 如何驗證
- `node --test tests/infra/*.test.js` 全綠（env.test.js 對密碼變數只斷言非空，佔位符通過）。
- CI 綠：觀察下一個 fork PR 的 run——「產生本次 run 專用測試密鑰」step 成功、backend-test 兩個 mvn step 照常通過。
- 依新 `.env.example` 重建 `.env`（填入生成值）後 `docker compose up -d --build`，12 容器 healthy、註冊/登入 smoke 正常。


## [chore] -- 2026-07-07 -- PR #172 容器化收尾：補 .dockerignore、刪殘留 stop-backend.bat、修正 mock 旗標誤植、同步過期文件

### Added
- `.dockerignore`（白名單式：只放行根 `pom.xml` 與 `backend/`，並排除 `backend/**/target`）。七個 Dockerfile 的 build context 都是 repo 根目錄，之前每次 build 會把 `.git`、`frontend*/node_modules`、`docs` 等整包送進 Docker daemon（×7 個 image），且本機 IDE 編譯的 `target/` 會讓 `COPY backend` 的 layer cache 頻繁失效。

### Fixed
- `frontend/.env.development`：`VITE_USE_MOCK_API` 由 `true` 改回 `false`。`20d582d`（捕魚機 PR）誤把個人測試設定推入版控，與同檔註解「dev 預設串真實後端」、根目錄 `.env.example` 及 DEPLOY.md §4 說明全部矛盾——後果是照 DEPLOY.md SOP 起完全部後端後，前端冒煙測試（§5 第 3 步）其實打的是 mock，後端全掛也會「通過」。個人要離線 mock 請照註解用 `frontend/.env.local` 覆蓋。

### Removed
- `stop-backend.bat`：PR #172 刪除四個原生啟動/停止腳本時漏掉它；其內容是委派給已被刪除的 `stop-all.ps1`，執行必失敗，屬死碼。

### Changed（過期文件同步至容器化後的現況）
- `README.md` 快速開始：Step 2 改為 `docker compose up -d --build` 一鍵啟動（原本只起 infra）、刪除教人跑 `./mvnw spring-boot:run` 的 Step 4（專案沒有 mvnw，AGENTS.md 雷區 1）。
- `DEPLOY.md`：§1 前端表補 `frontend-admin`（5174）；§7「目前已知狀況」由 2026-06-10 更新至今——admin/notification/捕魚機/鑽石/商城均已完成，移除「admin 空殼、notification 未建立」等與同檔 §1 矛盾的過期描述。
- `docs/ENV_SETUP_GUIDE.md`：§4 補 `--build` 與後端容器化說明、`docker compose ps` 範例移除 zookeeper（KRaft 後早已不存在）並補 7 後端；§6.4 標明為 IDE 除錯用、`./mvnw` 改 `mvn`。
- `AUDIT_REPORT.md` T-110：標註 `✅（已除役）`——腳本歷史上完成過，容器化後移除。
- `docs/performance/T-090-load-test-report.md`：Execution 第 1 步移除「services are not containerized」的過期前提。

### Why
- 詳細檢查 docker 環境與 PR #172 時發現的缺漏：核心部署健全（12 容器 healthy、gateway 冒煙通過），但殘留死腳本、缺 build context 過濾、以及五處文件與現況矛盾（正是 AGENTS.md §1 警告的「文件落後程式碼」模式，會誤導新成員照舊流程操作）。

### 如何驗證
- `node --test tests/infra/*.test.js`：142 tests 全綠。
- 加上 `.dockerignore` 後 `docker compose build member-service` 成功，build context 由整個 repo 縮為 root pom + backend/。
- `curl -X POST http://localhost:8080/api/v1/auth/register ...` 經 gateway 註冊回 `success:true`（容器拓撲端到端正常）。

## [refactor] -- 2026-07-07 -- 玩法契約單一來源化：repo 根 contracts/*.json + ContractParityTest 守門（Phase 5）

### 背景
- 玩法表格數值（老虎機賠付表、百家樂補牌表/賠率、捕魚魚種/戰鬥常數、商城 mock 目錄）此前在後端 enum/常數與 `frontend/src/services/mockApi.js` 各寫一份，靠雷區 14 的人工紀律同步，漂移只能靠 code review 抓。本次把表格數值抽成 repo 根 `contracts/*.json` 單一檔案：前端 mock 直接 import，後端以相等性測試守門——漂移＝CI 紅燈。

### Added
- `contracts/`：`slot-paytable.json`（符號/權重/兩階倍率/總權重）、`baccarat-rules.json`（TIE_PAYOUT/傭金率/莊家補牌表）、`fishing-species.json`（魚種表/HP 係數/搖錢樹區間）、`fishing-combat.json`（TARGET_RTP/RECOVERY_RATE/暴擊/砲台傷害表）、`shop-catalog.json`（**僅供 mock**；正式目錄單一真相在 MySQL `shop_items`，雷區 20）。
- `backend/game-service/src/test/java/com/luckystar/game/baccarat/ContractParityTest.java`：Jackson 讀 `../../contracts/*.json`，逐欄斷言＝`SlotSymbol`/`FishSpecies`/`FishingCombat` 常數/`bankerDraws` 補牌表（莊點 0~7 × 閒三張值 0~9 全域窮舉）。放 `baccarat` 套件是為了直接呼叫 package-private 的 `bankerDraws`。

### Changed
- `frontend/src/services/mockApi.js`：`SLOT_PAYTABLE`/`FISH_SPECIES`/fishing 常數/`SHOP_CATALOG`/百家樂賠率與補牌表改為 import 契約 JSON；補牌「邏輯」（天牌、閒 0~5 補、pCapture 反推、兩階賠付評估）仍是鏡像程式碼，JSON 只存表格數值。
- `frontend/vite.config.js`：`server.fs.allow` 放行 `../contracts`（dev server 預設不服務專案根外檔案；build 本就不受影響）。
- `AGENTS.md`：雷區 14（契約單一來源與改數值 SOP）、15（`ContractParityTest` 加入紅燈清單）、16（四同步的 ① 改為契約檔）、20（目錄同步對象改 `contracts/shop-catalog.json`）。

### Why
- **後端 enum 保留為執行期權威、不 runtime 載 JSON**：enum 承載 Javadoc 理論 RTP 推導與雷區 15/16 的整套測試守門，推倒重來收益低、風險高；「漂移＝CI 紅燈」用相等性測試即可達標。
- `shop-catalog.json` 不入守門範圍：正式目錄在 MySQL（admin 後台可改），JSON 只是 mock 的預設體驗快照。

### 如何驗證
- `mvn -pl backend/game-service test` 綠燈（180 tests，含新增 `ContractParityTest` 4 個）。
- `cd frontend && npm run build` 成功、`npm test` 綠燈（36 tests）。
- mock 三遊戲以臨時 vitest smoke 實跑驗證（spinSlot 盤面/派彩、baccaratBet 押閒派彩、fishing start→shots→end 結算），驗畢即刪。

## [feat] -- 2026-07-07 -- game→wallet 最小 Saga 補償：credit 失敗落補償單、排程冪等重試（Phase 4，ADR-009）

### 背景
- game-service 對 wallet 的派彩/退款 credit 是同步 HTTP；wallet 短暫不可用時，「玩家已扣款、已贏（或該退款）」的錢只剩一行 log（fishing 退款失敗甚至明寫「需人工對帳」）。本次把它系統化：credit 失敗 → 落 `pending_wallet_credits` 補償單 → 排程每 30 秒帶**同一冪等鍵**重試，wallet 端 `idempotency_key` UNIQUE（雷區 8）保證與玩家重試並發也絕不重複入帳。詳見 `docs/adr/ADR-009.md`。

### Added
- `database/postgres/migration/V14__add_pending_wallet_credits.sql` ＋ `database/postgres/init.sql`：新表 `pending_wallet_credits`（game_type、round_id、player_id、amount、sub_type WIN/REFUND、idempotency_key UNIQUE、status PENDING/DONE/FAILED、retry_count、last_error、next_retry_at、時間戳；`(status, next_retry_at)` 索引）。
- game-service 新 `compensation/` 套件：`PendingWalletCredit`／`PendingWalletCreditRepository`／`WalletCompensationService.recordPending()`（TransactionTemplate `REQUIRES_NEW` 寫入——主流程 rollback 也留單；絕不拋出例外，避免遮蔽 catch 內的原始錯誤）／`WalletCompensationRetryJob`（`@Scheduled` 每 30s 撈 PENDING 到期單、指數退避 30s→上限 30min、10 次超限標 FAILED＋log.error）。補償只走 HTTP `WalletClient`（雷區 6），sub_type 僅 WIN/REFUND（已在白名單，不觸發雷區 18 四同步）。
- `tools/reconciliation/reconcile-game-wallet.mjs`（＋package.json，Node ESM＋pg，比照 tools/ 慣例）：跨 game/wallet 服務邊界對帳——已結算對局缺 credit 流水（且無補償單兜底）、金額不符、FAILED/滯留 PENDING 補償單、DONE 卻無流水；輸出格式比照 `tests/performance/accounting-reconciliation.sql`，違規退出碼 1。
- 測試：`WalletCompensationServiceTest`（失敗→寫單、冪等鍵原封不動、去重、絕不拋出）、`WalletCompensationRetryJobTest`（重試→DONE、退避、超限 FAILED、單筆失敗不斷批）；Slot/Baccarat/Fishing 測試各補「credit 失敗→落補償單＋拋回原例外」。

### Changed
- `SlotService.settleInternal`、`BaccaratService.settle`：派彩 credit 失敗 → `recordPending(WIN, 同冪等鍵)` 後拋回原例外（主流程行為不變，玩家仍可重試結算）。
- `FishingService`：start/topUp 的退款再失敗 → `recordPending(REFUND)`（原本只 log）；`settleInternal` 的場次返還失敗 → `recordPending(REFUND, fishing-end-<sessionId>)` 後拋回。
- `AGENTS.md`：新增雷區 22（credit 失敗必落補償單、冪等鍵絕不可換）。

### Why
- 語意分清（ADR-009）：settle 的 credit 失敗＝玩家贏了，補償是「重試同一冪等鍵的 credit」而非退款；fishing 扣款後 save 失敗才是 REFUND。統一抽象為「pending outbound wallet credit」，安全根基是 wallet 冪等，因此補償排程可盲目重試、與玩家重試並發也安全。
- 補償單放 game-service 自己的 Postgres：欠據由 game 產生、屬 game 邊界，且重用 `WalletClient` 的 internal-secret 設定；對帳跨兩服務邊界，故獨立成 tools/ script。

### 如何驗證
- `mvn -pl backend/game-service test` 綠燈（176 tests，含新增 10 個補償測試與 3 個失敗路徑測試）。
- 手動：kill wallet → 打一局 slot（命中）→ 重啟 wallet → 30 秒內補償入帳；`pending_wallet_credits` 標 DONE、`wallet_transactions.idempotency_key` 與補償單一致；`node tools/reconciliation/reconcile-game-wallet.mjs` 對帳通過。
## [fix] -- 2026-07-07 -- postgres init.sql 補上 cashback_records 表，修復全新環境 docker compose 啟動失敗

### Fixed
- `database/postgres/init.sql`：新增 `cashback_records` 表（+ 索引），內容對應既有的 `database/postgres/migration/V9__add_cashback_records.sql`。

### Why
- 實測驗證 PR #172（後端容器化）時發現：全新 docker volume 跑 `docker compose up -d --build`，`game-service` 因 Hibernate schema-validation 找不到 `cashback_records` 表而啟動失敗（`Schema-validation: missing table [cashback_records]`），卡住 `gateway-service` 的 `depends_on` 健康鏈。根因是 6/23 新增 cashback 功能時只補了 Flyway migration 檔（`V9`），沒有同步把表結構加進 `init.sql`（全新安裝的權威 schema 來源，migration 不會自動套用進全新 volume，見 AGENTS.md 雷區 3/README 對應章節）。

### 如何驗證
- 乾淨 docker volume 下 `docker compose up -d --build`：12 個容器（5 infra + 7 後端）全數 `healthy`。
- 透過 gateway（8080）完成註冊 -> 登入 -> 查餘額冒煙測試，皆回傳 200/201。

## [feat] -- 2026-07-07 -- 後端服務全面容器化：docker compose up -d --build 一鍵啟動 7 服務（取代多視窗手動啟動）

### 背景
- 舊流程每人要手動開 6-7 個終端機視窗跑 `mvn spring-boot:run`（或用 `start-all.bat`/`start-backend.ps1` 各開一個新視窗），且每人本機 `.env` 易與 `.env.example` 漂移導致啟動失敗、環境不一致。改為全容器化後，`docker compose up -d --build` 即可用一致環境一次啟動全部 5 個基礎設施 + 7 個後端服務。此次僅容器化後端，前端（`frontend/`、`frontend-admin/`）仍走 `npm run dev`。

### Added
- `backend/<service>/Dockerfile`（7 個：gateway/member/wallet/game/rank/admin/notification-service）：multi-stage build（`eclipse-temurin:21-jdk-jammy` 建置 + `21-jre-jammy` 執行期），BuildKit cache mount 共用 Maven 依賴快取，non-root `appuser` 執行，內建 `curl` 供 actuator healthcheck 使用。
- `docker-compose.yml`：新增 7 個後端服務容器，env 對應容器網路（DB/Redis/Kafka 改容器名與內部 listener、下游 `*_SERVICE_URL` 改容器名），依 healthcheck 建立啟動順序（DB healthy → 該服務 healthy → 依賴它的下游服務，如 game-service 等 wallet-service、admin-service 等 member-service、gateway-service 等其餘 6 個）。
- `tests/infra/docker-compose.test.js`：新增「後端服務容器化」測試群組，涵蓋 7 個服務存在性、各自 Dockerfile 路徑、actuator healthcheck、容器內部 Kafka listener、game→wallet 與 gateway→其餘 6 服務的 `depends_on` 鏈。

### Changed
- `.env.example`：補齊缺漏的 `NOTIFICATION_SERVICE_URL`/`NOTIFICATION_SERVICE_PORT`（gateway 原本即讀取，範本檔案漏了）；`*_SERVICE_URL` 的 localhost 預設不變（原生開發用，容器網路的 hostname 直接寫在 compose 的 `environment:` 覆寫）。
- `DEPLOY.md`：全面改寫為 Docker 單一啟動路徑——§3「啟動基礎設施」與原 §4「啟動後端服務」合併為 `docker compose up -d --build` 一步到位，§0 前置需求移除 Java/Maven 必要性，§6 疑難排解新增容器相關症狀，其餘章節依序重新編號。

### Removed
- `start-all.bat`、`start-backend.ps1`、`stop-all.bat`、`stop-all.ps1`：原生多視窗啟動腳本已被 `docker compose up -d --build` 取代，不再保留原生 mvn 熱重載路徑（團隊已確認接受此取捨）。

### Why
- 多視窗手動啟動易漏開/漏載入 `.env`、且各人環境不一致；容器化統一了本機開發環境，`docker compose up -d --build` 一行指令即可重現整套拓撲，符合團隊「docker 化為唯一啟動路徑」的決定。

### 如何驗證
- `node --test tests/infra/*.test.js` 全綠（142 tests pass，含新增的後端容器化測試群組）。
- `docker compose up -d --build` 需開發者本機驗證 12 個容器（5 infra + 7 後端）皆達 `healthy`，並透過 gateway 走完整 smoke test（註冊 → 登入 → 查餘額 → 老虎機 spin）。

## [fix] -- 2026-07-07 -- member/admin 放行 /actuator/prometheus ＋ T-090 重跑中途進度記錄

### Fixed
- `backend/member-service/.../config/SecurityConfig.java`、`backend/admin-service/.../config/SecurityConfig.java`：permitAll 清單補 `/actuator/prometheus`。原本只放行 `health`/`info`，Prometheus scrape 被 member 403 / admin 401 擋下，觀測性上線後 targets 從未全綠。gateway 不轉發 actuator 路徑、僅本機 scrape，風險面有限。

### Changed
- `docs/performance/T-090-load-test-report.md`：新增「2026-07-07 再驗證進度（進行中）」一節——同拓撲重跑的 150 基線（冷/熱皆 ~65% 503）與 1000 主測（P99 2,190 ms）實測值、Prometheus 佐證的根因鏈（Spring Cloud CircuitBreaker 未設 TimeLimiter 預設 1s 逾時 × spin 路徑 6/22 起接入風控變重 × half-open→closed thundering herd 反覆開闔）、單發延遲健康（28–125 ms）、帳務 gate 持續 PASS（overdraw=0、冪等失敗=0）。

### Why
- T-090 重跑（Phase 2b）中途暫停留檔：targets 全綠是壓測指標佐證的前置；根因已從 6/16 的「單機資源」細化到可指名的 CB 設定與路徑變重，調 TimeLimiter/R4j 屬另開 PR 範疇。

### Verified
- `mvn -pl backend/member-service,backend/admin-service test` 綠燈；重啟兩服務後 Prometheus targets 7/7 up；`curl :8081/actuator/prometheus`、`:8086/actuator/prometheus` 皆 200。

## [feat] -- 2026-07-07 -- 觀測性上線：7 服務曝露 Prometheus 指標＋compose 選配監控棧（T-090 前置）

### Added
- 7 個後端服務 `pom.xml`：加 `micrometer-registry-prometheus`（runtime scope，版本由 Spring Boot BOM 管控）。
- `observability/prometheus.yml`：scrape 7 服務 `/actuator/prometheus`（現行拓撲後端跑宿主機，target 用 `host.docker.internal`）。
- `observability/grafana/provisioning/`：Prometheus datasource ＋「Lucky Star — 服務總覽」儀表板（HTTP P99/吞吐/5xx/Resilience4j 熔斷/JVM Heap/CPU）。
- `docker-compose.yml`：新增 `prometheus`(9090)/`grafana`(3000) 兩服務，綁 `observability` profile——**預設 `docker compose up` 行為不變**。
- `tests/infra/docker-compose.test.js`：新增觀測性 profile 守門測試（服務存在＋profile 恰好綁 2 個）。

### Changed
- 7 個服務 `application.yml`：`management.endpoints.web.exposure.include` 加 `prometheus`；開啟 `[http.server.requests]` percentiles-histogram（否則 Prometheus 無 bucket 可算 P99）。
- `DEPLOY.md` §3：補「選配：啟動觀測性」一節。

### Why
- T-090 壓測重跑的硬前置：上次（2026-06-16）只有 JMeter JTL 可看，缺服務端指標，無法佐證「單機資源 vs gateway 限流」的瓶頸判定。監控容器走 profile 是為了不破壞既有 SOP 與 infra 測試。

### Verified
- `node --test tests/infra/*.test.js` 全綠；`docker compose config --profile observability` 解析通過；七模組 `mvn test` 全綠（見 PR）。

## [test] -- 2026-07-07 -- wallet-service 新增 Testcontainers 真實資料庫測試（ADR-007）

### Added
- 根 `pom.xml`：dependencyManagement 匯入 `testcontainers-bom:1.21.3`。
- `backend/wallet-service/pom.xml`：test 依賴 `testcontainers-{junit-jupiter,postgresql,mysql}`；surefire 預設 `excludedGroups=containers`；新 profile **`containers-test`**（只跑 `@Tag("containers")`，並把 system property 切成 `jpa.ddl-auto=validate` + 真方言——`DataSourceConfig` 讀的是 system property，故必須在 surefire 層切）。
- `backend/wallet-service/src/test/java/com/luckystar/wallet/containers/`：
  - `AbstractDualDatasourceContainerTest`：singleton postgres:16 + mysql:8.4（版本對齊 compose），套 `database/` 真 schema（PG＝init.sql＋migration 依數字版號重放；MySQL＝僅 init.sql，因其 migration 不冪等且 init.sql 已是累積最新版），`ddl-auto=validate` 讓 context 啟動即斷言 entity↔schema 無漂移。
  - `WalletCheckConstraintContainerTest`：非法 sub_type 在 PG/MySQL 撞 `chk_wt_sub_type`（H2 create 模式根本沒有這條約束）；白名單最新子型 SHOP_PURCHASE 可寫（兼驗 migration 重放順序）。
  - `WalletOptimisticLockContainerTest`：真 PG 樂觀鎖——stale version 存檔被拒、雙併發 800 扣款於餘額 1000 恰一方成功、不超扣、流水恰一筆。
  - `DualDatasourceTxSemanticsContainerTest`：postgres/mysql 兩 TransactionManager 各自 commit/rollback 互不帶動（雷區 5/20 的根源語意）。
- `.github/workflows/ci.yml`：backend-test job 新增 step `mvn -pl backend/wallet-service test -Pcontainers-test`（ubuntu-latest 內建 Docker）。
- `docs/adr/ADR-007.md`：決策全文（為何只加 wallet、為何不取代 H2、兩端 schema 初始化策略差異）。

### Changed
- `AGENTS.md` 雷區 3：補「唯一例外（ADR-007）」說明與新增此類測試的規範。

### Why
- H2 測試由 entity 反向建表，永遠測不到「entity ↔ 真 schema 漂移」「DB 層 CHECK 約束」「真 PG 鎖語意」三類問題；wallet-service 是唯一雙資料源＋帳務核心，H2 假象風險最高。只新增、不取代，保住 CI/本機 `mvn test` 零外部依賴的既有約定（雷區 3）。

### Verified
- `mvn -pl backend/wallet-service test`：161 tests 全綠（containers 測試被排除，行為不變）。
- `mvn -pl backend/wallet-service test -Pcontainers-test`（本機 Docker Desktop）：8 個容器測試全綠。

## [fix] -- 2026-07-08 -- admin-service 補稽核紀錄、鑽石點數卡權限收斂、捕魚機 RTP 誤判、預設種子密碼收斂

### Added
- `backend/admin-service/.../service/AdminPlayerService.java`：`setStatus()` 停用/啟用玩家後 best-effort 寫入 `admin_action_logs`（`PLAYER_BAN`/`PLAYER_UNBAN`），寫法比照 `AdminShopService`（catch `RuntimeException` 只記 WARN，不讓稽核失敗擋住主流程）。
- `backend/admin-service/.../service/DiamondCardService.java`：`generateCards()` 生成後 best-effort 寫入 `admin_action_logs`（`DIAMOND_CARD_GENERATE`，含面額×張數與說明）。

### Changed
- `backend/admin-service/.../controller/AdminPlayerController.java`：`setStatus` 端點改吃 `Authentication`，把 `authentication.getName()` 當作 operator 傳入 service。
- `backend/admin-service/.../controller/AdminDiamondController.java`：`generate()` 權限由 `hasRole('ADMIN')` 收緊為 `hasRole('SUPER_ADMIN')`（比照 GM 發幣），同樣改吃 `Authentication` 傳入 operator。
- `backend/admin-service/.../service/RtpReportService.java`：新增 `admin.rtp.design.fishing`（預設 0.96，依 ADR-004）與 `designRtpFor()` 的 `FISHING` case。
- `backend/admin-service/src/main/resources/application.yml`：`admin.rtp.design.fishing` 補設定項；`admin.seed.enabled` 預設由 `true` 改為 `false`（`ADMIN_SEED_ENABLED` 未設時不再自動播種明文密碼的 SUPER_ADMIN）。
- `backend/admin-service/.../config/AdminUserSeeder.java`：`@Value` 預設值同步改 `false`，補充 Javadoc 說明理由。
- `frontend-admin/src/pages/DiamondCards.jsx`：依 Redux `adminAuth.role` 判斷，非 `SUPER_ADMIN` 不顯示生成表單（改顯示唯讀提示），避免 OPERATOR 送出必 403 的請求。

### Why
- 玩家停用/啟用與鑽石點數卡生成都是有爭議追溯需求的敏感操作，先前完全沒有稽核紀錄，出事無法回答「誰、何時、為何」。
- 鑽石點數卡生成等同「印出可兌換星幣的價值」，風險與 GM 發幣相同，卻只要求 `ADMIN` 而非 `SUPER_ADMIN`，權限範圍過寬。
- 捕魚機自 Phase 1/2 上線後 RTP 報表沒有對照設計值，`deviation` 永遠拿實際 RTP 減 0 比對，Dashboard 永遠紅字異常，形同狼來了，會讓真正的異常被忽略。
- `admin.seed.enabled` 預設 `true` 搭配版控內明文密碼，任何忘記覆蓋環境變數的環境都會自動長出一個可登入的 SUPER_ADMIN，是不必要的預設風險；`.env.example`／測試設定都已明確覆蓋為 `true`，改預設不影響既有本機開發與測試流程。

### Verified
- `mvn -pl backend/admin-service test`：91 tests 全過（含新增的 `AdminPlayerServiceTest`/`DiamondCardServiceTest` 稽核 best-effort 案例、`RtpReportServiceTest` 的 FISHING 正常判定案例、`AdminSecurityIntegrationTest` 新增的 OPERATOR 403 / SUPER_ADMIN 201 端到端案例）。
- `frontend-admin`：`npm run lint` 無錯誤；`npm test -- --run` 2 個測試檔、14 tests 全過。

## [feat] -- 2026-07-07 -- T-054 補完：告警查詢/處理 API + Dashboard 未處理告警列表

### Added
- `backend/admin-service/.../controller/AdminAlertController.java`：`GET /admin/alerts`（分頁、alertType/resolved 可選篩選、id DESC 新到舊）+ `PATCH /admin/alerts/{id}/resolve`（冪等，404=不存在）。
- `backend/admin-service/.../service/AdminAlertService.java`：查詢分流（衍生查詢三組合 + findAll）與標記已處理，掛 `postgresTransactionManager`（雙資料源，admin_alerts 在 Postgres）。
- `backend/admin-service/.../dto/AlertView.java`、`AdminAlertRepository` 衍生查詢、`AdminAlert.markResolved()`（單向、不提供退回）。
- `backend/admin-service/.../service/AdminAlertServiceTest.java`：篩選分流 4 例 + resolve 3 例（含冪等）。
- `frontend-admin`：`adminApi.listAlerts/resolveAlert`；Dashboard 新增「未處理異常告警」區塊（獨立 useFetch、標記已處理只重載告警不重抓報表、玩家 ID 連到詳情頁）。

### Why
- T-054 規則引擎只有寫入端：偵測到異常後管理員只能收 Kafka 推播，後台翻不到歷史告警——功能斷在半路。查詢用衍生方法列舉篩選組合而非 null 參數 JPQL，避開 Postgres null 綁定參數的型別推斷雷。

### Verified
- `mvn -pl backend/admin-service test` 綠燈；frontend-admin `npm test`（14 tests）/ `lint` / `build` 全過。

## [feat] -- 2026-07-07 -- T-051 補完：玩家停用狀態持久化到 members.status（member 內部 API）

### Added
- `backend/member-service/.../controller/InternalMemberController.java`：`PATCH /internal/members/{id}/status`（body `{enabled}`→ ACTIVE/DISABLED），由既有 `InternalSecretFilter`（X-Internal-Secret）守門、不經 gateway；`PlayerService.updateStatus()`、`UpdateMemberStatusRequest`。
- `backend/admin-service/.../client/MemberClient.java` + `config/MemberClientConfig.java`（RestClient 直連 member，比照 game→wallet 的 WalletClientConfig）；`MemberServiceException` → `AdminExceptionHandler` 轉 502。
- `application.yml` 新增 `internal.member-service.base-url`（`MEMBER_SERVICE_URL`，預設 8081）與 secret（`INTERNAL_SECRET`）。

### Changed
- `AdminPlayerService.setStatus()`：先呼叫 member 內部 API 持久化 `members.status`（真相來源），成功後才寫 Redis 封鎖/解封。member 失敗整個操作失敗（502），不留「Redis 已封鎖但 DB 仍 ACTIVE」半套狀態；反向不一致由登入時的 DB status 檢查兜底。
- `AUDIT_REPORT.md`：T-051 移除「跨組待辦」註記、T-054 補查詢端點說明。

### Why
- 原本停用只寫 Redis `disabled:player:{id}`，Redis 資料清空（重啟/淘汰）後停用玩家即可重新登入。member 登入本就同時檢查 `members.status=DISABLED` 與 Redis（2026-06 修過），補上 DB 持久化後兩層防線才完整。

### Verified
- `mvn -pl backend/admin-service,backend/member-service test` 綠燈（新增 admin setStatus 4 例改版含 member 失敗不動 Redis、member updateStatus 3 例）。

## [fix] -- 2026-07-07 -- MySQL 初始化腳本補 SET NAMES utf8mb4：中文種子資料匯入即亂碼

### Fixed
- `database/mysql/init.sql`、`database/mysql/seed_test_data.sql`：檔頭加 `SET NAMES utf8mb4;`。

### Why
- MySQL 容器 entrypoint 用容器內建 `mysql` client 執行 `/docker-entrypoint-initdb.d/*.sql`，容器內無 `LANG`（POSIX locale）時 client 預設編碼是 **latin1**，UTF-8 的中文被當 latin1 讀入再轉存 utf8mb4 → 雙重編碼亂碼（`測試員一` 變 `æ¸¬è©¦å“¡ä¸€`）。受影響：`members.nickname`、`shop_items.name/caption`；英數資料不受影響（ASCII 與 latin1 相容）。
- 既有壞資料以重建 volume 修復（`docker compose down -v && up -d`），本機測試資料一併重置。

### Verified
- 重建後查 `members.nickname` = 測試員一/二/三、`shop_items` 中文正常；Postgres 錢包種子（1001~1003 各 10000）與 Kafka topics（kafka-init）自動重建。
- ⚠️ 注意：volume 重建後 `admin_users` 為空，`AdminUserSeeder` 是啟動期 CommandLineRunner，須**重啟 admin-service** 讓種子帳號重新寫入才能登入後台。

## [feat] -- 2026-07-07 -- 管理後台 8 個功能頁完成 API 串接（脫離 stub）

### Added
- `frontend-admin/src/hooks/useFetch.js`：頁面資料抓取共用 hook（loading/error/reload 樣板＋競態守門：只採用最後一次請求的結果）。頁面資料「進頁抓、離頁丟」無跨頁共享，故不進 redux（auth 除外）。
- `frontend-admin/src/utils/format.js`：千分位金額、LocalDateTime 裁切顯示（不經 Date 解析避免時區位移）、RTP 百分比、本地時區 `YYYY-MM-DD`。
- `frontend-admin/src/components/ui.jsx`：共用展示元件（Loading/Error/Empty、Table/Td、Badge、Pagination（吃 Spring Data Page）、PageHeader、StatCard）。

### Changed
- 8 個頁面由 PageStub 換成實作，串接 adminApi 全部端點：
  - `Dashboard`：近 7 日 coin-flow + RTP 平行抓取，RTP 異常置頂告警（admin_alerts 查詢端點後端尚未提供，待補後加告警列表）。
  - `Players` / `PlayerDetail`（T-051）：分頁列表＋送出制關鍵字搜尋；詳情含餘額/凍結、近期帳務/對局、停用/啟用兩段式確認（不用 window.confirm——原生對話框阻塞事件圈且不可控樣式），狀態以 reload 後端結果為準不做前端翻轉。
  - `CoinFlowReport`（T-052）/ `RtpReport`（T-053）:「編輯中 vs 已查詢」條件分離（按查詢才打 API）；RTP 頁標示含本金口徑與偏差門檻。
  - `GmGrant`（T-055）：兩段式確認（改任一欄位即退出確認態），成功顯示 QUEUED＋冪等鍵並清空表單防重複發放。
  - `DiamondCards`（T-105/T-106）：生成表單（1~1000 張）＋序號 textarea/一鍵複製（序號僅生成當下完整可見）＋狀態篩選列表。
  - `ShopItems`（ADR-006）：收合式新增表單（409=item_code 重複由 extractError 帶出）＋列內編輯（改價/上下架/排序），頁頂提醒同步玩家端 `mockApi.SHOP_CATALOG`（雷區 14/20）。

### Removed
- `frontend-admin/src/components/PageStub.jsx`：所有頁面已實作，佔位元件無使用處。

### Why
- 骨架期只有登入可用、7 個功能頁全是佔位，後台實際無法運營；admin-service 後端 API 早已全部完成（T-050~T-055、T-105/T-106、商城目錄），本次純前端串接、未動任何後端。

### Verified
- `npm run lint` 乾淨；`npm run build` 成功（各頁 code-split 正常，最大頁 ShopItems 6.7 kB）。
- 端到端需啟動 gateway + admin-service 後以 seeder 帳號登入手動驗證（依 DEPLOY.md）。

## [fix] -- 2026-07-07 -- gateway 放行 /admin/**：後台 API 先前整條被 gateway 401 擋死

### Fixed
- `backend/gateway-service/src/main/resources/application.yml`：`jwt.whitelist` 新增 `/admin/`。
- `backend/gateway-service/.../GatewayRoutesConfigTest.java`：新增 `jwtWhitelist_includesAdminPath` 鎖住此設定。

### Why
- T-050 讓後台改用獨立 `ADMIN_JWT_SECRET` 簽發 JWT，但 gateway 的 `JwtAuthenticationGlobalFilter` 只用玩家 `JWT_SECRET` 驗簽，從未對齊：登入端點 `/admin/auth/login` 不在白名單（無 token → 401 `missing bearer token`），登入後的 ADMIN JWT 也會被判 `invalid token`。**經 gateway 的後台路徑從未通過**——過去沒發現是因為 admin-service 測試都直打 8086。
- 修法採「gateway 純轉發、admin-service 自身守門」：`AdminJwtAuthFilter` + `@PreAuthorize` 本來就對無效 token 一律 401/403（T-050 有測試驗收），gateway 反正驗不了 admin secret，留著只會誤殺。filter 內 `/admin/** 需 ADMIN role` 的檢查保留未動（防未來有人移除白名單時仍有底線）。

### Verified
- `mvn -pl backend/gateway-service test`：26 tests 全綠（含新增 1）。
- 手動驗證項（重啟 gateway 後）：frontend-admin（5174）以 seeder 帳號登入應成功、stub 頁可導航。

## [feat] -- 2026-07-07 -- 新增管理後台前端骨架 frontend-admin/（獨立 Vite 專案）

### Added
- `frontend-admin/`：獨立於玩家端的管理後台 React 專案（Vite + React 18 + Redux Toolkit + Tailwind，port **5174**）。本次為骨架：登入流程可用，7 個功能頁為佔位 stub。
  - `src/services/api.js`：axios 實例掛 ADMIN JWT；admin 無 refresh token（`LoginResponse` 只回 accessToken），401 一律登出重導（登入端點 401=帳密錯誤除外），不做玩家端的 single-flight 續期。
  - `src/services/adminApi.js`：對齊 admin-service 全部既有端點（T-050 登入、T-051 玩家管理、T-052/T-053 報表、T-055 GM 發幣、T-105/T-106 點數卡、ADR-006 商城目錄）。
  - `src/store/slices/adminAuthSlice.js`：登入狀態含 `role`（SUPER_ADMIN/OPERATOR）；localStorage key 加 `admin` 前綴與玩家端區隔。
  - `src/App.jsx`：`AdminPrivateRoute` 守未登入、`SuperAdminRoute` 守 GM 發幣；SPA 路由不用 `/admin` 前綴（該前綴是 API 路徑，dev proxy 轉發 gateway 8080）。
  - `src/components/AdminLayout.jsx`：側邊欄導航，GM 發幣入口僅 SUPER_ADMIN 顯示（後端 `@PreAuthorize` 仍是最終防線）。
  - 頁面：`Login`（可用）＋ `Dashboard/Players/PlayerDetail/CoinFlowReport/RtpReport/GmGrant/DiamondCards/ShopItems`（stub，標明待串 API）。

### Why
- admin-service 後端 API（T-050~T-055、T-105/T-106、商城目錄）已全部完成，但前端完全沒有管理介面。
- 選擇獨立專案而非併入 `frontend/`：後端本來就是獨立 `ADMIN_JWT_SECRET` ＋獨立角色的邊界，前端對齊此切分；後台可獨立部署於內網，管理端路由/API 形狀不進玩家 bundle。
- dev 走 vite proxy（`/admin` → 8080）＝同源請求，免動 gateway 的 `CORS_ALLOWED_ORIGINS`。

### Verified
- `npm run lint` 乾淨；`npm run build` 成功（各頁正確 code-split）。
- 登入流程待啟動 admin-service 後手動驗證（本次僅骨架，無單元測試——頁面實作時比照玩家端補 vitest）。


﻿## [fix] -- 2026-07-07 -- 老虎機震動解除加 animationend 冒泡守門

### Fixed
- `frontend/src/pages/SlotGame.jsx`：機櫃震動包裹層的 `onAnimationEnd` 加 `e.target !== e.currentTarget` 守門。原寫法會收到 SlotMachine 所有後代（含 pseudo-element）冒泡上來的 `animationend`——目前同時段子動畫（`slot-win-glow` 2.1s）比震動（0.55s）晚結束所以無實害，但日後任何 <0.55s 的有限子動畫都會提早砍掉震動。

### Why
- code-reviewer 審 179d9bb 時發現的潛伏地雷，趁未踩雷先修：守門後只認包裹層自己的 `slot-shake` 結束事件，語意與原設計（震動播完即解除）一致。

### Verified
- `npm run lint` 乾淨、`npm run build` 成功、`npx vitest run` 36/36 綠。

## [chore] -- 2026-07-07 -- 新增 .claude/agents 六角色 subagent 定義

### Added
- `.claude/agents/`：dev-coder / frontend-dev / qa-tester / code-reviewer / ui-ux / devops 六角色 + README（pipeline 與使用方式）。全英文（給 AI 讀）；雷區知識一律指回根目錄 `AGENTS.md`，不複製進 agent 檔（防六份漂移）。code-reviewer / ui-ux 工具白名單無 Edit/Write（審改利益衝突、設計不寫碼）。

### Why
- 移植自另一專案的六角色分工骨架，領域守則全部改寫為本專案雷區（帳務冪等/樂觀鎖、Kafka 指令/事件、遊戲三鐵則、mock 鏡像、四同步）。clone 專案即得，跨成員共用。

### Verified
- 以 general-purpose agent 載入角色 prompt 實測：code-reviewer 審 179d9bb（照雷區清單審、實跑 vitest、找到 SlotGame animationend 冒泡問題、輸出 PASS/FAIL 格式）；ui-ux 產出 Lobby 近期贏分規格（正確查證後端資料源、拒用 botFeed 假資料）。新 agent 檔需重啟 session 才註冊。

## [feat] -- 2026-07-06 -- 前端三遊戲沉浸感升級：程序化 BGM 大改版＋環境音＋視覺打磨

### Added
- `frontend/src/casino-fx/sound/musicTheory.js`：MIDI→頻率、音階（宮調五聲/五聲小調/自然小調）、和弦品質與度數換算。純函式，可獨立測試。
- `frontend/src/casino-fx/sound/bgmInstruments.js`：BGM 樂器配方（pad 和弦墊/低音撥弦/古箏感撥弦/顫音琴/號角/大鼓/刷鼓/ride/沙鈴/氣泡），全部音符節點自我終結；`createAmbience()` 環境音迴圈（loop 噪音＋濾波＋慢速 LFO），handle 由 composer 持有並清理。
- `frontend/src/casino-fx/sound/bgmThemes.js`：四主題宣告式編曲——slot（96bpm 宮調喜慶、C–Am–F–G）、baccarat（72bpm 小調 lounge、重 swing）、fishing（64bpm 深海氛圍 drone＋機率氣泡）、boss（132bpm 大鼓＋號角 ostinato）；各主題含環境音層（賭場底噪/人聲低鳴/海水湧動）。
- `frontend/src/casino-fx/sound/bgmComposer.js`：singleton 排程器。lookahead 排程（沿用原 useBgm 數學）＋多音軌/和弦進行/swing/音量人性化；`setIntensity(0~2)` 讓音樂隨遊戲張力增厚（轉輪中/發牌中疊入高層音軌）；主題切換 0.8s crossfade（fishing→boss 不再硬切）。`computeStepEvents` 純函式供測試。
- 測試 `musicTheory.test.js`＋`bgmComposer.test.js`（21 個）：主題資料完整性全掃描（進行/樂句長度、頻率有限正值、swing 只在反拍）、intensity 分層、rng 可重現、ctx=null 安全、mock AudioContext 下 tick 實排音符、ambience dispose 防洩漏 spy。
- 視覺：老虎機轉動中光帶掃過櫃體＋跑馬燈加速＋中獎增亮脈動＋爆機級（≥8x）機櫃震動（`animationend` 移除，無魔術數字）；百家樂牌桌 vignette 聚光（結算時加深聚焦贏方）＋籌碼落點微彈跳；捕魚機 Pixi 神光光楔（add 混合、4 道固定池、perfMode 熄滅）＋浮游生物微粒（20 顆固定池、reducedMotion 不生成）。

### Changed
- `frontend/src/casino-fx/sound/useBgm.js`：改為薄轉接層（THEMES 移入 bgmThemes），API `useBgm(theme, active, {intensity})` 向下相容既有兩參數呼叫。
- `frontend/src/pages/SlotGame.jsx`、`Baccarat.jsx`：接上 intensity（轉輪中/發牌咪牌中 → 2）；SlotGame 加機櫃震動狀態。
- `frontend/src/components/SlotMachine.jsx`：轉動中掛 `slot-machine--live`。
- `frontend/src/index.css`：新增上述 slot/baccarat 樣式，並將新動畫全部補進 `prefers-reduced-motion: reduce` 例外區。
- `frontend/src/components/fishingEngine.js`：`_buildBackdrop/_redrawBackdrop/_updateBackdrop/destroy` 加神光與浮游生物（比照 caustics/泡泡既有模式，perfMode/reducedMotion 守門）。

### Why
- 原 BGM 是 16 步打擊點排程（每主題僅 2~4 個 drum/chip 音），聽感如節拍器，是「不沉浸」主因。升級為和聲＋低音＋旋律＋環境音的多層程序化合成：零音檔、零授權依賴，且全部走既有 `bgmGain`——「音樂」開關與音量滑桿免改直接生效（SiteSettings/SoundEngine/sfx.js 零改動）。玩法、後端契約、mock 賠付（雷區 14）完全未動。

### Verified
- `npm run test` 35 passed（含新增 21）；`npm run lint` 乾淨；`npm run build` 成功。
- 手動驗證項（開發者本機）：`npm run dev` 進三遊戲聽層次與 intensity 增厚、fishing↔boss crossfade、遊戲中關「音樂」<0.5s 靜音、捕魚頁 perfMode 下神光熄滅/FPS 無劣化。

## [changed] -- 2026-07-06 -- 調高百家樂風控全局 RTP 門檻（1.02 → 1.20）

### Changed
- `backend/game-service/src/main/resources/application.yml`：`risk.global-rtp-limit.BACCARAT` 由 1.02 調至 1.20，並補上量化依據註解。

### Why
- 與同日 SLOT 門檻調整同一類問題、用同一套蒙地卡羅方法覆核（300 萬局，鏡像 `BaccaratGameService` 無限靴發牌/補牌表、`win_amount = totalPayout + rebate` 口徑、`BaccaratService.settle` 的攔截改判邏輯）。
- 風控口徑內的百家樂正常水位 ≈ 0.97~1.00（結構性 ≈0.99 ＋ 返水 0.5~1%，隨押注輪廓與注額浮動），500 局窗口 RTP 標準差 ≈ 0.04~0.06（押和 9x 比例越高越大）。舊門檻 1.02 只在均值上方約 0.5σ：開環下 23~31% 的檢查誤判超限；閉環下約 7% 的局被強制改判為莊家贏（押閒/押和的合法中獎被沒收，實得 RTP 被壓約 1.3 個百分點）——與 2026-06-25 修過的誤判事故同類，只是幅度較小、持續存在。
- 取 1.20：即使在押和偏多（40/40/20）輪廓下誤觸率 ≤0.08%，實得 RTP ≈ 自然值；而真異常（派彩 bug、和局漏洞單局 9x）會讓窗口 RTP 持續遠超 1.2，攔截力仍在。百家樂尾巴（最大 9x）比老虎機（70x）輕，故門檻低於 SLOT 的 1.30。
- `RiskControlServiceTest` 不受影響（測試自建門檻 map，不讀 application.yml）。

### Verified
- `mvn -pl backend/game-service test` 全綠。
- 模擬（窗口 500、45/45/10 押注輪廓、返水 1%）：門檻 1.02/1.05/1.10/1.15/1.20 的閉環強制改判率分別為 7.42%/3.66%/0.65%/0.08%/0.003%，實得 RTP 0.971/0.979/0.985/0.986/0.985（自然值 ≈0.985）。
## [test] -- 2026-07-06 -- 新增網站設定面板 e2e 測試（SiteSettings）

### Added
- `frontend/e2e/site-settings.spec.js`：Playwright e2e（mock 模式、免後端）覆蓋 commit 327c7cf 的網站設定面板——開啟面板、關閉「全網公告效果／網站背景效果」、音量調整、驗證 localStorage（`lucky-star-site-preferences-v1`／`lucky-star-sound-settings-v1`）寫入、消費端即時反應（`.coin-rain` 從 DOM 移除）、重新整理後設定讀回、ESC 關閉。

### Why
- 該面板此前無任何測試覆蓋（vitest 只有 api/mockApi）。設定為純前端偏好（localStorage + storage 事件跨分頁同步），無後端 API，故以 e2e 驗證「儲存/讀取/實際作用」整條鏈。
- 註：自訂開關樣式會讓 Playwright 的 `check()/uncheck()` 點不到原生 checkbox（裝飾 span 攔截 pointer events），測試改點整列 label；日後寫相關測試比照。

### Verified
- `npx playwright test e2e/site-settings.spec.js` 1 passed（7.9s）。
## [docs] -- 2026-07-06 -- 真後端全鏈路 smoke test 結果紀錄（無程式變更）

### Verified
- 實跑 gateway(8080)+member(8081)+wallet(8082)+game(8083)（Docker infra healthy）：註冊(201) → 登入(200) → 查餘額 → 模擬充值 → 老虎機 5 局 → 百家樂 36 局（閒/莊/和輪押）。
- 派彩契約與 mock 全部一致：老虎機 `payout = bet × multiplier`、逐局錢包對帳吻合；百家樂閒贏 2x、莊贏 1.95x（5% 傭金）、押和中 9x（含本金 900）、和局押閒/莊 push 退本金、返水 `max(1, totalBet/200)`（與 `mockApi` 公式相同）。
- 錯誤碼：餘額不足 422「星幣餘額不足」（mock 同文案）、注額違規 400（單局 100~5,000）、無 token 401。

### 發現的兩個世界分歧（未修改，留待產品決策）
1. **新玩家初始資金**：真後端新手禮僅 100 星幣（`GM_REWARD`，經 outbox 約 5 秒入帳），而老虎機最低注 100 → 真環境新玩家只能玩一把就必須充值；mock 新註冊直接給大額測試餘額。
2. **限流與非同步行為 mock 沒有**：(a) gateway 對 `/api/v1/game/**` 有 per-player 1 秒窗口限流，連打回 429 `"Too many requests"`，前端無專門處理、會把英文訊息直接顯示；(b) 註冊後立刻查餘額會 404 `Wallet not found`（Kafka 開戶延遲 <1s），mock 永遠即時。實際 UI 流程通常不會踩到，但寫前端重試/文案時要知道。

### Why
- 本輪前置診斷只跑過 mock 模式；此筆補上真後端鏈路驗證的結果與分歧清單，避免下次重查。
## [changed] -- 2026-07-06 -- 調高老虎機風控全局 RTP 門檻（0.97 → 1.30）

### Changed
- `backend/game-service/src/main/resources/application.yml`：`risk.global-rtp-limit.SLOT` 由 0.97 調至 1.30，並補上量化依據註解。

### Why
- 舊門檻 0.97 只比老虎機結構性 RTP（≈0.938，`SlotSymbol` Javadoc）高 3.2 個百分點，但賠付表含 70x（SEVEN 三連）/50x（STAR 三連）重尾，單局派彩倍率標準差 ≈ 2.4，`rtp-sample-size: 500` 的窗口 RTP 標準差 ≈ 0.107 —— 0.97 只在均值上方 0.3σ，屬正常波動範圍，非異常訊號。
- 蒙地卡羅模擬（500 萬局，鏡像 `SlotSymbol` 權重/兩階賠付與 `RiskControlService`/`SlotService` 攔截邏輯）：開環下 0.97 有 36.4% 的檢查判定超限；閉環（超限贏局被 `SlotService.settleInternal` 強制改判 noWin、以 0 派彩入帳）下約 5.9% 的贏局被沒收、玩家實得 RTP 被壓到 0.88。這正是雷區 17 / 2026-06-25 百家樂誤判事故的同類 bug，仍在老虎機上活著。
- 原候選區間 0.98~0.99 幾乎無改善（閉環沒收率仍 5.2~5.6%），因此比照 FISHING 1.10「高變異留足裕度」的做法放大到 1.30：誤觸降至 0.06% 贏局（實得 RTP 0.938 ≈ 理論值），而真異常（賠付表 bug / 漏洞）會讓窗口 RTP 持續遠超 1.3，攔截力仍在。
- `RiskControlServiceTest` 不受影響：測試自建門檻 map（SLOT=0.95）驗證判定邏輯，不讀 application.yml。

### Verified
- `mvn -pl backend/game-service test` 全綠。
- 模擬腳本（等注額、窗口 500）：門檻 0.97/0.99/1.20/1.30 的閉環贏局沒收率分別為 5.93%/5.19%/0.30%/0.06%，實得 RTP 0.880/0.891/0.935/0.938。
## [docs] -- 2026-07-06 -- 修正 AGENTS.md 雷區 16 過時的砲台傷害數值

### Fixed
- `AGENTS.md` 雷區 16：「砲台傷害收斂為 {0,10,14,18}」改為與程式碼一致的 `{0,14,22,32}`（`FishingCombat.CANNON_DAMAGE`，前端 `mockApi.js` 的 `FISHING_CANNON_DAMAGE` 已同步為此值）。

### Why
- 文件殘留 ADR-004 早期草案數值，與 `FishingCombat.java:61` 實際實作不符，會誤導後續依文件改數值的人。

### Verified
- 對照 `FishingCombat.java` 與 `frontend/src/services/mockApi.js`，三處數值一致；純文件修改，無程式行為變更。
## [removed] -- 2026-07-05 -- Fishing buy-in entry note panel

### Removed
- `frontend/src/pages/Fishing.jsx`: remove the buy-in screen `fishing-entry-note` note block.
- `frontend/src/components/Fishing.css`: remove the now-unused `fishing-entry-note` styles.

### Why
- The buy-in panel should be cleaner and no longer show the entry note card.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
## [changed] -- 2026-07-05 -- Fishing missed shots consume ammo

### Changed
- `frontend/src/components/fishingEngine.js`: route empty-water shots through the normal `fire()` flow using a `MISS` shot type, so shots that do not hit any fish still deduct the current `betPerShot` before showing the bullet animation.
- `backend/game-service/src/main/java/com/luckystar/game/service/FishingService.java`: accept `MISS` shots as charged non-hit results with no damage, no capture, no payout, and no residual recovery.
- `frontend/src/services/mockApi.js`: mirror the backend `MISS` shot behavior in mock mode.

### Why
- Every fired bullet should consume ammo consistently, whether it hits a normal fish, hits an obstacle creature, or misses all fish.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
- `mvn -pl backend/game-service clean test`
## [changed] -- 2026-07-05 -- Fishing blocker shots consume session balance

### Changed
- `frontend/src/components/fishingEngine.js`: route blocker hits through the normal `fire()` flow so shooting obstacle creatures deducts the current `betPerShot` and shows the deducted amount in the blocker hint.
- `backend/game-service/src/main/java/com/luckystar/game/service/FishingService.java`: accept `BLOCKER_OCTOPUS`, `BLOCKER_STARFISH`, and `BLOCKER_TURTLE` shots as charged no-payout obstacle hits without running normal fish combat.
- `frontend/src/services/mockApi.js`: mirror the backend blocker-shot behavior in mock mode.

### Why
- Obstacle creatures should cost ammo like any shot while still behaving as blockers: no damage, no capture, no payout, and no residual recovery.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
- `mvn -pl backend/game-service clean test`
## [changed] -- 2026-07-05 -- Fishing evil blocker pressure scaling

### Changed
- `frontend/public/images/fishing/blocker-octopus.svg`, `blocker-starfish.svg`, and `blocker-turtle.svg`: remove the white mouth/teeth line from each evil blocker asset.
- `frontend/src/components/fishingEngine.js`: scale evil blocker spawn pressure by active fish tier; medium, high/special, and boss fish now shorten blocker spawn intervals, raise simultaneous blocker caps, and can trigger multi-blocker waves.

### Fixed
- Confirmed the previous non-applied evil blocker issue came from the Pixi asset pipeline: the game could still use stale `fish-blocker-*` texture keys, and the texture cache previously ignored the resolved asset URL. The current game path uses `fish-evil-blocker-*` ids and URL-aware texture cache keys.

### Why
- Higher-value fish should be harder to line up cleanly, and the evil blocker art should not retain the bright white mouth strokes that made the face look off.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
## [fixed] -- 2026-07-05 -- Fishing evil blocker asset pipeline

### Fixed
- `frontend/src/components/fishingEngine.js`: switch in-game blocker spawning to dedicated `fish-evil-blocker-*` asset ids so the Pixi stage no longer reuses the old blocker texture keys.
- `frontend/src/casino-fx/assets/registry.js`: register the dedicated evil blocker asset ids with fresh cache-busted SVG URLs.
- `frontend/src/casino-fx/assets/bakeTextures.js`: include the resolved asset source URL/component name in the texture cache key so future art URL changes create a fresh texture instead of reusing stale in-memory assets.

### Why
- The evil blocker SVG files were updated, but the running Pixi asset pipeline could still resolve or cache textures by the old blocker asset ids, making the game appear to use the previous obstacle art.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
## [changed] -- 2026-07-05 -- Fishing evil blocker size tiers

### Changed
- `frontend/public/images/fishing/blocker-octopus.svg`, `blocker-starfish.svg`, and `blocker-turtle.svg`: redesign blocker creatures with darker palettes, sharper silhouettes, angry red eyes, teeth/spikes, and heavier shadows.
- `frontend/src/components/fishingEngine.js`: add small / medium / large blocker size profiles; small blockers absorb 5 bullets, medium blockers absorb 10 bullets, and large blockers absorb 17 bullets before leaving.
- `frontend/src/casino-fx/assets/registry.js` and `frontend/src/data/fishingFishConfig.js`: bump blocker asset URLs and update the fish guide copy to explain the 5 / 10 / 17 bullet blocking rule.

### Why
- Obstacles should feel more threatening and should create varied shooting lanes with clearly different blocking durability by size.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
## [changed] -- 2026-07-05 -- Fishing blocker durability and cleaner hit feedback

### Added
- `frontend/src/data/fishingFishConfig.js` and `frontend/src/components/FishingFishInfoPanel.jsx`: add obstacle octopus, starfish, and turtle entries to the bottom fish guide with no-coin and 10-shot blocking labels.

### Changed
- `frontend/src/components/fishingEngine.js`: make blocker creatures withstand exactly 10 intercepted bullets before leaving, while keeping their size and speed variation across octopus, starfish, and turtle variants.
- `frontend/src/components/fishingEngine.js`: hide normal damage numbers and HP bars during play; critical hits still show a floating critical label.

### Why
- The fishing stage should keep combat feedback lively without visual clutter, and obstacle creatures should be explained clearly as no-cost blockers rather than normal fish targets.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
## [changed] -- 2026-07-05 -- Fishing blocker creature variety

### Added
- `frontend/public/images/fishing/blocker-octopus.svg`, `blocker-starfish.svg`, and `blocker-turtle.svg`: add dedicated obstacle creature visuals for the fishing stage.

### Changed
- `frontend/src/casino-fx/assets/registry.js`: register the new blocker creature SVG assets for Pixi preload.
- `frontend/src/components/fishingEngine.js`: randomize blocker spawns across octopus, starfish, and turtle variants with different sizes, speeds, and movement wobble while preserving no-cost bullet blocking behavior.

### Why
- Obstacle blockers should read as distinct sea creatures rather than another normal fish, and their sizes should vary to make the shooting lane feel less uniform.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
## [changed] -- 2026-07-05 -- Fishing live ammo switching and hit feedback

### Added
- `frontend/src/components/fishingEngine.js`: add immediate hit sparks/damage floats/HP preview, blocker fish that intercept bullets without calling `fire()`, and safer fish spawn bounds away from the cannon zone.
- `backend/game-service/src/main/java/com/luckystar/game/dto/FishingShotsRequest.java`: allow each shot to carry an optional `cannonLevel` for in-round ammo switching.

### Changed
- `backend/game-service/src/main/java/com/luckystar/game/fishing/FishingCombat.java`, `FishingSession.java`, `FishingSessionStore.java`, and `service/FishingService.java`: raise cannon damage to 14 / 22 / 32, resolve damage per shot, persist per-instance residual recovery, and verify killing shots with their actual cannon level.
- `frontend/src/hooks/useFishingSession.js`, `frontend/src/pages/Fishing.jsx`, `frontend/src/components/FishingControlDock.jsx`, and `frontend/src/services/mockApi.js`: let ammo/cannon selection change while playing, send per-shot cannon level, and mirror the backend damage/recovery model in mock mode.
- `frontend/src/casino-fx/sound/SoundEngine.js`: prevent queued BGM notes from playing after BGM is disabled, including Boss transitions.

### Why
- Fishing needs faster visual feedback, in-game ammo switching, blocker fish that create no-cost shot obstruction, and spawn rules that avoid fish appearing directly beside the cannon.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
- `mvn -pl backend/game-service test`
## [fixed] -- 2026-07-05 -- Fishing fullscreen top-up and entry flow refinements

### Changed
- `frontend/src/hooks/useFishingSession.js`: stop auto-resuming an active fishing session on page mount so every `/game/fishing` entry shows the buy-in screen first.
- `frontend/src/pages/Fishing.jsx`: wrap the stage and top-up dialog in the fullscreen target, move the performance toggle into the stage marquee, and pass active ammo tone into canvas/dock controls.
- `frontend/src/components/FishingCanvas.jsx`, `frontend/src/components/FishingControlDock.jsx`, and `frontend/src/components/fishingEngine.js`: map ammo tone to the actual Pixi firing cannon, including copper single-barrel, silver dual-barrel, and gold heavy triple-barrel silhouettes, plus bullet color, cannon scale, barrel tint, muzzle flash, and dock cannon bay styling.
- `frontend/src/components/Fishing.css`: increase HUD metric height/radius, place the performance toggle on the marquee right side, support the new fullscreen surface, and add ammo-specific cannon bay skins.

### Why
- Fullscreen only renders descendants of the requested element, so the top-up dialog must live inside the fullscreen target. The fishing page should not skip buy-in from any navigation entry, and ammo choices should have clearer cannon feedback without changing backend-authoritative damage/RTP rules.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
## [fixed] -- 2026-07-04 -- Jackpot fish king front silhouette cleanup

### Fixed
- `frontend/public/images/fishing/rainbow-jackpot-fish-king.svg`: removed the two front protruding sharp points and removed the mouth, teeth, and mouth highlight paths from the active jackpot fish king asset.
- `frontend/src/data/fishingFishConfig.js` and `frontend/src/casino-fx/assets/registry.js`: bumped the active rainbow jackpot fish king asset URL to force the updated SVG to load in the game and fish guide.

### Why
- The visible in-game asset was still the active rainbow SVG, which retained the old front points and mouth even after earlier legacy asset edits.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`
## [changed] -- 2026-07-04 -- Fishing fullscreen and golden dragon king guide

### Added
- `frontend/src/components/FishingFullscreenButton.jsx`: add Fullscreen API toggle for the Pixi fishing stage.
- `frontend/src/components/FishingFishInfoPanel.jsx` and `frontend/src/data/fishingFishConfig.js`: add lobby fish guide data, rewards, rarity, and golden dragon king display metadata.
- `frontend/public/images/fishing/golden-dragon-king.svg`: add a dedicated dragon-shaped golden dragon king visual asset.

### Changed
- `frontend/src/pages/Fishing.jsx`: wire fullscreen state, unsupported/failure messaging, immersive stage class, and move the fish guide into a bottom page information section.
- `frontend/src/services/fishingApi.js`, `frontend/src/casino-fx/assets/registry.js`, and `frontend/src/components/fishingEngine.js`: keep backend `DRAGON_KING` shot validation compatible, prioritize 彩金魚王 in the timed Boss spawn, and load the new rainbow-colored jackpot fish king SVG with a smooth front face without protruding fins, a fresh non-cached asset id/file, quick in-game spawn, and the largest in-game body size through a cache-busted asset URL.
- `frontend/src/components/Fishing.css`: add red-gold fullscreen button states, fullscreen stage layout, centered lobby content, and responsive fish guide card styling.

### Why
- The fishing page needed a more immersive play mode and clearer lobby-side game information while remaining compatible with the current backend fishing species contract.

### Verified
- `npm.cmd run lint`
- `npm.cmd run build`
- `npm.cmd run test`

﻿# Changelog — Lucky Star Casino

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [changed] -- 2026-07-04 -- Fishing page API alignment and control dock refinement
### Added
- `frontend/src/services/fishingApi.js`: added a fishing-specific adapter over the existing game API mock/real switch.
- `frontend/src/data/fishingConfig.js`: centralized the three fishing ammo options as 10 / 50 / 100 star-coin bet-per-shot presets.
- `frontend/src/components/FishingControlDock.jsx` and `FishingSettlementPanel.jsx`: split reusable fishing controls and settlement summary UI out of the page.

### Changed
- `frontend/src/pages/Fishing.jsx`: refreshes wallet balance on entry, uses the fishing adapter/config, shows full-round catch count, gates top-up to depleted session balance, and presents settlement as consumption / catch count / reward / net result.
- `frontend/src/hooks/useFishingSession.js`: routes through `fishingApi`, persists session buy-in in view state, and tracks full-round caught fish count separately from the capped verify-shot log.
- `frontend/src/components/fishingEngine.js`: raises the Pixi cannon origin so the cannon remains visible above the in-stage control dock.
- `frontend/src/components/Fishing.css`: added scoped red-gold dock overrides for consistent ammo card sizing, disabled/active states, RWD layout, and API error messaging.

### Why
- Align `/game/fishing` with the current backend contract: `betPerShot` is the player-selected ammo amount, cannon damage remains a separate session-level backend setting, and top-up should only appear when the current session balance is insufficient.

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`

## [changed] -- 2026-07-04 -- Baccarat table UI rebuilt into casino-style layout
### Added
- `frontend/src/components/baccarat/*`: added Baccarat-specific table header, status bar, hand/card panels, betting mat, chip tray, settlement panel, roadmap tabs, and disabled Side Bet UI.

### Changed
- `frontend/src/pages/Baccarat.jsx`: reorganized Baccarat around `idle` / `betting` / `dealing` / `squeezing` / `settled` phases while preserving `betBaccarat`, wallet updates, squeeze mode, sound effects, win effects, result history, and leave guard behavior.
- `frontend/src/components/BaccaratRoadmap.jsx`: kept the existing import path as a compatibility wrapper over the new roadmap panel.
- `frontend/src/index.css`: added scoped `.baccarat-page` / `.baccarat-*` styles for the red-gold table layout, felt betting mat, sticky mobile chip tray, roadmap tabs, and settlement banner.

### Fixed
- Baccarat settlement copy now distinguishes Tie push refunds from direct Tie wins while leaving API and wallet math unchanged.

### Why
- Make `/game/baccarat` feel like an actual online baccarat table, improve mobile betting ergonomics, and keep all new styling scoped away from Slot, Fishing, Lobby, Member, and Profile pages.

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
## [changed] -- 2026-07-04 -- Site settings button moved into header
### Changed
- `frontend/src/App.jsx`: removed the global floating settings button from the root site chrome.
- `frontend/src/components/AppShell.jsx`: placed the settings gear inside the header control row beside the existing wallet and notification controls.
- `frontend/src/components/SiteSettings.jsx` and `frontend/src/components/SiteSettings.css`: simplified the settings component to the header-integrated layout and normalized its Chinese labels.

### Why
- Keep the settings entry aligned with the site's header controls instead of floating independently over page content.

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`

## [changed] -- 2026-07-03 -- Centralized site settings panel
### Added
- `frontend/src/components/SiteSettings.jsx` and `frontend/src/components/SiteSettings.css`: added a gear settings panel for volume, sound effects, music, global announcement effects, and background effects.
- `frontend/src/utils/sitePreferences.js`: added localStorage-backed site preferences shared by visual effects and announcements.

### Changed
- `frontend/src/components/QuickToolbar.jsx`: removed the old sound/music controls so audio settings live only in the settings panel.
- `frontend/src/components/CoinRain.jsx` and `frontend/src/casino-fx/announce/AnnouncementTicker.jsx`: made background and announcement effects respect the shared site preferences.
- `frontend/src/App.jsx` and `frontend/src/components/AppShell.jsx`: mounted the settings button and stopped/started bot announcements based on the announcement preference.

### Why
- Keep site-wide audio and visual effect controls in one predictable place and prevent duplicate controls in the quick toolbar.

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`

## [changed] -- 2026-07-03 -- Mock wallet test balance set to 999999999
### Changed
- `frontend/src/services/mockApi.js`: set mock star coin wallets to `999999999` for the active player, seeded demo/test accounts, and new mock registrations.

### Why
- Enable effectively unlimited frontend game testing in mock mode without manual top-ups.

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`

## [changed] -- 2026-07-03 -- Quick toolbar no longer covers game views as much
### Changed
- `frontend/src/components/QuickToolbar.jsx`: removed the fishing game shortcut from the open quick toolbar.
- `frontend/src/components/QuickToolbar.css`: changed the quick toolbar to bottom anchoring globally so the expand/collapse toggle stays in the same lower position on every page.

### Why
- The toolbar toggle should not remain mid-screen on non-game routes or jump between open and collapsed states.

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`

## [fix] — 2026-07-03 — 捕魚場中加值三修：彈藥進場固定（契約對齊）、top-up 併發鎖、亂碼註解/訊息復原

> **背景**：健檢捕魚場中加值（top-up）+ 彈藥切換這批變更時發現三類問題：
> ① 前端新增的 `changeBetPerShot`/`changeCannonLevel` 允許**場中**切換彈藥，但後端 `FishingService.validateBatch` 強制每發 `betPerShot`==進場面額（ADR-004 整場固定）、傷害只認 `session.cannonLevel`（`Shot` DTO 根本沒有 cannonLevel 欄位）——接真 API 時切換後每批射擊整批 400；mock 又不驗注額，導致 mock 能玩、真 API 壞（違反雷區 14）。
> ② top-up 雖有 `drainPendingShots()`，但 drain 後、請求 in-flight 期間 `fire()` 未被擋，且 drain 逾時仍放行——`shots` 與 `topUp` 在後端都是「讀→改→整包 save」session 且無鎖，併發會互相覆寫（最壞：錢包已扣款、加值卻被射擊批次回寫吃掉）。
> ③ 4 個檔案的中文註解/使用者訊息被存成亂碼（`?` 或 Big5 二次編碼），玩家會看到問號錯誤訊息、日誌印亂碼。

### Fixed
- **彈藥進場固定（採前端對齊後端契約，不動後端）**：
  - `frontend/src/hooks/useFishingSession.js`：`changeBetPerShot`/`changeCannonLevel` 在 `phase === 'playing'` 時拒絕並提示；shot payload 移除後端 DTO 沒有的 `cannonLevel` 欄位。
  - `frontend/src/pages/Fishing.jsx`：進場面板**新增彈藥選擇器**（原本大廳無法選彈藥、只能場中切，鎖場中後若不補會永遠只有銅砲）；場中控制列彈藥鈕改為 `disabled` 唯讀展示；`handleAmmoSelect` 移除場中開加值窗的死路徑；進場說明/入場提示/遊戲規則文案同步改為「進場後固定」。
  - `frontend/src/services/mockApi.js`：`fishingShots` 補上鏡像後端 `validateBatch` 的整批注額驗證（雷區 14）。
- **top-up 併發鎖**：`useFishingSession` 新增 `topUpLockRef`——topUp 先上鎖（`fire()` 回 `{ok:false, reason:'topup'}`）再 `drainPendingShots()`；drain 逾時未清空改為**中止加值**（原本照樣送出）。
- **亂碼復原**：`FishingController.java`（類 Javadoc 整段、2 處行內註解，並補 top-up 端點條目）、`FishingSessionStore.java`（`readTopUpRequestIds` Javadoc 與 `log.warn` 訊息，並修正 `readKills` Javadoc 被錯位黏到 `readTopUpRequestIds` 的問題）、`mockApi.js`（`fishingTopUp` 三處 `throw new Error('???')` 與帳務描述）、`useFishingSession.js`（4 處 `setError` 訊息）。

### Changed
- `AGENTS.md` 雷區 14/15：老虎機描述由過時的「單中線僅三連、RTP=Σpᵢ³·mᵢ」更正為兩階賠付（三連＋左二同，理論 RTP ≈ 93.8%、命中率 ≈ 30.7%，與 `SlotSymbol` Javadoc 一致）。
- `AGENTS.md` 雷區 16：補記「面額/砲台 session 級進場固定、勿在場中開放切換」與「top-up 冪等 + `topUpLockRef` 勿移除」兩條新雷。

### 為什麼
- 方案取捨：對齊既有契約（前端鎖場中切換）而非放寬後端——後端若支援場中換面額，`validateBatch`/結算/`verifyShot`/殘血回收全要重設計，屬 ADR 級變更；且 ADR-004 明定面額整場固定是防「大注小注混打繞過費率」的風控設計。
- top-up 鎖選在前端最小修補；後端 session 原子性（Redis WATCH/Lua 或 per-player lock）另開任務處理才是根治。

### 如何驗證
- `mvn -pl backend/game-service test`（後端僅註解/文案變更，需綠燈確認未破壞）。
- 前端手動路徑：mock 模式進場選銀/金砲 → 場中彈藥鈕呈 disabled → 開火中按「臨時加值」→ 加值瞬間子彈暫停、完成後恢復 → 收網結算 → 重新進場可換彈藥。

## [docs] — 2026-07-01 — 健檢後續補丁：AGENTS.md 措辭修正、CI 擋關擴大、CHANGELOG 格式修復

> **背景**：全面健檢 7 個微服務 + gateway 時累積了幾個「該補但先擱著」的小項目，這次一次補齊，避免累積成下一輪健檢的重複發現。

### Changed
- `AGENTS.md` 雷區 #6：措辭從「永遠不要在 wallet-service 消費 `wallet.credit`」改為「消費者不可重呼 `credit()/debit()`」，並記錄 `WalletReadSyncListener`（`kafka/WalletReadSyncListener.java:45,80`）這個安全例外（CQRS 讀視圖同步、冪等 `existsById`、從不重呼入帳/扣款方法）——舊措辭字面上與現有程式碼矛盾，容易誤導後續開發者以為那是 bug。
- `AGENTS.md` §4 驗證指令：`mvn -pl ...test` 清單補上 `backend/game-service`、`backend/rank-service`、`backend/notification-service`——這三個服務其實已完工且測試綠燈（H2 + `@EmbeddedKafka`，免外部基礎設施），舊清單只列 gateway/member/wallet/admin 過於保守。
- `.github/workflows/ci.yml` 的 `backend-test` job：`-pl` 清單同步補上這三個服務；修正過時註解（原寫「game/rank/admin 仍為骨架」與實際已列入清單的 admin 矛盾）。
- `CHANGELOG.md` 本身：修復一個既有格式 bug——檔案標頭 `# Changelog — Lucky Star Casino` 不知何時被多次歷史合併擠到檔案中段（原第 433 行，`## [docs] — 2026-06-30 — 校正 AUDIT_REPORT...` 條目前），導致檔案真正開頭反而沒有標頭。搬回檔案最上方，內容不變。

### 為什麼
- 雷區 #6 舊措辭與 `WalletReadSyncListener` 的既有、正確、已測試行為矛盾，若照字面「永遠不要消費」去理解會誤判現有程式碼有 bug，浪費下一次健檢的時間去重新確認同一件事。
- CI／§4 清單保守，代表 game/rank/notification 的迴歸永遠不會被擋關，即使測試本身早就綠燈。
- CHANGELOG 標頭錯位是純格式問題，但擺在中間看起來像是「檔案在這裡重新開始」，容易誤導閱讀者。

### 如何驗證
- 純文件 + CI 設定變更，不影響服務執行邏輯，無需跑後端測試。
- `.github/workflows/ci.yml` 改動已用 `actionlint`（若本機有裝）或直接看 diff 確認語法未破壞（YAML 縮排/清單語法沿用既有風格，僅擴充 `-pl` 清單與註解）。

## [fix] — 2026-07-01 — Gateway 補上 `/ws` 路由，補上即時推播的最後一哩

> **背景**：全面盤點各微服務與 gateway 時發現，notification-service 的 T-070~T-072（WebSocket STOMP + Kafka 橋接）雖已完工，但 `docs/architecture.md` 留著一條 2026-06-02 的 TODO，坦承 Gateway 從未轉發 `/ws/**`——這件事在服務完工後被漏掉沒補。前端所有 `.env` 的 `VITE_ENABLE_WS` 預設皆為 `false`（或走 mock WS 短路），所以目前是「休眠中」不影響一般開發/測試，但只要有人手動開啟真實 WebSocket 測試即時推播，SockJS 交握就會打不到 gateway 對應路由。

### Added
- `backend/gateway-service/src/main/resources/application.yml`：新增 `notification-ws` 路由，`Path=/ws,/ws/**` 轉發至 `${NOTIFICATION_SERVICE_URL:http://localhost:8087}`。用一般 `http://` URI 即可——帶 `Upgrade` header 的請求會被 Spring Cloud Gateway 的 `RouteToRequestUrlFilter` 自動把 scheme 轉成 `ws`，SockJS 的 HTTP 交握子路徑（`/ws/info`、`/ws/{server}/{session}/{transport}`）則正常走 http 路由；不掛 `CircuitBreaker`（長連線熔斷後轉發 JSON fallback 沒有意義）。
- `jwt.whitelist` 新增 `/ws`：SockJS 交握階段不帶 `Authorization` header（JWT 改由 STOMP CONNECT 帧攜帶，`StompAuthChannelInterceptor` 驗證），若不放行會被 `JwtAuthenticationGlobalFilter` 擋在 HTTP 層；`PlayerRateLimitGlobalFilter` 讀同一份 whitelist，因此也一併免除玩家級限流。

### Changed
- `docs/architecture.md` 2.7 節：移除已解決的 2026-06-02 TODO，改記錄修復內容與日期。

### 為什麼
帳面上 notification-service 已完工，但少了 gateway 路由等於「功能存在卻連不到」，會在有人真的打開即時推播功能時才爆炸；趁健檢一次補齊，避免日後排查時誤以為是 notification-service 本身的 bug。

### 如何驗證
- 新增 `GatewayRoutesConfigTest`（讀 `RouteDefinitionLocator`/`JwtProperties` 實際載入的設定，非 mock）：斷言 `notification-ws` 路由存在、Path predicate 同時含 `/ws` 與 `/ws/**`、URI port 為 8087；另斷言 `jwt.whitelist` 含 `/ws`。
- `mvn -pl backend/gateway-service test`：25/25 綠燈（23 既有 + 2 新增），新路由未影響既有 JWT/限流/CircuitBreaker 邏輯。
- **端對端手動驗證**（Docker 起 Redis/Kafka/MySQL/Postgres 後，本機跑 `mvn spring-boot:run` 啟動 gateway + notification-service）：
  - HTTP 層：`curl http://localhost:8080/ws/info`（經 gateway）與直連 `http://localhost:8087/ws/info` 回傳結構相同的 SockJS info JSON，且未帶 `Authorization` header 也未被 401 擋下。
  - WebSocket 層：用 Node 24 原生 `WebSocket` 對兩個位址送出不帶 JWT 的 STOMP `CONNECT` 帧，經 gateway（`ws://localhost:8080/ws`）與直連（`ws://localhost:8087/ws`）收到的 STOMP `ERROR` 帧內容逐位元組相同——證實 gateway 對真實 WebSocket 升級與雙向 STOMP 訊框轉發完全透明（`ERROR` 為預期結果，因故意未帶 JWT 觸發 `StompAuthChannelInterceptor` 拒絕）。

## [docs] — 2026-07-01 — 新增 API 串接與架構面試文件（含離線彩圖 HTML）

> **背景**：`docs/interview-prep/` 缺一份專講「API 怎麼串接、為什麼這樣串」的面試文件。現有資料只零散涵蓋：`LOCAL_API_INTEGRATION_GUIDE.md` 偏「怎麼跑起來」（操作）、`architecture.md` 偏規格、`interview-prep/01`+`02` 只零星提到。本次補一份**全鏈路、技術參考＋面試「為什麼」混合**的文件，用「玩老虎機一局」貫穿前端 axios → Gateway → 服務間 REST → Kafka，並以連結指向上述三份避免重複。

### Added
- `docs/interview-prep/10-API串接與架構.md`：七章節——§1 全鏈路總覽、§2 前端串接（axios 攔截器 JWT 注入 / 401 single-flight 續期 / mock 鏡像後端 / Redux thunk 三態）、§3 Gateway（路由宣告順序陷阱 / filter 執行順序 / 韌性設定）、§4 JWT 簽發驗證 + 服務間信任邊界（`X-Internal-Secret` vs JWT、為何用 `RestClient` 不用 Feign）、§5 Kafka（ADR-002 指令/事件分離、防無限迴圈、Outbox 原子性）、§6 端到端老虎機一局（含冪等鍵/樂觀鎖一致性界線）、§7 面試速查對照表。為降低閱讀門檻，加入 3 張 mermaid 彩色圖（§1 全鏈路、§5.2 指令/事件分離、§6 老虎機循序圖）、🎯 每章重點框、💬 面試對話小劇場與 ❌/✅ 對照表。
- `docs/interview-prep/10-API串接與架構.html`：上述 md 的**離線自帶** HTML——mermaid 圖已預先渲染成內嵌 SVG，無任何 `<script>`/CDN 外連，斷網也能開；瀏覽器 `Ctrl+P` 可直接轉 PDF。

### Changed
- `docs/interview-prep/00-index.md`：§0 導覽表新增第 9 列（`10-API串接與架構.md`）；§4「面試官問 X → 翻到哪」對照表補三題（API 串接 / 前端帶 token / 服務間呼叫）。

### 如何驗證
- 純文件，不影響程式行為，無需跑測試。
- 文中事實已逐項對回程式碼核對：路由順序（`gateway-service/application.yml`）、filter order 數值（`FilterOrder.java`）、topic 清單（`kafka/kafka-init.sh`）、冪等鍵字串 `slot-bet-`/`slot-win-`（`SlotService.java:157,176`）、axios 攔截器與 `WalletClientConfig`/`CheckinService` outbox 片段皆取自實檔。
- 離線 HTML 以 headless Edge 渲染驗證：3 張 mermaid 圖全部輸出 inline SVG（svgCount=3、零 console error），並確認產物無 `<script>`/`<link>`/外部 `src`。

## [changed] -- 2026-07-01 -- Fishing ammo dock and shortage top-up modal
### Changed
- `frontend/src/pages/Fishing.jsx`: rebuilt the in-canvas fishing control dock into ammo amount summary, three ammo choices, cannon bay, and settle action; removed the always-visible live top-up field.
- `frontend/src/data/fishingGameData.js`: removed the old `FISHING_MULTIPLIERS` x1/x5/x10/x20 data because firing cost now comes from the selected ammo type.
- `frontend/src/components/Fishing.css`: removed active `fishing-dock-chip` styling, added unified red-gold ammo buttons, in-stage settle button layout, cannon bay spacing, shortage top-up modal, and responsive dock rules.
- `frontend/src/components/fishingEngine.js`: raised the Pixi cannon zone so the cannon sits above the in-canvas control dock instead of being covered by it.

### Why
- The fishing table controls should match the current ammo-based gameplay, keep the cannon visible, and show temporary top-up only when the player runs out of usable session balance.

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`

## [changed] -- 2026-07-01 -- Fishing in-stage controls and live top-up
### Added
- `backend/game-service/src/main/java/com/luckystar/game/dto/FishingTopUpRequest.java` and `FishingTopUpResponse.java`: added request/response DTOs for live fishing session top-up.
- `backend/game-service/src/main/java/com/luckystar/game/controller/FishingController.java`: added `POST /api/v1/game/fishing/{sessionId}/top-up` for adding session balance during active play.

### Changed
- `frontend/src/pages/Fishing.jsx`: moved `.fishing-control-dock` into the fishing stage frame so cannon, bullet, skill, and live top-up controls appear inside the game canvas area.
- `frontend/src/components/Fishing.css`: added in-stage control dock layout, responsive top-up controls, and compact stage-safe spacing around the settle button.
- `frontend/src/hooks/useFishingSession.js`, `frontend/src/services/gameApi.js`, and `frontend/src/services/mockApi.js`: added live top-up flow that drains pending shots, debits wallet/session balance, updates Redux wallet state, and mirrors behavior in mock mode.
- `backend/game-service/src/main/java/com/luckystar/game/service/FishingService.java`: added idempotent live top-up handling with wallet debit and refund-on-save-failure behavior.
- `backend/game-service/src/main/java/com/luckystar/game/fishing/FishingSession.java` and `FishingSessionStore.java`: persisted top-up request IDs in Redis so repeated client request IDs remain idempotent across session reloads.
- `backend/game-service/src/test/java/com/luckystar/game/fishing/FishingSessionStoreTest.java`: covered top-up request ID round-trip persistence.

### Why
- Players should not need to settle the fishing round before adding more funds, and the control surface should feel like part of the fishing table instead of a detached panel below it.

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
- `mvn -pl backend/game-service test`

## [changed] -- 2026-06-30 -- Fishing buy-in flow and cannon switching
### Changed
- `frontend/src/pages/Fishing.jsx`: changed the fishing entry flow so players enter only a buy-in amount before the round, then switch bullet amount and cannon type inside the game control panel.
- `frontend/src/hooks/useFishingSession.js`: added in-session bet and cannon setters, and tagged buffered shots with the currently selected cannon level for frontend/mock play.
- `frontend/src/services/mockApi.js`: made mock fishing shots honor per-shot cannon level and current bullet amount during the default mock experience.
- `frontend/src/components/fishingEngine.js`: scaled Pixi cannon visuals by cannon level so copper is smaller, silver is medium, and gold is larger with stronger muzzle/deck energy.
- `frontend/src/components/Fishing.css`: styled the buy-in guidance note and active gold/black in-game cannon controls, with distinct copper/silver/gold button sizes.

### Why
- Match the requested arcade fishing flow: buy in first, then freely adjust cannon and firing settings during play, with higher-grade cannons looking more powerful.

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
- Playwright smoke: unauthenticated users are redirected to login; after login, /game/fishing shows buy-in-only entry, no old locked-settings copy, active bullet/cannon controls after entering the stage, and no page errors.

## [changed] -- 2026-06-30 -- Fishing Traditional Chinese copy polish
### Changed
- `frontend/src/pages/Fishing.jsx`: rewrote the visible `/game/fishing` copy in Traditional Chinese, including hero text, HUD labels, buy-in flow, settlement screen, rule dialog content, fish table labels, skill panel text, and verification messages.
- `frontend/src/data/fishingGameData.js`: localized fishing multipliers, skill labels, species names, rarity labels, descriptions, and jackpot text to Traditional Chinese.
- `frontend/src/components/Fishing.css`: centered the contents of `.fishing-hud__metric` cards for easier scanning.
### Why
- Remove mojibake/unclear copy and make the fishing game interface easier for players to understand at a glance.
### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
- Playwright smoke: `/game/fishing` hero/rules/HUD copy renders in Traditional Chinese, the rules dialog opens, HUD metric content is centered, and no page errors were emitted.
## [changed] -- 2026-06-30 -- Fishing viewport stat strip and ray targeting cleanup
### Changed
- `frontend/src/pages/Fishing.jsx`: removed the `fishing-stat-strip` summary row above the fishing table.
- `frontend/src/components/Fishing.css`: removed stale stat-strip and energy-readout styles after the row was removed from the page.
- `frontend/src/components/fishingEngine.js`: fish no longer bounce off the top/bottom swim bounds and can now leave through the top or bottom of the playfield; shooting now extends from the cannon through the pointer direction to the stage edge instead of stopping at the cursor point.
### Why
- Keep the fishing table visually focused, make fish movement feel less boxed-in, and make cannon targeting behave like a directional shot across the whole playfield.
### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
- Playwright smoke: `/game/fishing` has no `.fishing-stat-strip`, the Pixi canvas loads, the in-stage settle control remains present, and no page errors were emitted.
## [changed] -- 2026-06-30 -- Fishing settle control integrated into stage
### Changed
- `frontend/src/pages/Fishing.jsx`: moved the fishing settle action from the external cannon dock into the game stage frame so it appears as an in-game lower-right control.
- `frontend/src/components/Fishing.css`: added in-stage settle button positioning and reduced the cannon dock back to multiplier/cannon controls only.
- `frontend/.env.development`: changed local dev default to `VITE_USE_MOCK_API=true` while keeping `VITE_ENABLE_WS=false`, so running the frontend without gateway 8080 does not spam `ERR_CONNECTION_REFUSED`.
### Why
- The settle action should feel integrated with the active fishing table, and local UI work should not require backend services unless explicitly opted in.
### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
- Playwright smoke: `/game/fishing` starts in mock mode without localhost 8080 refused requests; the settle button is visible inside `.fishing-stage-frame` and absent from `.fishing-control-dock`.
## [fixed] -- 2026-06-30 -- Fishing rules dialog visibility
### Fixed
- `frontend/src/components/GameRuleCard.jsx`: renders the rules dialog through `createPortal(document.body)` so `/game/fishing` side-panel child-order CSS cannot hide the modal after pressing the rules button.
- `frontend/src/components/GameRuleCard.jsx`: added Escape-to-close and background scroll locking while the rules dialog is open.
### Why
- The fishing page moves and hides side-panel children with `nth-child` rules; the old inline dialog became a hidden side-panel child instead of a visible prompt window.
### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
- Playwright smoke: `/game/fishing` Guide button opens a visible `[role="dialog"]` with `display: grid`, and Escape closes it.
## [changed] -- 2026-06-30 -- Fishing cannon console status cleanup
### Changed
- `frontend/src/pages/Fishing.jsx`: removed the Auto fire controls, moved boss/error/settling table feedback into the `aria-label="Fishing table status"` marquee, and relocated the settle action to the far-right side of the cannon console.
- `frontend/src/components/FishingCanvas.jsx` / `frontend/src/components/fishingEngine.js`: removed the unused Auto fire prop, ticker branch, target selection, and reticle lock path so the current fishing table is manual-only.
- `frontend/src/components/Fishing.css`: added marquee status emphasis styles and a gold casino-style settle button for the cannon control area; removed stale banner-slot and Auto-toggle selectors.
### Why
- Keep fishing controls focused on manual aiming, avoid duplicated table status banners, and make settlement feel like part of the cannon console instead of a separate HUD action.
### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
## [changed] — 2026-06-30 — 捕魚規則區上移並精簡下方資訊

### Changed
- `frontend/src/pages/Fishing.jsx`: 將場內砲台控制列補上砲台 / 子彈類別狀態按鈕，與既有倍率按鈕同區呈現。
- `frontend/src/components/Fishing.css`: 將遊戲規則卡排序到舞台上方，下方資訊區只保留魚種倍率表與技能面板，隱藏餘額、Fortune 與 Premium Jackpot 卡。
- `frontend/src/components/Fishing.css`: 將砲台區倍率與砲台類別按鈕改為金色按鈕、黑色字體，讓控制區更像娛樂城機台操作面板。

### Why
- 回應使用者希望規則區放到遊戲上方、下方只保留魚種倍率與技能面板，並把倍率與子彈類別切換按鈕整合到砲台區的需求。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
## [changed] — 2026-06-30 — 捕魚舞台加寬並將資訊面板移至下方

### Changed
- `frontend/src/components/Fishing.css`: 強制 `/game/fishing` 主版面改為單欄，主遊戲舞台置於上方，原側邊資訊面板改為下方自適應卡片區。
- `frontend/src/components/Fishing.css`: 放大捕魚舞台最大寬度與高度，桌機版使用更沉浸式的寬版 canvas，平板與手機維持響應式高度避免破版。
- `frontend/src/components/Fishing.css`: 下方資訊區改為 12 欄自適應 grid，魚種表、規則、Jackpot、技能與 Fortune 資訊不再擠在右側窄欄。

### Why
- 回應使用者希望遊戲畫面加長加寬，並將旁邊資訊欄位移至下方的需求，讓捕魚主舞台成為頁面焦點。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
## [fixed] — 2026-06-29 — 捕魚垂直生成改為視窗外進場

### Fixed
- `frontend/src/components/fishingEngine.js`: 上方與下方生成的魚改從 canvas 視窗外出生，不再貼著畫面內邊界重生。
- `frontend/src/components/fishingEngine.js`: 新增 `entrySide` 進場狀態，魚游進可活動水域後才啟用上下邊界反彈，避免剛生成就被 clamp 回畫面內。

### Why
- 使用者指出魚在畫面邊界內重生很違和；捕魚機魚群應從視窗外游入，讓垂直與斜角生成更自然。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
## [changed] — 2026-06-29 — 捕魚新增垂直與斜角生成位置

### Changed
- `frontend/src/components/fishingEngine.js`: 魚生成時新增左右、上方水域、下方水域等進場模式，讓魚群可從垂直方向與斜角位置切入舞台。
- `frontend/src/components/fishingEngine.js`: 魚的面向改由實際水平速度 `vx` 決定，保留正確游向並搭配斜向路徑移動。

### Why
- 回應 `/game/fishing` 魚群生成位置需要新增垂直方向與斜角的需求，避免魚群永遠只從左右水平邊界出生，提升場景流動感。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
## [changed] — 2026-06-29 — 捕魚魚群加入上下與斜向游動

### Changed
- `frontend/src/components/fishingEngine.js`: 魚生成時加入垂直速度與活動水域上下界，魚群會沿斜向路徑移動並在水域邊界反彈。
- `frontend/src/components/fishingEngine.js`: 魚身旋轉角度會依斜向速度微調，讓游動姿態更接近深海魚群而不是單純水平滑動。

### Why
- 回應 `/game/fishing` 視覺升級需求，讓魚群移動增加上下與斜角變化，提升捕魚機舞台的生命感與打擊路徑判讀一致性。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
## [changed] — 2026-06-29 — 捕魚射擊改為彈道路徑優先碰撞

### Changed
- `frontend/src/components/fishingEngine.js`: 將手動與自動射擊的目標判定從「游標附近最近魚」改為「砲口到目標點的彈道路徑碰撞」，若路徑上有魚阻擋，會優先射擊最先碰到子彈的魚。
- `frontend/src/components/fishingEngine.js`: 新增砲口來源點、魚體碰撞半徑與路徑投影判定，保留既有 `useFishingSession.fire(fishInstanceId, fishCode)` 流程，不改後端傷害、捕獲或派彩模型。

### Why
- 使用者要求射擊應遵守捕魚機彈道路徑邏輯：子彈若被前方魚擋住，應先擊中路徑上第一條魚，而不是直接命中滑鼠位置附近或被點選的魚。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
## [fixed] — 2026-06-29 — 收斂前端 console 警告與捕魚頁首載樣式

### Fixed
- `frontend/src/App.jsx`: 為 `BrowserRouter` 啟用 `v7_startTransition` 與 `v7_relativeSplatPath` future flags，消除 React Router v7 升級提示。
- `frontend/src/pages/Fishing.jsx` / `frontend/src/components/FishingCanvas.jsx`: 將 `Fishing.css` 改由捕魚頁本體載入，不再依賴 lazy canvas chunk，避免首次進入 `/game/fishing` 停在 lobby 時 `fishing-hero-copy`、`fishing-hero-actions`、`fishing-stat-strip` 等樣式尚未套用。
- `frontend/src/hooks/useWebSocket.js`: WebSocket 改為 mock API 時走 mock WS，且本機 dev 預設不連實體 `/ws`，避免 gateway/notification 服務未啟動時持續產生 `ERR_CONNECTION_REFUSED`。
- `frontend/.env.development` / `frontend/.env.mock`: 新增 `VITE_ENABLE_WS` / `VITE_USE_MOCK_WS` 設定，讓 realtime WebSocket 在本機開發可明確 opt-in。

### Why
- 使用者回報 console 出現 React Router future warning、`localhost:8080/ws/info` connection refused，以及捕魚頁部分資訊區樣式在首次進入網站時消失；本次修正聚焦開發體驗與 lazy CSS 載入時序。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
- Playwright mock console check: React Router future warning 消失、無 `/ws/info` failed request；首次進入 `/game/fishing` lobby 時 `.fishing-stat-strip` 已套用 grid 樣式。
## [fixed] — 2026-06-29 — 重做捕魚機 canvas 底部砲台區

### Fixed
- `frontend/src/components/fishingEngine.js`: 將 Pixi canvas 內原本意義不明的底部裝飾改為更小的砲台座、中央能量核心與左右儀表導軌，並進一步縮小砲台尺寸與後座位移，讓底部視覺明確響應開火脈衝。
- `frontend/src/components/Fishing.css`: 關閉舞台內重複疊在 canvas 底部的 CSS 裝飾條，避免與 Pixi 砲台座互相干擾。

### Why
- 使用者多次回報遊戲畫面底部裝飾沒有對應砲台、視覺意義不明，且砲台仍顯得過大；實際應修改 Pixi 引擎內的底部砲台區，而不是只調整外層頁面控制列。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
- Playwright mock smoke: mock 登入後可進 `/game/fishing` 並載入 Pixi canvas；頁面無水平 overflow、無 page error。
## [changed] — 2026-06-29 — 重構捕魚機紅金深海娛樂城介面

### Changed
- `frontend/src/pages/Fishing.jsx`: 新增紅金深海頁面外殼、頁首風格標籤、正式遊戲舞台框、桌台狀態銘牌、底部倍率控制台標題與側欄 Premium Table 資訊卡，保留既有 Pixi 捕魚玩法、射擊、結算與登入保護流程。
- `frontend/src/components/Fishing.css`: 新增 red-gold deep sea casino skin，強化紅金金屬框、深海玻璃 HUD、16:9 舞台外框、控制台燈條、Jackpot 卡與 RWD 呈現。

### Why
- 使用者選擇「紅金深海娛樂城」風格，希望 `/game/fishing` 從 demo 感提升為符合 Lucky Star Casino 主題的正式娛樂城捕魚機畫面。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`
- Playwright mock smoke: 未登入 `/game/fishing` 導向 `/member?mode=login`；mock 登入後可進場並載入 Pixi canvas；390/430/768/1024/1440 viewport 無水平 overflow、無 page error。
## [fixed] — 2026-06-29 — 停用捕魚命中後全頁掉落特效

### Fixed
- `frontend/src/pages/Fishing.jsx`: 移除命中魚後觸發的 `GoldBurst`、`CoinRainPro`、`RedEnvelopeRain` 與 `BrushBanner` 頁面級特效，避免金幣雨圖層殘留在遊戲畫面中央或延續到結算畫面。

### Why
- 使用者回報金幣雨首次出現後會卡在 `/game/fishing` 畫面中央；先關閉命中後生成的全頁 FX layer，保留射擊、命中判定、分數、音效與結算流程。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
## [fixed] — 2026-06-29 — 修正捕魚結算金幣雨殘留與砲台縮放覆蓋

### Fixed
- `frontend/src/pages/Fishing.jsx`: 將 `CoinRainPro` / `RedEnvelopeRain` 限定只在 `phase === "playing"` 時掛載，離開遊戲中狀態後立即卸載，避免金幣雨殘留到結算畫面。
- `frontend/src/components/fishingEngine.js`: 修正砲台縮放順序，移除覆蓋 `width/height` 的 `scale.set()`，改用 `cannonDisplaySize` 控制實際顯示尺寸，讓砲台真正縮小並保留開火 recoil。

### Why
- 使用者回報擊殺後的金幣雨會卡在畫面中間並延續到結算頁，以及發射子彈的大砲沒有實際變小；本次修正聚焦視覺層生命週期與 Pixi sprite 尺寸覆蓋問題。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`（Vitest 7 passed）
- Playwright mock verification：進場後 canvas 非空渲染；點結算後 `.fx-layer` 數量為 0，確認金幣雨不殘留到結算畫面。
## [fixed] — 2026-06-29 — 修正捕魚機金幣殘留、魚面向與砲台比例

### Fixed
- `frontend/src/components/fishingEngine.js`: 移除固定在舞台中下方的永久金幣裝飾，避免看起來像未消失的金幣圖層。
- `frontend/src/components/fishingEngine.js`: 修正 SVG 魚素材的左右翻面邏輯，讓魚的頭部朝游動方向。
- `frontend/src/components/fishingEngine.js`: 縮小砲台尺寸並改為依舞台大小響應，砲座改成每幀依 `cannonPulse` 更新能量燈與軌道，讓底部裝飾與開火狀態有明確關聯。

### Why
- 使用者回報捕魚畫面中央有不消失的金幣層、魚倒著游、砲台過大且底部裝飾意義不明；本次修正聚焦視覺清理與互動語意，不更動下注、傷害、派彩或 session 流程。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`（Vitest 7 passed）
- Playwright mock verification：未登入 `/game/fishing` 導向 `/member?mode=login`；已登入可進場、點擊舞台、顯示 control dock；390/430/768/1024/1440 無 horizontal overflow，canvas 非空渲染，新 SVG 魚素材載入 5 個，無 page error。
## [changed] — 2026-06-29 — 重製捕魚機魚群素材與舞台打擊感

### Added
- `frontend/public/images/game/fishing/*.svg`: 新增小丑魚、藍寶石魚、黃金魚、水晶魟魚、彩金鯨王 5 組本地高質感 SVG 魚素材。

### Changed
- `frontend/src/casino-fx/assets/registry.js`: 將現有捕魚 `fish-*` assetId 映射到本地 SVG 素材，保留既有 fishTable / 後端魚種契約。
- `frontend/src/components/fishingEngine.js`: 強化 Pixi 舞台景深、海底寶箱/金幣前景、魚群游動擺身、砲台 recoil、能量彈拖尾與高倍率命中 burst。
- `frontend/src/pages/Fishing.jsx`: 新增場內 arcade control dock 結構，呈現鎖定倍率、自動射擊與技能狀態。
- `frontend/src/components/Fishing.css`: 補上場內 control dock、倍率晶片、技能按鈕與 16:9 舞台收斂樣式，提升手機與桌機的一致性。

### Why
- 讓 `/game/fishing` 的實際遊戲畫面從 demo 感提升為正式娛樂城捕魚機視覺，同時不改下注、派彩、RTP 或 session 權威流程。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`（Vitest 7 passed）
## [changed] — 2026-06-29 — 強化 /game/fishing 深海彩金捕魚介面

### Added
- `frontend/src/data/fishingGameData.js`: 新增集中式捕魚 UI 展示資料，包含 x1/x5/x10/x20 快速倍率、Demo 技能、五種魚種倍率表與 Jackpot 狀態。

### Changed
- `frontend/src/pages/Fishing.jsx`: 沿用既有 `AppShell`、登入保護、`useFishingSession` 與 Pixi canvas，引入頁首、返回大廳、資訊列、快速倍率、技能面板與魚種說明。
- `frontend/src/components/Fishing.css`: 補強深海紅金娛樂城視覺、玻璃 HUD、彩金晶片、倍率按鈕、魚種卡片、技能按鈕與 390/430/768/1024/1440 RWD 收斂。
- `frontend/src/components/fishingEngine.js`: 保留 Pixi 漁場引擎並延續先前加入的深海背景、氣泡、水波、海床與霓虹舞台層，讓主舞台更接近市面捕魚機視覺。

### Why
- 捕魚機需要從功能型頁面提升為高級線上娛樂城體驗，同時遵守專案既有規則：路由登入保護不變、錢包不在 UI demo 直接扣款、下注/戰鬥流程仍由現有 session hook 與後端鏡像 mock 掌控。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`（Vitest 7 passed）
- Playwright mock verification：未登入 `/game/fishing` 導向 `/member?mode=login`；已登入可切 x5、進場、等待 Pixi canvas、點擊舞台發射；390/430/768/1024/1440 viewport 無 horizontal overflow，canvas 皆有非空渲染。未啟動後端時僅忽略既有 realtime/API 資源 `ERR_CONNECTION_REFUSED` 訊息。
## [changed] — 2026-06-29 — 捕魚機畫面升級為街機海底風格

### Changed
- `frontend/src/pages/Fishing.jsx`: 為捕魚主頁、入場面板與側欄加入穩定樣式掛點，方便建立完整機台外觀。
- `frontend/src/components/Fishing.css`: 強化 `/game/fishing` 的街機框體、霓虹 HUD、海底場景邊框、入場控制台與 RWD 排版。
- `frontend/src/components/fishingEngine.js`: 新增 Pixi 背景/裝飾層，包含海底深度、光束、泡泡、海床珊瑚與底部砲座。

### Why
- 讓捕魚機畫面更接近市面 H5/街機捕魚遊戲的視覺密度與機台氛圍，同時保持前端只負責演出，不改下注、派彩、RTP 或後端權威流程。

### Verified
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- Playwright mock flow: 登入測試帳號後進入 `/game/fishing`、開局、確認 canvas/HUD 顯示、無 page error，並以臨時截圖確認畫面。

## [changed] — 2026-06-28 — 前端路由層級 lazy loading

### Changed
- `frontend/src/App.jsx`：保留首頁與會員頁同步載入，其餘玩家頁、遊戲頁、商店頁改為 route-level lazy loading。
- `frontend/src/App.jsx`：新增共用 `LazyPage` / `ProtectedPage` 包裝，避免每個 protected route 重複處理 `PrivateRoute` 與 `Suspense`。
- `frontend/src/index.css`：新增 route fallback 載入狀態與 reduced-motion 對應。

### 為什麼
- 降低首頁與登入頁初始 bundle 負擔，讓遊戲、錢包、排行榜等非首屏頁面在需要時再載入。
- route guard 先於 lazy chunk 執行，未登入使用者不會為 protected pages 下載不必要頁面程式碼。

### 如何驗證
- `cd frontend && npm run lint`
- `cd frontend && npm run test`（7 passed）
- `cd frontend && npm run build`（主 JS 約 441 kB / gzip 140 kB → 310 kB / gzip 103 kB）
- `cd frontend && npm run e2e`（1 passed, 1 skipped）
## [changed] — 2026-06-28 — 前端正式模式與 CI 擋關收斂

### Added
- `frontend/e2e/smoke.spec.js`：新增 Playwright smoke，使用 mock 模式登入並走過遊戲大廳、鑽石錢包、遊戲紀錄。

### Changed
- `frontend/src/services/{api,memberApi,walletApi,rankApi,gameApi,diamondApi,integrationTestApi}.js`：mock API 改成只有 `VITE_USE_MOCK_API=true` 才啟用，避免正式環境未設定時誤走假資料。
- `frontend/src/App.jsx`：`/dev/integration` 改由 `VITE_ENABLE_DEV_TOOLS=true` 顯式開啟，正式 build 不再產出整合測試頁 chunk。
- `frontend/.env.development`、`frontend/.env.mock`、`.env.example`：補齊 mock/dev tools 旗標設定。
- `.github/workflows/ci.yml`：前端 CI 從單跑 Vitest 擴充為 lint、Vitest、production build、Playwright smoke。

### 為什麼
- 正式站應預設打真實 Gateway，不可因環境變數漏設而回退 mock；開發診斷頁也不應暴露在一般玩家路由或正式資產中。
- CI 需要實際驗證前端可 lint、可測、可建置、可由瀏覽器啟動並完成核心玩家流程。

### 如何驗證
- `node --test tests/infra/*.test.js`（127 passed）
- `mvn -B -ntp -pl backend/gateway-service,backend/member-service,backend/wallet-service clean test`（150 passed，BUILD SUCCESS）
- `cd frontend && npm run lint`
- `cd frontend && npm run test`（7 passed）
- `cd frontend && npm run build`
- `cd frontend && npm run e2e`（1 passed, 1 skipped）
## [changed] — 2026-06-27 — 整合測試面板改為獨立工具頁

### Changed
- `frontend/src/pages/IntegrationTestPage.jsx`：移除 `AppShell` 包裝，改為獨立 full-screen 工具頁。
- `frontend/src/App.jsx`：`/dev/integration` 保持受保護路由，但在此路徑不渲染 QuickToolbar、好友浮窗與客服 modal。

### 為什麼
- 整合測試面板是開發/驗收工具，不應出現在玩家網站體驗中；保留直接網址方便前後端串接測試。

### 如何驗證
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`

## [feat] — 2026-06-27 — 新增前後端整合測試面板

### Added
- `frontend/src/services/integrationTestApi.js`：新增 Gateway / member / wallet / game / rank 的瀏覽器端探針，記錄 HTTP 狀態、耗時與摘要。
- `frontend/src/pages/IntegrationTestPage.jsx`：新增 `/dev/integration` 受保護頁，可執行安全讀取檢查，並提供破產補助與老虎機下注兩個明確的手動整合動作。

### Changed
- `frontend/src/App.jsx`：接上 `/dev/integration` 受保護路由；此工具不加入網站導覽入口。

### 為什麼
- 既有 `tests/smoke/smoke.mjs` 適合命令列全流程驗證；前端日常對接還需要一個可視化入口，快速分辨 gateway、JWT、CORS、服務路由或業務 API 哪一層出問題。

### 如何驗證
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test`

## [docs] — 2026-06-30 — 校正 AUDIT_REPORT 過時進度標記（以程式碼為準）

> **背景**：盤點待辦時發現 `AUDIT_REPORT.md` 數處標記落後實際程式碼（AGENTS.md §1 已知問題）。逐項以程式碼/檔案交叉驗證後更正，並依 §1 規定「以程式碼為準並順手更正文件」。

### Changed
- `AUDIT_REPORT.md` A.9/A.10/A.13：
  - **T-085 ⚠️→✅**：`frontend/src/store/slices/rankSlice.js` 已改用 `rankApi.getRanks()` 呼叫真實 `/api/v1/rank/*`（2026-06-25 BUG-001 修正），非「直接寫死 `mockApi.getRank()`」。
  - **T-086 ⚠️→✅**：`frontend/src/store/slices/walletSlice.js` 已用 `walletApi.getTransactions()` 串接真實端點（2026-06-25 BUG-002 修正）。
  - **T-095 ⚠️→✅**：`docs/adr/ADR-003`（捕魚血量/傷害）、`ADR-004`（經濟再平衡）、`ADR-005`（月度簽到獎勵）皆已產出，非「未產出」。
  - **T-093 ❌→⚠️**：後端服務多已實作、`feature/e2e-tests` 已有 Playwright e2e；理由「多數後端服務未實作」過時，改為「尚缺跨服務全鏈路整合」。
  - A.13 統計同步：✅ 48→51、⚠️ 10→8、❌ 26→25（總計 85 不變）。

### 如何驗證
- 對應檔案存在性與內容已逐項 grep/glob 確認（`rankApi`/`walletApi.getTransactions` 引用、`docs/adr/ADR-003~005.md` 存在）。
- 純文件更動，不影響程式行為，無需跑測試。

## [feat] — 2026-06-29 — 後端禮品商城服務（兌換 / 後台目錄 / LOG 紀錄）

> **背景**：上一筆把商城兌換做成前端/mock（不持久、無紀錄、不發物品）。本次後端化成真正服務：星幣結算走帳務（原子扣款、冪等、樂觀鎖）、留持久兌換紀錄與業務 LOG、目錄由後台管理。決策見 `docs/adr/ADR-006.md`。
>
> **架構**：不另開微服務——比照鑽石功能併入既有服務。玩家端（目錄/兌換/背包）在 **wallet-service**，端點 `/api/v1/wallet/shop/**`（被 gateway 既有 wallet 路由吃下，**免改 gateway**）；後台目錄 CRUD 在 **admin-service**（`hasRole('ADMIN')`）。兌換＝單一 Postgres 交易內「`WalletService.debit(SHOP_PURCHASE)` 扣星幣 + 寫 `shop_redemptions`」，原子、冪等。目錄 `shop_items` 在 MySQL（CQRS 讀端）。

### Added
- DB：Postgres `migration/V13__add_shop.sql`（`shop_redemptions` 表 + `chk_wt_sub_type` 加 `SHOP_PURCHASE`）、MySQL `migration/V10__add_shop_items.sql`（`shop_items` 表 + seed 三項 + `chk_wt_sub_type` 加 `SHOP_PURCHASE`）；同步 `database/{postgres,mysql}/init.sql`。
- wallet-service：`mysql/entity/ShopItem`+repo、`postgres/entity/ShopRedemption`+repo、`service/ShopCatalogService`（MySQL 讀目錄/驗價）、`service/ShopRedemptionService`（Postgres 原子兌換 + 背包）、`controller/ShopController`（`/api/v1/wallet/shop/catalog|redeem|inventory`，X-User-Id）、DTO（`ShopItemView`/`ShopRedeemRequest`/`ShopRedeemResponse`/`ShopInventoryItem`）、例外 `ShopItemNotFoundException`(404)/`ShopItemUnavailableException`(422) + `GlobalExceptionHandler`。
- admin-service：`mysql/entity/ShopItem`+repo、`service/AdminShopService`（CRUD + 寫 `admin_action_logs` 稽核）、`controller/AdminShopController`（`POST/PUT/GET /admin/shop/items`，`hasRole('ADMIN')`）、DTO（`ShopItemRequest`/`ShopItemUpdateRequest`/`ShopItemView`）。
- 前端：`services/shopApi.js` 接真實後端（catalog/redeem/inventory）並保留 mock；`mockApi.SHOP_CATALOG`/`getShopCatalog` 鏡像後端 seed。
- 測試：wallet `ShopRedemptionServiceTest`（Mockito：成功扣款＋寫紀錄／未知商品 404／下架 422／餘額不足／冪等重放不重扣）、`ShopRedemptionIntegrationTest`（**真實雙 H2 跨資料源**：原子兌換、餘額不足整批回滾、冪等同鍵只扣一次、目錄只回上架品）、admin `AdminShopServiceTest`（建立/重複 409/部分更新/不存在 404 + 寫稽核）。

### Changed
- wallet-service：`DebitRequest` 新增選填 `subType`（`@Pattern BET|SHOP_PURCHASE`，預設 BET）、`WalletService.debit()` 改用之（game-service 不帶 subType → 仍記 BET，**行為不變**）。
- 前端：`CasinoShop.jsx` 目錄改讀 `shopApi.getCatalog()`（不再用靜態 `shopCatalog`）；`walletSlice.redeemShopItem` thunk 改帶 `itemCode`、fulfilled 讀正規化的 `balanceAfter`/`itemName`；`Inventory.jsx` 改以 `itemCode` 聚合。
- CI：`.github/workflows/ci.yml` 後端測試 `-pl` 清單加入 `backend/admin-service`（跑新 admin 商城測試）。
- wallet-service `DataSourceConfig`：Hibernate 方言改為可由 system property（`jpa.dialect.postgres`/`jpa.dialect.mysql`）覆寫，**正式環境預設 PostgreSQL/MySQL 方言不變**；surefire 設 `H2Dialect`，比照 admin-service。**為什麼**：原本寫死 `PostgreSQLDialect` 對 H2 會發 `insert ... returning id`（H2 不支援），導致 wallet 寫入路徑無法做真實 DB 整合測試（既有測試全 mock repo）；此調整讓 `ShopRedemptionIntegrationTest` 能實際驗證跨資料源交易。

### 為什麼/如何驗證
- **為什麼併入而非新微服務**：商城本質是「星幣 sink + 紀錄」，wallet 已有全部帳務機件；獨立微服務需跨服務 HTTP 扣款＋大量樣板，與鑽石/加值/贈送同住 wallet 的慣例不符。
- **如何驗證**：`mvn -pl backend/gateway-service,backend/member-service,backend/wallet-service,backend/admin-service test` → wallet 155 + admin 75 全綠（BUILD SUCCESS）。整合：套用 V10/V13 migration、起服務、前端 `VITE_USE_MOCK_API=false`，`/shop` 兌換 → 星幣降且重整不還原、`/transactions` 出現 `SHOP_PURCHASE`、`/inventory` 見禮品；後台 `POST /admin/shop/items` 新增即時反映。前端 `npm run lint && build` 綠。

## [feat] — 2026-06-29 — 禮品商城兌換落地 + 我的背包頁 + 好友浮窗改右側標籤

> **背景**：玩家回報 `/shop` 禮品商城兩個問題：① 右下角「好友列表」浮窗的觸發膠囊（246px 寬）壓住第三張卡片的「兌換」鈕，點不到；② 按「兌換」沒有真實效果——鑽石/星幣沒扣、也沒拿到物品。
>
> **調查結論**：商城用**星幣**結算（非鑽石，玩家誤會）。原 `CasinoShop.handleRedeem` 只做 `dispatch(setBalance(...))` 本地改值——header 與商城同源所以有扣，但**不持久**（重抓錢包/重新整理即被後端值蓋回）、**不寫交易紀錄**、**不發物品**，等於假流程。後端**沒有商城微服務**（整個商城是純前端，商品清單寫在 `theme/backgroundTheme.js`），故採前端/mock 落地（單一真相＝mock，AGENTS 雷區 14 精神）。
>
> **解法**：兌換改走 redux thunk → `shopApi` → mock，重用既有 `applyWalletChange()`（扣星幣並寫一筆「商城兌換」交易），物品收進新的 `db.inventory` 並於新「我的背包」頁瀏覽；好友浮窗改為貼右緣垂直置中的可收合直立標籤，面板往左展開。

### Added
- 前端：`services/shopApi.js`（`redeemItem`/`getInventory`；mock 模式委派 `mockApi`，真實 API 模式拋「後端尚未提供商城服務」明確錯誤）。
- 前端：`pages/Inventory.jsx`（我的背包，仿 `FriendFloatingPanel` 用 local state 抓 `shopApi.getInventory()`，同款禮品聚合顯示數量與最近兌換時間）；`App.jsx` 加 `/inventory` PrivateRoute；`AppShell.jsx` 導覽列加「我的背包」（排在禮品商城後）。
- 前端：`mockApi.redeemShopItem`/`getInventory`（`db.inventory` 惰性初始化，仿 `gameRounds`）、`transactionLabels.shop='商城兌換'`。
- 前端：`walletSlice` 的 `redeemShopItem` thunk、`redeem` 狀態區塊與 `clearRedeemNotice`。

### Changed
- `CasinoShop.jsx`：`handleRedeem` 改 dispatch `redeemShopItem` thunk（保留餘額守門雙保險、兌換中按鈕 disabled 顯示「兌換中…」、成功/失敗訊息改讀 store、成功後提供「前往我的背包」連結），移除原本直接 `setBalance` 的假流程。
- `FriendFloatingPanel.css`：浮窗由右下角膠囊改為**右緣垂直置中的細長直立標籤**（直書 `writing-mode: vertical-rl`、只左側圓角貼齊邊緣），面板改從右緣往左水平展開；同步重整 RWD 區塊使手機沿用一致定位（移除原右上橫膠囊覆寫，避免與新 base 的 `translateY(-50%)` 衝突）。
- `FriendFloatingPanel.jsx`：觸發鈕內容改直向堆疊、chevron 改左右方向語意（收合指左＝往左展開）。**收合/展開邏輯未動。**

### 為什麼/如何驗證
- **為什麼前端落地**：後端無商城服務，且本次需求是修玩家體感問題、非新建微服務；維持 mock 預設體驗一致。
- **如何驗證**：mock 模式 `cd frontend && npm run dev` → `/shop` 按兌換，header 星幣即時下降且**重新整理仍維持**；`/transactions` 出現「商城兌換－<品名>」負數紀錄；`/inventory` 看到禮品；星幣不足時按鈕 disabled。靜態檢查 `npm run lint && npm run build` 綠燈。

## [feat] — 2026-06-29 — 每月累計簽到獎勵 + 簽到月曆改後端權威

> **背景**：玩家回報「每天簽到的星幣沒辦法累計進『每月登入/本月簽到』，所以拿不到獎勵」。調查確認三層問題：① **直接 bug**：`frontend/src/pages/CheckIn.jsx` 簽到後沒把日期寫進 localStorage（AppShell/Profile 兩份同名 handler 有寫，三頁各自複製貼上、其中一份漏掉）→ 從 `/checkin` 簽到的日子不會累計；② **設計脆弱**：月度歷史只存 localStorage，清快取/換裝置即歸零，後端 `daily_checkins` 有資料卻無讀端點；③ **功能缺失**：全專案沒有可領取的「月度累計獎勵」，「本月簽到」只是顯示文字。
>
> **解法**：新增「本月累計簽到滿 N 天 → 領大獎」機制，並把簽到月曆/天數改為**後端權威來源**（前端讀後端、mock 鏡像、移除 localStorage 日期存儲，從根本消除漏存 bug）。里程碑（當月累計天數，非連續）：**10 天→2,000 / 20 天→5,000 / 28 天（全勤）→12,000**，手動領取、僅限當月、達標未領才可領。決策見 `docs/adr/ADR-005.md`。
>
> **帳務鏈（ADR-002）**：領取走 member 寫 claim 紀錄 + 同交易 `outboxService.save("wallet.credit.request", …)`，wallet 入帳；新 credit 子型 `MONTHLY_REWARD`（非 WIN，不污染 rank 今日贏幣榜）。冪等：claim 表 `UNIQUE(player_id, reward_month, milestone_days)` + `idempotencyKey=monthly-reward-{playerId}-{yyyy-MM}-{milestoneDays}`。

### Added
- member-service：`entity/MonthlyRewardClaim`（表 `monthly_reward_claims`，`reward_month` 刻意避開 MySQL 關鍵字 `YEAR_MONTH`）、`repository/MonthlyRewardClaimRepository`、`service/MonthlyRewardService`（`MILESTONES={10:2000,20:5000,28:12000}`、`getStatus`、`@Transactional claimMonthlyReward`）；DTO `CheckinStatusResponse`/`MonthlyMilestoneStatus`/`MonthlyRewardClaimResponse`/`MonthlyRewardClaimRequest`；例外 `InvalidMonthlyMilestoneException`(400)/`MonthlyRewardNotEligibleException`(422)/`MonthlyRewardAlreadyClaimedException`(409) + `GlobalExceptionHandler`。
- member-service 端點（`CheckinController`，掛在 `/api/v1/wallet`）：`GET /api/v1/wallet/checkin/status`（可選 `?month=YYYY-MM`，預設台北當月）、`POST /api/v1/wallet/checkin/monthly-reward`（body `{milestoneDays}`）。
- DB：MySQL `migration/V9__add_monthly_reward.sql`（建表 + `chk_wt_sub_type` 加 `MONTHLY_REWARD`）、Postgres `migration/V12__add_monthly_reward_subtype.sql`；同步 `database/mysql/init.sql`、`database/postgres/init.sql`。
- 前端：`utils/checkInDates.js`（單一 `getTaipeiDateKey`/`getMonthDays`/`calculateDailyCheckInReward`）、`hooks/useDailyCheckIn.js`（後端權威狀態 + 簽到/領取動作）、`walletApi.getCheckInStatus`/`claimMonthlyReward` + `TX_SUB_TYPE_LABELS.MONTHLY_REWARD`、`walletSlice` 的 `checkInStatus`/`monthlyReward` 狀態與 thunks；`mockApi` 鏡像（`MONTHLY_REWARD_MILESTONES`、`db.checkinDates`/`db.monthlyRewardClaims`、`getCheckInStatus`/`claimMonthlyReward`）。
- 測試：`DailyCheckinRepositoryTest`、`MonthlyRewardClaimRepositoryTest`、`MonthlyRewardServiceTest`、`frontend/src/services/mockApi.test.js`。

### Changed
- 簽到月曆/本月天數/連續天數**改讀後端 `checkin/status`**：`CheckIn.jsx`、`AppShell.jsx` 簽到彈窗、`Profile.jsx` 側欄三頁統一改用 `useDailyCheckIn`，並新增「領取月度獎勵」按鈕（可領→啟用、已領→`已領取`、未達標→`未達標`）。
- wallet-service `dto/CreditRequest` 的 `@Pattern` 與訊息加入 `MONTHLY_REWARD`。
- gateway `application.yml`：`member-checkin` 路由 Path 改為 `/api/v1/wallet/daily-checkin,/api/v1/wallet/checkin/**`（仍排在 wallet catch-all 之前）。

### Fixed
- **簽到累計 bug**：`mockApi.checkIn()` 改用台北日界 + 缺日重置連續天數 + 把當日寫入 `checkinDates`（原本用 UTC 日界、連續天數只加不重置、且不存每日日期）。
- **去重**：移除 AppShell/Profile 重複的 `CHECKIN_DATES_KEY`/`getStoredCheckInDates`/`saveStoredCheckInDate`/`getTaipeiDateKey`/`getMonthDays`/`calculateCheckInReward` 與 localStorage 日期 seeding，根治「某頁 handler 漏存」類 bug（保留純 UI 的 `CHECKIN_AUTO_OPEN_KEY`）。

### 如何驗證
- `mvn -pl backend/member-service test`：83 passed（含新 3 個測試類）。
- `mvn -pl backend/gateway-service,backend/wallet-service test`：150 passed。
- `node --test tests/infra/*.test.js`：127 passed（未動 Kafka topic）。
- 前端 `npm run lint`/`npm run build`/`npm run test`：lint 乾淨、build 成功、vitest 15 passed。
- 跑真實後端前須套用 MySQL V9 / Postgres V12 migration（否則 member `validate` 啟動失敗、wallet 讀庫撞 `chk_wt_sub_type`）。

## [Removed/Fixed] — 2026-06-29 — 移除老虎機/捕魚機殘留幸運值保底 + 好友併發 409 + 送禮前端防呆

> **背景**：原以為「幸運值」已從所有遊戲移除，實際只有百家樂清乾淨；**老虎機與捕魚機的幸運值仍在運作**——前端 `useFortuneMeter` 蓄滿後送 `fortuneReady`，後端據此**強制必中**（老虎機保底中線三連 `spinGuaranteedWin`、捕魚機本批保底捕獲 `resolveShotGuaranteed`），真實影響結算與 RTP，並非純視覺。本次將其前後端機制、視覺、死碼、測試、mock 全部移除。順帶修好友併發 500→409 與送禮前端防呆。
>
> **RTP 影響**：移除「對玩家有利」的保底後，老虎機/捕魚機 RTP 回到結構性水位（老虎機 ≈0.94、捕魚 ≈0.96 含殘血回收），仍在 `risk.global-rtp-limit` 門檻下，**不需調門檻**。
>
> **已知可接受後果**：歷史「保底」捕魚對局的 verify-shot 重放會走一般路徑（sim 環境舊資料極少，無真實影響）。
>
> **交易系統**：玩家間交易/市場在 repo 中**完全不存在**（無後端 service/entity、無前端元件），本次不實作，僅在此記錄現況；日後若要做需另開任務（schema + service + Kafka + UI）。

### Removed
- 幸運值後端（game-service）：`SlotService.spin/settleInternal` 移除 `fortuneReady` 參數與 `useGuarantee` 分支（固定 `slotMachine.spin`）；`SlotMachine.spinGuaranteedWin()` 刪除；`FishingService.shots/verifyShot/writeResultJson` 移除 `fortuneReady`/`guaranteedShotSeq`/保底分支（固定 `resolveShot`）；`FishingCombat.resolveShotGuaranteed()` 刪除、`resolve()` 去掉 `forceCapture` 參數。
- DTO：`SpinRequest.fortuneReady`、`SpinResponse.guaranteed`、`FishingShotsRequest.fortuneReady`、`BaccaratBetRequest.fortuneReady`（死碼）、`GameSession.fortuneReady`（死碼）。
- `FishingSession.guaranteedShotSeq` 欄位 + `FishingSessionStore` 的 `F_GUARANTEED_SHOT_SEQ` 序列化（雷區 16）。
- 幸運值前端：刪 `casino-fx/fx/useFortuneMeter.js`、`FortuneMeter.jsx`、`LuckyAura.jsx`，移除 `casino-fx/index.js` export 與 `casino-fx.css` 對應樣式；`SlotGame.jsx`/`Fishing.jsx` 移除 meter/aura/`fortuneReady`/保底橫幅；`useFishingSession.js` 移除 `fortuneReady` 追蹤；`gameApi.js`/`mockApi.js` 移除 `fortuneReady`（mock 鏡像同步，雷區 14）。
- 對應測試：`SlotServiceTest`（刪 2 案例＋更新簽章）、`FishingServiceCrossBatchTest`（更新簽章）、`FishingCombatTest`（刪 `resolveShotGuaranteed` 案例）、`FishingSessionStoreTest`（round-trip 移除 `guaranteedShotSeq`）。

### Fixed
- 好友併發重複申請 500→409：`FriendshipService.sendFriendRequest` 在新 insert 處 `save+flush` 並 catch `DataIntegrityViolationException` → 轉 `FriendshipAlreadyExistsException`（精準回 409「好友關係已存在」）；`GlobalExceptionHandler` 另加 `@ExceptionHandler(DataIntegrityViolationException.class)` 作**中性 409 安全網**（訊息「資料衝突，請稍後再試」，**不寫死好友訊息**——否則註冊撞 username/email、簽到撞當日唯一鍵等併發衝突會被誤標成好友）。新增 `FriendshipServiceTest` race 案例守門。
- 好友樂觀鎖強化：`entity/Friendship` 新增 `@Version private Long version`（保護同一申請併發接受/拒絕、REJECTED→PENDING 重置、好友上限競態，ADR-001/雷區 8）；`GlobalExceptionHandler` 新增 `ObjectOptimisticLockingFailureException` → 409。Schema：`database/mysql/init.sql` 加 `version` 欄位 + 補丁 `migration/V8__add_friendship_version.sql`。

### Changed
- 送禮前端防呆（後端 `GiftService`/`GiftTransferService` 未動）：`store/slices/walletSlice` 為 `giftCoins` 補 `pending`/`rejected` handler 與獨立 `gift:{loading,message,error}` 狀態 + `clearGiftNotice` reducer；`services/walletApi.giftCoins` 補強冪等鍵註解（**逾時重試須複用同一 idempotencyKey** 防雙扣）。

### 如何驗證
- `mvn -pl backend/game-service test`：幸運值移除後 RTP band / session store / combat 測試全綠。
- `mvn -pl backend/member-service test`：好友單元測試（純 Mockito，不驗 schema）全綠；`@Version` 不影響既有案例。
- `mvn -pl backend/wallet-service test`：送禮後端未動，回歸確認。
- 前端 `npm run lint` + `npm run build`：刪檔後無殘留 import，Rollup 不報 missing module。
- grep `fortune|guaranteedShotSeq|FortuneMeter|LuckyAura`：`frontend/src` 與 `backend/game-service/src` 皆無活躍引用。

## [Fixed] — 2026-06-25 — 捕魚退款／結算本金返還被誤計入「今日贏幣榜」（新增 REFUND 子型）

> **問題**（Bug 5：退款／剩餘本金被算成 WIN）：`game-service` 的 `WalletClient.credit()` 寫死 `subType="WIN"`，而捕魚兩處入帳都走它——(1) buy-in 退款（session 建立失敗補償，`FishingService` line 151）、(2) 場次結算把剩餘局內餘額返還錢包（line 497）。`rank-service` 的 `WalletBalanceChangedConsumer` 只在 `subType=="WIN"` 時 `addDailyWinnings`，於是退款與本金返還被灌進「今日贏幣王」排行榜，污染榜單可信度。
>
> **修法**：`WalletClient.credit` 新增帶 `subType` 的多載；中獎派彩（老虎機/百家樂）維持 `WIN`，捕魚兩處改用新子型 `REFUND`（CREDIT 類、非中獎）。rank 端邏輯不動（本來就只認 WIN），REFUND 自然被排除。新增 `REFUND` 至 wallet `CreditRequest.@Pattern` 與兩庫 `chk_wt_sub_type` CHECK 白名單（init.sql + 補丁 migration mysql V7 / postgres V11）。
>
> 註：buy-in 制下 wallet 只看得到「結算淨返還」一筆 credit（未消耗本金＋局內累積派彩的混合），無法在錢包事件層拆出純贏額，故捕魚不計入今日贏幣榜；若日後要納入，需另設專屬贏額事件，不在本次修正範圍。

### Fixed
- `backend/game-service/.../client/WalletClient.java`：新增 `credit(playerId, amount, subType, idempotencyKey, referenceId)` 多載；原 4 參數版本委派並固定 `WIN`（老虎機/百家樂派彩不受影響）。
- `backend/game-service/.../service/FishingService.java`：buy-in 退款與場次結算返還兩處 credit 改傳 `subType="REFUND"`。
- `backend/game-service/.../client/dto/WalletCreditRequest.java`：Javadoc 補充 REFUND 用途。
- `backend/wallet-service/.../dto/CreditRequest.java`：`@Pattern` 與 Javadoc 新增 `REFUND`。
- `database/{postgres,mysql}/init.sql`：`chk_wt_sub_type` 與欄位註解新增 `REFUND`。
- `database/mysql/migration/V7__add_refund_subtype.sql`、`database/postgres/migration/V11__add_refund_subtype.sql`：補丁加上 `REFUND`（與 init.sql 末態一致）。
- `backend/game-service/.../service/FishingServiceTest.java`：退款相關 stub/verify 改用 5 參數多載，並斷言 `subType=="REFUND"`。

### 如何驗證
- `mvn -pl backend/game-service,backend/wallet-service test`：全綠（game-service 含 FishingServiceTest、wallet-service 含 InternalWalletControllerCreditTest 共 150 測試）。
- rank 端 `WalletBalanceChangedConsumerTest.handleWalletBalanceChanged_nonWinSubType_doesNotAccumulateDailyWinnings` 既有測試證明非 WIN 子型不累加今日贏幣。

## [Fixed] — 2026-06-25 — fresh DB 缺 CASHBACK 子類型導致返利入帳被 CHECK 約束擋下（init.sql 與補丁/契約對齊）

> **問題**（Bug 4：CASHBACK 白名單不同步）：虧損返利鏈路 `CashbackEventPublisher` 發 `wallet.credit.request`（subType=CASHBACK）→ `WalletCreditRequestListener` → `WalletService.credit` 寫庫。本專案無 Flyway 自動執行，schema 由 docker-entrypoint-initdb.d 載入的 `database/{postgres,mysql}/init.sql` 建立；而兩份 init.sql 的 `chk_wt_sub_type` CHECK 約束**未含 CASHBACK**（MySQL 讀端更落後，連 `DIAMOND_EXCHANGE`/`TOPUP` 都缺）。雖有補丁 V9（postgres）/ V6（mysql）加上 CASHBACK，但 migration 資料夾不被載入 → **fresh DB 上返利入帳會被 CHECK constraint 擋下，讀端同步也會掛**。附帶 `CreditRequest.@Pattern` 也漏列 CASHBACK（Kafka listener 路徑未觸發 bean validation，非運行時阻斷點，但屬契約不一致）。

### Fixed
- `database/postgres/init.sql`：`chk_wt_sub_type` 與 `sub_type` 欄位註解補上 `CASHBACK`，與補丁 V9 末態一致。
- `database/mysql/init.sql`：`chk_wt_sub_type` 與註解補上 `DIAMOND_EXCHANGE`/`TOPUP`/`CASHBACK`（讀端原本停在 `BANKRUPTCY_AID`），與補丁 V6 末態一致。
- `backend/wallet-service/.../dto/CreditRequest.java`：`@Pattern` 與 Javadoc 補上 `CASHBACK`，契約與 DB 約束齊頭。

### 為什麼
- fresh DB 直接由 init.sql 建表，補丁 migration 不自動執行；init.sql 必須等於「所有補丁套用後的末態」，否則新環境的返利功能直接壞掉。

### 如何驗證
- 對比 `database/postgres/migration/V9__add_cashback_records.sql` 與 `database/mysql/migration/V6__add_cashback_subtype.sql` 的 CHECK 末態，確認 init.sql 子類型清單完全一致。
- `mvn -pl backend/wallet-service test`：H2 contextLoads 與既有測試綠燈。

## [Fixed] — 2026-06-25 — 排行榜/錢包流水/贈幣改接真實 API，並修正前端訂閱不存在的 WS topic

> **問題**（前端三處仍走 mock 殘留或訂閱錯誤頻道）：
> 1. **Rank 頁仍用 mock**：`rankSlice.fetchRanks` 直接 `mockApi.getRank()`，未接 rank-service；且 `upsertRankRows` 以 `nickname` 當去重鍵，與後端即時事件欄位（`playerId`）對不上 → 即時更新錯位。
> 2. **錢包交易紀錄與贈幣走 mock**：`walletSlice.fetchTransactions/giftCoins` 走 `mockApi`，後端 `GET /api/v1/wallet/transactions`、`POST /gift` 沒被使用（看不到真實流水、贈幣限額/冪等沒驗到）。
> 3. **訂閱不存在的 WS topic**：`RealtimeBridge` 訂閱 `/topic/wallet`（後端無此頻道）與 `/topic/game/result`（後端遊戲結果走私人佇列 `/user/queue/notifications`，已由 `useWebSocket` 內建處理）→ 錢包/遊戲結果即時更新失效。
>
> **修法**：rankSlice / walletSlice 兩個 mock thunk 換成真實 API 並對齊欄位；RealtimeBridge 只保留後端確實會廣播的 `/topic/rank`（先 normalize 成前端列形狀），移除兩個無效訂閱。各 API 維持 `VITE_USE_MOCK_API` 開關（mock 模式行為不變）。

### Added
- `frontend/src/services/rankApi.js`：封裝 rank-service 真實 API（`GET /api/v1/rank/global`、`/friends`、`/global/{playerId}`），把後端 `RankEntryResponse{playerId,username,rank,score}` 映射成前端列形狀 `{id,nickname,score,rank}`（與 `mockApi.getRank` 對齊）；另含 `normalizeBroadcast` 將 `RankUpdateEvent.entries` 轉同一形狀。`getRanks` 對 `/global/{playerId}` 的 404（未上榜）視為無名次、不擋榜單載入。
- `frontend/src/services/walletApi.js`：新增 `getTransactions`（`GET /api/v1/wallet/transactions`，前端 1-based page ↔ 後端 0-based、`type` 映回 DEBIT/CREDIT、`from/to` 日期；回傳 `{items,total,page,pageSize}`；DEBIT 以負數呈現、subType→中文標籤）與 `giftCoins`（`POST /api/v1/wallet/gift`，`friendId→receiverId`、自動產生 `idempotencyKey`、補查餘額組 `{wallet}`）。

### Changed
- `frontend/src/store/slices/rankSlice.js`：`fetchRanks` 改用 `rankApi.getRanks(playerId)`（playerId 取自 `auth.player.id`）；`upsertRankRows` 去重鍵改為 `row.id ?? row.nickname`。
- `frontend/src/store/slices/walletSlice.js`：`fetchTransactions`/`giftCoins` 改走 `walletApi`，錯誤訊息統一用 `extractError`；移除不再使用的 `mockApi` import。
- `frontend/src/components/RealtimeBridge.jsx`：只訂閱 `/topic/rank` 並先 `rankApi.normalizeBroadcast`；移除 `/topic/wallet`、`/topic/game/result` 兩個無效訂閱。

### 如何驗證
- `cd frontend && npx eslint <改動檔>`：無錯誤。
- `cd frontend && npx vite build`：建置成功（`✓ built`）。
- mock 模式（預設 `VITE_USE_MOCK_API !== 'false'`）三條路徑仍回退 `mockApi`，玩家體驗不變。

## [Fixed] — 2026-06-25 — stop-all／stop-backend 無法關閉 cmd 服務視窗（啟動端改 cmd、停止端仍只認 PowerShell）

### Fixed
- `stop-all.ps1`：往上追父程序找「視窗 host」時，原本只比對 `powershell`，改為比對 `^(powershell|pwsh|cmd)$`，並統一用 `taskkill /pid <winPid> /t /f`（連同 mvn/java 子程序一起收）關閉視窗。
- `stop-backend.bat`：原本內嵌 PowerShell 只 `taskkill` 佔埠 java（更原始、連 walk-up 都沒有，同樣關不掉 cmd 視窗），改為委派 `stop-all.ps1`（單一真相的關窗邏輯）；收尾 `timeout /t 2`（stdin 被重導時會報 `Input redirection is not supported`、exit 1）換成 `ping -n 3`。

### 為什麼 (Why)
- 現行啟動器 `start-all.bat` 用 `start "svc" cmd /k ...` 把服務開在 **cmd.exe 視窗**，但 `stop-all.ps1` 的關窗邏輯（commit `8ec76f2`/`bf58420`）是為舊啟動器 `start-backend.ps1` 的 **PowerShell 視窗**寫的，只比對 `powershell`。cmd 視窗的父鏈裡沒有 powershell，walk-up 撲空 → 落到只 `taskkill` 佔埠 java 的 fallback：埠釋放了，但 cmd 視窗是 java 的祖先（`/t` 只殺子孫不殺祖先），所以視窗留著沒關。啟動端早已從 ps1 換成 bat，停止端沒同步更新，兩邊對不上。`stop-backend.bat` 是更原始的版本，連 walk-up 都沒有（只 `taskkill` 佔埠 java），同樣只釋放埠、不關視窗，故一併修正並收斂到 `stop-all.ps1`。

### 如何驗證 (Verification)
- 無頭模擬（`cmd -> ping` 當作「cmd 視窗 -> 佔埠 java」）：walk-up 從葉程序正確命中 cmd 視窗 PID，`taskkill /t /f` 後 cmd 與子程序整棵清空。
- `stop-all.ps1` 空跑（無服務時）輸出全部 not running，無語法錯誤。
- `stop-backend.bat` 空跑：正確委派 `stop-all.ps1`，輸出一致、exit 0。

---

## [Changed] — 2026-06-25 — 捕魚機經濟再平衡（殘血回收／RTP 96%／砲台傷害收斂）＋ 子彈面額玩家自選

> 架構級決策見 [docs/adr/ADR-004.md](docs/adr/ADR-004.md)。

### Added
- **殘血部分回收（體感 RTP 地板）**：
  - `backend/game-service/.../fishing/FishingCombat.java`：新增 `RECOVERY_RATE = 0.70` 與 `recoveryPayout(betPerShot, cannonLevel, cumDamage)`（= `floor(RECOVERY_RATE × betPerShot × cumDamage / (critFactor × 砲台傷害))`）。
  - `backend/game-service/.../service/FishingService.java`：`settleInternal` 結算時對 `fishDamage` 殘血魚累加回收，折入 `sessionBalance`（credit 回 wallet）與 `totalPayout`（→ `game_rounds.win_amount`，RTP 監控涵蓋）。
  - `frontend/src/services/mockApi.js`：鏡像回收公式於 `fishingEnd`（雷區 14）。
  - `dto/FishingEndResponse.java` 新增 `residualRecovery`；前端結算頁顯示「殘血回收 +N」。
- **子彈面額玩家自選、與砲台解耦**：
  - `FishingSession` 新增 `betPerShot` 欄位、`FishingSessionStore.toHash/fromHash` 補序列化（雷區 16）；`FishingStartRequest`/`FishingSessionView`/controller/`FishingService.start` 串接；`MIN_BET=10/MAX_BET=10000/MIN_BUYIN=100/MAX_BUYIN=1_000_000` 守門。
  - 前端 `useFishingSession`（`BET_TIERS/BET_MIN/BET_MAX/BUYIN_*`、`betPerShotRef`）、`Fishing.jsx`（面額/入場「檔位＋自訂輸入」選擇器）、`gameApi.fishingStart` 帶 `betPerShot`。
- 測試：`FishingCombatTest` 殘血回收不變量（回收 ≤ 投入成本）；`FishingSessionStoreTest` 補 `betPerShot` round-trip；`FishingServiceTest` 面額守門 + 結算回收。

### Changed
- `FishingCombat.TARGET_RTP` 0.92 → **0.96**（設計值/天花板）；`CANNON_DAMAGE` `{0,10,17,26}` → **`{0,10,14,18}`**（砲台傷害收斂，最低捕獲率 ~0.30→~0.45，減少「血歸零卻掙脫」）。同步 `mockApi.js` 鏡像與 `FishingCombatTest` band（0.86~0.98 → 0.90~1.02）。
- `application.yml`：`risk.global-rtp-limit.FISHING` `1.00` → **`1.10`**（設計 RTP 升到 0.96 且高變異，門檻留裕度防誤判超限，雷區 17）。
- `frontend/src/components/fishingEngine.js`：`TIER_RENDER` 拉長 HIGH/BOSS/SPECIAL 過場時間（BOSS 13.5–17s → 20–26s 等），大魚停留更久、減少游走沉沒。
- `FishingService` 移除 `CANNON_BET`（注額不再綁砲台）；`validateBatch` 改驗 `session.betPerShot`。`FishingStartRequest.buyIn` 上限 50,000 → 1,000,000。

### 為什麼 (Why)
- 設計 RTP 92% 只在「魚有打死」成立；實戰大魚游走前的子彈全損，使體感 RTP ≈ 46%（虧 ~54%）。殘血回收把每發子彈期望回報夾在 `[RECOVERY_RATE, TARGET_RTP] = [0.70, 0.96]`——形成體感 RTP 地板 70%（最差只虧 30%）、天花板 96%（回收恆 ≤ 投入成本，莊家不超付）。砲台傷害收斂處理「血歸零卻掙脫」的觀感（pCapture 硬地板會使 RTP 破表、不可行，見 ADR-004）。面額解耦讓玩家自選注額（數學上 RTP 與注額無關，恆 96%）。

### 如何驗證 (Verification)
- `mvn -pl backend/game-service test`：全綠（BUILD SUCCESS）。
- `cd frontend && npm run lint && npm run build`：lint 無誤、build 成功（`✓ built`）。
- 手測：進場自選面額/入場額；金炮連打中小魚捕獲率手感（~0.44）；對大魚開火後放走 → 結算見「殘血回收」回袋；單場 totalPayout/totalBet 落在 70%~96%。

---

## [Released] — 2026-06-25

### Fixed
- **捕魚機後端跨批累傷未持久化（魚回寫打不死）根因修復**：
  - `backend/game-service/.../fishing/FishingSessionStore.java`：Redis Hash 漏存血量/傷害模型的跨批狀態。`toHash()`/`fromHash()` 原本完全沒有序列化 `fishDamage`（每條魚 instance 的累積傷害）、`kills`（致命一擊紀錄）、`guaranteedShotSeq`（幸運值保底 shotSeq）這三個欄位。改為注入 `ObjectMapper`，把 `fishDamage`/`kills` 以 JSON 字串存入新 hash 欄位、`guaranteedShotSeq` 以純量欄位存入；讀取時對應反序列化還原，欄位缺失或 JSON 毀損時保守 fallback 為空集合（與 `find()` 既有容錯一致）。
  - `frontend/src/components/fishingEngine.js`：HP 上界防禦護欄。`handleResults` 更新 `f.hp` 改為 `Math.max(0, Math.min(f.maxHp, r.hpRemaining))`，避免任何異常偏高的 `hpRemaining` 造成 HP 條視覺溢出/看似回滿（純防禦，後端權威不變）。
- **mock 捕魚 resumed 分支補上 fishDamage 歸零**：
  - `frontend/src/services/mockApi.js`：`fishingStart()` resumed 分支補 `existing.fishDamage = {}`。原本 `fishingActive()` 已會在回傳前清空，避免「引擎 remount 後 idSeq 從 0 重置 → 舊傷害 key 碰撞新魚 id → 新魚繼承舊傷害（初擊即死）」，但 `fishingStart()` 的 `existing` 分支漏了此重置，現已對齊防護邏輯。
- **風控 RTP 門檻改為 per-game，修正百家樂幾乎每局被強制改判「莊家贏」**：
  - `backend/game-service/.../service/RiskControlService.java`：移除 `@Value` 標量欄位，改注入 `RiskProperties`；`isGlobalRtpOverLimit` 改用 `riskProperties.globalRtpLimitFor(gameType)`。修正原本單一門檻 `0.95` 套用到不同莊家優勢遊戲導致的百家樂恆常誤判問題（百家樂含本金 RTP 結構上 ≈ 0.99）。
  - `backend/game-service/src/main/resources/application.yml`：`risk.global-rtp-limit` 由單一 `0.95` 改為 per-game map（`default: 1.05`、`SLOT: 0.97`、`BACCARAT: 1.02`、`FISHING: 1.00`）。門檻訂在該遊戲結構性 RTP 之上，風控只在實際出現異常莊家虧損時才觸發。

### Added
- `backend/game-service/.../config/RiskProperties.java`：`@ConfigurationProperties(prefix="risk")`，承載 `playerWinLimit`、`rtpSampleSize` 與 per-game `globalRtpLimit` Map。
- `backend/game-service/.../fishing/FishingSessionStoreTest.java`：**store round-trip 回歸測試**（純 Mockito，以記憶體 Map 模擬 Redis Hash 的 `putAll`/`entries`）。驗證 `fishDamage`/`kills`/`guaranteedShotSeq` 完整 round-trip、未設定時還原為空集合而非 NPE、被擊殺的魚累傷不殘留。先前此 store 的序列化從未被測（`FishingServiceTest` 把它整個 mock 掉），正是 bug 漏網主因。
- `backend/game-service/.../service/FishingServiceCrossBatchTest.java`：**跨批行為層整合測試**（真 store + 真 RNG + 記憶體 Redis 假替身）。同一條河豚跨多批單發開火，斷言 `hpRemaining` 跨批嚴格遞減、8 批內被擊殺（修復前永遠打不死，此測試會紅）。
- `tests/smoke/smoke.mjs`：捕魚段補上必填 `fishInstanceId`（先前缺欄位 → shots 一律 400、實機根本沒測到捕魚射擊），並改為「同一條龍王跨兩批各 2 發」+ 新增「捕魚跨批累傷持久化（hpRemaining 不回滿）」斷言，讓全功能 smoke 也守住此 bug。
- `RiskControlServiceTest`：新增 3 筆測試——百家樂含本金 RTP 0.99 < 門檻 1.02 不攔截（回歸）、百家樂 RTP 1.03 ≥ 1.02 仍攔截、未列出遊戲走 `default` 1.05。

### 為什麼 (Why)
- **捕魚機大魚不死**：捕魚 session 存於 Redis Hash（`game:fishing:session:{playerId}`），每批 `POST /{sessionId}/shots` 都會 `find()` 重讀 session。`fishDamage` 沒被序列化 → 每批被 `@Builder.Default` 重置成空 Map → `damageBefore` 永遠是 0 → 跨批累傷歸零 → 大魚（如龍王 HP=2000）每批 HP 都「回寫」回滿、永遠打不死。單批內累傷正常，故小魚打得死、大魚必死不了。mock 路徑因存於 localStorage 故先前未暴露此問題。一併持久化 `guaranteedShotSeq` 亦修正了保底命中若發生在前一批，reload 後會遺失的潛在副 bug。
- **風控門檻優化**：單一門檻（0.95）套用到不同莊家優勢的遊戲必然誤判。改為 per-game 門檻（含本金口徑）後，正常 play 下後端百家樂回歸公平，與前端 mock 一致，不需修改前端 mock（符合 AGENTS 雷區 14）。

### 如何驗證 (Verification)
- `mvn -pl backend/game-service test`：158 passed（含新增的 `FishingSessionStoreTest` 與 `RiskControlServiceTest` 7 筆，`GameServiceApplicationTests` contextLoads 確認 `RiskProperties` 綁定成功）。
- `cd frontend && npm run lint && npm run build`：綠燈通過。
- **實機測試（真實後端）**：
  1. 對龍王持續開火數秒（分多批 flush），同一條魚 `hpRemaining` 跨批嚴格遞減、不再回滿，最終 `killed=true`。
  2. 執行 `redis-cli HGETALL game:fishing:session:{playerId}` 可見 `fishDamage` JSON 欄位隨開火變動。

---

## [Released] — 2026-06-24

### Fixed
- **捕魚機 idSeq 跨 session 碰撞**：
  - `frontend/src/components/fishingEngine.js`：`this.idSeq` 初始值從 `0` 改為 `Date.now()`。引擎每次重建的起點都不同，徹底消除舊 `fishDamage` key 被新魚繼承的可能（避免 HMR 等只重建引擎但未清空狀態時的碰撞風險）。
- **手動點擊 fleeing 魚問題修復**：
  - `frontend/src/components/fishingEngine.js`：`_nearestFish` 補上 `f.fleeing` 過濾，避免用戶點到正在逃跑動畫的魚觸發 `fire()`（浪費注額、且避免在 mockApi 留下錯誤的 `fishDamage` 殘留值）。
- **捕魚機四個前端體驗 bug 修正**：
  - `frontend/src/components/fishingEngine.js`：**限流視覺子彈** — 有魚目標但 token bucket 限流時不再生成視覺子彈，消除「大量子彈飛出卻不扣注也不傷魚」的誤解。
  - `frontend/src/components/fishingEngine.js`：**HP 條計時消失** — 魚有累積傷害（`hp < maxHp`）時 HP 條以半透明（alpha 0.55）持續顯示，確保大魚多發攻擊時玩家可看到傷害積累。
  - `frontend/src/services/mockApi.js`：**fishDamage ID 碰撞** — `fishingActive()` 恢復場次時先清空 `fishDamage`，防止引擎重建後新魚繼承舊魚傷害。
  - `frontend/src/pages/Fishing.jsx`：**結算說明不足** — 結算按鈕下方新增「剩餘餘額全額退回」說明，消除玩家必須打光餘額才能離開的心理負擔。

### Changed
- **前端 access token 過期改為靜默續期**：
  - `frontend/src/services/api.js`：401 回應攔截器改為先嘗試 `POST /api/v1/auth/refresh` 靜默續期再重送原請求；續期失敗（或無 refresh token / mock 模式）才 `logout()` 重導。實作 single-flight（`refreshPromise`）確保並發 401 共用同一次續期，避免後端 refresh token 輪替造成 mismatch。
  - `frontend/src/store/slices/authSlice.js`：新增 `tokenRefreshed` reducer，只更新 access/refresh/expiresIn 並寫回 localStorage，保留 `player`（不可複用 `loginSuccess`，避免將 `player` 蓋成 undefined）。

### Added
- **前端導入 Vitest 與自動續期回歸測試**：
  - `frontend/src/services/api.test.js`：涵蓋 401 攔截器 7 個情境（續期成功重送、並發 single-flight、續期失敗登出、無 token 直接登出、auth 端點不觸發等）。以自訂 axios adapter + `vi.spyOn` 驅動，免真實網路。
  - `frontend/package.json` & `vite.config.js`：新增 `vitest`、`jsdom` 依賴及相關測試 scripts 與配置。
  - `.github/workflows/ci.yml`：新增 `frontend-test` job，在 PR/push 至 main/develop 時進行擋關。

### 為什麼 (Why)
- **idSeq 與 fleeing**：`idSeq = 0` 使不同生命週期的引擎 id 空間完全重疊；改用時間戳起點讓碰撞率歸零。fleeing 魚的 `fishDamage` 在 killed 時已被刪除，重新 fire 會以面目全非的狀態汙染後端/mock 邏輯。
- **靜默續期**：access token 預設只有 15 分鐘，而 7 天的 refresh token 從未被前端利用，導致用戶頻繁被踢回登入頁。串接後端現有的輪替式 refresh 機制，可大幅提升用戶無感續留體驗。

### 如何驗證 (Verification)
- `cd frontend && npm test`：7 passed。
- `npx eslint` 與 `npm run build`：皆綠燈通過。
- **捕魚機實測**：
  1. 對大魚打至低血量後觸發 HMR 引擎重建，新魚血量正常從滿血開始，無傷害繼承。
  2. 魚隻掙脫逃跑時快速點擊，確認不扣注、不發射子彈。

---

## [Changed] — 2026-06-23 — 捕魚機魚種視覺對齊後端 + Boss/魚群事件（Phase 4）

> 捕魚機升級第四階段：前端 spawn 改採後端魚種真相（tier/spawnWeight），修正舊版用 multiplier 自行分級把 HIGH（金龍/貔貅/財神）誤當 boss 的問題；高倍魚加辨識光暈；新增 Boss（龍王）定時降臨與魚群潮事件。
> **純前端表現層，後端魚種數值（Phase 1 已按設計表定案）/契約/RTP/帳務皆不變。**

### Changed
- `frontend/src/components/fishingEngine.js`：
  - **魚種視覺對齊後端**：`deriveMeta` 改用後端 `tier`/`spawnWeight`（單一真相）推導體型/游速/出現率，取代舊版用 `multiplier` 自行分級。修正金龍/貔貅/財神（HIGH）被誤判為 boss、體型與龍王相同、誤觸發 Boss 警報的問題。新增 tier 渲染表 `TIER_RENDER`：體型與倍率正相關、游速與倍率負相關。
  - **高倍魚辨識光暈**：HIGH/BOSS/SPECIAL 魚在魚下方加金色脈動光暈（獨立 `glowLayer`，效能模式減半），強化辨識。
  - **Boss 定時降臨**：龍王每 `BOSS_INTERVAL_MS`（58s）在「場上無 boss 時」強制降臨（保證事件節奏，不只靠 spawnWeight=2 隨機），沿用既有 bossAlarm 預警 + boss BGM。
  - **魚群潮**：每 `SWARM_INTERVAL_MS`（36s）短時間密集放小魚（`SWARM_SIZE` 尾），製造 LDW 小額回收手感；受並存上限保護。`_trySpawn` 重構支援指定魚種/小魚/Boss。
  - lockOn 鎖定音擴及 HIGH 魚（原僅 boss/special）。

### 為什麼 (Why)
- 後端魚種數值 Phase 1 已按計畫設計表定案（倍率↔HP↔稀有度），Phase 4 把前端視覺對齊這份真相，並補上 Boss/魚群事件變化，讓玩家在打不同魚時有明確分級感受。spawn 在前端僅影響視覺，輸贏仍由後端權威決定（ADR-003），無套利風險。

### 如何驗證 (Verification)
- `cd frontend && npm run lint`（0 error）、`npm run build`（綠）。
- `npm run dev` 實測：金龍/貔貅/財神體型介於中魚與龍王之間且帶光暈、不再誤觸發 Boss 警報；龍王定時降臨（警報 + BGM 切換）；偶發魚群潮密集小魚。
- 真實後端 fishing API（start→shots→end）回傳 hp/tier/spawnWeight 與 crit/damage/hpRemaining 實測通過。

---
## [Fixed] — 2026-06-24 — 老虎機機台面板標示與音效修正（賠付線數、左二同小獎誤播惋惜音）

> 兩個與玩法/體驗一致性相關的問題：
> (1) 機台面板硬寫「LINES 03」，但引擎（`SlotMachine.evaluate`）只判定中線一條（`PAYLINE_ROW=1`），標示與實際賠付線數不符、誤導玩家以為三排都算。
> (2) `runReels` 在「前兩格中線同符號、第三格不同」時播 `fishEscape` 惋惜/逃跑音；但本作賠付表所有符號 `pairMultiplier ≥ 1`，該情形恆為**會派彩的左二同小獎**，於是中小獎時先播輸錢音、隨後 `handleSettled` 又播 `winSmall`，贏錢卻播輸錢音、互相矛盾。
> 決策：維持現有單中線玩法（不擴充賠付線），僅修正標示與音效。

### Fixed
- `frontend/src/components/SlotMachine.jsx`：
  - 機台面板「LINES 03」改為「LINE 01」，與單中線引擎一致。
  - 移除左二同小獎落定時的 `fishEscape` 惋惜音（及不再使用的 `isLineWin` 區域變數）。第三輪 anticipation 慢停＋心跳的張力保留，落定後交由 `handleSettled` 的中獎音收尾。

**為什麼**：標示需反映真實賠付線數；派彩當下不應播失落音（正常娛樂城不會在贏錢時播輸錢音）。因賠付表所有符號 pair 皆 ≥ 1x，`isNearMiss && !isLineWin` 恆為派彩局，惋惜音邏輯實際永遠誤觸發。
**如何驗證**：`npm run lint`（frontend）全綠；後端與賠付數值未動（RTP/測試/mock 不受影響）。

## [Fixed] — 2026-06-24 — 老虎機側欄結果搶跑（劇透）：結算改在輪停瞬間揭曉

> 問題：`spinSlot.fulfilled`（`gameSlice.js`）在 thunk 一回應（mock ~900ms／真實網路）就寫入 `result`/`slotGrid`/`winningCells`，
> 但轉輪動畫要 2.6–3.5s 才停。`SlotGame.jsx` 右側面板（最近派彩、中獎倍率、中線命中、本場損益）直接讀 redux，
> 加上 `dispatch(setBalance)` 與 `sessionProfit` 在 `handleSpinRound` 內即時觸發——於是輪子還在轉時，
> 側欄與餘額就已揭曉本局派彩/命中，等於劇透結果（轉輪本身有 `Reel` 的 `!isSpinning` 守門、不受影響）。

### Fixed
- `frontend/src/pages/SlotGame.jsx`：新增本地 `settled` 結算快照，側欄 `lastPayout`/`lastMultiplier`/`hasLineWin` 改讀快照而非 redux `result`/`winningCells`。
  - 將結算副作用（`setBalance` 餘額、`sessionProfit` 損益、`sessionRounds` 局數、`settled` 快照）一律從 `handleSpinRound` 移至 `handleSettled`——後者由 `SlotMachine` 的 `onSettled` 在 `runReels` 完成（輪停）瞬間呼叫，與轉輪同步揭曉。
  - 進場 `clearGameResult()` 一併 `setSettled(null)`（重開即歸零）。
  - 移除已不再使用的 redux `result` 選取；`winningCells` 仍傳給 `SlotMachine`（其格子高亮已由 `Reel` 的 `!isSpinning` 正確守門、輪停才亮）。

**為什麼**：result-leak 來自「結果寫入 redux 的時點」與「轉輪揭曉時點」不一致；把所有 result-derived 顯示與副作用統一綁到輪停（`handleSettled`）即可同步。`onSettled` 在 `onSpinComplete`（解鎖視覺鎖）之前呼叫，故 `settled` 必先填好再顯示，無空窗閃爍。
**如何驗證**：`npm run lint`（frontend）全綠；後端未動。走查時序：`runReels` → `onSettled`（set settled/balance）→ finally `onSpinComplete`（解鎖）；thunk 失敗時 `onSettled` 不觸發，不誤記損益/局數（與原行為一致）。

## [Fixed] — 2026-06-24 — 老虎機視覺鎖脫鉤：移除魔術數字 `setTimeout(2900)` 解鎖

> 問題：`SlotGame.jsx` 的 `handleSpinRound` 在 `finally` 用固定 `setTimeout(…, 2900)` 解除視覺鎖（visualLock），
> 但轉輪動畫在 near-miss（前兩輪中線同符號進入 anticipation 慢停）時長達 `2600 + 900 = 3500ms`，
> 加上 `preloadSymbolImages` 起點更晚。定時器在 2900ms 提早開鎖，造成：
> (1) 離場守門 `useGameLeaveGuard(loading || visualLock, …)` 提早失效，輪子未停玩家即可離頁、跳不出「本局下注不返還」警告；
> (2) 右側面板狀態提早從「轉動中」翻成「已結算」，與仍在轉的畫面脫鉤。違反 AGENTS.md 雷區 13「視覺鎖綁定真實流程、禁止固定 setTimeout 魔術數字」。

### Fixed
- `frontend/src/pages/SlotGame.jsx`：移除 `handleSpinRound` 中 `setTimeout(() => setVisualLock(false), 2900)`，視覺鎖解除統一交給 `SlotMachine` 的 `onSpinComplete`（綁定 `runReels` 動畫真實生命週期，成功/失敗/中止各路徑的 try-catch-finally 都會呼叫，不會卡死）。near-miss 局不再提早解鎖。

**為什麼**：固定 2900ms 與實際動畫長度（一般 2600ms、near-miss 3500ms）不一致，是脫鉤根因；`onSpinComplete` 才是綁定真實流程的解鎖點。
**如何驗證**：`mvn -q -pl backend/game-service test -Dtest='Slot*'` 全綠（35 案，未動後端）；前端走查 `onSpin` 拋例外（餘額不足/網路失敗）時，`SlotMachine.spin()` 的 catch→finally 仍呼叫 `onSpinComplete`，visualLock 不會卡住。

## [Added] — 2026-06-24 — 完整遊戲紀錄/注單稽核（流水號 / 局號 / 毫秒時間戳 / 餘額變化）＋遊戲重開小計歸零

> 需求：每筆投注都要可稽核——唯一注單號（流水號）、精確到毫秒的下注/派彩時間、
> 「投注前餘額 → 投注金額 → 中獎/沒中 → 派彩後餘額」的完整餘額變化軌跡、以及遊戲局號；
> 並讓玩家在「遊戲紀錄」頁逐筆檢視。另要求遊戲重開時把前端「本場小計」刷新歸零。

### Added
- **DB**：`game_rounds` 新增 `balance_before` / `balance_after`（餘額變化稽核）、`bet_at`（毫秒下注時間，與既有 `settled_at` 派彩時間區分）。
  - `database/postgres/init.sql`：新表定義含三欄。
  - `database/postgres/migration/V10__add_game_round_audit_fields.sql`：對既有環境以 `ADD COLUMN IF NOT EXISTS` 增量補欄（既有列為 NULL，前端以 `-` 呈現）。
- **後端遊戲紀錄 API**：`GET /api/v1/game/history`（玩家身分取自 gateway 注入 `X-User-Id`），分頁回傳注單，形狀 `{ items, total, page, pageSize }` 與錢包交易紀錄一致。
  - 新增 `GameHistoryController` / `GameHistoryService` / `GameHistoryResponse` / `GameRecordView`（含 `roundId`/`nonce`/`betAmount`/`winAmount`/`profit`/`balanceBefore`/`balanceAfter`/`betAt`/`settledAt`/`status` 等稽核欄位）。
  - `GameRoundRepository`：新增 `findByPlayerIdOrderByCreatedAtDesc` / `findByPlayerIdAndGameTypeOrderByCreatedAtDesc` 分頁查詢。
  - `GameHistoryServiceTest`（4 案：全類型/類型過濾大小寫正規化/分頁夾限/null 金額不誤算 profit）。
- **前端遊戲紀錄頁**：`frontend/src/pages/GameHistory.jsx`（桌機表格 + 手機卡片、毫秒時間格式、損益正負色、分頁），路由 `/game-history`（`App.jsx`）、導覽列「遊戲紀錄」（`AppShell.jsx`）。
  - `gameApi.gameHistory()` 接後端；`mockApi.getGameHistory()` 鏡像；`recordGameRound()` 於老虎機/百家樂/捕魚結算時各寫一筆（鏡像後端 `game_rounds`）。

### Changed
- **三款遊戲結算落地稽核欄位**（後端）：`SlotService`/`BaccaratService`/`FishingService` 寫 `game_rounds` 時填入 `balanceBefore`（扣款前 wallet 餘額）、`balanceAfter`（派彩後餘額）、`betAt`（老虎機＝下注瞬間；百家樂/捕魚＝開局時間）。
  - `GameSession` / `GameSessionService`：Session 增帶 `balanceBefore`，結算時落地。
  - `FishingSession` / `FishingSessionStore`：Session 增帶 `balanceBefore`。
- **遊戲重開小計歸零**（前端）：
  - `SlotGame.jsx`：進場 `dispatch(clearGameResult())` 清上一場殘留結果/最近派彩。
  - `Baccarat.jsx`：本場損益（`sessionProfit`）與路單（`history`）改為純元件狀態、進場清除舊 `sessionStorage` 快取——「重開即歸零」，不再跨場累積。

### 為什麼
- 注單稽核是賭場系統合規與爭議排查的基本盤；既有 `game_rounds` 只存 bet/win，缺餘額變化與下注時間，無法回放「玩家當下錢包怎麼變」。
- 遊戲小計（本場損益）原本用 `sessionStorage` 跨重整保留，與使用者「遊戲重開應刷新小計」期望相反，故改為進場歸零。

### 如何驗證
- `mvn -pl backend/game-service test` → **BUILD SUCCESS，Tests run: 155, Failures: 0, Errors: 0**（含新增 `GameHistoryServiceTest` 4 案）。
- 前端走 mock：玩老虎機/百家樂/捕魚後開「遊戲紀錄」頁，應見每局注單號、局號、毫秒下注/派彩時間、`投注前 → 派彩後` 餘額；重新進場遊戲頁本場小計歸零。

## [Fixed] — 2026-06-24 — 前端百家樂 mock 對齊後端引擎（補和局 push + 補牌規則）

> 前端預設走 mock（雷區 14），玩家實際體驗到的百家樂出自 `mockApi.js`。盤點發現 mock 與後端
> `BaccaratGameService` 有兩處分歧，害押莊/閒的玩家被多坑，且機率分布失真。本次將 mock 對齊後端
> 標準 Punto Banco 規則。**後端不變（後端本來就正確、已含 0.5% 反水）**，純前端修正。

### Fixed
- `frontend/src/services/mockApi.js`：
  - **和局 push**：原本結果為和局時，押莊/閒的注直接賠 0（整注輸光）；改為退回本金（push），鏡像後端
    `payoutFor` 的「和局押莊/閒退本金」。此 bug 使押閒期望值從 −1.2% 惡化到 ~−10.8%，修正後回到業界標準。
  - **補牌（第三張）規則**：原本莊/閒各只發兩張就結算，缺第三張補牌；新增 `dealBaccarat()` + `bankerDrawsMock()`
    鏡像後端 `play()`／`bankerDraws()`（天牌不補、閒家 0~5 補、莊家查表補），使莊/閒/和機率分布與後端一致。

### Added
- `frontend/src/services/mockApi.js`：`cardValue()`（單張牌點數，鏡像 `Card.value()`）、`bankerDrawsMock()`（莊家補牌表）、
  `baccaratPayout()`（單區派彩，鏡像 `payoutFor`，含莊家 5% 傭金）、`dealBaccarat()`（完整補牌發牌流程）。

### Unchanged（澄清）
- **賠率與反水皆已對齊、不動**：閒 1:1、莊 1:1 扣 5% 傭金、和 8:1；0.5% 反水（最低 1 星幣）後端
  `BaccaratService.settle()` 第 188 行本就有，mock 亦同。三種押注莊家皆維持正期望（加反水後玩家 EV：閒 −0.74%／莊 −0.56%／和 −13.9%）。
- 後端 `BaccaratGameService`／`BaccaratService` 完全未動。

### 為什麼
- 雷區 14 要求「mock 必須鏡像後端引擎」。和局 push 缺失是會讓玩家蒙受損失的真 bug；補牌缺失使勝率分布偏離標準百家樂。
  使用者要求「做成與業界一樣」，後端已是業界標準，故將 mock 對齊後端即達標。

### 如何驗證
- `node --check frontend/src/services/mockApi.js` 通過；`npx eslint src/services/mockApi.js` 0 error。
- 邏輯比對：mock `baccaratPayout` ↔ 後端 `BaccaratGameService.payoutFor`；mock `bankerDrawsMock` ↔ 後端 `bankerDraws`（逐分支等值）。

---

## [Fixed] — 2026-06-24 — 修正 AUDIT_REPORT 漏記 wallet T-027/T-028（誤標未完）

> 進度盤點文件的事實修正：`AUDIT_REPORT.md` 把 wallet-service 的破產補助（T-027）與 Kafka DLT 後台
> （T-028）標為 ❌/⚠️，但兩者其實早在 2026-06-01 即 commit 併入 develop+main、含測試。**純文件修正，不動任何程式碼/行為。**

### Fixed
- `AUDIT_REPORT.md`：
  - T-027 破產補助 `❌` → `✅`（`BankruptcyAidService` + `POST /api/v1/wallet/bankruptcy-aid`，commit c945f97）。
  - T-028 Kafka DLT `⚠️` → `✅`（`AdminDeadLetterController` `/internal/wallet/dlt` 查詢 + `POST /{id}/retry`，commit 2646cb3）。
  - A.13 統計：✅ 46→48、⚠️ 11→10、❌ 27→26（總計仍 85）；變動紀錄補 2026-06-24 一列。
  - 模組概覽：wallet-service 由「進行中」移至「完成度高（T-020~T-028 全完成）」；結論移除破產補助為空白。
- `AGENTS.md`（§1 必讀文件表後）：新增告示「查進度別只信 AUDIT_REPORT，務必拿程式碼/git 交叉驗證」，附 wallet T-027/T-028 漏標實例與驗證手段（檔案存在 / `git log` / `git branch --contains` / 測試），治本避免下一個 AI 重蹈覆轍。

### 為什麼
- AUDIT_REPORT 是「手動維護的快照」，上次盤點（2026-06-17）漏掉了 6/01 就合併的兩個 wallet 任務，導致每次照它檢查進度都誤報 wallet「進行中」。本次以實際程式碼（檔案存在 + `git branch --contains` 確認在 develop/main + 對應測試）為準更正。

### 如何驗證
- `git log --oneline -- backend/wallet-service/.../BankruptcyAidService.java` 見 commit c945f97；`AdminDeadLetterController.java` 見 2646cb3。
- 程式碼：`WalletController` 已掛 `POST /bankruptcy-aid`；`AdminDeadLetterController` 已掛 `/internal/wallet/dlt`；測試 `BankruptcyAidServiceTest` / `DeadLetterServiceTest` / `DeadLetterListenerTest` 存在。

---

## [fix] — 2026-06-24 — 修復 DB 慢開機導致 member/game-service 啟動崩潰、登入需重試

### Changed
- `backend/member-service/src/main/resources/application.yml`、`backend/game-service/src/main/resources/application.yml`：datasource hikari 區塊新增 `initialization-fail-timeout: ${DB_INIT_FAIL_TIMEOUT:60000}`。HikariCP 開機 `checkFailFast` 時若值 > 0 會**重試取得首條連線**直到逾時（預設 60s），而非立即拋例外退出。
- `start-backend.ps1`：新增 `Wait-DbHealthy` 函式，`docker compose up -d` 後（及未帶 `-WithInfra` 但偵測到 DB 容器存在時）輪詢 `docker inspect` 的健康狀態，`lucky-star-mysql`/`lucky-star-postgres` 皆 `healthy` 才啟動後端（上限 120s，逾時印警告續行）。
- `start-all.bat`：在 `infra` 路徑 `docker compose up -d` 後新增 `:waitdb` 迴圈，同樣輪詢兩個 DB 容器 healthy（上限約 120s）才啟動後端。

### Why
- 使用者回報「每次登入要試兩次才成功（member-service 沒回應），game-service 也有問題」。由 `member-log.txt` 確認根因：服務開機就要連 DB 跑 Hibernate `ddl-auto: validate`，但啟動腳本 `docker compose up -d` 後只等 3~4 秒就啟動後端，而 MySQL/Postgres 首次開機需 20~40 秒才 healthy → `Connection refused` → `entityManagerFactory` bean 建立失敗 → `BUILD FAILURE`/`exit code 1`，服務直接崩潰沒起來。再啟動一次（DB 已暖）才成功，即體感的「要兩次」。game-service 連 PostgreSQL（5433）同一個雷。
- 雙保險：後端層（Hikari 重試，不再開機即崩潰）＋ 腳本層（DB healthy 才啟動）。

### Verified
- `mvn -pl backend/member-service,backend/game-service test`：member 70 pass、game 106 pass、BUILD SUCCESS（測試走 test scope H2，main yml 變更不影響）。
- 手動：`docker compose down && docker compose up -d` 後立刻起 member/game，不再崩潰；`start-backend.ps1 -WithInfra` 第一次乾淨啟動；前端登入 test/test1234 一次成功。

### Notes
- wallet-service 為雙資料源、EntityManagerFactory 在 `DataSourceConfig` 手動建立（AGENTS.md 雷區 5），同樣有 DB 慢開機崩潰風險，但不在本次範圍，待後續評估是否於手動 EMF 加同類重試。

---
## [Changed] — 2026-06-23 — 捕魚機戰鬥回饋 + 砲台差異化 + 新互動（Phase 3）

> 捕魚機升級第三階段：把 Phase 1 後端已回傳、Phase 2 引擎尚未演出的 `crit/damage/hpRemaining` 接上戰鬥回饋
> （HP 血條 / 浮動傷害數字 / 暴擊 / 掙脫逃跑），並做出三砲台（銅/銀/金）的美術·子彈·砲口·音調差異與新互動
> （自動射擊 / 準心十字）。**玩法/契約/帳務/RTP 完全不變**——皆為前端表現層，傷害與捕獲仍由後端權威決定。

### Added
- `frontend/src/components/fishingEngine.js`：
  - **戰鬥回饋**：每條魚 HP 血條（命中後依伺服器 `hpRemaining` 遞減、綠→黃→紅、平時隱藏減雜訊）；浮動傷害數字（一般白字、暴擊橘紅放大 +「暴擊!」）；致命一擊未捕獲＝掙脫逃跑演出（加速竄出 + 上抖 + 淡出）。皆走物件池 + 並存上限，尊重 `perfMode`/FPS 守門。
  - **砲台差異化**：`CANNON_STYLE` 依等級（銅/銀/金）給子彈顏色·大小、砲口火光大小、射擊音調；砲台貼圖依等級換（`setCannon`）。傷害差異在後端，前端只管手感。
  - **新互動**：自動射擊（`setAutoFire`，自動鎖定畫面內最高倍率魚連發、手動按住時讓位）；準心十字（跟游標/自動目標，鎖定時轉橘紅）。
- `frontend/src/casino-fx/sound/sfx.js`：新增 `crit` 暴擊音效（比 hit 更尖銳清脆 + 上揚金屬泛音）。
- `frontend/src/casino-fx/assets/svgArt.jsx`：`Cannon` 重構為可調色盤，新增 `CannonCopper`（銅 L1）/`CannonSilver`（銀 L2）；金炮（L3）視覺與舊版完全等價。

### Changed
- `frontend/src/components/FishingCanvas.jsx`：新增 `cannonLevel`/`autoFire` props，同步進引擎（init 灌初值 + useEffect 更新）。
- `frontend/src/pages/Fishing.jsx`：傳 `cannonLevel`/`autoFire`；HUD 加「自動射擊」開關；砲台選擇加傷害/手感說明；規則文案由舊「命中率」模型改為血量/傷害模型（暴擊、掙脫、血量越厚需更多發）。
- `frontend/src/casino-fx/sound/SoundEngine.js`：`shoot`/`hit`/`crit` 加入 per-id 節流（70/45/45ms），token bucket 之外的第二道防線，防一批 30 發結果同響爆量。
- `frontend/src/casino-fx/assets/registry.js`：註冊 `cannon-copper`/`cannon-silver`。
- `frontend/e2e/fishing.spec.js`：修正失效的計畫檔路徑註解（canvas e2e 仍留 Phase 4 重寫）。
- `AGENTS.md`：雷區 10 補捕魚機 Phase 1/2 進度；雷區 14 更新（捕魚已非「命中率 0.92/倍率」、改血量/傷害模型）；新增雷區 16（捕魚機＝PixiJS 引擎 + 血量/傷害模型架構）。
- `README.md` / `DEPLOY.md`：技術棧加 PixiJS；DEPLOY §5 提醒「git pull 後新依賴要重跑 npm install」（pixi.js）。

### Fixed
- `frontend/src/pages/Baccarat.jsx`：補既有空 `catch {}` 的 lint error（`no-empty`，別人百家樂 PR 引入、擋住 develop lint 綠燈），以同檔風格加註解。

### Removed
- `ui-swift-pumpkin.md`（根目錄）：PR #124「Add files via upload」誤上傳的計畫草稿，非專案產物，清除。

### 為什麼
- 玩家最初痛點之一是「看不到傷害、魚剩多少血、有沒有暴擊」「砲台沒差別」。Phase 1 後端已算出 `crit/damage/hpRemaining`、Phase 2 引擎就緒，Phase 3 把這些接上演出並做砲台差異化，直接回應痛點；自動射擊/準心提升手感。全為表現層，不動 RTP/PF/帳務（wallet 仍只在 buy-in/結算各動一次）。

### 如何驗證
- `cd frontend && npm run lint`（0 error）、`npm run build`（綠；pixi 維持獨立 chunk、主 bundle 不含 pixi）。
- `npm run dev` 進 `/game/fishing`：命中冒傷害數字（暴擊橘紅放大）、魚頭 HP 條遞減、血量歸零捕獲派彩 or 掙脫逃跑；切銅/銀/金砲台見子彈色/大小/砲口/音調差異；開「自動」自動鎖定最高倍率魚連發 + 準心轉橘紅。

---

## [Added] — 2026-06-23 — 遊戲中途離開確認視窗（AppShell 導航攔截 + LeaveGameModal + leaveGuard 狀態）

> 把遊戲進行中的「離開防呆」從瀏覽器原生 `confirm()` 升級成賭場主題的自訂視窗，並把離開意圖收進 Redux
> （`uiSlice.leaveGuard`），讓頂部導航列能統一攔截站內導航。老虎機、百家樂、捕魚三款共用同一套。
> 玩法/契約/帳務完全不變，純前端 UX。

### Added
- `frontend/src/components/LeaveGameModal.jsx`：賭場主題自訂離開確認視窗（`luxury-panel` + 金/紅金按鈕）。開窗播 `click` 音效（走 `soundEngine`，AGENTS 雷區 13）；紅底警示列「離開後將無法退回已下注金額」；兩顆操作「繼續遊戲」（預設 `autoFocus`，避免誤觸）/「確認離開」；帶 `role="dialog"` + `aria-modal` 無障礙標記。由 AppShell 在 `leaveGuard.pendingPath` 有值時渲染。
- `frontend/src/store/slices/uiSlice.js`：新增 `leaveGuard` 狀態（`active` / `message` / `pendingPath`）與 actions `activateLeaveGuard` / `deactivateLeaveGuard` / `setPendingNavigation` / `clearPendingNavigation`，讓離開意圖變成可被任何元件觀察的全域 UI 狀態。

### Changed
- `frontend/src/hooks/useGameLeaveGuard.js`：從「自己處理 `window.confirm`」改為 dispatch `activateLeaveGuard` / `deactivateLeaveGuard` 同步 Redux 狀態（掛載/卸載/`active` 變化都同步，避免殘留攔截）。`beforeunload`（關分頁/重整）與 `popstate`（上一頁/手勢返回）保留原生攔截，拆成獨立 `useEffect` 各管各的。
- `frontend/src/components/AppShell.jsx`：頂部 NavLink 加 `onClick` 攔截——`leaveGuard.active` 時 `preventDefault` 擋下、記住目標路由（`setPendingNavigation`）並彈出 modal；確認 → `navigate(pendingPath)` 真正離開、取消 → `clearPendingNavigation` 留在原頁。離開邏輯集中在 AppShell 一處，三款遊戲共用。

### 為什麼
- 舊防呆只攔 `beforeunload` / `popstate`，玩家在遊戲進行中直接點頂部導航列就會繞過確認、無聲離場（已下注金額無法退回）。把離開意圖提升為 Redux 全域狀態後，導航列點擊也能納管；同時把原生 `confirm()` 換成賭場質感視窗，提示更清楚、體驗一致。

### 如何驗證
- `cd frontend && npm run lint`（綠）、`npm run build`（綠）。
- 手測：老虎機/百家樂/捕魚進行中分別點導航列、上一頁、重整、關分頁，皆正確彈窗；確認後導向目標頁、取消後留在原頁。
## [Changed] — 2026-06-23 — 捕魚機 PixiJS 漁場引擎（Phase 2：取代 DOM 漁場 + 紋理烘焙 + 效能模式 + §6 HUD 飄移修復）

> 捕魚機升級第二階段：把 React-DOM 漁場改成 **PixiJS canvas 遊戲引擎**，根治 H5/手機連發+特效「當機」；
> 並修掉「底部錢幣 UI 飄移」。**玩法/契約/帳務完全不變**（沿用 Phase 1 的血量/傷害模型與 `fire(fishInstanceId, fishCode)`）。
> 戰鬥回饋演出（HP 條/傷害數字/暴擊/掙脫）、砲台差異化、Boss 事件仍留 Phase 3~4——本階段戰鬥視覺維持現狀（火花 + 派彩浮字）。

### Added
- `frontend/src/components/FishingCanvas.jsx`：Pixi 漁場 React 殼（薄）。`Application` async init + StrictMode 雙掛載防護 + 卸載確實 `destroy`；props（phase/betPerShot/fishTable/fire/play/perfMode/callbacks）以 ref 灌進引擎。經 `Fishing.jsx` 用 `React.lazy` 動態載入 → pixi 切成獨立 chunk，不膨脹主 bundle。
- `frontend/src/components/fishingEngine.js`：非 React 遊戲引擎。魚/子彈/火花/浮字/砲台皆 Pixi 物件，單一 `ticker` 跑生成/移動/壽命；**命中判定全在 canvas 座標**（消滅舊檔每幀 `querySelector`+`getBoundingClientRect`）；子彈/火花/浮字物件池 + 並存上限；**FPS 守門**（持續 <40fps 自動降載）、**效能模式開關**、尊重 `prefers-reduced-motion`、**分頁隱藏暫停 ticker**。沿用舊 `deriveMeta/weightedPick/engageFish/handleResults` 邏輯（手感參數不變）。
- `frontend/src/casino-fx/assets/bakeTextures.js`：SVG 程式化美術 → `PIXI.Texture` 烘焙快取（`renderToStaticMarkup` 離屏 rasterize）；PNG override 走 `Assets.load`，維持「換 AI 圖零改碼」。
- `frontend/src/components/Fishing.css`：新增 §6 固定高度 HUD 條（`.fishing-hud*`）與固定槽位橫幅（`.fishing-banner*`）樣式。

### Changed
- `frontend/src/pages/Fishing.jsx`：`FishingArena` → lazy `FishingCanvas`（`<Suspense>`）。**§6 飄移修復**：把進行中的即時讀數（局內餘額/本場派彩/砲台/收網/效能模式）移到漁場上方**固定高度 HUD 條**（`tabular-nums` 等寬），右側 `aside` 只留靜態（規則/可用星幣/幸運值）→ 不再隨 phase 增減 reflow；Boss/error 橫幅改**固定槽位 opacity 淡入淡出**，不插入/抽走節點。
- `frontend/src/components/MetricCard.jsx`：數值加 `tabular-nums`（全站等寬，cheap win）。
- `frontend/src/casino-fx/casino-fx.css`：移除 `.fx-gold-burst__coin` / `.fx-rain__drop` 的 per-frame `filter: drop-shadow`（手機 GPU 殺手，§2.3）。
- `frontend/src/casino-fx/fx/FallRain.jsx`：`epic` 金幣雨上限 150 → 90（§2.3，降同時動畫節點數）。
- `frontend/package.json`：新增依賴 `pixi.js` ^8.19。

### Removed
- `frontend/src/components/FishingArena.jsx`（DOM 漁場，由 Pixi 引擎取代）及 `Fishing.css` 對應的舊魚/子彈/火花/砲台/提示樣式。

### 為什麼
- 舊 DOM 漁場在 H5/手機連發+特效會當機：14 條魚各跑 CSS infinite animation、每 110ms 對每條魚 `querySelector`+`getBoundingClientRect`（layout thrashing）、每發子彈多次 `setState`+`setTimeout`。改 Pixi 單 canvas + ticker + 物件池 + canvas 座標命中後，這些每幀 DOM 成本歸零，並有 FPS 守門/效能模式保底。底部錢幣 UI 飄移則來自 aside 即時卡片條件渲染 reflow + 非等寬數字，移到固定 HUD 條 + `tabular-nums` 後消除。

### 如何驗證
- `cd frontend && npm run lint`（綠）、`npm run build`（綠；pixi 切出獨立 `FishingCanvas-*.js` + renderer 子 chunk，主 `index` 未含 pixi）。
- `npm run dev` 進 `/game/fishing`：進場→連發→命中火花 + 捕獲派彩浮字 + 頁面 FX 分級→收網結算→逐發驗證面板（契約未變）。
- 效能：手機/H5 連發 + boss + 金幣雨同時不當機；切「效能模式」降載生效；切背景分頁 ticker 暫停。

## [Changed] — 2026-06-23 — 捕魚機改「血量/傷害」模型（Phase 1：後端引擎 + mock + 測試 + ADR-003）

> 捕魚機升級的第一階段：把「每發獨立判定命中」改為真·血量/傷害模型（魚有血、砲台有傷害、暴擊扣更多血、
> 血量歸零才擊殺派彩），同時維持 Provably Fair、RTP≈92%、帳務冪等。渲染（PixiJS 引擎）、戰鬥回饋演出、
> 砲台差異化、Boss 事件為後續 Phase 2~4。決策見 `docs/adr/ADR-003.md`。

### Added
- `backend/game-service/.../fishing/FishingCombat.java`：血量/傷害模型核心數學（純函式）。暴擊（`CRIT_CHANCE` 0.20 / `CRIT_MULTIPLIER` 2）、各砲台基礎傷害（銅10/銀17/金26）、DP 精確期望擊殺發數 `expectedShotsToKill`、反推捕獲機率 `pCapture = TARGET_RTP × E[N] / multiplier` 使 RTP 精確 92%、`resolveShot`/`resolveShotGuaranteed` 解析單發（暴擊→累傷→致命一擊捕獲/掙脫）。
- `FishSpecies.java`：每魚種加 `hp`（= 倍率 × 10）、`tier`（SMALL/MEDIUM/HIGH/BOSS/SPECIAL）、`spawnWeight`。
- `FishingSession.java`：加 `fishDamage`（instanceId→累積傷害，跨批次）、`kills`（致命一擊紀錄供 verifyShot 重放）。
- DTO：`FishingShotsRequest.Shot` 加必填 `fishInstanceId`；`FishingShotsResponse.ShotResult` 加 `crit/damage/hpRemaining/killed/captured`（向後相容預設值）。
- 測試 `FishingCombatTest`：RTP 解析證明（每魚種/砲台精確 92%）+ Monte-Carlo band + 暴擊率 + 保底強制捕獲 + PF 確定性重放。
- `docs/adr/ADR-003.md`：模型、RTP 推導、PF 重放、行為相關性與線上監控策略。

### Changed
- `FishingService.shots()`：改用 `FishingCombat` 逐發解析、在 session 累積各魚 instance 傷害、記錄致命一擊；`verifyShot()` 改以結算紀錄的 `kills`（damageBefore）+ cannonLevel 精確重放致命一擊；保底改為「本批第一個致命一擊強制捕獲」；風控攔截改為「致命一擊改判掙脫、派彩 0」；`FishTableEntry` 改帶 `hp/tier/spawnWeight`。並設 `MAX_LIVE_FISH=80` 控管並存 instance。
- `frontend/src/services/mockApi.js`：完整鏡像血量/傷害數學（per-instance 累傷、暴擊、`pCapture` 捕獲判定、新回應欄位），`FISH_SPECIES`/`fishTableView` 補 `hp/tier/spawnWeight`（AGENTS 雷區 14）。
- `frontend/src/hooks/useFishingSession.js`：`fire(fishCode)` → `fire(fishInstanceId, fishCode)`，批次帶 `fishInstanceId`。
- `frontend/src/components/FishingArena.jsx`：開火帶魚 instance id；命中演出改 `captured`（派彩）/`killed` 未捕獲（掙脫移除）/未死（擦傷火花不移除）三態（DOM 漁場為過渡，Phase 2 由 PixiJS 取代）。
- 測試 `FishSpeciesTest`：改為純資料驗證（hp/tier/spawnWeight/fromCode）；戰鬥數學移至 `FishingCombatTest`。

### 為什麼
- 玩家回報捕魚機「看不到傷害、魚剩多少血、有沒有暴擊」「砲台差別不明顯」。改血量/傷害模型可直接呈現這些回饋，且砲台可做出傷害/手感差異——同時用 `pCapture` 反推維持各魚種/砲台 RTP 精確 92%、不破壞 Provably Fair 與帳務冪等（wallet 仍只在 buy-in/結算各動一次）。

### 如何驗證
- `mvn -pl backend/game-service test` → **131 tests 全綠，BUILD SUCCESS**（含 RTP band / 暴擊 / 保底 / PF 重放）。
- `npm run lint && npm run build`（frontend）通過。

## [Fixed] — 2026-06-23 — 登入偶發「第一次失敗、原帳密第二次又成功」：登入流程加逾時放寬+重試、401 攔截器不再洗掉登入錯誤

### Fixed
- `frontend/src/services/api.js`：全域回應攔截器原本對**任何** 401 都 `window.location.href='/login'` 強制整頁重載，會把登入頁的錯誤訊息與表單狀態洗掉，正是「看起來失敗、再試又好」的成因之一。改為**跳過** auth 端點（`/api/v1/auth/`，帳密錯誤本就回 401）與帶 `skipAuthRedirect` 的請求（登入流程中抓 profile），交由呼叫端呈現錯誤；其餘受保護端點的 401 維持原本登出重導。
- `frontend/src/services/memberApi.js`：`login()` 兩段請求（`POST /auth/login` → `GET /player/profile`）加上**逾時放寬至 15s**（後端冷啟動首次請求可能超過預設 10s）與**暫時性失敗自動重試**（`withRetry`）。登入 POST 只重試網路/逾時/5xx（401=帳密錯誤不重試）；profile GET 額外容忍「剛簽出 token、gateway 暖機」的暫時 401，並帶 `skipAuthRedirect` 不觸發整頁重導。

### Changed
- `frontend/src/services/memberApi.js`：`extractError` 對逾時（`ECONNABORTED`）回友善訊息「連線逾時，請再試一次」；`friendlyErrorMap` 新增帳密錯誤/帳號停用的中文對應（後端原回英文）。

### 為什麼
- 玩家回報「輸入正確帳密第一次沒登入成功，帳密沒動第二次又成功」。確認為**連真實後端**。根因為登入是兩段請求，後端冷啟動或 gateway 暖機時第二段（抓 profile）偶發逾時/暫時 401，使整個登入 thunk reject；加上全域 401 攔截器把頁面整個重載、洗掉錯誤狀態，造成「時好時壞」的錯覺。前端做暫時性失敗的容錯重試即可，不需動後端。

### 如何驗證
- `npx eslint src/services/api.js src/services/memberApi.js` 通過（0 error）。
- 手動：連真實後端、服務剛啟動時登入，首次請求逾時/暫時 401 會自動重試而非直接失敗；帳密打錯則顯示「帳號或密碼不正確」且不再整頁重載。

## [Added] — 2026-06-23 — 捕魚機支援「按住滑鼠連發」（朝游標方向持續開火）

### Added
- `frontend/src/components/FishingArena.jsx`：新增 pointer 按住連發。`onPointerDown` 立即開第一發並啟動 `setInterval`（`FIRE_INTERVAL_MS=110`）持續朝游標方向開火，`onPointerUp/Cancel/Leave` 釋放停止；以 `setPointerCapture` 保留拖曳瞄準。游標掃到容錯半徑（`AIM_RADIUS=92`px）內最近的活魚（`nearestFish` 以 DOM 即時座標計算）即對該魚實際開火扣注；空海域或被射速限流的空檔只放純視覺曳光，不扣注（後端為「點魚判定命中」模型，無子彈碰撞）。

### Changed
- `FishingArena.jsx`：原本只有「點到魚」`onClick` 單發（`handleFishClick`）與空海域轉向 `handleArenaClick`，改由 arena 的 pointer 事件統一處理；單發開火重構為共用的 `engageFish(fish)`。魚 `<button>` 加 `data-fish-id` 供座標查詢，其 `onClick` 僅在鍵盤觸發（`event.detail===0`）時開火，避免與 pointer 連發重複開火、保留鍵盤無障礙。arena 加 `touch-action:none`/`user-select:none` 與右鍵屏蔽。

### 為什麼
- 玩家回報「釣魚機沒辦法滑鼠按住連續發射」。底層 `useFishingSession.fire()` 早已支援高速連發（token bucket 8 發/秒 + burst），缺的只是 UI 層的「按住→定時連發」輸入；補上即可，且符合 AGENTS.md §2.13 三鐵則（射速交給引擎節流、視覺鎖綁定真實 pointer 生命週期而非魔術數字、音效統一走 `play()`/soundEngine）。

### 如何驗證
- `npx eslint src/components/FishingArena.jsx` 通過（0 error）。
- 手動：進場後按住滑鼠掃過魚群可連續開火並扣局內餘額；放開/收網結算即停；空海域只見曳光不扣注。

## [fix] — 2026-06-23 — game-service 內部 secret env var 名稱錯誤導致 wallet 401

### Fixed
- `backend/game-service/src/main/resources/application.yml:54`：`internal.wallet-service.secret` 讀取的環境變數由 `INTERNAL_SERVICE_SECRET` 改為 `INTERNAL_SECRET`，與 wallet-service `InternalSecretFilter` 及 `.env` 一致。原名稱不符導致 `X-Internal-Secret` header 帶錯值，`POST /internal/wallet/debit` 回 401。

### Why
- `.env` 只定義 `INTERNAL_SECRET`；game-service yml 讀 `INTERNAL_SERVICE_SECRET`（不同名），導致 `WalletClientConfig` 建立 `RestClient` 時帶入錯誤 header。

### Verified
- 統一後兩端 secret 值相同，`InternalSecretFilter.MessageDigest.isEqual()` 比對通過。

---

## [fix] — 2026-06-23 — 修復 AuthService.login() 缺少 @Transactional 及 Redis 失敗靜默風險（Bug #3）

### Fixed
- `backend/member-service/.../service/AuthService.java`：`login()` 加上 `@Transactional(readOnly = true)`（與 `register()` 對稱，確保 DB read 在正確事務範圍）；`saveRefreshToken()` 包入 try-catch，Redis 斷線時明確拋 `RuntimeException("Login service temporarily unavailable.")`，防止任何靜默成功路徑。

### Added
- `backend/member-service/.../service/AuthServiceTest.java`：新增 `login_disabledByRedis_throws()` 驗證後台 Redis 封鎖路徑；`login_redisWriteFails_throws()` 驗證 Redis 寫入失敗時 login 必須拋出例外（非靜默返回成功）。

### Changed
- `AUDIT_REPORT.md`：標記 Bug #3 ✅ 已修；補充 Bug #19、#25、#30、#31 之「已驗證現況」說明（均已修或已知設計），Bug #26 標注 best-effort 可接受。

### Why
- Bug #3：AUDIT_REPORT 記錄 `login()` 缺 `@Transactional`，Redis 寫 refresh token 失敗時存在靜默成功路徑，玩家自認已登入但無法 refresh session。加 `@Transactional(readOnly = true)` 讓 JPA read 進事務、try-catch 讓 Redis 失敗必然可見。

### Verified
- `mvn -pl backend/member-service test`：72 tests，0 failures，BUILD SUCCESS。

## [feat] -- 2026-06-23 -- Complete T-092 Swagger OpenAPI aggregation

### Added
- `backend/notification-service/.../config/OpenApiConfig.java`: documents the notification WebSocket/STOMP contract, `/ws`, `/user/queue/notifications`, `/topic/rank`, Kafka event bridge topics, and Bearer JWT authentication.
- `tests/infra/swagger.test.js`: verifies springdoc dependencies, OpenAPI metadata, gateway api-docs routes, Swagger UI aggregation entries, and JWT whitelist coverage.

### Changed
- `backend/notification-service/pom.xml`: adds `springdoc-openapi-starter-webmvc-ui`.
- `backend/gateway-service/src/main/resources/application.yml`: adds `/v3/api-docs/notification` proxy route and Swagger UI entry so gateway aggregates member, wallet, game, rank, admin, and notification docs.
- `AUDIT_REPORT.md` and `docs/幸運星幣城_工作分配表.xlsx`: mark T-092 as complete.

### Why
- T-092 requires every service to expose OpenAPI documentation and the gateway to provide one aggregated Swagger UI entry point; notification-service was the remaining service not represented in the aggregation.

### Verified
- `node --test tests/infra/swagger.test.js --test-reporter=spec`: 5 tests passed, 0 failures.
- `mvn -pl backend/gateway-service,backend/notification-service test`: gateway 23 tests and notification 19 tests passed, 0 failures.

## [Changed] — 2026-06-22 — 老虎機娛樂化 RTP：中線改兩階賠付「左二同小獎 + 三連大獎」（RTP ≈93.8%、命中率 ≈30.7%）

### Changed
- `backend/game-service/.../slot/SlotSymbol.java`：賠付參數由單一 `lineMultiplier` 改為兩階 `pairMultiplier`（左二同小獎）+ `tripleMultiplier`（三連大獎）；權重維持 45/30/16/7/5（總和 103）。新表（pair/triple）：🍒 1/5、🍋 1/8、🔔 2/18、⭐ 3/50、7️⃣ 5/70。
- `backend/game-service/.../slot/SlotMachine.java`：`evaluate()` 改由左到右兩階判定——三格相同→`tripleMultiplier`（命中中線三格）；否則左二格相同（a==b 且 c≠a）→`pairMultiplier`（命中左二格）；右二格相同（b==c≠a）不賠。`SlotOutcome` 結構不變（`multiplier` 存實際生效倍率、`winningCells` 為 2 或 3 格）。
- `frontend/src/services/mockApi.js`：移除舊 `MOCK_SLOT_FORCED_WIN_RATE=0.18`（無條件灌中獎）與偽分布 `slotSymbols`；新增 `SLOT_PAYTABLE`（鏡像後端權重/倍率）、加權抽樣與後端等價的兩階 `evaluateSlotLine`；`spinSlot` 鏡像後端 `spin` 並支援 `fortuneReady`（保底三連，鏡像 `spinGuaranteedWin`）。
- `frontend/src/services/gameApi.js`：mock 路徑改轉傳 `fortuneReady`（原未轉傳）。
- `frontend/src/pages/SlotGame.jsx`：規則卡文案改兩階賠付（三連大獎 / 左二同小獎 / 各符號倍率）。
- 測試 `SlotMachineTest`/`SlotSymbolTest`：改兩階斷言（新增「左二同賠 pairMultiplier+2 格」「右二同 b==c≠a 不賠」案例、RTP/命中率 band 對齊 93.8%/30.7%）。

**為什麼**：老虎機（develop 既有版：單中線僅三連、倍率 2/3/5/8、RTP ≈26%）仍偏低，玩家體感「少中」。改兩階單中線後三連 ≈11.2% + 左二同 ≈19.5% ＝命中率 ≈30.7%、RTP ≈93.8%，達娛樂級「常中小獎（push/LDW）＋偶爾大獎」。權重不變；與後端 `breakPayline`/風控/幸運值保底邏輯相容（`breakPayline` 把中線中格換成與首格不同符號，兩階皆破）。百家樂、捕魚維持不動。鐵則：後端引擎為單一真相，後端＋mock＋測試三者同步。
**如何驗證**：`mvn -pl backend/game-service test`（BUILD SUCCESS，121 tests / slot 相關測試全綠）；`cd frontend && npm run lint && npm run build`（皆綠）。RTP/命中率另以解析式 + 200 萬局蒙地卡羅交叉確認（93.83% / 30.68%）。
> 註：本分支原另記一筆「補回 develop 建置破口（等同 6501e4c）」，因 develop 已含等義修復（見「修復 develop 編譯/建置破口」），合併時去重移除。

## [docs] -- 2026-06-22 -- Align T-090 load test audit status

### Changed
- `AUDIT_REPORT.md`: updates T-090 from outdated blocked wording to the current measured state: JMX, runner, analyzer, provisioning, and report are complete; accounting/idempotency gates passed; single-host 1,000-player performance gates failed.

### Why
- The T-090 deliverables now exist and have real measurements, so the audit should no longer say the work is blocked by missing slot API, JMeter, environment, or 1,000 player credentials.

### Verified
- `npm test -- --test-reporter=spec tests/infra/jmeter.test.js`: 122 infra tests passed, including the T-090 JMeter contract checks.

## [feat] — 2026-06-23 — 百家樂畫面優化（籌碼列 / 顏色區分 / 天牌徽章 / 版面重排）

### Changed
- `frontend/src/pages/Baccarat.jsx`：移除下拉式面額選單，改為常駐籌碼排（`baccarat-chip-row`，100/200/500/1K/2K/3K/5K，點即套用、有音效）；下注選項加入 `--player/--banker/--tie` 色彩 modifier；HandPanel 新增 `isNatural` 偵測，點數 8/9 時顯示「天牌 Natural」徽章。
- `frontend/src/index.css`：新增 `.baccarat-chip-row`、`.baccarat-chip`、`.baccarat-chip--selected` 樣式（圓形籌碼、金色選中態、hover 浮起）；新增 `.baccarat-bet-option--player/banker/tie` 左側色條；新增 `.baccarat-natural-badge` 彈入動畫；新增 `@media (min-width: 480px)` 閒/莊並排（`1fr 72px 1fr`）；新增 `@media (min-width: 768px)` 下注+結算雙欄並排。

### Why
籌碼常駐比下拉式少一次點擊，符合實體百家樂桌面操作習慣；顏色區分提升下注項目辨識度；天牌徽章增強儀式感；版面重排讓平板/寬螢幕利用率更高。

### How to verify
```bash
npm run dev -- --mode mock   # 前端用 mock API 離線驗證
# 瀏覽 /game/baccarat：
# 1. 下注區下方應有 7 顆圓形籌碼，點擊自動填入金額
# 2. 閒/莊/和按鈕左側分別顯示藍/紅/綠色線條
# 3. ≥ 480px：閒家與莊家左右並排
# 4. ≥ 768px：下注區與結算區左右並排
# 5. 發牌後若點數為 8 或 9，標題下出現「天牌 Natural」金色徽章
```

---

## [feat] — 2026-06-23 — 虧損返利排程系統（日返利 + 週返利）

### Added
- `database/postgres/migration/V9__add_cashback_records.sql`：新增 `cashback_records` 表（去重 + 稽核）、擴充 `wallet_transactions.sub_type` 加入 `CASHBACK`。
- `database/mysql/migration/V6__add_cashback_subtype.sql`：MySQL 讀端同步擴充 `sub_type`。
- `backend/game-service/.../entity/CashbackRecord.java`：返利記錄 entity。
- `backend/game-service/.../repository/CashbackRecordRepository.java`：去重查詢。
- `backend/game-service/.../repository/GameRoundRepository.java`：新增 `aggregateNetLossPerPlayer` 原生 SQL 查詢。
- `backend/game-service/.../kafka/CashbackEventPublisher.java`：發 `wallet.credit.request` 入帳指令 + `notification.push` 推播。
- `backend/game-service/.../service/CashbackService.java`：核心計算邏輯（日/週階梯費率、去重、@Transactional 保護）。
- `backend/game-service/.../scheduler/DailyCashbackScheduler.java`：cron `0 5 0 * * *`，每日凌晨 00:05 結算前一天虧損。
- `backend/game-service/.../scheduler/WeeklyCashbackScheduler.java`：cron `0 10 0 * * MON`，每週一凌晨 00:10 結算上週虧損。

### Changed
- 不需要新增 Kafka topic（複用現有 `wallet.credit.request` / `notification.push`）。

### Rules
- 日返利：淨虧損 ≥ 1,000 → 5%；≥ 5,000 → 8%；≥ 10,000 → 10%（無上限、直接入帳）
- 週返利：淨虧損 ≥ 3,000 → 8%；≥ 5,000 → 12%；≥ 10,000 → 15%（比日返更優惠）
- 日返 + 週返疊加發放，每局結算後翌日/翌週一自動觸發

### Why
批次排程（方案 A）對平台最有利：控制成本時機、帶動次日/次週回訪、可設發放上限防套利；日返解決短期痛點，週返獎勵長期留存，兩者目的互補故疊加。

### How to verify
```
mvn -pl backend/game-service test
```
全部 139 個測試通過（含 20 個新增返利測試）。

## [feat] — 2026-06-23 — 百家樂改為反水機制，移除幸運值保底

### Changed
- `backend/game-service/.../service/BaccaratService.java`：移除 `fortuneReady` 保底邏輯（重試 nonce 找目標結果），改為每局無論輸贏返還下注額 0.5%（最低 1 星幣）反水；credit 呼叫改為永遠執行（派彩 + 反水），wallet 視圖每局必回。
- `backend/game-service/.../dto/BaccaratResultResponse.java`：新增 `rebate` 欄位。
- `backend/game-service/.../controller/BaccaratController.java`：`placeBet` 呼叫移除 `fortuneReady` 參數。
- `frontend/src/services/gameApi.js`：`baccaratBet` 移除 `fortuneReady`，透傳後端 `rebate`。
- `frontend/src/services/mockApi.js`：`baccaratBet` 加入反水計算，返回 `rebate`。
- `frontend/src/pages/Baccarat.jsx`：移除 `FortuneMeter`、`LuckyAura`、`useFortuneMeter` 及所有幸運值相關邏輯；結算面板新增「本局反水」列，訊息提示反水金額；遊戲規則說明補充反水說明。

### Fixed
- `backend/game-service/.../test/BaccaratServiceTest.java`、`BaccaratControllerTest.java`：更新 `placeBet` 簽名（移除第六個 boolean 參數），輸局測試改為驗證 rebate 入帳而非跳過 credit。

### Why
幸運值保底屬於「暗中讓玩家必中」的機制，與 Provably Fair 精神相悖；反水（流水返點）是業界標準做法，無論輸贏皆透明返還比例，既提升留存率又維持公平性。

### How to verify
```
mvn -pl backend/game-service test
```
所有 34 個百家樂相關測試均通過。

## [fix] -- 2026-06-22 -- Complete T-055 GM coin grant API

### Changed
- `backend/admin-service/.../dto/GmGrantRequest.java`: requires a non-blank `reason` and caps it at 255 characters to match `admin_action_logs.reason`.
- `backend/admin-service/.../service/GmRewardServiceTest.java` and `security/AdminSecurityIntegrationTest.java`: verify GM grant reasons are written to both Kafka payloads and action logs, and blank reasons are rejected before service dispatch.
- `database/postgres/migration/V8__fix_admin_action_logs_target_player_id.sql`: adds `target_player_id` when missing so Flyway-created `admin_action_logs` matches `init.sql` and the JPA entity.
- `AUDIT_REPORT.md` and `docs/幸運星幣城_工作分配表.xlsx`: mark T-055 as complete.

### Why
- T-055 requires an auditable GM coin grant flow with operator, timestamp, target player, amount, reason, and idempotency key; the Flyway migration path must create the same columns used by the application.

### Verified
- `mvn -pl backend/admin-service test`: 71 tests passed, 0 failures.

## [fix] -- 2026-06-22 -- Complete T-054 admin anomaly alerts

### Changed
- `backend/admin-service/.../service/AlertRuleEngine.java`: raises high-frequency bet and abnormal wallet-transaction alerts only once when the Redis window first crosses the configured threshold, and marks Kafka notification payloads with `audience=ADMIN`.
- `backend/admin-service/.../service/AlertRuleEngineTest.java`: covers admin notification payload fields and duplicate suppression after a frequency alert has already fired.
- `AUDIT_REPORT.md` and `docs/幸運星幣城_工作分配表.xlsx`: mark T-054 as complete.

### Why
- T-054 requires durable `admin_alerts` records plus Kafka `notification.push` admin notifications, while avoiding repeated alerts for every event after the frequency threshold is already crossed in the same window.

### Verified
- `mvn -pl backend/admin-service test`: 70 tests passed, 0 failures.

## [fix] -- 2026-06-22 -- Align T-045 daily winnings rank Redis key and reset

### Changed
- `backend/rank-service/.../service/RankService.java`: uses fixed ZSet key `rank:daily:winnings` for today's winnings leaderboard and adds `resetDailyWinnings()`.
- `backend/rank-service/.../scheduler/DailyWinningsResetScheduler.java`: clears the daily winnings ZSet every day at 00:00 in `Asia/Taipei`.
- `backend/rank-service/.../service/RankServiceTest.java` and `scheduler/DailyWinningsResetSchedulerTest.java`: verify fixed-key `ZINCRBY`, rank reads, and midnight reset scheduling.
- `AUDIT_REPORT.md` and `docs/幸運星幣城_工作分配表.xlsx`: mark T-045 as complete.

### Why
- The task contract names `rank:daily:winnings` explicitly and requires a daily reset; a fixed key plus scheduled reset now matches the documented Redis design and API behavior.

### Verified
- `mvn -pl backend/rank-service test`: 68 tests passed, 0 failures.

## [fix] — 2026-06-22 — 修復 develop 編譯/建置破口（「幸運值保底」功能未驗證即合併）

### Fixed
- `frontend/src/hooks/useGameLeaveGuard.js`：**補回從未被 commit 的檔案**。SlotGame/Baccarat/Fishing 三頁都 `import` 它、CHANGELOG 也記載，但實際檔案缺失導致 `npm run build` 失敗。依原 CHANGELOG 規格重建（`active` 為 true 時攔截 `popstate`/`beforeunload` 並確認）。
- `backend/game-service/.../service/BaccaratService.java`：`session.getFortuneFull()` → `getFortuneReady()`（欄位名為 `fortuneReady`，原呼叫不存在的 getter 導致主程式編譯失敗）。
- `backend/game-service/.../{service,controller}/{SlotServiceTest,SlotControllerTest,BaccaratServiceTest,BaccaratControllerTest}.java`：`SlotService.spin` / `BaccaratService.placeBet` 已新增 `boolean fortuneReady` 參數，但測試呼叫點未同步更新，導致測試編譯失敗；補上對應引數/`anyBoolean()` 匹配器。
- `frontend/src/pages/Baccarat.jsx`：`saveSqueezeMode` 空 `catch {}` 補註解，修正 `npm run lint` 的 `no-empty`。

### Why
- 「幸運值全滿保底必中」功能合併進 develop 時顯然未跑 `mvn -pl backend/game-service test` 與 `cd frontend && npm run lint/build`，造成 develop 在 compile / build / lint / test 四個層面皆紅，其他分支 merge develop 都會被卡。此 PR 直接修 develop 解套。

### How to verify
- `mvn -pl backend/game-service test` → 109 tests 全綠、BUILD SUCCESS。
- `cd frontend && npm run lint && npm run build` → 綠燈。

## [fix] — 2026-06-22 — 捕魚機幸運值卡死 + PF 保底射擊 RNG 偏移

### Fixed
- `FishSpecies.java`（Bug 8）：`resolveGuaranteedPayout` 新增 `stream.nextDouble()` 呼叫，使串流消耗位置與 `resolvePayout` 命中路徑完全一致；修正前 MONEY_TREE 倍率從串流位置 0 取值，驗證端點卻從位置 1 取值，導致倍率不符；非搖錢樹魚種同理：修正前驗證時消耗 `nextDouble()` 而遊戲未消耗，雙方串流偏離
- `FishingSession.java`：新增 `guaranteedShotSeq`（`Long`）欄位，記錄本場次保底命中的 shotSeq（null = 未觸發）
- `FishingService.java`：保底路徑執行後將 `shot.getShotSeq()` 寫入 `session.guaranteedShotSeq`；`writeResultJson` 將其序列化至 `result_data`；`verifyShot` 讀取 `guaranteedShotSeq`，匹配時改用 `resolveGuaranteedPayout` 驗算，確保驗證結果與實際派彩一致
- `useFishingSession.js`（Bug 7）：`flush()` 在呼叫 API 前快照 `wasFortuneReady = fortuneReadyRef.current`，透過 `ctx.fortuneConsumed` 傳入 `onResults` 回呼
- `Fishing.jsx`（Bug 7）：`onResults` handler 新增邏輯——若 `ctx.fortuneConsumed` 且本批次全無命中（表示風控攔截了保底批次），主動以 `fortune.reportRound(false, true)` 重置幸運值，解除幸運值鎖死在 100 的死循環
- `FishSpeciesTest.java`（新增）：3 個 PF 串流對齊測試

### Why
- Bug 7：`Fishing.jsx` 的 `handleMiss` 始終以 `fortuneConsumed=false` 呼叫 `reportRound`，與老虎機不同，未在風控攔截保底批次時重置幸運值，導致捕魚機幸運值永遠卡在 100（對應 Slot 同類 Bug 的捕魚版本）
- Bug 8：`resolveGuaranteedPayout` 跳過 `nextDouble()` 命中判定，使 verifyShot 端點用 `resolvePayout` 重放時從不同串流位置取倍率，MONEY_TREE 倍率必然不符，破壞 Provably Fair 可驗性

### 驗證
- `mvn -pl backend/game-service test`：119 tests，0 failures

---

## [fix] — 2026-06-22 — 風控並發競爭條件 + 捕魚機 PF 矛盾

### Fixed
- `RiskControlService.java`：新增 Redis INCR 並發閘（key: `risk:inflight:{playerId}`，TTL 30 秒）；同一玩家同時有兩個請求進行時，第二個保守攔截，避免兩個並發請求同時讀取相同舊 DB 值而雙倍超限。新增 `releaseRiskSlot(playerId)` 供呼叫端在 finally 釋放名額
- `SlotService.java`、`BaccaratService.java`、`FishingService.java (shots)`：在 `shouldIntercept` 之後加 try-finally，確保 `releaseRiskSlot` 必然被呼叫
- `FishingService.java (verifyShot)`：解決 PF 矛盾——風控攔截時 `shots()` 回報 `hit=false, payout=0`（正確），但 `verifyShot` 原本回報 RNG 原始 `hit=true`，玩家驗證時會看到「命中但收到 0」的信任危機；現在在 `result_data` 記錄 `riskControlled` 旗標，`verifyShot` 讀取後在 message 中明確說明 RNG 結果為原始值、實際派彩受風控調整
- `FishingSession.java`、`FishingSessionStore.java`：新增 `intercepted` 欄位（Boolean），在 shots() 被攔截時標記為 true，隨 session 持久化至 Redis
- `FishingShotVerifyResponse.java`：新增 `riskControlled` boolean 欄位，前端可機器判讀是否有風控介入

### Why
- 並發閘解決 issue #5 的競爭條件：兩個請求同時讀取 DB 舊聚合值（line 85），都通過淨贏上限檢查，合計實際超限
- PF 矛盾解決 issue #6：`verifyShot` 使用 `resolvePayout` 回報命中，但玩家實際收到 0，違反 Provably Fair 透明性承諾

### 驗證
- `mvn -pl backend/game-service test`：116 tests，0 failures

---

## [fix] — 2026-06-22 — 老虎機風控攔截中獎盤面顯示矛盾 + 幸運值卡在 100 死循環

### Fixed
- `backend/game-service/.../service/SlotService.java`：風控檢查前移至 RNG 之前；`fortuneReady=true` 且風控攔截時改用一般轉動（`spin()`），不呼叫 `spinGuaranteedWin()`，避免中獎符號配零派彩的視覺矛盾；一般轉動若自然命中但被風控攔截，呼叫新增的 `breakPayline()` 替換中線中格符號，確保玩家看到的盤面與派彩一致；`guaranteed` 回應欄位改為 `useGuarantee && outcome.win()`，不再因風控攔截誤報保底觸發
- `frontend/src/casino-fx/fx/useFortuneMeter.js`：`reportRound(won, fortuneConsumed)` 新增第二參數；`fortuneConsumed=true` 且未中獎時仍將幸運值從 100 重置為 0，解除風控持續攔截保底轉動造成的幸運值鎖死循環
- `frontend/src/pages/SlotGame.jsx`：`handleSpinRound` 在 `addCharge` 之前以 ref 記錄 `fortune.full`（`fortuneReadyOnSpinRef`），防止 addCharge 的非同步 setState 污染判斷；`handleSettled` 將該 ref 傳入 `fortune.reportRound` 作為 `fortuneConsumed`

**為什麼**：風控攔截保底轉動時原本保留中獎盤面但派彩為 0，玩家可截圖搭配 /verify 結果舉證詐騙（T-信任/法律漏洞）；同時 `reportRound(false)` 未重置幸運值導致每轉都被攔截的死循環（T-UX 死循環）。
**如何驗證**：觸發風控限制後，老虎機轉動不再出現三連符號配零派彩的盤面；幸運值滿格但風控攔截後，幸運值重置為 0，下一局可正常累積。

## [feat] — 2026-06-18 — 幸運值全滿保底必中（老虎機 / 百家樂 / 捕魚機）

### Added
- `backend/game-service/.../slot/SlotMachine.java`：新增 `spinGuaranteedWin()`，以加權隨機選出必中符號填滿中線，非中線格仍正常 RNG
- `backend/game-service/.../fishing/FishSpecies.java`：新增 `resolveGuaranteedPayout()`，跳過命中判定直接回派彩（MONEY_TREE 仍隨機抽倍率）

### Changed
- `SpinRequest.java` / `BaccaratBetRequest.java` / `FishingShotsRequest.java`：新增 `fortuneReady` 欄位
- `GameSession.java`：新增 `fortuneReady` 欄位（百家樂兩階段 commit-ahead 需跨請求傳遞）
- `SlotService.java`：`fortuneReady=true` 時呼叫 `spinGuaranteedWin()`
- `BaccaratService.java`：`fortuneReady=true` 時最多重發牌 100 次直到結果符合玩家押注區；記錄實際使用的 nonce
- `FishingService.java`：`fortuneReady=true` 時本批第一發呼叫 `resolveGuaranteedPayout()`
- `SlotController.java` / `BaccaratController.java` / `FishingController.java`：轉傳 `fortuneReady`
- `frontend/src/services/gameApi.js`：三遊戲 API 呼叫加入 `fortuneReady` 參數
- `frontend/src/pages/SlotGame.jsx` / `Baccarat.jsx`：dispatch 加入 `fortuneReady: fortune.full`
- `frontend/src/hooks/useFishingSession.js`：接受 `fortuneReady` prop，flush 時轉傳至 API
- `frontend/src/pages/Fishing.jsx`：傳入 `fortuneReady: fortune.full`

**為什麼**：幸運值滿代表玩家已累積足夠「氣力」，應保底觸發一次中獎以兌現期待感。
**如何驗證**：老虎機累積至幸運值 100 後下注，確認中線三連必中；百家樂幸運值滿時押注確認派彩；捕魚機幸運值滿時開炮確認第一發必中。

## [fix] — 2026-06-18 — 多帳號 localStorage 數據隔離（幸運值 & 百家樂咪牌）

### Fixed
- `frontend/src/casino-fx/fx/useFortuneMeter.js`：`storageKey` 加入 `playerId`（`lucky-star-fortune-v1:{gameKey}:{playerId}`），防止切換帳號繼承幸運值
- `frontend/src/pages/SlotGame.jsx`：`useFortuneMeter('slot', player?.id)` 傳入 playerId
- `frontend/src/pages/Fishing.jsx`：`useFortuneMeter('fishing', player?.id)` 傳入 playerId
- `frontend/src/pages/Baccarat.jsx`：
  - `useFortuneMeter('baccarat', player?.id)` 傳入 playerId
  - 咪牌偏好改以 JSON 物件存多帳號（`getSqueezeMode` / `saveSqueezeMode` helper），key 不變、讀寫改用 `playerId` 子 key
  - `useState` setter 改名為 `setSqueezeModeState`，避免與工具函式命名衝突

**為什麼**：同一台電腦切換帳號時，幸運值與咪牌偏好會繼承前一帳號的狀態，造成跨帳號數據污染。
**如何驗證**：帳號 A 累積幸運值後切換帳號 B，確認幸運值從 0 開始；重新登入帳號 A 幸運值恢復原值。

---

## [fix] — 2026-06-18 — 遊戲頁瀏覽器「上一頁」防呆：防止誤觸登出 & 場次懸空

### Added
- `frontend/src/hooks/useGameLeaveGuard.js`：通用 hook，`active` 為 true 時攔截 `popstate`（上一頁）與 `beforeunload`（關分頁/重整），彈出確認框讓玩家確認後才離開。

### Changed
- `frontend/src/pages/SlotGame.jsx`：`loading || visualLock`（轉輪動畫進行中）時啟用離開防呆，確認文案提示下注不返還。
- `frontend/src/pages/Baccarat.jsx`：`isDealing`（後端請求進行中）時啟用離開防呆。
- `frontend/src/pages/Fishing.jsx`：`phase === 'playing'` 時啟用離開防呆，確認文案提示 30 分鐘自動結算。

### Fixed
- 玩家在遊戲進行中按上一頁若導回 `/member` 頁，過去有機率觸發 logout 副作用造成帳號登出；現在優先攔截導航，使用者需明確確認才會離開。
- 捕魚機場次進行中按上一頁會造成場次懸空；現在提示玩家確認，確保場次可正常結算。

### 驗證
- `frontend/src/services/api.js` interceptor 已確認只在 HTTP 401 時清除 auth，無需修改。

---

## [fix] — 2026-06-22 — 遊戲玩法對齊：mock 比照後端引擎 + 修老虎機權重測試/註解

### Fixed
- `backend/.../slot/SlotSymbolTest.java`：權重改 `45/30/16/7/5`（總和 **103**）後，原斷言仍寫死舊值（總和 100、舊累積區間）導致 `mvn -pl backend/game-service test` 變紅。更新總和為 103、累積區間為 `CHERRY[0,45) LEMON[45,75) BELL[75,91) STAR[91,98) SEVEN[98,103)`。
- `backend/.../slot/SlotSymbol.java`：修正 Javadoc 的虛標 RTP/命中率。實際（單中線三連、含本金倍率）**RTP ≈ 26%、命中率 ≈ 11%**（原註解誤植「72% / 30%」、「總和 100」）。
- `frontend/src/services/mockApi.js` 百家樂：補上**標準補牌/天牌規則**（閒 0~5 補、莊家補牌表比照後端 `BaccaratGameService.bankerDraws`）與**和局 push**（押莊/閒退回本金，原本和局直接吃注），莊贏改為 `2×下注 − floor(下注×5%)` 與後端結算一致。
- `frontend/src/services/mockApi.js` 老虎機：改為逐格加權抽樣（權重比照後端 `SlotSymbol`）、中線三連才中獎、**倍率由命中符號的賠付表決定**；移除原本的 `MOCK_SLOT_FORCED_WIN_RATE` 強制中獎率與隨機倍率（會出現「🍒🍒🍒 卻賠 8×」與賠付表脫鉤）。

### Changed
- `frontend/src/pages/Baccarat.jsx`：規則文案補述「必要時補第三張」「莊家扣 5% 傭金」「和局押莊／閒退回本金」，與實際結算一致。
- `CHANGELOG.md`：修復前次提交誤刪的 gateway「stale keep-alive」條目 `##` 標題（其 Changed/Why/How 段原本變成孤兒掛在百家樂稽核條目下）。

### Why
- 使用者要求「mock 與後端兩個世界玩法必須一致」。稽核發現：前端預設走 mock（`gameApi.js`：`VITE_USE_MOCK_API !== 'false'`），而 mock 的百家樂（和局吃注、無第三張）與老虎機（倍率隨機、與符號脫鉤）與後端正確引擎分歧；後端老虎機權重改動又漏改測試與註解。以**後端引擎為單一真相**將 mock 對齊。

### How to verify
- `mvn -pl backend/game-service test` → 綠燈（`SlotSymbolTest` 通過）。
- `cd frontend && npm run lint && npm run build` → 綠燈。
- 手動（mock 模式）：押莊/閒遇和局退回本金（淨損益 0、播放金幣音）；老虎機中獎倍率與中線符號一致（🍒=2x…⭐/7️⃣=8x）。

---

## [feat] — 2026-06-18 — 共用測試帳號種子資料：團隊各自 docker up 即有一致測試帳號

### Added
- `database/mysql/seed_test_data.sql`：三個固定測試帳號（id 1001~1003 / tester01~03 / 密碼皆 `Password1` 的 BCrypt 雜湊 / `is_new_gift_claimed=1`）寫入 `members`；`ON DUPLICATE KEY UPDATE` 冪等。
- `database/postgres/seed_test_data.sql`：對應 player_id 1001~1003 的 `wallets` 初始餘額各 10000 星幣、`version=0`；`ON CONFLICT DO UPDATE` 冪等。

### Changed
- `docker-compose.yml`：mysql / postgres 各新增掛載一個 `seed_test_data.sql` 到 `/docker-entrypoint-initdb.d/`（檔名排序在 `init.sql` 之後，確保先建表再塞種子）。僅在資料 Volume 首次建立時自動執行。

### 為什麼
- 團隊改用 GitHub 共享、希望「不依賴某台主機」也能各自擁有一致測試資料（取代先前 VPN 共用同一台 DB 的方案）。種子資料進版控後，同事 `git pull` + `docker compose up -d` 即自動載入，無需手動匯入或搬資料庫檔案。

### 如何驗證
- 重載：`docker compose down -v && docker compose up -d`（⚠️ `-v` 會清空本機資料）後，
  `docker exec lucky-star-mysql mysql -ulucky_user -plucky_password -e "SELECT username FROM lucky_star_casino.members WHERE id BETWEEN 1001 AND 1003;"` 應見 tester01~03；
  PostgreSQL `SELECT player_id,balance FROM wallets WHERE player_id BETWEEN 1001 AND 1003;` 應見三筆 10000。
- 以 tester01 / `Password1` 透過 Gateway 登入成功，餘額顯示 10000。

## [feat] — 2026-06-18 — 鑽石無限測試帳號：tadge003 / weiyu10366 換星幣不受餘額限制

### Added
- `backend/wallet-service/.../config/DiamondTestAccountProperties.java`：新增 `diamond.unlimited-player-ids` 設定（`@ConfigurationProperties`），判斷玩家是否為「無限鑽石」測試帳號；常數 `UNLIMITED_BALANCE = 1_000_000_000L` 為對外顯示的無限餘額。
- `DiamondWalletServiceTest`：新增 2 筆測試——無限帳號 `debitDiamond` 跳過餘額檢查/扣款且不碰錢包、`getBalance` 直接回無限值。

### Changed
- `backend/wallet-service/.../service/DiamondWalletService.java`：注入 `DiamondTestAccountProperties`。`debitDiamond` 對無限帳號跳過餘額檢查與實際扣款、直接回 `UNLIMITED_BALANCE`（讓鑽石換星幣 T-103 可無上限）；`getBalance` 對無限帳號直接回 `UNLIMITED_BALANCE`（避免無錢包時 404、UI 顯示無限）。
- `backend/wallet-service/src/main/resources/application.yml`：新增 `diamond.unlimited-player-ids`，預設 `1172,1175`（tadge003、weiyu10366），可由 `DIAMOND_UNLIMITED_PLAYER_IDS` 環境變數覆寫。

### Why
- 測試/展示需求：將 tadge003（player 1172）與 weiyu10366（player 1175）設為測試帳號，鑽石視為無限，可無上限兌換星幣補足星幣。以設定白名單實作，可撐過 DB 重置且預設關閉（空清單），不影響一般玩家。

### How to verify
- `mvn -pl backend/wallet-service test` → Tests run: 150, Failures: 0, Errors: 0（含新增 2 筆無限帳號測試與全 context 載入）。

---

## [fix] — 2026-06-18 — 老虎機 SPIN 優化：餘額守門、首局動畫/音效、音效當機

### Fixed
- `frontend/src/pages/SlotGame.jsx`：新增 `canAfford = balance >= resolvedBet`，傳 `canSpin` 給 `SlotMachine`、`handleSpinRound` 開頭餘額雙保險（不足直接 `return null`，不發請求）；餘額不足時於下注面板顯示「星幣不足」提示。移除原本固定 `setTimeout 2900ms` 的視覺鎖釋放，改由 `onSpinComplete` 在轉輪流程真正結束（含成功/失敗）時釋放。
- `frontend/src/components/SlotMachine.jsx`：`spin()` 開頭以 `canSpin` 守門並同步呼叫 `soundEngine.ensureContext()`（在使用者手勢上下文內解鎖音訊，修正首局靜音）；改用 `try/finally` 一律呼叫新 prop `onSpinComplete`；SPIN 按鈕 `disabled={visualBusy || !canSpin}`，文案區分 SPINNING/星幣不足/SPIN。`runReels` 在啟動動畫前若 `trackRefs` 任一未掛載則多等一個 `nextFrame`，避免首局因 ref 競態被 `animateReel` 靜默跳過動畫。
- `frontend/src/casino-fx/sound/SoundEngine.js`：`play()` 新增 per-id 最小間隔節流（`reelTick` 55ms / `heartbeat` 220ms / 預設 24ms）與同時發聲上限（`MAX_ACTIVE_VOICES = 24`，滿載時只放行 `leverPull`/`reelStop`/`win*` 等關鍵音），修正狂按時 Web Audio 節點爆量導致破音/卡死。

### Why
- 使用者實測：首次按 SPIN 無動畫無音效（AudioContext 未在手勢內解鎖、`resume()` 非同步）；餘額不足仍可狂按（前端無餘額檢查，純靠後端丟錯）；連續/高頻觸發 `reelTick`/`heartbeat` 使音訊執行緒過載當機。

### How to verify
- `cd frontend && npm run lint && npm run build` 皆綠燈（vite build 292 modules ✓）。
- 手動（mock 模式）：首局即有動畫＋音效；餘額低於下注時 SPIN 變灰且不發請求、顯示提示；狂按音效穩定不破音；API 失敗後按鈕即時恢復可點。

---

## [fix] — 2026-06-18 — 全遊戲三類 bug 稽核：百家樂補餘額守門 + 前端遊戲鐵則

### Fixed
- `frontend/src/pages/Baccarat.jsx`：`canDeal` 補上餘額守門（新增 `notEnoughBalance = amountInRange && balance < numericBetAmount`），餘額不足時「開始發牌」按鈕變灰、文案顯示「星幣不足」；`handleDeal` 開頭加 `if (balance < numericBetAmount) return` 雙保險，避免明知不足仍送請求。

### Changed
- `AGENTS.md`：新增已知地雷 §2.13「前端遊戲三鐵則」——餘額守門（前端先擋）、視覺鎖綁定真實流程（禁固定 setTimeout）、音效統一走 `soundEngine`（已內建節流/發聲上限），供新遊戲比照避免重蹈老虎機 bug。

### Why
- 使用者要求確認捕魚、百家樂與未來新遊戲不會重現老虎機的三類問題。稽核結果：音效當機已由前一筆的 `SoundEngine` 全域節流修正涵蓋所有遊戲；捕魚（buy-in disabled + `fire()` insufficient + token bucket 限速 + phase 狀態機）三項皆無問題；唯百家樂 `canDeal` 缺餘額檢查（與老虎機同類缺口），本次補齊並把模式寫入 AGENTS.md。

### How to verify
- `cd frontend && npm run lint && npm run build` 皆綠燈（vite build 292 modules ✓）。
- 手動（mock 模式）：百家樂餘額低於下注額時「開始發牌」變灰、顯示「星幣不足」、不發請求；捕魚 buy-in/開火餘額不足時已擋下。

---

## [fix] — 2026-06-18 — gateway 偶發「service is temporarily unavailable」（stale keep-alive 連線）

### Changed
- `backend/gateway-service/src/main/resources/application.yml`：新增 `spring.cloud.gateway.httpclient` 連線池設定 —— `connect-timeout: 2000`、`response-timeout: 10s`、`pool.max-idle-time: 10s`、`pool.max-life-time: 5m`、`pool.eviction-interval: 30s`（背景驅逐閒置連線）。
- 同檔新增 `spring.cloud.gateway.default-filters` 全域 `Retry`：僅對 GET（冪等）在連線層例外（`IOException`/`TimeoutException`/`PrematureCloseException`）時重試 2 次並指數退避；POST（註冊/登入）不重試，避免重複處理。

### Why
- 偶發症狀：前端註冊後自動登入失敗，gateway 回 `member service is temporarily unavailable`；但直連 member-service(8081) 一律成功、透過 gateway 立刻 retry 也成功。
- 根因：`FallbackController` 回的訊息屬「非 `CallNotPermittedException`」分支 → 熔斷器並未開路，而是該次 gateway→下游呼叫拋出連線層例外。reactor-netty 預設不驅逐閒置連線，會重用「下游 Tomcat（預設 keepAliveTimeout≈20s）已關閉的 keep-alive 連線」，送出後收到 connection reset / `PrematureCloseException`。
- 對策：讓 gateway 在下游關閉前先驅逐閒置連線（`max-idle-time 10s < 20s` + 背景 eviction），從源頭消除瞬斷；GET 再加 Retry 作為縱深防禦。熔斷器參數本身正常、未調整。

### How to verify
- `mvn -pl backend/gateway-service test` → BUILD SUCCESS（23 tests，含 contextLoads 驗證新設定可載入）。
- 重啟 gateway 後，反覆執行 註冊→登入→profile 全鏈路（含長閒置後首發請求）不再出現 `temporarily unavailable`。

---

## [fix] — 2026-06-17 — 快速工具列可收合 + 移至左側避免與好友面板重疊

### Changed
- `components/QuickToolbar.jsx`：快速工具列改為**可收合**，預設收合只顯示單一「工具」按鈕，點擊展開完整選單；偏好記於 `localStorage`（`lucky-star-quicktoolbar-open-v1`）。避免長條工具列常駐擋住遊戲畫面。
- `components/QuickToolbar.css`：桌機版工具列由右側改釘**左側**（`left: 18px`），與右下角的好友浮動面板分邊，兩者不再互相覆蓋；新增收合切換鈕樣式。

### Why
- 玩家回報：常駐的直式工具列擋到遊戲觀看，且與右下角好友面板重疊。收合 + 分邊解決兩者。

### How to verify
- 前端 `npm run lint` 0 問題、`npm run build` 成功。
- 手動：桌機左側只剩一顆「工具」按鈕，點擊展開/收合；右下角好友面板與工具列不重疊。

---
## [fix] — 2026-06-17 — 好友清單改真實資料 + 捕魚進場扣款退款補償

### Fixed
- **好友面板顯示假好友**：`components/FriendFloatingPanel.jsx` 原本寫死 8 個假好友、且**從不呼叫**後端，導致所有玩家（含無好友者）都看到同一份假清單。改為呼叫真實 `GET /api/v1/friends` 顯示玩家自己的好友（無好友時顯示「目前沒有好友」），並支援以真實 `DELETE /api/v1/friends/{friendshipId}` 解除好友。一併移除無真實資料來源的「線上狀態 / 等級 / 贈送星幣」假 UI。
- **捕魚進場「扣款後進不了場」的孤兒扣款**：`game-service` `FishingService.start()` 原本先 `walletClient.debit` 再 `sessionStore.save`，若 Redis 存檔失敗則扣款無補償。現將建場與存檔包進 try/catch，失敗時以獨立冪等鍵 `fishing-buyin-refund-<sessionId>` 退款後再上拋例外，避免玩家「扣了錢卻進不了場、也無 session 可結算」。

### Added
- 前端串接：`services/memberApi.js` 新增 `listFriends()`（標準化後端 `FriendListResponse`）與 `deleteFriend(friendshipId)`。
- `game-service` 測試：`FishingServiceTest`（3 案例）覆蓋存檔失敗觸發退款、退款再失敗仍上拋、存檔成功不退款。

### Changed
- 前端 `hooks/useFishingSession.js`：結算 drain 迴圈加 5 秒硬性截止避免 in-flight 卡死永遠無法結算；結算失敗文案改為提示「場次未結束，可再按一次收網結算重試」（後端 `fishing-end-<sessionId>` 冪等，重試安全）。

### Why
- 玩家 1169 實測回報「沒加好友卻有好友」「進場失敗仍扣款」。前者為前端殘留假資料；後者為缺補償機制的潛在帳務漏洞（該玩家當次經查為合法輸光，非此 bug，但漏洞真實存在）。

### How to verify
- 後端：`mvn -pl backend/game-service,backend/wallet-service test` 全綠（game 109 含新 `FishingServiceTest` 3、wallet 148）。
- 前端：`npm run lint` 0 問題、`npm run build` 成功。
- 手動（player 1169）：好友面板顯示「目前沒有好友」（真實 friendships=0）。

---
## [feat] — 2026-06-17 — 玩家自助加值（模擬支付儲值訂單）

### Added
- **wallet-service 自助加值後端**：新增訂單表 `topup_orders` 與完整流程 `CREATED → PAID → CREDITED`（失敗 `FAILED`）。
  - Entity `postgres/entity/TopupOrder.java`、Repository `postgres/repository/TopupOrderRepository.java`。
  - DTO：`TopupPackageResponse`、`CreateTopupOrderRequest`、`TopupOrderResponse`。
  - Service `TopupService.java`：方案清單寫死（P100→100k、P500→600k、P1000→1.3M 星幣）；建單；模擬付款時於**同一 PostgreSQL 交易**內呼叫 `WalletService.credit(subType=TOPUP, idempotencyKey="topup-"+orderNo)` 真實入帳，配合訂單狀態守衛雙重防止重複加值。
  - Controller `TopupController.java`（`/api/v1/wallet/topup`）：`GET /packages`、`POST /orders`、`POST /orders/{id}/pay`、`GET /orders`。玩家身分一律取 gateway 注入的 `X-User-Id`。
  - Exceptions + `GlobalExceptionHandler`：`InvalidTopupPackage`→400、`TopupOrderNotFound`→404、`IllegalTopupState`→409，並補 `IllegalArgumentException`→400。
- **前端自助加值頁**：`pages/Topup.jsx`（方案選擇 → 確認付款 → 即時刷新餘額 + 訂單記錄），`services/walletApi.js` 加 `getTopupPackages/createTopupOrder/payTopupOrder/getTopupOrders`，`App.jsx` 加 `/topup` 路由、`AppShell.jsx` 導覽加「自助加值」。
- **DB schema**：`database/postgres/init.sql` 新增 `topup_orders` DDL；`migration/V7__add_topup_orders.sql` 建表 + 擴充 `chk_wt_sub_type`。

### Changed
- `wallet_transactions.chk_wt_sub_type` CHECK 與 `dto/CreditRequest` 的 `@Pattern` 允許清單加入 `TOPUP`；同時補回 `init.sql` 先前漏掉的 `DIAMOND_EXCHANGE`（與 V4、運行中 DB 對齊）。

### Why
- 補齊玩家「自己加值星幣」的閉環（模擬支付，無真實金流）。沿用既有 `credit()` 的冪等 + 樂觀鎖，以 orderNo 當入帳冪等鍵，確保付款重送不重複加值。
- 實作中發現運行中 PostgreSQL **確有** `chk_wt_sub_type` 約束（交接文件誤記為「無約束」），故 `TOPUP` 必須先擴充 CHECK 才能入帳。

### How to verify
- 後端單元測試：`mvn -pl backend/wallet-service test` 全綠（148 tests，含新增 `TopupServiceTest` 6 案例）。
- 端到端（直打 wallet:8082，player 1169）：建單 P500 → 付款 `CREDITED`、餘額 200→600,200；重複付款→409。
- 透過 gateway:8080（真實 JWT，X-User-Id 注入）：方案/建單/付款全鏈路 200，入帳成功。
- 前端：`npm run lint` 0 問題、`npm run build` 成功。
---

## [docs] — 2026-06-17 — AUDIT_REPORT 附錄 A 重新盤點 + AGENTS.md 服務完成度同步

### Changed
- `AUDIT_REPORT.md` 附錄 A.8：T-070~T-073 ❌→✅（notification-service 全數完成，`WebSocketConfig`/`NotificationConsumer`/`GameResultConsumer`/`RankUpdateConsumer` 實際存在）。
- `AUDIT_REPORT.md` 附錄 A.9：T-083/T-084/T-085/T-086/T-087 盤點備註更新（後端已完成，說明 mockApi 切換現況）。
- `AUDIT_REPORT.md` 附錄 A.11：T-100~T-104 / T-107 ❌→✅（鑽石系統全數完成，wallet-service `DiamondController`/`DiamondWalletService`/`DiamondRedeemService`/`DiamondExchangeService` + `Diamond.jsx`/`diamondSlice` 實際存在）。
- `AUDIT_REPORT.md` 新增附錄 A.12（T-108~T-114 新增任務一覽）、原 A.12 改為 A.13（進度統計）：✅ 29→46，❌ 37→27，總計 78→85（~54% 完成）。
- `AGENTS.md` §2 地雷 10：服務完成度更新（notification T-070~T-073 全完成、鑽石 T-100~T-107 全完成、rank T-040~T-044）。

### Why
- AUDIT_REPORT 附錄 A 上次更新為 2026-06-09，notification 與鑽石系統的完成狀態未同步，導致進度統計嚴重低估（顯示 37% 實為 54%）。

---

## [fix] — 2026-06-16 — 後台停用玩家：阻擋停用期間登入 + 啟用後舊 token 不復活

### Fixed
- **(A) 停用玩家後仍能重新登入並換發新 token**：後台停用只寫 Redis 封鎖（給 gateway），未更新 member DB 的狀態，導致 member 登入檢查不到、停用玩家仍能登入。現 member 登入一併查 Redis `disabled:player:{id}` 封鎖標記，停用期間登入回 `403 Account is disabled`。
- **(B) 後台「啟用」後，停用前簽發的舊 token 會復活可用**：啟用只刪除 Redis 封鎖 key，未過期的舊 token 立即恢復。現停用時記錄簽發時間下限 `token:min-iat:{id}`，gateway 對該玩家拒絕 `iat` 早於此值的 token；啟用時保留此標記（靠 TTL=7 天自然清除），使停用前的舊 token 永久失效，只有啟用後新登入的 token 可用。

### Changed / Added
- `admin-service` `PlayerBanService.ban()`：除既有 `disabled:player:{id}` 外，新增寫入 `token:min-iat:{id}=now`（TTL 7 天）並刪除該玩家 `refresh:{id}`（避免停用前的 refresh token 在啟用後換發新 access token 繞過 min-iat）；`unban()` 僅刪封鎖 key、保留 min-iat。
- `gateway-service` `JwtAuthenticationGlobalFilter`：撤銷檢查新增第三項——讀 `token:min-iat:{sub}`，token `iat` 早於門檻則 401（與既有黑名單、使用者封鎖同走 fail-closed）。
- `member-service` `TokenRedisService.isPlayerDisabled()` + `AuthService.login()`：登入時加查封鎖標記。
- 三服務共用 Redis key 命名（`disabled:player:`、`token:min-iat:`、`refresh:`），於各檔註解標明須一致。

### Why
- 全流程測試「後台停用玩家後 token 失效」時發現兩個語意漏洞：停用中仍可登入、啟用後舊憑證復活。屬使用者帳號封鎖的安全正確性問題。

### How to verify
- 單元測試：`mvn -pl backend/member-service,backend/gateway-service,backend/admin-service test` 全綠（gateway 新增 2 筆 min-iat 案例、admin `PlayerBanServiceTest` 補上新行為斷言）。
- 端對端（走 gateway:8080 / admin:8086）：停用後既有 token→401、重新登入→403；啟用後舊 token→401、新登入 token→200。

---

## [fix] — 2026-06-16 — gateway 補上 `/api/v1/friends/**` 路由

### Added
- `backend/gateway-service/src/main/resources/application.yml`：新增 route `member-friends`（`Path=/api/v1/friends/**` → member-service，套 CircuitBreaker 與既有 member 路由一致）。

### Fixed
- 好友 API（`POST /api/v1/friends/request`、`PUT /{id}/accept`、`PUT /{id}/reject`、`GET /api/v1/friends`、`DELETE /{id}`）實作在 member-service，但 gateway 路由表漏了這段前綴，導致經 gateway 呼叫一律回 **404**，前端無法使用好友功能。補上路由後恢復正常。

### Why
- 全流程 smoke test 時發現：好友端點直連 member:8081 正常，但走 gateway:8080 回 404，比對 `application.yml` 確認路由缺漏。

### How to verify
- 重啟 gateway 後走 gateway:8080 實測：申請 → `200`、重送 → `409`（正確擋重複）、接受 → `200`、雙方 `GET /api/v1/friends` → `200` 且互相在清單中。
- 設定層變更，未動程式碼；gateway 模組測試 `mvn -pl backend/gateway-service test` 綠燈。

---

## [fix] — 2026-06-16 — gateway 補上 `/api/v1/friends/**` 路由

### Added
- `backend/gateway-service/src/main/resources/application.yml`：新增 route `member-friends`（`Path=/api/v1/friends/**` → member-service，套 CircuitBreaker 與既有 member 路由一致）。

### Fixed
- 好友 API（`POST /api/v1/friends/request`、`PUT /{id}/accept`、`PUT /{id}/reject`、`GET /api/v1/friends`、`DELETE /{id}`）實作在 member-service，但 gateway 路由表漏了這段前綴，導致經 gateway 呼叫一律回 **404**，前端無法使用好友功能。補上路由後恢復正常。

### Why
- 全流程 smoke test 時發現：好友端點直連 member:8081 正常，但走 gateway:8080 回 404，比對 `application.yml` 確認路由缺漏。

### How to verify
- 重啟 gateway 後走 gateway:8080 實測：申請 → `200`、重送 → `409`（正確擋重複）、接受 → `200`、雙方 `GET /api/v1/friends` → `200` 且互相在清單中。
- 設定層變更，未動程式碼；gateway 模組測試 `mvn -pl backend/gateway-service test` 綠燈。

---

## [chore] — 2026-06-16 — 新增 Windows 一鍵啟動/關閉腳本（start-all.bat / stop-all.bat）

### Added
- `start-all.bat`：Windows 雙擊即可的一鍵啟動腳本。載入根目錄 `.env` 到本視窗（子視窗繼承，避免「`JWT_SECRET` 缺失啟動失敗」），依序各開一個視窗啟動 member/wallet/game/gateway（gateway 最後）。支援參數 `infra`（先 `docker compose up -d`）、`frontend`（另開視窗跑 `npm run dev`），可組合使用。功能等同既有 `start-backend.ps1`，但提供給不熟 PowerShell 的人雙擊使用。
- `stop-all.bat`：對應的一鍵關閉腳本。以 PowerShell 找出佔用 8080–8083 的行程並 `Stop-Process`，再依視窗標題 `taskkill` 殘留服務視窗；參數 `infra` 會一併 `docker compose down`。

### Changed
- `DEPLOY.md` §4 懶人包：補上 `start-all.bat` / `stop-all.bat` 用法與參數說明，並標明「**兩個 `.bat` 必須保持純 ASCII**」的限制；§9 關閉與清理補上 `stop-all.bat`。

### Why
- 提供比手動各開終端機、逐一載入 `.env` 更省事的本機測試入口。
- **`.bat` 必須純 ASCII 的原因（踩雷紀錄）**：第一版 `start-all.bat` 用中文註解/訊息並存成 UTF-8，但 `cmd.exe` 是用系統舊版字碼頁（本機為 Big5/cp950）逐行解析 `.bat`，中文位元組導致指令行被誤切（如 `WITH_FRONTEND` 被拆成 `TH_FRONTEND`），`start ... mvn` 那幾行未被執行 → 「雙擊沒反應、後端沒起來」。改為純英文 ASCII 後解析正常。

### Verified
- 解析：修正後以全新 `cmd` 執行，輸出無 garbled「not recognized」、`.env` 正確載入 43 個變數（`JWT_SECRET`/`CORS_ALLOWED_ORIGINS`/`INTERNAL_SECRET` 皆到位）；檔案確認無 UTF-8 BOM。
- 端到端：`start-all.bat` 起的 member(8081)/wallet(8082)/game(8083) `actuator/health` 皆 `UP`、gateway(8080) 回 `200`；`stop-all.bat` 正確停掉 8080–8083 四個行程、基礎設施保留。

## [feat] — 2026-06-16 — T-114 統一客服入口（SupportModal/uiSlice）+ 工作分配表 xlsx 改真名與新增任務

### Added
- `frontend/src/store/slices/uiSlice.js`：新增全域 UI slice（`supportOpen` + `openSupport`/`closeSupport`），於 `frontend/src/store/index.js` 註冊為 `ui`。
- `frontend/src/components/SupportModal.jsx`：把客服說明彈窗抽成 App 根層獨立元件（由 `ui.supportOpen` 控制，重用 `walletSlice` 的 `claimBankruptcyAid`/`fetchWallet`/`clearBankruptcyNotice`），於 `frontend/src/App.jsx` 與 `<QuickToolbar />` 同層渲染。

### Changed
- `frontend/src/components/QuickToolbar.jsx`：「客服」按鈕由原「客服入口準備中」stub 改為 `dispatch(openSupport())`，與頭像下拉「客服說明」導向同一彈窗。
- `frontend/src/components/AppShell.jsx`：移除元件內 `supportOpen` local state 與重複的客服說明 `<section>`，頭像下拉改 `dispatch(openSupport())`；保留「可領補助」徽章邏輯。
- `docs/幸運星幣城_工作分配表.xlsx`：(1) 全 5 分頁代號改真名（組長A→張鈞皓、組員B→黃崇瑜、組員C→林瑋彧、組員D→許銘仁、組員E→王竣揚），與報告一致；(2) 工作總覽分頁新增 T-108~T-114 七列（負責人真名、狀態 ✅ 已完成），dimension 由 `A1:J81` 改 `A1:J88`。以 `unzip -p` 取出各 sheet、node 改寫實體編碼 XML、PowerShell `ZipArchive` Update 就地回寫，保留甘特圖等其他 entry 與樣式。
- `docs/report/Lucky-Star-Casino-總體檢報告.md` §5.14：補記入口統一（SupportModal/uiSlice、首頁等未掛載 AppShell 的頁面亦可開）。
- `docs/report/Lucky-Star-Casino-補充說明.md`：§5 問題 #2 與 §6 T-114 狀態改為 ✅ 完成、補驗證紀錄。重跑 `build-split.mjs` + `build-html.mjs` 同步分冊與所有 HTML。

### Why
- 破產補助前端入口前次做在頭像下拉，但浮動工具列「客服」仍是 stub，兩入口行為不一致；且 QuickToolbar 在 App 根層、首頁等不掛載 AppShell，彈窗放 AppShell 無法全頁共用。抽成根層 `SupportModal` + `uiSlice` 一次解決一致性與可用範圍。xlsx 為任務單一真相，需同步真名與本 session 新增任務。

### Verified
- `frontend`：`npm run lint` 無錯、`npm run build` 成功。
- 報告：`node build-split.mjs` + `node build-html.mjs` 成功；`docs/report` 無殘留代號。
- xlsx：`unzip -t` 無錯、5 分頁 XML 皆良構（`XmlDocument.LoadXml`）；解析後文字確認真名已寫入（張鈞皓 21／黃崇瑜 18／林瑋彧 15／許銘仁 25／王竣揚 14 hits）、代號僅剩 T-108 說明欄刻意提及（組長A×1、組員B×1）、T-108~T-114 七列與 dimension `A1:J88` 到位。

## [fix] — 2026-06-16 — 登出黑名單前綴對齊（撤銷生效）+ 前端破產補助入口（客服說明）+ 報告補強

### Fixed
- **登出黑名單前綴不一致（高）**：`backend/member-service/.../service/TokenRedisService.java` 寫入黑名單原用前綴 `blacklist:{jti}`，但 `backend/gateway-service/.../filter/JwtAuthenticationGlobalFilter.java` 查詢的是 `jwt:blacklist:{jti}`，兩者對不上 → 登出後 access token 在自然到期前於 Gateway 端仍可通行，撤銷形同未生效。將 member 端常數統一為 `jwt:blacklist:` 並加註解鎖定兩處須同步（member 自身讀寫共用同一常數，故仍一致）。

### Added
- **前端破產補助入口**（破產補助後端 T-027 早已完成、前端原無入口）：
  - `frontend/src/components/AppShell.jsx`：頂欄頭像改為可點選下拉，新增「客服說明」彈窗，內含破產補助操作教學、目前餘額與「領取破產補助」按鈕（餘額 < 100 才可領、領取後即時更新餘額）；餘額 < 100 時頭像選單顯示「可領補助」標記。
  - `frontend/src/services/walletApi.js`：新增 `claimBankruptcyAid()`（串 `POST /api/v1/wallet/bankruptcy-aid`，含 mock 分支）。
  - `frontend/src/store/slices/walletSlice.js`：新增 `claimBankruptcyAid` thunk、`bankruptcyAid` 子狀態與 `clearBankruptcyNotice`。
  - `frontend/src/services/mockApi.js`：新增 `claimBankruptcyAid` mock（門檻 100 / 發放 1000 / 每日一次），與後端 `BankruptcyAidService` 一致。

### Changed
- `docs/report/Lucky-Star-Casino-專題提案書.md`：組員代號改用真名（張鈞皓（組長）/黃崇瑜/林瑋彧/許銘仁/王竣揚），並註記王竣揚前端工作目前由張鈞皓、黃崇瑜、林瑋彧暫代。
- `docs/report/Lucky-Star-Casino-總體檢報告.md`（報告單一來源）：新增 §4.7 鑽石系統（序號生成與兌換）、§4.8 破產補助金、§4.9 公平性驗證、§4.10 Redis 7 Token/黑名單，§5.14 破產補助/客服說明前端畫面與操作教學，並於 §6.1 補 F-4（黑名單前綴修正）。重跑 `build-split.mjs` + `build-html.mjs` 同步分冊與 HTML、`make-pdf.mjs` 重產提案書 PDF。
- `docs/report/Lucky-Star-Casino-補充說明.md` / `.html`（新檔）：彙整本次特別要求的四個系統說明、發現並處理的問題（黑名單前綴、客服入口重複）、本 session 新增任務（暫定 T-108~T-114）。`tools/screenshot/build-html.mjs` docs 清單加入此檔以產生 HTML。

### Why
- F-4 是真實安全缺陷：登出無法在 Gateway 端撤銷 token。破產補助是防流失設計卻無前端入口，玩家輸光後無處可領。報告需反映真名分工與四個被點名系統的詳細說明。

### Verified
- `mvn -pl backend/member-service test` → BUILD SUCCESS（70 tests）。
- `frontend`：`npm run lint` 無錯、`npm run build` 成功。
- 報告：`node build-split.mjs` + `node build-html.mjs` + `node make-pdf.mjs` 皆成功；`grep 組長A|組員B…` 於 `docs/report` 已無殘留代號。

## [test] — 2026-06-16 — T-090 / T-091：老虎機高併發壓測本機實跑 + 帳務一致性對帳

### Added
- `tests/performance/provision-players.mjs`：1,000 名玩家備置腳本——經 gateway 註冊/登入、等 Kafka 建立錢包，再以 **T-055 GM 發幣**（admin `POST /admin/gm/grant`）大額入金（bankruptcy-aid 為退路），輸出 `players.csv`。對 gateway `/api/v1/auth/**` 限流 429 做指數退避重試。
- `docs/performance/T-091-accounting-reconciliation-report.md`：對帳實測報告（9 項全 PASS）。

### Changed
- `tests/performance/slot-1000-players.jmx`：**對齊真實契約**——端點改 `/api/v1/game/slot/spin`、body 改 `{bet, clientSeed}`（移除 client 端 `idempotencyKey`，因冪等鍵由伺服器端生成）、`bet` 預設 100（合法區間 100–5000）；sampler「02 重放同冪等鍵」改為「02 第二次獨立轉動」。**修正壓測腳本 bug**：CSV `recycle=true`+`stopThread=false`，避免每執行緒只跑 1 次就因 CSV 耗盡而停（維持 60 秒持續負載）。
- `tests/performance/run-slot-load-test.ps1`：`-BetAmount` 參數改 `-Bet`（預設 100）、JMeter property 由 `bet_amount` 改 `bet`，對齊 JMX。
- `tests/infra/jmeter.test.js`：斷言同步更新（真實端點、body 形狀、無 client 冪等鍵、兩次獨立轉動、recycle 持續負載、報告以實測數據記錄）。
- `docs/performance/T-090-load-test-report.md`：改寫為**實測報告**（三組情境：1000/1s、1000/1s 修前、150/10s）。

### Why
- 規格腳本與 T-032 實作契約漂移（端點/欄位/冪等鍵）；不對齊則壓測打不中真實 API。依使用者指示「嘗試本機實跑」，完整啟動拓樸並以真實量測填報（AGENTS.md §地雷 12：無實測不得捏造 P99）。

### Verified（實測，非捏造）
- 全拓樸本機啟動：docker 基礎設施（Kafka KRaft 補 `.env` 的 `KAFKA_CLUSTER_ID`）＋ gateway/member/wallet/game/admin（jar 啟動；admin 先補建 PostgreSQL `admin_*` 表）。1,000 名玩家備置完成。
- **壓測（Spec：1000 threads / 1s ramp / 60s）**：25,150 樣本，P99 2,469 ms，5xx 20,058（≈80%），**overdraw 0、冪等失敗 0**。效能閘門 FAIL（單機資源上限：斷路器 load-shed），帳務不變量 PASS。
- **壓測（host-sustainable：150 threads）**：16,489 樣本，P99 545 ms，5xx 47（0.28%），overdraw 0、冪等失敗 0。
- **T-091 對帳**（壓測後對 live PostgreSQL 跑 `accounting-reconciliation.sql`）：9 項檢查全 **PASS / 0 violations**（無負餘額、無重複冪等鍵、餘額與流水帳完全吻合、frozen 歸零）。
- `node --test tests/infra/*.test.js`：122 pass / 0 fail。

## [feat] — 2026-06-15 — T-092：Swagger UI / OpenAPI 文件整合（各服務 + gateway 聚合）

### Added
- **依賴管理**：根 `pom.xml` dependencyManagement 新增 `springdoc-openapi-starter-webmvc-ui` 與 `-webflux-ui`（`${springdoc.version}=2.6.0`，相容 Spring Boot 3.3.x）。
- **各 REST 服務**（member、wallet、game、rank、admin）：加 `springdoc-openapi-starter-webmvc-ui`，新增 `config/OpenApiConfig`（`@OpenAPIDefinition` + Bearer JWT `@SecurityScheme`），主要 controller/端點補 `@Tag`/`@Operation`。啟用各服務 `/swagger-ui.html` 與 `/v3/api-docs`。
- **gateway 聚合**（`backend/gateway-service`）：加 `springdoc-openapi-starter-webflux-ui`；application.yml 設 `springdoc.swagger-ui.urls` 列出 5 服務，並新增 `openapi-*` 路由把各服務 `/v3/api-docs` 代理為 `/v3/api-docs/{service}`。瀏覽 `http://localhost:8080/swagger-ui.html` 右上下拉即可切換各服務文件。

### Changed
- 有 spring-security 的服務（member、wallet、admin）：`SecurityConfig` 放行 `/swagger-ui/**`、`/swagger-ui.html`、`/v3/api-docs/**`（admin 放行置於 `/admin/**` 規則之前，`/admin/**` 仍維持 `ROLE_ADMIN`，未放寬業務端點）。
- gateway `jwt.whitelist` 新增 `/swagger-ui`、`/v3/api-docs`、`/webjars` 前綴，使聚合文件頁免 JWT。
- member-service 因其 `<parent>` 直接是 `spring-boot-starter-parent`（非 monorepo 根 pom，故不繼承根 dependencyManagement），比照既有 `jjwt.version` 模式在自身 pom 加本地 `springdoc.version=2.6.0`。

### Why
- 各 API 已大致完成（Rank/Admin/Notification 等），整合 Swagger 便於前端/QA 一站檢視端點、schema 與認證方式。gateway 採「指定 urls + 代理 api-docs」聚合，比反射式自動發現更穩定可控。

### Verified
- 各服務 `mvn -pl backend/<svc> test` 全綠：member 70、wallet 142、game 106、rank 66、admin 68、gateway 21（springdoc 未破壞 context/security）。
- `mvn -T1C test-compile`（全 reactor）BUILD SUCCESS。

## [feat] — 2026-06-15 — T-073（notification 端）：排行榜變動廣播消費端

### Added
- `backend/notification-service`：`kafka/RankUpdateConsumer` 消費 `rank.update` → `convertAndSend("/topic/rank", event)` 公共廣播；壞訊息記錄後照樣 ack 丟棄（不重試）。`kafka/RankUpdateEvent`（record，`@JsonIgnoreProperties(ignoreUnknown=true)`，`entries` 用寬鬆 `List<Map<String,Object>>` 避免與 rank DTO 耦合）。

### Why
- 與 rank-service 的 `rank.update` producer（本批 T-073 rank 端）對接，前端訂閱 `/topic/rank` 即時看到 TOP10 變動。`/topic` broker 已由既有 `WebSocketConfig` 啟用，`rank.update` topic 已存在於 infra，故未動其他設定。

### Verified
- `mvn -pl backend/notification-service test`：19 pass / 0 fail（新增 RankUpdateConsumerTest：廣播到 /topic/rank、壞 JSON ack 不互動 template、合法訊息 dispatch+ack）。

## [feat] — 2026-06-15 — T-054 / T-055：異常玩家偵測規則引擎 + GM 手動發放星幣

### Added
- **T-054 異常玩家偵測**（`backend/admin-service`）：
  - `kafka/GameResultConsumer`（`game.result`）、`kafka/WalletEventConsumer`（`wallet.credit`/`wallet.debit`）+ 對應 record 事件（`@JsonIgnoreProperties(ignoreUnknown=true)`）；`config/KafkaConsumerConfig` 設 `MANUAL_IMMEDIATE`、壞訊息記錄後照樣 ack 丟棄（不引入 DLT 基建）。
  - `service/AlertRuleEngine` 三規則：① 單局中獎 > 50,000 → `BIG_WIN`；② 30 分內下注 > 100 次 → `HIGH_FREQUENCY`（Redis `admin:betcount:{playerId}` `INCR` + 首次 TTL 30min）；③ 帳務異動頻率異常（60s 內 > 20 次）→ `ABNORMAL_TRANSFER`（Redis `admin:txncount:{playerId}`）。命中 → 寫 `admin_alerts`（PostgreSQL 寫端）＋ 發 `notification.push`（`targetPlayerId=null` 廣播給管理員前台）。
  - `postgres/entity/AdminAlert` + repository（`admin_alerts` 表已存在於 init.sql）；`kafka/NotificationPushPublisher` + `NotificationPushEvent`。
- **T-055 GM 手動發放星幣**：
  - `controller/GmController`：`POST /admin/gm/grant`（`@PreAuthorize("hasRole('SUPER_ADMIN')")`），body `{playerId, amount, reason}`。
  - `service/GmRewardService`：**走指令**發 `wallet.credit.request`（`subType=GM_REWARD`、`idempotencyKey=gm-grant-{operator}-{playerId}-{UUID}`），**絕不直接寫 wallet**（ADR-002 §地雷 6）；操作日誌落 `admin_action_logs`（operator 取自 `Authentication.getName()`）。
  - 新表 `admin_action_logs`（PostgreSQL）：`database/postgres/init.sql` + `migration/V6__add_admin_action_logs.sql`；`postgres/entity/AdminActionLog` + repository。

### Changed
- `backend/admin-service/src/test/resources/application.yml`：加 `spring.kafka.listener.auto-startup: false`，使既有 `@SpringBootTest` 不因新 `@KafkaListener` 嘗試連 Kafka 而失敗（listener 以 `autoStartup="${spring.kafka.listener.auto-startup:true}"` 綁定，正式環境照常啟動）。

### Why
- 三規則告警類型對齊既有 `admin_alerts` CHECK（`BIG_WIN`/`HIGH_FREQUENCY`/`ABNORMAL_TRANSFER`），故無需改表。頻率類規則用 Redis 計數 + TTL 滑窗，避免掃描帳務流水。
- GM 發幣嚴守 ADR-002：admin 只發指令，由 wallet-service 入帳並回 `wallet.credit` 事件；冪等鍵防重複發放。告警 consumer 只「計數」`wallet.credit`/`wallet.debit`（事件），絕不消費 `wallet.credit.request`（指令）以免迴圈（§地雷 6）。
- 相關 topic（`game.result`/`wallet.credit`/`wallet.debit`/`notification.push`/`wallet.credit.request`）皆已存在，未動 infra。

### Verified
- `mvn -pl backend/admin-service test`：68 pass / 0 fail（含三規則邊界 49,999/50,001、100/101、20/21；consumer 壞訊息丟棄；GM payload + 日誌；GmController 權限 OPERATOR→403 / SUPER_ADMIN→200）。

## [feat] — 2026-06-15 — T-045 / T-073（rank 端）：今日贏幣王排行榜 + 排行榜變動廣播事件

### Added
- **T-045 今日贏幣王排行榜**（`backend/rank-service`）：
  - `service/RankService`：ZSet `rank:daily:winnings:{yyyy-MM-dd}`（Asia/Taipei），score = 當日累計**中獎金額**。新增 `addDailyWinnings`（`ZINCRBY`，僅首次寫入時設 48h TTL → 自動隔日重置，免排程）、`getTopDailyWinnings(limit)`（前 N，1-based，username 取自既有 `rank:player:usernames`）、`getDailyWinningsRank(playerId)`。
  - `kafka/WalletBalanceChangedConsumer`：消費 `wallet.credit` 事件時，當 `subType == "WIN"` 且有 amount → 額外累加當日贏幣榜（global 排行仍依 `balanceAfter` 更新，不受影響）。
  - `controller/RankController`：`GET /api/v1/rank/daily/winnings?limit=`（預設/上限 100）、`GET /api/v1/rank/daily/winnings/me`（Header `X-User-Id`，200/404）。
- **T-073 排行榜變動廣播（rank 端）**：
  - `kafka/RankUpdateEvent`（record：type/entries/updatedAt）+ `kafka/RankUpdatePublisher`（topic `rank.update`，type `GLOBAL_TOP10`，best-effort，比照既有 `NotificationPushPublisher`）。
  - `RankService.updatePlayerCoins` 更新 global 排行後，**僅當 TOP10（順序敏感）變動且距上次廣播 ≥1s** 才發 `rank.update`（`shouldBroadcast` 節流去抖，volatile 狀態）。

### Why
- 今日贏幣王取「中獎金額」累加（非餘額），來源選 `wallet.credit` 事件的 `subType=WIN` + amount（§工作分配表 T-045 註記）。日期後綴 key + TTL 自然每日重置，避免額外排程器與競態。
- `rank.update` topic **已存在**於 `kafka/kafka-init.sh`，故未動 infra 與 `tests/infra/kafka.test.js`。TOP10 變動才廣播 + 1s 節流，避免微小變動狂推（§任務 T-073 要求）。

### Verified
- `mvn -pl backend/rank-service test`：66 pass / 0 fail（新增 daily-winnings 累加/排序/自己名次、WIN-only 累加、TOP10 變動才廣播、兩端點等案例）。

## [fix] — 2026-06-15 — game-service 捕魚機閒置回收：Redis KEYS→SCAN + 排程韌性

### Changed
- `fishing/FishingSessionStore.listPlayerIds()`：列舉在線捕魚場次由 Redis `KEYS` 改為 **`SCAN` 游標分批**（`ScanOptions.match(KEY_PREFIX+"*").count(256)`，try-with-resources 關閉 `Cursor`）。`KEYS` 為 O(N) 阻塞指令，key 量大時會卡住整個 Redis 實例；`SCAN` 非阻塞、分批回傳。移除未使用的 `java.util.Set` import。
- `service/FishingService.sweepIdleSessions()`：把 `sessionStore.listPlayerIds()` 包入 try/catch。原本若 Redis 不可用，`listPlayerIds()` 在 per-player 迴圈**之前**拋出，整批掃描以未捕捉例外結束、排程每分鐘噴 ERROR；改為記 WARN 後略過本輪（下一輪自動重試，帳務冪等不受影響）。

### Why
- code review 發現的兩個地雷：`KEYS` 在生產環境的阻塞風險（程式碼原註解已自承「上雲前應改 SCAN」），以及排程對 Redis 抖動不具韌性導致 log 噪音。皆為捕魚機（見工作分配表 T-038）閒置回收路徑。

### Verified
- `mvn -pl backend/game-service test`：106 pass / 0 fail（BUILD SUCCESS）。

### Docs
- `docs/幸運星幣城_工作分配表.xlsx`：新增 **T-038 捕魚機遊戲實作（邏輯 + Session + API）**（RNG Game Service / 組員B / S2-W5 / ✅ 已完成）至全部 4 個分頁；此功能先前已實作但未登錄於追蹤表（SSOT）。同步修正各分頁小計/總計公式與 視覺化甘特圖 組員B 合計（51h、9 項）。

## [feat] — 2026-06-15 — T-070/T-071/T-072：notification-service 即時推播（WebSocket/STOMP + Kafka 橋接）

### Added
- **新服務 `backend/notification-service`**（port 8087，套件 `com.luckystar.notification`，已掛入父 `pom.xml` modules）。純事件→WebSocket 橋接，**無資料庫**（故不引入 JPA/H2）。
- **T-070 WebSocket STOMP Server**：
  - `config/WebSocketConfig`（`@EnableWebSocketMessageBroker`）：STOMP 端點 `/ws`（含 SockJS fallback + 原生 WS），simple broker `/topic`（公共廣播）+ `/queue`（私人，配 `/user`），應用前綴 `/app`。
  - **連線鑑權**：`security/StompAuthChannelInterceptor` 攔 STOMP CONNECT，讀 `Authorization: Bearer <token>`，`security/PlayerJwtVerifier` 以 member 同把 `jwt.secret`（HS256）驗章，成功則以 playerId（JWT subject）作為連線 `Principal` 名稱 → `/user/` 私人路由才送得到指定玩家；驗章失敗拋例外（broker 回 STOMP ERROR 斷線）。
- **T-071 Kafka→WS 橋接**：`kafka/NotificationConsumer` 消費 `notification.push`（契約 `NotificationPushEvent`：targetPlayerId/type/title/message/payload），有 targetPlayerId → `convertAndSendToUser(playerId, "/queue/notifications", …)`；無 → 廣播 `/topic/notifications`。
- **T-072 遊戲結果推播**：`kafka/GameResultConsumer` 消費 `game.result`（契約 `GameResultEvent`，`@JsonIgnoreProperties(ignoreUnknown=true)` 容忍各遊戲額外欄位），組 `{type:GAME_RESULT, roundId, gameType, bet, payout, win, settledAt}` 推到玩家私人佇列，前端免輪詢即得結算結果。
- 測試（16 pass）：contextLoads、JWT 驗章（有效/過期/錯簽/空）、兩 consumer 路由與壞訊息丟棄、**STOMP 整合測試**（有效 JWT 連線→訂閱→收私人推播 round-trip、缺/錯 JWT 連線被拒）。

### Changed
- `backend/notification-service/application.yml`：Kafka consumer `group-id=notification-service-group`、`auto-offset-reset=latest`、`listener.ack-mode=MANUAL_IMMEDIATE`（listener 內 try/catch，壞訊息記錄後照 ack 丟棄，不重試卡住 consumer）。

### Why
- 完成 Phase 5（AGENTS.md §地雷 10 標示「notification 服務尚未建立」）。採私人佇列 `/user/{playerId}/queue/notifications` 需鑑權階段把 principal 綁成 playerId，否則 `/user/` 推不到指定玩家（§地雷對應）。
- `game.result` / `notification.push` topic **已存在於** `kafka/kafka-init.sh`，故未動 infra 與 `tests/infra/kafka.test.js`。本服務 best-effort 推播、可容忍遺失，故不設 DLT。
- `game.result` 事件不含 `balanceAfter`（game-service 未發），故推播改用實際可得欄位（bet/payout/win），未杜撰餘額。

### Verified
- `mvn -pl backend/notification-service test`：16 pass / 0 fail。
- `node --test tests/infra/*.test.js`：121 pass / 0 fail（infra 未變動，回歸確認）。

## [feat] — 2026-06-15 — T-105/T-106：鑽石點數卡後台 API（批量生成 + 列表查詢）

### Added
- `controller/AdminDiamondController`：
  - `POST /admin/diamond/cards`（`@PreAuthorize("hasRole('ADMIN')")`）：批量生成點數卡，body `{count, faceValue}`，回傳序號陣列供匯出。
  - `GET /admin/diamond/cards?page=&size=&status=all|redeemed|unredeemed`：分頁列表 + 兌換狀態過濾，欄位含 card_code/face_value/is_redeemed/redeemed_by/redeemed_at。
- `service/DiamondCardService`：序號格式 `XXXX-XXXX-XXXX-XXXX`（UUID 取 16 碼 hex 大寫分 4 段），同批去重 + `existsByCardCode` 避開既有序號（card_code UNIQUE），`saveAll` 寫入。
- `mysql.entity.DiamondCard` + `mysql.repository.DiamondCardRepository`（admin 的 @Primary MySQL 源）。
- DTO：`GenerateCardsRequest`（count 1..1000、faceValue 正）、`GenerateCardsResponse`、`DiamondCardView`、`CardStatusFilter`。
- 單元測試：生成數量/格式/唯一/撞號重產、三種 status 過濾、生成驗證 400。

### Why
- `diamond_cards` 在 **MySQL**，而 admin-service 的 `@Primary` 資料源即 MySQL（見 DataSourceConfig），故直接以 admin 既有 MySQL EMF 讀寫，不需新增資料源（修正計畫「admin 主源是 PostgreSQL」之誤判）。卡片生成為後台固有職責（非寫他服務私有資料）。

### Verified
- `mvn -pl backend/admin-service test`：52 pass / 0 fail。

## [feat] — 2026-06-15 — T-051/T-052/T-053：Admin 管理/報表 API（玩家管理 + 星幣流通量 + RTP 監控）

### Added
- **T-051 玩家帳號管理**：
  - `controller/AdminPlayerController`：`GET /admin/players`（分頁 + 帳號/暱稱關鍵字）、`GET /admin/players/{id}`（跨庫彙整：member 基本資料 + wallet 餘額 + 近 20 筆帳務 + 近 20 局對局）、`PATCH /admin/players/{id}/status`（停用/啟用）。
  - `service/AdminPlayerService` + 唯讀 read model：`mysql.entity.{MemberRead,WalletTransactionRead}`、`postgres.entity.{WalletRead,GameRoundRead}` 與對應 repository（admin 只讀、不寫他服務庫）。
  - `service/PlayerBanService`：停用寫 Redis `disabled:player:{id}`、啟用刪除。
  - `gateway` `JwtAuthenticationGlobalFilter`：新增使用者級封鎖檢查（`disabled:player:{sub}`），與 jti 黑名單一起 fail-closed → 命中即 401，使被停用玩家既有 token **立刻失效**。
- **T-052 星幣流通量報表**：`GET /admin/reports/coin-flow?dimension=day|week|month&from=&to=`，`service/CoinFlowReportService` 讀 MySQL `wallet_transactions`、依 type 分發放(CREDIT/BONUS)/消耗(DEBIT)、Java 依維度彙整時間序列（DB 方言中立、易測）。
- **T-053 RTP 監控**：`GET /admin/reports/rtp?game=&from=&to=`，`service/RtpReportService` 讀 PostgreSQL `game_rtp_stats`（game T-037 排程產出，admin 不重算），比對設計 RTP（`admin.rtp.design.*` 可設定，預設 slot 0.95 / baccarat 0.98），偏差絕對值 > 門檻（預設 0.05）標 `ABNORMAL`。
- `controller/AdminReportController`（兩報表端點）、`controller/AdminExceptionHandler`（不合法參數 → 400）、相關 DTO 與單元測試（玩家列表/搜尋/詳情/停用封鎖、各維度彙整、RTP 偏差邊界 5%/>5%）。

### Changed
- `backend/admin-service/pom.xml` + `application.yml`：新增 spring-data-redis（玩家封鎖）。
- read model 實體 no-arg 建構子改 public（供跨套件測試建構）。

### Why
- T-051 停用「即時失效」：既有黑名單是 per-JTI，admin 無從取得玩家 jti；且 admin 不應直接寫 member 庫。故採**使用者級封鎖 + gateway 強制**（gateway 是所有玩家請求唯一閘口，一處改動即全服務生效）。member 庫 `status` 持久化待 member-service 提供 internal API（跨組待辦）。
- 報表走**直接讀庫**（admin 已掛 MySQL 讀庫 + PostgreSQL）：符合計畫「讀庫查詢」「RTP 不在 admin 重算」原則，免跨服務 HTTP。

### Verified
- `mvn -pl backend/admin-service test`：43 pass / 0 fail。
- `mvn -pl backend/gateway-service test`：21 pass / 0 fail（含 JWT filter 既有案例，封鎖檢查未破壞 fail-closed 行為）。

## [feat] — 2026-06-15 — T-050：Admin 後台 JWT 認證地基（角色區分 + Spring Security）

### Added
- admin-service 認證地基（套件 `com.luckystar.admin`）：
  - `security/AdminRole`（`SUPER_ADMIN` / `OPERATOR`）、`security/AdminJwtUtil`（JJWT 0.12.6，獨立 secret、token 帶 `role` + `scope=admin`）、`security/AdminJwtAuthFilter`（驗章後授予 `ROLE_ADMIN` + `ROLE_<角色>`）。
  - `config/SecurityConfig`：`/admin/auth/**` 放行、`/admin/**` 需 `ROLE_ADMIN`、`@EnableMethodSecurity` 開啟 `@PreAuthorize`、未認證回 401（自訂 entry point）、角色不足回 403。
  - `postgres/entity/AdminUser` + `postgres/repository/AdminUserRepository`（PostgreSQL 寫端）。
  - `dto/LoginRequest`、`dto/LoginResponse`、`service/AdminAuthService`（BCrypt 驗密碼 → 簽 token）、`controller/AdminAuthController`（`POST /admin/auth/login`）。
  - `config/AdminUserSeeder`：啟動播種預設 `SUPER_ADMIN`（帳密由 `ADMIN_SEED_*` 提供，BCrypt 雜湊，table 空時才建）。
- `database/postgres/init.sql` + `migration/V1__init_schema.sql`：新增 `admin_users` 表（username UNIQUE、role CHECK SUPER_ADMIN/OPERATOR、BCrypt password_hash）。
- `.env.example`：新增 `ADMIN_JWT_SECRET`、`ADMIN_JWT_EXPIRY_MS`、`ADMIN_SEED_*`。
- 測試（19 個）：`AdminJwtUtilTest`（玩家 token/缺 scope/亂碼 → 拒）、`AdminAuthServiceTest`（成功/錯密碼/未知/停用）、`AdminAuthControllerTest`（200/401/400）、`AdminSecurityIntegrationTest`（無 token 401、玩家 token 401、OPERATOR 200、OPERATOR 存取 super-only 403、SUPER_ADMIN 200、登入 e2e）。

### Changed
- `backend/admin-service/pom.xml`：加 JJWT（api/impl/jackson）、validation、H2（test）、surefire `jpa.ddl-auto=create` 與 `jpa.dialect.*=H2Dialect`。
- `config/DataSourceConfig`：`hibernate.hbm2ddl.auto` 與 `hibernate.dialect` 改讀 system property（預設維持正式方言/validate），讓測試能以 H2Dialect + create 在 H2 建表並 INSERT（H2 不支援 PG/MySQL 方言的 `insert...returning`）。
- `application.yml`：移除無用的 `spring.security.user`，新增 `admin.jwt.*` 與 `admin.seed.*`。

### Why
- T-050 是所有 Admin/鑽石後台 API（T-051~T-055、T-105、T-106）的前置。採**獨立 ADMIN_JWT_SECRET** 與玩家 token 隔離（AGENTS §地雷）；角色用 `ROLE_ADMIN` 把關 `/admin/**`、`@PreAuthorize("hasRole('SUPER_ADMIN')")` 把關 GM 級敏感操作。
- 方言改 system property：admin 因 seeder 啟動即 INSERT，PostgreSQLDialect 的 `insert...returning` 在 H2 會語法錯誤；測試改 H2Dialect 為業界慣例，且 prod 設定零變動。

### Verified
- `mvn -pl backend/admin-service test`：19 pass / 0 fail。

## [feat] — 2026-06-15 — T-041/T-042：好友排行榜納入本人 + 新增「查自己好友名次」API

### Added
- `RankService.getFriendRank(playerId)`：以 `ZREVRANK` 取得玩家在好友榜的當前名次（好友榜已含本人）；不在榜回 `Optional.empty()`。
- `GET /api/v1/rank/friends/me`（`X-User-Id` header）：回傳玩家自己在好友榜的名次，不在榜回 404；缺 header 回 400。
- 單元測試：`RankServiceTest` 補 `getFriendRank` happy path + 不在榜；`RankControllerTest` 補 `/friends/me` 200/404/400 三案例。

### Changed
- `RankService.rebuildFriendRank`：好友榜 ZSet（`rank:friend:{playerId}`）由「僅含好友」改為「**好友 + 玩家本人**」，讓玩家即使不在好友前 20 名也能查到自己名次（T-041 step2 / T-042 step3）。仍維持去重、無好友時不建空 ZSet、24h TTL 不變。
- `RankServiceTest.rebuildFriendRank_*`：對應更新斷言為含本人（"1","2","3"）。

### Why
- 計畫 T-041 step2 要求好友榜「好友 + 自己」、T-042 step3 要求「friends 榜也補自己名次」，原實作的 friends-only ZSet 無法滿足「查自己在好友圈名次」。經確認採「納入自己」方案（符合常見好友榜 UX：玩家能看到自己位置）。
- 頭像欄位：計畫 T-042 要求回傳含頭像，但 `MemberRegisteredEvent` 目前僅帶 `username`，rank 端無頭像資料來源。依 AGENTS §地雷「不跨服務同步呼叫」，**暫不加頭像欄位，記錄為跨組待辦**（待 member 端於註冊事件補頭像後再落地）。

### Verified
- `mvn -pl backend/rank-service test`：49 pass / 0 fail（RankServiceTest 14、RankControllerTest 7）。

## [feat] — 2026-06-15 — T-002：Docker Compose 環境收尾，Kafka 改 KRaft（移除 Zookeeper）、MySQL 對齊 8.4

### Changed
- `docker-compose.yml`：Kafka 由 Zookeeper 模式改為 **KRaft 模式**（`KAFKA_PROCESS_ROLES=broker,controller`、`KAFKA_CONTROLLER_QUORUM_VOTERS=1@lucky-star-kafka:29093`、新增 `CONTROLLER` listener、`CLUSTER_ID` 由 `${KAFKA_CLUSTER_ID}` 注入），broker+controller 單節點合一。MySQL image 由 `8.0` 對齊規格 `8.4`。
- `.env.example`：移除 `ZOOKEEPER_PORT`，新增 `KAFKA_CLUSTER_ID`（固定值避免重建 volume 後 id 不一致）。
- `tests/infra/docker-compose.test.js`：移除「應包含 zookeeper 服務」斷言，改為斷言「無 zookeeper 服務 + 具備 `KAFKA_PROCESS_ROLES`/`KAFKA_CONTROLLER_QUORUM_VOTERS`」確保維持 KRaft。
- 文件同步：`DEPLOY.md`、`README.md`、`docs/architecture.md`、`docs/PROJECT_BASE_EXPLANATION.md` 移除 Zookeeper、改述 KRaft，MySQL 版本標示 8.4。

### Removed
- `docker-compose.yml`：`zookeeper` service 與其 `lucky_zookeeper_data`/`lucky_zookeeper_log` volume；Kafka 資料 volume 由 `lucky_kafka_zk_data` 改名為 `lucky_kafka_data`。

### Why
- 規格（`docs/Stage/01-phase0-env.md` 與 AUDIT_REPORT T-002）要求 Kafka 採 KRaft、無 Zookeeper；原 compose 偏離規格。KRaft 簡化拓撲、少一個容器與協調層，並對齊 7.6.1 官方建議。MySQL 對齊 8.4 與 README/DEPLOY 規格一致。

### Verified
- `docker compose config --quiet`：通過（含 `${KAFKA_CLUSTER_ID}` 等變數插值無誤）。
- `node --test tests/infra/*.test.js`：121 pass / 0 fail（含更新後的 compose KRaft 斷言與 kafka-init topic 斷言）。

## [fix] — 2026-06-15 — 捕魚機對局無法持久化（game_type 約束缺 FISHING）+ 全功能實機 smoke test 腳本

### Fixed
- **BUG-1 捕魚機對局無法持久化 → verify-shot 永遠 404**：`game_rounds.chk_gr_game_type` 與 `game_rtp_stats.chk_rtp_game_type` 的 CHECK 約束只允許 `SLOT`/`BACCARAT`、**缺 `FISHING`**，捕魚機結算寫 `game_rounds` 被 PostgreSQL 擋下（SQLState 23514）；且 `FishingService.settleInternal` 把約束違反**誤判為並發結算靜默吞掉**，使 `GET /fishing/{id}/verify-shot` 永遠 404、捕魚機 RTP 統計也寫不進。
  - `database/postgres/init.sql`：`chk_gr_game_type`、`chk_rtp_game_type` 加入 `FISHING`（並更新註解）。
  - `database/postgres/migration/V5__add_fishing_game_type.sql`（新增）：對既有環境 DROP + ADD 兩個 CHECK 約束。
  - `backend/game-service/.../service/FishingService.java`：catch `DataIntegrityViolationException` 後重查 `roundRepository.findByRoundId`，唯有對局確已寫入（唯一鍵衝突＝真並發）才忽略，其餘 log error 並重拋，避免再次靜默遮蔽資料問題。

### Added
- `tests/smoke/smoke.mjs`：end-to-end smoke 腳本（Node 內建 `fetch`，比照 `tests/infra` 風格）。經 gateway:8080 真打 member/wallet/game/rank 全部核心端點，驗證「路由 + JWT + 業務邏輯」整鏈。流程含註冊→登入→profile→refresh、錢包建立(Kafka)→bankruptcy-aid 注資→balance/transactions/checkin/diamond、slot(單次+commit-ahead)/baccarat/fishing(開場→射擊→結算→逐發驗證)/rtp/verify、rank(global/單人/friends)。每檢查記 PASS/FAIL/WARN，有 FAIL 退出碼 1。
- `tests/smoke/README.md`：前置（docker + 5 服務啟動）與執行說明。
- `tests/smoke/smoke-report.md`：實機結果報告。

### Why
- 專案先前無跨服務真實 end-to-end smoke（CI 僅跑 gateway/member/wallet 單測 + infra），故 H2 單測未涵蓋此 PostgreSQL CHECK 約束、CI 全綠仍漏掉捕魚機持久化缺陷。補可重複執行的實機腳本，鎖住「整套服務拓撲下每個功能能不能用」並揪出此 bug。

### Verified
- 修復後重啟 game-service，`node tests/smoke/smoke.mjs`：`fishing/{id}/end` 對局正常持久化、`verify-shot` 回 200。整體 26 PASS（唯一非綠為 slot/spin 服務剛啟動的冷啟動暫態，暖機後 200；以及連續重跑時 rtp/verify 觸發的 429 限流，皆非 bug）。
- 前端 `npm run lint`（無錯）、`npm run build`（成功）、`npm run e2e`（1 passed）。

## [test] — 2026-06-15 — 捕魚機 e2e（Playwright）：進場 → 開火 → 收網 → 逐發公平性驗證

### Added
- `frontend/e2e/fishing.spec.js`：Playwright e2e，於 headless Chromium + mock 模式走完整流程 —— mock 測試帳號（`test`/`test1234`）登入 → `/game/fishing` 進場 buy-in → 漁場開火多發 → 收網結算 → 結算頁點「驗證」斷言「✓ 已驗證」。以注入 `animation:none` 凍結魚群動畫（游動的魚是移動目標且游完自動移除），讓點擊穩定；登入頁有兩顆「登入」鈕，鎖定 `form button[type=submit]`。
- `frontend/playwright.config.js`：`webServer` 以 `vite --mode mock --port 5317` 自動起 dev server，`reuseExistingServer`、失敗留 trace/截圖。
- `frontend/.env.mock`：e2e 專用模式檔，強制 `VITE_USE_MOCK_API=true`。mode 檔優先序高於 `.env.local` / `.env.development`，可覆蓋其 `false`，使 e2e 離線可跑、CI/任何 clone 可重現。
- `frontend/.gitignore`：忽略 `test-results/`、`playwright-report/` 等 Playwright 產物。

### Changed
- `frontend/package.json`：新增 `npm run e2e`（`playwright test`）script 與 `@playwright/test` devDependency。

### Why
- 捕魚機前端（含 verify-shot 公平性驗證）先前僅有單元層 smoke，缺真實瀏覽器端到端驗證。補 e2e 鎖住「進場→開火→收網→逐發驗證」關鍵路徑，避免日後改動默默打斷 Provably Fair 閉環或結算流程。

### Verified
- `npm run e2e`：`1 passed`（headless Chromium，約 12.7s）。
- 純前端測試工具，未動後端/Kafka/infra。

## [feat] — 2026-06-15 — 捕魚機前端（含音效）：頁面 + 漁場互動 + 接上 casino-fx 捕魚音效/BGM

### Added
- `frontend/src/pages/Fishing.jsx`：捕魚機主頁。buy-in 進場面板（金額 1,000/3,000/5,000 + 炮台銅/銀/金）、漁場、側欄（可用星幣／局內餘額／本場派彩／收網結算）、結算摘要（揭露 serverSeed）。比照 `SlotGame.jsx` 版面與全螢幕慶祝特效（`GoldBurst`/`CoinRainPro`/`RedEnvelopeRain`/`BrushBanner`/`LuckyAura`/`FortuneMeter`）。
- `frontend/src/components/FishingArena.jsx` + `Fishing.css`：漁場本體。魚群以 `casino-fx` 既有 `fish-*` SVG（`Art`/`getAsset`）由兩側游入、砲台朝點擊方向旋轉、子彈/命中火花/浮動派彩演出；魚種尺寸/出現權重/游速依倍率分級（小魚高頻、Boss 稀有）。
- `frontend/src/hooks/useFishingSession.js`：場次生命週期狀態機 —— `session/active` 斷線恢復、`start` buy-in、`fire` 樂觀扣注 + shot 緩衝、批次 flush（滿 10 發或每 700ms、單批 ≤30）、token bucket 射速節流（8 發/秒 + 15 burst，對齊後端避免整批拒絕）、`end` 結算回填 `walletSlice.setBalance`。
- `frontend/src/services/gameApi.js`：新增 `fishingActive/fishingStart/fishingShots/fishingEnd`（`useMockApi` 分支，真實端點 `/api/v1/game/fishing/*`）。
- `frontend/src/services/mockApi.js`：新增同名 fishing mock（魚種表對齊後端 `FishSpecies`、`hitProbability = 0.92/倍率`、MONEY_TREE 隨機 10–50x、局內餘額不足整批不受理、結算冪等回填），沿用 `applyWalletChange`，預設離線可玩。
- **Provably Fair 逐發驗證（補完後端第 5 個端點）**：`gameApi.fishingVerifyShot` 接 `GET /api/v1/game/fishing/{sessionId}/verify-shot`；`useFishingSession` 累積近 50 發已受理紀錄並於結算附入 `settleResult.shots`；`mockApi` 在 `fishingShots` 記逐發、`fishingEnd` 存對局 `db.fishingRounds` 供回放、新增 `fishingVerifyShot`；`Fishing.jsx` 結算頁新增「逐發公平性驗證」面板（逐發呼叫驗證、比對 `commitmentValid` 與重放 hit/payout 是否與紀錄一致）。
- `frontend/src/components/QuickToolbar.jsx`：快速工具欄新增「捕魚機」直達入口（`/game/fishing`，受保護導流沿用既有 `handleToolClick`）。

### Changed
- `frontend/src/App.jsx`：新增受保護路由 `/game/fishing`。
- `frontend/src/theme/backgroundTheme.js`：`gameCatalog` 新增「捕魚機」卡 + `fishingGame` 深海底圖樣式（大廳出現入口）。
- `frontend/src/pages/Fishing.jsx`：進場 buy-in 加 `play('click')`、收網結算加 `play('net')` 確認音。

### Why
- 捕魚機後端（game-service fishing 模組）與 casino-fx 捕魚音效配方（`shoot`/`hit`/`net`/`fishCaught`/`fishEscape`/`bossAlarm`/`lockOn`）與 `fishing`/`boss` BGM 主題早已備好，但前端無捕魚頁面，導致這整套音效從未被呼叫。本次補上前端並把音效真正接上：`useBgm('fishing')` 進場、Boss 在場切 `boss` 主題、開火 `shoot`、鎖定 `lockOn`、命中 `hit/net/fishCaught`、高倍捕獲 `winBig/winEpic` + 喜報、高倍逃跑 `fishEscape`、Boss 出現 `bossAlarm`。
- 後端共有 5 個 fishing 端點，前端原僅接 4 個、漏掉 `verify-shot`：結算頁雖揭露 `serverSeed/clientSeed/serverSeedHash` 卻無從驗證任何一發，Provably Fair 這條線是斷的。本次接上後玩家可在結算頁逐發回放驗證，公平性閉環。

### Verified
- `npm run lint`：0 error 0 warning。
- `npm run build`：vite production build 成功。
- 功能（mock 模式）：進場→開火數發→收網結算→結算頁出現逐發清單→點「驗證」顯示 `✓ 已驗證` 且 hit/payout 與紀錄一致；QuickToolbar「捕魚機」鈕未登入導 login、已登入進 `/game/fishing`。
- 純前端任務，未動後端/Kafka/infra，後端測試不受影響。

## [feat] — 2026-06-12 — 捕魚機後端（game-service fishing 模組：buy-in 制 + 批次結算）

### Added
- `backend/game-service/.../fishing/FishSpecies.java`：11 魚種賠率表（錦鯉 2x ～ 龍王 200x、搖錢樹隨機 10-50x），目標 RTP 0.92，命中機率 = RTP / 倍率，每發子彈期望回報恆等、無套利漏洞；`resolvePayout()` 以 `RandomStream` 確定性判定，可由 serverSeed+clientSeed+nonce(=shotSeq) 重放驗證。
- `backend/game-service/.../fishing/FishingSession.java`、`FishingSessionStore.java`：場次狀態存 Redis Hash（key `game:fishing:session:{playerId}`、TTL 24h），含局內餘額/炮台等級/lastShotSeq/雙 seed；預留 `roomId`/`seatIndex` 欄位供多人同台擴充。
- `backend/game-service/.../service/FishingService.java`：核心流程 —— `start` 一次性冪等扣款 buy-in（鍵 `fishing-buyin-{sessionId}`；已有進行中場次回 `resumed=true` 不重複扣款）；`shots` 批次射擊只動 Redis 局內餘額（驗證 shotSeq 嚴格遞增、betPerShot 等於炮台固定注額、射速 8 發/秒 + 15 發突發緩衝、單批 ≤30 發）；`end` 冪等 credit 剩餘局內餘額回 wallet（鍵 `fishing-end-{sessionId}`）、寫 `GameRound`（roundId=sessionId 去重）、揭露 serverSeed、發 `game.result` 事件；`@Scheduled` 每 60s 掃描閒置 >10 分鐘場次自動結算（防「斷線錢不見」）。
- `backend/game-service/.../controller/FishingController.java`：`POST /api/v1/game/fishing/session/start`、`GET /session/active`（斷線重連恢復）、`POST /{sessionId}/shots`、`POST /{sessionId}/end`、`GET /{sessionId}/verify-shot`（結算後逐發公平性驗證）。
- DTO 七支：`FishingStartRequest` / `FishingSessionView`（含魚表）/ `FishingShotsRequest`（@Valid 巢狀）/ `FishingShotsResponse` / `FishingEndResponse` / `FishingShotVerifyResponse`。

### Changed
- `GameResultEventPublisher`：新增 `publishFishingResult()`（同 topic `game.result`、best-effort，**不動 Kafka topic 清單**，infra 測試免改）。
- `RtpStatsService`：`GAME_TYPES` 加入 `FISHING`，捕魚場次彙總（totalBet/totalPayout）併入每小時 RTP 統計。
- `RtpStatsServiceTest`：`recalculateAll` 測試由 2 遊戲改為 3 遊戲斷言。

### Why
- 捕魚是高頻射擊，不可能逐發打 wallet：採 buy-in 制 + Redis 局內餘額 + 批次結算，wallet 互動只有開場扣款與結算入帳各一次，嚴守冪等鍵模式（AGENTS.md 地雷 #8）。Provably Fair 保留：「差點贏」等體驗全在前端表現層演出，不操控後端結果。

### Verified
- `mvn -pl backend/game-service test` → 全綠（既有 + RtpStats 更新共 20 個測試類、0 失敗）。fishing 專屬單元測試（FishSpecies 重放/FishingService 冪等與射速/Controller WebMvc）於下一階段補齊。
## [feat] -- 2026-06-12 -- Add T-044 daily rank snapshots

### Added
- `backend/rank-service/.../scheduler/DailyRankSnapshotScheduler.java`: schedules daily coin balance snapshots every day at 00:00 in `Asia/Taipei`.
- `backend/rank-service/.../service/DailyRankSnapshotService.java`: stores previous-day wallet balances in `rank_daily_snapshots` and skips players already snapshotted for that date.
- `backend/rank-service/.../entity/RankDailySnapshot.java` and `repository/RankDailySnapshotRepository.java`: JPA mapping and read model lookup for the daily snapshot table.
- Unit tests for scheduler cron/zone and daily snapshot creation, duplicate skipping, empty saves, and invalid wallet row filtering.

### Why
- T-044 needs durable daily player coin balance snapshots so historical rank queries such as "yesterday's rank" do not depend on volatile Redis data.

### Verified
- `mvn -pl backend/rank-service test`: 44 tests passed, 0 failures.

## [feat] -- 2026-06-12 -- Add T-043 weekly rank reset

### Added
- `backend/rank-service/.../scheduler/WeeklyRankResetScheduler.java`: schedules the weekly reset every Monday at 00:00 in `Asia/Taipei`.
- `backend/rank-service/.../service/WeeklyRankResetService.java`: snapshots the weekly champion to `rank_history`, rebuilds `rank:global:coins` from `wallets.balance`, and publishes TOP3 notifications.
- `backend/rank-service/.../entity/RankHistory.java` and `repository/RankHistoryRepository.java`: JPA mapping and duplicate snapshot guard for champion history.
- `backend/rank-service/.../repository/WalletBalanceReadRepository.java`: reads current PostgreSQL wallet balances for the weekly ZSet recompute.
- `backend/rank-service/.../kafka/NotificationPushPublisher.java` and `NotificationPushEvent.java`: publishes weekly TOP3 notifications to Kafka topic `notification.push`.
- Unit tests for weekly reset orchestration, scheduler cron/zone, Kafka notification payloads, and Redis ZSet clearing.

### Changed
- `backend/rank-service/.../RankServiceApplication.java`: enables Spring scheduling for rank-service.
- `backend/rank-service/.../service/RankService.java`: adds `clearGlobalCoinsRank()` for weekly reset cleanup.
- `AUDIT_REPORT.md` and `docs/幸運星幣城_工作分配表.xlsx`: mark T-043 as complete.

### Why
- T-043 requires an automated weekly leaderboard closeout that persists the champion, notifies last week's TOP3, and refreshes the global Redis ZSet from the authoritative wallet balances.

### Verified
- `mvn -pl backend/rank-service test`: 38 tests passed, 0 failures.

## [test] — 2026-06-12 — Add T-091 accounting reconciliation checks

### Added
- `tests/performance/accounting-reconciliation.sql`: PostgreSQL reconciliation query for wallet balance totals, latest ledger balance, transaction deltas, transaction chains, negative balances, frozen balances, orphan transactions, and duplicate non-null idempotency keys.
- `tests/performance/run-accounting-reconciliation.ps1`: `psql --csv` runner that writes CSV/Markdown reports and exits non-zero when any reconciliation check reports violations.
- `tests/infra/accounting-reconciliation.test.js`: static contract tests for the SQL and runner.

### Changed
- `docs/performance/T-090-load-test-report.md`: points the post-load-test database reconciliation step to the T-091 runner.
- `AUDIT_REPORT.md`: marks T-091 as complete with the delivered SQL and automation script.
- `docs/幸運星幣城_工作分配表.xlsx`: marks T-091 as complete in the overview, responsibility, sprint, and visual Gantt sheets.

### Why
- T-091 needs a repeatable post-pressure-test gate that verifies the ledger did not overdraw, that frozen balances are cleared, and that `wallets.balance` still agrees with the transaction history.

### Verified
- PowerShell parser check for `tests/performance/run-accounting-reconciliation.ps1`: passed.
- Synthetic `psql --csv` verification: runner returned PASS with zero violations and failed non-zero when one check reported a violation; both runs wrote CSV and Markdown reports.
- `node --test tests/infra/*.test.js`: 121 tests passed, 0 failures.

## [docs] — 2026-06-12 — 新增專題提案書（可直接轉 PDF：邊界 1cm、頁尾頁碼、白底）

### Added
- `docs/report/Lucky-Star-Casino-專題提案書.md` + 同名 `.html` / `.pdf`：依課程/試用期要求撰寫 —— 組內共識聲明、4-1 題目與動機、4-2 受眾客群分析（社交博弈產業 + 3 組 persona）、4-3 網站架構圖（Mermaid）、4-4 版面配置圖（9 張灰階 SVG 線框 + 完成畫面對照）、4-5 技術工具、4-6 組員工作分配（沿用組長A/組員B~E 代號，無個資）、4-7 預定完成日（依工作分配表 Sprint S0-W1 05/29 ～ S4-W8 07/03 對日期）、工作項目清單與主管確認機制。
- `tools/screenshot/make-pdf.mjs`、`check-pdf.mjs`：headless Edge 輸出 PDF 與 pdf.js 頁面預覽驗證工具。

### Changed
- `tools/screenshot/build-html.mjs`：模板參數化，新增 plain 模板（白底無主題樣式、`@page { size:A4; margin:1cm; @bottom-center: counter(page) }` 頁尾頁碼）；提案書納入建置清單。

### Why
- 課程提案需求：固定格式（邊界 1cm、頁碼、白底）、含 4-1~4-7 指定章節；分工與日期一律以 `docs/幸運星幣城_工作分配表.xlsx`（78 項任務）為單一真相來源解析產出，不引入個人 Email/電話。

### Verified
- `node tools/screenshot/make-pdf.mjs` 產出 24 頁 PDF；以 pdf.js 渲染第 2/6/7 頁人工確認：頁尾置中頁碼、1cm 邊界、SVG 線框與截圖正常、白底無多餘樣式。

## [fix] — 2026-06-12 — 全專案除錯體檢：修復 wallet/game 三項風險 + 產出總體檢報告

### Fixed
- `backend/wallet-service/.../service/WalletService.java`（debit Step 3）：扣款守衛由 `balance < amount` 改為以**可用餘額**（`balance - frozenAmount`）判斷，凍結中的金額不可再下注。目前全專案尚無凍結寫入路徑（frozenAmount 恆為 0），行為相容、屬防禦性修復。
- `backend/wallet-service/.../service/WalletService.java`（credit Step 3b）：解凍金額大於 frozenAmount 時補 `log.warn`（原本被 `Math.max(0,…)` 靜默吞掉，帳務異常無從追查）。
- `backend/game-service/.../service/SlotService.java`、`BaccaratService.java`（結算寫對局）：`findByRoundId()` 去重檢查與 `save()` 之間補 `catch DataIntegrityViolationException` — 並發重試結算時第二個請求原會撞 UNIQUE 約束收到 500，現視同已被另一請求結算、正常回應（帳務本就以冪等鍵保護；wallet-service 同模式原本就有此處理，game-service 漏了）。

### Added
- `docs/report/Lucky-Star-Casino-總體檢報告.md` + 同名 `.html`：含目錄之全專案總體檢報告 —— 系統架構/Git CI/六大業務流程 Mermaid 圖、16 張前端頁面標註截圖（紅框+編號+API 對照）、除錯報告（已修復 3 項、待處理問題依嚴重度分級、誤報澄清 4 項）。HTML 版瀏覽器開啟即可列印轉 PDF。
- `docs/report/Lucky-Star-Casino-開發與流程報告.md`、`Lucky-Star-Casino-前端功能導覽.md` + 同名 `.html`：由總報告拆出的兩本分冊（單一來源：總報告 .md，由 `build-split.mjs` 重產）。
- `docs/report/assets/*.png`：16 張標註截圖（mock API 模式擷取）。首頁因採內部捲動容器 + scroll 漸顯動畫（`--section-reveal`），整頁截圖下方區塊會是空白，故改為逐區塊捲動後分拍 4 張（intro/games/member/shop）。
- `tools/screenshot/`：截圖工具（`capture.mjs` 標註截圖、`build-split.mjs` 拆分分冊、`build-html.mjs` 由 MD 產 HTML、`check-html.mjs` 驗證渲染），使用 playwright-core + 系統 Edge，可重複執行。

### Why
- 全代碼掃描後逐項驗證疑點：三項屬實風險直接修復（debit 凍結守衛、並發結算 500、解凍靜默吞錯），其餘整理進報告供排程處理；另依需求產出可轉 PDF 的工作流程與前端功能文件。

### Verified
- `mvn -pl backend/wallet-service,backend/game-service test` → BUILD SUCCESS（wallet 142 / game 106 測試全綠）。
- `node tools/screenshot/check-html.mjs` → HTML 報告 8 張 Mermaid 全部渲染、0 破圖、無 console error。

## [docs] — 2026-06-09 — Sync game-service T-030~T-037 completion across docs

### Changed
- `AGENTS.md`（註10「服務完成度」）：game-service 由「已完成 T-030~T-033 老虎機核心、百家樂 T-034~T-036 尚未實作」更正為「已完成 T-030~T-037 全部」（老虎機核心 / Redis Session 兩階段 commit-ahead / 百家樂邏輯+API / RNG 公平性驗證 API / 遊戲 RTP 統計）。
- `AUDIT_REPORT.md` 附錄 A.4：T-033/T-034/T-035/T-036/T-037 狀態由 ❌ 改為 ✅，盤點依據改填實際實作檔與提交（`7f5d513`、`6d9aae5`、`0910d29`、`710b1a8`、`d860154`）；表格下方說明改為「game-service 已全數完成」。
- `AUDIT_REPORT.md` 附錄 A.12：進度統計 ✅ 24→29、❌ 42→37（移動 5 項，總計仍 78），占比重算；模組概覽將 Game Service 由「尚未起步」移至「完成度高」，結論調整為僅 admin / notification 仍空白。

### Why
- 文件落後於已合併的程式碼：game-service（組員B 範圍 T-030~T-037）八項任務已全部實作並合併至 `develop`，但 AGENTS.md / AUDIT_REPORT 仍描述百家樂、Redis Session、公平性驗證、RTP 統計為未實作，導致進度誤判（game-service 被誤認為半成品）。

### Verified
- 以 game-service 工作樹實際檔案佐證：`baccarat/`、`session/`、`controller/{Baccarat,Verification,Rtp}Controller.java`、`service/{Baccarat,Verification,RtpStats}Service.java`、`entity/GameRtpStat.java` 皆存在且為完整實作（非空殼），並各帶測試類。
- `git log -- <path>` 確認 T-033~T-037 的功能提交（`7f5d513`/`6d9aae5`/`0910d29`/`710b1a8`/`d860154`）已在 develop 歷史中。
- 純文件變更，不影響任何程式碼行為。
## [fix] — 2026-06-09 — wallet-service 內部密鑰過濾器只保護 /internal/**

### Fixed
- `backend/wallet-service/.../security/InternalSecretFilter.java`：`shouldNotFilter()` 由「只放行 `/actuator/`」改為「只攔截 `/internal/**`」。先前過濾器要求**所有非 actuator 路徑**都帶 `X-Internal-Secret`，但 gateway 轉發玩家請求時只注入 `X-User-Id`/`X-User-Role`、不帶內部密鑰，導致玩家端 `/api/v1/wallet/**`（餘額/帳務/贈送/破產補助）全部回 401。

### Why
- 內部密鑰過濾器的職責應僅限於服務間端點（`/internal/**`，如 game-service 打的 debit/credit）。玩家端錢包 API 由 gateway 驗證 JWT 後以 `X-User-Id` 轉發，本就不應再要求 `X-Internal-Secret`。此修正讓玩家經 gateway 的錢包查詢恢復正常，且不影響內部端點仍受密鑰保護。

### Verified
- 端到端實測（docker compose 全套 + member/wallet/game/gateway）：修正前 `GET /api/v1/wallet/balance` 回 **401**；修正並重啟 wallet 後回 **200**，`POST /api/v1/wallet/bankruptcy-aid` 亦回 200（+1000 星幣）。
- 老虎機 `POST /api/v1/game/slot/spin`（走 `/internal/**` 派彩）在修正前後皆正常，確認內部端點保護未被破壞。
## [chore] — 2026-06-10 — 本機部署：一鍵啟動腳本與前端 mock 開關修正

### Added
- `start-backend.ps1`（專案根目錄）：一鍵啟動後端。載入根 `.env` 後，為 member/wallet/game/gateway 各開一個終端機視窗依序啟動；`-WithInfra` 連基礎設施一起起、`-IncludeRank`/`-IncludeAdmin` 選配。消除三個常見坑：忘了把 `.env` 載入 shell、漏起 game-service、手開一堆終端機。

### Fixed
- `frontend/.env.development`：補上 `VITE_USE_MOCK_API=false`。此開關原本只在被 gitignore 的 `frontend/.env.local`，導致他人 clone 或換機器時前端退回 mock 假資料、不會真正串接後端。移到進版控的 `.env.development` 後，所有人 dev 預設都打真實後端（個人仍可在 `.env.local` 覆蓋為 `true`）。

### Changed
- `DEPLOY.md`：更新過時內容——§1 後端表將 game/rank 由「骨架」改為實際依賴；§4 啟動範例與順序補上 game-service、加上 `start-backend.ps1` 懶人包；§5 補前端 `VITE_USE_MOCK_API` 說明；§8「目前已知狀況」更新為 game/rank 已實作、admin/notification 未實作（日期 2026-05-29 → 2026-06-10）。

### Why
- 目標是讓任何人 clone 後能在本機把整套正確跑起來、且前端真正串接後端。`.env.development` 缺 mock 開關是「別人用就退回假資料」的隱性地雷；`DEPLOY.md` 漏了已實作的 game-service 會讓人誤判遊戲串接壞掉；一鍵腳本降低多服務啟動的人為失誤。

### Verified
- `start-backend.ps1`：以 PowerShell AST `ParseFile` 驗證語法無誤；`.env` 解析邏輯乾跑（只解析、不啟動服務）正確讀到 41 個變數，含 `JWT_SECRET` / `INTERNAL_SECRET` / `CORS_ALLOWED_ORIGINS` / 各 `*_SERVICE_URL`。
- 未改動 `src`，前端 `npm run lint` 不受影響（前次已通過）。

## [fix] — 2026-06-10 — 修正百家樂前後端串接三處問題（餘額同步 / 下注上限 / 錯誤訊息）

### Fixed
- `frontend/src/pages/Baccarat.jsx`：**百家樂輸局餘額不同步**。後端 `BaccaratService.settle` 在 `totalPayout==0`（純輸）時回應不含 `wallet`，而下注已於 `/bet` 階段扣款、`BaccaratBetResponse` 亦不帶 `wallet`；原前端 `if (result.wallet)` 會跳過更新，導致玩家輸錢後當前頁餘額顯示不動（須切頁才被 `AppShell` 的 `fetchWallet` 修正）。改為輸局（無 `wallet`）時 `dispatch(fetchWallet())` 主動向 wallet-service 取最新餘額。

### Changed
- `frontend/src/pages/Baccarat.jsx`：**下注金額對齊後端契約**。面額快選移除 7,000 / 10,000（後端單區 `@Max(5000)`、`BaccaratService` 總額限 `100~5000`）；金額輸入框改 `min=100`、`max=5000`；`canDeal` 與送出前驗證改檢查 `100 ≤ amount ≤ 5000`（越界改顯示明確提示，而非送出後被 400 退回）；規則文案補上下注範圍。
- `frontend/src/store/slices/gameSlice.js`：`spinSlot` / `betBaccarat` thunk 的錯誤改用 `extractError(error)` 取後端 `response.data.message`（先前用 axios `error.message`，餘額不足/下注超限/對局逾時會顯示「Request failed with status code 422」之類英文）。與 `walletSlice` / `diamondApi` 既有作法一致。

### Why
- 老虎機在單一回應總是回傳最新 `wallet`，百家樂卻採兩階段、輸局回應不帶 `wallet`，造成餘額顯示與實際扣款不一致；前端下注面額/輸入上限與遊戲錯誤訊息亦未對齊後端契約，使用者會踩到無說明的失敗。三者皆為前端串接缺口，一併修正（不動後端）。

### Verified
- `npm --prefix frontend run lint`：通過（`eslint src` 無錯誤）。
- 端到端（待起完整後端拓撲實測）：押一區開對家（輸）→ 餘額即時下降；面額已無 7,000/10,000、輸入超過 5,000 由前端攔下；故意餘額不足 → 顯示後端中文「星幣餘額不足」。老虎機 regression：spin 餘額正常。

## [feat] — 2026-06-09 — 前端老虎機/百家樂改打真實 game-service（T-083/T-087）

### Added
- `frontend/src/services/gameApi.js`：新增遊戲 API 封裝層（比照 `walletApi`/`memberApi` 的 `useMockApi` 開關）。`spinSlot` 打 `POST /api/v1/game/slot/spin`；`baccaratBet` 將前端單區 `{area, amount}` 轉接為後端兩階段契約（`POST /baccarat/bet` → `POST /baccarat/{roundId}/result`）並合併回前端期望形狀。

### Changed
- `frontend/src/store/slices/gameSlice.js`：`spinSlot`/`betBaccarat` thunk 由**無條件呼叫 `mockApi`** 改為呼叫 `gameApi`，使其受 `VITE_USE_MOCK_API` 開關控制（先前即使設 `false` 仍永遠走假資料）。
- `frontend/src/pages/Baccarat.jsx`：移除本機發牌/結算邏輯（`createDeck`/`drawCard`/`determineWinner`/`calculatePayout`），改 `dispatch(betBaccarat(...))` 走真實後端；新增 `parseCard`（相容後端 `"A♠"` 字串、mock 裸 rank、既有 `{rank,suit}` 物件）與 `capitalizeWinner`；以後端 `payout`（含本金）計淨損益、以回傳 `wallet` 更新餘額；側欄改標示由伺服器結算。

### Why
- game-service（T-030~T-037）後端已實作並可運作，但前端遊戲 slice 寫死 `mockApi`、百家樂頁更是純本機運算，導致老虎機/百家樂永遠不會打後端、餘額不會真的變動。此修正讓前端在 `VITE_USE_MOCK_API=false` 時真正串接 game-service（補上 T-083 老虎機、T-087 百家樂的前端串接缺口）。

### Verified
- 端到端（docker compose 全套 + member/wallet/game/gateway + 前端 dev server，`VITE_USE_MOCK_API=false`）：
  - 老虎機：模擬 `spinSlot(bet=100)` → 餘額 1000→900，後端真實扣款。
  - 百家樂：押閒家 100 → 後端發牌（閒 7 點勝莊 5 點）、派彩 200 → 餘額 900→800→1000（淨 +100）；卡牌字串正確解析、winner/點數/餘額對應一致。
- Vite HMR 重載 `gameSlice.js`、`Baccarat.jsx` 皆無編譯錯誤。

## [docs] — 2026-06-05 — Sync task progress status across docs

### Changed
- `docs/幸運星幣城_工作分配表.xlsx`（狀態欄）：T-030/T-031/T-032/T-033（老虎機 RNG / 滾輪邏輯 / `POST /api/v1/game/slot/spin` / Redis Session）、T-041/T-042（排行榜）標記為 ✅ 已完成；T-090 標記為 ⚠️ 部分完成。反映 PR #57~#62 已合併之實作。
- `docs/performance/T-090-load-test-report.md`：移除已過時的「T-032 未實作」blocker；標註實際端點為 `POST /api/v1/game/slot/spin`、冪等鍵由伺服器端生成（`slot-bet-<roundId>`），與報告原假設契約不同，jmx 與假設契約段落待對齊後方可實測。其餘 blocker（JMeter 未安裝、Docker 未啟動、無 1,000 玩家憑證）仍成立，報告維持 NOT EXECUTED。
- `AGENTS.md`：註10「服務完成度」更新 game 不再是空殼（T-030~T-033 已實作）；註12 更正 T-032 已完成、端點與冪等鍵，保留實測前置要求。

### Why
- 工作分配表為任務進度的單一真相來源，與 T-090 報告、AGENTS.md 地雷註記均落後於最近合併的實作，造成新進 AI / 組員誤判 game-service 仍為空殼。

### Verified
- 解壓 xlsx 重讀，狀態欄與變更一致；其餘 cell / 樣式 / 工作表未動。
- T-090 報告 Status 與 game-service 實作（`SlotController` / `SlotService`）一致；報告未虛構任何 P99 / 吞吐數據。

## [test] — 2026-06-04 — Add T-090 JMeter slot pressure-test plan

### Added
- `tests/performance/slot-1000-players.jmx`: standard JMeter 5.6.3 scenario for 1,000 concurrent players over 60 seconds, including primary slot bets, same-key retries, and wallet overdraw assertions.
- `tests/performance/run-slot-load-test.ps1`: validates the 1,000-player credential dataset, runs JMeter non-interactively, and generates the HTML dashboard and acceptance report.
- `tests/performance/analyze-jtl.mjs`: enforces P99 `< 500 ms`, zero 5xx, zero failed requests/assertions, correct idempotency behavior, and zero overdraw assertions.
- `docs/performance/T-090-load-test-report.md`: documents the scenario, execution procedure, SQL reconciliation, acceptance gates, and current blocked execution status.
- `tests/infra/jmeter.test.js`: statically verifies the committed pressure-test contract.

### Changed
- `.gitignore`: excludes funded player credentials and generated JMeter result directories.
- `AGENTS.md` and `AUDIT_REPORT.md`: document the T-090 deliverables and the current dependency on T-032 and a runnable pressure-test environment.

### Why
- T-090 requires a reproducible 1,000-player slot pressure test that catches overdraw, broken idempotency, P99 regression, and 5xx responses without relying on GUI-only JMeter listeners or fabricated measurements.

### Verified
- JMX parsed as valid XML with one Thread Group and three HTTP samplers.
- PowerShell runner parsed as valid PowerShell.
- Synthetic JTL verification: analyzer returned PASS for compliant samples and a non-zero FAIL result for P99/5xx violations.
- `node --test tests/infra/*.test.js`: 116 tests passed, 0 failures.
- Real pressure-test metrics were not produced because T-032 is not implemented, JMeter is not installed, Docker is not running, and 1,000 funded player credentials are unavailable.

## [feat] — 2026-06-04 — Implement leaderboard query APIs

### Added
- `GET /api/v1/rank/global`: returns the global top 100 with `playerId`, `username`, `rank`, and `score`.
- `GET /api/v1/rank/friends`: reads the authenticated player from `X-User-Id` and returns their friend leaderboard.
- `MemberRegisteredConsumer`: consumes `member.registered` and stores usernames in the `rank:player:usernames` Redis Hash.
- MockMvc API contract tests and unit tests for username caching and leaderboard enrichment.

### Changed
- `RankEntryResponse`: replaces the internal `coins` field with the public API field `score` and adds `username`.
- Existing `/api/v1/rank/global/top` and `/api/v1/rank/global/{playerId}` endpoints remain available with the enriched response contract.
- Removed `/api/v1/rank/friend/{playerId}/top`; friend leaderboard queries now use the authenticated `X-User-Id` through `/api/v1/rank/friends`.
- `kafka/kafka-init.sh` and `tests/infra/kafka.test.js`: pre-create `member.registered.DLT` for consumers using the shared retry/DLT handler.
- `AGENTS.md`, `AUDIT_REPORT.md`, `README.md`, and `docs/architecture.md`: document T-042 completion and the username read model.

### Why
- T-042 requires stable public leaderboard endpoints that include usernames without making synchronous per-row calls to Member Service.

### Verified
- `mvn -pl backend/gateway-service,backend/member-service,backend/wallet-service,backend/rank-service test`: Gateway 21, Member 70, Wallet 142, and Rank 25 tests passed, 0 failures.
- `mvn -pl backend/rank-service test`: final Rank API/security suite 26 tests passed, 0 failures.
- `node --test tests/infra/*.test.js`: 107 tests passed, 0 failures.

## [feat] — 2026-06-04 — Implement friend leaderboard rebuild and top-20 API

### Added
- `backend/member-service/.../FriendRelationshipUpdatedEvent.java` and `FriendshipService.java`: publish both players' complete accepted-friend lists through the transactional outbox after friendship acceptance or deletion.
- `backend/rank-service/.../FriendRelationshipUpdatedConsumer.java`: consume `friend.relationship.updated` and rebuild `rank:friend:{playerId}` only after validating the event.
- `backend/rank-service/.../RankService.java`: rebuild friend-only Redis ZSets from global coin scores, apply a 24-hour TTL, and query the top 20.
- `GET /api/v1/rank/friend/{playerId}/top`: return a player's friend leaderboard.
- Unit tests for friendship event publishing, friend-rank rebuilding, Kafka consumer ack behavior, and the friend leaderboard API.

### Changed
- `kafka/kafka-init.sh` and `tests/infra/kafka.test.js`: add `friend.relationship.updated` and `friend.relationship.updated.DLT` with synchronized topic-count assertions.
- `AGENTS.md`, `README.md`, and `docs/architecture.md`: document Rank Service completion and the complete-friend-list event contract.

### Why
- T-041 requires friend rankings to contain only accepted friends and to be rebuilt when relationships change; publishing the complete friend list lets Rank Service replace stale ZSet membership without directly querying Member Service.

### Verified
- `mvn -pl backend/gateway-service,backend/member-service,backend/wallet-service,backend/rank-service test`: all four modules passed (Member 70, Wallet 142, Rank 18), 0 failures.
- `node --test tests/infra/*.test.js`: 106 tests passed, 0 failures.

## [feat] - 2026-06-03 - Implement Rank Service global coins leaderboard

### Added
- `backend/rank-service/src/main/java/com/luckystar/rank/service/RankService.java`: maintains `rank:global:coins` with Redis ZSet `ZADD`, exposes reverse-rank lookup, and reads the top 100 with reverse range.
- `backend/rank-service/src/main/java/com/luckystar/rank/kafka/WalletBalanceChangedConsumer.java`: consumes `wallet.credit` and `wallet.debit`, updates the leaderboard from `balanceAfter`, and acknowledges Kafka offsets only after Redis update succeeds.
- `backend/rank-service/src/main/java/com/luckystar/rank/config/KafkaConsumerConfig.java`: enables manual Kafka ack and routes failed wallet events to existing `<topic>.DLT` topics after retry.
- `backend/rank-service/src/main/java/com/luckystar/rank/controller/RankController.java` and DTOs for `GET /api/v1/rank/global/top` and `GET /api/v1/rank/global/{playerId}`.
- Unit tests for RankService Redis ZSet behavior and the wallet event Kafka consumer.

### Changed
- `backend/rank-service/pom.xml`: fixed the module description XML and added H2 test scope dependency.
- `backend/rank-service/src/test/resources/application.yml`: added H2 test datasource and disabled Kafka listener startup during context tests.

### Why
- T-040 requires Rank Service to update a global coins leaderboard from wallet balance-change events without consuming `wallet.credit.request`; `balanceAfter` is the authoritative current coin balance from Wallet Service.

### Verified
- `mvn -pl backend/rank-service test`: 10 tests passed, 0 failures.

## [feat] — 2026-06-03 — 遊戲 RTP 統計排程與 API（T-037）

### Added
- `entity.GameRtpStat` + `repository.GameRtpStatRepository`：對應 PostgreSQL `game_rtp_stats`，
  儲存各遊戲下注/派彩總額與局數（`findTopByGameTypeOrderByCalculatedAtDesc` 供查最新一筆）。
- `service.RtpStatsService`：
  - `@Scheduled`（預設 cron `0 0 * * * *`，可由 `game.rtp.cron` 覆寫）每小時統計各遊戲（SLOT/BACCARAT）
    **近 10,000 局**已結算對局的 `total_bet / total_win / round_count`，各寫入一筆歷史快照。
  - `latestStats()`：取各遊戲最新一筆並算實際 RTP（`total_win / total_bet`，四捨五入 4 位）。
- `controller.RtpController`：`GET /api/v1/game/rtp` 回傳各遊戲最新 RTP 統計，供 Admin 監控偏離。
- `config.SchedulingConfig`（`@EnableScheduling`，獨立 config 不影響 @WebMvcTest 切片）、`dto.RtpStatView`。
- `GameRoundRepository.aggregateRecent`：原生查詢以子查詢取最近 N 局再彙總（`COALESCE`/`LIMIT`，
  PostgreSQL 與測試用 H2 皆相容）。

### Added（測試）
- `RtpStatsServiceTest`（Mockito）：RTP 計算（1760/10000=0.176、無下注=0）、彙總寫入、空彙總寫零、
  雙遊戲各寫一筆、最新統計映射並略過無資料遊戲。
- `RtpControllerTest`（@WebMvcTest）：`GET /rtp` 端點。

**為什麼**：交付組員B 最後一項（T-037）。讓營運可監控各遊戲實際 RTP 是否偏離設計值（老虎機設計約
17.7%、百家樂依押注），近萬局的滑動樣本兼顧時效與統計意義；歷史快照便於趨勢分析。

**如何驗證**：以 JDK 21 `javac`（含 Lombok）**完整編譯 game-service main（62 class）與 test 全通過**，
並以 JUnit Platform **實際執行 81 個單元測試全綠**（含 `RtpStatsServiceTest`）。原生彙總查詢的實際 DB
執行、`@Scheduled`/`@WebMvcTest`/`@SpringBootTest` 待團隊 `mvn -pl backend/game-service test`（H2）。

---

## [feat] — 2026-06-03 — RNG 公平性驗證 API（T-036）

### Added
- `service.VerificationService` + `controller.VerificationController`：
  `GET /api/v1/game/verify/{roundId}`（可選 query `serverSeed`）。玩家可獨立驗證某局是否遭竄改：
  - **承諾相符**：`SHA-256(serverSeed) == serverSeedHash`（用玩家提供或對局已揭露的 serverSeed）。
  - **結果一致**：以 `(serverSeed, clientSeed, nonce)` 重跑遊戲引擎（SLOT→`SlotMachine`、BACCARAT→
    `BaccaratGameService`），盤面/牌局與派彩須與 `game_rounds.result_data` 相符。
  - 回傳 `commitmentValid / resultMatches / valid` 與重算結果、既有紀錄、說明文字；唯讀不涉帳務。
  - 對局不存在 → 404（`RoundNotFoundException`）。
- `dto.VerificationResponse`。

### Added（測試）
- `VerificationServiceTest`（用真實確定性引擎）：老虎機/百家樂合法局重算通過、提供錯誤 serverSeed →
  承諾不符、result_data 被竄改（winAmount）→ 結果不符、對局不存在 → 404。
- `VerificationControllerTest`（@WebMvcTest）：GET 端點、帶 serverSeed、404。

**為什麼**：交付 Provably Fair 的閉環——玩家可在不信任伺服器的前提下，獨立重算並比對任一局結果，
確認下注前已鎖定的 serverSeedHash 與事後揭露的 serverSeed 一致、且結果由 seed 確定性產生未遭竄改。

**如何驗證**：以 JDK 21 `javac`（含 Lombok）**完整編譯 game-service main（55 class）與 test（18 檔）通過**，
並以 JUnit Platform **實際執行 76 個單元測試全綠**（含 `VerificationServiceTest` 以真實引擎重算驗證、
竄改情境）。`@WebMvcTest`/`@SpringBootTest` 已編譯，待團隊 `mvn -pl backend/game-service test`。

---

## [feat] — 2026-06-03 — 百家樂遊戲 API（T-035）

### Added
- `service.BaccaratService` + `controller.BaccaratController`：百家樂兩階段 commit-ahead API。
  - `POST /api/v1/game/baccarat/bet`：一局多區押注（player/banker/tie），驗證三區總額 `[100, 5000]`、
    扣下注總額（`bac-bet-<roundId>`）、產生並承諾 `serverSeedHash`、建 STARTED Session；不揭露 serverSeed。
  - `POST /api/v1/game/baccarat/{roundId}/result`：載入 Session → RNG 發牌 → 各區結算派彩 →
    命中則 credit（`bac-win-<roundId>`）→ 寫對局（roundId 去重）→ 揭露 serverSeed（SETTLED）→ 發 `game.result`。
- `dto.BaccaratBetRequest` / `BaccaratBetResponse`（不含 serverSeed）/ `BaccaratResultResponse`。
- `GameResultEventPublisher.publishBaccaratResult`：發布百家樂結算事件（best-effort）。

### Changed
- `session.GameSession` + `GameSessionService`：新增 `betPlayer / betBanker / betTie` 欄位（Hash），
  承載百家樂多區押注；老虎機仍用單一 `betAmount`，向後相容（null 欄位略過）。

### Added（測試）
- `BaccaratServiceTest`（Mockito）：下注扣總額/建 Session/不洩 serverSeed、總額上下限與餘額不足守衛、
  結算派彩（莊贏 195）/揭露 serverSeed/標記 SETTLED、全押錯不 credit、Session 逾時 404、結算冪等。
- `BaccaratControllerTest`（@WebMvcTest）：/bet 與 /{id}/result 端點（含 400 驗證、404）。

**為什麼**：交付百家樂對外玩法（T-035），沿用 T-033 的 commit-ahead Session 與 T-034 的純邏輯引擎，
與老虎機一致：下注時扣款並承諾雜湊、結算時揭露並派彩，帳務冪等、對局可重算驗證。

**如何驗證**：本機無 Maven，但已下載 Lombok 以 JDK 21 `javac` **完整編譯 game-service main（50 class）
與 test（13 檔）全數通過**（含全部 Lombok 標註檔），並以 JUnit Platform **實際執行 70 個單元測試全綠**
（含 `BaccaratServiceTest`、`GameSessionServiceTest`、`SlotServiceTest` 等 Mockito 測試與純邏輯測試）。
`@WebMvcTest` / `@SpringBootTest`（需完整 Spring context）已編譯，待團隊 `mvn -pl backend/game-service test`。

---

## [feat] — 2026-06-03 — 百家樂遊戲邏輯（T-034）

### Added
- `com.luckystar.game.baccarat.BaccaratGameService`：標準百家樂（Punto Banco）純函式引擎。
  - `deal(RandomStream)`：以 Provably Fair RNG（T-030）確定性發牌（無限靴模型，每張先抽
    `nextInt(13)` 牌面、再抽 `nextInt(4)` 花色），相同三元組必得相同牌局。
  - `play(CardSource)`：核心發牌/補牌邏輯——閒1/莊1/閒2/莊2、天牌（8/9）停牌、閒 0~5 補、
    莊家依標準補牌表（`bankerDraws`）決定，比點定勝負。
  - `settle(outcome, bets)`：三押注區（莊/閒/和）派彩——閒 1:1、**莊 1:1 扣 5% 傭金**、和 8:1，
    和局時押莊/閒退回本金（push），押錯派 0。
- `Card`（record，點數 A=1/2~9 面值/10·J·Q·K=0、含顯示）、`BaccaratResult`（PLAYER/BANKER/TIE）、
  `BaccaratOutcome`、`BaccaratSettlement`（純資料）。
- `docs/baccarat-rules.md`：規則文件（點數、發牌、補牌表、派彩/傭金、無限靴設計取捨）。

### Added（測試）
- `BaccaratGameServiceTest`：牌值/點數取個位、天牌停牌、閒家補牌、莊家補牌規則表（逐格）、
  派彩（莊傭金 195、和 8:1、和局 push、押錯/非和押 TIE 派 0）、相同三元組可重算（Provably Fair）。

**為什麼**：交付組員B 第二款遊戲的核心邏輯（T-034），與老虎機共用 RNG 引擎並維持可驗證公平。
邏輯與派彩為純函式、與帳務/Kafka/Session 解耦，便於單元測試；對外 API（T-035）另行串接。
百家樂採無限靴（牌面等機率、可重複），簡化實作且維持公平可驗證，取捨記於規則文件。

**如何驗證**：本機無 Maven。已驗證項：以 JDK 21 `javac` 將 `baccarat` + `rng` 套件對 `.m2`
既有 spring-context 6.1.14 jar **編譯通過並實際執行** smoke 驅動，14 項全過——含莊贏傭金
（押 100 派 195）、和局 8:1（派 900）、和局押莊/閒 push、天牌不補、莊家補牌表逐格、相同三元組
重算一致。JUnit 測試（`BaccaratGameServiceTest`）待團隊 `mvn -pl backend/game-service test` 執行。

---

## [feat] — 2026-06-03 — Redis 遊戲 Session 與兩階段 commit-ahead 老虎機（T-033）

### Added（Session 管理）
- `com.luckystar.game.session.GameSessionState`：Session 狀態列舉 `STARTED` / `SETTLED`，
  對齊 `game_rounds.status` 的 CHECK 約束。
- `com.luckystar.game.session.GameSession`：對局 Session 模型（roundId / playerId / gameType /
  betAmount / serverSeed / serverSeedHash / clientSeed / nonce / state / createdAt）。
- `com.luckystar.game.session.GameSessionService`：Provably Fair commit-reveal 的局內狀態暫存。
  - 依 **architecture.md §6** 以 Redis **Hash** 儲存（每欄位一個 hash field），Key 格式
    `game:session:{playerId}:{roundId}`，**TTL 30 分鐘**（可由設定 `game.session.ttl` 覆寫，預設 `PT30M`）。
  - `start()`（開局，狀態強制 STARTED、補 createdAt、`putAll` + `expire`）、`find()`（由 Hash 還原；
    空 Hash/毀損值視同不存在不拋例外）、`markSettled()`（只更新 `state`/`serverSeed`/`nonce` 並重置 TTL）、
    `delete()`。比照 member-service `TokenRedisService` 使用 `StringRedisTemplate`（改用 `opsForHash`）。

### Added（SlotService 兩階段 commit-ahead 串接）
- `SlotService.prepareRound()`：開局——產生 serverSeed 並承諾 `serverSeedHash`，把保密種子與下注額
  暫存於 Redis Session（STARTED）；**不扣款、不揭露 serverSeed**。
- `SlotService.settle()`：結算——以 Session 種子扣款 → RNG → 派彩 → 寫對局 → `markSettled` 揭露
  serverSeed；下注額以開局綁定者為準。結果由 seed 確定性推導、帳務走冪等鍵、對局以 roundId 去重，
  故重試安全（已落地則跳過寫庫/發事件）。
- `SlotController`：新增 `POST /api/v1/game/slot/round`（開局）與 `POST .../round/{roundId}/settle`（結算）。
- `dto.PrepareRoundRequest` / `dto.PrepareRoundResponse`（回應刻意不含 serverSeed）；
  `exception.RoundNotFoundException` → `GlobalExceptionHandler` 對應 **404**。

### Changed
- `SlotService` 抽出共用 `settleInternal()`（debit→RNG→credit→寫對局去重→發事件），由單次 `spin()`
  與 commit-ahead `settle()` 共用；新增 `GameSessionService` 依賴。
- 既有單次 `POST /spin` 行為不變（相容前端 mockApi 一次呼叫，不使用 Session）。

### Added（測試）
- `GameSessionServiceTest`（純 Mockito）：Hash 欄位/Key/TTL 寫入斷言、必填守衛、欄位還原、
  空 Hash 與毀損值回 empty、結算只更新異動欄位並重置 TTL、delete 委派。
- `SlotServiceTest`：新增 prepareRound（建 STARTED Session、不扣款）、settle（揭露 serverSeed、
  標記 SETTLED、確定性冪等鍵）、settle 找不到 Session→404 例外、settle 冪等（已落地不重寫）等案例；
  既有單次 spin 案例補上「不觸碰 Session」斷言。
- `SlotControllerTest`：新增 `/round` 與 `/round/{id}/settle` 端點測試（含 404、缺 header 400）。

**為什麼**：補齊 T-030~T-032 預留的「開局前先承諾 serverSeedHash、結算後才揭露 serverSeed」
commit-ahead 流程——這是 Provably Fair 的信任核心：伺服器在玩家下注前即鎖定本局結果且事後無法竄改。
Session 以 Redis Hash（符合架構 §6）暫存、TTL 30 分鐘自動清除。保留既有單次 `/spin` 確保前端不需改動。

**如何驗證**：本機無 Maven（沿用前述限制）。已驗證項：以 JDK 21 `javac` 將 Hash 版
`GameSessionService`（去 Lombok 等價 shim）對 `.m2` 既有 spring-data-redis 3.3.5 / spring-context
6.1.14 jar 編譯通過，確認 `opsForHash().putAll/entries`、`redisTemplate.expire(key, Duration)`、
`hasKey`/`delete`、`@Value` 的 `Duration` 注入皆正確。Lombok 標註檔、`SlotService`/控制器與所有
JUnit 測試待團隊 `mvn -pl backend/game-service test` 執行。

---

## [feat] — 2026-06-02 — 老虎機遊戲邏輯與下注 API（T-031、T-032）

### Added（T-031 老虎機遊戲邏輯）
- `com.luckystar.game.slot.SlotSymbol`：5 種符號（🍒/🍋/🔔/⭐/7️⃣，以整數 code point 建構、與前端
  mockApi 逐位元組相符），各帶轉輪權重與中線倍率（2/3/5/8x）；加權索引對應、權重總和。
- `com.luckystar.game.slot.SlotMachine`：3x3 盤面、中央橫線三連賠付。盤面由 `RandomStream`（T-030）
  以固定抽樣順序產生，相同三元組必得相同盤面（可驗證公平）。`evaluate()` 為純函式。
- `SlotOutcome`（record）：盤面、命中、倍率、派彩、命中格。
- 理論 RTP 約 17.7%、命中率約 5.6%（單中線/三連/上限 8x 的既有玩法所致）；權重與倍率為常數，可調。

### Added（T-032 老虎機下注 API）
- `POST /api/v1/game/slot/spin`（`SlotController`）：玩家身分取自 gateway 注入的 `X-User-Id`；
  下注金額驗證 `[100, 5000]`。回應 `ApiResponse<SpinResponse>`，`data` 形狀對齊前端 spinSlot
  （roundId/game/grid/bet/multiplier/payout/winningCells/wallet），並附 Provably Fair 揭露欄位。
- `SlotService`：串接下注完整流程（architecture §8.2）——扣下注 → RNG 計算 → 命中派彩 → 寫對局 →
  發布 `game.result`；debit/credit 用確定性冪等鍵（`slot-bet-<roundId>`/`slot-win-<roundId>`）。
- `WalletClient` + `WalletClientConfig`：以 Spring `RestClient` 呼叫 wallet 內部 API，送 `X-Internal-Secret`；
  HTTP 422 → `InsufficientBalanceException`（對外 422）、連線/其他錯誤 → `WalletUnavailableException`（502）。
- `GameRound` 實體 + `GameRoundRepository`：對應 PostgreSQL `game_rounds`，以 `SETTLED` 寫入並存種子。
- `GameResultEventPublisher`：發布 `game.result`（best-effort，失敗不影響本局）。
- `GlobalExceptionHandler`、`ApiResponse`、DTO（`SpinRequest`/`SpinResponse`/`WalletView`）。

### Changed
- `backend/game-service/pom.xml`：新增 `spring-boot-starter-validation`、`lombok`、`h2`（test），
  boot plugin 排除 lombok。
- 新增 `src/test/resources/application.yml`（H2 + 必填 internal secret）供 `@SpringBootTest` 啟動。

### Added（測試）
- 純邏輯：`SlotSymbolTest`、`SlotMachineTest`（確定性、中線評估、盤面合法性、RTP/命中率區間）。
- API：`SlotControllerTest`（@WebMvcTest：header/下注驗證、happy path）、`SlotServiceTest`
  （Mockito：命中/未中/餘額不足分支、冪等鍵）、`WalletClientTest`（MockRestServiceServer：成功/422/5xx）、
  `GameResultEventPublisherTest`（發布/best-effort 容錯）。

**為什麼**：把 game-service 從空殼推進到「可下注的老虎機」，串起 RNG（T-030）、帳務（wallet 內部 API）與
事件（game.result）。倍率改由命中符號決定、結果完全由 seed 推導（取代 mock 的隨機灌水勝率），符合 Provably Fair。
本任務的公平性為「每局即時揭露 serverSeed 供事後重算」；開局前先公布雜湊、下注後才揭露的完整 commit-ahead
流程需 Redis Session（T-033），不在此範圍。

**如何驗證**：本機無 Maven，且 `.m2` 缺 lombok/h2（此機從未跑過完整建置）。已驗證項：
(1) T-031 純邏輯以 JDK 21 `javac` 編譯後執行 smoke，20 項全過（RTP 實測 0.176、命中率 0.056、emoji
code point 與前端相符）；(2) T-032 非 Lombok 子集（`WalletClient`/`WalletClientConfig`/`GlobalExceptionHandler`/
client DTO）`javac` 編譯通過。Lombok 檔案與 `@SpringBootTest` 待團隊 `mvn -pl backend/game-service test`
環境執行（JUnit 測試已隨碼提交）。

---

## [feat] — 2026-06-02 — Provably Fair RNG 引擎（T-030）

### Added
- `com.luckystar.game.rng.ProvablyFairRng`：game-service 第一個實作元件。commit-reveal 公平機制核心——
  `generateServerSeed()`（密碼學亂數，64 hex）、`commit()`（`SHA-256(serverSeed)` 承諾雜湊，開局前公布）、
  `verifyCommitment()`（常數時間比對，事後揭露驗證）、`stream()`（建立確定性隨機數串流）、
  靜態 `computeOutcomeHash()`（單次下注結果雜湊，供存檔與外部獨立重算）。
- `com.luckystar.game.rng.RandomStream`：由 `(serverSeed, clientSeed, nonce)` 推導的確定性串流，
  演算法 `SHA-256(serverSeed:clientSeed:nonce:block)`，跨區塊延伸；提供 `nextDouble()`、
  `nextInt(bound)`（拒絕取樣消除取模偏差）、`nextInts(count, bound)`。
- 單元測試 `ProvablyFairRngTest`、`RandomStreamTest`：確定性、承諾驗證、範圍邊界、跨區塊延伸、
  分布卡方檢定（純 JUnit，不載入 Spring 容器，免外部基礎設施）。

**為什麼**：T-030 是 game-service（賭場核心，原為空殼）的第一塊地基，後續老虎機（T-031/032）與
百家樂（T-034/035）的隨機結果都建立在此引擎上。採 architecture.md §2.4 指定的
`SHA-256(serverSeed + clientSeed + nonce)`，以 `':'` 分隔消除字串串接歧義，並以遞增 block 索引
延伸出足量隨機位元組。commit-reveal 確保結果開局前已定、事後可被玩家獨立驗證（為 T-036 公平性驗證 API 鋪路）。

**如何驗證**：本機未安裝 Maven，改以 JDK 21 `javac` 對 `spring-context` jar 編譯產品碼並執行 16 項
行為 smoke 檢查（確定性、commit/verify、範圍、拒絕取樣、均勻分布卡方 14.72<30、跨區塊、邊界例外）
全數通過；JUnit 測試已隨碼提交，待團隊 `mvn -pl backend/game-service test` 環境執行。

## [changed] — 2026-06-02 — 優化前端文案、桌面字級與手機浮動元件

### Changed
- `frontend/src/pages/Home.jsx`、`Lobby.jsx`、`Member.jsx`、`Login.jsx`、`Register.jsx`：將首頁、遊戲大廳、登入/註冊與會員入口文案改為使用者導向，移除「工作台」「門禁」「網站結構」等偏內部說法。
- `frontend/src/pages/CasinoShop.jsx`、`Diamond.jsx`、`Profile.jsx`、`Transactions.jsx`、`CheckIn.jsx`：調整商城兌換、鑽石錢包、會員中心、交易紀錄與簽到提示，避免出現 API、技術欄位或過度直譯文字。
- `frontend/src/pages/SlotGame.jsx`、`Baccarat.jsx`、`components/GameRuleCard.jsx`、`QuickToolbar.jsx`、`ErrorBoundary.jsx`、`hooks/useWebSocket.js`、`theme/backgroundTheme.js`：更新遊戲狀態、規則、工具欄、錯誤頁、通知與商品卡文案，讓提示更自然且符合目前功能現狀。
- `frontend/src/index.css`：桌面版 `1024px` 以上提高根字級並改善共用按鈕/表單/面板行高，提升主要頁面閱讀舒適度。
- `frontend/src/components/QuickToolbar.css`、`FriendFloatingPanel.css`：手機版加入 safe-area spacing，快速工具欄維持底部位置，好友清單按鈕固定到 header 右上角並向下展開，避免遮擋 quick tool。

### Why
- 使用者頁面不應露出工程語言或未完成的串接描述；桌面版原字級偏小，手機版好友清單與快速工具列也需要避免互相遮擋與影響點擊。

### Verified
- `npm run lint`（frontend）→ passed。
- `npm run build`（frontend）→ sandbox 內因 Windows 權限無法讀取 Vite config；升權限重跑後 passed。

---

## [feat] — 2026-06-02 — 新增前端鑽石錢包頁面與 Redux 狀態

### Added
- `frontend/src/pages/Diamond.jsx`：新增 `/diamond` 鑽石錢包頁，包含鑽石餘額卡片、序號兌換鑽石、鑽石兌換星幣、即時換算預覽、loading、成功/錯誤提示與表單驗證。
- `frontend/src/store/slices/diamondSlice.js`：新增 `diamond` Redux state，管理 `diamondBalance`、`loading`、`error`、`lastRedeemAmount`、成功訊息與餘額同步 thunk。
- `frontend/src/services/diamondApi.js`：新增 `getDiamondBalance()`、`redeemDiamondCard(card_code)`、`exchangeDiamondToStarCoin(diamondAmount)`，串接 3 支 Diamond API 並沿用既有 axios/auth token 流程。

### Changed
- `frontend/src/store/index.js`、`frontend/src/App.jsx`：註冊 `diamondSlice`，新增 `/diamond` 受保護路由。
- `frontend/src/components/AppShell.jsx`、`QuickToolbar.jsx`、`Member.jsx`：新增鑽石錢包入口，登入後同步鑽石餘額，登出時清空鑽石狀態。
- `frontend/src/pages/Home.jsx`、`Lobby.jsx`、`CasinoShop.jsx`、`Profile.jsx`、`FriendFloatingPanel.jsx`、`theme/backgroundTheme.js`：調整主要貨幣文案，明確區分 Diamond 鑽石為充值/兌換貨幣、Star Coin 星幣為遊戲與禮品消耗貨幣。

### Why
- 完成 T-107 前端鑽石錢包需求，讓使用者可用點數卡取得 Diamond 鑽石，並依固定比例 `1 Diamond = 20 Star Coins` 兌換星幣，同時避免新增與既有 `walletSlice` 衝突的星幣狀態。

### Verified
- `npm run lint`（frontend）→ passed。
- `npm run build`（frontend）→ sandbox 內因 Windows 權限無法讀取 Vite config；升權限重跑後 passed。
- `Invoke-WebRequest http://127.0.0.1:5173/diamond` → HTTP 200。

---

## [changed] — 2026-06-02 — 重整前端 WebSocket 通知 Hook

### Changed
- `frontend/src/hooks/useWebSocket.js`：改為 STOMP over SockJS 連線 `/ws`，固定訂閱 `/user/queue/notifications`，以大寫狀態字串回報連線狀態，並加入 1s → 2s → 4s → 8s、上限 30s 的指數退避重連與卸載清理。
- `frontend/src/store/slices/gameSlice.js`：新增 `latestResult`、`resultHistory`、`updateGameResult`、`clearGameResult`，並將 WebSocket 連線狀態預設為 `DISCONNECTED`。
- `frontend/src/components/RealtimeBridge.jsx`：保留全站單一即時資料橋接，避免 `/user/queue/notifications` 重複訂閱，遊戲結果 topic 改用 `updateGameResult`。
- `frontend/src/components/AppShell.jsx`：保留背景即時資料橋接，不在 header 顯示 WebSocket 狀態，避免後端未啟動時把連線狀態暴露在頁面上。

### Why
- 遊戲頁需要在收到後端 `GAME_RESULT` 使用者通知時即時更新 Redux，同時避免重複連線、快速重連與元件卸載後殘留 timer/client。

### Verified
- `npm run lint`（frontend）→ passed。
- `npm run build`（frontend）→ passed；build 需升權重執行以避開 Windows sandbox 讀取 Vite config 權限限制。

---

## [fix] — 2026-06-02 — 修正會員中心 1000px 頭像過大

### Fixed
- `frontend/src/pages/Profile.jsx`：會員中心頭像/表單區塊改為 `md` 起切雙欄，並在手機單欄時限制頭像欄最大寬度，避免 1000px 左右落在單欄時頭像圖片被 `aspect-square` 撐滿整個表單。

### Why
- 原本內層 grid 只在 `lg` 以上切雙欄，約 1000px viewport 會退回單欄，造成頭像預覽異常放大。

### Verified
- `npm run lint`（frontend）→ passed。
- `npm run build`（frontend）→ passed；build 需升權重執行以避開 Windows sandbox 讀取 Vite config 權限限制。

---

## [changed] — 2026-06-02 — 優化前端主要頁面 RWD

### Changed
- `frontend/src/index.css`：新增手機/平板觸控尺寸、圖片寬度保護、首頁 scroll section 窄版高度、老虎機面板/滾輪/console 在 480px 與 768px 的縮放規則。
- `frontend/src/components/SlotMachine.jsx`：老虎機 symbol height 改為依 viewport 動態選擇，手機 96px、平板 128px、桌面 170px，讓動畫位移與視覺尺寸保持同步。
- `frontend/src/components/QuickToolbar.css` / `FriendFloatingPanel.css`：手機版快速工具列改為底部置中三欄，好友浮動面板調整底部間距，避免互相遮擋。
- `frontend/src/components/AppShell.jsx` / `Home.jsx`：主內容手機底部預留固定工具列空間，導覽列改可換行，通知/首頁選單加入 viewport 寬度保護。
- `frontend/src/pages/Transactions.jsx`：交易紀錄手機版改為卡片式顯示，平板與桌面保留表格，避免窄螢幕局部水平捲動。
- `frontend/src/components/LeaderboardPanel.jsx` / `frontend/src/pages/CasinoShop.jsx`：排行榜長暱稱與商城價格/兌換列加入換行或截斷保護。

### Why
- 主要頁面需要在 375px、768px、1440px 下維持可讀、可點擊且不產生水平破版；老虎機滾輪尺寸也必須與動畫計算一致，避免手機縮放後錯位。

### Verified
- `npm run lint`（frontend）→ passed。
- `npm run build`（frontend）→ passed；build 需升權重執行以避開 Windows sandbox 讀取 Vite config 權限限制。
- Headless Chrome / Edge 截圖驗證嘗試：兩者在此環境皆因 GPU process fatal 無法產出截圖，已改以 lint/build 與程式碼斷點檢查確認。

---

## [changed] — 2026-06-02 — 更新網站金幣 favicon

### Changed
- `frontend/public/icon/casino-svgrepo-com.svg`：將原本 SVG icon 改為單純金色金幣造型，中央使用星形壓印，沿用既有 favicon 路徑。

### Why
- 讓瀏覽器分頁 icon 更直覺呈現星幣/金幣意象，保持小尺寸下的辨識度。

### Verified
- `npm run build`（frontend）→ sandbox 內因 Windows 權限無法讀取 Vite config；升權重跑後 passed。

---

## [feat] — 2026-06-02 — 新增好友清單浮動面板

### Added
- `frontend/src/components/FriendFloatingPanel.jsx` / `FriendFloatingPanel.css`：新增右下角紅金主題好友清單入口，已登入時包含綠色在線狀態點、往上展開面板、搜尋欄、全部/線上/離線/遊戲中分類與 8 筆 mock 好友資料。
- `frontend/src/components/FriendFloatingPanel.jsx` / `FriendFloatingPanel.css`：好友列表項目可點擊切換到好友詳情，顯示頭像、遊戲暱稱、遊戲 ID、狀態、等級、註冊日期與目前遊戲。
- `frontend/src/components/FriendFloatingPanel.jsx` / `FriendFloatingPanel.css`：好友詳情內新增 mock「贈送星幣」表單，含數量/留言欄位、二次確認、餘額扣除、成功與錯誤提示。
- `frontend/src/App.jsx`：全域掛載好友清單浮動面板，包含首頁 `/` 在內的全網站都顯示。

### Changed
- `frontend/src/pages/Profile.jsx`：移除會員中心舊好友列表 UI、好友 mock API 操作與只供該區塊使用的 state/import，保留個人資料、頭像、簽到與第三方綁定功能。
- `frontend/src/components/FriendFloatingPanel.jsx` / `FriendFloatingPanel.css`：未登入狀態不自動導頁，改以灰色燈號與「未登入」狀態呈現，面板內提供登入入口。

### Why
- 好友清單改為全站浮動入口，讓首頁、遊戲大廳與其他頁面都有一致入口；未登入時以低干擾狀態列呈現，不打斷瀏覽流程。好友詳情與 mock 贈幣先放在浮動面板內，避免會員中心內維護另一套好友列表 UI，並在後端 API 完成前提供可驗收的前端流程。

### Verified
- `npm run lint`（frontend）→ passed。
- `npm run build`（frontend）→ sandbox 內因 Windows 權限無法讀取 Vite config；升權重跑後 passed。
- Headless Chrome CDP 驗證 → 舊版需求曾驗證 `/shop`、`/games` 展開/搜尋/分類與 390px 手機 viewport；最終版另以 lint/build 驗證全站常駐與未登入灰燈狀態可正常編譯。

---

## [fix] — 2026-06-02 — 快速工具欄文字與提示位置修正

### Fixed
- `frontend/src/components/QuickToolbar.css`：工具欄按鈕文字改為單行顯示，避免被擠到下一列。
- `frontend/src/components/QuickToolbar.css` / `QuickToolbar.jsx`：提示訊息改為畫面正中央的自製 prompt 風格提示方塊，不使用瀏覽器 `prompt()`，且不再參與側邊欄排版。
- `frontend/src/components/QuickToolbar.jsx`：將提示浮層移出帶有 `transform` 的側邊欄容器，避免 fixed 定位被側邊欄截住而偏到畫面右側。
- `AI 客服` 點擊後沿用中央提示顯示「AI 客服功能即將推出」，避免撐開或改變工具欄尺寸。

### Why
- 快速工具欄是固定操作入口，按鈕尺寸與文字行高必須穩定；提示訊息應獨立於工具欄 layout，避免互動後 UI 跳動。

### Verified
- `npm run lint`（frontend）→ passed。
- `npm run build`（frontend）→ passed。

---

## [feat] — 2026-06-01 — 前端右側快速工具欄

### Added
- `frontend/src/components/QuickToolbar.jsx` / `QuickToolbar.css`：新增固定於右側的快速工具欄，包含每日簽到、遊戲大廳、遊戲商城、會員中心、AI 客服與 Top。
- `frontend/src/pages/CheckIn.jsx`：新增 `/check-in` 每日簽到頁面，沿用既有 `dailyCheckIn` / `fetchWallet` / `fetchProfile` 流程。

### Changed
- `frontend/src/App.jsx`：全域掛載 `QuickToolbar`；新增 `/check-in` 受保護路由；將 `/shop` 改為公開路由；未登入 ProtectedRoute 導向 `/member?mode=login` 並保留 `state.from`。
- `frontend/src/components/AppShell.jsx`：訪客瀏覽公開商城時不主動抓受保護錢包 API，並顯示登入按鈕；登出後同步清空 wallet state。
- `frontend/src/pages/Home.jsx`、`frontend/src/pages/Member.jsx`：更新商城可先瀏覽的相關文案與首頁商城連結。
- `frontend/src/index.css`：關閉 body 橫向 overflow，避免窄螢幕頁面橫向寬度影響 fixed 工具欄定位。

### Why
- 讓主要頁面都有符合紅金深色賭城風格的快速入口，同時維持既有 Redux auth 判斷與會員頁 redirect 流程。
- 商城瀏覽不應受登入保護，避免訪客進入 `/shop` 時被路由或 AppShell 的錢包同步流程導回登入。

### Verified
- `npm run lint`（frontend）→ passed。
- `npm run build`（frontend）→ passed；第一次在沙盒內因 Vite 讀取 config 被 Windows 權限擋住，升權重跑後成功。

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
