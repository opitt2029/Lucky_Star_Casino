# Lucky Star Casino — 專案技術分析報告

> 分析日期：2026-07-07｜**現況更新：2026-07-13**
> 分析範圍：monorepo 全體（7 個後端微服務 + React 前端 + 基礎設施）
> 用途：作品集 / 面試準備 / 技術盤點

> ## ⚠️ 2026-07-13 更新：§14 的 8 項改進建議，7 項已完成
>
> 本報告寫於 7/07。其後一週內，§14 列的改進建議大多已落地——**面試前務必用這裡的新版說法，
> 別再照 §10/§12/§15 的舊文講「壓測沒跑」「Saga 未實作」，那已經不是事實了**。
>
> | §14 建議 | 現況 |
> |---|---|
> | 1. Testcontainers 取代部分 H2 測試 | ✅ 已完成（ADR-007，wallet-service `@Tag("containers")`，`-Pcontainers-test`） |
> | 2. 跑完 T-090 壓測 + 觀測性 | ✅ 已完成（Micrometer/Prometheus/Grafana；150 與 1,000 併發實測，**有真實 P99 數據**） |
> | 3. Redis session 原子化（Lua CAS） | ⬜ **唯一未動工**（`plans/01` Phase 3，ADR-008 編號已保留） |
> | 4. game→wallet 失敗補償正式化 | ✅ 已完成（**ADR-009** 最小 Saga：`pending_wallet_credits` + 每 30 秒同冪等鍵重試 + 對帳 script） |
> | 5. 玩法契約單一來源化 | ✅ 已完成（`contracts/*.json` + `ContractParityTest` 守門，漂移＝CI 紅燈） |
> | 6. 一鍵全容器化 | ✅ 已完成（`docker compose up -d --build` 起 7 服務） |
> | 7. secret 管理 | ✅ 已完成（`.env.example` 全佔位符 + fail-fast + CI run 內即時生成；`docs/security/secret-rotation.md`） |
> | 8. AUDIT_REPORT 自動化 | ✅ 已完成（`tools/audit/generate-audit-snapshot.mjs`） |
>
> **T-090 之後還衍生了一整條效能調校線**（Phase A/B1/C1/C2/C3 皆已落地並對照重跑）：
> 150 併發 P99 −48%（2,753→1,423 ms）、1,000 併發成功數 +430%、401 歸零。
> 這是本作品集現在最強的量化素材，細節見 `docs/performance/T-090-load-test-report.md`
> 與 `docs/interview-prep/13-壓測與效能調校.md`。

---

## 1. 這個專案解決什麼問題？

**專案定位**：Lucky Star Casino（幸運星幣城）是一個**模擬幣線上娛樂平台**（無真實金流），核心目的其實不是「做一個賭場產品」，而是一個**學習型 side project**——用它練習企業級後端架構：微服務拆分、CQRS、事件驅動、帳務一致性。

- **目標使用者**：表面上是玩家（玩老虎機/百家樂/捕魚機的社交娛樂用戶）＋後台管理員；實際上主要受眾是開發團隊自己與面試官——這是一個展示後端工程能力的作品集專案。
- **解決的痛點**：模擬「有錢在流動」的系統最難的部分——**帳務不能錯**（不能重複扣款、不能超扣、不能事件迴圈導致無限入帳）、**遊戲要公平可驗證**（Provably Fair RNG）、**高頻互動不能垮**（捕魚機連發）。
- **為什麼建**：CLAUDE.md 明說作者是「以成為後端工程師/DBA 為目標的 junior engineer，學習優先於交付速度」。專案刻意選了 CQRS 雙資料庫、Kafka 事件驅動這些對一個模擬幣遊戲而言偏重的架構，就是為了練習。

---

## 2. 核心功能

七個微服務＋React 前端：

