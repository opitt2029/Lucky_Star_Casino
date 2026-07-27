package com.luckystar.wallet.service;

import com.luckystar.wallet.postgres.entity.WalletOutbox;
import com.luckystar.wallet.postgres.repository.WalletOutboxRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;

import java.util.List;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link WalletOutboxPoller} 單元測試（藍圖 04 P2）：
 * 成功 → SENT + sentAt；送達失敗 → 保持 PENDING + retry_count+1。
 */
@ExtendWith(MockitoExtension.class)
class WalletOutboxPollerTest {

    @Mock WalletOutboxRepository walletOutboxRepository;
    @Mock KafkaTemplate<String, String> kafkaTemplate;
    @InjectMocks WalletOutboxPoller poller;

    private WalletOutbox pending(Long id) {
        WalletOutbox e = new WalletOutbox();
        e.setId(id);
        e.setTopic("wallet.credit");
        e.setKafkaKey("42");
        e.setPayload("{}");
        e.setStatus(WalletOutbox.STATUS_PENDING);
        return e;
    }

    @Test
    void publishPendingEvents_sendSucceeds_marksSent() {
        WalletOutbox event = pending(1L);
        when(walletOutboxRepository.findByStatusOrderByCreatedAtAsc(
                eq(WalletOutbox.STATUS_PENDING), any(Pageable.class)))
                .thenReturn(List.of(event));
        @SuppressWarnings("unchecked")
        SendResult<String, String> sendResult = mock(SendResult.class);
        when(kafkaTemplate.send(eq("wallet.credit"), eq("42"), eq("{}")))
                .thenReturn(CompletableFuture.completedFuture(sendResult));

        poller.publishPendingEvents();

        // 送達確認後標 SENT + 記錄 sentAt
        assertThat(event.getStatus()).isEqualTo(WalletOutbox.STATUS_SENT);
        assertThat(event.getSentAt()).isNotNull();
        assertThat(event.getRetryCount()).isZero();
    }

    @Test
    void publishPendingEvents_sendFails_keepsPendingAndBumpsRetry() {
        WalletOutbox event = pending(2L);
        when(walletOutboxRepository.findByStatusOrderByCreatedAtAsc(
                eq(WalletOutbox.STATUS_PENDING), any(Pageable.class)))
                .thenReturn(List.of(event));
        // broker 拒收：future 以例外完成 → .get() 拋 ExecutionException
        CompletableFuture<SendResult<String, String>> failed = new CompletableFuture<>();
        failed.completeExceptionally(new RuntimeException("broker down"));
        when(kafkaTemplate.send(anyString(), anyString(), anyString())).thenReturn(failed);

        poller.publishPendingEvents();

        // 保持 PENDING，下一輪再試；retry_count 累加供觀測
        assertThat(event.getStatus()).isEqualTo(WalletOutbox.STATUS_PENDING);
        assertThat(event.getSentAt()).isNull();
        assertThat(event.getRetryCount()).isEqualTo(1);
    }

    @Test
    void publishPendingEvents_wholeBatchSent_marksAllSent() {
        // 重構後為「整批先射出 send()、再統一等 ack」：一批多筆都應標 SENT（守門批次處理）
        WalletOutbox e1 = pending(10L);
        WalletOutbox e2 = pending(11L);
        WalletOutbox e3 = pending(12L);
        when(walletOutboxRepository.findByStatusOrderByCreatedAtAsc(
                eq(WalletOutbox.STATUS_PENDING), any(Pageable.class)))
                .thenReturn(List.of(e1, e2, e3));
        @SuppressWarnings("unchecked")
        SendResult<String, String> sendResult = mock(SendResult.class);
        when(kafkaTemplate.send(anyString(), anyString(), anyString()))
                .thenReturn(CompletableFuture.completedFuture(sendResult));

        poller.publishPendingEvents();

        assertThat(List.of(e1, e2, e3))
                .allSatisfy(e -> assertThat(e.getStatus()).isEqualTo(WalletOutbox.STATUS_SENT));
    }

    @Test
    void publishPendingEvents_noPending_doesNothing() {
        when(walletOutboxRepository.findByStatusOrderByCreatedAtAsc(
                eq(WalletOutbox.STATUS_PENDING), any(Pageable.class)))
                .thenReturn(List.of());

        poller.publishPendingEvents();

        // 空批次直接返回，不碰 Kafka
        org.mockito.Mockito.verifyNoInteractions(kafkaTemplate);
    }
}
