package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.baccarat.BaccaratGameService;
import com.luckystar.game.baccarat.BaccaratOutcome;
import com.luckystar.game.baccarat.Card;
import com.luckystar.game.dto.VerificationResponse;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.slot.SlotMachine;
import com.luckystar.game.slot.SlotOutcome;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link VerificationService} 單元測試。使用<b>真實</b>確定性引擎（RNG / SlotMachine /
 * BaccaratGameService）產生合法對局，再驗證重算比對；mock 僅用於 repository。
 */
class VerificationServiceTest {

    private static final String SLOT_SEED = "slot-server-seed-001";
    private static final String BAC_SEED = "baccarat-server-seed-001";
    private static final String CLIENT = "client-seed-xyz";
    private static final long NONCE = 0L;
    private static final long BET = 100L;

    private final ProvablyFairRng rng = new ProvablyFairRng();
    private final SlotMachine slotMachine = new SlotMachine();
    private final BaccaratGameService baccaratGame = new BaccaratGameService();
    private final GameRoundRepository roundRepository = org.mockito.Mockito.mock(GameRoundRepository.class);
    private final ObjectMapper objectMapper = new ObjectMapper();

    private VerificationService service;

    @BeforeEach
    void setUp() {
        service = new VerificationService(rng, slotMachine, baccaratGame, roundRepository, objectMapper);
    }

    private GameRound legitSlotRound(String roundId) throws Exception {
        SlotOutcome o = slotMachine.spin(rng.stream(SLOT_SEED, CLIENT, NONCE), BET);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("grid", o.grid());
        result.put("win", o.win());
        result.put("multiplier", o.multiplier());
        result.put("payout", o.payout());
        result.put("winningCells", o.winningCells());

        GameRound r = new GameRound();
        r.setRoundId(roundId);
        r.setPlayerId(1L);
        r.setGameType("SLOT");
        r.setBetAmount(BET);
        r.setWinAmount(o.payout());
        r.setServerSeed(SLOT_SEED);
        r.setServerSeedHash(rng.commit(SLOT_SEED));
        r.setClientSeed(CLIENT);
        r.setNonce(NONCE);
        r.setResultData(objectMapper.writeValueAsString(result));
        r.setStatus("SETTLED");
        return r;
    }

    private GameRound legitBaccaratRound(String roundId) throws Exception {
        BaccaratOutcome o = baccaratGame.deal(rng.stream(BAC_SEED, CLIENT, NONCE));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("result", o.result().name());
        result.put("playerScore", o.playerScore());
        result.put("bankerScore", o.bankerScore());
        result.put("playerCards", display(o.playerCards()));
        result.put("bankerCards", display(o.bankerCards()));

        GameRound r = new GameRound();
        r.setRoundId(roundId);
        r.setPlayerId(1L);
        r.setGameType("BACCARAT");
        r.setBetAmount(BET);
        r.setWinAmount(0L);
        r.setServerSeed(BAC_SEED);
        r.setServerSeedHash(rng.commit(BAC_SEED));
        r.setClientSeed(CLIENT);
        r.setNonce(NONCE);
        r.setResultData(objectMapper.writeValueAsString(result));
        r.setStatus("SETTLED");
        return r;
    }

    private static List<String> display(List<Card> cards) {
        List<String> out = new ArrayList<>();
        cards.forEach(c -> out.add(c.display()));
        return out;
    }

    @Test
    @DisplayName("老虎機：未帶 seed → 用揭露值重算，承諾相符且結果一致 → valid")
    void slot_validWithRevealedSeed() throws Exception {
        when(roundRepository.findByRoundId("s1")).thenReturn(Optional.of(legitSlotRound("s1")));

        VerificationResponse res = service.verify("s1", null);

        assertTrue(res.isCommitmentValid());
        assertTrue(res.isResultMatches());
        assertTrue(res.isValid());
        assertFalse(res.isUsedProvidedSeed());
        assertEquals("SLOT", res.getGameType());
    }

    @Test
    @DisplayName("老虎機：玩家提供正確 seed → valid 且標記 usedProvidedSeed")
    void slot_validWithProvidedSeed() throws Exception {
        when(roundRepository.findByRoundId("s1")).thenReturn(Optional.of(legitSlotRound("s1")));

        VerificationResponse res = service.verify("s1", SLOT_SEED);

        assertTrue(res.isValid());
        assertTrue(res.isUsedProvidedSeed());
    }

    @Test
    @DisplayName("老虎機：提供錯誤 seed → 承諾不符、結果不符 → invalid")
    void slot_wrongSeed_invalid() throws Exception {
        when(roundRepository.findByRoundId("s1")).thenReturn(Optional.of(legitSlotRound("s1")));

        VerificationResponse res = service.verify("s1", "tampered-seed");

        assertFalse(res.isCommitmentValid());
        assertFalse(res.isValid());
    }

    @Test
    @DisplayName("老虎機：result_data 被竄改（winAmount 不符）→ 承諾仍相符但結果不符 → invalid")
    void slot_tamperedResult_invalid() throws Exception {
        GameRound r = legitSlotRound("s1");
        r.setWinAmount(r.getWinAmount() + 9999L); // 竄改派彩
        when(roundRepository.findByRoundId("s1")).thenReturn(Optional.of(r));

        VerificationResponse res = service.verify("s1", null);

        assertTrue(res.isCommitmentValid());
        assertFalse(res.isResultMatches());
        assertFalse(res.isValid());
    }

    @Test
    @DisplayName("百家樂：合法對局重算一致 → valid")
    void baccarat_valid() throws Exception {
        when(roundRepository.findByRoundId("b1")).thenReturn(Optional.of(legitBaccaratRound("b1")));

        VerificationResponse res = service.verify("b1", null);

        assertTrue(res.isCommitmentValid());
        assertTrue(res.isResultMatches());
        assertTrue(res.isValid());
        assertEquals("BACCARAT", res.getGameType());
    }

    @Test
    @DisplayName("對局不存在 → RoundNotFoundException")
    void roundNotFound() {
        when(roundRepository.findByRoundId("nope")).thenReturn(Optional.empty());
        assertThrows(RoundNotFoundException.class, () -> service.verify("nope", null));
    }
}
