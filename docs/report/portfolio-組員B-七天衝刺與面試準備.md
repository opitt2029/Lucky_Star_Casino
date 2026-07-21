# 組員B — 七天衝刺清單：上台報告 × 面試準備

> **這份給誰**：B組（遊戲引擎：game-service + 捕魚 PixiJS）——負責 Provably Fair RNG、老虎機/百家樂規則、RTP 統計與風控門檻、捕魚血量/傷害模型、PixiJS 渲染引擎。
> **怎麼用**：報告前照 Day 1→7 逐天完成、逐項打勾；面試前拿同一份複習，最後翻「防禦表」與「數據速記卡」。
> **素材來源**（全部是專案真實文件，本檔只做整合與排程，不重抄內容）：
> - `docs/report/PROJECT_ANALYSIS.md`（組員B 的全專案技術分析——亮點/取捨/面試官 13 題就在裡面）
> - `docs/report/portfolio-四人分工詳細指南.md`（B組段落：關鍵字→檔案對照表、Demo 建議）
> - `docs/interview-prep/00`~`13`（面試準備包全套）
> - `docs/adr/ADR-003.md`（捕魚 PixiJS + 血量模型）、`docs/adr/ADR-004.md`（捕魚經濟再平衡）
> - `contracts/slot-paytable.json` / `baccarat-rules.json` / `fishing-combat.json` / `fishing-species.json`（玩法數值單一來源）

---

## 0. 你的三句賣點 ↔ 專案證據對照（先看這張，知道自己在賣什麼）

| 賣點句 | 對應素材 | 主讀章節 |
|---|---|---|
| 三款遊戲（老虎機/百家樂/捕魚）全部基於 Provably Fair RNG（SHA-256 承諾），玩家可事後驗證，並有 per-game RTP 風控門檻 | PF 承諾-揭露流程、風控誤判改判事故與修法 | `02` 決策 5、雷區 17、`PROJECT_ANALYSIS` §8.4/§8.6 |
| 遊戲數學有理論根據：老虎機 RTP 封閉式公式寫進 Javadoc（≈93.5%）、捕魚 pCapture 反推公式使 RTP 恆等於設計值 0.96、殘血回收 0.70 當體感地板 | `SlotSymbol` Javadoc、`FishingCombat` Javadoc、ADR-004 | Day 2 / Day 4、`PROJECT_ANALYSIS` §8.5 |
| 前端自寫 PixiJS 遊戲引擎（脫離 React 生命週期、物件池、FPS 守門）根治 DOM 渲染當機，玩法數值以 `contracts/*.json` 單一來源＋`ContractParityTest` 守門 | ADR-003、`fishingEngine.js`、雷區 13/14/16 | Day 5、`PROJECT_ANALYSIS` §8.7 |

三句話對應三個主戰場，七天計畫圍繞它們排：**Day 1 全貌、Day 2 RNG＋老虎機、Day 3 百家樂＋風控、Day 4 捕魚後端、Day 5 捕魚前端＋契約、Day 6 跨服務協防（帳務/Kafka/測試）、Day 7 報告演練＋行為題**。

---

## ⚠️ 先做這件事：PROJECT_ANALYSIS 過時點修正表（上台/面試前必看）

`PROJECT_ANALYSIS.md` 分析日期 2026-07-07，以下幾點**已被後續進度超車**。照舊講會被熟專案的面試官（或組長）當場糾正：

