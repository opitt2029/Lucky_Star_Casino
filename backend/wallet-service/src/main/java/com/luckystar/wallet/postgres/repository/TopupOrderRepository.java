package com.luckystar.wallet.postgres.repository;

import com.luckystar.wallet.postgres.entity.TopupOrder;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TopupOrderRepository extends JpaRepository<TopupOrder, Long> {

    /** 取某玩家的訂單，依建立時間新到舊。 */
    List<TopupOrder> findByPlayerIdOrderByCreatedAtDesc(Long playerId);

    /** 依 id + 玩家查單，確保玩家只能操作自己的訂單。 */
    Optional<TopupOrder> findByIdAndPlayerId(Long id, Long playerId);
}
