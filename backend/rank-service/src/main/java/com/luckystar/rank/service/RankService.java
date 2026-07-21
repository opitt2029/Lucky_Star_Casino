package com.luckystar.rank.service;

import com.luckystar.rank.dto.RankEntryResponse;
import com.luckystar.rank.dto.PlayerCoinBalance;
import com.luckystar.rank.kafka.RankUpdatePublisher;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.data.redis.core.DefaultTypedTuple;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Service;

@Service
public class RankService {

    public static final String GLOBAL_COINS_KEY = "rank:global:coins";
    public static final int GLOBAL_TOP_LIMIT = 100;
    public static final String FRIEND_COINS_KEY_PREFIX = "rank:friend:";
    public static final int FRIEND_TOP_LIMIT = 20;
    public static final Duration FRIEND_RANK_TTL = Duration.ofHours(24);
    public static final String PLAYER_USERNAME_KEY = "rank:player:usernames";

    // T-045 今日贏幣王
    public static final String DAILY_WINNINGS_KEY = "rank:daily:winnings";
    public static final int DAILY_WINNINGS_TOP_LIMIT = 100;

    // T-073 排行榜廣播
    public static final int GLOBAL_TOP10_LIMIT = 10;
    private static final long MIN_BROADCAST_INTERVAL_MS = 1000L;

    // 藍圖 04 P3：廣播查詢節流鎖。放在 ZREVRANGE 查詢「之前」，讓每筆事件不都打一次 Redis 查詢；
    // 用 Redis SETNX 而非 JVM 記憶體，讓多副本共用同一把節流閘（單副本亦正確）。
    private static final String BROADCAST_LOCK_KEY = "rank:broadcast:lock";
    private static final Duration BROADCAST_LOCK_TTL = Duration.ofSeconds(3);

    private final StringRedisTemplate redisTemplate;
    private final RankUpdatePublisher rankUpdatePublisher;

    private volatile List<Long> lastTop10PlayerIds = List.of();
    private volatile long lastBroadcastAt = 0L;

    public RankService(StringRedisTemplate redisTemplate, RankUpdatePublisher rankUpdatePublisher) {
        this.redisTemplate = redisTemplate;
        this.rankUpdatePublisher = rankUpdatePublisher;
    }

    public void updatePlayerCoins(Long playerId, Long currentCoins) {
        Objects.requireNonNull(playerId, "playerId is required");
        Objects.requireNonNull(currentCoins, "currentCoins is required");
        if (currentCoins < 0) {
            throw new IllegalArgumentException("currentCoins must be greater than or equal to 0");
        }

        redisTemplate.opsForZSet().add(GLOBAL_COINS_KEY, playerId.toString(), currentCoins.doubleValue());
        maybeBroadcastTop10();
    }

    /**
     * 今日贏幣王累加（T-045）：今日 key ZINCRBY；僅首次寫入設 48h TTL；忽略非正數金額。
     */
    public void addDailyWinnings(Long playerId, long amount) {
        Objects.requireNonNull(playerId, "playerId is required");
        if (amount <= 0) {
            return;
        }

        redisTemplate.opsForZSet().incrementScore(DAILY_WINNINGS_KEY, playerId.toString(), amount);
    }

    public void resetDailyWinnings() {
        redisTemplate.delete(DAILY_WINNINGS_KEY);
    }

    public List<RankEntryResponse> getTopDailyWinnings(int limit) {
        int boundedLimit = Math.max(0, Math.min(limit, DAILY_WINNINGS_TOP_LIMIT));
        return readTopRank(DAILY_WINNINGS_KEY, boundedLimit);
    }

    public Optional<RankEntryResponse> getDailyWinningsRank(Long playerId) {
        Objects.requireNonNull(playerId, "playerId is required");

        String member = playerId.toString();
        Long zeroBasedRank = redisTemplate.opsForZSet().reverseRank(DAILY_WINNINGS_KEY, member);
        Double score = redisTemplate.opsForZSet().score(DAILY_WINNINGS_KEY, member);

        if (zeroBasedRank == null || score == null) {
            return Optional.empty();
        }

        HashOperations<String, String, String> hashOperations = redisTemplate.opsForHash();
        String username = hashOperations.get(PLAYER_USERNAME_KEY, member);
        return Optional.of(new RankEntryResponse(
                playerId,
                username,
                zeroBasedRank + 1,
                score.longValue()));
    }

