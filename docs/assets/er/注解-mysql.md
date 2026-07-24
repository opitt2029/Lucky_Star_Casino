# `er-mysql.svg` 逐表註解 — 查詢讀庫（MySQL）

> 先讀 `注解-00-通用術語.md`。這張圖是 **CQRS 的「讀」端**（`ADR-001`）：放「查詢頻繁、可容忍最終一致」的資料——會員、好友、任務、簽到、商城目錄等。
>
> **為什麼查詢選 MySQL？** MySQL 在「大量並發讀」場景生態成熟、部署普遍。把讀壓力放這裡，就不會拖累 PostgreSQL 的帳務寫入。

共 12 張表。注意：**這裡的 `wallet_transactions` 是 PostgreSQL 的唯讀複本**，餘額查詢仍要回 PostgreSQL（見下）。

---

## A. 會員與社交（3 張）

### `members` — 玩家帳號主表
所有玩家的帳號資料。是全系統 `player_id` 的來源（`members.id` = 各服務的 player_id）。

| 欄位 | 型別 | 意思 |
|---|---|---|
| `id` **PK** | BIGINT | 玩家編號（AUTO_INCREMENT 自動遞增），**全系統的 player_id 就是它** |
| `username` **UNIQUE** | VARCHAR(50) | 登入帳號，不可重複 |
| `email` **UNIQUE** | VARCHAR(100) | 信箱，不可重複 |
| `password_hash` | VARCHAR(255) | 密碼的 BCrypt 雜湊（不存明碼） |
| `nickname` | VARCHAR(50) | 顯示暱稱 |
| `avatar` | TEXT | 頭像：可為 `https://` URL 或 `data:image/...;base64,...` |
| `role` | VARCHAR(20) | `PLAYER`(玩家) / `ADMIN` |
| `status` | VARCHAR(20) | `ACTIVE`(正常) / `DISABLED`(停權) |
| `is_new_gift_claimed` | TINYINT(1) | 新手贈幣是否已領（0/1） |
| `created_at` / `updated_at` | DATETIME | 建立 / 更新時間 |

**為什麼 `members.id` 要當「全系統 player_id」？**
微服務各有各的資料庫，wallet 的錢包、game 的對局、rank 的排行，都要指「哪個玩家」。統一用 `members.id` 當跨服務的邏輯身分證，大家對得起來。它不是資料庫外鍵（跨庫管不到），是**約定**。

**為什麼 `avatar` 用 TEXT 存 Base64？**
- 好處：頭像直接內嵌，不必另建檔案伺服器 / CDN，簡單。
- 壞處：Base64 讓資料膨脹約 33%，一張圖幾十 KB 塞進資料庫，行變大、查詢變慢。
- **更好的做法**：圖存物件儲存（如 S3 / MinIO），資料庫只存 URL。學習專案用 Base64 是「先簡單跑起來」的取捨，正式系統通常不這麼做。

**為什麼 `status` 只在這裡改就能「即時封鎖」？** 停權時除了寫這裡（持久），還會在 Redis 設即時封鎖旗標（見 CLAUDE.md 雷區 10）——資料庫記「長期狀態」、Redis 管「即時生效」，兩者配合。

### `friendships` — 好友關係表
| 欄位 | 意思 |
|---|---|
| `requester_id` / `receiver_id` | 發起申請 / 接收申請的玩家 |
| `status` | `PENDING`(待確認) / `ACCEPTED`(已接受) / `REJECTED`(已拒絕) |
| `version` | 樂觀鎖，防「同時按接受和拒絕」的競態 |
| `UNIQUE(requester_id, receiver_id)` | 防重複申請 |
| `CHECK(requester_id <> receiver_id)` | 防加自己為好友 |

**為什麼一段好友關係只存一列（不是雙向各一列）？**
用「誰發起、誰接收」的方向存一列，省一半空間。代價是查「我的所有好友」要同時查「我當 requester」和「我當 receiver」兩種情況（所以 `receiver_id` 另建了索引）。這是**空間 vs 查詢複雜度**的取捨。

**`CHECK(requester_id <> receiver_id)` 為什麼重要？** 在資料庫層擋掉「加自己為好友」這種髒資料，不依賴程式記得檢查。多一道保險。

### `gift_logs` — 好友贈幣紀錄
| 欄位 | 意思 |
|---|---|
| `sender_id` / `receiver_id` | 送 / 收的玩家 |
| `amount` | 贈送星幣數，`CHECK(> 0)` |

**為什麼贈幣紀錄在 MySQL，但實際扣加錢在 PostgreSQL？** 這裡的 `gift_logs` 是「社交行為的歷史紀錄」（誰送誰、查得到就好），屬讀庫；真正動到餘額的帳務走 PostgreSQL 的 `wallet_transactions`。**「社交事件」和「錢的異動」職責分離**。每日贈送限額則靠 Redis 即時限流（資料庫紀錄 + Redis 限流的組合拳）。

