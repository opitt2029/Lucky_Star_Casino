-- ============================================================
-- Flyway Migration V17：wallet Transactional Outbox 事件表（藍圖 04 P2）
-- 幸運星幣城 — WalletService credit/debit 原本在交易 commit 後才「裸發」Kafka
-- （kafkaTemplate.send() 非同步、未 .get() 也未掛 callback），broker 失敗發生在
-- 背景執行緒、連 log.warn 都不會印 → wallet.credit/wallet.debit 事件無聲丟失，
-- 下游三方（MySQL 讀視圖 / rank 排行 / admin 流通量報表）同時漂移且無人察覺。
--
-- 修法＝Transactional Outbox：把「待發事件」與帳務異動寫進**同一個 Postgres 交易**
-- （原子、不會半套），背景 WalletOutboxPoller 再同步 send().get(10s) 確認送達才標 SENT。
-- 欄位比照 member 的 outbox_events（database/mysql/migration/V3__create_outbox_events.sql）。
-- 放 Postgres（wallet 寫庫）因為要與 wallet_transactions 進同一交易。
-- ============================================================

CREATE TABLE IF NOT EXISTS wallet_outbox (
    id          BIGSERIAL    NOT NULL,
    topic       VARCHAR(100) NOT NULL,                     -- 目標 Kafka topic（wallet.credit / wallet.debit）
    kafka_key   VARCHAR(100),                              -- Kafka message key（playerId，可為 NULL）
    payload     TEXT         NOT NULL,                     -- JSON 事件內容
    status      VARCHAR(20)  NOT NULL DEFAULT 'PENDING',   -- PENDING / SENT
    retry_count INT          NOT NULL DEFAULT 0,           -- 投遞失敗累加，供觀測/告警（P5 積壓指標）
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at     TIMESTAMP,                                 -- 成功投遞時間
    CONSTRAINT pk_wallet_outbox         PRIMARY KEY (id),
    CONSTRAINT chk_wallet_outbox_status CHECK (status IN ('PENDING', 'SENT'))
);

-- 支援 poller「依建立時間順序撈 PENDING」（findTop100ByStatusOrderByCreatedAtAsc）
CREATE INDEX IF NOT EXISTS idx_wallet_outbox_status_created ON wallet_outbox (status, created_at);