| PROJECT_ANALYSIS 原文 | 現況（以程式碼/最新文件為準） | 證據 |
|---|---|---|
| §7/§10「壓測腳本備而未跑、無實測 P99」 | **T-090 已實測完整戰役**：150 併發 5xx 78%→0、C3+B1 重跑 1,000 併發成功 +430%、401 歸零 | `docs/interview-prep/13`、`docs/performance/T-090-*`、commit `48a98c5` |
| §12.12「賠付表抽成共用 JSON 契約——已在待辦」 | **已完成（Phase 5）**：`contracts/*.json` 為數值單一來源，mock 直接 import，後端由 `ContractParityTest` 逐欄斷言、漂移=CI 紅燈 | AGENTS.md 雷區 14、`backend/game-service/src/test/.../ContractParityTest.java` |
| §14.8「AUDIT_REPORT 手動快照落後，建議自動化」 | **已完成（2026-07-07）**：`node tools/audit/generate-audit-snapshot.mjs` 自動生成附錄 A | AGENTS.md §1、`docs/report/audit-snapshot-20260707.md` |
| §5「Docker Compose 只涵蓋基礎設施，後端用 Maven 跑」 | **七個服務已全容器化**：`docker compose up -d` 一鍵啟動，healthcheck 依賴鏈（gateway 最後起） | 分工指南 E2 |
| §14.2「補觀測性（Prometheus/Grafana）」 | 已有 `--profile observability` 選配（壓測戰役全程用 Prometheus 證據鏈） | 分工指南 E2、`13` §2 |
| §14.1「導入 Testcontainers」 | **部分完成（ADR-007）**：wallet-service 已有 `@Tag("containers")` 真 DB 測試（postgres:16+mysql:8.4、`ddl-auto=validate`） | AGENTS.md 雷區 3 |

> 面試加分講法：不要只當勘誤，把它講成「分析 → 排優先級 → 逐項落地」的敘事——§14 改進建議的第 1/2/5/6/8 項在一週內全部或部分完成，這就是工程執行力的證據。

---

## Day 1 — 全貌、電梯稿、B組地圖

**目標**：閉眼能畫 7 服務架構圖；30 秒/2 分鐘自我介紹脫稿；知道 B組每個主題的程式碼在哪個檔。

### 必讀（約 2 小時）
- [ ] `docs/interview-prep/00-index.md` §1~§3（30 秒電梯版、兩分鐘技術版、白板深問版）——**§1 直接背起來**
- [ ] `docs/interview-prep/01-專案程式碼地圖.md` 全文（重點：§2 七服務職責、§3 端到端請求流）
- [ ] `PROJECT_ANALYSIS.md` §1~§4（專案定位「刻意練習的學習型專案」的自圓其說、§2 核心功能表、§4 架構圖——這是你自己組員的分析，觀點要一致）
- [ ] 分工指南 **B組段落**：關鍵字→檔案位置表整張掃一遍（面試被問「程式在哪」要能指路）

### 要能講出來（自我檢核）
- [ ] 30 秒電梯稿講一遍不看稿，然後**接一句 B組版補充**：「我負責遊戲引擎——三款遊戲的規則與數學模型、Provably Fair 可驗證公平、RTP 風控，以及捕魚機的 PixiJS 渲染引擎」
- [ ] 白板畫出：前端 → Gateway → game-service 下注 → REST 同步呼叫 wallet `debit` → 遊戲結算 → `credit` → Kafka `wallet.credit`/`game.result` 事件 → rank / notification
- [ ] 答出「為什麼是 7 個微服務？對模擬幣遊戲不會太重嗎？」→ 用 `PROJECT_ANALYSIS` §1/§15 的說法：**刻意的學習設計**，ADR 有取捨紀錄；並能舉一個「反過來刻意簡化」的例子（不用服務發現、環境變數直連）證明有規模感
- [ ] 三款遊戲各一句話定位：老虎機（單人、逐格加權、兩階賠付）、百家樂（規則牌桌、補牌表、5% 傭金）、捕魚（buy-in + 批次結算、血量累傷、高頻互動）

### 今日題庫
- [ ] `05` 脈絡 A（語言與工具基礎 1–25）＋ 脈絡 B（Spring Boot 與微服務骨架 26–50），對 `06` 答案

---

## Day 2 — Provably Fair RNG ＋ 老虎機數學（賣點句 1、2 的前半）

**目標**：把「怎麼證明莊家沒作弊」與「RTP 怎麼從公式算出來」講到滾瓜爛熟。

### 必讀（約 2.5 小時）
- [ ] `docs/interview-prep/02-設計決策與為什麼.md` **決策 5**（Provably Fair RNG + per-game RTP 風控 ★B組最重要）＋附錄二對應追問鏈
- [ ] 真實檔案走讀：`ProvablyFairRng`（`game-service/.../rng/`）、`VerificationService/Controller`、`SlotSymbol`（**Javadoc 的 RTP 推導整段讀懂**）、`SlotService`、`SlotMachineTest.spin_rtpWithinExpectedBand`
- [ ] `contracts/slot-paytable.json` 打開對照 `SlotSymbol`：欄位怎麼對應、`ContractParityTest` 斷什麼
- [ ] AGENTS.md 雷區 12（壓測前置與老虎機 API 契約）、15（改權重四同步）

