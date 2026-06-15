package com.luckystar.rank.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record WalletBalanceChangedEvent(
        Long transactionId,
        Long playerId,
        Long amount,
        Long balanceBefore,
        Long balanceAfter,
        String subType,
        String idempotencyKey,
        String referenceId
) {}
