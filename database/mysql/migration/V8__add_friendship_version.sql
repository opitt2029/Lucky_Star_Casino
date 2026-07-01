-- ============================================================
-- Flyway Migration V8：friendships 加樂觀鎖 version 欄位
-- 幸運星幣城 — Friendship 實體新增 @Version（ADR-001 / AGENTS.md 雷區 8），
-- 保護同一好友申請的併發接受/拒絕、REJECTED→PENDING 重置、好友上限競態。
-- 既有資料補 0；JPA ddl-auto=validate 需此欄位存在才能啟動。
-- ============================================================

ALTER TABLE friendships
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
