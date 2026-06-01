package com.luckystar.wallet.kafka;

import com.luckystar.wallet.service.DeadLetterService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

/**
 * Dead Letter Topic 消費者（T-028）。
 *
 * <p>監聽 {@code wallet.credit.DLT}、{@code wallet.debit.DLT} 與 {@code wallet.credit.request.DLT}：
 * 當主 listener 重試 3 次仍失敗，
 * {@link com.luckystar.wallet.config.KafkaConsumerConfig 的 DefaultErrorHandler} 會把訊息送進對應 DLT，
 * 本 listener 接手，從 DLT header 取出原始 topic 與失敗例外資訊，呼叫
 * {@link DeadLetterService#record} 落庫，供 Admin 查詢與手動重試。
 *
 * <p>⚠️ <b>本 listener 必須「永不重拋、永遠 ack」</b>（try/finally）：
 * 它用獨立的 {@code dltListenerContainerFactory}（不掛會再路由的 errorHandler），
 * 一旦對 DLT 訊息拋例外會被再次路由成 {@code .DLT.DLT} 或卡住 partition。落庫錯誤已在
 * {@link DeadLetterService#record} 內部吞掉，這裡只負責解析 header 並保證 ack。
 *
 * <p>使用獨立 groupId {@code wallet-service-dlt-group}，offset 與主管線互不影響。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DeadLetterListener {

    private final DeadLetterService deadLetterService;

    @KafkaListener(topics = "wallet.credit.DLT", groupId = "wallet-service-dlt-group",
            containerFactory = "dltListenerContainerFactory")
    public void onCreditDlt(
            @Payload String payload,
            @Header(name = KafkaHeaders.DLT_ORIGINAL_TOPIC, required = false) byte[] origTopic,
            @Header(name = KafkaHeaders.RECEIVED_KEY, required = false) String key,
            @Header(name = KafkaHeaders.DLT_EXCEPTION_FQCN, required = false) byte[] excFqcn,
            @Header(name = KafkaHeaders.DLT_EXCEPTION_MESSAGE, required = false) byte[] excMsg,
            @Header(name = KafkaHeaders.DLT_EXCEPTION_STACKTRACE, required = false) byte[] excStack,
            Acknowledgment ack) {
        handle("wallet.credit.DLT", "wallet.credit", payload, origTopic, key, excFqcn, excMsg, excStack, ack);
    }

    @KafkaListener(topics = "wallet.debit.DLT", groupId = "wallet-service-dlt-group",
            containerFactory = "dltListenerContainerFactory")
    public void onDebitDlt(
            @Payload String payload,
            @Header(name = KafkaHeaders.DLT_ORIGINAL_TOPIC, required = false) byte[] origTopic,
            @Header(name = KafkaHeaders.RECEIVED_KEY, required = false) String key,
            @Header(name = KafkaHeaders.DLT_EXCEPTION_FQCN, required = false) byte[] excFqcn,
            @Header(name = KafkaHeaders.DLT_EXCEPTION_MESSAGE, required = false) byte[] excMsg,
            @Header(name = KafkaHeaders.DLT_EXCEPTION_STACKTRACE, required = false) byte[] excStack,
            Acknowledgment ack) {
        handle("wallet.debit.DLT", "wallet.debit", payload, origTopic, key, excFqcn, excMsg, excStack, ack);
    }

    @KafkaListener(topics = "wallet.credit.request.DLT", groupId = "wallet-service-dlt-group",
            containerFactory = "dltListenerContainerFactory")
    public void onCreditRequestDlt(
            @Payload String payload,
            @Header(name = KafkaHeaders.DLT_ORIGINAL_TOPIC, required = false) byte[] origTopic,
            @Header(name = KafkaHeaders.RECEIVED_KEY, required = false) String key,
            @Header(name = KafkaHeaders.DLT_EXCEPTION_FQCN, required = false) byte[] excFqcn,
            @Header(name = KafkaHeaders.DLT_EXCEPTION_MESSAGE, required = false) byte[] excMsg,
            @Header(name = KafkaHeaders.DLT_EXCEPTION_STACKTRACE, required = false) byte[] excStack,
            Acknowledgment ack) {
        handle("wallet.credit.request.DLT", "wallet.credit.request", payload, origTopic, key,
                excFqcn, excMsg, excStack, ack);
    }

    private void handle(String dltTopic, String defaultOriginalTopic, String payload,
                        byte[] origTopic, String key, byte[] excFqcn, byte[] excMsg, byte[] excStack,
                        Acknowledgment ack) {
        try {
            String originalTopic = decode(origTopic, defaultOriginalTopic);
            String exceptionClass = decode(excFqcn, null);
            String failureReason = decode(excMsg, null);
            String stackTrace = decode(excStack, null);

            deadLetterService.record(dltTopic, originalTopic, key, payload,
                    exceptionClass, failureReason, stackTrace);
        } catch (Exception e) {
            // 理論上不會走到（record 內部已吞例外），但仍兜底，確保 ack 一定執行。
            log.error("Unexpected error handling dead letter from topic={} payload={}", dltTopic, payload, e);
        } finally {
            // DLT 訊息一律 ack：絕不重拋、不重新路由（避免 .DLT.DLT 連鎖）。
            ack.acknowledge();
        }
    }

    private String decode(byte[] header, String fallback) {
        return header == null ? fallback : new String(header, StandardCharsets.UTF_8);
    }
}
