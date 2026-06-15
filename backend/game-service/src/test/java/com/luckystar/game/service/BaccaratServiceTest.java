package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.baccarat.BaccaratGameService;
import com.luckystar.game.baccarat.BaccaratOutcome;
import com.luckystar.game.baccarat.BaccaratResult;
import com.luckystar.game.baccarat.BaccaratSettlement;
import com.luckystar.game.baccarat.Card;
import com.luckystar.game.client.WalletClient;
import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.client.dto.WalletDebitResponse;
import com.luckystar.game.dto.BaccaratBetResponse;
import com.luckystar.game.dto.BaccaratResultResponse;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.exception.InsufficientBalanceException;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.session.GameSession;
import com.luckystar.game.session.GameSessionState;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * {@link BaccaratService} 編排邏輯單元測試（純 Mockito）。mock {@link BaccaratGameService}
 * 直接決定牌局與結算，與 RNG 解耦。
 */
class BaccaratServiceTest {

    private static final long PLAYER_ID = 42L;
    private static final String ROUND_ID = "bac-round-1";

    private final ProvablyFairRng rng = org.mockito.Mockito.mock(ProvablyFairRng.class);
    private final BaccaratGameService baccaratGame = org.mockito.Mockito.mock(BaccaratGameService.class);
    private final WalletClient walletClient = org.mockito.Mockito.mock(WalletClient.class);
    private final GameRoundRepository roundRepository = org.mockito.Mockito.mock(GameRoundRepository.class);
    private final GameResultEventPublisher publisher = org.mockito.Mockito.mock(GameResultEventPublisher.class);
    private final com.luckystar.game.session.GameSessionService sessionService =
            org.mockito.Mockito.mock(com.luckystar.game.session.GameSessionService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();

    private BaccaratService service;

    private static BaccaratOutcome bankerWinOutcome() {
        return new BaccaratOutcome(
                List.of(new Card(0, 0), new Card(4, 0)),
                List.of(new Card(8, 0), new Card(0, 0)),
                5, 9, BaccaratResult.BANKER, false, false);
    }

    private static GameSession startedSession(long player, long banker, long tie) {
        long total = player + banker + tie;
        return GameSession.builder()
                .roundId(ROUND_ID).playerId(PLAYER_ID).gameType("BACCARAT")
                .betAmount(total).betPlayer(player).betBanker(banker).betTie(tie)
                .serverSeed("srv").serverSeedHash("hash").clientSeed("cli").nonce(0L)
                .state(GameSessionState.STARTED).build();
    }

    @BeforeEach
    void setUp() {
        service = new BaccaratService(rng, baccaratGame, walletClient, roundRepository,
                publisher, sessionService, objectMapper);
        when(rng.generateServerSeed()).thenReturn("srv");
        when(rng.commit("srv")).thenReturn("hash");
        when(rng.generateClientSeed()).thenReturn("gen-client");
        when(roundRepository.findByRoundId(anyString())).thenReturn(Optional.empty());
    }

    // ------------------------- placeBet -------------------------

    @Test
    @DisplayName("placeBet：扣三區總額、建 STARTED Session、回 serverSeedHash，不揭露 serverSeed")
    void placeBet_debitsTotalAndStartsSession() {
        when(walletClient.debit(eq(PLAYER_ID), eq(300L), anyString(), anyString()))
                .thenReturn(new WalletDebitResponse(1L, PLAYER_ID, 300L, 10000L, 9700L, false));

        BaccaratBetResponse res = service.placeBet(PLAYER_ID, 100L, 200L, 0L, "my-seed");

        assertEquals("baccarat", res.getGame());
        assertEquals(300L, res.getTotalBet());
        assertEquals("hash", res.getServerSeedHash());
        assertEquals("my-seed", res.getClientSeed());
        assertEquals(100L, res.getBets().get("player"));
        assertEquals(200L, res.getBets().get("banker"));
        assertEquals(0L, res.getBets().get("tie"));

        verify(walletClient).debit(eq(PLAYER_ID), eq(300L), eq("bac-bet-" + res.getRoundId()), eq(res.getRoundId()));

        ArgumentCaptor<GameSession> cap = ArgumentCaptor.forClass(GameSession.class);
        verify(sessionService).start(cap.capture());
        GameSession s = cap.getValue();
        assertEquals("BACCARAT", s.getGameType());
        assertEquals(300L, s.getBetAmount());
        assertEquals(200L, s.getBetBanker());
        assertEquals("srv", s.getServerSeed(), "Session 內保存保密 serverSeed");
    }

    @Test
    @DisplayName("placeBet：總額低於下限 → IllegalArgumentException，不扣款")
    void placeBet_belowMin_throws() {
        assertThrows(IllegalArgumentException.class,
                () -> service.placeBet(PLAYER_ID, 50L, 0L, 0L, null));
        verify(walletClient, never()).debit(anyLong(), anyLong(), anyString(), anyString());
        verify(sessionService, never()).start(any());
    }

    @Test
    @DisplayName("placeBet：總額超過上限 → IllegalArgumentException")
    void placeBet_aboveMax_throws() {
        assertThrows(IllegalArgumentException.class,
                () -> service.placeBet(PLAYER_ID, 3000L, 3000L, 0L, null));
        verify(walletClient, never()).debit(anyLong(), anyLong(), anyString(), anyString());
    }

    @Test
    @DisplayName("placeBet：餘額不足 → debit 拋例外即中止，不建 Session")
    void placeBet_insufficient_abortsBeforeSession() {
        when(walletClient.debit(anyLong(), anyLong(), anyString(), anyString()))
                .thenThrow(new InsufficientBalanceException("星幣餘額不足"));
        assertThrows(InsufficientBalanceException.class,
                () -> service.placeBet(PLAYER_ID, 100L, 0L, 0L, null));
        verify(sessionService, never()).start(any());
    }

    // ------------------------- settle -------------------------

    @Test
    @DisplayName("settle：押莊命中 → credit 195、寫對局、揭露 serverSeed、標記 SETTLED")
    void settle_bankerWin_creditsAndReveals() {
        when(sessionService.find(PLAYER_ID, ROUND_ID))
                .thenReturn(Optional.of(startedSession(0L, 100L, 0L)));
        BaccaratOutcome outcome = bankerWinOutcome();
        when(baccaratGame.deal(any())).thenReturn(outcome);
        Map<BaccaratResult, Long> payouts = new EnumMap<>(BaccaratResult.class);
        payouts.put(BaccaratResult.BANKER, 195L);
        when(baccaratGame.settle(eq(outcome), anyMap()))
                .thenReturn(new BaccaratSettlement(BaccaratResult.BANKER, 100L, 195L, payouts));
        when(walletClient.credit(eq(PLAYER_ID), eq(195L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 195L, 9700L, 9895L, 0L, false));

        BaccaratResultResponse res = service.settle(PLAYER_ID, ROUND_ID);

        assertEquals("BANKER", res.getResult());
        assertEquals(195L, res.getTotalPayout());
        assertEquals(195L, res.getPayouts().get("banker"));
        assertEquals(9895L, res.getWallet().getBalance());
        assertEquals("srv", res.getServerSeed(), "結算後揭露 serverSeed");

        verify(walletClient).credit(eq(PLAYER_ID), eq(195L), eq("bac-win-" + ROUND_ID), eq(ROUND_ID));
        verify(roundRepository).save(any());
        verify(publisher).publishBaccaratResult(any(), eq(outcome));
        verify(sessionService).markSettled(PLAYER_ID, ROUND_ID, "srv", 0L);
    }

    @Test
    @DisplayName("settle：全押錯（payout 0）→ 不呼叫 credit，wallet 為 null")
    void settle_noPayout_skipsCredit() {
        when(sessionService.find(PLAYER_ID, ROUND_ID))
                .thenReturn(Optional.of(startedSession(100L, 0L, 0L)));
        BaccaratOutcome outcome = bankerWinOutcome(); // 押閒但莊贏
        when(baccaratGame.deal(any())).thenReturn(outcome);
        when(baccaratGame.settle(eq(outcome), anyMap()))
                .thenReturn(new BaccaratSettlement(BaccaratResult.BANKER, 100L, 0L,
                        new EnumMap<>(BaccaratResult.class)));

        BaccaratResultResponse res = service.settle(PLAYER_ID, ROUND_ID);

        assertEquals(0L, res.getTotalPayout());
        assertNull(res.getWallet(), "未派彩時不帶 wallet");
        verify(walletClient, never()).credit(anyLong(), anyLong(), anyString(), anyString());
        verify(roundRepository).save(any());
        verify(sessionService).markSettled(PLAYER_ID, ROUND_ID, "srv", 0L);
    }

    @Test
    @DisplayName("settle：Session 不存在/逾時 → RoundNotFoundException")
    void settle_missingSession_throws() {
        when(sessionService.find(PLAYER_ID, ROUND_ID)).thenReturn(Optional.empty());
        assertThrows(RoundNotFoundException.class, () -> service.settle(PLAYER_ID, ROUND_ID));
        verify(baccaratGame, never()).deal(any());
        verify(walletClient, never()).credit(anyLong(), anyLong(), anyString(), anyString());
    }

    @Test
    @DisplayName("settle 冪等：對局已落地 → 不重複寫庫/發事件")
    void settle_alreadyPersisted_skipsSaveAndPublish() {
        when(sessionService.find(PLAYER_ID, ROUND_ID))
                .thenReturn(Optional.of(startedSession(0L, 100L, 0L)));
        BaccaratOutcome outcome = bankerWinOutcome();
        when(baccaratGame.deal(any())).thenReturn(outcome);
        Map<BaccaratResult, Long> payouts = new EnumMap<>(BaccaratResult.class);
        payouts.put(BaccaratResult.BANKER, 195L);
        when(baccaratGame.settle(eq(outcome), anyMap()))
                .thenReturn(new BaccaratSettlement(BaccaratResult.BANKER, 100L, 195L, payouts));
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 195L, 9700L, 9895L, 0L, true));
        when(roundRepository.findByRoundId(ROUND_ID)).thenReturn(Optional.of(new GameRound()));

        BaccaratResultResponse res = service.settle(PLAYER_ID, ROUND_ID);

        assertEquals(195L, res.getTotalPayout());
        verify(roundRepository, never()).save(any());
        verify(publisher, never()).publishBaccaratResult(any(), any());
    }
}
