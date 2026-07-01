package com.luckystar.admin.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.admin.service.AlertRuleEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

/**
 * 消費 {@code game.result} 餵給告警規則引擎（T-054）。
 *
 * 採 MANUAL_IMMEDIATE ack：壞訊息 log 後仍 ack 丟棄（不引入 DLT 基建），避免毒訊息卡住分區。
 */
@Component
public class GameResultConsumer {

    private static final Logger log = LoggerFactory.getLogger(GameResultConsumer.class);

    private final ObjectMapper objectMapper;
    private final AlertRuleEngine alertRuleEngine;

    public GameResultConsumer(ObjectMapper objectMapper, AlertRuleEngine alertRuleEngine) {
        this.objectMapper = objectMapper;
        this.alertRuleEngine = alertRuleEngine;
    }

    @KafkaListener(
            topics = "game.result",
            groupId = "${spring.kafka.consumer.group-id:admin-service-group}",
            autoStartup = "${spring.kafka.listener.auto-startup:true}")
    public void onMessage(String message, Acknowledgment ack) {
        try {
            GameResultEvent event = objectMapper.readValue(message, GameResultEvent.class);
            alertRuleEngine.onGameResult(event);
        } catch (Exception ex) {
            log.warn("Dropping bad game.result message: {}", message, ex);
        } finally {
            ack.acknowledge();
        }
    }
}
