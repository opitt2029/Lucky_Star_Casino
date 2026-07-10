# 組員A（組長）— 五天衝刺清單：專案報告 × 面試準備

> **這份給誰**：A組（核心帳務：gateway + member + wallet）＋ E專項（API / Docker / Kafka / Redis 跨服務總覽）＋ T-090 壓測戰役主講人，也就是**組長本人**。
> **怎麼用**：報告前照 Day 1→5 逐天完成、逐項打勾；面試前拿同一份複習，最後翻「履歷防禦表」與「數據速記卡」。
> **素材來源**（全部是專案真實文件，本檔只做整合與排程，不重抄內容）：
> - `docs/report/portfolio-四人分工詳細指南.md`（A組 + E專項段落）
> - `docs/interview-prep/00`~`13`（面試準備包全套）
> - `docs/performance/T-090-load-test-report.md`（壓測原始數據）
> - **每日檢核項的完整逐字答案**：`docs/report/portfolio-組員A-面試詳答與Docker實作.md`（含 Docker 七服務實作教學章）

---

## 0. 你的三句履歷 ↔ 專案證據對照（先看這張，知道自己在賣什麼）

| 履歷句 | 對應素材 | 主讀章節 |
|---|---|---|
| 組長帶團隊開發微服務賭場帳務系統（Java 21 + Spring Boot + Kafka + Redis + CQRS），負責 Gateway 模組與架構決策 | 架構全貌、CQRS、指令/事件分離、Gateway filter 鏈 | `00` §1-3、`01`、`02` 決策 1/2/3/4、`10` |
| 高併發壓測除錯：TimeLimiter 根因、150 併發 5xx 78%→0、帳務零違規 | T-090 完整戰役 | `13` 全文、`docs/performance/T-090-load-test-report.md` |
| 7 個微服務 Docker 容器化、healthcheck 依賴鏈一鍵部署 | E2 Docker 部署架構 | 分工指南 E2、`DEPLOY.md` |

三句話對應三個「主戰場」，五天計畫就是圍繞它們排的：**Day 1 全貌與部署、Day 2 帳務、Day 3 Gateway、Day 4 壓測、Day 5 流程與整合演練**。

---

## Day 1 — 全貌、電梯稿、Docker 部署（你是唯一看得到全局的人）

**目標**：閉眼能畫出 7 服務架構圖與 Docker 依賴鏈；30 秒/2 分鐘自我介紹脫稿。

### 必讀（約 2 小時）
- [ ] `docs/interview-prep/00-index.md` §1~§3（30 秒電梯版、兩分鐘技術版、白板深問版）——**§1 直接背起來**
- [ ] `docs/interview-prep/01-專案程式碼地圖.md` 全文（重點：§1 多模組 pom、§2 七服務職責、§3 端到端請求流）
- [ ] 分工指南 **E1（API 串接架構）**：Gateway 路由表、filter 執行順序（-200 → -100 → -50）、服務間內部呼叫（`INTERNAL_SECRET`）
- [ ] 分工指南 **E2（Docker 部署架構）**：容器清單、啟動依賴鏈、`.env` 必填變數、KRaft 模式 Kafka、kafka-init one-shot 容器

### 要能講出來（自我檢核）
- [ ] 30 秒版自我介紹講一遍不看稿（`00` §1）
- [ ] 白板畫出：前端 → Gateway(限流→JWT→玩家限流) → game → wallet(同步 REST) → Kafka → rank/notification
- [ ] Docker 依賴鏈背出來：infra(healthy) → kafka → kafka-init(completed) → member → wallet/rank → game → admin → notification → **gateway 最後**（因為它要轉發流量給全部）
- [ ] 答出「為什麼 gateway 容器最後啟動？」「kafka-init 為什麼是 one-shot？」「`JWT_SECRET` 缺了會怎樣（fail-fast，`02` 決策 8）？」

