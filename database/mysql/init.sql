-- ============================================================
-- 幸運星幣城 — MySQL 初始化 Schema
-- 用途：查詢讀庫（CQRS 讀端，高頻查詢場景）
-- 對應 ADR-001：MySQL 作為 CQRS 查詢讀端
-- ============================================================

CREATE DATABASE IF NOT EXISTS lucky_star_casino
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE lucky_star_casino;

-- ============================================================
-- 健康檢查表（基礎建設用，各 Service 可寫入自身狀態）
-- ============================================================
CREATE TABLE IF NOT EXISTS system_health_check (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    service_name VARCHAR(100) NOT NULL,
    status       VARCHAR(50)  NOT NULL,
    checked_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Member Service — 玩家帳號表
-- 所屬服務：Member Service（port 8081）
-- 說明：
--   · role   — PLAYER（一般玩家）/ ADMIN（後台管理員）
--   · status — ACTIVE（正常）/ DISABLED（停權）
--   · avatar — 可為 https:// URL 或 data:image/xxx;base64,... 格式
--   · password_hash — BCrypt 雜湊值，不儲存明文
-- ============================================================
CREATE TABLE IF NOT EXISTS members (
    id            BIGINT        AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)   NOT NULL COMMENT '登入帳號，唯一',
    email         VARCHAR(100)  NOT NULL COMMENT '電子信箱，唯一',
    password_hash VARCHAR(255)  NOT NULL COMMENT 'BCrypt 雜湊密碼',
    nickname      VARCHAR(50)   NOT NULL COMMENT '顯示暱稱',
    avatar        TEXT          NULL     COMMENT '頭像：URL 或 Base64 data URI',
    role          VARCHAR(20) NOT NULL DEFAULT 'PLAYER',
    status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    is_new_gift_claimed TINYINT(1) NOT NULL DEFAULT 0 COMMENT '新手贈幣是否已領取',
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_members_username (username),
    UNIQUE KEY uq_members_email    (email),
    INDEX      idx_members_status  (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- friendships：好友關係表
-- 記錄玩家之間的好友申請與接受狀態
-- UNIQUE(requester_id, receiver_id) 防止重複申請
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS friendships (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    requester_id  BIGINT       NOT NULL,                    -- 發送申請的玩家
    receiver_id   BIGINT       NOT NULL,                    -- 接收申請的玩家
    status        VARCHAR(10)  NOT NULL DEFAULT 'PENDING',  -- PENDING / ACCEPTED / REJECTED
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_friendships            PRIMARY KEY (id),
    CONSTRAINT uq_friendships_pair       UNIQUE (requester_id, receiver_id),
    CONSTRAINT chk_friendships_status    CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    CONSTRAINT chk_friendships_no_self   CHECK (requester_id <> receiver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_friendships_receiver_id ON friendships (receiver_id);

-- -------------------------------------------------------
-- daily_checkins：每日簽到紀錄
-- 記錄玩家每日簽到，consecutive_days 追蹤連續簽到天數
-- UNIQUE(player_id, checkin_date) 防止同日重複簽到
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_checkins (
    id               BIGINT    NOT NULL AUTO_INCREMENT,
    player_id        BIGINT    NOT NULL,
    checkin_date     DATE      NOT NULL,
    consecutive_days INT       NOT NULL DEFAULT 1,  -- 連續簽到天數
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_daily_checkins               PRIMARY KEY (id),
    CONSTRAINT uq_daily_checkins_player_date   UNIQUE (player_id, checkin_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- task_definitions：任務定義表
-- 由 GM 預先設定的任務模板，玩家完成後可領取星幣獎勵
-- task_code 為唯一識別碼，供程式邏輯引用
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_definitions (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    task_code     VARCHAR(50)  NOT NULL,
    task_name     VARCHAR(100) NOT NULL,
    task_type     VARCHAR(30)  NOT NULL,  -- FIRST_LOGIN / DAILY_CHECKIN / BET_COUNT / INVITE_FRIEND
    reward_amount BIGINT       NOT NULL,  -- 完成任務獎勵的星幣數量
    target_count  INT          NOT NULL DEFAULT 1,  -- 完成任務所需的達成次數
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT pk_task_definitions         PRIMARY KEY (id),
    CONSTRAINT uq_task_definitions_code    UNIQUE (task_code),
    CONSTRAINT chk_task_type               CHECK (task_type IN ('FIRST_LOGIN', 'DAILY_CHECKIN', 'BET_COUNT', 'INVITE_FRIEND')),
    CONSTRAINT chk_task_reward_amount      CHECK (reward_amount > 0),
    CONSTRAINT chk_task_target_count       CHECK (target_count > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- player_tasks：玩家任務進度
-- 追蹤每位玩家對各任務的完成進度
-- UNIQUE(player_id, task_id) 確保每人每任務只有一筆進度
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_tasks (
    id            BIGINT    NOT NULL AUTO_INCREMENT,
    player_id     BIGINT    NOT NULL,
    task_id       BIGINT    NOT NULL,
    progress      INT       NOT NULL DEFAULT 0,
    is_completed  BOOLEAN   NOT NULL DEFAULT FALSE,
    completed_at  TIMESTAMP NULL,
    CONSTRAINT pk_player_tasks            PRIMARY KEY (id),
    CONSTRAINT uq_player_tasks_pair       UNIQUE (player_id, task_id),
    CONSTRAINT chk_player_tasks_progress  CHECK (progress >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_player_tasks_player_id ON player_tasks (player_id);

-- -------------------------------------------------------
-- gift_logs：好友贈幣紀錄
-- 記錄玩家之間的星幣贈送歷史
-- 搭配 Redis 的每日累計限額進行即時限流控制
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS gift_logs (
    id           BIGINT    NOT NULL AUTO_INCREMENT,
    sender_id    BIGINT    NOT NULL,
    receiver_id  BIGINT    NOT NULL,
    amount       BIGINT    NOT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_gift_logs         PRIMARY KEY (id),
    CONSTRAINT chk_gift_logs_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_gift_logs_sender_id   ON gift_logs (sender_id);

-- -------------------------------------------------------
-- outbox_events：Transactional Outbox Pattern 暫存表
-- 由 OutboxPoller 輪詢後推送至 Kafka，確保事件不遺失
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox_events (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    topic       VARCHAR(100) NOT NULL,
    kafka_key   VARCHAR(100),
    payload     TEXT         NOT NULL,
    status      VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    retry_count INT          NOT NULL DEFAULT 0,
    created_at  DATETIME     NOT NULL,
    sent_at     DATETIME,
    CONSTRAINT pk_outbox_events PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX idx_gift_logs_receiver_id ON gift_logs (receiver_id);
CREATE INDEX idx_gift_logs_created_at  ON gift_logs (created_at);

-- -------------------------------------------------------
-- wallet_transactions（讀庫副本）
-- 由 Wallet Service 雙寫或 Kafka 事件驅動同步自 PostgreSQL
-- 供帳務流水查詢 API（T-025）分頁使用，不設 idempotency_key 唯一約束
-- 注意：此表為最終一致性，餘額查詢請直接查 PostgreSQL
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id               BIGINT       NOT NULL,   -- 與 PostgreSQL 主庫 id 保持一致
    player_id        BIGINT       NOT NULL,
    type             VARCHAR(10)  NOT NULL,   -- DEBIT / CREDIT / BONUS
    sub_type         VARCHAR(20)  NOT NULL,   -- BET / WIN / CHECKIN / TASK / GIFT / GM_REWARD / BANKRUPTCY_AID
    amount           BIGINT       NOT NULL,
    balance_before   BIGINT,
    balance_after    BIGINT,
    idempotency_key  VARCHAR(100),            -- 唯讀複本，不加唯一約束
    reference_id     VARCHAR(100),
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_wallet_transactions PRIMARY KEY (id),
    CONSTRAINT chk_wt_type     CHECK (type    IN ('DEBIT', 'CREDIT', 'BONUS')),
    CONSTRAINT chk_wt_sub_type CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD', 'BANKRUPTCY_AID')),
    CONSTRAINT chk_wt_amount   CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_wt_player_id   ON wallet_transactions (player_id);
CREATE INDEX idx_wt_created_at  ON wallet_transactions (created_at);
CREATE INDEX idx_wt_player_time ON wallet_transactions (player_id, created_at DESC);

-- -------------------------------------------------------
-- diamond_cards：鑽石點數卡（序號）表（T-100）
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
    CONSTRAINT pk_diamond_cards            PRIMARY KEY (id),
    CONSTRAINT uq_diamond_cards_code       UNIQUE (card_code),
    CONSTRAINT chk_diamond_cards_face_value CHECK (face_value > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_diamond_cards_is_redeemed ON diamond_cards (is_redeemed);
CREATE INDEX idx_diamond_cards_redeemed_by ON diamond_cards (redeemed_by);
