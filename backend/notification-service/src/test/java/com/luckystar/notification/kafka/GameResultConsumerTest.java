package com.luckystar.notification.kafka;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.messaging.simp.SimpMessagingTemplate;

class GameResultConsumerTest {

    private final SimpMessagingTemplate template = mock(SimpMessagingTemplate.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final GameResultConsumer consumer = new GameResultConsumer(template, objectMapper);

    @Test
    @SuppressWarnings("unchecked")
    void gameResult_isPushedToPlayerPrivateQueue() {
        GameResultEvent event = new GameResultEvent(
                "round-1", 42L, "SLOT", 100L, 250L, true, "2026-06-15T10:00:00");

        consumer.pushToPlayer(event);

        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(template).convertAndSendToUser(
                eq("42"), eq(GameResultConsumer.DESTINATION), payload.capture());

        Map<String, Object> sent = (Map<String, Object>) payload.getValue();
        assertThat(sent).containsEntry("type", GameResultConsumer.NOTIFICATION_TYPE);
        assertThat(sent).containsEntry("roundId", "round-1");
        assertThat(sent).containsEntry("payout", 250L);
        assertThat(sent).containsEntry("win", true);
    }

    @Test
    void missingPlayerId_isSkipped() {
        GameResultEvent event = new GameResultEvent(
                "round-2", null, "SLOT", 100L, 0L, false, null);

        consumer.pushToPlayer(event);

        verify(template, never()).convertAndSendToUser(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void realGameResultJson_withExtraFields_isParsedAndPushed() throws Exception {
        // 模擬 game-service slot 事件（含本服務未宣告的 multiplier/gameType 額外欄位）
        String json = """
                {"roundId":"r-9","playerId":7,"gameType":"SLOT","bet":50,
                 "payout":0,"multiplier":0.0,"win":false,"settledAt":"2026-06-15T10:00:00"}
                """;
        Acknowledgment ack = mock(Acknowledgment.class);

        consumer.onGameResult(json, ack);

        verify(template).convertAndSendToUser(
                eq("7"), eq(GameResultConsumer.DESTINATION),
                org.mockito.ArgumentMatchers.any());
        verify(ack).acknowledge();
    }

    @Test
    void malformedMessage_isAckedAndDropped() {
        Acknowledgment ack = mock(Acknowledgment.class);

        consumer.onGameResult("nonsense", ack);

        verify(ack).acknowledge();
    }
}
