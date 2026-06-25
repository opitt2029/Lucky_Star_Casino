# Changelog — Lucky Star Casino

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Fixed] — 2026-06-24 — 捕魚機 idSeq 跨 session 碰撞 + 手動點擊 fleeing 魚

### Fixed
- `frontend/src/components/fishingEngine.js`：**idSeq 跨 session 碰撞** — `this.idSeq` 初始值從 `0` 改為 `Date.now()`，引擎每次重建的起點都不同，徹底消除舊 `fishDamage` key 被新魚繼承的可能（前次修法只在 hook remount 時清空 fishDamage，HMR 等只重建引擎的場景仍有碰撞風險）。
- `frontend/src/components/fishingEngine.js`：**手動點擊 fleeing 魚** — `_nearestFish` 補上 `f.fleeing` 過濾，避免用戶點到正在逃跑動畫的魚觸發 `fire()`（浪費注額、在 mockApi 留下錯誤 `fishDamage` 殘留值）。

**為什麼**：`idSeq = 0` 使不同生命週期的引擎 id 空間完全重疊；`Date.now()` 起點讓碰撞機率歸零，不依賴外部清空邏輯。fleeing 魚的 `fishDamage` 在 killed 時已被刪除，重新 fire 會以 damageBefore=0 重算 hpRemaining，後端/mock 認為此魚滿血，邏輯狀態汙染。
**如何驗證**：
1. 進捕魚機場，對一條大魚打到低血量
2. 開啟 DevTools → HMR 觸發引擎重建（或 navigate away 再回來）
3. 再打同一種類新魚，血量應從滿血開始，不繼承舊傷害
4. 打到一條魚掙脫逃跑（fleeing），快速點擊逃跑動畫中的魚，確認不扣注、無子彈

---

## [Changed] — 2026-06-23 — 捕魚機魚種視覺對齊後端 + Boss/魚群事件（Phase 4）

> 捕魚機升級第四階段：前端 spawn 改採後端魚種真相（tier/spawnWeight），修正舊版用 multiplier 自行分級
> 把 HIGH（金龍/貔貅/財神）誤當 boss 的問題；高倍魚加辨識光暈；新增 Boss（龍王）定時降臨與魚群潮事件。
> **純前端表現層，後端魚種數值（Phase 1 已按設計表定案）/契約/RTP/帳務皆不變。**

### Changed
- `frontend/src/components/fishingEngine.js`：
  - **魚種視覺對齊後端**：`deriveMeta` 改用後端 `tier`/`spawnWeight`（單一真相）推導體型/游速/出現率，取代舊版用 `multiplier` 自行分級——修正金龍/貔貅/財神（HIGH）被誤判為 boss、體型與龍王相同、誤觸發 Boss 警報的問題。新增 tier 渲染表 `TIER_RENDER`：體型↔倍率正相關、游速↔倍率負相關（大魚慢、好瞄但耐打）。
  - **高倍魚辨識光暈**：HIGH/BOSS/SPECIAL 魚在魚下方加金色脈動光暈（獨立 `glowLayer`，效能模式減半），強化辨識。
  - **Boss 定時降臨**：龍王每 `BOSS_INTERVAL_MS`（58s）在「場上無 boss 時」強制降臨（保證事件節奏，不只靠 spawnWeight=2 隨機），沿用既有 bossAlarm 預警 + boss BGM。
  - **魚群潮**：每 `SWARM_INTERVAL_MS`（36s）短時間密集放小魚（`SWARM_SIZE` 尾），製造 LDW 小額回收手感；受並存上限保護。`_trySpawn` 重構支援指定魚種/小魚/Boss。
  - lockOn 鎖定音擴及 HIGH 魚（原僅 boss/special）。

### 為什麼
- 玩家要「各種魚的合理性」。後端魚種數值 Phase 1 已按計畫設計表定案（倍率↔HP↔稀有度），Phase 4 把前端視覺對齊這份真相（體型/游速/出現率/辨識度），並補上 Boss/魚群事件變化，讓「打不同魚」有明確分級感受。spawn 在前端僅影響視覺，輸贏仍由後端決定（ADR-003），無套利。

### 如何驗證
- `cd frontend && npm run lint`（0 error）、`npm run build`（綠）。
- `npm run dev`：金龍/貔貅/財神體型介於中魚與龍王之間且帶光暈、不再誤觸發 Boss 警報；龍王定時降臨（警報 + BGM 切換）；偶發魚群潮密集小魚。
- 真實後端 fishing API（start→shots→end）回傳 hp/tier/spawnWeight 與 crit/damage/hpRemaining 實測通過。