### 今日題庫
- [ ] `05` 脈絡 A（語言與工具基礎 1–25）＋ 脈絡 B（Spring Boot 與微服務骨架 26–50），對 `06` 答案

---

## Day 2 — 帳務主戰場（wallet：冪等 + 樂觀鎖 + CQRS）

**目標**：把「怎麼防超扣/重複扣款」講到滾瓜爛熟——這是整個專案面試含金量最高的一題。

### 必讀（約 2.5 小時）
- [ ] `docs/interview-prep/02-設計決策與為什麼.md` **決策 1**（冪等+樂觀鎖 ★最重要）、**決策 2**（CQRS 雙資料源）、**決策 3**（指令 vs 事件）＋附錄二的「追問鏈速練」對應段
- [ ] `docs/interview-prep/11-下注請求流與程式碼地圖.md` 全文（白板題範本＋ §5 失敗模式表）
- [ ] `docs/adr/ADR-001.md`、`docs/adr/ADR-002.md`（決策原文，確認自己講的跟文件一致）
- [ ] AGENTS.md 雷區 5（雙資料源）、6（事件/指令）、8（帳務鐵則）、18（子型四同步）

### 要能講出來
- [ ] `debit()` 四步流程默寫：①冪等檢查 → ②餘額守衛（balance − frozenAmount）→ ③`@Version` 樂觀鎖存檔 → ④DB UNIQUE 兜底
- [ ] 答出「為什麼光查一次冪等鍵不夠？」→ check-then-act（TOCTOU）競態，真正防線是 DB UNIQUE
- [ ] 答出「為什麼樂觀鎖不用悲觀鎖？」→ 衝突率低場景樂觀鎖吞吐高；熱點帳戶高爭用才選悲觀鎖（視衝突率選鎖）
- [ ] 答出「為什麼 wallet 絕不消費 `wallet.credit`？」→ 自己發自己收 → 無限迴圈入帳；唯一例外 `WalletReadSyncListener` 只寫讀視圖
- [ ] 答出「讀庫延遲怎麼辦？」→ 查餘額直打 PostgreSQL（強一致），歷史列表才走 MySQL
- [ ] 白板走一遍 `11` §2 的下注請求流，含「debit 成功 credit 失敗怎麼辦」→ 接 ADR-009 補償單（同冪等鍵重試，Day 4 深化）

### 今日題庫
- [ ] `05` 脈絡 D（帳務核心 76–105 ★主戰場）＋ 脈絡 E（CQRS 106–135），對 `06`

---

## Day 3 — Gateway 模組（你的掛名負責項）＋ Redis 全景

**目標**：JWT 鑑權鏈、路由順序、限流層次、Redis key 全景——被問「你負責什麼」時的主答內容。

### 必讀（約 2.5 小時）
- [ ] `docs/interview-prep/10-API串接與架構.md` 全文（§2 前端 axios/single-flight 續期、§3 路由與 filter、§4 JWT 與信任邊界、§5 Kafka、§7 速查表）
- [ ] `docs/interview-prep/02-設計決策與為什麼.md` **決策 4**（JWT + Gateway 集中鑑權）、**決策 7**（Redis 多用途）、**決策 8**（fail-fast 啟動）
- [ ] 分工指南 **E4（Redis 架構）**：key prefix 全表 + 三方對齊要求 + **fail-open vs fail-closed 的取捨**（限流 fail-open、JWT 黑名單 fail-closed、捕魚 session 無 fallback）
- [ ] AGENTS.md 雷區 19（`member-checkin` 路由要排在 catch-all 之前）、21（admin JWT 兩套 secret、`/admin/` 白名單）
- [ ] 掃過真實檔案（面試被問「程式在哪」要能指路）：`JwtAuthenticationGlobalFilter.java`、`FilterOrder.java`、`PlayerRateLimitGlobalFilter.java`、gateway `application.yml`

