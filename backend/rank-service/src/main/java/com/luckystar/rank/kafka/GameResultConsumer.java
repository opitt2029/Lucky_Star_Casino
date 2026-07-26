package com.luckystar.rank.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.service.RankService;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

@Component
public class GameResultConsumer {

    private static final Logger log = LoggerFactory.getLogger(GameResultConsumer.class);
    private static final String DEDUP_KEY_PREFIX = "rank:dedup:game:";
    private static final Duration DEDUP_TTL = Duration.ofDays(7);

    private final RankService rankService;
    private final ObjectMapper objectMapper;
    private final StringRedisTemplate redisTemplate;

    public GameResultConsumer(RankService rankService, ObjectMapper objectMapper, StringRedisTemplate redisTemplate) {
        this.rankService = rankService;
        this.objectMapper = objectMapper;
        this.redisTemplate = redisTemplate;
    }

    @KafkaListener(
            topics = "game.result",
            groupId = "${spring.kafka.consumer.group-id:rank-service-group}",
            autoStartup = "${spring.kafka.listener.auto-startup:true}")
    public void handleGameResult(String message, Acknowledgment ack) throws Exception {
        GameResultEvent event = objectMapper.readValue(message, GameResultEvent.class);
        validate(event);

        if (event.status() != null && !"SETTLED".equalsIgnoreCase(event.status())) {
            ack.acknowledge();
            return;
        }
        if (shouldApply(event)) {
            rankService.updateGameResult(event.playerId(), event.gameType(), event.bet(), event.payout());
        }
        ack.acknowledge();
        log.info("Updated game rank gameType={} roundId={} playerId={}",
                event.gameType(), event.roundId(), event.playerId());
    }

    private boolean shouldApply(GameResultEvent event) {
        if (event.roundId() == null || event.roundId().isBlank()) {
            log.warn("game.result missing roundId; applying without dedup playerId={} gameType={}",
                    event.playerId(), event.gameType());
            return true;
        }
        Boolean first = redisTemplate.opsForValue()
                .setIfAbsent(DEDUP_KEY_PREFIX + event.roundId(), "1", DEDUP_TTL);
        return Boolean.TRUE.equals(first);
    }

    private void validate(GameResultEvent event) {
        if (event.playerId() == null) {
            throw new IllegalArgumentException("playerId is required");
        }
        if (event.gameType() == null || event.gameType().isBlank()) {
            throw new IllegalArgumentException("gameType is required");
        }
        if (event.bet() == null) {
            throw new IllegalArgumentException("bet is required");
        }
        if (event.payout() == null) {
            throw new IllegalArgumentException("payout is required");
        }
    }
}
