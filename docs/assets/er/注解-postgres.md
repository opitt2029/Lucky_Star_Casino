# `er-postgres.svg` 逐表註解 — 帳務寫庫（PostgreSQL）

> 先讀 `注解-00-通用術語.md`。這張圖是 **CQRS 的「寫」端**（`ADR-001`）：所有會改動星幣 / 鑽石的操作都在這裡發生，要求最高一致性（強 ACID）。
>
> **為什麼帳務選 PostgreSQL？** 它對交易（transaction）、CHECK 約束、部分索引（partial index）等一致性工具支援成熟，適合「錢絕不能算錯」的場景。

共 16 張表，依用途分五組：**錢包核心 / 遊戲 / 加值與返利 / 排行 / 後台與可靠性**。

---

## A. 錢包核心（4 張）

### `wallets` — 玩家星幣錢包主表
每位玩家一列，記錄目前餘額。

| 欄位 | 型別 | 意思 |
|---|---|---|
| `player_id` **PK** | BIGINT | 玩家編號，同時是主鍵（一人一個錢包） |
| `balance` | BIGINT | 可用餘額，有 `CHECK (>= 0)` 保證永不為負 |
| `frozen_amount` | BIGINT | 凍結金額（保留欄位，目前未真正使用） |
| `version` | BIGINT | 樂觀鎖版本號，每次更新 +1 |
| `created_at` / `updated_at` | TIMESTAMP | 建立 / 更新時間 |

**為什麼這樣設計？**
- **用 `player_id` 當主鍵**（而非另設 `id`）：一位玩家就只有一個錢包，玩家編號本身就是天然唯一鍵，省一個欄位也省一個索引。
- **餘額只存「一個數字」，不存每筆加總**：真正的每筆異動記在 `wallet_transactions`。這裡的 `balance` 是「快取後的目前值」，查餘額不必每次把幾萬筆流水加起來。
- **`CHECK (balance >= 0)`**：在資料庫層再擋一次超扣，就算程式有 bug 也不會出現負餘額。這是「多一道防線」的縱深防禦。
- **`version` 樂觀鎖**：防止兩筆下注同時扣款導致超扣（見通用術語）。

**還能更好嗎？**
- `frozen_amount` 目前是保留欄位、沒真正用到。設計上「先留欄位」有好處（未來加功能不用改 schema），但也可能變成「永遠用不到的欄位」。取捨：新手階段建議**用到再加**，避免揣測未來。
- 餘額和流水分離會有「兩者對不上」的風險（例如流水加總 ≠ balance）。成熟系統會定期跑對帳；本專案也有 `tools/reconciliation/`。

### `wallet_transactions` — 帳務流水（不可變紀錄）
每一筆星幣異動留一列，只增不改（append-only）。

| 欄位 | 意思 |
|---|---|
| `id` **PK** | 流水編號（BIGSERIAL 自動遞增） |
| `player_id` | 哪位玩家 |
| `type` | 大分類：`DEBIT`（扣款）/ `CREDIT`（入帳）/ `BONUS`（贈送） |
| `sub_type` | 細分類：`BET`(下注) / `WIN`(贏) / `CHECKIN`(簽到) / `TASK`(任務) / `GIFT`(禮物) / `GM_REWARD`(GM發幣) / `TOPUP`(加值) / `CASHBACK`(返利) / `REFUND`(退款) / `MONTHLY_REWARD` / `SHOP_PURCHASE`(商城) 等 |
| `amount` | 金額，`CHECK (> 0)`（正負由 type 表示，金額本身恆正） |
| `balance_before` / `balance_after` | 這筆前後的餘額（稽核用，能還原當下狀態） |
| `idempotency_key` **UNIQUE** | 冪等鍵，防同一筆重複入帳 |
| `reference_id` | 關聯來源，如遊戲的 `round_id`、事件 id |
| `created_at` | 發生時間 |

