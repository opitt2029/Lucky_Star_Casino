package com.luckystar.wallet.service;

import com.luckystar.wallet.postgres.entity.DiamondWallet;
import com.luckystar.wallet.postgres.repository.DiamondWalletRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
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
}
