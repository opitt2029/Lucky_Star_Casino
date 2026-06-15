package com.luckystar.admin.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * {@code wallet.credit} / {@code wallet.debit} 事件（唯讀偵測用；admin 絕不重新入帳）。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record WalletEvent(
        Long transactionId,
        Long playerId,
        Long amount,
        Long balanceAfter,
        String subType,
        String idempotencyKey,
        String referenceId) {
}
