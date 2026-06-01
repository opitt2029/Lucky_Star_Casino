package com.luckystar.wallet.controller;

import com.luckystar.wallet.exception.DiamondWalletNotFoundException;
import com.luckystar.wallet.exception.GlobalExceptionHandler;
import com.luckystar.wallet.service.DiamondExchangeService;
import com.luckystar.wallet.service.DiamondRedeemService;
import com.luckystar.wallet.service.DiamondWalletService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class DiamondControllerBalanceTest {

    @Mock DiamondRedeemService diamondRedeemService;
    @Mock DiamondExchangeService diamondExchangeService;
    @Mock DiamondWalletService diamondWalletService;

    @InjectMocks DiamondController diamondController;

    MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
                .standaloneSetup(diamondController)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void balance_valid_returns200WithBalanceAndExchangeRate() throws Exception {
        when(diamondWalletService.getBalance(42L)).thenReturn(1500L);

        mockMvc.perform(get("/api/v1/wallet/diamond/balance")
                        .header("X-User-Id", "42"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.balance").value(1500))
                .andExpect(jsonPath("$.data.exchangeRate").value(20));
    }

    @Test
    void balance_zeroBalance_returns200() throws Exception {
        when(diamondWalletService.getBalance(7L)).thenReturn(0L);

        mockMvc.perform(get("/api/v1/wallet/diamond/balance")
                        .header("X-User-Id", "7"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.balance").value(0))
                .andExpect(jsonPath("$.data.exchangeRate").value(20));
    }

    @Test
    void balance_missingHeader_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/wallet/diamond/balance"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Missing")));
    }

    @Test
    void balance_nonNumericHeader_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/wallet/diamond/balance")
                        .header("X-User-Id", "abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Invalid")));
    }

    @Test
    void balance_walletNotFound_returns404() throws Exception {
        when(diamondWalletService.getBalance(99L))
                .thenThrow(new DiamondWalletNotFoundException("Diamond wallet not found for player: 99"));

        mockMvc.perform(get("/api/v1/wallet/diamond/balance")
                        .header("X-User-Id", "99"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }
}
