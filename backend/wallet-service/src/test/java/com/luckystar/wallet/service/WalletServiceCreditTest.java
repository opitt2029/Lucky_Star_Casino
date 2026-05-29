package com.luckystar.wallet.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.dto.CreditResponse;
import com.luckystar.wallet.exception.WalletNotFoundException;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.entity.WalletTransaction;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WalletServiceCreditTest {

    @Mock
    WalletRepository walletRepository;

    @Mock
    WalletTransactionRepository walletTransactionRepository;

    @Mock
    KafkaTemplate<String, String> kafkaTemplate;

    @Mock
    ObjectMapper objectMapper;

    @InjectMocks
    WalletService walletService;

    private Wallet buildWallet(Long playerId, Long balance, Long frozenAmount) {
        Wallet w = new Wallet();
        try {
            setField(w, "playerId", playerId);
            setField(w, "balance", balance);
            setField(w, "frozenAmount", frozenAmount);
            setField(w, "version", 0L);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        return w;
    }

    private WalletTransaction buildTransaction(Long id, Long playerId, Long amount,
                                               Long balanceBefore, Long balanceAfter,
                                               String idempotencyKey) {
        return WalletTransaction.builder()
                .id(id)
                .playerId(playerId)
                .type("CREDIT")
                .subType("WIN")
                .amount(amount)
                .balanceBefore(balanceBefore)
                .balanceAfter(balanceAfter)
                .idempotencyKey(idempotencyKey)
                .build();
    }

    private CreditRequest buildRequest(Long playerId, Long amount, String idempotencyKey) {
        CreditRequest req = new CreditRequest();
        req.setPlayerId(playerId);
        req.setAmount(amount);
        req.setSubType("WIN");
        req.setIdempotencyKey(idempotencyKey);
        return req;
    }

    private void setField(Object target, String fieldName, Object value) throws Exception {
        var field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    @Test
    void credit_newRequest_creditsBalanceAndReleaseFrozenAmount() throws Exception {
        CreditRequest request = buildRequest(1L, 100L, "key1");
        Wallet wallet = buildWallet(1L, 500L, 200L);
        WalletTransaction savedTx = buildTransaction(1L, 1L, 100L, 500L, 600L, "key1");

        when(walletTransactionRepository.findByIdempotencyKey("key1")).thenReturn(Optional.empty());
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet));
        when(walletRepository.save(any(Wallet.class))).thenReturn(wallet);
        when(walletTransactionRepository.save(any(WalletTransaction.class))).thenReturn(savedTx);
        when(objectMapper.writeValueAsString(any())).thenReturn("{}");

        CreditResponse response = walletService.credit(request);

        ArgumentCaptor<Wallet> walletCaptor = ArgumentCaptor.forClass(Wallet.class);
        verify(walletRepository, times(1)).save(walletCaptor.capture());
        assertThat(walletCaptor.getValue().getBalance()).isEqualTo(600L);
        assertThat(walletCaptor.getValue().getFrozenAmount()).isEqualTo(100L);

        ArgumentCaptor<WalletTransaction> txCaptor = ArgumentCaptor.forClass(WalletTransaction.class);
        verify(walletTransactionRepository, times(1)).save(txCaptor.capture());
        assertThat(txCaptor.getValue().getType()).isEqualTo("CREDIT");

        assertThat(response.isIdempotent()).isFalse();
        assertThat(response.getBalanceBefore()).isEqualTo(500L);
        assertThat(response.getBalanceAfter()).isEqualTo(600L);
    }

    @Test
    void credit_newRequest_frozenAmountNeverBelowZero() throws Exception {
        CreditRequest request = buildRequest(1L, 200L, "key2");
        Wallet wallet = buildWallet(1L, 500L, 50L);
        WalletTransaction savedTx = buildTransaction(2L, 1L, 200L, 500L, 700L, "key2");

        when(walletTransactionRepository.findByIdempotencyKey("key2")).thenReturn(Optional.empty());
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet));
        when(walletRepository.save(any(Wallet.class))).thenReturn(wallet);
        when(walletTransactionRepository.save(any(WalletTransaction.class))).thenReturn(savedTx);
        when(objectMapper.writeValueAsString(any())).thenReturn("{}");

        walletService.credit(request);

        ArgumentCaptor<Wallet> walletCaptor = ArgumentCaptor.forClass(Wallet.class);
        verify(walletRepository).save(walletCaptor.capture());
        assertThat(walletCaptor.getValue().getBalance()).isEqualTo(700L);
        assertThat(walletCaptor.getValue().getFrozenAmount()).isEqualTo(0L);
    }

    @Test
    void credit_duplicateRequest_returnsIdempotentResponse() {
        CreditRequest request = buildRequest(1L, 100L, "key-dup");
        WalletTransaction existingTx = buildTransaction(99L, 1L, 100L, 400L, 500L, "key-dup");

        when(walletTransactionRepository.findByIdempotencyKey("key-dup"))
                .thenReturn(Optional.of(existingTx));

        CreditResponse response = walletService.credit(request);

        verify(walletRepository, never()).findById(any());
        verify(walletRepository, never()).save(any());
        verify(walletTransactionRepository, never()).save(any());
        verify(kafkaTemplate, never()).send(anyString(), anyString(), anyString());

        assertThat(response.isIdempotent()).isTrue();
        assertThat(response.getTransactionId()).isEqualTo(99L);
        assertThat(response.getBalanceAfter()).isEqualTo(500L);
    }

    @Test
    void credit_walletNotFound_throwsWalletNotFoundException() {
        CreditRequest request = buildRequest(99L, 100L, "key3");

        when(walletTransactionRepository.findByIdempotencyKey("key3")).thenReturn(Optional.empty());
        when(walletRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> walletService.credit(request))
                .isInstanceOf(WalletNotFoundException.class)
                .hasMessageContaining("99");

        verify(walletTransactionRepository, never()).save(any());
        verify(kafkaTemplate, never()).send(anyString(), anyString(), anyString());
    }

    @Test
    void credit_raceConditionOnIdempotencyKey_returnsWinnerRecord() throws Exception {
        CreditRequest request = buildRequest(1L, 100L, "key-race");
        Wallet wallet = buildWallet(1L, 500L, 100L);
        WalletTransaction winnerTx = buildTransaction(77L, 1L, 100L, 500L, 600L, "key-race");

        when(walletTransactionRepository.findByIdempotencyKey("key-race"))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(winnerTx));
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet));
        when(walletRepository.save(any(Wallet.class))).thenReturn(wallet);
        when(walletTransactionRepository.save(any(WalletTransaction.class)))
                .thenThrow(new DataIntegrityViolationException("duplicate idempotency_key"));

        CreditResponse response = walletService.credit(request);

        assertThat(response.isIdempotent()).isTrue();
        assertThat(response.getTransactionId()).isEqualTo(77L);
        verify(kafkaTemplate, never()).send(anyString(), anyString(), anyString());
    }

    @Test
    void credit_kafkaPublishFails_doesNotThrow() throws Exception {
        CreditRequest request = buildRequest(1L, 100L, "key4");
        Wallet wallet = buildWallet(1L, 500L, 100L);
        WalletTransaction savedTx = buildTransaction(10L, 1L, 100L, 500L, 600L, "key4");

        when(walletTransactionRepository.findByIdempotencyKey("key4")).thenReturn(Optional.empty());
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet));
        when(walletRepository.save(any(Wallet.class))).thenReturn(wallet);
        when(walletTransactionRepository.save(any(WalletTransaction.class))).thenReturn(savedTx);
        when(objectMapper.writeValueAsString(any())).thenReturn("{}");
        doThrow(new RuntimeException("Kafka down"))
                .when(kafkaTemplate).send(eq("wallet.credit"), anyString(), anyString());

        CreditResponse response = walletService.credit(request);

        assertThat(response).isNotNull();
        assertThat(response.getTransactionId()).isEqualTo(10L);
    }
}
