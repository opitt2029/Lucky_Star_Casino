# 全功能實機 Smoke Test 報告

- 日期：2026-06-15
- 環境：本機 docker 基礎設施（MySQL 3307 / PostgreSQL 5433 / Redis 6379 / Kafka 9092 全 healthy）+ 5 個後端服務（member/wallet/game/rank/gateway，皆 `Started ...Application`）+ 前端 Vite。
- 範圍：L0 基礎設施、L1 後端 API（經 gateway:8080 端到端）、L2 前端（lint/build/e2e）。
- 工具：`tests/smoke/smoke.mjs`（新增）、`frontend` npm scripts。
- 「避免重跑」：CI 已綠的 gateway/member/wallet 單元測試 + `tests/infra` **未重跑、沿用 CI 結果**；本次聚焦 CI 未覆蓋的實機端到端路徑（game/rank/前端整合）。

## 總結

| 層 | 結果 |
|---|---|
| L0 基礎設施 | ✅ 全 healthy；Kafka 8 業務 topic + DLT 全建立 |
| L1 後端 API | ✅ 全部功能正常；**BUG-1（捕魚機持久化/驗證）已修復並重跑驗證通過**；slot/spin 冷啟動暫態（非 bug） |
| L2 前端 | ✅ lint 乾淨、build 成功、Playwright e2e 通過 |

---

## L1 後端逐功能結果（經 gateway:8080）

### member-service ✅
| 端點 | 結果 |
|---|---|
| POST /api/v1/auth/register | ✅ 201 |
| POST /api/v1/auth/login | ✅ 200（取得 JWT） |
| GET /api/v1/player/profile | ✅ 200 |
| PUT /api/v1/player/profile | ✅ 200（nickname 更新生效） |
| POST /api/v1/auth/refresh | ✅ 200 |
| POST /api/v1/auth/logout | ✅ 200 |

### wallet-service ✅
| 端點 | 結果 |
|---|---|
| 錢包建立（Kafka member.registered → createWallet） | ✅ 非同步建立成功 |
| POST /api/v1/wallet/bankruptcy-aid | ✅ 200（餘額 0→1000） |
| GET /api/v1/wallet/balance | ✅ 200 |
| GET /api/v1/wallet/transactions | ✅ 200 |
| POST /api/v1/wallet/daily-checkin | ✅ 200 |
| GET /api/v1/wallet/diamond/balance | ✅ 200 |

### game-service ⚠️
| 端點 | 結果 |
|---|---|
| POST /api/v1/game/slot/spin | ✅ 200（暖機後；見備註 1） |
| POST /api/v1/game/slot/round（commit-ahead 承諾） | ✅ 200 |
| POST /api/v1/game/slot/round/{id}/settle（揭露） | ✅ 200 |
| POST /api/v1/game/baccarat/bet | ✅ 200 |
| POST /api/v1/game/baccarat/{id}/result | ✅ 200 |
| POST /api/v1/game/fishing/session/start | ✅ 200 |
| GET /api/v1/game/fishing/session/active | ✅ 200 |
| POST /api/v1/game/fishing/{id}/shots | ✅ 200 |
| POST /api/v1/game/fishing/{id}/end | ✅ 200，對局正常持久化（修復後） |
| GET /api/v1/game/fishing/{id}/verify-shot | ✅ 200（修復後；原為 404，見 BUG-1） |
| GET /api/v1/game/rtp | ✅ 200（暖機後；連跑兩次曾觸發 429 限流，屬正常防護） |
| GET /api/v1/game/verify/{roundId} | ✅ 200（同上，限流為正常行為） |

### rank-service ✅
| 端點 | 結果 |
|---|---|
| GET /api/v1/rank/global | ✅ 200 |
| GET /api/v1/rank/global/{playerId} | ✅ 200 |
| GET /api/v1/rank/friends | ✅ 200（空清單，無好友屬正常） |

---

## 🐞 發現並已修復的 Bug