### 要能講出來
- [ ] PF 流程默畫：**server 先給 serverSeed 的 SHA-256 承諾（hash）→ 玩家提交 clientSeed → 結果 = SHA-256(serverSeed + clientSeed + nonce) → 事後揭露 serverSeed → 玩家用 `/verify` 端點重算**。關鍵句：「承諾在前，server 看到 clientSeed 之後已經不可能挑 seed」（`PROJECT_ANALYSIS` §12.6）
- [ ] 老虎機兩階賠付公式白板寫出：RTP = Σpᵢ³·Tᵢ（三連）+ Σpᵢ²(1−pᵢ)·Pᵢ（左二同）≈ **93.5%**；命中率 = Σpᵢ³ + Σpᵢ²(1−pᵢ) ≈ **30.7%**（含本金口徑、單中線）
- [ ] 答出「這個 93.5% 怎麼驗證的？」→ 兩層：理論值寫進 Javadoc（封閉式公式）＋ `SlotMachineTest` 用統計帶斷言實測 RTP 落在區間（大數法則，不是斷單一值）
- [ ] 答出「改一個符號的權重要動哪裡？」→ 四同步：`SlotSymbol` → `contracts/slot-paytable.json` → `SlotSymbolTest`/`SlotMachineTest` 區間 → Javadoc 理論值；漏了 `ContractParityTest` 會紅（這題展示工程紀律，比數學題更加分）
- [ ] 答出「冪等鍵誰生成？」→ 老虎機冪等鍵由**伺服器端生成**（非 client 傳入），命名如 `slot-bet-<roundId>` / `slot-win-<roundId>`——確定性命名讓重試天然安全

### 今日題庫
- [ ] `05` 脈絡 G（遊戲引擎與隨機性 161–180 ★B組主戰場），對 `06`

---

## Day 3 — 百家樂 ＋ RTP 風控門檻（含真實事故敘事）

**目標**：把「風控門檻低於結構性 RTP → 百家樂被強改莊贏」這個真實事故講成完整的「踩雷→根因→制度化」故事——這是面試最有說服力的素材類型（`PROJECT_ANALYSIS` §15 明點）。

### 必讀（約 2.5 小時）
- [ ] 真實檔案走讀：`BaccaratGameService.bankerDraws`（補牌表）、`BaccaratController`、`RiskControlService`、`RtpStatsService`
- [ ] `backend/game-service/src/main/resources/application.yml` 的 `risk.global-rtp-limit` 區塊——**連註解一起讀**：門檻值是蒙地卡羅模擬（老虎機 500 萬局、百家樂 300 萬局）定的，不是拍腦袋
- [ ] `contracts/baccarat-rules.json` 對照補牌表；AGENTS.md 雷區 17（含本金口徑）
- [ ] `docs/report/遊戲玩法Bug稽核-幸運值風控PF-2026-06-22.md`（行為題素材：幸運值保底主動移除）

### 要能講出來
- [ ] 百家樂規則三件套：補牌表（閒 0–5 補、莊依閒第三張查表）、天牌 8/9、**和局押莊/閒 push 退本金**、莊贏扣 **5% 傭金**（結構性 RTP ≈ 0.99 的來源）
- [ ] 事故完整敘事（2026-06-25 修復）：`game_rounds.win_amount` 存**含本金**派彩 → RTP=win/bet 的正常水位≈各遊戲結構性 RTP → 當初單一標量門檻低於百家樂的 0.99 → **風控每局誤判超限、把結果強制改判「莊家贏」** → 修成 per-game map，並立規範「門檻必須訂在該遊戲結構性 RTP 之上」
- [ ] 進階版（把事故講出深度）：門檻不是「結構性 RTP + 一點點」就好——老虎機有 70x/40x 重尾，500 局窗口 RTP 標準差 ≈0.104，門檻 0.97 時仍可能誤觸；所以 SLOT 訂 **1.30**、BACCARAT **1.20**、FISHING **1.10**（高變異留裕度），誤觸 ≤0.08% 仍攔得住真異常（賠付表 bug 會讓窗口 RTP 持續遠超門檻）
- [ ] 答出「為什麼不把 win_amount 改成不含本金？」→ 口徑是既有帳務契約，改口徑動到全鏈路（wallet/admin 報表/歷史資料）；調門檻語意等價、影響面小——**選影響面小的修法**也是取捨能力
- [ ] 行為題素材備妥：幸運值保底機制主動移除的故事（正確性/可驗證公平 > 玩家爽感，PF 承諾不能被隱藏參數污染）

