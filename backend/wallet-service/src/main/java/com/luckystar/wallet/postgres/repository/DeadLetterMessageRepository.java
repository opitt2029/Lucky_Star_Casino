package com.luckystar.wallet.postgres.repository;

import com.luckystar.wallet.postgres.entity.DeadLetterMessage;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * {@link DeadLetterMessage} 資料存取（T-028，PostgreSQL 寫庫）。
 *
 * <p>提供 Admin 查詢用的狀態 / DLT topic 過濾分頁查詢。
 */
public interface DeadLetterMessageRepository extends JpaRepository<DeadLetterMessage, Long> {

    Page<DeadLetterMessage> findByStatus(String status, Pageable pageable);

    Page<DeadLetterMessage> findByDltTopic(String dltTopic, Pageable pageable);

    Page<DeadLetterMessage> findByStatusAndDltTopic(String status, String dltTopic, Pageable pageable);
}
