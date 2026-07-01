-- ============================================================
-- Flyway Migration V10：MySQL 新增禮品商城目錄表 shop_items + sub_type SHOP_PURCHASE
-- 幸運星幣城 — 禮品商城後端化（ADR-006）。shop_items 為目錄（admin-service 管理 CRUD、
-- wallet-service 讀取列目錄/驗價），屬 CQRS 查詢讀端（ADR-001）。兌換紀錄 shop_redemptions
-- 在 PostgreSQL（帳務寫端）。兌換以星幣扣款（sub_type=SHOP_PURCHASE），故讀庫副本的
-- wallet_transactions 也需放行該子型。
-- ============================================================

-- -------------------------------------------------------
-- shop_items：禮品商城目錄
-- item_code 唯一（前端/兌換以 code 對應）；active 控制上下架；sort_order 控制顯示順序。
-- cost_star 為星幣定價。asset_key 對應前端圖片資產鍵。
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
    CONSTRAINT pk_shop_items          PRIMARY KEY (id),
    CONSTRAINT uq_shop_items_code     UNIQUE (item_code),
    CONSTRAINT chk_shop_items_cost    CHECK (cost_star > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_shop_items_active ON shop_items (active, sort_order);

-- Seed 現有三項商品（對齊前端 shopCatalog / theme/backgroundTheme.js）
INSERT INTO shop_items (item_code, name, caption, cost_star, asset_key, sort_order, active) VALUES
    ('vip-ticket',   'VIP 入場券',  '可兌換活動或限時桌台資格',   12000, 'shopPrizeA', 1, 1),
    ('avatar-frame', '會員頭像框',  '讓會員頭像更有辨識度',        8000, 'shopPrizeB', 2, 1),
    ('bonus-box',    '幸運禮盒',    '適合兌換活動獎勵或驚喜禮品', 20000, 'shopPrizeC', 3, 1);

-- -------------------------------------------------------
-- 擴充 wallet_transactions（讀庫副本）.sub_type 允許 'SHOP_PURCHASE'
-- -------------------------------------------------------
ALTER TABLE wallet_transactions
    DROP CHECK chk_wt_sub_type;

ALTER TABLE wallet_transactions
    ADD CONSTRAINT chk_wt_sub_type
        CHECK (sub_type IN ('BET', 'WIN', 'CHECKIN', 'TASK', 'GIFT', 'GM_REWARD',
                            'BANKRUPTCY_AID', 'DIAMOND_EXCHANGE', 'TOPUP', 'CASHBACK', 'REFUND',
                            'MONTHLY_REWARD', 'SHOP_PURCHASE'));
