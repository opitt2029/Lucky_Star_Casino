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
10. **服務完成度**：member / gateway / wallet 已實作；rank 已完成 T-040 全服排行與 T-041 好友排行；**game / admin 仍是空殼**；**notification 服務尚未建立**。動工前先看 AUDIT_REPORT 附錄 A 與 CHANGELOG 確認。
11. **`friend.relationship.updated` 是完整好友清單事件**：member 在好友接受/刪除後，為雙方各發布 `{ playerId, friendIds }`；rank 依完整清單重建 `rank:friend:{playerId}`，不要改成只帶單筆新增/刪除的增量事件。

---

## 3. 約定速查

### 技術 / Port
- 套件根 `com.luckystar`、Java 21、Spring Boot 3.3.5、JJWT 0.12.6
- DB：PostgreSQL（帳務寫庫）+ MySQL（查詢讀庫）CQRS；Redis（token/session/排行）；Kafka（事件）
- Port：gateway 8080 / member 8081 / wallet 8082 / game 8083 / rank 8084 / admin 8086；MySQL **3307** / PostgreSQL **5433** / Redis 6379 / Kafka 9092 / Kafka UI 8085

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
