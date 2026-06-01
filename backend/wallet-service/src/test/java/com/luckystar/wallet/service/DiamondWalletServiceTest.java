package com.luckystar.wallet.service;

import com.luckystar.wallet.exception.DiamondWalletNotFoundException;
import com.luckystar.wallet.exception.InsufficientDiamondException;
import com.luckystar.wallet.postgres.entity.DiamondWallet;
import com.luckystar.wallet.postgres.repository.DiamondWalletRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DiamondWalletServiceTest {

    @Mock
    DiamondWalletRepository diamondWalletRepository;

    @InjectMocks
    DiamondWalletService diamondWalletService;

    @Test
    void createDiamondWallet_newPlayer_savesWalletWithZeroBalanceAndVersion() {
        when(diamondWalletRepository.existsById(1L)).thenReturn(false);

        diamondWalletService.createDiamondWallet(1L);

        ArgumentCaptor<DiamondWallet> captor = ArgumentCaptor.forClass(DiamondWallet.class);
        verify(diamondWalletRepository, times(1)).saveAndFlush(captor.capture());
        assertThat(captor.getValue().getPlayerId()).isEqualTo(1L);
        assertThat(captor.getValue().getBalance()).isEqualTo(0L);
        assertThat(captor.getValue().getVersion()).isEqualTo(0L);
    }

    @Test
    void createDiamondWallet_existingPlayer_skipsAndDoesNotSave() {
        when(diamondWalletRepository.existsById(2L)).thenReturn(true);

        diamondWalletService.createDiamondWallet(2L);

        verify(diamondWalletRepository, never()).saveAndFlush(any());
    }

    @Test
    void createDiamondWallet_concurrentRace_dataIntegrityViolationHandledSilently() {
        // 兩個 consumer 同時通過 existsById 預檢，第二筆 insert 撞主鍵唯一約束
        when(diamondWalletRepository.existsById(3L)).thenReturn(false);
        when(diamondWalletRepository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("duplicate key"));

        // 例外被吞掉、不外拋 —— 對「同一 playerId 不重複建立」是安全的 no-op
        assertThatCode(() -> diamondWalletService.createDiamondWallet(3L)).doesNotThrowAnyException();

        verify(diamondWalletRepository, times(1)).saveAndFlush(any());
    }

    @Test
    void creditDiamond_existingWallet_addsAmountAndReturnsNewBalance() {
        DiamondWallet wallet = DiamondWallet.builder().playerId(42L).balance(100L).version(0L).build();
        when(diamondWalletRepository.findById(42L)).thenReturn(Optional.of(wallet));

        long newBalance = diamondWalletService.creditDiamond(42L, 500L);

        assertThat(newBalance).isEqualTo(600L);
        ArgumentCaptor<DiamondWallet> captor = ArgumentCaptor.forClass(DiamondWallet.class);
        verify(diamondWalletRepository).save(captor.capture());
        assertThat(captor.getValue().getBalance()).isEqualTo(600L);
    }

    @Test
    void creditDiamond_walletNotFound_throwsAndDoesNotSave() {
        when(diamondWalletRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> diamondWalletService.creditDiamond(99L, 500L))
                .isInstanceOf(DiamondWalletNotFoundException.class);

        verify(diamondWalletRepository, never()).save(any());
    }

    // ── getBalance（T-104）──────────────────────────────────────────────────

    @Test
    void getBalance_existingWallet_returnsBalance() {
        DiamondWallet wallet = DiamondWallet.builder().playerId(42L).balance(750L).version(0L).build();
        when(diamondWalletRepository.findById(42L)).thenReturn(Optional.of(wallet));

        long balance = diamondWalletService.getBalance(42L);

        assertThat(balance).isEqualTo(750L);
    }

    @Test
    void getBalance_walletNotFound_throwsDiamondWalletNotFoundException() {
        when(diamondWalletRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> diamondWalletService.getBalance(99L))
                .isInstanceOf(DiamondWalletNotFoundException.class);
    }

    // ── debitDiamond（T-103）────────────────────────────────────────────────

    @Test
    void debitDiamond_sufficientBalance_deductsAndReturnsNewBalance() {
        DiamondWallet wallet = DiamondWallet.builder().playerId(42L).balance(200L).version(0L).build();
        when(diamondWalletRepository.findById(42L)).thenReturn(Optional.of(wallet));

        long newBalance = diamondWalletService.debitDiamond(42L, 50L);

        assertThat(newBalance).isEqualTo(150L);
        ArgumentCaptor<DiamondWallet> captor = ArgumentCaptor.forClass(DiamondWallet.class);
        verify(diamondWalletRepository).save(captor.capture());
        assertThat(captor.getValue().getBalance()).isEqualTo(150L);
    }

    @Test
    void debitDiamond_exactBalance_deductsToZero() {
        DiamondWallet wallet = DiamondWallet.builder().playerId(42L).balance(100L).version(0L).build();
        when(diamondWalletRepository.findById(42L)).thenReturn(Optional.of(wallet));

        long newBalance = diamondWalletService.debitDiamond(42L, 100L);

        assertThat(newBalance).isEqualTo(0L);
    }

    @Test
    void debitDiamond_insufficientBalance_throwsInsufficientDiamondAndDoesNotSave() {
        DiamondWallet wallet = DiamondWallet.builder().playerId(42L).balance(30L).version(0L).build();
        when(diamondWalletRepository.findById(42L)).thenReturn(Optional.of(wallet));

        assertThatThrownBy(() -> diamondWalletService.debitDiamond(42L, 100L))
                .isInstanceOf(InsufficientDiamondException.class)
                .hasMessageContaining("required=100")
                .hasMessageContaining("available=30");

        verify(diamondWalletRepository, never()).save(any());
    }

    @Test
    void debitDiamond_walletNotFound_throwsDiamondWalletNotFoundException() {
        when(diamondWalletRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> diamondWalletService.debitDiamond(99L, 10L))
                .isInstanceOf(DiamondWalletNotFoundException.class);

        verify(diamondWalletRepository, never()).save(any());
    }
}
