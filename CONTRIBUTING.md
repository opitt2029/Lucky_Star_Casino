# 開發者貢獻指南

> 幸運星幣城（Lucky Star Casino）專案協作規範  
> 版本：v1.0 ｜ 更新日期：2026-05-26

---

## 目錄

1. [分支命名規範](#1-分支命名規範)
2. [Commit 訊息格式](#2-commit-訊息格式)
3. [PR 提交流程](#3-pr-提交流程)
4. [Code Review 清單](#4-code-review-清單)
5. [本機開發流程（SOP）](#5-本機開發流程sop)

---

## 1. 分支命名規範

### 分支架構

| 分支 | 用途 | 說明 |
|------|------|------|
| `main` | 正式版本 | 只接受來自 `develop` 的 PR，不可直接 commit |
| `develop` | 開發整合分支 | 所有功能完成後先合入此分支，再定期合入 `main` |
| `feature/{名字}-{功能描述}` | 個人功能開發 | 從 `develop` 切出，完成後 PR 回 `develop` |
| `fix/{名字}-{bug描述}` | Bug 修復 | 同上，用於修復已知問題 |
| `docs/{名字}-{文件描述}` | 文件更新 | 純文件修改時使用 |

### 命名範例

```
# 功能開發
feature/alex-member-login
feature/bob-wallet-debit
feature/carol-game-rng-engine

# Bug 修復
fix/alex-jwt-refresh-null-pointer
fix/bob-wallet-negative-balance

# 文件
docs/alex-api-spec-member
```

### 命名規則

- 全小寫，以 `-` 分隔單字（kebab-case）
- `{名字}` 使用英文名（與 GitHub 帳號一致）
- `{功能描述}` 簡潔描述本次開發的核心功能（5 字以內為佳）
- **禁止** 使用中文、空格、底線或大寫字母

---

## 2. Commit 訊息格式

本專案採用 **Conventional Commits** 規範，格式如下：

```
<type>: <中文說明>

[選填] 詳細說明（換行後補充）
```

### Type 對照表

| Type | 使用時機 | 範例 |
|------|---------|------|
| `feat` | 新增功能 | `feat: 新增會員登入 JWT 簽發邏輯` |
| `fix` | 修復 Bug | `fix: 修復錢包扣款樂觀鎖競爭條件` |
| `docs` | 文件更新 | `docs: 補充 Wallet Service API 規格` |
| `refactor` | 重構（不改變行為） | `refactor: 將 RNG 計算邏輯拆分為獨立 Service` |
| `chore` | 雜項設定（依賴、設定檔） | `chore: 升級 Spring Boot 至 3.4.1` |
| `test` | 新增或修改測試 | `test: 新增 WalletService 單元測試` |
| `style` | 程式碼格式（不影響邏輯） | `style: 統一縮排為 4 格空格` |
| `perf` | 效能改善 | `perf: 排行榜查詢改用 Redis ZSet` |

### 完整範例

```
feat: 新增老虎機下注 API

- 實作 POST /api/v1/game/spin 端點
- 透過 /internal/wallet/debit 同步扣款
- 發布 game.result Kafka 事件
- SHA-256 Provably Fair RNG 邏輯
```

### 規則

- 說明部分使用**繁體中文**
- 第一行（標題行）不超過 **72 個字元**
- 標題行結尾**不加句號**
- `feat` 與 `fix` 在 PR 合入 `develop` 後由 GitHub 自動生成 Changelog

---

## 3. PR 提交流程

### 流程圖

```
個人 feature 分支
      │
      │  git push origin feature/xxx
      ▼
  GitHub 上建立 PR
      │
      │  目標分支：develop（！不是 main）
      ▼
  填寫 PR 模板
      │
      │  指派至少 1 位 Reviewer
      ▼
  等待 CI 通過 + Code Review
      │
      │  Reviewer 按下 Approve
      ▼
  Squash and Merge 合入 develop
```

### PR 建立規則

1. **目標分支必須是 `develop`**，禁止直接 PR 至 `main`
2. PR 標題格式與 Commit 訊息格式相同：`feat: 新增會員登入功能`
3. 必須使用 PR 模板（`.github/pull_request_template.md`）填寫所有必填欄位
4. 至少指派 **1 位組員** 為 Reviewer
5. CI 檢查（如有設定）必須全數通過才可合入
6. 合入方式使用 **Squash and Merge**，保持 commit 歷史乾淨

### Reviewer 的責任

- 48 小時內完成 Review（若有時程壓力請在群組告知）
- 有疑問先留 Comment 討論，不要直接 Request Changes 而不說明原因
- Approve 代表你已確認此 PR 不會破壞主線功能

### 合入後的清理

PR 合入後，請刪除遠端的功能分支：

```bash
# GitHub 網頁上「Delete branch」按鈕，或
git push origin --delete feature/xxx
git branch -d feature/xxx
```

---

## 4. Code Review 清單

Reviewer 在 Approve 前請確認以下項目：

### 功能正確性

- [ ] 程式碼是否實現了 PR 描述中的功能？
- [ ] 邊界條件是否有處理？（空值、負數、超長字串等）
- [ ] 是否有遺漏的錯誤處理（Exception 未被 catch 或 log）？

### 資料庫與交易

- [ ] 需要 ACID 的操作是否加了 `@Transactional`？
- [ ] PostgreSQL（帳務核心）與 MySQL（查詢讀庫）的使用是否符合 [ADR-001](docs/adr/ADR-001.md)？
- [ ] 錢包相關操作是否有樂觀鎖（`version` 欄位）保護？

### 安全性

- [ ] API 端點是否有正確的權限驗證（`@PreAuthorize` / Gateway 路由規則）？
- [ ] 對外 API 是否避免暴露敏感資料（密碼、內部 ID 等）？
- [ ] `/internal/**` 路徑是否有 `X-Internal-Secret` Header 驗證？

### 服務邊界

- [ ] 服務間的同步呼叫是否只走 `/internal/**` 路徑（不跨服務直接呼叫 DB）？
- [ ] 非同步通信是否透過 Kafka，而非 HTTP 輪詢？
- [ ] 新的 Kafka Topic 是否遵守命名規範（`{領域}.{事件}`，全小寫 `.` 分隔）？

### 程式碼品質

- [ ] 是否有明顯的重複程式碼可以抽共用？
- [ ] 方法長度是否過長（超過 50 行需說明理由）？
- [ ] 是否有 TODO / FIXME 未處理（需說明或建立 Issue 追蹤）？

### 測試

- [ ] 核心邏輯是否有對應的單元測試？
- [ ] 若有新增 API，是否有基本的 Integration Test 或 Postman 測試截圖？

---

## 5. 本機開發流程（SOP）

每次開始一個新功能，請按照以下步驟操作：

```bash
# Step 1：確保本機 develop 是最新的
git checkout develop
git pull origin develop

# Step 2：從 develop 切出新功能分支
git checkout -b feature/你的名字-功能描述

# Step 3：開發，並定期 commit
git add <修改的檔案>
git commit -m "feat: 你的中文說明"

# Step 4：Push 到遠端
git push origin feature/你的名字-功能描述

# Step 5：在 GitHub 上建立 PR，目標分支選 develop
```

> 如果開發過程中 `develop` 有更新，請用 rebase 而非 merge：
> ```bash
> git fetch origin
> git rebase origin/develop
> ```

---

## 問題與討論

如有任何問題，請在 GitHub Issues 提出，或在專案群組討論。  
大家一起把這個專案做好！💪
