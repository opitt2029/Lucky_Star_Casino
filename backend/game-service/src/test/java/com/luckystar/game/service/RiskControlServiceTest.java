package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.luckystar.game.config.RiskProperties;
import com.luckystar.game.repository.GameRoundRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;

/** {@link RiskControlService} 單元測試。 */
class RiskControlServiceTest {

    private static final long PLAYER_ID = 1L;
    private static final String GAME_TYPE = "SLOT";

    private final GameRoundRepository roundRepository = Mockito.mock(GameRoundRepository.class);
    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> valueOps = Mockito.mock(ValueOperations.class);
    @SuppressWarnings("unchecked")
    private final HashOperations<String, Object, Object> hashOps = Mockito.mock(HashOperations.class);
    private final StringRedisTemplate redisTemplate = Mockito.mock(StringRedisTemplate.class);
    private RiskControlService service;

    /** 今日玩家日水位 hash key（與被測程式的組法一致）。 */
    private static String playerDayKey(long playerId, String gameType) {
        return "risk:player-day:" + playerId + ":"
                + LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd")) + ":" + gameType;
    }

    @BeforeEach
    void setUp() {
        Mockito.when(redisTemplate.opsForValue()).thenReturn(valueOps);
        Mockito.when(redisTemplate.opsForHash()).thenReturn(hashOps);
        // 預設：並發閘 Lua 回傳 1（無並發，正常通過）
        Mockito.when(redisTemplate.execute(
                        Mockito.<RedisScript<Long>>any(), anyList(), Mockito.<Object>any()))
                .thenReturn(1L);
        // 預設：玩家日水位快取 miss（退回 DB 聚合）、全局 RTP 快取 miss（退回直查 DB）
        Mockito.when(hashOps.multiGet(anyString(), anyList()))
                .thenReturn(Arrays.asList(null, null));
        Mockito.when(valueOps.get(anyString())).thenReturn(null);

        RiskProperties riskProperties = new RiskProperties();
        riskProperties.setPlayerWinLimit(50000L);
        riskProperties.setRtpSampleSize(500);
        // per-game 門檻：鏡像 application.yml；SLOT 沿用測試原本的 0.95 以保留判定意圖
        Map<String, Double> limits = new LinkedHashMap<>();
        limits.put("default", 1.05d);
        limits.put(GAME_TYPE, 0.95d);   // SLOT
        limits.put("BACCARAT", 1.02d);
        limits.put("FISHING", 1.00d);
        riskProperties.setGlobalRtpLimit(limits);

        service = new RiskControlService(roundRepository, redisTemplate, riskProperties);

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
    @DisplayName("百家樂結構性含本金 RTP（0.99）低於其 per-game 門檻（1.02） → 不攔截")
    void shouldIntercept_baccaratStructuralRtp_returnsFalse() {
        // 回歸測試：修法前單一 0.95 門檻會把百家樂每局都判超限、強制改莊家贏。
        when(roundRepository.aggregatePlayerToday(anyLong(), anyString(), any()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 10000L, 5L}));
        // 百家樂全局：totalBet=10000, totalWin=9900 → 含本金 RTP=0.99 < BACCARAT 門檻 1.02
        when(roundRepository.aggregateRecent(eq("BACCARAT"), anyInt()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 9900L, 100L}));

