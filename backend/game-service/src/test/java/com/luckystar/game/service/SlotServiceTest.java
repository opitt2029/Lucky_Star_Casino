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
import com.luckystar.game.dto.SpinResponse;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.exception.InsufficientBalanceException;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.slot.SlotMachine;
import com.luckystar.game.slot.SlotOutcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * {@link SlotService} 編排邏輯單元測試（純 Mockito，不載入 Spring）。
 * 透過 mock {@link SlotMachine} 直接決定命中/未中，與 RNG 解耦。
 */
class SlotServiceTest {

    private static final long PLAYER_ID = 42L;
    private static final long BET = 100L;

    private final ProvablyFairRng rng = org.mockito.Mockito.mock(ProvablyFairRng.class);
    private final SlotMachine slotMachine = org.mockito.Mockito.mock(SlotMachine.class);
    private final WalletClient walletClient = org.mockito.Mockito.mock(WalletClient.class);
    private final GameRoundRepository roundRepository = org.mockito.Mockito.mock(GameRoundRepository.class);
    private final GameResultEventPublisher publisher = org.mockito.Mockito.mock(GameResultEventPublisher.class);
    private final ObjectMapper objectMapper = new ObjectMapper();

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

    @BeforeEach
    void setUp() {
        service = new SlotService(rng, slotMachine, walletClient, roundRepository, publisher, objectMapper);
        when(rng.generateServerSeed()).thenReturn("srv");
        when(rng.commit("srv")).thenReturn("hash");
        when(rng.generateClientSeed()).thenReturn("gen-client");
        // 扣款後餘額 = 10000 - bet
        when(walletClient.debit(eq(PLAYER_ID), eq(BET), anyString(), anyString()))
                .thenReturn(new WalletDebitResponse(1L, PLAYER_ID, BET, 10000L, 10000L - BET, false));
    }

    @Test
    @DisplayName("命中：扣款後再派彩，餘額採 credit 後餘額，credit 被呼叫一次")
    void spin_win_creditsPayout() {
        when(slotMachine.spin(any(), eq(BET))).thenReturn(winOutcome());
        when(walletClient.credit(eq(PLAYER_ID), eq(500L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 500L, 9900L, 10400L, 0L, false));

        SpinResponse res = service.spin(PLAYER_ID, BET, "my-seed");

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
    }

    @Test
    @DisplayName("命中時 debit 與 credit 使用確定性冪等鍵與相同 referenceId(roundId)")
    void spin_win_usesDeterministicIdempotencyKeys() {
        when(slotMachine.spin(any(), eq(BET))).thenReturn(winOutcome());
        when(walletClient.credit(eq(PLAYER_ID), eq(500L), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 500L, 9900L, 10400L, 0L, false));

        SpinResponse res = service.spin(PLAYER_ID, BET, null);
        String roundId = res.getRoundId();

        ArgumentCaptor<String> debitKey = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> debitRef = ArgumentCaptor.forClass(String.class);
        verify(walletClient).debit(eq(PLAYER_ID), eq(BET), debitKey.capture(), debitRef.capture());
        assertEquals("slot-bet-" + roundId, debitKey.getValue());
        assertEquals(roundId, debitRef.getValue());

        ArgumentCaptor<String> creditKey = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> creditRef = ArgumentCaptor.forClass(String.class);
        verify(walletClient).credit(eq(PLAYER_ID), eq(500L), creditKey.capture(), creditRef.capture());
        assertEquals("slot-win-" + roundId, creditKey.getValue());
        assertEquals(roundId, creditRef.getValue());

        // 未提供 clientSeed → 使用伺服器產生值
        assertEquals("gen-client", res.getClientSeed());
    }

    @Test
    @DisplayName("未中：不呼叫 credit，餘額採 debit 後餘額，對局 winAmount 為 0")
    void spin_lose_noCreditPersistsZeroWin() {
        when(slotMachine.spin(any(), eq(BET))).thenReturn(loseOutcome());

        SpinResponse res = service.spin(PLAYER_ID, BET, null);

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
    @DisplayName("餘額不足：debit 拋例外即中止，不執行 RNG / 派彩 / 寫庫")
    void spin_insufficientBalance_abortsEarly() {
        when(walletClient.debit(eq(PLAYER_ID), eq(BET), anyString(), anyString()))
                .thenThrow(new InsufficientBalanceException("星幣餘額不足"));

        assertThrows(InsufficientBalanceException.class, () -> service.spin(PLAYER_ID, BET, null));

        verify(slotMachine, never()).spin(any(), anyLong());
        verify(walletClient, never()).credit(anyLong(), anyLong(), anyString(), anyString());
        verify(roundRepository, never()).save(any());
        verify(publisher, never()).publishSlotResult(any(), any());
    }
}
