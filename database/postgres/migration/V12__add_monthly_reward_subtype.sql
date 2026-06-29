-- ============================================================
-- Flyway Migration V12：擴充 wallet_transactions.sub_type MONTHLY_REWARD
-- 幸運星幣城 — 月度累計簽到獎勵（玩家當月累計簽到達 10/20/28 天可手動領取大獎），
-- 透過 wallet.credit.request 指令入帳，sub_type = 'MONTHLY_REWARD'（CREDIT 類，
-- 非中獎派彩，避免 rank-service 把它計入「今日贏幣榜」）。
-- ============================================================

ALTER TABLE wallet_transactions
    DROP CONSTRAINT IF EXISTS chk_wt_sub_type;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT chk_wt_sub_type
        CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD',
                            'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP', 'CASHBACK', 'REFUND',
                            'MONTHLY_REWARD'));
