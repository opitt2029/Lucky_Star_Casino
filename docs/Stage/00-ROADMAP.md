# 組員 D 工作排序總路線圖（Roadmap）

> 來源：`docs/幸運星幣城_工作分配表.xlsx`（T-000~T-107 單一真相來源）
> 本檔目的：把組員 D 負責的 25 個任務，依「優先級 + 依賴關係」排出可執行順序，拆成 8 個 Phase。
>
> ## ✅ 全部完成（2026-07-13 複核）
>
> **這 25 個任務已全數落地。本檔與 `01`~`08` 各 Phase 檔皆為「施工當時的計畫」，
> 現在是歷史紀錄，不是待辦清單。** 動工新任務請改看 `docs/plans/`。
>
> 查最新逐項進度請看 `AUDIT_REPORT.md` 附錄 A（由 `tools/audit/generate-audit-snapshot.mjs`
> 自動產生），別依賴本檔的舊快照。

---

## 1. 任務現況總表（D 負責）

> 下表「原盤點」欄是 2026-06 排計畫時的判斷，保留以對照；「現況」欄為 2026-07-13 依程式碼複核。

| 任務 | 模組 | 優先 | 名稱 | 原盤點 | 現況（2026-07-13） |
|---|---|---|---|---|---|
| T-002 | 全域 | P0 | Docker Compose 整合環境 | ⚠️ 部分完成 | ✅ 一鍵起 infra + 7 後端（`docker compose up -d --build`） |
| T-003 | 全域 | P0 | Spring Boot 專案初始化 | ✅ | ✅ 七服務（含 notification） |
| T-040 | Rank | P0 | Redis ZSet 全服排行榜 | ✅ | ✅ |
| T-041 | Rank | P0 | 好友排行榜 | ⬜ | ✅ `FriendRelationshipUpdatedConsumer` + `/friends` |
| T-042 | Rank | P0 | 排行榜查詢 API | ⬜ | ✅ `RankController` |
| T-043 | Rank | P1 | 每週重置排程 | ✅ | ✅ |
| T-044 | Rank | P1 | 每日持幣快照 | ✅ | ✅ |
| T-045 | Rank | P2 | 今日贏幣王排行榜 | ⬜ | ✅ `rank:daily:winnings` ZSet（只認 `sub_type=WIN`） |
| T-050 | Admin | P1 | Admin JWT（角色區分） | ⬜ | ✅ 獨立 `ADMIN_JWT_SECRET`（雷區 21） |
| T-051 | Admin | P1 | 玩家帳號管理 API | ⬜ | ✅ 含經 member 內部 API 持久化 `members.status` |
| T-052 | Admin | P1 | 星幣流通量報表 API | ⬜ | ✅ `CoinFlowReportService` |
| T-053 | Admin | P1 | 遊戲 RTP 監控 API | ⬜ | ✅ |
| T-054 | Admin | P2 | 異常玩家偵測 | ⬜ | ✅ 含 `GET /admin/alerts` |
| T-055 | Admin | P2 | 手動發放星幣（GM） | ⬜ | ✅ `GmRewardService` 發 `wallet.credit.request` 指令（不直接寫 wallet） |
| T-070 | Notification | P1 | WebSocket STOMP Server | ⬜ | ✅ port 8087、`/ws` |
| T-071 | Notification | P1 | Kafka → WebSocket 橋接 | ⬜ | ✅ |
| T-072 | Notification | P1 | 遊戲結果推播 | ⬜ | ✅ 私人佇列 `/user/queue/notifications` |
| T-073 | Notification | P2 | 排行榜變動廣播 | ⬜ | ✅ `/topic/rank` |
| T-090 | 測試 | P0 | JMeter 高併發壓測 | ⬜ | ✅ 已實跑；後續效能調校見 `plans/02-T-090-效能調校藍圖.md` |
| T-091 | 測試 | P0 | 帳務一致性對帳腳本 | ⬜ | ✅ 帳務 gate 全 PASS |
| T-092 | 測試 | P1 | Swagger UI 整合 | ⬜ | ✅ gateway 聚合 `/v3/api-docs/{service}` |
| T-100 | 鑽石 | P0 | DB Schema 鑽石表 | ✅ | ✅ |
| T-105 | 鑽石 | P1 | 批量生成點數卡 API | ⬜ | ✅ `AdminDiamondController` |
| T-106 | 鑽石 | P1 | 點數卡列表/狀態 API | ⬜ | ✅ |

**25 / 25 完成。**

> ⚠️ 這正是 AGENTS.md §1 警告的情形：手動維護的進度表會落後程式碼。判定任務是否完成，
> 請以 Controller/Service 檔是否存在、`git log --grep` 有無該 `T-0xx` commit 為準。

