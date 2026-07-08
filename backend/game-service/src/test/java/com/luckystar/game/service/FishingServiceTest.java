package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.client.WalletClient;
import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.client.dto.WalletDebitResponse;
import com.luckystar.game.dto.FishingShotsRequest;
import com.luckystar.game.exception.WalletUnavailableException;
import com.luckystar.game.fishing.FishingSession;
import com.luckystar.game.fishing.FishingSessionStore;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * {@link FishingService} 編排邏輯單元測試（純 Mockito，不載入 Spring）。
 * 聚焦「進場扣款後 Session 建立失敗」的退款補償，避免孤兒扣款。
 */
class FishingServiceTest {

    private static final long PLAYER_ID = 1169L;
    private static final long BUY_IN = 5000L;
    private static final int CANNON_LEVEL = 3;
    private static final long BET_PER_SHOT = 100L;

    private final ProvablyFairRng rng = org.mockito.Mockito.mock(ProvablyFairRng.class);
    private final WalletClient walletClient = org.mockito.Mockito.mock(WalletClient.class);
    private final FishingSessionStore sessionStore = org.mockito.Mockito.mock(FishingSessionStore.class);
    private final GameRoundRepository roundRepository = org.mockito.Mockito.mock(GameRoundRepository.class);
    private final GameResultEventPublisher publisher = org.mockito.Mockito.mock(GameResultEventPublisher.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RiskControlService riskControlService = org.mockito.Mockito.mock(RiskControlService.class);

    private FishingService service;

    @BeforeEach
    void setUp() {
        service = new FishingService(rng, walletClient, sessionStore, roundRepository, publisher, objectMapper, riskControlService);
        // 預設：風控不攔截
        when(riskControlService.shouldIntercept(anyLong(), anyString())).thenReturn(false);
        when(rng.generateServerSeed()).thenReturn("server-seed");
        when(rng.commit(anyString())).thenReturn("server-seed-hash");
        when(rng.generateClientSeed()).thenReturn("client-seed");
        when(sessionStore.find(PLAYER_ID)).thenReturn(Optional.empty());
        when(walletClient.debit(anyLong(), anyLong(), anyString(), anyString()))
                .thenReturn(new WalletDebitResponse(1L, PLAYER_ID, BUY_IN, 600200L, 595200L, false));
    }

    @Test
    @DisplayName("進場扣款後 Session 存檔失敗 → 自動以補償冪等鍵退款，並上拋原例外")
    void start_whenSessionSaveFails_refundsBuyIn() {
        org.mockito.Mockito.doThrow(new RuntimeException("redis down"))
                .when(sessionStore).save(any(FishingSession.class));
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, BUY_IN, 595200L, 600200L, 0L, false));

        assertThrows(RuntimeException.class,
                () -> service.start(PLAYER_ID, BUY_IN, CANNON_LEVEL, BET_PER_SHOT, "client-seed"));