    private void maybeBroadcastTop10() {
        // 先過 Redis 節流鎖：3 秒內只有一個呼叫（跨副本）能進來，避免每筆事件都打一次 ZREVRANGE。
        // 閘門要放在昂貴操作「之前」，不是之後（與前端 SoundEngine 的 per-id 節流同一概念）。
        if (!Boolean.TRUE.equals(
                redisTemplate.opsForValue().setIfAbsent(BROADCAST_LOCK_KEY, "1", BROADCAST_LOCK_TTL))) {
            return;
        }
        // 保留既有「名單有變才發」的內容比對：與時間節流互補（時間窗 + 內容變動兩層過濾最省）。
        List<RankEntryResponse> top10 = getTopGlobalCoins(GLOBAL_TOP10_LIMIT);
        List<Long> ids = top10.stream().map(RankEntryResponse::playerId).toList();
        long now = System.currentTimeMillis();
        if (shouldBroadcast(ids, now)) {
            lastTop10PlayerIds = ids;
            lastBroadcastAt = now;
            rankUpdatePublisher.publishTop10(top10);
        }
    }

    boolean shouldBroadcast(List<Long> currentTop10Ids, long now) {
        if (currentTop10Ids.equals(lastTop10PlayerIds)) {
            return false; // 順序敏感：TOP10 名單未變不廣播
        }
        if (now - lastBroadcastAt < MIN_BROADCAST_INTERVAL_MS) {
            return false; // 節流：距上次廣播未滿 1 秒
        }
        return true;
    }

    public void updatePlayerUsername(Long playerId, String username) {
        Objects.requireNonNull(playerId, "playerId is required");
        Objects.requireNonNull(username, "username is required");
        if (username.isBlank()) {
            throw new IllegalArgumentException("username is required");
        }

        redisTemplate.opsForHash().put(PLAYER_USERNAME_KEY, playerId.toString(), username);
    }

    public Optional<RankEntryResponse> getGlobalRank(Long playerId) {
        Objects.requireNonNull(playerId, "playerId is required");

        String member = playerId.toString();
        Long zeroBasedRank = redisTemplate.opsForZSet().reverseRank(GLOBAL_COINS_KEY, member);
        Double score = redisTemplate.opsForZSet().score(GLOBAL_COINS_KEY, member);

        if (zeroBasedRank == null || score == null) {
            return Optional.empty();
        }

        HashOperations<String, String, String> hashOperations = redisTemplate.opsForHash();
        String username = hashOperations.get(PLAYER_USERNAME_KEY, playerId.toString());
        return Optional.of(new RankEntryResponse(
                playerId,
                username,
                zeroBasedRank + 1,
                score.longValue()));
    }

    public List<RankEntryResponse> getTopGlobalCoins() {
        return getTopGlobalCoins(GLOBAL_TOP_LIMIT);
    }

    public List<RankEntryResponse> getTopGlobalCoins(int limit) {
        int boundedLimit = Math.max(0, Math.min(limit, GLOBAL_TOP_LIMIT));
        return readTopRank(GLOBAL_COINS_KEY, boundedLimit);
    }

    public void clearGlobalCoinsRank() {
        redisTemplate.delete(GLOBAL_COINS_KEY);
    }

    public int rebuildGlobalCoinsRank(List<PlayerCoinBalance> balances) {
        Objects.requireNonNull(balances, "balances is required");

        redisTemplate.delete(GLOBAL_COINS_KEY);
        Set<ZSetOperations.TypedTuple<String>> tuples = balances.stream()
                .filter(Objects::nonNull)
                .filter(balance -> balance.playerId() != null)
                .filter(balance -> balance.balance() != null && balance.balance() >= 0)
                .map(balance -> new DefaultTypedTuple<>(
                        balance.playerId().toString(),
                        balance.balance().doubleValue()))
                .collect(Collectors.toCollection(LinkedHashSet::new));
        if (tuples.isEmpty()) {
            return 0;
        }

        redisTemplate.opsForZSet().add(GLOBAL_COINS_KEY, tuples);
        return tuples.size();
    }