### 今日題庫
- [ ] `05` 脈絡 H（系統設計與營運 181–200），對 `06`

---

## Day 4 — 捕魚後端：血量/傷害模型 ＋ Redis session ＋ 經濟模型（全專案複雜度最高的一條線）

**目標**：`PROJECT_ANALYSIS` §2 明說捕魚是「最能展現技術力的功能」——這天不能壓縮。把數學模型、狀態持久化、和「大魚打不死」事故三件事講到反射級。

### 必讀（約 3 小時）
- [ ] `docs/adr/ADR-003.md`（為何從 DOM+每發獨立命中 改成 PixiJS+血量模型）、`docs/adr/ADR-004.md`（經濟再平衡：RTP/砲台/回收率/面額解耦）
- [ ] 真實檔案走讀：`FishingCombat`（**類別 Javadoc 整篇讀懂**，含 pCapture 推導與期望耗彈 DP）、`FishSpecies`、`FishingService`（`settleInternal` 的回收累加）、`FishingSession`、`FishingSessionStore.toHash()/fromHash()`、`FishingController`（buy-in / shots / top-up / settle）
- [ ] `FishingSessionStoreTest`（守「序列化漏欄位」回歸的測試）、`FishingCombatTest`（RTP band）
- [ ] AGENTS.md 雷區 16 全文（B組最長的一條雷區，就是你的領域知識濃縮）

### 要能講出來
- [ ] 核心公式白板寫出：**pCapture = TARGET_RTP × E[N] / multiplier**（E[N]=打死該魚的期望耗彈數，含暴擊的 DP 算出）→ 推論：**RTP 恆等於 0.96，與魚種、砲台等級無關**——「不是調出來的，是反推出來的」這句要講
- [ ] 經濟模型雙邊界：天花板 = TARGET_RTP **0.96**（打死路徑）；體感地板 = RECOVERY_RATE **0.70**（結算時殘血魚按已造成傷害退還 70% 期望子彈成本，回收恆 ≤ 投入 → 不會讓整體 RTP 破表）。關鍵句：「玩家最差體感只虧 30%，莊家最差也只付 96%」
- [ ] 數字反射級：暴擊率 **20%**、暴擊 **×2**；砲台傷害 **{14, 22, 32}**（銅/銀/金）；面額自選 **10~10,000** 且與砲台解耦（ADR-004）；面額/砲台 **session 級進場鎖定**，場中切換會被 `validateBatch` 拒（為什麼：消除 shots 與 top-up 併發覆寫 session 的競態——用限制換一致性）
- [ ] 「大魚打不死」事故完整敘事：跨批累傷存 Redis `FishingSession`（key=`game:fishing:session:{playerId}`，Hash，TTL 24h）→ 曾因 `FishingSessionStore` **漏序列化 `fishDamage` 欄位**，跨批累傷歸零、HP 每批回滿 → 大魚永遠打不死；**為什麼測試沒抓到**：`FishingServiceTest` 把 store 整個 mock 掉 → 教訓：mock 邊界劃太大會把 bug mock 掉，補 `FishingSessionStoreTest` 直接測序列化往返
- [ ] 答出「為什麼戰鬥狀態放 Redis 不放 DB？」→ 高頻（每秒多發）短生命週期狀態，Redis 延遲與 TTL 語意合適；代價是「讀→改→整包 save」在多實例下是競態根源，目前用 top-up 鎖＋場中禁改迴避，水平擴展前要改 Lua/WATCH（`PROJECT_ANALYSIS` §10/§12.7——弱點主動講，展示你知道邊界在哪）
- [ ] 答出「為什麼不給低捕獲率設 pCapture 硬地板？」→ 會讓 RTP 破表（ADR-004 算過）；要降「血歸零卻掙脫」的挫折感，正確解法是縮小砲台傷害差距

