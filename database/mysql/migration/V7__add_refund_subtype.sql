-- ============================================================
-- Flyway Migration V7：MySQL 讀端擴充 sub_type REFUND
-- 幸運星幣城 — 捕魚 buy-in 退款／場次結算返還剩餘局內餘額透過 wallet credit 落帳，
-- sub_type = 'REFUND'（非 WIN，避免 rank-service 把退款誤計入今日贏幣榜），
-- MySQL 讀端需同步允許此值。
-- ============================================================

ALTER TABLE wallet_transactions
    DROP CHECK chk_wt_sub_type;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT chk_wt_sub_type
        CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD',
                            'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP', 'CASHBACK', 'REFUND'));
