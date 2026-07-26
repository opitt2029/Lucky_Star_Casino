package com.luckystar.rank.dto;

public record RankEntryResponse(
        Long playerId,
        String username,
        String nickname,
        String avatarUrl,
        long rank,
        long score,
        String scoreUnit,
        Long roundCount,
        Long totalBet,
        Long totalPayout,
        Double winRate
) {
    public RankEntryResponse(Long playerId, String username, long rank, long score) {
        this(playerId, username, username, null, rank, score, "星幣", null, null, null, null);
    }
}
