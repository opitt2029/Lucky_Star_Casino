package com.luckystar.game.client.dto;

/**
 * {@code POST /internal/wallet/credit} 的回應 data。欄位對齊 wallet-service 的 CreditResponse。
 * game-service 主要使用 {@code balanceAfter} 與 {@code frozenAfter}。
 */
public record WalletCreditResponse(
        Long transactionId,
        Long playerId,
        Long amount,
        Long balanceBefore,
        Long balanceAfter,
        Long frozenAfter,
        boolean idempotent) {
}
