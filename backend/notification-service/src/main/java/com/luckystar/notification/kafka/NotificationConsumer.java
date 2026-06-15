package com.luckystar.notification.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * Kafka → WebSocket 推播橋接（T-071）。消費 {@code notification.push}，依 {@code targetPlayerId}
 * 路由：有 → 玩家私人佇列 {@code /user/{playerId}/queue/notifications}；無 → 公共廣播 {@code /topic/notifications}。
 *
 * <p>壞訊息（反序列化失敗、缺欄位）只記錄並 ack 丟棄，不重試、不卡住 consumer。
 */
@Component
public class NotificationConsumer {

    static final String PRIVATE_DESTINATION = "/queue/notifications";
    static final String BROADCAST_DESTINATION = "/topic/notifications";

    private static final Logger log = LoggerFactory.getLogger(NotificationConsumer.class);

    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;

    public NotificationConsumer(SimpMessagingTemplate messagingTemplate, ObjectMapper objectMapper) {
        this.messagingTemplate = messagingTemplate;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
            topics = "notification.push",
            groupId = "${spring.kafka.consumer.group-id:notification-service-group}",
            autoStartup = "${spring.kafka.listener.auto-startup:true}")
    public void onNotificationPush(String message, Acknowledgment ack) {
        try {
            NotificationPushEvent event = objectMapper.readValue(message, NotificationPushEvent.class);
            dispatch(event);
        } catch (Exception ex) {
            // best-effort 推播：壞訊息丟棄即可，避免無限重試卡住 consumer
            log.warn("丟棄無法處理的 notification.push 訊息：{}（payload={}）", ex.toString(), message);
        } finally {
            ack.acknowledge();
        }
    }

    /** 依 targetPlayerId 路由私人 / 廣播。抽出供單元測試直接驗證。 */
    void dispatch(NotificationPushEvent event) {
        if (event.targetPlayerId() != null) {
            messagingTemplate.convertAndSendToUser(
                    String.valueOf(event.targetPlayerId()), PRIVATE_DESTINATION, event);
            log.debug("私人推播 → playerId={}, type={}", event.targetPlayerId(), event.type());
        } else {
            messagingTemplate.convertAndSend(BROADCAST_DESTINATION, event);
            log.debug("公共廣播 → type={}", event.type());
        }
    }
}
