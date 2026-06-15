package com.luckystar.notification.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * 排行榜即時廣播（T-073）。消費 {@code rank.update}，將排行榜更新事件廣播到公共頻道
 * {@code /topic/rank}，讓前端免輪詢即可顯示最新排行榜。
 *
 * <p>壞訊息（反序列化失敗、缺欄位）只記錄並 ack 丟棄，不重試、不卡住 consumer。
 */
@Component
public class RankUpdateConsumer {

    static final String DESTINATION = "/topic/rank";

    private static final Logger log = LoggerFactory.getLogger(RankUpdateConsumer.class);

    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;

    public RankUpdateConsumer(SimpMessagingTemplate messagingTemplate, ObjectMapper objectMapper) {
        this.messagingTemplate = messagingTemplate;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
            topics = "rank.update",
            groupId = "${spring.kafka.consumer.group-id:notification-service-group}",
            autoStartup = "${spring.kafka.listener.auto-startup:true}")
    public void onRankUpdate(String message, Acknowledgment ack) {
        try {
            RankUpdateEvent event = objectMapper.readValue(message, RankUpdateEvent.class);
            broadcast(event);
        } catch (Exception ex) {
            // best-effort 廣播：壞訊息丟棄即可，避免無限重試卡住 consumer
            log.warn("丟棄無法處理的 rank.update 訊息：{}（payload={}）", ex.toString(), message);
        } finally {
            ack.acknowledge();
        }
    }

    /** 將排行榜更新廣播到公共頻道。抽出供單元測試直接驗證。 */
    void broadcast(RankUpdateEvent event) {
        messagingTemplate.convertAndSend(DESTINATION, event);
        log.debug("排行榜廣播 → type={}", event.type());
    }
}