| 功能 | 說明 |
|---|---|
| 會員系統（member） | 註冊/登入/JWT、好友、每日簽到、月度獎勵、任務 |
| 錢包（wallet） | 星幣餘額、下注扣款/派彩入帳、帳務流水、鑽石點數卡、禮品商城、破產補助 |
| 三款遊戲（game） | 老虎機、百家樂、捕魚機（血量/傷害模型），全部基於 Provably Fair RNG |
| 排行榜（rank） | Redis ZSet、週排行重置、每日快照、好友排行 |
| 後台（admin） | 玩家管理、流通量報表、RTP 監控、風控告警 |
| 推播（notification） | STOMP over WebSocket，消費 Kafka 事件推遊戲結果/排行變動 |
| 閘道（gateway） | JWT 驗證、限流、路由、熔斷 |

**最重要的功能**是 wallet-service 的帳務核心：所有遊戲、簽到、商城、鑽石兌換最終都收斂到 `credit()/debit()`，其正確性（冪等鍵 UNIQUE + `@Version` 樂觀鎖）撐起整個系統。

**最能展現技術力的功能**是**捕魚機**：後端有跨批次持久化到 Redis 的戰鬥狀態（per-fish 累傷、pCapture 捕獲判定、殘血回收 `RECOVERY_RATE=0.70` 的經濟模型，見 ADR-003/ADR-004），前端則是自寫的 PixiJS 非 React 遊戲引擎（`fishingEngine.js`，單 ticker + 物件池 + FPS 守門），兩端加上前後端數值鏡像的約束，是全專案複雜度最高的一條線。

---

## 3. 使用的技術

**後端**：Java 21、Spring Boot 3.3.5、Spring Cloud Gateway、Spring Security + JJWT 0.12.6、Spring Data JPA、Resilience4j、Apache Kafka（KRaft 模式）、Flyway。

**資料庫**：PostgreSQL 16（帳務寫庫）＋ MySQL 8.4（查詢讀庫，CQRS）＋ Redis 7（token 黑名單、遊戲 session、排行榜 ZSet）。

**前端**：React 18 + Vite、Redux Toolkit、React Router、Axios、Tailwind CSS、PixiJS 8、@stomp/stompjs + sockjs。

**基礎設施/測試**：Docker Compose、Kafka UI、GitHub Actions、H2（測試）、@EmbeddedKafka、Vitest、Playwright、JMeter（`tests/performance/slot-1000-players.jmx`）。

**選型理由**：Spring 生態是台灣後端就業市場主流，符合作者職涯目標；Postgres 管帳務（強 ACID）、MySQL 管查詢的分工在 ADR-001 有正式決策紀錄；Kafka 解耦服務間副作用（註冊→開戶→新手禮這條鏈全靠事件）；PixiJS 是為了根治 DOM 渲染捕魚機造成的當機（ADR-003 記載舊 `FishingArena.jsx` 是「當機元兇」）。值得注意的是刻意**不用** Nacos/Eureka 等服務發現，用環境變數直連——對單機開發規模是正確的簡化。

---

## 4. 系統架構

```
瀏覽器 (React :5173)
   │ HTTP / WebSocket（只打 Gateway）
   ▼
Gateway :8080 ── JWT 驗證、限流、熔斷、注入 X-Player-Id
   ├─ member :8081 ─ MySQL
   ├─ wallet :8082 ─ PostgreSQL(寫) + MySQL(讀, CQRS)
   ├─ game   :8083 ─ PostgreSQL(game_rounds) + Redis(session)
   ├─ rank   :8084 ─ Redis ZSet
   ├─ admin  :8086 ─ MySQL
   └─ notification :8087 ─ STOMP /ws
        Kafka :9092（8 個 topic）
```

**同步流**：前端 → Gateway（驗 JWT、解出 playerId 塞進 `X-Player-Id`）→ 業務服務；服務間同步呼叫走 `/internal/**` 並以 `X-Internal-Secret` 驗證（例：game 下注時呼叫 wallet 的 `/internal/wallet/debit`）。

**非同步流（事件驅動）**，最有代表性的兩條：

- **註冊鏈**：member 發 `member.registered` → wallet 消費開戶、member 自己消費發新手禮（發 `wallet.credit.request` 指令）→ wallet 入帳後發 `wallet.credit` 事件 → rank 更新排行、wallet 內的 `WalletReadSyncListener` 同步 MySQL 讀視圖。
- **指令/事件分離（ADR-002）**：`wallet.credit.request` 是「請入帳」指令、`wallet.credit` 是「已入帳」事實，刻意分成兩個 topic 防止消費者誤觸發二次入帳的無限迴圈。