### 今日題庫
- [ ] `07` 脈絡 N（帳務/CQRS/Kafka 進階 313–344）挑 Redis/狀態一致性相關題，對 `08`

---

## Day 5 — 捕魚前端：PixiJS 引擎 ＋ 下注三鐵則 ＋ 契約單一來源（賣點句 3）

**目標**：把「為什麼要自己寫遊戲引擎」與「前後端數值怎麼不分歧」講清楚——這是後端求職作品裡罕見的跨域廣度（`PROJECT_ANALYSIS` §15 優勢 4）。

### 必讀（約 2.5 小時）
- [ ] 真實檔案走讀：`frontend/src/components/fishingEngine.js`（非 React 的 Pixi 引擎：單一 ticker、物件池、並存上限、FPS 守門、`prefers-reduced-motion`）、`FishingCanvas.jsx`（薄殼 + `React.lazy` code-split）、`useFishingSession`（token bucket 限速、`topUpLockRef`）
- [ ] `frontend/src/services/mockApi.js` 的 `fishingShots`／`SLOT_PAYTABLE`：確認 mock 怎麼 import `contracts/*.json`（`vite.config.js` 的 `server.fs.allow`）
- [ ] `ContractParityTest`：後端 enum ↔ JSON 逐欄斷言，漂移 = CI 紅燈
- [ ] AGENTS.md 雷區 13（下注三鐵則）、14（mock 鏡像後端＝單一真相）

### 要能講出來
- [ ] ADR-003 敘事：舊 `FishingArena.jsx` 用 DOM 渲染幾十條魚＋子彈＋特效 → React reconciliation 撐不住、當機元兇 → 改 PixiJS canvas：**脫離 React 生命週期**（單一 ticker 統一驅動）、**物件池**（避免高頻 new/GC）、**FPS 守門與 perfMode**（降級而非崩潰）——這題本質是「知道 React 的邊界在哪」
- [ ] 前後端職責切分一句話：「**後端算命運，前端演命運**」——傷害/暴擊/捕獲/派彩全在 `FishingCombat`，後端回 `ShotResult{crit,damage,hpRemaining,killed,captured}`，前端只負責演出這些欄位；前端唯一決定的是「打哪條、何時打」
- [ ] 下注三鐵則各舉一個檔案實例：餘額守門（disabled 含 `balance >= bet` + 送出函式雙保險）、視覺鎖綁真實生命週期（禁止魔術數字 setTimeout）、音效統一走 `soundEngine`（per-id 節流；捕魚開火另有 token bucket）
- [ ] mock 鏡像問題的完整演進答案（蓋掉 `PROJECT_ANALYSIS` §12.12 的舊版）：**「純靠紀律雙寫 → Phase 5 把表格數值抽成 `contracts/*.json` 單一來源（mock 直接 import、後端 `ContractParityTest` 守門）→ 剩下的『演算邏輯』（補牌流程、pCapture 反推）仍是鏡像程式碼，由兩邊測試斷同一組理論值」**——被問「雙寫成本怎麼控」時這是滿分答案
- [ ] 答出「為什麼後端不 runtime 載 JSON？」→ 後端 enum/常數是執行期權威，runtime 載外部檔案引入啟動順序/檔案缺失的新故障模式；用測試在 CI 斷相等，把風險移到建置期

### 今日題庫
- [ ] `07` 脈絡 L（網路與 Web 基礎 273–288，前端串接/WebSocket 相關）＋ 脈絡 M（Spring 微服務深化 289–312）挑題，對 `08`

---

## Day 6 — 跨服務協防：game→wallet 帳務、Kafka、測試策略

**目標**：B組不可能只被問遊戲——「下注扣款怎麼不出錯」「credit 失敗怎麼辦」一定會問到你頭上（game-service 是 wallet 最大的呼叫方）。這天把 `PROJECT_ANALYSIS` §11 的 13 題全部過一遍。

