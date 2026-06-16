package com.luckystar.admin.dto;

import java.time.LocalDateTime;
import java.util.List;

/** 玩家詳情（T-051）：基本資料 + 餘額 + 近期帳務 + 近期對局。 */
public record PlayerDetail(
        Long playerId,
        String username,
        String nickname,
        String email,
        String role,
        String status,
        boolean disabled,
        LocalDateTime createdAt,
        long balance,
        long frozenAmount,
        List<TransactionView> recentTransactions,
        List<GameRoundView> recentRounds
) {

    /** 帳務流水視圖。 */
    public record TransactionView(
            Long id,
            String type,
            String subType,
            long amount,
            Long balanceAfter,
            String referenceId,
            LocalDateTime createdAt
    ) {}

    /** 對局紀錄視圖。 */
    public record GameRoundView(
            String roundId,
            String gameType,
            Long betAmount,
            Long winAmount,
            String status,
            LocalDateTime createdAt
    ) {}
}
