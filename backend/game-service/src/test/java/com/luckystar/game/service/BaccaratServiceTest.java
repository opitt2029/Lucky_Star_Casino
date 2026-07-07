package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
import com.luckystar.game.exception.WalletUnavailableException;
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
    private final RiskControlService riskControlService = org.mockito.Mockito.mock(RiskControlService.class);
    private final com.luckystar.game.compensation.WalletCompensationService compensationService =
            org.mockito.Mockito.mock(com.luckystar.game.compensation.WalletCompensationService.class);

    private BaccaratService service;

    private static BaccaratOutcome bankerWinOutcome() {
        return new BaccaratOutcome(
                List.of(new Card(0, 0), new Card(4, 0)),
                List.of(new Card(8, 0), new Card(0, 0)),
                5, 9, BaccaratResult.BANKER, false, false);
    }

    private static BaccaratOutcome playerWinOutcome() {
        return new BaccaratOutcome(
                List.of(new Card(8, 0), new Card(0, 0)),
                List.of(new Card(4, 0), new Card(0, 0)),
                9, 5, BaccaratResult.PLAYER, false, false);
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
                publisher, sessionService, objectMapper, riskControlService, compensationService);
        // 預設：風控不攔截
        when(riskControlService.shouldIntercept(anyLong(), anyString())).thenReturn(false);
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
    @DisplayName("settle：押莊命中 → credit 派彩+反水（195+1=196）、寫對局、揭露 serverSeed、標記 SETTLED")
    void settle_bankerWin_creditsAndReveals() {
        when(sessionService.find(PLAYER_ID, ROUND_ID))
                .thenReturn(Optional.of(startedSession(0L, 100L, 0L)));
        BaccaratOutcome outcome = bankerWinOutcome();
        when(baccaratGame.deal(any())).thenReturn(outcome);
        Map<BaccaratResult, Long> payouts = new EnumMap<>(BaccaratResult.class);
        payouts.put(BaccaratResult.BANKER, 195L);
        when(baccaratGame.settle(eq(outcome), anyMap()))
                .thenReturn(new BaccaratSettlement(BaccaratResult.BANKER, 100L, 195L, payouts));
        // 反水 = max(1, 100/200) = 1；credit = 195 + 1 = 196
        when(walletClient.credit(eq(PLAYER_ID), eq(196L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 196L, 9700L, 9896L, 0L, false));

        BaccaratResultResponse res = service.settle(PLAYER_ID, ROUND_ID);

        assertEquals("BANKER", res.getResult());
        assertEquals(195L, res.getTotalPayout());
        assertEquals(1L, res.getRebate());
        assertEquals(195L, res.getPayouts().get("banker"));
        assertEquals(9896L, res.getWallet().getBalance());
        assertEquals("srv", res.getServerSeed(), "結算後揭露 serverSeed");

        verify(walletClient).credit(eq(PLAYER_ID), eq(196L), eq("bac-win-" + ROUND_ID), eq(ROUND_ID));
        verify(roundRepository).save(any());
        verify(publisher).publishBaccaratResult(any(), eq(outcome));
        verify(sessionService).markSettled(PLAYER_ID, ROUND_ID, "srv", 0L);
    }

    @Test
    @DisplayName("settle：全押錯（payout 0）→ 仍 credit 反水 1 星幣，wallet 有值")
    void settle_noPayout_creditsRebate() {
        when(sessionService.find(PLAYER_ID, ROUND_ID))
                .thenReturn(Optional.of(startedSession(100L, 0L, 0L)));
        BaccaratOutcome outcome = bankerWinOutcome(); // 押閒但莊贏
        when(baccaratGame.deal(any())).thenReturn(outcome);
        when(baccaratGame.settle(eq(outcome), anyMap()))
                .thenReturn(new BaccaratSettlement(BaccaratResult.BANKER, 100L, 0L,
                        new EnumMap<>(BaccaratResult.class)));
        // 反水 = max(1, 100/200) = 1；credit = 0 + 1 = 1
        when(walletClient.credit(eq(PLAYER_ID), eq(1L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 1L, 9600L, 9601L, 0L, false));

        BaccaratResultResponse res = service.settle(PLAYER_ID, ROUND_ID);

        assertEquals(0L, res.getTotalPayout());
        assertEquals(1L, res.getRebate());
        assertEquals(9601L, res.getWallet().getBalance(), "輸局仍有反水入帳後的 wallet");
        verify(walletClient).credit(eq(PLAYER_ID), eq(1L), eq("bac-win-" + ROUND_ID), eq(ROUND_ID));
        verify(roundRepository).save(any());
        verify(sessionService).markSettled(PLAYER_ID, ROUND_ID, "srv", 0L);
    }

    @Test
    @DisplayName("settle：credit 失敗 → 落補償單（同一冪等鍵、subType=WIN）並拋回原例外，不寫對局、不揭露")
    void settle_creditFails_recordsCompensationAndRethrows() {
        when(sessionService.find(PLAYER_ID, ROUND_ID))
                .thenReturn(Optional.of(startedSession(0L, 100L, 0L)));
        BaccaratOutcome outcome = bankerWinOutcome();
        when(baccaratGame.deal(any())).thenReturn(outcome);
        Map<BaccaratResult, Long> payouts = new EnumMap<>(BaccaratResult.class);
        payouts.put(BaccaratResult.BANKER, 195L);
        when(baccaratGame.settle(eq(outcome), anyMap()))
                .thenReturn(new BaccaratSettlement(BaccaratResult.BANKER, 100L, 195L, payouts));
        when(walletClient.credit(eq(PLAYER_ID), eq(196L), anyString(), anyString()))
                .thenThrow(new WalletUnavailableException("wallet down"));

        assertThrows(WalletUnavailableException.class, () -> service.settle(PLAYER_ID, ROUND_ID));

        // 補償單冪等鍵必須＝剛剛失敗的 credit 冪等鍵 bac-win-<roundId>，金額含反水（195+1）
        verify(compensationService).recordPending(eq("BACCARAT"), eq(ROUND_ID), eq(PLAYER_ID), eq(196L),
                eq("WIN"), eq("bac-win-" + ROUND_ID), any(WalletUnavailableException.class));
        // 主流程中止：Session 仍為 STARTED（可重試 /result）、對局未落地
        verify(roundRepository, never()).save(any());
        verify(sessionService, never()).markSettled(anyLong(), anyString(), any(), any());
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
    @DisplayName("settle 風控攔截：初始 PLAYER 結果被強制替換為莊家贏，押閒無派彩")
    void settle_riskIntercept_forcesBankerWin() {
        when(sessionService.find(PLAYER_ID, ROUND_ID))
                .thenReturn(Optional.of(startedSession(100L, 0L, 0L))); // 押閒
        when(riskControlService.shouldIntercept(anyLong(), anyString())).thenReturn(true);
        BaccaratOutcome bankerOutcome = bankerWinOutcome();
        when(baccaratGame.deal(any()))
                .thenReturn(playerWinOutcome()) // nonce 0 → PLAYER（原始結果）
                .thenReturn(bankerOutcome);      // 風控搜尋到的 BANKER
        when(baccaratGame.settle(eq(bankerOutcome), anyMap()))
                .thenReturn(new BaccaratSettlement(BaccaratResult.BANKER, 100L, 0L,
                        new EnumMap<>(BaccaratResult.class)));

        // 風控攔截後押閒無派彩，但反水仍入帳
        when(walletClient.credit(eq(PLAYER_ID), eq(1L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 1L, 9600L, 9601L, 0L, false));

        BaccaratResultResponse res = service.settle(PLAYER_ID, ROUND_ID);

        assertEquals("BANKER", res.getResult(), "風控攔截後應為莊家贏");
        assertEquals(0L, res.getTotalPayout(), "押閒但莊贏，無派彩");
        assertEquals(1L, res.getRebate());
        verify(walletClient).credit(eq(PLAYER_ID), eq(1L), anyString(), anyString());
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
        // credit = 195 + 1(反水) = 196
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 196L, 9700L, 9896L, 0L, true));
        when(roundRepository.findByRoundId(ROUND_ID)).thenReturn(Optional.of(new GameRound()));

        BaccaratResultResponse res = service.settle(PLAYER_ID, ROUND_ID);

        assertEquals(195L, res.getTotalPayout());
        verify(roundRepository, never()).save(any());
        verify(publisher, never()).publishBaccaratResult(any(), any());
    }
}
