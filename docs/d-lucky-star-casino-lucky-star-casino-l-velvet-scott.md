# Lucky Star Casino — 八項架構改進分階段施工計畫

## Context

`docs/report` 總體檢報告列出 8 項改進建議（依影響力排序）。目標：把它們化為可施工的分階段計畫——每個 Phase 一個獨立 PR（`feature/名字-描述` → develop），各自可驗證；行為變更都要記根目錄 `CHANGELOG.md`（含為什麼＋如何驗證）；架構級決策開新 ADR（現有至 ADR-006，以下從 ADR-007 起編）。使用者要求：**8 項全包、含 T-090 壓測完整實跑**。

盤點確認的現況（施工前提）：
- 全 repo **零 Testcontainers**、**零 Dockerfile**、**零 micrometer-registry-prometheus**（7 服務都有 actuator）。
- game→wallet 走同步 HTTP（`WalletClient` → `/internal/wallet/debit|credit`）；slot/baccarat「debit 成功→credit 派彩失敗」**無補償**；fishing 僅 buy-in/top-up 的 save 失敗有 REFUND，settle 的 credit 失敗無補償。
- `FishingSessionStore` 是「find→改→整包 save」，零 Lua/WATCH，靠前端 `topUpLockRef` 串行化。
- T-090 已於 2026-06-16 實跑一次：1000 併發 P99≈2.47s、80% 503（gateway R4j load-shed）、帳務 gate PASS；瓶頸判定為單機資源。腳本齊全（jmx/provision-players.mjs/run-slot-load-test.ps1/analyze-jtl.mjs/對帳 SQL）。
- `.env.example` 含可用密鑰；`ci.yml:53-56` 明碼寫死測試密鑰。
- `mockApi.js`（1282 行）硬編碼鏡像後端所有玩法數值；無共用契約檔。
- AUDIT_REPORT.md 附錄 A（行 339 起）＝逐 T-0xx 表格；tools/ 慣例＝Node ESM `.mjs`。

## 相依關係

```
P2a 觀測性 ──必先於──> P2b 壓測實跑
P1 / P3 / P4 / P5 / P7 / P8 互相獨立
P3 → P4 → P5 建議串行（都動 game-service，避免衝突）；P6 最後
```

---

## Phase 1 — Testcontainers 補真 DB 測試（#1）｜M

**只新增、不取代 H2**（雷區 3 的 CI 零依賴要保住）：Testcontainers 測試用 JUnit `@Tag("containers")`，surefire 預設 `excludedGroups=containers`，`-Pcontainers-test` 才跑。**只加在 wallet-service**（唯一雙資料源＋帳務核心，H2 假象風險最高）。容器套真 `database/{postgres,mysql}/init.sql`＋migration，JPA `ddl-auto=validate`——這正是 H2 `create` 模式永遠測不到的「entity ↔ 真 schema 漂移」。

改動：
- 根 `pom.xml`：dependencyManagement 加 `org.testcontainers:testcontainers-bom:1.20.x`
- `backend/wallet-service/pom.xml`：test 依賴 `testcontainers-junit-jupiter`/`postgresql`/`mysql`；surefire excludedGroups＋profile `containers-test`
- 新測試 `backend/wallet-service/src/test/java/com/luckystar/wallet/containers/`：
  - `AbstractDualDatasourceContainerTest`（postgres:16 + mysql:8.4，版本對齊 compose；`@DynamicPropertySource` 覆寫 `DataSourceConfig` 讀的 `jpa.ddl-auto=validate` 與真 dialect）
  - `WalletCheckConstraintContainerTest`（非法 sub_type 撞 `chk_wt_sub_type`，PG/MySQL 各一）
  - `WalletOptimisticLockContainerTest`（併發 debit → 一方 OptimisticLockingFailure、不超扣）
  - `DualDatasourceTxSemanticsContainerTest`（兩 TransactionManager 各自 rollback 互不影響）
- `ci.yml` backend-test 加 step：`mvn -pl backend/wallet-service test -Pcontainers-test`（ubuntu-latest 內建 Docker）
- `docs/adr/ADR-007.md`、AGENTS.md 雷區 3 補例外說明、CHANGELOG

驗證：`mvn -pl backend/wallet-service test`（不受影響）；`mvn -pl backend/wallet-service test -Pcontainers-test`（需 Docker Desktop）。

## Phase 2a — 觀測性 Micrometer + Prometheus/Grafana（#2 前半）｜M

