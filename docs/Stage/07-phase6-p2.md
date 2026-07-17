# Phase 6 — P2 加值功能 ✅ 已完成

> **完成摘要（2026-07-13 複核）**：四項全數完成。
> - T-045 今日贏幣王：`rank:daily:winnings` ZSet。**只認 `sub_type=WIN`**——曾有 BUG-005，
>   捕魚退款被記成 WIN 而灌水排行，已修（雷區 18）。
> - T-054 異常玩家偵測：含 `GET /admin/alerts` 查詢。
> - T-055 GM 發幣：`GmRewardService` 發 `wallet.credit.request`「指令」（`subType=GM_REWARD`），
>   **絕不直接寫 wallet**（ADR-002）。
> - T-073 排行榜廣播：notification-service 訂閱 `rank.update` → `/topic/rank`。
>
> 以下為當時的施工計畫，保留作歷史紀錄。

> 含任務：T-045（今日贏幣王）、T-054（異常玩家偵測）、T-055（GM 發幣）、T-073（排行榜廣播）
> P2 優先級，前置模組（Rank/Admin/Notification）齊全後再做。

---

## T-045　今日贏幣王排行榜（Rank）

**前置依賴**：T-040✅、game 中獎事件。
**涉及檔**：`service/RankService.java`、新 consumer、`RankController`。

### Step
1. ZSet `rank:daily:winnings`，score = 當日累計**中獎金額**（非持幣）。
2. 消費中獎事件（`wallet.credit` 事件中 sub_type=派彩，或 game.result winAmount）→ `ZINCRBY`。
3. 每日重置（00:00，比照 T-044 排程，或設 TTL 到隔日）。
4. API：`GET /api/v1/rank/daily/winnings`（前 N + 自己）。
5. 測試：累加、重置、排序。

**交付物**：ZSet 設計 + API。**工時**：3h
> 注意：來源要選對——「中獎金額」累加，不是餘額。確認用哪個事件帶 winAmount。

---

## T-054　異常玩家偵測機制（Admin）

**前置依賴**：T-050、Kafka。
**涉及檔**：admin `service/AlertRuleEngine.java`、`entity/AdminAlert.java`、Kafka producer。

### Step
1. 告警規則：① 單局中獎 > 50,000；② 30 分內下注 > 100 次；③ 帳務異動頻率異常。
2. 消費相關事件（game.result / wallet 事件）→ 規則引擎判定。
3. 命中 → 寫 `admin_alerts` 表 + 發 `notification.push` 通知管理員。
4. 測試：各規則邊界觸發。

**交付物**：規則引擎 + Kafka Producer。**工時**：5h

---

## T-055　手動發放星幣 API（GM 工具）（Admin）

**前置依賴**：T-050、wallet 入帳契約（ADR-002）。
**涉及檔**：admin `controller/AdminDiamondController` 或新 `GmController`、`service/GmRewardService.java`。

### Step
1. 端點：`POST /admin/gm/grant`，body `{ playerId, amount, reason }`，限 `SUPER_ADMIN`。
2. **走指令、不直接寫 wallet**：發 `wallet.credit.request`（指令）給 wallet-service 入帳（ADR-002 §地雷 6）。sub_type=`GM_REWARD`。
3. 冪等：帶 `idempotency_key`（防重複發放）。
4. 操作日誌：記操作者帳號/時間/原因（落 admin 表）。
5. 測試：發指令正確、日誌寫入、權限限制。

**交付物**：Admin API + 操作日誌。**工時**：3h
> ⚠️ 絕不直接 update wallet.balance。發 `wallet.credit.request`，由 wallet 消費入帳並回 `wallet.credit` 事件。

---

## T-073　排行榜變動廣播（Notification）

**前置依賴**：T-071、rank-service 發 `rank.update` 事件。
**涉及檔**：notification `kafka/RankUpdateConsumer.java`；rank-service 需新增 `rank.update` producer。

### Step
1. rank-service：TOP10 變動時發 `rank.update`（帶最新榜）。
2. notification：消費 `rank.update` → 廣播 `/topic/rank`。
3. 限流/去抖：避免每次微小變動狂推（可節流）。
4. 測試：TOP10 變動才廣播。

**交付物**：排行榜廣播邏輯。**工時**：3h
> 跨任務：需 rank-service 配合發事件——先協調或一起改。

---

## 驗證
```bash
mvn -pl backend/rank-service,backend/admin-service,backend/notification-service test
node --test tests/infra/*.test.js
```

**Phase 工時合計**：16h