**帳務資料流（CQRS）**：寫入走 Postgres（冪等鍵＋樂觀鎖），透過 Kafka 事件把交易同步到 MySQL 讀視圖（`existsById` 冪等去重），查詢類 API 與 admin 報表讀 MySQL。

---

## 5. 如何在本機執行？

**支援 Docker Compose，但只涵蓋基礎設施**（MySQL/PostgreSQL/Redis/Kafka/Kafka UI），後端服務用 Maven 直接跑、前端用 Vite——這對開發迭代其實比全容器化方便。步驟（詳見 `DEPLOY.md`）：

```bash
cp .env.example .env
docker compose up -d          # 基礎設施；kafka-init 容器自動建 topic，Exited(0) 為正常
# 每個新終端機先把 .env 載入 shell（JWT_SECRET 等缺了啟動即失敗）
set -a && source .env && set +a
mvn -pl backend/member-service spring-boot:run   # 依序 member→wallet→game→gateway
cd frontend && npm install && npm run dev        # http://localhost:5173
```

Windows 另有一鍵腳本 `start-all.bat` / `start-backend.ps1`。前置需求：JDK 21、Maven 3.9+（**專案沒有 mvnw**）、Node 20+、Docker Desktop。

---

## 6. 有沒有線上 Demo？

**無法從專案中確認**有任何公開部署 URL——文件中沒有 demo 連結，也沒有雲端部署設定（無 k8s manifest、無雲端 CI/CD deploy job）。展示方式是本機啟動（30 分鐘 SOP），或前端單獨以 mock 模式展示（`VITE_USE_MOCK_API=true`，mock 完整鏡像後端玩法規則，UI/遊戲體驗可脫離後端展示）。另外 `docs/report` 有含截圖的總體檢報告可作靜態展示素材。

---

## 7. 測試策略

覆蓋相當完整，四個層級都有，且全部進 CI（`.github/workflows/ci.yml`，PR 自動擋關）：

- **後端單元/切片測試**：103 個 `*Test.java`，涵蓋七個服務——帳務（`WalletServiceDebitTest` 等）、遊戲數值（`SlotMachineTest` 的 RTP 統計帶驗證、`FishingCombatTest`、`ProvablyFairRngTest`）、Kafka 消費者、controller。全用 H2 記憶體庫＋`@EmbeddedKafka`，**不需外部基礎設施**。執行：

  ```bash
  mvn -pl backend/gateway-service,backend/member-service,backend/wallet-service,backend/admin-service,backend/game-service,backend/rank-service,backend/notification-service test
  ```

- **整合測試**：`@SpringBootTest` contextLoads（CI 註解明說是為了攔「服務根本起不來」的設定錯，源自 wallet 重複 `@Bean` 事故）、`WebSocketStompIntegrationTest`、`ShopRedemptionIntegrationTest` 等。
- **前端**：ESLint + Vitest 單元測試 + `npm run build` + **Playwright E2E**（`e2e/smoke.spec.js`、`fishing.spec.js` 等）。
- **基礎設施腳本測試**：`node --test tests/infra/*.test.js`（驗 docker-compose/kafka-init 契約）。
- **壓測**：JMeter 腳本已備（T-090），但報告明載尚未實測、不填虛構數據。

---

## 8. 技術亮點（面試可講的）