    public void rebuildFriendRank(Long playerId, List<Long> friendIds) {
        Objects.requireNonNull(playerId, "playerId is required");
        Objects.requireNonNull(friendIds, "friendIds is required");

        String key = friendRankKey(playerId);
        ZSetOperations<String, String> zSetOperations = redisTemplate.opsForZSet();
        redisTemplate.delete(key);

        Set<Long> friendCircle = friendIds.stream()
                .filter(Objects::nonNull)
                .filter(friendId -> !friendId.equals(playerId))
                .collect(Collectors.toCollection(LinkedHashSet::new));
        if (friendCircle.isEmpty()) {
            return;
        }
        // 好友榜納入玩家本人，讓玩家能查到自己在好友圈的名次（T-041 step2 / T-042 step3）
        friendCircle.add(playerId);

        Set<ZSetOperations.TypedTuple<String>> tuples = friendCircle.stream()
                .map(memberId -> {
                    Double score = zSetOperations.score(GLOBAL_COINS_KEY, memberId.toString());
                    return new DefaultTypedTuple<>(memberId.toString(), score == null ? 0.0 : score);
                })
                .collect(Collectors.toCollection(LinkedHashSet::new));

        zSetOperations.add(key, tuples);
        redisTemplate.expire(key, FRIEND_RANK_TTL);
    }

    public List<RankEntryResponse> getTopFriendCoins(Long playerId) {
        Objects.requireNonNull(playerId, "playerId is required");
        return readTopRank(friendRankKey(playerId), FRIEND_TOP_LIMIT);
    }

    /**
     * 查玩家自己在好友榜的當前名次（T-042 step3）。
     * 因好友榜含玩家本人，直接用 ZREVRANK 取得；不在榜（無好友圈/已過期）回 empty。
     */
    public Optional<RankEntryResponse> getFriendRank(Long playerId) {
        Objects.requireNonNull(playerId, "playerId is required");

        String key = friendRankKey(playerId);
        String member = playerId.toString();
        Long zeroBasedRank = redisTemplate.opsForZSet().reverseRank(key, member);
        Double score = redisTemplate.opsForZSet().score(key, member);

        if (zeroBasedRank == null || score == null) {
            return Optional.empty();
        }

        HashOperations<String, String, String> hashOperations = redisTemplate.opsForHash();
        String username = hashOperations.get(PLAYER_USERNAME_KEY, member);
        return Optional.of(new RankEntryResponse(
                playerId,
                username,
                zeroBasedRank + 1,
                score.longValue()));
    }

    private String friendRankKey(Long playerId) {
        return FRIEND_COINS_KEY_PREFIX + playerId;
    }

    private List<RankEntryResponse> readTopRank(String key, int limit) {
        if (limit == 0) {
            return Collections.emptyList();
        }

        Set<ZSetOperations.TypedTuple<String>> tuples = redisTemplate.opsForZSet()
                .reverseRangeWithScores(key, 0, limit - 1L);
        if (tuples == null || tuples.isEmpty()) {
            return Collections.emptyList();
        }

        List<RankScore> scores = new ArrayList<>(tuples.size());
        long rank = 1;
        for (ZSetOperations.TypedTuple<String> tuple : tuples) {
            String value = tuple.getValue();
            Double score = tuple.getScore();
            if (value != null && score != null) {
                scores.add(new RankScore(Long.valueOf(value), rank, score.longValue()));
            }
            rank++;
        }

        Map<Long, String> usernames = readUsernames(scores);
        return scores.stream()
                .map(score -> new RankEntryResponse(
                        score.playerId(),
                        usernames.get(score.playerId()),
                        score.rank(),
                        score.score()))
                .toList();
    }

    private Map<Long, String> readUsernames(List<RankScore> scores) {
        HashOperations<String, String, String> hashOperations = redisTemplate.opsForHash();
        List<String> playerIds = scores.stream()
                .map(score -> score.playerId().toString())
                .toList();
        List<String> usernames = hashOperations.multiGet(PLAYER_USERNAME_KEY, playerIds);
        if (usernames == null) {
            return Collections.emptyMap();
        }

        Map<Long, String> result = new LinkedHashMap<>();
        for (int index = 0; index < scores.size(); index++) {
            result.put(scores.get(index).playerId(), usernames.get(index));
        }
        return result;
    }

    private record RankScore(Long playerId, long rank, long score) {}
}
