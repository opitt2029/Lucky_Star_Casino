package com.luckystar.wallet.dto;

import java.time.LocalDateTime;

/**
 * DLT 訊息手動重試結果（T-028）。對應 {@code POST /internal/wallet/dlt/{id}/retry}。
 *
 * <p>回傳重發的原始 topic、更新後狀態與累計重試次數，方便 Admin 介面即時更新顯示。
 */
public record DeadLetterRetryResponse(
        Long id,
        String originalTopic,
        String status,
        Integer retryCount,
        LocalDateTime retriedAt) {
}
