package com.luckystar.rank.dto;

public record RankEntryResponse(
        Long playerId,
        long rank,
        long coins
) {}
