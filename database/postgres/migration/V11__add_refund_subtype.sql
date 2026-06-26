-- ============================================================
-- Flyway Migration V11：擴充 wallet_transactions.sub_type REFUND
-- 幸運星幣城 — 捕魚 buy-in 退款（session 建立失敗補償）與場次結算返還剩餘局內餘額，
-- 過去都以 sub_type = 'WIN' 落帳，導致 rank-service 把退款／本金返還誤計入「今日贏幣榜」（Bug 5）。
-- 改用獨立子型 'REFUND'（CREDIT 類，非中獎派彩）。
-- ============================================================

ALTER TABLE wallet_transactions
    DROP CONSTRAINT IF EXISTS chk_wt_sub_type;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT chk_wt_sub_type
        CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD',
                            'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP', 'CASHBACK', 'REFUND'));
