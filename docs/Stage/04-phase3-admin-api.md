# Phase 3 — Admin 管理 / 報表 API（P1）

> 含任務：T-051（玩家帳號管理）、T-052（星幣流通量報表）、T-053（遊戲 RTP 監控）
> 前置：T-050（Admin Security）必須先完成。
> 順序建議：T-051 → T-052 → T-053（先做 CRUD 再做報表）。

---

## T-051　玩家帳號管理 API（後台）

**前置依賴**：T-050。
**涉及檔**：`controller/AdminPlayerController.java`、`service/AdminPlayerService.java`、查 member/wallet 讀庫。

### Step
1. **玩家列表**：`GET /admin/players?page=&size=&keyword=`（分頁 + 暱稱/帳號關鍵字搜尋）。
2. **單一詳情**：`GET /admin/players/{id}` → 餘額（wallet 讀庫）+ 對局紀錄（game）+ 帳務（wallet_transactions）。
3. **停用/啟用**：`PATCH /admin/players/{id}/status` → 改 member 狀態。
4. **停用即時失效**：停用後把該玩家 JWT 加入 **Redis 黑名單**（gateway/member 驗章時檢查黑名單 → 立即失效）。
5. **測試**：分頁、搜尋、停用後黑名單寫入。

### 交付物
Admin API + 單元測試。
### 驗收
停用後該玩家既有 token 立刻無法用（Redis 黑名單命中）。

> 跨服務資料：詳情頁要彙整 member/wallet/game。優先走**讀庫查詢**或既有 internal API，勿在 admin 直接寫他服務的庫。

---

## T-052　星幣流通量報表 API

**前置依賴**：T-050、`wallet_transactions` 表。
**涉及檔**：`controller/AdminReportController.java`、`service/CoinFlowReportService.java`、SQL 彙整。

### Step
1. **發放 vs 消耗分類**：依 `wallet_transactions.sub_type` 區分發放（簽到/任務/派彩）與消耗（下注/手續費）。
2. **維度查詢**：`GET /admin/reports/coin-flow?dimension=day|week|month&from=&to=`。
3. **SQL 彙整**：`GROUP BY` 日期維度 + sub_type，算發放總額、消耗總額、淨流通。
4. **趨勢**：回傳時間序列陣列供前端畫圖。
5. **測試**：用 H2 塞假交易，驗各維度彙整正確。

### 交付物
報表 API + SQL 彙整查詢。
### 驗收
日/週/月維度數字與手算流水一致。

---

## T-053　遊戲 RTP 監控儀表板 API

**前置依賴**：T-050、game RTP 統計（T-037✅）。
**涉及檔**：`controller/AdminReportController.java`（或新增）、查 game RTP 資料。

### Step
1. **取實際 RTP**：呼叫 game-service 既有 RTP 統計 API / 讀庫（老虎機、百家樂）。
2. **比對設計 RTP**：各遊戲設定值對照實際值。
3. **異常標記**：偏差 `> 5%` 標 `ABNORMAL`。
4. **時間區間篩選**：`GET /admin/reports/rtp?game=&from=&to=`。
5. **測試**：偏差判定邊界（剛好 5%、>5%）。

### 交付物
RTP 報表 API。
### 驗收
偏差 >5% 正確標異常，可依時間區間查。

---

## 驗證（整個 Phase）
```bash
mvn -pl backend/admin-service test
```

### 地雷
- 所有端點走 T-050 的 `/admin/**` 授權。
- 報表是讀取/彙整，**不可**改帳務數據。
- RTP 別在 admin 重算，取 game 既有統計（T-037 已做）。

**工時**：T-051 = 5h、T-052 = 4h、T-053 = 3h
