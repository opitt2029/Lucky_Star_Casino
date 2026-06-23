-- ============================================================
-- Flyway Migration V9：新增虧損返利記錄表 + 擴充 sub_type
-- 幸運星幣城 — 每日/每週虧損返利排程需要：
--   1. cashback_records：去重（idempotency）+ 稽核，防排程重複發放
--   2. wallet_transactions.sub_type：新增 CASHBACK 型別（ADR-002 指令鏈）
-- ============================================================

-- 1. 虧損返利記錄
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

CREATE INDEX IF NOT EXISTS idx_cashback_player_id  ON cashback_records (player_id);
CREATE INDEX IF NOT EXISTS idx_cashback_period     ON cashback_records (period_type, period_start);

-- 2. 擴充 wallet_transactions.sub_type CHECK（新增 CASHBACK）
ALTER TABLE wallet_transactions
    DROP CONSTRAINT IF EXISTS chk_wt_sub_type;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT chk_wt_sub_type
        CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD',
                            'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP', 'CASHBACK'));
