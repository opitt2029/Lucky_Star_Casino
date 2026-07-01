-- ============================================================
-- Flyway Migration V6：新增 admin_action_logs（後台敏感操作稽核）
-- 幸運星幣城 — T-055 GM 手動發放星幣需稽核每次發幣操作，並以 idempotency_key
-- 去重 + 當作 wallet.credit.request 指令的冪等鍵（ADR-002：admin 絕不直接寫 wallet）。
-- 與 init.sql 末尾的 admin_action_logs 定義一致；既有環境以此 migration 補建。
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_action_logs (
    id               BIGSERIAL    NOT NULL,
    operator         VARCHAR(50)  NOT NULL,   -- 操作者（後台管理員識別）
    action_type      VARCHAR(30)  NOT NULL,   -- GM_GRANT 等
    target_player_id BIGINT,
    amount           BIGINT,
    reason           VARCHAR(255),
    idempotency_key  VARCHAR(100),
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_admin_action_logs       PRIMARY KEY (id),
    CONSTRAINT uq_admin_action_logs_idem  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_admin_action_logs_operator   ON admin_action_logs (operator);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_created_at ON admin_action_logs (created_at);
