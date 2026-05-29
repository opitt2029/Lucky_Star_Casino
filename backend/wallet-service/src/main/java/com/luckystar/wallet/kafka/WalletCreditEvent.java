package com.luckystar.wallet.kafka;

public record WalletCreditEvent(
        Long transactionId,
        Long playerId,
        Long amount,
        Long balanceBefore,
        Long balanceAfter,
        String idempotencyKey,
        String referenceId
) {}
