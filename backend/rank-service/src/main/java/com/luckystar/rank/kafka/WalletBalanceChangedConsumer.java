package com.luckystar.rank.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.service.RankService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

@Component
public class WalletBalanceChangedConsumer {

    private static final Logger log = LoggerFactory.getLogger(WalletBalanceChangedConsumer.class);

    private final RankService rankService;
    private final ObjectMapper objectMapper;

    public WalletBalanceChangedConsumer(RankService rankService, ObjectMapper objectMapper) {
        this.rankService = rankService;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
            topics = {"wallet.credit", "wallet.debit"},
            groupId = "${spring.kafka.consumer.group-id:rank-service-group}",
            autoStartup = "${spring.kafka.listener.auto-startup:true}")
    public void handleWalletBalanceChanged(String message, Acknowledgment ack) throws Exception {
        WalletBalanceChangedEvent event = objectMapper.readValue(message, WalletBalanceChangedEvent.class);
        validate(event);

        rankService.updatePlayerCoins(event.playerId(), event.balanceAfter());
        if ("WIN".equals(event.subType()) && event.amount() != null) {
            rankService.addDailyWinnings(event.playerId(), event.amount());
        }
        ack.acknowledge();

        log.info(
                "Updated global coins rank for playerId={}, transactionId={}, balanceAfter={}",
                event.playerId(),
                event.transactionId(),
                event.balanceAfter());
    }

    private void validate(WalletBalanceChangedEvent event) {
        if (event.playerId() == null) {
            throw new IllegalArgumentException("playerId is required");
        }
        if (event.balanceAfter() == null) {
            throw new IllegalArgumentException("balanceAfter is required");
        }
    }
}
