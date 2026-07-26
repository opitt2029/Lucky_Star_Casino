package com.luckystar.rank.dto;

import java.util.Map;

public record RankPlayerResponse(
        Long playerId,
        String username,
        String nickname,
        String avatarUrl,
        String joinedAt,
        String friendStatus,
        Long selectedRank,
        Long globalRank,
        Long dailyRank,
        Map<String, Long> gameRanks,
        RankPlayerStatsResponse stats
) {}
