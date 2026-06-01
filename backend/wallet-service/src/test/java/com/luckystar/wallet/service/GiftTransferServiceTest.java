package com.luckystar.wallet.service;

import com.luckystar.wallet.exception.InsufficientBalanceException;
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

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link GiftTransferService} 單元測試（T-026）：驗證 PostgreSQL 一筆交易內的雙向分錄。
 */
@ExtendWith(MockitoExtension.class)
class GiftTransferServiceTest {

    @Mock WalletRepository walletRepository;
    @Mock WalletTransactionRepository walletTransactionRepository;
    @InjectMocks GiftTransferService giftTransferService;

    private Wallet wallet(Long id, long balance) {
        return Wallet.builder().playerId(id).balance(balance).frozenAmount(0L).version(0L).build();
    }

    @Test
    void transfer_movesBalancesAndWritesTwoEntries() {
        Wallet sender = wallet(1L, 1000L);
        Wallet receiver = wallet(2L, 200L);
        when(walletRepository.findById(1L)).thenReturn(Optional.of(sender));
        when(walletRepository.findById(2L)).thenReturn(Optional.of(receiver));
        when(walletTransactionRepository.save(any(WalletTransaction.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        GiftTransferService.Result result =
                giftTransferService.transfer(1L, 2L, 300L, "g:gift:debit", "g:gift:credit");

        // 餘額異動
        assertThat(sender.getBalance()).isEqualTo(700L);
        assertThat(receiver.getBalance()).isEqualTo(500L);
        verify(walletRepository).save(sender);
        verify(walletRepository).save(receiver);

        // 兩筆分錄
        ArgumentCaptor<WalletTransaction> captor = ArgumentCaptor.forClass(WalletTransaction.class);
        verify(walletTransactionRepository, times(2)).save(captor.capture());
        List<WalletTransaction> saved = captor.getAllValues();

        WalletTransaction debit = saved.get(0);
        assertThat(debit.getType()).isEqualTo("DEBIT");
        assertThat(debit.getSubType()).isEqualTo("GIFT");
        assertThat(debit.getPlayerId()).isEqualTo(1L);
        assertThat(debit.getBalanceBefore()).isEqualTo(1000L);
        assertThat(debit.getBalanceAfter()).isEqualTo(700L);
        assertThat(debit.getIdempotencyKey()).isEqualTo("g:gift:debit");
        assertThat(debit.getReferenceId()).isEqualTo("gift-to:2");

        WalletTransaction credit = saved.get(1);
        assertThat(credit.getType()).isEqualTo("CREDIT");
        assertThat(credit.getSubType()).isEqualTo("GIFT");
        assertThat(credit.getPlayerId()).isEqualTo(2L);
        assertThat(credit.getBalanceBefore()).isEqualTo(200L);
        assertThat(credit.getBalanceAfter()).isEqualTo(500L);
        assertThat(credit.getIdempotencyKey()).isEqualTo("g:gift:credit");
        assertThat(credit.getReferenceId()).isEqualTo("gift-from:1");

        assertThat(result.debit()).isSameAs(debit);
        assertThat(result.credit()).isSameAs(credit);
    }

    @Test
    void transfer_insufficientBalance_throwsAndWritesNothing() {
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet(1L, 100L)));

        assertThatThrownBy(() -> giftTransferService.transfer(1L, 2L, 300L, "d", "c"))
                .isInstanceOf(InsufficientBalanceException.class);

        verify(walletRepository, never()).save(any());
        verify(walletTransactionRepository, never()).save(any());
    }

    @Test
    void transfer_senderNotFound_throws() {
        when(walletRepository.findById(1L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> giftTransferService.transfer(1L, 2L, 300L, "d", "c"))
                .isInstanceOf(WalletNotFoundException.class)
                .hasMessageContaining("sender");
    }

    @Test
    void transfer_receiverNotFound_throws() {
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet(1L, 1000L)));
        when(walletRepository.findById(2L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> giftTransferService.transfer(1L, 2L, 300L, "d", "c"))
                .isInstanceOf(WalletNotFoundException.class)
                .hasMessageContaining("receiver");

        verify(walletRepository, never()).save(any());
        verify(walletTransactionRepository, never()).save(any());
    }
}
