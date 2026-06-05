package com.luckystar.wallet.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.dto.DiamondExchangeRequest;
import com.luckystar.wallet.dto.DiamondExchangeResponse;
import com.luckystar.wallet.exception.DiamondWalletNotFoundException;
import com.luckystar.wallet.exception.GlobalExceptionHandler;
import com.luckystar.wallet.exception.InsufficientDiamondException;
import com.luckystar.wallet.service.DiamondExchangeService;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class DiamondControllerExchangeTest {

    @Mock DiamondRedeemService diamondRedeemService;
    @Mock DiamondExchangeService diamondExchangeService;
    @Mock DiamondWalletService diamondWalletService;

    @InjectMocks DiamondController diamondController;

    MockMvc mockMvc;
    final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
                .standaloneSetup(diamondController)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    private String body(long diamondAmount, String key) throws Exception {
        return objectMapper.writeValueAsString(Map.of("diamondAmount", diamondAmount, "idempotencyKey", key));
    }

    @Test
    void exchange_valid_returns200WithStarBalance() throws Exception {
        DiamondExchangeResponse resp = DiamondExchangeResponse.builder()
                .playerId(42L).diamondAmount(10L).starAmount(200L)
                .diamondBalanceAfter(90L).starBalanceAfter(1200L)
                .transactionId(99L).idempotent(false).build();
        when(diamondExchangeService.exchange(eq(42L), any(DiamondExchangeRequest.class))).thenReturn(resp);

        mockMvc.perform(post("/api/v1/wallet/diamond/exchange")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(10L, "key-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.diamondAmount").value(10))
                .andExpect(jsonPath("$.data.starAmount").value(200))
                .andExpect(jsonPath("$.data.diamondBalanceAfter").value(90))
                .andExpect(jsonPath("$.data.starBalanceAfter").value(1200))
                .andExpect(jsonPath("$.data.transactionId").value(99));
    }

    @Test
    void exchange_missingHeader_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/wallet/diamond/exchange")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(10L, "key-1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Missing")));
    }

    @Test
    void exchange_nonNumericHeader_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/wallet/diamond/exchange")
                        .header("X-User-Id", "abc")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(10L, "key-1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Invalid")));
    }

    @Test
    void exchange_zeroDiamondAmount_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/wallet/diamond/exchange")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("diamondAmount", 0, "idempotencyKey", "key-1"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void exchange_blankIdempotencyKey_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/wallet/diamond/exchange")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("diamondAmount", 10, "idempotencyKey", ""))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void exchange_insufficientDiamond_returns422() throws Exception {
        when(diamondExchangeService.exchange(eq(42L), any(DiamondExchangeRequest.class)))
                .thenThrow(new InsufficientDiamondException("Insufficient diamond balance: required=100 available=50"));

        mockMvc.perform(post("/api/v1/wallet/diamond/exchange")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(100L, "key-2")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Insufficient")));
    }

    @Test
    void exchange_diamondWalletNotFound_returns404() throws Exception {
        when(diamondExchangeService.exchange(eq(42L), any(DiamondExchangeRequest.class)))
                .thenThrow(new DiamondWalletNotFoundException("Diamond wallet not found for player: 42"));

        mockMvc.perform(post("/api/v1/wallet/diamond/exchange")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(10L, "key-3")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void exchange_idempotentHit_returns200WithIdempotentTrue() throws Exception {
        DiamondExchangeResponse resp = DiamondExchangeResponse.builder()
                .playerId(42L).diamondAmount(10L).starAmount(200L)
                .diamondBalanceAfter(90L).starBalanceAfter(1200L)
                .transactionId(55L).idempotent(true).build();
        when(diamondExchangeService.exchange(eq(42L), any(DiamondExchangeRequest.class))).thenReturn(resp);

        mockMvc.perform(post("/api/v1/wallet/diamond/exchange")
                        .header("X-User-Id", "42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(10L, "dup-key")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.idempotent").value(true));
    }
}
