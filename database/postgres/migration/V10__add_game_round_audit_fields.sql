-- ============================================================
-- Flyway Migration V10：game_rounds 新增注單稽核欄位
-- 幸運星幣城 — 完整遊戲紀錄/注單需求：
--   每筆對局除了既有的 round_id（流水號/注單號）、nonce（局號）、bet/win 之外，
--   再記錄「投注前餘額 → 派彩後餘額」與「下注時間（毫秒）」，
--   讓玩家在「遊戲紀錄」頁可逐筆稽核餘額變化與精確下注/派彩時間。
-- 既有資料列這些欄位為 NULL（前端以 '-' 呈現），不影響 RTP/風控既有查詢。
-- ============================================================

ALTER TABLE game_rounds
    ADD COLUMN IF NOT EXISTS balance_before BIGINT;

ALTER TABLE game_rounds
    ADD COLUMN IF NOT EXISTS balance_after  BIGINT;

ALTER TABLE game_rounds
    ADD COLUMN IF NOT EXISTS bet_at         TIMESTAMP;
