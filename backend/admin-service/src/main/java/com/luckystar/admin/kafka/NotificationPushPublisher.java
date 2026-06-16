package com.luckystar.admin.kafka;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * 發布 {@code notification.push} 事件（best-effort，比照 rank-service）。
 *
 * 失敗只記 warn 不拋例外：告警通知是輔助訊號，不可因 Kafka 故障而拖垮告警落庫的主交易。
 */
@Component
public class NotificationPushPublisher {

    public static final String TOPIC = "notification.push";

    private static final Logger log = LoggerFactory.getLogger(NotificationPushPublisher.class);

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    public NotificationPushPublisher(KafkaTemplate<String, String> kafkaTemplate, ObjectMapper objectMapper) {
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
    }

    public boolean publishAlert(
            Long targetPlayerId,
            String type,
            String title,
            String message,
            Map<String, Object> payload) {
        try {
            NotificationPushEvent event =
                    new NotificationPushEvent(targetPlayerId, type, title, message, payload);
            String value = objectMapper.writeValueAsString(event);
            String key = targetPlayerId == null ? null : String.valueOf(targetPlayerId);
            kafkaTemplate.send(TOPIC, key, value);
            return true;
        } catch (JsonProcessingException ex) {
            log.warn("Failed to serialize admin alert notification type={}", type, ex);
            return false;
        } catch (RuntimeException ex) {
            log.warn("Failed to publish admin alert notification type={}", type, ex);
            return false;
        }
    }
}
