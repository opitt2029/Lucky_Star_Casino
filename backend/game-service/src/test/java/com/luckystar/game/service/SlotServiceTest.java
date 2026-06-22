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
import com.luckystar.game.dto.PrepareRoundResponse;
import com.luckystar.game.dto.SpinResponse;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.exception.InsufficientBalanceException;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.session.GameSession;
import com.luckystar.game.session.GameSessionService;
import com.luckystar.game.session.GameSessionState;
import com.luckystar.game.slot.SlotMachine;
import com.luckystar.game.slot.SlotOutcome;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * {@link SlotService} 編排邏輯單元測試（純 Mockito，不載入 Spring）。
 * 透過 mock {@link SlotMachine} 直接決定命中/未中，與 RNG 解耦。涵蓋單次模式（spin）與
 * 兩階段 commit-ahead（prepareRound / settle，T-033）。
 */
class SlotServiceTest {

    private static final long PLAYER_ID = 42L;
    private static final long BET = 100L;
    private static final String ROUND_ID = "round-xyz";

    private final ProvablyFairRng rng = org.mockito.Mockito.mock(ProvablyFairRng.class);
    private final SlotMachine slotMachine = org.mockito.Mockito.mock(SlotMachine.class);
    private final WalletClient walletClient = org.mockito.Mockito.mock(WalletClient.class);
    private final GameRoundRepository roundRepository = org.mockito.Mockito.mock(GameRoundRepository.class);
    private final GameResultEventPublisher publisher = org.mockito.Mockito.mock(GameResultEventPublisher.class);
    private final GameSessionService sessionService = org.mockito.Mockito.mock(GameSessionService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RiskControlService riskControlService = org.mockito.Mockito.mock(RiskControlService.class);

    private SlotService service;

    private static SlotOutcome winOutcome() {
        return new SlotOutcome(
                new String[][] {{"a", "b", "c"}, {"x", "x", "x"}, {"d", "e", "f"}},
                true, 5, 500L, new int[][] {{1, 0}, {1, 1}, {1, 2}});
    }

    private static SlotOutcome loseOutcome() {
        return new SlotOutcome(
                new String[][] {{"a", "b", "c"}, {"x", "y", "z"}, {"d", "e", "f"}},
                false, 0, 0L, new int[0][]);
    }

    private static GameSession startedSession() {
        return GameSession.builder()
                .roundId(ROUND_ID)
                .playerId(PLAYER_ID)
                .gameType("SLOT")
                .betAmount(BET)
                .serverSeed("srv")
                .serverSeedHash("hash")
                .clientSeed("cli")
                .nonce(0L)
                .state(GameSessionState.STARTED)
                .build();
    }

    @BeforeEach
    void setUp() {
        service = new SlotService(rng, slotMachine, walletClient, roundRepository,
                publisher, sessionService, objectMapper, riskControlService);
        // 預設：風控不攔截
        when(riskControlService.shouldIntercept(anyLong(), anyString())).thenReturn(false);
        when(rng.generateServerSeed()).thenReturn("srv");
        when(rng.commit("srv")).thenReturn("hash");
        when(rng.generateClientSeed()).thenReturn("gen-client");
        // 預設：對局尚未落地（settleInternal 會以此判定是否寫庫）
        when(roundRepository.findByRoundId(anyString())).thenReturn(Optional.empty());
        // 扣款後餘額 = 10000 - bet
        when(walletClient.debit(eq(PLAYER_ID), eq(BET), anyString(), anyString()))
                .thenReturn(new WalletDebitResponse(1L, PLAYER_ID, BET, 10000L, 10000L - BET, false));
    }

    // ------------------------------------------------------------------
    // 單次模式 spin（T-032，相容前端）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("spin 命中：扣款後再派彩，餘額採 credit 後餘額，credit 被呼叫一次")
    void spin_win_creditsPayout() {
        when(slotMachine.spin(any(), eq(BET))).thenReturn(winOutcome());
        when(walletClient.credit(eq(PLAYER_ID), eq(500L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 500L, 9900L, 10400L, 0L, false));

        SpinResponse res = service.spin(PLAYER_ID, BET, "my-seed", false);

        assertEquals("slot", res.getGame());
        assertEquals(5, res.getMultiplier());
        assertEquals(500L, res.getPayout());
        assertEquals(10400L, res.getWallet().getBalance(), "命中後餘額應為 credit 後餘額");
        assertEquals("my-seed", res.getClientSeed(), "應使用玩家提供的 clientSeed");
        assertEquals("srv", res.getServerSeed());
        assertEquals("hash", res.getServerSeedHash());

        verify(walletClient).credit(eq(PLAYER_ID), eq(500L), anyString(), anyString());

        ArgumentCaptor<GameRound> roundCaptor = ArgumentCaptor.forClass(GameRound.class);
        verify(roundRepository).save(roundCaptor.capture());
        GameRound saved = roundCaptor.getValue();
        assertEquals("SETTLED", saved.getStatus());
        assertEquals("SLOT", saved.getGameType());
        assertEquals(BET, saved.getBetAmount());
        assertEquals(500L, saved.getWinAmount());
        assertEquals(res.getRoundId(), saved.getRoundId());
        assertEquals("my-seed", saved.getClientSeed());
        assertTrue(saved.getResultData().contains("\"multiplier\":5"), "result_data 應含結果 JSON");

        verify(publisher).publishSlotResult(any(), any());
        // 單次模式不使用 Session
        verify(sessionService, never()).start(any());
        verify(sessionService, never()).markSettled(anyLong(), anyString(), any(), any());
    }

    @Test
    @DisplayName("spin 命中：debit 與 credit 使用確定性冪等鍵與相同 referenceId(roundId)")
    void spin_win_usesDeterministicIdempotencyKeys() {
        when(slotMachine.spin(any(), eq(BET))).thenReturn(winOutcome());
        when(walletClient.credit(eq(PLAYER_ID), eq(500L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 500L, 9900L, 10400L, 0L, false));

        SpinResponse res = service.spin(PLAYER_ID, BET, null, false);
        String roundId = res.getRoundId();

        ArgumentCaptor<String> debitKey = ArgumentCaptor.forClass(String.class);
        verify(walletClient).debit(eq(PLAYER_ID), eq(BET), debitKey.capture(), eq(roundId));
        assertEquals("slot-bet-" + roundId, debitKey.getValue());

        ArgumentCaptor<String> creditKey = ArgumentCaptor.forClass(String.class);
        verify(walletClient).credit(eq(PLAYER_ID), eq(500L), creditKey.capture(), eq(roundId));
        assertEquals("slot-win-" + roundId, creditKey.getValue());

        assertEquals("gen-client", res.getClientSeed());
    }

    @Test
    @DisplayName("spin 未中：不呼叫 credit，餘額採 debit 後餘額，對局 winAmount 為 0")
    void spin_lose_noCreditPersistsZeroWin() {
        when(slotMachine.spin(any(), eq(BET))).thenReturn(loseOutcome());

        SpinResponse res = service.spin(PLAYER_ID, BET, null, false);

        assertEquals(0, res.getMultiplier());
        assertEquals(0L, res.getPayout());
        assertEquals(9900L, res.getWallet().getBalance(), "未中餘額應為 debit 後餘額");
        assertEquals(0, res.getWinningCells().length);

        verify(walletClient, never()).credit(anyLong(), anyLong(), anyString(), anyString());

        ArgumentCaptor<GameRound> roundCaptor = ArgumentCaptor.forClass(GameRound.class);
        verify(roundRepository).save(roundCaptor.capture());
        assertEquals(0L, roundCaptor.getValue().getWinAmount());
        verify(publisher).publishSlotResult(any(), any());
    }

    @Test
    @DisplayName("spin fortuneReady=true 且風控攔截：guaranteed=true 幸運值應清零，無派彩")
    void spin_fortuneReadyWithRiskIntercept_guaranteedTrueNoPayout() {
        when(riskControlService.shouldIntercept(anyLong(), anyString())).thenReturn(true);
        when(slotMachine.spin(any(), eq(BET))).thenReturn(winOutcome());

        SpinResponse res = service.spin(PLAYER_ID, BET, null, true);

        assertTrue(res.isGuaranteed(), "fortuneReady=true 時即使風控攔截，guaranteed 仍應為 true 以清零幸運值");
        assertEquals(0L, res.getPayout(), "風控攔截後派彩應為 0");
    }

    @Test
    @DisplayName("spin fortuneReady=false：guaranteed=false，幸運值不受影響")
    void spin_noFortuneReady_guaranteedFalse() {
        when(slotMachine.spin(any(), eq(BET))).thenReturn(winOutcome());
        when(walletClient.credit(eq(PLAYER_ID), eq(500L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 500L, 9900L, 10400L, 0L, false));

        SpinResponse res = service.spin(PLAYER_ID, BET, null, false);

        assertEquals(false, res.isGuaranteed(), "fortuneReady=false 時 guaranteed 應為 false");
    }

    @Test
    @DisplayName("spin 餘額不足：debit 拋例外即中止，不執行 RNG / 派彩 / 寫庫")
    void spin_insufficientBalance_abortsEarly() {
        when(walletClient.debit(eq(PLAYER_ID), eq(BET), anyString(), anyString()))
                .thenThrow(new InsufficientBalanceException("星幣餘額不足"));

        assertThrows(InsufficientBalanceException.class, () -> service.spin(PLAYER_ID, BET, null, false));

        verify(slotMachine, never()).spin(any(), anyLong());
        verify(walletClient, never()).credit(anyLong(), anyLong(), anyString(), anyString());
        verify(roundRepository, never()).save(any());
        verify(publisher, never()).publishSlotResult(any(), any());
    }

    // ------------------------------------------------------------------
    // 兩階段 commit-ahead：prepareRound（T-033）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("prepareRound：建立 STARTED Session、回傳 serverSeedHash，且不揭露 serverSeed、不扣款")
    void prepareRound_startsSessionWithoutDebit() {
        PrepareRoundResponse res = service.prepareRound(PLAYER_ID, BET, "my-seed");

        assertEquals("slot", res.getGame());
        assertEquals(BET, res.getBet());
        assertEquals("hash", res.getServerSeedHash());
        assertEquals("my-seed", res.getClientSeed());

        ArgumentCaptor<GameSession> sessionCaptor = ArgumentCaptor.forClass(GameSession.class);
        verify(sessionService).start(sessionCaptor.capture());
        GameSession started = sessionCaptor.getValue();
        // roundId 為隨機 UUID，僅確認非空，且與回應一致
        assertTrue(started.getRoundId() != null && !started.getRoundId().isBlank());
        assertEquals(res.getRoundId(), started.getRoundId());
        assertEquals(PLAYER_ID, started.getPlayerId());
        assertEquals(BET, started.getBetAmount());
        assertEquals("srv", started.getServerSeed(), "Session 內保存保密 serverSeed");
        assertEquals("hash", started.getServerSeedHash());
        assertEquals("my-seed", started.getClientSeed());

        // 開局不扣款、不轉動、不寫庫
        verify(walletClient, never()).debit(anyLong(), anyLong(), anyString(), anyString());
        verify(slotMachine, never()).spin(any(), anyLong());
        verify(roundRepository, never()).save(any());
    }

    @Test
    @DisplayName("prepareRound：未提供 clientSeed 時使用伺服器產生值")
    void prepareRound_generatesClientSeedWhenAbsent() {
        PrepareRoundResponse res = service.prepareRound(PLAYER_ID, BET, null);
        assertEquals("gen-client", res.getClientSeed());
    }

    // ------------------------------------------------------------------
    // 兩階段 commit-ahead：settle（T-033）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("settle 命中：以 Session 種子結算、揭露 serverSeed、標記 SETTLED")
    void settle_win_revealsSeedAndMarksSettled() {
        when(sessionService.find(PLAYER_ID, ROUND_ID)).thenReturn(Optional.of(startedSession()));
        when(slotMachine.spin(any(), eq(BET))).thenReturn(winOutcome());
        when(walletClient.credit(eq(PLAYER_ID), eq(500L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 500L, 9900L, 10400L, 0L, false));

        SpinResponse res = service.settle(PLAYER_ID, ROUND_ID);

        assertEquals(ROUND_ID, res.getRoundId());
        assertEquals(500L, res.getPayout());
        assertEquals("srv", res.getServerSeed(), "結算後揭露 serverSeed");
        assertEquals("cli", res.getClientSeed());
        assertEquals(10400L, res.getWallet().getBalance());

        // 帳務用開局綁定的下注額與確定性冪等鍵
        verify(walletClient).debit(eq(PLAYER_ID), eq(BET), eq("slot-bet-" + ROUND_ID), eq(ROUND_ID));
        verify(walletClient).credit(eq(PLAYER_ID), eq(500L), eq("slot-win-" + ROUND_ID), eq(ROUND_ID));
        verify(roundRepository).save(any());
        verify(publisher).publishSlotResult(any(), any());
        // 揭露 serverSeed 並標記結算
        verify(sessionService).markSettled(PLAYER_ID, ROUND_ID, "srv", 0L);
    }

    @Test
    @DisplayName("settle：Session 不存在/逾時 → RoundNotFoundException，不扣款")
    void settle_missingSession_throws() {
        when(sessionService.find(PLAYER_ID, ROUND_ID)).thenReturn(Optional.empty());

        assertThrows(RoundNotFoundException.class, () -> service.settle(PLAYER_ID, ROUND_ID));

        verify(walletClient, never()).debit(anyLong(), anyLong(), anyString(), anyString());
        verify(slotMachine, never()).spin(any(), anyLong());
        verify(sessionService, never()).markSettled(anyLong(), anyString(), any(), any());
    }

    @Test
    @DisplayName("settle 冪等：對局已落地時不重複寫庫/發事件（帳務仍走冪等鍵）")
    void settle_alreadyPersisted_skipsSaveAndPublish() {
        when(sessionService.find(PLAYER_ID, ROUND_ID)).thenReturn(Optional.of(startedSession()));
        when(slotMachine.spin(any(), eq(BET))).thenReturn(winOutcome());
        when(walletClient.credit(eq(PLAYER_ID), eq(500L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 500L, 9900L, 10400L, 0L, true));
        // 模擬本局已落地
        when(roundRepository.findByRoundId(ROUND_ID)).thenReturn(Optional.of(new GameRound()));

        SpinResponse res = service.settle(PLAYER_ID, ROUND_ID);

        assertEquals(500L, res.getPayout(), "結果由 seed 確定性重算，與首次一致");
        verify(roundRepository, never()).save(any());
        verify(publisher, never()).publishSlotResult(any(), any());
    }
}
