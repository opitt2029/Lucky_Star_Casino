-- T-055: ensure Flyway-created admin_action_logs matches init.sql and JPA entity.
-- V6 accidentally commented out target_player_id in the CREATE TABLE statement.

ALTER TABLE admin_action_logs
    ADD COLUMN IF NOT EXISTS target_player_id BIGINT;