        // 必須觸發退款 credit，subType=REFUND（非 WIN，避免被 rank 計入贏幣榜），冪等鍵為 fishing-buyin-refund-<sessionId>
        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<String> idemKey = ArgumentCaptor.forClass(String.class);
        verify(walletClient).credit(eq(PLAYER_ID), amount.capture(), eq("REFUND"), idemKey.capture(), anyString());
        assertEquals(BUY_IN, amount.getValue());
        assertTrue(idemKey.getValue().startsWith("fishing-buyin-refund-"),
                "退款冪等鍵應為 fishing-buyin-refund- 前綴，實際=" + idemKey.getValue());
    }

    @Test
    @DisplayName("退款本身也失敗時不吞掉原例外（仍上拋，留待人工/排程對帳）")
    void start_whenRefundAlsoFails_stillThrowsOriginal() {
        org.mockito.Mockito.doThrow(new RuntimeException("redis down"))
                .when(sessionStore).save(any(FishingSession.class));
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString(), anyString()))
                .thenThrow(new WalletUnavailableException("wallet down"));

        assertThrows(RuntimeException.class,
                () -> service.start(PLAYER_ID, BUY_IN, CANNON_LEVEL, BET_PER_SHOT, "client-seed"));

        verify(walletClient).credit(eq(PLAYER_ID), eq(BUY_IN), eq("REFUND"), anyString(), anyString());
    }

    @Test
    @DisplayName("Session 存檔成功時不應退款")
    void start_whenSaveSucceeds_noRefund() {
        // sessionStore.save 預設不丟例外
        service.start(PLAYER_ID, BUY_IN, CANNON_LEVEL, BET_PER_SHOT, "client-seed");

        verify(sessionStore).save(any(FishingSession.class));
        verify(walletClient, never()).credit(anyLong(), anyLong(), anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("面額守門：betPerShot 超出 [MIN_BET, MAX_BET] 時拒絕開場、不扣款")
    void start_rejectsBetPerShotOutOfRange() {
        assertThrows(IllegalArgumentException.class,
                () -> service.start(PLAYER_ID, BUY_IN, CANNON_LEVEL, FishingService.MIN_BET - 1, "client-seed"));
        assertThrows(IllegalArgumentException.class,
                () -> service.start(PLAYER_ID, BUY_IN, CANNON_LEVEL, FishingService.MAX_BET + 1, "client-seed"));
        // 守門在扣款前，故 wallet 不應被觸發
        verify(walletClient, never()).debit(anyLong(), anyLong(), anyString(), anyString());
    }

    @Test
    @DisplayName("shots reject in-round betPerShot or cannonLevel changes")
    void shots_rejectsChangingSessionBetOrCannon() {
        FishingSession active = FishingSession.builder()
                .sessionId("sess-fixed").playerId(PLAYER_ID).cannonLevel(2).betPerShot(50L)
                .buyIn(BUY_IN).balanceBefore(600000L).sessionBalance(1000L)
                .totalBet(0L).totalPayout(0L).totalShots(0L).lastShotSeq(0L)
                .serverSeed("srv").serverSeedHash("hash").clientSeed("cli").state("ACTIVE")
                .createdAt(Instant.now()).lastActivityAt(Instant.now())
                .build();
        when(sessionStore.find(PLAYER_ID)).thenReturn(Optional.of(active));

        FishingShotsRequest.Shot changedBet = shot(1L, 100L, 2, "KOI", "fish-a");
        assertThrows(IllegalArgumentException.class,
                () -> service.shots(PLAYER_ID, "sess-fixed", List.of(changedBet)));

        FishingShotsRequest.Shot changedCannon = shot(1L, 50L, 3, "KOI", "fish-a");
        assertThrows(IllegalArgumentException.class,
                () -> service.shots(PLAYER_ID, "sess-fixed", List.of(changedCannon)));

        verify(sessionStore, never()).save(any(FishingSession.class));
    }

    @Test
    @DisplayName("結算殘血回收：受傷未死的魚退還部分子彈成本，計入 credited 與 totalPayout")
    void end_creditsResidualRecoveryForDamagedUnkilledFish() {
        long betPerShot = 100L;
        int cannonLevel = 1; // 傷害 10
        java.util.Map<String, Long> fishDamage = new java.util.LinkedHashMap<>();
        fishDamage.put("f1", 1000L); // 受傷未死
        fishDamage.put("f2", 500L);
        FishingSession active = FishingSession.builder()
                .sessionId("sess-r").playerId(PLAYER_ID).cannonLevel(cannonLevel).betPerShot(betPerShot)
                .buyIn(BUY_IN).balanceBefore(600000L).sessionBalance(200L)
                .totalBet(4800L).totalPayout(0L).totalShots(48L).lastShotSeq(48L)
                .serverSeed("srv").serverSeedHash("hash").clientSeed("cli").state("ACTIVE")
                .createdAt(java.time.Instant.now()).lastActivityAt(java.time.Instant.now())
                .fishDamage(fishDamage)
                .build();
        when(sessionStore.find(PLAYER_ID)).thenReturn(Optional.of(active));
        when(roundRepository.findByRoundId("sess-r")).thenReturn(Optional.empty());
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(9L, PLAYER_ID, 0L, 200L, 200L, 0L, false));

        var resp = service.end(PLAYER_ID, "sess-r");

        long expectedRecovery =
                com.luckystar.game.fishing.FishingCombat.recoveryPayout(betPerShot, cannonLevel, 1000L)
                        + com.luckystar.game.fishing.FishingCombat.recoveryPayout(betPerShot, cannonLevel, 500L);
        assertTrue(expectedRecovery > 0, "測試資料應產生正回收");
        assertEquals(expectedRecovery, resp.getResidualRecovery(), "回應應帶殘血回收金額");
        // credited = 剩餘局內餘額(200) + 回收
        assertEquals(200L + expectedRecovery, resp.getCredited());
        // 實際 credit 回 wallet 的金額應含回收
        ArgumentCaptor<Long> credited = ArgumentCaptor.forClass(Long.class);
        verify(walletClient).credit(eq(PLAYER_ID), credited.capture(), eq("REFUND"), anyString(), anyString());
        assertEquals(200L + expectedRecovery, credited.getValue());
        // totalPayout 計入回收（→ game_rounds.win_amount，RTP 監控涵蓋）
        assertEquals(expectedRecovery, resp.getTotalPayout());
    }

    private static FishingShotsRequest.Shot shot(long seq, long betPerShot, Integer cannonLevel,
                                                 String fishType, String fishInstanceId) {
        FishingShotsRequest.Shot shot = new FishingShotsRequest.Shot();
        shot.setShotSeq(seq);
        shot.setBetPerShot(betPerShot);
        shot.setCannonLevel(cannonLevel);
        shot.setFishType(fishType);
        shot.setFishInstanceId(fishInstanceId);
        return shot;
    }
}
