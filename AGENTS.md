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

---

## 2. ⚠️ 已知地雷（不讀會踩，務必記住）

1. **沒有 `mvnw`**：用系統 `mvn`，不要用 `./mvnw`。
2. **本機跑後端前要先把 `.env` 載入 shell**：`JWT_SECRET`、`INTERNAL_SECRET`、`CORS_ALLOWED_ORIGINS` 是「缺了就啟動失敗」的必填變數（無預設值）。詳見 DEPLOY.md §4。
3. **測試一律用 H2 記憶體 DB**：`@SpringBootTest`（contextLoads）不連外部 DB。新服務寫測試比照 member/wallet：加 H2（test scope）、測試用 `application.yml` 提供 H2 資料源；wallet 另用 surefire `jpa.ddl-auto=create`（雙資料源）。否則 CI 跑不起來。
4. **Spring Boot 3.2+ 禁止同名 `@Bean` 方法**（`enforceUniqueMethods`）：重複會讓服務啟動丟 `BeanDefinitionParsingException` 直接掛。
5. **wallet-service 是雙資料源（ADR-001）**：`spring.jpa.*` 無效，EntityManagerFactory 在 `DataSourceConfig` 手動建立；別套用單資料源的假設。
6. **`wallet.credit` 是「事件」、`wallet.credit.request` 才是「指令」（ADR-002）**：member 發指令、wallet 消費入帳後發事件給 rank。**永遠不要在 wallet-service 消費 `wallet.credit`**（會無限迴圈）。rank-service 要消費的是 `wallet.credit`/`wallet.debit`（事件）。
7. **改 Kafka topic 要同步改 infra 測試**：`kafka/kafka-init.sh` 增刪 topic 後，更新 `tests/infra/kafka.test.js` 的 topic 清單與數量斷言，否則 CI 紅。
8. **帳務操作=冪等 + 樂觀鎖**：`wallet_transactions.idempotency_key` UNIQUE 防重複、`wallets.version`（`@Version`）防超扣。所有扣款/入帳都要遵循此模式。
9. **`gem-prompt` 技能**（Claude Code）：產生後端實作提示詞，會先讀真實專案檔。開新後端任務可先用它。
10. **服務完成度**：member / gateway / wallet 已實作；rank 已完成 T-040~T-044 排行榜核心（含週排行榜重置/每日快照）；**game 已完成 T-030~T-037 全部**（Provably Fair RNG / 老虎機 / 百家樂 / RNG 驗證 / RTP 統計）；**捕魚機升級 Phase 1（血量/傷害模型）+ Phase 2（PixiJS 漁場引擎）已併入 develop**，Phase 3（戰鬥回饋/砲台差異化/新互動）進行中，見下方雷區 16；**admin 已完成 T-050~T-053 / T-105~T-106**（認證/玩家管理/流通量報表/RTP 監控/鑽石點數卡後台）；**notification 已完成 T-070~T-073 全部**（port 8087，STOMP `/ws`+JWT 鑑權、消費 `notification.push`/`game.result`/`rank.update`，推播 best-effort 無 DLT）；**鑽石系統 T-100~T-107 全完成**（`diamond_cards`/`diamond_wallets` schema、`DiamondWalletService` 開戶 + `POST /redeem` 兌換 + `POST /exchange` 換星幣 + `GET /balance` 查詢、前端 Diamond.jsx + diamondSlice + diamondApi）。動工前先看 AUDIT_REPORT 附錄 A.13 進度統計與 CHANGELOG 確認。
11. **`friend.relationship.updated` 是完整好友清單事件**：member 在好友接受/刪除後，為雙方各發布 `{ playerId, friendIds }`；rank 依完整清單重建 `rank:friend:{playerId}`，不要改成只帶單筆新增/刪除的增量事件。
12. **T-090 壓測腳本實測前置**：`tests/performance/slot-1000-players.jmx` 已建立，T-032 老虎機 API 已完成（實際端點 `POST /api/v1/game/slot/spin`，冪等鍵由伺服器端生成、非 client 傳入）。但實測前仍須**對齊 jmx 與報告假設契約**、準備 1,000 組已入金玩家 JWT 並啟動完整服務拓撲；沒有實測資料時不可填寫虛構 P99。詳見 `docs/performance/T-090-load-test-report.md`。
13. **前端遊戲（slot/baccarat/fishing 及新遊戲）三鐵則**：每個有下注的遊戲都必須遵守，否則會重現「沒錢狂按 / 視覺鎖脫鉤 / 音效當機」三類 bug。
    - **餘額守門**：下注/開火按鈕 `disabled` 條件必須含 `balance >= bet`（不足時顯示「星幣不足」），送出函式開頭再做一次 `if (balance < bet) return` 雙保險，**前端先擋、不要只靠後端退回**。參考 `Fishing.jsx`（buy-in disabled + `useFishingSession.fire()` 的 `insufficient`）、`SlotGame.jsx`（`canAfford`）、`Baccarat.jsx`（`notEnoughBalance`）。
    - **視覺鎖綁定真實流程**：忙碌/loading 狀態要跟著「請求 + 動畫」的實際生命週期釋放（redux `loading`、`phase` 狀態機、或 `try/finally` 回呼），**禁止用固定 `setTimeout(…, 2900)` 之類的魔術數字**解鎖。
    - **音效統一走 `soundEngine`**：所有音效用 `soundEngine.play()` 或 `useSound().play()`；引擎已內建 per-id 節流與發聲上限（`SoundEngine.js`），高頻音（tick/rub/連發）交給引擎節流，**不要在元件層自己 `new Audio` 或繞過引擎**。高頻互動（如捕魚開火）另需用 token bucket 限速（見 `useFishingSession`）。
