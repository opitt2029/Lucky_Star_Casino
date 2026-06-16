package com.luckystar.admin.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.admin.service.AlertRuleEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

/**
 * 消費 {@code wallet.credit} / {@code wallet.debit}（事件）餵給告警規則引擎（T-054）。
 *
 * 注意（ADR-002）：admin 只「計數」這些帳務事件做異常偵測，<b>絕不</b>重新入帳，
 * 也不消費 {@code wallet.credit.request}（指令）。MANUAL_IMMEDIATE ack：壞訊息丟棄。
 */
@Component
public class WalletEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(WalletEventConsumer.class);

    private final ObjectMapper objectMapper;
    private final AlertRuleEngine alertRuleEngine;

    public WalletEventConsumer(ObjectMapper objectMapper, AlertRuleEngine alertRuleEngine) {
        this.objectMapper = objectMapper;
        this.alertRuleEngine = alertRuleEngine;
    }

    @KafkaListener(
            topics = {"wallet.credit", "wallet.debit"},
            groupId = "${spring.kafka.consumer.group-id:admin-service-group}",
            autoStartup = "${spring.kafka.listener.auto-startup:true}")
    public void onMessage(String message, Acknowledgment ack) {
        try {
            WalletEvent event = objectMapper.readValue(message, WalletEvent.class);
            alertRuleEngine.onWalletEvent(event);
        } catch (Exception ex) {
            log.warn("Dropping bad wallet event message: {}", message, ex);
        } finally {
            ack.acknowledge();
        }
    }
}
