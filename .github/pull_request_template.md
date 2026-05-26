## 任務編號

> 填寫對應的任務編號，例如：T-011（會員登入）

- 任務：T-???

---

## 變更說明

> 說明這個 PR 做了什麼、為什麼這樣做。請用條列方式列出主要變更點。

### 變更內容

- 
- 
- 

### 影響範圍

> 勾選這個 PR 影響到哪些服務或模組

- [ ] Gateway Service
- [ ] Member Service
- [ ] Wallet Service
- [ ] Game Service
- [ ] Rank Service
- [ ] Admin Service
- [ ] Frontend（React）
- [ ] 資料庫 Schema（MySQL / PostgreSQL）
- [ ] Docker Compose / 基礎設施設定
- [ ] 文件（docs/）

---

## 測試方式

> 說明 Reviewer 或自己如何驗證這個 PR 的功能正確性

### 測試步驟

1. 
2. 
3. 

### 測試環境

- [ ] 本機手動測試（Postman / 瀏覽器）
- [ ] 單元測試已通過（`./mvnw test`）
- [ ] Docker Compose 環境下整合測試

### 預期結果

> 說明測試完成後應該看到什麼樣的結果

---

## 截圖

> 若有 UI 變更或 API 回應，請附上截圖或 JSON 範例（選填）

<!-- 在此貼上截圖或刪除此區塊 -->

---

## 自我審查清單

> 提交 PR 前，請先完成以下自我審查

### 基本檢查

- [ ] 我的 PR 目標分支是 `develop`（不是 `main`）
- [ ] Commit 訊息格式符合 Conventional Commits 規範
- [ ] 我已在本機測試過主要功能，確認可以正常運作

### 程式碼品質

- [ ] 沒有遺留測試用的 `System.out.println` 或 `console.log`
- [ ] 沒有 hardcode 的密碼、Token 或 IP 位址
- [ ] 沒有將 `.env` 或含敏感資訊的檔案加入 commit

### 架構遵守

- [ ] 資料庫使用符合 ADR-001（PostgreSQL 寫入核心 / MySQL 查詢讀庫）
- [ ] 服務間通信遵守架構規範（同步用 `/internal/**`，非同步用 Kafka）
- [ ] 對外 API 路徑符合 `/api/v1/{服務}/` 命名規則

### 文件

- [ ] 若有新增 API，已在任務說明或 PR 描述中附上端點規格
- [ ] 若有新增 Kafka Topic，已遵守命名規範（`{領域}.{事件}`，全小寫）
