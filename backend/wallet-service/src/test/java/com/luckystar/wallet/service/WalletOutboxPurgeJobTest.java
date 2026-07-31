package com.luckystar.wallet.service;

import com.luckystar.wallet.postgres.entity.WalletOutbox;
import com.luckystar.wallet.postgres.repository.WalletOutboxRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link WalletOutboxPurgeJob} 單元測試：只刪 SENT、門檻＝now−retentionDays、失敗不拋。
 *
 * <p>「只刪 SENT」是本排程最重要的不變量——誤刪 PENDING 等於無聲丟失事件，
 * 正是 Outbox 要防的事，故以 status 引數斷言鎖住。
 */
@ExtendWith(MockitoExtension.class)
class WalletOutboxPurgeJobTest {

    @Mock WalletOutboxRepository walletOutboxRepository;
    @InjectMocks WalletOutboxPurgeJob job;

    @Test
    void purgeSentEvents_deletesOnlySentOlderThanRetention() {
        when(walletOutboxRepository.deleteSentBefore(any(), any())).thenReturn(12);
        LocalDateTime beforeCall = LocalDateTime.now();

        job.purgeSentEvents();

        ArgumentCaptor<String> status = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<LocalDateTime> cutoff = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(walletOutboxRepository).deleteSentBefore(status.capture(), cutoff.capture());

        // 只刪已投遞的列；PENDING 無論多舊都不可刪
        assertThat(status.getValue()).isEqualTo(WalletOutbox.STATUS_SENT);
        // 門檻應落在「呼叫時刻 − 預設保留 7 天」附近（給 1 分鐘容差吸收執行耗時）
        assertThat(cutoff.getValue())
                .isBetween(beforeCall.minusDays(7).minusMinutes(1), beforeCall.minusDays(7).plusMinutes(1));
    }

    @Test
    void purgeSentEvents_repositoryThrows_doesNotPropagate() {
        when(walletOutboxRepository.deleteSentBefore(eq(WalletOutbox.STATUS_SENT), any()))
                .thenThrow(new RuntimeException("db down"));

        // 清理是純維運工作：延一天無害，不可讓例外污染 scheduler 執行緒
        assertThatCode(() -> job.purgeSentEvents()).doesNotThrowAnyException();
    }
}