**為什麼這樣設計？**
- **不可變（append-only）**：帳務永遠只新增、不修改不刪除。要「改」餘額？就再記一筆反向流水。這樣任何時刻都能重播全部流水還原真相，稽核與除錯都靠它。這是會計「借貸記帳」的思維。
- **`type` + `sub_type` 兩層分類**：`type` 給程式判斷加減錢，`sub_type` 給業務分析（例如「這個月簽到發了多少」）。分兩層是為了「粗判斷」和「細報表」各取所需。
- **`balance_before/after` 存快照**：雖然理論上可由前面流水推算，但直接存下來，稽核時一眼就看到「這筆前後餘額」，不必回溯計算。這是**刻意的反正規化**換稽核便利。
- **索引 `(player_id, created_at DESC)`**：查「某玩家最近的交易」是最常見查詢，這個複合索引讓它很快。

**還能更好嗎？**
- `sub_type` 用字串 + CHECK 白名單，好處是直覺、壞處是每加一種子型要改四個地方（見 CLAUDE.md 雷區 18）。替代方案是獨立「交易類型表」用 FK，但那樣 join 變多。專案選了字串，是「簡單直覺」優先的取捨。
- 這張表會無限成長。真實系統會做**分區（partitioning）**（按月切表）或冷資料歸檔，否則幾年後查詢會慢。學習階段知道有這回事即可。

### `wallet_outbox` — 待發 Kafka 事件暫存箱
Transactional Outbox 的核心表（詳見 `注解-cross-db-cqrs.md`）。

| 欄位 | 意思 |
|---|---|
| `id` **PK** | 事件編號 |
| `topic` | 要發到哪個 Kafka 主題：`wallet.credit` / `wallet.debit` |
| `kafka_key` | 訊息的 key（通常是 playerId，決定分區） |
| `payload` | 事件內容（JSON 字串） |
| `status` | `PENDING`（待送）/ `SENT`（已送達） |
| `retry_count` | 投遞失敗次數（給監控告警看） |
| `sent_at` | 送達時間 |

**為什麼這樣設計？** 把「要發的事件」和「改錢」寫進同一交易，杜絕事件無聲丟失。這是分散式系統經典 pattern，本專案最重要的設計之一。細節見 cross-db 註解。

### `diamond_wallets` — 玩家鑽石錢包
和星幣錢包平行的另一套貨幣（鑽石＝點數卡兌換的硬通貨）。

| 欄位 | 意思 |
|---|---|
| `player_id` **PK** | 玩家編號 |
| `balance` | 鑽石餘額，`CHECK (>= 0)` |
| `version` | 樂觀鎖 |

**為什麼跟星幣分開存兩張表，不合成一張「多幣種錢包」？**
- 兩種貨幣規則不同：星幣有下注 / 凍結概念，鑽石沒有（所以這張表**沒有** `frozen_amount`）。
- 分開讓各自的約束、查詢、演進互不干擾。合成一張要多一個「幣別」欄位，每次查詢都要 `WHERE currency=...`，反而更囉唆。
- **取捨**：如果未來要支援十種貨幣，這種「一幣一表」就會爆炸，那時才該改成「錢包表 + 幣別欄位」的通用設計。目前只有兩種，分開最清楚。

---

## B. 遊戲（3 張）

### `game_rounds` — 遊戲對局紀錄
每一局（老虎機轉一次、百家樂一局、捕魚一個 session）記一列。

| 欄位 | 意思 |
|---|---|
| `id` **PK** / `round_id` **UNIQUE** | 內部主鍵 / 對外的 UUID 識別碼 |
| `game_type` | `SLOT`(老虎機) / `BACCARAT`(百家樂) / `FISHING`(捕魚) |
| `bet_amount` / `win_amount` | 下注額 / 派彩額（**含本金**） |
| `balance_before` / `balance_after` | 對局前後餘額（稽核） |
| `bet_at` / `settled_at` | 下注時間 / 結算時間 |
| `server_seed` | 伺服器種子，**開獎後才揭露** |
| `server_seed_hash` | 種子的雜湊，**下注前先公開** |
| `client_seed` | 玩家提供的種子 |
| `nonce` | 本局遞增序號 |
| `result_data` | 遊戲結果（JSON 字串） |
| `status` | `STARTED`(開始) / `SETTLED`(已結算) |

