package com.luckystar.wallet.mysql.repository;

import com.luckystar.wallet.mysql.entity.WalletTransactionView;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;

/**
 * MySQL 讀端帳務流水查詢 Repository（T-025）。
 *
 * <p>由 {@code mysqlEntityManagerFactory} / {@code mysqlTransactionManager} 管理
 * （見 {@link com.luckystar.wallet.config.MysqlJpaConfig}）。僅供查詢，請勿在此做寫入。
 */
public interface WalletTransactionViewRepository extends JpaRepository<WalletTransactionView, Long> {

    /**
     * 依玩家查帳務流水，支援可選的類型過濾與日期區間，並分頁。
     *
     * <p>過濾條件採「null 即略過」語意：{@code type}/{@code from}/{@code to} 任一為 null 時，
     * 對應條件不生效，方便呼叫端組合任意維度。排序由傳入的 {@link Pageable} 決定。
     *
     * @param playerId 玩家 ID（必填）
     * @param type     交易類型 DEBIT/CREDIT/BONUS；null 表示不過濾
     * @param from     建立時間下界（含）；null 表示不限下界
     * @param to       建立時間上界（不含）；null 表示不限上界
     */
    @Query("""
            SELECT t FROM WalletTransactionView t
            WHERE t.playerId = :playerId
              AND (:type IS NULL OR t.type = :type)
              AND (:from IS NULL OR t.createdAt >= :from)
              AND (:to   IS NULL OR t.createdAt <  :to)
            """)
    Page<WalletTransactionView> search(
            @Param("playerId") Long playerId,
            @Param("type") String type,
            @Param("from") LocalDateTime from,
            @Param("to") LocalDateTime to,
            Pageable pageable);
}
