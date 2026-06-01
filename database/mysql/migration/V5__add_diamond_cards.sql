-- ============================================================
-- Flyway Migration V5：MySQL 新增鑽石點數卡表（T-100）
-- 幸運星幣城 — 鑽石點數卡系統，查詢讀庫（CQRS 讀端）
-- 對應 ADR-001：MySQL 作為 CQRS 查詢讀端
-- ============================================================

-- -------------------------------------------------------
-- diamond_cards：鑽石點數卡（序號）表
-- 由後台批量產生（T-105），玩家輸入 card_code 兌換鑽石（T-102）
-- card_code 唯一約束 + is_redeemed 旗標：DB 層防止同一序號重複兌換
-- redeemed_by / redeemed_at 記錄兌換者與時間，供後台追蹤（T-106）
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS diamond_cards (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    card_code    VARCHAR(50)  NOT NULL              COMMENT '點數卡序號，格式 XXXX-XXXX-XXXX-XXXX',
    face_value   BIGINT       NOT NULL              COMMENT '面額：兌換可得的鑽石數',
    is_redeemed  TINYINT(1)   NOT NULL DEFAULT 0    COMMENT '是否已兌換：0 未兌換 / 1 已兌換',
    redeemed_by  BIGINT       NULL                  COMMENT '兌換玩家 playerId（未兌換為 NULL）',
    redeemed_at  DATETIME     NULL                  COMMENT '兌換時間（未兌換為 NULL）',
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_diamond_cards             PRIMARY KEY (id),
    CONSTRAINT uq_diamond_cards_code        UNIQUE (card_code),
    CONSTRAINT chk_diamond_cards_face_value CHECK (face_value > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_diamond_cards_is_redeemed ON diamond_cards (is_redeemed);
CREATE INDEX idx_diamond_cards_redeemed_by ON diamond_cards (redeemed_by);
