package com.luckystar.game.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * {@link GameSessionService} 單元測試（純 Mockito，不連真實 Redis）。
 * 以 mock {@link StringRedisTemplate} / {@link HashOperations} 攔截 Hash 寫入欄位與 TTL，
 * 驗證 Key 格式、欄位映射、狀態轉移與容錯。
 */
class GameSessionServiceTest {

    private static final long PLAYER_ID = 42L;
    private static final String ROUND_ID = "round-abc";
    private static final String KEY = "game:session:42:round-abc";
    private static final Duration TTL = Duration.ofMinutes(30);

    @SuppressWarnings("unchecked")
    private final StringRedisTemplate redisTemplate =
            org.mockito.Mockito.mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final HashOperations<String, String, String> hashOps =
            org.mockito.Mockito.mock(HashOperations.class);

    private GameSessionService service;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForHash()).thenReturn((HashOperations) hashOps);
        service = new GameSessionService(redisTemplate, TTL);
    }

    private static GameSession baseSession() {
        return GameSession.builder()
                .roundId(ROUND_ID)
                .playerId(PLAYER_ID)
                .gameType("SLOT")
                .betAmount(100L)
                .serverSeed("srv-seed")
                .serverSeedHash("hash")
                .clientSeed("cli-seed")
                .nonce(0L)
                .build();
    }

    @Test
    @DisplayName("start：以正確 Key 寫入 Hash 欄位、套用 30 分鐘 TTL、狀態 STARTED 並補 createdAt")
    void start_writesHashWithKeyAndTtl() {
        GameSession stored = service.start(baseSession());

        assertEquals(GameSessionState.STARTED, stored.getState());
        assertNotNull(stored.getCreatedAt(), "未帶 createdAt 應自動補上");

        ArgumentCaptor<String> keyCaptor = ArgumentCaptor.forClass(String.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> mapCaptor = ArgumentCaptor.forClass(Map.class);
        verify(hashOps).putAll(keyCaptor.capture(), mapCaptor.capture());
        verify(redisTemplate).expire(KEY, TTL);

        assertEquals(KEY, keyCaptor.getValue());
        Map<String, String> hash = mapCaptor.getValue();
        assertEquals("STARTED", hash.get("state"));
        assertEquals("srv-seed", hash.get("serverSeed"));
        assertEquals("42", hash.get("playerId"));
        assertEquals("100", hash.get("betAmount"));
        assertNotNull(hash.get("createdAt"));
    }

    @Test
    @DisplayName("start：缺 playerId 或 roundId 應丟 IllegalArgumentException 且不寫入")
    void start_missingKeyFields_throws() {
        GameSession noPlayer = baseSession();
        noPlayer.setPlayerId(null);
        assertThrows(IllegalArgumentException.class, () -> service.start(noPlayer));

        GameSession blankRound = baseSession();
        blankRound.setRoundId("  ");
        assertThrows(IllegalArgumentException.class, () -> service.start(blankRound));

        verify(hashOps, never()).putAll(any(), anyMap());
    }

    @Test
    @DisplayName("find：命中時正確由 Hash 欄位還原 GameSession")
    void find_hit_mapsFromHash() {
        when(hashOps.entries(KEY)).thenReturn(sampleHash(GameSessionState.STARTED, "srv-seed"));

        Optional<GameSession> found = service.find(PLAYER_ID, ROUND_ID);

        assertTrue(found.isPresent());
        assertEquals(ROUND_ID, found.get().getRoundId());
        assertEquals(PLAYER_ID, found.get().getPlayerId());
        assertEquals(100L, found.get().getBetAmount());
        assertEquals("srv-seed", found.get().getServerSeed());
        assertEquals(GameSessionState.STARTED, found.get().getState());
    }

    @Test
    @DisplayName("find：不存在（逾時/未開局，空 Hash）回 empty")
    void find_miss_returnsEmpty() {
        when(hashOps.entries(KEY)).thenReturn(new HashMap<>());
        assertTrue(service.find(PLAYER_ID, ROUND_ID).isEmpty());
    }

    @Test
    @DisplayName("find：資料毀損（非法數值欄位）視同不存在，不拋例外")
    void find_corrupt_returnsEmpty() {
        Map<String, String> bad = sampleHash(GameSessionState.STARTED, "srv-seed");
        bad.put("nonce", "not-a-number");
        when(hashOps.entries(KEY)).thenReturn(bad);
        assertTrue(service.find(PLAYER_ID, ROUND_ID).isEmpty());
    }

    @Test
    @DisplayName("markSettled：轉 SETTLED、揭露 serverSeed/nonce，只更新異動欄位並重置 TTL")
    void markSettled_updatesFieldsAndRewritesTtl() {
        when(redisTemplate.hasKey(KEY)).thenReturn(true);
        // markSettled 內部會 putAll 後再 find 回讀；回讀時模擬已更新的 Hash
        when(hashOps.entries(KEY)).thenReturn(sampleHash(GameSessionState.SETTLED, "revealed-seed"));

        Optional<GameSession> result = service.markSettled(PLAYER_ID, ROUND_ID, "revealed-seed", 7L);

        assertTrue(result.isPresent());
        assertEquals(GameSessionState.SETTLED, result.get().getState());

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> mapCaptor = ArgumentCaptor.forClass(Map.class);
        verify(hashOps).putAll(eq(KEY), mapCaptor.capture());
        Map<String, String> updates = mapCaptor.getValue();
        assertEquals("SETTLED", updates.get("state"));
        assertEquals("revealed-seed", updates.get("serverSeed"));
        assertEquals("7", updates.get("nonce"));
        verify(redisTemplate).expire(KEY, TTL);
    }

    @Test
    @DisplayName("markSettled：Session 不存在時回 empty 且不寫入")
    void markSettled_missing_returnsEmpty() {
        when(redisTemplate.hasKey(KEY)).thenReturn(false);

        Optional<GameSession> result = service.markSettled(PLAYER_ID, ROUND_ID, "seed", 1L);

        assertTrue(result.isEmpty());
        verify(hashOps, never()).putAll(any(), anyMap());
        verify(redisTemplate, never()).expire(any(), any(Duration.class));
    }

    @Test
    @DisplayName("delete：委派 redisTemplate.delete 並回傳結果")
    void delete_delegatesToRedis() {
        when(redisTemplate.delete(KEY)).thenReturn(true);
        assertTrue(service.delete(PLAYER_ID, ROUND_ID));

        when(redisTemplate.delete(KEY)).thenReturn(false);
        assertFalse(service.delete(PLAYER_ID, ROUND_ID));
    }

    private static Map<String, String> sampleHash(GameSessionState state, String serverSeed) {
        Map<String, String> h = new HashMap<>();
        h.put("roundId", ROUND_ID);
        h.put("playerId", "42");
        h.put("gameType", "SLOT");
        h.put("betAmount", "100");
        h.put("serverSeed", serverSeed);
        h.put("serverSeedHash", "hash");
        h.put("clientSeed", "cli-seed");
        h.put("nonce", "0");
        h.put("state", state.name());
        h.put("createdAt", Instant.now().toString());
        return h;
    }
}
