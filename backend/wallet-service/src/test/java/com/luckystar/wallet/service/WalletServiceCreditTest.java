package com.luckystar.wallet.service;

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
import org.springframework.orm.ObjectOptimisticLockingFailureException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * T-023 派彩 / 入帳單元測試。與 {@link WalletServiceDebitTest} 對稱，
 * 全程用 Mockito mock 掉 repository 與 outbox 寫入，不需要任何資料庫或 broker。
 * 藍圖 04 P2：事件改寫 wallet_outbox（交易內），故驗證 {@link WalletOutboxService} 而非 Kafka。
 */
@ExtendWith(MockitoExtension.class)
class WalletServiceCreditTest {

    @Mock
    WalletRepository walletRepository;

    @Mock
    WalletTransactionRepository walletTransactionRepository;

    @Mock
    WalletOutboxService walletOutboxService;

    @InjectMocks
    WalletService walletService;

    private Wallet buildWallet(Long playerId, Long balance, Long frozen, Long version) {
        try {
            Wallet w = new Wallet();
            setField(w, "playerId", playerId);
            setField(w, "balance", balance);
            setField(w, "frozenAmount", frozen);
            setField(w, "version", version);
            return w;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
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
    void credit_newIdempotencyKey_addsBalanceSavesTransactionAndWritesOutbox() throws Exception {
        CreditRequest request = buildRequest(1L, 500L, "key-c001");
        Wallet wallet = buildWallet(1L, 1000L, 0L, 0L);
        WalletTransaction savedTx = buildTransaction(1L, 1L, 500L, 1000L, 1500L, "key-c001");

        when(walletTransactionRepository.findByIdempotencyKey("key-c001")).thenReturn(Optional.empty());
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet));
        when(walletRepository.save(any(Wallet.class))).thenReturn(wallet);
        when(walletTransactionRepository.save(any(WalletTransaction.class))).thenReturn(savedTx);

        CreditResponse response = walletService.credit(request);

        verify(walletRepository, times(1)).save(any(Wallet.class));
        verify(walletTransactionRepository, times(1)).save(any(WalletTransaction.class));
        verify(walletOutboxService, times(1)).save(eq("wallet.credit"), eq("1"), any());

        assertThat(response.getTransactionId()).isEqualTo(1L);
        assertThat(response.getBalanceBefore()).isEqualTo(1000L);
        assertThat(response.getBalanceAfter()).isEqualTo(1500L);
        assertThat(response.isIdempotent()).isFalse();

        // 確認真的加錢：存檔的 wallet 餘額為 1000 + 500
        ArgumentCaptor<Wallet> walletCaptor = ArgumentCaptor.forClass(Wallet.class);
        verify(walletRepository).save(walletCaptor.capture());
        assertThat(walletCaptor.getValue().getBalance()).isEqualTo(1500L);
    }