14. **前端 mock 玩法必須鏡像後端引擎（單一真相＝後端）**：前端預設走 mock（`gameApi.js`：`VITE_USE_MOCK_API !== 'false'`），所以 `frontend/src/services/mockApi.js` 的玩法/賠付就是預設玩家實際體驗到的。**改後端遊戲規則（權重/倍率/補牌/結算）時，必須同步改 mock**，否則兩個世界分歧。已對齊基準：老虎機（`SLOT_PAYTABLE` ↔ `SlotSymbol`：逐格加權、中線三連、倍率綁符號）、百家樂（`bankerDrawsMock` ↔ `BaccaratGameService.bankerDraws`：補牌表、天牌、**和局押莊/閒 push 退本金**、莊贏扣 5% 傭金）、捕魚（**血量/傷害模型**：`mockApi.fishingShots` ↔ `FishingCombat`／`FishSpecies`——per-instance 累傷、暴擊 `CRIT_CHANCE`/`CRIT_MULTIPLIER`、致命一擊 `pCapture` 捕獲判定，見 ADR-003 與下方雷區 16；**已非舊「命中率 0.92/倍率」**）。**勿在 mock 加「強制中獎率」或隨機倍率**等後端沒有的機制。
15. **改老虎機權重要同步改測試**：`SlotSymbol` 權重一變，`SlotSymbolTest`（總和、`fromWeightedIndex` 累積區間）與 `SlotMachineTest.spin_rtpWithinExpectedBand`（RTP/命中率區間）會紅；改完務必跑 `mvn -pl backend/game-service test` 並更新 Javadoc 的理論 RTP/命中率（單中線三連、含本金倍率：RTP=Σpᵢ³·mᵢ、命中率=Σpᵢ³）。
16. **捕魚機＝PixiJS canvas 引擎 + 血量/傷害模型（已非 DOM、非「每發獨立命中」）**：決策見 `docs/adr/ADR-003.md`。
    - **渲染**：漁場是 `frontend/src/components/fishingEngine.js`（非 React 的 Pixi 引擎，單一 `ticker` 跑魚/子彈/火花/浮字、命中判定全在 canvas 座標）+ `FishingCanvas.jsx`（薄 React 殼，`React.lazy` code-split）。**不要回去用 DOM 渲染魚**（舊 `FishingArena.jsx` 已刪，當機元兇）。新增戰鬥演出（HP 條/傷害數字/暴擊/掙脫）一律做成 **Pixi 物件 + 物件池 + 並存上限**，尊重 `perfMode`/FPS 守門/`prefers-reduced-motion`。
    - **數值權威在後端**：傷害累積、致命一擊 `pCapture` 捕獲判定、派彩全由 `FishingCombat`/`FishingService` 算；前端只決定「打哪條、何時打」。後端回傳 `ShotResult{crit,damage,hpRemaining,killed,captured}`，前端**只負責演出**這些欄位。
    - **改數值三同步**（比照雷區 15）：動 `FishingCombat`（HP/傷害/暴擊/`pCapture`）→ 同步改 `mockApi.js` 鏡像（雷區 14）+ `FishingCombatTest` 的 RTP band，並跑 `mvn -pl backend/game-service test`。
    - **依賴**：前端用 `pixi.js`（`package.json`）；`git pull` 後若 build 報 `Rollup failed to resolve import "pixi.js"`＝忘了 `npm install`。
17. **風控全局 RTP 門檻是 per-game 且為「含本金」口徑**（`risk.global-rtp-limit` 為 map，見 `RiskProperties` / `RiskControlService`）：`game_rounds.win_amount` 存的是**含本金**派彩，故 RTP=`win/bet` 的正常水位 ≈ 各遊戲結構性 RTP（老虎機 ≈ 0.94、百家樂 ≈ 0.99）。門檻**必須訂在該遊戲結構性 RTP 之上**，否則風控每局誤判超限、把結果強制改判（百家樂被改成「莊家贏」）—— 這正是 2026-06-25 修掉的 bug。**新增遊戲或調門檻時**：在 `application.yml` 的 `risk.global-rtp-limit` 補該遊戲鍵（未列出走 `default`），值要高於其含本金 RTP；別退回單一標量門檻。

---

## 3. 約定速查

### 技術 / Port
- 套件根 `com.luckystar`、Java 21、Spring Boot 3.3.5、JJWT 0.12.6
- DB：PostgreSQL（帳務寫庫）+ MySQL（查詢讀庫）CQRS；Redis（token/session/排行）；Kafka（事件）
- Port：gateway 8080 / member 8081 / wallet 8082 / game 8083 / rank 8084 / admin 8086 / notification 8087；MySQL **3307** / PostgreSQL **5433** / Redis 6379 / Kafka 9092 / Kafka UI 8085

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
# 後端：跑已實作服務的測試（用 H2，免外部基礎設施）
mvn -pl backend/gateway-service,backend/member-service,backend/wallet-service test

# 基礎設施腳本測試
node --test tests/infra/*.test.js
```
> CI（`.github/workflows/ci.yml`）會在 PR 時自動跑上述兩者；務必本機先綠燈再開 PR。

---

## 5. 更新本檔

當你新增服務、改變約定、或踩到新雷時，**請順手更新本檔的對應段落**（並依 §3 CHANGELOG 規則記一筆），讓下一個 AI / 組員少踩雷。
