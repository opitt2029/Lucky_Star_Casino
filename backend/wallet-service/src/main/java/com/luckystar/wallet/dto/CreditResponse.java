package com.luckystar.wallet.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class CreditResponse {

    private Long transactionId;
    private Long playerId;
    private Long amount;
    private Long balanceBefore;
    private Long balanceAfter;
    private boolean idempotent;
}
