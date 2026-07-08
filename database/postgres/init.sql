-- ============================================================
-- 幸運星幣城 — PostgreSQL 初始化 Schema
-- 用途：帳務核心寫入主庫（高一致性需求，強 ACID）
-- 對應 ADR-001：PostgreSQL 作為 CQRS 寫入端
-- ============================================================

-- -------------------------------------------------------
-- wallets：玩家錢包主表
-- 儲存每位玩家的星幣餘額、凍結金額與樂觀鎖版本號
-- version 欄位用於防止高併發下注時的超扣問題（T-022）
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
    player_id      BIGINT      NOT NULL,
    balance        BIGINT      NOT NULL DEFAULT 0,        -- 可用餘額（單位：星幣，整數，無小數）
    frozen_amount  BIGINT      NOT NULL DEFAULT 0,        -- 凍結金額（保留欄位，預留未來擴展）
    version        BIGINT      NOT NULL DEFAULT 0,        -- 樂觀鎖版本號，每次更新 +1
    created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_wallets PRIMARY KEY (player_id),
    CONSTRAINT chk_wallets_balance        CHECK (balance >= 0),
    CONSTRAINT chk_wallets_frozen_amount  CHECK (frozen_amount >= 0)
);

-- -------------------------------------------------------
-- wallet_transactions：帳務流水（寫入端）
-- 每一筆星幣異動都在此留下不可變紀錄
-- idempotency_key 確保同一事件不重複入帳（冪等設計）
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id               BIGSERIAL    NOT NULL,
    player_id        BIGINT       NOT NULL,
    type             VARCHAR(10)  NOT NULL,   -- DEBIT / CREDIT / BONUS
    sub_type         VARCHAR(20)  NOT NULL,   -- BET / WIN / CHECKIN / TASK / GIFT / GM_REWARD / BANKRUPTCY_AID / DIAMOND_EXCHANGE / TOPUP / CASHBACK / REFUND
    amount           BIGINT       NOT NULL,
    balance_before   BIGINT,
    balance_after    BIGINT,
    idempotency_key  VARCHAR(100) UNIQUE,     -- 冪等鍵，防止重複處理
    reference_id     VARCHAR(100),            -- 關聯 ID（如 round_id、event_id）
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_wallet_transactions PRIMARY KEY (id),
    CONSTRAINT chk_wt_type     CHECK (type    IN ('DEBIT', 'CREDIT', 'BONUS')),
    CONSTRAINT chk_wt_sub_type CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD', 'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP', 'CASHBACK', 'REFUND', 'MONTHLY_REWARD', 'SHOP_PURCHASE')),
    CONSTRAINT chk_wt_amount   CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_player_id   ON wallet_transactions (player_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at  ON wallet_transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_player_time ON wallet_transactions (player_id, created_at DESC);

-- -------------------------------------------------------
-- shop_redemptions：禮品商城兌換紀錄（帳務寫端，ADR-006）
-- 每筆＝某玩家兌換某商品一次，與星幣扣款（sub_type=SHOP_PURCHASE）同一交易原子寫入。
-- 為帳務真相＋玩家背包來源；目錄 shop_items 在 MySQL（admin 管理）。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_redemptions (
    id               BIGSERIAL    NOT NULL,
    player_id        BIGINT       NOT NULL,
    item_code        VARCHAR(50)  NOT NULL,
    item_name        VARCHAR(100) NOT NULL,
    star_spent       BIGINT       NOT NULL,
    balance_before   BIGINT,
    balance_after    BIGINT,
    idempotency_key  VARCHAR(100) UNIQUE,
    status           VARCHAR(20)  NOT NULL DEFAULT 'COMPLETED',
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_shop_redemptions    PRIMARY KEY (id),
    CONSTRAINT chk_shop_star_positive CHECK (star_spent > 0),
    CONSTRAINT chk_shop_status        CHECK (status IN ('COMPLETED', 'PENDING', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_shop_redemptions_player_time ON shop_redemptions (player_id, created_at DESC);

-- -------------------------------------------------------
-- topup_orders：玩家自助加值訂單（模擬支付，無真實金流）
-- 流程：CREATED（建單）→ PAID（模擬付款）→ CREDITED（星幣已入帳）；失敗為 FAILED
-- 付款成功後以 order_no 當冪等鍵呼叫 WalletService.credit() 真實入帳，credit_tx_id 記入帳流水 id
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS topup_orders (
    id            BIGSERIAL    NOT NULL,
    order_no      VARCHAR(40)  NOT NULL,            -- 訂單編號（冪等鍵來源）
    player_id     BIGINT       NOT NULL,
    package_id    VARCHAR(20)  NOT NULL,            -- 方案代號（如 P100 / P500 / P1000）
    amount        BIGINT       NOT NULL,            -- 入帳星幣數
    price_label   VARCHAR(20)  NOT NULL,            -- 顯示用售價（如 NT$100）
    status        VARCHAR(20)  NOT NULL DEFAULT 'CREATED',
    credit_tx_id  BIGINT,                           -- 入帳成功後的 wallet_transactions.id
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at       TIMESTAMP,
    CONSTRAINT pk_topup_orders        PRIMARY KEY (id),
    CONSTRAINT uq_topup_orders_no     UNIQUE (order_no),
    CONSTRAINT chk_topup_amount       CHECK (amount > 0),
    CONSTRAINT chk_topup_status       CHECK (status IN ('CREATED', 'PAID', 'CREDITED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_topup_orders_player_time ON topup_orders (player_id, created_at DESC);

-- -------------------------------------------------------
-- game_rounds：遊戲對局紀錄
-- 記錄每一局的下注、結果與 Provably Fair 所需的種子資訊
-- SHA-256(serverSeed + clientSeed + nonce) 可由玩家事後驗證公平性
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_rounds (
    id               BIGSERIAL    NOT NULL,
    round_id         VARCHAR(100) NOT NULL,   -- UUID，對外唯一識別碼
    player_id        BIGINT       NOT NULL,
    game_type        VARCHAR(20)  NOT NULL,   -- SLOT / BACCARAT / FISHING
    bet_amount       BIGINT,
    win_amount       BIGINT,
    balance_before   BIGINT,                  -- 投注前錢包餘額（稽核：餘額變化）
    balance_after    BIGINT,                  -- 派彩後錢包餘額（稽核：餘額變化）
    bet_at           TIMESTAMP,               -- 下注時間（毫秒精度；與 settled_at 派彩時間區分）
    server_seed      VARCHAR(255),            -- 開獎後才揭露（Provably Fair）
    server_seed_hash VARCHAR(255),            -- 下注前先公開此雜湊值
    client_seed      VARCHAR(255),            -- 玩家提供的種子
    nonce            BIGINT,                  -- 本局遞增序號
    result_data      TEXT,                    -- 遊戲結果 JSON 字串
    status           VARCHAR(20)  NOT NULL DEFAULT 'STARTED',  -- STARTED / SETTLED
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    settled_at       TIMESTAMP,
    CONSTRAINT pk_game_rounds   PRIMARY KEY (id),
    CONSTRAINT uq_game_round_id UNIQUE (round_id),
    CONSTRAINT chk_gr_game_type CHECK (game_type IN ('SLOT', 'BACCARAT', 'FISHING')),
    CONSTRAINT chk_gr_status    CHECK (status    IN ('STARTED', 'SETTLED'))
);

CREATE INDEX IF NOT EXISTS idx_game_rounds_player_id  ON game_rounds (player_id);
CREATE INDEX IF NOT EXISTS idx_game_rounds_created_at ON game_rounds (created_at);

-- 風控聚合查詢的複合索引（V15，T-090 Phase A3）：兩者皆只掃已結算對局，用 partial index 縮小體積。
-- idx_game_rounds_type_created         → aggregateRecent（近 N 局全局 RTP）
-- idx_game_rounds_player_type_settled  → aggregatePlayerToday（玩家今日水位）
CREATE INDEX IF NOT EXISTS idx_game_rounds_type_created
    ON game_rounds (game_type, created_at DESC)
    WHERE status = 'SETTLED';
CREATE INDEX IF NOT EXISTS idx_game_rounds_player_type_settled
    ON game_rounds (player_id, game_type, settled_at)
    WHERE status = 'SETTLED';

-- -------------------------------------------------------
-- pending_wallet_credits：game→wallet 補償單（ADR-009，Saga 補償）
-- credit（派彩/退款）失敗時落地為「待送出的 wallet credit」，
-- 排程帶同一冪等鍵重試；wallet 端 idempotency_key UNIQUE 保證不重複入帳。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_wallet_credits (
    id               BIGSERIAL     NOT NULL,
    game_type        VARCHAR(20)   NOT NULL,   -- SLOT / BACCARAT / FISHING
    round_id         VARCHAR(100)  NOT NULL,   -- 對局 roundId 或捕魚 sessionId（= credit 的 referenceId）
    player_id        BIGINT        NOT NULL,
    amount           BIGINT        NOT NULL,   -- 欠付金額（星幣）
    sub_type         VARCHAR(20)   NOT NULL,   -- WIN（結算派彩）/ REFUND（buy-in/top-up 退款、場次返還）
    idempotency_key  VARCHAR(100)  NOT NULL,   -- 與原始 credit 呼叫完全相同的冪等鍵（安全根基）
    status           VARCHAR(20)   NOT NULL DEFAULT 'PENDING',  -- PENDING / DONE / FAILED
    retry_count      INT           NOT NULL DEFAULT 0,
    last_error       VARCHAR(500),             -- 最近一次失敗原因（截斷保存）
    next_retry_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- 指數退避的下次重試時間
    created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    done_at          TIMESTAMP,
    CONSTRAINT pk_pending_wallet_credits    PRIMARY KEY (id),
    CONSTRAINT uq_pwc_idem_key              UNIQUE (idempotency_key),
    CONSTRAINT chk_pwc_game_type            CHECK (game_type IN ('SLOT', 'BACCARAT', 'FISHING')),
    CONSTRAINT chk_pwc_sub_type             CHECK (sub_type IN ('WIN', 'REFUND')),
    CONSTRAINT chk_pwc_status               CHECK (status IN ('PENDING', 'DONE', 'FAILED')),
    CONSTRAINT chk_pwc_amount_positive      CHECK (amount > 0)
);

-- 重試排程的撈單條件：status='PENDING' AND next_retry_at <= now
CREATE INDEX IF NOT EXISTS idx_pwc_status_retry ON pending_wallet_credits (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_pwc_player_id    ON pending_wallet_credits (player_id);

-- cashback_records：每日/每週虧損返利記錄（去重 + 稽核，防排程重複發放）
-- 對應 database/postgres/migration/V9__add_cashback_records.sql
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS cashback_records (
    id                BIGSERIAL     NOT NULL,
    player_id         BIGINT        NOT NULL,
    period_type       VARCHAR(10)   NOT NULL,   -- DAILY / WEEKLY
    period_start      DATE          NOT NULL,   -- 計算的期間起始日（日返=昨日、週返=上週一）
    loss_amount       BIGINT        NOT NULL,   -- 該期間淨虧損金額
    cashback_rate     NUMERIC(5,4)  NOT NULL,   -- 套用返利率（e.g. 0.0500）
    cashback_amount   BIGINT        NOT NULL,   -- 實際入帳金額（floor(loss * rate)）
    idempotency_key   VARCHAR(100)  NOT NULL,   -- wallet.credit.request 冪等鍵
    status            VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
    created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    credited_at       TIMESTAMP,
    CONSTRAINT pk_cashback_records          PRIMARY KEY (id),
    CONSTRAINT uq_cashback_idem_key         UNIQUE (idempotency_key),
    CONSTRAINT uq_cashback_player_period    UNIQUE (player_id, period_type, period_start),
    CONSTRAINT chk_cashback_period_type     CHECK (period_type IN ('DAILY', 'WEEKLY')),
    CONSTRAINT chk_cashback_status          CHECK (status IN ('PENDING', 'CREDITED', 'FAILED')),
    CONSTRAINT chk_cashback_loss_positive   CHECK (loss_amount > 0),
    CONSTRAINT chk_cashback_amount_positive CHECK (cashback_amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_cashback_player_id ON cashback_records (player_id);
CREATE INDEX IF NOT EXISTS idx_cashback_period    ON cashback_records (period_type, period_start);

-- -------------------------------------------------------
-- rank_history：週排行榜歷史快照
-- 每週重置前先保存 TOP N 名單，供歷史查詢與獎勵發放
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS rank_history (
    id          BIGSERIAL    NOT NULL,
    player_id   BIGINT       NOT NULL,
    nickname    VARCHAR(50),
    balance     BIGINT       NOT NULL,
    rank        INT          NOT NULL,
    week_start  DATE         NOT NULL,   -- 該週的起始日期（週一）
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_rank_history PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_rank_history_week_start ON rank_history (week_start);
CREATE INDEX IF NOT EXISTS idx_rank_history_player_id  ON rank_history (player_id);

-- -------------------------------------------------------
-- rank_daily_snapshots：每日持幣量快照
-- 排行服務每日定時抓取玩家餘額，供趨勢分析與每日贏幣王統計
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS rank_daily_snapshots (
    id             BIGSERIAL  NOT NULL,
    player_id      BIGINT     NOT NULL,
    balance        BIGINT     NOT NULL,
    snapshot_date  DATE       NOT NULL,
    created_at     TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_rank_daily_snapshots            PRIMARY KEY (id),
    CONSTRAINT uq_rank_daily_snapshots_player_date UNIQUE (player_id, snapshot_date)
);

-- -------------------------------------------------------
-- game_rtp_stats：RTP 統計彙總
-- 由排程每小時寫入，供 Admin Service 監控各遊戲回報率
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_rtp_stats (
    id            BIGSERIAL    NOT NULL,
    game_type     VARCHAR(20)  NOT NULL,   -- SLOT / BACCARAT / FISHING
    total_bet     BIGINT       NOT NULL DEFAULT 0,
    total_win     BIGINT       NOT NULL DEFAULT 0,
    round_count   INT          NOT NULL DEFAULT 0,
    calculated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_game_rtp_stats PRIMARY KEY (id),
    CONSTRAINT chk_rtp_game_type CHECK (game_type IN ('SLOT', 'BACCARAT', 'FISHING'))
);

CREATE INDEX IF NOT EXISTS idx_game_rtp_stats_game_type     ON game_rtp_stats (game_type);
CREATE INDEX IF NOT EXISTS idx_game_rtp_stats_calculated_at ON game_rtp_stats (calculated_at);

-- -------------------------------------------------------
-- admin_alerts：異常告警紀錄
-- 偵測到大額贏幣、高頻下注或異常轉帳時產生告警供管理員處理
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_alerts (
    id           BIGSERIAL    NOT NULL,
    player_id    BIGINT       NOT NULL,
    alert_type   VARCHAR(30)  NOT NULL,   -- BIG_WIN / HIGH_FREQUENCY / ABNORMAL_TRANSFER
    detail       TEXT,
    is_resolved  BOOLEAN      NOT NULL DEFAULT FALSE,
    resolved_by  VARCHAR(50),                            -- 標記已處理的後台操作者（未處理為 NULL）
    resolved_at  TIMESTAMP,                              -- 標記已處理的時間（未處理為 NULL）
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_admin_alerts PRIMARY KEY (id),
    CONSTRAINT chk_alert_type  CHECK (alert_type IN ('BIG_WIN', 'HIGH_FREQUENCY', 'ABNORMAL_TRANSFER'))
);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_player_id   ON admin_alerts (player_id);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_is_resolved ON admin_alerts (is_resolved);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_created_at  ON admin_alerts (created_at);

-- -------------------------------------------------------
-- admin_users：後台管理員帳號（T-050）
-- 與玩家帳號完全分離：玩家在 members（MySQL），管理員在此（PostgreSQL）。
-- role 區分 SUPER_ADMIN / OPERATOR；password_hash 為 BCrypt。
-- JWT 以獨立 ADMIN_JWT_SECRET 簽發，玩家 token 無法存取 /admin/**。
-- 預設管理員由 admin-service 啟動時的 seeder 建立（見 AdminUserSeeder），不在此硬編密碼雜湊。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
    id            BIGSERIAL     NOT NULL,
    username      VARCHAR(50)   NOT NULL,
    password_hash VARCHAR(100)  NOT NULL,   -- BCrypt 雜湊
    role          VARCHAR(20)   NOT NULL,   -- SUPER_ADMIN / OPERATOR
    enabled       BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_admin_users        PRIMARY KEY (id),
    CONSTRAINT uq_admin_users_username UNIQUE (username),
    CONSTRAINT chk_admin_users_role  CHECK (role IN ('SUPER_ADMIN', 'OPERATOR'))
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users (username);

-- -------------------------------------------------------
-- diamond_wallets：玩家鑽石錢包主表（T-100）
-- 鑽石為點數卡兌換而來的硬通貨，與 wallets（星幣）平行、同庫
-- balance 為鑽石餘額；version 樂觀鎖防止兌換時的並發超扣（T-103）
-- 無 frozen_amount —— 鑽石無凍結/下注概念
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS diamond_wallets (
    player_id   BIGINT     NOT NULL,
    balance     BIGINT     NOT NULL DEFAULT 0,        -- 鑽石餘額（整數，無小數）
    version     BIGINT     NOT NULL DEFAULT 0,        -- 樂觀鎖版本號，每次更新 +1
    created_at  TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_diamond_wallets         PRIMARY KEY (player_id),
    CONSTRAINT chk_diamond_wallets_balance CHECK (balance >= 0)
);

-- -------------------------------------------------------
-- dead_letter_messages：Kafka 消費失敗 DLT 訊息紀錄（T-028）
-- 重試 3 次仍失敗的訊息由 DeadLetterListener 落庫，供 Admin 查詢與手動重試
-- status：FAILED（待處理）/ RETRIED（已重試）/ RESOLVED（已解決）
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dead_letter_messages (
    id              BIGSERIAL    NOT NULL,
    dlt_topic       VARCHAR(100) NOT NULL,
    original_topic  VARCHAR(100) NOT NULL,
    message_key     VARCHAR(255),
    payload         TEXT         NOT NULL,
    exception_class VARCHAR(255),
    failure_reason  TEXT,
    stack_trace     TEXT,
    status          VARCHAR(20)  NOT NULL DEFAULT 'FAILED',
    retry_count     INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_retried_at TIMESTAMP,
    CONSTRAINT pk_dead_letter_messages PRIMARY KEY (id),
    CONSTRAINT chk_dlm_status CHECK (status IN ('FAILED', 'RETRIED', 'RESOLVED'))
);

CREATE INDEX IF NOT EXISTS idx_dlm_status     ON dead_letter_messages (status);
CREATE INDEX IF NOT EXISTS idx_dlm_dlt_topic  ON dead_letter_messages (dlt_topic);
CREATE INDEX IF NOT EXISTS idx_dlm_created_at ON dead_letter_messages (created_at);

-- -------------------------------------------------------
-- admin_action_logs：後台敏感操作稽核紀錄（T-055）
-- 目前用於 GM 手動發幣（action_type=GM_GRANT）：每次發幣寫一筆。
-- idempotency_key UNIQUE 兼作去重鍵，並當作 wallet.credit.request 指令的冪等鍵（ADR-002）。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_action_logs (
    id               BIGSERIAL    NOT NULL,
    operator         VARCHAR(50)  NOT NULL,   -- 操作者（後台管理員識別）
    action_type      VARCHAR(30)  NOT NULL,   -- GM_GRANT 等
    target_player_id BIGINT,
    amount           BIGINT,
    reason           VARCHAR(255),
    idempotency_key  VARCHAR(100),
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_admin_action_logs       PRIMARY KEY (id),
    CONSTRAINT uq_admin_action_logs_idem  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_admin_action_logs_operator   ON admin_action_logs (operator);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_created_at ON admin_action_logs (created_at);