### 要能講出來
- [ ] filter 順序及**為什麼**：IP 限流(-200) 最先（省後面驗證成本）→ JWT(-100)（產出 X-User-Id）→ 玩家限流(-50)（依賴上一步的 X-User-Id 當 key）
- [ ] JWT 三層 Redis 撤銷：`jwt:blacklist:{jti}` / `disabled:player:{sub}` / `token:min-iat:{sub}`；Redis 掛 → **fail-closed**
- [ ] 答出「怎麼防前端偽造 X-User-Id？」→ 白名單路徑先剝除、驗證後先 remove 再 set
- [ ] 答出「服務間為什麼用 INTERNAL_SECRET 不用 JWT？」→ JWT 代表玩家、內部呼叫代表可信服務；`/internal` 不經 gateway
- [ ] 路由順序陷阱故事（雷區 19）：簽到端點被 wallet catch-all 吃掉 → 404 → 具體路徑排前面
- [ ] 限流 fail-open vs JWT fail-closed 為什麼相反 → 限流壞了多扛流量而已；驗證壞了放行是安全漏洞
- [ ] 前端 401 靜默續期 single-flight（`10` §2.4）——E專項加分題

### 今日題庫
- [ ] `05` 脈絡 C（認證與 Gateway 51–75）＋ 脈絡 F（Kafka 136–160），對 `06`

---

## Day 4 — T-090 壓測戰役（履歷第二句的主戰場，含金量最高）

**目標**：整場戰役四幕劇講到反射級：誤判根因 → 瓶頸換位 → JFR 天花板 → AIMD 卸載。**這天不能壓縮**。

### 必讀（約 3 小時）
- [ ] `docs/interview-prep/13-壓測與效能調校.md` **全文背熟**（§0 的 30 秒版逐字背）
- [ ] `docs/performance/T-090-load-test-report.md`（原始數據，確保你講的每個數字都有出處）
- [ ] `docs/interview-prep/02` **決策 9**（ADR-009 最小 Saga 補償——「credit 失敗怎麼辦」的完整答案）
- [ ] 分工指南 **E3（Kafka 架構）**：topic 全表、DLT 清單、best-effort 的取捨（收尾 Kafka 知識）

### 要能講出來（每一條都是面試題）
- [ ] 根因鏈默畫：未設 TimeLimiter → 預設 1s 逾時 → 正常慢呼叫（0.9~3.6s）被腰斬判 failed → 灌爆 CB 統計 → 熔斷開路 503 → half-open 放行 → 關路瞬間 **thundering herd** → 反覆開闔（flapping）
- [ ] 關鍵矛盾點：設定寫了 `slow-call-duration-threshold: 3s`，但預設 TimeLimiter 1 秒就砍——慢呼叫活不到被統計
- [ ] 證據鏈：修正後 Prometheus `circuitbreaker_calls{kind="failed"}` 全服務歸零 →「誤判的失敗」和「設計內的卸載」分清楚
- [ ] 數字精確版：150 併發 **5xx 13,563（78.0%）→ 0**；**總失敗樣本 13,563 → 4（0.05%）**；1,000 併發 5xx −72%
- [ ] 瓶頸換位故事：修 game → 擠到 wallet debit（96→547ms）；C1 只護遊戲路徑 → 429 毫秒級回覆讓執行緒循環變快、反而打爆沒設防的 wallet 路徑
- [ ] B1 排除法：Hikari pool key 寫錯（真 bug 但非主因，A/B 證明）→ pgstattuple 排除膨脹 → **JFR 定位單機 Postgres 交易容量 ≈550–600 筆/秒**
- [ ] 金句背熟：「連線池大小只決定隊伍排在應用內還是資料庫內，總延遲不變」
- [ ] C3 選型：在途上限 vs 令牌桶（Little's Law：併發控制天然感知後端延遲，令牌桶感知不到）；上限值 AIMD 動態調（同 TCP 壅塞控制）
- [ ] 底線句：「效能 gate FAIL 過很多輪，帳務 gate 一輪都沒 FAIL 過——系統過載時選擇拒絕服務，而不是算錯錢」
- [ ] `13` §7 追問鏈全部走一遍（P99 不達標算成功嗎 / 為何不 mock DB / thundering herd 是什麼 / 429 傷體驗嗎 / 要真過 1,000 併發怎麼做 / JFR 差在哪 / C3 上線後有重跑驗證嗎——含歸因誠實聲明）

