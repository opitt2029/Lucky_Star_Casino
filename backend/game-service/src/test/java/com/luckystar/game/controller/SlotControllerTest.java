package com.luckystar.game.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.luckystar.game.dto.PrepareRoundResponse;
import com.luckystar.game.dto.SpinResponse;
import com.luckystar.game.dto.WalletView;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.service.SlotService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** {@link SlotController} 的 web 層測試（@WebMvcTest，mock 掉 service，不載入 DB/Kafka/Redis）。 */
@WebMvcTest(SlotController.class)
class SlotControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private SlotService slotService;

    private static SpinResponse sampleResponse() {
        return SpinResponse.builder()
                .roundId("round-1")
                .game("slot")
                .grid(new String[][] {{"a", "b", "c"}, {"x", "x", "x"}, {"d", "e", "f"}})
                .bet(100)
                .multiplier(5)
                .payout(500)
                .winningCells(new int[][] {{1, 0}, {1, 1}, {1, 2}})
                .wallet(WalletView.builder().balance(10400).frozenAmount(0).build())
                .serverSeed("srv")
                .serverSeedHash("hash")
                .clientSeed("cli")
                .nonce(0)
                .build();
    }

    @Test
    @DisplayName("正常下注：200，回傳 ApiResponse 包住結果")
    void spin_happyPath() throws Exception {
        when(slotService.spin(eq(123L), eq(100L), any(), org.mockito.ArgumentMatchers.anyBoolean())).thenReturn(sampleResponse());

        mockMvc.perform(post("/api/v1/game/slot/spin")
                        .header("X-User-Id", "123")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bet\":100}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.game").value("slot"))
                .andExpect(jsonPath("$.data.payout").value(500))
                .andExpect(jsonPath("$.data.multiplier").value(5))
                .andExpect(jsonPath("$.data.wallet.balance").value(10400));

        verify(slotService).spin(eq(123L), eq(100L), any(), org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    @DisplayName("缺少 X-User-Id：400")
    void spin_missingHeader() throws Exception {
        mockMvc.perform(post("/api/v1/game/slot/spin")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bet\":100}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Missing X-User-Id header"));

        verify(slotService, never()).spin(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong(), any(), org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    @DisplayName("X-User-Id 非數字：400")
    void spin_invalidHeader() throws Exception {
        mockMvc.perform(post("/api/v1/game/slot/spin")
                        .header("X-User-Id", "not-a-number")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bet\":100}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Invalid X-User-Id header"));
    }

    @Test
    @DisplayName("下注低於下限：400（Bean Validation）")
    void spin_betTooLow() throws Exception {
        mockMvc.perform(post("/api/v1/game/slot/spin")
                        .header("X-User-Id", "123")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bet\":50}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    @DisplayName("下注超過上限：400（Bean Validation）")
    void spin_betTooHigh() throws Exception {
        mockMvc.perform(post("/api/v1/game/slot/spin")
                        .header("X-User-Id", "123")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bet\":6000}"))
                .andExpect(status().isBadRequest());
    }

    // ------------------------------------------------------------------
    // 兩階段 commit-ahead 端點（T-033）
    // ------------------------------------------------------------------

    @Test
    @DisplayName("開局 /round：200，回傳 serverSeedHash，不含 serverSeed")
    void prepareRound_happyPath() throws Exception {
        PrepareRoundResponse prepared = PrepareRoundResponse.builder()
                .roundId("round-1").game("slot").bet(100).serverSeedHash("hash").clientSeed("cli").build();
        when(slotService.prepareRound(eq(123L), eq(100L), any())).thenReturn(prepared);

        mockMvc.perform(post("/api/v1/game/slot/round")
                        .header("X-User-Id", "123")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bet\":100}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.roundId").value("round-1"))
                .andExpect(jsonPath("$.data.serverSeedHash").value("hash"))
                .andExpect(jsonPath("$.data.serverSeed").doesNotExist());

        verify(slotService).prepareRound(eq(123L), eq(100L), any());
    }

    @Test
    @DisplayName("開局 /round：缺 X-User-Id → 400，不呼叫 service")
    void prepareRound_missingHeader() throws Exception {
        mockMvc.perform(post("/api/v1/game/slot/round")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"bet\":100}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Missing X-User-Id header"));

        verify(slotService, never()).prepareRound(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong(), any());
    }

    @Test
    @DisplayName("結算 /round/{id}/settle：200，揭露 serverSeed")
    void settle_happyPath() throws Exception {
        when(slotService.settle(eq(123L), eq("round-1"))).thenReturn(sampleResponse());

        mockMvc.perform(post("/api/v1/game/slot/round/round-1/settle")
                        .header("X-User-Id", "123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.payout").value(500))
                .andExpect(jsonPath("$.data.serverSeed").value("srv"));

        verify(slotService).settle(eq(123L), eq("round-1"));
    }

    @Test
    @DisplayName("結算 /round/{id}/settle：Session 不存在 → 404")
    void settle_roundNotFound() throws Exception {
        when(slotService.settle(eq(123L), eq("missing")))
                .thenThrow(new RoundNotFoundException("對局不存在或已逾時"));

        mockMvc.perform(post("/api/v1/game/slot/round/missing/settle")
                        .header("X-User-Id", "123"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }
}