        assertFalse(service.shouldIntercept(PLAYER_ID, "BACCARAT"));
    }

    @Test
    @DisplayName("百家樂全局 RTP 真的超過 per-game 門檻（1.02） → 仍會攔截")
    void shouldIntercept_baccaratGlobalRtpOverLimit_returnsTrue() {
        when(roundRepository.aggregatePlayerToday(anyLong(), anyString(), any()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 10000L, 5L}));
        // 百家樂全局：totalBet=10000, totalWin=10300 → RTP=1.03 >= 1.02
        when(roundRepository.aggregateRecent(eq("BACCARAT"), anyInt()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 10300L, 100L}));

        assertTrue(service.shouldIntercept(PLAYER_ID, "BACCARAT"));
    }

    @Test
    @DisplayName("未列出的遊戲使用 default 門檻（1.05）")
    void shouldIntercept_unknownGameUsesDefault_returnsTrue() {
        when(roundRepository.aggregatePlayerToday(anyLong(), anyString(), any()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 10000L, 5L}));
        // 未知遊戲：RTP=1.06 >= default 1.05
        when(roundRepository.aggregateRecent(eq("DICE"), anyInt()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 10600L, 100L}));

        assertTrue(service.shouldIntercept(PLAYER_ID, "DICE"));
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

    // ---- Phase A4：並發閘（Lua 取號） ----

    @Test
    @DisplayName("並發閘：同玩家已有進行中請求（Lua 回傳 2） → 保守攔截，不再查統計")
    void shouldIntercept_concurrentRequest_returnsTrue() {
        Mockito.when(redisTemplate.execute(
                        Mockito.<RedisScript<Long>>any(), anyList(), Mockito.<Object>any()))
                .thenReturn(2L);

        assertTrue(service.shouldIntercept(PLAYER_ID, GAME_TYPE));
        verify(roundRepository, never()).aggregatePlayerToday(anyLong(), anyString(), any());
        verify(roundRepository, never()).aggregateRecent(anyString(), anyInt());
    }

    @Test
    @DisplayName("並發閘：Redis 故障 → 降級直查統計，不誤攔")
    void shouldIntercept_gateRedisDown_fallsBackToDb() {
        Mockito.when(redisTemplate.execute(
                        Mockito.<RedisScript<Long>>any(), anyList(), Mockito.<Object>any()))
                .thenThrow(new RuntimeException("redis down"));
        when(roundRepository.aggregatePlayerToday(anyLong(), anyString(), any()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 10000L, 5L}));

        assertFalse(service.shouldIntercept(PLAYER_ID, GAME_TYPE));
    }

    // ---- Phase A2：玩家日水位計數器 ----

    @Test
    @DisplayName("玩家日水位快取命中且超限 → 攔截，且不查 DB 聚合")
    void shouldIntercept_playerDayCacheHitOverLimit_skipsDb() {
        // hash 命中：bet=20000, win=80000 → netWin=60000 >= 50000
        when(hashOps.multiGet(eq(playerDayKey(PLAYER_ID, GAME_TYPE)), anyList()))
                .thenReturn(Arrays.asList("20000", "80000"));

        assertTrue(service.shouldIntercept(PLAYER_ID, GAME_TYPE));
        verify(roundRepository, never()).aggregatePlayerToday(anyLong(), anyString(), any());
    }

    @Test
    @DisplayName("玩家日水位快取 miss → 退回 DB 聚合並以 HSETNX 回填")
    void shouldIntercept_playerDayCacheMiss_backfillsFromDb() {
        when(roundRepository.aggregatePlayerToday(eq(PLAYER_ID), eq(GAME_TYPE), any()))
                .thenReturn(List.<Object[]>of(new Object[]{20000L, 60000L, 10L}));

        assertFalse(service.shouldIntercept(PLAYER_ID, GAME_TYPE));

        String key = playerDayKey(PLAYER_ID, GAME_TYPE);
        verify(hashOps).putIfAbsent(key, "bet", "20000");
        verify(hashOps).putIfAbsent(key, "win", "60000");
        verify(redisTemplate).expire(eq(key), any(Duration.class));
    }

    @Test
    @DisplayName("recordRoundSettled：以 Lua 對日水位 key 累加 bet/win（單一往返）")
    void recordRoundSettled_incrementsPlayerDayHash() {
        service.recordRoundSettled(PLAYER_ID, GAME_TYPE, 1000L, 700L);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<String>> keysCaptor = ArgumentCaptor.forClass(List.class);
        ArgumentCaptor<Object[]> argsCaptor = ArgumentCaptor.forClass(Object[].class);
        verify(redisTemplate).execute(
                Mockito.<RedisScript<Long>>any(), keysCaptor.capture(), argsCaptor.capture());
        org.junit.jupiter.api.Assertions.assertEquals(
                List.of(playerDayKey(PLAYER_ID, GAME_TYPE)), keysCaptor.getValue());
        Object[] args = argsCaptor.getValue();
        org.junit.jupiter.api.Assertions.assertEquals("1000", args[0]);
        org.junit.jupiter.api.Assertions.assertEquals("700", args[1]);
    }

    @Test
    @DisplayName("recordRoundSettled：Redis 故障僅 log，不拋例外（best-effort）")
    void recordRoundSettled_redisDown_doesNotThrow() {
        Mockito.when(redisTemplate.execute(
                        Mockito.<RedisScript<Long>>any(), anyList(), Mockito.<Object>any()))
                .thenThrow(new RuntimeException("redis down"));

        org.junit.jupiter.api.Assertions.assertDoesNotThrow(
                () -> service.recordRoundSettled(PLAYER_ID, GAME_TYPE, 1000L, 700L));
    }

    // ---- Phase A1：全局 RTP 快取 ----

    @Test
    @DisplayName("全局 RTP 快取命中且超限 → 攔截，且不查 DB 聚合")
    void shouldIntercept_rtpCacheHitOverLimit_skipsDb() {
        when(roundRepository.aggregatePlayerToday(anyLong(), anyString(), any()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 10000L, 5L}));
        // 快取命中：bet=100, win=96 → RTP=0.96 >= 0.95
        when(valueOps.get("risk:rtp:" + GAME_TYPE)).thenReturn("100:96");

        assertTrue(service.shouldIntercept(PLAYER_ID, GAME_TYPE));
        verify(roundRepository, never()).aggregateRecent(anyString(), anyInt());
    }

    @Test
    @DisplayName("全局 RTP 快取命中且正常 → 不攔截，且不查 DB 聚合")
    void shouldIntercept_rtpCacheHitUnderLimit_skipsDb() {
        when(roundRepository.aggregatePlayerToday(anyLong(), anyString(), any()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 10000L, 5L}));
        when(valueOps.get("risk:rtp:" + GAME_TYPE)).thenReturn("100000:50000");

        assertFalse(service.shouldIntercept(PLAYER_ID, GAME_TYPE));
        verify(roundRepository, never()).aggregateRecent(anyString(), anyInt());
    }

    @Test
    @DisplayName("全局 RTP 快取格式異常 → 降級直查 DB（行為同舊版）")
    void shouldIntercept_rtpCacheMalformed_fallsBackToDb() {
        when(roundRepository.aggregatePlayerToday(anyLong(), anyString(), any()))
                .thenReturn(List.<Object[]>of(new Object[]{10000L, 10000L, 5L}));
        when(valueOps.get("risk:rtp:" + GAME_TYPE)).thenReturn("not-a-number");
        // DB：RTP=0.96 >= 0.95 → 攔截（證明確實走到 DB）
        when(roundRepository.aggregateRecent(eq(GAME_TYPE), anyInt()))
                .thenReturn(List.<Object[]>of(new Object[]{100L, 96L, 10L}));

        assertTrue(service.shouldIntercept(PLAYER_ID, GAME_TYPE));
    }

    @Test
    @DisplayName("refreshGlobalRtpCache：聚合結果以 totalBet:totalWin 寫入快取（含 TTL）")
    void refreshGlobalRtpCache_writesAggregateToRedis() {
        when(roundRepository.aggregateRecent(eq(GAME_TYPE), eq(500)))
                .thenReturn(List.<Object[]>of(new Object[]{100000L, 93800L, 500L}));

        service.refreshGlobalRtpCache(GAME_TYPE);

        verify(valueOps).set(eq("risk:rtp:" + GAME_TYPE), eq("100000:93800"), any(Duration.class));
    }
}
