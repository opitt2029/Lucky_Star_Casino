-- ============================================================
-- Flyway Migration V6：MySQL 讀端擴充 sub_type CASHBACK
-- 幸運星幣城 — 虧損返利排程透過 wallet.credit.request 指令入帳，
-- wallet-service 落帳時 sub_type = 'CASHBACK'，MySQL 讀端需同步允許此值。
-- ============================================================

ALTER TABLE wallet_transactions
    DROP CHECK chk_wt_sub_type;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT chk_wt_sub_type
        CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD',
                            'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP', 'CASHBACK'));
