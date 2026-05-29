# Changelog — wallet-service

All notable changes to wallet-service are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [feat] — 2026-05-29 — 派彩鏈路：查詢餘額 / 下注扣款 API + 冪等測試補強（T-021 / T-022 / T-024）

### Added — T-021 查詢星幣餘額 API（commit `ca65249`，2026-05-28）

- `controller/WalletController.java` — `GET /api/v1/wallet/balance`，playerId 取自 Gateway 轉發 header（後由 FIX-1 對齊為 `X-User-Id`）。
- `service/WalletService#getBalance()`、`postgres/entity/Wallet.java`、`postgres/repository/WalletRepository.java`、`dto/WalletBalanceResponse.java`、`common/ApiResponse.java`。
- `exception/WalletNotFoundException.java`（404）+ `GlobalExceptionHandler` 對應處理。
- 測試：`WalletControllerTest`、`WalletServiceTest`。

### Added — T-022 下注扣款 API（commit `bf385ce`，2026-05-29）

- `controller/InternalWalletController.java` — `POST /internal/wallet/debit`。
- `service/WalletService#debit()` — 冪等檢查（`idempotency_key` UNIQUE）→ 載入錢包 → 餘額不足擋下 → 樂觀鎖（`@Version`）扣款 → 寫 `wallet_transactions`（type=DEBIT）→ 發 `wallet.debit` 事件；含並發 UNIQUE 衝突回查處理。
- `dto/DebitRequest.java`、`dto/DebitResponse.java`、`kafka/WalletDebitEvent.java`、`postgres/entity/WalletTransaction.java`、`postgres/repository/WalletTransactionRepository.java`。
- `exception/InsufficientBalanceException.java` + `GlobalExceptionHandler` 對應處理。
- 測試：`WalletServiceDebitTest`。

### Tests — T-024 冪等/防重複測試補強（commits `e23ca9d` / `e9e5689`，2026-05-29）

- `controller/InternalWalletControllerCreditTest.java`（新增，撿自 PR #41）：補 `credit` 端點 web 層 MockMvc 測試 —— 200 成功、缺 amount 400、`subType` 非法 400、重送冪等回傳 `idempotent=true`（共 4 例）。
- `service/WalletServiceDebitTest.java`（新增 2 個邊界案例）：
  - 同一 `idempotency_key` 重送且金額被竄改 → 仍回傳**原始交易**數值（非請求值），且冪等命中時完全不碰錢包。
  - UNIQUE 違規後重查仍為空（理論不應發生）→ 拋回原始 `DataIntegrityViolationException`，不吞錯回傳假成功。

### Verified

- 透過 CI `backend-test` job 驗證。

### Note

- T-023 派彩入帳 API 與 ADR-002（`wallet.credit` 指令/事件分離）詳見根目錄 [`/CHANGELOG.md`](../../CHANGELOG.md)，本檔不重覆。