**為什麼要存那四個 seed 欄位？** 這是 **Provably Fair（可證明公平）** 機制：
1. 下注前，伺服器先公布 `server_seed_hash`（種子的指紋，但看不出種子本身）。
2. 開獎用 `SHA-256(server_seed + client_seed + nonce)` 算結果。
3. 開獎後公布 `server_seed`，玩家可自己算雜湊比對「指紋一致」，證明伺服器沒有事後偷改種子作弊。

> **設計亮點**：玩家帶入自己的 `client_seed`，所以連玩家自己都無法預測結果，但事後人人可驗證。這是線上賭場建立信任的標準做法。

**為什麼 `win_amount` 是「含本金」？** 這會影響風控 RTP 計算（見 CLAUDE.md 雷區 17）。含本金的意思是「押 100 贏了拿回 200，`win_amount` 記 200 而非淨賺 100」。設計上要全系統統一口徑，否則 RTP 會算錯。

**還能更好嗎？**
- `result_data` 存 JSON 字串（TEXT）。好處是彈性（不同遊戲結果結構不同）；壞處是資料庫無法對裡面欄位查詢 / 建索引。PostgreSQL 其實有原生 `JSONB` 型別可查可索引，是更好的選擇——這裡用 TEXT 是簡化。
- 用了 **partial index**（`WHERE status = 'SETTLED'`）只索引已結算的局，體積更小、風控查詢更快。這是很專業的優化，值得學。

### `game_rtp_stats` — RTP 統計彙總
排程每小時算一次各遊戲的回報率，供後台監控。

| 欄位 | 意思 |
|---|---|
| `game_type` | 哪款遊戲 |
| `total_bet` / `total_win` | 累計下注 / 累計派彩 |
| `round_count` | 局數 |
| `calculated_at` | 這筆是何時算的 |

**為什麼要一張「彙總表」，不即時算？** RTP = total_win / total_bet，若每次後台要看就即時掃幾百萬筆 `game_rounds` 加總，太慢。改成排程「每小時預先算好存起來」，後台查這張小表秒回。這叫**預聚合（pre-aggregation）**，用「稍微不即時」換「查詢很快」。

### `pending_wallet_credits` — game→wallet 補償單（Saga 補償）
遊戲要幫玩家入帳（派彩 / 退款）但呼叫 wallet 失敗時，落地成一張「待補款單」，排程重試。

| 欄位 | 意思 |
|---|---|
| `game_type` / `round_id` / `player_id` | 哪局、哪個玩家欠付 |
| `amount` | 欠付金額 |
| `sub_type` | `WIN`(該贏的派彩) / `REFUND`(該退的退款) |
| `idempotency_key` **UNIQUE** | **與原始呼叫完全相同的冪等鍵**（絕不可換，換了會重複入帳） |
| `status` | `PENDING` / `DONE` / `FAILED` |
| `retry_count` / `last_error` | 重試次數 / 最近失敗原因 |
| `next_retry_at` | 下次重試時間（**指數退避**：越失敗等越久） |

**為什麼需要這張表？** 跨服務呼叫（game 打 wallet）可能因網路 / 對方當機而失敗。玩家已經贏了，錢卻沒入帳——不能就這樣算了。作法：把「欠款」記下來，背景排程反覆重試直到成功。這是 **Saga 補償** 模式（`ADR-009`）。

**指數退避（exponential backoff）是什麼？** 失敗後不要瘋狂重試（會打爆對方），而是等 1 秒、2 秒、4 秒、8 秒…越等越久，給對方喘息時間。`next_retry_at` 就是記「下次什麼時候能重試」。

---

## C. 加值與返利（2 張）

