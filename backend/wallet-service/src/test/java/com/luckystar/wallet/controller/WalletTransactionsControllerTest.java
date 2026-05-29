package com.luckystar.wallet.controller;

import com.luckystar.wallet.common.PagedResponse;
import com.luckystar.wallet.dto.WalletTransactionResponse;
import com.luckystar.wallet.exception.GlobalExceptionHandler;
import com.luckystar.wallet.service.WalletQueryService;
import com.luckystar.wallet.service.WalletService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class WalletTransactionsControllerTest {

    @Mock
    WalletService walletService;

    @Mock
    WalletQueryService walletQueryService;

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

    private PagedResponse<WalletTransactionResponse> samplePage() {
        WalletTransactionResponse item = new WalletTransactionResponse(
                7L, 42L, "DEBIT", "BET", 100L, 1000L, 900L, "round-7",
                LocalDateTime.of(2026, 5, 1, 10, 0));
        return new PagedResponse<>(List.of(item), 0, 20, 1, 1);
    }

    @Test
    void getTransactions_validRequest_returns200WithPagedData() throws Exception {
        when(walletQueryService.getTransactions(eq(42L), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(samplePage());

        mockMvc.perform(get("/api/v1/wallet/transactions")
                        .header("X-User-Id", "42"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.content[0].id").value(7))
                .andExpect(jsonPath("$.data.content[0].type").value("DEBIT"))
                .andExpect(jsonPath("$.data.totalElements").value(1))
                .andExpect(jsonPath("$.data.page").value(0))
                .andExpect(jsonPath("$.data.size").value(20));
    }

    @Test
    void getTransactions_defaultsPageAndSize() throws Exception {
        when(walletQueryService.getTransactions(eq(42L), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(samplePage());

        mockMvc.perform(get("/api/v1/wallet/transactions")
                        .header("X-User-Id", "42"))
                .andExpect(status().isOk());

        verify(walletQueryService).getTransactions(eq(42L), eq(null), eq(null), eq(null), eq(0), eq(20));
    }

    @Test
    void getTransactions_normalizesTypeToUpperCase() throws Exception {
        when(walletQueryService.getTransactions(eq(42L), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(samplePage());

        mockMvc.perform(get("/api/v1/wallet/transactions")
                        .header("X-User-Id", "42")
                        .param("type", "credit"))
                .andExpect(status().isOk());

        verify(walletQueryService).getTransactions(eq(42L), eq("CREDIT"), any(), any(), anyInt(), anyInt());
    }

    @Test
    void getTransactions_convertsDateRangeToInclusiveDayBounds() throws Exception {
        when(walletQueryService.getTransactions(eq(42L), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(samplePage());

        mockMvc.perform(get("/api/v1/wallet/transactions")
                        .header("X-User-Id", "42")
                        .param("from", "2026-05-01")
                        .param("to", "2026-05-07"))
                .andExpect(status().isOk());

        ArgumentCaptor<LocalDateTime> fromCaptor = ArgumentCaptor.forClass(LocalDateTime.class);
        ArgumentCaptor<LocalDateTime> toCaptor = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(walletQueryService).getTransactions(
                eq(42L), any(), fromCaptor.capture(), toCaptor.capture(), anyInt(), anyInt());

        // from 含當日 00:00；to 推到隔日 00:00（不含上界），確保涵蓋整個 to 當日
        assertThat(fromCaptor.getValue()).isEqualTo(LocalDateTime.of(2026, 5, 1, 0, 0));
        assertThat(toCaptor.getValue()).isEqualTo(LocalDateTime.of(2026, 5, 8, 0, 0));
    }

    @Test
    void getTransactions_missingHeader_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/wallet/transactions"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Missing")));

        verify(walletQueryService, never()).getTransactions(any(), any(), any(), any(), anyInt(), anyInt());
    }

    @Test
    void getTransactions_invalidType_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/wallet/transactions")
                        .header("X-User-Id", "42")
                        .param("type", "WITHDRAW"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("DEBIT")));

        verify(walletQueryService, never()).getTransactions(any(), any(), any(), any(), anyInt(), anyInt());
    }

    @Test
    void getTransactions_negativePage_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/wallet/transactions")
                        .header("X-User-Id", "42")
                        .param("page", "-1"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("page")));
    }

    @Test
    void getTransactions_sizeOverLimit_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/wallet/transactions")
                        .header("X-User-Id", "42")
                        .param("size", "101"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("size")));
    }

    @Test
    void getTransactions_fromAfterTo_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/wallet/transactions")
                        .header("X-User-Id", "42")
                        .param("from", "2026-05-10")
                        .param("to", "2026-05-01"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("from")));

        verify(walletQueryService, never()).getTransactions(any(), any(), any(), any(), anyInt(), anyInt());
    }

    @Test
    void getTransactions_malformedDate_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/wallet/transactions")
                        .header("X-User-Id", "42")
                        .param("from", "not-a-date"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("from")));
    }
}