- 根 pom + 7 個服務 pom 加 `micrometer-registry-prometheus`（runtime）；7 個 `application.yml` exposure 加 `prometheus`。Boot 3.3.5 自動設定、零程式碼。
- `docker-compose.yml` **同檔加 `profiles: ["observability"]`** 的 `prometheus`(9090)/`grafana`(3000)——預設 `docker compose up` 行為不變，不破壞 DEPLOY.md SOP 與 `tests/infra` 斷言（若有服務數斷言要同步改，雷區 7 精神）。
- 新 `observability/prometheus.yml`（scrape `host.docker.internal:8080..8087`——現行拓撲後端跑宿主機）＋ `observability/grafana/provisioning/`（datasource＋基本 dashboard：HTTP P99 by service、JVM heap、Resilience4j 拒絕率——gateway 是上次 80% 503 元兇，務必確認 `resilience4j_*` 有曝露）。
- DEPLOY.md 補「起觀測性」、CHANGELOG。

驗證：`docker compose --profile observability up -d`；`curl localhost:8082/actuator/prometheus` 有 `jvm_memory_used_bytes`；`localhost:9090/targets` 全綠；七模組 `mvn test` + `node --test tests/infra/*.test.js`。

## Phase 2b — T-090 壓測完整實跑（#2 後半）｜L（傍晚獨占機器）

前置：2a 已合併。拓撲維持與 6/16 相同（後端宿主機跑，**不用** P6 容器拓撲，數據才可比）。步驟：
1. `.env` 確認 `JWT_SECRET`/`INTERNAL_SECRET`/`CORS_ALLOWED_ORIGINS`（雷區 2），補 `KAFKA_CLUSTER_ID`（`docker run --rm confluentinc/cp-kafka:7.6.1 kafka-storage random-uuid`）。
2. `docker compose --profile observability up -d`，等 healthy、kafka-init 完成。
3. 補建 admin_* 缺表（既有資料卷缺表——只補缺、勿覆蓋既有資料）。
4. 起 7 後端（`start-backend.ps1` 或逐服務 `mvn spring-boot:run`；注意 .env CRLF 雷——見記憶），逐一 `/actuator/health` UP、Prometheus targets 全綠。
5. 確認 JMeter 5.6.3。
6. `node tests/performance/provision-players.mjs` 產 1000 玩家（GM 發幣＋429 退避）；抽查 players.csv 行數與任一 JWT 可查餘額。
7. 基線 150 併發：`.\tests\performance\run-slot-load-test.ps1 -Threads 150`。
8. 主測 1000 併發，期間 Grafana 盯 gateway R4j 拒絕數/各服務 P99/GC/宿主 CPU（用指標佐證「單機資源 vs gateway 限流」）。
9. `node tests/performance/analyze-jtl.mjs <本次 results 目錄>`。
10. 帳務 gate：`.\tests\performance\run-accounting-reconciliation.ps1`（overdraw=0）。
11. 更新 `docs/performance/T-090-load-test-report.md`（只填實測值＋Grafana 截圖＋瓶頸判讀）、CHANGELOG。若要調 gateway R4j 上限→**另開 PR**。

## Phase 3 — Redis session 原子化（#3）｜M

**選 Lua CAS（版本比對後整包寫入），不選 WATCH/MULTI、不重構資料模型**。為什麼：戰鬥運算在 Java（`FishingCombat`）搬不進 Lua，原子化粒度是「儲存」；拆欄位模型會踩雷區 16 整片地雷；WATCH/MULTI 在 Lettuce 連線池要綁連線、寫法脆弱。

- `FishingSession` 加 `long version`（**同步 `toHash()/fromHash()`——雷區 16**）。
- 新 `backend/game-service/src/main/resources/scripts/fishing-session-cas.lua`：`HGET version == expected` → HSET 全欄位＋PEXPIRE＋version+1，否則 return 0。
- `FishingSessionStore.save()` 改 CAS；`FishingService` 的 shots/top-up 在 CAS 失敗時「重讀→重放→重存」重試（上限 3）。
- **前端 `topUpLockRef` 保留**（雷區 16 明文勿移除），降級為 UX 最佳化；更新 AGENTS.md 該段。
- `FishingSessionStoreTest` 加併發 lost-update 測試（此類是雷區 16 指定守門員）。
- `docs/adr/ADR-008.md`、CHANGELOG。

驗證：`mvn -pl backend/game-service test`；手動雙分頁連打＋top-up，餘額不蒸發。

## Phase 4 — game→wallet 最小 Saga 補償（#4）｜L

