package com.luckystar.rank.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.service.RankService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

@Component
public class MemberRegisteredConsumer {

    private static final Logger log = LoggerFactory.getLogger(MemberRegisteredConsumer.class);

    private final RankService rankService;
    private final ObjectMapper objectMapper;

    public MemberRegisteredConsumer(RankService rankService, ObjectMapper objectMapper) {
        this.rankService = rankService;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
            topics = "member.registered",
            groupId = "${spring.kafka.consumer.group-id:rank-service-group}",
            autoStartup = "${spring.kafka.listener.auto-startup:true}")
    public void handleMemberRegistered(String message, Acknowledgment ack) throws Exception {
        MemberRegisteredEvent event = objectMapper.readValue(message, MemberRegisteredEvent.class);
        validate(event);

        rankService.updatePlayerUsername(event.playerId(), event.username());
        ack.acknowledge();

        log.info("Cached rank username for playerId={}", event.playerId());
    }

    private void validate(MemberRegisteredEvent event) {
        if (event.playerId() == null) {
            throw new IllegalArgumentException("playerId is required");
        }
        if (event.username() == null || event.username().isBlank()) {
            throw new IllegalArgumentException("username is required");
        }
    }
}
