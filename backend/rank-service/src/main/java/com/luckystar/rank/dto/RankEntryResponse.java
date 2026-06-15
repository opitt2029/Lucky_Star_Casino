package com.luckystar.rank.dto;

public record RankEntryResponse(
        Long playerId,
        String username,
        long rank,
        long score
) {}
