package com.luckystar.member.repository;

import com.luckystar.member.entity.OutboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, Long> {

    // 依建立時間由舊到新，撈出一批未發送事件（一次最多 100 筆，避免單輪過載）
    List<OutboxEvent> findTop100ByStatusOrderByCreatedAtAsc(String status);

    /**
     * 刪除已投遞（SENT）且送出時間早於 {@code before} 的事件列，回傳刪除筆數。
     * 與 wallet 的 {@code WalletOutboxRepository.deleteSentBefore} 同構，理由見
     * {@code OutboxPurgeJob} 的類別註解。
     */
    @Modifying
    @Query("DELETE FROM OutboxEvent o WHERE o.status = :status "
            + "AND o.sentAt IS NOT NULL AND o.sentAt < :before")
    int deleteSentBefore(@Param("status") String status, @Param("before") LocalDateTime before);
}
