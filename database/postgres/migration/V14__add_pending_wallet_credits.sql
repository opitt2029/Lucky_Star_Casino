-- ============================================================
-- Flyway Migration V14：新增 game→wallet 補償單表（ADR-009，Saga 補償）
-- 幸運星幣城 — game-service 對 wallet 的 credit（派彩/退款）是同步 HTTP 呼叫，
-- wallet 短暫不可用時這筆「欠玩家的錢」會只剩一行 log。本表把它落地為
-- 「待送出的 wallet credit」（pending outbound wallet credit），由排程帶
-- **同一冪等鍵**重試——wallet 端 idempotency_key UNIQUE 保證絕不重複入帳。
-- sub_type 只用 WIN / REFUND（皆已在 CreditRequest 白名單與 chk_wt_sub_type 內，
-- 不需做雷區 18 的四同步）。
-- ============================================================

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
