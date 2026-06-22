package com.luckystar.game.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.luckystar.game.dto.BaccaratBetResponse;
import com.luckystar.game.dto.BaccaratResultResponse;
import com.luckystar.game.dto.WalletView;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.service.BaccaratService;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** {@link BaccaratController} web 層測試（@WebMvcTest，mock service）。 */
@WebMvcTest(BaccaratController.class)
class BaccaratControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private BaccaratService baccaratService;

    @Test
    @DisplayName("下注 /bet：200，回 serverSeedHash，不含 serverSeed")
    void bet_happyPath() throws Exception {
        BaccaratBetResponse resp = BaccaratBetResponse.builder()
                .roundId("r1").game("baccarat")
                .bets(Map.of("player", 100L, "banker", 0L, "tie", 0L))
                .totalBet(100).serverSeedHash("hash").clientSeed("cli").build();
        when(baccaratService.placeBet(eq(7L), eq(100L), any(), any(), any(), org.mockito.ArgumentMatchers.anyBoolean())).thenReturn(resp);

        mockMvc.perform(post("/api/v1/game/baccarat/bet")
                        .header("X-User-Id", "7")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"player\":100}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.roundId").value("r1"))
                .andExpect(jsonPath("$.data.serverSeedHash").value("hash"))
                .andExpect(jsonPath("$.data.serverSeed").doesNotExist());
    }

    @Test
    @DisplayName("下注 /bet：缺 X-User-Id → 400，不呼叫 service")
    void bet_missingHeader() throws Exception {
        mockMvc.perform(post("/api/v1/game/baccarat/bet")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"player\":100}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Missing X-User-Id header"));

        verify(baccaratService, never()).placeBet(anyLong(), any(), any(), any(), any(), org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    @DisplayName("下注 /bet：金額為負 → 400（Bean Validation）")
    void bet_negativeAmount() throws Exception {
        mockMvc.perform(post("/api/v1/game/baccarat/bet")
                        .header("X-User-Id", "7")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"player\":-100}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    @DisplayName("結算 /{id}/result：200，揭露 serverSeed 與派彩")
    void result_happyPath() throws Exception {
        BaccaratResultResponse resp = BaccaratResultResponse.builder()
                .roundId("r1").game("baccarat")
                .playerCards(java.util.List.of("A♠", "5♠"))
                .bankerCards(java.util.List.of("8♠", "10♠"))
                .playerScore(6).bankerScore(8).result("BANKER")
                .bets(Map.of("player", 0L, "banker", 100L, "tie", 0L))
                .payouts(Map.of("player", 0L, "banker", 195L, "tie", 0L))
                .totalBet(100).totalPayout(195)
                .wallet(WalletView.builder().balance(9895).frozenAmount(0).build())
                .serverSeed("srv").serverSeedHash("hash").clientSeed("cli").nonce(0)
                .build();
        when(baccaratService.settle(eq(7L), eq("r1"))).thenReturn(resp);

        mockMvc.perform(post("/api/v1/game/baccarat/r1/result")
                        .header("X-User-Id", "7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.result").value("BANKER"))
                .andExpect(jsonPath("$.data.totalPayout").value(195))
                .andExpect(jsonPath("$.data.serverSeed").value("srv"));
    }

    @Test
    @DisplayName("結算 /{id}/result：Session 不存在 → 404")
    void result_roundNotFound() throws Exception {
        when(baccaratService.settle(eq(7L), eq("missing")))
                .thenThrow(new RoundNotFoundException("對局不存在或已逾時"));

        mockMvc.perform(post("/api/v1/game/baccarat/missing/result")
                        .header("X-User-Id", "7"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }
}
