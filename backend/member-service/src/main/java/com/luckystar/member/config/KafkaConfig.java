package com.luckystar.member.config;

import com.fasterxml.jackson.core.JsonProcessingException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.ContainerProperties;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

/**
 * Kafka consumer 端的錯誤處理設定。
 *
 * 設計目的：避免「毒丸訊息（poison message）」卡死整個 partition。
 * 在 Kafka 中同一 partition 是順序消費的，若某筆訊息永遠處理失敗又不前進 offset，
 * 後面的訊息將永遠消費不到。這裡用 DefaultErrorHandler 統一處理失敗：
 *   1. 暫時性錯誤（如 DB 短暫斷線）→ 重試 3 次、每次間隔 2 秒
 *   2. 重試耗盡，或遇到「重試也沒用」的錯誤（如 JSON 格式錯誤）
 *      → 由 DeadLetterPublishingRecoverer 把訊息送進 <原topic>.DLT，然後前進 offset
 */
@EnableKafka
@Configuration
public class KafkaConfig {

    @Bean
    public DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, String> kafkaTemplate) {
        // 重試耗盡後，把失敗訊息送到 "<原topic>.DLT"（例如 member.registered.DLT）
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(kafkaTemplate);

        // 重試間隔 2 秒、最多重試 3 次（第 1 次失敗後再試 3 次，共處理 4 次）
        FixedBackOff backOff = new FixedBackOff(2000L, 3L);

        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, backOff);

        // 格式類錯誤重試再多次也不會變好 → 不重試，直接送 DLT
        handler.addNotRetryableExceptions(
                JsonProcessingException.class,
                IllegalArgumentException.class
        );
        return handler;
    }

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactory(
            ConsumerFactory<String, String> consumerFactory,
            DefaultErrorHandler kafkaErrorHandler,
            @Value("${spring.kafka.listener.auto-startup:true}") boolean autoStartup) {
        ConcurrentKafkaListenerContainerFactory<String, String> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(consumerFactory);
        factory.setCommonErrorHandler(kafkaErrorHandler);
        factory.setAutoStartup(autoStartup);
        // 維持手動 ack：listener 成功呼叫 ack.acknowledge() 才提交 offset；
        // 失敗時由上面的 error handler 接手（重試或送 DLT 後提交）
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL_IMMEDIATE);
        return factory;
    }
}
