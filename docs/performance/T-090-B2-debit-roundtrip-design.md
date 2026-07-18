# T-090 B2 — wallet debit 交易往返 4→2 設計紀錄

> 日期：2026-07-18。狀態：施工中（本檔＝Phase B2 SOP 要求的「開 issue 記設計」之設計紀錄）。
> 範圍：僅 `WalletService.debit()` 熱路徑；`credit()`、`GiftTransferService`、凍結/解凍、交易邊界、
> Kafka 事件、MySQL 讀視圖同步全部不動。雷區 8（冪等 + 防超扣）語意一絲不變是硬約束。

## 1. 現況與目標

B1 JFR 定案：每筆 debit 交易 4 次 DB 往返——①冪等 SELECT ②載入錢包 SELECT ③UPDATE wallets
④INSERT wallet_transactions——加同步 WAL commit。本機 Postgres 容量 ≈550–600 交易/秒，
往返數直接決定單筆延遲下限。目標：熱路徑 4→2 次往返，150 併發 P99 從 393ms 壓向 250–350ms。

## 2. 新流程（熱路徑 2 次往返）

### 往返 1 — 條件扣款（①+②+③ 三合一）

```sql
UPDATE wallets
   SET balance = balance - :amount, version = version + 1, updated_at = CURRENT_TIMESTAMP
 WHERE player_id = :playerId
   AND balance - frozen_amount >= :amount                                   -- 可用餘額守衛（含凍結）
   AND NOT EXISTS (SELECT 1 FROM wallet_transactions t
                    WHERE t.idempotency_key = :key)                          -- 冪等預檢（唯一索引點查）
RETURNING balance
```

- **1 列**：扣款成功，`balance_after` = 回傳值、`balance_before` = 回傳值 + amount。
  行鎖從此持到 commit，餘額鏈（balance_before/after）不可能被併發交錯污染。
- **0 列（冷路徑，零副作用）**：依序補查——
  1. `findByIdempotencyKey` 命中 → 回原交易（idempotent=true），與舊 Step 1 行為完全相同；
  2. 錢包不存在 → `WalletNotFoundException`（404）；
  3. 否則 → `InsufficientBalanceException`。

### 往返 2 — 流水寫入＋原子冪等判定（①+④ 合一的寫入端）

```sql
INSERT INTO wallet_transactions (player_id, type, sub_type, amount,
                                 balance_before, balance_after,
                                 idempotency_key, reference_id, created_at)
VALUES (:pid, 'DEBIT', :subType, :amount, :before, :after, :key, :ref, CURRENT_TIMESTAMP)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id
```

- **回 id**：成功。Kafka `wallet.debit` 事件欄位/序列化照舊，但**發送時點改為 afterCommit**
  （`TransactionSynchronizationManager`）：往返 1 起本交易就持有 wallets 行鎖，若在交易內同步發送，
  broker 阻塞（producer `max.block.ms` 預設 60s）會拖住該玩家行鎖、後續扣款全排隊（code review
  must-fix）；順帶消除「外層交易（商城兌換）回滾但事件已發出」的幽靈事件（讀視圖髒寫）。
- **空（極窄競態）**：兩個同鍵請求同時通過往返 1 的 NOT EXISTS（Postgres READ COMMITTED 下
  EvalPlanQual 重評估對其他表用原 snapshot，理論上可能雙雙扣款）→ 落敗方在同交易內
  **原地補償** `UPDATE wallets SET balance = balance + :amount, version = version + 1`（淨額歸零、
  不多寫流水），再回查贏家紀錄回 idempotent=true。不用 rollback 是因為 debit 可能 join 外層交易
  （商城兌換），丟例外會把外層整筆標記 rollback-only。

## 3. 語意等價性論證（雷區 8 逐條）

