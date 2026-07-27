package com.luckystar.wallet.postgres.repository;

import com.luckystar.wallet.postgres.entity.WalletOutbox;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

/**
 * wallet_outbox 讀寫（藍圖 04 P2）。落在 postgres.repository 套件，由
 * {@code DataSourceConfig} 的 {@code @EnableJpaRepositories} 綁 postgresEntityManagerFactory。
 */
public interface WalletOutboxRepository extends JpaRepository<WalletOutbox, Long> {

    /**
     * 依建立時間由舊到新，撈出一批未發送事件；批次大小由呼叫端以 {@link Pageable} 決定
     * （見 {@code wallet.outbox.batch-size}）。原本寫死 100/輪，在高負載下成為 outbox
     * 投遞吞吐瓶頸（T-090 遠端壓測 2026-07-23），故改為可調批次。
     */
    List<WalletOutbox> findByStatusOrderByCreatedAtAsc(String status, Pageable pageable);

    /** 觀測用（P5）：目前積壓的待發事件數。 */
    long countByStatus(String status);
}
