-- ============================================================
-- Flyway Migration V15：admin_alerts 補告警處理稽核欄位
-- 幸運星幣城 — T-054 告警「標記已處理」原本不記錄「誰、何時」處理。
-- 補 resolved_by / resolved_at，讓風控告警的處理者可事後追溯；
-- 另在服務層每次處理落一筆 admin_action_logs（action_type = ALERT_RESOLVE）。
-- 與 init.sql 的 admin_alerts 定義一致；既有環境以此 migration 補欄位（可重跑）。
-- ============================================================

ALTER TABLE admin_alerts
    ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(50);

ALTER TABLE admin_alerts
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
