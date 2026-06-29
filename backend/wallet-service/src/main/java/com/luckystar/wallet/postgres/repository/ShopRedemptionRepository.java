package com.luckystar.wallet.postgres.repository;

import com.luckystar.wallet.postgres.entity.ShopRedemption;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 商城兌換紀錄（PostgreSQL 寫端）。供冪等查詢與玩家背包/履歷讀取。
 */
public interface ShopRedemptionRepository extends JpaRepository<ShopRedemption, Long> {

    Optional<ShopRedemption> findByIdempotencyKey(String idempotencyKey);

    /** 玩家背包/兌換履歷（新到舊）。 */
    List<ShopRedemption> findByPlayerIdOrderByCreatedAtDesc(Long playerId);
}
