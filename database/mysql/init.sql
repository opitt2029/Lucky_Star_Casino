-- ============================================================
-- 幸運星幣城 — MySQL 初始化 Schema
-- 用途：查詢讀庫（CQRS 讀端，高頻查詢場景）
-- 對應 ADR-001：MySQL 作為 CQRS 查詢讀端
-- ============================================================

-- 容器 entrypoint 的 mysql client 在無 LANG 的 POSIX locale 下預設 latin1，
-- 會把本檔的 UTF-8 中文雙重編碼成亂碼寫入；強制連線編碼堵住此雷。
SET NAMES utf8mb4;

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
-- member_social_accounts：第三方 OAuth/OIDC 帳戶綁定
-- provider_subject 使用供應商簽發的穩定 sub，不以 email 當身分主鍵
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_social_accounts (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    member_id        BIGINT       NOT NULL,
    provider         VARCHAR(20)  NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    email            VARCHAR(255) NULL,
    display_name     VARCHAR(100) NULL,
    avatar_url       TEXT         NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_member_social_accounts PRIMARY KEY (id),
    CONSTRAINT uq_social_provider_subject UNIQUE (provider, provider_subject),
    CONSTRAINT uq_social_member_provider UNIQUE (member_id, provider),
    CONSTRAINT fk_social_member FOREIGN KEY (member_id)
        REFERENCES members (id) ON DELETE CASCADE,
    CONSTRAINT chk_social_provider CHECK (provider IN ('line', 'google', 'apple'))
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
    version       BIGINT       NOT NULL DEFAULT 0,             -- 樂觀鎖（@Version）：防併發接受/拒絕競態
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
    sub_type         VARCHAR(20)  NOT NULL,   -- BET / WIN / CHECKIN / TASK / GIFT / GM_REWARD / BANKRUPTCY_AID / DIAMOND_EXCHANGE / TOPUP / CASHBACK / REFUND
    amount           BIGINT       NOT NULL,
    balance_before   BIGINT,
    balance_after    BIGINT,
    idempotency_key  VARCHAR(100),            -- 唯讀複本，不加唯一約束
    reference_id     VARCHAR(100),
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_wallet_transactions PRIMARY KEY (id),
    CONSTRAINT chk_wt_type     CHECK (type    IN ('DEBIT', 'CREDIT', 'BONUS')),
    CONSTRAINT chk_wt_sub_type CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD', 'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP', 'CASHBACK', 'REFUND', 'MONTHLY_REWARD', 'SHOP_PURCHASE')),
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

-- -------------------------------------------------------
-- shop_items：禮品商城目錄（ADR-006）
-- admin-service 管理 CRUD、wallet-service 讀取列目錄/驗價；屬 CQRS 查詢讀端（ADR-001）。
-- active 控制上下架、sort_order 控制顯示順序、cost_star 為星幣定價。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_items (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    item_code   VARCHAR(50)  NOT NULL              COMMENT '商品代號（前端/兌換對應鍵）',
    name        VARCHAR(100) NOT NULL              COMMENT '商品名稱',
    caption     VARCHAR(255) NULL                  COMMENT '商品說明',
    cost_star   BIGINT       NOT NULL              COMMENT '兌換成本（星幣）',
    asset_key   VARCHAR(50)  NULL                  COMMENT '前端圖片資產鍵（如 shopPrizeA）',
    sort_order  INT          NOT NULL DEFAULT 0    COMMENT '顯示順序，小者在前',
    active      TINYINT(1)   NOT NULL DEFAULT 1    COMMENT '是否上架：1 上架 / 0 下架',
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_shop_items       PRIMARY KEY (id),
    CONSTRAINT uq_shop_items_code  UNIQUE (item_code),
    CONSTRAINT chk_shop_items_cost CHECK (cost_star > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_shop_items_active ON shop_items (active, sort_order);

INSERT INTO shop_items (item_code, name, caption, cost_star, asset_key, sort_order, active) VALUES
    ('vip-ticket', _utf8mb4 0x56495020E585A5E5A0B4E588B8, _utf8mb4 0xE58FAFE694B6E8978FE79A84E6B4BBE58B95E9809AE8A18CE588B8EFBC8CE981A9E59088E5858CE68F9BE99990E69982E6A18CE58FB0E8B387E6A0BCE38082, 12000, 'shopPrizeA', 1, 1),
    ('avatar-frame', _utf8mb4 0xE69C83E593A1E9A0ADE5838FE6A186, _utf8mb4 0xE69C83E593A1E4B8ADE5BF83E5B195E7A4BAE794A8E9A0ADE5838FE6A186EFBC8CE8AE93E5B8B3E688B6E69BB4E69C89E8BEA8E8AD98E5BAA6E38082, 8000, 'shopPrizeB', 2, 1),
    ('bonus-box', _utf8mb4 0xE5B9B8E9818BE7A6AEE79B92, _utf8mb4 0xE981A9E59088E6B4BBE58B95E78D8EE58BB5E68896E9A99AE5969CE694B6E8978FE79A84E7A6AEE79B92E38082, 20000, 'shopPrizeC', 3, 1),
    ('royal-nameplate', _utf8mb4 0xE79A87E5AEB6E69AB1E7A8B1E7898C, _utf8mb4 0xE69C83E593A1E4B8ADE5BF83E5B195E7A4BAE794A8E8A39DE9A3BEE5908DE7898CEFBC8CE8AE93E69AB1E7A8B1E69BB4E69C89E4B8BBE8A792E6849FE38082, 15000, 'shopRoyalNameplate', 4, 1),
    ('star-title-badge', _utf8mb4 0xE6989FE88080E7A8B1E8999FE5BEBDE7ABA0, _utf8mb4 0xE58FAFE694B6E8978FE79A84E5B8B3E688B6E7A8B1E8999FE8A39DE9A3BEEFBC8CE981A9E59088E6B4BBE58B95E68896E68E92E8A18CE78D8EE58BB5E5B195E7A4BAE38082, 10000, 'shopTitleBadge', 5, 1),
    ('profile-backdrop', _utf8mb4 0xE6989FE6B2B3E69C83E593A1E8838CE699AF, _utf8mb4 0xE69C83E593A1E4B8ADE5BF83E5B195E7A4BAE794A8E8838CE699AFE694B6E8978FEFBC8CE981A9E59088E68993E980A0E5B088E5B1ACE9A2A8E6A0BCE38082, 18000, 'shopProfileBackdrop', 6, 1),
    ('coin-rain-entry', _utf8mb4 0xE98791E5B9A3E99BA8E585A5E5A0B4E789B9E69588, _utf8mb4 0xE5B8B3E688B6E5B195E7A4BAE794A8E585A5E5A0B4E789B9E69588E694B6E8978FEFBC8CE8AE93E69C83E593A1E9A081E69BB4E69C89E58480E5BC8FE6849FE38082, 16000, 'shopCoinRain', 7, 1),
    ('daily-luck-pass', _utf8mb4 0xE6AF8FE697A5E5B9B8E9818BE588B8, _utf8mb4 0xE981A9E59088E6B4BBE58B95E799BCE694BEE79A84E8BC95E9878FE78D8EE58BB5E588B8EFBC8CE58FAFE58588E694B6E8978FE588B0E8838CE58C85E38082, 6000, 'shopLuckPass', 8, 1),
    ('high-roller-invite', _utf8mb4 0xE9AB98E9A18DE6A18CE98280E8AB8BE587BD, _utf8mb4 0xE694B6E8978FE59E8BE6B4BBE58B95E98280E8AB8BE587BDEFBC8CE981A9E59088E5858CE68F9BE5B088E5B1ACE6B4BBE58B95E8B387E6A0BCE38082, 30000, 'shopHighRollerInvite', 9, 1),
    ('lucky-charm', _utf8mb4 0xE5B9B8E9818BE6989FE8ADB7E7ACA6, _utf8mb4 0xE4BD8EE99680E6AABBE694B6E8978FE78D8EE58BB5EFBC8CE981A9E59088E696B0E6898BE5AE8CE68890E4BBBBE58B99E5BE8CE5858CE68F9BE38082, 5000, 'shopLuckyCharm', 10, 1);

-- -------------------------------------------------------
-- monthly_reward_claims：月度累計簽到獎勵領取紀錄
-- 玩家當月「累計」（非連續）簽到天數達里程碑（10/20/28 天）可手動領取大獎
-- UNIQUE(player_id, reward_month, milestone_days) 防止重複領取
-- reward_month 命名刻意避開 MySQL 關鍵字 YEAR_MONTH
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_reward_claims (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    player_id      BIGINT       NOT NULL,
    reward_month   VARCHAR(7)   NOT NULL,                          -- 格式 yyyy-MM（台北時區）
    milestone_days INT          NOT NULL,                          -- 累計天數里程碑：10 / 20 / 28
    reward_amount  BIGINT       NOT NULL,
    claimed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_monthly_reward_claims      PRIMARY KEY (id),
    CONSTRAINT uq_mrc_player_month_milestone UNIQUE (player_id, reward_month, milestone_days),
    CONSTRAINT chk_mrc_reward_amount         CHECK (reward_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_mrc_player_month ON monthly_reward_claims (player_id, reward_month);
