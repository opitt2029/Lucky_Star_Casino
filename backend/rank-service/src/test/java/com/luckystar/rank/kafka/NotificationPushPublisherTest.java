package com.luckystar.rank.kafka;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.dto.RankEntryResponse;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NotificationPushPublisherTest {

    @Mock
    KafkaTemplate<String, String> kafkaTemplate;

    @Mock
    ObjectMapper objectMapper;

    @Test
    void publishWeeklyTop3Notification_sendsNotificationPushEvent() throws Exception {
        NotificationPushPublisher publisher = new NotificationPushPublisher(kafkaTemplate, objectMapper);
        RankEntryResponse entry = new RankEntryResponse(7L, "nova", 1L, 9000L);
        List<RankEntryResponse> top3 = List.of(
                entry,
                new RankEntryResponse(42L, "alice", 2L, 1500L),
                new RankEntryResponse(9L, "mika", 3L, 1000L));
        when(objectMapper.writeValueAsString(any(NotificationPushEvent.class))).thenReturn("{\"ok\":true}");

        boolean result = publisher.publishWeeklyTop3Notification(entry, LocalDate.of(2026, 6, 8), top3);

        ArgumentCaptor<NotificationPushEvent> eventCaptor = ArgumentCaptor.forClass(NotificationPushEvent.class);
        verify(objectMapper).writeValueAsString(eventCaptor.capture());
        NotificationPushEvent event = eventCaptor.getValue();
        assertThat(event.targetPlayerId()).isEqualTo(7L);
        assertThat(event.type()).isEqualTo(NotificationPushPublisher.WEEKLY_TOP3_TYPE);
        assertThat(event.title()).isEqualTo("Weekly leaderboard results");
        assertThat(event.message()).contains("#1").contains("9000");
        assertThat(event.payload()).containsEntry("weekStart", "2026-06-08");
        assertThat(event.payload()).containsEntry("rank", 1L);
        assertThat(event.payload()).containsEntry("score", 9000L);
        assertThat(event.payload().get("top3")).asList().hasSize(3);
        verify(kafkaTemplate).send(NotificationPushPublisher.TOPIC, "7", "{\"ok\":true}");
        assertThat(result).isTrue();
    }

    @Test
    void publishWeeklyTop3Notification_returnsFalseWhenSerializationFails() throws Exception {
        NotificationPushPublisher publisher = new NotificationPushPublisher(kafkaTemplate, objectMapper);
        RankEntryResponse entry = new RankEntryResponse(7L, "nova", 1L, 9000L);
        when(objectMapper.writeValueAsString(any(NotificationPushEvent.class)))
                .thenThrow(new TestJsonProcessingException());

        boolean result = publisher.publishWeeklyTop3Notification(
                entry,
                LocalDate.of(2026, 6, 8),
                List.of(entry));

        verify(kafkaTemplate, never()).send(any(), any(), any());
        assertThat(result).isFalse();
    }

    private static class TestJsonProcessingException extends JsonProcessingException {

        TestJsonProcessingException() {
            super("boom");
        }
    }
}
