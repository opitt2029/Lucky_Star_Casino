package com.luckystar.rank.service;

import com.luckystar.rank.dto.PlayerCoinBalance;
import com.luckystar.rank.dto.RankCategory;
import com.luckystar.rank.dto.RankEntryResponse;
import com.luckystar.rank.dto.RankPlayerResponse;
import com.luckystar.rank.dto.RankPlayerStatsResponse;
import com.luckystar.rank.dto.RankScope;
import com.luckystar.rank.kafka.RankUpdatePublisher;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumMap;
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
    public static final String PLAYER_NICKNAME_KEY = "rank:player:nicknames";
    public static final String PLAYER_AVATAR_KEY = "rank:player:avatars";
    public static final String PLAYER_JOINED_AT_KEY = "rank:player:joined-at";

    public static final String DAILY_WINNINGS_KEY = "rank:daily:winnings";
    public static final int DAILY_WINNINGS_TOP_LIMIT = 100;

    public static final String GAME_PROFIT_KEY_PREFIX = "rank:game:";
    public static final int GAME_TOP_LIMIT = 100;

    public static final int GLOBAL_TOP10_LIMIT = 10;
    private static final long MIN_BROADCAST_INTERVAL_MS = 1000L;
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

    public void updateGameResult(Long playerId, String gameType, long betAmount, long payout) {
        Objects.requireNonNull(playerId, "playerId is required");
        RankCategory category = parseGameCategory(gameType);
        if (betAmount < 0 || payout < 0) {
            throw new IllegalArgumentException("betAmount and payout must be greater than or equal to 0");
        }

        String member = playerId.toString();
        long profit = payout - betAmount;
        redisTemplate.opsForZSet().incrementScore(gameProfitKey(category), member, (double) profit);
        redisTemplate.opsForHash().increment(gameRoundsKey(category), member, 1L);
        redisTemplate.opsForHash().increment(gameTotalBetKey(category), member, betAmount);
        redisTemplate.opsForHash().increment(gameTotalPayoutKey(category), member, payout);
        if (payout > betAmount) {
            redisTemplate.opsForHash().increment(gameWinsKey(category), member, 1L);
        }
    }

    public List<RankEntryResponse> getLeaderboard(RankScope scope, RankCategory category, Long playerId, int limit) {
        Objects.requireNonNull(scope, "scope is required");
        Objects.requireNonNull(category, "category is required");
        int boundedLimit = boundedLimit(category, limit);
        if (boundedLimit == 0) {
            return Collections.emptyList();
        }

        if (scope == RankScope.GLOBAL) {
            return readTopRank(rankKey(category), boundedLimit, category);
        }

        if (playerId == null) {
            throw new IllegalArgumentException("X-User-Id is required for friends leaderboard");
        }
        if (category == RankCategory.COINS) {
            return getTopFriendCoins(playerId, boundedLimit);
        }
        return readFriendFilteredRank(playerId, category, boundedLimit);
    }

    public Map<String, RankEntryResponse> getMyRanks(Long playerId) {
        Objects.requireNonNull(playerId, "playerId is required");
        Map<String, RankEntryResponse> result = new LinkedHashMap<>();
        for (RankScope scope : RankScope.values()) {
            for (RankCategory category : RankCategory.values()) {
                findRank(scope, category, playerId, playerId).ifPresent(entry ->
                        result.put(scope.name() + ":" + category.name(), entry));
            }
        }
        return result;
    }

    public Optional<RankPlayerResponse> getPublicPlayer(
            Long playerId, Long viewerId, RankScope selectedScope, RankCategory selectedCategory) {
        Objects.requireNonNull(playerId, "playerId is required");
        if (!playerExists(playerId)) {
            return Optional.empty();
        }

        Map<String, Long> gameRanks = new LinkedHashMap<>();
        for (RankCategory category : List.of(RankCategory.SLOT, RankCategory.BACCARAT, RankCategory.FISHING)) {
            findRank(RankScope.GLOBAL, category, playerId, viewerId)
                    .ifPresent(entry -> gameRanks.put(category.name(), entry.rank()));
        }

        Long selectedRank = null;
        if (selectedScope != null && selectedCategory != null) {
            selectedRank = findRank(selectedScope, selectedCategory, playerId, viewerId)
                    .map(RankEntryResponse::rank)
                    .orElse(null);
        }

        Long globalRank = getGlobalRank(playerId).map(RankEntryResponse::rank).orElse(null);
        Long dailyRank = getDailyWinningsRank(playerId).map(RankEntryResponse::rank).orElse(null);
        RankPlayerStatsResponse stats = playerStats(playerId);

        return Optional.of(new RankPlayerResponse(
                playerId,
                username(playerId),
                nickname(playerId),
                avatarUrl(playerId),
                joinedAt(playerId),
                friendStatus(viewerId, playerId),
                selectedRank,
                globalRank,
                dailyRank,
                gameRanks,
                stats));
    }

    public void updatePlayerUsername(Long playerId, String username) {
        updatePlayerPublicProfile(playerId, username, username, null, null);
    }

    public void updatePlayerPublicProfile(
            Long playerId, String username, String nickname, String avatarUrl, String joinedAt) {
        Objects.requireNonNull(playerId, "playerId is required");
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("username is required");
        }

        String member = playerId.toString();
        HashOperations<String, String, String> hashOperations = redisTemplate.opsForHash();
        hashOperations.put(PLAYER_USERNAME_KEY, member, username);
        hashOperations.put(PLAYER_NICKNAME_KEY, member, hasText(nickname) ? nickname : username);
        if (avatarUrl != null) {
            hashOperations.put(PLAYER_AVATAR_KEY, member, avatarUrl);
        }
        if (joinedAt != null) {
            hashOperations.put(PLAYER_JOINED_AT_KEY, member, joinedAt);
        }
    }

    public Optional<RankEntryResponse> getGlobalRank(Long playerId) {
        return rankByZSet(RankCategory.COINS, GLOBAL_COINS_KEY, playerId);
    }

    public List<RankEntryResponse> getTopGlobalCoins() {
        return getTopGlobalCoins(GLOBAL_TOP_LIMIT);
    }

    public List<RankEntryResponse> getTopGlobalCoins(int limit) {
        return readTopRank(GLOBAL_COINS_KEY, Math.max(0, Math.min(limit, GLOBAL_TOP_LIMIT)), RankCategory.COINS);
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
        return getTopFriendCoins(playerId, FRIEND_TOP_LIMIT);
    }

    public List<RankEntryResponse> getTopFriendCoins(Long playerId, int limit) {
        Objects.requireNonNull(playerId, "playerId is required");
        return readTopRank(friendRankKey(playerId), Math.max(0, Math.min(limit, GLOBAL_TOP_LIMIT)), RankCategory.COINS);
    }

    public Optional<RankEntryResponse> getFriendRank(Long playerId) {
        Objects.requireNonNull(playerId, "playerId is required");
        return rankByZSet(RankCategory.COINS, friendRankKey(playerId), playerId);
    }

    public List<RankEntryResponse> getTopDailyWinnings(int limit) {
        int boundedLimit = Math.max(0, Math.min(limit, DAILY_WINNINGS_TOP_LIMIT));
        return readTopRank(DAILY_WINNINGS_KEY, boundedLimit, RankCategory.DAILY_WINNINGS);
    }

    public Optional<RankEntryResponse> getDailyWinningsRank(Long playerId) {
        Objects.requireNonNull(playerId, "playerId is required");
        return rankByZSet(RankCategory.DAILY_WINNINGS, DAILY_WINNINGS_KEY, playerId);
    }

    boolean shouldBroadcast(List<Long> currentTop10Ids, long now) {
        if (currentTop10Ids.equals(lastTop10PlayerIds)) {
            return false;
        }
        return now - lastBroadcastAt >= MIN_BROADCAST_INTERVAL_MS;
    }

    private void maybeBroadcastTop10() {
        if (!Boolean.TRUE.equals(
                redisTemplate.opsForValue().setIfAbsent(BROADCAST_LOCK_KEY, "1", BROADCAST_LOCK_TTL))) {
            return;
        }
        List<RankEntryResponse> top10 = getTopGlobalCoins(GLOBAL_TOP10_LIMIT);
        List<Long> ids = top10.stream().map(RankEntryResponse::playerId).toList();
        long now = System.currentTimeMillis();
        if (shouldBroadcast(ids, now)) {
            lastTop10PlayerIds = ids;
            lastBroadcastAt = now;
            rankUpdatePublisher.publishTop10(top10);
        }
    }

    private Optional<RankEntryResponse> findRank(
            RankScope scope, RankCategory category, Long playerId, Long viewerId) {
        if (scope == RankScope.GLOBAL) {
            return rankByZSet(category, rankKey(category), playerId);
        }
        if (viewerId == null) {
            return Optional.empty();
        }
        return readFriendFilteredRank(viewerId, category, GLOBAL_TOP_LIMIT).stream()
                .filter(entry -> entry.playerId().equals(playerId))
                .findFirst();
    }

    private Optional<RankEntryResponse> rankByZSet(RankCategory category, String key, Long playerId) {
        Objects.requireNonNull(playerId, "playerId is required");
        String member = playerId.toString();
        Long zeroBasedRank = redisTemplate.opsForZSet().reverseRank(key, member);
        Double score = redisTemplate.opsForZSet().score(key, member);
        if (zeroBasedRank == null || score == null) {
            return Optional.empty();
        }
        long rank = computeStableRank(key, playerId, score.longValue());
        return Optional.of(toResponse(new RankScore(playerId, rank, score.longValue()), category));
    }

    private long computeStableRank(String key, Long playerId, long score) {
        Set<ZSetOperations.TypedTuple<String>> tuples = redisTemplate.opsForZSet()
                .reverseRangeWithScores(key, 0, -1L);
        if (tuples == null || tuples.isEmpty()) {
            Long zeroBased = redisTemplate.opsForZSet().reverseRank(key, playerId.toString());
            return zeroBased == null ? 1L : zeroBased + 1L;
        }
        List<RankScore> sorted = sortedScores(tuples, Integer.MAX_VALUE);
        for (int index = 0; index < sorted.size(); index++) {
            RankScore current = sorted.get(index);
            if (current.playerId().equals(playerId)) {
                return index + 1L;
            }
        }
        long better = sorted.stream()
                .filter(item -> item.score() > score || (item.score() == score && item.playerId() < playerId))
                .count();
        return better + 1L;
    }

    private List<RankEntryResponse> readTopRank(String key, int limit, RankCategory category) {
        if (limit == 0) {
            return Collections.emptyList();
        }

        Set<ZSetOperations.TypedTuple<String>> tuples = redisTemplate.opsForZSet()
                .reverseRangeWithScores(key, 0, limit - 1L);
        if (tuples == null || tuples.isEmpty()) {
            return Collections.emptyList();
        }

        return toResponses(sortedScores(tuples, limit), category);
    }

    private List<RankEntryResponse> readFriendFilteredRank(Long playerId, RankCategory category, int limit) {
        Set<String> friendIds = redisTemplate.opsForZSet().reverseRange(friendRankKey(playerId), 0, -1L);
        if (friendIds == null || friendIds.isEmpty()) {
            return Collections.emptyList();
        }

        String key = rankKey(category);
        List<RankScore> scores = new ArrayList<>();
        for (String friendId : friendIds) {
            Double score = redisTemplate.opsForZSet().score(key, friendId);
            if (score != null) {
                scores.add(new RankScore(Long.valueOf(friendId), 0L, score.longValue()));
            }
        }
        scores.sort(rankComparator());
        List<RankScore> ranked = new ArrayList<>();
        long rank = 1;
        for (RankScore score : scores) {
            if (ranked.size() >= limit) {
                break;
            }
            ranked.add(new RankScore(score.playerId(), rank, score.score()));
            rank++;
        }
        return toResponses(ranked, category);
    }

    private List<RankScore> sortedScores(Set<ZSetOperations.TypedTuple<String>> tuples, int limit) {
        List<RankScore> scores = new ArrayList<>(tuples.size());
        for (ZSetOperations.TypedTuple<String> tuple : tuples) {
            String value = tuple.getValue();
            Double score = tuple.getScore();
            if (value != null && score != null) {
                scores.add(new RankScore(Long.valueOf(value), 0L, score.longValue()));
            }
        }
        scores.sort(rankComparator());
        List<RankScore> ranked = new ArrayList<>();
        long rank = 1;
        for (RankScore score : scores) {
            if (ranked.size() >= limit) {
                break;
            }
            ranked.add(new RankScore(score.playerId(), rank, score.score()));
            rank++;
        }
        return ranked;
    }

    private Comparator<RankScore> rankComparator() {
        return Comparator.comparingLong(RankScore::score).reversed()
                .thenComparingLong(RankScore::playerId);
    }

    private List<RankEntryResponse> toResponses(List<RankScore> scores, RankCategory category) {
        if (scores.isEmpty()) {
            return Collections.emptyList();
        }
        List<String> playerIds = scores.stream().map(score -> score.playerId().toString()).toList();
        HashOperations<String, String, String> hashOperations = redisTemplate.opsForHash();
        List<String> usernames = hashOperations.multiGet(PLAYER_USERNAME_KEY, playerIds);
        List<String> nicknames = hashOperations.multiGet(PLAYER_NICKNAME_KEY, playerIds);
        List<String> avatars = hashOperations.multiGet(PLAYER_AVATAR_KEY, playerIds);
        List<RankEntryResponse> result = new ArrayList<>(scores.size());
        for (int index = 0; index < scores.size(); index++) {
            RankScore score = scores.get(index);
            String username = valueAt(usernames, index);
            String nickname = valueAt(nicknames, index);
            String avatar = valueAt(avatars, index);
            GameStats stats = category.isGame() ? gameStats(category, score.playerId()) : GameStats.empty();
            result.add(new RankEntryResponse(
                    score.playerId(),
                    hasText(username) ? username : "player-" + score.playerId(),
                    hasText(nickname) ? nickname : hasText(username) ? username : "player-" + score.playerId(),
                    avatar,
                    score.rank(),
                    score.score(),
                    scoreUnit(category),
                    stats.roundCount(),
                    stats.totalBet(),
                    stats.totalPayout(),
                    stats.winRate()));
        }
        return result;
    }

    private String valueAt(List<String> values, int index) {
        return values == null || index >= values.size() ? null : values.get(index);
    }
    private RankEntryResponse toResponse(RankScore score, RankCategory category) {
        GameStats stats = category.isGame() ? gameStats(category, score.playerId()) : GameStats.empty();
        return new RankEntryResponse(
                score.playerId(),
                username(score.playerId()),
                nickname(score.playerId()),
                avatarUrl(score.playerId()),
                score.rank(),
                score.score(),
                scoreUnit(category),
                stats.roundCount(),
                stats.totalBet(),
                stats.totalPayout(),
                stats.winRate());
    }

    private boolean playerExists(Long playerId) {
        String member = playerId.toString();
        if (redisTemplate.opsForHash().hasKey(PLAYER_USERNAME_KEY, member)) {
            return true;
        }
        for (RankCategory category : RankCategory.values()) {
            if (redisTemplate.opsForZSet().score(rankKey(category), member) != null) {
                return true;
            }
        }
        return false;
    }

    private RankPlayerStatsResponse playerStats(Long playerId) {
        long rounds = 0L;
        long wins = 0L;
        String favorite = null;
        long favoriteRounds = -1L;
        for (RankCategory category : List.of(RankCategory.SLOT, RankCategory.BACCARAT, RankCategory.FISHING)) {
            GameStats stats = gameStats(category, playerId);
            long categoryRounds = stats.roundCount() == null ? 0L : stats.roundCount();
            long categoryWins = readHashLong(gameWinsKey(category), playerId.toString());
            rounds += categoryRounds;
            wins += categoryWins;
            if (categoryRounds > favoriteRounds) {
                favoriteRounds = categoryRounds;
                favorite = category.name();
            }
        }
        Double winRate = rounds == 0 ? null : (wins * 100.0) / rounds;
        return new RankPlayerStatsResponse(rounds, winRate, favoriteRounds <= 0 ? null : favorite);
    }

    private GameStats gameStats(RankCategory category, Long playerId) {
        String member = playerId.toString();
        long rounds = readHashLong(gameRoundsKey(category), member);
        long totalBet = readHashLong(gameTotalBetKey(category), member);
        long totalPayout = readHashLong(gameTotalPayoutKey(category), member);
        long wins = readHashLong(gameWinsKey(category), member);
        Double winRate = rounds == 0 ? null : (wins * 100.0) / rounds;
        return new GameStats(rounds, totalBet, totalPayout, winRate);
    }

    private long readHashLong(String key, String field) {
        Object value = redisTemplate.opsForHash().get(key, field);
        if (value == null) {
            return 0L;
        }
        return Long.parseLong(value.toString());
    }

    private String friendStatus(Long viewerId, Long playerId) {
        if (viewerId == null) {
            return "NONE";
        }
        if (viewerId.equals(playerId)) {
            return "SELF";
        }
        Double score = redisTemplate.opsForZSet().score(friendRankKey(viewerId), playerId.toString());
        return score == null ? "NONE" : "FRIEND";
    }

    private String username(Long playerId) {
        String value = (String) redisTemplate.opsForHash().get(PLAYER_USERNAME_KEY, playerId.toString());
        return hasText(value) ? value : "player-" + playerId;
    }

    private String nickname(Long playerId) {
        String value = (String) redisTemplate.opsForHash().get(PLAYER_NICKNAME_KEY, playerId.toString());
        return hasText(value) ? value : username(playerId);
    }

    private String avatarUrl(Long playerId) {
        Object value = redisTemplate.opsForHash().get(PLAYER_AVATAR_KEY, playerId.toString());
        return value == null ? null : value.toString();
    }

    private String joinedAt(Long playerId) {
        Object value = redisTemplate.opsForHash().get(PLAYER_JOINED_AT_KEY, playerId.toString());
        return value == null ? null : value.toString();
    }

    private String rankKey(RankCategory category) {
        return switch (category) {
            case COINS -> GLOBAL_COINS_KEY;
            case DAILY_WINNINGS -> DAILY_WINNINGS_KEY;
            case SLOT, BACCARAT, FISHING -> gameProfitKey(category);
        };
    }

    private String gameProfitKey(RankCategory category) {
        return GAME_PROFIT_KEY_PREFIX + category.name() + ":profit";
    }

    private String gameRoundsKey(RankCategory category) {
        return GAME_PROFIT_KEY_PREFIX + category.name() + ":rounds";
    }

    private String gameTotalBetKey(RankCategory category) {
        return GAME_PROFIT_KEY_PREFIX + category.name() + ":totalBet";
    }

    private String gameTotalPayoutKey(RankCategory category) {
        return GAME_PROFIT_KEY_PREFIX + category.name() + ":totalPayout";
    }

    private String gameWinsKey(RankCategory category) {
        return GAME_PROFIT_KEY_PREFIX + category.name() + ":wins";
    }

    private String friendRankKey(Long playerId) {
        return FRIEND_COINS_KEY_PREFIX + playerId;
    }

    private int boundedLimit(RankCategory category, int limit) {
        int max = category == RankCategory.COINS ? GLOBAL_TOP_LIMIT :
                category == RankCategory.DAILY_WINNINGS ? DAILY_WINNINGS_TOP_LIMIT : GAME_TOP_LIMIT;
        return Math.max(0, Math.min(limit, max));
    }

    private RankCategory parseGameCategory(String gameType) {
        try {
            RankCategory category = RankCategory.valueOf(String.valueOf(gameType).trim().toUpperCase());
            if (!category.isGame()) {
                throw new IllegalArgumentException("Unsupported gameType: " + gameType);
            }
            return category;
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException("Unsupported gameType: " + gameType, ex);
        }
    }

    private String scoreUnit(RankCategory category) {
        return category.isGame() ? "淨贏分" : "星幣";
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private record RankScore(Long playerId, long rank, long score) {}

    private record GameStats(Long roundCount, Long totalBet, Long totalPayout, Double winRate) {
        static GameStats empty() {
            return new GameStats(null, null, null, null);
        }
    }
}
