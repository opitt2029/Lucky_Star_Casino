package com.luckystar.member.service;

import com.luckystar.member.entity.OutboxEvent;
import com.luckystar.member.repository.OutboxEventRepository;
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
 * {@link OutboxPurgeJob} 單元測試（與 wallet 的 {@code WalletOutboxPurgeJobTest} 同構）：
 * 只刪 SENT、門檻＝now−retentionDays、失敗不拋。
 */
@ExtendWith(MockitoExtension.class)
class OutboxPurgeJobTest {

    @Mock OutboxEventRepository outboxEventRepository;
    @InjectMocks OutboxPurgeJob job;

    @Test
    void purgeSentEvents_deletesOnlySentOlderThanRetention() {
        when(outboxEventRepository.deleteSentBefore(any(), any())).thenReturn(3);
        LocalDateTime beforeCall = LocalDateTime.now();

        job.purgeSentEvents();

        ArgumentCaptor<String> status = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<LocalDateTime> cutoff = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(outboxEventRepository).deleteSentBefore(status.capture(), cutoff.capture());

        // 只刪已投遞的列；PENDING 無論多舊都不可刪（刪掉＝無聲丟失事件）
        assertThat(status.getValue()).isEqualTo(OutboxEvent.STATUS_SENT);
        assertThat(cutoff.getValue())
                .isBetween(beforeCall.minusDays(7).minusMinutes(1), beforeCall.minusDays(7).plusMinutes(1));
    }

    @Test
    void purgeSentEvents_repositoryThrows_doesNotPropagate() {
        when(outboxEventRepository.deleteSentBefore(eq(OutboxEvent.STATUS_SENT), any()))
                .thenThrow(new RuntimeException("db down"));

        assertThatCode(() -> job.purgeSentEvents()).doesNotThrowAnyException();
    }
}
