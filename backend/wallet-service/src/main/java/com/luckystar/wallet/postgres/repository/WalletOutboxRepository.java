package com.luckystar.wallet.postgres.repository;

import com.luckystar.wallet.postgres.entity.WalletOutbox;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

/**
 * wallet_outbox 讀寫（藍圖 04 P2）。落在 postgres.repository 套件，由
 * {@code DataSourceConfig} 的 {@code @EnableJpaRepositories} 綁 postgresEntityManagerFactory。
 */
public interface WalletOutboxRepository extends JpaRepository<WalletOutbox, Long> {

    /** 依建立時間由舊到新，撈出一批未發送事件（一次最多 100 筆，避免單輪過載）。 */
    List<WalletOutbox> findTop100ByStatusOrderByCreatedAtAsc(String status);

    /** 觀測用（P5）：目前積壓的待發事件數。 */
    long countByStatus(String status);
}
