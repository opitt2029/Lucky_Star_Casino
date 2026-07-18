# AGENTS.md — AI 開發前必讀（Lucky Star Casino）

> 任何 AI / 自動化代理在本專案開發前，**先讀完本檔**。
> 目的：快速掌握專案、遵守既有約定、避開已知地雷（這些雷不讀會白白浪費時間）。
> 適用於 Claude Code、Cursor、Copilot 等任何 AI 工具。

---

## 0. 專案一句話

線上賭場（模擬幣，無真實金流）後端微服務系統，monorepo（Maven 多模組）+ React 前端。
套件根 `com.luckystar`，**Java 21**，**Spring Boot 3.3.5**，Spring Cloud Gateway，JJWT 0.12.6。

---

## 1. 必讀文件（照順序）

| 順序 | 檔案 | 重點 |
|---|---|---|
| 1 | `README.md` | 全貌、6 服務職責、Port、技術棧、分支規範 |
| 2 | `docs/architecture.md` | 服務邊界、DB 分配、Kafka topics、請求流程 |
| 3 | `CONTRIBUTING.md` | 分支命名、PR 流程、commit 規範 |
| 4 | `AUDIT_REPORT.md`（附錄 A） | **目前進度真相**：T-000~T-107 逐項狀態、哪些是空殼 |
| 5 | `docs/adr/ADR-001.md`、`ADR-002.md` | 已拍板架構決策（DB CQRS、wallet.credit 指令/事件分離） |
| 6 | `DEPLOY.md` | 本機把環境跑起來的 SOP |
| 7 | `docs/幸運星幣城_工作分配表.xlsx` | 任務與分工的**單一真相來源**（T-000~T-107） |
| 8 | `CHANGELOG.md` | 最近改了什麼、為什麼 |

> ⚠️ **查進度別只信 `AUDIT_REPORT.md`，務必拿程式碼/git 交叉驗證**：它是「手動維護的快照」，更新靠人記得去盤點，所以會落後實際程式碼（已合併的任務常被漏標成未完）。實例：wallet 的 T-027/T-028 早在 2026-06-01 就 commit 併入，卻在 6/17 盤點仍標 ❌/⚠️，害每次查進度都誤報 wallet「進行中」。判定某任務是否完成，至少做一項驗證：對應 Controller/Service 檔是否存在、`git log --oneline -- <檔>` 有無該 `T-0xx` commit、`git branch --contains <sha>` 是否在 develop/main、測試是否存在。發現與 AUDIT_REPORT 不符時，**以程式碼為準並順手更正文件**（依 §3 記 CHANGELOG）。
>
> ✅ **（2026-07-07 起）附錄 A 的逐項進度表已自動化**：標記區塊（`<!-- AUDIT:BEGIN/END -->`）由 `node tools/audit/generate-audit-snapshot.mjs` 依 `tools/audit/tasks.json` 的證據清單產生（判定＝證據檔案存在＋`git log --grep` 有 commit），另存當日快照到 `docs/report/audit-snapshot-YYYYMMDD.md`。**更新進度＝改 `tools/audit/tasks.json`（新任務補證據、人工判定用 `override`）再重跑工具**，別手改標記區塊（會被覆蓋）；`--check` 只比對不寫入、有落差退出碼 1，可用來驗證文件是否漂移。標記區塊外的人工敘述照舊手動維護，上面的交叉驗證原則對人工敘述仍然適用。

---

## 2. ⚠️ 已知地雷（不讀會踩，務必記住）

