package com.luckystar.wallet.postgres.repository;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import javax.sql.DataSource;
import java.util.Optional;

/**
 * T-090 B2：debit 熱路徑的 2 往返 JDBC DAO（設計紀錄：docs/performance/T-090-B2-debit-roundtrip-design.md）。
 *
 * <p>把舊流程的 4 次往返（冪等 SELECT、載入錢包 SELECT、UPDATE wallets、INSERT 流水）壓成 2 次：
 * <ol>
 *   <li>{@link #deductIfSufficientAndKeyUnused}：條件 UPDATE 一次完成「冪等預檢（NOT EXISTS 唯一索引點查）
 *       ＋可用餘額守衛（balance - frozen_amount）＋扣款＋version 遞增」，RETURNING 取回扣款後餘額。
 *       0 列＝冷路徑（冪等命中 / 錢包不存在 / 餘額不足），由呼叫端補查區分——那三種都不在熱路徑上。</li>
 *   <li>{@link #insertDebitTransaction}：INSERT 流水並以 ON CONFLICT 原子判定冪等鍵衝突（不炸交易），
 *       RETURNING 取回流水 id。空＝極窄併發同鍵競態，由呼叫端補償回沖。</li>
 * </ol>
 *
 * <p>為什麼用 JDBC 而非 JPA：RETURNING / ON CONFLICT 是語句級原子性的關鍵，JPA 的讀改寫模型表達不了；
 * JdbcTemplate 掛在同一個 postgres DataSource 上，{@code JpaTransactionManager} 會讓它 join
 * {@code @Transactional(postgresTransactionManager)} 的同一條連線與交易，交易邊界不變。
 *
 * <p>方言分流（雷區 3）：H2 2.2.224（含 MODE=PostgreSQL）不支援 RETURNING 與 ON CONFLICT ... RETURNING，
 * 測試環境改用等價的 data change delta table（{@code SELECT ... FROM FINAL TABLE (...)}）；
 * H2 的 UNIQUE 違規僅 statement 級（不像 PG 會 abort 整筆交易），故以捕捉 {@link DuplicateKeyException}
 * 等價替代 ON CONFLICT。流程邏輯兩方言共用，真 PG 語法由 ADR-007 Testcontainers 測試守門。
 */
@Repository
public class WalletDebitDao {

    private static final String PG_CONDITIONAL_DEBIT = """
            UPDATE wallets
               SET balance = balance - ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
             WHERE player_id = ?
               AND balance - frozen_amount >= ?
               AND NOT EXISTS (SELECT 1 FROM wallet_transactions t WHERE t.idempotency_key = ?)
            RETURNING balance
            """;

    private static final String H2_CONDITIONAL_DEBIT = """
            SELECT balance FROM FINAL TABLE (
                UPDATE wallets
                   SET balance = balance - ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
                 WHERE player_id = ?
                   AND balance - frozen_amount >= ?
                   AND NOT EXISTS (SELECT 1 FROM wallet_transactions t WHERE t.idempotency_key = ?)
            )
            """;

    private static final String PG_INSERT_TX = """
            INSERT INTO wallet_transactions
                   (player_id, type, sub_type, amount, balance_before, balance_after,
                    idempotency_key, reference_id, created_at)
            VALUES (?, 'DEBIT', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id
            """;

    private static final String H2_INSERT_TX = """
            SELECT id FROM FINAL TABLE (
                INSERT INTO wallet_transactions
                       (player_id, type, sub_type, amount, balance_before, balance_after,
                        idempotency_key, reference_id, created_at)
                VALUES (?, 'DEBIT', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            )
            """;

    private static final String RESTORE_BALANCE = """
            UPDATE wallets
               SET balance = balance + ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
             WHERE player_id = ?
            """;

    private final JdbcTemplate jdbc;

    /** 首次使用時偵測一次；volatile 讓併發首呼叫最多重複偵測、不會讀到半初始化值。 */
    private volatile Boolean h2;

    public WalletDebitDao(@Qualifier("postgresDataSource") DataSource postgresDataSource) {
        this.jdbc = new JdbcTemplate(postgresDataSource);
    }

    /**
     * 往返 1：條件扣款。
     *
     * @return 扣款後餘額；empty＝未扣款（冪等命中 / 錢包不存在 / 可用餘額不足，呼叫端補查區分）
     */
    public Optional<Long> deductIfSufficientAndKeyUnused(long playerId, long amount, String idempotencyKey) {
        String sql = isH2() ? H2_CONDITIONAL_DEBIT : PG_CONDITIONAL_DEBIT;
        return jdbc.query(sql,
                rs -> rs.next() ? Optional.of(rs.getLong(1)) : Optional.<Long>empty(),
                amount, playerId, amount, idempotencyKey);
    }

    /**
     * 往返 2：寫入 DEBIT 流水，冪等鍵衝突時原子略過。
     *
     * @return 流水 id；empty＝同鍵流水已存在（併發同鍵競態，呼叫端需補償回沖並回查贏家）
     */
    public Optional<Long> insertDebitTransaction(long playerId, String subType, long amount,
                                                 long balanceBefore, long balanceAfter,
                                                 String idempotencyKey, String referenceId) {
        if (isH2()) {
            try {
                return jdbc.query(H2_INSERT_TX,
                        rs -> rs.next() ? Optional.of(rs.getLong(1)) : Optional.<Long>empty(),
                        playerId, subType, amount, balanceBefore, balanceAfter, idempotencyKey, referenceId);
            } catch (DuplicateKeyException e) {
                return Optional.empty();
            }
        }
        return jdbc.query(PG_INSERT_TX,
                rs -> rs.next() ? Optional.of(rs.getLong(1)) : Optional.<Long>empty(),
                playerId, subType, amount, balanceBefore, balanceAfter, idempotencyKey, referenceId);
    }

    /**
     * 併發同鍵競態的原地補償：把往返 1 已扣的金額加回（同一交易內，行鎖已在手），淨額歸零。
     * 不用 rollback 是因為 debit 可能 join 外層交易（如商城兌換），丟例外會拖垮整筆外層交易。
     */
    public void restoreBalance(long playerId, long amount) {
        int updated = jdbc.update(RESTORE_BALANCE, amount, playerId);
        if (updated != 1) {
            // 理論上不可能：往返 1 才剛更新過同一列且行鎖持有中
            throw new IllegalStateException(
                    "Compensating balance restore affected " + updated + " rows for playerId=" + playerId);
        }
    }

    private boolean isH2() {
        Boolean cached = h2;
        if (cached == null) {
            cached = Boolean.TRUE.equals(jdbc.execute((java.sql.Connection con) ->
                    "H2".equalsIgnoreCase(con.getMetaData().getDatabaseProductName())));
            h2 = cached;
        }
        return cached;
    }
}