**語意先分清**：settle 的 credit 失敗＝玩家贏了→補償是**重試同一冪等鍵的 credit**（不是退款）；fishing buy-in/top-up 的 save 失敗→REFUND。統一抽象為「pending outbound wallet credit」，安全根基＝wallet 端 `idempotency_key` UNIQUE（雷區 8）。

- game-service Postgres 新表 `pending_wallet_credits`（id、game_type、round/session_id、player_id、amount、sub_type WIN/REFUND——**皆已在 CreditRequest @Pattern 白名單，不觸發雷區 18 四同步**、idempotency_key UNIQUE、status PENDING/DONE/FAILED、retry_count、last_error、時間戳）＋migration。
- 新 `compensation/` 套件：`PendingWalletCredit`、Repository、`WalletCompensationService.recordPending()`（credit 失敗 catch 內以 `REQUIRES_NEW` 寫入，主流程 rollback 也留單）、`WalletCompensationRetryJob`（`@Scheduled` 每 30s 撈 PENDING、指數退避、超限標 FAILED＋log.error）。放 game-service 內因為：補償單在 game 的 DB、重用 `WalletClient` 的 internal-secret 設定。
- 接入三處失敗路徑：`SlotService.settleInternal`(:150-199)、`BaccaratService` 結算、`FishingService`(:167/:425/:656 退款失敗只 log 的路徑)。
- **雷區 6：補償只走 HTTP WalletClient，絕不新增消費 wallet.credit/debit 事件回呼 credit/debit 的 listener。**
- 對帳 job 用 script：`tools/reconciliation/reconcile-game-wallet.mjs`（Node ESM 比照 tools/ 慣例；跨 game/wallet 兩 DB，放任一服務內都破壞服務邊界；重用 `tests/performance/accounting-reconciliation.sql` 思路）。
- 測試 `WalletCompensationServiceTest`（失敗→寫單；job 重試→DONE；冪等鍵不變）；`docs/adr/ADR-009.md`、AGENTS.md 補一條、CHANGELOG。

驗證：`mvn -pl backend/game-service test`；手動 kill wallet → 打一局 slot → 重啟 wallet → 30s 內補償入帳、冪等鍵一致。

## Phase 5 — 玩法契約單一來源化（#5）｜M

- 契約 JSON 放 repo 根 `contracts/`：`slot-paytable.json`、`baccarat-rules.json`（補牌表/TIE_PAYOUT/傭金）、`fishing-species.json`、`fishing-combat.json`、`shop-catalog.json`（mock 用；正式目錄在 MySQL——雷區 20）。
- **後端保留 enum 為執行期權威，JSON 做「相等性守門測試」**：新 `ContractParityTest`（game-service test，Jackson 讀 `../../contracts/*.json` 逐欄斷言＝`SlotSymbol`/`FishSpecies`/`FishingCombat`/`bankerDraws` 表）。為什麼不 runtime 載 JSON：enum 承載 Javadoc 理論 RTP 與雷區 15/16 的整套測試守門，推倒重來收益低；「漂移＝CI 紅燈」已達標。
- 前端 `mockApi.js` 的 `SLOT_PAYTABLE`(:8-14)/`FISH_SPECIES`(:32-44)/fishing 常數(:20-31)/`bankerDrawsMock`(:366-368)/`SHOP_CATALOG`(:131-135) 改為 import JSON（Vite 原生支援；必要時 `vite.config.js` 加 `server.fs.allow` 或 alias `@contracts`）。補牌**邏輯**仍是程式碼，JSON 只存表格數值。
- 更新 AGENTS.md 雷區 14/15/16 的同步敘述、CHANGELOG。

驗證：`mvn -pl backend/game-service test`；`cd frontend && npm run build`；mock 模式手打三遊戲。

## Phase 6 — 一鍵全容器化（#6）｜M/L

- **另檔 overlay `docker-compose.app.yml`**（非同檔 profiles）：`docker compose -f docker-compose.yml -f docker-compose.app.yml up --build`。預設 `docker compose up`（只起 infra）行為/tests/infra 斷言/DEPLOY.md SOP 完全不動。
- 單一參數化 `backend/Dockerfile`（`ARG MODULE`，multi-stage：maven:3.9-eclipse-temurin-21 build → eclipse-temurin:21-jre run）——7 份重複 Dockerfile 是維護債。
- `frontend/Dockerfile`＋`frontend/nginx.conf`（build → nginx 靜態＋`/api` 反代 gateway）。
- app.yml：7 服務 env 覆寫 host 為 compose 服務名（**容器內走 `postgres:5432`/`mysql:3306` 原生 port，非宿主 5433/3307——最易踩的坑，DEPLOY.md 要寫明**）；`env_file: .env`（雷區 2）；depends_on＋healthcheck。
- 容器拓撲下的 Prometheus scrape 目標改服務名（app.yml 覆寫第二份 config volume）。
- `.dockerignore`、DEPLOY.md 新節、CHANGELOG（overlay 決策可一段 ADR-010）。

