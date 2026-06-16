package com.luckystar.notification.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * 遊戲結果即時推播（T-072）。消費 {@code game.result}，組推播 payload 後送到下注玩家的私人佇列
 * {@code /user/{playerId}/queue/notifications}，讓前端免輪詢即可顯示結算結果。
 *
 * <p>壞訊息或缺 {@code playerId} 的事件僅記錄並 ack 丟棄，不卡住 consumer。
 */
@Component
public class GameResultConsumer {

    static final String NOTIFICATION_TYPE = "GAME_RESULT";
    static final String DESTINATION = "/queue/notifications";

    private static final Logger log = LoggerFactory.getLogger(GameResultConsumer.class);

    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;

    public GameResultConsumer(SimpMessagingTemplate messagingTemplate, ObjectMapper objectMapper) {
        this.messagingTemplate = messagingTemplate;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
            topics = "game.result",
            groupId = "${spring.kafka.consumer.group-id:notification-service-group}",
            autoStartup = "${spring.kafka.listener.auto-startup:true}")
    public void onGameResult(String message, Acknowledgment ack) {
        try {
            GameResultEvent event = objectMapper.readValue(message, GameResultEvent.class);
            pushToPlayer(event);
        } catch (Exception ex) {
            log.warn("丟棄無法處理的 game.result 訊息：{}（payload={}）", ex.toString(), message);
        } finally {
            ack.acknowledge();
        }
    }

    /** 組推播內容並送到玩家私人頻道。playerId 為空則略過（無法定位收件玩家）。抽出供單元測試。 */
    void pushToPlayer(GameResultEvent event) {
        if (event.playerId() == null) {
            log.warn("game.result 缺少 playerId，略過推播 roundId={}", event.roundId());
            return;
        }
        Map<String, Object> notification = new LinkedHashMap<>();
        notification.put("type", NOTIFICATION_TYPE);
        notification.put("roundId", event.roundId());
        notification.put("gameType", event.gameType());
        notification.put("bet", event.bet());
        notification.put("payout", event.payout());
        notification.put("win", event.win());
        notification.put("settledAt", event.settledAt());

        messagingTemplate.convertAndSendToUser(
                String.valueOf(event.playerId()), DESTINATION, notification);
        log.debug("遊戲結果推播 → playerId={}, roundId={}", event.playerId(), event.roundId());
    }
}
