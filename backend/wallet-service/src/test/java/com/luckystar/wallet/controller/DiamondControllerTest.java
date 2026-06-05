package com.luckystar.wallet.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.dto.DiamondRedeemResponse;
import com.luckystar.wallet.exception.CardAlreadyRedeemedException;
import com.luckystar.wallet.exception.CardNotFoundException;
import com.luckystar.wallet.exception.DiamondWalletNotFoundException;
import com.luckystar.wallet.exception.GlobalExceptionHandler;
import com.luckystar.wallet.service.DiamondRedeemService;
import com.luckystar.wallet.service.DiamondWalletService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Map;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class DiamondControllerTest {

    @Mock DiamondRedeemService diamondRedeemService;
    @Mock DiamondWalletService diamondWalletService;

    @InjectMocks
    DiamondController diamondController;

    MockMvc mockMvc;
    final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
                .standaloneSetup(diamondController)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    private String body(String cardCode) throws Exception {
        return objectMapper.writeValueAsString(Map.of("cardCode", cardCode));
    }

    @Test
    void redeem_valid_returns200WithBalance() throws Exception {
        when(diamondRedeemService.redeem(eq(42L), eq("CODE-1"))).thenReturn(
                DiamondRedeemResponse.builder()
                        .playerId(42L).cardCode("CODE-1").redeemedDiamonds(500L).diamondBalance(1500L).build());

        mockMvc.perform(post("/api/v1/wallet/diamond/redeem")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("CODE-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.redeemedDiamonds").value(500))
                .andExpect(jsonPath("$.data.diamondBalance").value(1500));
    }

    @Test
    void redeem_missingHeader_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/wallet/diamond/redeem")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("CODE-1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Missing")));
    }

    @Test
    void redeem_nonNumericHeader_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/wallet/diamond/redeem")
                        .header("X-User-Id", "abc")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("CODE-1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Invalid")));
    }

    @Test
    void redeem_blankCardCode_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/wallet/diamond/redeem")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void redeem_cardNotFound_returns404() throws Exception {
        when(diamondRedeemService.redeem(eq(42L), eq("NOPE")))
                .thenThrow(new CardNotFoundException("Diamond card not found: NOPE"));

        mockMvc.perform(post("/api/v1/wallet/diamond/redeem")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("NOPE")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void redeem_alreadyRedeemed_returns422() throws Exception {
        when(diamondRedeemService.redeem(eq(42L), eq("USED")))
                .thenThrow(new CardAlreadyRedeemedException("Diamond card already redeemed: USED"));

        mockMvc.perform(post("/api/v1/wallet/diamond/redeem")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("USED")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("already redeemed")));
    }

    @Test
    void redeem_diamondWalletNotFound_returns404() throws Exception {
        when(diamondRedeemService.redeem(eq(42L), eq("CODE-1")))
                .thenThrow(new DiamondWalletNotFoundException("Diamond wallet not found for player: 42"));

        mockMvc.perform(post("/api/v1/wallet/diamond/redeem")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("CODE-1")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }
}
