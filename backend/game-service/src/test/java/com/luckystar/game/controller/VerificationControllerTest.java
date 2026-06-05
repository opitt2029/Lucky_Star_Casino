package com.luckystar.game.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.luckystar.game.dto.VerificationResponse;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.service.VerificationService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

/** {@link VerificationController} web 層測試（@WebMvcTest）。 */
@WebMvcTest(VerificationController.class)
class VerificationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private VerificationService verificationService;

    @Test
    @DisplayName("GET /verify/{id}：200，回傳驗證結果")
    void verify_happyPath() throws Exception {
        VerificationResponse resp = VerificationResponse.builder()
                .roundId("r1").gameType("SLOT")
                .serverSeed("srv").serverSeedHash("hash").clientSeed("cli").nonce(0L)
                .commitmentValid(true).resultMatches(true).valid(true)
                .message("驗證通過").build();
        when(verificationService.verify(eq("r1"), isNull())).thenReturn(resp);

        mockMvc.perform(get("/api/v1/game/verify/r1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.valid").value(true))
                .andExpect(jsonPath("$.data.commitmentValid").value(true));
    }

    @Test
    @DisplayName("GET /verify/{id}?serverSeed=：帶 seed 轉發 service")
    void verify_withSeed() throws Exception {
        VerificationResponse resp = VerificationResponse.builder()
                .roundId("r1").gameType("SLOT").valid(false).commitmentValid(false)
                .resultMatches(false).message("承諾雜湊不符").build();
        when(verificationService.verify(eq("r1"), eq("myseed"))).thenReturn(resp);

        mockMvc.perform(get("/api/v1/game/verify/r1").param("serverSeed", "myseed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.valid").value(false));
    }

    @Test
    @DisplayName("GET /verify/{id}：對局不存在 → 404")
    void verify_notFound() throws Exception {
        when(verificationService.verify(eq("nope"), isNull()))
                .thenThrow(new RoundNotFoundException("對局不存在"));

        mockMvc.perform(get("/api/v1/game/verify/nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }
}