1. **沒有 `mvnw`**：用系統 `mvn`，不要用 `./mvnw`。
2. **本機跑後端前要先把 `.env` 載入 shell**：`JWT_SECRET`、`INTERNAL_SECRET`、`CORS_ALLOWED_ORIGINS` 是「缺了就啟動失敗」的必填變數（無預設值）。詳見 DEPLOY.md §4。
3. **測試一律用 H2 記憶體 DB**：`@SpringBootTest`（contextLoads）不連外部 DB。新服務寫測試比照 member/wallet：加 H2（test scope）、測試用 `application.yml` 提供 H2 資料源；wallet 另用 surefire `jpa.ddl-auto=create`（雙資料源）。否則 CI 跑不起來。**唯一例外（ADR-007）**：wallet-service 另有 `@Tag("containers")` 的 Testcontainers 真 DB 測試（`containers/` 套件，postgres:16+mysql:8.4 套真 schema、`ddl-auto=validate`），surefire 預設排除、`mvn -pl backend/wallet-service test -Pcontainers-test` 才跑（本機需 Docker，Windows 另需 `$env:DOCKER_HOST='npipe:////./pipe/dockerDesktopLinuxEngine'`，見 ADR-007；CI 已有獨立 step）。日常 `mvn test` 的零依賴約定不變；新增此類測試必須標 `@Tag("containers")` 並繼承 `AbstractDualDatasourceContainerTest`，否則會破壞零依賴。
4. **Spring Boot 3.2+ 禁止同名 `@Bean` 方法**（`enforceUniqueMethods`）：重複會讓服務啟動丟 `BeanDefinitionParsingException` 直接掛。
5. **wallet-service 是雙資料源（ADR-001）**：`spring.jpa.*` 無效，EntityManagerFactory 在 `DataSourceConfig` 手動建立；別套用單資料源的假設。
6. **`wallet.credit` 是「事件」、`wallet.credit.request` 才是「指令」（ADR-002）**：member 發指令、wallet 消費入帳後發事件給 rank。**wallet-service 內任何消費 `wallet.credit`/`wallet.debit`（事件）的 listener 都不可重呼 `WalletService.credit()`/`debit()`**（會無限迴圈）。例外：`WalletReadSyncListener`（`kafka/WalletReadSyncListener.java:45,80`）確實消費這兩個事件，但只寫 MySQL 讀視圖（CQRS read-sync，T-025）、對 `WalletTransactionViewRepository` 做 `existsById` 冪等檢查，從不呼叫 `credit()/debit()`，故不會迴圈——這是唯一安全的例外模式，新增消費者比照此例，**絕不能**在消費者內再呼叫入帳/扣款方法。rank-service 要消費的是 `wallet.credit`/`wallet.debit`（事件）。
7. **改 Kafka topic 要同步改 infra 測試**：`kafka/kafka-init.sh` 增刪 topic 後，更新 `tests/infra/kafka.test.js` 的 topic 清單與數量斷言，否則 CI 紅。
8. **帳務操作=冪等 + 防超扣**：`wallet_transactions.idempotency_key` UNIQUE 防重複、`wallets.version` 防超扣。所有扣款/入帳都要遵循此模式。**（T-090 B2 起）`WalletService.debit()` 的防超扣改為「條件 UPDATE＋行鎖」**（`WalletDebitDao`：守衛與扣款壓成單一原子語句、`version = version + 1` 手動遞增，熱路徑 2 次 DB 往返；設計見 `docs/performance/T-090-B2-debit-roundtrip-design.md`）——debit **不再拋 409 樂觀鎖例外**（併發輸家改回餘額不足或冪等命中）；credit/gift/凍結等其他寫入方仍走 JPA `@Version` 樂觀鎖（撞到 debit 的版本遞增照樣 409）。動 debit SQL 必須同步 H2 方言分流（`FINAL TABLE`，雷區 3）並跑 `-Pcontainers-test`；**勿把 debit 改回讀改寫**，也勿在 PG 用「INSERT 後 catch UNIQUE 違規」取代 `ON CONFLICT`（PG 違規會 abort 整筆交易 25P02，H2 才允許 catch）。
9. **`gem-prompt` 技能**（Claude Code）：產生後端實作提示詞，會先讀真實專案檔。開新後端任務可先用它。
10. **服務完成度**：member / gateway / wallet 已實作；rank 已完成 T-040~T-044 排行榜核心（含週排行榜重置/每日快照）；**game 已完成 T-030~T-037 全部**（Provably Fair RNG / 老虎機 / 百家樂 / RNG 驗證 / RTP 統計）；**捕魚機升級 Phase 1~4 全部完成**（血量/傷害模型 → PixiJS 漁場引擎 → 戰鬥回饋/砲台差異化/新互動 → 魚種重設含 BOSS 龍王），另加 ADR-004 經濟再平衡，見下方雷區 16；**捕魚唯一未動工項＝Redis session 原子化（Lua CAS，ADR-008 編號已保留）**，見 `docs/plans/01-八項架構改進施工藍圖.md` Phase 3；**admin 已完成 T-050~T-055 / T-105~T-106**（認證/玩家管理/流通量報表/RTP 監控/異常偵測含 `GET /admin/alerts` 查詢/GM 發幣/鑽石點數卡後台；T-051 停用同時經 member 內部 API `PATCH /internal/members/{id}/status` 持久化 `members.status` + Redis 即時封鎖）；**notification 已完成 T-070~T-073 全部**（port 8087，STOMP `/ws`+JWT 鑑權、消費 `notification.push`/`game.result`/`rank.update`，推播 best-effort 無 DLT）；**鑽石系統 T-100~T-107 全完成**（`diamond_cards`/`diamond_wallets` schema、`DiamondWalletService` 開戶 + `POST /redeem` 兌換 + `POST /exchange` 換星幣 + `GET /balance` 查詢、前端 Diamond.jsx + diamondSlice + diamondApi）。動工前先看 AUDIT_REPORT 附錄 A.13 進度統計與 CHANGELOG 確認。
11. **`friend.relationship.updated` 是完整好友清單事件**：member 在好友接受/刪除後，為雙方各發布 `{ playerId, friendIds }`；rank 依完整清單重建 `rank:friend:{playerId}`，不要改成只帶單筆新增/刪除的增量事件。
12. **T-090 壓測腳本實測前置**：`tests/performance/slot-1000-players.jmx` 已建立，T-032 老虎機 API 已完成（實際端點 `POST /api/v1/game/slot/spin`，冪等鍵由伺服器端生成、非 client 傳入）。但實測前仍須**對齊 jmx 與報告假設契約**、準備 1,000 組已入金玩家 JWT 並啟動完整服務拓撲；沒有實測資料時不可填寫虛構 P99。詳見 `docs/performance/T-090-load-test-report.md`。
13. **前端遊戲（slot/baccarat/fishing 及新遊戲）三鐵則**：每個有下注的遊戲都必須遵守，否則會重現「沒錢狂按 / 視覺鎖脫鉤 / 音效當機」三類 bug。
    - **餘額守門**：下注/開火按鈕 `disabled` 條件必須含 `balance >= bet`（不足時顯示「星幣不足」），送出函式開頭再做一次 `if (balance < bet) return` 雙保險，**前端先擋、不要只靠後端退回**。參考 `Fishing.jsx`（buy-in disabled + `useFishingSession.fire()` 的 `insufficient`）、`SlotGame.jsx`（`canAfford`）、`Baccarat.jsx`（`notEnoughBalance`）。
    - **視覺鎖綁定真實流程**：忙碌/loading 狀態要跟著「請求 + 動畫」的實際生命週期釋放（redux `loading`、`phase` 狀態機、或 `try/finally` 回呼），**禁止用固定 `setTimeout(…, 2900)` 之類的魔術數字**解鎖。
    - **音效統一走 `soundEngine`**：所有音效用 `soundEngine.play()` 或 `useSound().play()`；引擎已內建 per-id 節流與發聲上限（`SoundEngine.js`），高頻音（tick/rub/連發）交給引擎節流，**不要在元件層自己 `new Audio` 或繞過引擎**。高頻互動（如捕魚開火）另需用 token bucket 限速（見 `useFishingSession`）。