1. **帳務三保險**：`idempotency_key` UNIQUE 防重複請求、`@Version` 樂觀鎖防併發超扣、單一 Postgres 交易內原子完成（商城兌換＝debit＋寫 `shop_redemptions` 同交易）。
2. **CQRS 雙資料源**：wallet-service 手動建兩組 EntityManagerFactory（`DataSourceConfig`），事件驅動同步讀視圖並做冪等去重——不是掛名 CQRS，是真的處理了同步與迴圈風險。
3. **指令/事件分離（ADR-002）**：`wallet.credit.request` vs `wallet.credit` 的語意區分，並明文規範「事件消費者絕不可回呼 credit()/debit()」防無限迴圈。
4. **Provably Fair RNG**：SHA-256(serverSeed+clientSeed+nonce)，附獨立驗證端點，玩家可事後驗證。
5. **遊戲數學有理論根據**：老虎機 RTP 有封閉式公式寫進 Javadoc（RTP=Σpᵢ³Tᵢ+Σpᵢ²(1−pᵢ)Pᵢ ≈ 93.8%），測試斷言統計區間；捕魚機經濟模型（ADR-004）含殘血回收率設計「體感 RTP 地板」。
6. **風控**：per-game 全局 RTP 門檻（`risk.global-rtp-limit`），且文件記錄了「門檻低於結構性 RTP 導致百家樂被誤改判」的真實 bug 與修法——踩雷→修復→制度化的完整循環。
7. **前端 PixiJS 自寫引擎**：脫離 React 生命週期的 canvas 引擎、物件池、FPS 守門、`prefers-reduced-motion`，並用 code-split 控制 bundle。
8. **工程文化**：6 份 ADR、單一 CHANGELOG 含「為什麼＋如何驗證」、AGENTS.md 的 20 條「已知地雷」——知識沉澱的品質遠超一般 side project。

---

## 9. 工程取捨

| 決策 | 替代方案 | 為何選現方案 |
|---|---|---|
| CQRS 雙資料庫（ADR-001） | 單一 Postgres（此流量下綽綽有餘） | 學習價值＋讀寫關注點分離；代價是雙資料源設定複雜、讀庫最終一致 |
| Kafka 事件驅動 | 同步 REST 或單體內方法呼叫 | 練事件驅動、服務解耦；代價是除錯與契約管理成本（雷區 7 的 topic/測試同步問題） |
| 同步扣款走 REST `/internal/**` | 全事件化下注 | 下注需要即時知道「錢夠不夠」，同步是對的；用 internal secret 而非 mTLS 是務實簡化 |
| 前端 mock 鏡像後端引擎 | mock 只回假資料 | 讓純前端展示的體驗＝真實玩法，代價是「改後端必改 mock」的雙寫負擔（雷區 14） |
| 無服務發現/註冊中心 | Eureka/Nacos/k8s | 固定 7 個服務＋環境變數直連就夠，避免過度工程 |
| 面額/砲台鎖定 session 級（ADR-004） | 場中自由切換 | 消除「shots 與 top-up 併發覆寫 session」一類競態，用限制換一致性 |
| 樂觀鎖 | 悲觀鎖 `SELECT FOR UPDATE` | 模擬幣場景衝突率低，樂觀鎖吞吐較好；衝突時重試/失敗可接受 |

---

## 10. 已知限制（2026-07-13 修訂）

- **缺失功能**：無正式環境部署（無 k8s/雲端）。~~壓測腳本備而未跑~~ → **已跑，有實測 P99**（見上方更新框）。
- **可擴展性**：Redis 的 `FishingSession` 仍是「讀→改→整包 save」，靠前端 `topUpLockRef` 避免併發覆寫——
  多實例水平擴展下這是競態根源，Lua CAS 改造**尚未動工**（`plans/01` Phase 3）。**這是目前最實在的技術債**。
- **效能**（T-090 已量化）：game→wallet 每注一次同步 REST 呼叫。實測瓶頸＝**本機 Postgres 交易容量
  ≈ 550–600 筆/秒**（JFR 雙輪對照證實：放大 Hikari pool 只讓延遲從「等連線」搬到「等 DB 回應」，
  總量不變——排隊只會搬家不會消失）。目前的解法是 gateway 端**上游承壓封頂**（AIMD 自適應在途上限，
  超限 429 快速卸載），而非硬撐。1,000 併發下 429 佔比仍高，屬容量問題（D1 待拍板）。