### 今日題庫
- [ ] `05` 脈絡 H（系統設計與營運 181–200）＋ `07` 脈絡 O（系統設計 345–372）挑限流/壓測相關題，對 `08`

---

## Day 5 — 開發流程、行為題、Demo 總演練

**目標**：把「你們團隊怎麼做事」講成一條生命週期；報告 demo 全流程跑一次；查漏補缺。

### 必讀（約 2 小時）
- [ ] `docs/interview-prep/09-開發流程與工程實踐.md` 全文（§0 30 秒版背起來；§4 兩個行為題故事）
- [ ] `docs/interview-prep/12-OOP四大支柱深講.md` 掃過（封裝/繼承/多型/抽象各記一個專案實例）
- [ ] `03`、`04` 用「查漏」方式掃標題：哪個標題講不出兩句話就展開讀（樂觀鎖 vs 悲觀鎖、隔離級別、@Transactional 失效、Kafka acks/冪等消費 為必修）

### Demo 演練（報告日腳本，跑一次全流程）
- [ ] `docker compose up -d` 一鍵起環境 → 秀依賴鏈啟動順序（履歷第三句的現場證明）
- [ ] 登入 → 查餘額 → 下注扣款（講冪等+樂觀鎖）→ Gateway 429 限流演示
- [ ] 引用壓測數據收尾：TimeLimiter 修正 5xx 78%→0、C1+C2 成功 +126%、401 −63%、帳務 0 違規
- [ ] E專項投影片素材確認：E1 路由表、E2 容器依賴鏈、E3 topic 表、E4 Redis key 表（分工指南裡都是現成表格，可直接貼）

### 總複習
- [ ] `00` §4「面試官問 X → 翻到哪」對照表走一遍，每格能先給一句話結論
- [ ] `00` §5 + `13` §8 數據速記卡合併背誦（見下方「數據速記卡」）
- [ ] 行為題兩個故事口述：幸運值保底主動移除（正確性 > 玩家爽）、大魚打不死（序列化漏欄位 + mock 掉 store 的教訓）
- [ ] 兩套題庫錯題重做（`05`/`07` 做錯的題目）

---

## 履歷防禦表（每句履歷 → 面試官會追什麼 → 你怎麼答 → 證據在哪）

### 句 1：組長 / 微服務帳務系統 / 負責 Gateway 與架構決策

| 可能追問 | 答題方向 | 證據 |
|---|---|---|
| 「架構決策舉一個例？」 | 講 CQRS（ADR-001）或指令/事件分離（ADR-002），用 `02` 的「是什麼→為什麼→取捨」模板 | `docs/adr/`、`02` |
| 「為什麼用 Java 不用 Go？」 | ADR-000：正確性優先、Spring 對樂觀鎖/多資料源/Kafka 整合最成熟；I/O 密集閘道 Go 確實更合適——懂取捨 | `02` 附錄 |
| 「Gateway 具體做了什麼？」 | filter 鏈三層 + JWT 三層撤銷 + fail-closed + 路由順序陷阱故事 | Day 3 全部 |
| 「組長做了什麼管理工作？」 | 用 `09`：任務分配表 T-0xx、AGENTS.md 地雷清單制度、PR + 1 review + CI 綠、CHANGELOG「為什麼/如何驗證」紀律、ADR 制度 | `09`、`CONTRIBUTING.md` |

### 句 2：壓測除錯（TimeLimiter / 78%→0 / 帳務零違規）