### `topup_orders` — 加值訂單（模擬支付，無真金流）
| 欄位 | 意思 |
|---|---|
| `order_no` **UNIQUE** | 訂單編號（同時當入帳的冪等鍵） |
| `package_id` | 方案代號（`P100` / `P500` / `P1000`） |
| `amount` | 入帳星幣數 |
| `price_label` | 顯示售價（如 `NT$100`，純顯示用） |
| `status` | `CREATED`(建單) → `PAID`(付款) → `CREDITED`(入帳)；失敗 `FAILED` |
| `credit_tx_id` | 入帳成功後回填的 `wallet_transactions.id` |

**為什麼 status 要分這麼多階段？** 付款是多步驟流程，任何一步可能中斷。分階段記錄，就能知道「這筆卡在哪」——建單了沒付？付了沒入帳？重啟後排程能接續處理。這叫**狀態機（state machine）**，訂單類系統的標配。

### `cashback_records` — 虧損返利紀錄（防重複發放）
每日 / 每週把玩家的淨虧損按比例返還一部分。

| 欄位 | 意思 |
|---|---|
| `period_type` | `DAILY`(日返) / `WEEKLY`(週返) |
| `period_start` | 計算期間起始（日返=昨日、週返=上週一） |
| `loss_amount` | 該期淨虧損 |
| `cashback_rate` | 返利率（NUMERIC，如 0.0500 = 5%） |
| `cashback_amount` | 實際返還（`floor(loss × rate)`） |
| `idempotency_key` **UNIQUE** + `UNIQUE(player, period_type, period_start)` | 雙重防重複 |

**為什麼要 `UNIQUE(player, period_type, period_start)`？** 排程可能因重啟而重跑。這個複合唯一鍵保證「同一玩家、同一天的日返」只會有一列——就算排程跑兩次，第二次撞 UNIQUE 被擋，不會重複發錢。這是「用資料庫約束保證業務規則」的漂亮例子。

**為什麼返利率用 `NUMERIC` 而餘額用 `BIGINT`？** 費率是「比例」需要小數（0.05），且不涉及累加誤差問題，用精確小數 NUMERIC 剛好；金額是「錢」，用整數避免浮點誤差。**同一張表兩種數字用兩種型別，各取所需**。

---

## D. 排行（2 張）

### `rank_history` — 週排行榜歷史快照
每週重置排行前，先把 TOP N 名單存檔。

| 欄位 | 意思 |
|---|---|
| `player_id` / `nickname` / `balance` | 玩家 / 暱稱 / 當時餘額 |
| `rank` | 名次 |
| `week_start` | 該週起始日（週一） |

### `rank_daily_snapshots` — 每日持幣量快照
| 欄位 | 意思 |
|---|---|
| `player_id` / `balance` | 玩家 / 當日餘額 |
| `snapshot_date` + `UNIQUE(player, snapshot_date)` | 快照日期，同人同日唯一 |

**為什麼排行榜要「拍快照」存資料庫？** 即時排行榜其實跑在 **Redis**（有序集合 sorted set，天生擅長排名）。但 Redis 是記憶體資料，重啟可能沒了，也不適合存歷史。所以「當下用 Redis 算、定期拍快照落 PostgreSQL 存歷史」——**各用所長**：Redis 管即時、PostgreSQL 管歷史。

**為什麼存了 `nickname`（暱稱）？** 暱稱正本在 MySQL 的 `members` 表。這裡「順手抄一份」是**反正規化**：查歷史排行時不必再跨庫去 members 查名字。代價是「玩家改名後，歷史快照裡還是舊名」——但歷史快照本來就是「當時的樣子」，舊名反而正確。

---

## E. 後台與可靠性（3 張）

### `admin_users` — 後台管理員帳號
| 欄位 | 意思 |
|---|---|
| `username` **UNIQUE** | 管理員帳號 |
| `password_hash` | 密碼的 **BCrypt** 雜湊（不存明碼） |
| `role` | `SUPER_ADMIN`(超管) / `OPERATOR`(操作員) |
| `enabled` | 是否啟用 |