- **安全**：~~`.env.example` 內建可用密鑰~~ → **已改為 `CHANGE_ME` 佔位符 + fail-fast**（Phase 7）。
  殘留：`X-Internal-Secret` 是共享靜態密鑰（無輪替自動化、無 mTLS）；
  **認證面仍有已知缺口**——refresh token 存 localStorage、無絕對逾時、無改密碼端點，
  設計已寫成 `docs/specs/SPEC-001-auth-token-session-hardening.md`，**待實作**。
- **技術債**：~~AUDIT_REPORT 手動快照~~ → **已自動化**（`tools/audit/`）。
  ~~mock 與後端雙寫~~ → **已收斂**（`contracts/*.json` + `ContractParityTest` 守門）。
  殘留：wallet `sub_type` 用字串＋CHECK 約束需「四同步」（DTO regex、兩份 init.sql、migration）。
- **推播無 DLT**：notification 是 best-effort，掉訊息不補償（有意識的取捨，但仍是限制）。

---

## 11. 如果我是面試官，會問的 10+ 題

1. 為什麼帳務用 PostgreSQL、查詢用 MySQL？CQRS 在這個流量下真的必要嗎？
2. `wallet.credit.request` 與 `wallet.credit` 為什麼要拆成兩個 topic？合併會發生什麼？
3. 冪等鍵＋樂觀鎖各防什麼問題？兩者能互相取代嗎？
4. 讀庫（MySQL 視圖）是最終一致的，玩家查交易紀錄查不到剛完成的一筆怎麼辦？
5. game 呼叫 wallet 扣款成功、但 game 自己隨後 crash，這筆錢怎麼處理？有沒有分散式交易/Saga？
6. Provably Fair 的 serverSeed 何時揭露？玩家怎麼驗證你沒有在看到 clientSeed 後挑選 seed？
7. 捕魚機的戰鬥狀態為什麼放 Redis 而不是 DB？session「讀→改→整包寫」在多實例下如何避免覆寫？
8. RTP 風控門檻為什麼是 per-game？當初單一門檻造成什麼事故？
9. Gateway 的 JWT 驗證與黑名單怎麼做？登出後 token 如何立即失效？
10. 測試全用 H2，H2 與 Postgres/MySQL 方言差異（如 CHECK 約束、鎖行為）造成的盲區怎麼補？
11. 壓測腳本寫了但沒跑——你預期第一個瓶頸會出現在哪？根據是什麼？
12. 前端 mock 鏡像後端規則的雙寫成本怎麼控制？有沒有辦法單一來源自動生成？
13. Kafka 消費者失敗時的重試/DLT 策略是什麼？為什麼 notification 選擇 best-effort？

---

## 12. 如果我是開發者，怎麼答（精簡版）

