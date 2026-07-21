package com.luckystar.game.fishing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
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
import org.mockito.Mockito;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

/**
 * {@link FishingSessionStore} 的 Redis Hash round-trip 單元測試（純 Mockito，免外部 Redis）。
 *
 * <p>守住「魚回寫打不死」的根因回歸：血量/傷害模型的跨批狀態
 * （{@code fishDamage} / {@code kills}）必須完整序列化進 Redis、
 * 並能反序列化還原。先前 {@code toHash/fromHash} 漏掉這些欄位，導致每批 shots 重讀 session 後
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

        // 模擬 SAVE_CAS_SCRIPT：真實邏輯搬進這裡執行（同一份 `backing`），
        // 讓 saveCas() 的樂觀鎖分支被完整測到，不需真 Redis/Lua。
        // 注意：varargs 第三參數要用 any(Object[].class) 匹配「整個陣列」，
        // 用 Mockito.<Object>any() 只會匹配「單一 vararg 元素」，saveCas 每次傳入的欄位組數
        // 遠不止一個，用錯 matcher 會讓 stub 不命中、execute() 靜默回傳 null。
        when(redisTemplate.execute(Mockito.<RedisScript<Long>>any(), anyList(), any(Object[].class)))
                .thenAnswer(inv -> {
                    // Mockito 對 varargs 方法的 InvocationOnMock 會把整組原始呼叫參數攤平回
                    // getArguments()（[script, keys, argv0, argv1, ...]），不是 getArgument(2) 拿到
                    // 一個 Object[]（那只是第一個 vararg 元素，型別不合會直接 ClassCastException）。
                    Object[] raw = inv.getArguments();
                    List<String> keys = (List<String>) raw[1];
                    String key = keys.get(0);
                    String expectedVersion = String.valueOf(raw[2]);
                    Map<String, String> hash = backing.computeIfAbsent(key, k -> new HashMap<>());
                    String current = hash.getOrDefault("version", "0");
                    if (!current.equals(expectedVersion)) {
                        return 0L;
                    }
                    for (int i = 4; i < raw.length; i += 2) {
                        hash.put(String.valueOf(raw[i]), String.valueOf(raw[i + 1]));
                    }
                    return 1L;
                });

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
    @DisplayName("save → find 完整 round-trip fishDamage / kills（魚回寫打不死回歸守門）")
    void roundTripsCombatState() {
        Map<String, Long> fishDamage = new LinkedHashMap<>();
        fishDamage.put("f1", 15L);
        fishDamage.put("f2", 40L);
        Map<String, Long> fishRecovery = new LinkedHashMap<>();
        fishRecovery.put("f1", 210L);
        fishRecovery.put("f2", 420L);
        List<FishingSession.KillRecord> kills = new ArrayList<>();
        kills.add(new FishingSession.KillRecord(7L, "DRAGON_KING", 1990L, 3));
        List<String> topUpRequestIds = new ArrayList<>();
        topUpRequestIds.add("topup-1");

        store.save(baseSession()
                .fishDamage(fishDamage)
                .fishRecovery(fishRecovery)
                .kills(kills)
                .topUpRequestIds(topUpRequestIds)
                .build());

        FishingSession loaded = store.find(PLAYER_ID).orElseThrow();

        // 累傷表必須完整還原（先前會是空 Map → 累傷歸零 → 魚打不死）
        assertEquals(2, loaded.getFishDamage().size());
        assertEquals(15L, loaded.getFishDamage().get("f1"));
        assertEquals(40L, loaded.getFishDamage().get("f2"));
        assertEquals(2, loaded.getFishRecovery().size());
        assertEquals(210L, loaded.getFishRecovery().get("f1"));
        assertEquals(420L, loaded.getFishRecovery().get("f2"));

        // 致命一擊紀錄必須完整還原（供結算後 verifyShot 重放）
        assertEquals(1, loaded.getKills().size());
        FishingSession.KillRecord k = loaded.getKills().get(0);
        assertEquals(7L, k.getShotSeq());
        assertEquals("DRAGON_KING", k.getFishType());
        assertEquals(1990L, k.getDamageBefore());
        assertEquals(3, k.getCannonLevel());

        // 子彈面額（玩家自選、整場固定，ADR-004）必須完整還原——漏存會讓跨批 validateBatch 注額對不上、整批被拒
        assertEquals(100L, loaded.getBetPerShot());
        assertEquals(List.of("topup-1"), loaded.getTopUpRequestIds());
    }

    @Test
    @DisplayName("未設定的戰鬥狀態 → 還原為空集合/ null，而非 NPE")
    void defaultsWhenAbsent() {
        store.save(baseSession().build());

        FishingSession loaded = store.find(PLAYER_ID).orElseThrow();

        assertTrue(loaded.getFishDamage().isEmpty(), "fishDamage 應為空表");
        assertTrue(loaded.getFishRecovery().isEmpty(), "fishRecovery 應為空表");
        assertTrue(loaded.getKills().isEmpty(), "kills 應為空清單");
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

    @Test
    @DisplayName("saveCas：版本相符時成功寫入並遞增 version（ADR-008）")
    void saveCasSucceedsWhenVersionMatches() {
        store.save(baseSession().build()); // 初始 version=0（@Builder.Default）

        FishingSession loaded = store.find(PLAYER_ID).orElseThrow();
        assertEquals(0L, loaded.getVersion());

        loaded.setSessionBalance(9999L);
        boolean success = store.saveCas(loaded, 0L);

        assertTrue(success, "版本相符應成功");
        assertEquals(1L, loaded.getVersion(), "成功後呼叫端物件的 version 應遞增");

        FishingSession reloaded = store.find(PLAYER_ID).orElseThrow();
        assertEquals(9999L, reloaded.getSessionBalance());
        assertEquals(1L, reloaded.getVersion());
    }

    @Test
    @DisplayName("saveCas：兩個讀者用同一舊版本各自改寫，先寫者成功、後寫者失敗且不覆蓋（丟失更新回歸守門）")
    void saveCasDetectsLostUpdate() {
        store.save(baseSession().sessionBalance(5000L).build());

        // 模擬兩個並發請求各自讀到 version=0 的快照
        FishingSession readerA = store.find(PLAYER_ID).orElseThrow();
        FishingSession readerB = store.find(PLAYER_ID).orElseThrow();

        readerA.setSessionBalance(readerA.getSessionBalance() - 100); // 扣一發子彈
        assertTrue(store.saveCas(readerA, 0L), "先寫者應成功");

        readerB.setSessionBalance(readerB.getSessionBalance() - 200); // 用同一份舊快照扣另一發
        boolean successB = store.saveCas(readerB, 0L);

        assertFalse(successB, "後寫者用過期版本號應被 CAS 擋下，不可覆蓋先寫者的結果");

        FishingSession finalState = store.find(PLAYER_ID).orElseThrow();
        assertEquals(4900L, finalState.getSessionBalance(),
                "最終餘額必須是先寫者的結果（5000-100），若丟失更新會變成 4800（被後寫者覆蓋）");
        assertEquals(1L, finalState.getVersion());
    }

    @Test
    @DisplayName("saveCas：舊 session（升級前建立，缺 version 欄位）視同 version=0")
    void saveCasTreatsMissingVersionAsZero() {
        // 直接寫入不含 version 欄位的 hash，模擬升級前建立的既有 session
        Map<String, String> legacyHash = new HashMap<>(store_toHashViaPublicApi());
        legacyHash.remove("version");
        backing.put(FishingSessionStore.key(PLAYER_ID), legacyHash);

        FishingSession loaded = store.find(PLAYER_ID).orElseThrow();
        assertNull(loaded.getVersion(), "缺欄位時 fromHash 回 null");

        boolean success = store.saveCas(loaded, 0L);

        assertTrue(success, "缺 version 欄位應視同 0，期望值 0 應成功");
        assertEquals(1L, store.find(PLAYER_ID).orElseThrow().getVersion());
    }

    /** 借道 save() 產生一份完整合法 hash（含 version=0）供上面的「移除 version 欄位」測試改造。 */
    private Map<String, String> store_toHashViaPublicApi() {
        store.save(baseSession().build());
        return backing.get(FishingSessionStore.key(PLAYER_ID));
    }
}