驗證：overlay up --build 後 `curl localhost:8080/actuator/health` UP；前端 :80 登入打一局 slot 走真 API。

## Phase 7 — Secret 管理（#7）｜S

- `.env.example` 全部可用值換佔位符＋產生指引（`openssl rand -base64 48`）。
- **CI 測試密鑰改 run 內即時生成**（`echo "JWT_SECRET=$(openssl rand -base64 48)" >> $GITHUB_ENV`），**不用 GitHub Secrets**——本專案走 fork/PR 工作流，fork PR 拿不到 repo secrets 會直接紅；測試密鑰無需持久。改 `ci.yml:53-56` 一帶。
- 新 `docs/security/secret-rotation.md`：各密鑰用途/影響面（`INTERNAL_SECRET` 改了 7 服務同步重啟；`JWT_SECRET` 改了全 token 失效）/輪替步驟；明列「既有本機 .env 值視同已洩漏，施工後重生一輪」。
- DEPLOY.md §4 連結、CHANGELOG。

驗證：CI 綠（觀察 fork PR run）；依新 example 重建 `.env` 後全服務啟動成功。

## Phase 8 — AUDIT_REPORT 自動化（#8）｜S

- `tools/audit/`（Node ESM .mjs，比照 tools/screenshot/ 慣例）：
  - 輸入 `tools/audit/tasks.json`：每 T-0xx 一筆 `{ id, title, owner, priority, evidence: { files: [glob...], commitGrep } }`（首版由附錄 A 手工轉一次）。
  - `generate-audit-snapshot.mjs` 輸出與附錄 A 同格式表格；判定：檔案全在＋`git log --grep` 有 commit→✅、部分→⚠️、全無→❌。寫入 AUDIT_REPORT.md 的 `<!-- AUDIT:BEGIN/END -->` 標記區塊之間（標記外人工敘述不動）；另存 `docs/report/audit-snapshot-YYYYMMDD.md`。
  - `--check` 模式：只比對、有 diff 退出碼 1（日後可掛 CI，本 Phase 不強制）。
- AGENTS.md §1 註記更新方式、CHANGELOG。

驗證：跑 script 後 diff 附錄 A 與現況一致（T-027/T-028 類誤報應轉 ✅）；`--check` 退出碼 0。

---

## 施工順序（今天下午起）

| 時段 | 內容 | 理由 |
|---|---|---|
| 下午第 1 段 | Phase 2a 觀測性（M） | 壓測硬前置；機械化改動、風險低 |
| 下午第 2 段 | Phase 1 Testcontainers（M） | 影響力第一；與 2a 零檔案交集可並行分支 |
| 空檔穿插 | Phase 7（S）＋ Phase 8（S） | 小 PR，等 CI/review 空檔完成 |
| 傍晚獨占機器 | Phase 2b 壓測實跑（L） | 壓測期間勿開發，避免污染數據 |
| 明天起 | P3 Redis → P4 Saga → P5 契約 → P6 容器化 | 3/4/5 都動 game-service 串行避衝突；6 最後 |

通用：每 PR 合併前跑 AGENTS.md §4 的七模組 `mvn test` + `node --test tests/infra/*.test.js`；commit 格式 `type(scope): 中文描述`；main 不直接 commit。

## 關鍵檔案

- `pom.xml`（根）— Testcontainers BOM、Micrometer 依賴管理
- `backend/wallet-service/pom.xml`、`config/DataSourceConfig.java` — P1 雙資料源測試覆寫點
- `backend/game-service/.../fishing/FishingSessionStore.java`、`FishingService.java` — P3 CAS／P4 補償切入點
- `backend/game-service/.../SlotService.java`(:150-199)、`BaccaratService.java` — P4 補償切入點
- `frontend/src/services/mockApi.js`、`frontend/vite.config.js` — P5 前端契約 import
- `docker-compose.yml`、`.github/workflows/ci.yml`(:53-56)、`.env.example` — P2a/P6/P7
- `AUDIT_REPORT.md`（附錄 A 行 339 起）、`tools/screenshot/`（script 慣例參考）— P8
