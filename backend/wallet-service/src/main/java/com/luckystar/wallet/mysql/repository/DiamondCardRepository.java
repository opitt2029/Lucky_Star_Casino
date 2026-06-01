package com.luckystar.wallet.mysql.repository;

import com.luckystar.wallet.mysql.entity.DiamondCard;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * 鑽石點數卡 Repository（T-102）。由 {@code mysqlEntityManagerFactory} /
 * {@code mysqlTransactionManager} 管理（見 {@link com.luckystar.wallet.config.MysqlJpaConfig}）。
 */
public interface DiamondCardRepository extends JpaRepository<DiamondCard, Long> {

    Optional<DiamondCard> findByCardCode(String cardCode);

    /**
     * 防重複兌換的核心：條件式 UPDATE（compare-and-swap）。只在 {@code is_redeemed = false} 時才把序號標記為
     * 已兌換。並發雙擊時，DB 的列鎖 + 條件保證只有一個交易能讓回傳列數為 1，其餘皆為 0（代表已被別人兌換）。
     *
     * @return 受影響列數：1 = 本次成功兌換；0 = 序號不存在或已被兌換
     */
    @Modifying
    @Query("UPDATE DiamondCard c SET c.isRedeemed = true, c.redeemedBy = :playerId, c.redeemedAt = :redeemedAt "
            + "WHERE c.cardCode = :cardCode AND c.isRedeemed = false")
    int markRedeemed(@Param("cardCode") String cardCode,
                     @Param("playerId") Long playerId,
                     @Param("redeemedAt") LocalDateTime redeemedAt);

    /**
     * 補償用：把先前已標記兌換的序號回復為未兌換（清掉 redeemedBy/redeemedAt）。僅在「序號已 CAS 標記成功、
     * 但後續鑽石入帳失敗」時呼叫，讓玩家能重試兌換。見 {@link com.luckystar.wallet.service.DiamondRedeemService}。
     *
     * @return 受影響列數（正常為 1）
     */
    @Modifying
    @Query("UPDATE DiamondCard c SET c.isRedeemed = false, c.redeemedBy = null, c.redeemedAt = null "
            + "WHERE c.cardCode = :cardCode AND c.isRedeemed = true")
    int revertRedemption(@Param("cardCode") String cardCode);
}