| 可能追問 | 答題方向 | 證據 |
|---|---|---|
| 「怎麼定位到的？」 | Prometheus 證據鏈：failed-calls 修正前 game≈1,172/wallet≈424 → 修正後全服務歸零；不是猜的 | `13` §2、T-090 報告 |
| 「thundering herd 是什麼？」 | half-open 放行成功 → 關路瞬間堆積流量一起灌入 → 再推爆 → 再開路；我們的 flapping 是 1 秒誤判餵出來的，解法是消滅誤判來源而非調熔斷參數 | `13` §7 |
| 「修完就達標了嗎？」 | 誠實答：150 併發 5xx 歸零，但 1,000 併發 P99 仍不達標——接著講瓶頸換位 → JFR → DB 容量 550–600/s → AIMD 卸載，一路講到底 | `13` §3~§5 |
| 「帳務零違規怎麼驗的？」 | 效能 gate 和帳務 gate 分開判；每輪跑 T-091 九項 SQL 對帳（餘額 vs 流水鏈、frozen_amount、冪等鍵重複）；overdraw 0、冪等失敗 0 | `13` §1、§6 |

### 句 3：Docker 容器化 / healthcheck 依賴鏈

| 可能追問 | 答題方向 | 證據 |
|---|---|---|
| 「依賴鏈怎麼設計的？」 | `depends_on` + `condition: service_healthy`；kafka-init 是 one-shot 容器（`service_completed_successfully`）；gateway 最後起 | E2 |
| 「資料會不會丟？」 | 4 個具名 volume；Kafka `CLUSTER_ID` 固定寫死在 `.env`（否則重建 volume 後 cluster id 不一致起不來） | E2 |
| 「環境變數怎麼管？」 | `.env` 單一來源注入容器；`JWT_SECRET`/`INTERNAL_SECRET` 無預設值、缺了啟動失敗——fail-fast（`02` 決策 8） | E2、`DEPLOY.md` |

---

## ⚠️ 履歷修改建議（數字要跟報告對得上，面試官可能拿著追問）

原文第二句：

> 高併發壓測除錯：定位Resilience4j熔斷器逾時參數配置錯位（thundering herd根因），150併發下HTTP 5xx由78%修復至0%（13,563→4次失敗），全程帳務零違規（冪等鍵+樂觀鎖零超扣）。

兩個精確度問題：

1. **「13,563→4次失敗」混用了兩個指標**。報告原始數據：HTTP **5xx** 是 13,563（78.0%）→ **0**；**總失敗樣本**是 13,563 → **4**（0.05%，疑似瞬斷、非 5xx）。現在的寫法會讓「5xx 修復至 0%」和「→4 次」自相矛盾，被細問就尷尬。
2. **「thundering herd 根因」因果倒了**。thundering herd 是熔斷 flapping 過程中的**症狀**；根因是「CircuitBreaker 未顯式設定 TimeLimiter → 預設 1 秒逾時，低於 3 秒慢呼叫門檻，把正常慢呼叫誤判為失敗」。面試官若懂 Resilience4j 會抓這個。

**建議改寫**：

> 高併發壓測除錯：以 Prometheus 證據鏈定位 Resilience4j CircuitBreaker 未設 TimeLimiter（預設 1s 逾時誤判慢呼叫）引發熔斷 flapping 與 thundering herd；修復後 150 併發 HTTP 5xx 由 78%（13,563 次）歸零、總失敗降至 4 次（0.05%），全程帳務零違規（冪等鍵＋樂觀鎖，超扣 0、重複扣款 0）。

**可選加碼**（若版面允許，這兩條含金量高）：

> - 以 JFR 剖析定位單機 PostgreSQL 帳務交易容量天花板（≈550–600 筆/秒），據此在 Gateway 實作 AIMD 自適應在途上限（Little's Law）卸載超額流量，1,000 併發成功率 +430%、401 歸零。
> - 團隊人數請再確認：履歷寫「5人團隊」、報告分工指南是四組分工——若實際 5 人沒問題，但要能講出每個人負責什麼（A~D 組 + 你自己的 E 專項）。