### 必讀（約 3 小時）
- [ ] `docs/interview-prep/02` **決策 1**（冪等+樂觀鎖）、**決策 3**（指令 vs 事件）、**決策 9**（ADR-009 補償）——從 game-service 呼叫方視角讀
- [ ] `docs/interview-prep/11-下注請求流與程式碼地圖.md` 全文（白板題範本＋失敗模式表——主角就是你的 slot spin）
- [ ] `WalletCompensationService` / `WalletCompensationRetryJob`（`game-service/.../compensation/`）＋ AGENTS.md 雷區 22
- [ ] `PROJECT_ANALYSIS.md` §9（工程取捨表）、§11＋§12（面試官 13 題與答法——**這是你組員自己寫的模擬面試，每題要能脫稿講出 §12 的答案**）
- [ ] 測試策略：`01` 測試策略段 + `PROJECT_ANALYSIS` §7（103 個測試類、H2+`@EmbeddedKafka` 零外部依賴、四層 CI 擋關）

### 要能講出來
- [ ] 下注請求流白板走一遍：spin → game 呼 wallet `debit`（冪等鍵 `slot-bet-<roundId>`、`@Version` 樂觀鎖）→ RNG 出結果 → `credit`（`slot-win-<roundId>`）→ 發 `wallet.credit` 事件 → rank/讀視圖
- [ ] 「debit 成功、credit 失敗怎麼辦？」反射級：catch 內落 `pending_wallet_credits` 補償單 → 排程每 30 秒帶**完全相同的冪等鍵**重試 →「換了鍵就會重複入帳——安全根基是 wallet 端 idempotency_key UNIQUE」；語意細節：settle credit 失敗＝玩家贏了，補償是重試同鍵 credit（WIN），**不是退款**；fishing buy-in 退款再失敗才是 REFUND
- [ ] 「為什麼補償走 HTTP 不走 Kafka？」→ 消費 `wallet.credit`/`wallet.debit` 事件回呼帳務方法是無限迴圈雷（雷區 6/22），指令-事件語意必須守住
- [ ] game-service 發哪些 Kafka 訊息：`game.result`（事件 → notification 推播，best-effort 無 DLT）；消費側 rank 只認 `WIN` 計分
- [ ] 測試策略一句話版：「單元/切片全走 H2＋EmbeddedKafka 做到 `mvn test` 零外部依賴；數值正確性用統計帶斷言（RTP band）；契約用 `ContractParityTest` 擋漂移；H2 方言盲區用 wallet 的 Testcontainers 真 DB 測試補（ADR-007）」——順帶答掉 `PROJECT_ANALYSIS` §11.10
- [ ] `PROJECT_ANALYSIS` §11 十三題逐題自測：蓋住 §12 先講，再對答案（尤其 Q2 拆 topic、Q5 crash 補償、Q6 PF seed、Q7 session 競態、Q8 風控、Q11 瓶頸預測、Q12 mock 雙寫——七題全在你的守備範圍）

### 今日題庫
- [ ] `05` 脈絡 D（帳務核心 76–105）＋ 脈絡 F（Kafka 136–160），對 `06`

---

## Day 7 — 上台報告總演練 ＋ 行為題 ＋ 查漏補缺

**目標**：demo 全流程跑通（含備援方案）；行為題兩個故事口述順暢；數據卡背熟。

### 上台報告演練（B組 demo 腳本，跑一次全流程）
- [ ] **開場**（架構 1 分鐘）：貼 `PROJECT_ANALYSIS` §4 架構圖，一句帶過「我負責 game-service 與捕魚前端引擎」
- [ ] **老虎機**：spin 展示中獎判定 → 講兩階賠付與理論 RTP 93.5%（貼 `contracts/slot-paytable.json` 表格當投影片）
- [ ] **Provably Fair**：秀下注前的 seed hash 承諾 → 開獎後揭露 serverSeed → 用 `/verify` 端點現場重算给觀眾看——**這是全場最有戲劇性的 demo 點，放中間**
- [ ] **捕魚**：展示血量條/暴擊/大魚捕獲 → 講 pCapture 反推「RTP 恆 0.96」與殘血回收地板 0.70（貼 `contracts/fishing-species.json` 魚種表）
- [ ] **收尾**：RTP 理論值 vs 風控門檻表（SLOT 0.935→門檻 1.30、BACCARAT 0.99→1.20、FISHING 0.96→1.10），講 2026-06-25 誤判改判事故 30 秒版
- [ ] **備援方案演練**：後端起不來時，前端 mock 模式（`VITE_USE_MOCK_API=true`）單獨展示——mock 鏡像後端玩法，體驗＝真實規則（`PROJECT_ANALYSIS` §6）；投影片先截好每個 demo 步驟的圖當最後防線
- [ ] 計時：B組段落控制在分工時限內，PF 驗證與捕魚是重頭戲，老虎機可壓縮

