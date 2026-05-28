package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.WalletBalanceResponse;
import com.luckystar.wallet.exception.WalletNotFoundException;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WalletServiceTest {

    @Mock
    WalletRepository walletRepository;

    @InjectMocks
    WalletService walletService;

    private Wallet buildWallet(Long playerId, Long balance, Long frozenAmount) {
        try {
            Wallet w = new Wallet();
            setField(w, "playerId", playerId);
            setField(w, "balance", balance);
            setField(w, "frozenAmount", frozenAmount);
            setField(w, "version", 0L);
            return w;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private void setField(Object target, String fieldName, Object value) throws Exception {
        var field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    @Test
    void getBalance_walletExists_returnsCorrectResponse() {
        Wallet wallet = buildWallet(1L, 1000L, 200L);
        when(walletRepository.findById(1L)).thenReturn(Optional.of(wallet));

        WalletBalanceResponse response = walletService.getBalance(1L);

        assertThat(response.getBalance()).isEqualTo(1000L);
        assertThat(response.getFrozenAmount()).isEqualTo(200L);
        assertThat(response.getAvailableBalance()).isEqualTo(800L);
    }

    @Test
    void getBalance_walletNotFound_throwsWalletNotFoundException() {
        long playerId = 99L;
        when(walletRepository.findById(playerId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> walletService.getBalance(playerId))
                .isInstanceOf(WalletNotFoundException.class)
                .hasMessageContaining(String.valueOf(playerId));
    }

    @Test
    void getBalance_freshWallet_availableBalanceIsZero() {
        Wallet wallet = buildWallet(2L, 0L, 0L);
        when(walletRepository.findById(2L)).thenReturn(Optional.of(wallet));

        WalletBalanceResponse response = walletService.getBalance(2L);

        assertThat(response.getBalance()).isEqualTo(0L);
        assertThat(response.getFrozenAmount()).isEqualTo(0L);
        assertThat(response.getAvailableBalance()).isEqualTo(0L);
    }

    @Test
    void getBalance_noFrozenAmount_availableBalanceEqualsBalance() {
        Wallet wallet = buildWallet(3L, 500L, 0L);
        when(walletRepository.findById(3L)).thenReturn(Optional.of(wallet));

        WalletBalanceResponse response = walletService.getBalance(3L);

        assertThat(response.getAvailableBalance()).isEqualTo(response.getBalance());
    }
}
