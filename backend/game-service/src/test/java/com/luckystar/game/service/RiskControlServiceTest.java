package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.luckystar.game.repository.GameRoundRepository;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

/** {@link RiskControlService} 單元測試。 */
class RiskControlServiceTest {

    private static final long PLAYER_ID = 1L;
    private static final String GAME_TYPE = "SLOT";

    private final GameRoundRepository roundRepository = org.mockito.Mockito.mock(GameRoundRepository.class);
    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> valueOps = org.mockito.Mockito.mock(ValueOperations.class);
    private final StringRedisTemplate redisTemplate = org.mockito.Mockito.mock(StringRedisTemplate.class);
    private RiskControlService service;

    @BeforeEach
    void setUp() {
        Mockito.when(redisTemplate.opsForValue()).thenReturn(valueOps);
        // 預設：並發閘回傳 1（無並發，正常通過）
        Mockito.when(valueOps.increment(Mockito.anyString(), Mockito.anyLong())).thenReturn(1L);
        service = new RiskControlService(roundRepository, redisTemplate);
        ReflectionTestUtils.setField(service, "playerWinLimit", 50000L);
        ReflectionTestUtils.setField(service, "globalRtpLimit", 0.95d);
        ReflectionTestUtils.setField(service, "rtpSampleSize", 500);

        // 預設：全局 RTP 正常（0.5）
        when(roundRepository.aggregateRecent(anyString(), anyInt()))
                .thenReturn(List.<Object[]>of(new Object[]{100000L, 50000L, 200L}));
    }

    @Test
    @DisplayName("玩家今日淨贏未超限 → 不攔截")
    void shouldIntercept_playerUnderLimit_returnsFalse() {
        // totalWin=60000, totalBet=20000 → netWin=40000 < 50000
        when(roundRepository.aggregatePlayerToday(eq(PLAYER_ID), eq(GAME_TYPE), any()))
                .thenReturn(List.<Object[]>of(new Object[]{20000L, 60000L, 10L}));

        assertFalse(service.shouldIntercept(PLAYER_ID, GAME_TYPE));
    }

    @Test
    @DisplayName("玩家今日淨贏達到上限 → 攔截")
    void shouldIntercept_playerOverLimit_returnsTrue() {
        // totalWin=80000, totalBet=20000 → netWin=60000 >= 50000
        when(roundRepository.aggregatePlayerToday(eq(PLAYER_ID), eq(GAME_TYPE), any()))
                .thenReturn(List.<Object[]>of(new Object[]{20000L, 80000L, 10L}));

        assertTrue(service.shouldIntercept(PLAYER_ID, GAME_TYPE));
    }

    @Test
    @DisplayName("全局 RTP 超限 → 攔截（即使玩家水位正常）")
    void shouldIntercept_globalRtpOverLimit_returnsTrue() {
        // 玩家水位正常
        when(roundRepository.aggregatePlayerToday(anyLong(), anyString(), any()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 10000L, 5L}));

        // 全局：totalBet=100, totalWin=96 → RTP=0.96 >= 0.95
        when(roundRepository.aggregateRecent(eq(GAME_TYPE), anyInt()))
                .thenReturn(List.<Object[]>of(new Object[]{100L, 96L, 10L}));

        assertTrue(service.shouldIntercept(PLAYER_ID, GAME_TYPE));
    }

    @Test
    @DisplayName("無對局紀錄（空結果集） → 不攔截")
    void shouldIntercept_noRounds_returnsFalse() {
        when(roundRepository.aggregatePlayerToday(anyLong(), anyString(), any()))
                .thenReturn(List.of());
        when(roundRepository.aggregateRecent(anyString(), anyInt()))
                .thenReturn(List.of());

        assertFalse(service.shouldIntercept(PLAYER_ID, GAME_TYPE));
    }
}
