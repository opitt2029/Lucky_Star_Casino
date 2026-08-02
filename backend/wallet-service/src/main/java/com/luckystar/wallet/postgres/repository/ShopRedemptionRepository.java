package com.luckystar.wallet.postgres.repository;

import com.luckystar.wallet.postgres.entity.ShopRedemption;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.List;
import java.util.Optional;

/** PostgreSQL repository for shop redemptions and player inventory. */
public interface ShopRedemptionRepository extends JpaRepository<ShopRedemption, Long> {

    Optional<ShopRedemption> findByIdempotencyKey(String idempotencyKey);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<ShopRedemption> findByIdAndPlayerId(Long id, Long playerId);

    List<ShopRedemption> findByPlayerIdOrderByCreatedAtDesc(Long playerId);
}