    @Test
    void credit_withUnfreeze_releasesFrozenAmount() throws Exception {
        // 玩家有 300 凍結；派彩入帳 500 並解凍 300
        CreditRequest request = buildRequest(1L, 500L, "key-c-unfreeze");
        request.setUnfreezeAmount(300L);
        Wallet wallet = buildWallet(1L, 1000L, 300L, 0L);
        WalletTransaction savedTx = buildTransaction(2L, 1L, 500L, 1000L, 1500L, "key-c-unfreeze");

        when(walletTransactionRepository.findByIdempotencyKey("key-c-unfreeze")).thenReturn(Optional.empty());
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet));
        when(walletRepository.save(any(Wallet.class))).thenReturn(wallet);
        when(walletTransactionRepository.save(any(WalletTransaction.class))).thenReturn(savedTx);

        CreditResponse response = walletService.credit(request);

        ArgumentCaptor<Wallet> walletCaptor = ArgumentCaptor.forClass(Wallet.class);
        verify(walletRepository).save(walletCaptor.capture());
        assertThat(walletCaptor.getValue().getBalance()).isEqualTo(1500L);
        assertThat(walletCaptor.getValue().getFrozenAmount()).isEqualTo(0L);
        assertThat(response.getFrozenAfter()).isEqualTo(0L);
    }

    @Test
    void credit_unfreezeMoreThanFrozen_clampsToZero() throws Exception {
        // 解凍金額大於現有凍結 → 凍結金額守衛為 0，不變負數
        CreditRequest request = buildRequest(1L, 100L, "key-c-clamp");
        request.setUnfreezeAmount(999L);
        Wallet wallet = buildWallet(1L, 1000L, 200L, 0L);
        WalletTransaction savedTx = buildTransaction(3L, 1L, 100L, 1000L, 1100L, "key-c-clamp");

        when(walletTransactionRepository.findByIdempotencyKey("key-c-clamp")).thenReturn(Optional.empty());
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet));
        when(walletRepository.save(any(Wallet.class))).thenReturn(wallet);
        when(walletTransactionRepository.save(any(WalletTransaction.class))).thenReturn(savedTx);

        walletService.credit(request);

        ArgumentCaptor<Wallet> walletCaptor = ArgumentCaptor.forClass(Wallet.class);
        verify(walletRepository).save(walletCaptor.capture());
        assertThat(walletCaptor.getValue().getFrozenAmount()).isEqualTo(0L);
    }

    @Test
    void credit_duplicateIdempotencyKey_returnsExistingWithoutWrites() {
        CreditRequest request = buildRequest(1L, 500L, "key-cdup");
        WalletTransaction existingTx = buildTransaction(99L, 1L, 500L, 1000L, 1500L, "key-cdup");

        when(walletTransactionRepository.findByIdempotencyKey("key-cdup")).thenReturn(Optional.of(existingTx));

        CreditResponse response = walletService.credit(request);

        verify(walletRepository, never()).findById(any());
        verify(walletRepository, never()).save(any());
        verify(walletTransactionRepository, never()).save(any());
        verify(walletOutboxService, never()).save(anyString(), anyString(), any());

        assertThat(response.getTransactionId()).isEqualTo(99L);
        assertThat(response.getBalanceAfter()).isEqualTo(1500L);
        assertThat(response.isIdempotent()).isTrue();
    }

    @Test
    void credit_walletNotFound_throwsWalletNotFoundException() {
        CreditRequest request = buildRequest(99L, 500L, "key-c003");

        when(walletTransactionRepository.findByIdempotencyKey("key-c003")).thenReturn(Optional.empty());
        when(walletRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> walletService.credit(request))
                .isInstanceOf(WalletNotFoundException.class)
                .hasMessageContaining("99");

        verify(walletTransactionRepository, never()).save(any());
        verify(walletOutboxService, never()).save(anyString(), anyString(), any());
    }

    @Test
    void credit_concurrentSameIdempotencyKey_returnsExistingRecordAsIdempotent() throws Exception {
        CreditRequest request = buildRequest(1L, 500L, "key-crace");
        Wallet wallet = buildWallet(1L, 1000L, 0L, 0L);
        WalletTransaction existingTx = buildTransaction(77L, 1L, 500L, 1000L, 1500L, "key-crace");

        when(walletTransactionRepository.findByIdempotencyKey("key-crace"))
                .thenReturn(Optional.empty())          // Step 1: 兩條執行緒都看到 empty
                .thenReturn(Optional.of(existingTx));   // UNIQUE 衝突後回查
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet));
        when(walletRepository.save(any(Wallet.class))).thenReturn(wallet);
        when(walletTransactionRepository.save(any(WalletTransaction.class)))
                .thenThrow(new DataIntegrityViolationException("duplicate idempotency_key"));

        CreditResponse response = walletService.credit(request);

        assertThat(response.getTransactionId()).isEqualTo(77L);
        assertThat(response.isIdempotent()).isTrue();
        verify(walletOutboxService, never()).save(anyString(), anyString(), any());
    }

    @Test
    void credit_optimisticLockConflict_propagatesException() {
        CreditRequest request = buildRequest(1L, 500L, "key-c004");
        Wallet wallet = buildWallet(1L, 1000L, 0L, 0L);

        when(walletTransactionRepository.findByIdempotencyKey("key-c004")).thenReturn(Optional.empty());
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet));
        when(walletRepository.save(any(Wallet.class)))
                .thenThrow(new ObjectOptimisticLockingFailureException(Wallet.class, 1L));

        assertThatThrownBy(() -> walletService.credit(request))
                .isInstanceOf(ObjectOptimisticLockingFailureException.class);

        verify(walletTransactionRepository, never()).save(any());
        verify(walletOutboxService, never()).save(anyString(), anyString(), any());
    }
}