---

## 2. 依賴關係圖（誰卡誰）

```
T-002 (環境) ──► 所有本機驗證的前置

Rank:   T-040✅ ──► T-041 ──► T-042
                          └─► T-045 (另需 game 中獎事件)

Admin:  T-050 (JWT/Security 地基)
          ├─► T-051 (玩家管理)
          ├─► T-052 (流通量報表)
          ├─► T-053 (RTP 監控)  ◄── game RTP API (T-037✅)
          ├─► T-054 (異常偵測)
          ├─► T-055 (GM 發幣)   ◄── wallet 入帳契約 (ADR-002)
          ├─► T-105 (鑽石卡生成) ◄── T-100✅
          └─► T-106 (鑽石卡列表) ◄── T-100✅

Notif:  [建立 notification-service 骨架] ──► T-070 (WS/STOMP)
          └─► T-071 (Kafka 橋接)
                ├─► T-072 (遊戲結果推播) ◄── game.result 事件
                └─► T-073 (排行榜廣播)   ◄── rank.update 事件 (rank-service 須發布)

Test:   T-092 (Swagger, 各 API 完成後)
        T-090 (JMeter) ──► T-091 (對帳 SQL)
```

---

## 3. Phase 執行順序（建議）

排序原則：**P0 優先 → 地基先行 → 同模組集中做（少切換上下文）→ 測試/文件收尾**。

| Phase | 主題 | 含任務 | 優先 | 預估工時 | 檔案 |
|---|---|---|---|---|---|
| 0 | 環境收尾 | T-002 | P0 | 3 | `01-phase0-env.md` |
| 1 | Rank 模組收尾 | T-041, T-042 | P0 | 7 | `02-phase1-rank.md` |
| 2 | Admin 地基 | T-050 | P1 | 3 | `03-phase2-admin-auth.md` |
| 3 | Admin 管理/報表 API | T-051, T-052, T-053 | P1 | 12 | `04-phase3-admin-api.md` |
| 4 | 鑽石後台 API | T-105, T-106 | P1 | 7 | `05-phase4-diamond.md` |
| 5 | Notification 服務 | T-070, T-071, T-072 | P1 | 11 | `06-phase5-notification.md` |
| 6 | P2 加值功能 | T-045, T-054, T-055, T-073 | P2 | 16 | `07-phase6-p2.md` |
| 7 | 測試 & 文件 | T-092, T-090, T-091 | P0/P1 | 11 | `08-phase7-test.md` |

> 合計待辦 ≈ 70h。
> **P0 為何不全排最前？** T-090/T-091（P0）必須等服務拓撲齊全才能跑出真實數據（AGENTS.md §地雷 12），故技術上放最後；T-092 Swagger 也宜等 API 大致完成。其餘 P0（T-041/T-042）已排 Phase 1。

---

## 4. 每個任務的共同收尾（Definition of Done）

每完成一個任務都要：

1. **跑驗證**（AGENTS.md §4）：
   ```bash
   mvn -pl backend/<service> test          # 新服務比照 member/wallet 加 H2 test scope
   node --test tests/infra/*.test.js       # 若動到 Kafka topic
   ```
2. **更新 `CHANGELOG.md`**（根目錄唯一一份）：標題 `## [type] — YYYY-MM-DD — 一句話` + Added/Changed/Fixed + 為什麼 + 如何驗證。
3. **走 fork/PR → develop**，commit 格式 `type(scope): 中文描述`，至少 1 人 review。
4. 改 Kafka topic → 同步改 `kafka/kafka-init.sh` + `tests/infra/kafka.test.js`。
5. 架構級決策 → 寫 `docs/adr/ADR-00X.md` 並在 CHANGELOG 引用。

---

## 5. 全域地雷提醒（動工前再看一次）

- 沒有 `mvnw`，用系統 `mvn`。
- 本機跑後端先載 `.env`（`JWT_SECRET`/`INTERNAL_SECRET`/`CORS_ALLOWED_ORIGINS` 缺了啟動失敗）。
- 測試一律 H2 記憶體 DB；wallet 是雙資料源（ADR-001）。
- `wallet.credit` 是「事件」、`wallet.credit.request` 才是「指令」（ADR-002）。Admin GM 發幣（T-055）要走指令、不可直接寫 wallet。
- 帳務操作 = 冪等鍵 UNIQUE + 樂觀鎖 `@Version`。
- Spring Boot 3.2+ 禁止同名 `@Bean` 方法。
- Admin JWT 用**獨立 Secret**（與玩家區隔）。