---

## [Added] — 2026-06-24 — 前端導入 Vitest，補 axios 401 攔截器自動續期測試

> 前端先前只有 eslint 與 Playwright e2e，無單元測試框架。為前一筆「401 靜默續期」加上回歸保護，導入 Vitest（vite 專案原生整合）。

### Added
- `frontend/src/services/api.test.js`：涵蓋 401 攔截器 7 個情境——續期成功並重送原請求、並發 401 single-flight（只續期一次）、續期失敗 → 登出重導、無 refresh token → 直接登出不續期、auth 端點 401／`skipAuthRedirect`／非 401 皆不觸發續期。以自訂 axios adapter + `vi.spyOn(axios,'post')` 驅動，免真實網路。
- `frontend/package.json`：新增 devDependency `vitest`、`jsdom`，及 `test`（`vitest run`）、`test:watch` script。
- `frontend/vite.config.js`：新增 `test`（`environment: 'jsdom'`、`include: src/**/*.{test,spec}.{js,jsx}`）。
- `.github/workflows/ci.yml`：新增 `frontend-test` job（`npm ci` + `npm test`），PR/push 至 main/develop 時擋關。

### 如何驗證
- `cd frontend && npm test`：7 passed。
- `npx eslint src/services/api.test.js`：通過。

## [Changed] — 2026-06-24 — 前端 access token 過期改為靜默續期，不再直接踢回登入頁

> 問題：access token 預設只有 15 分鐘（`JWT_ACCESS_TOKEN_EXPIRY_MS:900000`），但前端雖存有 7 天的 refresh token（`JWT_REFRESH_TOKEN_EXPIRY_MS:604800000`）卻從未拿去續期。
> 結果任何請求一旦回 401，攔截器就 `logout()` + 整頁重導 `/login`，使用者體感「閒置/停留太久就自動登出」。
> 決策：採「反應式」續期——收到 401 時先用 refresh token 換新 token 並重送原請求，換不到才登出。後端 refresh **會輪替** refresh token（`AuthService.refreshToken` 先 delete 再存新），故前端必須存回新 refresh token，且並發 401 需 single-flight 避免第二個請求 mismatch。

### Changed
- `frontend/src/services/api.js`：401 回應攔截器改為先嘗試 `POST /api/v1/auth/refresh` 靜默續期再重送原請求；續期失敗（或無 refresh token / mock 模式）才 `logout()` 重導。
  - single-flight（`refreshPromise`）：並發 401 共用同一次續期，避免後端 refresh token 輪替造成 mismatch。
  - 用乾淨的 `axios.post`（非 `api` 實例）呼叫 refresh，避免遞迴攔截與帶上過期 token；以 `config._retry` 防無限重試；`skipAuthRedirect`/auth 端點維持原行為（不重導）。
- `frontend/src/store/slices/authSlice.js`：新增 `tokenRefreshed` reducer，只更新 access/refresh/expiresIn 並寫回 localStorage、**保留 `player`**（不可複用 `loginSuccess`，它會把 `player` 蓋成 undefined）。

### 為什麼
- 後端早有 `POST /api/v1/auth/refresh`（`AuthController`）與 7 天 refresh token，前端未串接是純體驗缺口；接上後 15 分鐘 access token 到期可無感續期，僅在 refresh 也失效（最長 7 天）時才需重新登入。

### 如何驗證
- `cd frontend && npx eslint src/services/api.js src/store/slices/authSlice.js`：通過。
- `npm run build`：成功（`✓ built`）。

## [Fixed] — 2026-06-24 — 捕魚機四個前端體驗 bug 修正

### Fixed
- `frontend/src/components/fishingEngine.js`：**限流視覺子彈** — 有魚目標但 token bucket 限流時不再生成視覺子彈，消除「大量子彈飛出卻不扣注也不傷魚」誤解。
- `frontend/src/components/fishingEngine.js`：**HP 條計時消失** — 魚有累積傷害（`hp < maxHp`）時 HP 條以半透明（alpha 0.55）持續顯示，大魚多發攻擊時玩家可看到傷害積累。
- `frontend/src/services/mockApi.js`：**fishDamage ID 碰撞** — `fishingActive()` 恢復場次時先清空 `fishDamage`，防止引擎重建後新魚繼承舊魚傷害（新魚 hpRemaining 異常或一擊即死）。
- `frontend/src/pages/Fishing.jsx`：**結算說明不足** — 結算按鈕下方新增「剩餘餘額全額退回」說明，玩家知道無需打光餘額即可隨時結算。

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
