package com.luckystar.game.client.dto;

/**
 * {@code POST /internal/wallet/debit} 的回應 data。欄位對齊 wallet-service 的 DebitResponse。
 * 多餘欄位忽略；game-service 主要使用 {@code balanceAfter}。
 */
public record WalletDebitResponse(
        Long transactionId,
        Long playerId,
        Long amount,
        Long balanceBefore,
        Long balanceAfter,
        boolean idempotent) {
}