14. **前端 mock 玩法必須鏡像後端引擎（單一真相＝後端）**：前端預設走 mock（`gameApi.js`：`VITE_USE_MOCK_API !== 'false'`），所以 `frontend/src/services/mockApi.js` 的玩法/賠付就是預設玩家實際體驗到的。**改後端遊戲規則（權重/倍率/補牌/結算）時，必須同步改 mock**，否則兩個世界分歧。已對齊基準：老虎機（`SLOT_PAYTABLE` ↔ `SlotSymbol`：逐格加權、中線兩階賠付（三連＋左二同）、倍率綁符號）、百家樂（`bankerDrawsMock` ↔ `BaccaratGameService.bankerDraws`：補牌表、天牌、**和局押莊/閒 push 退本金**、莊贏扣 5% 傭金）、捕魚（**血量/傷害模型**：`mockApi.fishingShots` ↔ `FishingCombat`／`FishSpecies`——per-instance 累傷、暴擊 `CRIT_CHANCE`/`CRIT_MULTIPLIER`、致命一擊 `pCapture` 捕獲判定，見 ADR-003 與下方雷區 16；**已非舊「命中率 0.92/倍率」**）。**勿在 mock 加「強制中獎率」或隨機倍率**等後端沒有的機制。**（Phase 5 起）表格數值單一來源＝repo 根 `contracts/*.json`**（`slot-paytable` / `baccarat-rules` / `fishing-species` / `fishing-combat` / `shop-catalog`），`mockApi.js` 直接 import（dev server 靠 `vite.config.js` 的 `server.fs.allow` 放行），演算「邏輯」（補牌流程、pCapture 反推、兩階賠付評估）仍是鏡像程式碼。後端 enum/常數仍是**執行期權威**（不 runtime 載 JSON），由 game-service 的 `ContractParityTest` 逐欄斷言 JSON＝後端，**漂移＝CI 紅燈**。改玩法數值 SOP：改後端 enum/常數 → 同步 `contracts/*.json`（mock 自動跟上）→ `mvn -pl backend/game-service test`。
15. **改老虎機權重要同步改測試**：`SlotSymbol` 權重一變，`SlotSymbolTest`（總和、`fromWeightedIndex` 累積區間）、`SlotMachineTest.spin_rtpWithinExpectedBand`（RTP/命中率區間）與 `ContractParityTest`（`contracts/slot-paytable.json` 相等性，雷區 14）會紅；改完務必同步 `contracts/slot-paytable.json`、跑 `mvn -pl backend/game-service test` 並更新 Javadoc 的理論 RTP/命中率（單中線**兩階賠付**、含本金倍率：RTP=Σpᵢ³·Tᵢ（三連）+Σpᵢ²(1−pᵢ)·Pᵢ（左二同）、命中率=Σpᵢ³+Σpᵢ²(1−pᵢ)；理論值見 `SlotSymbol` Javadoc，現約 RTP 93.8%/命中率 30.7%）。
16. **捕魚機＝PixiJS canvas 引擎 + 血量/傷害模型（已非 DOM、非「每發獨立命中」）**：決策見 `docs/adr/ADR-003.md`、`docs/adr/ADR-004.md`（經濟再平衡）。
    - **渲染**：漁場是 `frontend/src/components/fishingEngine.js`（非 React 的 Pixi 引擎，單一 `ticker` 跑魚/子彈/火花/浮字、命中判定全在 canvas 座標）+ `FishingCanvas.jsx`（薄 React 殼，`React.lazy` code-split）。**不要回去用 DOM 渲染魚**（舊 `FishingArena.jsx` 已刪，當機元兇）。新增戰鬥演出（HP 條/傷害數字/暴擊/掙脫）一律做成 **Pixi 物件 + 物件池 + 並存上限**，尊重 `perfMode`/FPS 守門/`prefers-reduced-motion`。
    - **數值權威在後端**：傷害累積、致命一擊 `pCapture` 捕獲判定、派彩全由 `FishingCombat`/`FishingService` 算；前端只決定「打哪條、何時打」。後端回傳 `ShotResult{crit,damage,hpRemaining,killed,captured}`，前端**只負責演出**這些欄位。
    - **跨批戰鬥狀態必須持久化進 Redis**：捕魚是 buy-in + 批次結算，魚的累傷 `fishDamage`（key=`fishInstanceId`）、致命一擊 `kills`、**玩家自選的單發面額 `betPerShot`**（ADR-004，與砲台解耦）都存在 `FishingSession`，每批 `shots()` 都 `find()` 重讀 session。**動 `FishingSession` 欄位時，務必同步在 `FishingSessionStore.toHash()/fromHash()` 補序列化**（集合用 `ObjectMapper` 存 JSON 欄位），否則跨批累傷歸零→**大魚永遠打不死（HP 每批「回寫」回滿）**，或 `betPerShot` 歸零→`validateBatch` 注額對不上整批被拒。此雷曾因 store 漏存欄位、且 `FishingServiceTest` 把 store 整個 mock 掉而漏網；回歸由 `FishingSessionStoreTest` 守門。
    - **經濟模型（ADR-004）**：`TARGET_RTP=0.96`（設計值/天花板）、砲台傷害為 `{0,14,22,32}`（銅/銀/金，`FishingCombat.CANNON_DAMAGE`）、**殘血部分回收 `RECOVERY_RATE=0.70`**（結算時對 `fishDamage` 殘血魚退還部分子彈成本 = 體感 RTP 地板；`FishingService.settleInternal` 累加、`FishingCombat.recoveryPayout` 計算）。子彈面額玩家自選（檔位＋自訂，`MIN_BET=10/MAX_BET=10000`）、與砲台解耦——**勿把注額改回綁砲台**。**面額/砲台皆為 session 級、進場後整場固定**：後端 `validateBatch` 強制每發 `betPerShot`==進場面額、傷害只認 `session.cannonLevel`，前端切換 UI（`changeBetPerShot`/`changeCannonLevel`）僅限進場前（playing 階段會拒絕）——**勿在場中開放切換**（會整批 400 或前後端傷害分歧）。場中加值走 `POST /{sessionId}/top-up`（`clientRequestId` 冪等存於 session `topUpRequestIds`）；前端 `useFishingSession.topUp` 會先上 `topUpLockRef` 鎖住 `fire()` 再 `drainPendingShots()`，**勿移除此鎖**（`shots` 與 `top-up` 都是「讀→改→整包 save」session，併發會互相覆寫、加值的錢會蒸發）。**勿對低捕獲率做 pCapture 硬地板**（會使 RTP 破表，見 ADR-004），要降「血歸零卻掙脫」改用縮小砲台傷害差距。
    - **改數值四同步**（比照雷區 15）：動 `FishingCombat`／`FishSpecies`（HP/傷害/暴擊/`pCapture`/`RECOVERY_RATE`/魚種表）→ 同步 ① `contracts/fishing-combat.json`／`contracts/fishing-species.json`（mock import 契約檔自動跟上，相等性由 `ContractParityTest` 守門，雷區 14）② `FishingCombatTest` 的 RTP band ③ `risk.global-rtp-limit` 的 `FISHING` 門檻（雷區 17），並跑 `mvn -pl backend/game-service test`。
    - **依賴**：前端用 `pixi.js`（`package.json`）；`git pull` 後若 build 報 `Rollup failed to resolve import "pixi.js"`＝忘了 `npm install`。
    - **升級進度（2026-07-13 複核）**：Phase 1~4 皆已落地——HP 條/暴擊/傷害浮字、砲台差異化（`CANNON_DAMAGE`）、自動射擊/鎖定/準心/`perfMode`/分頁隱藏暫停、11 種魚含 `Tier.BOSS` 龍王。**唯一未動工＝上面「讀→改→整包 save」的 Redis session 原子化（Lua CAS）**：目前 `FishingSessionStore` 無 `version` 欄位、無 Lua script，靠前端 `topUpLockRef` 迴避併發覆寫，**多實例水平擴展前必修**（施工說明見 `docs/plans/01-八項架構改進施工藍圖.md` Phase 3，開工時開 ADR-008）。