1. 帳務需要嚴格 ACID 與豐富的鎖語意，選 Postgres；報表/查詢負載型態不同，分到 MySQL 讀庫。坦承：此流量單庫足夠，選 CQRS 主要是刻意練習，ADR-001 有記錄取捨。
2. 指令＝「意圖」、事件＝「已發生的事實」。合併的話，消費事件的服務可能誤把「已入帳」再當成「請入帳」處理，wallet 內部曾因此有無限入帳迴圈的風險，故拆開並立規範。
3. 冪等鍵防「同一請求重送」（網路重試、Kafka at-least-once 重投），樂觀鎖防「不同請求併發改同一錢包」（超扣）。互相不可替代：前者是請求維度去重、後者是資料列維度併發控制。
4. 對一致性敏感的查詢（餘額）直接讀寫庫；交易列表走讀庫可容忍秒級延遲，且事件同步有冪等去重保證不漏不重，最終會收斂。
5. **（2026-07-13 更新答案）** 早期只靠冪等鍵兜底；現在有 **ADR-009 最小 Saga**：credit 失敗時在 catch 內落補償單 `pending_wallet_credits`（`REQUIRES_NEW`），排程 `WalletCompensationRetryJob` 每 30 秒**帶完全相同的冪等鍵**重試、指數退避、超限標 FAILED。關鍵是「冪等鍵絕不可換」——換了就會重複入帳，安全根基仍是 wallet 端的 `idempotency_key` UNIQUE。語意上要分清：settle 的 credit 失敗＝玩家贏了，補償是「重試同一筆入帳」（`sub_type=WIN`），**不是退款**；只有捕魚 buy-in/top-up 的退款再失敗才是 `REFUND`。對帳走 `tools/reconciliation/reconcile-game-wallet.mjs`。
6. 先給玩家 serverSeed 的 SHA-256 承諾（hash），玩家提交 clientSeed 後才用，事後揭露 seed 供 `/verify` 端點重算——承諾在前，無法挑 seed。
7. 捕魚是高頻（每秒多發）短生命週期狀態，Redis 延遲與 TTL 語意合適；併發覆寫目前用前端 top-up 鎖＋場中禁改面額迴避，多實例化時計畫改 Lua script 原子更新。
8. `win_amount` 是含本金口徑，各遊戲結構性 RTP 不同（百家樂 ≈0.99、老虎機 ≈0.94），單一門檻曾低於百家樂結構值，導致風控每局誤判、把結果強改「莊贏」——修成 per-game map 並要求門檻訂在結構性 RTP 之上。
9. Gateway 用共享 `JWT_SECRET` 驗簽，登出把 token 加入 Redis 黑名單（TTL＝剩餘有效期），Gateway 每請求查黑名單，做到即時失效。
10. **（已更新）** H2 盲區是事實，所以導入了 **Testcontainers（ADR-007）**：wallet-service 加 `@Tag("containers")` 測試，用 postgres:16 + mysql:8.4 套**真 schema**、`ddl-auto=validate`，專門抓「entity ↔ 真 schema 漂移」這個 H2 `create` 模式測不到的盲區。刻意**只新增、不取代**：日常 `mvn test` 的零外部依賴約定要保住，容器測試 surefire 預設排除、`-Pcontainers-test` 才跑。
11. **（已有實測，不再是預測）** 當初預測瓶頸在 wallet 同步扣款——**壓測證實了，但根因跟預期不同**。用 JFR 做兩輪對照（Hikari pool 15 vs 60）發現：pool=15 時 82% 延遲在等連線，放大到 60 之後同樣的時間轉移到等 DB 回應，**總延遲不變**。所以瓶頸不是連線池、也不是鎖衝突，而是**本機 Postgres 的交易容量本身（≈550–600 筆/秒）**——排隊只會搬家不會消失。過程中還修掉一個真 bug：Hikari 巢狀設定 key 寫錯導致 pool 實跑是預設 10 而非宣稱的 15。既然容量是硬上限，最終解法選「上游承壓封頂」：gateway 加 per-route 自適應在途上限（AIMD），超限直接 429 快速拒絕，而不是讓請求排隊 5 秒後才失敗。
12. **（已更新）** 已經做成單一來源：`contracts/*.json`（slot-paytable / baccarat-rules / fishing-species / fishing-combat）。前端 mock **直接 import 契約檔**；後端仍以 enum/常數為執行期權威（不 runtime 載 JSON），由 `ContractParityTest` 逐欄斷言 JSON＝後端——**漂移就 CI 紅燈**。這把原本「靠紀律」的雙寫債換成了「靠機制」。
13. wallet 有 DeadLetterListener/DLT；notification 刻意 best-effort，因為推播是 UX 增強、非交易資料，掉了重連即補，加 DLT 的複雜度不划算。

---

## 13. 程式碼品質評估

| 面向 | 評分 | 說明 |
|---|:---:|---|
| 專案結構 | 9/10 | Maven monorepo 模組邊界清楚、套件分層一致（controller/service/repository/kafka/dto）、DB/Kafka/infra 腳本各歸其位 |
| 可讀性 | 8.5/10 | 中文註解解釋「為什麼」（連 CI yml 都寫決策理由）、Javadoc 含數學推導；命名規範 |
| 可維護性 | 8/10 | ADR＋CHANGELOG＋AGENTS.md 地雷清單是最大資產；扣分在 mock 雙寫、`sub_type` 四同步這類「靠紀律不靠機制」的耦合 |
| 可擴展性 | 6.5/10 | 單機開發拓撲，無服務發現、session 競態靠前端鎖、無多實例考量——對專案定位可接受，但確是弱項 |
| 最佳實踐 | 8.5/10 | 冪等/樂觀鎖/Flyway/CI 四關擋門（infra+後端+前端 lint/unit/build+Playwright）/受保護分支＋PR review，測試 103 個類且涵蓋數值統計驗證 |

