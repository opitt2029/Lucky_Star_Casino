-- ============================================================
-- Flyway Migration V13：禮品商城兌換紀錄 + wallet_transactions.sub_type SHOP_PURCHASE
-- 幸運星幣城 — 玩家以星幣兌換禮品（後端化）。兌換＝在單一 Postgres 交易內
-- 「扣星幣（WalletService.debit，sub_type=SHOP_PURCHASE）+ 寫 shop_redemptions」，原子、冪等。
-- shop_redemptions 為帳務真相＋背包來源；目錄 shop_items 在 MySQL（admin 管理）。
-- 對應 ADR-006。
-- ============================================================

-- -------------------------------------------------------
-- shop_redemptions：商城兌換紀錄（帳務寫端）
-- 每筆＝某玩家兌換某商品一次；star_spent / balance_before / balance_after 為兌換當下快照。
-- idempotency_key 與 wallet_transactions 同鍵，DB UNIQUE 防重複兌換。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_redemptions (
    id               BIGSERIAL    NOT NULL,
    player_id        BIGINT       NOT NULL,
    item_code        VARCHAR(50)  NOT NULL,            -- 對應 shop_items.item_code
    item_name        VARCHAR(100) NOT NULL,            -- 兌換當下商品名稱快照
    star_spent       BIGINT       NOT NULL,            -- 花費星幣（快照當下定價）
    balance_before   BIGINT,                           -- 兌換前星幣餘額
    balance_after    BIGINT,                           -- 兌換後星幣餘額
    idempotency_key  VARCHAR(100) UNIQUE,              -- 冪等鍵（與 wallet_transactions 同鍵）
    status           VARCHAR(20)  NOT NULL DEFAULT 'COMPLETED',
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_shop_redemptions      PRIMARY KEY (id),
    CONSTRAINT chk_shop_star_positive   CHECK (star_spent > 0),
    CONSTRAINT chk_shop_status          CHECK (status IN ('COMPLETED', 'PENDING', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_shop_redemptions_player_time ON shop_redemptions (player_id, created_at DESC);

-- -------------------------------------------------------
-- 擴充 wallet_transactions.sub_type 允許 'SHOP_PURCHASE'（DEBIT 類，扣星幣兌換禮品）
-- -------------------------------------------------------
ALTER TABLE wallet_transactions
    DROP CONSTRAINT IF EXISTS chk_wt_sub_type;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT chk_wt_sub_type
        CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD',
                            'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP', 'CASHBACK', 'REFUND',
                            'MONTHLY_REWARD', 'SHOP_PURCHASE'));