17. **風控全局 RTP 門檻是 per-game 且為「含本金」口徑**（`risk.global-rtp-limit` 為 map，見 `RiskProperties` / `RiskControlService`）：`game_rounds.win_amount` 存的是**含本金**派彩，故 RTP=`win/bet` 的正常水位 ≈ 各遊戲結構性 RTP（老虎機 ≈ 0.94、百家樂 ≈ 0.99、捕魚機設計 RTP 0.96 含殘血回收，ADR-004）。門檻**必須訂在該遊戲結構性 RTP 之上**，否則風控每局誤判超限、把結果強制改判（百家樂被改成「莊家贏」）—— 這正是 2026-06-25 修掉的 bug。捕魚為高變異（大魚捕獲單局 RTP 可遠超 1），門檻 `FISHING: 1.10` 留足裕度。**新增遊戲或調門檻時**：在 `application.yml` 的 `risk.global-rtp-limit` 補該遊戲鍵（未列出走 `default`），值要高於其含本金 RTP；別退回單一標量門檻。
18. **新增 wallet 帳務子型（`sub_type` 字串非 enum）要四同步**：① DTO 的 `@Pattern` regex 與訊息——CREDIT 子型改 `dto/CreditRequest.java`、**DEBIT 子型改 `dto/DebitRequest.java`** ② `database/postgres/init.sql` 的 `chk_wt_sub_type` + 新 migration（仿 `V12`/`V13`）③ `database/mysql/init.sql` 的 `chk_wt_sub_type` + 新 migration（仿 `V9`/`V10`，注意 MySQL 是 `DROP CHECK`、Postgres 是 `DROP CONSTRAINT IF EXISTS`）。漏任一處：wallet 帳務會在 `@Pattern` 被擋（400）或在讀庫/寫庫撞 CHECK。rank-service 只認 `WIN` 計分，其餘子型（含 `MONTHLY_REWARD`/`CHECKIN`/`REFUND`/`SHOP_PURCHASE`）不污染排行。範例：月度簽到獎勵 `MONTHLY_REWARD`（CREDIT，ADR-005）；商城兌換 `SHOP_PURCHASE`（DEBIT，ADR-006）。⚠️ `debit()` 的 subType 原寫死 `BET`，現改為 `DebitRequest.subType` 可選帶入（預設 BET）；game-service 不帶 → 仍記 BET，行為不變。
19. **member-service 的端點若落在 `/api/v1/wallet/**` 路徑下，必須加進 gateway 的 `member-checkin` 路由 `Path`（且排在 `wallet` catch-all 之前）**：`backend/gateway-service/src/main/resources/application.yml` 的 `member-checkin`（`uri=MEMBER_SERVICE_URL`）目前是 `Path=/api/v1/wallet/daily-checkin,/api/v1/wallet/checkin/**`。新增 member 的 wallet 子路徑（如簽到狀態/月度獎勵）要補進這條，否則被下方 `Path=/api/v1/wallet/**` 攔截轉發到 wallet-service → 404（wallet 沒這些端點）。Spring Cloud Gateway 路由按宣告順序比對，**具體路徑必須排在 catch-all 之前**。
20. **禮品商城＝wallet-service 內（非獨立服務，ADR-006）**：玩家端兌換/目錄/背包在 wallet-service，端點 `/api/v1/wallet/shop/**`（被既有 `wallet` 路由吃下，**免改 gateway**；因路徑在 wallet 服務內，不像雷區 19 那樣需另立路由）。兌換＝單一 Postgres 交易內「`WalletService.debit(SHOP_PURCHASE)` + 寫 `shop_redemptions`」原子完成，重用 debit 冪等/樂觀鎖（範本＝`DiamondExchangeService`）。目錄 `shop_items` 在 **MySQL**（admin-service CRUD、wallet 讀；跨資料源讀目錄拆 `ShopCatalogService` 用 `mysqlTransactionManager`，比照 `DiamondRedeemService`，**勿合併進 postgres 交易方法**，自我呼叫會讓 `@Transactional` 失效）。後台目錄管理在 admin-service（`hasRole('ADMIN')`，寫 `admin_action_logs` 稽核）。改數值/目錄（`database/mysql/init.sql` seed）要同步 `contracts/shop-catalog.json`（mock 的 `SHOP_CATALOG` 直接 import 此檔，雷區 14；注意此檔**僅供 mock**、後端不讀、`ContractParityTest` 也不守門——正式目錄單一真相仍在 MySQL）。子型 `SHOP_PURCHASE` 四同步見雷區 18。
21. **後台 JWT 與玩家 JWT 是兩套 secret，gateway 驗不了 admin token**：admin-service 用獨立 `ADMIN_JWT_SECRET` 簽發（T-050），gateway 的 `JwtAuthenticationGlobalFilter` 只持玩家 `JWT_SECRET`，故 `jwt.whitelist` 必含 `/admin/`（純轉發，認證/角色授權由 admin-service 自身 Spring Security 守門；`GatewayRoutesConfigTest.jwtWhitelist_includesAdminPath` 鎖住此設定）。**勿把 `/admin/` 移出白名單**（整條後台路徑會被 gateway 401 擋死，含登入端點）；也勿在 admin-service 內假設有 gateway 的 `X-User-Id`/`X-User-Role` header（白名單路徑會剝除）。此雷 2026-07-07 修過：後台 API 完成以來從未通過 gateway，admin 測試都直打 8086 才沒發現。
22. **game→wallet 的 credit 失敗必須落補償單，且冪等鍵絕不可換（ADR-009）**：game-service 對 wallet 的派彩/退款 credit 失敗時，在 catch 內呼叫 `WalletCompensationService.recordPending()`（`compensation/` 套件）落 `pending_wallet_credits` 補償單，排程 `WalletCompensationRetryJob` 每 30 秒帶**與原始呼叫完全相同的冪等鍵**重試——換了鍵就會重複入帳（安全根基＝wallet 端 `idempotency_key` UNIQUE，雷區 8）。語意注意：settle 的 credit 失敗＝玩家贏了，補償是「重試同一冪等鍵的 credit」（sub_type=WIN），**不是退款**；fishing buy-in/top-up 的退款再失敗才是 REFUND。新增遊戲的 credit 失敗路徑比照 `SlotService.settleInternal` 接入；補償**只走 HTTP `WalletClient`**，勿新增消費 `wallet.credit`/`wallet.debit` 事件回呼帳務方法的 listener（雷區 6）；sub_type 僅用 WIN/REFUND（已在 CreditRequest 白名單，不觸發雷區 18 四同步）。對帳跑 `tools/reconciliation/reconcile-game-wallet.mjs`（FAILED 補償單＝需人工處理）。

