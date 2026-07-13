# 2026-06-25 Bug Candidates

> **狀態：✅ 全部 5 項已修復並關閉**（2026-07-13 逐項對照程式碼複核）
>
> 本檔保留作為當時的稽核紀錄。**下面每一項的 Evidence 都是 2026-06-25 當時的行號與現象，
> 現在已不成立**，請勿據此再開 issue。逐項驗證結果：
>
> | 編號 | 原問題 | 現況（2026-07-13 複核） |
> |---|---|---|
> | BUG-001 | Rank 頁固定走 mock、欄位對不上 | ✅ 已修：`rankSlice.js` 改 `rankApi.getRanks(playerId)`，走真實端點 |
> | BUG-002 | 交易紀錄/贈幣寫死 mock | ✅ 已修：`walletSlice.js` 全面改走 `walletApi`（含 `giftCoins`、簽到、破產補助等） |
> | BUG-003 | 前端訂閱後端從未發布的 WS topic | ✅ 已修：`RealtimeBridge.jsx` 移除 `/topic/wallet`、`/topic/game/result`，只留 `/topic/rank`；註解已寫明餘額走 REST 回應、遊戲結果走私人佇列 |
> | BUG-004 | `CASHBACK` 子型未進 init.sql / DTO 白名單 | ✅ 已修：兩套 `init.sql` 的 CHECK 與 `CreditRequest` 皆已含 `CASHBACK` |
> | BUG-005 | 捕魚退款被記成 `WIN`，污染今日贏幣王 | ✅ 已修：`WalletClient` 新增可帶 `subType` 的 `credit()` 多載，退款改用非 WIN 子型 |
>
> 相關雷區已寫進 `AGENTS.md`（子型四同步＝雷區 18；排行只認 `WIN`＝雷區 18 末段）。

---

Scope: current `develop` (`2e9aad8642cc35c86ee77d3e48c553a9d9a31834`)

## BUG-001 - Rank page still uses mock data and mismatches backend schema

- Severity: High
- Area: Frontend / Rank Service integration
- Evidence:
  - `frontend/src/store/slices/rankSlice.js:17` always calls `mockApi.getRank()`.
  - `frontend/src/pages/Rank.jsx:15` searches by `row.nickname || row.name`.
  - `frontend/src/components/LeaderboardPanel.jsx:22` displays `row.nickname || row.name`.
  - Backend `RankEntryResponse` returns `playerId`, `username`, `rank`, `score`.
- Impact: The rank page does not show real `/api/v1/rank/global` or `/api/v1/rank/friends` data. If real rows are injected through WebSocket/API, search/display can fail because `username` is ignored.
- Suggested fix: Add `rankApi` for real endpoints, map backend rows to UI rows, and update search/display/dedupe keys to use `playerId` and `username`.
- Suggested verification: Frontend test for API row `{ playerId, username, rank, score }`; manual check with `VITE_USE_MOCK_API=false`.

## BUG-002 - Wallet transactions and gift flow are still hardwired to mock API

- Severity: High
- Area: Frontend / Wallet Service integration
- Evidence:
  - `frontend/src/store/slices/walletSlice.js:63` calls `mockApi.getTransactions(params)`.
  - `frontend/src/store/slices/walletSlice.js:71` calls `mockApi.giftCoins(payload)`.
  - Real backend endpoints exist at `backend/wallet-service/src/main/java/com/luckystar/wallet/controller/WalletController.java:89` and `:153`.
- Impact: Transaction history and friend gift UI do not exercise real wallet-service behavior, idempotency, daily gift limits, or CQRS transaction records.
- Suggested fix: Add `walletApi.getTransactions()` and `walletApi.giftCoins()`, normalize backend `PagedResponse`/`GiftResponse` to the existing Redux shape, and keep mock path only when `VITE_USE_MOCK_API !== 'false'`.
- Suggested verification: Unit tests for request params/body mapping; manual transaction/gift flow with real backend.

## BUG-003 - Frontend subscribes to WebSocket topics that backend never publishes

- Severity: Medium
- Area: Frontend / Notification Service integration
- Evidence:
  - `frontend/src/components/RealtimeBridge.jsx:13` subscribes to `/topic/wallet`.
  - `frontend/src/components/RealtimeBridge.jsx:14` subscribes to `/topic/game/result`.
  - Notification service publishes rank to `/topic/rank` (`RankUpdateConsumer.java:20`), game results to `/user/queue/notifications` (`GameResultConsumer.java:23`), and generic broadcasts to `/topic/notifications` (`NotificationConsumer.java:21`).
- Impact: Wallet realtime updates never arrive through `/topic/wallet`; game result topic subscription is dead code. The UI relies on API refresh or private notification handling, so realtime behavior is misleading and incomplete.
- Suggested fix: Either publish explicit wallet/game topics from notification-service, or remove dead subscriptions and handle wallet refresh from `/user/queue/notifications` payloads.
- Suggested verification: WebSocket integration test asserting frontend subscription destinations match notification-service destinations.

## BUG-004 - CASHBACK subtype is not consistently allowed across wallet schema and validation

- Severity: High
- Area: Wallet Service / DB schema / Cashback
- Evidence:
  - `backend/game-service/src/main/java/com/luckystar/game/kafka/CashbackEventPublisher.java:27` sends `subType=CASHBACK`.
  - `database/postgres/init.sql:42` does not include `CASHBACK`.
  - `database/mysql/init.sql:179` does not include `CASHBACK`.
  - `backend/wallet-service/src/main/java/com/luckystar/wallet/dto/CreditRequest.java:41` validation message/pattern omits `CASHBACK`.
- Impact: Fresh docker-compose databases initialized from `init.sql` can reject cashback rows by CHECK constraint. Internal HTTP credit validation also rejects CASHBACK even though migrations later added it.
- Suggested fix: Add `CASHBACK` to PostgreSQL/MySQL init schemas and `CreditRequest` validation, and add a test that the subtype allowlists stay aligned.
- Suggested verification: Infra/schema test for subtype lists; wallet-service validation test for `subType=CASHBACK`.

## BUG-005 - Fishing refunds/session-balance returns are classified as WIN and inflate daily winnings

- Severity: High
- Area: Game Service / Rank Service
- Evidence:
  - `backend/game-service/src/main/java/com/luckystar/game/client/WalletClient.java:52` hardcodes every game credit as `subType=WIN`.
  - `backend/game-service/src/main/java/com/luckystar/game/service/FishingService.java:166` uses that method for buy-in refund.
  - `backend/game-service/src/main/java/com/luckystar/game/service/FishingService.java:552` credits remaining session balance on fishing end with the same `WIN` subtype.
  - `backend/rank-service/src/main/java/com/luckystar/rank/kafka/WalletBalanceChangedConsumer.java:34` adds every `WIN` credit amount to daily winnings.
- Impact: Returning unused fishing buy-in or refunding a failed session is counted as "today's winnings", so `rank:daily:winnings` can rank players by returned principal rather than actual prize amount.
- Suggested fix: Let `WalletClient.credit()` accept subtype, use a non-winning subtype for refunds/returns, or move daily winnings accumulation to trusted `game.result` payout fields instead of wallet credit amount.
- Suggested verification: Rank consumer/service test showing fishing return/refund does not call `addDailyWinnings`; end-to-end fishing session with zero shots should not increase daily winnings.