### BUG-1：捕魚機對局無法持久化 → verify-shot 永遠 404（schema 約束缺 FISHING）✅ 已修復

- **現象**：`POST /fishing/{id}/end` 回 200（局內餘額有正確 credit 回錢包），但隨後
  `GET /fishing/{id}/verify-shot` 回 **404**。逐發公平性驗證功能形同失效。
- **根因**：`database/postgres/init.sql`（及 `migration/V1__init_schema.sql`）的
  ```sql
  CONSTRAINT chk_gr_game_type CHECK (game_type IN ('SLOT', 'BACCARAT'))
  ```
  **未包含 `FISHING`**。捕魚機結算寫 `game_rounds`（game_type=`FISHING`）時被 PostgreSQL
  擋下（SQLState 23514）。game-service log 實證：
  ```
  ERROR: new row for relation "game_rounds" violates check constraint "chk_gr_game_type"
  詳細：Failing row contains (..., FISHING, ...)
  ```
- **次要問題**：`FishingService.end` 把這個 **約束違反誤判為「並發結算」吞掉**
  （log：`fishing session concurrently settled, skip persist`），導致錯誤被靜默遮蔽、
  end 仍回 200，使問題不易察覺。
- **連帶影響**：`chk_rtp_game_type CHECK (game_type IN ('SLOT','BACCARAT'))`（`game_rtp_stats` 表）
  同樣缺 `FISHING`，**捕魚機 RTP 統計排程也會寫入失敗**。
- **已施作的修復**：
  1. schema 兩個約束加入 `FISHING`：更新 `database/postgres/init.sql`（`chk_gr_game_type`、`chk_rtp_game_type`）
     並新增遷移 `database/postgres/migration/V5__add_fishing_game_type.sql`（DROP + ADD CONSTRAINT）。
     已對運行中的 PostgreSQL 套用 V5（init.sql 僅在 fresh volume 執行，既有環境需跑遷移）。
  2. `FishingService.settleInternal` 收窄例外處理：catch `DataIntegrityViolationException` 後**重查
     `roundRepository.findByRoundId`**，唯有對局確已寫入（唯一鍵衝突＝真並發）才忽略，其餘一律
     log error 並重拋，避免再次靜默遮蔽 schema/資料問題。
- **驗證結果**：重啟 game-service 後重跑 `node tests/smoke/smoke.mjs` —— `verify-shot` 回 **200**，
  `fishing/{id}/end` 對局正常持久化。✅

---

## 備註（非 bug）

1. **slot/spin 首呼 503（冷啟動暫態）**：服務剛啟動後第一次 `/spin` 因 game-service 的 Kafka
   producer 首次惰性初始化拖慢，gateway 端 CircuitBreaker fallback 回 503；後端其實已完成結算
   （log：`slot spin settled`）。暖機後重跑即 200，**非程式 bug**，屬冷啟動特性。
2. **429 限流**：連續兩次跑整套 smoke 時，game 路由的每玩家限流（5 req/s）對 `/rtp`、`/verify`
   回 429——這是**設計中的防護正常運作**，非 bug。單次執行不會觸發。

---

## L2 前端結果 ✅

| 項目 | 指令 | 結果 |
|---|---|---|
| Lint | `npm run lint` | ✅ 無錯誤 |
| Build | `npm run build` | ✅ 289 模組、built in ~3s |
| E2E（捕魚機，mock 模式） | `npm run e2e` | ✅ 1 passed（進場→開火→收網→逐發驗證） |

> 前端各受保護頁面（老虎機/百家樂/排行/錢包/簽到/鑽石）所依賴的後端 API 已於 L1 端到端驗證通過。
> 接真後端的逐頁人工點測（`npm run dev`）為互動式，未納入本次自動化；如需可另行進行。

## 未涵蓋
- **admin-service**：仍為骨架（無業務邏輯），僅啟動層級，未做 API smoke。
- **notification-service**：尚未建立。
- 前端真後端逐頁人工驗證（互動式）。
