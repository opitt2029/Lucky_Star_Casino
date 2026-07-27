package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.client.WalletClient;
import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.dto.FishingShotsRequest;
import com.luckystar.game.dto.FishingShotsResponse;
import com.luckystar.game.fishing.FishingCombat;
import com.luckystar.game.fishing.FishingSession;
import com.luckystar.game.fishing.FishingSessionStore;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * 跨批開火的行為層整合測試：用<b>真實</b> {@link FishingSessionStore}（含 JSON 序列化）+ 真實
 * {@link ProvablyFairRng} + 記憶體 Redis 假替身，直接證明「同一條魚跨多次 {@code shots()} 呼叫的
 * 累積傷害會持久化、最終致死」。
 *
 * <p>這是「魚回寫打不死」根因修復的再驗證：每批只送一發子彈、且每批是獨立的 {@code shots()} 呼叫
 * （= 一次 Redis {@code save} + 下批 {@code find}）。修復前 {@code fishDamage} 沒被序列化，
 * 每批 {@code damageBefore} 都歸零 → 河豚（HP=80、銅炮每發 10）永遠打不死；修復後累傷跨批保留，
 * 8 發內必死。
 *
 * <p>不連外部 Redis（遵守「測試免外部基礎設施」原則）：以記憶體 {@link Map} 模擬 Hash 的
 * {@code putAll}/{@code entries}，因此整條 toHash → Redis → fromHash 的序列化路徑都被真實執行。
 */
class FishingServiceCrossBatchTest {

    private static final long PLAYER_ID = 4242L;
    private static final String SESSION_ID = "sess-crossbatch-1";
    private static final long CANNON_BET = 10L; // 玩家進場選定的單發面額（與砲台解耦，ADR-004）

    private final Map<String, Map<String, String>> backing = new HashMap<>();
    private final ProvablyFairRng rng = new ProvablyFairRng();
    private FishingService service;
    private WalletClient walletClient;
    private GameRoundRepository roundRepository;

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        HashOperations hashOps = mock(HashOperations.class);
        when(redisTemplate.opsForHash()).thenReturn(hashOps);
        org.mockito.Mockito.doAnswer(inv -> {
            String key = inv.getArgument(0);
            Map<String, String> fields = inv.getArgument(1);
            backing.computeIfAbsent(key, k -> new HashMap<>()).putAll(fields);
            return null;
        }).when(hashOps).putAll(anyString(), any());
        when(hashOps.entries(anyString()))
                .thenAnswer(inv -> new HashMap<>(backing.getOrDefault(inv.getArgument(0), new HashMap<>())));

