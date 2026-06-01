package com.luckystar.wallet.dto;

import com.luckystar.wallet.postgres.entity.DeadLetterMessage;

import java.time.LocalDateTime;

/**
 * DLT 失敗訊息查詢單筆回傳（T-028）。
 *
 * <p>對 Admin 暴露查詢與重試所需欄位；不含完整 {@code stackTrace}（避免列表回傳過大，
 * 需要時可由 DB 直接查）。
 */
public record DeadLetterMessageResponse(
        Long id,
        String dltTopic,
        String originalTopic,
        String messageKey,
        String payload,
        String exceptionClass,
        String failureReason,
        String status,
        Integer retryCount,
        LocalDateTime createdAt,
        LocalDateTime lastRetriedAt) {

    public static DeadLetterMessageResponse from(DeadLetterMessage m) {
        return new DeadLetterMessageResponse(
                m.getId(),
                m.getDltTopic(),
                m.getOriginalTopic(),
                m.getMessageKey(),
                m.getPayload(),
                m.getExceptionClass(),
                m.getFailureReason(),
                m.getStatus(),
                m.getRetryCount(),
                m.getCreatedAt(),
                m.getLastRetriedAt());
    }
}