| 既有語意 | 新實作對應 | 等價？ |
|---|---|---|
| 冪等鍵重放 → 回原結果、零副作用 | NOT EXISTS 預檢擋在 UPDATE 內（0 列＝不動錢包）→ 冷路徑回查原交易 | ✅ 完全等價（連「重放金額被竄改仍回原值」都保留） |
| 超扣防護 | `balance - frozen_amount >= :amount` 摺進 UPDATE 的 WHERE，配合行鎖原子判定；DB 端另有 `chk_wallets_balance` CHECK 當底線 | ✅ 更強（判定與扣款同一原子語句，無讀改寫窗） |
| `wallets.version` 樂觀鎖 | 每次扣款/補償 `version = version + 1`；其他寫入方（credit/gift/凍結）仍走 JPA `@Version`，撞到 debit 的版本遞增照樣 409 | ✅ 對其他寫入方不變 |
| 併發同鍵重複請求 | 舊：後到者 409（樂觀鎖）或 UNIQUE 違規回查；新：後到者直接回贏家結果（idempotent=true） | ⚠️ 形式變更、結果更好（客端少一次重試；帳面完全一致） |
| 併發異鍵爭餘額 | 舊：後到者 409 需重試或重讀後 402；新：行鎖序列化後守衛重評估，夠扣就成功、不夠 402 | ⚠️ 形式變更（debit 不再拋 ObjectOptimisticLockingFailureException）；game-service 無 409 特判，無呼叫端影響 |
| 交易邊界/傳播 | `@Transactional(postgresTransactionManager)` 不動；商城兌換 REQUIRED join 照舊 | ✅ |
| Kafka 事件 / 讀視圖 | 事件欄位、topic、best-effort 不動；發送時點改 afterCommit（見 §2 往返 2 說明） | ⚠️ 時點變更、更正確（不佔行鎖窗、無幽靈事件） |
| 冪等鍵跨玩家碰撞 | 舊：回贏家（他人）交易值、無聲；新：同樣回原交易值（相容），但 `log.error` 留痕可監控 | ✅ 加強可觀測性 |

## 4. H2 相容（雷區 3）

H2 2.2.224（含 MODE=PostgreSQL）不支援 `UPDATE ... RETURNING` 與 `ON CONFLICT ... RETURNING`
（已以 JDBC 實測確認），故 `WalletDebitDao` 依連線 metadata 分流方言、**流程邏輯共用**：

| 動作 | PostgreSQL（正式） | H2（單元/整合測試） |
|---|---|---|
| 條件扣款 | `UPDATE ... RETURNING balance` | `SELECT balance FROM FINAL TABLE (UPDATE ...)` |
| 流水寫入 | `INSERT ... ON CONFLICT DO NOTHING RETURNING id` | `SELECT id FROM FINAL TABLE (INSERT ...)` ＋捕捉 `DuplicateKeyException` |

PG 不能改用「INSERT 後捕捉 UNIQUE 違規」：PG 的約束違規會 abort 整筆交易（25P02），
ON CONFLICT 是唯一不炸交易的原子判定；H2 違規僅 statement 級，try/catch 等價。
真 PG 語法由 ADR-007 Testcontainers 測試守門（`-Pcontainers-test`）。

## 5. 驗證計畫

1. `mvn -pl backend/wallet-service test`（H2 全綠，含改寫後的 `WalletServiceDebitTest`）。
2. `mvn -pl backend/wallet-service test -Pcontainers-test`：既有冪等/超扣/樂觀鎖案例全綠＋
   新增 `WalletDebitRoundTripContainerTest`——「重放回原結果且只扣一次」「併發同鍵恰一筆流水、
   雙方拿到同一 transactionId」「併發異鍵不超扣」「餘額鏈連續」。
3. 150 併發對照重跑（驗收模式全綠、P99 對照 393ms）＋ T-091 對帳 0 新違規。

## 6. 明確不做

- `synchronous_commit=off` / batch commit（B1 已否決：帳務庫不可掉尾）。
- 不動 credit 路徑（Phase B2 範圍外；credit 無餘額守衛、風險收益比不同，另案評估）。
  ⚠️ code review 附帶發現：credit 既有的 `catch (DataIntegrityViolationException)` → 回查補救
  在真 PG 上**實際上救不回來**（UNIQUE 違規後交易已 abort（25P02），回查本身會再炸）——失效模式
  安全（500＋整筆回滾、不會重複入帳），但 Javadoc 宣稱的併發同鍵冪等回應在 PG 從未生效。
  另案處理 credit 時應比照本次 debit 的 ON CONFLICT 作法。
- 不動 `GiftTransferService`（雙錢包轉帳，語意不同）。