---

## B. 任務與簽到（4 張）

### `task_definitions` — 任務定義（模板）
GM 預先設定的任務模板。

| 欄位 | 意思 |
|---|---|
| `task_code` **UNIQUE** | 任務代碼（程式引用用） |
| `task_name` | 任務名稱（顯示用） |
| `task_type` | `FIRST_LOGIN`(首次登入) / `DAILY_CHECKIN`(每日簽到) / `BET_COUNT`(下注次數) / `INVITE_FRIEND`(邀請好友) |
| `reward_amount` | 完成獎勵星幣數 |
| `target_count` | 需達成幾次才算完成 |
| `is_active` | 是否啟用 |

### `player_tasks` — 玩家任務進度
| 欄位 | 意思 |
|---|---|
| `player_id` / `task_id` | 哪位玩家 / 哪個任務 |
| `progress` | 目前進度（如下注 3/5 次） |
| `is_completed` / `completed_at` | 是否完成 / 完成時間 |
| `UNIQUE(player_id, task_id)` | 每人每任務只有一列進度 |

**為什麼把任務拆成「定義表」和「進度表」兩張？**
這是經典的「**模板 vs 實例**」設計：
- `task_definitions` = 任務長什麼樣（一種任務一列，所有玩家共用）。
- `player_tasks` = 每個玩家做到哪（一人一任務一列）。

如果不拆，把任務名稱、獎勵直接抄進每個玩家的進度列，就會有「一萬個玩家 = 任務名稱重複存一萬份」的問題，且 GM 改任務獎勵要改一萬列。拆開後改模板只動一列。這叫**正規化（normalization）**，避免重複資料。

`player_tasks` 用 `task_id`（FK 概念）指向 `task_definitions.id`，兩表靠這個連起來——這正是 ER 圖裡「線」的意義。

### `daily_checkins` — 每日簽到紀錄
| 欄位 | 意思 |
|---|---|
| `player_id` / `checkin_date` | 誰、哪天簽到 |
| `consecutive_days` | 連續簽到天數 |
| `UNIQUE(player_id, checkin_date)` | 防同日重複簽到 |

**`UNIQUE(player_id, checkin_date)` 怎麼防重複簽到？** 就算玩家連點簽到按鈕、或前端送兩次請求，第二筆「同一人同一天」撞唯一鍵被資料庫擋掉。**用資料庫約束保證業務規則**，比只靠程式判斷可靠。

### `monthly_reward_claims` — 月度累計簽到大獎領取
| 欄位 | 意思 |
|---|---|
| `reward_month` | 月份，格式 `yyyy-MM`（台北時區） |
| `milestone_days` | 累計天數里程碑：`10` / `20` / `28` |
| `reward_amount` | 獎勵星幣數 |
| `UNIQUE(player_id, reward_month, milestone_days)` | 防同一里程碑重複領 |

**冷知識**：欄位叫 `reward_month` 而非直覺的 `year_month`，是因為 `YEAR_MONTH` 是 MySQL 保留關鍵字，用它當欄名要一直加反引號跳脫，麻煩。**避開資料庫保留字**是實務小技巧。

**「連續」簽到 vs「累計」簽到**：`daily_checkins.consecutive_days` 追蹤「連續」（斷一天歸零）；`monthly_reward_claims` 是「當月累計」（總天數，斷了也算）。兩種獎勵機制並存。

---

## C. 商城與鑽石（2 張）

### `shop_items` — 禮品商城目錄
商城賣什麼的「正本目錄」（`ADR-006`）。admin 後台維護、wallet 服務讀來列目錄 / 驗價。

| 欄位 | 意思 |
|---|---|
| `item_code` **UNIQUE** | 商品代號（前端 / 兌換對應鍵） |
| `name` / `caption` | 名稱 / 說明 |
| `cost_star` | 兌換成本（星幣），`CHECK(> 0)` |
| `asset_key` | 前端圖片資產鍵（如 `shopPrizeA`） |
| `sort_order` | 顯示順序（小者在前） |
| `active` | 上架 1 / 下架 0 |

**為什麼商城「目錄」在 MySQL，但「兌換扣款」在 PostgreSQL？**
- 目錄是「大家一直讀、偶爾由 admin 改」的資料 → 讀庫 MySQL。
- 兌換要扣星幣，是帳務 → 寫庫 PostgreSQL 的 `shop_redemptions` + `wallet_transactions`。

所以一次兌換會**跨兩個庫**：先讀 MySQL 目錄驗價，再到 PostgreSQL 扣款。這也是 cross-db 圖上「`item_code 驗價後兌換`」那條線的意思。

> 注意 CLAUDE.md 雷區 20 提醒：因為目錄在 MySQL、扣款在 PostgreSQL，程式讀目錄要用獨立的 MySQL 交易，不能混進 PostgreSQL 交易方法裡。

