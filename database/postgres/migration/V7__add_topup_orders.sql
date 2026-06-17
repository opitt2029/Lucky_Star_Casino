-- ============================================================
-- Flyway Migration V7：玩家自助加值（模擬支付儲值訂單）
-- 幸運星幣城 — 新增 topup_orders 訂單表，並擴充 wallet_transactions.sub_type 允許 TOPUP
-- ============================================================

-- 1) 擴充帳務子類型，允許 TOPUP（自助加值入帳）
-- PostgreSQL 不支援 ALTER CONSTRAINT 變更規則，需 DROP + ADD
ALTER TABLE wallet_transactions
    DROP CONSTRAINT IF EXISTS chk_wt_sub_type;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT chk_wt_sub_type
        CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD', 'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP'));

-- 2) 加值訂單表
CREATE TABLE IF NOT EXISTS topup_orders (
    id            BIGSERIAL    NOT NULL,
    order_no      VARCHAR(40)  NOT NULL,
    player_id     BIGINT       NOT NULL,
    package_id    VARCHAR(20)  NOT NULL,
    amount        BIGINT       NOT NULL,
    price_label   VARCHAR(20)  NOT NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'CREATED',
    credit_tx_id  BIGINT,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at       TIMESTAMP,
    CONSTRAINT pk_topup_orders    PRIMARY KEY (id),
    CONSTRAINT uq_topup_orders_no UNIQUE (order_no),
    CONSTRAINT chk_topup_amount   CHECK (amount > 0),
    CONSTRAINT chk_topup_status   CHECK (status IN ('CREATED', 'PAID', 'CREDITED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_topup_orders_player_time ON topup_orders (player_id, created_at DESC);
