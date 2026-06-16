# Phase 5 — Notification 服務（P1）✅ 已完成（2026-06-15）

> 含任務：T-070（WebSocket STOMP）、T-071（Kafka→WS 橋接）、T-072（遊戲結果推播）
> ⚠️ notification-service **尚未建立**（AGENTS.md §地雷 10）→ 先建服務骨架。
> 順序：建骨架 → T-070 → T-071 → T-072。（T-073 在 Phase 6）
>
> **完成摘要**：已建立 `backend/notification-service`（port 8087、`com.luckystar.notification`、無 DB），
> 三任務皆實作完成並 16 tests 綠燈（含 STOMP 連線/鑑權整合測試）。實作差異（與下方計畫對照）：
> - `game.result` / `notification.push` topic **已存在於** `kafka/kafka-init.sh` → **未動 infra 與 `tests/infra/kafka.test.js`**。
> - 本服務無資料庫 → **未加 JPA/H2**（§地雷 3 的 H2 規則僅適用有 DB 的服務）。
> - best-effort 推播、可容忍遺失 → **不設 DLT**；改以「listener 內 try/catch + `MANUAL_IMMEDIATE` ack 丟棄壞訊息」避免卡住 consumer。
> - `game.result` 事件**不含 `balanceAfter`**（game-service 未發），T-072 推播改用實際欄位 bet/payout/win，未杜撰餘額。
> 驗證：`mvn -pl backend/notification-service test` → 16 pass / 0 fail。詳見 CHANGELOG（2026-06-15 T-070/T-071/T-072）。

---

## Step 0　建立 notification-service 骨架（前置）

1. 在 `backend/notification-service` 新增 Maven 模組（比照 rank-service），套件 `com.luckystar.notification`。
2. 加入父 pom modules、依賴：`spring-boot-starter-websocket`、`spring-kafka`、H2（test scope）。
3. port 規劃（README/AGENTS 未列 → 跟組長確認，暫用 8087）。
4. `application.yml` + test `application.yml`（H2）。
5. context loads 測試。

---

## T-070　WebSocket STOMP Server 建立

**前置依賴**：骨架。
**涉及檔**：`config/WebSocketConfig.java`。

### Step
1. `@EnableWebSocketMessageBroker`，STOMP 端點 `/ws`（含 SockJS fallback）。
2. broker：`/topic`（廣播）、`/queue`（私人，配 `/user`）；應用前綴 `/app`。
3. 玩家連線後可訂閱：`/user/queue/notifications`（私人）、`/topic/rank`（公共）。
4. **連線鑑權**：STOMP CONNECT 帶玩家 JWT → 攔截驗章 → 綁定 principal（`/user/` 路由要正確的 principal name）。
5. 連線測試（`WebSocketStompClient`）。

### 交付物
`WebSocketConfig.java` + 連線測試。
### 驗收
client 能連 `/ws`、訂閱頻道、收到測試訊息。

---

## T-071　Kafka → WebSocket 推播橋接

**前置依賴**：T-070。
**涉及檔**：`kafka/NotificationConsumer.java`、用 `SimpMessagingTemplate`。

### Step
1. 消費 `notification.push` 事件，payload `{ targetPlayerId, type, payload }`。
2. 依 `type` 路由：私人 → `convertAndSendToUser(targetPlayerId, "/queue/notifications", payload)`；廣播 → `convertAndSend("/topic/...", payload)`。
3. 反序列化 + 錯誤處理（壞訊息不可卡住 consumer）。
4. 測試：mock template，驗不同 type 走對頻道。

### 交付物
`NotificationConsumer.java` + 推播邏輯。
### 驗收
發 `notification.push` → 對應頻道收到。

---

## T-072　遊戲結果推播

**前置依賴**：T-071、game 發 `game.result` 事件。
**涉及檔**：`kafka/GameResultConsumer.java`。

### Step
1. 消費 `game.result`。
2. 組 payload：`roundId`、`result`、`winAmount`、`balanceAfter`。
3. 推到玩家私人頻道 `/user/{playerId}/queue/notifications`（前端免輪詢）。
4. 測試：事件 → 私人頻道推送正確。

### 交付物
遊戲結果推播邏輯。
### 驗收
下注結算後玩家即時收到結果。

---

## 驗證
```bash
mvn -pl backend/notification-service test
node --test tests/infra/*.test.js   # 若新增/確認 topic
```

### 地雷
- 新服務測試務必 H2 + test yml（CI）。
- 新 topic → 改 `kafka/kafka-init.sh` + `tests/infra/kafka.test.js`（§地雷 7）。
- `/user/` 私人路由要正確 principal，否則推不到指定玩家。
- 確認 `game.result`、`notification.push` topic 是否已存在於 kafka-init。

**工時**：骨架含於下；T-070 = 4h、T-071 = 4h、T-072 = 3h