### `diamond_cards` — 鑽石點數卡（序號卡）
後台批量產生序號，玩家輸入序號兌換鑽石。

| 欄位 | 意思 |
|---|---|
| `card_code` **UNIQUE** | 序號，格式 `XXXX-XXXX-XXXX-XXXX` |
| `face_value` | 面額（兌換可得鑽石數） |
| `is_redeemed` | 是否已兌換（0/1） |
| `redeemed_by` / `redeemed_at` | 兌換玩家 / 時間（未兌換為 NULL） |

**`card_code` UNIQUE + `is_redeemed` 旗標怎麼防「一張序號兌換兩次」？**
- `UNIQUE(card_code)`：同一序號在表裡只有一列。
- 兌換時用「條件更新」：`UPDATE ... SET is_redeemed=1 WHERE card_code=? AND is_redeemed=0`。只有「還沒兌換」時這句才會真的改到列（回傳影響 1 列）；若已被別人搶先兌換，`is_redeemed` 已是 1，這句改到 0 列 → 兌換失敗。**用「條件更新的影響列數」判斷搶贏搶輸**，這是防併發重複兌換的常見技巧。

**為什麼未兌換的 `redeemed_by` 是 NULL？** NULL 代表「還沒發生」。用 NULL 而非 0 或空字串，語意清楚：0 可能被誤會成「玩家編號 0」。**NULL 專門表達「無此值 / 尚未發生」**。

---

## D. 讀庫複本與基礎設施（3 張）

### `wallet_transactions`（讀庫複本）— ⚠️ 特別注意
這張跟 PostgreSQL 那張**同名，但角色完全不同**。

| 欄位 | 意思 |
|---|---|
| `id` **PK** | **與 PostgreSQL 主庫 id 一致**（不是自己 AUTO_INCREMENT，是抄來的） |
| 其餘欄位 | 與 PostgreSQL 版一樣 |
| `idempotency_key` | 有這欄，但**不設 UNIQUE**（唯讀複本不需要防重複） |

**為什麼要複製一份到 MySQL？** 玩家查「我的交易明細」（分頁翻歷史）是高頻讀，放讀庫扛。真正的帳務正本、餘額計算在 PostgreSQL。

**為什麼 `idempotency_key` 不設 UNIQUE？** 冪等防重複是「寫入」時的事，發生在 PostgreSQL 正本那端。這裡只是唯讀複本，資料是同步過來的、不會由此新增帳務，所以不需要這個約束。

**⚠️ 最重要的一句**：**查餘額請直接查 PostgreSQL，不要查這張。** 因為這是最終一致的複本，可能比正本慢零點幾秒。明細可以晚一點，餘額不行。

### `outbox_events` — MySQL 端的 Transactional Outbox
和 PostgreSQL 的 `wallet_outbox` 同機制（詳見 cross-db 註解），是 member 等服務發事件用的暫存箱。

| 欄位 | 意思 |
|---|---|
| `topic` / `kafka_key` / `payload` | 發到哪、key、內容 |
| `status` | `PENDING` / `SENT` |
| `retry_count` | 投遞失敗次數 |

### `system_health_check` — 服務健康檢查
| 欄位 | 意思 |
|---|---|
| `service_name` | 哪個服務 |
| `status` | 狀態字串 |
| `checked_at` | 檢查時間 |

各服務可寫入自身存活狀態，屬基礎設施表。

---

## 🔧 這張圖整體的設計哲學（新手視角總結）

1. **這裡放「查得多、改得少、可容忍晚一點」的資料**：會員、好友、任務、目錄。跟 PostgreSQL 的「帳務、要求即時正確」剛好互補。
2. **模板 / 實例分離**：`task_definitions` ↔ `player_tasks` 是正規化避免重複的範例。
3. **唯一鍵擋髒資料**：同日簽到、重複申請好友、重複領月獎、重複兌換序號，全靠複合 UNIQUE 在資料庫層擋。
4. **同名不同命**：`wallet_transactions` 在兩個庫都有，PostgreSQL 是正本、MySQL 是唯讀複本。理解「同一份資料在 CQRS 兩端扮演不同角色」是關鍵。

**如果要我挑「還能更好」的三點：**
- `members.avatar` 用 Base64 塞資料庫，正式系統應改存物件儲存 + URL。
- 商城 seed 資料用十六進位 Bytes 塞中文（`_utf8mb4 0x...`），是為了繞過容器編碼雷（見檔頭註解），可讀性差；正式做法是確保 client 編碼正確後直接寫中文。
- MySQL 8 才支援 CHECK 約束「真正生效」（舊版只解析不執行）。若部署到舊版 MySQL，這些 `CHECK` 會靜默失效——要確認版本，別以為約束一定有在擋。

整體而言，這是一張「讀寫分離、職責清楚、用約束防呆」的查詢庫設計，配合 PostgreSQL 寫庫，構成完整的 CQRS 架構。
