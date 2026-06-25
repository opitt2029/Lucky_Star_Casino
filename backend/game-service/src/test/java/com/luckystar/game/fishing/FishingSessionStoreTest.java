package com.luckystar.game.fishing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * {@link FishingSessionStore} 的 Redis Hash round-trip 單元測試（純 Mockito，免外部 Redis）。
 *
 * <p>守住「魚回寫打不死」的根因回歸：血量/傷害模型的跨批狀態
 * （{@code fishDamage} / {@code kills} / {@code guaranteedShotSeq}）必須完整序列化進 Redis、
 * 並能反序列化還原。先前 {@code toHash/fromHash} 漏掉這三個欄位，導致每批 shots 重讀 session 後
 * 累傷歸零、大魚永遠打不死。
 *
 * <p>以記憶體 {@link Map} 模擬 Redis Hash：{@code putAll} 寫入（合併欄位，與真實 HSET 同語意）、
 * {@code entries} 讀回，因此 toHash → fromHash 的整條序列化路徑都被真實執行。
 */
class FishingSessionStoreTest {

    private static final long PLAYER_ID = 1169L;

    private final Map<String, Map<String, String>> backing = new HashMap<>();
    private FishingSessionStore store;

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        // 用 raw 型別：opsForHash() 的泛型在 when(...) 中會推斷為 <String,Object,Object>，
        // 宣告成參數化型別會對不上；raw HashOperations 可相容且 putAll/entries 以 Object 參數運作。
        HashOperations hashOps = mock(HashOperations.class);
        when(redisTemplate.opsForHash()).thenReturn(hashOps);

        // putAll：比照 Redis HSET，合併（覆寫同名）欄位到既有 hash，不刪除未提供的欄位
        doAnswer(inv -> {
            String key = inv.getArgument(0);
            Map<String, String> fields = inv.getArgument(1);
            backing.computeIfAbsent(key, k -> new HashMap<>()).putAll(fields);
            return null;
        }).when(hashOps).putAll(anyString(), any());

        when(hashOps.entries(anyString()))
                .thenAnswer(inv -> new HashMap<>(backing.getOrDefault(inv.getArgument(0), new HashMap<>())));

        store = new FishingSessionStore(redisTemplate, new ObjectMapper());
    }

    private static FishingSession.FishingSessionBuilder baseSession() {
        return FishingSession.builder()
                .sessionId("s-1")
                .playerId(PLAYER_ID)
                .roomId("solo-s-1")
                .seatIndex(0)
                .cannonLevel(3)
                .betPerShot(100L)
                .buyIn(5000L)
                .balanceBefore(600000L)
                .sessionBalance(4800L)
                .totalBet(200L)
                .totalPayout(0L)
                .totalShots(2L)
                .lastShotSeq(2L)
                .serverSeed("srv")
                .serverSeedHash("hash")
                .clientSeed("cli")
                .state("ACTIVE")
                .createdAt(Instant.parse("2026-06-25T10:00:00Z"))
                .lastActivityAt(Instant.parse("2026-06-25T10:01:00Z"))
                .intercepted(Boolean.FALSE);
    }

    @Test
    @DisplayName("save → find 完整 round-trip fishDamage / kills / guaranteedShotSeq（魚回寫打不死回歸守門）")
    void roundTripsCombatState() {
        Map<String, Long> fishDamage = new LinkedHashMap<>();
        fishDamage.put("f1", 15L);
        fishDamage.put("f2", 40L);
        List<FishingSession.KillRecord> kills = new ArrayList<>();
        kills.add(new FishingSession.KillRecord(7L, "DRAGON_KING", 1990L));

        store.save(baseSession()
                .guaranteedShotSeq(7L)
                .fishDamage(fishDamage)
                .kills(kills)
                .build());

        FishingSession loaded = store.find(PLAYER_ID).orElseThrow();

        // 累傷表必須完整還原（先前會是空 Map → 累傷歸零 → 魚打不死）
        assertEquals(2, loaded.getFishDamage().size());
        assertEquals(15L, loaded.getFishDamage().get("f1"));
        assertEquals(40L, loaded.getFishDamage().get("f2"));

        // 致命一擊紀錄必須完整還原（供結算後 verifyShot 重放）
        assertEquals(1, loaded.getKills().size());
        FishingSession.KillRecord k = loaded.getKills().get(0);
        assertEquals(7L, k.getShotSeq());
        assertEquals("DRAGON_KING", k.getFishType());
        assertEquals(1990L, k.getDamageBefore());

        // 保底 shotSeq 必須還原
        assertEquals(7L, loaded.getGuaranteedShotSeq());

        // 子彈面額（玩家自選、整場固定，ADR-004）必須完整還原——漏存會讓跨批 validateBatch 注額對不上、整批被拒
        assertEquals(100L, loaded.getBetPerShot());
    }

    @Test
    @DisplayName("未設定的戰鬥狀態 → 還原為空集合/ null，而非 NPE")
    void defaultsWhenAbsent() {
        store.save(baseSession().build());

        FishingSession loaded = store.find(PLAYER_ID).orElseThrow();

        assertTrue(loaded.getFishDamage().isEmpty(), "fishDamage 應為空表");
        assertTrue(loaded.getKills().isEmpty(), "kills 應為空清單");
        assertNull(loaded.getGuaranteedShotSeq(), "未觸發保底時 guaranteedShotSeq 應為 null");
    }

    @Test
    @DisplayName("魚被擊殺後從累傷表移除，再次 save 不留殘值（欄位整欄覆寫）")
    void killedFishDamageEntryDoesNotLinger() {
        Map<String, Long> fishDamage = new LinkedHashMap<>();
        fishDamage.put("f1", 15L);
        fishDamage.put("f2", 40L);
        store.save(baseSession().fishDamage(fishDamage).build());

        // 模擬下一批：f1 被擊殺移除後再存
        FishingSession loaded = store.find(PLAYER_ID).orElseThrow();
        loaded.getFishDamage().remove("f1");
        store.save(loaded);

        FishingSession reloaded = store.find(PLAYER_ID).orElseThrow();
        assertEquals(1, reloaded.getFishDamage().size());
        assertNull(reloaded.getFishDamage().get("f1"), "被擊殺的魚不應殘留累傷");
        assertEquals(40L, reloaded.getFishDamage().get("f2"));
    }
}
