package com.luckystar.wallet.config;

import com.fasterxml.jackson.core.JsonProcessingException;
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
 * Kafka consumer 錯誤處理設定。
 *
 * <p>處理策略：暫時性錯誤（如 DB 斷線）重試 3 次（間隔 2 秒），耗盡後把訊息送進
 * {@code <topic>.DLT}（Dead Letter Topic），避免毒丸訊息卡死整個 partition。
 * JSON 格式錯誤（{@link JsonProcessingException}）與參數錯誤（{@link IllegalArgumentException}）
 * 屬「不可重試」，直接送 DLT 不浪費重試次數。
 *
 * <p>⚠️ 注意：本類別內**每個 bean 方法名稱必須唯一**。Spring Boot 3.2+ 預設
 * {@code @Configuration.enforceUniqueMethods=true}，若出現兩個同名 @Bean 方法
 * （即使參數不同）會在啟動時丟 {@code BeanDefinitionParsingException} 導致服務無法啟動。
 */
@EnableKafka
@Configuration
public class KafkaConsumerConfig {

    /** 預設目的地解析器：把 {@code <topic>} 的失敗訊息送到 {@code <topic>.DLT}（如 wallet.credit.DLT）。 */
    @Bean
    public DeadLetterPublishingRecoverer deadLetterRecoverer(KafkaTemplate<String, String> template) {
        return new DeadLetterPublishingRecoverer(template);
    }

    /** 重試 3 次（間隔 2s）仍失敗則送 DLT；格式/參數錯誤視為不可重試，直接送 DLT。 */
    @Bean
    public DefaultErrorHandler kafkaErrorHandler(DeadLetterPublishingRecoverer recoverer) {
        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, new FixedBackOff(2000L, 3L));
        handler.addNotRetryableExceptions(
                JsonProcessingException.class,
                IllegalArgumentException.class
        );
        return handler;
    }

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactory(
            ConsumerFactory<String, String> consumerFactory,
            DefaultErrorHandler kafkaErrorHandler) {
        ConcurrentKafkaListenerContainerFactory<String, String> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(consumerFactory);
        factory.setCommonErrorHandler(kafkaErrorHandler);
        // 手動 ack：listener 成功處理後才呼叫 ack.acknowledge()，避免訊息遺失
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL_IMMEDIATE);
        return factory;
    }

    /**
     * DLT 專用 listener factory（T-028）。
     *
     * <p>給 {@link com.luckystar.wallet.kafka.DeadLetterListener} 消費 {@code <topic>.DLT} 用。
     * <b>刻意不掛 {@link #kafkaErrorHandler}</b>：DLT 已是「最後一站」，若再套用會把失敗訊息
     * 路由成 {@code .DLT.DLT} 形成連鎖。DLT listener 自身保證永遠 ack、不重拋，
     * 故此 factory 只需手動 ack 模式，不需錯誤重試/路由。
     *
     * <p>⚠️ 方法名 {@code dltListenerContainerFactory} 必須與其他 @Bean 唯一
     * （Spring Boot 3.2+ enforceUniqueMethods）。
     */
    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, String> dltListenerContainerFactory(
            ConsumerFactory<String, String> consumerFactory) {
        ConcurrentKafkaListenerContainerFactory<String, String> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(consumerFactory);
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL_IMMEDIATE);
        return factory;
    }
}
