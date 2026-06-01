package com.luckystar.wallet.service;

import com.luckystar.wallet.common.PagedResponse;
import com.luckystar.wallet.dto.DeadLetterMessageResponse;
import com.luckystar.wallet.dto.DeadLetterRetryResponse;
import com.luckystar.wallet.exception.DeadLetterNotFoundException;
import com.luckystar.wallet.exception.IllegalDltStateException;
import com.luckystar.wallet.postgres.entity.DeadLetterMessage;
import com.luckystar.wallet.postgres.repository.DeadLetterMessageRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link DeadLetterService} 單元測試（T-028）。
 *
 * <p>覆蓋：record 落庫與堆疊截斷與吞例外、query 各過濾分支、retry 成功與兩種錯誤。
 */
@ExtendWith(MockitoExtension.class)
class DeadLetterServiceTest {

    @Mock
    private DeadLetterMessageRepository repository;

    @Mock
    private KafkaTemplate<String, String> kafkaTemplate;

    @InjectMocks
    private DeadLetterService service;

    private final Pageable pageable = PageRequest.of(0, 20);

    @Test
    void record_validMetadata_savesWithFailedStatus() {
        service.record("wallet.credit.DLT", "wallet.credit", "7",
                "{\"x\":1}", "java.lang.RuntimeException", "boom", "trace");

        ArgumentCaptor<DeadLetterMessage> captor = ArgumentCaptor.forClass(DeadLetterMessage.class);
        verify(repository).save(captor.capture());
        DeadLetterMessage saved = captor.getValue();
        assertThat(saved.getDltTopic()).isEqualTo("wallet.credit.DLT");
        assertThat(saved.getOriginalTopic()).isEqualTo("wallet.credit");
        assertThat(saved.getMessageKey()).isEqualTo("7");
        assertThat(saved.getPayload()).isEqualTo("{\"x\":1}");
        assertThat(saved.getExceptionClass()).isEqualTo("java.lang.RuntimeException");
        assertThat(saved.getFailureReason()).isEqualTo("boom");
        assertThat(saved.getStatus()).isEqualTo("FAILED");
        assertThat(saved.getRetryCount()).isZero();
    }

    @Test
    void record_longStackTrace_isTruncatedTo4000() {
        String longTrace = "x".repeat(5000);

        service.record("wallet.debit.DLT", "wallet.debit", null,
                "{}", "E", "msg", longTrace);

        ArgumentCaptor<DeadLetterMessage> captor = ArgumentCaptor.forClass(DeadLetterMessage.class);
        verify(repository).save(captor.capture());
        assertThat(captor.getValue().getStackTrace()).hasSize(DeadLetterService.STACK_TRACE_MAX_LEN);
    }

    @Test
    void record_repositoryThrows_swallowsException() {
        when(repository.save(any())).thenThrow(new RuntimeException("db down"));

        // 不應往外拋，否則 DLT 訊息會再次失敗。
        service.record("wallet.credit.DLT", "wallet.credit", "7", "{}", "E", "msg", null);

        verify(repository).save(any());
    }

    @Test
    void query_noFilters_callsFindAll() {
        Page<DeadLetterMessage> page = new PageImpl<>(List.of(sample(1L, "FAILED")));
        when(repository.findAll(pageable)).thenReturn(page);

        PagedResponse<DeadLetterMessageResponse> result = service.query(null, null, pageable);

        assertThat(result.content()).hasSize(1);
        assertThat(result.content().get(0).id()).isEqualTo(1L);
        verify(repository).findAll(pageable);
    }

    @Test
    void query_statusOnly_callsFindByStatus() {
        when(repository.findByStatus(eq("FAILED"), eq(pageable)))
                .thenReturn(new PageImpl<>(List.of(sample(2L, "FAILED"))));

        PagedResponse<DeadLetterMessageResponse> result = service.query("FAILED", null, pageable);

        assertThat(result.content()).hasSize(1);
        verify(repository).findByStatus("FAILED", pageable);
        verify(repository, never()).findAll(any(Pageable.class));
    }

    @Test
    void query_statusAndTopic_callsFindByStatusAndDltTopic() {
        when(repository.findByStatusAndDltTopic(eq("FAILED"), eq("wallet.credit.DLT"), eq(pageable)))
                .thenReturn(new PageImpl<>(List.of(sample(3L, "FAILED"))));

        PagedResponse<DeadLetterMessageResponse> result =
                service.query("FAILED", "wallet.credit.DLT", pageable);

        assertThat(result.content()).hasSize(1);
        verify(repository).findByStatusAndDltTopic("FAILED", "wallet.credit.DLT", pageable);
    }

    @Test
    void retry_existingFailed_republishesAndMarksRetried() {
        DeadLetterMessage message = sample(5L, "FAILED");
        message.setOriginalTopic("wallet.credit");
        message.setMessageKey("7");
        message.setPayload("{\"a\":1}");
        when(repository.findById(5L)).thenReturn(Optional.of(message));

        DeadLetterRetryResponse response = service.retry(5L);

        verify(kafkaTemplate).send("wallet.credit", "7", "{\"a\":1}");
        verify(repository).save(message);
        assertThat(response.status()).isEqualTo("RETRIED");
        assertThat(response.retryCount()).isEqualTo(1);
        assertThat(response.retriedAt()).isNotNull();
    }

    @Test
    void retry_notFound_throwsAndDoesNotPublish() {
        when(repository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.retry(99L))
                .isInstanceOf(DeadLetterNotFoundException.class);

        verify(kafkaTemplate, never()).send(any(), any(), any());
    }

    @Test
    void retry_alreadyResolved_throwsAndDoesNotPublish() {
        when(repository.findById(6L)).thenReturn(Optional.of(sample(6L, "RESOLVED")));

        assertThatThrownBy(() -> service.retry(6L))
                .isInstanceOf(IllegalDltStateException.class);

        verify(kafkaTemplate, never()).send(any(), any(), any());
    }

    private DeadLetterMessage sample(Long id, String status) {
        return DeadLetterMessage.builder()
                .id(id)
                .dltTopic("wallet.credit.DLT")
                .originalTopic("wallet.credit")
                .messageKey("7")
                .payload("{}")
                .status(status)
                .retryCount(0)
                .build();
    }
}
