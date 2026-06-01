package com.luckystar.wallet.postgres.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 消費失敗轉入 DLT 的訊息紀錄（T-028）。
 *
 * <p>當 listener 重試 3 次仍失敗，{@code DefaultErrorHandler} 會把訊息送進 {@code <topic>.DLT}；
 * {@link com.luckystar.wallet.kafka.DeadLetterListener} 接手後將原始 payload 與失敗原因落入本表，
 * 供 Admin 查詢與手動重試（重發原 payload 回 {@link #originalTopic}）。
 *
 * <p>寫於 PostgreSQL 寫庫（@Primary，{@code postgresEntityManagerFactory}）。
 */
@Entity
@Table(name = "dead_letter_messages")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DeadLetterMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 失敗訊息所在的 DLT topic，如 {@code wallet.credit.DLT}。 */
    @Column(name = "dlt_topic", nullable = false, length = 100)
    private String dltTopic;

    /** 原始 topic（重試時重發的目標），如 {@code wallet.credit}。 */
    @Column(name = "original_topic", nullable = false, length = 100)
    private String originalTopic;

    /** Kafka record key（通常為 playerId），可為 null。 */
    @Column(name = "message_key", length = 255)
    private String messageKey;

    /** 原始訊息內容（JSON 字串）。 */
    @Column(name = "payload", nullable = false, columnDefinition = "TEXT")
    private String payload;

    /** 失敗例外的完整類名（FQCN）。 */
    @Column(name = "exception_class", length = 255)
    private String exceptionClass;

    /** 例外訊息。 */
    @Column(name = "failure_reason", columnDefinition = "TEXT")
    private String failureReason;

    /** 截斷後的堆疊（最多 4000 字，避免 TEXT 無限膨脹）。 */
    @Column(name = "stack_trace", columnDefinition = "TEXT")
    private String stackTrace;

    /** FAILED（待處理）/ RETRIED（已重試）/ RESOLVED（已解決）。 */
    @Column(name = "status", nullable = false, length = 20)
    private String status;

    /** 已手動重試次數。 */
    @Column(name = "retry_count", nullable = false)
    private Integer retryCount;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "last_retried_at")
    private LocalDateTime lastRetriedAt;

    @PrePersist
    void prePersist() {
        if (this.createdAt == null) {
            this.createdAt = LocalDateTime.now();
        }
        if (this.status == null) {
            this.status = "FAILED";
        }
        if (this.retryCount == null) {
            this.retryCount = 0;
        }
    }
}
