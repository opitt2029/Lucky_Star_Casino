-- ============================================================
-- Flyway Migration V5：PostgreSQL game_type 新增 FISHING
-- 幸運星幣城 — 捕魚機模組結算需寫入 game_rounds / game_rtp_stats，
-- 但原 CHECK 約束僅允許 SLOT / BACCARAT，導致 FISHING 結算被擋（SQLState 23514），
-- 對局無法持久化、verify-shot 永遠 404、捕魚機 RTP 統計寫不進。本遷移補上 FISHING。
-- PostgreSQL 不支援 ALTER CONSTRAINT 變更規則，需 DROP + ADD。
-- ============================================================

-- game_rounds.game_type
ALTER TABLE game_rounds
    DROP CONSTRAINT IF EXISTS chk_gr_game_type;

ALTER TABLE game_rounds
    ADD CONSTRAINT chk_gr_game_type
        CHECK (game_type IN ('SLOT', 'BACCARAT', 'FISHING'));

-- game_rtp_stats.game_type
ALTER TABLE game_rtp_stats
    DROP CONSTRAINT IF EXISTS chk_rtp_game_type;

ALTER TABLE game_rtp_stats
    ADD CONSTRAINT chk_rtp_game_type
        CHECK (game_type IN ('SLOT', 'BACCARAT', 'FISHING'));
