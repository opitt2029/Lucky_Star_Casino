package com.luckystar.notification.kafka;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.messaging.simp.SimpMessagingTemplate;

class RankUpdateConsumerTest {

    private final SimpMessagingTemplate template = mock(SimpMessagingTemplate.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RankUpdateConsumer consumer = new RankUpdateConsumer(template, objectMapper);

    @Test
    void broadcast_goesToRankTopic() {
        RankUpdateEvent event = new RankUpdateEvent(
                "WEEKLY", List.of(Map.of("playerId", 1, "score", 100)), 1_700_000_000L);

        consumer.broadcast(event);

        verify(template).convertAndSend(eq(RankUpdateConsumer.DESTINATION), eq(event));
    }

    @Test
    void malformedMessage_isAckedAndDropped_withoutThrowing() {
        Acknowledgment ack = mock(Acknowledgment.class);

        consumer.onRankUpdate("{ not valid json", ack);

        verify(ack).acknowledge();
        verifyNoInteractions(template);
    }

    @Test
    void validKafkaMessage_isBroadcastAndAcked() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        String json = objectMapper.writeValueAsString(
                new RankUpdateEvent("DAILY", List.of(Map.of("playerId", 9, "score", 50)), 1_700_000_001L));

        consumer.onRankUpdate(json, ack);

        verify(template).convertAndSend(eq(RankUpdateConsumer.DESTINATION), any(RankUpdateEvent.class));
        verify(ack).acknowledge();
    }
}
