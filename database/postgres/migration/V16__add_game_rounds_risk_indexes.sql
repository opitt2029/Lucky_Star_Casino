-- ============================================================
-- Flyway Migration V16：game_rounds 補風控聚合查詢的複合索引（T-090 效能調校 Phase A3）
-- 註：原為 V15（與 V15__add_alert_resolution_audit.sql 版號重複），藍圖 04 P2 順手改為 V16。
-- 幸運星幣城 — 1,000 併發壓測顯示風控每局兩次聚合是延遲主因之一：
--   1. aggregateRecent：近 N 局全局 RTP（WHERE game_type=? AND status='SETTLED'
--      ORDER BY created_at DESC LIMIT 500）→ 需要 (game_type, created_at DESC)。
--   2. aggregatePlayerToday：玩家今日水位（WHERE player_id=? AND game_type=?
--      AND status='SETTLED' AND settled_at >= 今日）→ 需要 (player_id, game_type, settled_at)。
-- 兩者都只掃已結算對局，故用 partial index（WHERE status='SETTLED'）縮小索引體積。
-- A1/A2（統計改事件驅動 + Redis 快取）落地後，這兩個索引仍服務排程聚合與 cache-miss 回填。
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_game_rounds_type_created
    ON game_rounds (game_type, created_at DESC)
    WHERE status = 'SETTLED';

CREATE INDEX IF NOT EXISTS idx_game_rounds_player_type_settled
    ON game_rounds (player_id, game_type, settled_at)
    WHERE status = 'SETTLED';