---

## 3. 約定速查

### 技術 / Port
- 套件根 `com.luckystar`、Java 21、Spring Boot 3.3.5、JJWT 0.12.6
- DB：PostgreSQL（帳務寫庫）+ MySQL（查詢讀庫）CQRS；Redis（token/session/排行）；Kafka（事件）
- Port：gateway 8080 / member 8081 / wallet 8082 / game 8083 / rank 8084 / admin 8086 / notification 8087；MySQL **3307** / PostgreSQL **5433** / Redis 6379 / Kafka 9092 / Kafka UI 8085
- 前端兩個獨立專案：玩家端 `frontend/`（5173）、管理後台 `frontend-admin/`（5174，ADMIN JWT 與玩家 JWT 是兩套 secret 不可混用；dev 走 vite proxy `/admin`→8080 免碰 CORS 白名單，SPA 自身路由勿用 `/admin` 前綴）

### Git / 提交
- 分支：`feature/名字-功能描述` → PR → `develop`；`main` 受保護，不直接 commit
- 走 **fork/PR 工作流**，PR 需至少 1 人 review（見 CONTRIBUTING.md）
- commit 格式：`type(scope): 中文描述`（例 `feat(wallet-service): ...`、`fix(gateway): ...`、`test(infra): ...`）

### ✅ CHANGELOG 規則（重要）
- **單一真相來源：根目錄 `./CHANGELOG.md`**。全專案只維護這一份，各服務**不**另開 per-service CHANGELOG。
  （`backend/member-service/CHANGELOG.md` 為歷史紀錄、已凍結，勿在其新增條目。）