**總分：82/100**。以 junior 學習專案而言遠超水準；離產品級主要差在部署、可觀測性與水平擴展設計。

---

## 14. 改進建議（依影響力排序）

> **⚠️ 2026-07-13：本節 8 項中已完成 7 項**（逐項現況見文件開頭的更新框）。
> 唯一未動工的是第 3 項 Redis session 原子化。以下保留原文，作為「當時怎麼判斷優先序」的紀錄。

1. **導入 Testcontainers 取代部分 H2 測試**——帳務核心的 CHECK 約束、鎖行為、雙資料源交易語意只有真 Postgres/MySQL 能驗，這是目前測試最大的盲區。
2. **跑完 T-090 壓測並補觀測性**（Micrometer + Prometheus/Grafana）——腳本已備，跑出真實 P99 與瓶頸數據，是面試時「有沒有量化證據」的分水嶺。
3. **Redis session 原子化**（Lua script 或 WATCH/MULTI）——移除「靠前端鎖防併發覆寫」的設計，這是多實例化前必修的正確性問題。
4. **game→wallet 的失敗補償正式化**（最小 Saga：扣款成功但結算失敗時的自動退款＋對帳 job）——目前靠冪等兜底，缺主動補償。
5. **賠付表/玩法契約單一來源化**（共用 JSON schema 供後端與前端 mock 載入）——消除雷區 14 的雙寫債。
6. **一鍵全容器化 profile**（docker compose 加上七個服務的 build）——降低 demo 門檻，也為部署鋪路。
7. **secret 管理**——至少移除 `.env.example` 的可用密鑰、CI 用 GitHub Secrets，正式化輪替說明。
8. **AUDIT_REPORT 自動化**——用 script 從 git log/檔案存在性生成進度快照，解決「手動快照落後」這個已自知的問題。

---

## 15. 作為面試作品集的優劣勢

### 優勢

- **深度罕見**：junior 作品集常見 CRUD＋部署；這裡有冪等/樂觀鎖/CQRS/事件驅動/Provably Fair/遊戲數學/風控，每一項都能撐起 20 分鐘的深談。
- **工程文化完整**：ADR、CHANGELOG（含理由與驗證）、CI 四道擋關、分支保護、20 條地雷文件——展示的是「會在團隊裡工作的人」，不只是會寫 code。
- **有真實事故與修復敘事**：RTP 誤判改判事件、`@Bean` 重複導致服務起不來進而補 CI、捕魚 session 漏序列化導致大魚打不死——「踩雷→根因→制度化防再犯」是面試最有說服力的素材。
- **跨域廣度**：後端之外還有 PixiJS 遊戲引擎、Playwright E2E、JMeter，少見於後端求職作品。

### 劣勢

- ~~**無線上 demo、無壓測實數**~~ **（2026-07-13 已部分翻轉）**：壓測**已實跑**，
  1,000 併發有完整數據、根因鏈與調校前後對照，這項從劣勢變成了**最強的優勢**——
  「腳本寫了沒跑」的追問現在有正面答案。**殘留劣勢仍是無線上 demo / 未部署雲端。**
- **架構超編制**，需要能自圓其說：對模擬幣遊戲上 7 微服務＋雙 DB＋Kafka 是明顯 over-engineering，必須主動說明「這是刻意的學習設計」並展示 ADR 中的取捨意識，否則會被判定為缺乏規模感。
- **AI 協作痕跡明顯**（AGENTS.md、.claude/agents、gem-prompt 技能）：本身不是缺點，但面試官會針對任意深處細節抽問驗證真實理解——第 11、12 節就是必須能脫稿回答的清單。
- **水平擴展與可觀測性空白**：被問「這系統怎麼撐十倍流量」「線上怎麼定位慢查詢」時目前沒有現成答案，建議照第 14 節第 2、3 項先補。
