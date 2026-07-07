package com.luckystar.game.compensation;

import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PendingWalletCreditRepository extends JpaRepository<PendingWalletCredit, Long> {

    boolean existsByIdempotencyKey(String idempotencyKey);

    /** 撈到期待重試的補償單（每輪上限 50 筆，防單輪佔用排程過久；下一輪 30 秒後接續）。 */
    List<PendingWalletCredit> findTop50ByStatusAndNextRetryAtLessThanEqualOrderByIdAsc(
            String status, LocalDateTime now);
}
