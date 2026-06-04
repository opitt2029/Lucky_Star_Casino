package com.luckystar.rank.service;

import com.luckystar.rank.dto.RankEntryResponse;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Service;

@Service
public class RankService {

    public static final String GLOBAL_COINS_KEY = "rank:global:coins";
    public static final int GLOBAL_TOP_LIMIT = 100;

    private final StringRedisTemplate redisTemplate;

    public RankService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void updatePlayerCoins(Long playerId, Long currentCoins) {
        Objects.requireNonNull(playerId, "playerId is required");
        Objects.requireNonNull(currentCoins, "currentCoins is required");
        if (currentCoins < 0) {
            throw new IllegalArgumentException("currentCoins must be greater than or equal to 0");
        }

        redisTemplate.opsForZSet().add(GLOBAL_COINS_KEY, playerId.toString(), currentCoins.doubleValue());
    }

    public Optional<RankEntryResponse> getGlobalRank(Long playerId) {
        Objects.requireNonNull(playerId, "playerId is required");

        String member = playerId.toString();
        Long zeroBasedRank = redisTemplate.opsForZSet().reverseRank(GLOBAL_COINS_KEY, member);
        Double score = redisTemplate.opsForZSet().score(GLOBAL_COINS_KEY, member);

        if (zeroBasedRank == null || score == null) {
            return Optional.empty();
        }

        return Optional.of(new RankEntryResponse(playerId, zeroBasedRank + 1, score.longValue()));
    }

    public List<RankEntryResponse> getTopGlobalCoins() {
        return getTopGlobalCoins(GLOBAL_TOP_LIMIT);
    }

    public List<RankEntryResponse> getTopGlobalCoins(int limit) {
        int boundedLimit = Math.max(0, Math.min(limit, GLOBAL_TOP_LIMIT));
        if (boundedLimit == 0) {
            return Collections.emptyList();
        }

        Set<ZSetOperations.TypedTuple<String>> tuples = redisTemplate.opsForZSet()
                .reverseRangeWithScores(GLOBAL_COINS_KEY, 0, boundedLimit - 1L);
        if (tuples == null || tuples.isEmpty()) {
            return Collections.emptyList();
        }

        List<RankEntryResponse> result = new ArrayList<>(tuples.size());
        long rank = 1;
        for (ZSetOperations.TypedTuple<String> tuple : tuples) {
            String value = tuple.getValue();
            Double score = tuple.getScore();
            if (value != null && score != null) {
                result.add(new RankEntryResponse(Long.valueOf(value), rank, score.longValue()));
            }
            rank++;
        }
        return result;
    }
}
