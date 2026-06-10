# Changelog — Lucky Star Casino

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

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
