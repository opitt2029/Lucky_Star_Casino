# Phase 1 — Rank 模組收尾（P0）

> 含任務：T-041（好友排行榜）、T-042（排行榜查詢 API）
> 目標：把 Rank 模組剩下兩個 P0 收掉。T-040/T-043/T-044 已完成。
> ⚠️ 重要：盤點發現 `RankController` 已有 `/global`、`/global/{id}`、`/friends` 端點，且
> `FriendRelationshipUpdatedConsumer` 已存在。**先驗證既有實作是否符合契約，補缺即可，勿重寫。**

---

## T-041　好友排行榜實作

**前置依賴**：T-040✅、member 發 `friend.relationship.updated` 事件。
**涉及檔**：
- `kafka/FriendRelationshipUpdatedConsumer.java`（已存在）
- `service/RankService.java`（`getTopFriendCoins`）

### Step
1. **驗證事件契約**：`friend.relationship.updated` payload 是 `{ playerId, friendIds }`（**完整好友清單**，非增量；AGENTS.md §地雷 11）。
2. **重建 ZSet**：consumer 收到事件 → 重建 `rank:friend:{playerId}`（只含好友 + 自己），score = 持幣量。
3. **TTL 24 小時**：`rank:friend:{playerId}` 設 24h TTL，關係異動時重建並刷新。
4. **查詢前 20**：`getTopFriendCoins` 用 `ZREVRANGE 0 19`，組回暱稱/頭像/持幣/排名。
5. **單元測試**：consumer 重建邏輯、TTL、前 20 排序（H2 + embedded Redis 或 mock）。

### 交付物
好友榜邏輯 + API + 單元測試。

### 驗收標準
- 加/刪好友後 `rank:friend:{id}` 正確重建，含且僅含好友。
- TTL 約 24h。
- 查詢回前 20 名，欄位齊全。

---

## T-042　排行榜查詢 API 實作

**前置依賴**：T-040✅、T-041。
**涉及檔**：`controller/RankController.java`、`dto/RankEntryResponse.java`。

### Step
1. **確認端點**：
   - `GET /api/v1/rank/global` → 全服前 100。
   - `GET /api/v1/rank/friends` → 好友前 20（目前用 `X-User-Id` header）。
   - 查自己排名：`GET /api/v1/rank/global/{playerId}`（已存在）+ 好友榜自己排名。
2. **回傳欄位齊全**：`playerId`、暱稱、頭像、持幣量、排名（對照表定需求）。
3. **「查自己當前排名」**：global 用 `ZREVRANK`；friends 榜也補自己名次。
4. **錯誤處理**：玩家不在榜 → 404 或 rank=null（定義清楚並寫進 Swagger）。
5. **單元測試**：`RankControllerTest` 補齊三端點 happy path + 邊界（空榜、不在榜）。

### 交付物
API + 單元測試。

### 驗收標準
- 三端點回傳契約完整、欄位正確。
- 自己排名查得到。

---

## 驗證（整個 Phase）
```bash
mvn -pl backend/rank-service test
```

### 地雷
- 好友事件是**完整清單**，不要改成增量（會破壞 rebuild 假設）。
- 暱稱/頭像來源：rank-service 是否有快取 member 資料？若無，須從 `MemberRegisteredConsumer` 落地的資料取，別跨服務同步呼叫。

**工時**：T-041 = 4h、T-042 = 3h（因骨架已在，實際可能更少）
