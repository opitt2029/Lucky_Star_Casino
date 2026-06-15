package com.luckystar.notification.kafka;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.messaging.simp.SimpMessagingTemplate;

class NotificationConsumerTest {

    private final SimpMessagingTemplate template = mock(SimpMessagingTemplate.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final NotificationConsumer consumer = new NotificationConsumer(template, objectMapper);

    @Test
    void targetedEvent_goesToUserPrivateQueue() {
        NotificationPushEvent event = new NotificationPushEvent(
                7L, "WEEKLY_RANK_TOP3", "title", "msg", Map.of("rank", 1));

        consumer.dispatch(event);

        verify(template).convertAndSendToUser(
                eq("7"), eq(NotificationConsumer.PRIVATE_DESTINATION), eq(event));
    }

    @Test
    void broadcastEvent_goesToTopic() {
        NotificationPushEvent event = new NotificationPushEvent(
                null, "ANNOUNCEMENT", "title", "msg", Map.of());

        consumer.dispatch(event);

        verify(template).convertAndSend(eq(NotificationConsumer.BROADCAST_DESTINATION), eq(event));
    }

    @Test
    void malformedMessage_isAckedAndDropped_withoutThrowing() {
        Acknowledgment ack = mock(Acknowledgment.class);

        consumer.onNotificationPush("{ not valid json", ack);

        verify(ack).acknowledge();
        verifyNoInteractions(template);
    }

    @Test
    void validKafkaMessage_isDispatchedAndAcked() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        String json = objectMapper.writeValueAsString(
                new NotificationPushEvent(9L, "X", "t", "m", Map.of()));

        consumer.onNotificationPush(json, ack);

        verify(template).convertAndSendToUser(eq("9"), eq(NotificationConsumer.PRIVATE_DESTINATION), any());
        verify(template, never()).convertAndSend(any(String.class), any(Object.class));
        verify(ack).acknowledge();
    }
}