        // 模擬 FishingSessionStore.SAVE_CAS_SCRIPT（ADR-008）：shots() 的整包寫回改走 saveCas，
        // 沒有這個 stub 時 redisTemplate.execute(...) 會回傳 null（未 stub 的預設值），
        // 導致每次 CAS 都判定失敗、shots() 重試 3 次後拋 SessionConflictException。
        when(redisTemplate.execute(
                        org.mockito.Mockito.<org.springframework.data.redis.core.script.RedisScript<Long>>any(),
                        org.mockito.ArgumentMatchers.anyList(),
                        any(Object[].class)))
                .thenAnswer(inv -> {
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

        FishingSessionStore sessionStore = new FishingSessionStore(redisTemplate, new ObjectMapper());

        walletClient = mock(WalletClient.class);
        roundRepository = mock(GameRoundRepository.class);
        GameResultEventPublisher publisher = mock(GameResultEventPublisher.class);
        RiskControlService riskControlService = mock(RiskControlService.class);
        when(riskControlService.shouldIntercept(anyLong(), anyString())).thenReturn(false);

        service = new FishingService(rng, walletClient, sessionStore, roundRepository, publisher,
                new ObjectMapper(), riskControlService,
                mock(com.luckystar.game.compensation.WalletCompensationService.class));

        // 直接建立一個 ACTIVE 場次（略過 start() 的 wallet 扣款；shots() 不碰 wallet）
        String serverSeed = rng.generateServerSeed();
        sessionStore.save(FishingSession.builder()
                .sessionId(SESSION_ID)
                .playerId(PLAYER_ID)
                .roomId("solo-" + SESSION_ID)
                .seatIndex(0)
                .cannonLevel(1)
                .betPerShot(CANNON_BET)
                .buyIn(100000L)
                .balanceBefore(100000L)
                .sessionBalance(100000L)
                .totalBet(0L)
                .totalPayout(0L)
                .totalShots(0L)
                .lastShotSeq(0L)
                .serverSeed(serverSeed)
                .serverSeedHash(rng.commit(serverSeed))
                .clientSeed(rng.generateClientSeed())
                .state("ACTIVE")
                .createdAt(Instant.now())
                .lastActivityAt(Instant.now())
                .intercepted(Boolean.FALSE)
                .build());
    }

    @Test
    @DisplayName("同一條河豚跨多批單發開火：累傷持久化 → hpRemaining 跨批嚴格遞減 → 終被擊殺")
    void damageAccumulatesAcrossBatchesUntilKilled() {
        long hpPrev = Long.MAX_VALUE;
        boolean killed = false;
        int batches = 0;

        // 河豚 HP=80、銅炮每發 10（暴擊 20），最多 8 批必死；40 為安全上限。
        for (long seq = 1; seq <= 40 && !killed; seq++) {
            FishingShotsResponse.ShotResult r = fireOneShot(seq);
            assertTrue(r.isAccepted(), "子彈應被受理（餘額充足、射速合法）seq=" + seq);
            batches++;
            if (r.isKilled()) {
                killed = true;
            } else {
                // 修復前：每批 damageBefore 歸零 → hpRemaining 永遠在 60~70 跳動、不遞減、永不致死
                assertTrue(r.getHpRemaining() < hpPrev,
                        "跨批累傷必須讓 hpRemaining 嚴格遞減（seq=" + seq
                                + " hpRemaining=" + r.getHpRemaining() + " 前次=" + hpPrev + "）");
                hpPrev = r.getHpRemaining();
            }
        }

        assertTrue(killed,
                "同一條魚跨多批單發開火必須能被擊殺（修復前 fishDamage 未持久化 → 永遠打不死）。實際批數=" + batches);
        assertTrue(batches <= 8,
                "河豚 HP=80 / 每發 ≥10，應在 8 批內致死，實際=" + batches);
    }

    @Test
    @DisplayName("最低注額打不死的大魚：殘血回收整場只 floor 一次，有效回收率不被侵蝕")
    void residualRecoveryIsFlooredOncePerSession() {
        // 龍王 HP=2000、銅炮每發 14（暴擊 28）：30 發最多 840 傷害，必定打不死 → 全額進殘血回收。
        long totalDamage = 0L;
        long perShotFlooredSum = 0L; // 舊版「逐發 floor」會拿到的金額，用來證明侵蝕確實被修掉
        for (long seq = 1; seq <= 30; seq++) {
            FishingShotsRequest.Shot shot = new FishingShotsRequest.Shot();
            shot.setShotSeq(seq);
            shot.setBetPerShot(CANNON_BET);
            shot.setFishType("DRAGON_KING");
            shot.setFishInstanceId("boss-1");
            FishingShotsResponse.ShotResult r =
                    service.shots(PLAYER_ID, SESSION_ID, List.of(shot)).getResults().get(0);
            assertTrue(r.isAccepted(), "子彈應被受理 seq=" + seq);
            assertTrue(!r.isKilled(), "龍王 30 發內不該死 seq=" + seq);
            totalDamage += r.getDamage();
            perShotFlooredSum += FishingCombat.recoveryPayout(CANNON_BET, 1, r.getDamage());
        }

        // 結算：把整場累傷一次換算成回收金額
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString(), anyString()))
                .thenAnswer(inv -> new WalletCreditResponse(1L, PLAYER_ID, inv.getArgument(1), 0L, 0L, 0L, false));
        when(roundRepository.findByRoundId(anyString())).thenReturn(java.util.Optional.empty());

        long totalBet = CANNON_BET * 30;
        long recovery = service.end(PLAYER_ID, SESSION_ID).getTotalPayout();

        // 1) 精確等於「先加總傷害、再 floor 一次」
        assertEquals(FishingCombat.recoveryPayout(CANNON_BET, 1, totalDamage), recovery,
                "殘血回收應由整場累傷一次算出");
        // 2) 嚴格優於舊版逐發 floor（bet=10 時舊版有效回收率只有 0.62）
        assertTrue(recovery > perShotFlooredSum,
                "整場一次 floor 必須拿回比逐發 floor 更多（舊 " + perShotFlooredSum + " → 新 " + recovery + "）");
        // 3) 有效回收率貼齊設計值 RECOVERY_RATE（誤差來自單一 floor，整場 < 1 星幣）
        double effectiveRate = (double) recovery / totalDamage
                * (FishingCombat.critFactor() * FishingCombat.cannonDamage(1)) / CANNON_BET;
        assertTrue(effectiveRate > FishingCombat.RECOVERY_RATE - 0.01,
                "有效回收率應貼齊 " + FishingCombat.RECOVERY_RATE + "，實際=" + effectiveRate);
        assertTrue(effectiveRate <= FishingCombat.RECOVERY_RATE + 1e-9, // 1e-9：double 除法的捨入誤差
                "回收率不得超過設計值（否則整體 RTP 會破 TARGET_RTP 天花板），實際=" + effectiveRate);
    }

    private FishingShotsResponse.ShotResult fireOneShot(long shotSeq) {
        FishingShotsRequest.Shot shot = new FishingShotsRequest.Shot();
        shot.setShotSeq(shotSeq);
        shot.setBetPerShot(CANNON_BET);
        shot.setFishType("PUFFER");
        shot.setFishInstanceId("fishA");
        FishingShotsResponse resp = service.shots(PLAYER_ID, SESSION_ID, List.of(shot));
        return resp.getResults().get(0);
    }
}