**為什麼管理員和玩家帳號完全分兩張表、兩套 JWT？** 安全隔離：玩家的 token 就算外洩，也絕對碰不到後台。玩家在 MySQL 的 `members`、管理員在 PostgreSQL 的 `admin_users`，簽 token 用不同 secret（見 CLAUDE.md 雷區 21）。這是「權限分離」的基本功。

**什麼是 BCrypt？為什麼不存明碼？** 密碼絕不能存原文（資料庫外洩就全裸）。BCrypt 是專門為存密碼設計的**單向雜湊**：能驗證「你輸入的密碼對不對」，但無法從雜湊反推原密碼，而且故意算得慢（讓暴力破解變貴）。

### `admin_action_logs` — 後台敏感操作稽核
| 欄位 | 意思 |
|---|---|
| `operator` | 操作者（哪個管理員） |
| `action_type` | 操作類型（如 `GM_GRANT` GM發幣） |
| `target_player_id` / `amount` / `reason` | 對誰、多少、為什麼 |
| `idempotency_key` **UNIQUE** | 兼作去重鍵 + 發幣指令的冪等鍵 |

**為什麼要稽核 log？** 後台能直接發幣、封帳號，權力很大。每個敏感操作留痕（誰、何時、對誰做了什麼），才能事後追責、防內部作弊。金融 / 賭場類系統這是硬需求。

### `admin_alerts` — 異常告警紀錄
| 欄位 | 意思 |
|---|---|
| `alert_type` | `BIG_WIN`(大額贏) / `HIGH_FREQUENCY`(高頻下注) / `ABNORMAL_TRANSFER`(異常轉帳) |
| `detail` | 詳情 |
| `is_resolved` / `resolved_by` / `resolved_at` | 是否已處理 / 處理人 / 處理時間 |

**為什麼要風控告警？** 自動偵測可疑行為（可能是外掛、洗錢、系統 bug），生成告警讓管理員人工複查。`is_resolved` 讓告警有「待辦 → 已處理」的工作流。

### `dead_letter_messages` — Kafka 死信佇列（DLT）
消費 Kafka 訊息重試 3 次仍失敗的，落到這張表。

| 欄位 | 意思 |
|---|---|
| `dlt_topic` / `original_topic` | 死信主題 / 原始主題 |
| `payload` | 原訊息內容 |
| `exception_class` / `failure_reason` / `stack_trace` | 失敗的例外類別 / 原因 / 完整堆疊 |
| `status` | `FAILED`(待處理) / `RETRIED`(已重試) / `RESOLVED`(已解決) |

**什麼是死信佇列（Dead Letter Queue）？** 有些 Kafka 訊息怎麼處理都失敗（資料壞了、下游一直掛）。不能無限重試卡住整條佇列，也不能默默丟掉。作法：重試幾次仍失敗就把它「請出主流程、丟進死信區」，記下完整錯誤資訊，讓後台人工查明再決定重試或放棄。這是訊息系統的「疑難雜症收容所」。

---

## 🔧 這張圖整體的設計哲學（新手視角總結）

1. **帳務只增不改**：`wallet_transactions` append-only、餘額另存快取。任何時刻可重播還原真相。
2. **到處是冪等鍵**：因為 Kafka 是 at-least-once、網路會重試，所有寫入都要能「重複收到也只算一次」。
3. **多道防線**：程式擋一次、資料庫 CHECK 再擋一次、樂觀鎖防併發。錢的事寧可囉唆。
4. **可靠性有專屬表**：outbox（不丟事件）、pending_credits（不漏付）、dead_letter（不吞錯誤）、action_logs（可追責）。這些「非功能性」的表，正是把玩具專案和正式系統區分開的地方。

**如果要我挑「還能更好」的三點：**
- `result_data` 從 TEXT 改成 `JSONB`，換來可查詢 / 可索引。
- `wallet_transactions` 未來按月分區，應付長期成長。
- `frozen_amount` 這種「保留但沒用」的欄位，學習階段建議用到再加，避免揣測未來。

但整體而言，這是一張「正確性優先、防禦周全」的成熟帳務設計，很值得逐表細讀學習。
