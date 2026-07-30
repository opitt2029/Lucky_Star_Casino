package com.luckystar.wallet.postgres.repository;

import com.luckystar.wallet.postgres.entity.WalletOutbox;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
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

    /**
     * 刪除已投遞（SENT）且送出時間早於 {@code before} 的事件列，回傳刪除筆數。
     *
     * <p>用 {@code @Modifying} 的 bulk DELETE 而非衍生查詢 {@code deleteByStatusAndSentAtBefore}：
     * 後者會先把每一列讀成 managed entity 再逐筆 delete（N+1 次 SQL），保留期外的量可能上萬筆。
     * bulk DELETE 是單一 SQL、不經 persistence context。
     *
     * <p>{@code sentAt IS NOT NULL} 的守衛是保險：SENT 理論上必有 sentAt，但若歷史資料有缺
     * （例如手動改過 status），不加守衛會讓 {@code sentAt < ?} 的比較把該列漏掉或誤判。
     */
    @Modifying
    @Query("DELETE FROM WalletOutbox o WHERE o.status = :status "
            + "AND o.sentAt IS NOT NULL AND o.sentAt < :before")
    int deleteSentBefore(@Param("status") String status, @Param("before") LocalDateTime before);
}
