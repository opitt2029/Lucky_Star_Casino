package com.luckystar.wallet.controller;

import com.luckystar.wallet.dto.BankruptcyAidResponse;
import com.luckystar.wallet.dto.WalletBalanceResponse;
import com.luckystar.wallet.exception.BankruptcyAidNotEligibleException;
import com.luckystar.wallet.exception.GlobalExceptionHandler;
import com.luckystar.wallet.exception.WalletNotFoundException;
import com.luckystar.wallet.service.BankruptcyAidService;
import com.luckystar.wallet.service.WalletQueryService;
import com.luckystar.wallet.service.WalletService;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class WalletControllerTest {

    @Mock
    WalletService walletService;

    @Mock
    WalletQueryService walletQueryService;

    @Mock
    BankruptcyAidService bankruptcyAidService;

    @InjectMocks
    WalletController walletController;

    MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
                .standaloneSetup(walletController)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void getBalance_validHeader_returns200WithData() throws Exception {
        WalletBalanceResponse resp = new WalletBalanceResponse(1000L, 200L, 800L);
        when(walletService.getBalance(42L)).thenReturn(resp);

        mockMvc.perform(get("/api/v1/wallet/balance")
                        .header("X-User-Id", "42"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.balance").value(1000))
                .andExpect(jsonPath("$.data.frozenAmount").value(200))
                .andExpect(jsonPath("$.data.availableBalance").value(800));
    }

    @Test
    void getBalance_missingHeader_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/wallet/balance"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Missing")));
    }

    @Test
    void getBalance_nonNumericHeader_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/wallet/balance")
                        .header("X-User-Id", "abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Invalid")));
    }

    @Test
    void getBalance_walletNotFound_returns404() throws Exception {
        when(walletService.getBalance(42L))
                .thenThrow(new WalletNotFoundException("Wallet not found for player: 42"));

        mockMvc.perform(get("/api/v1/wallet/balance")
                        .header("X-User-Id", "42"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("not found")));
    }

    @Test
    void bankruptcyAid_eligible_returns200WithData() throws Exception {
        BankruptcyAidResponse resp = BankruptcyAidResponse.builder()
                .playerId(42L).amount(1000L).transactionId(99L)
                .balanceBefore(50L).balanceAfter(1050L).build();
        when(bankruptcyAidService.claim(42L)).thenReturn(resp);

        mockMvc.perform(post("/api/v1/wallet/bankruptcy-aid")
                        .header("X-User-Id", "42"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.amount").value(1000))
                .andExpect(jsonPath("$.data.transactionId").value(99))
                .andExpect(jsonPath("$.data.balanceAfter").value(1050));
    }

    @Test
    void bankruptcyAid_missingHeader_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/wallet/bankruptcy-aid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Missing")));
    }

    @Test
    void bankruptcyAid_notEligible_returns422() throws Exception {
        when(bankruptcyAidService.claim(42L))
                .thenThrow(new BankruptcyAidNotEligibleException("Bankruptcy aid already claimed today"));

        mockMvc.perform(post("/api/v1/wallet/bankruptcy-aid")
                        .header("X-User-Id", "42"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("already claimed")));
    }

    @Test
    void bankruptcyAid_walletNotFound_returns404() throws Exception {
        when(bankruptcyAidService.claim(42L))
                .thenThrow(new WalletNotFoundException("Wallet not found for player: 42"));

        mockMvc.perform(post("/api/v1/wallet/bankruptcy-aid")
                        .header("X-User-Id", "42"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }
}