（「+430%/401 歸零」出自 C3+B1 對照重跑 commit `48a98c5`；報告時若被問細節，出處是 `docs/performance/T-090-C3-*.md`。）

---

## 數據速記卡（面試前 10 分鐘看這張）

**技術棧**：Java 21、Spring Boot 3.3.5、Spring Cloud 2023.0.3、JJWT 0.12.6；React 18 + Vite 5 + Redux Toolkit + PixiJS 8 + STOMP

**Port**：gateway 8080 / member 8081 / wallet 8082 / game 8083 / rank 8084 / admin 8086 / notification 8087；MySQL 3307 / PostgreSQL 5433 / Redis 6379 / Kafka 9092

**DB 角色**：PostgreSQL = 寫（帳務、樂觀鎖）、MySQL = 讀（查詢）；wallet/admin 雙資料源手動配置

**Gateway filter**：RATE_LIMIT(-200) → JWT(-100) → PLAYER_RATE_LIMIT(-50)；限流 fail-open、JWT 撤銷 fail-closed

**限流 burst**：auth/IP 10、一般玩家 20/s、遊戲路徑 10/s（`rate:game:{userId}`）

**Kafka**：8 業務 topic + 5 DLT；`wallet.credit.request`=指令、`wallet.credit`=事件；`game.result`/`rank.update`/`notification.push` 無 DLT（best-effort）

**T-090**：
- 根因：未設 TimeLimiter → 預設 1s < slow-call 門檻 3s → 誤判 → flapping；修正 = `timeout-duration: 6s`
- 150 併發：5xx 13,563（78.0%）→ **0**；失敗樣本 → 4（0.05%）
- 1,000 併發：5xx −72%；CB failed-calls（Prometheus）全服務歸零
- C1+C2：成功 +126%、401 −63%、成功 spin 平均 5.21s→2.65s、debit 1,070→581ms
- C3+B1 重跑：150 併發 P99 −48%、1,000 併發成功 +430%、401 歸零、wallet 路徑 0 失敗
- C3+B1 歸因（要誠實講）：debit 延遲改善主要歸 B1（pool 修正）；C3 貢獻＝wallet 路徑首次納管、401/連線層失敗根治。殘餘課題：429 佔比 65.3%（>40% 誠實 FAIL）、game CB 503 待協調 AIMD 與 CB 閾值
- 容量：單機全鏈路 ≈180 req/s；單機 Postgres debit ≈**550–600 筆/秒**（JFR）
- 帳務不變量：**全輪次 overdraw 0、冪等失敗 0、T-091 對帳 0 違規**

**帳務四層防線**：冪等鍵快路徑 → 餘額守衛（balance−frozen）→ `@Version` 樂觀鎖 → DB UNIQUE 兜底

**冪等鍵命名**：`slot-bet-<roundId>` / `slot-win-<roundId>` / `fishing-buyin-<sessionId>`（確定性 → 重試安全）

**金句三發**：
1. 「連線池大小只決定隊伍排在應用內還是資料庫內，總延遲不變。」
2. 「效能 gate FAIL 過很多輪，帳務 gate 一輪都沒 FAIL 過——過載時拒絕服務，而不是算錯錢。」
3. 「分清楚『誤判的失敗』和『設計內的卸載』，調校才不會打錯靶。」

---

## 附：時間不夠的最小保命集（只剩一天時）

1. `00` §1 電梯稿 + §5 數據卡（30 分鐘）
2. `02` 決策 1（冪等+樂觀鎖）+ 決策 4（JWT+Gateway）（1 小時）
3. `13` §0 30 秒版 + §2 根因鏈 + §8 數字表（1 小時）
4. `11` §2 白板請求流畫三遍（30 分鐘）
5. 本檔「履歷防禦表」全表過一遍（30 分鐘）