### 面試收尾複習
- [ ] `docs/interview-prep/09-開發流程與工程實踐.md` 掃過（§0 30 秒版背起來——被問「你們團隊怎麼做事」用）
- [ ] `docs/interview-prep/12-OOP四大支柱深講.md` 掃過，B組各記一個實例（例：封裝=`FishingSession` 狀態只經 store 序列化進出；多型=`SlotSymbol` enum 帶行為；抽象=`ShotResult` DTO 把「命運」與「演出」解耦）
- [ ] `03`/`04` 查漏式掃標題：講不出兩句話的展開讀（樂觀鎖 vs 悲觀鎖、隔離級別、Kafka at-least-once/冪等消費為必修）
- [ ] 行為題兩個故事口述：①**大魚打不死**（序列化漏欄位＋測試 mock 掉 store 的雙重教訓 → 補回歸測試制度化）②**幸運值保底主動移除**（正確性/可驗證公平 > 玩家爽感）
- [ ] `00` §4「面試官問 X → 翻到哪」對照表走一遍，每格先給一句話結論
- [ ] 兩套題庫錯題重做（`05`/`07` 做錯的題）；下方「數據速記卡」全背

---

## 防禦表（B組會被問的問題 → 答題方向 → 證據在哪）

### 分工指南 B組預告的五題

| 問題 | 答題方向 | 證據 |
|---|---|---|
| RTP 怎麼算？含本金 vs 不含本金差在哪？ | `win_amount` 含本金 → RTP=win/bet 正常水位≈結構性 RTP（slot 0.935/baccarat 0.99/fishing 0.96）；不含本金口徑水位會低一截，門檻/報表口徑必須一致，否則就是 6/25 那個誤判事故 | 雷區 17、`application.yml` 註解、Day 3 |
| Provably Fair 怎麼保證莊家沒作弊？ | 承諾在前：先給 serverSeed hash → 玩家給 clientSeed → SHA-256(server+client+nonce) → 事後揭露＋`/verify` 重算；server 無法在看到 clientSeed 後挑 seed | `02` 決策 5、Day 2 |
| 捕魚為何把累傷存 Redis 而不是每次重算？ | 累傷是**跨批次事實**不是可重算函數（每批 shots 的隨機暴擊已定案）；高頻短生命週期選 Redis（TTL 24h）；並主動講競態限制與 Lua 演進方向 | ADR-003、Day 4 |
| 前端 mock 為何要跟後端鏡像？不對齊會怎樣？ | mock 是預設體驗（`VITE_USE_MOCK_API !== 'false'`），不對齊＝玩家練的玩法和真實結算不同世界；演進：紀律雙寫 → contracts 單一來源 + ContractParityTest | 雷區 14、Day 5 |
| 砲台/面額為何進場後鎖定？ | session 是「讀→改→整包 save」，場中可變參數會讓 shots 與 top-up 併發互相覆寫（錢蒸發）；鎖定＝用限制換一致性，validateBatch 後端強制 | ADR-004、雷區 16、Day 4 |

### PROJECT_ANALYSIS §11 落在 B組守備範圍的追問

| 問題（§11 編號） | 一句話核心（完整版見 §12 與本檔 Day 2~6） |
|---|---|
| Q5 game crash 錢怎麼辦 | 冪等鍵兜底＋ADR-009 補償單同鍵重試；完整 Saga 未做、是已知邊界 |
| Q6 PF seed 何時揭露 | hash 承諾在前、開獎後揭露、`/verify` 重算 |
| Q7 session 多實例覆寫 | 現況：top-up 鎖＋場中禁改；演進：Lua/WATCH 原子更新 |
| Q8 風控 per-game 原因 | 含本金口徑＋結構性 RTP 各異＋變異度決定裕度（蒙地卡羅定門檻） |
| Q11 預期第一個瓶頸 | wallet 同步 debit（每 spin 一次 REST＋樂觀鎖交易）——**已被 T-090 實測證實**：單機 Postgres ≈550–600 筆/秒，答題時直接引用實測數據，比「預期」更有力 |
| Q12 mock 雙寫成本 | 已解一半：contracts 單一來源（數值）＋鏡像程式碼（邏輯）＋雙邊測試斷同一組理論值 |

