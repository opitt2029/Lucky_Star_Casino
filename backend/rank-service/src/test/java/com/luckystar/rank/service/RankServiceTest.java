package com.luckystar.rank.service;

import com.luckystar.rank.dto.RankEntryResponse;
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

    @Test
    void updatePlayerCoins_zaddsCurrentCoinBalance() {
        RankService rankService = buildService();

        rankService.updatePlayerCoins(42L, 1500L);

        verify(zSetOperations, times(1)).add(RankService.GLOBAL_COINS_KEY, "42", 1500.0);
    }

    @Test
    void updatePlayerCoins_rejectsNegativeBalance() {
        RankService rankService = new RankService(redisTemplate);

        assertThatThrownBy(() -> rankService.updatePlayerCoins(42L, -1L))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("currentCoins");
    }

    @Test
    void updatePlayerUsername_writesRedisHash() {
        when(redisTemplate.<String, String>opsForHash()).thenReturn(hashOperations);
        RankService rankService = new RankService(redisTemplate);

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
    @SuppressWarnings({"rawtypes", "unchecked"})
    void rebuildFriendRank_replacesFriendOnlyZSetAndSets24HourTtl() {
        RankService rankService = buildService();
        when(zSetOperations.score(RankService.GLOBAL_COINS_KEY, "2")).thenReturn(500.0);
        when(zSetOperations.score(RankService.GLOBAL_COINS_KEY, "3")).thenReturn(null);

        rankService.rebuildFriendRank(1L, List.of(2L, 3L, 2L, 1L));

        verify(redisTemplate).delete("rank:friend:1");
        ArgumentCaptor<Set> tuplesCaptor = ArgumentCaptor.forClass(Set.class);
        verify(zSetOperations).add(eq("rank:friend:1"), tuplesCaptor.capture());
        Set<ZSetOperations.TypedTuple<String>> tuples = tuplesCaptor.getValue();
        assertThat(tuples).extracting(ZSetOperations.TypedTuple::getValue)
                .containsExactlyInAnyOrder("2", "3");
        assertThat(tuples).extracting(ZSetOperations.TypedTuple::getScore)
                .containsExactlyInAnyOrder(500.0, 0.0);
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

    private RankService buildService() {
        when(redisTemplate.opsForZSet()).thenReturn(zSetOperations);
        lenient().when(redisTemplate.<String, String>opsForHash()).thenReturn(hashOperations);
        return new RankService(redisTemplate);
    }
}
