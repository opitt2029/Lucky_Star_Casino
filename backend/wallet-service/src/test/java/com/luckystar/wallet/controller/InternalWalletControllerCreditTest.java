package com.luckystar.wallet.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.dto.CreditResponse;
import com.luckystar.wallet.exception.GlobalExceptionHandler;
import com.luckystar.wallet.service.WalletService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class InternalWalletControllerCreditTest {

    @Mock
    WalletService walletService;

    @InjectMocks
    InternalWalletController internalWalletController;

    MockMvc mockMvc;
    ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        mockMvc = MockMvcBuilders
                .standaloneSetup(internalWalletController)
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    private String validRequestJson(String subType) throws Exception {
        CreditRequest req = new CreditRequest();
        req.setPlayerId(1L);
        req.setAmount(100L);
        req.setSubType(subType);
        req.setIdempotencyKey("idem-001");
        return objectMapper.writeValueAsString(req);
    }

    @Test
    void credit_validRequest_returns200WithSuccessTrue() throws Exception {
        CreditResponse resp = CreditResponse.builder()
                .transactionId(1L)
                .playerId(1L)
                .amount(100L)
                .balanceBefore(500L)
                .balanceAfter(600L)
                .idempotent(false)
                .build();

        when(walletService.credit(any(CreditRequest.class))).thenReturn(resp);

        mockMvc.perform(post("/internal/wallet/credit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validRequestJson("WIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.idempotent").value(false));
    }

    @Test
    void credit_missingAmount_returns400() throws Exception {
        String body = """
                {"playerId":1,"subType":"WIN","idempotencyKey":"idem-002"}
                """;

        mockMvc.perform(post("/internal/wallet/credit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void credit_invalidSubType_returns400() throws Exception {
        String body = """
                {"playerId":1,"amount":100,"subType":"INVALID","idempotencyKey":"idem-003"}
                """;

        mockMvc.perform(post("/internal/wallet/credit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void credit_duplicateRequest_returns200WithIdempotentTrue() throws Exception {
        CreditResponse resp = CreditResponse.builder()
                .transactionId(99L)
                .playerId(1L)
                .amount(100L)
                .balanceBefore(400L)
                .balanceAfter(500L)
                .idempotent(true)
                .build();

        when(walletService.credit(any(CreditRequest.class))).thenReturn(resp);

        mockMvc.perform(post("/internal/wallet/credit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validRequestJson("WIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.idempotent").value(true));
    }
}
