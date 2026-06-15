package com.luckystar.admin.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.listener.ContainerProperties;

/**
 * Kafka 消費者容器設定（T-054）。
 *
 * 採 MANUAL_IMMEDIATE ack（手動提交）：consumer 自行於 finally ack。
 * 刻意不設 DefaultErrorHandler / DeadLetterPublishingRecoverer —— admin 對壞訊息採
 * 「log + ack 丟棄」策略，無需引入 dead_letter_messages 基建（與 rank-service 的 DLT 設計不同）。
 */
@EnableKafka
@Configuration
public class KafkaConsumerConfig {

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactory(
            ConsumerFactory<String, String> consumerFactory) {
        ConcurrentKafkaListenerContainerFactory<String, String> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(consumerFactory);
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL_IMMEDIATE);
        return factory;
    }
}
