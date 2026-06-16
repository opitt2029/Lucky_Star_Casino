# Phase 4 — 鑽石後台 API（P1）✅ 已完成（2026-06-15）

> 含任務：T-105（批量生成點數卡）、T-106（點數卡列表/狀態）
> 前置：T-050（Admin Security）✅ + T-100（鑽石 Schema）✅。
> 為何同 Phase：兩者同操作 `diamond_cards` 表（MySQL），集中做。
>
> **完成摘要**：兩任務皆已實作於 admin-service（`AdminDiamondController` / `DiamondCardService` / `mysql.entity.DiamondCard` 等）。
> ⚠️ 計畫中「admin 主源是 PostgreSQL」之假設**有誤**：admin 的 `@Primary` 源即 MySQL（見 `DataSourceConfig`），
> 故直接以既有 MySQL EMF（`mysqlTransactionManager`）讀寫 `diamond_cards`，**未新增資料源**。
> 驗證：`mvn -pl backend/admin-service test` → 52 pass / 0 fail。詳見 CHANGELOG（2026-06-15 T-105/T-106）。

---

## T-105　批量生成點數卡序號 API（後台）

**前置依賴**：T-050、T-100（`diamond_cards` 表已在 MySQL）。
**涉及檔**（新增於 admin-service）：
- `controller/AdminDiamondController.java`
- `service/DiamondCardService.java`
- `entity/DiamondCard.java`、`repository/DiamondCardRepository.java`
- ⚠️ `diamond_cards` 在 **MySQL**，admin 目前連 PostgreSQL → 需評估：是否在 admin 加 MySQL 讀寫源，或委派 game/wallet 既有 MySQL 連線。**動工前先確認 admin 該不該直連 MySQL**（看 architecture.md DB 分配）。

### Step
1. **端點**：`POST /admin/diamond/cards`，body `{ count, faceValue }`。
2. **序號產生**：UUID-based，格式 `XXXX-XXXX-XXXX-XXXX`（16 碼分 4 段）。
3. **批量寫入**：`is_redeemed=false`，`card_code` UNIQUE（撞號重產）。
4. **回傳清單**：回生成的序號陣列供匯出。
5. **權限**：`@PreAuthorize` 限 admin role。
6. **測試**：產 N 張數量正確、格式正確、唯一性。

### 交付物
Admin API + 序號產生邏輯 + 單元測試。
### 驗收
指定張數/面額 → 產對應數量唯一序號，格式合規。

---

## T-106　查詢點數卡列表與兌換狀態 API（後台）

**前置依賴**：T-105（同表）。
**涉及檔**：同上 controller/service 擴充。

### Step
1. **端點**：`GET /admin/diamond/cards?page=&size=&status=all|redeemed|unredeemed`。
2. **過濾**：依 `is_redeemed` 過濾。
3. **回傳欄位**：`card_code`、`face_value`、`is_redeemed`、`redeemed_by`、`redeemed_at`。
4. **分頁**：標準 page/size。
5. **測試**：三種 status 過濾正確、分頁正確。

### 交付物
Admin API + 分頁查詢 + 單元測試。
### 驗收
status 過濾與分頁正確，欄位齊全。

---

## 驗證
```bash
mvn -pl backend/admin-service test
```

### 地雷
- `diamond_cards` 在 MySQL；admin 主源是 PostgreSQL。**先決定資料存取方式**再寫，別假設單源。
- `card_code` UNIQUE → 批量插入要處理唯一衝突。
- 端點走 `/admin/**` 授權。

**工時**：T-105 = 4h、T-106 = 3h
