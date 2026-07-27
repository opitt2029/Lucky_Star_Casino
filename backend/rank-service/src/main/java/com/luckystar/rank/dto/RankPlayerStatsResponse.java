package com.luckystar.rank.dto;

public record RankPlayerStatsResponse(
        Long roundCount,
        Double winRate,
        String favoriteGame
) {}
