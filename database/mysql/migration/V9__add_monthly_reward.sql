-- ============================================================
-- Flyway Migration V9：MySQL 新增月度累計簽到獎勵表 + sub_type MONTHLY_REWARD
-- 幸運星幣城 — 玩家當月「累計」（非連續）簽到天數達里程碑（10/20/28 天）可手動領取大獎。
-- 此為 CQRS 查詢讀端（ADR-001）；領取的星幣透過 wallet.credit.request 指令落帳（ADR-002），
-- 故 wallet_transactions.sub_type 需新增 'MONTHLY_REWARD'（非 WIN，避免污染 rank 今日贏幣榜）。
-- ============================================================

-- -------------------------------------------------------
-- monthly_reward_claims：月度累計簽到獎勵領取紀錄
-- 每筆代表某玩家在某年月、某里程碑的一次領取。
-- UNIQUE(player_id, reward_month, milestone_days) 在 DB 層擋重複領取。
-- reward_month 命名刻意避開 MySQL 關鍵字 YEAR_MONTH。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_reward_claims (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    player_id      BIGINT       NOT NULL              COMMENT '領取玩家 playerId',
    reward_month   VARCHAR(7)   NOT NULL              COMMENT '領取所屬年月，格式 yyyy-MM（台北時區）',
    milestone_days INT          NOT NULL              COMMENT '達成的累計天數里程碑：10 / 20 / 28',
    reward_amount  BIGINT       NOT NULL              COMMENT '領取的星幣金額',
    claimed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_monthly_reward_claims PRIMARY KEY (id),
    CONSTRAINT uq_mrc_player_month_milestone UNIQUE (player_id, reward_month, milestone_days),
    CONSTRAINT chk_mrc_reward_amount CHECK (reward_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_mrc_player_month ON monthly_reward_claims (player_id, reward_month);

-- -------------------------------------------------------
-- 擴充 wallet_transactions.sub_type 允許 'MONTHLY_REWARD'
-- -------------------------------------------------------
ALTER TABLE wallet_transactions
    DROP CHECK chk_wt_sub_type;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT chk_wt_sub_type
        CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD',
                            'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP', 'CASHBACK', 'REFUND',
                            'MONTHLY_REWARD'));
