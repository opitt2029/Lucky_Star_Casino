package com.luckystar.wallet.kafka;

/**
 * 扣款完成事件，發布到 Kafka topic {@code wallet.debit}。
 *
 * <p>{@code subType} 標示扣款來源：下注為 {@code BET}（T-022）、好友贈送出帳為 {@code GIFT}（T-026）。
 * 早期版本沒有此欄位，消費端（{@link WalletReadSyncListener#onDebit}）對 null 回退為 {@code BET}
 * 以相容仍在 topic 中的舊訊息。
 */
public record WalletDebitEvent(
        Long transactionId,
        Long playerId,
        Long amount,
        Long balanceBefore,
        Long balanceAfter,
        String subType,
        String idempotencyKey,
        String referenceId
) {}
