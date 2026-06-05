package com.luckystar.rank.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.service.RankService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

@Component
public class FriendRelationshipUpdatedConsumer {

    private static final Logger log = LoggerFactory.getLogger(FriendRelationshipUpdatedConsumer.class);

    private final RankService rankService;
    private final ObjectMapper objectMapper;

    public FriendRelationshipUpdatedConsumer(RankService rankService, ObjectMapper objectMapper) {
        this.rankService = rankService;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
            topics = "friend.relationship.updated",
            groupId = "${spring.kafka.consumer.group-id:rank-service-group}",
            autoStartup = "${spring.kafka.listener.auto-startup:true}")
    public void handleFriendRelationshipUpdated(String message, Acknowledgment ack) throws Exception {
        FriendRelationshipUpdatedEvent event =
                objectMapper.readValue(message, FriendRelationshipUpdatedEvent.class);
        validate(event);

        rankService.rebuildFriendRank(event.playerId(), event.friendIds());
        ack.acknowledge();

        log.info(
                "Rebuilt friend rank for playerId={} with friendCount={}",
                event.playerId(),
                event.friendIds().size());
    }

    private void validate(FriendRelationshipUpdatedEvent event) {
        if (event.playerId() == null) {
            throw new IllegalArgumentException("playerId is required");
        }
        if (event.friendIds() == null) {
            throw new IllegalArgumentException("friendIds is required");
        }
    }
}
