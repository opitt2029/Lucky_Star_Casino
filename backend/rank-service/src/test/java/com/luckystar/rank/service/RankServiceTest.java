package com.luckystar.rank.service;

import com.luckystar.rank.dto.RankEntryResponse;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.DefaultTypedTuple;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RankServiceTest {

    @Mock
    StringRedisTemplate redisTemplate;

    @Mock
    ZSetOperations<String, String> zSetOperations;

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
    void getGlobalRank_usesReverseRankAndReturnsOneBasedRank() {
        RankService rankService = buildService();
        when(zSetOperations.reverseRank(RankService.GLOBAL_COINS_KEY, "42")).thenReturn(2L);
        when(zSetOperations.score(RankService.GLOBAL_COINS_KEY, "42")).thenReturn(1500.0);

        Optional<RankEntryResponse> response = rankService.getGlobalRank(42L);

        assertThat(response).isPresent();
        assertThat(response.get().rank()).isEqualTo(3L);
        assertThat(response.get().coins()).isEqualTo(1500L);
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

        List<RankEntryResponse> response = rankService.getTopGlobalCoins();

        assertThat(response).hasSize(3);
        assertThat(response.get(0)).isEqualTo(new RankEntryResponse(7L, 1L, 9000L));
        assertThat(response.get(1)).isEqualTo(new RankEntryResponse(42L, 2L, 1500L));
        assertThat(response.get(2)).isEqualTo(new RankEntryResponse(9L, 3L, 1000L));
    }

    private RankService buildService() {
        when(redisTemplate.opsForZSet()).thenReturn(zSetOperations);
        return new RankService(redisTemplate);
    }
}
