-- ============================================================
-- 幸運星幣城 — 共用測試帳號種子資料（PostgreSQL 帳務庫：wallets）
-- ------------------------------------------------------------
-- 目的：為 database/mysql/seed_test_data.sql 的三個測試帳號建立初始星幣錢包。
--       player_id 必須與 MySQL members.id 對齊（1001~1003）。
-- 載入時機：由 docker-compose 掛載到 /docker-entrypoint-initdb.d/，
--           僅在「資料 Volume 首次建立」時自動執行（在 init.sql 之後）。
--           想重載：docker compose down -v && docker compose up -d
-- 餘額：每人初始 10000 星幣；version 從 0 起（樂觀鎖，ADR-001 / T-022）。
-- 冪等：ON CONFLICT DO UPDATE，可重複執行不報錯。
-- ============================================================

INSERT INTO wallets (player_id, balance, frozen_amount, version)
VALUES
    (1001, 10000, 0, 0),
    (1002, 10000, 0, 0),
    (1003, 10000, 0, 0)
ON CONFLICT (player_id) DO UPDATE
    SET balance = EXCLUDED.balance;