---

## 數據速記卡（上台/面試前 10 分鐘看這張）

**技術棧**：Java 21、Spring Boot 3.3.5、JJWT 0.12.6；React 18 + Vite 5 + Redux Toolkit + **PixiJS 8**
**Port**：gateway 8080 / member 8081 / wallet 8082 / **game 8083** / rank 8084 / admin 8086 / notification 8087

**老虎機**（`SlotSymbol`、`contracts/slot-paytable.json`）：
- 逐格加權抽符號、單中線**兩階賠付**（三連 Tᵢ ＋ 左二同 Pᵢ）、倍率綁符號
- 理論 **RTP ≈ 93.5%**、**命中率 ≈ 30.7%**（含本金口徑）；公式 RTP=Σpᵢ³Tᵢ+Σpᵢ²(1−pᵢ)Pᵢ
- API：`POST /api/v1/game/slot/spin`，冪等鍵伺服器端生成（`slot-bet-<roundId>`/`slot-win-<roundId>`）

**百家樂**：補牌表（閒 0–5 補；莊查閒第三張）、天牌 8/9、和局押莊/閒 **push 退本金**、莊贏扣 **5% 傭金** → 結構性 RTP ≈ **0.99**

**捕魚**（`FishingCombat`、ADR-003/004）：
- **pCapture = TARGET_RTP × E[N] / multiplier** → RTP 恆 **0.96**，與魚種/砲台無關
- 體感地板＝殘血回收 **RECOVERY_RATE 0.70**（結算退還 70% 期望子彈成本，恆 ≤ 投入）
- 暴擊 **20%、×2**；砲台傷害 **{14, 22, 32}**；面額 **10~10,000** 自選、與砲台解耦、進場鎖定
- Session：Redis key `game:fishing:session:{playerId}`、Hash、**TTL 24h**；動欄位必同步 `toHash()/fromHash()`
- 場中加值 `POST /{sessionId}/top-up`（`clientRequestId` 冪等）＋前端 `topUpLockRef` 鎖 fire

**風控門檻**（`risk.global-rtp-limit`，含本金口徑、蒙地卡羅定值）：default 1.05 / **SLOT 1.30** / **BACCARAT 1.20** / **FISHING 1.10**——鐵律：門檻必須高於該遊戲結構性 RTP

**Provably Fair**：SHA-256(serverSeed + clientSeed + nonce)；hash 承諾 → 玩家提交 → 開獎 → 揭露 → `/verify` 重算

**契約守門**：`contracts/slot-paytable.json`/`baccarat-rules.json`/`fishing-combat.json`/`fishing-species.json` ＝數值單一來源；mock 直接 import；後端 `ContractParityTest` 逐欄斷言、漂移=CI 紅

**金句三發**：
1. 「捕魚的 RTP 不是調出來的，是 pCapture 反推出來的——所以恆等於 0.96，跟你用哪門砲打哪條魚無關。」
2. 「後端算命運，前端演命運——`ShotResult` 就是這條分界線。」
3. 「風控門檻訂在結構性 RTP 之下，攔到的不是作弊者，是機率本身。」

---

## 附：時間不夠的最小保命集（只剩一天時）

1. `00` §1 電梯稿 ＋ 本檔「數據速記卡」（30 分鐘）
2. `02` 決策 5（Provably Fair + RTP 風控）＋ Day 3 的誤判改判事故敘事（1 小時）
3. Day 4 的捕魚三件套：pCapture 公式、回收地板、「大魚打不死」事故（1 小時）
4. `11` §2 下注請求流白板畫三遍＋「credit 失敗怎麼辦」（30 分鐘）
5. 本檔「防禦表」全表過一遍＋「PROJECT_ANALYSIS 過時修正表」確認不講錯舊資訊（30 分鐘）
