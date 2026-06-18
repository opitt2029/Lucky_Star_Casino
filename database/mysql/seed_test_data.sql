-- ============================================================
-- 幸運星幣城 — 共用測試帳號種子資料（MySQL 讀庫：members）
-- ------------------------------------------------------------
-- 目的：團隊共用一組「固定測試帳號」，git 同步、各自 docker 啟動即有，
--       不需手動匯入、不需依賴某台主機。
-- 載入時機：由 docker-compose 掛載到 /docker-entrypoint-initdb.d/，
--           僅在「資料 Volume 首次建立」時自動執行（在 init.sql 之後）。
--           想重載：docker compose down -v && docker compose up -d
-- 密碼：三個帳號密碼皆為 Password1（BCrypt 雜湊，符合 register 規則：≥8 碼含英數）。
-- 對應 PostgreSQL 的初始星幣餘額：見 database/postgres/seed_test_data.sql（player_id 對齊）。
-- 冪等：ON DUPLICATE KEY UPDATE，可重複執行不報錯。
-- ============================================================

USE lucky_star_casino;

INSERT INTO members
    (id,   username,   email,                   password_hash,
     nickname,   role,     status,   is_new_gift_claimed)
VALUES
    (1001, 'tester01', 'tester01@example.com', '$2b$10$6gbb.Gbe.iotaGfb9wxqSu8glcV280XdY8tlazY9wAzkRTcWeOoDW',
     '測試員一', 'PLAYER', 'ACTIVE', 1),
    (1002, 'tester02', 'tester02@example.com', '$2b$10$6gbb.Gbe.iotaGfb9wxqSu8glcV280XdY8tlazY9wAzkRTcWeOoDW',
     '測試員二', 'PLAYER', 'ACTIVE', 1),
    (1003, 'tester03', 'tester03@example.com', '$2b$10$6gbb.Gbe.iotaGfb9wxqSu8glcV280XdY8tlazY9wAzkRTcWeOoDW',
     '測試員三', 'PLAYER', 'ACTIVE', 1)
ON DUPLICATE KEY UPDATE
    email               = VALUES(email),
    password_hash       = VALUES(password_hash),
    nickname            = VALUES(nickname),
    role                = VALUES(role),
    status              = VALUES(status),
    is_new_gift_claimed = VALUES(is_new_gift_claimed);
