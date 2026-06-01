-- ============================================================
-- Flyway Migration V2：PostgreSQL 新增鑽石錢包表（T-100）
-- 幸運星幣城 — 鑽石點數卡系統，帳務寫入主庫
-- 對應 ADR-001：PostgreSQL 作為 CQRS 寫入端
-- ============================================================

-- -------------------------------------------------------
-- diamond_wallets：玩家鑽石錢包主表
-- 鑽石為點數卡兌換而來的硬通貨，與 wallets（星幣）平行、同庫
-- balance 為鑽石餘額；version 樂觀鎖防止兌換時的並發超扣（T-103）
-- 無 frozen_amount —— 鑽石無凍結/下注概念
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS diamond_wallets (
    player_id   BIGINT     NOT NULL,
    balance     BIGINT     NOT NULL DEFAULT 0,        -- 鑽石餘額（整數，無小數）
    version     BIGINT     NOT NULL DEFAULT 0,        -- 樂觀鎖版本號，每次更新 +1
    created_at  TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_diamond_wallets          PRIMARY KEY (player_id),
    CONSTRAINT chk_diamond_wallets_balance CHECK (balance >= 0)
);
