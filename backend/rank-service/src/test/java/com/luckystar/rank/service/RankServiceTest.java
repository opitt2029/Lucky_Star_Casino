package com.luckystar.rank.service;

import com.luckystar.rank.dto.RankEntryResponse;
import com.luckystar.rank.dto.PlayerCoinBalance;
import com.luckystar.rank.kafka.RankUpdatePublisher;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.DefaultTypedTuple;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RankServiceTest {

    @Mock
    StringRedisTemplate redisTemplate;

    @Mock
    ZSetOperations<String, String> zSetOperations;

    @Mock
    HashOperations<String, String, String> hashOperations;

    @Mock
    RankUpdatePublisher rankUpdatePublisher;

    private static final String DAILY_KEY =
            "rank:daily:winnings:" + LocalDate.now(ZoneId.of("Asia/Taipei"));

    @Test
    void updatePlayerCoins_zaddsCurrentCoinBalance() {
        RankService rankService = buildService();

        rankService.updatePlayerCoins(42L, 1500L);

        verify(zSetOperations, times(1)).add(RankService.GLOBAL_COINS_KEY, "42", 1500.0);
    }

    @Test
    void updatePlayerCoins_rejectsNegativeBalance() {
        RankService rankService = new RankService(redisTemplate, rankUpdatePublisher);

        assertThatThrownBy(() -> rankService.updatePlayerCoins(42L, -1L))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("currentCoins");
    }

    @Test
    void updatePlayerUsername_writesRedisHash() {
        when(redisTemplate.<String, String>opsForHash()).thenReturn(hashOperations);
        RankService rankService = new RankService(redisTemplate, rankUpdatePublisher);

        rankService.updatePlayerUsername(42L, "alice");

        verify(hashOperations).put(RankService.PLAYER_USERNAME_KEY, "42", "alice");
    }

    @Test
    void getGlobalRank_usesReverseRankAndReturnsOneBasedRank() {
        RankService rankService = buildService();
        when(zSetOperations.reverseRank(RankService.GLOBAL_COINS_KEY, "42")).thenReturn(2L);
        when(zSetOperations.score(RankService.GLOBAL_COINS_KEY, "42")).thenReturn(1500.0);
        when(hashOperations.get(RankService.PLAYER_USERNAME_KEY, "42")).thenReturn("alice");

        Optional<RankEntryResponse> response = rankService.getGlobalRank(42L);

        assertThat(response).isPresent();
        assertThat(response.get().username()).isEqualTo("alice");
        assertThat(response.get().rank()).isEqualTo(3L);
        assertThat(response.get().score()).isEqualTo(1500L);
    }

    @Test
    void getGlobalRank_returnsEmptyWhenPlayerIsNotRanked() {
        RankService rankService = buildService();
        when(zSetOperations.reverseRank(RankService.GLOBAL_COINS_KEY, "99")).thenReturn(null);
        when(zSetOperations.score(RankService.GLOBAL_COINS_KEY, "99")).thenReturn(null);

        assertThat(rankService.getGlobalRank(99L)).isEmpty();
    }

    @Test
    void getTopGlobalCoins_readsTop100ByReverseRangeWithScores() {
        RankService rankService = buildService();
        Set<ZSetOperations.TypedTuple<String>> tuples = new LinkedHashSet<>();
        tuples.add(new DefaultTypedTuple<>("7", 9000.0));
        tuples.add(new DefaultTypedTuple<>("42", 1500.0));
        tuples.add(new DefaultTypedTuple<>("9", 1000.0));
        when(zSetOperations.reverseRangeWithScores(RankService.GLOBAL_COINS_KEY, 0, 99))
                .thenReturn(tuples);
        when(hashOperations.multiGet(RankService.PLAYER_USERNAME_KEY, List.of("7", "42", "9")))
                .thenReturn(List.of("nova", "alice", "mika"));

        List<RankEntryResponse> response = rankService.getTopGlobalCoins();

        assertThat(response).hasSize(3);
        assertThat(response.get(0)).isEqualTo(new RankEntryResponse(7L, "nova", 1L, 9000L));
        assertThat(response.get(1)).isEqualTo(new RankEntryResponse(42L, "alice", 2L, 1500L));
        assertThat(response.get(2)).isEqualTo(new RankEntryResponse(9L, "mika", 3L, 1000L));
    }

    @Test
    void clearGlobalCoinsRank_deletesGlobalZSet() {
        RankService rankService = new RankService(redisTemplate, rankUpdatePublisher);

        rankService.clearGlobalCoinsRank();

        verify(redisTemplate).delete(RankService.GLOBAL_COINS_KEY);
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void rebuildGlobalCoinsRank_replacesZSetWithWalletBalances() {
        RankService rankService = buildService();

        int rebuilt = rankService.rebuildGlobalCoinsRank(List.of(
                new PlayerCoinBalance(7L, 9000L),
                new PlayerCoinBalance(42L, 1500L),
                new PlayerCoinBalance(9L, 1000L)));

        verify(redisTemplate).delete(RankService.GLOBAL_COINS_KEY);
        ArgumentCaptor<Set> tuplesCaptor = ArgumentCaptor.forClass(Set.class);
        verify(zSetOperations).add(eq(RankService.GLOBAL_COINS_KEY), tuplesCaptor.capture());
        Set<ZSetOperations.TypedTuple<String>> tuples = tuplesCaptor.getValue();
        assertThat(tuples).extracting(ZSetOperations.TypedTuple::getValue)
                .containsExactlyInAnyOrder("7", "42", "9");
        assertThat(tuples).extracting(ZSetOperations.TypedTuple::getScore)
                .containsExactlyInAnyOrder(9000.0, 1500.0, 1000.0);
        assertThat(rebuilt).isEqualTo(3);
    }

    @Test
    void rebuildGlobalCoinsRank_filtersInvalidBalancesAndDoesNotCreateEmptyZSet() {
        RankService rankService = new RankService(redisTemplate, rankUpdatePublisher);

        int rebuilt = rankService.rebuildGlobalCoinsRank(List.of(
                new PlayerCoinBalance(null, 1000L),
                new PlayerCoinBalance(7L, null),
                new PlayerCoinBalance(42L, -1L)));

        verify(redisTemplate).delete(RankService.GLOBAL_COINS_KEY);
        verify(zSetOperations, never()).add(eq(RankService.GLOBAL_COINS_KEY), anySet());
        assertThat(rebuilt).isEqualTo(0);
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void rebuildFriendRank_includesSelfAndFriendsAndSets24HourTtl() {
        RankService rankService = buildService();
        when(zSetOperations.score(RankService.GLOBAL_COINS_KEY, "1")).thenReturn(2000.0);
        when(zSetOperations.score(RankService.GLOBAL_COINS_KEY, "2")).thenReturn(500.0);
        when(zSetOperations.score(RankService.GLOBAL_COINS_KEY, "3")).thenReturn(null);

        rankService.rebuildFriendRank(1L, List.of(2L, 3L, 2L, 1L));

        verify(redisTemplate).delete("rank:friend:1");
        ArgumentCaptor<Set> tuplesCaptor = ArgumentCaptor.forClass(Set.class);
        verify(zSetOperations).add(eq("rank:friend:1"), tuplesCaptor.capture());
        Set<ZSetOperations.TypedTuple<String>> tuples = tuplesCaptor.getValue();
        // 含好友（2、3）與玩家本人（1）；重複與「friendIds 內混入自己」皆去重
        assertThat(tuples).extracting(ZSetOperations.TypedTuple::getValue)
                .containsExactlyInAnyOrder("1", "2", "3");
        assertThat(tuples).extracting(ZSetOperations.TypedTuple::getScore)
                .containsExactlyInAnyOrder(2000.0, 500.0, 0.0);
        verify(redisTemplate).expire("rank:friend:1", RankService.FRIEND_RANK_TTL);
    }

    @Test
    void rebuildFriendRank_noFriends_removesOldRankWithoutCreatingEmptyZSet() {
        RankService rankService = buildService();

        rankService.rebuildFriendRank(1L, List.of());

        verify(redisTemplate).delete("rank:friend:1");
        verify(zSetOperations, never()).add(eq("rank:friend:1"), anySet());
        verify(redisTemplate, never()).expire("rank:friend:1", RankService.FRIEND_RANK_TTL);
    }

    @Test
    void getTopFriendCoins_readsTop20() {
        RankService rankService = buildService();
        Set<ZSetOperations.TypedTuple<String>> tuples = new LinkedHashSet<>();
        tuples.add(new DefaultTypedTuple<>("2", 500.0));
        tuples.add(new DefaultTypedTuple<>("3", 100.0));
        when(zSetOperations.reverseRangeWithScores("rank:friend:1", 0, 19)).thenReturn(tuples);
        when(hashOperations.multiGet(RankService.PLAYER_USERNAME_KEY, List.of("2", "3")))
                .thenReturn(List.of("bob", "carol"));

        List<RankEntryResponse> response = rankService.getTopFriendCoins(1L);

        assertThat(response).containsExactly(
                new RankEntryResponse(2L, "bob", 1L, 500L),
                new RankEntryResponse(3L, "carol", 2L, 100L));
    }

    @Test
    void getFriendRank_usesReverseRankOnFriendKeyAndReturnsOneBasedRank() {
        RankService rankService = buildService();
        when(zSetOperations.reverseRank("rank:friend:1", "1")).thenReturn(1L);
        when(zSetOperations.score("rank:friend:1", "1")).thenReturn(2000.0);
        when(hashOperations.get(RankService.PLAYER_USERNAME_KEY, "1")).thenReturn("alice");

        Optional<RankEntryResponse> response = rankService.getFriendRank(1L);

        assertThat(response).contains(new RankEntryResponse(1L, "alice", 2L, 2000L));
    }

    @Test
    void getFriendRank_returnsEmptyWhenPlayerNotInFriendRank() {
        RankService rankService = buildService();
        when(zSetOperations.reverseRank("rank:friend:1", "1")).thenReturn(null);
        when(zSetOperations.score("rank:friend:1", "1")).thenReturn(null);

        assertThat(rankService.getFriendRank(1L)).isEmpty();
    }

    // ---- T-045 今日贏幣王 ----

    @Test
    void addDailyWinnings_firstWrite_incrementsScoreAndSets48hTtl() {
        when(redisTemplate.opsForZSet()).thenReturn(zSetOperations);
        when(redisTemplate.getExpire(DAILY_KEY)).thenReturn(-1L);
        RankService rankService = new RankService(redisTemplate, rankUpdatePublisher);

        rankService.addDailyWinnings(42L, 100L);

        verify(zSetOperations, times(1)).incrementScore(DAILY_KEY, "42", 100.0);
        verify(redisTemplate, times(1)).expire(DAILY_KEY, RankService.DAILY_WINNINGS_TTL);
    }

    @Test
    void addDailyWinnings_existingKey_doesNotResetTtl() {
        when(redisTemplate.opsForZSet()).thenReturn(zSetOperations);
        when(redisTemplate.getExpire(DAILY_KEY)).thenReturn(3600L);
        RankService rankService = new RankService(redisTemplate, rankUpdatePublisher);

        rankService.addDailyWinnings(42L, 50L);

        verify(zSetOperations, times(1)).incrementScore(DAILY_KEY, "42", 50.0);
        verify(redisTemplate, never()).expire(eq(DAILY_KEY), eq(RankService.DAILY_WINNINGS_TTL));
    }

    @Test
    void addDailyWinnings_ignoresNonPositiveAmount() {
        lenient().when(redisTemplate.opsForZSet()).thenReturn(zSetOperations);
        RankService rankService = new RankService(redisTemplate, rankUpdatePublisher);

        rankService.addDailyWinnings(42L, 0L);
        rankService.addDailyWinnings(42L, -5L);

        verify(zSetOperations, never()).incrementScore(eq(DAILY_KEY), eq("42"), org.mockito.ArgumentMatchers.anyDouble());
        verify(redisTemplate, never()).expire(eq(DAILY_KEY), eq(RankService.DAILY_WINNINGS_TTL));
    }

    @Test
    void getTopDailyWinnings_readsDailyKeyWithOneBasedRank() {
        RankService rankService = buildService();
        Set<ZSetOperations.TypedTuple<String>> tuples = new LinkedHashSet<>();
        tuples.add(new DefaultTypedTuple<>("7", 9000.0));
        tuples.add(new DefaultTypedTuple<>("42", 1500.0));
        when(zSetOperations.reverseRangeWithScores(DAILY_KEY, 0, 99)).thenReturn(tuples);
        when(hashOperations.multiGet(RankService.PLAYER_USERNAME_KEY, List.of("7", "42")))
                .thenReturn(List.of("nova", "alice"));

        List<RankEntryResponse> response = rankService.getTopDailyWinnings(100);

        assertThat(response).containsExactly(
                new RankEntryResponse(7L, "nova", 1L, 9000L),
                new RankEntryResponse(42L, "alice", 2L, 1500L));
    }

    @Test
    void getDailyWinningsRank_returnsOneBasedRankWhenPresent() {
        RankService rankService = buildService();
        when(zSetOperations.reverseRank(DAILY_KEY, "42")).thenReturn(0L);
        when(zSetOperations.score(DAILY_KEY, "42")).thenReturn(1500.0);
        when(hashOperations.get(RankService.PLAYER_USERNAME_KEY, "42")).thenReturn("alice");

        Optional<RankEntryResponse> response = rankService.getDailyWinningsRank(42L);

        assertThat(response).contains(new RankEntryResponse(42L, "alice", 1L, 1500L));
    }

    @Test
    void getDailyWinningsRank_returnsEmptyWhenNotRanked() {
        RankService rankService = buildService();
        when(zSetOperations.reverseRank(DAILY_KEY, "99")).thenReturn(null);
        when(zSetOperations.score(DAILY_KEY, "99")).thenReturn(null);

        assertThat(rankService.getDailyWinningsRank(99L)).isEmpty();
    }

    // ---- T-073 排行榜廣播 ----

    @Test
    void updatePlayerCoins_broadcastsWhenTop10Changed() {
        RankService rankService = buildService();
        Set<ZSetOperations.TypedTuple<String>> tuples = new LinkedHashSet<>();
        tuples.add(new DefaultTypedTuple<>("7", 9000.0));
        tuples.add(new DefaultTypedTuple<>("42", 1500.0));
        when(zSetOperations.reverseRangeWithScores(RankService.GLOBAL_COINS_KEY, 0, 9))
                .thenReturn(tuples);
        when(hashOperations.multiGet(RankService.PLAYER_USERNAME_KEY, List.of("7", "42")))
                .thenReturn(List.of("nova", "alice"));

        rankService.updatePlayerCoins(7L, 9000L);

        verify(zSetOperations, times(1)).add(RankService.GLOBAL_COINS_KEY, "7", 9000.0);
        verify(rankUpdatePublisher, times(1)).publishTop10(anyList());
    }

    @Test
    void updatePlayerCoins_doesNotBroadcastWhenTop10Unchanged() {
        RankService rankService = buildService();
        // 預設 reverseRangeWithScores 回 null → top10 為空 → 與初始 List.of() 相同 → 不廣播
        rankService.updatePlayerCoins(7L, 9000L);

        verify(rankUpdatePublisher, never()).publishTop10(anyList());
    }

    @Test
    void shouldBroadcast_falseWhenListsIdentical() {
        RankService rankService = new RankService(redisTemplate, rankUpdatePublisher);

        // 初始 lastTop10PlayerIds = List.of()，傳入空清單視為未變
        assertThat(rankService.shouldBroadcast(List.of(), System.currentTimeMillis())).isFalse();
    }

    @Test
    void shouldBroadcast_trueWhenChangedAndIntervalElapsed() {
        RankService rankService = new RankService(redisTemplate, rankUpdatePublisher);

        // lastBroadcastAt=0，now 遠大於 interval；清單有變
        assertThat(rankService.shouldBroadcast(List.of(7L), 10_000L)).isTrue();
    }

    private RankService buildService() {
        when(redisTemplate.opsForZSet()).thenReturn(zSetOperations);
        lenient().when(redisTemplate.<String, String>opsForHash()).thenReturn(hashOperations);
        return new RankService(redisTemplate, rankUpdatePublisher);
    }
}
