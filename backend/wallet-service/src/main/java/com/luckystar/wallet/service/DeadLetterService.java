package com.luckystar.wallet.service;

import com.luckystar.wallet.common.PagedResponse;
import com.luckystar.wallet.dto.DeadLetterMessageResponse;
import com.luckystar.wallet.dto.DeadLetterRetryResponse;
import com.luckystar.wallet.exception.DeadLetterNotFoundException;
import com.luckystar.wallet.exception.IllegalDltStateException;
import com.luckystar.wallet.postgres.entity.DeadLetterMessage;
import com.luckystar.wallet.postgres.repository.DeadLetterMessageRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * DLT 失敗訊息服務（T-028）。
 *
 * <p>三個職責：
 * <ul>
 *   <li>{@link #record}：由 {@link com.luckystar.wallet.kafka.DeadLetterListener} 呼叫，
 *       把消費失敗的訊息與原因落入 PostgreSQL 寫庫（@Primary）。</li>
 *   <li>{@link #query}：Admin 依狀態 / DLT topic 分頁查詢。</li>
 *   <li>{@link #retry}：Admin 手動重試 —— 把原始 payload 重發回 {@code originalTopic}。
 *       下游 listener 皆冪等（{@code existsById} / {@code idempotency_key}），重送安全。</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DeadLetterService {

    /** 堆疊上限，避免 TEXT 欄位無限膨脹。 */
    static final int STACK_TRACE_MAX_LEN = 4000;

    private final DeadLetterMessageRepository repository;
    private final KafkaTemplate<String, String> kafkaTemplate;

    /**
     * 記錄一筆消費失敗訊息。
     *
     * <p>本方法供 DLT consumer 呼叫，<b>絕不往外拋例外</b>：即使落庫失敗也只記 log，
     * 讓 listener 能照常 ack，避免 DLT 訊息再次失敗形成 {@code .DLT.DLT} 連鎖或卡住 partition。
     */
    @Transactional
    public void record(String dltTopic, String originalTopic, String messageKey,
                       String payload, String exceptionClass, String failureReason, String stackTrace) {
        try {
            DeadLetterMessage entity = DeadLetterMessage.builder()
                    .dltTopic(dltTopic)
                    .originalTopic(originalTopic)
                    .messageKey(messageKey)
                    .payload(payload)
                    .exceptionClass(exceptionClass)
                    .failureReason(failureReason)
                    .stackTrace(truncate(stackTrace))
                    .status("FAILED")
                    .retryCount(0)
                    .build();
            repository.save(entity);
            log.warn("Recorded dead letter from topic={} originalTopic={} reason={}",
                    dltTopic, originalTopic, failureReason);
        } catch (Exception e) {
            // 落庫失敗不可往外拋（否則 DLT 訊息會再次失敗）；僅記 log 供人工排查。
            log.error("Failed to persist dead letter message from topic={} payload={}",
                    dltTopic, payload, e);
        }
    }

    /**
     * 分頁查詢 DLT 失敗訊息，支援狀態與 DLT topic 過濾（皆可省略）。
     * 排序固定為建立時間新到舊，確保分頁穩定。
     */
    @Transactional(readOnly = true)
    public PagedResponse<DeadLetterMessageResponse> query(String status, String dltTopic, Pageable pageable) {
        Page<DeadLetterMessage> result;
        if (status != null && dltTopic != null) {
            result = repository.findByStatusAndDltTopic(status, dltTopic, pageable);
        } else if (status != null) {
            result = repository.findByStatus(status, pageable);
        } else if (dltTopic != null) {
            result = repository.findByDltTopic(dltTopic, pageable);
        } else {
            result = repository.findAll(pageable);
        }
        return PagedResponse.from(result, DeadLetterMessageResponse::from);
    }

    /**
     * 手動重試：把原始 payload 重發回 {@code originalTopic}，並標記為 RETRIED、累加重試次數。
     *
     * @throws DeadLetterNotFoundException 查無此 id
     * @throws IllegalDltStateException    訊息已是 RESOLVED 狀態
     */
    @Transactional
    public DeadLetterRetryResponse retry(Long id) {
        DeadLetterMessage message = repository.findById(id)
                .orElseThrow(() -> new DeadLetterNotFoundException("Dead letter message not found: " + id));

        if ("RESOLVED".equals(message.getStatus())) {
            throw new IllegalDltStateException("Dead letter message already resolved");
        }

        // 重發原始 payload 回原 topic；下游 listener 冪等，重送不會重複入帳。
        kafkaTemplate.send(message.getOriginalTopic(), message.getMessageKey(), message.getPayload());

        message.setRetryCount(message.getRetryCount() + 1);
        message.setStatus("RETRIED");
        message.setLastRetriedAt(LocalDateTime.now());
        repository.save(message);

        log.info("Manually retried dead letter id={} → republished to topic={}",
                id, message.getOriginalTopic());

        return new DeadLetterRetryResponse(
                message.getId(),
                message.getOriginalTopic(),
                message.getStatus(),
                message.getRetryCount(),
                message.getLastRetriedAt());
    }

    private String truncate(String s) {
        if (s == null || s.length() <= STACK_TRACE_MAX_LEN) {
            return s;
        }
        return s.substring(0, STACK_TRACE_MAX_LEN);
    }
}