- **任何會影響行為的變更（程式碼 / 設定 / schema / API / Kafka 契約）後，都要在根目錄 `./CHANGELOG.md` 最上方新增一筆**，內容含：
  - 標題：`## [type] — YYYY-MM-DD — 一句話`
  - 區段：`Added / Changed / Fixed / Removed` 列出動到哪些檔、做了什麼
  - **為什麼**（決策理由）與 **如何驗證**（例：`mvn test` 結果）
- 純文件錯字、格式微調可略過。
- 架構級決策另寫 `docs/adr/ADR-00X.md` 並在 CHANGELOG 引用。

---

## 4. 驗證指令（提交前自查）

```bash
# 後端：跑七個服務的測試（全用 H2；game/rank/notification 另用 @EmbeddedKafka，皆免外部基礎設施）
mvn -pl backend/gateway-service,backend/member-service,backend/wallet-service,backend/admin-service,backend/game-service,backend/rank-service,backend/notification-service test

# 基礎設施腳本測試
node --test tests/infra/*.test.js
```
> CI（`.github/workflows/ci.yml`）會在 PR 時自動跑上述兩者；務必本機先綠燈再開 PR。

---

## 5. 更新本檔

當你新增服務、改變約定、或踩到新雷時，**請順手更新本檔的對應段落**（並依 §3 CHANGELOG 規則記一筆），讓下一個 AI / 組員少踩雷。
