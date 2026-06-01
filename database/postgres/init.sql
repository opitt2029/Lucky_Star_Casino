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
    sub_type         VARCHAR(20)  NOT NULL,   -- BET / WIN / CHECKIN / TASK / GIFT / GM_REWARD / BANKRUPTCY_AID
    amount           BIGINT       NOT NULL,
    balance_before   BIGINT,
    balance_after    BIGINT,
    idempotency_key  VARCHAR(100) UNIQUE,     -- 冪等鍵，防止重複處理
    reference_id     VARCHAR(100),            -- 關聯 ID（如 round_id、event_id）
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_wallet_transactions PRIMARY KEY (id),
    CONSTRAINT chk_wt_type     CHECK (type    IN ('DEBIT', 'CREDIT', 'BONUS')),
    CONSTRAINT chk_wt_sub_type CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD', 'BANKRUPTCY_AID')),
    CONSTRAINT chk_wt_amount   CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_player_id   ON wallet_transactions (player_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at  ON wallet_transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_player_time ON wallet_transactions (player_id, created_at DESC);

-- -------------------------------------------------------
-- game_rounds：遊戲對局紀錄
-- 記錄每一局的下注、結果與 Provably Fair 所需的種子資訊
-- SHA-256(serverSeed + clientSeed + nonce) 可由玩家事後驗證公平性
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_rounds (
    id               BIGSERIAL    NOT NULL,
    round_id         VARCHAR(100) NOT NULL,   -- UUID，對外唯一識別碼
    player_id        BIGINT       NOT NULL,
    game_type        VARCHAR(20)  NOT NULL,   -- SLOT / BACCARAT
    bet_amount       BIGINT,
    win_amount       BIGINT,
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
    CONSTRAINT chk_gr_game_type CHECK (game_type IN ('SLOT', 'BACCARAT')),
    CONSTRAINT chk_gr_status    CHECK (status    IN ('STARTED', 'SETTLED'))
);

CREATE INDEX IF NOT EXISTS idx_game_rounds_player_id  ON game_rounds (player_id);
CREATE INDEX IF NOT EXISTS idx_game_rounds_created_at ON game_rounds (created_at);

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
    game_type     VARCHAR(20)  NOT NULL,   -- SLOT / BACCARAT
    total_bet     BIGINT       NOT NULL DEFAULT 0,
    total_win     BIGINT       NOT NULL DEFAULT 0,
    round_count   INT          NOT NULL DEFAULT 0,
    calculated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_game_rtp_stats PRIMARY KEY (id),
    CONSTRAINT chk_rtp_game_type CHECK (game_type IN ('SLOT', 'BACCARAT'))
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
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_admin_alerts PRIMARY KEY (id),
    CONSTRAINT chk_alert_type  CHECK (alert_type IN ('BIG_WIN', 'HIGH_FREQUENCY', 'ABNORMAL_TRANSFER'))
);

CREATE INDEX IF NOT EXISTS idx_admin_alerts_player_id   ON admin_alerts (player_id);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_is_resolved ON admin_alerts (is_resolved);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_created_at  ON admin_alerts (created_at);

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
