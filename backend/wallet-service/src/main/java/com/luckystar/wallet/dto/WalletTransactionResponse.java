package com.luckystar.wallet.dto;

import com.luckystar.wallet.mysql.entity.WalletTransactionView;

import java.time.LocalDateTime;

/**
 * 帳務流水查詢（T-025）單筆回傳。對外只暴露查詢所需欄位，
 * 不含 idempotency_key 等內部冪等控制欄位。
 */
public record WalletTransactionResponse(
        Long id,
        Long playerId,
        String type,
        String subType,
        Long amount,
        Long balanceBefore,
        Long balanceAfter,
        String referenceId,
        LocalDateTime createdAt) {

    public static WalletTransactionResponse from(WalletTransactionView v) {
        return new WalletTransactionResponse(
                v.getId(),
                v.getPlayerId(),
                v.getType(),
                v.getSubType(),
                v.getAmount(),
                v.getBalanceBefore(),
                v.getBalanceAfter(),
                v.getReferenceId(),
                v.getCreatedAt());
    }
}
