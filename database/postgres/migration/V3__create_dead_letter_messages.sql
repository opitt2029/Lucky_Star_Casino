-- =======================================================
-- V2 — dead_letter_messages（T-028 Kafka 消費失敗 DLT 處理）
-- =======================================================
-- 消費失敗重試 3 次後轉入 <topic>.DLT 的訊息，由 DeadLetterListener 撈出落庫。
-- 供 Admin 查詢失敗原因、手動重試（重發原 payload 回原 topic）。
-- 寫於 PostgreSQL 寫庫（@Primary），由 postgresEntityManagerFactory 管理。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dead_letter_messages (
    id              BIGSERIAL    NOT NULL,
    dlt_topic       VARCHAR(100) NOT NULL,   -- 失敗訊息所在的 DLT，如 wallet.credit.DLT
    original_topic  VARCHAR(100) NOT NULL,   -- 原始 topic，如 wallet.credit（重試重發目標）
    message_key     VARCHAR(255),            -- Kafka record key（playerId），可為 null
    payload         TEXT         NOT NULL,   -- 原始訊息內容（JSON 字串）
    exception_class VARCHAR(255),            -- 失敗例外的完整類名（FQCN）
    failure_reason  TEXT,                    -- 例外訊息
    stack_trace     TEXT,                    -- 截斷後的堆疊（最多 4000 字）
    status          VARCHAR(20)  NOT NULL DEFAULT 'FAILED',  -- FAILED / RETRIED / RESOLVED
    retry_count     INT          NOT NULL DEFAULT 0,         -- 已手動重試次數
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_retried_at TIMESTAMP,
    CONSTRAINT pk_dead_letter_messages PRIMARY KEY (id),
    CONSTRAINT chk_dlm_status CHECK (status IN ('FAILED', 'RETRIED', 'RESOLVED'))
);

CREATE INDEX IF NOT EXISTS idx_dlm_status     ON dead_letter_messages (status);
CREATE INDEX IF NOT EXISTS idx_dlm_dlt_topic  ON dead_letter_messages (dlt_topic);
CREATE INDEX IF NOT EXISTS idx_dlm_created_at ON dead_letter_messages (created_at);
